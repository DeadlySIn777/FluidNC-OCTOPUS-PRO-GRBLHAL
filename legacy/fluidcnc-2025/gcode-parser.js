/**
 * G-code Parser for FluidCNC
 * Parses G-code into toolpath segments for visualization
 * 
 * Supports:
 * - Linear moves (G0, G1)
 * - Arc interpolation (G2, G3) with I/J/K and R formats
 * - Helical interpolation (arcs with Z movement)
 * - Canned drilling cycles (G81, G82, G83, G73)
 * - Work coordinate systems (G54-G59)
 * - Tool changes (M6 Txx)
 * - Subroutines (M98/M99) - basic tracking
 * - Variables (# parameters)
 */

class GCodeParser {
    constructor() {
        this.reset();
    }

    reset() {
        this.position = { x: 0, y: 0, z: 0 };
        this.feedRate = 1000;
        this.spindleSpeed = 0;
        this.spindleDirection = 'off'; // 'cw', 'ccw', 'off'
        this.absoluteMode = true; // G90
        this.motionMode = 'G0';
        this.plane = 'XY'; // G17
        this.units = 'mm'; // G21
        this.unitsScale = 1; // mm per programmed unit
        this.toolPath = [];
        this.bounds = {
            minX: Infinity, maxX: -Infinity,
            minY: Infinity, maxY: -Infinity,
            minZ: Infinity, maxZ: -Infinity
        };
        this.totalDistance = 0;
        this.cuttingDistance = 0;
        this.rapidDistance = 0;
        this.arcDistance = 0;
        this.estimatedTime = 0;
        
        // Tool tracking
        this.currentTool = 0;
        this.toolChanges = [];
        this.tools = new Set();
        
        // WCS tracking
        this.wcs = 'G54';
        this.wcsOffsets = {
            'G54': { x: 0, y: 0, z: 0 },
            'G55': { x: 0, y: 0, z: 0 },
            'G56': { x: 0, y: 0, z: 0 },
            'G57': { x: 0, y: 0, z: 0 },
            'G58': { x: 0, y: 0, z: 0 },
            'G59': { x: 0, y: 0, z: 0 }
        };
        
        // Canned cycle state
        this.cannedCycle = null;
        this.cannedCycles = []; // Track executed canned cycles
        this.retractMode = 'G98'; // G98 = initial Z, G99 = R plane
        this.initialZ = 0;
        this.rPlane = 0;
        
        // Variable storage (#1-#999)
        this.variables = {};
        
        // Subroutine tracking
        this.subroutines = [];
        this.inSubroutine = false;
        
        // Analysis data
        this.warnings = [];
        this.errors = [];
        this.lineInfo = []; // Stores info about each line
    }

    parse(gcode) {
        this.reset();
        const lines = gcode.split('\n');
        
        lines.forEach((line, index) => {
            try {
                this.parseLine(line.trim(), index + 1);
            } catch (err) {
                this.errors.push({ line: index + 1, message: err.message, code: line });
            }
        });

        this.calculateEstimatedTime();

        // Avoid Infinity bounds when file has no motion
        if (!this.toolPath.length) {
            this.bounds = { minX: 0, maxX: 0, minY: 0, maxY: 0, minZ: 0, maxZ: 0 };
        }
        
        // Count move types for stats
        let rapidMoves = 0, feedMoves = 0, arcMoves = 0;
        for (const seg of this.toolPath) {
            if (seg.type === 'rapid') rapidMoves++;
            else if (seg.type === 'arc') arcMoves++;
            else feedMoves++;
        }
        
        return {
            toolPath: this.toolPath,
            bounds: {
                min: { x: this.bounds.minX, y: this.bounds.minY, z: this.bounds.minZ },
                max: { x: this.bounds.maxX, y: this.bounds.maxY, z: this.bounds.maxZ }
            },
            // Flat stats for easy access
            rapidMoves,
            feedMoves,
            arcMoves,
            toolChanges: this.toolChanges.length,
            tools: this.tools,
            wcs: new Set(this.toolPath.map(s => s.wcs).filter(Boolean)),
            feedRates: [...new Set(this.toolPath.map(s => s.feedRate).filter(f => f > 0))].sort((a,b) => a-b),
            spindleSpeeds: [...new Set(this.toolPath.map(s => s.spindleSpeed).filter(s => s > 0))].sort((a,b) => a-b),
            // Nested stats for compatibility
            stats: {
                totalDistance: this.totalDistance,
                cuttingDistance: this.cuttingDistance,
                rapidDistance: this.rapidDistance,
                arcDistance: this.arcDistance,
                estimatedTime: this.estimatedTime,
                lineCount: lines.length,
                moveCount: this.toolPath.length,
                toolChanges: this.toolChanges.length,
                tools: Array.from(this.tools)
            },
            toolList: this.toolChanges,
            warnings: this.warnings,
            errors: this.errors,
            analysis: this.getAnalysis()
        };
    }
    
    /**
     * Analyze the parsed G-code for issues and optimization opportunities
     */
    getAnalysis() {
        const analysis = {
            quality: 'Excellent',
            score: 100,
            issues: [],
            suggestions: [],
            summary: {}
        };
        
        // Check for common issues
        if (this.errors.length > 0) {
            analysis.issues.push({ severity: 'error', message: `${this.errors.length} parsing error(s) found`, line: 0 });
            analysis.score -= this.errors.length * 20;
        }
        
        if (this.warnings.length > 0) {
            analysis.issues.push({ severity: 'warning', message: `${this.warnings.length} warning(s) found`, line: 0 });
            analysis.score -= this.warnings.length * 5;
        }
        
        // Check rapids in material (Z < 0 with G0)
        let rapidsInMaterial = 0;
        for (const seg of this.toolPath) {
            if (seg.isRapid && (seg.from.z < 0 || seg.to.z < 0)) {
                rapidsInMaterial++;
            }
        }
        if (rapidsInMaterial > 0) {
            analysis.issues.push({ severity: 'warning', message: `${rapidsInMaterial} rapid moves below Z=0 (possible collision)`, line: 0 });
            analysis.suggestions.push('Consider adding safe Z retracts before rapid moves');
            analysis.score -= Math.min(rapidsInMaterial * 5, 30);
        }
        
        // Check for very slow feeds
        let slowFeeds = 0;
        for (const seg of this.toolPath) {
            if (!seg.isRapid && seg.feedRate < 50) {
                slowFeeds++;
            }
        }
        if (slowFeeds > 5) {
            analysis.suggestions.push(`${slowFeeds} moves with very slow feed (<50mm/min) - may be inefficient`);
            analysis.score -= 5;
        }
        
        // Check for missing spindle start
        let hasSpindleStart = this.toolPath.some(s => s.spindleSpeed > 0);
        let hasCutting = this.cuttingDistance > 0;
        if (hasCutting && !hasSpindleStart) {
            analysis.issues.push({ severity: 'warning', message: 'Cutting moves found but no spindle start (M3/M4) detected', line: 0 });
            analysis.score -= 15;
        }
        
        // Ensure score stays in valid range
        analysis.score = Math.max(0, Math.min(100, analysis.score));
        
        // Determine quality based on score
        if (analysis.score >= 90) {
            analysis.quality = 'Excellent';
        } else if (analysis.score >= 75) {
            analysis.quality = 'Good';
        } else if (analysis.score >= 50) {
            analysis.quality = 'Fair';
        } else if (analysis.score >= 25) {
            analysis.quality = 'Needs Review';
        } else {
            analysis.quality = 'Poor';
        }
        
        // Summary stats (include both numeric and formatted)
        analysis.summary = {
            // Numeric values for programmatic use
            lineCount: this.toolPath.length > 0 ? this.toolPath[this.toolPath.length - 1].lineNumber : 0,
            moveCount: this.toolPath.length,
            estimatedTime: this.estimatedTime,
            totalDistance: this.totalDistance,
            cuttingDistance: this.cuttingDistance,
            rapidDistance: this.rapidDistance,
            arcDistance: this.arcDistance,
            cannedCycles: this.cannedCycles.length,
            toolChanges: this.toolChanges.length,
            
            // Formatted strings for display
            totalTimeFormatted: this.formatTime(this.estimatedTime),
            cuttingTimeFormatted: this.formatTime(this.estimatedTime * (this.cuttingDistance / Math.max(this.totalDistance, 1))),
            rapidTimeFormatted: this.formatTime(this.estimatedTime * (this.rapidDistance / Math.max(this.totalDistance, 1))),
            totalTravelFormatted: `${this.totalDistance.toFixed(1)}mm`,
            cuttingTravelFormatted: `${this.cuttingDistance.toFixed(1)}mm`,
            rapidTravelFormatted: `${this.rapidDistance.toFixed(1)}mm`,
            arcTravelFormatted: `${this.arcDistance.toFixed(1)}mm`,
            efficiency: `${((this.cuttingDistance / Math.max(this.totalDistance, 1)) * 100).toFixed(1)}%`,
            bounds: {
                x: `${this.bounds.minX.toFixed(2)} to ${this.bounds.maxX.toFixed(2)}mm`,
                y: `${this.bounds.minY.toFixed(2)} to ${this.bounds.maxY.toFixed(2)}mm`,
                z: `${this.bounds.minZ.toFixed(2)} to ${this.bounds.maxZ.toFixed(2)}mm`
            },
            size: {
                x: (this.bounds.maxX - this.bounds.minX).toFixed(2),
                y: (this.bounds.maxY - this.bounds.minY).toFixed(2),
                z: (this.bounds.maxZ - this.bounds.minZ).toFixed(2)
            }
        };
        
        return analysis;
    }

    parseLine(line, lineNumber) {
        // Store original line for reference
        const originalLine = line;
        
        // Remove comments (both ; and () style)
        let code = line.split(';')[0].trim();
        const parenMatch = code.match(/\([^)]*\)/g);
        if (parenMatch) {
            code = code.replace(/\([^)]*\)/g, '').trim();
        }
        code = code.toUpperCase();
        
        if (!code) return;
        
        // Expand variables (#1, #2, etc.)
        code = this.expandVariables(code);

        const words = this.tokenize(code);
        let newPosition = { ...this.position };
        let hasMotion = false;
        let arcI = null;
        let arcJ = null;
        let arcK = null;
        let arcR = null;
        let toolNumber = null;

        words.forEach(word => {
            const letter = word[0];
            const valueRaw = parseFloat(word.substring(1));
            if (!Number.isFinite(valueRaw)) return;

            // Most coordinate-like words scale with units (G20 inches -> mm)
            const value = (letter === 'G' || letter === 'M' || letter === 'T' || letter === 'N' || letter === 'O') 
                ? valueRaw 
                : valueRaw * this.unitsScale;

            switch (letter) {
                case 'G':
                    this.handleGCode(value, words);
                    break;
                case 'M':
                    this.handleMCode(value, words, lineNumber);
                    break;
                case 'T':
                    toolNumber = Math.round(valueRaw);
                    break;
                case 'X':
                    newPosition.x = this.absoluteMode ? value : this.position.x + value;
                    hasMotion = true;
                    break;
                case 'Y':
                    newPosition.y = this.absoluteMode ? value : this.position.y + value;
                    hasMotion = true;
                    break;
                case 'Z':
                    newPosition.z = this.absoluteMode ? value : this.position.z + value;
                    hasMotion = true;
                    break;
                case 'I':
                    arcI = value;
                    break;
                case 'J':
                    arcJ = value;
                    break;
                case 'K':
                    arcK = value;
                    break;
                case 'R':
                    // R can be arc radius OR canned cycle R-plane
                    if (this.cannedCycle) {
                        this.rPlane = value;
                    } else {
                        arcR = value;
                    }
                    break;
                case 'F':
                    this.feedRate = value;
                    break;
                case 'S':
                    this.spindleSpeed = value;
                    break;
                case 'P':
                    // Dwell time or subroutine number
                    break;
                case 'Q':
                    // Peck depth for canned cycles
                    break;
                case 'L':
                    // Loop count for canned cycles
                    break;
                case '#':
                    // Variable assignment handled separately
                    break;
            }
        });
        
        // Handle variable assignment (#100 = 5.0)
        const varMatch = code.match(/#(\d+)\s*=\s*([-+]?\d*\.?\d+)/);
        if (varMatch) {
            this.variables[varMatch[1]] = parseFloat(varMatch[2]);
        }

        // Handle canned drilling cycles
        if (this.cannedCycle && hasMotion) {
            this.executeCannedCycle(newPosition, lineNumber);
            return;
        }

        // Full-circle arcs can omit endpoint (X/Y), but still have motion intent
        const isArcMove = this.motionMode === 'G2' || this.motionMode === 'G3';
        if (!hasMotion && isArcMove && (arcI !== null || arcJ !== null || arcK !== null || arcR !== null)) {
            hasMotion = true;
            newPosition = { ...this.position };
        }

        if (hasMotion) {
            this.addSegment(newPosition, lineNumber, { arcI, arcJ, arcK, arcR });
            this.position = newPosition;
        }
        
        // Store line info for analysis
        this.lineInfo.push({
            line: lineNumber,
            original: originalLine,
            parsed: code,
            position: { ...this.position },
            hasMotion,
            motionMode: this.motionMode,
            feedRate: this.feedRate,
            spindleSpeed: this.spindleSpeed
        });
    }
    
    /**
     * Expand #variables in G-code line
     */
    expandVariables(code) {
        return code.replace(/#(\d+)/g, (match, varNum) => {
            const val = this.variables[varNum];
            return val !== undefined ? val.toString() : match;
        });
    }
    
    /**
     * Execute canned drilling cycle at position
     */
    executeCannedCycle(pos, lineNumber) {
        const retractZ = this.retractMode === 'G98' ? this.initialZ : this.rPlane;
        
        // Rapid to XY position
        const xyPos = { x: pos.x, y: pos.y, z: this.position.z };
        if (xyPos.x !== this.position.x || xyPos.y !== this.position.y) {
            const oldMode = this.motionMode;
            this.motionMode = 'G0';
            this.addSegment(xyPos, lineNumber, {});
            this.position = xyPos;
            this.motionMode = oldMode;
        }
        
        // Rapid to R plane if above it
        if (this.position.z > this.rPlane) {
            const rPos = { ...this.position, z: this.rPlane };
            const oldMode = this.motionMode;
            this.motionMode = 'G0';
            this.addSegment(rPos, lineNumber, {});
            this.position = rPos;
            this.motionMode = oldMode;
        }
        
        // Feed to Z depth
        const zPos = { ...this.position, z: pos.z };
        this.motionMode = 'G1';
        this.addSegment(zPos, lineNumber, {});
        this.position = zPos;
        
        // Retract
        const retractPos = { ...this.position, z: retractZ };
        this.motionMode = 'G0';
        this.addSegment(retractPos, lineNumber, {});
        this.position = retractPos;
    }

    tokenize(line) {
        const words = [];
        const regex = /([A-Z][-+]?[0-9]*\.?[0-9]+)/g;
        let match;
        while ((match = regex.exec(line)) !== null) {
            words.push(match[1]);
        }
        return words;
    }

    handleGCode(code, words) {
        switch (code) {
            case 0: this.motionMode = 'G0'; break;
            case 1: this.motionMode = 'G1'; break;
            case 2: this.motionMode = 'G2'; break;
            case 3: this.motionMode = 'G3'; break;
            case 17: this.plane = 'XY'; break;
            case 18: this.plane = 'XZ'; break;
            case 19: this.plane = 'YZ'; break;
            case 90: this.absoluteMode = true; break;
            case 91: this.absoluteMode = false; break;
            case 20:
                this.units = 'inch';
                this.unitsScale = 25.4;
                break;
            case 21:
                this.units = 'mm';
                this.unitsScale = 1;
                break;
            case 28:
                // Return to home
                break;
            case 53:
                // Machine coordinates - handle specially
                break;
            // Work coordinate systems
            case 54: case 55: case 56: case 57: case 58: case 59:
                this.wcs = `G${code}`;
                break;
            // Canned cycles
            case 73: // Peck drilling (high-speed)
            case 81: // Drilling
            case 82: // Drilling with dwell
            case 83: // Peck drilling
                this.cannedCycle = `G${code}`;
                this.initialZ = this.position.z;
                break;
            case 80: // Cancel canned cycle
                this.cannedCycle = null;
                break;
            case 98: // Canned cycle retract to initial Z
                this.retractMode = 'G98';
                break;
            case 99: // Canned cycle retract to R plane
                this.retractMode = 'G99';
                break;
        }
    }

    handleMCode(code, words, lineNumber) {
        switch (code) {
            case 3: // Spindle CW
                this.spindleDirection = 'cw';
                words.forEach(w => {
                    if (w[0] === 'S') {
                        this.spindleSpeed = parseFloat(w.substring(1));
                    }
                });
                break;
            case 4: // Spindle CCW
                this.spindleDirection = 'ccw';
                words.forEach(w => {
                    if (w[0] === 'S') {
                        this.spindleSpeed = parseFloat(w.substring(1));
                    }
                });
                break;
            case 5: // Spindle stop
                this.spindleDirection = 'off';
                this.spindleSpeed = 0;
                break;
            case 6: // Tool change
                words.forEach(w => {
                    if (w[0] === 'T') {
                        const toolNum = parseInt(w.substring(1));
                        this.currentTool = toolNum;
                        this.tools.add(toolNum);
                        this.toolChanges.push({
                            tool: toolNum,
                            line: lineNumber,
                            position: { ...this.position }
                        });
                    }
                });
                break;
            case 8: // Coolant flood on
            case 7: // Coolant mist on
            case 9: // Coolant off
                break;
            case 30: // Program end
            case 2:  // Program end
                break;
            case 98: // Subroutine call
                this.subroutines.push({ type: 'call', line: lineNumber });
                break;
            case 99: // Subroutine return
                this.subroutines.push({ type: 'return', line: lineNumber });
                break;
        }
    }

    addSegment(newPosition, lineNumber, arc = {}) {
        const from = { ...this.position };
        const to = { ...newPosition };

        const isRapid = this.motionMode === 'G0';
        const isArc = this.motionMode === 'G2' || this.motionMode === 'G3';
        
        // Check for helical arc (arc with Z change)
        const isHelical = isArc && Math.abs(to.z - from.z) > 0.001;

        const segment = {
            from,
            to,
            type: isRapid ? 'rapid' : (isArc ? 'arc' : 'cut'),
            gcode: this.motionMode,
            feedRate: this.feedRate,
            spindleSpeed: this.spindleSpeed,
            spindleDirection: this.spindleDirection,
            lineNumber,
            tool: this.currentTool,
            wcs: this.wcs,
            isHelical
        };

        if (isArc) {
            segment.clockwise = this.motionMode === 'G2';
            segment.plane = this.plane;
            segment.center = this.computeArcCenter(from, to, arc, segment.clockwise, this.plane);
        }

        // Calculate distance
        let distance;
        if (isArc && segment.center) {
            distance = this.calculateArcLength(from, to, segment.center, segment.clockwise, this.plane, isHelical);
            this.arcDistance += distance;
        } else {
            const dx = to.x - from.x;
            const dy = to.y - from.y;
            const dz = to.z - from.z;
            distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
        }
        
        segment.distance = distance;
        this.totalDistance += distance;

        if (isRapid) {
            segment.isRapid = true;
            this.rapidDistance += distance;
        } else {
            segment.isRapid = false;
            this.cuttingDistance += distance;
        }

        // Update bounds
        this.updateBounds(to);
        if (segment.type === 'arc' && segment.center) {
            this.updateArcBounds(segment);
        }

        this.toolPath.push(segment);
    }
    
    /**
     * Calculate arc length including helical Z movement
     */
    calculateArcLength(from, to, center, clockwise, plane, isHelical) {
        if (plane !== 'XY') {
            // Simplified for non-XY planes
            const dx = to.x - from.x;
            const dy = to.y - from.y;
            const dz = to.z - from.z;
            return Math.sqrt(dx * dx + dy * dy + dz * dz);
        }
        
        const startAngle = Math.atan2(from.y - center.y, from.x - center.x);
        const endAngle = Math.atan2(to.y - center.y, to.x - center.x);
        const radius = Math.sqrt(Math.pow(from.x - center.x, 2) + Math.pow(from.y - center.y, 2));
        
        let deltaAngle = endAngle - startAngle;
        if (clockwise && deltaAngle > 0) deltaAngle -= 2 * Math.PI;
        if (!clockwise && deltaAngle < 0) deltaAngle += 2 * Math.PI;
        
        const arcLength2D = Math.abs(deltaAngle) * radius;
        
        if (isHelical) {
            const zDelta = Math.abs(to.z - from.z);
            return Math.sqrt(arcLength2D * arcLength2D + zDelta * zDelta);
        }
        
        return arcLength2D;
    }

    computeArcCenter(from, to, arc, clockwise, plane) {
        // Visualization currently only interpolates XY-plane arcs correctly.
        if (plane !== 'XY') return null;

        const hasIJK = (arc.arcI !== null || arc.arcJ !== null);
        if (hasIJK) {
            const i = arc.arcI || 0;
            const j = arc.arcJ || 0;
            return { x: from.x + i, y: from.y + j, z: from.z };
        }

        if (arc.arcR === null) return null;

        // R-parameter arc center (XY plane)
        const x0 = from.x;
        const y0 = from.y;
        const x1 = to.x;
        const y1 = to.y;

        const r = Math.abs(arc.arcR);
        const dx = x1 - x0;
        const dy = y1 - y0;
        const chord = Math.hypot(dx, dy);
        if (!(chord > 0) || chord > 2 * r) return null;

        const mx = (x0 + x1) / 2;
        const my = (y0 + y1) / 2;
        const h = Math.sqrt(Math.max(0, r * r - (chord * chord) / 4));

        // Perpendicular unit vector
        const ux = -dy / chord;
        const uy = dx / chord;

        const c1 = { x: mx + ux * h, y: my + uy * h, z: from.z };
        const c2 = { x: mx - ux * h, y: my - uy * h, z: from.z };

        // Choose center based on desired sweep (small vs large) and direction
        const wantLargeArc = arc.arcR < 0;

        const sweepForCenter = (c) => {
            const a0 = Math.atan2(y0 - c.y, x0 - c.x);
            const a1 = Math.atan2(y1 - c.y, x1 - c.x);
            let da = a1 - a0;
            if (clockwise && da > 0) da -= 2 * Math.PI;
            if (!clockwise && da < 0) da += 2 * Math.PI;
            return Math.abs(da);
        };

        const sweep1 = sweepForCenter(c1);
        const sweep2 = sweepForCenter(c2);

        // Pick the one matching large/small arc intent
        if (wantLargeArc) {
            return sweep1 >= sweep2 ? c1 : c2;
        }
        return sweep1 <= sweep2 ? c1 : c2;
    }

    updateArcBounds(segment) {
        const { from, to, center, clockwise } = segment;
        if (!center) return;

        const steps = 16;
        const startAngle = Math.atan2(from.y - center.y, from.x - center.x);
        const endAngle = Math.atan2(to.y - center.y, to.x - center.x);
        const radius = Math.hypot(from.x - center.x, from.y - center.y);

        let deltaAngle = endAngle - startAngle;
        if (clockwise && deltaAngle > 0) deltaAngle -= 2 * Math.PI;
        if (!clockwise && deltaAngle < 0) deltaAngle += 2 * Math.PI;

        for (let i = 0; i <= steps; i++) {
            const t = i / steps;
            const angle = startAngle + deltaAngle * t;
            const x = center.x + radius * Math.cos(angle);
            const y = center.y + radius * Math.sin(angle);
            const z = from.z + (to.z - from.z) * t;
            this.updateBounds({ x, y, z });
        }
    }

    updateBounds(pos) {
        this.bounds.minX = Math.min(this.bounds.minX, pos.x);
        this.bounds.maxX = Math.max(this.bounds.maxX, pos.x);
        this.bounds.minY = Math.min(this.bounds.minY, pos.y);
        this.bounds.maxY = Math.max(this.bounds.maxY, pos.y);
        this.bounds.minZ = Math.min(this.bounds.minZ, pos.z);
        this.bounds.maxZ = Math.max(this.bounds.maxZ, pos.z);
    }

    calculateEstimatedTime() {
        let time = 0;
        const rapidFeed = 5000; // mm/min for rapids

        this.toolPath.forEach(segment => {
            const feed = segment.isRapid ? rapidFeed : segment.feedRate;
            const safeFeed = (Number.isFinite(feed) && feed > 0) ? feed : 1;
            time += (segment.distance / safeFeed) * 60; // seconds
        });
        
        // Add time for tool changes (estimate 15 seconds each)
        time += this.toolChanges.length * 15;

        this.estimatedTime = time;
    }

    formatTime(seconds) {
        const hrs = Math.floor(seconds / 3600);
        const mins = Math.floor((seconds % 3600) / 60);
        const secs = Math.floor(seconds % 60);
        
        if (hrs > 0) {
            return `${hrs}h ${mins}m`;
        } else if (mins > 0) {
            return `${mins}m ${secs}s`;
        }
        return `${secs}s`;
    }
    
    /**
     * Get a specific line's segment(s)
     */
    getSegmentsForLine(lineNumber) {
        return this.toolPath.filter(s => s.lineNumber === lineNumber);
    }
    
    /**
     * Get segments within a Z range
     */
    getSegmentsInZRange(minZ, maxZ) {
        return this.toolPath.filter(s => 
            (s.from.z >= minZ && s.from.z <= maxZ) ||
            (s.to.z >= minZ && s.to.z <= maxZ)
        );
    }
    
    /**
     * Get segments for a specific tool
     */
    getSegmentsForTool(toolNumber) {
        return this.toolPath.filter(s => s.tool === toolNumber);
    }
}

// Export for use
window.GCodeParser = GCodeParser;
