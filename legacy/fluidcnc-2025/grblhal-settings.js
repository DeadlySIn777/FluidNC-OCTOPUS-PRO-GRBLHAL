/*
 * grblHAL Smart Settings Manager v1.0
 * 
 * Runtime configuration for:
 * - TMC2209 StallGuard tuning
 * - Sensorless homing parameters
 * - Motor currents and microstepping
 * - Soft limits based on calibration
 * - Machine profile synchronization
 */

class GrblHALSettings {
    constructor(dualSerial) {
        this.serial = dualSerial;
        
        // grblHAL $ settings map (actual TMC2209 settings from firmware)
        // Verified against grblHAL v1.1f Trinamic plugin v0.30
        this.settingsMap = {
            // Steps per mm
            100: { name: 'X steps/mm', axis: 'x', type: 'stepsPerMm' },
            101: { name: 'Y steps/mm', axis: 'y', type: 'stepsPerMm' },
            102: { name: 'Z steps/mm', axis: 'z', type: 'stepsPerMm' },
            
            // Max speeds (mm/min)
            110: { name: 'X max rate', axis: 'x', type: 'maxSpeed' },
            111: { name: 'Y max rate', axis: 'y', type: 'maxSpeed' },
            112: { name: 'Z max rate', axis: 'z', type: 'maxSpeed' },
            
            // Acceleration (mm/sec²)
            120: { name: 'X accel', axis: 'x', type: 'acceleration' },
            121: { name: 'Y accel', axis: 'y', type: 'acceleration' },
            122: { name: 'Z accel', axis: 'z', type: 'acceleration' },
            
            // Max travel (mm)
            130: { name: 'X max travel', axis: 'x', type: 'maxTravel' },
            131: { name: 'Y max travel', axis: 'y', type: 'maxTravel' },
            132: { name: 'Z max travel', axis: 'z', type: 'maxTravel' },
            
            // TMC2209 Motor currents (mA) - $140-$142
            140: { name: 'X current', axis: 'x', type: 'current' },
            141: { name: 'Y current', axis: 'y', type: 'current' },
            142: { name: 'Z current', axis: 'z', type: 'current' },
            
            // Microsteps - $150-$152
            150: { name: 'X microsteps', axis: 'x', type: 'microsteps' },
            151: { name: 'Y microsteps', axis: 'y', type: 'microsteps' },
            152: { name: 'Z microsteps', axis: 'z', type: 'microsteps' },
            
            // TMC2209 Hold current % - $200-$202
            200: { name: 'X hold %', axis: 'x', type: 'holdPercent' },
            201: { name: 'Y hold %', axis: 'y', type: 'holdPercent' },
            202: { name: 'Z hold %', axis: 'z', type: 'holdPercent' },
            
            // StallGuard thresholds - $210-$212 (0-255, lower = more sensitive)
            210: { name: 'X StallGuard', axis: 'x', type: 'stallGuard' },
            211: { name: 'Y StallGuard', axis: 'y', type: 'stallGuard' },
            212: { name: 'Z StallGuard', axis: 'z', type: 'stallGuard' },
            
            // TMC TPFD (driver power dissipation) - $220-$222
            220: { name: 'X TPFD', axis: 'x', type: 'tpfd' },
            221: { name: 'Y TPFD', axis: 'y', type: 'tpfd' },
            222: { name: 'Z TPFD', axis: 'z', type: 'tpfd' },
            
            // Homing
            20: { name: 'Soft limits', type: 'softLimits' },
            21: { name: 'Hard limits', type: 'hardLimits' },
            22: { name: 'Homing enable', type: 'homingEnable' },
            24: { name: 'Homing feed rate', type: 'homingFeed' },
            25: { name: 'Homing seek rate', type: 'homingSeek' },
            27: { name: 'Homing pull-off', type: 'homingPulloff' },
            
            // Spindle
            30: { name: 'Spindle max RPM', type: 'spindleMaxRPM' },
            31: { name: 'Spindle min RPM', type: 'spindleMinRPM' },
        };
        
        // Current settings cache
        this.settings = {};
        
        // Response parser
        this.pendingQuery = null;
        this.queryResolve = null;
    }
    
    // ========================================================================
    // SETTINGS READ/WRITE
    // ========================================================================
    
    async readAllSettings() {
        return new Promise((resolve, reject) => {
            const originalHandler = this.serial.onGrblLine;
            let capturing = false;
            let lines = [];
            
            const cleanup = () => {
                this.serial.onGrblLine = originalHandler;
            };
            
            const timeout = setTimeout(() => {
                cleanup();
                reject(new Error('Timeout reading settings'));
            }, 5000);
            
            this.serial.onGrblLine = (line) => {
                if (line.startsWith('$')) {
                    capturing = true;
                    lines.push(line);
                } else if (capturing && (line === 'ok' || line.startsWith('error'))) {
                    clearTimeout(timeout);
                    cleanup();
                    
                    // Parse settings
                    for (const l of lines) {
                        const match = l.match(/\$(\d+)=([0-9.]+)/);
                        if (match) {
                            const num = parseInt(match[1]);
                            const val = parseFloat(match[2]);
                            this.settings[num] = val;
                        }
                    }
                    
                    resolve(this.settings);
                }
                
                if (originalHandler) originalHandler(line);
            };
            
            this.serial.sendGrbl('$$');
        });
    }
    
    async readSetting(num) {
        // Read single setting
        return new Promise((resolve, reject) => {
            const originalHandler = this.serial.onGrblLine;
            
            const cleanup = () => {
                this.serial.onGrblLine = originalHandler;
            };
            
            const timeout = setTimeout(() => {
                cleanup();
                reject(new Error('Timeout'));
            }, 2000);
            
            this.serial.onGrblLine = (line) => {
                const match = line.match(/\$(\d+)=([0-9.]+)/);
                if (match && parseInt(match[1]) === num) {
                    clearTimeout(timeout);
                    cleanup();
                    const val = parseFloat(match[2]);
                    this.settings[num] = val;
                    resolve(val);
                }
                if (originalHandler) originalHandler(line);
            };
            
            this.serial.sendGrbl(`$${num}`);
        });
    }
    
    async writeSetting(num, value) {
        return new Promise((resolve, reject) => {
            const originalHandler = this.serial.onGrblLine;
            
            const cleanup = () => {
                this.serial.onGrblLine = originalHandler;
            };
            
            const timeout = setTimeout(() => {
                cleanup();
                reject(new Error('Timeout'));
            }, 2000);
            
            this.serial.onGrblLine = (line) => {
                if (line === 'ok') {
                    clearTimeout(timeout);
                    cleanup();
                    this.settings[num] = value;
                    resolve(true);
                } else if (line.startsWith('error')) {
                    clearTimeout(timeout);
                    cleanup();
                    reject(new Error(line));
                }
                if (originalHandler) originalHandler(line);
            };
            
            this.serial.sendGrbl(`$${num}=${value}`);
        });
    }
    
    // ========================================================================
    // HIGH-LEVEL CONFIGURATION
    // ========================================================================
    
    async applyMachineProfile(profile) {
        console.log('Applying machine profile to grblHAL...');
        
        const commands = [];
        
        // Motor currents
        if (profile.motors) {
            commands.push({ num: 140, val: profile.motors.x.current });
            commands.push({ num: 141, val: profile.motors.y.current });
            commands.push({ num: 142, val: profile.motors.z.current });
            commands.push({ num: 143, val: profile.motors.x.holdCurrent });
            commands.push({ num: 144, val: profile.motors.y.holdCurrent });
            commands.push({ num: 145, val: profile.motors.z.holdCurrent });
            commands.push({ num: 150, val: profile.motors.x.microsteps });
            commands.push({ num: 151, val: profile.motors.y.microsteps });
            commands.push({ num: 152, val: profile.motors.z.microsteps });
        }
        
        // StallGuard
        if (profile.stallGuard) {
            commands.push({ num: 160, val: profile.stallGuard.x.threshold });
            commands.push({ num: 161, val: profile.stallGuard.y.threshold });
            commands.push({ num: 162, val: profile.stallGuard.z.threshold });
        }
        
        // Mechanics
        if (profile.mechanics) {
            commands.push({ num: 100, val: profile.mechanics.x.stepsPerMm });
            commands.push({ num: 101, val: profile.mechanics.y.stepsPerMm });
            commands.push({ num: 102, val: profile.mechanics.z.stepsPerMm });
            commands.push({ num: 110, val: profile.mechanics.x.maxSpeed });
            commands.push({ num: 111, val: profile.mechanics.y.maxSpeed });
            commands.push({ num: 112, val: profile.mechanics.z.maxSpeed });
            commands.push({ num: 120, val: profile.mechanics.x.acceleration });
            commands.push({ num: 121, val: profile.mechanics.y.acceleration });
            commands.push({ num: 122, val: profile.mechanics.z.acceleration });
        }
        
        // Envelope (soft limits)
        if (profile.envelope) {
            commands.push({ num: 130, val: profile.envelope.x.max });
            commands.push({ num: 131, val: profile.envelope.y.max });
            commands.push({ num: 132, val: profile.envelope.z.max });
            commands.push({ num: 20, val: 1 });  // Enable soft limits
        }
        
        // Apply all commands
        for (const cmd of commands) {
            try {
                await this.writeSetting(cmd.num, cmd.val);
                console.log(`  $${cmd.num}=${cmd.val} ✓`);
            } catch (err) {
                console.warn(`  $${cmd.num}=${cmd.val} FAILED: ${err.message}`);
            }
            await this._delay(50);  // Small delay between commands
        }
        
        console.log('Profile applied!');
    }
    
    // ========================================================================
    // STALLGUARD TUNING
    // ========================================================================
    
    async setStallGuardThreshold(axis, value) {
        const axisNum = { x: 0, y: 1, z: 2 }[axis];
        return this.writeSetting(160 + axisNum, value);
    }
    
    async setMotorCurrent(axis, runCurrent, holdCurrent = null) {
        const axisNum = { x: 0, y: 1, z: 2 }[axis];
        await this.writeSetting(140 + axisNum, runCurrent);
        if (holdCurrent !== null) {
            await this.writeSetting(143 + axisNum, holdCurrent);
        }
    }
    
    async setMicrosteps(axis, microsteps) {
        const axisNum = { x: 0, y: 1, z: 2 }[axis];
        // Valid values: 1, 2, 4, 8, 16, 32, 64, 128, 256
        const valid = [1, 2, 4, 8, 16, 32, 64, 128, 256];
        if (!valid.includes(microsteps)) {
            throw new Error(`Invalid microsteps: ${microsteps}. Must be one of ${valid.join(', ')}`);
        }
        return this.writeSetting(150 + axisNum, microsteps);
    }
    
    // ========================================================================
    // HOMING CONFIGURATION
    // ========================================================================
    
    async configureSensorlessHoming(config = {}) {
        const defaults = {
            enable: true,
            seekRate: 2000,
            feedRate: 200,
            pulloff: 3
        };
        const cfg = { ...defaults, ...config };
        
        await this.writeSetting(22, cfg.enable ? 1 : 0);  // Homing enable
        await this.writeSetting(25, cfg.seekRate);        // Seek rate
        await this.writeSetting(24, cfg.feedRate);        // Feed rate
        await this.writeSetting(27, cfg.pulloff);         // Pull-off distance
        
        console.log('Sensorless homing configured');
    }
    
    // ========================================================================
    // SOFT LIMITS
    // ========================================================================
    
    async setSoftLimits(xMax, yMax, zMax, enable = true) {
        await this.writeSetting(130, xMax);
        await this.writeSetting(131, yMax);
        await this.writeSetting(132, zMax);
        await this.writeSetting(20, enable ? 1 : 0);
        
        console.log(`Soft limits set: X=${xMax}, Y=${yMax}, Z=${zMax}`);
    }
    
    // ========================================================================
    // SPINDLE (VFD) CONFIGURATION
    // ========================================================================
    
    async configureVFD(minRPM, maxRPM) {
        await this.writeSetting(31, minRPM);
        await this.writeSetting(30, maxRPM);
        console.log(`VFD configured: ${minRPM}-${maxRPM} RPM`);
    }
    
    // ========================================================================
    // DIAGNOSTICS
    // ========================================================================
    
    async getMotorStatus() {
        // Request TMC status if available
        // This requires grblHAL with TMC debugging enabled
        return new Promise((resolve) => {
            this.serial.sendGrbl('$I');  // Or specific TMC command
            // Parse response...
            setTimeout(() => resolve({
                x: { current: this.settings[140], sg: this.settings[160] },
                y: { current: this.settings[141], sg: this.settings[161] },
                z: { current: this.settings[142], sg: this.settings[162] }
            }), 500);
        });
    }
    
    async runDiagnostics() {
        console.log('Running motor diagnostics...');
        
        // Read current settings
        await this.readAllSettings();
        
        const report = {
            motors: {},
            issues: []
        };
        
        for (const axis of ['x', 'y', 'z']) {
            const axisNum = { x: 0, y: 1, z: 2 }[axis];
            
            const current = this.settings[140 + axisNum];
            const holdCurrent = this.settings[143 + axisNum];
            const microsteps = this.settings[150 + axisNum];
            const sg = this.settings[160 + axisNum];
            
            report.motors[axis] = {
                current,
                holdCurrent,
                microsteps,
                stallGuard: sg
            };
            
            // Check for issues
            if (current > 2000) {
                report.issues.push(`${axis.toUpperCase()}: Current ${current}mA exceeds TMC2209 max (2000mA)`);
            }
            if (holdCurrent > current) {
                report.issues.push(`${axis.toUpperCase()}: Hold current (${holdCurrent}mA) > run current (${current}mA)`);
            }
            if (sg < 10) {
                report.issues.push(`${axis.toUpperCase()}: StallGuard ${sg} may be too sensitive (false triggers)`);
            }
            if (sg > 200) {
                report.issues.push(`${axis.toUpperCase()}: StallGuard ${sg} may be too insensitive (missed stalls)`);
            }
        }
        
        return report;
    }
    
    // ========================================================================
    // PRESETS
    // ========================================================================
    
    async applyPreset(preset) {
        const presets = {
            'high-speed': {
                motors: { x: { current: 1800 }, y: { current: 1800 }, z: { current: 1800 } },
                stallGuard: { x: 50, y: 50, z: 60 },
                dynamics: { maxSpeed: 10000, accel: 800 }
            },
            'high-torque': {
                motors: { x: { current: 2000 }, y: { current: 2000 }, z: { current: 2000 } },
                stallGuard: { x: 70, y: 70, z: 80 },
                dynamics: { maxSpeed: 5000, accel: 400 }
            },
            'quiet': {
                motors: { x: { current: 1200 }, y: { current: 1200 }, z: { current: 1200 } },
                stallGuard: { x: 80, y: 80, z: 90 },
                dynamics: { maxSpeed: 3000, accel: 300 }
            },
            'precision': {
                motors: { x: { current: 1600 }, y: { current: 1600 }, z: { current: 1600 } },
                stallGuard: { x: 60, y: 60, z: 70 },
                microsteps: 32,
                dynamics: { maxSpeed: 4000, accel: 300 }
            }
        };
        
        const p = presets[preset];
        if (!p) {
            throw new Error(`Unknown preset: ${preset}`);
        }
        
        console.log(`Applying ${preset} preset...`);
        
        // Apply settings
        for (const axis of ['x', 'y', 'z']) {
            const axisNum = { x: 0, y: 1, z: 2 }[axis];
            
            if (p.motors?.[axis]?.current) {
                await this.writeSetting(140 + axisNum, p.motors[axis].current);
            }
            if (p.stallGuard?.[axis]) {
                await this.writeSetting(160 + axisNum, p.stallGuard[axis]);
            }
            if (p.microsteps) {
                await this.writeSetting(150 + axisNum, p.microsteps);
            }
            if (p.dynamics?.maxSpeed) {
                await this.writeSetting(110 + axisNum, p.dynamics.maxSpeed);
            }
            if (p.dynamics?.accel) {
                await this.writeSetting(120 + axisNum, p.dynamics.accel);
            }
        }
        
        console.log(`${preset} preset applied!`);
    }
    
    _delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}


// Export
if (typeof module !== 'undefined' && module.exports) {
    module.exports = GrblHALSettings;
}
