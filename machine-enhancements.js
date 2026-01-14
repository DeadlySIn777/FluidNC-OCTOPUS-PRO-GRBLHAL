// Machine Enhancements Module
// ACTUALLY INTELLIGENT CNC operation with real machine learning

class MachineEnhancements {
    constructor(app) {
        this.app = app;
        
        // Feature flags
        this.features = {
            predictiveMaintenance: true,
            adaptiveFeedRate: true,
            toolLifeTracking: true,
            energyMonitoring: true,
            jobStatistics: true,
            voiceAlerts: true,
            smartScheduling: true,
            materialDatabase: true,
            // INTELLIGENCE FEATURES
            machineLearning: true,
            patternRecognition: true,
            anomalyDetection: true,
            thermalCompensation: true,
            costOptimization: true,
            // SAFETY FEATURES
            crashPrevention: true,          // StallGuard + accel crash detection
            autoRetract: true,              // Auto Z-up on alarm/crash
            emergencyProcedures: true,      // Guided emergency response
            preflightChecks: true,          // G-code analysis before run
            softLimitsVisualization: true,  // Show work envelope
            collisionAvoidance: true,       // 3D model-based checking
            autoFeedHold: true,             // Pause on anomaly
            chillerOnDoorPin: false,        // CW-3000 alarm → safety door
            // ENVIRONMENTAL MONITORING
            ambientMonitoring: true,        // Temp/humidity tracking
            fireDetection: true,            // Smoke/heat sensor integration
            operatorPresence: false,        // PIR sensor for safety
            enclosureMonitoring: true,      // Door interlock status
            // ACCESSORY CONTROL
            dustCollection: true,           // Auto on/off with spindle
            airBlast: true,                 // Chip clearing control
            vacuumTable: false,             // Vacuum hold-down control
            autoLubrication: false,         // Way lube pump control
            mistCoolant: true,              // Mist coolant control
            // TOOL MANAGEMENT
            toolSetter: false,              // Automatic tool length probe
            brokenToolDetection: true,      // Detect broken tools
            toolRunoutDetection: true,      // Audio/vibration runout
            // RECOVERY FEATURES
            networkRecovery: true,          // Handle WebSocket drops
            powerFailureRecovery: true,     // UPS integration
            jobCheckpointing: true,         // Periodic position saves
            // SPINDLE FEATURES
            spindleWarmup: true,            // Automated warmup cycle
            spindleBearingHealth: true,     // Audio-based bearing monitor
            constantSurfaceSpeed: false     // CSS for facing operations
        };
        
        // Predictive maintenance data
        this.maintenance = {
            spindleHours: this.loadFromStorage('spindleHours', 0),
            motorHours: { x: 0, y: 0, z: 0, a: 0 },
            toolChanges: this.loadFromStorage('toolChanges', 0),
            lastMaintenance: this.loadFromStorage('lastMaintenance', Date.now()),
            alerts: [],
            // NEW: Actual sensor-based health tracking
            vibrationBaseline: this.loadFromStorage('vibrationBaseline', null),
            currentBaseline: this.loadFromStorage('currentBaseline', null),
            healthScore: 100,  // 0-100 overall machine health
            degradationRate: 0  // How fast is health declining?
        };
        
        // Tool life tracking
        this.toolLife = this.loadFromStorage('toolLife', {});
        
        // Job statistics
        this.jobStats = this.loadFromStorage('jobStats', {
            totalJobs: 0,
            totalRuntime: 0,
            totalDistance: 0,
            materialUsed: {},
            successRate: 100
        });
        
        // Energy monitoring
        this.energy = {
            sessionStart: Date.now(),
            spindleOnTime: 0,
            estimatedKwh: 0,
            costPerKwh: 0.12 // Default electricity cost
        };
        
        // Material database with feeds/speeds
        this.materials = this.getDefaultMaterials();
        
        // ================================================================
        // NEW: MACHINE LEARNING & INTELLIGENCE
        // ================================================================
        
        // Learning database - stores what ACTUALLY worked
        this.learningDB = this.loadFromStorage('learningDB', {
            // Cutting records: material+tool -> actual successful parameters
            cuttingRecords: [],
            // Pattern library: recognized good/bad patterns
            patterns: {
                good: [],  // Vibration/audio patterns that indicate good cutting
                bad: [],   // Patterns that preceded failures
                chatter: [] // Chatter onset patterns
            },
            // Machine personality - learned resonances and sweet spots
            machineProfile: {
                resonantFreqs: [],      // Frequencies to avoid
                sweetSpotRpms: [],      // RPMs that work well
                axisCharacteristics: {
                    x: { backlash: 0, stiffness: 1.0, maxJerk: 1000 },
                    y: { backlash: 0, stiffness: 1.0, maxJerk: 1000 },
                    z: { backlash: 0, stiffness: 1.0, maxJerk: 500 }
                }
            },
            // Thermal model - how machine behaves at different temps
            thermalModel: {
                warmupTime: 0,          // Minutes to reach stable temp
                driftPerDegree: 0,      // Position drift per degree C
                compensationFactors: { x: 0, y: 0, z: 0 }
            },
            // Cost/performance tradeoffs learned
            optimizationData: {
                speedVsToolLife: [],    // Data points for optimization
                qualityVsFeed: [],      // Surface finish vs feed rate
                bestPractices: {}       // Material -> learned best practices
            }
        });
        
        // Real-time intelligence state
        this.intelligence = {
            // Current cutting assessment
            currentCut: {
                quality: 0,          // 0-100 estimated quality
                efficiency: 0,       // 0-100 efficiency
                stability: 0,        // 0-100 stability
                recommendation: null // Current AI recommendation
            },
            // Anomaly detection
            anomalyScore: 0,         // 0-100, >70 = something weird
            anomalyType: null,       // What kind of anomaly
            // Learning state
            isLearning: false,
            learningProgress: 0,
            // Prediction
            predictedIssue: null,
            issueConfidence: 0,
            issueTimeToEvent: 0      // Seconds until predicted issue
        };
        
        // Neural network weights (simple perceptron for edge inference)
        this.neuralNet = this.loadFromStorage('neuralNet', {
            // Input: [audio, accel, current, rpm, feed, depth, material_idx]
            // Output: [quality_score, chatter_risk, tool_wear_rate]
            weightsL1: this._initWeights(7, 12),  // 7 inputs -> 12 hidden
            weightsL2: this._initWeights(12, 3),  // 12 hidden -> 3 outputs
            biasL1: new Array(12).fill(0),
            biasL2: new Array(3).fill(0),
            trained: false,
            trainingEpochs: 0
        });
        
        this.init();
    }
    
    init() {
        this.setupPredictiveMaintenance();
        this.setupAdaptiveFeedRate();
        this.setupVoiceAlerts();
        this.setupJobStatistics();
        this.setupMachineLearning();
        this.setupAnomalyDetection();
        this.setupThermalCompensation();
        this.setupHardwareIntegration();
        this.setupNetworkMonitoring();
        this.createEnhancementsUI();
        
        console.log('🧠 Machine Intelligence loaded - COMPREHENSIVE SAFETY & ML');
        console.log('   ├─ TMC2209 StallGuard → ML + Crash Detection');
        console.log('   ├─ VFD Modbus → ML + Fault Handling');
        console.log('   ├─ Chatter ESP32 → ML + Tool Monitoring');
        console.log('   ├─ grblHAL Status → ML + Emergency Procedures');
        console.log('   ├─ Coolant/Chiller → Monitoring + Alarms');
        console.log('   ├─ Environment → Temp/Humidity + Fire Detection');
        console.log('   ├─ Accessories → Dust/Vacuum/Air/Lube');
        console.log('   ├─ Spindle → Warmup + Bearing Health');
        console.log('   ├─ Network → Recovery + Checkpointing');
        console.log('   └─ G-code → Pre-flight Analysis');
    }
    
    // ================================================================
    // HARDWARE INTEGRATION - Connects ALL sensors to ML
    // ================================================================
    
    setupHardwareIntegration() {
        // Store last known hardware state
        this.hardwareState = {
            // TMC2209 StallGuard (from grblHAL)
            stallGuard: { x: 0, y: 0, z: 0 },
            sgTrend: { x: 0, y: 0, z: 0 },
            sgHistory: { x: [], y: [], z: [] },
            
            // VFD Modbus telemetry
            vfd: {
                connected: false,
                rpm: 0,
                amps: 0,
                dcVoltage: 0,
                freq: 0,
                fault: 0,
                faultStr: '',
                ampsHistory: [],
                ampsTrend: 0
            },
            
            // Chatter ESP32 sensors
            chatter: {
                audio: 0,
                accel: 0,
                score: 0,
                freq: 0,
                confidence: 0,
                state: 'ok',
                audioHistory: [],
                audioTrend: 0
            },
            
            // grblHAL machine state
            grbl: {
                state: 'Unknown',
                pos: { x: 0, y: 0, z: 0 },
                feedOverride: 100,
                spindleRPM: 0
            },
            
            // Axis load derived from StallGuard
            axisLoad: { x: 0, y: 0, z: 0 },
            
            // Coolant/Chiller system (CW-3000 or similar)
            coolant: {
                connected: false,
                alarm: false,           // Chiller alarm triggered
                alarmCode: 0,           // 0=ok, 1=overtemp, 2=low flow, 3=pump fail
                alarmStr: '',
                waterTemp: 20,          // Coolant water temperature °C
                waterTempHistory: [],
                waterTempTrend: 0,
                flowOk: true,           // Flow sensor status
                pumpRunning: false,     // Pump status from grblHAL M8/M9
                lastAlarmTime: 0,
                alarmCount: 0
            },
            
            // ================================================================
            // SAFETY SYSTEMS STATE
            // ================================================================
            
            // Crash Detection & Prevention
            crash: {
                detected: false,
                imminent: false,        // Predicted crash coming
                imminentAxis: null,     // Which axis
                confidence: 0,
                lastCrashTime: 0,
                crashCount: 0,
                sgThreshold: 30,        // StallGuard crash threshold
                accelThreshold: 3.0,    // Accelerometer crash threshold (g)
                autoRetractPending: false,
                retracting: false
            },
            
            // Environmental Monitoring
            environment: {
                ambientTemp: 22,        // Room temperature °C
                ambientHumidity: 45,    // Relative humidity %
                tempHistory: [],
                humidityHistory: [],
                fireAlarm: false,       // Smoke/heat sensor
                gasAlarm: false,        // CO/combustible gas
                lastEnvUpdate: 0
            },
            
            // Enclosure Status
            enclosure: {
                hasDoor: false,         // Is enclosure present
                doorOpen: false,        // Door status
                doorInterlockActive: false,  // Safety interlock engaged
                lightOn: false,         // Enclosure light
                fanRunning: false,      // Exhaust fan
                tempInside: 25,         // Inside temp
                lastDoorEvent: 0
            },
            
            // Dust Collection System
            dustCollection: {
                connected: false,
                running: false,
                autoMode: true,         // Auto on/off with spindle
                cfm: 0,                 // If flow sensor available
                filterStatus: 'ok',     // ok, needs_cleaning, clogged
                binLevel: 0,            // 0-100% full
                runtime: 0              // Hours
            },
            
            // Vacuum Table
            vacuum: {
                connected: false,
                enabled: false,
                pressure: 0,            // Vacuum level (inHg or kPa)
                minPressure: 15,        // Alarm threshold
                leakDetected: false,
                zones: [true, true, true, true]  // Zone valves
            },
            
            // Air Blast System
            airBlast: {
                connected: false,
                enabled: false,
                autoMode: true,         // Auto blast on retract
                pressure: 0,            // PSI if sensor available
                minPressure: 60,        // Warning threshold
                lastBlastTime: 0
            },
            
            // Auto Lubrication
            lubrication: {
                connected: false,
                enabled: false,
                autoMode: true,
                tankLevel: 100,         // 0-100%
                lastLubeTime: 0,
                lubeInterval: 3600,     // Seconds between lube cycles
                cycleCount: 0
            },
            
            // Operator Presence (PIR/radar sensor)
            operator: {
                present: true,          // Assume present by default
                lastSeen: Date.now(),
                awayTimeout: 300000,    // 5 min
                pauseOnAway: false,     // Pause job if operator leaves
                alertOnAway: true
            },
            
            // Network/Connection Status
            network: {
                wsConnected: true,
                wsReconnecting: false,
                reconnectAttempts: 0,
                lastDisconnect: 0,
                jobPausedOnDisconnect: false,
                upsConnected: false,
                upsOnBattery: false,
                upsBatteryPercent: 100,
                upsRuntimeMinutes: 0
            },
            
            // Tool Management
            tool: {
                current: 0,             // Current tool number
                length: 0,              // Tool length offset
                diameter: 0,            // Tool diameter
                condition: 'ok',        // ok, worn, broken
                runoutMm: 0,            // Measured runout
                lastProbe: 0,           // Last tool probe time
                setterAvailable: false,
                probePos: { x: 0, y: 0, z: 0 }  // Tool setter location
            },
            
            // Spindle Health
            spindle: {
                state: 'off',           // off, warmup, ready, running
                warmupProgress: 0,      // 0-100%
                bearingHealth: 100,     // 0-100%
                bearingNoiseLevel: 0,
                vibrationLevel: 0,
                hoursTotal: 0,
                hoursSinceService: 0,
                needsWarmup: true
            }
        };
        
        // ================================================================
        // SAFETY CONFIGURATION
        // ================================================================
        
        this.safetyConfig = {
            // Crash prevention thresholds
            sgCrashThreshold: 30,       // StallGuard value indicating crash
            sgWarningThreshold: 50,     // Warning before crash
            accelCrashThreshold: 3.0,   // G-force indicating crash
            accelWarningThreshold: 2.0,
            
            // Auto retract settings
            retractHeight: 10,          // mm above current Z
            retractFeedRate: 3000,      // mm/min
            retractOnAlarm: true,
            retractOnCrash: true,
            retractOnDisconnect: false,
            
            // Environment limits
            maxAmbientTemp: 35,         // °C - warn if exceeded
            minAmbientTemp: 10,
            maxHumidity: 80,            // % RH
            
            // Enclosure settings
            pauseOnDoorOpen: true,
            resumeOnDoorClose: false,   // Require manual resume
            
            // Dust collection
            dustAutoDelay: 5,           // Seconds after spindle stop
            
            // Spindle warmup profile
            warmupStages: [
                { rpm: 5000, duration: 60 },   // 1 min at 5k
                { rpm: 10000, duration: 60 },  // 1 min at 10k
                { rpm: 18000, duration: 60 },  // 1 min at 18k
                { rpm: 24000, duration: 30 }   // 30s at full speed
            ],
            warmupCooldownHours: 4,     // Warmup needed after this idle time
            
            // Network recovery
            maxReconnectAttempts: 10,
            reconnectDelay: 2000,       // ms between attempts
            pauseOnDisconnect: true,
            
            // Job checkpointing
            checkpointInterval: 60,     // Seconds between saves
            maxCheckpoints: 50,
            
            // Tool setter
            toolSetterPos: { x: 0, y: 0, z: -50 },
            toolProbeSpeed: 100,        // mm/min
            toolProbeRetract: 5         // mm retract after contact
        };
        
        // ================================================================
        // EMERGENCY PROCEDURES DATABASE
        // ================================================================
        
        this.emergencyProcedures = {
            // Alarm code -> procedure
            'ALARM:1': {
                name: 'Hard Limit Triggered',
                severity: 'critical',
                autoActions: ['feedHold', 'spindleStop'],
                steps: [
                    '🔴 DO NOT POWER OFF - position will be lost',
                    '1. Check which axis hit the limit switch',
                    '2. Use $X to unlock machine',
                    '3. Jog SLOWLY away from limit (opposite direction)',
                    '4. Re-home machine ($H) before continuing',
                    '5. Check G-code for out-of-bounds moves'
                ],
                recovery: 'rehome'
            },
            'ALARM:2': {
                name: 'Soft Limit Exceeded',
                severity: 'warning',
                autoActions: ['feedHold'],
                steps: [
                    '1. Soft limits prevented out-of-bounds move',
                    '2. Check work coordinate offset (G54)',
                    '3. Verify part zero is set correctly',
                    '4. Job may need repositioning'
                ],
                recovery: 'unlock_and_continue'
            },
            'ALARM:3': {
                name: 'Abort During Cycle',
                severity: 'info',
                autoActions: [],
                steps: [
                    '1. Machine was stopped by user reset',
                    '2. Use $X to unlock',
                    '3. Re-home if position uncertain'
                ],
                recovery: 'unlock'
            },
            'ALARM:4': {
                name: 'Probe Fail',
                severity: 'warning',
                autoActions: ['feedHold'],
                steps: [
                    '1. Probe did not make contact within travel',
                    '2. Check probe wiring/connection',
                    '3. Verify probe plate is positioned correctly',
                    '4. Check $6 probe pin invert setting'
                ],
                recovery: 'unlock'
            },
            'ALARM:5': {
                name: 'Probe Initial State',
                severity: 'warning',
                autoActions: [],
                steps: [
                    '1. Probe was already triggered before probing',
                    '2. Move probe away from contact surface',
                    '3. Check for stuck/damaged probe'
                ],
                recovery: 'unlock'
            },
            'ALARM:6': {
                name: 'Homing Fail - Reset',
                severity: 'critical',
                autoActions: [],
                steps: [
                    '1. Homing cycle was interrupted',
                    '2. Machine may not know position',
                    '3. Manually jog away from limits',
                    '4. Re-run homing cycle'
                ],
                recovery: 'rehome'
            },
            'ALARM:7': {
                name: 'Homing Fail - Door',
                severity: 'warning',
                autoActions: [],
                steps: [
                    '1. Safety door was opened during homing',
                    '2. Close the enclosure door',
                    '3. Re-run homing cycle'
                ],
                recovery: 'rehome'
            },
            'ALARM:8': {
                name: 'Homing Fail - Pulloff',
                severity: 'critical',
                autoActions: [],
                steps: [
                    '1. Failed to clear limit switch after homing',
                    '2. Check $27 homing pull-off distance',
                    '3. Limit switch may be stuck or wiring issue',
                    '4. Manually jog away from switch'
                ],
                recovery: 'rehome'
            },
            'ALARM:9': {
                name: 'Homing Fail - Approach',
                severity: 'critical',
                autoActions: [],
                steps: [
                    '1. Could not find limit switch',
                    '2. Check limit switch wiring',
                    '3. Check $2x homing settings',
                    '4. May need larger search distance'
                ],
                recovery: 'rehome'
            },
            'ALARM:10': {
                name: 'Spindle Control Error',
                severity: 'critical',
                autoActions: ['feedHold'],
                steps: [
                    '1. Spindle failed to reach commanded speed',
                    '2. Check VFD for fault codes',
                    '3. Check spindle wiring',
                    '4. VFD may need reset'
                ],
                recovery: 'unlock'
            },
            'CRASH': {
                name: 'Crash Detected',
                severity: 'critical',
                autoActions: ['feedHold', 'spindleStop', 'retract'],
                steps: [
                    '🔴 CRASH DETECTED - Machine stopped',
                    '1. Check tool for damage - DO NOT continue with broken tool',
                    '2. Check workpiece for damage',
                    '3. Inspect spindle and collet',
                    '4. Verify Z offset after tool change',
                    '5. Review G-code for issues'
                ],
                recovery: 'full_inspect'
            },
            'VFD_FAULT': {
                name: 'VFD Fault',
                severity: 'critical',
                autoActions: ['feedHold'],
                steps: [
                    '🔴 VFD REPORTED FAULT',
                    '1. Note the fault code on VFD display',
                    '2. Common faults: OC (overcurrent), OV (overvoltage), OH (overheat)',
                    '3. Wait for VFD to cool if OH',
                    '4. Reset VFD after addressing cause',
                    '5. Check spindle current draw'
                ],
                recovery: 'vfd_reset'
            },
            'CHILLER_ALARM': {
                name: 'Chiller Alarm',
                severity: 'critical',
                autoActions: ['feedHold', 'spindleStop'],
                steps: [
                    '🔴 COOLANT SYSTEM ALARM',
                    '1. Stop cutting immediately',
                    '2. Check water level in chiller',
                    '3. Check for flow blockage',
                    '4. Verify pump is running',
                    '5. Check water temperature',
                    '6. Clean radiator if overheating'
                ],
                recovery: 'chiller_reset'
            },
            'FIRE': {
                name: 'Fire/Smoke Detected',
                severity: 'emergency',
                autoActions: ['emergencyStop', 'spindleStop', 'dustOff'],
                steps: [
                    '🔥 FIRE/SMOKE DETECTED - EMERGENCY',
                    '1. PRESS E-STOP NOW if not already stopped',
                    '2. DO NOT open enclosure - oxygen feeds fire',
                    '3. Locate fire extinguisher (Class C for electrical)',
                    '4. If small fire, use CO2 or dry chemical extinguisher',
                    '5. If fire spreads, evacuate and call 911',
                    '6. Cut power at breaker if safe to do so'
                ],
                recovery: 'full_inspect'
            },
            'DISCONNECT': {
                name: 'Connection Lost',
                severity: 'warning',
                autoActions: ['feedHold'],
                steps: [
                    '⚠️ CONNECTION LOST',
                    '1. Machine has paused automatically',
                    '2. Check USB/network cable',
                    '3. Controller may need power cycle',
                    '4. Job will resume from checkpoint when reconnected'
                ],
                recovery: 'reconnect'
            },
            'UPS_BATTERY': {
                name: 'Running on UPS Battery',
                severity: 'warning',
                autoActions: ['feedHold'],
                steps: [
                    '⚠️ POWER FAILURE - ON BATTERY',
                    '1. Machine has paused automatically',
                    '2. You have limited time before shutdown',
                    '3. Save work and checkpoint recorded',
                    '4. Consider safe machine state before battery dies'
                ],
                recovery: 'wait_for_power'
            }
        };
        
        // Job checkpoints for recovery
        this.checkpoints = this.loadFromStorage('jobCheckpoints', []);
        
        // Pre-flight check results
        this.preflightResults = null;
        // Hook into existing data streams
        this._hookChatterSystem();
        this._hookGrblStatus();
        this._hookDualSerial();
        
        // Start intelligence update loop (faster than UI, 10Hz)
        this.intelligenceInterval = setInterval(() => {
            this._runIntelligenceCycle();
        }, 100);
        
        console.log('[ML] Hardware integration initialized');
    }
    
    /**
     * Hook into ChatterDetection system for ESP32 sensor data
     */
    _hookChatterSystem(retryCount = 0) {
        const MAX_RETRIES = 5; // Only retry 5 times (10 seconds total)
        
        // Check if chatter system exists and has options
        if (typeof window !== 'undefined' && window.chatterSystem && window.chatterSystem.options) {
            const originalOnUpdate = window.chatterSystem.options.onUpdate;
            
            // Wrap the onUpdate callback to also feed ML
            window.chatterSystem.options.onUpdate = (state) => {
                // Call original handler
                if (originalOnUpdate) originalOnUpdate(state);
                
                // Feed to our ML system
                this._updateFromChatter(state);
            };
            
            console.log('[ML] ✓ Hooked into ChatterDetection system');
        } else if (retryCount < MAX_RETRIES) {
            console.log(`[ML] ChatterDetection not available - retry ${retryCount + 1}/${MAX_RETRIES}`);
            // Retry after load (max 5 times)
            setTimeout(() => this._hookChatterSystem(retryCount + 1), 2000);
        } else {
            console.log('[ML] ChatterDetection not available - requires ESP32 hardware (optional)');
        }
    }
    
    /**
     * Hook into grblHAL status updates for StallGuard & machine state
     */
    _hookGrblStatus() {
        // Try DualSerial first (has StallGuard parsing)
        if (this.app?.dualSerial) {
            const originalOnStatus = this.app.dualSerial.onGrblStatus;
            
            this.app.dualSerial.onGrblStatus = (status) => {
                if (originalOnStatus) originalOnStatus(status);
                this._updateFromGrbl(status);
            };
            
            console.log('[ML] ✓ Hooked into DualSerial grblHAL status');
        } 
        // Fall back to main app status
        else if (this.app) {
            // Hook into state updates
            const checkState = () => {
                if (this.app.state) {
                    this._updateFromGrbl({
                        state: this.app.state.status,
                        pos: this.app.state.wpos || this.app.state.mpos,
                        feedOverride: this.app.state.ov?.[0] || 100,
                        spindleRPM: this.app.state.spindleSpeed || 0
                    });
                }
            };
            
            // Piggyback on the existing status polling
            this.grblCheckInterval = setInterval(checkState, 200);
            console.log('[ML] ✓ Hooked into app state polling');
        }
    }
    
    /**
     * Hook into DualSerial for VFD Modbus data
     */
    _hookDualSerial() {
        if (this.app?.dualSerial) {
            // Get VFD data from the sensorData that DualSerial maintains
            const checkVfd = () => {
                const sd = this.app.dualSerial?.sensorData;
                if (sd) {
                    // VFD data comes through chatter ESP32 which reads Modbus
                    if (sd.vfd !== undefined) {
                        this._updateVfdData({ amps: sd.vfd });
                    }
                }
            };
            
            // Check periodically
            this.vfdCheckInterval = setInterval(checkVfd, 500);
        }
        
        // Also hook into ChatterDetection's VFD telemetry if available
        if (typeof window !== 'undefined' && window.chatterSystem?.state?.vfd) {
            console.log('[ML] ✓ VFD Modbus telemetry available');
        }
    }
    
    /**
     * Update from ChatterDetection ESP32 data
     */
    _updateFromChatter(state) {
        const ch = this.hardwareState.chatter;
        
        // Update current values
        ch.audio = (state.combined || 0) / 100;  // Normalize to 0-1
        ch.accel = state.vibrationG || 0;  // Note: chatter-detection uses vibrationG not vib
        ch.score = state.combined || 0;
        ch.freq = state.freq || 0;
        ch.confidence = state.confidence || 0;
        ch.state = (state.status || 'OK').toLowerCase();  // chatter-detection uses 'status' with uppercase values
        
        // Track history for trend analysis
        ch.audioHistory.push(ch.audio);
        if (ch.audioHistory.length > 50) ch.audioHistory.shift();
        
        // Calculate trend (rising = positive)
        if (ch.audioHistory.length >= 10) {
            const recent = ch.audioHistory.slice(-10);
            const older = ch.audioHistory.slice(-20, -10);
            if (older.length >= 5) {
                const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
                const olderAvg = older.reduce((a, b) => a + b, 0) / older.length;
                ch.audioTrend = (recentAvg - olderAvg) / 10;  // Change per sample
            }
        }
        
        // VFD telemetry comes through chatter system
        if (state.vfd) {
            this._updateVfdData(state.vfd);
        }
        
        // Coolant/chiller data from ESP32 (if sensors attached)
        this._updateCoolantFromESP(state);
        
        // Environmental sensors from ESP32 (DHT22, smoke, etc.)
        this._updateEnvironmentFromESP(state);
        
        // Operator presence (PIR sensor)
        if (state.pirDetected !== undefined) {
            if (state.pirDetected) {
                this.hardwareState.operator.lastSeen = Date.now();
                this.hardwareState.operator.present = true;
            }
        }
        
        // Dust collection status
        if (state.dustCollector !== undefined) {
            this.hardwareState.dustCollection.connected = true;
            this.hardwareState.dustCollection.running = state.dustCollector;
            if (state.dustCfm) this.hardwareState.dustCollection.cfm = state.dustCfm;
        }
        
        // Enclosure sensors
        if (state.enclosureTemp !== undefined) {
            this.hardwareState.enclosure.hasDoor = true;
            this.hardwareState.enclosure.tempInside = state.enclosureTemp;
        }
        if (state.enclosureFan !== undefined) {
            this.hardwareState.enclosure.fanRunning = state.enclosureFan;
        }
        if (state.enclosureLight !== undefined) {
            this.hardwareState.enclosure.lightOn = state.enclosureLight;
        }
        
        // UPS status (if monitoring via ESP32)
        if (state.ups !== undefined) {
            this._updateUPSStatus(state.ups);
        }
    }
    
    /**
     * Update from grblHAL status (includes StallGuard)
     */
    _updateFromGrbl(status) {
        const hw = this.hardwareState;
        
        // Machine state
        const prevState = hw.grbl.state;
        hw.grbl.state = status.state || 'Unknown';
        hw.grbl.pos = status.pos || hw.grbl.pos;
        hw.grbl.feedOverride = status.feedOverride || 100;
        hw.grbl.spindleRPM = status.spindleRPM || 0;
        
        // ====== ALARM DETECTION ======
        // Detect transition to Alarm state and trigger emergency procedures
        if (hw.grbl.state === 'Alarm' && prevState !== 'Alarm') {
            // Parse alarm code from status.message or status.alarm
            const alarmCode = status.alarm || status.alarmCode || this._parseAlarmCode(status.message);
            if (alarmCode && alarmCode !== this.lastAlarmCode) {
                this.lastAlarmCode = alarmCode;
                this._handleGrblAlarm(alarmCode);
            }
        } else if (hw.grbl.state !== 'Alarm') {
            // Clear alarm tracking when not in alarm
            this.lastAlarmCode = null;
        }
        
        // ====== DOOR STATE DETECTION ======
        // Safety door triggers pause and may be chiller alarm
        if (hw.grbl.state === 'Door' && prevState !== 'Door') {
            console.log('[SAFETY] Safety door opened');
            if (this.features.voiceAlerts) {
                this.speak('Safety door opened', 'normal');
            }
            // Check if this is actually a chiller alarm via door pin
            if (this.features.chillerOnDoorPin) {
                this._updateCoolantFromGrbl({ door: true });
            }
        }
        
        // StallGuard data (TMC2209)
        if (status.sg) {
            const sg = status.sg;
            
            for (const axis of ['x', 'y', 'z']) {
                if (sg[axis] !== undefined) {
                    const oldVal = hw.stallGuard[axis];
                    hw.stallGuard[axis] = sg[axis];
                    
                    // Track history
                    hw.sgHistory[axis].push(sg[axis]);
                    if (hw.sgHistory[axis].length > 50) hw.sgHistory[axis].shift();
                    
                    // Calculate trend
                    if (hw.sgHistory[axis].length >= 10) {
                        const recent = hw.sgHistory[axis].slice(-5);
                        const older = hw.sgHistory[axis].slice(-10, -5);
                        const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
                        const olderAvg = older.reduce((a, b) => a + b, 0) / older.length;
                        hw.sgTrend[axis] = recentAvg - olderAvg;
                    }
                    
                    // Calculate axis load from StallGuard
                    // StallGuard ranges 0-255, lower = higher load
                    // Convert to 0-100% load (255 = 0% load, 0 = 100% load)
                    hw.axisLoad[axis] = Math.max(0, 100 - (sg[axis] / 2.55));
                    
                    // Detect oscillation in StallGuard = chatter/vibration
                    if (Math.abs(sg[axis] - oldVal) > 30) {
                        // Big StallGuard swing - could be chatter
                        this._detectStallGuardAnomaly(axis, sg[axis], oldVal);
                    }
                }
            }
        }
        
        // Coolant status from grblHAL (M8/M9 state, safety door for alarm)
        this._updateCoolantFromGrbl(status);
    }
    
    /**
     * Update VFD Modbus telemetry
     */
    _updateVfdData(vfd) {
        const v = this.hardwareState.vfd;
        
        if (typeof vfd === 'number') {
            // Just amps from legacy format
            v.amps = vfd;
        } else if (vfd && typeof vfd === 'object') {
            v.connected = vfd.ok !== false;
            v.rpm = vfd.rpm || 0;
            v.amps = vfd.amps || 0;
            v.dcVoltage = vfd.dcv || 0;
            v.freq = vfd.freq || 0;
            v.fault = vfd.fault || 0;
            v.faultStr = vfd.faultStr || '';
        }
        
        // Track amps history for trend
        v.ampsHistory.push(v.amps);
        if (v.ampsHistory.length > 50) v.ampsHistory.shift();
        
        // Calculate trend
        if (v.ampsHistory.length >= 10) {
            const recent = v.ampsHistory.slice(-5);
            const older = v.ampsHistory.slice(-10, -5);
            const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
            const olderAvg = older.reduce((a, b) => a + b, 0) / older.length;
            v.ampsTrend = recentAvg - olderAvg;
        }
    }
    
    /**
     * Detect anomaly from StallGuard oscillation
     */
    _detectStallGuardAnomaly(axis, newVal, oldVal) {
        const swing = Math.abs(newVal - oldVal);
        
        // Check if we're seeing oscillation pattern (chatter causes SG oscillation)
        const history = this.hardwareState.sgHistory[axis];
        if (history.length >= 10) {
            // Count direction changes in last 10 samples
            let changes = 0;
            for (let i = 1; i < Math.min(10, history.length); i++) {
                if ((history[i] - history[i-1]) * (history[i-1] - (history[i-2] || history[i-1])) < 0) {
                    changes++;
                }
            }
            
            // High oscillation = likely chatter
            if (changes >= 5 && swing > 20) {
                console.log(`[ML] StallGuard oscillation on ${axis}-axis: ${changes} reversals, swing=${swing}`);
                
                // Learn this pattern
                this.learnBadPattern(
                    `sg_oscillation_${axis}`,
                    { 
                        stallGuardSwing: { min: swing - 10, max: swing + 10 },
                        reversalCount: { min: changes - 1, max: changes + 2 }
                    },
                    swing / 50,  // Severity based on swing size
                    `Reduce ${axis.toUpperCase()}-axis acceleration or check toolpath`
                );
            }
        }
    }
    
    /**
     * Main intelligence cycle - runs at 10Hz
     * Aggregates all hardware data and feeds to ML
     */
    _runIntelligenceCycle() {
        const hw = this.hardwareState;
        
        // ====== ALWAYS-RUN SAFETY CHECKS ======
        // These run even when machine is idle
        
        // Check enclosure door
        this._checkEnclosureStatus();
        
        // Check operator presence
        this._checkOperatorPresence();
        
        // Check spindle warmup needed
        this._checkSpindleWarmup();
        
        // Auto dust collection
        this._autoDustCollection();
        
        // Auto lubrication
        this._runLubeCycle();
        
        // Periodic job checkpoint
        if (this.currentJob && this.features.jobCheckpointing) {
            const timeSinceCheckpoint = Date.now() - (this.checkpoints[this.checkpoints.length - 1]?.time || 0);
            if (timeSinceCheckpoint > this.safetyConfig.checkpointInterval * 1000) {
                this._saveCheckpoint('periodic');
            }
        }
        
        // Don't run full intelligence if machine is idle
        if (hw.grbl.state === 'Idle' || hw.grbl.state === 'Alarm') {
            return;
        }
        
        // ====== ACTIVE CUTTING INTELLIGENCE ======
        
        // Aggregate sensor data for ML
        const sensorData = {
            // Chatter ESP32 sensors
            audio: hw.chatter.audio,
            audioTrend: hw.chatter.audioTrend,
            accel: hw.chatter.accel,
            
            // VFD Modbus
            current: hw.vfd.amps,
            currentTrend: hw.vfd.ampsTrend,
            
            // grblHAL
            rpm: hw.grbl.spindleRPM || hw.vfd.rpm,
            feed: hw.grbl.feedOverride * 10,  // Convert % to mm/min estimate
            
            // Derived
            depth: 2,  // TODO: Parse from G-code
            temperature: this.thermal.currentTemp,
            position: hw.grbl.pos,
            
            // StallGuard data
            stallGuard: hw.stallGuard,
            axisLoad: hw.axisLoad,
            
            // Material (TODO: get from job info)
            material: 'aluminum_6061'
        };
        
        // Run the full intelligence update
        const result = this.updateIntelligence(sensorData);
        
        // ====== SAFETY CHECKS DURING CUTTING ======
        
        // CRITICAL: Crash detection
        this._checkCrashConditions();
        
        // Check for critical StallGuard anomalies
        this._checkStallGuardAnomalies();
        
        // Check for VFD faults
        if (hw.vfd.fault > 0) {
            this._executeEmergencyProcedure('VFD_FAULT');
        }
        
        // Check coolant system
        this._checkCoolantSystem();
        
        // Tool condition monitoring
        this._detectToolRunout();
        this._detectBrokenTool();
        
        // Spindle bearing health
        this._monitorSpindleBearings();
    }
    
    /**
     * Check coolant/chiller system status
     */
    _checkCoolantSystem() {
        const c = this.hardwareState.coolant;
        const wasAlarmed = c.alarm;
        
        // Check for alarm conditions
        if (c.alarm && !wasAlarmed) {
            // New alarm!
            c.lastAlarmTime = Date.now();
            c.alarmCount++;
            
            const alarmMessages = {
                1: 'Coolant over-temperature! Check chiller.',
                2: 'Low coolant flow detected! Check pump and lines.',
                3: 'Coolant pump failure! Immediate stop required.'
            };
            
            const msg = alarmMessages[c.alarmCode] || `Coolant alarm ${c.alarmCode}`;
            console.error('[COOLANT]', msg);
            this.speak(msg, 'high');
            this.app?.showNotification?.(msg, 'error');
            
            // Critical: pump fail should stop spindle
            if (c.alarmCode === 3 && this.hardwareState.grbl.spindleRPM > 0) {
                console.error('[SAFETY] Pump failure with spindle running - sending hold');
                this.app?.grbl?.sendRealtime?.('!');
            }
        }
        
        // Check water temp trend (rising = bad)
        if (c.waterTempTrend > 0.5 && c.waterTemp > 30) {
            this.app?.showNotification?.(
                `Coolant temp rising: ${c.waterTemp.toFixed(1)}°C (+${c.waterTempTrend.toFixed(2)}/s)`,
                'warning'
            );
        }
        
        // Over-temp warning before alarm
        if (c.waterTemp > 28 && c.waterTemp < 35 && !c.alarm) {
            // Just a warning
            if (!this._coolantWarnedAt || Date.now() - this._coolantWarnedAt > 60000) {
                this._coolantWarnedAt = Date.now();
                this.app?.showNotification?.(
                    `Coolant temperature high: ${c.waterTemp.toFixed(1)}°C`,
                    'warning'
                );
            }
        }
        
        // Update thermal compensation with actual coolant temp
        if (c.waterTemp > 0 && c.connected) {
            this.thermal.currentTemp = c.waterTemp;
        }
    }
    
    /**
     * Update coolant state from grblHAL status (M8/M9 and door/alarm pins)
     */
    _updateCoolantFromGrbl(status) {
        const c = this.hardwareState.coolant;
        
        // Pump state from grblHAL coolant status
        if (status.coolant !== undefined) {
            c.pumpRunning = status.coolant === 'flood' || status.coolant === 'mist';
        }
        
        // If using safety door input for chiller alarm
        if (status.door && this.features.chillerOnDoorPin) {
            c.alarm = true;
            c.alarmCode = c.alarmCode || 1; // Default to overtemp
            c.alarmStr = 'Chiller alarm via safety door input';
        }
    }
    
    /**
     * Update coolant state from ESP32 sensor data (if temp sensor connected)
     */
    _updateCoolantFromESP(data) {
        const c = this.hardwareState.coolant;
        
        // Water temperature from DS18B20 on ESP32
        if (data.waterTemp !== undefined) {
            c.connected = true;
            c.waterTemp = data.waterTemp;
            
            // Track history for trend
            c.waterTempHistory.push(c.waterTemp);
            if (c.waterTempHistory.length > 30) c.waterTempHistory.shift();
            
            // Calculate trend
            if (c.waterTempHistory.length >= 10) {
                const recent = c.waterTempHistory.slice(-5);
                const older = c.waterTempHistory.slice(-10, -5);
                const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
                const olderAvg = older.reduce((a, b) => a + b, 0) / older.length;
                c.waterTempTrend = recentAvg - olderAvg;
            }
            
            // Check for over-temp alarm (CW-3000 typically alarms at 35°C)
            if (c.waterTemp > 35) {
                c.alarm = true;
                c.alarmCode = 1;
                c.alarmStr = `Coolant over-temperature: ${c.waterTemp.toFixed(1)}°C`;
            } else if (c.waterTemp < 35 && c.alarmCode === 1) {
                // Clear overtemp alarm if temp drops
                c.alarm = false;
                c.alarmCode = 0;
                c.alarmStr = '';
            }
        }
        
        // Flow sensor status
        if (data.coolantFlow !== undefined) {
            c.flowOk = data.coolantFlow > 0.5; // L/min threshold
            
            if (!c.flowOk && c.pumpRunning) {
                c.alarm = true;
                c.alarmCode = 2;
                c.alarmStr = 'Low coolant flow detected';
            }
        }
        
        // Direct chiller alarm input
        if (data.chillerAlarm !== undefined) {
            c.alarm = data.chillerAlarm;
            if (c.alarm && c.alarmCode === 0) {
                c.alarmCode = 1; // Assume overtemp if no specific code
                c.alarmStr = 'Chiller alarm triggered';
            }
        }
    }
    
    /**
     * Check for StallGuard-based anomalies
     */
    _checkStallGuardAnomalies() {
        const hw = this.hardwareState;
        
        for (const axis of ['x', 'y', 'z']) {
            const load = hw.axisLoad[axis];
            const sg = hw.stallGuard[axis];
            const trend = hw.sgTrend[axis];
            
            // High axis load
            if (load > 80) {
                // Add to anomaly detection
                const anomalyData = { [`axis_load_${axis}`]: load };
                const anomaly = this.detectAnomaly(anomalyData);
                
                if (anomaly.isAnomaly) {
                    console.log(`[ML] High ${axis.toUpperCase()}-axis load: ${load.toFixed(0)}%`);
                }
            }
            
            // Rapid load increase (possible crash)
            if (trend < -30) {  // StallGuard dropping fast = load increasing fast
                console.warn(`[ML] ⚠️ Rapid ${axis.toUpperCase()}-axis load increase!`);
                
                // This could be a crash or tool digging in
                if (this.features.voiceAlerts) {
                    this.speak(`Warning: High ${axis} axis load`, 'high');
                }
            }
            
            // Near-stall condition (SG very low)
            if (sg < 20 && hw.grbl.state === 'Run') {
                console.warn(`[ML] ⚠️ ${axis.toUpperCase()}-axis near stall! SG=${sg}`);
                
                // Add to learned patterns
                this.learnBadPattern(
                    `near_stall_${axis}`,
                    { stallGuard: { min: 0, max: 30 } },
                    0.9,
                    `Reduce feed rate or depth - ${axis.toUpperCase()}-axis motor struggling`
                );
            }
        }
    }
    
    // ================================================================
    // CRASH DETECTION & PREVENTION
    // ================================================================
    
    /**
     * Check for crash conditions using StallGuard + accelerometer
     * Called every intelligence cycle (10Hz)
     */
    _checkCrashConditions() {
        if (!this.features.crashPrevention) return;
        
        const hw = this.hardwareState;
        const crash = hw.crash;
        
        // Reset imminent flag each cycle
        crash.imminent = false;
        
        for (const axis of ['x', 'y', 'z']) {
            const sg = hw.stallGuard[axis];
            const trend = hw.sgTrend[axis];
            const accel = hw.chatter.accel;
            
            // ====== CRASH DETECTION ======
            
            // Condition 1: StallGuard dropped to very low value
            if (sg < crash.sgThreshold && hw.grbl.state === 'Run') {
                crash.detected = true;
                crash.imminentAxis = axis;
                crash.confidence = 95;
                this._handleCrashDetected(axis, 'stallguard', sg);
                return;
            }
            
            // Condition 2: Sudden high G-force (physical impact)
            if (accel > crash.accelThreshold) {
                crash.detected = true;
                crash.imminentAxis = axis;
                crash.confidence = 90;
                this._handleCrashDetected('impact', 'accelerometer', accel);
                return;
            }
            
            // ====== CRASH PREDICTION (imminent) ======
            
            // StallGuard trending down rapidly
            if (trend < -20 && sg < 80) {
                // Predict crash in next few moves
                const timeToStall = sg / Math.abs(trend) * 100;  // ms
                
                if (timeToStall < 500) {  // Less than 500ms to crash
                    crash.imminent = true;
                    crash.imminentAxis = axis;
                    crash.confidence = 70;
                    
                    console.warn(`[CRASH] ⚠️ Predicted crash on ${axis.toUpperCase()}-axis in ${timeToStall.toFixed(0)}ms`);
                    
                    // Take preventive action
                    if (this.features.autoFeedHold) {
                        this._preventiveFeedHold(axis);
                    }
                }
            }
            
            // High load sustained - warn operator
            if (hw.axisLoad[axis] > 85 && !crash.imminent) {
                if (this.features.voiceAlerts) {
                    this.speak(`Caution: ${axis} axis load critical`, 'high');
                }
            }
        }
    }
    
    /**
     * Handle detected crash - emergency response
     */
    _handleCrashDetected(axis, source, value) {
        const crash = this.hardwareState.crash;
        
        crash.lastCrashTime = Date.now();
        crash.crashCount++;
        
        console.error(`[CRASH] 🔴 CRASH DETECTED! Axis: ${axis}, Source: ${source}, Value: ${value}`);
        
        // Voice alert
        if (this.features.voiceAlerts) {
            this.speak('Crash detected! Machine stopped.', 'high');
        }
        
        // Execute emergency procedure
        this._executeEmergencyProcedure('CRASH');
        
        // Show emergency modal
        this._showEmergencyModal('CRASH');
    }
    
    /**
     * Preventive feed hold before crash
     */
    _preventiveFeedHold(axis) {
        console.warn(`[CRASH] Preventive feed hold - ${axis}-axis load increasing`);
        
        // Send feed hold
        this.app?.grbl?.sendRealtime?.('!');
        
        if (this.features.voiceAlerts) {
            this.speak(`Feed hold: ${axis} axis overloading`, 'high');
        }
        
        // Show warning
        this.app?.showNotification?.(`Preventive stop: ${axis.toUpperCase()}-axis overload`, 'warning');
    }
    
    /**
     * Auto retract Z to safe height
     */
    async _autoRetract(reason) {
        if (!this.features.autoRetract) return;
        
        const crash = this.hardwareState.crash;
        if (crash.retracting) return;  // Already retracting
        
        crash.autoRetractPending = true;
        crash.retracting = true;
        
        console.log(`[SAFETY] Auto-retract initiated: ${reason}`);
        
        try {
            // Calculate safe Z position
            const currentZ = this.hardwareState.grbl.pos.z;
            const retractZ = currentZ + this.safetyConfig.retractHeight;
            
            // Send retract command - use machine coordinates for safety
            const cmd = `G53 G0 Z${retractZ.toFixed(3)} F${this.safetyConfig.retractFeedRate}`;
            
            // Note: Can only retract if not in alarm state
            if (this.hardwareState.grbl.state !== 'Alarm') {
                this.app?.grbl?.send?.(cmd);
            }
            
            if (this.features.voiceAlerts) {
                this.speak('Retracting to safe height', 'normal');
            }
            
        } catch (err) {
            console.error('[SAFETY] Auto-retract failed:', err);
        } finally {
            crash.retracting = false;
            crash.autoRetractPending = false;
        }
    }
    
    // ================================================================
    // EMERGENCY PROCEDURES SYSTEM
    // ================================================================
    
    /**
     * Execute emergency procedure based on alarm type
     */
    _executeEmergencyProcedure(alarmType) {
        const procedure = this.emergencyProcedures[alarmType];
        if (!procedure) {
            console.warn(`[EMERGENCY] No procedure for: ${alarmType}`);
            return;
        }
        
        console.log(`[EMERGENCY] Executing procedure: ${procedure.name}`);
        
        // Execute auto-actions
        for (const action of procedure.autoActions) {
            switch (action) {
                case 'feedHold':
                    this.app?.grbl?.sendRealtime?.('!');
                    break;
                case 'spindleStop':
                    this.app?.grbl?.sendRealtime?.('\x9E');  // Spindle stop
                    break;
                case 'emergencyStop':
                    // Full reset
                    this.app?.grbl?.sendRealtime?.('\x18');  // Ctrl+X reset
                    break;
                case 'retract':
                    this._autoRetract(alarmType);
                    break;
                case 'dustOff':
                    this._setDustCollection(false);
                    break;
            }
        }
        
        // Voice announcement
        if (this.features.voiceAlerts) {
            this.speak(procedure.name, 'high');
        }
    }
    
    /**
     * Show emergency procedure modal
     */
    _showEmergencyModal(alarmType) {
        const procedure = this.emergencyProcedures[alarmType];
        if (!procedure) return;
        
        // Create modal overlay
        const modal = document.createElement('div');
        modal.id = 'emergency-modal';
        modal.innerHTML = `
            <div class="emergency-modal-overlay">
                <div class="emergency-modal ${procedure.severity}">
                    <div class="emergency-header">
                        <span class="emergency-icon">${
                            procedure.severity === 'emergency' ? '🔥' :
                            procedure.severity === 'critical' ? '🔴' : '⚠️'
                        }</span>
                        <h2>${procedure.name}</h2>
                    </div>
                    <div class="emergency-steps">
                        ${procedure.steps.map(step => `<div class="step">${step}</div>`).join('')}
                    </div>
                    <div class="emergency-actions">
                        <button onclick="window.app?.enhancements?._acknowledgeEmergency?.('${alarmType}')" 
                                class="btn-acknowledge">I Understand</button>
                        ${procedure.recovery === 'unlock' ? 
                            '<button onclick="window.app?.grbl?.send?.(\'$X\')" class="btn-action">Unlock Machine</button>' : ''}
                        ${procedure.recovery === 'rehome' ? 
                            '<button onclick="window.app?.grbl?.send?.(\'$H\')" class="btn-action">Home Machine</button>' : ''}
                    </div>
                </div>
            </div>
        `;
        
        // Add styles if not present
        if (!document.getElementById('emergency-modal-styles')) {
            const styles = document.createElement('style');
            styles.id = 'emergency-modal-styles';
            styles.textContent = `
                .emergency-modal-overlay {
                    position: fixed; top: 0; left: 0; right: 0; bottom: 0;
                    background: rgba(0,0,0,0.8); z-index: 10000;
                    display: flex; align-items: center; justify-content: center;
                }
                .emergency-modal {
                    background: #1a1a2e; border-radius: 10px; padding: 20px;
                    max-width: 500px; width: 90%;
                    border: 3px solid #ff4444;
                }
                .emergency-modal.warning { border-color: #ffaa00; }
                .emergency-modal.info { border-color: #4488ff; }
                .emergency-modal.emergency { 
                    border-color: #ff0000; 
                    animation: emergency-pulse 0.5s infinite alternate;
                }
                @keyframes emergency-pulse {
                    from { box-shadow: 0 0 20px #ff0000; }
                    to { box-shadow: 0 0 40px #ff0000; }
                }
                .emergency-header {
                    display: flex; align-items: center; gap: 10px;
                    border-bottom: 1px solid #333; padding-bottom: 10px; margin-bottom: 15px;
                }
                .emergency-icon { font-size: 2rem; }
                .emergency-header h2 { color: #fff; margin: 0; }
                .emergency-steps .step {
                    padding: 8px 0; color: #ddd; border-bottom: 1px solid #333;
                }
                .emergency-actions {
                    margin-top: 20px; display: flex; gap: 10px; flex-wrap: wrap;
                }
                .btn-acknowledge {
                    background: #4CAF50; color: white; border: none;
                    padding: 10px 20px; border-radius: 5px; cursor: pointer;
                    font-size: 1rem;
                }
                .btn-action {
                    background: #2196F3; color: white; border: none;
                    padding: 10px 20px; border-radius: 5px; cursor: pointer;
                }
            `;
            document.head.appendChild(styles);
        }
        
        // Remove any existing modal
        document.getElementById('emergency-modal')?.remove();
        document.body.appendChild(modal);
    }
    
    _acknowledgeEmergency(alarmType) {
        document.getElementById('emergency-modal')?.remove();
        console.log(`[EMERGENCY] Acknowledged: ${alarmType}`);
    }
    
    /**
     * Handle grblHAL alarm codes
     */
    _handleGrblAlarm(alarmCode) {
        const alarmType = `ALARM:${alarmCode}`;
        
        if (this.emergencyProcedures[alarmType]) {
            this._executeEmergencyProcedure(alarmType);
            this._showEmergencyModal(alarmType);
        } else {
            console.warn(`[ALARM] Unknown alarm code: ${alarmCode}`);
            if (this.features.voiceAlerts) {
                this.speak(`Alarm ${alarmCode}`, 'high');
            }
        }
    }
    
    /**
     * Parse alarm code from grblHAL message string
     * @param {string} message - Message like "ALARM:1" or "[MSG:Alarm 2]"
     * @returns {number|null} Alarm code or null
     */
    _parseAlarmCode(message) {
        if (!message) return null;
        
        // Try ALARM:N format
        const alarmMatch = message.match(/ALARM[:\s]*(\d+)/i);
        if (alarmMatch) return parseInt(alarmMatch[1], 10);
        
        // Try error:N format (some alarms come as errors)
        const errorMatch = message.match(/error[:\s]*(\d+)/i);
        if (errorMatch) return parseInt(errorMatch[1], 10);
        
        return null;
    }
    
    // ================================================================
    // G-CODE PRE-FLIGHT CHECKS
    // ================================================================
    
    /**
     * Analyze G-code before running
     * @param {string} gcode - The full G-code program
     * @returns {Object} Pre-flight check results
     */
    preflightCheck(gcode) {
        if (!gcode || typeof gcode !== 'string') {
            return { passed: false, errors: ['No G-code provided'] };
        }
        
        const results = {
            passed: true,
            errors: [],
            warnings: [],
            info: [],
            stats: {
                lineCount: 0,
                toolChanges: [],
                estimatedTime: 0,
                boundingBox: { 
                    min: { x: Infinity, y: Infinity, z: Infinity },
                    max: { x: -Infinity, y: -Infinity, z: -Infinity }
                },
                feedRates: [],
                spindleSpeeds: [],
                coolantRequired: false,
                operations: []
            }
        };
        
        const lines = gcode.split('\n');
        results.stats.lineCount = lines.length;
        
        let currentPos = { x: 0, y: 0, z: 0 };
        let currentFeed = 0;
        let currentRPM = 0;
        let isAbsolute = true;
        let activeCoordSystem = 'G54';
        let spindleOn = false;
        
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim().toUpperCase();
            if (!line || line.startsWith('(') || line.startsWith(';')) continue;
            
            // Parse G-codes
            const gCodes = line.match(/G\d+\.?\d*/g) || [];
            const mCodes = line.match(/M\d+/g) || [];
            
            for (const g of gCodes) {
                switch (g) {
                    case 'G90': isAbsolute = true; break;
                    case 'G91': isAbsolute = false; break;
                    case 'G54': case 'G55': case 'G56': case 'G57': case 'G58': case 'G59':
                        activeCoordSystem = g;
                        break;
                }
            }
            
            // Parse coordinates
            const xMatch = line.match(/X(-?\d+\.?\d*)/);
            const yMatch = line.match(/Y(-?\d+\.?\d*)/);
            const zMatch = line.match(/Z(-?\d+\.?\d*)/);
            const fMatch = line.match(/F(\d+\.?\d*)/);
            const sMatch = line.match(/S(\d+)/);
            
            if (xMatch) currentPos.x = isAbsolute ? parseFloat(xMatch[1]) : currentPos.x + parseFloat(xMatch[1]);
            if (yMatch) currentPos.y = isAbsolute ? parseFloat(yMatch[1]) : currentPos.y + parseFloat(yMatch[1]);
            if (zMatch) currentPos.z = isAbsolute ? parseFloat(zMatch[1]) : currentPos.z + parseFloat(zMatch[1]);
            if (fMatch) currentFeed = parseFloat(fMatch[1]);
            if (sMatch) currentRPM = parseInt(sMatch[1]);
            
            // Update bounding box
            if (xMatch || yMatch || zMatch) {
                results.stats.boundingBox.min.x = Math.min(results.stats.boundingBox.min.x, currentPos.x);
                results.stats.boundingBox.min.y = Math.min(results.stats.boundingBox.min.y, currentPos.y);
                results.stats.boundingBox.min.z = Math.min(results.stats.boundingBox.min.z, currentPos.z);
                results.stats.boundingBox.max.x = Math.max(results.stats.boundingBox.max.x, currentPos.x);
                results.stats.boundingBox.max.y = Math.max(results.stats.boundingBox.max.y, currentPos.y);
                results.stats.boundingBox.max.z = Math.max(results.stats.boundingBox.max.z, currentPos.z);
            }
            
            // M-codes
            for (const m of mCodes) {
                switch (m) {
                    case 'M3': case 'M4':
                        spindleOn = true;
                        if (currentRPM > 0) results.stats.spindleSpeeds.push(currentRPM);
                        break;
                    case 'M5':
                        spindleOn = false;
                        break;
                    case 'M6':
                        const tMatch = line.match(/T(\d+)/);
                        if (tMatch) results.stats.toolChanges.push(parseInt(tMatch[1]));
                        break;
                    case 'M7': case 'M8':
                        results.stats.coolantRequired = true;
                        break;
                }
            }
            
            // Collect feed rates
            if (currentFeed > 0 && !results.stats.feedRates.includes(currentFeed)) {
                results.stats.feedRates.push(currentFeed);
            }
            
            // ====== CHECKS ======
            
            // Check for movement without spindle (except G0)
            if (!spindleOn && (line.includes('G1') || line.includes('G2') || line.includes('G3'))) {
                if (zMatch && parseFloat(zMatch[1]) < 0) {
                    results.warnings.push(`Line ${i+1}: Cutting move without spindle running`);
                }
            }
            
            // Check for very slow feeds
            if (fMatch && currentFeed < 10 && currentFeed > 0) {
                results.warnings.push(`Line ${i+1}: Very slow feed rate (F${currentFeed})`);
            }
            
            // Check for very high feeds
            if (fMatch && currentFeed > 10000) {
                results.warnings.push(`Line ${i+1}: Unusually high feed rate (F${currentFeed})`);
            }
            
            // Check RPM range
            if (sMatch && currentRPM > 0) {
                if (currentRPM < 1000) {
                    results.warnings.push(`Line ${i+1}: Very low spindle speed (S${currentRPM})`);
                }
                if (currentRPM > 30000) {
                    results.errors.push(`Line ${i+1}: Spindle speed exceeds max (S${currentRPM})`);
                    results.passed = false;
                }
            }
        }
        
        // ====== POST-PARSE CHECKS ======
        
        // Check against soft limits
        if (this.app?.state?.softLimits) {
            const limits = this.app.state.softLimits;
            const bb = results.stats.boundingBox;
            
            if (bb.min.x < limits.minX || bb.max.x > limits.maxX) {
                results.errors.push(`X-axis exceeds soft limits (${bb.min.x.toFixed(1)} to ${bb.max.x.toFixed(1)})`);
                results.passed = false;
            }
            if (bb.min.y < limits.minY || bb.max.y > limits.maxY) {
                results.errors.push(`Y-axis exceeds soft limits`);
                results.passed = false;
            }
            if (bb.min.z < limits.minZ || bb.max.z > limits.maxZ) {
                results.errors.push(`Z-axis exceeds soft limits`);
                results.passed = false;
            }
        }
        
        // Check Z depth
        if (results.stats.boundingBox.min.z < -50) {
            results.warnings.push(`Deep Z cut: ${results.stats.boundingBox.min.z.toFixed(1)}mm - verify clearance`);
        }
        
        // Coolant check
        if (results.stats.coolantRequired && !this.hardwareState.coolant.connected) {
            results.warnings.push('Program requires coolant but chiller not connected');
        }
        
        // Tool changes
        if (results.stats.toolChanges.length > 0) {
            results.info.push(`Tool changes required: ${results.stats.toolChanges.join(', ')}`);
        }
        
        // Spindle warmup check
        const maxRPM = Math.max(...results.stats.spindleSpeeds, 0);
        if (maxRPM > 15000 && this.hardwareState.spindle.needsWarmup) {
            results.warnings.push(`High RPM program (${maxRPM}) - spindle warmup recommended`);
        }
        
        // Estimate time (rough)
        const bb = results.stats.boundingBox;
        const totalTravel = Math.sqrt(
            Math.pow(bb.max.x - bb.min.x, 2) +
            Math.pow(bb.max.y - bb.min.y, 2) +
            Math.pow(bb.max.z - bb.min.z, 2)
        ) * 5;  // Rough multiplier
        const avgFeed = results.stats.feedRates.length > 0 ?
            results.stats.feedRates.reduce((a, b) => a + b) / results.stats.feedRates.length : 1000;
        results.stats.estimatedTime = Math.round(totalTravel / avgFeed * 60);  // seconds
        
        this.preflightResults = results;
        return results;
    }
    
    /**
     * Show pre-flight check results in UI
     */
    showPreflightResults(results) {
        if (!results) results = this.preflightResults;
        if (!results) return;
        
        const modal = document.createElement('div');
        modal.id = 'preflight-modal';
        modal.innerHTML = `
            <div class="preflight-overlay">
                <div class="preflight-modal ${results.passed ? 'passed' : 'failed'}">
                    <h2>${results.passed ? '✅ Pre-flight Check Passed' : '❌ Pre-flight Check Failed'}</h2>
                    
                    ${results.errors.length > 0 ? `
                        <div class="preflight-section errors">
                            <h3>🔴 Errors</h3>
                            ${results.errors.map(e => `<div class="item">${e}</div>`).join('')}
                        </div>
                    ` : ''}
                    
                    ${results.warnings.length > 0 ? `
                        <div class="preflight-section warnings">
                            <h3>⚠️ Warnings</h3>
                            ${results.warnings.map(w => `<div class="item">${w}</div>`).join('')}
                        </div>
                    ` : ''}
                    
                    ${results.info.length > 0 ? `
                        <div class="preflight-section info">
                            <h3>ℹ️ Information</h3>
                            ${results.info.map(i => `<div class="item">${i}</div>`).join('')}
                        </div>
                    ` : ''}
                    
                    <div class="preflight-section stats">
                        <h3>📊 Program Statistics</h3>
                        <div class="stat-grid">
                            <div>Lines: ${results.stats.lineCount}</div>
                            <div>Est. Time: ${this.formatTime(results.stats.estimatedTime)}</div>
                            <div>X: ${results.stats.boundingBox.min.x.toFixed(1)} to ${results.stats.boundingBox.max.x.toFixed(1)}</div>
                            <div>Y: ${results.stats.boundingBox.min.y.toFixed(1)} to ${results.stats.boundingBox.max.y.toFixed(1)}</div>
                            <div>Z: ${results.stats.boundingBox.min.z.toFixed(1)} to ${results.stats.boundingBox.max.z.toFixed(1)}</div>
                            <div>Max RPM: ${Math.max(...results.stats.spindleSpeeds, 0)}</div>
                        </div>
                    </div>
                    
                    <div class="preflight-actions">
                        ${results.passed ? 
                            '<button onclick="document.getElementById(\'preflight-modal\').remove(); app.startJob()" class="btn-start">▶ Start Job</button>' :
                            '<button onclick="document.getElementById(\'preflight-modal\').remove()" class="btn-fix">Fix Issues</button>'
                        }
                        <button onclick="document.getElementById('preflight-modal').remove()" class="btn-cancel">Cancel</button>
                    </div>
                </div>
            </div>
        `;
        
        // Add styles
        if (!document.getElementById('preflight-styles')) {
            const styles = document.createElement('style');
            styles.id = 'preflight-styles';
            styles.textContent = `
                .preflight-overlay {
                    position: fixed; top: 0; left: 0; right: 0; bottom: 0;
                    background: rgba(0,0,0,0.7); z-index: 9000;
                    display: flex; align-items: center; justify-content: center;
                }
                .preflight-modal {
                    background: #1a1a2e; border-radius: 10px; padding: 20px;
                    max-width: 600px; width: 90%; max-height: 80vh; overflow-y: auto;
                }
                .preflight-modal.passed { border: 2px solid #4CAF50; }
                .preflight-modal.failed { border: 2px solid #f44336; }
                .preflight-modal h2 { color: #fff; margin-top: 0; }
                .preflight-section { margin: 15px 0; }
                .preflight-section h3 { color: #aaa; margin-bottom: 8px; font-size: 0.9rem; }
                .preflight-section .item { 
                    padding: 5px 10px; background: rgba(255,255,255,0.05);
                    border-radius: 4px; margin: 3px 0; color: #ddd; font-size: 0.85rem;
                }
                .preflight-section.errors .item { border-left: 3px solid #f44336; }
                .preflight-section.warnings .item { border-left: 3px solid #ff9800; }
                .preflight-section.info .item { border-left: 3px solid #2196F3; }
                .stat-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; color: #aaa; }
                .preflight-actions { margin-top: 20px; display: flex; gap: 10px; }
                .btn-start { background: #4CAF50; color: white; border: none; padding: 10px 20px; border-radius: 5px; cursor: pointer; }
                .btn-fix { background: #ff9800; color: white; border: none; padding: 10px 20px; border-radius: 5px; cursor: pointer; }
                .btn-cancel { background: #666; color: white; border: none; padding: 10px 20px; border-radius: 5px; cursor: pointer; }
            `;
            document.head.appendChild(styles);
        }
        
        document.getElementById('preflight-modal')?.remove();
        document.body.appendChild(modal);
    }
    
    // ================================================================
    // ENVIRONMENTAL MONITORING
    // ================================================================
    
    /**
     * Update environmental data from ESP32 sensors
     */
    _updateEnvironmentFromESP(data) {
        const env = this.hardwareState.environment;
        
        if (data.ambientTemp !== undefined) {
            env.ambientTemp = data.ambientTemp;
            env.tempHistory.push(data.ambientTemp);
            if (env.tempHistory.length > 60) env.tempHistory.shift();
            
            // Check thresholds
            if (data.ambientTemp > this.safetyConfig.maxAmbientTemp) {
                this.speak('Warning: Shop temperature is high', 'normal');
            }
            if (data.ambientTemp < this.safetyConfig.minAmbientTemp) {
                this.speak('Warning: Shop temperature is low', 'normal');
            }
        }
        
        if (data.humidity !== undefined) {
            env.ambientHumidity = data.humidity;
            env.humidityHistory.push(data.humidity);
            if (env.humidityHistory.length > 60) env.humidityHistory.shift();
            
            if (data.humidity > this.safetyConfig.maxHumidity) {
                this.app?.showNotification?.('High humidity may affect precision', 'warning');
            }
        }
        
        // Fire/smoke detection
        if (data.smokeDetected !== undefined && data.smokeDetected) {
            if (!env.fireAlarm) {
                env.fireAlarm = true;
                this._executeEmergencyProcedure('FIRE');
                this._showEmergencyModal('FIRE');
            }
        } else {
            env.fireAlarm = false;
        }
        
        // Gas detection
        if (data.gasAlarm !== undefined) {
            env.gasAlarm = data.gasAlarm;
            if (data.gasAlarm) {
                this.speak('Gas alarm! Check for fumes.', 'high');
            }
        }
        
        env.lastEnvUpdate = Date.now();
    }
    
    /**
     * Check enclosure door status
     */
    _checkEnclosureStatus() {
        const enc = this.hardwareState.enclosure;
        
        // Get door status from grblHAL door pin
        if (this.hardwareState.grbl.state === 'Door') {
            if (!enc.doorOpen) {
                enc.doorOpen = true;
                enc.lastDoorEvent = Date.now();
                
                if (this.safetyConfig.pauseOnDoorOpen) {
                    // grblHAL already pauses on door - we just notify
                    if (this.features.voiceAlerts) {
                        this.speak('Enclosure door opened. Machine paused.', 'normal');
                    }
                }
            }
        } else {
            if (enc.doorOpen) {
                enc.doorOpen = false;
                enc.lastDoorEvent = Date.now();
            }
        }
    }
    
    /**
     * Check operator presence
     */
    _checkOperatorPresence() {
        const op = this.hardwareState.operator;
        
        // If PIR sensor data available from ESP32
        // This is updated in _updateFromChatter if PIR connected
        
        const timeSinceSeen = Date.now() - op.lastSeen;
        
        if (timeSinceSeen > op.awayTimeout) {
            if (op.present) {
                op.present = false;
                console.log('[SAFETY] Operator away detected');
                
                if (op.alertOnAway && this.features.voiceAlerts) {
                    this.speak('Operator away. Machine monitoring active.', 'normal');
                }
                
                if (op.pauseOnAway && this.hardwareState.grbl.state === 'Run') {
                    this.app?.grbl?.sendRealtime?.('!');  // Feed hold
                    this.speak('Job paused. Operator not detected.', 'high');
                }
            }
        }
    }
    
    // ================================================================
    // ACCESSORY CONTROL
    // ================================================================
    
    /**
     * Control dust collection system
     */
    _setDustCollection(enable) {
        const dc = this.hardwareState.dustCollection;
        
        if (!dc.connected) return;
        
        if (enable && !dc.running) {
            // Turn on dust collection
            // This could be via relay output, IoT switch, or Modbus
            this.app?.grbl?.send?.('M7');  // Or custom M-code
            dc.running = true;
            console.log('[ACCESSORY] Dust collection ON');
        } else if (!enable && dc.running) {
            // Delayed off (let dust settle)
            setTimeout(() => {
                this.app?.grbl?.send?.('M9');  // Or custom M-code
                dc.running = false;
                console.log('[ACCESSORY] Dust collection OFF');
            }, this.safetyConfig.dustAutoDelay * 1000);
        }
    }
    
    /**
     * Auto dust collection with spindle
     */
    _autoDustCollection() {
        const dc = this.hardwareState.dustCollection;
        if (!dc.autoMode || !dc.connected) return;
        
        const spindleRunning = this.hardwareState.grbl.spindleRPM > 0;
        
        if (spindleRunning && !dc.running) {
            this._setDustCollection(true);
        } else if (!spindleRunning && dc.running) {
            this._setDustCollection(false);
        }
    }
    
    /**
     * Control air blast
     */
    _triggerAirBlast(durationMs = 500) {
        const ab = this.hardwareState.airBlast;
        if (!ab.connected) return;
        
        // Trigger air blast pulse
        this.app?.grbl?.send?.('M8');  // Or custom M-code
        ab.lastBlastTime = Date.now();
        
        setTimeout(() => {
            this.app?.grbl?.send?.('M9');
        }, durationMs);
    }
    
    /**
     * Control vacuum table
     */
    setVacuumTable(enable, zones = null) {
        const vac = this.hardwareState.vacuum;
        if (!vac.connected) return;
        
        vac.enabled = enable;
        if (zones) vac.zones = zones;
        
        // Send command to vacuum controller
        // This would be via Modbus or GPIO
        console.log(`[ACCESSORY] Vacuum table ${enable ? 'ON' : 'OFF'}`);
    }
    
    /**
     * Auto lubrication cycle
     */
    _runLubeCycle() {
        const lube = this.hardwareState.lubrication;
        if (!lube.connected || !lube.autoMode) return;
        
        const timeSinceLube = Date.now() - lube.lastLubeTime;
        
        if (timeSinceLube > lube.lubeInterval * 1000) {
            // Trigger lube pump
            this.app?.grbl?.send?.('M8');  // Or custom M-code for lube
            lube.lastLubeTime = Date.now();
            lube.cycleCount++;
            
            setTimeout(() => {
                this.app?.grbl?.send?.('M9');
            }, 2000);  // 2 second pulse
            
            console.log(`[ACCESSORY] Auto-lube cycle #${lube.cycleCount}`);
        }
    }
    
    // ================================================================
    // TOOL MANAGEMENT
    // ================================================================
    
    /**
     * Probe tool length using tool setter
     */
    async probeToolLength() {
        const tool = this.hardwareState.tool;
        
        if (!tool.setterAvailable) {
            this.app?.showNotification?.('Tool setter not configured', 'warning');
            return null;
        }
        
        if (this.features.voiceAlerts) {
            this.speak('Probing tool length', 'normal');
        }
        
        try {
            // Move to tool setter XY position
            const pos = this.safetyConfig.toolSetterPos;
            await this._sendCommandAndWait(`G53 G0 X${pos.x} Y${pos.y}`);
            
            // Probe down
            await this._sendCommandAndWait(`G38.2 Z${pos.z} F${this.safetyConfig.toolProbeSpeed}`);
            
            // Get probed position
            const probeZ = this.app?.state?.probePos?.z || 0;
            tool.length = probeZ;
            tool.lastProbe = Date.now();
            
            // Retract
            await this._sendCommandAndWait(`G91 G0 Z${this.safetyConfig.toolProbeRetract}`);
            await this._sendCommandAndWait('G90');
            
            if (this.features.voiceAlerts) {
                this.speak(`Tool length: ${tool.length.toFixed(3)} millimeters`, 'normal');
            }
            
            return tool.length;
            
        } catch (err) {
            console.error('[TOOL] Probe failed:', err);
            this._handleGrblAlarm(4);  // Probe fail alarm
            return null;
        }
    }
    
    /**
     * Detect tool runout from vibration patterns
     */
    _detectToolRunout() {
        if (!this.features.toolRunoutDetection) return;
        
        const hw = this.hardwareState;
        const rpm = hw.grbl.spindleRPM || hw.vfd.rpm;
        
        if (rpm < 1000) return;  // Need spindle running
        
        // Tool runout causes vibration at 1x RPM frequency
        const runoutFreq = rpm / 60;  // Hz
        
        // Check if chatter frequency matches runout frequency
        if (hw.chatter.freq > 0) {
            const ratio = hw.chatter.freq / runoutFreq;
            
            // 1x or 2x runout frequency with high amplitude = runout
            if ((Math.abs(ratio - 1) < 0.1 || Math.abs(ratio - 2) < 0.1) && 
                hw.chatter.accel > 1.5) {
                
                hw.tool.runoutMm = hw.chatter.accel * 0.01;  // Rough estimate
                hw.tool.condition = 'worn';
                
                console.warn(`[TOOL] Runout detected: ~${hw.tool.runoutMm.toFixed(3)}mm`);
                
                if (this.features.voiceAlerts) {
                    this.speak('Tool runout detected. Check tool and collet.', 'high');
                }
            }
        }
    }
    
    /**
     * Detect broken tool from sudden load drop
     */
    _detectBrokenTool() {
        if (!this.features.brokenToolDetection) return;
        
        const hw = this.hardwareState;
        const vfd = hw.vfd;
        
        // If cutting and current suddenly drops to near-idle
        if (hw.grbl.state === 'Run' && vfd.ampsTrend < -2) {
            // Sudden current drop while supposedly cutting
            if (vfd.amps < 1 && hw.grbl.spindleRPM > 1000) {
                hw.tool.condition = 'broken';
                
                console.error('[TOOL] 🔴 BROKEN TOOL DETECTED!');
                
                // Emergency stop
                this._executeEmergencyProcedure('CRASH');
                
                if (this.features.voiceAlerts) {
                    this.speak('Broken tool detected! Machine stopped.', 'high');
                }
                
                // Show custom alert
                this.app?.showNotification?.('⚠️ Broken tool detected - inspect immediately', 'error');
            }
        }
    }
    
    // ================================================================
    // NETWORK & POWER RECOVERY
    // ================================================================
    
    /**
     * Setup WebSocket connection monitoring
     */
    setupNetworkMonitoring() {
        if (!this.features.networkRecovery) return;
        
        const net = this.hardwareState.network;
        
        // Monitor WebSocket state
        if (this.app?.ws) {
            const originalOnClose = this.app.ws.onclose;
            
            this.app.ws.onclose = (event) => {
                if (originalOnClose) originalOnClose(event);
                this._handleDisconnect(event);
            };
            
            const originalOnOpen = this.app.ws.onopen;
            this.app.ws.onopen = (event) => {
                if (originalOnOpen) originalOnOpen(event);
                this._handleReconnect(event);
            };
        }
    }
    
    /**
     * Handle WebSocket disconnect
     */
    _handleDisconnect(event) {
        const net = this.hardwareState.network;
        
        net.wsConnected = false;
        net.lastDisconnect = Date.now();
        net.wsReconnecting = true;
        
        console.warn('[NETWORK] WebSocket disconnected');
        
        // Save checkpoint if job running
        if (this.currentJob) {
            this._saveCheckpoint('disconnect');
            net.jobPausedOnDisconnect = true;
        }
        
        if (this.features.voiceAlerts) {
            this.speak('Connection lost. Attempting to reconnect.', 'high');
        }
        
        // Start reconnect attempts
        this._attemptReconnect();
    }
    
    /**
     * Attempt to reconnect WebSocket
     */
    _attemptReconnect() {
        const net = this.hardwareState.network;
        
        if (net.reconnectAttempts >= this.safetyConfig.maxReconnectAttempts) {
            console.error('[NETWORK] Max reconnect attempts reached');
            this._showEmergencyModal('DISCONNECT');
            return;
        }
        
        net.reconnectAttempts++;
        
        setTimeout(() => {
            if (!net.wsConnected) {
                console.log(`[NETWORK] Reconnect attempt ${net.reconnectAttempts}`);
                this.app?.connect?.();
            }
        }, this.safetyConfig.reconnectDelay);
    }
    
    /**
     * Handle successful reconnect
     */
    _handleReconnect(event) {
        const net = this.hardwareState.network;
        
        net.wsConnected = true;
        net.wsReconnecting = false;
        net.reconnectAttempts = 0;
        
        console.log('[NETWORK] ✓ Reconnected');
        
        if (this.features.voiceAlerts) {
            this.speak('Connection restored.', 'normal');
        }
        
        // If job was paused, offer to resume
        if (net.jobPausedOnDisconnect) {
            this.app?.showNotification?.('Connection restored. Resume job from checkpoint?', 'info');
        }
    }
    
    /**
     * Update UPS status from monitoring
     */
    _updateUPSStatus(data) {
        const net = this.hardwareState.network;
        
        if (data.upsConnected !== undefined) {
            net.upsConnected = data.upsConnected;
        }
        
        if (data.onBattery !== undefined) {
            if (data.onBattery && !net.upsOnBattery) {
                // Just switched to battery
                net.upsOnBattery = true;
                this._executeEmergencyProcedure('UPS_BATTERY');
                this._showEmergencyModal('UPS_BATTERY');
            }
            net.upsOnBattery = data.onBattery;
        }
        
        if (data.batteryPercent !== undefined) {
            net.upsBatteryPercent = data.batteryPercent;
        }
        
        if (data.runtimeMinutes !== undefined) {
            net.upsRuntimeMinutes = data.runtimeMinutes;
        }
    }
    
    // ================================================================
    // JOB CHECKPOINTING
    // ================================================================
    
    /**
     * Save job checkpoint for recovery
     */
    _saveCheckpoint(reason = 'periodic') {
        if (!this.features.jobCheckpointing || !this.currentJob) return;
        
        const checkpoint = {
            time: Date.now(),
            reason,
            job: {
                name: this.currentJob.name,
                startTime: this.currentJob.startTime
            },
            position: { ...this.hardwareState.grbl.pos },
            lineNumber: this.app?.state?.currentLine || 0,
            feedOverride: this.hardwareState.grbl.feedOverride,
            spindleRPM: this.hardwareState.grbl.spindleRPM,
            tool: this.hardwareState.tool.current,
            coolant: this.hardwareState.coolant.pumpRunning
        };
        
        this.checkpoints.push(checkpoint);
        
        // Trim old checkpoints
        while (this.checkpoints.length > this.safetyConfig.maxCheckpoints) {
            this.checkpoints.shift();
        }
        
        this.saveToStorage('jobCheckpoints', this.checkpoints);
        console.log(`[CHECKPOINT] Saved: ${reason} at line ${checkpoint.lineNumber}`);
    }
    
    /**
     * Recover from last checkpoint
     */
    recoverFromCheckpoint(checkpointIndex = -1) {
        const cp = checkpointIndex === -1 ? 
            this.checkpoints[this.checkpoints.length - 1] :
            this.checkpoints[checkpointIndex];
        
        if (!cp) {
            this.app?.showNotification?.('No checkpoint available', 'warning');
            return false;
        }
        
        console.log(`[RECOVERY] Recovering from checkpoint at line ${cp.lineNumber}`);
        
        if (this.features.voiceAlerts) {
            this.speak(`Recovering from line ${cp.lineNumber}`, 'normal');
        }
        
        // Set position
        // Note: This requires operator verification!
        this.app?.showNotification?.(
            `Recovery: Position X${cp.position.x.toFixed(3)} Y${cp.position.y.toFixed(3)} Z${cp.position.z.toFixed(3)}`,
            'info'
        );
        
        return true;
    }
    
    // ================================================================
    // SPINDLE WARMUP
    // ================================================================
    
    /**
     * Run automated spindle warmup cycle
     */
    async runSpindleWarmup() {
        if (!this.features.spindleWarmup) return;
        
        const spindle = this.hardwareState.spindle;
        
        if (spindle.state !== 'off') {
            this.app?.showNotification?.('Spindle already running', 'warning');
            return;
        }
        
        spindle.state = 'warmup';
        spindle.warmupProgress = 0;
        
        if (this.features.voiceAlerts) {
            this.speak('Starting spindle warmup cycle', 'normal');
        }
        
        console.log('[SPINDLE] Starting warmup cycle...');
        
        try {
            const stages = this.safetyConfig.warmupStages;
            const totalTime = stages.reduce((sum, s) => sum + s.duration, 0);
            let elapsed = 0;
            
            for (let i = 0; i < stages.length; i++) {
                const stage = stages[i];
                
                console.log(`[SPINDLE] Warmup stage ${i+1}/${stages.length}: ${stage.rpm} RPM for ${stage.duration}s`);
                
                // Set spindle speed
                this.app?.grbl?.send?.(`M3 S${stage.rpm}`);
                
                // Wait for duration
                await this._sleep(stage.duration * 1000);
                
                elapsed += stage.duration;
                spindle.warmupProgress = Math.round((elapsed / totalTime) * 100);
                
                // Update UI
                this._updateSpindleUI();
            }
            
            // Warmup complete
            this.app?.grbl?.send?.('M5');  // Stop spindle
            
            spindle.state = 'ready';
            spindle.needsWarmup = false;
            spindle.warmupProgress = 100;
            
            if (this.features.voiceAlerts) {
                this.speak('Spindle warmup complete. Ready to cut.', 'normal');
            }
            
            console.log('[SPINDLE] ✓ Warmup complete');
            
        } catch (err) {
            console.error('[SPINDLE] Warmup error:', err);
            spindle.state = 'off';
            this.app?.grbl?.send?.('M5');
        }
    }
    
    /**
     * Check if spindle needs warmup
     */
    _checkSpindleWarmup() {
        const spindle = this.hardwareState.spindle;
        
        // Check hours since last run
        const hoursSinceRun = (Date.now() - this.maintenance.lastMaintenance) / 3600000;
        
        if (hoursSinceRun > this.safetyConfig.warmupCooldownHours) {
            spindle.needsWarmup = true;
        }
    }
    
    /**
     * Monitor spindle bearing health via audio
     */
    _monitorSpindleBearings() {
        if (!this.features.spindleBearingHealth) return;
        
        const spindle = this.hardwareState.spindle;
        const hw = this.hardwareState;
        
        // Need spindle running at consistent speed
        const rpm = hw.grbl.spindleRPM || hw.vfd.rpm;
        if (rpm < 5000) return;
        
        // Bearing defect frequencies (BPFO, BPFI, BSF, FTF)
        // These depend on bearing geometry - using typical ratios
        const rotFreq = rpm / 60;  // Rotation frequency
        
        // High frequency noise = bearing wear
        if (hw.chatter.freq > rotFreq * 5 && hw.chatter.accel > 0.5) {
            spindle.bearingNoiseLevel = hw.chatter.accel;
            
            // Degrade health score
            if (spindle.bearingNoiseLevel > 1.5) {
                spindle.bearingHealth = Math.max(0, spindle.bearingHealth - 0.1);
                
                if (spindle.bearingHealth < 50) {
                    console.warn('[SPINDLE] ⚠️ Bearing health degraded');
                    this.maintenance.alerts.push({
                        type: 'warning',
                        component: 'Spindle Bearings',
                        message: `Bearing health: ${spindle.bearingHealth.toFixed(0)}%`,
                        action: 'Schedule bearing inspection'
                    });
                }
            }
        }
    }
    
    // ================================================================
    // HELPER METHODS
    // ================================================================
    
    _sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
    
    _sendCommandAndWait(cmd) {
        return new Promise((resolve, reject) => {
            this.app?.grbl?.send?.(cmd);
            // Simple timeout-based wait - in production would check for 'ok'
            setTimeout(resolve, 500);
        });
    }
    
    _updateSpindleUI() {
        const spindle = this.hardwareState.spindle;
        const el = document.getElementById('spindle-warmup-progress');
        if (el) {
            el.style.width = `${spindle.warmupProgress}%`;
            el.textContent = `${spindle.warmupProgress}%`;
        }
    }
    
    _initWeights(inputSize, outputSize) {
        // Xavier initialization
        const scale = Math.sqrt(2.0 / (inputSize + outputSize));
        const weights = [];
        for (let i = 0; i < inputSize; i++) {
            weights[i] = [];
            for (let j = 0; j < outputSize; j++) {
                weights[i][j] = (Math.random() - 0.5) * 2 * scale;
            }
        }
        return weights;
    }
    
    /**
     * Run inference through neural network
     * @param {number[]} inputs - [audio, accel, current, rpm, feed, depth, material_idx]
     * @returns {Object} - { quality, chatterRisk, toolWearRate }
     */
    predict(inputs) {
        // Safety: validate inputs array
        if (!Array.isArray(inputs) || inputs.length < 7) {
            console.warn('[ML] Invalid inputs to predict(), using defaults');
            return { quality: 50, chatterRisk: 0, toolWearRate: 1 };
        }
        
        // Safety: ensure weights are valid
        if (!this.neuralNet?.weightsL1 || !this.neuralNet?.weightsL2) {
            console.warn('[ML] Neural network weights not initialized');
            return { quality: 50, chatterRisk: 0, toolWearRate: 1 };
        }
        
        // Normalize inputs
        const normalized = this._normalizeInputs(inputs);
        
        // Layer 1: input -> hidden (ReLU activation)
        const hidden = new Array(12).fill(0);
        for (let j = 0; j < 12; j++) {
            let sum = this.neuralNet.biasL1[j];
            for (let i = 0; i < 7; i++) {
                sum += normalized[i] * this.neuralNet.weightsL1[i][j];
            }
            hidden[j] = Math.max(0, sum);  // ReLU
        }
        
        // Layer 2: hidden -> output (sigmoid activation)
        const output = new Array(3).fill(0);
        for (let j = 0; j < 3; j++) {
            let sum = this.neuralNet.biasL2[j];
            for (let i = 0; i < 12; i++) {
                sum += hidden[i] * this.neuralNet.weightsL2[i][j];
            }
            output[j] = 1 / (1 + Math.exp(-sum));  // Sigmoid
        }
        
        return {
            quality: output[0] * 100,
            chatterRisk: output[1] * 100,
            toolWearRate: output[2] * 10  // 0-10 wear rate multiplier
        };
    }
    
    _normalizeInputs(inputs) {
        // Normalize to 0-1 range based on expected ranges
        const ranges = [
            [0, 1],      // audio: 0-1
            [0, 5],      // accel: 0-5g
            [0, 20],     // current: 0-20A
            [0, 24000],  // rpm: 0-24000
            [0, 5000],   // feed: 0-5000 mm/min
            [0, 10],     // depth: 0-10mm
            [0, 12]      // material_idx: 0-12
        ];
        
        return inputs.map((val, i) => {
            const [min, max] = ranges[i] || [0, 1];
            const range = max - min;
            // Safety: prevent division by zero and handle invalid inputs
            if (range === 0 || !Number.isFinite(val)) return 0;
            return Math.max(0, Math.min(1, (val - min) / range));
        });
    }
    
    /**
     * Learn from a cutting result (online learning)
     * @param {Object} data - { inputs, actualQuality, hadChatter, toolWore }
     */
    learnFromCut(data) {
        const { inputs, actualQuality, hadChatter, toolWore } = data;
        
        // Add to training buffer
        this.trainingBuffer.push({
            inputs,
            targets: [actualQuality / 100, hadChatter ? 1 : 0, toolWore / 10]
        });
        
        // Trim buffer
        while (this.trainingBuffer.length > this.maxTrainingBuffer) {
            this.trainingBuffer.shift();
        }
        
        // Online learning - update weights with this sample
        this._backpropagate(inputs, [actualQuality / 100, hadChatter ? 1 : 0, toolWore / 10]);
        
        this.neuralNet.trainingEpochs++;
        if (this.neuralNet.trainingEpochs >= 100) {
            this.neuralNet.trained = true;
        }
        
        // Save periodically
        if (this.neuralNet.trainingEpochs % 50 === 0) {
            this.saveToStorage('neuralNet', this.neuralNet);
            console.log(`[ML] Training epoch ${this.neuralNet.trainingEpochs} - weights saved`);
        }
    }
    
    _backpropagate(inputs, targets) {
        const normalized = this._normalizeInputs(inputs);
        
        // Forward pass (store activations)
        const hidden = new Array(12).fill(0);
        const hiddenRaw = new Array(12).fill(0);
        for (let j = 0; j < 12; j++) {
            let sum = this.neuralNet.biasL1[j];
            for (let i = 0; i < 7; i++) {
                sum += normalized[i] * this.neuralNet.weightsL1[i][j];
            }
            hiddenRaw[j] = sum;
            hidden[j] = Math.max(0, sum);  // ReLU
        }
        
        const output = new Array(3).fill(0);
        for (let j = 0; j < 3; j++) {
            let sum = this.neuralNet.biasL2[j];
            for (let i = 0; i < 12; i++) {
                sum += hidden[i] * this.neuralNet.weightsL2[i][j];
            }
            output[j] = 1 / (1 + Math.exp(-sum));  // Sigmoid
        }
        
        // Backward pass
        // Output layer gradients
        const outputDeltas = new Array(3).fill(0);
        for (let j = 0; j < 3; j++) {
            const error = targets[j] - output[j];
            outputDeltas[j] = error * output[j] * (1 - output[j]);  // Sigmoid derivative
        }
        
        // Hidden layer gradients
        const hiddenDeltas = new Array(12).fill(0);
        for (let i = 0; i < 12; i++) {
            let sum = 0;
            for (let j = 0; j < 3; j++) {
                sum += outputDeltas[j] * this.neuralNet.weightsL2[i][j];
            }
            hiddenDeltas[i] = sum * (hiddenRaw[i] > 0 ? 1 : 0);  // ReLU derivative
        }
        
        // Update weights L2
        for (let i = 0; i < 12; i++) {
            for (let j = 0; j < 3; j++) {
                this.neuralNet.weightsL2[i][j] += this.learningRate * outputDeltas[j] * hidden[i];
            }
        }
        for (let j = 0; j < 3; j++) {
            this.neuralNet.biasL2[j] += this.learningRate * outputDeltas[j];
        }
        
        // Update weights L1
        for (let i = 0; i < 7; i++) {
            for (let j = 0; j < 12; j++) {
                this.neuralNet.weightsL1[i][j] += this.learningRate * hiddenDeltas[j] * normalized[i];
            }
        }
        for (let j = 0; j < 12; j++) {
            this.neuralNet.biasL1[j] += this.learningRate * hiddenDeltas[j];
        }
    }
    
    // ================================================================
    // MACHINE LEARNING INITIALIZATION
    // ================================================================
    
    setupMachineLearning() {
        // Training buffer for online learning
        this.trainingBuffer = [];
        this.maxTrainingBuffer = 1000;  // Max samples to keep
        
        // Learning rate for backpropagation
        this.learningRate = 0.01;
        
        // Track last alarm state for change detection
        this.lastAlarmState = null;
        this.lastAlarmCode = null;
        
        console.log('[ML] ✓ Machine learning system initialized');
    }
    
    // ================================================================
    // ANOMALY DETECTION
    // ================================================================
    
    setupAnomalyDetection() {
        // Statistical baseline for anomaly detection
        this.anomalyBaseline = {
            vibration: { mean: 0, std: 0, samples: [] },
            current: { mean: 0, std: 0, samples: [] },
            audio: { mean: 0, std: 0, samples: [] },
            temperature: { mean: 0, std: 0, samples: [] }
        };
        
        // Anomaly history for pattern matching
        this.anomalyHistory = [];
    }
    
    /**
     * Check for anomalies in sensor data
     * @param {Object} sensorData - { vibration, current, audio, temperature }
     * @returns {Object} - { isAnomaly, score, type, description }
     */
    detectAnomaly(sensorData) {
        const anomalies = [];
        let totalScore = 0;
        
        for (const [key, value] of Object.entries(sensorData)) {
            // Safety: skip invalid values
            if (!Number.isFinite(value)) continue;
            
            if (this.anomalyBaseline[key] && this.anomalyBaseline[key].std > 0) {
                const baseline = this.anomalyBaseline[key];
                const zScore = Math.abs((value - baseline.mean) / baseline.std);
                
                // Safety: skip if zScore is invalid
                if (!Number.isFinite(zScore)) continue;
                
                if (zScore > 3) {
                    anomalies.push({
                        type: key,
                        zScore,
                        value,
                        expected: baseline.mean,
                        severity: zScore > 5 ? 'critical' : 'warning'
                    });
                    totalScore += zScore * 10;
                }
            }
            
            // Update baseline (exponential moving average)
            this._updateBaseline(key, value);
        }
        
        // Pattern matching against known bad patterns
        const patternMatch = this._matchPatterns(sensorData);
        if (patternMatch) {
            anomalies.push(patternMatch);
            totalScore += patternMatch.confidence;
        }
        
        this.intelligence.anomalyScore = Math.min(100, totalScore);
        this.intelligence.anomalyType = anomalies.length > 0 ? anomalies[0].type : null;
        
        return {
            isAnomaly: totalScore > 30,
            score: Math.min(100, totalScore),
            anomalies,
            recommendation: this._getAnomalyRecommendation(anomalies)
        };
    }
    
    _updateBaseline(key, value) {
        const baseline = this.anomalyBaseline[key];
        if (!baseline) return;
        
        baseline.samples.push(value);
        if (baseline.samples.length > 100) {
            baseline.samples.shift();
        }
        
        if (baseline.samples.length >= 20) {
            const mean = baseline.samples.reduce((a, b) => a + b, 0) / baseline.samples.length;
            const variance = baseline.samples.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / baseline.samples.length;
            baseline.mean = mean;
            baseline.std = Math.sqrt(variance);
        }
    }
    
    _matchPatterns(sensorData) {
        // Check against learned bad patterns
        const patterns = this.learningDB.patterns.bad;
        
        for (const pattern of patterns) {
            let matchScore = 0;
            let checks = 0;
            
            for (const [key, range] of Object.entries(pattern.conditions)) {
                if (sensorData[key] !== undefined) {
                    if (sensorData[key] >= range.min && sensorData[key] <= range.max) {
                        matchScore++;
                    }
                    checks++;
                }
            }
            
            if (checks > 0 && matchScore / checks > 0.7) {
                return {
                    type: 'pattern_match',
                    patternName: pattern.name,
                    confidence: (matchScore / checks) * 100,
                    severity: pattern.severity,
                    action: pattern.recommendedAction
                };
            }
        }
        
        return null;
    }
    
    _getAnomalyRecommendation(anomalies) {
        if (anomalies.length === 0) return null;
        
        const primaryAnomaly = anomalies[0];
        
        const recommendations = {
            vibration: 'Check tool condition, reduce DOC, or adjust RPM to avoid resonance',
            current: 'Reduce feed rate or depth of cut - spindle may be overloaded',
            audio: 'Possible chatter or tool wear - inspect cutting edge',
            temperature: 'Allow machine to cool or check coolant system',
            pattern_match: primaryAnomaly.action
        };
        
        return recommendations[primaryAnomaly.type] || 'Inspect machine and cutting conditions';
    }
    
    /**
     * Learn a bad pattern from a failure event
     */
    learnBadPattern(name, conditions, severity, recommendedAction) {
        this.learningDB.patterns.bad.push({
            name,
            conditions,  // { vibration: {min, max}, current: {min, max}, ... }
            severity,
            recommendedAction,
            occurrences: 1,
            lastSeen: Date.now()
        });
        
        this.saveToStorage('learningDB', this.learningDB);
        console.log(`[ML] Learned bad pattern: ${name}`);
    }
    
    // ================================================================
    // THERMAL COMPENSATION
    // ================================================================
    
    setupThermalCompensation() {
        this.thermal = {
            enabled: true,
            currentTemp: 20,  // Ambient default
            referenceTemp: 20,
            warmupStarted: null,
            isWarmedUp: false,
            // Compensation factors (μm per degree C)
            compensation: {
                x: this.learningDB.thermalModel.compensationFactors.x || 0,
                y: this.learningDB.thermalModel.compensationFactors.y || 0,
                z: this.learningDB.thermalModel.compensationFactors.z || 0
            },
            // Thermal drift history for learning
            driftHistory: []
        };
    }
    
    /**
     * Update thermal state and calculate compensation
     * @param {number} temperature - Current machine/spindle temperature in C
     * @param {Object} position - Current position for drift tracking
     */
    updateThermalCompensation(temperature, position) {
        // Safety: validate temperature input
        if (!Number.isFinite(temperature) || temperature < -40 || temperature > 100) {
            return { x: 0, y: 0, z: 0 };  // Return zero compensation for invalid temp
        }
        
        const delta = temperature - this.thermal.referenceTemp;
        this.thermal.currentTemp = temperature;
        
        // Track warmup
        if (!this.thermal.isWarmedUp) {
            if (!this.thermal.warmupStarted && temperature > this.thermal.referenceTemp + 2) {
                this.thermal.warmupStarted = Date.now();
            }
            if (this.thermal.warmupStarted && temperature > this.thermal.referenceTemp + 5) {
                const warmupTime = (Date.now() - this.thermal.warmupStarted) / 60000;
                this.learningDB.thermalModel.warmupTime = warmupTime;
                this.thermal.isWarmedUp = true;
                console.log(`[Thermal] Warmup complete in ${warmupTime.toFixed(1)} minutes`);
            }
        }
        
        // Calculate compensation
        const compensation = {
            x: -delta * this.thermal.compensation.x / 1000,  // Convert μm to mm
            y: -delta * this.thermal.compensation.y / 1000,
            z: -delta * this.thermal.compensation.z / 1000
        };
        
        return compensation;
    }
    
    /**
     * Learn thermal drift from probing at different temperatures
     */
    learnThermalDrift(temperature, measuredDrift) {
        this.thermal.driftHistory.push({
            temp: temperature,
            drift: measuredDrift,  // { x, y, z } in mm
            time: Date.now()
        });
        
        // Calculate compensation factors if we have enough data
        if (this.thermal.driftHistory.length >= 5) {
            for (const axis of ['x', 'y', 'z']) {
                const points = this.thermal.driftHistory.map(h => ({
                    temp: h.temp - this.thermal.referenceTemp,
                    drift: h.drift[axis] * 1000  // Convert to μm
                }));
                
                // Simple linear regression
                const n = points.length;
                const sumX = points.reduce((s, p) => s + p.temp, 0);
                const sumY = points.reduce((s, p) => s + p.drift, 0);
                const sumXY = points.reduce((s, p) => s + p.temp * p.drift, 0);
                const sumXX = points.reduce((s, p) => s + p.temp * p.temp, 0);
                
                const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
                
                if (Number.isFinite(slope)) {
                    this.thermal.compensation[axis] = slope;
                    this.learningDB.thermalModel.compensationFactors[axis] = slope;
                }
            }
            
            this.saveToStorage('learningDB', this.learningDB);
            console.log('[Thermal] Updated compensation factors:', this.thermal.compensation);
        }
    }
    
    // ================================================================
    // SMART PARAMETER OPTIMIZATION
    // ================================================================
    
    /**
     * Get AI-optimized cutting parameters based on learned data
     * @param {string} material - Material type
     * @param {number} toolDiameter - Tool diameter in mm
     * @param {string} priority - 'speed', 'quality', 'tool_life', 'balanced'
     */
    getOptimizedParameters(material, toolDiameter, priority = 'balanced') {
        // Start with database defaults
        const defaults = this.calculateFeedsAndSpeeds(material, toolDiameter);
        if (!defaults) return null;
        
        // Look for learned data for this material/tool combo
        const key = `${material}_${toolDiameter.toFixed(1)}`;
        const learned = this.learningDB.optimizationData.bestPractices[key];
        
        if (learned && learned.samples >= 10) {
            // Use learned parameters
            const params = { ...defaults };
            
            switch (priority) {
                case 'speed':
                    params.rpm = Math.round(learned.maxSuccessfulRpm * 0.95);
                    params.feedRate = Math.round(learned.maxSuccessfulFeed * 0.9);
                    break;
                case 'quality':
                    params.rpm = Math.round(learned.bestQualityRpm);
                    params.feedRate = Math.round(learned.bestQualityFeed);
                    break;
                case 'tool_life':
                    params.rpm = Math.round(learned.avgRpm * 0.8);
                    params.feedRate = Math.round(learned.avgFeed * 0.7);
                    break;
                default:  // balanced
                    params.rpm = Math.round(learned.avgRpm);
                    params.feedRate = Math.round(learned.avgFeed);
            }
            
            params.learned = true;
            params.confidence = Math.min(100, learned.samples);
            params.notes = `AI-optimized from ${learned.samples} cuts. ${learned.notes || ''}`;
            
            return params;
        }
        
        // No learned data - use neural network prediction
        if (this.neuralNet.trained) {
            const materialIdx = Object.keys(this.materials).indexOf(material);
            const prediction = this.predict([
                0.3,  // target audio level
                1.0,  // target accel
                5,    // target current
                defaults.rpm,
                defaults.feedRate,
                2,    // typical depth
                materialIdx
            ]);
            
            // Adjust based on prediction
            if (prediction.chatterRisk > 50) {
                defaults.rpm = Math.round(defaults.rpm * 0.9);
                defaults.feedRate = Math.round(defaults.feedRate * 0.85);
                defaults.notes += ' [AI: Reduced for chatter risk]';
            }
            
            defaults.aiPrediction = prediction;
        }
        
        return defaults;
    }
    
    /**
     * Record cutting results for learning
     */
    recordCuttingResult(material, toolDiameter, params, result) {
        // result: { quality: 0-100, hadChatter: bool, toolWearPercent: 0-100, success: bool }
        
        const key = `${material}_${toolDiameter.toFixed(1)}`;
        
        if (!this.learningDB.optimizationData.bestPractices[key]) {
            this.learningDB.optimizationData.bestPractices[key] = {
                samples: 0,
                avgRpm: params.rpm,
                avgFeed: params.feedRate,
                maxSuccessfulRpm: params.rpm,
                maxSuccessfulFeed: params.feedRate,
                bestQualityRpm: params.rpm,
                bestQualityFeed: params.feedRate,
                bestQuality: 0,
                notes: ''
            };
        }
        
        const data = this.learningDB.optimizationData.bestPractices[key];
        data.samples++;
        
        // Update averages
        data.avgRpm = (data.avgRpm * (data.samples - 1) + params.rpm) / data.samples;
        data.avgFeed = (data.avgFeed * (data.samples - 1) + params.feedRate) / data.samples;
        
        // Update max successful
        if (result.success && !result.hadChatter) {
            if (params.rpm > data.maxSuccessfulRpm) data.maxSuccessfulRpm = params.rpm;
            if (params.feedRate > data.maxSuccessfulFeed) data.maxSuccessfulFeed = params.feedRate;
        }
        
        // Update best quality
        if (result.quality > data.bestQuality) {
            data.bestQuality = result.quality;
            data.bestQualityRpm = params.rpm;
            data.bestQualityFeed = params.feedRate;
        }
        
        // Train neural network
        const materialIdx = Object.keys(this.materials).indexOf(material);
        this.learnFromCut({
            inputs: [0, 0, params.current || 5, params.rpm, params.feedRate, params.depth || 2, materialIdx],
            actualQuality: result.quality,
            hadChatter: result.hadChatter,
            toolWore: result.toolWearPercent || 0
        });
        
        this.saveToStorage('learningDB', this.learningDB);
    }
    
    // ================================================================
    // PREDICTIVE ISSUE DETECTION
    // ================================================================
    
    /**
     * Predict upcoming issues based on current trends
     * @param {Object} currentState - Current sensor/machine state
     * @returns {Object|null} - Predicted issue or null
     */
    predictIssues(currentState) {
        const predictions = [];
        
        // 1. Chatter prediction based on trend
        if (currentState.audioTrend > 0.02) {
            const timeToChatter = (0.7 - currentState.audio) / currentState.audioTrend;
            if (timeToChatter > 0 && timeToChatter < 60) {
                predictions.push({
                    issue: 'chatter',
                    confidence: Math.min(90, 50 + currentState.audioTrend * 1000),
                    timeToEvent: timeToChatter,
                    recommendation: 'Reduce feed rate or RPM now'
                });
            }
        }
        
        // 2. Tool breakage prediction
        const prediction = this.predict([
            currentState.audio || 0,
            currentState.accel || 0,
            currentState.current || 0,
            currentState.rpm || 10000,
            currentState.feed || 1000,
            currentState.depth || 1,
            currentState.materialIdx || 0
        ]);
        
        if (prediction.toolWearRate > 5) {
            predictions.push({
                issue: 'tool_wear',
                confidence: prediction.toolWearRate * 10,
                timeToEvent: 300 / prediction.toolWearRate,  // Rough estimate
                recommendation: 'Consider tool change soon'
            });
        }
        
        // 3. Spindle overload prediction
        if (currentState.currentTrend > 0.1) {
            const timeToOverload = (15 - currentState.current) / currentState.currentTrend;
            if (timeToOverload > 0 && timeToOverload < 120) {
                predictions.push({
                    issue: 'overload',
                    confidence: 70,
                    timeToEvent: timeToOverload,
                    recommendation: 'Reduce depth of cut or feed rate'
                });
            }
        }
        
        // 4. Machine health degradation
        if (this.maintenance.degradationRate > 0.5) {
            predictions.push({
                issue: 'maintenance_needed',
                confidence: this.maintenance.degradationRate * 20,
                timeToEvent: (100 - this.maintenance.healthScore) / this.maintenance.degradationRate * 60,
                recommendation: 'Schedule maintenance soon'
            });
        }
        
        // Sort by urgency
        predictions.sort((a, b) => a.timeToEvent - b.timeToEvent);
        
        if (predictions.length > 0) {
            this.intelligence.predictedIssue = predictions[0].issue;
            this.intelligence.issueConfidence = predictions[0].confidence;
            this.intelligence.issueTimeToEvent = predictions[0].timeToEvent;
            return predictions[0];
        }
        
        return null;
    }
    
    // ================================================================
    // MACHINE PERSONALITY LEARNING
    // ================================================================
    
    /**
     * Learn machine resonant frequencies to avoid
     */
    learnResonance(frequency, severity) {
        const resonances = this.learningDB.machineProfile.resonantFreqs;
        
        // Check if we already know this one
        const existing = resonances.find(r => Math.abs(r.freq - frequency) < 50);
        if (existing) {
            existing.occurrences++;
            existing.severity = Math.max(existing.severity, severity);
        } else {
            resonances.push({
                freq: frequency,
                severity,
                occurrences: 1
            });
        }
        
        this.saveToStorage('learningDB', this.learningDB);
    }
    
    /**
     * Get RPM suggestions that avoid resonances
     */
    getSafeRpmRange(baseRpm, flutes = 2) {
        const resonances = this.learningDB.machineProfile.resonantFreqs;
        const toothFreq = (baseRpm / 60) * flutes;
        
        // Check if any resonance is close to tooth frequency or harmonics
        const badRpms = [];
        
        for (const res of resonances) {
            for (let harmonic = 1; harmonic <= 5; harmonic++) {
                // If tooth frequency harmonic hits resonance
                if (Math.abs(toothFreq * harmonic - res.freq) < 50) {
                    badRpms.push(baseRpm);
                }
                // Calculate RPM that would hit resonance
                const badRpm = (res.freq / harmonic) * 60 / flutes;
                if (Math.abs(badRpm - baseRpm) < baseRpm * 0.2) {
                    badRpms.push(Math.round(badRpm));
                }
            }
        }
        
        if (badRpms.length === 0) {
            return { safe: true, rpm: baseRpm, alternatives: [] };
        }
        
        // Suggest alternatives
        const alternatives = [
            Math.round(baseRpm * 0.85),
            Math.round(baseRpm * 1.15),
            Math.round(baseRpm * 0.7),
            Math.round(baseRpm * 1.3)
        ].filter(rpm => !badRpms.includes(rpm) && rpm > 1000 && rpm < 24000);
        
        return {
            safe: false,
            rpm: alternatives[0] || baseRpm,
            avoid: badRpms,
            alternatives,
            reason: `${baseRpm} RPM may cause resonance at learned frequencies`
        };
    }
    
    // ================================================================
    // REAL-TIME INTELLIGENCE INTEGRATION
    // ================================================================
    
    /**
     * Main intelligence update - call this every sensor update cycle
     * Integrates all learning systems for real-time decision making
     */
    updateIntelligence(sensorData) {
        // sensorData: { audio, accel, current, rpm, feed, depth, temperature, position }
        
        // 1. Run anomaly detection
        const anomalyResult = this.detectAnomaly({
            vibration: sensorData.accel || 0,
            current: sensorData.current || 0,
            audio: sensorData.audio || 0,
            temperature: sensorData.temperature || 25
        });
        
        // 2. Get neural network prediction
        const materialIdx = Object.keys(this.materials).indexOf(sensorData.material || 'aluminum_6061');
        const prediction = this.predict([
            sensorData.audio || 0,
            sensorData.accel || 0,
            sensorData.current || 0,
            sensorData.rpm || 10000,
            sensorData.feed || 1000,
            sensorData.depth || 1,
            materialIdx >= 0 ? materialIdx : 0
        ]);
        
        // 3. Update intelligence state
        this.intelligence.currentCut = {
            quality: prediction.quality,
            efficiency: this._calculateEfficiency(sensorData),
            stability: 100 - prediction.chatterRisk,
            toolWearRate: prediction.toolWearRate
        };
        
        // 4. Predict issues
        const currentState = {
            audio: sensorData.audio || 0,
            audioTrend: sensorData.audioTrend || 0,
            accel: sensorData.accel || 0,
            current: sensorData.current || 0,
            currentTrend: sensorData.currentTrend || 0,
            rpm: sensorData.rpm || 10000,
            feed: sensorData.feed || 1000,
            depth: sensorData.depth || 1,
            materialIdx
        };
        
        const predictedIssue = this.predictIssues(currentState);
        
        // 5. Generate recommendations
        this.intelligence.currentCut.recommendation = this._generateRecommendation(
            anomalyResult,
            prediction,
            predictedIssue
        );
        
        // 6. Update adaptive feed if enabled
        if (this.adaptiveFeed.enabled) {
            this.updateAdaptiveFeed(sensorData.current * 10, sensorData.audio);
        }
        
        // 7. Thermal compensation
        if (this.thermal.enabled && sensorData.temperature) {
            const compensation = this.updateThermalCompensation(
                sensorData.temperature,
                sensorData.position
            );
            this.intelligence.thermalCompensation = compensation;
        }
        
        return {
            quality: this.intelligence.currentCut.quality,
            stability: this.intelligence.currentCut.stability,
            recommendation: this.intelligence.currentCut.recommendation,
            anomaly: anomalyResult.isAnomaly ? anomalyResult : null,
            prediction: predictedIssue,
            thermalComp: this.intelligence.thermalCompensation
        };
    }
    
    _calculateEfficiency(sensorData) {
        // Compare actual vs expected material removal rate
        const expectedMrr = (sensorData.feed || 1000) * (sensorData.depth || 1) * 0.5;
        const actualMrr = (sensorData.current || 1) * 100;  // Rough estimate from current
        return Math.min(100, (actualMrr / expectedMrr) * 100);
    }
    
    _generateRecommendation(anomaly, prediction, predictedIssue) {
        const recommendations = [];
        
        // Critical issues first
        if (predictedIssue && predictedIssue.confidence > 70) {
            recommendations.push({
                priority: 'critical',
                icon: '🚨',
                text: predictedIssue.recommendation,
                timeframe: `${Math.round(predictedIssue.timeToEvent)}s`
            });
        }
        
        // Anomaly recommendations
        if (anomaly.isAnomaly && anomaly.recommendation) {
            recommendations.push({
                priority: 'warning',
                icon: '⚠️',
                text: anomaly.recommendation
            });
        }
        
        // Quality optimization
        if (prediction.quality < 70) {
            recommendations.push({
                priority: 'info',
                icon: '📊',
                text: 'Reduce feed rate 10-15% for better surface finish'
            });
        }
        
        // Chatter prevention
        if (prediction.chatterRisk > 60) {
            recommendations.push({
                priority: 'warning',
                icon: '📳',
                text: 'Chatter risk high - consider RPM adjustment'
            });
        }
        
        // Tool wear
        if (prediction.toolWearRate > 3) {
            recommendations.push({
                priority: 'info',
                icon: '🔧',
                text: 'High tool wear rate - check cutting parameters'
            });
        }
        
        return recommendations.length > 0 ? recommendations[0] : null;
    }
    
    /**
     * Get complete intelligence status for UI
     */
    getIntelligenceStatus() {
        return {
            // Current assessment
            quality: Math.round(this.intelligence.currentCut.quality),
            efficiency: Math.round(this.intelligence.currentCut.efficiency),
            stability: Math.round(this.intelligence.currentCut.stability),
            
            // Health
            machineHealth: Math.round(this.maintenance.healthScore),
            
            // Anomaly
            anomalyScore: Math.round(this.intelligence.anomalyScore || 0),
            anomalyType: this.intelligence.anomalyType,
            
            // Prediction
            predictedIssue: this.intelligence.predictedIssue,
            issueConfidence: Math.round(this.intelligence.issueConfidence || 0),
            timeToIssue: Math.round(this.intelligence.issueTimeToEvent || 0),
            
            // Learning
            neuralNetTrained: this.neuralNet.trained,
            trainingEpochs: this.neuralNet.trainingEpochs,
            learnedPatterns: this.learningDB.patterns.bad.length,
            learnedResonances: this.learningDB.machineProfile.resonantFreqs.length,
            
            // Thermal
            thermalCompensation: this.intelligence.thermalCompensation,
            machineTemp: this.thermal.currentTemp,
            isWarmedUp: this.thermal.isWarmedUp,
            
            // Recommendation
            recommendation: this.intelligence.currentCut.recommendation
        };
    }
    
    /**
     * Export learned data for backup/sharing
     */
    exportLearningData() {
        return {
            version: '1.0',
            exportDate: Date.now(),
            neuralNet: this.neuralNet,
            learningDB: this.learningDB,
            maintenance: this.maintenance,
            toolLife: this.toolLife
        };
    }
    
    /**
     * Import learned data from backup
     */
    importLearningData(data) {
        if (data.version !== '1.0') {
            console.error('[ML] Incompatible learning data version');
            return false;
        }
        
        this.neuralNet = data.neuralNet;
        this.learningDB = data.learningDB;
        this.maintenance = { ...this.maintenance, ...data.maintenance };
        this.toolLife = data.toolLife;
        
        this.saveToStorage('neuralNet', this.neuralNet);
        this.saveToStorage('learningDB', this.learningDB);
        this.saveToStorage('toolLife', this.toolLife);
        
        console.log('[ML] Imported learning data successfully');
        return true;
    }
    
    /**
     * Reset all learning (fresh start)
     */
    resetLearning() {
        this.neuralNet = {
            weightsL1: this._initWeights(7, 12),
            weightsL2: this._initWeights(12, 3),
            biasL1: new Array(12).fill(0),
            biasL2: new Array(3).fill(0),
            trained: false,
            trainingEpochs: 0
        };
        
        this.learningDB = {
            cuttingRecords: [],
            patterns: { good: [], bad: [], chatter: [] },
            machineProfile: {
                resonantFreqs: [],
                sweetSpotRpms: [],
                axisCharacteristics: {
                    x: { backlash: 0, stiffness: 1.0, maxJerk: 1000 },
                    y: { backlash: 0, stiffness: 1.0, maxJerk: 1000 },
                    z: { backlash: 0, stiffness: 1.0, maxJerk: 500 }
                }
            },
            thermalModel: {
                warmupTime: 0,
                driftPerDegree: 0,
                compensationFactors: { x: 0, y: 0, z: 0 }
            },
            optimizationData: {
                speedVsToolLife: [],
                qualityVsFeed: [],
                bestPractices: {}
            }
        };
        
        this.anomalyBaseline = {
            vibration: { mean: 0, std: 0, samples: [] },
            current: { mean: 0, std: 0, samples: [] },
            audio: { mean: 0, std: 0, samples: [] },
            temperature: { mean: 0, std: 0, samples: [] }
        };
        
        this.saveToStorage('neuralNet', this.neuralNet);
        this.saveToStorage('learningDB', this.learningDB);
        
        console.log('[ML] All learning data reset');
    }
    
    // ================================================================
    // PREDICTIVE MAINTENANCE
    // ================================================================
    
    setupPredictiveMaintenance() {
        // Track spindle runtime - STORE interval ID for cleanup
        this.maintenanceInterval = setInterval(() => this.updateMaintenanceTracking(), 60000); // Every minute
        
        // Check for maintenance alerts
        this.checkMaintenanceAlerts();
    }
    
    updateMaintenanceTracking() {
        if (this.app?.state?.spindle?.running) {
            this.maintenance.spindleHours += 1/60; // Add 1 minute
            this.saveToStorage('spindleHours', this.maintenance.spindleHours);
            this.energy.spindleOnTime += 60;
            
            // Update machine health based on sensor data
            this._updateMachineHealth();
        }
        
        // Track axis movement (if position changed)
        // This helps predict bearing/leadscrew wear
    }
    
    _updateMachineHealth() {
        // Decay health over time based on runtime
        const decayRate = 0.001;  // 0.1% per minute of runtime
        this.maintenance.healthScore = Math.max(0, this.maintenance.healthScore - decayRate);
        
        // Check for anomalies that accelerate degradation
        if (this.intelligence.anomalyScore > 50) {
            this.maintenance.degradationRate = this.intelligence.anomalyScore / 50;
            this.maintenance.healthScore -= this.maintenance.degradationRate * 0.01;
        } else {
            this.maintenance.degradationRate = 0;
        }
    }
    
    checkMaintenanceAlerts() {
        const alerts = [];
        
        // Spindle bearing check (every 500 hours typical)
        if (this.maintenance.spindleHours > 500) {
            alerts.push({
                type: 'warning',
                component: 'Spindle Bearings',
                message: `${Math.round(this.maintenance.spindleHours)} hours - Consider inspection`,
                action: 'Check for play, noise, or heat'
            });
        }
        
        // Belt/pulley check (every 200 hours)
        if (this.maintenance.spindleHours > 200 && this.maintenance.spindleHours % 200 < 1) {
            alerts.push({
                type: 'info',
                component: 'Belts/Pulleys',
                message: 'Periodic belt tension check recommended',
                action: 'Check tension and wear'
            });
        }
        
        // Lubrication reminder (every 40 hours)
        const hoursSinceMaintenance = (Date.now() - this.maintenance.lastMaintenance) / 3600000;
        if (hoursSinceMaintenance > 40) {
            alerts.push({
                type: 'info',
                component: 'Lubrication',
                message: `${Math.round(hoursSinceMaintenance)} hours since last maintenance`,
                action: 'Lubricate linear rails and leadscrews'
            });
        }
        
        this.maintenance.alerts = alerts;
        return alerts;
    }
    
    markMaintenanceDone(component) {
        this.maintenance.lastMaintenance = Date.now();
        if (component === 'spindle') {
            this.maintenance.spindleHours = 0;
        }
        this.saveToStorage('lastMaintenance', this.maintenance.lastMaintenance);
        this.checkMaintenanceAlerts();
    }
    
    // ================================================================
    // ADAPTIVE FEED RATE (Software-based)
    // ================================================================
    
    setupAdaptiveFeedRate() {
        this.adaptiveFeed = {
            enabled: false,
            baseRate: 100,
            currentRate: 100,
            lastSent: 100,  // SAFETY FIX: Initialize lastSent to prevent NaN comparison
            minRate: 25,
            maxRate: 150,
            // Thresholds
            loadThreshold: 70, // % spindle load to slow down
            vibrationThreshold: 0.7, // Chatter score to slow down
            // Smoothing
            rateChangeSpeed: 5 // % per update
        };
    }
    
    updateAdaptiveFeed(spindleLoad, chatterScore) {
        if (!this.adaptiveFeed.enabled) return;
        
        // CRITICAL SAFETY: Don't send commands during Alarm/E-STOP
        const machineState = this.app?.state?.status || this.app?.grbl?.state?.status;
        if (machineState === 'Alarm' || machineState === 'Door' || machineState === 'Hold') {
            console.warn('[SAFETY] Machine in alarm/hold state - adaptive feed disabled');
            return;
        }
        
        // CRITICAL SAFETY: Validate inputs - reject NaN/Infinity
        if (!Number.isFinite(spindleLoad)) spindleLoad = 0;
        if (!Number.isFinite(chatterScore)) chatterScore = 0;
        
        let targetRate = this.adaptiveFeed.baseRate;
        
        // Reduce feed if spindle is loaded
        if (spindleLoad > this.adaptiveFeed.loadThreshold) {
            const overload = spindleLoad - this.adaptiveFeed.loadThreshold;
            targetRate -= overload * 2; // 2% feed reduction per 1% overload
        }
        
        // Reduce feed if chatter detected
        if (chatterScore > this.adaptiveFeed.vibrationThreshold) {
            const overVibration = chatterScore - this.adaptiveFeed.vibrationThreshold;
            targetRate -= overVibration * 50; // 50% feed reduction at max chatter
        }
        
        // Clamp to limits
        targetRate = Math.max(this.adaptiveFeed.minRate, 
                              Math.min(this.adaptiveFeed.maxRate, targetRate));
        
        // CRITICAL SAFETY: Final NaN/Infinity check and absolute bounds
        if (!Number.isFinite(targetRate)) {
            console.error('[SAFETY] Invalid feed rate calculated, defaulting to 100%');
            targetRate = 100;
        }
        targetRate = Math.max(10, Math.min(200, targetRate));  // Absolute safety bounds
        
        // Smooth rate changes
        if (targetRate < this.adaptiveFeed.currentRate) {
            this.adaptiveFeed.currentRate = Math.max(targetRate, 
                this.adaptiveFeed.currentRate - this.adaptiveFeed.rateChangeSpeed);
        } else if (targetRate > this.adaptiveFeed.currentRate) {
            this.adaptiveFeed.currentRate = Math.min(targetRate,
                this.adaptiveFeed.currentRate + this.adaptiveFeed.rateChangeSpeed);
        }
        
        // Send override command if changed significantly
        // grblHAL uses incremental commands: 0x91=+10%, 0x92=-10%, 0x93=+1%, 0x94=-1%
        const diff = Math.round(this.adaptiveFeed.currentRate) - Math.round(this.adaptiveFeed.lastSent);
        if (Math.abs(diff) >= 1) {
            this._sendFeedOverrideIncremental(diff);
            this.adaptiveFeed.lastSent = Math.round(this.adaptiveFeed.currentRate);
        }
    }
    
    /**
     * Send feed override using proper grblHAL realtime commands
     * grblHAL uses: 0x90=reset to 100%, 0x91=+10%, 0x92=-10%, 0x93=+1%, 0x94=-1%
     */
    _sendFeedOverrideIncremental(diff) {
        const grbl = this.app?.grbl;
        if (!grbl?.sendRealtime) return;
        
        if (diff > 0) {
            // Increase feed
            const tens = Math.floor(diff / 10);
            const ones = diff % 10;
            for (let i = 0; i < tens; i++) grbl.sendRealtime('\x91');
            for (let i = 0; i < ones; i++) grbl.sendRealtime('\x93');
        } else if (diff < 0) {
            // Decrease feed
            const absDiff = Math.abs(diff);
            const tens = Math.floor(absDiff / 10);
            const ones = absDiff % 10;
            for (let i = 0; i < tens; i++) grbl.sendRealtime('\x92');
            for (let i = 0; i < ones; i++) grbl.sendRealtime('\x94');
        }
    }
    
    /**
     * Reset feed override to 100% - call on sensor disconnect or error
     */
    resetFeedOverride() {
        this.app?.grbl?.sendRealtime?.('\x90');  // grblHAL: reset feed to 100%
        this.adaptiveFeed.currentRate = 100;
        this.adaptiveFeed.lastSent = 100;
        console.log('[SAFETY] Feed override reset to 100%');
    }
    
    // ================================================================
    // TOOL LIFE TRACKING
    // ================================================================
    
    startToolTracking(toolNumber, material, operation) {
        // SAFETY: Validate tool number input
        toolNumber = parseInt(toolNumber, 10);
        if (!Number.isFinite(toolNumber) || toolNumber < 0 || toolNumber > 99) {
            console.warn('[ToolLife] Invalid tool number:', toolNumber);
            return;
        }
        
        if (!this.toolLife[toolNumber]) {
            this.toolLife[toolNumber] = {
                inserted: Date.now(),
                cuttingTime: 0,
                materialCut: {},
                operations: 0,
                maxLife: this.estimateToolLife(toolNumber, material)
            };
        }
        
        this.toolLife[toolNumber].currentJob = {
            start: Date.now(),
            material: material || 'unknown',
            operation: operation || 'general'
        };
    }
    
    endToolTracking(toolNumber) {
        const tool = this.toolLife[toolNumber];
        if (!tool?.currentJob) return;
        
        const jobTime = (Date.now() - tool.currentJob.start) / 60000; // minutes
        tool.cuttingTime += jobTime;
        tool.operations++;
        
        const material = tool.currentJob.material;
        tool.materialCut[material] = (tool.materialCut[material] || 0) + jobTime;
        
        delete tool.currentJob;
        this.saveToStorage('toolLife', this.toolLife);
        
        // Check if tool needs replacement
        const lifeRemaining = this.getToolLifeRemaining(toolNumber);
        if (lifeRemaining < 20) {
            this.showToolWearAlert(toolNumber, lifeRemaining);
        }
    }
    
    getToolLifeRemaining(toolNumber) {
        const tool = this.toolLife[toolNumber];
        if (!tool) return 100;
        
        return Math.max(0, 100 - (tool.cuttingTime / tool.maxLife * 100));
    }
    
    estimateToolLife(toolNumber, material) {
        // Rough estimates in minutes of cutting time
        const baseLife = {
            'aluminum': 120,
            'steel': 45,
            'stainless': 30,
            'wood': 300,
            'plastic': 240,
            'brass': 90,
            'copper': 90
        };
        return baseLife[material?.toLowerCase()] || 60;
    }
    
    showToolWearAlert(toolNumber, lifeRemaining) {
        const message = `Tool ${toolNumber} at ${Math.round(lifeRemaining)}% life remaining`;
        console.warn(message);
        
        if (this.features.voiceAlerts) {
            this.speak(message);
        }
        
        this.app?.showNotification?.(message, 'warning');
    }
    
    replaceTool(toolNumber) {
        delete this.toolLife[toolNumber];
        this.saveToStorage('toolLife', this.toolLife);
        this.maintenance.toolChanges++;
        this.saveToStorage('toolChanges', this.maintenance.toolChanges);
    }
    
    // ================================================================
    // VOICE ALERTS (Uses Web Speech API - FREE)
    // ================================================================
    
    setupVoiceAlerts() {
        this.voice = {
            enabled: true,
            volume: 0.8,
            rate: 1.0,
            voice: null
        };
        
        // Get available voices - FIX: Try immediately AND add listener to avoid race condition
        if ('speechSynthesis' in window) {
            const loadVoices = () => {
                const voices = speechSynthesis.getVoices();
                if (voices.length > 0) {
                    // Prefer English voice
                    this.voice.voice = voices.find(v => v.lang.startsWith('en')) || voices[0];
                }
            };
            
            // Try immediately (voices may already be loaded)
            loadVoices();
            
            // Also listen for async load (use addEventListener to not overwrite other handlers)
            speechSynthesis.addEventListener('voiceschanged', loadVoices);
        }
    }
    
    speak(message, priority = 'normal') {
        if (!this.voice.enabled || !('speechSynthesis' in window)) return;
        
        // Cancel low priority if high priority comes in
        if (priority === 'high') {
            speechSynthesis.cancel();
        }
        
        const utterance = new SpeechSynthesisUtterance(message);
        utterance.volume = this.voice.volume;
        utterance.rate = this.voice.rate;
        if (this.voice.voice) utterance.voice = this.voice.voice;
        
        speechSynthesis.speak(utterance);
    }
    
    // Predefined voice alerts
    announceJobStart(jobName) {
        this.speak(`Starting job: ${jobName}`);
    }
    
    announceJobComplete(jobName, duration) {
        const minutes = Math.round(duration / 60);
        this.speak(`Job complete: ${jobName}. Total time: ${minutes} minutes`, 'high');
    }
    
    announceAlarm(alarmCode, description) {
        this.speak(`Alarm ${alarmCode}: ${description}`, 'high');
    }
    
    announceToolChange(toolNumber) {
        this.speak(`Tool change required: Tool ${toolNumber}`);
    }
    
    // ================================================================
    // JOB STATISTICS & ANALYTICS
    // ================================================================
    
    setupJobStatistics() {
        this.currentJob = null;
    }
    
    startJob(fileName, estimatedTime) {
        this.currentJob = {
            name: fileName,
            startTime: Date.now(),
            estimatedTime,
            pauseTime: 0,
            toolChanges: 0
        };
        
        this.jobStats.totalJobs++;
        this.announceJobStart(fileName);
    }
    
    pauseJob() {
        if (this.currentJob) {
            this.currentJob.pauseStart = Date.now();
        }
    }
    
    resumeJob() {
        if (this.currentJob?.pauseStart) {
            this.currentJob.pauseTime += Date.now() - this.currentJob.pauseStart;
            delete this.currentJob.pauseStart;
        }
    }
    
    endJob(success = true) {
        if (!this.currentJob) return;
        
        const duration = (Date.now() - this.currentJob.startTime - this.currentJob.pauseTime) / 1000;
        this.jobStats.totalRuntime += duration;
        
        if (success) {
            const successCount = Math.round(this.jobStats.successRate * (this.jobStats.totalJobs - 1) / 100);
            this.jobStats.successRate = ((successCount + 1) / this.jobStats.totalJobs) * 100;
        } else {
            const successCount = Math.round(this.jobStats.successRate * (this.jobStats.totalJobs - 1) / 100);
            this.jobStats.successRate = (successCount / this.jobStats.totalJobs) * 100;
        }
        
        this.saveToStorage('jobStats', this.jobStats);
        this.announceJobComplete(this.currentJob.name, duration);
        
        const report = this.generateJobReport();
        this.currentJob = null;
        
        return report;
    }
    
    generateJobReport() {
        if (!this.currentJob) return null;
        
        const duration = (Date.now() - this.currentJob.startTime - this.currentJob.pauseTime) / 1000;
        const efficiency = this.currentJob.estimatedTime 
            ? Math.round((this.currentJob.estimatedTime / duration) * 100)
            : null;
        
        return {
            name: this.currentJob.name,
            duration: Math.round(duration),
            pauseTime: Math.round(this.currentJob.pauseTime / 1000),
            toolChanges: this.currentJob.toolChanges,
            efficiency,
            energyUsed: this.calculateEnergyUsed()
        };
    }
    
    // ================================================================
    // ENERGY MONITORING (Estimated)
    // ================================================================
    
    calculateEnergyUsed() {
        // Estimate based on spindle power and runtime
        const spindlePowerKw = 2.2; // Typical router/spindle
        const idlePowerKw = 0.1;    // Controller, drivers idle
        
        const spindleHours = this.energy.spindleOnTime / 3600;
        const totalHours = (Date.now() - this.energy.sessionStart) / 3600000;
        const idleHours = totalHours - spindleHours;
        
        return (spindleHours * spindlePowerKw) + (idleHours * idlePowerKw);
    }
    
    getEnergyCost() {
        return this.calculateEnergyUsed() * this.energy.costPerKwh;
    }
    
    // ================================================================
    // MATERIAL DATABASE
    // ================================================================
    
    getDefaultMaterials() {
        return {
            // Material: { sfm, chipLoad, rampAngle, plungeRate }
            'aluminum_6061': {
                name: 'Aluminum 6061',
                sfm: { min: 500, max: 1000, recommended: 800 },
                chipLoad: { '1/8': 0.002, '1/4': 0.004, '3/8': 0.005, '1/2': 0.006 },
                rampAngle: 3,
                plungeRate: 0.5, // multiplier of feed
                coolant: 'mist',
                notes: 'Use sharp tools, high RPM, climb milling preferred'
            },
            'aluminum_7075': {
                name: 'Aluminum 7075',
                sfm: { min: 400, max: 800, recommended: 600 },
                chipLoad: { '1/8': 0.0015, '1/4': 0.003, '3/8': 0.004, '1/2': 0.005 },
                rampAngle: 2,
                plungeRate: 0.4,
                coolant: 'flood',
                notes: 'Harder than 6061, reduce speeds slightly'
            },
            'steel_1018': {
                name: 'Mild Steel 1018',
                sfm: { min: 80, max: 150, recommended: 100 },
                chipLoad: { '1/8': 0.001, '1/4': 0.002, '3/8': 0.003, '1/2': 0.004 },
                rampAngle: 1,
                plungeRate: 0.25,
                coolant: 'flood',
                notes: 'Use coated carbide, keep chips moving'
            },
            'stainless_304': {
                name: 'Stainless 304',
                sfm: { min: 50, max: 100, recommended: 70 },
                chipLoad: { '1/8': 0.0008, '1/4': 0.0015, '3/8': 0.002, '1/2': 0.003 },
                rampAngle: 0.5,
                plungeRate: 0.2,
                coolant: 'flood',
                notes: 'Work hardens - maintain continuous cut'
            },
            'brass': {
                name: 'Brass',
                sfm: { min: 200, max: 400, recommended: 300 },
                chipLoad: { '1/8': 0.002, '1/4': 0.004, '3/8': 0.005, '1/2': 0.006 },
                rampAngle: 5,
                plungeRate: 0.5,
                coolant: 'none',
                notes: 'Fast and easy, watch for grabbing'
            },
            'copper': {
                name: 'Copper',
                sfm: { min: 150, max: 300, recommended: 200 },
                chipLoad: { '1/8': 0.002, '1/4': 0.003, '3/8': 0.004, '1/2': 0.005 },
                rampAngle: 3,
                plungeRate: 0.4,
                coolant: 'mist',
                notes: 'Gummy material, use sharp tools'
            },
            'wood_hardwood': {
                name: 'Hardwood',
                sfm: { min: 600, max: 1200, recommended: 900 },
                chipLoad: { '1/8': 0.004, '1/4': 0.008, '3/8': 0.012, '1/2': 0.015 },
                rampAngle: 10,
                plungeRate: 0.75,
                coolant: 'none',
                notes: 'Dust collection essential'
            },
            'wood_softwood': {
                name: 'Softwood',
                sfm: { min: 800, max: 1500, recommended: 1200 },
                chipLoad: { '1/8': 0.005, '1/4': 0.010, '3/8': 0.015, '1/2': 0.020 },
                rampAngle: 15,
                plungeRate: 0.8,
                coolant: 'none',
                notes: 'Fast feeds, watch for burning'
            },
            'plastic_acrylic': {
                name: 'Acrylic/PMMA',
                sfm: { min: 500, max: 800, recommended: 600 },
                chipLoad: { '1/8': 0.003, '1/4': 0.006, '3/8': 0.008, '1/2': 0.010 },
                rampAngle: 5,
                plungeRate: 0.5,
                coolant: 'air',
                notes: 'Single flute preferred, O-flute ideal'
            },
            'plastic_hdpe': {
                name: 'HDPE',
                sfm: { min: 600, max: 1000, recommended: 800 },
                chipLoad: { '1/8': 0.005, '1/4': 0.010, '3/8': 0.012, '1/2': 0.015 },
                rampAngle: 10,
                plungeRate: 0.6,
                coolant: 'air',
                notes: 'Easy to cut, very forgiving'
            },
            'carbon_fiber': {
                name: 'Carbon Fiber',
                sfm: { min: 300, max: 600, recommended: 400 },
                chipLoad: { '1/8': 0.002, '1/4': 0.004, '3/8': 0.005, '1/2': 0.006 },
                rampAngle: 2,
                plungeRate: 0.3,
                coolant: 'none',
                notes: 'Diamond coated tools, FULL dust collection required (hazardous)'
            },
            'g10_fr4': {
                name: 'G10/FR4',
                sfm: { min: 250, max: 500, recommended: 350 },
                chipLoad: { '1/8': 0.002, '1/4': 0.004, '3/8': 0.005, '1/2': 0.006 },
                rampAngle: 2,
                plungeRate: 0.3,
                coolant: 'none',
                notes: 'Abrasive - use carbide or diamond'
            }
        };
    }
    
    calculateFeedsAndSpeeds(material, toolDiameter, flutes = 2) {
        // SAFETY: Validate inputs to prevent NaN/Infinity
        if (!Number.isFinite(toolDiameter) || toolDiameter <= 0) {
            console.error('[FeedsSpeeds] Invalid tool diameter:', toolDiameter);
            return null;
        }
        flutes = Math.max(1, Math.min(8, parseInt(flutes, 10) || 2));
        
        const mat = this.materials[material];
        if (!mat) return null;
        
        // FIX: Parse fractional strings properly ("1/8" = 0.125, not 1.8!)
        const parseFraction = (str) => {
            if (typeof str === 'number') return str;
            if (str.includes('/')) {
                const [num, den] = str.split('/').map(Number);
                return den !== 0 ? num / den : 0;
            }
            return parseFloat(str) || 0;
        };
        
        // Find closest chip load
        const chipLoadKey = Object.keys(mat.chipLoad).reduce((closest, key) => {
            const val = parseFraction(key);
            const closestVal = parseFraction(closest);
            return Math.abs(val - toolDiameter) < Math.abs(closestVal - toolDiameter) ? key : closest;
        });
        
        const chipLoad = mat.chipLoad[chipLoadKey] || 0.003;
        
        // Calculate RPM from SFM: RPM = (SFM × 12) / (π × D)
        const rpm = Math.round((mat.sfm.recommended * 12) / (Math.PI * toolDiameter));
        
        // Calculate feed rate: Feed = RPM × chipLoad × flutes
        const feedRate = Math.round(rpm * chipLoad * flutes);
        
        // Plunge rate
        const plungeRate = Math.round(feedRate * mat.plungeRate);
        
        // SAFETY: Final NaN check on all outputs
        if (!Number.isFinite(rpm) || !Number.isFinite(feedRate)) {
            console.error('[FeedsSpeeds] Calculation produced invalid values');
            return null;
        }
        
        return {
            rpm: Math.min(rpm, 24000), // Cap at typical spindle max
            feedRate,
            plungeRate,
            rampAngle: mat.rampAngle,
            coolant: mat.coolant,
            notes: mat.notes,
            // Ranges
            rpmRange: {
                min: Math.round((mat.sfm.min * 12) / (Math.PI * toolDiameter)),
                max: Math.round((mat.sfm.max * 12) / (Math.PI * toolDiameter))
            }
        };
    }
    
    // ================================================================
    // SMART SCHEDULING (Optimal cutting times)
    // ================================================================
    
    suggestOptimalJobTime() {
        // Based on historical data, suggest best times for different operations
        // (e.g., avoid noisy cuts during quiet hours)
        const hour = new Date().getHours();
        
        if (hour >= 22 || hour < 7) {
            return {
                suitable: ['finishing', 'engraving', 'light cuts'],
                avoid: ['roughing', 'heavy aluminum', 'drilling'],
                reason: 'Quiet hours - minimize noise'
            };
        } else if (hour >= 7 && hour < 9) {
            return {
                suitable: ['all operations'],
                avoid: [],
                reason: 'Good time for any operation'
            };
        }
        
        return { suitable: ['all operations'], avoid: [], reason: '' };
    }
    
    // ================================================================
    // UI CREATION
    // ================================================================
    
    createEnhancementsUI() {
        // Add enhancements panel to the app
        const panel = document.createElement('div');
        panel.id = 'enhancements-panel';
        panel.className = 'enhancements-panel';
        panel.innerHTML = `
            <div class="enhancements-header">
                <h3>🧠 Machine Intelligence</h3>
                <button onclick="window.app?.enhancements?.togglePanel?.()" class="btn-icon">×</button>
            </div>
            <div class="enhancements-content">
                <!-- NEW: AI STATUS SECTION -->
                <div class="enhancement-section ai-section">
                    <h4>🤖 AI Status</h4>
                    <div class="ai-gauges">
                        <div class="ai-gauge">
                            <div class="gauge-ring" id="gauge-quality"><span>--</span></div>
                            <div class="gauge-label">Quality</div>
                        </div>
                        <div class="ai-gauge">
                            <div class="gauge-ring" id="gauge-stability"><span>--</span></div>
                            <div class="gauge-label">Stability</div>
                        </div>
                        <div class="ai-gauge">
                            <div class="gauge-ring" id="gauge-health"><span>--</span></div>
                            <div class="gauge-label">Health</div>
                        </div>
                    </div>
                    <div class="ai-recommendation" id="ai-recommendation">
                        <span class="rec-icon">💡</span>
                        <span class="rec-text">Collecting data...</span>
                    </div>
                    <div class="stat-row">
                        <span>Neural Net:</span>
                        <span id="stat-neural-net">${this.neuralNet.trained ? '✓ Trained' : 'Learning...'}</span>
                    </div>
                    <div class="stat-row">
                        <span>Training Epochs:</span>
                        <span id="stat-epochs">${this.neuralNet.trainingEpochs}</span>
                    </div>
                    <div class="stat-row">
                        <span>Learned Patterns:</span>
                        <span id="stat-patterns">${this.learningDB.patterns.bad.length}</span>
                    </div>
                    <div class="stat-row">
                        <span>Known Resonances:</span>
                        <span id="stat-resonances">${this.learningDB.machineProfile.resonantFreqs.length}</span>
                    </div>
                </div>
                
                <!-- ANOMALY DETECTION -->
                <div class="enhancement-section" id="anomaly-section" style="display:none">
                    <h4>⚠️ Anomaly Detected</h4>
                    <div id="anomaly-details"></div>
                </div>
                
                <!-- PREDICTION -->
                <div class="enhancement-section" id="prediction-section" style="display:none">
                    <h4>🔮 Predicted Issue</h4>
                    <div id="prediction-details"></div>
                </div>
                
                <div class="enhancement-section">
                    <h4>📊 Session Statistics</h4>
                    <div class="stat-row">
                        <span>Total Jobs:</span>
                        <span id="stat-total-jobs">${this.jobStats.totalJobs}</span>
                    </div>
                    <div class="stat-row">
                        <span>Runtime:</span>
                        <span id="stat-runtime">${this.formatTime(this.jobStats.totalRuntime)}</span>
                    </div>
                    <div class="stat-row">
                        <span>Success Rate:</span>
                        <span id="stat-success">${Math.round(this.jobStats.successRate)}%</span>
                    </div>
                    <div class="stat-row">
                        <span>Est. Energy:</span>
                        <span id="stat-energy">${this.calculateEnergyUsed().toFixed(2)} kWh</span>
                    </div>
                </div>
                
                <!-- NEW: HARDWARE SENSORS SECTION -->
                <div class="enhancement-section">
                    <h4>🔌 Hardware Sensors → ML</h4>
                    <div class="hw-sensor-grid">
                        <div class="hw-sensor">
                            <span class="hw-icon" id="hw-tmc-status">⚫</span>
                            <span class="hw-label">TMC2209</span>
                            <span class="hw-value" id="hw-tmc-value">--</span>
                        </div>
                        <div class="hw-sensor">
                            <span class="hw-icon" id="hw-vfd-status">⚫</span>
                            <span class="hw-label">VFD Modbus</span>
                            <span class="hw-value" id="hw-vfd-value">--</span>
                        </div>
                        <div class="hw-sensor">
                            <span class="hw-icon" id="hw-esp-status">⚫</span>
                            <span class="hw-label">Chatter ESP32</span>
                            <span class="hw-value" id="hw-esp-value">--</span>
                        </div>
                        <div class="hw-sensor">
                            <span class="hw-icon" id="hw-grbl-status">⚫</span>
                            <span class="hw-label">grblHAL</span>
                            <span class="hw-value" id="hw-grbl-value">--</span>
                        </div>
                    </div>
                    <div class="hw-detail-row">
                        <span>Axis Load (SG):</span>
                        <span id="hw-axis-load">X:--% Y:--% Z:--%</span>
                    </div>
                    <div class="hw-detail-row">
                        <span>VFD Current:</span>
                        <span id="hw-vfd-amps">-- A</span>
                    </div>
                    <div class="hw-detail-row">
                        <span>Chatter Score:</span>
                        <span id="hw-chatter-score">--</span>
                    </div>
                </div>
                
                <!-- COOLANT/CHILLER SECTION -->
                <div class="enhancement-section">
                    <h4>❄️ Coolant System (CW-3000)</h4>
                    <div class="coolant-status-row">
                        <span class="coolant-icon" id="coolant-status-icon">⚫</span>
                        <span class="coolant-label" id="coolant-status-text">Not Connected</span>
                    </div>
                    <div class="stat-row">
                        <span>Water Temp:</span>
                        <span id="coolant-water-temp">--°C</span>
                    </div>
                    <div class="stat-row">
                        <span>Flow Status:</span>
                        <span id="coolant-flow-status">--</span>
                    </div>
                    <div class="stat-row">
                        <span>Pump:</span>
                        <span id="coolant-pump-status">--</span>
                    </div>
                    <div class="stat-row">
                        <span>Alarm Count:</span>
                        <span id="coolant-alarm-count">0</span>
                    </div>
                    <div id="coolant-alarm-details" class="coolant-alarm" style="display:none">
                        <span class="alarm-icon">🚨</span>
                        <span id="coolant-alarm-text">--</span>
                    </div>
                    <label class="toggle-row">
                        <input type="checkbox" id="chiller-door-pin-toggle"
                               onchange="app.enhancements.setChillerOnDoorPin(this.checked)">
                        <span>Chiller alarm → Safety Door pin</span>
                    </label>
                </div>
                
                <div class="enhancement-section">
                    <h4>🌡️ Thermal Compensation</h4>
                    <div class="stat-row">
                        <span>Machine Temp:</span>
                        <span id="stat-temp">${this.thermal?.currentTemp || 20}°C</span>
                    </div>
                    <div class="stat-row">
                        <span>Status:</span>
                        <span id="stat-warmup">${this.thermal?.isWarmedUp ? '✓ Warmed Up' : 'Warming...'}</span>
                    </div>
                    <div class="stat-row">
                        <span>Compensation:</span>
                        <span id="stat-thermal-comp">X:0 Y:0 Z:0 µm</span>
                    </div>
                </div>
                
                <!-- SAFETY SYSTEMS SECTION -->
                <div class="enhancement-section safety-section">
                    <h4>🛡️ Safety Systems</h4>
                    <div class="safety-grid">
                        <div class="safety-item">
                            <span class="safety-icon" id="safety-crash">⚫</span>
                            <span>Crash Detection</span>
                        </div>
                        <div class="safety-item">
                            <span class="safety-icon" id="safety-door">⚫</span>
                            <span>Door Interlock</span>
                        </div>
                        <div class="safety-item">
                            <span class="safety-icon" id="safety-fire">⚫</span>
                            <span>Fire Detection</span>
                        </div>
                        <div class="safety-item">
                            <span class="safety-icon" id="safety-network">🟢</span>
                            <span>Connection</span>
                        </div>
                    </div>
                    <div class="stat-row">
                        <span>Crash Count:</span>
                        <span id="safety-crash-count">0</span>
                    </div>
                    <div class="stat-row">
                        <span>Last Checkpoint:</span>
                        <span id="safety-checkpoint">--</span>
                    </div>
                    <div class="btn-row">
                        <button onclick="window.app?.enhancements?.showSafetyStatus?.()" class="btn btn-sm">
                            Full Safety Status
                        </button>
                    </div>
                </div>
                
                <!-- SPINDLE SECTION -->
                <div class="enhancement-section">
                    <h4>🌀 Spindle</h4>
                    <div class="stat-row">
                        <span>Status:</span>
                        <span id="spindle-status">Off</span>
                    </div>
                    <div class="stat-row">
                        <span>Bearing Health:</span>
                        <span id="spindle-bearing-health">100%</span>
                    </div>
                    <div class="stat-row">
                        <span>Warmup Needed:</span>
                        <span id="spindle-warmup-needed">No</span>
                    </div>
                    <div class="warmup-progress" id="spindle-warmup-container" style="display:none">
                        <div class="warmup-bar" id="spindle-warmup-progress">0%</div>
                    </div>
                    <button onclick="window.app?.enhancements?.runSpindleWarmup?.()" class="btn btn-sm">
                        Run Warmup Cycle
                    </button>
                </div>
                
                <!-- ENVIRONMENT SECTION -->
                <div class="enhancement-section">
                    <h4>🌡️ Environment</h4>
                    <div class="stat-row">
                        <span>Ambient Temp:</span>
                        <span id="env-ambient-temp">--°C</span>
                    </div>
                    <div class="stat-row">
                        <span>Humidity:</span>
                        <span id="env-humidity">--%</span>
                    </div>
                    <div class="stat-row">
                        <span>Enclosure:</span>
                        <span id="env-enclosure">--</span>
                    </div>
                </div>
                
                <!-- ACCESSORIES SECTION -->
                <div class="enhancement-section">
                    <h4>🔌 Accessories</h4>
                    <div class="accessory-grid">
                        <div class="accessory-item">
                            <span class="acc-icon" id="acc-dust">⚫</span>
                            <span>Dust</span>
                        </div>
                        <div class="accessory-item">
                            <span class="acc-icon" id="acc-vacuum">⚫</span>
                            <span>Vacuum</span>
                        </div>
                        <div class="accessory-item">
                            <span class="acc-icon" id="acc-air">⚫</span>
                            <span>Air Blast</span>
                        </div>
                        <div class="accessory-item">
                            <span class="acc-icon" id="acc-lube">⚫</span>
                            <span>Lube</span>
                        </div>
                    </div>
                    <label class="toggle-row">
                        <input type="checkbox" id="dust-auto-toggle" checked
                               onchange="app.enhancements.toggleDustAuto(this.checked)">
                        <span>Auto dust collection</span>
                    </label>
                </div>
                
                <!-- TOOL SECTION -->
                <div class="enhancement-section">
                    <h4>🔧 Tool Status</h4>
                    <div class="stat-row">
                        <span>Current Tool:</span>
                        <span id="tool-current">T0</span>
                    </div>
                    <div class="stat-row">
                        <span>Condition:</span>
                        <span id="tool-condition">OK</span>
                    </div>
                    <div class="stat-row">
                        <span>Runout:</span>
                        <span id="tool-runout">--</span>
                    </div>
                    <button onclick="window.app?.enhancements?.probeToolLength?.()" class="btn btn-sm"
                            id="tool-probe-btn" disabled>
                        Probe Tool
                    </button>
                </div>
                
                <div class="enhancement-section">
                    <h4>🔧 Maintenance</h4>
                    <div class="stat-row">
                        <span>Machine Health:</span>
                        <span id="stat-machine-health">${Math.round(this.maintenance.healthScore)}%</span>
                    </div>
                    <div class="stat-row">
                        <span>Spindle Hours:</span>
                        <span id="stat-spindle-hours">${this.maintenance.spindleHours.toFixed(1)}h</span>
                    </div>
                    <div class="stat-row">
                        <span>Tool Changes:</span>
                        <span id="stat-tool-changes">${this.maintenance.toolChanges}</span>
                    </div>
                    <div id="maintenance-alerts"></div>
                    <button onclick="window.app?.enhancements?.markMaintenanceDone?.('all')" class="btn btn-sm">
                        Mark Maintenance Done
                    </button>
                </div>
                
                <div class="enhancement-section">
                    <h4>⚡ Adaptive Feed</h4>
                    <label class="toggle-row">
                        <input type="checkbox" id="adaptive-feed-toggle" 
                               onchange="window.app?.enhancements?.toggleAdaptiveFeed?.(this.checked)">
                        <span>Enable Adaptive Feed Rate</span>
                    </label>
                    <div class="stat-row">
                        <span>Current Override:</span>
                        <span id="adaptive-feed-value">100%</span>
                    </div>
                </div>
                
                <div class="enhancement-section">
                    <h4>🔊 Voice Alerts</h4>
                    <label class="toggle-row">
                        <input type="checkbox" id="voice-toggle" checked
                               onchange="window.app?.enhancements?.toggleVoice?.(this.checked)">
                        <span>Enable Voice Announcements</span>
                    </label>
                    <button onclick="window.app?.enhancements?.speak?.('Voice alerts are working')" class="btn btn-sm">
                        Test Voice
                    </button>
                </div>
                
                <div class="enhancement-section">
                    <h4>💾 Learning Data</h4>
                    <div class="btn-row">
                        <button onclick="window.app?.enhancements?.exportLearningUI?.()" class="btn btn-sm">Export</button>
                        <button onclick="window.app?.enhancements?.importLearningUI?.()" class="btn btn-sm">Import</button>
                        <button onclick="window.app?.enhancements?.confirmResetLearning?.()" class="btn btn-sm btn-danger">Reset</button>
                    </div>
                </div>
            </div>
        `;
        
        // Add styles
        const style = document.createElement('style');
        style.textContent = `
            .enhancements-panel {
                position: fixed;
                right: -360px;
                top: 60px;
                width: 340px;
                max-height: calc(100vh - 80px);
                background: var(--bg-secondary, #1e1e1e);
                border: 1px solid var(--border-color, #333);
                border-radius: 8px;
                box-shadow: -4px 4px 20px rgba(0,0,0,0.3);
                transition: right 0.3s ease;
                z-index: 1000;
                overflow-y: auto;
            }
            .enhancements-panel.open {
                right: 10px;
            }
            .enhancements-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 12px 16px;
                border-bottom: 1px solid var(--border-color, #333);
                background: linear-gradient(145deg, #1a1a2e, #16213e);
            }
            .enhancements-header h3 {
                margin: 0;
                font-size: 14px;
            }
            .enhancements-content {
                padding: 12px;
            }
            .enhancement-section {
                margin-bottom: 16px;
                padding-bottom: 12px;
                border-bottom: 1px solid var(--border-color, #333);
            }
            .enhancement-section:last-child {
                border-bottom: none;
                margin-bottom: 0;
            }
            .enhancement-section h4 {
                margin: 0 0 8px 0;
                font-size: 12px;
                color: var(--text-secondary, #888);
            }
            .stat-row {
                display: flex;
                justify-content: space-between;
                padding: 4px 0;
                font-size: 12px;
            }
            .toggle-row {
                display: flex;
                align-items: center;
                gap: 8px;
                font-size: 12px;
                cursor: pointer;
            }
            .btn-sm {
                padding: 4px 8px;
                font-size: 11px;
                margin-top: 8px;
            }
            .btn-row {
                display: flex;
                gap: 8px;
                margin-top: 8px;
            }
            .btn-danger {
                background: #ff4444 !important;
                color: white;
            }
            #maintenance-alerts {
                margin: 8px 0;
            }
            .maintenance-alert {
                padding: 6px 8px;
                margin: 4px 0;
                border-radius: 4px;
                font-size: 11px;
            }
            .maintenance-alert.warning {
                background: rgba(255,193,7,0.2);
                border-left: 3px solid #ffc107;
            }
            .maintenance-alert.info {
                background: rgba(33,150,243,0.2);
                border-left: 3px solid #2196f3;
            }
            /* AI Section Styles */
            .ai-section {
                background: linear-gradient(145deg, rgba(68,136,255,0.1), rgba(136,68,255,0.1));
                border-radius: 8px;
                padding: 12px !important;
                margin: -12px -12px 16px -12px;
            }
            .ai-gauges {
                display: flex;
                justify-content: space-around;
                margin: 12px 0;
            }
            .ai-gauge {
                text-align: center;
            }
            .gauge-ring {
                width: 60px;
                height: 60px;
                border-radius: 50%;
                background: conic-gradient(#44ff44 0%, #44ff44 0%, #333 0%);
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 16px;
                font-weight: bold;
                position: relative;
            }
            .gauge-ring::before {
                content: '';
                position: absolute;
                width: 48px;
                height: 48px;
                border-radius: 50%;
                background: #1a1a2e;
            }
            .gauge-ring span {
                position: relative;
                z-index: 1;
            }
            .gauge-label {
                font-size: 10px;
                opacity: 0.7;
                margin-top: 4px;
            }
            .ai-recommendation {
                background: rgba(255,200,0,0.1);
                border: 1px solid rgba(255,200,0,0.3);
                border-radius: 6px;
                padding: 8px;
                display: flex;
                align-items: flex-start;
                gap: 8px;
                font-size: 11px;
                margin: 10px 0;
            }
            .rec-icon {
                font-size: 16px;
            }
            .rec-text {
                flex: 1;
            }
            #anomaly-section {
                background: rgba(255,68,68,0.1);
                border: 1px solid rgba(255,68,68,0.3);
                border-radius: 8px;
                padding: 8px;
            }
            #prediction-section {
                background: rgba(255,136,0,0.1);
                border: 1px solid rgba(255,136,0,0.3);
                border-radius: 8px;
                padding: 8px;
            }
            /* Hardware Sensors Grid */
            .hw-sensor-grid {
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: 8px;
                margin: 10px 0;
            }
            .hw-sensor {
                background: rgba(0,0,0,0.3);
                border-radius: 6px;
                padding: 8px;
                display: flex;
                flex-direction: column;
                align-items: center;
                gap: 4px;
            }
            .hw-icon {
                font-size: 14px;
            }
            .hw-label {
                font-size: 10px;
                opacity: 0.7;
            }
            .hw-value {
                font-size: 11px;
                font-weight: bold;
            }
            .hw-detail-row {
                display: flex;
                justify-content: space-between;
                font-size: 11px;
                padding: 4px 0;
                border-bottom: 1px solid rgba(255,255,255,0.1);
            }
            .hw-detail-row span:last-child {
                font-family: monospace;
            }
            /* Coolant System Styles */
            .coolant-status-row {
                display: flex;
                align-items: center;
                gap: 10px;
                padding: 8px;
                background: rgba(0,0,0,0.3);
                border-radius: 6px;
                margin-bottom: 10px;
            }
            .coolant-icon {
                font-size: 18px;
            }
            .coolant-label {
                font-size: 12px;
                font-weight: bold;
            }
            .coolant-alarm {
                background: rgba(255, 60, 60, 0.3);
                border: 1px solid #ff4444;
                border-radius: 6px;
                padding: 10px;
                margin-top: 10px;
                display: flex;
                align-items: center;
                gap: 10px;
            }
            .coolant-alarm .alarm-icon {
                font-size: 20px;
                animation: pulse 1s infinite;
            }
            @keyframes pulse {
                0%, 100% { opacity: 1; }
                50% { opacity: 0.5; }
            }
            /* Safety Systems Styles */
            .safety-section {
                background: linear-gradient(145deg, rgba(30,30,60,0.5), rgba(20,20,40,0.5));
                border: 1px solid rgba(100,100,200,0.3);
            }
            .safety-grid {
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: 8px;
                margin: 10px 0;
            }
            .safety-item {
                display: flex;
                align-items: center;
                gap: 8px;
                padding: 6px 10px;
                background: rgba(0,0,0,0.3);
                border-radius: 4px;
                font-size: 11px;
            }
            .safety-icon {
                font-size: 12px;
            }
            .safety-icon.active { color: #44ff44; }
            .safety-icon.warning { color: #ffaa00; }
            .safety-icon.alarm { color: #ff4444; animation: pulse 0.5s infinite; }
            /* Spindle Warmup Progress */
            .warmup-progress {
                height: 20px;
                background: rgba(0,0,0,0.3);
                border-radius: 10px;
                overflow: hidden;
                margin: 10px 0;
            }
            .warmup-bar {
                height: 100%;
                background: linear-gradient(90deg, #4CAF50, #8BC34A);
                transition: width 0.5s;
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 11px;
                color: white;
            }
            /* Accessory Grid */
            .accessory-grid {
                display: grid;
                grid-template-columns: repeat(4, 1fr);
                gap: 6px;
                margin: 10px 0;
            }
            .accessory-item {
                display: flex;
                flex-direction: column;
                align-items: center;
                gap: 4px;
                padding: 6px;
                background: rgba(0,0,0,0.3);
                border-radius: 4px;
                font-size: 10px;
            }
            .acc-icon {
                font-size: 14px;
            }
            .acc-icon.on { color: #44ff44; }
            .acc-icon.off { color: #666; }
            /* Pre-flight Results */
            .preflight-passed { color: #44ff44; }
            .preflight-failed { color: #ff4444; }
            /* Emergency button in header */
            .btn-emergency {
                background: #ff4444 !important;
                color: white;
                font-weight: bold;
                animation: emergency-blink 1s infinite;
            }
            @keyframes emergency-blink {
                0%, 100% { opacity: 1; }
                50% { opacity: 0.7; }
            }
        `;
        document.head.appendChild(style);
        document.body.appendChild(panel);
        
        // Update maintenance alerts display
        this.updateMaintenanceUI();
        
        // Start UI update loop
        this.startUIUpdateLoop();
    }
    
    startUIUpdateLoop() {
        this.uiUpdateInterval = setInterval(() => this.updateIntelligenceUI(), 500);
    }
    
    updateIntelligenceUI() {
        const status = this.getIntelligenceStatus();
        
        // Update gauges
        this._updateGauge('gauge-quality', status.quality);
        this._updateGauge('gauge-stability', status.stability);
        this._updateGauge('gauge-health', status.machineHealth);
        
        // Update neural net status
        const nnEl = document.getElementById('stat-neural-net');
        if (nnEl) {
            nnEl.textContent = status.neuralNetTrained ? '✓ Trained' : `Learning (${status.trainingEpochs})`;
            nnEl.style.color = status.neuralNetTrained ? '#44ff44' : '#ffc800';
        }
        
        const epochsEl = document.getElementById('stat-epochs');
        if (epochsEl) epochsEl.textContent = status.trainingEpochs;
        
        const patternsEl = document.getElementById('stat-patterns');
        if (patternsEl) patternsEl.textContent = status.learnedPatterns;
        
        const resonancesEl = document.getElementById('stat-resonances');
        if (resonancesEl) resonancesEl.textContent = status.learnedResonances;
        
        // Update recommendation
        const recEl = document.getElementById('ai-recommendation');
        if (recEl && status.recommendation) {
            const recIcon = recEl.querySelector('.rec-icon');
            const recText = recEl.querySelector('.rec-text');
            if (recIcon) recIcon.textContent = status.recommendation.icon || '💡';
            if (recText) recText.textContent = status.recommendation.text;
            recEl.style.borderColor = status.recommendation.priority === 'critical' ? '#ff4444' : 
                                       status.recommendation.priority === 'warning' ? '#ffc800' : '#4488ff';
        }
        
        // Update anomaly section
        const anomalySection = document.getElementById('anomaly-section');
        if (anomalySection) {
            if (status.anomalyScore > 30) {
                anomalySection.style.display = 'block';
                document.getElementById('anomaly-details').textContent = 
                    `${status.anomalyType} - Score: ${status.anomalyScore}%`;
            } else {
                anomalySection.style.display = 'none';
            }
        }
        
        // Update prediction section
        const predSection = document.getElementById('prediction-section');
        if (predSection) {
            if (status.predictedIssue) {
                predSection.style.display = 'block';
                document.getElementById('prediction-details').innerHTML = 
                    `<strong>${status.predictedIssue}</strong><br>
                     Confidence: ${status.issueConfidence}%<br>
                     Time: ~${status.timeToIssue}s`;
            } else {
                predSection.style.display = 'none';
            }
        }
        
        // Update thermal
        const tempEl = document.getElementById('stat-temp');
        if (tempEl) tempEl.textContent = `${this.thermal?.currentTemp?.toFixed(1) || 20}°C`;
        
        const warmupEl = document.getElementById('stat-warmup');
        if (warmupEl) {
            warmupEl.textContent = this.thermal?.isWarmedUp ? '✓ Warmed Up' : 'Warming...';
            warmupEl.style.color = this.thermal?.isWarmedUp ? '#44ff44' : '#ffc800';
        }
        
        if (status.thermalCompensation) {
            const compEl = document.getElementById('stat-thermal-comp');
            if (compEl) {
                const c = status.thermalCompensation;
                compEl.textContent = `X:${(c.x*1000).toFixed(0)} Y:${(c.y*1000).toFixed(0)} Z:${(c.z*1000).toFixed(0)} µm`;
            }
        }
        
        // Update machine health
        const healthEl = document.getElementById('stat-machine-health');
        if (healthEl) {
            healthEl.textContent = `${Math.round(this.maintenance.healthScore)}%`;
            healthEl.style.color = this.maintenance.healthScore > 80 ? '#44ff44' : 
                                   this.maintenance.healthScore > 50 ? '#ffc800' : '#ff4444';
        }
        
        // Update hardware sensor status
        this._updateHardwareSensorUI();
    }
    
    _updateHardwareSensorUI() {
        const hw = this.hardwareState;
        if (!hw) return;
        
        // TMC2209 StallGuard status
        const tmcStatus = document.getElementById('hw-tmc-status');
        const tmcValue = document.getElementById('hw-tmc-value');
        if (tmcStatus && tmcValue) {
            const hasSG = hw.stallGuard.x > 0 || hw.stallGuard.y > 0 || hw.stallGuard.z > 0;
            tmcStatus.textContent = hasSG ? '🟢' : '⚫';
            const maxLoad = Math.max(hw.axisLoad.x, hw.axisLoad.y, hw.axisLoad.z);
            tmcValue.textContent = hasSG ? `${maxLoad.toFixed(0)}% load` : 'No data';
        }
        
        // VFD Modbus status
        const vfdStatus = document.getElementById('hw-vfd-status');
        const vfdValue = document.getElementById('hw-vfd-value');
        if (vfdStatus && vfdValue) {
            vfdStatus.textContent = hw.vfd.connected ? '🟢' : (hw.vfd.amps > 0 ? '🟡' : '⚫');
            vfdValue.textContent = hw.vfd.amps > 0 ? `${hw.vfd.amps.toFixed(1)}A` : 'No data';
        }
        
        // Chatter ESP32 status
        const espStatus = document.getElementById('hw-esp-status');
        const espValue = document.getElementById('hw-esp-value');
        if (espStatus && espValue) {
            const hasChatter = hw.chatter.score > 0 || hw.chatter.confidence > 0;
            espStatus.textContent = hasChatter ? '🟢' : '⚫';
            espValue.textContent = hasChatter ? `${hw.chatter.score.toFixed(0)}%` : 'No data';
        }
        
        // grblHAL status
        const grblStatus = document.getElementById('hw-grbl-status');
        const grblValue = document.getElementById('hw-grbl-value');
        if (grblStatus && grblValue) {
            const connected = hw.grbl.state !== 'Unknown';
            grblStatus.textContent = connected ? '🟢' : '⚫';
            grblValue.textContent = connected ? hw.grbl.state : 'No data';
        }
        
        // Axis load detail
        const axisLoadEl = document.getElementById('hw-axis-load');
        if (axisLoadEl) {
            axisLoadEl.textContent = `X:${hw.axisLoad.x.toFixed(0)}% Y:${hw.axisLoad.y.toFixed(0)}% Z:${hw.axisLoad.z.toFixed(0)}%`;
        }
        
        // VFD amps detail
        const vfdAmpsEl = document.getElementById('hw-vfd-amps');
        if (vfdAmpsEl) {
            vfdAmpsEl.textContent = hw.vfd.amps > 0 ? `${hw.vfd.amps.toFixed(2)} A` : '-- A';
        }
        
        // Chatter score detail
        const chatterScoreEl = document.getElementById('hw-chatter-score');
        if (chatterScoreEl) {
            const stateColor = hw.chatter.state === 'chatter' ? '#ff4444' : 
                              hw.chatter.state === 'warning' ? '#ffc800' : '#44ff44';
            chatterScoreEl.innerHTML = `<span style="color:${stateColor}">${hw.chatter.score.toFixed(1)}%</span> (${hw.chatter.state})`;
        }
        
        // Update coolant system UI
        this._updateCoolantUI();
    }
    
    /**
     * Update coolant/chiller system UI
     */
    _updateCoolantUI() {
        const c = this.hardwareState.coolant;
        
        // Status icon and text
        const statusIcon = document.getElementById('coolant-status-icon');
        const statusText = document.getElementById('coolant-status-text');
        if (statusIcon && statusText) {
            if (c.alarm) {
                statusIcon.textContent = '🔴';
                statusText.textContent = 'ALARM!';
                statusText.style.color = '#ff4444';
            } else if (c.connected) {
                statusIcon.textContent = '🟢';
                statusText.textContent = 'Connected';
                statusText.style.color = '#44ff44';
            } else {
                statusIcon.textContent = '⚫';
                statusText.textContent = 'Not Connected';
                statusText.style.color = '';
            }
        }
        
        // Water temperature
        const tempEl = document.getElementById('coolant-water-temp');
        if (tempEl) {
            if (c.connected && c.waterTemp > 0) {
                const tempColor = c.waterTemp > 30 ? '#ff4444' : 
                                 c.waterTemp > 25 ? '#ffc800' : '#44ff44';
                tempEl.innerHTML = `<span style="color:${tempColor}">${c.waterTemp.toFixed(1)}°C</span>`;
            } else {
                tempEl.textContent = '--°C';
            }
        }
        
        // Flow status
        const flowEl = document.getElementById('coolant-flow-status');
        if (flowEl) {
            if (c.connected) {
                flowEl.innerHTML = c.flowOk ? 
                    '<span style="color:#44ff44">OK</span>' : 
                    '<span style="color:#ff4444">LOW FLOW</span>';
            } else {
                flowEl.textContent = '--';
            }
        }
        
        // Pump status
        const pumpEl = document.getElementById('coolant-pump-status');
        if (pumpEl) {
            pumpEl.innerHTML = c.pumpRunning ? 
                '<span style="color:#44ff44">Running (M8)</span>' : 
                '<span style="opacity:0.5">Off</span>';
        }
        
        // Alarm count
        const alarmCountEl = document.getElementById('coolant-alarm-count');
        if (alarmCountEl) {
            alarmCountEl.textContent = c.alarmCount;
            if (c.alarmCount > 0) {
                alarmCountEl.style.color = '#ffc800';
            }
        }
        
        // Alarm details
        const alarmDetails = document.getElementById('coolant-alarm-details');
        const alarmText = document.getElementById('coolant-alarm-text');
        if (alarmDetails && alarmText) {
            if (c.alarm) {
                alarmDetails.style.display = 'flex';
                alarmText.textContent = c.alarmStr || `Alarm code: ${c.alarmCode}`;
            } else {
                alarmDetails.style.display = 'none';
            }
        }
        
        // Chiller on door pin toggle state
        const doorPinToggle = document.getElementById('chiller-door-pin-toggle');
        if (doorPinToggle && this.features) {
            doorPinToggle.checked = this.features.chillerOnDoorPin || false;
        }
        
        // Update safety systems UI
        this._updateSafetyUI();
        
        // Update spindle UI
        this._updateSpindleStatusUI();
        
        // Update environment UI
        this._updateEnvironmentUI();
        
        // Update accessories UI
        this._updateAccessoriesUI();
        
        // Update tool UI
        this._updateToolUI();
    }
    
    /**
     * Update safety systems UI panel
     */
    _updateSafetyUI() {
        const hw = this.hardwareState;
        
        // Crash detection icon
        const crashIcon = document.getElementById('safety-crash');
        if (crashIcon) {
            if (hw.crash.detected) {
                crashIcon.textContent = '🔴';
                crashIcon.className = 'safety-icon alarm';
            } else if (hw.crash.imminent) {
                crashIcon.textContent = '🟡';
                crashIcon.className = 'safety-icon warning';
            } else if (this.features.crashPrevention) {
                crashIcon.textContent = '🟢';
                crashIcon.className = 'safety-icon active';
            } else {
                crashIcon.textContent = '⚫';
                crashIcon.className = 'safety-icon';
            }
        }
        
        // Door interlock icon
        const doorIcon = document.getElementById('safety-door');
        if (doorIcon) {
            if (hw.enclosure.doorOpen) {
                doorIcon.textContent = '🟡';
                doorIcon.className = 'safety-icon warning';
            } else if (hw.enclosure.hasDoor) {
                doorIcon.textContent = '🟢';
                doorIcon.className = 'safety-icon active';
            } else {
                doorIcon.textContent = '⚫';
                doorIcon.className = 'safety-icon';
            }
        }
        
        // Fire detection icon
        const fireIcon = document.getElementById('safety-fire');
        if (fireIcon) {
            if (hw.environment.fireAlarm) {
                fireIcon.textContent = '🔴';
                fireIcon.className = 'safety-icon alarm';
            } else if (this.features.fireDetection) {
                fireIcon.textContent = '🟢';
                fireIcon.className = 'safety-icon active';
            } else {
                fireIcon.textContent = '⚫';
                fireIcon.className = 'safety-icon';
            }
        }
        
        // Network icon
        const networkIcon = document.getElementById('safety-network');
        if (networkIcon) {
            if (hw.network.wsReconnecting) {
                networkIcon.textContent = '🟡';
                networkIcon.className = 'safety-icon warning';
            } else if (hw.network.wsConnected) {
                networkIcon.textContent = '🟢';
                networkIcon.className = 'safety-icon active';
            } else {
                networkIcon.textContent = '🔴';
                networkIcon.className = 'safety-icon alarm';
            }
        }
        
        // Crash count
        const crashCountEl = document.getElementById('safety-crash-count');
        if (crashCountEl) {
            crashCountEl.textContent = hw.crash.crashCount;
            if (hw.crash.crashCount > 0) {
                crashCountEl.style.color = '#ffc800';
            }
        }
        
        // Last checkpoint
        const checkpointEl = document.getElementById('safety-checkpoint');
        if (checkpointEl) {
            if (this.checkpoints.length > 0) {
                const lastCp = this.checkpoints[this.checkpoints.length - 1];
                const age = Math.round((Date.now() - lastCp.time) / 1000);
                checkpointEl.textContent = `${age}s ago (line ${lastCp.lineNumber})`;
            } else {
                checkpointEl.textContent = 'None';
            }
        }
    }
    
    /**
     * Update spindle status UI
     */
    _updateSpindleStatusUI() {
        const spindle = this.hardwareState.spindle;
        
        // Status
        const statusEl = document.getElementById('spindle-status');
        if (statusEl) {
            const stateColors = {
                'off': '#888',
                'warmup': '#ffc800',
                'ready': '#44ff44',
                'running': '#44ff44'
            };
            statusEl.textContent = spindle.state.charAt(0).toUpperCase() + spindle.state.slice(1);
            statusEl.style.color = stateColors[spindle.state] || '#888';
        }
        
        // Bearing health
        const bearingEl = document.getElementById('spindle-bearing-health');
        if (bearingEl) {
            bearingEl.textContent = `${spindle.bearingHealth.toFixed(0)}%`;
            bearingEl.style.color = spindle.bearingHealth > 80 ? '#44ff44' :
                                    spindle.bearingHealth > 50 ? '#ffc800' : '#ff4444';
        }
        
        // Warmup needed
        const warmupNeededEl = document.getElementById('spindle-warmup-needed');
        if (warmupNeededEl) {
            warmupNeededEl.textContent = spindle.needsWarmup ? 'Yes' : 'No';
            warmupNeededEl.style.color = spindle.needsWarmup ? '#ffc800' : '#44ff44';
        }
        
        // Warmup progress bar
        const warmupContainer = document.getElementById('spindle-warmup-container');
        const warmupProgress = document.getElementById('spindle-warmup-progress');
        if (warmupContainer && warmupProgress) {
            if (spindle.state === 'warmup') {
                warmupContainer.style.display = 'block';
                warmupProgress.style.width = `${spindle.warmupProgress}%`;
                warmupProgress.textContent = `${spindle.warmupProgress}%`;
            } else {
                warmupContainer.style.display = 'none';
            }
        }
    }
    
    /**
     * Update environment UI
     */
    _updateEnvironmentUI() {
        const env = this.hardwareState.environment;
        const enc = this.hardwareState.enclosure;
        
        // Ambient temp
        const tempEl = document.getElementById('env-ambient-temp');
        if (tempEl) {
            const tempColor = env.ambientTemp > this.safetyConfig.maxAmbientTemp ? '#ff4444' :
                             env.ambientTemp < this.safetyConfig.minAmbientTemp ? '#4488ff' : '#44ff44';
            tempEl.innerHTML = `<span style="color:${tempColor}">${env.ambientTemp.toFixed(1)}°C</span>`;
        }
        
        // Humidity
        const humidityEl = document.getElementById('env-humidity');
        if (humidityEl) {
            const humidColor = env.ambientHumidity > this.safetyConfig.maxHumidity ? '#ffc800' : '#44ff44';
            humidityEl.innerHTML = `<span style="color:${humidColor}">${env.ambientHumidity.toFixed(0)}%</span>`;
        }
        
        // Enclosure
        const enclosureEl = document.getElementById('env-enclosure');
        if (enclosureEl) {
            if (!enc.hasDoor) {
                enclosureEl.textContent = 'No enclosure';
            } else if (enc.doorOpen) {
                enclosureEl.innerHTML = '<span style="color:#ffc800">Door Open</span>';
            } else {
                enclosureEl.innerHTML = '<span style="color:#44ff44">Closed</span>';
            }
        }
    }
    
    /**
     * Update accessories UI
     */
    _updateAccessoriesUI() {
        const dc = this.hardwareState.dustCollection;
        const vac = this.hardwareState.vacuum;
        const air = this.hardwareState.airBlast;
        const lube = this.hardwareState.lubrication;
        
        // Dust collection
        const dustIcon = document.getElementById('acc-dust');
        if (dustIcon) {
            dustIcon.textContent = dc.running ? '🟢' : (dc.connected ? '⚪' : '⚫');
            dustIcon.className = 'acc-icon ' + (dc.running ? 'on' : 'off');
        }
        
        // Vacuum
        const vacIcon = document.getElementById('acc-vacuum');
        if (vacIcon) {
            vacIcon.textContent = vac.enabled ? '🟢' : (vac.connected ? '⚪' : '⚫');
            vacIcon.className = 'acc-icon ' + (vac.enabled ? 'on' : 'off');
        }
        
        // Air blast
        const airIcon = document.getElementById('acc-air');
        if (airIcon) {
            airIcon.textContent = air.enabled ? '🟢' : (air.connected ? '⚪' : '⚫');
            airIcon.className = 'acc-icon ' + (air.enabled ? 'on' : 'off');
        }
        
        // Lubrication
        const lubeIcon = document.getElementById('acc-lube');
        if (lubeIcon) {
            lubeIcon.textContent = lube.enabled ? '🟢' : (lube.connected ? '⚪' : '⚫');
            lubeIcon.className = 'acc-icon ' + (lube.enabled ? 'on' : 'off');
        }
    }
    
    /**
     * Update tool status UI
     */
    _updateToolUI() {
        const tool = this.hardwareState.tool;
        
        // Current tool
        const toolCurrentEl = document.getElementById('tool-current');
        if (toolCurrentEl) {
            toolCurrentEl.textContent = `T${tool.current}`;
        }
        
        // Tool condition
        const conditionEl = document.getElementById('tool-condition');
        if (conditionEl) {
            const condColors = { 'ok': '#44ff44', 'worn': '#ffc800', 'broken': '#ff4444' };
            conditionEl.textContent = tool.condition.toUpperCase();
            conditionEl.style.color = condColors[tool.condition] || '#888';
        }
        
        // Runout
        const runoutEl = document.getElementById('tool-runout');
        if (runoutEl) {
            if (tool.runoutMm > 0) {
                const runoutColor = tool.runoutMm > 0.05 ? '#ff4444' : 
                                   tool.runoutMm > 0.02 ? '#ffc800' : '#44ff44';
                runoutEl.innerHTML = `<span style="color:${runoutColor}">${(tool.runoutMm * 1000).toFixed(1)} µm</span>`;
            } else {
                runoutEl.textContent = '--';
            }
        }
        
        // Tool probe button
        const probeBtnEl = document.getElementById('tool-probe-btn');
        if (probeBtnEl) {
            probeBtnEl.disabled = !tool.setterAvailable;
        }
    }
    
    /**
     * Toggle auto dust collection
     */
    toggleDustAuto(enabled) {
        this.hardwareState.dustCollection.autoMode = enabled;
        console.log(`[Accessories] Auto dust collection: ${enabled ? 'enabled' : 'disabled'}`);
    }
    
    /**
     * Show full safety status in modal
     */
    showSafetyStatus() {
        const hw = this.hardwareState;
        
        const modal = document.createElement('div');
        modal.id = 'safety-status-modal';
        modal.innerHTML = `
            <div class="safety-modal-overlay">
                <div class="safety-modal">
                    <h2>🛡️ Safety Systems Status</h2>
                    
                    <div class="safety-status-grid">
                        <div class="safety-status-item ${this.features.crashPrevention ? 'enabled' : 'disabled'}">
                            <h3>Crash Prevention</h3>
                            <div>StallGuard Threshold: ${this.safetyConfig.sgCrashThreshold}</div>
                            <div>Accelerometer Threshold: ${this.safetyConfig.accelCrashThreshold}g</div>
                            <div>Crash Count: ${hw.crash.crashCount}</div>
                            <div>Status: ${hw.crash.detected ? '⚠️ CRASH DETECTED' : 
                                          hw.crash.imminent ? '⚠️ CRASH IMMINENT' : '✅ Normal'}</div>
                        </div>
                        
                        <div class="safety-status-item ${this.features.autoRetract ? 'enabled' : 'disabled'}">
                            <h3>Auto Retract</h3>
                            <div>Retract Height: ${this.safetyConfig.retractHeight}mm</div>
                            <div>On Alarm: ${this.safetyConfig.retractOnAlarm ? 'Yes' : 'No'}</div>
                            <div>On Crash: ${this.safetyConfig.retractOnCrash ? 'Yes' : 'No'}</div>
                        </div>
                        
                        <div class="safety-status-item ${hw.enclosure.hasDoor ? 'enabled' : 'disabled'}">
                            <h3>Enclosure</h3>
                            <div>Door: ${hw.enclosure.doorOpen ? '⚠️ OPEN' : '✅ Closed'}</div>
                            <div>Interlock: ${hw.enclosure.doorInterlockActive ? 'Active' : 'Inactive'}</div>
                            <div>Inside Temp: ${hw.enclosure.tempInside}°C</div>
                            <div>Fan: ${hw.enclosure.fanRunning ? 'Running' : 'Off'}</div>
                        </div>
                        
                        <div class="safety-status-item ${this.features.fireDetection ? 'enabled' : 'disabled'}">
                            <h3>Fire Detection</h3>
                            <div>Status: ${hw.environment.fireAlarm ? '🔥 ALARM!' : '✅ Normal'}</div>
                            <div>Gas Alarm: ${hw.environment.gasAlarm ? '⚠️ DETECTED' : '✅ Clear'}</div>
                        </div>
                        
                        <div class="safety-status-item enabled">
                            <h3>Network</h3>
                            <div>WebSocket: ${hw.network.wsConnected ? '✅ Connected' : '❌ Disconnected'}</div>
                            <div>Reconnect Attempts: ${hw.network.reconnectAttempts}</div>
                            <div>UPS: ${hw.network.upsConnected ? 
                                (hw.network.upsOnBattery ? `⚠️ On Battery (${hw.network.upsBatteryPercent}%)` : '✅ AC Power') : 
                                'Not Connected'}</div>
                        </div>
                        
                        <div class="safety-status-item enabled">
                            <h3>Job Recovery</h3>
                            <div>Checkpoints: ${this.checkpoints.length}/${this.safetyConfig.maxCheckpoints}</div>
                            <div>Interval: ${this.safetyConfig.checkpointInterval}s</div>
                            ${this.checkpoints.length > 0 ? 
                                `<div>Last: Line ${this.checkpoints[this.checkpoints.length-1].lineNumber}</div>` : ''}
                        </div>
                    </div>
                    
                    <div class="safety-modal-actions">
                        <button onclick="document.getElementById('safety-status-modal').remove()" class="btn">Close</button>
                        ${this.checkpoints.length > 0 ? 
                            '<button onclick="window.app?.enhancements?.recoverFromCheckpoint?.()" class="btn btn-action">Recover from Checkpoint</button>' : ''}
                    </div>
                </div>
            </div>
        `;
        
        // Add styles if not present
        if (!document.getElementById('safety-modal-styles')) {
            const styles = document.createElement('style');
            styles.id = 'safety-modal-styles';
            styles.textContent = `
                .safety-modal-overlay {
                    position: fixed; top: 0; left: 0; right: 0; bottom: 0;
                    background: rgba(0,0,0,0.8); z-index: 9500;
                    display: flex; align-items: center; justify-content: center;
                }
                .safety-modal {
                    background: #1a1a2e; border-radius: 10px; padding: 20px;
                    max-width: 700px; width: 90%; max-height: 80vh; overflow-y: auto;
                    border: 2px solid #4488ff;
                }
                .safety-modal h2 { color: #fff; margin-top: 0; }
                .safety-status-grid {
                    display: grid; grid-template-columns: repeat(2, 1fr);
                    gap: 15px; margin: 20px 0;
                }
                .safety-status-item {
                    background: rgba(0,0,0,0.3); border-radius: 8px; padding: 12px;
                }
                .safety-status-item.enabled { border-left: 3px solid #44ff44; }
                .safety-status-item.disabled { border-left: 3px solid #666; opacity: 0.7; }
                .safety-status-item h3 { margin: 0 0 10px 0; font-size: 14px; color: #fff; }
                .safety-status-item div { font-size: 12px; color: #aaa; padding: 3px 0; }
                .safety-modal-actions {
                    display: flex; gap: 10px; justify-content: flex-end; margin-top: 15px;
                }
            `;
            document.head.appendChild(styles);
        }
        
        document.getElementById('safety-status-modal')?.remove();
        document.body.appendChild(modal);
    }
    
    /**
     * Set whether chiller alarm is wired to safety door input
     */
    setChillerOnDoorPin(enabled) {
        if (!this.features) this.features = {};
        this.features.chillerOnDoorPin = enabled;
        this.saveToStorage('features', this.features);
        console.log(`[Coolant] Chiller alarm → Safety Door pin: ${enabled ? 'enabled' : 'disabled'}`);
    }
    
    _updateGauge(id, value) {
        const gauge = document.getElementById(id);
        if (!gauge) return;
        
        const percent = Math.max(0, Math.min(100, value || 0));
        const color = percent > 70 ? '#44ff44' : percent > 40 ? '#ffc800' : '#ff4444';
        
        gauge.style.background = `conic-gradient(${color} 0%, ${color} ${percent}%, #333 ${percent}%)`;
        const spanEl = gauge.querySelector('span');
        if (spanEl) spanEl.textContent = Math.round(percent);
    }
    
    updateMaintenanceUI() {
        const container = document.getElementById('maintenance-alerts');
        if (!container) return;
        
        const alerts = this.checkMaintenanceAlerts();
        container.innerHTML = alerts.map(a => `
            <div class="maintenance-alert ${a.type}">
                <strong>${a.component}</strong><br>
                ${a.message}
            </div>
        `).join('');
    }
    
    togglePanel() {
        const panel = document.getElementById('enhancements-panel');
        panel?.classList.toggle('open');
    }
    
    toggleAdaptiveFeed(enabled) {
        this.adaptiveFeed.enabled = enabled;
    }
    
    toggleVoice(enabled) {
        this.voice.enabled = enabled;
    }
    
    // Learning data UI helpers
    exportLearningUI() {
        const data = this.exportLearningData();
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `fluidcnc-learning-${new Date().toISOString().slice(0,10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
        this.speak('Learning data exported');
    }
    
    importLearningUI() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.onchange = (e) => {
            const file = e.target.files[0];
            if (!file) return;
            
            const reader = new FileReader();
            reader.onload = (ev) => {
                try {
                    const data = JSON.parse(ev.target.result);
                    if (this.importLearningData(data)) {
                        this.speak('Learning data imported successfully');
                        this.updateIntelligenceUI();
                    }
                } catch (err) {
                    alert('Invalid learning data file');
                }
            };
            reader.readAsText(file);
        };
        input.click();
    }
    
    confirmResetLearning() {
        if (confirm('Reset all machine learning data? This cannot be undone!')) {
            this.resetLearning();
            this.speak('Learning data reset');
            this.updateIntelligenceUI();
        }
    }
    
    // ================================================================
    // STORAGE HELPERS
    // ================================================================
    
    saveToStorage(key, value) {
        try {
            localStorage.setItem(`fluidcnc_${key}`, JSON.stringify(value));
        } catch (e) {
            if (e.name === 'QuotaExceededError') {
                // Try to free space by removing old non-critical data
                try {
                    localStorage.removeItem('fluidcnc_jobStats');
                    localStorage.setItem(`fluidcnc_${key}`, JSON.stringify(value));
                    console.warn('[Storage] Freed space by removing old job stats');
                    return;
                } catch (e2) {
                    // Still failed - notify user
                    this.app?.showNotification?.('Storage full - maintenance data may be lost', 'warning');
                }
            }
            console.error('[Storage] Save failed:', e);
        }
    }
    
    loadFromStorage(key, defaultValue) {
        try {
            const val = localStorage.getItem(`fluidcnc_${key}`);
            return val ? JSON.parse(val) : defaultValue;
        } catch (e) {
            return defaultValue;
        }
    }
    
    formatTime(seconds) {
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        return h > 0 ? `${h}h ${m}m` : `${m}m`;
    }
    
    /**
     * CRITICAL: Cleanup method to prevent memory leaks
     * Must be called when module is unloaded or app is destroyed
     */
    destroy() {
        // Clear maintenance tracking interval
        if (this.maintenanceInterval) {
            clearInterval(this.maintenanceInterval);
            this.maintenanceInterval = null;
        }
        
        // Clear UI update interval
        if (this.uiUpdateInterval) {
            clearInterval(this.uiUpdateInterval);
            this.uiUpdateInterval = null;
        }
        
        // Clear hardware integration intervals
        if (this.intelligenceInterval) {
            clearInterval(this.intelligenceInterval);
            this.intelligenceInterval = null;
        }
        if (this.grblCheckInterval) {
            clearInterval(this.grblCheckInterval);
            this.grblCheckInterval = null;
        }
        if (this.vfdCheckInterval) {
            clearInterval(this.vfdCheckInterval);
            this.vfdCheckInterval = null;
        }
        
        // Remove injected UI elements
        document.getElementById('enhancements-panel')?.remove();
        
        // Cancel any pending speech synthesis
        if ('speechSynthesis' in window) {
            speechSynthesis.cancel();
        }
        
        // Reset feed override to 100% for safety
        this.resetFeedOverride();
        
        console.log('🧹 Machine Intelligence cleaned up');
    }
}

// Note: Camera is handled by camera-module.js (CameraModule class)
// which provides plug-and-play USB + WiFi AP support for XIAO ESP32-S3 Sense

// Export for module use
if (typeof module !== 'undefined') {
    module.exports = { MachineEnhancements };
}
