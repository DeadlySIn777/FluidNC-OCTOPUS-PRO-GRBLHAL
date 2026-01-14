/* ========================================
   FluidCNC - Macros Module
   
   - RapidChange ATC Tool Changer (5 tools)
   - Spindle-actuated tightening/loosening
   - Servo dust cover lid (opens 180°)
   - Surfacing Wizard (proper spiral/zigzag)
   - Custom macro support
   - Safety checks and recovery
   ======================================== */

class ATCController {
    constructor(options = {}) {
        this.grbl = options.grbl || null;
        
        // ============================================================
        // RapidChange ATC Configuration - YOUR MACHINE SPECIFIC
        // ============================================================
        this.config = {
            toolCount: 5,
            toolSpacing: 50.4,  // mm between tool centers (RapidChange standard)
            
            // Tool rack position (machine coordinates) - Tool 1 position
            rackX: -10,         // X position of tool 1 center
            rackY: 350,         // Y position of rack (front of forks)
            
            // Z Heights (all negative, machine coordinates)
            safeZ: -5,              // Safe travel Z (clear of everything)
            approachZ: -40,         // Z height to move into fork position
            engageZ: -47,           // Z where collet nut contacts fork (fast move to here)
            tightenZ: -54,          // Z to push down while tightening (7mm past contact)
            
            // Speeds
            rapidFeed: 6000,        // mm/min for rapid XY moves
            approachFeed: 1000,     // mm/min for approaching fork
            engageFeed: 300,        // mm/min for slow engagement (last 7mm)
            pulloutFeed: 10000,     // mm/min for fast Z pullout after loosening
            tightenRPM: 200,        // Low RPM for tightening/loosening
            
            // Timing
            spindleBrake: 2000,     // ms to wait after spindle stops (before tool change)
            tightenTime: 2500,      // ms to spin CW for tightening
            loosenTime: 3000,       // ms to spin CCW for loosening
            
            // Fork geometry  
            forkDepth: 15,          // mm to move into fork from front (Y direction)
            
            // Servo dust cover lid
            useLid: true,           // Enable servo lid
            lidServoPort: 0,        // Aux port for servo (M280 P0)
            lidOpen: 180,           // Servo angle for open
            lidClosed: 0,           // Servo angle for closed  
            lidMoveTime: 800,       // ms to wait for lid to move
            
            // Dust shoe (separate from lid)
            dustShoeRetract: true,
            dustShoePort: 1,        // Aux port for dust shoe actuator
            
            // Safety
            requireHoming: true,
            verifyPositions: true,
            positionTolerance: 0.5,  // mm
            maxRetries: 2,
            
            // Tool table (loaded from storage)
            tools: {}
        };
        
        Object.assign(this.config, options.config || {});
        
        // State
        this.currentTool = 0;
        this.changing = false;
        this.aborted = false;
        this.lastToolPosition = null;
        this.changeHistory = [];
        
        // Callbacks
        this.onStatus = options.onStatus || ((msg) => console.log('[ATC]', msg));
        this.onError = options.onError || ((err) => console.error('[ATC]', err));
        this.onComplete = options.onComplete || (() => {});
        this.onProgress = options.onProgress || (() => {});
        
        this.loadToolTable();
        this.loadConfig();
    }
    
    setGrbl(grbl) {
        this.grbl = grbl;
    }
    
    // ================================================================
    // Tool Table Management
    // ================================================================
    
    loadToolTable() {
        try {
            const saved = localStorage.getItem('fluidcnc_tools');
            if (saved) {
                this.config.tools = JSON.parse(saved);
            }
        } catch (e) {
            console.warn('Failed to load tool table:', e);
        }
        
        // Initialize default tools if empty
        for (let i = 1; i <= this.config.toolCount; i++) {
            if (!this.config.tools[i]) {
                this.config.tools[i] = {
                    number: i,
                    name: `Tool ${i}`,
                    type: 'endmill',
                    diameter: 6,
                    length: 50,
                    offset: 0,
                    flutes: 2,
                    material: 'carbide'
                };
            }
        }
    }
    
    saveToolTable() {
        try {
            localStorage.setItem('fluidcnc_tools', JSON.stringify(this.config.tools));
        } catch (e) {
            console.warn('Failed to save tool table:', e);
        }
    }
    
    getTool(num) {
        return this.config.tools[num] || null;
    }
    
    setTool(num, data) {
        this.config.tools[num] = { ...this.config.tools[num], ...data, number: num };
        this.saveToolTable();
    }
    
    // ================================================================
    // ATC Tool Change Sequence
    // ================================================================
    
    async changeTool(newTool) {
        if (!this.grbl) {
            throw new Error('Not connected to machine');
        }
        
        if (!this.grbl.isIdle()) {
            throw new Error('Machine must be idle for tool change');
        }
        
        if (newTool < 1 || newTool > this.config.toolCount) {
            throw new Error(`Invalid tool number: ${newTool}. Valid range: 1-${this.config.toolCount}`);
        }
        
        if (newTool === this.currentTool) {
            this.onStatus(`Tool ${newTool} already loaded`);
            return true;
        }
        
        // Pre-flight checks
        await this.performPreFlightChecks();
        
        this.changing = true;
        this.aborted = false;
        
        const startTime = Date.now();
        const previousTool = this.currentTool;
        const cfg = this.config;
        
        try {
            this.onProgress({ step: 'spindle', progress: 5 });
            
            // Stop spindle and wait for it to stop
            this.onStatus('Stopping spindle...');
            await this.grbl.sendAndWait('M5');
            await this.delay(cfg.spindleBrake);
            
            this.onProgress({ step: 'dust-shoe', progress: 10 });
            
            // Retract dust shoe if enabled
            if (cfg.dustShoeRetract) {
                this.onStatus('Retracting dust shoe...');
                await this.grbl.sendAndWait(`M64 P${cfg.dustShoePort}`);
            }
            
            // Move to safe Z (machine coordinates)
            this.onStatus('Moving to safe Z...');
            await this.grbl.sendAndWait(`G53 G0 Z${cfg.safeZ}`);
            await this.grbl.waitForIdle();
            
            this.onProgress({ step: 'lid-open', progress: 15 });
            
            // Open ATC dust cover lid
            if (cfg.useLid) {
                this.onStatus('Opening ATC lid...');
                await this.grbl.sendAndWait(`M280 P${cfg.lidServoPort} S${cfg.lidOpen}`);
                await this.delay(cfg.lidMoveTime);
            }
            
            this.onProgress({ step: 'drop', progress: 25 });
            
            // Put current tool back (if one is loaded)
            if (this.currentTool > 0) {
                await this.dropTool(this.currentTool);
            }
            
            this.onProgress({ step: 'pick', progress: 55 });
            
            // Pick up new tool
            await this.pickTool(newTool);
            
            this.onProgress({ step: 'lid-close', progress: 80 });
            
            // Close ATC dust cover lid
            if (cfg.useLid) {
                this.onStatus('Closing ATC lid...');
                await this.grbl.sendAndWait(`M280 P${cfg.lidServoPort} S${cfg.lidClosed}`);
                await this.delay(cfg.lidMoveTime);
            }
            
            this.onProgress({ step: 'verify', progress: 85 });
            
            // Update current tool
            this.currentTool = newTool;
            await this.grbl.sendAndWait(`T${newTool}`);
            
            this.onProgress({ step: 'cleanup', progress: 90 });
            
            // Lower dust shoe if enabled
            if (cfg.dustShoeRetract) {
                this.onStatus('Lowering dust shoe...');
                await this.grbl.sendAndWait(`M65 P${cfg.dustShoePort}`);
            }
            
            // Log tool change
            const duration = Date.now() - startTime;
            this.changeHistory.push({
                from: previousTool,
                to: newTool,
                timestamp: Date.now(),
                duration,
                success: true
            });
            if (this.changeHistory.length > 100) {
                this.changeHistory.shift();
            }
            
            this.onProgress({ step: 'complete', progress: 100 });
            this.onStatus(`✅ Tool ${newTool} loaded successfully (${(duration / 1000).toFixed(1)}s)`);
            this.onComplete(newTool);
            return true;
            
        } catch (err) {
            // Log failed tool change
            this.changeHistory.push({
                from: previousTool,
                to: newTool,
                timestamp: Date.now(),
                duration: Date.now() - startTime,
                success: false,
                error: err.message
            });
            
            this.onError(err);
            throw err;
        } finally {
            this.changing = false;
        }
    }
    
    async performPreFlightChecks() {
        this.onStatus('Performing pre-flight checks...');
        
        // Check if homing is required and complete
        if (this.config.requireHoming) {
            const state = this.grbl.state;
            if (state.status === 'Alarm') {
                throw new Error('Machine is in ALARM - home first ($H)');
            }
        }
        
        // Verify tool positions are configured
        if (this.config.rackX === 0 && this.config.rackY === 0) {
            throw new Error('Tool rack position not configured - use teachToolPosition()');
        }
        
        // Check we have clearance for XY movement
        const mpos = this.grbl.getMachinePosition ? this.grbl.getMachinePosition() : this.grbl.state.mpos;
        if (mpos.z < this.config.safeZ) {
            this.onStatus('Moving to safe Z for tool change...');
            await this.grbl.sendAndWait(`G53 G0 Z${this.config.safeZ}`);
            await this.grbl.waitForIdle();
        }
        
        this.onStatus('Pre-flight checks passed ✓');
    }
    
    async dropTool(toolNum) {
        if (this.aborted) throw new Error('Tool change aborted');
        
        const toolX = this.getToolX(toolNum);
        const cfg = this.config;
        
        this.onStatus(`Returning tool ${toolNum} to rack...`);
        
        // 1. Move to tool X position at safe Z
        await this.grbl.sendAndWait(`G53 G0 X${toolX}`);
        await this.grbl.waitForIdle();
        
        if (this.aborted) throw new Error('Tool change aborted');
        
        // 2. Move to approach Y position (in front of fork)
        await this.grbl.sendAndWait(`G53 G0 Y${cfg.rackY - cfg.forkDepth}`);
        await this.grbl.waitForIdle();
        
        // 3. Lower to approach Z
        await this.grbl.sendAndWait(`G53 G0 Z${cfg.approachZ}`);
        await this.grbl.waitForIdle();
        
        // 4. Move into fork (Y direction)
        this.onStatus('Moving into fork...');
        await this.grbl.sendAndWait(`G53 G1 Y${cfg.rackY} F${cfg.approachFeed}`);
        await this.grbl.waitForIdle();
        
        if (this.aborted) throw new Error('Tool change aborted');
        
        // 5. Lower to engagement Z (where nut contacts fork)
        this.onStatus('Engaging fork...');
        await this.grbl.sendAndWait(`G53 G1 Z${cfg.engageZ} F${cfg.approachFeed}`);
        await this.grbl.waitForIdle();
        
        // 6. LOOSEN: Slow push down while spinning CCW
        this.onStatus('Loosening collet (CCW)...');
        await this.grbl.sendAndWait(`M4 S${cfg.tightenRPM}`);  // CCW to loosen
        await this.grbl.sendAndWait(`G53 G1 Z${cfg.tightenZ} F${cfg.engageFeed}`);  // Push down slowly
        await this.delay(cfg.loosenTime);  // Keep spinning
        await this.grbl.sendAndWait('M5');  // Stop spindle
        await this.delay(500);  // Brief pause
        
        // 7. FAST pullout - yank the spindle up quickly
        this.onStatus('Releasing tool (fast pullout)...');
        await this.grbl.sendAndWait(`G53 G0 Z${cfg.safeZ}`);  // Rapid up!
        await this.grbl.waitForIdle();
        
        // 8. Move out of fork
        await this.grbl.sendAndWait(`G53 G0 Y${cfg.rackY - cfg.forkDepth}`);
        await this.grbl.waitForIdle();
        
        this.onStatus(`Tool ${toolNum} dropped in rack ✓`);
    }
    
    async pickTool(toolNum) {
        if (this.aborted) throw new Error('Tool change aborted');
        
        const toolX = this.getToolX(toolNum);
        const cfg = this.config;
        
        this.onStatus(`Picking tool ${toolNum} from rack...`);
        
        // 1. Move to tool X position (already at safe Z from dropTool or start)
        await this.grbl.sendAndWait(`G53 G0 X${toolX}`);
        await this.grbl.waitForIdle();
        
        if (this.aborted) throw new Error('Tool change aborted');
        
        // 2. Move to approach Y (in front of fork)
        await this.grbl.sendAndWait(`G53 G0 Y${cfg.rackY - cfg.forkDepth}`);
        await this.grbl.waitForIdle();
        
        // 3. Lower to approach Z  
        await this.grbl.sendAndWait(`G53 G0 Z${cfg.approachZ}`);
        await this.grbl.waitForIdle();
        
        // 4. Move into fork
        this.onStatus('Moving into fork...');
        await this.grbl.sendAndWait(`G53 G1 Y${cfg.rackY} F${cfg.approachFeed}`);
        await this.grbl.waitForIdle();
        
        if (this.aborted) throw new Error('Tool change aborted');
        
        // 5. Lower to tighten Z (push down onto tool)
        this.onStatus('Engaging tool...');
        await this.grbl.sendAndWait(`G53 G1 Z${cfg.tightenZ} F${cfg.engageFeed}`);
        await this.grbl.waitForIdle();
        
        // 6. TIGHTEN: Spin CW while holding down
        this.onStatus('Tightening collet (CW)...');
        await this.grbl.sendAndWait(`M3 S${cfg.tightenRPM}`);  // CW to tighten
        await this.delay(cfg.tightenTime);  // Spin to tighten
        await this.grbl.sendAndWait('M5');  // Stop spindle
        await this.delay(500);  // Brief pause
        
        // 7. Pull up slightly (still in fork, tool should come with)
        await this.grbl.sendAndWait(`G53 G0 Z${cfg.engageZ}`);
        await this.grbl.waitForIdle();
        
        // 8. Pull out of fork with tool
        this.onStatus('Extracting tool from rack...');
        await this.grbl.sendAndWait(`G53 G1 Y${cfg.rackY - cfg.forkDepth} F${cfg.approachFeed}`);
        await this.grbl.waitForIdle();
        
        // 9. Retract to safe Z
        await this.grbl.sendAndWait(`G53 G0 Z${cfg.safeZ}`);
        await this.grbl.waitForIdle();
        
        this.onStatus(`Tool ${toolNum} picked ✓`);
    }
    
    getToolX(toolNum) {
        // Tool 1 is at rackX, each subsequent tool is +toolSpacing
        return this.config.rackX + (toolNum - 1) * this.config.toolSpacing;
    }
    
    abort() {
        this.aborted = true;
        if (this.grbl) {
            this.grbl.jogCancel();
            this.grbl.send('!'); // Feed hold
            this.grbl.send('M5'); // Stop spindle
        }
        this.onStatus('⚠️ Tool change aborted!');
    }
    
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
    
    // ================================================================
    // Manual Controls
    // ================================================================
    
    async openLid() {
        if (!this.grbl) return;
        const cfg = this.config;
        if (cfg.useLid) {
            this.onStatus('Opening ATC lid...');
            await this.grbl.sendAndWait(`M280 P${cfg.lidServoPort} S${cfg.lidOpen}`);
            await this.delay(cfg.lidMoveTime);
            this.onStatus('Lid opened ✓');
        }
    }
    
    async closeLid() {
        if (!this.grbl) return;
        const cfg = this.config;
        if (cfg.useLid) {
            this.onStatus('Closing ATC lid...');
            await this.grbl.sendAndWait(`M280 P${cfg.lidServoPort} S${cfg.lidClosed}`);
            await this.delay(cfg.lidMoveTime);
            this.onStatus('Lid closed ✓');
        }
    }
    
    async manualLoosen() {
        // Manual loosen - spins CCW at low RPM
        if (!this.grbl) return;
        this.onStatus('Manual loosen (CCW)...');
        await this.grbl.sendAndWait(`M4 S${this.config.tightenRPM}`);
        await this.delay(this.config.loosenTime);
        await this.grbl.sendAndWait('M5');
        this.onStatus('Loosen complete ✓');
    }
    
    async manualTighten() {
        // Manual tighten - spins CW at low RPM
        if (!this.grbl) return;
        this.onStatus('Manual tighten (CW)...');
        await this.grbl.sendAndWait(`M3 S${this.config.tightenRPM}`);
        await this.delay(this.config.tightenTime);
        await this.grbl.sendAndWait('M5');
        this.onStatus('Tighten complete ✓');
    }
    
    // ================================================================
    // Dry Run Simulation (for testing without machine)
    // ================================================================
    
    simulateToolChange(fromTool, toTool) {
        const cfg = this.config;
        const steps = [];
        
        steps.push(`=== RapidChange ATC Simulation: T${fromTool} → T${toTool} ===`);
        steps.push('');
        
        // Initial
        steps.push('1. PREPARATION');
        steps.push('   M5                    ; Stop spindle');
        steps.push(`   G4 P${cfg.spindleBrake/1000}               ; Wait ${cfg.spindleBrake}ms for spindle brake`);
        steps.push(`   M64 P${cfg.dustShoePort}                ; Retract dust shoe`);
        steps.push(`   G53 G0 Z${cfg.safeZ}           ; Move to safe Z`);
        
        if (cfg.useLid) {
            steps.push(`   M280 P${cfg.lidServoPort} S${cfg.lidOpen}        ; Open ATC lid (180°)`);
            steps.push(`   G4 P${cfg.lidMoveTime/1000}               ; Wait for lid`);
        }
        steps.push('');
        
        // Drop current tool
        if (fromTool > 0) {
            const dropX = this.getToolX(fromTool);
            steps.push(`2. DROP TOOL ${fromTool} (at X${dropX.toFixed(1)})`);
            steps.push(`   G53 G0 X${dropX.toFixed(1)}          ; Move to tool ${fromTool} X position`);
            steps.push(`   G53 G0 Y${(cfg.rackY - cfg.forkDepth).toFixed(1)}       ; Approach Y (front of fork)`);
            steps.push(`   G53 G0 Z${cfg.approachZ}          ; Lower to approach Z`);
            steps.push(`   G53 G1 Y${cfg.rackY} F${cfg.approachFeed}  ; Move into fork`);
            steps.push(`   G53 G1 Z${cfg.engageZ} F${cfg.approachFeed}  ; Lower to engage nut`);
            steps.push(`   M4 S${cfg.tightenRPM}              ; Spindle CCW (loosen)`);
            steps.push(`   G53 G1 Z${cfg.tightenZ} F${cfg.engageFeed}   ; Push down 7mm while spinning`);
            steps.push(`   G4 P${cfg.loosenTime/1000}               ; Spin for ${cfg.loosenTime}ms`);
            steps.push('   M5                    ; Stop spindle');
            steps.push(`   G53 G0 Z${cfg.safeZ}           ; FAST pullout (yank up)`);
            steps.push(`   G53 G0 Y${(cfg.rackY - cfg.forkDepth).toFixed(1)}       ; Exit fork`);
            steps.push('');
        }
        
        // Pick new tool
        const pickX = this.getToolX(toTool);
        steps.push(`3. PICK TOOL ${toTool} (at X${pickX.toFixed(1)})`);
        steps.push(`   G53 G0 X${pickX.toFixed(1)}          ; Move to tool ${toTool} X position`);
        steps.push(`   G53 G0 Y${(cfg.rackY - cfg.forkDepth).toFixed(1)}       ; Approach Y`);
        steps.push(`   G53 G0 Z${cfg.approachZ}          ; Lower to approach Z`);
        steps.push(`   G53 G1 Y${cfg.rackY} F${cfg.approachFeed}  ; Move into fork`);
        steps.push(`   G53 G1 Z${cfg.tightenZ} F${cfg.engageFeed}   ; Lower onto tool`);
        steps.push(`   M3 S${cfg.tightenRPM}              ; Spindle CW (tighten)`);
        steps.push(`   G4 P${cfg.tightenTime/1000}               ; Spin for ${cfg.tightenTime}ms`);
        steps.push('   M5                    ; Stop spindle');
        steps.push(`   G53 G0 Z${cfg.engageZ}          ; Lift slightly`);
        steps.push(`   G53 G1 Y${(cfg.rackY - cfg.forkDepth).toFixed(1)} F${cfg.approachFeed} ; Pull out with tool`);
        steps.push(`   G53 G0 Z${cfg.safeZ}           ; Retract to safe Z`);
        steps.push('');
        
        // Cleanup
        steps.push('4. CLEANUP');
        if (cfg.useLid) {
            steps.push(`   M280 P${cfg.lidServoPort} S${cfg.lidClosed}          ; Close ATC lid (0°)`);
            steps.push(`   G4 P${cfg.lidMoveTime/1000}               ; Wait for lid`);
        }
        steps.push(`   T${toTool}                    ; Update tool register`);
        steps.push(`   M65 P${cfg.dustShoePort}                ; Lower dust shoe`);
        steps.push('');
        steps.push('=== Tool change complete ===');
        
        return steps.join('\n');
    }
    
    // ================================================================
    // Manual tool position setup
    // ================================================================
    
    async teachToolPosition(toolNum) {
        if (!this.grbl || !this.grbl.isIdle()) {
            throw new Error('Machine must be idle');
        }
        
        // Get current machine position
        const pos = this.grbl.getMachinePosition();
        
        if (toolNum === 1) {
            // Set rack origin from tool 1 position
            this.config.rackX = pos.x;
            this.config.rackY = pos.y;
            this.config.rackZ = pos.z;
            this.onStatus(`Tool rack origin set: X${pos.x.toFixed(3)} Y${pos.y.toFixed(3)} Z${pos.z.toFixed(3)}`);
        } else {
            // Calculate spacing from tool 1
            const spacing = pos.x - this.config.rackX;
            const expectedSpacing = (toolNum - 1) * this.config.toolSpacing;
            
            if (Math.abs(spacing - expectedSpacing) > 1) {
                this.onStatus(`⚠️ Warning: Tool ${toolNum} spacing is ${spacing.toFixed(2)}mm, expected ${expectedSpacing.toFixed(2)}mm`);
            }
        }
        
        this.saveConfig();
    }
    
    saveConfig() {
        try {
            const configToSave = { ...this.config };
            delete configToSave.tools; // Tools saved separately
            localStorage.setItem('fluidcnc_atc_config', JSON.stringify(configToSave));
        } catch (e) {
            console.warn('Failed to save ATC config:', e);
        }
    }
    
    loadConfig() {
        try {
            const saved = localStorage.getItem('fluidcnc_atc_config');
            if (saved) {
                Object.assign(this.config, JSON.parse(saved));
            }
        } catch (e) {
            console.warn('Failed to load ATC config:', e);
        }
    }
    
    // Get statistics about tool changes
    getStats() {
        const history = this.changeHistory;
        if (history.length === 0) {
            return { totalChanges: 0 };
        }
        
        const successful = history.filter(h => h.success);
        const failed = history.filter(h => !h.success);
        const durations = successful.map(h => h.duration);
        
        return {
            totalChanges: history.length,
            successful: successful.length,
            failed: failed.length,
            successRate: ((successful.length / history.length) * 100).toFixed(1) + '%',
            avgDuration: durations.length ? (durations.reduce((a, b) => a + b) / durations.length / 1000).toFixed(1) + 's' : 'N/A',
            minDuration: durations.length ? (Math.min(...durations) / 1000).toFixed(1) + 's' : 'N/A',
            maxDuration: durations.length ? (Math.max(...durations) / 1000).toFixed(1) + 's' : 'N/A'
        };
    }
    
    // Get current status for UI
    getStatus() {
        return {
            currentTool: this.currentTool,
            changing: this.changing,
            toolCount: this.config.toolCount,
            configured: this.config.rackX !== 0 || this.config.rackY !== 0
        };
    }
    
    // Aliases for HTML onclick handlers
    loosen() { return this.manualLoosen(); }
    tighten() { return this.manualTighten(); }
    
    // Simulate a tool change (show gcode without running)
    simulate() {
        const from = this.currentTool;
        const to = from === 1 ? 2 : 1;  // Toggle between T1 and T2 for demo
        const gcode = this.simulateToolChange(from, to);
        
        // Show in a modal
        const modal = document.createElement('div');
        modal.className = 'modal-overlay';
        modal.innerHTML = `
            <div class="modal-content" style="max-width: 500px;">
                <div class="modal-header">
                    <h3>🧪 Simulated Tool Change: T${from} → T${to}</h3>
                    <button class="modal-close" onclick="this.closest('.modal-overlay').remove()">×</button>
                </div>
                <div class="modal-body">
                    <pre style="background: #1a1a1a; padding: 10px; border-radius: 4px; max-height: 300px; overflow-y: auto; font-size: 12px;">${gcode.join('\n')}</pre>
                    <button class="btn btn-primary" onclick="navigator.clipboard.writeText('${gcode.join('\\n').replace(/'/g, "\\'")}');this.textContent='Copied!';">Copy G-code</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        modal.style.display = 'flex';
        modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
    }
    
    // Show configuration modal
    showConfig() {
        const cfg = this.config;
        const modal = document.createElement('div');
        modal.className = 'modal-overlay';
        modal.innerHTML = `
            <div class="modal-content" style="max-width: 500px;">
                <div class="modal-header">
                    <h3>⚙️ ATC Configuration</h3>
                    <button class="modal-close" onclick="this.closest('.modal-overlay').remove()">×</button>
                </div>
                <div class="modal-body">
                    <div class="param-grid" style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
                        <div class="param-group">
                            <label>Rack X (mm):</label>
                            <input type="number" id="atc-rack-x" value="${cfg.rackX}" step="0.01">
                        </div>
                        <div class="param-group">
                            <label>Rack Y (mm):</label>
                            <input type="number" id="atc-rack-y" value="${cfg.rackY}" step="0.01">
                        </div>
                        <div class="param-group">
                            <label>Pocket Spacing (mm):</label>
                            <input type="number" id="atc-spacing" value="${cfg.pocketSpacing}" step="0.1">
                        </div>
                        <div class="param-group">
                            <label>Tool Count:</label>
                            <input type="number" id="atc-count" value="${cfg.toolCount}" min="1" max="20">
                        </div>
                        <div class="param-group">
                            <label>Engage Z (mm):</label>
                            <input type="number" id="atc-engage" value="${cfg.engageZ}" step="0.1">
                        </div>
                        <div class="param-group">
                            <label>Tighten Z (mm):</label>
                            <input type="number" id="atc-tighten" value="${cfg.tightenZ}" step="0.1">
                        </div>
                        <div class="param-group">
                            <label>Safe Z (mm):</label>
                            <input type="number" id="atc-safe" value="${cfg.safeZ}" step="1">
                        </div>
                        <div class="param-group">
                            <label>Clear Z (mm):</label>
                            <input type="number" id="atc-clear" value="${cfg.clearZ}" step="1">
                        </div>
                        <div class="param-group">
                            <label>Tighten RPM:</label>
                            <input type="number" id="atc-rpm" value="${cfg.tightenRPM}" step="10">
                        </div>
                        <div class="param-group">
                            <label>Rapid Feed (mm/min):</label>
                            <input type="number" id="atc-rapid" value="${cfg.rapidFeed}" step="100">
                        </div>
                    </div>
                    <div style="margin-top: 15px; text-align: right;">
                        <button class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove()">Cancel</button>
                        <button class="btn btn-primary" id="atc-save-config">Save</button>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        modal.style.display = 'flex';
        
        const saveBtn = modal.querySelector('#atc-save-config');
        saveBtn.addEventListener('click', () => {
            this.config.rackX = parseFloat(modal.querySelector('#atc-rack-x').value) || 0;
            this.config.rackY = parseFloat(modal.querySelector('#atc-rack-y').value) || 0;
            this.config.pocketSpacing = parseFloat(modal.querySelector('#atc-spacing').value) || 60;
            this.config.toolCount = parseInt(modal.querySelector('#atc-count').value) || 5;
            this.config.engageZ = parseFloat(modal.querySelector('#atc-engage').value) || -47;
            this.config.tightenZ = parseFloat(modal.querySelector('#atc-tighten').value) || -54;
            this.config.safeZ = parseFloat(modal.querySelector('#atc-safe').value) || -5;
            this.config.clearZ = parseFloat(modal.querySelector('#atc-clear').value) || -25;
            this.config.tightenRPM = parseInt(modal.querySelector('#atc-rpm').value) || 200;
            this.config.rapidFeed = parseInt(modal.querySelector('#atc-rapid').value) || 10000;
            this.saveConfig();
            modal.remove();
        });
        
        modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
    }
}


/* ========================================
   Surfacing Wizard
   ======================================== */

class SurfacingWizard {
    constructor(options = {}) {
        this.grbl = options.grbl || null;
        this.container = options.container || document.getElementById('surfacing-container');
        this.modalElement = null;
        
        // Default parameters
        this.params = {
            width: 100,
            height: 100,
            depth: 0.5,
            stepover: 40,   // percentage of tool diameter
            toolDiameter: 25,
            feedRate: 2000,
            spindleSpeed: 18000,
            pattern: 'zigzag', // 'zigzag' or 'spiral'
            startCorner: 'BL', // BL, BR, TL, TR
            safeZ: 5,
            includeFinish: false,
            finishAllowance: 0.2
        };
        
        Object.assign(this.params, options.params || {});
        
        this.gcode = [];
        this.running = false;
        
        this.onStatus = options.onStatus || ((msg) => console.log('[Surfacing]', msg));
        this.onComplete = options.onComplete || (() => {});
        
        if (this.container) {
            this.render();
        }
    }
    
    setGrbl(grbl) {
        this.grbl = grbl;
    }
    
    render() {
        this.container.innerHTML = `
            <div class="surfacing-wizard">
                <h3>🔲 Surfacing Wizard</h3>
                
                <div class="param-grid">
                    <div class="param-group">
                        <label>Width (X) mm:</label>
                        <input type="number" id="surf-width" value="${this.params.width}" min="10" max="500">
                    </div>
                    <div class="param-group">
                        <label>Height (Y) mm:</label>
                        <input type="number" id="surf-height" value="${this.params.height}" min="10" max="500">
                    </div>
                    <div class="param-group">
                        <label>Depth of Cut mm:</label>
                        <input type="number" id="surf-depth" value="${this.params.depth}" min="0.1" max="5" step="0.1">
                    </div>
                    <div class="param-group">
                        <label>Tool Diameter mm:</label>
                        <input type="number" id="surf-tool-dia" value="${this.params.toolDiameter}" min="3" max="100">
                    </div>
                    <div class="param-group">
                        <label>Stepover %:</label>
                        <input type="number" id="surf-stepover" value="${this.params.stepover}" min="10" max="90">
                    </div>
                    <div class="param-group">
                        <label>Feed Rate mm/min:</label>
                        <input type="number" id="surf-feed" value="${this.params.feedRate}" min="100" max="10000">
                    </div>
                    <div class="param-group">
                        <label>Spindle RPM:</label>
                        <input type="number" id="surf-spindle" value="${this.params.spindleSpeed}" min="1000" max="30000">
                    </div>
                    <div class="param-group">
                        <label>Pattern:</label>
                        <select id="surf-pattern">
                            <option value="zigzag" ${this.params.pattern === 'zigzag' ? 'selected' : ''}>Zigzag (Back & Forth)</option>
                            <option value="spiral" ${this.params.pattern === 'spiral' ? 'selected' : ''}>Spiral (Outside-In)</option>
                        </select>
                    </div>
                    <div class="param-group">
                        <label>Start Corner:</label>
                        <select id="surf-start">
                            <option value="BL">Back Left</option>
                            <option value="BR">Back Right</option>
                            <option value="FL">Front Left</option>
                            <option value="FR">Front Right</option>
                        </select>
                    </div>
                </div>
                
                <div class="surfacing-preview" id="surf-preview">
                    <svg viewBox="0 0 220 220" id="surf-svg">
                        <!-- Preview will be rendered here -->
                    </svg>
                </div>
                
                <div class="surfacing-stats" id="surf-stats">
                    Click "Generate" to see stats
                </div>
                
                <div class="surfacing-actions">
                    <button class="btn btn-secondary" id="surf-generate">Generate G-code</button>
                    <button class="btn btn-primary" id="surf-run" disabled>Run Surfacing</button>
                    <button class="btn btn-info" id="surf-copy" disabled>Copy G-code</button>
                </div>
            </div>
        `;
        
        this.bindEvents();
    }
    
    // Show/open the wizard as a modal
    show() { this.open(); }
    
    open() {
        // Remove existing modal if any
        if (this.modalElement) {
            this.modalElement.remove();
        }
        
        // Create modal
        this.modalElement = document.createElement('div');
        this.modalElement.className = 'modal-overlay';
        this.modalElement.innerHTML = `
            <div class="modal-content" style="max-width: 600px; max-height: 90vh; overflow-y: auto;">
                <div class="modal-header">
                    <h3>🔲 Surfacing Wizard</h3>
                    <button class="modal-close" onclick="this.closest('.modal-overlay').remove()">×</button>
                </div>
                <div class="modal-body surfacing-container" id="surfacing-modal-container"></div>
            </div>
        `;
        
        document.body.appendChild(this.modalElement);
        this.modalElement.style.display = 'flex';
        
        // Re-render into the modal
        this.container = document.getElementById('surfacing-modal-container');
        if (this.container) {
            this.renderContent();
        }
        
        // Close on background click
        this.modalElement.addEventListener('click', (e) => {
            if (e.target === this.modalElement) {
                this.close();
            }
        });
    }
    
    close() {
        if (this.modalElement) {
            this.modalElement.remove();
            this.modalElement = null;
        }
    }
    
    renderContent() {
        this.container.innerHTML = `
            <div class="surfacing-wizard">
                <div class="param-grid">
                    <div class="param-group">
                        <label>Width (X) mm:</label>
                        <input type="number" id="surf-width" value="${this.params.width}" min="10" max="500">
                    </div>
                    <div class="param-group">
                        <label>Height (Y) mm:</label>
                        <input type="number" id="surf-height" value="${this.params.height}" min="10" max="500">
                    </div>
                    <div class="param-group">
                        <label>Depth of Cut mm:</label>
                        <input type="number" id="surf-depth" value="${this.params.depth}" min="0.1" max="5" step="0.1">
                    </div>
                    <div class="param-group">
                        <label>Tool Diameter mm:</label>
                        <input type="number" id="surf-tool-dia" value="${this.params.toolDiameter}" min="3" max="100">
                    </div>
                    <div class="param-group">
                        <label>Stepover %:</label>
                        <input type="number" id="surf-stepover" value="${this.params.stepover}" min="10" max="90">
                    </div>
                    <div class="param-group">
                        <label>Feed Rate mm/min:</label>
                        <input type="number" id="surf-feed" value="${this.params.feedRate}" min="100" max="10000">
                    </div>
                    <div class="param-group">
                        <label>Spindle RPM:</label>
                        <input type="number" id="surf-spindle" value="${this.params.spindleSpeed}" min="1000" max="30000">
                    </div>
                    <div class="param-group">
                        <label>Pattern:</label>
                        <select id="surf-pattern">
                            <option value="zigzag" ${this.params.pattern === 'zigzag' ? 'selected' : ''}>Zigzag (Back & Forth)</option>
                            <option value="spiral" ${this.params.pattern === 'spiral' ? 'selected' : ''}>Spiral (Outside-In)</option>
                        </select>
                    </div>
                    <div class="param-group">
                        <label>Start Corner:</label>
                        <select id="surf-start">
                            <option value="BL">Back Left</option>
                            <option value="BR">Back Right</option>
                            <option value="FL">Front Left</option>
                            <option value="FR">Front Right</option>
                        </select>
                    </div>
                </div>
                
                <div class="surfacing-preview" id="surf-preview">
                    <svg viewBox="0 0 220 220" id="surf-svg">
                        <!-- Preview will be rendered here -->
                    </svg>
                </div>
                
                <div class="surfacing-stats" id="surf-stats">
                    Click "Generate" to see stats
                </div>
                
                <div class="surfacing-actions">
                    <button class="btn btn-secondary" id="surf-generate">Generate G-code</button>
                    <button class="btn btn-primary" id="surf-run" disabled>Run Surfacing</button>
                    <button class="btn btn-info" id="surf-copy" disabled>Copy G-code</button>
                </div>
            </div>
        `;
        
        this.bindEvents();
    }
    
    bindEvents() {
        // Parameter changes trigger preview update
        const inputs = ['surf-width', 'surf-height', 'surf-depth', 'surf-tool-dia', 
                       'surf-stepover', 'surf-feed', 'surf-spindle', 'surf-pattern', 'surf-start'];
        
        inputs.forEach(id => {
            document.getElementById(id)?.addEventListener('change', () => this.updatePreview());
        });
        
        document.getElementById('surf-generate')?.addEventListener('click', () => {
            this.generate();
        });
        
        document.getElementById('surf-run')?.addEventListener('click', () => {
            this.run();
        });
        
        document.getElementById('surf-copy')?.addEventListener('click', () => {
            this.copyGcode();
        });
        
        // Initial preview
        this.updatePreview();
    }
    
    readParams() {
        this.params.width = parseFloat(document.getElementById('surf-width')?.value) || 100;
        this.params.height = parseFloat(document.getElementById('surf-height')?.value) || 100;
        this.params.depth = parseFloat(document.getElementById('surf-depth')?.value) || 0.5;
        this.params.toolDiameter = parseFloat(document.getElementById('surf-tool-dia')?.value) || 25;
        this.params.stepover = parseFloat(document.getElementById('surf-stepover')?.value) || 40;
        this.params.feedRate = parseFloat(document.getElementById('surf-feed')?.value) || 2000;
        this.params.spindleSpeed = parseFloat(document.getElementById('surf-spindle')?.value) || 18000;
        this.params.pattern = document.getElementById('surf-pattern')?.value || 'zigzag';
        this.params.startCorner = document.getElementById('surf-start')?.value || 'BL';
    }
    
    updatePreview() {
        this.readParams();
        
        const svg = document.getElementById('surf-svg');
        if (!svg) return;
        
        const scale = 200 / Math.max(this.params.width, this.params.height);
        const w = this.params.width * scale;
        const h = this.params.height * scale;
        const offsetX = (200 - w) / 2 + 10;
        const offsetY = (200 - h) / 2 + 10;
        
        let pathD = '';
        const stepoverMm = this.params.toolDiameter * (this.params.stepover / 100);
        
        if (this.params.pattern === 'zigzag') {
            // Generate zigzag preview
            let y = 0;
            let goingRight = true;
            
            while (y <= this.params.height) {
                const x1 = goingRight ? 0 : this.params.width;
                const x2 = goingRight ? this.params.width : 0;
                
                if (pathD === '') {
                    pathD = `M ${offsetX + x1 * scale} ${offsetY + (this.params.height - y) * scale}`;
                } else {
                    pathD += ` L ${offsetX + x1 * scale} ${offsetY + (this.params.height - y) * scale}`;
                }
                pathD += ` L ${offsetX + x2 * scale} ${offsetY + (this.params.height - y) * scale}`;
                
                y += stepoverMm;
                goingRight = !goingRight;
            }
        } else {
            // Generate spiral preview (outside-in rectangular spiral)
            let left = 0, right = this.params.width;
            let bottom = 0, top = this.params.height;
            let first = true;
            
            while (left < right && bottom < top) {
                // Bottom edge (left to right)
                if (first) {
                    pathD = `M ${offsetX + left * scale} ${offsetY + (this.params.height - bottom) * scale}`;
                    first = false;
                }
                pathD += ` L ${offsetX + right * scale} ${offsetY + (this.params.height - bottom) * scale}`;
                bottom += stepoverMm;
                
                if (bottom >= top) break;
                
                // Right edge (bottom to top)
                pathD += ` L ${offsetX + right * scale} ${offsetY + (this.params.height - top) * scale}`;
                right -= stepoverMm;
                
                if (left >= right) break;
                
                // Top edge (right to left)
                pathD += ` L ${offsetX + left * scale} ${offsetY + (this.params.height - top) * scale}`;
                top -= stepoverMm;
                
                if (bottom >= top) break;
                
                // Left edge (top to bottom)
                pathD += ` L ${offsetX + left * scale} ${offsetY + (this.params.height - bottom) * scale}`;
                left += stepoverMm;
            }
        }
        
        svg.innerHTML = `
            <rect x="${offsetX}" y="${offsetY}" width="${w}" height="${h}" 
                  fill="#444" stroke="#666" stroke-width="2"/>
            <path d="${pathD}" fill="none" stroke="#0af" stroke-width="2" stroke-linecap="round"/>
            <circle cx="${offsetX}" cy="${offsetY + h}" r="5" fill="#0f0"/>
            <text x="${offsetX + w/2}" y="${offsetY + h + 18}" text-anchor="middle" fill="#888" font-size="12">
                ${this.params.width} × ${this.params.height} mm
            </text>
        `;
    }
    
    generate() {
        this.readParams();
        this.gcode = [];
        
        const { width, height, depth, toolDiameter, stepover, feedRate, spindleSpeed, pattern, safeZ } = this.params;
        const stepoverMm = toolDiameter * (stepover / 100);
        const toolRadius = toolDiameter / 2;
        
        // Header
        this.gcode.push('(Surfacing operation)');
        this.gcode.push(`(Width: ${width}mm, Height: ${height}mm, Depth: ${depth}mm)`);
        this.gcode.push(`(Tool: ${toolDiameter}mm, Stepover: ${stepover}%)`);
        this.gcode.push('G90 G21 (Absolute, metric)');
        this.gcode.push(`G0 Z${safeZ} (Safe Z)`);
        this.gcode.push(`S${spindleSpeed} M3 (Spindle on)`);
        this.gcode.push('G4 P2 (Wait 2 sec for spindle)');
        
        // Start position (adjust for tool radius to cover full area)
        const startX = -toolRadius;
        const startY = -toolRadius;
        const endX = width + toolRadius;
        const endY = height + toolRadius;
        
        this.gcode.push(`G0 X${startX.toFixed(3)} Y${startY.toFixed(3)}`);
        this.gcode.push(`G1 Z${-depth} F${Math.round(feedRate / 3)} (Plunge)`);
        
        let totalDistance = 0;
        
        if (pattern === 'zigzag') {
            let y = startY;
            let goingRight = true;
            
            while (y <= endY) {
                const x1 = goingRight ? startX : endX;
                const x2 = goingRight ? endX : startX;
                
                this.gcode.push(`G1 X${x1.toFixed(3)} Y${y.toFixed(3)} F${feedRate}`);
                this.gcode.push(`G1 X${x2.toFixed(3)}`);
                
                totalDistance += Math.abs(x2 - x1);
                
                y += stepoverMm;
                if (y <= endY) {
                    this.gcode.push(`G1 Y${y.toFixed(3)}`);
                    totalDistance += stepoverMm;
                }
                
                goingRight = !goingRight;
            }
        } else {
            // Spiral pattern (rectangular, outside-in)
            let left = startX, right = endX;
            let bottom = startY, top = endY;
            
            this.gcode.push(`G1 X${left.toFixed(3)} Y${bottom.toFixed(3)} F${feedRate}`);
            
            while (left < right - stepoverMm && bottom < top - stepoverMm) {
                // Bottom to right
                this.gcode.push(`G1 X${right.toFixed(3)} Y${bottom.toFixed(3)}`);
                totalDistance += right - left;
                
                // Right to top
                this.gcode.push(`G1 Y${top.toFixed(3)}`);
                totalDistance += top - bottom;
                
                // Top to left
                this.gcode.push(`G1 X${left.toFixed(3)}`);
                totalDistance += right - left;
                
                // Move inward
                left += stepoverMm;
                bottom += stepoverMm;
                right -= stepoverMm;
                top -= stepoverMm;
                
                if (left >= right || bottom >= top) break;
                
                // Left side going down to next loop
                this.gcode.push(`G1 Y${bottom.toFixed(3)}`);
                totalDistance += top - bottom + 2 * stepoverMm;
            }
            
            // Fill remaining center
            if (left < right) {
                this.gcode.push(`G1 X${right.toFixed(3)}`);
            }
        }
        
        // Footer
        this.gcode.push(`G0 Z${safeZ} (Retract)`);
        this.gcode.push('M5 (Spindle off)');
        this.gcode.push('G0 X0 Y0 (Return home)');
        this.gcode.push('M30 (End program)');
        
        // Calculate stats
        const passes = Math.ceil((height + toolDiameter) / stepoverMm);
        const time = totalDistance / feedRate; // minutes
        
        document.getElementById('surf-stats').innerHTML = `
            <strong>Generated:</strong> ${this.gcode.length} lines | 
            <strong>Passes:</strong> ${passes} | 
            <strong>Distance:</strong> ${(totalDistance/1000).toFixed(1)}m |
            <strong>Est. Time:</strong> ${Math.ceil(time)} min
        `;
        
        document.getElementById('surf-run').disabled = false;
        document.getElementById('surf-copy').disabled = false;
        
        this.onStatus(`Generated ${this.gcode.length} lines of G-code`);
    }
    
    async run() {
        if (!this.grbl) {
            this.onStatus('Not connected to machine');
            return;
        }
        
        if (this.gcode.length === 0) {
            this.generate();
        }
        
        this.running = true;
        this.onStatus('Starting surfacing operation...');
        
        try {
            await this.grbl.streamGCode(this.gcode, {
                onProgress: (pct, current, total) => {
                    this.onStatus(`Surfacing: ${pct.toFixed(1)}% (${current}/${total})`);
                },
                onComplete: () => {
                    this.running = false;
                    this.onStatus('✅ Surfacing complete!');
                    this.onComplete();
                },
                onStop: () => {
                    this.running = false;
                    this.onStatus('⏹️ Surfacing stopped');
                }
            });
        } catch (err) {
            this.running = false;
            this.onStatus(`Error: ${err.message}`);
        }
    }
    
    copyGcode() {
        if (this.gcode.length === 0) return;
        
        const text = this.gcode.join('\n');
        navigator.clipboard.writeText(text).then(() => {
            this.onStatus('G-code copied to clipboard!');
        }).catch(err => {
            console.error('Failed to copy:', err);
        });
    }
    
    stop() {
        if (this.running && this.grbl) {
            this.grbl.stopStream();
            this.running = false;
        }
    }
}


/* ========================================
   Custom Macro System
   ======================================== */

class MacroManager {
    constructor(options = {}) {
        this.grbl = options.grbl || null;
        this.macros = {};
        this.onStatus = options.onStatus || console.log;
        
        this.loadMacros();
        this.initBuiltinMacros();
    }
    
    setGrbl(grbl) {
        this.grbl = grbl;
    }
    
    loadMacros() {
        try {
            const saved = localStorage.getItem('fluidcnc_macros');
            if (saved) {
                this.macros = JSON.parse(saved);
            }
        } catch (e) {
            console.warn('Failed to load macros:', e);
        }
    }
    
    saveMacros() {
        try {
            localStorage.setItem('fluidcnc_macros', JSON.stringify(this.macros));
        } catch (e) {
            console.warn('Failed to save macros:', e);
        }
    }
    
    initBuiltinMacros() {
        // Add built-in macros if not already saved
        const builtins = {
            'goto-origin': {
                name: 'Go to Origin',
                icon: '🏠',
                gcode: ['G90', 'G0 Z5', 'G0 X0 Y0', 'G0 Z0']
            },
            'park': {
                name: 'Park Machine',
                icon: '🅿️',
                gcode: ['G90', 'G53 G0 Z-5', 'G53 G0 X0 Y0']
            },
            'spindle-warmup': {
                name: 'Spindle Warmup',
                icon: '🔄',
                gcode: [
                    '(Spindle warmup routine)',
                    'M3 S8000', 'G4 P30',
                    'S12000', 'G4 P30',
                    'S18000', 'G4 P30',
                    'S24000', 'G4 P60',
                    'M5', '(Warmup complete)'
                ]
            },
            'square-check': {
                name: 'Square Check',
                icon: '📐',
                gcode: [
                    '(Square check - 100mm)',
                    'G90 G0 Z5',
                    'G0 X0 Y0',
                    'G0 X100', 'G4 P1',
                    'G0 Y100', 'G4 P1',
                    'G0 X0', 'G4 P1',
                    'G0 Y0'
                ]
            },
            'z-safe': {
                name: 'Safe Z Height',
                icon: '⬆️',
                gcode: ['G91 G0 Z20', 'G90']
            }
        };
        
        for (const [id, macro] of Object.entries(builtins)) {
            if (!this.macros[id]) {
                this.macros[id] = macro;
            }
        }
        
        this.saveMacros();
    }
    
    async run(macroId) {
        const macro = this.macros[macroId];
        if (!macro) {
            throw new Error(`Macro not found: ${macroId}`);
        }
        
        if (!this.grbl) {
            throw new Error('Not connected to machine');
        }
        
        this.onStatus(`Running macro: ${macro.name}`);
        
        for (const line of macro.gcode) {
            if (line.startsWith('(')) continue; // Skip comments
            await this.grbl.sendAndWait(line);
        }
        
        this.onStatus(`✅ Macro complete: ${macro.name}`);
    }
    
    add(id, macro) {
        this.macros[id] = macro;
        this.saveMacros();
    }
    
    remove(id) {
        delete this.macros[id];
        this.saveMacros();
    }
    
    getAll() {
        return { ...this.macros };
    }
}


// Export
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { ATCController, SurfacingWizard, MacroManager };
}
