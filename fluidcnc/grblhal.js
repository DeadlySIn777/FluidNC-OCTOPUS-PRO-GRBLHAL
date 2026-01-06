/* ========================================
   FluidCNC - grblHAL Communication Layer
   Supports both WebSocket (ESP8266 WiFi) and
   WebSerial (USB direct connection)
   - Auto-reconnection with exponential backoff
   - Buffer management & flow control
   - Command-based Promise tracking (FIFO)
   - Real-time status parsing
   - Machine limits & soft limit enforcement
   - Crash detection & auto-recovery
   ======================================== */

class GrblHAL {
    constructor(options = {}) {
        // Accept options object OR legacy (host, port) args
        if (typeof options === 'string') {
            this.host = options;
            this.port = arguments[1] || 81;
            options = {};
        } else {
            this.host = options.host || window.location.hostname || 'localhost';
            this.port = options.port || 81;
        }
        
        // Connection type: 'websocket' or 'serial'
        this.connectionType = options.connectionType || 'websocket';
        this.ws = null;
        
        // WebSerial specific
        this.serialPort = null;
        this.serialReader = null;
        this.serialWriter = null;
        this.serialReadLoop = null;
        this.baudRate = options.baudRate || 115200;
        
        // Connection state
        this.connected = false;
        this.reconnecting = false;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 10;
        this.reconnectDelay = 1000;
        this.reconnectTimer = null;
        this.heartbeatTimer = null;
        this.heartbeatInterval = 2000;
        this.lastResponse = Date.now();
        this.responseTimeout = 5000;
        
        // Machine limits (loaded from $130-$132)
        this.machineLimits = {
            x: { min: 0, max: 400 },
            y: { min: 0, max: 400 },
            z: { min: -200, max: 0 }
        };
        this.softLimitsEnabled = true;
        
        // Safety features
        this.rapidToFeedOnAlarm = true;    // Auto-reduce to feed rate after alarm
        this.lastAlarmTime = 0;
        this.alarmCooldown = 5000;          // ms before allowing rapid moves after alarm
        
        // Performance metrics
        this.metrics = {
            commandsSent: 0,
            commandsOk: 0,
            commandsError: 0,
            avgResponseTime: 0,
            lastResponseTimes: [],
            connectionUptime: 0,
            connectionStart: null
        };
        
        // Buffer management for streaming
        this.rxBuffer = '';
        this.bufferSize = 128;
        this.bufferUsed = 0;
        this.pendingCommands = [];
        this.streaming = false;
        this.streamPaused = false;
        this.streamQueue = [];
        this.streamIndex = 0;
        this.streamCallbacks = null;
        
        // Command tracking for sendAndWait (FIFO queue)
        this.commandId = 0;
        this.commandQueue = []; // { id, resolve, reject, command, timer }
        
        // Machine state - with both nested and flat property names for compatibility
        this.state = {
            status: 'Unknown',
            mpos: { x: 0, y: 0, z: 0 },
            wpos: { x: 0, y: 0, z: 0 },
            wco: { x: 0, y: 0, z: 0 },
            feed: 0, feedRate: 0,
            spindle: 0, spindleSpeed: 0,
            coolant: { flood: false, mist: false },
            tool: 0,
            override: { feed: 100, rapid: 100, spindle: 100 },
            feedOverride: 100, rapidOverride: 100, spindleOverride: 100,
            pins: '',
            buffer: { planner: 0, rx: 0 },
            lineNumber: 0,
            wcs: 'G54', units: 'G21', distance: 'G90'
        };
        
        // Probe state
        this.probeResult = null;
        
        // Event handlers
        this.handlers = {
            connect: [], disconnect: [], status: [], message: [],
            error: [], ok: [], alarm: [], probe: [], setting: [], progress: []
        };
        
        // Register callbacks from options - THIS WAS THE BUG FIX
        if (options.onConnect) this.on('connect', options.onConnect);
        if (options.onDisconnect) this.on('disconnect', options.onDisconnect);
        if (options.onStatus) this.on('status', options.onStatus);
        if (options.onMessage) this.on('message', options.onMessage);
        if (options.onError) this.on('error', options.onError);
        if (options.onAlarm) this.on('alarm', options.onAlarm);
        if (options.onOk) this.on('ok', options.onOk);
        if (options.onProbe) this.on('probe', options.onProbe);
        if (options.onProgress) this.on('progress', options.onProgress);
        
        // Alarm descriptions
        this.alarmCodes = {
            1: { msg: 'Hard limit triggered', recovery: 'Unlock ($X) and re-home machine' },
            2: { msg: 'Soft limit - target out of bounds', recovery: 'Check G-code coordinates' },
            3: { msg: 'Reset during motion', recovery: 'Re-home machine' },
            4: { msg: 'Probe not in expected state', recovery: 'Check probe wiring' },
            5: { msg: 'Probe did not contact', recovery: 'Check probe and retry' },
            6: { msg: 'Homing reset', recovery: 'Re-home machine' },
            7: { msg: 'Door opened during homing', recovery: 'Close door and re-home' },
            8: { msg: 'Homing pull-off failed', recovery: 'Check limit switches' },
            9: { msg: 'Limit switch not found', recovery: 'Check limit switches and wiring' },
            10: { msg: 'E-Stop asserted', recovery: 'Clear E-Stop and reset' },
            11: { msg: 'Homing required', recovery: 'Home machine ($H)' },
            12: { msg: 'Limit switch engaged', recovery: 'Jog away from limit' },
            13: { msg: 'Spindle at-speed timeout', recovery: 'Check spindle and VFD' },
            14: { msg: 'Single axis homing not allowed', recovery: 'Home all axes' }
        };
        
        // Error descriptions
        this.errorCodes = {
            1: 'Expected command letter', 2: 'Bad number format', 3: 'Invalid $ statement',
            4: 'Negative value', 5: 'Homing not enabled', 6: 'Step pulse too short',
            7: 'EEPROM read failed', 8: 'Command requires idle', 9: 'G-code locked during alarm',
            10: 'Soft limits need homing', 11: 'Line too long', 12: 'Step rate too high',
            13: 'Door opened', 14: 'Startup line too long', 15: 'Jog exceeds travel',
            16: 'Jog needs feed rate', 17: 'Laser needs PWM', 20: 'Unsupported G-code',
            21: 'Modal group conflict', 22: 'Missing feed rate', 23: 'Integer required',
            24: 'Multiple same modal', 25: 'Repeated word', 26: 'No axis words',
            27: 'Invalid line number', 28: 'Missing value', 29: 'Invalid WCS',
            30: 'G53 needs G0/G1', 31: 'Axis without motion', 32: 'Arc missing axis',
            33: 'Invalid target', 34: 'Arc radius too small', 35: 'Arc missing offset',
            36: 'Unused words', 37: 'Tool offset not set', 38: 'Tool number too high'
        };
        
        // Error/Command log buffer for debugging
        this.errorLog = [];
        
        // Offline command queue
        this.offlineQueue = [];
        this.offlineQueueEnabled = true;
        this.offlineQueueMaxSize = 100;
        this.commandLog = [];
        this.maxLogEntries = 500;
    }
    
    // ================================================================
    // Error & Command Logging
    // ================================================================
    
    logError(type, message, details = {}) {
        const entry = {
            timestamp: new Date().toISOString(),
            type,
            message,
            ...details
        };
        this.errorLog.push(entry);
        if (this.errorLog.length > this.maxLogEntries) {
            this.errorLog.shift();
        }
        console.error(`[grblHAL ${type}]`, message, details);
        return entry;
    }
    
    logCommand(cmd, status, details = {}) {
        const entry = {
            timestamp: new Date().toISOString(),
            command: cmd,
            status,
            ...details
        };
        this.commandLog.push(entry);
        if (this.commandLog.length > this.maxLogEntries) {
            this.commandLog.shift();
        }
        return entry;
    }
    
    getErrorLog() {
        return this.errorLog.slice();
    }
    
    getCommandLog() {
        return this.commandLog.slice();
    }
    
    getErrorLogText() {
        return this.errorLog.map(e => 
            `[${e.timestamp}] ${e.type}: ${e.message}${e.command ? ` | Command: "${e.command}"` : ''}${e.error ? ` | Error: ${e.error}` : ''}`
        ).join('\n');
    }
    
    getCommandLogText() {
        return this.commandLog.map(e => 
            `[${e.timestamp}] ${e.status}: "${e.command}"${e.error ? ` - ${e.error}` : ''}`
        ).join('\n');
    }
    
    clearLogs() {
        this.errorLog = [];
        this.commandLog = [];
    }
    
    // Event system
    on(event, callback) {
        if (this.handlers[event]) this.handlers[event].push(callback);
        return this;
    }
    
    off(event, callback) {
        if (this.handlers[event]) {
            this.handlers[event] = this.handlers[event].filter(cb => cb !== callback);
        }
        return this;
    }
    
    emit(event, data) {
        if (this.handlers[event]) {
            this.handlers[event].forEach(cb => {
                try { cb(data); } catch (e) { console.error(`Event error (${event}):`, e); }
            });
        }
    }
    
    // Connection management
    connect(type = null) {
        if (type) this.connectionType = type;
        
        if (this.connectionType === 'serial') {
            return this.connectSerial();
        } else {
            return this.connectWebSocket();
        }
    }
    
    connectWebSocket() {
        if (this.ws?.readyState === WebSocket.OPEN) return Promise.resolve();
        this.connectionType = 'websocket';
        this.reconnecting = false;
        this.reconnectAttempts = 0;
        this._connectWS();
        return Promise.resolve();
    }
    
    async connectSerial() {
        console.log('[grblHAL] connectSerial() called');
        
        if (!('serial' in navigator)) {
            const error = 'WebSerial not supported. Use Chrome/Edge on desktop.';
            console.error('[grblHAL]', error);
            this.emit('error', { type: 'serial', message: error });
            alert(error);
            throw new Error(error);
        }
        
        console.log('[grblHAL] WebSerial is available, requesting port...');
        this.connectionType = 'serial';
        
        try {
            // Request port from user - no filters so ALL serial devices show up
            this.serialPort = await navigator.serial.requestPort();
            console.log('[grblHAL] Port selected:', this.serialPort);
            
            await this.serialPort.open({ baudRate: this.baudRate });
            
            console.log('[grblHAL] Serial port opened at', this.baudRate, 'baud');
            
            // Set up reader and writer
            this.serialWriter = this.serialPort.writable.getWriter();
            this._startSerialReader();
            
            this.connected = true;
            this.reconnecting = false;
            this._startHeartbeat();
            
            // Query initial state
            setTimeout(() => {
                this.send('?');
                this.send('$I');
                this.send('$G');
            }, 500);
            
            // Auto-apply machine settings on connect (EEPROM not persisting after mass-erase)
            setTimeout(() => {
                this._applyDefaultSettings();
            }, 1000);
            
            // Process any queued offline commands
            setTimeout(() => {
                if (this.hasQueuedCommands()) {
                    this.processOfflineQueue();
                }
            }, 1500);
            
            this.emit('connect', { type: 'serial', baudRate: this.baudRate });
            return true;
            
        } catch (e) {
            console.error('[grblHAL] Serial connection failed:', e);
            this.emit('error', { type: 'serial', message: e.message });
            throw e;
        }
    }
    
    async _startSerialReader() {
        const decoder = new TextDecoderStream();
        this.serialPort.readable.pipeTo(decoder.writable);
        this.serialReader = decoder.readable.getReader();
        
        // Read loop
        this.serialReadLoop = (async () => {
            try {
                while (true) {
                    const { value, done } = await this.serialReader.read();
                    if (done) break;
                    if (value) {
                        this.lastResponse = Date.now();
                        this.rxBuffer += value;
                        const lines = this.rxBuffer.split('\n');
                        this.rxBuffer = lines.pop() || '';
                        for (const line of lines) {
                            const trimmed = line.trim();
                            if (trimmed) this._processLine(trimmed);
                        }
                    }
                }
            } catch (e) {
                if (e.name !== 'TypeError') { // Ignore close errors
                    console.error('[grblHAL] Serial read error:', e);
                }
            }
            
            // Connection lost
            if (this.connected) {
                this.connected = false;
                this.emit('disconnect', { type: 'serial', reason: 'Port closed' });
            }
        })();
    }
    
    _connectWS() {
        const url = `ws://${this.host}:${this.port}`;
        console.log(`[grblHAL] Connecting to ${url}`);
        
        try {
            this.ws = new WebSocket(url);
            this.ws.binaryType = 'arraybuffer';
            this.ws.onopen = () => this._onOpen();
            this.ws.onclose = (e) => this._onClose(e);
            this.ws.onerror = (e) => this._onError(e);
            this.ws.onmessage = (e) => this._onMessage(e);
        } catch (e) {
            this._scheduleReconnect();
        }
    }
    
    async disconnect() {
        this._clearTimers();
        this.reconnecting = false;
        
        // Close WebSocket
        if (this.ws) {
            this.ws.onclose = null;
            this.ws.close();
            this.ws = null;
        }
        
        // Close Serial
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
        this.emit('disconnect', { reason: 'user' });
    }
    
    _onOpen() {
        console.log('[grblHAL] WebSocket connected');
        this.connected = true;
        this.reconnecting = false;
        this.reconnectAttempts = 0;
        this.lastResponse = Date.now();
        
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        
        this._startHeartbeat();
        
        setTimeout(() => {
            this.send('?');
            this.send('$I');
            this.send('$G');
        }, 100);
        
        // Auto-apply machine settings on connect (EEPROM not persisting after mass-erase)
        setTimeout(() => {
            this._applyDefaultSettings();
        }, 500);
        
        // Process any queued offline commands
        setTimeout(() => {
            if (this.hasQueuedCommands()) {
                this.processOfflineQueue();
            }
        }, 1000);
        
        this.emit('connect', { type: 'websocket', host: this.host });
    }
    
    _onClose(event) {
        console.log('[grblHAL] Disconnected:', event.code);
        this._clearTimers();
        const wasConnected = this.connected;
        this.connected = false;
        
        // Reject all pending command promises
        while (this.commandQueue.length > 0) {
            const pending = this.commandQueue.shift();
            clearTimeout(pending.timer);
            pending.reject(new Error('Connection lost'));
        }
        
        if (wasConnected) {
            this.emit('disconnect', { code: event.code, reason: event.reason || 'Connection lost' });
        }
        
        if (event.code !== 1000 && !this.reconnecting) {
            this._scheduleReconnect();
        }
    }
    
    _onError(error) {
        console.error('[grblHAL] WebSocket error:', error);
        this.emit('error', { type: 'connection', message: 'WebSocket error' });
    }
    
    _scheduleReconnect() {
        // Only auto-reconnect for WebSocket, not serial
        if (this.connectionType === 'serial') return;
        
        if (this.reconnecting || this.reconnectAttempts >= this.maxReconnectAttempts) {
            if (this.reconnectAttempts >= this.maxReconnectAttempts) {
                this.emit('error', { type: 'connection', message: 'Max reconnection attempts reached' });
            }
            return;
        }
        
        this.reconnecting = true;
        this.reconnectAttempts++;
        const delay = Math.min(this.reconnectDelay * Math.pow(1.5, this.reconnectAttempts - 1), 30000);
        
        console.log(`[grblHAL] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
        
        this.reconnectTimer = setTimeout(() => {
            this.reconnecting = false;
            this._connectWS();
        }, delay);
    }
    
    _startHeartbeat() {
        this._clearTimers();
        this.heartbeatTimer = setInterval(() => {
            if (Date.now() - this.lastResponse > this.responseTimeout) {
                console.warn('[grblHAL] Heartbeat timeout');
                this.ws?.close();
            } else if (this.connected) {
                this.send('?');
            }
        }, this.heartbeatInterval);
    }
    
    _clearTimers() {
        if (this.heartbeatTimer) { clearInterval(this.heartbeatTimer); this.heartbeatTimer = null; }
        if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    }
    
    // Auto-apply machine settings on connect (EEPROM not persisting after mass-erase)
    _applyDefaultSettings() {
        // Default settings for the CNC machine
        const settings = [
            '$110=10000',   // X max rate mm/min
            '$111=10000',   // Y max rate mm/min
            '$112=6500',    // Z max rate mm/min
            '$120=500',     // X acceleration mm/sec^2
            '$121=500',     // Y acceleration mm/sec^2
            '$122=400',     // Z acceleration mm/sec^2
        ];
        
        console.log('[grblHAL] Applying default machine settings...');
        settings.forEach((setting, i) => {
            setTimeout(() => {
                this.send(setting);
            }, i * 50);
        });
    }
    
    _onMessage(event) {
        this.lastResponse = Date.now();
        const data = typeof event.data === 'string' ? event.data : new TextDecoder().decode(event.data);
        
        this.rxBuffer += data;
        const lines = this.rxBuffer.split('\n');
        this.rxBuffer = lines.pop() || '';
        
        for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed) this._processLine(trimmed);
        }
    }
    
    _processLine(line) {
        // Status report
        if (line.startsWith('<') && line.endsWith('>')) {
            this._parseStatus(line);
            return;
        }
        
        // OK response
        if (line === 'ok') {
            this._handleOk();
            return;
        }
        
        // Error response
        if (line.startsWith('error:')) {
            const code = parseInt(line.split(':')[1]) || 0;
            this._handleError(code);
            return;
        }
        
        // Alarm
        if (line.startsWith('ALARM:')) {
            const code = parseInt(line.split(':')[1]) || 0;
            this.emit('alarm', { code, message: this.alarmCodes[code]?.msg || 'Unknown alarm' });
            return;
        }
        
        // Probe result
        if (line.startsWith('[PRB:')) {
            this._parseProbe(line);
            return;
        }
        
        // Settings
        if (line.startsWith('$')) {
            const match = line.match(/^\$(\d+)=(.+)/);
            if (match) {
                this.emit('setting', { num: parseInt(match[1]), value: match[2] });
            }
        }
        
        // General message
        this.emit('message', line);
    }
    
    _parseStatus(line) {
        const content = line.slice(1, -1);
        const parts = content.split('|');
        
        this.state.status = parts[0];
        
        for (let i = 1; i < parts.length; i++) {
            const [key, val] = parts[i].split(':');
            
            switch (key) {
                case 'MPos': {
                    const coords = val.split(',').map(parseFloat);
                    this.state.mpos = { x: coords[0] || 0, y: coords[1] || 0, z: coords[2] || 0 };
                    this.state.wpos = {
                        x: this.state.mpos.x - this.state.wco.x,
                        y: this.state.mpos.y - this.state.wco.y,
                        z: this.state.mpos.z - this.state.wco.z
                    };
                    break;
                }
                case 'WPos': {
                    const coords = val.split(',').map(parseFloat);
                    this.state.wpos = { x: coords[0] || 0, y: coords[1] || 0, z: coords[2] || 0 };
                    this.state.mpos = {
                        x: this.state.wpos.x + this.state.wco.x,
                        y: this.state.wpos.y + this.state.wco.y,
                        z: this.state.wpos.z + this.state.wco.z
                    };
                    break;
                }
                case 'WCO': {
                    const coords = val.split(',').map(parseFloat);
                    this.state.wco = { x: coords[0] || 0, y: coords[1] || 0, z: coords[2] || 0 };
                    break;
                }
                case 'Bf': {
                    const [planner, rx] = val.split(',').map(n => parseInt(n) || 0);
                    this.state.buffer = { planner, rx };
                    break;
                }
                case 'FS': {
                    const [feed, spindle] = val.split(',').map(n => parseInt(n) || 0);
                    this.state.feed = this.state.feedRate = feed;
                    this.state.spindle = this.state.spindleSpeed = spindle;
                    
                    // Notify chatter detection of RPM change
                    if (window.chatterDetection && spindle > 0) {
                        window.chatterDetection.setRPM(spindle);
                    }
                    break;
                }
                case 'F': {
                    this.state.feed = this.state.feedRate = parseInt(val) || 0;
                    break;
                }
                case 'Ov': {
                    const [f, r, s] = val.split(',').map(n => parseInt(n) || 100);
                    this.state.override = { feed: f, rapid: r, spindle: s };
                    this.state.feedOverride = f;
                    this.state.rapidOverride = r;
                    this.state.spindleOverride = s;
                    break;
                }
                case 'A': {
                    this.state.coolant = { flood: val.includes('F'), mist: val.includes('M') };
                    if (val.includes('S')) this.state.spindleDir = 'CW';
                    if (val.includes('C')) this.state.spindleDir = 'CCW';
                    break;
                }
                case 'Pn': this.state.pins = val; break;
                case 'Ln': this.state.lineNumber = parseInt(val) || 0; break;
                case 'T': this.state.tool = parseInt(val) || 0; break;
            }
        }
        
        this.emit('status', this.state);
    }
    
    _parseProbe(line) {
        const match = line.match(/\[PRB:([^:]+):(\d)\]/);
        if (match) {
            const coords = match[1].split(',').map(parseFloat);
            this.probeResult = {
                x: coords[0] || 0, y: coords[1] || 0, z: coords[2] || 0,
                success: match[2] === '1'
            };
            this.emit('probe', this.probeResult);
        }
    }
    
    _handleOk() {
        // Handle streaming buffer
        if (this.streaming && this.pendingCommands.length > 0) {
            const cmd = this.pendingCommands.shift();
            this.bufferUsed -= (cmd.length + 1);
            this._sendFromQueue();
        }
        
        // Resolve oldest command promise (FIFO)
        if (this.commandQueue.length > 0) {
            const pending = this.commandQueue.shift();
            clearTimeout(pending.timer);
            pending.resolve({ ok: true, command: pending.command });
        }
        
        this.emit('ok', {});
    }
    
    _handleError(code) {
        const message = this.errorCodes[code] || `Unknown error ${code}`;
        
        if (this.streaming && this.pendingCommands.length > 0) {
            const cmd = this.pendingCommands.shift();
            this.bufferUsed -= (cmd.length + 1);
        }
        
        // Reject oldest command promise (FIFO)
        if (this.commandQueue.length > 0) {
            const pending = this.commandQueue.shift();
            clearTimeout(pending.timer);
            pending.reject(new Error(`Error ${code}: ${message}`));
        }
        
        this.emit('error', { code, message });
    }
    
    // ================================================================
    // G-code Validation
    // ================================================================
    
    /**
     * Validate G-code command for safety and correctness
     * @param {string} cmd - The G-code command to validate
     * @returns {{ valid: boolean, error?: string, warnings?: string[] }}
     */
    validateGCode(cmd) {
        const warnings = [];
        const line = cmd.trim();
        const upperLine = line.toUpperCase();
        
        // Empty command is valid (just a newline)
        if (!line) return { valid: true };
        
        // Allow ALL $ commands (grbl settings, FluidNC commands, etc.)
        // This includes: $$ $# $I $N $Bye $SD/List $LocalFS/Show=/config.yaml etc.
        if (line.startsWith('$')) return { valid: true };
        
        // Allow realtime commands
        if (line === '?' || line === '!' || line === '~') return { valid: true };
        if (line === '\x18' || line === '\x85') return { valid: true }; // Soft reset, jog cancel
        
        // Allow program start/end markers
        if (line === '%') return { valid: true };
        
        // Allow pure comments
        if (line.startsWith(';') || line.startsWith('(')) return { valid: true };
        
        // Block dangerous commands
        const dangerousPatterns = [
            { pattern: /G10\s+L2/i, msg: 'G10 L2 (coordinate system offset) - use with caution' },
            { pattern: /G28\.1|G30\.1/i, msg: 'Setting reference position - verify machine position first' },
        ];
        
        for (const { pattern, msg } of dangerousPatterns) {
            if (pattern.test(upperLine)) {
                warnings.push(msg);
            }
        }
        
        // Check for valid G-code structure
        // Must start with: letter (G, M, X, etc.), number (line number N), (, ;, or %
        if (!line.match(/^[A-Za-z0-9NnOo\(\;\%]/)) {
            return { valid: false, error: `Invalid G-code format: ${cmd}` };
        }
        
        // Check for common typos/errors
        if (upperLine.match(/[A-Z]{3,}/) && !upperLine.match(/\(.*\)/)) {
            // Three or more consecutive letters outside a comment is suspicious
            if (!['MSG', 'END', 'PGM'].some(w => upperLine.includes(w))) {
                warnings.push('Possible typo: multiple consecutive letters detected');
            }
        }
        
        // Validate numeric values aren't malformed
        const numberPattern = /[XYZABCIJKFPQRS]([^\d\.\-\s])/gi;
        if (numberPattern.test(upperLine)) {
            return { valid: false, error: 'Malformed coordinate value' };
        }
        
        // Check for extreme values (potential user error)
        const coords = {
            X: upperLine.match(/X([\-\d\.]+)/)?.[1],
            Y: upperLine.match(/Y([\-\d\.]+)/)?.[1],
            Z: upperLine.match(/Z([\-\d\.]+)/)?.[1],
            F: upperLine.match(/F([\-\d\.]+)/)?.[1],
            S: upperLine.match(/S([\-\d\.]+)/)?.[1],
        };
        
        // Check for extreme Z values (common crash scenario)
        if (coords.Z) {
            const z = parseFloat(coords.Z);
            if (z > 100) warnings.push(`Large positive Z (${z}mm) - verify safe height`);
            if (z < -50) warnings.push(`Deep Z plunge (${z}mm) - verify depth`);
        }
        
        // Check for extreme feed rates
        if (coords.F) {
            const f = parseFloat(coords.F);
            if (f > 10000) warnings.push(`Very high feed rate (${f}) - verify units`);
            if (f <= 0) return { valid: false, error: 'Feed rate must be positive' };
        }
        
        // Check for negative spindle speed
        if (coords.S) {
            const s = parseFloat(coords.S);
            if (s < 0) return { valid: false, error: 'Spindle speed cannot be negative' };
        }
        
        return { valid: true, warnings: warnings.length ? warnings : undefined };
    }
    
    // ================================================================
    // Sending commands
    // ================================================================
    
    send(cmd, options = {}) {
        // Queue command if offline and queuing is enabled
        if (!this.connected) {
            if (this.offlineQueueEnabled && !options.noQueue) {
                return this.queueOfflineCommand(cmd, options);
            }
            this.logError('SEND', 'Cannot send - not connected', { command: cmd });
            return false;
        }
        
        // Check connection type
        if (this.connectionType === 'serial') {
            if (!this.serialWriter) {
                this.logError('SEND', 'Serial writer not available', { command: cmd });
                return false;
            }
        } else {
            if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
                this.logError('SEND', 'WebSocket not connected', { command: cmd });
                return false;
            }
        }
        
        cmd = cmd.trim();
        
        // Validate G-code unless bypassed
        if (!options.skipValidation) {
            const validation = this.validateGCode(cmd);
            if (!validation.valid) {
                this.logError('VALIDATION', validation.error, { command: cmd });
                this.logCommand(cmd, 'REJECTED', { error: validation.error });
                this.emit('error', { code: 'VALIDATION', message: validation.error, command: cmd });
                return false;
            }
            if (validation.warnings) {
                validation.warnings.forEach(w => {
                    this.logError('WARNING', w, { command: cmd });
                });
            }
        }
        
        // Log successful send
        this.logCommand(cmd, 'SENT');
        
        // Send via appropriate transport
        if (this.connectionType === 'serial') {
            const encoder = new TextEncoder();
            this.serialWriter.write(encoder.encode(cmd + '\n'));
        } else {
            this.ws.send(cmd + '\n');
        }
        return true;
    }
    
    /**
     * Send command and wait for ok/error response
     * Uses FIFO queue to match responses to commands
     */
    sendAndWait(cmd, timeout = 30000) {
        return new Promise((resolve, reject) => {
            if (!this.connected) {
                reject(new Error('Not connected'));
                return;
            }
            
            const id = ++this.commandId;
            const timer = setTimeout(() => {
                const idx = this.commandQueue.findIndex(p => p.id === id);
                if (idx !== -1) {
                    this.commandQueue.splice(idx, 1);
                    reject(new Error(`Command timeout: ${cmd}`));
                }
            }, timeout);
            
            this.commandQueue.push({
                id, command: cmd, timer,
                resolve: (result) => resolve(result),
                reject: (err) => reject(err)
            });
            
            this.send(cmd);
        });
    }
    
    // ================================================================
    // G-code streaming with proper buffer management
    // ================================================================
    
    streamGCode(lines, callbacks = {}) {
        if (this.streaming) {
            console.warn('[grblHAL] Already streaming');
            return false;
        }
        
        // Lock to prevent race conditions during setup
        this._streamLock = true;
        
        this.streamQueue = lines
            .map(l => l.split(';')[0].split('(')[0].trim())
            .filter(l => l.length > 0);
        
        this.streamIndex = 0;
        this.streaming = true;
        this.streamPaused = false;
        this.streamStopping = false;  // New: flag for graceful stop
        this.streamCallbacks = callbacks;
        this.bufferUsed = 0;
        this.pendingCommands = [];
        this.streamStartTime = Date.now();
        this.streamErrors = [];
        
        this._streamLock = false;
        this._sendFromQueue();
        return true;
    }
    
    _sendFromQueue() {
        // Check all abort conditions first
        if (!this.streaming || this.streamPaused || this.streamStopping || this._streamLock) {
            return;
        }
        
        while (this.streamIndex < this.streamQueue.length) {
            // Check abort conditions inside loop too
            if (this.streamStopping || !this.streaming) {
                break;
            }
            
            const cmd = this.streamQueue[this.streamIndex];
            const cmdLen = cmd.length + 1;
            
            if (this.bufferUsed + cmdLen > this.bufferSize) break;
            
            this.bufferUsed += cmdLen;
            this.pendingCommands.push(cmd);
            this.send(cmd);
            this.streamIndex++;
            
            const progress = (this.streamIndex / this.streamQueue.length) * 100;
            if (this.streamCallbacks?.onProgress) {
                this.streamCallbacks.onProgress(progress, this.streamIndex, this.streamQueue.length);
            }
            this.emit('progress', { progress, current: this.streamIndex, total: this.streamQueue.length });
        }
        
        // Done when all commands sent AND acknowledged
        if (this.streamIndex >= this.streamQueue.length && this.pendingCommands.length === 0 && !this.streamStopping) {
            this._completeStream();
        }
    }
    
    _completeStream() {
        const duration = Date.now() - (this.streamStartTime || Date.now());
        this.streaming = false;
        this.streamStopping = false;
        
        if (this.streamCallbacks?.onComplete) {
            this.streamCallbacks.onComplete({
                duration,
                linesExecuted: this.streamIndex,
                errors: this.streamErrors.length > 0 ? this.streamErrors : null
            });
        }
        
        this.streamCallbacks = null;
    }
    
    pauseStream() {
        if (!this.streaming) return;
        this.streamPaused = true;
        this.send('!'); // Feed hold
        this.streamCallbacks?.onPause?.();
    }
    
    resumeStream() {
        if (!this.streaming) return;
        this.streamPaused = false;
        this.send('~'); // Cycle start
        this._sendFromQueue();
        this.streamCallbacks?.onResume?.();
    }
    
    stopStream() {
        // Set stopping flag to prevent race conditions
        this.streamStopping = true;
        this.streamPaused = false;
        
        // Give a small delay for any in-flight operations
        setTimeout(() => {
            this.streaming = false;
            this.streamStopping = false;
            this.streamQueue = [];
            this.streamIndex = 0;
            this.pendingCommands = [];
            this.bufferUsed = 0;
            
            this.send('!');
            setTimeout(() => this.send('\x18'), 100);
            
            this.streamCallbacks?.onStop?.();
            this.streamCallbacks = null;
        }, 10);
    }
    
    /**
     * Check if streaming is in progress
     */
    isStreaming() {
        return this.streaming && !this.streamStopping;
    }
    
    /**
     * Get current stream progress
     */
    getStreamProgress() {
        if (!this.streaming) return null;
        return {
            current: this.streamIndex,
            total: this.streamQueue.length,
            percent: this.streamQueue.length > 0 ? (this.streamIndex / this.streamQueue.length) * 100 : 0,
            paused: this.streamPaused,
            elapsed: Date.now() - (this.streamStartTime || Date.now())
        };
    }
    
    // ================================================================
    // Wait for idle state
    // ================================================================
    
    waitForIdle(timeout = 60000) {
        return new Promise((resolve, reject) => {
            if (this.state.status === 'Idle') {
                resolve();
                return;
            }
            
            const startTime = Date.now();
            const handler = (state) => {
                if (state.status === 'Idle') {
                    this.off('status', handler);
                    resolve();
                } else if (Date.now() - startTime > timeout) {
                    this.off('status', handler);
                    reject(new Error('Timeout waiting for idle'));
                }
            };
            
            this.on('status', handler);
        });
    }
    
    // ================================================================
    // Probing with proper Promise
    // ================================================================
    
    probe(axis, distance, feedRate) {
        return new Promise((resolve, reject) => {
            this.probeResult = null;
            
            const probeHandler = (result) => {
                this.off('probe', probeHandler);
                if (result.success) {
                    resolve(result);
                } else {
                    reject(new Error('Probe did not make contact'));
                }
            };
            
            const errorHandler = (err) => {
                this.off('probe', probeHandler);
                this.off('error', errorHandler);
                reject(err);
            };
            
            this.on('probe', probeHandler);
            this.on('error', errorHandler);
            
            const axisUpper = axis.toUpperCase();
            this.send(`G91 G38.2 ${axisUpper}${distance} F${feedRate}`);
        });
    }
    
    // ================================================================
    // Machine control commands
    // ================================================================
    
    home(axes = '') {
        return this.sendAndWait(axes ? `$H${axes.toUpperCase()}` : '$H', 60000);
    }
    
    unlock() {
        return this.sendAndWait('$X');
    }
    
    reset() {
        this.send('\x18');
    }
    
    hold() {
        this.send('!');
    }
    
    resume() {
        this.send('~');
    }
    
    jog(axis, distance, feed) {
        return this.send(`$J=G91 ${axis.toUpperCase()}${distance} F${feed}`);
    }
    
    jogCancel() {
        this.send('\x85');
    }
    
    setWCS(wcs) {
        return this.sendAndWait(wcs.toUpperCase());
    }
    
    setZero(axes = 'XYZ') {
        const cmds = axes.split('').map(a => `G10 L20 P1 ${a}0`);
        return Promise.all(cmds.map(cmd => this.sendAndWait(cmd)));
    }
    
    // ================================================================
    // Spindle control
    // ================================================================
    
    spindleOn(rpm, direction = 'CW') {
        const mCode = direction === 'CW' ? 'M3' : 'M4';
        return this.sendAndWait(`${mCode} S${rpm}`);
    }
    
    spindleOff() {
        return this.sendAndWait('M5');
    }
    
    // ================================================================
    // Coolant control - FIXED signatures
    // ================================================================
    
    coolantFlood(on = true) {
        return this.sendAndWait(on ? 'M8' : 'M9');
    }
    
    coolantMist(on = true) {
        return this.sendAndWait(on ? 'M7' : 'M9');
    }
    
    coolantOff() {
        return this.sendAndWait('M9');
    }
    
    // ================================================================
    // Override controls (real-time commands)
    // ================================================================
    
    setFeedOverride(percent) {
        this.send(String.fromCharCode(0x90)); // Reset to 100%
        const diff = percent - 100;
        if (diff > 0) {
            for (let i = 0; i < Math.floor(diff / 10); i++) this.send(String.fromCharCode(0x91));
            for (let i = 0; i < diff % 10; i++) this.send(String.fromCharCode(0x93));
        } else if (diff < 0) {
            for (let i = 0; i < Math.floor(-diff / 10); i++) this.send(String.fromCharCode(0x92));
            for (let i = 0; i < -diff % 10; i++) this.send(String.fromCharCode(0x94));
        }
    }
    
    setSpindleOverride(percent) {
        this.send(String.fromCharCode(0x99));
        const diff = percent - 100;
        if (diff > 0) {
            for (let i = 0; i < Math.floor(diff / 10); i++) this.send(String.fromCharCode(0x9A));
            for (let i = 0; i < diff % 10; i++) this.send(String.fromCharCode(0x9C));
        } else if (diff < 0) {
            for (let i = 0; i < Math.floor(-diff / 10); i++) this.send(String.fromCharCode(0x9B));
            for (let i = 0; i < -diff % 10; i++) this.send(String.fromCharCode(0x9D));
        }
    }
    
    setRapidOverride(percent) {
        if (percent >= 100) this.send(String.fromCharCode(0x95));
        else if (percent >= 50) this.send(String.fromCharCode(0x96));
        else this.send(String.fromCharCode(0x97));
    }
    
    // ================================================================
    // Tool management
    // ================================================================
    
    toolChange(toolNumber) {
        return this.sendAndWait(`M6 T${toolNumber}`);
    }
    
    setTool(toolNumber) {
        return this.sendAndWait(`T${toolNumber}`);
    }
    
    // ================================================================
    // Digital/Servo output for ATC
    // ================================================================
    
    setDigitalOutput(port, on = true, immediate = true) {
        const mCode = immediate ? (on ? 'M64' : 'M65') : (on ? 'M62' : 'M63');
        return this.sendAndWait(`${mCode} P${port}`);
    }
    
    setServo(port, angle) {
        // grblHAL servo control - M280 P<port> S<angle>
        return this.sendAndWait(`M280 P${port} S${angle}`);
    }
    
    // ================================================================
    // Safety & Limits
    // ================================================================
    
    /**
     * Check if a position is within machine limits
     */
    isWithinLimits(x, y, z) {
        if (!this.softLimitsEnabled) return { valid: true };
        
        const issues = [];
        if (x !== undefined && (x < this.machineLimits.x.min || x > this.machineLimits.x.max)) {
            issues.push(`X=${x} outside limits [${this.machineLimits.x.min}, ${this.machineLimits.x.max}]`);
        }
        if (y !== undefined && (y < this.machineLimits.y.min || y > this.machineLimits.y.max)) {
            issues.push(`Y=${y} outside limits [${this.machineLimits.y.min}, ${this.machineLimits.y.max}]`);
        }
        if (z !== undefined && (z < this.machineLimits.z.min || z > this.machineLimits.z.max)) {
            issues.push(`Z=${z} outside limits [${this.machineLimits.z.min}, ${this.machineLimits.z.max}]`);
        }
        
        return issues.length ? { valid: false, issues } : { valid: true };
    }
    
    /**
     * Safe rapid move - checks limits before moving
     */
    async safeRapid(x, y, z, options = {}) {
        const check = this.isWithinLimits(x, y, z);
        if (!check.valid && !options.force) {
            const err = `Move blocked: ${check.issues.join(', ')}`;
            this.emit('error', { code: 'LIMIT', message: err });
            throw new Error(err);
        }
        
        // After alarm, use slower feed rate for safety
        const recentAlarm = (Date.now() - this.lastAlarmTime) < this.alarmCooldown;
        const moveCmd = recentAlarm && this.rapidToFeedOnAlarm 
            ? `G1 F1000` 
            : `G0`;
        
        let cmd = `G53 ${moveCmd}`;
        if (x !== undefined) cmd += ` X${x.toFixed(3)}`;
        if (y !== undefined) cmd += ` Y${y.toFixed(3)}`;
        if (z !== undefined) cmd += ` Z${z.toFixed(3)}`;
        
        return this.sendAndWait(cmd);
    }
    
    /**
     * Emergency stop - immediate halt
     */
    emergencyStop() {
        // Send multiple stop commands for reliability
        this.send('\x18', { skipValidation: true });  // Soft reset
        this.send('!', { skipValidation: true });      // Feed hold
        this.streaming = false;
        this.streamQueue = [];
        this.commandQueue.forEach(cmd => cmd.reject(new Error('Emergency stop')));
        this.commandQueue = [];
        this.emit('estop', { time: Date.now() });
        console.warn('[grblHAL] EMERGENCY STOP TRIGGERED');
    }
    
    /**
     * Load machine settings ($130-$132 for limits, etc.)
     */
    async loadMachineSettings() {
        try {
            await this.sendAndWait('$$');
            // Settings are parsed in _processLine and stored
        } catch (e) {
            console.warn('[grblHAL] Failed to load machine settings:', e);
        }
    }
    
    /**
     * Update machine limits from parsed settings
     */
    updateLimitsFromSettings(settings) {
        if (settings[130]) this.machineLimits.x.max = parseFloat(settings[130]);
        if (settings[131]) this.machineLimits.y.max = parseFloat(settings[131]);
        if (settings[132]) this.machineLimits.z.max = parseFloat(settings[132]);
        if (settings[20]) this.softLimitsEnabled = settings[20] === '1';
        console.log('[grblHAL] Machine limits updated:', this.machineLimits);
    }
    
    /**
     * Get performance metrics
     */
    getMetrics() {
        return {
            ...this.metrics,
            connectionUptime: this.metrics.connectionStart 
                ? Date.now() - this.metrics.connectionStart 
                : 0
        };
    }
    
    // ================================================================
    // Getters
    // ================================================================
    
    getState() { return { ...this.state }; }
    getPosition() { return { ...this.state.wpos }; }
    getMachinePosition() { return { ...this.state.mpos }; }
    isConnected() { return this.connected; }
    isIdle() { return this.state.status === 'Idle'; }
    isRunning() { return this.state.status === 'Run'; }
    isHolding() { return this.state.status === 'Hold' || this.state.status === 'Hold:0' || this.state.status === 'Hold:1'; }
    isAlarm() { return this.state.status === 'Alarm'; }
    isHoming() { return this.state.status === 'Home'; }
    getConnectionType() { return this.connectionType; }
    getMachineLimits() { return { ...this.machineLimits }; }
    
    // ================================================================
    // State Persistence (survives page refresh)
    // ================================================================
    
    /**
     * Save current machine state to localStorage
     * Called periodically and on significant state changes
     */
    saveState() {
        const stateToSave = {
            timestamp: Date.now(),
            wpos: this.state.wpos,
            mpos: this.state.mpos,
            wco: this.state.wco,
            wcs: this.state.wcs,
            units: this.state.units,
            tool: this.state.tool,
            lastStatus: this.state.status,
            override: this.state.override,
            host: this.host,
            connectionType: this.connectionType,
            machineLimits: this.machineLimits
        };
        
        try {
            localStorage.setItem('fluidcnc_machine_state', JSON.stringify(stateToSave));
        } catch (e) {
            console.warn('[grblHAL] Failed to save state:', e);
        }
    }
    
    /**
     * Load saved state from localStorage
     * Returns the saved state or null if none exists
     */
    loadSavedState() {
        try {
            const saved = localStorage.getItem('fluidcnc_machine_state');
            if (!saved) return null;
            
            const state = JSON.parse(saved);
            
            // Only use state if it's less than 1 hour old
            if (Date.now() - state.timestamp > 3600000) {
                console.log('[grblHAL] Saved state expired, ignoring');
                return null;
            }
            
            return state;
        } catch (e) {
            console.warn('[grblHAL] Failed to load saved state:', e);
            return null;
        }
    }
    
    /**
     * Apply saved state (e.g., restore WCO after reconnect)
     */
    applySavedState(savedState) {
        if (!savedState) return;
        
        // Restore work coordinate offset if we have it
        if (savedState.wco) {
            this.state.wco = { ...savedState.wco };
        }
        
        // Restore WCS (G54-G59)
        if (savedState.wcs) {
            this.state.wcs = savedState.wcs;
        }
        
        // Restore machine limits
        if (savedState.machineLimits) {
            this.machineLimits = { ...savedState.machineLimits };
        }
        
        console.log('[grblHAL] Applied saved state from', new Date(savedState.timestamp).toLocaleTimeString());
    }
    
    /**
     * Clear saved state
     */
    clearSavedState() {
        try {
            localStorage.removeItem('fluidcnc_machine_state');
        } catch (e) {
            console.warn('[grblHAL] Failed to clear saved state:', e);
        }
    }
    
    /**
     * Start periodic state saving
     */
    startStatePersistence(intervalMs = 5000) {
        this._stateSaveInterval = setInterval(() => {
            if (this.connected && this.state.status !== 'Unknown') {
                this.saveState();
            }
        }, intervalMs);
        
        // Also save on visibility change (tab hidden = likely refresh coming)
        this._visibilityHandler = () => {
            if (document.visibilityState === 'hidden' && this.connected) {
                this.saveState();
            }
        };
        document.addEventListener('visibilitychange', this._visibilityHandler);
        
        // Save before unload
        this._beforeUnloadHandler = () => {
            if (this.connected) {
                this.saveState();
            }
        };
        window.addEventListener('beforeunload', this._beforeUnloadHandler);
    }
    
    /**
     * Stop periodic state saving
     */
    stopStatePersistence() {
        if (this._stateSaveInterval) {
            clearInterval(this._stateSaveInterval);
            this._stateSaveInterval = null;
        }
        if (this._visibilityHandler) {
            document.removeEventListener('visibilitychange', this._visibilityHandler);
            this._visibilityHandler = null;
        }
        if (this._beforeUnloadHandler) {
            window.removeEventListener('beforeunload', this._beforeUnloadHandler);
            this._beforeUnloadHandler = null;
        }
    }
    
    // ================================================================
    // Static helpers
    // ================================================================
    
    static isWebSerialSupported() {
        return 'serial' in navigator;
    }
    
    static isWebSocketSupported() {
        return 'WebSocket' in window;
    }
    
    static async getSerialPorts() {
        if (!('serial' in navigator)) return [];
        try {
            return await navigator.serial.getPorts();
        } catch (e) {
            return [];
        }
    }
    
    /**
     * Calculate estimated run time for G-code
     */
    static estimateRunTime(lines, defaultFeed = 1000) {
        let totalTime = 0;
        let currentFeed = defaultFeed;
        let lastPos = { x: 0, y: 0, z: 0 };
        
        for (const line of lines) {
            const upper = line.toUpperCase();
            
            // Update feed rate
            const feedMatch = upper.match(/F([\d.]+)/);
            if (feedMatch) currentFeed = parseFloat(feedMatch[1]);
            
            // Parse coordinates
            const x = upper.match(/X([\d.\-]+)/)?.[1];
            const y = upper.match(/Y([\d.\-]+)/)?.[1];
            const z = upper.match(/Z([\d.\-]+)/)?.[1];
            
            if (x || y || z) {
                const newPos = {
                    x: x ? parseFloat(x) : lastPos.x,
                    y: y ? parseFloat(y) : lastPos.y,
                    z: z ? parseFloat(z) : lastPos.z
                };
                
                const dist = Math.sqrt(
                    Math.pow(newPos.x - lastPos.x, 2) +
                    Math.pow(newPos.y - lastPos.y, 2) +
                    Math.pow(newPos.z - lastPos.z, 2)
                );
                
                // G0 = rapid (estimate 5000 mm/min), G1/G2/G3 = feed rate
                const isRapid = upper.includes('G0') || upper.includes('G00');
                const feed = isRapid ? 5000 : currentFeed;
                
                totalTime += (dist / feed) * 60; // seconds
                lastPos = newPos;
            }
        }
        
        return Math.ceil(totalTime);
    }
    
    // ================================================================
    // Offline Command Queue
    // ================================================================
    
    /**
     * Queue a command for execution when connection is restored
     */
    queueOfflineCommand(cmd, options = {}) {
        if (this.offlineQueue.length >= this.offlineQueueMaxSize) {
            console.warn('[grblHAL] Offline queue full, dropping oldest command');
            this.offlineQueue.shift();
        }
        
        const queuedCmd = {
            command: cmd.trim(),
            options: options,
            timestamp: Date.now(),
            id: ++this.commandId
        };
        
        this.offlineQueue.push(queuedCmd);
        console.log(`[grblHAL] Command queued for offline (${this.offlineQueue.length}): ${cmd}`);
        
        // Emit event for UI notification
        this.emit('message', `📋 Queued: ${cmd} (${this.offlineQueue.length} pending)`);
        
        return { queued: true, position: this.offlineQueue.length };
    }
    
    /**
     * Get current offline queue
     */
    getOfflineQueue() {
        return [...this.offlineQueue];
    }
    
    /**
     * Clear offline queue
     */
    clearOfflineQueue() {
        const count = this.offlineQueue.length;
        this.offlineQueue = [];
        console.log(`[grblHAL] Cleared ${count} queued commands`);
        return count;
    }
    
    /**
     * Process queued commands after reconnection
     */
    async processOfflineQueue() {
        if (this.offlineQueue.length === 0) {
            return { processed: 0, failed: 0 };
        }
        
        if (!this.connected) {
            console.warn('[grblHAL] Cannot process queue - not connected');
            return { processed: 0, failed: 0, error: 'Not connected' };
        }
        
        const queueCopy = [...this.offlineQueue];
        this.offlineQueue = [];
        
        console.log(`[grblHAL] Processing ${queueCopy.length} queued commands...`);
        this.emit('message', `▶️ Executing ${queueCopy.length} queued commands...`);
        
        let processed = 0;
        let failed = 0;
        
        for (const item of queueCopy) {
            try {
                // Small delay between commands for buffer safety
                await new Promise(r => setTimeout(r, 50));
                
                const success = this.send(item.command, { ...item.options, noQueue: true });
                if (success) {
                    processed++;
                } else {
                    failed++;
                    console.warn(`[grblHAL] Queued command failed: ${item.command}`);
                }
            } catch (e) {
                failed++;
                console.error(`[grblHAL] Error executing queued command:`, e);
            }
        }
        
        console.log(`[grblHAL] Queue processed: ${processed} ok, ${failed} failed`);
        this.emit('message', `✅ Queue complete: ${processed} executed, ${failed} failed`);
        
        return { processed, failed };
    }
    
    /**
     * Enable/disable offline queuing
     */
    setOfflineQueueEnabled(enabled) {
        this.offlineQueueEnabled = enabled;
        console.log(`[grblHAL] Offline queue ${enabled ? 'enabled' : 'disabled'}`);
    }
    
    /**
     * Check if there are queued commands
     */
    hasQueuedCommands() {
        return this.offlineQueue.length > 0;
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = GrblHAL;
}
