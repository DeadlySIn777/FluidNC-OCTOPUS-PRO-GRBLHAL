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
            pipPosition: 'bottom-right',
            // Camera source: 'esp32' for ESP32-S3 Sense, 'usb' for USB webcam (Kiyo, etc.)
            cameraSource: localStorage.getItem('cameraSource') || 'auto',
            selectedUSBCamera: localStorage.getItem('selectedUSBCamera') || ''
        };
        
        // State
        this.state = {
            connected: false,
            streaming: false,
            fps: 0,
            audioLevel: 0,
            source: 'none'  // 'esp32', 'usb', or 'none'
        };
        
        // USB Webcam support
        this.usbStream = null;
        this.availableUSBCameras = [];
        
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
        this.state.source = 'none';
        
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
        
        // Also stop USB camera if active
        this.stopUSBCamera();
        
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
                    <button onclick="app.camera.toggleCrosshair()" title="Toggle Crosshair">⊕</button>
                    <button onclick="app.camera.toggleGrid()" title="Toggle Grid">▦</button>
                    <button onclick="app.camera.zoomIn()" title="Zoom In">🔍+</button>
                    <button onclick="app.camera.zoomOut()" title="Zoom Out">🔍-</button>
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
                <div class="camera-crosshair hidden" id="camera-crosshair">
                    <div class="crosshair-h"></div>
                    <div class="crosshair-v"></div>
                    <div class="crosshair-center"></div>
                </div>
                <div class="camera-grid hidden" id="camera-grid">
                    <div class="grid-line h1"></div>
                    <div class="grid-line h2"></div>
                    <div class="grid-line v1"></div>
                    <div class="grid-line v2"></div>
                </div>
                <div class="camera-info-overlay" id="camera-info">
                    <span id="camera-pos-display"></span>
                </div>
            </div>
            <div class="camera-footer">
                <div class="audio-meter-mini">
                    <div class="audio-bar" id="camera-audio-bar"></div>
                </div>
                <span class="camera-zoom-level" id="camera-zoom">1.0x</span>
            </div>
        `;
        
        // Add styles if not already added
        if (!document.getElementById('camera-styles')) {
            this.addCameraStyles();
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
    
    /**
     * Close viewer and stop all streams
     */
    closeViewer() {
        this.stopUSBCamera();
        this.state.streaming = false;
        if (this.viewer) {
            this.viewer.remove();
            this.viewer = null;
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
        
        // Update position display if available
        if (this.app?.dualSerial?.machinePos) {
            const pos = this.app.dualSerial.machinePos;
            const posEl = document.getElementById('camera-pos-display');
            if (posEl) {
                posEl.textContent = `X:${pos.x.toFixed(2)} Y:${pos.y.toFixed(2)} Z:${pos.z.toFixed(2)}`;
            }
        }
    }
    
    // ================================================================
    // OVERLAY CONTROLS
    // ================================================================
    
    toggleCrosshair() {
        const crosshair = document.getElementById('camera-crosshair');
        if (crosshair) {
            crosshair.classList.toggle('hidden');
            this.config.crosshairEnabled = !crosshair.classList.contains('hidden');
            this.saveConfig();
        }
    }
    
    toggleGrid() {
        const grid = document.getElementById('camera-grid');
        if (grid) {
            grid.classList.toggle('hidden');
            this.config.gridEnabled = !grid.classList.contains('hidden');
            this.saveConfig();
        }
    }
    
    zoomIn() {
        this.zoomLevel = Math.min((this.zoomLevel || 1) + 0.25, 4);
        this.applyZoom();
    }
    
    zoomOut() {
        this.zoomLevel = Math.max((this.zoomLevel || 1) - 0.25, 0.5);
        this.applyZoom();
    }
    
    applyZoom() {
        const stream = document.getElementById('camera-stream');
        const usbVideo = document.getElementById('usb-camera-video');
        const zoomDisplay = document.getElementById('camera-zoom');
        
        // Apply zoom to whichever camera is active
        if (stream) {
            stream.style.transform = `scale(${this.zoomLevel})`;
        }
        if (usbVideo) {
            usbVideo.style.transform = `scale(${this.zoomLevel})`;
        }
        if (zoomDisplay) {
            zoomDisplay.textContent = `${this.zoomLevel.toFixed(1)}x`;
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
        // Check if USB camera is active
        const usbVideo = document.getElementById('usb-camera-video');
        if (this.usbStream && usbVideo && usbVideo.srcObject) {
            return this.captureUSBSnapshot(usbVideo);
        }
        
        // ESP32 camera capture
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
    
    /**
     * Capture snapshot from USB webcam using canvas
     */
    captureUSBSnapshot(videoElement) {
        try {
            const canvas = document.createElement('canvas');
            canvas.width = videoElement.videoWidth || 1920;
            canvas.height = videoElement.videoHeight || 1080;
            
            const ctx = canvas.getContext('2d');
            ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);
            
            // Convert to blob and download
            canvas.toBlob((blob) => {
                if (blob) {
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `fluidcnc_usb_${Date.now()}.jpg`;
                    a.click();
                    URL.revokeObjectURL(url);
                    this.app?.showNotification?.('USB snapshot saved', 'success');
                }
            }, 'image/jpeg', 0.95);
            
            return true;
        } catch (e) {
            console.error('USB capture failed:', e);
            this.app?.showNotification?.('USB capture failed', 'error');
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
    // USB WEBCAM SUPPORT (Razer Kiyo, Logitech, etc.)
    // ================================================================
    
    /**
     * Get list of available USB webcams
     */
    async getUSBCameras() {
        if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
            console.warn('[Camera] MediaDevices API not available');
            return [];
        }
        
        try {
            // Need to request permission first to get device labels
            await navigator.mediaDevices.getUserMedia({ video: true }).then(s => s.getTracks().forEach(t => t.stop()));
            
            const devices = await navigator.mediaDevices.enumerateDevices();
            this.availableUSBCameras = devices.filter(d => d.kind === 'videoinput');
            
            console.log('[Camera] Available USB cameras:', this.availableUSBCameras.map(c => c.label));
            return this.availableUSBCameras;
        } catch (e) {
            console.warn('[Camera] Could not enumerate cameras:', e);
            return [];
        }
    }
    
    /**
     * Start USB webcam stream
     */
    async startUSBCamera(deviceId = null) {
        try {
            // Stop any existing streams
            this.stopUSBCamera();
            
            // Build constraints
            const constraints = {
                video: {
                    width: { ideal: 1280 },
                    height: { ideal: 720 },
                    frameRate: { ideal: 30 }
                }
            };
            
            // Use specific device if provided
            if (deviceId) {
                constraints.video.deviceId = { exact: deviceId };
            } else if (this.config.selectedUSBCamera) {
                constraints.video.deviceId = { exact: this.config.selectedUSBCamera };
            }
            
            console.log('[Camera] Starting USB camera with constraints:', constraints);
            
            this.usbStream = await navigator.mediaDevices.getUserMedia(constraints);
            
            // Update state
            this.state.connected = true;
            this.state.streaming = true;
            this.state.source = 'usb';
            
            // Show viewer with USB stream
            this.showUSBViewer();
            
            this.app?.showNotification?.('USB camera connected', 'success');
            
            // Update feature detection
            if (this.app?.detectedFeatures) {
                this.app.detectedFeatures.usbCamera = true;
                this.app.updateFeatureVisibility?.();
            }
            
            return true;
        } catch (e) {
            console.error('[Camera] USB camera error:', e);
            this.app?.showNotification?.(`Camera error: ${e.message}`, 'error');
            return false;
        }
    }
    
    /**
     * Stop USB webcam stream
     */
    stopUSBCamera() {
        if (this.usbStream) {
            this.usbStream.getTracks().forEach(track => track.stop());
            this.usbStream = null;
        }
        
        const video = document.getElementById('usb-camera-video');
        if (video) {
            video.srcObject = null;
        }
        
        if (this.state.source === 'usb') {
            this.state.streaming = false;
            this.state.source = 'none';
        }
    }
    
    /**
     * Show viewer with USB webcam
     */
    showUSBViewer() {
        if (!this.usbStream) return;
        
        if (this.viewer) {
            this.viewer.style.display = 'block';
            // Update existing viewer to use video element
            const content = this.viewer.querySelector('.camera-content');
            if (content) {
                // Replace img with video if needed
                const existingImg = content.querySelector('#camera-stream');
                if (existingImg) {
                    const video = document.createElement('video');
                    video.id = 'usb-camera-video';
                    video.autoplay = true;
                    video.playsInline = true;
                    video.muted = true;
                    video.srcObject = this.usbStream;
                    video.style.cssText = 'width:100%;height:100%;object-fit:contain;';
                    existingImg.style.display = 'none';
                    content.insertBefore(video, existingImg);
                }
            }
            return;
        }
        
        // Create viewer with video element
        this.viewer = document.createElement('div');
        this.viewer.id = 'camera-viewer';
        this.viewer.className = `camera-viewer ${this.config.pipPosition}`;
        this.viewer.innerHTML = `
            <div class="camera-header">
                <span>📹 USB Camera</span>
                <div class="camera-controls-mini">
                    <select id="camera-source-select" onchange="app.camera.switchCameraSource(this.value)" style="font-size:11px;padding:2px;">
                        <option value="usb" selected>USB Webcam</option>
                        <option value="esp32">ESP32 Camera</option>
                    </select>
                    <button onclick="app.camera.toggleCrosshair()" title="Toggle Crosshair">⊕</button>
                    <button onclick="app.camera.toggleGrid()" title="Toggle Grid">▦</button>
                    <button onclick="app.camera.zoomIn()" title="Zoom In">🔍+</button>
                    <button onclick="app.camera.zoomOut()" title="Zoom Out">🔍-</button>
                    <button onclick="app.camera.captureSnapshot()" title="Capture">📷</button>
                    <button onclick="app.camera.toggleFullscreen()" title="Fullscreen">🔲</button>
                    <button onclick="app.camera.hideViewer()" title="Close">×</button>
                </div>
            </div>
            <div class="camera-content">
                <video id="usb-camera-video" autoplay playsinline muted style="width:100%;height:100%;object-fit:contain;"></video>
                <img id="camera-stream" src="" style="display:none;" alt="ESP32 Camera">
                <div class="camera-crosshair hidden" id="camera-crosshair">
                    <div class="crosshair-h"></div>
                    <div class="crosshair-v"></div>
                    <div class="crosshair-center"></div>
                </div>
                <div class="camera-grid hidden" id="camera-grid">
                    <div class="grid-line h1"></div>
                    <div class="grid-line h2"></div>
                    <div class="grid-line v1"></div>
                    <div class="grid-line v2"></div>
                </div>
                <div class="camera-info-overlay" id="camera-info">
                    <span id="camera-pos-display"></span>
                </div>
            </div>
            <div class="camera-footer">
                <span class="camera-zoom-level" id="camera-zoom">1.0x</span>
            </div>
        `;
        
        // Add styles if not present
        if (!document.getElementById('camera-styles')) {
            this.addCameraStyles();
        }
        
        document.body.appendChild(this.viewer);
        this.makeDraggable(this.viewer);
        
        // Set video stream
        const video = document.getElementById('usb-camera-video');
        if (video) {
            video.srcObject = this.usbStream;
        }
    }
    
    /**
     * Switch between USB webcam and ESP32 camera
     */
    async switchCameraSource(source) {
        this.config.cameraSource = source;
        localStorage.setItem('cameraSource', source);
        
        if (source === 'usb') {
            // Stop ESP32 stream
            this.state.streaming = false;
            
            // Start USB camera
            await this.startUSBCamera();
            
            // Update viewer
            const video = document.getElementById('usb-camera-video');
            const img = document.getElementById('camera-stream');
            const header = this.viewer?.querySelector('.camera-header span');
            
            if (video) video.style.display = '';
            if (img) img.style.display = 'none';
            if (header) header.textContent = '📹 USB Camera';
            
        } else {
            // Stop USB camera
            this.stopUSBCamera();
            
            // Start ESP32 stream
            this.state.source = 'esp32';
            this.state.streaming = true;
            
            // Update viewer
            const video = document.getElementById('usb-camera-video');
            const img = document.getElementById('camera-stream');
            const header = this.viewer?.querySelector('.camera-header span');
            
            if (video) video.style.display = 'none';
            if (img) {
                img.style.display = '';
                img.src = this.getStreamUrl();
            }
            if (header) header.textContent = '📹 Machine Camera';
        }
        
        // Update dropdown
        const select = document.getElementById('camera-source-select');
        if (select) select.value = source;
    }
    
    /**
     * Auto-detect and use best available camera
     */
    async autoSelectCamera() {
        // Check for USB cameras first
        const usbCameras = await this.getUSBCameras();
        
        if (this.config.cameraSource === 'auto') {
            // Try ESP32 first (preferred for CNC as it's mounted on machine)
            const esp32Available = await this.connect();
            if (esp32Available) {
                this.state.source = 'esp32';
                return 'esp32';
            }
            
            // Fall back to USB camera
            if (usbCameras.length > 0) {
                await this.startUSBCamera();
                return 'usb';
            }
        } else if (this.config.cameraSource === 'usb' && usbCameras.length > 0) {
            await this.startUSBCamera();
            return 'usb';
        } else {
            await this.connect();
            return 'esp32';
        }
        
        return 'none';
    }
    
    /**
     * Add camera-specific styles
     */
    addCameraStyles() {
        const style = document.createElement('style');
        style.id = 'camera-styles';
        style.textContent = this.getCameraStyles();
        document.head.appendChild(style);
    }
    
    /**
     * Get camera CSS styles
     */
    getCameraStyles() {
        return `
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
            .camera-viewer.bottom-right { bottom: 80px; right: 20px; width: 320px; height: 260px; }
            .camera-viewer.bottom-left { bottom: 80px; left: 80px; width: 320px; height: 260px; }
            .camera-viewer.top-right { top: 70px; right: 20px; width: 320px; height: 260px; }
            .camera-viewer.fullscreen {
                top: 60px !important; left: 80px !important; right: 20px !important; bottom: 60px !important;
                width: auto !important; height: auto !important;
            }
            .camera-header {
                display: flex; justify-content: space-between; align-items: center;
                padding: 8px 10px; background: var(--bg-tertiary, #252525);
                border-bottom: 1px solid var(--border-color, #333);
                cursor: move; font-size: 12px; font-weight: bold;
            }
            .camera-controls-mini { display: flex; gap: 4px; align-items: center; }
            .camera-controls-mini button, .camera-controls-mini select {
                background: var(--bg-secondary, #1e1e1e); border: 1px solid var(--border-color, #333);
                color: var(--text-primary, #eee); border-radius: 4px; padding: 2px 6px;
                cursor: pointer; font-size: 11px;
            }
            .camera-controls-mini button:hover { background: var(--accent-color, #00d4ff); color: #000; }
            .camera-content { position: relative; width: 100%; height: calc(100% - 60px); overflow: hidden; background: #000; }
            #camera-stream, #usb-camera-video { width: 100%; height: 100%; object-fit: contain; transition: transform 0.2s ease; transform-origin: center center; }
            .camera-footer { display: flex; justify-content: space-between; align-items: center; padding: 4px 10px; background: var(--bg-tertiary, #252525); }
            .camera-fps { font-size: 10px; color: #888; }
            .camera-zoom-level { font-size: 10px; color: #888; font-family: monospace; }
            .camera-crosshair { position: absolute; top: 0; left: 0; right: 0; bottom: 0; pointer-events: none; }
            .camera-crosshair.hidden { display: none; }
            .crosshair-h { position: absolute; left: 0; right: 0; top: 50%; height: 1px; background: rgba(255, 0, 0, 0.7); }
            .crosshair-v { position: absolute; top: 0; bottom: 0; left: 50%; width: 1px; background: rgba(255, 0, 0, 0.7); }
            .crosshair-center { position: absolute; top: 50%; left: 50%; width: 20px; height: 20px; border: 2px solid rgba(255, 0, 0, 0.8); border-radius: 50%; transform: translate(-50%, -50%); }
            .camera-grid { position: absolute; top: 0; left: 0; right: 0; bottom: 0; pointer-events: none; }
            .camera-grid.hidden { display: none; }
            .grid-line { position: absolute; background: rgba(0, 200, 255, 0.3); }
            .grid-line.h1 { left: 0; right: 0; top: 33.33%; height: 1px; }
            .grid-line.h2 { left: 0; right: 0; top: 66.66%; height: 1px; }
            .grid-line.v1 { top: 0; bottom: 0; left: 33.33%; width: 1px; }
            .grid-line.v2 { top: 0; bottom: 0; left: 66.66%; width: 1px; }
            .camera-info-overlay { position: absolute; bottom: 8px; left: 8px; background: rgba(0, 0, 0, 0.6); padding: 4px 8px; border-radius: 4px; font-size: 11px; font-family: monospace; color: #00ff88; }
        `;
    }
    
    // ================================================================
    // CONFIGURATION UI
    // ================================================================
    
    createConfigUI() {
        return `
            <div class="camera-config">
                <h4>📹 Camera Configuration</h4>
                
                <div class="config-section">
                    <h5>Camera Source</h5>
                    <div class="input-row">
                        <label>Source:</label>
                        <select id="cam-source" onchange="app.camera.switchCameraSource(this.value)">
                            <option value="auto" ${this.config.cameraSource === 'auto' ? 'selected' : ''}>Auto-detect</option>
                            <option value="esp32" ${this.config.cameraSource === 'esp32' ? 'selected' : ''}>ESP32-S3 Camera</option>
                            <option value="usb" ${this.config.cameraSource === 'usb' ? 'selected' : ''}>USB Webcam</option>
                        </select>
                    </div>
                    
                    <div class="input-row" id="usb-camera-row" style="${this.config.cameraSource !== 'usb' ? 'display:none' : ''}">
                        <label>USB Camera:</label>
                        <select id="usb-camera-select" onchange="app.camera.selectUSBCamera(this.value)">
                            <option value="">-- Select Camera --</option>
                        </select>
                        <button onclick="app.camera.refreshUSBCameras()" class="btn btn-sm">🔄</button>
                    </div>
                </div>
                
                <div class="config-section">
                    <h5>ESP32 Camera</h5>
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
    
    /**
     * Refresh USB camera list
     */
    async refreshUSBCameras() {
        const cameras = await this.getUSBCameras();
        const select = document.getElementById('usb-camera-select');
        
        if (select) {
            select.innerHTML = '<option value="">-- Select Camera --</option>';
            cameras.forEach(cam => {
                const option = document.createElement('option');
                option.value = cam.deviceId;
                option.textContent = cam.label || `Camera ${cameras.indexOf(cam) + 1}`;
                if (cam.deviceId === this.config.selectedUSBCamera) {
                    option.selected = true;
                }
                select.appendChild(option);
            });
        }
        
        return cameras;
    }
    
    /**
     * Select a specific USB camera
     */
    selectUSBCamera(deviceId) {
        this.config.selectedUSBCamera = deviceId;
        localStorage.setItem('selectedUSBCamera', deviceId);
        
        // Restart stream with new camera if currently using USB
        if (this.state.source === 'usb' && deviceId) {
            this.startUSBCamera(deviceId);
        }
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
