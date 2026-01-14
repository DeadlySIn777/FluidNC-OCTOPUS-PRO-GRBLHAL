/* ========================================
   FluidCNC - Feeds & Speeds Advisor
   Real-time cutting parameter recommendations
   based on material, tool, and machine limits
   ======================================== */

class FeedsSpeedsAdvisor {
    constructor(grbl, options = {}) {
        this.grbl = grbl;
        
        // Machine specifications (can be overridden)
        this.machine = {
            maxRPM: options.maxRPM || 24000,
            minRPM: options.minRPM || 5000,
            maxFeedXY: options.maxFeedXY || 5000,
            maxFeedZ: options.maxFeedZ || 2000,
            maxPower: options.maxPower || 2.2, // kW
            rigidity: options.rigidity || 0.7, // 0-1 scale
            type: options.machineType || 'router' // router, mill, laser
        };
        
        // Current settings
        this.currentMaterial = null;
        this.currentTool = null;
        this.recommendations = null;
        
        // Event handlers
        this.handlers = {
            recommendation: [],
            warning: [],
            error: []
        };
        
        // Initialize material and tool databases
        this.initMaterialDB();
        this.initToolDB();
        
        // Load custom materials/tools
        this.loadCustomData();
    }
    
    // ================================================================
    // Event handling
    // ================================================================
    
    on(event, handler) {
        if (this.handlers[event]) {
            this.handlers[event].push(handler);
        }
        return this;
    }
    
    emit(event, data) {
        if (this.handlers[event]) {
            this.handlers[event].forEach(h => h(data));
        }
    }
    
    // ================================================================
    // Material Database
    // ================================================================
    
    initMaterialDB() {
        this.materials = {
            // Woods
            'softwood': {
                name: 'Softwood (Pine, Cedar)',
                category: 'Wood',
                sfm: { min: 300, opt: 600, max: 900 },
                chipLoad: { min: 0.08, opt: 0.15, max: 0.25 },
                hardness: 0.2,
                abrasive: false,
                coolant: 'air'
            },
            'hardwood': {
                name: 'Hardwood (Oak, Maple)',
                category: 'Wood',
                sfm: { min: 200, opt: 450, max: 700 },
                chipLoad: { min: 0.05, opt: 0.12, max: 0.20 },
                hardness: 0.4,
                abrasive: false,
                coolant: 'air'
            },
            'plywood': {
                name: 'Plywood / MDF',
                category: 'Wood',
                sfm: { min: 250, opt: 500, max: 800 },
                chipLoad: { min: 0.06, opt: 0.12, max: 0.18 },
                hardness: 0.3,
                abrasive: true,
                coolant: 'air'
            },
            
            // Plastics
            'acrylic': {
                name: 'Acrylic (PMMA)',
                category: 'Plastic',
                sfm: { min: 200, opt: 400, max: 600 },
                chipLoad: { min: 0.05, opt: 0.10, max: 0.15 },
                hardness: 0.25,
                abrasive: false,
                coolant: 'air',
                notes: 'Single flute recommended, avoid melting'
            },
            'hdpe': {
                name: 'HDPE / LDPE',
                category: 'Plastic',
                sfm: { min: 300, opt: 600, max: 900 },
                chipLoad: { min: 0.10, opt: 0.18, max: 0.30 },
                hardness: 0.15,
                abrasive: false,
                coolant: 'air'
            },
            'delrin': {
                name: 'Delrin (POM)',
                category: 'Plastic',
                sfm: { min: 250, opt: 500, max: 750 },
                chipLoad: { min: 0.06, opt: 0.12, max: 0.20 },
                hardness: 0.35,
                abrasive: false,
                coolant: 'air'
            },
            'nylon': {
                name: 'Nylon',
                category: 'Plastic',
                sfm: { min: 200, opt: 400, max: 600 },
                chipLoad: { min: 0.05, opt: 0.10, max: 0.16 },
                hardness: 0.3,
                abrasive: false,
                coolant: 'air'
            },
            'abs': {
                name: 'ABS',
                category: 'Plastic',
                sfm: { min: 300, opt: 500, max: 700 },
                chipLoad: { min: 0.06, opt: 0.12, max: 0.18 },
                hardness: 0.25,
                abrasive: false,
                coolant: 'air'
            },
            'polycarbonate': {
                name: 'Polycarbonate',
                category: 'Plastic',
                sfm: { min: 200, opt: 350, max: 500 },
                chipLoad: { min: 0.04, opt: 0.08, max: 0.12 },
                hardness: 0.4,
                abrasive: false,
                coolant: 'air'
            },
            
            // Aluminum & Alloys
            'aluminum-6061': {
                name: 'Aluminum 6061',
                category: 'Aluminum',
                sfm: { min: 300, opt: 500, max: 800 },
                chipLoad: { min: 0.02, opt: 0.05, max: 0.10 },
                hardness: 0.5,
                abrasive: false,
                coolant: 'flood',
                notes: 'HSS or carbide, use cutting fluid'
            },
            'aluminum-7075': {
                name: 'Aluminum 7075',
                category: 'Aluminum',
                sfm: { min: 250, opt: 400, max: 600 },
                chipLoad: { min: 0.02, opt: 0.04, max: 0.08 },
                hardness: 0.6,
                abrasive: false,
                coolant: 'flood'
            },
            'aluminum-cast': {
                name: 'Cast Aluminum',
                category: 'Aluminum',
                sfm: { min: 200, opt: 350, max: 500 },
                chipLoad: { min: 0.015, opt: 0.035, max: 0.06 },
                hardness: 0.55,
                abrasive: true,
                coolant: 'flood'
            },
            
            // Brass & Copper
            'brass': {
                name: 'Brass',
                category: 'Copper Alloys',
                sfm: { min: 200, opt: 350, max: 500 },
                chipLoad: { min: 0.02, opt: 0.04, max: 0.08 },
                hardness: 0.45,
                abrasive: false,
                coolant: 'flood'
            },
            'copper': {
                name: 'Copper',
                category: 'Copper Alloys',
                sfm: { min: 150, opt: 250, max: 350 },
                chipLoad: { min: 0.015, opt: 0.03, max: 0.05 },
                hardness: 0.4,
                abrasive: false,
                coolant: 'flood',
                notes: 'Gummy material, sharp tools required'
            },
            'bronze': {
                name: 'Bronze',
                category: 'Copper Alloys',
                sfm: { min: 100, opt: 200, max: 300 },
                chipLoad: { min: 0.015, opt: 0.03, max: 0.05 },
                hardness: 0.55,
                abrasive: false,
                coolant: 'flood'
            },
            
            // Steels
            'mild-steel': {
                name: 'Mild Steel (1018)',
                category: 'Steel',
                sfm: { min: 60, opt: 100, max: 150 },
                chipLoad: { min: 0.01, opt: 0.025, max: 0.05 },
                hardness: 0.7,
                abrasive: false,
                coolant: 'flood',
                notes: 'Carbide tools recommended'
            },
            'stainless-304': {
                name: 'Stainless 304',
                category: 'Steel',
                sfm: { min: 40, opt: 80, max: 120 },
                chipLoad: { min: 0.008, opt: 0.02, max: 0.04 },
                hardness: 0.8,
                abrasive: false,
                coolant: 'flood',
                notes: 'Work hardening - maintain chip load'
            },
            
            // Composites
            'carbon-fiber': {
                name: 'Carbon Fiber (CFRP)',
                category: 'Composite',
                sfm: { min: 400, opt: 800, max: 1200 },
                chipLoad: { min: 0.02, opt: 0.05, max: 0.08 },
                hardness: 0.65,
                abrasive: true,
                coolant: 'air',
                notes: 'Diamond or coated carbide, dust extraction required'
            },
            'fiberglass': {
                name: 'Fiberglass (GFRP)',
                category: 'Composite',
                sfm: { min: 300, opt: 600, max: 900 },
                chipLoad: { min: 0.03, opt: 0.06, max: 0.10 },
                hardness: 0.5,
                abrasive: true,
                coolant: 'air'
            },
            'g10-fr4': {
                name: 'G10 / FR4',
                category: 'Composite',
                sfm: { min: 200, opt: 400, max: 600 },
                chipLoad: { min: 0.02, opt: 0.04, max: 0.08 },
                hardness: 0.55,
                abrasive: true,
                coolant: 'air'
            },
            
            // Foam & Soft Materials
            'foam-eps': {
                name: 'EPS Foam',
                category: 'Foam',
                sfm: { min: 500, opt: 1000, max: 2000 },
                chipLoad: { min: 0.2, opt: 0.4, max: 0.8 },
                hardness: 0.05,
                abrasive: false,
                coolant: 'none'
            },
            'foam-pu': {
                name: 'PU Foam / Renshape',
                category: 'Foam',
                sfm: { min: 400, opt: 800, max: 1500 },
                chipLoad: { min: 0.15, opt: 0.3, max: 0.5 },
                hardness: 0.1,
                abrasive: false,
                coolant: 'none'
            }
        };
    }
    
    // ================================================================
    // Tool Database
    // ================================================================
    
    initToolDB() {
        this.tools = {
            // Flat End Mills
            'endmill-1f': {
                name: 'Single Flute End Mill',
                category: 'End Mill',
                flutes: 1,
                helix: 30,
                coating: 'uncoated',
                bestFor: ['plastic', 'aluminum', 'soft materials'],
                sfmMultiplier: 1.0
            },
            'endmill-2f': {
                name: 'Two Flute End Mill',
                category: 'End Mill',
                flutes: 2,
                helix: 30,
                coating: 'uncoated',
                bestFor: ['aluminum', 'wood', 'plastic'],
                sfmMultiplier: 1.0
            },
            'endmill-3f': {
                name: 'Three Flute End Mill',
                category: 'End Mill',
                flutes: 3,
                helix: 35,
                coating: 'AlTiN',
                bestFor: ['aluminum', 'brass', 'mild steel'],
                sfmMultiplier: 1.1
            },
            'endmill-4f': {
                name: 'Four Flute End Mill',
                category: 'End Mill',
                flutes: 4,
                helix: 30,
                coating: 'TiN',
                bestFor: ['steel', 'cast iron', 'hard materials'],
                sfmMultiplier: 0.9
            },
            
            // Ball End Mills
            'ballmill-2f': {
                name: 'Two Flute Ball Mill',
                category: 'Ball Mill',
                flutes: 2,
                helix: 30,
                coating: 'uncoated',
                bestFor: ['3D contouring', 'wood', 'plastic'],
                sfmMultiplier: 0.9
            },
            
            // Specialty
            'vbit-60': {
                name: '60° V-Bit',
                category: 'V-Bit',
                angle: 60,
                flutes: 2,
                coating: 'uncoated',
                bestFor: ['engraving', 'chamfers', 'v-carve'],
                sfmMultiplier: 0.8
            },
            'vbit-90': {
                name: '90° V-Bit',
                category: 'V-Bit',
                angle: 90,
                flutes: 2,
                coating: 'uncoated',
                bestFor: ['chamfers', 'v-carve', 'engraving'],
                sfmMultiplier: 0.8
            },
            'compression': {
                name: 'Compression Cutter',
                category: 'End Mill',
                flutes: 2,
                helix: 45,
                coating: 'uncoated',
                bestFor: ['plywood', 'laminate', 'melamine'],
                sfmMultiplier: 0.85
            },
            'downcut': {
                name: 'Downcut End Mill',
                category: 'End Mill',
                flutes: 2,
                helix: -30,
                coating: 'uncoated',
                bestFor: ['top surface finish', 'thin materials'],
                sfmMultiplier: 0.9
            },
            'upcut': {
                name: 'Upcut End Mill',
                category: 'End Mill',
                flutes: 2,
                helix: 30,
                coating: 'uncoated',
                bestFor: ['chip evacuation', 'deep pockets'],
                sfmMultiplier: 1.0
            },
            
            // Drill Bits
            'drill-hss': {
                name: 'HSS Drill Bit',
                category: 'Drill',
                flutes: 2,
                coating: 'uncoated',
                bestFor: ['wood', 'plastic', 'aluminum'],
                sfmMultiplier: 0.7
            },
            'drill-carbide': {
                name: 'Carbide Drill Bit',
                category: 'Drill',
                flutes: 2,
                coating: 'TiN',
                bestFor: ['steel', 'stainless', 'hard materials'],
                sfmMultiplier: 1.2
            }
        };
    }
    
    // ================================================================
    // Calculation Engine
    // ================================================================
    
    /**
     * Calculate recommended feeds and speeds
     */
    calculate(materialId, toolType, toolDiameter, options = {}) {
        const material = this.materials[materialId];
        const tool = this.tools[toolType];
        
        if (!material || !tool) {
            throw new Error('Invalid material or tool selection');
        }
        
        // Validate tool diameter to prevent division by zero
        if (!toolDiameter || toolDiameter <= 0 || !isFinite(toolDiameter)) {
            throw new Error('Tool diameter must be a positive number');
        }
        
        this.currentMaterial = material;
        this.currentTool = { ...tool, diameter: toolDiameter };
        
        // Calculate with formula:
        // RPM = SFM × 3.82 / Diameter (for inch) or SFM × 318.3 / Diameter (for mm)
        const sfm = material.sfm.opt * tool.sfmMultiplier;
        const rpmCalc = (sfm * 318.3) / toolDiameter;
        
        // Apply machine limits
        let rpm = Math.round(this.clamp(rpmCalc, this.machine.minRPM, this.machine.maxRPM));
        
        // Calculate chip load based on tool diameter
        let chipLoad = material.chipLoad.opt;
        if (toolDiameter < 3) {
            chipLoad *= 0.6; // Smaller tools need smaller chip load
        } else if (toolDiameter < 6) {
            chipLoad *= 0.8;
        } else if (toolDiameter > 12) {
            chipLoad *= 1.2; // Larger tools can handle more
        }
        
        // Adjust for machine rigidity
        chipLoad *= this.machine.rigidity;
        
        // Calculate feed rate: Feed = RPM × Flutes × Chip Load
        const flutes = tool.flutes || 2;
        let feedRate = Math.round(rpm * flutes * chipLoad);
        
        // Apply machine limits
        feedRate = Math.min(feedRate, this.machine.maxFeedXY);
        
        // Calculate depth of cut (DOC) and width of cut (WOC)
        const docSlotting = toolDiameter * 0.5 * this.machine.rigidity;
        const docProfiling = toolDiameter * 1.5 * this.machine.rigidity;
        const wocSlotting = toolDiameter;
        const wocProfiling = toolDiameter * 0.4;
        
        // Plunge rate
        const plungeRate = Math.round(feedRate * 0.3);
        
        // Create recommendations object
        this.recommendations = {
            material: material.name,
            tool: tool.name,
            diameter: toolDiameter,
            flutes: flutes,
            
            // Primary recommendations
            rpm: rpm,
            feedRate: feedRate,
            plungeRate: plungeRate,
            chipLoad: chipLoad.toFixed(3),
            
            // Depth parameters
            slotting: {
                doc: Math.round(docSlotting * 10) / 10,
                woc: wocSlotting
            },
            profiling: {
                doc: Math.round(docProfiling * 10) / 10,
                woc: Math.round(wocProfiling * 10) / 10
            },
            
            // Ranges for UI
            rpmRange: {
                min: Math.round(this.clamp((material.sfm.min * 318.3) / toolDiameter, this.machine.minRPM, this.machine.maxRPM)),
                max: Math.round(this.clamp((material.sfm.max * 318.3) / toolDiameter, this.machine.minRPM, this.machine.maxRPM))
            },
            feedRange: {
                min: Math.round(rpm * flutes * material.chipLoad.min * this.machine.rigidity),
                max: Math.round(Math.min(rpm * flutes * material.chipLoad.max * this.machine.rigidity, this.machine.maxFeedXY))
            },
            
            // Additional info
            coolant: material.coolant,
            notes: material.notes || '',
            warnings: this.generateWarnings(material, tool, rpm, feedRate)
        };
        
        this.emit('recommendation', this.recommendations);
        return this.recommendations;
    }
    
    /**
     * Validate current machine settings against recommendations
     */
    validateCurrentSettings() {
        if (!this.recommendations || !this.grbl?.state) {
            return null;
        }
        
        const currentRPM = this.grbl.state.spindleSpeed || 0;
        const currentFeed = this.grbl.state.feedRate || 0;
        const rec = this.recommendations;
        
        const issues = [];
        
        // Check RPM
        if (currentRPM > 0) {
            if (currentRPM < rec.rpmRange.min * 0.8) {
                issues.push({
                    type: 'warning',
                    param: 'rpm',
                    message: `RPM too low (${currentRPM}). Recommended: ${rec.rpmRange.min}-${rec.rpmRange.max}`,
                    suggestion: `Increase spindle speed to ${rec.rpm} RPM`
                });
            } else if (currentRPM > rec.rpmRange.max * 1.2) {
                issues.push({
                    type: 'warning',
                    param: 'rpm',
                    message: `RPM too high (${currentRPM}). Risk of burning material.`,
                    suggestion: `Reduce spindle speed to ${rec.rpm} RPM`
                });
            }
        }
        
        // Check Feed Rate
        if (currentFeed > 0) {
            if (currentFeed < rec.feedRange.min * 0.7) {
                issues.push({
                    type: 'warning',
                    param: 'feed',
                    message: `Feed rate too low (${currentFeed}). Rubbing instead of cutting.`,
                    suggestion: `Increase feed to ${rec.feedRate} mm/min`
                });
            } else if (currentFeed > rec.feedRange.max * 1.3) {
                issues.push({
                    type: 'error',
                    param: 'feed',
                    message: `Feed rate too high (${currentFeed}). Risk of tool breakage!`,
                    suggestion: `Reduce feed to ${rec.feedRate} mm/min`
                });
            }
        }
        
        // Calculate actual chip load
        if (currentRPM > 0 && currentFeed > 0) {
            const actualChipLoad = currentFeed / (currentRPM * rec.flutes);
            const matChipLoad = this.currentMaterial.chipLoad;
            
            if (actualChipLoad < matChipLoad.min * 0.5) {
                issues.push({
                    type: 'info',
                    param: 'chipload',
                    message: `Chip load very low (${actualChipLoad.toFixed(4)}mm). Generating heat instead of chips.`,
                    suggestion: 'Increase feed rate or decrease RPM'
                });
            } else if (actualChipLoad > matChipLoad.max * 1.5) {
                issues.push({
                    type: 'error',
                    param: 'chipload',
                    message: `Chip load too high (${actualChipLoad.toFixed(4)}mm). Tool deflection likely!`,
                    suggestion: 'Decrease feed rate or increase RPM'
                });
            }
        }
        
        issues.forEach(issue => this.emit('warning', issue));
        return issues;
    }
    
    /**
     * Generate warnings based on calculations
     */
    generateWarnings(material, tool, rpm, feed) {
        const warnings = [];
        
        // Check if tool is suitable for material
        const isSuitable = tool.bestFor.some(m => 
            material.category.toLowerCase().includes(m) || 
            material.name.toLowerCase().includes(m)
        );
        
        if (!isSuitable) {
            warnings.push(`This tool type may not be ideal for ${material.name}`);
        }
        
        // Abrasive material warning
        if (material.abrasive) {
            warnings.push('Abrasive material - carbide or coated tools recommended');
        }
        
        // Coolant recommendations
        if (material.coolant === 'flood' && this.machine.type === 'router') {
            warnings.push('Flood coolant recommended - consider mist or WD-40');
        }
        
        // Machine limits hit
        if (rpm === this.machine.maxRPM) {
            warnings.push('At maximum spindle speed - use larger tool diameter if possible');
        }
        if (rpm === this.machine.minRPM) {
            warnings.push('At minimum spindle speed - use smaller tool diameter if possible');
        }
        
        return warnings;
    }
    
    /**
     * Clamp value between min and max
     */
    clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
    }
    
    // ================================================================
    // Material/Tool Management
    // ================================================================
    
    getMaterials() {
        return Object.entries(this.materials).map(([id, mat]) => ({
            id,
            ...mat
        }));
    }
    
    getMaterialsByCategory() {
        const categories = {};
        for (const [id, mat] of Object.entries(this.materials)) {
            if (!categories[mat.category]) {
                categories[mat.category] = [];
            }
            categories[mat.category].push({ id, ...mat });
        }
        return categories;
    }
    
    getTools() {
        return Object.entries(this.tools).map(([id, tool]) => ({
            id,
            ...tool
        }));
    }
    
    addCustomMaterial(id, data) {
        this.materials[id] = data;
        this.saveCustomData();
    }
    
    addCustomTool(id, data) {
        this.tools[id] = data;
        this.saveCustomData();
    }
    
    // ================================================================
    // Storage
    // ================================================================
    
    saveCustomData() {
        try {
            const customMaterials = {};
            const customTools = {};
            
            // Only save non-default entries
            for (const [id, mat] of Object.entries(this.materials)) {
                if (mat.custom) customMaterials[id] = mat;
            }
            for (const [id, tool] of Object.entries(this.tools)) {
                if (tool.custom) customTools[id] = tool;
            }
            
            localStorage.setItem('fluidcnc-fs-materials', JSON.stringify(customMaterials));
            localStorage.setItem('fluidcnc-fs-tools', JSON.stringify(customTools));
        } catch (e) {
            console.warn('Failed to save feeds/speeds data:', e);
        }
    }
    
    loadCustomData() {
        try {
            const materials = localStorage.getItem('fluidcnc-fs-materials');
            const tools = localStorage.getItem('fluidcnc-fs-tools');
            
            if (materials) {
                Object.assign(this.materials, JSON.parse(materials));
            }
            if (tools) {
                Object.assign(this.tools, JSON.parse(tools));
            }
        } catch (e) {
            console.warn('Failed to load feeds/speeds data:', e);
        }
    }
    
    // ================================================================
    // G-code Analysis
    // ================================================================
    
    /**
     * Analyze G-code for feeds/speeds issues
     */
    analyzeGCode(gcode) {
        const lines = gcode.split('\n');
        const issues = [];
        let currentFeed = 0;
        let currentRPM = 0;
        let lineNum = 0;
        
        for (const line of lines) {
            lineNum++;
            const trimmed = line.trim().toUpperCase();
            
            // Extract spindle speed
            const sMatch = trimmed.match(/S(\d+)/);
            if (sMatch) {
                currentRPM = parseInt(sMatch[1]);
            }
            
            // Extract feed rate
            const fMatch = trimmed.match(/F(\d+)/);
            if (fMatch) {
                currentFeed = parseInt(fMatch[1]);
            }
            
            // Check for cutting moves without spindle
            if (/G[123]/.test(trimmed) && !trimmed.startsWith('G0')) {
                if (currentRPM === 0) {
                    issues.push({
                        line: lineNum,
                        type: 'error',
                        message: 'Cutting move without spindle running'
                    });
                }
                if (currentFeed === 0 && !trimmed.includes('F')) {
                    issues.push({
                        line: lineNum,
                        type: 'error',
                        message: 'Cutting move without feed rate'
                    });
                }
            }
            
            // Check for very high feed rates
            if (currentFeed > this.machine.maxFeedXY) {
                issues.push({
                    line: lineNum,
                    type: 'warning',
                    message: `Feed rate ${currentFeed} exceeds machine max ${this.machine.maxFeedXY}`
                });
            }
            
            // Check for very high spindle speeds
            if (currentRPM > this.machine.maxRPM) {
                issues.push({
                    line: lineNum,
                    type: 'warning',
                    message: `Spindle speed ${currentRPM} exceeds machine max ${this.machine.maxRPM}`
                });
            }
        }
        
        return issues;
    }
}

// Export
if (typeof module !== 'undefined' && module.exports) {
    module.exports = FeedsSpeedsAdvisor;
}
