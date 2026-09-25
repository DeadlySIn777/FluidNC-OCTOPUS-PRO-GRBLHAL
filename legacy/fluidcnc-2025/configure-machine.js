/**
 * FluidCNC Machine Configuration Script
 * 
 * This script properly configures grblHAL on BTT Octopus Pro v1.1
 * with TMC2209 drivers and sensorless homing
 * 
 * RUN THIS IN BROWSER CONSOLE AFTER CONNECTING VIA USB
 */

class MachineConfigurator {
    constructor() {
        // Get the app's grbl connection
        this.grbl = window.app?.grbl;
        if (!this.grbl || !this.grbl.connected) {
            console.error('❌ Not connected! Connect via USB first.');
            return;
        }
        console.log('✓ Connected to grblHAL');
    }

    // Send command and wait for response
    async send(cmd) {
        return new Promise((resolve) => {
            console.log(`> ${cmd}`);
            this.grbl.send(cmd);
            // Simple delay since we can't easily intercept responses
            setTimeout(resolve, 100);
        });
    }

    // Send multiple commands with delay between
    async sendAll(commands) {
        for (const cmd of commands) {
            await this.send(cmd);
        }
    }

    /**
     * CRITICAL FIX: Enable homing and soft limits
     */
    async enableHoming() {
        console.log('\n🏠 ENABLING HOMING...');
        
        const commands = [
            // Enable homing cycle
            '$22=7',      // Homing enable: X+Y+Z (bitfield: 1+2+4=7)
            
            // Homing direction invert - depends on your switch positions
            // Bit 0 = X, Bit 1 = Y, Bit 2 = Z
            // If switch is at positive end, set bit. If at negative end, don't.
            // Common CNC: X- Y- Z+ (Z at top) = 4 (only Z inverted)
            '$23=4',      // Homing dir invert (Z homes to positive/top)
            
            // Homing speeds
            '$24=100',    // Homing locate feed rate (slow, final approach)
            '$25=2000',   // Homing seek rate (fast, initial search)
            
            // Debounce and pull-off
            '$26=250',    // Homing switch debounce (ms)
            '$27=3.0',    // Homing pull-off distance (mm) - IMPORTANT for soft limits
            
            // Enable soft limits (REQUIRES HOMING FIRST)
            '$20=1',      // Soft limits enable
            
            // Hard limits - set based on your hardware
            // $21=0 for sensorless homing with TMC2209
            // $21=7 for physical limit switches on X, Y, Z
            '$21=7',      // Hard limits ON - using physical endstops
        ];
        
        await this.sendAll(commands);
        console.log('✓ Homing enabled');
    }

    /**
     * Configure axis travel limits
     * ADJUST THESE TO YOUR ACTUAL MACHINE SIZE
     */
    async setTravelLimits(xMax = 400, yMax = 400, zMax = 120) {
        console.log(`\n📏 SETTING TRAVEL LIMITS: X=${xMax} Y=${yMax} Z=${zMax}...`);
        
        await this.sendAll([
            `$130=${xMax}`,   // X max travel (mm)
            `$131=${yMax}`,   // Y max travel (mm)
            `$132=${zMax}`,   // Z max travel (mm)
        ]);
        
        console.log('✓ Travel limits set');
    }

    /**
     * Configure steps per mm
     * CALCULATE: steps_per_mm = (motor_steps * microsteps) / (pitch * pulley_teeth_or_ratio)
     * 
     * Example for GT2 belt, 20T pulley, 200 step motor, 16 microsteps:
     * (200 * 16) / (2mm * 20) = 3200 / 40 = 80 steps/mm
     * 
     * Example for 8mm lead screw, 200 step motor, 16 microsteps:
     * (200 * 16) / 8 = 3200 / 8 = 400 steps/mm
     */
    async setStepsPerMm(xSteps = 250, ySteps = 250, zSteps = 250) {
        console.log(`\n⚙️ SETTING STEPS/MM: X=${xSteps} Y=${ySteps} Z=${zSteps}...`);
        
        await this.sendAll([
            `$100=${xSteps}`,
            `$101=${ySteps}`,
            `$102=${zSteps}`,
        ]);
        
        console.log('✓ Steps per mm configured');
    }

    /**
     * Configure motor dynamics
     */
    async setDynamics(xSpeed = 10000, ySpeed = 10000, zSpeed = 5000,
                       xAccel = 500, yAccel = 500, zAccel = 300) {
        console.log('\n🚀 SETTING SPEEDS AND ACCELERATIONS...');
        
        await this.sendAll([
            // Max speeds (mm/min)
            `$110=${xSpeed}`,
            `$111=${ySpeed}`,
            `$112=${zSpeed}`,
            
            // Accelerations (mm/sec²)
            `$120=${xAccel}`,
            `$121=${yAccel}`,
            `$122=${zAccel}`,
        ]);
        
        console.log('✓ Dynamics configured');
    }

    /**
     * Configure TMC2209 motor currents (UART mode)
     * Range: 100-2000 mA (TMC2209 max is 2A RMS)
     * 
     * YOUR MOTORS: StepperOnline 60Ncm NEMA17
     * - Rated current: 2.1A (we run at 2.0A for safety)
     * - Resistance: 1.7Ω
     * - High inductance = reduce max speed if needed
     */
    async setMotorCurrents(xCurrent = 2000, yCurrent = 2000, zCurrent = 2000) {
        console.log(`\n⚡ SETTING MOTOR CURRENTS (UART): ${xCurrent}mA...`);
        
        await this.sendAll([
            // Run current (during motion)
            `$140=${xCurrent}`,   // X run current (mA)
            `$141=${yCurrent}`,   // Y run current (mA)
            `$142=${zCurrent}`,   // Z run current (mA)
            
            // Hold current (when idle) - 50% saves power & heat
            `$143=${Math.round(xCurrent * 0.5)}`,   // X hold current (mA)
            `$144=${Math.round(yCurrent * 0.5)}`,   // Y hold current (mA)
            `$145=${Math.round(zCurrent * 0.5)}`,   // Z hold current (mA)
        ]);
        
        console.log('✓ Motor currents set (run + hold)');
    }

    /**
     * Configure TMC2209 UART settings (microsteps, modes)
     */
    async setTrinamicUart() {
        console.log('\n🔌 CONFIGURING TMC2209 UART SETTINGS...');
        
        await this.sendAll([
            // Microsteps (8 = good torque, 16 = smoother but less torque)
            '$150=16',   // X microsteps
            '$151=16',   // Y microsteps
            '$152=16',   // Z microsteps
            
            // StealthChop vs SpreadCycle threshold (mm/min)
            // Below threshold = StealthChop (quiet)
            // Above threshold = SpreadCycle (more torque)
            '$160=60',   // X: SpreadCycle above 60mm/min (most cutting)
            '$161=60',   // Y: SpreadCycle above 60mm/min
            '$162=40',   // Z: SpreadCycle above 40mm/min
        ]);
        
        console.log('✓ TMC2209 UART configured');
    }

    /**
     * Configure TMC2209 StallGuard for sensorless homing
     * Lower value = more sensitive (triggers earlier)
     * Higher value = less sensitive (may miss stalls)
     * Typical range: 30-80
     * 
     * TUNE CAREFULLY: Too low = false triggers, too high = crashes
     */
    async setStallGuard(xSG = 50, ySG = 50, zSG = 60) {
        console.log(`\n🔍 SETTING STALLGUARD: X=${xSG} Y=${ySG} Z=${zSG}...`);
        
        await this.sendAll([
            `$210=${xSG}`,   // X StallGuard threshold
            `$211=${ySG}`,   // Y StallGuard threshold
            `$212=${zSG}`,   // Z StallGuard threshold
        ]);
        
        console.log('✓ StallGuard configured');
    }

    /**
     * Configure spindle for VFD (NOT PWM)
     * This is for controlling VFD via PWM output or Modbus
     */
    async configureSpindle(minRpm = 0, maxRpm = 24000) {
        console.log(`\n🔧 CONFIGURING SPINDLE: ${minRpm}-${maxRpm} RPM...`);
        
        await this.sendAll([
            `$30=${maxRpm}`,   // Max spindle RPM
            `$31=${minRpm}`,   // Min spindle RPM
            '$32=0',          // Laser mode OFF (spindle mode)
            
            // Spindle type - check your grblHAL build
            // $44=0 = None
            // $44=1 = PWM
            // $44=2 = PWM/Direction
            // $44=3 = PWM/Direction/Enable
            // $44=4 = PWM0 (on some builds)
            // For VFD, you typically use PWM out to 0-10V converter, or Modbus
            // '$44=1',  // Uncomment if needed
        ]);
        
        console.log('✓ Spindle configured');
        console.log('   Note: VFD is controlled separately via ESP32 Modbus bridge');
    }

    /**
     * Configure miscellaneous settings
     */
    async setMisc() {
        console.log('\n🔧 SETTING MISC OPTIONS...');
        
        await this.sendAll([
            '$0=5',       // Step pulse time (µs) - 5 is safe for most drivers
            '$1=25',      // Step idle delay (ms) - time before reducing hold current
            '$2=0',       // Step port invert mask
            '$3=0',       // Direction port invert mask (change if motors go wrong way)
            '$4=0',       // Enable invert mask (7 for active-low drivers)
            '$10=511',    // Status report mask - all fields
            '$13=0',      // Report in mm (not inches)
        ]);
        
        console.log('✓ Misc settings configured');
    }

    /**
     * Run complete configuration with safe defaults
     */
    async runFullConfiguration() {
        console.log('═══════════════════════════════════════════════════');
        console.log('    FLUIDCNC MACHINE CONFIGURATION');
        console.log('═══════════════════════════════════════════════════');
        console.log('Machine: BTT Octopus Pro v1.1 + TMC2209');
        console.log('VFD: Changrong H100 via ESP32 RS485');
        console.log('═══════════════════════════════════════════════════\n');

        try {
            // 1. Enable homing - THE MOST CRITICAL FIX
            await this.enableHoming();
            
            // 2. Set proper travel limits
            // CHANGE THESE TO YOUR ACTUAL MACHINE SIZE!
            await this.setTravelLimits(400, 400, 120);
            
            // 3. Set steps per mm
            // CALCULATE FOR YOUR ACTUAL MECHANICS!
            // 250 is probably wrong - common values:
            //   Belt drive (GT2, 20T): 80 steps/mm
            //   Lead screw (8mm): 400 steps/mm
            //   Ball screw (5mm): 640 steps/mm
            // await this.setStepsPerMm(250, 250, 250);
            
            // 4. Set dynamics
            await this.setDynamics(10000, 10000, 5000, 500, 500, 300);
            
            // 5. Set motor currents (60Ncm NEMA17 @ 2.0A)
            await this.setMotorCurrents(2000, 2000, 2000);
            
            // 6. Configure TMC2209 UART settings
            await this.setTrinamicUart();
            
            // 6. Configure StallGuard for sensorless homing
            await this.setStallGuard(50, 50, 60);
            
            // 7. Configure spindle
            await this.configureSpindle(0, 24000);
            
            // 8. Misc settings
            await this.setMisc();
            
            console.log('\n═══════════════════════════════════════════════════');
            console.log('✅ CONFIGURATION COMPLETE!');
            console.log('═══════════════════════════════════════════════════');
            console.log('\n📋 NEXT STEPS:');
            console.log('1. Send $$ to verify settings');
            console.log('2. Send $X to unlock if alarmed');
            console.log('3. Send $H to home the machine');
            console.log('4. Test jog movements');
            console.log('5. Run a test G-code program');
            console.log('\n⚠️  IMPORTANT: Adjust $100-$102 (steps/mm) and');
            console.log('    $130-$132 (travel) for YOUR specific machine!');
            
        } catch (err) {
            console.error('❌ Configuration failed:', err);
        }
    }

    /**
     * Quick fix: Just enable homing (minimal change)
     */
    async quickFixHoming() {
        console.log('🔧 QUICK FIX: Enabling homing...\n');
        
        await this.sendAll([
            '$22=7',      // Enable homing for X, Y, Z
            '$23=4',      // Z homes to positive (top)
            '$27=3.0',    // Pull-off 3mm
            '$20=1',      // Enable soft limits
        ]);
        
        console.log('\n✅ Homing enabled!');
        console.log('Now send $X to unlock, then $H to home.');
    }
}

// Make available globally
window.MachineConfigurator = MachineConfigurator;

// Usage instructions
console.log('═══════════════════════════════════════════════════');
console.log('  MACHINE CONFIGURATOR LOADED');
console.log('═══════════════════════════════════════════════════');
console.log('');
console.log('USAGE:');
console.log('  const config = new MachineConfigurator();');
console.log('');
console.log('  // Quick fix - just enable homing:');
console.log('  config.quickFixHoming();');
console.log('');
console.log('  // Full configuration:');
console.log('  config.runFullConfiguration();');
console.log('');
console.log('═══════════════════════════════════════════════════');
