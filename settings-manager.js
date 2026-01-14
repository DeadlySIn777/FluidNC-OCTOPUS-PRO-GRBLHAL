/* ========================================
   FluidCNC - Settings Manager
   
   Features:
   - Export all settings as JSON
   - Import settings from backup
   - Tool library management
   - Macro import/export
   - Machine profile presets
   ======================================== */

class SettingsManager {
    constructor(options = {}) {
        this.version = '1.0';
        this.onStatus = options.onStatus || ((msg) => console.log('[Settings]', msg));
        this.onError = options.onError || ((err) => console.error('[Settings]', err));
    }
    
    // ================================================================
    // Full Backup / Restore
    // ================================================================
    
    exportAll() {
        const backup = {
            version: this.version,
            exportDate: new Date().toISOString(),
            exportedFrom: window.location.href,
            
            // Connection settings
            connection: {
                lastIp: localStorage.getItem('fluidcnc-last-ip'),
                connectionType: localStorage.getItem('fluidcnc-connection-type')
            },
            
            // Machine settings
            settings: this.safeJsonParse(localStorage.getItem('fluidcnc_settings')),
            
            // Tool library
            tools: this.safeJsonParse(localStorage.getItem('fluidcnc_tools')),
            
            // ATC configuration
            atcConfig: this.safeJsonParse(localStorage.getItem('fluidcnc_atc_config')),
            
            // Probe configuration
            probeConfig: this.safeJsonParse(localStorage.getItem('fluidcnc_probe_config')),
            
            // Custom macros
            macros: this.safeJsonParse(localStorage.getItem('fluidcnc_macros')),
            
            // Material library (feeds/speeds)
            materials: this.safeJsonParse(localStorage.getItem('fluidcnc_materials')),
            
            // UI preferences
            uiPrefs: this.safeJsonParse(localStorage.getItem('fluidcnc_ui_prefs'))
        };
        
        return backup;
    }
    
    downloadBackup() {
        const backup = this.exportAll();
        const json = JSON.stringify(backup, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        
        const date = new Date().toISOString().slice(0, 10);
        const filename = `fluidcnc-backup-${date}.json`;
        
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        
        URL.revokeObjectURL(url);
        this.onStatus(`Backup saved as ${filename}`);
        
        return filename;
    }
    
    async importBackup(file) {
        try {
            const text = await this.readFile(file);
            const backup = JSON.parse(text);
            
            // Validate backup - protect against prototype pollution attacks
            if (!backup || typeof backup !== 'object') {
                throw new Error('Invalid backup file - not an object');
            }
            if ('__proto__' in backup || 'constructor' in backup || 'prototype' in backup) {
                throw new Error('Invalid backup file - potential prototype pollution');
            }
            if (!backup.version) {
                throw new Error('Invalid backup file - missing version');
            }
            
            // Restore each section
            if (backup.connection) {
                if (backup.connection.lastIp) {
                    localStorage.setItem('fluidcnc-last-ip', backup.connection.lastIp);
                }
                if (backup.connection.connectionType) {
                    localStorage.setItem('fluidcnc-connection-type', backup.connection.connectionType);
                }
            }
            
            if (backup.settings) {
                localStorage.setItem('fluidcnc_settings', JSON.stringify(backup.settings));
            }
            
            if (backup.tools) {
                localStorage.setItem('fluidcnc_tools', JSON.stringify(backup.tools));
            }
            
            if (backup.atcConfig) {
                localStorage.setItem('fluidcnc_atc_config', JSON.stringify(backup.atcConfig));
            }
            
            if (backup.probeConfig) {
                localStorage.setItem('fluidcnc_probe_config', JSON.stringify(backup.probeConfig));
            }
            
            if (backup.macros) {
                localStorage.setItem('fluidcnc_macros', JSON.stringify(backup.macros));
            }
            
            if (backup.materials) {
                localStorage.setItem('fluidcnc_materials', JSON.stringify(backup.materials));
            }
            
            if (backup.uiPrefs) {
                localStorage.setItem('fluidcnc_ui_prefs', JSON.stringify(backup.uiPrefs));
            }
            
            this.onStatus(`Backup restored from ${backup.exportDate}`);
            return true;
            
        } catch (err) {
            this.onError(`Import failed: ${err.message}`);
            throw err;
        }
    }
    
    // ================================================================
    // Tool Library
    // ================================================================
    
    getToolLibrary() {
        return this.safeJsonParse(localStorage.getItem('fluidcnc_tools')) || {};
    }
    
    saveToolLibrary(tools) {
        localStorage.setItem('fluidcnc_tools', JSON.stringify(tools));
        this.onStatus('Tool library saved');
    }
    
    exportToolLibrary() {
        const tools = this.getToolLibrary();
        const library = {
            version: this.version,
            exportDate: new Date().toISOString(),
            toolCount: Object.keys(tools).length,
            tools: tools
        };
        
        const json = JSON.stringify(library, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        
        const filename = `fluidcnc-tools-${new Date().toISOString().slice(0, 10)}.json`;
        
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        
        URL.revokeObjectURL(url);
        this.onStatus(`Tool library exported: ${Object.keys(tools).length} tools`);
    }
    
    async importToolLibrary(file, merge = true) {
        try {
            const text = await this.readFile(file);
            const library = JSON.parse(text);
            
            if (!library.tools) {
                throw new Error('Invalid tool library file');
            }
            
            let tools = merge ? this.getToolLibrary() : {};
            
            // Merge or replace tools
            for (const [id, tool] of Object.entries(library.tools)) {
                if (merge && tools[id]) {
                    // Assign to next available slot
                    const maxId = Math.max(0, ...Object.keys(tools).map(Number));
                    tools[maxId + 1] = { ...tool, number: maxId + 1 };
                } else {
                    tools[id] = tool;
                }
            }
            
            this.saveToolLibrary(tools);
            this.onStatus(`Imported ${Object.keys(library.tools).length} tools`);
            return tools;
            
        } catch (err) {
            this.onError(`Tool import failed: ${err.message}`);
            throw err;
        }
    }
    
    addTool(tool) {
        const tools = this.getToolLibrary();
        const id = tool.number || (Math.max(0, ...Object.keys(tools).map(Number)) + 1);
        
        tools[id] = {
            number: id,
            name: tool.name || `Tool ${id}`,
            type: tool.type || 'endmill',
            diameter: tool.diameter || 6,
            length: tool.length || 50,
            flutes: tool.flutes || 2,
            material: tool.material || 'carbide',
            coating: tool.coating || 'none',
            maxRpm: tool.maxRpm || 24000,
            notes: tool.notes || '',
            ...tool
        };
        
        this.saveToolLibrary(tools);
        return id;
    }
    
    removeTool(id) {
        const tools = this.getToolLibrary();
        delete tools[id];
        this.saveToolLibrary(tools);
    }
    
    // ================================================================
    // Macro Library
    // ================================================================
    
    getMacros() {
        return this.safeJsonParse(localStorage.getItem('fluidcnc_macros')) || {};
    }
    
    saveMacros(macros) {
        localStorage.setItem('fluidcnc_macros', JSON.stringify(macros));
    }
    
    exportMacros() {
        const macros = this.getMacros();
        const json = JSON.stringify({ version: this.version, macros }, null, 2);
        
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.href = url;
        a.download = `fluidcnc-macros-${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        
        URL.revokeObjectURL(url);
        this.onStatus('Macros exported');
    }
    
    async importMacros(file, merge = true) {
        try {
            const text = await this.readFile(file);
            const data = JSON.parse(text);
            
            let macros = merge ? this.getMacros() : {};
            Object.assign(macros, data.macros || data);
            
            this.saveMacros(macros);
            this.onStatus('Macros imported');
            return macros;
            
        } catch (err) {
            this.onError(`Macro import failed: ${err.message}`);
            throw err;
        }
    }
    
    // ================================================================
    // Machine Profiles
    // ================================================================
    
    getMachineProfiles() {
        return this.safeJsonParse(localStorage.getItem('fluidcnc_profiles')) || {
            default: this.getDefaultProfile()
        };
    }
    
    getDefaultProfile() {
        return {
            name: 'Default',
            workArea: { x: 400, y: 400, z: 100 },
            maxFeed: { xy: 10000, z: 3000 },
            maxRpm: 24000,
            toolCount: 5,
            hasATC: false,
            hasProbe: true,
            hasDustShoe: false
        };
    }
    
    saveProfile(name, profile) {
        const profiles = this.getMachineProfiles();
        profiles[name] = profile;
        localStorage.setItem('fluidcnc_profiles', JSON.stringify(profiles));
        this.onStatus(`Profile "${name}" saved`);
    }
    
    loadProfile(name) {
        const profiles = this.getMachineProfiles();
        return profiles[name] || null;
    }
    
    deleteProfile(name) {
        if (name === 'default') {
            this.onError('Cannot delete default profile');
            return;
        }
        const profiles = this.getMachineProfiles();
        delete profiles[name];
        localStorage.setItem('fluidcnc_profiles', JSON.stringify(profiles));
    }
    
    // ================================================================
    // Factory Reset
    // ================================================================
    
    factoryReset(confirm = false) {
        if (!confirm) {
            return false;
        }
        
        const keysToRemove = [
            'fluidcnc-last-ip',
            'fluidcnc-connection-type',
            'fluidcnc_settings',
            'fluidcnc_tools',
            'fluidcnc_atc_config',
            'fluidcnc_probe_config',
            'fluidcnc_macros',
            'fluidcnc_materials',
            'fluidcnc_ui_prefs',
            'fluidcnc_profiles',
            'fluidcnc_job_recovery'
        ];
        
        keysToRemove.forEach(key => {
            localStorage.removeItem(key);
        });
        
        this.onStatus('Factory reset complete');
        return true;
    }
    
    // ================================================================
    // Utilities
    // ================================================================
    
    safeJsonParse(str) {
        try {
            return str ? JSON.parse(str) : null;
        } catch (e) {
            return null;
        }
    }
    
    readFile(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => resolve(e.target.result);
            reader.onerror = (e) => reject(new Error('Failed to read file'));
            reader.readAsText(file);
        });
    }
}

// Export
window.SettingsManager = SettingsManager;
