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
    // Static method to check WebSerial support
    static isWebSerialSupported() {
        return 'serial' in navigator;
    }
    
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
        this.demoMode = false;  // Demo mode - allow commands without actual connection
        this.reconnecting = false;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 10;
        this.reconnectDelay = 1000;
        this.reconnectTimer = null;
        this.heartbeatTimer = null;
        this.heartbeatInterval = 2000;
        this.lastResponse = Date.now();
        this.responseTimeout = 5000;
        
        // Demo mode simulation state
        this.demoPosition = { x: 0, y: 0, z: 0 };  // Machine position
        this.demoWCO = { x: 0, y: 0, z: 0 };       // Work Coordinate Offset (G54)
        this.demoSpindle = 0;
        this.demoFeed = 0;
        this.demoCoolant = { flood: false, mist: false };
        this.demoVacuum = false;
        this.demoStatus = 'Idle';
        this.demoStatusTimer = null;
        
        // Machine limits (loaded from $130-$132 for axes, $30/$31 for spindle)
        this.machineLimits = {
            x: { min: 0, max: 400 },
            y: { min: 0, max: 400 },
            z: { min: -200, max: 0 },
            spindleMax: 24000,  // $30 - Max spindle RPM
            spindleMin: 0       // $31 - Min spindle RPM
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
        if (options.onSetting) this.on('setting', options.onSetting);
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
            throw new Error(error);
        }
        
        console.log('[grblHAL] WebSerial is available, requesting port...');
        console.log('[grblHAL] About to call navigator.serial.requestPort()');
        this.connectionType = 'serial';
        
        try {
            // Request port from user - no filters so ALL serial devices show up
            console.log('[grblHAL] Calling requestPort now...');
            this.serialPort = await navigator.serial.requestPort();
            console.log('[grblHAL] Port selected:', this.serialPort);
            
            await this.serialPort.open({ baudRate: this.baudRate });
            
            // Set DTR/RTS signals - required for STM32 USB CDC
            try {
                await this.serialPort.setSignals({ dataTerminalReady: true, requestToSend: true });
                console.log('[grblHAL] DTR/RTS signals set');
            } catch (sigErr) {
                console.warn('[grblHAL] Could not set DTR/RTS signals:', sigErr);
            }
            
            console.log('[grblHAL] Serial port opened at', this.baudRate, 'baud');
            
            // Set up reader and writer
            this.serialWriter = this.serialPort.writable.getWriter();
            this._startSerialReader();
            
            // Wait for USB CDC to stabilize, then send soft reset
            await new Promise(r => setTimeout(r, 300));
            
            // Send soft reset (Ctrl+X) to ensure clean state
            const encoder = new TextEncoder();
            await this.serialWriter.write(encoder.encode('\x18'));
            console.log('[grblHAL] Soft reset sent');
            
            await new Promise(r => setTimeout(r, 500));
            
            this.connected = true;
            this.reconnecting = false;
            this._startHeartbeat();
            this._startSerialWatchdog();  // CRITICAL SAFETY: Start watchdog for hung reads
            
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
        // Determine the WebSocket URL
        // Bridge server uses /ws endpoint on same port as HTTP
        let url;
        const hostname = window.location.hostname;
        const port = window.location.port || 80;
        
        if (hostname && hostname !== '') {
            // Connect to bridge server WebSocket endpoint
            url = `ws://${hostname}:${port}/ws`;
        } else if (this.host && this.host !== 'localhost' && this.host !== '127.0.0.1') {
            // Direct connection to ESP32/FluidNC
            url = `ws://${this.host}:${this.port}`;
        } else {
            // Fallback to localhost bridge
            url = `ws://localhost:8080/ws`;
        }
        
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
        
        // CRITICAL SAFETY: If streaming when disconnected, machine may still be running!
        if (this.streaming) {
            console.error('[SAFETY] Connection lost during streaming - machine may still be moving!');
            this.emit('stream_interrupted', {
                linesInFirmwareBuffer: this.pendingCommands?.length || 0,
                lastKnownPosition: { ...this.state.mpos },
                warning: 'Machine may still be moving! Use physical E-STOP if needed.'
            });
            this._emergencyStopStream(0);
        }
        
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
        if (this.serialWatchdog) { clearInterval(this.serialWatchdog); this.serialWatchdog = null; }
    }
    
    /**
     * CRITICAL SAFETY: Watchdog for WebSerial hung reads
     * If no data received for 5 seconds while connected, force disconnect
     * This detects USB driver crashes, cable disconnects, etc.
     */
    _startSerialWatchdog() {
        if (this.connectionType !== 'serial') return;
        
        const WATCHDOG_TIMEOUT = 5000;  // 5 seconds without data = dead
        
        this.serialWatchdog = setInterval(() => {
            if (!this.connected || this.connectionType !== 'serial') {
                return;
            }
            
            const elapsed = Date.now() - this.lastResponse;
            
            // If streaming, we MUST be getting responses
            if (this.streaming && elapsed > WATCHDOG_TIMEOUT) {
                console.error('[SAFETY] 🚨 Serial watchdog timeout during streaming!');
                console.error('[SAFETY] No response for 5 seconds - USB may be disconnected!');
                
                this.emit('watchdog_timeout', {
                    elapsed,
                    streaming: true,
                    message: 'SERIAL WATCHDOG: No response during streaming - MACHINE MAY STILL BE RUNNING!'
                });
                
                // Force emergency stop stream
                this._emergencyStopStream(99);
                
                // Attempt to disconnect cleanly
                this.disconnect().catch(() => {});
                
                this.emit('disconnect', { 
                    type: 'serial', 
                    reason: 'Watchdog timeout - no response for 5 seconds',
                    warning: 'USE PHYSICAL E-STOP - Machine may still be moving!'
                });
                return;
            }
            
            // Even when idle, we should get status responses from heartbeat
            if (elapsed > WATCHDOG_TIMEOUT * 2) {
                console.warn('[SAFETY] Serial watchdog: No response for 10 seconds, connection may be stale');
                // Send a status query to verify connection
                try {
                    if (this.serialWriter) {
                        const encoder = new TextEncoder();
                        this.serialWriter.write(encoder.encode('?'));
                    }
                } catch (e) {
                    console.error('[SAFETY] Cannot send watchdog query:', e);
                    this.disconnect().catch(() => {});
                }
            }
        }, 2000);  // Check every 2 seconds
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
        // Handle JSON messages from bridge server
        if (line.startsWith('{') && line.endsWith('}')) {
            try {
                const msg = JSON.parse(line);
                if (msg.type === 'bridge_status') {
                    console.log('[grblHAL] Bridge status:', msg.serial);
                    if (msg.serial === 'connected') {
                        // Bridge is connected to serial, mark as connected
                        this.connected = true;
                        this.emit('connect', { type: 'bridge', status: msg.serial });
                    } else if (msg.serial === 'disconnected' || msg.serial === 'reconnecting') {
                        console.warn('[grblHAL] Bridge serial:', msg.serial);
                    }
                    return;
                }
                // Other JSON messages can be handled here
            } catch (e) {
                // Not valid JSON, continue processing as text
            }
        }
        
        // Status report
        if (line.startsWith('<') && line.endsWith('>')) {
            this._parseStatus(line);
            return;
        }
        
        // Chatter detection data from ESP32 (via serial passthrough)
        // Format: [CHATTER]{"score":0.45,"audio":0.3,...}
        if (line.startsWith('[CHATTER]')) {
            try {
                const jsonStr = line.substring(9);  // Remove "[CHATTER]" prefix
                const data = JSON.parse(jsonStr);
                // Forward to chatter detection module if available
                if (window.chatterDetection) {
                    window.chatterDetection.handleSerialData(data);
                }
                this.emit('chatter', data);
            } catch (e) {
                console.warn('[grblHAL] Failed to parse chatter data:', e);
            }
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
        
        // Alarm - CRITICAL: Must stop all streaming immediately!
        if (line.startsWith('ALARM:')) {
            const code = parseInt(line.split(':')[1]) || 0;
            const alarmInfo = this.alarmCodes[code] || { msg: 'Unknown alarm' };
            
            // SAFETY: Record alarm time for safe motion after recovery
            this.lastAlarmTime = Date.now();
            
            // CRITICAL: Immediately stop streaming - do NOT continue sending commands!
            if (this.streaming) {
                console.error('[SAFETY] ALARM received during stream - STOPPING IMMEDIATELY');
                this._emergencyStopStream(code);
            }
            
            // Clear any pending command promises
            while (this.commandQueue.length > 0) {
                const pending = this.commandQueue.shift();
                clearTimeout(pending.timer);
                pending.reject(new Error(`ALARM ${code}: ${alarmInfo.msg}`));
            }
            
            this.emit('alarm', { code, message: alarmInfo.msg, recovery: alarmInfo.recovery });
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
        
        const prevStatus = this.state.status;
        this.state.status = parts[0];
        
        // SAFETY: Detect transition to Alarm/Door state and stop streaming
        if (this.streaming && (this.state.status === 'Alarm' || this.state.status === 'Door')) {
            if (prevStatus !== 'Alarm' && prevStatus !== 'Door') {
                console.error(`[SAFETY] Status changed to ${this.state.status} during streaming - emergency stop`);
                this._emergencyStopStream(0);
            }
        }
        
        for (let i = 1; i < parts.length; i++) {
            const [key, val] = parts[i].split(':');
            
            switch (key) {
                case 'MPos': {
                    // SAFETY: NaN guard - malformed data must not produce NaN positions
                    const coords = val.split(',').map(v => {
                        const n = parseFloat(v);
                        return Number.isFinite(n) ? n : 0;
                    });
                    this.state.mpos = { x: coords[0], y: coords[1], z: coords[2] };
                    this.state.wpos = {
                        x: this.state.mpos.x - this.state.wco.x,
                        y: this.state.mpos.y - this.state.wco.y,
                        z: this.state.mpos.z - this.state.wco.z
                    };
                    break;
                }
                case 'WPos': {
                    // SAFETY: NaN guard - malformed data must not produce NaN positions
                    const coords = val.split(',').map(v => {
                        const n = parseFloat(v);
                        return Number.isFinite(n) ? n : 0;
                    });
                    this.state.wpos = { x: coords[0], y: coords[1], z: coords[2] };
                    this.state.mpos = {
                        x: this.state.wpos.x + this.state.wco.x,
                        y: this.state.wpos.y + this.state.wco.y,
                        z: this.state.wpos.z + this.state.wco.z
                    };
                    break;
                }
                case 'WCO': {
                    // SAFETY: NaN guard for work coordinate offset
                    const coords = val.split(',').map(v => {
                        const n = parseFloat(v);
                        return Number.isFinite(n) ? n : 0;
                    });
                    this.state.wco = { x: coords[0], y: coords[1], z: coords[2] };
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
                case 'SG': {
                    // TMC2209 StallGuard values (grblHAL TRINAMIC_SG_REPORT)
                    const sg = val.split(',').map(n => parseInt(n) || 0);
                    this.state.sg = { x: sg[0], y: sg[1], z: sg[2] || 0 };
                    break;
                }
                case 'TMC': {
                    // TMC driver status flags
                    this.state.tmcStatus = val;
                    break;
                }
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
        
        // SAFETY: Check for M3/M4 spindle on without S parameter
        if ((upperLine.includes('M3') || upperLine.includes('M03') || 
             upperLine.includes('M4') || upperLine.includes('M04')) && !coords.S) {
            // Check if there's no S parameter anywhere in the line
            if (!upperLine.includes('S')) {
                warnings.push('Spindle ON without speed (S parameter) - using last speed or default');
            }
        }
        
        return { valid: true, warnings: warnings.length ? warnings : undefined };
    }
    
    // ================================================================
    // Sending commands
    // ================================================================
    
    /**
     * CRITICAL SAFETY: Send realtime command with ZERO validation or buffering
     * Used for E-STOP, Feed Hold, Cycle Start - must be instantaneous
     * @param {string} char - Single realtime character (!, ~, ?, \x18, etc.)
     */
    sendRealtime(char) {
        // BYPASS ALL CHECKS - send immediately to transport
        const validRealtime = new Set(['!', '~', '?', '\x18', '\x85', 
            '\x90', '\x91', '\x92', '\x93', '\x94', '\x95', '\x96', '\x97', 
            '\x98', '\x99', '\x9A', '\x9B', '\x9C', '\x9D']);
        
        if (!validRealtime.has(char)) {
            console.warn('[grblHAL] Invalid realtime character:', char.charCodeAt(0));
            return false;
        }
        
        let sent = false;
        
        // Try WebSocket
        try {
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                // Send as realtime type for bridge server
                this.ws.send(JSON.stringify({ type: 'realtime', char }));
                sent = true;
            }
        } catch (e) { /* continue */ }
        
        // Try Serial (direct, no buffering)
        try {
            if (this.serialWriter) {
                const encoder = new TextEncoder();
                this.serialWriter.write(encoder.encode(char));
                sent = true;
            }
        } catch (e) { /* continue */ }
        
        if (!sent) {
            console.error('[grblHAL] Failed to send realtime command - no transport available');
        }
        
        return sent;
    }
    
    send(cmd, options = {}) {
        // Demo mode - simulate machine movement
        if (this.demoMode) {
            console.log('[Demo] Command:', cmd);
            this.logCommand(cmd, 'DEMO');
            this.emit('sent', cmd);
            
            // Parse and simulate the command
            this._simulateDemoCommand(cmd);
            
            // Simulate ok response after brief delay
            setTimeout(() => this.emit('ok', {}), 10);
            return true;
        }
        
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
        
        // ============================================
        // SAFETY FIXER - Intercept and auto-fix G-code
        // ============================================
        if (!options.skipSafetyCheck && window.gcodeSafetyFixer) {
            const safetyResult = window.gcodeSafetyFixer.checkAndFix(cmd);
            
            if (safetyResult.blocked) {
                // Command is too dangerous, block it
                this.logError('SAFETY', safetyResult.reason, { command: cmd });
                this.logCommand(cmd, 'BLOCKED', { reason: safetyResult.reason });
                this.emit('error', { code: 'SAFETY_BLOCK', message: safetyResult.reason, command: cmd });
                return false;
            }
            
            if (safetyResult.fixed) {
                // Command was modified for safety
                console.log(`[SafetyFixer] Fixed: "${cmd}" → "${safetyResult.fixedCommand}"`);
                this.logCommand(cmd, 'FIXED', { 
                    fixedTo: safetyResult.fixedCommand,
                    reason: safetyResult.reason 
                });
                cmd = safetyResult.fixedCommand;
                
                // Notify UI of the fix
                this.emit('safetyFix', {
                    original: cmd,
                    fixed: safetyResult.fixedCommand,
                    reason: safetyResult.reason
                });
            }
            
            // Send any prefix commands first (e.g., spindle on before cut)
            if (safetyResult.prefixCommands && safetyResult.prefixCommands.length > 0) {
                for (const prefixCmd of safetyResult.prefixCommands) {
                    console.log(`[SafetyFixer] Sending prefix: ${prefixCmd}`);
                    this._sendRaw(prefixCmd);
                }
            }
        }
        
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
        this._sendRaw(cmd);
        return true;
    }
    
    /**
     * Low-level send without safety checks (used by safety fixer for prefix commands)
     */
    _sendRaw(cmd) {
        if (this.connectionType === 'serial') {
            const encoder = new TextEncoder();
            this.serialWriter.write(encoder.encode(cmd + '\n'));
        } else {
            this.ws.send(cmd + '\n');
        }
    }
    
    /**
     * Send command and wait for ok/error response
     * Uses FIFO queue to match responses to commands
     * NOTE: Realtime commands (?, !, ~, ctrl-x) don't produce ok responses - don't use sendAndWait for them
     */
    sendAndWait(cmd, timeout = 30000) {
        return new Promise((resolve, reject) => {
            if (!this.connected) {
                reject(new Error('Not connected'));
                return;
            }
            
            // Realtime commands don't produce ok/error responses, handle them immediately
            const realtimeCommands = ['?', '!', '~', '\x18', '\x85'];
            if (realtimeCommands.includes(cmd)) {
                const sent = this.send(cmd);
                if (sent) {
                    resolve({ ok: true, command: cmd, realtime: true });
                } else {
                    reject(new Error('Failed to send realtime command'));
                }
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
        
        // SAFETY: Do not send commands if machine is in alarm state
        if (this.state.status === 'Alarm' || this.state.status === 'Door') {
            console.warn('[SAFETY] _sendFromQueue blocked - machine in', this.state.status, 'state');
            this._emergencyStopStream(0);
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
    
    /**
     * Emergency stop stream - called during ALARM, no delays
     * CRITICAL: This must be synchronous to prevent race conditions
     */
    _emergencyStopStream(alarmCode) {
        // Immediately halt ALL streaming state - synchronous, no delays!
        this.streaming = false;
        this.streamStopping = false;
        this.streamPaused = false;
        
        const abortedLines = this.streamQueue.length - this.streamIndex;
        const pendingCount = this.pendingCommands.length;
        
        // Clear all queues
        this.streamQueue = [];
        this.streamIndex = 0;
        this.pendingCommands = [];
        this.bufferUsed = 0;
        
        console.warn(`[SAFETY] Stream emergency stopped: ${abortedLines} lines aborted, ${pendingCount} pending commands dropped`);
        
        // Notify callbacks of emergency stop
        if (this.streamCallbacks?.onError) {
            this.streamCallbacks.onError(new Error(`ALARM ${alarmCode}: Stream aborted for safety`));
        }
        this.streamCallbacks = null;
    }
    
    stopStream() {
        // Set stopping flag to prevent race conditions
        this.streamStopping = true;
        this.streamPaused = false;
        
        // SAFETY FIX: Clear streaming state IMMEDIATELY, not after delay
        this.streaming = false;
        
        const pendingCount = this.pendingCommands.length;
        this.streamQueue = [];
        this.streamIndex = 0;
        this.pendingCommands = [];
        this.bufferUsed = 0;
        
        // Send feed hold and soft reset to stop firmware motion
        this.send('!');  // Feed hold - stops motion immediately
        
        // Small delay before soft reset to let feed hold take effect
        setTimeout(() => {
            this.send('\x18');  // Soft reset - clears firmware buffers
            this.streamStopping = false;
        }, 50);
        
        this.streamCallbacks?.onStop?.({ pendingDropped: pendingCount });
        this.streamCallbacks = null;
    }
    
    /**
     * Alias for stopStream - used by JobQueue
     */
    streamCancel() {
        return this.stopStream();
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
        // CRITICAL SAFETY: Check E-STOP lockout
        if (this.estopActive) {
            console.warn('[SAFETY] Jog blocked - E-STOP lockout active. Call clearEstopLockout() first.');
            this.emit('jog_blocked', { reason: 'E-STOP lockout active' });
            return false;
        }
        
        // CRITICAL SAFETY: Check soft limits before jogging
        if (this.softLimitsEnabled) {
            const axisLower = axis.toLowerCase();
            const currentPos = this.state?.mpos?.[axisLower];
            const limits = this.machineLimits[axisLower];
            
            if (currentPos !== undefined && limits) {
                const targetPos = currentPos + parseFloat(distance);
                
                if (targetPos < limits.min) {
                    console.warn(`[SAFETY] Jog blocked: ${axis}${distance} would exceed min limit (${limits.min})`);
                    this.emit('jog_blocked', { 
                        reason: 'soft_limit',
                        axis,
                        target: targetPos,
                        limit: limits.min,
                        message: `${axis} would exceed minimum limit of ${limits.min}mm`
                    });
                    return false;
                }
                
                if (targetPos > limits.max) {
                    console.warn(`[SAFETY] Jog blocked: ${axis}${distance} would exceed max limit (${limits.max})`);
                    this.emit('jog_blocked', { 
                        reason: 'soft_limit',
                        axis,
                        target: targetPos,
                        limit: limits.max,
                        message: `${axis} would exceed maximum limit of ${limits.max}mm`
                    });
                    return false;
                }
            }
        }
        
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
    // Spindle control - with safety checks
    // ================================================================
    
    /**
     * Turn spindle on with specified RPM and direction
     * @param {number} rpm - Spindle speed (validated against $30/$31 limits)
     * @param {string} direction - 'CW' or 'CCW' (case-insensitive)
     * @returns {Promise} Resolves when command acknowledged
     */
    spindleOn(rpm, direction = 'CW') {
        // SAFETY: Block spindle during alarm/door states
        if (this.state.status === 'Alarm' || this.state.status === 'Door') {
            console.warn('[SAFETY] Spindle blocked - machine in', this.state.status, 'state');
            this.emit?.('warning', { message: `Cannot start spindle during ${this.state.status}` });
            return Promise.reject(new Error(`Cannot start spindle during ${this.state.status}`));
        }
        
        // SAFETY: Block if E-STOP is active
        if (this.estopActive) {
            console.warn('[SAFETY] Spindle blocked - E-STOP active');
            return Promise.reject(new Error('Cannot start spindle - E-STOP active'));
        }
        
        // FIX: Normalize direction to uppercase (HTML buttons pass 'cw'/'ccw')
        const dir = String(direction).toUpperCase();
        if (dir !== 'CW' && dir !== 'CCW') {
            console.error('[SAFETY] Invalid spindle direction:', direction);
            return Promise.reject(new Error('Invalid spindle direction - use CW or CCW'));
        }
        
        // SAFETY: Validate RPM
        rpm = parseInt(rpm, 10);
        if (!Number.isFinite(rpm) || rpm < 0) {
            console.error('[SAFETY] Invalid spindle RPM:', rpm);
            return Promise.reject(new Error('Invalid spindle RPM'));
        }
        
        // SAFETY: Check against machine limits if known
        const maxRpm = this.machineLimits?.spindleMax || 24000;
        const minRpm = this.machineLimits?.spindleMin || 0;
        
        if (rpm > maxRpm) {
            console.warn(`[SAFETY] RPM ${rpm} exceeds max ${maxRpm}, clamping`);
            rpm = maxRpm;
        }
        if (rpm > 0 && rpm < minRpm) {
            console.warn(`[SAFETY] RPM ${rpm} below min ${minRpm}, may stall`);
            this.emit?.('warning', { message: `RPM ${rpm} below minimum ${minRpm}` });
        }
        
        const mCode = dir === 'CW' ? 'M3' : 'M4';
        return this.sendAndWait(`${mCode} S${rpm}`);
    }
    
    spindleOff() {
        // Spindle off is always allowed (safety operation)
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
        // CRITICAL SAFETY: Clamp feed override to safe range 10-200%
        if (!Number.isFinite(percent)) {
            console.error('[SAFETY] Invalid feed override value:', percent);
            return;
        }
        percent = Math.max(10, Math.min(200, Math.round(percent)));
        
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
        // CRITICAL SAFETY: Clamp spindle override to safe range 10-200%
        if (!Number.isFinite(percent)) {
            console.error('[SAFETY] Invalid spindle override value:', percent);
            return;
        }
        percent = Math.max(10, Math.min(200, Math.round(percent)));
        
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
     * CRITICAL: Must bypass all connection checks and send directly
     */
    emergencyStop() {
        console.warn('[grblHAL] EMERGENCY STOP TRIGGERED');
        
        // Clear streaming state FIRST
        this.streaming = false;
        this.streamQueue = [];
        this.commandQueue.forEach(cmd => cmd.reject(new Error('Emergency stop')));
        this.commandQueue = [];
        
        // FORCE SEND - bypass all checks, send directly to transport
        // Try ALL available transports for maximum reliability
        const resetCmd = '\x18';  // Ctrl+X soft reset
        const holdCmd = '!';       // Feed hold
        
        // Try WebSocket directly
        try {
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                this.ws.send(resetCmd);
                this.ws.send(holdCmd);
            }
        } catch (e) { /* absorb - keep trying */ }
        
        // Try Serial directly
        let serialSent = false;
        try {
            if (this.serialWriter) {
                const encoder = new TextEncoder();
                this.serialWriter.write(encoder.encode(resetCmd));
                this.serialWriter.write(encoder.encode(holdCmd));
                serialSent = true;
            }
        } catch (e) { console.error('[ESTOP] Serial send failed:', e); }
        
        // Also try through normal send as backup (may fail but try anyway)
        try {
            this.send(resetCmd, { skipValidation: true });
            this.send(holdCmd, { skipValidation: true });
        } catch (e) { /* absorb */ }
        
        // CRITICAL SAFETY: Alert operator if E-STOP could not be sent!
        const wsSent = this.ws && this.ws.readyState === WebSocket.OPEN;
        if (!wsSent && !serialSent) {
            console.error('[ESTOP] ⚠️ EMERGENCY STOP FAILED - NO CONNECTION!');
            this.emit('estop_failed', { 
                time: Date.now(),
                message: 'EMERGENCY STOP FAILED - CONNECTION LOST - USE PHYSICAL E-STOP!'
            });
            // Play audible alarm
            try {
                const audio = new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdH+LkY6Coverage9v');
                audio.volume = 1.0;
                audio.play().catch(() => {});
            } catch(e) {}
            // Show alert as absolute last resort
            if (typeof alert !== 'undefined') {
                setTimeout(() => alert('⚠️ EMERGENCY STOP FAILED - USE PHYSICAL E-STOP BUTTON!'), 0);
            }
        }
        
        // CRITICAL SAFETY: Set E-STOP lockout to prevent accidental resume
        this.estopActive = true;
        this.estopTime = Date.now();
        
        this.emit('estop', { time: Date.now(), sent: wsSent || serialSent });
    }
    
    /**
     * Clear E-STOP lockout - REQUIRES EXPLICIT USER ACTION
     * Machine must be in Idle or Alarm state before clearing
     */
    clearEstopLockout() {
        if (!this.estopActive) {
            console.log('[grblHAL] No E-STOP lockout active');
            return true;
        }
        
        // SAFETY: Require at least 2 seconds since E-STOP to prevent accidental clear
        const elapsed = Date.now() - (this.estopTime || 0);
        if (elapsed < 2000) {
            console.warn('[SAFETY] E-STOP lockout cannot be cleared within 2 seconds');
            return false;
        }
        
        // SAFETY: Only allow clear if machine is in safe state
        const status = this.state?.status;
        if (status && !['Idle', 'Alarm', 'Sleep'].includes(status)) {
            console.warn(`[SAFETY] Cannot clear E-STOP lockout while machine is ${status}`);
            return false;
        }
        
        this.estopActive = false;
        this.estopTime = null;
        console.log('[grblHAL] E-STOP lockout cleared');
        this.emit('estop_cleared', { time: Date.now() });
        return true;
    }
    
    /**
     * Check if E-STOP lockout is active
     */
    isEstopActive() {
        return this.estopActive === true;
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
        // Axis travel limits
        if (settings[130]) this.machineLimits.x.max = parseFloat(settings[130]);
        if (settings[131]) this.machineLimits.y.max = parseFloat(settings[131]);
        if (settings[132]) this.machineLimits.z.max = parseFloat(settings[132]);
        if (settings[20]) this.softLimitsEnabled = settings[20] === '1';
        
        // Spindle limits ($30=max RPM, $31=min RPM)
        if (settings[30]) this.machineLimits.spindleMax = parseFloat(settings[30]);
        if (settings[31]) this.machineLimits.spindleMin = parseFloat(settings[31]);
        
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
    isConnected() { return this.connected || this.demoMode; }
    isDemoMode() { return this.demoMode; }
    setDemoMode(enabled) { 
        this.demoMode = enabled;
        if (enabled) {
            this._startDemoStatusUpdates();
        } else {
            this._stopDemoStatusUpdates();
        }
    }
    isIdle() { return this.state.status === 'Idle'; }
    isRunning() { return this.state.status === 'Run'; }
    isHolding() { return this.state.status === 'Hold' || this.state.status === 'Hold:0' || this.state.status === 'Hold:1'; }
    isAlarm() { return this.state.status === 'Alarm'; }
    isHoming() { return this.state.status === 'Home'; }
    getConnectionType() { return this.connectionType; }
    getMachineLimits() { return { ...this.machineLimits }; }
    
    // ================================================================
    // Demo Mode Simulation
    // ================================================================
    
    _startDemoStatusUpdates() {
        // Send periodic status updates in demo mode
        this.demoStatusTimer = setInterval(() => {
            if (!this.demoMode) return;
            
            // Calculate work position = machine position - work coordinate offset
            const wpos = {
                x: this.demoPosition.x - this.demoWCO.x,
                y: this.demoPosition.y - this.demoWCO.y,
                z: this.demoPosition.z - this.demoWCO.z
            };
            
            // Update internal state
            this.state.mpos = { ...this.demoPosition };
            this.state.wpos = wpos;
            this.state.wco = { ...this.demoWCO };
            this.state.status = this.demoStatus;
            this.state.spindleSpeed = this.demoSpindle;
            this.state.feedRate = this.demoFeed;
            
            // Calculate limit switch states based on position
            const limits = {
                x: this.demoPosition.x <= this.machineLimits.x.min || this.demoPosition.x >= this.machineLimits.x.max,
                y: this.demoPosition.y <= this.machineLimits.y.min || this.demoPosition.y >= this.machineLimits.y.max,
                z: this.demoPosition.z <= this.machineLimits.z.min || this.demoPosition.z >= this.machineLimits.z.max
            };
            
            // Emit status event
            this.emit('status', {
                status: this.demoStatus,
                mpos: { ...this.demoPosition },
                wpos: wpos,
                wco: { ...this.demoWCO },
                feed: this.demoFeed,
                feedRate: this.demoFeed,
                spindle: this.demoSpindle,
                spindleSpeed: this.demoSpindle,
                coolant: { ...this.demoCoolant },
                vacuum: this.demoVacuum,
                feedOverride: 100,
                rapidOverride: 100,
                spindleOverride: 100,
                limits: limits,
                pins: (limits.x ? 'X' : '') + (limits.y ? 'Y' : '') + (limits.z ? 'Z' : '')
            });
        }, 100); // 10Hz updates
    }
    
    _stopDemoStatusUpdates() {
        if (this.demoStatusTimer) {
            clearInterval(this.demoStatusTimer);
            this.demoStatusTimer = null;
        }
    }
    
    _simulateDemoCommand(cmd) {
        const upper = cmd.toUpperCase().trim();
        
        // Jog commands: $J=G91 X10 F3000
        if (upper.startsWith('$J=')) {
            const jogCmd = upper.substring(3);
            const isRelative = jogCmd.includes('G91');
            
            const xMatch = cmd.match(/X(-?\d+\.?\d*)/i);
            const yMatch = cmd.match(/Y(-?\d+\.?\d*)/i);
            const zMatch = cmd.match(/Z(-?\d+\.?\d*)/i);
            const fMatch = cmd.match(/F(\d+\.?\d*)/i);
            
            if (fMatch) this.demoFeed = parseFloat(fMatch[1]);
            
            // Apply movement with limits
            if (xMatch) {
                let newX = isRelative ? this.demoPosition.x + parseFloat(xMatch[1]) : parseFloat(xMatch[1]);
                newX = Math.max(this.machineLimits.x.min, Math.min(this.machineLimits.x.max, newX));
                this.demoPosition.x = newX;
            }
            if (yMatch) {
                let newY = isRelative ? this.demoPosition.y + parseFloat(yMatch[1]) : parseFloat(yMatch[1]);
                newY = Math.max(this.machineLimits.y.min, Math.min(this.machineLimits.y.max, newY));
                this.demoPosition.y = newY;
            }
            if (zMatch) {
                let newZ = isRelative ? this.demoPosition.z + parseFloat(zMatch[1]) : parseFloat(zMatch[1]);
                newZ = Math.max(this.machineLimits.z.min, Math.min(this.machineLimits.z.max, newZ));
                this.demoPosition.z = newZ;
            }
            
            this.demoStatus = 'Jog';
            setTimeout(() => { if (this.demoMode) this.demoStatus = 'Idle'; }, 200);
            return;
        }
        
        // G0/G1 move commands
        if (upper.includes('G0') || upper.includes('G1')) {
            const xMatch = cmd.match(/X(-?\d+\.?\d*)/i);
            const yMatch = cmd.match(/Y(-?\d+\.?\d*)/i);
            const zMatch = cmd.match(/Z(-?\d+\.?\d*)/i);
            const fMatch = cmd.match(/F(\d+\.?\d*)/i);
            
            if (fMatch) this.demoFeed = parseFloat(fMatch[1]);
            if (xMatch) {
                let newX = parseFloat(xMatch[1]);
                this.demoPosition.x = Math.max(this.machineLimits.x.min, Math.min(this.machineLimits.x.max, newX));
            }
            if (yMatch) {
                let newY = parseFloat(yMatch[1]);
                this.demoPosition.y = Math.max(this.machineLimits.y.min, Math.min(this.machineLimits.y.max, newY));
            }
            if (zMatch) {
                let newZ = parseFloat(zMatch[1]);
                this.demoPosition.z = Math.max(this.machineLimits.z.min, Math.min(this.machineLimits.z.max, newZ));
            }
            
            this.demoStatus = 'Run';
            setTimeout(() => { if (this.demoMode) this.demoStatus = 'Idle'; }, 300);
            return;
        }
        
        // Home command
        if (upper === '$H' || upper === '$HX' || upper === '$HY' || upper === '$HZ') {
            this.demoStatus = 'Home';
            setTimeout(() => {
                if (this.demoMode) {
                    if (upper === '$H') {
                        this.demoPosition = { x: 0, y: 0, z: 0 };
                    } else if (upper === '$HX') {
                        this.demoPosition.x = 0;
                    } else if (upper === '$HY') {
                        this.demoPosition.y = 0;
                    } else if (upper === '$HZ') {
                        this.demoPosition.z = 0;
                    }
                    this.demoStatus = 'Idle';
                }
            }, 1000);
            return;
        }
        
        // Unlock
        if (upper === '$X') {
            this.demoStatus = 'Idle';
            return;
        }
        
        // Reset (Ctrl+X)
        if (cmd === '\x18') {
            this.demoPosition = { x: 0, y: 0, z: 0 };
            this.demoWCO = { x: 0, y: 0, z: 0 };  // Reset WCS offsets too
            this.demoSpindle = 0;
            this.demoFeed = 0;
            this.demoStatus = 'Idle';
            return;
        }
        
        // Spindle on
        if (upper.includes('M3') || upper.includes('M03') || upper.includes('M4') || upper.includes('M04')) {
            const sMatch = cmd.match(/S(\d+)/i);
            this.demoSpindle = sMatch ? parseInt(sMatch[1]) : 12000;
            return;
        }
        
        // Spindle off
        if (upper.includes('M5') || upper.includes('M05')) {
            this.demoSpindle = 0;
            return;
        }
        
        // Zero commands (G10 L20 P1 X0 / Y0 / Z0) - Sets WCO so work position = 0
        if (upper.includes('G10') && upper.includes('L20')) {
            // G10 L20 P1 X0 means: set WCO.x = current_mpos.x so wpos.x becomes 0
            if (upper.includes('X0')) {
                this.demoWCO.x = this.demoPosition.x;
            }
            if (upper.includes('Y0')) {
                this.demoWCO.y = this.demoPosition.y;
            }
            if (upper.includes('Z0')) {
                this.demoWCO.z = this.demoPosition.z;
            }
            console.log('[Demo] Set WCO - machine pos:', this.demoPosition, 'WCO:', this.demoWCO);
            return;
        }
        
        // Coolant commands
        if (upper.includes('M7')) {
            this.demoCoolant.mist = true;
            console.log('[Demo] Mist coolant ON');
            return;
        }
        if (upper.includes('M8')) {
            this.demoCoolant.flood = true;
            console.log('[Demo] Flood coolant ON');
            return;
        }
        if (upper.includes('M9')) {
            this.demoCoolant = { flood: false, mist: false };
            console.log('[Demo] Coolant OFF');
            return;
        }
        
        // Vacuum/Digital output commands (M62-M65)
        if (upper.match(/M6[45]\s*P0/)) {
            this.demoVacuum = upper.includes('M64');
            console.log('[Demo] Vacuum:', this.demoVacuum ? 'ON' : 'OFF');
            return;
        }
        
        // Jog cancel
        if (cmd === '\x85') {
            this.demoStatus = 'Idle';
            return;
        }
    }
    
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
