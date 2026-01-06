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
            lastPosition: { x: 0, y: 0, z: 0 },
            lastWCS: 'G54',
            feedOverride: 100,
            spindleOverride: 100,
            toolNumber: jobData.tool || 0,
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
            safeZ = 20
        } = options;
        
        this.onStatus('Starting job resume...');
        
        try {
            // Re-home if requested
            if (reHome) {
                this.onStatus('Homing machine...');
                await this.grbl.sendAndWait('$H');
                await this.grbl.waitForIdle();
            }
            
            // Set WCS
            this.onStatus(`Setting WCS to ${recovery.lastWCS}...`);
            await this.grbl.sendAndWait(recovery.lastWCS);
            
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
            
            // Get remaining G-code
            const lines = recovery.gcode.split('\n');
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
