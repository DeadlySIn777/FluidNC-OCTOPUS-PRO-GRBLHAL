/**
 * G-code Parser for FluidCNC
 * Parses G-code into toolpath segments for visualization
 */

class GCodeParser {
    constructor() {
        this.reset();
    }

    reset() {
        this.position = { x: 0, y: 0, z: 0 };
        this.feedRate = 1000;
        this.spindleSpeed = 0;
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
        this.estimatedTime = 0;
    }

    parse(gcode) {
        this.reset();
        const lines = gcode.split('\n');
        
        lines.forEach((line, index) => {
            this.parseLine(line.trim(), index + 1);
        });

        this.calculateEstimatedTime();

        // Avoid Infinity bounds when file has no motion
        if (!this.toolPath.length) {
            this.bounds = { minX: 0, maxX: 0, minY: 0, maxY: 0, minZ: 0, maxZ: 0 };
        }
        return {
            toolPath: this.toolPath,
            bounds: this.bounds,
            stats: {
                totalDistance: this.totalDistance,
                cuttingDistance: this.cuttingDistance,
                rapidDistance: this.rapidDistance,
                estimatedTime: this.estimatedTime,
                lineCount: lines.length
            }
        };
    }

    parseLine(line, lineNumber) {
        // Remove comments
        let code = line.split(';')[0].split('(')[0].trim().toUpperCase();
        if (!code) return;

        const words = this.tokenize(code);
        let newPosition = { ...this.position };
        let hasMotion = false;
        let arcI = null;
        let arcJ = null;
        let arcK = null;
        let arcR = null;

        words.forEach(word => {
            const letter = word[0];
            const valueRaw = parseFloat(word.substring(1));
            if (!Number.isFinite(valueRaw)) return;

            // Most coordinate-like words scale with units (G20 inches -> mm)
            const value = (letter === 'G' || letter === 'M') ? valueRaw : valueRaw * this.unitsScale;

            switch (letter) {
                case 'G':
                    this.handleGCode(value);
                    break;
                case 'M':
                    this.handleMCode(value, words);
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
                    // Arc center offsets are relative to the start position
                    arcI = value;
                    break;
                case 'J':
                    arcJ = value;
                    break;
                case 'K':
                    arcK = value;
                    break;
                case 'R':
                    arcR = value;
                    break;
                case 'F':
                    this.feedRate = value;
                    break;
                case 'S':
                    this.spindleSpeed = value;
                    break;
            }
        });

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

    handleGCode(code) {
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
            case 53: /* Machine coords - handle specially */ break;
        }
    }

    handleMCode(code, words) {
        switch (code) {
            case 3: // Spindle CW
            case 4: // Spindle CCW
                words.forEach(w => {
                    if (w[0] === 'S') {
                        this.spindleSpeed = parseFloat(w.substring(1));
                    }
                });
                break;
            case 5: // Spindle stop
                this.spindleSpeed = 0;
                break;
        }
    }

    addSegment(newPosition, lineNumber, arc = {}) {
        const from = { ...this.position };
        const to = { ...newPosition };

        const isRapid = this.motionMode === 'G0';
        const isArc = this.motionMode === 'G2' || this.motionMode === 'G3';

        const segment = {
            from,
            to,
            // Visualizers expect: 'rapid' | 'arc' | (anything else treated as cut)
            type: isRapid ? 'rapid' : (isArc ? 'arc' : 'cut'),
            gcode: this.motionMode,
            feedRate: this.feedRate,
            spindleSpeed: this.spindleSpeed,
            lineNumber
        };

        if (isArc) {
            segment.clockwise = this.motionMode === 'G2';
            segment.plane = this.plane;
            segment.center = this.computeArcCenter(from, to, arc, segment.clockwise, this.plane);
        }

        // Calculate distance
        const dx = to.x - from.x;
        const dy = to.y - from.y;
        const dz = to.z - from.z;
        const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
        
        segment.distance = distance;
        this.totalDistance += distance;

        if (isRapid) {
            segment.isRapid = true;
            this.rapidDistance += distance;
        } else {
            segment.isRapid = false;
            this.cuttingDistance += distance;
        }

        // Update bounds (include arcs by sampling a few points)
        this.updateBounds(to);
        if (segment.type === 'arc' && segment.center && segment.plane === 'XY') {
            this.updateArcBounds(segment);
        }

        this.toolPath.push(segment);
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
}

// Export for use
window.GCodeParser = GCodeParser;
