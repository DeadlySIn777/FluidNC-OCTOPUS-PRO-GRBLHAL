/**
 * SD Card Manager for FluidCNC
 * Upload, browse, preview, and run G-code from SD card
 * Safe autonomous operation - no streaming required
 */
class SDCardManager {
    constructor(options = {}) {
        this.grbl = null;
        this.files = [];
        this.currentPath = '/';
        this.selectedFile = null;
        this.previewContent = null;
        this.isUploading = false;
        this.uploadProgress = 0;
        
        // Callbacks
        this.onFileSelect = options.onFileSelect || null;
        this.onPreviewReady = options.onPreviewReady || null;
        this.onUploadComplete = options.onUploadComplete || null;
        
        this.init();
    }
    
    init() {
        this.createUI();
        this.bindEvents();
    }
    
    setGrbl(grbl) {
        this.grbl = grbl;
        
        // Listen for SD card responses
        this.grbl.on('message', (msg) => this.handleMessage(msg));
        
        // Auto-refresh on connect
        this.grbl.on('connected', () => {
            setTimeout(() => this.refresh(), 500);
        });
    }
    
    createUI() {
        // Check if panel already exists
        if (document.getElementById('sd-card-panel')) return;
        
        // Find the files section or create one
        const controlsGrid = document.querySelector('.controls-grid');
        if (!controlsGrid) return;
        
        // Create SD Card panel
        const panel = document.createElement('div');
        panel.className = 'control-panel sd-card-panel';
        panel.id = 'sd-card-panel';
        panel.innerHTML = `
            <h3>
                <span class="panel-icon">💾</span>
                SD Card
                <span class="sd-status" id="sd-status">Not mounted</span>
            </h3>
            
            <div class="sd-toolbar">
                <button class="btn btn-sm" id="sd-refresh" title="Refresh file list">
                    🔄 Refresh
                </button>
                <button class="btn btn-sm" id="sd-mount" title="Mount/unmount SD card">
                    📁 Mount
                </button>
                <span class="sd-path" id="sd-path">/</span>
            </div>
            
            <div class="sd-drop-zone" id="sd-drop-zone">
                <div class="drop-icon">📤</div>
                <div class="drop-text">Drag & drop G-code files here to upload</div>
                <div class="drop-hint">or click to browse</div>
                <input type="file" id="sd-file-input" accept=".nc,.gcode,.ngc,.tap,.txt" multiple hidden>
            </div>
            
            <div class="sd-upload-progress" id="sd-upload-progress" style="display: none;">
                <div class="progress-bar">
                    <div class="progress-fill" id="sd-progress-fill"></div>
                </div>
                <span class="progress-text" id="sd-progress-text">Uploading... 0%</span>
            </div>
            
            <div class="sd-file-list" id="sd-file-list">
                <div class="sd-empty">Click "Refresh" to load files</div>
            </div>
            
            <div class="sd-preview-section" id="sd-preview-section" style="display: none;">
                <h4>
                    <span id="sd-preview-filename">file.nc</span>
                    <button class="btn btn-sm btn-close" id="sd-preview-close">✕</button>
                </h4>
                <div class="sd-preview-stats" id="sd-preview-stats"></div>
                <div class="sd-preview-code" id="sd-preview-code"></div>
                <div class="sd-preview-actions">
                    <button class="btn btn-success" id="sd-run-file">
                        ▶️ Run from SD
                    </button>
                    <button class="btn btn-secondary" id="sd-load-stream">
                        📡 Load for Streaming
                    </button>
                    <button class="btn btn-danger" id="sd-delete-file">
                        🗑️ Delete
                    </button>
                </div>
            </div>
        `;
        
        // Insert after the G-code panel or at the end
        const gcodePanel = document.querySelector('.gcode-panel');
        if (gcodePanel && gcodePanel.nextSibling) {
            controlsGrid.insertBefore(panel, gcodePanel.nextSibling);
        } else {
            controlsGrid.appendChild(panel);
        }
        
        // Add styles
        this.addStyles();
    }
    
    addStyles() {
        if (document.getElementById('sd-card-styles')) return;
        
        const style = document.createElement('style');
        style.id = 'sd-card-styles';
        style.textContent = `
            .sd-card-panel {
                grid-column: span 1;
            }
            
            .sd-card-panel h3 {
                display: flex;
                align-items: center;
                gap: 8px;
            }
            
            .sd-status {
                margin-left: auto;
                font-size: 0.75em;
                padding: 2px 8px;
                border-radius: 10px;
                background: var(--bg-tertiary, #2a2a3a);
                color: var(--color-warning, #ffaa00);
            }
            
            .sd-status.mounted {
                background: rgba(0, 255, 136, 0.2);
                color: var(--color-success, #00ff88);
            }
            
            .sd-toolbar {
                display: flex;
                gap: 8px;
                margin-bottom: 12px;
                align-items: center;
            }
            
            .sd-path {
                margin-left: auto;
                font-family: monospace;
                font-size: 0.85em;
                color: var(--text-secondary, #888);
            }
            
            .sd-drop-zone {
                border: 2px dashed var(--border-color, #444);
                border-radius: 8px;
                padding: 24px;
                text-align: center;
                cursor: pointer;
                transition: all 0.2s;
                margin-bottom: 12px;
            }
            
            .sd-drop-zone:hover,
            .sd-drop-zone.drag-over {
                border-color: var(--accent-primary, #00d4ff);
                background: rgba(0, 212, 255, 0.1);
            }
            
            .sd-drop-zone .drop-icon {
                font-size: 2em;
                margin-bottom: 8px;
            }
            
            .sd-drop-zone .drop-text {
                font-weight: 500;
                margin-bottom: 4px;
            }
            
            .sd-drop-zone .drop-hint {
                font-size: 0.85em;
                color: var(--text-secondary, #888);
            }
            
            .sd-upload-progress {
                margin-bottom: 12px;
            }
            
            .sd-upload-progress .progress-bar {
                height: 8px;
                background: var(--bg-tertiary, #2a2a3a);
                border-radius: 4px;
                overflow: hidden;
                margin-bottom: 4px;
            }
            
            .sd-upload-progress .progress-fill {
                height: 100%;
                background: var(--accent-primary, #00d4ff);
                width: 0%;
                transition: width 0.2s;
            }
            
            .sd-upload-progress .progress-text {
                font-size: 0.85em;
                color: var(--text-secondary, #888);
            }
            
            .sd-file-list {
                max-height: 200px;
                overflow-y: auto;
                border: 1px solid var(--border-color, #333);
                border-radius: 6px;
                margin-bottom: 12px;
            }
            
            .sd-empty {
                padding: 20px;
                text-align: center;
                color: var(--text-secondary, #888);
            }
            
            .sd-file-item {
                display: flex;
                align-items: center;
                padding: 8px 12px;
                border-bottom: 1px solid var(--border-color, #333);
                cursor: pointer;
                transition: background 0.15s;
            }
            
            .sd-file-item:last-child {
                border-bottom: none;
            }
            
            .sd-file-item:hover {
                background: var(--bg-tertiary, #2a2a3a);
            }
            
            .sd-file-item.selected {
                background: rgba(0, 212, 255, 0.15);
                border-left: 3px solid var(--accent-primary, #00d4ff);
            }
            
            .sd-file-item.directory {
                color: var(--accent-secondary, #00ff88);
            }
            
            .sd-file-icon {
                margin-right: 8px;
                font-size: 1.1em;
            }
            
            .sd-file-name {
                flex: 1;
                font-family: monospace;
                font-size: 0.9em;
            }
            
            .sd-file-size {
                font-size: 0.8em;
                color: var(--text-secondary, #888);
            }
            
            .sd-preview-section {
                border: 1px solid var(--border-color, #333);
                border-radius: 6px;
                padding: 12px;
                background: var(--bg-tertiary, #1a1a24);
            }
            
            .sd-preview-section h4 {
                display: flex;
                align-items: center;
                margin: 0 0 8px 0;
                font-size: 0.95em;
            }
            
            .sd-preview-section h4 .btn-close {
                margin-left: auto;
                padding: 2px 8px;
            }
            
            .sd-preview-stats {
                display: flex;
                gap: 16px;
                margin-bottom: 8px;
                font-size: 0.85em;
                color: var(--text-secondary, #888);
            }
            
            .sd-preview-stats span {
                display: flex;
                align-items: center;
                gap: 4px;
            }
            
            .sd-preview-code {
                max-height: 150px;
                overflow-y: auto;
                background: var(--bg-darkest, #0a0a0f);
                border-radius: 4px;
                padding: 8px;
                font-family: monospace;
                font-size: 0.8em;
                white-space: pre;
                margin-bottom: 12px;
            }
            
            .sd-preview-actions {
                display: flex;
                gap: 8px;
                flex-wrap: wrap;
            }
            
            .sd-preview-actions .btn {
                flex: 1;
                min-width: 120px;
            }
            
            .btn-sm {
                padding: 4px 10px;
                font-size: 0.85em;
            }
        `;
        document.head.appendChild(style);
    }
    
    bindEvents() {
        // Wait for DOM
        setTimeout(() => {
            const dropZone = document.getElementById('sd-drop-zone');
            const fileInput = document.getElementById('sd-file-input');
            const refreshBtn = document.getElementById('sd-refresh');
            const mountBtn = document.getElementById('sd-mount');
            const fileList = document.getElementById('sd-file-list');
            const previewClose = document.getElementById('sd-preview-close');
            const runBtn = document.getElementById('sd-run-file');
            const loadBtn = document.getElementById('sd-load-stream');
            const deleteBtn = document.getElementById('sd-delete-file');
            
            if (dropZone) {
                dropZone.addEventListener('click', () => fileInput?.click());
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
                    const files = e.dataTransfer.files;
                    if (files.length > 0) {
                        this.uploadFiles(files);
                    }
                });
            }
            
            if (fileInput) {
                fileInput.addEventListener('change', (e) => {
                    if (e.target.files.length > 0) {
                        this.uploadFiles(e.target.files);
                    }
                });
            }
            
            if (refreshBtn) {
                refreshBtn.addEventListener('click', () => this.refresh());
            }
            
            if (mountBtn) {
                mountBtn.addEventListener('click', () => this.mount());
            }
            
            if (previewClose) {
                previewClose.addEventListener('click', () => this.closePreview());
            }
            
            if (runBtn) {
                runBtn.addEventListener('click', () => this.runFromSD());
            }
            
            if (loadBtn) {
                loadBtn.addEventListener('click', () => this.loadForStreaming());
            }
            
            if (deleteBtn) {
                deleteBtn.addEventListener('click', () => this.deleteFile());
            }
        }, 100);
    }
    
    async mount() {
        if (!this.grbl) {
            this.showNotification('Not connected', 'error');
            return;
        }
        
        try {
            await this.grbl.sendAndWait('$FM');
            this.updateStatus('Mounted', true);
            await this.refresh();
        } catch (e) {
            this.showNotification('Failed to mount SD card', 'error');
        }
    }
    
    async refresh() {
        if (!this.grbl) {
            this.showNotification('Not connected', 'error');
            return;
        }
        
        const fileList = document.getElementById('sd-file-list');
        if (fileList) {
            fileList.innerHTML = '<div class="sd-empty">Loading...</div>';
        }
        
        this.files = [];
        
        try {
            // Mount first
            await this.grbl.sendAndWait('$FM');
            this.updateStatus('Mounted', true);
            
            // Request file list
            // grblHAL uses $F for SD card file list
            this.grbl.send('$F');
            
            // Files come as [FILE: ...] messages, handled in handleMessage
            // Give it time to receive all files
            setTimeout(() => this.renderFileList(), 500);
        } catch (e) {
            if (fileList) {
                fileList.innerHTML = '<div class="sd-empty">Failed to read SD card</div>';
            }
            this.updateStatus('Error', false);
        }
    }
    
    handleMessage(msg) {
        // Parse file listing responses
        // grblHAL format: [FILE:/path/file.nc|SIZE:12345]
        const fileMatch = msg.match(/\[FILE:([^\|]+)\|SIZE:(\d+)\]/);
        if (fileMatch) {
            this.files.push({
                name: fileMatch[1],
                size: parseInt(fileMatch[2]),
                isDirectory: false
            });
            this.renderFileList();
        }
        
        // Directory format: [DIR:/dirname/]
        const dirMatch = msg.match(/\[DIR:([^\]]+)\]/);
        if (dirMatch) {
            this.files.push({
                name: dirMatch[1],
                size: 0,
                isDirectory: true
            });
            this.renderFileList();
        }
        
        // End of file list
        if (msg.includes('[FILES:') || msg.includes('files found')) {
            this.renderFileList();
        }
    }
    
    renderFileList() {
        const fileList = document.getElementById('sd-file-list');
        if (!fileList) return;
        
        if (this.files.length === 0) {
            fileList.innerHTML = '<div class="sd-empty">No files found</div>';
            return;
        }
        
        // Sort: directories first, then by name
        const sorted = [...this.files].sort((a, b) => {
            if (a.isDirectory && !b.isDirectory) return -1;
            if (!a.isDirectory && b.isDirectory) return 1;
            return a.name.localeCompare(b.name);
        });
        
        fileList.innerHTML = sorted.map(file => `
            <div class="sd-file-item ${file.isDirectory ? 'directory' : ''}" 
                 data-name="${file.name}" data-size="${file.size}">
                <span class="sd-file-icon">${file.isDirectory ? '📁' : '📄'}</span>
                <span class="sd-file-name">${this.getFileName(file.name)}</span>
                <span class="sd-file-size">${file.isDirectory ? '' : this.formatSize(file.size)}</span>
            </div>
        `).join('');
        
        // Bind click events
        fileList.querySelectorAll('.sd-file-item').forEach(item => {
            item.addEventListener('click', () => {
                const name = item.dataset.name;
                const isDir = item.classList.contains('directory');
                
                if (isDir) {
                    this.navigateToDirectory(name);
                } else {
                    this.selectFile(name, parseInt(item.dataset.size));
                }
            });
        });
    }
    
    getFileName(path) {
        return path.split('/').pop() || path;
    }
    
    formatSize(bytes) {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
    }
    
    navigateToDirectory(path) {
        this.currentPath = path;
        document.getElementById('sd-path').textContent = path;
        this.refresh();
    }
    
    async selectFile(filename, size) {
        // Highlight selected
        document.querySelectorAll('.sd-file-item').forEach(el => {
            el.classList.remove('selected');
            if (el.dataset.name === filename) {
                el.classList.add('selected');
            }
        });
        
        this.selectedFile = { name: filename, size };
        
        // Show preview section
        const previewSection = document.getElementById('sd-preview-section');
        const previewFilename = document.getElementById('sd-preview-filename');
        const previewStats = document.getElementById('sd-preview-stats');
        const previewCode = document.getElementById('sd-preview-code');
        
        if (previewSection) previewSection.style.display = 'block';
        if (previewFilename) previewFilename.textContent = this.getFileName(filename);
        if (previewStats) previewStats.innerHTML = `<span>📊 ${this.formatSize(size)}</span>`;
        if (previewCode) previewCode.textContent = 'Loading preview...';
        
        // Request file content preview (first N bytes)
        await this.loadPreview(filename);
    }
    
    async loadPreview(filename) {
        if (!this.grbl) return;
        
        const previewCode = document.getElementById('sd-preview-code');
        const previewStats = document.getElementById('sd-preview-stats');
        
        try {
            // grblHAL command to read file: $FR=filename (read)
            // Some builds use $F<=filename
            this.previewContent = '';
            
            // Collect file content
            const originalHandler = this.grbl.onMessage;
            let lines = [];
            let collecting = true;
            
            const contentHandler = (msg) => {
                if (collecting && !msg.startsWith('[') && !msg.startsWith('ok') && !msg.startsWith('error')) {
                    lines.push(msg);
                }
                if (msg.includes('ok') || msg.includes('error')) {
                    collecting = false;
                }
            };
            
            this.grbl.on('rawMessage', contentHandler);
            
            // Request file read
            this.grbl.send(`$F<=${filename}`);
            
            // Wait for content
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            this.grbl.off('rawMessage', contentHandler);
            
            this.previewContent = lines.join('\n');
            
            if (previewCode) {
                // Show first 50 lines
                const previewLines = this.previewContent.split('\n').slice(0, 50);
                previewCode.textContent = previewLines.join('\n');
                if (this.previewContent.split('\n').length > 50) {
                    previewCode.textContent += '\n\n... (truncated) ...';
                }
            }
            
            // Calculate stats
            const fullContent = this.previewContent;
            const lineCount = fullContent.split('\n').length;
            const motionLines = (fullContent.match(/G[0123]\s/g) || []).length;
            
            // Estimate time
            const estimate = this.estimateTime(fullContent);
            
            if (previewStats) {
                previewStats.innerHTML = `
                    <span>📊 ${this.formatSize(this.selectedFile.size)}</span>
                    <span>📝 ${lineCount} lines</span>
                    <span>🔧 ${motionLines} moves</span>
                    <span>⏱️ ~${estimate}</span>
                `;
            }
            
            // Trigger preview callback for visualizer
            if (this.onPreviewReady && this.previewContent) {
                this.onPreviewReady(this.previewContent, filename);
            }
            
        } catch (e) {
            if (previewCode) {
                previewCode.textContent = 'Unable to load preview\n(File will still run from SD)';
            }
        }
    }
    
    estimateTime(gcode) {
        // Rough estimate based on motion commands and default feed
        const lines = gcode.split('\n');
        let totalDist = 0;
        let pos = { x: 0, y: 0, z: 0 };
        let feed = 1000;
        
        for (const line of lines) {
            const fMatch = line.match(/F([\d.]+)/i);
            if (fMatch) feed = parseFloat(fMatch[1]);
            
            const xMatch = line.match(/X([-\d.]+)/i);
            const yMatch = line.match(/Y([-\d.]+)/i);
            const zMatch = line.match(/Z([-\d.]+)/i);
            
            if (xMatch || yMatch || zMatch) {
                const newX = xMatch ? parseFloat(xMatch[1]) : pos.x;
                const newY = yMatch ? parseFloat(yMatch[1]) : pos.y;
                const newZ = zMatch ? parseFloat(zMatch[1]) : pos.z;
                
                const dist = Math.sqrt(
                    Math.pow(newX - pos.x, 2) +
                    Math.pow(newY - pos.y, 2) +
                    Math.pow(newZ - pos.z, 2)
                );
                
                totalDist += dist;
                pos = { x: newX, y: newY, z: newZ };
            }
        }
        
        const minutes = totalDist / feed;
        if (minutes < 1) return `${Math.round(minutes * 60)}s`;
        if (minutes < 60) return `${Math.round(minutes)}min`;
        return `${Math.floor(minutes / 60)}h ${Math.round(minutes % 60)}min`;
    }
    
    closePreview() {
        const previewSection = document.getElementById('sd-preview-section');
        if (previewSection) previewSection.style.display = 'none';
        this.selectedFile = null;
        this.previewContent = null;
        
        document.querySelectorAll('.sd-file-item').forEach(el => {
            el.classList.remove('selected');
        });
    }
    
    async runFromSD() {
        if (!this.grbl || !this.selectedFile) {
            this.showNotification('No file selected', 'error');
            return;
        }
        
        const filename = this.selectedFile.name;
        
        // Confirm
        if (!confirm(`Run "${this.getFileName(filename)}" from SD card?\n\nThe machine will run autonomously.\nYou can safely disconnect after starting.`)) {
            return;
        }
        
        try {
            // grblHAL command to run from SD: $F=/filename
            await this.grbl.sendAndWait(`$F=${filename}`);
            this.showNotification(`Started: ${this.getFileName(filename)}`, 'success');
            
            // Close preview
            this.closePreview();
        } catch (e) {
            this.showNotification('Failed to start file', 'error');
        }
    }
    
    loadForStreaming() {
        if (!this.previewContent) {
            this.showNotification('No preview content loaded', 'error');
            return;
        }
        
        // Trigger callback to load into main G-code display
        if (this.onFileSelect) {
            this.onFileSelect(this.previewContent, this.selectedFile.name);
        }
        
        this.showNotification('Loaded for streaming', 'success');
        this.closePreview();
    }
    
    async deleteFile() {
        if (!this.grbl || !this.selectedFile) {
            this.showNotification('No file selected', 'error');
            return;
        }
        
        const filename = this.selectedFile.name;
        
        if (!confirm(`Delete "${this.getFileName(filename)}"?\n\nThis cannot be undone.`)) {
            return;
        }
        
        try {
            // grblHAL command to delete: $FD=filename
            await this.grbl.sendAndWait(`$FD=${filename}`);
            this.showNotification('File deleted', 'success');
            this.closePreview();
            await this.refresh();
        } catch (e) {
            this.showNotification('Failed to delete file', 'error');
        }
    }
    
    async uploadFiles(fileList) {
        if (!this.grbl) {
            this.showNotification('Not connected', 'error');
            return;
        }
        
        const progressSection = document.getElementById('sd-upload-progress');
        const progressFill = document.getElementById('sd-progress-fill');
        const progressText = document.getElementById('sd-progress-text');
        
        if (progressSection) progressSection.style.display = 'block';
        
        for (let i = 0; i < fileList.length; i++) {
            const file = fileList[i];
            const filename = file.name;
            
            try {
                if (progressText) {
                    progressText.textContent = `Uploading ${filename}... 0%`;
                }
                if (progressFill) progressFill.style.width = '0%';
                
                const content = await this.readFile(file);
                const lines = content.split('\n');
                
                // Start file write: $F>=filename
                await this.grbl.sendAndWait(`$F>=/${filename}`);
                
                // Send content line by line
                for (let j = 0; j < lines.length; j++) {
                    const line = lines[j].trim();
                    if (line) {
                        await this.grbl.sendAndWait(line);
                    }
                    
                    const progress = Math.round((j / lines.length) * 100);
                    if (progressFill) progressFill.style.width = `${progress}%`;
                    if (progressText) {
                        progressText.textContent = `Uploading ${filename}... ${progress}%`;
                    }
                }
                
                // Close file: $F>
                await this.grbl.sendAndWait('$F>');
                
                this.showNotification(`Uploaded: ${filename}`, 'success');
                
            } catch (e) {
                this.showNotification(`Failed to upload ${filename}`, 'error');
                console.error('Upload error:', e);
            }
        }
        
        if (progressSection) progressSection.style.display = 'none';
        
        // Refresh file list
        await this.refresh();
        
        if (this.onUploadComplete) {
            this.onUploadComplete();
        }
    }

    async uploadContent(filename, content) {
        if (!this.grbl) {
            this.showNotification('Not connected', 'error');
            return;
        }

        const progressSection = document.getElementById('sd-upload-progress');
        const progressFill = document.getElementById('sd-progress-fill');
        const progressText = document.getElementById('sd-progress-text');

        if (progressSection) progressSection.style.display = 'block';
        if (progressText) progressText.textContent = `Uploading ${filename}... 0%`;
        if (progressFill) progressFill.style.width = '0%';

        try {
            // Start file write
            await this.grbl.sendAndWait(`$F>=/${filename}`);

            const lines = content.split('\n');
            for (let j = 0; j < lines.length; j++) {
                const line = lines[j].trim();
                if (line) {
                    await this.grbl.sendAndWait(line);
                }

                const progress = Math.round((j / Math.max(1, lines.length)) * 100);
                if (progressFill) progressFill.style.width = `${progress}%`;
                if (progressText) progressText.textContent = `Uploading ${filename}... ${progress}%`;
            }

            // Close file
            await this.grbl.sendAndWait('$F>');
            this.showNotification(`Uploaded: ${filename}`, 'success');
        } finally {
            if (progressSection) progressSection.style.display = 'none';
        }

        await this.refresh();
        if (this.onUploadComplete) this.onUploadComplete();
    }

    async runFileByName(filename) {
        if (!this.grbl) {
            this.showNotification('Not connected', 'error');
            return;
        }

        // Normalize to absolute SD path
        const path = filename.startsWith('/') ? filename : `/${filename}`;
        await this.grbl.sendAndWait(`$F=${path}`);
        this.showNotification(`Started: ${this.getFileName(path)}`, 'success');
    }
    
    readFile(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => resolve(e.target.result);
            reader.onerror = reject;
            reader.readAsText(file);
        });
    }
    
    updateStatus(text, mounted) {
        const status = document.getElementById('sd-status');
        if (status) {
            status.textContent = text;
            status.classList.toggle('mounted', mounted);
        }
    }
    
    showNotification(message, type = 'info') {
        // Try to use existing notification system
        if (typeof showNotification === 'function') {
            showNotification(message, type);
            return;
        }
        
        // Fallback
        console.log(`[SD Card] ${type}: ${message}`);
        
        // Create toast notification
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.textContent = message;
        toast.style.cssText = `
            position: fixed;
            bottom: 20px;
            right: 20px;
            padding: 12px 20px;
            border-radius: 6px;
            background: ${type === 'error' ? '#ff4466' : type === 'success' ? '#00ff88' : '#00d4ff'};
            color: #000;
            font-weight: 500;
            z-index: 10000;
            animation: slideIn 0.3s ease;
        `;
        document.body.appendChild(toast);
        
        setTimeout(() => toast.remove(), 3000);
    }
}

// Export for use in app.js
if (typeof window !== 'undefined') {
    window.SDCardManager = SDCardManager;
}
