/* ========================================
   FluidCNC - Parametric Macro System
   User-definable macros with variables,
   expressions, loops, and conditionals
   ======================================== */

class ParametricMacros {
    constructor(grbl, options = {}) {
        this.grbl = grbl;
        
        // Built-in variables
        this.variables = new Map();
        
        // User-defined macros
        this.macros = new Map();
        
        // Execution context
        this.stack = [];
        this.running = false;
        this.aborted = false;
        
        // Event handlers
        this.handlers = {
            log: [],
            error: [],
            complete: [],
            progress: []
        };
        
        // Initialize built-in variables
        this.initBuiltInVariables();
        
        // Load saved macros
        this.loadMacros();
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
    
    log(message) {
        this.emit('log', message);
        console.log('[Macro]', message);
    }
    
    // ================================================================
    // Variables
    // ================================================================
    
    initBuiltInVariables() {
        // Machine-related (read-only, updated from grbl state)
        this.variables.set('_x', () => this.grbl?.state?.wpos?.x ?? 0);
        this.variables.set('_y', () => this.grbl?.state?.wpos?.y ?? 0);
        this.variables.set('_z', () => this.grbl?.state?.wpos?.z ?? 0);
        this.variables.set('_mx', () => this.grbl?.state?.mpos?.x ?? 0);
        this.variables.set('_my', () => this.grbl?.state?.mpos?.y ?? 0);
        this.variables.set('_mz', () => this.grbl?.state?.mpos?.z ?? 0);
        this.variables.set('_feed', () => this.grbl?.state?.feedRate ?? 0);
        this.variables.set('_spindle', () => this.grbl?.state?.spindleSpeed ?? 0);
        this.variables.set('_tool', () => this.grbl?.state?.tool ?? 0);
        this.variables.set('_status', () => this.grbl?.state?.status ?? 'Unknown');
        
        // Probe results
        this.variables.set('_probe_x', () => this.grbl?.probeResult?.x ?? 0);
        this.variables.set('_probe_y', () => this.grbl?.probeResult?.y ?? 0);
        this.variables.set('_probe_z', () => this.grbl?.probeResult?.z ?? 0);
        this.variables.set('_probe_success', () => this.grbl?.probeResult?.success ?? false);
        
        // Math constants
        this.variables.set('PI', Math.PI);
        this.variables.set('E', Math.E);
        this.variables.set('SQRT2', Math.SQRT2);
        
        // Common CNC values
        this.variables.set('SAFE_Z', 5);
        this.variables.set('RAPID_Z', 2);
        this.variables.set('DEFAULT_FEED', 1000);
        this.variables.set('DEFAULT_PLUNGE', 300);
    }
    
    getVariable(name) {
        const value = this.variables.get(name);
        if (typeof value === 'function') {
            return value();
        }
        return value ?? 0;
    }
    
    setVariable(name, value) {
        // Don't allow overwriting system variables
        if (name.startsWith('_')) {
            throw new Error(`Cannot modify system variable: ${name}`);
        }
        this.variables.set(name, value);
    }
    
    // ================================================================
    // Expression Evaluation
    // ================================================================
    
    /**
     * Evaluate a mathematical expression with variables
     */
    evaluate(expression) {
        // Replace variables with values
        let expr = expression.replace(/#(\w+)/g, (match, varName) => {
            const value = this.getVariable(varName);
            return typeof value === 'number' ? value : 0;
        });
        
        // Replace functions
        expr = expr.replace(/\b(sin|cos|tan|asin|acos|atan|atan2|sqrt|abs|floor|ceil|round|min|max|pow|log|exp)\b/g, 'Math.$1');
        
        // Safe evaluation
        try {
            // Only allow safe characters
            if (!/^[\d\s+\-*/%().Math,a-z]+$/i.test(expr)) {
                throw new Error('Invalid expression');
            }
            return new Function('return ' + expr)();
        } catch (e) {
            throw new Error(`Expression error: ${expression} - ${e.message}`);
        }
    }
    
    /**
     * Evaluate a condition (returns boolean)
     */
    evaluateCondition(condition) {
        // Replace comparison operators
        let cond = condition
            .replace(/==/g, '===')
            .replace(/!=/g, '!==')
            .replace(/\bAND\b/gi, '&&')
            .replace(/\bOR\b/gi, '||')
            .replace(/\bNOT\b/gi, '!');
        
        // Replace variables
        cond = cond.replace(/#(\w+)/g, (match, varName) => {
            const value = this.getVariable(varName);
            return typeof value === 'number' ? value : `"${value}"`;
        });
        
        try {
            return new Function('return Boolean(' + cond + ')')();
        } catch (e) {
            throw new Error(`Condition error: ${condition} - ${e.message}`);
        }
    }
    
    // ================================================================
    // Macro Definition
    // ================================================================
    
    /**
     * Define a new macro
     */
    defineMacro(name, config) {
        const macro = {
            name,
            description: config.description || '',
            icon: config.icon || '⚙️',
            category: config.category || 'Custom',
            
            // Parameters with defaults and validation
            parameters: (config.parameters || []).map(p => ({
                name: p.name,
                label: p.label || p.name,
                type: p.type || 'number',
                default: p.default ?? 0,
                min: p.min,
                max: p.max,
                step: p.step || (p.type === 'number' ? 0.1 : 1),
                unit: p.unit || '',
                options: p.options, // For select type
                required: p.required ?? false
            })),
            
            // The macro code (array of lines)
            code: config.code || [],
            
            // Metadata
            author: config.author || 'User',
            version: config.version || '1.0',
            created: config.created || Date.now(),
            modified: Date.now()
        };
        
        this.macros.set(name, macro);
        this.saveMacros();
        
        return macro;
    }
    
    /**
     * Get macro by name
     */
    getMacro(name) {
        return this.macros.get(name);
    }
    
    /**
     * Get all macros
     */
    getAllMacros() {
        return Array.from(this.macros.values());
    }
    
    /**
     * Get macros by category
     */
    getMacrosByCategory(category) {
        return this.getAllMacros().filter(m => m.category === category);
    }
    
    /**
     * Delete macro
     */
    deleteMacro(name) {
        this.macros.delete(name);
        this.saveMacros();
    }
    
    // ================================================================
    // Macro Execution
    // ================================================================
    
    /**
     * Execute a macro with parameters
     */
    async execute(macroName, params = {}) {
        const macro = this.macros.get(macroName);
        if (!macro) {
            throw new Error(`Macro not found: ${macroName}`);
        }
        
        return this.executeCode(macro.code, params, macro.parameters);
    }
    
    /**
     * Execute macro code directly
     */
    async executeCode(code, params = {}, paramDefs = []) {
        this.running = true;
        this.aborted = false;
        
        // Set up parameter variables
        for (const def of paramDefs) {
            const value = params[def.name] ?? def.default;
            this.setVariable(def.name, value);
        }
        
        // Also set any additional params
        for (const [key, value] of Object.entries(params)) {
            if (!key.startsWith('_')) {
                this.setVariable(key, value);
            }
        }
        
        const lines = Array.isArray(code) ? code : code.split('\n');
        const totalLines = lines.length;
        
        try {
            let lineNum = 0;
            
            while (lineNum < lines.length && !this.aborted) {
                const line = lines[lineNum].trim();
                lineNum++;
                
                this.emit('progress', { line: lineNum, total: totalLines });
                
                // Skip empty lines and comments
                if (!line || line.startsWith(';') || line.startsWith('//')) {
                    continue;
                }
                
                // Parse and execute the line
                const result = await this.executeLine(line, lines, lineNum - 1);
                
                if (result?.jump !== undefined) {
                    lineNum = result.jump;
                }
                if (result?.exit) {
                    break;
                }
            }
            
            this.emit('complete', { success: !this.aborted });
            
        } catch (error) {
            this.emit('error', error);
            throw error;
            
        } finally {
            this.running = false;
        }
    }
    
    /**
     * Execute a single line
     */
    async executeLine(line, allLines, currentIndex) {
        // Variable assignment: VAR name = expression
        const varMatch = line.match(/^VAR\s+(\w+)\s*=\s*(.+)$/i);
        if (varMatch) {
            const [, name, expr] = varMatch;
            const value = this.evaluate(expr);
            this.setVariable(name, value);
            this.log(`${name} = ${value}`);
            return;
        }
        
        // IF statement: IF condition THEN command
        const ifMatch = line.match(/^IF\s+(.+?)\s+THEN\s+(.+)$/i);
        if (ifMatch) {
            const [, condition, command] = ifMatch;
            if (this.evaluateCondition(condition)) {
                return this.executeLine(command, allLines, currentIndex);
            }
            return;
        }
        
        // WHILE loop (simple implementation)
        const whileMatch = line.match(/^WHILE\s+(.+?)\s+DO$/i);
        if (whileMatch) {
            const condition = whileMatch[1];
            const endIndex = this.findMatchingEnd(allLines, currentIndex, 'WHILE', 'ENDWHILE');
            
            if (endIndex === -1) {
                throw new Error('Missing ENDWHILE');
            }
            
            const loopBody = allLines.slice(currentIndex + 1, endIndex);
            let iterations = 0;
            const maxIterations = 10000;
            
            while (this.evaluateCondition(condition) && !this.aborted && iterations < maxIterations) {
                await this.executeCode(loopBody, {});
                iterations++;
            }
            
            if (iterations >= maxIterations) {
                throw new Error('Maximum loop iterations exceeded');
            }
            
            return { jump: endIndex + 1 };
        }
        
        // FOR loop: FOR var = start TO end [STEP step] DO
        const forMatch = line.match(/^FOR\s+(\w+)\s*=\s*(.+?)\s+TO\s+(.+?)(?:\s+STEP\s+(.+?))?\s+DO$/i);
        if (forMatch) {
            const [, varName, startExpr, endExpr, stepExpr] = forMatch;
            const start = this.evaluate(startExpr);
            const end = this.evaluate(endExpr);
            const step = stepExpr ? this.evaluate(stepExpr) : (start <= end ? 1 : -1);
            
            const endIndex = this.findMatchingEnd(allLines, currentIndex, 'FOR', 'ENDFOR');
            if (endIndex === -1) {
                throw new Error('Missing ENDFOR');
            }
            
            const loopBody = allLines.slice(currentIndex + 1, endIndex);
            
            for (let i = start; step > 0 ? i <= end : i >= end; i += step) {
                if (this.aborted) break;
                this.setVariable(varName, i);
                await this.executeCode(loopBody, {});
            }
            
            return { jump: endIndex + 1 };
        }
        
        // REPEAT n TIMES
        const repeatMatch = line.match(/^REPEAT\s+(.+?)\s+TIMES$/i);
        if (repeatMatch) {
            const count = Math.floor(this.evaluate(repeatMatch[1]));
            const endIndex = this.findMatchingEnd(allLines, currentIndex, 'REPEAT', 'ENDREPEAT');
            
            if (endIndex === -1) {
                throw new Error('Missing ENDREPEAT');
            }
            
            const loopBody = allLines.slice(currentIndex + 1, endIndex);
            
            for (let i = 0; i < count && !this.aborted; i++) {
                this.setVariable('_iteration', i);
                await this.executeCode(loopBody, {});
            }
            
            return { jump: endIndex + 1 };
        }
        
        // GOSUB call: GOSUB macroName [params]
        const gosubMatch = line.match(/^GOSUB\s+(\w+)(?:\s+(.+))?$/i);
        if (gosubMatch) {
            const [, subName, paramsStr] = gosubMatch;
            const params = paramsStr ? this.parseParams(paramsStr) : {};
            await this.execute(subName, params);
            return;
        }
        
        // WAIT: WAIT seconds | WAIT UNTIL condition
        const waitMatch = line.match(/^WAIT\s+(.+)$/i);
        if (waitMatch) {
            const arg = waitMatch[1];
            
            if (arg.toUpperCase().startsWith('UNTIL ')) {
                const condition = arg.substring(6);
                const timeout = 60000; // 60 second max wait
                const start = Date.now();
                
                while (!this.evaluateCondition(condition) && !this.aborted) {
                    if (Date.now() - start > timeout) {
                        throw new Error('WAIT UNTIL timeout');
                    }
                    await this.delay(100);
                }
            } else {
                const seconds = this.evaluate(arg);
                await this.delay(seconds * 1000);
            }
            return;
        }
        
        // PROBE command
        const probeMatch = line.match(/^PROBE\s+(X|Y|Z)\s+(.+?)(?:\s+FEED\s+(.+))?$/i);
        if (probeMatch) {
            const [, axis, target, feedStr] = probeMatch;
            const targetVal = this.evaluate(target);
            const feed = feedStr ? this.evaluate(feedStr) : 100;
            
            await this.grbl?.sendAndWait(`G38.2 ${axis}${targetVal} F${feed}`);
            return;
        }
        
        // MSG: Display message
        const msgMatch = line.match(/^MSG\s+"(.+)"$/i);
        if (msgMatch) {
            this.log(this.interpolateString(msgMatch[1]));
            return;
        }
        
        // PAUSE: Pause execution
        if (line.toUpperCase() === 'PAUSE') {
            this.log('Paused - press resume to continue');
            // In real implementation, this would wait for user input
            return;
        }
        
        // EXIT: Exit macro
        if (line.toUpperCase() === 'EXIT') {
            return { exit: true };
        }
        
        // Skip control keywords (they're handled by their start line)
        if (/^(ENDWHILE|ENDFOR|ENDREPEAT|ELSE|ENDIF)$/i.test(line)) {
            return;
        }
        
        // Otherwise, treat as G-code (with variable substitution)
        const gcode = this.interpolateGCode(line);
        this.log(`> ${gcode}`);
        
        if (this.grbl?.connected) {
            await this.grbl.sendAndWait(gcode);
        }
    }
    
    /**
     * Find matching END statement
     */
    findMatchingEnd(lines, startIndex, startKeyword, endKeyword) {
        let depth = 1;
        
        for (let i = startIndex + 1; i < lines.length; i++) {
            const line = lines[i].trim().toUpperCase();
            
            if (line.startsWith(startKeyword + ' ') || line === startKeyword) {
                depth++;
            } else if (line === endKeyword) {
                depth--;
                if (depth === 0) return i;
            }
        }
        
        return -1;
    }
    
    /**
     * Parse parameter string into object
     */
    parseParams(str) {
        const params = {};
        const matches = str.matchAll(/(\w+)\s*=\s*([^\s,]+)/g);
        
        for (const match of matches) {
            params[match[1]] = this.evaluate(match[2]);
        }
        
        return params;
    }
    
    /**
     * Interpolate variables in a string
     */
    interpolateString(str) {
        return str.replace(/#(\w+)/g, (match, varName) => {
            return String(this.getVariable(varName));
        });
    }
    
    /**
     * Interpolate variables in G-code
     */
    interpolateGCode(line) {
        // Replace [expression] with evaluated value
        return line.replace(/\[([^\]]+)\]/g, (match, expr) => {
            const value = this.evaluate(expr);
            return typeof value === 'number' ? value.toFixed(3) : value;
        }).replace(/#(\w+)/g, (match, varName) => {
            const value = this.getVariable(varName);
            return typeof value === 'number' ? value.toFixed(3) : value;
        });
    }
    
    /**
     * Delay helper
     */
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
    
    /**
     * Abort execution
     */
    abort() {
        this.aborted = true;
        this.emit('log', 'Macro aborted');
    }
    
    // ================================================================
    // Storage
    // ================================================================
    
    saveMacros() {
        try {
            const data = {};
            for (const [name, macro] of this.macros) {
                data[name] = macro;
            }
            localStorage.setItem('fluidcnc-macros', JSON.stringify(data));
        } catch (e) {
            console.warn('Failed to save macros:', e);
        }
    }
    
    loadMacros() {
        try {
            const saved = localStorage.getItem('fluidcnc-macros');
            if (saved) {
                const data = JSON.parse(saved);
                for (const [name, macro] of Object.entries(data)) {
                    this.macros.set(name, macro);
                }
            }
        } catch (e) {
            console.warn('Failed to load macros:', e);
        }
        
        // Add built-in example macros
        this.addBuiltInMacros();
    }
    
    addBuiltInMacros() {
        // Center finder
        if (!this.macros.has('CenterFinder')) {
            this.defineMacro('CenterFinder', {
                description: 'Find center of a bore using probe',
                icon: '🎯',
                category: 'Probing',
                parameters: [
                    { name: 'BORE_DIA', label: 'Bore Diameter', type: 'number', default: 25, unit: 'mm' },
                    { name: 'PROBE_DEPTH', label: 'Probe Depth', type: 'number', default: -5, unit: 'mm' },
                    { name: 'PROBE_FEED', label: 'Probe Feed', type: 'number', default: 100, unit: 'mm/min' }
                ],
                code: [
                    '; Center Finder Macro',
                    'VAR RETRACT = 2',
                    'VAR HALF = #BORE_DIA / 2 - 2',
                    '',
                    '; Probe X-',
                    'G0 X-#HALF',
                    'G38.2 X-50 F#PROBE_FEED',
                    'VAR X1 = #_probe_x',
                    'G0 X[#_probe_x + #RETRACT]',
                    '',
                    '; Probe X+',
                    'G0 X#HALF',
                    'G38.2 X50 F#PROBE_FEED',
                    'VAR X2 = #_probe_x',
                    'G0 X[#_probe_x - #RETRACT]',
                    '',
                    '; Move to X center',
                    'VAR CENTER_X = (#X1 + #X2) / 2',
                    'G0 X#CENTER_X',
                    '',
                    '; Probe Y-',
                    'G0 Y-#HALF',
                    'G38.2 Y-50 F#PROBE_FEED',
                    'VAR Y1 = #_probe_y',
                    'G0 Y[#_probe_y + #RETRACT]',
                    '',
                    '; Probe Y+',
                    'G0 Y#HALF',
                    'G38.2 Y50 F#PROBE_FEED',
                    'VAR Y2 = #_probe_y',
                    'G0 Y[#_probe_y - #RETRACT]',
                    '',
                    '; Move to Y center',
                    'VAR CENTER_Y = (#Y1 + #Y2) / 2',
                    'G0 Y#CENTER_Y',
                    '',
                    'MSG "Center found at X#CENTER_X Y#CENTER_Y"',
                    'MSG "Measured diameter: [#X2 - #X1] x [#Y2 - #Y1]"'
                ]
            });
        }
        
        // Grid pattern
        if (!this.macros.has('GridPattern')) {
            this.defineMacro('GridPattern', {
                description: 'Create a grid of holes',
                icon: '⊞',
                category: 'Machining',
                parameters: [
                    { name: 'ROWS', label: 'Rows', type: 'number', default: 3, min: 1, step: 1 },
                    { name: 'COLS', label: 'Columns', type: 'number', default: 3, min: 1, step: 1 },
                    { name: 'SPACING_X', label: 'X Spacing', type: 'number', default: 20, unit: 'mm' },
                    { name: 'SPACING_Y', label: 'Y Spacing', type: 'number', default: 20, unit: 'mm' },
                    { name: 'DEPTH', label: 'Hole Depth', type: 'number', default: 5, unit: 'mm' },
                    { name: 'FEED', label: 'Plunge Feed', type: 'number', default: 200, unit: 'mm/min' },
                    { name: 'SAFE_Z', label: 'Safe Z', type: 'number', default: 5, unit: 'mm' }
                ],
                code: [
                    '; Grid Pattern Macro',
                    'VAR START_X = #_x',
                    'VAR START_Y = #_y',
                    '',
                    'G0 Z#SAFE_Z',
                    '',
                    'FOR row = 0 TO [#ROWS - 1] DO',
                    '  FOR col = 0 TO [#COLS - 1] DO',
                    '    VAR X_POS = #START_X + #col * #SPACING_X',
                    '    VAR Y_POS = #START_Y + #row * #SPACING_Y',
                    '    G0 X#X_POS Y#Y_POS',
                    '    G1 Z-#DEPTH F#FEED',
                    '    G0 Z#SAFE_Z',
                    '  ENDFOR',
                    'ENDFOR',
                    '',
                    'G0 X#START_X Y#START_Y',
                    'MSG "Grid complete: [#ROWS * #COLS] holes"'
                ]
            });
        }
        
        // Circular pocket
        if (!this.macros.has('CircularPocket')) {
            this.defineMacro('CircularPocket', {
                description: 'Mill a circular pocket',
                icon: '⭕',
                category: 'Machining',
                parameters: [
                    { name: 'DIAMETER', label: 'Pocket Diameter', type: 'number', default: 30, unit: 'mm' },
                    { name: 'DEPTH', label: 'Total Depth', type: 'number', default: 5, unit: 'mm' },
                    { name: 'STEP_DOWN', label: 'Step Down', type: 'number', default: 1, unit: 'mm' },
                    { name: 'TOOL_DIA', label: 'Tool Diameter', type: 'number', default: 6, unit: 'mm' },
                    { name: 'STEP_OVER', label: 'Step Over %', type: 'number', default: 40, min: 10, max: 90 },
                    { name: 'FEED', label: 'Feed Rate', type: 'number', default: 1000, unit: 'mm/min' },
                    { name: 'PLUNGE', label: 'Plunge Rate', type: 'number', default: 300, unit: 'mm/min' }
                ],
                code: [
                    '; Circular Pocket Macro',
                    'VAR CENTER_X = #_x',
                    'VAR CENTER_Y = #_y',
                    'VAR RADIUS = #DIAMETER / 2',
                    'VAR STEP_OVER_MM = #TOOL_DIA * #STEP_OVER / 100',
                    'VAR NUM_RINGS = ceil((#RADIUS - #TOOL_DIA / 2) / #STEP_OVER_MM)',
                    'VAR CURRENT_Z = 0',
                    '',
                    'G0 Z5',
                    '',
                    'WHILE #CURRENT_Z > -#DEPTH DO',
                    '  VAR CURRENT_Z = max(#CURRENT_Z - #STEP_DOWN, -#DEPTH)',
                    '  ',
                    '  ; Plunge at center',
                    '  G0 X#CENTER_X Y#CENTER_Y',
                    '  G1 Z#CURRENT_Z F#PLUNGE',
                    '  ',
                    '  ; Spiral outward',
                    '  FOR ring = 1 TO #NUM_RINGS DO',
                    '    VAR RING_RADIUS = min(#ring * #STEP_OVER_MM, #RADIUS - #TOOL_DIA / 2)',
                    '    ; Move to ring start',
                    '    G1 X[#CENTER_X + #RING_RADIUS] Y#CENTER_Y F#FEED',
                    '    ; Full circle',
                    '    G2 X[#CENTER_X + #RING_RADIUS] Y#CENTER_Y I-#RING_RADIUS J0 F#FEED',
                    '  ENDFOR',
                    '  ',
                    'ENDWHILE',
                    '',
                    'G0 Z5',
                    'G0 X#CENTER_X Y#CENTER_Y',
                    'MSG "Circular pocket complete"'
                ]
            });
        }
    }
    
    // ================================================================
    // Import/Export
    // ================================================================
    
    exportMacro(name) {
        const macro = this.macros.get(name);
        if (!macro) return null;
        
        return JSON.stringify(macro, null, 2);
    }
    
    exportAllMacros() {
        const data = {};
        for (const [name, macro] of this.macros) {
            data[name] = macro;
        }
        return JSON.stringify(data, null, 2);
    }
    
    importMacro(json) {
        try {
            const macro = typeof json === 'string' ? JSON.parse(json) : json;
            if (macro.name && macro.code) {
                this.macros.set(macro.name, macro);
                this.saveMacros();
                return true;
            }
            return false;
        } catch (e) {
            console.error('Failed to import macro:', e);
            return false;
        }
    }
}

// Export
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ParametricMacros;
}
