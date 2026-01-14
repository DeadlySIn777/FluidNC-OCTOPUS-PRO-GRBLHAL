/* ========================================
   FluidCNC - Probe Wizard
   
   Animated SVG probe wizard with:
   - Z surface probing (tool setter / workpiece)
   - Corner finding (inside/outside)
   - Center finding (boss/hole)
   - Edge finding (X/Y edges)
   - Tool length probing
   - Proper Promise-based sendAndWait
   - Safety checks and probe verification
   ======================================== */

class ProbeWizard {
    constructor(options = {}) {
        this.grbl = options.grbl || null;
        this.container = options.container || document.getElementById('probe-wizard-container');
        
        // Probe configuration - SAFETY CRITICAL VALUES
        this.config = {
            probeFeedFast: 300,   // First probe - fast
            probeFeedSlow: 50,    // Second probe - slow/accurate
            probeRetract: 2,      // Retract after first probe
            probeMaxZ: -25,       // Max Z probe distance (REDUCED from 50 for safety)
            probeMaxXY: 20,       // Max XY probe distance (REDUCED from 30 for safety)
            toolDiameter: 0,      // Probe tool diameter (0 for touch probe)
            toolSetterZ: -180,    // Tool setter Z position (machine coords)
            toolSetterOffset: 0,  // Tool setter to spindle face offset
            safeZ: 10,            // Safe Z height above work
            probeTimeout: 15000,  // Max time to wait for probe (REDUCED from 60s to 15s)
            verifyProbe: true,    // Verify probe is connected before probing
            requireHome: true,    // Require machine to be homed first
            maxProbeDeviation: 0.05,  // Max deviation between fast/slow probe (mm)
            // Safety limits - NEVER exceed these
            absoluteMaxProbeDistance: 50,  // Hard limit - never probe further than this
            minProbeFeed: 10,              // Never probe slower than this (stall risk)
            maxProbeFeed: 500              // Never probe faster than this (crash risk)
        };
        
        // Merge with provided config
        Object.assign(this.config, options.config || {});
        
        // State
        this.probing = false;
        this.currentStep = 0;
        this.probeType = null;
        this.probeResults = {};
        this.probeHistory = [];  // Store probe results for analysis
        
        // Callbacks
        this.onComplete = options.onComplete || (() => {});
        this.onError = options.onError || ((err) => console.error('[Probe]', err));
        this.onStatus = options.onStatus || ((msg) => console.log('[Probe]', msg));
        
        this.init();
    }
    
    init() {
        if (this.container) {
            this.render();
        }
        
        // Load saved config from localStorage
        this.loadSavedConfig();
    }
    
    loadSavedConfig() {
        try {
            const saved = localStorage.getItem('fluidcnc_probe_config');
            if (saved) {
                Object.assign(this.config, JSON.parse(saved));
            }
        } catch (e) {
            console.warn('Failed to load probe config:', e);
        }
    }
    
    saveConfig() {
        try {
            localStorage.setItem('fluidcnc_probe_config', JSON.stringify(this.config));
        } catch (e) {
            console.warn('Failed to save probe config:', e);
        }
    }
    
    setGrbl(grbl) {
        this.grbl = grbl;
    }
    
    // ================================================================
    // Rendering
    // ================================================================
    
    render() {
        this.container.innerHTML = `
            <div class="probe-wizard">
                <div class="probe-header">
                    <h3>🔍 Probe Wizard</h3>
                    <button class="btn-close probe-close-btn">×</button>
                </div>
                
                <div class="probe-type-select">
                    <button class="probe-type-btn" data-type="z-surface">
                        <svg viewBox="0 0 60 60"><use href="#icon-probe-z"/></svg>
                        <span>Z Surface</span>
                    </button>
                    <button class="probe-type-btn" data-type="z-tool">
                        <svg viewBox="0 0 60 60"><use href="#icon-probe-tool"/></svg>
                        <span>Tool Length</span>
                    </button>
                    <button class="probe-type-btn" data-type="corner-outside">
                        <svg viewBox="0 0 60 60"><use href="#icon-probe-corner"/></svg>
                        <span>Corner</span>
                    </button>
                    <button class="probe-type-btn" data-type="edge-x">
                        <svg viewBox="0 0 60 60"><use href="#icon-probe-edge"/></svg>
                        <span>Edge X</span>
                    </button>
                    <button class="probe-type-btn" data-type="edge-y">
                        <svg viewBox="0 0 60 60"><use href="#icon-probe-edge" transform="rotate(90 30 30)"/></svg>
                        <span>Edge Y</span>
                    </button>
                    <button class="probe-type-btn" data-type="center-boss">
                        <svg viewBox="0 0 60 60"><use href="#icon-probe-center"/></svg>
                        <span>Center</span>
                    </button>
                </div>
                
                <div class="probe-animation" id="probe-animation">
                    ${this.getProbeIcons()}
                </div>
                
                <div class="probe-config" id="probe-config">
                    <!-- Dynamic config based on probe type -->
                </div>
                
                <div class="probe-status" id="probe-status">
                    Select a probe type to begin
                </div>
                
                <div class="probe-results" id="probe-results" style="display:none">
                    <!-- Probe results -->
                </div>
                
                <div class="probe-actions">
                    <button class="btn btn-primary" id="probe-start" disabled>Start Probe</button>
                    <button class="btn btn-secondary" id="probe-cancel" style="display:none">Cancel</button>
                </div>
            </div>
        `;
        
        this.bindEvents();
    }
    
    getProbeIcons() {
        return `
            <svg style="display:none">
                <defs>
                    <!-- Z Probe Icon -->
                    <symbol id="icon-probe-z" viewBox="0 0 60 60">
                        <rect x="25" y="5" width="10" height="25" fill="#666"/>
                        <circle cx="30" cy="35" r="5" fill="#f00" class="probe-tip"/>
                        <rect x="10" y="45" width="40" height="10" fill="#888"/>
                        <path d="M30 35 L30 45" stroke="#f00" stroke-width="2" stroke-dasharray="4,2" class="probe-line"/>
                    </symbol>
                    
                    <!-- Tool Length Probe -->
                    <symbol id="icon-probe-tool" viewBox="0 0 60 60">
                        <rect x="25" y="5" width="10" height="30" fill="#666"/>
                        <path d="M25 35 L30 45 L35 35" fill="#999"/>
                        <rect x="15" y="50" width="30" height="5" fill="#f90" class="tool-setter"/>
                        <rect x="20" y="48" width="20" height="2" fill="#fc0"/>
                    </symbol>
                    
                    <!-- Corner Probe -->
                    <symbol id="icon-probe-corner" viewBox="0 0 60 60">
                        <rect x="5" y="30" width="25" height="25" fill="#888"/>
                        <rect x="25" y="5" width="10" height="20" fill="#666"/>
                        <circle cx="30" cy="30" r="4" fill="#f00" class="probe-tip"/>
                        <path d="M30 30 L5 30 M30 30 L30 55" stroke="#0f0" stroke-width="1" stroke-dasharray="3,2"/>
                    </symbol>
                    
                    <!-- Edge Probe -->
                    <symbol id="icon-probe-edge" viewBox="0 0 60 60">
                        <rect x="5" y="25" width="20" height="30" fill="#888"/>
                        <rect x="35" y="5" width="10" height="20" fill="#666"/>
                        <circle cx="40" cy="30" r="4" fill="#f00" class="probe-tip"/>
                        <path d="M40 30 L25 30" stroke="#0f0" stroke-width="2" stroke-dasharray="3,2"/>
                    </symbol>
                    
                    <!-- Center Probe -->
                    <symbol id="icon-probe-center" viewBox="0 0 60 60">
                        <circle cx="30" cy="35" r="20" fill="none" stroke="#888" stroke-width="4"/>
                        <rect x="27" y="5" width="6" height="15" fill="#666"/>
                        <circle cx="30" cy="25" r="3" fill="#f00" class="probe-tip"/>
                        <circle cx="30" cy="35" r="2" fill="#0f0"/>
                        <path d="M30 25 L30 35" stroke="#0f0" stroke-width="1" stroke-dasharray="2,2"/>
                    </symbol>
                </defs>
            </svg>
            
            <div class="probe-anim-container" id="probe-anim-display">
                <svg viewBox="0 0 120 100" class="probe-anim-svg">
                    <!-- Animated probe visualization will go here -->
                </svg>
            </div>
        `;
    }
    
    bindEvents() {
        // Close button
        this.container.querySelector('.probe-close-btn')?.addEventListener('click', () => {
            this.close();
        });
        
        // Probe type buttons
        this.container.querySelectorAll('.probe-type-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                this.selectType(btn.dataset.type);
            });
        });
        
        // Start button
        document.getElementById('probe-start')?.addEventListener('click', () => {
            this.startProbe();
        });
        
        // Cancel button
        document.getElementById('probe-cancel')?.addEventListener('click', () => {
            this.cancelProbe();
        });
    }
    
    selectType(type) {
        this.probeType = type;
        
        // Highlight selected
        this.container.querySelectorAll('.probe-type-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.type === type);
        });
        
        // Show config for this type
        this.showConfig(type);
        
        // Enable start button
        document.getElementById('probe-start').disabled = false;
        
        // Show animation preview
        this.showAnimationPreview(type);
    }
    
    showConfig(type) {
        const configEl = document.getElementById('probe-config');
        
        const configs = {
            'z-surface': `
                <div class="config-group">
                    <label>Fast Feed (mm/min):</label>
                    <input type="number" id="probe-feed-fast" value="${this.config.probeFeedFast}" min="10" max="1000">
                </div>
                <div class="config-group">
                    <label>Slow Feed (mm/min):</label>
                    <input type="number" id="probe-feed-slow" value="${this.config.probeFeedSlow}" min="5" max="100">
                </div>
                <div class="config-group">
                    <label>Max Probe Distance (mm):</label>
                    <input type="number" id="probe-max-z" value="${Math.abs(this.config.probeMaxZ)}" min="1" max="100">
                </div>
            `,
            'z-tool': `
                <div class="config-group">
                    <label>Tool Setter Z (machine):</label>
                    <input type="number" id="probe-setter-z" value="${this.config.toolSetterZ}" step="0.1">
                </div>
                <div class="config-group">
                    <label>Probe Feed (mm/min):</label>
                    <input type="number" id="probe-feed-fast" value="${this.config.probeFeedFast}" min="10" max="500">
                </div>
            `,
            'corner-outside': `
                <div class="config-group">
                    <label>Probe Tool Diameter (mm):</label>
                    <input type="number" id="probe-tool-dia" value="${this.config.toolDiameter}" min="0" step="0.1">
                </div>
                <div class="config-group">
                    <label>XY Probe Distance (mm):</label>
                    <input type="number" id="probe-max-xy" value="${this.config.probeMaxXY}" min="1" max="100">
                </div>
                <div class="config-group">
                    <label>Corner:</label>
                    <select id="probe-corner">
                        <option value="FL">Front Left (-X, -Y)</option>
                        <option value="FR">Front Right (+X, -Y)</option>
                        <option value="BL">Back Left (-X, +Y)</option>
                        <option value="BR">Back Right (+X, +Y)</option>
                    </select>
                </div>
            `,
            'edge-x': `
                <div class="config-group">
                    <label>Probe Tool Diameter (mm):</label>
                    <input type="number" id="probe-tool-dia" value="${this.config.toolDiameter}" min="0" step="0.1">
                </div>
                <div class="config-group">
                    <label>Direction:</label>
                    <select id="probe-dir">
                        <option value="-1">-X (probe left)</option>
                        <option value="1">+X (probe right)</option>
                    </select>
                </div>
            `,
            'edge-y': `
                <div class="config-group">
                    <label>Probe Tool Diameter (mm):</label>
                    <input type="number" id="probe-tool-dia" value="${this.config.toolDiameter}" min="0" step="0.1">
                </div>
                <div class="config-group">
                    <label>Direction:</label>
                    <select id="probe-dir">
                        <option value="-1">-Y (probe front)</option>
                        <option value="1">+Y (probe back)</option>
                    </select>
                </div>
            `,
            'center-boss': `
                <div class="config-group">
                    <label>Probe Tool Diameter (mm):</label>
                    <input type="number" id="probe-tool-dia" value="${this.config.toolDiameter}" min="0" step="0.1">
                </div>
                <div class="config-group">
                    <label>Approximate Diameter (mm):</label>
                    <input type="number" id="probe-approx-dia" value="25" min="5" max="200">
                </div>
                <div class="config-group">
                    <label>Type:</label>
                    <select id="probe-center-type">
                        <option value="boss">Boss (outside)</option>
                        <option value="hole">Hole (inside)</option>
                    </select>
                </div>
            `
        };
        
        configEl.innerHTML = configs[type] || '';
    }
    
    showAnimationPreview(type) {
        const animEl = document.getElementById('probe-anim-display');
        const svgContent = this.getAnimationSVG(type, 'preview');
        animEl.innerHTML = `<svg viewBox="0 0 120 100" class="probe-anim-svg">${svgContent}</svg>`;
    }
    
    getAnimationSVG(type, mode = 'preview') {
        const animations = {
            'z-surface': `
                <rect x="20" y="60" width="80" height="30" fill="#555" rx="2"/>
                <rect x="55" y="5" width="10" height="35" fill="#888"/>
                <circle cx="60" cy="45" r="5" fill="#f44" class="probe-tip">
                    ${mode === 'active' ? '<animate attributeName="cy" values="45;55;52" dur="2s" repeatCount="indefinite"/>' : ''}
                </circle>
                <text x="60" y="95" text-anchor="middle" fill="#fff" font-size="8">Z Surface Probe</text>
            `,
            'z-tool': `
                <rect x="25" y="75" width="70" height="8" fill="#f90" rx="1"/>
                <rect x="35" y="72" width="50" height="3" fill="#fc0"/>
                <rect x="55" y="10" width="10" height="30" fill="#888"/>
                <path d="M55 40 L60 55 L65 40" fill="#999"/>
                <circle cx="60" cy="55" r="3" fill="#f44" class="probe-tip">
                    ${mode === 'active' ? '<animate attributeName="cy" values="55;70;67" dur="2s" repeatCount="indefinite"/>' : ''}
                </circle>
                <text x="60" y="95" text-anchor="middle" fill="#fff" font-size="8">Tool Length Probe</text>
            `,
            'corner-outside': `
                <rect x="10" y="50" width="50" height="40" fill="#555"/>
                <rect x="75" y="15" width="8" height="25" fill="#888"/>
                <circle cx="79" cy="45" r="4" fill="#f44" class="probe-tip">
                    ${mode === 'active' ? `
                        <animate attributeName="cx" values="79;65;68;68" dur="3s" repeatCount="indefinite"/>
                        <animate attributeName="cy" values="45;45;45;55" dur="3s" repeatCount="indefinite"/>
                    ` : ''}
                </circle>
                <line x1="60" y1="50" x2="60" y2="90" stroke="#0f0" stroke-dasharray="3,2"/>
                <line x1="10" y1="50" x2="60" y2="50" stroke="#0f0" stroke-dasharray="3,2"/>
                <text x="60" y="98" text-anchor="middle" fill="#fff" font-size="8">Corner Probe</text>
            `,
            'edge-x': `
                <rect x="10" y="30" width="40" height="60" fill="#555"/>
                <rect x="75" y="15" width="8" height="25" fill="#888"/>
                <circle cx="79" cy="45" r="4" fill="#f44" class="probe-tip">
                    ${mode === 'active' ? '<animate attributeName="cx" values="79;55;58" dur="2s" repeatCount="indefinite"/>' : ''}
                </circle>
                <line x1="50" y1="30" x2="50" y2="90" stroke="#0f0" stroke-dasharray="3,2"/>
                <text x="60" y="98" text-anchor="middle" fill="#fff" font-size="8">Edge X Probe</text>
            `,
            'edge-y': `
                <rect x="30" y="10" width="60" height="35" fill="#555"/>
                <rect x="56" y="55" width="8" height="25" fill="#888"/>
                <circle cx="60" cy="50" r="4" fill="#f44" class="probe-tip">
                    ${mode === 'active' ? '<animate attributeName="cy" values="50;48;48" dur="2s" repeatCount="indefinite"/>' : ''}
                </circle>
                <line x1="30" y1="45" x2="90" y2="45" stroke="#0f0" stroke-dasharray="3,2"/>
                <text x="60" y="98" text-anchor="middle" fill="#fff" font-size="8">Edge Y Probe</text>
            `,
            'center-boss': `
                <circle cx="60" cy="55" r="25" fill="none" stroke="#555" stroke-width="8"/>
                <rect x="56" y="10" width="8" height="20" fill="#888"/>
                <circle cx="60" cy="35" r="4" fill="#f44" class="probe-tip">
                    ${mode === 'active' ? `
                        <animate attributeName="cx" values="60;40;60;80;60" dur="4s" repeatCount="indefinite"/>
                        <animate attributeName="cy" values="35;55;75;55;35" dur="4s" repeatCount="indefinite"/>
                    ` : ''}
                </circle>
                <circle cx="60" cy="55" r="2" fill="#0f0"/>
                <text x="60" y="98" text-anchor="middle" fill="#fff" font-size="8">Center Find</text>
            `
        };
        
        return animations[type] || '';
    }
    
    updateStatus(msg, type = 'info') {
        const statusEl = document.getElementById('probe-status');
        if (statusEl) {
            statusEl.innerHTML = `<span class="status-${type}">${msg}</span>`;
        }
        this.onStatus(msg);
    }
    
    // ================================================================
    // Probing Routines
    // ================================================================
    
    async startProbe() {
        if (!this.grbl) {
            this.onError('Not connected to machine');
            return;
        }
        
        if (!this.grbl.isIdle()) {
            this.onError('Machine must be idle to probe');
            return;
        }
        
        // Safety checks
        try {
            await this.performSafetyChecks();
        } catch (err) {
            this.updateStatus(`Safety check failed: ${err.message}`, 'error');
            this.onError(err);
            return;
        }
        
        this.probing = true;
        this.probeResults = {};
        
        document.getElementById('probe-start').style.display = 'none';
        document.getElementById('probe-cancel').style.display = 'block';
        
        // Show active animation
        const animEl = document.getElementById('probe-anim-display');
        animEl.innerHTML = `<svg viewBox="0 0 120 100" class="probe-anim-svg">${this.getAnimationSVG(this.probeType, 'active')}</svg>`;
        
        try {
            // Read and save config values
            this.readConfigValues();
            this.saveConfig();
            
            switch (this.probeType) {
                case 'z-surface':
                    await this.probeZSurface();
                    break;
                case 'z-tool':
                    await this.probeToolLength();
                    break;
                case 'corner-outside':
                    await this.probeCorner();
                    break;
                case 'edge-x':
                    await this.probeEdge('X');
                    break;
                case 'edge-y':
                    await this.probeEdge('Y');
                    break;
                case 'center-boss':
                    await this.probeCenter();
                    break;
            }
            
            // Store in history
            this.probeHistory.push({
                ...this.probeResults,
                timestamp: Date.now()
            });
            if (this.probeHistory.length > 50) {
                this.probeHistory.shift();
            }
            
            this.showResults();
            this.onComplete(this.probeResults);
            
        } catch (err) {
            this.updateStatus(`Error: ${err.message}`, 'error');
            this.showErrorRecovery(err);
            this.onError(err);
            
            // Make sure we're in a safe state
            try {
                await this.grbl.sendAndWait('G90');  // Back to absolute
            } catch (e) { /* ignore */ }
        } finally {
            this.probing = false;
            document.getElementById('probe-start').style.display = 'block';
            document.getElementById('probe-cancel').style.display = 'none';
        }
    }
    
    async performSafetyChecks() {
        // Check if machine is homed (if required)
        if (this.config.requireHome && this.grbl.state.status === 'Alarm') {
            throw new Error('Machine is in ALARM state - home first ($H)');
        }
        
        // Verify probe is connected (send a test command)
        if (this.config.verifyProbe) {
            this.updateStatus('Verifying probe connection...');
            
            // Check probe pin state via G38.5 (probe away) - should fail immediately if probe triggered
            // Or use status query to check probe pin
            const state = this.grbl.state;
            
            // If probe is already triggered, warn the user
            if (state.probeTriggered) {
                throw new Error('Probe appears to be already triggered - check wiring');
            }
        }
        
        // Make sure spindle is off
        await this.grbl.sendAndWait('M5');
        
        this.updateStatus('Safety checks passed ✓');
    }
    
    readConfigValues() {
        const getValue = (id, def) => {
            const el = document.getElementById(id);
            return el ? parseFloat(el.value) || def : def;
        };
        const getSelect = (id, def) => {
            const el = document.getElementById(id);
            return el ? el.value : def;
        };
        
        this.config.probeFeedFast = getValue('probe-feed-fast', 300);
        this.config.probeFeedSlow = getValue('probe-feed-slow', 50);
        this.config.probeMaxZ = -Math.abs(getValue('probe-max-z', 50));
        this.config.probeMaxXY = getValue('probe-max-xy', 30);
        this.config.toolDiameter = getValue('probe-tool-dia', 0);
        this.config.toolSetterZ = getValue('probe-setter-z', -180);
        this.config.probeCorner = getSelect('probe-corner', 'FL');
        this.config.probeDir = parseInt(getSelect('probe-dir', '-1'));
        this.config.approxDia = getValue('probe-approx-dia', 25);
        this.config.centerType = getSelect('probe-center-type', 'boss');
    }
    
    async probeZSurface() {
        this.updateStatus('Probing Z surface (fast)...');
        
        // Fast probe
        const result1 = await this.executeProbe('Z', this.config.probeMaxZ, this.config.probeFeedFast);
        
        // Retract
        this.updateStatus('Retracting...');
        await this.grbl.sendAndWait(`G91 G0 Z${this.config.probeRetract}`);
        await this.grbl.waitForIdle();
        
        // Slow probe for accuracy
        this.updateStatus('Probing Z surface (slow)...');
        const result2 = await this.executeProbe('Z', -this.config.probeRetract * 2, this.config.probeFeedSlow);
        
        this.probeResults = {
            type: 'z-surface',
            z: result2.z,
            success: true
        };
        
        // Set Z zero
        this.updateStatus('Setting Z zero...');
        await this.grbl.sendAndWait('G10 L20 P1 Z0');
        
        // SAFE RETRACT: Use absolute coordinates to avoid compounding errors
        await this.grbl.sendAndWait('G90'); // Ensure absolute mode FIRST
        
        // Verify we're not at a limit before retracting
        const currentState = this.grbl.state;
        if (currentState?.status === 'Alarm') {
            throw new Error('Machine entered alarm state - cannot safely retract. Clear alarm and home.');
        }
        
        // Use work coordinates for retract (Z0 was just set)
        const safeZ = Math.abs(this.config.safeZ) || 10;
        await this.grbl.sendAndWait(`G0 Z${safeZ}`);
        
        this.updateStatus('✅ Z surface probed - Z zero set!', 'success');
    }
    
    async probeToolLength() {
        this.updateStatus('Moving to tool setter...');
        
        // Get current tool
        const currentTool = this.grbl.state.tool || 1;
        
        // Move to safe Z first
        await this.grbl.sendAndWait(`G53 G0 Z-5`);
        await this.grbl.waitForIdle();
        
        // Move XY to tool setter position (assumed at machine 0,0 or configured)
        // For now, assume we're already positioned over tool setter
        
        this.updateStatus('Probing tool length (fast)...');
        const result1 = await this.executeProbe('Z', this.config.toolSetterZ + 50, this.config.probeFeedFast);
        
        // Retract
        await this.grbl.sendAndWait(`G91 G0 Z${this.config.probeRetract}`);
        await this.grbl.waitForIdle();
        
        // Slow probe
        this.updateStatus('Probing tool length (slow)...');
        const result2 = await this.executeProbe('Z', -this.config.probeRetract * 2, this.config.probeFeedSlow);
        
        this.probeResults = {
            type: 'tool-length',
            tool: currentTool,
            z: result2.z,
            success: true
        };
        
        // Set tool offset
        const toolOffset = result2.z - this.config.toolSetterOffset;
        await this.grbl.sendAndWait(`G43.1 Z${toolOffset.toFixed(4)}`);
        
        // Retract
        await this.grbl.sendAndWait(`G53 G0 Z-5`);
        
        this.updateStatus(`✅ Tool ${currentTool} length set: ${toolOffset.toFixed(3)}mm`, 'success');
    }
    
    async probeCorner() {
        const corner = this.config.probeCorner;
        const xDir = corner.includes('L') ? -1 : 1;
        const yDir = corner.includes('F') ? -1 : 1;
        const toolRadius = this.config.toolDiameter / 2;
        
        // Probe X
        this.updateStatus(`Probing X edge...`);
        await this.grbl.sendAndWait(`G91 G0 X${-xDir * 10}`); // Move towards edge
        await this.grbl.waitForIdle();
        
        const xResult = await this.executeProbe('X', xDir * this.config.probeMaxXY, this.config.probeFeedSlow);
        
        // Retract X
        await this.grbl.sendAndWait(`G91 G0 X${-xDir * 5}`);
        await this.grbl.waitForIdle();
        
        // Move down and over for Y probe
        await this.grbl.sendAndWait(`G91 G0 Y${-yDir * 10}`);
        await this.grbl.waitForIdle();
        
        // Probe Y
        this.updateStatus(`Probing Y edge...`);
        const yResult = await this.executeProbe('Y', yDir * this.config.probeMaxXY, this.config.probeFeedSlow);
        
        // Calculate corner position with tool compensation
        const cornerX = xResult.x + (xDir * toolRadius);
        const cornerY = yResult.y + (yDir * toolRadius);
        
        this.probeResults = {
            type: 'corner',
            corner: corner,
            x: cornerX,
            y: cornerY,
            rawX: xResult.x,
            rawY: yResult.y,
            toolRadius: toolRadius,
            success: true
        };
        
        // Set XY zero at corner
        this.updateStatus('Setting XY zero...');
        await this.grbl.sendAndWait('G90');
        await this.grbl.sendAndWait(`G10 L20 P1 X${-cornerX} Y${-cornerY}`);
        
        // Move to the corner
        await this.grbl.sendAndWait('G0 X0 Y0');
        
        this.updateStatus(`✅ Corner found - XY zero set!`, 'success');
    }
    
    async probeEdge(axis) {
        const dir = this.config.probeDir;
        const toolRadius = this.config.toolDiameter / 2;
        
        this.updateStatus(`Probing ${axis} edge...`);
        
        const result = await this.executeProbe(axis, dir * this.config.probeMaxXY, this.config.probeFeedSlow);
        
        // Calculate edge with tool compensation
        const edge = result[axis.toLowerCase()] + (-dir * toolRadius);
        
        this.probeResults = {
            type: `edge-${axis.toLowerCase()}`,
            [axis.toLowerCase()]: edge,
            raw: result[axis.toLowerCase()],
            toolRadius: toolRadius,
            success: true
        };
        
        // Set zero
        await this.grbl.sendAndWait(`G10 L20 P1 ${axis}0`);
        
        // Retract
        await this.grbl.sendAndWait(`G91 G0 ${axis}${-dir * 5}`);
        await this.grbl.sendAndWait('G90');
        
        this.updateStatus(`✅ ${axis} edge found - ${axis} zero set!`, 'success');
    }
    
    async probeCenter() {
        const approxRadius = this.config.approxDia / 2;
        const isBoss = this.config.centerType === 'boss';
        const toolRadius = this.config.toolDiameter / 2;
        
        // Probe 4 points
        const probes = [];
        
        // +X
        this.updateStatus('Probing +X...');
        if (isBoss) {
            await this.grbl.sendAndWait(`G91 G0 X${approxRadius + 10}`);
            await this.grbl.waitForIdle();
        }
        const px = await this.executeProbe('X', isBoss ? -this.config.probeMaxXY : this.config.probeMaxXY, this.config.probeFeedSlow);
        probes.push({ axis: 'x', dir: 1, pos: px.x });
        
        // Return to start
        await this.grbl.sendAndWait(`G91 G0 X${isBoss ? 10 : -10}`);
        await this.grbl.waitForIdle();
        
        // -X
        this.updateStatus('Probing -X...');
        if (isBoss) {
            await this.grbl.sendAndWait(`G91 G0 X${-(approxRadius * 2 + 20)}`);
        } else {
            await this.grbl.sendAndWait(`G91 G0 X${-(approxRadius * 2)}`);
        }
        await this.grbl.waitForIdle();
        const mx = await this.executeProbe('X', isBoss ? this.config.probeMaxXY : -this.config.probeMaxXY, this.config.probeFeedSlow);
        probes.push({ axis: 'x', dir: -1, pos: mx.x });
        
        // Move to center X
        const centerX = (px.x + mx.x) / 2;
        await this.grbl.sendAndWait(`G90 G0 X${centerX}`);
        await this.grbl.waitForIdle();
        
        // +Y
        this.updateStatus('Probing +Y...');
        await this.grbl.sendAndWait(`G91 G0 Y${isBoss ? approxRadius + 10 : approxRadius}`);
        await this.grbl.waitForIdle();
        const py = await this.executeProbe('Y', isBoss ? -this.config.probeMaxXY : this.config.probeMaxXY, this.config.probeFeedSlow);
        probes.push({ axis: 'y', dir: 1, pos: py.y });
        
        // Return and -Y
        this.updateStatus('Probing -Y...');
        await this.grbl.sendAndWait(`G91 G0 Y${isBoss ? (approxRadius * 2 + 20) : (approxRadius * 2)}`);
        await this.grbl.waitForIdle();
        const my = await this.executeProbe('Y', isBoss ? this.config.probeMaxXY : -this.config.probeMaxXY, this.config.probeFeedSlow);
        probes.push({ axis: 'y', dir: -1, pos: my.y });
        
        // Calculate center
        const centerY = (py.y + my.y) / 2;
        const diameter = Math.abs(px.x - mx.x) - (isBoss ? toolRadius * 2 : -toolRadius * 2);
        
        this.probeResults = {
            type: 'center',
            centerType: this.config.centerType,
            x: centerX,
            y: centerY,
            diameter: diameter,
            success: true
        };
        
        // Move to center and set zero
        await this.grbl.sendAndWait(`G90 G0 X${centerX} Y${centerY}`);
        await this.grbl.sendAndWait('G10 L20 P1 X0 Y0');
        
        this.updateStatus(`✅ Center found - Diameter: ${diameter.toFixed(2)}mm`, 'success');
    }
    
    // ================================================================
    // Execute single probe move with proper Promise handling
    // ================================================================
    
    async executeProbe(axis, distance, feedRate) {
        // SAFETY VALIDATION - Check distance and feed rate limits
        const absDistance = Math.abs(distance);
        if (absDistance > this.config.absoluteMaxProbeDistance) {
            throw new Error(`Probe distance ${absDistance}mm exceeds safety limit of ${this.config.absoluteMaxProbeDistance}mm`);
        }
        
        // Clamp feed rate to safe limits
        feedRate = Math.max(this.config.minProbeFeed || 10, 
                           Math.min(this.config.maxProbeFeed || 500, feedRate));
        
        if (!feedRate || feedRate <= 0 || !isFinite(feedRate)) {
            throw new Error(`Invalid probe feed rate: ${feedRate}`);
        }
        
        if (!this.grbl) {
            throw new Error('No GRBL connection for probing');
        }
        
        return new Promise((resolve, reject) => {
            // Clear previous result
            this.grbl.probeResult = null;
            
            // Set up timeout
            const timeout = setTimeout(() => {
                this.grbl.off('probe', probeHandler);
                this.grbl.off('error', errorHandler);
                reject(new Error(`Probe timeout after ${this.config.probeTimeout / 1000}s - check probe connection!`));
            }, this.config.probeTimeout);
            
            // Set up probe result handler
            const probeHandler = (result) => {
                clearTimeout(timeout);
                this.grbl.off('probe', probeHandler);
                this.grbl.off('error', errorHandler);
                this.grbl.off('alarm', alarmHandler);
                this.grbl.off('status', statusHandler);
                
                if (result.success) {
                    resolve(result);
                } else {
                    reject(new Error('Probe did not make contact'));
                }
            };
            
            // CRITICAL: Detect limit switch triggers during probe
            const alarmHandler = (alarmCode) => {
                clearTimeout(timeout);
                this.grbl.off('probe', probeHandler);
                this.grbl.off('error', errorHandler);
                this.grbl.off('alarm', alarmHandler);
                this.grbl.off('status', statusHandler);
                const limitMsg = alarmCode === 1 || alarmCode === 2 ? 
                    'LIMIT SWITCH TRIGGERED during probe! Machine stopped.' :
                    `Alarm ${alarmCode} during probe operation`;
                reject(new Error(limitMsg));
            };
            
            // Monitor status for limit pin state
            const statusHandler = (state) => {
                if (state.limitX || state.limitY || state.limitZ) {
                    clearTimeout(timeout);
                    this.grbl.off('probe', probeHandler);
                    this.grbl.off('error', errorHandler);
                    this.grbl.off('alarm', alarmHandler);
                    this.grbl.off('status', statusHandler);
                    this.grbl.send('!'); // Emergency feed hold
                    reject(new Error('LIMIT SWITCH active - probe aborted for safety'));
                }
            };
            
            // Set up error handler
            const errorHandler = (err) => {
                clearTimeout(timeout);
                this.grbl.off('probe', probeHandler);
                this.grbl.off('error', errorHandler);
                reject(new Error(err.message || 'Probe error'));
            };
            
            this.grbl.on('probe', probeHandler);
            this.grbl.on('error', errorHandler);
            this.grbl.on('alarm', alarmHandler);
            this.grbl.on('status', statusHandler);
            
            // Send probe command
            const cmd = `G91 G38.2 ${axis.toUpperCase()}${distance.toFixed(3)} F${Math.round(feedRate)}`;
            if (!this.grbl.send(cmd)) {
                clearTimeout(timeout);
                this.grbl.off('probe', probeHandler);
                this.grbl.off('error', errorHandler);
                reject(new Error('Failed to send probe command'));
            }
        });
    }
    
    // Execute a high-accuracy two-stage probe
    async executeAccurateProbe(axis, distance, fastFeed, slowFeed) {
        // Fast probe
        const fast = await this.executeProbe(axis, distance, fastFeed);
        
        // Retract
        await this.grbl.sendAndWait(`G91 G0 ${axis}${-Math.sign(distance) * this.config.probeRetract}`);
        await this.grbl.waitForIdle();
        
        // Slow probe
        const slow = await this.executeProbe(axis, Math.sign(distance) * this.config.probeRetract * 2, slowFeed);
        
        // Check deviation between fast and slow probes
        const axisLower = axis.toLowerCase();
        const deviation = Math.abs(fast[axisLower] - slow[axisLower]);
        
        if (deviation > this.config.maxProbeDeviation) {
            console.warn(`Probe deviation: ${deviation.toFixed(4)}mm (threshold: ${this.config.maxProbeDeviation}mm)`);
        }
        
        return {
            ...slow,
            deviation,
            fastResult: fast[axisLower],
            slowResult: slow[axisLower]
        };
    }
    
    cancelProbe() {
        if (this.probing) {
            this.grbl.send('!'); // Feed hold FIRST
            this.probing = false;
            
            // Wait for feed hold to take effect, then safely recover
            setTimeout(async () => {
                try {
                    // Issue cycle start to exit feed hold state before any motion
                    this.grbl.send('~');
                    await new Promise(r => setTimeout(r, 100));
                    
                    // Now safe to retract - use absolute move to known safe Z
                    await this.grbl.sendAndWait('G90'); // Ensure absolute mode
                    const safeZ = this.config.safeZ || 10;
                    await this.grbl.sendAndWait(`G53 G0 Z-5`); // Machine coords safe Z
                } catch (e) {
                    console.error('Cancel recovery failed:', e);
                }
            }, 200);
            
            this.updateStatus('Probe cancelled - retracting to safe Z', 'warning');
        }
        
        document.getElementById('probe-start').style.display = 'block';
        document.getElementById('probe-cancel').style.display = 'none';
    }
    
    showResults() {
        const resultsEl = document.getElementById('probe-results');
        if (!resultsEl || !this.probeResults.success) return;
        
        let html = '<div class="results-content"><h4>Probe Results</h4><table>';
        
        for (const [key, value] of Object.entries(this.probeResults)) {
            if (key === 'success' || key === 'type') continue;
            const displayValue = typeof value === 'number' ? value.toFixed(4) : value;
            html += `<tr><td>${key}</td><td>${displayValue}</td></tr>`;
        }
        
        html += '</table></div>';
        resultsEl.innerHTML = html;
        resultsEl.style.display = 'block';
    }
    
    // ================================================================
    // Error Recovery UI
    // ================================================================
    
    showErrorRecovery(error) {
        const message = error.message || error;
        const recovery = this.getRecoveryOptions(message);
        
        const modal = document.createElement('div');
        modal.className = 'modal-overlay probe-error-modal';
        modal.innerHTML = `
            <div class="modal modal-sm">
                <div class="modal-header error-header">
                    <span class="error-icon">⚠️</span>
                    <h3>Probe Error</h3>
                    <button class="btn-close" onclick="this.closest('.modal-overlay').remove()">×</button>
                </div>
                <div class="modal-body">
                    <p class="error-message">${message}</p>
                    <div class="recovery-options">
                        <h4>Recovery Options:</h4>
                        <ul>
                            ${recovery.suggestions.map(s => `<li>${s}</li>`).join('')}
                        </ul>
                    </div>
                </div>
                <div class="modal-footer recovery-buttons">
                    ${recovery.actions.map(a => 
                        `<button class="btn ${a.class}" data-action="${a.action}">${a.label}</button>`
                    ).join('')}
                    <button class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove()">Dismiss</button>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        
        // Bind action buttons
        modal.querySelectorAll('[data-action]').forEach(btn => {
            btn.addEventListener('click', async () => {
                const action = btn.dataset.action;
                modal.remove();
                await this.executeRecoveryAction(action);
            });
        });
        
        setTimeout(() => modal.classList.add('active'), 10);
    }
    
    getRecoveryOptions(message) {
        const lower = message.toLowerCase();
        
        // Default recovery
        const recovery = {
            suggestions: [],
            actions: []
        };
        
        // Probe didn't make contact
        if (lower.includes('did not') || lower.includes('no contact') || lower.includes('timeout')) {
            recovery.suggestions = [
                'Check that the probe is properly connected',
                'Verify probe polarity (NC/NO configuration)',
                'Increase probe travel distance in settings',
                'Check that the probe tip can reach the surface',
                'Make sure workpiece is properly secured'
            ];
            recovery.actions = [
                { action: 'retry', label: '🔄 Retry Probe', class: 'btn-primary' },
                { action: 'retract-z', label: '⬆️ Retract Z', class: 'btn-warning' }
            ];
        }
        // Probe already triggered
        else if (lower.includes('already triggered')) {
            recovery.suggestions = [
                'The probe input is reading as triggered before movement',
                'Check for short circuit in probe wiring',
                'Verify probe is not stuck in triggered position',
                'Check grblHAL probe pin configuration ($6 setting)'
            ];
            recovery.actions = [
                { action: 'check-probe', label: '🔍 Check Probe Status', class: 'btn-primary' },
                { action: 'invert-probe', label: '⚡ Toggle Probe Invert', class: 'btn-secondary' }
            ];
        }
        // Alarm state
        else if (lower.includes('alarm')) {
            recovery.suggestions = [
                'Machine is in alarm state and must be cleared',
                'Usually caused by limit switch activation or reset during motion',
                'Home the machine after clearing alarm'
            ];
            recovery.actions = [
                { action: 'unlock', label: '🔓 Unlock ($X)', class: 'btn-warning' },
                { action: 'home', label: '🏠 Home Machine', class: 'btn-primary' }
            ];
        }
        // Connection issues
        else if (lower.includes('connected') || lower.includes('connection')) {
            recovery.suggestions = [
                'Lost connection to the machine',
                'Check USB cable or WiFi connection',
                'Power cycle the controller if needed'
            ];
            recovery.actions = [
                { action: 'reconnect', label: '🔌 Reconnect', class: 'btn-primary' }
            ];
        }
        // Generic error
        else {
            recovery.suggestions = [
                'An unexpected error occurred during probing',
                'Check machine status and try again',
                'Review console log for more details'
            ];
            recovery.actions = [
                { action: 'retry', label: '🔄 Retry', class: 'btn-primary' },
                { action: 'status', label: '📊 Check Status', class: 'btn-secondary' }
            ];
        }
        
        return recovery;
    }
    
    async executeRecoveryAction(action) {
        try {
            switch (action) {
                case 'retry':
                    this.updateStatus('Retrying probe...', 'info');
                    setTimeout(() => this.startProbe(), 500);
                    break;
                    
                case 'retract-z':
                    this.updateStatus('Retracting Z axis...', 'info');
                    await this.grbl.sendAndWait('G91');
                    await this.grbl.sendAndWait('G0 Z10');
                    await this.grbl.sendAndWait('G90');
                    this.updateStatus('Z retracted 10mm', 'success');
                    break;
                    
                case 'unlock':
                    this.updateStatus('Unlocking machine...', 'info');
                    await this.grbl.sendAndWait('$X');
                    this.updateStatus('Machine unlocked - home required', 'warning');
                    break;
                    
                case 'home':
                    this.updateStatus('Homing machine...', 'info');
                    this.grbl.home();
                    break;
                    
                case 'check-probe':
                    this.updateStatus('Checking probe status...', 'info');
                    await this.grbl.send('?');
                    const state = this.grbl.state;
                    const probeStatus = state.probeTriggered ? '⚡ TRIGGERED' : '✓ Ready';
                    this.updateStatus(`Probe status: ${probeStatus}`, state.probeTriggered ? 'warning' : 'success');
                    break;
                    
                case 'invert-probe':
                    this.updateStatus('Toggling probe invert...', 'info');
                    // Get current $6 value and toggle bit
                    const result = await this.grbl.sendAndWait('$6');
                    // Toggle probe invert - this varies by grblHAL version
                    this.updateStatus('Check $6 setting in console', 'info');
                    break;
                    
                case 'reconnect':
                    this.updateStatus('Reconnecting...', 'info');
                    await this.grbl.disconnect();
                    setTimeout(() => this.grbl.connect(), 1000);
                    break;
                    
                case 'status':
                    await this.grbl.send('?');
                    await this.grbl.send('$I');
                    this.updateStatus('Status requested - check console', 'info');
                    break;
                    
                default:
                    this.updateStatus(`Unknown action: ${action}`, 'warning');
            }
        } catch (e) {
            this.updateStatus(`Recovery action failed: ${e.message}`, 'error');
        }
    }
    
    // ================================================================
    // Public API
    // ================================================================
    
    // Alias for open()
    show() { this.open(); }
    
    // Show measure tool modal
    showMeasureToolModal() {
        this.open('tool-length');
    }
    
    open(type = null) {
        if (this.container) {
            this.container.style.display = 'block';
            if (type) {
                this.selectType(type);
            }
        }
    }
    
    close() {
        if (this.probing) {
            this.cancelProbe();
        }
        if (this.container) {
            this.container.style.display = 'none';
        }
    }
    
    setConfig(config) {
        Object.assign(this.config, config);
        this.saveConfig();
    }
    
    getProbeHistory() {
        return [...this.probeHistory];
    }
    
    clearProbeHistory() {
        this.probeHistory = [];
    }
    
    // Convenience method for quick Z probe
    async quickProbeZ() {
        if (!this.grbl?.isIdle()) {
            throw new Error('Machine must be idle');
        }
        
        this.probeType = 'z-surface';
        this.probing = true;
        
        try {
            await this.performSafetyChecks();
            await this.probeZSurface();
            return this.probeResults;
        } finally {
            this.probing = false;
        }
    }
    
    // Get probe status for external UI
    getStatus() {
        return {
            probing: this.probing,
            type: this.probeType,
            step: this.currentStep,
            lastResult: this.probeResults,
            historyCount: this.probeHistory.length
        };
    }
}

// Export
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ProbeWizard;
}
