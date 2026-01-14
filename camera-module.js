// Seeed XIAO ESP32-S3 Sense Camera Integration
// Connects to the camera module for machine monitoring
// 
// HARDWARE: Seeed Studio XIAO ESP32S3 Sense (~$15)
//   - OV3660 camera sensor (2048x1536 resolution)
//   - Digital microphone (audio monitoring)
//   - 8MB PSRAM, 8MB Flash
//   - SD card slot (recording)
//   - USB Type-C for power
//   - WiFi for video streaming
//   - Tiny form factor (21 x 17.8mm)
//
// ╔═══════════════════════════════════════════════════════════════════════╗
// ║  PLUG & PLAY SETUP                                                    ║
// ╠═══════════════════════════════════════════════════════════════════════╣
// ║  1. Plug XIAO camera into USB hub (for power)                         ║
// ║  2. Camera auto-creates WiFi: "FluidCNC-Camera" (pass: fluidcnc123)   ║
// ║  3. Connect phone/PC to that WiFi network                             ║
// ║  4. Open http://192.168.4.1 to see live video!                        ║
// ║                                                                       ║
// ║  Or click "Camera" button in FluidCNC to open popup viewer            ║
// ╚═══════════════════════════════════════════════════════════════════════╝
//
// CONNECTION: Camera creates its own WiFi AP for video streaming
// (video is too bandwidth-heavy for USB serial, so WiFi is used)
// USB is only for power - no configuration needed!

class CameraModule {
    constructor(app) {
        this.app = app;
        
        // Configuration
        // Default to camera's AP mode IP (192.168.4.1)
        // This works when PC is connected to "FluidCNC-Camera" WiFi
        this.config = {
            ip: localStorage.getItem('esp32CameraIp') || '192.168.4.1',  // Camera AP IP
            apIp: '192.168.4.1',      // Camera's own AP (always available)
            autoConnect: false,       // Don't auto-connect - user opens camera when needed
            showOnStartup: false,
            pipEnabled: true,         // Picture-in-picture mode
            pipPosition: 'bottom-right'
        };
        
        // State
        this.state = {
            connected: false,
            streaming: false,
            fps: 0,
            audioLevel: 0
        };
        
        this.ws = null;
        this.viewer = null;
        this.connectionAttempts = 0;
        this.maxConnectionAttempts = 3;
        
        this.loadConfig();
        this.init();
    }
    
    /**
     * Set camera IP and save to localStorage
     */
    setIp(ip) {
        this.config.ip = ip;
        localStorage.setItem('esp32CameraIp', ip);
        this.saveConfig();
        console.log(`[Camera] IP set to ${ip}`);
    }
    
    /**
     * Derive camera IP from grblHAL controller IP (same subnet)
     */
    deriveFromGrblIp(grblIp) {
        if (!grblIp) return;
        const parts = grblIp.split('.');
        if (parts.length === 4) {
            const cameraHost = parseInt(localStorage.getItem('esp32CameraHost') || '101');
            const derivedIp = `${parts[0]}.${parts[1]}.${parts[2]}.${cameraHost}`;
            this.setIp(derivedIp);
            console.log(`[Camera] Derived IP from grblHAL (${grblIp}): ${derivedIp}`);
            return derivedIp;
        }
        return null;
    }
    
    loadConfig() {
        try {
            const saved = localStorage.getItem('fluidcnc_camera');
            if (saved) Object.assign(this.config, JSON.parse(saved));
        } catch (e) {}
    }
    
    saveConfig() {
        try {
            localStorage.setItem('fluidcnc_camera', JSON.stringify(this.config));
        } catch (e) {}
    }
    
    init() {
        if (this.config.autoConnect) {
            this.connect();
        }
        console.log('📹 Camera module initialized');
    }
    
    // ================================================================
    // CONNECTION
    // ================================================================
    
    async connect() {
        this.connectionAttempts++;
        
        try {
            // Check if camera is reachable with timeout
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 3000);
            
            const statusUrl = `http://${this.config.ip}/status`;
            const response = await fetch(statusUrl, { 
                signal: controller.signal, 
                mode: 'cors'
            });
            
            clearTimeout(timeoutId);
            
            if (response.ok) {
                const status = await response.json();
                this.state.connected = true;
                this.connectionAttempts = 0;  // Reset on success
                console.log('📹 Camera connected:', status);
                
                // Connect WebSocket for real-time updates
                this.connectWebSocket();
                
                this.app?.showNotification?.('Camera connected', 'success');
                return true;
            }
        } catch (e) {
            if (this.connectionAttempts < this.maxConnectionAttempts) {
                console.warn(`Camera connection attempt ${this.connectionAttempts} failed:`, e.message);
            } else {
                console.warn(`Camera at ${this.config.ip} not available (this is optional hardware)`);
            }
            this.state.connected = false;
        }
        
        return false;
    }
    
    connectWebSocket() {
        if (this.ws) {
            this.ws.close();
        }
        
        try {
            this.ws = new WebSocket(`ws://${this.config.ip}/ws`);
            
            this.ws.onopen = () => {
                console.log('📹 Camera WebSocket connected');
            };
            
            this.ws.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    this.state.fps = data.fps || 0;
                    this.state.audioLevel = data.audioLevel || 0;
                    this.updateUI(data);
                } catch (e) {}
            };
            
            this.ws.onclose = () => {
                console.log('📹 Camera WebSocket closed');
                // Reconnect after delay
                setTimeout(() => {
                    if (this.state.connected) {
                        this.connectWebSocket();
                    }
                }, 5000);
            };
            
            this.ws.onerror = (e) => {
                console.warn('Camera WebSocket error:', e);
            };
            
        } catch (e) {
            console.warn('Camera WebSocket failed:', e);
        }
    }
    
    disconnect() {
        this.state.connected = false;
        this.state.streaming = false;
        
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
        
        this.hideViewer();
    }
    
    // ================================================================
    // STREAMING
    // ================================================================
    
    getStreamUrl() {
        return `http://${this.config.ip}/stream`;
    }
    
    getCaptureUrl() {
        return `http://${this.config.ip}/capture`;
    }
    
    startStream() {
        if (!this.state.connected) {
            this.app?.showNotification?.('Camera not connected', 'error');
            return;
        }
        
        this.state.streaming = true;
        this.showViewer();
    }
    
    stopStream() {
        this.state.streaming = false;
        this.hideViewer();
    }
    
    toggleStream() {
        if (this.state.streaming) {
            this.stopStream();
        } else {
            this.startStream();
        }
    }
    
    // ================================================================
    // VIEWER UI
    // ================================================================
    
    showViewer() {
        if (this.viewer) {
            this.viewer.style.display = 'block';
            return;
        }
        
        // Create floating viewer
        this.viewer = document.createElement('div');
        this.viewer.id = 'camera-viewer';
        this.viewer.className = `camera-viewer ${this.config.pipPosition}`;
        this.viewer.innerHTML = `
            <div class="camera-header">
                <span>📹 Machine Camera</span>
                <div class="camera-controls-mini">
                    <span class="camera-fps">${this.state.fps.toFixed(1)} FPS</span>
                    <button onclick="app.camera.captureSnapshot()" title="Capture">📷</button>
                    <button onclick="app.camera.toggleFullscreen()" title="Fullscreen">🔲</button>
                    <button onclick="app.camera.hideViewer()" title="Close">×</button>
                </div>
            </div>
            <div class="camera-content">
                <img id="camera-stream" 
                     src="${this.getStreamUrl()}" 
                     alt="Camera Stream"
                     onerror="this.alt='Camera Offline'">
                <div class="camera-overlay">
                    <div class="audio-indicator" id="camera-audio-indicator"></div>
                </div>
            </div>
            <div class="camera-footer">
                <div class="audio-meter-mini">
                    <div class="audio-bar" id="camera-audio-bar"></div>
                </div>
            </div>
        `;
        
        // Add styles if not already added
        if (!document.getElementById('camera-styles')) {
            const style = document.createElement('style');
            style.id = 'camera-styles';
            style.textContent = `
                .camera-viewer {
                    position: fixed;
                    background: var(--bg-secondary, #1e1e1e);
                    border: 1px solid var(--border-color, #333);
                    border-radius: 8px;
                    box-shadow: 0 4px 20px rgba(0,0,0,0.5);
                    z-index: 999;
                    overflow: hidden;
                    resize: both;
                    min-width: 200px;
                    min-height: 150px;
                }
                .camera-viewer.bottom-right {
                    bottom: 80px;
                    right: 20px;
                    width: 320px;
                    height: 260px;
                }
                .camera-viewer.bottom-left {
                    bottom: 80px;
                    left: 80px;
                    width: 320px;
                    height: 260px;
                }
                .camera-viewer.top-right {
                    top: 70px;
                    right: 20px;
                    width: 320px;
                    height: 260px;
                }
                .camera-viewer.fullscreen {
                    top: 60px !important;
                    left: 80px !important;
                    right: 20px !important;
                    bottom: 60px !important;
                    width: auto !important;
                    height: auto !important;
                }
                .camera-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    padding: 6px 10px;
                    background: var(--bg-tertiary, #252525);
                    font-size: 12px;
                    cursor: move;
                }
                .camera-controls-mini {
                    display: flex;
                    align-items: center;
                    gap: 6px;
                }
                .camera-controls-mini button {
                    background: none;
                    border: none;
                    color: #fff;
                    cursor: pointer;
                    padding: 2px;
                    font-size: 14px;
                    opacity: 0.7;
                }
                .camera-controls-mini button:hover {
                    opacity: 1;
                }
                .camera-fps {
                    font-size: 10px;
                    color: #888;
                }
                .camera-content {
                    position: relative;
                    height: calc(100% - 56px);
                    background: #000;
                }
                #camera-stream {
                    width: 100%;
                    height: 100%;
                    object-fit: contain;
                }
                .camera-overlay {
                    position: absolute;
                    top: 0;
                    right: 0;
                    padding: 8px;
                }
                .audio-indicator {
                    width: 12px;
                    height: 12px;
                    border-radius: 50%;
                    background: #333;
                    transition: background 0.1s;
                }
                .audio-indicator.active {
                    background: #4caf50;
                    box-shadow: 0 0 8px #4caf50;
                }
                .audio-indicator.loud {
                    background: #ff9800;
                    box-shadow: 0 0 8px #ff9800;
                }
                .camera-footer {
                    padding: 4px 10px;
                    background: var(--bg-tertiary, #252525);
                }
                .audio-meter-mini {
                    height: 4px;
                    background: #222;
                    border-radius: 2px;
                    overflow: hidden;
                }
                .audio-bar {
                    height: 100%;
                    background: linear-gradient(90deg, #4caf50, #ff9800, #f44336);
                    width: 0%;
                    transition: width 0.1s;
                }
            `;
            document.head.appendChild(style);
        }
        
        document.body.appendChild(this.viewer);
        
        // Make draggable
        this.makeDraggable(this.viewer);
    }
    
    hideViewer() {
        if (this.viewer) {
            this.viewer.style.display = 'none';
        }
    }
    
    toggleFullscreen() {
        if (!this.viewer) return;
        this.viewer.classList.toggle('fullscreen');
    }
    
    updateUI(data) {
        // Update FPS display
        const fpsEl = this.viewer?.querySelector('.camera-fps');
        if (fpsEl) {
            fpsEl.textContent = `${(data.fps || 0).toFixed(1)} FPS`;
        }
        
        // Update audio indicator
        const audioIndicator = document.getElementById('camera-audio-indicator');
        if (audioIndicator) {
            audioIndicator.classList.remove('active', 'loud');
            if (data.audioLevel > 0.3) {
                audioIndicator.classList.add('loud');
            } else if (data.audioLevel > 0.05) {
                audioIndicator.classList.add('active');
            }
        }
        
        // Update audio bar
        const audioBar = document.getElementById('camera-audio-bar');
        if (audioBar) {
            const pct = Math.min(100, (data.audioLevel || 0) * 200);
            audioBar.style.width = pct + '%';
        }
    }
    
    makeDraggable(element) {
        const header = element.querySelector('.camera-header');
        if (!header) return;
        
        let isDragging = false;
        let startX, startY, startLeft, startTop;
        
        header.addEventListener('mousedown', (e) => {
            isDragging = true;
            startX = e.clientX;
            startY = e.clientY;
            const rect = element.getBoundingClientRect();
            startLeft = rect.left;
            startTop = rect.top;
            element.style.position = 'fixed';
            element.classList.remove('bottom-right', 'bottom-left', 'top-right');
        });
        
        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            const dx = e.clientX - startX;
            const dy = e.clientY - startY;
            element.style.left = (startLeft + dx) + 'px';
            element.style.top = (startTop + dy) + 'px';
            element.style.right = 'auto';
            element.style.bottom = 'auto';
        });
        
        document.addEventListener('mouseup', () => {
            isDragging = false;
        });
    }
    
    // ================================================================
    // CAPTURE
    // ================================================================
    
    async captureSnapshot() {
        if (!this.state.connected) {
            this.app?.showNotification?.('Camera not connected', 'error');
            return null;
        }
        
        try {
            const response = await fetch(this.getCaptureUrl());
            const blob = await response.blob();
            
            // Create download link
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `fluidcnc_${Date.now()}.jpg`;
            a.click();
            URL.revokeObjectURL(url);
            
            this.app?.showNotification?.('Snapshot saved', 'success');
            return blob;
            
        } catch (e) {
            console.error('Capture failed:', e);
            this.app?.showNotification?.('Capture failed', 'error');
            return null;
        }
    }
    
    // ================================================================
    // CAMERA CONTROLS
    // ================================================================
    
    async setResolution(resolution) {
        try {
            await fetch(`http://${this.config.ip}/control?resolution=${resolution}`);
        } catch (e) {
            console.warn('Set resolution failed:', e);
        }
    }
    
    async setQuality(quality) {
        try {
            await fetch(`http://${this.config.ip}/control?quality=${quality}`);
        } catch (e) {
            console.warn('Set quality failed:', e);
        }
    }
    
    async toggleAudioForward(enable) {
        try {
            await fetch(`http://${this.config.ip}/control?audioForward=${enable ? '1' : '0'}`);
        } catch (e) {
            console.warn('Toggle audio forward failed:', e);
        }
    }
    
    // ================================================================
    // CONFIGURATION UI
    // ================================================================
    
    createConfigUI() {
        return `
            <div class="camera-config">
                <h4>📹 Camera Configuration</h4>
                
                <div class="config-section">
                    <div class="input-row">
                        <label>Camera IP:</label>
                        <input type="text" id="cam-ip" value="${this.config.ip}">
                        <button onclick="app.camera.connect()" class="btn btn-sm">Connect</button>
                    </div>
                    
                    <div class="stat-row">
                        <span>Status:</span>
                        <span class="${this.state.connected ? 'text-green' : 'text-red'}">
                            ${this.state.connected ? 'Connected' : 'Disconnected'}
                        </span>
                    </div>
                </div>
                
                <div class="config-section">
                    <h5>Display Options</h5>
                    <div class="input-row">
                        <label>PIP Position:</label>
                        <select id="cam-pip-pos" onchange="app.camera.setPipPosition(this.value)">
                            <option value="bottom-right" ${this.config.pipPosition === 'bottom-right' ? 'selected' : ''}>Bottom Right</option>
                            <option value="bottom-left" ${this.config.pipPosition === 'bottom-left' ? 'selected' : ''}>Bottom Left</option>
                            <option value="top-right" ${this.config.pipPosition === 'top-right' ? 'selected' : ''}>Top Right</option>
                        </select>
                    </div>
                    <label class="toggle-row">
                        <input type="checkbox" ${this.config.autoConnect ? 'checked' : ''} 
                               onchange="app.camera.setAutoConnect(this.checked)">
                        <span>Auto-connect on startup</span>
                    </label>
                </div>
                
                <div class="config-section">
                    <h5>Quick Actions</h5>
                    <button onclick="app.camera.toggleStream()" class="btn">
                        ${this.state.streaming ? '⏹️ Stop Stream' : '▶️ Start Stream'}
                    </button>
                    <button onclick="app.camera.captureSnapshot()" class="btn">
                        📷 Capture Snapshot
                    </button>
                </div>
            </div>
        `;
    }
    
    setPipPosition(position) {
        this.config.pipPosition = position;
        this.saveConfig();
        
        if (this.viewer) {
            this.viewer.className = `camera-viewer ${position}`;
        }
    }
    
    setAutoConnect(enabled) {
        this.config.autoConnect = enabled;
        this.saveConfig();
    }
    
    updateConfigFromUI() {
        const ipEl = document.getElementById('cam-ip');
        if (ipEl) {
            this.config.ip = ipEl.value;
            this.saveConfig();
        }
    }
}

// Export
if (typeof module !== 'undefined') {
    module.exports = CameraModule;
}

// Note: Initialized by app.js after FluidCNCApp creation
