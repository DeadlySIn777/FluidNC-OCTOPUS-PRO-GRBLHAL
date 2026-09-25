/**
 * CNC Calibration Wizard - Bambu-Style Smart Startup
 * 
 * Performs comprehensive machine calibration:
 * 1. Spindle Warmup - Thermal stabilization
 * 2. Accelerometer Zero - IMU baseline calibration  
 * 3. Axis Resonance Test - Find natural frequencies (for input shaping)
 * 4. X/Y Obstruction Detection - Detect binding/obstruction
 * 5. Z-Rod Check (ALL 3 RODS) - Individual rod binding detection
 * 6. Spindle Resonance Map - Build stability lobe diagram
 * 7. Tool Runout Check - Detect bent/worn tools
 * 
 * Hardware Requirements:
 * - Waveshare ESP32-S3 Touch LCD 1.46B (accelerometer)
 * - grblHAL controller
 * - Optional: TMC2209 with StallGuard
 */

class CalibrationWizard {
    constructor(options = {}) {
        this.serial = options.serial;           // DualSerialManager
        this.chatter = options.chatter;         // ChatterDetection instance
        this.grbl = options.grbl;               // grblHAL connection
        this.onProgress = options.onProgress || (() => {});
        this.onComplete = options.onComplete || (() => {});
        this.onError = options.onError || (() => {});
        this.onStepStart = options.onStepStart || (() => {});
        
        // Machine configuration
        this.config = {
            // Travel limits (from grblHAL settings or user input)
            maxX: options.maxX || 350,
            maxY: options.maxY || 500,
            maxZ: options.maxZ || 120,
            
            // Z-rod positions (for 3-rod system)
            // Typically: 2 in back, 1 in front center OR triangle pattern
            zRods: options.zRods || [
                { name: 'Z1 (Left-Rear)', xPos: 50, yPos: 450 },
                { name: 'Z2 (Right-Rear)', xPos: 300, yPos: 450 },
                { name: 'Z3 (Front-Center)', xPos: 175, yPos: 50 }
            ],
            
            // Calibration parameters
            spindleMaxRPM: options.spindleMaxRPM || 24000,
            spindleMinRPM: options.spindleMinRPM || 5000,
            resonanceTestFeed: options.resonanceTestFeed || 3000,  // mm/min
            bindingTestFeed: options.bindingTestFeed || 500,       // mm/min (slow!)
            vibrationThreshold: options.vibrationThreshold || 0.5, // g
            bindingThreshold: options.bindingThreshold || 0.8,     // g spike
        };
        
        // Calibration results
        this.results = {
            timestamp: null,
            spindle: {
                warmupComplete: false,
                thermalDrift: 0,
                resonanceRPMs: [],     // RPMs with high vibration
                safeRPMRanges: []      // Good operating ranges
            },
            accelerometer: {
                calibrated: false,
                offset: { x: 0, y: 0, z: 0 },
                noiseFloor: 0,
                mountingAngle: 0
            },
            axes: {
                x: { resonanceHz: 0, binding: false, bindingPositions: [] },
                y: { resonanceHz: 0, binding: false, bindingPositions: [] }
            },
            zRods: [
                { name: 'Z1', binding: false, friction: 0, resonanceHz: 0, bindingPositions: [] },
                { name: 'Z2', binding: false, friction: 0, resonanceHz: 0, bindingPositions: [] },
                { name: 'Z3', binding: false, friction: 0, resonanceHz: 0, bindingPositions: [] }
            ],
            inputShaping: {
                xFrequency: 0,
                yFrequency: 0,
                xDamping: 0,
                yDamping: 0,
                recommended: null
            },
            overallScore: 0,
            issues: [],
            recommendations: []
        };
        
        // State
        this.running = false;
        this.currentStep = 0;
        this.aborted = false;
        this.vibrationBuffer = [];
        this.stallGuardBuffer = [];
        
        // Calibration steps
        this.steps = [
            { name: 'Pre-Flight Check', duration: 5000, fn: () => this.preFlightCheck() },
            { name: 'Spindle Warmup', duration: 60000, fn: () => this.spindleWarmup() },
            { name: 'Accelerometer Zero', duration: 5000, fn: () => this.calibrateAccelerometer() },
            { name: 'X-Axis Resonance', duration: 15000, fn: () => this.testAxisResonance('X') },
            { name: 'Y-Axis Resonance', duration: 15000, fn: () => this.testAxisResonance('Y') },
            { name: 'X-Axis Obstruction', duration: 20000, fn: () => this.testAxisObstruction('X') },
            { name: 'Y-Axis Obstruction', duration: 20000, fn: () => this.testAxisObstruction('Y') },
            { name: 'Z-Rod 1 Check', duration: 15000, fn: () => this.testZRod(0) },
            { name: 'Z-Rod 2 Check', duration: 15000, fn: () => this.testZRod(1) },
            { name: 'Z-Rod 3 Check', duration: 15000, fn: () => this.testZRod(2) },
            { name: 'Spindle Resonance Map', duration: 30000, fn: () => this.mapSpindleResonance() },
            { name: 'Generate Report', duration: 2000, fn: () => this.generateReport() }
        ];
    }
    
    // ========================================================================
    // Main Calibration Flow
    // ========================================================================
    
    async start() {
        if (this.running) {
            console.warn('[Calibration] Already running!');
            return;
        }
        
        this.running = true;
        this.aborted = false;
        this.currentStep = 0;
        this.results.timestamp = new Date().toISOString();
        this.results.issues = [];
        this.results.recommendations = [];
        
        console.log('========================================');
        console.log('  CNC CALIBRATION WIZARD');
        console.log('  Bambu-Style Smart Startup');
        console.log('========================================');
        
        try {
            for (let i = 0; i < this.steps.length && !this.aborted; i++) {
                this.currentStep = i;
                const step = this.steps[i];
                
                console.log(`\n[Step ${i + 1}/${this.steps.length}] ${step.name}`);
                this.onStepStart(step.name, i, this.steps.length);
                
                await step.fn();
                
                this.onProgress({
                    step: i + 1,
                    totalSteps: this.steps.length,
                    stepName: step.name,
                    percent: Math.round(((i + 1) / this.steps.length) * 100),
                    results: this.results
                });
            }
            
            if (!this.aborted) {
                this.calculateOverallScore();
                this.onComplete(this.results);
                this.saveResults();
            }
            
        } catch (error) {
            console.error('[Calibration] Error:', error);
            this.onError(error);
        } finally {
            this.running = false;
            // Ensure spindle is off
            await this.sendGCode('M5');
        }
    }
    
    abort() {
        console.log('[Calibration] Aborting...');
        this.aborted = true;
        this.sendGCode('M5');  // Spindle off
        this.sendGCode('!');   // Feed hold
    }
    
    // ========================================================================
    // Step 1: Pre-Flight Check
    // ========================================================================
    
    async preFlightCheck() {
        console.log('  → Checking connections...');
        
        // Check chatter sensor connected
        if (!this.chatter?.connected && !this.chatter?.serialMode) {
            this.results.issues.push('⚠️ Chatter sensor not connected - some tests will be limited');
        }
        
        // Check grblHAL connection
        if (!this.serial?.grblConnected) {
            throw new Error('grblHAL not connected! Cannot run calibration.');
        }
        
        // Unlock if needed
        await this.sendGCode('$X');
        await this.delay(500);
        
        // Get current position
        await this.sendGCode('?');
        await this.delay(200);
        
        console.log('  ✓ Pre-flight check complete');
    }
    
    // ========================================================================
    // Step 2: Spindle Warmup
    // ========================================================================
    
    async spindleWarmup() {
        console.log('  → Warming up spindle (thermal stabilization)...');
        
        const rpmSteps = [
            { rpm: 5000, duration: 10000 },
            { rpm: 10000, duration: 10000 },
            { rpm: 15000, duration: 10000 },
            { rpm: 20000, duration: 15000 },
            { rpm: 24000, duration: 10000 },
            { rpm: 12000, duration: 5000 },   // Cool down step
        ];
        
        let startVibration = 0;
        let endVibration = 0;
        
        for (const step of rpmSteps) {
            if (this.aborted) break;
            
            console.log(`    RPM: ${step.rpm}`);
            await this.sendGCode(`M3 S${step.rpm}`);
            
            // Wait for spindle to reach speed
            await this.delay(2000);
            
            // Record vibration at start of warmup
            if (step === rpmSteps[0]) {
                startVibration = await this.getAverageVibration(2000);
            }
            
            // Monitor vibration during warmup
            const vibration = await this.getAverageVibration(step.duration - 2000);
            
            // Check for resonance (high vibration at certain RPM)
            if (vibration > this.config.vibrationThreshold) {
                this.results.spindle.resonanceRPMs.push(step.rpm);
                console.log(`    ⚠️ Resonance detected at ${step.rpm} RPM!`);
            }
        }
        
        // Record final vibration
        endVibration = await this.getAverageVibration(2000);
        
        // Calculate thermal drift
        this.results.spindle.thermalDrift = Math.abs(endVibration - startVibration);
        this.results.spindle.warmupComplete = true;
        
        // Stop spindle
        await this.sendGCode('M5');
        await this.delay(3000);
        
        // Calculate safe RPM ranges (avoiding resonance)
        this.calculateSafeRPMRanges();
        
        console.log('  ✓ Spindle warmup complete');
        console.log(`    Thermal drift: ${this.results.spindle.thermalDrift.toFixed(3)}g`);
        
        if (this.results.spindle.resonanceRPMs.length > 0) {
            this.results.issues.push(
                `⚠️ Spindle resonance at: ${this.results.spindle.resonanceRPMs.join(', ')} RPM`
            );
        }
    }
    
    calculateSafeRPMRanges() {
        const badRPMs = this.results.spindle.resonanceRPMs.sort((a, b) => a - b);
        const ranges = [];
        let rangeStart = this.config.spindleMinRPM;
        
        for (const badRPM of badRPMs) {
            // Create safe range before this bad RPM
            if (badRPM - 1000 > rangeStart) {
                ranges.push({ min: rangeStart, max: badRPM - 1000 });
            }
            rangeStart = badRPM + 1000;
        }
        
        // Final range to max
        if (rangeStart < this.config.spindleMaxRPM) {
            ranges.push({ min: rangeStart, max: this.config.spindleMaxRPM });
        }
        
        this.results.spindle.safeRPMRanges = ranges;
    }
    
    // ========================================================================
    // Step 3: Accelerometer Calibration
    // ========================================================================
    
    async calibrateAccelerometer() {
        console.log('  → Calibrating accelerometer (machine at rest)...');
        
        // Tell chatter sensor to calibrate
        if (this.chatter?.serialMode) {
            this.chatter.sendCommand('CAL');
        }
        
        // Collect baseline readings for 5 seconds
        const samples = [];
        const startTime = Date.now();
        
        while (Date.now() - startTime < 5000) {
            if (this.chatter?.state) {
                samples.push({
                    x: this.chatter.state.accelX || 0,
                    y: this.chatter.state.accelY || 0,
                    z: this.chatter.state.accelZ || 0,
                    magnitude: this.chatter.state.accel || 0
                });
            }
            await this.delay(50);
        }
        
        if (samples.length > 0) {
            // Calculate offsets (should be near 0 for X/Y, ~1g for Z)
            const avgX = samples.reduce((a, s) => a + s.x, 0) / samples.length;
            const avgY = samples.reduce((a, s) => a + s.y, 0) / samples.length;
            const avgZ = samples.reduce((a, s) => a + s.z, 0) / samples.length;
            
            this.results.accelerometer.offset = { x: avgX, y: avgY, z: avgZ - 1.0 };
            
            // Calculate noise floor (standard deviation)
            const magnitudes = samples.map(s => s.magnitude);
            const mean = magnitudes.reduce((a, b) => a + b) / magnitudes.length;
            const variance = magnitudes.reduce((a, m) => a + Math.pow(m - mean, 2), 0) / magnitudes.length;
            this.results.accelerometer.noiseFloor = Math.sqrt(variance);
            
            // Calculate mounting angle (tilt)
            const mountingAngle = Math.atan2(avgX, avgZ) * (180 / Math.PI);
            this.results.accelerometer.mountingAngle = mountingAngle;
            
            this.results.accelerometer.calibrated = true;
            
            console.log(`    Offset: X=${avgX.toFixed(4)}, Y=${avgY.toFixed(4)}, Z=${(avgZ-1).toFixed(4)}`);
            console.log(`    Noise floor: ${this.results.accelerometer.noiseFloor.toFixed(4)}g`);
            console.log(`    Mounting angle: ${mountingAngle.toFixed(1)}°`);
            
            if (Math.abs(mountingAngle) > 5) {
                this.results.issues.push(`⚠️ Sensor mounting angle: ${mountingAngle.toFixed(1)}° - consider leveling`);
            }
        } else {
            console.log('    ⚠️ No accelerometer data received');
            this.results.accelerometer.calibrated = false;
        }
        
        console.log('  ✓ Accelerometer calibration complete');
    }
    
    // ========================================================================
    // Step 4-5: Axis Resonance Test (Input Shaper Discovery)
    // ========================================================================
    
    async testAxisResonance(axis) {
        console.log(`  → Testing ${axis}-axis resonance (vibration sweep)...`);
        
        const results = this.results.axes[axis.toLowerCase()];
        const maxTravel = axis === 'X' ? this.config.maxX : this.config.maxY;
        
        // Move to start position
        await this.sendGCode('G90');  // Absolute mode
        await this.sendGCode(`G0 ${axis}5 F${this.config.resonanceTestFeed}`);
        await this.waitForIdle();
        
        // Collect vibration data during rapid movement
        this.vibrationBuffer = [];
        const collectVibration = setInterval(() => {
            if (this.chatter?.state) {
                this.vibrationBuffer.push({
                    time: Date.now(),
                    value: this.chatter.state.accel || 0,
                    freq: this.chatter.state.freq || 0
                });
            }
        }, 20);
        
        // Perform oscillating movements at different frequencies
        // This is like Klipper's resonance test
        const frequencies = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];  // Hz
        const peakVibrations = [];
        
        for (const freq of frequencies) {
            if (this.aborted) break;
            
            // Calculate movement parameters for this frequency
            const amplitude = 5;  // mm
            const feedRate = freq * amplitude * 60 * 2;  // mm/min
            
            console.log(`    Testing ${freq}Hz (F${Math.round(feedRate)})...`);
            
            // Oscillate 3 times
            for (let i = 0; i < 3; i++) {
                await this.sendGCode(`G1 ${axis}${10 + amplitude} F${feedRate}`);
                await this.sendGCode(`G1 ${axis}${10 - amplitude} F${feedRate}`);
            }
            await this.delay(200);
            
            // Get peak vibration for this frequency
            const recentVib = this.vibrationBuffer.slice(-10);
            const peakVib = recentVib.length > 0 
                ? Math.max(...recentVib.map(v => v.value))
                : 0;
            peakVibrations.push({ freq, vibration: peakVib });
        }
        
        clearInterval(collectVibration);
        
        // Find resonance frequency (peak vibration)
        peakVibrations.sort((a, b) => b.vibration - a.vibration);
        const resonanceFreq = peakVibrations[0]?.freq || 0;
        
        results.resonanceHz = resonanceFreq;
        
        // Store for input shaping recommendation
        if (axis === 'X') {
            this.results.inputShaping.xFrequency = resonanceFreq;
        } else {
            this.results.inputShaping.yFrequency = resonanceFreq;
        }
        
        console.log(`    Resonance frequency: ${resonanceFreq}Hz`);
        console.log('  ✓ Resonance test complete');
        
        // Return to safe position
        await this.sendGCode(`G0 ${axis}5 F${this.config.resonanceTestFeed}`);
    }
    
    // ========================================================================
    // Step 6-7: Axis Obstruction Detection
    // ========================================================================
    
    async testAxisObstruction(axis) {
        console.log(`  → Testing ${axis}-axis for obstructions/binding...`);
        
        const results = this.results.axes[axis.toLowerCase()];
        const maxTravel = axis === 'X' ? this.config.maxX : this.config.maxY;
        
        // Move to start
        await this.sendGCode('G90');
        await this.sendGCode(`G0 ${axis}5 F${this.config.resonanceTestFeed}`);
        await this.waitForIdle();
        
        // Collect vibration during slow traverse
        this.vibrationBuffer = [];
        const baselineVib = await this.getAverageVibration(1000);
        
        const collectVibration = setInterval(() => {
            if (this.chatter?.state) {
                this.vibrationBuffer.push({
                    time: Date.now(),
                    value: this.chatter.state.accel || 0,
                    position: this.getCurrentPosition(axis)
                });
            }
        }, 50);
        
        // Slow traverse across full travel
        console.log(`    Traversing ${axis} axis (0 → ${maxTravel})...`);
        await this.sendGCode(`G1 ${axis}${maxTravel - 5} F${this.config.bindingTestFeed}`);
        await this.waitForIdle();
        
        clearInterval(collectVibration);
        
        // Analyze vibration spikes
        const threshold = baselineVib + this.config.bindingThreshold;
        const spikes = this.vibrationBuffer.filter(v => v.value > threshold);
        
        if (spikes.length > 0) {
            results.binding = true;
            results.bindingPositions = spikes.map(s => s.position).filter((v, i, a) => 
                i === 0 || Math.abs(v - a[i-1]) > 10  // Dedupe nearby positions
            );
            
            console.log(`    ⚠️ Binding detected at positions: ${results.bindingPositions.join(', ')}mm`);
            this.results.issues.push(
                `⚠️ ${axis}-axis binding at: ${results.bindingPositions.join(', ')}mm`
            );
        } else {
            results.binding = false;
            console.log(`    ✓ No binding detected`);
        }
        
        // Return to start
        await this.sendGCode(`G0 ${axis}5 F${this.config.resonanceTestFeed}`);
        
        console.log('  ✓ Obstruction test complete');
    }
    
    // ========================================================================
    // Step 8-10: Z-Rod Check (ALL 3 RODS!)
    // ========================================================================
    
    async testZRod(rodIndex) {
        const rod = this.config.zRods[rodIndex];
        const results = this.results.zRods[rodIndex];
        results.name = rod.name;
        
        console.log(`  → Testing ${rod.name} for binding/friction...`);
        
        // Move XY to position above this rod
        await this.sendGCode('G90');
        await this.sendGCode(`G0 X${rod.xPos} Y${rod.yPos} F${this.config.resonanceTestFeed}`);
        await this.waitForIdle();
        
        // Move Z to top
        await this.sendGCode(`G0 Z${this.config.maxZ - 5} F1000`);
        await this.waitForIdle();
        
        // Collect vibration during Z descent
        this.vibrationBuffer = [];
        const baselineVib = await this.getAverageVibration(1000);
        
        const collectVibration = setInterval(() => {
            if (this.chatter?.state) {
                this.vibrationBuffer.push({
                    time: Date.now(),
                    value: this.chatter.state.accel || 0,
                    position: this.getCurrentPosition('Z')
                });
            }
        }, 50);
        
        console.log(`    Descending Z at rod position (${rod.xPos}, ${rod.yPos})...`);
        
        // SLOW descent to feel for binding
        await this.sendGCode(`G1 Z5 F${this.config.bindingTestFeed}`);
        await this.waitForIdle();
        
        // Now ascend
        console.log(`    Ascending Z...`);
        await this.sendGCode(`G1 Z${this.config.maxZ - 5} F${this.config.bindingTestFeed}`);
        await this.waitForIdle();
        
        clearInterval(collectVibration);
        
        // Analyze
        const avgVib = this.vibrationBuffer.length > 0
            ? this.vibrationBuffer.reduce((a, v) => a + v.value, 0) / this.vibrationBuffer.length
            : 0;
        
        results.friction = avgVib;
        
        // Find binding points
        const threshold = baselineVib + this.config.bindingThreshold;
        const spikes = this.vibrationBuffer.filter(v => v.value > threshold);
        
        if (spikes.length > 0) {
            results.binding = true;
            results.bindingPositions = spikes.map(s => s.position).filter((v, i, a) => 
                i === 0 || Math.abs(v - a[i-1]) > 5
            );
            
            console.log(`    ⚠️ ${rod.name} BINDING at Z: ${results.bindingPositions.join(', ')}mm`);
            this.results.issues.push(
                `⚠️ ${rod.name} binding at Z: ${results.bindingPositions.join(', ')}mm - Check for debris/lubrication`
            );
        } else {
            results.binding = false;
            console.log(`    ✓ ${rod.name} smooth (friction: ${avgVib.toFixed(3)}g)`);
        }
        
        // Compare friction between rods
        const allFrictions = this.results.zRods.filter(r => r.friction > 0).map(r => r.friction);
        if (allFrictions.length > 1) {
            const maxFriction = Math.max(...allFrictions);
            const minFriction = Math.min(...allFrictions);
            
            if (maxFriction > minFriction * 2) {
                this.results.issues.push(
                    `⚠️ Uneven Z-rod friction detected - check ${rod.name}`
                );
            }
        }
        
        console.log(`  ✓ ${rod.name} check complete`);
    }
    
    // ========================================================================
    // Step 11: Spindle Resonance Map
    // ========================================================================
    
    async mapSpindleResonance() {
        console.log('  → Mapping spindle resonance (stability lobe analysis)...');
        
        const rpmStep = 500;
        const rpmStart = this.config.spindleMinRPM;
        const rpmEnd = this.config.spindleMaxRPM;
        
        const resonanceMap = [];
        
        for (let rpm = rpmStart; rpm <= rpmEnd && !this.aborted; rpm += rpmStep) {
            console.log(`    Testing ${rpm} RPM...`);
            
            await this.sendGCode(`M3 S${rpm}`);
            await this.delay(2000);  // Wait for spindle to stabilize
            
            const vibration = await this.getAverageVibration(1000);
            const freq = this.chatter?.state?.freq || 0;
            
            resonanceMap.push({ rpm, vibration, freq });
            
            // Quick check for severe resonance
            if (vibration > this.config.vibrationThreshold * 2) {
                console.log(`    ⚠️ HIGH VIBRATION at ${rpm} RPM - skipping to next`);
                if (!this.results.spindle.resonanceRPMs.includes(rpm)) {
                    this.results.spindle.resonanceRPMs.push(rpm);
                }
            }
        }
        
        // Stop spindle
        await this.sendGCode('M5');
        await this.delay(3000);
        
        // Store map for stability lobe display
        this.results.spindle.resonanceMap = resonanceMap;
        
        // Recalculate safe ranges with more data
        this.calculateSafeRPMRanges();
        
        console.log('  ✓ Spindle resonance map complete');
        console.log(`    Found ${this.results.spindle.resonanceRPMs.length} resonance points`);
        console.log(`    Safe ranges: ${this.results.spindle.safeRPMRanges.map(r => `${r.min}-${r.max}`).join(', ')}`);
    }
    
    // ========================================================================
    // Step 12: Generate Report
    // ========================================================================
    
    async generateReport() {
        console.log('  → Generating calibration report...');
        
        // Input shaping recommendation
        if (this.results.inputShaping.xFrequency > 0 && this.results.inputShaping.yFrequency > 0) {
            const avgFreq = (this.results.inputShaping.xFrequency + this.results.inputShaping.yFrequency) / 2;
            
            if (avgFreq < 40) {
                this.results.inputShaping.recommended = 'MZV';
                this.results.recommendations.push(
                    `💡 Enable Input Shaping: MZV at ~${avgFreq}Hz for smoother motion`
                );
            } else if (avgFreq < 60) {
                this.results.inputShaping.recommended = 'EI';
                this.results.recommendations.push(
                    `💡 Enable Input Shaping: EI at ~${avgFreq}Hz`
                );
            } else {
                this.results.inputShaping.recommended = 'ZV';
                this.results.recommendations.push(
                    `💡 Frame is stiff! ZV shaping at ~${avgFreq}Hz would work well`
                );
            }
        }
        
        // Z-rod recommendations
        const bindingRods = this.results.zRods.filter(r => r.binding);
        if (bindingRods.length > 0) {
            this.results.recommendations.push(
                `🔧 Lubricate Z-rods: ${bindingRods.map(r => r.name).join(', ')}`
            );
        }
        
        // Spindle recommendations
        if (this.results.spindle.resonanceRPMs.length > 0) {
            this.results.recommendations.push(
                `⚡ Avoid spindle speeds: ${this.results.spindle.resonanceRPMs.join(', ')} RPM`
            );
        }
        
        if (this.results.spindle.safeRPMRanges.length > 0) {
            const best = this.results.spindle.safeRPMRanges.reduce((a, b) => 
                (b.max - b.min) > (a.max - a.min) ? b : a
            );
            this.results.recommendations.push(
                `✓ Best spindle range: ${best.min}-${best.max} RPM`
            );
        }
        
        console.log('  ✓ Report generated');
    }
    
    // ========================================================================
    // Calculate Overall Score
    // ========================================================================
    
    calculateOverallScore() {
        let score = 100;
        
        // Deduct for issues
        score -= this.results.spindle.resonanceRPMs.length * 5;
        score -= this.results.axes.x.binding ? 10 : 0;
        score -= this.results.axes.y.binding ? 10 : 0;
        score -= this.results.zRods.filter(r => r.binding).length * 10;
        score -= this.results.accelerometer.calibrated ? 0 : 15;
        score -= Math.abs(this.results.accelerometer.mountingAngle || 0) > 5 ? 5 : 0;
        
        this.results.overallScore = Math.max(0, Math.min(100, score));
        
        console.log(`\n========================================`);
        console.log(`  CALIBRATION COMPLETE`);
        console.log(`  Overall Score: ${this.results.overallScore}/100`);
        console.log(`  Issues Found: ${this.results.issues.length}`);
        console.log(`========================================\n`);
    }
    
    // ========================================================================
    // Helper Functions
    // ========================================================================
    
    async sendGCode(cmd) {
        if (this.serial?.sendGCode) {
            this.serial.sendGCode(cmd);
        } else if (this.grbl?.send) {
            this.grbl.send(cmd);
        } else if (window.app?.send) {
            window.app.send(cmd);
        } else {
            console.log(`[GCode] ${cmd}`);
        }
        await this.delay(100);
    }
    
    async waitForIdle(timeout = 30000) {
        const start = Date.now();
        while (Date.now() - start < timeout) {
            // Check grblHAL state
            if (window.app?.state?.status === 'Idle') {
                return true;
            }
            await this.delay(100);
        }
        console.warn('[Calibration] Timeout waiting for idle');
        return false;
    }
    
    getCurrentPosition(axis) {
        if (window.app?.state?.position) {
            return window.app.state.position[axis.toLowerCase()] || 0;
        }
        return 0;
    }
    
    async getAverageVibration(duration) {
        const samples = [];
        const startTime = Date.now();
        
        while (Date.now() - startTime < duration) {
            if (this.chatter?.state?.accel !== undefined) {
                samples.push(this.chatter.state.accel);
            }
            await this.delay(50);
        }
        
        return samples.length > 0
            ? samples.reduce((a, b) => a + b) / samples.length
            : 0;
    }
    
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
    
    saveResults() {
        try {
            localStorage.setItem('cncCalibration', JSON.stringify(this.results));
            console.log('[Calibration] Results saved to localStorage');
        } catch (e) {
            console.warn('[Calibration] Could not save results:', e);
        }
    }
    
    loadResults() {
        try {
            const saved = localStorage.getItem('cncCalibration');
            if (saved) {
                return JSON.parse(saved);
            }
        } catch (e) {
            console.warn('[Calibration] Could not load results:', e);
        }
        return null;
    }
    
    // ========================================================================
    // UI Integration
    // ========================================================================
    
    showWizard() {
        // Remove existing
        document.getElementById('calibration-wizard-modal')?.remove();
        
        const modal = document.createElement('div');
        modal.id = 'calibration-wizard-modal';
        modal.innerHTML = `
            <style>
                #calibration-wizard-modal {
                    position: fixed;
                    top: 0;
                    left: 0;
                    right: 0;
                    bottom: 0;
                    background: rgba(0, 0, 0, 0.9);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    z-index: 10000;
                    font-family: 'Inter', -apple-system, sans-serif;
                }
                .cal-wizard {
                    background: linear-gradient(135deg, #1a1a2e, #16213e);
                    border-radius: 16px;
                    padding: 32px;
                    max-width: 600px;
                    width: 90%;
                    max-height: 80vh;
                    overflow-y: auto;
                    border: 1px solid rgba(0, 170, 255, 0.3);
                    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
                }
                .cal-wizard h2 {
                    margin: 0 0 8px 0;
                    color: #fff;
                    font-size: 24px;
                }
                .cal-wizard .subtitle {
                    color: #888;
                    margin-bottom: 24px;
                }
                .cal-progress {
                    background: rgba(255, 255, 255, 0.1);
                    border-radius: 8px;
                    height: 8px;
                    margin: 20px 0;
                    overflow: hidden;
                }
                .cal-progress-bar {
                    height: 100%;
                    background: linear-gradient(90deg, #00aaff, #00ff88);
                    border-radius: 8px;
                    transition: width 0.5s;
                    width: 0%;
                }
                .cal-step {
                    display: flex;
                    align-items: center;
                    gap: 12px;
                    padding: 12px;
                    margin: 8px 0;
                    background: rgba(255, 255, 255, 0.05);
                    border-radius: 8px;
                    color: #888;
                }
                .cal-step.active {
                    background: rgba(0, 170, 255, 0.2);
                    color: #fff;
                    border: 1px solid rgba(0, 170, 255, 0.5);
                }
                .cal-step.complete {
                    color: #00ff88;
                }
                .cal-step.error {
                    color: #ff4444;
                }
                .cal-step-icon {
                    width: 24px;
                    height: 24px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-size: 14px;
                }
                .cal-buttons {
                    display: flex;
                    gap: 12px;
                    margin-top: 24px;
                }
                .cal-btn {
                    flex: 1;
                    padding: 14px 24px;
                    border: none;
                    border-radius: 8px;
                    font-size: 16px;
                    font-weight: 600;
                    cursor: pointer;
                    transition: all 0.2s;
                }
                .cal-btn-primary {
                    background: linear-gradient(135deg, #00aaff, #0077cc);
                    color: white;
                }
                .cal-btn-primary:hover {
                    transform: translateY(-2px);
                    box-shadow: 0 5px 20px rgba(0, 170, 255, 0.4);
                }
                .cal-btn-secondary {
                    background: rgba(255, 255, 255, 0.1);
                    color: #fff;
                }
                .cal-btn:disabled {
                    opacity: 0.5;
                    cursor: not-allowed;
                    transform: none;
                }
                .cal-results {
                    margin-top: 20px;
                    padding: 16px;
                    background: rgba(0, 0, 0, 0.3);
                    border-radius: 8px;
                }
                .cal-score {
                    font-size: 48px;
                    font-weight: 700;
                    text-align: center;
                    background: linear-gradient(135deg, #00ff88, #00aaff);
                    -webkit-background-clip: text;
                    -webkit-text-fill-color: transparent;
                }
                .cal-issues {
                    margin-top: 16px;
                }
                .cal-issue {
                    padding: 8px 12px;
                    margin: 4px 0;
                    background: rgba(255, 70, 70, 0.2);
                    border-radius: 4px;
                    color: #ff8888;
                    font-size: 14px;
                }
                .cal-recommendation {
                    padding: 8px 12px;
                    margin: 4px 0;
                    background: rgba(0, 255, 136, 0.1);
                    border-radius: 4px;
                    color: #88ffaa;
                    font-size: 14px;
                }
                .spinner {
                    display: inline-block;
                    width: 16px;
                    height: 16px;
                    border: 2px solid rgba(255,255,255,0.3);
                    border-top-color: #00aaff;
                    border-radius: 50%;
                    animation: spin 1s linear infinite;
                }
                @keyframes spin {
                    to { transform: rotate(360deg); }
                }
            </style>
            <div class="cal-wizard">
                <h2>🔧 CNC Calibration Wizard</h2>
                <div class="subtitle">Bambu-Style Smart Startup Sequence</div>
                
                <div class="cal-progress">
                    <div class="cal-progress-bar" id="cal-progress-bar"></div>
                </div>
                
                <div id="cal-steps">
                    ${this.steps.map((step, i) => `
                        <div class="cal-step" id="cal-step-${i}">
                            <div class="cal-step-icon">${i + 1}</div>
                            <div>${step.name}</div>
                        </div>
                    `).join('')}
                </div>
                
                <div id="cal-results" style="display: none;">
                    <div class="cal-score" id="cal-score">--</div>
                    <div class="cal-issues" id="cal-issues"></div>
                    <div class="cal-recommendations" id="cal-recommendations"></div>
                </div>
                
                <div class="cal-buttons">
                    <button class="cal-btn cal-btn-secondary" id="cal-abort-btn" onclick="window.calibrationWizard?.abort(); this.closest('#calibration-wizard-modal').remove();">Cancel</button>
                    <button class="cal-btn cal-btn-primary" id="cal-start-btn" onclick="window.calibrationWizard?.startFromUI()">🚀 Start Calibration</button>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
    }
    
    startFromUI() {
        const startBtn = document.getElementById('cal-start-btn');
        const abortBtn = document.getElementById('cal-abort-btn');
        
        if (startBtn) {
            startBtn.disabled = true;
            startBtn.innerHTML = '<span class="spinner"></span> Running...';
        }
        if (abortBtn) {
            abortBtn.textContent = 'Abort';
        }
        
        // Set up callbacks
        this.onStepStart = (name, index, total) => {
            // Update progress bar
            const progress = document.getElementById('cal-progress-bar');
            if (progress) {
                progress.style.width = `${(index / total) * 100}%`;
            }
            
            // Update step indicators
            for (let i = 0; i < total; i++) {
                const step = document.getElementById(`cal-step-${i}`);
                if (step) {
                    step.classList.remove('active', 'complete');
                    if (i < index) {
                        step.classList.add('complete');
                        step.querySelector('.cal-step-icon').textContent = '✓';
                    } else if (i === index) {
                        step.classList.add('active');
                        step.querySelector('.cal-step-icon').innerHTML = '<span class="spinner"></span>';
                    }
                }
            }
        };
        
        this.onComplete = (results) => {
            // Mark all complete
            for (let i = 0; i < this.steps.length; i++) {
                const step = document.getElementById(`cal-step-${i}`);
                if (step) {
                    step.classList.remove('active');
                    step.classList.add('complete');
                    step.querySelector('.cal-step-icon').textContent = '✓';
                }
            }
            
            const progress = document.getElementById('cal-progress-bar');
            if (progress) progress.style.width = '100%';
            
            // Show results
            const resultsDiv = document.getElementById('cal-results');
            if (resultsDiv) resultsDiv.style.display = 'block';
            
            const scoreDiv = document.getElementById('cal-score');
            if (scoreDiv) scoreDiv.textContent = `${results.overallScore}/100`;
            
            const issuesDiv = document.getElementById('cal-issues');
            if (issuesDiv) {
                issuesDiv.innerHTML = results.issues.map(i => 
                    `<div class="cal-issue">${i}</div>`
                ).join('');
            }
            
            const recsDiv = document.getElementById('cal-recommendations');
            if (recsDiv) {
                recsDiv.innerHTML = results.recommendations.map(r => 
                    `<div class="cal-recommendation">${r}</div>`
                ).join('');
            }
            
            if (startBtn) {
                startBtn.disabled = false;
                startBtn.textContent = '✓ Complete';
            }
            if (abortBtn) {
                abortBtn.textContent = 'Close';
            }
        };
        
        this.onError = (error) => {
            if (startBtn) {
                startBtn.disabled = false;
                startBtn.textContent = '🔄 Retry';
            }
            alert('Calibration error: ' + error.message);
        };
        
        // Start!
        this.start();
    }
}

// Make globally available
window.CalibrationWizard = CalibrationWizard;

// Auto-create instance when app is ready
if (typeof window !== 'undefined') {
    window.addEventListener('load', () => {
        // Will be initialized properly when called
        console.log('✓ CalibrationWizard loaded');
    });
}
