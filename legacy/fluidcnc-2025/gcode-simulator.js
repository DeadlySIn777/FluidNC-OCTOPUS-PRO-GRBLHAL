/* ========================================
   FluidCNC - G-code Simulator
   
   Features:
   - Dry-run simulation without machine
   - Time estimation with acceleration
   - Bounds checking against machine limits
   - Toolpath animation preview
   - Collision detection
   ======================================== */

class GCodeSimulator {
    constructor(options = {}) {
        this.parser = new GCodeParser();
        this.grbl = options.grbl || null;
        
        // Machine configuration
        this.machineConfig = {
            limits: { x: 400, y: 400, z: 100 },
            maxFeedXY: 10000,  // mm/min
            maxFeedZ: 3000,
            rapidFeed: 5000,
            acceleration: 500,  // mm/s²
            ...options.machineConfig
        };
        
        // Simulation state
        this.isRunning = false;
        this.isPaused = false;
        this.currentSegment = 0;
        this.simulatedPosition = { x: 0, y: 0, z: 0 };
        this.animationFrame = null;
        this.playbackSpeed = 1;
        
        // Results
        this.results = null;
        this.errors = [];
        this.warnings = [];
        
        // Callbacks
        this.onProgress = options.onProgress || (() => {});
        this.onPosition = options.onPosition || (() => {});
        this.onComplete = options.onComplete || (() => {});
        this.onError = options.onError || (() => {});
    }
    
    setGrbl(grbl) {
        this.grbl = grbl;
        if (grbl?.machineLimits) {
            this.machineConfig.limits = { ...grbl.machineLimits };
        }
    }
    
    // ================================================================
    // Simulation Analysis (no movement)
    // ================================================================
    
    analyze(gcode) {
        this.errors = [];
        this.warnings = [];
        
        // Parse G-code
        this.results = this.parser.parse(gcode);
        
        // Check bounds
        this.checkBounds();
        
        // Check for common issues
        this.checkIssues();
        
        // Calculate accurate time with acceleration
        const accurateTime = this.calculateTimeWithAccel();
        
        return {
            ...this.results,
            accurateTime,
            errors: this.errors,
            warnings: this.warnings,
            isValid: this.errors.length === 0,
            summary: this.generateSummary()
        };
    }
    
    checkBounds() {
        const { bounds } = this.results;
        const { limits } = this.machineConfig;
        
        // Check if toolpath exceeds machine limits
        if (bounds.maxX > limits.x) {
            this.errors.push({
                type: 'bounds',
                message: `X axis exceeds limit: ${bounds.maxX.toFixed(2)}mm > ${limits.x}mm`
            });
        }
        if (bounds.minX < 0) {
            this.warnings.push({
                type: 'bounds',
                message: `X axis goes negative: ${bounds.minX.toFixed(2)}mm`
            });
        }
        
        if (bounds.maxY > limits.y) {
            this.errors.push({
                type: 'bounds',
                message: `Y axis exceeds limit: ${bounds.maxY.toFixed(2)}mm > ${limits.y}mm`
            });
        }
        if (bounds.minY < 0) {
            this.warnings.push({
                type: 'bounds',
                message: `Y axis goes negative: ${bounds.minY.toFixed(2)}mm`
            });
        }
        
        if (bounds.minZ < -limits.z) {
            this.errors.push({
                type: 'bounds',
                message: `Z axis exceeds limit: ${bounds.minZ.toFixed(2)}mm < -${limits.z}mm`
            });
        }
        if (bounds.maxZ > 10) {
            this.warnings.push({
                type: 'bounds',
                message: `Z retracts very high: ${bounds.maxZ.toFixed(2)}mm - check clearance`
            });
        }
    }
    
    checkIssues() {
        const { toolPath } = this.results;
        
        // Check for missing feed rates
        let lastFeed = 0;
        toolPath.forEach((seg, i) => {
            if (!seg.isRapid && seg.feedRate === 0 && lastFeed === 0) {
                this.errors.push({
                    type: 'feed',
                    message: `Line ${seg.lineNumber}: Cutting move without feed rate`,
                    line: seg.lineNumber
                });
            }
            lastFeed = seg.feedRate;
        });
        
        // Check for excessive feed rates
        toolPath.forEach(seg => {
            if (!seg.isRapid) {
                const isZOnly = seg.from.x === seg.to.x && seg.from.y === seg.to.y;
                const maxFeed = isZOnly ? this.machineConfig.maxFeedZ : this.machineConfig.maxFeedXY;
                
                if (seg.feedRate > maxFeed) {
                    this.warnings.push({
                        type: 'feed',
                        message: `Line ${seg.lineNumber}: Feed rate ${seg.feedRate} exceeds max ${maxFeed}`,
                        line: seg.lineNumber
                    });
                }
            }
        });
        
        // Check for spindle
        const hasSpindle = toolPath.some(seg => seg.spindleSpeed > 0);
        const hasCutting = toolPath.some(seg => !seg.isRapid);
        
        if (hasCutting && !hasSpindle) {
            this.warnings.push({
                type: 'spindle',
                message: 'Cutting moves detected but no spindle command (M3/M4)'
            });
        }
        
        // Check for plunge moves
        toolPath.forEach((seg, i) => {
            if (!seg.isRapid && seg.to.z < seg.from.z) {
                const plungeRate = seg.feedRate;
                if (plungeRate > 500) {
                    this.warnings.push({
                        type: 'plunge',
                        message: `Line ${seg.lineNumber}: Fast plunge at ${plungeRate}mm/min - consider reducing`,
                        line: seg.lineNumber
                    });
                }
            }
        });
    }
    
    calculateTimeWithAccel() {
        const { toolPath } = this.results;
        const accel = this.machineConfig.acceleration;
        let totalTime = 0;
        
        toolPath.forEach(seg => {
            const feedMmSec = (seg.isRapid ? this.machineConfig.rapidFeed : seg.feedRate) / 60;
            const dist = seg.distance;
            
            // Time to accelerate to full speed
            const accelDist = (feedMmSec * feedMmSec) / (2 * accel);
            
            if (dist < 2 * accelDist) {
                // Move is too short to reach full speed
                // Triangular velocity profile
                totalTime += 2 * Math.sqrt(dist / accel);
            } else {
                // Trapezoidal profile
                const accelTime = feedMmSec / accel;
                const cruiseDist = dist - 2 * accelDist;
                const cruiseTime = cruiseDist / feedMmSec;
                totalTime += 2 * accelTime + cruiseTime;
            }
        });
        
        return totalTime;
    }
    
    generateSummary() {
        const { stats, bounds } = this.results;
        const accurateTime = this.calculateTimeWithAccel();
        
        return {
            lines: stats.lineCount,
            moves: this.results.toolPath.length,
            totalDistance: `${stats.totalDistance.toFixed(1)}mm`,
            cuttingDistance: `${stats.cuttingDistance.toFixed(1)}mm`,
            rapidDistance: `${stats.rapidDistance.toFixed(1)}mm`,
            estimatedTime: this.formatTime(accurateTime),
            workArea: {
                x: `${(bounds.maxX - bounds.minX).toFixed(1)}mm`,
                y: `${(bounds.maxY - bounds.minY).toFixed(1)}mm`,
                z: `${(bounds.maxZ - bounds.minZ).toFixed(1)}mm`
            },
            errors: this.errors.length,
            warnings: this.warnings.length
        };
    }
    
    // ================================================================
    // Visual Simulation (animated preview)
    // ================================================================
    
    startSimulation(gcode, onFrame) {
        if (this.isRunning) {
            this.stopSimulation();
        }
        
        // Parse first
        this.results = this.parser.parse(gcode);
        
        if (this.results.toolPath.length === 0) {
            this.onError('No toolpath to simulate');
            return;
        }
        
        this.isRunning = true;
        this.isPaused = false;
        this.currentSegment = 0;
        this.simulatedPosition = { x: 0, y: 0, z: 0 };
        this.segmentProgress = 0;
        
        this.simulateFrame(onFrame);
    }
    
    simulateFrame(onFrame) {
        if (!this.isRunning || this.isPaused) return;
        
        const segment = this.results.toolPath[this.currentSegment];
        if (!segment) {
            this.completeSimulation();
            return;
        }
        
        // Calculate how fast to move through segments
        const speed = this.playbackSpeed * 0.02; // Progress per frame
        this.segmentProgress += speed;
        
        if (this.segmentProgress >= 1) {
            // Move to next segment
            this.segmentProgress = 0;
            this.currentSegment++;
            
            if (this.currentSegment >= this.results.toolPath.length) {
                this.completeSimulation();
                return;
            }
        }
        
        // Interpolate position
        const t = this.segmentProgress;
        this.simulatedPosition = {
            x: segment.from.x + (segment.to.x - segment.from.x) * t,
            y: segment.from.y + (segment.to.y - segment.from.y) * t,
            z: segment.from.z + (segment.to.z - segment.from.z) * t
        };
        
        // Report progress
        const progress = (this.currentSegment + this.segmentProgress) / this.results.toolPath.length * 100;
        this.onProgress({
            progress,
            segment: this.currentSegment,
            total: this.results.toolPath.length,
            position: this.simulatedPosition,
            isRapid: segment.isRapid,
            lineNumber: segment.lineNumber
        });
        
        this.onPosition(this.simulatedPosition);
        
        if (onFrame) {
            onFrame(this.simulatedPosition, segment);
        }
        
        this.animationFrame = requestAnimationFrame(() => this.simulateFrame(onFrame));
    }
    
    pauseSimulation() {
        this.isPaused = true;
    }
    
    resumeSimulation(onFrame) {
        if (this.isRunning && this.isPaused) {
            this.isPaused = false;
            this.simulateFrame(onFrame);
        }
    }
    
    stopSimulation() {
        this.isRunning = false;
        this.isPaused = false;
        if (this.animationFrame) {
            cancelAnimationFrame(this.animationFrame);
            this.animationFrame = null;
        }
    }
    
    completeSimulation() {
        this.isRunning = false;
        this.onComplete({
            finalPosition: this.simulatedPosition,
            stats: this.results.stats
        });
    }
    
    setPlaybackSpeed(speed) {
        this.playbackSpeed = Math.max(0.1, Math.min(10, speed));
    }
    
    // ================================================================
    // Dry Run Mode - Step through without sending
    // ================================================================
    
    async dryRun(gcode, stepDelay = 100) {
        const analysis = this.analyze(gcode);
        
        if (!analysis.isValid) {
            this.onError(analysis.errors);
            return analysis;
        }
        
        this.isRunning = true;
        
        for (let i = 0; i < analysis.toolPath.length && this.isRunning; i++) {
            const segment = analysis.toolPath[i];
            
            this.onProgress({
                progress: (i / analysis.toolPath.length) * 100,
                segment: i,
                total: analysis.toolPath.length,
                position: segment.to,
                isRapid: segment.isRapid,
                lineNumber: segment.lineNumber
            });
            
            this.onPosition(segment.to);
            
            if (stepDelay > 0) {
                await new Promise(r => setTimeout(r, stepDelay / this.playbackSpeed));
            }
        }
        
        this.isRunning = false;
        this.onComplete(analysis);
        return analysis;
    }
    
    // ================================================================
    // Utilities
    // ================================================================
    
    formatTime(seconds) {
        const hrs = Math.floor(seconds / 3600);
        const mins = Math.floor((seconds % 3600) / 60);
        const secs = Math.floor(seconds % 60);
        
        if (hrs > 0) {
            return `${hrs}h ${mins}m ${secs}s`;
        } else if (mins > 0) {
            return `${mins}m ${secs}s`;
        }
        return `${secs}s`;
    }
    
    getProgress() {
        if (!this.results) return 0;
        return (this.currentSegment / this.results.toolPath.length) * 100;
    }
    
    getCurrentLine() {
        if (!this.results || !this.results.toolPath[this.currentSegment]) return 0;
        return this.results.toolPath[this.currentSegment].lineNumber;
    }
}

// Export
window.GCodeSimulator = GCodeSimulator;
