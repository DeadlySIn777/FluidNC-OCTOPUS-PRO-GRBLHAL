/**
 * G-Code Safety Fixer - Automatic Error Prevention
 * 
 * Instead of throwing alarms, this system:
 * 1. INTERCEPTS dangerous G-code before it runs
 * 2. FIXES common errors automatically
 * 3. WARNS the user but keeps running (when safe)
 * 4. LEARNS from past mistakes
 * 
 * Catches:
 * - Z plunge into material (missing retract)
 * - Rapids through material (G0 when should be G1)
 * - Feed rate too high/missing
 * - Spindle not on before cut
 * - Out of bounds moves
 * - Tool change without retract
 * - Missing safety height moves
 * - Arc errors (I/J/R problems)
 * - Soft limit violations
 * - Rapid to negative Z
 */

class GCodeSafetyFixer {
    constructor(options = {}) {
        this.enabled = options.enabled !== false;
        this.autoFix = options.autoFix !== false;
        this.notifyOnFix = options.notifyOnFix !== false;
        this.onFix = options.onFix || (() => {});
        this.onWarning = options.onWarning || (() => {});
        this.onBlock = options.onBlock || (() => {});
        
        // Machine limits
        this.limits = {
            minX: options.minX || 0,
            maxX: options.maxX || 350,
            minY: options.minY || 0,
            maxY: options.maxY || 500,
            minZ: options.minZ || -50,  // How deep can we cut?
            maxZ: options.maxZ || 120,
            maxFeedXY: options.maxFeedXY || 5000,
            maxFeedZ: options.maxFeedZ || 1000,
            defaultFeed: options.defaultFeed || 1000,
            safeZ: options.safeZ || 5,
            retractZ: options.retractZ || 25,
            maxRapidZ: options.maxRapidZ || 2,  // Don't rapid below this Z
        };
        
        // Material/Stock boundaries (set by probing or user)
        this.stock = {
            defined: false,
            topZ: 0,
            bottomZ: -20,
            minX: 0,
            maxX: 100,
            minY: 0,
            maxY: 100
        };
        
        // Current machine state (tracked)
        this.state = {
            x: 0, y: 0, z: this.limits.safeZ,
            feedRate: 1000,
            spindleOn: false,
            spindleRPM: 0,
            absoluteMode: true,  // G90
            inchMode: false,     // G20 vs G21
            currentTool: 0,
            lastRetractZ: this.limits.retractZ,
            inCuttingPass: false,
            lastSafeZ: this.limits.safeZ,
        };
        
        // Statistics
        this.stats = {
            linesProcessed: 0,
            fixesApplied: 0,
            warningsIssued: 0,
            blockedCommands: 0,
            fixTypes: {},
            // Aliases for UI compatibility
            get checked() { return this.linesProcessed; },
            get fixed() { return this.fixesApplied; },
            get blocked() { return this.blockedCommands; }
        };
        
        // Fix history (for learning)
        this.fixHistory = [];
        
        // ====================================================================
        // TOOL BREAKAGE LEARNING SYSTEM
        // Remembers when/where/how tools broke and prevents similar conditions
        // ====================================================================
        this.toolBreakageDB = {
            incidents: [],       // Array of breakage incidents
            patterns: {},        // Learned danger patterns by tool/material combo
            lastBreakage: null,  // Most recent breakage for analysis
        };
        
        // Load saved settings
        this.loadSettings();
        
        // Load breakage database
        this.loadBreakageDB();
    }
    
    // ========================================================================
    // Main Processing Function
    // ========================================================================
    
    /**
     * Process a G-code line and return fixed version
     * @param {string} line - Original G-code line
     * @returns {object} { fixed: string, warnings: [], blocked: boolean, fixes: [] }
     */
    process(line) {
        if (!this.enabled) {
            return { fixed: line, warnings: [], blocked: false, fixes: [] };
        }
        
        this.stats.linesProcessed++;
        
        const result = {
            original: line,
            fixed: line,
            warnings: [],
            fixes: [],
            blocked: false
        };
        
        // Skip comments and empty lines
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith(';') || trimmed.startsWith('(')) {
            return result;
        }
        
        // Parse the line
        const parsed = this.parseLine(trimmed);
        
        // Run all safety checks
        this.checkSpindleBeforeCut(parsed, result);
        this.checkDangerousRapid(parsed, result);
        this.checkZPlunge(parsed, result);
        this.checkFeedRate(parsed, result);
        this.checkSoftLimits(parsed, result);
        this.checkArcErrors(parsed, result);
        this.checkToolChange(parsed, result);
        this.checkMissingRetract(parsed, result);
        
        // Check against learned breakage patterns
        this.checkLearnedBreakagePatterns(parsed, result);
        
        // Apply fixes if enabled
        if (this.autoFix && result.fixes.length > 0) {
            result.fixed = this.applyFixes(parsed, result.fixes);
            this.stats.fixesApplied += result.fixes.length;
            
            // Track fix types
            result.fixes.forEach(fix => {
                this.stats.fixTypes[fix.type] = (this.stats.fixTypes[fix.type] || 0) + 1;
            });
            
            // Notify
            if (this.notifyOnFix) {
                this.onFix(result);
            }
            
            // Save to history
            this.fixHistory.push({
                time: Date.now(),
                original: line,
                fixed: result.fixed,
                fixes: result.fixes
            });
        }
        
        // Update state based on final command
        this.updateState(this.parseLine(result.fixed));
        
        return result;
    }
    
    /**
     * Process entire G-code file
     * @param {string} gcode - Full G-code content
     * @returns {object} { fixed: string, totalFixes: number, warnings: [] }
     */
    processFile(gcode) {
        const lines = gcode.split('\n');
        const fixedLines = [];
        const allWarnings = [];
        let totalFixes = 0;
        
        // Reset state for new file
        this.resetState();
        
        // Pre-scan for stock definition
        this.scanForStock(gcode);
        
        for (let i = 0; i < lines.length; i++) {
            const result = this.process(lines[i]);
            fixedLines.push(result.fixed);
            
            if (result.warnings.length > 0) {
                result.warnings.forEach(w => {
                    allWarnings.push({ line: i + 1, warning: w });
                });
            }
            
            totalFixes += result.fixes.length;
        }
        
        // Add safety header if fixes were made
        let output = fixedLines.join('\n');
        if (totalFixes > 0) {
            const header = `; === G-CODE SAFETY FIXER ===\n; ${totalFixes} automatic fixes applied\n; ${allWarnings.length} warnings\n; Always verify before running!\n;\n`;
            output = header + output;
        }
        
        return {
            fixed: output,
            totalFixes,
            warnings: allWarnings,
            stats: { ...this.stats }
        };
    }
    
    // ========================================================================
    // Safety Checks
    // ========================================================================
    
    /**
     * Check: Spindle must be on before cutting moves
     */
    checkSpindleBeforeCut(parsed, result) {
        // Is this a cutting move?
        if ((parsed.G === 1 || parsed.G === 2 || parsed.G === 3) && parsed.Z !== undefined) {
            // Going down into material?
            const targetZ = parsed.Z;
            const isPlunge = targetZ < this.state.z;
            const inMaterial = targetZ < (this.stock.defined ? this.stock.topZ : 0);
            
            if (isPlunge && inMaterial && !this.state.spindleOn) {
                result.warnings.push('⚠️ Cutting move without spindle! Adding M3 S12000');
                result.fixes.push({
                    type: 'SPINDLE_NOT_ON',
                    action: 'prepend',
                    code: 'M3 S12000 ; AUTO-FIX: Spindle on before cut'
                });
            }
        }
    }
    
    /**
     * Check: Rapid (G0) into material is DANGEROUS
     */
    checkDangerousRapid(parsed, result) {
        if (parsed.G !== 0) return;
        
        const targetZ = parsed.Z !== undefined ? parsed.Z : this.state.z;
        const targetX = parsed.X !== undefined ? parsed.X : this.state.x;
        const targetY = parsed.Y !== undefined ? parsed.Y : this.state.y;
        
        // Rapid to negative Z below safe threshold
        if (targetZ < this.limits.maxRapidZ) {
            result.warnings.push(`⚠️ Rapid to Z${targetZ} is dangerous! Converting to G1 F${this.limits.maxFeedZ}`);
            result.fixes.push({
                type: 'DANGEROUS_RAPID',
                action: 'replace',
                from: 'G0',
                to: `G1`,
                addFeed: this.limits.maxFeedZ
            });
        }
        
        // Rapid XY move while Z is in material
        if (this.state.z < 0 && (parsed.X !== undefined || parsed.Y !== undefined)) {
            result.warnings.push('⚠️ Rapid XY while in material! Adding retract first');
            result.fixes.push({
                type: 'RAPID_IN_MATERIAL',
                action: 'prepend',
                code: `G0 Z${this.limits.safeZ} ; AUTO-FIX: Retract before rapid`
            });
        }
    }
    
    /**
     * Check: Sudden Z plunge without ramping
     */
    checkZPlunge(parsed, result) {
        if (parsed.G !== 1) return;
        if (parsed.Z === undefined) return;
        
        const deltaZ = this.state.z - parsed.Z;  // Positive = plunging down
        
        // Plunging more than 10mm in one move with XY movement = drilling in angle
        if (deltaZ > 10 && (parsed.X !== undefined || parsed.Y !== undefined)) {
            // This might be intentional ramp, but let's check feed
            const feed = parsed.F || this.state.feedRate;
            const maxPlungeFeed = this.limits.maxFeedZ * 0.5;  // 50% of max Z feed for ramp
            
            if (feed > maxPlungeFeed) {
                result.warnings.push(`⚠️ Deep plunge (${deltaZ.toFixed(1)}mm) at high feed! Reducing to F${maxPlungeFeed}`);
                result.fixes.push({
                    type: 'FAST_PLUNGE',
                    action: 'setFeed',
                    feed: maxPlungeFeed
                });
            }
        }
        
        // Straight plunge (no XY) deeper than 5mm without pecking
        if (deltaZ > 5 && parsed.X === undefined && parsed.Y === undefined) {
            result.warnings.push(`⚠️ Deep straight plunge ${deltaZ.toFixed(1)}mm - consider peck drilling`);
            // Don't auto-fix this one, just warn
        }
    }
    
    /**
     * Check: Feed rate missing or too high
     */
    checkFeedRate(parsed, result) {
        // Cutting moves need feed rate
        if (parsed.G === 1 || parsed.G === 2 || parsed.G === 3) {
            // No F word and no previous feed set
            if (parsed.F === undefined && this.state.feedRate === 0) {
                result.warnings.push(`⚠️ No feed rate specified! Adding F${this.limits.defaultFeed}`);
                result.fixes.push({
                    type: 'MISSING_FEED',
                    action: 'addFeed',
                    feed: this.limits.defaultFeed
                });
            }
            
            // Feed rate too high
            const feed = parsed.F || this.state.feedRate;
            const isZMove = parsed.Z !== undefined && (parsed.X === undefined && parsed.Y === undefined);
            const maxFeed = isZMove ? this.limits.maxFeedZ : this.limits.maxFeedXY;
            
            if (feed > maxFeed) {
                result.warnings.push(`⚠️ Feed rate F${feed} exceeds limit F${maxFeed}! Reducing.`);
                result.fixes.push({
                    type: 'FEED_TOO_HIGH',
                    action: 'setFeed',
                    feed: maxFeed
                });
            }
        }
    }
    
    /**
     * Check: Move would exceed soft limits
     */
    checkSoftLimits(parsed, result) {
        const x = parsed.X !== undefined ? parsed.X : this.state.x;
        const y = parsed.Y !== undefined ? parsed.Y : this.state.y;
        const z = parsed.Z !== undefined ? parsed.Z : this.state.z;
        
        let violations = [];
        let fixes = [];
        
        if (x < this.limits.minX) {
            violations.push(`X${x} < min ${this.limits.minX}`);
            fixes.push({ axis: 'X', value: this.limits.minX });
        }
        if (x > this.limits.maxX) {
            violations.push(`X${x} > max ${this.limits.maxX}`);
            fixes.push({ axis: 'X', value: this.limits.maxX });
        }
        if (y < this.limits.minY) {
            violations.push(`Y${y} < min ${this.limits.minY}`);
            fixes.push({ axis: 'Y', value: this.limits.minY });
        }
        if (y > this.limits.maxY) {
            violations.push(`Y${y} > max ${this.limits.maxY}`);
            fixes.push({ axis: 'Y', value: this.limits.maxY });
        }
        if (z < this.limits.minZ) {
            violations.push(`Z${z} < min ${this.limits.minZ}`);
            fixes.push({ axis: 'Z', value: this.limits.minZ });
        }
        if (z > this.limits.maxZ) {
            violations.push(`Z${z} > max ${this.limits.maxZ}`);
            fixes.push({ axis: 'Z', value: this.limits.maxZ });
        }
        
        if (violations.length > 0) {
            result.warnings.push(`⚠️ Soft limit violation: ${violations.join(', ')}`);
            fixes.forEach(f => {
                result.fixes.push({
                    type: 'SOFT_LIMIT',
                    action: 'setAxis',
                    axis: f.axis,
                    value: f.value
                });
            });
        }
    }
    
    /**
     * Check: Arc (G2/G3) errors
     */
    checkArcErrors(parsed, result) {
        if (parsed.G !== 2 && parsed.G !== 3) return;
        
        const hasIJ = parsed.I !== undefined || parsed.J !== undefined;
        const hasR = parsed.R !== undefined;
        const hasXY = parsed.X !== undefined || parsed.Y !== undefined;
        
        // Arc with no endpoint
        if (!hasXY) {
            result.warnings.push('⚠️ Arc with no endpoint - this will error!');
            result.blocked = true;
            this.stats.blockedCommands++;
            return;
        }
        
        // Arc with both R and IJ
        if (hasR && hasIJ) {
            result.warnings.push('⚠️ Arc has both R and I/J - removing R (I/J takes precedence)');
            result.fixes.push({
                type: 'ARC_R_IJ_CONFLICT',
                action: 'removeR'
            });
        }
        
        // Arc with neither R nor IJ
        if (!hasR && !hasIJ) {
            result.warnings.push('⚠️ Arc missing radius/center - cannot fix, blocking');
            result.blocked = true;
            this.stats.blockedCommands++;
        }
        
        // Check for impossible arc (endpoint too far from center)
        if (hasIJ) {
            const cx = this.state.x + (parsed.I || 0);
            const cy = this.state.y + (parsed.J || 0);
            const r = Math.sqrt((parsed.I || 0) ** 2 + (parsed.J || 0) ** 2);
            
            const ex = parsed.X !== undefined ? parsed.X : this.state.x;
            const ey = parsed.Y !== undefined ? parsed.Y : this.state.y;
            const endR = Math.sqrt((ex - cx) ** 2 + (ey - cy) ** 2);
            
            const rDiff = Math.abs(r - endR);
            if (rDiff > 0.01) {  // More than 0.01mm difference
                result.warnings.push(`⚠️ Arc endpoint not on arc (error: ${rDiff.toFixed(3)}mm) - will cause grbl error`);
                // This is hard to auto-fix, just warn
            }
        }
    }
    
    /**
     * Check: Tool change without retract
     */
    checkToolChange(parsed, result) {
        if (parsed.M === 6 || parsed.T !== undefined) {
            // Tool change - must be at safe Z
            if (this.state.z < this.limits.retractZ) {
                result.warnings.push('⚠️ Tool change below safe height! Adding retract');
                result.fixes.push({
                    type: 'TOOLCHANGE_NO_RETRACT',
                    action: 'prepend',
                    code: `G0 Z${this.limits.retractZ} ; AUTO-FIX: Retract for tool change`
                });
            }
            
            // Spindle should be off
            if (this.state.spindleOn) {
                result.warnings.push('⚠️ Tool change with spindle running! Adding M5');
                result.fixes.push({
                    type: 'TOOLCHANGE_SPINDLE_ON',
                    action: 'prepend',
                    code: 'M5 ; AUTO-FIX: Spindle off for tool change'
                });
            }
        }
    }
    
    /**
     * Check: Missing retract between operations
     */
    checkMissingRetract(parsed, result) {
        // If we were cutting (Z < 0) and now moving XY far, should retract
        if (parsed.G === 0 && this.state.z < 0) {
            const dx = Math.abs((parsed.X || this.state.x) - this.state.x);
            const dy = Math.abs((parsed.Y || this.state.y) - this.state.y);
            const dist = Math.sqrt(dx * dx + dy * dy);
            
            // Moving more than 20mm while in material
            if (dist > 20 && parsed.Z === undefined) {
                result.warnings.push('⚠️ Long rapid move while in material! Adding retract');
                result.fixes.push({
                    type: 'MISSING_RETRACT',
                    action: 'prepend',
                    code: `G0 Z${this.limits.safeZ} ; AUTO-FIX: Retract before long move`
                });
            }
        }
    }
    
    /**
     * Check: Against learned tool breakage patterns
     * Prevents repeating conditions that previously broke tools
     */
    checkLearnedBreakagePatterns(parsed, result) {
        // Only check cutting moves
        if (parsed.G !== 1 && parsed.G !== 2 && parsed.G !== 3) return;
        
        // Need to be going into material
        const targetZ = parsed.Z ?? this.state.z;
        if (targetZ >= 0) return;
        
        const feed = parsed.F ?? this.state.feedRate;
        const doc = Math.abs(targetZ);
        const rpm = this.state.spindleRPM;
        
        const toolInfo = {
            type: this.currentToolType || 'endmill',
            diameter: this.currentToolDiameter || null,
        };
        
        const materialType = this.currentMaterial || 'unknown';
        
        // Check against learned patterns
        const adjustments = this.checkAgainstLearnedPatterns(
            toolInfo, materialType, feed, doc, rpm
        );
        
        if (adjustments.needed) {
            // Add warning about learned pattern
            result.warnings.push(`⚠️ LEARNED: ${adjustments.warnings[0]}`);
            
            // Apply feed adjustment
            if (adjustments.feedAdjust && adjustments.feedAdjust < feed) {
                result.fixes.push({
                    type: 'LEARNED_FEED_LIMIT',
                    action: 'setFeed',
                    feed: adjustments.feedAdjust,
                    reason: `Tool previously broke at this feed rate`
                });
                
                result.warnings.push(`🧠 Reducing feed from F${feed} to F${adjustments.feedAdjust} based on ${adjustments.incidentCount} previous breakage(s)`);
            }
            
            // Apply RPM adjustment (would need M3 command)
            if (adjustments.rpmAdjust && adjustments.rpmAdjust > rpm) {
                result.fixes.push({
                    type: 'LEARNED_RPM_BOOST',
                    action: 'prepend',
                    code: `M3 S${adjustments.rpmAdjust} ; AUTO-FIX: Increase RPM (tool broke at lower RPM)`
                });
                
                result.warnings.push(`🧠 Increasing RPM from S${rpm} to S${adjustments.rpmAdjust} based on previous breakage`);
            }
        }
    }
    
    // ========================================================================
    // Fix Application
    // ========================================================================
    
    applyFixes(parsed, fixes) {
        let lines = [];
        let modifiedLine = this.reconstructLine(parsed);
        
        // Sort fixes: prepends first, then modifications, then appends
        const prepends = fixes.filter(f => f.action === 'prepend');
        const modifications = fixes.filter(f => f.action !== 'prepend' && f.action !== 'append');
        const appends = fixes.filter(f => f.action === 'append');
        
        // Add prepended lines
        prepends.forEach(fix => {
            lines.push(fix.code);
        });
        
        // Apply modifications to main line
        modifications.forEach(fix => {
            switch (fix.action) {
                case 'replace':
                    modifiedLine = modifiedLine.replace(fix.from, fix.to);
                    if (fix.addFeed) {
                        modifiedLine += ` F${fix.addFeed}`;
                    }
                    break;
                    
                case 'setFeed':
                    // Remove existing F and add new one
                    modifiedLine = modifiedLine.replace(/F[\d.]+/gi, '');
                    modifiedLine += ` F${fix.feed}`;
                    break;
                    
                case 'addFeed':
                    if (!modifiedLine.match(/F[\d.]+/i)) {
                        modifiedLine += ` F${fix.feed}`;
                    }
                    break;
                    
                case 'setAxis':
                    // Replace axis value
                    const axisRegex = new RegExp(`${fix.axis}[\\d.-]+`, 'gi');
                    if (modifiedLine.match(axisRegex)) {
                        modifiedLine = modifiedLine.replace(axisRegex, `${fix.axis}${fix.value}`);
                    }
                    break;
                    
                case 'removeR':
                    modifiedLine = modifiedLine.replace(/R[\d.-]+/gi, '');
                    break;
            }
        });
        
        // Add the (possibly modified) main line
        lines.push(modifiedLine.trim() + ' ; FIXED');
        
        // Add appended lines
        appends.forEach(fix => {
            lines.push(fix.code);
        });
        
        return lines.join('\n');
    }
    
    // ========================================================================
    // Parsing Helpers
    // ========================================================================
    
    parseLine(line) {
        const result = { raw: line };
        
        // Remove comments
        let code = line.split(';')[0].split('(')[0].trim().toUpperCase();
        
        // Extract G code
        const gMatch = code.match(/G(\d+\.?\d*)/);
        if (gMatch) result.G = parseFloat(gMatch[1]);
        
        // Extract M code
        const mMatch = code.match(/M(\d+)/);
        if (mMatch) result.M = parseInt(mMatch[1]);
        
        // Extract coordinates
        const xMatch = code.match(/X([+-]?\d*\.?\d+)/);
        if (xMatch) result.X = parseFloat(xMatch[1]);
        
        const yMatch = code.match(/Y([+-]?\d*\.?\d+)/);
        if (yMatch) result.Y = parseFloat(yMatch[1]);
        
        const zMatch = code.match(/Z([+-]?\d*\.?\d+)/);
        if (zMatch) result.Z = parseFloat(zMatch[1]);
        
        // Arc parameters
        const iMatch = code.match(/I([+-]?\d*\.?\d+)/);
        if (iMatch) result.I = parseFloat(iMatch[1]);
        
        const jMatch = code.match(/J([+-]?\d*\.?\d+)/);
        if (jMatch) result.J = parseFloat(jMatch[1]);
        
        const rMatch = code.match(/R([+-]?\d*\.?\d+)/);
        if (rMatch) result.R = parseFloat(rMatch[1]);
        
        // Feed rate
        const fMatch = code.match(/F(\d*\.?\d+)/);
        if (fMatch) result.F = parseFloat(fMatch[1]);
        
        // Spindle speed
        const sMatch = code.match(/S(\d+)/);
        if (sMatch) result.S = parseInt(sMatch[1]);
        
        // Tool
        const tMatch = code.match(/T(\d+)/);
        if (tMatch) result.T = parseInt(tMatch[1]);
        
        return result;
    }
    
    reconstructLine(parsed) {
        let parts = [];
        
        if (parsed.G !== undefined) parts.push(`G${parsed.G}`);
        if (parsed.M !== undefined) parts.push(`M${parsed.M}`);
        if (parsed.X !== undefined) parts.push(`X${parsed.X}`);
        if (parsed.Y !== undefined) parts.push(`Y${parsed.Y}`);
        if (parsed.Z !== undefined) parts.push(`Z${parsed.Z}`);
        if (parsed.I !== undefined) parts.push(`I${parsed.I}`);
        if (parsed.J !== undefined) parts.push(`J${parsed.J}`);
        if (parsed.R !== undefined) parts.push(`R${parsed.R}`);
        if (parsed.F !== undefined) parts.push(`F${parsed.F}`);
        if (parsed.S !== undefined) parts.push(`S${parsed.S}`);
        if (parsed.T !== undefined) parts.push(`T${parsed.T}`);
        
        return parts.join(' ');
    }
    
    // ========================================================================
    // State Tracking
    // ========================================================================
    
    updateState(parsed) {
        // Update position
        if (parsed.X !== undefined) this.state.x = parsed.X;
        if (parsed.Y !== undefined) this.state.y = parsed.Y;
        if (parsed.Z !== undefined) this.state.z = parsed.Z;
        
        // Update feed rate
        if (parsed.F !== undefined) this.state.feedRate = parsed.F;
        
        // Track spindle
        if (parsed.M === 3 || parsed.M === 4) {
            this.state.spindleOn = true;
            if (parsed.S) this.state.spindleRPM = parsed.S;
        }
        if (parsed.M === 5) {
            this.state.spindleOn = false;
        }
        
        // Track modes
        if (parsed.G === 90) this.state.absoluteMode = true;
        if (parsed.G === 91) this.state.absoluteMode = false;
        if (parsed.G === 20) this.state.inchMode = true;
        if (parsed.G === 21) this.state.inchMode = false;
        
        // Track tool
        if (parsed.T !== undefined) this.state.currentTool = parsed.T;
        
        // Track safe heights
        if (this.state.z > 0) {
            this.state.lastSafeZ = this.state.z;
        }
    }
    
    resetState() {
        this.state = {
            x: 0, y: 0, z: this.limits.safeZ,
            feedRate: 0,
            spindleOn: false,
            spindleRPM: 0,
            absoluteMode: true,
            inchMode: false,
            currentTool: 0,
            lastRetractZ: this.limits.retractZ,
            inCuttingPass: false,
            lastSafeZ: this.limits.safeZ,
        };
        
        this.stats = {
            linesProcessed: 0,
            fixesApplied: 0,
            warningsIssued: 0,
            blockedCommands: 0,
            fixTypes: {}
        };
    }
    
    // ========================================================================
    // Stock Detection
    // ========================================================================
    
    scanForStock(gcode) {
        // Look for stock definition comments (common CAM formats)
        const lines = gcode.split('\n');
        
        for (const line of lines) {
            // Look for stock comments
            // Fusion 360: (STOCK: X100 Y100 Z25)
            // VCarve: ; Stock: 100x100x25
            const stockMatch = line.match(/stock[:\s]+[xyz]?\s*(\d+)[x,\s]+(\d+)[x,\s]+(\d+)/i);
            if (stockMatch) {
                this.stock.defined = true;
                this.stock.maxX = parseFloat(stockMatch[1]);
                this.stock.maxY = parseFloat(stockMatch[2]);
                this.stock.topZ = 0;
                this.stock.bottomZ = -parseFloat(stockMatch[3]);
                console.log(`[SafetyFixer] Stock detected: ${this.stock.maxX}x${this.stock.maxY}x${-this.stock.bottomZ}`);
            }
            
            // Look for material thickness
            const thicknessMatch = line.match(/thickness[:\s]+(\d+\.?\d*)/i);
            if (thicknessMatch) {
                this.stock.defined = true;
                this.stock.bottomZ = -parseFloat(thicknessMatch[1]);
            }
        }
    }
    
    setStock(minX, maxX, minY, maxY, topZ, bottomZ) {
        this.stock = {
            defined: true,
            minX, maxX, minY, maxY, topZ, bottomZ
        };
        this.saveSettings();
    }
    
    // Reset statistics (called from UI)
    resetStats() {
        this.stats.linesProcessed = 0;
        this.stats.fixesApplied = 0;
        this.stats.warningsIssued = 0;
        this.stats.blockedCommands = 0;
        this.stats.fixTypes = {};
        console.log('[SafetyFixer] Statistics reset');
    }
    
    // ========================================================================
    // TOOL BREAKAGE LEARNING SYSTEM
    // ========================================================================
    
    /**
     * Record a tool breakage incident - called when tool breaks
     * @param {object} context - Information about what was happening when tool broke
     */
    recordToolBreakage(context = {}) {
        const incident = {
            id: Date.now(),
            timestamp: new Date().toISOString(),
            
            // Position where it broke
            position: {
                x: context.x ?? this.state.x,
                y: context.y ?? this.state.y,
                z: context.z ?? this.state.z,
            },
            
            // Cutting parameters at time of break
            feedRate: context.feedRate ?? this.state.feedRate,
            spindleRPM: context.spindleRPM ?? this.state.spindleRPM,
            depthOfCut: context.depthOfCut ?? Math.abs(this.state.z),
            
            // Tool info
            tool: {
                number: context.toolNumber ?? this.state.currentTool,
                diameter: context.toolDiameter ?? null,
                type: context.toolType ?? 'endmill',  // endmill, ballnose, vbit, drill
                flutes: context.flutes ?? 2,
                material: context.toolMaterial ?? 'carbide',
            },
            
            // Material being cut
            material: {
                type: context.materialType ?? 'unknown',
                hardness: context.materialHardness ?? 'medium',  // soft, medium, hard
            },
            
            // What we think caused it
            probableCause: context.cause ?? this.analyzeCause(context),
            
            // The G-code line that was running
            lastGCode: context.lastGCode ?? null,
            
            // Sensor data if available
            sensorData: {
                vibration: context.vibration ?? null,
                spindleCurrent: context.spindleCurrent ?? null,
                motorLoad: context.motorLoad ?? null,
            },
            
            // User notes
            notes: context.notes ?? '',
        };
        
        // Store the incident
        this.toolBreakageDB.incidents.push(incident);
        this.toolBreakageDB.lastBreakage = incident;
        
        // Learn from this incident
        this.learnFromBreakage(incident);
        
        // Save to persistent storage
        this.saveBreakageDB();
        
        console.log('[SafetyFixer] 🔴 Tool breakage recorded:', incident);
        
        // Notify UI
        if (this.onBreakage) {
            this.onBreakage(incident);
        }
        
        return incident;
    }
    
    /**
     * Analyze what probably caused the breakage
     */
    analyzeCause(context) {
        const causes = [];
        
        const feed = context.feedRate ?? this.state.feedRate;
        const rpm = context.spindleRPM ?? this.state.spindleRPM;
        const doc = context.depthOfCut ?? Math.abs(this.state.z);
        
        // Calculate chip load if we have tool info
        if (context.toolDiameter && context.flutes && rpm > 0) {
            const chipLoad = feed / (rpm * (context.flutes || 2));
            if (chipLoad > 0.15) causes.push('excessive_chip_load');
            if (chipLoad < 0.02) causes.push('rubbing_not_cutting');
        }
        
        // Check common issues
        if (feed > 3000) causes.push('feed_too_fast');
        if (rpm < 8000 && feed > 1500) causes.push('low_rpm_high_feed');
        if (doc > 10) causes.push('deep_cut');
        if (doc > 5 && feed > 2000) causes.push('aggressive_doc_and_feed');
        
        // If we have sensor data
        if (context.vibration && context.vibration > 0.8) {
            causes.push('excessive_vibration');
        }
        if (context.spindleCurrent && context.spindleCurrent > 0.9) {
            causes.push('spindle_overload');
        }
        
        return causes.length > 0 ? causes : ['unknown'];
    }
    
    /**
     * Learn patterns from a breakage to prevent future occurrences
     */
    learnFromBreakage(incident) {
        // Create a pattern key based on tool and material combo
        const patternKey = `${incident.tool.type}_${incident.tool.diameter || 'unknown'}_${incident.material.type}`;
        
        if (!this.toolBreakageDB.patterns[patternKey]) {
            this.toolBreakageDB.patterns[patternKey] = {
                maxSafeFeed: Infinity,
                maxSafeDoc: Infinity,
                minSafeRPM: 0,
                incidents: 0,
                lastUpdated: null,
            };
        }
        
        const pattern = this.toolBreakageDB.patterns[patternKey];
        pattern.incidents++;
        pattern.lastUpdated = new Date().toISOString();
        
        // Update safe limits based on what broke the tool
        // Set max safe values to 70% of what broke it (safety margin)
        const safetyFactor = 0.7;
        
        if (incident.feedRate < pattern.maxSafeFeed) {
            pattern.maxSafeFeed = Math.floor(incident.feedRate * safetyFactor);
        }
        
        if (incident.depthOfCut < pattern.maxSafeDoc) {
            pattern.maxSafeDoc = Math.round(incident.depthOfCut * safetyFactor * 10) / 10;
        }
        
        if (incident.spindleRPM > pattern.minSafeRPM) {
            // If RPM was too low, increase minimum
            if (incident.probableCause.includes('low_rpm_high_feed')) {
                pattern.minSafeRPM = Math.ceil(incident.spindleRPM * 1.3);  // 30% higher minimum
            }
        }
        
        console.log(`[SafetyFixer] 📚 Learned pattern for ${patternKey}:`, pattern);
    }
    
    /**
     * Check if current operation matches a known dangerous pattern
     * Returns adjustments needed to stay safe
     */
    checkAgainstLearnedPatterns(toolInfo, materialType, feed, doc, rpm) {
        const patternKey = `${toolInfo.type || 'endmill'}_${toolInfo.diameter || 'unknown'}_${materialType || 'unknown'}`;
        const pattern = this.toolBreakageDB.patterns[patternKey];
        
        if (!pattern) {
            // No learned pattern for this combo, check similar patterns
            return this.checkSimilarPatterns(toolInfo, materialType, feed, doc, rpm);
        }
        
        const adjustments = {
            needed: false,
            feedAdjust: null,
            docAdjust: null,
            rpmAdjust: null,
            warnings: [],
            reason: null,
        };
        
        // Check against learned safe limits
        if (feed > pattern.maxSafeFeed) {
            adjustments.needed = true;
            adjustments.feedAdjust = pattern.maxSafeFeed;
            adjustments.warnings.push(`Feed reduced from ${feed} to ${pattern.maxSafeFeed} (learned from breakage)`);
            adjustments.reason = `Tool broke at F${Math.floor(feed / 0.7)} before - limiting to safe value`;
        }
        
        if (doc > pattern.maxSafeDoc) {
            adjustments.needed = true;
            adjustments.docAdjust = pattern.maxSafeDoc;
            adjustments.warnings.push(`DOC limited to ${pattern.maxSafeDoc}mm (learned from breakage)`);
        }
        
        if (rpm < pattern.minSafeRPM) {
            adjustments.needed = true;
            adjustments.rpmAdjust = pattern.minSafeRPM;
            adjustments.warnings.push(`RPM increased to ${pattern.minSafeRPM} (too low caused breakage before)`);
        }
        
        if (adjustments.needed) {
            adjustments.patternKey = patternKey;
            adjustments.incidentCount = pattern.incidents;
            console.log(`[SafetyFixer] ⚠️ Matched dangerous pattern ${patternKey}, applying adjustments:`, adjustments);
        }
        
        return adjustments;
    }
    
    /**
     * Check similar patterns when exact match not found
     */
    checkSimilarPatterns(toolInfo, materialType, feed, doc, rpm) {
        const adjustments = { needed: false, warnings: [] };
        
        // Look for patterns with same tool type but different material
        const toolPatterns = Object.entries(this.toolBreakageDB.patterns)
            .filter(([key]) => key.startsWith(toolInfo.type || 'endmill'));
        
        if (toolPatterns.length > 0) {
            // Find the most conservative limits from similar tools
            let mostConservativeFeed = Infinity;
            let mostConservativeDoc = Infinity;
            
            for (const [key, pattern] of toolPatterns) {
                if (pattern.maxSafeFeed < mostConservativeFeed) {
                    mostConservativeFeed = pattern.maxSafeFeed;
                }
                if (pattern.maxSafeDoc < mostConservativeDoc) {
                    mostConservativeDoc = pattern.maxSafeDoc;
                }
            }
            
            // Apply a less aggressive factor since it's not an exact match
            const similarFactor = 1.2;  // Allow 20% more than known broken values
            
            if (feed > mostConservativeFeed * similarFactor && mostConservativeFeed < Infinity) {
                adjustments.needed = true;
                adjustments.feedAdjust = Math.floor(mostConservativeFeed * similarFactor);
                adjustments.warnings.push(`Feed limited based on similar tool breakage patterns`);
            }
        }
        
        return adjustments;
    }
    
    /**
     * Apply learned lessons to a G-code command
     * Returns modified command if needed
     */
    applyLearnedProtection(line, parsed) {
        // Only apply to cutting moves
        if (!parsed.hasZ || parsed.z >= 0) return null;
        if (!parsed.hasF) return null;
        
        const toolInfo = {
            type: this.currentToolType || 'endmill',
            diameter: this.currentToolDiameter || null,
        };
        
        const adjustments = this.checkAgainstLearnedPatterns(
            toolInfo,
            this.currentMaterial || 'unknown',
            parsed.f || this.state.feedRate,
            Math.abs(parsed.z),
            this.state.spindleRPM
        );
        
        if (!adjustments.needed) return null;
        
        // Build fixed command
        let fixedLine = line;
        
        if (adjustments.feedAdjust) {
            // Replace or add feed rate
            if (parsed.hasF) {
                fixedLine = fixedLine.replace(/F[\d.]+/i, `F${adjustments.feedAdjust}`);
            } else {
                fixedLine += ` F${adjustments.feedAdjust}`;
            }
        }
        
        return {
            fixed: true,
            fixedCommand: fixedLine,
            reason: adjustments.reason || 'Adjusted based on learned breakage patterns',
            warnings: adjustments.warnings,
            patternMatch: adjustments.patternKey,
        };
    }
    
    /**
     * Report a tool breakage from the UI or chatter sensor
     */
    reportBreakage(details = {}) {
        // Called when user clicks "Tool Broke!" button or sensor detects it
        return this.recordToolBreakage({
            ...details,
            x: this.state.x,
            y: this.state.y,
            z: this.state.z,
            feedRate: this.state.feedRate,
            spindleRPM: this.state.spindleRPM,
            toolNumber: this.state.currentTool,
        });
    }
    
    /**
     * Set current tool info for learning
     */
    setCurrentTool(toolInfo) {
        this.currentToolType = toolInfo.type;
        this.currentToolDiameter = toolInfo.diameter;
        this.currentToolFlutes = toolInfo.flutes;
        this.state.currentTool = toolInfo.number || this.state.currentTool;
    }
    
    /**
     * Set current material for learning
     */
    setCurrentMaterial(materialType, hardness = 'medium') {
        this.currentMaterial = materialType;
        this.currentMaterialHardness = hardness;
    }
    
    /**
     * Get breakage statistics
     */
    getBreakageStats() {
        const db = this.toolBreakageDB;
        return {
            totalIncidents: db.incidents.length,
            patternsLearned: Object.keys(db.patterns).length,
            lastBreakage: db.lastBreakage,
            patternSummary: Object.entries(db.patterns).map(([key, p]) => ({
                pattern: key,
                incidents: p.incidents,
                maxSafeFeed: p.maxSafeFeed === Infinity ? 'unlimited' : p.maxSafeFeed,
                maxSafeDoc: p.maxSafeDoc === Infinity ? 'unlimited' : `${p.maxSafeDoc}mm`,
            })),
        };
    }
    
    /**
     * Clear all learned breakage data (use carefully!)
     */
    clearBreakageData() {
        this.toolBreakageDB = {
            incidents: [],
            patterns: {},
            lastBreakage: null,
        };
        this.saveBreakageDB();
        console.log('[SafetyFixer] Breakage learning data cleared');
    }
    
    // ========================================================================
    // Breakage DB Persistence
    // ========================================================================
    
    saveBreakageDB() {
        try {
            localStorage.setItem('gcodeSafetyFixer_breakages', JSON.stringify(this.toolBreakageDB));
        } catch (e) {
            console.error('[SafetyFixer] Failed to save breakage DB:', e);
        }
    }
    
    loadBreakageDB() {
        try {
            const saved = localStorage.getItem('gcodeSafetyFixer_breakages');
            if (saved) {
                const data = JSON.parse(saved);
                this.toolBreakageDB = {
                    incidents: data.incidents || [],
                    patterns: data.patterns || {},
                    lastBreakage: data.lastBreakage || null,
                };
                console.log(`[SafetyFixer] Loaded ${this.toolBreakageDB.incidents.length} breakage incidents, ${Object.keys(this.toolBreakageDB.patterns).length} learned patterns`);
            }
        } catch (e) {
            console.error('[SafetyFixer] Failed to load breakage DB:', e);
        }
    }
    
    // ========================================================================
    // Persistence
    // ========================================================================
    
    saveSettings() {
        try {
            localStorage.setItem('gcodeSafetyFixer', JSON.stringify({
                limits: this.limits,
                stock: this.stock,
                enabled: this.enabled,
                autoFix: this.autoFix
            }));
        } catch (e) { }
    }
    
    loadSettings() {
        try {
            const saved = localStorage.getItem('gcodeSafetyFixer');
            if (saved) {
                const data = JSON.parse(saved);
                Object.assign(this.limits, data.limits || {});
                Object.assign(this.stock, data.stock || {});
                this.enabled = data.enabled !== false;
                this.autoFix = data.autoFix !== false;
            }
        } catch (e) { }
    }
    
    // ========================================================================
    // Real-time Integration
    // ========================================================================
    
    /**
     * Hook into serial sender to intercept commands
     */
    hookIntoSerial(serialManager) {
        const originalSend = serialManager.send.bind(serialManager);
        
        serialManager.send = (cmd) => {
            const result = this.process(cmd);
            
            if (result.blocked) {
                console.warn('[SafetyFixer] BLOCKED:', cmd);
                this.onBlock(result);
                return false;
            }
            
            if (result.fixes.length > 0) {
                console.log('[SafetyFixer] Fixed:', cmd, '→', result.fixed);
                // Send fixed version instead
                originalSend(result.fixed);
                return true;
            }
            
            // No changes needed
            return originalSend(cmd);
        };
        
        console.log('[SafetyFixer] Hooked into serial sender');
    }
    
    // ========================================================================
    // UI Integration
    // ========================================================================
    
    showSettingsModal() {
        document.getElementById('safety-fixer-modal')?.remove();
        
        const modal = document.createElement('div');
        modal.id = 'safety-fixer-modal';
        modal.innerHTML = `
            <style>
                #safety-fixer-modal {
                    position: fixed;
                    inset: 0;
                    background: rgba(0,0,0,0.85);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    z-index: 10000;
                    font-family: 'Inter', sans-serif;
                }
                .sf-modal {
                    background: linear-gradient(135deg, #1a1a2e, #16213e);
                    border-radius: 16px;
                    padding: 24px;
                    max-width: 500px;
                    width: 90%;
                    max-height: 80vh;
                    overflow-y: auto;
                    border: 1px solid rgba(0,170,255,0.3);
                }
                .sf-modal h2 { margin: 0 0 20px; color: #fff; }
                .sf-row {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    margin: 12px 0;
                    padding: 8px;
                    background: rgba(255,255,255,0.05);
                    border-radius: 8px;
                }
                .sf-row label { color: #aaa; }
                .sf-row input {
                    background: rgba(0,0,0,0.3);
                    border: 1px solid rgba(255,255,255,0.2);
                    border-radius: 4px;
                    padding: 6px 10px;
                    color: #fff;
                    width: 100px;
                    text-align: right;
                }
                .sf-toggle {
                    display: flex;
                    align-items: center;
                    gap: 10px;
                }
                .sf-toggle input[type="checkbox"] {
                    width: 40px;
                    height: 22px;
                    accent-color: #00aaff;
                }
                .sf-section { color: #00aaff; margin: 16px 0 8px; font-weight: 600; }
                .sf-buttons {
                    display: flex;
                    gap: 12px;
                    margin-top: 20px;
                }
                .sf-btn {
                    flex: 1;
                    padding: 12px;
                    border: none;
                    border-radius: 8px;
                    font-weight: 600;
                    cursor: pointer;
                }
                .sf-btn-primary { background: #00aaff; color: #000; }
                .sf-btn-secondary { background: rgba(255,255,255,0.1); color: #fff; }
                .sf-stats {
                    background: rgba(0,255,136,0.1);
                    border-radius: 8px;
                    padding: 12px;
                    margin-top: 16px;
                }
                .sf-stats h3 { margin: 0 0 8px; color: #00ff88; }
            </style>
            <div class="sf-modal">
                <h2>🛡️ G-Code Safety Fixer</h2>
                
                <div class="sf-toggle sf-row">
                    <label>Enable Safety Fixer</label>
                    <input type="checkbox" id="sf-enabled" ${this.enabled ? 'checked' : ''}>
                </div>
                <div class="sf-toggle sf-row">
                    <label>Auto-Fix Errors</label>
                    <input type="checkbox" id="sf-autofix" ${this.autoFix ? 'checked' : ''}>
                </div>
                
                <div class="sf-section">Machine Limits</div>
                <div class="sf-row"><label>Max X</label><input type="number" id="sf-maxX" value="${this.limits.maxX}"></div>
                <div class="sf-row"><label>Max Y</label><input type="number" id="sf-maxY" value="${this.limits.maxY}"></div>
                <div class="sf-row"><label>Max Z</label><input type="number" id="sf-maxZ" value="${this.limits.maxZ}"></div>
                <div class="sf-row"><label>Min Z (cut depth)</label><input type="number" id="sf-minZ" value="${this.limits.minZ}"></div>
                
                <div class="sf-section">Safety Heights</div>
                <div class="sf-row"><label>Safe Z</label><input type="number" id="sf-safeZ" value="${this.limits.safeZ}"></div>
                <div class="sf-row"><label>Retract Z</label><input type="number" id="sf-retractZ" value="${this.limits.retractZ}"></div>
                <div class="sf-row"><label>Max Rapid Z</label><input type="number" id="sf-maxRapidZ" value="${this.limits.maxRapidZ}"></div>
                
                <div class="sf-section">Feed Limits</div>
                <div class="sf-row"><label>Max XY Feed</label><input type="number" id="sf-maxFeedXY" value="${this.limits.maxFeedXY}"></div>
                <div class="sf-row"><label>Max Z Feed</label><input type="number" id="sf-maxFeedZ" value="${this.limits.maxFeedZ}"></div>
                <div class="sf-row"><label>Default Feed</label><input type="number" id="sf-defaultFeed" value="${this.limits.defaultFeed}"></div>
                
                <div class="sf-stats">
                    <h3>📊 Statistics</h3>
                    <div>Lines Processed: ${this.stats.linesProcessed}</div>
                    <div>Fixes Applied: ${this.stats.fixesApplied}</div>
                    <div>Commands Blocked: ${this.stats.blockedCommands}</div>
                    <div>Fix Types: ${Object.entries(this.stats.fixTypes).map(([k,v]) => `${k}: ${v}`).join(', ') || 'None'}</div>
                </div>
                
                <div class="sf-buttons">
                    <button class="sf-btn sf-btn-secondary" onclick="this.closest('#safety-fixer-modal').remove()">Cancel</button>
                    <button class="sf-btn sf-btn-primary" onclick="window.gcodeSafetyFixer?.saveFromModal()">💾 Save</button>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
    }
    
    saveFromModal() {
        this.enabled = document.getElementById('sf-enabled')?.checked ?? true;
        this.autoFix = document.getElementById('sf-autofix')?.checked ?? true;
        this.limits.maxX = parseFloat(document.getElementById('sf-maxX')?.value) || 350;
        this.limits.maxY = parseFloat(document.getElementById('sf-maxY')?.value) || 500;
        this.limits.maxZ = parseFloat(document.getElementById('sf-maxZ')?.value) || 120;
        this.limits.minZ = parseFloat(document.getElementById('sf-minZ')?.value) || -50;
        this.limits.safeZ = parseFloat(document.getElementById('sf-safeZ')?.value) || 5;
        this.limits.retractZ = parseFloat(document.getElementById('sf-retractZ')?.value) || 25;
        this.limits.maxRapidZ = parseFloat(document.getElementById('sf-maxRapidZ')?.value) || 2;
        this.limits.maxFeedXY = parseFloat(document.getElementById('sf-maxFeedXY')?.value) || 5000;
        this.limits.maxFeedZ = parseFloat(document.getElementById('sf-maxFeedZ')?.value) || 1000;
        this.limits.defaultFeed = parseFloat(document.getElementById('sf-defaultFeed')?.value) || 1000;
        
        this.saveSettings();
        document.getElementById('safety-fixer-modal')?.remove();
        
        console.log('[SafetyFixer] Settings saved');
    }
}

// Make globally available
window.GCodeSafetyFixer = GCodeSafetyFixer;

// Auto-create instance
if (typeof window !== 'undefined') {
    window.gcodeSafetyFixer = new GCodeSafetyFixer({
        maxX: 350,
        maxY: 500,
        maxZ: 120,
        onFix: (result) => {
            console.log('🛡️ Auto-fixed:', result.fixes.map(f => f.type).join(', '));
            // Show notification
            if (window.app?.notify) {
                window.app.notify(`Fixed: ${result.fixes.map(f => f.type).join(', ')}`, 'warning');
            }
        },
        onBlock: (result) => {
            console.error('🛑 Blocked dangerous command:', result.original);
            if (window.app?.notify) {
                window.app.notify(`BLOCKED: ${result.warnings[0]}`, 'error');
            }
        }
    });
    
    console.log('✓ G-Code Safety Fixer loaded');
}
