/* ========================================
   FluidCNC - Three.js 3D G-Code Visualizer
   Full 3D rendering with WebGL
   Toolpath animation, tool preview, grid
   Measurement tools, path highlighting
   ======================================== */

class GCodeVisualizer3D {
    constructor(options = {}) {
        // Accept container element or ID
        if (typeof options === 'string') {
            this.container = document.getElementById(options);
            options = {};
        } else if (options.container) {
            this.container = typeof options.container === 'string'
                ? document.getElementById(options.container)
                : options.container;
        } else {
            console.error('[Visualizer3D] Container required');
            return;
        }

        if (!this.container) {
            console.error('[Visualizer3D] Container not found');
            return;
        }

        // Configuration
        this.config = {
            workArea: options.workArea || { x: 400, y: 400, z: 200 },
            gridSize: options.gridSize || 10,
            rapidColor: options.rapidColor || 0x00aaff,
            cutColor: options.cutColor || 0x00ff88,
            arcColor: options.arcColor || 0xffaa00,
            helicalColor: options.helicalColor || 0xff6b6b,
            toolColor: options.toolColor || 0xff6b6b,
            highlightColor: options.highlightColor || 0xffff00,
            backgroundColor: options.backgroundColor || 0x12121a,
            gridColor: options.gridColor || 0x2a2a3a,
            axisColors: options.axisColors || { x: 0xff6b6b, y: 0x4ecdc4, z: 0x45b7d1 },
            showRapids: options.showRapids !== false,
            rapidOpacity: options.rapidOpacity || 0.3
        };

        // State
        this.toolPath = [];
        this.bounds = null;
        this.toolPosition = { x: 0, y: 0, z: 0 };
        this.gcodeParser = new GCodeParser();

        // Animation state
        this.isAnimating = false;
        this.animationProgress = 0;
        this.animationSpeed = 1;
        this.animatedPathLength = 0;

        // Path highlighting
        this.highlightedLine = -1;
        this.highlightedSegments = [];
        
        // Measurement mode
        this.measureMode = false;
        this.measurePoints = [];
        this.measureLine = null;
        this.measureLabel = null;

        // Three.js objects
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.controls = null;
        this.pathGroup = null;
        this.rapidGroup = null;
        this.highlightGroup = null;
        this.measureGroup = null;
        this.toolMesh = null;
        this.gridHelper = null;
        this.axisHelper = null;
        this.animatedPath = null;
        
        // Raycaster for picking
        this.raycaster = null;
        this.mouse = null;

        // Initialize
        this.init();
        this.setupEventListeners();
        this.animate();
        
        console.log('[Visualizer3D] Constructor complete, container:', this.container?.clientWidth, 'x', this.container?.clientHeight);
    }

    async init() {
        // Check if Three.js is loaded
        if (typeof THREE === 'undefined') {
            console.error('[Visualizer3D] Three.js not loaded. Add: <script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>');
            this.showFallbackMessage();
            return;
        }
        
        console.log('[Visualizer3D] Three.js loaded, initializing scene...');

        // Create scene
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(this.config.backgroundColor);
        this.scene.fog = new THREE.Fog(this.config.backgroundColor, 500, 2000);

        // Create camera - use fallback dimensions if container not yet visible
        const width = this.container.clientWidth || 800;
        const height = this.container.clientHeight || 600;
        const aspect = width / height;
        this.camera = new THREE.PerspectiveCamera(45, aspect, 0.1, 5000);
        this.camera.position.set(300, 300, 300);
        this.camera.lookAt(0, 0, 0);

        // Create renderer
        this.renderer = new THREE.WebGLRenderer({
            antialias: true,
            alpha: true,
            powerPreference: 'high-performance'
        });
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.setSize(width, height);
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        this.container.appendChild(this.renderer.domElement);
        
        // Raycaster for picking
        this.raycaster = new THREE.Raycaster();
        this.raycaster.params.Line = { threshold: 3 };
        this.mouse = new THREE.Vector2();

        // Add orbit controls (inline implementation for no extra dependencies)
        this.setupOrbitControls();

        // Add lighting
        this.setupLighting();

        // Add grid and axes
        this.createGrid();
        this.createAxes();
        this.createWorkAreaBounds();

        // Create tool marker
        this.createTool();

        // Create path groups
        this.pathGroup = new THREE.Group();
        this.pathGroup.name = 'cuts';
        this.scene.add(this.pathGroup);
        
        this.rapidGroup = new THREE.Group();
        this.rapidGroup.name = 'rapids';
        this.rapidGroup.visible = this.config.showRapids;
        this.scene.add(this.rapidGroup);
        
        this.highlightGroup = new THREE.Group();
        this.highlightGroup.name = 'highlights';
        this.scene.add(this.highlightGroup);
        
        this.measureGroup = new THREE.Group();
        this.measureGroup.name = 'measurements';
        this.scene.add(this.measureGroup);
    }

    showFallbackMessage() {
        this.container.innerHTML = `
            <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; 
                        height: 100%; color: #888; font-family: sans-serif; text-align: center; padding: 20px;">
                <svg width="80" height="80" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                    <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
                    <polyline points="3.27 6.96 12 12.01 20.73 6.96"/>
                    <line x1="12" y1="22.08" x2="12" y2="12"/>
                </svg>
                <h3 style="margin-top: 16px;">3D Visualizer Unavailable</h3>
                <p style="margin-top: 8px; font-size: 14px; opacity: 0.7;">Three.js library not loaded</p>
            </div>
        `;
    }

    setupOrbitControls() {
        // Simplified orbit controls (no external dependency)
        let isDragging = false;
        let previousMousePosition = { x: 0, y: 0 };
        const spherical = { radius: 500, theta: Math.PI / 4, phi: Math.PI / 4 };
        const target = new THREE.Vector3(0, 0, 0);

        const updateCamera = () => {
            this.camera.position.setFromSpherical(new THREE.Spherical(
                spherical.radius,
                spherical.phi,
                spherical.theta
            ));
            this.camera.position.add(target);
            this.camera.lookAt(target);
        };

        this.renderer.domElement.addEventListener('mousedown', (e) => {
            isDragging = true;
            previousMousePosition = { x: e.clientX, y: e.clientY };
        });

        this.renderer.domElement.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            
            const deltaX = e.clientX - previousMousePosition.x;
            const deltaY = e.clientY - previousMousePosition.y;

            if (e.buttons === 1 && !e.shiftKey) {
                // Rotate
                spherical.theta -= deltaX * 0.01;
                spherical.phi = Math.max(0.1, Math.min(Math.PI - 0.1, spherical.phi + deltaY * 0.01));
            } else if (e.buttons === 1 && e.shiftKey || e.buttons === 4) {
                // Pan
                const panSpeed = 0.5;
                const up = new THREE.Vector3(0, 1, 0);
                const right = new THREE.Vector3().crossVectors(up, this.camera.position.clone().sub(target).normalize());
                target.addScaledVector(right, deltaX * panSpeed);
                target.addScaledVector(up, -deltaY * panSpeed);
            }

            previousMousePosition = { x: e.clientX, y: e.clientY };
            updateCamera();
        });

        this.renderer.domElement.addEventListener('mouseup', () => isDragging = false);
        this.renderer.domElement.addEventListener('mouseleave', () => isDragging = false);

        this.renderer.domElement.addEventListener('wheel', (e) => {
            e.preventDefault();
            spherical.radius = Math.max(50, Math.min(2000, spherical.radius * (1 + e.deltaY * 0.001)));
            updateCamera();
        }, { passive: false });

        // Double click to reset
        this.renderer.domElement.addEventListener('dblclick', () => {
            spherical.radius = 500;
            spherical.theta = Math.PI / 4;
            spherical.phi = Math.PI / 4;
            target.set(0, 0, 0);
            updateCamera();
        });

        updateCamera();

        // Store for external access
        this.orbitControls = {
            target,
            spherical,
            updateCamera,
            setView: (view) => {
                if (view === 'top') {
                    spherical.phi = 0.1;
                    spherical.theta = 0;
                } else if (view === 'front') {
                    spherical.phi = Math.PI / 2;
                    spherical.theta = 0;
                } else if (view === 'right') {
                    spherical.phi = Math.PI / 2;
                    spherical.theta = Math.PI / 2;
                } else if (view === 'isometric') {
                    spherical.phi = Math.PI / 4;
                    spherical.theta = Math.PI / 4;
                }
                updateCamera();
            },
            fitToPath: (bounds) => {
                if (!bounds) return;
                const center = new THREE.Vector3(
                    (bounds.min.x + bounds.max.x) / 2,
                    (bounds.min.y + bounds.max.y) / 2,
                    (bounds.min.z + bounds.max.z) / 2
                );
                target.copy(center);
                const size = Math.max(
                    bounds.max.x - bounds.min.x,
                    bounds.max.y - bounds.min.y,
                    bounds.max.z - bounds.min.z
                );
                spherical.radius = size * 2;
                updateCamera();
            }
        };
    }

    setupLighting() {
        // Ambient light
        const ambient = new THREE.AmbientLight(0xffffff, 0.4);
        this.scene.add(ambient);

        // Key light
        const keyLight = new THREE.DirectionalLight(0xffffff, 0.6);
        keyLight.position.set(200, 300, 200);
        keyLight.castShadow = true;
        keyLight.shadow.mapSize.width = 2048;
        keyLight.shadow.mapSize.height = 2048;
        this.scene.add(keyLight);

        // Fill light
        const fillLight = new THREE.DirectionalLight(0x00aaff, 0.2);
        fillLight.position.set(-200, 100, -200);
        this.scene.add(fillLight);

        // Rim light
        const rimLight = new THREE.DirectionalLight(0xff6600, 0.15);
        rimLight.position.set(0, -200, 0);
        this.scene.add(rimLight);
    }

    createGrid() {
        const { x, y } = this.config.workArea;
        const gridSize = Math.max(x, y);
        const cellSize = Number(this.config.gridSize) || 10;
        const divisions = Math.max(2, Math.round(gridSize / Math.max(1, cellSize)));

        this.gridHelper = new THREE.GridHelper(gridSize, divisions, 0x444455, 0x2a2a3a);
        this.gridHelper.position.set(x / 2, 0, y / 2);
        this.scene.add(this.gridHelper);
    }

    createAxes() {
        const { x, y, z } = this.config.axisColors;
        const length = 50;

        // X axis (red)
        const xGeom = new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(0, 0, 0),
            new THREE.Vector3(length, 0, 0)
        ]);
        const xLine = new THREE.Line(xGeom, new THREE.LineBasicMaterial({ color: x, linewidth: 2 }));
        this.scene.add(xLine);

        // Y axis (green/teal) - Note: In Three.js Y is up, but for CNC Y is forward
        const yGeom = new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(0, 0, 0),
            new THREE.Vector3(0, 0, length)
        ]);
        const yLine = new THREE.Line(yGeom, new THREE.LineBasicMaterial({ color: y, linewidth: 2 }));
        this.scene.add(yLine);

        // Z axis (blue)
        const zGeom = new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(0, 0, 0),
            new THREE.Vector3(0, length, 0)
        ]);
        const zLine = new THREE.Line(zGeom, new THREE.LineBasicMaterial({ color: z, linewidth: 2 }));
        this.scene.add(zLine);

        // Origin marker
        const originGeom = new THREE.SphereGeometry(3, 16, 16);
        const originMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.5 });
        const origin = new THREE.Mesh(originGeom, originMat);
        this.scene.add(origin);
    }

    createWorkAreaBounds() {
        const { x, y, z } = this.config.workArea;
        
        const geometry = new THREE.BoxGeometry(x, z, y);
        const edges = new THREE.EdgesGeometry(geometry);
        const material = new THREE.LineBasicMaterial({ color: 0x444455, transparent: true, opacity: 0.3 });
        const bounds = new THREE.LineSegments(edges, material);
        bounds.position.set(x / 2, z / 2, y / 2);
        this.scene.add(bounds);
    }

    createTool() {
        // Create tool representation (cone + cylinder)
        const group = new THREE.Group();

        // Spindle body
        const spindleGeom = new THREE.CylinderGeometry(8, 8, 30, 16);
        const spindleMat = new THREE.MeshStandardMaterial({
            color: 0x888888,
            metalness: 0.8,
            roughness: 0.3
        });
        const spindle = new THREE.Mesh(spindleGeom, spindleMat);
        spindle.position.y = 20;
        group.add(spindle);

        // Collet
        const colletGeom = new THREE.CylinderGeometry(6, 4, 10, 16);
        const collet = new THREE.Mesh(colletGeom, spindleMat);
        collet.position.y = 0;
        group.add(collet);

        // Tool bit (endmill)
        const toolGeom = new THREE.CylinderGeometry(2, 2, 25, 16);
        const toolMat = new THREE.MeshStandardMaterial({
            color: this.config.toolColor,
            metalness: 0.6,
            roughness: 0.2,
            emissive: this.config.toolColor,
            emissiveIntensity: 0.3
        });
        const tool = new THREE.Mesh(toolGeom, toolMat);
        tool.position.y = -17;
        group.add(tool);

        // Glow effect
        const glowGeom = new THREE.SphereGeometry(5, 16, 16);
        const glowMat = new THREE.MeshBasicMaterial({
            color: this.config.toolColor,
            transparent: true,
            opacity: 0.3
        });
        const glow = new THREE.Mesh(glowGeom, glowMat);
        glow.position.y = -30;
        group.add(glow);

        this.toolMesh = group;
        this.scene.add(this.toolMesh);
    }

    setupEventListeners() {
        // Resize handler
        const resizeObserver = new ResizeObserver(() => {
            if (!this.renderer) return;
            const width = this.container.clientWidth || 800;
            const height = this.container.clientHeight || 600;
            if (width > 0 && height > 0) {
                this.camera.aspect = width / height;
                this.camera.updateProjectionMatrix();
                this.renderer.setSize(width, height);
            }
        });
        resizeObserver.observe(this.container);

        // Click handler for measurement mode
        this.renderer?.domElement.addEventListener('click', (e) => {
            if (this.measureMode) {
                this.handleMeasureClick(e);
            }
        });

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            // Only if visualizer container is focused or hovered
            if (!this.container.matches(':hover')) return;
            
            switch (e.key.toLowerCase()) {
                case 'm':
                    // Toggle measure mode
                    this.enableMeasureMode(!this.measureMode);
                    break;
                case 'escape':
                    // Clear measure mode and highlights
                    this.enableMeasureMode(false);
                    this.clearHighlight();
                    break;
                case 'r':
                    // Toggle rapids
                    this.toggleRapids(!this.rapidGroup?.visible);
                    break;
                case 'g':
                    // Toggle grid
                    this.toggleGrid(!this.gridHelper?.visible);
                    break;
                case 't':
                    // Reset to isometric
                    this.setView('isometric');
                    break;
                case 'f':
                    // Fit to path
                    this.fitToPath();
                    break;
                case '1':
                    this.setView('top');
                    break;
                case '2':
                    this.setView('front');
                    break;
                case '3':
                    this.setView('right');
                    break;
                case '4':
                    this.setView('left');
                    break;
                case '5':
                    this.setView('back');
                    break;
                case 's':
                    // Screenshot
                    if (e.ctrlKey) {
                        e.preventDefault();
                        this.takeScreenshot();
                    }
                    break;
            }
        });
    }

    // ================================================================
    // G-code loading
    // ================================================================

    loadGCode(text) {
        const lines = Array.isArray(text) ? text : text.split('\n');
        const gcodeText = lines.join('\n');
        const result = this.gcodeParser.parse(gcodeText);
        this.setToolpath(result.toolPath);
        return result;
    }

    setToolpath(toolPath) {
        this.toolPath = toolPath;
        this.calculateBounds();
        this.buildPathGeometry();
        this.orbitControls?.fitToPath(this.bounds);
    }

    calculateBounds() {
        if (!this.toolPath.length) {
            this.bounds = null;
            return;
        }

        const min = { x: Infinity, y: Infinity, z: Infinity };
        const max = { x: -Infinity, y: -Infinity, z: -Infinity };

        for (const move of this.toolPath) {
            ['from', 'to'].forEach(key => {
                const pt = move[key];
                if (pt) {
                    min.x = Math.min(min.x, pt.x);
                    min.y = Math.min(min.y, pt.y);
                    min.z = Math.min(min.z, pt.z);
                    max.x = Math.max(max.x, pt.x);
                    max.y = Math.max(max.y, pt.y);
                    max.z = Math.max(max.z, pt.z);
                }
            });
        }

        this.bounds = { min, max };
    }

    buildPathGeometry() {
        // Clear existing paths from both groups
        const clearGroup = (group) => {
            while (group.children.length) {
                const child = group.children[0];
                child.geometry?.dispose();
                child.material?.dispose();
                group.remove(child);
            }
        };
        
        clearGroup(this.pathGroup);
        clearGroup(this.rapidGroup);

        if (!this.toolPath.length) return;

        // Separate by move type
        const rapids = [];
        const cuts = [];
        const arcs = [];
        const helicals = [];

        for (const move of this.toolPath) {
            const from = new THREE.Vector3(move.from.x, move.from.z, move.from.y); // Y/Z swap for CNC coords
            const to = new THREE.Vector3(move.to.x, move.to.z, move.to.y);

            if (move.type === 'rapid') {
                rapids.push(from, to);
            } else if (move.type === 'arc') {
                // Check if helical (Z changes during arc)
                const isHelical = Math.abs(move.from.z - move.to.z) > 0.001;
                const points = this.interpolateArc(move);
                if (isHelical) {
                    helicals.push(...points);
                } else {
                    arcs.push(...points);
                }
            } else {
                cuts.push(from, to);
            }
        }

        // Create rapid geometry in rapid group (can be toggled)
        if (rapids.length) {
            const geom = new THREE.BufferGeometry().setFromPoints(rapids);
            const mat = new THREE.LineBasicMaterial({ 
                color: this.config.rapidColor, 
                transparent: true, 
                opacity: this.config.rapidOpacity,
                linewidth: 1
            });
            const line = new THREE.LineSegments(geom, mat);
            line.name = 'rapids';
            this.rapidGroup.add(line);
        }

        // Create cut geometry
        if (cuts.length) {
            const geom = new THREE.BufferGeometry().setFromPoints(cuts);
            const mat = new THREE.LineBasicMaterial({ 
                color: this.config.cutColor, 
                linewidth: 2 
            });
            const cutLine = new THREE.LineSegments(geom, mat);
            cutLine.name = 'cuts';
            this.pathGroup.add(cutLine);
        }

        // Create arc geometry
        if (arcs.length) {
            const geom = new THREE.BufferGeometry().setFromPoints(arcs);
            const mat = new THREE.LineBasicMaterial({ 
                color: this.config.arcColor, 
                linewidth: 2 
            });
            const line = new THREE.LineSegments(geom, mat);
            line.name = 'arcs';
            this.pathGroup.add(line);
        }

        // Create helical arc geometry (different color)
        if (helicals.length) {
            const geom = new THREE.BufferGeometry().setFromPoints(helicals);
            const mat = new THREE.LineBasicMaterial({ 
                color: this.config.helicalColor, 
                linewidth: 2 
            });
            const line = new THREE.LineSegments(geom, mat);
            line.name = 'helicals';
            this.pathGroup.add(line);
        }
    }

    interpolateArc(move) {
        const points = [];
        const steps = 48; // More steps for smoother arcs
        const { from, to, center, clockwise } = move;

        if (!center) {
            // Fallback to line
            points.push(
                new THREE.Vector3(from.x, from.z, from.y),
                new THREE.Vector3(to.x, to.z, to.y)
            );
            return points;
        }

        const startAngle = Math.atan2(from.y - center.y, from.x - center.x);
        const endAngle = Math.atan2(to.y - center.y, to.x - center.x);
        const radius = Math.sqrt(Math.pow(from.x - center.x, 2) + Math.pow(from.y - center.y, 2));

        let deltaAngle = endAngle - startAngle;
        if (clockwise && deltaAngle > 0) deltaAngle -= 2 * Math.PI;
        if (!clockwise && deltaAngle < 0) deltaAngle += 2 * Math.PI;

        const zDelta = (to.z - from.z) / steps;

        for (let i = 0; i <= steps; i++) {
            const t = i / steps;
            const angle = startAngle + deltaAngle * t;
            const x = center.x + radius * Math.cos(angle);
            const y = center.y + radius * Math.sin(angle);
            const z = from.z + zDelta * i;
            points.push(new THREE.Vector3(x, z, y));
            if (i > 0) {
                points.push(new THREE.Vector3(x, z, y));
            }
        }

        return points;
    }

    // ================================================================
    // Tool position
    // ================================================================

    setToolPosition(x, y, z) {
        this.toolPosition = { x, y, z };
        if (this.toolMesh) {
            this.toolMesh.position.set(x, z, y); // Y/Z swap
        }
    }

    // ================================================================
    // Animation / Simulation
    // ================================================================

    startSimulation() {
        this.isAnimating = true;
        this.animationProgress = 0;
    }

    pauseSimulation() {
        this.isAnimating = false;
    }

    stopSimulation() {
        this.isAnimating = false;
        this.animationProgress = 0;
        this.updateAnimatedPath();
    }

    setSimulationProgress(progress) {
        this.animationProgress = Math.max(0, Math.min(1, progress));
        this.updateAnimatedPath();
    }

    getSimulationProgress() {
        return this.animationProgress;
    }

    updateAnimatedPath() {
        // Could implement partial path rendering here
        // For now, just update tool position based on progress
        if (!this.toolPath.length) return;

        const totalMoves = this.toolPath.length;
        const currentMoveIndex = Math.floor(this.animationProgress * totalMoves);
        const moveProgress = (this.animationProgress * totalMoves) % 1;

        if (currentMoveIndex < totalMoves) {
            const move = this.toolPath[currentMoveIndex];
            const x = move.from.x + (move.to.x - move.from.x) * moveProgress;
            const y = move.from.y + (move.to.y - move.from.y) * moveProgress;
            const z = move.from.z + (move.to.z - move.from.z) * moveProgress;
            this.setToolPosition(x, y, z);
        }
    }

    // ================================================================
    // View controls with smooth animation
    // ================================================================

    setView(viewName) {
        this.animateCameraTo(viewName);
    }

    fitToPath() {
        if (!this.bounds) {
            this.orbitControls?.setView('isometric');
            return;
        }
        
        const center = {
            x: (this.bounds.min.x + this.bounds.max.x) / 2,
            y: (this.bounds.min.y + this.bounds.max.y) / 2,
            z: (this.bounds.min.z + this.bounds.max.z) / 2
        };
        
        const size = Math.max(
            this.bounds.max.x - this.bounds.min.x,
            this.bounds.max.y - this.bounds.min.y,
            this.bounds.max.z - this.bounds.min.z
        );
        
        const distance = size * 2;
        const targetPos = {
            x: center.x + distance * 0.6,
            y: center.z + distance * 0.6,
            z: center.y + distance * 0.6
        };
        
        this.animateCameraToPosition(targetPos, { x: center.x, y: center.z, z: center.y });
    }

    resetView() {
        this.animateCameraTo('isometric');
    }

    // Force resize and render - useful when tab becomes visible
    resize() {
        if (!this.renderer || !this.container) return;
        const width = this.container.clientWidth || 800;
        const height = this.container.clientHeight || 600;
        if (width > 0 && height > 0) {
            this.camera.aspect = width / height;
            this.camera.updateProjectionMatrix();
            this.renderer.setSize(width, height);
            this.renderer.render(this.scene, this.camera);
        }
    }

    // Alias for render method
    render() {
        this.resize();
    }

    // Camera animation presets
    animateCameraTo(viewName, duration = 500) {
        const positions = {
            top: { pos: { x: 0, y: 400, z: 0 }, target: { x: 0, y: 0, z: 0 } },
            front: { pos: { x: 0, y: 100, z: 400 }, target: { x: 0, y: 0, z: 0 } },
            right: { pos: { x: 400, y: 100, z: 0 }, target: { x: 0, y: 0, z: 0 } },
            left: { pos: { x: -400, y: 100, z: 0 }, target: { x: 0, y: 0, z: 0 } },
            back: { pos: { x: 0, y: 100, z: -400 }, target: { x: 0, y: 0, z: 0 } },
            isometric: { pos: { x: 300, y: 300, z: 300 }, target: { x: 0, y: 0, z: 0 } },
            corner1: { pos: { x: -300, y: 300, z: 300 }, target: { x: 0, y: 0, z: 0 } },
            corner2: { pos: { x: 300, y: 300, z: -300 }, target: { x: 0, y: 0, z: 0 } },
            corner3: { pos: { x: -300, y: 300, z: -300 }, target: { x: 0, y: 0, z: 0 } }
        };
        
        const preset = positions[viewName] || positions.isometric;
        this.animateCameraToPosition(preset.pos, preset.target, duration);
    }

    animateCameraToPosition(targetPos, lookAt, duration = 500) {
        if (!this.camera) return;
        
        const startPos = {
            x: this.camera.position.x,
            y: this.camera.position.y,
            z: this.camera.position.z
        };
        
        const startTime = Date.now();
        
        const animateFrame = () => {
            const elapsed = Date.now() - startTime;
            const t = Math.min(elapsed / duration, 1);
            const eased = 1 - Math.pow(1 - t, 3); // Ease out cubic
            
            this.camera.position.set(
                startPos.x + (targetPos.x - startPos.x) * eased,
                startPos.y + (targetPos.y - startPos.y) * eased,
                startPos.z + (targetPos.z - startPos.z) * eased
            );
            
            if (lookAt) {
                this.camera.lookAt(lookAt.x, lookAt.y, lookAt.z);
            }
            
            if (t < 1) {
                requestAnimationFrame(animateFrame);
            }
        };
        
        animateFrame();
    }

    // ================================================================
    // Measurement tools
    // ================================================================

    enableMeasureMode(enable = true) {
        this.measureMode = enable;
        this.measurePoints = [];
        this.clearMeasurement();
        
        if (enable) {
            this.container.style.cursor = 'crosshair';
        } else {
            this.container.style.cursor = 'default';
        }
    }

    handleMeasureClick(event) {
        if (!this.measureMode) return;
        
        const rect = this.container.getBoundingClientRect();
        this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
        
        this.raycaster.setFromCamera(this.mouse, this.camera);
        
        // Intersect with paths
        const allPaths = [...this.pathGroup.children, ...this.rapidGroup.children];
        const intersects = this.raycaster.intersectObjects(allPaths, true);
        
        if (intersects.length > 0) {
            const point = intersects[0].point;
            this.addMeasurePoint(point);
        } else {
            // Intersect with ground plane
            const planeNormal = new THREE.Vector3(0, 1, 0);
            const planePoint = new THREE.Vector3(0, 0, 0);
            const ray = this.raycaster.ray;
            
            const denominator = planeNormal.dot(ray.direction);
            if (Math.abs(denominator) > 0.0001) {
                const t = planePoint.clone().sub(ray.origin).dot(planeNormal) / denominator;
                if (t > 0) {
                    const point = ray.origin.clone().add(ray.direction.clone().multiplyScalar(t));
                    this.addMeasurePoint(point);
                }
            }
        }
    }

    addMeasurePoint(point) {
        // Add visual marker
        const markerGeom = new THREE.SphereGeometry(3, 16, 16);
        const markerMat = new THREE.MeshBasicMaterial({ color: 0xffff00 });
        const marker = new THREE.Mesh(markerGeom, markerMat);
        marker.position.copy(point);
        this.measureGroup.add(marker);
        
        this.measurePoints.push(point.clone());
        
        if (this.measurePoints.length >= 2) {
            this.drawMeasurement();
            this.measurePoints = [];
        }
    }

    drawMeasurement() {
        const p1 = this.measurePoints[0];
        const p2 = this.measurePoints[1];
        
        // Draw line between points
        const lineGeom = new THREE.BufferGeometry().setFromPoints([p1, p2]);
        const lineMat = new THREE.LineBasicMaterial({ 
            color: 0xffff00, 
            linewidth: 2,
            depthTest: false
        });
        const line = new THREE.Line(lineGeom, lineMat);
        line.renderOrder = 999;
        this.measureGroup.add(line);
        
        // Calculate distance (swap Y/Z back to machine coords)
        const dx = p2.x - p1.x;
        const dy = p2.z - p1.z; // Swap back
        const dz = p2.y - p1.y; // Swap back
        const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
        
        // Create text label using CSS
        this.showMeasurementLabel(p1, p2, distance, { dx, dy, dz });
    }

    showMeasurementLabel(p1, p2, distance, deltas) {
        // Create a DOM element for the measurement
        const midPoint = new THREE.Vector3(
            (p1.x + p2.x) / 2,
            (p1.y + p2.y) / 2,
            (p1.z + p2.z) / 2
        );
        
        // Remove existing label
        if (this.measureLabelElement) {
            this.measureLabelElement.remove();
        }
        
        const label = document.createElement('div');
        label.className = 'measure-label';
        label.innerHTML = `
            <strong>${distance.toFixed(2)} mm</strong><br>
            <small>ΔX: ${deltas.dx.toFixed(2)} ΔY: ${deltas.dy.toFixed(2)} ΔZ: ${deltas.dz.toFixed(2)}</small>
        `;
        label.style.cssText = `
            position: absolute;
            background: rgba(0, 0, 0, 0.9);
            color: #ffff00;
            padding: 8px 12px;
            border-radius: 6px;
            font-family: monospace;
            font-size: 12px;
            pointer-events: none;
            z-index: 1000;
            border: 1px solid #ffff00;
            white-space: nowrap;
        `;
        
        this.container.appendChild(label);
        this.measureLabelElement = label;
        
        // Update label position each frame
        this.measureLabelMidpoint = midPoint;
        this.updateMeasureLabelPosition();
    }

    updateMeasureLabelPosition() {
        if (!this.measureLabelElement || !this.measureLabelMidpoint) return;
        
        const vector = this.measureLabelMidpoint.clone();
        vector.project(this.camera);
        
        const rect = this.container.getBoundingClientRect();
        const x = (vector.x * 0.5 + 0.5) * rect.width;
        const y = (-(vector.y * 0.5) + 0.5) * rect.height;
        
        this.measureLabelElement.style.left = `${x + 10}px`;
        this.measureLabelElement.style.top = `${y - 10}px`;
    }

    clearMeasurement() {
        while (this.measureGroup.children.length > 0) {
            const obj = this.measureGroup.children[0];
            if (obj.geometry) obj.geometry.dispose();
            if (obj.material) obj.material.dispose();
            this.measureGroup.remove(obj);
        }
        
        if (this.measureLabelElement) {
            this.measureLabelElement.remove();
            this.measureLabelElement = null;
        }
        this.measureLabelMidpoint = null;
    }

    // ================================================================
    // Path highlighting
    // ================================================================

    highlightLine(lineNumber) {
        if (lineNumber === this.highlightedLine) return;
        this.highlightedLine = lineNumber;
        
        // Clear existing highlights
        while (this.highlightGroup.children.length > 0) {
            const obj = this.highlightGroup.children[0];
            if (obj.geometry) obj.geometry.dispose();
            if (obj.material) obj.material.dispose();
            this.highlightGroup.remove(obj);
        }
        
        if (lineNumber < 0) return;
        
        // Find segments for this line
        const segments = this.gcodeParser.getSegmentsForLine(lineNumber);
        if (!segments.length) return;
        
        // Create highlighted path
        const points = [];
        for (const seg of segments) {
            if (seg.type === 'arc') {
                points.push(...this.interpolateArc(seg));
            } else {
                points.push(
                    new THREE.Vector3(seg.from.x, seg.from.z, seg.from.y),
                    new THREE.Vector3(seg.to.x, seg.to.z, seg.to.y)
                );
            }
        }
        
        if (points.length) {
            const geom = new THREE.BufferGeometry().setFromPoints(points);
            const mat = new THREE.LineBasicMaterial({ 
                color: this.config.highlightColor,
                linewidth: 4,
                depthTest: false
            });
            const line = new THREE.LineSegments(geom, mat);
            line.renderOrder = 998;
            this.highlightGroup.add(line);
        }
    }

    highlightTool(toolNumber) {
        // Highlight all paths for a specific tool
        while (this.highlightGroup.children.length > 0) {
            const obj = this.highlightGroup.children[0];
            if (obj.geometry) obj.geometry.dispose();
            if (obj.material) obj.material.dispose();
            this.highlightGroup.remove(obj);
        }
        
        const segments = this.gcodeParser.getSegmentsForTool(toolNumber);
        this.highlightSegments(segments);
    }

    highlightZRange(minZ, maxZ) {
        // Highlight segments in Z range
        while (this.highlightGroup.children.length > 0) {
            const obj = this.highlightGroup.children[0];
            if (obj.geometry) obj.geometry.dispose();
            if (obj.material) obj.material.dispose();
            this.highlightGroup.remove(obj);
        }
        
        const segments = this.gcodeParser.getSegmentsInZRange(minZ, maxZ);
        this.highlightSegments(segments);
    }

    highlightSegments(segments) {
        if (!segments.length) return;
        
        const points = [];
        for (const seg of segments) {
            if (seg.type === 'arc') {
                points.push(...this.interpolateArc(seg));
            } else {
                points.push(
                    new THREE.Vector3(seg.from.x, seg.from.z, seg.from.y),
                    new THREE.Vector3(seg.to.x, seg.to.z, seg.to.y)
                );
            }
        }
        
        if (points.length) {
            const geom = new THREE.BufferGeometry().setFromPoints(points);
            const mat = new THREE.LineBasicMaterial({ 
                color: this.config.highlightColor,
                linewidth: 4,
                transparent: true,
                opacity: 0.8
            });
            const line = new THREE.LineSegments(geom, mat);
            this.highlightGroup.add(line);
        }
    }

    clearHighlight() {
        this.highlightedLine = -1;
        while (this.highlightGroup.children.length > 0) {
            const obj = this.highlightGroup.children[0];
            if (obj.geometry) obj.geometry.dispose();
            if (obj.material) obj.material.dispose();
            this.highlightGroup.remove(obj);
        }
    }

    // ================================================================
    // Toggle visibility
    // ================================================================

    toggleRapids(show) {
        this.config.showRapids = show;
        if (this.rapidGroup) {
            this.rapidGroup.visible = show;
        }
    }

    toggleGrid(show) {
        if (this.gridHelper) {
            this.gridHelper.visible = show;
        }
    }

    toggleAxes(show) {
        if (this.axisHelper) {
            this.axisHelper.visible = show;
        }
    }

    toggleTool(show) {
        if (this.toolMesh) {
            this.toolMesh.visible = show;
        }
    }

    // ================================================================
    // Path statistics
    // ================================================================

    getPathStats() {
        const stats = this.gcodeParser.parse(''); // Get last parsed stats
        const analysis = this.gcodeParser.getAnalysis();
        
        return {
            ...stats,
            analysis,
            bounds: this.bounds,
            toolPath: this.toolPath.length
        };
    }

    // ================================================================
    // Screenshot / Export
    // ================================================================

    takeScreenshot(filename = 'gcode-preview.png') {
        if (!this.renderer) return null;
        
        this.renderer.render(this.scene, this.camera);
        const dataUrl = this.renderer.domElement.toDataURL('image/png');
        
        // Trigger download
        const link = document.createElement('a');
        link.download = filename;
        link.href = dataUrl;
        link.click();
        
        return dataUrl;
    }

    // ================================================================
    // Render loop
    // ================================================================

    animate() {
        if (!this.renderer) return;

        // Store frame ID for cleanup
        this.animationFrameId = requestAnimationFrame(() => this.animate());

        // Animation update
        if (this.isAnimating) {
            this.animationProgress += 0.001 * this.animationSpeed;
            if (this.animationProgress >= 1) {
                this.animationProgress = 0;
            }
            this.updateAnimatedPath();
        }

        // Tool glow animation
        if (this.toolMesh) {
            const glow = this.toolMesh.children[3];
            if (glow) {
                glow.scale.setScalar(1 + Math.sin(Date.now() * 0.005) * 0.2);
            }
        }

        // Update measure label position
        this.updateMeasureLabelPosition();

        this.renderer.render(this.scene, this.camera);
    }

    // ================================================================
    // Cleanup
    // ================================================================

    dispose() {
        // Cancel animation frame
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }
        
        // Disconnect resize observer
        if (this.resizeObserver) {
            this.resizeObserver.disconnect();
            this.resizeObserver = null;
        }
        
        // Remove keyboard event listener
        if (this.keydownHandler) {
            document.removeEventListener('keydown', this.keydownHandler);
        }
        
        // Remove DOM elements
        if (this.measureLabelElement) {
            this.measureLabelElement.remove();
        }
        
        if (this.renderer) {
            this.renderer.dispose();
            this.container?.removeChild(this.renderer.domElement);
        }
        
        // Dispose geometries and materials
        this.scene?.traverse(obj => {
            if (obj.geometry) obj.geometry.dispose();
            if (obj.material) {
                if (Array.isArray(obj.material)) {
                    obj.material.forEach(m => m.dispose());
                } else {
                    obj.material.dispose();
                }
            }
        });
        
        // Clear references
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        
        console.log('[Visualizer3D] Disposed');
    }
}

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
    module.exports = GCodeVisualizer3D;
}
