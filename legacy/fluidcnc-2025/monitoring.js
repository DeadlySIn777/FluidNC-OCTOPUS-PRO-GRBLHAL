/* ========================================
   FluidCNC - Real-Time Monitoring Dashboard
   Live graphs for spindle load, feed rate,
   temperatures, and machine performance
   ======================================== */

class MonitoringDashboard {
    constructor(container, grbl) {
        this.container = typeof container === 'string' 
            ? document.getElementById(container) 
            : container;
        this.grbl = grbl;
        
        // Data history for graphs (last 60 seconds at 10Hz = 600 points)
        this.maxDataPoints = 600;
        this.history = {
            timestamp: [],
            feedRate: [],
            spindleSpeed: [],
            spindleLoad: [],
            temperature: [],
            bufferLevel: [],
            overrideF: [],
            overrideS: []
        };
        
        // Chart instances
        this.charts = {};
        
        // Update interval
        this.updateInterval = null;
        this.updateRate = 100; // ms
        
        // Alert thresholds
        this.alerts = {
            spindleLoad: { warning: 70, critical: 90 },
            temperature: { warning: 50, critical: 70 },
            bufferLevel: { warning: 90, critical: 100 }
        };
        
        // Active alerts
        this.activeAlerts = new Set();
        
        this.init();
    }
    
    init() {
        this.render();
        this.setupEventListeners();
    }
    
    render() {
        if (!this.container) return;
        
        this.container.innerHTML = `
            <div class="monitoring-dashboard">
                <div class="dashboard-header">
                    <h2>📊 Real-Time Monitoring</h2>
                    <div class="dashboard-controls">
                        <button class="btn btn-sm" id="dash-toggle-recording">
                            <span class="rec-indicator"></span> Recording
                        </button>
                        <button class="btn btn-sm" id="dash-export-data">📥 Export</button>
                        <button class="btn btn-sm btn-close-dash">×</button>
                    </div>
                </div>
                
                <div class="dashboard-alerts" id="dashboard-alerts"></div>
                
                <div class="dashboard-grid">
                    <!-- Primary Metrics -->
                    <div class="metric-card large">
                        <div class="metric-header">
                            <span class="metric-title">Feed Rate</span>
                            <span class="metric-unit">mm/min</span>
                        </div>
                        <div class="metric-value" id="metric-feed">0</div>
                        <canvas id="chart-feed" class="metric-chart"></canvas>
                    </div>
                    
                    <div class="metric-card large">
                        <div class="metric-header">
                            <span class="metric-title">Spindle Speed</span>
                            <span class="metric-unit">RPM</span>
                        </div>
                        <div class="metric-value" id="metric-spindle">0</div>
                        <canvas id="chart-spindle" class="metric-chart"></canvas>
                    </div>
                    
                    <!-- Secondary Metrics -->
                    <div class="metric-card">
                        <div class="metric-header">
                            <span class="metric-title">Spindle Load</span>
                            <span class="metric-unit">%</span>
                        </div>
                        <div class="metric-gauge" id="gauge-spindle-load">
                            <svg viewBox="0 0 100 60">
                                <path d="M10,50 A40,40 0 0,1 90,50" fill="none" stroke="#2a2a3a" stroke-width="8" stroke-linecap="round"/>
                                <path id="gauge-arc-load" d="M10,50 A40,40 0 0,1 90,50" fill="none" stroke="#00ff88" stroke-width="8" stroke-linecap="round" stroke-dasharray="0 126"/>
                            </svg>
                            <span class="gauge-value" id="metric-load">0%</span>
                        </div>
                    </div>
                    
                    <div class="metric-card">
                        <div class="metric-header">
                            <span class="metric-title">Buffer</span>
                            <span class="metric-unit">cmds</span>
                        </div>
                        <div class="metric-bar-container">
                            <div class="metric-bar" id="bar-buffer">
                                <div class="metric-bar-fill"></div>
                            </div>
                            <span class="metric-bar-value" id="metric-buffer">0/128</span>
                        </div>
                    </div>
                    
                    <div class="metric-card">
                        <div class="metric-header">
                            <span class="metric-title">Overrides</span>
                        </div>
                        <div class="override-display">
                            <div class="override-item">
                                <span class="override-label">F</span>
                                <span class="override-value" id="metric-override-f">100%</span>
                            </div>
                            <div class="override-item">
                                <span class="override-label">R</span>
                                <span class="override-value" id="metric-override-r">100%</span>
                            </div>
                            <div class="override-item">
                                <span class="override-label">S</span>
                                <span class="override-value" id="metric-override-s">100%</span>
                            </div>
                        </div>
                    </div>
                    
                    <div class="metric-card">
                        <div class="metric-header">
                            <span class="metric-title">Run Time</span>
                        </div>
                        <div class="metric-value time" id="metric-runtime">00:00:00</div>
                        <div class="metric-subtext" id="metric-eta">ETA: --:--:--</div>
                    </div>
                    
                    <!-- Position Display -->
                    <div class="metric-card wide position-card">
                        <div class="metric-header">
                            <span class="metric-title">Position</span>
                            <span class="metric-toggle">
                                <button class="btn btn-xs active" id="btn-wpos">WPos</button>
                                <button class="btn btn-xs" id="btn-mpos">MPos</button>
                            </span>
                        </div>
                        <div class="position-grid">
                            <div class="position-axis x">
                                <span class="axis-label">X</span>
                                <span class="axis-value" id="metric-pos-x">0.000</span>
                            </div>
                            <div class="position-axis y">
                                <span class="axis-label">Y</span>
                                <span class="axis-value" id="metric-pos-y">0.000</span>
                            </div>
                            <div class="position-axis z">
                                <span class="axis-label">Z</span>
                                <span class="axis-value" id="metric-pos-z">0.000</span>
                            </div>
                        </div>
                    </div>
                    
                    <!-- Job Progress -->
                    <div class="metric-card wide progress-card">
                        <div class="metric-header">
                            <span class="metric-title">Job Progress</span>
                            <span class="metric-subtext" id="metric-lines">Line 0 / 0</span>
                        </div>
                        <div class="progress-bar-large">
                            <div class="progress-fill" id="progress-job-fill"></div>
                            <span class="progress-text" id="progress-job-text">0%</span>
                        </div>
                    </div>
                </div>
            </div>
        `;
        
        this.initCharts();
    }
    
    initCharts() {
        // Simple canvas-based mini charts
        this.charts.feed = this.createMiniChart('chart-feed', '#00ff88');
        this.charts.spindle = this.createMiniChart('chart-spindle', '#00aaff');
    }
    
    createMiniChart(canvasId, color) {
        const canvas = document.getElementById(canvasId);
        if (!canvas) return null;
        
        const ctx = canvas.getContext('2d');
        const dpr = window.devicePixelRatio || 1;
        
        // Set up canvas size
        const rect = canvas.getBoundingClientRect();
        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;
        ctx.scale(dpr, dpr);
        
        return {
            canvas,
            ctx,
            color,
            width: rect.width,
            height: rect.height,
            data: []
        };
    }
    
    updateChart(chart, data, maxValue = 100) {
        if (!chart || !chart.ctx) return;
        
        const { ctx, width, height, color } = chart;
        
        // Clear
        ctx.clearRect(0, 0, width, height);
        
        if (data.length < 2) return;
        
        // Draw gradient fill
        const gradient = ctx.createLinearGradient(0, 0, 0, height);
        gradient.addColorStop(0, color + '40');
        gradient.addColorStop(1, color + '00');
        
        ctx.beginPath();
        ctx.moveTo(0, height);
        
        const step = width / (data.length - 1);
        
        for (let i = 0; i < data.length; i++) {
            const x = i * step;
            const y = height - (data[i] / maxValue) * height;
            if (i === 0) {
                ctx.lineTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }
        }
        
        ctx.lineTo(width, height);
        ctx.closePath();
        ctx.fillStyle = gradient;
        ctx.fill();
        
        // Draw line
        ctx.beginPath();
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        
        for (let i = 0; i < data.length; i++) {
            const x = i * step;
            const y = height - (data[i] / maxValue) * height;
            if (i === 0) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }
        }
        
        ctx.stroke();
    }
    
    setupEventListeners() {
        // Close button
        this.container.querySelector('.btn-close-dash')?.addEventListener('click', () => {
            this.hide();
        });
        
        // Recording toggle
        this.container.querySelector('#dash-toggle-recording')?.addEventListener('click', (e) => {
            e.target.classList.toggle('recording');
            this.toggleRecording();
        });
        
        // Export data
        this.container.querySelector('#dash-export-data')?.addEventListener('click', () => {
            this.exportData();
        });
        
        // Position toggle
        this.container.querySelector('#btn-wpos')?.addEventListener('click', () => {
            this.container.querySelector('#btn-wpos').classList.add('active');
            this.container.querySelector('#btn-mpos').classList.remove('active');
            this.showWorkPosition = true;
        });
        
        this.container.querySelector('#btn-mpos')?.addEventListener('click', () => {
            this.container.querySelector('#btn-mpos').classList.add('active');
            this.container.querySelector('#btn-wpos').classList.remove('active');
            this.showWorkPosition = false;
        });
        
        this.showWorkPosition = true;
    }
    
    start() {
        this.isRecording = true;
        this.startTime = Date.now();
        
        // Start update loop
        this.updateInterval = setInterval(() => this.update(), this.updateRate);
        
        // Subscribe to grbl status updates
        if (this.grbl) {
            this.grbl.on('status', (state) => this.onStatusUpdate(state));
        }
    }
    
    stop() {
        this.isRecording = false;
        
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
            this.updateInterval = null;
        }
    }
    
    toggleRecording() {
        if (this.isRecording) {
            this.stop();
        } else {
            this.start();
        }
    }
    
    onStatusUpdate(state) {
        if (!this.isRecording) return;
        
        const now = Date.now();
        
        // Add to history
        this.addDataPoint('timestamp', now);
        this.addDataPoint('feedRate', state.feedRate || 0);
        this.addDataPoint('spindleSpeed', state.spindleSpeed || 0);
        this.addDataPoint('spindleLoad', state.spindleLoad || 0);
        this.addDataPoint('bufferLevel', state.buffer?.planner || 0);
        this.addDataPoint('overrideF', state.feedOverride || 100);
        this.addDataPoint('overrideS', state.spindleOverride || 100);
    }
    
    addDataPoint(key, value) {
        this.history[key].push(value);
        
        // Trim to max points
        if (this.history[key].length > this.maxDataPoints) {
            this.history[key].shift();
        }
    }
    
    update() {
        if (!this.grbl) return;
        
        const state = this.grbl.state;
        
        // Update metric values
        this.updateElement('metric-feed', Math.round(state.feedRate || 0));
        this.updateElement('metric-spindle', Math.round(state.spindleSpeed || 0));
        this.updateElement('metric-load', `${Math.round(state.spindleLoad || 0)}%`);
        this.updateElement('metric-buffer', `${state.buffer?.planner || 0}/128`);
        this.updateElement('metric-override-f', `${state.feedOverride || 100}%`);
        this.updateElement('metric-override-r', `${state.rapidOverride || 100}%`);
        this.updateElement('metric-override-s', `${state.spindleOverride || 100}%`);
        
        // Position
        const pos = this.showWorkPosition ? state.wpos : state.mpos;
        this.updateElement('metric-pos-x', pos?.x?.toFixed(3) || '0.000');
        this.updateElement('metric-pos-y', pos?.y?.toFixed(3) || '0.000');
        this.updateElement('metric-pos-z', pos?.z?.toFixed(3) || '0.000');
        
        // Runtime
        if (this.startTime) {
            const elapsed = Date.now() - this.startTime;
            this.updateElement('metric-runtime', this.formatTime(elapsed));
        }
        
        // Update gauge
        this.updateGauge('gauge-arc-load', state.spindleLoad || 0);
        
        // Update buffer bar
        const bufferPercent = ((state.buffer?.planner || 0) / 128) * 100;
        const bufferFill = this.container.querySelector('#bar-buffer .metric-bar-fill');
        if (bufferFill) {
            bufferFill.style.width = `${bufferPercent}%`;
            bufferFill.style.background = bufferPercent > 90 ? '#ff4466' : 
                                          bufferPercent > 70 ? '#ffaa00' : '#00ff88';
        }
        
        // Update charts
        if (this.history.feedRate.length > 1) {
            const recentFeed = this.history.feedRate.slice(-100);
            const maxFeed = Math.max(...recentFeed, 1);
            this.updateChart(this.charts.feed, recentFeed, maxFeed);
        }
        
        if (this.history.spindleSpeed.length > 1) {
            const recentSpindle = this.history.spindleSpeed.slice(-100);
            const maxSpindle = Math.max(...recentSpindle, 1);
            this.updateChart(this.charts.spindle, recentSpindle, maxSpindle);
        }
        
        // Check alerts
        this.checkAlerts(state);
    }
    
    updateElement(id, value) {
        const el = this.container.querySelector(`#${id}`);
        if (el) el.textContent = value;
    }
    
    updateGauge(id, percent) {
        const arc = this.container.querySelector(`#${id}`);
        if (!arc) return;
        
        // Arc length is approximately 126 units
        const arcLength = 126;
        const dashLength = (percent / 100) * arcLength;
        arc.setAttribute('stroke-dasharray', `${dashLength} ${arcLength}`);
        
        // Color based on value
        if (percent > 90) {
            arc.setAttribute('stroke', '#ff4466');
        } else if (percent > 70) {
            arc.setAttribute('stroke', '#ffaa00');
        } else {
            arc.setAttribute('stroke', '#00ff88');
        }
    }
    
    checkAlerts(state) {
        const alertsEl = this.container.querySelector('#dashboard-alerts');
        if (!alertsEl) return;
        
        const newAlerts = [];
        
        // Check spindle load
        if (state.spindleLoad > this.alerts.spindleLoad.critical) {
            newAlerts.push({ type: 'critical', message: `High spindle load: ${state.spindleLoad}%` });
        } else if (state.spindleLoad > this.alerts.spindleLoad.warning) {
            newAlerts.push({ type: 'warning', message: `Spindle load elevated: ${state.spindleLoad}%` });
        }
        
        // Update alerts display
        if (newAlerts.length > 0) {
            alertsEl.innerHTML = newAlerts.map(a => 
                `<div class="alert alert-${a.type}">${a.type === 'critical' ? '🚨' : '⚠️'} ${a.message}</div>`
            ).join('');
            alertsEl.style.display = 'block';
        } else {
            alertsEl.style.display = 'none';
        }
    }
    
    formatTime(ms) {
        const seconds = Math.floor(ms / 1000);
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = seconds % 60;
        return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }
    
    updateJobProgress(current, total) {
        const percent = total > 0 ? (current / total) * 100 : 0;
        
        const fill = this.container.querySelector('#progress-job-fill');
        const text = this.container.querySelector('#progress-job-text');
        const lines = this.container.querySelector('#metric-lines');
        
        if (fill) fill.style.width = `${percent}%`;
        if (text) text.textContent = `${percent.toFixed(1)}%`;
        if (lines) lines.textContent = `Line ${current} / ${total}`;
        
        // Calculate ETA
        if (this.startTime && current > 0) {
            const elapsed = Date.now() - this.startTime;
            const rate = current / elapsed;
            const remaining = (total - current) / rate;
            this.updateElement('metric-eta', `ETA: ${this.formatTime(remaining)}`);
        }
    }
    
    exportData() {
        const csv = this.generateCSV();
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.href = url;
        a.download = `fluidcnc-monitoring-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.csv`;
        a.click();
        
        URL.revokeObjectURL(url);
    }
    
    generateCSV() {
        const headers = ['timestamp', 'feedRate', 'spindleSpeed', 'spindleLoad', 'bufferLevel', 'overrideF', 'overrideS'];
        const rows = [headers.join(',')];
        
        const length = this.history.timestamp.length;
        for (let i = 0; i < length; i++) {
            const row = headers.map(h => this.history[h][i] ?? '');
            rows.push(row.join(','));
        }
        
        return rows.join('\n');
    }
    
    show() {
        if (this.container) {
            this.container.style.display = 'block';
            this.start();
        }
    }
    
    hide() {
        if (this.container) {
            this.container.style.display = 'none';
            this.stop();
        }
    }
    
    toggle() {
        if (this.container.style.display === 'none') {
            this.show();
        } else {
            this.hide();
        }
    }
    
    // Get summary statistics for the current session
    getSessionStats() {
        if (this.history.timestamp.length === 0) {
            return null;
        }
        
        const calcStats = (arr) => {
            if (!arr || arr.length === 0) return { min: 0, max: 0, avg: 0 };
            const filtered = arr.filter(v => v > 0);
            if (filtered.length === 0) return { min: 0, max: 0, avg: 0 };
            return {
                min: Math.min(...filtered),
                max: Math.max(...filtered),
                avg: filtered.reduce((a, b) => a + b, 0) / filtered.length
            };
        };
        
        const duration = this.history.timestamp.length > 0 
            ? this.history.timestamp[this.history.timestamp.length - 1] - this.history.timestamp[0]
            : 0;
        
        return {
            duration: this.formatTime(duration),
            dataPoints: this.history.timestamp.length,
            feedRate: calcStats(this.history.feedRate),
            spindleSpeed: calcStats(this.history.spindleSpeed),
            spindleLoad: calcStats(this.history.spindleLoad),
            bufferUtilization: calcStats(this.history.bufferLevel)
        };
    }
    
    // Clear all recorded data
    clearHistory() {
        for (const key of Object.keys(this.history)) {
            this.history[key] = [];
        }
        this.startTime = null;
    }
    
    // Set alert thresholds
    setAlertThreshold(metric, warning, critical) {
        if (this.alerts[metric]) {
            this.alerts[metric] = { warning, critical };
        }
    }
    
    // Get connection to grbl for external use
    setGrbl(grbl) {
        // Unsubscribe from old grbl if exists
        if (this.grbl) {
            this.grbl.off('status', this._statusHandler);
        }
        
        this.grbl = grbl;
        
        // Set up new subscription
        if (grbl) {
            this._statusHandler = (state) => this.onStatusUpdate(state);
            grbl.on('status', this._statusHandler);
        }
    }
}

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
    module.exports = MonitoringDashboard;
}
