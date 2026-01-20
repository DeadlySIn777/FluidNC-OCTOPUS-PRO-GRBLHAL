/* ========================================
   FluidCNC - AI Assistant Module
   
   Features:
   - Natural language CNC commands
   - G-code optimization & analysis
   - Smart feeds/speeds recommendations
   - Anomaly detection from machine state
   - Voice command support
   - Conversational CNC helper
   ======================================== */

class CNCAssistant {
    constructor(options = {}) {
        this.grbl = options.grbl || null;
        this.onResponse = options.onResponse || ((msg) => console.log('[AI]', msg));
        this.onCommand = options.onCommand || (() => {});
        this.onError = options.onError || ((err) => console.error('[AI Error]', err));
        
        // Machine state getter for contextual awareness
        this.getMachineState = options.getMachineState || (() => ({}));
        
        // Machine context for smarter responses
        this.machineConfig = {
            workArea: { x: 400, y: 400, z: 200 },
            spindleMax: 24000,
            spindleMin: 6000,
            maxFeedXY: 10000,
            maxFeedZ: 3000,
            toolCount: 5,
            toolSpacing: 50.4 // mm between tool pockets
        };
        
        // Material database for feeds/speeds
        this.materials = {
            aluminum: { 
                sfm: { carbide: 800, hss: 300 },
                chipLoad: { '3mm': 0.05, '6mm': 0.1, '10mm': 0.15 },
                doc: { rough: 0.5, finish: 0.2 } // multiplier of tool diameter
            },
            steel: {
                sfm: { carbide: 400, hss: 100 },
                chipLoad: { '3mm': 0.03, '6mm': 0.06, '10mm': 0.1 },
                doc: { rough: 0.3, finish: 0.1 }
            },
            wood: {
                sfm: { carbide: 1500, hss: 800 },
                chipLoad: { '3mm': 0.15, '6mm': 0.25, '10mm': 0.4 },
                doc: { rough: 1.0, finish: 0.5 }
            },
            plastic: {
                sfm: { carbide: 1200, hss: 600 },
                chipLoad: { '3mm': 0.1, '6mm': 0.18, '10mm': 0.25 },
                doc: { rough: 0.8, finish: 0.3 }
            },
            brass: {
                sfm: { carbide: 600, hss: 200 },
                chipLoad: { '3mm': 0.06, '6mm': 0.12, '10mm': 0.18 },
                doc: { rough: 0.4, finish: 0.15 }
            },
            foam: {
                sfm: { carbide: 2000, hss: 1500 },
                chipLoad: { '3mm': 0.3, '6mm': 0.5, '10mm': 0.8 },
                doc: { rough: 2.0, finish: 1.0 }
            }
        };
        
        // Command patterns for NLP
        this.commandPatterns = [
            // ============================================================
            // EMERGENCY / SAFETY COMMANDS (highest priority)
            // ============================================================
            { pattern: /^stop$/i, action: 'stop', extract: () => ({}) },
            { pattern: /^halt$/i, action: 'stop', extract: () => ({}) },
            { pattern: /^freeze$/i, action: 'stop', extract: () => ({}) },
            { pattern: /^abort$/i, action: 'stop', extract: () => ({}) },
            { pattern: /^whoa$/i, action: 'stop', extract: () => ({}) },
            { pattern: /(?:emergency\s+)?stop(?:\s+everything)?/i, action: 'estop', extract: () => ({}) },
            { pattern: /e[\-\s]?stop/i, action: 'estop', extract: () => ({}) },
            { pattern: /kill\s+(?:it|everything|all|machine)/i, action: 'estop', extract: () => ({}) },
            
            // ============================================================
            // MOVEMENT COMMANDS (voice-optimized)
            // ============================================================
            // Jog with distance - "jog X 10", "move X ten millimeters", "X plus 5"
            { pattern: /(?:jog|move|go)\s+([xyz])\s*(?:axis\s+)?(?:by\s+)?([-+]?\d+(?:\.\d+)?)\s*(?:mm|millimeters?)?/i, 
              action: 'jog', extract: (m) => ({ axis: m[1].toUpperCase(), distance: parseFloat(m[2]) }) },
            { pattern: /([xyz])\s+(?:plus|positive|forward)\s*(\d+(?:\.\d+)?)/i, 
              action: 'jog', extract: (m) => ({ axis: m[1].toUpperCase(), distance: parseFloat(m[2]) }) },
            { pattern: /([xyz])\s+(?:minus|negative|back(?:ward)?)\s*(\d+(?:\.\d+)?)/i, 
              action: 'jog', extract: (m) => ({ axis: m[1].toUpperCase(), distance: -parseFloat(m[2]) }) },
            
            // Direction-based jog - "go up", "move left", "jog down 10"
            { pattern: /(?:jog|move|go)\s+(?:up|raise|lift)(?:\s+(\d+(?:\.\d+)?))?/i,
              action: 'jog', extract: (m) => ({ axis: 'Z', distance: parseFloat(m[1]) || 5 }) },
            { pattern: /(?:jog|move|go)\s+(?:down|lower|drop)(?:\s+(\d+(?:\.\d+)?))?/i,
              action: 'jog', extract: (m) => ({ axis: 'Z', distance: -(parseFloat(m[1]) || 5) }) },
            { pattern: /(?:jog|move|go)\s+(?:left)(?:\s+(\d+(?:\.\d+)?))?/i,
              action: 'jog', extract: (m) => ({ axis: 'X', distance: -(parseFloat(m[1]) || 10) }) },
            { pattern: /(?:jog|move|go)\s+(?:right)(?:\s+(\d+(?:\.\d+)?))?/i,
              action: 'jog', extract: (m) => ({ axis: 'X', distance: parseFloat(m[1]) || 10 }) },
            { pattern: /(?:jog|move|go)\s+(?:forward|front|towards?)(?:\s+(\d+(?:\.\d+)?))?/i,
              action: 'jog', extract: (m) => ({ axis: 'Y', distance: parseFloat(m[1]) || 10 }) },
            { pattern: /(?:jog|move|go)\s+(?:back(?:ward)?|rear|away)(?:\s+(\d+(?:\.\d+)?))?/i,
              action: 'jog', extract: (m) => ({ axis: 'Y', distance: -(parseFloat(m[1]) || 10) }) },
              
            // Move to position - "go to X 100", "move to X 50 Y 50"
            { pattern: /(?:go|move|rapid)\s+to\s+([xyz])\s*([-+]?\d+(?:\.\d+)?)/i,
              action: 'moveTo', extract: (m) => ({ axis: m[1].toUpperCase(), pos: parseFloat(m[2]) }) },
            { pattern: /(?:rapid|go)\s+to\s+(?:x\s*)?([-+]?\d+(?:\.\d+)?)\s*[,\s]+(?:y\s*)?([-+]?\d+(?:\.\d+)?)/i,
              action: 'rapidXY', extract: (m) => ({ x: parseFloat(m[1]), y: parseFloat(m[2]) }) },
              
            // Safe Z movements
            { pattern: /safe\s+z|(?:move|go)\s+to\s+safe\s+(?:z|height)/i,
              action: 'safeZ', extract: () => ({}) },
            { pattern: /(?:clearance|retract|pull\s+up)/i,
              action: 'safeZ', extract: () => ({}) },
            
            // ============================================================
            // HOMING
            // ============================================================
            { pattern: /home\s*(?:the\s+)?(?:machine|all|everything)?$/i, 
              action: 'home', extract: () => ({ axes: 'ALL' }) },
            { pattern: /home\s*([xyz]+)/i, 
              action: 'home', extract: (m) => ({ axes: m[1].toUpperCase() }) },
            { pattern: /(?:go|send|move)\s+home/i, 
              action: 'home', extract: () => ({ axes: 'ALL' }) },
            
            // ============================================================
            // ZEROING / WORK COORDINATES
            // ============================================================
            { pattern: /(?:zero|set\s*zero|set\s+origin)\s*(?:here)?$/i,
              action: 'zero', extract: () => ({ axes: 'XYZ' }) },
            { pattern: /(?:zero|set\s*zero)\s*(?:the\s+)?([xyz]+)/i,
              action: 'zero', extract: (m) => ({ axes: m[1].toUpperCase() }) },
            { pattern: /(?:this\s+is|set)\s+(?:x|y|z)?\s*zero/i,
              action: 'zero', extract: () => ({ axes: 'XYZ' }) },
            { pattern: /touch\s+off/i,
              action: 'zero', extract: () => ({ axes: 'Z' }) },
            
            // ============================================================
            // SPINDLE CONTROL (voice-friendly)
            // ============================================================
            { pattern: /spindle\s+on(?:\s+(?:at\s+)?(\d+)(?:\s*rpm)?)?/i,
              action: 'spindleOn', extract: (m) => ({ rpm: m[1] ? parseInt(m[1]) : 12000 }) },
            { pattern: /spindle\s+(?:off|stop)/i, action: 'spindleOff', extract: () => ({}) },
            { pattern: /(?:start|turn\s+on|run)\s+(?:the\s+)?spindle(?:\s+(?:at\s+)?(\d+))?/i, 
              action: 'spindleOn', extract: (m) => ({ rpm: m[1] ? parseInt(m[1]) : 12000 }) },
            { pattern: /(?:stop|turn\s+off|kill)\s+(?:the\s+)?spindle/i, 
              action: 'spindleOff', extract: () => ({}) },
            { pattern: /spindle\s+(?:to\s+)?(\d+)(?:\s*rpm)?/i,
              action: 'spindleSpeed', extract: (m) => ({ rpm: parseInt(m[1]) }) },
            { pattern: /(?:set\s+)?(?:rpm|speed)\s+(?:to\s+)?(\d+)/i,
              action: 'spindleSpeed', extract: (m) => ({ rpm: parseInt(m[1]) }) },
            
            // ============================================================
            // COOLANT
            // ============================================================
            { pattern: /(?:coolant|flood)\s+on/i, action: 'coolantOn', extract: () => ({ type: 'flood' }) },
            { pattern: /mist\s+on/i, action: 'coolantOn', extract: () => ({ type: 'mist' }) },
            { pattern: /(?:coolant|flood|mist)\s+off/i, action: 'coolantOff', extract: () => ({}) },
            { pattern: /(?:turn\s+on|start)\s+(?:the\s+)?(?:coolant|flood|mist)/i, 
              action: 'coolantOn', extract: () => ({ type: 'flood' }) },
            { pattern: /(?:turn\s+off|stop)\s+(?:the\s+)?(?:coolant|flood|mist)/i, 
              action: 'coolantOff', extract: () => ({}) },
            
            // ============================================================
            // TOOL CHANGE
            // ============================================================
            { pattern: /(?:change|load|select|use)\s+tool\s*(\d+)/i,
              action: 'toolChange', extract: (m) => ({ tool: parseInt(m[1]) }) },
            { pattern: /tool\s*(\d+)/i,
              action: 'toolChange', extract: (m) => ({ tool: parseInt(m[1]) }) },
            { pattern: /(?:next|change)\s+tool/i,
              action: 'nextTool', extract: () => ({}) },
            
            // ============================================================
            // PROBING
            // ============================================================
            { pattern: /probe\s+(?:the\s+)?(?:z|top|surface|height)/i, action: 'probeZ', extract: () => ({}) },
            { pattern: /probe\s+(?:the\s+)?(?:corner|xy|edge)/i, action: 'probeCorner', extract: () => ({}) },
            { pattern: /(?:find|measure)\s+(?:tool\s+)?(?:length|height)/i, action: 'probeTool', extract: () => ({}) },
            { pattern: /(?:auto\s*)?(?:level|measure)\s+(?:the\s+)?(?:bed|surface)/i, action: 'autoLevel', extract: () => ({}) },
            
            // ============================================================
            // JOB CONTROL
            // ============================================================
            { pattern: /run\s+(?:the\s+)?(?:job|program|gcode|file)/i, action: 'runJob', extract: () => ({}) },
            { pattern: /(?:start|begin)\s+(?:the\s+)?(?:job|cut|program|machining)/i, action: 'runJob', extract: () => ({}) },
            { pattern: /(?:let's|lets)\s+go/i, action: 'runJob', extract: () => ({}) },
            { pattern: /^go$/i, action: 'runJob', extract: () => ({}) },
            { pattern: /(?:pause|hold|wait)/i, action: 'pause', extract: () => ({}) },
            { pattern: /(?:resume|continue|unpause)/i, action: 'resume', extract: () => ({}) },
            { pattern: /(?:cancel|abort)\s+(?:the\s+)?(?:job|cut|program)/i, action: 'cancelJob', extract: () => ({}) },
            
            // ============================================================
            // FEED OVERRIDE
            // ============================================================
            { pattern: /(?:feed|speed)\s+(?:at\s+)?(\d+)\s*(?:percent|%)/i,
              action: 'feedOverride', extract: (m) => ({ percent: parseInt(m[1]) }) },
            { pattern: /(?:increase|raise|bump\s+up)\s+(?:the\s+)?feed(?:\s+by\s+(\d+))?/i,
              action: 'feedAdjust', extract: (m) => ({ delta: parseFloat(m[1]) || 10 }) },
            { pattern: /(?:decrease|lower|slow\s+down)\s+(?:the\s+)?feed(?:\s+by\s+(\d+))?/i,
              action: 'feedAdjust', extract: (m) => ({ delta: -(parseFloat(m[1]) || 10) }) },
            { pattern: /(?:faster|speed\s+up)(?:\s+(\d+))?/i,
              action: 'feedAdjust', extract: (m) => ({ delta: parseFloat(m[1]) || 10 }) },
            { pattern: /(?:slower|slow\s+down)(?:\s+(\d+))?/i,
              action: 'feedAdjust', extract: (m) => ({ delta: -(parseFloat(m[1]) || 10) }) },
            { pattern: /(?:full|normal)\s+(?:feed|speed)/i,
              action: 'feedOverride', extract: () => ({ percent: 100 }) },
            { pattern: /half\s+(?:feed|speed)/i,
              action: 'feedOverride', extract: () => ({ percent: 50 }) },
            
            // ============================================================
            // STATUS / INFO
            // ============================================================
            { pattern: /(?:what's|whats|what\s+is)\s+(?:the\s+)?(?:status|state|position)/i, action: 'status', extract: () => ({}) },
            { pattern: /(?:where|position)\s*(?:are\s+we|am\s+i)?/i, action: 'status', extract: () => ({}) },
            { pattern: /status/i, action: 'status', extract: () => ({}) },
            { pattern: /(?:how's|how\s+is)\s+(?:it|the\s+machine)\s+(?:doing|going)/i, action: 'status', extract: () => ({}) },
            { pattern: /(?:show|display)\s+(?:me\s+)?(?:the\s+)?position/i, action: 'status', extract: () => ({}) },
            
            // ============================================================
            // FEEDS/SPEEDS SUGGESTIONS
            // ============================================================
            { pattern: /(?:what|suggest|recommend)\s+(?:feeds?|speeds?|rpm|parameters?)\s+(?:for\s+)?(\w+)(?:\s+with\s+)?(?:a?\s*)?(\d+(?:\.\d+)?)\s*(?:mm)?\s*(?:end\s*mill|bit|tool)?/i,
              action: 'suggestFS', extract: (m) => ({ material: m[1], toolDia: parseFloat(m[2]) }) },
            { pattern: /(?:feeds?\s+(?:and\s+)?speeds?|parameters?)\s+(?:for\s+)?(\w+)/i,
              action: 'suggestFS', extract: (m) => ({ material: m[1], toolDia: 6 }) },
            
            // ============================================================
            // ANALYSIS
            // ============================================================
            { pattern: /(?:analyze|check|review|examine)\s+(?:the\s+)?(?:gcode|code|file|program)/i,
              action: 'analyzeGcode', extract: () => ({}) },
            
            // ============================================================
            // VOICE CONTROL
            // ============================================================
            { pattern: /(?:voice|mic|microphone)\s+(?:on|start|enable|activate)/i, action: 'voiceOn', extract: () => ({}) },
            { pattern: /(?:voice|mic|microphone)\s+(?:off|stop|disable|deactivate)/i, action: 'voiceOff', extract: () => ({}) },
            { pattern: /(?:start|enable|turn\s+on)\s+(?:voice|listening|speech)/i, action: 'voiceOn', extract: () => ({}) },
            { pattern: /(?:stop|disable|turn\s+off)\s+(?:voice|listening|speech)/i, action: 'voiceOff', extract: () => ({}) },
            { pattern: /(?:i'?m\s+done|stop\s+listening|that's?\s+all|bye|goodbye)/i, action: 'voiceOff', extract: () => ({}) },
            
            // ============================================================
            // CONFIRMATIONS (for pending actions)
            // ============================================================
            { pattern: /^(?:yes|yeah|yep|yup|correct|confirm|affirmative|do\s+it|okay|ok|go|proceed)$/i, 
              action: 'confirm', extract: () => ({}) },
            { pattern: /^(?:no|nope|nah|cancel|abort|nevermind|never\s+mind|don't|dont)$/i, 
              action: 'deny', extract: () => ({}) },
            
            // ============================================================
            // CHATTER DETECTION CONTROL
            // ============================================================
            { pattern: /(?:chatter|vibration)\s+(?:detection\s+)?(?:on|enable|start)/i, 
              action: 'chatterOn', extract: () => ({}) },
            { pattern: /(?:chatter|vibration)\s+(?:detection\s+)?(?:off|disable|stop)/i, 
              action: 'chatterOff', extract: () => ({}) },
            
            // ============================================================
            // HELP
            // ============================================================
            { pattern: /^help$/i, action: 'help', extract: () => ({}) },
            { pattern: /what\s+can\s+(?:you|i)\s+(?:do|say)/i, action: 'help', extract: () => ({}) },
            { pattern: /(?:show|list)\s+(?:me\s+)?(?:the\s+)?(?:commands?|options?)/i, action: 'help', extract: () => ({}) },
            { pattern: /\?$/i, action: 'help', extract: () => ({}) }
        ];
        
        // Unit conversion system
        this.units = {
            // Length conversions (all to mm)
            length: {
                'mm': 1,
                'millimeter': 1,
                'millimeters': 1,
                'cm': 10,
                'centimeter': 10,
                'centimeters': 10,
                'm': 1000,
                'meter': 1000,
                'meters': 1000,
                'in': 25.4,
                'inch': 25.4,
                'inches': 25.4,
                '"': 25.4,
                'ft': 304.8,
                'foot': 304.8,
                'feet': 304.8,
                'thou': 0.0254,
                'mil': 0.0254,
                'mils': 0.0254
            },
            // Speed conversions (all to mm/min)
            speed: {
                'mm/min': 1,
                'mmpm': 1,
                'mm/m': 1,
                'mm/sec': 60,
                'mm/s': 60,
                'mmps': 60,
                'cm/min': 10,
                'cm/sec': 600,
                'cm/s': 600,
                'm/min': 1000,
                'mpm': 1000,
                'm/sec': 60000,
                'm/s': 60000,
                'in/min': 25.4,
                'ipm': 25.4,
                'in/sec': 1524,
                'ips': 1524,
                'ft/min': 304.8,
                'fpm': 304.8,
                'sfm': 304.8  // Surface feet per minute (linear)
            },
            // Acceleration (all to mm/sec²)
            acceleration: {
                'mm/s2': 1,
                'mm/s^2': 1,
                'mm/sec2': 1,
                'mm/sec^2': 1,
                'mm/ss': 1,
                'm/s2': 1000,
                'm/s^2': 1000,
                'in/s2': 25.4,
                'in/s^2': 25.4,
                'g': 9806.65  // 1g = 9806.65 mm/s²
            },
            // RPM (already universal)
            rpm: {
                'rpm': 1,
                'rev/min': 1,
                'revs': 1
            },
            // Time (all to seconds)
            time: {
                's': 1,
                'sec': 1,
                'second': 1,
                'seconds': 1,
                'ms': 0.001,
                'millisecond': 0.001,
                'milliseconds': 0.001,
                'min': 60,
                'minute': 60,
                'minutes': 60,
                'hr': 3600,
                'hour': 3600,
                'hours': 3600
            }
        };
        
        // Common unit aliases for smarter parsing
        this.unitAliases = {
            'millimeters per minute': 'mm/min',
            'millimeters per second': 'mm/sec',
            'inches per minute': 'in/min',
            'inches per second': 'in/sec',
            'feet per minute': 'ft/min',
            'meters per minute': 'm/min',
            'meters per second': 'm/sec'
        };
        
        // Anomaly thresholds
        this.anomalyThresholds = {
            feedDeviation: 0.3, // 30% deviation from expected
            spindleLoadHigh: 80, // percentage
            rapidInMaterial: true,
            suddenStop: true
        };
        
        // Limits checking enabled by default
        this.enforceLimits = true;
        
        // Voice recognition
        this.voiceEnabled = false;
        this.recognition = null;
        
        // Conversation history for context
        this.conversationHistory = [];
        this.maxHistory = 10;
        
        // Pending context for multi-turn conversations
        this.pendingContext = null;
        
        // Settings database with GRBL codes and descriptions
        this.settingsDatabase = {
            'x max speed': { code: '$110', unit: 'mm/min', description: 'X-axis maximum speed', currentValue: 10000 },
            'x max rate': { code: '$110', unit: 'mm/min', description: 'X-axis maximum speed', currentValue: 10000 },
            'y max speed': { code: '$111', unit: 'mm/min', description: 'Y-axis maximum speed', currentValue: 10000 },
            'y max rate': { code: '$111', unit: 'mm/min', description: 'Y-axis maximum speed', currentValue: 10000 },
            'z max speed': { code: '$112', unit: 'mm/min', description: 'Z-axis maximum speed', currentValue: 6500 },
            'z max rate': { code: '$112', unit: 'mm/min', description: 'Z-axis maximum speed', currentValue: 6500 },
            'x acceleration': { code: '$120', unit: 'mm/sec²', description: 'X-axis acceleration', currentValue: 500 },
            'y acceleration': { code: '$121', unit: 'mm/sec²', description: 'Y-axis acceleration', currentValue: 500 },
            'z acceleration': { code: '$122', unit: 'mm/sec²', description: 'Z-axis acceleration', currentValue: 400 },
            'spindle max': { code: '$30', unit: 'RPM', description: 'Maximum spindle speed', currentValue: 24000 },
            'spindle min': { code: '$31', unit: 'RPM', description: 'Minimum spindle speed', currentValue: 6000 },
            'x travel': { code: '$130', unit: 'mm', description: 'X-axis travel', currentValue: 400 },
            'y travel': { code: '$131', unit: 'mm', description: 'Y-axis travel', currentValue: 400 },
            'z travel': { code: '$132', unit: 'mm', description: 'Z-axis travel', currentValue: 200 },
            'step pulse': { code: '$0', unit: 'µs', description: 'Step pulse duration', currentValue: 10 },
            'step idle delay': { code: '$1', unit: 'ms', description: 'Step idle delay', currentValue: 25 },
        };
        
        // Slang and casual language dictionary
        this.slangDictionary = {
            // ============================================================
            // ACTIONS - casual ways to say commands
            // ============================================================
            // Increase variations
            'crank up': 'increase', 'bump up': 'increase', 'jack up': 'increase', 'ramp up': 'increase',
            'dial up': 'increase', 'max out': 'increase', 'beef up': 'increase', 'amp up': 'increase',
            'turn up': 'increase', 'push up': 'increase', 'boost': 'increase', 'raise': 'increase',
            'more': 'increase', 'higher': 'increase', 'faster': 'increase',
            
            // Decrease variations
            'crank down': 'decrease', 'dial down': 'decrease', 'tone down': 'decrease', 'ease up': 'decrease',
            'bring down': 'decrease', 'pull back': 'decrease', 'back off': 'decrease', 'throttle back': 'decrease',
            'less': 'decrease', 'lower': 'decrease', 'slower': 'decrease', 'ease off': 'decrease',
            
            // Stop variations
            'kill': 'stop', 'nuke': 'stop', 'abort': 'stop', 'halt': 'stop', 'freeze': 'stop',
            'whoa': 'stop', 'cut it': 'stop', 'shut down': 'stop', 'shut it down': 'stop',
            
            // Start/Run variations
            'fire up': 'start', 'kick off': 'start', 'boot up': 'start', 'spin up': 'spindle on',
            'let\'s go': 'run job', 'lets go': 'run job', 'hit it': 'run job', 'execute': 'run job',
            'yeet': 'rapid', 'send it': 'run job', 'full send': 'run job', 'go ham': 'run job',
            'get going': 'run job', 'start cutting': 'run job', 'start machining': 'run job',
            
            // Cancel/Undo
            'bail': 'cancel', 'scratch that': 'cancel', 'forget that': 'cancel', 'take it back': 'undo',
            'my bad': 'undo', 'whoops': 'undo', 'oops': 'undo',
            
            // Movement
            'park it': 'home', 'send home': 'home', 'go home': 'home',
            'zero out': 'zero', 'null out': 'zero', 'reset position': 'zero',
            'back up': 'retract', 'pull up': 'retract', 'clear out': 'retract',
            'touch off': 'probe z', 'touch plate': 'probe z', 'measure height': 'probe z',
            
            // ============================================================
            // CNC-SPECIFIC SLANG & SHORTHAND
            // ============================================================
            // Spindle
            'spool up': 'spindle on', 'spin it': 'spindle on', 'start spinning': 'spindle on',
            'kill the spindle': 'spindle off', 'stop spinning': 'spindle off',
            'faster spin': 'increase rpm', 'slower spin': 'decrease rpm',
            
            // Feeds
            'feedrate': 'feed', 'feed rate': 'feed', 'cut speed': 'feed',
            'cutting speed': 'feed', 'travel speed': 'rapid',
            'rapids': 'rapid', 'traverse': 'rapid', 'full rapid': 'rapid',
            
            // Tools
            'swap tool': 'tool change', 'next bit': 'next tool', 'change bit': 'tool change',
            'load tool': 'tool change', 'switch tool': 'tool change',
            
            // ============================================================
            // AXIS SETTINGS - normalize patterns
            // ============================================================
            'z speed': 'z max speed', 'x speed': 'x max speed', 'y speed': 'y max speed',
            'max z speed': 'z max speed', 'max x speed': 'x max speed', 'max y speed': 'y max speed',
            'z max': 'z max speed', 'x max': 'x max speed', 'y max': 'y max speed',
            'zee': 'z', 'ex': 'x', 'why': 'y',  // Phonetic
            'accel': 'acceleration', 'acc': 'acceleration', 'decel': 'acceleration',
            'rpm': 'spindle', 'revs': 'spindle',
            
            // ============================================================
            // MULTIPLIERS
            // ============================================================
            '2 times': '2x', 'twice': '2x', 'two times': '2x', 'double': '2x',
            '3 times': '3x', 'three times': '3x', 'thrice': '3x', 'triple': '3x',
            '4 times': '4x', 'four times': '4x', 'quadruple': '4x',
            'half': '0.5x', 'half speed': '50%', 'quarter speed': '25%',
            
            // ============================================================
            // CONFIRMATIONS (voice responses)
            // ============================================================
            'yep': 'yes', 'yup': 'yes', 'yeah': 'yes', 'yea': 'yes', 'ye': 'yes', 'ya': 'yes',
            'yas': 'yes', 'yass': 'yes', 'fo sho': 'yes', 'bet': 'yes', 'aight': 'yes', 'k': 'yes',
            'sure': 'yes', 'def': 'yes', 'definitely': 'yes', 'absolutely': 'yes', 'do it': 'yes',
            'affirmative': 'yes', 'roger': 'yes', 'roger that': 'yes', 'copy': 'yes', 'copy that': 'yes',
            'correct': 'yes', 'right': 'yes', 'that\'s right': 'yes', 'thats right': 'yes',
            'go ahead': 'yes', 'proceed': 'yes', 'confirmed': 'yes', 'confirm': 'yes',
            
            'nah': 'no', 'nope': 'no', 'negative': 'no', 'hell no': 'no', 'pass': 'no',
            'not that': 'no', 'wrong': 'no', 'incorrect': 'no', 'don\'t': 'no', 'dont': 'no',
            'nvrmnd': 'cancel', 'nvm': 'cancel', 'jk': 'cancel', 'forget it': 'cancel',
            'never mind': 'cancel', 'nevermind': 'cancel',
            
            // ============================================================
            // STATUS QUERIES
            // ============================================================
            'wassup': 'status', 'whats up': 'status', 'sup': 'status', 'hows it going': 'status',
            'how we looking': 'status', 'sitrep': 'status', 'where we at': 'status',
            'position': 'status', 'where am i': 'status', 'location': 'status',
            'what\'s the deal': 'status', 'whats the deal': 'status',
            
            // ============================================================
            // HELP QUERIES
            // ============================================================
            'wtf': 'help', 'halp': 'help', 'wat do': 'help', 'wut': 'help',
            'what do i do': 'help', 'i\'m stuck': 'help', 'im stuck': 'help',
            'how does this work': 'help', 'commands': 'help',
            
            // ============================================================
            // CASUAL CONTRACTIONS
            // ============================================================
            'gonna': 'going to', 'wanna': 'want to', 'gotta': 'got to', 'lemme': 'let me',
            'gimme': 'give me', 'kinda': 'kind of', 'sorta': 'sort of',
            'coulda': 'could have', 'shoulda': 'should have', 'woulda': 'would have',
            'imma': 'i am going to', 'i\'mma': 'i am going to',
            
            // ============================================================
            // CHATTER DETECTION
            // ============================================================
            'rattling': 'chatter', 'vibrating': 'chatter', 'shaking': 'chatter',
            'squealing': 'chatter', 'screaming': 'chatter', 'howling': 'chatter',
        };
        
        // Common typos/misspellings mapping (including voice misrecognitions)
        this.commonTypos = {
            // Increase variations
            'incrase': 'increase', 'increese': 'increase', 'incraese': 'increase', 'inclease': 'increase',
            'increae': 'increase', 'increse': 'increase', 'inrease': 'increase', 'ncrease': 'increase',
            'icnrease': 'increase', 'incerase': 'increase', 'increasz': 'increase',
            
            // Decrease variations  
            'decrase': 'decrease', 'decreese': 'decrease', 'decraese': 'decrease', 'decrese': 'decrease',
            'descrease': 'decrease', 'dcrease': 'decrease', 'decreas': 'decrease',
            
            // Speed variations
            'spead': 'speed', 'spped': 'speed', 'speeed': 'speed', 'sppeed': 'speed', 'pseed': 'speed',
            'soeed': 'speed', 'apeed': 'speed', 'speef': 'speed', 'speex': 'speed',
            
            // Max variations
            'maz': 'max', 'amx': 'max', 'mxa': 'max', 'maxs': 'max', 'maxx': 'max',
            'maxium': 'maximum', 'maxinum': 'maximum', 'maximun': 'maximum',
            
            // Spindle variations (common voice misrecognitions)
            'spindel': 'spindle', 'spinle': 'spindle', 'spindke': 'spindle', 'spinde': 'spindle',
            'spnidle': 'spindle', 'sipndle': 'spindle', 'spinal': 'spindle', 'spinball': 'spindle',
            'kendall': 'spindle', 'kindle': 'spindle', 'spin ball': 'spindle',
            
            // Acceleration
            'accelleration': 'acceleration', 'accleration': 'acceleration', 'acceleraton': 'acceleration',
            'accelaration': 'acceleration', 'aceleration': 'acceleration', 'exceleration': 'acceleration',
            
            // Home variations
            'hom': 'home', 'hoem': 'home', 'hone': 'home', 'homr': 'home', 'foam': 'home', 'chrome': 'home',
            
            // Move/Jog variations
            'moev': 'move', 'mvoe': 'move', 'mve': 'move', 'movr': 'move',
            'jgo': 'jog', 'jgog': 'jog', 'jof': 'jog', 'jod': 'jog', 'jock': 'jog', 'job': 'jog', 'john': 'jog',
            
            // Change/Set variations
            'chagne': 'change', 'chnage': 'change', 'cahgne': 'change', 'channge': 'change',
            'seet': 'set', 'ste': 'set', 'ser': 'set',
            
            // Probe variations
            'prob': 'probe', 'prode': 'probe', 'proeb': 'probe', 'pro': 'probe',
            
            // Zero variations (voice)
            'hero': 'zero', 'nero': 'zero', 'xero': 'zero', 'sierra': 'zero',
            
            // Pause/Resume (voice)
            'paws': 'pause', 'pass': 'pause', 'paws': 'pause',
            'presume': 'resume', 'result': 'resume', 'assume': 'resume',
            
            // Stop (voice)
            'stock': 'stop', 'stall': 'stop', 'stuff': 'stop',
            
            // Axis names (voice misrecognition)
            'eggs': 'x', 'axe': 'x', 'acts': 'x', 'access': 'x', 'ecks': 'x',
            'wife': 'y', 'wie': 'y', 'wye': 'y', 'white': 'y',
            'zee': 'z', 'zed': 'z', 'said': 'z', 'set': 'z', 'sea': 'z',
            
            // Coolant variations
            'coolent': 'coolant', 'cooland': 'coolant', 'coolat': 'coolant', 'coolint': 'coolant',
            
            // Feed variations
            'feet': 'feed', 'feat': 'feed', 'fead': 'feed',
            
            // Rapid
            'rabbit': 'rapid', 'rapids': 'rapid', 'rabbid': 'rapid',
            
            // Convert variations
            'covert': 'convert', 'convret': 'convert', 'conver': 'convert', 'converr': 'convert',
            
            // Other common typos
            'teh': 'the', 'hte': 'the', 'taht': 'that', 'thta': 'that',
            'waht': 'what', 'whta': 'what', 'hwat': 'what',
            'ot': 'to', 'tot': 'to', 'ro': 'to',
            'milimeters': 'millimeters', 'milimeter': 'millimeter', 'millimeter': 'mm',
            'milimeters': 'mm', 'millimeters': 'mm',
        };
        
        // Settings change log
        this.settingsHistory = [];
        
        // ================================================================
        // Voice Control Enhancement Configuration
        // ================================================================
        
        // Wake words - command must start with one of these (optional mode)
        this.wakeWords = ['hey cnc', 'ok cnc', 'okay cnc', 'hey machine', 'ok machine', 'computer', 'hey computer'];
        this.requireWakeWord = false;  // Set true for noisy environments
        
        // Spoken number words to digits
        this.spokenNumbers = {
            'zero': 0, 'oh': 0,
            'one': 1, 'won': 1,
            'two': 2, 'to': 2, 'too': 2,
            'three': 3,
            'four': 4, 'for': 4, 'fore': 4,
            'five': 5,
            'six': 6, 'sicks': 6,
            'seven': 7,
            'eight': 8, 'ate': 8,
            'nine': 9,
            'ten': 10,
            'eleven': 11,
            'twelve': 12,
            'thirteen': 13,
            'fourteen': 14,
            'fifteen': 15,
            'sixteen': 16,
            'seventeen': 17,
            'eighteen': 18,
            'nineteen': 19,
            'twenty': 20,
            'thirty': 30,
            'forty': 40, 'fourty': 40,
            'fifty': 50,
            'sixty': 60,
            'seventy': 70,
            'eighty': 80,
            'ninety': 90,
            'hundred': 100,
            'thousand': 1000,
            // Common speeds/values
            'five hundred': 500,
            'a thousand': 1000,
            'one thousand': 1000,
            'two thousand': 2000,
            'three thousand': 3000,
            'five thousand': 5000,
            'six thousand': 6000,
            'eight thousand': 8000,
            'ten thousand': 10000,
            'twelve thousand': 12000,
            'fifteen thousand': 15000,
            'eighteen thousand': 18000,
            'twenty thousand': 20000,
            'twenty four thousand': 24000,
            'twenty-four thousand': 24000,
            // Fractions
            'half': 0.5, 'quarter': 0.25, 'a half': 0.5, 'a quarter': 0.25,
            'point five': 0.5, 'point one': 0.1, 'point two': 0.2,
        };
        
        // Shop noise filter - ignore these common misrecognitions
        this.noiseFilter = [
            'um', 'uh', 'hmm', 'huh', 'ah', 'oh no', 'oops', 'oop',
            'the', 'a', 'an', 'is', 'are', 'it', 'that', 'this',
            'okay so', 'alright so', 'so um', 'well um',
            'you know', 'i mean', 'like', 'just',
            // Background conversation fragments
            'did you', 'can you', 'what did', 'where is', 'when is',
            // Shop sounds misrecognized
            'shhh', 'shh', 'bzz', 'brr', 'whir', 'click', 'beep',
        ];
        
        // Voice feedback settings
        this.voiceFeedback = {
            enabled: true,              // TTS responses
            confirmCommands: true,      // Speak "Moving X..."
            alertsOnly: false,          // Only speak errors/warnings
            volume: 0.8,
            rate: 1.0,
            pitch: 1.0
        };
        
        // Voice state tracking
        this.voiceState = {
            lastCommand: null,
            lastConfidence: 0,
            pendingConfirmation: null,
            consecutiveErrors: 0,
            sessionCommands: 0,
            listeningStartTime: null
        };
        
        // Additional phonetic corrections for CNC terms
        this.phoneticCorrections = {
            // Axis names (commonly misheard)
            'zee': 'z', 'zed': 'z', 'said': 'z', 'set': 'z',
            'ex': 'x', 'eggs': 'x', 'axe': 'x', 'ecks': 'x', 'acts': 'x',
            'why': 'y', 'wie': 'y', 'wye': 'y',
            
            // Commands
            'jock': 'jog', 'jogged': 'jog', 'job': 'jog', 'john': 'jog', 'jog': 'jog',
            'home': 'home', 'homing': 'home', 'chrome': 'home', 'foam': 'home',
            'probe': 'probe', 'pro': 'probe', 'prob': 'probe',
            'zero': 'zero', 'hero': 'zero', 'nero': 'zero',
            'stop': 'stop', 'stock': 'stop', 'stall': 'stop',
            'pause': 'pause', 'paws': 'pause', 'pass': 'pause',
            'resume': 'resume', 'result': 'resume', 'presume': 'resume',
            'spindle': 'spindle', 'spinal': 'spindle', 'kindle': 'spindle',
            'coolant': 'coolant', 'coolent': 'coolant', 'cooler': 'coolant',
            'rapid': 'rapid', 'rabbit': 'rapid', 'rapids': 'rapid',
            'feed': 'feed', 'feet': 'feed', 'feet': 'feed', 'speed': 'feed',
            
            // Units
            'millimeter': 'mm', 'millimeters': 'mm', 'mils': 'mm', 'mills': 'mm',
            'inch': 'in', 'inches': 'in', 'int': 'in',
            'rpm': 'rpm', 'our pm': 'rpm', 'rpms': 'rpm',
            'percent': '%', 'per cent': '%', 'per send': '%',
        };
        
        this.initVoice();
    }
    
    // ================================================================
    // Typo Correction & Fuzzy Matching
    // ================================================================
    
    /**
     * Calculate Levenshtein distance between two strings
     */
    levenshteinDistance(str1, str2) {
        const m = str1.length;
        const n = str2.length;
        const dp = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));
        
        for (let i = 0; i <= m; i++) dp[i][0] = i;
        for (let j = 0; j <= n; j++) dp[0][j] = j;
        
        for (let i = 1; i <= m; i++) {
            for (let j = 1; j <= n; j++) {
                if (str1[i-1] === str2[j-1]) {
                    dp[i][j] = dp[i-1][j-1];
                } else {
                    dp[i][j] = 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
                }
            }
        }
        return dp[m][n];
    }
    
    /**
     * Find closest matching word from a dictionary
     */
    findClosestWord(word, dictionary, maxDistance = 2) {
        let closest = null;
        let minDist = Infinity;
        
        for (const dictWord of dictionary) {
            const dist = this.levenshteinDistance(word.toLowerCase(), dictWord.toLowerCase());
            if (dist < minDist && dist <= maxDistance) {
                minDist = dist;
                closest = dictWord;
            }
        }
        
        return { word: closest, distance: minDist, confidence: closest ? 1 - (minDist / Math.max(word.length, closest?.length || 1)) : 0 };
    }
    
    /**
     * Correct typos in input text
     */
    correctTypos(text) {
        let corrected = text.toLowerCase();
        let corrections = [];
        
        // First, apply known typo corrections
        for (const [typo, correction] of Object.entries(this.commonTypos)) {
            const regex = new RegExp(`\\b${typo}\\b`, 'gi');
            if (regex.test(corrected)) {
                corrected = corrected.replace(regex, correction);
                corrections.push({ from: typo, to: correction, type: 'typo' });
            }
        }
        
        // Apply slang translations
        for (const [slang, meaning] of Object.entries(this.slangDictionary)) {
            const regex = new RegExp(`\\b${slang.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
            if (regex.test(corrected)) {
                corrected = corrected.replace(regex, meaning);
                corrections.push({ from: slang, to: meaning, type: 'slang' });
            }
        }
        
        return { 
            corrected, 
            original: text,
            corrections,
            wasCorrected: corrections.length > 0
        };
    }
    
    /**
     * Fuzzy match against known commands
     */
    fuzzyMatchCommand(word) {
        const commands = [
            'increase', 'decrease', 'set', 'change', 'move', 'jog', 'home', 'zero',
            'spindle', 'speed', 'acceleration', 'convert', 'help', 'status',
            'probe', 'stop', 'pause', 'resume', 'run', 'cancel', 'undo'
        ];
        
        return this.findClosestWord(word, commands, 2);
    }
    
    // ================================================================
    // Natural Language Processing
    // ================================================================
    
    async processInput(input) {
        const rawText = input.trim();
        
        // Step 1: Correct typos and translate slang
        const typoResult = this.correctTypos(rawText);
        let text = typoResult.corrected;
        
        // Add to conversation history
        this.conversationHistory.push({ role: 'user', content: input, time: Date.now() });
        if (this.conversationHistory.length > this.maxHistory) {
            this.conversationHistory.shift();
        }
        
        // Check if we're waiting for a follow-up response
        if (this.pendingContext) {
            return await this.handlePendingContext(input);
        }
        
        // If major corrections were made, show what we understood
        if (typoResult.wasCorrected && typoResult.corrections.length > 0) {
            const hasTypos = typoResult.corrections.some(c => c.type === 'typo');
            const hasSlang = typoResult.corrections.some(c => c.type === 'slang');
            
            // Build correction message
            let correctionNote = '';
            if (hasTypos || hasSlang) {
                const correctionList = typoResult.corrections.map(c => 
                    `"${c.from}" → "${c.to}"`
                ).join(', ');
                correctionNote = `🔤 *Got it! I understood: ${correctionList}*\n\n`;
            }
            
            // Store for potential display
            this.lastCorrections = { note: correctionNote, corrections: typoResult.corrections };
        } else {
            this.lastCorrections = null;
        }
        
        // Check for unit conversion requests first
        const conversionResult = this.smartConvert(text);
        if (conversionResult) {
            const response = (this.lastCorrections?.note || '') + conversionResult.response;
            this.conversationHistory.push({ role: 'assistant', content: response, time: Date.now() });
            this.onResponse(response);
            return { ...conversionResult, response };
        }
        
        // Preprocess for better understanding
        const preprocessed = this.preprocessInput(text);
        
        // Check for settings modification requests
        const settingsResult = this.parseSettingsRequest(preprocessed);
        if (settingsResult) {
            return await this.handleSettingsRequest(settingsResult, input);
        }
        
        // Check each command pattern (try both original and preprocessed)
        for (const { pattern, action, extract } of this.commandPatterns) {
            let match = text.match(pattern) || preprocessed.match(pattern);
            if (match) {
                const params = extract(match);
                // Handle units in movement commands
                if (action === 'jog' && params.distance !== undefined) {
                    const parsed = this.parseDistance(params.distance.toString());
                    if (parsed && parsed.converted) {
                        params.distance = parsed.value;
                        params.unitInfo = `(${parsed.originalValue} ${parsed.originalUnit} = ${parsed.value.toFixed(2)}mm)`;
                    }
                }
                return await this.executeAction(action, params, input);
            }
        }
        
        // If nothing matched, try fuzzy matching on key words
        const fuzzyResult = await this.tryFuzzyMatch(rawText, text);
        if (fuzzyResult) {
            return fuzzyResult;
        }
        
        // If no pattern matched, try conversational response
        return this.conversationalResponse(input);
    }
    
    /**
     * Try fuzzy matching when exact patterns fail
     */
    async tryFuzzyMatch(originalText, correctedText) {
        const words = correctedText.split(/\s+/);
        let suggestions = [];
        let unknownWords = [];
        
        for (const word of words) {
            if (word.length < 3) continue;
            
            // Check if it might be a mangled command
            const match = this.fuzzyMatchCommand(word);
            if (match.word && match.distance > 0 && match.confidence > 0.5) {
                suggestions.push({
                    original: word,
                    suggested: match.word,
                    confidence: match.confidence
                });
            } else if (!this.isKnownWord(word)) {
                unknownWords.push(word);
            }
        }
        
        // If we have low-confidence suggestions, ask for confirmation
        if (suggestions.length > 0) {
            const lowConfidence = suggestions.filter(s => s.confidence < 0.75);
            
            if (lowConfidence.length > 0) {
                // Ask user to confirm
                const suggestionText = suggestions.map(s => 
                    `"${s.original}" → **${s.suggested}**?`
                ).join('\n• ');
                
                const response = `🤔 I'm not 100% sure what you meant. Did you mean:

• ${suggestionText}

Say **"yes"** if that's right, or try rephrasing your request.`;
                
                this.pendingContext = {
                    type: 'confirm_fuzzy',
                    originalText,
                    suggestions,
                    timestamp: Date.now()
                };
                
                this.onResponse(response);
                return { success: false, response, needsConfirmation: true };
            }
            
            // High confidence - auto-correct and continue
            let autoCorrected = correctedText;
            for (const s of suggestions) {
                autoCorrected = autoCorrected.replace(new RegExp(`\\b${s.original}\\b`, 'gi'), s.suggested);
            }
            
            // Re-process with corrections
            const correctionNote = `🔧 *Auto-corrected: ${suggestions.map(s => `"${s.original}" → "${s.suggested}"`).join(', ')}*\n\n`;
            this.lastCorrections = { note: correctionNote, corrections: suggestions };
            
            // Try matching again with corrected text
            const preprocessed = this.preprocessInput(autoCorrected);
            const settingsResult = this.parseSettingsRequest(preprocessed);
            if (settingsResult) {
                return await this.handleSettingsRequest(settingsResult, originalText);
            }
            
            for (const { pattern, action, extract } of this.commandPatterns) {
                let match = autoCorrected.match(pattern) || preprocessed.match(pattern);
                if (match) {
                    const params = extract(match);
                    return await this.executeAction(action, params, originalText);
                }
            }
        }
        
        return null;
    }
    
    /**
     * Check if a word is known/expected
     */
    isKnownWord(word) {
        const knownWords = new Set([
            'the', 'a', 'an', 'to', 'for', 'of', 'and', 'or', 'with', 'in', 'on', 'at',
            'is', 'are', 'was', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does',
            'i', 'me', 'my', 'we', 'you', 'it', 'this', 'that', 'these', 'those',
            'can', 'could', 'would', 'should', 'will', 'shall', 'may', 'might',
            'please', 'thanks', 'thank', 'ok', 'okay',
            'x', 'y', 'z', 'xy', 'xyz', 'all',
            'mm', 'cm', 'in', 'inch', 'inches', 'ft', 'feet', 'm', 'meter', 'meters',
            'min', 'sec', 'second', 'minute', 'rpm',
            ...Object.keys(this.settingsDatabase),
            ...Object.keys(this.slangDictionary),
            ...Object.keys(this.commonTypos),
        ]);
        
        return knownWords.has(word.toLowerCase());
    }
    
    // ================================================================
    // Settings Modification System
    // ================================================================
    
    parseSettingsRequest(text) {
        // First, check for multiplier patterns like "2x", "double", "by 2", "by half"
        // Use greedy .+ to capture the full setting name before the multiplier
        const multiplierPatterns = [
            // "increase max z speed by 2x" or "increase max z speed 2x" or "max z speed by 2x"
            /(?:increase|raise|boost|set|make|change)?\s*(?:the\s+)?(.+?)\s+by\s+(\d+(?:\.\d+)?)\s*[x×]/i,
            /(?:increase|raise|boost|set|make|change)?\s*(?:the\s+)?(.+?)\s+(\d+(?:\.\d+)?)\s*[x×]/i,
            // "2x the max z speed" or "2x max z speed"
            /(\d+(?:\.\d+)?)\s*[x×]\s+(?:the\s+)?(.+)/i,
            // "double the max z speed" or "double max z speed"
            /(double|triple|quadruple|half)\s+(?:the\s+)?(.+)/i,
            // "increase max z speed by 2 times"
            /(?:increase|raise|boost|set|make|change)?\s*(?:the\s+)?(.+?)\s+by\s+(\d+(?:\.\d+)?)\s*times/i,
        ];
        
        let multiplierMatch = null;
        let settingPart = null;
        let multiplier = 1;
        
        for (const pattern of multiplierPatterns) {
            const match = text.match(pattern);
            if (match) {
                multiplierMatch = match;
                break;
            }
        }
        
        if (multiplierMatch) {
            // Determine which capture group has the setting name
            const g1 = multiplierMatch[1];
            const g2 = multiplierMatch[2];
            
            // Check for word multipliers first
            if (/^double$/i.test(g1)) {
                multiplier = 2;
                settingPart = g2;
            } else if (/^triple$/i.test(g1)) {
                multiplier = 3;
                settingPart = g2;
            } else if (/^quadruple$/i.test(g1)) {
                multiplier = 4;
                settingPart = g2;
            } else if (/^half$/i.test(g1)) {
                multiplier = 0.5;
                settingPart = g2;
            } else if (!isNaN(parseFloat(g1))) {
                // Pattern like "2x the max z speed"
                multiplier = parseFloat(g1);
                settingPart = g2;
            } else if (!isNaN(parseFloat(g2))) {
                // Pattern like "increase max z speed by 2x"
                multiplier = parseFloat(g2);
                settingPart = g1;
            }
            
            if (settingPart && multiplier !== 1) {
                settingPart = settingPart.trim().replace(/\s+speed\s*$/i, '').trim() || settingPart.trim();
                const settingName = this.findSetting(settingPart);
                if (settingName) {
                    const setting = this.settingsDatabase[settingName];
                    const newValue = Math.round(setting.currentValue * multiplier);
                    return {
                        action: 'set',
                        setting: settingName,
                        value: newValue,
                        multiplier: multiplier,
                        unitInfo: `(${setting.currentValue} × ${multiplier} = ${newValue})`
                    };
                }
            }
        }
        
        // Check for percentage increase/decrease: "increase by 20%", "50% faster"
        const percentMatch = text.match(/(?:increase|raise|boost)?\s*(?:the\s+)?(.+?)\s+(?:by\s+)?(\d+(?:\.\d+)?)\s*%/i) ||
                            text.match(/(\d+(?:\.\d+)?)\s*%\s+(?:faster|more|higher)\s+(?:on\s+)?(?:the\s+)?(.+)/i);
        
        if (percentMatch) {
            let settingPart, percent;
            if (percentMatch[2] && isNaN(parseFloat(percentMatch[1]))) {
                settingPart = percentMatch[1];
                percent = parseFloat(percentMatch[2]);
            } else {
                settingPart = percentMatch[2] || percentMatch[1];
                percent = parseFloat(percentMatch[1]) || parseFloat(percentMatch[2]);
            }
            
            const settingName = this.findSetting(settingPart);
            if (settingName && percent) {
                const setting = this.settingsDatabase[settingName];
                const increase = /decrease|lower|reduce|slower|less/i.test(text);
                const newValue = Math.round(setting.currentValue * (1 + (increase ? -percent : percent) / 100));
                return {
                    action: 'set',
                    setting: settingName,
                    value: newValue,
                    unitInfo: `(${setting.currentValue} ${increase ? '-' : '+'} ${percent}% = ${newValue})`
                };
            }
        }
        
        // Standard patterns
        const modifyPattern = /(?:increase|raise|boost|up|higher|more|faster|crank\s*up|bump\s*up)\s+(?:the\s+)?(.+?)(?:\s+(?:speed|rate|value))?$/i;
        const decreasePattern = /(?:decrease|lower|reduce|down|slower|less|dial\s*down)\s+(?:the\s+)?(.+?)(?:\s+(?:speed|rate|value))?$/i;
        const setPattern = /(?:set|change|make)\s+(?:the\s+)?(.+?)\s+(?:to|=)\s*([\d.]+\s*[a-z\/]*)/i;
        const queryPattern = /(?:what(?:'s| is)?|show|current|get)\s+(?:the\s+)?(.+?)(?:\s+(?:speed|rate|value|setting))?$/i;
        
        let match;
        
        // Check for set with specific value (with unit support)
        match = text.match(setPattern);
        if (match) {
            const settingName = this.findSetting(match[1]);
            if (settingName) {
                const setting = this.settingsDatabase[settingName];
                let value = parseFloat(match[2]);
                let unitInfo = null;
                
                // Determine the type for unit conversion
                let unitType = 'length';
                if (setting.unit.includes('/min') || setting.unit.includes('/sec')) {
                    unitType = 'speed';
                } else if (setting.unit.includes('sec²') || setting.unit.includes('/s^2')) {
                    unitType = 'acceleration';
                }
                
                // Parse with unit conversion
                const parsed = this.parseValueWithUnit(match[2].trim(), unitType);
                if (parsed && parsed.converted) {
                    value = parsed.value;
                    unitInfo = `(${parsed.originalValue} ${parsed.originalUnit} → ${value.toFixed(1)} ${setting.unit})`;
                }
                
                return {
                    action: 'set',
                    setting: settingName,
                    value: value,
                    unitInfo: unitInfo
                };
            }
        }
        
        // Check for increase
        match = text.match(modifyPattern);
        if (match) {
            const settingName = this.findSetting(match[1]);
            if (settingName) {
                return {
                    action: 'increase',
                    setting: settingName
                };
            }
        }
        
        // Check for decrease
        match = text.match(decreasePattern);
        if (match) {
            const settingName = this.findSetting(match[1]);
            if (settingName) {
                return {
                    action: 'decrease',
                    setting: settingName
                };
            }
        }
        
        // Check for query
        match = text.match(queryPattern);
        if (match) {
            const settingName = this.findSetting(match[1]);
            if (settingName) {
                return {
                    action: 'query',
                    setting: settingName
                };
            }
        }
        
        return null;
    }
    
    findSetting(input) {
        let normalized = input.toLowerCase().trim();
        
        // Clean up common variations
        normalized = normalized
            .replace(/\bmax\s+speed\b/gi, 'max speed')
            .replace(/\bmaximum\s+speed\b/gi, 'max speed')
            .replace(/\bspeed\s+max\b/gi, 'max speed')
            .replace(/\bmax\s+rate\b/gi, 'max speed')
            .replace(/\brate\b/gi, 'speed')
            .replace(/\baccel\b/gi, 'acceleration')
            .replace(/\bacc\b/gi, 'acceleration');
        
        // Direct match
        if (this.settingsDatabase[normalized]) {
            return normalized;
        }
        
        // Try common variations
        const variations = [
            normalized,
            normalized.replace(/\s+/g, ' '),
            // "max z speed" -> "z max speed"
            normalized.replace(/max\s+([xyz])\s+speed/i, '$1 max speed'),
            // "z speed max" -> "z max speed"
            normalized.replace(/([xyz])\s+speed\s+max/i, '$1 max speed'),
            // "z speed" -> "z max speed"
            normalized.replace(/^([xyz])\s+speed$/i, '$1 max speed'),
            // "speed z" -> "z max speed"
            normalized.replace(/^speed\s+([xyz])$/i, '$1 max speed'),
            // "z accel" -> "z acceleration"
            normalized.replace(/([xyz])\s+accel/i, '$1 acceleration'),
        ];
        
        for (const variation of variations) {
            if (this.settingsDatabase[variation]) {
                return variation;
            }
        }
        
        // Fuzzy match - find best matching setting
        let bestMatch = null;
        let bestScore = 0;
        
        for (const key of Object.keys(this.settingsDatabase)) {
            // Check if input contains key parts or vice versa
            const keyParts = key.split(' ');
            const inputParts = normalized.split(' ');
            
            let score = 0;
            
            // Check for axis match first (critical)
            const inputAxis = normalized.match(/\b([xyz])\b/i)?.[1]?.toLowerCase();
            const keyAxis = key.match(/\b([xyz])\b/i)?.[1]?.toLowerCase();
            
            if (inputAxis && keyAxis) {
                if (inputAxis === keyAxis) {
                    score += 20;  // Big bonus for matching axis
                } else {
                    continue;  // Wrong axis, skip this setting entirely
                }
            }
            
            // Check for type match (speed, acceleration, travel, spindle)
            const types = ['speed', 'acceleration', 'travel', 'spindle', 'max', 'min'];
            for (const type of types) {
                if (normalized.includes(type) && key.includes(type)) {
                    score += 5;
                }
            }
            
            // Word overlap
            for (const kp of keyParts) {
                for (const ip of inputParts) {
                    if (kp === ip) {
                        score += 10;  // Exact word match
                    } else if (kp.includes(ip) || ip.includes(kp)) {
                        score += ip.length;
                    }
                }
            }
            
            if (score > bestScore) {
                bestScore = score;
                bestMatch = key;
            }
        }
        
        return bestScore >= 3 ? bestMatch : null;
    }
    
    async handleSettingsRequest(request, originalInput) {
        const setting = this.settingsDatabase[request.setting];
        
        switch (request.action) {
            case 'query': {
                // Show current value
                const response = `📊 **${setting.description}** (${setting.code})
                
Current value: **${setting.currentValue} ${setting.unit}**

Would you like to change it? Just tell me the new value or say "increase" or "decrease".`;
                
                this.conversationHistory.push({ role: 'assistant', content: response, time: Date.now() });
                this.onResponse(response);
                return { success: true, response };
            }
            
            case 'set': {
                // Set to specific value - always confirm first
                const newValue = Math.round(Number(request.value));
                if (!Number.isFinite(newValue)) {
                    const response = `❓ I didn't understand that value. Please provide a number.`;
                    this.onResponse(response);
                    return { success: false, response };
                }
                
                // No change needed
                if (newValue === setting.currentValue) {
                    const response = `✅ **No change needed**\n\n**${setting.description}** is already **${setting.currentValue} ${setting.unit}**.`;
                    this.onResponse(response);
                    return { success: true, response };
                }
                
                // Validate
                const validation = this.validateSettingValue(request.setting, newValue);
                if (!validation.valid) {
                    const response = `⚠️ ${validation.message}\n\nCurrent: ${setting.currentValue} ${setting.unit}\nRequested: ${newValue} ${setting.unit}`;
                    this.onResponse(response);
                    return { success: false, response };
                }
                
                // Build confirmation message
                const change = newValue - setting.currentValue;
                const changePercent = ((change / setting.currentValue) * 100).toFixed(1);
                const direction = change > 0 ? '📈 Increase' : '📉 Decrease';
                const unitInfoRow = request.unitInfo ? `\n| Note | ${request.unitInfo} |` : '';
                
                const response = `${direction} **${setting.description}**\n\n| | Value |\n|---|---|\n| Current | ${setting.currentValue} ${setting.unit} |\n| New | ${newValue} ${setting.unit} |${unitInfoRow}\n| Change | ${change > 0 ? '+' : ''}${change} (${changePercent}%) |\n\n**Confirm?** Say "yes" to apply, or "no" to cancel.`;
                
                this.pendingContext = {
                    type: 'confirm_setting',
                    setting: request.setting,
                    oldValue: setting.currentValue,
                    newValue: newValue,
                    unitInfo: request.unitInfo || null,
                    timestamp: Date.now()
                };
                
                this.conversationHistory.push({ role: 'assistant', content: response, time: Date.now() });
                this.onResponse(response);
                return { success: true, response, pending: true };
            }
            
            case 'increase':
            case 'decrease': {
                // Ask for amount
                const direction = request.action === 'increase' ? 'faster' : 'slower';
                const response = `🔧 **${setting.description}**

Current value: **${setting.currentValue} ${setting.unit}**

How much ${direction} would you like it? You can say:
• A specific value (e.g., "8000")
• A percentage (e.g., "20% faster")  
• An increment (e.g., "500 more")`;
                
                // Set pending context for follow-up
                this.pendingContext = {
                    type: 'settings_modify',
                    action: request.action,
                    setting: request.setting,
                    currentValue: setting.currentValue,
                    timestamp: Date.now()
                };
                
                this.conversationHistory.push({ role: 'assistant', content: response, time: Date.now() });
                this.onResponse(response);
                return { success: true, response, pending: true };
            }
        }
    }
    
    async handlePendingContext(input) {
        const context = this.pendingContext;
        const text = input.trim().toLowerCase();
        
        // Clear pending context after 60 seconds
        if (Date.now() - context.timestamp > 60000) {
            this.pendingContext = null;
            return this.conversationalResponse(input);
        }
        
        // Handle cancel
        if (/\b(cancel|nevermind|never mind|forget it)\b/i.test(text)) {
            this.pendingContext = null;
            const response = '👍 No changes made.';
            this.onResponse(response);
            return { success: true, response };
        }
        
        // Handle large jog confirmation
        if (context.type === 'confirm_large_jog') {
            return await this.processLargeJogConfirmResponse(context, input);
        }
        
        // Handle fuzzy match confirmation
        if (context.type === 'confirm_fuzzy') {
            return await this.processFuzzyConfirmResponse(context, input);
        }
        
        // Handle voice confirmation
        if (context.type === 'confirm_voice') {
            return await this.processVoiceConfirmResponse(context, input);
        }
        
        // Handle "no" differently based on context
        if (/^no\b/i.test(text) && context.type !== 'settings_modify') {
            this.pendingContext = null;
            const response = '👍 Okay, cancelled.';
            this.onResponse(response);
            return { success: true, response };
        }
        
        if (context.type === 'settings_modify') {
            return await this.processSettingsModifyResponse(context, input);
        }
        
        if (context.type === 'confirm_setting') {
            return await this.processSettingsConfirmResponse(context, input);
        }
        
        // Unknown context type, clear it
        this.pendingContext = null;
        return this.conversationalResponse(input);
    }
    
    async processLargeJogConfirmResponse(context, input) {
        const text = input.trim().toLowerCase();
        
        // Check for yes/confirmation
        if (/\b(yes|yeah|yep|yup|confirm|do it|go|proceed)\b/i.test(text)) {
            this.pendingContext = null;
            
            // Execute the large jog with override
            const feed = context.axis === 'Z' ? 1000 : 3000;
            const gcode = `$J=G91 ${context.axis}${context.distance} F${feed}`;
            
            if (this.grbl) {
                this.grbl.send(gcode);
            }
            this.onCommand({ action: 'gcode', gcode });
            
            const response = `✅ Executing large jog: ${context.axis}${context.distance > 0 ? '+' : ''}${context.distance}mm`;
            this.onResponse(response);
            return { success: true, response, gcode };
        }
        
        // Check for no/rejection
        if (/\b(no|nope|nah|cancel|abort|don't|dont)\b/i.test(text)) {
            this.pendingContext = null;
            const response = '👍 Large move cancelled.';
            this.onResponse(response);
            return { success: true, response };
        }
        
        // Maybe they want a different distance
        const numMatch = text.match(/(\d+(?:\.\d+)?)/);
        if (numMatch) {
            const newDistance = parseFloat(numMatch[1]);
            this.pendingContext = null;
            // Process as a new jog with the corrected distance
            return await this.executeAction('jog', { 
                axis: context.axis, 
                distance: context.distance > 0 ? newDistance : -newDistance 
            }, input);
        }
        
        const response = `Say **"yes"** to confirm the ${Math.abs(context.distance)}mm move, **"no"** to cancel, or specify a different distance.`;
        this.onResponse(response);
        return { success: false, response };
    }
    
    async processFuzzyConfirmResponse(context, input) {
        const text = input.trim().toLowerCase();
        
        // Check for yes/confirmation
        if (/\b(yes|yeah|yep|yup|correct|right|that's? it|exactly|ye|ya)\b/i.test(text)) {
            this.pendingContext = null;
            
            // Apply the suggested corrections and re-process
            let corrected = context.originalText.toLowerCase();
            for (const s of context.suggestions) {
                corrected = corrected.replace(new RegExp(`\\b${s.original}\\b`, 'gi'), s.suggested);
            }
            
            const response = `✅ Got it! Processing: "${corrected}"`;
            this.onResponse(response);
            
            // Re-process with corrected text
            return await this.processInput(corrected);
        }
        
        // Check for no/rejection
        if (/\b(no|nope|nah|wrong|not right)\b/i.test(text)) {
            this.pendingContext = null;
            const response = `😅 Sorry about that! Please rephrase what you'd like to do.
            
**Tip:** Say "help" to see available commands.`;
            this.onResponse(response);
            return { success: false, response };
        }
        
        // Maybe they're trying to rephrase
        this.pendingContext = null;
        return await this.processInput(input);
    }
    
    async processVoiceConfirmResponse(context, input) {
        const text = input.trim().toLowerCase();
        
        // Check for yes - process the original voice command
        if (/\b(yes|yeah|yep|yup|correct|right|exactly)\b/i.test(text)) {
            this.pendingContext = null;
            return await this.processInput(context.transcript);
        }
        
        // No - ignore and wait for new command
        if (/\b(no|nope|nah|wrong)\b/i.test(text)) {
            this.pendingContext = null;
            const response = '👍 Okay, listening for your next command...';
            this.onResponse(response);
            return { success: true, response };
        }
        
        // Something else - treat as new command
        this.pendingContext = null;
        return await this.processInput(input);
    }
    
    async processSettingsModifyResponse(context, input) {
        const text = input.trim().toLowerCase();
        const setting = this.settingsDatabase[context.setting];
        let newValue = null;
        let unitInfo = null;
        
        // Determine unit type for this setting
        let unitType = 'length';
        if (setting.unit.includes('/min') || setting.unit.includes('/sec')) {
            unitType = 'speed';
        } else if (setting.unit.includes('sec²') || setting.unit.includes('/s^2')) {
            unitType = 'acceleration';
        }
        
        // Try parsing with unit conversion first
        const valueWithUnitMatch = text.match(/([\d.]+)\s*([a-z\/]+)/i);
        if (valueWithUnitMatch && !text.includes('%')) {
            const parsed = this.parseValueWithUnit(valueWithUnitMatch[0], unitType);
            if (parsed && parsed.value) {
                if (parsed.converted) {
                    // User gave a value in different units, treat as absolute target
                    newValue = parsed.value;
                    unitInfo = `(${parsed.originalValue} ${parsed.originalUnit} = ${parsed.value.toFixed(1)} ${setting.unit})`;
                } else if (parsed.originalUnit && this.units[unitType][parsed.originalUnit]) {
                    // Same unit, use as target
                    newValue = parsed.value;
                }
            }
        }
        
        // Percentage: "20% faster" or "20 percent"
        if (!newValue) {
            const percentMatch = text.match(/([\d.]+)\s*%/);
            if (percentMatch) {
                const percent = parseFloat(percentMatch[1]);
                if (context.action === 'increase') {
                    newValue = context.currentValue * (1 + percent / 100);
                } else {
                    newValue = context.currentValue * (1 - percent / 100);
                }
            }
        }
        
        // Increment with unit: "500 mm/min more"
        if (!newValue) {
            const incrementWithUnitMatch = text.match(/([\d.]+)\s*([a-z\/]+)?\s*(?:more|extra|faster|higher)/i);
            if (incrementWithUnitMatch) {
                let increment = parseFloat(incrementWithUnitMatch[1]);
                if (incrementWithUnitMatch[2]) {
                    const parsed = this.parseValueWithUnit(incrementWithUnitMatch[1] + incrementWithUnitMatch[2], unitType);
                    if (parsed && parsed.converted) {
                        increment = parsed.value;
                        unitInfo = `(+${parsed.originalValue} ${parsed.originalUnit})`;
                    }
                }
                newValue = context.action === 'increase' 
                    ? context.currentValue + increment 
                    : context.currentValue - increment;
            }
        }
        
        // Decrement: "500 less" or "-500"
        if (!newValue) {
            const decrementMatch = text.match(/[-]?\s*([\d.]+)\s*(?:less|slower|lower)/);
            if (decrementMatch) {
                const decrement = parseFloat(decrementMatch[1]);
                newValue = context.action === 'increase'
                    ? context.currentValue + decrement
                    : context.currentValue - decrement;
            }
        }
        
        // Direct value: just a number (possibly with unit)
        if (!newValue) {
            const directMatch = text.match(/^[\s]*([\d.]+)\s*([a-z\/]*)?[\s]*$/i);
            if (directMatch) {
                if (directMatch[2]) {
                    const parsed = this.parseValueWithUnit(directMatch[0].trim(), unitType);
                    if (parsed) {
                        newValue = parsed.value;
                        if (parsed.converted) {
                            unitInfo = `(${parsed.originalValue} ${parsed.originalUnit} = ${parsed.value.toFixed(1)} ${setting.unit})`;
                        }
                    }
                } else {
                    newValue = parseFloat(directMatch[1]);
                }
            }
        }
        
        // Number anywhere in text as fallback
        if (!newValue) {
            const anyNumber = text.match(/([\d.]+)/);
            if (anyNumber) {
                const num = parseFloat(anyNumber[1]);
                // If it's a small number and we're doing percentages, treat as percent
                if (num <= 100 && text.includes('%')) {
                    if (context.action === 'increase') {
                        newValue = context.currentValue * (1 + num / 100);
                    } else {
                        newValue = context.currentValue * (1 - num / 100);
                    }
                } else {
                    // Assume it's the target value or increment
                    if (num > context.currentValue * 0.5 && num < context.currentValue * 3) {
                        // Likely a target value
                        newValue = num;
                    } else {
                        // Likely an increment
                        newValue = context.action === 'increase'
                            ? context.currentValue + num
                            : context.currentValue - num;
                    }
                }
            }
        }
        
        if (newValue === null) {
            const response = `❓ I didn't understand that. Please specify:
• A number (e.g., "8000")
• A value with units (e.g., "400 in/min", "5 m/min")
• A percentage (e.g., "25%")
• Or say "cancel" to abort`;
            this.onResponse(response);
            return { success: false, response };
        }
        
        // Round to reasonable precision
        newValue = Math.round(newValue);
        
        // Validate the new value
        const validation = this.validateSettingValue(context.setting, newValue);
        if (!validation.valid) {
            const response = `⚠️ ${validation.message}

Current: ${context.currentValue} ${setting.unit}
Requested: ${newValue} ${setting.unit}

Please enter a valid value or say "cancel".`;
            this.onResponse(response);
            return { success: false, response };
        }
        
        // Ask for confirmation
        const change = newValue - context.currentValue;
        const changePercent = ((change / context.currentValue) * 100).toFixed(1);
        const direction = change > 0 ? '📈 Increase' : '📉 Decrease';
        
        const response = `${direction} **${setting.description}**

| | Value |
|---|---|
| Current | ${context.currentValue} ${setting.unit} |
| New | ${newValue} ${setting.unit} |
| Change | ${change > 0 ? '+' : ''}${change} (${changePercent}%) |

**Confirm?** Say "yes" to apply, or "no" to cancel.`;
        
        // Update context for confirmation
        this.pendingContext = {
            type: 'confirm_setting',
            setting: context.setting,
            oldValue: context.currentValue,
            newValue: newValue,
            unitInfo: unitInfo,
            timestamp: Date.now()
        };
        
        this.conversationHistory.push({ role: 'assistant', content: response, time: Date.now() });
        this.onResponse(response);
        return { success: true, response, pending: true };
    }
    
    async processSettingsConfirmResponse(context, input) {
        const text = input.trim().toLowerCase();
        
        if (/\b(yes|yeah|yep|confirm|ok|okay|do it|apply|save)\b/i.test(text)) {
            this.pendingContext = null;
            return await this.applySetting(context.setting, context.newValue, context.oldValue, context.unitInfo || null);
        }
        
        if (/\b(no|nope|cancel|abort|don't|dont)\b/i.test(text)) {
            this.pendingContext = null;
            const response = '👍 Change cancelled. No settings were modified.';
            this.onResponse(response);
            return { success: true, response };
        }
        
        // Unclear response
        const response = `Please say **"yes"** to apply the change, or **"no"** to cancel.`;
        this.onResponse(response);
        return { success: false, response };
    }
    
    validateSettingValue(settingName, value) {
        const setting = this.settingsDatabase[settingName];
        
        // Basic validation
        if (value <= 0) {
            return { valid: false, message: 'Value must be greater than 0' };
        }
        
        // Setting-specific validation
        const code = setting.code;
        
        // Max speeds ($110-$112)
        if (['$110', '$111', '$112'].includes(code)) {
            if (value > 20000) {
                return { valid: false, message: `Speed ${value} mm/min is too high. Max recommended: 20000 mm/min` };
            }
            if (value < 100) {
                return { valid: false, message: `Speed ${value} mm/min is too low. Min recommended: 100 mm/min` };
            }
        }
        
        // Acceleration ($120-$122)
        if (['$120', '$121', '$122'].includes(code)) {
            if (value > 2000) {
                return { valid: false, message: `Acceleration ${value} mm/sec² is very high. This may cause missed steps.` };
            }
            if (value < 10) {
                return { valid: false, message: `Acceleration ${value} mm/sec² is too low.` };
            }
        }
        
        // Spindle speeds
        if (code === '$30' && value > 30000) {
            return { valid: false, message: `Spindle max ${value} RPM exceeds typical VFD limits.` };
        }
        
        return { valid: true };
    }
    
    async applySetting(settingName, newValue, oldValue = null, unitInfo = null) {
        const setting = this.settingsDatabase[settingName];
        const previousValue = oldValue ?? setting.currentValue;
        const unitInfoLine = unitInfo ? `\n${unitInfo}` : '';
        
        // Build the GRBL command
        const command = `${setting.code}=${newValue}`;
        
        // Send to machine
        if (this.grbl) {
            try {
                this.grbl.send(command);
                
                // Update local cache
                setting.currentValue = newValue;
                
                // Log the change
                this.settingsHistory.push({
                    setting: settingName,
                    code: setting.code,
                    oldValue: previousValue,
                    newValue: newValue,
                    timestamp: Date.now()
                });
                
                const response = `✅ **Setting Updated Successfully!**

**${setting.description}** (${setting.code})
${previousValue} → **${newValue}** ${setting.unit}${unitInfoLine}

\`\`\`
Sent: ${command}
\`\`\`

💾 Setting saved to machine EEPROM.

💡 *Tip: Say "undo" to revert this change, or "show settings history" to see all changes.*`;
                
                this.conversationHistory.push({ role: 'assistant', content: response, time: Date.now() });
                this.onResponse(response);
                return { success: true, response, command };
                
            } catch (err) {
                const response = `❌ Failed to apply setting: ${err.message}

The machine may not be connected. Check connection and try again.`;
                this.onError(response);
                return { success: false, response };
            }
        } else {
            // Simulation mode - no machine connected
            setting.currentValue = newValue;
            
            this.settingsHistory.push({
                setting: settingName,
                code: setting.code,
                oldValue: previousValue,
                newValue: newValue,
                timestamp: Date.now(),
                simulated: true
            });
            
            const response = `✅ **Setting Updated** (Simulation Mode)

**${setting.description}** (${setting.code})
${previousValue} → **${newValue}** ${setting.unit}${unitInfoLine}

⚠️ *Machine not connected - change will be applied when connected.*

\`\`\`
Command: ${command}
\`\`\``;
            
            this.conversationHistory.push({ role: 'assistant', content: response, time: Date.now() });
            this.onResponse(response);
            return { success: true, response, command, simulated: true };
        }
    }
    
    // ================================================================
    // Unit Conversion System
    // ================================================================
    
    /**
     * Parse a value with unit and convert to standard units
     * @param {string} input - e.g., "5 inches", "100 mm/min", "2.5in"
     * @param {string} targetType - 'length', 'speed', 'acceleration', 'rpm', 'time'
     * @returns {{ value: number, originalValue: number, originalUnit: string, converted: boolean }}
     */
    parseValueWithUnit(input, targetType = 'length') {
        const text = input.toString().toLowerCase().trim();
        
        // Replace aliases
        let normalized = text;
        for (const [alias, unit] of Object.entries(this.unitAliases)) {
            normalized = normalized.replace(alias, unit);
        }
        
        // Extract number and unit
        const match = normalized.match(/^([-+]?\d*\.?\d+)\s*([a-z\/\^²"]+)?$/i);
        if (!match) {
            // Try to find number anywhere
            const numMatch = normalized.match(/([-+]?\d*\.?\d+)/);
            if (numMatch) {
                return { value: parseFloat(numMatch[1]), originalValue: parseFloat(numMatch[1]), originalUnit: null, converted: false };
            }
            return null;
        }
        
        const originalValue = parseFloat(match[1]);
        const unit = match[2]?.toLowerCase() || null;
        
        if (!unit) {
            return { value: originalValue, originalValue, originalUnit: null, converted: false };
        }
        
        // Find conversion factor
        const conversions = this.units[targetType];
        if (!conversions) {
            return { value: originalValue, originalValue, originalUnit: unit, converted: false };
        }
        
        const factor = conversions[unit];
        if (factor !== undefined) {
            return {
                value: originalValue * factor,
                originalValue,
                originalUnit: unit,
                converted: factor !== 1
            };
        }
        
        return { value: originalValue, originalValue, originalUnit: unit, converted: false };
    }
    
    /**
     * Convert between units
     * @param {number} value - The value to convert
     * @param {string} fromUnit - Source unit
     * @param {string} toUnit - Target unit
     * @param {string} type - 'length', 'speed', etc.
     * @returns {{ value: number, formatted: string }}
     */
    convertUnit(value, fromUnit, toUnit, type = 'length') {
        const conversions = this.units[type];
        if (!conversions) return { value, formatted: `${value}` };
        
        const fromFactor = conversions[fromUnit.toLowerCase()] || 1;
        const toFactor = conversions[toUnit.toLowerCase()] || 1;
        
        const converted = (value * fromFactor) / toFactor;
        const decimals = converted < 1 ? 4 : (converted < 100 ? 2 : 1);
        
        return {
            value: converted,
            formatted: `${converted.toFixed(decimals)} ${toUnit}`
        };
    }
    
    /**
     * Smart conversion that auto-detects unit type
     */
    smartConvert(input) {
        const text = input.toLowerCase();
        
        // Detect conversion request: "convert 5 inches to mm"
        const convertMatch = text.match(/convert\s+([\d.]+)\s*(\S+)\s+(?:to|into|in)\s+(\S+)/i);
        if (convertMatch) {
            const value = parseFloat(convertMatch[1]);
            const fromUnit = convertMatch[2];
            const toUnit = convertMatch[3];
            
            // Detect type
            let type = 'length';
            if (fromUnit.includes('/') || toUnit.includes('/')) {
                type = fromUnit.includes('s2') || fromUnit.includes('s^2') ? 'acceleration' : 'speed';
            } else if (fromUnit.includes('rpm') || toUnit.includes('rpm')) {
                type = 'rpm';
            }
            
            const result = this.convertUnit(value, fromUnit, toUnit, type);
            return {
                success: true,
                response: `📐 **Unit Conversion**\n\n${value} ${fromUnit} = **${result.formatted}**`
            };
        }
        
        // "What is X in Y" pattern
        const whatIsMatch = text.match(/what(?:'s| is)\s+([\d.]+)\s*(\S+)\s+in\s+(\S+)/i);
        if (whatIsMatch) {
            const value = parseFloat(whatIsMatch[1]);
            const fromUnit = whatIsMatch[2];
            const toUnit = whatIsMatch[3];
            
            let type = 'length';
            if (fromUnit.includes('/') || toUnit.includes('/')) {
                type = 'speed';
            }
            
            const result = this.convertUnit(value, fromUnit, toUnit, type);
            return {
                success: true,
                response: `📐 ${value} ${fromUnit} = **${result.formatted}**`
            };
        }
        
        return null;
    }
    
    /**
     * Parse distance/movement with any unit, convert to mm
     */
    parseDistance(input) {
        return this.parseValueWithUnit(input, 'length');
    }
    
    /**
     * Parse speed with any unit, convert to mm/min
     */
    parseSpeed(input) {
        return this.parseValueWithUnit(input, 'speed');
    }
    
    /**
     * Generate a helpful unit conversion table
     */
    getUnitConversionHelp(value, type = 'length') {
        const conversions = this.units[type];
        if (!conversions) return '';
        
        let response = `📐 **${value} in different units:**\n\n| Unit | Value |\n|------|-------|\n`;
        
        const displayUnits = type === 'length' 
            ? ['mm', 'cm', 'in', 'ft', 'm']
            : type === 'speed'
            ? ['mm/min', 'mm/sec', 'in/min', 'm/min']
            : type === 'acceleration'
            ? ['mm/s^2', 'in/s^2', 'g']
            : ['mm'];
        
        for (const unit of displayUnits) {
            const factor = conversions[unit] || 1;
            const converted = value / factor;
            const decimals = converted < 1 ? 4 : (converted < 100 ? 2 : 1);
            response += `| ${unit} | ${converted.toFixed(decimals)} |\n`;
        }
        
        return response;
    }
    
    // ================================================================
    // Enhanced Natural Language Processing
    // ================================================================
    
    /**
     * Preprocess input for better understanding
     */
    preprocessInput(input) {
        let text = input.toLowerCase().trim();
        
        // Remove filler words
        const fillerWords = [
            'please', 'can you', 'could you', 'would you', 'i want to', 'i need to',
            'i would like to', 'we need to', 'we should', 'lets', "let's", 'go ahead and',
            'just', 'maybe', 'probably', 'i think', 'perhaps', 'kindly', 'hey', 'hi', 'hello'
        ];
        
        for (const filler of fillerWords) {
            text = text.replace(new RegExp(`^${filler}\\s+`, 'i'), '');
            text = text.replace(new RegExp(`\\s+${filler}\\s+`, 'gi'), ' ');
        }
        
        // Normalize units
        text = text.replace(/millimeters?/gi, 'mm');
        text = text.replace(/centimeters?/gi, 'cm');
        text = text.replace(/inches?/gi, 'in');
        text = text.replace(/feet|foot/gi, 'ft');
        text = text.replace(/meters?/gi, 'm');
        
        // Normalize speed terms
        text = text.replace(/per minute/gi, '/min');
        text = text.replace(/per second/gi, '/sec');
        text = text.replace(/per min/gi, '/min');
        text = text.replace(/per sec/gi, '/sec');
        
        // Normalize common phrases
        text = text.replace(/maximum speed/gi, 'max speed');
        text = text.replace(/max rate/gi, 'max speed');
        text = text.replace(/feed rate/gi, 'feed');
        text = text.replace(/rapid rate/gi, 'max speed');
        
        return text.trim();
    }
    
    // ================================================================
    // Machine State Validation
    // ================================================================
    
    /**
     * Check if machine state allows the requested operation
     * Returns { allowed: boolean, warning: string | null }
     */
    checkMachineStateForAction(action) {
        if (!this.getMachineState) {
            return { allowed: true, warning: null };
        }
        
        try {
            const state = this.getMachineState();
            
            if (!state.connected) {
                return { 
                    allowed: false, 
                    warning: '❌ **Not Connected** - Connect to the machine first.' 
                };
            }
            
            // Actions that shouldn't run during Alarm
            const noAlarmActions = ['jog', 'moveTo', 'rapidXY', 'rapidZ', 'spindle', 'runJob', 'probe', 'probeCorner'];
            if (noAlarmActions.includes(action) && state.state === 'Alarm') {
                return { 
                    allowed: false, 
                    warning: '⚠️ **Machine in ALARM** - Clear alarm ($X) or home ($H) first.' 
                };
            }
            
            // Actions that shouldn't run during a job
            const noRunningActions = ['jog', 'moveTo', 'rapidXY', 'home'];
            if (noRunningActions.includes(action) && state.state === 'Run') {
                return { 
                    allowed: false, 
                    warning: '⏸️ **Job Running** - Pause or stop the job first.' 
                };
            }
            
            // Warn about homing for movement actions
            const movementActions = ['jog', 'moveTo', 'rapidXY', 'rapidZ'];
            if (movementActions.includes(action) && state.homedAxes) {
                const { x, y, z } = state.homedAxes;
                if (!x || !y || !z) {
                    return { 
                        allowed: true, 
                        warning: '⚠️ Not all axes homed - positions may be inaccurate.' 
                    };
                }
            }
            
            // TMC driver warnings
            if (state.tmcStatus) {
                const tmc = state.tmcStatus;
                for (const axis of ['x', 'y', 'z']) {
                    if (tmc[axis]) {
                        if (tmc[axis].ot) {
                            return { 
                                allowed: false, 
                                warning: `🔥 **${axis.toUpperCase()} Motor OVERTEMP** - Let it cool down!` 
                            };
                        }
                        if (tmc[axis].shortCircuit) {
                            return { 
                                allowed: false, 
                                warning: `⚠️ **${axis.toUpperCase()} Driver SHORT CIRCUIT** - Check wiring!` 
                            };
                        }
                    }
                }
            }
            
            return { allowed: true, warning: null };
        } catch (e) {
            console.warn('State check failed:', e);
            return { allowed: true, warning: null };
        }
    }
    
    // ================================================================
    // Additional Smart Commands  
    // ================================================================
    
    async executeAction(action, params, originalInput) {
        let response = '';
        let gcode = null;
        
        // Check machine state before executing
        const stateCheck = this.checkMachineStateForAction(action);
        if (!stateCheck.allowed) {
            this.onResponse(stateCheck.warning);
            return { success: false, response: stateCheck.warning };
        }
        
        try {
            switch (action) {
                case 'jog': {
                    // Check limits before jogging
                    const limitCheck = this.checkMoveLimits(params.axis, params.distance, true);
                    if (!limitCheck.safe) {
                        // If it requires confirmation (large move), set up pending context
                        if (limitCheck.requiresConfirmation) {
                            this.pendingContext = {
                                type: 'confirm_large_jog',
                                axis: params.axis,
                                distance: params.distance,
                                timestamp: Date.now()
                            };
                        }
                        response = limitCheck.message;
                        this.onResponse(response);
                        return { success: false, response, needsConfirmation: limitCheck.requiresConfirmation };
                    }
                    
                    const feed = params.axis === 'Z' ? 1000 : 3000;
                    gcode = `$J=G91 ${params.axis}${params.distance} F${feed}`;
                    response = `Jogging ${params.axis} axis ${params.distance > 0 ? '+' : ''}${params.distance}mm`;
                    if (limitCheck.warning) response += `\n⚠️ ${limitCheck.warning}`;
                    this.speakConfirmation('jog');
                    break;
                }
                
                case 'moveTo': {
                    // Check limits for absolute move
                    const limitCheck = this.checkMoveLimits(params.axis, params.pos, false);
                    if (!limitCheck.safe) {
                        response = limitCheck.message;
                        this.onResponse(response);
                        return { success: false, response };
                    }
                    
                    const feed = params.axis === 'Z' ? 1000 : 5000;
                    gcode = `G90 G0 ${params.axis}${params.pos}`;
                    response = `Moving ${params.axis} to ${params.pos}mm`;
                    if (limitCheck.warning) response += `\n⚠️ ${limitCheck.warning}`;
                    this.speakConfirmation('jog');
                    break;
                }
                
                case 'rapidXY': {
                    // Check both X and Y limits
                    const limitCheckX = this.checkMoveLimits('X', params.x, false);
                    const limitCheckY = this.checkMoveLimits('Y', params.y, false);
                    
                    if (!limitCheckX.safe) {
                        response = limitCheckX.message;
                        this.onResponse(response);
                        return { success: false, response };
                    }
                    if (!limitCheckY.safe) {
                        response = limitCheckY.message;
                        this.onResponse(response);
                        return { success: false, response };
                    }
                    
                    gcode = `G90 G0 X${params.x} Y${params.y}`;
                    response = `Rapid move to X${params.x} Y${params.y}`;
                    
                    const warnings = [limitCheckX.warning, limitCheckY.warning].filter(Boolean);
                    if (warnings.length) response += `\n⚠️ ${warnings.join(', ')}`;
                    this.speakConfirmation('jog');
                    break;
                }
                
                case 'home': {
                    if (params.axes === 'ALL' || params.axes === 'XYZ') {
                        gcode = '$H';
                        response = 'Homing all axes...';
                    } else {
                        gcode = `$H${params.axes}`;
                        response = `Homing ${params.axes} axis...`;
                    }
                    this.speakConfirmation('home');
                    break;
                }
                
                case 'zero': {
                    const axes = params.axes.split('');
                    gcode = axes.map(a => `G10 L20 P1 ${a}0`);
                    response = `Setting ${params.axes} zero at current position`;
                    this.speakConfirmation('zero');
                    break;
                }
                
                case 'spindleOn': {
                    const rpm = Math.min(Math.max(params.rpm, this.machineConfig.spindleMin), this.machineConfig.spindleMax);
                    gcode = `M3 S${rpm}`;
                    response = `Spindle ON at ${rpm} RPM`;
                    if (params.rpm !== rpm) {
                        response += ` (clamped from ${params.rpm})`;
                    }
                    this.speakConfirmation('spindleOn');
                    break;
                }
                
                case 'spindleOff': {
                    gcode = 'M5';
                    response = 'Spindle OFF';
                    this.speakConfirmation('spindleOff');
                    break;
                }
                
                case 'spindleSpeed': {
                    const rpm = Math.min(Math.max(params.rpm, this.machineConfig.spindleMin), this.machineConfig.spindleMax);
                    gcode = `S${rpm}`;
                    response = `Spindle speed set to ${rpm} RPM`;
                    break;
                }
                
                case 'coolantOn': {
                    gcode = params.type === 'mist' ? 'M7' : 'M8';
                    response = `${params.type === 'mist' ? 'Mist' : 'Flood'} coolant ON`;
                    this.speakConfirmation('coolantOn');
                    break;
                }
                
                case 'coolantOff': {
                    gcode = 'M9';
                    response = 'Coolant OFF';
                    this.speakConfirmation('coolantOff');
                    break;
                }
                
                case 'toolChange': {
                    if (params.tool < 1 || params.tool > this.machineConfig.toolCount) {
                        response = `❌ Tool ${params.tool} not available. Machine has tools 1-${this.machineConfig.toolCount}`;
                        this.onResponse(response);
                        return { success: false, response };
                    }
                    gcode = `M6 T${params.tool}`;
                    response = `Loading tool ${params.tool}...`;
                    this.speakConfirmation('toolChange');
                    break;
                }
                
                case 'probeZ': {
                    response = '📍 Starting Z probe cycle... Touch off on workpiece surface.';
                    this.onCommand({ action: 'openProbeWizard', type: 'z' });
                    this.speakConfirmation('probe');
                    break;
                }
                
                case 'probeCorner': {
                    response = '📍 Starting corner probe cycle...';
                    this.onCommand({ action: 'openProbeWizard', type: 'corner' });
                    this.speakConfirmation('probe');
                    break;
                }
                
                case 'probeTool': {
                    response = '📍 Starting tool length probe...';
                    this.onCommand({ action: 'openProbeWizard', type: 'tool' });
                    this.speakConfirmation('probe');
                    break;
                }
                
                case 'autoLevel': {
                    response = '📍 Starting bed leveling/surface scan...';
                    this.onCommand({ action: 'openProbeWizard', type: 'autoLevel' });
                    break;
                }
                
                case 'runJob': {
                    response = '▶️ Starting job...';
                    this.onCommand({ action: 'runJob' });
                    this.speakConfirmation('runJob');
                    break;
                }
                
                case 'pause': {
                    gcode = '!';
                    response = '⏸️ Feed hold - machine paused';
                    this.speakConfirmation('pause');
                    break;
                }
                
                case 'resume': {
                    gcode = '~';
                    response = '▶️ Resuming...';
                    this.speakConfirmation('resume');
                    break;
                }
                
                case 'stop': {
                    response = '⏹️ Stopping job...';
                    this.onCommand({ action: 'stop' });
                    this.speakConfirmation('stop');
                    break;
                }
                
                case 'estop': {
                    gcode = '\x18';
                    response = '🚨 EMERGENCY STOP ACTIVATED';
                    // Always speak E-stop alert
                    this.speakAlert('Emergency stop activated!');
                    break;
                }
                
                case 'cancelJob': {
                    response = '⏹️ Cancelling job...';
                    this.onCommand({ action: 'cancelJob' });
                    gcode = '\x18';  // Soft reset
                    this.speakConfirmation('stop');
                    break;
                }
                
                case 'status': {
                    response = this.getStatusReport();
                    break;
                }
                
                case 'feedOverride': {
                    const percent = Math.max(10, Math.min(200, params.percent));
                    response = `📊 Feed override set to ${percent}%`;
                    this.onCommand({ action: 'feedOverride', percent });
                    break;
                }
                
                case 'suggestFS': {
                    response = this.suggestFeedsAndSpeeds(params.material, params.toolDia);
                    break;
                }
                
                case 'analyzeGcode': {
                    response = '🔍 Analyzing G-code...';
                    this.onCommand({ action: 'analyzeGcode' });
                    break;
                }
                
                case 'voiceOn': {
                    this.startVoice();
                    return { success: true, response: '' };  // startVoice sends its own response
                }
                
                case 'voiceOff': {
                    this.stopVoice();
                    return { success: true, response: '' };  // stopVoice sends its own response
                }
                
                // Voice confirmation/denial (for pending commands)
                case 'confirm': {
                    if (this.voiceState.pendingConfirmation) {
                        const pending = this.voiceState.pendingConfirmation;
                        this.voiceState.pendingConfirmation = null;
                        this.onResponse(`✅ Confirmed!`);
                        this.speakConfirmation('confirmed');
                        return this.processInput(pending.transcript);
                    } else {
                        response = '✅ Nothing pending to confirm.';
                    }
                    break;
                }
                
                case 'deny': {
                    if (this.voiceState.pendingConfirmation) {
                        this.voiceState.pendingConfirmation = null;
                        response = '❌ Cancelled. Please say your command again.';
                        if (this.voiceFeedback.enabled) {
                            this.speak('Cancelled', false);
                        }
                    } else {
                        response = '❌ Nothing to cancel.';
                    }
                    break;
                }
                
                // Chatter detection control
                case 'chatterOn': {
                    response = '📊 **Chatter Detection Enabled**\n\nMonitoring vibration levels...';
                    this.onCommand({ action: 'chatterOn' });
                    break;
                }
                
                case 'chatterOff': {
                    response = '📊 Chatter detection disabled.';
                    this.onCommand({ action: 'chatterOff' });
                    break;
                }
                
                // Next tool (without specifying number)
                case 'nextTool': {
                    response = '🔧 Advancing to next tool...';
                    gcode = 'M6';  // Standard tool change
                    this.speakConfirmation('toolChange');
                    break;
                }
                
                // Safe Z movement
                case 'safeZ': {
                    const safeHeight = 25;  // Default safe Z height in work coordinates
                    const limitCheck = this.checkMoveLimits('Z', safeHeight, false);
                    if (!limitCheck.safe) {
                        response = limitCheck.message;
                        this.onResponse(response);
                        return { success: false, response };
                    }

                    response = `⬆️ Moving to safe Z height (${safeHeight}mm)`;
                    if (limitCheck.warning) response += `\n⚠️ ${limitCheck.warning}`;
                    gcode = `G90 G0 Z${safeHeight}`;
                    this.speakConfirmation('jog');
                    break;
                }
                
                // Feed adjustment (relative)
                case 'feedAdjust': {
                    const delta = params.delta || 10;
                    // Get current override from grbl if available
                    const currentOverride = this.grbl?.state?.feedOverride || 100;
                    const newOverride = Math.max(10, Math.min(200, currentOverride + delta));
                    response = delta > 0 
                        ? `⏫ Feed override: ${currentOverride}% → ${newOverride}%`
                        : `⏬ Feed override: ${currentOverride}% → ${newOverride}%`;
                    this.onCommand({ action: 'feedOverride', percent: newOverride });
                    break;
                }
                
                case 'help': {
                    response = this.getHelpText();
                    break;
                }
                
                default:
                    response = `Unknown action: ${action}`;
            }
            
            // Add state warning to response if there was one
            if (stateCheck.warning) {
                response += `\n${stateCheck.warning}`;
            }
            
            // Execute G-code if generated
            if (gcode && this.grbl) {
                if (Array.isArray(gcode)) {
                    for (const cmd of gcode) {
                        this.grbl.send(cmd);
                    }
                } else {
                    this.grbl.send(gcode);
                }
            }
            
            this.conversationHistory.push({ role: 'assistant', content: response, time: Date.now() });
            this.onResponse(response);
            return { success: true, response, gcode };
            
        } catch (err) {
            const errMsg = `Error: ${err.message}`;
            this.onError(errMsg);
            return { success: false, response: errMsg };
        }
    }
    
    conversationalResponse(input) {
        // Handle general questions about CNC
        const lower = input.toLowerCase();
        let response = '';
        
        // Check for undo command
        if (/\b(undo|revert|rollback)\b/i.test(lower)) {
            return this.undoLastSetting();
        }
        
        // Check for settings history
        if (/\b(settings?\s*history|changes?\s*history|what.*changed|show.*changes)\b/i.test(lower)) {
            return this.showSettingsHistory();
        }
        
        // Check for list all settings
        if (/\b(list|show|all)\s*(settings?|parameters?)\b/i.test(lower)) {
            return this.listAllSettings();
        }
        
        // Check for unit conversion help
        if (/\b(convert|conversion|units?)\b/i.test(lower) && /\b(help|how|what)\b/i.test(lower)) {
            response = this.getUnitConversionHelpText();
            this.conversationHistory.push({ role: 'assistant', content: response, time: Date.now() });
            this.onResponse(response);
            return { success: true, response };
        }
        
        if (lower.includes('what is') || lower.includes('explain')) {
            if (lower.includes('wcs') || lower.includes('work coordinate')) {
                response = `📚 **Work Coordinate System (WCS)**: G54-G59 define different zero points. G54 is the default. Use "zero X Y Z" to set the current position as zero. Useful for multi-part setups or fixtures.`;
            } else if (lower.includes('feed') && lower.includes('speed')) {
                response = `📚 **Feeds & Speeds**: Feed is how fast the tool moves (mm/min). Speed is spindle RPM. Higher speeds for harder materials need lower feeds. Ask me "what feeds for aluminum with 6mm endmill" for specific recommendations!`;
            } else if (lower.includes('probe') || lower.includes('probing')) {
                response = `📚 **Probing**: Uses a touch probe to find exact positions. Z probe finds workpiece top. Corner probe finds X/Y zero. Tool probe measures tool length. All critical for accurate machining!`;
            } else if (lower.includes('atc') || lower.includes('tool changer')) {
                response = `📚 **ATC**: Automatic Tool Changer. This machine has ${this.machineConfig.toolCount} tools with ${this.machineConfig.toolSpacing}mm spacing. Say "change tool 3" to swap tools automatically.`;
            } else {
                response = `🤔 I can explain CNC concepts! Try asking about: WCS, feeds & speeds, probing, ATC, G-code commands, etc.`;
            }
        } else if (lower.includes('ready') || lower.includes('set up') || lower.includes('checklist')) {
            response = this.getMachineChecklist();
        } else if (lower.includes('problem') || lower.includes('issue') || lower.includes('wrong')) {
            response = this.getTroubleshootingTips();
        } else {
            response = `🤖 I didn't understand that. Try commands like:
• "jog X 10" or "jog X 0.5 inches"
• "home all" - home machine  
• "increase Z max speed" - modify settings
• "set feed to 100 in/min" - with unit conversion
• "convert 5 inches to mm" - unit conversion
• "what feeds for aluminum with 6mm"

Type "help" for full command list!`;
        }
        
        this.conversationHistory.push({ role: 'assistant', content: response, time: Date.now() });
        this.onResponse(response);
        return { success: true, response };
    }
    
    getUnitConversionHelpText() {
        return `## 📐 Unit Conversion Help

**Supported Units:**

| Type | Units |
|------|-------|
| **Length** | mm, cm, m, in (inches), ft (feet), thou/mil |
| **Speed** | mm/min, mm/sec, in/min, in/sec, ft/min, m/min |
| **Acceleration** | mm/s², in/s², g |
| **Time** | ms, sec, min, hr |

**How to use:**
• \`convert 5 inches to mm\` → 127mm
• \`what is 100 in/min in mm/min\` → 2540 mm/min
• \`set Z max speed to 300 in/min\` → auto-converts to 7620 mm/min
• \`jog X 0.5 inches\` → moves 12.7mm

**Examples:**
• "increase Z max speed" → then answer "100 in/min more"
• "set X acceleration to 0.1g"
• "move to X 2 inches"`;
    }
    
    undoLastSetting() {
        if (this.settingsHistory.length === 0) {
            const response = '📋 No settings changes to undo.';
            this.onResponse(response);
            return { success: true, response };
        }
        
        const lastChange = this.settingsHistory[this.settingsHistory.length - 1];
        const setting = this.settingsDatabase[lastChange.setting];
        
        // Restore the old value
        const command = `${lastChange.code}=${lastChange.oldValue}`;
        
        if (this.grbl) {
            this.grbl.send(command);
        }
        
        // Update local cache
        setting.currentValue = lastChange.oldValue;
        
        // Remove from history
        this.settingsHistory.pop();
        
        const response = `↩️ **Setting Reverted**

**${setting.description}** (${lastChange.code})
${lastChange.newValue} → **${lastChange.oldValue}** ${setting.unit}

\`\`\`
Sent: ${command}
\`\`\``;
        
        this.onResponse(response);
        return { success: true, response, command };
    }
    
    showSettingsHistory() {
        if (this.settingsHistory.length === 0) {
            const response = '📋 No settings have been changed this session.';
            this.onResponse(response);
            return { success: true, response };
        }
        
        let response = `## 📋 Settings Change History\n\n`;
        response += `| # | Setting | Old | New | Time |\n`;
        response += `|---|---------|-----|-----|------|\n`;
        
        this.settingsHistory.forEach((change, i) => {
            const time = new Date(change.timestamp).toLocaleTimeString();
            const setting = this.settingsDatabase[change.setting];
            response += `| ${i + 1} | ${change.code} ${setting?.description || change.setting} | ${change.oldValue} | ${change.newValue} | ${time} |\n`;
        });
        
        response += `\n💡 Say "undo" to revert the last change.`;
        
        this.onResponse(response);
        return { success: true, response };
    }
    
    listAllSettings() {
        let response = `## ⚙️ Machine Settings\n\n`;
        response += `| Setting | Code | Current Value |\n`;
        response += `|---------|------|---------------|\n`;
        
        const seen = new Set();
        for (const [name, setting] of Object.entries(this.settingsDatabase)) {
            if (seen.has(setting.code)) continue;
            seen.add(setting.code);
            response += `| ${setting.description} | ${setting.code} | ${setting.currentValue} ${setting.unit} |\n`;
        }
        
        response += `\n💡 Say "increase [setting name]" or "set [setting] to [value]" to modify.`;
        
        this.onResponse(response);
        return { success: true, response };
    }
    
    // ================================================================
    // Feeds & Speeds Calculator
    // ================================================================
    
    suggestFeedsAndSpeeds(materialName, toolDiameter) {
        // Normalize material name
        const matKey = materialName.toLowerCase().replace(/[^a-z]/g, '');
        let material = null;
        
        for (const [key, val] of Object.entries(this.materials)) {
            if (key.includes(matKey) || matKey.includes(key)) {
                material = val;
                break;
            }
        }
        
        if (!material) {
            return `❌ Unknown material "${materialName}". I know: aluminum, steel, wood, plastic, brass, foam`;
        }
        
        // Find closest tool size
        const toolSizes = ['3mm', '6mm', '10mm'];
        let closestSize = '6mm';
        let minDiff = Infinity;
        for (const size of toolSizes) {
            const sizeMm = parseFloat(size);
            const diff = Math.abs(sizeMm - toolDiameter);
            if (diff < minDiff) {
                minDiff = diff;
                closestSize = size;
            }
        }
        
        const sfm = material.sfm.carbide;
        const chipLoad = material.chipLoad[closestSize];
        const docRough = material.doc.rough * toolDiameter;
        const docFinish = material.doc.finish * toolDiameter;
        
        // Calculate RPM: SFM × 3.82 / diameter (inches) 
        // Or: SFM × 1000 / (π × diameter mm) ≈ SFM × 318.3 / diameter
        let rpm = Math.round((sfm * 318.3) / toolDiameter);
        rpm = Math.min(rpm, this.machineConfig.spindleMax);
        rpm = Math.max(rpm, this.machineConfig.spindleMin);
        
        // Calculate feed: RPM × chip load × flutes (assume 2 flutes)
        const flutes = toolDiameter < 4 ? 2 : (toolDiameter < 8 ? 3 : 4);
        let feedRate = Math.round(rpm * chipLoad * flutes);
        feedRate = Math.min(feedRate, this.machineConfig.maxFeedXY);
        
        // Plunge rate (25-50% of feed)
        const plungeRate = Math.round(feedRate * 0.35);
        
        return `🔧 **Feeds & Speeds for ${materialName} with ${toolDiameter}mm tool:**

| Parameter | Roughing | Finishing |
|-----------|----------|-----------|
| **RPM** | ${rpm} | ${rpm} |
| **Feed** | ${feedRate} mm/min | ${Math.round(feedRate * 0.7)} mm/min |
| **Plunge** | ${plungeRate} mm/min | ${Math.round(plungeRate * 0.7)} mm/min |
| **DOC** | ${docRough.toFixed(1)}mm | ${docFinish.toFixed(1)}mm |
| **Stepover** | ${Math.round(toolDiameter * 0.4)}mm (40%) | ${Math.round(toolDiameter * 0.1)}mm (10%) |

\`\`\`gcode
(Roughing)
S${rpm} M3
F${feedRate}

(Finishing)  
S${rpm} M3
F${Math.round(feedRate * 0.7)}
\`\`\`

💡 *Adjust based on your machine rigidity and tool condition!*`;
    }
    
    // ================================================================
    // G-code Analysis - Enhanced with Parser Integration
    // ================================================================
    
    analyzeGcode(gcodeLines) {
        // Use the enhanced GCodeParser if available
        if (typeof GCodeParser !== 'undefined') {
            return this.analyzeGcodeWithParser(gcodeLines);
        }
        
        // Fallback to basic analysis
        return this.analyzeGcodeBasic(gcodeLines);
    }

    analyzeGcodeWithParser(gcodeLines) {
        const parser = new GCodeParser();
        const gcodeText = Array.isArray(gcodeLines) ? gcodeLines.join('\n') : gcodeLines;
        const parseResult = parser.parse(gcodeText);
        const analysis = parser.getAnalysis();
        
        // Build enhanced report
        let text = `## 📊 G-code Analysis Report\n\n`;
        
        // Quality badge
        const qualityEmoji = {
            'Excellent': '🌟',
            'Good': '✅',
            'Fair': '⚠️',
            'Needs Review': '🔶',
            'Poor': '❌'
        };
        text += `**Quality: ${qualityEmoji[analysis.quality] || '📋'} ${analysis.quality}** (Score: ${analysis.score}/100)\n\n`;
        
        // Statistics
        text += `### 📈 Statistics\n`;
        text += `| Metric | Value |\n|--------|-------|\n`;
        text += `| Lines | ${analysis.summary.lineCount} |\n`;
        text += `| Total Moves | ${analysis.summary.moveCount} |\n`;
        text += `| Rapids (G0) | ${parseResult.rapidMoves} |\n`;
        text += `| Cuts (G1) | ${parseResult.feedMoves} |\n`;
        text += `| Arcs (G2/G3) | ${parseResult.arcMoves} |\n`;
        text += `| Tool Changes | ${parseResult.toolChanges} |\n`;
        text += `| Canned Cycles | ${analysis.summary.cannedCycles} |\n`;
        text += `| Estimated Time | ${this.formatTime(analysis.summary.estimatedTime)} |\n`;
        text += `| Total Distance | ${analysis.summary.totalDistance.toFixed(1)} mm |\n\n`;
        
        // Bounds
        const bounds = parseResult.bounds;
        if (bounds) {
            text += `### 📐 Work Envelope\n`;
            text += `| Axis | Min | Max | Range |\n|------|-----|-----|-------|\n`;
            text += `| X | ${bounds.min.x.toFixed(2)} | ${bounds.max.x.toFixed(2)} | ${(bounds.max.x - bounds.min.x).toFixed(2)} mm |\n`;
            text += `| Y | ${bounds.min.y.toFixed(2)} | ${bounds.max.y.toFixed(2)} | ${(bounds.max.y - bounds.min.y).toFixed(2)} mm |\n`;
            text += `| Z | ${bounds.min.z.toFixed(2)} | ${bounds.max.z.toFixed(2)} | ${(bounds.max.z - bounds.min.z).toFixed(2)} mm |\n\n`;
        }
        
        // Tools used
        if (parseResult.tools && parseResult.tools.size > 0) {
            text += `### 🔧 Tools Used\n`;
            text += `Tools: ${Array.from(parseResult.tools).sort((a,b) => a-b).map(t => `T${t}`).join(', ')}\n\n`;
        }
        
        // Work coordinate systems used
        if (parseResult.wcs && parseResult.wcs.size > 1) {
            text += `### 📍 Work Coordinate Systems\n`;
            text += `Used: ${Array.from(parseResult.wcs).join(', ')}\n\n`;
        }
        
        // Issues
        if (analysis.issues.length > 0) {
            const errors = analysis.issues.filter(i => i.severity === 'error');
            const warnings = analysis.issues.filter(i => i.severity === 'warning');
            const infos = analysis.issues.filter(i => i.severity === 'info');
            
            if (errors.length > 0) {
                text += `### 🔴 Errors (${errors.length})\n`;
                errors.forEach(i => text += `- **Line ${i.line}**: ${i.message}\n`);
                text += '\n';
            }
            
            if (warnings.length > 0) {
                text += `### ⚠️ Warnings (${warnings.length})\n`;
                warnings.forEach(i => text += `- Line ${i.line}: ${i.message}\n`);
                text += '\n';
            }
            
            if (infos.length > 0) {
                text += `### ℹ️ Info (${infos.length})\n`;
                infos.forEach(i => text += `- Line ${i.line}: ${i.message}\n`);
                text += '\n';
            }
        }
        
        // Suggestions
        if (analysis.suggestions.length > 0) {
            text += `### 💡 Suggestions\n`;
            analysis.suggestions.forEach(s => text += `- ${s}\n`);
            text += '\n';
        }
        
        // All clear message
        if (analysis.issues.length === 0) {
            text += `### ✅ All Clear!\n`;
            text += `No issues found. G-code looks ready to run.\n\n`;
        }
        
        // Feed rate summary
        if (parseResult.feedRates && parseResult.feedRates.length > 0) {
            const feeds = parseResult.feedRates.sort((a,b) => a-b);
            text += `### ⚡ Feed Rates\n`;
            text += `Range: ${feeds[0]} - ${feeds[feeds.length-1]} mm/min\n`;
            if (feeds.length > 1) {
                text += `Used: ${feeds.slice(0, 5).join(', ')}${feeds.length > 5 ? '...' : ''}\n`;
            }
            text += '\n';
        }
        
        // Spindle speeds
        if (parseResult.spindleSpeeds && parseResult.spindleSpeeds.length > 0) {
            const speeds = parseResult.spindleSpeeds.sort((a,b) => a-b);
            text += `### 🌀 Spindle Speeds\n`;
            text += `Range: ${speeds[0]} - ${speeds[speeds.length-1]} RPM\n\n`;
        }
        
        return text;
    }

    formatTime(seconds) {
        if (!seconds || seconds <= 0) return '--:--';
        const hrs = Math.floor(seconds / 3600);
        const mins = Math.floor((seconds % 3600) / 60);
        const secs = Math.floor(seconds % 60);
        if (hrs > 0) {
            return `${hrs}h ${mins}m`;
        } else if (mins > 0) {
            return `${mins}m ${secs}s`;
        } else {
            return `${secs}s`;
        }
    }
    
    analyzeGcodeBasic(gcodeLines) {
        // Original basic analysis as fallback
        const issues = [];
        const warnings = [];
        const stats = {
            lineCount: gcodeLines.length,
            rapidMoves: 0,
            feedMoves: 0,
            arcMoves: 0,
            toolChanges: 0,
            minZ: Infinity,
            maxZ: -Infinity,
            estimatedTime: 0,
            feedRates: new Set(),
            spindleSpeeds: new Set()
        };
        
        let currentZ = 0;
        let currentFeed = 0;
        let isAbsolute = true;
        let lastPos = { x: 0, y: 0, z: 0 };
        let spindleOn = false;
        
        for (let i = 0; i < gcodeLines.length; i++) {
            const line = gcodeLines[i].trim().toUpperCase();
            const lineNum = i + 1;
            
            // Skip comments and empty
            if (!line || line.startsWith(';') || line.startsWith('(')) continue;
            
            // Parse line
            const gMatch = line.match(/G(\d+)/);
            const mMatch = line.match(/M(\d+)/);
            const fMatch = line.match(/F([\d.]+)/);
            const sMatch = line.match(/S(\d+)/);
            const xMatch = line.match(/X([-\d.]+)/);
            const yMatch = line.match(/Y([-\d.]+)/);
            const zMatch = line.match(/Z([-\d.]+)/);
            
            // Track state
            if (gMatch) {
                const g = parseInt(gMatch[1]);
                if (g === 90) isAbsolute = true;
                if (g === 91) isAbsolute = false;
                if (g === 0) stats.rapidMoves++;
                if (g === 1) stats.feedMoves++;
                if (g === 2 || g === 3) stats.arcMoves++;
            }
            
            if (mMatch) {
                const m = parseInt(mMatch[1]);
                if (m === 3 || m === 4) spindleOn = true;
                if (m === 5) spindleOn = false;
                if (m === 6) stats.toolChanges++;
            }
            
            if (fMatch) {
                currentFeed = parseFloat(fMatch[1]);
                stats.feedRates.add(currentFeed);
            }
            
            if (sMatch) {
                stats.spindleSpeeds.add(parseInt(sMatch[1]));
            }
            
            if (zMatch) {
                const z = parseFloat(zMatch[1]);
                const absZ = isAbsolute ? z : currentZ + z;
                stats.minZ = Math.min(stats.minZ, absZ);
                stats.maxZ = Math.max(stats.maxZ, absZ);
                currentZ = absZ;
            }
            
            // Issue detection
            
            // G1 without feed rate
            if (line.includes('G1') && currentFeed === 0 && !fMatch) {
                issues.push(`Line ${lineNum}: G1 move without feed rate set`);
            }
            
            // Cutting without spindle
            if ((line.includes('G1') || line.includes('G2') || line.includes('G3')) && !spindleOn) {
                if (zMatch && parseFloat(zMatch[1]) < 0) {
                    warnings.push(`Line ${lineNum}: Cutting move with spindle off`);
                }
            }
            
            // Very slow feed
            if (fMatch && currentFeed < 50 && !line.includes('G38')) {
                warnings.push(`Line ${lineNum}: Very slow feed rate (${currentFeed}mm/min)`);
            }
            
            // Excessive feed
            if (fMatch && currentFeed > this.machineConfig.maxFeedXY) {
                issues.push(`Line ${lineNum}: Feed rate ${currentFeed} exceeds machine max ${this.machineConfig.maxFeedXY}`);
            }
            
            // Deep single pass
            if (zMatch) {
                const zMove = isAbsolute ? parseFloat(zMatch[1]) - lastPos.z : parseFloat(zMatch[1]);
                if (zMove < -10 && line.includes('G1')) {
                    warnings.push(`Line ${lineNum}: Deep Z plunge (${Math.abs(zMove).toFixed(1)}mm) - consider ramping`);
                }
            }
            
            // Update last position
            if (xMatch) lastPos.x = parseFloat(xMatch[1]);
            if (yMatch) lastPos.y = parseFloat(yMatch[1]);
            if (zMatch) lastPos.z = parseFloat(zMatch[1]);
        }
        
        // Out of bounds check
        if (stats.minZ < -this.machineConfig.workArea.z) {
            issues.push(`Z depth (${Math.abs(stats.minZ).toFixed(1)}mm) exceeds work area (${this.machineConfig.workArea.z}mm)`);
        }
        
        // Compile report
        const report = {
            issues,
            warnings,
            stats: {
                ...stats,
                feedRates: Array.from(stats.feedRates).sort((a, b) => a - b),
                spindleSpeeds: Array.from(stats.spindleSpeeds).sort((a, b) => a - b)
            }
        };
        
        return this.formatAnalysisReport(report);
    }
    
    formatAnalysisReport(report) {
        const { issues, warnings, stats } = report;
        
        let text = `## 📊 G-code Analysis Report

**Stats:**
- Lines: ${stats.lineCount}
- Rapid moves: ${stats.rapidMoves}
- Feed moves: ${stats.feedMoves}  
- Arc moves: ${stats.arcMoves}
- Tool changes: ${stats.toolChanges}
- Z range: ${stats.minZ.toFixed(2)} to ${stats.maxZ.toFixed(2)}mm
- Feed rates: ${stats.feedRates.join(', ')} mm/min
- Spindle speeds: ${stats.spindleSpeeds.join(', ')} RPM

`;
        
        if (issues.length > 0) {
            text += `**🔴 Issues (${issues.length}):**\n`;
            issues.forEach(i => text += `- ${i}\n`);
            text += '\n';
        }
        
        if (warnings.length > 0) {
            text += `**⚠️ Warnings (${warnings.length}):**\n`;
            warnings.forEach(w => text += `- ${w}\n`);
            text += '\n';
        }
        
        if (issues.length === 0 && warnings.length === 0) {
            text += `✅ **No issues found!** G-code looks good.\n`;
        }
        
        return text;
    }
    
    // ================================================================
    // Anomaly Detection
    // ================================================================
    
    detectAnomalies(state, expectedState = null) {
        const anomalies = [];
        
        // Spindle load too high (if available)
        if (state.spindleLoad && state.spindleLoad > this.anomalyThresholds.spindleLoadHigh) {
            anomalies.push({
                type: 'high_spindle_load',
                severity: 'warning',
                message: `Spindle load at ${state.spindleLoad}% - possible tool wear or too aggressive cut`
            });
        }
        
        // Feed rate deviation from expected
        if (expectedState?.feedRate && state.feedRate) {
            const deviation = Math.abs(state.feedRate - expectedState.feedRate) / expectedState.feedRate;
            if (deviation > this.anomalyThresholds.feedDeviation) {
                anomalies.push({
                    type: 'feed_deviation',
                    severity: 'info',
                    message: `Feed rate ${state.feedRate} deviates ${(deviation * 100).toFixed(0)}% from expected ${expectedState.feedRate}`
                });
            }
        }
        
        // Alarm state
        if (state.status === 'Alarm') {
            anomalies.push({
                type: 'alarm',
                severity: 'critical',
                message: 'Machine in alarm state - check limits and E-stop'
            });
        }
        
        // Door open during run
        if (state.status === 'Run' && state.pins?.includes('D')) {
            anomalies.push({
                type: 'door_open',
                severity: 'warning',
                message: 'Door open during operation'
            });
        }
        
        return anomalies;
    }
    
    // ================================================================
    // Voice Commands
    // ================================================================
    
    initVoice() {
        if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
            console.log('[AI] Voice recognition not supported');
            return;
        }
        
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        this.recognition = new SpeechRecognition();
        this.recognition.continuous = true;  // Keep listening
        this.recognition.interimResults = true;  // Show partial results
        this.recognition.lang = 'en-US';
        this.recognition.maxAlternatives = 5;  // More alternatives for better matching
        
        this.interimTranscript = '';
        this.finalTranscript = '';
        this.voiceConfidence = 0;
        this.lastSpeechTime = 0;
        this.speechDebounceTimer = null;
        
        this.recognition.onresult = (event) => {
            this.interimTranscript = '';
            
            for (let i = event.resultIndex; i < event.results.length; i++) {
                const result = event.results[i];
                
                if (result.isFinal) {
                    // Get the best transcript from alternatives
                    const bestResult = this.getBestTranscript(result);
                    const transcript = bestResult.transcript;
                    const confidence = bestResult.confidence;
                    
                    this.finalTranscript = transcript;
                    this.voiceConfidence = confidence;
                    
                    // Debounce rapid multiple results
                    const now = Date.now();
                    if (now - this.lastSpeechTime < 500) {
                        console.log('[Voice] Debounce: skipping duplicate result');
                        continue;
                    }
                    this.lastSpeechTime = now;
                    
                    console.log(`[Voice] Final: "${transcript}" (${(confidence * 100).toFixed(0)}% confident)`);
                    
                    // Pre-process the transcript
                    const processed = this.preprocessVoiceInput(transcript);
                    
                    // Filter out noise and non-commands
                    if (this.isNoise(processed)) {
                        console.log('[Voice] Filtered as noise:', transcript);
                        continue;
                    }
                    
                    // Check wake word if required
                    if (this.requireWakeWord && !this.hasWakeWord(processed)) {
                        console.log('[Voice] No wake word detected, ignoring');
                        continue;
                    }
                    
                    // Remove wake word for processing
                    const command = this.removeWakeWord(processed);
                    
                    // Update voice state
                    this.voiceState.lastCommand = command;
                    this.voiceState.lastConfidence = confidence;
                    this.voiceState.sessionCommands++;
                    
                    // Handle pending confirmation first
                    if (this.voiceState.pendingConfirmation) {
                        this.handleConfirmation(command);
                        continue;
                    }
                    
                    // Show what we heard and process
                    if (confidence < 0.6) {
                        // Low confidence - ask for confirmation
                        this.voiceState.pendingConfirmation = {
                            transcript: command,
                            confidence,
                            timestamp: Date.now()
                        };
                        this.onResponse(`🎤 I heard: "${command}"\n\n*Confidence: ${(confidence * 100).toFixed(0)}%*\n\nSay **"yes"** to confirm, **"no"** to cancel, or repeat your command.`);
                        if (this.voiceFeedback.enabled) {
                            this.speak(`I heard ${command}. Is that correct?`, false);
                        }
                    } else if (confidence < 0.75) {
                        // Medium confidence - show what we heard but proceed
                        console.log(`[Voice] Medium confidence (${(confidence * 100).toFixed(0)}%), processing anyway`);
                        this.processInput(command);
                    } else {
                        // High confidence - process directly
                        this.processInput(command);
                    }
                } else {
                    this.interimTranscript = result[0].transcript;
                    // Optionally show interim results
                    if (this.showInterimResults) {
                        this.onInterimResult?.(`🎤 ${this.interimTranscript}...`);
                    }
                }
            }
        };
        
        this.recognition.onerror = (event) => {
            console.error('[Voice Error]', event.error);
            this.voiceState.consecutiveErrors++;
            
            if (event.error === 'no-speech') {
                // Silent - this is fine, don't spam user
                if (this.voiceState.consecutiveErrors > 5) {
                    this.onResponse('🎤 Still listening... Speak when ready.');
                    this.voiceState.consecutiveErrors = 0;
                }
            } else if (event.error === 'audio-capture') {
                this.onError('🎤 No microphone found. Check your audio settings.');
            } else if (event.error === 'not-allowed') {
                this.onError('🎤 Microphone permission denied. Please allow microphone access and reload.');
                this.voiceEnabled = false;
            } else if (event.error === 'aborted') {
                // User or system aborted - don't show error
                console.log('[Voice] Recognition aborted');
            } else if (event.error === 'network') {
                this.onError('🎤 Network error. Voice recognition requires internet connection.');
            }
        };
        
        this.recognition.onend = () => {
            console.log('[Voice] Recognition ended, voiceEnabled:', this.voiceEnabled);
            if (this.voiceEnabled) {
                // Restart listening after a brief pause (longer in noisy environments)
                const restartDelay = this.voiceState.consecutiveErrors > 2 ? 1000 : 300;
                setTimeout(() => {
                    if (this.voiceEnabled) {
                        try {
                            this.recognition.start();
                            this.voiceState.consecutiveErrors = 0;
                        } catch (e) {
                            console.log('[Voice] Could not restart:', e);
                        }
                    }
                }, restartDelay);
            }
        };
        
        this.recognition.onspeechstart = () => {
            console.log('[Voice] Speech detected...');
            this.voiceState.consecutiveErrors = 0;
        };
        
        this.recognition.onspeechend = () => {
            console.log('[Voice] Speech ended');
        };
    }
    
    /**
     * Get the best transcript from multiple alternatives
     */
    getBestTranscript(result) {
        let bestTranscript = result[0].transcript;
        let bestConfidence = result[0].confidence || 0.5;
        
        // Check all alternatives
        for (let j = 0; j < result.length; j++) {
            const alt = result[j];
            const transcript = alt.transcript.toLowerCase().trim();
            const confidence = alt.confidence || 0.5;
            
            // Boost confidence for CNC-related terms
            let adjustedConfidence = confidence;
            const cncTerms = ['jog', 'home', 'zero', 'spindle', 'probe', 'feed', 'rapid', 'stop', 'pause', 'resume', 'x', 'y', 'z'];
            for (const term of cncTerms) {
                if (transcript.includes(term)) {
                    adjustedConfidence += 0.1;
                    break;
                }
            }
            
            if (adjustedConfidence > bestConfidence) {
                bestConfidence = Math.min(adjustedConfidence, 1.0);
                bestTranscript = transcript;
            }
        }
        
        return { transcript: bestTranscript, confidence: bestConfidence };
    }
    
    /**
     * Pre-process voice input - convert spoken numbers, apply phonetic corrections
     */
    preprocessVoiceInput(text) {
        let processed = text.toLowerCase().trim();
        
        // Apply phonetic corrections first
        for (const [heard, correct] of Object.entries(this.phoneticCorrections)) {
            const regex = new RegExp(`\\b${heard}\\b`, 'gi');
            processed = processed.replace(regex, correct);
        }
        
        // Convert spoken numbers to digits
        for (const [word, num] of Object.entries(this.spokenNumbers)) {
            const regex = new RegExp(`\\b${word}\\b`, 'gi');
            processed = processed.replace(regex, String(num));
        }
        
        // Handle compound numbers like "twenty five" -> "25"
        processed = processed.replace(/(\d+)\s+(\d+)/g, (match, tens, ones) => {
            const t = parseInt(tens);
            const o = parseInt(ones);
            if (t >= 20 && t % 10 === 0 && o < 10) {
                return String(t + o);
            }
            return match;
        });
        
        return processed;
    }
    
    /**
     * Check if transcript is likely noise/non-command
     */
    isNoise(text) {
        const cleaned = text.toLowerCase().trim();
        
        // Too short
        if (cleaned.length < 2) return true;
        
        // Just filler words
        for (const noise of this.noiseFilter) {
            if (cleaned === noise || cleaned === noise + '.') return true;
        }
        
        // Common misrecognitions of background noise
        if (/^[aeiou]+$/i.test(cleaned)) return true;  // Just vowels
        if (/^(um|uh|ah|oh|hmm)+$/i.test(cleaned)) return true;  // Filler sounds
        
        return false;
    }
    
    /**
     * Check for wake word
     */
    hasWakeWord(text) {
        const lower = text.toLowerCase().trim();
        return this.wakeWords.some(wake => lower.startsWith(wake));
    }
    
    /**
     * Remove wake word from command
     */
    removeWakeWord(text) {
        let lower = text.toLowerCase().trim();
        for (const wake of this.wakeWords) {
            if (lower.startsWith(wake)) {
                lower = lower.substring(wake.length).trim();
                // Remove comma or "please" after wake word
                lower = lower.replace(/^[,\s]+/, '').replace(/^please\s+/, '');
                break;
            }
        }
        return lower;
    }
    
    /**
     * Handle yes/no confirmation for pending voice commands
     */
    handleConfirmation(response) {
        const pending = this.voiceState.pendingConfirmation;
        if (!pending) return;
        
        // Check for timeout (30 seconds)
        if (Date.now() - pending.timestamp > 30000) {
            this.voiceState.pendingConfirmation = null;
            this.onResponse('⏱️ Confirmation timed out. Please repeat your command.');
            return;
        }
        
        const lower = response.toLowerCase().trim();
        
        // Check for yes/confirmation
        const yesPatterns = ['yes', 'yeah', 'yep', 'yup', 'correct', 'right', 'do it', 'confirm', 'proceed', 'go', 'ok', 'okay', 'affirmative', 'roger'];
        if (yesPatterns.some(p => lower === p || lower.startsWith(p + ' '))) {
            this.voiceState.pendingConfirmation = null;
            this.onResponse(`✅ Confirmed: "${pending.transcript}"`);
            if (this.voiceFeedback.enabled) {
                this.speak('Confirmed', false);
            }
            this.processInput(pending.transcript);
            return;
        }
        
        // Check for no/cancel
        const noPatterns = ['no', 'nope', 'cancel', 'abort', 'stop', 'nevermind', 'wrong'];
        if (noPatterns.some(p => lower === p || lower.startsWith(p + ' '))) {
            this.voiceState.pendingConfirmation = null;
            this.onResponse('❌ Cancelled. Please repeat your command.');
            if (this.voiceFeedback.enabled) {
                this.speak('Cancelled. Please try again.', false);
            }
            return;
        }
        
        // Treat as new command
        this.voiceState.pendingConfirmation = null;
        this.processInput(response);
    }
    
    startVoice() {
        if (!this.recognition) {
            this.onError('🎤 Voice recognition not supported in this browser. Use Chrome or Edge.');
            return false;
        }
        
        try {
            this.voiceEnabled = true;
            this.voiceState.listeningStartTime = Date.now();
            this.voiceState.sessionCommands = 0;
            this.voiceState.consecutiveErrors = 0;
            this.voiceState.pendingConfirmation = null;
            this.recognition.start();
            
            const wakeWordNote = this.requireWakeWord 
                ? `\n\n💡 *Wake word mode active. Start commands with "Hey CNC" or "OK Machine"*`
                : '';
            
            this.onResponse(`🎤 **Voice Control Activated!**

I'm listening... Speak naturally!

**Quick Commands:**
• **Movement:** "Jog X 10", "Go up 5", "Move left", "Home"
• **Spindle:** "Spindle on", "Start spindle at 12000", "Spindle off"
• **Job Control:** "Run job", "Pause", "Resume", "Stop"
• **Status:** "Where am I?", "Status", "Position"
• **Feed:** "Faster", "Slower", "Feed 50 percent"
• **Zero:** "Zero here", "Zero Z", "Touch off"
• **Help:** "What can I say?"

**Pro Tips:**
• Say numbers naturally: "Jog X *ten*" or "Jog X *10*"
• Use casual language: "Crank up the spindle"
• Say "Voice off" when done${wakeWordNote}`);
            
            if (this.voiceFeedback.enabled) {
                this.speak('Voice control activated. I\'m listening.', true);
            }
            
            return true;
        } catch (e) {
            this.onError('🎤 Could not start voice recognition: ' + e.message);
            return false;
        }
    }
    
    stopVoice() {
        this.voiceEnabled = false;
        this.voiceState.pendingConfirmation = null;
        
        if (this.recognition) {
            try {
                this.recognition.stop();
            } catch (e) {
                console.log('[Voice] Error stopping:', e);
            }
        }
        
        const sessionTime = this.voiceState.listeningStartTime 
            ? Math.round((Date.now() - this.voiceState.listeningStartTime) / 1000)
            : 0;
        const commands = this.voiceState.sessionCommands;
        
        let summary = '🔇 Voice commands disabled.';
        if (sessionTime > 30 && commands > 0) {
            summary = `🔇 Voice session ended.\n\n📊 *Session stats: ${commands} commands in ${Math.floor(sessionTime / 60)}m ${sessionTime % 60}s*`;
        }
        summary += '\n\nClick "🎤" or say **"Voice on"** to re-enable.';
        
        this.onResponse(summary);
        
        if (this.voiceFeedback.enabled) {
            this.speak('Voice control disabled', true);
        }
    }
    
    toggleVoice() {
        if (this.voiceEnabled) {
            this.stopVoice();
        } else {
            this.startVoice();
        }
        return this.voiceEnabled;
    }
    
    /**
     * Toggle wake word requirement (for noisy environments)
     */
    toggleWakeWord(enable = null) {
        this.requireWakeWord = enable !== null ? enable : !this.requireWakeWord;
        
        if (this.requireWakeWord) {
            this.onResponse(`🔊 **Wake Word Mode Enabled**

I'll only respond to commands starting with:
• "Hey CNC, ..."
• "OK Machine, ..."
• "Computer, ..."

This helps in noisy shop environments.`);
        } else {
            this.onResponse(`🔊 **Wake Word Mode Disabled**

I'll respond to all commands directly without a wake word.`);
        }
        
        return this.requireWakeWord;
    }
    
    /**
     * Configure voice feedback settings
     */
    setVoiceFeedback(options = {}) {
        Object.assign(this.voiceFeedback, options);
        console.log('[Voice] Feedback settings:', this.voiceFeedback);
    }
    
    speak(text, interrupt = true) {
        if (!('speechSynthesis' in window)) return;
        if (!this.voiceFeedback.enabled && !this.voiceFeedback.alertsOnly) return;
        
        if (interrupt) {
            speechSynthesis.cancel();  // Stop any current speech
        }
        
        // Strip markdown for cleaner speech
        let cleanText = text
            .replace(/[#*`|_\[\]]/g, '')
            .replace(/\*\*/g, '')
            .replace(/\n+/g, '. ')
            .replace(/\s+/g, ' ')
            .replace(/:\s*\./g, '.')  // Fix ": ." patterns
            .trim();
        
        // Make CNC terms more speakable
        cleanText = cleanText
            .replace(/\bRPM\b/gi, 'R P M')
            .replace(/\bmm\b/g, 'millimeters')
            .replace(/\bmm\/min\b/gi, 'millimeters per minute')
            .replace(/\bG-?code\b/gi, 'G code')
            .replace(/\bWCS\b/gi, 'work coordinate system')
            .replace(/\bMCS\b/gi, 'machine coordinate system')
            .replace(/(\d+)%/g, '$1 percent');
        
        // Truncate long messages
        if (cleanText.length > 200) {
            cleanText = cleanText.substring(0, 200) + '... and more.';
        }
        
        const utterance = new SpeechSynthesisUtterance(cleanText);
        utterance.rate = this.voiceFeedback.rate || 1.0;
        utterance.pitch = this.voiceFeedback.pitch || 1.0;
        utterance.volume = this.voiceFeedback.volume || 0.8;
        
        // Use a good voice if available
        const voices = speechSynthesis.getVoices();
        const preferredVoice = voices.find(v => 
            v.name.includes('Google') || 
            v.name.includes('Samantha') || 
            v.name.includes('Microsoft David') ||
            v.name.includes('Microsoft Mark') ||
            v.name.includes('Microsoft Zira')
        );
        if (preferredVoice) {
            utterance.voice = preferredVoice;
        }
        
        utterance.onerror = (e) => {
            console.log('[TTS Error]', e);
        };
        
        speechSynthesis.speak(utterance);
    }
    
    /**
     * Speak with priority - for important alerts
     */
    speakAlert(text) {
        if (!this.voiceEnabled) return;
        this.speak(text, true);  // Always interrupt for alerts
    }
    
    /**
     * Speak command confirmation (brief)
     */
    speakConfirmation(action) {
        if (!this.voiceFeedback.enabled || !this.voiceFeedback.confirmCommands) return;
        
        const confirmations = {
            'jog': 'Moving',
            'home': 'Homing',
            'zero': 'Setting zero',
            'spindleOn': 'Starting spindle',
            'spindleOff': 'Stopping spindle',
            'pause': 'Pausing',
            'resume': 'Resuming',
            'stop': 'Stopping',
            'runJob': 'Starting job',
            'probe': 'Probing',
            'coolantOn': 'Coolant on',
            'coolantOff': 'Coolant off',
        };
        
        const msg = confirmations[action];
        if (msg) {
            this.speak(msg, false);
        }
    }
    
    // ================================================================
    // Movement Limit Checking
    // ================================================================
    
    /**
     * Maximum allowed single jog distance (safety against voice misrecognition)
     * e.g., prevents "jog X 1000" when you said "jog X 10"
     */
    maxSingleJogDistance = {
        X: 100,  // mm - max single jog in X
        Y: 100,  // mm - max single jog in Y
        Z: 50    // mm - max single jog in Z (more conservative)
    };
    
    /**
     * Check if a proposed move is within machine limits
     * @param {string} axis - 'X', 'Y', or 'Z'
     * @param {number} value - Distance (relative) or position (absolute)
     * @param {boolean} isRelative - true for jog/G91, false for G90
     * @returns {{ safe: boolean, message?: string, warning?: string, requiresConfirmation?: boolean }}
     */
    checkMoveLimits(axis, value, isRelative = false) {
        // If limits enforcement is disabled, allow everything
        if (!this.enforceLimits) {
            return { safe: true };
        }
        
        const axisUpper = axis.toUpperCase();
        
        // SAFETY: Check for excessive single-move distance (voice misrecognition protection)
        if (isRelative) {
            const absValue = Math.abs(value);
            const maxJog = this.maxSingleJogDistance[axisUpper] || 100;
            
            if (absValue > maxJog) {
                return {
                    safe: false,
                    requiresConfirmation: true,
                    message: `⚠️ **Large move detected:** ${axis}${value > 0 ? '+' : ''}${value}mm exceeds safety limit of ${maxJog}mm.\n\n` +
                             `This might be a voice misrecognition. Say **"yes"** to confirm, or try a smaller move.\n\n` +
                             `💡 *To allow larger moves: "set max jog ${axis} to ${absValue}"*`
                };
            }
        }
        
        // Get current position from grbl
        const currentPos = this.grbl?.state?.wpos || { x: 0, y: 0, z: 0 };
        const axisLower = axis.toLowerCase();
        
        // Calculate target position
        let targetPos;
        if (isRelative) {
            targetPos = (currentPos[axisLower] || 0) + value;
        } else {
            targetPos = value;
        }
        
        // Get machine limits from grbl or use defaults
        const limits = this.grbl?.machineLimits || this.machineConfig.workArea;
        const maxLimit = limits[axisLower] || limits[axis.toLowerCase()] || 400;
        
        // Check bounds (assuming 0 to maxLimit, but Z is often negative)
        let minLimit = 0;
        let effectiveMax = maxLimit;
        
        if (axis === 'Z') {
            // Z typically goes from 0 (top) to negative values (down)
            minLimit = -maxLimit;
            effectiveMax = 10; // A bit above zero for clearance
        }
        
        // Hard limit violation
        if (targetPos > effectiveMax || targetPos < minLimit) {
            return {
                safe: false,
                message: `❌ **Move blocked:** ${axis}${value > 0 ? '+' : ''}${value}mm would exceed limits!\n` +
                         `Current: ${currentPos[axisLower]?.toFixed(2) || 0}mm → Target: ${targetPos.toFixed(2)}mm\n` +
                         `Limits: ${minLimit} to ${effectiveMax}mm`
            };
        }
        
        // Warning zone (within 5mm of limit)
        const warningZone = 5;
        if (targetPos > effectiveMax - warningZone || targetPos < minLimit + warningZone) {
            return {
                safe: true,
                warning: `Approaching ${axis} limit (${targetPos.toFixed(1)}mm)`
            };
        }
        
        return { safe: true };
    }
    
    /**
     * Set the maximum single jog distance for safety
     * @param {string} axis - 'X', 'Y', 'Z', or 'all'
     * @param {number} distance - Maximum distance in mm
     */
    setMaxJogDistance(axis, distance) {
        const axisUpper = axis.toUpperCase();
        if (axisUpper === 'ALL') {
            this.maxSingleJogDistance.X = distance;
            this.maxSingleJogDistance.Y = distance;
            this.maxSingleJogDistance.Z = distance;
        } else if (this.maxSingleJogDistance[axisUpper] !== undefined) {
            this.maxSingleJogDistance[axisUpper] = distance;
        }
    }
    
    /**
     * Validate a complete G-code move command
     * @param {number} x - Target X
     * @param {number} y - Target Y  
     * @param {number} z - Target Z
     * @param {boolean} isRelative - G91 mode
     * @returns {{ safe: boolean, errors: string[], warnings: string[] }}
     */
    validateMove(x, y, z, isRelative = false) {
        const errors = [];
        const warnings = [];
        
        if (x !== undefined && x !== null) {
            const check = this.checkMoveLimits('X', x, isRelative);
            if (!check.safe) errors.push(check.message);
            if (check.warning) warnings.push(check.warning);
        }
        
        if (y !== undefined && y !== null) {
            const check = this.checkMoveLimits('Y', y, isRelative);
            if (!check.safe) errors.push(check.message);
            if (check.warning) warnings.push(check.warning);
        }
        
        if (z !== undefined && z !== null) {
            const check = this.checkMoveLimits('Z', z, isRelative);
            if (!check.safe) errors.push(check.message);
            if (check.warning) warnings.push(check.warning);
        }
        
        return {
            safe: errors.length === 0,
            errors,
            warnings
        };
    }
    
    /**
     * Set whether to enforce limits on AI-generated moves
     */
    setEnforceLimits(enabled) {
        this.enforceLimits = enabled;
    }
    
    /**
     * Update machine config from grbl settings
     */
    syncMachineConfig() {
        if (this.grbl?.machineLimits) {
            this.machineConfig.workArea = { ...this.grbl.machineLimits };
        }
        if (this.grbl?.settings) {
            const s = this.grbl.settings;
            
            // Sync spindle limits if available
            if (s.$30) this.machineConfig.spindleMax = s.$30;
            if (s.$31) this.machineConfig.spindleMin = s.$31;
            if (s.$110) this.machineConfig.maxFeedXY = s.$110;
            if (s.$112) this.machineConfig.maxFeedZ = s.$112;
            
            // Sync settings database with actual machine values
            if (s.$110) this.settingsDatabase['x max speed'].currentValue = parseFloat(s.$110);
            if (s.$111) this.settingsDatabase['y max speed'].currentValue = parseFloat(s.$111);
            if (s.$112) this.settingsDatabase['z max speed'].currentValue = parseFloat(s.$112);
            if (s.$120) this.settingsDatabase['x acceleration'].currentValue = parseFloat(s.$120);
            if (s.$121) this.settingsDatabase['y acceleration'].currentValue = parseFloat(s.$121);
            if (s.$122) this.settingsDatabase['z acceleration'].currentValue = parseFloat(s.$122);
            if (s.$30) this.settingsDatabase['spindle max'].currentValue = parseFloat(s.$30);
            if (s.$31) this.settingsDatabase['spindle min'].currentValue = parseFloat(s.$31);
            if (s.$130) this.settingsDatabase['x travel'].currentValue = parseFloat(s.$130);
            if (s.$131) this.settingsDatabase['y travel'].currentValue = parseFloat(s.$131);
            if (s.$132) this.settingsDatabase['z travel'].currentValue = parseFloat(s.$132);
            
            console.log('[AI] Settings synced from machine');
        }
    }
    
    // ================================================================
    // Helper Methods
    // ================================================================
    
    getStatusReport() {
        if (!this.grbl) {
            return '❌ Not connected to machine';
        }
        
        const state = this.grbl.getState();
        const pos = state.wpos;
        
        // Get enhanced machine state if available
        let machineContext = null;
        if (this.getMachineState) {
            try {
                machineContext = this.getMachineState();
            } catch (e) {
                console.warn('Failed to get machine context:', e);
            }
        }
        
        // Build status report
        let report = `📍 **Machine Status: ${state.status}**\n\n`;
        
        // Add warnings if any
        if (state.status === 'Alarm') {
            report += `⚠️ **ALARM STATE** - Check limits or reset machine\n\n`;
        } else if (state.status === 'Hold') {
            report += `⏸️ Machine paused - Send Resume to continue\n\n`;
        }
        
        // Position table
        report += `| Axis | Work Pos | Machine Pos |
|------|----------|-------------|
| X | ${pos.x.toFixed(3)} | ${state.mpos.x.toFixed(3)} |
| Y | ${pos.y.toFixed(3)} | ${state.mpos.y.toFixed(3)} |
| Z | ${pos.z.toFixed(3)} | ${state.mpos.z.toFixed(3)} |\n\n`;
        
        // Motion status
        report += `**🔧 Motion:**\n`;
        report += `- Feed: ${state.feedRate} mm/min (${state.feedOverride}%)\n`;
        report += `- Spindle: ${state.spindleSpeed} RPM (${state.spindleOverride}%)\n`;
        report += `- Tool: T${state.tool}\n`;
        report += `- Coolant: ${state.coolant.flood ? 'Flood' : ''} ${state.coolant.mist ? 'Mist' : ''} ${!state.coolant.flood && !state.coolant.mist ? 'Off' : ''}\n\n`;
        
        // Homing status
        if (machineContext && machineContext.homedAxes) {
            const homed = machineContext.homedAxes;
            report += `**🏠 Homed:**\n`;
            report += `- X: ${homed.x ? '✅' : '❌'} | Y: ${homed.y ? '✅' : '❌'} | Z: ${homed.z ? '✅' : '❌'}\n\n`;
        }
        
        // TMC Driver status
        if (machineContext && machineContext.tmcStatus) {
            const tmc = machineContext.tmcStatus;
            report += `**⚡ TMC2209 Drivers:**\n`;
            
            const axes = ['X', 'Y', 'Z'];
            axes.forEach(axis => {
                const axisKey = axis.toLowerCase();
                if (tmc[axisKey]) {
                    const driver = tmc[axisKey];
                    let status = '✅ OK';
                    if (driver.ot) status = '🔥 OVER TEMP';
                    else if (driver.otpw) status = '⚠️ Temp Warning';
                    else if (driver.shortCircuit) status = '⚠️ Short Circuit';
                    
                    report += `- ${axis}: ${status}`;
                    const sgVal = driver.sg || driver.stallguard;
                    if (sgVal !== undefined) report += ` | SG:${sgVal}`;
                    if (driver.microsteps) report += ` | μStep:${driver.microsteps}`;
                    report += '\n';
                }
            });
        }
        
        return report;
    }
    
    getHelpText() {
        const voiceSection = this.voiceEnabled ? `
**🎤 VOICE CONTROL ACTIVE**
Say commands naturally! I understand:
- *"Jog X ten"* or *"Jog X 10"* - spoken numbers work!
- *"Go up five"* / *"Move left"* - directional moves
- *"Faster"* / *"Slower"* - adjust feed override
- *"Yes"* / *"No"* - confirm uncertain commands

**Voice Tips:**
- Wake word mode: Say *"Hey CNC"* + command (for noisy shops)
- Say *"Voice off"* or *"Stop listening"* when done
- Low confidence? I'll ask you to confirm

` : `
**🎤 Voice Control:**
- Say *"voice on"* to activate voice commands
- Voice works in Chrome, Edge, or Safari
- Speak naturally - I understand typos & slang!

`;
        
        return `## 🤖 CNC Assistant Commands
${voiceSection}
**🕹️ Movement:**
| Say This | Does This |
|----------|-----------|
| *jog X 10* | Move X axis 10mm |
| *go up 5* | Raise Z by 5mm |
| *move left* | Jog X negative |
| *go forward 20* | Jog Y positive 20mm |
| *rapid to 100, 50* | XY rapid move |
| *home* / *home Z* | Homing |
| *safe Z* / *retract* | Move to safe height |

**📍 Zero & Probing:**
| Say This | Does This |
|----------|-----------|
| *zero here* | Set XYZ to 0 |
| *zero Z* / *touch off* | Zero Z axis |
| *probe Z* | Touch probe surface |
| *probe corner* | Find XY corner |

**⚡ Spindle & Coolant:**
| Say This | Does This |
|----------|-----------|
| *spindle on* | Start spindle (default RPM) |
| *spindle on 18000* | Start at 18000 RPM |
| *spindle off* | Stop spindle |
| *coolant on* / *mist on* | Start coolant |

**▶️ Job Control:**
| Say This | Does This |
|----------|-----------|
| *run job* / *let's go* | Start G-code |
| *pause* / *hold* | Pause job |
| *resume* / *continue* | Resume job |
| *stop* / *abort* | Stop everything |
| *E-stop* | Emergency stop |

**📊 Feed Override:**
| Say This | Does This |
|----------|-----------|
| *faster* / *speed up* | +10% feed |
| *slower* / *slow down* | -10% feed |
| *feed 50 percent* | Set to 50% |
| *full speed* | Reset to 100% |

**⚙️ Settings:**
- *"increase Z max speed"* - modify settings
- *"set Y acceleration to 400"*
- *"undo"* - revert last change

**🔤 I Understand:**
- **Slang:** *crank up, dial down, send it, yeet*
- **Typos:** *incrase, spindel, accel* → auto-corrected
- **Units:** *5 inches, 0.25 mm, 12000 rpm*
- **Numbers:** *ten, fifty, a thousand*`;
    }
    
    getVoiceHelpText() {
        return `## 🎤 Voice Command Reference

**🚨 Emergency (highest priority):**
- *Stop* / *Halt* / *Freeze* / *Whoa*
- *E-stop* / *Emergency stop* / *Kill it*

**🕹️ Movement:**
- *Jog X 10* / *Jog X ten millimeters*
- *X plus 5* / *X minus 10*
- *Go up* / *Go down* / *Go left* / *Go right*
- *Move forward 20* / *Move back 10*
- *Rapid to X 100 Y 50*

**🏠 Homing & Zero:**
- *Home* / *Home all* / *Go home*
- *Home X* / *Home Z*
- *Zero here* / *Zero all* / *Set zero*
- *Zero Z* / *Touch off*

**⚡ Spindle:**
- *Spindle on* / *Start spindle*
- *Spindle on at 15000* / *Spindle 18000 RPM*
- *Spindle off* / *Stop spindle*
- *Fire up the spindle* (slang works!)

**💧 Coolant:**
- *Coolant on* / *Flood on* / *Mist on*
- *Coolant off*

**▶️ Job Control:**
- *Run job* / *Start cutting* / *Let's go* / *Send it*
- *Pause* / *Hold* / *Wait*
- *Resume* / *Continue*
- *Cancel job* / *Abort*

**📊 Feed Override:**
- *Faster* / *Speed up* / *Slower* / *Slow down*
- *Feed 50 percent* / *Half speed*
- *Full speed* / *Normal feed*

**🔧 Tools:**
- *Tool 3* / *Change tool 3* / *Load tool 5*
- *Next tool*

**❓ Status & Help:**
- *Status* / *Where am I* / *Position*
- *Help* / *What can I say* / *Commands*

**🎤 Voice Control:**
- *Voice off* / *Stop listening* / *I'm done*
- *Yes* / *Yeah* / *Confirm* (to confirm)
- *No* / *Cancel* / *Nevermind* (to cancel)

**💡 Pro Tips:**
1. Say numbers naturally: *"ten"* = 10
2. Use casual language: *"crank up"* = increase
3. Axis phonetics work: *"zee"* = Z, *"ex"* = X
4. Compound numbers: *"twenty five"* = 25`;
    }
    
    getMachineChecklist() {
        return `## ✅ Pre-Job Checklist

1. **🏠 Homing** - Machine homed? Say "home all"
2. **🔧 Tool** - Correct tool loaded? Check tool table
3. **📍 Work Zero** - XYZ zeroed? Say "probe corner" or "zero all"
4. **⚙️ Feeds/Speeds** - Appropriate for material? Ask me!
5. **💧 Coolant** - Flood/mist ready if needed?
6. **🔍 G-code** - Analyzed for issues? Say "analyze gcode"
7. **👀 Clearance** - Tool clears clamps/fixtures?
8. **🎯 First cut** - Run air pass first? Set Z high and dry run`;
    }
    
    getTroubleshootingTips() {
        if (!this.grbl) {
            return `**Connection Issues:**
 - If using **WiFi module**: verify the module's IP and that WebSocket port is 81
 - If using **USB (WebSerial)**: use Chrome/Edge, reconnect the USB cable, and re-select the port
 - If using IP: ensure you're on the same LAN/VLAN`;
        }
        
        const state = this.grbl.getState();
        
        if (state.status === 'Alarm') {
            return `**🚨 Alarm Active**
Common causes:
- Hit a limit switch - jog away carefully
- E-stop pressed - release and unlock ($X)
- Homing failed - check switches

Say "unlock" to clear alarm (after fixing issue!)`;
        }
        
        return `**General Troubleshooting:**
- **Rough finish**: Reduce feed, increase RPM, check tool sharpness
- **Chatter**: Reduce DOC, adjust speeds, check tool stickout
- **Dimensional errors**: Check WCS, verify tool offsets
- **Lost steps**: Reduce acceleration, check motor current
- **Tool breaking**: Wrong feeds/speeds, check material hardness

What specific issue are you seeing?`;
    }
    
    setGrbl(grbl) {
        this.grbl = grbl;
    }
}

// Export
if (typeof module !== 'undefined' && module.exports) {
    module.exports = CNCAssistant;
}
