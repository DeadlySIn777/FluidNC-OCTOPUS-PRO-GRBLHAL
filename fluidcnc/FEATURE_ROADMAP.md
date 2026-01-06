# FluidCNC Feature Roadmap

## Current Status (v11)
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

| File | Purpose | Modified in v11 |
|------|---------|-----------------|
| `index.html` | Main UI layout | ✅ Added vacuum section |
| `app.js` | Main coordinator | ✅ Shortcuts, vacuum toggle |
| `styles.css` | Styling | ✅ Vacuum button styles |
| `sw.js` | Service worker | ✅ Bumped to v11 |
| `macros.js` | ATC + macros | ⏳ (ATC controls next) |
| `grblhal.js` | Transport layer | ✅ Has M64/M65 support |
| `FEATURE_ROADMAP.md` | This document | ✅ Created |

---

## 📋 Implementation Status

1. ✅ **Vacuum button** - Done! Toggle in header
2. ✅ **Keyboard shortcuts** - H/U/0/V/F/T/I/Ctrl+O all work
3. ⏳ **ATC quick controls** - Next up
4. ✅ **Cache version bump** - v11

---

## Notes

- Vacuum is on **Port 0** (M64/M65 P0)
- Dust shoe retract is on **Port 1** (M64/M65 P1) 
- Flood coolant is M8, Mist is M7, Off is M9
- Spindle uses M3 (CW), M4 (CCW), M5 (stop)
- grblHAL settings persist in EEPROM (now fixed to 32Kbit size)
