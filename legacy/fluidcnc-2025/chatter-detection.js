/**
 * CNC Chatter Detection System - FluidCNC Web UI Module
 * Connects to Waveshare ESP32-S3 Touch LCD 1.46B via USB Serial or WebSocket
 * 
 * HARDWARE: Waveshare ESP32-S3 Touch LCD 1.46B with:
 *   - QMI8658C 6-axis IMU (3-axis gyro + 3-axis accelerometer for vibration)
 *   - Onboard digital microphone (audio chatter detection)
 *   - Onboard speaker (audio alerts)
 *   - 1.46" 412x412 round touch LCD (displays status)
 *   - USB Type-C (primary connection via Web Serial API)
 *   - WiFi/Bluetooth (optional WebSocket connection)
 *   - Optional: External current sensor for spindle load
 *   - Optional: VFD RS-485 Modbus connection
 * 
 * CONNECTION MODES:
 *   1. USB Serial (recommended) - Direct USB connection via Web Serial API
 *   2. WebSocket - WiFi connection to ESP32 access point or network
 *   3. Serial Passthrough - Via grblHAL USB (legacy)
 * 
 * INTELLIGENT FEATURES:
 * - Adaptive thresholds (learns your machine)
 * - Trend detection (catches rising chatter early)
 * - Hysteresis (prevents oscillation)
 * - Smart recovery (remembers stable feed rates)
 * - Multiple operating modes
 * - MATERIAL-AWARE: Different profiles for aluminum, steel, plastic, etc.
 * - Asks about material, tool, and operation BECAUSE IT MATTERS
 * - G-CODE INTEGRATION: Auto-detects from comments!
 * - PREDICTIVE WARNINGS: Knows when chatter is building
 */

class ChatterDetection {
    constructor(options = {}) {
        // Get saved IP or use default (should match your network)
        const savedIp = localStorage.getItem('chatterEspIp');
        const defaultIp = savedIp || '192.168.0.100';  // Default to common subnet
        this.wsUrl = options.wsUrl || `ws://${defaultIp}/ws`;
        this.ws = null;
        this.connected = false;
        this.autoConnect = options.autoConnect !== undefined ? options.autoConnect : false; // Disabled by default
        this.reconnectInterval = 5000;
        this.reconnectBaseInterval = 5000;  // Base reconnect delay
        this.reconnectMaxInterval = 60000;  // Max 60 seconds between attempts
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 3;      // Only try 3 times then give up quietly
        this.reconnectTimer = null;
        this.pingInterval = null;
        
        // Temperature warning flags
        this._tempWarningShown = false;
        this._tempCriticalShown = false;
        
        // USB Serial connection (Web Serial API)
        this.serialPort = null;
        this.serialReader = null;
        this.serialWriter = null;
        this.serialBuffer = '';
        this.serialMode = false;  // true when connected via USB serial
        
        // Materials list (populated from ESP32)
        this.materials = ['aluminum', 'steel', 'plastic', 'wood', 'brass', 'composite', 'copper'];
        this.operations = ['roughing', 'finishing', 'drilling', 'slotting'];
        
        // Audio alerts
        this.audioEnabled = localStorage.getItem('chatterAudioEnabled') !== 'false';
        this.audioContext = null;
        this.lastChatterAlert = 0;
        this.alertCooldown = 3000;  // Don't spam alerts
        
        // G-code integration
        this.gcodeParser = options.gcodeParser || null;
        this.autoDetectedSettings = null;
        
        // Prediction
        this.predictionHistory = [];
        this.predictionWindow = 10;  // Samples to analyze

        // Diagnostics UI
        this.diagModalOpen = false;
        
        // State (with intelligent features)
        this.state = {
            // Sensor scores
            audio: 0,
            accel: 0,
            current: 0,
            combined: 0,
            
            // EMA smoothed scores (new!)
            emaAudio: 0,
            emaAccel: 0,
            emaCurrent: 0,
            emaCombined: 0,
            
            // Current/power
            amps: 0,
            baseline: 2.0,
            freq: 0,
            toothFreq: 0,
            
            // Frequency bands (new!)
            lowBand: 0,
            midBand: 0,
            highBand: 0,
            
            // Harmonics (new!)
            harmonics: false,
            harmonicRatio: 0,
            
            // Feed control
            feed: 100,
            lastStable: 100,
            minFeed: 20,
            
            // Flags
            enabled: true,
            chatter: false,
            inChatterZone: false,
            toolBroken: false,
            toolBrokenConfidence: 0,  // NEW: Confidence level 0-100%
            overload: false,
            learning: false,
            calibrating: false,
            
            // BROKEN ENDMILL DETECTION (IMPROVED!)
            // Detects THREE scenarios:
            // 1. Plunge with no load (tool already broken)
            // 2. Cutting moves with no load (at cutting depth but no sound)
            // 3. Sudden silence mid-cut (tool broke while cutting)
            brokenEndmillDetection: {
                enabled: true,
                // Cutting confirmation
                lastCuttingAudio: 0,       // Audio level when last confirmed cutting
                lastCuttingAmps: 0,        // Current when last confirmed cutting
                cuttingConfirmedAt: 0,     // Timestamp when cutting was confirmed
                wasConfirmedCutting: false, // Were we definitely cutting before?
                
                // Silence detection (scenario 3)
                silenceStartedAt: 0,       // When audio dropped to idle
                silenceDuration: 0,        // How long silence has lasted (ms)
                silenceThresholdMs: 400,   // Alert after 400ms of no-load while cutting
                audioDropThreshold: 0.6,   // Audio must drop by 60% to trigger
                ampsDropThreshold: 0.5,    // Current must drop by 50% to trigger
                
                // No-load detection (scenario 2)
                noLoadStartedAt: 0,        // When no-load started at cutting depth
                noLoadDuration: 0,         // How long no-load has lasted
                
                // Plunge detection (scenario 1)
                plungeStartedAt: 0,        // When plunge started
                plungeNoLoadWarned: false, // Already warned about plunge no-load
                
                // Z tracking
                lastZ: undefined,          // Last Z position for delta tracking
                safeZ: 2.0,                // Z above this = retracted (configurable)
                minCuttingAudio: 0.12,     // Minimum audio level to consider "cutting"
                
                // BREAK RECOVERY (NEW!)
                // Track where the tool broke so we can resume
                breakInfo: null            // { lineNumber, gcodeLine, position, timestamp, toolNumber }
            },
            
            // TOOL BREAK RECOVERY (NEW!)
            // Enables automatic resume after tool change
            breakRecovery: {
                enabled: true,
                lineNumber: 0,             // G-code line where break occurred
                gcodeLine: '',             // Actual G-code that was running
                position: { x: 0, y: 0, z: 0 },  // Position at break
                timestamp: 0,              // When it happened
                toolNumber: 0,             // Which tool broke
                rewindLines: 5,            // How many lines to rewind before resuming
                canResume: false,          // Is resume available?
                spareToolFound: false,     // Did we find a spare?
                spareToolNumber: null      // Spare tool slot number
            },
            
            // Intelligence
            trend: 0,
            threshold: 0.55,
            noiseFloor: 0.05,
            recoveryAttempts: 0,
            stableCount: 0,
            mode: 0,
            
            // IMPROVED CHATTER DETECTION (ENHANCED!)
            // Multi-band frequency analysis for better accuracy
            chatterAnalysis: {
                // Audio history for pattern detection
                audioHistory: [],
                audioHistoryMax: 50,  // ~2.5 seconds at 20Hz
                
                // Pattern recognition
                isResonant: false,       // Sustained single frequency = resonance
                isIntermittent: false,   // On-off pattern = tool rubbing
                isProgressive: false,    // Getting worse = need immediate action
                
                // Harmonic detection
                fundamentalFreq: 0,      // Primary chatter frequency
                harmonicStrength: 0,     // How strong are harmonics (0-1)
                toothPassFreq: 0,        // Expected: RPM/60 * flutes
                
                // Score components (for debugging)
                audioScore: 0,
                accelScore: 0,
                harmonicScore: 0,
                trendScore: 0,
                
                // Thresholds (material-dependent)
                audioThreshold: 0.35,    // Base audio threshold
                accelThreshold: 0.40,    // Base accel threshold
                
                // Confidence in chatter detection
                chatterConfidence: 0     // 0-100%
            },
            
            // ADVANCED AI CHATTER ANALYSIS (NEW!)
            aiChatter: {
                // Load profiling - learn what "normal" looks like
                loadProfile: {
                    enabled: true,
                    samples: [],           // Recent load samples for learning
                    maxSamples: 500,       // ~25 seconds of history
                    baseline: 0,           // Learned baseline load
                    stdDev: 0,             // Learned standard deviation
                    isLearned: false,      // Have we learned enough?
                    anomalyThreshold: 3.0  // Std devs from baseline = anomaly
                },
                
                // Frequency shift detection - chatter frequency changing = tool wear
                freqShift: {
                    enabled: true,
                    lastFreq: 0,           // Last dominant frequency
                    freqHistory: [],       // Frequency over time
                    shiftRate: 0,          // Hz/second shift rate
                    isShifting: false,     // Frequency drifting?
                    shiftWarned: false     // Already warned?
                },
                
                // Spike detection - sudden anomalies vs gradual increase
                spikeDetection: {
                    enabled: true,
                    lastValue: 0,
                    spikeThreshold: 0.3,   // Jump of 0.3 in one sample = spike
                    spikeCount: 0,         // Recent spike count
                    spikeWindow: 20,       // Samples to count spikes in
                    spikeHistory: []       // Recent spike flags
                },
                
                // Tool wear estimation from audio signature
                toolWearAudio: {
                    enabled: true,
                    initialSignature: null,  // Audio profile when tool was new
                    currentSignature: null,  // Current audio profile
                    wearEstimate: 0,         // 0-100% wear estimate
                    signatureShift: 0        // How much has signature changed?
                },
                
                // Cutting efficiency - are we removing material effectively?
                efficiency: {
                    enabled: true,
                    mrr: 0,                // Material removal rate estimate
                    expectedMrr: 0,        // What MRR should be for these params
                    efficiencyPercent: 100,// Actual vs expected
                    trend: 0               // Efficiency trend over time
                },
                
                // Stability lobe prediction
                stabilityLobe: {
                    enabled: true,
                    currentRpm: 0,
                    optimalRpm: 0,         // Suggested RPM for stability
                    lobePosition: 'unknown', // 'stable', 'boundary', 'unstable'
                    suggestedChange: 0     // Suggested RPM change (+/-)
                },
                
                // VFD Auto-Adjust - automatic spindle speed correction
                vfdAutoAdjust: {
                    enabled: false,        // DISABLED by default for safety
                    mode: 'suggest',       // 'suggest', 'confirm', 'auto'
                    maxAdjustPercent: 15,  // Max RPM change (safety limit)
                    minRpm: 3000,          // Don't go below this
                    maxRpm: 24000,         // Don't go above this
                    cooldownMs: 5000,      // Wait between adjustments
                    lastAdjust: 0,         // Timestamp of last adjustment
                    adjustCount: 0         // Number of auto-adjustments this session
                }
            },
            
            // Advanced detection (new!)
            confidence: 0,
            variance: 0,
            delta: 0,
            predicted: 0,
            ticksToChatter: -1,
            risingChatter: false,
            stableChatter: false,
            intermittent: false,
            
            // Position (new!)
            posX: 0,
            posY: 0,
            posZ: 0,
            
            // Weights
            wAudio: 0.30,
            wAccel: 0.40,
            wCurrent: 0.30,
            
            // Material/tool info (MATTERS!)
            material: 'aluminum',
            materialIndex: 0,
            operation: 0,
            toolDia: 6.0,
            toolFlutes: 2,
            rpm: 10000,
            expectedAmpsLow: 1.5,
            expectedAmpsHigh: 6.0,
            
            // Spindle state
            spindleRunning: false,
            cutting: false,
            idleCurrent: 0.5,
            
            // Cutting efficiency (NEW!)
            efficiency: 0,
            bestFeed: 100,
            
            // Tool wear tracking (NEW!)
            toolWear: 0,           // Estimated wear 0-100%
            cumulativeLoad: 0,     // Sum of amps*time
            cuttingSeconds: 0,     // Total cutting time
            avgLoadCurrent: 0,     // Average load during cutting
            
            // Session statistics (NEW!)
            sessionStart: Date.now(),
            sessionChatterEvents: 0,
            sessionMaxScore: 0,
            sessionAvgScore: 0,
            sessionFeedReductions: 0,
            sessionRecoveries: 0,
            totalSamples: 0,
            
            // VFD telemetry (NEW! - from RS-485 Modbus)
            vfd: {
                ok: false,          // VFD Modbus connected
                run: false,         // Spindle running (from VFD)
                freq: 0,            // Output frequency (Hz)
                rpm: 0,             // Calculated RPM from VFD
                amps: 0,            // VFD output current (A)
                dcv: 0,             // DC bus voltage (V)
                fault: 0,           // Fault code (0 = none)
                faultStr: ''        // Human-readable fault
            },
            
            // Sensor health status (NEW!)
            sensors: {
                mpuOk: true,        // Accelerometer OK
                mpuErr: 0,          // Error code
                mpuErrStr: 'OK',    // Error string
                i2sOk: true,        // Microphone OK
                i2sErr: 0,
                i2sErrStr: 'OK',
                adcOk: true,        // Current sensor OK
                adcErr: 0,
                adcErrStr: 'OK',
                vfdOk: undefined,   // VFD OK (undefined = not enabled)
                vfdErr: 0,
                vfdErrStr: 'OK',
                vfdFault: null,     // VFD fault string if any
                allOk: true         // All sensors OK
            }
        };
        
        // Tool wear tracking
        this._toolWearStart = null;
        this._lastCuttingCheck = Date.now();
        this._cuttingLoadSum = 0;
        this._cuttingLoadCount = 0;
        
        // Session tracking
        this._sessionScoreSum = 0;
        this._sessionScoreCount = 0;
        this._lastFeed = 100;
        this._sessionLastChatter = false;
        
        // Alert state tracking (for edge detection)
        this._lastInChatterZone = false;
        this._lastToolBroken = false;
        this._lastOverload = false;
        
        // SAFETY: Data watchdog to detect stale/frozen sensor data
        this._lastDataTime = 0;
        this._sensorFailureLogged = false;
        this._watchdogInterval = null;
        
        // Callbacks
        this.onUpdate = options.onUpdate || (() => {});
        this.onConnect = options.onConnect || (() => {});
        this.onDisconnect = options.onDisconnect || (() => {});
        this.onAlert = options.onAlert || (() => {});
        
        // History for graphs
        this.history = {
            combined: [],
            amps: [],
            feed: [],
            trend: [],
            maxLength: 200  // ~10 seconds at 20Hz
        };
        
        // Create UI
        this.createUI();
        
        // Load saved IP and update UI (savedIp already loaded at constructor top)
        const ipInput = document.getElementById('chatter-ip');
        if (ipInput && localStorage.getItem('chatterEspIp')) {
            ipInput.value = localStorage.getItem('chatterEspIp');
            this.autoConnect = true;  // If user saved an IP, they want it connected
        }
        
        // Setup keyboard shortcuts
        this.setupKeyboardShortcuts();
        
        // SAFETY: Start watchdog timer to detect stale sensor data
        this._startWatchdog();
        
        // Only connect if autoConnect is enabled (user has configured an IP)
        if (this.autoConnect) {
            this.connect();
        } else {
            console.log('[Chatter] ESP32 not configured - enable in settings if you have chatter detection hardware');
        }
    }
    
    /**
     * SAFETY: Watchdog timer to detect if sensor data stops arriving
     * If no data for 3 seconds while connected, treat as frozen connection
     */
    _startWatchdog() {
        this._watchdogInterval = setInterval(() => {
            if (!this.connected) return;
            
            const now = Date.now();
            const timeSinceData = now - this._lastDataTime;
            
            // If connected but no data for 3 seconds, consider it stale
            if (this._lastDataTime > 0 && timeSinceData > 3000) {
                console.error('[SAFETY] Watchdog: No sensor data for 3+ seconds - connection may be frozen');
                
                // Reset feed override for safety
                if (window.app?.enhancements?.resetFeedOverride) {
                    window.app.enhancements.resetFeedOverride();
                }
                
                // Show stale data warning in UI
                const statusEl = document.getElementById('chatter-status-text');
                if (statusEl) {
                    statusEl.textContent = '⚠️ STALE DATA';
                    statusEl.className = 'combined-status danger';
                }
                
                // Mark as disconnected if over 10 seconds
                if (timeSinceData > 10000) {
                    console.warn('[SAFETY] Watchdog: No data for 10+ seconds, treating as disconnected');
                    this.handleDisconnect();
                }
            }
        }, 1000);  // Check every second
    }
    
    // Keyboard shortcuts for quick actions
    setupKeyboardShortcuts() {
        document.addEventListener('keydown', (e) => {
            // Only when not typing in an input
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
            
            // Alt+C: Toggle chatter panel visibility
            if (e.altKey && e.key === 'c') {
                e.preventDefault();
                this.togglePanel();
            }
            // Alt+E: Enable/disable detection
            else if (e.altKey && e.key === 'e') {
                e.preventDefault();
                this.toggle();
            }
            // Alt+D: Show diagnostics
            else if (e.altKey && e.key === 'd') {
                e.preventDefault();
                this.showDiagnostics();
            }
            // Alt+R: Reset alerts
            else if (e.altKey && e.key === 'r') {
                e.preventDefault();
                this.resetAlerts();
            }
            // Alt+T: Show recommendations (tips)
            else if (e.altKey && e.key === 't') {
                e.preventDefault();
                this.showRecommendations();
            }
            // Alt+L: Start learning
            else if (e.altKey && e.key === 'l') {
                e.preventDefault();
                this.startLearning();
            }
            // Alt+S: Save settings
            else if (e.altKey && e.key === 's') {
                e.preventDefault();
                this.save();
            }
            // Alt+M: Toggle full/compact mode
            else if (e.altKey && e.key === 'm') {
                e.preventDefault();
                this.toggleFull();
            }
            // Alt+U: Start auto-tuning
            else if (e.altKey && e.key === 'u') {
                e.preventDefault();
                this.startAutoTuning();
            }
            // Alt+N: Reset tool (new tool)
            else if (e.altKey && e.key === 'n') {
                e.preventDefault();
                this.resetToolWear();
            }
            // Alt+1/2/3: Quick mode switch
            else if (e.altKey && e.key === '1') {
                e.preventDefault();
                this.setMode('auto');
            }
            else if (e.altKey && e.key === '2') {
                e.preventDefault();
                this.setMode('aggressive');
            }
            else if (e.altKey && e.key === '3') {
                e.preventDefault();
                this.setMode('conservative');
            }
            // Escape: Close any open modal
            else if (e.key === 'Escape') {
                const modal = document.querySelector('#chatter-diag-modal, #chatter-recommendations-modal, #chatter-material-modal, #chatter-tuning-modal');
                if (modal) modal.remove();
            }
        });
    }
    
    // Toggle panel visibility
    togglePanel() {
        if (!this.panel) return;
        const content = this.panel.querySelector('.chatter-content');
        if (content) {
            const isHidden = content.style.display === 'none';
            content.style.display = isHidden ? '' : 'none';
        }
    }
    
    connect() {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) return;
        
        try {
            this.ws = new WebSocket(this.wsUrl);
            
            this.ws.onopen = () => {
                console.log('[Chatter] Connected to ESP32');
                this.connected = true;
                this.reconnectAttempts = 0;  // Reset on successful connection
                this.hideWarning();
                this.onConnect();
                
                // Request full config
                this.send('getConfig');
                
                // Show setup wizard on first connect if not configured
                if (!localStorage.getItem('chatterConfigured')) {
                    setTimeout(() => {
                        this.showSetupWizard();
                        localStorage.setItem('chatterConfigured', 'true');
                    }, 500);
                }
                
                // Start ping interval
                this.pingInterval = setInterval(() => {
                    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                        this.ws.send('ping');
                    }
                }, 10000);
            };
            
            this.ws.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    if (data.pong) return;  // Ignore ping responses
                    
                    // Handle config message with material list
                    if (data.type === 'config') {
                        if (data.materials) this.materials = data.materials;
                        this.state.material = data.material || 'aluminum';
                        this.state.materialIndex = data.materialIndex || 0;
                        this.state.operation = data.operation || 0;
                        this.state.toolDia = data.toolDia || 6.0;
                        this.state.toolFlutes = data.toolFlutes || 2;
                        this.state.rpm = data.rpm || 10000;
                        this.updateMaterialUI();
                        console.log('[Chatter] Config received:', data);
                        return;
                    }

                    // Handle VFD status from ESP32 VFD controller via server.py
                    if (data.type === 'vfd_status') {
                        this.state.vfd = {
                            ok: data.online ?? false,
                            run: data.running ?? false,
                            freq: data.actualFreqHz ?? data.setFreqHz ?? 0,
                            rpm: data.actualRpm ?? 0,
                            amps: data.outputAmps ?? 0,
                            dcv: data.dcBusVolts ?? 0,
                            fault: data.faultCode ?? 0,
                            faultStr: data.faultString ?? ''
                        };
                        
                        // IMPORTANT: Update global state from VFD for AI calculations
                        if (data.online) {
                            // Use VFD actual RPM for stability lobe calculations
                            if (data.actualRpm > 0) {
                                this.state.rpm = data.actualRpm;
                            }
                            // Use VFD current for load profiling (more accurate than sensor)
                            if (data.outputAmps !== undefined) {
                                this.state.amps = data.outputAmps;
                            }
                        }
                        
                        // Update VFD sensors status
                        this.state.sensors.vfdOk = data.online;
                        this.state.sensors.vfdErr = data.commErrors ?? 0;
                        this.state.sensors.vfdErrStr = data.online ? 'OK' : 'Offline';
                        this.state.sensors.vfdFault = data.faultString || null;
                        this.updateVfdUI();
                        console.log('[VFD] Status:', this.state.vfd);
                        return;
                    }

                    // Handle VFD command responses
                    if (data.type === 'vfd_response') {
                        if (data.status === 'ok') {
                            console.log(`[VFD] Command OK: ${data.cmd}`);
                        } else {
                            console.error(`[VFD] Command failed: ${data.cmd} - ${data.error || 'unknown'}`);
                        }
                        return;
                    }

                    // Diagnostic / auxiliary message types (do not merge into state)
                    if (data.type === 'diagnostic' || data.type === 'spectrum' || data.type === 'stats' ||
                        data.type === 'chatterMap' || data.type === 'features' || data.type === 'analysis' ||
                        data.type === 'settings' || data.type === 'network') {
                        this.handleAuxMessage(data);
                        return;
                    }
                    
                    this.state = { ...this.state, ...data };
                    this.updateHistory();
                    this.updateUI();
                    this.checkAlerts();
                    this.onUpdate(this.state);
                } catch (e) {
                    console.error('[Chatter] Parse error:', e);
                }
            };
            
            this.ws.onclose = () => {
                console.log('[Chatter] Disconnected from ESP32');
                this.handleDisconnect();
            };
            
            this.ws.onerror = (error) => {
                console.error('[Chatter] WebSocket error:', error);
                this.handleDisconnect();
            };
            
        } catch (error) {
            console.error('[Chatter] Connection failed:', error);
            this.handleDisconnect();
        }
    }
    
    handleDisconnect() {
        this.connected = false;
        this.ws = null;
        
        if (this.pingInterval) {
            clearInterval(this.pingInterval);
            this.pingInterval = null;
        }
        
        // SAFETY: Reset feed override to 100% on sensor disconnect
        // This prevents the machine from running at reduced feed indefinitely
        if (window.app?.enhancements?.resetFeedOverride) {
            window.app.enhancements.resetFeedOverride();
            console.warn('[SAFETY] Chatter sensor disconnected - feed override reset to 100%');
        }
        
        this.showWarning();
        this.onDisconnect();
        
        // Schedule reconnect with exponential backoff
        if (!this.reconnectTimer && this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            // Exponential backoff: 5s, 7.5s, 11.25s, ... up to 60s max
            const delay = Math.min(
                this.reconnectBaseInterval * Math.pow(1.5, this.reconnectAttempts - 1),
                this.reconnectMaxInterval
            );
            console.log(`[Chatter] Reconnecting in ${Math.round(delay/1000)}s (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
            this.reconnectTimer = setTimeout(() => {
                this.reconnectTimer = null;
                this.connect();
            }, delay);
        } else if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            console.warn('[Chatter] Max reconnection attempts reached. Click panel to retry.');
            this.showReconnectButton();
        }
    }
    
    disconnect() {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        if (this.pingInterval) {
            clearInterval(this.pingInterval);
            this.pingInterval = null;
        }
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
        this.connected = false;
    }
    
    /**
     * Set ESP32 IP address and save to localStorage
     * @param {string} ip - The IP address of the Waveshare ESP32 chatter sensor
     */
    setIp(ip) {
        this.wsUrl = `ws://${ip}/ws`;
        localStorage.setItem('chatterEspIp', ip);
        console.log(`[Chatter] ESP32 IP set to ${ip}`);
    }
    
    /**
     * Derive ESP32 IP from the grblHAL controller IP (same subnet)
     * Useful when both devices are on the same network
     * @param {string} grblIp - The IP of the grblHAL controller (e.g., "192.168.0.72")
     * @param {number} hostOffset - Host number offset from grblHAL (default: 28, so .72 -> .100)
     */
    deriveFromGrblIp(grblIp, hostOffset = 28) {
        if (!grblIp) return;
        const parts = grblIp.split('.');
        if (parts.length === 4) {
            const grblHost = parseInt(parts[3]);
            // Round up to nearest .100 by default
            const chatterHost = Math.min(254, grblHost + hostOffset);
            const derivedIp = `${parts[0]}.${parts[1]}.${parts[2]}.${chatterHost}`;
            this.setIp(derivedIp);
            console.log(`[Chatter] Derived ESP32 IP from grblHAL (${grblIp}): ${derivedIp}`);
            return derivedIp;
        }
        return null;
    }
    
    // ========== USB SERIAL CONNECTION (Web Serial API) ==========
    // Direct USB connection to Waveshare ESP32-S3 Touch LCD 1.46B
    // This is the recommended connection method - no WiFi needed!
    
    async connectSerial() {
        if (!('serial' in navigator)) {
            alert('Web Serial API not supported. Use Chrome or Edge browser.');
            return false;
        }
        
        try {
            // Request port with ESP32 USB identifiers
            this.serialPort = await navigator.serial.requestPort({
                filters: [
                    { usbVendorId: 0x303A },  // Espressif
                    { usbVendorId: 0x10C4 },  // Silicon Labs (CP2102)
                    { usbVendorId: 0x1A86 },  // CH340
                    { usbVendorId: 0x0403 },  // FTDI
                ]
            });
            
            await this.serialPort.open({ baudRate: 115200 });
            
            // Setup streams
            const textDecoder = new TextDecoderStream();
            this.serialPort.readable.pipeTo(textDecoder.writable);
            this.serialReader = textDecoder.readable.getReader();
            
            const textEncoder = new TextEncoderStream();
            textEncoder.readable.pipeTo(this.serialPort.writable);
            this.serialWriter = textEncoder.writable.getWriter();
            
            this.connected = true;
            this.serialMode = true;
            this.reconnectAttempts = 0;
            this.hideWarning();
            this.onConnect();
            
            console.log('[Chatter] Connected via USB Serial');
            
            // Start reading serial data
            this._readSerialLoop();
            
            // Request config from ESP32
            await this.sendSerialCommand('getConfig');
            
            // Update connect button
            this._updateConnectButtons();
            
            return true;
            
        } catch (err) {
            if (err.name !== 'NotFoundError') {  // User cancelled port selection
                console.error('[Chatter] USB Serial connection failed:', err);
            }
            return false;
        }
    }
    
    async disconnectSerial() {
        if (this.serialReader) {
            try { await this.serialReader.cancel(); } catch (e) {}
            this.serialReader = null;
        }
        if (this.serialWriter) {
            try { await this.serialWriter.close(); } catch (e) {}
            this.serialWriter = null;
        }
        if (this.serialPort) {
            try { await this.serialPort.close(); } catch (e) {}
            this.serialPort = null;
        }
        this.connected = false;
        this.serialMode = false;
        this.showWarning();
        this.onDisconnect();
        this._updateConnectButtons();
        console.log('[Chatter] USB Serial disconnected');
    }
    
    async sendSerialCommand(command) {
        if (!this.serialWriter) return;
        try {
            await this.serialWriter.write(command + '\n');
        } catch (err) {
            console.error('[Chatter] Serial write error:', err);
        }
    }
    
    async _readSerialLoop() {
        try {
            while (this.serialPort && this.serialReader) {
                const { value, done } = await this.serialReader.read();
                if (done) break;
                
                this.serialBuffer += value;
                this._processSerialBuffer();
            }
        } catch (err) {
            if (err.name !== 'NetworkError') {
                console.error('[Chatter] Serial read error:', err);
            }
            this.disconnectSerial();
        }
    }
    
    _processSerialBuffer() {
        const lines = this.serialBuffer.split('\n');
        this.serialBuffer = lines.pop() || '';
        
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            
            // Skip non-JSON lines (debug messages, etc.)
            if (!trimmed.startsWith('{')) {
                // Could be a debug message, log it
                if (trimmed.length > 0 && !trimmed.startsWith('OK')) {
                    console.log('[Chatter ESP32]', trimmed);
                }
                continue;
            }
            
            try {
                const data = JSON.parse(trimmed);
                
                // Handle config message
                if (data.type === 'config') {
                    if (data.materials) this.materials = data.materials;
                    this.state.material = data.material || 'aluminum';
                    this.state.materialIndex = data.materialIndex || 0;
                    this.state.operation = data.operation || 0;
                    this.state.toolDia = data.toolDia || 6.0;
                    this.state.toolFlutes = data.toolFlutes || 2;
                    this.state.rpm = data.rpm || 10000;
                    this.updateMaterialUI();
                    console.log('[Chatter] Config received via serial:', data);
                    return;
                }
                
                // Handle diagnostic/auxiliary messages
                if (data.type === 'diagnostic' || data.type === 'spectrum' || data.type === 'stats') {
                    this.handleAuxMessage(data);
                    return;
                }
                
                // Handle Waveshare ESP32-S3 response messages
                if (data.response) {
                    console.log('[Chatter] Waveshare response:', data.response);
                    if (data.response === 'calibration_started') {
                        this.showNotification('Calibration started - keep machine idle for 5 seconds');
                    } else if (data.response === 'learned_success') {
                        this.showNotification('Chatter pattern learned successfully!');
                    } else if (data.response === 'tool_set') {
                        console.log('[Chatter] Tool set:', data.teeth, 'teeth,', data.diameter, 'mm');
                    }
                    return;
                }
                
                // Handle Waveshare ESP32-S3 info message
                if (data.info) {
                    console.log('[Chatter] Waveshare info:', data.info);
                    this.waveshareInfo = data.info;
                    return;
                }
                
                // Handle sensor data - use handleSerialData for consistency
                this.handleSerialData(data);
                
            } catch (e) {
                // Ignore parse errors (incomplete JSON, etc.)
            }
        }
    }
    
    _updateConnectButtons() {
        const usbBtn = document.getElementById('chatter-usb-connect-btn');
        const wsBtn = document.getElementById('chatter-ws-connect-btn');
        
        if (usbBtn) {
            if (this.serialMode && this.connected) {
                usbBtn.textContent = '🔌 USB Connected';
                usbBtn.classList.add('connected');
            } else {
                usbBtn.textContent = '🔌 USB Connect';
                usbBtn.classList.remove('connected');
            }
        }
        
        if (wsBtn) {
            if (!this.serialMode && this.connected) {
                wsBtn.textContent = '📶 WiFi Connected';
                wsBtn.classList.add('connected');
            } else {
                wsBtn.textContent = '📶 WiFi Connect';
                wsBtn.classList.remove('connected');
            }
        }
    }
    
    // ========== SERIAL DATA HANDLER ==========
    // Called when JSON data is received over USB serial or passthrough
    // Supports TWO formats:
    // 1. Waveshare ESP32-S3 Touch LCD 1.46B (NEW):
    //    {"chatter":{"state":"ok|warning|chatter|calibrating","score":0-100,"freq":Hz,"vib":g,"conf":0-100,"cal":0-100,"learned":N,"feed":0-100}}
    // 2. Legacy format (OLD - for reference):
    //    {"score":0.45,"audio":0.3,"accel":0.2,"current":0.1,"detected":false,"feed":100,"rpm":12000,...}
    handleSerialData(data) {
        // Mark as connected via serial
        if (!this.connected) {
            this.connected = true;
            this.serialMode = true;  // Flag that we're using serial, not WebSocket
            this.hideWarning();
            console.log('[Chatter] Connected via serial passthrough');
        }
        
        // SAFETY: Update last data timestamp for watchdog
        this._lastDataTime = Date.now();
        
        // Check if it's the new Waveshare format (nested "chatter" object)
        if (data.chatter && typeof data.chatter === 'object') {
            const c = data.chatter;
            
            // SAFETY: Validate Waveshare data ranges before using
            const score = this._validateRange(c.score, 0, 100, 0);
            const vib = this._validateRange(c.vib, 0, 50, 0);  // Max 50g is extreme
            const conf = this._validateRange(c.conf, 0, 100, 0);
            const cal = this._validateRange(c.cal, 0, 100, 0);
            const feed = this._validateRange(c.feed, 0, 200, 100);
            const freq = this._validateRange(c.freq, 0, 20000, 0);  // Max 20kHz
            
            // Map new Waveshare format to our state
            // score is 0-100 in Waveshare format, we keep it as percentage
            this.state.combined = score;
            this.state.audio = score / 100;  // Approximate audio from combined
            this.state.accel = vib ? Math.min(1.0, vib * 10) : 0;  // vib in g, scale to 0-1
            this.state.current = 0;  // Waveshare doesn't have current sensor
            
            // Map state string to boolean
            this.state.chatter = (c.state === 'chatter');
            this.state.warning = (c.state === 'warning');
            this.state.calibrating = (c.state === 'calibrating');
            this.state.recovering = (c.state === 'recovering');
            
            // New fields from adaptive detector
            this.state.dominantFreq = freq;
            this.state.confidence = conf;
            this.state.calibrationPct = cal;
            this.state.learnedEvents = c.learned || 0;
            this.state.suggestedFeed = feed;
            this.state.vibrationG = vib;
            
            // DS18B20 spindle temperature sensor
            if (typeof c.spindleTempC === 'number' && c.spindleTempC > -127) {
                this.state.spindleTempC = c.spindleTempC;
                // Warn if spindle is getting hot (PETG housing limit ~60°C)
                // Check critical first, then warning (order matters for else-if)
                if (c.spindleTempC > 65 && !this._tempCriticalShown) {
                    this._tempCriticalShown = true;
                    this.showNotification(`🔥 SPINDLE HOT: ${c.spindleTempC.toFixed(1)}°C - check cooling!`, 'error');
                } else if (c.spindleTempC > 55 && !this._tempWarningShown) {
                    this._tempWarningShown = true;
                    this.showNotification(`⚠️ Spindle temp ${c.spindleTempC.toFixed(1)}°C - approaching PETG limit!`, 'warning');
                } else if (c.spindleTempC < 50) {
                    this._tempWarningShown = false;
                    this._tempCriticalShown = false;
                }
            }
            
            // Set status based on state
            if (c.state === 'chatter') {
                this.state.status = 'CHATTER';
            } else if (c.state === 'warning') {
                this.state.status = 'WARNING';
            } else if (c.state === 'calibrating') {
                this.state.status = 'CALIBRATING';
            } else {
                this.state.status = 'OK';
            }
            
            console.debug('[Chatter] Waveshare data:', c.state, 'score:', score, 'freq:', freq);
            
        } else {
            // Legacy format (direct properties) - also validate
            this.state.audio = this._validateRange(data.audio, 0, 1, 0);
            this.state.accel = this._validateRange(data.accel, 0, 1, 0);
            this.state.current = this._validateRange(data.current, 0, 1, 0);
            this.state.combined = this._validateRange(data.score, 0, 1, 0);
            this.state.chatter = data.detected || false;
            this.state.feed = this._validateRange(data.feed, 0, 200, 100);
            this.state.rpm = this._validateRange(data.rpm, 0, 100000, 0);
            this.state.amps = this._validateRange(data.amps, 0, 100, 0);
            this.state.material = data.material || 'aluminum';
            this.state.status = data.status || 'OFF';
        }
        
        // SAFETY: Check sensor health and disable adaptive feed if sensors fail
        if (data.sensors && !data.sensors.allOk) {
            this._handleSensorFailure(data.sensors);
        }
        
        // Update UI and check alerts
        this.updateHistory();
        this.updateUI();
        this.checkAlerts();
        this.onUpdate(this.state);
    }
    
    /**
     * SAFETY: Validate a value is within expected range
     * Returns defaultVal if value is NaN, Infinity, or out of range
     */
    _validateRange(value, min, max, defaultVal) {
        if (!Number.isFinite(value)) return defaultVal;
        if (value < min || value > max) {
            console.warn(`[SAFETY] Value ${value} out of range [${min}-${max}], using default ${defaultVal}`);
            return defaultVal;
        }
        return value;
    }
    
    /**
     * SAFETY: Handle sensor failure by disabling adaptive feed
     */
    _handleSensorFailure(sensors) {
        if (!this._sensorFailureLogged) {
            console.error('[SAFETY] Sensor failure detected:', sensors);
            this._sensorFailureLogged = true;
            
            // Reset feed override to 100% for safety
            if (window.app?.enhancements?.resetFeedOverride) {
                window.app.enhancements.resetFeedOverride();
            }
            
            // Show warning to user
            this.showNotification('⚠️ Sensor failure! Adaptive feed disabled for safety.', 'warning');
        }
    }
    
    // ========== WAVESHARE ESP32-S3 COMMANDS ==========
    // Commands for the Waveshare ESP32-S3 Touch LCD 1.46B chatter sensor
    
    /**
     * Request the Waveshare sensor to start auto-calibration
     * Machine should be IDLE when calling this!
     */
    requestCalibration() {
        this.sendSerialCommand('CAL');
    }
    
    /**
     * Confirm that chatter was resolved (for learning)
     * Call this after successfully adjusting feeds/speeds to eliminate chatter
     */
    confirmChatterResolved() {
        this.sendSerialCommand('RESOLVED');
    }
    
    /**
     * Send spindle RPM to Waveshare sensor for stability lobe prediction
     * @param {number} rpm - Current spindle speed
     */
    sendSpindleRPM(rpm) {
        this.sendSerialCommand(`RPM:${rpm}`);
    }
    
    /**
     * Send feed rate to Waveshare sensor for learning
     * @param {number} feed - Current feed rate mm/min
     */
    sendFeedRate(feed) {
        this.sendSerialCommand(`FEED:${feed}`);
    }
    
    /**
     * Send tool parameters to Waveshare sensor for harmonic prediction
     * @param {number} teeth - Number of flutes/teeth
     * @param {number} diameter - Tool diameter in mm
     */
    sendToolParams(teeth, diameter) {
        this.sendSerialCommand(`TOOL:${teeth},${diameter}`);
    }
    
    /**
     * Send StallGuard data from TMC2209 (if grblHAL provides it)
     * @param {number} axis - Axis number (0=X, 1=Y, 2=Z)
     * @param {number} sgValue - StallGuard value 0-255
     */
    sendStallGuardData(axis, sgValue) {
        this.sendSerialCommand(`SG:${axis},${sgValue}`);
    }
    
    /**
     * Update StallGuard values directly (from grblHAL real-time report)
     * @param {Object} sg - Object with x, y, z StallGuard values
     */
    updateStallGuard(sg) {
        if (!sg) return;
        
        // Store raw StallGuard values
        this.state.stallGuard = sg;
        
        // StallGuard value decreases when motor is loaded
        // Normal: ~250, Heavy load: ~100, Stall: <50
        // Convert to a 0-1 "load" score (inverted)
        const sgToLoad = (val) => Math.max(0, Math.min(1, (255 - val) / 200));
        
        // Calculate axis loads
        const loads = {
            x: sgToLoad(sg.x || 255),
            y: sgToLoad(sg.y || 255),
            z: sgToLoad(sg.z || 255)
        };
        
        // Use maximum axis load as contribution to chatter detection
        const maxLoad = Math.max(loads.x, loads.y, loads.z);
        
        // Update stepper sensor contribution
        this.state.stepperLoad = maxLoad;
        this.state.stepperLoads = loads;
        
        // Contribute to combined score if StallGuard shows high load
        // This catches hard engagement before accelerometer detects vibration
        if (maxLoad > 0.5) {
            // Blend with existing combined score
            this.state.combined = Math.max(this.state.combined, maxLoad * 0.8);
        }
        
        // Check for stall warning
        if (sg.x < 50 || sg.y < 50 || sg.z < 50) {
            console.warn(`[StallGuard] Stall warning! X:${sg.x} Y:${sg.y} Z:${sg.z}`);
            this.state.stallWarning = true;
        } else {
            this.state.stallWarning = false;
        }
    }
    
    /**
     * Request device info from Waveshare sensor
     */
    requestInfo() {
        this.sendSerialCommand('INFO');
    }
    
    /**
     * Show a notification to the user
     * @param {string} message - Message to display
     */
    showNotification(message) {
        console.log('[Chatter]', message);
        // TODO: Add UI notification element if desired
    }

    // ========== AUDIO ALERTS ==========
    
    initAudio() {
        if (!this.audioContext) {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        }
    }
    
    playBeep(frequency = 800, duration = 200, type = 'sine') {
        if (!this.audioEnabled) return;
        try {
            this.initAudio();
            const oscillator = this.audioContext.createOscillator();
            const gainNode = this.audioContext.createGain();
            oscillator.connect(gainNode);
            gainNode.connect(this.audioContext.destination);
            oscillator.type = type;
            oscillator.frequency.value = frequency;
            gainNode.gain.setValueAtTime(0.3, this.audioContext.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.01, this.audioContext.currentTime + duration / 1000);
            oscillator.start();
            oscillator.stop(this.audioContext.currentTime + duration / 1000);
        } catch (e) {
            console.warn('[Chatter] Audio alert failed:', e);
        }
    }
    
    playChatterWarning() {
        // Double beep for chatter
        this.playBeep(1000, 100);
        setTimeout(() => this.playBeep(1200, 100), 150);
    }
    
    playToolBreakAlert() {
        // Urgent alarm for tool break
        for (let i = 0; i < 5; i++) {
            setTimeout(() => this.playBeep(1500, 100, 'square'), i * 200);
        }
    }
    
    playOverloadAlert() {
        // Low warning tone
        this.playBeep(400, 500, 'sawtooth');
    }
    
    toggleAudio() {
        this.audioEnabled = !this.audioEnabled;
        localStorage.setItem('chatterAudioEnabled', this.audioEnabled);
        const btn = document.getElementById('chatter-audio-btn');
        if (btn) btn.textContent = this.audioEnabled ? '🔊 Audio' : '🔇 Muted';
        console.log(`[Chatter] Audio alerts ${this.audioEnabled ? 'enabled' : 'disabled'}`);
    }
    
    // ========== G-CODE INTEGRATION ==========
    // Auto-detect material, tool, and operation from G-code comments!
    
    parseGCodeForSettings(gcode) {
        const settings = {
            material: null,
            operation: null,
            toolDia: null,
            toolFlutes: null,
            rpm: null,
            feedRate: null
        };
        
        const lines = gcode.split('\n');
        
        // Material detection patterns
        const materialPatterns = {
            aluminum: /\b(aluminum|aluminium|alu|6061|7075|al)\b/i,
            steel: /\b(steel|stainless|ss|1018|4140|a36)\b/i,
            plastic: /\b(plastic|acrylic|delrin|pom|abs|pvc|hdpe|nylon)\b/i,
            wood: /\b(wood|mdf|plywood|oak|maple|birch|walnut)\b/i,
            brass: /\b(brass|bronze|360)\b/i,
            composite: /\b(composite|carbon|fiberglass|fr4|g10|pcb)\b/i,
            copper: /\b(copper|cu)\b/i
        };
        
        // Operation detection patterns
        const opPatterns = {
            roughing: /\b(rough|roughing|hogging|adaptive)\b/i,
            finishing: /\b(finish|finishing|contour|profile)\b/i,
            drilling: /\b(drill|drilling|pecking|bore|boring)\b/i,
            slotting: /\b(slot|slotting|pocket|pocketing)\b/i
        };
        
        // Tool patterns
        const toolDiaPattern = /(?:tool|endmill|bit|cutter)[^\n]*?(\d+(?:\.\d+)?)\s*(?:mm|in)?/i;
        const flutePattern = /(\d)\s*(?:flute|flutes|fl)/i;
        const rpmPattern = /S\s*(\d+)/i;
        const feedPattern = /F\s*(\d+)/i;
        
        for (const line of lines) {
            // Skip if not a comment
            const comment = line.match(/[;(](.+?)(?:\)|$)/);
            if (comment) {
                const text = comment[1];
                
                // Check materials
                for (const [mat, pattern] of Object.entries(materialPatterns)) {
                    if (pattern.test(text) && !settings.material) {
                        settings.material = mat;
                        console.log(`[Chatter] Auto-detected material: ${mat}`);
                    }
                }
                
                // Check operations
                for (const [op, pattern] of Object.entries(opPatterns)) {
                    if (pattern.test(text) && !settings.operation) {
                        settings.operation = op;
                        console.log(`[Chatter] Auto-detected operation: ${op}`);
                    }
                }
                
                // Check tool diameter
                const diaMatch = text.match(toolDiaPattern);
                if (diaMatch && !settings.toolDia) {
                    settings.toolDia = parseFloat(diaMatch[1]);
                    console.log(`[Chatter] Auto-detected tool diameter: ${settings.toolDia}mm`);
                }
                
                // Check flutes
                const fluteMatch = text.match(flutePattern);
                if (fluteMatch && !settings.toolFlutes) {
                    settings.toolFlutes = parseInt(fluteMatch[1]);
                    console.log(`[Chatter] Auto-detected flutes: ${settings.toolFlutes}`);
                }
            }
            
            // Check for spindle speed in actual G-code
            const sMatch = line.match(rpmPattern);
            if (sMatch && !settings.rpm) {
                settings.rpm = parseInt(sMatch[1]);
                if (settings.rpm > 1000) {  // Ignore S values < 1000 (might be something else)
                    console.log(`[Chatter] Auto-detected RPM: ${settings.rpm}`);
                } else {
                    settings.rpm = null;
                }
            }
        }
        
        return settings;
    }
    
    // Called when a G-code file is loaded
    onGCodeLoaded(gcode) {
        const detected = this.parseGCodeForSettings(gcode);
        this.autoDetectedSettings = detected;
        
        let changed = false;
        
        if (detected.material) {
            this.setMaterial(detected.material);
            changed = true;
        }
        
        if (detected.operation) {
            this.setOperation(detected.operation);
            changed = true;
        }
        
        if (detected.toolDia || detected.toolFlutes || detected.rpm) {
            this.setTool(
                detected.toolDia || this.state.toolDia,
                detected.toolFlutes || this.state.toolFlutes,
                detected.rpm || this.state.rpm
            );
            changed = true;
        }
        
        if (changed) {
            this.showNotification('Chatter detection auto-configured from G-code! ✓', 'success');
        }
    }
    
    showNotification(message, type = 'info') {
        const notif = document.createElement('div');
        notif.className = `chatter-notification chatter-notification-${type}`;
        notif.textContent = message;
        notif.style.cssText = `
            position: fixed;
            bottom: 80px;
            right: 20px;
            padding: 12px 20px;
            border-radius: 8px;
            background: ${type === 'success' ? '#2e7d32' : type === 'warning' ? '#f57c00' : '#1976d2'};
            color: white;
            font-family: system-ui;
            z-index: 100000;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
            animation: slideIn 0.3s ease;
        `;
        document.body.appendChild(notif);
        setTimeout(() => notif.remove(), 4000);
    }
    
    // ========== PREDICTIVE WARNINGS ==========
    
    updatePrediction() {
        // Add current combined score to prediction history
        this.predictionHistory.push({
            score: this.state.combined,
            trend: this.state.trend,
            timestamp: Date.now()
        });
        
        // Keep only recent samples
        if (this.predictionHistory.length > this.predictionWindow) {
            this.predictionHistory.shift();
        }
        
        // Need at least 5 samples to predict
        if (this.predictionHistory.length < 5) return null;
        
        // Calculate trend direction and acceleration
        const recent = this.predictionHistory.slice(-5);
        const scores = recent.map(p => p.score);
        const avgTrend = recent.reduce((a, p) => a + p.trend, 0) / recent.length;
        
        // Calculate acceleration (is it speeding up?)
        const firstHalf = scores.slice(0, 2).reduce((a, b) => a + b, 0) / 2;
        const secondHalf = scores.slice(-2).reduce((a, b) => a + b, 0) / 2;
        const acceleration = (secondHalf - firstHalf) / 3;  // Change per sample
        
        // Predict score in ~1 second (20 samples at 20Hz)
        const predictedScore = this.state.combined + (avgTrend * 20) + (acceleration * 20);
        
        // Return prediction
        return {
            predicted: predictedScore,
            timeToChatter: avgTrend > 0.005 
                ? Math.round((this.state.threshold - this.state.combined) / avgTrend / 20) 
                : null,
            willChatter: predictedScore > this.state.threshold && avgTrend > 0.005,
            confidence: Math.min(1, Math.abs(avgTrend) * 50)
        };
    }
    
    // Commands to ESP32
    enable() { this.send('enable'); }
    disable() { this.send('disable'); }
    calibrate() { this.send('calibrate'); }
    learn() { this.send('learn'); }
    resetAlerts() { this.send('reset'); }
    save() { this.send('save'); }
    autoCal() { this.send('autoCal'); }
    getStats() { this.send('stats'); }
    resetStats() { this.send('resetStats'); }
    setRPM(rpm) { this.send(`rpm:${rpm}`); }
    
    setMode(mode) {
        const modes = ['auto', 'aggressive', 'conservative'];
        if (modes.includes(mode)) {
            this.send(`mode:${mode}`);
        }
    }
    
    // MATERIAL SELECTION - BECAUSE IT MATTERS!
    setMaterial(material) {
        if (typeof material === 'number') {
            this.send(`materialIndex:${material}`);
            this.state.materialIndex = material;
            this.state.material = this.materials[material] || 'aluminum';
        } else {
            this.send(`material:${material}`);
            this.state.material = material;
            this.state.materialIndex = this.materials.indexOf(material);
        }
        this.updateMaterialUI();
    }
    
    // OPERATION TYPE - roughing vs finishing vs drilling
    setOperation(op) {
        const opNames = ['roughing', 'finishing', 'drilling', 'slotting'];
        if (typeof op === 'number') {
            this.send(`operation:${opNames[op]}`);
            this.state.operation = op;
        } else {
            this.send(`operation:${op}`);
            this.state.operation = opNames.indexOf(op);
        }
        this.updateMaterialUI();
    }
    
    // TOOL INFO - diameter, flutes, RPM affect chatter frequency!
    setTool(diameter, flutes, rpm) {
        this.state.toolDia = diameter;
        this.state.toolFlutes = flutes;
        this.state.rpm = rpm;
        this.send(`tool:${diameter},${flutes},${rpm}`);
        this.updateMaterialUI();
    }
    
    // VFD Commands via ESP32 RS-485 Modbus
    // These are sent via WebSocket to server.py which forwards to ESP32 VFD controller
    sendVfdCommand(cmd) {
        // Send VFD command through the bridge server
        this.send(JSON.stringify({ type: 'vfd', command: cmd }));
    }
    
    vfdStart(rpm) {
        // Start spindle forward at specified RPM
        if (rpm) {
            rpm = Number(rpm);
            if (Number.isFinite(rpm) && rpm >= 0 && rpm <= 30000) {
                this.sendVfdCommand(`RPM:${rpm}`);
            }
        }
        this.sendVfdCommand('FWD');
    }
    
    vfdStop() {
        this.sendVfdCommand('STOP');
    }
    
    vfdReverse(rpm) {
        if (rpm) {
            rpm = Number(rpm);
            if (Number.isFinite(rpm) && rpm >= 0 && rpm <= 30000) {
                this.sendVfdCommand(`RPM:${rpm}`);
            }
        }
        this.sendVfdCommand('REV');
    }
    
    vfdSetRpm(rpm) {
        rpm = Number(rpm);
        if (!Number.isFinite(rpm) || rpm < 0 || rpm > 30000) {
            console.error('[VFD] Invalid RPM value:', rpm);
            return;
        }
        this.sendVfdCommand(`RPM:${rpm}`);
    }
    
    vfdSetFrequency(hz) {
        hz = Number(hz);
        if (!Number.isFinite(hz) || hz < 0 || hz > 500) {
            console.error('[VFD] Invalid frequency value:', hz);
            return;
        }
        // Note: VFD uses RPM command with frequency conversion internally
        const rpm = Math.round(hz * 30);  // 2-pole motor: RPM = Hz * 60 / 2
        this.sendVfdCommand(`RPM:${rpm}`);
    }
    
    // ========================================================================
    // VFD ACCELERATION/DECELERATION CONTROL
    // Without a braking resistor, the VFD can't stop the spindle instantly!
    // It has to let the motor coast or use DC injection braking (slow)
    // ========================================================================
    
    /**
     * Set spindle acceleration time (how fast it speeds UP)
     * @param {number} seconds - Time to reach full speed (0.1 to 60 seconds)
     */
    vfdSetAccelTime(seconds) {
        seconds = Math.max(0.1, Math.min(60, seconds));
        this.sendVfdCommand(`ACCEL:${seconds.toFixed(1)}`);
        this.showNotification(`VFD Accel time set to ${seconds}s`, 'info');
    }
    
    /**
     * Set spindle deceleration time (how fast it slows DOWN)
     * NOTE: Without a braking resistor, very fast decel can trip OV fault!
     * @param {number} seconds - Time to stop from full speed (0.1 to 60 seconds)
     */
    vfdSetDecelTime(seconds) {
        seconds = Math.max(0.1, Math.min(60, seconds));
        this.sendVfdCommand(`DECEL:${seconds.toFixed(1)}`);
        this.showNotification(`VFD Decel time set to ${seconds}s`, 'info');
    }
    
    /**
     * Apply fast ramp preset (1s up, 2s down) - RECOMMENDED for most use
     */
    vfdFastRamp() {
        this.sendVfdCommand('FASTRAMP');
        this.showNotification('⚡ Fast ramp: 1s accel, 2s decel', 'success');
    }
    
    /**
     * Apply slow/safe ramp preset (5s up, 8s down) - For heavy spindles
     */
    vfdSlowRamp() {
        this.sendVfdCommand('SLOWRAMP');
        this.showNotification('🐢 Slow ramp: 5s accel, 8s decel', 'info');
    }
    
    /**
     * Show RPM input dialog
     */
    _showRpmDialog() {
        const currentRpm = this.state.vfd.rpm || this.state.rpm || 10000;
        const modal = document.createElement('div');
        modal.style.cssText = `
            position: fixed;
            inset: 0;
            background: rgba(0,0,0,0.8);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 100001;
        `;
        modal.innerHTML = `
            <div style="background: #1a1a2e; padding: 24px; border-radius: 12px; text-align: center; color: white; min-width: 300px;">
                <h3 style="margin: 0 0 16px;">Set Spindle Speed</h3>
                <input type="number" id="rpm-input" value="${currentRpm}" min="0" max="30000" step="100"
                    style="width: 100%; padding: 12px; font-size: 24px; text-align: center; background: #0d1117; color: white; border: 1px solid #333; border-radius: 6px;">
                <div style="display: flex; gap: 8px; margin-top: 16px; flex-wrap: wrap; justify-content: center;">
                    <button onclick="document.getElementById('rpm-input').value=6000" style="padding: 8px 16px; background: #333; color: white; border: none; border-radius: 4px; cursor: pointer;">6000</button>
                    <button onclick="document.getElementById('rpm-input').value=10000" style="padding: 8px 16px; background: #333; color: white; border: none; border-radius: 4px; cursor: pointer;">10000</button>
                    <button onclick="document.getElementById('rpm-input').value=12000" style="padding: 8px 16px; background: #333; color: white; border: none; border-radius: 4px; cursor: pointer;">12000</button>
                    <button onclick="document.getElementById('rpm-input').value=18000" style="padding: 8px 16px; background: #333; color: white; border: none; border-radius: 4px; cursor: pointer;">18000</button>
                    <button onclick="document.getElementById('rpm-input').value=24000" style="padding: 8px 16px; background: #333; color: white; border: none; border-radius: 4px; cursor: pointer;">24000</button>
                </div>
                <div style="display: flex; gap: 12px; margin-top: 20px; justify-content: center;">
                    <button id="rpm-apply" style="padding: 12px 32px; background: #44ff44; color: black; border: none; border-radius: 6px; cursor: pointer; font-weight: bold; font-size: 16px;">Apply</button>
                    <button id="rpm-cancel" style="padding: 12px 32px; background: #444; color: white; border: none; border-radius: 6px; cursor: pointer;">Cancel</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        
        const input = modal.querySelector('#rpm-input');
        input.focus();
        input.select();
        
        modal.querySelector('#rpm-apply').onclick = () => {
            const rpm = parseInt(input.value);
            if (rpm >= 0 && rpm <= 30000) {
                if (rpm === 0) {
                    this.vfdStop();
                } else {
                    this.vfdStart(rpm);
                }
                this.showNotification(`Spindle set to ${rpm} RPM`, 'success');
            }
            modal.remove();
        };
        
        modal.querySelector('#rpm-cancel').onclick = () => modal.remove();
        
        // Enter key applies
        input.onkeydown = (e) => {
            if (e.key === 'Enter') modal.querySelector('#rpm-apply').click();
            if (e.key === 'Escape') modal.remove();
        };
    }
    
    /**
     * Show ramp time configuration dialog
     * Controls how fast spindle speeds up (accel) and slows down (decel)
     * NOTE: Without braking resistor, decel can't be too fast or VFD will fault!
     */
    _showRampDialog() {
        const modal = document.createElement('div');
        modal.style.cssText = `
            position: fixed;
            inset: 0;
            background: rgba(0,0,0,0.8);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 100001;
        `;
        modal.innerHTML = `
            <div style="background: #1a1a2e; padding: 24px; border-radius: 12px; text-align: center; color: white; min-width: 340px;">
                <h3 style="margin: 0 0 8px;">⚡ Spindle Ramp Times</h3>
                <p style="font-size: 11px; opacity: 0.7; margin: 0 0 16px;">
                    How fast the spindle changes speed.<br>
                    ⚠️ Without braking resistor, decel can't be too fast!
                </p>
                
                <div style="display: grid; gap: 12px;">
                    <div style="text-align: left;">
                        <label style="display: block; font-size: 12px; opacity: 0.7; margin-bottom: 4px;">
                            🚀 Acceleration (speed UP)
                        </label>
                        <div style="display: flex; gap: 8px; align-items: center;">
                            <input type="number" id="ramp-accel" value="1.0" min="0.1" max="30" step="0.1"
                                style="flex: 1; padding: 10px; font-size: 18px; text-align: center; background: #0d1117; color: white; border: 1px solid #333; border-radius: 6px;">
                            <span style="width: 60px;">seconds</span>
                        </div>
                    </div>
                    
                    <div style="text-align: left;">
                        <label style="display: block; font-size: 12px; opacity: 0.7; margin-bottom: 4px;">
                            🛑 Deceleration (slow DOWN)
                        </label>
                        <div style="display: flex; gap: 8px; align-items: center;">
                            <input type="number" id="ramp-decel" value="3.0" min="0.5" max="60" step="0.5"
                                style="flex: 1; padding: 10px; font-size: 18px; text-align: center; background: #0d1117; color: white; border: 1px solid #333; border-radius: 6px;">
                            <span style="width: 60px;">seconds</span>
                        </div>
                        <p style="font-size: 10px; color: #ffaa44; margin: 4px 0 0;">
                            ⚠️ Without braking resistor: keep above 2s to avoid OV fault
                        </p>
                    </div>
                </div>
                
                <div style="display: flex; gap: 8px; margin-top: 16px; flex-wrap: wrap; justify-content: center;">
                    <button onclick="document.getElementById('ramp-accel').value='0.5'; document.getElementById('ramp-decel').value='1.5';" 
                        style="padding: 6px 12px; background: #ff6b6b; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 11px;">
                        ⚡ Very Fast
                    </button>
                    <button onclick="document.getElementById('ramp-accel').value='1.0'; document.getElementById('ramp-decel').value='2.0';" 
                        style="padding: 6px 12px; background: #4ecdc4; color: black; border: none; border-radius: 4px; cursor: pointer; font-size: 11px;">
                        ✓ Recommended
                    </button>
                    <button onclick="document.getElementById('ramp-accel').value='3.0'; document.getElementById('ramp-decel').value='5.0';" 
                        style="padding: 6px 12px; background: #555; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 11px;">
                        🐢 Gentle
                    </button>
                    <button onclick="document.getElementById('ramp-accel').value='5.0'; document.getElementById('ramp-decel').value='10.0';" 
                        style="padding: 6px 12px; background: #333; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 11px;">
                        🛡️ Safe/Heavy
                    </button>
                </div>
                
                <div style="display: flex; gap: 12px; margin-top: 20px; justify-content: center;">
                    <button id="ramp-apply" style="padding: 12px 32px; background: #44ff44; color: black; border: none; border-radius: 6px; cursor: pointer; font-weight: bold; font-size: 16px;">
                        Apply
                    </button>
                    <button id="ramp-cancel" style="padding: 12px 32px; background: #444; color: white; border: none; border-radius: 6px; cursor: pointer;">
                        Cancel
                    </button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        
        const accelInput = modal.querySelector('#ramp-accel');
        const decelInput = modal.querySelector('#ramp-decel');
        accelInput.focus();
        accelInput.select();
        
        modal.querySelector('#ramp-apply').onclick = () => {
            const accel = parseFloat(accelInput.value);
            const decel = parseFloat(decelInput.value);
            
            if (accel >= 0.1 && accel <= 60 && decel >= 0.5 && decel <= 60) {
                this.vfdSetAccelTime(accel);
                setTimeout(() => this.vfdSetDecelTime(decel), 100);  // Slight delay between commands
                this.showNotification(`Ramp: ${accel}s up, ${decel}s down`, 'success');
            }
            modal.remove();
        };
        
        modal.querySelector('#ramp-cancel').onclick = () => modal.remove();
        
        // Enter key applies
        accelInput.onkeydown = decelInput.onkeydown = (e) => {
            if (e.key === 'Enter') modal.querySelector('#ramp-apply').click();
            if (e.key === 'Escape') modal.remove();
        };
    }
    
    /**
     * Toggle VFD auto-adjust mode
     */
    _toggleVfdAutoAdjust() {
        const auto = this.state.aiChatter.vfdAutoAdjust;
        const btn = document.getElementById('chatter-vfd-auto-btn');
        
        if (!auto.enabled) {
            // Show mode selection
            const modal = document.createElement('div');
            modal.style.cssText = `
                position: fixed;
                inset: 0;
                background: rgba(0,0,0,0.8);
                display: flex;
                align-items: center;
                justify-content: center;
                z-index: 100001;
            `;
            modal.innerHTML = `
                <div style="background: #1a1a2e; padding: 24px; border-radius: 12px; color: white; max-width: 400px;">
                    <h3 style="margin: 0 0 12px; color: #ffc800;">🤖 VFD Auto-Adjust</h3>
                    <p style="opacity: 0.8; font-size: 13px;">When chatter is detected, automatically adjust spindle RPM to find a stable machining lobe.</p>
                    <div style="display: flex; flex-direction: column; gap: 8px; margin: 16px 0;">
                        <button class="auto-mode-btn" data-mode="suggest" style="padding: 12px; background: #333; color: white; border: none; border-radius: 6px; cursor: pointer; text-align: left;">
                            <strong>💡 Suggest</strong><br>
                            <span style="font-size: 12px; opacity: 0.7;">Show suggestions only - you decide</span>
                        </button>
                        <button class="auto-mode-btn" data-mode="confirm" style="padding: 12px; background: #333; color: white; border: none; border-radius: 6px; cursor: pointer; text-align: left;">
                            <strong>✋ Confirm</strong><br>
                            <span style="font-size: 12px; opacity: 0.7;">Ask before each adjustment</span>
                        </button>
                        <button class="auto-mode-btn" data-mode="auto" style="padding: 12px; background: #333; color: white; border: none; border-radius: 6px; cursor: pointer; text-align: left;">
                            <strong>⚡ Full Auto</strong><br>
                            <span style="font-size: 12px; opacity: 0.7;">Adjust automatically (advanced users)</span>
                        </button>
                    </div>
                    <button id="auto-cancel" style="width: 100%; padding: 10px; background: #444; color: white; border: none; border-radius: 6px; cursor: pointer;">Cancel</button>
                </div>
            `;
            document.body.appendChild(modal);
            
            modal.querySelectorAll('.auto-mode-btn').forEach(btn => {
                btn.onclick = () => {
                    this.enableVfdAutoAdjust(btn.dataset.mode);
                    document.getElementById('chatter-vfd-auto-btn').style.background = '#44ff44';
                    document.getElementById('chatter-vfd-auto-btn').style.color = 'black';
                    modal.remove();
                };
            });
            
            modal.querySelector('#auto-cancel').onclick = () => modal.remove();
        } else {
            // Disable auto-adjust
            this.disableVfdAutoAdjust();
            if (btn) {
                btn.style.background = '#444';
                btn.style.color = 'white';
            }
            this.showNotification('VFD auto-adjust disabled', 'info');
        }
    }
    
    /**
     * Run spindle warmup cycle via VFD
     * Gradually ramps spindle through speed ranges to warm bearings
     */
    async runSpindleWarmup() {
        if (!this.state.vfd.ok) {
            this.showNotification('VFD not connected', 'error');
            return;
        }
        
        const steps = [
            { rpm: 3000, duration: 15000 },
            { rpm: 6000, duration: 15000 },
            { rpm: 10000, duration: 20000 },
            { rpm: 15000, duration: 20000 },
            { rpm: 20000, duration: 30000 },
            { rpm: 24000, duration: 30000 },
            { rpm: 0, duration: 0 }  // Stop
        ];
        
        this.showNotification('🔄 Starting spindle warmup...', 'info');
        
        for (const step of steps) {
            if (step.rpm > 0) {
                console.log(`[Warmup] ${step.rpm} RPM for ${step.duration/1000}s`);
                this.vfdStart(step.rpm);
                await new Promise(r => setTimeout(r, step.duration));
            } else {
                this.vfdStop();
                this.showNotification('✅ Spindle warmup complete', 'success');
            }
        }
    }

    // ========================================================================
    // SPINDLE THERMAL STRESS TEST
    // ========================================================================
    // Runs spindle through multiple speed cycles for ~10 minutes to check
    // if cooling pump can keep spindle temperature safe
    // Monitors VFD current and reports any overheating
    
    /**
     * Run a 10-minute thermal stress test to verify cooling is adequate
     * Cycles through speeds: ramp up, hold, ramp down, repeat
     * @param {Object} options - Test options
     * @param {number} options.duration - Total test duration in minutes (default: 10)
     * @param {number} options.minRpm - Minimum RPM in test (default: 6000)
     * @param {number} options.maxRpm - Maximum RPM in test (default: 24000)
     * @param {number} options.maxAmps - Abort threshold for current (default: 8.0)
     * @param {number} options.cycles - Number of full up/down cycles (default: 5)
     */
    async runThermalStressTest(options = {}) {
        const config = {
            duration: options.duration || 10,        // minutes
            minRpm: options.minRpm || 6000,
            maxRpm: options.maxRpm || 24000,
            maxAmps: options.maxAmps || 8.0,         // abort if current exceeds this
            cycles: options.cycles || 5,             // full cycles
            ...options
        };
        
        // Check VFD connection
        if (!this.state.vfd.ok && !this.connected) {
            this.showNotification('⚠️ VFD not connected - test will run without monitoring', 'warning');
        }
        
        // Test state
        this._thermalTest = {
            running: true,
            aborted: false,
            abortReason: '',
            startTime: Date.now(),
            config: config,
            log: [],
            maxAmpsRecorded: 0,
            maxTempRecorded: 0,
            currentPhase: '',
            progress: 0,
            currentRpm: 0
        };
        
        // Show test UI
        this._showThermalTestUI();
        
        const totalMs = config.duration * 60 * 1000;
        const cycleMs = totalMs / config.cycles;
        const rampMs = cycleMs * 0.2;  // 20% of cycle for ramping
        const holdMs = cycleMs * 0.3;  // 30% for holding at max/min
        
        const speeds = [
            config.minRpm,
            Math.round((config.minRpm + config.maxRpm) / 2),  // mid
            config.maxRpm
        ];
        
        console.log(`[ThermalTest] Starting ${config.duration}min test, ${config.cycles} cycles, ${config.minRpm}-${config.maxRpm} RPM`);
        this.showNotification(`🌡️ Starting ${config.duration}min thermal stress test...`, 'info');
        this._logThermal(`Test started: ${config.cycles} cycles, ${config.minRpm}-${config.maxRpm} RPM`);
        
        try {
            for (let cycle = 0; cycle < config.cycles && this._thermalTest.running; cycle++) {
                // === RAMP UP PHASE ===
                this._thermalTest.currentPhase = `Cycle ${cycle+1}/${config.cycles}: Ramping UP`;
                
                for (let i = 0; i < speeds.length && this._thermalTest.running; i++) {
                    const rpm = speeds[i];
                    this._thermalTest.currentRpm = rpm;
                    this._updateThermalProgress();
                    
                    console.log(`[ThermalTest] Ramp UP: ${rpm} RPM`);
                    this._logThermal(`Ramp UP to ${rpm} RPM`);
                    this.vfdSetRpm(rpm);
                    if (i === 0) this.vfdStart(rpm);
                    
                    // Hold at this speed, monitoring
                    const holdTime = i === speeds.length - 1 ? holdMs : rampMs / speeds.length;
                    await this._thermalHoldWithMonitor(holdTime);
                    
                    if (this._thermalTest.aborted) break;
                }
                
                // === HOLD AT MAX ===
                if (this._thermalTest.running && !this._thermalTest.aborted) {
                    this._thermalTest.currentPhase = `Cycle ${cycle+1}/${config.cycles}: HOLD at MAX`;
                    this._logThermal(`Holding at ${config.maxRpm} RPM (stress)`);
                    await this._thermalHoldWithMonitor(holdMs);
                }
                
                // === RAMP DOWN PHASE ===
                if (this._thermalTest.running && !this._thermalTest.aborted) {
                    this._thermalTest.currentPhase = `Cycle ${cycle+1}/${config.cycles}: Ramping DOWN`;
                    
                    for (let i = speeds.length - 2; i >= 0 && this._thermalTest.running; i--) {
                        const rpm = speeds[i];
                        this._thermalTest.currentRpm = rpm;
                        this._updateThermalProgress();
                        
                        console.log(`[ThermalTest] Ramp DOWN: ${rpm} RPM`);
                        this._logThermal(`Ramp DOWN to ${rpm} RPM`);
                        this.vfdSetRpm(rpm);
                        
                        const holdTime = i === 0 ? holdMs : rampMs / speeds.length;
                        await this._thermalHoldWithMonitor(holdTime);
                        
                        if (this._thermalTest.aborted) break;
                    }
                }
                
                // === HOLD AT MIN ===
                if (this._thermalTest.running && !this._thermalTest.aborted) {
                    this._thermalTest.currentPhase = `Cycle ${cycle+1}/${config.cycles}: HOLD at MIN (cooling)`;
                    this._logThermal(`Holding at ${config.minRpm} RPM (recovery)`);
                    await this._thermalHoldWithMonitor(holdMs);
                }
            }
        } catch (err) {
            console.error('[ThermalTest] Error:', err);
            this._thermalTest.aborted = true;
            this._thermalTest.abortReason = err.message;
        }
        
        // Stop spindle
        this.vfdStop();
        this._thermalTest.running = false;
        
        // Generate report
        const report = this._generateThermalReport();
        console.log('[ThermalTest] Complete:', report);
        
        if (this._thermalTest.aborted) {
            this.showNotification(`❌ Test aborted: ${this._thermalTest.abortReason}`, 'error');
        } else {
            this.showNotification('✅ Thermal stress test complete!', 'success');
        }
        
        this._showThermalReport(report);
        return report;
    }
    
    /**
     * Hold at current RPM while monitoring temperature/current
     */
    async _thermalHoldWithMonitor(durationMs) {
        const startTime = Date.now();
        const checkInterval = 1000;  // Check every second
        
        while (Date.now() - startTime < durationMs) {
            if (!this._thermalTest.running) break;
            
            // Update progress
            const elapsed = Date.now() - this._thermalTest.startTime;
            const totalMs = this._thermalTest.config.duration * 60 * 1000;
            this._thermalTest.progress = Math.min(100, (elapsed / totalMs) * 100);
            this._updateThermalProgress();
            
            // Check VFD status
            if (this.state.vfd.ok) {
                const amps = this.state.vfd.amps || this.state.amps || 0;
                const rpm = this.state.vfd.rpm || 0;
                
                // Log every 10 seconds
                if (Math.floor((Date.now() - startTime) / 10000) !== 
                    Math.floor((Date.now() - startTime - checkInterval) / 10000)) {
                    this._logThermal(`RPM: ${rpm}, Amps: ${amps.toFixed(2)}A`);
                }
                
                // Track maximums
                if (amps > this._thermalTest.maxAmpsRecorded) {
                    this._thermalTest.maxAmpsRecorded = amps;
                }
                
                // Check for overcurrent (overheating causes higher current draw)
                if (amps > this._thermalTest.config.maxAmps) {
                    this._thermalTest.aborted = true;
                    this._thermalTest.abortReason = `Overcurrent! ${amps.toFixed(2)}A > ${this._thermalTest.config.maxAmps}A limit`;
                    this._logThermal(`⚠️ ABORT: ${this._thermalTest.abortReason}`);
                    return;
                }
                
                // Check for VFD fault
                if (this.state.vfd.fault > 0) {
                    this._thermalTest.aborted = true;
                    this._thermalTest.abortReason = `VFD Fault: ${this.state.vfd.faultStr || this.state.vfd.fault}`;
                    this._logThermal(`⚠️ ABORT: ${this._thermalTest.abortReason}`);
                    return;
                }
            }
            
            await new Promise(r => setTimeout(r, checkInterval));
        }
    }
    
    /**
     * Log a thermal test event with timestamp
     */
    _logThermal(message) {
        const elapsed = Date.now() - this._thermalTest.startTime;
        const mins = Math.floor(elapsed / 60000);
        const secs = Math.floor((elapsed % 60000) / 1000);
        const entry = {
            time: `${mins}:${secs.toString().padStart(2, '0')}`,
            timestamp: elapsed,
            message: message,
            amps: this.state.vfd.amps || this.state.amps || 0,
            rpm: this.state.vfd.rpm || this._thermalTest.currentRpm || 0
        };
        this._thermalTest.log.push(entry);
        console.log(`[ThermalTest ${entry.time}] ${message}`);
        
        // Update log display
        const logEl = document.getElementById('thermal-test-log');
        if (logEl) {
            logEl.innerHTML = this._thermalTest.log.slice(-10).map(e => 
                `<div style="font-size:11px;opacity:0.8;">[${e.time}] ${e.message}</div>`
            ).join('');
            logEl.scrollTop = logEl.scrollHeight;
        }
    }
    
    /**
     * Update the thermal test progress UI
     */
    _updateThermalProgress() {
        const progressEl = document.getElementById('thermal-test-progress');
        const phaseEl = document.getElementById('thermal-test-phase');
        const rpmEl = document.getElementById('thermal-test-rpm');
        const ampsEl = document.getElementById('thermal-test-amps');
        
        if (progressEl) progressEl.style.width = `${this._thermalTest.progress}%`;
        if (phaseEl) phaseEl.textContent = this._thermalTest.currentPhase;
        if (rpmEl) rpmEl.textContent = `${this._thermalTest.currentRpm} RPM`;
        if (ampsEl) ampsEl.textContent = `${(this.state.vfd.amps || this.state.amps || 0).toFixed(2)}A`;
    }
    
    /**
     * Generate thermal test report
     */
    _generateThermalReport() {
        const elapsed = Date.now() - this._thermalTest.startTime;
        const mins = Math.floor(elapsed / 60000);
        const secs = Math.floor((elapsed % 60000) / 1000);
        
        // Calculate average current at max RPM
        const maxRpmEntries = this._thermalTest.log.filter(e => 
            e.rpm >= this._thermalTest.config.maxRpm * 0.95
        );
        const avgAmpsAtMax = maxRpmEntries.length > 0 
            ? maxRpmEntries.reduce((a, e) => a + e.amps, 0) / maxRpmEntries.length 
            : 0;
        
        return {
            completed: !this._thermalTest.aborted,
            abortReason: this._thermalTest.abortReason,
            duration: `${mins}m ${secs}s`,
            durationMs: elapsed,
            config: this._thermalTest.config,
            maxAmps: this._thermalTest.maxAmpsRecorded,
            avgAmpsAtMaxRpm: avgAmpsAtMax,
            cyclesCompleted: Math.floor(this._thermalTest.progress / (100 / this._thermalTest.config.cycles)),
            log: this._thermalTest.log,
            verdict: this._thermalTest.aborted ? 'FAIL' : 
                     this._thermalTest.maxAmpsRecorded > this._thermalTest.config.maxAmps * 0.8 ? 'MARGINAL' : 'PASS'
        };
    }
    
    /**
     * Show thermal test UI overlay
     */
    _showThermalTestUI() {
        // Remove existing
        const existing = document.getElementById('thermal-test-modal');
        if (existing) existing.remove();
        
        const modal = document.createElement('div');
        modal.id = 'thermal-test-modal';
        modal.style.cssText = `
            position: fixed;
            inset: 0;
            background: rgba(0,0,0,0.9);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 100002;
            font-family: system-ui, -apple-system, sans-serif;
        `;
        
        modal.innerHTML = `
            <div style="background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); padding: 32px; border-radius: 16px; width: 500px; max-width: 90vw; color: white; box-shadow: 0 20px 60px rgba(0,0,0,0.5);">
                <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 24px;">
                    <span style="font-size: 32px;">🌡️</span>
                    <div>
                        <h2 style="margin: 0; font-size: 24px;">Spindle Thermal Test</h2>
                        <p style="margin: 4px 0 0; opacity: 0.7; font-size: 13px;">Testing cooling system - ${this._thermalTest.config.duration} minute stress test</p>
                    </div>
                </div>
                
                <div style="background: #0d1117; border-radius: 8px; padding: 16px; margin-bottom: 16px;">
                    <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
                        <span id="thermal-test-phase" style="font-weight: 600;">Initializing...</span>
                        <span id="thermal-test-progress-text">${this._thermalTest.progress.toFixed(0)}%</span>
                    </div>
                    <div style="background: #333; height: 8px; border-radius: 4px; overflow: hidden;">
                        <div id="thermal-test-progress" style="background: linear-gradient(90deg, #4ecdc4, #44ff44); height: 100%; width: 0%; transition: width 0.5s;"></div>
                    </div>
                </div>
                
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 16px;">
                    <div style="background: #0d1117; padding: 16px; border-radius: 8px; text-align: center;">
                        <div style="font-size: 28px; font-weight: bold; color: #4ecdc4;" id="thermal-test-rpm">0 RPM</div>
                        <div style="font-size: 11px; opacity: 0.6;">Current Speed</div>
                    </div>
                    <div style="background: #0d1117; padding: 16px; border-radius: 8px; text-align: center;">
                        <div style="font-size: 28px; font-weight: bold; color: #ffaa44;" id="thermal-test-amps">0.00A</div>
                        <div style="font-size: 11px; opacity: 0.6;">Spindle Current</div>
                    </div>
                </div>
                
                <div style="background: #0d1117; padding: 12px; border-radius: 8px; margin-bottom: 16px; max-height: 150px; overflow-y: auto;" id="thermal-test-log">
                    <div style="font-size: 11px; opacity: 0.5;">Test log will appear here...</div>
                </div>
                
                <div style="display: flex; gap: 12px; justify-content: center;">
                    <button id="thermal-test-abort" style="padding: 12px 32px; background: #ff4444; color: white; border: none; border-radius: 8px; cursor: pointer; font-weight: bold; font-size: 14px;">
                        🛑 ABORT TEST
                    </button>
                </div>
                
                <p style="margin: 16px 0 0; font-size: 11px; opacity: 0.5; text-align: center;">
                    ⚠️ Spindle will cycle ${this._thermalTest.config.minRpm}-${this._thermalTest.config.maxRpm} RPM<br>
                    Test will abort if current exceeds ${this._thermalTest.config.maxAmps}A or VFD faults
                </p>
            </div>
        `;
        
        document.body.appendChild(modal);
        
        // Abort button
        document.getElementById('thermal-test-abort').onclick = () => {
            this._thermalTest.running = false;
            this._thermalTest.aborted = true;
            this._thermalTest.abortReason = 'User aborted';
            this.vfdStop();
        };
        
        // Update progress text periodically
        this._thermalTestUIInterval = setInterval(() => {
            const progressText = document.getElementById('thermal-test-progress-text');
            if (progressText) {
                progressText.textContent = `${this._thermalTest.progress.toFixed(0)}%`;
            }
            if (!this._thermalTest.running) {
                clearInterval(this._thermalTestUIInterval);
            }
        }, 500);
    }
    
    /**
     * Show thermal test report
     */
    _showThermalReport(report) {
        const modal = document.getElementById('thermal-test-modal');
        if (!modal) return;
        
        const verdictColor = {
            'PASS': '#44ff44',
            'MARGINAL': '#ffaa44', 
            'FAIL': '#ff4444'
        }[report.verdict];
        
        const verdictEmoji = {
            'PASS': '✅',
            'MARGINAL': '⚠️',
            'FAIL': '❌'
        }[report.verdict];
        
        modal.innerHTML = `
            <div style="background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); padding: 32px; border-radius: 16px; width: 500px; max-width: 90vw; color: white; box-shadow: 0 20px 60px rgba(0,0,0,0.5);">
                <div style="text-align: center; margin-bottom: 24px;">
                    <span style="font-size: 64px;">${verdictEmoji}</span>
                    <h2 style="margin: 16px 0 0; font-size: 28px; color: ${verdictColor};">${report.verdict}</h2>
                    <p style="margin: 8px 0 0; opacity: 0.7;">Thermal Stress Test ${report.completed ? 'Complete' : 'Aborted'}</p>
                </div>
                
                <div style="background: #0d1117; border-radius: 8px; padding: 16px; margin-bottom: 16px;">
                    <h3 style="margin: 0 0 12px; font-size: 14px; opacity: 0.7;">Test Results</h3>
                    <table style="width: 100%; font-size: 13px;">
                        <tr><td style="padding: 4px 0; opacity: 0.7;">Duration:</td><td style="text-align: right; font-weight: bold;">${report.duration}</td></tr>
                        <tr><td style="padding: 4px 0; opacity: 0.7;">Cycles Completed:</td><td style="text-align: right; font-weight: bold;">${report.cyclesCompleted} / ${report.config.cycles}</td></tr>
                        <tr><td style="padding: 4px 0; opacity: 0.7;">Max Current:</td><td style="text-align: right; font-weight: bold; color: ${report.maxAmps > report.config.maxAmps * 0.8 ? '#ffaa44' : '#44ff44'};">${report.maxAmps.toFixed(2)}A</td></tr>
                        <tr><td style="padding: 4px 0; opacity: 0.7;">Avg at Max RPM:</td><td style="text-align: right; font-weight: bold;">${report.avgAmpsAtMaxRpm.toFixed(2)}A</td></tr>
                        <tr><td style="padding: 4px 0; opacity: 0.7;">Speed Range:</td><td style="text-align: right; font-weight: bold;">${report.config.minRpm} - ${report.config.maxRpm} RPM</td></tr>
                        ${report.abortReason ? `<tr><td style="padding: 4px 0; color: #ff4444;">Abort Reason:</td><td style="text-align: right; color: #ff4444;">${report.abortReason}</td></tr>` : ''}
                    </table>
                </div>
                
                <div style="background: #0d1117; border-radius: 8px; padding: 12px; margin-bottom: 16px;">
                    <h3 style="margin: 0 0 8px; font-size: 14px; opacity: 0.7;">Analysis</h3>
                    <p style="margin: 0; font-size: 12px; line-height: 1.5;">
                        ${report.verdict === 'PASS' 
                            ? '✅ <strong>Cooling is adequate!</strong> Spindle current stayed within safe limits throughout the test. Your pump is working well.'
                            : report.verdict === 'MARGINAL'
                            ? '⚠️ <strong>Cooling is marginal.</strong> Current approached limits at high RPM. Consider upgrading pump or reducing max RPM for extended runs.'
                            : '❌ <strong>Cooling insufficient!</strong> ' + (report.abortReason || 'Current exceeded safe limits. Do not run at max RPM until cooling is improved.')}
                    </p>
                </div>
                
                <div style="display: flex; gap: 12px; justify-content: center;">
                    <button onclick="this.closest('#thermal-test-modal').remove()" style="padding: 12px 32px; background: #333; color: white; border: none; border-radius: 8px; cursor: pointer; font-size: 14px;">
                        Close
                    </button>
                    <button onclick="window.chatterDetection?.exportThermalReport()" style="padding: 12px 32px; background: #4ecdc4; color: black; border: none; border-radius: 8px; cursor: pointer; font-weight: bold; font-size: 14px;">
                        📋 Export Log
                    </button>
                </div>
            </div>
        `;
    }
    
    /**
     * Export thermal test report to file
     */
    exportThermalReport() {
        if (!this._thermalTest) {
            this.showNotification('No thermal test data to export', 'warning');
            return;
        }
        
        const report = this._generateThermalReport();
        const content = [
            '# Spindle Thermal Stress Test Report',
            `Date: ${new Date().toISOString()}`,
            `Verdict: ${report.verdict}`,
            '',
            '## Configuration',
            `- Duration: ${report.config.duration} minutes`,
            `- Speed Range: ${report.config.minRpm} - ${report.config.maxRpm} RPM`,
            `- Cycles: ${report.config.cycles}`,
            `- Current Limit: ${report.config.maxAmps}A`,
            '',
            '## Results',
            `- Completed: ${report.completed ? 'Yes' : 'No'}`,
            `- Actual Duration: ${report.duration}`,
            `- Max Current Recorded: ${report.maxAmps.toFixed(2)}A`,
            `- Avg Current at Max RPM: ${report.avgAmpsAtMaxRpm.toFixed(2)}A`,
            report.abortReason ? `- Abort Reason: ${report.abortReason}` : '',
            '',
            '## Event Log',
            ...report.log.map(e => `[${e.time}] ${e.rpm}RPM ${e.amps.toFixed(2)}A - ${e.message}`)
        ].join('\n');
        
        this.downloadFile(`thermal-test-${new Date().toISOString().slice(0,10)}.txt`, content);
        this.showNotification('📋 Thermal test report exported', 'success');
    }
    
    /**
     * Quick thermal test - 5 minutes, simpler cycle
     */
    async runQuickThermalTest() {
        return this.runThermalStressTest({
            duration: 5,
            cycles: 3,
            minRpm: 8000,
            maxRpm: 20000
        });
    }
    
    /**
     * Extended thermal test - 15 minutes, thorough
     */
    async runExtendedThermalTest() {
        return this.runThermalStressTest({
            duration: 15,
            cycles: 8,
            minRpm: 5000,
            maxRpm: 24000
        });
    }
    
    /**
     * Abort current thermal test
     */
    abortThermalTest() {
        if (this._thermalTest?.running) {
            this._thermalTest.running = false;
            this._thermalTest.aborted = true;
            this._thermalTest.abortReason = 'User aborted';
            this.vfdStop();
            this.showNotification('🛑 Thermal test aborted', 'warning');
        }
    }

    // Show the setup wizard - FIRST THING A USER SHOULD SEE
    showSetupWizard() {
        // Create setup modal
        const modal = document.createElement('div');
        modal.id = 'chatter-setup-modal';
        modal.innerHTML = `
            <style>
                #chatter-setup-modal {
                    position: fixed;
                    inset: 0;
                    background: rgba(0,0,0,0.85);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    z-index: 100000;
                    font-family: 'Segoe UI', system-ui, sans-serif;
                }
                .setup-dialog {
                    background: linear-gradient(145deg, #1a1a2e, #16213e);
                    border-radius: 16px;
                    width: 420px;
                    max-width: 95vw;
                    color: white;
                    box-shadow: 0 20px 60px rgba(0,0,0,0.5);
                }
                .setup-header {
                    padding: 24px 24px 12px;
                    text-align: center;
                }
                .setup-header h2 { margin: 0 0 8px; font-size: 22px; }
                .setup-header p { margin: 0; opacity: 0.7; font-size: 13px; }
                .setup-body { padding: 0 24px 24px; }
                .setup-section {
                    margin-bottom: 20px;
                }
                .setup-section label {
                    display: block;
                    font-size: 12px;
                    font-weight: 600;
                    margin-bottom: 8px;
                    text-transform: uppercase;
                    opacity: 0.8;
                }
                .setup-section label span {
                    font-weight: 400;
                    opacity: 0.6;
                    text-transform: none;
                }
                .material-grid {
                    display: grid;
                    grid-template-columns: repeat(4, 1fr);
                    gap: 8px;
                }
                .material-btn {
                    padding: 12px 8px;
                    border: 2px solid rgba(255,255,255,0.15);
                    border-radius: 10px;
                    background: rgba(255,255,255,0.05);
                    color: white;
                    font-size: 11px;
                    cursor: pointer;
                    transition: all 0.2s;
                    text-align: center;
                }
                .material-btn:hover { border-color: rgba(255,255,255,0.4); }
                .material-btn.active { 
                    border-color: #0066ff; 
                    background: rgba(0,102,255,0.2); 
                }
                .material-btn .icon { font-size: 20px; margin-bottom: 4px; display: block; }
                .operation-grid {
                    display: grid;
                    grid-template-columns: repeat(4, 1fr);
                    gap: 8px;
                }
                .op-btn {
                    padding: 10px 8px;
                    border: 2px solid rgba(255,255,255,0.15);
                    border-radius: 8px;
                    background: rgba(255,255,255,0.05);
                    color: white;
                    font-size: 11px;
                    cursor: pointer;
                    transition: all 0.2s;
                }
                .op-btn:hover { border-color: rgba(255,255,255,0.4); }
                .op-btn.active { border-color: #00cc66; background: rgba(0,204,102,0.2); }
                .tool-inputs {
                    display: grid;
                    grid-template-columns: repeat(3, 1fr);
                    gap: 12px;
                }
                .tool-input {
                    display: flex;
                    flex-direction: column;
                }
                .tool-input label { font-size: 10px; margin-bottom: 4px; opacity: 0.7; }
                .tool-input input {
                    padding: 10px;
                    border: 1px solid rgba(255,255,255,0.2);
                    border-radius: 6px;
                    background: rgba(255,255,255,0.05);
                    color: white;
                    font-size: 16px;
                    font-weight: 600;
                    text-align: center;
                }
                .tool-input input:focus { outline: none; border-color: #0066ff; }
                .setup-footer {
                    padding: 16px 24px;
                    background: rgba(255,255,255,0.05);
                    display: flex;
                    gap: 12px;
                }
                .setup-btn {
                    flex: 1;
                    padding: 14px;
                    border: none;
                    border-radius: 8px;
                    font-size: 14px;
                    font-weight: 600;
                    cursor: pointer;
                    transition: all 0.2s;
                }
                .setup-btn.primary { background: #0066ff; color: white; }
                .setup-btn.secondary { background: rgba(255,255,255,0.1); color: white; }
                .setup-btn:hover { transform: translateY(-1px); filter: brightness(1.1); }
                .setup-note {
                    margin-top: 16px;
                    padding: 12px;
                    background: rgba(255,200,0,0.1);
                    border-radius: 8px;
                    font-size: 11px;
                    color: #ffc800;
                    line-height: 1.5;
                }
            </style>
            <div class="setup-dialog">
                <div class="setup-header">
                    <h2>⚙️ Chatter Detection Setup</h2>
                    <p>These settings MATTER for accurate detection on your mini mill</p>
                </div>
                <div class="setup-body">
                    <div class="setup-section">
                        <label>What material are you cutting? <span>(affects chatter frequency)</span></label>
                        <div class="material-grid" id="setup-materials">
                            <button class="material-btn active" data-mat="0"><span class="icon">🔩</span>Aluminum</button>
                            <button class="material-btn" data-mat="1"><span class="icon">⚙️</span>Steel</button>
                            <button class="material-btn" data-mat="2"><span class="icon">🧊</span>Plastic</button>
                            <button class="material-btn" data-mat="3"><span class="icon">🪵</span>Wood</button>
                            <button class="material-btn" data-mat="4"><span class="icon">🥇</span>Brass</button>
                            <button class="material-btn" data-mat="5"><span class="icon">🧬</span>Composite</button>
                            <button class="material-btn" data-mat="6"><span class="icon">🔶</span>Copper</button>
                        </div>
                    </div>
                    
                    <div class="setup-section">
                        <label>What operation? <span>(roughing is noisier)</span></label>
                        <div class="operation-grid" id="setup-operations">
                            <button class="op-btn active" data-op="0">Roughing</button>
                            <button class="op-btn" data-op="1">Finishing</button>
                            <button class="op-btn" data-op="2">Drilling</button>
                            <button class="op-btn" data-op="3">Slotting</button>
                        </div>
                    </div>
                    
                    <div class="setup-section">
                        <label>Tool info <span>(tooth passing frequency = RPM × flutes ÷ 60)</span></label>
                        <div class="tool-inputs">
                            <div class="tool-input">
                                <label>Diameter (mm)</label>
                                <input type="number" id="setup-tool-dia" value="${this.state.toolDia}" step="0.5" min="0.5" max="25">
                            </div>
                            <div class="tool-input">
                                <label>Flutes</label>
                                <input type="number" id="setup-tool-flutes" value="${this.state.toolFlutes}" step="1" min="1" max="8">
                            </div>
                            <div class="tool-input">
                                <label>RPM</label>
                                <input type="number" id="setup-tool-rpm" value="${this.state.rpm}" step="500" min="1000" max="30000">
                            </div>
                        </div>
                    </div>
                    
                    <div class="setup-note">
                        💡 <strong>Why this matters:</strong> Mini mills have lower rigidity than industrial machines. 
                        Different materials chatter at different frequencies. Aluminum chatters high (1-3kHz), 
                        steel lower (200-800Hz). Tool diameter and flutes affect the tooth passing frequency, 
                        which we need to filter out from real chatter.
                    </div>
                </div>
                <div class="setup-footer">
                    <button class="setup-btn secondary" onclick="document.getElementById('chatter-setup-modal').remove()">Cancel</button>
                    <button class="setup-btn primary" id="setup-apply-btn">Apply Settings</button>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        
        // State for selections
        let selectedMat = this.state.materialIndex || 0;
        let selectedOp = this.state.operation || 0;
        
        // Material buttons
        const matBtns = modal.querySelectorAll('#setup-materials .material-btn');
        matBtns.forEach(btn => {
            if (parseInt(btn.dataset.mat) === selectedMat) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
            btn.onclick = () => {
                matBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                selectedMat = parseInt(btn.dataset.mat);
            };
        });
        
        // Operation buttons
        const opBtns = modal.querySelectorAll('#setup-operations .op-btn');
        opBtns.forEach(btn => {
            if (parseInt(btn.dataset.op) === selectedOp) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
            btn.onclick = () => {
                opBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                selectedOp = parseInt(btn.dataset.op);
            };
        });
        
        // Apply button
        document.getElementById('setup-apply-btn').onclick = () => {
            const dia = parseFloat(document.getElementById('setup-tool-dia').value) || 6;
            const flutes = parseInt(document.getElementById('setup-tool-flutes').value) || 2;
            const rpm = parseInt(document.getElementById('setup-tool-rpm').value) || 10000;
            
            this.setMaterial(selectedMat);
            this.setOperation(selectedOp);
            this.setTool(dia, flutes, rpm);
            
            modal.remove();
            console.log(`[Chatter] Setup: ${this.materials[selectedMat]}, op=${selectedOp}, ${dia}mm ${flutes}F @${rpm}RPM`);
        };
    }
    
    setWeights(audio, accel, current) {
        // Normalize to sum to 1.0
        const sum = audio + accel + current;
        this.send(JSON.stringify({
            wAudio: audio / sum,
            wAccel: accel / sum,
            wCurrent: current / sum
        }));
    }
    
    setThreshold(threshold) {
        this.send(JSON.stringify({ threshold }));
    }
    
    send(message) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(message);
        }
    }
    
    setEspAddress(ip) {
        this.wsUrl = `ws://${ip}/ws`;
        localStorage.setItem('chatterEspIp', ip);
        this.disconnect();
        this.connect();
    }
    
    // Toggle USB Serial connection
    async toggleSerialConnection() {
        if (this.serialMode && this.connected) {
            await this.disconnectSerial();
        } else {
            // Disconnect WiFi if connected
            if (this.connected && !this.serialMode) {
                this.disconnect();
            }
            await this.connectSerial();
        }
    }
    
    // Toggle WiFi WebSocket connection
    toggleWsConnection() {
        if (!this.serialMode && this.connected) {
            this.disconnect();
            this._updateConnectButtons();
        } else {
            // Disconnect serial if connected
            if (this.serialMode && this.connected) {
                this.disconnectSerial();
            }
            this.connect();
            this._updateConnectButtons();
        }
    }
    
    // Open the web-based update page on ESP32
    openUpdatePage() {
        const ip = localStorage.getItem('chatterEspIp') || '192.168.1.100';
        const url = ip.includes('.local') ? `http://${ip}` : `http://${ip}`;
        window.open(url, '_blank');
    }
    
    // Switch ESP32 to AP mode for WiFi setup
    startApMode() {
        if (confirm('Switch ESP32 to WiFi setup mode?\\n\\nYou will need to:\\n1. Connect to WiFi "ChatterDetect" (password: chatter123)\\n2. Go to 192.168.4.1\\n3. Enter your WiFi credentials')) {
            this.send('apMode');
            setTimeout(() => {
                alert('ESP32 is now in AP mode.\\n\\nConnect to WiFi: ChatterDetect\\nPassword: chatter123\\nGo to: http://192.168.4.1');
            }, 1000);
        }
    }
    
    // Reboot ESP32
    reboot() {
        if (confirm('Reboot the chatter detection ESP32?')) {
            this.send('reboot');
        }
    }
    
    // Get network info
    getNetworkInfo() {
        this.send('network');
    }
    
    // History for graphing
    updateHistory() {
        this.history.combined.push(this.state.combined);
        this.history.amps.push(this.state.amps);
        this.history.feed.push(this.state.feed);
        this.history.trend.push(this.state.trend);
        
        // Trim to max length
        const max = this.history.maxLength;
        if (this.history.combined.length > max) {
            this.history.combined.shift();
            this.history.amps.shift();
            this.history.feed.shift();
            this.history.trend.shift();
        }
        
        // CRITICAL: Run broken endmill detection
        this._detectBrokenEndmill();
        
        // IMPROVED: Run enhanced chatter analysis
        this._analyzeChatterPatterns();
        
        // Update session statistics
        this.updateSessionStats();
        
        // Record sample if recording
        this.recordSample();
    }
    
    // ========================================================================
    // BROKEN ENDMILL DETECTION
    // ========================================================================
    // Detects broken endmill in THREE scenarios:
    // 1. PLUNGE WITH NO LOAD - Tool plunges into material but no cutting sound
    // 2. CUTTING MOVES WITH NO LOAD - XY moves at cutting Z but no sound/current
    // 3. SUDDEN SILENCE - Was cutting, now silent (tool broke mid-cut)
    
    _detectBrokenEndmill() {
        const bed = this.state.brokenEndmillDetection;
        if (!bed.enabled) return;
        
        const now = Date.now();
        const audio = this.state.audio || 0;
        const amps = this.state.amps || 0;
        const spindleRunning = this.state.spindleRunning || this.state.rpm > 1000;
        const machineState = this._getMachineState();
        const isMoving = machineState.isMoving;
        const currentZ = machineState.z;
        
        // Thresholds for "cutting is happening"
        const audioThreshold = bed.minCuttingAudio || 0.12;  // Above noise floor
        const ampsThreshold = (this.state.idleCurrent || 0.5) * 1.3;  // 30% above idle
        const isCuttingNow = audio > audioThreshold || amps > ampsThreshold;
        
        // Track Z position for plunge detection
        if (bed.lastZ === undefined) bed.lastZ = currentZ;
        const zDelta = currentZ - bed.lastZ;
        const isPlunging = zDelta < -0.1;  // Moving down by > 0.1mm
        const isAtCuttingDepth = currentZ < (bed.safeZ || 0);  // Below safe Z
        bed.lastZ = currentZ;
        
        // ========== SCENARIO 1: PLUNGE WITH NO LOAD ==========
        // If we're plunging (Z going down) with spindle on, we SHOULD see load increase
        if (isPlunging && spindleRunning && isMoving) {
            bed.plungeStartedAt = bed.plungeStartedAt || now;
            const plungeDuration = now - bed.plungeStartedAt;
            
            // Give it 300ms after plunge starts to register cutting
            if (plungeDuration > 300 && !isCuttingNow) {
                // Plunging but no cutting detected!
                if (!bed.plungeNoLoadWarned) {
                    console.warn('[BROKEN ENDMILL] ⚠️ Plunge detected but NO cutting load!',
                        'Z:', currentZ.toFixed(2), 'Audio:', audio.toFixed(2), 'Amps:', amps.toFixed(2));
                    bed.plungeNoLoadWarned = true;
                }
                
                // Build confidence the longer we plunge without load
                let confidence = Math.min(80, 30 + (plungeDuration / 10));  // Up to 80% over ~500ms
                this.state.toolBrokenConfidence = Math.max(this.state.toolBrokenConfidence, Math.round(confidence));
                
                if (plungeDuration > bed.silenceThresholdMs) {
                    this.state.toolBroken = true;
                    console.error('[BROKEN ENDMILL] 🔴 TOOL BROKEN - Plunge with no load for', plungeDuration, 'ms');
                }
            }
        } else {
            // Not plunging - reset plunge tracking
            bed.plungeStartedAt = 0;
            bed.plungeNoLoadWarned = false;
        }
        
        // ========== SCENARIO 2: CUTTING MOVES WITH NO LOAD ==========
        // If at cutting depth, spindle on, XY moving, there SHOULD be cutting load
        if (isAtCuttingDepth && spindleRunning && isMoving && !isPlunging) {
            // We're at cutting depth making XY moves - should be cutting!
            if (!isCuttingNow) {
                // Start or continue "no load" timer
                if (bed.noLoadStartedAt === 0) {
                    bed.noLoadStartedAt = now;
                    console.warn('[BROKEN ENDMILL] ⚠️ At cutting depth but NO load detected!',
                        'Z:', currentZ.toFixed(2), 'Audio:', audio.toFixed(2));
                }
                
                bed.noLoadDuration = now - bed.noLoadStartedAt;
                
                // Build confidence based on duration at cutting depth without load
                let confidence = Math.min(90, 20 + (bed.noLoadDuration / bed.silenceThresholdMs) * 70);
                this.state.toolBrokenConfidence = Math.max(this.state.toolBrokenConfidence, Math.round(confidence));
                
                if (bed.noLoadDuration >= bed.silenceThresholdMs) {
                    this.state.toolBroken = true;
                    console.error('[BROKEN ENDMILL] 🔴 TOOL BROKEN - At cutting depth with no load for', 
                        bed.noLoadDuration, 'ms');
                }
            } else {
                // We ARE cutting - this is good! Record the levels
                bed.lastCuttingAudio = Math.max(bed.lastCuttingAudio, audio);
                bed.lastCuttingAmps = Math.max(bed.lastCuttingAmps, amps);
                bed.cuttingConfirmedAt = now;
                bed.wasConfirmedCutting = true;
                bed.noLoadStartedAt = 0;
                bed.noLoadDuration = 0;
                
                // Clear any previous alert since we're cutting fine now
                if (this.state.toolBroken) {
                    console.log('[BROKEN ENDMILL] ✓ Cutting resumed - clearing alert');
                }
                this.state.toolBroken = false;
                this.state.toolBrokenConfidence = 0;
            }
        }
        
        // ========== SCENARIO 3: SUDDEN SILENCE (MID-CUT BREAK) ==========
        // We WERE cutting, but now suddenly silent
        if (bed.wasConfirmedCutting && spindleRunning && isMoving && isAtCuttingDepth) {
            if (!isCuttingNow && bed.lastCuttingAudio > 0) {
                const audioDrop = (bed.lastCuttingAudio - audio) / bed.lastCuttingAudio;
                const ampsDrop = bed.lastCuttingAmps > ampsThreshold 
                    ? (bed.lastCuttingAmps - amps) / bed.lastCuttingAmps 
                    : 0;
                
                // Significant drop from previously confirmed cutting levels?
                if (audioDrop > bed.audioDropThreshold || ampsDrop > bed.ampsDropThreshold) {
                    if (bed.silenceStartedAt === 0) {
                        bed.silenceStartedAt = now;
                        console.warn('[BROKEN ENDMILL] ⚠️ Sudden silence! Audio dropped', 
                            (audioDrop * 100).toFixed(0) + '%',
                            'from', bed.lastCuttingAudio.toFixed(2), 'to', audio.toFixed(2));
                    }
                    
                    bed.silenceDuration = now - bed.silenceStartedAt;
                    
                    // High confidence since we KNOW it was cutting before
                    let confidence = 40;  // Start at 40% since we had confirmed cutting
                    confidence += Math.min(30, audioDrop * 40);
                    confidence += Math.min(30, (bed.silenceDuration / bed.silenceThresholdMs) * 30);
                    
                    this.state.toolBrokenConfidence = Math.min(100, Math.round(confidence));
                    
                    if (bed.silenceDuration >= bed.silenceThresholdMs && confidence >= 60) {
                        this.state.toolBroken = true;
                        console.error('[BROKEN ENDMILL] 🔴 TOOL BROKE MID-CUT!',
                            'Was cutting at', bed.lastCuttingAudio.toFixed(2),
                            'Now:', audio.toFixed(2),
                            'Silent for:', bed.silenceDuration, 'ms');
                    }
                }
            }
        }
        
        // ========== RESET CONDITIONS ==========
        // If spindle off, not moving, or safely retracted - reset everything
        if (!spindleRunning || !isMoving || currentZ > (bed.safeZ || 0) + 5) {
            if (bed.wasConfirmedCutting || bed.noLoadDuration > 0) {
                // Only log if we were actually tracking something
                if (currentZ > (bed.safeZ || 0)) {
                    console.log('[BROKEN ENDMILL] Tool retracted to safe Z - resetting detection');
                }
            }
            bed.wasConfirmedCutting = false;
            bed.silenceStartedAt = 0;
            bed.silenceDuration = 0;
            bed.noLoadStartedAt = 0;
            bed.noLoadDuration = 0;
            // Don't clear toolBroken here - let checkAlerts handle it
            // Only clear if tool retracted successfully
            if (currentZ > (bed.safeZ || 0) + 5 && !isMoving) {
                this.state.toolBrokenConfidence = 0;
            }
        }
    }
    
    /**
     * Get machine state including position and movement status
     */
    _getMachineState() {
        const grbl = window.app?.grbl;
        const appState = window.app?.state;
        
        // Get status string
        const status = grbl?.state?.status || appState?.status || '';
        const isMoving = status === 'Run' || status === 'Jog' || grbl?.streaming;
        
        // Get position - try multiple sources
        let z = 0;
        if (grbl?.state?.wpos?.z !== undefined) {
            z = grbl.state.wpos.z;
        } else if (grbl?.state?.mpos?.z !== undefined) {
            z = grbl.state.mpos.z;
        } else if (appState?.position?.z !== undefined) {
            z = appState.position.z;
        } else if (this.state.posZ !== undefined) {
            z = this.state.posZ;
        }
        
        return {
            status,
            isMoving,
            z: z,
            x: grbl?.state?.wpos?.x || appState?.position?.x || this.state.posX || 0,
            y: grbl?.state?.wpos?.y || appState?.position?.y || this.state.posY || 0
        };
    }
    
    // ========================================================================
    // BREAK RECOVERY - Capture where tool broke and find spare
    // ========================================================================
    
    /**
     * Capture break info when tool breaks - enables resume after tool change
     */
    _captureBreakInfo() {
        const grbl = window.app?.grbl;
        const recovery = this.state.breakRecovery;
        const machineState = this._getMachineState();
        
        // Get current G-code line number
        recovery.lineNumber = grbl?.streamLineNumber || grbl?.state?.lineNumber || 0;
        
        // Get the actual G-code line if available
        if (grbl?.streamQueue && grbl.streamQueue.length > 0) {
            recovery.gcodeLine = grbl.streamQueue[0] || '';
        } else if (grbl?.lastSentLine) {
            recovery.gcodeLine = grbl.lastSentLine;
        }
        
        // Get current position
        recovery.position = {
            x: machineState.x,
            y: machineState.y,
            z: machineState.z
        };
        
        // Get current tool
        recovery.toolNumber = grbl?.state?.tool || 
                              window.app?.state?.currentTool || 
                              this.state.toolDia ? 1 : 0;  // Fallback to T1 if unknown
        
        recovery.timestamp = Date.now();
        recovery.canResume = recovery.lineNumber > 0;
        
        console.log('[BREAK RECOVERY] 📍 Captured break position:', {
            line: recovery.lineNumber,
            gcode: recovery.gcodeLine,
            position: recovery.position,
            tool: recovery.toolNumber
        });
        
        // Store in the bed.breakInfo too for cross-reference
        this.state.brokenEndmillDetection.breakInfo = {
            lineNumber: recovery.lineNumber,
            gcodeLine: recovery.gcodeLine,
            position: { ...recovery.position },
            timestamp: recovery.timestamp,
            toolNumber: recovery.toolNumber
        };
    }
    
    /**
     * Check ATC tool table for a spare tool with matching specs
     */
    _checkForSpareTool() {
        const recovery = this.state.breakRecovery;
        const brokenTool = recovery.toolNumber;
        
        // Try to get tool table from app
        const toolTable = window.app?.toolTable || 
                          window.app?.grbl?.toolTable || 
                          window.app?.atc?.tools || 
                          null;
        
        if (!toolTable) {
            console.log('[ATC] No tool table available - manual tool change required');
            recovery.spareToolFound = false;
            return;
        }
        
        // Get specs of broken tool
        const brokenToolSpecs = toolTable[brokenTool];
        if (!brokenToolSpecs) {
            console.log('[ATC] Broken tool specs not found in tool table');
            recovery.spareToolFound = false;
            return;
        }
        
        // Search for matching spare
        // Match criteria: same diameter, same type, same number of flutes
        for (const [toolNum, specs] of Object.entries(toolTable)) {
            const tNum = parseInt(toolNum);
            if (tNum === brokenTool) continue;  // Skip broken tool
            
            // Check if this tool matches
            const diameterMatch = Math.abs((specs.diameter || 0) - (brokenToolSpecs.diameter || 0)) < 0.01;
            const typeMatch = specs.type === brokenToolSpecs.type;
            const flutesMatch = specs.flutes === brokenToolSpecs.flutes;
            const isAvailable = specs.available !== false && specs.broken !== true;
            
            if (diameterMatch && typeMatch && flutesMatch && isAvailable) {
                recovery.spareToolFound = true;
                recovery.spareToolNumber = tNum;
                console.log(`[ATC] ✅ Found spare tool T${tNum}!`, specs);
                return;
            }
        }
        
        // No exact match - try diameter-only match
        for (const [toolNum, specs] of Object.entries(toolTable)) {
            const tNum = parseInt(toolNum);
            if (tNum === brokenTool) continue;
            
            const diameterMatch = Math.abs((specs.diameter || 0) - (brokenToolSpecs.diameter || 0)) < 0.01;
            const isAvailable = specs.available !== false && specs.broken !== true;
            
            if (diameterMatch && isAvailable) {
                recovery.spareToolFound = true;
                recovery.spareToolNumber = tNum;
                console.log(`[ATC] ⚠️ Found similar tool T${tNum} (diameter match only)`, specs);
                return;
            }
        }
        
        console.log('[ATC] ❌ No spare tool found matching T' + brokenTool);
        recovery.spareToolFound = false;
    }
    
    /**
     * Get recovery info for UI/API
     */
    getBreakRecoveryInfo() {
        const r = this.state.breakRecovery;
        return {
            canResume: r.canResume,
            lineNumber: r.lineNumber,
            resumeFromLine: Math.max(0, r.lineNumber - r.rewindLines),
            gcodeLine: r.gcodeLine,
            position: r.position,
            brokenTool: r.toolNumber,
            spareAvailable: r.spareToolFound,
            spareTool: r.spareToolNumber,
            timestamp: r.timestamp,
            timeAgo: r.timestamp ? Math.round((Date.now() - r.timestamp) / 1000) + 's ago' : 'N/A'
        };
    }
    
    /**
     * Generate G-code to resume after tool change
     * @param {boolean} useSpare - Use the spare tool if available
     */
    generateResumeGcode(useSpare = true) {
        const r = this.state.breakRecovery;
        if (!r.canResume) {
            console.error('[RESUME] No break info available');
            return null;
        }
        
        const toolToUse = (useSpare && r.spareToolFound) ? r.spareToolNumber : r.toolNumber;
        const resumeLine = Math.max(0, r.lineNumber - r.rewindLines);
        
        // Generate safe resume sequence
        const gcode = [
            '; === BREAK RECOVERY SEQUENCE ===',
            `; Broken at line ${r.lineNumber}: ${r.gcodeLine}`,
            `; Resuming from line ${resumeLine}`,
            '',
            'G90 ; Absolute mode',
            'G21 ; Metric mode',
            `G0 Z${this.state.brokenEndmillDetection.safeZ + 10} ; Safe Z`,
            '',
            `; Tool change to T${toolToUse}`,
            `M6 T${toolToUse}`,
            '',
            '; Move to break position XY',
            `G0 X${r.position.x.toFixed(3)} Y${r.position.y.toFixed(3)}`,
            '',
            '; Probe Z or manual tool length',
            '; G38.2 Z-50 F100 ; Optional: probe for Z',
            '',
            `; Ready to resume from line ${resumeLine}`,
            '; Use "Resume from Line" in job control',
            '; === END RECOVERY SEQUENCE ==='
        ];
        
        return {
            gcode: gcode.join('\n'),
            resumeFromLine: resumeLine,
            tool: toolToUse,
            position: r.position
        };
    }
    
    // ========================================================================
    // ADVANCED AI CHATTER ANALYSIS
    // ========================================================================
    
    /**
     * Run all AI analysis on current data
     * Called from _analyzeChatterPatterns
     */
    _runAIAnalysis() {
        const ai = this.state.aiChatter;
        const audio = this.state.audio || 0;
        const amps = this.state.amps || 0;
        const freq = this.state.freq || 0;
        
        // 1. Load profiling - learn normal
        this._updateLoadProfile(audio, amps);
        
        // 2. Frequency shift detection
        this._detectFrequencyShift(freq);
        
        // 3. Spike detection
        this._detectSpikes(audio);
        
        // 4. Stability lobe estimation
        this._estimateStabilityLobe();
        
        // 5. Tool wear audio signature
        this._updateToolWearAudio();
        
        // 6. VFD current analysis
        this._analyzeVfdCurrent();
    }
    
    /**
     * Analyze VFD current for anomalies
     * - Sudden drop = broken tool
     * - High current = overload/stall
     * - Current spikes = chatter confirmation
     */
    _analyzeVfdCurrent() {
        const vfd = this.state.vfd;
        if (!vfd.ok || !vfd.run) return;
        
        // Initialize VFD current history if needed
        if (!this._vfdCurrentHistory) {
            this._vfdCurrentHistory = [];
            this._vfdIdleCurrent = 0;
            this._vfdCurrentBaseline = 0;
            this._vfdCurrentLearned = false;
        }
        
        const current = vfd.amps || 0;
        const now = Date.now();
        
        // Add to history
        this._vfdCurrentHistory.push({ amps: current, time: now });
        
        // Keep last 5 seconds (at 2Hz polling = 10 samples)
        while (this._vfdCurrentHistory.length > 20) {
            this._vfdCurrentHistory.shift();
        }
        
        // Learn idle current (when running but not cutting)
        if (this._vfdCurrentHistory.length >= 5 && !this._vfdCurrentLearned) {
            const avg = this._vfdCurrentHistory.reduce((s, v) => s + v.amps, 0) / this._vfdCurrentHistory.length;
            if (avg < 3) {  // Typical idle is 0.5-2A
                this._vfdIdleCurrent = avg;
                this._vfdCurrentLearned = true;
                console.log(`[VFD] Learned idle current: ${avg.toFixed(2)} A`);
            }
        }
        
        // Learn cutting baseline (when cutting load is stable)
        if (this.state.cutting && this._vfdCurrentHistory.length >= 10) {
            const recentAvg = this._vfdCurrentHistory.slice(-5).reduce((s, v) => s + v.amps, 0) / 5;
            if (recentAvg > this._vfdIdleCurrent + 1) {
                // Use exponential moving average
                if (this._vfdCurrentBaseline === 0) {
                    this._vfdCurrentBaseline = recentAvg;
                } else {
                    this._vfdCurrentBaseline = this._vfdCurrentBaseline * 0.9 + recentAvg * 0.1;
                }
            }
        }
        
        // Detect anomalies
        if (this._vfdCurrentBaseline > 0 && this.state.cutting) {
            const loadRatio = current / this._vfdCurrentBaseline;
            
            // Sudden drop = potential tool breakage
            if (loadRatio < 0.3 && this._vfdCurrentHistory.length > 5) {
                const prevAvg = this._vfdCurrentHistory.slice(-5, -1).reduce((s, v) => s + v.amps, 0) / 4;
                if (prevAvg > this._vfdCurrentBaseline * 0.7) {
                    console.warn('[VFD] ⚠️ Sudden current drop detected - possible tool break!');
                    this.onAlert({
                        type: 'vfd_anomaly',
                        message: '⚠️ VFD current dropped suddenly - check tool!',
                        current: current,
                        baseline: this._vfdCurrentBaseline
                    });
                }
            }
            
            // High current = overload
            if (loadRatio > 1.5) {
                console.warn(`[VFD] High load: ${(loadRatio * 100).toFixed(0)}% of baseline`);
                if (loadRatio > 2.0 && !this._vfdOverloadWarned) {
                    this._vfdOverloadWarned = true;
                    this.onAlert({
                        type: 'vfd_overload',
                        message: `🔴 VFD overload! ${current.toFixed(1)}A (${(loadRatio * 100).toFixed(0)}% of normal)`,
                        current: current,
                        baseline: this._vfdCurrentBaseline
                    });
                    this.playOverloadAlert();
                }
            } else {
                this._vfdOverloadWarned = false;
            }
            
            // Current ripple = chatter indicator
            if (this._vfdCurrentHistory.length >= 6) {
                const recent = this._vfdCurrentHistory.slice(-6);
                const min = Math.min(...recent.map(v => v.amps));
                const max = Math.max(...recent.map(v => v.amps));
                const ripple = (max - min) / this._vfdCurrentBaseline;
                
                if (ripple > 0.3) {
                    // High current ripple often correlates with chatter
                    console.log(`[VFD] Current ripple: ${(ripple * 100).toFixed(0)}% - possible chatter`);
                }
            }
        }
    }
    
    /**
     * Learn what "normal" cutting looks like for anomaly detection
     */
    _updateLoadProfile(audio, amps) {
        const lp = this.state.aiChatter.loadProfile;
        if (!lp.enabled) return;
        
        // Only learn when actually cutting
        if (!this.state.cutting && !this.state.brokenEndmillDetection.wasConfirmedCutting) return;
        
        // Add sample
        lp.samples.push({ audio, amps, time: Date.now() });
        
        // Trim to max
        while (lp.samples.length > lp.maxSamples) {
            lp.samples.shift();
        }
        
        // Need enough samples to learn
        if (lp.samples.length < 50) return;
        
        // Calculate baseline and std dev
        const audioValues = lp.samples.map(s => s.audio);
        const mean = audioValues.reduce((a, b) => a + b, 0) / audioValues.length;
        const variance = audioValues.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / audioValues.length;
        const stdDev = Math.sqrt(variance);
        
        lp.baseline = mean;
        lp.stdDev = stdDev;
        lp.isLearned = lp.samples.length >= 100;
        
        // Check for anomaly
        if (lp.isLearned && stdDev > 0) {
            const deviation = Math.abs(audio - lp.baseline) / stdDev;
            if (deviation > lp.anomalyThreshold) {
                console.warn('[AI] Load anomaly detected!', deviation.toFixed(1), 'std devs from baseline');
            }
        }
    }
    
    /**
     * Detect chatter frequency shifting (indicates tool wear or changing cut)
     */
    _detectFrequencyShift(currentFreq) {
        const fs = this.state.aiChatter.freqShift;
        if (!fs.enabled || currentFreq < 100) return;  // Ignore low frequencies
        
        // Add to history
        fs.freqHistory.push({ freq: currentFreq, time: Date.now() });
        
        // Keep last 50 samples
        while (fs.freqHistory.length > 50) {
            fs.freqHistory.shift();
        }
        
        if (fs.freqHistory.length < 10) {
            fs.lastFreq = currentFreq;
            return;
        }
        
        // Calculate shift rate (Hz per second)
        const firstSample = fs.freqHistory[0];
        const lastSample = fs.freqHistory[fs.freqHistory.length - 1];
        const timeDelta = (lastSample.time - firstSample.time) / 1000;  // seconds
        
        if (timeDelta > 0.5) {
            fs.shiftRate = (lastSample.freq - firstSample.freq) / timeDelta;
            fs.isShifting = Math.abs(fs.shiftRate) > 50;  // >50 Hz/sec is significant
            
            if (fs.isShifting && !fs.shiftWarned) {
                console.warn('[AI] Frequency shift detected!', fs.shiftRate.toFixed(0), 'Hz/sec');
                console.warn('[AI] This may indicate tool wear or changing cut conditions');
                fs.shiftWarned = true;
            }
            
            // Reset warning if stable again
            if (!fs.isShifting) {
                fs.shiftWarned = false;
            }
        }
        
        fs.lastFreq = currentFreq;
    }
    
    /**
     * Detect sudden spikes vs gradual changes
     */
    _detectSpikes(audio) {
        const sd = this.state.aiChatter.spikeDetection;
        if (!sd.enabled) return;
        
        // Calculate delta
        const delta = audio - sd.lastValue;
        const isSpike = Math.abs(delta) > sd.spikeThreshold;
        
        // Track spike history
        sd.spikeHistory.push(isSpike);
        while (sd.spikeHistory.length > sd.spikeWindow) {
            sd.spikeHistory.shift();
        }
        
        // Count recent spikes
        sd.spikeCount = sd.spikeHistory.filter(s => s).length;
        
        // Multiple spikes = intermittent chatter (tool rubbing, interrupted cut)
        if (sd.spikeCount >= 3) {
            this.state.chatterAnalysis.isIntermittent = true;
        }
        
        sd.lastValue = audio;
    }
    
    /**
     * Estimate stability lobe position based on RPM and chatter frequency
     */
    _estimateStabilityLobe() {
        const sl = this.state.aiChatter.stabilityLobe;
        if (!sl.enabled) return;
        
        const rpm = this.state.rpm || 10000;
        const freq = this.state.freq || 0;
        const flutes = this.state.toolFlutes || 2;
        
        if (freq < 200) {
            sl.lobePosition = 'unknown';
            return;
        }
        
        sl.currentRpm = rpm;
        
        // Tooth passing frequency
        const toothFreq = (rpm / 60) * flutes;
        
        // If chatter frequency is close to tooth passing frequency or harmonics, we're stable
        const ratio = freq / toothFreq;
        const nearestHarmonic = Math.round(ratio);
        const harmonicError = Math.abs(ratio - nearestHarmonic);
        
        if (harmonicError < 0.1) {
            // Very close to harmonic - this is normal cutting, not chatter
            sl.lobePosition = 'stable';
            sl.suggestedChange = 0;
        } else if (harmonicError < 0.25) {
            // Near boundary
            sl.lobePosition = 'boundary';
            // Suggest moving to nearest stable lobe
            const stableFreq = toothFreq * nearestHarmonic;
            const neededRpm = (stableFreq / nearestHarmonic) * 60 / flutes * nearestHarmonic;
            sl.suggestedChange = Math.round(neededRpm - rpm);
            sl.optimalRpm = Math.round(neededRpm);
        } else {
            // In unstable region
            sl.lobePosition = 'unstable';
            // Suggest 10-15% RPM change to shift to stable lobe
            sl.suggestedChange = Math.round(rpm * 0.12) * (Math.random() > 0.5 ? 1 : -1);
            sl.optimalRpm = rpm + sl.suggestedChange;
        }
    }
    
    /**
     * Track audio signature for tool wear estimation
     * Compares current audio spectrum to initial "new tool" baseline
     */
    _updateToolWearAudio() {
        const twa = this.state.aiChatter.toolWearAudio;
        if (!twa.enabled) return;
        
        // Create signature from current audio/frequency
        const currentSig = {
            audio: this.state.audio || 0,
            freq: this.state.freq || 0,
            accel: this.state.accel || 0,
            time: Date.now()
        };
        
        // If no initial signature, capture it (new tool)
        if (!twa.initialSignature && this.state.cutting) {
            twa.initialSignature = { ...currentSig };
            console.log('[AI] 📊 Captured initial tool signature');
            return;
        }
        
        // Update current signature
        twa.currentSignature = currentSig;
        
        // Calculate signature shift (difference from initial)
        if (twa.initialSignature && twa.currentSignature) {
            const audioDiff = Math.abs(currentSig.audio - twa.initialSignature.audio);
            const freqDiff = Math.abs(currentSig.freq - twa.initialSignature.freq);
            
            // Normalize and combine
            const audioShift = audioDiff / Math.max(twa.initialSignature.audio, 0.1);
            const freqShift = freqDiff / Math.max(twa.initialSignature.freq, 100);
            
            twa.signatureShift = (audioShift * 0.6 + freqShift * 0.4) * 100;
            
            // Estimate wear - signature shift correlates with wear
            // A 30% signature shift typically means 50% tool wear
            twa.wearEstimate = Math.min(100, twa.signatureShift * 1.67);
        }
    }
    
    /**
     * Get suggestions for reducing chatter
     * Returns actionable recommendations based on current state
     */
    getSuggestedActions() {
        const suggestions = [];
        const ai = this.state.aiChatter;
        const ca = this.state.chatterAnalysis;
        
        // 1. Stability lobe based RPM suggestion
        if (ai.stabilityLobe.lobePosition === 'unstable') {
            suggestions.push({
                type: 'rpm',
                priority: 'high',
                icon: '🔄',
                action: `Change RPM to ${ai.stabilityLobe.optimalRpm}`,
                reason: 'Move to stable machining lobe',
                command: `M3 S${ai.stabilityLobe.optimalRpm}`
            });
        } else if (ai.stabilityLobe.lobePosition === 'boundary') {
            suggestions.push({
                type: 'rpm',
                priority: 'medium',
                icon: '⚡',
                action: `Adjust RPM by ${ai.stabilityLobe.suggestedChange > 0 ? '+' : ''}${ai.stabilityLobe.suggestedChange}`,
                reason: 'Near stability boundary',
                command: null  // Relative adjustment
            });
        }
        
        // 2. Feed rate reduction if overloaded
        if (this.state.overload || ca.isProgressive) {
            const currentFeed = this.state.feed || 100;
            const suggestedFeed = Math.max(this.state.minFeed || 30, currentFeed * 0.75);
            suggestions.push({
                type: 'feed',
                priority: 'high',
                icon: '⬇️',
                action: `Reduce feed to ${Math.round(suggestedFeed)}%`,
                reason: 'High load detected',
                command: null  // Use feed override
            });
        }
        
        // 3. Depth of cut reduction for severe chatter
        if (ca.isResonant && ca.chatterConfidence > 70) {
            suggestions.push({
                type: 'doc',
                priority: 'high',
                icon: '📏',
                action: 'Reduce depth of cut by 30-50%',
                reason: 'Resonant chatter - exceeding stability limit',
                command: null  // Manual adjustment needed
            });
        }
        
        // 4. Tool change if worn
        if (ai.toolWearAudio.wearEstimate > 60) {
            suggestions.push({
                type: 'tool',
                priority: 'medium',
                icon: '🔧',
                action: 'Consider tool change',
                reason: `Tool wear estimated at ${Math.round(ai.toolWearAudio.wearEstimate)}%`,
                command: null
            });
        }
        
        // 5. Width of cut adjustment for intermittent chatter
        if (ca.isIntermittent) {
            suggestions.push({
                type: 'woc',
                priority: 'low',
                icon: '↔️',
                action: 'Adjust stepover/width of cut',
                reason: 'Intermittent engagement detected',
                command: null
            });
        }
        
        // 6. Frequency shift warning
        if (ai.freqShift.isShifting) {
            suggestions.push({
                type: 'warning',
                priority: 'medium',
                icon: '📈',
                action: 'Check tool condition',
                reason: `Chatter frequency shifting at ${Math.abs(ai.freqShift.shiftRate).toFixed(0)} Hz/sec`,
                command: null
            });
        }
        
        // Sort by priority
        const priorityOrder = { high: 0, medium: 1, low: 2 };
        suggestions.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);
        
        return suggestions;
    }
    
    /**
     * Reset tool signature for new tool
     * Call this after tool change
     */
    resetToolSignature() {
        const twa = this.state.aiChatter.toolWearAudio;
        twa.initialSignature = null;
        twa.currentSignature = null;
        twa.wearEstimate = 0;
        twa.signatureShift = 0;
        console.log('[AI] 🔧 Tool signature reset - will capture new baseline on next cut');
    }
    
    // ========================================================================
    // IMPROVED CHATTER PATTERN ANALYSIS
    // ========================================================================
    // Multi-band frequency analysis and pattern recognition for better
    // chatter detection accuracy and earlier warnings
    
    _analyzeChatterPatterns() {
        const ca = this.state.chatterAnalysis;
        const audio = this.state.audio || 0;
        const accel = this.state.accel || 0;
        
        // Add to audio history
        ca.audioHistory.push({
            audio: audio,
            accel: accel,
            time: Date.now()
        });
        
        // Trim history
        while (ca.audioHistory.length > ca.audioHistoryMax) {
            ca.audioHistory.shift();
        }
        
        // Need enough samples for analysis
        if (ca.audioHistory.length < 10) return;
        
        // Calculate audio statistics
        const audioValues = ca.audioHistory.map(h => h.audio);
        const audioMean = audioValues.reduce((a, b) => a + b, 0) / audioValues.length;
        const audioVariance = audioValues.reduce((sum, v) => sum + Math.pow(v - audioMean, 2), 0) / audioValues.length;
        const audioStdDev = Math.sqrt(audioVariance);
        
        // Calculate accel statistics
        const accelValues = ca.audioHistory.map(h => h.accel);
        const accelMean = accelValues.reduce((a, b) => a + b, 0) / accelValues.length;
        
        // PATTERN DETECTION
        
        // 1. RESONANT CHATTER: Low variance, high sustained level
        //    This is sustained single-frequency chatter - the bad kind
        ca.isResonant = audioMean > ca.audioThreshold && 
                         audioStdDev < 0.05 &&
                         accelMean > ca.accelThreshold * 0.5;
        
        // 2. INTERMITTENT CHATTER: High variance, on-off pattern
        //    Often indicates tool rubbing or interrupted cuts
        ca.isIntermittent = audioVariance > 0.02 && 
                            audioMean > ca.audioThreshold * 0.7;
        
        // 3. PROGRESSIVE CHATTER: Getting worse over time
        //    Compare first half to second half of history
        const halfLen = Math.floor(audioValues.length / 2);
        const firstHalf = audioValues.slice(0, halfLen);
        const secondHalf = audioValues.slice(halfLen);
        const firstMean = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
        const secondMean = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;
        ca.isProgressive = secondMean > firstMean * 1.2 && secondMean > ca.audioThreshold * 0.8;
        
        // 4. HARMONIC ANALYSIS
        //    Calculate expected tooth passing frequency
        const rpm = this.state.rpm || 10000;
        const flutes = this.state.toolFlutes || 2;
        ca.toothPassFreq = (rpm / 60) * flutes;  // Hz
        
        // Check if dominant frequency matches tooth passing or harmonics
        if (this.state.freq && ca.toothPassFreq > 0) {
            const ratio = this.state.freq / ca.toothPassFreq;
            // Is it a harmonic? (1x, 2x, 3x, etc.)
            const nearestHarmonic = Math.round(ratio);
            const harmonicError = Math.abs(ratio - nearestHarmonic);
            ca.harmonicStrength = harmonicError < 0.15 ? 1 - harmonicError : 0;
            ca.fundamentalFreq = this.state.freq;
        }
        
        // CALCULATE COMPONENT SCORES
        ca.audioScore = Math.min(1, audio / ca.audioThreshold) * 0.35;
        ca.accelScore = Math.min(1, accel / ca.accelThreshold) * 0.35;
        ca.harmonicScore = ca.harmonicStrength * 0.15;
        ca.trendScore = ca.isProgressive ? 0.15 : 0;
        
        // CALCULATE CHATTER CONFIDENCE
        let confidence = 0;
        
        // Base score from audio/accel
        if (audio > ca.audioThreshold) confidence += 25;
        if (accel > ca.accelThreshold) confidence += 25;
        
        // Pattern bonuses
        if (ca.isResonant) confidence += 30;  // Resonant is definite chatter
        if (ca.isProgressive) confidence += 15;  // Getting worse
        if (ca.isIntermittent) confidence += 10;  // Intermittent is suspicious
        
        // Harmonic match
        if (ca.harmonicStrength > 0.5) confidence += 15;
        
        // Correlation between audio and accel (should correlate for real chatter)
        const correlation = this._calculateCorrelation(audioValues, accelValues);
        if (correlation > 0.6) confidence += 10;
        
        ca.chatterConfidence = Math.min(100, Math.round(confidence));
        
        // Update state for UI
        this.state.risingChatter = ca.isProgressive;
        this.state.stableChatter = ca.isResonant;
        this.state.intermittent = ca.isIntermittent;
        this.state.confidence = ca.chatterConfidence;
        
        // Run advanced AI analysis
        this._runAIAnalysis();
    }
    
    /**
     * Calculate Pearson correlation coefficient between two arrays
     */
    _calculateCorrelation(arr1, arr2) {
        const n = Math.min(arr1.length, arr2.length);
        if (n < 3) return 0;
        
        const mean1 = arr1.reduce((a, b) => a + b, 0) / n;
        const mean2 = arr2.reduce((a, b) => a + b, 0) / n;
        
        let num = 0, den1 = 0, den2 = 0;
        for (let i = 0; i < n; i++) {
            const d1 = arr1[i] - mean1;
            const d2 = arr2[i] - mean2;
            num += d1 * d2;
            den1 += d1 * d1;
            den2 += d2 * d2;
        }
        
        const denominator = Math.sqrt(den1 * den2);
        return denominator > 0 ? num / denominator : 0;
    }
    
    // Track session statistics
    updateSessionStats() {
        this.state.totalSamples++;
        this._sessionScoreSum += this.state.combined;
        this._sessionScoreCount++;
        this.state.sessionAvgScore = this._sessionScoreSum / this._sessionScoreCount;
        
        // Track max score
        if (this.state.combined > this.state.sessionMaxScore) {
            this.state.sessionMaxScore = this.state.combined;
        }
        
        // Track chatter events (edge detection - entering chatter zone)
        if (this.state.inChatterZone && !this._sessionLastChatter) {
            this.state.sessionChatterEvents++;
        }
        this._sessionLastChatter = this.state.inChatterZone;
        
        // Track feed reductions
        if (this.state.feed < this._lastFeed) {
            this.state.sessionFeedReductions++;
        } else if (this.state.feed > this._lastFeed && this._lastFeed < 100) {
            this.state.sessionRecoveries++;
        }
        this._lastFeed = this.state.feed;
    }
    
    // Get session summary
    getSessionSummary() {
        const duration = (Date.now() - this.state.sessionStart) / 1000 / 60;  // minutes
        return {
            duration: duration.toFixed(1) + ' min',
            samples: this.state.totalSamples,
            chatterEvents: this.state.sessionChatterEvents,
            feedReductions: this.state.sessionFeedReductions,
            recoveries: this.state.sessionRecoveries,
            maxScore: this.state.sessionMaxScore.toFixed(2),
            avgScore: this.state.sessionAvgScore.toFixed(3),
            toolWear: this.state.toolWear.toFixed(0) + '%',
            cuttingTime: (this.state.cuttingSeconds / 60).toFixed(1) + ' min',
            efficiency: this.state.sessionChatterEvents === 0 ? 
                '100%' : 
                Math.max(0, 100 - this.state.sessionChatterEvents * 5).toFixed(0) + '%'
        };
    }
    
    // Reset session stats
    resetSession() {
        this.state.sessionStart = Date.now();
        this.state.sessionChatterEvents = 0;
        this.state.sessionMaxScore = 0;
        this.state.sessionAvgScore = 0;
        this.state.sessionFeedReductions = 0;
        this.state.sessionRecoveries = 0;
        this.state.totalSamples = 0;
        this._sessionScoreSum = 0;
        this._sessionScoreCount = 0;
        this._sessionLastChatter = false;
        this._lastFeed = 100;
        this.showNotification('Session stats reset', 'success');
    }
    
    // Alert checking with audio and prediction
    checkAlerts() {
        const now = Date.now();
        
        // Check for tool break (ALWAYS alert immediately)
        // IMPROVED: Include confidence level and attempt to stop machine
        if (this.state.toolBroken && !this._lastToolBroken) {
            const confidence = this.state.toolBrokenConfidence || 100;
            const bed = this.state.brokenEndmillDetection;
            
            // CAPTURE BREAK INFO FOR RECOVERY!
            this._captureBreakInfo();
            
            const alert = { 
                type: 'toolBroken', 
                message: `🔴 BROKEN ENDMILL DETECTED! (${confidence}% confidence)`,
                confidence: confidence,
                audioDrop: bed.lastCuttingAudio > 0 ? 
                    Math.round((1 - this.state.audio / bed.lastCuttingAudio) * 100) : 0,
                silenceMs: bed.silenceDuration,
                // Include recovery info
                recovery: this.state.breakRecovery
            };
            this.onAlert(alert);
            this.logAlert(alert);
            this.playToolBreakAlert();
            this.lastChatterAlert = now;
            
            // SAFETY: Attempt to stop the machine!
            if (window.app?.grbl?.emergencyStop) {
                console.error('[SAFETY] Broken endmill - triggering emergency stop!');
                window.app.grbl.emergencyStop();
            } else if (window.app?.grbl?.send) {
                // Fallback: send feed hold
                window.app.grbl.send('!');
            }
            
            // AUTO-LEARN: Report this breakage to the safety fixer
            if (window.gcodeSafetyFixer) {
                window.gcodeSafetyFixer.recordToolBreakage({
                    cause: 'sensor_detected_break',
                    vibration: this.state.vibration,
                    spindleCurrent: this.state.spindleCurrent,
                    notes: `Auto-detected by chatter sensor. Audio drop: ${alert.audioDropPercent}%`,
                    materialType: this.currentMaterial,
                    toolType: this.currentToolType,
                    toolDiameter: this.currentToolDiameter,
                });
                console.log('[ChatterDetection] Auto-reported breakage to learning system');
            }
            
            // Check for spare tool in ATC
            this._checkForSpareTool();
            
            // Show persistent warning with recovery option
            const recoveryMsg = this.state.breakRecovery.spareToolFound 
                ? ` Spare tool T${this.state.breakRecovery.spareToolNumber} available!`
                : '';
            this.showNotification(
                `⚠️ BROKEN ENDMILL at line ${this.state.breakRecovery.lineNumber}!${recoveryMsg}`, 
                'error'
            );
        }
        
        // NEW: Early warning for potential tool breakage (building confidence)
        const bed = this.state.brokenEndmillDetection;
        if (!this.state.toolBroken && this.state.toolBrokenConfidence > 40 && 
            now - (this._lastToolBreakWarning || 0) > 2000) {
            console.warn('[TOOL CHECK] Suspicious audio drop - monitoring...',
                'Confidence:', this.state.toolBrokenConfidence + '%',
                'Silence:', bed.silenceDuration + 'ms');
            this._lastToolBreakWarning = now;
        }
        
        // Check for overload
        if (this.state.overload && !this._lastOverload) {
            const alert = { type: 'overload', message: '🟠 Spindle overload! Feed reduced.' };
            this.onAlert(alert);
            this.logAlert(alert);
            if (now - this.lastChatterAlert > this.alertCooldown) {
                this.playOverloadAlert();
                this.lastChatterAlert = now;
            }
        }
        
        // Check for chatter zone entry
        // IMPROVED: Include pattern type in alert for better diagnostics
        if (this.state.inChatterZone && !this._lastInChatterZone) {
            const ca = this.state.chatterAnalysis;
            let patternType = 'general';
            let recommendation = 'Reduce feed rate';
            
            if (ca.isResonant) {
                patternType = 'resonant';
                recommendation = 'Change RPM by 10-15% to shift stability lobe';
            } else if (ca.isProgressive) {
                patternType = 'progressive';
                recommendation = 'Stop and reduce DOC or WOC, tool may be worn';
            } else if (ca.isIntermittent) {
                patternType = 'intermittent';
                recommendation = 'Check tool runout and reduce feed';
            }
            
            const alert = { 
                type: 'chatter', 
                message: `🟡 ${patternType.toUpperCase()} chatter detected (${ca.chatterConfidence}%)`,
                score: this.state.combined,
                pattern: patternType,
                confidence: ca.chatterConfidence,
                recommendation: recommendation,
                freq: ca.fundamentalFreq
            };
            this.onAlert(alert);
            this.logAlert(alert);
            
            if (now - this.lastChatterAlert > this.alertCooldown) {
                this.playChatterWarning();
                this.lastChatterAlert = now;
            }
            
            // Show specific recommendation
            this.showNotification(`${patternType} chatter: ${recommendation}`, 'warning');
            
            // VFD AUTO-ADJUST: Automatically adjust spindle speed if enabled
            this._tryAutoAdjustSpindle(patternType, ca);
        }
        
        // Check for recovery
        if (!this.state.inChatterZone && this._lastInChatterZone) {
            const alert = { type: 'recovered', message: '🟢 Chatter resolved - feed recovered.', feed: this.state.feed };
            this.onAlert(alert);
            this.logAlert(alert);
            this.playBeep(600, 150);  // Happy confirmation beep
        }
        
        // PREDICTIVE WARNING - alert BEFORE chatter happens!
        const prediction = this.updatePrediction();
        if (prediction && prediction.willChatter && !this.state.inChatterZone) {
            // Only warn once every 5 seconds about incoming chatter
            if (!this._lastPredictiveWarning || now - this._lastPredictiveWarning > 5000) {
                const eta = prediction.timeToChatter;
                if (eta !== null && eta < 3) {  // Chatter predicted within 3 seconds
                    const alert = { type: 'prediction', message: `⚠️ Chatter building! ETA: ~${eta}s`, eta: eta };
                    this.onAlert(alert);
                    this.logAlert(alert);
                    this.playBeep(700, 100);  // Short warning beep
                    this._lastPredictiveWarning = now;
                    
                    // Update UI with prediction
                    const statusEl = document.getElementById('chatter-status-text');
                    if (statusEl) {
                        statusEl.textContent = `RISING (~${eta}s)`;
                        statusEl.classList.remove('ok');
                        statusEl.classList.add('warning');
                    }
                }
            }
        }
        
        this._lastToolBroken = this.state.toolBroken;
        this._lastOverload = this.state.overload;
        this._lastInChatterZone = this.state.inChatterZone;
    }
    
    /**
     * VFD Auto-Adjust: Automatically adjust spindle speed when chatter detected
     * SAFETY: This is DISABLED by default and must be explicitly enabled
     */
    _tryAutoAdjustSpindle(patternType, chatterAnalysis) {
        const auto = this.state.aiChatter.vfdAutoAdjust;
        const sl = this.state.aiChatter.stabilityLobe;
        const now = Date.now();
        
        // Check if auto-adjust is enabled
        if (!auto.enabled) return;
        
        // Check if VFD is connected
        if (!this.state.vfd.ok) {
            console.log('[VFD Auto] VFD not connected - skipping auto-adjust');
            return;
        }
        
        // Check cooldown
        if (now - auto.lastAdjust < auto.cooldownMs) {
            console.log('[VFD Auto] In cooldown - skipping');
            return;
        }
        
        // Only auto-adjust for resonant chatter (RPM change helps)
        if (patternType !== 'resonant' && chatterAnalysis.chatterConfidence < 70) {
            console.log('[VFD Auto] Not resonant chatter - skipping');
            return;
        }
        
        // Calculate new RPM
        const currentRpm = this.state.rpm || this.state.vfd.rpm;
        if (currentRpm < 1000) return; // Not spinning
        
        let newRpm = sl.optimalRpm;
        
        // If stability lobe doesn't have suggestion, use 12% change
        if (!newRpm || newRpm === 0) {
            // Alternate direction each time to find stable lobe
            const direction = (auto.adjustCount % 2 === 0) ? 1 : -1;
            newRpm = Math.round(currentRpm * (1 + direction * 0.12));
        }
        
        // Apply safety limits
        const maxChange = currentRpm * (auto.maxAdjustPercent / 100);
        newRpm = Math.max(newRpm, currentRpm - maxChange);
        newRpm = Math.min(newRpm, currentRpm + maxChange);
        newRpm = Math.max(newRpm, auto.minRpm);
        newRpm = Math.min(newRpm, auto.maxRpm);
        newRpm = Math.round(newRpm);
        
        // Don't adjust if change is tiny
        if (Math.abs(newRpm - currentRpm) < 200) return;
        
        console.log(`[VFD Auto] Adjusting RPM: ${currentRpm} → ${newRpm}`);
        
        if (auto.mode === 'auto') {
            // Full auto mode - just do it
            this.vfdSetRpm(newRpm);
            this.showNotification(`🔄 Auto-adjusted RPM: ${currentRpm} → ${newRpm}`, 'info');
        } else if (auto.mode === 'confirm') {
            // Confirm mode - ask user
            this._showAutoAdjustConfirm(currentRpm, newRpm);
        } else {
            // Suggest mode - just show suggestion
            this.showNotification(`💡 Suggested RPM: ${newRpm} (current: ${currentRpm})`, 'info');
        }
        
        auto.lastAdjust = now;
        auto.adjustCount++;
    }
    
    /**
     * Show auto-adjust confirmation dialog
     */
    _showAutoAdjustConfirm(currentRpm, newRpm) {
        const modal = document.createElement('div');
        modal.style.cssText = `
            position: fixed;
            inset: 0;
            background: rgba(0,0,0,0.8);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 100001;
        `;
        modal.innerHTML = `
            <div style="background: #1a1a2e; padding: 24px; border-radius: 12px; text-align: center; color: white;">
                <h3 style="margin: 0 0 12px; color: #ffc800;">⚠️ Chatter Detected</h3>
                <p>Adjust spindle speed to find stable lobe?</p>
                <p style="font-size: 24px; margin: 16px 0;">
                    ${currentRpm} RPM → <span style="color: #44ff44;">${newRpm} RPM</span>
                </p>
                <div style="display: flex; gap: 12px; justify-content: center;">
                    <button id="adj-yes" style="padding: 10px 24px; background: #44ff44; color: black; border: none; border-radius: 6px; cursor: pointer; font-weight: bold;">Apply</button>
                    <button id="adj-no" style="padding: 10px 24px; background: #444; color: white; border: none; border-radius: 6px; cursor: pointer;">Skip</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        
        modal.querySelector('#adj-yes').onclick = () => {
            this.vfdSetRpm(newRpm);
            this.showNotification(`🔄 RPM adjusted: ${newRpm}`, 'success');
            modal.remove();
        };
        modal.querySelector('#adj-no').onclick = () => {
            modal.remove();
        };
        
        // Auto-dismiss after 10 seconds
        setTimeout(() => modal.remove(), 10000);
    }
    
    /**
     * Enable VFD auto-adjust with specified mode
     * @param {string} mode - 'suggest', 'confirm', or 'auto'
     */
    enableVfdAutoAdjust(mode = 'confirm') {
        const auto = this.state.aiChatter.vfdAutoAdjust;
        auto.enabled = true;
        auto.mode = mode;
        console.log(`[VFD Auto] Enabled in ${mode} mode`);
        this.showNotification(`VFD auto-adjust: ${mode} mode`, 'info');
    }
    
    /**
     * Disable VFD auto-adjust
     */
    disableVfdAutoAdjust() {
        this.state.aiChatter.vfdAutoAdjust.enabled = false;
        console.log('[VFD Auto] Disabled');
    }

    // ========================================================================
    // UI CREATION
    // ========================================================================
    
    createUI() {
        // Create the chatter panel container
        this.panel = document.createElement('div');
        this.panel.id = 'chatter-panel';
        this.panel.innerHTML = `
            <style>
                #chatter-panel {
                    position: fixed;
                    bottom: 50px;
                    right: 10px;
                    width: 300px;
                    max-height: 200px;
                    overflow-y: auto;
                    background: linear-gradient(145deg, #1a1a2e, #16213e);
                    border-radius: 12px;
                    box-shadow: 0 8px 32px rgba(0,0,0,0.4);
                    font-family: 'Segoe UI', system-ui, sans-serif;
                    color: #fff;
                    z-index: 10000;
                    transition: all 0.3s ease;
                }
                #chatter-panel.hidden {
                    transform: translateX(calc(100% + 40px));
                    opacity: 0;
                    pointer-events: none;
                }
                #chatter-panel.minimized {
                    max-height: 40px;
                    overflow: hidden;
                }
                #chatter-panel.minimized .chatter-body { display: none; }
                
                /* Hide extra sections by default - compact view */
                #chatter-panel:not(.full) .chatter-mode,
                #chatter-panel:not(.full) .chatter-material,
                #chatter-panel:not(.full) .chatter-tool-wear,
                #chatter-panel:not(.full) .chatter-stats,
                #chatter-panel:not(.full) .chatter-controls:not(.compact-controls),
                #chatter-panel:not(.full) .chatter-config { display: none !important; }
                
                #chatter-panel.full { max-height: 80vh; width: 350px; }
                
                /* Toggle button to show/hide panel */
                #chatter-toggle-btn {
                    position: fixed;
                    bottom: 60px;
                    right: 10px;
                    width: 44px;
                    height: 44px;
                    border-radius: 50%;
                    background: linear-gradient(145deg, #1a1a2e, #16213e);
                    border: 2px solid #00d4ff;
                    color: #00d4ff;
                    font-size: 18px;
                    cursor: pointer;
                    z-index: 9999;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    box-shadow: 0 4px 15px rgba(0, 212, 255, 0.3);
                    transition: all 0.3s ease;
                }
                #chatter-toggle-btn:hover {
                    transform: scale(1.1);
                    box-shadow: 0 6px 20px rgba(0, 212, 255, 0.5);
                }
                #chatter-toggle-btn.panel-visible {
                    opacity: 0;
                    pointer-events: none;
                }
                
                .chatter-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    padding: 12px 16px;
                    background: rgba(255,255,255,0.05);
                    cursor: pointer;
                }
                .chatter-hide-btn {
                    background: none;
                    border: none;
                    color: #888;
                    font-size: 16px;
                    cursor: pointer;
                    padding: 4px 8px;
                    border-radius: 4px;
                    transition: all 0.2s;
                }
                .chatter-hide-btn:hover {
                    background: rgba(255,255,255,0.1);
                    color: #fff;
                }
                .chatter-header h3 {
                    margin: 0;
                    font-size: 14px;
                    font-weight: 600;
                    display: flex;
                    align-items: center;
                    gap: 8px;
                }
                .chatter-status-dot {
                    width: 8px;
                    height: 8px;
                    border-radius: 50%;
                    background: #ff4444;
                    animation: pulse 2s infinite;
                }
                .chatter-status-dot.connected { background: #44ff44; animation: none; }
                @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
                
                .chatter-body { padding: 16px; }
                
                .chatter-warning {
                    background: linear-gradient(90deg, #ff6b35, #f7931e);
                    padding: 10px 14px;
                    margin: -16px -16px 16px;
                    font-size: 12px;
                    display: flex;
                    align-items: center;
                    gap: 8px;
                }
                .chatter-warning.hidden { display: none; }
                
                .chatter-body {
                    padding: 12px;
                    display: flex;
                    flex-wrap: wrap;
                    gap: 12px;
                }
                
                .chatter-scores {
                    display: flex;
                    gap: 6px;
                    flex: 1;
                    min-width: 180px;
                }
                .score-item {
                    text-align: center;
                    padding: 6px 10px;
                    background: rgba(255,255,255,0.05);
                    border-radius: 8px;
                    flex: 1;
                }
                .score-label { font-size: 9px; opacity: 0.7; text-transform: uppercase; }
                .score-value { font-size: 16px; font-weight: 600; margin-top: 2px; }
                .score-bar {
                    height: 3px;
                    background: rgba(255,255,255,0.1);
                    border-radius: 2px;
                    margin-top: 4px;
                    overflow: hidden;
                }
                .score-fill {
                    height: 100%;
                    transition: width 0.2s, background 0.2s;
                }
                
                .chatter-combined {
                    background: rgba(255,255,255,0.05);
                    border-radius: 8px;
                    padding: 8px 16px;
                    text-align: center;
                    min-width: 100px;
                }
                .combined-label { font-size: 10px; opacity: 0.7; }
                .combined-value { 
                    font-size: 24px; 
                    font-weight: 700; 
                    margin: 2px 0;
                }
                .combined-status {
                    font-size: 10px;
                    padding: 2px 8px;
                    border-radius: 10px;
                    display: inline-block;
                }
                .combined-status.ok { background: rgba(68, 255, 68, 0.2); color: #44ff44; }
                .combined-status.warning { background: rgba(255, 200, 0, 0.2); color: #ffc800; }
                .combined-status.danger { background: rgba(255, 68, 68, 0.2); color: #ff4444; }
                
                .chatter-stats {
                    display: flex;
                    gap: 6px;
                    flex-wrap: wrap;
                    width: 100%;
                }
                .stat-item {
                    background: rgba(255,255,255,0.05);
                    padding: 4px 10px;
                    border-radius: 6px;
                    display: flex;
                    justify-content: space-between;
                    gap: 8px;
                    flex: 1;
                    min-width: 80px;
                }
                .stat-label { font-size: 10px; opacity: 0.7; }
                .stat-value { font-size: 12px; font-weight: 600; }
                
                .chatter-controls {
                    display: flex;
                    gap: 6px;
                    flex-wrap: wrap;
                    width: 100%;
                }
                .chatter-btn {
                    padding: 6px 10px;
                    border: none;
                    border-radius: 6px;
                    font-size: 10px;
                    font-weight: 600;
                    cursor: pointer;
                    transition: all 0.2s;
                    white-space: nowrap;
                }
                .chatter-btn:hover { transform: translateY(-1px); }
                .chatter-btn.primary { background: #0066ff; color: white; }
                .chatter-btn.secondary { background: rgba(255,255,255,0.1); color: white; }
                .chatter-btn.danger { background: #ff4444; color: white; }
                .chatter-btn:disabled { opacity: 0.5; cursor: not-allowed; }
                
                .chatter-config {
                    margin-top: 8px;
                    padding-top: 8px;
                    border-top: 1px solid rgba(255,255,255,0.1);
                    width: 100%;
                }
                .chatter-config input {
                    width: 100%;
                    padding: 6px 10px;
                    border: 1px solid rgba(255,255,255,0.2);
                    border-radius: 6px;
                    background: rgba(255,255,255,0.05);
                    color: white;
                    font-size: 11px;
                }
                .chatter-config input::placeholder { color: rgba(255,255,255,0.4); }
            </style>
            
            <div class="chatter-header">
                <h3 onclick="window.chatterDetection.toggleMinimize()">
                    <span class="chatter-status-dot" id="chatter-status-dot"></span>
                    Chatter
                </h3>
                <div style="display: flex; align-items: center; gap: 8px;">
                    <span id="chatter-minimize-icon" onclick="window.chatterDetection.toggleMinimize()" style="cursor:pointer;">▼</span>
                    <button class="chatter-hide-btn" onclick="window.chatterDetection.hidePanel()" title="Hide (Alt+C)">✕</button>
                </div>
            </div>
            
            <div class="chatter-body">
                <div class="chatter-warning hidden" id="chatter-warning" style="width:100%;">
                    ⚠️ <span>ESP32 offline</span>
                </div>
                
                <div class="chatter-scores">
                    <div class="score-item">
                        <div class="score-label">Audio</div>
                        <div class="score-value" id="chatter-audio">0.00</div>
                        <div class="score-bar"><div class="score-fill" id="chatter-audio-bar"></div></div>
                    </div>
                    <div class="score-item">
                        <div class="score-label">Accel</div>
                        <div class="score-value" id="chatter-accel">0.00</div>
                        <div class="score-bar"><div class="score-fill" id="chatter-accel-bar"></div></div>
                    </div>
                    <div class="score-item">
                        <div class="score-label">Current</div>
                        <div class="score-value" id="chatter-current">0.00</div>
                        <div class="score-bar"><div class="score-fill" id="chatter-current-bar"></div></div>
                    </div>
                </div>
                
                <div class="chatter-combined">
                    <div class="combined-label">COMBINED SCORE <span id="chatter-trend-indicator"></span></div>
                    <div class="combined-value" id="chatter-combined">0.00</div>
                    <div class="combined-status ok" id="chatter-status-text">STABLE</div>
                    <div class="threshold-line" id="chatter-threshold-display" style="font-size:10px;opacity:0.6;margin-top:4px;">
                        Threshold: <span id="chatter-threshold-val">0.55</span> | Noise: <span id="chatter-noise-val">0.05</span>
                    </div>
                </div>
                
                <div class="chatter-stats">
                    <div class="stat-item">
                        <span class="stat-label">Feed</span>
                        <span class="stat-value" id="chatter-feed">100%</span>
                    </div>
                    <div class="stat-item">
                        <span class="stat-label">Last Stable</span>
                        <span class="stat-value" id="chatter-last-stable">100%</span>
                    </div>
                    <div class="stat-item">
                        <span class="stat-label">Current</span>
                        <span class="stat-value" id="chatter-amps">0.0 A</span>
                    </div>
                    <div class="stat-item">
                        <span class="stat-label">Expected</span>
                        <span class="stat-value" id="chatter-expected-amps">1.5-6A</span>
                    </div>
                    <div class="stat-item">
                        <span class="stat-label">Chatter Freq</span>
                        <span class="stat-value" id="chatter-freq">0 Hz</span>
                    </div>
                    <div class="stat-item">
                        <span class="stat-label">Tooth Freq</span>
                        <span class="stat-value" id="chatter-tooth-freq">333 Hz</span>
                    </div>
                    <div class="stat-item">
                        <span class="stat-label">Trend</span>
                        <span class="stat-value" id="chatter-trend">→</span>
                    </div>
                    <div class="stat-item">
                        <span class="stat-label">Efficiency</span>
                        <span class="stat-value" id="chatter-efficiency">0%</span>
                    </div>
                    <div class="stat-item">
                        <span class="stat-label">Confidence</span>
                        <span class="stat-value" id="chatter-confidence">--</span>
                    </div>
                    <div class="stat-item">
                        <span class="stat-label">Vibration</span>
                        <span class="stat-value" id="chatter-vibration">0.000 g</span>
                    </div>
                    <div class="stat-item">
                        <span class="stat-label">Spindle Temp</span>
                        <span class="stat-value" id="chatter-spindle-temp">N/A</span>
                    </div>
                    <div class="stat-item">
                        <span class="stat-label">Sensor</span>
                        <span class="stat-value" id="chatter-calibration">--</span>
                    </div>
                </div>
                
                <div class="chatter-mode" style="margin-bottom:12px;">
                    <div style="font-size:10px;opacity:0.7;margin-bottom:6px;">MODE</div>
                    <div style="display:flex;gap:4px;">
                        <button class="chatter-btn secondary" id="mode-auto" onclick="window.chatterDetection.setMode('auto')" style="flex:1;font-size:10px;">Auto</button>
                        <button class="chatter-btn secondary" id="mode-aggressive" onclick="window.chatterDetection.setMode('aggressive')" style="flex:1;font-size:10px;">Aggressive</button>
                        <button class="chatter-btn secondary" id="mode-conservative" onclick="window.chatterDetection.setMode('conservative')" style="flex:1;font-size:10px;">Safe</button>
                    </div>
                    <div style="display:flex;gap:4px;margin-top:4px;">
                        <button class="chatter-btn" id="btn-calibrate" onclick="window.chatterDetection.requestCalibration()" style="flex:1;font-size:10px;background:#333;">🎯 Calibrate</button>
                        <button class="chatter-btn" id="btn-resolved" onclick="window.chatterDetection.confirmChatterResolved()" style="flex:1;font-size:10px;background:#333;">✓ Resolved</button>
                    </div>
                </div>
                
                <!-- REAL-TIME GRAPH -->
                <div style="margin-bottom:12px;padding:8px;background:rgba(255,255,255,0.03);border-radius:8px;">
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
                        <span style="font-size:10px;opacity:0.6;">LIVE GRAPH</span>
                        <span style="font-size:10px;" id="chatter-spindle-state">⚫ Idle</span>
                    </div>
                    <canvas id="chatter-graph" width="288" height="60" style="width:100%;height:60px;border-radius:4px;background:rgba(0,0,0,0.3);"></canvas>
                </div>
                
                <!-- MATERIAL/TOOL DISPLAY - Because it matters! -->
                <div class="chatter-material" id="chatter-material-display" style="margin-bottom:12px;padding:10px;background:rgba(255,255,255,0.05);border-radius:8px;cursor:pointer;" onclick="window.chatterDetection.showSetupWizard()">
                    <div style="display:flex;justify-content:space-between;align-items:center;">
                        <div>
                            <div style="font-size:10px;opacity:0.6;">MATERIAL</div>
                            <div style="font-size:14px;font-weight:600;" id="chatter-material-name">aluminum</div>
                        </div>
                        <div style="text-align:center;">
                            <div style="font-size:10px;opacity:0.6;">OPERATION</div>
                            <div style="font-size:12px;" id="chatter-operation-name">roughing</div>
                        </div>
                        <div style="text-align:right;">
                            <div style="font-size:10px;opacity:0.6;">TOOL</div>
                            <div style="font-size:12px;" id="chatter-tool-info">6mm 2F</div>
                        </div>
                        <div style="font-size:16px;opacity:0.5;">⚙️</div>
                    </div>
                    <div style="font-size:10px;opacity:0.5;margin-top:6px;text-align:center;">Tap to change (IT MATTERS for detection accuracy)</div>
                </div>
                
                <div class="chatter-controls">
                    <button class="chatter-btn primary" id="chatter-toggle" onclick="window.chatterDetection.toggleEnabled()">
                        Disable
                    </button>
                    <button class="chatter-btn secondary" onclick="window.chatterDetection.learn()" title="Learn noise floor from environment">
                        Learn
                    </button>
                    <button class="chatter-btn secondary" onclick="window.chatterDetection.autoCal()" title="Auto-calibrate idle current (spindle must be running)">
                        AutoCal
                    </button>
                    <button class="chatter-btn danger" onclick="window.chatterDetection.resetAlerts()">
                        Reset
                    </button>
                </div>
                
                <div class="chatter-controls" style="margin-top:8px;">
                    <button class="chatter-btn secondary" onclick="window.chatterDetection.save()" title="Save settings to flash (survives reboot)" style="flex:1;">
                        💾 Save
                    </button>
                    <button class="chatter-btn secondary" onclick="window.chatterDetection.toggleAudio()" id="chatter-audio-btn" title="Toggle audio alerts" style="flex:1;">
                        ${this.audioEnabled ? '🔊 Audio' : '🔇 Muted'}
                    </button>
                    <button class="chatter-btn secondary" onclick="window.chatterDetection.showDiagnostics()" title="Show diagnostics and spectrum" style="flex:1;">
                        📊 Diag
                    </button>
                    <button class="chatter-btn secondary" onclick="window.chatterDetection.showRecommendations()" title="Get smart suggestions" style="flex:1;">
                        💡 Tips
                    </button>
                </div>
                
                <div class="chatter-controls" style="margin-top:8px;">
                    <button class="chatter-btn secondary" onclick="window.chatterDetection.openUpdatePage()" title="Open web update page" style="flex:1;">
                        ⬆️ Update
                    </button>
                    <button class="chatter-btn secondary" onclick="window.chatterDetection.startApMode()" title="Start WiFi setup hotspot" style="flex:1;">
                        📶 Setup
                    </button>
                    <button class="chatter-btn secondary" onclick="window.chatterDetection.startAutoTuning()" title="Auto-tune thresholds" style="flex:1;">
                        🎛️ Tune
                    </button>
                    <button class="chatter-btn secondary" onclick="window.chatterDetection.reboot()" title="Reboot ESP32" style="flex:1;">
                        🔄 Reboot
                    </button>
                </div>
                
                <!-- TOOL WEAR DISPLAY -->
                <div class="chatter-tool-wear" id="chatter-tool-wear" style="margin-top:12px;padding:10px;background:rgba(255,255,255,0.05);border-radius:8px;">
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                        <span style="font-size:10px;opacity:0.7;">TOOL WEAR ESTIMATE</span>
                        <button onclick="window.chatterDetection.resetToolWear()" style="padding:2px 8px;font-size:10px;background:rgba(255,255,255,0.1);border:none;border-radius:4px;color:white;cursor:pointer;">
                            New Tool
                        </button>
                    </div>
                    <div style="display:flex;gap:12px;align-items:center;">
                        <div style="font-size:24px;" id="chatter-wear-icon">🟢</div>
                        <div style="flex:1;">
                            <div style="height:8px;background:rgba(255,255,255,0.1);border-radius:4px;overflow:hidden;">
                                <div id="chatter-wear-bar" style="height:100%;width:0%;background:linear-gradient(90deg,#44ff44,#ffcc00,#ff4444);transition:width 0.3s;"></div>
                            </div>
                            <div style="display:flex;justify-content:space-between;margin-top:4px;font-size:10px;opacity:0.7;">
                                <span id="chatter-wear-percent">0%</span>
                                <span id="chatter-wear-time">0 min cutting</span>
                            </div>
                        </div>
                    </div>
                </div>
                
                <!-- VFD TELEMETRY (optional - from RS-485 Modbus) -->
                <div class="chatter-vfd" id="chatter-vfd-panel" style="margin-top:12px;padding:10px;background:rgba(255,255,255,0.05);border-radius:8px;display:none;">
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                        <span style="font-size:10px;opacity:0.7;">VFD TELEMETRY (RS-485)</span>
                        <span id="chatter-vfd-status" style="font-size:10px;">⚫ N/A</span>
                    </div>
                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:12px;">
                        <div style="display:flex;justify-content:space-between;padding:4px 8px;background:rgba(255,255,255,0.03);border-radius:4px;">
                            <span style="opacity:0.7;">RPM</span>
                            <span id="chatter-vfd-rpm" style="font-weight:600;">0</span>
                        </div>
                        <div style="display:flex;justify-content:space-between;padding:4px 8px;background:rgba(255,255,255,0.03);border-radius:4px;">
                            <span style="opacity:0.7;">Freq</span>
                            <span id="chatter-vfd-freq" style="font-weight:600;">0 Hz</span>
                        </div>
                        <div style="display:flex;justify-content:space-between;padding:4px 8px;background:rgba(255,255,255,0.03);border-radius:4px;">
                            <span style="opacity:0.7;">Current</span>
                            <span id="chatter-vfd-amps" style="font-weight:600;">0.0 A</span>
                        </div>
                        <div style="display:flex;justify-content:space-between;padding:4px 8px;background:rgba(255,255,255,0.03);border-radius:4px;">
                            <span style="opacity:0.7;">DC Bus</span>
                            <span id="chatter-vfd-dcv" style="font-weight:600;">0 V</span>
                        </div>
                    </div>
                    <div id="chatter-vfd-fault" style="display:none;margin-top:6px;padding:6px;background:rgba(255,68,68,0.2);border-radius:4px;font-size:11px;color:#ff6666;">
                        ⚠️ <span id="chatter-vfd-fault-text">Fault</span>
                    </div>
                    
                    <!-- VFD CONTROL BUTTONS -->
                    <div id="chatter-vfd-controls" style="display:flex;gap:6px;margin-top:8px;">
                        <button class="chatter-btn" onclick="window.chatterDetection.vfdStop()" style="flex:1;background:#ff4444;color:white;" title="Emergency Stop">
                            ⏹ STOP
                        </button>
                        <button class="chatter-btn" onclick="window.chatterDetection._showRpmDialog()" style="flex:1;background:#4488ff;" title="Set RPM">
                            ⚙️ RPM
                        </button>
                        <button class="chatter-btn" onclick="window.chatterDetection._toggleVfdAutoAdjust()" id="chatter-vfd-auto-btn" style="flex:1;background:#444;" title="Toggle Auto-Adjust">
                            🤖 Auto
                        </button>
                    </div>
                    
                    <!-- VFD RAMP SPEED CONTROL (without braking resistor, can't stop instantly) -->
                    <div style="display:flex;gap:6px;margin-top:6px;">
                        <button class="chatter-btn" onclick="window.chatterDetection.vfdFastRamp()" style="flex:1;background:#2d5a27;" title="Fast ramp: 1s accel, 2s decel (RECOMMENDED)">
                            ⚡ Fast Ramp
                        </button>
                        <button class="chatter-btn" onclick="window.chatterDetection._showRampDialog()" style="flex:1;background:#444;" title="Custom ramp times">
                            🎚️ Ramp
                        </button>
                    </div>
                    
                    <!-- SPINDLE THERMAL TEST BUTTONS -->
                    <div style="display:flex;gap:6px;margin-top:6px;">
                        <button class="chatter-btn" onclick="window.chatterDetection.runThermalStressTest()" style="flex:1;background:#e65c00;" title="10-min thermal stress test to check cooling">
                            🌡️ Thermal Test
                        </button>
                        <button class="chatter-btn" onclick="window.chatterDetection.runSpindleWarmup()" style="flex:1;background:#555;" title="Warm up spindle bearings">
                            🔥 Warmup
                        </button>
                    </div>
                </div>
                
                <!-- COMPACT MODE CONTROLS (visible in compact mode) -->
                <div class="chatter-controls compact-controls" style="margin-top:8px;">
                    <button class="chatter-btn primary" id="chatter-toggle-compact" onclick="window.chatterDetection.toggleEnabled()">
                        Disable
                    </button>
                    <button class="chatter-btn secondary" onclick="window.chatterDetection.toggleFull()" title="Show all options (Alt+M)">
                        📐 More
                    </button>
                </div>
                
                <div class="chatter-config">
                    <div style="display:flex;gap:6px;margin-bottom:8px;">
                        <button class="chatter-btn primary" id="chatter-usb-connect-btn" 
                                onclick="window.chatterDetection.toggleSerialConnection()" 
                                style="flex:1;" title="Connect via USB (recommended)">
                            🔌 USB Connect
                        </button>
                        <button class="chatter-btn secondary" id="chatter-ws-connect-btn" 
                                onclick="window.chatterDetection.toggleWsConnection()" 
                                style="flex:1;" title="Connect via WiFi WebSocket">
                            📶 WiFi
                        </button>
                    </div>
                    <input type="text" id="chatter-ip" placeholder="WiFi: ESP32 IP or 'chatter.local'" 
                           onchange="window.chatterDetection.setEspAddress(this.value)">
                </div>
            </div>
        `;
        
        // Add to page
        document.body.appendChild(this.panel);
        
        // Start hidden by default for more screen space
        this.panel.classList.add('hidden');
        
        // Create toggle button (visible when panel is hidden)
        this.toggleBtn = document.createElement('button');
        this.toggleBtn.id = 'chatter-toggle-btn';
        this.toggleBtn.innerHTML = '📊';
        this.toggleBtn.title = 'Show Chatter Detection (Alt+C)';
        // Panel starts hidden, so button should be visible
        this.toggleBtn.onclick = () => this.showPanel();
        document.body.appendChild(this.toggleBtn);
        
        // Keyboard shortcut Alt+C to toggle panel
        document.addEventListener('keydown', (e) => {
            if (e.altKey && e.key.toLowerCase() === 'c') {
                e.preventDefault();
                this.togglePanel();
            }
        });
        
        // Make globally accessible
        window.chatterDetection = this;
    }
    
    hidePanel() {
        this.panel.classList.add('hidden');
        this.toggleBtn.classList.remove('panel-visible');
    }
    
    showPanel() {
        this.panel.classList.remove('hidden');
        this.toggleBtn.classList.add('panel-visible');
    }
    
    togglePanel() {
        if (this.panel.classList.contains('hidden')) {
            this.showPanel();
        } else {
            this.hidePanel();
        }
    }
    
    toggleMinimize() {
        this.panel.classList.toggle('minimized');
        this.panel.classList.remove('compact');  // Can't be both
        this.panel.classList.remove('full');  // Can't be both
        const icon = document.getElementById('chatter-minimize-icon');
        icon.textContent = this.panel.classList.contains('minimized') ? '▲' : '▼';
    }
    
    toggleFull() {
        this.panel.classList.toggle('full');
        this.panel.classList.remove('minimized');
        this.panel.classList.remove('compact');
        
        // Update button text
        const btn = this.panel.querySelector('.compact-controls button:nth-child(2)');
        if (btn) {
            btn.textContent = this.panel.classList.contains('full') ? '📐 Less' : '📐 More';
        }
    }
    
    toggleCompact() {
        // Keep for backward compatibility, now calls toggleFull
        this.toggleFull();
    }
    
    toggleEnabled() {
        if (this.state.enabled) {
            this.disable();
        } else {
            this.enable();
        }
    }
    
    showWarning() {
        const warning = document.getElementById('chatter-warning');
        if (warning) warning.classList.remove('hidden');
        
        const dot = document.getElementById('chatter-status-dot');
        if (dot) dot.classList.remove('connected');
    }
    
    hideWarning() {
        const warning = document.getElementById('chatter-warning');
        if (warning) warning.classList.add('hidden');
        
        const dot = document.getElementById('chatter-status-dot');
        if (dot) dot.classList.add('connected');
        
        // Hide reconnect button if it exists
        const reconnectBtn = document.getElementById('chatter-reconnect-btn');
        if (reconnectBtn) reconnectBtn.remove();
    }
    
    showReconnectButton() {
        // Add a reconnect button when max attempts reached
        const warning = document.getElementById('chatter-warning');
        if (!warning) return;
        
        // Check if button already exists
        if (document.getElementById('chatter-reconnect-btn')) return;
        
        const btn = document.createElement('button');
        btn.id = 'chatter-reconnect-btn';
        btn.textContent = '🔄 Retry Connection';
        btn.style.cssText = `
            margin-top: 10px;
            padding: 8px 16px;
            background: #0066ff;
            color: white;
            border: none;
            border-radius: 6px;
            cursor: pointer;
            font-size: 12px;
            font-weight: 600;
        `;
        btn.onclick = () => {
            this.reconnectAttempts = 0;  // Reset attempts
            btn.remove();
            this.connect();
        };
        warning.appendChild(btn);
    }
    
    // Update material/tool display
    updateMaterialUI() {
        const opNames = ['roughing', 'finishing', 'drilling', 'slotting'];
        
        const matName = document.getElementById('chatter-material-name');
        if (matName) matName.textContent = this.state.material || 'aluminum';
        
        const opName = document.getElementById('chatter-operation-name');
        if (opName) opName.textContent = opNames[this.state.operation] || 'roughing';
        
        const toolInfo = document.getElementById('chatter-tool-info');
        if (toolInfo) {
            const dia = this.state.toolDia || 6;
            const flutes = this.state.toolFlutes || 2;
            toolInfo.textContent = `${dia}mm ${flutes}F`;
        }
        
        // Also update tooth frequency display if present
        const toothFreq = document.getElementById('chatter-tooth-freq');
        if (toothFreq && this.state.rpm && this.state.toolFlutes) {
            const freq = Math.round((this.state.rpm * this.state.toolFlutes) / 60);
            toothFreq.textContent = `${freq} Hz`;
        }
    }
    
    // Update tool wear display
    updateToolWearUI() {
        // Update tool wear tracking first
        this.updateToolWear();
        
        const wearIcon = document.getElementById('chatter-wear-icon');
        const wearBar = document.getElementById('chatter-wear-bar');
        const wearPercent = document.getElementById('chatter-wear-percent');
        const wearTime = document.getElementById('chatter-wear-time');
        
        if (!wearIcon || !wearBar || !wearPercent || !wearTime) return;
        
        const status = this.getToolWearStatus();
        wearIcon.textContent = status.icon;
        wearBar.style.width = `${Math.min(this.state.toolWear, 100)}%`;
        wearPercent.textContent = `${this.state.toolWear.toFixed(0)}% - ${status.text}`;
        
        const mins = (this.state.cuttingSeconds / 60).toFixed(1);
        wearTime.textContent = `${mins} min cutting`;
        
        // Highlight if wear is high
        const container = document.getElementById('chatter-tool-wear');
        if (container) {
            if (this.state.toolWear >= 80) {
                container.style.background = 'rgba(255,68,68,0.2)';
                container.style.border = '1px solid #ff4444';
            } else if (this.state.toolWear >= 50) {
                container.style.background = 'rgba(255,200,0,0.15)';
                container.style.border = '1px solid #ffc800';
            } else {
                container.style.background = 'rgba(255,255,255,0.05)';
                container.style.border = 'none';
            }
        }
    }
    
    // Update VFD telemetry display
    updateVfdUI() {
        const vfd = this.state.vfd;
        const panel = document.getElementById('chatter-vfd-panel');
        
        // Only show panel if VFD is connected (ok === true)
        if (!vfd || !vfd.ok) {
            if (panel) panel.style.display = 'none';
            return;
        }
        
        // Show the panel
        if (panel) panel.style.display = 'block';
        
        // Status indicator
        const status = document.getElementById('chatter-vfd-status');
        if (status) {
            if (vfd.fault > 0) {
                status.textContent = '🔴 FAULT';
                status.style.color = '#ff4444';
            } else if (vfd.run) {
                status.textContent = '🟢 Running';
                status.style.color = '#44ff44';
            } else {
                status.textContent = '🟡 Idle';
                status.style.color = '#ffc800';
            }
        }
        
        // RPM
        const rpmEl = document.getElementById('chatter-vfd-rpm');
        if (rpmEl) {
            rpmEl.textContent = vfd.rpm || 0;
            // Color based on running
            rpmEl.style.color = vfd.run ? '#44ff44' : 'inherit';
        }
        
        // Frequency (Hz)
        const freqEl = document.getElementById('chatter-vfd-freq');
        if (freqEl) {
            const f = vfd.freq || 0;
            freqEl.textContent = `${f.toFixed(1)} Hz`;
        }
        
        // Current (A)
        const ampsEl = document.getElementById('chatter-vfd-amps');
        if (ampsEl) {
            const a = vfd.amps || 0;
            ampsEl.textContent = `${a.toFixed(1)} A`;
            // Color based on current level
            if (a > 10) {
                ampsEl.style.color = '#ff4444';  // High current
            } else if (a > 5) {
                ampsEl.style.color = '#ffc800';  // Medium
            } else {
                ampsEl.style.color = vfd.run ? '#44ff44' : 'inherit';
            }
        }
        
        // DC Bus voltage
        const dcvEl = document.getElementById('chatter-vfd-dcv');
        if (dcvEl) {
            const v = vfd.dcv || 0;
            dcvEl.textContent = `${v.toFixed(0)} V`;
            // Color based on voltage (typically 310-340V for 220V input)
            if (v > 0 && v < 280) {
                dcvEl.style.color = '#ff4444';  // Low voltage
            } else if (v > 380) {
                dcvEl.style.color = '#ff4444';  // Over voltage
            } else {
                dcvEl.style.color = 'inherit';
            }
        }
        
        // Fault display
        const faultPanel = document.getElementById('chatter-vfd-fault');
        const faultText = document.getElementById('chatter-vfd-fault-text');
        if (faultPanel && faultText) {
            if (vfd.fault > 0) {
                faultPanel.style.display = 'block';
                faultText.textContent = vfd.faultStr || `Fault code: ${vfd.fault}`;
            } else {
                faultPanel.style.display = 'none';
            }
        }
    }
    
    // Update sensor health display in diagnostics panel
    updateSensorHealthUI(sensors) {
        // MPU-6050 (Accelerometer)
        const mpuEl = document.getElementById('diag-sensor-mpu');
        if (mpuEl) {
            const mpuOk = sensors.mpu === 'OK' || sensors.mpuCode === 0;
            mpuEl.textContent = mpuOk ? '✓ OK' : `✗ ${sensors.mpu || 'Error'}`;
            mpuEl.style.color = mpuOk ? '#44ff44' : '#ff4444';
        }
        
        // INMP441 (Microphone)
        const i2sEl = document.getElementById('diag-sensor-i2s');
        if (i2sEl) {
            const i2sOk = sensors.i2s === 'OK' || sensors.i2sCode === 0;
            i2sEl.textContent = i2sOk ? '✓ OK' : `✗ ${sensors.i2s || 'Error'}`;
            i2sEl.style.color = i2sOk ? '#44ff44' : '#ff4444';
        }
        
        // ACS712 (Current sensor)
        const adcEl = document.getElementById('diag-sensor-adc');
        if (adcEl) {
            const adcOk = sensors.adc === 'OK' || sensors.adcCode === 0;
            adcEl.textContent = adcOk ? '✓ OK' : `✗ ${sensors.adc || 'Error'}`;
            adcEl.style.color = adcOk ? '#44ff44' : '#ff4444';
        }
        
        // VFD (Modbus RS-485) - only show if enabled
        const vfdRow = document.getElementById('diag-vfd-row');
        const vfdEl = document.getElementById('diag-sensor-vfd');
        if (vfdRow && sensors.vfdOk !== undefined) {
            vfdRow.style.display = 'flex';
            if (vfdEl) {
                const vfdOk = sensors.vfd === 'OK' || sensors.vfdCode === 0;
                let vfdStatus = vfdOk ? '✓ OK' : `✗ ${sensors.vfd || 'Error'}`;
                if (sensors.vfdFault) {
                    vfdStatus += ` (${sensors.vfdFault})`;
                }
                vfdEl.textContent = vfdStatus;
                vfdEl.style.color = vfdOk ? '#44ff44' : '#ff4444';
            }
        } else if (vfdRow) {
            vfdRow.style.display = 'none';
        }
        
        // All sensors summary
        const allEl = document.getElementById('diag-sensor-all');
        if (allEl) {
            allEl.textContent = sensors.allOk ? '✓ All OK' : '⚠️ Issues Detected';
            allEl.style.color = sensors.allOk ? '#44ff44' : '#ff4444';
        }
        
        // Error detail panel
        const errorDetail = document.getElementById('sensor-error-detail');
        const errorText = document.getElementById('sensor-error-text');
        if (errorDetail && errorText) {
            if (!sensors.allOk) {
                errorDetail.style.display = 'block';
                let troubleshoot = [];
                if (sensors.mpuCode && sensors.mpuCode !== 0) {
                    troubleshoot.push(`MPU-6050: ${sensors.mpu} - Check I2C wiring (SDA→GPIO21, SCL→GPIO22)`);
                }
                if (sensors.i2sCode && sensors.i2sCode !== 0) {
                    troubleshoot.push(`INMP441: ${sensors.i2s} - Check I2S wiring (SD→GPIO32, WS→GPIO25, SCK→GPIO26)`);
                }
                if (sensors.adcCode && sensors.adcCode !== 0) {
                    troubleshoot.push(`ACS712: ${sensors.adc} - Check ADC wiring (OUT→GPIO34) and power (5V)`);
                }
                if (sensors.vfdCode && sensors.vfdCode !== 0) {
                    let vfdTip = `VFD: ${sensors.vfd} - Check RS-485 wiring (TX→GPIO13, RX→GPIO14, DE→GPIO27)`;
                    if (sensors.vfdFault) {
                        vfdTip += ` | Fault: ${sensors.vfdFault}`;
                    }
                    troubleshoot.push(vfdTip);
                }
                errorText.innerHTML = troubleshoot.join('<br>');
            } else {
                errorDetail.style.display = 'none';
            }
        }
    }
    
    // ========================================================================
    // BREAK RECOVERY UI
    // ========================================================================
    
    /**
     * Update break recovery panel in UI
     * Shows G-code line, position, spare tool availability
     */
    updateBreakRecoveryUI() {
        const recovery = this.state.breakRecovery;
        let panel = document.getElementById('chatter-recovery-panel');
        
        // Only show if we have a break to recover from
        if (!recovery.canResume) {
            if (panel) panel.style.display = 'none';
            return;
        }
        
        // Create panel if doesn't exist
        if (!panel) {
            panel = this._createRecoveryPanel();
        }
        
        panel.style.display = 'block';
        
        // Update content
        const lineEl = document.getElementById('recovery-line');
        if (lineEl) lineEl.textContent = recovery.lineNumber;
        
        const gcodeEl = document.getElementById('recovery-gcode');
        if (gcodeEl) gcodeEl.textContent = recovery.gcodeLine.slice(0, 40) || 'N/A';
        
        const posEl = document.getElementById('recovery-position');
        if (posEl) {
            const p = recovery.position;
            posEl.textContent = `X${p.x.toFixed(2)} Y${p.y.toFixed(2)} Z${p.z.toFixed(2)}`;
        }
        
        const toolEl = document.getElementById('recovery-tool');
        if (toolEl) toolEl.textContent = `T${recovery.toolNumber}`;
        
        const spareEl = document.getElementById('recovery-spare');
        if (spareEl) {
            if (recovery.spareToolFound) {
                spareEl.textContent = `T${recovery.spareToolNumber} available!`;
                spareEl.style.color = '#44ff44';
            } else {
                spareEl.textContent = 'No spare found';
                spareEl.style.color = '#ff4444';
            }
        }
        
        const resumeBtn = document.getElementById('recovery-resume-btn');
        if (resumeBtn) {
            resumeBtn.onclick = () => this.showResumeDialog();
        }
    }
    
    /**
     * Create the recovery panel DOM element
     */
    _createRecoveryPanel() {
        const panel = document.createElement('div');
        panel.id = 'chatter-recovery-panel';
        panel.innerHTML = `
            <style>
                #chatter-recovery-panel {
                    background: rgba(255,68,68,0.2);
                    border: 2px solid #ff4444;
                    border-radius: 8px;
                    padding: 12px;
                    margin-top: 10px;
                }
                .recovery-title {
                    font-size: 14px;
                    font-weight: bold;
                    color: #ff4444;
                    margin-bottom: 8px;
                }
                .recovery-row {
                    display: flex;
                    justify-content: space-between;
                    font-size: 11px;
                    margin: 4px 0;
                }
                .recovery-label { opacity: 0.7; }
                .recovery-value { font-family: monospace; }
                #recovery-resume-btn {
                    width: 100%;
                    margin-top: 10px;
                    background: #ff4444;
                    color: white;
                    border: none;
                    padding: 10px;
                    border-radius: 6px;
                    cursor: pointer;
                    font-weight: bold;
                }
                #recovery-resume-btn:hover { background: #ff6666; }
            </style>
            <div class="recovery-title">🔧 TOOL BROKE - RECOVERY AVAILABLE</div>
            <div class="recovery-row">
                <span class="recovery-label">Line:</span>
                <span class="recovery-value" id="recovery-line">0</span>
            </div>
            <div class="recovery-row">
                <span class="recovery-label">G-code:</span>
                <span class="recovery-value" id="recovery-gcode">N/A</span>
            </div>
            <div class="recovery-row">
                <span class="recovery-label">Position:</span>
                <span class="recovery-value" id="recovery-position">X0 Y0 Z0</span>
            </div>
            <div class="recovery-row">
                <span class="recovery-label">Broken Tool:</span>
                <span class="recovery-value" id="recovery-tool">T1</span>
            </div>
            <div class="recovery-row">
                <span class="recovery-label">Spare:</span>
                <span class="recovery-value" id="recovery-spare">Checking...</span>
            </div>
            <button id="recovery-resume-btn">🔄 Resume Job with Tool Change</button>
        `;
        
        // Insert after status section
        const chatterPanel = document.getElementById('chatter-panel');
        if (chatterPanel) {
            chatterPanel.appendChild(panel);
        }
        
        return panel;
    }
    
    /**
     * Show resume dialog with recovery options
     */
    showResumeDialog() {
        const recovery = this.getBreakRecoveryInfo();
        const resumeGcode = this.generateResumeGcode(recovery.spareAvailable);
        
        // Create modal
        const modal = document.createElement('div');
        modal.id = 'chatter-resume-modal';
        modal.innerHTML = `
            <style>
                #chatter-resume-modal {
                    position: fixed;
                    inset: 0;
                    background: rgba(0,0,0,0.9);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    z-index: 100001;
                }
                .resume-dialog {
                    background: linear-gradient(145deg, #1a1a2e, #16213e);
                    border-radius: 16px;
                    width: 500px;
                    max-width: 95vw;
                    color: white;
                    padding: 24px;
                }
                .resume-title {
                    font-size: 18px;
                    font-weight: bold;
                    margin-bottom: 16px;
                }
                .resume-info {
                    background: rgba(255,255,255,0.05);
                    padding: 12px;
                    border-radius: 8px;
                    margin-bottom: 16px;
                    font-family: monospace;
                    font-size: 12px;
                }
                .resume-gcode {
                    background: #1a1a2e;
                    padding: 12px;
                    border-radius: 8px;
                    font-family: monospace;
                    font-size: 11px;
                    white-space: pre-wrap;
                    max-height: 200px;
                    overflow-y: auto;
                    margin-bottom: 16px;
                }
                .resume-buttons {
                    display: flex;
                    gap: 12px;
                }
                .resume-btn {
                    flex: 1;
                    padding: 12px;
                    border: none;
                    border-radius: 8px;
                    cursor: pointer;
                    font-weight: bold;
                }
                .resume-btn.primary { background: #44ff44; color: black; }
                .resume-btn.secondary { background: rgba(255,255,255,0.1); color: white; }
                .resume-btn.cancel { background: #ff4444; color: white; }
            </style>
            <div class="resume-dialog">
                <div class="resume-title">🔄 Resume After Tool Break</div>
                <div class="resume-info">
                    <div>Broken at line: <strong>${recovery.lineNumber}</strong></div>
                    <div>Will resume from: <strong>line ${recovery.resumeFromLine}</strong> (${this.state.breakRecovery.rewindLines} lines back)</div>
                    <div>Position: X${recovery.position.x.toFixed(3)} Y${recovery.position.y.toFixed(3)} Z${recovery.position.z.toFixed(3)}</div>
                    <div>Broken tool: <strong>T${recovery.brokenTool}</strong></div>
                    ${recovery.spareAvailable 
                        ? `<div style="color:#44ff44">✓ Spare available: <strong>T${recovery.spareTool}</strong></div>` 
                        : '<div style="color:#ff4444">✗ No spare tool found - manual replacement needed</div>'}
                </div>
                <div class="resume-gcode">${resumeGcode?.gcode || 'No G-code generated'}</div>
                <div class="resume-buttons">
                    <button class="resume-btn primary" onclick="chatterDetection.executeResume(true)">
                        ${recovery.spareAvailable ? `Use T${recovery.spareTool} & Resume` : 'Resume After Tool Change'}
                    </button>
                    <button class="resume-btn secondary" onclick="chatterDetection.copyResumeGcode()">
                        📋 Copy G-code
                    </button>
                    <button class="resume-btn cancel" onclick="document.getElementById('chatter-resume-modal').remove()">
                        Cancel
                    </button>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
    }
    
    /**
     * Execute the resume sequence
     */
    executeResume(useSpare = true) {
        const recovery = this.state.breakRecovery;
        const resumeInfo = this.generateResumeGcode(useSpare);
        
        if (!resumeInfo) {
            alert('Cannot resume - no break info available');
            return;
        }
        
        // Close modal
        const modal = document.getElementById('chatter-resume-modal');
        if (modal) modal.remove();
        
        // Send tool change sequence
        if (window.app?.grbl) {
            console.log('[RESUME] Executing recovery sequence...');
            console.log('[RESUME] G-code:', resumeInfo.gcode);
            
            // If we have spare tool and ATC, do automatic tool change
            if (useSpare && recovery.spareToolFound && window.app.atc) {
                window.app.atc.changeTool(recovery.spareToolNumber);
            }
            
            // Tell job control to resume from specific line
            if (window.app.jobControl?.resumeFromLine) {
                window.app.jobControl.resumeFromLine(resumeInfo.resumeFromLine);
            } else {
                // Fallback: show notification with instructions
                alert(`Ready to resume from line ${resumeInfo.resumeFromLine}.\n\nSteps:\n1. Change to T${resumeInfo.tool}\n2. Set tool length offset\n3. Resume job from line ${resumeInfo.resumeFromLine}`);
            }
        }
        
        // Clear recovery state
        this.clearBreakRecovery();
    }
    
    /**
     * Copy resume G-code to clipboard
     */
    copyResumeGcode() {
        const resumeInfo = this.generateResumeGcode(this.state.breakRecovery.spareToolFound);
        if (resumeInfo?.gcode) {
            navigator.clipboard.writeText(resumeInfo.gcode);
            alert('Recovery G-code copied to clipboard!');
        }
    }
    
    /**
     * Clear break recovery state
     */
    clearBreakRecovery() {
        const recovery = this.state.breakRecovery;
        recovery.canResume = false;
        recovery.lineNumber = 0;
        recovery.gcodeLine = '';
        recovery.position = { x: 0, y: 0, z: 0 };
        recovery.spareToolFound = false;
        recovery.spareToolNumber = null;
        
        const panel = document.getElementById('chatter-recovery-panel');
        if (panel) panel.style.display = 'none';
    }
    
    // ========================================================================
    // AI INSIGHTS UI
    // ========================================================================
    
    /**
     * Update AI insights panel with analysis results
     */
    updateAIInsightsUI() {
        const ai = this.state.aiChatter;
        if (!ai) return;
        
        // Get or create AI insights element
        let aiEl = document.getElementById('chatter-ai-insights');
        
        // Only show when we have meaningful data
        const hasData = ai.loadProfile.isLearned || 
                        ai.freqShift.isShifting ||
                        ai.spikeDetection.spikeCount > 0 ||
                        ai.stabilityLobe.lobePosition !== 'unknown';
        
        if (!hasData) {
            if (aiEl) aiEl.style.display = 'none';
            return;
        }
        
        // Create element if needed
        if (!aiEl) {
            aiEl = this._createAIInsightsElement();
        }
        
        aiEl.style.display = 'block';
        
        // Update load profile
        const loadEl = document.getElementById('ai-load-status');
        if (loadEl) {
            if (ai.loadProfile.isLearned) {
                loadEl.textContent = `Baseline: ${ai.loadProfile.baseline.toFixed(2)} ±${ai.loadProfile.stdDev.toFixed(2)}`;
                loadEl.style.color = '#44ff44';
            } else {
                loadEl.textContent = `Learning... (${ai.loadProfile.samples.length}/${ai.loadProfile.maxSamples})`;
                loadEl.style.color = '#ffc800';
            }
        }
        
        // Update frequency shift
        const freqEl = document.getElementById('ai-freq-shift');
        if (freqEl) {
            if (ai.freqShift.isShifting) {
                freqEl.textContent = `⚠️ ${ai.freqShift.shiftRate.toFixed(0)} Hz/sec`;
                freqEl.style.color = '#ff4444';
            } else if (ai.freqShift.shiftRate !== 0) {
                freqEl.textContent = `${ai.freqShift.shiftRate.toFixed(0)} Hz/sec`;
                freqEl.style.color = 'inherit';
            } else {
                freqEl.textContent = 'Stable';
                freqEl.style.color = '#44ff44';
            }
        }
        
        // Update spike count
        const spikeEl = document.getElementById('ai-spike-count');
        if (spikeEl) {
            spikeEl.textContent = `${ai.spikeDetection.spikeCount} spikes`;
            spikeEl.style.color = ai.spikeDetection.spikeCount >= 3 ? '#ff4444' : 'inherit';
        }
        
        // Update stability lobe
        const lobeEl = document.getElementById('ai-stability-lobe');
        if (lobeEl) {
            const sl = ai.stabilityLobe;
            if (sl.lobePosition === 'stable') {
                lobeEl.textContent = '✓ Stable zone';
                lobeEl.style.color = '#44ff44';
            } else if (sl.lobePosition === 'boundary') {
                lobeEl.textContent = `⚠️ Boundary - try ${sl.optimalRpm} RPM`;
                lobeEl.style.color = '#ffc800';
            } else if (sl.lobePosition === 'unstable') {
                lobeEl.textContent = `❌ Unstable - suggest ${sl.optimalRpm} RPM`;
                lobeEl.style.color = '#ff4444';
            } else {
                lobeEl.textContent = 'Analyzing...';
                lobeEl.style.color = 'inherit';
            }
        }
        
        // Update tool wear
        const wearEl = document.getElementById('ai-tool-wear');
        if (wearEl) {
            const wear = ai.toolWearAudio.wearEstimate;
            wearEl.textContent = `${Math.round(wear)}%`;
            wearEl.style.color = wear > 60 ? '#ff4444' : (wear > 30 ? '#ffc800' : '#44ff44');
        }
        
        // Update suggestions panel if chatter active
        this._updateSuggestionsUI();
    }
    
    /**
     * Update suggestions panel when chatter detected
     */
    _updateSuggestionsUI() {
        let panel = document.getElementById('chatter-suggestions-panel');
        
        // Only show if we have chatter or approaching chatter
        if (!this.state.inChatterZone && this.state.chatterAnalysis.chatterConfidence < 50) {
            if (panel) panel.style.display = 'none';
            return;
        }
        
        const suggestions = this.getSuggestedActions();
        if (suggestions.length === 0) {
            if (panel) panel.style.display = 'none';
            return;
        }
        
        // Create panel if needed
        if (!panel) {
            panel = this._createSuggestionsPanel();
        }
        
        panel.style.display = 'block';
        
        // Update suggestions list
        const listEl = document.getElementById('suggestions-list');
        if (listEl) {
            listEl.innerHTML = suggestions.slice(0, 3).map(s => `
                <div class="suggestion-item ${s.priority}">
                    <span class="suggestion-icon">${s.icon}</span>
                    <div class="suggestion-content">
                        <div class="suggestion-action">${s.action}</div>
                        <div class="suggestion-reason">${s.reason}</div>
                    </div>
                    ${s.command ? `<button class="suggestion-apply" onclick="chatterDetection.applySuggestion('${s.command}')">Apply</button>` : ''}
                </div>
            `).join('');
        }
    }
    
    /**
     * Create suggestions panel DOM
     */
    _createSuggestionsPanel() {
        const panel = document.createElement('div');
        panel.id = 'chatter-suggestions-panel';
        panel.innerHTML = `
            <style>
                #chatter-suggestions-panel {
                    background: rgba(255,200,0,0.1);
                    border: 1px solid rgba(255,200,0,0.4);
                    border-radius: 8px;
                    padding: 10px;
                    margin-top: 10px;
                }
                .suggestions-title {
                    font-size: 12px;
                    font-weight: bold;
                    color: #ffc800;
                    margin-bottom: 8px;
                }
                .suggestion-item {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    padding: 6px;
                    margin: 4px 0;
                    background: rgba(0,0,0,0.2);
                    border-radius: 4px;
                    font-size: 11px;
                }
                .suggestion-item.high { border-left: 3px solid #ff4444; }
                .suggestion-item.medium { border-left: 3px solid #ffc800; }
                .suggestion-item.low { border-left: 3px solid #44ff44; }
                .suggestion-icon { font-size: 16px; }
                .suggestion-content { flex: 1; }
                .suggestion-action { font-weight: bold; }
                .suggestion-reason { opacity: 0.7; font-size: 10px; }
                .suggestion-apply {
                    background: rgba(68,255,68,0.2);
                    border: 1px solid #44ff44;
                    color: #44ff44;
                    padding: 4px 8px;
                    border-radius: 4px;
                    cursor: pointer;
                    font-size: 10px;
                }
                .suggestion-apply:hover { background: rgba(68,255,68,0.4); }
            </style>
            <div class="suggestions-title">💡 SUGGESTED ACTIONS</div>
            <div id="suggestions-list"></div>
        `;
        
        const chatterPanel = document.getElementById('chatter-panel');
        if (chatterPanel) {
            chatterPanel.appendChild(panel);
        }
        
        return panel;
    }
    
    /**
     * Apply a suggested action (G-code command)
     */
    applySuggestion(command) {
        if (window.app?.grbl?.send) {
            console.log('[AI] Applying suggestion:', command);
            window.app.grbl.send(command);
            
            // If it's a spindle speed command, also update VFD directly
            const m3Match = command.match(/M3\s*S(\d+)/i);
            if (m3Match && this.state.vfd.ok) {
                const rpm = parseInt(m3Match[1]);
                console.log(`[AI] Also updating VFD to ${rpm} RPM`);
                this.vfdSetRpm(rpm);
            }
            
            // Show feedback
            const toast = document.createElement('div');
            toast.style.cssText = `
                position: fixed;
                bottom: 80px;
                left: 50%;
                transform: translateX(-50%);
                background: #44ff44;
                color: black;
                padding: 12px 24px;
                border-radius: 8px;
                font-weight: bold;
                z-index: 100002;
            `;
            toast.textContent = `Applied: ${command}`;
            document.body.appendChild(toast);
            setTimeout(() => toast.remove(), 2000);
        }
    }
    
    /**
     * Create AI insights DOM element
     */
    _createAIInsightsElement() {
        const el = document.createElement('div');
        el.id = 'chatter-ai-insights';
        el.innerHTML = `
            <style>
                #chatter-ai-insights {
                    background: rgba(68,136,255,0.1);
                    border: 1px solid rgba(68,136,255,0.3);
                    border-radius: 8px;
                    padding: 10px;
                    margin-top: 10px;
                    font-size: 11px;
                }
                .ai-title {
                    font-size: 12px;
                    font-weight: bold;
                    color: #4488ff;
                    margin-bottom: 8px;
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                }
                .ai-reset-btn {
                    background: rgba(255,255,255,0.1);
                    border: 1px solid rgba(255,255,255,0.3);
                    color: white;
                    padding: 2px 8px;
                    border-radius: 4px;
                    font-size: 9px;
                    cursor: pointer;
                }
                .ai-reset-btn:hover { background: rgba(255,255,255,0.2); }
                .ai-row {
                    display: flex;
                    justify-content: space-between;
                    margin: 4px 0;
                }
                .ai-label { opacity: 0.7; }
                .ai-value { font-family: monospace; }
            </style>
            <div class="ai-title">
                <span>🧠 AI ANALYSIS</span>
                <button class="ai-reset-btn" onclick="chatterDetection.resetToolSignature()">Reset Tool</button>
            </div>
            <div class="ai-row">
                <span class="ai-label">Load Profile:</span>
                <span class="ai-value" id="ai-load-status">Learning...</span>
            </div>
            <div class="ai-row">
                <span class="ai-label">Freq Shift:</span>
                <span class="ai-value" id="ai-freq-shift">N/A</span>
            </div>
            <div class="ai-row">
                <span class="ai-label">Spikes:</span>
                <span class="ai-value" id="ai-spike-count">0</span>
            </div>
            <div class="ai-row">
                <span class="ai-label">Stability:</span>
                <span class="ai-value" id="ai-stability-lobe">Analyzing...</span>
            </div>
            <div class="ai-row">
                <span class="ai-label">Tool Wear:</span>
                <span class="ai-value" id="ai-tool-wear">0%</span>
            </div>
        `;
        
        // Insert in chatter panel
        const chatterPanel = document.getElementById('chatter-panel');
        if (chatterPanel) {
            chatterPanel.appendChild(el);
        }
        
        return el;
    }
    
    // Draw the real-time graph with zones and enhanced visualization
    drawGraph() {
        const canvas = document.getElementById('chatter-graph');
        if (!canvas) return;
        
        const ctx = canvas.getContext('2d');
        const w = canvas.width;
        const h = canvas.height;
        const data = this.history.combined;
        const threshold = this.state.threshold || 0.55;
        const warningZone = threshold * 0.7;
        
        // Clear
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        ctx.fillRect(0, 0, w, h);
        
        // Draw zones (danger/warning/safe)
        // Danger zone (above threshold)
        const dangerY = h - (threshold * h);
        ctx.fillStyle = 'rgba(255,68,68,0.1)';
        ctx.fillRect(0, 0, w, dangerY);
        
        // Warning zone (70-100% of threshold)
        const warningY = h - (warningZone * h);
        ctx.fillStyle = 'rgba(255,200,0,0.08)';
        ctx.fillRect(0, dangerY, w, warningY - dangerY);
        
        // Draw threshold line
        ctx.strokeStyle = 'rgba(255,68,68,0.6)';
        ctx.setLineDash([4, 4]);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, dangerY);
        ctx.lineTo(w, dangerY);
        ctx.stroke();
        
        // Draw warning line
        ctx.strokeStyle = 'rgba(255,200,0,0.4)';
        ctx.beginPath();
        ctx.moveTo(0, warningY);
        ctx.lineTo(w, warningY);
        ctx.stroke();
        ctx.setLineDash([]);
        
        // Draw labels
        ctx.fillStyle = 'rgba(255,255,255,0.4)';
        ctx.font = '8px sans-serif';
        ctx.fillText('CHATTER', 2, dangerY - 2);
        ctx.fillText('WARNING', 2, warningY - 2);
        
        // Draw prediction line if applicable
        if (this.state.ticksToChatter > 0 && this.state.ticksToChatter < 20) {
            const predX = Math.min(w - 5, (data.length + this.state.ticksToChatter) * (w / this.history.maxLength));
            ctx.strokeStyle = 'rgba(255,100,0,0.6)';
            ctx.setLineDash([2, 2]);
            ctx.beginPath();
            ctx.moveTo(predX, 0);
            ctx.lineTo(predX, h);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.fillStyle = 'rgba(255,100,0,0.8)';
            ctx.fillText('⚠', predX - 4, 12);
        }
        
        // Draw data line
        if (data.length < 2) return;
        
        ctx.beginPath();
        ctx.strokeStyle = this.getScoreColor(this.state.combined);
        ctx.lineWidth = 2;
        
        const step = w / (this.history.maxLength - 1);
        for (let i = 0; i < data.length; i++) {
            const x = i * step;
            const y = h - (Math.min(data[i], 1) * h);
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.stroke();
        
        // Fill area under curve
        ctx.lineTo((data.length - 1) * step, h);
        ctx.lineTo(0, h);
        ctx.closePath();
        ctx.fillStyle = this.state.inChatterZone 
            ? 'rgba(255,68,68,0.2)' 
            : 'rgba(68,255,68,0.1)';
        ctx.fill();
        
        // Draw current value marker
        if (data.length > 0) {
            const lastX = (data.length - 1) * step;
            const lastY = h - (Math.min(data[data.length - 1], 1) * h);
            ctx.fillStyle = this.getScoreColor(this.state.combined);
            ctx.beginPath();
            ctx.arc(lastX, lastY, 4, 0, Math.PI * 2);
            ctx.fill();
        }
    }
    
    // Update spindle state indicator
    updateSpindleState() {
        const indicator = document.getElementById('chatter-spindle-state');
        if (!indicator) return;
        
        if (!this.state.spindleRunning) {
            indicator.textContent = '⚫ Idle';
            indicator.style.color = '#888';
        } else if (this.state.cutting) {
            indicator.textContent = '🟢 Cutting';
            indicator.style.color = '#44ff44';
        } else {
            indicator.textContent = '🟡 Spindle On';
            indicator.style.color = '#ffc800';
        }
    }
    
    getScoreColor(score) {
        const threshold = this.state.threshold || 0.55;
        if (score < threshold * 0.5) return '#44ff44';  // Green
        if (score < threshold) return '#ffc800';  // Yellow
        return '#ff4444';  // Red
    }
    
    getTrendIndicator(trend) {
        if (trend > 0.02) return '📈';  // Rising fast
        if (trend > 0.005) return '↗';  // Rising
        if (trend < -0.02) return '📉';  // Falling fast
        if (trend < -0.005) return '↘';  // Falling
        return '→';  // Stable
    }
    
    updateUI() {
        // Draw graph first
        this.drawGraph();
        this.updateSpindleState();
        
        // Update score values and bars
        const audio = document.getElementById('chatter-audio');
        const audioBar = document.getElementById('chatter-audio-bar');
        if (audio) audio.textContent = this.state.audio.toFixed(2);
        if (audioBar) {
            audioBar.style.width = `${Math.min(this.state.audio * 100, 100)}%`;
            audioBar.style.background = this.getScoreColor(this.state.audio);
        }
        
        const accel = document.getElementById('chatter-accel');
        const accelBar = document.getElementById('chatter-accel-bar');
        if (accel) accel.textContent = this.state.accel.toFixed(2);
        if (accelBar) {
            accelBar.style.width = `${Math.min(this.state.accel * 100, 100)}%`;
            accelBar.style.background = this.getScoreColor(this.state.accel);
        }
        
        const current = document.getElementById('chatter-current');
        const currentBar = document.getElementById('chatter-current-bar');
        if (current) current.textContent = this.state.current.toFixed(2);
        if (currentBar) {
            currentBar.style.width = `${Math.min(this.state.current * 100, 100)}%`;
            currentBar.style.background = this.getScoreColor(this.state.current);
        }
        
        // Combined score with trend indicator
        const combined = document.getElementById('chatter-combined');
        if (combined) {
            combined.textContent = this.state.combined.toFixed(2);
            combined.style.color = this.getScoreColor(this.state.combined);
        }
        
        const trendIndicator = document.getElementById('chatter-trend-indicator');
        if (trendIndicator) {
            trendIndicator.textContent = this.getTrendIndicator(this.state.trend);
        }
        
        // Threshold and noise floor
        const thresholdVal = document.getElementById('chatter-threshold-val');
        if (thresholdVal) thresholdVal.textContent = (this.state.threshold || 0.55).toFixed(2);
        
        const noiseVal = document.getElementById('chatter-noise-val');
        if (noiseVal) noiseVal.textContent = (this.state.noiseFloor || 0.05).toFixed(2);
        
        // Status text - more detailed
        const statusText = document.getElementById('chatter-status-text');
        if (statusText) {
            const bed = this.state.brokenEndmillDetection;
            
            if (this.state.toolBroken) {
                // Show which scenario triggered it
                let scenario = 'BROKEN';
                if (bed.plungeNoLoadWarned) scenario = 'NO PLUNGE LOAD';
                else if (bed.noLoadDuration > 0) scenario = 'NO CUT LOAD';
                else if (bed.silenceDuration > 0) scenario = 'SUDDEN SILENCE';
                
                statusText.textContent = `🔴 ${scenario} (${this.state.toolBrokenConfidence}%)`;
                statusText.className = 'combined-status danger';
            } else if (this.state.toolBrokenConfidence > 30) {
                // Early warning - show what we're detecting
                let warning = 'CHECKING';
                if (bed.plungeStartedAt > 0) warning = 'PLUNGE?';
                else if (bed.noLoadStartedAt > 0) warning = 'NO LOAD?';
                else if (bed.silenceStartedAt > 0) warning = 'SILENCE?';
                
                statusText.textContent = `⚠️ ${warning} (${this.state.toolBrokenConfidence}%)`;
                statusText.className = 'combined-status warning';
            } else if (this.state.overload) {
                statusText.textContent = '⚠️ OVERLOAD';
                statusText.className = 'combined-status danger';
            } else if (this.state.learning) {
                statusText.textContent = '🧠 LEARNING...';
                statusText.className = 'combined-status warning';
            } else if (this.state.calibrating) {
                statusText.textContent = '📊 CALIBRATING...';
                statusText.className = 'combined-status warning';
            } else if (this.state.inChatterZone) {
                // IMPROVED: Show pattern type
                const ca = this.state.chatterAnalysis;
                let patternIcon = '📳';
                if (ca.isResonant) patternIcon = '🔊';
                else if (ca.isProgressive) patternIcon = '📈';
                else if (ca.isIntermittent) patternIcon = '〰️';
                statusText.textContent = `${patternIcon} CHATTER (${ca.chatterConfidence}%)`;
                statusText.className = 'combined-status warning';
            } else if (this.state.chatter) {
                statusText.textContent = '⚡ DETECTED';
                statusText.className = 'combined-status warning';
            } else {
                statusText.textContent = `✓ STABLE (${this.state.stableCount})`;
                statusText.className = 'combined-status ok';
            }
        }
        
        // Stats
        const feed = document.getElementById('chatter-feed');
        if (feed) {
            feed.textContent = `${this.state.feed}%`;
            feed.style.color = this.state.feed < 80 ? '#ffc800' : (this.state.feed < 50 ? '#ff4444' : 'inherit');
        }
        
        const lastStable = document.getElementById('chatter-last-stable');
        if (lastStable) lastStable.textContent = `${this.state.lastStable || 100}%`;
        
        const amps = document.getElementById('chatter-amps');
        if (amps) {
            amps.textContent = `${this.state.amps.toFixed(1)} A`;
            // Color based on expected range
            const low = this.state.expectedAmpsLow || 1.5;
            const high = this.state.expectedAmpsHigh || 6.0;
            if (this.state.amps < low * 0.5) {
                amps.style.color = '#888';  // Gray = not cutting
            } else if (this.state.amps > high * 1.3) {
                amps.style.color = '#ff4444';  // Red = overload
            } else if (this.state.amps > high) {
                amps.style.color = '#ffc800';  // Yellow = high
            } else {
                amps.style.color = '#44ff44';  // Green = normal
            }
        }
        
        const expectedAmps = document.getElementById('chatter-expected-amps');
        if (expectedAmps) {
            const low = this.state.expectedAmpsLow || 1.5;
            const high = this.state.expectedAmpsHigh || 6.0;
            expectedAmps.textContent = `${low.toFixed(1)}-${high.toFixed(1)}A`;
        }
        
        const freq = document.getElementById('chatter-freq');
        if (freq) {
            // Use dominantFreq from Waveshare sensor if available, else fallback to legacy freq
            const freqValue = this.state.dominantFreq || this.state.freq || 0;
            freq.textContent = `${Math.round(freqValue)} Hz`;
        }
        
        // Waveshare-specific: Show confidence and calibration status
        const confidence = document.getElementById('chatter-confidence');
        if (confidence) {
            const conf = this.state.confidence || 0;
            confidence.textContent = `${Math.round(conf)}%`;
            confidence.style.color = conf >= 80 ? '#44ff44' : (conf >= 50 ? '#ffc800' : '#888');
        }
        
        const calibration = document.getElementById('chatter-calibration');
        if (calibration) {
            const cal = this.state.calibrationPct || 0;
            if (cal < 100) {
                calibration.textContent = `Calibrating ${cal}%`;
                calibration.style.color = '#ffc800';
            } else {
                calibration.textContent = 'Ready';
                calibration.style.color = '#44ff44';
            }
        }
        
        const vibration = document.getElementById('chatter-vibration');
        if (vibration) {
            const vib = this.state.vibrationG || 0;
            vibration.textContent = `${vib.toFixed(3)} g`;
        }
        
        // DS18B20 spindle temperature display
        const spindleTemp = document.getElementById('chatter-spindle-temp');
        if (spindleTemp) {
            const temp = this.state.spindleTempC;
            if (typeof temp === 'number' && temp > -127) {
                spindleTemp.textContent = `${temp.toFixed(1)}°C`;
                // Color based on temperature (PETG safe < 60°C)
                if (temp < 45) {
                    spindleTemp.style.color = '#44ff44';  // Green = cool
                } else if (temp < 55) {
                    spindleTemp.style.color = '#ffc800';  // Yellow = warm
                } else if (temp < 65) {
                    spindleTemp.style.color = '#ff8800';  // Orange = hot
                } else {
                    spindleTemp.style.color = '#ff4444';  // Red = too hot!
                }
            } else {
                spindleTemp.textContent = 'N/A';
                spindleTemp.style.color = '#888';
            }
        }
        
        // Tooth frequency (calculated from RPM and flutes)
        const toothFreq = document.getElementById('chatter-tooth-freq');
        if (toothFreq) {
            const tf = this.state.toothFreq || Math.round((this.state.rpm * this.state.toolFlutes) / 60);
            toothFreq.textContent = `${tf} Hz`;
        }
        
        const minFeed = document.getElementById('chatter-min-feed');
        if (minFeed) minFeed.textContent = `${this.state.minFeed || 20}%`;
        
        const trend = document.getElementById('chatter-trend');
        if (trend) {
            const t = this.state.trend || 0;
            trend.textContent = this.getTrendIndicator(t) + ` ${(t * 100).toFixed(1)}`;
            trend.style.color = t > 0.01 ? '#ff4444' : (t < -0.01 ? '#44ff44' : 'inherit');
        }
        
        // Cutting efficiency display
        const efficiency = document.getElementById('chatter-efficiency');
        if (efficiency) {
            const eff = this.state.efficiency || 0;
            const effPercent = Math.round(eff * 100);
            efficiency.textContent = `${effPercent}%`;
            // Color based on efficiency
            if (effPercent >= 70) {
                efficiency.style.color = '#44ff44';  // Green = optimal
            } else if (effPercent >= 40) {
                efficiency.style.color = '#ffc800';  // Yellow = ok
            } else {
                efficiency.style.color = '#ff4444';  // Red = poor
            }
        }
        
        // Update material display (in case it changed from WebSocket data)
        this.updateMaterialUI();
        
        // Update tool wear display
        this.updateToolWearUI();
        
        // Update VFD telemetry display
        this.updateVfdUI();
        
        // Update break recovery panel
        this.updateBreakRecoveryUI();
        
        // Update AI insights
        this.updateAIInsightsUI();
        
        // Toggle button
        const toggle = document.getElementById('chatter-toggle');
        if (toggle) {
            toggle.textContent = this.state.enabled ? 'Disable' : 'Enable';
            toggle.className = `chatter-btn ${this.state.enabled ? 'danger' : 'primary'}`;
        }
        
        // Mode buttons
        const modes = ['auto', 'aggressive', 'conservative'];
        const modeMap = { 0: 'auto', 1: 'aggressive', 2: 'conservative' };
        const currentMode = modeMap[this.state.mode] || 'auto';
        modes.forEach(m => {
            const btn = document.getElementById(`mode-${m}`);
            if (btn) {
                btn.className = `chatter-btn ${m === currentMode ? 'primary' : 'secondary'}`;
                btn.style.fontSize = '10px';
            }
        });
    }
    
    destroy() {
        this.disconnect();
        if (this.panel && this.panel.parentNode) {
            this.panel.parentNode.removeChild(this.panel);
        }
        window.chatterDetection = null;
    }
    
    // Show diagnostic modal with spectrum analyzer
    showDiagnostics() {
        // Request spectrum and diagnostic data
        this.send('spectrum');
        this.send('diag');
        
        // Create modal
        const modal = document.createElement('div');
        modal.id = 'chatter-diag-modal';
        modal.innerHTML = `
            <style>
                #chatter-diag-modal {
                    position: fixed;
                    inset: 0;
                    background: rgba(0,0,0,0.9);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    z-index: 100001;
                    font-family: 'Segoe UI', system-ui, sans-serif;
                }
                .diag-dialog {
                    background: linear-gradient(145deg, #1a1a2e, #16213e);
                    border-radius: 16px;
                    width: 550px;
                    max-width: 95vw;
                    max-height: 90vh;
                    overflow-y: auto;
                    color: white;
                    box-shadow: 0 20px 60px rgba(0,0,0,0.5);
                }
                .diag-header {
                    padding: 20px 24px 12px;
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                }
                .diag-header h2 { margin: 0; font-size: 18px; }
                .diag-close {
                    background: none;
                    border: none;
                    color: white;
                    font-size: 24px;
                    cursor: pointer;
                    opacity: 0.6;
                }
                .diag-close:hover { opacity: 1; }
                .diag-body { padding: 0 24px 24px; }
                .diag-section {
                    margin-bottom: 20px;
                    padding: 12px;
                    background: rgba(255,255,255,0.05);
                    border-radius: 8px;
                }
                .diag-section h4 { margin: 0 0 10px; font-size: 12px; opacity: 0.7; text-transform: uppercase; }
                .diag-grid {
                    display: grid;
                    grid-template-columns: repeat(2, 1fr);
                    gap: 8px;
                    font-size: 12px;
                }
                .diag-item { display: flex; justify-content: space-between; }
                .diag-item .label { opacity: 0.7; }
                .diag-item .value { font-weight: 600; font-family: monospace; }
                .spectrum-canvas {
                    width: 100%;
                    height: 80px;
                    background: rgba(0,0,0,0.3);
                    border-radius: 4px;
                    margin-top: 8px;
                }
            </style>
            <div class="diag-dialog">
                <div class="diag-header">
                    <h2>📊 Chatter Diagnostics</h2>
                    <button class="diag-close" onclick="document.getElementById('chatter-diag-modal').remove()">×</button>
                </div>
                <div class="diag-body">
                    <div class="diag-section">
                        <h4>System Info</h4>
                        <div class="diag-grid" id="diag-system">
                            <div class="diag-item"><span class="label">Free Heap</span><span class="value" id="diag-heap">---</span></div>
                            <div class="diag-item"><span class="label">Uptime</span><span class="value" id="diag-uptime">---</span></div>
                            <div class="diag-item"><span class="label">WiFi RSSI</span><span class="value" id="diag-rssi">---</span></div>
                            <div class="diag-item"><span class="label">WS Clients</span><span class="value" id="diag-clients">---</span></div>
                        </div>
                    </div>
                    
                    <div class="diag-section">
                        <h4>🔌 Sensor Health</h4>
                        <div class="diag-grid" id="diag-sensors">
                            <div class="diag-item">
                                <span class="label">MPU-6050 (Accel)</span>
                                <span class="value" id="diag-sensor-mpu" style="color:${this.state.sensors?.mpuOk !== false ? '#44ff44' : '#ff4444'}">${this.state.sensors?.mpuOk !== false ? '✓ OK' : '✗ ' + (this.state.sensors?.mpuErrStr || 'Error')}</span>
                            </div>
                            <div class="diag-item">
                                <span class="label">INMP441 (Mic)</span>
                                <span class="value" id="diag-sensor-i2s" style="color:${this.state.sensors?.i2sOk !== false ? '#44ff44' : '#ff4444'}">${this.state.sensors?.i2sOk !== false ? '✓ OK' : '✗ ' + (this.state.sensors?.i2sErrStr || 'Error')}</span>
                            </div>
                            <div class="diag-item">
                                <span class="label">ACS712 (Current)</span>
                                <span class="value" id="diag-sensor-adc" style="color:${this.state.sensors?.adcOk !== false ? '#44ff44' : '#ff4444'}">${this.state.sensors?.adcOk !== false ? '✓ OK' : '✗ ' + (this.state.sensors?.adcErrStr || 'Error')}</span>
                            </div>
                            <div class="diag-item" id="diag-vfd-row" style="display:${this.state.sensors?.vfdOk !== undefined ? 'flex' : 'none'}">
                                <span class="label">VFD (Modbus)</span>
                                <span class="value" id="diag-sensor-vfd" style="color:${this.state.sensors?.vfdOk !== false ? '#44ff44' : '#ff4444'}">${this.state.sensors?.vfdOk !== false ? '✓ OK' : '✗ ' + (this.state.sensors?.vfdErrStr || 'Error')}</span>
                            </div>
                            <div class="diag-item">
                                <span class="label">All Sensors</span>
                                <span class="value" id="diag-sensor-all" style="color:${this.state.sensors?.allOk !== false ? '#44ff44' : '#ff4444'}">${this.state.sensors?.allOk !== false ? '✓ All OK' : '⚠️ Issues'}</span>
                            </div>
                        </div>
                        <div id="sensor-error-detail" style="display:${this.state.sensors?.allOk === false ? 'block' : 'none'};margin-top:8px;padding:8px;background:rgba(255,68,68,0.2);border-radius:4px;font-size:11px;">
                            <b>Troubleshooting:</b><br>
                            <span id="sensor-error-text">Check wiring and connections.</span>
                        </div>
                    </div>
                    
                    <div class="diag-section">
                        <h4>Detection Settings</h4>
                        <div class="diag-grid">
                            <div class="diag-item"><span class="label">Material</span><span class="value" id="diag-material">${this.state.material}</span></div>
                            <div class="diag-item"><span class="label">Threshold</span><span class="value">${this.state.threshold.toFixed(2)}</span></div>
                            <div class="diag-item"><span class="label">Audio Range</span><span class="value" id="diag-audio-range">---</span></div>
                            <div class="diag-item"><span class="label">Accel Range</span><span class="value" id="diag-accel-range">---</span></div>
                            <div class="diag-item"><span class="label">Tooth Pass Freq</span><span class="value" id="diag-tooth-freq">---</span></div>
                            <div class="diag-item"><span class="label">Current Score</span><span class="value">${this.state.combined.toFixed(3)}</span></div>
                        </div>
                    </div>
                    
                    <div class="diag-section">
                        <h4>Audio Spectrum (Chatter Frequencies)</h4>
                        <canvas id="diag-audio-spectrum" class="spectrum-canvas" width="500" height="80"></canvas>
                        <div style="font-size:10px;opacity:0.5;margin-top:4px;">Higher bars = more energy at that frequency. Red zone = chatter band.</div>
                    </div>
                    
                    <div class="diag-section">
                        <h4>Accelerometer Spectrum</h4>
                        <canvas id="diag-accel-spectrum" class="spectrum-canvas" width="500" height="80"></canvas>
                    </div>
                    
                    <div class="diag-section">
                        <h4>Session Statistics</h4>
                        <div class="diag-grid" id="diag-stats">
                            <div class="diag-item"><span class="label">Total Chatter Events</span><span class="value" id="diag-chatter-events">${this.state.sessionChatterEvents}</span></div>
                            <div class="diag-item"><span class="label">Session Duration</span><span class="value" id="diag-session-duration">${this.getSessionSummary().duration}</span></div>
                            <div class="diag-item"><span class="label">Max Chatter Score</span><span class="value" id="diag-max-score">${this.state.sessionMaxScore.toFixed(2)}</span></div>
                            <div class="diag-item"><span class="label">Avg Score</span><span class="value" id="diag-avg-score">${this.state.sessionAvgScore.toFixed(3)}</span></div>
                            <div class="diag-item"><span class="label">Feed Reductions</span><span class="value" id="diag-feed-reductions">${this.state.sessionFeedReductions}</span></div>
                            <div class="diag-item"><span class="label">Recoveries</span><span class="value" id="diag-recoveries">${this.state.sessionRecoveries}</span></div>
                            <div class="diag-item"><span class="label">Cutting Time</span><span class="value" id="diag-cutting-time">${this.getSessionSummary().cuttingTime}</span></div>
                            <div class="diag-item"><span class="label">Session Efficiency</span><span class="value" id="diag-efficiency">${this.getSessionSummary().efficiency}</span></div>
                        </div>
                        <button class="chatter-btn secondary" style="width:100%;margin-top:8px;font-size:10px;" onclick="window.chatterDetection.resetSession();">
                            🔄 Reset Session
                        </button>
                    </div>
                    
                    <div class="diag-section">
                        <h4>🧠 Advanced Analysis</h4>
                        <div class="diag-grid">
                            <div class="diag-item"><span class="label">Low Band (50-200Hz)</span><span class="value" id="analysis-low-band">---</span></div>
                            <div class="diag-item"><span class="label">Mid Band (200-1kHz)</span><span class="value" id="analysis-mid-band">---</span></div>
                            <div class="diag-item"><span class="label">High Band (1kHz+)</span><span class="value" id="analysis-high-band">---</span></div>
                            <div class="diag-item"><span class="label">Harmonics</span><span class="value" id="analysis-harmonics">---</span></div>
                            <div class="diag-item"><span class="label">Pattern</span><span class="value" id="analysis-pattern">---</span></div>
                            <div class="diag-item"><span class="label">Confidence</span><span class="value" id="analysis-confidence">---</span></div>
                            <div class="diag-item"><span class="label">Prediction</span><span class="value" id="analysis-prediction">---</span></div>
                            <div class="diag-item"><span class="label">EMA Score</span><span class="value">${(this.state.emaCombined || 0).toFixed(3)}</span></div>
                        </div>
                    </div>
                    
                    <div class="diag-section">
                        <h4>🗺️ Chatter Map</h4>
                        <canvas id="chatter-map-canvas" style="width:100%;height:120px;background:rgba(0,0,0,0.3);border-radius:4px;" width="500" height="120"></canvas>
                        <div style="font-size:10px;opacity:0.5;margin-top:4px;">X/Y positions where chatter was detected. Red = severe, green = mild.</div>
                        <div style="display:flex;gap:8px;margin-top:8px;">
                            <button class="chatter-btn secondary" style="flex:1;font-size:10px;" onclick="window.chatterDetection.send('map');">
                                Refresh Map
                            </button>
                            <button class="chatter-btn danger" style="flex:1;font-size:10px;" onclick="window.chatterDetection.send('clearMap');">
                                Clear Map
                            </button>
                        </div>
                    </div>
                    
                    <div class="diag-section">
                        <h4>Data Export</h4>
                        <div style="display:flex;gap:8px;flex-wrap:wrap;">
                            <button class="chatter-btn secondary" style="flex:1;min-width:120px;" onclick="window.chatterDetection.exportSessionLog();">
                                📋 Export Log
                            </button>
                            <button class="chatter-btn secondary" style="flex:1;min-width:120px;" onclick="window.chatterDetection.exportSettings();">
                                ⚙️ Export Config
                            </button>
                            <button class="chatter-btn secondary" style="flex:1;min-width:120px;" onclick="window.chatterDetection.startRecording();" id="diag-record-btn">
                                🔴 Record Data
                            </button>
                        </div>
                    </div>
                    
                    <div style="display:flex;gap:8px;">
                        <button class="chatter-btn secondary" style="flex:1;" onclick="window.chatterDetection.send('spectrum');window.chatterDetection.send('diag');window.chatterDetection.send('analysis');window.chatterDetection.send('map');">
                            🔄 Refresh All
                        </button>
                        <button class="chatter-btn danger" style="flex:1;" onclick="window.chatterDetection.resetStats();">
                            🗑️ Reset Stats
                        </button>
                    </div>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        this.diagModalOpen = true;

        // Close handling
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.remove();
            }
        });
        const closeBtn = modal.querySelector('.diag-close');
        if (closeBtn) {
            closeBtn.onclick = () => modal.remove();
        }
        modal.addEventListener('DOMNodeRemoved', () => {
            if (!document.getElementById('chatter-diag-modal')) {
                this.diagModalOpen = false;
            }
        });

        // Request all diagnostic data
        this.send('stats');
        this.send('analysis');
        this.send('map');
    }

    // Handle non-state WebSocket messages
    handleAuxMessage(data) {
        // Store for later use even if modal is closed
        if (data.type === 'chatterMap') {
            this._chatterMap = data;
            this.updateChatterMapUI();
            return;
        }
        
        if (data.type === 'features') {
            this._mlFeatures = data;
            console.log('[Chatter] ML Features:', data);
            return;
        }
        
        if (data.type === 'analysis') {
            this._analysisData = data;
            this.updateAnalysisUI(data);
            return;
        }
        
        if (data.type === 'settings') {
            // Settings export response
            this.downloadFile('chatter-settings.json', JSON.stringify(data, null, 2), 'application/json');
            return;
        }
        
        if (data.type === 'network') {
            console.log('[Chatter] Network info:', data);
            return;
        }

        if (!this.diagModalOpen) return;

        try {
            if (data.type === 'diagnostic') {
                const heap = document.getElementById('diag-heap');
                const up = document.getElementById('diag-uptime');
                const rssi = document.getElementById('diag-rssi');
                const clients = document.getElementById('diag-clients');
                const ar = document.getElementById('diag-audio-range');
                const vr = document.getElementById('diag-accel-range');
                const tpf = document.getElementById('diag-tooth-freq');
                if (heap) heap.textContent = `${(data.freeHeap / 1024).toFixed(1)} KB`;
                if (up) up.textContent = `${Math.floor(data.uptime / 60)}m ${data.uptime % 60}s`;
                if (rssi) rssi.textContent = `${data.wifiRSSI} dBm`;
                if (clients) clients.textContent = data.wsClients;
                if (ar) ar.textContent = data.audioRange;
                if (vr) vr.textContent = data.accelRange;
                if (tpf) tpf.textContent = `${data.toothPassFreq} Hz`;
                
                // Update sensor health from diagnostic data
                if (data.sensors) {
                    this.updateSensorHealthUI(data.sensors);
                }
                return;
            }

            if (data.type === 'spectrum') {
                this.drawSpectrumGraph('diag-audio-spectrum', data.audio, data.audioStartHz, data.audioHzPerBin, 'audio');
                this.drawSpectrumGraph('diag-accel-spectrum', data.accel, data.accelStartHz, data.accelHzPerBin, 'accel');
                return;
            }

            if (data.type === 'stats') {
                const ce = document.getElementById('diag-chatter-events');
                const ct = document.getElementById('diag-cutting-time');
                const ms = document.getElementById('diag-max-score');
                if (ce) ce.textContent = data.totalChatterEvents;
                if (ct) ct.textContent = `${Math.floor(data.totalCuttingTime / 60)}m ${data.totalCuttingTime % 60}s`;
                if (ms) ms.textContent = (data.maxChatterScore ?? 0).toFixed(3);
            }
        } catch (e) {
            // ignore UI update errors
        }
    }
    
    // Update advanced analysis UI
    updateAnalysisUI(data) {
        // Update frequency bands display
        const bandLow = document.getElementById('analysis-low-band');
        const bandMid = document.getElementById('analysis-mid-band');
        const bandHigh = document.getElementById('analysis-high-band');
        if (bandLow) bandLow.textContent = data.lowBand.toFixed(2);
        if (bandMid) bandMid.textContent = data.midBand.toFixed(2);
        if (bandHigh) bandHigh.textContent = data.highBand.toFixed(2);
        
        // Harmonics
        const harmonicsEl = document.getElementById('analysis-harmonics');
        if (harmonicsEl) {
            harmonicsEl.textContent = data.harmonicsDetected ? 
                `Yes (${data.harmonicRatio.toFixed(2)} ratio)` : 'No';
        }
        
        // Pattern
        const patternEl = document.getElementById('analysis-pattern');
        if (patternEl) {
            let pattern = 'Normal';
            if (data.risingChatter) pattern = '⚠️ Rising';
            else if (data.stableChatter) pattern = '🔴 Stable Chatter';
            else if (data.intermittent) pattern = '⚡ Intermittent';
            patternEl.textContent = pattern;
        }
        
        // Confidence
        const confEl = document.getElementById('analysis-confidence');
        if (confEl) confEl.textContent = `${(data.confidence * 100).toFixed(0)}%`;
        
        // Prediction
        const predEl = document.getElementById('analysis-prediction');
        if (predEl) {
            if (data.ticksToChatter > 0 && data.ticksToChatter < 20) {
                predEl.textContent = `~${(data.ticksToChatter * 0.05).toFixed(1)}s to threshold`;
                predEl.style.color = '#ff6600';
            } else if (data.predicted > this.state.threshold) {
                predEl.textContent = 'Chatter likely';
                predEl.style.color = '#ff4444';
            } else {
                predEl.textContent = 'Stable';
                predEl.style.color = '#44ff44';
            }
        }
    }
    
    // Update chatter map visualization
    updateChatterMapUI() {
        const canvas = document.getElementById('chatter-map-canvas');
        if (!canvas || !this._chatterMap) return;
        
        const ctx = canvas.getContext('2d');
        const w = canvas.width;
        const h = canvas.height;
        const positions = this._chatterMap.positions || [];
        
        // Clear
        ctx.fillStyle = 'rgba(0,0,0,0.9)';
        ctx.fillRect(0, 0, w, h);
        
        if (positions.length === 0) {
            ctx.fillStyle = 'rgba(255,255,255,0.5)';
            ctx.font = '12px sans-serif';
            ctx.fillText('No chatter positions logged', w/2 - 70, h/2);
            return;
        }
        
        // Find bounds
        let minX = Infinity, maxX = -Infinity;
        let minY = Infinity, maxY = -Infinity;
        for (const p of positions) {
            minX = Math.min(minX, p.x);
            maxX = Math.max(maxX, p.x);
            minY = Math.min(minY, p.y);
            maxY = Math.max(maxY, p.y);
        }
        
        // Add margin
        const rangeX = maxX - minX || 1;
        const rangeY = maxY - minY || 1;
        const margin = 20;
        
        // Draw grid
        ctx.strokeStyle = 'rgba(100,100,100,0.3)';
        ctx.lineWidth = 1;
        for (let i = 0; i <= 4; i++) {
            const x = margin + (i * (w - 2*margin) / 4);
            const y = margin + (i * (h - 2*margin) / 4);
            ctx.beginPath();
            ctx.moveTo(x, margin);
            ctx.lineTo(x, h - margin);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(margin, y);
            ctx.lineTo(w - margin, y);
            ctx.stroke();
        }
        
        // Draw chatter points
        for (const p of positions) {
            const x = margin + ((p.x - minX) / rangeX) * (w - 2*margin);
            const y = h - margin - ((p.y - minY) / rangeY) * (h - 2*margin);
            const intensity = Math.min(1, p.score / this.state.threshold);
            
            // Color based on score
            const r = Math.floor(255 * intensity);
            const g = Math.floor(255 * (1 - intensity));
            ctx.fillStyle = `rgba(${r},${g},0,0.8)`;
            ctx.beginPath();
            ctx.arc(x, y, 4 + intensity * 4, 0, Math.PI * 2);
            ctx.fill();
        }
        
        // Labels
        ctx.fillStyle = 'rgba(255,255,255,0.7)';
        ctx.font = '10px monospace';
        ctx.fillText(`X: ${minX.toFixed(1)} - ${maxX.toFixed(1)}`, 5, h - 5);
        ctx.fillText(`Y: ${minY.toFixed(1)} - ${maxY.toFixed(1)}`, w - 80, h - 5);
        ctx.fillText(`${positions.length} points`, 5, 12);
    }
    
    // ========================================================================
    // SMART RECOMMENDATIONS
    // ========================================================================
    
    // Analyze session data and suggest improvements
    getSmartRecommendations() {
        const recommendations = [];
        
        // Analyze from current state
        const s = this.state;
        
        // Check frequency bands
        const bands = this.getFrequencyBands();
        if (bands.mid > bands.low * 2 && bands.mid > bands.high * 2) {
            recommendations.push({
                type: 'info',
                icon: '📊',
                title: 'Mid-frequency dominance detected',
                description: 'High energy in 200-1000Hz range is typical of chatter. Consider reducing RPM or feed rate.',
                action: () => this.send('mode:aggressive')
            });
        }
        
        // Check harmonics
        if (this.hasHarmonics() && s.harmonicRatio > 0.5) {
            recommendations.push({
                type: 'warning',
                icon: '🔊',
                title: 'Strong harmonic pattern',
                description: `Harmonic ratio: ${s.harmonicRatio.toFixed(2)}. This suggests resonance. Try different spindle speed.`,
                suggestion: `Current RPM: ${s.rpm}. Try: ${Math.round(s.rpm * 0.85)} or ${Math.round(s.rpm * 1.15)}`
            });
        }
        
        // Check trend
        if (s.trend > 0.02 && s.combined > s.threshold * 0.6) {
            recommendations.push({
                type: 'urgent',
                icon: '⚠️',
                title: 'Rising chatter detected',
                description: 'Chatter is building up. Preemptive action recommended.',
                action: () => {
                    const newFeed = Math.max(20, s.feed - 10);
                    console.log(`[Smart] Preemptive feed reduction to ${newFeed}%`);
                }
            });
        }
        
        // Check intermittent pattern
        if (s.intermittent) {
            recommendations.push({
                type: 'info',
                icon: '⚡',
                title: 'Intermittent chatter',
                description: 'Chatter comes and goes. This may indicate varying material hardness or tool engagement.',
                suggestion: 'Consider more consistent depth of cut or check for backlash.'
            });
        }
        
        // Check sensor agreement
        const spread = Math.max(s.audio, s.accel, s.current) - Math.min(s.audio, s.accel, s.current);
        if (spread > 0.3 && s.combined > 0.3) {
            const highSensor = s.audio > s.accel && s.audio > s.current ? 'Audio' :
                              s.accel > s.current ? 'Accel' : 'Current';
            recommendations.push({
                type: 'info',
                icon: '🔧',
                title: `${highSensor} sensor dominant`,
                description: `Consider adjusting sensor weights. ${highSensor} may be over-reporting.`,
                suggestion: `Current weights: Audio=${s.wAudio}, Accel=${s.wAccel}, Current=${s.wCurrent}`
            });
        }
        
        // Check if stable at reduced feed
        if (s.stableCount > 20 && s.feed < 90 && s.feed > 50) {
            recommendations.push({
                type: 'success',
                icon: '✅',
                title: 'Stable at reduced feed',
                description: `System stable at ${s.feed}% feed. You may save this as the optimal setting.`,
                action: () => {
                    localStorage.setItem(`optimalFeed_${s.material}`, s.feed);
                    console.log(`[Smart] Saved optimal feed ${s.feed}% for ${s.material}`);
                }
            });
        }
        
        // Check material-specific
        const optimalFeed = localStorage.getItem(`optimalFeed_${s.material}`);
        if (optimalFeed && s.feed > parseInt(optimalFeed) + 10 && s.chatter) {
            recommendations.push({
                type: 'warning',
                icon: '💡',
                title: 'Previously found optimal',
                description: `For ${s.material}, you previously found ${optimalFeed}% feed to be stable.`,
                suggestion: `Consider starting at ${optimalFeed}% for this material.`
            });
        }
        
        // Low confidence with detection
        if (s.chatter && s.confidence < 0.5) {
            recommendations.push({
                type: 'info',
                icon: '❓',
                title: 'Low confidence detection',
                description: 'Chatter detected but confidence is low. May be false positive.',
                suggestion: 'Consider running "learn" to recalibrate noise floor.'
            });
        }
        
        // Prediction warning
        if (this.isChatterPredicted()) {
            recommendations.push({
                type: 'urgent',
                icon: '⏱️',
                title: 'Chatter predicted soon',
                description: `Estimated ${(s.ticksToChatter * 0.05).toFixed(1)} seconds until threshold.`,
                action: () => this.send('mode:aggressive')
            });
        }
        
        return recommendations;
    }
    
    // Display recommendations in UI
    showRecommendations() {
        const recommendations = this.getSmartRecommendations();
        
        if (recommendations.length === 0) {
            this.showNotification('No recommendations at this time', 'success');
            return;
        }
        
        // Create recommendations modal
        const modal = document.createElement('div');
        modal.id = 'chatter-recommendations-modal';
        modal.innerHTML = `
            <style>
                #chatter-recommendations-modal {
                    position: fixed;
                    inset: 0;
                    background: rgba(0,0,0,0.9);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    z-index: 100001;
                    font-family: 'Segoe UI', system-ui, sans-serif;
                }
                .rec-dialog {
                    background: linear-gradient(145deg, #1a1a2e, #16213e);
                    border-radius: 16px;
                    width: 450px;
                    max-width: 95vw;
                    max-height: 80vh;
                    overflow-y: auto;
                    color: white;
                    box-shadow: 0 20px 60px rgba(0,0,0,0.5);
                }
                .rec-header {
                    padding: 20px 24px 12px;
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    border-bottom: 1px solid rgba(255,255,255,0.1);
                }
                .rec-header h2 { margin: 0; font-size: 18px; }
                .rec-close {
                    background: none;
                    border: none;
                    color: white;
                    font-size: 24px;
                    cursor: pointer;
                    opacity: 0.6;
                }
                .rec-close:hover { opacity: 1; }
                .rec-body { padding: 16px 24px 24px; }
                .rec-item {
                    padding: 12px;
                    margin-bottom: 10px;
                    border-radius: 8px;
                    background: rgba(255,255,255,0.05);
                    border-left: 3px solid #888;
                }
                .rec-item.urgent { border-left-color: #ff4444; background: rgba(255,0,0,0.1); }
                .rec-item.warning { border-left-color: #ffc800; background: rgba(255,200,0,0.1); }
                .rec-item.success { border-left-color: #44ff44; background: rgba(0,255,0,0.1); }
                .rec-item.info { border-left-color: #4488ff; }
                .rec-title { font-weight: 600; font-size: 14px; margin-bottom: 4px; }
                .rec-desc { font-size: 12px; opacity: 0.8; margin-bottom: 4px; }
                .rec-suggestion { font-size: 11px; opacity: 0.6; font-style: italic; }
            </style>
            <div class="rec-dialog">
                <div class="rec-header">
                    <h2>💡 Smart Recommendations</h2>
                    <button class="rec-close" onclick="document.getElementById('chatter-recommendations-modal').remove()">×</button>
                </div>
                <div class="rec-body">
                    ${recommendations.map(r => `
                        <div class="rec-item ${r.type}">
                            <div class="rec-title">${r.icon} ${r.title}</div>
                            <div class="rec-desc">${r.description}</div>
                            ${r.suggestion ? `<div class="rec-suggestion">${r.suggestion}</div>` : ''}
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        modal.addEventListener('click', (e) => {
            if (e.target === modal) modal.remove();
        });
    }
    
    // Show a notification
    showNotification(message, type = 'info') {
        const colors = {
            success: '#44ff44',
            warning: '#ffc800',
            danger: '#ff4444',
            info: '#4488ff'
        };
        
        const notif = document.createElement('div');
        notif.style.cssText = `
            position: fixed;
            bottom: 20px;
            right: 20px;
            background: ${colors[type] || colors.info};
            color: ${type === 'warning' ? '#000' : '#fff'};
            padding: 12px 20px;
            border-radius: 8px;
            font-size: 14px;
            z-index: 100002;
            box-shadow: 0 4px 20px rgba(0,0,0,0.3);
            animation: slideIn 0.3s ease;
        `;
        notif.textContent = message;
        document.body.appendChild(notif);
        
        setTimeout(() => {
            notif.style.opacity = '0';
            notif.style.transition = 'opacity 0.3s';
            setTimeout(() => notif.remove(), 300);
        }, 3000);
    }
    
    // Draw spectrum graph on canvas
    drawSpectrumGraph(canvasId, data, startHz, hzPerBin, type) {
        const canvas = document.getElementById(canvasId);
        if (!canvas || !data) return;
        
        const ctx = canvas.getContext('2d');
        const w = canvas.width;
        const h = canvas.height;
        
        // Clear
        ctx.fillStyle = 'rgba(0,0,0,0.8)';
        ctx.fillRect(0, 0, w, h);
        
        // Find max for normalization
        const maxVal = Math.max(...data, 1);
        
        // Draw bars
        const barWidth = w / data.length;
        for (let i = 0; i < data.length; i++) {
            const x = i * barWidth;
            const barHeight = (data[i] / maxVal) * (h - 10);
            const freq = startHz + (i * hzPerBin);
            
            // Color based on frequency (chatter zone is red)
            let color;
            if (type === 'audio') {
                // Audio chatter zone: 800-4000 Hz typically
                color = (freq >= 800 && freq <= 4000) ? '#ff4444' : '#4488ff';
            } else {
                // Accel chatter zone: 100-400 Hz
                color = (freq >= 100 && freq <= 400) ? '#ff4444' : '#44ff88';
            }
            
            ctx.fillStyle = color;
            ctx.fillRect(x, h - barHeight, barWidth - 1, barHeight);
        }
        
        // Draw frequency labels
        ctx.fillStyle = 'rgba(255,255,255,0.6)';
        ctx.font = '9px monospace';
        ctx.fillText(`${startHz}Hz`, 2, 10);
        ctx.fillText(`${startHz + data.length * hzPerBin}Hz`, w - 50, 10);
    }
    
    // ========================================================================
    // DATA EXPORT AND RECORDING
    // ========================================================================
    
    // Export session log as JSON
    exportSessionLog() {
        const log = {
            exportDate: new Date().toISOString(),
            session: {
                material: this.state.material,
                operation: this.operations[this.state.operation],
                tool: `${this.state.toolDia}mm ${this.state.toolFlutes}F`,
                rpm: this.state.rpm,
                threshold: this.state.threshold
            },
            history: {
                combined: this.history.combined.slice(-200),
                amps: this.history.amps.slice(-200),
                feed: this.history.feed.slice(-200)
            },
            alerts: this._alertLog || []
        };
        
        this.downloadFile('chatter-session-log.json', JSON.stringify(log, null, 2));
    }
    
    // Export current settings
    exportSettings() {
        const settings = {
            material: this.state.material,
            materialIndex: this.state.materialIndex,
            operation: this.state.operation,
            toolDia: this.state.toolDia,
            toolFlutes: this.state.toolFlutes,
            rpm: this.state.rpm,
            threshold: this.state.threshold,
            noiseFloor: this.state.noiseFloor,
            weights: {
                audio: this.state.wAudio,
                accel: this.state.wAccel,
                current: this.state.wCurrent
            },
            mode: this.state.mode,
            audioEnabled: this.audioEnabled,
            espAddress: localStorage.getItem('chatterEspIp')
        };
        
        this.downloadFile('chatter-settings.json', JSON.stringify(settings, null, 2));
    }
    
    // Import settings from file
    importSettings(jsonString) {
        try {
            const settings = JSON.parse(jsonString);
            if (settings.material) this.setMaterial(settings.material);
            if (settings.operation !== undefined) this.setOperation(this.operations[settings.operation]);
            if (settings.toolDia && settings.toolFlutes && settings.rpm) {
                this.setTool(settings.toolDia, settings.toolFlutes, settings.rpm);
            }
            if (settings.threshold) this.setThreshold(settings.threshold);
            console.log('[Chatter] Settings imported successfully');
            return true;
        } catch (e) {
            console.error('[Chatter] Failed to import settings:', e);
            return false;
        }
    }
    
    // Start recording data to memory
    startRecording() {
        if (this._recording) {
            this.stopRecording();
            return;
        }
        
        this._recording = true;
        this._recordedData = [];
        this._recordStart = Date.now();
        
        // Update button
        const btn = document.getElementById('diag-record-btn');
        if (btn) {
            btn.textContent = '⏹️ Stop Recording';
            btn.classList.remove('secondary');
            btn.classList.add('danger');
        }
        
        console.log('[Chatter] Recording started');
    }
    
    stopRecording() {
        if (!this._recording) return;
        
        this._recording = false;
        const duration = (Date.now() - this._recordStart) / 1000;
        
        // Update button
        const btn = document.getElementById('diag-record-btn');
        if (btn) {
            btn.textContent = '🔴 Record Data';
            btn.classList.remove('danger');
            btn.classList.add('secondary');
        }
        
        // Export recorded data
        const data = {
            recordDate: new Date().toISOString(),
            duration: duration,
            sampleCount: this._recordedData.length,
            material: this.state.material,
            samples: this._recordedData
        };
        
        this.downloadFile('chatter-recording.json', JSON.stringify(data, null, 2));
        console.log(`[Chatter] Recording stopped: ${this._recordedData.length} samples over ${duration.toFixed(1)}s`);
        
        this._recordedData = [];
    }
    
    // Called on each update to record data if recording
    recordSample() {
        if (!this._recording) return;
        
        this._recordedData.push({
            t: Date.now() - this._recordStart,
            a: Math.round(this.state.audio * 1000) / 1000,
            v: Math.round(this.state.accel * 1000) / 1000,
            c: Math.round(this.state.current * 1000) / 1000,
            s: Math.round(this.state.combined * 1000) / 1000,
            f: this.state.feed,
            amps: Math.round(this.state.amps * 10) / 10,
            chatter: this.state.chatter ? 1 : 0
        });
        
        // Limit to 30 minutes of data at 20Hz = 36000 samples
        if (this._recordedData.length > 36000) {
            this.stopRecording();
        }
    }
    
    // Helper to download a file
    downloadFile(filename, content) {
        const blob = new Blob([content], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }
    
    // Log alerts for export
    logAlert(alert) {
        if (!this._alertLog) this._alertLog = [];
        this._alertLog.push({
            time: new Date().toISOString(),
            ...alert
        });
        // Keep last 100 alerts
        if (this._alertLog.length > 100) this._alertLog.shift();
    }
    
    // ========================================================================
    // FLUIDCNC INTEGRATION
    // ========================================================================
    
    // Update position from FluidCNC status (call this from FluidCNC's status handler)
    updatePosition(x, y, z) {
        this.state.posX = x;
        this.state.posY = y;
        this.state.posZ = z;
        this.send(`pos:${x},${y},${z}`);
    }
    
    // Update RPM from FluidCNC spindle status
    updateRPM(rpm) {
        this.state.rpm = rpm;
        this.send(`rpm:${rpm}`);
    }
    
    // Send current position if FluidCNC provides machine position
    syncPosition() {
        // Try to get position from FluidCNC's state
        if (window.fluidNC && window.fluidNC.machineState) {
            const pos = window.fluidNC.machineState.position;
            if (pos) {
                this.updatePosition(pos.x || 0, pos.y || 0, pos.z || 0);
            }
        }
    }
    
    // Get chatter map data
    getChatterMap() {
        this.send('map');
        return this._chatterMap || { positions: [] };
    }
    
    // Get ML features for training
    getMLFeatures() {
        this.send('features');
        return this._mlFeatures || { features: [] };
    }
    
    // Clear chatter map
    clearChatterMap() {
        this.send('clearMap');
        this._chatterMap = null;
    }
    
    // Get advanced analysis data
    getAnalysis() {
        this.send('analysis');
        return this._analysisData || {};
    }
    
    // Check if chatter is predicted soon
    isChatterPredicted() {
        return this.state.ticksToChatter > 0 && this.state.ticksToChatter < 10;
    }
    
    // Get detection confidence (0-1)
    getConfidence() {
        return this.state.confidence || 0;
    }
    
    // Get pattern type
    getPattern() {
        if (this.state.risingChatter) return 'rising';
        if (this.state.stableChatter) return 'stable';
        if (this.state.intermittent) return 'intermittent';
        return 'normal';
    }
    
    // Get harmonics status
    hasHarmonics() {
        return this.state.harmonics || false;
    }
    
    // Get frequency band energies
    getFrequencyBands() {
        return {
            low: this.state.lowBand || 0,
            mid: this.state.midBand || 0,
            high: this.state.highBand || 0
        };
    }
    
    // ========================================================================
    // TOOL WEAR TRACKING
    // ========================================================================
    
    // Update tool wear estimation (call from updateHistory)
    updateToolWear() {
        const now = Date.now();
        const deltaSeconds = (now - this._lastCuttingCheck) / 1000;
        this._lastCuttingCheck = now;
        
        // Only track when actually cutting
        if (this.state.cutting && this.state.amps > this.state.idleCurrent) {
            // Accumulate load
            const load = this.state.amps - this.state.idleCurrent;
            this.state.cumulativeLoad += load * deltaSeconds;
            this.state.cuttingSeconds += deltaSeconds;
            
            // Track for average
            this._cuttingLoadSum += load;
            this._cuttingLoadCount++;
            this.state.avgLoadCurrent = this._cuttingLoadSum / this._cuttingLoadCount;
            
            // Estimate wear based on cumulative load
            // Rough estimate: 1000 amp-seconds = 1% wear for typical endmill
            // Adjust multiplier based on material hardness
            const materialMultiplier = {
                'aluminum': 0.5,
                'plastic': 0.3,
                'wood': 0.2,
                'brass': 0.7,
                'copper': 0.6,
                'steel': 1.5,
                'composite': 0.8
            }[this.state.material] || 1.0;
            
            this.state.toolWear = Math.min(100, (this.state.cumulativeLoad / 1000) * materialMultiplier);
        }
    }
    
    // Reset tool wear (new tool installed)
    resetToolWear() {
        this.state.toolWear = 0;
        this.state.cumulativeLoad = 0;
        this.state.cuttingSeconds = 0;
        this.state.avgLoadCurrent = 0;
        this._cuttingLoadSum = 0;
        this._cuttingLoadCount = 0;
        this._toolWearStart = Date.now();
        this.showNotification('Tool wear reset - new tool', 'success');
    }
    
    // Get tool wear status
    getToolWearStatus() {
        const wear = this.state.toolWear;
        if (wear < 20) return { status: 'good', icon: '🟢', text: 'Good' };
        if (wear < 50) return { status: 'ok', icon: '🟡', text: 'OK' };
        if (wear < 80) return { status: 'worn', icon: '🟠', text: 'Worn' };
        return { status: 'replace', icon: '🔴', text: 'Replace' };
    }
    
    // ========================================================================
    // AUTO-TUNING WIZARD
    // ========================================================================
    
    // Start auto-tuning wizard
    startAutoTuning() {
        this._tuningPhase = 0;
        this._tuningData = {
            idleSamples: [],
            cuttingSamples: [],
            chatterSamples: [],
            startTime: Date.now()
        };
        
        const modal = document.createElement('div');
        modal.id = 'chatter-tuning-modal';
        modal.innerHTML = `
            <style>
                #chatter-tuning-modal {
                    position: fixed;
                    inset: 0;
                    background: rgba(0,0,0,0.9);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    z-index: 100001;
                    font-family: 'Segoe UI', system-ui, sans-serif;
                }
                .tuning-dialog {
                    background: linear-gradient(145deg, #1a1a2e, #16213e);
                    border-radius: 16px;
                    width: 400px;
                    max-width: 95vw;
                    color: white;
                    box-shadow: 0 20px 60px rgba(0,0,0,0.5);
                    padding: 24px;
                }
                .tuning-header { font-size: 20px; font-weight: 600; margin-bottom: 16px; }
                .tuning-step { 
                    padding: 16px;
                    background: rgba(255,255,255,0.05);
                    border-radius: 8px;
                    margin-bottom: 16px;
                }
                .tuning-step.active { border: 2px solid #4488ff; }
                .tuning-step.done { border: 2px solid #44ff44; opacity: 0.7; }
                .tuning-progress {
                    height: 8px;
                    background: rgba(255,255,255,0.1);
                    border-radius: 4px;
                    margin: 16px 0;
                    overflow: hidden;
                }
                .tuning-progress-bar {
                    height: 100%;
                    background: #4488ff;
                    transition: width 0.3s;
                }
                .tuning-btn {
                    width: 100%;
                    padding: 12px;
                    border: none;
                    border-radius: 8px;
                    font-size: 14px;
                    font-weight: 600;
                    cursor: pointer;
                    background: #4488ff;
                    color: white;
                }
                .tuning-btn:hover { background: #3377ee; }
                .tuning-btn:disabled { opacity: 0.5; cursor: not-allowed; }
            </style>
            <div class="tuning-dialog">
                <div class="tuning-header">🎛️ Auto-Tuning Wizard</div>
                
                <div class="tuning-step" id="tuning-step-1">
                    <strong>Step 1: Idle Baseline</strong>
                    <p style="font-size:12px;opacity:0.8;margin:8px 0;">
                        Turn spindle ON but don't cut. We'll measure background noise.
                    </p>
                    <div id="tuning-samples-1" style="font-size:11px;opacity:0.6;">0 samples</div>
                </div>
                
                <div class="tuning-step" id="tuning-step-2">
                    <strong>Step 2: Normal Cutting</strong>
                    <p style="font-size:12px;opacity:0.8;margin:8px 0;">
                        Make a normal cut with good settings. We'll learn what "good" looks like.
                    </p>
                    <div id="tuning-samples-2" style="font-size:11px;opacity:0.6;">0 samples</div>
                </div>
                
                <div class="tuning-step" id="tuning-step-3">
                    <strong>Step 3: Intentional Chatter (Optional)</strong>
                    <p style="font-size:12px;opacity:0.8;margin:8px 0;">
                        If safe, create chatter (high feed/deep cut). Skip if not comfortable.
                    </p>
                    <div id="tuning-samples-3" style="font-size:11px;opacity:0.6;">0 samples</div>
                </div>
                
                <div class="tuning-progress">
                    <div class="tuning-progress-bar" id="tuning-progress" style="width:0%"></div>
                </div>
                
                <div style="display:flex;gap:8px;">
                    <button class="tuning-btn" id="tuning-action" onclick="window.chatterDetection.tuningAction()">
                        Start Phase 1
                    </button>
                    <button class="tuning-btn" style="background:#666;" onclick="window.chatterDetection.cancelTuning()">
                        Cancel
                    </button>
                </div>
                
                <div id="tuning-result" style="margin-top:16px;padding:12px;background:rgba(0,255,0,0.1);border-radius:8px;display:none;">
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
    }
    
    // Handle tuning action button
    tuningAction() {
        const btn = document.getElementById('tuning-action');
        const progress = document.getElementById('tuning-progress');
        
        if (this._tuningPhase === 0) {
            // Start phase 1 - idle
            this._tuningPhase = 1;
            btn.textContent = 'Collecting... (5s)';
            btn.disabled = true;
            document.getElementById('tuning-step-1').classList.add('active');
            progress.style.width = '10%';
            
            this._tuningInterval = setInterval(() => this.collectTuningSample(), 50);
            
            setTimeout(() => this.advanceTuningPhase(), 5000);
        }
        else if (this._tuningPhase === 2) {
            // Start phase 2 - cutting
            btn.textContent = 'Collecting... (10s)';
            btn.disabled = true;
            document.getElementById('tuning-step-2').classList.add('active');
            progress.style.width = '40%';
            
            setTimeout(() => this.advanceTuningPhase(), 10000);
        }
        else if (this._tuningPhase === 3) {
            // Start phase 3 - chatter (optional)
            btn.textContent = 'Collecting... (5s)';
            btn.disabled = true;
            document.getElementById('tuning-step-3').classList.add('active');
            progress.style.width = '70%';
            
            setTimeout(() => this.finishTuning(), 5000);
        }
        else if (this._tuningPhase === 4) {
            // Skip phase 3
            this.finishTuning();
        }
    }
    
    // Collect a tuning sample
    collectTuningSample() {
        const sample = {
            combined: this.state.combined,
            audio: this.state.audio,
            accel: this.state.accel,
            current: this.state.current,
            amps: this.state.amps
        };
        
        if (this._tuningPhase === 1) {
            this._tuningData.idleSamples.push(sample);
            document.getElementById('tuning-samples-1').textContent = `${this._tuningData.idleSamples.length} samples`;
        } else if (this._tuningPhase === 2) {
            this._tuningData.cuttingSamples.push(sample);
            document.getElementById('tuning-samples-2').textContent = `${this._tuningData.cuttingSamples.length} samples`;
        } else if (this._tuningPhase === 3) {
            this._tuningData.chatterSamples.push(sample);
            document.getElementById('tuning-samples-3').textContent = `${this._tuningData.chatterSamples.length} samples`;
        }
    }
    
    // Advance to next tuning phase
    advanceTuningPhase() {
        const btn = document.getElementById('tuning-action');
        
        if (this._tuningPhase === 1) {
            document.getElementById('tuning-step-1').classList.remove('active');
            document.getElementById('tuning-step-1').classList.add('done');
            this._tuningPhase = 2;
            btn.textContent = 'Start Cutting Test';
            btn.disabled = false;
            document.getElementById('tuning-progress').style.width = '33%';
        }
        else if (this._tuningPhase === 2) {
            document.getElementById('tuning-step-2').classList.remove('active');
            document.getElementById('tuning-step-2').classList.add('done');
            this._tuningPhase = 3;
            btn.textContent = 'Start Chatter Test (or Skip)';
            btn.disabled = false;
            document.getElementById('tuning-progress').style.width = '66%';
            
            // Add skip button
            const skipBtn = document.createElement('button');
            skipBtn.className = 'tuning-btn';
            skipBtn.style.background = '#666';
            skipBtn.style.marginTop = '8px';
            skipBtn.textContent = 'Skip (Use Defaults)';
            skipBtn.onclick = () => { this._tuningPhase = 4; this.tuningAction(); };
            btn.parentNode.appendChild(skipBtn);
        }
    }
    
    // Finish tuning and calculate optimal settings
    finishTuning() {
        clearInterval(this._tuningInterval);
        
        const idle = this._tuningData.idleSamples;
        const cutting = this._tuningData.cuttingSamples;
        const chatter = this._tuningData.chatterSamples;
        
        // Calculate averages
        const avgIdle = idle.length > 0 ? idle.reduce((s, x) => s + x.combined, 0) / idle.length : 0;
        const avgCutting = cutting.length > 0 ? cutting.reduce((s, x) => s + x.combined, 0) / cutting.length : 0.2;
        const avgChatter = chatter.length > 0 ? chatter.reduce((s, x) => s + x.combined, 0) / chatter.length : 0.7;
        
        // Calculate max cutting score
        const maxCutting = cutting.length > 0 ? Math.max(...cutting.map(x => x.combined)) : 0.4;
        
        // Set optimal noise floor (idle + margin)
        const optimalNoise = avgIdle * 1.3;
        
        // Set optimal threshold (between max normal cutting and chatter)
        let optimalThreshold;
        if (chatter.length > 0) {
            optimalThreshold = (maxCutting + avgChatter) / 2;
        } else {
            optimalThreshold = maxCutting * 1.5;  // 50% above max normal
        }
        optimalThreshold = Math.max(0.3, Math.min(0.9, optimalThreshold));
        
        // Calculate idle current
        const avgIdleAmps = idle.length > 0 ? idle.reduce((s, x) => s + x.amps, 0) / idle.length : 0.5;
        
        // Show results
        const result = document.getElementById('tuning-result');
        result.style.display = 'block';
        result.innerHTML = `
            <strong>✅ Tuning Complete!</strong>
            <div style="font-size:12px;margin-top:8px;">
                <div>Noise Floor: ${optimalNoise.toFixed(3)} (was ${this.state.noiseFloor.toFixed(3)})</div>
                <div>Threshold: ${optimalThreshold.toFixed(3)} (was ${this.state.threshold.toFixed(3)})</div>
                <div>Idle Current: ${avgIdleAmps.toFixed(2)}A</div>
            </div>
            <button class="tuning-btn" style="margin-top:12px;" onclick="window.chatterDetection.applyTuning(${optimalNoise}, ${optimalThreshold}, ${avgIdleAmps})">
                Apply Settings
            </button>
        `;
        
        document.getElementById('tuning-progress').style.width = '100%';
        document.getElementById('tuning-action').style.display = 'none';
    }
    
    // Cancel tuning and cleanup
    cancelTuning() {
        if (this._tuningInterval) {
            clearInterval(this._tuningInterval);
            this._tuningInterval = null;
        }
        this._tuningPhase = 0;
        this._tuningData = null;
        const modal = document.getElementById('chatter-tuning-modal');
        if (modal) modal.remove();
    }
    
    // Apply tuning results
    applyTuning(noiseFloor, threshold, idleCurrent) {
        // Cleanup interval first
        if (this._tuningInterval) {
            clearInterval(this._tuningInterval);
            this._tuningInterval = null;
        }
        
        // Send to ESP32
        this.send(JSON.stringify({
            threshold: threshold,
            noiseFloor: noiseFloor
        }));
        
        // Update local state
        this.state.noiseFloor = noiseFloor;
        this.state.threshold = threshold;
        this.state.idleCurrent = idleCurrent;
        
        // Save
        this.send('save');
        
        // Close modal
        document.getElementById('chatter-tuning-modal').remove();
        this.showNotification('Tuning applied and saved!', 'success');
    }
    
    // ========================================================================
    // BROKEN ENDMILL DETECTION CONFIGURATION
    // ========================================================================
    
    /**
     * Configure broken endmill detection sensitivity
     * @param {Object} options - Configuration options
     * @param {boolean} options.enabled - Enable/disable detection
     * @param {number} options.silenceThresholdMs - Time in ms of no-load before alert (default: 400)
     * @param {number} options.audioDropThreshold - Audio drop % to trigger (0.0-1.0, default: 0.6)
     * @param {number} options.ampsDropThreshold - Current drop % to trigger (0.0-1.0, default: 0.5)
     * @param {number} options.safeZ - Z height above which tool is considered retracted (default: 2.0)
     * @param {number} options.minCuttingAudio - Minimum audio level to consider "cutting" (default: 0.12)
     */
    configureBrokenEndmillDetection(options = {}) {
        const bed = this.state.brokenEndmillDetection;
        
        if (options.enabled !== undefined) {
            bed.enabled = !!options.enabled;
        }
        if (Number.isFinite(options.silenceThresholdMs)) {
            bed.silenceThresholdMs = Math.max(100, Math.min(2000, options.silenceThresholdMs));
        }
        if (Number.isFinite(options.audioDropThreshold)) {
            bed.audioDropThreshold = Math.max(0.3, Math.min(0.95, options.audioDropThreshold));
        }
        if (Number.isFinite(options.ampsDropThreshold)) {
            bed.ampsDropThreshold = Math.max(0.3, Math.min(0.95, options.ampsDropThreshold));
        }
        if (Number.isFinite(options.safeZ)) {
            bed.safeZ = options.safeZ;
        }
        if (Number.isFinite(options.minCuttingAudio)) {
            bed.minCuttingAudio = Math.max(0.05, Math.min(0.5, options.minCuttingAudio));
        }
        
        console.log('[Chatter] Broken endmill detection configured:', {
            enabled: bed.enabled,
            silenceThresholdMs: bed.silenceThresholdMs,
            audioDropThreshold: (bed.audioDropThreshold * 100).toFixed(0) + '%',
            ampsDropThreshold: (bed.ampsDropThreshold * 100).toFixed(0) + '%',
            safeZ: bed.safeZ,
            minCuttingAudio: bed.minCuttingAudio
        });
    }
    
    /**
     * Get current broken endmill detection status
     */
    getBrokenEndmillStatus() {
        const bed = this.state.brokenEndmillDetection;
        const machineState = this._getMachineState();
        return {
            enabled: bed.enabled,
            wasConfirmedCutting: bed.wasConfirmedCutting,
            lastCuttingAudio: bed.lastCuttingAudio,
            lastCuttingAmps: bed.lastCuttingAmps,
            silenceDuration: bed.silenceDuration,
            noLoadDuration: bed.noLoadDuration,
            currentZ: machineState.z,
            isAtCuttingDepth: machineState.z < bed.safeZ,
            confidence: this.state.toolBrokenConfidence,
            triggered: this.state.toolBroken
        };
    }
    
    /**
     * Reset broken endmill detection state (after tool change)
     */
    resetBrokenEndmillDetection() {
        const bed = this.state.brokenEndmillDetection;
        bed.wasConfirmedCutting = false;
        bed.lastCuttingAudio = 0;
        bed.lastCuttingAmps = 0;
        bed.silenceStartedAt = 0;
        bed.silenceDuration = 0;
        bed.noLoadStartedAt = 0;
        bed.noLoadDuration = 0;
        bed.plungeStartedAt = 0;
        bed.plungeNoLoadWarned = false;
        bed.lastZ = undefined;
        bed.cuttingConfirmedAt = 0;
        this.state.toolBroken = false;
        this.state.toolBrokenConfidence = 0;
        console.log('[Chatter] Broken endmill detection reset');
    }
    
    /**
     * Get chatter analysis summary for debugging
     */
    getChatterAnalysisSummary() {
        const ca = this.state.chatterAnalysis;
        return {
            confidence: ca.chatterConfidence,
            patterns: {
                resonant: ca.isResonant,
                intermittent: ca.isIntermittent,
                progressive: ca.isProgressive
            },
            scores: {
                audio: ca.audioScore,
                accel: ca.accelScore,
                harmonic: ca.harmonicScore,
                trend: ca.trendScore
            },
            harmonics: {
                fundamental: ca.fundamentalFreq,
                toothPass: ca.toothPassFreq,
                strength: ca.harmonicStrength
            },
            historyLength: ca.audioHistory.length
        };
    }
}

// Export for module use
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ChatterDetection;
}
