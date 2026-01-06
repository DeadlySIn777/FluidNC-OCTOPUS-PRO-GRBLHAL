/**
 * CNC Chatter Detection System - FluidCNC Web UI Module
 * Connects to ESP32 via WebSocket for real-time monitoring
 * Shows warning if not connected, but everything still works
 * 
 * INTELLIGENT FEATURES:
 * - Adaptive thresholds (learns your machine)
 * - Trend detection (catches rising chatter early)
 * - Hysteresis (prevents oscillation)
 * - Smart recovery (remembers stable feed rates)
 * - Multiple operating modes
 * - MATERIAL-AWARE: Different profiles for aluminum, steel, plastic, etc.
 * - Asks about material, tool, and operation BECAUSE IT MATTERS
 * - G-CODE INTEGRATION: Auto-detects from comments!
 * - PREDICTIVE WARNINGS: Knows when chatter is building
 */

class ChatterDetection {
    constructor(options = {}) {
        this.wsUrl = options.wsUrl || 'ws://192.168.1.100/ws';  // ESP32 IP
        this.ws = null;
        this.connected = false;
        this.reconnectInterval = 5000;
        this.reconnectTimer = null;
        this.pingInterval = null;
        
        // Materials list (populated from ESP32)
        this.materials = ['aluminum', 'steel', 'plastic', 'wood', 'brass', 'composite', 'copper'];
        this.operations = ['roughing', 'finishing', 'drilling', 'slotting'];
        
        // Audio alerts
        this.audioEnabled = localStorage.getItem('chatterAudioEnabled') !== 'false';
        this.audioContext = null;
        this.lastChatterAlert = 0;
        this.alertCooldown = 3000;  // Don't spam alerts
        
        // G-code integration
        this.gcodeParser = options.gcodeParser || null;
        this.autoDetectedSettings = null;
        
        // Prediction
        this.predictionHistory = [];
        this.predictionWindow = 10;  // Samples to analyze

        // Diagnostics UI
        this.diagModalOpen = false;
        
        // State (with intelligent features)
        this.state = {
            // Sensor scores
            audio: 0,
            accel: 0,
            current: 0,
            combined: 0,
            
            // EMA smoothed scores (new!)
            emaAudio: 0,
            emaAccel: 0,
            emaCurrent: 0,
            emaCombined: 0,
            
            // Current/power
            amps: 0,
            baseline: 2.0,
            freq: 0,
            toothFreq: 0,
            
            // Frequency bands (new!)
            lowBand: 0,
            midBand: 0,
            highBand: 0,
            
            // Harmonics (new!)
            harmonics: false,
            harmonicRatio: 0,
            
            // Feed control
            feed: 100,
            lastStable: 100,
            minFeed: 20,
            
            // Flags
            enabled: true,
            chatter: false,
            inChatterZone: false,
            toolBroken: false,
            overload: false,
            learning: false,
            calibrating: false,
            
            // Intelligence
            trend: 0,
            threshold: 0.55,
            noiseFloor: 0.05,
            recoveryAttempts: 0,
            stableCount: 0,
            mode: 0,
            
            // Advanced detection (new!)
            confidence: 0,
            variance: 0,
            delta: 0,
            predicted: 0,
            ticksToChatter: -1,
            risingChatter: false,
            stableChatter: false,
            intermittent: false,
            
            // Position (new!)
            posX: 0,
            posY: 0,
            posZ: 0,
            
            // Weights
            wAudio: 0.30,
            wAccel: 0.40,
            wCurrent: 0.30,
            
            // Material/tool info (MATTERS!)
            material: 'aluminum',
            materialIndex: 0,
            operation: 0,
            toolDia: 6.0,
            toolFlutes: 2,
            rpm: 10000,
            expectedAmpsLow: 1.5,
            expectedAmpsHigh: 6.0,
            
            // Spindle state
            spindleRunning: false,
            cutting: false,
            idleCurrent: 0.5,
            
            // Cutting efficiency (NEW!)
            efficiency: 0,
            bestFeed: 100,
            
            // Tool wear tracking (NEW!)
            toolWear: 0,           // Estimated wear 0-100%
            cumulativeLoad: 0,     // Sum of amps*time
            cuttingSeconds: 0,     // Total cutting time
            avgLoadCurrent: 0,     // Average load during cutting
            
            // Session statistics (NEW!)
            sessionStart: Date.now(),
            sessionChatterEvents: 0,
            sessionMaxScore: 0,
            sessionAvgScore: 0,
            sessionFeedReductions: 0,
            sessionRecoveries: 0,
            totalSamples: 0,
            
            // VFD telemetry (NEW! - from RS-485 Modbus)
            vfd: {
                ok: false,          // VFD Modbus connected
                run: false,         // Spindle running (from VFD)
                freq: 0,            // Output frequency (Hz)
                rpm: 0,             // Calculated RPM from VFD
                amps: 0,            // VFD output current (A)
                dcv: 0,             // DC bus voltage (V)
                fault: 0,           // Fault code (0 = none)
                faultStr: ''        // Human-readable fault
            },
            
            // Sensor health status (NEW!)
            sensors: {
                mpuOk: true,        // Accelerometer OK
                mpuErr: 0,          // Error code
                mpuErrStr: 'OK',    // Error string
                i2sOk: true,        // Microphone OK
                i2sErr: 0,
                i2sErrStr: 'OK',
                adcOk: true,        // Current sensor OK
                adcErr: 0,
                adcErrStr: 'OK',
                allOk: true         // All sensors OK
            }
        };
        
        // Tool wear tracking
        this._toolWearStart = null;
        this._lastCuttingCheck = Date.now();
        this._cuttingLoadSum = 0;
        this._cuttingLoadCount = 0;
        
        // Session tracking
        this._sessionScoreSum = 0;
        this._sessionScoreCount = 0;
        this._lastFeed = 100;
        this._sessionLastChatter = false;
        
        // Alert state tracking (for edge detection)
        this._lastInChatterZone = false;
        this._lastToolBroken = false;
        this._lastOverload = false;
        
        // Callbacks
        this.onUpdate = options.onUpdate || (() => {});
        this.onConnect = options.onConnect || (() => {});
        this.onDisconnect = options.onDisconnect || (() => {});
        this.onAlert = options.onAlert || (() => {});
        
        // History for graphs
        this.history = {
            combined: [],
            amps: [],
            feed: [],
            trend: [],
            maxLength: 200  // ~10 seconds at 20Hz
        };
        
        // Create UI
        this.createUI();
        
        // Load saved IP
        const savedIp = localStorage.getItem('chatterEspIp');
        if (savedIp) {
            this.wsUrl = `ws://${savedIp}/ws`;
            const ipInput = document.getElementById('chatter-ip');
            if (ipInput) ipInput.value = savedIp;
        }
        
        // Setup keyboard shortcuts
        this.setupKeyboardShortcuts();
        
        // Try to connect
        this.connect();
    }
    
    // Keyboard shortcuts for quick actions
    setupKeyboardShortcuts() {
        document.addEventListener('keydown', (e) => {
            // Only when not typing in an input
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
            
            // Alt+C: Toggle chatter panel visibility
            if (e.altKey && e.key === 'c') {
                e.preventDefault();
                this.togglePanel();
            }
            // Alt+E: Enable/disable detection
            else if (e.altKey && e.key === 'e') {
                e.preventDefault();
                this.toggle();
            }
            // Alt+D: Show diagnostics
            else if (e.altKey && e.key === 'd') {
                e.preventDefault();
                this.showDiagnostics();
            }
            // Alt+R: Reset alerts
            else if (e.altKey && e.key === 'r') {
                e.preventDefault();
                this.resetAlerts();
            }
            // Alt+T: Show recommendations (tips)
            else if (e.altKey && e.key === 't') {
                e.preventDefault();
                this.showRecommendations();
            }
            // Alt+L: Start learning
            else if (e.altKey && e.key === 'l') {
                e.preventDefault();
                this.startLearning();
            }
            // Alt+S: Save settings
            else if (e.altKey && e.key === 's') {
                e.preventDefault();
                this.save();
            }
            // Alt+M: Toggle compact mode
            else if (e.altKey && e.key === 'm') {
                e.preventDefault();
                this.toggleCompact();
            }
            // Alt+U: Start auto-tuning
            else if (e.altKey && e.key === 'u') {
                e.preventDefault();
                this.startAutoTuning();
            }
            // Alt+N: Reset tool (new tool)
            else if (e.altKey && e.key === 'n') {
                e.preventDefault();
                this.resetToolWear();
            }
            // Alt+1/2/3: Quick mode switch
            else if (e.altKey && e.key === '1') {
                e.preventDefault();
                this.setMode('auto');
            }
            else if (e.altKey && e.key === '2') {
                e.preventDefault();
                this.setMode('aggressive');
            }
            else if (e.altKey && e.key === '3') {
                e.preventDefault();
                this.setMode('conservative');
            }
            // Escape: Close any open modal
            else if (e.key === 'Escape') {
                const modal = document.querySelector('#chatter-diag-modal, #chatter-recommendations-modal, #chatter-material-modal, #chatter-tuning-modal');
                if (modal) modal.remove();
            }
        });
    }
    
    // Toggle panel visibility
    togglePanel() {
        if (!this.panel) return;
        const content = this.panel.querySelector('.chatter-content');
        if (content) {
            const isHidden = content.style.display === 'none';
            content.style.display = isHidden ? '' : 'none';
        }
    }
    
    connect() {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) return;
        
        try {
            this.ws = new WebSocket(this.wsUrl);
            
            this.ws.onopen = () => {
                console.log('[Chatter] Connected to ESP32');
                this.connected = true;
                this.hideWarning();
                this.onConnect();
                
                // Request full config
                this.send('getConfig');
                
                // Show setup wizard on first connect if not configured
                if (!localStorage.getItem('chatterConfigured')) {
                    setTimeout(() => {
                        this.showSetupWizard();
                        localStorage.setItem('chatterConfigured', 'true');
                    }, 500);
                }
                
                // Start ping interval
                this.pingInterval = setInterval(() => {
                    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                        this.ws.send('ping');
                    }
                }, 10000);
            };
            
            this.ws.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    if (data.pong) return;  // Ignore ping responses
                    
                    // Handle config message with material list
                    if (data.type === 'config') {
                        if (data.materials) this.materials = data.materials;
                        this.state.material = data.material || 'aluminum';
                        this.state.materialIndex = data.materialIndex || 0;
                        this.state.operation = data.operation || 0;
                        this.state.toolDia = data.toolDia || 6.0;
                        this.state.toolFlutes = data.toolFlutes || 2;
                        this.state.rpm = data.rpm || 10000;
                        this.updateMaterialUI();
                        console.log('[Chatter] Config received:', data);
                        return;
                    }

                    // Diagnostic / auxiliary message types (do not merge into state)
                    if (data.type === 'diagnostic' || data.type === 'spectrum' || data.type === 'stats' ||
                        data.type === 'chatterMap' || data.type === 'features' || data.type === 'analysis' ||
                        data.type === 'settings' || data.type === 'network') {
                        this.handleAuxMessage(data);
                        return;
                    }
                    
                    this.state = { ...this.state, ...data };
                    this.updateHistory();
                    this.updateUI();
                    this.checkAlerts();
                    this.onUpdate(this.state);
                } catch (e) {
                    console.error('[Chatter] Parse error:', e);
                }
            };
            
            this.ws.onclose = () => {
                console.log('[Chatter] Disconnected from ESP32');
                this.handleDisconnect();
            };
            
            this.ws.onerror = (error) => {
                console.error('[Chatter] WebSocket error:', error);
                this.handleDisconnect();
            };
            
        } catch (error) {
            console.error('[Chatter] Connection failed:', error);
            this.handleDisconnect();
        }
    }
    
    handleDisconnect() {
        this.connected = false;
        this.ws = null;
        
        if (this.pingInterval) {
            clearInterval(this.pingInterval);
            this.pingInterval = null;
        }
        
        this.showWarning();
        this.onDisconnect();
        
        // Schedule reconnect
        if (!this.reconnectTimer) {
            this.reconnectTimer = setTimeout(() => {
                this.reconnectTimer = null;
                this.connect();
            }, this.reconnectInterval);
        }
    }
    
    disconnect() {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        if (this.pingInterval) {
            clearInterval(this.pingInterval);
            this.pingInterval = null;
        }
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
        this.connected = false;
    }
    
    // ========== AUDIO ALERTS ==========
    
    initAudio() {
        if (!this.audioContext) {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        }
    }
    
    playBeep(frequency = 800, duration = 200, type = 'sine') {
        if (!this.audioEnabled) return;
        try {
            this.initAudio();
            const oscillator = this.audioContext.createOscillator();
            const gainNode = this.audioContext.createGain();
            oscillator.connect(gainNode);
            gainNode.connect(this.audioContext.destination);
            oscillator.type = type;
            oscillator.frequency.value = frequency;
            gainNode.gain.setValueAtTime(0.3, this.audioContext.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.01, this.audioContext.currentTime + duration / 1000);
            oscillator.start();
            oscillator.stop(this.audioContext.currentTime + duration / 1000);
        } catch (e) {
            console.warn('[Chatter] Audio alert failed:', e);
        }
    }
    
    playChatterWarning() {
        // Double beep for chatter
        this.playBeep(1000, 100);
        setTimeout(() => this.playBeep(1200, 100), 150);
    }
    
    playToolBreakAlert() {
        // Urgent alarm for tool break
        for (let i = 0; i < 5; i++) {
            setTimeout(() => this.playBeep(1500, 100, 'square'), i * 200);
        }
    }
    
    playOverloadAlert() {
        // Low warning tone
        this.playBeep(400, 500, 'sawtooth');
    }
    
    toggleAudio() {
        this.audioEnabled = !this.audioEnabled;
        localStorage.setItem('chatterAudioEnabled', this.audioEnabled);
        const btn = document.getElementById('chatter-audio-btn');
        if (btn) btn.textContent = this.audioEnabled ? '🔊 Audio' : '🔇 Muted';
        console.log(`[Chatter] Audio alerts ${this.audioEnabled ? 'enabled' : 'disabled'}`);
    }
    
    // ========== G-CODE INTEGRATION ==========
    // Auto-detect material, tool, and operation from G-code comments!
    
    parseGCodeForSettings(gcode) {
        const settings = {
            material: null,
            operation: null,
            toolDia: null,
            toolFlutes: null,
            rpm: null,
            feedRate: null
        };
        
        const lines = gcode.split('\n');
        
        // Material detection patterns
        const materialPatterns = {
            aluminum: /\b(aluminum|aluminium|alu|6061|7075|al)\b/i,
            steel: /\b(steel|stainless|ss|1018|4140|a36)\b/i,
            plastic: /\b(plastic|acrylic|delrin|pom|abs|pvc|hdpe|nylon)\b/i,
            wood: /\b(wood|mdf|plywood|oak|maple|birch|walnut)\b/i,
            brass: /\b(brass|bronze|360)\b/i,
            composite: /\b(composite|carbon|fiberglass|fr4|g10|pcb)\b/i,
            copper: /\b(copper|cu)\b/i
        };
        
        // Operation detection patterns
        const opPatterns = {
            roughing: /\b(rough|roughing|hogging|adaptive)\b/i,
            finishing: /\b(finish|finishing|contour|profile)\b/i,
            drilling: /\b(drill|drilling|pecking|bore|boring)\b/i,
            slotting: /\b(slot|slotting|pocket|pocketing)\b/i
        };
        
        // Tool patterns
        const toolDiaPattern = /(?:tool|endmill|bit|cutter)[^\n]*?(\d+(?:\.\d+)?)\s*(?:mm|in)?/i;
        const flutePattern = /(\d)\s*(?:flute|flutes|fl)/i;
        const rpmPattern = /S\s*(\d+)/i;
        const feedPattern = /F\s*(\d+)/i;
        
        for (const line of lines) {
            // Skip if not a comment
            const comment = line.match(/[;(](.+?)(?:\)|$)/);
            if (comment) {
                const text = comment[1];
                
                // Check materials
                for (const [mat, pattern] of Object.entries(materialPatterns)) {
                    if (pattern.test(text) && !settings.material) {
                        settings.material = mat;
                        console.log(`[Chatter] Auto-detected material: ${mat}`);
                    }
                }
                
                // Check operations
                for (const [op, pattern] of Object.entries(opPatterns)) {
                    if (pattern.test(text) && !settings.operation) {
                        settings.operation = op;
                        console.log(`[Chatter] Auto-detected operation: ${op}`);
                    }
                }
                
                // Check tool diameter
                const diaMatch = text.match(toolDiaPattern);
                if (diaMatch && !settings.toolDia) {
                    settings.toolDia = parseFloat(diaMatch[1]);
                    console.log(`[Chatter] Auto-detected tool diameter: ${settings.toolDia}mm`);
                }
                
                // Check flutes
                const fluteMatch = text.match(flutePattern);
                if (fluteMatch && !settings.toolFlutes) {
                    settings.toolFlutes = parseInt(fluteMatch[1]);
                    console.log(`[Chatter] Auto-detected flutes: ${settings.toolFlutes}`);
                }
            }
            
            // Check for spindle speed in actual G-code
            const sMatch = line.match(rpmPattern);
            if (sMatch && !settings.rpm) {
                settings.rpm = parseInt(sMatch[1]);
                if (settings.rpm > 1000) {  // Ignore S values < 1000 (might be something else)
                    console.log(`[Chatter] Auto-detected RPM: ${settings.rpm}`);
                } else {
                    settings.rpm = null;
                }
            }
        }
        
        return settings;
    }
    
    // Called when a G-code file is loaded
    onGCodeLoaded(gcode) {
        const detected = this.parseGCodeForSettings(gcode);
        this.autoDetectedSettings = detected;
        
        let changed = false;
        
        if (detected.material) {
            this.setMaterial(detected.material);
            changed = true;
        }
        
        if (detected.operation) {
            this.setOperation(detected.operation);
            changed = true;
        }
        
        if (detected.toolDia || detected.toolFlutes || detected.rpm) {
            this.setTool(
                detected.toolDia || this.state.toolDia,
                detected.toolFlutes || this.state.toolFlutes,
                detected.rpm || this.state.rpm
            );
            changed = true;
        }
        
        if (changed) {
            this.showNotification('Chatter detection auto-configured from G-code! ✓', 'success');
        }
    }
    
    showNotification(message, type = 'info') {
        const notif = document.createElement('div');
        notif.className = `chatter-notification chatter-notification-${type}`;
        notif.textContent = message;
        notif.style.cssText = `
            position: fixed;
            bottom: 80px;
            right: 20px;
            padding: 12px 20px;
            border-radius: 8px;
            background: ${type === 'success' ? '#2e7d32' : type === 'warning' ? '#f57c00' : '#1976d2'};
            color: white;
            font-family: system-ui;
            z-index: 100000;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
            animation: slideIn 0.3s ease;
        `;
        document.body.appendChild(notif);
        setTimeout(() => notif.remove(), 4000);
    }
    
    // ========== PREDICTIVE WARNINGS ==========
    
    updatePrediction() {
        // Add current combined score to prediction history
        this.predictionHistory.push({
            score: this.state.combined,
            trend: this.state.trend,
            timestamp: Date.now()
        });
        
        // Keep only recent samples
        if (this.predictionHistory.length > this.predictionWindow) {
            this.predictionHistory.shift();
        }
        
        // Need at least 5 samples to predict
        if (this.predictionHistory.length < 5) return null;
        
        // Calculate trend direction and acceleration
        const recent = this.predictionHistory.slice(-5);
        const scores = recent.map(p => p.score);
        const avgTrend = recent.reduce((a, p) => a + p.trend, 0) / recent.length;
        
        // Calculate acceleration (is it speeding up?)
        const firstHalf = scores.slice(0, 2).reduce((a, b) => a + b, 0) / 2;
        const secondHalf = scores.slice(-2).reduce((a, b) => a + b, 0) / 2;
        const acceleration = (secondHalf - firstHalf) / 3;  // Change per sample
        
        // Predict score in ~1 second (20 samples at 20Hz)
        const predictedScore = this.state.combined + (avgTrend * 20) + (acceleration * 20);
        
        // Return prediction
        return {
            predicted: predictedScore,
            timeToChatter: avgTrend > 0.005 
                ? Math.round((this.state.threshold - this.state.combined) / avgTrend / 20) 
                : null,
            willChatter: predictedScore > this.state.threshold && avgTrend > 0.005,
            confidence: Math.min(1, Math.abs(avgTrend) * 50)
        };
    }
    
    // Commands to ESP32
    enable() { this.send('enable'); }
    disable() { this.send('disable'); }
    calibrate() { this.send('calibrate'); }
    learn() { this.send('learn'); }
    resetAlerts() { this.send('reset'); }
    save() { this.send('save'); }
    autoCal() { this.send('autoCal'); }
    getStats() { this.send('stats'); }
    resetStats() { this.send('resetStats'); }
    setRPM(rpm) { this.send(`rpm:${rpm}`); }
    
    setMode(mode) {
        const modes = ['auto', 'aggressive', 'conservative'];
        if (modes.includes(mode)) {
            this.send(`mode:${mode}`);
        }
    }
    
    // MATERIAL SELECTION - BECAUSE IT MATTERS!
    setMaterial(material) {
        if (typeof material === 'number') {
            this.send(`materialIndex:${material}`);
            this.state.materialIndex = material;
            this.state.material = this.materials[material] || 'aluminum';
        } else {
            this.send(`material:${material}`);
            this.state.material = material;
            this.state.materialIndex = this.materials.indexOf(material);
        }
        this.updateMaterialUI();
    }
    
    // OPERATION TYPE - roughing vs finishing vs drilling
    setOperation(op) {
        const opNames = ['roughing', 'finishing', 'drilling', 'slotting'];
        if (typeof op === 'number') {
            this.send(`operation:${opNames[op]}`);
            this.state.operation = op;
        } else {
            this.send(`operation:${op}`);
            this.state.operation = opNames.indexOf(op);
        }
        this.updateMaterialUI();
    }
    
    // TOOL INFO - diameter, flutes, RPM affect chatter frequency!
    setTool(diameter, flutes, rpm) {
        this.state.toolDia = diameter;
        this.state.toolFlutes = flutes;
        this.state.rpm = rpm;
        this.send(`tool:${diameter},${flutes},${rpm}`);
        this.updateMaterialUI();
    }
    
    // Show the setup wizard - FIRST THING A USER SHOULD SEE
    showSetupWizard() {
        // Create setup modal
        const modal = document.createElement('div');
        modal.id = 'chatter-setup-modal';
        modal.innerHTML = `
            <style>
                #chatter-setup-modal {
                    position: fixed;
                    inset: 0;
                    background: rgba(0,0,0,0.85);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    z-index: 100000;
                    font-family: 'Segoe UI', system-ui, sans-serif;
                }
                .setup-dialog {
                    background: linear-gradient(145deg, #1a1a2e, #16213e);
                    border-radius: 16px;
                    width: 420px;
                    max-width: 95vw;
                    color: white;
                    box-shadow: 0 20px 60px rgba(0,0,0,0.5);
                }
                .setup-header {
                    padding: 24px 24px 12px;
                    text-align: center;
                }
                .setup-header h2 { margin: 0 0 8px; font-size: 22px; }
                .setup-header p { margin: 0; opacity: 0.7; font-size: 13px; }
                .setup-body { padding: 0 24px 24px; }
                .setup-section {
                    margin-bottom: 20px;
                }
                .setup-section label {
                    display: block;
                    font-size: 12px;
                    font-weight: 600;
                    margin-bottom: 8px;
                    text-transform: uppercase;
                    opacity: 0.8;
                }
                .setup-section label span {
                    font-weight: 400;
                    opacity: 0.6;
                    text-transform: none;
                }
                .material-grid {
                    display: grid;
                    grid-template-columns: repeat(4, 1fr);
                    gap: 8px;
                }
                .material-btn {
                    padding: 12px 8px;
                    border: 2px solid rgba(255,255,255,0.15);
                    border-radius: 10px;
                    background: rgba(255,255,255,0.05);
                    color: white;
                    font-size: 11px;
                    cursor: pointer;
                    transition: all 0.2s;
                    text-align: center;
                }
                .material-btn:hover { border-color: rgba(255,255,255,0.4); }
                .material-btn.active { 
                    border-color: #0066ff; 
                    background: rgba(0,102,255,0.2); 
                }
                .material-btn .icon { font-size: 20px; margin-bottom: 4px; display: block; }
                .operation-grid {
                    display: grid;
                    grid-template-columns: repeat(4, 1fr);
                    gap: 8px;
                }
                .op-btn {
                    padding: 10px 8px;
                    border: 2px solid rgba(255,255,255,0.15);
                    border-radius: 8px;
                    background: rgba(255,255,255,0.05);
                    color: white;
                    font-size: 11px;
                    cursor: pointer;
                    transition: all 0.2s;
                }
                .op-btn:hover { border-color: rgba(255,255,255,0.4); }
                .op-btn.active { border-color: #00cc66; background: rgba(0,204,102,0.2); }
                .tool-inputs {
                    display: grid;
                    grid-template-columns: repeat(3, 1fr);
                    gap: 12px;
                }
                .tool-input {
                    display: flex;
                    flex-direction: column;
                }
                .tool-input label { font-size: 10px; margin-bottom: 4px; opacity: 0.7; }
                .tool-input input {
                    padding: 10px;
                    border: 1px solid rgba(255,255,255,0.2);
                    border-radius: 6px;
                    background: rgba(255,255,255,0.05);
                    color: white;
                    font-size: 16px;
                    font-weight: 600;
                    text-align: center;
                }
                .tool-input input:focus { outline: none; border-color: #0066ff; }
                .setup-footer {
                    padding: 16px 24px;
                    background: rgba(255,255,255,0.05);
                    display: flex;
                    gap: 12px;
                }
                .setup-btn {
                    flex: 1;
                    padding: 14px;
                    border: none;
                    border-radius: 8px;
                    font-size: 14px;
                    font-weight: 600;
                    cursor: pointer;
                    transition: all 0.2s;
                }
                .setup-btn.primary { background: #0066ff; color: white; }
                .setup-btn.secondary { background: rgba(255,255,255,0.1); color: white; }
                .setup-btn:hover { transform: translateY(-1px); filter: brightness(1.1); }
                .setup-note {
                    margin-top: 16px;
                    padding: 12px;
                    background: rgba(255,200,0,0.1);
                    border-radius: 8px;
                    font-size: 11px;
                    color: #ffc800;
                    line-height: 1.5;
                }
            </style>
            <div class="setup-dialog">
                <div class="setup-header">
                    <h2>⚙️ Chatter Detection Setup</h2>
                    <p>These settings MATTER for accurate detection on your mini mill</p>
                </div>
                <div class="setup-body">
                    <div class="setup-section">
                        <label>What material are you cutting? <span>(affects chatter frequency)</span></label>
                        <div class="material-grid" id="setup-materials">
                            <button class="material-btn active" data-mat="0"><span class="icon">🔩</span>Aluminum</button>
                            <button class="material-btn" data-mat="1"><span class="icon">⚙️</span>Steel</button>
                            <button class="material-btn" data-mat="2"><span class="icon">🧊</span>Plastic</button>
                            <button class="material-btn" data-mat="3"><span class="icon">🪵</span>Wood</button>
                            <button class="material-btn" data-mat="4"><span class="icon">🥇</span>Brass</button>
                            <button class="material-btn" data-mat="5"><span class="icon">🧬</span>Composite</button>
                            <button class="material-btn" data-mat="6"><span class="icon">🔶</span>Copper</button>
                        </div>
                    </div>
                    
                    <div class="setup-section">
                        <label>What operation? <span>(roughing is noisier)</span></label>
                        <div class="operation-grid" id="setup-operations">
                            <button class="op-btn active" data-op="0">Roughing</button>
                            <button class="op-btn" data-op="1">Finishing</button>
                            <button class="op-btn" data-op="2">Drilling</button>
                            <button class="op-btn" data-op="3">Slotting</button>
                        </div>
                    </div>
                    
                    <div class="setup-section">
                        <label>Tool info <span>(tooth passing frequency = RPM × flutes ÷ 60)</span></label>
                        <div class="tool-inputs">
                            <div class="tool-input">
                                <label>Diameter (mm)</label>
                                <input type="number" id="setup-tool-dia" value="${this.state.toolDia}" step="0.5" min="0.5" max="25">
                            </div>
                            <div class="tool-input">
                                <label>Flutes</label>
                                <input type="number" id="setup-tool-flutes" value="${this.state.toolFlutes}" step="1" min="1" max="8">
                            </div>
                            <div class="tool-input">
                                <label>RPM</label>
                                <input type="number" id="setup-tool-rpm" value="${this.state.rpm}" step="500" min="1000" max="30000">
                            </div>
                        </div>
                    </div>
                    
                    <div class="setup-note">
                        💡 <strong>Why this matters:</strong> Mini mills have lower rigidity than industrial machines. 
                        Different materials chatter at different frequencies. Aluminum chatters high (1-3kHz), 
                        steel lower (200-800Hz). Tool diameter and flutes affect the tooth passing frequency, 
                        which we need to filter out from real chatter.
                    </div>
                </div>
                <div class="setup-footer">
                    <button class="setup-btn secondary" onclick="document.getElementById('chatter-setup-modal').remove()">Cancel</button>
                    <button class="setup-btn primary" id="setup-apply-btn">Apply Settings</button>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        
        // State for selections
        let selectedMat = this.state.materialIndex || 0;
        let selectedOp = this.state.operation || 0;
        
        // Material buttons
        const matBtns = modal.querySelectorAll('#setup-materials .material-btn');
        matBtns.forEach(btn => {
            if (parseInt(btn.dataset.mat) === selectedMat) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
            btn.onclick = () => {
                matBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                selectedMat = parseInt(btn.dataset.mat);
            };
        });
        
        // Operation buttons
        const opBtns = modal.querySelectorAll('#setup-operations .op-btn');
        opBtns.forEach(btn => {
            if (parseInt(btn.dataset.op) === selectedOp) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
            btn.onclick = () => {
                opBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                selectedOp = parseInt(btn.dataset.op);
            };
        });
        
        // Apply button
        document.getElementById('setup-apply-btn').onclick = () => {
            const dia = parseFloat(document.getElementById('setup-tool-dia').value) || 6;
            const flutes = parseInt(document.getElementById('setup-tool-flutes').value) || 2;
            const rpm = parseInt(document.getElementById('setup-tool-rpm').value) || 10000;
            
            this.setMaterial(selectedMat);
            this.setOperation(selectedOp);
            this.setTool(dia, flutes, rpm);
            
            modal.remove();
            console.log(`[Chatter] Setup: ${this.materials[selectedMat]}, op=${selectedOp}, ${dia}mm ${flutes}F @${rpm}RPM`);
        };
    }
    
    setWeights(audio, accel, current) {
        // Normalize to sum to 1.0
        const sum = audio + accel + current;
        this.send(JSON.stringify({
            wAudio: audio / sum,
            wAccel: accel / sum,
            wCurrent: current / sum
        }));
    }
    
    setThreshold(threshold) {
        this.send(JSON.stringify({ threshold }));
    }
    
    send(message) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(message);
        }
    }
    
    setEspAddress(ip) {
        this.wsUrl = `ws://${ip}/ws`;
        localStorage.setItem('chatterEspIp', ip);
        this.disconnect();
        this.connect();
    }
    
    // Open the web-based update page on ESP32
    openUpdatePage() {
        const ip = localStorage.getItem('chatterEspIp') || '192.168.1.100';
        const url = ip.includes('.local') ? `http://${ip}` : `http://${ip}`;
        window.open(url, '_blank');
    }
    
    // Switch ESP32 to AP mode for WiFi setup
    startApMode() {
        if (confirm('Switch ESP32 to WiFi setup mode?\\n\\nYou will need to:\\n1. Connect to WiFi "ChatterDetect" (password: chatter123)\\n2. Go to 192.168.4.1\\n3. Enter your WiFi credentials')) {
            this.send('apMode');
            setTimeout(() => {
                alert('ESP32 is now in AP mode.\\n\\nConnect to WiFi: ChatterDetect\\nPassword: chatter123\\nGo to: http://192.168.4.1');
            }, 1000);
        }
    }
    
    // Reboot ESP32
    reboot() {
        if (confirm('Reboot the chatter detection ESP32?')) {
            this.send('reboot');
        }
    }
    
    // Get network info
    getNetworkInfo() {
        this.send('network');
    }
    
    // History for graphing
    updateHistory() {
        this.history.combined.push(this.state.combined);
        this.history.amps.push(this.state.amps);
        this.history.feed.push(this.state.feed);
        this.history.trend.push(this.state.trend);
        
        // Trim to max length
        const max = this.history.maxLength;
        if (this.history.combined.length > max) {
            this.history.combined.shift();
            this.history.amps.shift();
            this.history.feed.shift();
            this.history.trend.shift();
        }
        
        // Update session statistics
        this.updateSessionStats();
        
        // Record sample if recording
        this.recordSample();
    }
    
    // Track session statistics
    updateSessionStats() {
        this.state.totalSamples++;
        this._sessionScoreSum += this.state.combined;
        this._sessionScoreCount++;
        this.state.sessionAvgScore = this._sessionScoreSum / this._sessionScoreCount;
        
        // Track max score
        if (this.state.combined > this.state.sessionMaxScore) {
            this.state.sessionMaxScore = this.state.combined;
        }
        
        // Track chatter events (edge detection - entering chatter zone)
        if (this.state.inChatterZone && !this._sessionLastChatter) {
            this.state.sessionChatterEvents++;
        }
        this._sessionLastChatter = this.state.inChatterZone;
        
        // Track feed reductions
        if (this.state.feed < this._lastFeed) {
            this.state.sessionFeedReductions++;
        } else if (this.state.feed > this._lastFeed && this._lastFeed < 100) {
            this.state.sessionRecoveries++;
        }
        this._lastFeed = this.state.feed;
    }
    
    // Get session summary
    getSessionSummary() {
        const duration = (Date.now() - this.state.sessionStart) / 1000 / 60;  // minutes
        return {
            duration: duration.toFixed(1) + ' min',
            samples: this.state.totalSamples,
            chatterEvents: this.state.sessionChatterEvents,
            feedReductions: this.state.sessionFeedReductions,
            recoveries: this.state.sessionRecoveries,
            maxScore: this.state.sessionMaxScore.toFixed(2),
            avgScore: this.state.sessionAvgScore.toFixed(3),
            toolWear: this.state.toolWear.toFixed(0) + '%',
            cuttingTime: (this.state.cuttingSeconds / 60).toFixed(1) + ' min',
            efficiency: this.state.sessionChatterEvents === 0 ? 
                '100%' : 
                Math.max(0, 100 - this.state.sessionChatterEvents * 5).toFixed(0) + '%'
        };
    }
    
    // Reset session stats
    resetSession() {
        this.state.sessionStart = Date.now();
        this.state.sessionChatterEvents = 0;
        this.state.sessionMaxScore = 0;
        this.state.sessionAvgScore = 0;
        this.state.sessionFeedReductions = 0;
        this.state.sessionRecoveries = 0;
        this.state.totalSamples = 0;
        this._sessionScoreSum = 0;
        this._sessionScoreCount = 0;
        this._sessionLastChatter = false;
        this._lastFeed = 100;
        this.showNotification('Session stats reset', 'success');
    }
    
    // Alert checking with audio and prediction
    checkAlerts() {
        const now = Date.now();
        
        // Check for tool break (ALWAYS alert immediately)
        if (this.state.toolBroken && !this._lastToolBroken) {
            const alert = { type: 'toolBroken', message: '🔴 TOOL BREAKAGE DETECTED! Machine stopped.' };
            this.onAlert(alert);
            this.logAlert(alert);
            this.playToolBreakAlert();
            this.lastChatterAlert = now;
        }
        
        // Check for overload
        if (this.state.overload && !this._lastOverload) {
            const alert = { type: 'overload', message: '🟠 Spindle overload! Feed reduced.' };
            this.onAlert(alert);
            this.logAlert(alert);
            if (now - this.lastChatterAlert > this.alertCooldown) {
                this.playOverloadAlert();
                this.lastChatterAlert = now;
            }
        }
        
        // Check for chatter zone entry
        if (this.state.inChatterZone && !this._lastInChatterZone) {
            const alert = { type: 'chatter', message: '🟡 Chatter zone entered - adjusting feed...', score: this.state.combined };
            this.onAlert(alert);
            this.logAlert(alert);
            if (now - this.lastChatterAlert > this.alertCooldown) {
                this.playChatterWarning();
                this.lastChatterAlert = now;
            }
        }
        
        // Check for recovery
        if (!this.state.inChatterZone && this._lastInChatterZone) {
            const alert = { type: 'recovered', message: '🟢 Chatter resolved - feed recovered.', feed: this.state.feed };
            this.onAlert(alert);
            this.logAlert(alert);
            this.playBeep(600, 150);  // Happy confirmation beep
        }
        
        // PREDICTIVE WARNING - alert BEFORE chatter happens!
        const prediction = this.updatePrediction();
        if (prediction && prediction.willChatter && !this.state.inChatterZone) {
            // Only warn once every 5 seconds about incoming chatter
            if (!this._lastPredictiveWarning || now - this._lastPredictiveWarning > 5000) {
                const eta = prediction.timeToChatter;
                if (eta !== null && eta < 3) {  // Chatter predicted within 3 seconds
                    const alert = { type: 'prediction', message: `⚠️ Chatter building! ETA: ~${eta}s`, eta: eta };
                    this.onAlert(alert);
                    this.logAlert(alert);
                    this.playBeep(700, 100);  // Short warning beep
                    this._lastPredictiveWarning = now;
                    
                    // Update UI with prediction
                    const statusEl = document.getElementById('chatter-status-text');
                    if (statusEl) {
                        statusEl.textContent = `RISING (~${eta}s)`;
                        statusEl.classList.remove('ok');
                        statusEl.classList.add('warning');
                    }
                }
            }
        }
        
        this._lastToolBroken = this.state.toolBroken;
        this._lastOverload = this.state.overload;
        this._lastInChatterZone = this.state.inChatterZone;
    }
    
    // ========================================================================
    // UI CREATION
    // ========================================================================
    
    createUI() {
        // Create the chatter panel container
        this.panel = document.createElement('div');
        this.panel.id = 'chatter-panel';
        this.panel.innerHTML = `
            <style>
                #chatter-panel {
                    position: fixed;
                    bottom: 20px;
                    right: 20px;
                    width: 320px;
                    background: linear-gradient(145deg, #1a1a2e, #16213e);
                    border-radius: 12px;
                    box-shadow: 0 8px 32px rgba(0,0,0,0.4);
                    font-family: 'Segoe UI', system-ui, sans-serif;
                    color: #fff;
                    z-index: 10000;
                    overflow: hidden;
                    transition: all 0.3s ease;
                }
                #chatter-panel.minimized {
                    width: 180px;
                    height: 48px;
                }
                #chatter-panel.minimized .chatter-body { display: none; }
                
                /* Compact mode - shows only essential info */
                #chatter-panel.compact {
                    width: 200px;
                }
                #chatter-panel.compact .chatter-scores { display: none; }
                #chatter-panel.compact .chatter-stats { display: none; }
                #chatter-panel.compact .chatter-mode { display: none; }
                #chatter-panel.compact .chatter-material { display: none; }
                #chatter-panel.compact .chatter-tool-wear { display: none; }
                #chatter-panel.compact .chatter-config { display: none; }
                #chatter-panel.compact .chatter-controls:not(.compact-controls) { display: none; }
                #chatter-panel.compact .chatter-combined { padding: 8px; margin-bottom: 8px; }
                #chatter-panel.compact .combined-value { font-size: 24px; }
                #chatter-panel.compact .threshold-line { display: none; }
                
                .chatter-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    padding: 12px 16px;
                    background: rgba(255,255,255,0.05);
                    cursor: pointer;
                }
                .chatter-header h3 {
                    margin: 0;
                    font-size: 14px;
                    font-weight: 600;
                    display: flex;
                    align-items: center;
                    gap: 8px;
                }
                .chatter-status-dot {
                    width: 8px;
                    height: 8px;
                    border-radius: 50%;
                    background: #ff4444;
                    animation: pulse 2s infinite;
                }
                .chatter-status-dot.connected { background: #44ff44; animation: none; }
                @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
                
                .chatter-body { padding: 16px; }
                
                .chatter-warning {
                    background: linear-gradient(90deg, #ff6b35, #f7931e);
                    padding: 10px 14px;
                    margin: -16px -16px 16px;
                    font-size: 12px;
                    display: flex;
                    align-items: center;
                    gap: 8px;
                }
                .chatter-warning.hidden { display: none; }
                
                .chatter-scores {
                    display: grid;
                    grid-template-columns: repeat(3, 1fr);
                    gap: 8px;
                    margin-bottom: 16px;
                }
                .score-item {
                    text-align: center;
                    padding: 8px;
                    background: rgba(255,255,255,0.05);
                    border-radius: 8px;
                }
                .score-label { font-size: 10px; opacity: 0.7; text-transform: uppercase; }
                .score-value { font-size: 18px; font-weight: 600; margin-top: 4px; }
                .score-bar {
                    height: 4px;
                    background: rgba(255,255,255,0.1);
                    border-radius: 2px;
                    margin-top: 6px;
                    overflow: hidden;
                }
                .score-fill {
                    height: 100%;
                    transition: width 0.2s, background 0.2s;
                }
                
                .chatter-combined {
                    background: rgba(255,255,255,0.05);
                    border-radius: 8px;
                    padding: 12px;
                    margin-bottom: 16px;
                    text-align: center;
                }
                .combined-label { font-size: 11px; opacity: 0.7; }
                .combined-value { 
                    font-size: 32px; 
                    font-weight: 700; 
                    margin: 4px 0;
                }
                .combined-status {
                    font-size: 12px;
                    padding: 4px 12px;
                    border-radius: 12px;
                    display: inline-block;
                }
                .combined-status.ok { background: rgba(68, 255, 68, 0.2); color: #44ff44; }
                .combined-status.warning { background: rgba(255, 200, 0, 0.2); color: #ffc800; }
                .combined-status.danger { background: rgba(255, 68, 68, 0.2); color: #ff4444; }
                
                .chatter-stats {
                    display: grid;
                    grid-template-columns: repeat(2, 1fr);
                    gap: 8px;
                    margin-bottom: 16px;
                }
                .stat-item {
                    background: rgba(255,255,255,0.05);
                    padding: 8px 12px;
                    border-radius: 6px;
                    display: flex;
                    justify-content: space-between;
                }
                .stat-label { font-size: 11px; opacity: 0.7; }
                .stat-value { font-size: 14px; font-weight: 600; }
                
                .chatter-controls {
                    display: flex;
                    gap: 8px;
                }
                .chatter-btn {
                    flex: 1;
                    padding: 8px;
                    border: none;
                    border-radius: 6px;
                    font-size: 11px;
                    font-weight: 600;
                    cursor: pointer;
                    transition: all 0.2s;
                }
                .chatter-btn:hover { transform: translateY(-1px); }
                .chatter-btn.primary { background: #0066ff; color: white; }
                .chatter-btn.secondary { background: rgba(255,255,255,0.1); color: white; }
                .chatter-btn.danger { background: #ff4444; color: white; }
                .chatter-btn:disabled { opacity: 0.5; cursor: not-allowed; }
                
                .chatter-config {
                    margin-top: 12px;
                    padding-top: 12px;
                    border-top: 1px solid rgba(255,255,255,0.1);
                }
                .chatter-config input {
                    width: 100%;
                    padding: 8px 12px;
                    border: 1px solid rgba(255,255,255,0.2);
                    border-radius: 6px;
                    background: rgba(255,255,255,0.05);
                    color: white;
                    font-size: 12px;
                }
                .chatter-config input::placeholder { color: rgba(255,255,255,0.4); }
            </style>
            
            <div class="chatter-header" onclick="window.chatterDetection.toggleMinimize()">
                <h3>
                    <span class="chatter-status-dot" id="chatter-status-dot"></span>
                    Chatter Detection
                </h3>
                <span id="chatter-minimize-icon">▼</span>
            </div>
            
            <div class="chatter-body">
                <div class="chatter-warning hidden" id="chatter-warning">
                    ⚠️ <span>ESP32 not connected - monitoring offline</span>
                </div>
                
                <div class="chatter-scores">
                    <div class="score-item">
                        <div class="score-label">Audio</div>
                        <div class="score-value" id="chatter-audio">0.00</div>
                        <div class="score-bar"><div class="score-fill" id="chatter-audio-bar"></div></div>
                    </div>
                    <div class="score-item">
                        <div class="score-label">Accel</div>
                        <div class="score-value" id="chatter-accel">0.00</div>
                        <div class="score-bar"><div class="score-fill" id="chatter-accel-bar"></div></div>
                    </div>
                    <div class="score-item">
                        <div class="score-label">Current</div>
                        <div class="score-value" id="chatter-current">0.00</div>
                        <div class="score-bar"><div class="score-fill" id="chatter-current-bar"></div></div>
                    </div>
                </div>
                
                <div class="chatter-combined">
                    <div class="combined-label">COMBINED SCORE <span id="chatter-trend-indicator"></span></div>
                    <div class="combined-value" id="chatter-combined">0.00</div>
                    <div class="combined-status ok" id="chatter-status-text">STABLE</div>
                    <div class="threshold-line" id="chatter-threshold-display" style="font-size:10px;opacity:0.6;margin-top:4px;">
                        Threshold: <span id="chatter-threshold-val">0.55</span> | Noise: <span id="chatter-noise-val">0.05</span>
                    </div>
                </div>
                
                <div class="chatter-stats">
                    <div class="stat-item">
                        <span class="stat-label">Feed</span>
                        <span class="stat-value" id="chatter-feed">100%</span>
                    </div>
                    <div class="stat-item">
                        <span class="stat-label">Last Stable</span>
                        <span class="stat-value" id="chatter-last-stable">100%</span>
                    </div>
                    <div class="stat-item">
                        <span class="stat-label">Current</span>
                        <span class="stat-value" id="chatter-amps">0.0 A</span>
                    </div>
                    <div class="stat-item">
                        <span class="stat-label">Expected</span>
                        <span class="stat-value" id="chatter-expected-amps">1.5-6A</span>
                    </div>
                    <div class="stat-item">
                        <span class="stat-label">Chatter Freq</span>
                        <span class="stat-value" id="chatter-freq">0 Hz</span>
                    </div>
                    <div class="stat-item">
                        <span class="stat-label">Tooth Freq</span>
                        <span class="stat-value" id="chatter-tooth-freq">333 Hz</span>
                    </div>
                    <div class="stat-item">
                        <span class="stat-label">Trend</span>
                        <span class="stat-value" id="chatter-trend">→</span>
                    </div>
                    <div class="stat-item">
                        <span class="stat-label">Efficiency</span>
                        <span class="stat-value" id="chatter-efficiency">0%</span>
                    </div>
                </div>
                
                <div class="chatter-mode" style="margin-bottom:12px;">
                    <div style="font-size:10px;opacity:0.7;margin-bottom:6px;">MODE</div>
                    <div style="display:flex;gap:4px;">
                        <button class="chatter-btn secondary" id="mode-auto" onclick="window.chatterDetection.setMode('auto')" style="flex:1;font-size:10px;">Auto</button>
                        <button class="chatter-btn secondary" id="mode-aggressive" onclick="window.chatterDetection.setMode('aggressive')" style="flex:1;font-size:10px;">Aggressive</button>
                        <button class="chatter-btn secondary" id="mode-conservative" onclick="window.chatterDetection.setMode('conservative')" style="flex:1;font-size:10px;">Safe</button>
                    </div>
                </div>
                
                <!-- REAL-TIME GRAPH -->
                <div style="margin-bottom:12px;padding:8px;background:rgba(255,255,255,0.03);border-radius:8px;">
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
                        <span style="font-size:10px;opacity:0.6;">LIVE GRAPH</span>
                        <span style="font-size:10px;" id="chatter-spindle-state">⚫ Idle</span>
                    </div>
                    <canvas id="chatter-graph" width="288" height="60" style="width:100%;height:60px;border-radius:4px;background:rgba(0,0,0,0.3);"></canvas>
                </div>
                
                <!-- MATERIAL/TOOL DISPLAY - Because it matters! -->
                <div class="chatter-material" id="chatter-material-display" style="margin-bottom:12px;padding:10px;background:rgba(255,255,255,0.05);border-radius:8px;cursor:pointer;" onclick="window.chatterDetection.showSetupWizard()">
                    <div style="display:flex;justify-content:space-between;align-items:center;">
                        <div>
                            <div style="font-size:10px;opacity:0.6;">MATERIAL</div>
                            <div style="font-size:14px;font-weight:600;" id="chatter-material-name">aluminum</div>
                        </div>
                        <div style="text-align:center;">
                            <div style="font-size:10px;opacity:0.6;">OPERATION</div>
                            <div style="font-size:12px;" id="chatter-operation-name">roughing</div>
                        </div>
                        <div style="text-align:right;">
                            <div style="font-size:10px;opacity:0.6;">TOOL</div>
                            <div style="font-size:12px;" id="chatter-tool-info">6mm 2F</div>
                        </div>
                        <div style="font-size:16px;opacity:0.5;">⚙️</div>
                    </div>
                    <div style="font-size:10px;opacity:0.5;margin-top:6px;text-align:center;">Tap to change (IT MATTERS for detection accuracy)</div>
                </div>
                
                <div class="chatter-controls">
                    <button class="chatter-btn primary" id="chatter-toggle" onclick="window.chatterDetection.toggleEnabled()">
                        Disable
                    </button>
                    <button class="chatter-btn secondary" onclick="window.chatterDetection.learn()" title="Learn noise floor from environment">
                        Learn
                    </button>
                    <button class="chatter-btn secondary" onclick="window.chatterDetection.autoCal()" title="Auto-calibrate idle current (spindle must be running)">
                        AutoCal
                    </button>
                    <button class="chatter-btn danger" onclick="window.chatterDetection.resetAlerts()">
                        Reset
                    </button>
                </div>
                
                <div class="chatter-controls" style="margin-top:8px;">
                    <button class="chatter-btn secondary" onclick="window.chatterDetection.save()" title="Save settings to flash (survives reboot)" style="flex:1;">
                        💾 Save
                    </button>
                    <button class="chatter-btn secondary" onclick="window.chatterDetection.toggleAudio()" id="chatter-audio-btn" title="Toggle audio alerts" style="flex:1;">
                        ${this.audioEnabled ? '🔊 Audio' : '🔇 Muted'}
                    </button>
                    <button class="chatter-btn secondary" onclick="window.chatterDetection.showDiagnostics()" title="Show diagnostics and spectrum" style="flex:1;">
                        📊 Diag
                    </button>
                    <button class="chatter-btn secondary" onclick="window.chatterDetection.showRecommendations()" title="Get smart suggestions" style="flex:1;">
                        💡 Tips
                    </button>
                </div>
                
                <div class="chatter-controls" style="margin-top:8px;">
                    <button class="chatter-btn secondary" onclick="window.chatterDetection.openUpdatePage()" title="Open web update page" style="flex:1;">
                        ⬆️ Update
                    </button>
                    <button class="chatter-btn secondary" onclick="window.chatterDetection.startApMode()" title="Start WiFi setup hotspot" style="flex:1;">
                        📶 Setup
                    </button>
                    <button class="chatter-btn secondary" onclick="window.chatterDetection.startAutoTuning()" title="Auto-tune thresholds" style="flex:1;">
                        🎛️ Tune
                    </button>
                    <button class="chatter-btn secondary" onclick="window.chatterDetection.reboot()" title="Reboot ESP32" style="flex:1;">
                        🔄 Reboot
                    </button>
                </div>
                
                <!-- TOOL WEAR DISPLAY -->
                <div class="chatter-tool-wear" id="chatter-tool-wear" style="margin-top:12px;padding:10px;background:rgba(255,255,255,0.05);border-radius:8px;">
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                        <span style="font-size:10px;opacity:0.7;">TOOL WEAR ESTIMATE</span>
                        <button onclick="window.chatterDetection.resetToolWear()" style="padding:2px 8px;font-size:10px;background:rgba(255,255,255,0.1);border:none;border-radius:4px;color:white;cursor:pointer;">
                            New Tool
                        </button>
                    </div>
                    <div style="display:flex;gap:12px;align-items:center;">
                        <div style="font-size:24px;" id="chatter-wear-icon">🟢</div>
                        <div style="flex:1;">
                            <div style="height:8px;background:rgba(255,255,255,0.1);border-radius:4px;overflow:hidden;">
                                <div id="chatter-wear-bar" style="height:100%;width:0%;background:linear-gradient(90deg,#44ff44,#ffcc00,#ff4444);transition:width 0.3s;"></div>
                            </div>
                            <div style="display:flex;justify-content:space-between;margin-top:4px;font-size:10px;opacity:0.7;">
                                <span id="chatter-wear-percent">0%</span>
                                <span id="chatter-wear-time">0 min cutting</span>
                            </div>
                        </div>
                    </div>
                </div>
                
                <!-- VFD TELEMETRY (optional - from RS-485 Modbus) -->
                <div class="chatter-vfd" id="chatter-vfd-panel" style="margin-top:12px;padding:10px;background:rgba(255,255,255,0.05);border-radius:8px;display:none;">
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                        <span style="font-size:10px;opacity:0.7;">VFD TELEMETRY (RS-485)</span>
                        <span id="chatter-vfd-status" style="font-size:10px;">⚫ N/A</span>
                    </div>
                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:12px;">
                        <div style="display:flex;justify-content:space-between;padding:4px 8px;background:rgba(255,255,255,0.03);border-radius:4px;">
                            <span style="opacity:0.7;">RPM</span>
                            <span id="chatter-vfd-rpm" style="font-weight:600;">0</span>
                        </div>
                        <div style="display:flex;justify-content:space-between;padding:4px 8px;background:rgba(255,255,255,0.03);border-radius:4px;">
                            <span style="opacity:0.7;">Freq</span>
                            <span id="chatter-vfd-freq" style="font-weight:600;">0 Hz</span>
                        </div>
                        <div style="display:flex;justify-content:space-between;padding:4px 8px;background:rgba(255,255,255,0.03);border-radius:4px;">
                            <span style="opacity:0.7;">Current</span>
                            <span id="chatter-vfd-amps" style="font-weight:600;">0.0 A</span>
                        </div>
                        <div style="display:flex;justify-content:space-between;padding:4px 8px;background:rgba(255,255,255,0.03);border-radius:4px;">
                            <span style="opacity:0.7;">DC Bus</span>
                            <span id="chatter-vfd-dcv" style="font-weight:600;">0 V</span>
                        </div>
                    </div>
                    <div id="chatter-vfd-fault" style="display:none;margin-top:6px;padding:6px;background:rgba(255,68,68,0.2);border-radius:4px;font-size:11px;color:#ff6666;">
                        ⚠️ <span id="chatter-vfd-fault-text">Fault</span>
                    </div>
                </div>
                
                <!-- COMPACT MODE CONTROLS (visible in compact mode) -->
                <div class="chatter-controls compact-controls" style="margin-top:8px;">
                    <button class="chatter-btn primary" id="chatter-toggle-compact" onclick="window.chatterDetection.toggleEnabled()">
                        Disable
                    </button>
                    <button class="chatter-btn secondary" onclick="window.chatterDetection.toggleCompact()" title="Toggle compact mode">
                        📐 Full
                    </button>
                </div>
                
                <div class="chatter-config">
                    <input type="text" id="chatter-ip" placeholder="ESP32 IP or 'chatter.local'" 
                           onchange="window.chatterDetection.setEspAddress(this.value)">
                    <button onclick="window.chatterDetection.toggleCompact()" style="margin-top:6px;padding:6px 12px;font-size:10px;background:rgba(255,255,255,0.1);border:none;border-radius:4px;color:white;cursor:pointer;width:100%;">
                        📐 Toggle Compact Mode (Alt+M)
                    </button>
                </div>
            </div>
        `;
        
        // Add to page
        document.body.appendChild(this.panel);
        
        // Make globally accessible
        window.chatterDetection = this;
    }
    
    toggleMinimize() {
        this.panel.classList.toggle('minimized');
        this.panel.classList.remove('compact');  // Can't be both
        const icon = document.getElementById('chatter-minimize-icon');
        icon.textContent = this.panel.classList.contains('minimized') ? '▲' : '▼';
    }
    
    toggleCompact() {
        this.panel.classList.toggle('compact');
        this.panel.classList.remove('minimized');  // Can't be both
        const icon = document.getElementById('chatter-minimize-icon');
        icon.textContent = '▼';
        
        // Update button text
        const btn = this.panel.querySelector('.compact-controls button:nth-child(2)');
        if (btn) {
            btn.textContent = this.panel.classList.contains('compact') ? '📐 Full' : '📐 Compact';
        }
    }
    
    toggleEnabled() {
        if (this.state.enabled) {
            this.disable();
        } else {
            this.enable();
        }
    }
    
    showWarning() {
        const warning = document.getElementById('chatter-warning');
        if (warning) warning.classList.remove('hidden');
        
        const dot = document.getElementById('chatter-status-dot');
        if (dot) dot.classList.remove('connected');
    }
    
    hideWarning() {
        const warning = document.getElementById('chatter-warning');
        if (warning) warning.classList.add('hidden');
        
        const dot = document.getElementById('chatter-status-dot');
        if (dot) dot.classList.add('connected');
    }
    
    // Update material/tool display
    updateMaterialUI() {
        const opNames = ['roughing', 'finishing', 'drilling', 'slotting'];
        
        const matName = document.getElementById('chatter-material-name');
        if (matName) matName.textContent = this.state.material || 'aluminum';
        
        const opName = document.getElementById('chatter-operation-name');
        if (opName) opName.textContent = opNames[this.state.operation] || 'roughing';
        
        const toolInfo = document.getElementById('chatter-tool-info');
        if (toolInfo) {
            const dia = this.state.toolDia || 6;
            const flutes = this.state.toolFlutes || 2;
            toolInfo.textContent = `${dia}mm ${flutes}F`;
        }
        
        // Also update tooth frequency display if present
        const toothFreq = document.getElementById('chatter-tooth-freq');
        if (toothFreq && this.state.rpm && this.state.toolFlutes) {
            const freq = Math.round((this.state.rpm * this.state.toolFlutes) / 60);
            toothFreq.textContent = `${freq} Hz`;
        }
    }
    
    // Update tool wear display
    updateToolWearUI() {
        // Update tool wear tracking first
        this.updateToolWear();
        
        const wearIcon = document.getElementById('chatter-wear-icon');
        const wearBar = document.getElementById('chatter-wear-bar');
        const wearPercent = document.getElementById('chatter-wear-percent');
        const wearTime = document.getElementById('chatter-wear-time');
        
        if (!wearIcon || !wearBar || !wearPercent || !wearTime) return;
        
        const status = this.getToolWearStatus();
        wearIcon.textContent = status.icon;
        wearBar.style.width = `${Math.min(this.state.toolWear, 100)}%`;
        wearPercent.textContent = `${this.state.toolWear.toFixed(0)}% - ${status.text}`;
        
        const mins = (this.state.cuttingSeconds / 60).toFixed(1);
        wearTime.textContent = `${mins} min cutting`;
        
        // Highlight if wear is high
        const container = document.getElementById('chatter-tool-wear');
        if (container) {
            if (this.state.toolWear >= 80) {
                container.style.background = 'rgba(255,68,68,0.2)';
                container.style.border = '1px solid #ff4444';
            } else if (this.state.toolWear >= 50) {
                container.style.background = 'rgba(255,200,0,0.15)';
                container.style.border = '1px solid #ffc800';
            } else {
                container.style.background = 'rgba(255,255,255,0.05)';
                container.style.border = 'none';
            }
        }
    }
    
    // Update VFD telemetry display
    updateVfdUI() {
        const vfd = this.state.vfd;
        const panel = document.getElementById('chatter-vfd-panel');
        
        // Only show panel if VFD is connected (ok === true)
        if (!vfd || !vfd.ok) {
            if (panel) panel.style.display = 'none';
            return;
        }
        
        // Show the panel
        if (panel) panel.style.display = 'block';
        
        // Status indicator
        const status = document.getElementById('chatter-vfd-status');
        if (status) {
            if (vfd.fault > 0) {
                status.textContent = '🔴 FAULT';
                status.style.color = '#ff4444';
            } else if (vfd.run) {
                status.textContent = '🟢 Running';
                status.style.color = '#44ff44';
            } else {
                status.textContent = '🟡 Idle';
                status.style.color = '#ffc800';
            }
        }
        
        // RPM
        const rpmEl = document.getElementById('chatter-vfd-rpm');
        if (rpmEl) {
            rpmEl.textContent = vfd.rpm || 0;
            // Color based on running
            rpmEl.style.color = vfd.run ? '#44ff44' : 'inherit';
        }
        
        // Frequency (Hz)
        const freqEl = document.getElementById('chatter-vfd-freq');
        if (freqEl) {
            const f = vfd.freq || 0;
            freqEl.textContent = `${f.toFixed(1)} Hz`;
        }
        
        // Current (A)
        const ampsEl = document.getElementById('chatter-vfd-amps');
        if (ampsEl) {
            const a = vfd.amps || 0;
            ampsEl.textContent = `${a.toFixed(1)} A`;
            // Color based on current level
            if (a > 10) {
                ampsEl.style.color = '#ff4444';  // High current
            } else if (a > 5) {
                ampsEl.style.color = '#ffc800';  // Medium
            } else {
                ampsEl.style.color = vfd.run ? '#44ff44' : 'inherit';
            }
        }
        
        // DC Bus voltage
        const dcvEl = document.getElementById('chatter-vfd-dcv');
        if (dcvEl) {
            const v = vfd.dcv || 0;
            dcvEl.textContent = `${v.toFixed(0)} V`;
            // Color based on voltage (typically 310-340V for 220V input)
            if (v > 0 && v < 280) {
                dcvEl.style.color = '#ff4444';  // Low voltage
            } else if (v > 380) {
                dcvEl.style.color = '#ff4444';  // Over voltage
            } else {
                dcvEl.style.color = 'inherit';
            }
        }
        
        // Fault display
        const faultPanel = document.getElementById('chatter-vfd-fault');
        const faultText = document.getElementById('chatter-vfd-fault-text');
        if (faultPanel && faultText) {
            if (vfd.fault > 0) {
                faultPanel.style.display = 'block';
                faultText.textContent = vfd.faultStr || `Fault code: ${vfd.fault}`;
            } else {
                faultPanel.style.display = 'none';
            }
        }
    }
    
    // Update sensor health display in diagnostics panel
    updateSensorHealthUI(sensors) {
        // MPU-6050 (Accelerometer)
        const mpuEl = document.getElementById('diag-sensor-mpu');
        if (mpuEl) {
            const mpuOk = sensors.mpu === 'OK' || sensors.mpuCode === 0;
            mpuEl.textContent = mpuOk ? '✓ OK' : `✗ ${sensors.mpu || 'Error'}`;
            mpuEl.style.color = mpuOk ? '#44ff44' : '#ff4444';
        }
        
        // INMP441 (Microphone)
        const i2sEl = document.getElementById('diag-sensor-i2s');
        if (i2sEl) {
            const i2sOk = sensors.i2s === 'OK' || sensors.i2sCode === 0;
            i2sEl.textContent = i2sOk ? '✓ OK' : `✗ ${sensors.i2s || 'Error'}`;
            i2sEl.style.color = i2sOk ? '#44ff44' : '#ff4444';
        }
        
        // ACS712 (Current sensor)
        const adcEl = document.getElementById('diag-sensor-adc');
        if (adcEl) {
            const adcOk = sensors.adc === 'OK' || sensors.adcCode === 0;
            adcEl.textContent = adcOk ? '✓ OK' : `✗ ${sensors.adc || 'Error'}`;
            adcEl.style.color = adcOk ? '#44ff44' : '#ff4444';
        }
        
        // All sensors summary
        const allEl = document.getElementById('diag-sensor-all');
        if (allEl) {
            allEl.textContent = sensors.allOk ? '✓ All OK' : '⚠️ Issues Detected';
            allEl.style.color = sensors.allOk ? '#44ff44' : '#ff4444';
        }
        
        // Error detail panel
        const errorDetail = document.getElementById('sensor-error-detail');
        const errorText = document.getElementById('sensor-error-text');
        if (errorDetail && errorText) {
            if (!sensors.allOk) {
                errorDetail.style.display = 'block';
                let troubleshoot = [];
                if (sensors.mpuCode && sensors.mpuCode !== 0) {
                    troubleshoot.push(`MPU-6050: ${sensors.mpu} - Check I2C wiring (SDA→GPIO21, SCL→GPIO22)`);
                }
                if (sensors.i2sCode && sensors.i2sCode !== 0) {
                    troubleshoot.push(`INMP441: ${sensors.i2s} - Check I2S wiring (SD→GPIO32, WS→GPIO25, SCK→GPIO26)`);
                }
                if (sensors.adcCode && sensors.adcCode !== 0) {
                    troubleshoot.push(`ACS712: ${sensors.adc} - Check ADC wiring (OUT→GPIO34) and power (5V)`);
                }
                errorText.innerHTML = troubleshoot.join('<br>');
            } else {
                errorDetail.style.display = 'none';
            }
        }
    }
    
    // Draw the real-time graph with zones and enhanced visualization
    drawGraph() {
        const canvas = document.getElementById('chatter-graph');
        if (!canvas) return;
        
        const ctx = canvas.getContext('2d');
        const w = canvas.width;
        const h = canvas.height;
        const data = this.history.combined;
        const threshold = this.state.threshold || 0.55;
        const warningZone = threshold * 0.7;
        
        // Clear
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        ctx.fillRect(0, 0, w, h);
        
        // Draw zones (danger/warning/safe)
        // Danger zone (above threshold)
        const dangerY = h - (threshold * h);
        ctx.fillStyle = 'rgba(255,68,68,0.1)';
        ctx.fillRect(0, 0, w, dangerY);
        
        // Warning zone (70-100% of threshold)
        const warningY = h - (warningZone * h);
        ctx.fillStyle = 'rgba(255,200,0,0.08)';
        ctx.fillRect(0, dangerY, w, warningY - dangerY);
        
        // Draw threshold line
        ctx.strokeStyle = 'rgba(255,68,68,0.6)';
        ctx.setLineDash([4, 4]);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, dangerY);
        ctx.lineTo(w, dangerY);
        ctx.stroke();
        
        // Draw warning line
        ctx.strokeStyle = 'rgba(255,200,0,0.4)';
        ctx.beginPath();
        ctx.moveTo(0, warningY);
        ctx.lineTo(w, warningY);
        ctx.stroke();
        ctx.setLineDash([]);
        
        // Draw labels
        ctx.fillStyle = 'rgba(255,255,255,0.4)';
        ctx.font = '8px sans-serif';
        ctx.fillText('CHATTER', 2, dangerY - 2);
        ctx.fillText('WARNING', 2, warningY - 2);
        
        // Draw prediction line if applicable
        if (this.state.ticksToChatter > 0 && this.state.ticksToChatter < 20) {
            const predX = Math.min(w - 5, (data.length + this.state.ticksToChatter) * (w / this.history.maxLength));
            ctx.strokeStyle = 'rgba(255,100,0,0.6)';
            ctx.setLineDash([2, 2]);
            ctx.beginPath();
            ctx.moveTo(predX, 0);
            ctx.lineTo(predX, h);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.fillStyle = 'rgba(255,100,0,0.8)';
            ctx.fillText('⚠', predX - 4, 12);
        }
        
        // Draw data line
        if (data.length < 2) return;
        
        ctx.beginPath();
        ctx.strokeStyle = this.getScoreColor(this.state.combined);
        ctx.lineWidth = 2;
        
        const step = w / (this.history.maxLength - 1);
        for (let i = 0; i < data.length; i++) {
            const x = i * step;
            const y = h - (Math.min(data[i], 1) * h);
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.stroke();
        
        // Fill area under curve
        ctx.lineTo((data.length - 1) * step, h);
        ctx.lineTo(0, h);
        ctx.closePath();
        ctx.fillStyle = this.state.inChatterZone 
            ? 'rgba(255,68,68,0.2)' 
            : 'rgba(68,255,68,0.1)';
        ctx.fill();
        
        // Draw current value marker
        if (data.length > 0) {
            const lastX = (data.length - 1) * step;
            const lastY = h - (Math.min(data[data.length - 1], 1) * h);
            ctx.fillStyle = this.getScoreColor(this.state.combined);
            ctx.beginPath();
            ctx.arc(lastX, lastY, 4, 0, Math.PI * 2);
            ctx.fill();
        }
    }
    
    // Update spindle state indicator
    updateSpindleState() {
        const indicator = document.getElementById('chatter-spindle-state');
        if (!indicator) return;
        
        if (!this.state.spindleRunning) {
            indicator.textContent = '⚫ Idle';
            indicator.style.color = '#888';
        } else if (this.state.cutting) {
            indicator.textContent = '🟢 Cutting';
            indicator.style.color = '#44ff44';
        } else {
            indicator.textContent = '🟡 Spindle On';
            indicator.style.color = '#ffc800';
        }
    }
    
    getScoreColor(score) {
        const threshold = this.state.threshold || 0.55;
        if (score < threshold * 0.5) return '#44ff44';  // Green
        if (score < threshold) return '#ffc800';  // Yellow
        return '#ff4444';  // Red
    }
    
    getTrendIndicator(trend) {
        if (trend > 0.02) return '📈';  // Rising fast
        if (trend > 0.005) return '↗';  // Rising
        if (trend < -0.02) return '📉';  // Falling fast
        if (trend < -0.005) return '↘';  // Falling
        return '→';  // Stable
    }
    
    updateUI() {
        // Draw graph first
        this.drawGraph();
        this.updateSpindleState();
        
        // Update score values and bars
        const audio = document.getElementById('chatter-audio');
        const audioBar = document.getElementById('chatter-audio-bar');
        if (audio) audio.textContent = this.state.audio.toFixed(2);
        if (audioBar) {
            audioBar.style.width = `${Math.min(this.state.audio * 100, 100)}%`;
            audioBar.style.background = this.getScoreColor(this.state.audio);
        }
        
        const accel = document.getElementById('chatter-accel');
        const accelBar = document.getElementById('chatter-accel-bar');
        if (accel) accel.textContent = this.state.accel.toFixed(2);
        if (accelBar) {
            accelBar.style.width = `${Math.min(this.state.accel * 100, 100)}%`;
            accelBar.style.background = this.getScoreColor(this.state.accel);
        }
        
        const current = document.getElementById('chatter-current');
        const currentBar = document.getElementById('chatter-current-bar');
        if (current) current.textContent = this.state.current.toFixed(2);
        if (currentBar) {
            currentBar.style.width = `${Math.min(this.state.current * 100, 100)}%`;
            currentBar.style.background = this.getScoreColor(this.state.current);
        }
        
        // Combined score with trend indicator
        const combined = document.getElementById('chatter-combined');
        if (combined) {
            combined.textContent = this.state.combined.toFixed(2);
            combined.style.color = this.getScoreColor(this.state.combined);
        }
        
        const trendIndicator = document.getElementById('chatter-trend-indicator');
        if (trendIndicator) {
            trendIndicator.textContent = this.getTrendIndicator(this.state.trend);
        }
        
        // Threshold and noise floor
        const thresholdVal = document.getElementById('chatter-threshold-val');
        if (thresholdVal) thresholdVal.textContent = (this.state.threshold || 0.55).toFixed(2);
        
        const noiseVal = document.getElementById('chatter-noise-val');
        if (noiseVal) noiseVal.textContent = (this.state.noiseFloor || 0.05).toFixed(2);
        
        // Status text - more detailed
        const statusText = document.getElementById('chatter-status-text');
        if (statusText) {
            if (this.state.toolBroken) {
                statusText.textContent = '🔴 TOOL BROKEN';
                statusText.className = 'combined-status danger';
            } else if (this.state.overload) {
                statusText.textContent = '⚠️ OVERLOAD';
                statusText.className = 'combined-status danger';
            } else if (this.state.learning) {
                statusText.textContent = '🧠 LEARNING...';
                statusText.className = 'combined-status warning';
            } else if (this.state.calibrating) {
                statusText.textContent = '📊 CALIBRATING...';
                statusText.className = 'combined-status warning';
            } else if (this.state.inChatterZone) {
                statusText.textContent = `📳 CHATTER (${this.state.recoveryAttempts} tries)`;
                statusText.className = 'combined-status warning';
            } else if (this.state.chatter) {
                statusText.textContent = '⚡ DETECTED';
                statusText.className = 'combined-status warning';
            } else {
                statusText.textContent = `✓ STABLE (${this.state.stableCount})`;
                statusText.className = 'combined-status ok';
            }
        }
        
        // Stats
        const feed = document.getElementById('chatter-feed');
        if (feed) {
            feed.textContent = `${this.state.feed}%`;
            feed.style.color = this.state.feed < 80 ? '#ffc800' : (this.state.feed < 50 ? '#ff4444' : 'inherit');
        }
        
        const lastStable = document.getElementById('chatter-last-stable');
        if (lastStable) lastStable.textContent = `${this.state.lastStable || 100}%`;
        
        const amps = document.getElementById('chatter-amps');
        if (amps) {
            amps.textContent = `${this.state.amps.toFixed(1)} A`;
            // Color based on expected range
            const low = this.state.expectedAmpsLow || 1.5;
            const high = this.state.expectedAmpsHigh || 6.0;
            if (this.state.amps < low * 0.5) {
                amps.style.color = '#888';  // Gray = not cutting
            } else if (this.state.amps > high * 1.3) {
                amps.style.color = '#ff4444';  // Red = overload
            } else if (this.state.amps > high) {
                amps.style.color = '#ffc800';  // Yellow = high
            } else {
                amps.style.color = '#44ff44';  // Green = normal
            }
        }
        
        const expectedAmps = document.getElementById('chatter-expected-amps');
        if (expectedAmps) {
            const low = this.state.expectedAmpsLow || 1.5;
            const high = this.state.expectedAmpsHigh || 6.0;
            expectedAmps.textContent = `${low.toFixed(1)}-${high.toFixed(1)}A`;
        }
        
        const freq = document.getElementById('chatter-freq');
        if (freq) freq.textContent = `${this.state.freq} Hz`;
        
        // Tooth frequency (calculated from RPM and flutes)
        const toothFreq = document.getElementById('chatter-tooth-freq');
        if (toothFreq) {
            const tf = this.state.toothFreq || Math.round((this.state.rpm * this.state.toolFlutes) / 60);
            toothFreq.textContent = `${tf} Hz`;
        }
        
        const minFeed = document.getElementById('chatter-min-feed');
        if (minFeed) minFeed.textContent = `${this.state.minFeed || 20}%`;
        
        const trend = document.getElementById('chatter-trend');
        if (trend) {
            const t = this.state.trend || 0;
            trend.textContent = this.getTrendIndicator(t) + ` ${(t * 100).toFixed(1)}`;
            trend.style.color = t > 0.01 ? '#ff4444' : (t < -0.01 ? '#44ff44' : 'inherit');
        }
        
        // Cutting efficiency display
        const efficiency = document.getElementById('chatter-efficiency');
        if (efficiency) {
            const eff = this.state.efficiency || 0;
            const effPercent = Math.round(eff * 100);
            efficiency.textContent = `${effPercent}%`;
            // Color based on efficiency
            if (effPercent >= 70) {
                efficiency.style.color = '#44ff44';  // Green = optimal
            } else if (effPercent >= 40) {
                efficiency.style.color = '#ffc800';  // Yellow = ok
            } else {
                efficiency.style.color = '#ff4444';  // Red = poor
            }
        }
        
        // Update material display (in case it changed from WebSocket data)
        this.updateMaterialUI();
        
        // Update tool wear display
        this.updateToolWearUI();
        
        // Update VFD telemetry display
        this.updateVfdUI();
        
        // Toggle button
        const toggle = document.getElementById('chatter-toggle');
        if (toggle) {
            toggle.textContent = this.state.enabled ? 'Disable' : 'Enable';
            toggle.className = `chatter-btn ${this.state.enabled ? 'danger' : 'primary'}`;
        }
        
        // Mode buttons
        const modes = ['auto', 'aggressive', 'conservative'];
        const modeMap = { 0: 'auto', 1: 'aggressive', 2: 'conservative' };
        const currentMode = modeMap[this.state.mode] || 'auto';
        modes.forEach(m => {
            const btn = document.getElementById(`mode-${m}`);
            if (btn) {
                btn.className = `chatter-btn ${m === currentMode ? 'primary' : 'secondary'}`;
                btn.style.fontSize = '10px';
            }
        });
    }
    
    destroy() {
        this.disconnect();
        if (this.panel && this.panel.parentNode) {
            this.panel.parentNode.removeChild(this.panel);
        }
        window.chatterDetection = null;
    }
    
    // Show diagnostic modal with spectrum analyzer
    showDiagnostics() {
        // Request spectrum and diagnostic data
        this.send('spectrum');
        this.send('diag');
        
        // Create modal
        const modal = document.createElement('div');
        modal.id = 'chatter-diag-modal';
        modal.innerHTML = `
            <style>
                #chatter-diag-modal {
                    position: fixed;
                    inset: 0;
                    background: rgba(0,0,0,0.9);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    z-index: 100001;
                    font-family: 'Segoe UI', system-ui, sans-serif;
                }
                .diag-dialog {
                    background: linear-gradient(145deg, #1a1a2e, #16213e);
                    border-radius: 16px;
                    width: 550px;
                    max-width: 95vw;
                    max-height: 90vh;
                    overflow-y: auto;
                    color: white;
                    box-shadow: 0 20px 60px rgba(0,0,0,0.5);
                }
                .diag-header {
                    padding: 20px 24px 12px;
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                }
                .diag-header h2 { margin: 0; font-size: 18px; }
                .diag-close {
                    background: none;
                    border: none;
                    color: white;
                    font-size: 24px;
                    cursor: pointer;
                    opacity: 0.6;
                }
                .diag-close:hover { opacity: 1; }
                .diag-body { padding: 0 24px 24px; }
                .diag-section {
                    margin-bottom: 20px;
                    padding: 12px;
                    background: rgba(255,255,255,0.05);
                    border-radius: 8px;
                }
                .diag-section h4 { margin: 0 0 10px; font-size: 12px; opacity: 0.7; text-transform: uppercase; }
                .diag-grid {
                    display: grid;
                    grid-template-columns: repeat(2, 1fr);
                    gap: 8px;
                    font-size: 12px;
                }
                .diag-item { display: flex; justify-content: space-between; }
                .diag-item .label { opacity: 0.7; }
                .diag-item .value { font-weight: 600; font-family: monospace; }
                .spectrum-canvas {
                    width: 100%;
                    height: 80px;
                    background: rgba(0,0,0,0.3);
                    border-radius: 4px;
                    margin-top: 8px;
                }
            </style>
            <div class="diag-dialog">
                <div class="diag-header">
                    <h2>📊 Chatter Diagnostics</h2>
                    <button class="diag-close" onclick="document.getElementById('chatter-diag-modal').remove()">×</button>
                </div>
                <div class="diag-body">
                    <div class="diag-section">
                        <h4>System Info</h4>
                        <div class="diag-grid" id="diag-system">
                            <div class="diag-item"><span class="label">Free Heap</span><span class="value" id="diag-heap">---</span></div>
                            <div class="diag-item"><span class="label">Uptime</span><span class="value" id="diag-uptime">---</span></div>
                            <div class="diag-item"><span class="label">WiFi RSSI</span><span class="value" id="diag-rssi">---</span></div>
                            <div class="diag-item"><span class="label">WS Clients</span><span class="value" id="diag-clients">---</span></div>
                        </div>
                    </div>
                    
                    <div class="diag-section">
                        <h4>🔌 Sensor Health</h4>
                        <div class="diag-grid" id="diag-sensors">
                            <div class="diag-item">
                                <span class="label">MPU-6050 (Accel)</span>
                                <span class="value" id="diag-sensor-mpu" style="color:${this.state.sensors?.mpuOk !== false ? '#44ff44' : '#ff4444'}">${this.state.sensors?.mpuOk !== false ? '✓ OK' : '✗ ' + (this.state.sensors?.mpuErrStr || 'Error')}</span>
                            </div>
                            <div class="diag-item">
                                <span class="label">INMP441 (Mic)</span>
                                <span class="value" id="diag-sensor-i2s" style="color:${this.state.sensors?.i2sOk !== false ? '#44ff44' : '#ff4444'}">${this.state.sensors?.i2sOk !== false ? '✓ OK' : '✗ ' + (this.state.sensors?.i2sErrStr || 'Error')}</span>
                            </div>
                            <div class="diag-item">
                                <span class="label">ACS712 (Current)</span>
                                <span class="value" id="diag-sensor-adc" style="color:${this.state.sensors?.adcOk !== false ? '#44ff44' : '#ff4444'}">${this.state.sensors?.adcOk !== false ? '✓ OK' : '✗ ' + (this.state.sensors?.adcErrStr || 'Error')}</span>
                            </div>
                            <div class="diag-item">
                                <span class="label">All Sensors</span>
                                <span class="value" id="diag-sensor-all" style="color:${this.state.sensors?.allOk !== false ? '#44ff44' : '#ff4444'}">${this.state.sensors?.allOk !== false ? '✓ All OK' : '⚠️ Issues'}</span>
                            </div>
                        </div>
                        <div id="sensor-error-detail" style="display:${this.state.sensors?.allOk === false ? 'block' : 'none'};margin-top:8px;padding:8px;background:rgba(255,68,68,0.2);border-radius:4px;font-size:11px;">
                            <b>Troubleshooting:</b><br>
                            <span id="sensor-error-text">Check wiring and connections.</span>
                        </div>
                    </div>
                    
                    <div class="diag-section">
                        <h4>Detection Settings</h4>
                        <div class="diag-grid">
                            <div class="diag-item"><span class="label">Material</span><span class="value" id="diag-material">${this.state.material}</span></div>
                            <div class="diag-item"><span class="label">Threshold</span><span class="value">${this.state.threshold.toFixed(2)}</span></div>
                            <div class="diag-item"><span class="label">Audio Range</span><span class="value" id="diag-audio-range">---</span></div>
                            <div class="diag-item"><span class="label">Accel Range</span><span class="value" id="diag-accel-range">---</span></div>
                            <div class="diag-item"><span class="label">Tooth Pass Freq</span><span class="value" id="diag-tooth-freq">---</span></div>
                            <div class="diag-item"><span class="label">Current Score</span><span class="value">${this.state.combined.toFixed(3)}</span></div>
                        </div>
                    </div>
                    
                    <div class="diag-section">
                        <h4>Audio Spectrum (Chatter Frequencies)</h4>
                        <canvas id="diag-audio-spectrum" class="spectrum-canvas" width="500" height="80"></canvas>
                        <div style="font-size:10px;opacity:0.5;margin-top:4px;">Higher bars = more energy at that frequency. Red zone = chatter band.</div>
                    </div>
                    
                    <div class="diag-section">
                        <h4>Accelerometer Spectrum</h4>
                        <canvas id="diag-accel-spectrum" class="spectrum-canvas" width="500" height="80"></canvas>
                    </div>
                    
                    <div class="diag-section">
                        <h4>Session Statistics</h4>
                        <div class="diag-grid" id="diag-stats">
                            <div class="diag-item"><span class="label">Total Chatter Events</span><span class="value" id="diag-chatter-events">${this.state.sessionChatterEvents}</span></div>
                            <div class="diag-item"><span class="label">Session Duration</span><span class="value" id="diag-session-duration">${this.getSessionSummary().duration}</span></div>
                            <div class="diag-item"><span class="label">Max Chatter Score</span><span class="value" id="diag-max-score">${this.state.sessionMaxScore.toFixed(2)}</span></div>
                            <div class="diag-item"><span class="label">Avg Score</span><span class="value" id="diag-avg-score">${this.state.sessionAvgScore.toFixed(3)}</span></div>
                            <div class="diag-item"><span class="label">Feed Reductions</span><span class="value" id="diag-feed-reductions">${this.state.sessionFeedReductions}</span></div>
                            <div class="diag-item"><span class="label">Recoveries</span><span class="value" id="diag-recoveries">${this.state.sessionRecoveries}</span></div>
                            <div class="diag-item"><span class="label">Cutting Time</span><span class="value" id="diag-cutting-time">${this.getSessionSummary().cuttingTime}</span></div>
                            <div class="diag-item"><span class="label">Session Efficiency</span><span class="value" id="diag-efficiency">${this.getSessionSummary().efficiency}</span></div>
                        </div>
                        <button class="chatter-btn secondary" style="width:100%;margin-top:8px;font-size:10px;" onclick="window.chatterDetection.resetSession();">
                            🔄 Reset Session
                        </button>
                    </div>
                    
                    <div class="diag-section">
                        <h4>🧠 Advanced Analysis</h4>
                        <div class="diag-grid">
                            <div class="diag-item"><span class="label">Low Band (50-200Hz)</span><span class="value" id="analysis-low-band">---</span></div>
                            <div class="diag-item"><span class="label">Mid Band (200-1kHz)</span><span class="value" id="analysis-mid-band">---</span></div>
                            <div class="diag-item"><span class="label">High Band (1kHz+)</span><span class="value" id="analysis-high-band">---</span></div>
                            <div class="diag-item"><span class="label">Harmonics</span><span class="value" id="analysis-harmonics">---</span></div>
                            <div class="diag-item"><span class="label">Pattern</span><span class="value" id="analysis-pattern">---</span></div>
                            <div class="diag-item"><span class="label">Confidence</span><span class="value" id="analysis-confidence">---</span></div>
                            <div class="diag-item"><span class="label">Prediction</span><span class="value" id="analysis-prediction">---</span></div>
                            <div class="diag-item"><span class="label">EMA Score</span><span class="value">${(this.state.emaCombined || 0).toFixed(3)}</span></div>
                        </div>
                    </div>
                    
                    <div class="diag-section">
                        <h4>🗺️ Chatter Map</h4>
                        <canvas id="chatter-map-canvas" style="width:100%;height:120px;background:rgba(0,0,0,0.3);border-radius:4px;" width="500" height="120"></canvas>
                        <div style="font-size:10px;opacity:0.5;margin-top:4px;">X/Y positions where chatter was detected. Red = severe, green = mild.</div>
                        <div style="display:flex;gap:8px;margin-top:8px;">
                            <button class="chatter-btn secondary" style="flex:1;font-size:10px;" onclick="window.chatterDetection.send('map');">
                                Refresh Map
                            </button>
                            <button class="chatter-btn danger" style="flex:1;font-size:10px;" onclick="window.chatterDetection.send('clearMap');">
                                Clear Map
                            </button>
                        </div>
                    </div>
                    
                    <div class="diag-section">
                        <h4>Data Export</h4>
                        <div style="display:flex;gap:8px;flex-wrap:wrap;">
                            <button class="chatter-btn secondary" style="flex:1;min-width:120px;" onclick="window.chatterDetection.exportSessionLog();">
                                📋 Export Log
                            </button>
                            <button class="chatter-btn secondary" style="flex:1;min-width:120px;" onclick="window.chatterDetection.exportSettings();">
                                ⚙️ Export Config
                            </button>
                            <button class="chatter-btn secondary" style="flex:1;min-width:120px;" onclick="window.chatterDetection.startRecording();" id="diag-record-btn">
                                🔴 Record Data
                            </button>
                        </div>
                    </div>
                    
                    <div style="display:flex;gap:8px;">
                        <button class="chatter-btn secondary" style="flex:1;" onclick="window.chatterDetection.send('spectrum');window.chatterDetection.send('diag');window.chatterDetection.send('analysis');window.chatterDetection.send('map');">
                            🔄 Refresh All
                        </button>
                        <button class="chatter-btn danger" style="flex:1;" onclick="window.chatterDetection.resetStats();">
                            🗑️ Reset Stats
                        </button>
                    </div>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        this.diagModalOpen = true;

        // Close handling
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.remove();
            }
        });
        const closeBtn = modal.querySelector('.diag-close');
        if (closeBtn) {
            closeBtn.onclick = () => modal.remove();
        }
        modal.addEventListener('DOMNodeRemoved', () => {
            if (!document.getElementById('chatter-diag-modal')) {
                this.diagModalOpen = false;
            }
        });

        // Request all diagnostic data
        this.send('stats');
        this.send('analysis');
        this.send('map');
    }

    // Handle non-state WebSocket messages
    handleAuxMessage(data) {
        // Store for later use even if modal is closed
        if (data.type === 'chatterMap') {
            this._chatterMap = data;
            this.updateChatterMapUI();
            return;
        }
        
        if (data.type === 'features') {
            this._mlFeatures = data;
            console.log('[Chatter] ML Features:', data);
            return;
        }
        
        if (data.type === 'analysis') {
            this._analysisData = data;
            this.updateAnalysisUI(data);
            return;
        }
        
        if (data.type === 'settings') {
            // Settings export response
            this.downloadFile('chatter-settings.json', JSON.stringify(data, null, 2), 'application/json');
            return;
        }
        
        if (data.type === 'network') {
            console.log('[Chatter] Network info:', data);
            return;
        }

        if (!this.diagModalOpen) return;

        try {
            if (data.type === 'diagnostic') {
                const heap = document.getElementById('diag-heap');
                const up = document.getElementById('diag-uptime');
                const rssi = document.getElementById('diag-rssi');
                const clients = document.getElementById('diag-clients');
                const ar = document.getElementById('diag-audio-range');
                const vr = document.getElementById('diag-accel-range');
                const tpf = document.getElementById('diag-tooth-freq');
                if (heap) heap.textContent = `${(data.freeHeap / 1024).toFixed(1)} KB`;
                if (up) up.textContent = `${Math.floor(data.uptime / 60)}m ${data.uptime % 60}s`;
                if (rssi) rssi.textContent = `${data.wifiRSSI} dBm`;
                if (clients) clients.textContent = data.wsClients;
                if (ar) ar.textContent = data.audioRange;
                if (vr) vr.textContent = data.accelRange;
                if (tpf) tpf.textContent = `${data.toothPassFreq} Hz`;
                
                // Update sensor health from diagnostic data
                if (data.sensors) {
                    this.updateSensorHealthUI(data.sensors);
                }
                return;
            }

            if (data.type === 'spectrum') {
                this.drawSpectrumGraph('diag-audio-spectrum', data.audio, data.audioStartHz, data.audioHzPerBin, 'audio');
                this.drawSpectrumGraph('diag-accel-spectrum', data.accel, data.accelStartHz, data.accelHzPerBin, 'accel');
                return;
            }

            if (data.type === 'stats') {
                const ce = document.getElementById('diag-chatter-events');
                const ct = document.getElementById('diag-cutting-time');
                const ms = document.getElementById('diag-max-score');
                if (ce) ce.textContent = data.totalChatterEvents;
                if (ct) ct.textContent = `${Math.floor(data.totalCuttingTime / 60)}m ${data.totalCuttingTime % 60}s`;
                if (ms) ms.textContent = (data.maxChatterScore ?? 0).toFixed(3);
            }
        } catch (e) {
            // ignore UI update errors
        }
    }
    
    // Update advanced analysis UI
    updateAnalysisUI(data) {
        // Update frequency bands display
        const bandLow = document.getElementById('analysis-low-band');
        const bandMid = document.getElementById('analysis-mid-band');
        const bandHigh = document.getElementById('analysis-high-band');
        if (bandLow) bandLow.textContent = data.lowBand.toFixed(2);
        if (bandMid) bandMid.textContent = data.midBand.toFixed(2);
        if (bandHigh) bandHigh.textContent = data.highBand.toFixed(2);
        
        // Harmonics
        const harmonicsEl = document.getElementById('analysis-harmonics');
        if (harmonicsEl) {
            harmonicsEl.textContent = data.harmonicsDetected ? 
                `Yes (${data.harmonicRatio.toFixed(2)} ratio)` : 'No';
        }
        
        // Pattern
        const patternEl = document.getElementById('analysis-pattern');
        if (patternEl) {
            let pattern = 'Normal';
            if (data.risingChatter) pattern = '⚠️ Rising';
            else if (data.stableChatter) pattern = '🔴 Stable Chatter';
            else if (data.intermittent) pattern = '⚡ Intermittent';
            patternEl.textContent = pattern;
        }
        
        // Confidence
        const confEl = document.getElementById('analysis-confidence');
        if (confEl) confEl.textContent = `${(data.confidence * 100).toFixed(0)}%`;
        
        // Prediction
        const predEl = document.getElementById('analysis-prediction');
        if (predEl) {
            if (data.ticksToChatter > 0 && data.ticksToChatter < 20) {
                predEl.textContent = `~${(data.ticksToChatter * 0.05).toFixed(1)}s to threshold`;
                predEl.style.color = '#ff6600';
            } else if (data.predicted > this.state.threshold) {
                predEl.textContent = 'Chatter likely';
                predEl.style.color = '#ff4444';
            } else {
                predEl.textContent = 'Stable';
                predEl.style.color = '#44ff44';
            }
        }
    }
    
    // Update chatter map visualization
    updateChatterMapUI() {
        const canvas = document.getElementById('chatter-map-canvas');
        if (!canvas || !this._chatterMap) return;
        
        const ctx = canvas.getContext('2d');
        const w = canvas.width;
        const h = canvas.height;
        const positions = this._chatterMap.positions || [];
        
        // Clear
        ctx.fillStyle = 'rgba(0,0,0,0.9)';
        ctx.fillRect(0, 0, w, h);
        
        if (positions.length === 0) {
            ctx.fillStyle = 'rgba(255,255,255,0.5)';
            ctx.font = '12px sans-serif';
            ctx.fillText('No chatter positions logged', w/2 - 70, h/2);
            return;
        }
        
        // Find bounds
        let minX = Infinity, maxX = -Infinity;
        let minY = Infinity, maxY = -Infinity;
        for (const p of positions) {
            minX = Math.min(minX, p.x);
            maxX = Math.max(maxX, p.x);
            minY = Math.min(minY, p.y);
            maxY = Math.max(maxY, p.y);
        }
        
        // Add margin
        const rangeX = maxX - minX || 1;
        const rangeY = maxY - minY || 1;
        const margin = 20;
        
        // Draw grid
        ctx.strokeStyle = 'rgba(100,100,100,0.3)';
        ctx.lineWidth = 1;
        for (let i = 0; i <= 4; i++) {
            const x = margin + (i * (w - 2*margin) / 4);
            const y = margin + (i * (h - 2*margin) / 4);
            ctx.beginPath();
            ctx.moveTo(x, margin);
            ctx.lineTo(x, h - margin);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(margin, y);
            ctx.lineTo(w - margin, y);
            ctx.stroke();
        }
        
        // Draw chatter points
        for (const p of positions) {
            const x = margin + ((p.x - minX) / rangeX) * (w - 2*margin);
            const y = h - margin - ((p.y - minY) / rangeY) * (h - 2*margin);
            const intensity = Math.min(1, p.score / this.state.threshold);
            
            // Color based on score
            const r = Math.floor(255 * intensity);
            const g = Math.floor(255 * (1 - intensity));
            ctx.fillStyle = `rgba(${r},${g},0,0.8)`;
            ctx.beginPath();
            ctx.arc(x, y, 4 + intensity * 4, 0, Math.PI * 2);
            ctx.fill();
        }
        
        // Labels
        ctx.fillStyle = 'rgba(255,255,255,0.7)';
        ctx.font = '10px monospace';
        ctx.fillText(`X: ${minX.toFixed(1)} - ${maxX.toFixed(1)}`, 5, h - 5);
        ctx.fillText(`Y: ${minY.toFixed(1)} - ${maxY.toFixed(1)}`, w - 80, h - 5);
        ctx.fillText(`${positions.length} points`, 5, 12);
    }
    
    // ========================================================================
    // SMART RECOMMENDATIONS
    // ========================================================================
    
    // Analyze session data and suggest improvements
    getSmartRecommendations() {
        const recommendations = [];
        
        // Analyze from current state
        const s = this.state;
        
        // Check frequency bands
        const bands = this.getFrequencyBands();
        if (bands.mid > bands.low * 2 && bands.mid > bands.high * 2) {
            recommendations.push({
                type: 'info',
                icon: '📊',
                title: 'Mid-frequency dominance detected',
                description: 'High energy in 200-1000Hz range is typical of chatter. Consider reducing RPM or feed rate.',
                action: () => this.send('mode:aggressive')
            });
        }
        
        // Check harmonics
        if (this.hasHarmonics() && s.harmonicRatio > 0.5) {
            recommendations.push({
                type: 'warning',
                icon: '🔊',
                title: 'Strong harmonic pattern',
                description: `Harmonic ratio: ${s.harmonicRatio.toFixed(2)}. This suggests resonance. Try different spindle speed.`,
                suggestion: `Current RPM: ${s.rpm}. Try: ${Math.round(s.rpm * 0.85)} or ${Math.round(s.rpm * 1.15)}`
            });
        }
        
        // Check trend
        if (s.trend > 0.02 && s.combined > s.threshold * 0.6) {
            recommendations.push({
                type: 'urgent',
                icon: '⚠️',
                title: 'Rising chatter detected',
                description: 'Chatter is building up. Preemptive action recommended.',
                action: () => {
                    const newFeed = Math.max(20, s.feed - 10);
                    console.log(`[Smart] Preemptive feed reduction to ${newFeed}%`);
                }
            });
        }
        
        // Check intermittent pattern
        if (s.intermittent) {
            recommendations.push({
                type: 'info',
                icon: '⚡',
                title: 'Intermittent chatter',
                description: 'Chatter comes and goes. This may indicate varying material hardness or tool engagement.',
                suggestion: 'Consider more consistent depth of cut or check for backlash.'
            });
        }
        
        // Check sensor agreement
        const spread = Math.max(s.audio, s.accel, s.current) - Math.min(s.audio, s.accel, s.current);
        if (spread > 0.3 && s.combined > 0.3) {
            const highSensor = s.audio > s.accel && s.audio > s.current ? 'Audio' :
                              s.accel > s.current ? 'Accel' : 'Current';
            recommendations.push({
                type: 'info',
                icon: '🔧',
                title: `${highSensor} sensor dominant`,
                description: `Consider adjusting sensor weights. ${highSensor} may be over-reporting.`,
                suggestion: `Current weights: Audio=${s.wAudio}, Accel=${s.wAccel}, Current=${s.wCurrent}`
            });
        }
        
        // Check if stable at reduced feed
        if (s.stableCount > 20 && s.feed < 90 && s.feed > 50) {
            recommendations.push({
                type: 'success',
                icon: '✅',
                title: 'Stable at reduced feed',
                description: `System stable at ${s.feed}% feed. You may save this as the optimal setting.`,
                action: () => {
                    localStorage.setItem(`optimalFeed_${s.material}`, s.feed);
                    console.log(`[Smart] Saved optimal feed ${s.feed}% for ${s.material}`);
                }
            });
        }
        
        // Check material-specific
        const optimalFeed = localStorage.getItem(`optimalFeed_${s.material}`);
        if (optimalFeed && s.feed > parseInt(optimalFeed) + 10 && s.chatter) {
            recommendations.push({
                type: 'warning',
                icon: '💡',
                title: 'Previously found optimal',
                description: `For ${s.material}, you previously found ${optimalFeed}% feed to be stable.`,
                suggestion: `Consider starting at ${optimalFeed}% for this material.`
            });
        }
        
        // Low confidence with detection
        if (s.chatter && s.confidence < 0.5) {
            recommendations.push({
                type: 'info',
                icon: '❓',
                title: 'Low confidence detection',
                description: 'Chatter detected but confidence is low. May be false positive.',
                suggestion: 'Consider running "learn" to recalibrate noise floor.'
            });
        }
        
        // Prediction warning
        if (this.isChatterPredicted()) {
            recommendations.push({
                type: 'urgent',
                icon: '⏱️',
                title: 'Chatter predicted soon',
                description: `Estimated ${(s.ticksToChatter * 0.05).toFixed(1)} seconds until threshold.`,
                action: () => this.send('mode:aggressive')
            });
        }
        
        return recommendations;
    }
    
    // Display recommendations in UI
    showRecommendations() {
        const recommendations = this.getSmartRecommendations();
        
        if (recommendations.length === 0) {
            this.showNotification('No recommendations at this time', 'success');
            return;
        }
        
        // Create recommendations modal
        const modal = document.createElement('div');
        modal.id = 'chatter-recommendations-modal';
        modal.innerHTML = `
            <style>
                #chatter-recommendations-modal {
                    position: fixed;
                    inset: 0;
                    background: rgba(0,0,0,0.9);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    z-index: 100001;
                    font-family: 'Segoe UI', system-ui, sans-serif;
                }
                .rec-dialog {
                    background: linear-gradient(145deg, #1a1a2e, #16213e);
                    border-radius: 16px;
                    width: 450px;
                    max-width: 95vw;
                    max-height: 80vh;
                    overflow-y: auto;
                    color: white;
                    box-shadow: 0 20px 60px rgba(0,0,0,0.5);
                }
                .rec-header {
                    padding: 20px 24px 12px;
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    border-bottom: 1px solid rgba(255,255,255,0.1);
                }
                .rec-header h2 { margin: 0; font-size: 18px; }
                .rec-close {
                    background: none;
                    border: none;
                    color: white;
                    font-size: 24px;
                    cursor: pointer;
                    opacity: 0.6;
                }
                .rec-close:hover { opacity: 1; }
                .rec-body { padding: 16px 24px 24px; }
                .rec-item {
                    padding: 12px;
                    margin-bottom: 10px;
                    border-radius: 8px;
                    background: rgba(255,255,255,0.05);
                    border-left: 3px solid #888;
                }
                .rec-item.urgent { border-left-color: #ff4444; background: rgba(255,0,0,0.1); }
                .rec-item.warning { border-left-color: #ffc800; background: rgba(255,200,0,0.1); }
                .rec-item.success { border-left-color: #44ff44; background: rgba(0,255,0,0.1); }
                .rec-item.info { border-left-color: #4488ff; }
                .rec-title { font-weight: 600; font-size: 14px; margin-bottom: 4px; }
                .rec-desc { font-size: 12px; opacity: 0.8; margin-bottom: 4px; }
                .rec-suggestion { font-size: 11px; opacity: 0.6; font-style: italic; }
            </style>
            <div class="rec-dialog">
                <div class="rec-header">
                    <h2>💡 Smart Recommendations</h2>
                    <button class="rec-close" onclick="document.getElementById('chatter-recommendations-modal').remove()">×</button>
                </div>
                <div class="rec-body">
                    ${recommendations.map(r => `
                        <div class="rec-item ${r.type}">
                            <div class="rec-title">${r.icon} ${r.title}</div>
                            <div class="rec-desc">${r.description}</div>
                            ${r.suggestion ? `<div class="rec-suggestion">${r.suggestion}</div>` : ''}
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        modal.addEventListener('click', (e) => {
            if (e.target === modal) modal.remove();
        });
    }
    
    // Show a notification
    showNotification(message, type = 'info') {
        const colors = {
            success: '#44ff44',
            warning: '#ffc800',
            danger: '#ff4444',
            info: '#4488ff'
        };
        
        const notif = document.createElement('div');
        notif.style.cssText = `
            position: fixed;
            bottom: 20px;
            right: 20px;
            background: ${colors[type] || colors.info};
            color: ${type === 'warning' ? '#000' : '#fff'};
            padding: 12px 20px;
            border-radius: 8px;
            font-size: 14px;
            z-index: 100002;
            box-shadow: 0 4px 20px rgba(0,0,0,0.3);
            animation: slideIn 0.3s ease;
        `;
        notif.textContent = message;
        document.body.appendChild(notif);
        
        setTimeout(() => {
            notif.style.opacity = '0';
            notif.style.transition = 'opacity 0.3s';
            setTimeout(() => notif.remove(), 300);
        }, 3000);
    }
    
    // Draw spectrum graph on canvas
    drawSpectrumGraph(canvasId, data, startHz, hzPerBin, type) {
        const canvas = document.getElementById(canvasId);
        if (!canvas || !data) return;
        
        const ctx = canvas.getContext('2d');
        const w = canvas.width;
        const h = canvas.height;
        
        // Clear
        ctx.fillStyle = 'rgba(0,0,0,0.8)';
        ctx.fillRect(0, 0, w, h);
        
        // Find max for normalization
        const maxVal = Math.max(...data, 1);
        
        // Draw bars
        const barWidth = w / data.length;
        for (let i = 0; i < data.length; i++) {
            const x = i * barWidth;
            const barHeight = (data[i] / maxVal) * (h - 10);
            const freq = startHz + (i * hzPerBin);
            
            // Color based on frequency (chatter zone is red)
            let color;
            if (type === 'audio') {
                // Audio chatter zone: 800-4000 Hz typically
                color = (freq >= 800 && freq <= 4000) ? '#ff4444' : '#4488ff';
            } else {
                // Accel chatter zone: 100-400 Hz
                color = (freq >= 100 && freq <= 400) ? '#ff4444' : '#44ff88';
            }
            
            ctx.fillStyle = color;
            ctx.fillRect(x, h - barHeight, barWidth - 1, barHeight);
        }
        
        // Draw frequency labels
        ctx.fillStyle = 'rgba(255,255,255,0.6)';
        ctx.font = '9px monospace';
        ctx.fillText(`${startHz}Hz`, 2, 10);
        ctx.fillText(`${startHz + data.length * hzPerBin}Hz`, w - 50, 10);
    }
    
    // ========================================================================
    // DATA EXPORT AND RECORDING
    // ========================================================================
    
    // Export session log as JSON
    exportSessionLog() {
        const log = {
            exportDate: new Date().toISOString(),
            session: {
                material: this.state.material,
                operation: this.operations[this.state.operation],
                tool: `${this.state.toolDia}mm ${this.state.toolFlutes}F`,
                rpm: this.state.rpm,
                threshold: this.state.threshold
            },
            history: {
                combined: this.history.combined.slice(-200),
                amps: this.history.amps.slice(-200),
                feed: this.history.feed.slice(-200)
            },
            alerts: this._alertLog || []
        };
        
        this.downloadFile('chatter-session-log.json', JSON.stringify(log, null, 2));
    }
    
    // Export current settings
    exportSettings() {
        const settings = {
            material: this.state.material,
            materialIndex: this.state.materialIndex,
            operation: this.state.operation,
            toolDia: this.state.toolDia,
            toolFlutes: this.state.toolFlutes,
            rpm: this.state.rpm,
            threshold: this.state.threshold,
            noiseFloor: this.state.noiseFloor,
            weights: {
                audio: this.state.wAudio,
                accel: this.state.wAccel,
                current: this.state.wCurrent
            },
            mode: this.state.mode,
            audioEnabled: this.audioEnabled,
            espAddress: localStorage.getItem('chatterEspIp')
        };
        
        this.downloadFile('chatter-settings.json', JSON.stringify(settings, null, 2));
    }
    
    // Import settings from file
    importSettings(jsonString) {
        try {
            const settings = JSON.parse(jsonString);
            if (settings.material) this.setMaterial(settings.material);
            if (settings.operation !== undefined) this.setOperation(this.operations[settings.operation]);
            if (settings.toolDia && settings.toolFlutes && settings.rpm) {
                this.setTool(settings.toolDia, settings.toolFlutes, settings.rpm);
            }
            if (settings.threshold) this.setThreshold(settings.threshold);
            console.log('[Chatter] Settings imported successfully');
            return true;
        } catch (e) {
            console.error('[Chatter] Failed to import settings:', e);
            return false;
        }
    }
    
    // Start recording data to memory
    startRecording() {
        if (this._recording) {
            this.stopRecording();
            return;
        }
        
        this._recording = true;
        this._recordedData = [];
        this._recordStart = Date.now();
        
        // Update button
        const btn = document.getElementById('diag-record-btn');
        if (btn) {
            btn.textContent = '⏹️ Stop Recording';
            btn.classList.remove('secondary');
            btn.classList.add('danger');
        }
        
        console.log('[Chatter] Recording started');
    }
    
    stopRecording() {
        if (!this._recording) return;
        
        this._recording = false;
        const duration = (Date.now() - this._recordStart) / 1000;
        
        // Update button
        const btn = document.getElementById('diag-record-btn');
        if (btn) {
            btn.textContent = '🔴 Record Data';
            btn.classList.remove('danger');
            btn.classList.add('secondary');
        }
        
        // Export recorded data
        const data = {
            recordDate: new Date().toISOString(),
            duration: duration,
            sampleCount: this._recordedData.length,
            material: this.state.material,
            samples: this._recordedData
        };
        
        this.downloadFile('chatter-recording.json', JSON.stringify(data, null, 2));
        console.log(`[Chatter] Recording stopped: ${this._recordedData.length} samples over ${duration.toFixed(1)}s`);
        
        this._recordedData = [];
    }
    
    // Called on each update to record data if recording
    recordSample() {
        if (!this._recording) return;
        
        this._recordedData.push({
            t: Date.now() - this._recordStart,
            a: Math.round(this.state.audio * 1000) / 1000,
            v: Math.round(this.state.accel * 1000) / 1000,
            c: Math.round(this.state.current * 1000) / 1000,
            s: Math.round(this.state.combined * 1000) / 1000,
            f: this.state.feed,
            amps: Math.round(this.state.amps * 10) / 10,
            chatter: this.state.chatter ? 1 : 0
        });
        
        // Limit to 30 minutes of data at 20Hz = 36000 samples
        if (this._recordedData.length > 36000) {
            this.stopRecording();
        }
    }
    
    // Helper to download a file
    downloadFile(filename, content) {
        const blob = new Blob([content], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }
    
    // Log alerts for export
    logAlert(alert) {
        if (!this._alertLog) this._alertLog = [];
        this._alertLog.push({
            time: new Date().toISOString(),
            ...alert
        });
        // Keep last 100 alerts
        if (this._alertLog.length > 100) this._alertLog.shift();
    }
    
    // ========================================================================
    // FLUIDCNC INTEGRATION
    // ========================================================================
    
    // Update position from FluidCNC status (call this from FluidCNC's status handler)
    updatePosition(x, y, z) {
        this.state.posX = x;
        this.state.posY = y;
        this.state.posZ = z;
        this.send(`pos:${x},${y},${z}`);
    }
    
    // Update RPM from FluidCNC spindle status
    updateRPM(rpm) {
        this.state.rpm = rpm;
        this.send(`rpm:${rpm}`);
    }
    
    // Send current position if FluidCNC provides machine position
    syncPosition() {
        // Try to get position from FluidCNC's state
        if (window.fluidNC && window.fluidNC.machineState) {
            const pos = window.fluidNC.machineState.position;
            if (pos) {
                this.updatePosition(pos.x || 0, pos.y || 0, pos.z || 0);
            }
        }
    }
    
    // Get chatter map data
    getChatterMap() {
        this.send('map');
        return this._chatterMap || { positions: [] };
    }
    
    // Get ML features for training
    getMLFeatures() {
        this.send('features');
        return this._mlFeatures || { features: [] };
    }
    
    // Clear chatter map
    clearChatterMap() {
        this.send('clearMap');
        this._chatterMap = null;
    }
    
    // Get advanced analysis data
    getAnalysis() {
        this.send('analysis');
        return this._analysisData || {};
    }
    
    // Check if chatter is predicted soon
    isChatterPredicted() {
        return this.state.ticksToChatter > 0 && this.state.ticksToChatter < 10;
    }
    
    // Get detection confidence (0-1)
    getConfidence() {
        return this.state.confidence || 0;
    }
    
    // Get pattern type
    getPattern() {
        if (this.state.risingChatter) return 'rising';
        if (this.state.stableChatter) return 'stable';
        if (this.state.intermittent) return 'intermittent';
        return 'normal';
    }
    
    // Get harmonics status
    hasHarmonics() {
        return this.state.harmonics || false;
    }
    
    // Get frequency band energies
    getFrequencyBands() {
        return {
            low: this.state.lowBand || 0,
            mid: this.state.midBand || 0,
            high: this.state.highBand || 0
        };
    }
    
    // ========================================================================
    // TOOL WEAR TRACKING
    // ========================================================================
    
    // Update tool wear estimation (call from updateHistory)
    updateToolWear() {
        const now = Date.now();
        const deltaSeconds = (now - this._lastCuttingCheck) / 1000;
        this._lastCuttingCheck = now;
        
        // Only track when actually cutting
        if (this.state.cutting && this.state.amps > this.state.idleCurrent) {
            // Accumulate load
            const load = this.state.amps - this.state.idleCurrent;
            this.state.cumulativeLoad += load * deltaSeconds;
            this.state.cuttingSeconds += deltaSeconds;
            
            // Track for average
            this._cuttingLoadSum += load;
            this._cuttingLoadCount++;
            this.state.avgLoadCurrent = this._cuttingLoadSum / this._cuttingLoadCount;
            
            // Estimate wear based on cumulative load
            // Rough estimate: 1000 amp-seconds = 1% wear for typical endmill
            // Adjust multiplier based on material hardness
            const materialMultiplier = {
                'aluminum': 0.5,
                'plastic': 0.3,
                'wood': 0.2,
                'brass': 0.7,
                'copper': 0.6,
                'steel': 1.5,
                'composite': 0.8
            }[this.state.material] || 1.0;
            
            this.state.toolWear = Math.min(100, (this.state.cumulativeLoad / 1000) * materialMultiplier);
        }
    }
    
    // Reset tool wear (new tool installed)
    resetToolWear() {
        this.state.toolWear = 0;
        this.state.cumulativeLoad = 0;
        this.state.cuttingSeconds = 0;
        this.state.avgLoadCurrent = 0;
        this._cuttingLoadSum = 0;
        this._cuttingLoadCount = 0;
        this._toolWearStart = Date.now();
        this.showNotification('Tool wear reset - new tool', 'success');
    }
    
    // Get tool wear status
    getToolWearStatus() {
        const wear = this.state.toolWear;
        if (wear < 20) return { status: 'good', icon: '🟢', text: 'Good' };
        if (wear < 50) return { status: 'ok', icon: '🟡', text: 'OK' };
        if (wear < 80) return { status: 'worn', icon: '🟠', text: 'Worn' };
        return { status: 'replace', icon: '🔴', text: 'Replace' };
    }
    
    // ========================================================================
    // AUTO-TUNING WIZARD
    // ========================================================================
    
    // Start auto-tuning wizard
    startAutoTuning() {
        this._tuningPhase = 0;
        this._tuningData = {
            idleSamples: [],
            cuttingSamples: [],
            chatterSamples: [],
            startTime: Date.now()
        };
        
        const modal = document.createElement('div');
        modal.id = 'chatter-tuning-modal';
        modal.innerHTML = `
            <style>
                #chatter-tuning-modal {
                    position: fixed;
                    inset: 0;
                    background: rgba(0,0,0,0.9);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    z-index: 100001;
                    font-family: 'Segoe UI', system-ui, sans-serif;
                }
                .tuning-dialog {
                    background: linear-gradient(145deg, #1a1a2e, #16213e);
                    border-radius: 16px;
                    width: 400px;
                    max-width: 95vw;
                    color: white;
                    box-shadow: 0 20px 60px rgba(0,0,0,0.5);
                    padding: 24px;
                }
                .tuning-header { font-size: 20px; font-weight: 600; margin-bottom: 16px; }
                .tuning-step { 
                    padding: 16px;
                    background: rgba(255,255,255,0.05);
                    border-radius: 8px;
                    margin-bottom: 16px;
                }
                .tuning-step.active { border: 2px solid #4488ff; }
                .tuning-step.done { border: 2px solid #44ff44; opacity: 0.7; }
                .tuning-progress {
                    height: 8px;
                    background: rgba(255,255,255,0.1);
                    border-radius: 4px;
                    margin: 16px 0;
                    overflow: hidden;
                }
                .tuning-progress-bar {
                    height: 100%;
                    background: #4488ff;
                    transition: width 0.3s;
                }
                .tuning-btn {
                    width: 100%;
                    padding: 12px;
                    border: none;
                    border-radius: 8px;
                    font-size: 14px;
                    font-weight: 600;
                    cursor: pointer;
                    background: #4488ff;
                    color: white;
                }
                .tuning-btn:hover { background: #3377ee; }
                .tuning-btn:disabled { opacity: 0.5; cursor: not-allowed; }
            </style>
            <div class="tuning-dialog">
                <div class="tuning-header">🎛️ Auto-Tuning Wizard</div>
                
                <div class="tuning-step" id="tuning-step-1">
                    <strong>Step 1: Idle Baseline</strong>
                    <p style="font-size:12px;opacity:0.8;margin:8px 0;">
                        Turn spindle ON but don't cut. We'll measure background noise.
                    </p>
                    <div id="tuning-samples-1" style="font-size:11px;opacity:0.6;">0 samples</div>
                </div>
                
                <div class="tuning-step" id="tuning-step-2">
                    <strong>Step 2: Normal Cutting</strong>
                    <p style="font-size:12px;opacity:0.8;margin:8px 0;">
                        Make a normal cut with good settings. We'll learn what "good" looks like.
                    </p>
                    <div id="tuning-samples-2" style="font-size:11px;opacity:0.6;">0 samples</div>
                </div>
                
                <div class="tuning-step" id="tuning-step-3">
                    <strong>Step 3: Intentional Chatter (Optional)</strong>
                    <p style="font-size:12px;opacity:0.8;margin:8px 0;">
                        If safe, create chatter (high feed/deep cut). Skip if not comfortable.
                    </p>
                    <div id="tuning-samples-3" style="font-size:11px;opacity:0.6;">0 samples</div>
                </div>
                
                <div class="tuning-progress">
                    <div class="tuning-progress-bar" id="tuning-progress" style="width:0%"></div>
                </div>
                
                <div style="display:flex;gap:8px;">
                    <button class="tuning-btn" id="tuning-action" onclick="window.chatterDetection.tuningAction()">
                        Start Phase 1
                    </button>
                    <button class="tuning-btn" style="background:#666;" onclick="window.chatterDetection.cancelTuning()">
                        Cancel
                    </button>
                </div>
                
                <div id="tuning-result" style="margin-top:16px;padding:12px;background:rgba(0,255,0,0.1);border-radius:8px;display:none;">
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
    }
    
    // Handle tuning action button
    tuningAction() {
        const btn = document.getElementById('tuning-action');
        const progress = document.getElementById('tuning-progress');
        
        if (this._tuningPhase === 0) {
            // Start phase 1 - idle
            this._tuningPhase = 1;
            btn.textContent = 'Collecting... (5s)';
            btn.disabled = true;
            document.getElementById('tuning-step-1').classList.add('active');
            progress.style.width = '10%';
            
            this._tuningInterval = setInterval(() => this.collectTuningSample(), 50);
            
            setTimeout(() => this.advanceTuningPhase(), 5000);
        }
        else if (this._tuningPhase === 2) {
            // Start phase 2 - cutting
            btn.textContent = 'Collecting... (10s)';
            btn.disabled = true;
            document.getElementById('tuning-step-2').classList.add('active');
            progress.style.width = '40%';
            
            setTimeout(() => this.advanceTuningPhase(), 10000);
        }
        else if (this._tuningPhase === 3) {
            // Start phase 3 - chatter (optional)
            btn.textContent = 'Collecting... (5s)';
            btn.disabled = true;
            document.getElementById('tuning-step-3').classList.add('active');
            progress.style.width = '70%';
            
            setTimeout(() => this.finishTuning(), 5000);
        }
        else if (this._tuningPhase === 4) {
            // Skip phase 3
            this.finishTuning();
        }
    }
    
    // Collect a tuning sample
    collectTuningSample() {
        const sample = {
            combined: this.state.combined,
            audio: this.state.audio,
            accel: this.state.accel,
            current: this.state.current,
            amps: this.state.amps
        };
        
        if (this._tuningPhase === 1) {
            this._tuningData.idleSamples.push(sample);
            document.getElementById('tuning-samples-1').textContent = `${this._tuningData.idleSamples.length} samples`;
        } else if (this._tuningPhase === 2) {
            this._tuningData.cuttingSamples.push(sample);
            document.getElementById('tuning-samples-2').textContent = `${this._tuningData.cuttingSamples.length} samples`;
        } else if (this._tuningPhase === 3) {
            this._tuningData.chatterSamples.push(sample);
            document.getElementById('tuning-samples-3').textContent = `${this._tuningData.chatterSamples.length} samples`;
        }
    }
    
    // Advance to next tuning phase
    advanceTuningPhase() {
        const btn = document.getElementById('tuning-action');
        
        if (this._tuningPhase === 1) {
            document.getElementById('tuning-step-1').classList.remove('active');
            document.getElementById('tuning-step-1').classList.add('done');
            this._tuningPhase = 2;
            btn.textContent = 'Start Cutting Test';
            btn.disabled = false;
            document.getElementById('tuning-progress').style.width = '33%';
        }
        else if (this._tuningPhase === 2) {
            document.getElementById('tuning-step-2').classList.remove('active');
            document.getElementById('tuning-step-2').classList.add('done');
            this._tuningPhase = 3;
            btn.textContent = 'Start Chatter Test (or Skip)';
            btn.disabled = false;
            document.getElementById('tuning-progress').style.width = '66%';
            
            // Add skip button
            const skipBtn = document.createElement('button');
            skipBtn.className = 'tuning-btn';
            skipBtn.style.background = '#666';
            skipBtn.style.marginTop = '8px';
            skipBtn.textContent = 'Skip (Use Defaults)';
            skipBtn.onclick = () => { this._tuningPhase = 4; this.tuningAction(); };
            btn.parentNode.appendChild(skipBtn);
        }
    }
    
    // Finish tuning and calculate optimal settings
    finishTuning() {
        clearInterval(this._tuningInterval);
        
        const idle = this._tuningData.idleSamples;
        const cutting = this._tuningData.cuttingSamples;
        const chatter = this._tuningData.chatterSamples;
        
        // Calculate averages
        const avgIdle = idle.length > 0 ? idle.reduce((s, x) => s + x.combined, 0) / idle.length : 0;
        const avgCutting = cutting.length > 0 ? cutting.reduce((s, x) => s + x.combined, 0) / cutting.length : 0.2;
        const avgChatter = chatter.length > 0 ? chatter.reduce((s, x) => s + x.combined, 0) / chatter.length : 0.7;
        
        // Calculate max cutting score
        const maxCutting = cutting.length > 0 ? Math.max(...cutting.map(x => x.combined)) : 0.4;
        
        // Set optimal noise floor (idle + margin)
        const optimalNoise = avgIdle * 1.3;
        
        // Set optimal threshold (between max normal cutting and chatter)
        let optimalThreshold;
        if (chatter.length > 0) {
            optimalThreshold = (maxCutting + avgChatter) / 2;
        } else {
            optimalThreshold = maxCutting * 1.5;  // 50% above max normal
        }
        optimalThreshold = Math.max(0.3, Math.min(0.9, optimalThreshold));
        
        // Calculate idle current
        const avgIdleAmps = idle.length > 0 ? idle.reduce((s, x) => s + x.amps, 0) / idle.length : 0.5;
        
        // Show results
        const result = document.getElementById('tuning-result');
        result.style.display = 'block';
        result.innerHTML = `
            <strong>✅ Tuning Complete!</strong>
            <div style="font-size:12px;margin-top:8px;">
                <div>Noise Floor: ${optimalNoise.toFixed(3)} (was ${this.state.noiseFloor.toFixed(3)})</div>
                <div>Threshold: ${optimalThreshold.toFixed(3)} (was ${this.state.threshold.toFixed(3)})</div>
                <div>Idle Current: ${avgIdleAmps.toFixed(2)}A</div>
            </div>
            <button class="tuning-btn" style="margin-top:12px;" onclick="window.chatterDetection.applyTuning(${optimalNoise}, ${optimalThreshold}, ${avgIdleAmps})">
                Apply Settings
            </button>
        `;
        
        document.getElementById('tuning-progress').style.width = '100%';
        document.getElementById('tuning-action').style.display = 'none';
    }
    
    // Cancel tuning and cleanup
    cancelTuning() {
        if (this._tuningInterval) {
            clearInterval(this._tuningInterval);
            this._tuningInterval = null;
        }
        this._tuningPhase = 0;
        this._tuningData = null;
        const modal = document.getElementById('chatter-tuning-modal');
        if (modal) modal.remove();
    }
    
    // Apply tuning results
    applyTuning(noiseFloor, threshold, idleCurrent) {
        // Cleanup interval first
        if (this._tuningInterval) {
            clearInterval(this._tuningInterval);
            this._tuningInterval = null;
        }
        
        // Send to ESP32
        this.send(JSON.stringify({
            threshold: threshold,
            noiseFloor: noiseFloor
        }));
        
        // Update local state
        this.state.noiseFloor = noiseFloor;
        this.state.threshold = threshold;
        this.state.idleCurrent = idleCurrent;
        
        // Save
        this.send('save');
        
        // Close modal
        document.getElementById('chatter-tuning-modal').remove();
        this.showNotification('Tuning applied and saved!', 'success');
    }
}

// Export for module use
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ChatterDetection;
}
