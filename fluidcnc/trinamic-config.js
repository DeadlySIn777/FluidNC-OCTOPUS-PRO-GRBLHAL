/* ========================================
   FluidCNC - Trinamic Driver Configuration
   
   Features:
   - Configure TMC2209/2208 via grblHAL extended commands
   - Live motor current adjustment
   - StallGuard tuning for sensorless homing
   - StealthChop/SpreadCycle mode switching
   - Driver diagnostics display
   ======================================== */

class TrinamicConfig {
    constructor(options = {}) {
        this.grbl = options.grbl || null;
        this.container = options.container || null;
        this.onStatus = options.onStatus || ((msg) => console.log('[TMC]', msg));
        this.onError = options.onError || ((err) => console.error('[TMC]', err));
        
        // Driver configuration (from $-settings or detection)
        this.drivers = {
            x: { type: 'TMC2209', current: 800, microsteps: 16, stallGuard: 50, stealthChop: true },
            y: { type: 'TMC2209', current: 800, microsteps: 16, stallGuard: 50, stealthChop: true },
            z: { type: 'TMC2208', current: 800, microsteps: 16, stallGuard: null, stealthChop: true },
            a: null
        };
        
        // grblHAL extended settings map for Trinamic
        this.settingsMap = {
            x: { current: 340, microsteps: 345, stallGuard: 338, stealthChop: 350 },
            y: { current: 341, microsteps: 346, stallGuard: 339, stealthChop: 351 },
            z: { current: 342, microsteps: 347, stallGuard: null, stealthChop: 352 }, // No SG for 2208
            a: { current: 343, microsteps: 348, stallGuard: 340, stealthChop: 353 }
        };
        
        this.isOpen = false;
    }
    
    setGrbl(grbl) {
        this.grbl = grbl;
    }
    
    // ================================================================
    // Read Current Settings from grblHAL
    // ================================================================
    
    async loadSettings() {
        if (!this.grbl) {
            this.onError('Not connected');
            return;
        }
        
        this.onStatus('Loading Trinamic settings...');
        
        try {
            // Request extended settings
            const response = await this.grbl.sendAndWait('$$', 5000);
            
            // Parse settings from response
            this.parseSettings(response);
            
            this.onStatus('Trinamic settings loaded');
            this.updateUI();
        } catch (err) {
            this.onError(`Failed to load settings: ${err.message}`);
        }
    }
    
    parseSettings(response) {
        const lines = response.split('\n');
        
        for (const line of lines) {
            const match = line.match(/\$(\d+)=(\d+(?:\.\d+)?)/);
            if (!match) continue;
            
            const setting = parseInt(match[1]);
            const value = parseFloat(match[2]);
            
            // Map settings back to driver config
            for (const [axis, map] of Object.entries(this.settingsMap)) {
                if (!this.drivers[axis]) continue;
                
                if (setting === map.current) {
                    this.drivers[axis].current = value;
                } else if (setting === map.microsteps) {
                    this.drivers[axis].microsteps = value;
                } else if (setting === map.stallGuard && map.stallGuard) {
                    this.drivers[axis].stallGuard = value;
                } else if (setting === map.stealthChop) {
                    this.drivers[axis].stealthChop = value > 0;
                }
            }
        }
    }
    
    // ================================================================
    // Apply Settings to grblHAL
    // ================================================================
    
    async setDriverCurrent(axis, currentMA) {
        axis = axis.toLowerCase();
        if (!this.drivers[axis] || !this.settingsMap[axis]) {
            throw new Error(`Invalid axis: ${axis}`);
        }
        
        const setting = this.settingsMap[axis].current;
        const clamped = Math.max(100, Math.min(3000, currentMA));
        
        await this.grbl.sendAndWait(`$${setting}=${clamped}`);
        this.drivers[axis].current = clamped;
        this.onStatus(`${axis.toUpperCase()} current set to ${clamped}mA`);
        
        this.updateUI();
    }
    
    async setMicrosteps(axis, microsteps) {
        axis = axis.toLowerCase();
        const valid = [1, 2, 4, 8, 16, 32, 64, 128, 256];
        
        if (!valid.includes(microsteps)) {
            throw new Error(`Invalid microsteps: ${microsteps}. Must be power of 2, 1-256.`);
        }
        
        const setting = this.settingsMap[axis].microsteps;
        await this.grbl.sendAndWait(`$${setting}=${microsteps}`);
        this.drivers[axis].microsteps = microsteps;
        this.onStatus(`${axis.toUpperCase()} microsteps set to ${microsteps}`);
        
        // Warn about steps/mm recalculation
        this.onStatus(`⚠️ Remember to recalculate $10${axis === 'x' ? 0 : axis === 'y' ? 1 : 2} (steps/mm)!`);
        
        this.updateUI();
    }
    
    async setStallGuard(axis, threshold) {
        axis = axis.toLowerCase();
        
        if (this.drivers[axis]?.type === 'TMC2208') {
            throw new Error(`${axis.toUpperCase()} uses TMC2208 - no StallGuard support!`);
        }
        
        const setting = this.settingsMap[axis].stallGuard;
        if (!setting) {
            throw new Error(`StallGuard not available for ${axis.toUpperCase()}`);
        }
        
        const clamped = Math.max(-64, Math.min(63, threshold));
        await this.grbl.sendAndWait(`$${setting}=${clamped}`);
        this.drivers[axis].stallGuard = clamped;
        this.onStatus(`${axis.toUpperCase()} StallGuard threshold set to ${clamped}`);
        
        this.updateUI();
    }
    
    async setStealthChop(axis, enabled) {
        axis = axis.toLowerCase();
        const setting = this.settingsMap[axis].stealthChop;
        
        await this.grbl.sendAndWait(`$${setting}=${enabled ? 1 : 0}`);
        this.drivers[axis].stealthChop = enabled;
        this.onStatus(`${axis.toUpperCase()} ${enabled ? 'StealthChop (quiet)' : 'SpreadCycle (powerful)'}`);
        
        this.updateUI();
    }
    
    // ================================================================
    // StallGuard Tuning Wizard
    // ================================================================
    
    async tuneStallGuard(axis) {
        axis = axis.toLowerCase();
        
        if (this.drivers[axis]?.type === 'TMC2208') {
            this.onError(`${axis.toUpperCase()} is TMC2208 - no StallGuard! Use a physical limit switch.`);
            return;
        }
        
        this.onStatus(`Starting StallGuard tuning for ${axis.toUpperCase()}...`);
        this.onStatus('Move axis to center of travel first!');
        
        // Start with high threshold (less sensitive)
        let threshold = 60;
        await this.setStallGuard(axis, threshold);
        
        // Home slowly
        const homingCmd = `$H${axis.toUpperCase()}`;
        
        this.onStatus(`Testing threshold ${threshold}...`);
        this.onStatus(`Watch the axis - it should stop when hitting the end.`);
        this.onStatus(`If it stops too early: increase threshold`);
        this.onStatus(`If it grinds past the end: decrease threshold`);
        
        // User will need to manually iterate - we just set up the initial value
        return threshold;
    }
    
    // ================================================================
    // Driver Diagnostics
    // ================================================================
    
    async getDiagnostics() {
        if (!this.grbl) return null;
        
        // Request TMC status via grblHAL extended command
        // Note: Actual command depends on grblHAL Trinamic plugin version
        try {
            const response = await this.grbl.sendAndWait('$TMCSTATUS', 3000);
            return this.parseDiagnostics(response);
        } catch {
            // Fallback - some builds don't have $TMCSTATUS
            return null;
        }
    }
    
    parseDiagnostics(response) {
        // Parse TMC diagnostic response
        // Format varies by grblHAL version
        const diag = { x: {}, y: {}, z: {} };
        
        // Example parsing (adjust based on actual grblHAL output)
        const lines = response.split('\n');
        for (const line of lines) {
            // [TMC X: temp=45C load=32% status=OK]
            const match = line.match(/\[TMC\s+([XYZ]):\s*(.+)\]/i);
            if (match) {
                const axis = match[1].toLowerCase();
                const data = match[2];
                
                diag[axis] = {
                    temp: this.extractValue(data, 'temp', '°C'),
                    load: this.extractValue(data, 'load', '%'),
                    status: data.includes('OK') ? 'OK' : 'ERROR',
                    stallGuard: this.extractValue(data, 'sg', '')
                };
            }
        }
        
        return diag;
    }
    
    extractValue(str, key, unit) {
        const regex = new RegExp(`${key}[=:]?\\s*(\\d+)${unit}?`, 'i');
        const match = str.match(regex);
        return match ? parseInt(match[1]) : null;
    }
    
    // ================================================================
    // UI Rendering
    // ================================================================
    
    render(container = this.container) {
        if (!container) return;
        this.container = container;
        
        container.innerHTML = `
            <div class="tmc-config">
                <div class="tmc-header">
                    <h3>🔧 Trinamic Driver Configuration</h3>
                    <button class="btn btn-sm" onclick="app.trinamicConfig.loadSettings()">Refresh</button>
                </div>
                
                <div class="tmc-drivers" id="tmc-drivers">
                    ${this.renderDriverCards()}
                </div>
                
                <div class="tmc-info">
                    <p><strong>TMC2209</strong>: UART + StallGuard (sensorless homing)</p>
                    <p><strong>TMC2208</strong>: UART only (needs physical limit switch)</p>
                </div>
            </div>
        `;
    }
    
    renderDriverCards() {
        let html = '';
        
        for (const [axis, driver] of Object.entries(this.drivers)) {
            if (!driver) continue;
            
            const hasStallGuard = driver.type === 'TMC2209';
            const axisUpper = axis.toUpperCase();
            
            html += `
                <div class="tmc-driver-card" data-axis="${axis}">
                    <div class="tmc-driver-header">
                        <span class="axis-label axis-${axis}">${axisUpper}</span>
                        <span class="driver-type">${driver.type}</span>
                    </div>
                    
                    <div class="tmc-setting">
                        <label>Current (mA)</label>
                        <input type="range" min="100" max="2000" step="50" 
                               value="${driver.current}" 
                               onchange="app.trinamicConfig.setDriverCurrent('${axis}', this.value)">
                        <span class="value">${driver.current}</span>
                    </div>
                    
                    <div class="tmc-setting">
                        <label>Microsteps</label>
                        <select onchange="app.trinamicConfig.setMicrosteps('${axis}', parseInt(this.value))">
                            ${[8, 16, 32, 64, 128, 256].map(m => 
                                `<option value="${m}" ${m === driver.microsteps ? 'selected' : ''}>${m}</option>`
                            ).join('')}
                        </select>
                    </div>
                    
                    ${hasStallGuard ? `
                    <div class="tmc-setting">
                        <label>StallGuard</label>
                        <input type="range" min="-64" max="63" step="1"
                               value="${driver.stallGuard || 0}"
                               onchange="app.trinamicConfig.setStallGuard('${axis}', parseInt(this.value))">
                        <span class="value">${driver.stallGuard}</span>
                        <button class="btn btn-xs" onclick="app.trinamicConfig.tuneStallGuard('${axis}')">Tune</button>
                    </div>
                    ` : `
                    <div class="tmc-setting disabled">
                        <label>StallGuard</label>
                        <span class="no-support">⚠️ Not available (TMC2208)</span>
                    </div>
                    `}
                    
                    <div class="tmc-setting">
                        <label>Mode</label>
                        <button class="${driver.stealthChop ? 'active' : ''}" 
                                onclick="app.trinamicConfig.setStealthChop('${axis}', true)">
                            🤫 StealthChop
                        </button>
                        <button class="${!driver.stealthChop ? 'active' : ''}"
                                onclick="app.trinamicConfig.setStealthChop('${axis}', false)">
                            💪 SpreadCycle
                        </button>
                    </div>
                </div>
            `;
        }
        
        return html;
    }
    
    updateUI() {
        const container = document.getElementById('tmc-drivers');
        if (container) {
            container.innerHTML = this.renderDriverCards();
        }
    }
    
    open() {
        this.isOpen = true;
        // Create modal or panel
        const modal = document.createElement('div');
        modal.id = 'tmc-modal';
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-content">
                <div class="modal-header">
                    <h2>Trinamic Driver Setup</h2>
                    <button class="close-btn" onclick="app.trinamicConfig.close()">&times;</button>
                </div>
                <div class="modal-body" id="tmc-modal-body"></div>
            </div>
        `;
        document.body.appendChild(modal);
        
        this.render(document.getElementById('tmc-modal-body'));
        this.loadSettings();
    }
    
    close() {
        this.isOpen = false;
        const modal = document.getElementById('tmc-modal');
        if (modal) modal.remove();
    }
}

// Export for use in app.js
if (typeof window !== 'undefined') {
    window.TrinamicConfig = TrinamicConfig;
}
