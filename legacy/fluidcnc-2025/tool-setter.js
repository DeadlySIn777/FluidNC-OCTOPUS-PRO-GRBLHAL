// Tool Setter Integration for FluidCNC
// Electrical continuity based tool setter (grounded spindle + metal setter body)
// 
// Wiring:
// - Spindle body → ground (via motor housing or dedicated wire)
// - Tool setter body → Probe input on Octopus Pro (and ground)
// - When tool touches setter, circuit completes = probe triggered
//
// grblHAL probe input detects this and stops motion

class ToolSetter {
    constructor(app) {
        this.app = app;
        
        // Tool setter configuration
        this.config = {
            // Position of tool setter (bolted to bed)
            x: 0,         // X position in machine coords
            y: 0,         // Y position in machine coords
            z_safe: 50,   // Safe Z height for travel
            z_start: 10,  // Z height to start probing from
            
            // Probing parameters
            feedSlow: 25,       // Slow probe feed (mm/min)
            feedFast: 100,      // Fast probe feed (mm/min)  
            retract: 2,         // Retract after first touch (mm)
            
            // Setter physical dimensions
            setterHeight: 50,   // Height of setter from bed surface
            
            // Tool table
            referenceToolLength: 0,  // Length of reference tool (first calibration)
            
            // Safety
            maxProbeDistance: 60,    // Max distance to probe before error
            requireSpindleOff: true  // Ensure spindle is off before probing
        };
        
        // Tool data stored in localStorage
        this.tools = this.loadTools();
        
        // State
        this.state = {
            calibrated: false,
            lastMeasurement: null,
            probeTriggered: false
        };
        
        this.init();
    }
    
    init() {
        this.loadConfig();
        console.log('🔧 Tool Setter initialized');
    }
    
    loadConfig() {
        try {
            const saved = localStorage.getItem('fluidcnc_toolsetter');
            if (saved) {
                const config = JSON.parse(saved);
                Object.assign(this.config, config);
            }
        } catch (e) {
            console.warn('Tool setter config load failed:', e);
        }
    }
    
    saveConfig() {
        try {
            localStorage.setItem('fluidcnc_toolsetter', JSON.stringify(this.config));
        } catch (e) {
            console.warn('Tool setter config save failed:', e);
        }
    }
    
    loadTools() {
        try {
            const saved = localStorage.getItem('fluidcnc_tools');
            return saved ? JSON.parse(saved) : {};
        } catch (e) {
            return {};
        }
    }
    
    saveTools() {
        try {
            localStorage.setItem('fluidcnc_tools', JSON.stringify(this.tools));
        } catch (e) {
            console.warn('Tool data save failed:', e);
        }
    }
    
    // ================================================================
    // CORE PROBING OPERATIONS
    // ================================================================
    
    /**
     * Measure tool length using the tool setter
     * Returns the measured Z position when probe triggers
     */
    async measureTool(toolNumber = null) {
        // Safety checks
        if (this.config.requireSpindleOff) {
            const state = this.app?.state;
            if (state?.spindle?.running) {
                throw new Error('Spindle must be off before measuring tool!');
            }
        }
        
        // Check machine is idle
        if (this.app?.state?.status !== 'Idle') {
            throw new Error('Machine must be idle to measure tool');
        }
        
        // Check machine is homed (CRITICAL for tool setter at fixed position)
        if (this.app?.state?.status === 'Alarm') {
            throw new Error('Machine is in ALARM state - home first before measuring tools');
        }
        
        this.app?.showNotification?.('Starting tool measurement...', 'info');
        
        // Set up probe timeout protection
        const probeTimeout = this.config.probeTimeout || 30000;
        let timeoutHandle;
        const timeoutPromise = new Promise((_, reject) => {
            timeoutHandle = setTimeout(() => {
                // Emergency stop on timeout
                this.app?.sendCommand?.('!');
                reject(new Error(`Tool measurement timeout after ${probeTimeout/1000}s - check tool setter!`));
            }, probeTimeout);
        });
        
        // Set up limit switch detection
        const limitPromise = this.monitorForLimitSwitch();
        
        try {
            const gcode = this.generateMeasureGCode();
            
            // Race between: successful probe, timeout, or limit switch
            await Promise.race([
                this.app?.runGCodeSequence?.(gcode),
                timeoutPromise,
                limitPromise
            ]);
            
            clearTimeout(timeoutHandle);
            
            // Get the probed Z position from grblHAL
            const probedZ = await this.getProbedPosition();
            
            if (probedZ === null) {
                // Retract to safe Z before throwing
                await this.emergencyRetract();
                throw new Error('Probe did not trigger - check tool setter wiring');
            }
        
        this.state.lastMeasurement = {
            z: probedZ,
            toolNumber,
            timestamp: Date.now()
        };
        
        // Store tool length
        if (toolNumber !== null) {
            this.setToolLength(toolNumber, probedZ);
        }
        
        return probedZ;
        
        } catch (error) {
            clearTimeout(timeoutHandle);
            // Always try to retract to safe Z after any failure
            await this.emergencyRetract();
            throw error;
        }
    }
    
    /**
     * Generate G-code for tool measurement
     */
    generateMeasureGCode() {
        const cfg = this.config;
        
        return [
            '; Tool measurement sequence',
            'G21 G90',                                    // mm, absolute
            'M5',                                         // Spindle off (safety)
            `G53 G0 Z${cfg.z_safe}`,                     // Safe Z (machine coords)
            `G53 G0 X${cfg.x} Y${cfg.y}`,               // Move to setter XY
            `G53 G0 Z${cfg.z_start}`,                   // Lower to probe start
            
            // First probe - fast
            `G38.2 Z-${cfg.maxProbeDistance} F${cfg.feedFast}`,
            `G91 G0 Z${cfg.retract}`,                   // Retract
            
            // Second probe - slow for accuracy
            `G38.2 Z-${cfg.retract + 2} F${cfg.feedSlow}`,
            
            // Store result (grblHAL stores in PRB)
            'G90',
            `G53 G0 Z${cfg.z_safe}`,                    // Retract to safe Z
        ].join('\n');
    }
    
    /**
     * Monitor for limit switch activation during probe - CRITICAL SAFETY
     */
    monitorForLimitSwitch() {
        return new Promise((_, reject) => {
            const checkLimit = () => {
                const state = this.app?.state;
                if (state?.status === 'Alarm') {
                    // Alarm 1 or 2 typically indicates limit switch
                    reject(new Error('LIMIT SWITCH triggered during tool measurement! Machine stopped.'));
                    return;
                }
                if (state?.limitX || state?.limitY || state?.limitZ) {
                    this.app?.sendCommand?.('!'); // Emergency stop
                    reject(new Error('Limit switch active - tool measurement aborted'));
                    return;
                }
                // Keep checking while probing
                if (this.state?.probing) {
                    setTimeout(checkLimit, 50);
                }
            };
            // Start checking after small delay
            setTimeout(checkLimit, 100);
        });
    }
    
    /**
     * Emergency retract to safe Z - used after probe failures
     */
    async emergencyRetract() {
        try {
            // Clear any feed hold state
            this.app?.sendCommand?.('~');
            await new Promise(r => setTimeout(r, 100));
            
            // Retract to safe Z using machine coordinates
            await this.app?.sendCommand?.(`G53 G0 Z${this.config.z_safe}`);
        } catch (e) {
            console.error('Emergency retract failed:', e);
        }
    }
    
    /**
     * Get the probed position from grblHAL
     * Query with [PRB:x,y,z:success] or $# 
     */
    async getProbedPosition() {
        // Send $# to get parameters including probe result
        const response = await this.app?.sendCommandWithResponse?.('$#');
        
        // Parse PRB from response: [PRB:x.xxx,y.yyy,z.zzz:1]
        const match = response?.match(/\[PRB:([0-9.-]+),([0-9.-]+),([0-9.-]+):(\d)/);
        
        if (match && match[4] === '1') {
            return parseFloat(match[3]); // Z value
        }
        
        return null;
    }
    
    // ================================================================
    // TOOL LENGTH MANAGEMENT
    // ================================================================
    
    /**
     * Set tool length offset
     */
    setToolLength(toolNumber, measuredZ) {
        if (!this.tools[toolNumber]) {
            this.tools[toolNumber] = {};
        }
        
        // Calculate offset from reference tool
        const offset = this.config.referenceToolLength - measuredZ;
        
        this.tools[toolNumber] = {
            measuredZ,
            offset,
            measuredAt: Date.now()
        };
        
        this.saveTools();
        
        console.log(`Tool ${toolNumber}: Z=${measuredZ.toFixed(3)}, offset=${offset.toFixed(3)}`);
        
        return offset;
    }
    
    /**
     * Get tool length offset
     */
    getToolOffset(toolNumber) {
        return this.tools[toolNumber]?.offset ?? 0;
    }
    
    /**
     * Apply tool offset (send G43)
     */
    applyToolOffset(toolNumber) {
        const offset = this.getToolOffset(toolNumber);
        
        // grblHAL uses G43.1 for dynamic tool offset
        // or G43 H{tool} if tool table is configured
        this.app?.sendCommand?.(`G43.1 Z${offset.toFixed(4)}`);
        
        return offset;
    }
    
    /**
     * Calibrate reference tool (T1 or first tool)
     * Sets the baseline for all other tool offsets
     */
    async calibrateReference() {
        this.app?.showNotification?.('Calibrating reference tool...', 'info');
        
        const measuredZ = await this.measureTool(0);
        this.config.referenceToolLength = measuredZ;
        this.saveConfig();
        
        this.state.calibrated = true;
        
        this.app?.showNotification?.(
            `Reference tool calibrated at Z=${measuredZ.toFixed(3)}`, 
            'success'
        );
        
        return measuredZ;
    }
    
    // ================================================================
    // AUTOMATIC TOOL CHANGE SUPPORT
    // ================================================================
    
    /**
     * Measure tool and apply offset (for ATC M6 integration)
     */
    async measureAndApply(toolNumber) {
        // Measure the tool
        await this.measureTool(toolNumber);
        
        // Apply the offset
        const offset = this.applyToolOffset(toolNumber);
        
        this.app?.showNotification?.(
            `Tool ${toolNumber} measured, offset ${offset.toFixed(3)}mm applied`,
            'success'
        );
        
        return offset;
    }
    
    /**
     * Generate M6 tool change macro with measurement
     */
    generateToolChangeMacro(toolNumber) {
        const cfg = this.config;
        
        return [
            `; M6 T${toolNumber} - Tool Change with Auto-Measure`,
            'M5',                                         // Spindle off
            `G53 G0 Z${cfg.z_safe}`,                     // Safe Z
            
            // TODO: Add ATC pocket positions here if you have physical ATC
            // `G53 G0 X{pocket_x} Y{pocket_y}`,
            // Unclamp, move Z down, clamp new tool, etc.
            
            '; Measure new tool',
            `G53 G0 X${cfg.x} Y${cfg.y}`,               // Move to setter
            `G53 G0 Z${cfg.z_start}`,                   // Start height
            `G38.2 Z-${cfg.maxProbeDistance} F${cfg.feedFast}`, // Fast probe
            `G91 G0 Z${cfg.retract}`,                   // Retract
            `G38.2 Z-${cfg.retract + 2} F${cfg.feedSlow}`, // Slow probe
            'G90',
            
            // Apply offset (this would need macro variable support in grblHAL)
            // For now, the UI will handle offset application
            
            `G53 G0 Z${cfg.z_safe}`,                    // Safe Z
            `; Tool ${toolNumber} ready`,
        ].join('\n');
    }
    
    // ================================================================
    // UI INTEGRATION
    // ================================================================
    
    /**
     * Create tool setter configuration UI
     */
    createConfigUI() {
        const cfg = this.config;
        
        return `
            <div class="tool-setter-config">
                <h4>🔧 Tool Setter Configuration</h4>
                
                <div class="config-section">
                    <h5>Setter Position (Machine Coordinates)</h5>
                    <div class="input-row">
                        <label>X:</label>
                        <input type="number" id="ts-x" value="${cfg.x}" step="0.1">
                        <label>Y:</label>
                        <input type="number" id="ts-y" value="${cfg.y}" step="0.1">
                    </div>
                    <div class="input-row">
                        <label>Safe Z:</label>
                        <input type="number" id="ts-zsafe" value="${cfg.z_safe}" step="1">
                        <label>Probe Start Z:</label>
                        <input type="number" id="ts-zstart" value="${cfg.z_start}" step="1">
                    </div>
                    <button onclick="app.toolSetter.teachPosition()" class="btn btn-sm">
                        📍 Teach Current Position
                    </button>
                </div>
                
                <div class="config-section">
                    <h5>Probing Parameters</h5>
                    <div class="input-row">
                        <label>Fast Feed:</label>
                        <input type="number" id="ts-feedfast" value="${cfg.feedFast}" step="10">
                        <span>mm/min</span>
                    </div>
                    <div class="input-row">
                        <label>Slow Feed:</label>
                        <input type="number" id="ts-feedslow" value="${cfg.feedSlow}" step="5">
                        <span>mm/min</span>
                    </div>
                    <div class="input-row">
                        <label>Retract:</label>
                        <input type="number" id="ts-retract" value="${cfg.retract}" step="0.5">
                        <span>mm</span>
                    </div>
                </div>
                
                <div class="config-section">
                    <h5>Calibration</h5>
                    <div class="stat-row">
                        <span>Reference Tool Length:</span>
                        <span>${cfg.referenceToolLength.toFixed(3)} mm</span>
                    </div>
                    <div class="stat-row">
                        <span>Status:</span>
                        <span class="${this.state.calibrated ? 'text-green' : 'text-yellow'}">
                            ${this.state.calibrated ? 'Calibrated' : 'Not Calibrated'}
                        </span>
                    </div>
                    <button onclick="app.toolSetter.calibrateReference()" class="btn btn-primary">
                        🎯 Calibrate Reference Tool
                    </button>
                </div>
                
                <div class="config-section">
                    <h5>Quick Actions</h5>
                    <button onclick="app.toolSetter.measureTool()" class="btn">
                        📏 Measure Current Tool
                    </button>
                    <button onclick="app.toolSetter.gotoSetter()" class="btn">
                        ➡️ Go to Setter Position
                    </button>
                </div>
            </div>
        `;
    }
    
    /**
     * Create tool table UI
     */
    createToolTableUI() {
        const tools = this.tools;
        const rows = Object.entries(tools).map(([num, data]) => `
            <tr>
                <td>T${num}</td>
                <td>${data.measuredZ?.toFixed(3) ?? '-'}</td>
                <td>${data.offset?.toFixed(3) ?? '-'}</td>
                <td>${data.measuredAt ? new Date(data.measuredAt).toLocaleString() : '-'}</td>
                <td>
                    <button onclick="app.toolSetter.measureTool(${num})" class="btn btn-xs">
                        📏
                    </button>
                    <button onclick="app.toolSetter.applyToolOffset(${num})" class="btn btn-xs">
                        ✓
                    </button>
                </td>
            </tr>
        `).join('');
        
        return `
            <div class="tool-table">
                <h4>📋 Tool Table</h4>
                <table>
                    <thead>
                        <tr>
                            <th>Tool</th>
                            <th>Measured Z</th>
                            <th>Offset</th>
                            <th>Last Measured</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${rows || '<tr><td colspan="5">No tools measured</td></tr>'}
                    </tbody>
                </table>
                <div class="tool-actions">
                    <button onclick="app.toolSetter.measureAllTools()" class="btn">
                        📏 Measure All Tools
                    </button>
                    <button onclick="app.toolSetter.clearToolTable()" class="btn btn-danger">
                        🗑️ Clear Table
                    </button>
                </div>
            </div>
        `;
    }
    
    // ================================================================
    // UTILITY FUNCTIONS
    // ================================================================
    
    /**
     * Teach current position as setter position
     */
    async teachPosition() {
        const pos = this.app?.state?.mpos;
        if (!pos) {
            this.app?.showNotification?.('Cannot read position', 'error');
            return;
        }
        
        this.config.x = pos.x;
        this.config.y = pos.y;
        this.saveConfig();
        
        this.app?.showNotification?.(
            `Tool setter position saved: X${pos.x.toFixed(3)} Y${pos.y.toFixed(3)}`,
            'success'
        );
    }
    
    /**
     * Move to tool setter position
     */
    gotoSetter() {
        const cfg = this.config;
        this.app?.sendCommand?.(`G53 G0 Z${cfg.z_safe}`);
        this.app?.sendCommand?.(`G53 G0 X${cfg.x} Y${cfg.y}`);
    }
    
    /**
     * Measure all registered tools
     */
    async measureAllTools() {
        const toolNumbers = Object.keys(this.tools).map(n => parseInt(n));
        
        if (toolNumbers.length === 0) {
            this.app?.showNotification?.('No tools in table', 'warning');
            return;
        }
        
        for (const toolNum of toolNumbers) {
            this.app?.showNotification?.(`Measuring tool ${toolNum}...`, 'info');
            // Note: This assumes manual tool changes - for ATC, use ATC integration
            await this.measureTool(toolNum);
        }
        
        this.app?.showNotification?.('All tools measured', 'success');
    }
    
    /**
     * Clear tool table
     */
    clearToolTable() {
        if (confirm('Clear all tool measurements?')) {
            this.tools = {};
            this.saveTools();
            this.app?.showNotification?.('Tool table cleared', 'info');
        }
    }
    
    /**
     * Update config from UI inputs
     */
    updateConfigFromUI() {
        const getValue = (id) => {
            const el = document.getElementById(id);
            return el ? parseFloat(el.value) : null;
        };
        
        this.config.x = getValue('ts-x') ?? this.config.x;
        this.config.y = getValue('ts-y') ?? this.config.y;
        this.config.z_safe = getValue('ts-zsafe') ?? this.config.z_safe;
        this.config.z_start = getValue('ts-zstart') ?? this.config.z_start;
        this.config.feedFast = getValue('ts-feedfast') ?? this.config.feedFast;
        this.config.feedSlow = getValue('ts-feedslow') ?? this.config.feedSlow;
        this.config.retract = getValue('ts-retract') ?? this.config.retract;
        
        this.saveConfig();
        this.app?.showNotification?.('Tool setter config saved', 'success');
    }
}

// Export
if (typeof module !== 'undefined') {
    module.exports = ToolSetter;
}

// Note: Initialized by app.js after FluidCNCApp creation
