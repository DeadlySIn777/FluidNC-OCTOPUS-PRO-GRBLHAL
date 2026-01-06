/**
 * Conversational G-code Generator (MVP)
 * - Facing with presets
 * - Drilling (single, grid, bolt circle)
 * Generates G-code locally in the browser, previews via existing visualizer.
 */
class ConversationalGCode {
    constructor(options = {}) {
        this.onLoad = options.onLoad || null; // (gcode, filename) => void
        this.onPreview = options.onPreview || null; // (gcode, filename) => void
        this.onUploadToSD = options.onUploadToSD || null; // (filename, gcode) => Promise
        this.onRunFromSD = options.onRunFromSD || null; // (filename) => Promise
        this.notify = options.notify || null; // (msg, type) => void

        this.lastGenerated = { filename: '', gcode: '' };

        this.init();
    }

    init() {
        this.createUI();
        this.addStyles();
        this.bindEvents();
        this.applyPreset('facing', 'default');
        this.updateOperationUI();
    }

    createUI() {
        if (document.getElementById('conversational-panel')) return;

        const controlsGrid = document.querySelector('.controls-grid');
        if (!controlsGrid) return;

        const panel = document.createElement('div');
        panel.className = 'control-panel conversational-panel';
        panel.id = 'conversational-panel';
        panel.innerHTML = `
            <h3>
                <span class="panel-icon">🧰</span>
                Conversational
            </h3>

            <div class="conv-row">
                <label class="conv-label">Operation</label>
                <select id="conv-op" class="conv-select">
                    <option value="facing">Facing</option>
                    <option value="drill">Drill Holes</option>
                </select>
            </div>

            <div class="conv-row" id="conv-preset-row">
                <label class="conv-label">Preset</label>
                <select id="conv-preset" class="conv-select"></select>
            </div>

            <div class="conv-section" id="conv-common">
                <div class="conv-grid">
                    <div class="conv-field">
                        <label>Units</label>
                        <select id="conv-units">
                            <option value="mm">mm (G21)</option>
                            <option value="inch">inch (G20)</option>
                        </select>
                    </div>
                    <div class="conv-field">
                        <label>Safe Z</label>
                        <input id="conv-safez" type="number" step="0.1" value="5">
                    </div>
                    <div class="conv-field">
                        <label>Work Z0</label>
                        <input id="conv-z0" type="number" step="0.1" value="0">
                    </div>
                    <div class="conv-field">
                        <label>Spindle RPM</label>
                        <input id="conv-rpm" type="number" step="100" value="12000">
                    </div>
                    <div class="conv-field">
                        <label>Feed</label>
                        <input id="conv-feed" type="number" step="10" value="2000">
                    </div>
                    <div class="conv-field">
                        <label>Plunge</label>
                        <input id="conv-plunge" type="number" step="10" value="300">
                    </div>
                </div>
            </div>

            <div class="conv-section" id="conv-facing">
                <div class="conv-grid">
                    <div class="conv-field">
                        <label>Start X</label>
                        <input id="face-x" type="number" step="0.1" value="0">
                    </div>
                    <div class="conv-field">
                        <label>Start Y</label>
                        <input id="face-y" type="number" step="0.1" value="0">
                    </div>
                    <div class="conv-field">
                        <label>Width</label>
                        <input id="face-w" type="number" step="0.1" value="100">
                    </div>
                    <div class="conv-field">
                        <label>Height</label>
                        <input id="face-h" type="number" step="0.1" value="100">
                    </div>
                    <div class="conv-field">
                        <label>Tool Ø</label>
                        <input id="face-tool" type="number" step="0.01" value="6.35">
                    </div>
                    <div class="conv-field">
                        <label>Stepover %</label>
                        <input id="face-stepover" type="number" step="1" value="60">
                    </div>
                    <div class="conv-field">
                        <label>Depth</label>
                        <input id="face-depth" type="number" step="0.1" value="-0.5">
                    </div>
                    <div class="conv-field">
                        <label>Pass Depth</label>
                        <input id="face-pass" type="number" step="0.1" value="0.5">
                    </div>
                </div>
            </div>

            <div class="conv-section" id="conv-drill" style="display:none;">
                <div class="conv-row">
                    <label class="conv-label">Pattern</label>
                    <select id="drill-pattern" class="conv-select">
                        <option value="single">Single</option>
                        <option value="grid">Grid</option>
                        <option value="circle">Bolt Circle</option>
                    </select>
                </div>

                <div class="conv-grid">
                    <div class="conv-field">
                        <label>Hole Depth</label>
                        <input id="drill-depth" type="number" step="0.1" value="-5">
                    </div>
                    <div class="conv-field">
                        <label>Retract R</label>
                        <input id="drill-r" type="number" step="0.1" value="2">
                    </div>
                    <div class="conv-field">
                        <label>Start X</label>
                        <input id="drill-x" type="number" step="0.1" value="0">
                    </div>
                    <div class="conv-field">
                        <label>Start Y</label>
                        <input id="drill-y" type="number" step="0.1" value="0">
                    </div>
                </div>

                <div class="conv-grid" id="drill-grid" style="display:none;">
                    <div class="conv-field">
                        <label>Cols</label>
                        <input id="drill-cols" type="number" step="1" min="1" value="3">
                    </div>
                    <div class="conv-field">
                        <label>Rows</label>
                        <input id="drill-rows" type="number" step="1" min="1" value="3">
                    </div>
                    <div class="conv-field">
                        <label>Pitch X</label>
                        <input id="drill-px" type="number" step="0.1" value="20">
                    </div>
                    <div class="conv-field">
                        <label>Pitch Y</label>
                        <input id="drill-py" type="number" step="0.1" value="20">
                    </div>
                </div>

                <div class="conv-grid" id="drill-circle" style="display:none;">
                    <div class="conv-field">
                        <label>Center X</label>
                        <input id="drill-cx" type="number" step="0.1" value="0">
                    </div>
                    <div class="conv-field">
                        <label>Center Y</label>
                        <input id="drill-cy" type="number" step="0.1" value="0">
                    </div>
                    <div class="conv-field">
                        <label>Radius</label>
                        <input id="drill-radius" type="number" step="0.1" value="25">
                    </div>
                    <div class="conv-field">
                        <label>Holes</label>
                        <input id="drill-count" type="number" step="1" min="1" value="6">
                    </div>
                </div>
            </div>

            <div class="conv-actions">
                <button class="btn btn-primary" id="conv-generate">⚙️ Generate</button>
                <button class="btn btn-secondary" id="conv-load" disabled>📡 Load</button>
                <button class="btn btn-secondary" id="conv-upload" disabled>💾 Upload</button>
                <button class="btn btn-success" id="conv-run" disabled>▶️ Run SD</button>
            </div>

            <div class="conv-preview">
                <div class="conv-preview-header">
                    <span class="conv-preview-title">Preview</span>
                    <span class="conv-preview-meta" id="conv-meta"></span>
                </div>
                <pre class="conv-preview-code" id="conv-code">Generate an operation to preview G-code here.</pre>
            </div>
        `;

        // Insert near G-code panel (after it) if possible
        const gcodePanel = document.querySelector('.gcode-panel');
        if (gcodePanel && gcodePanel.nextSibling) {
            controlsGrid.insertBefore(panel, gcodePanel.nextSibling);
        } else {
            controlsGrid.appendChild(panel);
        }

        // Populate presets
        this.populatePresets();
    }

    addStyles() {
        if (document.getElementById('conv-styles')) return;

        const style = document.createElement('style');
        style.id = 'conv-styles';
        style.textContent = `
            .conversational-panel .conv-row {
                display: flex;
                align-items: center;
                gap: 10px;
                margin-bottom: 10px;
            }
            .conversational-panel .conv-label {
                width: 80px;
                color: var(--text-secondary, #888);
                font-size: 0.9em;
            }
            .conversational-panel .conv-select {
                flex: 1;
            }
            .conversational-panel .conv-grid {
                display: grid;
                grid-template-columns: repeat(2, 1fr);
                gap: 10px;
                margin-bottom: 10px;
            }
            .conversational-panel .conv-field label {
                display: block;
                margin-bottom: 4px;
                font-size: 0.85em;
                color: var(--text-secondary, #888);
            }
            .conversational-panel .conv-field input,
            .conversational-panel .conv-field select {
                width: 100%;
            }
            .conversational-panel .conv-actions {
                display: flex;
                gap: 8px;
                flex-wrap: wrap;
                margin: 10px 0;
            }
            .conversational-panel .conv-actions .btn {
                flex: 1;
                min-width: 100px;
            }
            .conversational-panel .conv-preview {
                border: 1px solid var(--border-color, #333);
                border-radius: 6px;
                background: var(--bg-tertiary, #1a1a24);
                overflow: hidden;
            }
            .conversational-panel .conv-preview-header {
                display: flex;
                align-items: center;
                gap: 10px;
                padding: 8px 10px;
                border-bottom: 1px solid var(--border-color, #333);
            }
            .conversational-panel .conv-preview-title {
                font-weight: 600;
            }
            .conversational-panel .conv-preview-meta {
                margin-left: auto;
                font-size: 0.85em;
                color: var(--text-secondary, #888);
            }
            .conversational-panel .conv-preview-code {
                margin: 0;
                padding: 10px;
                max-height: 200px;
                overflow: auto;
                font-family: var(--font-mono, "JetBrains Mono", monospace);
                font-size: 0.8em;
                white-space: pre;
                background: var(--bg-darkest, #0a0a0f);
            }
        `;
        document.head.appendChild(style);
    }

    bindEvents() {
        setTimeout(() => {
            const op = document.getElementById('conv-op');
            const preset = document.getElementById('conv-preset');
            const pattern = document.getElementById('drill-pattern');

            const genBtn = document.getElementById('conv-generate');
            const loadBtn = document.getElementById('conv-load');
            const uploadBtn = document.getElementById('conv-upload');
            const runBtn = document.getElementById('conv-run');

            op?.addEventListener('change', () => {
                this.populatePresets();
                this.updateOperationUI();
                this.applyPreset(op.value, preset?.value || 'default');
            });

            preset?.addEventListener('change', () => {
                this.applyPreset(op?.value || 'facing', preset.value);
            });

            pattern?.addEventListener('change', () => {
                this.updateDrillPatternUI();
            });

            genBtn?.addEventListener('click', () => this.generate());
            loadBtn?.addEventListener('click', () => this.load());
            uploadBtn?.addEventListener('click', () => this.upload());
            runBtn?.addEventListener('click', () => this.runFromSD());

            this.updateDrillPatternUI();
        }, 50);
    }

    populatePresets() {
        const op = document.getElementById('conv-op')?.value || 'facing';
        const presetSelect = document.getElementById('conv-preset');
        if (!presetSelect) return;

        const presets = this.getPresets(op);
        presetSelect.innerHTML = presets.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
    }

    getPresets(op) {
        if (op === 'drill') {
            return [
                { id: 'default', name: 'Default (G81)' },
                { id: 'wood', name: 'Wood (faster)' },
                { id: 'alu', name: 'Aluminum (slower)' }
            ];
        }

        return [
            { id: 'default', name: 'Default 1/4" Endmill' },
            { id: 'wood', name: 'Wood / MDF (rough)' },
            { id: 'alu', name: 'Aluminum (conservative)' }
        ];
    }

    applyPreset(op, presetId) {
        // Common fields
        const set = (id, val) => {
            const el = document.getElementById(id);
            if (el) el.value = val;
        };

        // Defaults
        let rpm = 12000;
        let feed = 2000;
        let plunge = 300;

        if (presetId === 'wood') {
            rpm = 18000;
            feed = op === 'drill' ? 1200 : 3500;
            plunge = 500;
        } else if (presetId === 'alu') {
            rpm = 12000;
            feed = op === 'drill' ? 200 : 800;
            plunge = 100;
        }

        set('conv-rpm', rpm);
        set('conv-feed', feed);
        set('conv-plunge', plunge);

        if (op === 'facing') {
            // Reasonable facing defaults
            if (presetId === 'alu') {
                set('face-pass', 0.2);
                set('face-depth', -0.2);
                set('face-stepover', 40);
            } else {
                set('face-pass', 0.5);
                set('face-depth', -0.5);
                set('face-stepover', 60);
            }
        }
    }

    updateOperationUI() {
        const op = document.getElementById('conv-op')?.value || 'facing';
        const facing = document.getElementById('conv-facing');
        const drill = document.getElementById('conv-drill');

        if (facing) facing.style.display = op === 'facing' ? 'block' : 'none';
        if (drill) drill.style.display = op === 'drill' ? 'block' : 'none';

        this.updateDrillPatternUI();
    }

    updateDrillPatternUI() {
        const op = document.getElementById('conv-op')?.value || 'facing';
        const pattern = document.getElementById('drill-pattern')?.value || 'single';

        const grid = document.getElementById('drill-grid');
        const circle = document.getElementById('drill-circle');

        if (!grid || !circle) return;

        if (op !== 'drill') {
            grid.style.display = 'none';
            circle.style.display = 'none';
            return;
        }

        grid.style.display = pattern === 'grid' ? 'grid' : 'none';
        circle.style.display = pattern === 'circle' ? 'grid' : 'none';
    }

    generate() {
        const op = document.getElementById('conv-op')?.value || 'facing';
        const filename = op === 'facing' ? 'facing.nc' : 'drill.nc';

        const units = document.getElementById('conv-units')?.value || 'mm';
        const safeZ = this.num('conv-safez', 5);
        const z0 = this.num('conv-z0', 0);
        const rpm = this.num('conv-rpm', 12000);
        const feed = this.num('conv-feed', 2000);
        const plunge = this.num('conv-plunge', 300);

        let gcode = [];
        gcode.push('(FluidCNC Conversational)');
        gcode.push(op === 'facing' ? '(Operation: Facing)' : '(Operation: Drill)');
        gcode.push(units === 'inch' ? 'G20' : 'G21');
        gcode.push('G90');
        gcode.push('G17');
        gcode.push('G94');
        gcode.push(`G0 Z${this.fmt(safeZ)}`);
        gcode.push(`M3 S${Math.round(rpm)}`);

        if (op === 'facing') {
            gcode = gcode.concat(this.generateFacing({ safeZ, z0, feed, plunge, units }));
        } else {
            gcode = gcode.concat(this.generateDrill({ safeZ, z0, feed, plunge, units }));
        }

        gcode.push(`G0 Z${this.fmt(safeZ)}`);
        gcode.push('M5');
        gcode.push('M30');

        const text = gcode.join('\n');
        this.lastGenerated = { filename, gcode: text };

        this.renderPreview(text);
        this.enableActions(true);

        if (this.onPreview) {
            this.onPreview(text, filename);
        }

        this.notifyUser('Generated conversational G-code', 'success');
    }

    generateFacing({ safeZ, z0, feed, plunge }) {
        const x0 = this.num('face-x', 0);
        const y0 = this.num('face-y', 0);
        const w = this.num('face-w', 100);
        const h = this.num('face-h', 100);
        const tool = this.num('face-tool', 6.35);
        const stepoverPct = this.num('face-stepover', 60);
        const depthTarget = this.num('face-depth', -0.5);
        const passDepth = Math.abs(this.num('face-pass', 0.5));

        const stepover = Math.max(0.1, tool * (stepoverPct / 100));
        const minX = x0;
        const minY = y0;
        const maxX = x0 + w;
        const maxY = y0 + h;

        // We cut from z0 down to depthTarget (negative)
        const totalDepth = (z0 - depthTarget);
        const passes = Math.max(1, Math.ceil(Math.abs(totalDepth) / passDepth));

        let out = [];
        out.push('(Facing parameters)');
        out.push(`(Area: X${this.fmt(minX)}..${this.fmt(maxX)} Y${this.fmt(minY)}..${this.fmt(maxY)})`);
        out.push(`(Stepover: ${this.fmt(stepover)} / Tool: ${this.fmt(tool)})`);

        for (let p = 1; p <= passes; p++) {
            const z = z0 - (Math.min(p * passDepth, Math.abs(totalDepth)));
            out.push(`(Pass ${p}/${passes} at Z${this.fmt(z)})`);

            // Start at minX,minY
            out.push(`G0 X${this.fmt(minX)} Y${this.fmt(minY)}`);
            out.push(`G1 Z${this.fmt(z)} F${Math.round(plunge)}`);

            let y = minY;
            let dir = 1;
            while (y <= maxY + 1e-6) {
                const xA = dir > 0 ? maxX : minX;
                out.push(`G1 X${this.fmt(xA)} F${Math.round(feed)}`);

                y += stepover;
                if (y <= maxY + 1e-6) {
                    out.push(`G1 Y${this.fmt(Math.min(y, maxY))} F${Math.round(feed)}`);
                }
                dir *= -1;
            }

            out.push(`G0 Z${this.fmt(safeZ)}`);
        }

        return out;
    }

    generateDrill({ safeZ, z0, feed }) {
        const depth = this.num('drill-depth', -5);
        const r = this.num('drill-r', 2);
        const xStart = this.num('drill-x', 0);
        const yStart = this.num('drill-y', 0);
        const pattern = document.getElementById('drill-pattern')?.value || 'single';

        const points = [];
        if (pattern === 'single') {
            points.push({ x: xStart, y: yStart });
        } else if (pattern === 'grid') {
            const cols = Math.max(1, Math.round(this.num('drill-cols', 3)));
            const rows = Math.max(1, Math.round(this.num('drill-rows', 3)));
            const px = this.num('drill-px', 20);
            const py = this.num('drill-py', 20);
            for (let rI = 0; rI < rows; rI++) {
                for (let cI = 0; cI < cols; cI++) {
                    points.push({ x: xStart + cI * px, y: yStart + rI * py });
                }
            }
        } else if (pattern === 'circle') {
            const cx = this.num('drill-cx', 0);
            const cy = this.num('drill-cy', 0);
            const radius = this.num('drill-radius', 25);
            const count = Math.max(1, Math.round(this.num('drill-count', 6)));
            for (let i = 0; i < count; i++) {
                const a = (i / count) * Math.PI * 2;
                points.push({
                    x: cx + Math.cos(a) * radius,
                    y: cy + Math.sin(a) * radius
                });
            }
        }

        let out = [];
        out.push('(Drill cycle: G81)');
        out.push(`G0 Z${this.fmt(safeZ)}`);
        out.push(`G98`);
        out.push(`G81 Z${this.fmt(depth)} R${this.fmt(r)} F${Math.round(feed)}`);

        for (const pt of points) {
            out.push(`X${this.fmt(pt.x)} Y${this.fmt(pt.y)}`);
        }

        out.push('G80');
        out.push(`G0 Z${this.fmt(safeZ)}`);
        return out;
    }

    renderPreview(gcode) {
        const codeEl = document.getElementById('conv-code');
        const metaEl = document.getElementById('conv-meta');

        if (codeEl) {
            const lines = gcode.split('\n');
            codeEl.textContent = lines.slice(0, 200).join('\n') + (lines.length > 200 ? `\n\n... (${lines.length - 200} more lines)` : '');
        }

        if (metaEl) {
            const lines = gcode.split('\n').length;
            metaEl.textContent = `${lines} lines`;
        }
    }

    enableActions(enabled) {
        const loadBtn = document.getElementById('conv-load');
        const uploadBtn = document.getElementById('conv-upload');
        const runBtn = document.getElementById('conv-run');

        if (loadBtn) loadBtn.disabled = !enabled;
        if (uploadBtn) uploadBtn.disabled = !enabled || !this.onUploadToSD;
        if (runBtn) runBtn.disabled = !enabled || !this.onRunFromSD;
    }

    load() {
        if (!this.lastGenerated.gcode) return;
        if (this.onLoad) {
            this.onLoad(this.lastGenerated.gcode, this.lastGenerated.filename);
        }
        this.notifyUser('Loaded into G-code editor', 'success');
    }

    async upload() {
        if (!this.lastGenerated.gcode || !this.onUploadToSD) return;
        try {
            await this.onUploadToSD(this.lastGenerated.filename, this.lastGenerated.gcode);
            this.notifyUser('Uploaded to SD card', 'success');
        } catch (e) {
            this.notifyUser('SD upload failed', 'error');
        }
    }

    async runFromSD() {
        if (!this.lastGenerated.filename || !this.onRunFromSD) return;
        try {
            await this.onRunFromSD(this.lastGenerated.filename);
        } catch (e) {
            this.notifyUser('Failed to start SD job', 'error');
        }
    }

    num(id, fallback) {
        const v = parseFloat(document.getElementById(id)?.value);
        return Number.isFinite(v) ? v : fallback;
    }

    fmt(n) {
        // Keep concise but stable
        return (Math.round(n * 1000) / 1000).toString();
    }

    notifyUser(msg, type = 'info') {
        if (this.notify) {
            this.notify(msg, type);
        } else if (typeof showNotification === 'function') {
            showNotification(msg, type);
        } else {
            console.log(`[Conversational] ${type}: ${msg}`);
        }
    }
}

if (typeof window !== 'undefined') {
    window.ConversationalGCode = ConversationalGCode;
}
