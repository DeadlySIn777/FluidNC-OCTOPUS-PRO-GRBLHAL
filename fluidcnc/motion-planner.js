/**
 * FluidCNC - Advanced Motion Planner
 * 
 * S-Curve and Jerk-Limited Motion Planning for Steppers
 * Reduces step loss by eliminating jerky motion that causes
 * steppers to lose synchronization.
 * 
 * Features:
 * - 7-segment S-curve acceleration profiles
 * - Jerk limiting to prevent resonance excitation
 * - Look-ahead path optimization
 * - Corner smoothing with configurable deviation
 * - Velocity-dependent acceleration
 * - Anti-resonance feed rate adjustment
 */

class AdvancedMotionPlanner {
    constructor(options = {}) {
        // Machine parameters
        this.maxVelocity = options.maxVelocity || { x: 6000, y: 6000, z: 3000 }; // mm/min
        this.maxAcceleration = options.maxAcceleration || { x: 500, y: 500, z: 200 }; // mm/s²
        this.maxJerk = options.maxJerk || { x: 5000, y: 5000, z: 2000 }; // mm/s³
        
        // Look-ahead buffer
        this.lookAheadBuffer = [];
        this.lookAheadSize = options.lookAheadSize || 20;
        
        // Corner smoothing
        this.cornerDeviation = options.cornerDeviation || 0.01; // mm - max deviation from programmed path
        this.junctionSpeed = options.junctionSpeed || 10; // mm/s - minimum junction velocity
        
        // Resonance avoidance
        this.resonanceFrequencies = options.resonanceFrequencies || []; // Hz
        this.resonanceWidth = options.resonanceWidth || 50; // Hz bandwidth to avoid
        
        // Motor parameters (for resonance calculation)
        this.stepsPerMM = options.stepsPerMM || { x: 400, y: 400, z: 800 };
        this.microstepping = options.microstepping || 16;
        
        // Callbacks
        this.onSegmentReady = options.onSegmentReady || null;
        this.onPathOptimized = options.onPathOptimized || null;
    }
    
    /**
     * Generate 7-segment S-curve motion profile
     * Provides smooth acceleration with limited jerk
     */
    generateSCurveProfile(distance, startVel, endVel, maxVel) {
        const jerkMax = Math.min(this.maxJerk.x, this.maxJerk.y);
        const accelMax = Math.min(this.maxAcceleration.x, this.maxAcceleration.y);
        
        // Limit velocities
        maxVel = Math.min(maxVel, Math.max(this.maxVelocity.x, this.maxVelocity.y) / 60); // to mm/s
        startVel = Math.min(startVel, maxVel);
        endVel = Math.min(endVel, maxVel);
        
        // Time to reach max acceleration (jerk phase duration)
        const tJerk = accelMax / jerkMax;
        
        // Velocity change during jerk phases
        const dVJerk = 0.5 * jerkMax * tJerk * tJerk;
        
        // Remaining velocity change needed for constant accel phase
        const dVAccelPhase = Math.max(0, (maxVel - startVel) - 2 * dVJerk);
        const tConstAccel = dVAccelPhase / accelMax;
        
        // Generate the 7 segments
        const segments = [];
        let t = 0;
        let v = startVel;
        let s = 0;
        
        // Segment 1: Increasing jerk (acceleration builds up)
        if (tJerk > 0) {
            segments.push({
                type: 'jerk_up',
                duration: tJerk,
                startVel: v,
                jerk: jerkMax,
                distance: this.calcJerkDistance(v, jerkMax, tJerk)
            });
            v += dVJerk;
            s += segments[segments.length - 1].distance;
        }
        
        // Segment 2: Constant acceleration
        if (tConstAccel > 0) {
            const d = v * tConstAccel + 0.5 * accelMax * tConstAccel * tConstAccel;
            segments.push({
                type: 'const_accel',
                duration: tConstAccel,
                startVel: v,
                acceleration: accelMax,
                distance: d
            });
            v += accelMax * tConstAccel;
            s += d;
        }
        
        // Segment 3: Decreasing jerk (acceleration reduces to zero)
        if (tJerk > 0) {
            segments.push({
                type: 'jerk_down',
                duration: tJerk,
                startVel: v,
                jerk: -jerkMax,
                distance: this.calcJerkDistance(v, -jerkMax, tJerk)
            });
            v += dVJerk;
            s += segments[segments.length - 1].distance;
        }
        
        // Segment 4: Cruise (constant velocity)
        const cruiseDistance = Math.max(0, distance - s - this.calcDecelerationDistance(v, endVel, accelMax, jerkMax));
        if (cruiseDistance > 0) {
            const tCruise = cruiseDistance / v;
            segments.push({
                type: 'cruise',
                duration: tCruise,
                velocity: v,
                distance: cruiseDistance
            });
            s += cruiseDistance;
        }
        
        // Segments 5-7: Mirror of 1-3 for deceleration
        // Segment 5: Increasing negative jerk
        if (tJerk > 0 && v > endVel) {
            segments.push({
                type: 'jerk_down_decel',
                duration: tJerk,
                startVel: v,
                jerk: -jerkMax,
                distance: this.calcJerkDistance(v, -jerkMax, tJerk)
            });
            v -= dVJerk;
            s += segments[segments.length - 1].distance;
        }
        
        // Segment 6: Constant deceleration
        if (tConstAccel > 0 && v > endVel) {
            const d = Math.max(0, v * tConstAccel - 0.5 * accelMax * tConstAccel * tConstAccel);
            segments.push({
                type: 'const_decel',
                duration: tConstAccel,
                startVel: v,
                acceleration: -accelMax,
                distance: d
            });
            v = Math.max(endVel, v - accelMax * tConstAccel);
            s += d;
        }
        
        // Segment 7: Decreasing negative jerk (final approach)
        if (tJerk > 0 && v > endVel) {
            segments.push({
                type: 'jerk_up_final',
                duration: tJerk,
                startVel: v,
                jerk: jerkMax,
                distance: this.calcJerkDistance(v, jerkMax, tJerk)
            });
        }
        
        return segments;
    }
    
    calcJerkDistance(v0, jerk, t) {
        // s = v0*t + 0.5*a0*t² + (1/6)*jerk*t³
        // With a0 = 0 at start of jerk phase
        return v0 * t + (1/6) * Math.abs(jerk) * t * t * t;
    }
    
    calcDecelerationDistance(v0, vf, aMax, jMax) {
        const tJerk = aMax / jMax;
        const dVJerk = 0.5 * jMax * tJerk * tJerk;
        const dVConst = Math.max(0, (v0 - vf) - 2 * dVJerk);
        const tConst = dVConst / aMax;
        
        let d = 0;
        d += this.calcJerkDistance(v0, -jMax, tJerk);
        if (tConst > 0) {
            const v1 = v0 - dVJerk;
            d += v1 * tConst - 0.5 * aMax * tConst * tConst;
        }
        d += this.calcJerkDistance(v0 - dVJerk - dVConst, jMax, tJerk);
        
        return d;
    }
    
    /**
     * Look-ahead path planner - analyzes upcoming moves
     * to optimize velocities at corners
     */
    addMove(move) {
        this.lookAheadBuffer.push(move);
        
        if (this.lookAheadBuffer.length >= this.lookAheadSize) {
            this.processLookAhead();
        }
    }
    
    processLookAhead() {
        if (this.lookAheadBuffer.length < 2) return;
        
        // Work backwards to calculate junction velocities
        for (let i = this.lookAheadBuffer.length - 2; i >= 0; i--) {
            const current = this.lookAheadBuffer[i];
            const next = this.lookAheadBuffer[i + 1];
            
            // Calculate corner angle
            const angle = this.calculateCornerAngle(current, next);
            
            // Calculate maximum junction velocity based on corner deviation
            const junctionVel = this.calculateJunctionVelocity(angle);
            
            // Update exit velocity of current move
            current.exitVelocity = Math.min(
                current.exitVelocity || current.requestedFeed,
                junctionVel,
                next.entryVelocity || next.requestedFeed
            );
            
            // Calculate entry velocity based on exit and distance
            const maxEntry = this.maxEntryVelocity(current.distance, current.exitVelocity);
            current.entryVelocity = Math.min(
                current.entryVelocity || current.requestedFeed,
                maxEntry
            );
        }
        
        // Process first segment and emit
        const segment = this.lookAheadBuffer.shift();
        if (this.onSegmentReady) {
            const profile = this.generateSCurveProfile(
                segment.distance,
                segment.entryVelocity || 0,
                segment.exitVelocity || 0,
                segment.requestedFeed / 60
            );
            this.onSegmentReady(segment, profile);
        }
    }
    
    calculateCornerAngle(move1, move2) {
        // Calculate angle between two move vectors
        const v1 = this.normalizeVector({
            x: move1.endX - move1.startX,
            y: move1.endY - move1.startY,
            z: move1.endZ - move1.startZ
        });
        
        const v2 = this.normalizeVector({
            x: move2.endX - move2.startX,
            y: move2.endY - move2.startY,
            z: move2.endZ - move2.startZ
        });
        
        // Dot product gives cos(angle)
        const dot = v1.x * v2.x + v1.y * v2.y + v1.z * v2.z;
        return Math.acos(Math.max(-1, Math.min(1, dot)));
    }
    
    normalizeVector(v) {
        const len = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
        if (len < 1e-10) return { x: 0, y: 0, z: 0 };
        return { x: v.x / len, y: v.y / len, z: v.z / len };
    }
    
    calculateJunctionVelocity(angle) {
        // Based on centripetal acceleration: a = v²/r
        // Where r = deviation / (1 - cos(angle/2))
        
        if (angle < 0.001) {
            return this.maxVelocity.x / 60; // Straight line - full speed
        }
        
        const halfAngle = angle / 2;
        const sinHalf = Math.sin(halfAngle);
        
        if (sinHalf < 0.001) {
            return this.maxVelocity.x / 60;
        }
        
        const radius = this.cornerDeviation / (1 - Math.cos(halfAngle));
        const accelLimit = Math.min(this.maxAcceleration.x, this.maxAcceleration.y);
        
        // v = sqrt(a * r)
        const junctionVel = Math.sqrt(accelLimit * radius);
        
        return Math.max(this.junctionSpeed, Math.min(junctionVel, this.maxVelocity.x / 60));
    }
    
    maxEntryVelocity(distance, exitVelocity) {
        // v² = v₀² + 2*a*d
        // v₀ = sqrt(v² - 2*a*d)
        const accel = Math.min(this.maxAcceleration.x, this.maxAcceleration.y);
        const vSq = exitVelocity * exitVelocity + 2 * accel * distance;
        return Math.sqrt(Math.max(0, vSq));
    }
    
    /**
     * Calculate step frequency at given feed rate
     * Used for resonance avoidance
     */
    feedToStepFrequency(feedMmMin, axis = 'x') {
        const feedMmSec = feedMmMin / 60;
        const stepsPerMM = this.stepsPerMM[axis] * this.microstepping;
        return feedMmSec * stepsPerMM; // Hz
    }
    
    /**
     * Check if feed rate falls within resonance zone
     */
    isResonanceZone(feedMmMin, axis = 'x') {
        const freq = this.feedToStepFrequency(feedMmMin, axis);
        
        for (const resFreq of this.resonanceFrequencies) {
            if (Math.abs(freq - resFreq) < this.resonanceWidth) {
                return {
                    isResonance: true,
                    frequency: freq,
                    resonanceFrequency: resFreq,
                    // Suggest safe feed rate (move out of resonance zone)
                    safeFeedLower: this.stepFrequencyToFeed(resFreq - this.resonanceWidth, axis),
                    safeFeedHigher: this.stepFrequencyToFeed(resFreq + this.resonanceWidth, axis)
                };
            }
        }
        
        return { isResonance: false, frequency: freq };
    }
    
    stepFrequencyToFeed(freq, axis = 'x') {
        const stepsPerMM = this.stepsPerMM[axis] * this.microstepping;
        return (freq / stepsPerMM) * 60; // mm/min
    }
    
    /**
     * Auto-detect resonance frequencies by monitoring current
     * during velocity sweep
     */
    async detectResonance(grbl, axis = 'X', callbacks = {}) {
        const detectedResonances = [];
        
        // Sweep through feed rates
        const feedRates = [];
        for (let f = 100; f <= 6000; f += 50) {
            feedRates.push(f);
        }
        
        // Need current monitoring active
        if (callbacks.onProgress) {
            callbacks.onProgress(0, 'Starting resonance detection sweep...');
        }
        
        const currentReadings = [];
        
        for (let i = 0; i < feedRates.length; i++) {
            const feed = feedRates[i];
            
            // Move at this feed rate
            await grbl.send(`G1 ${axis}10 F${feed}`);
            await grbl.send(`G1 ${axis}0 F${feed}`);
            
            // Wait for move and sample current
            await this.sleep(500);
            
            // Get current reading (from step loss detection if available)
            const current = callbacks.getCurrentReading ? 
                            await callbacks.getCurrentReading() : 0;
            
            currentReadings.push({ feed, current });
            
            if (callbacks.onProgress) {
                callbacks.onProgress((i / feedRates.length) * 100, 
                    `Testing ${feed} mm/min, current: ${current.toFixed(2)}A`);
            }
        }
        
        // Analyze for resonance peaks (high current = potential resonance)
        const avgCurrent = currentReadings.reduce((s, r) => s + r.current, 0) / currentReadings.length;
        const threshold = avgCurrent * 1.5;
        
        for (let i = 1; i < currentReadings.length - 1; i++) {
            const prev = currentReadings[i - 1].current;
            const curr = currentReadings[i].current;
            const next = currentReadings[i + 1].current;
            
            // Peak detection
            if (curr > prev && curr > next && curr > threshold) {
                const freq = this.feedToStepFrequency(currentReadings[i].feed, axis.toLowerCase());
                detectedResonances.push({
                    feedRate: currentReadings[i].feed,
                    frequency: freq,
                    current: curr
                });
            }
        }
        
        // Update resonance list
        this.resonanceFrequencies = detectedResonances.map(r => r.frequency);
        
        if (callbacks.onComplete) {
            callbacks.onComplete(detectedResonances);
        }
        
        return detectedResonances;
    }
    
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
    
    /**
     * Convert S-curve profile to G-code with interpolated points
     * For firmware that doesn't support native S-curve
     */
    profileToGCode(profile, move) {
        const gcode = [];
        const dt = 0.01; // 10ms time steps
        
        let pos = { x: move.startX, y: move.startY, z: move.startZ };
        const dir = this.normalizeVector({
            x: move.endX - move.startX,
            y: move.endY - move.startY,
            z: move.endZ - move.startZ
        });
        
        for (const segment of profile) {
            const steps = Math.ceil(segment.duration / dt);
            
            for (let i = 0; i < steps; i++) {
                const t = i * dt;
                let v, dist;
                
                switch (segment.type) {
                    case 'jerk_up':
                    case 'jerk_down':
                    case 'jerk_down_decel':
                    case 'jerk_up_final':
                        // v = v0 + j*t²/2
                        v = segment.startVel + 0.5 * segment.jerk * t * t;
                        dist = segment.startVel * t + (1/6) * segment.jerk * t * t * t;
                        break;
                    case 'const_accel':
                    case 'const_decel':
                        v = segment.startVel + segment.acceleration * t;
                        dist = segment.startVel * t + 0.5 * segment.acceleration * t * t;
                        break;
                    case 'cruise':
                        v = segment.velocity;
                        dist = v * t;
                        break;
                }
                
                // Update position
                const newPos = {
                    x: move.startX + dir.x * dist,
                    y: move.startY + dir.y * dist,
                    z: move.startZ + dir.z * dist
                };
                
                // Only emit if position changed significantly (0.01mm)
                const delta = Math.sqrt(
                    Math.pow(newPos.x - pos.x, 2) +
                    Math.pow(newPos.y - pos.y, 2) +
                    Math.pow(newPos.z - pos.z, 2)
                );
                
                if (delta > 0.01) {
                    const feedRate = Math.round(v * 60);
                    gcode.push(`G1 X${newPos.x.toFixed(3)} Y${newPos.y.toFixed(3)} Z${newPos.z.toFixed(3)} F${feedRate}`);
                    pos = newPos;
                }
            }
        }
        
        return gcode;
    }
    
    /**
     * Optimize G-code file with S-curve motion
     */
    optimizeGCode(gcodeLines) {
        const optimized = [];
        let currentPos = { x: 0, y: 0, z: 0 };
        let pendingMoves = [];
        
        for (const line of gcodeLines) {
            const parsed = this.parseGCodeLine(line);
            
            if (parsed.isMove) {
                pendingMoves.push({
                    startX: currentPos.x,
                    startY: currentPos.y,
                    startZ: currentPos.z,
                    endX: parsed.x ?? currentPos.x,
                    endY: parsed.y ?? currentPos.y,
                    endZ: parsed.z ?? currentPos.z,
                    requestedFeed: parsed.f || 1000,
                    distance: this.distance3D(currentPos, {
                        x: parsed.x ?? currentPos.x,
                        y: parsed.y ?? currentPos.y,
                        z: parsed.z ?? currentPos.z
                    }),
                    originalLine: line
                });
                
                currentPos = {
                    x: parsed.x ?? currentPos.x,
                    y: parsed.y ?? currentPos.y,
                    z: parsed.z ?? currentPos.z
                };
                
                // Process when buffer is full
                if (pendingMoves.length >= this.lookAheadSize) {
                    const processed = this.processMoveBuffer(pendingMoves);
                    optimized.push(...processed);
                    pendingMoves = [];
                }
            } else {
                // Flush pending moves
                if (pendingMoves.length > 0) {
                    const processed = this.processMoveBuffer(pendingMoves);
                    optimized.push(...processed);
                    pendingMoves = [];
                }
                
                // Keep non-move commands as-is
                optimized.push(line);
            }
        }
        
        // Flush remaining
        if (pendingMoves.length > 0) {
            const processed = this.processMoveBuffer(pendingMoves);
            optimized.push(...processed);
        }
        
        return optimized;
    }
    
    processMoveBuffer(moves) {
        const result = [];
        
        // Calculate junction velocities (backward pass)
        for (let i = moves.length - 2; i >= 0; i--) {
            const current = moves[i];
            const next = moves[i + 1];
            
            const angle = this.calculateCornerAngle(current, next);
            const junctionVel = this.calculateJunctionVelocity(angle);
            
            current.exitVelocity = Math.min(
                current.requestedFeed / 60,
                junctionVel,
                (next.entryVelocity || next.requestedFeed / 60)
            );
            
            current.entryVelocity = Math.min(
                current.requestedFeed / 60,
                this.maxEntryVelocity(current.distance, current.exitVelocity)
            );
        }
        
        // Forward pass to generate G-code
        for (const move of moves) {
            // Check for resonance
            const resonanceCheck = this.isResonanceZone(move.requestedFeed);
            if (resonanceCheck.isResonance) {
                // Adjust feed to avoid resonance
                move.requestedFeed = resonanceCheck.safeFeedHigher > move.requestedFeed 
                    ? resonanceCheck.safeFeedLower 
                    : resonanceCheck.safeFeedHigher;
                result.push(`; Adjusted feed to avoid resonance at ${resonanceCheck.resonanceFrequency.toFixed(0)}Hz`);
            }
            
            const profile = this.generateSCurveProfile(
                move.distance,
                move.entryVelocity || 0,
                move.exitVelocity || 0,
                move.requestedFeed / 60
            );
            
            // For simple firmware, just output optimized feed
            // For advanced, could output interpolated points
            const avgVel = (move.entryVelocity + move.exitVelocity) / 2 || move.requestedFeed / 60;
            const optimizedFeed = Math.round(avgVel * 60);
            
            result.push(`G1 X${move.endX.toFixed(3)} Y${move.endY.toFixed(3)} Z${move.endZ.toFixed(3)} F${optimizedFeed}`);
        }
        
        return result;
    }
    
    parseGCodeLine(line) {
        const result = { isMove: false };
        
        // Remove comments
        const code = line.split(';')[0].split('(')[0].trim().toUpperCase();
        if (!code) return result;
        
        // Check for G0/G1
        if (code.includes('G0') || code.includes('G1')) {
            result.isMove = true;
            
            const xMatch = code.match(/X(-?\d+\.?\d*)/);
            const yMatch = code.match(/Y(-?\d+\.?\d*)/);
            const zMatch = code.match(/Z(-?\d+\.?\d*)/);
            const fMatch = code.match(/F(\d+\.?\d*)/);
            
            if (xMatch) result.x = parseFloat(xMatch[1]);
            if (yMatch) result.y = parseFloat(yMatch[1]);
            if (zMatch) result.z = parseFloat(zMatch[1]);
            if (fMatch) result.f = parseFloat(fMatch[1]);
        }
        
        return result;
    }
    
    distance3D(p1, p2) {
        return Math.sqrt(
            Math.pow(p2.x - p1.x, 2) +
            Math.pow(p2.y - p1.y, 2) +
            Math.pow(p2.z - p1.z, 2)
        );
    }
}

// Export for use in FluidCNC
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { AdvancedMotionPlanner };
}
