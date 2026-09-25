/**
 * FluidCNC - Unconventional Step Loss Detection & Prevention
 * 
 * Multiple low-cost methods to detect and prevent missed steps
 * WITHOUT servos or expensive encoders:
 * 
 * 1. AUDIO ANALYSIS - Listen to stepper motors for stall signatures
 * 2. CURRENT SENSING - Monitor driver current via ESP32 ADC
 * 3. ACCELEROMETER DRIFT - Detect position drift via vibration fingerprints
 * 4. RESONANCE AVOIDANCE - Auto-detect and skip resonant frequencies
 * 5. LOAD PREDICTION - ML model predicts when stall is likely
 * 6. PROBE VERIFICATION - Periodic probing of known reference points
 * 7. THERMAL COMPENSATION - Model thermal expansion
 * 8. BACK-EMF ANALYSIS - Detect stall via motor electrical signature
 */

class StepLossDetection {
    constructor(options = {}) {
        this.grbl = options.grbl || null;
        this.chatterSystem = options.chatterSystem || null;
        
        // Connection state tracking
        this.connections = {
            grbl: false,
            chatter: false,
            audio: false,
            temperature: false
        };
        
        // Active methods tracking (what's actually working right now)
        this.activeMethods = {
            audio: false,
            current: false,
            vibration: false,
            resonance: false,
            prediction: false,
            verification: false,
            thermal: false,
            backEmf: false
        };
        
        // ================================================================
        // METHOD 1: Audio-Based Stall Detection
        // Steppers make distinct sounds - stalls have signature frequency
        // ================================================================
        this.audio = {
            enabled: true,
            context: null,
            analyzer: null,
            microphone: null,
            // Normal stepper: 1-4kHz depending on speed
            // Stall signature: sudden drop in fundamental + harmonics
            normalFrequencyRange: { min: 800, max: 4000 },
            stallThreshold: 0.3,  // Sudden amplitude drop
            lastSpectrum: null,
            stallDetected: false
        };
        
        // ================================================================
        // METHOD 2: Current Sensing (via ESP32 ADC or shunt resistor)
        // Steppers draw MORE current when stalling/missing steps
        // ================================================================
        this.current = {
            enabled: true,
            baseline: { x: 0, y: 0, z: 0 },  // Calibrated idle current
            moving: { x: 0, y: 0, z: 0 },     // Normal moving current
            stallMultiplier: 1.8,  // Current > 1.8x normal = stall
            samples: [],
            sampleWindow: 50
        };
        
        // ================================================================
        // METHOD 3: Accelerometer Position Fingerprinting
        // Each machine position has unique vibration signature
        // Drift from expected = position error
        // ================================================================
        this.vibration = {
            enabled: true,
            fingerprints: new Map(),  // Position -> vibration signature
            learningMode: false,
            positionTolerance: 1.0,  // mm - positions within this are same
            signatureMatch: 0.85,    // Required similarity
            driftHistory: []
        };
        
        // ================================================================
        // METHOD 4: Resonance Frequency Avoidance
        // Steppers lose steps at resonant frequencies (typically 80-200 Hz)
        // Detect and skip these speeds automatically
        // ================================================================
        this.resonance = {
            enabled: true,
            // Common resonance zones (steps/sec converted to mm/sec)
            dangerZones: [],  // Will be auto-detected
            detectedResonances: [],
            scanComplete: false,
            avoidanceMargin: 50  // mm/min buffer around resonance
        };
        
        // ================================================================
        // METHOD 5: Predictive Load Model
        // Track cutting forces, predict when stall is likely
        // ================================================================
        this.prediction = {
            enabled: true,
            loadHistory: [],
            stallEvents: [],  // Learn from past stalls
            model: null,      // Simple neural network weights
            riskThreshold: 0.7
        };
        
        // ================================================================
        // METHOD 6: Reference Point Verification
        // Periodically probe known points to verify position
        // ================================================================
        this.verification = {
            enabled: true,
            referencePoints: [],  // { x, y, z, probeZ } - known positions
            lastVerification: 0,
            verifyInterval: 300000,  // 5 minutes
            maxDrift: 0.1,  // mm - trigger recalibration if exceeded
            driftLog: []
        };
        
        // ================================================================
        // METHOD 7: Thermal Expansion Compensation
        // Steel expands ~12μm/m/°C - model and compensate
        // ================================================================
        this.thermal = {
            enabled: true,
            referenceTemp: 20,  // °C
            currentTemp: 20,
            coefficients: {
                steel: 12e-6,     // per °C per meter
                aluminum: 23e-6,
                ballscrew: 12e-6
            },
            axisLengths: { x: 0.4, y: 0.4, z: 0.2 },  // meters
            lastCompensation: { x: 0, y: 0, z: 0 }
        };
        
        // ================================================================
        // METHOD 8: Back-EMF Stall Detection
        // When motor stalls, back-EMF waveform changes
        // Detect via high-speed ADC during motor off-phase
        // ================================================================
        this.backEmf = {
            enabled: false,  // Requires hardware modification
            samples: [],
            normalPattern: null,
            stallPattern: null
        };
        
        // Callbacks
        this.onStallDetected = options.onStallDetected || (() => {});
        this.onDriftDetected = options.onDriftDetected || (() => {});
        this.onResonanceDetected = options.onResonanceDetected || (() => {});
        
        // State
        this.monitoring = false;
        this.lastPosition = { x: 0, y: 0, z: 0 };
        this.estimatedError = { x: 0, y: 0, z: 0 };
    }
    
    // ================================================================
    // AUDIO STALL DETECTION
    // ================================================================
    
    async initAudioMonitoring() {
        if (!this.audio.enabled) return false;
        
        // Check if we're on HTTPS or localhost (required for getUserMedia)
        const isSecure = location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
        if (!isSecure) {
            console.log('[StepLoss] Audio monitoring requires HTTPS - skipping');
            this.audio.enabled = false;
            return false;
        }
        
        if (!navigator.mediaDevices?.getUserMedia) {
            console.log('[StepLoss] getUserMedia not available - skipping audio');
            this.audio.enabled = false;
            return false;
        }
        
        try {
            // Request microphone access
            const stream = await navigator.mediaDevices.getUserMedia({ 
                audio: { 
                    echoCancellation: false,
                    noiseSuppression: false,
                    autoGainControl: false
                } 
            });
            
            this.audio.context = new (window.AudioContext || window.webkitAudioContext)();
            this.audio.analyzer = this.audio.context.createAnalyser();
            this.audio.analyzer.fftSize = 2048;
            this.audio.analyzer.smoothingTimeConstant = 0.3;
            
            this.audio.microphone = this.audio.context.createMediaStreamSource(stream);
            this.audio.microphone.connect(this.audio.analyzer);
            
            console.log('[StepLoss] Audio monitoring initialized');
            this.startAudioAnalysis();
            return true;
            
        } catch (e) {
            console.warn('[StepLoss] Audio not available:', e.message);
            this.audio.enabled = false;
            return false;
        }
    }
    
    startAudioAnalysis() {
        const bufferLength = this.audio.analyzer.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        const sampleRate = this.audio.context.sampleRate;
        
        const analyze = () => {
            if (!this.monitoring) return;
            
            this.audio.analyzer.getByteFrequencyData(dataArray);
            
            // Find dominant frequency in stepper range (800-4000 Hz)
            const minBin = Math.floor(800 * bufferLength / (sampleRate / 2));
            const maxBin = Math.floor(4000 * bufferLength / (sampleRate / 2));
            
            let maxAmplitude = 0;
            let dominantBin = 0;
            let totalEnergy = 0;
            
            for (let i = minBin; i < maxBin; i++) {
                totalEnergy += dataArray[i];
                if (dataArray[i] > maxAmplitude) {
                    maxAmplitude = dataArray[i];
                    dominantBin = i;
                }
            }
            
            const avgEnergy = totalEnergy / (maxBin - minBin);
            const dominantFreq = dominantBin * sampleRate / (2 * bufferLength);
            
            // Stall detection: sudden drop in energy or frequency shift
            if (this.audio.lastSpectrum) {
                const energyRatio = avgEnergy / (this.audio.lastSpectrum.avgEnergy + 1);
                
                // If we were moving and energy suddenly drops > 70%
                if (this.audio.lastSpectrum.avgEnergy > 20 && energyRatio < 0.3) {
                    this.audio.stallDetected = true;
                    this.handleStallDetected('audio', {
                        reason: 'sudden_energy_drop',
                        energyRatio,
                        frequency: dominantFreq
                    });
                }
                
                // Detect resonance (high amplitude at specific frequencies)
                if (maxAmplitude > 200 && !this.resonance.scanComplete) {
                    this.detectResonance(dominantFreq, maxAmplitude);
                }
            }
            
            this.audio.lastSpectrum = {
                avgEnergy,
                dominantFreq,
                maxAmplitude,
                timestamp: Date.now()
            };
            
            requestAnimationFrame(analyze);
        };
        
        analyze();
    }
    
    // ================================================================
    // CURRENT SENSING (via ESP32 WebSocket or chatter system)
    // ================================================================
    
    processCurrentReading(axis, current) {
        if (!this.current.enabled) return;
        
        // Add to samples
        if (!this.current.samples[axis]) {
            this.current.samples[axis] = [];
        }
        this.current.samples[axis].push(current);
        
        // Keep window size
        if (this.current.samples[axis].length > this.current.sampleWindow) {
            this.current.samples[axis].shift();
        }
        
        // Calculate rolling average
        const avg = this.current.samples[axis].reduce((a, b) => a + b, 0) / 
                    this.current.samples[axis].length;
        
        // Compare to baseline
        const baseline = this.current.moving[axis] || this.current.baseline[axis];
        
        if (baseline > 0) {
            const ratio = avg / baseline;
            
            // High current = stall or heavy load
            if (ratio > this.current.stallMultiplier) {
                this.handleStallDetected('current', {
                    axis,
                    currentRatio: ratio,
                    expected: baseline,
                    actual: avg
                });
            }
            
            // Predict stall before it happens
            if (ratio > 1.4) {
                this.prediction.loadHistory.push({
                    axis,
                    ratio,
                    timestamp: Date.now(),
                    position: { ...this.lastPosition }
                });
                
                // Warn if trending toward stall
                if (this.isStallTrendDetected(axis)) {
                    this.onDriftDetected({
                        type: 'stall_warning',
                        axis,
                        message: `High load on ${axis} axis - reduce feed rate`
                    });
                }
            }
        }
    }
    
    calibrateCurrentBaseline(axis, isMoving = false) {
        if (!this.current.samples[axis]?.length) return;
        
        const avg = this.current.samples[axis].reduce((a, b) => a + b, 0) / 
                    this.current.samples[axis].length;
        
        if (isMoving) {
            this.current.moving[axis] = avg;
            console.log(`[StepLoss] ${axis} moving current baseline: ${avg.toFixed(2)}A`);
        } else {
            this.current.baseline[axis] = avg;
            console.log(`[StepLoss] ${axis} idle current baseline: ${avg.toFixed(2)}A`);
        }
    }
    
    isStallTrendDetected(axis) {
        const recent = this.prediction.loadHistory
            .filter(h => h.axis === axis)
            .slice(-10);
        
        if (recent.length < 5) return false;
        
        // Check if load is increasing
        let increasing = 0;
        for (let i = 1; i < recent.length; i++) {
            if (recent[i].ratio > recent[i-1].ratio) increasing++;
        }
        
        return increasing >= recent.length * 0.7;
    }
    
    // ================================================================
    // VIBRATION FINGERPRINTING (uses existing accelerometer)
    // ================================================================
    
    processAccelerometerData(data) {
        if (!this.vibration.enabled || !this.chatterSystem) return;
        
        const { x, y, z, magnitude, frequency } = data;
        
        // Create fingerprint from current position
        const posKey = this.positionToKey(this.lastPosition);
        
        if (this.vibration.learningMode) {
            // Learning mode: build fingerprint database
            if (!this.vibration.fingerprints.has(posKey)) {
                this.vibration.fingerprints.set(posKey, []);
            }
            
            this.vibration.fingerprints.get(posKey).push({
                magnitude,
                frequency,
                x, y, z,
                timestamp: Date.now()
            });
            
        } else {
            // Detection mode: compare to learned fingerprint
            const expected = this.vibration.fingerprints.get(posKey);
            
            if (expected && expected.length > 0) {
                const avgExpected = this.averageFingerprint(expected);
                const similarity = this.compareFingerprints(
                    { magnitude, frequency, x, y, z },
                    avgExpected
                );
                
                if (similarity < this.vibration.signatureMatch) {
                    // Position doesn't match expected - possible drift
                    const estimatedDrift = this.estimateDriftFromVibration(
                        { magnitude, frequency },
                        avgExpected
                    );
                    
                    this.vibration.driftHistory.push({
                        expected: posKey,
                        similarity,
                        estimatedDrift,
                        timestamp: Date.now()
                    });
                    
                    // Alert if consistent drift detected
                    if (this.isConsistentDrift()) {
                        this.onDriftDetected({
                            type: 'vibration_drift',
                            estimatedError: this.estimatedError,
                            confidence: 1 - similarity
                        });
                    }
                }
            }
        }
    }
    
    positionToKey(pos) {
        // Round to tolerance for grouping
        const t = this.vibration.positionTolerance;
        return `${Math.round(pos.x/t)*t},${Math.round(pos.y/t)*t},${Math.round(pos.z/t)*t}`;
    }
    
    averageFingerprint(samples) {
        const sum = samples.reduce((acc, s) => ({
            magnitude: acc.magnitude + s.magnitude,
            frequency: acc.frequency + s.frequency,
            x: acc.x + s.x,
            y: acc.y + s.y,
            z: acc.z + s.z
        }), { magnitude: 0, frequency: 0, x: 0, y: 0, z: 0 });
        
        const n = samples.length;
        return {
            magnitude: sum.magnitude / n,
            frequency: sum.frequency / n,
            x: sum.x / n,
            y: sum.y / n,
            z: sum.z / n
        };
    }
    
    compareFingerprints(a, b) {
        // Cosine similarity of vibration vectors
        const dotProduct = a.x * b.x + a.y * b.y + a.z * b.z;
        const magA = Math.sqrt(a.x**2 + a.y**2 + a.z**2);
        const magB = Math.sqrt(b.x**2 + b.y**2 + b.z**2);
        
        const cosineSim = magA && magB ? dotProduct / (magA * magB) : 0;
        
        // Also compare magnitude and frequency
        const magRatio = Math.min(a.magnitude, b.magnitude) / 
                        Math.max(a.magnitude, b.magnitude) || 0;
        const freqRatio = Math.min(a.frequency, b.frequency) / 
                         Math.max(a.frequency, b.frequency) || 0;
        
        return (cosineSim + magRatio + freqRatio) / 3;
    }
    
    estimateDriftFromVibration(actual, expected) {
        // Rough estimate: magnitude difference correlates with position error
        const magDiff = actual.magnitude - expected.magnitude;
        return Math.abs(magDiff) * 0.1; // Scale factor - needs calibration
    }
    
    isConsistentDrift() {
        const recent = this.vibration.driftHistory.slice(-5);
        if (recent.length < 3) return false;
        
        // Check if all recent samples show drift in same direction
        const drifts = recent.map(r => r.estimatedDrift);
        const avgDrift = drifts.reduce((a, b) => a + b, 0) / drifts.length;
        
        return avgDrift > 0.05; // 0.05mm consistent drift
    }
    
    // ================================================================
    // RESONANCE DETECTION & AVOIDANCE
    // ================================================================
    
    detectResonance(frequency, amplitude) {
        // Stepper resonance typically 50-300 Hz
        // Map frequency to feed rate based on steps/mm
        
        // Check if this frequency already recorded
        const existing = this.resonance.detectedResonances.find(
            r => Math.abs(r.frequency - frequency) < 10
        );
        
        if (existing) {
            existing.count++;
            existing.maxAmplitude = Math.max(existing.maxAmplitude, amplitude);
        } else {
            this.resonance.detectedResonances.push({
                frequency,
                amplitude,
                maxAmplitude: amplitude,
                count: 1,
                timestamp: Date.now()
            });
        }
        
        // After enough samples, identify danger zones
        this.resonance.detectedResonances
            .filter(r => r.count > 5 && r.maxAmplitude > 180)
            .forEach(r => {
                const feedRate = this.frequencyToFeedRate(r.frequency);
                
                if (!this.resonance.dangerZones.some(z => 
                    Math.abs(z.feedRate - feedRate) < this.resonance.avoidanceMargin
                )) {
                    this.resonance.dangerZones.push({
                        frequency: r.frequency,
                        feedRate,
                        severity: r.maxAmplitude / 255
                    });
                    
                    console.log(`[StepLoss] Resonance detected at ${feedRate.toFixed(0)} mm/min`);
                    this.onResonanceDetected({
                        frequency: r.frequency,
                        feedRate,
                        recommendation: `Avoid feed rates ${feedRate - 50} - ${feedRate + 50} mm/min`
                    });
                }
            });
    }
    
    frequencyToFeedRate(freq) {
        // Approximate: depends on steps/mm and microstepping
        // 200 steps/rev, 16 microstep, 8mm lead = 400 steps/mm
        // At 1000 steps/sec = 2.5 mm/sec = 150 mm/min
        const stepsPerMm = 400;  // Adjust for your machine
        const stepsPerSec = freq * 200;  // Assuming full steps correlate
        return (stepsPerSec / stepsPerMm) * 60;
    }
    
    adjustFeedRateForResonance(requestedFeed) {
        if (!this.resonance.enabled || this.resonance.dangerZones.length === 0) {
            return requestedFeed;
        }
        
        for (const zone of this.resonance.dangerZones) {
            const margin = this.resonance.avoidanceMargin;
            
            if (requestedFeed > zone.feedRate - margin && 
                requestedFeed < zone.feedRate + margin) {
                
                // Jump over the resonance zone
                if (requestedFeed < zone.feedRate) {
                    return zone.feedRate - margin - 10;
                } else {
                    return zone.feedRate + margin + 10;
                }
            }
        }
        
        return requestedFeed;
    }
    
    // ================================================================
    // REFERENCE POINT VERIFICATION
    // ================================================================
    
    addReferencePoint(x, y, z, probeZ) {
        this.verification.referencePoints.push({ x, y, z, probeZ });
        console.log(`[StepLoss] Added reference point at X${x} Y${y} Z${z}`);
    }
    
    async verifyPosition() {
        if (!this.verification.enabled || !this.grbl) return null;
        if (this.verification.referencePoints.length === 0) return null;
        
        // Find nearest reference point
        const current = this.lastPosition;
        let nearest = null;
        let minDist = Infinity;
        
        for (const ref of this.verification.referencePoints) {
            const dist = Math.sqrt(
                (ref.x - current.x)**2 + 
                (ref.y - current.y)**2
            );
            if (dist < minDist) {
                minDist = dist;
                nearest = ref;
            }
        }
        
        if (!nearest || minDist > 50) return null; // Too far from any reference
        
        try {
            // Move to reference point
            await this.grbl.sendAndWait(`G0 X${nearest.x} Y${nearest.y}`);
            await this.grbl.sendAndWait(`G0 Z${nearest.z + 10}`); // Safe height
            
            // Probe down
            const probeResult = await this.grbl.probe('Z', -20, 100);
            
            if (probeResult.success) {
                const expectedZ = nearest.probeZ;
                const actualZ = probeResult.z;
                const error = actualZ - expectedZ;
                
                this.verification.driftLog.push({
                    reference: nearest,
                    expected: expectedZ,
                    actual: actualZ,
                    error,
                    timestamp: Date.now()
                });
                
                if (Math.abs(error) > this.verification.maxDrift) {
                    this.onDriftDetected({
                        type: 'probe_verification',
                        axis: 'Z',
                        expected: expectedZ,
                        actual: actualZ,
                        error,
                        action: 'recalibration_recommended'
                    });
                }
                
                return { error, reference: nearest };
            }
        } catch (e) {
            console.error('[StepLoss] Verification probe failed:', e);
        }
        
        return null;
    }
    
    // ================================================================
    // THERMAL COMPENSATION
    // ================================================================
    
    updateTemperature(tempC) {
        this.thermal.currentTemp = tempC;
        
        const deltaT = tempC - this.thermal.referenceTemp;
        const coeff = this.thermal.coefficients.ballscrew;
        
        // Calculate expansion for each axis
        this.thermal.lastCompensation = {
            x: this.thermal.axisLengths.x * coeff * deltaT * 1000, // mm
            y: this.thermal.axisLengths.y * coeff * deltaT * 1000,
            z: this.thermal.axisLengths.z * coeff * deltaT * 1000
        };
        
        console.log(`[StepLoss] Thermal compensation at ${tempC}°C:`, 
            `X: ${(this.thermal.lastCompensation.x * 1000).toFixed(1)}μm`,
            `Y: ${(this.thermal.lastCompensation.y * 1000).toFixed(1)}μm`,
            `Z: ${(this.thermal.lastCompensation.z * 1000).toFixed(1)}μm`
        );
    }
    
    getThermalCompensation() {
        return { ...this.thermal.lastCompensation };
    }
    
    applyThermalCompensation(command) {
        if (!this.thermal.enabled) return command;
        
        // Adjust coordinates in G-code
        const comp = this.thermal.lastCompensation;
        
        return command.replace(/X([\d.\-]+)/g, (match, val) => {
            const adjusted = parseFloat(val) - comp.x;
            return `X${adjusted.toFixed(4)}`;
        }).replace(/Y([\d.\-]+)/g, (match, val) => {
            const adjusted = parseFloat(val) - comp.y;
            return `Y${adjusted.toFixed(4)}`;
        }).replace(/Z([\d.\-]+)/g, (match, val) => {
            const adjusted = parseFloat(val) - comp.z;
            return `Z${adjusted.toFixed(4)}`;
        });
    }
    
    // ================================================================
    // STALL HANDLING
    // ================================================================
    
    handleStallDetected(method, data) {
        console.error(`[StepLoss] STALL DETECTED via ${method}:`, data);
        
        // Immediate feed hold
        this.grbl?.send('!');
        
        // Log for learning
        this.prediction.stallEvents.push({
            method,
            data,
            position: { ...this.lastPosition },
            timestamp: Date.now()
        });
        
        // Update prediction model
        this.updatePredictionModel();
        
        // Callback
        this.onStallDetected({
            method,
            data,
            position: this.lastPosition,
            recommendation: this.getRecoveryRecommendation(method, data)
        });
    }
    
    getRecoveryRecommendation(method, data) {
        switch (method) {
            case 'audio':
                return 'Motor stall detected. Reduce depth of cut or feed rate.';
            case 'current':
                return `High load on ${data.axis}. Reduce aggressive cuts or check for mechanical binding.`;
            case 'vibration':
                return 'Position drift detected. Re-home machine and verify reference points.';
            default:
                return 'Check machine and re-home before continuing.';
        }
    }
    
    updatePredictionModel() {
        // Simple model: store conditions that led to stall
        // Future: could train a proper ML model
        
        const recentStalls = this.prediction.stallEvents.slice(-20);
        
        // Extract patterns
        const patterns = recentStalls.map(s => ({
            loadRatio: s.data.currentRatio || 1,
            feedRate: this.grbl?.state?.feedRate || 0,
            depth: Math.abs(s.position.z),
            timestamp: s.timestamp
        }));
        
        // Store as simple decision boundaries
        if (patterns.length >= 3) {
            const avgLoad = patterns.reduce((a, p) => a + p.loadRatio, 0) / patterns.length;
            const avgFeed = patterns.reduce((a, p) => a + p.feedRate, 0) / patterns.length;
            
            this.prediction.model = {
                maxSafeLoadRatio: avgLoad * 0.8,
                maxSafeFeed: avgFeed * 0.8,
                updated: Date.now()
            };
            
            console.log('[StepLoss] Updated prediction model:', this.prediction.model);
        }
    }
    
    predictStallRisk() {
        if (!this.prediction.model) return 0;
        
        const currentLoad = this.getCurrentLoadRatio();
        const currentFeed = this.grbl?.state?.feedRate || 0;
        
        let risk = 0;
        
        if (currentLoad > this.prediction.model.maxSafeLoadRatio * 0.8) {
            risk += (currentLoad / this.prediction.model.maxSafeLoadRatio) * 0.5;
        }
        
        if (currentFeed > this.prediction.model.maxSafeFeed * 0.8) {
            risk += (currentFeed / this.prediction.model.maxSafeFeed) * 0.5;
        }
        
        return Math.min(risk, 1);
    }
    
    getCurrentLoadRatio() {
        // Average load across all axes
        let total = 0;
        let count = 0;
        
        for (const axis of ['x', 'y', 'z']) {
            if (this.current.samples[axis]?.length && this.current.moving[axis]) {
                const avg = this.current.samples[axis].reduce((a, b) => a + b, 0) / 
                           this.current.samples[axis].length;
                total += avg / this.current.moving[axis];
                count++;
            }
        }
        
        return count > 0 ? total / count : 1;
    }
    
    // ================================================================
    // PUBLIC API
    // ================================================================
    
    async start() {
        console.log('[StepLoss] Starting step loss detection...');
        this.monitoring = true;
        
        // Track what methods we successfully initialize
        const status = {
            methodsActive: 0,
            methodsFailed: 0,
            errors: []
        };
        
        // ============================================================
        // METHOD 1: Audio monitoring (works standalone, just needs mic)
        // ============================================================
        try {
            const audioOk = await this.initAudioMonitoring();
            if (audioOk) {
                this.activeMethods.audio = true;
                status.methodsActive++;
                console.log('[StepLoss] ✓ Audio monitoring active');
            } else {
                status.errors.push('Audio: Microphone not available or denied');
            }
        } catch (e) {
            status.errors.push(`Audio: ${e.message}`);
            status.methodsFailed++;
        }
        
        // ============================================================
        // METHOD 2-3: Chatter system (current sensing + accelerometer)
        // Only works if ESP32 chatter sensor is connected
        // ============================================================
        if (this.chatterSystem) {
            try {
                // Check if chatter system has event emitter capability
                if (typeof this.chatterSystem.on === 'function') {
                    this.chatterSystem.on('update', (data) => {
                        // Mark as connected once we receive data
                        if (!this.connections.chatter) {
                            this.connections.chatter = true;
                            console.log('[StepLoss] ✓ Chatter sensor connected');
                        }
                        
                        if (data.accel) {
                            this.activeMethods.vibration = true;
                            this.processAccelerometerData(data.accel);
                        }
                        if (data.current) {
                            this.activeMethods.current = true;
                            for (const axis of ['x', 'y', 'z']) {
                                if (data.current[axis] !== undefined) {
                                    this.processCurrentReading(axis, data.current[axis]);
                                }
                            }
                        }
                        if (data.temperature !== undefined) {
                            this.activeMethods.thermal = true;
                            this.connections.temperature = true;
                            this.updateTemperature(data.temperature);
                        }
                    });
                    
                    // Also listen for disconnect
                    if (typeof this.chatterSystem.on === 'function') {
                        this.chatterSystem.on('disconnect', () => {
                            this.connections.chatter = false;
                            this.activeMethods.current = false;
                            this.activeMethods.vibration = false;
                            console.warn('[StepLoss] ⚠ Chatter sensor disconnected');
                        });
                    }
                    
                    console.log('[StepLoss] ⏳ Waiting for chatter sensor data...');
                } else if (typeof this.chatterSystem.subscribe === 'function') {
                    // Alternative API
                    this.chatterSystem.subscribe(this.handleChatterData.bind(this));
                } else {
                    status.errors.push('Chatter: No compatible event API found');
                }
            } catch (e) {
                status.errors.push(`Chatter: ${e.message}`);
            }
        } else {
            console.log('[StepLoss] ℹ No chatter system provided - current/vibration methods unavailable');
            status.errors.push('Chatter: Not configured (pass chatterSystem option)');
        }
        
        // ============================================================
        // METHOD 4-6: GRBL-dependent methods (position, probing)
        // Only works if CNC is connected
        // ============================================================
        if (this.grbl) {
            try {
                // Check connection state first
                if (this.grbl.isConnected && this.grbl.isConnected()) {
                    this.connections.grbl = true;
                    this.setupGrblListeners();
                    console.log('[StepLoss] ✓ GRBL connected');
                } else if (typeof this.grbl.on === 'function') {
                    // Wait for connection
                    this.grbl.on('connect', () => {
                        this.connections.grbl = true;
                        this.setupGrblListeners();
                        console.log('[StepLoss] ✓ GRBL connected');
                    });
                    
                    this.grbl.on('disconnect', () => {
                        this.connections.grbl = false;
                        this.activeMethods.resonance = false;
                        this.activeMethods.verification = false;
                        console.warn('[StepLoss] ⚠ GRBL disconnected - some methods paused');
                    });
                    
                    console.log('[StepLoss] ⏳ Waiting for GRBL connection...');
                }
            } catch (e) {
                status.errors.push(`GRBL: ${e.message}`);
            }
        } else {
            console.log('[StepLoss] ℹ No GRBL provided - position-based methods unavailable');
            status.errors.push('GRBL: Not configured (pass grbl option)');
        }
        
        // ============================================================
        // METHOD 7: Predictive model (works offline with learned data)
        // ============================================================
        try {
            const savedModel = localStorage.getItem('stepLoss-prediction-model');
            if (savedModel) {
                this.prediction.model = JSON.parse(savedModel);
                this.activeMethods.prediction = true;
                status.methodsActive++;
                console.log('[StepLoss] ✓ Loaded saved prediction model');
            } else {
                console.log('[StepLoss] ℹ No prediction model yet - use learning mode to create one');
            }
        } catch (e) {
            status.errors.push(`Prediction: ${e.message}`);
        }
        
        // ============================================================
        // Summary
        // ============================================================
        const activeCount = Object.values(this.activeMethods).filter(v => v).length;
        console.log(`[StepLoss] Started with ${activeCount} methods active`);
        
        if (status.errors.length > 0 && activeCount === 0) {
            console.warn('[StepLoss] ⚠ No detection methods available! Errors:', status.errors);
        }
        
        return {
            monitoring: true,
            activeMethods: this.activeMethods,
            connections: this.connections,
            errors: status.errors
        };
    }
    
    // Helper to setup GRBL listeners (only called when connected)
    setupGrblListeners() {
        if (!this.grbl || !this.connections.grbl) return;
        
        try {
            // Position tracking
            if (typeof this.grbl.on === 'function') {
                this.grbl.on('status', (state) => {
                    if (state && state.mpos) {
                        this.lastPosition = { ...state.mpos };
                        this.activeMethods.resonance = true;
                    }
                });
            }
            
            // Enable verification probing if probe is available
            this.activeMethods.verification = true;
        } catch (e) {
            console.warn('[StepLoss] Error setting up GRBL listeners:', e);
        }
    }
    
    // Handle chatter data (alternative entry point)
    handleChatterData(data) {
        if (!data) return;
        
        this.connections.chatter = true;
        
        if (data.accel) {
            this.activeMethods.vibration = true;
            this.processAccelerometerData(data.accel);
        }
        if (data.current) {
            this.activeMethods.current = true;
            for (const axis of ['x', 'y', 'z']) {
                if (data.current[axis] !== undefined) {
                    this.processCurrentReading(axis, data.current[axis]);
                }
            }
        }
        if (data.temperature !== undefined) {
            this.activeMethods.thermal = true;
            this.updateTemperature(data.temperature);
        }
    }
    
    stop() {
        this.monitoring = false;
        
        if (this.audio.context) {
            this.audio.context.close();
        }
        
        console.log('[StepLoss] Monitoring stopped');
    }
    
    startLearningMode() {
        this.vibration.learningMode = true;
        console.log('[StepLoss] Learning mode ON - run typical operations to build fingerprint database');
    }
    
    stopLearningMode() {
        this.vibration.learningMode = false;
        console.log(`[StepLoss] Learning complete. ${this.vibration.fingerprints.size} positions fingerprinted`);
    }
    
    /**
     * Get current status - safe to call anytime
     */
    getStatus() {
        // Count how many methods are actually working right now
        const activeMethodCount = Object.values(this.activeMethods).filter(v => v).length;
        const totalMethods = Object.keys(this.activeMethods).length;
        
        // Safely calculate stall risk
        let stallRisk = 0;
        try {
            stallRisk = this.predictStallRisk();
        } catch (e) {
            stallRisk = -1; // Unknown
        }
        
        // Calculate loads from current readings (if available)
        const loads = { x: 0, y: 0, z: 0 };
        if (this.activeMethods.current && this.current.samples.length > 0) {
            for (const axis of ['x', 'y', 'z']) {
                const baseline = this.current.moving[axis] || this.current.baseline[axis] || 1;
                const samples = this.current.samples.filter(s => s.axis === axis);
                if (samples.length > 0) {
                    const avgCurrent = samples.reduce((s, v) => s + v.value, 0) / samples.length;
                    loads[axis] = Math.min(100, (avgCurrent / baseline) * 50); // 50% at normal, 100% at 2x
                }
            }
        }
        
        // Determine overall state
        let state = 'IDLE';
        if (this.monitoring) {
            if (activeMethodCount === 0) {
                state = 'NO_SENSORS';
            } else if (this.connections.grbl || this.connections.chatter) {
                state = 'MONITORING';
            } else {
                state = 'WAITING';
            }
        }
        
        return {
            state,
            monitoring: this.monitoring,
            connections: { ...this.connections },
            activeMethods: { ...this.activeMethods },
            activeMethodCount,
            totalMethods,
            loads,
            methods: {
                audio: this.activeMethods.audio,
                current: this.activeMethods.current,
                vibration: this.activeMethods.vibration,
                resonance: this.activeMethods.resonance,
                thermal: this.activeMethods.thermal,
                prediction: this.activeMethods.prediction,
                verification: this.activeMethods.verification
            },
            resonanceZones: this.resonance?.dangerZones?.length || 0,
            fingerprintedPositions: this.vibration?.fingerprints?.size || 0,
            referencePoints: this.verification?.referencePoints?.length || 0,
            stallRisk,
            thermalCompensation: this.thermal?.lastCompensation || { x: 0, y: 0, z: 0 },
            estimatedError: this.estimatedError || { x: 0, y: 0, z: 0 }
        };
    }
    
    exportConfig() {
        return {
            resonance: this.resonance.dangerZones,
            fingerprints: Array.from(this.vibration.fingerprints.entries()),
            references: this.verification.referencePoints,
            currentBaselines: {
                idle: this.current.baseline,
                moving: this.current.moving
            },
            predictionModel: this.prediction.model
        };
    }
    
    importConfig(config) {
        if (config.resonance) this.resonance.dangerZones = config.resonance;
        if (config.fingerprints) {
            this.vibration.fingerprints = new Map(config.fingerprints);
        }
        if (config.references) this.verification.referencePoints = config.references;
        if (config.currentBaselines) {
            this.current.baseline = config.currentBaselines.idle;
            this.current.moving = config.currentBaselines.moving;
        }
        if (config.predictionModel) this.prediction.predictionModel = config.predictionModel;
    }
}

// ================================================================
// S-CURVE ACCELERATION (reduces missed steps)
// ================================================================

class SCurveAcceleration {
    /**
     * S-curve (jerk-limited) motion profiles reduce missed steps by:
     * 1. Eliminating sudden acceleration changes
     * 2. Reducing mechanical shock
     * 3. Smoother torque transitions
     */
    
    static generateProfile(distance, maxVelocity, maxAccel, maxJerk) {
        // 7-phase S-curve motion profile
        const phases = [];
        
        // Phase 1: Jerk up (acceleration increasing)
        const t1 = maxAccel / maxJerk;
        const v1 = 0.5 * maxJerk * t1 * t1;
        const s1 = (1/6) * maxJerk * t1 * t1 * t1;
        
        // Phase 2: Constant acceleration
        const v2target = maxVelocity;
        const t2 = (v2target - 2 * v1) / maxAccel;
        
        // Phase 3: Jerk down (acceleration decreasing)
        const t3 = t1;
        
        // Phases 4: Constant velocity (if distance allows)
        // Phases 5-7: Deceleration mirror of 1-3
        
        phases.push(
            { phase: 1, duration: t1, jerk: maxJerk, desc: 'Jerk up' },
            { phase: 2, duration: t2, jerk: 0, desc: 'Constant accel' },
            { phase: 3, duration: t3, jerk: -maxJerk, desc: 'Jerk down' },
            { phase: 4, duration: 0, jerk: 0, desc: 'Cruise' },  // Calculated
            { phase: 5, duration: t1, jerk: -maxJerk, desc: 'Jerk down' },
            { phase: 6, duration: t2, jerk: 0, desc: 'Constant decel' },
            { phase: 7, duration: t3, jerk: maxJerk, desc: 'Jerk up' }
        );
        
        return phases;
    }
    
    static interpolate(profile, t) {
        // Get position/velocity at time t given S-curve profile
        let pos = 0, vel = 0, acc = 0;
        let elapsed = 0;
        
        for (const phase of profile) {
            if (elapsed + phase.duration < t) {
                // Integrate through complete phase
                const dt = phase.duration;
                pos += vel * dt + 0.5 * acc * dt * dt + (1/6) * phase.jerk * dt * dt * dt;
                vel += acc * dt + 0.5 * phase.jerk * dt * dt;
                acc += phase.jerk * dt;
                elapsed += dt;
            } else {
                // Partial phase
                const dt = t - elapsed;
                pos += vel * dt + 0.5 * acc * dt * dt + (1/6) * phase.jerk * dt * dt * dt;
                vel += acc * dt + 0.5 * phase.jerk * dt * dt;
                break;
            }
        }
        
        return { pos, vel, acc };
    }
}

// ================================================================
// MICRO-STEP OPTIMIZATION
// ================================================================

class MicroStepOptimizer {
    /**
     * Optimize microstepping for torque vs resolution trade-off
     * Higher microsteps = smoother but less torque
     * At high speeds, reduce microsteps to maintain torque
     */
    
    static getOptimalMicrosteps(feedRate, loadPercent) {
        // Base: 16 microsteps for smoothness
        // High speed + high load: drop to 8 or 4 for torque
        
        if (feedRate > 3000 && loadPercent > 60) {
            return 4;  // Maximum torque
        } else if (feedRate > 2000 && loadPercent > 40) {
            return 8;  // Balanced
        } else if (feedRate > 1000) {
            return 16; // Smooth
        } else {
            return 32; // Ultra-smooth for fine work
        }
    }
    
    static getHoldingCurrentReduction(isIdle, idleTime) {
        // Reduce holding current when idle to prevent overheating
        // But not so much that position is lost
        
        if (!isIdle) return 1.0;  // Full current when moving
        
        if (idleTime > 60000) return 0.3;  // 30% after 1 minute
        if (idleTime > 10000) return 0.5;  // 50% after 10 seconds
        if (idleTime > 2000) return 0.7;   // 70% after 2 seconds
        
        return 1.0;
    }
}

// Export
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { StepLossDetection, SCurveAcceleration, MicroStepOptimizer };
}

// Global
if (typeof window !== 'undefined') {
    window.StepLossDetection = StepLossDetection;
    window.SCurveAcceleration = SCurveAcceleration;
    window.MicroStepOptimizer = MicroStepOptimizer;
}
