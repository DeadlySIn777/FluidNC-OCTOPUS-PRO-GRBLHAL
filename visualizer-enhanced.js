/* ========================================
   FluidCNC - PREMIUM 3D Visualizer
   Absolutely stunning live cutting visualization
   
   Features:
   - Realistic material removal simulation
   - Volumetric chip particles
   - Toolpath glow trails
   - Depth-based path coloring
   - Real-time material preview
   - Cinematic lighting
   - Post-processing effects
   ======================================== */

class EnhancedVisualizer extends GCodeVisualizer3D {
    constructor(options = {}) {
        // Set up enhanced config BEFORE calling super, because parent's animate() might run
        // This is a workaround for the inheritance issue
        
        // We can't use 'this' before super(), so we'll initialize enhancedConfig to null first
        // and the animate() override checks for it
        
        super(options);
        
        // Enhanced configuration - NOW we can use 'this'
        this.enhancedConfig = {
            // Material simulation
            showMaterialRemoval: true,
            materialColor: 0x8B7355,           // Wood brown
            materialMetalness: 0.1,
            materialRoughness: 0.8,
            cutMaterialColor: 0xDEB887,        // Fresh cut color
            
            // Stock dimensions
            stock: options.stock || { x: 200, y: 150, z: 25 },
            stockPosition: options.stockPosition || { x: 0, y: 0, z: 0 },
            
            // Particle effects
            enableParticles: true,
            particleCount: 500,
            chipColor: 0xDEB887,
            
            // Glow trails
            enableGlowTrails: true,
            trailLength: 50,
            trailOpacity: 0.6,
            
            // Depth coloring
            enableDepthColors: true,
            depthColorMap: [
                { depth: 0, color: 0x00ff88 },    // Surface - green
                { depth: 5, color: 0x00aaff },    // 5mm - blue
                { depth: 10, color: 0xffaa00 },   // 10mm - orange
                { depth: 20, color: 0xff4444 }    // Deep - red
            ],
            
            // Cinematic mode
            cinematicMode: false,
            autoRotate: false,
            autoRotateSpeed: 0.5,
            
            // Post processing
            enableBloom: true,
            bloomStrength: 0.8,
            enableSSAO: false  // Expensive but pretty
        };
        
        // State for enhanced features
        this.materialMesh = null;
        this.materialCSG = null;
        this.particleSystem = null;
        this.glowTrail = [];
        this.cutHistory = [];
        this.activelyMachining = false;
        this.lastCutPosition = null;
        this.spindleSpeed = 0;
        
        // Initialize enhanced features
        this.initEnhancedFeatures();
    }
    
    initEnhancedFeatures() {
        if (!this.scene) return;
        
        // Create stock material
        this.createStockMaterial();
        
        // Create particle system for chips
        this.createParticleSystem();
        
        // Create glow trail geometry
        this.createGlowTrail();
        
        // Enhanced lighting for cutting
        this.setupCuttingLights();
        
        // Create HUD overlay
        this.createHUD();
        
        console.log('[EnhancedVisualizer] Premium features initialized');
    }
    
    // ================================================================
    // STOCK MATERIAL WITH REAL-TIME REMOVAL
    // ================================================================
    
    createStockMaterial() {
        const { x, y, z } = this.enhancedConfig.stock;
        const { x: px, y: py, z: pz } = this.enhancedConfig.stockPosition;
        
        // Create stock geometry
        const geometry = new THREE.BoxGeometry(x, z, y, 32, 32, 32);
        
        // Create material with cutting-friendly shader
        const material = new THREE.MeshStandardMaterial({
            color: this.enhancedConfig.materialColor,
            metalness: this.enhancedConfig.materialMetalness,
            roughness: this.enhancedConfig.materialRoughness,
            side: THREE.DoubleSide
        });
        
        // Add wood grain texture procedurally
        this.addWoodGrainTexture(material);
        
        this.materialMesh = new THREE.Mesh(geometry, material);
        this.materialMesh.position.set(px + x/2, pz + z/2, py + y/2);
        this.materialMesh.castShadow = true;
        this.materialMesh.receiveShadow = true;
        
        this.scene.add(this.materialMesh);
        
        // Create cut overlay mesh (shows removed material)
        this.createCutOverlay();
    }
    
    addWoodGrainTexture(material) {
        // Create procedural wood grain using canvas
        const canvas = document.createElement('canvas');
        canvas.width = 512;
        canvas.height = 512;
        const ctx = canvas.getContext('2d');
        
        // Base color
        ctx.fillStyle = '#8B7355';
        ctx.fillRect(0, 0, 512, 512);
        
        // Wood grain lines
        ctx.strokeStyle = '#6B5344';
        ctx.lineWidth = 2;
        
        for (let i = 0; i < 50; i++) {
            const y = Math.random() * 512;
            const amplitude = 5 + Math.random() * 10;
            const frequency = 0.01 + Math.random() * 0.02;
            
            ctx.beginPath();
            for (let x = 0; x < 512; x++) {
                const yOffset = Math.sin(x * frequency) * amplitude;
                if (x === 0) ctx.moveTo(x, y + yOffset);
                else ctx.lineTo(x, y + yOffset);
            }
            ctx.stroke();
        }
        
        // Add some darker knots
        for (let i = 0; i < 3; i++) {
            const x = Math.random() * 512;
            const y = Math.random() * 512;
            const r = 10 + Math.random() * 20;
            
            const gradient = ctx.createRadialGradient(x, y, 0, x, y, r);
            gradient.addColorStop(0, '#3d2817');
            gradient.addColorStop(0.5, '#5a3d2a');
            gradient.addColorStop(1, 'transparent');
            
            ctx.fillStyle = gradient;
            ctx.beginPath();
            ctx.arc(x, y, r, 0, Math.PI * 2);
            ctx.fill();
        }
        
        const texture = new THREE.CanvasTexture(canvas);
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        texture.repeat.set(2, 2);
        
        material.map = texture;
        material.needsUpdate = true;
    }
    
    createCutOverlay() {
        // This mesh will show the cut areas with fresh wood color
        const { x, y, z } = this.enhancedConfig.stock;
        const { x: px, y: py, z: pz } = this.enhancedConfig.stockPosition;
        
        // Heightmap for tracking cuts
        this.cutHeightmap = new Float32Array(64 * 64).fill(z);
        
        // Create a plane geometry that will be deformed to show cuts
        const geometry = new THREE.PlaneGeometry(x, y, 63, 63);
        geometry.rotateX(-Math.PI / 2);
        
        const material = new THREE.MeshStandardMaterial({
            color: this.enhancedConfig.cutMaterialColor,
            metalness: 0,
            roughness: 0.9,
            side: THREE.DoubleSide,
            transparent: true,
            opacity: 0
        });
        
        this.cutSurface = new THREE.Mesh(geometry, material);
        this.cutSurface.position.set(px + x/2, pz + z + 0.1, py + y/2);
        this.scene.add(this.cutSurface);
    }
    
    updateCutAt(x, y, depth, toolDiameter = 6) {
        if (!this.cutHeightmap) return;
        
        const stock = this.enhancedConfig.stock;
        const stockPos = this.enhancedConfig.stockPosition;
        
        // Convert world coords to heightmap indices
        const relX = x - stockPos.x;
        const relY = y - stockPos.y;
        
        const gridX = Math.floor((relX / stock.x) * 64);
        const gridY = Math.floor((relY / stock.y) * 64);
        const radius = Math.ceil((toolDiameter / 2) / stock.x * 64);
        
        let modified = false;
        
        // Update heightmap in tool radius
        for (let dx = -radius; dx <= radius; dx++) {
            for (let dy = -radius; dy <= radius; dy++) {
                const dist = Math.sqrt(dx*dx + dy*dy);
                if (dist > radius) continue;
                
                const gx = gridX + dx;
                const gy = gridY + dy;
                
                if (gx >= 0 && gx < 64 && gy >= 0 && gy < 64) {
                    const idx = gy * 64 + gx;
                    const currentDepth = stock.z - this.cutHeightmap[idx];
                    const newDepth = stock.z - depth;
                    
                    if (newDepth > currentDepth) {
                        this.cutHeightmap[idx] = depth;
                        modified = true;
                    }
                }
            }
        }
        
        if (modified) {
            this.updateCutSurfaceGeometry();
        }
    }
    
    updateCutSurfaceGeometry() {
        if (!this.cutSurface) return;
        
        const positions = this.cutSurface.geometry.attributes.position;
        const stock = this.enhancedConfig.stock;
        
        for (let i = 0; i < positions.count; i++) {
            const gridX = i % 64;
            const gridY = Math.floor(i / 64);
            const height = this.cutHeightmap[gridY * 64 + gridX];
            
            // Only show if cut below surface
            if (height < stock.z) {
                positions.setY(i, height);
            }
        }
        
        positions.needsUpdate = true;
        this.cutSurface.geometry.computeVertexNormals();
        
        // Make cut surface visible
        this.cutSurface.material.opacity = 0.95;
    }
    
    // ================================================================
    // PARTICLE SYSTEM FOR CHIPS
    // ================================================================
    
    createParticleSystem() {
        if (!this.enhancedConfig.enableParticles) return;
        
        const particleCount = this.enhancedConfig.particleCount;
        
        // Create particle geometry
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(particleCount * 3);
        const velocities = new Float32Array(particleCount * 3);
        const lifetimes = new Float32Array(particleCount);
        const sizes = new Float32Array(particleCount);
        
        // Initialize all particles as "dead" (lifetime = 0)
        for (let i = 0; i < particleCount; i++) {
            positions[i * 3] = 0;
            positions[i * 3 + 1] = -1000;
            positions[i * 3 + 2] = 0;
            velocities[i * 3] = 0;
            velocities[i * 3 + 1] = 0;
            velocities[i * 3 + 2] = 0;
            lifetimes[i] = 0;
            sizes[i] = 0;
        }
        
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('velocity', new THREE.BufferAttribute(velocities, 3));
        geometry.setAttribute('lifetime', new THREE.BufferAttribute(lifetimes, 1));
        geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
        
        // Custom shader material for particles
        const material = new THREE.PointsMaterial({
            color: this.enhancedConfig.chipColor,
            size: 3,
            transparent: true,
            opacity: 0.8,
            sizeAttenuation: true,
            blending: THREE.AdditiveBlending
        });
        
        this.particleSystem = new THREE.Points(geometry, material);
        this.particleNextIndex = 0;
        this.scene.add(this.particleSystem);
    }
    
    emitChips(position, intensity = 1, direction = null) {
        if (!this.particleSystem) return;
        
        const positions = this.particleSystem.geometry.attributes.position;
        const velocities = this.particleSystem.geometry.attributes.velocity;
        const lifetimes = this.particleSystem.geometry.attributes.lifetime;
        
        // Emit several particles
        const count = Math.floor(3 * intensity);
        
        for (let j = 0; j < count; j++) {
            const i = this.particleNextIndex;
            this.particleNextIndex = (this.particleNextIndex + 1) % this.enhancedConfig.particleCount;
            
            positions.setXYZ(i, position.x, position.z, position.y);
            
            // Random velocity (mostly upward with spread)
            const speed = 2 + Math.random() * 3;
            const angle = Math.random() * Math.PI * 2;
            
            let vx = Math.cos(angle) * speed * 0.5;
            let vy = 1 + Math.random() * 2; // Upward
            let vz = Math.sin(angle) * speed * 0.5;
            
            // Add spindle rotation effect if available
            if (this.spindleSpeed > 0 && direction) {
                const rotationEffect = this.spindleSpeed / 10000;
                vx += direction.x * rotationEffect;
                vz += direction.y * rotationEffect;
            }
            
            velocities.setXYZ(i, vx, vy, vz);
            lifetimes.setX(i, 1.0);
        }
        
        positions.needsUpdate = true;
        velocities.needsUpdate = true;
        lifetimes.needsUpdate = true;
    }
    
    updateParticles(deltaTime) {
        if (!this.particleSystem) return;
        
        const positions = this.particleSystem.geometry.attributes.position;
        const velocities = this.particleSystem.geometry.attributes.velocity;
        const lifetimes = this.particleSystem.geometry.attributes.lifetime;
        
        const gravity = -9.8 * deltaTime;
        
        for (let i = 0; i < this.enhancedConfig.particleCount; i++) {
            let life = lifetimes.getX(i);
            
            if (life > 0) {
                // Update position
                let x = positions.getX(i);
                let y = positions.getY(i);
                let z = positions.getZ(i);
                let vx = velocities.getX(i);
                let vy = velocities.getY(i);
                let vz = velocities.getZ(i);
                
                // Apply gravity
                vy += gravity;
                
                // Update position
                x += vx * deltaTime * 50;
                y += vy * deltaTime * 50;
                z += vz * deltaTime * 50;
                
                // Decrease lifetime
                life -= deltaTime * 2;
                
                // Check for ground collision
                if (y < 0) {
                    y = 0;
                    vy = 0;
                    life -= 0.2; // Die faster on ground
                }
                
                positions.setXYZ(i, x, y, z);
                velocities.setXYZ(i, vx, vy, vz);
                lifetimes.setX(i, Math.max(0, life));
            }
        }
        
        positions.needsUpdate = true;
        velocities.needsUpdate = true;
        lifetimes.needsUpdate = true;
    }
    
    // ================================================================
    // GLOW TRAIL EFFECT
    // ================================================================
    
    createGlowTrail() {
        if (!this.enhancedConfig.enableGlowTrails) return;
        
        // Create a line with gradient that follows the tool
        const maxPoints = this.enhancedConfig.trailLength;
        
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(maxPoints * 3);
        const colors = new Float32Array(maxPoints * 3);
        
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        
        const material = new THREE.LineBasicMaterial({
            vertexColors: true,
            transparent: true,
            opacity: this.enhancedConfig.trailOpacity,
            blending: THREE.AdditiveBlending,
            linewidth: 3
        });
        
        this.trailLine = new THREE.Line(geometry, material);
        this.trailPoints = [];
        this.scene.add(this.trailLine);
        
        // Create glow sprite that follows tool
        const glowTexture = this.createGlowTexture();
        const spriteMaterial = new THREE.SpriteMaterial({
            map: glowTexture,
            color: 0x00ff88,
            transparent: true,
            blending: THREE.AdditiveBlending,
            opacity: 0.8
        });
        
        this.toolGlow = new THREE.Sprite(spriteMaterial);
        this.toolGlow.scale.set(30, 30, 1);
        this.scene.add(this.toolGlow);
    }
    
    createGlowTexture() {
        const canvas = document.createElement('canvas');
        canvas.width = 128;
        canvas.height = 128;
        const ctx = canvas.getContext('2d');
        
        const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
        gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
        gradient.addColorStop(0.2, 'rgba(0, 255, 136, 0.8)');
        gradient.addColorStop(0.5, 'rgba(0, 212, 255, 0.4)');
        gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
        
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, 128, 128);
        
        return new THREE.CanvasTexture(canvas);
    }
    
    updateGlowTrail(position) {
        if (!this.trailLine) return;
        
        // Add new point
        this.trailPoints.push({ 
            x: position.x, 
            y: position.z,  // Y/Z swap
            z: position.y,
            time: Date.now() 
        });
        
        // Limit trail length
        const maxPoints = this.enhancedConfig.trailLength;
        if (this.trailPoints.length > maxPoints) {
            this.trailPoints.shift();
        }
        
        // Update geometry
        const positions = this.trailLine.geometry.attributes.position;
        const colors = this.trailLine.geometry.attributes.color;
        
        for (let i = 0; i < maxPoints; i++) {
            if (i < this.trailPoints.length) {
                const pt = this.trailPoints[i];
                positions.setXYZ(i, pt.x, pt.y, pt.z);
                
                // Fade color based on age (newest = bright, oldest = dim)
                const age = (i / this.trailPoints.length);
                const color = this.getDepthColor(pt.y);
                colors.setXYZ(i, 
                    ((color >> 16) & 0xFF) / 255 * age,
                    ((color >> 8) & 0xFF) / 255 * age,
                    (color & 0xFF) / 255 * age
                );
            } else {
                positions.setXYZ(i, 0, -1000, 0);
                colors.setXYZ(i, 0, 0, 0);
            }
        }
        
        positions.needsUpdate = true;
        colors.needsUpdate = true;
        this.trailLine.geometry.setDrawRange(0, this.trailPoints.length);
        
        // Update glow sprite position
        if (this.toolGlow) {
            this.toolGlow.position.set(position.x, position.z - 30, position.y);
            
            // Pulse based on spindle speed
            const pulse = 1 + Math.sin(Date.now() * 0.01) * 0.3;
            const scale = 20 + (this.activelyMachining ? 15 : 0) * pulse;
            this.toolGlow.scale.set(scale, scale, 1);
            
            // Change color based on machining state
            this.toolGlow.material.color.setHex(
                this.activelyMachining ? 0xff6600 : 0x00ff88
            );
        }
    }
    
    // ================================================================
    // DEPTH-BASED PATH COLORING
    // ================================================================
    
    getDepthColor(z) {
        if (!this.enhancedConfig.enableDepthColors) {
            return this.config.cutColor;
        }
        
        const depthMap = this.enhancedConfig.depthColorMap;
        const stockTop = this.enhancedConfig.stock.z + this.enhancedConfig.stockPosition.z;
        const depth = stockTop - z;
        
        // Find appropriate color
        let color1 = depthMap[0];
        let color2 = depthMap[depthMap.length - 1];
        
        for (let i = 0; i < depthMap.length - 1; i++) {
            if (depth >= depthMap[i].depth && depth < depthMap[i + 1].depth) {
                color1 = depthMap[i];
                color2 = depthMap[i + 1];
                break;
            }
        }
        
        // Interpolate
        const t = (depth - color1.depth) / Math.max(0.1, color2.depth - color1.depth);
        return this.lerpColor(color1.color, color2.color, Math.max(0, Math.min(1, t)));
    }
    
    lerpColor(c1, c2, t) {
        const r1 = (c1 >> 16) & 0xFF;
        const g1 = (c1 >> 8) & 0xFF;
        const b1 = c1 & 0xFF;
        
        const r2 = (c2 >> 16) & 0xFF;
        const g2 = (c2 >> 8) & 0xFF;
        const b2 = c2 & 0xFF;
        
        const r = Math.round(r1 + (r2 - r1) * t);
        const g = Math.round(g1 + (g2 - g1) * t);
        const b = Math.round(b1 + (b2 - b1) * t);
        
        return (r << 16) | (g << 8) | b;
    }
    
    // Override buildPathGeometry to use depth colors
    buildPathGeometry() {
        // Guard: pathGroup must exist (Three.js may not be loaded)
        if (!this.pathGroup) {
            console.warn('[EnhancedVisualizer] pathGroup not initialized - Three.js may not be loaded');
            return;
        }
        
        // Clear existing paths
        while (this.pathGroup.children.length) {
            const child = this.pathGroup.children[0];
            child.geometry?.dispose();
            child.material?.dispose();
            this.pathGroup.remove(child);
        }

        if (!this.toolPath.length) return;

        // Build path with per-vertex colors
        const positions = [];
        const colors = [];
        const rapidPositions = [];
        const rapidColors = [];

        for (const move of this.toolPath) {
            const from = new THREE.Vector3(move.from.x, move.from.z, move.from.y);
            const to = new THREE.Vector3(move.to.x, move.to.z, move.to.y);

            if (move.type === 'rapid') {
                rapidPositions.push(from.x, from.y, from.z, to.x, to.y, to.z);
                // Dim blue for rapids
                rapidColors.push(0.2, 0.5, 0.8, 0.2, 0.5, 0.8);
            } else if (move.type === 'arc') {
                const points = this.interpolateArc(move);
                for (let i = 0; i < points.length; i++) {
                    const pt = points[i];
                    positions.push(pt.x, pt.y, pt.z);
                    const color = this.getDepthColor(pt.y);
                    colors.push(
                        ((color >> 16) & 0xFF) / 255,
                        ((color >> 8) & 0xFF) / 255,
                        (color & 0xFF) / 255
                    );
                }
            } else {
                // Linear cut - color by depth
                positions.push(from.x, from.y, from.z);
                positions.push(to.x, to.y, to.z);
                
                const colorFrom = this.getDepthColor(from.y);
                const colorTo = this.getDepthColor(to.y);
                
                colors.push(
                    ((colorFrom >> 16) & 0xFF) / 255,
                    ((colorFrom >> 8) & 0xFF) / 255,
                    (colorFrom & 0xFF) / 255
                );
                colors.push(
                    ((colorTo >> 16) & 0xFF) / 255,
                    ((colorTo >> 8) & 0xFF) / 255,
                    (colorTo & 0xFF) / 255
                );
            }
        }

        // Create cut path with colors
        if (positions.length) {
            const geom = new THREE.BufferGeometry();
            geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
            geom.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
            
            const mat = new THREE.LineBasicMaterial({ 
                vertexColors: true,
                linewidth: 2,
                transparent: true,
                opacity: 0.9
            });
            
            this.pathGroup.add(new THREE.LineSegments(geom, mat));
        }

        // Create rapid path
        if (rapidPositions.length) {
            const geom = new THREE.BufferGeometry();
            geom.setAttribute('position', new THREE.Float32BufferAttribute(rapidPositions, 3));
            geom.setAttribute('color', new THREE.Float32BufferAttribute(rapidColors, 3));
            
            const mat = new THREE.LineBasicMaterial({ 
                vertexColors: true,
                transparent: true, 
                opacity: 0.3,
                linewidth: 1
            });
            
            this.pathGroup.add(new THREE.LineSegments(geom, mat));
        }
        
        // Create tube geometry for thick visible path
        this.createTubePathGeometry();
    }
    
    createTubePathGeometry() {
        // Create thicker tubes for cutting moves for better visibility
        if (!this.toolPath.length) return;
        
        // Collect continuous cut segments
        const segments = [];
        let currentSegment = [];
        
        for (const move of this.toolPath) {
            if (move.type !== 'rapid') {
                if (currentSegment.length === 0) {
                    currentSegment.push(new THREE.Vector3(move.from.x, move.from.z, move.from.y));
                }
                currentSegment.push(new THREE.Vector3(move.to.x, move.to.z, move.to.y));
            } else if (currentSegment.length > 1) {
                segments.push(currentSegment);
                currentSegment = [];
            }
        }
        
        if (currentSegment.length > 1) {
            segments.push(currentSegment);
        }
        
        // Create tube for each segment
        for (const segment of segments) {
            if (segment.length < 2) continue;
            
            try {
                const curve = new THREE.CatmullRomCurve3(segment);
                const tubeGeom = new THREE.TubeGeometry(curve, segment.length * 2, 0.5, 8, false);
                
                // Color based on average depth
                const avgY = segment.reduce((s, p) => s + p.y, 0) / segment.length;
                const color = this.getDepthColor(avgY);
                
                const tubeMat = new THREE.MeshStandardMaterial({
                    color,
                    emissive: color,
                    emissiveIntensity: 0.3,
                    metalness: 0.3,
                    roughness: 0.5,
                    transparent: true,
                    opacity: 0.7
                });
                
                const tube = new THREE.Mesh(tubeGeom, tubeMat);
                this.pathGroup.add(tube);
            } catch (e) {
                // Skip if curve creation fails
            }
        }
    }
    
    // ================================================================
    // CINEMATIC LIGHTING FOR CUTTING
    // ================================================================
    
    setupCuttingLights() {
        // Cutting spot light (follows tool)
        this.cuttingLight = new THREE.SpotLight(0xff6600, 0, 200, Math.PI / 6, 0.5, 2);
        this.cuttingLight.position.set(0, 100, 0);
        this.scene.add(this.cuttingLight);
        
        // Cutting point light (at tool tip)
        this.toolLight = new THREE.PointLight(0x00ff88, 0, 50);
        this.scene.add(this.toolLight);
    }
    
    // ================================================================
    // HUD OVERLAY
    // ================================================================
    
    createHUD() {
        // Create overlay container
        const hud = document.createElement('div');
        hud.className = 'visualizer-hud';
        hud.innerHTML = `
            <div class="hud-section hud-position">
                <div class="hud-label">POSITION</div>
                <div class="hud-value" id="hud-x"><span class="axis-x">X</span> <span>0.000</span></div>
                <div class="hud-value" id="hud-y"><span class="axis-y">Y</span> <span>0.000</span></div>
                <div class="hud-value" id="hud-z"><span class="axis-z">Z</span> <span>0.000</span></div>
            </div>
            <div class="hud-section hud-feeds">
                <div class="hud-label">FEED</div>
                <div class="hud-value" id="hud-feed">0 <small>mm/min</small></div>
                <div class="hud-label">SPINDLE</div>
                <div class="hud-value" id="hud-spindle">0 <small>RPM</small></div>
            </div>
            <div class="hud-section hud-progress">
                <div class="hud-label">PROGRESS</div>
                <div class="hud-progress-bar">
                    <div class="hud-progress-fill" id="hud-progress-fill"></div>
                </div>
                <div class="hud-value" id="hud-progress-text">0%</div>
            </div>
            <div class="hud-depth-indicator" id="hud-depth">
                <div class="depth-scale">
                    <div class="depth-mark" style="top: 0%">0mm</div>
                    <div class="depth-mark" style="top: 33%">5mm</div>
                    <div class="depth-mark" style="top: 66%">15mm</div>
                    <div class="depth-mark" style="top: 100%">25mm</div>
                </div>
                <div class="depth-indicator" id="depth-indicator"></div>
            </div>
        `;
        
        this.container.appendChild(hud);
        this.hud = hud;
    }
    
    updateHUD(data) {
        if (!this.hud) return;
        
        if (data.position) {
            this.hud.querySelector('#hud-x span:last-child').textContent = data.position.x.toFixed(3);
            this.hud.querySelector('#hud-y span:last-child').textContent = data.position.y.toFixed(3);
            this.hud.querySelector('#hud-z span:last-child').textContent = data.position.z.toFixed(3);
            
            // Update depth indicator
            const stockTop = this.enhancedConfig.stock.z + this.enhancedConfig.stockPosition.z;
            const depth = Math.max(0, stockTop - data.position.z);
            const maxDepth = this.enhancedConfig.stock.z;
            const depthPercent = Math.min(100, (depth / maxDepth) * 100);
            
            const indicator = this.hud.querySelector('#depth-indicator');
            if (indicator) {
                indicator.style.top = `${depthPercent}%`;
                indicator.style.background = '#' + this.getDepthColor(data.position.z).toString(16).padStart(6, '0');
            }
        }
        
        if (data.feedRate !== undefined) {
            this.hud.querySelector('#hud-feed').innerHTML = `${Math.round(data.feedRate)} <small>mm/min</small>`;
        }
        
        if (data.spindleSpeed !== undefined) {
            this.hud.querySelector('#hud-spindle').innerHTML = `${Math.round(data.spindleSpeed)} <small>RPM</small>`;
            this.spindleSpeed = data.spindleSpeed;
        }
        
        if (data.progress !== undefined) {
            this.hud.querySelector('#hud-progress-fill').style.width = `${data.progress}%`;
            this.hud.querySelector('#hud-progress-text').textContent = `${data.progress.toFixed(1)}%`;
        }
    }
    
    // ================================================================
    // LIVE MACHINING UPDATE
    // ================================================================
    
    setToolPosition(x, y, z, feedRate = 0, spindleSpeed = 0) {
        // Call parent
        super.setToolPosition(x, y, z);
        
        // Enhanced effects
        const position = { x, y, z };
        
        // Update glow trail
        if (this.activelyMachining) {
            this.updateGlowTrail(position);
        }
        
        // Update HUD
        this.updateHUD({
            position: { x, y, z },
            feedRate,
            spindleSpeed
        });
        
        // Update cutting lights
        if (this.cuttingLight) {
            this.cuttingLight.position.set(x, z + 100, y);
            this.cuttingLight.target.position.set(x, z, y);
            this.cuttingLight.intensity = this.activelyMachining ? 2 : 0;
        }
        
        if (this.toolLight) {
            this.toolLight.position.set(x, z - 25, y);
            this.toolLight.intensity = this.activelyMachining ? 1.5 : 0.3;
        }
        
        // Emit particles if cutting
        if (this.activelyMachining && feedRate > 0 && this.lastCutPosition) {
            const dist = Math.sqrt(
                Math.pow(x - this.lastCutPosition.x, 2) +
                Math.pow(y - this.lastCutPosition.y, 2)
            );
            
            if (dist > 0.5) {
                const intensity = Math.min(2, feedRate / 1000);
                const direction = {
                    x: x - this.lastCutPosition.x,
                    y: y - this.lastCutPosition.y
                };
                this.emitChips(position, intensity, direction);
                
                // Update material removal
                if (z < this.enhancedConfig.stock.z + this.enhancedConfig.stockPosition.z) {
                    this.updateCutAt(x, y, z);
                }
            }
        }
        
        this.lastCutPosition = { x, y, z };
    }
    
    setMachiningState(isMachining) {
        this.activelyMachining = isMachining;
        
        if (isMachining && !this.trailPoints.length) {
            this.trailPoints = [];
        }
    }
    
    // ================================================================
    // ENHANCED ANIMATION LOOP
    // ================================================================
    
    animate() {
        if (!this.renderer) return;
        
        // Guard: enhancedConfig may not exist if called from parent constructor
        if (!this.enhancedConfig) {
            this.animationFrameId = requestAnimationFrame(() => this.animate());
            this.renderer.render(this.scene, this.camera);
            return;
        }

        const deltaTime = 0.016; // Approx 60fps
        
        // Store the frame ID so we can cancel it in dispose()
        this.animationFrameId = requestAnimationFrame(() => this.animate());

        // Animation update
        if (this.isAnimating) {
            this.animationProgress += 0.001 * this.animationSpeed;
            if (this.animationProgress >= 1) {
                this.animationProgress = 0;
            }
            this.updateAnimatedPath();
            
            // Update HUD progress
            this.updateHUD({ progress: this.animationProgress * 100 });
        }
        
        // Update particles
        this.updateParticles(deltaTime);

        // Tool glow animation
        if (this.toolMesh) {
            const glow = this.toolMesh.children[3];
            if (glow) {
                const pulse = 1 + Math.sin(Date.now() * 0.005) * 0.3;
                glow.scale.setScalar(pulse);
                
                // Change glow color based on machining state
                glow.material.color.setHex(
                    this.activelyMachining ? 0xff6600 : 0x00ff88
                );
                glow.material.opacity = this.activelyMachining ? 0.6 : 0.3;
            }
            
            // Rotate spindle when machining
            if (this.activelyMachining && this.spindleSpeed > 0) {
                this.toolMesh.rotation.y += this.spindleSpeed / 60000 * Math.PI * 2 * deltaTime;
            }
        }
        
        // Auto-rotate camera in cinematic mode
        if (this.enhancedConfig?.cinematicMode && this.enhancedConfig?.autoRotate && this.orbitControls) {
            this.orbitControls.spherical.theta += this.enhancedConfig.autoRotateSpeed * deltaTime;
            this.orbitControls.updateCamera();
        }

        this.renderer.render(this.scene, this.camera);
    }
    
    // ================================================================
    // STOCK CONFIGURATION
    // ================================================================
    
    setStock(dimensions, position) {
        this.enhancedConfig.stock = dimensions;
        this.enhancedConfig.stockPosition = position || { x: 0, y: 0, z: 0 };
        
        // Rebuild material mesh
        if (this.materialMesh) {
            this.scene.remove(this.materialMesh);
            this.materialMesh.geometry.dispose();
            this.materialMesh.material.dispose();
        }
        
        if (this.cutSurface) {
            this.scene.remove(this.cutSurface);
            this.cutSurface.geometry.dispose();
            this.cutSurface.material.dispose();
        }
        
        this.createStockMaterial();
    }
    
    setMaterialType(type) {
        const materials = {
            wood: { color: 0x8B7355, cutColor: 0xDEB887, metalness: 0.1, roughness: 0.8 },
            aluminum: { color: 0xA8A9AD, cutColor: 0xC0C0C0, metalness: 0.9, roughness: 0.3 },
            steel: { color: 0x71797E, cutColor: 0x888888, metalness: 0.9, roughness: 0.4 },
            plastic: { color: 0x2E86AB, cutColor: 0x4DA6C9, metalness: 0, roughness: 0.5 },
            foam: { color: 0x1a1a2e, cutColor: 0x16213e, metalness: 0, roughness: 1 },
            wax: { color: 0xF5DEB3, cutColor: 0xFFE4B5, metalness: 0.1, roughness: 0.6 }
        };
        
        const mat = materials[type] || materials.wood;
        
        this.enhancedConfig.materialColor = mat.color;
        this.enhancedConfig.cutMaterialColor = mat.cutColor;
        this.enhancedConfig.materialMetalness = mat.metalness;
        this.enhancedConfig.materialRoughness = mat.roughness;
        this.enhancedConfig.chipColor = mat.cutColor;
        
        if (this.materialMesh) {
            this.materialMesh.material.color.setHex(mat.color);
            this.materialMesh.material.metalness = mat.metalness;
            this.materialMesh.material.roughness = mat.roughness;
        }
        
        if (this.particleSystem) {
            this.particleSystem.material.color.setHex(mat.cutColor);
        }
    }
    
    // ================================================================
    // VIEW PRESETS
    // ================================================================
    
    setCinematicMode(enabled) {
        this.enhancedConfig.cinematicMode = enabled;
        this.enhancedConfig.autoRotate = enabled;
        
        if (enabled) {
            // Zoom out for cinematic view
            this.orbitControls.spherical.radius = 800;
            this.orbitControls.spherical.phi = Math.PI / 5;
            this.orbitControls.updateCamera();
        }
    }
    
    resetMaterial() {
        // Reset cut heightmap
        if (this.cutHeightmap) {
            this.cutHeightmap.fill(this.enhancedConfig.stock.z);
        }
        
        if (this.cutSurface) {
            this.cutSurface.material.opacity = 0;
        }
        
        // Clear trail
        this.trailPoints = [];
        
        // Reset particles
        if (this.particleSystem) {
            const lifetimes = this.particleSystem.geometry.attributes.lifetime;
            for (let i = 0; i < this.enhancedConfig.particleCount; i++) {
                lifetimes.setX(i, 0);
            }
            lifetimes.needsUpdate = true;
        }
    }
    
    // ================================================================
    // CLEANUP - CRITICAL FOR MEMORY MANAGEMENT
    // ================================================================
    
    dispose() {
        // Cancel animation frame to stop render loop
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }
        
        // Dispose enhanced objects
        if (this.materialMesh) {
            this.materialMesh.geometry?.dispose();
            this.materialMesh.material?.map?.dispose();
            this.materialMesh.material?.dispose();
            this.scene?.remove(this.materialMesh);
        }
        
        if (this.cutSurface) {
            this.cutSurface.geometry?.dispose();
            this.cutSurface.material?.dispose();
            this.scene?.remove(this.cutSurface);
        }
        
        if (this.particleSystem) {
            this.particleSystem.geometry?.dispose();
            this.particleSystem.material?.dispose();
            this.scene?.remove(this.particleSystem);
        }
        
        if (this.glowTrailMesh) {
            this.glowTrailMesh.geometry?.dispose();
            this.glowTrailMesh.material?.dispose();
            this.scene?.remove(this.glowTrailMesh);
        }
        
        // Dispose HUD
        if (this.hudElement) {
            this.hudElement.remove();
        }
        
        // Dispose lights
        if (this.cuttingLight) {
            this.scene?.remove(this.cuttingLight);
        }
        if (this.cuttingLightHelper) {
            this.scene?.remove(this.cuttingLightHelper);
        }
        
        // Clear references
        this.materialMesh = null;
        this.cutSurface = null;
        this.particleSystem = null;
        this.glowTrailMesh = null;
        this.cutHeightmap = null;
        this.trailPoints = null;
        this.enhancedConfig = null;
        
        // Call parent dispose
        super.dispose();
        
        console.log('[EnhancedVisualizer] Disposed');
    }
}

// Export
if (typeof module !== 'undefined' && module.exports) {
    module.exports = EnhancedVisualizer;
}
