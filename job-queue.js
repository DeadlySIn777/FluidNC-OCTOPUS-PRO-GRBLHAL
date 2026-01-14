/* ========================================
   FluidCNC - Job Queue System
   Manages multiple G-code files with 
   priority, scheduling, and history
   ======================================== */

class JobQueue {
    constructor(grbl, options = {}) {
        this.grbl = grbl;
        
        // Configuration
        this.config = {
            maxQueueSize: options.maxQueueSize || 50,
            autoStartNext: options.autoStartNext || false,
            pauseBetweenJobs: options.pauseBetweenJobs || 5000, // ms
            saveHistory: options.saveHistory || true,
            maxHistorySize: options.maxHistorySize || 100
        };
        
        // Job queue (pending jobs)
        this.queue = [];
        
        // Currently running job
        this.currentJob = null;
        
        // Job history (completed/cancelled)
        this.history = [];
        
        // Event handlers
        this.handlers = {
            queueUpdate: [],
            jobStart: [],
            jobComplete: [],
            jobError: [],
            jobProgress: [],
            jobAlarm: []  // New: alarm during job
        };
        
        // Job ID counter
        this.nextJobId = 1;
        
        // Load from localStorage
        this.loadState();
        
        // SAFETY CRITICAL: Subscribe to alarms from grbl
        this._setupSafetyListeners();
    }
    
    /**
     * SAFETY: Set up listeners for machine alarms
     * If an alarm occurs during a job, we must immediately abort
     */
    _setupSafetyListeners() {
        if (!this.grbl) return;
        
        // Bind so we can remove later if needed
        this._onAlarm = (alarm) => {
            if (this.currentJob) {
                console.error(`[JobQueue SAFETY] ALARM ${alarm.code} during job "${this.currentJob.name}": ${alarm.message}`);
                
                // Store alarm info in job
                this.currentJob.error = `ALARM ${alarm.code}: ${alarm.message}`;
                this.currentJob.alarmCode = alarm.code;
                
                // Complete job as error (streaming already stopped by grblhal.js)
                this.completeJob('alarm');
                
                // Emit alarm event for UI
                this.emit('jobAlarm', { 
                    job: this.currentJob, 
                    alarm 
                });
            }
        };
        
        this._onDisconnect = (info) => {
            if (this.currentJob) {
                console.error('[JobQueue SAFETY] Connection lost during job');
                this.currentJob.error = 'Connection lost during job';
                this.completeJob('error');
            }
        };
        
        this.grbl.on('alarm', this._onAlarm);
        this.grbl.on('disconnect', this._onDisconnect);
    }
    
    /**
     * Clean up listeners (call when destroying JobQueue)
     */
    destroy() {
        if (this.grbl) {
            this.grbl.off('alarm', this._onAlarm);
            this.grbl.off('disconnect', this._onDisconnect);
        }
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
    
    off(event, handler) {
        if (this.handlers[event]) {
            this.handlers[event] = this.handlers[event].filter(h => h !== handler);
        }
        return this;
    }
    
    emit(event, data) {
        if (this.handlers[event]) {
            this.handlers[event].forEach(h => h(data));
        }
    }
    
    // ================================================================
    // Job management
    // ================================================================
    
    /**
     * Add a job to the queue
     * @param {Object} jobData - Job configuration
     * @returns {Object} The created job
     */
    addJob(jobData) {
        if (this.queue.length >= this.config.maxQueueSize) {
            throw new Error('Job queue is full');
        }
        
        const job = {
            id: this.nextJobId++,
            name: jobData.name || `Job ${this.nextJobId - 1}`,
            gcode: jobData.gcode || [],
            fileName: jobData.fileName || 'untitled.nc',
            fileSize: jobData.fileSize || 0,
            lineCount: Array.isArray(jobData.gcode) ? jobData.gcode.length : 0,
            priority: jobData.priority || 0, // Higher = more priority
            status: 'pending',
            progress: 0,
            createdAt: Date.now(),
            startedAt: null,
            completedAt: null,
            estimatedTime: jobData.estimatedTime || null,
            actualTime: null,
            error: null,
            metadata: jobData.metadata || {},
            
            // Tool requirements
            toolNumber: jobData.toolNumber || null,
            material: jobData.material || null,
            
            // Repeat settings
            repeatCount: jobData.repeatCount || 1,
            currentRepeat: 0,
            
            // Notes
            notes: jobData.notes || ''
        };
        
        // Insert based on priority
        let insertIndex = this.queue.findIndex(j => j.priority < job.priority);
        if (insertIndex === -1) insertIndex = this.queue.length;
        this.queue.splice(insertIndex, 0, job);
        
        this.saveState();
        this.emit('queueUpdate', { type: 'add', job, queue: this.queue });
        
        return job;
    }
    
    /**
     * Remove a job from the queue
     */
    removeJob(jobId) {
        const index = this.queue.findIndex(j => j.id === jobId);
        if (index === -1) return false;
        
        const job = this.queue.splice(index, 1)[0];
        this.saveState();
        this.emit('queueUpdate', { type: 'remove', job, queue: this.queue });
        
        return true;
    }
    
    /**
     * Move job up/down in queue
     */
    moveJob(jobId, direction) {
        const index = this.queue.findIndex(j => j.id === jobId);
        if (index === -1) return false;
        
        const newIndex = direction === 'up' ? index - 1 : index + 1;
        if (newIndex < 0 || newIndex >= this.queue.length) return false;
        
        const job = this.queue.splice(index, 1)[0];
        this.queue.splice(newIndex, 0, job);
        
        this.saveState();
        this.emit('queueUpdate', { type: 'reorder', job, queue: this.queue });
        
        return true;
    }
    
    /**
     * Update job priority
     */
    setPriority(jobId, priority) {
        const job = this.queue.find(j => j.id === jobId);
        if (!job) return false;
        
        job.priority = priority;
        
        // Re-sort queue
        this.queue.sort((a, b) => b.priority - a.priority);
        
        this.saveState();
        this.emit('queueUpdate', { type: 'priority', job, queue: this.queue });
        
        return true;
    }
    
    /**
     * Get job by ID
     */
    getJob(jobId) {
        return this.queue.find(j => j.id === jobId) || 
               (this.currentJob?.id === jobId ? this.currentJob : null) ||
               this.history.find(j => j.id === jobId);
    }
    
    /**
     * Get all pending jobs
     */
    getQueue() {
        return [...this.queue];
    }
    
    /**
     * Get job history
     */
    getHistory() {
        return [...this.history];
    }
    
    /**
     * Clear all pending jobs
     */
    clearQueue() {
        this.queue = [];
        this.saveState();
        this.emit('queueUpdate', { type: 'clear', queue: this.queue });
    }
    
    /**
     * Clear job history
     */
    clearHistory() {
        this.history = [];
        this.saveState();
    }
    
    // ================================================================
    // Job execution
    // ================================================================
    
    /**
     * Start the next job in queue
     */
    async startNext() {
        if (this.currentJob) {
            throw new Error('A job is already running');
        }
        
        if (this.queue.length === 0) {
            return null;
        }
        
        const job = this.queue.shift();
        return this.runJob(job);
    }
    
    /**
     * Start a specific job (removes from queue)
     */
    async startJob(jobId) {
        if (this.currentJob) {
            throw new Error('A job is already running');
        }
        
        const index = this.queue.findIndex(j => j.id === jobId);
        if (index === -1) {
            throw new Error('Job not found in queue');
        }
        
        const job = this.queue.splice(index, 1)[0];
        return this.runJob(job);
    }
    
    /**
     * Run a job directly (not from queue)
     */
    async runJob(job) {
        this.currentJob = job;
        this.currentJob.status = 'running';
        this.currentJob.startedAt = Date.now();
        this.currentJob.currentRepeat++;
        
        this.saveState();
        this.emit('jobStart', this.currentJob);
        
        try {
            await this.executeJob(this.currentJob);
            
            // Check if we need to repeat
            if (this.currentJob.currentRepeat < this.currentJob.repeatCount) {
                // Re-queue for repeat
                this.currentJob.status = 'pending';
                this.currentJob.progress = 0;
                this.queue.unshift(this.currentJob);
                this.currentJob = null;
                
                if (this.config.autoStartNext) {
                    setTimeout(() => this.startNext(), this.config.pauseBetweenJobs);
                }
            } else {
                // Job complete
                this.completeJob('completed');
            }
        } catch (error) {
            this.currentJob.error = error.message;
            this.completeJob('error');
            this.emit('jobError', { job: this.currentJob, error });
        }
        
        return this.currentJob;
    }
    
    /**
     * Execute job G-code
     */
    async executeJob(job) {
        if (!this.grbl) {
            throw new Error('No grblHAL connection');
        }
        
        const lines = job.gcode;
        const total = lines.length;
        
        return new Promise((resolve, reject) => {
            this.grbl.streamGCode(lines, {
                onProgress: (current, total) => {
                    job.progress = (current / total) * 100;
                    this.emit('jobProgress', { job, current, total });
                },
                onComplete: () => {
                    resolve();
                },
                onError: (error) => {
                    reject(error);
                }
            });
        });
    }
    
    /**
     * Complete current job
     */
    completeJob(status) {
        if (!this.currentJob) return;
        
        this.currentJob.status = status;
        this.currentJob.completedAt = Date.now();
        this.currentJob.actualTime = this.currentJob.completedAt - this.currentJob.startedAt;
        this.currentJob.progress = status === 'completed' ? 100 : this.currentJob.progress;
        
        // Add to history
        if (this.config.saveHistory) {
            this.history.unshift(this.currentJob);
            
            // Trim history
            if (this.history.length > this.config.maxHistorySize) {
                this.history.pop();
            }
        }
        
        this.emit('jobComplete', this.currentJob);
        this.currentJob = null;
        
        this.saveState();
        
        // Auto-start next job
        if (this.config.autoStartNext && status === 'completed' && this.queue.length > 0) {
            setTimeout(() => this.startNext(), this.config.pauseBetweenJobs);
        }
    }
    
    /**
     * Pause current job
     */
    pauseJob() {
        if (!this.currentJob) return false;
        
        if (this.grbl) {
            this.grbl.pause();
        }
        
        this.currentJob.status = 'paused';
        this.saveState();
        this.emit('queueUpdate', { type: 'pause', job: this.currentJob, queue: this.queue });
        
        return true;
    }
    
    /**
     * Resume current job
     */
    resumeJob() {
        if (!this.currentJob || this.currentJob.status !== 'paused') return false;
        
        if (this.grbl) {
            this.grbl.resume();
        }
        
        this.currentJob.status = 'running';
        this.saveState();
        this.emit('queueUpdate', { type: 'resume', job: this.currentJob, queue: this.queue });
        
        return true;
    }
    
    /**
     * Cancel current job
     */
    cancelJob() {
        if (!this.currentJob) return false;
        
        if (this.grbl) {
            this.grbl.streamCancel();
        }
        
        this.completeJob('cancelled');
        return true;
    }
    
    // ================================================================
    // State persistence
    // ================================================================
    
    saveState() {
        try {
            const state = {
                queue: this.queue.map(j => ({
                    ...j,
                    gcode: null // Don't save G-code to localStorage (too large)
                })),
                history: this.history.map(j => ({
                    ...j,
                    gcode: null
                })),
                nextJobId: this.nextJobId
            };
            
            localStorage.setItem('fluidcnc-jobqueue', JSON.stringify(state));
        } catch (e) {
            console.warn('[JobQueue] Failed to save state:', e.message);
        }
    }
    
    loadState() {
        try {
            const saved = localStorage.getItem('fluidcnc-jobqueue');
            if (saved) {
                const state = JSON.parse(saved);
                this.history = state.history || [];
                this.nextJobId = state.nextJobId || 1;
                // Note: We don't restore pending queue since G-code isn't saved
            }
        } catch (e) {
            console.warn('[JobQueue] Failed to load state:', e.message);
        }
    }
    
    // ================================================================
    // Utilities
    // ================================================================
    
    /**
     * Get estimated time for all pending jobs
     */
    getTotalEstimatedTime() {
        return this.queue.reduce((sum, job) => sum + (job.estimatedTime || 0), 0);
    }
    
    /**
     * Get statistics
     */
    getStatistics() {
        const completed = this.history.filter(j => j.status === 'completed');
        const failed = this.history.filter(j => j.status === 'error');
        const cancelled = this.history.filter(j => j.status === 'cancelled');
        
        const totalTime = completed.reduce((sum, j) => sum + (j.actualTime || 0), 0);
        const avgTime = completed.length > 0 ? totalTime / completed.length : 0;
        
        return {
            pending: this.queue.length,
            running: this.currentJob ? 1 : 0,
            completed: completed.length,
            failed: failed.length,
            cancelled: cancelled.length,
            totalJobsRun: this.history.length,
            totalMachiningTime: totalTime,
            averageJobTime: avgTime,
            successRate: this.history.length > 0 
                ? (completed.length / this.history.length) * 100 
                : 0
        };
    }
    
    /**
     * Export queue and history
     */
    exportData() {
        return {
            queue: this.queue,
            history: this.history,
            statistics: this.getStatistics(),
            exportedAt: new Date().toISOString()
        };
    }
}

// ========================================
// Job Queue UI Component
// ========================================

class JobQueueUI {
    constructor(container, jobQueue) {
        this.container = typeof container === 'string'
            ? document.getElementById(container)
            : container;
        this.jobQueue = jobQueue;
        
        this.init();
    }
    
    init() {
        this.render();
        this.bindEvents();
        
        // Listen to queue updates
        this.jobQueue.on('queueUpdate', () => this.updateList());
        this.jobQueue.on('jobProgress', (data) => this.updateProgress(data));
        this.jobQueue.on('jobComplete', () => this.updateList());
    }
    
    render() {
        if (!this.container) return;
        
        this.container.innerHTML = `
            <div class="job-queue">
                <div class="queue-header">
                    <h3>📋 Job Queue</h3>
                    <div class="queue-actions">
                        <button class="btn btn-sm btn-add-job">+ Add Job</button>
                        <button class="btn btn-sm btn-clear-queue">Clear</button>
                    </div>
                </div>
                
                <div class="queue-stats">
                    <span class="stat">Pending: <strong id="stat-pending">0</strong></span>
                    <span class="stat">Est. Time: <strong id="stat-time">--:--</strong></span>
                </div>
                
                <div class="current-job" id="current-job" style="display: none;">
                    <div class="job-item running">
                        <div class="job-info">
                            <span class="job-name" id="current-job-name">--</span>
                            <span class="job-status">Running</span>
                        </div>
                        <div class="job-progress">
                            <div class="progress-bar">
                                <div class="progress-fill" id="current-job-progress"></div>
                            </div>
                            <span class="progress-text" id="current-job-percent">0%</span>
                        </div>
                        <div class="job-actions">
                            <button class="btn btn-xs btn-pause-job">⏸</button>
                            <button class="btn btn-xs btn-cancel-job">✕</button>
                        </div>
                    </div>
                </div>
                
                <div class="queue-list" id="queue-list">
                    <div class="empty-state">No jobs in queue</div>
                </div>
                
                <div class="queue-controls">
                    <button class="btn btn-primary btn-start-next" disabled>
                        ▶ Start Next Job
                    </button>
                    <label class="checkbox-label">
                        <input type="checkbox" id="auto-start-toggle">
                        Auto-start next
                    </label>
                </div>
                
                <div class="queue-history-toggle">
                    <button class="btn btn-sm btn-show-history">📜 History</button>
                </div>
            </div>
        `;
        
        this.updateList();
    }
    
    bindEvents() {
        // Add job
        this.container.querySelector('.btn-add-job')?.addEventListener('click', () => {
            this.showAddJobDialog();
        });
        
        // Clear queue
        this.container.querySelector('.btn-clear-queue')?.addEventListener('click', () => {
            if (confirm('Clear all pending jobs?')) {
                this.jobQueue.clearQueue();
            }
        });
        
        // Start next
        this.container.querySelector('.btn-start-next')?.addEventListener('click', () => {
            this.jobQueue.startNext();
        });
        
        // Pause/resume
        this.container.querySelector('.btn-pause-job')?.addEventListener('click', () => {
            if (this.jobQueue.currentJob?.status === 'paused') {
                this.jobQueue.resumeJob();
            } else {
                this.jobQueue.pauseJob();
            }
        });
        
        // Cancel
        this.container.querySelector('.btn-cancel-job')?.addEventListener('click', () => {
            if (confirm('Cancel current job?')) {
                this.jobQueue.cancelJob();
            }
        });
        
        // Auto-start toggle
        this.container.querySelector('#auto-start-toggle')?.addEventListener('change', (e) => {
            this.jobQueue.config.autoStartNext = e.target.checked;
        });
        
        // History
        this.container.querySelector('.btn-show-history')?.addEventListener('click', () => {
            this.showHistoryDialog();
        });
    }
    
    updateList() {
        const listEl = this.container.querySelector('#queue-list');
        const currentEl = this.container.querySelector('#current-job');
        const startBtn = this.container.querySelector('.btn-start-next');
        
        // Update current job display
        if (this.jobQueue.currentJob) {
            currentEl.style.display = 'block';
            this.container.querySelector('#current-job-name').textContent = 
                this.jobQueue.currentJob.name;
        } else {
            currentEl.style.display = 'none';
        }
        
        // Update queue list
        const queue = this.jobQueue.getQueue();
        
        if (queue.length === 0) {
            listEl.innerHTML = '<div class="empty-state">No jobs in queue</div>';
            startBtn.disabled = true;
        } else {
            listEl.innerHTML = queue.map((job, index) => `
                <div class="job-item" data-job-id="${job.id}">
                    <div class="job-drag-handle">≡</div>
                    <div class="job-info">
                        <span class="job-name">${this.escapeHtml(job.name)}</span>
                        <span class="job-meta">${job.lineCount} lines</span>
                    </div>
                    <div class="job-priority">
                        <span class="priority-badge priority-${job.priority > 0 ? 'high' : 'normal'}">
                            ${job.priority > 0 ? '⬆' : ''}
                        </span>
                    </div>
                    <div class="job-actions">
                        <button class="btn btn-xs btn-move-up" ${index === 0 ? 'disabled' : ''}>↑</button>
                        <button class="btn btn-xs btn-move-down" ${index === queue.length - 1 ? 'disabled' : ''}>↓</button>
                        <button class="btn btn-xs btn-start-job">▶</button>
                        <button class="btn btn-xs btn-remove-job">✕</button>
                    </div>
                </div>
            `).join('');
            
            startBtn.disabled = !!this.jobQueue.currentJob;
            
            // Bind job-specific events
            listEl.querySelectorAll('.job-item').forEach(el => {
                const jobId = parseInt(el.dataset.jobId);
                
                el.querySelector('.btn-move-up')?.addEventListener('click', () => {
                    this.jobQueue.moveJob(jobId, 'up');
                });
                
                el.querySelector('.btn-move-down')?.addEventListener('click', () => {
                    this.jobQueue.moveJob(jobId, 'down');
                });
                
                el.querySelector('.btn-start-job')?.addEventListener('click', () => {
                    this.jobQueue.startJob(jobId);
                });
                
                el.querySelector('.btn-remove-job')?.addEventListener('click', () => {
                    this.jobQueue.removeJob(jobId);
                });
            });
        }
        
        // Update stats
        this.container.querySelector('#stat-pending').textContent = queue.length;
        
        const estTime = this.jobQueue.getTotalEstimatedTime();
        this.container.querySelector('#stat-time').textContent = 
            estTime > 0 ? this.formatTime(estTime) : '--:--';
    }
    
    updateProgress(data) {
        const { job, current, total } = data;
        const percent = Math.round((current / total) * 100);
        
        const progressFill = this.container.querySelector('#current-job-progress');
        const progressText = this.container.querySelector('#current-job-percent');
        
        if (progressFill) progressFill.style.width = `${percent}%`;
        if (progressText) progressText.textContent = `${percent}%`;
    }
    
    showAddJobDialog() {
        // Create file input
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.nc,.gcode,.ngc,.tap,.txt';
        input.multiple = true;
        
        input.addEventListener('change', async (e) => {
            for (const file of e.target.files) {
                try {
                    const text = await file.text();
                    const lines = text.split('\n');
                    
                    this.jobQueue.addJob({
                        name: file.name.replace(/\.[^.]+$/, ''),
                        fileName: file.name,
                        fileSize: file.size,
                        gcode: lines
                    });
                } catch (error) {
                    console.error('Failed to load file:', error);
                }
            }
        });
        
        input.click();
    }
    
    showHistoryDialog() {
        const history = this.jobQueue.getHistory();
        const stats = this.jobQueue.getStatistics();
        
        const modal = document.createElement('div');
        modal.className = 'modal-overlay';
        modal.innerHTML = `
            <div class="modal">
                <div class="modal-header">
                    <h2>📜 Job History</h2>
                    <button class="btn-close" onclick="this.closest('.modal-overlay').remove()">×</button>
                </div>
                <div class="modal-body">
                    <div class="history-stats">
                        <div class="stat-box">
                            <span class="stat-value">${stats.completed}</span>
                            <span class="stat-label">Completed</span>
                        </div>
                        <div class="stat-box">
                            <span class="stat-value">${stats.failed}</span>
                            <span class="stat-label">Failed</span>
                        </div>
                        <div class="stat-box">
                            <span class="stat-value">${stats.successRate.toFixed(0)}%</span>
                            <span class="stat-label">Success Rate</span>
                        </div>
                        <div class="stat-box">
                            <span class="stat-value">${this.formatTime(stats.totalMachiningTime)}</span>
                            <span class="stat-label">Total Time</span>
                        </div>
                    </div>
                    <div class="history-list">
                        ${history.length === 0 ? '<div class="empty-state">No history yet</div>' : 
                          history.map(job => `
                            <div class="history-item ${job.status}">
                                <span class="history-status">${this.getStatusIcon(job.status)}</span>
                                <div class="history-info">
                                    <span class="history-name">${this.escapeHtml(job.name)}</span>
                                    <span class="history-meta">${new Date(job.completedAt).toLocaleString()}</span>
                                </div>
                                <span class="history-time">${this.formatTime(job.actualTime || 0)}</span>
                            </div>
                          `).join('')}
                    </div>
                </div>
                <div class="modal-footer">
                    <button class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove()">Close</button>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        setTimeout(() => modal.classList.add('active'), 10);
    }
    
    getStatusIcon(status) {
        switch (status) {
            case 'completed': return '✅';
            case 'error': return '❌';
            case 'cancelled': return '⏹';
            default: return '❓';
        }
    }
    
    formatTime(ms) {
        const seconds = Math.floor(ms / 1000);
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = seconds % 60;
        
        if (h > 0) {
            return `${h}h ${m}m`;
        } else if (m > 0) {
            return `${m}m ${s}s`;
        } else {
            return `${s}s`;
        }
    }
    
    escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }
}

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { JobQueue, JobQueueUI };
}
