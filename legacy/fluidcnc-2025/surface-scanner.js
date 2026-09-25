/* ========================================
   FluidCNC - 3D Surface Scanning Probe
   Height map generation for uneven surfaces
   Auto-leveling G-code transformation
   ======================================== */

class SurfaceScanner {
    constructor(grbl, options = {}) {
        this.grbl = grbl;
        
        // Configuration
        this.config = {
            // Probe settings
            probeSpeed: options.probeSpeed || 100,        // mm/min
            probeFeedRate: options.probeFeedRate || 50,   // mm/min for slow probe
            probeRetract: options.probeRetract || 2,      // mm
            probeSafeZ: options.probeSafeZ || 10,         // mm above highest point
            
            // Grid settings
            gridSpacingX: options.gridSpacingX || 10,     // mm
            gridSpacingY: options.gridSpacingY || 10,     // mm
            
            // Probing pattern
            pattern: options.pattern || 'zigzag',         // 'zigzag', 'spiral', 'random'
            
            // Interpolation
            interpolation: options.interpolation || 'bilinear' // 'bilinear', 'bicubic', 'nearest'
        };
        
        // Scan area
        this.bounds = {
            minX: 0, maxX: 100,
            minY: 0, maxY: 100,
            minZ: -10, maxZ: 10  // Expected Z range
        };
        
        // Height map data
        this.heightMap = null;
        this.rawPoints = [];
        
        // Scan state
        this.isScanning = false;
        this.scanProgress = 0;
        this.currentPoint = 0;
        this.totalPoints = 0;
        
        // Event handlers
        this.handlers = {
            progress: [],
            complete: [],
            error: [],
            point: []
        };
    }
    
    // ================================================================
    // Event handling
    // ================================================================
    
    on(event, handler) {
        if (this.handlers[event]) {
            this.handlers[event].push(handler);
        }
        return this;
    }
    
    emit(event, data) {
        if (this.handlers[event]) {
            this.handlers[event].forEach(h => h(data));
        }
    }
    
    // ================================================================
    // Scan area setup
    // ================================================================
    
    /**
     * Set the scan area bounds
     */
    setBounds(minX, minY, maxX, maxY) {
        this.bounds.minX = minX;
        this.bounds.minY = minY;
        this.bounds.maxX = maxX;
        this.bounds.maxY = maxY;
        
        return this;
    }
    
    /**
     * Set grid spacing
     */
    setGridSpacing(spacingX, spacingY = spacingX) {
        this.config.gridSpacingX = spacingX;
        this.config.gridSpacingY = spacingY;
        
        return this;
    }
    
    /**
     * Calculate grid points based on bounds and spacing
     */
    calculateGridPoints() {
        const points = [];
        const { minX, maxX, minY, maxY } = this.bounds;
        const { gridSpacingX, gridSpacingY } = this.config;
        
        const cols = Math.ceil((maxX - minX) / gridSpacingX) + 1;
        const rows = Math.ceil((maxY - minY) / gridSpacingY) + 1;
        
        // Generate points based on pattern
        if (this.config.pattern === 'zigzag') {
            for (let row = 0; row < rows; row++) {
                const y = minY + row * gridSpacingY;
                const reverse = row % 2 === 1;
                
                for (let col = 0; col < cols; col++) {
                    const actualCol = reverse ? (cols - 1 - col) : col;
                    const x = minX + actualCol * gridSpacingX;
                    points.push({ x: Math.min(x, maxX), y: Math.min(y, maxY) });
                }
            }
        } else if (this.config.pattern === 'spiral') {
            // Spiral from center outward
            const centerX = (minX + maxX) / 2;
            const centerY = (minY + maxY) / 2;
            
            points.push({ x: centerX, y: centerY });
            
            let step = 1;
            let x = centerX, y = centerY;
            let direction = 0; // 0=right, 1=up, 2=left, 3=down
            
            while (points.length < cols * rows) {
                for (let i = 0; i < 2; i++) {
                    for (let j = 0; j < step; j++) {
                        switch (direction % 4) {
                            case 0: x += gridSpacingX; break;
                            case 1: y += gridSpacingY; break;
                            case 2: x -= gridSpacingX; break;
                            case 3: y -= gridSpacingY; break;
                        }
                        
                        if (x >= minX && x <= maxX && y >= minY && y <= maxY) {
                            points.push({ x, y });
                        }
                    }
                    direction++;
                }
                step++;
            }
        } else {
            // Default: row by row
            for (let row = 0; row < rows; row++) {
                const y = minY + row * gridSpacingY;
                for (let col = 0; col < cols; col++) {
                    const x = minX + col * gridSpacingX;
                    points.push({ x: Math.min(x, maxX), y: Math.min(y, maxY) });
                }
            }
        }
        
        return {
            points,
            cols,
            rows
        };
    }
    
    // ================================================================
    // Scanning
    // ================================================================
    
    /**
     * Start surface scan
     */
    async startScan() {
        if (this.isScanning) {
            throw new Error('Scan already in progress');
        }
        
        if (!this.grbl?.connected) {
            throw new Error('Not connected to grblHAL');
        }
        
        this.isScanning = true;
        this.rawPoints = [];
        this.scanProgress = 0;
        
        const grid = this.calculateGridPoints();
        this.totalPoints = grid.points.length;
        this.currentPoint = 0;
        
        // Store grid info for height map
        this.gridInfo = {
            cols: grid.cols,
            rows: grid.rows,
            spacingX: this.config.gridSpacingX,
            spacingY: this.config.gridSpacingY,
            bounds: { ...this.bounds }
        };
        
        try {
            // Move to safe height
            await this.grbl.sendAndWait(`G0 Z${this.config.probeSafeZ}`);
            
            // Probe each point
            for (const point of grid.points) {
                if (!this.isScanning) break; // Allow cancellation
                
                const z = await this.probePoint(point.x, point.y);
                
                this.rawPoints.push({
                    x: point.x,
                    y: point.y,
                    z: z
                });
                
                this.currentPoint++;
                this.scanProgress = (this.currentPoint / this.totalPoints) * 100;
                
                this.emit('point', { x: point.x, y: point.y, z, progress: this.scanProgress });
                this.emit('progress', this.scanProgress);
            }
            
            // Return to safe height
            await this.grbl.sendAndWait(`G0 Z${this.config.probeSafeZ}`);
            
            // Generate height map
            this.heightMap = this.generateHeightMap();
            
            this.isScanning = false;
            this.emit('complete', { 
                heightMap: this.heightMap, 
                rawPoints: this.rawPoints,
                gridInfo: this.gridInfo
            });
            
            return this.heightMap;
            
        } catch (error) {
            this.isScanning = false;
            this.emit('error', error);
            throw error;
        }
    }
    
    /**
     * Probe a single point
     */
    async probePoint(x, y) {
        // Check for limit switch state BEFORE moving
        if (this.grbl.state?.limitX || this.grbl.state?.limitY || this.grbl.state?.limitZ) {
            throw new Error('Limit switch active before probe - cannot continue scan');
        }
        
        // Rapid to position at safe height
        await this.grbl.sendAndWait(`G0 X${x.toFixed(3)} Y${y.toFixed(3)}`);
        
        // Clear previous probe result to avoid stale data race condition
        this.grbl.probeResult = null;
        
        // Probe down with limit switch monitoring
        const probePromise = this.grbl.sendAndWait(
            `G38.2 Z${this.bounds.minZ} F${this.config.probeSpeed}`
        );
        
        // CRITICAL SAFETY: Wait for probe result WITH TIMEOUT
        // Race between probe result and timeout - also check for alarm (limit hit)
        const resultPromise = this.waitForProbeResult(30000);
        
        try {
            await Promise.race([probePromise, resultPromise]);
        } catch (e) {
            // On any error, try to retract safely
            await this.emergencyRetract();
            throw e;
        }
        
        // Check for alarm state (indicates limit switch hit)
        if (this.grbl.state?.status === 'Alarm') {
            throw new Error(`LIMIT SWITCH triggered at X${x.toFixed(3)} Y${y.toFixed(3)} - scan aborted!`);
        }
        
        // CRITICAL SAFETY: Verify probe actually triggered!
        if (!this.grbl.probeResult || !this.grbl.probeResult.success) {
            // Retract to safe height FIRST using proper config
            await this.grbl.sendAndWait(`G0 Z${this.config.probeSafeZ || 10}`);
            throw new Error(`Probe failed at X${x.toFixed(3)} Y${y.toFixed(3)} - no contact detected!`);
        }
        
        const probeZ = this.grbl.probeResult.z;
        
        // Retract - use absolute Z to avoid cumulative errors
        const retractZ = probeZ + this.config.probeRetract;
        await this.grbl.sendAndWait(`G0 Z${retractZ.toFixed(3)}`);
        
        return probeZ;
    }
    
    /**
     * Emergency retract after probe failure
     */
    async emergencyRetract() {
        try {
            // Clear feed hold if active
            this.grbl.send('~');
            await new Promise(r => setTimeout(r, 100));
            
            if (this.grbl.state?.status !== 'Alarm') {
                await this.grbl.sendAndWait('G90');
                await this.grbl.sendAndWait(`G0 Z${this.config.probeSafeZ || 10}`);
            }
        } catch (e) {
            console.error('Emergency retract failed:', e);
        }
    }
    
    /**
     * Wait for probe result with timeout - NEVER blocks forever
     */
    waitForProbeResult(timeoutMs = 30000) {
        return new Promise((resolve, reject) => {
            const startTime = Date.now();
            const checkResult = () => {
                if (this.grbl.probeResult) {
                    resolve(this.grbl.probeResult);
                } else if (Date.now() - startTime > timeoutMs) {
                    reject(new Error(`Probe timeout after ${timeoutMs/1000}s - no trigger detected`));
                } else {
                    setTimeout(checkResult, 50);
                }
            };
            checkResult();
        });
    }
    
    /**
     * Cancel ongoing scan - ALSO STOPS MACHINE
     */
    cancelScan() {
        this.isScanning = false;
        // CRITICAL SAFETY: Actually stop the machine!
        if (this.grbl) {
            this.grbl.send('!');  // Feed hold
            
            // Wait for feed hold to take effect, then safely recover
            setTimeout(async () => {
                try {
                    // MUST issue cycle start (~) to exit feed hold before any motion!
                    this.grbl.send('~');
                    await new Promise(r => setTimeout(r, 100));
                    
                    this.grbl.send('M5');  // Spindle off (safety redundancy)
                    
                    // Check for alarm state before attempting retract
                    if (this.grbl.state?.status === 'Alarm') {
                        console.error('Machine in ALARM - manual recovery required');
                        this.emit('error', new Error('Scan cancelled - machine in ALARM state'));
                        return;
                    }
                    
                    // Use absolute mode and machine coordinates for safe retract
                    await this.grbl.sendAndWait?.('G90');
                    const safeZ = this.config.probeSafeZ || 10;
                    await this.grbl.sendAndWait?.(`G53 G0 Z${-Math.abs(safeZ)}`);
                } catch (e) {
                    console.error('Cancel scan retract failed:', e);
                    this.emit('error', e);
                }
            }, 200);  // Longer delay to ensure feed hold completes
        }
    }
    
    // ================================================================
    // Height map generation
    // ================================================================
    
    /**
     * Generate height map from raw points
     */
    generateHeightMap() {
        const { cols, rows } = this.gridInfo;
        
        // Create 2D array
        const map = [];
        let pointIndex = 0;
        
        for (let row = 0; row < rows; row++) {
            map[row] = [];
            for (let col = 0; col < cols; col++) {
                if (pointIndex < this.rawPoints.length) {
                    map[row][col] = this.rawPoints[pointIndex].z;
                    pointIndex++;
                } else {
                    map[row][col] = 0;
                }
            }
        }
        
        // Calculate statistics
        const allZ = this.rawPoints.map(p => p.z);
        const minZ = Math.min(...allZ);
        const maxZ = Math.max(...allZ);
        const avgZ = allZ.reduce((a, b) => a + b, 0) / allZ.length;
        
        return {
            data: map,
            cols,
            rows,
            minZ,
            maxZ,
            avgZ,
            range: maxZ - minZ,
            bounds: this.gridInfo.bounds,
            spacing: {
                x: this.gridInfo.spacingX,
                y: this.gridInfo.spacingY
            }
        };
    }
    
    /**
     * Get Z height at arbitrary X,Y using interpolation
     */
    getHeightAt(x, y) {
        if (!this.heightMap) return 0;
        
        const { bounds, spacing, data, cols, rows } = this.heightMap;
        
        // Normalize coordinates to grid
        const gridX = (x - bounds.minX) / spacing.x;
        const gridY = (y - bounds.minY) / spacing.y;
        
        // Clamp to bounds
        const clampedX = Math.max(0, Math.min(cols - 1, gridX));
        const clampedY = Math.max(0, Math.min(rows - 1, gridY));
        
        if (this.config.interpolation === 'nearest') {
            return this.nearestInterpolation(clampedX, clampedY, data, cols, rows);
        } else if (this.config.interpolation === 'bicubic') {
            return this.bicubicInterpolation(clampedX, clampedY, data, cols, rows);
        } else {
            return this.bilinearInterpolation(clampedX, clampedY, data, cols, rows);
        }
    }
    
    /**
     * Nearest neighbor interpolation
     */
    nearestInterpolation(x, y, data, cols, rows) {
        const col = Math.round(x);
        const row = Math.round(y);
        return data[Math.min(row, rows - 1)]?.[Math.min(col, cols - 1)] ?? 0;
    }
    
    /**
     * Bilinear interpolation
     */
    bilinearInterpolation(x, y, data, cols, rows) {
        const x0 = Math.floor(x);
        const x1 = Math.min(x0 + 1, cols - 1);
        const y0 = Math.floor(y);
        const y1 = Math.min(y0 + 1, rows - 1);
        
        const xFrac = x - x0;
        const yFrac = y - y0;
        
        const z00 = data[y0]?.[x0] ?? 0;
        const z10 = data[y0]?.[x1] ?? 0;
        const z01 = data[y1]?.[x0] ?? 0;
        const z11 = data[y1]?.[x1] ?? 0;
        
        // Interpolate along X
        const z0 = z00 + (z10 - z00) * xFrac;
        const z1 = z01 + (z11 - z01) * xFrac;
        
        // Interpolate along Y
        return z0 + (z1 - z0) * yFrac;
    }
    
    /**
     * Bicubic interpolation (smoother)
     */
    bicubicInterpolation(x, y, data, cols, rows) {
        // Simplified bicubic - uses Catmull-Rom spline
        const getZ = (row, col) => {
            const r = Math.max(0, Math.min(rows - 1, row));
            const c = Math.max(0, Math.min(cols - 1, col));
            return data[r]?.[c] ?? 0;
        };
        
        const cubicInterp = (p0, p1, p2, p3, t) => {
            const t2 = t * t;
            const t3 = t2 * t;
            return 0.5 * (
                (2 * p1) +
                (-p0 + p2) * t +
                (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
                (-p0 + 3 * p1 - 3 * p2 + p3) * t3
            );
        };
        
        const x0 = Math.floor(x);
        const y0 = Math.floor(y);
        const xFrac = x - x0;
        const yFrac = y - y0;
        
        // Interpolate 4 rows
        const rows4 = [];
        for (let i = -1; i <= 2; i++) {
            rows4.push(cubicInterp(
                getZ(y0 + i, x0 - 1),
                getZ(y0 + i, x0),
                getZ(y0 + i, x0 + 1),
                getZ(y0 + i, x0 + 2),
                xFrac
            ));
        }
        
        // Interpolate final value
        return cubicInterp(rows4[0], rows4[1], rows4[2], rows4[3], yFrac);
    }
    
    // ================================================================
    // G-code transformation
    // ================================================================
    
    /**
     * Apply height map correction to G-code
     */
    applyToGCode(gcodeLines) {
        if (!this.heightMap) {
            throw new Error('No height map available. Run scan first.');
        }
        
        const correctedLines = [];
        let currentX = 0, currentY = 0, currentZ = 0;
        let absoluteMode = true;
        let inInches = false;
        
        for (const line of gcodeLines) {
            const upper = line.toUpperCase().trim();
            
            // Skip comments and empty lines
            if (!upper || upper.startsWith(';') || upper.startsWith('(')) {
                correctedLines.push(line);
                continue;
            }
            
            // Check mode changes
            if (upper.includes('G90')) absoluteMode = true;
            if (upper.includes('G91')) absoluteMode = false;
            if (upper.includes('G20')) inInches = true;
            if (upper.includes('G21')) inInches = false;
            
            // Parse coordinates
            const hasX = /X[\-\d\.]+/i.test(upper);
            const hasY = /Y[\-\d\.]+/i.test(upper);
            const hasZ = /Z[\-\d\.]+/i.test(upper);
            
            // Only modify cutting moves (G1, G2, G3) with Z
            const isCuttingMove = /G[123]\b/.test(upper) || 
                                  (!upper.match(/G\d/) && (hasX || hasY || hasZ));
            
            if (!isCuttingMove || !hasZ) {
                correctedLines.push(line);
                
                // Track position
                if (hasX) {
                    const x = parseFloat(upper.match(/X([\-\d\.]+)/i)?.[1] || 0);
                    currentX = absoluteMode ? x : currentX + x;
                }
                if (hasY) {
                    const y = parseFloat(upper.match(/Y([\-\d\.]+)/i)?.[1] || 0);
                    currentY = absoluteMode ? y : currentY + y;
                }
                if (hasZ) {
                    const z = parseFloat(upper.match(/Z([\-\d\.]+)/i)?.[1] || 0);
                    currentZ = absoluteMode ? z : currentZ + z;
                }
                
                continue;
            }
            
            // Get new position
            let newX = currentX, newY = currentY, newZ = currentZ;
            
            if (hasX) {
                const x = parseFloat(upper.match(/X([\-\d\.]+)/i)?.[1] || 0);
                newX = absoluteMode ? x : currentX + x;
            }
            if (hasY) {
                const y = parseFloat(upper.match(/Y([\-\d\.]+)/i)?.[1] || 0);
                newY = absoluteMode ? y : currentY + y;
            }
            if (hasZ) {
                const z = parseFloat(upper.match(/Z([\-\d\.]+)/i)?.[1] || 0);
                newZ = absoluteMode ? z : currentZ + z;
            }
            
            // Convert if in inches
            const scale = inInches ? 25.4 : 1;
            const queryX = newX * scale;
            const queryY = newY * scale;
            
            // Get height correction
            const correction = this.getHeightAt(queryX, queryY);
            
            // Apply correction to Z
            const correctedZ = newZ + correction;
            
            // Rebuild line with corrected Z
            const correctedLine = line.replace(
                /Z[\-\d\.]+/i,
                `Z${correctedZ.toFixed(3)}`
            );
            
            correctedLines.push(correctedLine);
            
            // Update position
            currentX = newX;
            currentY = newY;
            currentZ = newZ;
        }
        
        return correctedLines;
    }
    
    /**
     * Subdivide long moves for better height correction
     */
    subdivideMove(startX, startY, startZ, endX, endY, endZ, maxSegmentLength = 1) {
        const dx = endX - startX;
        const dy = endY - startY;
        const dz = endZ - startZ;
        const length = Math.sqrt(dx * dx + dy * dy);
        
        if (length <= maxSegmentLength) {
            return [{ x: endX, y: endY, z: endZ }];
        }
        
        const segments = Math.ceil(length / maxSegmentLength);
        const points = [];
        
        for (let i = 1; i <= segments; i++) {
            const t = i / segments;
            const x = startX + dx * t;
            const y = startY + dy * t;
            const z = startZ + dz * t;
            
            // Apply height correction
            const correction = this.getHeightAt(x, y);
            
            points.push({
                x,
                y,
                z: z + correction
            });
        }
        
        return points;
    }
    
    // ================================================================
    // Import/Export
    // ================================================================
    
    /**
     * Export height map as JSON
     */
    exportHeightMap() {
        return JSON.stringify({
            version: 1,
            created: new Date().toISOString(),
            heightMap: this.heightMap,
            rawPoints: this.rawPoints,
            config: this.config,
            bounds: this.bounds
        }, null, 2);
    }
    
    /**
     * Import height map from JSON
     */
    importHeightMap(json) {
        try {
            const data = typeof json === 'string' ? JSON.parse(json) : json;
            
            if (data.heightMap) {
                this.heightMap = data.heightMap;
                this.rawPoints = data.rawPoints || [];
                this.gridInfo = {
                    cols: this.heightMap.cols,
                    rows: this.heightMap.rows,
                    spacingX: this.heightMap.spacing.x,
                    spacingY: this.heightMap.spacing.y,
                    bounds: this.heightMap.bounds
                };
                
                return true;
            }
            
            return false;
        } catch (e) {
            console.error('Failed to import height map:', e);
            return false;
        }
    }
    
    /**
     * Export as image (grayscale height map)
     */
    exportAsImage(width = 400, height = 400) {
        if (!this.heightMap) return null;
        
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        
        const { data, cols, rows, minZ, maxZ } = this.heightMap;
        const range = maxZ - minZ || 1;
        
        const cellW = width / cols;
        const cellH = height / rows;
        
        for (let row = 0; row < rows; row++) {
            for (let col = 0; col < cols; col++) {
                const z = data[row][col];
                const normalized = (z - minZ) / range;
                const gray = Math.round(normalized * 255);
                
                ctx.fillStyle = `rgb(${gray}, ${gray}, ${gray})`;
                ctx.fillRect(col * cellW, (rows - 1 - row) * cellH, cellW + 1, cellH + 1);
            }
        }
        
        return canvas.toDataURL('image/png');
    }
}

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
    module.exports = SurfaceScanner;
}
