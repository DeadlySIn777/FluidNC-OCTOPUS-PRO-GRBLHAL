/**
 * Universal USB Serial Manager for FluidCNC
 * 
 * Auto-detects and connects to:
 * - grblHAL (Octopus Pro) - CNC motion control (STM32 VID: 0x0483)
 * - ChatterDetect (ESP32-S3) - Sensor data
 * - VFD Controller (ESP32) - Spindle control via Modbus
 * 
 * All via WebSerial USB with auto-detection - works on any PC!
 */

class DualSerialManager {
    constructor() {
        // Known USB Vendor IDs
        this.USB_VENDORS = {
            STM32: 0x0483,       // STMicroelectronics (grblHAL)
            SILICON_LABS: 0x10C4, // CP2102 (ESP32 dev boards)
            CH340: 0x1A86,       // CH340 (cheap ESP32 boards)
            FTDI: 0x0403,        // FTDI
            ESPRESSIF: 0x303A,   // Espressif native USB (ESP32-S3)
        };
        
        // Device identification signatures
        this.DEVICE_SIGNATURES = {
            GRBL: ['Grbl', 'grblHAL', '[VER:', '[OPT:'],
            VFD: ['VFD Controller', 'ESP32 VFD', '"vfd":', 'MODBUS'],
            CHATTER: ['ChatterDetect', 'ESP32-S3', '"audio":', '"accel":'],
        };
        
        // grblHAL connection
        this.grblPort = null;
        this.grblReader = null;
        this.grblWriter = null;
        this.grblConnected = false;
        this.grblBuffer = '';
        
        // ChatterDetect connection
        this.chatterPort = null;
        this.chatterReader = null;
        this.chatterWriter = null;
        this.chatterConnected = false;
        this.chatterBuffer = '';
        
        // VFD Controller connection
        this.vfdPort = null;
        this.vfdReader = null;
        this.vfdWriter = null;
        this.vfdConnected = false;
        this.vfdBuffer = '';
        this.vfdStatus = {
            online: false,
            running: false,
            forward: true,
            fault: false,
            faultCode: 0,
            setFreqHz: 0,
            actualFreqHz: 0,
            setRPM: 0,
            actualRPM: 0,
            outputAmps: 0,
            outputVolts: 0,
            dcBusVolts: 0,
            temperature: 0,
            motorTemp: 0,
            loadPercent: 0
        };
        
        // State
        this.machineState = 'Unknown';
        this.machinePos = { x: 0, y: 0, z: 0 };
        this.feedOverride = 100;
        this.spindleRPM = 0;
        
        // Chatter detection
        this.chatterEnabled = true;
        this.chatterThreshold = 0.5;
        this.sensorData = {
            audio: 0,
            accel: 0,
            current: 0,
            combined: 0,
            chatter: false,
            vfd: 0
        };
        
        // Callbacks
        this.onGrblStatus = null;
        this.onGrblLine = null;    // For grblhal-settings.js parsing
        this.onGrblAlarm = null;   // Alarm callback
        this.onChatterData = null;
        this.onVfdStatus = null;   // VFD status callback
        this.onConnectionChange = null;
        this.onAutoDetect = null;  // Progress callback for auto-detect
        this.onError = null;
        this.onReconnecting = null; // Reconnection status callback
        this.onMessage = null;     // General messages (MSG, homing, etc)
        this.onHomingComplete = null; // Homing finished callback
        this.onFirmwareInfo = null;  // Firmware version/info callback
        this.onTmcStatus = null;   // TMC2209 driver status callback
        
        // Auto-reconnect settings
        this.autoReconnect = true;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.reconnectDelay = 2000;  // ms
        this._reconnectTimers = {};
        
        // Homing status tracking
        this.homedAxes = { x: false, y: false, z: false };
        
        // Safe movement settings
        this.safeZ = 5;  // mm above work to retract for safe XY moves
        this.rapidRate = 3000; // mm/min for rapid moves
        this.homingInProgress = false;
        
        // Auto feed reduction
        this.autoFeedEnabled = true;
        this.minFeed = 30;
        this.feedStep = 10;
        this.recovering = false;
        this.lastChatterTime = 0;
        
        // Pending identification
        this._pendingPorts = [];
    }
    
    // ========================================================================
    // AUTO-DETECTION - Universal device discovery
    // ========================================================================
    
    /**
     * Auto-detect and connect all devices
     * Works on any PC - remembers previously authorized ports
     */
    async autoDetectAll() {
        if (!('serial' in navigator)) {
            throw new Error('WebSerial not supported. Use Chrome/Edge.');
        }
        
        const results = { grbl: false, vfd: false, chatter: false };
        
        try {
            // Step 1: Get all previously authorized ports (no popup!)
            let ports = await navigator.serial.getPorts();
            console.log(`Found ${ports.length} previously authorized ports`);
            
            // Step 2: If no ports, request access to all CNC-related devices
            if (ports.length === 0) {
                this._notifyAutoDetect('Requesting device access...');
                
                // Request with broad filter to get all potential devices
                try {
                    const newPort = await navigator.serial.requestPort({
                        filters: [
                            { usbVendorId: this.USB_VENDORS.STM32 },
                            { usbVendorId: this.USB_VENDORS.SILICON_LABS },
                            { usbVendorId: this.USB_VENDORS.CH340 },
                            { usbVendorId: this.USB_VENDORS.FTDI },
                            { usbVendorId: this.USB_VENDORS.ESPRESSIF },
                        ]
                    });
                    ports = await navigator.serial.getPorts();
                } catch (e) {
                    console.log('User cancelled port selection');
                }
            }
            
            // Step 3: Identify each port
            this._notifyAutoDetect(`Scanning ${ports.length} devices...`);
            
            for (const port of ports) {
                const info = port.getInfo();
                console.log('Checking port:', info);
                
                // Skip already connected ports
                if (port === this.grblPort || port === this.vfdPort || port === this.chatterPort) {
                    continue;
                }
                
                // STM32 is always grblHAL
                if (info.usbVendorId === this.USB_VENDORS.STM32) {
                    this._notifyAutoDetect('Found grblHAL controller...');
                    try {
                        await this._connectPortAsGrbl(port);
                        results.grbl = true;
                    } catch (e) {
                        console.error('Failed to connect grblHAL:', e);
                    }
                    continue;
                }
                
                // ESP32 - need to identify by probing
                if ([this.USB_VENDORS.SILICON_LABS, this.USB_VENDORS.CH340, 
                     this.USB_VENDORS.FTDI, this.USB_VENDORS.ESPRESSIF].includes(info.usbVendorId)) {
                    this._notifyAutoDetect('Identifying ESP32 device...');
                    try {
                        const deviceType = await this._identifyDevice(port);
                        
                        if (deviceType === 'VFD' && !this.vfdConnected) {
                            this._notifyAutoDetect('Found VFD Controller...');
                            await this._connectPortAsVfd(port);
                            results.vfd = true;
                        } else if (deviceType === 'CHATTER' && !this.chatterConnected) {
                            this._notifyAutoDetect('Found Chatter Sensor...');
                            await this._connectPortAsChatter(port);
                            results.chatter = true;
                        }
                    } catch (e) {
                        console.error('Failed to identify device:', e);
                    }
                }
            }
            
            // Report results
            const connected = [];
            if (results.grbl) connected.push('grblHAL');
            if (results.vfd) connected.push('VFD');
            if (results.chatter) connected.push('Chatter');
            
            if (connected.length > 0) {
                this._notifyAutoDetect(`Connected: ${connected.join(', ')}`);
            } else {
                this._notifyAutoDetect('No new devices found. Click to add devices.');
            }
            
            return results;
            
        } catch (err) {
            console.error('Auto-detect error:', err);
            this._notifyAutoDetect('Detection failed: ' + err.message);
            throw err;
        }
    }
    
    /**
     * Request and add a new device (shows browser popup)
     */
    async addDevice() {
        if (!('serial' in navigator)) {
            throw new Error('WebSerial not supported');
        }
        
        try {
            const port = await navigator.serial.requestPort({
                filters: [
                    { usbVendorId: this.USB_VENDORS.STM32 },
                    { usbVendorId: this.USB_VENDORS.SILICON_LABS },
                    { usbVendorId: this.USB_VENDORS.CH340 },
                    { usbVendorId: this.USB_VENDORS.FTDI },
                    { usbVendorId: this.USB_VENDORS.ESPRESSIF },
                ]
            });
            
            // Now auto-detect will pick it up
            return await this.autoDetectAll();
            
        } catch (err) {
            if (err.name === 'NotFoundError') {
                console.log('User cancelled');
                return null;
            }
            throw err;
        }
    }
    
    /**
     * Identify a device by probing it
     */
    async _identifyDevice(port) {
        let reader = null;
        let writer = null;
        
        try {
            await port.open({ baudRate: 115200 });
            
            const textDecoder = new TextDecoderStream();
            port.readable.pipeTo(textDecoder.writable);
            reader = textDecoder.readable.getReader();
            
            const textEncoder = new TextEncoderStream();
            textEncoder.readable.pipeTo(port.writable);
            writer = textEncoder.writable.getWriter();
            
            // Wait for any boot messages
            await this._delay(500);
            
            // Collect any initial output
            let response = '';
            const collectPromise = (async () => {
                try {
                    while (true) {
                        const { value, done } = await reader.read();
                        if (done) break;
                        response += value;
                        if (response.length > 500) break;
                    }
                } catch (e) {}
            })();
            
            // Send identification commands
            await writer.write('STATUS\n');
            await this._delay(300);
            await writer.write('INFO\n');
            await this._delay(300);
            await writer.write('?\n');
            await this._delay(300);
            
            // Cancel reading
            await reader.cancel().catch(() => {});
            await port.close().catch(() => {});
            
            console.log('Device response:', response.substring(0, 200));
            
            // Check for VFD signatures
            for (const sig of this.DEVICE_SIGNATURES.VFD) {
                if (response.includes(sig)) {
                    return 'VFD';
                }
            }
            
            // Check for Chatter signatures
            for (const sig of this.DEVICE_SIGNATURES.CHATTER) {
                if (response.includes(sig)) {
                    return 'CHATTER';
                }
            }
            
            // Check for grblHAL signatures
            for (const sig of this.DEVICE_SIGNATURES.GRBL) {
                if (response.includes(sig)) {
                    return 'GRBL';
                }
            }
            
            return 'UNKNOWN';
            
        } catch (err) {
            console.error('Device identification failed:', err);
            try { await port.close(); } catch (e) {}
            return 'UNKNOWN';
        }
    }
    
    async _connectPortAsGrbl(port) {
        if (this.grblConnected) return;
        
        this.grblPort = port;
        
        if (!port.readable) {
            await port.open({ baudRate: 115200 });
        }
        
        // Setup streams
        const textDecoder = new TextDecoderStream();
        port.readable.pipeTo(textDecoder.writable);
        this.grblReader = textDecoder.readable.getReader();
        
        const textEncoder = new TextEncoderStream();
        textEncoder.readable.pipeTo(port.writable);
        this.grblWriter = textEncoder.writable.getWriter();
        
        // Enable DTR/RTS
        await port.setSignals({ dataTerminalReady: true, requestToSend: true });
        
        this.grblConnected = true;
        this._notifyConnectionChange();
        
        // Start reading
        this._readGrblLoop();
        
        // Send soft reset and start status polling
        await this._delay(100);
        await this.sendGrbl('\x18');
        await this._delay(500);
        
        // Query firmware version
        await this.sendGrbl('$I');
        
        this._startGrblPolling();
        
        console.log('✓ grblHAL connected (auto-detect)');
    }
    
    async _connectPortAsVfd(port) {
        if (this.vfdConnected) return;
        
        this.vfdPort = port;
        
        if (!port.readable) {
            await port.open({ baudRate: 115200 });
        }
        
        // Setup streams
        const textDecoder = new TextDecoderStream();
        port.readable.pipeTo(textDecoder.writable);
        this.vfdReader = textDecoder.readable.getReader();
        
        const textEncoder = new TextEncoderStream();
        textEncoder.readable.pipeTo(port.writable);
        this.vfdWriter = textEncoder.writable.getWriter();
        
        this.vfdConnected = true;
        this._notifyConnectionChange();
        
        // Start reading
        this._readVfdLoop();
        
        // Request status
        await this._delay(100);
        await this.sendVfd('STATUS');
        this._startVfdPolling();
        
        console.log('✓ VFD Controller connected (auto-detect)');
    }
    
    async _connectPortAsChatter(port) {
        if (this.chatterConnected) return;
        
        this.chatterPort = port;
        
        if (!port.readable) {
            await port.open({ baudRate: 115200 });
        }
        
        // Setup streams
        const textDecoder = new TextDecoderStream();
        port.readable.pipeTo(textDecoder.writable);
        this.chatterReader = textDecoder.readable.getReader();
        
        const textEncoder = new TextEncoderStream();
        textEncoder.readable.pipeTo(port.writable);
        this.chatterWriter = textEncoder.writable.getWriter();
        
        this.chatterConnected = true;
        this._notifyConnectionChange();
        
        // Start reading
        this._readChatterLoop();
        
        // Request device info
        await this._delay(100);
        await this.sendChatter('INFO');
        
        console.log('✓ ChatterDetect connected (auto-detect)');
    }
    
    _notifyAutoDetect(message) {
        console.log('Auto-detect:', message);
        if (this.onAutoDetect) {
            this.onAutoDetect(message);
        }
    }
    
    // ========================================================================
    // MANUAL CONNECTION (fallback)
    // ========================================================================
    
    async connectGrbl() {
        if (!('serial' in navigator)) {
            throw new Error('WebSerial not supported. Use Chrome/Edge.');
        }
        
        try {
            this.grblPort = await navigator.serial.requestPort({
                filters: [
                    { usbVendorId: this.USB_VENDORS.STM32 },
                ]
            });
            
            await this._connectPortAsGrbl(this.grblPort);
            return true;
            
        } catch (err) {
            console.error('grblHAL connection failed:', err);
            this.grblConnected = false;
            throw err;
        }
    }
    
    async connectChatter() {
        if (!('serial' in navigator)) {
            throw new Error('WebSerial not supported');
        }
        
        try {
            const port = await navigator.serial.requestPort({
                filters: [
                    { usbVendorId: this.USB_VENDORS.SILICON_LABS },
                    { usbVendorId: this.USB_VENDORS.CH340 },
                    { usbVendorId: this.USB_VENDORS.FTDI },
                    { usbVendorId: this.USB_VENDORS.ESPRESSIF },
                ]
            });
            
            await this._connectPortAsChatter(port);
            return true;
            
        } catch (err) {
            console.error('ChatterDetect connection failed:', err);
            this.chatterConnected = false;
            throw err;
        }
    }
    
    async connectVfd() {
        if (!('serial' in navigator)) {
            throw new Error('WebSerial not supported');
        }
        
        try {
            const port = await navigator.serial.requestPort({
                filters: [
                    { usbVendorId: this.USB_VENDORS.SILICON_LABS },
                    { usbVendorId: this.USB_VENDORS.CH340 },
                    { usbVendorId: this.USB_VENDORS.FTDI },
                    { usbVendorId: this.USB_VENDORS.ESPRESSIF },
                ]
            });
            
            await this._connectPortAsVfd(port);
            return true;
            
        } catch (err) {
            console.error('VFD connection failed:', err);
            this.vfdConnected = false;
            throw err;
        }
    }
    
    async disconnect() {
        if (this.grblReader) {
            await this.grblReader.cancel();
            this.grblReader = null;
        }
        if (this.grblPort) {
            await this.grblPort.close();
            this.grblPort = null;
        }
        this.grblConnected = false;
        
        if (this.chatterReader) {
            await this.chatterReader.cancel();
            this.chatterReader = null;
        }
        if (this.chatterPort) {
            await this.chatterPort.close();
            this.chatterPort = null;
        }
        this.chatterConnected = false;
        
        if (this.vfdReader) {
            await this.vfdReader.cancel();
            this.vfdReader = null;
        }
        if (this.vfdPort) {
            await this.vfdPort.close();
            this.vfdPort = null;
        }
        this.vfdConnected = false;
        
        if (this._vfdPollInterval) {
            clearInterval(this._vfdPollInterval);
            this._vfdPollInterval = null;
        }
        
        this._notifyConnectionChange();
    }
    
    // ========================================================================
    // GRBL COMMUNICATION
    // ========================================================================
    
    async sendGrbl(command) {
        if (!this.grblConnected || !this.grblWriter) return;
        
        try {
            if (!command.endsWith('\n') && command !== '\x18') {
                command += '\n';
            }
            await this.grblWriter.write(command);
        } catch (err) {
            console.error('grblHAL send error:', err);
            this._handleGrblDisconnect();
        }
    }
    
    async _readGrblLoop() {
        try {
            while (this.grblConnected && this.grblReader) {
                const { value, done } = await this.grblReader.read();
                if (done) break;
                
                this.grblBuffer += value;
                this._processGrblBuffer();
            }
        } catch (err) {
            if (err.name !== 'NetworkError') {
                console.error('grblHAL read error:', err);
            }
            this._handleGrblDisconnect();
        }
    }
    
    _processGrblBuffer() {
        const lines = this.grblBuffer.split('\n');
        this.grblBuffer = lines.pop() || '';
        
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            
            // Call line handler if registered (for settings parsing, etc.)
            if (this.onGrblLine) {
                this.onGrblLine(trimmed);
            }
            
            // Status report: <Idle|MPos:0.000,0.000,0.000|...>
            if (trimmed.startsWith('<') && trimmed.endsWith('>')) {
                this._parseGrblStatus(trimmed);
            }
            // Homing cycle messages
            else if (trimmed.includes('Homing')) {
                if (trimmed.includes('cycle')) {
                    this.homingInProgress = true;
                    this.machineState = 'Home';
                    if (this.onMessage) {
                        this.onMessage({ type: 'homing', text: trimmed });
                    }
                }
            }
            // Homing complete - machine is now homed
            else if (trimmed === 'ok' && this.homingInProgress) {
                this.homingInProgress = false;
                this.homedAxes = { x: true, y: true, z: true };
                if (this.onHomingComplete) {
                    this.onHomingComplete(this.homedAxes);
                }
            }
            // MSG feedback
            else if (trimmed.startsWith('[MSG:')) {
                const msg = trimmed.slice(5, -1);
                if (this.onMessage) {
                    this.onMessage({ type: 'msg', text: msg });
                }
                // Check for specific messages
                if (msg.includes('Reset to continue') || msg.includes('Unlocked')) {
                    this.machineState = 'Idle';
                }
                if (msg.includes('Caution: Unlocked')) {
                    // Machine unlocked but not homed
                    this.homedAxes = { x: false, y: false, z: false };
                }
            }
            // Alarm
            else if (trimmed.startsWith('ALARM:')) {
                this.machineState = 'Alarm';
                this.homingInProgress = false;
                const code = parseInt(trimmed.split(':')[1]) || 0;
                if (this.onGrblAlarm) {
                    this.onGrblAlarm({ code, raw: trimmed });
                }
                if (this.onError) {
                    this.onError('grbl', trimmed);
                }
            }
            // Error
            else if (trimmed.startsWith('error:')) {
                const errorCode = parseInt(trimmed.split(':')[1]) || 0;
                const errorInfo = this._getGrblErrorInfo(errorCode);
                if (this.onError) {
                    this.onError('grbl', trimmed, errorInfo);
                }
            }
            // TMC driver warnings [TMC_WR] or thermal status
            else if (trimmed.includes('[TMC')) {
                this._parseTmcMessage(trimmed);
            }
            // Firmware version response [VER:1.1...
            else if (trimmed.startsWith('[VER:')) {
                this._parseFirmwareVersion(trimmed);
            }
            // Options response [OPT:...
            else if (trimmed.startsWith('[OPT:')) {
                this._parseOptions(trimmed);
            }
        }
    }
    
    /**
     * Parse firmware version from [VER:...] response
     */
    _parseFirmwareVersion(line) {
        // [VER:1.1f.20240925:grblHAL,STM32F4xx]
        const match = line.match(/\[VER:([^\]]+)\]/);
        if (match) {
            this.firmwareInfo = this.firmwareInfo || {};
            const parts = match[1].split(':');
            this.firmwareInfo.version = parts[0] || 'Unknown';
            if (parts[1]) {
                const boardParts = parts[1].split(',');
                this.firmwareInfo.name = boardParts[0] || 'grbl';
                this.firmwareInfo.board = boardParts[1] || '';
            }
            console.log('[DualSerial] Firmware:', this.firmwareInfo);
            
            if (this.onFirmwareInfo) {
                this.onFirmwareInfo(this.firmwareInfo);
            }
        }
    }
    
    /**
     * Parse options from [OPT:...] response
     */
    _parseOptions(line) {
        // [OPT:V,35,128,200]
        const match = line.match(/\[OPT:([^\]]+)\]/);
        if (match) {
            this.firmwareInfo = this.firmwareInfo || {};
            this.firmwareInfo.options = match[1];
            
            // Parse option flags
            const optParts = match[1].split(',');
            this.firmwareInfo.optionFlags = optParts[0] || '';
            this.firmwareInfo.blockBufferSize = parseInt(optParts[1]) || 0;
            this.firmwareInfo.rxBufferSize = parseInt(optParts[2]) || 0;
            
            if (this.onFirmwareInfo) {
                this.onFirmwareInfo(this.firmwareInfo);
            }
        }
    }
    
    /**
     * Parse TMC driver status/warning messages
     * Handles: [TMC_WR], thermal warnings, stallguard events, driver status
     */
    _parseTmcMessage(line) {
        // [TMC_WR] id=0 addr=0x80 data=...
        // [TMC status: X=ok Y=otpw Z=ok]
        // Could also have thermal warnings, stallguard events, etc.
        const idMatch = line.match(/id=(\d+)/);
        const id = idMatch ? parseInt(idMatch[1]) : -1;
        
        // Initialize TMC status tracking
        if (!this.tmcStatus) {
            this.tmcStatus = {
                x: { status: 'unknown', sg: 0, temp: 'ok', current: 0 },
                y: { status: 'unknown', sg: 0, temp: 'ok', current: 0 },
                z: { status: 'unknown', sg: 0, temp: 'ok', current: 0 }
            };
        }
        
        // Parse axis-based TMC status: [TMC status: X=ok Y=otpw Z=ok]
        const statusMatch = line.match(/\[TMC status:\s*X=([\w]+)\s*Y=([\w]+)\s*Z=([\w]+)\]/);
        if (statusMatch) {
            this.tmcStatus.x.temp = statusMatch[1];
            this.tmcStatus.y.temp = statusMatch[2];
            this.tmcStatus.z.temp = statusMatch[3];
            
            // Notify UI of status change
            if (this.onTmcStatus) {
                this.onTmcStatus(this.tmcStatus);
            }
        }
        
        // Parse driver write message for detailed info
        if (id >= 0) {
            const axis = ['x', 'y', 'z'][id] || 'x';
            this.tmcStatus[axis] = this.tmcStatus[axis] || {};
            this.tmcStatus[axis].lastMessage = line;
            this.tmcStatus[axis].timestamp = Date.now();
            
            // Parse address and data for specific registers
            const addrMatch = line.match(/addr=0x([\da-fA-F]+)/);
            const dataMatch = line.match(/data=0x([\da-fA-F]+)/);
            if (addrMatch && dataMatch) {
                const addr = parseInt(addrMatch[1], 16);
                const data = parseInt(dataMatch[1], 16);
                
                // CHOPCONF (0x6C) - microstep info
                if (addr === 0x6C) {
                    const mres = (data >> 24) & 0x0F;
                    this.tmcStatus[axis].microsteps = 256 >> mres;
                }
                // IHOLD_IRUN (0x10) - current settings
                else if (addr === 0x10) {
                    this.tmcStatus[axis].irun = (data >> 8) & 0x1F;
                    this.tmcStatus[axis].ihold = data & 0x1F;
                }
                // DRV_STATUS (0x6F) - driver status
                else if (addr === 0x6F) {
                    this.tmcStatus[axis].stallguard = (data >> 10) & 0x3FF;
                    this.tmcStatus[axis].ot = !!(data & (1 << 25));
                    this.tmcStatus[axis].otpw = !!(data & (1 << 26));
                }
            }
        }
        
        // Check for thermal warnings
        if (line.includes('otpw') || line.includes('ot')) {
            const warningType = line.includes(' ot ') || line.includes('=ot') ? 'OVERTEMP' : 'Pre-warning';
            if (this.onMessage) {
                this.onMessage({ 
                    type: 'warning', 
                    text: `⚠️ TMC Driver ${id >= 0 ? ['X','Y','Z'][id] : ''} thermal ${warningType}!` 
                });
            }
        }
        
        // Check for short circuit warnings
        if (line.includes('s2g') || line.includes('s2vs')) {
            if (this.onMessage) {
                this.onMessage({ 
                    type: 'error', 
                    text: `🔥 TMC Driver ${id >= 0 ? ['X','Y','Z'][id] : ''} short circuit detected!` 
                });
            }
        }
    }
    
    _parseGrblStatus(status) {
        // Update latency tracking
        this._updateLatency();
        
        // <Idle|MPos:0.000,0.000,0.000|Bf:100,1024|FS:0,0|Pn:P|Ov:100,100,100|SG:x,y,z>
        const content = status.slice(1, -1);
        const parts = content.split('|');
        
        // State
        this.machineState = parts[0];
        
        // StallGuard data for Smart Machine
        let sgData = null;
        
        // Limit switch / input pins
        let limitPins = { x: false, y: false, z: false, probe: false, door: false };
        
        // Parse fields
        for (let i = 1; i < parts.length; i++) {
            const [key, val] = parts[i].split(':');
            
            if (key === 'MPos' || key === 'WPos') {
                const coords = val.split(',').map(parseFloat);
                this.machinePos = { x: coords[0], y: coords[1], z: coords[2] };
            }
            else if (key === 'FS') {
                const fs = val.split(',').map(parseFloat);
                const newRPM = fs[1] || 0;
                
                // Forward spindle RPM to chatter detector if changed significantly
                if (Math.abs(newRPM - this.spindleRPM) > 100) {
                    this.sendChatter(`RPM:${newRPM}`);
                }
                this.spindleRPM = newRPM;
            }
            else if (key === 'Ov') {
                const ov = val.split(',').map(parseInt);
                this.feedOverride = ov[0];
                this.rapidOverride = ov[1] || 100;
                this.spindleOverride = ov[2] || 100;
            }
            // Pin states: Pn:XYZPDHRS (X/Y/Z limits, Probe, Door, Hold, Reset, Start)
            else if (key === 'Pn') {
                limitPins.x = val.includes('X');
                limitPins.y = val.includes('Y');
                limitPins.z = val.includes('Z');
                limitPins.probe = val.includes('P');
                limitPins.door = val.includes('D');
                limitPins.hold = val.includes('H');
                limitPins.reset = val.includes('R');
                limitPins.start = val.includes('S');
            }
            // TMC2209 StallGuard data (grblHAL extended status)
            else if (key === 'SG') {
                // Format: SG:x,y,z (StallGuard values per axis)
                const sg = val.split(',').map(parseInt);
                sgData = { x: sg[0], y: sg[1], z: sg[2] };
                
                // Forward to chatter detector ESP32 for multi-sensor fusion
                for (let axis = 0; axis < sg.length; axis++) {
                    this.sendChatter(`SG:${axis},${sg[axis]}`);
                }
            }
            // Work coordinate offset (to calculate WPos from MPos)
            else if (key === 'WCO') {
                const wco = val.split(',').map(parseFloat);
                this.workOffset = { x: wco[0], y: wco[1], z: wco[2] };
            }
            // Active WCS (G54-G59)
            else if (key === 'WCS') {
                this.activeWCS = val;  // e.g., "G54"
            }
            // TMC driver status (temperature, errors)
            else if (key === 'TMC') {
                // Format: TMC:flags (otpw, ot, s2ga, s2gb, etc)
                // Parse as needed for thermal management
            }
            // Accessory state (spindle, coolant)
            else if (key === 'A') {
                this.accessories = {
                    spindle: val.includes('S') || val.includes('C'),  // CW or CCW
                    spindleCCW: val.includes('C'),
                    flood: val.includes('F'),
                    mist: val.includes('M')
                };
            }
        }
        
        // Calculate work position from machine position and offset
        let workPos = this.machinePos;
        if (this.workOffset) {
            workPos = {
                x: this.machinePos.x - this.workOffset.x,
                y: this.machinePos.y - this.workOffset.y,
                z: this.machinePos.z - this.workOffset.z
            };
        }
        
        if (this.onGrblStatus) {
            this.onGrblStatus({
                state: this.machineState,
                pos: this.machinePos,
                wpos: workPos,
                wco: this.workOffset,
                wcs: this.activeWCS || 'G54',
                feedOverride: this.feedOverride,
                spindleRPM: this.spindleRPM,
                sg: sgData,  // Pass StallGuard to Smart Machine
                pins: limitPins,  // Pass limit switch states
                accessories: this.accessories,
                overrides: {
                    feed: this.feedOverride,
                    rapid: this.rapidOverride,
                    spindle: this.spindleOverride
                },
                connection: {
                    latency: this.latency || 0,
                    rxRate: this.rxRate || 0
                }
            });
        }
    }
    
    _startGrblPolling() {
        if (this._grblPollInterval) {
            clearInterval(this._grblPollInterval);
        }
        
        // Track latency
        this._lastStatusRequestTime = 0;
        this._latencyHistory = [];
        this._rxCount = 0;
        this._lastRxCountTime = Date.now();
        
        this._grblPollInterval = setInterval(() => {
            if (this.grblConnected) {
                this._lastStatusRequestTime = Date.now();
                this.sendGrbl('?');
            }
        }, 200);  // 5Hz status polling
    }
    
    /**
     * Update latency tracking when status response received
     */
    _updateLatency() {
        if (this._lastStatusRequestTime > 0) {
            const latency = Date.now() - this._lastStatusRequestTime;
            this._latencyHistory.push(latency);
            
            // Keep last 20 samples
            if (this._latencyHistory.length > 20) {
                this._latencyHistory.shift();
            }
            
            // Calculate average
            this.latency = Math.round(
                this._latencyHistory.reduce((a, b) => a + b, 0) / this._latencyHistory.length
            );
        }
        
        // Track RX rate (messages per second)
        this._rxCount++;
        const now = Date.now();
        const elapsed = now - this._lastRxCountTime;
        if (elapsed >= 1000) {
            this.rxRate = Math.round(this._rxCount * 1000 / elapsed);
            this._rxCount = 0;
            this._lastRxCountTime = now;
        }
    }
    
    /**
     * Get connection health metrics
     */
    getConnectionHealth() {
        return {
            latency: this.latency || 0,
            rxRate: this.rxRate || 0,
            grblConnected: this.grblConnected,
            vfdConnected: this.vfdConnected,
            chatterConnected: this.chatterConnected
        };
    }
    
    /**
     * Get human-readable info for grblHAL error codes
     */
    _getGrblErrorInfo(code) {
        const errors = {
            1: { msg: 'G-code word missing letter', fix: 'Check G-code syntax' },
            2: { msg: 'Numeric value format invalid', fix: 'Check number formatting' },
            3: { msg: '$$ system command not recognized', fix: 'Use valid $ command' },
            4: { msg: 'Negative value not allowed', fix: 'Use positive value' },
            5: { msg: 'Homing cycle not enabled', fix: 'Enable homing with $22=1' },
            6: { msg: 'Step pulse too short', fix: 'Increase $0 (step pulse µs)' },
            7: { msg: 'EEPROM read failed', fix: 'Reset settings with $RST=$' },
            8: { msg: '$X unlock command required', fix: 'Send $X to unlock' },
            9: { msg: 'G-code locked - alarm active', fix: 'Clear alarm with $X or home' },
            10: { msg: 'Soft limits require homing', fix: 'Home machine first ($H)' },
            11: { msg: 'Line too long (>80 chars)', fix: 'Shorten G-code line' },
            12: { msg: 'Max step rate exceeded', fix: 'Reduce feed rate or acceleration' },
            13: { msg: 'Check door ajar', fix: 'Close safety door' },
            14: { msg: 'Startup line > 80 chars', fix: 'Shorten startup line' },
            15: { msg: 'Max travel exceeded', fix: 'Check machine limits ($130-132)' },
            16: { msg: 'Invalid jog command', fix: 'Check jog syntax' },
            17: { msg: 'Laser mode requires PWM', fix: 'Configure spindle for laser' },
            20: { msg: 'Unsupported G-code command', fix: 'Check G-code compatibility' },
            21: { msg: 'Multiple G-codes on same line conflict', fix: 'Split commands' },
            22: { msg: 'Feed rate missing for G1/G2/G3', fix: 'Add F word' },
            23: { msg: 'G-code requires integer value', fix: 'Use integer not decimal' },
            24: { msg: 'G-code requires 2+ axis words', fix: 'Add axis coordinates' },
            25: { msg: 'G-code repeated in block', fix: 'Remove duplicate G-code' },
            26: { msg: 'G-code requires axis words', fix: 'Add X, Y, or Z' },
            27: { msg: 'Line number value invalid', fix: 'Check N word value' },
            28: { msg: 'G-code missing required value', fix: 'Add missing parameter' },
            29: { msg: 'G59.x WCS not supported', fix: 'Use G54-G59' },
            30: { msg: 'G53 requires G0 or G1', fix: 'Add G0 or G1' },
            31: { msg: 'Extra axis words in block', fix: 'Remove extra axis words' },
            32: { msg: 'No axis words in block', fix: 'Add axis coordinates' },
            33: { msg: 'Invalid target for arc', fix: 'Check arc parameters' },
            34: { msg: 'Arc radius too small', fix: 'Increase arc radius' },
            35: { msg: 'G2/G3 arc requires endpoint', fix: 'Add arc endpoint' },
            36: { msg: 'Unused value in block', fix: 'Remove extra words' },
            37: { msg: 'Tool length offset not assigned', fix: 'Set tool offset first' },
            38: { msg: 'Tool number > max (100)', fix: 'Use tool number 1-100' },
            39: { msg: 'P value out of range', fix: 'Check P parameter' },
            40: { msg: 'Invalid value for param', fix: 'Check parameter value' },
            60: { msg: 'SD card not found', fix: 'Insert SD card' },
            61: { msg: 'SD card read failed', fix: 'Check SD card' },
            62: { msg: 'SD card write failed', fix: 'Check SD card space' },
            63: { msg: 'SD card file not found', fix: 'Check filename' },
            70: { msg: 'Bluetooth pairing failed', fix: 'Re-pair device' },
            71: { msg: 'WiFi connection failed', fix: 'Check WiFi settings' }
        };
        return errors[code] || { msg: `Unknown error ${code}`, fix: 'Check grblHAL docs' };
    }
    
    _handleGrblDisconnect() {
        const wasConnected = this.grblConnected;
        this.grblConnected = false;
        
        if (this._grblPollInterval) {
            clearInterval(this._grblPollInterval);
            this._grblPollInterval = null;
        }
        
        this._notifyConnectionChange();
        
        // Auto-reconnect if was connected and auto-reconnect enabled
        if (wasConnected && this.autoReconnect && this.grblPort) {
            this._scheduleReconnect('grbl');
        }
    }
    
    _scheduleReconnect(deviceType) {
        // Clear any existing reconnect timer
        if (this._reconnectTimers[deviceType]) {
            clearTimeout(this._reconnectTimers[deviceType]);
        }
        
        // Check attempts
        const attempts = this.reconnectAttempts;
        if (attempts >= this.maxReconnectAttempts) {
            console.log(`Max reconnect attempts reached for ${deviceType}`);
            if (this.onReconnecting) {
                this.onReconnecting({ device: deviceType, status: 'failed', attempts });
            }
            return;
        }
        
        // Notify reconnecting
        if (this.onReconnecting) {
            this.onReconnecting({ device: deviceType, status: 'reconnecting', attempts: attempts + 1 });
        }
        
        // Exponential backoff
        const delay = this.reconnectDelay * Math.pow(1.5, attempts);
        console.log(`Scheduling ${deviceType} reconnect in ${delay}ms (attempt ${attempts + 1})`);
        
        this._reconnectTimers[deviceType] = setTimeout(async () => {
            this.reconnectAttempts++;
            try {
                if (deviceType === 'grbl' && this.grblPort) {
                    await this._connectPortAsGrbl(this.grblPort);
                    this.reconnectAttempts = 0;
                    if (this.onReconnecting) {
                        this.onReconnecting({ device: 'grbl', status: 'connected' });
                    }
                } else if (deviceType === 'vfd' && this.vfdPort) {
                    await this._connectPortAsVfd(this.vfdPort);
                    this.reconnectAttempts = 0;
                    if (this.onReconnecting) {
                        this.onReconnecting({ device: 'vfd', status: 'connected' });
                    }
                } else if (deviceType === 'chatter' && this.chatterPort) {
                    await this._connectPortAsChatter(this.chatterPort);
                    this.reconnectAttempts = 0;
                    if (this.onReconnecting) {
                        this.onReconnecting({ device: 'chatter', status: 'connected' });
                    }
                }
            } catch (err) {
                console.error(`${deviceType} reconnect failed:`, err);
                this._scheduleReconnect(deviceType);
            }
        }, delay);
    }
    
    // ========================================================================
    // CHATTER DETECT COMMUNICATION
    // ========================================================================
    
    async sendChatter(command) {
        if (!this.chatterConnected || !this.chatterWriter) return;
        
        try {
            await this.chatterWriter.write(command + '\n');
        } catch (err) {
            console.error('ChatterDetect send error:', err);
            this._handleChatterDisconnect();
        }
    }
    
    async _readChatterLoop() {
        try {
            while (this.chatterConnected && this.chatterReader) {
                const { value, done } = await this.chatterReader.read();
                if (done) break;
                
                this.chatterBuffer += value;
                this._processChatterBuffer();
            }
        } catch (err) {
            if (err.name !== 'NetworkError') {
                console.error('ChatterDetect read error:', err);
            }
            this._handleChatterDisconnect();
        }
    }
    
    _processChatterBuffer() {
        const lines = this.chatterBuffer.split('\n');
        this.chatterBuffer = lines.pop() || '';
        
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || !trimmed.startsWith('{')) continue;
            
            try {
                const data = JSON.parse(trimmed);
                this._handleChatterData(data);
            } catch (e) {
                // Ignore parse errors
            }
        }
    }
    
    _handleChatterData(data) {
        // Handle new Waveshare ESP32-S3 ADAPTIVE format v4.0:
        // {"chatter":{"state":"ok","score":15.3,"freq":1200,"vib":0.045,"conf":85,"cal":100,"learned":5,"feed":80}}
        if (data.chatter && typeof data.chatter === 'object') {
            const c = data.chatter;
            this.sensorData.combined = c.score / 100;  // Normalize 0-100 to 0-1
            this.sensorData.audio = c.score / 100;     // Use combined score for audio
            this.sensorData.accel = c.vib || 0;        // Vibration in g
            this.sensorData.freq = c.freq || 0;        // Dominant frequency
            this.sensorData.chatter = (c.state === 'chatter');
            this.sensorData.warning = (c.state === 'warning');
            this.sensorData.state = c.state;
            
            // NEW: Adaptive learning data
            this.sensorData.confidence = c.conf || 0;       // Confidence 0-100
            this.sensorData.calibration = c.cal || 0;       // Calibration progress 0-100
            this.sensorData.learnedEvents = c.learned || 0; // Number of learned chatter events
            this.sensorData.suggestedFeed = c.feed || 100;  // AI-suggested feed %
            this.sensorData.isCalibrating = (c.state === 'calibrating');
            this.sensorData.isRecovering = (c.state === 'recovering');
        } 
        // Handle legacy format
        else {
            if (data.audio !== undefined) this.sensorData.audio = data.audio;
            if (data.accel !== undefined) this.sensorData.accel = data.accel;
            if (data.current !== undefined) this.sensorData.current = data.current;
            if (data.combined !== undefined) this.sensorData.combined = data.combined;
            if (data.chatter !== undefined) this.sensorData.chatter = data.chatter;
            if (data.vfd !== undefined) this.sensorData.vfd = data.vfd;
            if (data.threshold !== undefined) this.chatterThreshold = data.threshold;
        }
        
        // Auto feed reduction - now uses AI-suggested feed if available
        if (this.autoFeedEnabled && this.grblConnected) {
            this._autoAdjustFeed(this.sensorData);
        }
        
        // Notify UI
        if (this.onChatterData) {
            this.onChatterData(this.sensorData);
        }
    }
    
    _autoAdjustFeed(sensorData) {
        const now = Date.now();
        const chatterDetected = sensorData.chatter;
        
        if (chatterDetected) {
            this.lastChatterTime = now;
            this.recovering = false;
            
            // Use AI-suggested feed if available, otherwise fall back to step reduction
            if (sensorData.suggestedFeed && sensorData.suggestedFeed < 100) {
                const targetFeed = Math.max(this.minFeed, sensorData.suggestedFeed);
                if (this.feedOverride > targetFeed) {
                    this.setFeedOverride(targetFeed);
                    // Tell ESP32 what feed we're using (for learning)
                    this.sendChatter(`FEED:${targetFeed}`);
                }
            } else if (this.feedOverride > this.minFeed) {
                const newFeed = Math.max(this.minFeed, this.feedOverride - this.feedStep);
                this.setFeedOverride(newFeed);
                this.sendChatter(`FEED:${newFeed}`);
            }
        } else if (sensorData.isRecovering && this.feedOverride < 100) {
            // Recovery: slowly increase feed after chatter resolved
            if (now - this.lastChatterTime > 3000) {
                this.recovering = true;
                const newFeed = Math.min(100, this.feedOverride + 2);
                this.setFeedOverride(newFeed);
                
                // Tell ESP32 that chatter was resolved (for learning!)
                if (this.feedOverride < 95) {
                    this.sendChatter('RESOLVED');
                }
            }
        } else if (this.feedOverride < 100) {
            // Normal recovery
            if (now - this.lastChatterTime > 2000) {
                this.recovering = true;
                const newFeed = Math.min(100, this.feedOverride + 2);
                this.setFeedOverride(newFeed);
            }
        }
    }
    
    _handleChatterDisconnect() {
        const wasConnected = this.chatterConnected;
        this.chatterConnected = false;
        this._notifyConnectionChange();
        
        // Auto-reconnect
        if (wasConnected && this.autoReconnect && this.chatterPort) {
            this._scheduleReconnect('chatter');
        }
    }
    
    // ========================================================================
    // VFD COMMUNICATION
    // ========================================================================
    
    async sendVfd(command) {
        if (!this.vfdConnected || !this.vfdWriter) return;
        
        try {
            if (!command.endsWith('\n')) {
                command += '\n';
            }
            await this.vfdWriter.write(command);
        } catch (err) {
            console.error('VFD send error:', err);
            this._handleVfdDisconnect();
        }
    }
    
    async _readVfdLoop() {
        try {
            while (this.vfdConnected && this.vfdReader) {
                const { value, done } = await this.vfdReader.read();
                if (done) break;
                
                this.vfdBuffer += value;
                
                // Process complete lines
                let newlineIdx;
                while ((newlineIdx = this.vfdBuffer.indexOf('\n')) !== -1) {
                    const line = this.vfdBuffer.slice(0, newlineIdx).trim();
                    this.vfdBuffer = this.vfdBuffer.slice(newlineIdx + 1);
                    
                    if (line) {
                        this._processVfdLine(line);
                    }
                }
            }
        } catch (err) {
            if (err.name !== 'NetworkError') {
                console.error('VFD read error:', err);
            }
            this._handleVfdDisconnect();
        }
    }
    
    _processVfdLine(line) {
        // VFD ESP32 outputs JSON status or simple responses
        if (line.startsWith('{')) {
            try {
                const data = JSON.parse(line);
                this._updateVfdStatus(data);
            } catch (e) {
                console.log('VFD:', line);
            }
        } else if (line.startsWith('OK') || line.startsWith('ERROR')) {
            console.log('VFD:', line);
        } else if (line.includes('=')) {
            // Parse key=value format
            console.log('VFD:', line);
        }
    }
    
    _updateVfdStatus(data) {
        // ESP32 VFD Controller wraps status in "vfd" object
        const vfd = data.vfd || data;
        
        // Update status from JSON
        if (vfd.online !== undefined) this.vfdStatus.online = vfd.online;
        if (vfd.running !== undefined) this.vfdStatus.running = vfd.running;
        if (vfd.direction !== undefined) this.vfdStatus.forward = (vfd.direction === 'FWD');
        if (vfd.fault !== undefined) this.vfdStatus.fault = vfd.fault;
        if (vfd.faultCode !== undefined) this.vfdStatus.faultCode = vfd.faultCode;
        if (vfd.setFreqHz !== undefined) this.vfdStatus.setFreqHz = vfd.setFreqHz;
        if (vfd.actualFreqHz !== undefined) this.vfdStatus.actualFreqHz = vfd.actualFreqHz;
        if (vfd.setRpm !== undefined) this.vfdStatus.setRPM = vfd.setRpm;
        if (vfd.actualRpm !== undefined) this.vfdStatus.actualRPM = vfd.actualRpm;
        if (vfd.outputAmps !== undefined) this.vfdStatus.outputAmps = vfd.outputAmps;
        if (vfd.outputVolts !== undefined) this.vfdStatus.outputVolts = vfd.outputVolts;
        if (vfd.dcBusVolts !== undefined) this.vfdStatus.dcBusVolts = vfd.dcBusVolts;
        if (vfd.vfdTempC !== undefined) this.vfdStatus.temperature = vfd.vfdTempC;
        if (vfd.motorTempC !== undefined) this.vfdStatus.motorTemp = vfd.motorTempC;
        if (vfd.loadPercent !== undefined) this.vfdStatus.loadPercent = vfd.loadPercent;
        
        // Update spindle RPM from VFD actual RPM
        if (vfd.actualRpm !== undefined) {
            this.spindleRPM = vfd.actualRpm;
        }
        
        // Notify UI
        if (this.onVfdStatus) {
            this.onVfdStatus(this.vfdStatus);
        }
    }
    
    _startVfdPolling() {
        if (this._vfdPollInterval) {
            clearInterval(this._vfdPollInterval);
        }
        this._vfdPollInterval = setInterval(() => {
            if (this.vfdConnected) {
                this.sendVfd('STATUS');
            }
        }, 500);  // 2Hz status polling
    }
    
    _handleVfdDisconnect() {
        const wasConnected = this.vfdConnected;
        this.vfdConnected = false;
        if (this._vfdPollInterval) {
            clearInterval(this._vfdPollInterval);
            this._vfdPollInterval = null;
        }
        this._notifyConnectionChange();
        
        // Auto-reconnect
        if (wasConnected && this.autoReconnect && this.vfdPort) {
            this._scheduleReconnect('vfd');
        }
    }
    
    // VFD Control methods
    async setSpindleRPM(rpm) {
        await this.sendVfd(`RPM:${rpm}`);
    }
    
    async spindleForward(rpm) {
        if (rpm !== undefined) {
            await this.sendVfd(`RPM:${rpm}`);
            await this._delay(50);
        }
        await this.sendVfd('FWD');
    }
    
    async spindleReverse(rpm) {
        if (rpm !== undefined) {
            await this.sendVfd(`RPM:${rpm}`);
            await this._delay(50);
        }
        await this.sendVfd('REV');
    }
    
    async spindleStop() {
        await this.sendVfd('STOP');
    }
    
    async setVfdConfig(key, value) {
        await this.sendVfd(`${key}:${value}`);
    }

    // ========================================================================
    // CONTROL METHODS
    // ========================================================================
    
    async setFeedOverride(percent) {
        if (!this.grblConnected) return;
        
        // grblHAL feed override: 0x90 = 100%, 0x91 = +10%, 0x92 = -10%, 0x93 = +1%, 0x94 = -1%
        const current = this.feedOverride;
        const diff = percent - current;
        
        if (diff > 0) {
            // Increase
            const tens = Math.floor(diff / 10);
            const ones = diff % 10;
            for (let i = 0; i < tens; i++) await this.sendGrbl('\x91');
            for (let i = 0; i < ones; i++) await this.sendGrbl('\x93');
        } else if (diff < 0) {
            // Decrease
            const tens = Math.floor(Math.abs(diff) / 10);
            const ones = Math.abs(diff) % 10;
            for (let i = 0; i < tens; i++) await this.sendGrbl('\x92');
            for (let i = 0; i < ones; i++) await this.sendGrbl('\x94');
        }
    }
    
    async resetFeedOverride() {
        await this.sendGrbl('\x90');  // Reset to 100%
    }
    
    async calibrateChatter() {
        await this.sendChatter('CAL');
    }
    
    async enableChatter(enabled) {
        this.chatterEnabled = enabled;
        await this.sendChatter(enabled ? 'ON' : 'OFF');
    }
    
    async setChatterThreshold(threshold) {
        this.chatterThreshold = threshold;
        await this.sendChatter(`THR:${threshold}`);
    }
    
    async setMaterial(material) {
        await this.sendChatter(`MAT:${material}`);
    }
    
    // Machine control
    async unlock() {
        await this.sendGrbl('$X');
    }
    
    async home() {
        this.homingInProgress = true;
        await this.sendGrbl('$H');
    }
    
    async homeAxis(axis) {
        // Home single axis (grblHAL extended)
        this.homingInProgress = true;
        await this.sendGrbl(`$H${axis.toUpperCase()}`);
    }
    
    async reset() {
        await this.sendGrbl('\x18');
    }
    
    async softReset() {
        // Ctrl+X soft reset
        if (this.grblWriter) {
            await this.grblWriter.write('\x18');
        }
    }
    
    async hold() {
        await this.sendGrbl('!');
    }
    
    async resume() {
        await this.sendGrbl('~');
    }
    
    /**
     * Move to safe Z height first, then move XY
     */
    async safeGotoXY(x, y) {
        // First raise Z to safe height
        await this.sendGrbl(`G91 G0 Z${this.safeZ}`);
        await this._delay(100);
        // Switch back to absolute and move XY
        await this.sendGrbl('G90');
        await this.sendGrbl(`G0 X${x} Y${y}`);
    }
    
    /**
     * Go to machine zero safely (Z first, then XY)
     */
    async gotoMachineZero() {
        // Raise Z first in machine coordinates
        await this.sendGrbl('G53 G0 Z0');
        await this._delay(500);
        // Then move XY
        await this.sendGrbl('G53 G0 X0 Y0');
    }
    
    /**
     * Go to work zero safely (Z first, then XY)
     */
    async gotoWorkZero() {
        // Raise Z a bit first
        await this.sendGrbl(`G91 G0 Z${this.safeZ}`);
        await this._delay(100);
        await this.sendGrbl('G90');
        await this.sendGrbl('G0 X0 Y0');
    }
    
    /**
     * Retract Z to safe height
     */
    async retractZ() {
        await this.sendGrbl(`G91 G0 Z${this.safeZ}`);
        await this.sendGrbl('G90');
    }
    
    /**
     * Probe Z (simple touch-off)
     */
    async probeZ(feedRate = 100, retract = 2) {
        await this.sendGrbl(`G38.2 Z-50 F${feedRate}`);
        await this._delay(100);
        // Retract slightly after probe
        await this.sendGrbl(`G91 G0 Z${retract}`);
        await this.sendGrbl('G90');
    }
    
    async sendGcode(gcode) {
        const lines = gcode.split('\n');
        for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed && !trimmed.startsWith(';') && !trimmed.startsWith('(')) {
                await this.sendGrbl(trimmed);
                await this._delay(5);  // Small delay between lines
            }
        }
    }
    
    // ========================================================================
    // UTILITY
    // ========================================================================
    
    _delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
    
    _notifyConnectionChange() {
        if (this.onConnectionChange) {
            this.onConnectionChange({
                grbl: this.grblConnected,
                chatter: this.chatterConnected,
                vfd: this.vfdConnected
            });
        }
    }
    
    isConnected() {
        return this.grblConnected;
    }
    
    isChatterConnected() {
        return this.chatterConnected;
    }
    
    isVfdConnected() {
        return this.vfdConnected;
    }
    
    getStatus() {
        return {
            grbl: {
                connected: this.grblConnected,
                state: this.machineState,
                pos: this.machinePos,
                feedOverride: this.feedOverride,
                spindleRPM: this.spindleRPM
            },
            chatter: {
                connected: this.chatterConnected,
                enabled: this.chatterEnabled,
                threshold: this.chatterThreshold,
                ...this.sensorData
            },
            vfd: {
                connected: this.vfdConnected,
                ...this.vfdStatus
            }
        };
    }
}

// Export for use
window.DualSerialManager = DualSerialManager;
