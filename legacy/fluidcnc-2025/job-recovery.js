/* ========================================
   FluidCNC - Job Recovery Module
   
   Features:
   - Automatic job state persistence
   - Resume after crash/power loss
   - Progress checkpointing
   - Safe resume with re-homing option
   ======================================== */

class JobRecovery {
    constructor(options = {}) {
        this.grbl = options.grbl || null;
        this.storageKey = 'fluidcnc_job_recovery';
        
        // Callbacks
        this.onStatus = options.onStatus || ((msg) => console.log('[Recovery]', msg));
        this.onRecoveryAvailable = options.onRecoveryAvailable || (() => {});
        
        // State
        this.isTracking = false;
        this.checkpointInterval = null;
        this.checkpointFrequency = 5000; // Save every 5 seconds
        
        // Check for recovery data on init
        this.checkForRecovery();
    }
    
    setGrbl(grbl) {
        this.grbl = grbl;
    }
    
    // ================================================================
    // Job Tracking
    // ================================================================
    
    startTracking(jobData) {
        this.isTracking = true;
        
        const recovery = {
            startTime: Date.now(),
            lastUpdate: Date.now(),
            fileName: jobData.fileName || 'Unknown',
            totalLines: jobData.totalLines || 0,
            currentLine: 0,
            gcodeHash: this.hashCode(jobData.gcode || ''),
            gcode: jobData.gcode,
            lastPosition: { x: 0, y: 0, z: 0, a: 0, b: 0, c: 0 },  // SAFETY: Include rotary axes
            lastWCS: 'G54',
            feedOverride: 100,
            spindleOverride: 100,
            toolNumber: jobData.tool || 0,
            // CRITICAL SAFETY: Track spindle and coolant state for proper resume
            spindleSpeed: 0,
            spindleDirection: 'M5',  // M3=CW, M4=CCW, M5=off
            coolantState: 'M9',      // M7=mist, M8=flood, M9=off
            plungeRate: 100,         // Safe plunge rate for Z moves on resume
            // CRITICAL SAFETY: Track modal states
            modalState: {
                distanceMode: 'G90',    // G90=absolute, G91=incremental
                units: 'G21',           // G20=inch, G21=mm
                plane: 'G17',           // G17=XY, G18=XZ, G19=YZ
                feedMode: 'G94',        // G93=inverse time, G94=units per min
                motionMode: 'G0'        // G0/G1/G2/G3
            },
            completed: false
        };
        
        this.saveRecovery(recovery);
        
        // Start periodic checkpoints
        this.checkpointInterval = setInterval(() => {
            this.checkpoint();
        }, this.checkpointFrequency);
        
        this.onStatus(`Job tracking started: ${recovery.fileName}`);
    }
    
    updateProgress(lineNumber, position) {
        if (!this.isTracking) return;
        
        const recovery = this.loadRecovery();
        if (!recovery) return;
        
        recovery.currentLine = lineNumber;
        recovery.lastUpdate = Date.now();
        
        if (position) {
            recovery.lastPosition = { ...position };
        }
        
        // Get current state from grbl if available
        if (this.grbl?.state) {
            recovery.lastWCS = this.grbl.state.wcs || 'G54';
            recovery.feedOverride = this.grbl.state.override?.feed || 100;
            recovery.spindleOverride = this.grbl.state.override?.spindle || 100;
            recovery.toolNumber = this.grbl.state.tool || 0;
            
            // CRITICAL: Track spindle state for resume
            if (this.grbl.state.spindle > 0) {
                recovery.spindleSpeed = this.grbl.state.spindle;
                recovery.spindleDirection = this.grbl.state.spindleDir === 'CCW' ? 'M4' : 'M3';
            } else {
                recovery.spindleSpeed = 0;
                recovery.spindleDirection = 'M5';
            }
            
            // Track coolant state
            const coolant = this.grbl.state.coolant;
            if (coolant?.flood) {
                recovery.coolantState = 'M8';
            } else if (coolant?.mist) {
                recovery.coolantState = 'M7';
            } else {
                recovery.coolantState = 'M9';
            }
            
            // Track modal states if parser state available
            // grblHAL returns parser state in $G response
            if (this.grbl.state.parserState) {
                const parser = this.grbl.state.parserState;
                if (parser.includes('G90')) recovery.modalState.distanceMode = 'G90';
                if (parser.includes('G91')) recovery.modalState.distanceMode = 'G91';
                if (parser.includes('G20')) recovery.modalState.units = 'G20';
                if (parser.includes('G21')) recovery.modalState.units = 'G21';
                if (parser.includes('G17')) recovery.modalState.plane = 'G17';
                if (parser.includes('G18')) recovery.modalState.plane = 'G18';
                if (parser.includes('G19')) recovery.modalState.plane = 'G19';
            }
        }
        
        this.saveRecovery(recovery);
    }
    
    checkpoint() {
        if (!this.isTracking || !this.grbl) return;
        
        const state = this.grbl.state;
        if (!state) return;
        
        this.updateProgress(
            this.grbl.currentLine || 0,
            state.wpos || state.mpos
        );
    }
    
    completeJob() {
        this.isTracking = false;
        
        if (this.checkpointInterval) {
            clearInterval(this.checkpointInterval);
            this.checkpointInterval = null;
        }
        
        const recovery = this.loadRecovery();
        if (recovery) {
            recovery.completed = true;
            recovery.completedTime = Date.now();
            this.saveRecovery(recovery);
        }
        
        // Clear recovery data after successful completion
        this.clearRecovery();
        this.onStatus('Job completed successfully - recovery data cleared');
    }
    
    stopTracking() {
        this.isTracking = false;
        
        if (this.checkpointInterval) {
            clearInterval(this.checkpointInterval);
            this.checkpointInterval = null;
        }
    }
    
    // ================================================================
    // Recovery Detection
    // ================================================================
    
    checkForRecovery() {
        const recovery = this.loadRecovery();
        
        if (recovery && !recovery.completed) {
            const elapsed = Date.now() - recovery.lastUpdate;
            const elapsedMins = Math.floor(elapsed / 60000);
            
            this.onStatus(`Found incomplete job: ${recovery.fileName}`);
            this.onStatus(`Last update: ${elapsedMins} minutes ago at line ${recovery.currentLine}`);
            
            this.onRecoveryAvailable(recovery);
            return recovery;
        }
        
        return null;
    }
    
    hasRecoveryData() {
        const recovery = this.loadRecovery();
        return recovery && !recovery.completed;
    }
    
    getRecoveryInfo() {
        const recovery = this.loadRecovery();
        if (!recovery || recovery.completed) return null;
        
        return {
            fileName: recovery.fileName,
            progress: recovery.totalLines > 0 
                ? ((recovery.currentLine / recovery.totalLines) * 100).toFixed(1) + '%'
                : 'Unknown',
            currentLine: recovery.currentLine,
            totalLines: recovery.totalLines,
            lastPosition: recovery.lastPosition,
            lastUpdate: new Date(recovery.lastUpdate).toLocaleString(),
            elapsedSinceUpdate: this.formatElapsed(Date.now() - recovery.lastUpdate)
        };
    }
    
    // ================================================================
    // Job Resume
    // ================================================================
    
    async resume(options = {}) {
        const recovery = this.loadRecovery();
        
        if (!recovery || recovery.completed) {
            throw new Error('No job to resume');
        }
        
        if (!this.grbl) {
            throw new Error('Not connected to machine');
        }
        
        const {
            reHome = false,
            reProbe = false,
            startLine = recovery.currentLine,
            safeZ = 20,
            positionTolerance = 0.5,  // mm tolerance for position verification
            skipPositionCheck = false  // DANGER: Only set true if you know what you're doing
        } = options;
        
        this.onStatus('Starting job resume...');
        
        try {
            // Re-home if requested
            if (reHome) {
                this.onStatus('Homing machine...');
                await this.grbl.sendAndWait('$H');
                await this.grbl.waitForIdle();
            }
            
            // CRITICAL SAFETY: Verify machine position before resume
            if (!skipPositionCheck && !reHome) {
                await this.grbl.sendAndWait('?');  // Force status update
                await new Promise(r => setTimeout(r, 100));  // Wait for status parse
                
                const currentPos = this.grbl.state?.mpos || this.grbl.state?.wpos;
                const expectedPos = recovery.lastPosition;
                
                if (currentPos && expectedPos) {
                    const xDiff = Math.abs((currentPos.x || 0) - (expectedPos.x || 0));
                    const yDiff = Math.abs((currentPos.y || 0) - (expectedPos.y || 0));
                    const zDiff = Math.abs((currentPos.z || 0) - (expectedPos.z || 0));
                    
                    if (xDiff > positionTolerance || yDiff > positionTolerance || zDiff > positionTolerance) {
                        const msg = `POSITION MISMATCH!\n` +
                            `Expected: X${expectedPos.x?.toFixed(2)} Y${expectedPos.y?.toFixed(2)} Z${expectedPos.z?.toFixed(2)}\n` +
                            `Current:  X${currentPos.x?.toFixed(2)} Y${currentPos.y?.toFixed(2)} Z${currentPos.z?.toFixed(2)}\n` +
                            `Difference exceeds ${positionTolerance}mm tolerance.\n\n` +
                            `RE-HOME the machine or use skipPositionCheck option if you're sure.`;
                        this.onStatus(`⚠️ ${msg}`);
                        throw new Error(msg);
                    }
                    this.onStatus(`✓ Position verified within ${positionTolerance}mm tolerance`);
                } else {
                    this.onStatus('⚠️ Could not verify position - proceeding with caution');
                }
            }
            
            // Set WCS
            this.onStatus(`Setting WCS to ${recovery.lastWCS}...`);
            await this.grbl.sendAndWait(recovery.lastWCS);
            
            // CRITICAL SAFETY: Restore modal states BEFORE any motion
            if (recovery.modalState) {
                this.onStatus('Restoring modal states...');
                const modal = recovery.modalState;
                
                // Restore distance mode (G90/G91) - CRITICAL for correct positioning
                if (modal.distanceMode) {
                    await this.grbl.sendAndWait(modal.distanceMode);
                }
                
                // Restore units (G20/G21) - CRITICAL for correct dimensions
                if (modal.units) {
                    await this.grbl.sendAndWait(modal.units);
                }
                
                // Restore plane selection (G17/G18/G19)
                if (modal.plane) {
                    await this.grbl.sendAndWait(modal.plane);
                }
                
                // Restore feed mode (G93/G94)
                if (modal.feedMode) {
                    await this.grbl.sendAndWait(modal.feedMode);
                }
                
                this.onStatus(`✓ Modal states restored: ${modal.distanceMode} ${modal.units} ${modal.plane}`);
            }
            
            // Restore overrides
            if (recovery.feedOverride !== 100) {
                // Would need real-time override commands
            }
            
            // Move to safe Z first
            this.onStatus(`Moving to safe Z (${safeZ}mm)...`);
            await this.grbl.sendAndWait(`G90 G0 Z${safeZ}`);
            await this.grbl.waitForIdle();
            
            // Move to XY position
            const pos = recovery.lastPosition;
            this.onStatus(`Moving to last XY position (${pos.x.toFixed(2)}, ${pos.y.toFixed(2)})...`);
            await this.grbl.sendAndWait(`G0 X${pos.x} Y${pos.y}`);
            await this.grbl.waitForIdle();
            
            // CRITICAL SAFETY: Start spindle BEFORE resuming cuts!
            if (recovery.spindleSpeed && recovery.spindleSpeed > 0) {
                const spindleDir = recovery.spindleDirection || 'M3';
                this.onStatus(`Starting spindle at ${recovery.spindleSpeed} RPM...`);
                await this.grbl.sendAndWait(`${spindleDir} S${recovery.spindleSpeed}`);
                // CRITICAL: Wait for spindle to reach speed before any motion!
                this.onStatus('Waiting for spindle to reach speed (3s dwell)...');
                await this.grbl.sendAndWait('G4 P3');
                await this.grbl.waitForIdle();
            }
            
            // CRITICAL SAFETY: Restore coolant state
            if (recovery.coolantState && recovery.coolantState !== 'M9') {
                this.onStatus(`Restoring coolant (${recovery.coolantState})...`);
                await this.grbl.sendAndWait(recovery.coolantState);
            }
            
            // CRITICAL SAFETY: Move to last Z AFTER spindle is running, with controlled feed
            this.onStatus(`Moving to last Z position (${pos.z.toFixed(2)})...`);
            // Use plunge rate, not rapid, for safety
            const plungeRate = recovery.plungeRate || 100;
            await this.grbl.sendAndWait(`G1 Z${pos.z} F${plungeRate}`);
            await this.grbl.waitForIdle();
            
            // Get remaining G-code - handle both array and string formats
            let lines;
            if (Array.isArray(recovery.gcode)) {
                lines = recovery.gcode;
            } else if (typeof recovery.gcode === 'string') {
                lines = recovery.gcode.split('\n');
            } else {
                throw new Error('Invalid gcode format in recovery data');
            }
            const remainingLines = lines.slice(startLine);
            
            this.onStatus(`Resuming from line ${startLine} of ${recovery.totalLines}...`);
            
            // Re-start tracking
            this.isTracking = true;
            this.checkpointInterval = setInterval(() => {
                this.checkpoint();
            }, this.checkpointFrequency);
            
            return {
                gcode: remainingLines.join('\n'),
                startLine,
                totalLines: recovery.totalLines,
                position: recovery.lastPosition
            };
            
        } catch (err) {
            this.onStatus(`Resume failed: ${err.message}`);
            throw err;
        }
    }
    
    // ================================================================
    // Storage
    // ================================================================
    
    saveRecovery(data) {
        try {
            localStorage.setItem(this.storageKey, JSON.stringify(data));
        } catch (e) {
            console.warn('Failed to save recovery data:', e);
        }
    }
    
    loadRecovery() {
        try {
            const data = localStorage.getItem(this.storageKey);
            return data ? JSON.parse(data) : null;
        } catch (e) {
            console.warn('Failed to load recovery data:', e);
            return null;
        }
    }
    
    clearRecovery() {
        try {
            localStorage.removeItem(this.storageKey);
        } catch (e) {
            console.warn('Failed to clear recovery data:', e);
        }
    }
    
    // ================================================================
    // Utilities
    // ================================================================
    
    hashCode(str) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
        }
        return hash.toString(16);
    }
    
    formatElapsed(ms) {
        const seconds = Math.floor(ms / 1000);
        const mins = Math.floor(seconds / 60);
        const hrs = Math.floor(mins / 60);
        
        if (hrs > 0) {
            return `${hrs}h ${mins % 60}m ago`;
        } else if (mins > 0) {
            return `${mins}m ago`;
        }
        return `${seconds}s ago`;
    }
}

// Export
window.JobRecovery = JobRecovery;
