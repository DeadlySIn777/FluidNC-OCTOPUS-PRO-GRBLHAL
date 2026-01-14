/* ========================================
   FluidCNC - Enhancements v12
   
   Features:
   1. VFD Spindle Load Display (real-time from ESP32)
   2. G-code Time Estimator with ETA
   3. Audio & Push Notifications
   4. Gamepad/Controller Jogging
   5. Touch Plate Thickness Memory
   6. VFD Current to Adaptive Feed
   ======================================== */

class EnhancementsV12 {
    constructor(app) {
        this.app = app;
        this.grbl = app?.grbl;
        
        // VFD Status
        this.vfdData = {
            current: 0,
            loadPercent: 0,
            frequency: 0,
            dcVoltage: 0,
            temperature: 0,
            rpm: 0,
            faultCode: 0,
            connected: false,
            lastUpdate: 0
        };
        
        // Job Time Tracking
        this.jobTimer = {
            startTime: 0,
            estimatedSeconds: 0,
            elapsedSeconds: 0,
            remainingSeconds: 0,
            isRunning: false,
            intervalId: null
        };
        
        // Audio Notifications
        this.audio = {
            enabled: true,
            volume: 0.5,
            sounds: {},
            context: null
        };
        
        // Gamepad
        this.gamepad = {
            enabled: true,
            index: null,
            deadzone: 0.15,
            sensitivity: 1.0,
            pollInterval: null,
            lastJog: { x: 0, y: 0, z: 0 },
            continuousJogging: false
        };
        
        // Touch Plate Presets
        this.touchPlates = this.loadTouchPlates();
        
        // Initialize
        this.init();
    }
    
    init() {
        this.createUI();
        this.initAudio();
        this.initGamepad();
        this.setupEventListeners();
        this.startVfdPolling();
        
        console.log('[Enhancements v12] Initialized');
    }
    
    // ================================================================
    // VFD SPINDLE LOAD DISPLAY
    // ================================================================
    
    createUI() {
        // Add VFD widget to header
        this.createVfdWidget();
        
        // Add job timer display
        this.createJobTimerDisplay();
        
        // Add touch plate selector to probe tab
        this.createTouchPlateSelector();
        
        // Add gamepad indicator
        this.createGamepadIndicator();
        
        // Add notification settings
        this.createNotificationSettings();
    }
    
    createVfdWidget() {
        const headerCenter = document.querySelector('.header-center');
        if (!headerCenter) return;
        
        // Create VFD load widget
        const vfdWidget = document.createElement('div');
        vfdWidget.className = 'vfd-display';
        vfdWidget.id = 'vfd-widget';
        vfdWidget.innerHTML = `
            <div class="vfd-load-bar-container" title="VFD Spindle Load">
                <span class="vfd-label">LOAD</span>
                <div class="vfd-load-bar">
                    <div id="vfd-load-fill" class="vfd-load-fill" style="width: 0%"></div>
                </div>
                <span id="vfd-load-percent" class="vfd-load-value">0%</span>
            </div>
            <div class="vfd-current-display" title="Motor Current (Amps)">
                <span class="vfd-current-icon">⚡</span>
                <span id="vfd-current" class="vfd-current-value">0.0A</span>
            </div>
        `;
        
        // Insert after spindle display
        const spindleDisplay = headerCenter.querySelector('.spindle-display');
        if (spindleDisplay) {
            spindleDisplay.after(vfdWidget);
        } else {
            headerCenter.appendChild(vfdWidget);
        }
        
        // Add styles
        this.addVfdStyles();
    }
    
    addVfdStyles() {
        const style = document.createElement('style');
        style.textContent = `
            /* VFD Load Widget */
            .vfd-display {
                display: flex;
                align-items: center;
                gap: 12px;
                padding: 0 12px;
                border-left: 1px solid rgba(255,255,255,0.1);
                margin-left: 12px;
            }
            
            .vfd-load-bar-container {
                display: flex;
                align-items: center;
                gap: 6px;
            }
            
            .vfd-label {
                font-size: 10px;
                color: rgba(255,255,255,0.5);
                font-weight: 600;
            }
            
            .vfd-load-bar {
                width: 60px;
                height: 8px;
                background: rgba(0,0,0,0.3);
                border-radius: 4px;
                overflow: hidden;
            }
            
            .vfd-load-fill {
                height: 100%;
                background: linear-gradient(90deg, #00ff88 0%, #ffcc00 70%, #ff4444 100%);
                transition: width 0.3s ease;
                border-radius: 4px;
            }
            
            .vfd-load-fill.warning {
                animation: pulse-warning 0.5s ease-in-out infinite;
            }
            
            .vfd-load-fill.danger {
                animation: pulse-danger 0.3s ease-in-out infinite;
            }
            
            @keyframes pulse-warning {
                0%, 100% { opacity: 1; }
                50% { opacity: 0.7; }
            }
            
            @keyframes pulse-danger {
                0%, 100% { opacity: 1; background: #ff4444; }
                50% { opacity: 0.8; background: #ff0000; }
            }
            
            .vfd-load-value {
                font-size: 12px;
                font-weight: bold;
                min-width: 35px;
                color: #00ff88;
            }
            
            .vfd-load-value.warning { color: #ffcc00; }
            .vfd-load-value.danger { color: #ff4444; }
            
            .vfd-current-display {
                display: flex;
                align-items: center;
                gap: 4px;
            }
            
            .vfd-current-icon {
                font-size: 14px;
            }
            
            .vfd-current-value {
                font-size: 12px;
                color: #00d4ff;
                font-weight: 500;
            }
            
            /* Job Timer Display */
            .job-timer-display {
                display: flex;
                align-items: center;
                gap: 8px;
                padding: 4px 12px;
                background: rgba(0,0,0,0.2);
                border-radius: 4px;
                margin-left: 8px;
            }
            
            .job-timer-display.hidden { display: none; }
            
            .job-timer-icon { font-size: 14px; }
            
            .job-timer-eta {
                font-size: 12px;
                color: #00ff88;
                font-weight: bold;
            }
            
            .job-timer-elapsed {
                font-size: 11px;
                color: rgba(255,255,255,0.6);
            }
            
            .job-timer-remaining {
                font-size: 12px;
                color: #00d4ff;
            }
            
            /* Gamepad Indicator */
            .gamepad-indicator {
                position: fixed;
                bottom: 20px;
                left: 20px;
                padding: 8px 12px;
                background: rgba(0,0,0,0.8);
                border-radius: 8px;
                display: none;
                align-items: center;
                gap: 8px;
                z-index: 1000;
                border: 1px solid rgba(0,212,255,0.3);
            }
            
            .gamepad-indicator.connected {
                display: flex;
                border-color: #00ff88;
            }
            
            .gamepad-icon { font-size: 20px; }
            
            .gamepad-name {
                font-size: 11px;
                color: rgba(255,255,255,0.8);
                max-width: 150px;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }
            
            .gamepad-axes {
                display: flex;
                gap: 4px;
            }
            
            .gamepad-axis {
                width: 30px;
                height: 4px;
                background: rgba(255,255,255,0.2);
                border-radius: 2px;
                overflow: hidden;
            }
            
            .gamepad-axis-fill {
                height: 100%;
                background: #00d4ff;
                transition: width 0.05s linear;
            }
            
            /* Touch Plate Selector */
            .touch-plate-selector {
                display: flex;
                flex-wrap: wrap;
                gap: 8px;
                margin-bottom: 12px;
            }
            
            .touch-plate-btn {
                padding: 6px 12px;
                background: rgba(255,255,255,0.1);
                border: 1px solid rgba(255,255,255,0.2);
                border-radius: 4px;
                color: white;
                cursor: pointer;
                font-size: 12px;
                transition: all 0.2s;
            }
            
            .touch-plate-btn:hover {
                background: rgba(0,212,255,0.2);
                border-color: #00d4ff;
            }
            
            .touch-plate-btn.active {
                background: rgba(0,255,136,0.2);
                border-color: #00ff88;
            }
            
            .touch-plate-add {
                padding: 6px 10px;
                background: transparent;
                border: 1px dashed rgba(255,255,255,0.3);
                color: rgba(255,255,255,0.5);
            }
            
            /* Audio notification toggle */
            .audio-toggle {
                display: flex;
                align-items: center;
                gap: 8px;
                padding: 8px;
                background: rgba(0,0,0,0.2);
                border-radius: 4px;
            }
            
            .audio-toggle input[type="range"] {
                width: 80px;
            }
        `;
        document.head.appendChild(style);
    }
    
    createJobTimerDisplay() {
        const headerCenter = document.querySelector('.header-center');
        if (!headerCenter) return;
        
        const timerDisplay = document.createElement('div');
        timerDisplay.className = 'job-timer-display hidden';
        timerDisplay.id = 'job-timer-display';
        timerDisplay.innerHTML = `
            <span class="job-timer-icon">⏱️</span>
            <span id="job-timer-elapsed" class="job-timer-elapsed">00:00</span>
            <span style="color: rgba(255,255,255,0.3)">/</span>
            <span id="job-timer-remaining" class="job-timer-remaining">--:--</span>
            <span id="job-timer-eta" class="job-timer-eta" title="Estimated completion time"></span>
        `;
        headerCenter.appendChild(timerDisplay);
    }
    
    createTouchPlateSelector() {
        // Will be inserted when probe tab is shown
        this.touchPlateUI = null;
    }
    
    createGamepadIndicator() {
        const indicator = document.createElement('div');
        indicator.className = 'gamepad-indicator';
        indicator.id = 'gamepad-indicator';
        indicator.innerHTML = `
            <span class="gamepad-icon">🎮</span>
            <span id="gamepad-name" class="gamepad-name">Controller</span>
            <div class="gamepad-axes">
                <div class="gamepad-axis" title="X"><div id="gp-axis-x" class="gamepad-axis-fill" style="width:50%"></div></div>
                <div class="gamepad-axis" title="Y"><div id="gp-axis-y" class="gamepad-axis-fill" style="width:50%"></div></div>
                <div class="gamepad-axis" title="Z"><div id="gp-axis-z" class="gamepad-axis-fill" style="width:50%"></div></div>
            </div>
        `;
        document.body.appendChild(indicator);
    }
    
    createNotificationSettings() {
        // Audio notification settings - injected into settings tab
    }
    
    // ================================================================
    // VFD DATA POLLING
    // ================================================================
    
    startVfdPolling() {
        // Poll ESP32 for VFD data every 500ms
        setInterval(() => this.pollVfdData(), 500);
    }
    
    async pollVfdData() {
        // Priority 1: Get data from chatter detection module (ESP32 with VFD RS-485)
        if (window.chatterSystem?.state?.vfd?.ok) {
            const vfd = window.chatterSystem.state.vfd;
            // Calculate load percent from current (assume 10A = 100% for typical spindle)
            const maxCurrent = 10; // Full load current for 2.2kW spindle
            this.updateVfdDisplay({
                current: vfd.amps || 0,
                loadPercent: ((vfd.amps || 0) / maxCurrent) * 100,
                frequency: vfd.freq || 0,
                rpm: vfd.rpm || 0,
                dcVoltage: vfd.dcv || 0,
                faultCode: vfd.fault || 0,
                connected: true
            });
            return;
        }
        
        // Priority 2: Get from machine enhancements hardwareState
        if (this.app?.machineEnhancements?.hardwareState?.vfd) {
            const vfd = this.app.machineEnhancements.hardwareState.vfd;
            this.updateVfdDisplay({
                current: vfd.current || 0,
                loadPercent: (vfd.current / 10) * 100, // Estimate: 10A = 100%
                frequency: vfd.frequency || 0,
                rpm: vfd.rpm || 0,
                connected: vfd.connected || false
            });
            return;
        }
        
        // Priority 3: Direct poll to ESP32 VFD controller REST API
        const vfdUrl = localStorage.getItem('esp32VfdUrl');
        if (vfdUrl) {
            try {
                const response = await fetch(`${vfdUrl}/status`, { 
                    signal: AbortSignal.timeout(1000) 
                });
                if (response.ok) {
                    const data = await response.json();
                    if (data.vfd) {
                        this.updateVfdDisplay(data.vfd);
                    }
                }
            } catch (e) {
                // VFD not reachable
            }
        }
    }
    
    updateVfdDisplay(vfd) {
        this.vfdData = { ...this.vfdData, ...vfd, lastUpdate: Date.now() };
        
        const loadFill = document.getElementById('vfd-load-fill');
        const loadPercent = document.getElementById('vfd-load-percent');
        const currentDisplay = document.getElementById('vfd-current');
        
        if (!loadFill || !loadPercent) return;
        
        const load = Math.min(100, Math.max(0, vfd.loadPercent || 0));
        loadFill.style.width = `${load}%`;
        loadPercent.textContent = `${Math.round(load)}%`;
        
        // Color coding
        loadFill.classList.remove('warning', 'danger');
        loadPercent.classList.remove('warning', 'danger');
        
        if (load > 90) {
            loadFill.classList.add('danger');
            loadPercent.classList.add('danger');
        } else if (load > 70) {
            loadFill.classList.add('warning');
            loadPercent.classList.add('warning');
        }
        
        // Current display
        if (currentDisplay) {
            currentDisplay.textContent = `${(vfd.current || 0).toFixed(1)}A`;
        }
        
        // Feed adaptive feed rate if enabled
        this.updateAdaptiveFeedFromVfd(load);
    }
    
    updateAdaptiveFeedFromVfd(loadPercent) {
        // Connect to machine enhancements adaptive feed
        if (this.app?.machineEnhancements?.adaptiveFeed?.enabled) {
            // Already handled by machine-enhancements.js
            return;
        }
        
        // Manual adaptive feed if not using ML system
        if (!this.app?.grbl || !this.app.grbl.state?.status === 'Run') return;
        
        const settings = JSON.parse(localStorage.getItem('adaptiveFeedSettings') || '{}');
        if (!settings.enabled) return;
        
        const threshold = settings.loadThreshold || 70;
        const maxReduction = settings.maxReduction || 50;
        
        if (loadPercent > threshold) {
            const overload = loadPercent - threshold;
            const reduction = Math.min(maxReduction, overload * 1.5);
            const newFeedPercent = Math.max(100 - reduction, 100 - maxReduction);
            
            // Only reduce, never increase above 100%
            if (newFeedPercent < 100) {
                this.app.grbl.feedOverride(Math.round(newFeedPercent));
            }
        } else if (loadPercent < threshold - 20) {
            // Gradually restore feed rate
            const currentOverride = this.app.grbl.state?.override?.feed || 100;
            if (currentOverride < 100) {
                this.app.grbl.feedOverride(Math.min(100, currentOverride + 5));
            }
        }
    }
    
    // ================================================================
    // JOB TIME ESTIMATION
    // ================================================================
    
    startJobTimer(estimatedSeconds) {
        this.jobTimer.startTime = Date.now();
        this.jobTimer.estimatedSeconds = estimatedSeconds;
        this.jobTimer.elapsedSeconds = 0;
        this.jobTimer.isRunning = true;
        
        // Show timer display
        const display = document.getElementById('job-timer-display');
        if (display) display.classList.remove('hidden');
        
        // Update every second
        this.jobTimer.intervalId = setInterval(() => this.updateJobTimer(), 1000);
        this.updateJobTimer();
    }
    
    updateJobTimer() {
        if (!this.jobTimer.isRunning) return;
        
        this.jobTimer.elapsedSeconds = Math.floor((Date.now() - this.jobTimer.startTime) / 1000);
        this.jobTimer.remainingSeconds = Math.max(0, 
            this.jobTimer.estimatedSeconds - this.jobTimer.elapsedSeconds);
        
        const elapsedEl = document.getElementById('job-timer-elapsed');
        const remainingEl = document.getElementById('job-timer-remaining');
        const etaEl = document.getElementById('job-timer-eta');
        
        if (elapsedEl) {
            elapsedEl.textContent = this.formatTime(this.jobTimer.elapsedSeconds);
        }
        
        if (remainingEl) {
            remainingEl.textContent = this.formatTime(this.jobTimer.remainingSeconds);
        }
        
        if (etaEl && this.jobTimer.remainingSeconds > 0) {
            const eta = new Date(Date.now() + this.jobTimer.remainingSeconds * 1000);
            etaEl.textContent = `ETA ${eta.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
        }
    }
    
    stopJobTimer() {
        this.jobTimer.isRunning = false;
        if (this.jobTimer.intervalId) {
            clearInterval(this.jobTimer.intervalId);
            this.jobTimer.intervalId = null;
        }
    }
    
    hideJobTimer() {
        this.stopJobTimer();
        const display = document.getElementById('job-timer-display');
        if (display) display.classList.add('hidden');
    }
    
    formatTime(seconds) {
        if (!seconds || seconds < 0) return '--:--';
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = seconds % 60;
        
        if (h > 0) {
            return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
        }
        return `${m}:${s.toString().padStart(2, '0')}`;
    }
    
    // Called when job starts
    onJobStart(gcode) {
        // Parse G-code for time estimate
        // Try visualizer's parser first
        if (this.app?.visualizer?.parser) {
            const result = this.app.visualizer.parser.parse(gcode);
            if (result?.estimatedTime > 0) {
                this.startJobTimer(result.estimatedTime);
                return;
            }
        }
        
        // Try standalone GCodeParser
        if (typeof GCodeParser !== 'undefined') {
            try {
                const parser = new GCodeParser();
                const result = parser.parse(gcode);
                if (result?.estimatedTime > 0) {
                    this.startJobTimer(result.estimatedTime);
                    return;
                }
            } catch (e) {
                console.warn('[Enhancements] Failed to parse G-code for time:', e);
            }
        }
        
        // Fallback: estimate from line count
        const lines = gcode.split('\n').filter(l => l.trim() && !l.startsWith(';') && !l.startsWith('('));
        const avgSecondsPerLine = 0.5; // Conservative estimate
        this.startJobTimer(lines.length * avgSecondsPerLine);
    }
    
    // Called when job ends
    onJobComplete(success = true) {
        this.stopJobTimer();
        
        const elapsed = this.jobTimer.elapsedSeconds;
        const message = success 
            ? `✅ Job complete! Time: ${this.formatTime(elapsed)}`
            : `❌ Job failed after ${this.formatTime(elapsed)}`;
        
        this.playSound(success ? 'jobComplete' : 'error');
        this.sendPushNotification('FluidCNC', message);
        
        // Keep timer visible for a moment
        setTimeout(() => this.hideJobTimer(), 10000);
    }
    
    // ================================================================
    // AUDIO NOTIFICATIONS
    // ================================================================
    
    initAudio() {
        // Load settings
        const settings = JSON.parse(localStorage.getItem('audioSettings') || '{}');
        this.audio.enabled = settings.enabled !== false;
        this.audio.volume = settings.volume || 0.5;
        
        // Create audio context on first user interaction
        document.addEventListener('click', () => this.ensureAudioContext(), { once: true });
        document.addEventListener('keydown', () => this.ensureAudioContext(), { once: true });
    }
    
    ensureAudioContext() {
        if (this.audio.context) return;
        
        try {
            this.audio.context = new (window.AudioContext || window.webkitAudioContext)();
            this.generateSounds();
        } catch (e) {
            console.warn('[Audio] Failed to create AudioContext:', e);
        }
    }
    
    generateSounds() {
        // Generate sounds programmatically (no external files needed)
        this.audio.sounds = {
            jobComplete: () => this.playTone([523, 659, 784], 0.2, 'sine'),     // C-E-G chord
            error: () => this.playTone([200, 150], 0.3, 'square'),              // Low warning
            warning: () => this.playTone([440, 440], 0.15, 'triangle'),         // A beep
            toolChange: () => this.playTone([880, 660, 880], 0.1, 'sine'),      // High-low-high
            probeTouch: () => this.playTone([1000], 0.05, 'sine'),              // Quick beep
            limitHit: () => this.playTone([200, 300, 200, 300], 0.1, 'square'), // Alarm
            notification: () => this.playTone([660, 880], 0.1, 'sine')          // Ding
        };
    }
    
    playTone(frequencies, duration, type = 'sine') {
        if (!this.audio.enabled || !this.audio.context) return;
        
        const ctx = this.audio.context;
        const now = ctx.currentTime;
        
        frequencies.forEach((freq, i) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            
            osc.type = type;
            osc.frequency.value = freq;
            gain.gain.value = this.audio.volume * 0.3;
            
            osc.connect(gain);
            gain.connect(ctx.destination);
            
            const startTime = now + i * duration;
            osc.start(startTime);
            gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
            osc.stop(startTime + duration + 0.1);
        });
    }
    
    playSound(name) {
        this.ensureAudioContext();
        if (this.audio.sounds[name]) {
            this.audio.sounds[name]();
        }
    }
    
    setAudioEnabled(enabled) {
        this.audio.enabled = enabled;
        localStorage.setItem('audioSettings', JSON.stringify({
            enabled: this.audio.enabled,
            volume: this.audio.volume
        }));
    }
    
    setAudioVolume(volume) {
        this.audio.volume = Math.max(0, Math.min(1, volume));
        localStorage.setItem('audioSettings', JSON.stringify({
            enabled: this.audio.enabled,
            volume: this.audio.volume
        }));
    }
    
    // ================================================================
    // PUSH NOTIFICATIONS
    // ================================================================
    
    async requestNotificationPermission() {
        if (!('Notification' in window)) {
            console.warn('[Notifications] Not supported in this browser');
            return false;
        }
        
        if (Notification.permission === 'granted') return true;
        
        const permission = await Notification.requestPermission();
        return permission === 'granted';
    }
    
    async sendPushNotification(title, body, options = {}) {
        if (!this.audio.enabled) return;
        
        // Request permission if needed
        const hasPermission = await this.requestNotificationPermission();
        if (!hasPermission) return;
        
        // Don't notify if page is visible and focused
        if (document.visibilityState === 'visible' && document.hasFocus()) {
            return;
        }
        
        try {
            new Notification(title, {
                body,
                icon: '/favicon.ico',
                badge: '/favicon.ico',
                tag: options.tag || 'fluidcnc',
                requireInteraction: options.urgent || false,
                ...options
            });
        } catch (e) {
            console.warn('[Notifications] Failed:', e);
        }
    }
    
    // ================================================================
    // GAMEPAD JOGGING
    // ================================================================
    
    initGamepad() {
        // Listen for gamepad connections
        window.addEventListener('gamepadconnected', (e) => this.onGamepadConnected(e));
        window.addEventListener('gamepaddisconnected', (e) => this.onGamepadDisconnected(e));
        
        // Check for already-connected gamepads
        this.checkGamepads();
    }
    
    checkGamepads() {
        const gamepads = navigator.getGamepads?.() || [];
        for (const gp of gamepads) {
            if (gp) {
                this.onGamepadConnected({ gamepad: gp });
                break;
            }
        }
    }
    
    onGamepadConnected(e) {
        const gp = e.gamepad;
        console.log(`[Gamepad] Connected: ${gp.id}`);
        
        this.gamepad.index = gp.index;
        this.gamepad.enabled = true;
        
        // Update UI
        const indicator = document.getElementById('gamepad-indicator');
        const nameEl = document.getElementById('gamepad-name');
        if (indicator) indicator.classList.add('connected');
        if (nameEl) nameEl.textContent = gp.id.substring(0, 30);
        
        // Start polling
        this.startGamepadPolling();
        
        this.app?.showNotification?.('🎮 Gamepad connected! Use sticks to jog', 'success');
    }
    
    onGamepadDisconnected(e) {
        console.log(`[Gamepad] Disconnected: ${e.gamepad.id}`);
        
        this.gamepad.index = null;
        this.gamepad.enabled = false;
        this.stopGamepadPolling();
        
        const indicator = document.getElementById('gamepad-indicator');
        if (indicator) indicator.classList.remove('connected');
        
        this.app?.showNotification?.('🎮 Gamepad disconnected', 'warning');
    }
    
    startGamepadPolling() {
        if (this.gamepad.pollInterval) return;
        
        this.gamepad.pollInterval = setInterval(() => this.pollGamepad(), 50); // 20Hz
    }
    
    stopGamepadPolling() {
        if (this.gamepad.pollInterval) {
            clearInterval(this.gamepad.pollInterval);
            this.gamepad.pollInterval = null;
        }
        
        // Stop any ongoing jog
        if (this.gamepad.continuousJogging) {
            this.app?.grbl?.jogCancel?.();
            this.gamepad.continuousJogging = false;
        }
    }
    
    pollGamepad() {
        if (this.gamepad.index === null) return;
        
        const gamepads = navigator.getGamepads?.() || [];
        const gp = gamepads[this.gamepad.index];
        if (!gp) return;
        
        // Axes mapping (typical controller):
        // axes[0] = Left stick X (-1 to 1)
        // axes[1] = Left stick Y (-1 to 1)
        // axes[2] = Right stick X or L2 trigger
        // axes[3] = Right stick Y or R2 trigger
        
        const deadzone = this.gamepad.deadzone;
        const sensitivity = this.gamepad.sensitivity;
        
        // Left stick = XY movement
        let x = Math.abs(gp.axes[0]) > deadzone ? gp.axes[0] : 0;
        let y = Math.abs(gp.axes[1]) > deadzone ? -gp.axes[1] : 0; // Invert Y
        
        // Right stick Y or triggers = Z movement
        let z = 0;
        if (gp.axes.length > 3) {
            z = Math.abs(gp.axes[3]) > deadzone ? -gp.axes[3] : 0;
        }
        
        // D-pad for step jog (buttons 12-15 typically)
        const dpadUp = gp.buttons[12]?.pressed;
        const dpadDown = gp.buttons[13]?.pressed;
        const dpadLeft = gp.buttons[14]?.pressed;
        const dpadRight = gp.buttons[15]?.pressed;
        
        // Shoulder buttons for Z
        const lBumper = gp.buttons[4]?.pressed;
        const rBumper = gp.buttons[5]?.pressed;
        
        // A button = stop, B button = cancel jog
        const aButton = gp.buttons[0]?.pressed;
        const bButton = gp.buttons[1]?.pressed;
        
        // Update axis indicators
        document.getElementById('gp-axis-x')?.style?.setProperty('width', `${50 + x * 50}%`);
        document.getElementById('gp-axis-y')?.style?.setProperty('width', `${50 + y * 50}%`);
        document.getElementById('gp-axis-z')?.style?.setProperty('width', `${50 + z * 50}%`);
        
        // Handle buttons
        if (aButton) {
            this.app?.grbl?.feedHold?.();
            return;
        }
        
        if (bButton) {
            this.app?.grbl?.jogCancel?.();
            this.gamepad.continuousJogging = false;
            return;
        }
        
        // D-pad step jog
        if (dpadUp || dpadDown || dpadLeft || dpadRight) {
            const stepSize = 1; // mm
            if (dpadUp) this.stepJog('Y', stepSize);
            if (dpadDown) this.stepJog('Y', -stepSize);
            if (dpadRight) this.stepJog('X', stepSize);
            if (dpadLeft) this.stepJog('X', -stepSize);
            return;
        }
        
        // Shoulder buttons for Z step
        if (lBumper) {
            this.stepJog('Z', 0.5);
            return;
        }
        if (rBumper) {
            this.stepJog('Z', -0.5);
            return;
        }
        
        // Analog stick continuous jog
        const hasMovement = Math.abs(x) > 0 || Math.abs(y) > 0 || Math.abs(z) > 0;
        
        if (hasMovement) {
            // Scale by sensitivity and max jog speed
            const maxSpeed = 3000; // mm/min
            const feedRate = maxSpeed * sensitivity;
            
            // Continuous jog command
            this.continuousJog(x, y, z, feedRate);
            this.gamepad.continuousJogging = true;
        } else if (this.gamepad.continuousJogging) {
            // Sticks released - cancel jog
            this.app?.grbl?.jogCancel?.();
            this.gamepad.continuousJogging = false;
        }
    }
    
    stepJog(axis, distance) {
        if (!this.app?.grbl) return;
        
        const feedRate = 1000; // mm/min for step jog
        const cmd = `$J=G91 ${axis}${distance} F${feedRate}`;
        this.app.grbl.send(cmd);
    }
    
    continuousJog(x, y, z, feedRate) {
        if (!this.app?.grbl) return;
        
        // Calculate jog distance for this tick (enough for smooth motion)
        const tickDistance = 10; // mm per tick
        
        const dx = x * tickDistance;
        const dy = y * tickDistance;
        const dz = z * tickDistance;
        
        if (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01 && Math.abs(dz) < 0.01) return;
        
        // Build jog command
        let cmd = '$J=G91';
        if (Math.abs(dx) >= 0.01) cmd += ` X${dx.toFixed(3)}`;
        if (Math.abs(dy) >= 0.01) cmd += ` Y${dy.toFixed(3)}`;
        if (Math.abs(dz) >= 0.01) cmd += ` Z${dz.toFixed(3)}`;
        cmd += ` F${feedRate}`;
        
        this.app.grbl.send(cmd);
    }
    
    // ================================================================
    // TOUCH PLATE PRESETS
    // ================================================================
    
    loadTouchPlates() {
        const defaults = [
            { name: 'Standard', thickness: 19.05 },
            { name: 'Thin', thickness: 6.35 },
            { name: '1/8"', thickness: 3.175 }
        ];
        
        try {
            return JSON.parse(localStorage.getItem('touchPlates')) || defaults;
        } catch {
            return defaults;
        }
    }
    
    saveTouchPlates() {
        localStorage.setItem('touchPlates', JSON.stringify(this.touchPlates));
    }
    
    addTouchPlate(name, thickness) {
        this.touchPlates.push({ name, thickness });
        this.saveTouchPlates();
        this.updateTouchPlateUI();
    }
    
    removeTouchPlate(index) {
        this.touchPlates.splice(index, 1);
        this.saveTouchPlates();
        this.updateTouchPlateUI();
    }
    
    selectTouchPlate(index) {
        const plate = this.touchPlates[index];
        if (!plate) return;
        
        // Update probe thickness input
        const thicknessInput = document.getElementById('probe-plate-thickness') ||
                              document.getElementById('touch-plate-thickness') ||
                              document.querySelector('[name="plateThickness"]');
        
        if (thicknessInput) {
            thicknessInput.value = plate.thickness;
            // Trigger change event
            thicknessInput.dispatchEvent(new Event('change', { bubbles: true }));
        }
        
        // Update active state
        document.querySelectorAll('.touch-plate-btn').forEach((btn, i) => {
            btn.classList.toggle('active', i === index);
        });
        
        this.app?.showNotification?.(`Touch plate: ${plate.name} (${plate.thickness}mm)`, 'info');
    }
    
    updateTouchPlateUI() {
        const container = document.getElementById('touch-plate-selector');
        if (!container) return;
        
        container.innerHTML = this.touchPlates.map((plate, i) => `
            <button class="touch-plate-btn" data-index="${i}" 
                    onclick="app?.enhancements?.selectTouchPlate(${i})">
                ${plate.name}<br><small>${plate.thickness}mm</small>
            </button>
        `).join('') + `
            <button class="touch-plate-btn touch-plate-add" onclick="app?.enhancements?.promptAddTouchPlate()">
                + Add
            </button>
        `;
    }
    
    promptAddTouchPlate() {
        const name = prompt('Touch plate name:');
        if (!name) return;
        
        const thickness = parseFloat(prompt('Thickness (mm):', '19.05'));
        if (isNaN(thickness) || thickness <= 0) {
            this.app?.showNotification?.('Invalid thickness', 'error');
            return;
        }
        
        this.addTouchPlate(name, thickness);
        this.app?.showNotification?.(`Added touch plate: ${name}`, 'success');
    }
    
    // ================================================================
    // EVENT LISTENERS
    // ================================================================
    
    setupEventListeners() {
        // Listen for job start/stop events from app
        if (this.app?.grbl) {
            // Watch for status changes
            const origEmit = this.app.grbl.emit?.bind(this.app.grbl);
            if (origEmit) {
                this.app.grbl.emit = (event, data) => {
                    this.handleGrblEvent(event, data);
                    return origEmit(event, data);
                };
            }
        }
        
        // Watch for streaming start
        document.addEventListener('fluidcnc:jobstart', (e) => {
            this.onJobStart(e.detail?.gcode);
        });
        
        document.addEventListener('fluidcnc:jobcomplete', (e) => {
            this.onJobComplete(e.detail?.success !== false);
        });
    }
    
    handleGrblEvent(event, data) {
        switch (event) {
            case 'alarm':
                this.playSound('limitHit');
                this.sendPushNotification('⚠️ CNC Alarm', `ALARM ${data?.code}: ${data?.message || 'Check machine!'}`);
                break;
                
            case 'probe':
                this.playSound('probeTouch');
                break;
                
            case 'toolchange':
                this.playSound('toolChange');
                this.sendPushNotification('🔧 Tool Change', `Load tool ${data?.tool}`);
                break;
        }
    }
    
    // ================================================================
    // INTEGRATION HELPERS
    // ================================================================
    
    // Inject touch plate selector into probe panel
    injectTouchPlateSelector() {
        const probePanel = document.querySelector('#tab-probe, [data-tab="probe"]');
        if (!probePanel) return;
        
        // Find thickness input area
        const thicknessRow = probePanel.querySelector('.probe-thickness, .plate-thickness') ||
                            probePanel.querySelector('[id*="thickness"]')?.parentElement;
        
        if (thicknessRow && !document.getElementById('touch-plate-selector')) {
            const selector = document.createElement('div');
            selector.id = 'touch-plate-selector';
            selector.className = 'touch-plate-selector';
            thicknessRow.parentElement.insertBefore(selector, thicknessRow);
            this.updateTouchPlateUI();
        }
    }
    
    // Get current VFD data for other modules
    getVfdStatus() {
        return { ...this.vfdData };
    }
    
    // Manual trigger for job complete (for streaming module)
    triggerJobComplete(success = true) {
        this.onJobComplete(success);
    }
    
    // Update the settings panel touch plate list
    updateTouchPlateSettingsList() {
        const list = document.getElementById('touch-plate-settings-list');
        if (!list) return;
        
        list.innerHTML = this.touchPlates.map((plate, i) => `
            <div class="setting-row" style="justify-content: space-between;">
                <span>${plate.name}: ${plate.thickness}mm</span>
                <button class="btn btn-xs btn-danger" onclick="app?.enhancementsV12?.removeTouchPlate(${i}); app?.enhancementsV12?.updateTouchPlateSettingsList();">✕</button>
            </div>
        `).join('');
    }
    
    // Load settings from storage
    loadSettings() {
        // Audio settings
        const audioSettings = JSON.parse(localStorage.getItem('audioSettings') || '{}');
        const audioEnabled = document.getElementById('setting-audio-enabled');
        const audioVolume = document.getElementById('setting-audio-volume');
        if (audioEnabled) audioEnabled.checked = audioSettings.enabled !== false;
        if (audioVolume) audioVolume.value = audioSettings.volume || 0.5;
        
        // Adaptive feed settings
        const adaptiveSettings = JSON.parse(localStorage.getItem('adaptiveFeedSettings') || '{}');
        const adaptiveEnabled = document.getElementById('setting-adaptive-feed');
        const loadThreshold = document.getElementById('setting-load-threshold');
        const maxReduction = document.getElementById('setting-max-reduction');
        if (adaptiveEnabled) adaptiveEnabled.checked = adaptiveSettings.enabled === true;
        if (loadThreshold) loadThreshold.value = adaptiveSettings.loadThreshold || 70;
        if (maxReduction) maxReduction.value = adaptiveSettings.maxReduction || 50;
        
        // Update touch plate list
        this.updateTouchPlateSettingsList();
    }
}

// Auto-initialize when app is ready (not triggered - app.js handles this)
if (typeof window !== 'undefined') {
    // Delay to ensure app.js initializes first
    window.addEventListener('load', () => {
        setTimeout(() => {
            if (window.app?.enhancementsV12) {
                window.app.enhancementsV12.loadSettings();
            }
        }, 500);
    });
}

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
    module.exports = EnhancementsV12;
}
