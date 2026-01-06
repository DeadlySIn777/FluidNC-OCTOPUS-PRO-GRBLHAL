/* ========================================
   FluidCNC - 3D G-Code Visualizer
   Canvas-based with pan/zoom/rotate
   Supports both canvasId string and options object
   ======================================== */

class GCodeVisualizer {
    constructor(options) {
        // Accept either canvas ID string or options object
        if (typeof options === 'string') {
            this.canvas = document.getElementById(options);
        } else if (options?.canvas) {
            // Options object with canvas element or ID
            this.canvas = typeof options.canvas === 'string' 
                ? document.getElementById(options.canvas)
                : options.canvas;
            this.workArea = options.workArea || { x: 400, y: 400, z: 200 };
            this.gridSize = options.gridSize || 10;
        } else {
            console.error('[Visualizer] Invalid constructor argument');
            return;
        }
        
        if (!this.canvas) {
            console.error('[Visualizer] Canvas element not found');
            return;
        }
        
        this.ctx = this.canvas.getContext('2d');
        this.toolpath = [];
        this.bounds = null;
        this.gcodeParser = new GCodeParser(); // Integrated parser
        
        // View state
        this.view = {
            rotateX: 35,      // degrees
            rotateZ: 45,      // degrees
            zoom: 1,
            panX: 0,
            panY: 0
        };
        
        // Tool position
        this.toolPos = { x: 0, y: 0, z: 0 };
        this.showTool = true;
        
        // Colors
        this.colors = {
            background: '#12121a',
            grid: '#2a2a3a',
            gridMajor: '#3a3a4a',
            rapid: '#00aaff',
            cut: '#00ff88',
            arc: '#ffaa00',
            tool: '#ff6b6b',
            toolGlow: 'rgba(255, 107, 107, 0.3)',
            bounds: '#444455',
            axisX: '#ff6b6b',
            axisY: '#4ecdc4',
            axisZ: '#45b7d1',
            origin: '#ffffff'
        };
        
        // Interaction state
        this.isDragging = false;
        this.lastMouse = { x: 0, y: 0 };
        this.isRotating = false;
        
        // Animation state
        this.animationLine = 0;
        this.isAnimating = false;
        this.animationSpeed = 1;
        this.animationFrame = null;
        
        // Simulation state
        this.simulationRunning = false;
        this.simulationIndex = 0;
        
        this.setupCanvas();
        this.setupEvents();
        this.render();
    }

    setWorkArea(workArea) {
        if (!workArea || typeof workArea !== 'object') return;
        const x = Number(workArea.x);
        const y = Number(workArea.y);
        const z = Number(workArea.z);
        if (Number.isFinite(x) && x > 0) this.workArea.x = x;
        if (Number.isFinite(y) && y > 0) this.workArea.y = y;
        if (Number.isFinite(z) && z > 0) this.workArea.z = z;
        this.render();
    }
    
    // Load G-code from string array (integrates parser)
    loadGCode(lines) {
        const gcodeText = Array.isArray(lines) ? lines.join('\n') : lines;
        const result = this.gcodeParser.parse(gcodeText);
        this.setToolpath(result.toolPath);
        return result;
    }
    
    setupCanvas() {
        const resize = () => {
            const wrapper = this.canvas.parentElement;
            if (!wrapper) return;
            const rect = wrapper.getBoundingClientRect();
            const dpr = window.devicePixelRatio || 1;
            
            this.canvas.width = rect.width * dpr;
            this.canvas.height = rect.height * dpr;
            this.canvas.style.width = rect.width + 'px';
            this.canvas.style.height = rect.height + 'px';

            // Avoid cumulative scaling on repeated resizes
            this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            this.width = rect.width;
            this.height = rect.height;
            
            this.render();
        };
        
        resize();
        window.addEventListener('resize', resize);
        
        // Use ResizeObserver for dynamic resize
        if (window.ResizeObserver) {
            new ResizeObserver(resize).observe(this.canvas.parentElement);
        }
    }
    
    setupEvents() {
        // Mouse events
        this.canvas.addEventListener('mousedown', (e) => this.onMouseDown(e));
        this.canvas.addEventListener('mousemove', (e) => this.onMouseMove(e));
        this.canvas.addEventListener('mouseup', () => this.onMouseUp());
        this.canvas.addEventListener('mouseleave', () => this.onMouseUp());
        this.canvas.addEventListener('wheel', (e) => this.onWheel(e));
        
        // Touch events
        this.canvas.addEventListener('touchstart', (e) => this.onTouchStart(e));
        this.canvas.addEventListener('touchmove', (e) => this.onTouchMove(e));
        this.canvas.addEventListener('touchend', () => this.onTouchEnd());
        
        // Double click to reset
        this.canvas.addEventListener('dblclick', () => this.resetView());
    }
    
    onMouseDown(e) {
        this.isDragging = true;
        this.isRotating = e.button === 0 && !e.shiftKey;
        this.lastMouse = { x: e.clientX, y: e.clientY };
    }
    
    onMouseMove(e) {
        if (!this.isDragging) return;
        
        const dx = e.clientX - this.lastMouse.x;
        const dy = e.clientY - this.lastMouse.y;
        
        if (this.isRotating) {
            this.view.rotateZ += dx * 0.5;
            this.view.rotateX = Math.max(-90, Math.min(90, this.view.rotateX - dy * 0.5));
        } else {
            this.view.panX += dx;
            this.view.panY += dy;
        }
        
        this.lastMouse = { x: e.clientX, y: e.clientY };
        this.render();
    }
    
    onMouseUp() {
        this.isDragging = false;
    }
    
    onWheel(e) {
        e.preventDefault();
        const delta = e.deltaY > 0 ? 0.9 : 1.1;
        this.view.zoom = Math.max(0.1, Math.min(10, this.view.zoom * delta));
        this.render();
    }
    
    onTouchStart(e) {
        if (e.touches.length === 1) {
            this.isDragging = true;
            this.isRotating = true;
            this.lastMouse = { x: e.touches[0].clientX, y: e.touches[0].clientY };
        } else if (e.touches.length === 2) {
            this.isDragging = true;
            this.isRotating = false;
            this.lastPinchDist = this.getPinchDistance(e);
        }
    }
    
    onTouchMove(e) {
        e.preventDefault();
        if (!this.isDragging) return;
        
        if (e.touches.length === 1 && this.isRotating) {
            const dx = e.touches[0].clientX - this.lastMouse.x;
            const dy = e.touches[0].clientY - this.lastMouse.y;
            
            this.view.rotateZ += dx * 0.5;
            this.view.rotateX = Math.max(-90, Math.min(90, this.view.rotateX - dy * 0.5));
            
            this.lastMouse = { x: e.touches[0].clientX, y: e.touches[0].clientY };
        } else if (e.touches.length === 2) {
            const dist = this.getPinchDistance(e);
            const delta = dist / this.lastPinchDist;
            this.view.zoom = Math.max(0.1, Math.min(10, this.view.zoom * delta));
            this.lastPinchDist = dist;
        }
        
        this.render();
    }
    
    onTouchEnd() {
        this.isDragging = false;
    }
    
    getPinchDistance(e) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        return Math.sqrt(dx * dx + dy * dy);
    }
    
    // 3D projection with rotation
    project(x, y, z) {
        // Degrees to radians
        const rx = this.view.rotateX * Math.PI / 180;
        const rz = this.view.rotateZ * Math.PI / 180;
        
        // Rotate around Z axis
        const x1 = x * Math.cos(rz) - y * Math.sin(rz);
        const y1 = x * Math.sin(rz) + y * Math.cos(rz);
        const z1 = z;
        
        // Rotate around X axis
        const x2 = x1;
        const y2 = y1 * Math.cos(rx) - z1 * Math.sin(rx);
        const z2 = y1 * Math.sin(rx) + z1 * Math.cos(rx);
        
        // Apply zoom and pan, center on canvas
        return {
            x: this.width / 2 + (x2 * this.view.zoom) + this.view.panX,
            y: this.height / 2 - (y2 * this.view.zoom) + this.view.panY,
            z: z2
        };
    }
    
    setToolpath(segments) {
        this.toolpath = segments;
        this.calculateBounds();
        this.fitToView();
        this.render();
    }
    
    calculateBounds() {
        if (!this.toolpath.length) {
            this.bounds = { minX: 0, maxX: 100, minY: 0, maxY: 100, minZ: -50, maxZ: 10 };
            return;
        }
        
        let minX = Infinity, maxX = -Infinity;
        let minY = Infinity, maxY = -Infinity;
        let minZ = Infinity, maxZ = -Infinity;
        
        for (const seg of this.toolpath) {
            minX = Math.min(minX, seg.from.x, seg.to.x);
            maxX = Math.max(maxX, seg.from.x, seg.to.x);
            minY = Math.min(minY, seg.from.y, seg.to.y);
            maxY = Math.max(maxY, seg.from.y, seg.to.y);
            minZ = Math.min(minZ, seg.from.z, seg.to.z);
            maxZ = Math.max(maxZ, seg.from.z, seg.to.z);
        }
        
        this.bounds = { minX, maxX, minY, maxY, minZ, maxZ };
    }
    
    fitToView() {
        if (!this.bounds) return;
        
        const sizeX = this.bounds.maxX - this.bounds.minX;
        const sizeY = this.bounds.maxY - this.bounds.minY;
        const maxSize = Math.max(sizeX, sizeY, 50);
        
        // Calculate zoom to fit
        const padding = 0.8;
        this.view.zoom = Math.min(this.width, this.height) * padding / maxSize;
        
        // Center on bounds
        const centerX = (this.bounds.minX + this.bounds.maxX) / 2;
        const centerY = (this.bounds.minY + this.bounds.maxY) / 2;
        
        // Adjust pan to center the toolpath
        this.view.panX = -centerX * this.view.zoom * Math.cos(this.view.rotateZ * Math.PI / 180);
        this.view.panY = centerY * this.view.zoom * Math.cos(this.view.rotateX * Math.PI / 180);
    }
    
    resetView() {
        this.view = {
            rotateX: 35,
            rotateZ: 45,
            zoom: 1,
            panX: 0,
            panY: 0
        };
        this.fitToView();
        this.render();
    }
    
    setView(preset) {
        switch (preset) {
            case 'top':
                this.view.rotateX = 90;
                this.view.rotateZ = 0;
                break;
            case 'front':
                this.view.rotateX = 0;
                this.view.rotateZ = 0;
                break;
            case 'iso':
                this.view.rotateX = 35;
                this.view.rotateZ = 45;
                break;
        }
        this.fitToView();
        this.render();
    }
    
    updateToolPosition(x, y, z) {
        this.toolPos = { x, y, z };
        this.render();
    }
    
    render() {
        const ctx = this.ctx;
        
        // Clear
        ctx.fillStyle = this.colors.background;
        ctx.fillRect(0, 0, this.width, this.height);
        
        // Draw grid
        this.drawGrid();

        // Draw machine work area (if configured)
        this.drawWorkArea();
        
        // Draw axes
        this.drawAxes();
        
        // Draw bounds
        if (this.bounds && this.toolpath.length) {
            this.drawBounds();
        }
        
        // Draw toolpath
        this.drawToolpath();
        
        // Draw tool
        if (this.showTool) {
            this.drawTool();
        }
    }
    
    drawGrid() {
        const ctx = this.ctx;
        const gridSize = this.gridSize || 10;
        const waX = this.workArea?.x || 400;
        const waY = this.workArea?.y || 400;
        const gridExtent = Math.max(50, Math.ceil(Math.max(waX, waY) / gridSize) * gridSize);
        
        ctx.strokeStyle = this.colors.grid;
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        
        for (let i = -gridExtent; i <= gridExtent; i += gridSize) {
            // X lines
            const p1 = this.project(i, -gridExtent, 0);
            const p2 = this.project(i, gridExtent, 0);
            ctx.moveTo(p1.x, p1.y);
            ctx.lineTo(p2.x, p2.y);
            
            // Y lines
            const p3 = this.project(-gridExtent, i, 0);
            const p4 = this.project(gridExtent, i, 0);
            ctx.moveTo(p3.x, p3.y);
            ctx.lineTo(p4.x, p4.y);
        }
        
        ctx.stroke();
        
        // Major grid lines
        ctx.strokeStyle = this.colors.gridMajor;
        ctx.lineWidth = 1;
        ctx.beginPath();
        
        for (let i = -gridExtent; i <= gridExtent; i += gridSize * 10) {
            const p1 = this.project(i, -gridExtent, 0);
            const p2 = this.project(i, gridExtent, 0);
            ctx.moveTo(p1.x, p1.y);
            ctx.lineTo(p2.x, p2.y);
            
            const p3 = this.project(-gridExtent, i, 0);
            const p4 = this.project(gridExtent, i, 0);
            ctx.moveTo(p3.x, p3.y);
            ctx.lineTo(p4.x, p4.y);
        }
        
        ctx.stroke();
    }

    drawWorkArea() {
        if (!this.workArea) return;

        const x = Number(this.workArea.x);
        const y = Number(this.workArea.y);
        if (!(Number.isFinite(x) && x > 0 && Number.isFinite(y) && y > 0)) return;

        const ctx = this.ctx;
        ctx.save();
        ctx.strokeStyle = this.colors.bounds;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([]);

        // Draw rectangle from origin to (workArea.x, workArea.y) on Z=0 plane
        const p1 = this.project(0, 0, 0);
        const p2 = this.project(x, 0, 0);
        const p3 = this.project(x, y, 0);
        const p4 = this.project(0, y, 0);

        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.lineTo(p3.x, p3.y);
        ctx.lineTo(p4.x, p4.y);
        ctx.closePath();
        ctx.stroke();

        // Label
        ctx.fillStyle = this.colors.text || this.colors.origin;
        ctx.font = '12px Inter, sans-serif';
        const label = `${x}×${y}mm workspace`;
        ctx.fillText(label, p1.x + 6, p1.y - 6);
        ctx.restore();
    }
    
    drawAxes() {
        const ctx = this.ctx;
        const len = 30;
        const origin = this.project(0, 0, 0);
        
        // X axis
        const xEnd = this.project(len, 0, 0);
        ctx.strokeStyle = this.colors.axisX;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(origin.x, origin.y);
        ctx.lineTo(xEnd.x, xEnd.y);
        ctx.stroke();
        
        // Y axis
        const yEnd = this.project(0, len, 0);
        ctx.strokeStyle = this.colors.axisY;
        ctx.beginPath();
        ctx.moveTo(origin.x, origin.y);
        ctx.lineTo(yEnd.x, yEnd.y);
        ctx.stroke();
        
        // Z axis
        const zEnd = this.project(0, 0, len);
        ctx.strokeStyle = this.colors.axisZ;
        ctx.beginPath();
        ctx.moveTo(origin.x, origin.y);
        ctx.lineTo(zEnd.x, zEnd.y);
        ctx.stroke();
        
        // Origin dot
        ctx.fillStyle = this.colors.origin;
        ctx.beginPath();
        ctx.arc(origin.x, origin.y, 4, 0, Math.PI * 2);
        ctx.fill();
        
        // Axis labels
        ctx.font = '12px Inter, sans-serif';
        ctx.fillStyle = this.colors.axisX;
        ctx.fillText('X', xEnd.x + 5, xEnd.y + 5);
        
        ctx.fillStyle = this.colors.axisY;
        ctx.fillText('Y', yEnd.x + 5, yEnd.y + 5);
        
        ctx.fillStyle = this.colors.axisZ;
        ctx.fillText('Z', zEnd.x + 5, zEnd.y - 5);
    }
    
    drawBounds() {
        const ctx = this.ctx;
        const b = this.bounds;
        
        ctx.strokeStyle = this.colors.bounds;
        ctx.lineWidth = 1;
        ctx.setLineDash([5, 5]);
        ctx.beginPath();
        
        // Bottom rectangle (Z = minZ)
        const p1 = this.project(b.minX, b.minY, b.minZ);
        const p2 = this.project(b.maxX, b.minY, b.minZ);
        const p3 = this.project(b.maxX, b.maxY, b.minZ);
        const p4 = this.project(b.minX, b.maxY, b.minZ);
        
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.lineTo(p3.x, p3.y);
        ctx.lineTo(p4.x, p4.y);
        ctx.closePath();
        
        ctx.stroke();
        ctx.setLineDash([]);
    }
    
    drawToolpath() {
        const ctx = this.ctx;
        
        // Separate rapids and cuts for proper layering
        const rapids = [];
        const cuts = [];
        
        for (const seg of this.toolpath) {
            if (seg.type === 'rapid') {
                rapids.push(seg);
            } else {
                cuts.push(seg);
            }
        }
        
        // Draw rapids (dashed, behind)
        ctx.strokeStyle = this.colors.rapid;
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.globalAlpha = 0.5;
        ctx.beginPath();
        
        for (const seg of rapids) {
            const from = this.project(seg.from.x, seg.from.y, seg.from.z);
            const to = this.project(seg.to.x, seg.to.y, seg.to.z);
            ctx.moveTo(from.x, from.y);
            ctx.lineTo(to.x, to.y);
        }
        
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
        
        // Draw cuts (solid, on top)
        ctx.lineWidth = 1.5;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        
        for (const seg of cuts) {
            const from = this.project(seg.from.x, seg.from.y, seg.from.z);
            const to = this.project(seg.to.x, seg.to.y, seg.to.z);
            
            // Color based on segment type
            if (seg.type === 'arc') {
                ctx.strokeStyle = this.colors.arc;
            } else {
                ctx.strokeStyle = this.colors.cut;
            }
            
            ctx.beginPath();
            ctx.moveTo(from.x, from.y);
            ctx.lineTo(to.x, to.y);
            ctx.stroke();
        }
    }
    
    drawTool() {
        const ctx = this.ctx;
        const pos = this.project(this.toolPos.x, this.toolPos.y, this.toolPos.z);
        
        // Glow
        const gradient = ctx.createRadialGradient(pos.x, pos.y, 0, pos.x, pos.y, 20);
        gradient.addColorStop(0, this.colors.toolGlow);
        gradient.addColorStop(1, 'transparent');
        
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, 20, 0, Math.PI * 2);
        ctx.fill();
        
        // Tool dot
        ctx.fillStyle = this.colors.tool;
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, 6, 0, Math.PI * 2);
        ctx.fill();
        
        // Inner highlight
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(pos.x - 2, pos.y - 2, 2, 0, Math.PI * 2);
        ctx.fill();
        
        // Draw Z projection line to Z=0
        if (this.toolPos.z !== 0) {
            const groundPos = this.project(this.toolPos.x, this.toolPos.y, 0);
            ctx.strokeStyle = this.colors.tool;
            ctx.lineWidth = 1;
            ctx.setLineDash([2, 2]);
            ctx.globalAlpha = 0.5;
            ctx.beginPath();
            ctx.moveTo(pos.x, pos.y);
            ctx.lineTo(groundPos.x, groundPos.y);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.globalAlpha = 1;
            
            // Ground shadow
            ctx.fillStyle = 'rgba(255, 107, 107, 0.2)';
            ctx.beginPath();
            ctx.ellipse(groundPos.x, groundPos.y, 6, 3, 0, 0, Math.PI * 2);
            ctx.fill();
        }
    }
    
    // Animate toolpath progress
    animateTo(lineNumber) {
        this.animationLine = lineNumber;
        this.render();
    }
    
    // Clear toolpath
    clear() {
        this.toolpath = [];
        this.bounds = null;
        this.render();
    }
    
    // Get bounds info string
    getBoundsInfo() {
        if (!this.bounds || !this.toolpath.length) {
            return 'No file loaded';
        }
        
        const b = this.bounds;
        const sizeX = (b.maxX - b.minX).toFixed(1);
        const sizeY = (b.maxY - b.minY).toFixed(1);
        const sizeZ = (b.maxZ - b.minZ).toFixed(1);
        
        return `${sizeX} × ${sizeY} × ${sizeZ} mm`;
    }
    
    // Set tool position (called from live status updates)
    setToolPosition(x, y, z) {
        this.toolPos = { x, y, z };
        this.render();
    }
    
    // ================================================================
    // Toolpath Simulation
    // ================================================================
    
    startSimulation(speed = 1) {
        if (this.toolpath.length === 0) return;
        
        this.simulationRunning = true;
        this.simulationIndex = 0;
        this.animationSpeed = speed;
        this.simulationLoop();
    }
    
    simulationLoop() {
        if (!this.simulationRunning) return;
        
        if (this.simulationIndex < this.toolpath.length) {
            const segment = this.toolpath[this.simulationIndex];
            this.toolPos = { ...segment.to };
            this.animationLine = this.simulationIndex;
            this.render();
            
            // Calculate delay based on segment distance and speed
            const delay = Math.max(10, 50 / this.animationSpeed);
            this.simulationIndex++;
            this.animationFrame = setTimeout(() => this.simulationLoop(), delay);
        } else {
            this.simulationRunning = false;
        }
    }
    
    pauseSimulation() {
        this.simulationRunning = false;
        if (this.animationFrame) {
            clearTimeout(this.animationFrame);
        }
    }
    
    stopSimulation() {
        this.pauseSimulation();
        this.simulationIndex = 0;
        this.toolPos = { x: 0, y: 0, z: 0 };
        this.render();
    }
    
    // Get simulation progress percentage
    getSimulationProgress() {
        if (this.toolpath.length === 0) return 0;
        return (this.simulationIndex / this.toolpath.length) * 100;
    }
}

// Export for use
if (typeof module !== 'undefined' && module.exports) {
    module.exports = GCodeVisualizer;
}
