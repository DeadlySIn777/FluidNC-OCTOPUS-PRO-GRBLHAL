# 🧠 Smart Machine System

## Overview

The Smart Machine System transforms your CNC from a dumb executor into a self-aware, self-calibrating machine. Using **TMC2209 StallGuard** feedback, the machine can:

- **Self-calibrate** - Measure its own work envelope automatically
- **Sensorless home** - No limit switches needed
- **Detect crashes** - Stop immediately when hitting obstacles
- **Auto-tune motors** - Find optimal current/StallGuard thresholds
- **Monitor load** - Real-time motor load visualization
- **Adaptive feed** - Automatically adjust feed rate based on load
- **Crash recovery** - Automatically back off and recover

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        FluidCNC Web UI                               │
├─────────────────────────────────────────────────────────────────────┤
│  MachineEnhancements    │  SmartMachine   │  ChatterDetection       │
│  - Neural network ML    │  - Profile mgmt │  - ESP32 sensor         │
│  - Emergency procedures │  - Calibration  │  - Vibration analysis   │
│  - Crash prevention     │  - Monitoring   │  - Audio FFT            │
│  - Tool life tracking   │                 │                         │
│  - Thermal compensation │                 │                         │
├─────────────────────────────────────────────────────────────────────┤
│  AutoTuner   │  SensorlessSystem          │  GrblHALSettings        │
│  - Current   │  - Homing                  │  - $xxx settings        │
│  - Resonance │  - Crash detect            │  - TMC2209 config       │
│  - Dynamics  │  - Position verify         │  - Presets              │
├─────────────────────────────────────────────────────────────────────┤
│                      DualSerialManager                               │
│  - WebSerial to grblHAL (USB CDC)                                   │
│  - StallGuard parsing from status                                   │
│  - ESP32 chatter sensor (second serial port)                        │
├─────────────────────────────────────────────────────────────────────┤
│                        grblHAL                                       │
│  - TMC2209 UART drivers                                              │
│  - StallGuard reporting (SG:x,y,z in status)                        │
│  - Sensorless homing                                                 │
│  - VFD Modbus (spindle current, RPM, temperature)                   │
└─────────────────────────────────────────────────────────────────────┘
```

## Files

| File | Description | Lines |
|------|-------------|-------|
| `machine-enhancements.js` | **ML intelligence, safety, emergency procedures** | **5,700+** |
| `chatter-detection.js` | ESP32 sensor integration, vibration analysis | 6,100+ |
| `smart-machine.js` | Core machine profile, calibration, monitoring | - |
| `auto-tuner.js` | Motor current and dynamics optimization | - |
| `sensorless-system.js` | Homing, crash detection, position verification | - |
| `grblhal-settings.js` | grblHAL $ settings manager | - |

## Features

### 0. ML Intelligence System (machine-enhancements.js)

The MachineEnhancements class provides a comprehensive ML-powered intelligence layer:

#### Neural Network (7→12→3)
```javascript
Inputs:
  audioLevel (0-1024)     → normalized → 
  accelMagnitude (0-20G)  → normalized →   Hidden Layer    →  quality (0-1)
  motorCurrent (0-100%)   → normalized →   (12 neurons)    →  chatterRisk (0-1)
  spindleRpm (0-24000)    → normalized →                   →  toolWearRate (0-1)
  feedRate (0-10000)      → normalized →
  depthOfCut (0-15mm)     → normalized →
  materialHardness (0-10) → normalized →
```

#### Emergency Procedures
Handles all grblHAL alarm codes (ALARM:1-13):
- **ALARM:1**: Hard limit → Stop, preserve position
- **ALARM:2**: Soft limit → Halt and alert
- **ALARM:9**: Homing fail → Retry or manual
- **ALARM:10**: E-STOP → Full system halt
- **ALARM:13**: VFD error → Spindle emergency stop

#### Data Integration
```
ESP32 Chatter Sensor → _updateFromChatter() → hardwareState.chatter
grblHAL (TMC2209)    → _updateFromGrbl()    → hardwareState.stallGuard
VFD Modbus           → _updateVfdData()     → hardwareState.vfd
```

#### Safety Systems
- Crash detection via StallGuard load monitoring
- Coolant/chiller monitoring via door pin
- Fire/smoke/gas detection ready
- UPS power state awareness
- Thermal compensation for spindle warm-up

### 1. Self-Calibration Wizard

Click **⚡ Calibrate** to run the full calibration sequence:

1. **StallGuard Calibration** - Moves each axis to find no-load SG baseline
2. **Work Envelope** - Uses sensorless limits to measure travel
3. **Backlash Measurement** - Detects mechanical play using SG
4. **Dynamics Optimization** - Finds max safe speed/acceleration

### 2. Sensorless Homing

No limit switches needed! The machine uses StallGuard to detect when axes hit their limits.

```
Z homes first (raises spindle for safety)
↓
X homes (finds left limit)
↓
Y homes (finds front limit)
↓
All axes: homed
```

### 3. Real-time Load Monitoring

The UI shows load bars for each axis:

```
X: [████████░░░░] 65%
Y: [██░░░░░░░░░░] 15%
Z: [░░░░░░░░░░░░]  0%
```

- **Green** (0-40%): Normal operation
- **Yellow** (40-70%): Elevated load
- **Red** (70-100%): Near stall - reduce feed

### 4. Crash Detection

When StallGuard drops below crash threshold:
1. **Immediate stop** (feed hold + reset)
2. **Alert displayed** with crash location
3. **Auto recovery** - back off 5mm, raise Z

### 5. Adaptive Feed Control

Enable "Adaptive Feed" to automatically adjust feed rate:
- Target: 60% motor load
- Range: 30% - 150% of programmed feed
- Uses PID-like control for smooth adjustment

### 6. Machine Profiles

Save and load machine profiles:
- **Export** - Save to JSON file
- **Import** - Load from file
- **Presets** - High-speed, Quiet, Precision, High-torque

## grblHAL Configuration

The system uses these grblHAL settings:

### TMC2209 Motor Settings
| Setting | Description | Default |
|---------|-------------|---------|
| $140-142 | Run current (mA) | 1800 |
| $143-145 | Hold current (mA) | 500 |
| $150-152 | Microsteps | 16 |
| $160-162 | StallGuard threshold | 60-70 |

### Dynamics
| Setting | Description |
|---------|-------------|
| $110-112 | Max speed (mm/min) |
| $120-122 | Acceleration (mm/s²) |
| $130-132 | Max travel (mm) |

### Homing
| Setting | Description |
|---------|-------------|
| $22 | Homing enable |
| $24 | Homing feed rate |
| $25 | Homing seek rate |
| $27 | Homing pull-off |

## How StallGuard Works

TMC2209 drivers measure back-EMF from the motor to detect load:

```
High SG (200-255) = Low load (free running)
Medium SG (60-150) = Normal cutting load
Low SG (0-60) = High load (possible stall)
SG = 0 = Motor stalled
```

**Calibration Process:**
1. Move axis at various speeds while unloaded
2. Record minimum SG value (worst case)
3. Set threshold at 40% of no-load value
4. This gives margin for cutting while catching crashes

## Requirements

### Hardware
- BTT Octopus Pro (or any STM32 + TMC2209 UART)
- TMC2209 drivers with UART connected
- 24V power supply

### Firmware
- grblHAL with Trinamic support:
  ```ini
  -D TRINAMIC_ENABLE=2209
  -D TRINAMIC_UART_ENABLE=2
  -D TRINAMIC_SG_REPORT=1
  -D SENSORLESS_HOMING_ENABLE=1
  ```

### Browser
- Chrome or Edge (WebSerial support)

## Usage

### First Time Setup

1. Connect to grblHAL via WebSerial
2. Click **⚡ Calibrate** button
3. Wait for full calibration (2-5 minutes)
4. Review results and click **Apply & Save**

### Normal Operation

1. Click **🏠 Smart Home** to home all axes
2. Load your G-code
3. Enable **Adaptive Feed** for automatic optimization
4. Run job - system monitors for crashes

### If Crash Detected

1. Machine stops automatically
2. Review crash location in alert
3. Clear alarm ($X)
4. Re-home before continuing

## Troubleshooting

### "StallGuard not calibrated"
Run the calibration wizard at least once.

### False stall triggers
Increase StallGuard threshold ($160-162).

### Missed stalls
Decrease StallGuard threshold ($160-162).

### No SG data in status
Verify grblHAL built with `TRINAMIC_SG_REPORT=1`.

### Homing overshoots
Decrease homing seek rate ($25) or increase pull-off ($27).

## API Reference

### SmartMachine

```javascript
const sm = new SmartMachine({ serial: dualSerial });

// Full calibration
await sm.runFullCalibration();

// Save/load profile
sm.saveProfile();
const json = sm.exportProfile();
sm.importProfile(json);

// Apply saved settings to grblHAL
await sm.applyProfile();
```

### SensorlessSystem

```javascript
const ss = new SensorlessSystem(smartMachine);

// Home all axes
await ss.homeAll();

// Home single axis
await ss.homeAxis('z');

// Enable/disable crash detection
ss.enableCrashDetection();
ss.disableCrashDetection();
```

### AutoTuner

```javascript
const at = new AutoTuner(smartMachine);

// Find optimal motor currents
await at.tuneMotorCurrents();

// Detect resonance frequencies
await at.detectResonance();

// Create adaptive feed controller
const afc = at.createAdaptiveFeedController();
afc.start();
```

### GrblHALSettings

```javascript
const settings = new GrblHALSettings(dualSerial);

// Read all settings
await settings.readAllSettings();

// Apply machine profile
await settings.applyMachineProfile(profile);

// Apply preset
await settings.applyPreset('high-speed');

// Run diagnostics
const report = await settings.runDiagnostics();
```
