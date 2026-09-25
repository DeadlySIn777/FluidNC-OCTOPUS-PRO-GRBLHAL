# FluidCNC Feature Roadmap

## Current Status (v12 + Enhancements)
- ✅ WebSocket + WebSerial connection to grblHAL
- ✅ Real-time DRO with machine/work coordinates
- ✅ Arrow key jog (step + continuous modes)
- ✅ G-code streaming with progress
- ✅ 2D/3D toolpath visualization
- ✅ Probe wizard (Z, corner, center)
- ✅ ATC controller (5 tools)
- ✅ Feed/speed calculator
- ✅ Surface scanner
- ✅ Job recovery
- ✅ Demo mode for testing
- ✅ **Vacuum/Dust Shoe toggle buttons (v11)**
- ✅ **Keyboard shortcuts: H/U/0/V/F/T/I/Ctrl+O (v11)**
- ✅ **Shift+Arrow for 10x jog speed (v11)**
- ✅ **ML Intelligence System (machine-enhancements.js)**
- ✅ **Neural Network-based Cut Quality Prediction**
- ✅ **Emergency Procedures System (ALARM:1-13 handling)**
- ✅ **Crash Detection & Prevention (StallGuard)**
- ✅ **ESP32 Chatter Sensor Integration**
- ✅ **VFD Modbus Monitoring**
- ✅ **Bambu-style Calibration Wizard (v12)**
- ✅ **G-code Safety Auto-Fixer (v12)**
- ✅ **Tool Breakage Learning System (v12)**
- ✅ **VFD Accel/Decel Time Control (v12)**

---

## ✅ v12 Enhancements (enhancements-v12.js)

### New Features
| Feature | Description |
|---------|-------------|
| **VFD Load Display** | Real-time spindle load % in header with color-coded bar |
| **Job Timer + ETA** | Elapsed time, remaining time, and completion ETA |
| **Audio Notifications** | Web Audio API sounds for job complete, alarms, probes |
| **Push Notifications** | Browser notifications when away from screen |
| **Gamepad Jogging** | USB controller support with analog stick precision |
| **Touch Plate Presets** | Save/recall different plate thicknesses |
| **VFD Adaptive Feed** | Auto-reduce feed when spindle load exceeds threshold |

### Gamepad Controls
| Control | Action |
|---------|--------|
| Left Stick | XY axis jog (proportional speed) |
| Right Stick Y / Triggers | Z axis jog |
| D-Pad | Step jog (1mm steps) |
| Shoulder Buttons | Z step jog (0.5mm) |
| A Button | Feed Hold |
| B Button | Cancel Jog |

### Settings Panel
Access via **Settings → 🎮 Extras** tab:
- Audio enable/volume
- Push notification permission
- Gamepad deadzone/sensitivity
- Adaptive feed threshold/max reduction
- Touch plate preset management

---

## ✅ ML Intelligence System (machine-enhancements.js)

### Neural Network Architecture
**7 Inputs → 12 Hidden → 3 Outputs**

| Input | Description | Normalization |
|-------|-------------|---------------|
| audioLevel | Chatter sensor audio | 0-1024 → 0.0-1.0 |
| accelMagnitude | Vibration G-force | 0-20G → 0.0-1.0 |
| motorCurrent | VFD motor load | 0-100% → 0.0-1.0 |
| spindleRpm | Current RPM | 0-24000 → 0.0-1.0 |
| feedRate | Current feed mm/min | 0-10000 → 0.0-1.0 |
| depthOfCut | DOC in mm | 0-15mm → 0.0-1.0 |
| materialHardness | Material index | 0-10 → 0.0-1.0 |

| Output | Description | Range |
|--------|-------------|-------|
| quality | Predicted cut quality | 0.0-1.0 |
| chatterRisk | Chatter probability | 0.0-1.0 |
| toolWearRate | Wear rate prediction | 0.0-1.0 |

### Data Flow
```
ESP32 Chatter → _updateFromChatter() → hardwareState.chatter/environment
grblHAL (TMC2209) → _updateFromGrbl() → hardwareState.stallGuard/crash
VFD Modbus → _updateVfdData() → hardwareState.vfd
```

### Timing
- Intelligence cycle: **10Hz** (100ms)
- UI updates: **2Hz** (500ms)
- Sensor polling: Continuous

### Files Modified
- [machine-enhancements.js](machine-enhancements.js) - 5,700+ lines, complete system
- [index.html](index.html) - Added ML status panel, version v=5

---

## ✅ Emergency Procedures System

### Alarm Handling (ALARM:1-13)
| Alarm | Type | Response |
|-------|------|----------|
| ALARM:1 | Hard limit | Stop motion, preserve position |
| ALARM:2 | Soft limit | Halt and alert |
| ALARM:3 | Abort cycle | Controlled stop |
| ALARM:9 | Homing fail | Retry or manual intervention |
| ALARM:10 | E-STOP | Full system halt |
| ALARM:13 | VFD error | Spindle emergency stop |

### Crash Detection
- **TMC2209 StallGuard** integration for real-time load sensing
- Rapid load spike detection triggers controlled deceleration
- State preservation for recovery
- Automatic feed rate reduction on near-crash events

### Safety Monitoring
| System | Method | Response |
|--------|--------|----------|
| Coolant/Chiller | Door pin integration | Pause job on low flow |
| Fire/Smoke | Environmental sensor ready | Emergency stop + alert |
| Gas Detection | Environmental sensor ready | Ventilation + pause |
| UPS Power | State monitoring | Checkpoint save on battery |
| Temperature | Spindle thermal tracking | Warm-up enforcement |

---

## ✅ Completed Features (v11)

### 1. Vacuum/Dust Shoe Toggle Button ✅
Added dedicated toggle buttons for vacuum and dust shoe control.

**Location:** Header, after coolant buttons
**Controls:**
- 🌀 **Vacuum** button → M64/M65 P0 (toggles to 🟢 when on)
- 🔽 **Shoe** button → M64/M65 P1 (dust shoe retract/lower)

**Files modified:**
- [index.html](index.html#L140-160) - Added vacuum-section with buttons
- [app.js](app.js#L108-128) - Added vacuumToggle, dustshoeToggle to element cache
- [app.js](app.js#L1108-1130) - Added click handlers
- [styles.css](styles.css#L2779-2840) - Added vacuum button styles
- [sw.js](sw.js) - Bumped to v11

---

### 2. Keyboard Shortcuts ✅
Implemented all advertised shortcuts that were previously missing.

| Shortcut | Action | Status |
|----------|--------|--------|
| `H` | Home all axes | ✅ |
| `U` | Unlock ($X) | ✅ |
| `0` | Zero all axes | ✅ |
| `V` | Toggle vacuum | ✅ NEW |
| `F` | Fit view | ✅ |
| `T` | Top view | ✅ |
| `I` | Isometric view | ✅ |
| `Ctrl+O` | Open file | ✅ |
| `Shift+Arrow` | 10x jog | ✅ |
| `Space` | Pause/Resume | ✅ (was working) |
| `Esc` | Stop/Cancel | ✅ (was working) |
| `?` | Help | ✅ (was working) |

**Files modified:**
- [app.js](app.js#L1342-1400) - Added switch statement for shortcuts
- [app.js](app.js#L1408-1420) - Added shift tracking for 10x jog
- [app.js](app.js#L1938) - Added V shortcut to help modal

---

## 🎯 Remaining Features

### 3. ATC Quick Controls
**Priority:** MEDIUM | **Effort:** Medium

Add ATC status and quick actions to the main UI, not just hidden in settings.

**Features:**
- Current tool indicator in header
- Quick tool change buttons
- Manual tool release/lock buttons
- Tool length probe shortcut

**Implementation:**
```html
<!-- Add ATC section after tool buttons -->
<div class="atc-controls">
    <div class="atc-status">
        <span class="label">Tool:</span>
        <span id="currentToolDisplay" class="tool-number">T0</span>
    </div>
    <div class="atc-actions">
        <button class="btn btn-sm" onclick="app.atc.changeTool(1)">T1</button>
        <button class="btn btn-sm" onclick="app.atc.changeTool(2)">T2</button>
        <button class="btn btn-sm" onclick="app.atc.changeTool(3)">T3</button>
        <button class="btn btn-sm" onclick="app.atc.changeTool(4)">T4</button>
        <button class="btn btn-sm" onclick="app.atc.changeTool(5)">T5</button>
        <button class="btn btn-sm btn-warning" onclick="app.atc.manualRelease()">Release</button>
    </div>
</div>
```

**Files to modify:**
- [index.html](index.html) - Add ATC controls section
- [macros.js](macros.js) - Add manualRelease() method
- [styles.css](styles.css) - Style ATC controls

---

### 4. Quick Actions Bar Enhancement
**Priority:** LOW | **Effort:** Small

Add more quick action buttons:
- Spindle toggle (current RPM or last RPM)
- Coolant toggle (flood)
- Vacuum toggle ✅ (done via keyboard V)
- Surface scan shortcut

---

### 5. Spindle Speed Presets Enhancement
**Priority:** LOW | **Effort:** Small

Current presets: 6K, 12K, 18K, 24K
- Add customizable presets via settings
- Show current RPM in header when running

---

### 6. Mobile-Friendly Jog Gestures
**Priority:** LOW | **Effort:** Large

For pendant.html touch UI:
- Swipe gestures for XY jog
- Pinch for Z axis
- Double-tap to zero

---

## 🔧 Firmware Tasks (BTT Octopus Pro)

### Configuration Applied
- **EEPROM:** AT24C32 (32Kbit = 4KB) → `EEPROM_ENABLE=32` ✅
- **SD Card:** SDIO interface → `SDCARD_ENABLE=1` ✅
- **Trinamic:** Disabled (using standalone VREF mode) ✅
- **Probe:** Enabled on PB6 (Z-Probe Left) ✅
- **Tool Setter:** Enabled on PB7 (Z-Probe Right) ✅

### Pending Tests
After flashing new firmware (255KB):

1. **EEPROM Persistence Test:**
   ```
   $10=1       ; Change a setting
   ; Power cycle
   $$          ; Verify $10=1 persists
   ```

2. **SD Card Test:**
   ```
   $FM         ; Mount SD card
   $F          ; List files
   $F=/test.nc ; Upload test file
   $FR=/test.nc ; Run from SD
   ```

3. **Aux Output Test (Vacuum):**
   ```
   M64 P0      ; Vacuum ON
   M65 P0      ; Vacuum OFF
   M64 P1      ; Dust shoe retract
   M65 P1      ; Dust shoe extend
   ```

### Firmware Location
```
E:\Programming Projects\grblHAL-STM32F4\.pio\build\btt_octopus_pro_f429\firmware.bin
```

Size: 255KB (reduced from 269KB after disabling Trinamic UART)

---

## 📂 File Map

| File | Purpose | Lines | Modified |
|------|---------|-------|----------|
| `index.html` | Main UI layout | - | ✅ v=5 cache bust |
| `app.js` | Main coordinator | 4,900+ | ✅ Shortcuts, vacuum |
| `machine-enhancements.js` | **ML Intelligence System** | **5,700+** | ✅ NEW |
| `chatter-detection.js` | ESP32 vibration analysis | 6,100+ | ✅ |
| `styles.css` | Styling | - | ✅ Vacuum styles |
| `sw.js` | Service worker | - | ✅ v11 |
| `macros.js` | ATC + macros | - | ⏳ (ATC next) |
| `grblhal.js` | Transport layer | - | ✅ M64/M65 |
| `dual-serial.js` | Dual port comms | - | ✅ |
| `grblhal-settings.js` | grblHAL settings | - | ✅ |
| `sensorless-system.js` | StallGuard homing | - | ✅ |
| `smart-machine.js` | Machine profiles | - | ✅ |
| `FEATURE_ROADMAP.md` | This document | - | ✅ |
| `docs/MACHINE_ENHANCEMENTS.md` | ML system docs | - | ✅ NEW |

---

## 📋 Implementation Status

1. ✅ **Vacuum button** - Done! Toggle in header
2. ✅ **Keyboard shortcuts** - H/U/0/V/F/T/I/Ctrl+O all work
3. ⏳ **ATC quick controls** - Next up
4. ✅ **Cache version bump** - v11 → v=5 for ML update
5. ✅ **ML Intelligence System** - 5,700+ lines, fully integrated
6. ✅ **Neural Network** - 7→12→3 architecture with NaN protection
7. ✅ **Emergency Procedures** - ALARM:1-13 handling
8. ✅ **Crash Detection** - TMC2209 StallGuard integration
9. ✅ **ESP32 Chatter Integration** - Field names aligned
10. ✅ **VFD Modbus Monitoring** - Current, RPM, temperature
11. ✅ **Thermal Compensation** - Spindle warm-up tracking
12. ✅ **Anomaly Detection** - Statistical monitoring
13. ✅ **Tool Life Tracking** - Runtime and wear prediction
14. ✅ **Safety Systems** - Coolant, environmental, UPS monitoring

---

## Notes

- Vacuum is on **Port 0** (M64/M65 P0)
- Dust shoe retract is on **Port 1** (M64/M65 P1) 
- Flood coolant is M8, Mist is M7, Off is M9
- Spindle uses M3 (CW), M4 (CCW), M5 (stop)
- grblHAL settings persist in EEPROM (now fixed to 32Kbit size)
- **Intelligence cycle runs at 10Hz**, UI updates at 2Hz
- **Neural network inputs**: audio, vibration, current, RPM, feed, DOC, material
- **Neural network outputs**: quality, chatterRisk, toolWearRate
