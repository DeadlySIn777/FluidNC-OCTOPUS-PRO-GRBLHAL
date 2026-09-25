/*
 * Sensorless Homing & Crash Recovery v1.0
 * 
 * TMC2209 StallGuard-based features:
 * - Sensorless homing (no limit switches needed)
 * - Real-time crash detection
 * - Automatic crash recovery
 * - Position loss detection and re-homing
 * - Soft limit enforcement with stall backup
 */

class SensorlessSystem {
    constructor(smartMachine) {
        this.machine = smartMachine;
        
        this.config = {
            // Homing configuration
            homing: {
                order: ['z', 'x', 'y'],  // Z first for safety (raise spindle)
                seekSpeed: { x: 2000, y: 2000, z: 500 },  // Fast approach
                feedSpeed: { x: 200, y: 200, z: 50 },     // Slow for accuracy
                pulloff: { x: 5, y: 5, z: 3 },            // Back off distance
                direction: { x: -1, y: -1, z: 1 },        // Home direction (-1=neg, 1=pos)
                retries: 3
            },
            
            // Crash detection
            crash: {
                enabled: true,
                sgDropThreshold: 0.25,    // SG drops to 25% of no-load = crash
                velocityThreshold: 10,     // mm/s minimum to consider crash
                debounceMs: 50,           // Ignore brief SG dips
                recoveryMode: 'auto'      // 'auto', 'manual', 'rehome'
            },
            
            // Position verification
            positionCheck: {
                enabled: true,
                intervalMs: 5000,         // Check every 5 seconds
                toleranceMm: 0.1,         // Position drift tolerance
                maxDrift: 1.0             // Max allowed drift before re-home
            }
        };
        
        this.state = {
            isHoming: false,
            homingAxis: null,
            isHomed: { x: false, y: false, z: false },
            lastKnownPos: { x: 0, y: 0, z: 0 },
            crashRecoveryInProgress: false,
            positionCheckInterval: null
        };
        
        // Event handlers
        this.onHomingProgress = () => {};
        this.onHomingComplete = () => {};
        this.onCrashDetected = () => {};
        this.onPositionLost = () => {};
    }
    
    // ========================================================================
    // SENSORLESS HOMING
    // ========================================================================
    
    async homeAll() {
        if (this.state.isHoming) {
            throw new Error('Homing already in progress');
        }
        
        this.state.isHoming = true;
        
        try {
            for (const axis of this.config.homing.order) {
                await this.homeAxis(axis);
            }
            
            this.onHomingComplete({ success: true, axes: this.state.isHomed });
            this.startPositionMonitoring();
            
        } catch (err) {
            this.onHomingComplete({ success: false, error: err.message });
            throw err;
        } finally {
            this.state.isHoming = false;
        }
    }
    
    async homeAxis(axis) {
        this.state.homingAxis = axis;
        this.state.isHomed[axis] = false;
        
        const hConfig = this.config.homing;
        const sgConfig = this.machine.profile.stallGuard[axis];
        
        this.onHomingProgress({
            axis,
            phase: 'starting',
            message: `Homing ${axis.toUpperCase()} axis...`
        });
        
        let attempt = 0;
        let success = false;
        
        while (attempt < hConfig.retries && !success) {
            attempt++;
            
            try {
                // Phase 1: Fast seek to find limit
                this.onHomingProgress({
                    axis,
                    phase: 'seeking',
                    attempt,
                    message: `Seeking ${axis.toUpperCase()} limit (attempt ${attempt})...`
                });
                
                const seekResult = await this.seekLimit(axis, hConfig.direction[axis], hConfig.seekSpeed[axis]);
                
                if (!seekResult.found) {
                    throw new Error(`${axis.toUpperCase()} limit not found`);
                }
                
                // Phase 2: Back off
                this.onHomingProgress({
                    axis,
                    phase: 'pulloff',
                    message: `Backing off ${axis.toUpperCase()}...`
                });
                
                await this.pullOff(axis, hConfig.direction[axis], hConfig.pulloff[axis]);
                
                // Phase 3: Slow approach for accuracy
                this.onHomingProgress({
                    axis,
                    phase: 'locating',
                    message: `Locating ${axis.toUpperCase()} precisely...`
                });
                
                const feedResult = await this.seekLimit(axis, hConfig.direction[axis], hConfig.feedSpeed[axis]);
                
                if (!feedResult.found) {
                    throw new Error(`${axis.toUpperCase()} limit lost on slow approach`);
                }
                
                // Phase 4: Set home position
                await this.setHome(axis);
                
                // Phase 5: Move to pull-off position
                await this.pullOff(axis, hConfig.direction[axis], hConfig.pulloff[axis]);
                
                success = true;
                this.state.isHomed[axis] = true;
                this.state.lastKnownPos[axis] = 0;
                
                this.onHomingProgress({
                    axis,
                    phase: 'complete',
                    message: `${axis.toUpperCase()} homed successfully`
                });
                
            } catch (err) {
                console.warn(`Homing ${axis} attempt ${attempt} failed:`, err.message);
                
                // Clear alarm and try again
                await this.machine.sendGCode('$X');
                await this.machine.delay(500);
            }
        }
        
        if (!success) {
            throw new Error(`Failed to home ${axis.toUpperCase()} after ${hConfig.retries} attempts`);
        }
    }
    
    async seekLimit(axis, direction, speed) {
        return new Promise((resolve, reject) => {
            const maxTravel = 1000;  // Maximum search distance
            const target = direction * maxTravel;
            const sgConfig = this.machine.profile.stallGuard[axis];
            
            let resolved = false;
            let stallConfirmCount = 0;
            const stallConfirmRequired = 3;  // Require 3 consecutive stall readings
            
            // Monitor for stall
            const monitorInterval = setInterval(() => {
                const sgHistory = this.machine.state.sgHistory[axis];
                if (sgHistory.length < 3) return;
                
                const recentSG = sgHistory.slice(-3);
                const avgSG = recentSG.reduce((a, b) => a + b, 0) / 3;
                
                // Check if stalled (SG below threshold)
                if (avgSG < sgConfig.threshold) {
                    stallConfirmCount++;
                    
                    if (stallConfirmCount >= stallConfirmRequired) {
                        clearInterval(monitorInterval);
                        
                        if (!resolved) {
                            resolved = true;
                            
                            // Stop motion
                            this.machine.sendGCode('!');  // Feed hold
                            
                            setTimeout(async () => {
                                await this.machine.sendGCode('\x18');  // Soft reset
                                await this.machine.delay(500);
                                await this.machine.sendGCode('$X');  // Clear alarm
                                
                                resolve({ found: true, sgValue: avgSG });
                            }, 100);
                        }
                    }
                } else {
                    stallConfirmCount = 0;  // Reset counter
                }
            }, 20);  // Check every 20ms
            
            // Start movement
            this.machine.sendGCode(`G1 ${axis.toUpperCase()}${target} F${speed}`);
            
            // Timeout
            const timeout = ((maxTravel / speed) * 60 + 30) * 1000;  // Add 30 second buffer
            setTimeout(() => {
                clearInterval(monitorInterval);
                if (!resolved) {
                    resolved = true;
                    this.machine.sendGCode('!');
                    reject(new Error(`Timeout seeking ${axis} limit`));
                }
            }, timeout);
        });
    }
    
    async pullOff(axis, direction, distance) {
        // Move opposite to home direction
        const target = -direction * distance;
        const cmd = `G91 G0 ${axis.toUpperCase()}${target}`;
        
        await this.machine.sendGCode(cmd);
        await this.machine.sendGCode('G90');  // Back to absolute
        await this.machine.waitForIdle(5000);
    }
    
    async setHome(axis) {
        // Set current position as home (0)
        await this.machine.sendGCode(`G92 ${axis.toUpperCase()}0`);
    }
    
    // ========================================================================
    // CRASH DETECTION
    // ========================================================================
    
    /**
     * Feed StallGuard data from status reports for real-time crash detection
     * @param {Object} sgData - {x: sgValue, y: sgValue, z: sgValue}
     */
    feedSGData(sgData) {
        if (!this.config.crash.enabled) return;
        if (this.state.isHoming) return;
        if (this.state.crashRecoveryInProgress) return;
        
        // Check each axis for crash
        for (const axis of ['x', 'y', 'z']) {
            if (sgData[axis] === undefined) continue;
            
            const crash = this.detectAxisCrash(axis);
            if (crash) {
                this.handleCrash({ axis, ...crash });
                break;  // Handle one crash at a time
            }
        }
    }
    
    enableCrashDetection() {
        this.config.crash.enabled = true;
        console.log('Crash detection enabled');
    }
    
    disableCrashDetection() {
        this.config.crash.enabled = false;
        console.log('Crash detection disabled');
    }
    
    checkForCrash() {
        if (!this.config.crash.enabled) return null;
        if (this.state.isHoming) return null;  // Don't detect crash during homing
        if (this.state.crashRecoveryInProgress) return null;
        
        for (const axis of ['x', 'y', 'z']) {
            const crash = this.detectAxisCrash(axis);
            if (crash) {
                return { axis, ...crash };
            }
        }
        
        return null;
    }
    
    detectAxisCrash(axis) {
        const sgHistory = this.machine.state.sgHistory[axis];
        if (sgHistory.length < 10) return null;
        
        const sgConfig = this.machine.profile.stallGuard[axis];
        const crashConfig = this.config.crash;
        
        // Get recent samples
        const recent = sgHistory.slice(-10);
        const avgRecent = recent.reduce((a, b) => a + b, 0) / recent.length;
        
        // Check if SG dropped below crash threshold
        const crashThreshold = sgConfig.noLoadSG * crashConfig.sgDropThreshold;
        
        if (avgRecent < crashThreshold) {
            // Verify we're actually moving (not just holding position)
            // Check if we've seen a sudden drop from higher values
            const older = sgHistory.slice(-30, -10);
            if (older.length < 10) return null;
            
            const avgOlder = older.reduce((a, b) => a + b, 0) / older.length;
            const dropRatio = avgRecent / avgOlder;
            
            if (dropRatio < 0.5) {  // 50% drop = crash
                return {
                    detected: true,
                    sgValue: avgRecent,
                    expectedSG: sgConfig.noLoadSG,
                    dropRatio,
                    severity: dropRatio < 0.25 ? 'severe' : 'moderate'
                };
            }
        }
        
        return null;
    }
    
    async handleCrash(crashInfo) {
        if (this.state.crashRecoveryInProgress) return;
        
        this.state.crashRecoveryInProgress = true;
        
        console.error(`CRASH DETECTED on ${crashInfo.axis.toUpperCase()}!`, crashInfo);
        
        // Immediate stop
        await this.machine.sendGCode('!');  // Feed hold
        await this.machine.delay(100);
        await this.machine.sendGCode('\x18');  // Reset
        
        this.onCrashDetected(crashInfo);
        
        // Recovery based on mode
        if (this.config.crash.recoveryMode === 'auto') {
            await this.attemptAutoRecovery(crashInfo);
        } else if (this.config.crash.recoveryMode === 'rehome') {
            await this.homeAll();
        }
        // 'manual' mode: wait for user intervention
        
        this.state.crashRecoveryInProgress = false;
    }
    
    async attemptAutoRecovery(crashInfo) {
        console.log('Attempting automatic crash recovery...');
        
        // Clear alarm
        await this.machine.delay(500);
        await this.machine.sendGCode('$X');
        
        // Gently back off in the opposite direction
        const axis = crashInfo.axis;
        const backoffDir = this.config.homing.direction[axis] > 0 ? -1 : 1;
        const backoffDist = 5;  // 5mm
        
        try {
            await this.machine.sendGCode(`G91`);  // Relative
            await this.machine.sendGCode(`G0 ${axis.toUpperCase()}${backoffDir * backoffDist} F500`);
            await this.machine.sendGCode(`G90`);  // Absolute
            await this.machine.waitForIdle(5000);
            
            // Raise Z for safety
            if (axis !== 'z') {
                const zSafe = Math.min(this.machine.profile.envelope.z.max, 20);
                await this.machine.sendGCode(`G0 Z${zSafe} F500`);
                await this.machine.waitForIdle(5000);
            }
            
            console.log('Auto-recovery complete. Machine safe, but position may be lost.');
            console.log('Re-homing recommended before continuing.');
            
        } catch (err) {
            console.error('Auto-recovery failed:', err);
            console.log('Manual intervention required.');
        }
    }
    
    // ========================================================================
    // POSITION MONITORING
    // ========================================================================
    
    startPositionMonitoring() {
        if (this.state.positionCheckInterval) return;
        
        this.state.positionCheckInterval = setInterval(() => {
            this.checkPosition();
        }, this.config.positionCheck.intervalMs);
    }
    
    stopPositionMonitoring() {
        if (this.state.positionCheckInterval) {
            clearInterval(this.state.positionCheckInterval);
            this.state.positionCheckInterval = null;
        }
    }
    
    async checkPosition() {
        if (!this.config.positionCheck.enabled) return;
        if (this.state.isHoming) return;
        
        // This uses StallGuard-based skip detection
        // If motor skipped steps, SG will show anomaly
        
        for (const axis of ['x', 'y', 'z']) {
            if (!this.state.isHomed[axis]) continue;
            
            const sgHistory = this.machine.state.sgHistory[axis];
            if (sgHistory.length < 50) continue;
            
            // Look for step loss signature:
            // 1. Sudden SG drop (motor fighting mechanical resistance)
            // 2. SG recovery (motor lost steps, now running free)
            // 3. Position drift accumulates
            
            const recent = sgHistory.slice(-50);
            
            // Calculate gradient (rate of change)
            let maxDrop = 0;
            for (let i = 10; i < recent.length; i++) {
                const before = recent.slice(i-10, i).reduce((a,b) => a+b, 0) / 10;
                const after = recent[i];
                const drop = before - after;
                maxDrop = Math.max(maxDrop, drop);
            }
            
            // If we see significant drops, position may be compromised
            const sgConfig = this.machine.profile.stallGuard[axis];
            const threshold = sgConfig.noLoadSG * 0.3;  // 30% drop indicates stress
            
            if (maxDrop > threshold) {
                console.warn(`${axis.toUpperCase()} position may be compromised (SG stress detected)`);
                
                // Mark as potentially unhomed
                // Don't immediately invalidate - might be normal cutting forces
                
                // Increment drift counter
                if (!this.state.driftCount) this.state.driftCount = {};
                this.state.driftCount[axis] = (this.state.driftCount[axis] || 0) + 1;
                
                if (this.state.driftCount[axis] > 5) {
                    this.onPositionLost({
                        axis,
                        reason: 'Sustained high load - possible step loss',
                        recommendation: 'Re-home recommended'
                    });
                    this.state.isHomed[axis] = false;
                }
            } else {
                // Reset drift counter on good readings
                if (this.state.driftCount) {
                    this.state.driftCount[axis] = 0;
                }
            }
        }
    }
    
    // ========================================================================
    // SOFT LIMITS WITH STALL BACKUP
    // ========================================================================
    
    async enforceSoftLimits() {
        const envelope = this.machine.profile.envelope;
        
        // Apply soft limits to grblHAL
        await this.machine.sendGCode(`$20=1`);  // Enable soft limits
        await this.machine.sendGCode(`$130=${envelope.x.max}`);
        await this.machine.sendGCode(`$131=${envelope.y.max}`);
        await this.machine.sendGCode(`$132=${envelope.z.max}`);
        
        console.log('Soft limits enabled with StallGuard backup');
    }
    
    // ========================================================================
    // STATUS
    // ========================================================================
    
    getStatus() {
        return {
            isHoming: this.state.isHoming,
            homingAxis: this.state.homingAxis,
            isHomed: { ...this.state.isHomed },
            allAxesHomed: Object.values(this.state.isHomed).every(h => h),
            crashDetectionEnabled: this.config.crash.enabled,
            positionMonitoringEnabled: !!this.state.positionCheckInterval
        };
    }
}


// Export
if (typeof module !== 'undefined' && module.exports) {
    module.exports = SensorlessSystem;
}
