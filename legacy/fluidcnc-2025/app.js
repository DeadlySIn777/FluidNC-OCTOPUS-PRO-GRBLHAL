/* ========================================
   FluidCNC - Main Application
   
   Integrates all components:
   - grblHAL WebSocket connection
   - 3D Visualizer
   - AI Assistant with NLP
   - Probe Wizard
   - ATC Tool Changer
   - Surfacing Wizard
   - Keyboard hold-to-jog
   - G-code editor & streaming
   ======================================== */

class FluidCNCApp {
    constructor() {
        // Core components
        this.grbl = null;
        this.visualizer = null;
        this.probeWizard = null;
        this.atc = null;
        this.surfacing = null;
        this.macros = null;
        this.ai = null;
        this.simulator = null;
        this.recovery = null;
        this.settings = null;
        this.trinamicConfig = null;
        this.sdCard = null;
        this.conversational = null;
        
        // Smart Machine System
        this.smartMachine = null;
        this.autoTuner = null;
        this.sensorlessSystem = null;
        this.adaptiveFeed = null;
        
        // State
        this.connected = false;
        this.demoMode = false;
        this.demoInterval = null;
        this.jogMode = 'step';   // 'step' or 'continuous'
        this.jogStep = 1;        // mm
        this.jogFeed = 3000;     // mm/min
        this.jogFeedRapid = 10000;
        this.jogKeys = {};       // Currently held keys
        this.jogInterval = null;
        this.jogRepeatInterval = null;  // Track for cleanup
        this.stepLossUpdateInterval = null;  // Track for cleanup
        this.showWorkPosition = true;  // Toggle between work/machine position display

        // Connection/overlay stability (prevents full-screen flashing on brief disconnects)
        this._disconnectOverlayTimer = null;
        this._disconnectOverlayDelayMs = 1500;

        // Machine workspace / envelope (used by visualizer + presets)
        this.workArea = { x: 400, y: 400, z: 200 };
        
        // G-code
        this.gcodeLines = [];
        this.gcodeFileName = '';
        
        // UI Elements cache
        this.elements = {};
        
        // Dual Serial (grblHAL + ChatterDetect ESP32)
        this.dualSerial = null;
        
        // Setup cleanup on page unload to prevent memory leaks
        // CRITICAL SAFETY: Warn user if job is running before leaving
        window.addEventListener('beforeunload', (e) => {
            if (this.grbl?.streaming) {
                e.preventDefault();
                e.returnValue = '⚠️ JOB IN PROGRESS! Machine will continue running if you leave this page.';
                return e.returnValue;
            }
            this.cleanup();
        });
        
        // Initialize
        this.init();
    }
    
    /**
     * Cleanup all intervals and connections on page unload
     * Prevents memory leaks and ensures clean shutdown
     */
    cleanup() {
        // Clear all intervals
        if (this.demoInterval) {
            clearInterval(this.demoInterval);
            this.demoInterval = null;
        }
        if (this.jogRepeatInterval) {
            clearInterval(this.jogRepeatInterval);
            this.jogRepeatInterval = null;
        }
        if (this.stepLossUpdateInterval) {
            clearInterval(this.stepLossUpdateInterval);
            this.stepLossUpdateInterval = null;
        }
        
        // CRITICAL: Clean up MachineEnhancements to prevent memory leaks
        if (this.enhancements?.destroy) {
            this.enhancements.destroy();
            this.enhancements = null;
        }
        
        // Disconnect gracefully
        try {
            if (this.grbl?.connected) {
                this.grbl.disconnect();
            }
        } catch (e) {
            console.warn('Cleanup disconnect error:', e);
        }
    }
    
    async init() {
        this.cacheElements();
        this.setupGrbl();
        this.setupVisualizer();
        this.setupAI();
        this.setupProbeWizard();
        this.setupATC();
        this.setupSurfacing();
        this.setupMacros();
        this.setupMonitoring();
        this.setupSimulator();
        this.setupRecovery();
        this.setupSettingsManager();
        this.setupTrinamicConfig();
        this.setupConversational();
        this.setupSDCard();
        this.setupDualSerial();
        this.setupSmartMachine();
        this.bindEvents();
        this.bindKeyboard();
        this.loadSettings();
        this.setupToolTable();
        this.setupGCodeEditor();
        this.setupConsole();
        this.setupCommandPalette();
        this.setupDragAndDrop();
        
        // Feature Detection System - auto-hide unavailable features
        this.setupFeatureDetection();
        
        // Auto-connect only if we have a saved IP (WebSerial requires user gesture, so never auto-connect serial)
        const lastConnType = localStorage.getItem('fluidcnc-connection-type') || 'websocket';
        const lastIp = localStorage.getItem('fluidcnc-last-ip');
        if (lastConnType === 'websocket' && lastIp) {
            setTimeout(() => this.connect('websocket'), 500);
        }
        
        this.log('FluidCNC initialized', 'info');
    }
    
    // ================================================================
    // Feature Detection System
    // ================================================================
    
    /**
     * Detected features and their availability
     */
    detectedFeatures = {
        grblhal: false,
        vfd: false,
        chatter: false,
        camera: false,
        usbCamera: false,
        tmc: false,
        sdCard: false
    };
    
    async setupFeatureDetection() {
        // Check for USB webcam availability (await so we know before updating UI)
        await this.detectUSBWebcam();
        
        // Update UI based on initial feature state (hidden by default until detected)
        this.updateFeatureVisibility();
        
        // Re-check features periodically
        setInterval(() => this.updateFeatureVisibility(), 5000);
    }
    
    /**
     * Detect USB webcams (like Razer Kiyo)
     */
    async detectUSBWebcam() {
        if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
            console.log('[Features] MediaDevices API not available');
            return;
        }
        
        try {
            const devices = await navigator.mediaDevices.enumerateDevices();
            const cameras = devices.filter(d => d.kind === 'videoinput');
            
            this.detectedFeatures.usbCamera = cameras.length > 0;
            this.availableUSBCameras = cameras;
            
            if (cameras.length > 0) {
                console.log(`[Features] Found ${cameras.length} USB camera(s):`, 
                    cameras.map(c => c.label || 'Unnamed Camera'));
            }
        } catch (e) {
            console.warn('[Features] Could not enumerate cameras:', e);
        }
    }
    
    /**
     * Update UI visibility based on detected features
     */
    updateFeatureVisibility() {
        // Update feature states from current connections
        this.detectedFeatures.grblhal = this.connected || this.demoMode;
        this.detectedFeatures.vfd = this.dualSerial?.vfdConnected || false;
        this.detectedFeatures.chatter = this.dualSerial?.chatterConnected || window.chatterSystem?.connected || false;
        this.detectedFeatures.camera = this.camera?.state?.connected || false;
        this.detectedFeatures.tmc = !!(this.dualSerial?.tmcStatus?.x || this.dualSerial?.tmcStatus?.y || this.dualSerial?.tmcStatus?.z);
        this.detectedFeatures.sdCard = this.sdCard?.available || false;
        
        // UI elements to show/hide based on features
        const featureUIMap = {
            // VFD elements
            vfd: [
                { selector: '#device-vfd', action: 'toggle' },
                { selector: '#header-vfd-dot', action: 'toggle' },
                { selector: '.vfd-controls', action: 'toggle' },
                { selector: '#vfd-status-badge', action: 'toggle' },
                { selector: '.spindle-card .vfd-info', action: 'toggle' }
            ],
            // Chatter detection elements
            chatter: [
                { selector: '#device-chatter', action: 'toggle' },
                { selector: '#header-chatter-dot', action: 'toggle' },
                { selector: '.chatter-section', action: 'toggle' }
            ],
            // Camera elements (show if ESP32 OR USB camera available, or previously used)
            camera: [
                { selector: '[data-tab="camera"]', action: 'toggle' },
                { selector: '#device-camera', action: 'toggle' },
                { selector: '#header-camera-dot', action: 'toggle' }
            ],
            // TMC driver elements
            tmc: [
                { selector: '.tmc-driver-grid', action: 'toggle' },
                { selector: '.diag-tune-btn', action: 'toggle' }
            ]
        };
        
        // Apply visibility for each feature
        for (const [feature, elements] of Object.entries(featureUIMap)) {
            let isAvailable = this.detectedFeatures[feature];
            
            // Special case: Camera available if ESP32 OR USB webcam OR previously used
            if (feature === 'camera') {
                const cameraHistory = localStorage.getItem('fluidcnc-camera-detected') === 'true';
                isAvailable = this.detectedFeatures.camera || this.detectedFeatures.usbCamera || cameraHistory;
            }
            
            for (const { selector, action } of elements) {
                const els = document.querySelectorAll(selector);
                els.forEach(el => {
                    if (action === 'toggle') {
                        // Use a special class so we can still manually show/hide
                        if (isAvailable) {
                            el.classList.remove('feature-unavailable');
                            el.style.display = '';
                        } else {
                            el.classList.add('feature-unavailable');
                            el.style.display = 'none';
                        }
                    }
                });
            }
        }
        
        // Update connection overlay device indicators
        this.updateConnectionOverlayDevices();
    }
    
    /**
     * Update connection overlay to show which devices are available
     */
    updateConnectionOverlayDevices() {
        const vfdIndicator = document.getElementById('device-vfd');
        const chatterIndicator = document.getElementById('device-chatter');
        const cameraIndicator = document.getElementById('device-camera');
        
        // Only show devices on connection overlay if they've been detected before
        const hasVfdHistory = localStorage.getItem('fluidcnc-vfd-detected') === 'true';
        const hasChatterHistory = localStorage.getItem('fluidcnc-chatter-detected') === 'true';
        const hasCameraHistory = localStorage.getItem('fluidcnc-camera-detected') === 'true';
        
        // Remember when we detect devices
        if (this.detectedFeatures.vfd) {
            localStorage.setItem('fluidcnc-vfd-detected', 'true');
        }
        if (this.detectedFeatures.chatter) {
            localStorage.setItem('fluidcnc-chatter-detected', 'true');
        }
        if (this.detectedFeatures.camera || this.detectedFeatures.usbCamera) {
            localStorage.setItem('fluidcnc-camera-detected', 'true');
        }
        
        // Show/hide based on history or current detection
        if (vfdIndicator) {
            vfdIndicator.style.display = (hasVfdHistory || this.detectedFeatures.vfd) ? '' : 'none';
        }
        if (chatterIndicator) {
            chatterIndicator.style.display = (hasChatterHistory || this.detectedFeatures.chatter) ? '' : 'none';
        }
        if (cameraIndicator) {
            const hasCamera = this.detectedFeatures.camera || this.detectedFeatures.usbCamera;
            cameraIndicator.style.display = (hasCameraHistory || hasCamera) ? '' : 'none';
        }
        
        // Update header device indicators with connected status
        this.updateHeaderDeviceIndicators();
        
        // Update device status text
        this.updateDeviceStatusText();
    }
    
    /**
     * Update header dots to show connected/disconnected state
     */
    updateHeaderDeviceIndicators() {
        const dots = {
            grbl: { el: document.getElementById('header-grbl-dot'), connected: this.connected || this.demoMode },
            vfd: { el: document.getElementById('header-vfd-dot'), connected: this.detectedFeatures.vfd },
            chatter: { el: document.getElementById('header-chatter-dot'), connected: this.detectedFeatures.chatter },
            camera: { el: document.getElementById('header-camera-dot'), connected: this.detectedFeatures.camera || this.camera?.state?.streaming }
        };
        
        for (const [name, { el, connected }] of Object.entries(dots)) {
            if (el) {
                el.style.background = connected ? '#00ff88' : '#666';
                el.style.boxShadow = connected ? '0 0 8px #00ff88' : 'none';
            }
        }
    }
    
    /**
     * Update device status text in connection overlay
     */
    updateDeviceStatusText() {
        const statuses = {
            'device-grbl-status': this.connected ? 'Connected' : (this.demoMode ? 'Demo' : '--'),
            'device-vfd-status': this.detectedFeatures.vfd ? 'Connected' : '--',
            'device-chatter-status': this.detectedFeatures.chatter ? 'Connected' : '--',
            'device-camera-status': this.camera?.state?.streaming ? 
                (this.camera?.state?.source === 'usb' ? 'USB Cam' : 'ESP32') : 
                (this.detectedFeatures.usbCamera ? 'USB Ready' : '--')
        };
        
        for (const [id, text] of Object.entries(statuses)) {
            const el = document.getElementById(id);
            if (el) {
                el.textContent = text;
                el.style.color = text !== '--' ? '#00ff88' : '#666';
            }
        }
    }
    
    /**
     * Force show a feature section (user manually enables)
     */
    showFeatureSection(feature) {
        const featureUIMap = {
            vfd: ['#device-vfd', '#header-vfd-dot', '.vfd-controls', '#vfd-status-badge'],
            chatter: ['#device-chatter', '#header-chatter-dot', '.chatter-section'],
            camera: ['[data-tab="camera"]', '#device-camera', '#header-camera-dot'],
            tmc: ['.tmc-driver-grid', '.diag-tune-btn']
        };
        
        const selectors = featureUIMap[feature] || [];
        for (const selector of selectors) {
            const els = document.querySelectorAll(selector);
            els.forEach(el => {
                el.classList.remove('feature-unavailable');
                el.style.display = '';
            });
        }
    }
    
    // ================================================================
    // Element caching
    // ================================================================
    
    cacheElements() {
        const ids = [
            // Connection & Overlay
            'ip-input', 'connect-btn', 'usb-connect-btn', 'demo-btn', 'connection-overlay', 'app',
            'connection-status', 'connection-indicator', 'connection-type-icon',
            'header-connect-btn', 'header-usb-btn',
            'settings-btn',
            // Position displays
            'pos-x', 'pos-y', 'pos-z',
            'wpos-x', 'wpos-y', 'wpos-z',
            // Limit switch indicators
            'limit-x', 'limit-y', 'limit-z',
            // Status
            'machine-status', 'feed-rate', 'spindle-speed',
            // Jog controls
            'jog-feed', 'jog-step', 'jog-mode-step', 'jog-mode-cont',
            // Console
            'console-output', 'console-input',
            // G-code
            'gcode-display', 'job-progress', 'progress-fill',
            'btn-start', 'btn-pause', 'btn-stop',
            // Coolant & Vacuum
            'coolant-flood', 'coolant-mist',
            'vacuum-toggle', 'dustshoe-toggle',
            // Overrides
            'feed-override', 'rapid-override', 'spindle-override',
            'override-feed-val', 'override-rapid-val', 'override-spindle-val',
            // Tool table
            'tool-table-body',
            // G-code editor
            'gcode-editor', 'gcode-filename',
            // Visualizer
            'visualizer-canvas',
            // AI Chat
            'ai-input', 'ai-output', 'ai-voice-btn',
            // Wizard containers
            'probe-wizard-container', 'surfacing-container',
            // Macro buttons
            'macro-container',
            // Help
            'keyboard-help-btn'
        ];
        
        ids.forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                this.elements[this.toCamel(id)] = el;
            }
        });
    }
    
    toCamel(str) {
        return str.replace(/-([a-z])/g, (g) => g[1].toUpperCase());
    }
    
    // ================================================================
    // grblHAL Setup - FIXED: Using proper options object
    // ================================================================
    
    setupGrbl() {
        const lastConnType = localStorage.getItem('fluidcnc-connection-type') || 'websocket';
        this.grblSettings = {}; // Store received settings
        this.grbl = new GrblHAL({
            host: window.location.hostname || 'localhost',
            port: 81,
            connectionType: lastConnType,
            baudRate: 115200,
            onConnect: () => this.onGrblConnect(),
            onDisconnect: (info) => this.onGrblDisconnect(info),
            onStatus: (state) => this.onGrblStatus(state),
            onMessage: (msg) => this.log(msg, 'rx'),
            onError: (err) => this.onGrblError(err),
            onAlarm: (alarm) => this.onGrblAlarm(alarm),
            onSetting: (setting) => this.onGrblSetting(setting),
            onProgress: (info) => this.onStreamProgress(info)
        });

        // Start state persistence
        this.grbl.startStatePersistence(5000);
        
        // SAFETY: Handle E-stop failure - this is CRITICAL
        this.grbl.on('estop_failed', (data) => {
            // Show persistent, unmissable warning
            this.showNotification('⚠️ E-STOP FAILED - USE PHYSICAL BUTTON!', 'error', 30000);
            
            // Flash the entire screen red
            document.body.classList.add('estop-failed-flash');
            setTimeout(() => document.body.classList.remove('estop-failed-flash'), 5000);
            
            // Log critically
            this.log('CRITICAL: Software E-STOP failed - USE PHYSICAL E-STOP!', 'error');
            
            // Play alarm sound continuously
            this.playAlarmSound(5000);
        });
        
        // SAFETY: Handle stream interruption due to disconnect
        this.grbl.on('stream_interrupted', (info) => {
            this.showNotification(
                `⚠️ JOB INTERRUPTED - CONNECTION LOST!\n` +
                `Machine may still be moving!\n` +
                `USE PHYSICAL E-STOP IF NEEDED!`,
                'error', 30000
            );
            this.log(`Stream interrupted: ${info?.linesInFirmwareBuffer || 'unknown'} commands may be buffered`, 'error');
        });

        // SAFETY FIXER: Notify user when G-code is auto-fixed or blocked
        this.grbl.on('safetyFix', (info) => {
            this.showNotification(
                `🔧 Safety Fix: ${info.reason}`,
                'warning', 3000
            );
            this.log(`[SafetyFixer] ${info.reason}: "${info.original}" → "${info.fixed}"`, 'warning');
        });
        
        this.grbl.on('error', (err) => {
            if (err.code === 'SAFETY_BLOCK') {
                this.showNotification(
                    `🚫 BLOCKED: ${err.message}`,
                    'error', 5000
                );
                this.log(`[SafetyFixer] Blocked dangerous command: ${err.command}`, 'error');
            }
        });

        // Disable USB button if WebSerial isn't available
        if (this.elements.usbConnectBtn && !GrblHAL.isWebSerialSupported()) {
            this.elements.usbConnectBtn.disabled = true;
            this.elements.usbConnectBtn.title = 'WebSerial not supported (use Chrome/Edge on desktop)';
        }
        
        // Detect if accessing from network (not localhost)
        this.isRemoteAccess = !['localhost', '127.0.0.1', ''].includes(window.location.hostname);
        this.setupConnectionUI();
    }
    
    setupConnectionUI() {
        // Configure connection buttons based on context
        const bridgeBtn = document.getElementById('bridge-connect-btn');
        const directBtn = document.getElementById('connect-btn');
        const usbBtn = document.getElementById('usb-connect-btn');
        const ipInputGroup = document.getElementById('ip-input-group');
        const hint = document.getElementById('connection-hint');
        
        if (this.isRemoteAccess) {
            // Remote access - hide USB (doesn't work remotely), show Bridge prominently
            if (usbBtn) usbBtn.style.display = 'none';
            if (directBtn) directBtn.style.display = 'none';
            if (ipInputGroup) ipInputGroup.style.display = 'none';
            if (hint) hint.textContent = `Connected to ${window.location.host}`;
        } else {
            // Local access - show all options
            if (usbBtn && GrblHAL.isWebSerialSupported()) {
                usbBtn.style.display = '';
            }
            if (directBtn) directBtn.style.display = '';
            if (hint) hint.textContent = 'Bridge connects via server, USB for direct connection';
        }
    }
    
    connectBridge() {
        // Connect via WebSocket to the bridge server (same host as the page)
        console.log('[FluidCNC] connectBridge() - connecting via WebSocket bridge');
        
        // The grbl host should be the current page host for bridge mode
        this.grbl.host = window.location.hostname;
        this.grbl.port = window.location.port || 80;
        
        this.connect('websocket');
    }
    
    connect(type = null) {
        console.log('[FluidCNC] connect() called with type:', type);
        const connectionType = (type || localStorage.getItem('fluidcnc-connection-type') || 'websocket');
        console.log('[FluidCNC] Using connectionType:', connectionType);
        localStorage.setItem('fluidcnc-connection-type', connectionType);

        // Get IP address from input
        if (connectionType === 'websocket' && this.elements.ipInput) {
            const ip = this.elements.ipInput.value.trim();
            if (ip) {
                this.grbl.host = ip;
                localStorage.setItem('fluidcnc-last-ip', ip);
            }
        }

        // Show connecting state
        if (this.elements.connectionIndicator) {
            this.elements.connectionIndicator.classList.remove('connected', 'disconnected');
            this.elements.connectionIndicator.classList.add('connecting');
        }
        if (this.elements.connectionStatus) {
            this.elements.connectionStatus.textContent = 'Connecting...';
        }
        if (this.elements.connectionTypeIcon) {
            this.elements.connectionTypeIcon.textContent = connectionType === 'serial' ? '🔌' : '📶';
        }

        if (connectionType === 'serial') {
            if (this.elements.usbConnectBtn) {
                this.elements.usbConnectBtn.textContent = 'Connecting...';
                this.elements.usbConnectBtn.disabled = true;
            }
            if (this.elements.connectBtn) {
                this.elements.connectBtn.disabled = true;
            }
        } else {
            if (this.elements.connectBtn) {
                this.elements.connectBtn.textContent = 'Connecting...';
                this.elements.connectBtn.disabled = true;
            }
            if (this.elements.usbConnectBtn) {
                this.elements.usbConnectBtn.disabled = true;
            }
        }

        // GrblHAL.connect() chooses transport based on type
        this.grbl.connect(connectionType).catch(err => {
            console.error('[FluidCNC] Connection failed:', err);
            this.showNotification(`Connection failed: ${err.message}`, 'error');
            
            // Reset button states
            if (this.elements.connectBtn) {
                this.elements.connectBtn.innerHTML = '<span class="btn-icon-left">🔗</span> Connect';
                this.elements.connectBtn.disabled = false;
            }
            if (this.elements.usbConnectBtn) {
                this.elements.usbConnectBtn.innerHTML = '<span class="btn-icon-left">🔌</span> USB';
                this.elements.usbConnectBtn.disabled = !GrblHAL.isWebSerialSupported();
            }
            if (this.elements.connectionIndicator) {
                this.elements.connectionIndicator.classList.remove('connecting');
                this.elements.connectionIndicator.classList.add('disconnected');
            }
            if (this.elements.connectionStatus) {
                this.elements.connectionStatus.textContent = 'Offline';
            }
        });
    }
    
    disconnect() {
        this.grbl.disconnect();
    }
    
    onGrblConnect() {
        this.connected = true;
        const connType = this.grbl.getConnectionType ? this.grbl.getConnectionType() : 'websocket';

        // Cancel any pending disconnect overlay
        if (this._disconnectOverlayTimer) {
            clearTimeout(this._disconnectOverlayTimer);
            this._disconnectOverlayTimer = null;
        }
        
        // Apply saved state if available (helps restore WCO after refresh)
        const savedState = this.grbl.loadSavedState();
        if (savedState) {
            this.grbl.applySavedState(savedState);
            this.log('Restored saved machine state', 'info');
        }
        
        // Hide overlay and show app
        this.showApp();
        
        // Update connection indicator
        if (this.elements.connectionIndicator) {
            this.elements.connectionIndicator.classList.remove('connecting', 'disconnected');
            this.elements.connectionIndicator.classList.add('connected');
        }
        if (this.elements.connectionTypeIcon) {
            this.elements.connectionTypeIcon.textContent = connType === 'serial' ? '🔌' : '📶';
        }
        
        if (this.elements.connectBtn) {
            this.elements.connectBtn.textContent = 'Disconnect';
            this.elements.connectBtn.disabled = false;
            this.elements.connectBtn.classList.add('connected');
        }

        if (this.elements.usbConnectBtn) {
            this.elements.usbConnectBtn.textContent = 'Disconnect';
            this.elements.usbConnectBtn.disabled = false;
        }
        
        if (this.elements.connectionStatus) {
            this.elements.connectionStatus.textContent = connType === 'serial' ? 'Online (USB)' : 'Online (WiFi)';
        }
        
        this.log('Connected to grblHAL', 'success');
        this.showNotification('Connected to CNC', 'success');
        
        // Auto-derive ESP32 IPs for chatter detection and camera from grblHAL connection
        // This helps when all devices are on the same network subnet
        if (connType === 'websocket' && this.grbl.wsUrl) {
            try {
                const url = new URL(this.grbl.wsUrl);
                const grblIp = url.hostname;
                
                // Only derive if user hasn't manually configured an IP
                if (!localStorage.getItem('chatterEspIp') && window.chatterSystem) {
                    window.chatterSystem.deriveFromGrblIp(grblIp, 28);  // e.g., .72 -> .100
                }
                if (!localStorage.getItem('esp32CameraIp') && window.app?.camera) {
                    window.app.camera.deriveFromGrblIp?.(grblIp);
                }
            } catch (e) {
                // URL parsing failed, no big deal
            }
        }
        
        // Query machine state
        setTimeout(() => {
            this.grbl.send('$$');
        }, 200);
    }
    
    onGrblDisconnect(info) {
        this.connected = false;
        
        // Clear periodic update intervals to prevent memory leaks
        if (this.stepLossUpdateInterval) {
            clearInterval(this.stepLossUpdateInterval);
            this.stepLossUpdateInterval = null;
        }
        
        // Show overlay only if we're still disconnected after a short delay.
        // This prevents the UI from flashing when the connection drops and re-establishes quickly.
        if (this._disconnectOverlayTimer) {
            clearTimeout(this._disconnectOverlayTimer);
        }
        this._disconnectOverlayTimer = setTimeout(() => {
            if (!this.connected) {
                this.showOverlay();
            }
            this._disconnectOverlayTimer = null;
        }, this._disconnectOverlayDelayMs);
        
        // Update connection indicator
        if (this.elements.connectionIndicator) {
            this.elements.connectionIndicator.classList.remove('connecting', 'connected');
            this.elements.connectionIndicator.classList.add('disconnected');
        }
        if (this.elements.connectionTypeIcon) {
            this.elements.connectionTypeIcon.textContent = '';
        }
        
        if (this.elements.connectBtn) {
            this.elements.connectBtn.textContent = 'Connect';
            this.elements.connectBtn.disabled = false;
            this.elements.connectBtn.classList.remove('connected');
        }

        if (this.elements.usbConnectBtn) {
            this.elements.usbConnectBtn.textContent = 'USB';
            this.elements.usbConnectBtn.disabled = !GrblHAL.isWebSerialSupported();
        }
        
        if (this.elements.connectionStatus) {
            this.elements.connectionStatus.textContent = 'Offline';
            this.elements.connectionStatus.className = 'status-disconnected';
        }
        
        this.log(`Disconnected: ${info?.reason || 'Unknown'}`, 'warning');
    }
    
    // ================================================================
    // App/Overlay Visibility
    // ================================================================
    
    showApp() {
        if (this.elements.connectionOverlay) {
            this.elements.connectionOverlay.classList.add('hidden');
        }
        if (this.elements.app) {
            this.elements.app.classList.remove('hidden');
        }
    }
    
    showOverlay() {
        if (this.elements.app) {
            this.elements.app.classList.add('hidden');
        }
        if (this.elements.connectionOverlay) {
            this.elements.connectionOverlay.classList.remove('hidden');
        }
    }
    
    startDemo() {
        // Demo mode - show app without a real connection
        this.demoMode = true;
        
        // Enable demo mode on grbl - this handles jog simulation and status updates
        if (this.grbl) {
            this.grbl.setDemoMode(true);
        }
        
        this.showApp();
        
        // Update UI to show demo state
        if (this.elements.connectionStatus) {
            this.elements.connectionStatus.textContent = 'Demo Mode';
        }
        if (this.elements.connectionIndicator) {
            this.elements.connectionIndicator.classList.remove('connecting', 'disconnected');
            this.elements.connectionIndicator.classList.add('connected');
        }
        if (this.elements.connectionTypeIcon) {
            this.elements.connectionTypeIcon.textContent = '🎮';
        }
        
        this.log('Demo mode started - jog buttons move virtual machine with limits', 'info');
        this.showNotification('Demo Mode - Use jog buttons to move! 🎮', 'info');
        
        // Load demo G-code and start simulation
        this._loadDemoGCode();
        this._startDemoSimulation();
    }
    
    _loadDemoGCode() {
        // Generate a nice demo toolpath - a spiral pocket
        const demoGCode = this._generateDemoGCode();
        
        // Load into visualizer
        if (this.visualizer) {
            this.visualizer.loadGCode(demoGCode);
            
            // Set up stock if enhanced visualizer
            if (this.visualizerType === 'enhanced3d') {
                this.visualizer.setStock({ x: 100, y: 100, z: 20 }, { x: 50, y: 50, z: 0 });
                this.visualizer.setMaterialType('wood');
                this.visualizer.resetMaterial();
            }
        }
        
        // Store for simulation
        this._demoGCode = demoGCode.split('\n').filter(l => l.trim() && !l.startsWith(';'));
        this._demoLineIndex = 0;
        this._demoPosition = { x: 0, y: 0, z: 5 };
        this._demoFeed = 0;
        this._demoSpindle = 0;
        this._demoState = 'idle';
    }
    
    _generateDemoGCode() {
        // Demo: Carve "CNC" letters - XY movement only, Z stays safe!
        // 24K RPM spindle, realistic hobby feeds
        const lines = [
            '; Demo G-code - Carving "CNC"',
            '; Safe demo - Z stays at 5mm (no plunging!)',
            'G21 ; mm mode',
            'G90 ; absolute',
            'G17 ; XY plane',
            '',
            '; Safe height',
            'G0 Z5',
            '',
            '; Start spindle (24K router)',
            'M3 S24000',
            'G4 P1 ; spindle spin-up',
            ''
        ];
        
        // Letter positions (centered around 200x200 work area)
        const startX = 30;
        const startY = 100;
        const letterWidth = 40;
        const letterHeight = 60;
        const letterSpacing = 50;
        const feed = 800;
        
        // ===== Letter "C" =====
        lines.push('; Letter C');
        const cX = startX;
        const cY = startY;
        lines.push(`G0 X${cX + letterWidth} Y${cY + letterHeight}`);
        // Arc from top-right, around to bottom-right
        for (let angle = 60; angle <= 300; angle += 10) {
            const rad = (angle * Math.PI) / 180;
            const x = cX + letterWidth/2 + Math.cos(rad) * letterWidth/2;
            const y = cY + letterHeight/2 + Math.sin(rad) * letterHeight/2;
            lines.push(`G1 X${x.toFixed(2)} Y${y.toFixed(2)} F${feed}`);
        }
        
        // ===== Letter "N" =====
        lines.push('');
        lines.push('; Letter N');
        const nX = startX + letterSpacing;
        const nY = startY;
        lines.push(`G0 X${nX} Y${nY}`);
        lines.push(`G1 X${nX} Y${nY + letterHeight} F${feed}`);
        lines.push(`G1 X${nX + letterWidth} Y${nY} F${feed}`);
        lines.push(`G1 X${nX + letterWidth} Y${nY + letterHeight} F${feed}`);
        
        // ===== Letter "C" (second) =====
        lines.push('');
        lines.push('; Letter C (second)');
        const c2X = startX + letterSpacing * 2;
        const c2Y = startY;
        lines.push(`G0 X${c2X + letterWidth} Y${c2Y + letterHeight}`);
        for (let angle = 60; angle <= 300; angle += 10) {
            const rad = (angle * Math.PI) / 180;
            const x = c2X + letterWidth/2 + Math.cos(rad) * letterWidth/2;
            const y = c2Y + letterHeight/2 + Math.sin(rad) * letterHeight/2;
            lines.push(`G1 X${x.toFixed(2)} Y${y.toFixed(2)} F${feed}`);
        }
        
        // ===== Decorative border =====
        lines.push('');
        lines.push('; Border rectangle');
        const borderMargin = 15;
        const bx1 = startX - borderMargin;
        const by1 = startY - borderMargin;
        const bx2 = startX + letterSpacing * 2 + letterWidth + borderMargin;
        const by2 = startY + letterHeight + borderMargin;
        
        lines.push(`G0 X${bx1} Y${by1}`);
        lines.push(`G1 X${bx2} Y${by1} F${feed}`);
        lines.push(`G1 X${bx2} Y${by2} F${feed}`);
        lines.push(`G1 X${bx1} Y${by2} F${feed}`);
        lines.push(`G1 X${bx1} Y${by1} F${feed}`);
        
        // ===== Decorative corner flourishes =====
        lines.push('');
        lines.push('; Corner details');
        const cornerSize = 8;
        // Bottom-left corner
        lines.push(`G0 X${bx1} Y${by1 + cornerSize}`);
        lines.push(`G1 X${bx1 - cornerSize} Y${by1} F${feed}`);
        lines.push(`G1 X${bx1 + cornerSize} Y${by1} F${feed}`);
        // Bottom-right corner  
        lines.push(`G0 X${bx2 - cornerSize} Y${by1}`);
        lines.push(`G1 X${bx2} Y${by1 - cornerSize} F${feed}`);
        lines.push(`G1 X${bx2} Y${by1 + cornerSize} F${feed}`);
        // Top-right corner
        lines.push(`G0 X${bx2} Y${by2 - cornerSize}`);
        lines.push(`G1 X${bx2 + cornerSize} Y${by2} F${feed}`);
        lines.push(`G1 X${bx2 - cornerSize} Y${by2} F${feed}`);
        // Top-left corner
        lines.push(`G0 X${bx1 + cornerSize} Y${by2}`);
        lines.push(`G1 X${bx1} Y${by2 + cornerSize} F${feed}`);
        lines.push(`G1 X${bx1} Y${by2 - cornerSize} F${feed}`);
        
        // End program
        lines.push('');
        lines.push('; Finish - return home');
        lines.push('G0 Z10');
        lines.push('G0 X0 Y0');
        lines.push('M5 ; spindle off');
        lines.push('M30');
        
        return lines.join('\n');
    }
    
    _startDemoSimulation() {
        // Simulate machining through the G-code
        // We update grblhal's demo position and let IT send status updates (avoids conflicts)
        let simProgress = 0;
        this._demoPaused = false;
        this._demoPauseCount = 0;
        
        this.demoInterval = setInterval(() => {
            // Pause between loops (3 second pause = 6 ticks at 500ms)
            if (this._demoPaused) {
                this._demoPauseCount++;
                if (this._demoPauseCount >= 6) {
                    this._demoPaused = false;
                    this._demoPauseCount = 0;
                }
                return;
            }
            
            if (!this._demoGCode || this._demoLineIndex >= this._demoGCode.length) {
                // End of demo - pause before restart
                this._demoLineIndex = 0;
                this._demoPosition = { x: 0, y: 0, z: 5 };
                simProgress = 0;
                this._demoPaused = true;
                this._demoPauseCount = 0;
                
                // Sync to grblhal
                if (this.grbl) {
                    this.grbl.demoPosition = { ...this._demoPosition };
                    this.grbl.demoSpindle = 0;
                    this.grbl.demoFeed = 0;
                    this.grbl.demoStatus = 'Idle';
                    this.grbl.demoCoolant = { flood: false, mist: false };
                }
                
                // Reset material for visual
                if (this.visualizerType === 'enhanced3d') {
                    this.visualizer?.resetMaterial?.();
                }
                
                // Update progress
                if (this.elements.progressFill) {
                    this.elements.progressFill.style.width = '0%';
                }
                if (this.elements.jobProgress) {
                    this.elements.jobProgress.textContent = 'Demo: Paused';
                }
                return;
            }
            
            // Process one line per tick for realistic speed
            const line = this._demoGCode[this._demoLineIndex];
            this._processDemoLine(line);
            this._demoLineIndex++;
            
            // Calculate progress
            simProgress = (this._demoLineIndex / this._demoGCode.length) * 100;
            
            // Sync position and state to grblhal (it sends the status updates)
            if (this.grbl) {
                this.grbl.demoPosition = { ...this._demoPosition };
                this.grbl.demoSpindle = this._demoSpindle;
                this.grbl.demoFeed = this._demoFeed;
                this.grbl.demoStatus = this._demoSpindle > 0 ? 'Run' : 'Idle';
                this.grbl.demoCoolant = { flood: false, mist: false }; // Keep coolant OFF in demo
            }
            
            // Update progress bar
            if (this.elements.progressFill) {
                this.elements.progressFill.style.width = `${simProgress}%`;
            }
            if (this.elements.jobProgress) {
                this.elements.jobProgress.textContent = `Demo: ${simProgress.toFixed(0)}%`;
            }
            
        }, 500); // 2 updates per second - smooth realistic demo
    }
    
    _processDemoLine(line) {
        if (!line || line.startsWith(';')) return;
        
        const upper = line.toUpperCase();
        
        // Parse G-codes
        if (upper.includes('G0') || upper.includes('G1')) {
            const isRapid = upper.includes('G0');
            
            // Extract coordinates
            const xMatch = line.match(/X(-?\d+\.?\d*)/i);
            const yMatch = line.match(/Y(-?\d+\.?\d*)/i);
            const zMatch = line.match(/Z(-?\d+\.?\d*)/i);
            const fMatch = line.match(/F(\d+\.?\d*)/i);
            
            if (xMatch) this._demoPosition.x = parseFloat(xMatch[1]);
            if (yMatch) this._demoPosition.y = parseFloat(yMatch[1]);
            if (zMatch) this._demoPosition.z = parseFloat(zMatch[1]);
            if (fMatch) this._demoFeed = parseFloat(fMatch[1]);
            
            if (isRapid) this._demoFeed = 2000; // Hobby CNC rapid (not industrial 5000+)
        }
        
        // Spindle control
        if (upper.includes('M3') || upper.includes('M03')) {
            const sMatch = line.match(/S(\d+)/i);
            this._demoSpindle = sMatch ? parseInt(sMatch[1]) : 24000; // 24K spindle
        }
        if (upper.includes('M5') || upper.includes('M05')) {
            this._demoSpindle = 0;
        }
    }
    
    stopDemo() {
        if (this.demoInterval) {
            clearInterval(this.demoInterval);
            this.demoInterval = null;
        }
        this.demoMode = false;
        this._demoGCode = null;
        this._demoLineIndex = 0;
        
        // Stop grbl demo mode
        if (this.grbl) {
            this.grbl.setDemoMode(false);
        }
        
        this.showOverlay();
        
        // Clear visualizer
        if (this.visualizer) {
            this.visualizer.clear?.();
        }
    }
    
    onGrblStatus(state) {
        // Update position displays (Machine Position)
        if (state.mpos) {
            if (this.elements.posX) this.elements.posX.textContent = state.mpos.x.toFixed(3);
            if (this.elements.posY) this.elements.posY.textContent = state.mpos.y.toFixed(3);
            if (this.elements.posZ) this.elements.posZ.textContent = state.mpos.z.toFixed(3);
        }
        
        // Work Position
        if (state.wpos) {
            if (this.elements.wposX) this.elements.wposX.textContent = state.wpos.x.toFixed(3);
            if (this.elements.wposY) this.elements.wposY.textContent = state.wpos.y.toFixed(3);
            if (this.elements.wposZ) this.elements.wposZ.textContent = state.wpos.z.toFixed(3);
        }
        
        // Status badge
        if (this.elements.machineStatus) {
            this.elements.machineStatus.textContent = state.status;
            this.elements.machineStatus.className = `status-badge status-${state.status.toLowerCase()}`;
        }
        
        // Feed rate and spindle - FIXED: using correct property names
        if (this.elements.feedRate) {
            this.elements.feedRate.textContent = Math.round(state.feedRate || state.feed || 0);
        }
        if (this.elements.spindleSpeed) {
            this.elements.spindleSpeed.textContent = Math.round(state.spindleSpeed || state.spindle || 0);
        }
        
        // Overrides - FIXED: using correct property names (both nested and flat work now)
        if (this.elements.overrideFeedVal) {
            this.elements.overrideFeedVal.textContent = `${state.feedOverride || state.override?.feed || 100}%`;
        }
        if (this.elements.overrideRapidVal) {
            this.elements.overrideRapidVal.textContent = `${state.rapidOverride || state.override?.rapid || 100}%`;
        }
        if (this.elements.overrideSpindleVal) {
            this.elements.overrideSpindleVal.textContent = `${state.spindleOverride || state.override?.spindle || 100}%`;
        }
        
        // Coolant indicators - FIXED: proper state checking
        if (this.elements.coolantFlood) {
            this.elements.coolantFlood.classList.toggle('active', state.coolant?.flood === true);
        }
        if (this.elements.coolantMist) {
            this.elements.coolantMist.classList.toggle('active', state.coolant?.mist === true);
        }
        
        // Limit switch indicators
        if (state.limits) {
            if (this.elements.limitX) {
                this.elements.limitX.classList.toggle('active', state.limits.x === true);
            }
            if (this.elements.limitY) {
                this.elements.limitY.classList.toggle('active', state.limits.y === true);
            }
            if (this.elements.limitZ) {
                this.elements.limitZ.classList.toggle('active', state.limits.z === true);
            }
        }
        
        // Update limit status in settings panel from Pn field
        if (state.pins !== undefined) {
            this.updateLimitStatus(state.pins);
        }
        
        // Update visualizer with tool position and machining data
        if (this.visualizer && state.wpos) {
            const feedRate = state.feedRate || state.feed || 0;
            const spindleSpeed = state.spindleSpeed || state.spindle || 0;
            
            // Enhanced visualizer supports additional parameters
            if (typeof this.visualizer.setToolPosition === 'function') {
                if (this.visualizerType === 'enhanced3d') {
                    this.visualizer.setToolPosition(
                        state.wpos.x, 
                        state.wpos.y, 
                        state.wpos.z,
                        feedRate,
                        spindleSpeed
                    );
                    
                    // Set machining state based on feed rate and spindle
                    const isMachining = feedRate > 0 && spindleSpeed > 0 && 
                                       (state.status === 'Run' || state.status === 'Hold');
                    this.visualizer.setMachiningState(isMachining);
                } else {
                    this.visualizer.setToolPosition(state.wpos.x, state.wpos.y, state.wpos.z);
                }
            }
        }
        
        // =====================================================
        // SAFETY: Disable controls during ALARM state
        // =====================================================
        const isAlarm = state.status === 'Alarm' || state.status === 'Door';
        const isIdle = state.status === 'Idle';
        const canOperate = !isAlarm && this.connected;
        
        // Disable jog buttons during alarm
        document.querySelectorAll('[data-jog]').forEach(btn => {
            btn.disabled = !canOperate;
            btn.classList.toggle('disabled', !canOperate);
        });
        
        // Disable spindle controls during alarm
        document.getElementById('spindle-cw')?.toggleAttribute('disabled', !canOperate);
        document.getElementById('spindle-ccw')?.toggleAttribute('disabled', !canOperate);
        document.getElementById('spindle-stop')?.toggleAttribute('disabled', !canOperate);
        
        // Disable job start during alarm
        if (this.elements.btnStart) {
            this.elements.btnStart.disabled = isAlarm || !isIdle;
        }
        
        // Show alarm modal when in alarm, close when not
        if (isAlarm) {
            // Modal is shown by onGrblAlarm
            this._alarmClearSince = 0;
        } else {
            // Machine is no longer in alarm.
            // To prevent flashing when the controller briefly reports non-alarm and then returns to alarm,
            // only close the modal after we've been out of alarm for a short stable time.
            const alarmClearDelayMs = 1500;

            if (this._alarmModalShown) {
                if (!this._alarmClearSince) this._alarmClearSince = Date.now();

                if ((Date.now() - this._alarmClearSince) >= alarmClearDelayMs) {
                    this._alarmModalShown = false;
                    this._alarmClearSince = 0;
                    this.closeAlarmModal();
                }
            } else {
                this._alarmClearSince = 0;
            }
        }
        this._lastMachineStatus = state.status;
        
        // Visual indicator when in alarm
        document.body.classList.toggle('machine-alarm', isAlarm);
        
        // Show/hide the clickable alarm badge
        const alarmBadge = document.getElementById('alarm-badge');
        if (alarmBadge) {
            alarmBadge.classList.toggle('hidden', !isAlarm);
        }
    }
    
    onGrblError(error, info) {
        // Handle both simple string errors and detailed error objects
        let errorMsg = error.message || error;
        let fixHint = '';
        
        // If we have detailed info from dual-serial error parsing
        if (info && info.msg) {
            errorMsg = info.msg;
            fixHint = info.fix;
        }
        // Parse error code from string like "error:9"
        else if (typeof error === 'string' && error.startsWith('error:')) {
            const code = parseInt(error.split(':')[1]);
            const errorInfo = this._getGrblErrorInfo(code);
            errorMsg = `Error ${code}: ${errorInfo.msg}`;
            fixHint = errorInfo.fix;
        }
        
        this.log(`ERROR: ${errorMsg}`, 'error');
        
        // Show notification with fix hint
        if (fixHint) {
            this.showNotification(`❌ ${errorMsg}\n💡 ${fixHint}`, 'error', 5000);
        } else {
            this.showNotification(`❌ ${errorMsg}`, 'error', 3000);
        }
    }
    
    /**
     * Get human-readable grblHAL error info
     */
    _getGrblErrorInfo(code) {
        const errors = {
            1: { msg: 'G-code word missing letter', fix: 'Check G-code syntax' },
            2: { msg: 'Numeric value format invalid', fix: 'Check number formatting' },
            3: { msg: 'Command not recognized', fix: 'Use valid $ command' },
            4: { msg: 'Negative value not allowed', fix: 'Use positive value' },
            5: { msg: 'Homing not enabled', fix: 'Enable homing ($22=1)' },
            6: { msg: 'Step pulse too short', fix: 'Increase $0 value' },
            7: { msg: 'EEPROM read failed', fix: 'Reset settings ($RST=$)' },
            8: { msg: 'Need $X unlock', fix: 'Press Unlock button' },
            9: { msg: 'G-code locked (alarm active)', fix: 'Clear alarm first ($X or Home)' },
            10: { msg: 'Soft limits need homing', fix: 'Home the machine first' },
            11: { msg: 'G-code line too long', fix: 'Shorten line (<80 chars)' },
            12: { msg: 'Step rate exceeded', fix: 'Reduce feed/acceleration' },
            13: { msg: 'Safety door open', fix: 'Close the safety door' },
            14: { msg: 'Startup line too long', fix: 'Shorten startup line' },
            15: { msg: 'Travel limit exceeded', fix: 'Check soft limits ($130-132)' },
            16: { msg: 'Invalid jog command', fix: 'Check jog syntax' },
            17: { msg: 'Laser mode needs PWM', fix: 'Configure spindle' },
            20: { msg: 'Unsupported G-code', fix: 'Check G-code compatibility' },
            21: { msg: 'Conflicting G-codes', fix: 'One motion code per line' },
            22: { msg: 'Feed rate missing', fix: 'Add F word to G1/G2/G3' },
            23: { msg: 'Integer required', fix: 'Use whole number' },
            24: { msg: 'Need 2+ axis words', fix: 'Add X, Y, or Z' },
            25: { msg: 'Duplicate G-code', fix: 'Remove duplicate' },
            26: { msg: 'No axis specified', fix: 'Add X, Y, or Z' },
            27: { msg: 'Invalid line number', fix: 'Check N word' },
            28: { msg: 'Missing required value', fix: 'Add missing parameter' },
            29: { msg: 'WCS not supported', fix: 'Use G54-G59 only' },
            30: { msg: 'G53 needs G0/G1', fix: 'Add G0 or G1' },
            31: { msg: 'Extra axis words', fix: 'Remove extra axes' },
            32: { msg: 'No axis in block', fix: 'Add coordinates' },
            33: { msg: 'Invalid arc target', fix: 'Check arc I/J/K' },
            34: { msg: 'Arc radius error', fix: 'Check arc math' },
            35: { msg: 'Arc needs endpoint', fix: 'Add arc XYZ' },
            36: { msg: 'Unused value', fix: 'Remove extra words' },
            37: { msg: 'Tool offset not set', fix: 'Set tool length offset' },
            38: { msg: 'Invalid tool number', fix: 'Use T1-T100' },
            60: { msg: 'SD card missing', fix: 'Insert SD card' },
            61: { msg: 'SD read failed', fix: 'Check SD card' },
            62: { msg: 'SD write failed', fix: 'Check SD space' },
            63: { msg: 'File not found', fix: 'Check filename' }
        };
        return errors[code] || { msg: `Unknown error (${code})`, fix: 'Check grblHAL docs' };
    }
    
    onGrblAlarm(alarm) {
        const info = this.grbl.alarmCodes[alarm.code] || { msg: 'Unknown alarm', recovery: 'Unlock or Home' };
        this.log(`ALARM ${alarm.code}: ${info.msg}`, 'error');
        
        // Store last alarm info for display if user clicks the badge
        this._lastAlarm = {
            code: alarm.code,
            info: info,
            timestamp: Date.now()
        };
        
        // NON-BLOCKING: Only show notification and play sound for critical alarms
        // The body.machine-alarm class will show the red border + badge
        // User can click the badge to see details
        
        let isCritical = false;
        switch (alarm.code) {
            case 1: // Hard limit
            case 2: // Soft limit
                this.showNotification(`⚠️ ALARM ${alarm.code}: Limit triggered - machine stopped`, 'error', 5000);
                this.playAlarmSound(2000);
                isCritical = true;
                break;
            case 10: // E-STOP
                this.showNotification('🛑 E-STOP ACTIVATED - Release and reset when safe', 'error', 5000);
                this.playAlarmSound(3000);
                isCritical = true;
                break;
            case 13: // Spindle at-speed timeout
                this.showNotification('⚠️ VFD/Spindle communication failed', 'error', 5000);
                this.playAlarmSound(2000);
                isCritical = true;
                break;
            default:
                // Non-critical alarm - just a brief notification
                this.showNotification(`ALARM ${alarm.code}: ${info.msg}`, 'warning', 3000);
        }
        
        // Only auto-show modal for critical safety alarms (E-STOP, hard limits)
        if (isCritical && (alarm.code === 10 || alarm.code === 1)) {
            if (!this._alarmModalShown) {
                let title = alarm.code === 10 ? '🛑 E-STOP ACTIVATED' : '⚠️ LIMIT SWITCH TRIGGERED';
                let message = info.msg;
                let details = `ALARM:${alarm.code}\nRecovery: ${info.recovery || 'Unlock or Home'}`;
                this.showAlarmModal(title, message, details);
            }
        }
    }
    
    onGrblSetting(setting) {
        // Store setting
        const key = `$${setting.num}`;
        this.grblSettings[key] = setting.value;
        
        // Update limit settings UI if applicable
        this.updateLimitSettingsUI({ [key]: setting.value });
        
        // Log for debugging
        this.log(`${key}=${setting.value}`, 'setting');
    }
    
    onStreamProgress(info) {
        if (this.elements.progressFill) {
            this.elements.progressFill.style.width = `${info.progress}%`;
        }
        if (this.elements.jobProgress) {
            this.elements.jobProgress.textContent = `${info.current} / ${info.total} (${info.progress.toFixed(1)}%)`;
        }
        
        // Job time estimation
        this._updateJobTimeEstimate(info);
    }
    
    /**
     * Calculate and display estimated time remaining
     */
    _updateJobTimeEstimate(info) {
        const now = Date.now();
        
        // Initialize tracking on job start
        if (!this._jobStartTime || info.current === 1) {
            this._jobStartTime = now;
            this._lastProgressUpdate = { time: now, line: info.current };
            this._jobTimeHistory = [];
        }
        
        // Calculate elapsed time
        const elapsedMs = now - this._jobStartTime;
        const elapsedStr = this._formatTime(elapsedMs);
        
        // Calculate time per line (rolling average for accuracy)
        const linesSinceStart = info.current;
        const linesRemaining = info.total - info.current;
        
        // Track recent progress rate
        if (this._lastProgressUpdate && info.current > this._lastProgressUpdate.line) {
            const recentLines = info.current - this._lastProgressUpdate.line;
            const recentTime = now - this._lastProgressUpdate.time;
            const recentRate = recentTime / recentLines; // ms per line
            
            this._jobTimeHistory.push(recentRate);
            // Keep last 50 samples
            if (this._jobTimeHistory.length > 50) {
                this._jobTimeHistory.shift();
            }
            
            this._lastProgressUpdate = { time: now, line: info.current };
        }
        
        // Calculate ETA using weighted average (recent rates weighted more)
        let estimatedRemaining = 0;
        if (this._jobTimeHistory.length > 0 && linesRemaining > 0) {
            // Weight recent measurements more
            let weightedSum = 0;
            let weightSum = 0;
            for (let i = 0; i < this._jobTimeHistory.length; i++) {
                const weight = i + 1; // Later entries have higher weight
                weightedSum += this._jobTimeHistory[i] * weight;
                weightSum += weight;
            }
            const avgMsPerLine = weightedSum / weightSum;
            estimatedRemaining = linesRemaining * avgMsPerLine;
        } else if (linesSinceStart > 0 && linesRemaining > 0) {
            // Fallback: use overall average
            const avgMsPerLine = elapsedMs / linesSinceStart;
            estimatedRemaining = linesRemaining * avgMsPerLine;
        }
        
        const etaStr = estimatedRemaining > 0 ? this._formatTime(estimatedRemaining) : '--:--';
        
        // Update UI
        const elapsedEl = document.getElementById('job-elapsed');
        const etaEl = document.getElementById('job-eta');
        const jobTimeEl = document.getElementById('job-time-info');
        
        if (elapsedEl) elapsedEl.textContent = elapsedStr;
        if (etaEl) etaEl.textContent = etaStr;
        if (jobTimeEl) {
            jobTimeEl.textContent = `Elapsed: ${elapsedStr} | ETA: ${etaStr}`;
        }
    }
    
    /**
     * Format milliseconds as HH:MM:SS or MM:SS
     */
    _formatTime(ms) {
        const totalSec = Math.floor(ms / 1000);
        const hours = Math.floor(totalSec / 3600);
        const mins = Math.floor((totalSec % 3600) / 60);
        const secs = totalSec % 60;
        
        if (hours > 0) {
            return `${hours}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
        }
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }
    
    // ================================================================
    // Visualizer Setup - Use Enhanced 3D if available
    // ================================================================
    
    setupVisualizer() {
        const container = this.elements.visualizerCanvas?.parentElement || 
                         document.getElementById('visualizer-container') ||
                         document.querySelector('.canvas-wrapper');
        
        if (!container) {
            console.warn('Visualizer container not found');
            return;
        }
        
        // Try to use the enhanced 3D visualizer first
        if (typeof EnhancedVisualizer !== 'undefined') {
            console.log('[App] Using Enhanced 3D Visualizer with premium effects');
            this.visualizer = new EnhancedVisualizer({
                container: container,
                workArea: this.workArea,
                gridSize: 10,
                stock: { x: 200, y: 150, z: 25 },
                stockPosition: { x: 50, y: 50, z: 0 }
            });
            this.visualizerType = 'enhanced3d';
        }
        // Fall back to basic 3D
        else if (typeof GCodeVisualizer3D !== 'undefined') {
            console.log('[App] Using 3D Visualizer');
            this.visualizer = new GCodeVisualizer3D({
                container: container,
                workArea: this.workArea,
                gridSize: 10
            });
            this.visualizerType = '3d';
        }
        // Fall back to 2D canvas
        else if (typeof GCodeVisualizer !== 'undefined') {
            console.log('[App] Using 2D Canvas Visualizer');
            this.visualizer = new GCodeVisualizer({
                canvas: this.elements.visualizerCanvas,
                workArea: this.workArea,
                gridSize: 10
            });
            this.visualizerType = '2d';
        } else {
            console.warn('No visualizer available');
            return;
        }
        
        // Create visualizer toolbar controls
        this.createVisualizerControls();
    }
    
    createVisualizerControls() {
        const toolbar = document.querySelector('.visualizer-toolbar');
        if (!toolbar) return;
        
        // Check if controls already exist
        if (toolbar.querySelector('.view-presets')) return;
        
        // Add view preset buttons
        const viewPresets = document.createElement('div');
        viewPresets.className = 'view-presets';
        viewPresets.innerHTML = `
            <button class="view-preset-btn active" data-view="isometric">3D</button>
            <button class="view-preset-btn" data-view="top">Top</button>
            <button class="view-preset-btn" data-view="front">Front</button>
            <button class="view-preset-btn" data-view="right">Side</button>
        `;
        
        viewPresets.querySelectorAll('.view-preset-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                viewPresets.querySelectorAll('.view-preset-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.visualizer?.setView?.(btn.dataset.view);
            });
        });
        
        // Add material selector if enhanced visualizer
        if (this.visualizerType === 'enhanced3d') {
            const materialSelector = document.createElement('div');
            materialSelector.className = 'material-selector';
            materialSelector.innerHTML = `
                <button class="material-btn wood active" data-material="wood" title="Wood"></button>
                <button class="material-btn aluminum" data-material="aluminum" title="Aluminum"></button>
                <button class="material-btn steel" data-material="steel" title="Steel"></button>
                <button class="material-btn plastic" data-material="plastic" title="Plastic"></button>
                <button class="material-btn foam" data-material="foam" title="Foam"></button>
            `;
            
            materialSelector.querySelectorAll('.material-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    materialSelector.querySelectorAll('.material-btn').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    this.visualizer?.setMaterialType?.(btn.dataset.material);
                });
            });
            
            // Add cinematic toggle
            const cinematicToggle = document.createElement('div');
            cinematicToggle.className = 'cinematic-toggle';
            cinematicToggle.innerHTML = `
                <span class="toggle-icon">🎬</span>
                <span class="toggle-label">Cinematic</span>
            `;
            cinematicToggle.addEventListener('click', () => {
                cinematicToggle.classList.toggle('active');
                this.visualizer?.setCinematicMode?.(cinematicToggle.classList.contains('active'));
            });
            
            const vizControls = toolbar.querySelector('.viz-controls') || toolbar;
            vizControls.appendChild(materialSelector);
            vizControls.appendChild(cinematicToggle);
        }
        
        const vizControls = toolbar.querySelector('.viz-controls') || toolbar;
        vizControls.insertBefore(viewPresets, vizControls.firstChild);
    }
    
    // ================================================================
    // AI Assistant Setup
    // ================================================================
    
    setupAI() {
        if (typeof CNCAssistant === 'undefined') {
            console.warn('CNCAssistant not loaded');
            return;
        }
        
        this.ai = new CNCAssistant({
            grbl: this.grbl,
            onResponse: (msg) => this.aiResponse(msg),
            onCommand: (cmd) => this.handleAICommand(cmd),
            onError: (err) => this.log(`AI Error: ${err}`, 'error'),
            // Pass machine state getter for contextual awareness
            getMachineState: () => this._getAIMachineContext()
        });

        // Keep AI workspace context aligned with app settings
        if (this.ai?.machineConfig) {
            this.ai.machineConfig.workArea = { ...this.workArea };
        }
        
        // Bind AI chat input with suggestions
        if (this.elements.aiInput) {
            this.elements.aiInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    this.sendAIMessage();
                }
            });
            
            // Add autocomplete suggestions
            this.elements.aiInput.addEventListener('input', (e) => {
                this._showAISuggestions(e.target.value);
            });
        }
        
        // Voice button
        if (this.elements.aiVoiceBtn) {
            this.elements.aiVoiceBtn.addEventListener('click', () => {
                if (this.ai.voiceEnabled) {
                    this.ai.stopVoice();
                    this.elements.aiVoiceBtn.classList.remove('active');
                } else {
                    this.ai.startVoice();
                    this.elements.aiVoiceBtn.classList.add('active');
                }
            });
        }
        
        // Create suggestions dropdown
        this._createAISuggestionsDropdown();
    }
    
    /**
     * Get current machine context for AI awareness
     */
    _getAIMachineContext() {
        return {
            connected: this.connected,
            state: this.dualSerial?.machineState || 'Unknown',
            position: this.dualSerial?.machinePos || { x: 0, y: 0, z: 0 },
            feedOverride: this.dualSerial?.feedOverride || 100,
            spindleRPM: this.dualSerial?.spindleRPM || 0,
            spindleOverride: this.dualSerial?.spindleOverride || 100,
            vfdConnected: this.dualSerial?.vfdConnected || false,
            homedAxes: this.dualSerial?.homedAxes || { x: false, y: false, z: false },
            tmcStatus: this.dualSerial?.tmcStatus || {}
        };
    }
    
    /**
     * Create AI suggestions dropdown
     */
    _createAISuggestionsDropdown() {
        const existing = document.getElementById('ai-suggestions');
        if (existing) return;
        
        const dropdown = document.createElement('div');
        dropdown.id = 'ai-suggestions';
        dropdown.className = 'ai-suggestions-dropdown hidden';
        dropdown.innerHTML = '';
        
        // Insert after AI input
        const inputRow = this.elements.aiInput?.parentElement;
        if (inputRow) {
            inputRow.style.position = 'relative';
            inputRow.appendChild(dropdown);
        }
    }
    
    /**
     * Show AI command suggestions based on input
     */
    _showAISuggestions(text) {
        const dropdown = document.getElementById('ai-suggestions');
        if (!dropdown || !text || text.length < 2) {
            dropdown?.classList.add('hidden');
            return;
        }
        
        const suggestions = this._getAISuggestions(text.toLowerCase());
        if (suggestions.length === 0) {
            dropdown.classList.add('hidden');
            return;
        }
        
        dropdown.innerHTML = suggestions.map((s, i) => `
            <div class="ai-suggestion" data-cmd="${s.cmd}" tabindex="${i}">
                <span class="ai-suggestion-icon">${s.icon}</span>
                <span class="ai-suggestion-text">${s.text}</span>
            </div>
        `).join('');
        
        dropdown.classList.remove('hidden');
        
        // Handle suggestion clicks
        dropdown.querySelectorAll('.ai-suggestion').forEach(el => {
            el.onclick = () => {
                this.elements.aiInput.value = el.dataset.cmd;
                dropdown.classList.add('hidden');
                this.elements.aiInput.focus();
            };
        });
    }
    
    /**
     * Get relevant suggestions based on partial input
     */
    _getAISuggestions(text) {
        const allSuggestions = [
            { icon: '🏠', text: 'home', cmd: 'home' },
            { icon: '🔓', text: 'unlock', cmd: 'unlock' },
            { icon: '⬆️', text: 'jog up 10', cmd: 'jog up 10' },
            { icon: '⬇️', text: 'jog down 5', cmd: 'jog down 5' },
            { icon: '⬅️', text: 'jog left 10', cmd: 'jog left 10' },
            { icon: '➡️', text: 'jog right 10', cmd: 'jog right 10' },
            { icon: '🎯', text: 'go to X0 Y0', cmd: 'go to X0 Y0' },
            { icon: '⭕', text: 'zero all', cmd: 'zero all' },
            { icon: '🔄', text: 'spindle on 12000', cmd: 'spindle on 12000' },
            { icon: '⏹️', text: 'spindle off', cmd: 'spindle off' },
            { icon: '▶️', text: 'run job', cmd: 'run job' },
            { icon: '⏸️', text: 'pause', cmd: 'pause' },
            { icon: '📍', text: 'probe z', cmd: 'probe z' },
            { icon: '📊', text: 'status', cmd: 'status' },
            { icon: '💧', text: 'coolant on', cmd: 'coolant on' },
            { icon: '🛑', text: 'stop', cmd: 'stop' },
            { icon: '⚡', text: 'feed 150%', cmd: 'feed 150%' },
            { icon: '🐢', text: 'feed 50%', cmd: 'feed 50%' },
            { icon: '❓', text: 'help', cmd: 'help' }
        ];
        
        // Filter by partial match
        return allSuggestions.filter(s => 
            s.text.includes(text) || s.cmd.toLowerCase().includes(text)
        ).slice(0, 6);
    }
    
    sendAIMessage() {
        const input = this.elements.aiInput;
        if (!input || !input.value.trim()) return;
        
        // Hide suggestions
        document.getElementById('ai-suggestions')?.classList.add('hidden');
        
        const message = input.value.trim();
        input.value = '';
        
        // Show user message in chat
        this.addChatMessage(message, 'user');
        
        // Process with AI
        this.ai.processInput(message);
    }
    
    aiResponse(msg) {
        this.addChatMessage(msg, 'assistant');
    }
    
    addChatMessage(msg, role) {
        const output = this.elements.aiOutput;
        if (!output) return;
        
        const div = document.createElement('div');
        div.className = `chat-message chat-${role}`;
        
        // Sanitize and convert markdown-like formatting (XSS protection)
        let sanitized = msg
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
        
        // Now apply safe markdown formatting
        let html = sanitized
            .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
            .replace(/`(.+?)`/g, '<code>$1</code>')
            .replace(/\n/g, '<br>')
            .replace(/^- (.+)$/gm, '<li>$1</li>')
            .replace(/(<li>.*<\/li>)/gs, '<ul>$1</ul>');
        
        div.innerHTML = html;
        output.appendChild(div);
        output.scrollTop = output.scrollHeight;
    }
    
    handleAICommand(cmd) {
        switch (cmd.action) {
            case 'openProbeWizard':
                this.openProbeWizard(cmd.type);
                break;
            case 'runJob':
                this.startJob();
                break;
            case 'stop':
                this.stopJob();
                break;
            case 'analyzeGcode':
                this.analyzeCurrentGcode();
                break;
        }
    }
    
    analyzeCurrentGcode() {
        if (this.gcodeLines.length === 0) {
            this.aiResponse('No G-code loaded to analyze. Load a file first!');
            return;
        }
        
        const report = this.ai.analyzeGcode(this.gcodeLines);
        this.aiResponse(report);
    }
    
    // ================================================================
    // Probe Wizard Setup
    // ================================================================
    
    setupProbeWizard() {
        if (typeof ProbeWizard === 'undefined') {
            console.warn('ProbeWizard not loaded');
            return;
        }
        
        this.probeWizard = new ProbeWizard({
            grbl: this.grbl,
            container: this.elements.probeWizardContainer,
            onComplete: (result) => {
                this.log(`Probe complete: ${JSON.stringify(result)}`, 'success');
                this.showNotification('Probe complete!', 'success');
            },
            onError: (err) => {
                this.log(`Probe error: ${err.message}`, 'error');
            },
            onStatus: (msg) => this.log(msg, 'info')
        });
    }
    
    openProbeWizard(type = null) {
        if (this.probeWizard) {
            this.probeWizard.open(type);
        }
    }
    
    // ================================================================
    // ATC Setup
    // ================================================================
    
    setupATC() {
        if (typeof ATCController === 'undefined') {
            console.warn('ATCController not loaded');
            return;
        }
        
        this.atc = new ATCController({
            grbl: this.grbl,
            config: {
                toolCount: 5,
                toolSpacing: 50.4,  // Your exact spacing
                rackX: -10,
                rackY: 350,
                rackZ: -50,
                safeZ: -5
            },
            onStatus: (msg) => this.log(msg, 'info'),
            onError: (err) => {
                this.log(`ATC Error: ${err.message}`, 'error');
                this.showNotification(`ATC Error: ${err.message}`, 'error');
            },
            onComplete: (tool) => {
                this.showNotification(`Tool ${tool} loaded`, 'success');
            }
        });
    }
    
    async changeTool(toolNum) {
        if (this.atc) {
            try {
                await this.atc.changeTool(toolNum);
            } catch (err) {
                this.showNotification(`Tool change failed: ${err.message}`, 'error');
            }
        }
    }
    
    // ================================================================
    // Surfacing Wizard Setup
    // ================================================================
    
    setupSurfacing() {
        if (typeof SurfacingWizard === 'undefined') {
            console.warn('SurfacingWizard not loaded');
            return;
        }
        
        this.surfacing = new SurfacingWizard({
            grbl: this.grbl,
            container: this.elements.surfacingContainer,
            onStatus: (msg) => this.log(msg, 'info'),
            onComplete: () => {
                this.showNotification('Surfacing complete!', 'success');
            }
        });
    }
    
    // ================================================================
    // Monitoring Dashboard Setup
    // ================================================================
    
    setupMonitoring() {
        if (typeof MonitoringDashboard === 'undefined') {
            console.warn('MonitoringDashboard not loaded');
            return;
        }
        
        const container = document.getElementById('monitoring-container');
        if (!container) {
            // Create container if it doesn't exist
            const monitoringContainer = document.createElement('div');
            monitoringContainer.id = 'monitoring-container';
            monitoringContainer.className = 'panel hidden';
            document.querySelector('.main-content')?.appendChild(monitoringContainer);
        }
        
        this.monitoring = new MonitoringDashboard(
            document.getElementById('monitoring-container'),
            this.grbl
        );
        
        // Setup step loss detection if available
        this.setupStepLossDetection();
    }
    
    // ================================================================
    // Step Loss Detection Setup (Unconventional Methods)
    // ================================================================
    
    setupStepLossDetection() {
        if (typeof StepLossDetection === 'undefined') {
            console.warn('StepLossDetection not loaded - step loss features unavailable');
            return;
        }
        
        this.stepLoss = new StepLossDetection({
            grbl: this.grbl,
            chatterSystem: this.chatterDetection || null,  // Pass chatter system if available
            
            // Callbacks
            onStallDetected: (axis, method, confidence) => {
                this.handleStallDetected(axis, method, confidence);
            },
            onWarning: (message, severity) => {
                this.log(`⚠️ Step Loss Warning: ${message}`, 
                         severity > 0.7 ? 'error' : 'warning');
            },
            onResonanceZone: (feedRate) => {
                this.log(`🔊 Resonance zone detected at ${feedRate} mm/min - avoiding`, 'warning');
            },
            onThermalDrift: (axis, driftMM) => {
                this.log(`🌡️ Thermal drift on ${axis}: ${driftMM.toFixed(3)}mm compensated`, 'info');
            }
        });
        
        // Start monitoring (it will wait for connections)
        this.stepLoss.start().then(status => {
            if (status.activeMethodCount === 0) {
                this.log('⚠️ Step Loss Detection: No sensors connected yet', 'warning');
            } else {
                this.log(`🔧 Step Loss Detection: ${status.activeMethodCount} methods active`, 'info');
            }
        }).catch(e => {
            console.error('Step loss detection failed to start:', e);
        });
        
        // Create step loss status panel
        this.createStepLossPanel();
    }
    
    createStepLossPanel() {
        const panel = document.createElement('div');
        panel.id = 'step-loss-panel';
        panel.className = 'step-loss-panel';
        panel.innerHTML = `
            <div class="step-loss-header">
                <span class="step-loss-title">🔍 Step Loss Monitor</span>
                <span class="step-loss-status" id="step-loss-status">IDLE</span>
            </div>
            <div class="step-loss-gauges">
                <div class="gauge" id="gauge-x">
                    <div class="gauge-label">X</div>
                    <div class="gauge-bar"><div class="gauge-fill" id="load-x"></div></div>
                    <div class="gauge-value" id="load-x-val">0%</div>
                </div>
                <div class="gauge" id="gauge-y">
                    <div class="gauge-label">Y</div>
                    <div class="gauge-bar"><div class="gauge-fill" id="load-y"></div></div>
                    <div class="gauge-value" id="load-y-val">0%</div>
                </div>
                <div class="gauge" id="gauge-z">
                    <div class="gauge-label">Z</div>
                    <div class="gauge-bar"><div class="gauge-fill" id="load-z"></div></div>
                    <div class="gauge-value" id="load-z-val">0%</div>
                </div>
            </div>
            <div class="step-loss-controls">
                <button id="btn-learn-mode" title="Learn normal vibration patterns">📚 Learn</button>
                <button id="btn-verify-position" title="Probe reference point">📍 Verify</button>
                <button id="btn-step-loss-settings" title="Configure detection">⚙️</button>
            </div>
        `;
        
        // Insert after monitoring container
        const monitoringPanel = document.getElementById('monitoring-container');
        if (monitoringPanel) {
            monitoringPanel.parentNode.insertBefore(panel, monitoringPanel.nextSibling);
        } else {
            document.querySelector('.main-content')?.appendChild(panel);
        }
        
        // Bind panel events
        document.getElementById('btn-learn-mode')?.addEventListener('click', () => {
            this.startStepLossLearning();
        });
        
        document.getElementById('btn-verify-position')?.addEventListener('click', () => {
            this.verifyPositionWithProbe();
        });
        
        // Update panel periodically - store handle for cleanup on disconnect
        if (this.stepLossUpdateInterval) {
            clearInterval(this.stepLossUpdateInterval);
        }
        this.stepLossUpdateInterval = setInterval(() => this.updateStepLossPanel(), 250);
    }
    
    updateStepLossPanel() {
        if (!this.stepLoss) return;
        
        const status = this.stepLoss.getStatus();
        
        // Update status indicator
        const statusEl = document.getElementById('step-loss-status');
        if (statusEl) {
            statusEl.textContent = status.state;
            statusEl.className = `step-loss-status ${status.state.toLowerCase()}`;
        }
        
        // Update load gauges
        ['x', 'y', 'z'].forEach(axis => {
            const load = status.loads?.[axis] || 0;
            const fillEl = document.getElementById(`load-${axis}`);
            const valEl = document.getElementById(`load-${axis}-val`);
            
            if (fillEl) {
                fillEl.style.width = `${Math.min(100, load)}%`;
                fillEl.className = `gauge-fill ${load > 80 ? 'danger' : load > 50 ? 'warning' : 'normal'}`;
            }
            if (valEl) {
                valEl.textContent = `${Math.round(load)}%`;
            }
        });
    }
    
    handleStallDetected(axis, method, confidence) {
        // Try to pause motion if connected
        if (this.grbl && this.connected) {
            try {
                this.grbl.send('!');  // Feed hold
            } catch (e) {
                console.warn('Could not send feed hold:', e);
            }
        }
        
        // Sanitize inputs to prevent XSS
        const safeAxis = String(axis).replace(/[<>&"']/g, '');
        const safeMethod = String(method).replace(/[<>&"']/g, '');
        const safeConfidence = Math.max(0, Math.min(1, Number(confidence) || 0));
        
        // Alert user with modal
        const modal = document.createElement('div');
        modal.className = 'modal stall-alert';
        
        const isConnected = this.grbl && this.connected;
        
        modal.innerHTML = `
            <div class="modal-content stall-modal">
                <h2>⚠️ STALL DETECTED</h2>
                <p><strong>${safeAxis.toUpperCase()}-Axis</strong> appears to have lost steps!</p>
                <p>Detection method: <em>${safeMethod}</em></p>
                <p>Confidence: <strong>${(safeConfidence * 100).toFixed(0)}%</strong></p>
                ${!isConnected ? '<p class="warning-text">⚠️ Machine not connected - cannot send commands</p>' : ''}
                <div class="stall-actions">
                    <button id="stall-dismiss" class="btn-secondary">Dismiss</button>
                    ${isConnected ? `
                        <button id="stall-resume" class="btn-warning">Resume (risky)</button>
                        <button id="stall-rehome" class="btn-primary">Re-home Machine</button>
                        <button id="stall-verify" class="btn-success">Verify Position</button>
                    ` : ''}
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        
        // Bind dismiss (always available)
        modal.querySelector('#stall-dismiss').onclick = () => {
            modal.remove();
        };
        
        // Bind actions only if connected
        if (isConnected) {
            modal.querySelector('#stall-resume').onclick = () => {
                this.grbl.send('~');  // Cycle start
                modal.remove();
            };
            
            modal.querySelector('#stall-rehome').onclick = () => {
                this.grbl.send('$H');  // Home
                modal.remove();
            };
            
            modal.querySelector('#stall-verify').onclick = () => {
                this.verifyPositionWithProbe();
                modal.remove();
            };
        }
        
        // Log the event
        this.log(`🚨 STALL on ${axis.toUpperCase()}-axis (${method}, ${(confidence*100).toFixed(0)}% confidence)`, 'error');
        
        // Play alert sound
        this.playStallAlert();
    }
    
    playStallAlert() {
        // Generate alert tone using Web Audio
        try {
            const ctx = new (window.AudioContext || window.webkitAudioContext)();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            
            osc.connect(gain);
            gain.connect(ctx.destination);
            
            osc.frequency.value = 880;
            osc.type = 'square';
            gain.gain.value = 0.3;
            
            osc.start();
            
            // Beep pattern: 3 short beeps
            let beepCount = 0;
            const beepInterval = setInterval(() => {
                gain.gain.value = gain.gain.value > 0 ? 0 : 0.3;
                beepCount++;
                if (beepCount >= 6) {
                    clearInterval(beepInterval);
                    osc.stop();
                }
            }, 150);
        } catch (e) {
            console.warn('Could not play stall alert:', e);
        }
    }
    
    async startStepLossLearning() {
        if (!this.stepLoss) return;
        
        this.log('📚 Starting step loss learning mode - running calibration moves...', 'info');
        
        // Run through learning routine
        await this.stepLoss.startLearningMode({
            testMoves: [
                { axis: 'X', distance: 50, feed: 1000 },
                { axis: 'Y', distance: 50, feed: 1000 },
                { axis: 'Z', distance: 20, feed: 500 },
                { axis: 'X', distance: 50, feed: 3000 },
                { axis: 'Y', distance: 50, feed: 3000 },
            ],
            progressCallback: (pct, msg) => {
                this.log(`📚 Learning: ${msg} (${pct.toFixed(0)}%)`, 'info');
            }
        });
        
        this.log('✅ Step loss learning complete - patterns saved', 'info');
    }
    
    async verifyPositionWithProbe() {
        if (!this.stepLoss || !this.probeWizard) {
            this.log('Position verification requires probe wizard', 'warning');
            return;
        }
        
        this.log('📍 Verifying position at reference point...', 'info');
        
        const drift = await this.stepLoss.verifyReferencePoint();
        
        if (drift) {
            this.log(`📍 Position drift detected: X=${drift.x?.toFixed(3) || 0}mm, Y=${drift.y?.toFixed(3) || 0}mm, Z=${drift.z?.toFixed(3) || 0}mm`, 
                     Math.abs(drift.x || 0) > 0.1 ? 'error' : 'info');
        } else {
            this.log('✅ Position verified - no significant drift', 'info');
        }
    }
    
    toggleMonitoring() {
        if (this.monitoring) {
            this.monitoring.toggle();
        }
    }
    
    // ================================================================
    // G-code Simulator Setup
    // ================================================================
    
    setupSimulator() {
        if (typeof GCodeSimulator === 'undefined') {
            console.warn('GCodeSimulator not loaded');
            return;
        }
        
        this.simulator = new GCodeSimulator({
            grbl: this.grbl,
            onProgress: (pct, pos) => {
                // Update visualizer during simulation
                if (this.visualizer) {
                    this.visualizer.setSimulatedPosition(pos);
                }
            },
            onComplete: (results) => {
                this.log(`Simulation complete: ${results.summary}`, 'info');
            },
            onError: (err) => this.log(`Simulation error: ${err}`, 'error')
        });
    }
    
    simulateGCode() {
        if (!this.simulator || !this.gcodeLines.length) {
            this.log('No G-code loaded to simulate', 'warning');
            return null;
        }
        
        const gcode = this.gcodeLines.join('\n');
        const results = this.simulator.analyze(gcode);
        
        if (results.errors.length) {
            results.errors.forEach(err => this.log(`❌ ${err.message}`, 'error'));
        }
        if (results.warnings.length) {
            results.warnings.forEach(warn => this.log(`⚠️ ${warn.message}`, 'warning'));
        }
        
        this.log(`Estimated time: ${this.formatTime(results.accurateTime)}`, 'info');
        this.log(`Bounds: X[${results.bounds.minX.toFixed(1)}-${results.bounds.maxX.toFixed(1)}] Y[${results.bounds.minY.toFixed(1)}-${results.bounds.maxY.toFixed(1)}] Z[${results.bounds.minZ.toFixed(1)}-${results.bounds.maxZ.toFixed(1)}]`, 'info');
        
        return results;
    }
    
    // ================================================================
    // Job Recovery Setup
    // ================================================================
    
    setupRecovery() {
        if (typeof JobRecovery === 'undefined') {
            console.warn('JobRecovery not loaded');
            return;
        }
        
        this.recovery = new JobRecovery({
            grbl: this.grbl,
            onStatus: (msg) => this.log(`[Recovery] ${msg}`, 'info'),
            onRecoveryAvailable: (data) => {
                this.showRecoveryPrompt(data);
            }
        });
    }
    
    showRecoveryPrompt(recoveryData) {
        const elapsed = Date.now() - recoveryData.lastUpdate;
        const elapsedMin = Math.round(elapsed / 60000);
        const progress = ((recoveryData.currentLine / recoveryData.totalLines) * 100).toFixed(1);
        
        const msg = `Job recovery available!\n\n` +
            `File: ${recoveryData.fileName}\n` +
            `Progress: ${progress}% (line ${recoveryData.currentLine}/${recoveryData.totalLines})\n` +
            `Last update: ${elapsedMin} minutes ago\n\n` +
            `Resume job?`;
        
        if (confirm(msg)) {
            this.resumeRecoveredJob(recoveryData);
        } else {
            this.recovery.clearRecovery();
        }
    }
    
    async resumeRecoveredJob(data) {
        // Prompt for homing
        const shouldHome = confirm('Home machine before resuming? (Recommended)');
        
        try {
            const resumeGcode = await this.recovery.resume({
                homeFirst: shouldHome,
                safeZ: 10
            });
            
            if (resumeGcode) {
                this.gcodeLines = resumeGcode;
                this.streamGCode();
            }
        } catch (err) {
            this.log(`Recovery failed: ${err.message}`, 'error');
        }
    }
    
    // ================================================================
    // Settings Manager Setup
    // ================================================================
    
    setupSettingsManager() {
        if (typeof SettingsManager === 'undefined') {
            console.warn('SettingsManager not loaded');
            return;
        }
        
        this.settings = new SettingsManager({
            onStatus: (msg) => this.log(`[Settings] ${msg}`, 'info'),
            onError: (err) => this.log(`[Settings] ${err}`, 'error')
        });
    }
    
    exportSettings() {
        if (this.settings) {
            return this.settings.downloadBackup();
        }
    }
    
    async importSettings(file) {
        if (this.settings) {
            const result = await this.settings.importBackup(file);
            if (result.success) {
                this.log('Settings imported - reload page to apply', 'info');
            }
            return result;
        }
    }
    
    // ================================================================
    // Trinamic Config Setup
    // ================================================================
    
    setupTrinamicConfig() {
        if (typeof TrinamicConfig === 'undefined') {
            console.warn('TrinamicConfig not loaded');
            return;
        }
        
        this.trinamicConfig = new TrinamicConfig({
            grbl: this.grbl,
            onStatus: (msg) => this.log(`[TMC] ${msg}`, 'info'),
            onError: (err) => this.log(`[TMC] ${err}`, 'error')
        });
    }
    
    openTrinamicConfig() {
        if (this.trinamicConfig) {
            this.trinamicConfig.open();
        }
    }
    
    // ================================================================
    // Dual Serial Manager Setup (grblHAL + ChatterDetect + VFD)
    // ================================================================
    
    setupDualSerial() {
        if (typeof DualSerialManager === 'undefined') {
            console.warn('DualSerialManager not loaded - USB connections unavailable');
            return;
        }
        
        this.dualSerial = new DualSerialManager();
        
        // Handle chatter data updates
        this.dualSerial.onChatterData = (data) => {
            this.updateChatterUI(data);
        };
        
        // Handle connection changes
        this.dualSerial.onConnectionChange = (status) => {
            this._updateDeviceIndicators();
            this.updateChatterConnectionUI(status.chatter);
            this._updateVfdUI();
            
            // Hide overlay if grblHAL connected
            if (status.grbl) {
                document.getElementById('connection-overlay')?.classList.add('hidden');
                document.getElementById('app')?.classList.remove('hidden');
            }
        };
        
        // Handle reconnection attempts
        this.dualSerial.onReconnecting = (info) => {
            const deviceNames = {
                'grbl': 'grblHAL',
                'vfd': 'VFD Controller',
                'chatter': 'Chatter Sensor'
            };
            const name = deviceNames[info.device] || info.device;
            
            if (info.status === 'reconnecting') {
                this.showNotification(`🔄 Reconnecting ${name}... (attempt ${info.attempts})`, 'warning');
            } else if (info.status === 'connected') {
                this.showNotification(`✅ ${name} reconnected!`, 'success');
            } else if (info.status === 'failed') {
                this.showNotification(`❌ ${name} reconnection failed after ${info.attempts} attempts`, 'error');
            }
        };
        
        // Handle general messages from grblHAL
        this.dualSerial.onMessage = (msg) => {
            if (msg.type === 'homing') {
                this.log(`🏠 ${msg.text}`, 'info');
                this._updateHomingUI(true);
            } else if (msg.type === 'msg') {
                this.log(`[MSG] ${msg.text}`, 'info');
            } else if (msg.type === 'warning') {
                this.log(`⚠️ ${msg.text}`, 'warning');
                this.showNotification(msg.text, 'warning');
            }
        };
        
        // Handle homing complete
        this.dualSerial.onHomingComplete = (homedAxes) => {
            this.log('✅ Homing complete!', 'success');
            this.showNotification('🏠 Homing complete!', 'success');
            this.playSuccessSound();
            this._updateHomingUI(false, homedAxes);
        };
        
        // Handle firmware info response
        this.dualSerial.onFirmwareInfo = (info) => {
            this._updateFirmwareDisplay(info);
        };
        
        // Handle TMC2209 driver status updates
        this.dualSerial.onTmcStatus = (status) => {
            this._updateTmcDisplay(status);
        };
        
        // Handle VFD status updates
        this.dualSerial.onVfdStatus = (status) => {
            this._updateVfdUI();
            // Update spindle RPM displays from VFD
            const rpm = Math.round(status.actualRPM || 0);
            const rpmEl = document.getElementById('spindle-rpm');
            const liveEl = document.getElementById('live-spindle');
            const speedEl = document.getElementById('spindle-speed');
            if (rpmEl) rpmEl.textContent = rpm;
            if (liveEl) liveEl.textContent = rpm;
            if (speedEl) speedEl.textContent = `S: ${rpm}`;
            
            // Update diagnostics panel
            this.updateDiagnosticsVfd(status);
        };
        
        // Handle auto-detect progress
        this.dualSerial.onAutoDetect = (message) => {
            const msgEl = document.getElementById('auto-detect-message');
            if (msgEl) msgEl.textContent = message;
        };
        
        console.log('✓ DualSerialManager initialized');
    }
    
    /**
     * Auto-connect all USB devices
     */
    async autoConnectAll() {
        if (!this.dualSerial) {
            this.setupDualSerial();
        }
        
        const btn = document.getElementById('auto-connect-btn');
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '<span class="btn-icon-left">⏳</span> Scanning...';
        }
        
        try {
            const results = await this.dualSerial.autoDetectAll();
            
            this._updateDeviceIndicators();
            
            if (results.grbl) {
                this.log('✓ grblHAL connected', 'success');
                // Setup grbl wrapper for compatibility
                this._setupGrblFromDualSerial();
            }
            if (results.vfd) {
                this.log('✓ VFD Controller connected', 'success');
            }
            if (results.chatter) {
                this.log('✓ Chatter Sensor connected', 'success');
            }
            
            if (!results.grbl && !results.vfd && !results.chatter) {
                this.showNotification('No new devices found. Click "Add Device" to authorize.', 'warning');
            }
            
        } catch (err) {
            console.error('Auto-connect error:', err);
            this.showNotification('Connection error: ' + err.message, 'error');
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = '<span class="btn-icon-left">🔍</span> Auto Connect USB';
            }
        }
    }
    
    /**
     * Add a new device (shows browser popup)
     */
    async addNewDevice() {
        if (!this.dualSerial) {
            this.setupDualSerial();
        }
        
        try {
            await this.dualSerial.addDevice();
            this._updateDeviceIndicators();
        } catch (err) {
            if (err.name !== 'NotFoundError') {
                this.showNotification('Error adding device: ' + err.message, 'error');
            }
        }
    }
    
    /**
     * Update device indicator icons in connection overlay and header
     */
    _updateDeviceIndicators() {
        // Connection overlay indicators
        const grblEl = document.getElementById('device-grbl');
        const vfdEl = document.getElementById('device-vfd');
        const chatterEl = document.getElementById('device-chatter');
        const grblStatus = document.getElementById('device-grbl-status');
        const vfdStatus = document.getElementById('device-vfd-status');
        const chatterStatus = document.getElementById('device-chatter-status');
        
        // Header indicators
        const headerGrbl = document.getElementById('header-grbl-dot');
        const headerVfd = document.getElementById('header-vfd-dot');
        const headerChatter = document.getElementById('header-chatter-dot');
        const connIndicator = document.getElementById('connection-indicator');
        const connStatus = document.getElementById('connection-status');
        
        // grblHAL status
        if (this.dualSerial?.grblConnected) {
            if (grblEl) grblEl.style.opacity = '1';
            if (grblStatus) {
                grblStatus.textContent = '✓ Connected';
                grblStatus.style.color = '#00ff88';
            }
            if (headerGrbl) {
                headerGrbl.style.background = '#00ff88';
                headerGrbl.title = 'grblHAL: Connected';
            }
            if (connIndicator) connIndicator.classList.remove('disconnected');
            if (connStatus) connStatus.textContent = 'USB';
        } else {
            if (grblEl) grblEl.style.opacity = '0.4';
            if (grblStatus) {
                grblStatus.textContent = 'Not found';
                grblStatus.style.color = '#666';
            }
            if (headerGrbl) {
                headerGrbl.style.background = '#666';
                headerGrbl.title = 'grblHAL: Disconnected';
            }
        }
        
        // VFD status
        if (this.dualSerial?.vfdConnected) {
            if (vfdEl) vfdEl.style.opacity = '1';
            if (vfdStatus) {
                vfdStatus.textContent = '✓ Connected';
                vfdStatus.style.color = '#00ff88';
            }
            if (headerVfd) {
                headerVfd.style.background = this.dualSerial?.vfdStatus?.running ? '#ffaa00' : '#00ff88';
                headerVfd.title = `VFD: ${this.dualSerial?.vfdStatus?.running ? 'Running' : 'Connected'}`;
            }
        } else {
            if (vfdEl) vfdEl.style.opacity = '0.4';
            if (vfdStatus) {
                vfdStatus.textContent = 'Not found';
                vfdStatus.style.color = '#666';
            }
            if (headerVfd) {
                headerVfd.style.background = '#666';
                headerVfd.title = 'VFD: Disconnected';
            }
        }
        
        // Chatter status
        if (this.dualSerial?.chatterConnected) {
            if (chatterEl) chatterEl.style.opacity = '1';
            if (chatterStatus) {
                chatterStatus.textContent = '✓ Connected';
                chatterStatus.style.color = '#00ff88';
            }
            if (headerChatter) {
                headerChatter.style.background = '#00ff88';
                headerChatter.title = 'Chatter: Connected';
            }
        } else {
            if (chatterEl) chatterEl.style.opacity = '0.4';
            if (chatterStatus) {
                chatterStatus.textContent = 'Not found';
                chatterStatus.style.color = '#666';
            }
            if (headerChatter) {
                headerChatter.style.background = '#666';
                headerChatter.title = 'Chatter: Disconnected';
            }
        }
    }
    
    /**
     * Setup grbl compatibility wrapper from DualSerial
     */
    _setupGrblFromDualSerial() {
        // Create a grbl-like interface that uses dualSerial
        this.grbl = {
            send: (cmd) => this.dualSerial?.sendGrbl(cmd),
            home: () => this.dualSerial?.sendGrbl('$H'),
            unlock: () => this.dualSerial?.sendGrbl('$X'),
            reset: () => this.dualSerial?.sendGrbl('\x18'),
            hold: () => this.dualSerial?.sendGrbl('!'),
            resume: () => this.dualSerial?.sendGrbl('~'),
            emergencyStop: () => {
                this.dualSerial?.sendGrbl('\x18');
                this.dualSerial?.spindleStop();
            },
            setZero: (axis) => this.dualSerial?.sendGrbl(`G10 L20 P0 ${axis}0`),
            spindleOn: (rpm, dir) => {
                if (this.dualSerial?.vfdConnected) {
                    if (dir === 'ccw' || dir === 'CCW') {
                        this.dualSerial.spindleReverse(rpm);
                    } else {
                        this.dualSerial.spindleForward(rpm);
                    }
                } else {
                    this.dualSerial?.sendGrbl(dir === 'ccw' ? `M4 S${rpm}` : `M3 S${rpm}`);
                }
            },
            spindleOff: () => {
                if (this.dualSerial?.vfdConnected) {
                    this.dualSerial.spindleStop();
                }
                this.dualSerial?.sendGrbl('M5');
            },
            coolantFlood: (on) => this.dualSerial?.sendGrbl(on ? 'M8' : 'M9'),
            coolantMist: (on) => this.dualSerial?.sendGrbl(on ? 'M7' : 'M9'),
        };
        
        // Forward grblHAL status to existing UI
        this.dualSerial.onGrblStatus = (status) => {
            this._updateMachineStatus(status);
        };
        
        // Forward alarm events
        this.dualSerial.onGrblAlarm = (alarm) => {
            this.onGrblAlarm(alarm);
        };
        
        // Setup line callback for settings parser
        this.dualSerial.onGrblLine = (line) => {
            if (this.grblSettings?.parseLine) {
                this.grblSettings.parseLine(line);
            }
        };
    }
    
    /**
     * Update homing status UI
     */
    _updateHomingUI(inProgress, homedAxes) {
        const homingStatus = document.getElementById('smart-homed-status');
        const homeBtn = document.getElementById('home-btn');
        
        if (inProgress) {
            // Show homing in progress
            if (homingStatus) {
                homingStatus.textContent = '⏳ Homing...';
                homingStatus.style.color = '#ffa500';
            }
            if (homeBtn) {
                homeBtn.disabled = true;
                homeBtn.style.opacity = '0.5';
            }
        } else if (homedAxes) {
            // Show homed status
            if (homingStatus) {
                const x = homedAxes.x ? '✓' : '✗';
                const y = homedAxes.y ? '✓' : '✗';
                const z = homedAxes.z ? '✓' : '✗';
                homingStatus.textContent = `X:${x} Y:${y} Z:${z}`;
                homingStatus.style.color = (homedAxes.x && homedAxes.y && homedAxes.z) ? '#00ff88' : '#ff6b6b';
            }
            if (homeBtn) {
                homeBtn.disabled = false;
                homeBtn.style.opacity = '1';
            }
        }
    }
    
    /**
     * Update firmware info display in diagnostics
     */
    _updateFirmwareDisplay(info) {
        if (!info) return;
        
        const fwEl = document.getElementById('diag-firmware');
        const boardEl = document.getElementById('diag-board');
        const optEl = document.getElementById('diag-options');
        
        if (fwEl && info.version) {
            fwEl.textContent = info.version;
        }
        
        if (boardEl) {
            const boardText = [info.name, info.board].filter(Boolean).join(' / ');
            boardEl.textContent = boardText || '--';
        }
        
        if (optEl && info.options) {
            // Show a summary, full options on hover
            optEl.textContent = info.optionFlags || info.options.split(',')[0] || '--';
            optEl.title = `Options: ${info.options}\nBuffer: ${info.blockBufferSize || 'N/A'}\nRX: ${info.rxBufferSize || 'N/A'}`;
        }
        
        // Log to console
        this.log(`Firmware: ${info.name || 'grbl'} ${info.version}`, 'info');
    }
    
    /**
     * Update TMC2209 driver display in diagnostics
     */
    _updateTmcDisplay(status) {
        if (!status) return;
        
        ['x', 'y', 'z'].forEach(axis => {
            const driver = status[axis];
            if (!driver) return;
            
            // Update StallGuard value
            const sgEl = document.getElementById(`diag-sg-${axis}`);
            if (sgEl) {
                const sgVal = driver.sg || driver.stallguard || 0;
                sgEl.textContent = `SG: ${sgVal}`;
            }
            
            // Update temperature status
            const tempEl = document.getElementById(`diag-temp-${axis}`);
            if (tempEl) {
                if (driver.ot) {
                    tempEl.textContent = '🔥 OT!';
                    tempEl.className = 'tmc-temp error';
                } else if (driver.otpw || driver.temp === 'otpw') {
                    tempEl.textContent = '⚠️ OTPW';
                    tempEl.className = 'tmc-temp warning';
                } else {
                    tempEl.textContent = '🌡️ ok';
                    tempEl.className = 'tmc-temp';
                }
            }
            
            // Update load bar (based on StallGuard, lower = more load)
            const barEl = document.getElementById(`tmc-bar-${axis}`);
            if (barEl) {
                const sgVal = driver.sg || driver.stallguard || 500;
                const loadPct = Math.max(0, Math.min(100, 100 - (sgVal / 10)));
                barEl.style.width = `${loadPct}%`;
            }
        });
    }
    
    /**
     * Show TMC2209 tuning dialog
     */
    showTmcTuning() {
        const modal = document.createElement('div');
        modal.className = 'modal-overlay';
        modal.innerHTML = `
            <div class="modal tmc-tuning-modal">
                <div class="modal-header">
                    <h2>⚙️ TMC2209 Driver Tuning</h2>
                    <button class="modal-close btn-close" onclick="this.closest('.modal-overlay').remove()">✕</button>
                </div>
                <div class="modal-body">
                    <p class="modal-desc">Adjust TMC2209 stepper driver settings. Changes take effect immediately.</p>
                    
                    <div class="tmc-tuning-section">
                        <h3>Motor Current (RMS mA)</h3>
                        <div class="tmc-tuning-grid">
                            <div class="tmc-tuning-axis">
                                <label>X Axis</label>
                                <input type="number" id="tmc-current-x" value="800" min="100" max="2000" step="50">
                                <span class="unit">mA</span>
                            </div>
                            <div class="tmc-tuning-axis">
                                <label>Y Axis</label>
                                <input type="number" id="tmc-current-y" value="800" min="100" max="2000" step="50">
                                <span class="unit">mA</span>
                            </div>
                            <div class="tmc-tuning-axis">
                                <label>Z Axis</label>
                                <input type="number" id="tmc-current-z" value="800" min="100" max="2000" step="50">
                                <span class="unit">mA</span>
                            </div>
                        </div>
                    </div>
                    
                    <div class="tmc-tuning-section">
                        <h3>StallGuard Threshold</h3>
                        <p class="hint">Higher = less sensitive. Range: 0-255. Default: 50</p>
                        <div class="tmc-tuning-grid">
                            <div class="tmc-tuning-axis">
                                <label>X Axis</label>
                                <input type="number" id="tmc-sg-x" value="50" min="0" max="255">
                            </div>
                            <div class="tmc-tuning-axis">
                                <label>Y Axis</label>
                                <input type="number" id="tmc-sg-y" value="50" min="0" max="255">
                            </div>
                            <div class="tmc-tuning-axis">
                                <label>Z Axis</label>
                                <input type="number" id="tmc-sg-z" value="50" min="0" max="255">
                            </div>
                        </div>
                    </div>
                    
                    <div class="tmc-tuning-section">
                        <h3>Microstepping</h3>
                        <div class="tmc-tuning-grid">
                            <div class="tmc-tuning-axis">
                                <label>All Axes</label>
                                <select id="tmc-microsteps">
                                    <option value="16">16 (default)</option>
                                    <option value="32">32</option>
                                    <option value="64">64</option>
                                    <option value="128">128</option>
                                    <option value="256">256 (smoothest)</option>
                                </select>
                            </div>
                        </div>
                    </div>
                    
                    <div class="tmc-info-section">
                        <h3>Current Status</h3>
                        <div id="tmc-live-status" class="tmc-live-status">
                            Loading driver status...
                        </div>
                    </div>
                </div>
                <div class="modal-footer">
                    <button class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove()">Cancel</button>
                    <button class="btn btn-primary" onclick="app.applyTmcSettings()">Apply Settings</button>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        
        // Load current values
        this._loadTmcSettings();
    }
    
    /**
     * Load current TMC settings from grblHAL
     */
    async _loadTmcSettings() {
        // Query relevant settings
        // TMC settings in grblHAL:
        // $140, $141, $142 = X, Y, Z current
        // $338, $339, $340 = X, Y, Z StallGuard threshold
        // etc. (depends on grblHAL build)
        
        const statusEl = document.getElementById('tmc-live-status');
        if (statusEl && this.dualSerial?.tmcStatus) {
            const status = this.dualSerial.tmcStatus;
            statusEl.innerHTML = `
                <div class="tmc-status-row">
                    <span>X:</span> SG=${status.x?.sg || '--'}, Temp=${status.x?.temp || 'ok'}, µsteps=${status.x?.microsteps || '?'}
                </div>
                <div class="tmc-status-row">
                    <span>Y:</span> SG=${status.y?.sg || '--'}, Temp=${status.y?.temp || 'ok'}, µsteps=${status.y?.microsteps || '?'}
                </div>
                <div class="tmc-status-row">
                    <span>Z:</span> SG=${status.z?.sg || '--'}, Temp=${status.z?.temp || 'ok'}, µsteps=${status.z?.microsteps || '?'}
                </div>
            `;
        }
    }
    
    /**
     * Apply TMC settings to grblHAL
     */
    applyTmcSettings() {
        const currentX = document.getElementById('tmc-current-x')?.value;
        const currentY = document.getElementById('tmc-current-y')?.value;
        const currentZ = document.getElementById('tmc-current-z')?.value;
        const sgX = document.getElementById('tmc-sg-x')?.value;
        const sgY = document.getElementById('tmc-sg-y')?.value;
        const sgZ = document.getElementById('tmc-sg-z')?.value;
        
        // Send settings to grblHAL (settings numbers depend on build)
        // These are common TMC settings:
        if (currentX) this.dualSerial?.sendGrbl(`$140=${currentX}`);
        if (currentY) this.dualSerial?.sendGrbl(`$141=${currentY}`);
        if (currentZ) this.dualSerial?.sendGrbl(`$142=${currentZ}`);
        
        if (sgX) this.dualSerial?.sendGrbl(`$338=${sgX}`);
        if (sgY) this.dualSerial?.sendGrbl(`$339=${sgY}`);
        if (sgZ) this.dualSerial?.sendGrbl(`$340=${sgZ}`);
        
        this.showNotification('TMC settings applied', 'success');
        
        // Close modal after brief delay
        setTimeout(() => {
            document.querySelector('.tmc-tuning-modal')?.closest('.modal-overlay')?.remove();
        }, 500);
    }
    
    /**
     * Update UI from dual serial status
     */
    _updateMachineStatus(status) {
        // Convert DualSerial status format to app format
        const pins = status.pins || {};
        const state = {
            status: status.state || 'Unknown',
            mpos: status.pos || { x: 0, y: 0, z: 0 },
            wpos: status.pos || { x: 0, y: 0, z: 0 }, // TODO: calculate from WCO
            feedRate: status.feedRate || 0,
            spindleSpeed: status.spindleRPM || 0,
            feedOverride: status.feedOverride || 100,
            limits: {
                x: pins.x || false,
                y: pins.y || false,
                z: pins.z || false
            },
            probe: pins.probe || false,
            door: pins.door || false,
            coolant: status.accessories || {}
        };
        
        // Use work position if available
        if (status.wpos) {
            state.wpos = status.wpos;
        }
        
        // Update WCS indicator
        if (status.wcs) {
            const wcsEl = document.getElementById('wcs-indicator');
            if (wcsEl) {
                wcsEl.textContent = status.wcs;
            }
        }
        
        // Forward StallGuard data to chatter detection
        if (status.sg && this.chatter) {
            this.chatter.updateStallGuard(status.sg);
        }
        
        // Update diagnostics panel with StallGuard data
        if (status.sg) {
            this.updateDiagnosticsStallGuard(status.sg);
        }
        
        // Update diagnostics overrides
        if (status.overrides) {
            this.updateDiagnosticsOverrides(status.overrides);
        }
        
        // Update diagnostics connection health
        if (status.connection) {
            this.updateDiagnosticsConnection(status.connection);
        }
        
        // Update limit indicator UI
        this._updateLimitIndicators(pins);
        
        // Call the existing onGrblStatus handler
        this.onGrblStatus(state);
    }
    
    /**
     * Update limit switch indicator UI
     */
    _updateLimitIndicators(pins) {
        if (!pins) return;
        
        // Update limit LED indicators if they exist
        const xLimit = document.getElementById('limit-x');
        const yLimit = document.getElementById('limit-y');
        const zLimit = document.getElementById('limit-z');
        const probeIndicator = document.getElementById('probe-indicator');
        
        if (xLimit) xLimit.classList.toggle('active', pins.x);
        if (yLimit) yLimit.classList.toggle('active', pins.y);
        if (zLimit) zLimit.classList.toggle('active', pins.z);
        if (probeIndicator) probeIndicator.classList.toggle('active', pins.probe);
        
        // Update diagnostics panel limit indicators
        const diagLimX = document.getElementById('diag-lim-x');
        const diagLimY = document.getElementById('diag-lim-y');
        const diagLimZ = document.getElementById('diag-lim-z');
        const diagProbe = document.getElementById('diag-probe');
        
        if (diagLimX) {
            diagLimX.classList.toggle('active', pins.x);
            diagLimX.classList.toggle('off', !pins.x);
        }
        if (diagLimY) {
            diagLimY.classList.toggle('active', pins.y);
            diagLimY.classList.toggle('off', !pins.y);
        }
        if (diagLimZ) {
            diagLimZ.classList.toggle('active', pins.z);
            diagLimZ.classList.toggle('off', !pins.z);
        }
        if (diagProbe) {
            diagProbe.classList.toggle('active', pins.probe);
            diagProbe.classList.toggle('off', !pins.probe);
        }
        
        // Show warning if limits are active unexpectedly
        if ((pins.x || pins.y || pins.z) && this.machineState !== 'Alarm') {
            const limitStatus = document.getElementById('limit-status');
            if (limitStatus) {
                const activeAxes = [];
                if (pins.x) activeAxes.push('X');
                if (pins.y) activeAxes.push('Y');
                if (pins.z) activeAxes.push('Z');
                limitStatus.textContent = `⚠️ ${activeAxes.join('+')} limit`;
                limitStatus.style.color = '#ff6b6b';
            }
        }
    }
    
    /**
     * Toggle diagnostics panel visibility
     */
    toggleDiagnostics() {
        const panel = document.getElementById('diagnostics-panel');
        const btn = document.getElementById('diag-toggle-btn');
        if (panel) {
            panel.classList.toggle('collapsed');
            if (btn) {
                btn.textContent = panel.classList.contains('collapsed') ? '▼' : '▲';
            }
        }
    }
    
    /**
     * Update diagnostics panel with StallGuard data
     */
    updateDiagnosticsStallGuard(sg) {
        const sgX = document.getElementById('diag-sg-x');
        const sgY = document.getElementById('diag-sg-y');
        const sgZ = document.getElementById('diag-sg-z');
        
        const setSgClass = (el, val) => {
            if (!el) return;
            el.textContent = val;
            el.classList.remove('sg-low', 'sg-medium', 'sg-high');
            if (val < 50) el.classList.add('sg-low');
            else if (val < 150) el.classList.add('sg-medium');
            else el.classList.add('sg-high');
        };
        
        if (sg) {
            if (sg.x !== undefined) setSgClass(sgX, sg.x);
            if (sg.y !== undefined) setSgClass(sgY, sg.y);
            if (sg.z !== undefined) setSgClass(sgZ, sg.z);
        }
    }
    
    /**
     * Update diagnostics panel with overrides data
     */
    updateDiagnosticsOverrides(overrides) {
        if (!overrides) return;
        
        const feedEl = document.getElementById('diag-ov-feed');
        const rapidEl = document.getElementById('diag-ov-rapid');
        const spindleEl = document.getElementById('diag-ov-spindle');
        
        if (feedEl && overrides.feed !== undefined) feedEl.textContent = overrides.feed + '%';
        if (rapidEl && overrides.rapid !== undefined) rapidEl.textContent = overrides.rapid + '%';
        if (spindleEl && overrides.spindle !== undefined) spindleEl.textContent = overrides.spindle + '%';
    }
    
    /**
     * Update diagnostics panel with VFD data
     */
    updateDiagnosticsVfd(vfdData) {
        if (!vfdData) return;
        
        const stateEl = document.getElementById('diag-vfd-state');
        const rpmEl = document.getElementById('diag-vfd-rpm');
        const voltageEl = document.getElementById('diag-vfd-voltage');
        const faultEl = document.getElementById('diag-vfd-fault');
        
        if (stateEl) {
            stateEl.textContent = vfdData.state || '--';
        }
        if (rpmEl) {
            rpmEl.textContent = vfdData.rpm || '0';
        }
        if (voltageEl && vfdData.busVoltage !== undefined) {
            voltageEl.textContent = vfdData.busVoltage + 'V';
        }
        if (faultEl) {
            const fault = vfdData.fault || vfdData.faultCode;
            if (fault && fault !== 0 && fault !== '0') {
                faultEl.textContent = this._getVfdFaultDescription(fault);
                faultEl.classList.remove('fault-ok');
                faultEl.classList.add('fault-error');
            } else {
                faultEl.textContent = 'None';
                faultEl.classList.remove('fault-error');
                faultEl.classList.add('fault-ok');
            }
        }
    }
    
    /**
     * Get human-readable VFD fault description
     */
    _getVfdFaultDescription(faultCode) {
        const faultCodes = {
            0: 'None',
            1: 'Overcurrent',
            2: 'Overvoltage',
            3: 'Undervoltage',
            4: 'Motor Overtemp',
            5: 'VFD Overtemp',
            6: 'Overload',
            7: 'Communication Error',
            8: 'Motor Stall',
            9: 'Ground Fault',
            10: 'Phase Loss',
            11: 'Input Phase Error',
            12: 'Output Phase Error',
            13: 'Parameter Error',
            14: 'External Fault',
            15: 'EEPROM Error',
            16: 'Brake Resistor',
            17: 'Encoder Fault',
            18: 'PID Feedback Loss',
            // Huanyang specific
            'OC1': 'Overcurrent During Accel',
            'OC2': 'Overcurrent During Decel',
            'OC3': 'Overcurrent at Const Speed',
            'OV1': 'Overvoltage During Accel',
            'OV2': 'Overvoltage During Decel',
            'OV3': 'Overvoltage at Const Speed',
            'LU': 'Bus Undervoltage',
            'OH': 'Inverter Overheating',
            'OL': 'Overload'
        };
        return faultCodes[faultCode] || `Fault ${faultCode}`;
    }
    
    /**
     * Update diagnostics panel with connection health data
     */
    updateDiagnosticsConnection(conn) {
        if (!conn) return;
        
        const latencyEl = document.getElementById('diag-latency');
        const rxRateEl = document.getElementById('diag-rx-rate');
        
        if (latencyEl) {
            latencyEl.textContent = conn.latency ? `${conn.latency}ms` : '--';
            // Color based on latency quality
            latencyEl.classList.remove('sg-low', 'sg-medium', 'sg-high');
            if (conn.latency > 100) latencyEl.classList.add('sg-low');
            else if (conn.latency > 30) latencyEl.classList.add('sg-medium');
            else latencyEl.classList.add('sg-high');
        }
        
        if (rxRateEl) {
            rxRateEl.textContent = conn.rxRate ? `${conn.rxRate}/s` : '--';
        }
    }
    updateChatterUI(data) {
        // State indicator
        const stateEl = document.getElementById('chatter-state');
        if (stateEl) {
            const state = data.state || (data.chatter ? 'chatter' : (data.warning ? 'warning' : 'ok'));
            let displayText = state.toUpperCase();
            
            // Show calibration progress
            if (data.isCalibrating && data.calibration < 100) {
                displayText = `CAL ${data.calibration}%`;
            } else if (data.isRecovering) {
                displayText = 'RECOVER';
            }
            
            stateEl.textContent = displayText;
            stateEl.className = 'chatter-state ' + (data.isCalibrating ? 'calibrating' : state);
        }
        
        // Score bar
        const barEl = document.getElementById('chatter-bar');
        const scoreEl = document.getElementById('chatter-score');
        const score = Math.min(100, Math.round((data.combined || 0) * 100));
        
        if (barEl) {
            barEl.style.width = score + '%';
            barEl.className = 'chatter-bar' + (score > 70 ? ' danger' : score > 40 ? ' warning' : '');
        }
        if (scoreEl) {
            // Show confidence-weighted score
            const conf = data.confidence || 50;
            scoreEl.textContent = `${score}%`;
            scoreEl.title = `Confidence: ${Math.round(conf)}% | Learned: ${data.learnedEvents || 0} events`;
        }
        
        // Frequency
        const freqEl = document.getElementById('chatter-freq');
        if (freqEl && data.freq) {
            freqEl.textContent = data.freq >= 1000 ? (data.freq / 1000).toFixed(1) + 'kHz' : Math.round(data.freq) + 'Hz';
        }
        
        // Vibration
        const vibEl = document.getElementById('chatter-vib');
        if (vibEl && data.accel !== undefined) {
            vibEl.textContent = data.accel.toFixed(3) + 'g';
        }
        
        // Show suggested feed if chatter detected
        if (data.suggestedFeed && data.suggestedFeed < 100 && data.chatter) {
            const barContainer = document.querySelector('.chatter-bar-container');
            if (barContainer) {
                barContainer.title = `AI suggests: ${Math.round(data.suggestedFeed)}% feed`;
            }
        }
    }
    
    updateChatterConnectionUI(connected) {
        const dotEl = document.getElementById('chatter-status-dot');
        if (dotEl) {
            dotEl.className = 'chatter-dot ' + (connected ? 'connected' : 'disconnected');
            dotEl.title = connected ? 'Connected - Self-learning active' : 'Not connected';
        }
        
        const btnEl = document.getElementById('chatter-connect-btn');
        if (btnEl) {
            btnEl.textContent = connected ? '✓ Learning' : '🔌 Connect ESP32';
            btnEl.disabled = connected;
        }
    }

    // ================================================================
    // Smart Machine System Setup
    // ================================================================
    
    setupSmartMachine() {
        if (typeof SmartMachine === 'undefined') {
            console.warn('SmartMachine not loaded');
            return;
        }
        
        // Initialize Smart Machine
        this.smartMachine = new SmartMachine({
            serial: this.dualSerial,
            onStatus: (status) => this.handleSmartMachineStatus(status),
            onCalibrationProgress: (progress) => this.handleCalibrationProgress(progress),
            onAlert: (alert) => this.handleSmartMachineAlert(alert)
        });
        
        // Initialize Auto-Tuner
        if (typeof AutoTuner !== 'undefined') {
            this.autoTuner = new AutoTuner(this.smartMachine);
        }
        
        // Initialize Sensorless System
        if (typeof SensorlessSystem !== 'undefined') {
            this.sensorlessSystem = new SensorlessSystem(this.smartMachine);
            
            this.sensorlessSystem.onHomingProgress = (data) => {
                this.log(`Homing ${data.axis?.toUpperCase() || ''}: ${data.message}`, 'info');
            };
            
            this.sensorlessSystem.onHomingComplete = (result) => {
                if (result.success) {
                    this.notify('🏠 Smart homing complete!', 'success');
                    this.updateSmartMachineUI();
                } else {
                    this.notify(`Homing failed: ${result.error}`, 'error');
                }
            };
            
            this.sensorlessSystem.onCrashDetected = (crash) => {
                this.notify(`⚠️ CRASH on ${crash.axis.toUpperCase()}! Machine stopped.`, 'error', 10000);
                this.log(`Crash detected: SG=${crash.sgValue}, severity=${crash.severity}`, 'error');
            };
            
            this.sensorlessSystem.onPositionLost = (data) => {
                this.notify(`Position may be lost on ${data.axis.toUpperCase()}. Re-home recommended.`, 'warning', 5000);
            };
        }
        
        // Create Adaptive Feed Controller
        if (this.autoTuner) {
            this.adaptiveFeed = this.autoTuner.createAdaptiveFeedController();
        }
        
        // Update UI with saved profile
        this.updateSmartMachineUI();
        
        // Connect StallGuard data from grblHAL to Smart Machine
        this.setupStallGuardMonitoring();
        
        console.log('✓ Smart Machine System initialized');
    }
    
    setupStallGuardMonitoring() {
        // Hook into DualSerial status updates to extract StallGuard data (USB mode)
        if (this.dualSerial && this.smartMachine) {
            const originalOnStatus = this.dualSerial.onGrblStatus;
            this.dualSerial.onGrblStatus = (status) => {
                // Call original handler
                if (originalOnStatus) originalOnStatus.call(this.dualSerial, status);
                
                // Extract StallGuard values if present (grblHAL extended status)
                // Format: <...|SG:x,y,z|...>
                if (status.sg) {
                    this._handleStallGuardData(status.sg);
                }
            };
        }
        
        // Also hook into grbl event emitter (WebSocket mode)
        if (this.grbl && this.smartMachine) {
            this.grbl.on('status', (status) => {
                if (status.sg) {
                    this._handleStallGuardData(status.sg);
                }
            });
        }
    }
    
    _handleStallGuardData(sg) {
        if (!this.smartMachine) return;
        
        // Push to Smart Machine for analysis
        if (sg.x !== undefined) this.smartMachine.pushStallGuard('x', sg.x);
        if (sg.y !== undefined) this.smartMachine.pushStallGuard('y', sg.y);
        if (sg.z !== undefined) this.smartMachine.pushStallGuard('z', sg.z);
        
        // Update load bars UI
        this.updateLoadBars(sg);
        
        // Feed to crash detection
        if (this.sensorlessSystem) {
            this.sensorlessSystem.feedSGData(sg);
        }
    }
    
    updateLoadBars(sg) {
        for (const axis of ['x', 'y', 'z']) {
            const bar = document.getElementById(`load-bar-${axis}`);
            if (!bar || sg[axis] === undefined) continue;
            
            const noLoadSG = this.smartMachine?.profile?.stallGuard?.[axis]?.noLoadSG || 250;
            const load = Math.max(0, Math.min(100, 100 - (sg[axis] / noLoadSG * 100)));
            
            bar.style.width = load + '%';
            bar.className = 'load-fill' + (load > 70 ? ' high' : load > 40 ? ' medium' : '');
        }
    }
    
    updateSmartMachineUI() {
        if (!this.smartMachine) return;
        
        const profile = this.smartMachine.profile;
        
        // Profile name
        const nameEl = document.getElementById('smart-profile-name');
        if (nameEl) {
            nameEl.textContent = profile.calibrated ? profile.name : 'Uncalibrated';
        }
        
        // Status badge
        const statusEl = document.getElementById('smart-machine-status');
        if (statusEl) {
            if (profile.calibrated) {
                statusEl.textContent = '✓ Ready';
                statusEl.className = 'status-badge calibrated';
            } else {
                statusEl.textContent = '⚠ Setup';
                statusEl.className = 'status-badge uncalibrated';
            }
        }
        
        // Homed status
        this.updateHomedStatus();
    }
    
    updateHomedStatus() {
        const el = document.getElementById('smart-homed-status');
        if (!el || !this.sensorlessSystem) return;
        
        const homed = this.sensorlessSystem.state.isHomed;
        el.innerHTML = `X:${homed.x ? '✓' : '✗'} Y:${homed.y ? '✓' : '✗'} Z:${homed.z ? '✓' : '✗'}`;
    }
    
    handleSmartMachineStatus(status) {
        this.log(`Smart Machine: ${status.message}`, 'info');
    }
    
    handleCalibrationProgress(progress) {
        // Update calibration wizard UI
        const progressBar = document.getElementById('cal-progress-bar');
        const progressText = document.getElementById('cal-progress-text');
        const phaseTitle = document.getElementById('cal-phase-title');
        const phaseDesc = document.getElementById('cal-phase-desc');
        const currentAxis = document.getElementById('cal-current-axis');
        const realtimeData = document.getElementById('cal-realtime-data');
        
        if (progressBar) progressBar.style.width = progress.progress + '%';
        if (progressText) progressText.textContent = Math.round(progress.progress) + '%';
        if (phaseTitle) phaseTitle.textContent = this.getPhaseTitle(progress.phase);
        if (phaseDesc) phaseDesc.textContent = progress.message;
        if (currentAxis) currentAxis.textContent = progress.axis?.toUpperCase() || '-';
        if (realtimeData) realtimeData.style.display = 'block';
        
        // Highlight current step
        document.querySelectorAll('.cal-step').forEach(step => {
            const stepNum = parseInt(step.dataset.step);
            const phaseNum = this.getPhaseNum(progress.phase);
            step.classList.toggle('active', stepNum === phaseNum);
            step.classList.toggle('complete', stepNum < phaseNum);
        });
    }
    
    getPhaseTitle(phase) {
        const titles = {
            'starting': 'Starting Calibration...',
            'stallguard': 'Calibrating StallGuard',
            'envelope': 'Measuring Work Envelope',
            'backlash': 'Measuring Backlash',
            'dynamics': 'Finding Optimal Dynamics',
            'complete': 'Calibration Complete!',
            'error': 'Calibration Error'
        };
        return titles[phase] || phase;
    }
    
    getPhaseNum(phase) {
        const nums = { 'stallguard': 1, 'envelope': 2, 'backlash': 3, 'dynamics': 4, 'complete': 5 };
        return nums[phase] || 0;
    }
    
    handleSmartMachineAlert(alert) {
        if (alert.type === 'crash') {
            this.notify(alert.message, 'error', 10000);
        } else if (alert.type === 'overheat') {
            this.notify(alert.message, 'error', 10000);
        } else if (alert.type === 'thermal') {
            this.notify(alert.message, 'warning', 5000);
        } else if (alert.type === 'overload') {
            // Don't spam - only show occasionally
            if (!this._lastOverloadAlert || Date.now() - this._lastOverloadAlert > 5000) {
                this.log(alert.message, 'warning');
                this._lastOverloadAlert = Date.now();
            }
        } else if (alert.type === 'uncalibrated') {
            this.notify('Machine not calibrated. Click ⚡ Calibrate to set up.', 'warning');
        }
    }
    
    // Smart Homing
    async smartHome() {
        if (!this.sensorlessSystem) {
            this.notify('Sensorless system not available', 'error');
            return;
        }
        
        try {
            this.notify('Starting smart sensorless homing...', 'info');
            await this.sensorlessSystem.homeAll();
        } catch (err) {
            this.notify(`Homing failed: ${err.message}`, 'error');
        }
    }
    
    // Calibration Wizard - Bambu-Style Smart Startup
    showCalibrationWizard() {
        // Use new Bambu-style calibration wizard if available
        if (typeof CalibrationWizard !== 'undefined') {
            // Create wizard instance with proper references
            window.calibrationWizard = new CalibrationWizard({
                serial: this.dualSerial,
                chatter: this.chatter,
                grbl: this,
                maxX: 350,   // Your machine travel
                maxY: 500,
                maxZ: 120,
                // 3 Z-rods configuration (adjust positions for your machine!)
                zRods: [
                    { name: 'Z1 (Left-Rear)', xPos: 50, yPos: 450 },
                    { name: 'Z2 (Right-Rear)', xPos: 300, yPos: 450 },
                    { name: 'Z3 (Front-Center)', xPos: 175, yPos: 50 }
                ],
                spindleMaxRPM: 24000,
                spindleMinRPM: 5000
            });
            window.calibrationWizard.showWizard();
            return;
        }
        
        // Fallback to old modal if new wizard not loaded
        document.getElementById('calibration-modal')?.classList.remove('hidden');
        
        // Reset UI
        const calResults = document.getElementById('cal-results');
        if (calResults) calResults.style.display = 'none';
        const calRealtime = document.getElementById('cal-realtime-data');
        if (calRealtime) calRealtime.style.display = 'none';
        const calWarnings = document.getElementById('cal-warnings');
        if (calWarnings) calWarnings.style.display = 'none';
        const progressBar = document.getElementById('cal-progress-bar');
        if (progressBar) progressBar.style.width = '0%';
        const progressText = document.getElementById('cal-progress-text');
        if (progressText) progressText.textContent = '0%';
        
        document.querySelectorAll('.cal-step').forEach(s => {
            s.classList.remove('active', 'complete');
        });
    }
    
    closeCalibrationWizard() {
        document.getElementById('calibration-modal')?.classList.add('hidden');
    }
    
    async startCalibration() {
        if (!this.smartMachine) {
            this.notify('Smart Machine not initialized', 'error');
            return;
        }
        
        // Update UI
        document.getElementById('cal-start-btn').style.display = 'none';
        document.getElementById('cal-quick-btn').style.display = 'none';
        document.getElementById('cal-stop-btn').style.display = '';
        document.getElementById('cal-phase-icon').textContent = '⚙️';
        
        try {
            const result = await this.smartMachine.runFullCalibration();
            this.showCalibrationResults(result);
        } catch (err) {
            document.getElementById('cal-phase-icon').textContent = '❌';
            document.getElementById('cal-phase-title').textContent = 'Calibration Failed';
            document.getElementById('cal-phase-desc').textContent = err.message;
            
            document.getElementById('cal-start-btn').style.display = '';
            document.getElementById('cal-quick-btn').style.display = '';
            document.getElementById('cal-stop-btn').style.display = 'none';
        }
    }
    
    async quickCalibration() {
        if (!this.smartMachine) return;
        
        document.getElementById('cal-start-btn').style.display = 'none';
        document.getElementById('cal-quick-btn').style.display = 'none';
        document.getElementById('cal-stop-btn').style.display = '';
        
        try {
            await this.smartMachine.calibrateStallGuard();
            this.notify('StallGuard calibration complete!', 'success');
            this.smartMachine.saveProfile();
            this.updateSmartMachineUI();
        } catch (err) {
            this.notify(`Quick calibration failed: ${err.message}`, 'error');
        }
        
        document.getElementById('cal-start-btn').style.display = '';
        document.getElementById('cal-quick-btn').style.display = '';
        document.getElementById('cal-stop-btn').style.display = 'none';
    }
    
    stopCalibration() {
        // Send emergency stop - with connection check
        if (this.connected && this.grbl) {
            this.grbl.send('!');
            this.grbl.send('\x18');
        } else {
            this.showNotification('Cannot stop - not connected!', 'error');
        }
        
        if (this.smartMachine) {
            this.smartMachine.state.isCalibrating = false;
        }
        
        document.getElementById('cal-start-btn').style.display = '';
        document.getElementById('cal-quick-btn').style.display = '';
        document.getElementById('cal-stop-btn').style.display = 'none';
    }
    
    showCalibrationResults(profile) {
        document.getElementById('cal-phase-icon').textContent = '✅';
        document.getElementById('cal-phase-title').textContent = 'Calibration Complete!';
        document.getElementById('cal-phase-desc').textContent = 'Your machine has been fully calibrated.';
        
        document.getElementById('cal-stop-btn').style.display = 'none';
        document.getElementById('cal-apply-btn').style.display = '';
        
        // Populate results
        const e = profile.envelope;
        const sg = profile.stallGuard;
        const m = profile.mechanics;
        const bl = profile.mechanics;
        
        document.getElementById('res-x-travel').textContent = `${e.x.max.toFixed(1)} mm`;
        document.getElementById('res-y-travel').textContent = `${e.y.max.toFixed(1)} mm`;
        document.getElementById('res-z-travel').textContent = `${e.z.max.toFixed(1)} mm`;
        
        document.getElementById('res-sg-x').textContent = sg.x.threshold;
        document.getElementById('res-sg-y').textContent = sg.y.threshold;
        document.getElementById('res-sg-z').textContent = sg.z.threshold;
        
        document.getElementById('res-speed-x').textContent = m.x.maxSpeed;
        document.getElementById('res-speed-y').textContent = m.y.maxSpeed;
        document.getElementById('res-speed-z').textContent = m.z.maxSpeed;
        
        document.getElementById('res-backlash-x').textContent = bl.x.backlash.toFixed(3);
        document.getElementById('res-backlash-y').textContent = bl.y.backlash.toFixed(3);
        document.getElementById('res-backlash-z').textContent = bl.z.backlash.toFixed(3);
        
        document.getElementById('cal-results').style.display = '';
    }
    
    applyCalibration() {
        if (!this.smartMachine) return;
        
        this.smartMachine.saveProfile();
        this.smartMachine.applyProfile();
        this.updateSmartMachineUI();
        this.closeCalibrationWizard();
        
        this.notify('Machine profile applied and saved!', 'success');
    }
    
    exportMachineProfile() {
        if (!this.smartMachine) return;
        
        const json = this.smartMachine.exportProfile();
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.href = url;
        a.download = `machine-profile-${new Date().toISOString().slice(0,10)}.json`;
        a.click();
        
        URL.revokeObjectURL(url);
        this.notify('Profile exported!', 'success');
    }
    
    importMachineProfile() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.onchange = (e) => {
            const file = e.target.files[0];
            if (!file) return;
            
            const reader = new FileReader();
            reader.onload = (ev) => {
                if (this.smartMachine.importProfile(ev.target.result)) {
                    this.updateSmartMachineUI();
                    this.notify('Profile imported!', 'success');
                } else {
                    this.notify('Invalid profile file', 'error');
                }
            };
            reader.readAsText(file);
        };
        input.click();
    }
    
    // Toggle adaptive feed control
    toggleAdaptiveFeed(enable) {
        if (!this.adaptiveFeed) return;
        
        if (enable) {
            this.adaptiveFeed.start();
            this.notify('Adaptive feed control enabled', 'info');
        } else {
            this.adaptiveFeed.stop();
            this.notify('Adaptive feed control disabled', 'info');
        }
    }
    
    // Apply motor preset
    async applyMotorPreset(preset) {
        if (!this.dualSerial?.grblConnected) {
            this.notify('Not connected to grblHAL', 'error');
            return;
        }
        
        const settings = new GrblHALSettings(this.dualSerial);
        try {
            await settings.applyPreset(preset);
            this.notify(`Applied ${preset} preset`, 'success');
            
            // Reload settings display
            this.loadSmartSettingsUI();
        } catch (err) {
            this.notify(`Failed to apply preset: ${err.message}`, 'error');
        }
    }
    
    // Run motor diagnostics
    async runMotorDiagnostics() {
        if (!this.dualSerial?.grblConnected) {
            this.notify('Not connected to grblHAL', 'error');
            return;
        }
        
        const output = document.getElementById('smart-diag-output');
        if (output) {
            output.style.display = 'block';
            output.textContent = 'Running diagnostics...\n';
        }
        
        try {
            const settings = new GrblHALSettings(this.dualSerial);
            const report = await settings.runDiagnostics();
            
            let text = '=== Motor Diagnostics ===\n\n';
            for (const axis of ['x', 'y', 'z']) {
                const m = report.motors[axis];
                text += `${axis.toUpperCase()} Axis:\n`;
                text += `  Current: ${m.current}mA (hold: ${m.holdCurrent}mA)\n`;
                text += `  Microsteps: ${m.microsteps}\n`;
                text += `  StallGuard: ${m.stallGuard}\n\n`;
            }
            
            if (report.issues.length > 0) {
                text += '⚠️ Issues Found:\n';
                for (const issue of report.issues) {
                    text += `  • ${issue}\n`;
                }
            } else {
                text += '✓ No issues detected\n';
            }
            
            if (output) output.textContent = text;
        } catch (err) {
            if (output) output.textContent = `Error: ${err.message}`;
        }
    }
    
    // Read all grblHAL settings
    async readAllGrblSettings() {
        if (!this.dualSerial?.grblConnected) {
            this.notify('Not connected to grblHAL', 'error');
            return;
        }
        
        const output = document.getElementById('smart-diag-output');
        if (output) {
            output.style.display = 'block';
            output.textContent = 'Reading settings...\n';
        }
        
        try {
            const settings = new GrblHALSettings(this.dualSerial);
            const all = await settings.readAllSettings();
            
            let text = '=== grblHAL Settings ===\n\n';
            const sorted = Object.keys(all).map(Number).sort((a, b) => a - b);
            for (const num of sorted) {
                const info = settings.settingsMap[num];
                const name = info ? info.name : '';
                text += `$${num}=${all[num]}  ${name}\n`;
            }
            
            if (output) output.textContent = text;
            
            // Update smart settings UI with read values
            this.updateSmartSettingsFromGrbl(all);
        } catch (err) {
            if (output) output.textContent = `Error: ${err.message}`;
        }
    }
    
    // Update UI with values from grblHAL
    updateSmartSettingsFromGrbl(settings) {
        const setValue = (id, settingNum) => {
            const el = document.getElementById(id);
            if (el && settings[settingNum] !== undefined) {
                el.value = settings[settingNum];
            }
        };
        
        setValue('setting-x-current', 140);
        setValue('setting-y-current', 141);
        setValue('setting-z-current', 142);
        setValue('setting-hold-current', 143);
        setValue('setting-sg-x', 160);
        setValue('setting-sg-y', 161);
        setValue('setting-sg-z', 162);
    }
    
    // Sync smart settings to grblHAL
    async syncSmartSettings() {
        if (!this.dualSerial?.grblConnected) {
            this.notify('Not connected to grblHAL', 'error');
            return;
        }
        
        const getValue = (id) => {
            const el = document.getElementById(id);
            return el ? parseFloat(el.value) : null;
        };
        
        const commands = [
            { num: 140, val: getValue('setting-x-current') },
            { num: 141, val: getValue('setting-y-current') },
            { num: 142, val: getValue('setting-z-current') },
            { num: 143, val: getValue('setting-hold-current') },
            { num: 144, val: getValue('setting-hold-current') },
            { num: 145, val: getValue('setting-hold-current') },
            { num: 160, val: getValue('setting-sg-x') },
            { num: 161, val: getValue('setting-sg-y') },
            { num: 162, val: getValue('setting-sg-z') }
        ];
        
        try {
            for (const cmd of commands) {
                if (cmd.val !== null) {
                    await this.dualSerial.sendGrbl(`$${cmd.num}=${cmd.val}`);
                    await new Promise(r => setTimeout(r, 50));
                }
            }
            this.notify('Settings applied to grblHAL', 'success');
            
            // Update smart machine profile
            if (this.smartMachine) {
                this.smartMachine.profile.motors.x.current = getValue('setting-x-current');
                this.smartMachine.profile.motors.y.current = getValue('setting-y-current');
                this.smartMachine.profile.motors.z.current = getValue('setting-z-current');
                this.smartMachine.profile.stallGuard.x.threshold = getValue('setting-sg-x');
                this.smartMachine.profile.stallGuard.y.threshold = getValue('setting-sg-y');
                this.smartMachine.profile.stallGuard.z.threshold = getValue('setting-sg-z');
                this.smartMachine.saveProfile();
            }
        } catch (err) {
            this.notify(`Failed to apply settings: ${err.message}`, 'error');
        }
    }
    
    // Load smart settings UI from profile
    loadSmartSettingsUI() {
        if (!this.smartMachine) return;
        
        const p = this.smartMachine.profile;
        
        const setVal = (id, val) => {
            const el = document.getElementById(id);
            if (el) el.value = val;
        };
        
        setVal('setting-x-current', p.motors.x.current);
        setVal('setting-y-current', p.motors.y.current);
        setVal('setting-z-current', p.motors.z.current);
        setVal('setting-hold-current', p.motors.x.holdCurrent);
        setVal('setting-sg-x', p.stallGuard.x.threshold);
        setVal('setting-sg-y', p.stallGuard.y.threshold);
        setVal('setting-sg-z', p.stallGuard.z.threshold);
    }

    // ================================================================
    // SD Card Manager Setup
    // ================================================================
    
    setupSDCard() {
        if (typeof SDCardManager === 'undefined') {
            console.warn('SDCardManager not loaded');
            return;
        }
        
        this.sdCard = new SDCardManager({
            onFileSelect: (content, filename) => {
                // Load G-code into main editor for streaming
                this.gcodeLines = content.split('\n');
                this.gcodeFileName = filename;
                this.updateGCodeDisplay();
                this.parseAndVisualize(content);
                this.log(`Loaded from SD: ${filename}`, 'success');
            },
            onPreviewReady: (content, filename) => {
                // Show in visualizer
                this.parseAndVisualize(content);
            },
            onUploadComplete: () => {
                this.log('SD upload complete', 'success');
            }
        });
        
        // Connect to grbl when available
        if (this.grbl) {
            this.sdCard.setGrbl(this.grbl);
        }
    }

    // ================================================================
    // Conversational G-code Setup
    // ================================================================

    setupConversational() {
        if (typeof ConversationalGCode === 'undefined') {
            console.warn('ConversationalGCode not loaded');
            return;
        }

        this.conversational = new ConversationalGCode({
            notify: (msg, type) => this.showNotification(msg, type),
            onPreview: (gcode, filename) => {
                this.parseAndVisualize(gcode);
            },
            onLoad: (gcode, filename) => {
                this.gcodeLines = gcode.split('\n');
                this.gcodeFileName = filename;
                this.updateGCodeDisplay();
                this.parseAndVisualize(gcode);
                this.log(`Loaded conversational program: ${filename}`, 'success');
            },
            onUploadToSD: async (filename, gcode) => {
                if (!this.sdCard) throw new Error('SD card manager not available');
                await this.sdCard.uploadContent(filename, gcode);
            },
            onRunFromSD: async (filename) => {
                if (!this.sdCard) throw new Error('SD card manager not available');
                // Ensure file exists on SD first; run by name
                await this.sdCard.runFileByName(filename);
            }
        });
    }
    
    // ================================================================
    // Macro Manager Setup
    // ================================================================
    
    setupMacros() {
        if (typeof MacroManager === 'undefined') {
            console.warn('MacroManager not loaded');
            return;
        }
        
        this.macros = new MacroManager({
            grbl: this.grbl,
            onStatus: (msg) => this.log(msg, 'info')
        });
        
        this.renderMacroButtons();
    }
    
    renderMacroButtons() {
        const container = this.elements.macroContainer;
        if (!container || !this.macros) return;
        
        const allMacros = this.macros.getAll();
        let html = '';
        
        for (const [id, macro] of Object.entries(allMacros)) {
            html += `
                <button class="macro-btn" data-macro="${id}" title="${macro.name}">
                    <span class="macro-icon">${macro.icon || '▶'}</span>
                    <span class="macro-name">${macro.name}</span>
                </button>
            `;
        }
        
        container.innerHTML = html;
        
        // Bind click handlers
        container.querySelectorAll('.macro-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                this.macros.run(btn.dataset.macro);
            });
        });
    }
    
    // ================================================================
    // Event Binding
    // ================================================================
    
    bindEvents() {
        // Connect button (overlay)
        this.elements.connectBtn?.addEventListener('click', () => {
            if (this.connected) {
                this.disconnect();
            } else {
                this.connect('websocket');
            }
        });

        // USB (WebSerial) connect button - handled via inline onclick in HTML
        // (addEventListener was not binding correctly)
        
        // Demo button (overlay)
        this.elements.demoBtn?.addEventListener('click', () => {
            if (this.demoMode) {
                this.stopDemo();
            } else {
                this.startDemo();
            }
        });
        
        // Header WiFi connect button
        this.elements.headerConnectBtn?.addEventListener('click', () => {
            if (this.connected) {
                this.disconnect();
            } else {
                this.connect('websocket');
            }
        });
        
        // Header USB connect button
        this.elements.headerUsbBtn?.addEventListener('click', () => {
            if (this.connected) {
                this.disconnect();
            } else {
                this.connect('serial');
            }
        });
        
        // Connection indicator click to reconnect
        this.elements.connectionIndicator?.addEventListener('click', () => {
            if (this.demoMode) {
                this.stopDemo();
            } else if (this.connected) {
                this.disconnect();
            } else {
                // Try to reconnect using last connection type
                const lastType = localStorage.getItem('fluidcnc-connection-type') || 'websocket';
                this.connect(lastType);
            }
        });

        // Settings button
        this.elements.settingsBtn?.addEventListener('click', () => this.openSettings());
        
        // Keyboard shortcuts help button
        this.elements.keyboardHelpBtn?.addEventListener('click', () => this.showKeyboardShortcuts());
        
        // WCS Manager button
        document.getElementById('wcs-manager-btn')?.addEventListener('click', () => this.openWcsManager());
        
        // WCS quick-select buttons
        document.querySelectorAll('.btn-wcs[data-wcs]').forEach(btn => {
            btn.addEventListener('click', () => {
                const wcs = btn.dataset.wcs;
                this.selectWcs(wcs);
            });
        });
        
        // Jog mode toggle
        this.elements.jogModeStep?.addEventListener('click', () => this.setJogMode('step'));
        this.elements.jogModeCont?.addEventListener('click', () => this.setJogMode('continuous'));
        
        // Jog step buttons (use data-step attribute from HTML)
        document.querySelectorAll('[data-step]').forEach(btn => {
            btn.addEventListener('click', () => {
                this.setJogStep(parseFloat(btn.dataset.step));
            });
        });
        
        // Jog direction buttons (for touch/click)
        document.querySelectorAll('[data-jog]').forEach(btn => {
            btn.addEventListener('mousedown', () => this.startJog(btn.dataset.jog));
            btn.addEventListener('mouseup', () => this.stopJog());
            btn.addEventListener('mouseleave', () => this.stopJog());
            btn.addEventListener('touchstart', (e) => { e.preventDefault(); this.startJog(btn.dataset.jog); });
            btn.addEventListener('touchend', () => this.stopJog());
        });
        
        // Home button
        document.getElementById('home-btn')?.addEventListener('click', () => {
            this.grbl.home();
        });
        
        // Unlock button
        document.getElementById('unlock-btn')?.addEventListener('click', () => {
            this.grbl.unlock();
        });
        
        // Reset button  
        document.getElementById('reset-btn')?.addEventListener('click', () => {
            this.grbl.reset();
        });
        
        // E-Stop button - SAFETY: Use emergencyStop() which attempts all transports
        document.getElementById('estop-btn')?.addEventListener('click', () => {
            this.grbl.emergencyStop();
            this.showNotification('⚠️ EMERGENCY STOP SENT', 'error');
        });
        
        // Zero buttons (use data-axis attribute pattern)
        document.querySelectorAll('.zero-btn[data-axis]').forEach(btn => {
            btn.addEventListener('click', () => {
                this.grbl.setZero(btn.dataset.axis.toUpperCase());
            });
        });
        document.getElementById('zero-all-btn')?.addEventListener('click', () => this.grbl.setZero('XYZ'));
        
        // Coolant buttons - FIXED: passing boolean argument
        this.elements.coolantFlood?.addEventListener('click', () => {
            const isOn = this.elements.coolantFlood.classList.contains('active');
            this.grbl.coolantFlood(!isOn);
        });
        this.elements.coolantMist?.addEventListener('click', () => {
            const isOn = this.elements.coolantMist.classList.contains('active');
            this.grbl.coolantMist(!isOn);
        });
        document.getElementById('coolant-off')?.addEventListener('click', () => {
            this.grbl.coolantOff();
        });
        
        // Vacuum & Dust Shoe controls
        this.vacuumOn = false;
        this.dustShoeRetracted = false;
        
        this.elements.vacuumToggle?.addEventListener('click', () => {
            this.vacuumOn = !this.vacuumOn;
            this.grbl.send(this.vacuumOn ? 'M64 P0' : 'M65 P0');  // Port 0 = Vacuum
            this.elements.vacuumToggle?.classList.toggle('active', this.vacuumOn);
            const vacIcon = this.elements.vacuumToggle?.querySelector('.vacuum-icon');
            if (vacIcon) vacIcon.textContent = this.vacuumOn ? '🟢' : '🌀';
            this.log(`Vacuum ${this.vacuumOn ? 'ON' : 'OFF'}`, 'info');
        });
        
        this.elements.dustshoeToggle?.addEventListener('click', () => {
            this.dustShoeRetracted = !this.dustShoeRetracted;
            this.grbl.send(this.dustShoeRetracted ? 'M64 P1' : 'M65 P1');  // Port 1 = Dust shoe actuator
            this.elements.dustshoeToggle?.classList.toggle('active', this.dustShoeRetracted);
            const shoeIcon = this.elements.dustshoeToggle?.querySelector('.dustshoe-icon');
            const shoeLabel = this.elements.dustshoeToggle?.querySelector('.dustshoe-label');
            if (shoeIcon) shoeIcon.textContent = this.dustShoeRetracted ? '🔼' : '🔽';
            if (shoeLabel) shoeLabel.textContent = this.dustShoeRetracted ? 'Down' : 'Shoe';
            this.log(`Dust shoe ${this.dustShoeRetracted ? 'RETRACTED' : 'LOWERED'}`, 'info');
        });
        
        // Spindle controls
        document.getElementById('spindle-cw')?.addEventListener('click', () => {
            const rpm = document.getElementById('spindle-slider')?.value || 10000;
            this.grbl.spindleOn(parseInt(rpm), 'CW');
        });
        document.getElementById('spindle-ccw')?.addEventListener('click', () => {
            const rpm = document.getElementById('spindle-slider')?.value || 10000;
            this.grbl.spindleOn(parseInt(rpm), 'CCW');
        });
        document.getElementById('spindle-stop')?.addEventListener('click', () => {
            this.grbl.spindleOff();
        });
        document.getElementById('spindle-slider')?.addEventListener('input', (e) => {
            const rpm = parseInt(e.target.value);
            document.getElementById('spindle-rpm').textContent = rpm;
        });
        
        // RPM preset buttons
        document.querySelectorAll('.rpm-preset[data-rpm]').forEach(btn => {
            btn.addEventListener('click', () => {
                const rpm = parseInt(btn.dataset.rpm);
                const slider = document.getElementById('spindle-slider');
                if (slider) slider.value = rpm;
                document.getElementById('spindle-rpm').textContent = rpm;
            });
        });
        
        // Override sliders
        this.elements.feedOverride?.addEventListener('input', (e) => {
            this.grbl.setFeedOverride(parseInt(e.target.value));
        });
        this.elements.rapidOverride?.addEventListener('input', (e) => {
            this.grbl.setRapidOverride(parseInt(e.target.value));
        });
        this.elements.spindleOverride?.addEventListener('input', (e) => {
            this.grbl.setSpindleOverride(parseInt(e.target.value));
        });
        
        // Go-To preset buttons
        document.querySelectorAll('.btn-preset[data-goto]').forEach(btn => {
            btn.addEventListener('click', () => {
                this.gotoPreset(btn.dataset.goto);
            });
        });
        
        // Job control (main buttons + gcode tab duplicates)
        this.elements.btnStart?.addEventListener('click', () => this.startJob());
        this.elements.btnPause?.addEventListener('click', () => this.pauseJob());
        this.elements.btnStop?.addEventListener('click', () => this.stopJob());
        document.querySelector('.gcode-start')?.addEventListener('click', () => this.startJob());
        document.querySelector('.gcode-pause')?.addEventListener('click', () => this.pauseJob());
        document.querySelector('.gcode-stop')?.addEventListener('click', () => this.stopJob());
        
        // File upload
        document.getElementById('file-input')?.addEventListener('change', (e) => {
            this.loadGCodeFile(e.target.files[0]);
        });
        
        // Open button triggers file input
        document.getElementById('btn-open')?.addEventListener('click', () => {
            document.getElementById('file-input')?.click();
        });
        
        // Tab switching
        document.querySelectorAll('.tab-btn[data-tab]').forEach(btn => {
            btn.addEventListener('click', () => {
                this.switchTab(btn.dataset.tab);
            });
        });
        
        // Drag and drop for G-code
        const dropZone = document.getElementById('gcode-drop-zone') || this.elements.gcodeDisplay;
        if (dropZone) {
            dropZone.addEventListener('dragover', (e) => {
                e.preventDefault();
                dropZone.classList.add('drag-over');
            });
            dropZone.addEventListener('dragleave', () => {
                dropZone.classList.remove('drag-over');
            });
            dropZone.addEventListener('drop', (e) => {
                e.preventDefault();
                dropZone.classList.remove('drag-over');
                if (e.dataTransfer.files.length > 0) {
                    this.loadGCodeFile(e.dataTransfer.files[0]);
                }
            });
        }
        
        // Tool selection buttons (T1-T5)
        document.querySelectorAll('.btn-tool[data-tool]').forEach(btn => {
            btn.addEventListener('click', () => {
                this.selectTool(parseInt(btn.dataset.tool));
            });
        });
        
        // Probe/TouchOff button
        document.getElementById('touchoff-btn')?.addEventListener('click', () => {
            this.openProbeWizard();
        });
        
        // Surfacing button
        document.getElementById('btn-surfacing')?.addEventListener('click', () => {
            if (this.surfacing) {
                this.surfacing.open();
            }
        });
        
        // Tool Table button
        document.getElementById('btn-tool-table')?.addEventListener('click', () => {
            this.showToolTable();
        });
        
        // Measure Tool button
        document.getElementById('probe-tool-btn')?.addEventListener('click', () => {
            this.openProbeWizard('tool-length');
        });
        
        // ATC Manual Controls
        document.getElementById('atc-lid-open')?.addEventListener('click', () => {
            if (this.atc) {
                this.atc.openLid();
            } else {
                this.log('ATC not initialized', 'warning');
            }
        });
        
        document.getElementById('atc-lid-close')?.addEventListener('click', () => {
            if (this.atc) {
                this.atc.closeLid();
            } else {
                this.log('ATC not initialized', 'warning');
            }
        });
        
        document.getElementById('atc-loosen')?.addEventListener('click', () => {
            if (this.atc) {
                this.atc.manualLoosen();
            } else {
                this.log('ATC not initialized', 'warning');
            }
        });
        
        document.getElementById('atc-tighten')?.addEventListener('click', () => {
            if (this.atc) {
                this.atc.manualTighten();
            } else {
                this.log('ATC not initialized', 'warning');
            }
        });
        
        document.getElementById('atc-simulate')?.addEventListener('click', () => {
            this.showATCSimulation();
        });
        
        document.getElementById('atc-config')?.addEventListener('click', () => {
            this.showATCConfig();
        });
    }
    
    selectTool(toolNum) {
        if (!this.connected && !this.demoMode) {
            this.showNotification('Connect to CNC first', 'warning');
            return;
        }
        
        // Highlight the selected tool
        document.querySelectorAll('.btn-tool').forEach(btn => {
            btn.classList.toggle('active', parseInt(btn.dataset.tool) === toolNum);
        });
        
        // Update current tool display
        const currentToolEl = document.getElementById('current-tool');
        if (currentToolEl) {
            currentToolEl.textContent = `T${toolNum}`;
        }
        
        // If ATC is available, do a tool change
        if (this.atc && this.connected) {
            this.changeTool(toolNum);
        } else {
            // Just send T command for manual tool change
            this.grbl?.send(`T${toolNum}`);
            this.log(`Selected tool T${toolNum}`, 'info');
        }
    }
    
    showToolTable() {
        // Open tool table modal or tab
        this.switchTab('tools');
    }
    
    // ================================================================
    // ATC Simulation & Configuration
    // ================================================================
    
    showATCSimulation() {
        const currentTool = this.atc?.currentTool || 0;
        
        // Prompt for target tool
        const targetTool = prompt(`Simulate tool change from T${currentTool} to:`, '1');
        if (!targetTool) return;
        
        const toTool = parseInt(targetTool);
        if (isNaN(toTool) || toTool < 1 || toTool > 5) {
            this.showNotification('Invalid tool number (1-5)', 'error');
            return;
        }
        
        // Get simulation from ATC
        const simulation = this.atc.simulateToolChange(currentTool, toTool);
        
        // Show in modal
        const modal = document.createElement('div');
        modal.className = 'modal-overlay';
        modal.innerHTML = `
            <div class="modal atc-simulation-modal">
                <div class="modal-header">
                    <h2>🧪 ATC Simulation: T${currentTool} → T${toTool}</h2>
                    <button class="btn-close" onclick="this.closest('.modal-overlay').remove()">×</button>
                </div>
                <div class="modal-body">
                    <pre class="simulation-output">${simulation}</pre>
                </div>
                <div class="modal-footer">
                    <button class="btn btn-secondary" onclick="navigator.clipboard.writeText(this.closest('.modal').querySelector('.simulation-output').textContent); this.textContent='Copied!'">📋 Copy</button>
                    <button class="btn btn-primary" onclick="this.closest('.modal-overlay').remove()">Close</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        setTimeout(() => modal.classList.add('active'), 10);
        modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
    }
    
    showATCConfig() {
        if (!this.atc) {
            this.showNotification('ATC not initialized', 'error');
            return;
        }
        
        const cfg = this.atc.config;
        
        const modal = document.createElement('div');
        modal.className = 'modal-overlay';
        modal.innerHTML = `
            <div class="modal atc-config-modal">
                <div class="modal-header">
                    <h2>⚙️ RapidChange ATC Configuration</h2>
                    <button class="btn-close" onclick="this.closest('.modal-overlay').remove()">×</button>
                </div>
                <div class="modal-body">
                    <div class="config-section">
                        <h3>Tool Rack Position (Machine Coordinates)</h3>
                        <div class="config-grid">
                            <label>Tool 1 X:</label><input type="number" id="cfg-rackX" value="${cfg.rackX}" step="0.1">
                            <label>Rack Y:</label><input type="number" id="cfg-rackY" value="${cfg.rackY}" step="0.1">
                            <label>Tool Spacing:</label><input type="number" id="cfg-toolSpacing" value="${cfg.toolSpacing}" step="0.1">
                        </div>
                    </div>
                    
                    <div class="config-section">
                        <h3>Z Heights (Machine Coordinates)</h3>
                        <div class="config-grid">
                            <label>Safe Z:</label><input type="number" id="cfg-safeZ" value="${cfg.safeZ}" step="0.1">
                            <label>Approach Z:</label><input type="number" id="cfg-approachZ" value="${cfg.approachZ}" step="0.1">
                            <label>Engage Z (nut contact):</label><input type="number" id="cfg-engageZ" value="${cfg.engageZ}" step="0.1">
                            <label>Tighten Z (+7mm):</label><input type="number" id="cfg-tightenZ" value="${cfg.tightenZ}" step="0.1">
                        </div>
                    </div>
                    
                    <div class="config-section">
                        <h3>Spindle & Timing</h3>
                        <div class="config-grid">
                            <label>Tighten RPM:</label><input type="number" id="cfg-tightenRPM" value="${cfg.tightenRPM}" step="10">
                            <label>Tighten Time (ms):</label><input type="number" id="cfg-tightenTime" value="${cfg.tightenTime}" step="100">
                            <label>Loosen Time (ms):</label><input type="number" id="cfg-loosenTime" value="${cfg.loosenTime}" step="100">
                            <label>Spindle Brake (ms):</label><input type="number" id="cfg-spindleBrake" value="${cfg.spindleBrake}" step="100">
                        </div>
                    </div>
                    
                    <div class="config-section">
                        <h3>Servo Lid</h3>
                        <div class="config-grid">
                            <label>Use Lid:</label><input type="checkbox" id="cfg-useLid" ${cfg.useLid ? 'checked' : ''}>
                            <label>Servo Port:</label><input type="number" id="cfg-lidServoPort" value="${cfg.lidServoPort}" min="0" max="3">
                            <label>Open Angle:</label><input type="number" id="cfg-lidOpen" value="${cfg.lidOpen}" min="0" max="180">
                            <label>Closed Angle:</label><input type="number" id="cfg-lidClosed" value="${cfg.lidClosed}" min="0" max="180">
                        </div>
                    </div>
                    
                    <div class="config-section">
                        <h3>Teach Tool Positions</h3>
                        <p class="config-hint">Jog to Tool 1 position (center of fork, at engage Z), then click "Set T1".</p>
                        <div class="config-grid">
                            <button class="btn btn-sm" onclick="app.atc.teachToolPosition(1); this.textContent='✓ T1 Set'">Set T1 Position</button>
                            <span id="cfg-t1-pos">X: ${cfg.rackX.toFixed(1)} Y: ${cfg.rackY.toFixed(1)}</span>
                        </div>
                    </div>
                </div>
                <div class="modal-footer">
                    <button class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove()">Cancel</button>
                    <button class="btn btn-primary" onclick="app.saveATCConfig(); this.closest('.modal-overlay').remove()">💾 Save</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        setTimeout(() => modal.classList.add('active'), 10);
        modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
    }
    
    saveATCConfig() {
        if (!this.atc) return;
        
        const cfg = this.atc.config;
        
        cfg.rackX = parseFloat(document.getElementById('cfg-rackX')?.value) || cfg.rackX;
        cfg.rackY = parseFloat(document.getElementById('cfg-rackY')?.value) || cfg.rackY;
        cfg.toolSpacing = parseFloat(document.getElementById('cfg-toolSpacing')?.value) || cfg.toolSpacing;
        cfg.safeZ = parseFloat(document.getElementById('cfg-safeZ')?.value) || cfg.safeZ;
        cfg.approachZ = parseFloat(document.getElementById('cfg-approachZ')?.value) || cfg.approachZ;
        cfg.engageZ = parseFloat(document.getElementById('cfg-engageZ')?.value) || cfg.engageZ;
        cfg.tightenZ = parseFloat(document.getElementById('cfg-tightenZ')?.value) || cfg.tightenZ;
        cfg.tightenRPM = parseInt(document.getElementById('cfg-tightenRPM')?.value) || cfg.tightenRPM;
        cfg.tightenTime = parseInt(document.getElementById('cfg-tightenTime')?.value) || cfg.tightenTime;
        cfg.loosenTime = parseInt(document.getElementById('cfg-loosenTime')?.value) || cfg.loosenTime;
        cfg.spindleBrake = parseInt(document.getElementById('cfg-spindleBrake')?.value) || cfg.spindleBrake;
        cfg.useLid = document.getElementById('cfg-useLid')?.checked ?? cfg.useLid;
        cfg.lidServoPort = parseInt(document.getElementById('cfg-lidServoPort')?.value) ?? cfg.lidServoPort;
        cfg.lidOpen = parseInt(document.getElementById('cfg-lidOpen')?.value) || cfg.lidOpen;
        cfg.lidClosed = parseInt(document.getElementById('cfg-lidClosed')?.value) ?? cfg.lidClosed;
        
        this.atc.saveConfig();
        this.showNotification('ATC config saved!', 'success');
    }
    
    // ================================================================
    // Keyboard Jog Control (with continuous mode support)
    // ================================================================
    
    bindKeyboard() {
        const jogMap = {
            'ArrowRight': { axis: 'X', dir: 1 },
            'ArrowLeft': { axis: 'X', dir: -1 },
            'ArrowUp': { axis: 'Y', dir: 1 },
            'ArrowDown': { axis: 'Y', dir: -1 },
            'PageUp': { axis: 'Z', dir: 1 },
            'PageDown': { axis: 'Z', dir: -1 }
        };
        
        // Continuous jog repeat interval
        this.jogRepeatInterval = null;
        
        document.addEventListener('keydown', (e) => {
            // Ignore if typing in an input
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
            
            const jog = jogMap[e.key];
            if (jog && !this.jogKeys[e.key]) {
                e.preventDefault();
                this.jogKeys[e.key] = jog;
                this.executeJog();
                
                // For continuous mode, set up repeat interval
                if (this.jogMode === 'continuous' && !this.jogRepeatInterval) {
                    this.jogRepeatInterval = setInterval(() => this.executeJog(), 100);
                }
            }
            
            // CRITICAL SAFETY: Escape = EMERGENCY STOP
            // On a CNC machine, Escape should ALWAYS trigger E-STOP
            if (e.key === 'Escape') {
                e.preventDefault();
                this.emergencyStop();
                return;
            }
            
            // Ctrl+X = Soft Reset (traditional grbl reset)
            if (e.key === 'x' && e.ctrlKey) {
                e.preventDefault();
                this.softReset();
                return;
            }
            
            // Space to toggle pause
            if (e.key === ' ' && !e.target.matches('input, textarea')) {
                e.preventDefault();
                if (this.grbl.streamPaused) {
                    this.resumeJob();
                } else if (this.grbl.streaming) {
                    this.pauseJob();
                }
            }
            
            // Keyboard shortcuts
            if (e.key === '?' && !e.target.matches('input, textarea')) {
                this.showKeyboardShortcuts();
            }
            
            // Machine control shortcuts (ignore when typing)
            if (!e.target.matches('input, textarea')) {
                // Track shift key for 10x jog modifier
                this.shiftHeld = e.shiftKey;
                
                switch(e.key.toLowerCase()) {
                    case 'h':
                        if (!e.ctrlKey && !e.altKey) {
                            e.preventDefault();
                            this.grbl.home();
                            this.log('Homing all axes...', 'info');
                        }
                        break;
                    case 'u':
                        if (!e.ctrlKey && !e.altKey) {
                            e.preventDefault();
                            this.grbl.unlock();
                            this.log('Machine unlocked', 'info');
                        }
                        break;
                    case '0':
                        if (!e.ctrlKey && !e.altKey) {
                            e.preventDefault();
                            this.grbl.setZero('XYZ');
                            this.log('Zeroed all axes', 'info');
                        }
                        break;
                    case '!':
                        // Feed Hold (! key)
                        e.preventDefault();
                        this.feedHold();
                        break;
                    case '~':
                        // Cycle Start (~ key)
                        e.preventDefault();
                        this.cycleStart();
                        break;
                    case 'f':
                        if (!e.ctrlKey && !e.altKey) {
                            e.preventDefault();
                            this.visualizer3D?.fitView?.();
                            this.visualizer?.fitView?.();
                        }
                        break;
                    case 't':
                        if (!e.ctrlKey && !e.altKey) {
                            e.preventDefault();
                            this.visualizer3D?.setView?.('top');
                        }
                        break;
                    case 'i':
                        if (!e.ctrlKey && !e.altKey) {
                            e.preventDefault();
                            this.visualizer3D?.setView?.('iso');
                        }
                        break;
                    case 'v':
                        if (!e.ctrlKey && !e.altKey) {
                            e.preventDefault();
                            // Toggle vacuum
                            this.elements.vacuumToggle?.click();
                        }
                        break;
                    
                    // Spindle/VFD keyboard shortcuts
                    case 's':
                        if (e.shiftKey && !e.ctrlKey && !e.altKey) {
                            // Shift+S = Spindle STOP
                            e.preventDefault();
                            this.dualSerial?.spindleStop?.();
                            this.showNotification('🛑 Spindle STOP', 'warning');
                        }
                        break;
                    case 'r':
                        if (e.shiftKey && !e.ctrlKey && !e.altKey) {
                            // Shift+R = Spindle RUN (forward)
                            e.preventDefault();
                            const rpm = this.targetSpindleRPM || 12000;
                            this.dualSerial?.spindleForward?.(rpm);
                            this.showNotification(`▶️ Spindle FWD @ ${rpm} RPM`, 'info');
                        }
                        break;
                    case '+':
                    case '=':
                        if (e.shiftKey && !e.ctrlKey && !e.altKey) {
                            // Shift++ = Increase spindle 10%
                            e.preventDefault();
                            this.adjustSpindleOverride(10);
                        }
                        break;
                    case '-':
                    case '_':
                        if (e.shiftKey && !e.ctrlKey && !e.altKey) {
                            // Shift+- = Decrease spindle 10%
                            e.preventDefault();
                            this.adjustSpindleOverride(-10);
                        }
                        break;
                    case ']':
                        if (!e.ctrlKey && !e.altKey) {
                            // ] = Increase feed override 10%
                            e.preventDefault();
                            this.adjustFeedOverride(10);
                        }
                        break;
                    case '[':
                        if (!e.ctrlKey && !e.altKey) {
                            // [ = Decrease feed override 10%
                            e.preventDefault();
                            this.adjustFeedOverride(-10);
                        }
                        break;
                    case 'backspace':
                        if (!e.ctrlKey && !e.altKey) {
                            // Backspace = Reset all overrides to 100%
                            e.preventDefault();
                            this.resetOverrides();
                        }
                        break;
                }
                
                // Ctrl+O for file open
                if (e.key.toLowerCase() === 'o' && e.ctrlKey) {
                    e.preventDefault();
                    document.getElementById('gcodeFile')?.click();
                }
            }
        });
        
        document.addEventListener('keyup', (e) => {
            // Track shift key release
            if (e.key === 'Shift') {
                this.shiftHeld = false;
            }
            
            if (this.jogKeys[e.key]) {
                delete this.jogKeys[e.key];
                
                // Stop continuous jog when all keys released
                if (Object.keys(this.jogKeys).length === 0) {
                    if (this.jogRepeatInterval) {
                        clearInterval(this.jogRepeatInterval);
                        this.jogRepeatInterval = null;
                    }
                    this.grbl.jogCancel();
                }
            }
        });
    }
    
    executeJog() {
        // Cancel if no keys held
        if (Object.keys(this.jogKeys).length === 0) {
            return;
        }
        
        // SAFETY: Don't jog during alarm state
        const state = this.grbl?.state?.status;
        if (state === 'Alarm' || state === 'Door') {
            console.warn('[SAFETY] Cannot jog during Alarm/Door state');
            return;
        }
        
        // Combine all held directions
        let x = 0, y = 0, z = 0;
        for (const jog of Object.values(this.jogKeys)) {
            if (jog.axis === 'X') x += jog.dir;
            if (jog.axis === 'Y') y += jog.dir;
            if (jog.axis === 'Z') z += jog.dir;
        }
        
        // Calculate distance based on mode (Shift = 10x multiplier)
        let distance = this.jogMode === 'continuous' ? 10 : this.jogStep;
        if (this.shiftHeld) {
            distance *= 10;
        }
        
        // SAFETY: Limit maximum single jog distance to prevent runaway
        const MAX_JOG_DISTANCE = 100;  // mm - absolute safety limit per operation
        distance = Math.min(distance, MAX_JOG_DISTANCE);
        
        // Build jog command
        let cmd = '$J=G91';
        if (x !== 0) cmd += ` X${x * distance}`;
        if (y !== 0) cmd += ` Y${y * distance}`;
        if (z !== 0) cmd += ` Z${z * distance}`;
        
        // SAFETY: Validate and limit jog feed rate
        let feed = (z !== 0 && x === 0 && y === 0) ? this.jogFeed / 3 : this.jogFeed;
        if (!Number.isFinite(feed) || feed <= 0) feed = 1000;
        feed = Math.min(feed, 10000);  // Max 10000 mm/min safety limit
        cmd += ` F${feed}`;
        
        this.grbl.send(cmd);
    }
    
    startJog(direction) {
        // Validate direction format (e.g., "x+", "Y-", "z+")
        if (!direction || typeof direction !== 'string' || direction.length < 2) {
            console.warn('[JOG] Invalid direction:', direction);
            return;
        }
        
        // Safety: Don't jog if not connected or in alarm state
        if (!this.grbl?.connected) {
            this.log('Cannot jog - not connected', 'warning');
            return;
        }
        
        if (this.grbl?.state?.status === 'Alarm') {
            this.log('Cannot jog during alarm - unlock first ($X)', 'warning');
            return;
        }
        
        const axis = direction[0].toUpperCase();
        const dir = direction[1] === '+' ? 1 : -1;
        
        // Validate axis
        if (!['X', 'Y', 'Z', 'A', 'B', 'C'].includes(axis)) {
            console.warn('[JOG] Invalid axis:', axis);
            return;
        }
        
        const distance = this.jogMode === 'step' ? this.jogStep : 1000;
        const feed = axis === 'Z' ? this.jogFeed / 3 : this.jogFeed;
        
        // Validate distance and feed
        if (!Number.isFinite(distance) || distance <= 0 || distance > 1000) {
            console.warn('[JOG] Invalid distance:', distance);
            return;
        }
        if (!Number.isFinite(feed) || feed <= 0 || feed > 10000) {
            console.warn('[JOG] Invalid feed rate:', feed);
            return;
        }
        
        this.grbl.jog(axis, distance * dir, feed);
    }
    
    stopJog() {
        this.grbl.jogCancel();
    }
    
    gotoPreset(preset) {
        // Preset positions - these can be customized via settings
        const presets = {
            origin: { x: 0, y: 0, z: 0 },
            park: { x: 0, y: this.workArea?.y ?? 400, z: 0 },       // Safe parking position
            probe: { x: -30, y: 380, z: -5 },   // Touch probe location
            toolchange: { x: -10, y: 350, z: -5 } // ATC rack position
        };
        
        const pos = presets[preset];
        if (!pos) {
            this.log(`Unknown preset: ${preset}`, 'warning');
            return;
        }
        
        // Move to safe Z first, then XY, then final Z
        this.grbl.send('G53 G0 Z-5');  // Safe Z in machine coords
        this.grbl.send(`G53 G0 X${pos.x} Y${pos.y}`);  // XY position
        if (pos.z !== -5) {
            this.grbl.send(`G53 G0 Z${pos.z}`);  // Final Z if different
        }
        
        this.log(`Moving to ${preset} preset`, 'info');
    }
    
    setJogMode(mode) {
        this.jogMode = mode;
        this.elements.jogModeStep?.classList.toggle('active', mode === 'step');
        this.elements.jogModeCont?.classList.toggle('active', mode === 'continuous');
    }
    
    setJogStep(step) {
        // Validate step value to prevent unsafe jog distances
        const numStep = parseFloat(step);
        if (!Number.isFinite(numStep) || numStep <= 0 || numStep > 1000) {
            console.warn('Invalid jog step value:', step);
            return;
        }
        this.jogStep = numStep;
        document.querySelectorAll('[data-step]').forEach(btn => {
            btn.classList.toggle('active', parseFloat(btn.dataset.step) === numStep);
        });
    }
    
    setJogFeed(feed) {
        this.jogFeed = parseInt(feed);
        const display = document.getElementById('jog-feed-value');
        if (display) display.textContent = feed;
    }
    
    setSpindleSpeed(rpm) {
        const slider = document.getElementById('spindle-slider');
        const display = document.getElementById('spindle-rpm');
        if (slider) slider.value = rpm;
        if (display) display.textContent = rpm;
    }
    
    // ================================================================
    // VFD Spindle Control
    // ================================================================
    
    async connectVfd() {
        try {
            await this.dualSerial?.connectVfd();
            this.log('VFD Controller connected', 'success');
            this._updateVfdUI();
        } catch (err) {
            this.log('VFD connection failed: ' + err.message, 'error');
        }
    }
    
    async spindleForward() {
        const rpm = parseInt(document.getElementById('spindle-slider')?.value || 12000);
        if (this.dualSerial?.vfdConnected) {
            await this.dualSerial.spindleForward(rpm);
            this.log(`Spindle FWD @ ${rpm} RPM`, 'info');
        } else {
            // Fallback to grblHAL
            this.grbl?.spindleOn(rpm, 'cw');
        }
    }
    
    async spindleReverse() {
        const rpm = parseInt(document.getElementById('spindle-slider')?.value || 12000);
        if (this.dualSerial?.vfdConnected) {
            await this.dualSerial.spindleReverse(rpm);
            this.log(`Spindle REV @ ${rpm} RPM`, 'info');
        } else {
            // Fallback to grblHAL
            this.grbl?.spindleOn(rpm, 'ccw');
        }
    }
    
    async spindleStop() {
        if (this.dualSerial?.vfdConnected) {
            await this.dualSerial.spindleStop();
            this.log('Spindle STOP', 'info');
        } else {
            // Fallback to grblHAL
            this.grbl?.spindleOff();
        }
    }
    
    _updateVfdUI() {
        const badge = document.getElementById('vfd-status-badge');
        const info = document.getElementById('vfd-info');
        const btn = document.getElementById('vfd-connect-btn');
        
        if (this.dualSerial?.vfdConnected) {
            const vfd = this.dualSerial.vfdStatus;
            if (badge) {
                badge.textContent = vfd.running ? '🟢 VFD' : '🟡 VFD';
                badge.title = vfd.running ? `Running: ${vfd.actualRPM} RPM` : 'VFD Connected - Idle';
            }
            if (info) {
                if (vfd.running) {
                    info.textContent = `${vfd.actualRPM} RPM | ${vfd.outputAmps.toFixed(1)}A | ${vfd.temperature}°C`;
                } else {
                    info.textContent = `Ready | ${vfd.temperature}°C`;
                }
            }
            if (btn) btn.textContent = '✓ VFD Connected';
        } else {
            if (badge) {
                badge.textContent = '⚫ VFD';
                badge.title = 'VFD Disconnected';
            }
            if (info) info.textContent = '';
            if (btn) btn.textContent = '🔌 Connect VFD';
        }
    }

    // ================================================================
    // Coordinate Display Toggle
    // ================================================================
    
    showWorkCoords() {
        document.getElementById('wcs-btn')?.classList.add('active');
        document.getElementById('mcs-btn')?.classList.remove('active');
        // Show work position, hide machine position
        this.coordMode = 'work';
    }
    
    showMachineCoords() {
        document.getElementById('wcs-btn')?.classList.remove('active');
        document.getElementById('mcs-btn')?.classList.add('active');
        // Show machine position
        this.coordMode = 'machine';
    }
    
    // ================================================================
    // Vacuum/Dust Control
    // ================================================================
    
    toggleVacuum() {
        this.vacuumOn = !this.vacuumOn;
        if (this.vacuumOn) {
            this.grbl?.send('M64 P0'); // Turn on output 0
            document.getElementById('vacuum-toggle')?.classList.add('active');
            this.log('Vacuum ON', 'info');
        } else {
            this.grbl?.send('M65 P0'); // Turn off output 0
            document.getElementById('vacuum-toggle')?.classList.remove('active');
            this.log('Vacuum OFF', 'info');
        }
    }
    
    toggleDustShoe() {
        this.dustShoeUp = !this.dustShoeUp;
        if (this.dustShoeUp) {
            this.grbl?.send('M64 P1'); // Raise dust shoe
            document.getElementById('dustshoe-toggle')?.classList.add('active');
            this.log('Dust shoe UP', 'info');
        } else {
            this.grbl?.send('M65 P1'); // Lower dust shoe
            document.getElementById('dustshoe-toggle')?.classList.remove('active');
            this.log('Dust shoe DOWN', 'info');
        }
    }
    
    // ================================================================
    // Console Commands
    // ================================================================
    
    sendConsoleCommand() {
        const input = document.getElementById('console-input');
        if (!input) return;
        
        const cmd = input.value.trim();
        if (!cmd) return;
        
        this.log(`> ${cmd}`, 'command');
        this.grbl?.send(cmd);
        input.value = '';
    }
    
    // ================================================================
    // Override Controls
    // ================================================================
    
    setFeedOverride(value) {
        this.grbl?.setFeedOverride?.(parseInt(value));
    }
    
    setRapidOverride(value) {
        this.grbl?.setRapidOverride?.(parseInt(value));
    }
    
    setSpindleOverride(value) {
        this.grbl?.setSpindleOverride?.(parseInt(value));
    }
    
    adjustFeedOverride(delta) {
        const currentFeed = this.dualSerial?.feedOverride || 100;
        const newFeed = Math.max(10, Math.min(200, currentFeed + delta));
        this.grbl?.setFeedOverride?.(newFeed);
        this.showNotification(`Feed: ${newFeed}%`, 'info');
        
        // Update UI slider
        const slider = document.getElementById('feed-override-slider');
        if (slider) slider.value = newFeed;
        const display = document.getElementById('feed-override-val');
        if (display) display.textContent = newFeed + '%';
    }
    
    adjustSpindleOverride(delta) {
        const currentSpindle = this.dualSerial?.vfdStatus?.spindleOverride || 100;
        const newSpindle = Math.max(10, Math.min(200, currentSpindle + delta));
        this.grbl?.setSpindleOverride?.(newSpindle);
        this.showNotification(`Spindle: ${newSpindle}%`, 'info');
        
        // Update UI slider
        const slider = document.getElementById('spindle-override-slider');
        if (slider) slider.value = newSpindle;
        const display = document.getElementById('spindle-override-val');
        if (display) display.textContent = newSpindle + '%';
    }
    
    resetOverrides() {
        this.grbl?.setFeedOverride?.(100);
        this.grbl?.setRapidOverride?.(100);
        this.grbl?.setSpindleOverride?.(100);
        this.showNotification('Overrides reset to 100%', 'success');
        
        // Update UI
        ['feed', 'rapid', 'spindle'].forEach(type => {
            const slider = document.getElementById(`${type}-override-slider`);
            const display = document.getElementById(`${type}-override-val`);
            if (slider) slider.value = 100;
            if (display) display.textContent = '100%';
        });
    }
    
    // ================================================================
    // WCS Selection
    // ================================================================
    
    setWCS(wcs) {
        this.grbl?.setWCS?.(wcs);
        // Update UI
        document.querySelectorAll('.btn-wcs').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.wcs === wcs);
        });
        this.log(`Work coordinate system: ${wcs}`, 'info');
    }
    
    showWCSManager() {
        // Simple WCS manager - show current offsets
        this.showNotification('WCS Manager - coming soon!', 'info');
    }
    
    // ================================================================
    // Keyboard Shortcuts Help
    // ================================================================
    
    showKeyboardShortcuts() {
        const shortcuts = [
            ['Movement', ''],
            ['Arrow Keys', 'Jog X/Y'],
            ['PageUp/Down', 'Jog Z'],
            ['Shift + Arrow', 'Jog 10x faster'],
            ['', ''],
            ['Safety & Control', ''],
            ['Escape', '🛑 EMERGENCY STOP'],
            ['Ctrl+X', 'Soft Reset'],
            ['Space', 'Pause/Resume job'],
            ['!', 'Feed Hold'],
            ['~', 'Cycle Start/Resume'],
            ['', ''],
            ['Machine Control', ''],
            ['H', 'Home all axes'],
            ['U', 'Unlock'],
            ['0', 'Zero all axes'],
            ['V', 'Toggle vacuum'],
            ['', ''],
            ['Spindle/VFD', ''],
            ['Shift+R', 'Spindle RUN (forward)'],
            ['Shift+S', 'Spindle STOP'],
            ['Shift++', 'Spindle override +10%'],
            ['Shift+-', 'Spindle override -10%'],
            ['', ''],
            ['Feed Override', ''],
            [']', 'Feed override +10%'],
            ['[', 'Feed override -10%'],
            ['Backspace', 'Reset all overrides'],
            ['', ''],
            ['File/View', ''],
            ['Ctrl+O', 'Open G-code file'],
            ['Ctrl+S', 'Save G-code'],
            ['F', 'Fit view'],
            ['T', 'Top view'],
            ['I', 'Isometric view'],
            ['?', 'Show this help']
        ];
        
        const html = shortcuts.map(([key, desc]) => {
            if (!key && !desc) return '<div style="height:8px"></div>';
            if (!desc) return `<div style="color:#0af;font-weight:600;margin-top:8px;font-size:11px">${key}</div>`;
            return `<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid #333">
                <kbd style="background:#333;padding:2px 8px;border-radius:3px;font-family:monospace">${key}</kbd>
                <span>${desc}</span>
            </div>`;
        }).join('');
        
        const modal = document.createElement('div');
        modal.className = 'modal-overlay';
        modal.innerHTML = `
            <div class="modal" style="max-width:400px">
                <div class="modal-header">
                    <h2>⌨️ Keyboard Shortcuts</h2>
                    <button class="modal-close btn-close">✕</button>
                </div>
                <div class="modal-body" style="max-height:60vh;overflow-y:auto">
                    ${html}
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        
        const close = () => modal.remove();
        modal.querySelector('.modal-close')?.addEventListener('click', close);
        modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
    }

    // NOTE: switchTab is defined later in the file (Tab Navigation System section)
    // This handles both main nav tabs (.nav-tab/.tab-panel) and nested tabs (.tab-btn/.tab-content)
    
    // ================================================================
    // G-code Editor & Streaming
    // ================================================================
    
    setupGCodeEditor() {
        // Editor is handled in HTML/CSS
    }
    
    setupConsole() {
        if (this.elements.consoleInput) {
            this.elements.consoleInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    const cmd = this.elements.consoleInput.value.trim();
                    if (cmd) {
                        this.log(cmd, 'tx');
                        this.grbl.send(cmd);
                        this.elements.consoleInput.value = '';
                    }
                }
            });
        }
        
        // Add copy button to console
        const consoleOutput = document.getElementById('console-output');
        if (consoleOutput) {
            // Make console selectable
            consoleOutput.style.userSelect = 'text';
            
            // Add right-click context menu for copy
            consoleOutput.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                this.copyConsole();
            });
        }
    }
    
    copyConsole() {
        const consoleOutput = document.getElementById('console-output');
        if (!consoleOutput) return;
        
        const text = consoleOutput.textContent || consoleOutput.innerText;
        navigator.clipboard.writeText(text).then(() => {
            this.showNotification('Console copied to clipboard', 'success');
        }).catch(err => {
            // Fallback for older browsers
            const textarea = document.createElement('textarea');
            textarea.value = text;
            document.body.appendChild(textarea);
            textarea.select();
            document.execCommand('copy');
            document.body.removeChild(textarea);
            this.showNotification('Console copied to clipboard', 'success');
        });
    }
    
    clearConsole() {
        const consoleOutput = document.getElementById('console-output');
        if (consoleOutput) {
            consoleOutput.innerHTML = '';
        }
        this.log('Console cleared', 'info');
    }
    
    loadGCodeFile(file) {
        if (!file) return;
        
        this.gcodeFileName = file.name;
        
        const reader = new FileReader();
        reader.onload = (e) => {
            const content = e.target.result;
            this.gcodeLines = content.split('\n');
            
            // Update UI
            if (this.elements.gcodeFilename) {
                this.elements.gcodeFilename.textContent = file.name;
            }
            
            if (this.elements.gcodeDisplay) {
                // Show preview (first 100 lines)
                this.elements.gcodeDisplay.textContent = this.gcodeLines.slice(0, 100).join('\n');
                if (this.gcodeLines.length > 100) {
                    this.elements.gcodeDisplay.textContent += `\n... (${this.gcodeLines.length - 100} more lines)`;
                }
            }
            
            // Update visualizer
            if (this.visualizer) {
                this.visualizer.loadGCode(this.gcodeLines);
            }
            
            // Auto-configure chatter detection from G-code comments
            if (window.chatterDetection) {
                window.chatterDetection.onGCodeLoaded(content);
            }
            
            // Enable start button
            if (this.elements.btnStart) {
                this.elements.btnStart.disabled = false;
            }
            
            this.log(`Loaded ${this.gcodeLines.length} lines from ${file.name}`, 'success');
        };
        
        reader.readAsText(file);
    }
    
    saveGCode() {
        // Get content from editor or stored lines
        const editor = document.getElementById('gcode-editor');
        const content = editor?.value || this.gcodeLines.join('\n');
        
        if (!content.trim()) {
            this.showNotification('No G-code to save', 'warning');
            return;
        }
        
        const filename = this.gcodeFileName || 'untitled.nc';
        const blob = new Blob([content], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        this.log(`Saved ${filename}`, 'success');
        this.showNotification(`Saved ${filename}`, 'success');
    }
    
    startJob() {
        // Comprehensive pre-flight checks
        if (!this.connected && !this.demoMode) {
            this.showNotification('Not connected to machine', 'error');
            return;
        }
        
        if (this.gcodeLines.length === 0) {
            this.showNotification('No G-code loaded', 'warning');
            return;
        }
        
        // Check for alarm state
        const state = this.grbl?.state?.status || this.grbl?.lastStatus?.status;
        if (state === 'Alarm') {
            this.showNotification('Clear alarm before starting job (Home or Unlock)', 'error');
            return;
        }
        
        if (!this.grbl.isIdle()) {
            this.showNotification('Machine must be idle', 'warning');
            return;
        }
        
        this.log('Starting job...', 'info');
        
        // SAFETY: Start job recovery tracking
        if (this.recovery) {
            this.recovery.startTracking({
                fileName: this.gcodeFileName || 'unknown.nc',
                totalLines: this.gcodeLines.length,
                gcode: this.gcodeLines.join('\n'),
                tool: this.grbl?.state?.tool || 0
            });
        }
        
        // Start MachineEnhancements job tracking
        if (this.enhancements) {
            this.enhancements.startJob(this.gcodeFileName, null);
        }
        
        // Start v12 enhancements timer with G-code for time estimation
        if (this.enhancementsV12) {
            this.enhancementsV12.onJobStart(this.gcodeLines.join('\n'));
        }
        
        this.grbl.streamGCode(this.gcodeLines, {
            onProgress: (pct, current, total) => {
                this.onStreamProgress({ progress: pct, current, total });
            },
            onComplete: () => {
                this.log('Job complete!', 'success');
                this.showNotification('🎉 Job complete!', 'success');
                this.playSuccessSound();
                // Mark job complete for recovery and enhancements
                if (this.recovery) this.recovery.jobComplete();
                if (this.enhancements) this.enhancements.endJob(true);
                // v12 enhancements audio/notification
                if (this.enhancementsV12) this.enhancementsV12.onJobComplete(true);
            },
            onStop: () => {
                this.log('Job stopped', 'warning');
                // Mark job failed for enhancements
                if (this.enhancements) this.enhancements.endJob(false);
                if (this.enhancementsV12) this.enhancementsV12.onJobComplete(false);
            },
            onError: (err) => {
                this.log(`Stream error: ${err}`, 'error');
                this.showNotification(`Job error: ${err}`, 'error');
                // Mark job failed for enhancements
                if (this.enhancements) this.enhancements.endJob(false);
                if (this.enhancementsV12) this.enhancementsV12.onJobComplete(false);
            }
        });
        
        this.elements.btnStart.disabled = true;
        this.elements.btnPause.disabled = false;
        this.elements.btnStop.disabled = false;
    }
    
    pauseJob() {
        this.grbl.pauseStream();
        this.elements.btnPause.textContent = 'Resume';
        this.elements.btnPause.onclick = () => this.resumeJob();
        
        // Track pause time for accurate job statistics
        this.enhancements?.pauseJob?.();
    }
    
    resumeJob() {
        this.grbl.resumeStream();
        this.elements.btnPause.textContent = 'Pause';
        this.elements.btnPause.onclick = () => this.pauseJob();
        
        // Resume pause time tracking
        this.enhancements?.resumeJob?.();
    }
    
    stopJob() {
        this.grbl.stopStream();
        this.elements.btnStart.disabled = false;
        this.elements.btnPause.disabled = true;
        this.elements.btnStop.disabled = true;
        this.elements.btnPause.textContent = 'Pause';
    }
    
    // ================================================================
    // Tool Table
    // ================================================================
    
    setupToolTable() {
        this.renderToolTable();
    }
    
    renderToolTable() {
        const tbody = this.elements.toolTableBody;
        if (!tbody || !this.atc) return;
        
        let html = '';
        for (let i = 1; i <= this.atc.config.toolCount; i++) {
            const tool = this.atc.getTool(i);
            html += `
                <tr>
                    <td>${i}</td>
                    <td><input type="text" value="${tool.name}" data-tool="${i}" data-field="name" class="tool-input"></td>
                    <td><input type="number" value="${tool.diameter}" data-tool="${i}" data-field="diameter" class="tool-input" step="0.1"></td>
                    <td><input type="number" value="${tool.length}" data-tool="${i}" data-field="length" class="tool-input" step="0.1"></td>
                    <td><input type="number" value="${tool.offset}" data-tool="${i}" data-field="offset" class="tool-input" step="0.001"></td>
                    <td>
                        <button class="btn-sm" onclick="app.changeTool(${i})">Load</button>
                    </td>
                </tr>
            `;
        }
        tbody.innerHTML = html;
        
        // Bind input changes
        tbody.querySelectorAll('.tool-input').forEach(input => {
            input.addEventListener('change', () => {
                const toolNum = parseInt(input.dataset.tool);
                const field = input.dataset.field;
                const value = input.type === 'number' ? parseFloat(input.value) : input.value;
                
                const tool = this.atc.getTool(toolNum);
                tool[field] = value;
                this.atc.setTool(toolNum, tool);
            });
        });
    }
    
    // ================================================================
    // Settings
    // ================================================================
    
    loadSettings() {
        try {
            const saved = localStorage.getItem('fluidcnc_settings');
            if (saved) {
                const settings = JSON.parse(saved);
                this.jogStep = settings.jogStep || 1;
                this.jogFeed = settings.jogFeed || 3000;
                this.jogMode = settings.jogMode || 'step';

                const wa = settings.workArea;
                if (wa && typeof wa === 'object') {
                    const x = Number(wa.x);
                    const y = Number(wa.y);
                    const z = Number(wa.z);
                    if (Number.isFinite(x) && x > 0) this.workArea.x = x;
                    if (Number.isFinite(y) && y > 0) this.workArea.y = y;
                    if (Number.isFinite(z) && z > 0) this.workArea.z = z;
                }
                
                // Apply limits to grbl (for demo mode simulation)
                if (this.grbl) {
                    this.grbl.machineLimits = {
                        x: { min: 0, max: this.workArea.x },
                        y: { min: 0, max: this.workArea.y },
                        z: { min: -this.workArea.z, max: 0 }
                    };
                }
            }
            
            // Restore last used IP
            const lastIp = localStorage.getItem('fluidcnc-last-ip');
            if (lastIp && this.elements.ipInput) {
                this.elements.ipInput.value = lastIp;
            }
        } catch (e) {
            console.warn('Failed to load settings:', e);
        }
    }
    
    saveSettings() {
        try {
            localStorage.setItem('fluidcnc_settings', JSON.stringify({
                jogStep: this.jogStep,
                jogFeed: this.jogFeed,
                jogMode: this.jogMode,
                workArea: this.workArea
            }));
        } catch (e) {
            console.warn('Failed to save settings:', e);
        }
    }

    applyWorkAreaToModules() {
        if (this.visualizer && typeof this.visualizer.setWorkArea === 'function') {
            this.visualizer.setWorkArea(this.workArea);
        } else if (this.visualizer) {
            this.visualizer.workArea = { ...this.workArea };
            this.visualizer.render?.();
        }

        if (this.ai?.machineConfig) {
            this.ai.machineConfig.workArea = { ...this.workArea };
        }
    }

    openSettings() {
        // Now using tabbed interface instead of modal
        this.switchTab('settings');
        
        // Load current work area values
        const maxX = document.getElementById('setting-max-x');
        const maxY = document.getElementById('setting-max-y');
        const maxZ = document.getElementById('setting-max-z');
        if (maxX) maxX.value = this.workArea.x;
        if (maxY) maxY.value = this.workArea.y;
        if (maxZ) maxZ.value = this.workArea.z;
        
        // Request settings from grblHAL
        if (this.grbl && this.grbl.connected) {
            this.refreshGrblSettings();
        }
    }
    
    // ================================================================
    // Tab Navigation System - Replaces Modal Popups
    // ================================================================
    
    switchTab(tabName) {
        // Try main navigation tabs first (.nav-tab / .tab-panel)
        const navTabs = document.querySelectorAll('.nav-tab');
        const tabPanels = document.querySelectorAll('.tab-panel');
        const activeNavTab = document.querySelector(`.nav-tab[data-tab="${tabName}"]`);
        const activePanel = document.getElementById(`tab-${tabName}`);
        
        if (activeNavTab && activePanel) {
            // Main navigation tab system
            navTabs.forEach(tab => tab.classList.remove('active'));
            tabPanels.forEach(panel => panel.classList.remove('active'));
            activeNavTab.classList.add('active');
            activePanel.classList.add('active');
            this._onTabActivate(tabName);
            console.log(`[FluidCNC] Switched to tab: ${tabName}`);
            return;
        }
        
        // Fall back to nested tab system (.tab-btn / .tab-content)
        const tabBtns = document.querySelectorAll('.tab-btn');
        const tabContents = document.querySelectorAll('.tab-content');
        const activeBtn = document.querySelector(`.tab-btn[data-tab="${tabName}"]`);
        const activeContent = document.getElementById(`${tabName}-tab`);
        
        if (activeBtn || activeContent) {
            tabBtns.forEach(btn => btn.classList.toggle('active', btn.dataset.tab === tabName));
            tabContents.forEach(content => content.classList.toggle('active', content.id === `${tabName}-tab`));
            
            // Special handling for visualizer tab
            if (tabName === 'visualizer' && this.visualizer) {
                setTimeout(() => {
                    if (typeof this.visualizer.resize === 'function') {
                        this.visualizer.resize();
                    } else if (typeof this.visualizer.render === 'function') {
                        this.visualizer.render();
                    }
                }, 50);
            }
            console.log(`[FluidCNC] Switched to nested tab: ${tabName}`);
        }
    }
    
    _onTabActivate(tabName) {
        switch(tabName) {
            case 'probe':
                // Initialize probe wizard if needed
                if (this.probeWizard && typeof this.probeWizard.render === 'function') {
                    this.probeWizard.render();
                }
                break;
            case 'surfacing':
                // Initialize surfacing wizard if needed
                if (this.surfacing && typeof this.surfacing.render === 'function') {
                    this.surfacing.render();
                }
                break;
            case 'tools':
                // Refresh tool table
                this.renderToolTable?.();
                break;
            case 'settings':
                // Refresh grbl settings
                if (this.grbl && this.grbl.connected) {
                    this.refreshGrblSettings();
                }
                break;
            case 'calibration':
                // Nothing special needed
                break;
            case 'wcs':
                // Refresh WCS values
                this.refreshWcsValues?.();
                break;
            case 'visualizer':
            case 'gcode':
                // Handle visualizer sub-tabs in main control view
                // For now these are within control tab
                break;
        }
    }
    
    switchSettingsTab(tabName) {
        const tabs = document.querySelectorAll('#tab-settings .settings-tab');
        const panels = document.querySelectorAll('#tab-settings .settings-panel');
        
        // Remove active from all
        tabs.forEach(t => t.classList.remove('active'));
        panels.forEach(p => p.classList.remove('active'));
        
        // Add active to clicked
        const activeTab = document.querySelector(`#tab-settings .settings-tab[data-settings-tab="${tabName}"]`);
        if (activeTab) activeTab.classList.add('active');
        
        const panelId = tabName + '-settings';
        const panel = document.getElementById(panelId);
        if (panel) panel.classList.add('active');
        
        // Update safety stats if switching to safety tab
        if (tabName === 'safety' && window.gcodeSafetyFixer) {
            this.updateSafetyStats();
        }
    }
    
    applySafetySettings() {
        const fixer = window.gcodeSafetyFixer;
        if (!fixer) {
            this.showNotification('Safety Fixer not loaded', 'error');
            return;
        }
        
        // Read checkbox states
        const checks = {
            spindle: document.getElementById('safety-spindle-check')?.checked ?? true,
            rapid: document.getElementById('safety-rapid-check')?.checked ?? true,
            plunge: document.getElementById('safety-plunge-check')?.checked ?? true,
            softLimit: document.getElementById('safety-softlimit-check')?.checked ?? true,
            arc: document.getElementById('safety-arc-check')?.checked ?? true,
            toolChange: document.getElementById('safety-toolchange-check')?.checked ?? true
        };
        
        // Read parameters
        const params = {
            maxPlungeRate: parseFloat(document.getElementById('safety-max-plunge')?.value) || 500,
            defaultFeed: parseFloat(document.getElementById('safety-default-feed')?.value) || 1000,
            defaultSpindle: parseFloat(document.getElementById('safety-default-spindle')?.value) || 12000,
            retractZ: parseFloat(document.getElementById('safety-retract-z')?.value) || 10,
            materialThreshold: parseFloat(document.getElementById('safety-material-z')?.value) || -1
        };
        
        // Read mode
        const mode = document.getElementById('safety-mode')?.value || 'fix';
        
        // Apply to fixer
        fixer.config = {
            ...fixer.config,
            checks,
            ...params,
            mode
        };
        
        // Also update machine limits if known
        if (this.workArea) {
            fixer.config.machineLimits = {
                x: { min: 0, max: this.workArea.x },
                y: { min: 0, max: this.workArea.y },
                z: { min: -this.workArea.z, max: 0 }
            };
        }
        
        this.showNotification('🛡️ Safety settings applied', 'success');
        this.log('Safety fixer settings updated', 'info');
    }
    
    updateSafetyStats() {
        const fixer = window.gcodeSafetyFixer;
        if (!fixer || !fixer.stats) return;
        
        const checkedEl = document.getElementById('stat-checked');
        const fixedEl = document.getElementById('stat-fixed');
        const blockedEl = document.getElementById('stat-blocked');
        
        if (checkedEl) checkedEl.textContent = fixer.stats.checked || 0;
        if (fixedEl) fixedEl.textContent = fixer.stats.fixed || 0;
        if (blockedEl) blockedEl.textContent = fixer.stats.blocked || 0;
        
        // Also update learned patterns
        this.refreshBreakagePatterns();
    }
    
    // ========================================================================
    // TOOL BREAKAGE LEARNING UI
    // ========================================================================
    
    reportToolBreakage() {
        const fixer = window.gcodeSafetyFixer;
        if (!fixer) {
            this.showNotification('Safety Fixer not loaded', 'error');
            return;
        }
        
        // Get values from form
        const toolType = document.getElementById('breakage-tool-type')?.value || 'endmill';
        const toolDia = parseFloat(document.getElementById('breakage-tool-dia')?.value) || 6;
        const material = document.getElementById('breakage-material')?.value || 'unknown';
        const cause = document.getElementById('breakage-cause')?.value || 'unknown';
        const notes = document.getElementById('breakage-notes')?.value || '';
        
        // Get current machine state if connected
        const machinePos = this.grbl?.status?.mpos || { x: 0, y: 0, z: 0 };
        
        // Record the breakage
        const incident = fixer.reportBreakage({
            toolType: toolType,
            toolDiameter: toolDia,
            materialType: material,
            cause: cause,
            notes: notes,
            x: machinePos.x,
            y: machinePos.y,
            z: machinePos.z,
            feedRate: this.grbl?.status?.feedRate || fixer.state.feedRate,
            spindleRPM: this.grbl?.status?.spindleRPM || fixer.state.spindleRPM,
        });
        
        // Also update tool info for future learning
        fixer.setCurrentTool({
            type: toolType,
            diameter: toolDia,
            number: this.grbl?.status?.tool || 0,
        });
        fixer.setCurrentMaterial(material);
        
        // Show confirmation
        this.showNotification(
            `🔴 Tool breakage recorded!\n` +
            `Will prevent: F>${incident.feedRate * 0.7 | 0} with this tool/material`,
            'warning', 5000
        );
        
        // Clear notes field
        const notesEl = document.getElementById('breakage-notes');
        if (notesEl) notesEl.value = '';
        
        // Refresh the patterns display
        this.refreshBreakagePatterns();
        
        this.log(`Tool breakage recorded: ${toolType} ${toolDia}mm in ${material}`, 'warning');
    }
    
    refreshBreakagePatterns() {
        const fixer = window.gcodeSafetyFixer;
        if (!fixer) return;
        
        const container = document.getElementById('learned-patterns-list');
        if (!container) return;
        
        const stats = fixer.getBreakageStats();
        
        if (stats.totalIncidents === 0) {
            container.innerHTML = '<em>No breakages recorded yet. The system will learn from any tool breakages you report.</em>';
            return;
        }
        
        let html = `<div style="margin-bottom: 10px;"><strong>Total Incidents:</strong> ${stats.totalIncidents} | <strong>Patterns Learned:</strong> ${stats.patternsLearned}</div>`;
        
        html += '<div style="display: grid; gap: 8px;">';
        for (const pattern of stats.patternSummary) {
            const [toolType, diameter, material] = pattern.pattern.split('_');
            html += `
                <div style="padding: 8px; background: rgba(100,100,100,0.2); border-radius: 4px; border-left: 3px solid #ff6b6b;">
                    <div style="font-weight: bold;">🔧 ${toolType} ${diameter !== 'unknown' ? diameter + 'mm' : ''} in ${material}</div>
                    <div style="font-size: 11px; margin-top: 4px;">
                        <span style="color: #ff6b6b;">⚠️ ${pattern.incidents} break(s)</span> | 
                        Max Safe Feed: <span style="color: #4ecdc4;">${pattern.maxSafeFeed}</span> | 
                        Max DOC: <span style="color: #4ecdc4;">${pattern.maxSafeDoc}</span>
                    </div>
                </div>
            `;
        }
        html += '</div>';
        
        if (stats.lastBreakage) {
            const lastTime = new Date(stats.lastBreakage.timestamp).toLocaleString();
            html += `<div style="margin-top: 10px; font-size: 11px; opacity: 0.7;">Last breakage: ${lastTime}</div>`;
        }
        
        container.innerHTML = html;
    }
    
    clearBreakageData() {
        if (!confirm('Clear all learned tool breakage data? This cannot be undone!')) {
            return;
        }
        
        const fixer = window.gcodeSafetyFixer;
        if (fixer) {
            fixer.clearBreakageData();
            this.refreshBreakagePatterns();
            this.showNotification('Breakage learning data cleared', 'info');
        }
    }
    
    showCalibrationWizard() {
        this.switchTab('calibration');
    }
    
    closeCalibrationWizard() {
        // Switch back to control tab
        this.switchTab('control');
    }
    
    showToolTable() {
        this.switchTab('tools');
    }
    
    showKeyboardShortcuts() {
        this.switchTab('shortcuts');
    }
    
    saveSettingsFromModal() {
        const maxX = parseFloat(document.getElementById('setting-max-x')?.value) || 400;
        const maxY = parseFloat(document.getElementById('setting-max-y')?.value) || 400;
        const maxZ = parseFloat(document.getElementById('setting-max-z')?.value) || 200;
        
        this.workArea = { x: maxX, y: maxY, z: maxZ };
        
        // Apply limits to grbl (for demo mode simulation)
        if (this.grbl) {
            this.grbl.machineLimits = {
                x: { min: 0, max: maxX },
                y: { min: 0, max: maxY },
                z: { min: -maxZ, max: 0 }
            };
        }
        
        this.saveSettings();
        this.applyWorkAreaToModules();
        this.showNotification('Settings saved!', 'success');
        document.getElementById('settings-modal')?.classList.add('hidden');
    }
    
    resetSettingsToDefaults() {
        // Reset work area
        document.getElementById('setting-max-x').value = 400;
        document.getElementById('setting-max-y').value = 400;
        document.getElementById('setting-max-z').value = 200;
        
        // Reset safe heights
        document.getElementById('setting-safe-z').value = 50;
        document.getElementById('setting-rapid-feed').value = 5000;
        
        this.showNotification('Settings reset to defaults', 'info');
    }
    
    // ================================================================
    // Alarm/Homing Modal
    // ================================================================
    
    showAlarmModal(title = 'Machine Locked', message = 'Machine requires homing or unlock before operation.', details = '') {
        // Only show if not already showing (prevent spam)
        if (this._alarmModalShown) return;
        
        const modal = document.getElementById('alarm-modal');
        if (!modal) return;
        
        this._alarmModalShown = true;
        
        const titleEl = document.getElementById('alarm-title');
        const msgEl = document.getElementById('alarm-message');
        const detailsEl = document.getElementById('alarm-details');
        
        if (titleEl) titleEl.textContent = title;
        if (msgEl) msgEl.textContent = message;
        if (detailsEl) detailsEl.textContent = details;
        
        modal.classList.remove('hidden');
    }
    
    closeAlarmModal() {
        const modal = document.getElementById('alarm-modal');
        if (modal) modal.classList.add('hidden');
        this._alarmModalShown = false;  // Allow showing again after user dismisses
        this._alarmClearSince = 0;
    }
    
    // Called when user clicks the alarm badge
    showAlarmDetails() {
        const alarm = this._lastAlarm;
        let title = 'Machine Alarm';
        let message = 'Machine is in alarm state. Homing or unlock required.';
        let details = '';
        
        if (alarm && alarm.info) {
            title = `ALARM ${alarm.code}`;
            message = alarm.info.msg || 'Unknown alarm condition';
            details = alarm.info.recovery ? `Recovery: ${alarm.info.recovery}` : '';
        }
        
        this.showAlarmModal(title, message, details);
    }
    
    // Check if we should show alarm modal based on grbl state
    checkAlarmState(state, alarmCode = null) {
        if (state === 'Alarm') {
            let title = 'Machine Alarm';
            let message = 'Machine is in alarm state. Homing or unlock required.';
            let details = '';
            
            // Common alarm codes
            const alarmMessages = {
                1: 'Hard limit triggered - check limit switches',
                2: 'Soft limit exceeded - position outside machine bounds',
                3: 'Reset while in motion - abort detected',
                4: 'Probe fail - probe not triggered during probing cycle',
                5: 'Probe fail - probe already triggered before cycle',
                6: 'Homing fail - reset during active cycle',
                7: 'Homing fail - door opened during cycle',
                8: 'Homing fail - pull off failed after homing',
                9: 'Homing fail - could not find limit switch',
                10: 'Homing fail - could not find second switch for dual axis',
                18: 'Homing required - machine must be homed before operation'
            };
            
            if (alarmCode && alarmMessages[alarmCode]) {
                message = alarmMessages[alarmCode];
                details = `ALARM:${alarmCode}`;
            }
            
            this.showAlarmModal(title, message, details);
        }
    }
    
    // ================================================================
    // Limits Settings Functions
    // ================================================================
    
    setCurrentAsLimit(axis) {
        if (!this.grbl || !this.grbl.state) {
            this.showNotification('Not connected', 'error');
            return;
        }
        
        const pos = this.grbl.state.machinePosition || this.grbl.state.workPosition;
        if (!pos) {
            this.showNotification('Position unknown', 'error');
            return;
        }
        
        const axisLower = axis.toLowerCase();
        const value = Math.abs(pos[axisLower] || 0);
        
        // Map axis to grbl setting
        const settingMap = { x: '$130', y: '$131', z: '$132' };
        const inputMap = { x: 'setting-travel-x', y: 'setting-travel-y', z: 'setting-travel-z' };
        
        const setting = settingMap[axisLower];
        const inputId = inputMap[axisLower];
        
        if (!setting) {
            this.showNotification('Invalid axis', 'error');
            return;
        }
        
        // Update input field
        const input = document.getElementById(inputId);
        if (input) input.value = value.toFixed(2);
        
        // Send to grbl
        this.grbl.send(`${setting}=${value.toFixed(3)}`);
        this.showNotification(`${axis} travel limit set to ${value.toFixed(2)}mm`, 'success');
    }
    
    applyLimitSettings() {
        if (!this.grbl) {
            this.showNotification('Not connected', 'error');
            return;
        }
        
        const commands = [];
        
        // Soft limits
        const softLimits = document.getElementById('setting-soft-limits');
        if (softLimits) commands.push(`$20=${softLimits.checked ? '1' : '0'}`);
        
        // Hard limits
        const hardLimits = document.getElementById('setting-hard-limits');
        if (hardLimits) commands.push(`$21=${hardLimits.checked ? '1' : '0'}`);
        
        // Homing enable
        const homingEnable = document.getElementById('setting-homing-enable');
        if (homingEnable) commands.push(`$22=${homingEnable.checked ? '1' : '0'}`);
        
        // Homing direction
        const homingDir = document.getElementById('setting-homing-dir');
        if (homingDir) commands.push(`$23=${homingDir.value}`);
        
        // Travel limits
        const travelX = document.getElementById('setting-travel-x');
        if (travelX && travelX.value) commands.push(`$130=${parseFloat(travelX.value)}`);
        
        const travelY = document.getElementById('setting-travel-y');
        if (travelY && travelY.value) commands.push(`$131=${parseFloat(travelY.value)}`);
        
        const travelZ = document.getElementById('setting-travel-z');
        if (travelZ && travelZ.value) commands.push(`$132=${parseFloat(travelZ.value)}`);
        
        // Homing speeds
        const homingFeed = document.getElementById('setting-homing-feed');
        if (homingFeed && homingFeed.value) commands.push(`$24=${parseFloat(homingFeed.value)}`);
        
        const homingSeek = document.getElementById('setting-homing-seek');
        if (homingSeek && homingSeek.value) commands.push(`$25=${parseFloat(homingSeek.value)}`);
        
        // Send all commands
        commands.forEach((cmd, i) => {
            setTimeout(() => this.grbl.send(cmd), i * 100);
        });
        
        this.showNotification(`Applied ${commands.length} limit settings`, 'success');
    }
    
    refreshGrblSettings() {
        if (!this.grbl) {
            this.showNotification('Not connected', 'error');
            return;
        }
        
        // Request all settings
        this.grbl.send('$$');
        
        // Parse response to update UI (handled by grbl message parser)
        this.showNotification('Refreshing settings from grblHAL...', 'info');
    }
    
    updateLimitSettingsUI(settings) {
        // Called when grbl settings are received
        // settings is an object like { '$20': '0', '$21': '0', ... }
        
        if (settings['$20'] !== undefined) {
            const el = document.getElementById('setting-soft-limits');
            if (el) el.checked = settings['$20'] === '1';
        }
        
        if (settings['$21'] !== undefined) {
            const el = document.getElementById('setting-hard-limits');
            if (el) el.checked = settings['$21'] === '1';
        }
        
        if (settings['$22'] !== undefined) {
            const el = document.getElementById('setting-homing-enable');
            if (el) el.checked = settings['$22'] === '1';
        }
        
        if (settings['$23'] !== undefined) {
            const el = document.getElementById('setting-homing-dir');
            if (el) el.value = settings['$23'];
        }
        
        if (settings['$24'] !== undefined) {
            const el = document.getElementById('setting-homing-feed');
            if (el) el.value = settings['$24'];
        }
        
        if (settings['$25'] !== undefined) {
            const el = document.getElementById('setting-homing-seek');
            if (el) el.value = settings['$25'];
        }
        
        if (settings['$130'] !== undefined) {
            const el = document.getElementById('setting-travel-x');
            if (el) el.value = settings['$130'];
        }
        
        if (settings['$131'] !== undefined) {
            const el = document.getElementById('setting-travel-y');
            if (el) el.value = settings['$131'];
        }
        
        if (settings['$132'] !== undefined) {
            const el = document.getElementById('setting-travel-z');
            if (el) el.value = settings['$132'];
        }
    }
    
    updateLimitStatus(pins) {
        // Update limit switch status display
        // pins is a string like 'XYZ' indicating triggered limits
        const xEl = document.getElementById('limit-status-x');
        const yEl = document.getElementById('limit-status-y');
        const zEl = document.getElementById('limit-status-z');
        
        if (xEl) {
            xEl.textContent = pins.includes('X') ? 'TRIGGERED' : 'OK';
            xEl.className = pins.includes('X') ? 'limit-on' : 'limit-off';
        }
        if (yEl) {
            yEl.textContent = pins.includes('Y') ? 'TRIGGERED' : 'OK';
            yEl.className = pins.includes('Y') ? 'limit-on' : 'limit-off';
        }
        if (zEl) {
            zEl.textContent = pins.includes('Z') ? 'TRIGGERED' : 'OK';
            zEl.className = pins.includes('Z') ? 'limit-on' : 'limit-off';
        }
    }
    
    // ================================================================
    // Console Logging
    // ================================================================
    
    log(message, type = 'info') {
        const output = this.elements.consoleOutput;
        if (!output) return;
        
        const line = document.createElement('div');
        line.className = `console-line console-${type}`;
        
        const timestamp = new Date().toLocaleTimeString();
        
        // Sanitize message to prevent XSS from external data (grbl responses, etc.)
        const safeMessage = String(message)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
        
        line.innerHTML = `<span class="console-time">${timestamp}</span> ${safeMessage}`;
        
        output.appendChild(line);
        
        // Auto-scroll
        output.scrollTop = output.scrollHeight;
        
        // Limit lines
        while (output.children.length > 500) {
            output.removeChild(output.firstChild);
        }
    }
    
    formatTime(seconds) {
        if (!seconds || seconds < 0) return '0:00';
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = Math.floor(seconds % 60);
        if (h > 0) {
            return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
        }
        return `${m}:${s.toString().padStart(2, '0')}`;
    }
    
    // ================================================================
    // Emergency Stop & Safety Controls
    // ================================================================
    
    /**
     * EMERGENCY STOP - immediately halts all motion and spindle
     * This is the most critical safety function
     */
    emergencyStop() {
        console.warn('🛑 EMERGENCY STOP ACTIVATED');
        
        // Send soft reset to grblHAL (0x18) 
        if (this.dualSerial) {
            this.dualSerial.sendGrbl('\x18');  // Soft reset
            this.dualSerial.spindleStop();     // Stop VFD spindle
        }
        
        // Also try through grbl wrapper
        this.grbl?.reset?.();
        
        // Visual feedback
        document.body.classList.add('estop-active');
        const estopBtn = document.getElementById('estop-btn');
        if (estopBtn) {
            estopBtn.classList.add('active');
        }
        
        // Play alarm
        this.playAlarmSound(2000);
        
        // Show prominent notification
        this.showNotification('🛑 EMERGENCY STOP - All motion halted!', 'error', 10000);
        
        // Log to console
        this.log('🛑 EMERGENCY STOP ACTIVATED', 'error');
        
        // Remove visual feedback after 3 seconds
        setTimeout(() => {
            document.body.classList.remove('estop-active');
            estopBtn?.classList.remove('active');
        }, 3000);
    }
    
    /**
     * Soft reset - resets grblHAL without full power cycle
     */
    softReset() {
        if (this.dualSerial) {
            this.dualSerial.sendGrbl('\x18');
        }
        this.showNotification('Soft reset sent', 'info');
        this.log('Soft reset (Ctrl+X)', 'info');
    }
    
    /**
     * Feed hold - pause current motion
     */
    feedHold() {
        if (this.dualSerial) {
            this.dualSerial.sendGrbl('!');
        }
        this.showNotification('Feed Hold', 'info');
        this.log('Feed Hold (!)', 'info');
    }
    
    /**
     * Cycle start - resume from feed hold
     */
    cycleStart() {
        if (this.dualSerial) {
            this.dualSerial.sendGrbl('~');
        }
        this.showNotification('Cycle Start', 'info');
        this.log('Cycle Start (~)', 'info');
    }
    
    // ================================================================
    // Notifications & Modals
    // ================================================================
    
    // Sound enabled setting (stored in localStorage)
    get soundEnabled() {
        return localStorage.getItem('fluidcnc_sound') !== 'false';
    }
    
    set soundEnabled(value) {
        localStorage.setItem('fluidcnc_sound', value ? 'true' : 'false');
    }
    
    toggleSound() {
        this.soundEnabled = !this.soundEnabled;
        this.showNotification(`Sound ${this.soundEnabled ? 'enabled' : 'disabled'}`, 'info');
        return this.soundEnabled;
    }
    
    // SAFETY: Play alarm sound for critical situations
    playAlarmSound(durationMs = 3000) {
        if (!this.soundEnabled) return;
        
        try {
            const audioContext = new (window.AudioContext || window.webkitAudioContext)();
            const oscillator = audioContext.createOscillator();
            const gainNode = audioContext.createGain();
            
            oscillator.connect(gainNode);
            gainNode.connect(audioContext.destination);
            
            oscillator.type = 'square';
            oscillator.frequency.value = 880; // A5 - high pitch alarm
            gainNode.gain.value = 0.3;
            
            oscillator.start();
            
            // Pulsing effect
            const pulseInterval = setInterval(() => {
                oscillator.frequency.value = oscillator.frequency.value === 880 ? 660 : 880;
            }, 250);
            
            setTimeout(() => {
                clearInterval(pulseInterval);
                oscillator.stop();
                audioContext.close();
            }, durationMs);
        } catch (e) {
            console.warn('Could not play alarm sound:', e);
        }
    }
    
    // Play success sound (job complete, etc)
    playSuccessSound() {
        if (!this.soundEnabled) return;
        
        try {
            const audioContext = new (window.AudioContext || window.webkitAudioContext)();
            const now = audioContext.currentTime;
            
            // Play ascending chord (C-E-G)
            const frequencies = [523.25, 659.25, 783.99]; // C5, E5, G5
            
            frequencies.forEach((freq, i) => {
                const osc = audioContext.createOscillator();
                const gain = audioContext.createGain();
                
                osc.connect(gain);
                gain.connect(audioContext.destination);
                
                osc.type = 'sine';
                osc.frequency.value = freq;
                gain.gain.setValueAtTime(0, now + i * 0.1);
                gain.gain.linearRampToValueAtTime(0.2, now + i * 0.1 + 0.05);
                gain.gain.linearRampToValueAtTime(0, now + i * 0.1 + 0.5);
                
                osc.start(now + i * 0.1);
                osc.stop(now + i * 0.1 + 0.5);
            });
            
            setTimeout(() => audioContext.close(), 1000);
        } catch (e) {
            console.warn('Could not play success sound:', e);
        }
    }
    
    // Play click/beep for feedback
    playClickSound() {
        if (!this.soundEnabled) return;
        
        try {
            const audioContext = new (window.AudioContext || window.webkitAudioContext)();
            const osc = audioContext.createOscillator();
            const gain = audioContext.createGain();
            
            osc.connect(gain);
            gain.connect(audioContext.destination);
            
            osc.type = 'sine';
            osc.frequency.value = 1000;
            gain.gain.setValueAtTime(0.1, audioContext.currentTime);
            gain.gain.linearRampToValueAtTime(0, audioContext.currentTime + 0.05);
            
            osc.start();
            osc.stop(audioContext.currentTime + 0.05);
            
            setTimeout(() => audioContext.close(), 100);
        } catch (e) {
            // Ignore
        }
    }
    
    // Toggle between work and machine position display
    togglePositionDisplay() {
        this.showWorkPosition = !this.showWorkPosition;
        
        // Update the visibility of position elements
        const posElements = document.querySelectorAll('.axis-value');
        const wposElements = document.querySelectorAll('.axis-value-work');
        
        if (this.showWorkPosition) {
            posElements.forEach(el => el.classList.add('hidden'));
            wposElements.forEach(el => el.classList.remove('hidden'));
        } else {
            posElements.forEach(el => el.classList.remove('hidden'));
            wposElements.forEach(el => el.classList.add('hidden'));
        }
        
        // Update toggle button
        const toggleBtn = document.getElementById('pos-toggle-btn');
        if (toggleBtn) {
            toggleBtn.textContent = this.showWorkPosition ? 'WPos' : 'MPos';
            toggleBtn.title = this.showWorkPosition 
                ? 'Showing Work Position (click for Machine)' 
                : 'Showing Machine Position (click for Work)';
        }
        
        this.showNotification(`Showing ${this.showWorkPosition ? 'Work' : 'Machine'} Position`, 'info');
        this.playClickSound();
    }
    
    showNotification(message, type = 'info') {
        const container = document.getElementById('notifications') || document.body;
        
        // Limit concurrent notifications to prevent DOM overflow (MEDIUM-10 fix)
        const existingNotifications = container.querySelectorAll('.notification');
        if (existingNotifications.length >= 5) {
            // Remove oldest notification
            existingNotifications[0].remove();
        }
        
        // Sanitize message to prevent XSS
        const safeMessage = String(message)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
        
        const notif = document.createElement('div');
        notif.className = `notification notification-${type}`;
        notif.innerHTML = `
            <span class="notif-icon">${type === 'success' ? '✓' : type === 'error' ? '✕' : type === 'warning' ? '⚠' : 'ℹ'}</span>
            <span class="notif-message">${safeMessage}</span>
        `;
        
        container.appendChild(notif);
        
        // Animate in
        setTimeout(() => notif.classList.add('show'), 10);
        
        // Remove after delay
        setTimeout(() => {
            notif.classList.remove('show');
            setTimeout(() => notif.remove(), 300);
        }, 4000);
    }
    
    // ================================================================
    // Keyboard Shortcuts Overlay
    // ================================================================
    
    showKeyboardShortcuts() {
        const modal = document.getElementById('keyboard-modal');
        if (modal) {
            modal.classList.remove('hidden');
        } else {
            // Fallback: create modal dynamically
            this.createKeyboardShortcutsModal();
        }
    }
    
    createKeyboardShortcutsModal() {
        const modal = document.createElement('div');
        modal.className = 'modal-overlay keyboard-shortcuts-modal';
        modal.innerHTML = `
            <div class="modal modal-lg">
                <div class="modal-header">
                    <h2>⌨️ Keyboard Shortcuts & Controls</h2>
                    <button class="btn-close" onclick="this.closest('.modal-overlay').remove()">×</button>
                </div>
                <div class="modal-body shortcuts-grid">
                    <div class="shortcut-section">
                        <h3>🎮 Navigation (Jog)</h3>
                        <div class="shortcut-row"><kbd>←</kbd><kbd>→</kbd> Jog X axis</div>
                        <div class="shortcut-row"><kbd>↑</kbd><kbd>↓</kbd> Jog Y axis</div>
                        <div class="shortcut-row"><kbd>PgUp</kbd><kbd>PgDn</kbd> Jog Z axis</div>
                        <div class="shortcut-row"><kbd>Shift</kbd> + arrows = 10x speed</div>
                        <div class="shortcut-row"><kbd>Esc</kbd> Cancel jog / Stop job</div>
                    </div>
                    <div class="shortcut-section">
                        <h3>🔧 Machine Control</h3>
                        <div class="shortcut-row"><kbd>H</kbd> Home all axes</div>
                        <div class="shortcut-row"><kbd>U</kbd> Unlock ($X)</div>
                        <div class="shortcut-row"><kbd>0</kbd> Zero all axes (WCS)</div>
                        <div class="shortcut-row"><kbd>V</kbd> Toggle vacuum</div>
                        <div class="shortcut-row"><kbd>Space</kbd> Pause / Resume job</div>
                    </div>
                    <div class="shortcut-section">
                        <h3>📁 Files & View</h3>
                        <div class="shortcut-row"><kbd>Ctrl</kbd>+<kbd>O</kbd> Open G-code file</div>
                        <div class="shortcut-row"><kbd>Ctrl</kbd>+<kbd>P</kbd> Command palette</div>
                        <div class="shortcut-row"><kbd>F</kbd> Fit view to toolpath</div>
                        <div class="shortcut-row"><kbd>T</kbd> Top view</div>
                        <div class="shortcut-row"><kbd>I</kbd> Isometric view</div>
                        <div class="shortcut-row"><kbd>?</kbd> Show this help</div>
                    </div>
                    <div class="shortcut-section">
                        <h3>🤖 AI Assistant Voice</h3>
                        <div class="shortcut-row">Click <kbd>🎤</kbd> to start voice</div>
                        <div class="shortcut-row">"Hey CNC" - wake word</div>
                        <div class="shortcut-row">"home the machine"</div>
                        <div class="shortcut-row">"jog left 10 millimeters"</div>
                        <div class="shortcut-row">"set spindle to 12000"</div>
                    </div>
                </div>
                <div class="shortcuts-footer">
                    <h4>💡 AI Natural Language Examples</h4>
                    <div class="ai-examples">
                        <code>"move up 5mm"</code>
                        <code>"spindle on at 18k"</code>
                        <code>"what's my position?"</code>
                        <code>"run the job"</code>
                        <code>"go to X10 Y20"</code>
                        <code>"set feed to 1500"</code>
                    </div>
                </div>
                <div class="modal-footer">
                    <label class="checkbox-label">
                        <input type="checkbox" id="show-tips-startup" ${localStorage.getItem('showKeyboardTips') !== 'false' ? 'checked' : ''}>
                        Show tips on startup
                    </label>
                    <button class="btn btn-primary" onclick="this.closest('.modal-overlay').remove()">Got it!</button>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        setTimeout(() => modal.classList.add('active'), 10);
        
        // Handle checkbox change
        modal.querySelector('#show-tips-startup')?.addEventListener('change', (e) => {
            localStorage.setItem('showKeyboardTips', e.target.checked);
        });
        
        // Close on click outside
        modal.addEventListener('click', (e) => {
            if (e.target === modal) modal.remove();
        });
        
        // Close on Escape
        const escHandler = (e) => {
            if (e.key === 'Escape') {
                modal.remove();
                document.removeEventListener('keydown', escHandler);
            }
        };
        document.addEventListener('keydown', escHandler);
    }
    
    // ================================================================
    // Machine Configuration Dialog
    // ================================================================
    
    showMachineConfig() {
        if (!this.connected) {
            this.showNotification('Connect to CNC first!', 'warning');
            return;
        }
        
        const modal = document.createElement('div');
        modal.className = 'modal-overlay';
        modal.id = 'machine-config-modal';
        modal.innerHTML = `
            <div class="modal modal-lg" style="max-width: 600px;">
                <div class="modal-header">
                    <h2>⚙️ Machine Configuration</h2>
                    <button class="btn-close" onclick="document.getElementById('machine-config-modal').remove()">×</button>
                </div>
                <div class="modal-body" style="padding: 20px;">
                    <div style="margin-bottom: 20px; padding: 15px; background: rgba(255,200,0,0.1); border: 1px solid #ffc800; border-radius: 8px;">
                        <h4 style="margin: 0 0 10px; color: #ffc800;">⚠️ HOMING IS DISABLED</h4>
                        <p style="margin: 0; opacity: 0.8;">Your machine has $22=0 (homing disabled). This prevents proper machine operation.</p>
                    </div>
                    
                    <div style="display: flex; flex-direction: column; gap: 12px;">
                        <button class="btn btn-primary btn-large" onclick="app?.runQuickHomingFix(); document.getElementById('machine-config-modal').remove();" style="padding: 15px; font-size: 16px;">
                            🏠 Quick Fix: Enable Homing
                        </button>
                        
                        <button class="btn btn-secondary" onclick="app?.runFullConfiguration(); document.getElementById('machine-config-modal').remove();" style="padding: 12px;">
                            🔧 Full Configuration (All Settings)
                        </button>
                        
                        <button class="btn btn-secondary" onclick="app?.grbl?.send('$$'); document.getElementById('machine-config-modal').remove();" style="padding: 12px;">
                            📋 View Current Settings ($$)
                        </button>
                    </div>
                    
                    <div style="margin-top: 20px; padding: 15px; background: rgba(0,200,255,0.1); border-radius: 8px;">
                        <h4 style="margin: 0 0 10px; color: #00d4ff;">Manual Commands</h4>
                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
                            <button class="btn btn-sm" onclick="app?.grbl?.send('$22=7'); app?.showNotification('Homing enabled', 'success');">$22=7 (Enable Homing)</button>
                            <button class="btn btn-sm" onclick="app?.grbl?.send('$20=1'); app?.showNotification('Soft limits enabled', 'success');">$20=1 (Soft Limits)</button>
                            <button class="btn btn-sm" onclick="app?.grbl?.send('$X'); app?.showNotification('Unlocked', 'success');">$X (Unlock)</button>
                            <button class="btn btn-sm" onclick="app?.grbl?.send('$H'); app?.showNotification('Homing...', 'info');">$H (Home)</button>
                        </div>
                    </div>
                </div>
                <div class="modal-footer">
                    <button class="btn" onclick="document.getElementById('machine-config-modal').remove();">Close</button>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        
        // Close on click outside
        modal.addEventListener('click', (e) => {
            if (e.target === modal) modal.remove();
        });
    }
    
    async runQuickHomingFix() {
        this.showNotification('Configuring machine (no homing - no limit switches)...', 'info');
        
        // MACHINE SPECIFIC: BTT Octopus Pro + TMC2208 (NO sensorless homing!)
        // NO LIMIT SWITCHES = Homing disabled, soft limits disabled
        // Travel: X~350mm, Y~500mm, Z~120mm (ADJUST AS NEEDED)
        const commands = [
            '$22=0',      // Homing DISABLED (no limit switches)
            '$20=0',      // Soft limits DISABLED (requires homing to work)
            '$21=0',      // Hard limits OFF
            
            // TRAVEL LIMITS - Set these anyway for reference
            '$130=350',   // X max travel (mm)
            '$131=500',   // Y max travel (mm)
            '$132=120',   // Z max travel (mm)
        ];
        
        for (const cmd of commands) {
            this.grbl.send(cmd);
            await new Promise(r => setTimeout(r, 100));
        }
        
        // Unlock the machine
        this.grbl.send('$X');
        
        this.showNotification('✅ Machine configured! Use $X to unlock after alarms.', 'success');
    }
    
    async runFullConfiguration() {
        if (typeof MachineConfigurator !== 'undefined') {
            const config = new MachineConfigurator();
            await config.runFullConfiguration();
        } else {
            this.showNotification('Configuration script not loaded', 'error');
        }
    }
    
    // ================================================================
    // Work Coordinate System (WCS) Management
    // ================================================================
    
    /**
     * Select a work coordinate system (G54-G59)
     */
    selectWcs(wcs) {
        if (!this.grbl?.connected) {
            this.showNotification('Not connected', 'warning');
            return;
        }
        
        // Send the WCS command
        this.grbl.send(wcs);
        this.log(`Selected ${wcs}`, 'info');
        
        // Update button states
        document.querySelectorAll('.btn-wcs').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.wcs === wcs);
        });
        document.querySelectorAll('.btn-wcs-select').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.wcs === wcs);
        });
        
        this.currentWcs = wcs;
        this.showNotification(`Work offset: ${wcs}`, 'success');
    }
    
    /**
     * Open the WCS Manager modal
     */
    openWcsManager() {
        const modal = document.getElementById('wcs-manager-modal');
        if (modal) {
            modal.classList.remove('hidden');
            // Refresh values from machine when opening
            this.refreshWcsValues();
        }
    }
    
    /**
     * Refresh WCS values from the machine
     */
    async refreshWcsValues() {
        if (!this.grbl?.connected) {
            this.showNotification('Connect to machine first', 'warning');
            return;
        }
        
        this.log('Reading work coordinate offsets...', 'info');
        
        // Request coordinate system parameters (G54 = $#)
        // grblHAL stores WCS offsets in $# response
        try {
            await this.grbl.sendAndWait('$#');
            
            // Parse the stored WCS offsets from grbl state or response
            // This is populated from the $# response parsing
            const wcsOffsets = this.grbl.wcsOffsets || {};
            
            ['G54', 'G55', 'G56', 'G57', 'G58', 'G59'].forEach(wcs => {
                const offset = wcsOffsets[wcs] || { x: 0, y: 0, z: 0 };
                const prefix = `wcs-${wcs.toLowerCase()}`;
                
                const xInput = document.getElementById(`${prefix}-x`);
                const yInput = document.getElementById(`${prefix}-y`);
                const zInput = document.getElementById(`${prefix}-z`);
                
                if (xInput) xInput.value = offset.x?.toFixed(3) || '0';
                if (yInput) yInput.value = offset.y?.toFixed(3) || '0';
                if (zInput) zInput.value = offset.z?.toFixed(3) || '0';
            });
            
            this.showNotification('WCS values refreshed', 'success');
        } catch (e) {
            this.log(`Failed to read WCS: ${e.message}`, 'error');
            this.showNotification('Failed to read WCS offsets', 'error');
        }
    }
    
    /**
     * Set WCS offset from current machine position
     */
    setWcsFromCurrent(wcs) {
        if (!this.grbl?.connected) {
            this.showNotification('Not connected', 'warning');
            return;
        }
        
        const mpos = this.grbl.state.mpos;
        const p = this.wcsToP(wcs);
        
        // G10 L2 sets offset so that work position = 0 at current machine position
        // G10 L20 sets the current work position to the specified value (usually 0)
        this.grbl.send(`G10 L2 P${p} X${mpos.x} Y${mpos.y} Z${mpos.z}`);
        
        this.log(`Set ${wcs} origin from current position`, 'info');
        this.showNotification(`${wcs} set to current position`, 'success');
        
        // Refresh the display
        setTimeout(() => this.refreshWcsValues(), 500);
    }
    
    /**
     * Clear a WCS offset (set to 0,0,0)
     */
    clearWcs(wcs) {
        if (!this.grbl?.connected) {
            this.showNotification('Not connected', 'warning');
            return;
        }
        
        const p = this.wcsToP(wcs);
        this.grbl.send(`G10 L2 P${p} X0 Y0 Z0`);
        
        this.log(`Cleared ${wcs} offset`, 'info');
        this.showNotification(`${wcs} cleared`, 'success');
        
        // Update the input fields
        const prefix = `wcs-${wcs.toLowerCase()}`;
        ['x', 'y', 'z'].forEach(axis => {
            const input = document.getElementById(`${prefix}-${axis}`);
            if (input) input.value = '0';
        });
    }
    
    /**
     * Apply WCS values from the input fields to the machine
     */
    applyWcsValues() {
        if (!this.grbl?.connected) {
            this.showNotification('Not connected', 'warning');
            return;
        }
        
        ['G54', 'G55', 'G56', 'G57', 'G58', 'G59'].forEach(wcs => {
            const prefix = `wcs-${wcs.toLowerCase()}`;
            const x = parseFloat(document.getElementById(`${prefix}-x`)?.value) || 0;
            const y = parseFloat(document.getElementById(`${prefix}-y`)?.value) || 0;
            const z = parseFloat(document.getElementById(`${prefix}-z`)?.value) || 0;
            
            const p = this.wcsToP(wcs);
            this.grbl.send(`G10 L2 P${p} X${x} Y${y} Z${z}`);
        });
        
        this.log('Applied WCS offsets to machine', 'info');
        this.showNotification('WCS offsets applied', 'success');
    }
    
    /**
     * Convert WCS name to P number for G10 command
     */
    wcsToP(wcs) {
        const map = { 'G54': 1, 'G55': 2, 'G56': 3, 'G57': 4, 'G58': 5, 'G59': 6 };
        return map[wcs] || 1;
    }
    
    // ================================================================
    // Service Worker Update Notification
    // ================================================================
    
    showUpdateNotification(version, message) {
        const notification = document.createElement('div');
        notification.className = 'update-notification';
        notification.innerHTML = `
            <div class="update-content">
                <span class="update-icon">🔄</span>
                <div class="update-text">
                    <strong>Update Available!</strong>
                    <p>${message}</p>
                </div>
                <button class="btn btn-primary btn-sm update-refresh">Refresh Now</button>
                <button class="btn-close update-dismiss">×</button>
            </div>
        `;
        
        document.body.appendChild(notification);
        
        // Animate in
        setTimeout(() => notification.classList.add('visible'), 10);
        
        // Handle refresh button
        notification.querySelector('.update-refresh').addEventListener('click', () => {
            // Tell the service worker to skip waiting and take over
            if (navigator.serviceWorker.controller) {
                navigator.serviceWorker.controller.postMessage({ type: 'SKIP_WAITING' });
            }
            window.location.reload();
        });
        
        // Handle dismiss
        notification.querySelector('.update-dismiss').addEventListener('click', () => {
            notification.classList.remove('visible');
            setTimeout(() => notification.remove(), 300);
        });
        
        // Auto-hide after 30 seconds
        setTimeout(() => {
            if (notification.parentNode) {
                notification.classList.remove('visible');
                setTimeout(() => notification.remove(), 300);
            }
        }, 30000);
    }

    // ================================================================
    // Command Palette (Ctrl+P quick action search)
    // ================================================================

    setupCommandPalette() {
        this.commandPaletteVisible = false;
        this.commandPaletteIndex = 0;
        
        // Define available commands
        this.commands = [
            { icon: '🏠', name: 'Home All Axes', desc: 'Return machine to home position', shortcut: 'H', action: () => this.grbl?.home() },
            { icon: '🔓', name: 'Unlock Machine', desc: 'Clear alarm state ($X)', shortcut: 'U', action: () => this.grbl?.unlock() },
            { icon: '⊙', name: 'Zero All Axes', desc: 'Set current position as work zero', shortcut: '0', action: () => this.grbl?.setZero('XYZ') },
            { icon: '▶', name: 'Start Job', desc: 'Run loaded G-code program', shortcut: 'Space', action: () => this.startJob() },
            { icon: '⏸', name: 'Pause Job', desc: 'Pause running program', shortcut: '', action: () => this.pauseJob() },
            { icon: '⏹', name: 'Stop Job', desc: 'Stop and reset program', shortcut: '', action: () => this.stopJob() },
            { icon: '📂', name: 'Open G-Code File', desc: 'Load a G-code file', shortcut: 'Ctrl+O', action: () => document.getElementById('file-input')?.click() },
            { icon: '💾', name: 'Save G-Code', desc: 'Save current G-code', shortcut: 'Ctrl+S', action: () => this.saveGCode() },
            { icon: '🔲', name: 'Surfacing Wizard', desc: 'Create surface facing program', shortcut: '', action: () => document.getElementById('surfacing-modal')?.classList.remove('hidden') },
            { icon: '🎯', name: 'Probe Wizard', desc: 'Start probing routine', shortcut: '', action: () => document.getElementById('probe-modal')?.classList.remove('hidden') },
            { icon: '🛠️', name: 'Tool Table', desc: 'View and edit tool library', shortcut: '', action: () => document.getElementById('tools-modal')?.classList.remove('hidden') },
            { icon: '⚙️', name: 'Settings', desc: 'Open settings panel', shortcut: '', action: () => document.getElementById('settings-modal')?.classList.remove('hidden') },
            { icon: '📶', name: 'Connect WiFi', desc: 'Connect via WebSocket', shortcut: '', action: () => this.connect('websocket') },
            { icon: '🔌', name: 'Connect USB', desc: 'Connect via WebSerial', shortcut: '', action: () => this.connect('serial') },
            { icon: '🎲', name: 'Demo Mode', desc: 'Run with simulated machine', shortcut: '', action: () => this.enterDemoMode() },
            { icon: '🌀', name: 'Toggle Vacuum', desc: 'Turn vacuum on/off', shortcut: 'V', action: () => this.elements.vacuumToggle?.click() },
            { icon: '💧', name: 'Coolant Flood', desc: 'Toggle flood coolant', shortcut: '', action: () => this.grbl?.send('M8') },
            { icon: '🌫️', name: 'Coolant Mist', desc: 'Toggle mist coolant', shortcut: '', action: () => this.grbl?.send('M7') },
            { icon: '❌', name: 'Coolant Off', desc: 'Turn off all coolant', shortcut: '', action: () => this.grbl?.send('M9') },
            { icon: '↻', name: 'Spindle CW', desc: 'Start spindle clockwise', shortcut: '', action: () => this.grbl?.spindleOn(12000, 'cw') },
            { icon: '↺', name: 'Spindle CCW', desc: 'Start spindle counter-clockwise', shortcut: '', action: () => this.grbl?.spindleOn(12000, 'ccw') },
            { icon: '⏹', name: 'Spindle Stop', desc: 'Stop spindle', shortcut: '', action: () => this.grbl?.spindleOff() },
            { icon: '📍', name: 'Go To Origin', desc: 'Move to work origin', shortcut: '', action: () => this.gotoPreset('origin') },
            { icon: '🅿️', name: 'Go To Park', desc: 'Move to park position', shortcut: '', action: () => this.gotoPreset('park') },
            { icon: '📏', name: 'Measure Tool', desc: 'Run tool length probe', shortcut: '', action: () => this.probeWizard?.probeToolLength?.() },
            { icon: '⌨️', name: 'Keyboard Shortcuts', desc: 'Show all shortcuts', shortcut: '?', action: () => this.showKeyboardShortcuts() },
            { icon: '🤖', name: 'AI Assistant', desc: 'Toggle AI panel', shortcut: 'A', action: () => document.getElementById('ai-panel')?.classList.toggle('collapsed') },
            { icon: '📐', name: '3D Measure Mode', desc: 'Enable visualizer measurement', shortcut: 'M', action: () => this.visualizer3D?.enableMeasureMode?.(true) },
            { icon: '📸', name: 'Screenshot View', desc: 'Save 3D view as image', shortcut: 'Ctrl+Shift+S', action: () => this.visualizer3D?.takeScreenshot?.() },
            { icon: '🔍', name: 'Fit to Path', desc: 'Zoom to fit toolpath', shortcut: 'F', action: () => this.visualizer3D?.fitToPath?.() },
            { icon: '⬆', name: 'Top View', desc: 'Set camera to top view', shortcut: '1', action: () => this.visualizer3D?.setView?.('top') },
            { icon: '◇', name: 'Isometric View', desc: 'Set camera to isometric', shortcut: 'T', action: () => this.visualizer3D?.setView?.('isometric') },
        ];
        
        // Keyboard handler for palette
        document.addEventListener('keydown', (e) => {
            // Ctrl+P to open palette
            if (e.ctrlKey && e.key.toLowerCase() === 'p' && !e.target.matches('input, textarea')) {
                e.preventDefault();
                this.toggleCommandPalette();
                return;
            }
            
            // Handle palette navigation
            if (this.commandPaletteVisible) {
                if (e.key === 'Escape') {
                    this.hideCommandPalette();
                } else if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    this.navigatePalette(1);
                } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    this.navigatePalette(-1);
                } else if (e.key === 'Enter') {
                    e.preventDefault();
                    this.executePaletteCommand();
                }
            }
        });
        
        // Input handler for filtering
        const input = document.getElementById('palette-input');
        if (input) {
            input.addEventListener('input', (e) => this.filterPaletteResults(e.target.value));
        }
        
        // Click outside to close
        document.getElementById('command-palette')?.addEventListener('click', (e) => {
            if (e.target.id === 'command-palette') {
                this.hideCommandPalette();
            }
        });
    }

    toggleCommandPalette() {
        const palette = document.getElementById('command-palette');
        if (!palette) return;
        
        if (this.commandPaletteVisible) {
            this.hideCommandPalette();
        } else {
            this.showCommandPalette();
        }
    }

    showCommandPalette() {
        const palette = document.getElementById('command-palette');
        const input = document.getElementById('palette-input');
        if (!palette) return;
        
        palette.classList.remove('hidden');
        this.commandPaletteVisible = true;
        this.commandPaletteIndex = 0;
        
        if (input) {
            input.value = '';
            input.focus();
        }
        
        this.filterPaletteResults('');
    }

    hideCommandPalette() {
        const palette = document.getElementById('command-palette');
        if (!palette) return;
        
        palette.classList.add('hidden');
        this.commandPaletteVisible = false;
    }

    filterPaletteResults(query) {
        const results = document.getElementById('palette-results');
        if (!results) return;
        
        const q = query.toLowerCase().trim();
        const filtered = q 
            ? this.commands.filter(cmd => 
                cmd.name.toLowerCase().includes(q) || 
                cmd.desc.toLowerCase().includes(q))
            : this.commands;
        
        results.innerHTML = filtered.map((cmd, i) => `
            <div class="palette-result ${i === 0 ? 'active' : ''}" data-index="${i}">
                <span class="palette-result-icon">${cmd.icon}</span>
                <div class="palette-result-text">
                    <div class="palette-result-name">${cmd.name}</div>
                    <div class="palette-result-desc">${cmd.desc}</div>
                </div>
                ${cmd.shortcut ? `<span class="palette-result-shortcut"><kbd>${cmd.shortcut}</kbd></span>` : ''}
            </div>
        `).join('');
        
        this.filteredCommands = filtered;
        this.commandPaletteIndex = 0;
        
        // Add click handlers
        results.querySelectorAll('.palette-result').forEach((el, i) => {
            el.addEventListener('click', () => {
                this.commandPaletteIndex = i;
                this.executePaletteCommand();
            });
            el.addEventListener('mouseenter', () => {
                results.querySelectorAll('.palette-result').forEach(r => r.classList.remove('active'));
                el.classList.add('active');
                this.commandPaletteIndex = i;
            });
        });
    }

    navigatePalette(delta) {
        const results = document.getElementById('palette-results');
        if (!results || !this.filteredCommands?.length) return;
        
        const items = results.querySelectorAll('.palette-result');
        items[this.commandPaletteIndex]?.classList.remove('active');
        
        this.commandPaletteIndex = (this.commandPaletteIndex + delta + items.length) % items.length;
        items[this.commandPaletteIndex]?.classList.add('active');
        items[this.commandPaletteIndex]?.scrollIntoView({ block: 'nearest' });
    }

    executePaletteCommand() {
        const cmd = this.filteredCommands?.[this.commandPaletteIndex];
        if (cmd?.action) {
            this.hideCommandPalette();
            cmd.action();
            this.log(`Executed: ${cmd.name}`, 'info');
        }
    }

    // ================================================================
    // File Drag and Drop
    // ================================================================

    setupDragAndDrop() {
        // Create drop overlay
        let dropOverlay = document.getElementById('drop-overlay');
        if (!dropOverlay) {
            dropOverlay = document.createElement('div');
            dropOverlay.id = 'drop-overlay';
            dropOverlay.className = 'drop-overlay';
            dropOverlay.innerHTML = `
                <div class="drop-zone">
                    <div class="drop-zone-icon">📂</div>
                    <div class="drop-zone-text">Drop G-Code File Here</div>
                    <div class="drop-zone-hint">.nc, .gcode, .ngc, .tap, .txt</div>
                </div>
            `;
            document.body.appendChild(dropOverlay);
        }
        
        let dragCounter = 0;
        
        document.addEventListener('dragenter', (e) => {
            e.preventDefault();
            dragCounter++;
            dropOverlay.classList.add('active');
        });
        
        document.addEventListener('dragleave', (e) => {
            e.preventDefault();
            dragCounter--;
            if (dragCounter === 0) {
                dropOverlay.classList.remove('active');
            }
        });
        
        document.addEventListener('dragover', (e) => {
            e.preventDefault();
        });
        
        document.addEventListener('drop', (e) => {
            e.preventDefault();
            dragCounter = 0;
            dropOverlay.classList.remove('active');
            
            const files = e.dataTransfer.files;
            if (files.length > 0) {
                this.handleDroppedFile(files[0]);
            }
        });
    }

    handleDroppedFile(file) {
        const validExtensions = ['.nc', '.gcode', '.ngc', '.tap', '.txt', '.cnc'];
        const ext = '.' + file.name.split('.').pop().toLowerCase();
        
        if (!validExtensions.includes(ext)) {
            this.showNotification(`Invalid file type: ${ext}. Expected G-code file.`, 'error');
            return;
        }
        
        const reader = new FileReader();
        reader.onload = (e) => {
            const content = e.target.result;
            this.loadGCodeContent(content, file.name);
            this.showNotification(`Loaded: ${file.name}`, 'success');
        };
        reader.onerror = () => {
            this.showNotification('Failed to read file', 'error');
        };
        reader.readAsText(file);
    }

    loadGCodeContent(content, filename = 'Untitled.nc') {
        // Update editor
        const editor = document.getElementById('gcode-editor');
        if (editor) {
            editor.value = content;
        }
        
        // Update filename display
        const filenameEl = document.getElementById('gcode-filename');
        if (filenameEl) {
            filenameEl.textContent = filename;
        }
        
        // Parse and update visualizer
        this.gcodeLines = content.split('\n');
        this.gcodeFileName = filename;
        
        // Update line count
        const linesEl = document.getElementById('total-lines');
        if (linesEl) {
            linesEl.textContent = this.gcodeLines.length;
        }
        
        // Load into visualizer
        if (this.visualizer3D) {
            this.visualizer3D.loadGCode(content);
            const stats = this.visualizer3D.getPathStats?.();
            if (stats?.analysis) {
                this.showGCodeAnalysis(stats.analysis);
            }
        } else if (this.visualizer) {
            this.visualizer.loadGCode(content);
        }
        
        // Switch to visualizer tab
        this.switchTab?.('visualizer');
    }

    showGCodeAnalysis(analysis) {
        if (!analysis) return;
        
        let message = `📊 G-Code Analysis:\n`;
        message += `Quality: ${analysis.quality} (${analysis.score}/100)\n`;
        message += `${analysis.summary.lineCount} lines, ${analysis.summary.moveCount} moves\n`;
        
        if (analysis.issues.length > 0) {
            message += `⚠️ ${analysis.issues.length} issue(s) found\n`;
        }
        
        // Show in AI panel
        if (this.ai) {
            this.ai.addMessage(message, 'assistant');
        }
        
        // Log to console
        this.log(`G-Code: ${analysis.quality} quality, ${analysis.summary.moveCount} moves`, 'info');
    }
}

// Initialize app on DOM ready
// Use window.app directly so onclick handlers can access it
window.app = null;
window.chatterSystem = null;

document.addEventListener('DOMContentLoaded', () => {
    window.app = new FluidCNCApp();
    
    // Initialize new modules that depend on app
    if (typeof ToolSetter !== 'undefined') {
        window.app.toolSetter = new ToolSetter(window.app);
    }
    if (typeof CameraModule !== 'undefined') {
        window.app.camera = new CameraModule(window.app);
    }
    if (typeof MachineEnhancements !== 'undefined') {
        window.app.enhancements = new MachineEnhancements(window.app);
    }
    
    // Initialize v12 Enhancements (VFD display, timer, gamepad, audio)
    if (typeof EnhancementsV12 !== 'undefined') {
        window.app.enhancementsV12 = new EnhancementsV12(window.app);
    }
    
    // Initialize Chatter Detection System (ESP32)
    // Shows warning if not connected, but FluidCNC still works normally
    if (typeof ChatterDetection !== 'undefined') {
        const savedEspIp = localStorage.getItem('chatterEspIp') || '192.168.1.100';
        
        window.chatterSystem = new ChatterDetection({
            wsUrl: `ws://${savedEspIp}/ws`,
            onConnect: () => {
                console.log('✓ Chatter detection ESP32 connected');
                window.app?.showNotification?.('Chatter detection connected', 'success');
            },
            onDisconnect: () => {
                console.log('⚠ Chatter detection ESP32 disconnected - will retry');
                // Don't show error notification on every disconnect, just log it
            },
            onUpdate: (state) => {
                // Integrate chatter detection with adaptive feed control
                if (window.app?.enhancements?.adaptiveFeed?.enabled) {
                    // Convert chatter score to 0-1 range for adaptive feed
                    const chatterScore = (state.combined || 0) / 100;  // Waveshare uses 0-100
                    const spindleLoad = 0;  // No spindle load sensor currently
                    window.app.enhancements.updateAdaptiveFeed(spindleLoad, chatterScore);
                }
                
                // Show chatter warning in status bar if detected
                if (state.chatter) {
                    window.app?.showNotification?.('⚠️ Chatter detected - reducing feed', 'warning');
                }
            },
            onAlert: (alert) => {
                // Show critical alerts in the main notification system
                if (alert.type === 'toolBroken') {
                    window.app?.showNotification?.(alert.message, 'error');
                } else if (alert.type === 'overload') {
                    window.app?.showNotification?.(alert.message, 'warning');
                }
            }
        });
        
        // Save IP when changed
        const ipInput = document.getElementById('chatter-ip');
        if (ipInput) {
            ipInput.value = savedEspIp;
            ipInput.addEventListener('change', (e) => {
                localStorage.setItem('chatterEspIp', e.target.value);
            });
        }
    }
    
    // Listen for service worker update notifications
    if (navigator.serviceWorker) {
        navigator.serviceWorker.addEventListener('message', (event) => {
            if (event.data.type === 'SW_UPDATED') {
                window.app?.showUpdateNotification?.(event.data.version, event.data.message);
            }
        });
        
        // Check for waiting service worker on load
        navigator.serviceWorker.ready.then((registration) => {
            if (registration.waiting) {
                window.app?.showUpdateNotification?.('new', 'A new version is available!');
            }
        });
    }
});

// Export for module usage
if (typeof module !== 'undefined' && module.exports) {
    module.exports = FluidCNCApp;
}
