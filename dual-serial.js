/**
 * Dual USB Serial Manager for FluidCNC
 * 
 * Connects to:
 * - grblHAL (Octopus Pro) - CNC motion control
 * - ChatterDetect (ESP32) - Sensor data
 * 
 * Both via WebSerial USB - no WiFi needed!
 */

class DualSerialManager {
    constructor() {
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
        this.onChatterData = null;
        this.onConnectionChange = null;
        this.onError = null;
        
        // Auto feed reduction
        this.autoFeedEnabled = true;
        this.minFeed = 30;
        this.feedStep = 10;
        this.recovering = false;
        this.lastChatterTime = 0;
    }
    
    // ========================================================================
    // CONNECTION MANAGEMENT
    // ========================================================================
    
    async connectGrbl() {
        if (!('serial' in navigator)) {
            throw new Error('WebSerial not supported. Use Chrome/Edge.');
        }
        
        try {
            this.grblPort = await navigator.serial.requestPort({
                filters: [
                    { usbVendorId: 0x0483 },  // STMicroelectronics
                ]
            });
            
            await this.grblPort.open({ baudRate: 115200 });
            
            // Setup streams
            const textDecoder = new TextDecoderStream();
            const readableStreamClosed = this.grblPort.readable.pipeTo(textDecoder.writable);
            this.grblReader = textDecoder.readable.getReader();
            
            const textEncoder = new TextEncoderStream();
            const writableStreamClosed = textEncoder.readable.pipeTo(this.grblPort.writable);
            this.grblWriter = textEncoder.writable.getWriter();
            
            // Enable DTR/RTS
            await this.grblPort.setSignals({ dataTerminalReady: true, requestToSend: true });
            
            this.grblConnected = true;
            this._notifyConnectionChange();
            
            // Start reading
            this._readGrblLoop();
            
            // Send soft reset and start status polling
            await this._delay(100);
            await this.sendGrbl('\x18');  // Ctrl+X soft reset
            await this._delay(500);
            this._startGrblPolling();
            
            console.log('✓ grblHAL connected');
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
            this.chatterPort = await navigator.serial.requestPort({
                filters: [
                    { usbVendorId: 0x10C4 },  // Silicon Labs (CP2102)
                    { usbVendorId: 0x1A86 },  // CH340
                    { usbVendorId: 0x0403 },  // FTDI
                    { usbVendorId: 0x303A },  // Espressif
                ]
            });
            
            await this.chatterPort.open({ baudRate: 115200 });
            
            // Setup streams
            const textDecoder = new TextDecoderStream();
            this.chatterPort.readable.pipeTo(textDecoder.writable);
            this.chatterReader = textDecoder.readable.getReader();
            
            const textEncoder = new TextEncoderStream();
            textEncoder.readable.pipeTo(this.chatterPort.writable);
            this.chatterWriter = textEncoder.writable.getWriter();
            
            this.chatterConnected = true;
            this._notifyConnectionChange();
            
            // Start reading
            this._readChatterLoop();
            
            // Request device info
            await this._delay(100);
            await this.sendChatter('INFO');
            
            console.log('✓ ChatterDetect connected');
            return true;
            
        } catch (err) {
            console.error('ChatterDetect connection failed:', err);
            this.chatterConnected = false;
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
            // Alarm
            else if (trimmed.startsWith('ALARM:')) {
                this.machineState = 'Alarm';
                if (this.onError) {
                    this.onError('grbl', trimmed);
                }
            }
            // Error
            else if (trimmed.startsWith('error:')) {
                if (this.onError) {
                    this.onError('grbl', trimmed);
                }
            }
        }
    }
    
    _parseGrblStatus(status) {
        // <Idle|MPos:0.000,0.000,0.000|Bf:100,1024|FS:0,0|Pn:P|Ov:100,100,100|SG:x,y,z>
        const content = status.slice(1, -1);
        const parts = content.split('|');
        
        // State
        this.machineState = parts[0];
        
        // StallGuard data for Smart Machine
        let sgData = null;
        
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
            // TMC driver status (temperature, errors)
            else if (key === 'TMC') {
                // Format: TMC:flags (otpw, ot, s2ga, s2gb, etc)
                // Parse as needed for thermal management
            }
        }
        
        if (this.onGrblStatus) {
            this.onGrblStatus({
                state: this.machineState,
                pos: this.machinePos,
                feedOverride: this.feedOverride,
                spindleRPM: this.spindleRPM,
                sg: sgData  // Pass StallGuard to Smart Machine
            });
        }
    }
    
    _startGrblPolling() {
        if (this._grblPollInterval) {
            clearInterval(this._grblPollInterval);
        }
        this._grblPollInterval = setInterval(() => {
            if (this.grblConnected) {
                this.sendGrbl('?');
            }
        }, 200);  // 5Hz status polling
    }
    
    _handleGrblDisconnect() {
        this.grblConnected = false;
        if (this._grblPollInterval) {
            clearInterval(this._grblPollInterval);
        }
        this._notifyConnectionChange();
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
        this.chatterConnected = false;
        this._notifyConnectionChange();
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
        await this.sendGrbl('$H');
    }
    
    async reset() {
        await this.sendGrbl('\x18');
    }
    
    async hold() {
        await this.sendGrbl('!');
    }
    
    async resume() {
        await this.sendGrbl('~');
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
                chatter: this.chatterConnected
            });
        }
    }
    
    isConnected() {
        return this.grblConnected;
    }
    
    isChatterConnected() {
        return this.chatterConnected;
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
            }
        };
    }
}

// Export for use
window.DualSerialManager = DualSerialManager;
