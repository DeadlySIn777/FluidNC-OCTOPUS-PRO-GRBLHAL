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

        // Machine workspace / envelope (used by visualizer + presets)
        this.workArea = { x: 400, y: 400, z: 200 };
        
        // G-code
        this.gcodeLines = [];
        this.gcodeFileName = '';
        
        // UI Elements cache
        this.elements = {};
        
        // Initialize
        this.init();
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
        this.bindEvents();
        this.bindKeyboard();
        this.loadSettings();
        this.setupToolTable();
        this.setupGCodeEditor();
        this.setupConsole();
        
        // Auto-connect only if we have a saved IP (WebSerial requires user gesture, so never auto-connect serial)
        const lastConnType = localStorage.getItem('fluidcnc-connection-type') || 'websocket';
        const lastIp = localStorage.getItem('fluidcnc-last-ip');
        if (lastConnType === 'websocket' && lastIp) {
            setTimeout(() => this.connect('websocket'), 500);
        }
        
        this.log('FluidCNC initialized', 'info');
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
            'macro-container'
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
            onProgress: (info) => this.onStreamProgress(info)
        });

        // Disable USB button if WebSerial isn't available
        if (this.elements.usbConnectBtn && !GrblHAL.isWebSerialSupported()) {
            this.elements.usbConnectBtn.disabled = true;
            this.elements.usbConnectBtn.title = 'WebSerial not supported (use Chrome/Edge on desktop)';
        }
    }
    
    connect(type = null) {
        const connectionType = (type || localStorage.getItem('fluidcnc-connection-type') || 'websocket');
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
        this.grbl.connect(connectionType);
    }
    
    disconnect() {
        this.grbl.disconnect();
    }
    
    onGrblConnect() {
        this.connected = true;
        const connType = this.grbl.getConnectionType ? this.grbl.getConnectionType() : 'websocket';
        
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
        
        // Query machine state
        setTimeout(() => {
            this.grbl.send('$$');
        }, 200);
    }
    
    onGrblDisconnect(info) {
        this.connected = false;
        
        // Show overlay, hide app
        this.showOverlay();
        
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
        
        this.log('Demo mode started - no real CNC connection', 'info');
        this.showNotification('Demo Mode Active', 'info');
        
        // Start simulated status updates
        this._startDemoSimulation();
    }
    
    _startDemoSimulation() {
        let simX = 0, simY = 0, simZ = 0;
        this.demoInterval = setInterval(() => {
            // Simulate slight position changes
            simX += (Math.random() - 0.5) * 0.1;
            simY += (Math.random() - 0.5) * 0.1;
            simZ += (Math.random() - 0.5) * 0.05;
            
            this.onGrblStatus({
                status: 'Idle',
                mpos: { x: simX, y: simY, z: simZ },
                wpos: { x: simX, y: simY, z: simZ },
                feed: 0,
                feedRate: 0,
                spindle: 0,
                spindleSpeed: 0,
                coolant: { flood: false, mist: false },
                feedOverride: 100,
                rapidOverride: 100,
                spindleOverride: 100
            });
        }, 500);
    }
    
    stopDemo() {
        if (this.demoInterval) {
            clearInterval(this.demoInterval);
            this.demoInterval = null;
        }
        this.demoMode = false;
        this.showOverlay();
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
        
        // Update visualizer with tool position
        if (this.visualizer && state.wpos) {
            this.visualizer.setToolPosition(state.wpos.x, state.wpos.y, state.wpos.z);
        }
    }
    
    onGrblError(error) {
        this.log(`ERROR: ${error.message || error}`, 'error');
        this.showNotification(error.message || 'Error occurred', 'error');
    }
    
    onGrblAlarm(alarm) {
        const info = this.grbl.alarmCodes[alarm.code] || { msg: 'Unknown alarm', recovery: '' };
        this.log(`ALARM ${alarm.code}: ${info.msg}`, 'error');
        this.showAlarmModal(alarm.code, info);
    }
    
    onStreamProgress(info) {
        if (this.elements.progressFill) {
            this.elements.progressFill.style.width = `${info.progress}%`;
        }
        if (this.elements.jobProgress) {
            this.elements.jobProgress.textContent = `${info.current} / ${info.total} (${info.progress.toFixed(1)}%)`;
        }
    }
    
    // ================================================================
    // Visualizer Setup
    // ================================================================
    
    setupVisualizer() {
        if (typeof GCodeVisualizer === 'undefined') {
            console.warn('GCodeVisualizer not loaded');
            return;
        }
        
        this.visualizer = new GCodeVisualizer({
            canvas: this.elements.visualizerCanvas,
            workArea: this.workArea,
            gridSize: 10
        });
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
            onError: (err) => this.log(`AI Error: ${err}`, 'error')
        });

        // Keep AI workspace context aligned with app settings
        if (this.ai?.machineConfig) {
            this.ai.machineConfig.workArea = { ...this.workArea };
        }
        
        // Bind AI chat input
        if (this.elements.aiInput) {
            this.elements.aiInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    this.sendAIMessage();
                }
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
    }
    
    sendAIMessage() {
        const input = this.elements.aiInput;
        if (!input || !input.value.trim()) return;
        
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

        // USB (WebSerial) connect button (overlay)
        this.elements.usbConnectBtn?.addEventListener('click', (e) => {
            e.preventDefault();
            console.log('[FluidCNC] USB button clicked, connected=', this.connected);
            if (this.connected) {
                this.disconnect();
            } else {
                console.log('[FluidCNC] Calling connect(serial)...');
                this.connect('serial');
            }
        });
        
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
        
        // E-Stop button
        document.getElementById('estop-btn')?.addEventListener('click', () => {
            this.grbl.reset();
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
            
            // Escape to stop/cancel
            if (e.key === 'Escape') {
                this.grbl.jogCancel();
                if (this.grbl.streaming) {
                    this.stopJob();
                }
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
        
        // Build jog command
        let cmd = '$J=G91';
        if (x !== 0) cmd += ` X${x * distance}`;
        if (y !== 0) cmd += ` Y${y * distance}`;
        if (z !== 0) cmd += ` Z${z * distance}`;
        
        const feed = (z !== 0 && x === 0 && y === 0) ? this.jogFeed / 3 : this.jogFeed;
        cmd += ` F${feed}`;
        
        this.grbl.send(cmd);
    }
    
    startJog(direction) {
        const [axis, dir] = [direction[0].toUpperCase(), direction[1] === '+' ? 1 : -1];
        const distance = this.jogMode === 'step' ? this.jogStep : 1000;
        const feed = axis === 'Z' ? this.jogFeed / 3 : this.jogFeed;
        
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
        this.jogStep = step;
        document.querySelectorAll('[data-step]').forEach(btn => {
            btn.classList.toggle('active', parseFloat(btn.dataset.step) === step);
        });
    }
    
    switchTab(tabName) {
        // Update tab buttons
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tab === tabName);
        });
        
        // Update tab content
        document.querySelectorAll('.tab-content').forEach(content => {
            content.classList.toggle('active', content.id === `${tabName}-tab`);
        });
        
        // Special handling for visualizer tab
        if (tabName === 'visualizer' && this.visualizer) {
            // Trigger resize via window event
            window.dispatchEvent(new Event('resize'));
            if (typeof this.visualizer.render === 'function') {
                this.visualizer.render();
            }
        }
    }
    
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
    
    startJob() {
        if (this.gcodeLines.length === 0) {
            this.showNotification('No G-code loaded', 'warning');
            return;
        }
        
        if (!this.grbl.isIdle()) {
            this.showNotification('Machine must be idle', 'warning');
            return;
        }
        
        this.log('Starting job...', 'info');
        
        this.grbl.streamGCode(this.gcodeLines, {
            onProgress: (pct, current, total) => {
                this.onStreamProgress({ progress: pct, current, total });
            },
            onComplete: () => {
                this.log('Job complete!', 'success');
                this.showNotification('Job complete!', 'success');
            },
            onStop: () => {
                this.log('Job stopped', 'warning');
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
    }
    
    resumeJob() {
        this.grbl.resumeStream();
        this.elements.btnPause.textContent = 'Pause';
        this.elements.btnPause.onclick = () => this.pauseJob();
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
        // Simple settings modal (kept intentionally minimal)
        const existing = document.getElementById('settings-modal-overlay');
        if (existing) existing.remove();

        const modal = document.createElement('div');
        modal.id = 'settings-modal-overlay';
        modal.className = 'modal-overlay';
        modal.innerHTML = `
            <div class="modal modal-large">
                <div class="modal-header">
                    <h2>⚙️ Settings</h2>
                    <button class="modal-close btn-close" aria-label="Close">✕</button>
                </div>
                <div class="modal-body">
                    <div style="display:grid; grid-template-columns: 1fr; gap: 12px;">
                        <div>
                            <div style="font-weight:600; margin-bottom:6px;">Machine workspace (mm)</div>
                            <div style="display:grid; grid-template-columns: repeat(3, 1fr); gap: 8px;">
                                <label style="display:flex; flex-direction:column; gap:4px;">
                                    <span style="opacity:.8; font-size:12px;">X</span>
                                    <input id="settings-workarea-x" class="tool-input" type="number" min="1" step="1" value="${this.workArea.x}">
                                </label>
                                <label style="display:flex; flex-direction:column; gap:4px;">
                                    <span style="opacity:.8; font-size:12px;">Y</span>
                                    <input id="settings-workarea-y" class="tool-input" type="number" min="1" step="1" value="${this.workArea.y}">
                                </label>
                                <label style="display:flex; flex-direction:column; gap:4px;">
                                    <span style="opacity:.8; font-size:12px;">Z</span>
                                    <input id="settings-workarea-z" class="tool-input" type="number" min="1" step="1" value="${this.workArea.z}">
                                </label>
                            </div>
                            <div style="opacity:.7; font-size:12px; margin-top:6px;">Used for visualizer grid/bounds and the Park preset.</div>
                        </div>
                    </div>
                </div>
                <div class="modal-footer" style="display:flex; justify-content:flex-end; gap:8px;">
                    <button id="settings-cancel" class="btn btn-secondary">Cancel</button>
                    <button id="settings-save" class="btn btn-primary">Save</button>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        const close = () => modal.remove();
        modal.querySelector('.modal-close')?.addEventListener('click', close);
        modal.querySelector('#settings-cancel')?.addEventListener('click', close);

        // Close on click outside
        modal.addEventListener('click', (e) => {
            if (e.target === modal) close();
        });

        // Save
        modal.querySelector('#settings-save')?.addEventListener('click', () => {
            const x = Number(modal.querySelector('#settings-workarea-x')?.value);
            const y = Number(modal.querySelector('#settings-workarea-y')?.value);
            const z = Number(modal.querySelector('#settings-workarea-z')?.value);

            if (!(Number.isFinite(x) && x > 0 && Number.isFinite(y) && y > 0 && Number.isFinite(z) && z > 0)) {
                this.showNotification('Invalid workspace values', 'warning');
                return;
            }

            this.workArea = { x, y, z };
            this.saveSettings();
            this.applyWorkAreaToModules();
            this.showNotification('Settings saved', 'success');
            close();
        });
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
        line.innerHTML = `<span class="console-time">${timestamp}</span> ${message}`;
        
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
    // Notifications & Modals
    // ================================================================
    
    showNotification(message, type = 'info') {
        const container = document.getElementById('notifications') || document.body;
        
        const notif = document.createElement('div');
        notif.className = `notification notification-${type}`;
        notif.innerHTML = `
            <span class="notif-icon">${type === 'success' ? '✓' : type === 'error' ? '✕' : type === 'warning' ? '⚠' : 'ℹ'}</span>
            <span class="notif-message">${message}</span>
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
    
    showAlarmModal(code, info) {
        const modal = document.createElement('div');
        modal.className = 'modal-overlay';
        modal.innerHTML = `
            <div class="modal alarm-modal">
                <div class="alarm-header">
                    <span class="alarm-icon">🚨</span>
                    <h2>ALARM ${code}</h2>
                </div>
                <div class="alarm-body">
                    <p class="alarm-message">${info.msg}</p>
                    <p class="alarm-recovery"><strong>Recovery:</strong> ${info.recovery}</p>
                </div>
                <div class="alarm-actions">
                    <button class="btn btn-warning" onclick="app.grbl.unlock(); this.closest('.modal-overlay').remove();">
                        Unlock ($X)
                    </button>
                    <button class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove();">
                        Close
                    </button>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        setTimeout(() => modal.classList.add('active'), 10);
    }
    
    // ================================================================
    // Keyboard Shortcuts Overlay
    // ================================================================
    
    showKeyboardShortcuts() {
        const modal = document.createElement('div');
        modal.className = 'modal-overlay keyboard-shortcuts-modal';
        modal.innerHTML = `
            <div class="modal">
                <div class="modal-header">
                    <h2>⌨️ Keyboard Shortcuts</h2>
                    <button class="btn-close" onclick="this.closest('.modal-overlay').remove()">×</button>
                </div>
                <div class="modal-body shortcuts-grid">
                    <div class="shortcut-section">
                        <h3>Navigation</h3>
                        <div class="shortcut-row"><kbd>←</kbd><kbd>→</kbd> Jog X axis</div>
                        <div class="shortcut-row"><kbd>↑</kbd><kbd>↓</kbd> Jog Y axis</div>
                        <div class="shortcut-row"><kbd>PgUp</kbd><kbd>PgDn</kbd> Jog Z axis</div>
                        <div class="shortcut-row"><kbd>Shift</kbd> + arrows = 10x speed</div>
                    </div>
                    <div class="shortcut-section">
                        <h3>Job Control</h3>
                        <div class="shortcut-row"><kbd>Space</kbd> Pause/Resume</div>
                        <div class="shortcut-row"><kbd>Esc</kbd> Stop / Cancel jog</div>
                        <div class="shortcut-row"><kbd>Ctrl+O</kbd> Open G-code file</div>
                    </div>
                    <div class="shortcut-section">
                        <h3>Machine</h3>
                        <div class="shortcut-row"><kbd>H</kbd> Home all axes</div>
                        <div class="shortcut-row"><kbd>U</kbd> Unlock ($X)</div>
                        <div class="shortcut-row"><kbd>0</kbd> Zero all axes</div>
                        <div class="shortcut-row"><kbd>V</kbd> Toggle vacuum</div>
                    </div>
                    <div class="shortcut-section">
                        <h3>View</h3>
                        <div class="shortcut-row"><kbd>?</kbd> Show this help</div>
                        <div class="shortcut-row"><kbd>F</kbd> Fit view to toolpath</div>
                        <div class="shortcut-row"><kbd>T</kbd> Top view</div>
                        <div class="shortcut-row"><kbd>I</kbd> Isometric view</div>
                    </div>
                </div>
                <div class="modal-footer">
                    <button class="btn btn-primary" onclick="this.closest('.modal-overlay').remove()">Got it!</button>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        setTimeout(() => modal.classList.add('active'), 10);
        
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
}

// Initialize app on DOM ready
let app;
let chatterSystem;

document.addEventListener('DOMContentLoaded', () => {
    app = new FluidCNCApp();
    
    // Initialize Chatter Detection System (ESP32)
    // Shows warning if not connected, but FluidCNC still works normally
    if (typeof ChatterDetection !== 'undefined') {
        const savedEspIp = localStorage.getItem('chatterEspIp') || '192.168.1.100';
        
        chatterSystem = new ChatterDetection({
            wsUrl: `ws://${savedEspIp}/ws`,
            onConnect: () => {
                console.log('✓ Chatter detection ESP32 connected');
                app?.showNotification?.('Chatter detection connected', 'success');
            },
            onDisconnect: () => {
                console.log('⚠ Chatter detection ESP32 disconnected - will retry');
                // Don't show error notification on every disconnect, just log it
            },
            onUpdate: (state) => {
                // Optionally integrate with app state
                if (app && state.chatter) {
                    // Could show in status bar, etc.
                }
            },
            onAlert: (alert) => {
                // Show critical alerts in the main notification system
                if (alert.type === 'toolBroken') {
                    app?.showNotification?.(alert.message, 'error');
                } else if (alert.type === 'overload') {
                    app?.showNotification?.(alert.message, 'warning');
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
});

// Export for module usage
if (typeof module !== 'undefined' && module.exports) {
    module.exports = FluidCNCApp;
}
