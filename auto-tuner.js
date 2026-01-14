/*
 * Auto-Tuner v1.0
 * 
 * Automatically tunes:
 * - Motor currents (finds minimum needed for operation)
 * - StallGuard sensitivity (for reliable homing without false triggers)
 * - Steps/mm verification (using StallGuard feedback)
 * - Resonance detection and avoidance
 * - PID-like feed rate optimization during cuts
 */

class AutoTuner {
    constructor(smartMachine) {
        this.machine = smartMachine;
        this.results = {
            motors: {},
            resonance: {},
            stepsPerMm: {}
        };
    }
    
    // ========================================================================
    // MOTOR CURRENT AUTO-TUNING
    // ========================================================================
    
    async tuneMotorCurrents() {
        console.log('Starting motor current auto-tuning...');
        
        for (const axis of ['x', 'y', 'z']) {
            const result = await this.tuneAxisCurrent(axis);
            this.results.motors[axis] = result;
            
            console.log(`${axis.toUpperCase()}: optimal=${result.optimal}mA, ` +
                       `min=${result.minimum}mA, stall=${result.stallCurrent}mA`);
        }
        
        // Apply optimal currents
        await this.applyCurrents();
        
        return this.results.motors;
    }
    
    async tuneAxisCurrent(axis) {
        const envelope = this.machine.profile.envelope[axis];
        const maxCurrent = this.machine.profile.motors[axis].current;
        
        // Start with max current
        let testCurrent = maxCurrent;
        let minWorkingCurrent = maxCurrent;
        let stallCurrent = 0;
        
        const testDistance = Math.min(30, (envelope.max - envelope.min) / 4);
        const startPos = envelope.min + testDistance;
        
        await this.machine.moveTo(axis, startPos, 1000);
        
        // Binary search for minimum working current
        let high = maxCurrent;
        let low = 200;  // Minimum practical current
        
        while (high - low > 50) {
            testCurrent = Math.round((high + low) / 2);
            
            // Apply test current
            await this.setAxisCurrent(axis, testCurrent);
            await this.machine.delay(200);  // Let driver stabilize
            
            // Test with aggressive moves
            const passed = await this.testCurrentCapability(axis, testDistance, testCurrent);
            
            if (passed) {
                minWorkingCurrent = testCurrent;
                high = testCurrent;
            } else {
                stallCurrent = Math.max(stallCurrent, testCurrent);
                low = testCurrent;
            }
        }
        
        // Calculate optimal (30% headroom above minimum)
        const optimal = Math.min(maxCurrent, Math.round(minWorkingCurrent * 1.3));
        
        return {
            minimum: minWorkingCurrent,
            optimal: optimal,
            stallCurrent: stallCurrent,
            maxTested: maxCurrent
        };
    }
    
    async testCurrentCapability(axis, distance, current) {
        // Clear SG history
        this.machine.state.sgHistory[axis] = [];
        
        const speed = this.machine.profile.mechanics[axis].maxSpeed;
        const accel = this.machine.profile.mechanics[axis].acceleration;
        const startPos = await this.machine.getPosition(axis);
        
        try {
            // Aggressive acceleration test
            for (let i = 0; i < 3; i++) {
                await this.machine.moveTo(axis, startPos + distance, speed);
                await this.machine.moveTo(axis, startPos, speed);
            }
            
            // Check SG data for stall indicators
            const samples = this.machine.state.sgHistory[axis];
            const threshold = this.machine.profile.stallGuard[axis].threshold;
            
            // If we see any samples below threshold, current is too low
            const stallEvents = samples.filter(sg => sg < threshold).length;
            
            return stallEvents === 0;
        } catch (e) {
            // Exception = stall or error
            return false;
        }
    }
    
    async setAxisCurrent(axis, current) {
        const axisNum = { x: 0, y: 1, z: 2 }[axis];
        await this.machine.sendGCode(`$${140 + axisNum}=${current}`);
    }
    
    async applyCurrents() {
        for (const axis of ['x', 'y', 'z']) {
            if (this.results.motors[axis]) {
                const optimal = this.results.motors[axis].optimal;
                await this.setAxisCurrent(axis, optimal);
                this.machine.profile.motors[axis].current = optimal;
            }
        }
        this.machine.saveProfile();
    }
    
    // ========================================================================
    // RESONANCE DETECTION & AVOIDANCE
    // ========================================================================
    
    async detectResonance() {
        console.log('Detecting mechanical resonance...');
        
        for (const axis of ['x', 'y', 'z']) {
            const resonance = await this.findAxisResonance(axis);
            this.results.resonance[axis] = resonance;
            
            if (resonance.found) {
                console.log(`${axis.toUpperCase()}: resonance at ${resonance.frequency}Hz ` +
                           `(speed ~${resonance.speed} mm/min)`);
            } else {
                console.log(`${axis.toUpperCase()}: no significant resonance detected`);
            }
        }
        
        return this.results.resonance;
    }
    
    async findAxisResonance(axis) {
        const envelope = this.machine.profile.envelope[axis];
        const testDist = Math.min(50, (envelope.max - envelope.min) / 3);
        const startPos = (envelope.min + envelope.max) / 2 - testDist / 2;
        
        await this.machine.moveTo(axis, startPos, 1000);
        
        const stepsPerMm = this.machine.profile.mechanics[axis].stepsPerMm;
        const microsteps = this.machine.profile.motors[axis].microsteps;
        
        // Calculate step frequency at different speeds
        // f = (speed_mm_per_sec * steps_per_mm * microsteps)
        
        const resonanceData = [];
        
        // Test speeds from 500 to max
        const maxSpeed = this.machine.profile.mechanics[axis].maxSpeed;
        
        for (let speed = 500; speed <= maxSpeed; speed += 250) {
            // Calculate step frequency
            const mmPerSec = speed / 60;
            const stepFreq = mmPerSec * stepsPerMm * microsteps;
            
            // Clear SG history
            this.machine.state.sgHistory[axis] = [];
            
            // Move at this speed
            await this.machine.moveTo(axis, startPos + testDist, speed);
            await this.machine.moveTo(axis, startPos, speed);
            
            // Analyze SG variance (high variance = resonance/vibration)
            const samples = this.machine.state.sgHistory[axis];
            if (samples.length < 10) continue;
            
            // Calculate variance
            const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
            const variance = samples.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / samples.length;
            const stdDev = Math.sqrt(variance);
            
            // Coefficient of variation (normalized variance)
            const cv = (stdDev / mean) * 100;
            
            resonanceData.push({
                speed,
                frequency: stepFreq,
                meanSG: mean,
                stdDev,
                cv
            });
        }
        
        // Find peak variance (resonance point)
        if (resonanceData.length === 0) {
            return { found: false };
        }
        
        const maxCV = Math.max(...resonanceData.map(d => d.cv));
        const resonancePoint = resonanceData.find(d => d.cv === maxCV);
        
        // Only report if CV is significantly above average
        const avgCV = resonanceData.reduce((sum, d) => sum + d.cv, 0) / resonanceData.length;
        
        if (maxCV > avgCV * 2) {
            return {
                found: true,
                speed: resonancePoint.speed,
                frequency: Math.round(resonancePoint.frequency),
                cv: resonancePoint.cv,
                allData: resonanceData
            };
        }
        
        return { found: false, allData: resonanceData };
    }
    
    // ========================================================================
    // STEPS/MM VERIFICATION
    // ========================================================================
    
    async verifyStepsPerMm() {
        console.log('Verifying steps/mm calibration...');
        
        for (const axis of ['x', 'y', 'z']) {
            const result = await this.verifyAxisSteps(axis);
            this.results.stepsPerMm[axis] = result;
        }
        
        return this.results.stepsPerMm;
    }
    
    async verifyAxisSteps(axis) {
        // This requires hitting limits to verify actual travel
        // Uses StallGuard-detected limits as reference
        
        const envelope = this.machine.profile.envelope[axis];
        if (!envelope.measured) {
            return { verified: false, reason: 'Envelope not measured' };
        }
        
        // Home the axis first
        await this.machine.homeAxis(axis);
        
        // Move to far limit and check position
        const expectedTravel = envelope.max;
        
        // Enable slow move with stall detection
        const measuredTravel = await this.machine.findLimit(axis, 1);
        
        const error = Math.abs(measuredTravel - expectedTravel);
        const errorPercent = (error / expectedTravel) * 100;
        
        if (errorPercent > 1) {
            // Calculate corrected steps/mm
            const currentSteps = this.machine.profile.mechanics[axis].stepsPerMm;
            const correctedSteps = currentSteps * (expectedTravel / measuredTravel);
            
            return {
                verified: false,
                expected: expectedTravel,
                measured: measuredTravel,
                errorPercent,
                currentStepsPerMm: currentSteps,
                suggestedStepsPerMm: Math.round(correctedSteps * 100) / 100
            };
        }
        
        return {
            verified: true,
            expected: expectedTravel,
            measured: measuredTravel,
            errorPercent
        };
    }
    
    // ========================================================================
    // ADAPTIVE FEED CONTROLLER
    // ========================================================================
    
    createAdaptiveFeedController() {
        return new AdaptiveFeedController(this.machine);
    }
}


class AdaptiveFeedController {
    constructor(machine) {
        this.machine = machine;
        
        // Control parameters
        this.config = {
            targetLoad: 60,      // Target % of no-load SG
            minFeed: 20,         // Minimum feed rate (%)
            maxFeed: 150,        // Maximum feed rate (%)
            aggressiveness: 0.5, // How fast to change (0-1)
            updateInterval: 100, // ms between updates
            smoothing: 0.3       // Exponential smoothing factor
        };
        
        // State
        this.state = {
            enabled: false,
            currentFeedOverride: 100,
            smoothedLoad: 50,
            intervalId: null
        };
        
        // History for analysis
        this.history = {
            loads: [],
            feeds: [],
            timestamps: []
        };
    }
    
    start() {
        if (this.state.intervalId) return;
        
        this.state.enabled = true;
        this.state.intervalId = setInterval(() => this.update(), this.config.updateInterval);
        console.log('Adaptive feed control started');
    }
    
    stop() {
        if (this.state.intervalId) {
            clearInterval(this.state.intervalId);
            this.state.intervalId = null;
        }
        this.state.enabled = false;
        
        // Reset to 100%
        this.setFeedOverride(100);
        console.log('Adaptive feed control stopped');
    }
    
    update() {
        // Calculate current load from all axes
        let maxLoad = 0;
        
        for (const axis of ['x', 'y', 'z']) {
            const sg = this.machine.state.sgHistory[axis];
            if (sg.length < 3) continue;
            
            const currentSG = sg.slice(-3).reduce((a, b) => a + b, 0) / 3;
            const noLoadSG = this.machine.profile.stallGuard[axis].noLoadSG;
            
            // Load % = 100 - (currentSG / noLoadSG * 100)
            const load = Math.max(0, 100 - (currentSG / noLoadSG * 100));
            maxLoad = Math.max(maxLoad, load);
        }
        
        // Exponential smoothing
        this.state.smoothedLoad = this.config.smoothing * maxLoad + 
                                  (1 - this.config.smoothing) * this.state.smoothedLoad;
        
        // PID-like control
        const error = this.state.smoothedLoad - this.config.targetLoad;
        
        // Proportional adjustment
        let adjustment = -error * this.config.aggressiveness;
        
        // Calculate new feed override
        let newFeed = this.state.currentFeedOverride + adjustment;
        
        // Clamp to limits
        newFeed = Math.max(this.config.minFeed, Math.min(this.config.maxFeed, newFeed));
        
        // Only update if significant change
        if (Math.abs(newFeed - this.state.currentFeedOverride) > 2) {
            this.setFeedOverride(Math.round(newFeed));
        }
        
        // Record history
        this.history.loads.push(this.state.smoothedLoad);
        this.history.feeds.push(this.state.currentFeedOverride);
        this.history.timestamps.push(Date.now());
        
        // Trim history
        if (this.history.loads.length > 1000) {
            this.history.loads = this.history.loads.slice(-500);
            this.history.feeds = this.history.feeds.slice(-500);
            this.history.timestamps = this.history.timestamps.slice(-500);
        }
    }
    
    setFeedOverride(percent) {
        this.state.currentFeedOverride = percent;
        
        // Send to grblHAL via realtime command
        // grblHAL uses 0x90 + (percent - 100) for rapid override
        // For feed override: send via extended command or $F=xxx
        this.machine.sendGCode(`\x99`);  // Cancel any previous override
        
        // Set feed override (grblHAL extended command)
        // Actually need to use realtime command byte
        if (percent === 100) {
            this.machine.sendGCode('\x90');  // Reset to 100%
        } else if (percent > 100) {
            // Increase in 10% increments
            const increments = Math.round((percent - 100) / 10);
            for (let i = 0; i < increments; i++) {
                this.machine.sendGCode('\x91');  // +10%
            }
        } else {
            // Decrease in 10% increments
            const decrements = Math.round((100 - percent) / 10);
            for (let i = 0; i < decrements; i++) {
                this.machine.sendGCode('\x92');  // -10%
            }
        }
    }
    
    getStatus() {
        return {
            enabled: this.state.enabled,
            currentLoad: Math.round(this.state.smoothedLoad),
            targetLoad: this.config.targetLoad,
            feedOverride: this.state.currentFeedOverride
        };
    }
    
    // Get recommended feed rate for a new cut
    recommendFeedRate(materialHardness = 'medium', depthOfCut = 1) {
        // Use historical data to recommend initial feed rate
        
        const avgLoad = this.history.loads.length > 0 
            ? this.history.loads.reduce((a, b) => a + b, 0) / this.history.loads.length
            : 50;
        
        const avgFeed = this.history.feeds.length > 0
            ? this.history.feeds.reduce((a, b) => a + b, 0) / this.history.feeds.length
            : 100;
        
        // Adjust based on material
        const materialFactor = {
            'soft': 1.3,      // Plastic, wood
            'medium': 1.0,    // Aluminum
            'hard': 0.6,      // Steel
            'very-hard': 0.3  // Stainless, titanium
        }[materialHardness] || 1.0;
        
        // Adjust based on depth of cut
        const depthFactor = 1 / Math.sqrt(depthOfCut);
        
        // If we've been running at high feed and low load, recommend higher
        const loadRatio = this.config.targetLoad / Math.max(10, avgLoad);
        
        const recommended = Math.round(avgFeed * loadRatio * materialFactor * depthFactor);
        
        return Math.max(this.config.minFeed, Math.min(this.config.maxFeed, recommended));
    }
}


// Export
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { AutoTuner, AdaptiveFeedController };
}
