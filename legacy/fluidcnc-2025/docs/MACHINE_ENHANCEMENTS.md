# 🧠 Machine Enhancements - ML Intelligence System

## Overview

`machine-enhancements.js` (5,700+ lines) provides a comprehensive machine learning intelligence layer for FluidCNC. It integrates real-time sensor data from multiple sources to predict cut quality, prevent crashes, and optimize machining operations.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                    MachineEnhancements Class                         │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌──────────────────┐    ┌──────────────────┐    ┌───────────────┐  │
│  │  Neural Network  │    │  Safety Systems  │    │  Maintenance  │  │
│  │  - 7 inputs      │    │  - ALARM:1-13    │    │  - Tool life  │  │
│  │  - 12 hidden     │    │  - Crash detect  │    │  - Wear rate  │  │
│  │  - 3 outputs     │    │  - Emergency     │    │  - Scheduling │  │
│  └──────────────────┘    └──────────────────┘    └───────────────┘  │
│                                                                      │
│  ┌──────────────────┐    ┌──────────────────┐    ┌───────────────┐  │
│  │  Thermal Comp    │    │  Anomaly Detect  │    │  Voice Alerts │  │
│  │  - Warm-up track │    │  - Statistics    │    │  - Speech API │  │
│  │  - Compensation  │    │  - Thresholds    │    │  - Alerts     │  │
│  └──────────────────┘    └──────────────────┘    └───────────────┘  │
│                                                                      │
├─────────────────────────────────────────────────────────────────────┤
│                       Hardware State Integration                     │
├───────────────┬───────────────────┬─────────────────────────────────┤
│ ESP32 Chatter │  grblHAL/TMC2209  │      VFD Modbus                 │
│  - vibrationG │  - StallGuard     │      - motor current            │
│  - audioLevel │  - crash data     │      - RPM                      │
│  - status     │  - alarms         │      - temperature              │
└───────────────┴───────────────────┴─────────────────────────────────┘
```

## Neural Network

### Architecture: 7 → 12 → 3

The neural network uses a simple feed-forward architecture with online learning capability.

### Inputs (7)

| # | Input | Description | Raw Range | Normalized |
|---|-------|-------------|-----------|------------|
| 1 | audioLevel | Chatter sensor audio | 0-1024 | 0.0-1.0 |
| 2 | accelMagnitude | Vibration G-force | 0-20G | 0.0-1.0 |
| 3 | motorCurrent | VFD motor load | 0-100% | 0.0-1.0 |
| 4 | spindleRpm | Current spindle RPM | 0-24000 | 0.0-1.0 |
| 5 | feedRate | Current feed mm/min | 0-10000 | 0.0-1.0 |
| 6 | depthOfCut | Depth of cut mm | 0-15mm | 0.0-1.0 |
| 7 | materialHardness | Material index | 0-10 | 0.0-1.0 |

### Hidden Layer (12)
- ReLU activation
- Xavier/He initialization
- Online weight updates

### Outputs (3)

| # | Output | Description | Range |
|---|--------|-------------|-------|
| 1 | quality | Predicted cut quality | 0.0-1.0 |
| 2 | chatterRisk | Probability of chatter | 0.0-1.0 |
| 3 | toolWearRate | Tool wear rate | 0.0-1.0 |

### NaN Protection

All calculations include comprehensive NaN guards:

```javascript
// Normalization with range check
if (range === 0) return 0.5;
let normalized = (value - min) / range;
if (!Number.isFinite(normalized)) return 0.5;

// Prediction validation
if (inputs.length !== this.inputSize) return [0.5, 0.5, 0.1];
```

## Data Integration

### ESP32 Chatter Sensor

```javascript
_updateFromChatter(state) {
    this.hardwareState.chatter = {
        audio: state.audioLevel,
        acceleration: state.accelX, state.accelY, state.accelZ,
        vibration: state.vibrationG,  // ← Field name from chatter-detection.js
        status: state.status          // ← Field name from chatter-detection.js
    };
}
```

### grblHAL / TMC2209

```javascript
_updateFromGrbl(response) {
    // Parse StallGuard values from status
    this.hardwareState.stallGuard = { x, y, z };
    
    // Detect alarms
    if (response.includes('ALARM') || response.includes('Door')) {
        this._handleGrblAlarm(this._parseAlarmCode(response));
    }
}
```

### VFD Modbus

```javascript
_updateVfdData(data) {
    this.hardwareState.vfd = {
        current: data.current,
        rpm: data.rpm,
        temperature: data.temperature
    };
}
```

## Emergency Procedures

### Alarm Handling

| Alarm | Type | Automatic Response |
|-------|------|-------------------|
| ALARM:1 | Hard limit triggered | Stop motion, preserve position |
| ALARM:2 | Soft limit exceeded | Halt and alert user |
| ALARM:3 | Abort during cycle | Controlled stop |
| ALARM:4-8 | Various faults | Log and alert |
| ALARM:9 | Homing fail | Retry or manual intervention |
| ALARM:10 | E-STOP pressed | Full system halt |
| ALARM:11-12 | Misc errors | Log and alert |
| ALARM:13 | VFD/Spindle error | Spindle emergency stop |

### Crash Detection

Uses TMC2209 StallGuard for real-time load sensing:

```javascript
detectCrash(sgValues) {
    // Rapid load spike detection
    if (this.lastSG && Math.abs(sgValues.x - this.lastSG.x) > 50) {
        this.triggerControlledDeceleration();
        this.preserveState();
    }
}
```

### Emergency Modal

```html
<!-- Emergency stop button triggers -->
onclick="app.enhancements.triggerEmergency('crash')"
```

## Safety Monitoring

### Coolant/Chiller
- Integrated via door pin (M62/M63)
- Monitors flow rate
- Pauses job on low flow

### Environmental
- Fire/smoke detection ready
- Gas detection ready
- Temperature monitoring

### UPS Power
- State monitoring
- Checkpoint save on battery
- Graceful shutdown procedure

## Thermal Compensation

Tracks spindle warm-up and applies compensation:

```javascript
updateThermalCompensation(temperature) {
    // Validate temperature (-40 to 100°C)
    if (temperature < -40 || temperature > 100) return;
    
    // Track warm-up phase
    if (this.spindleRunTime < 600) {
        this.thermalOffset = this.calculateOffset(temperature);
    }
}
```

## Timing

| Interval | Rate | Purpose |
|----------|------|---------|
| intelligenceInterval | 10 Hz (100ms) | ML predictions |
| uiUpdateInterval | 2 Hz (500ms) | UI refresh |
| grblCheckInterval | Variable | Status polling |
| vfdCheckInterval | Variable | Modbus polling |
| maintenanceInterval | Variable | Tool life checks |

## API Reference

### Initialization

```javascript
// Created by app.js
app.enhancements = new MachineEnhancements({
    app: this,
    serial: this.dualSerial,
    chatterSystem: this.chatterDetection
});

// Called during app init
app.enhancements.init();
```

### Methods

```javascript
// Intelligence
getIntelligenceStatus()           // Returns { quality, chatterRisk, toolWear }
predict(inputs)                   // Neural network prediction
train(inputs, targets, learningRate)  // Online learning

// Safety
triggerEmergency(type)            // Trigger emergency procedure
_handleGrblAlarm(code)            // Handle ALARM:N codes
detectAnomaly(sensorData)         // Statistical anomaly detection

// Monitoring
updateThermalCompensation(temp)   // Thermal tracking
getMaintenanceStatus()            // Tool life, wear rates

// Cleanup
destroy()                         // Stop all intervals
```

### Events

The system responds to:
- grblHAL ALARM states
- ESP32 chatter sensor data
- VFD Modbus data
- Door/limit switch triggers

## Troubleshooting

### "Neural network returning NaN"
All calculations are NaN-protected. If you see NaN:
1. Check sensor data validity
2. Verify hardwareState is populated
3. Check console for validation warnings

### "Emergency modal not working"
Verify the onclick handler uses `app.enhancements`:
```javascript
// Correct
onclick="app.enhancements.triggerEmergency('crash')"

// Incorrect
onclick="machineEnhancements.triggerEmergency('crash')"
```

### "Chatter data not updating"
Verify field names match chatter-detection.js:
- Use `state.vibrationG` not `state.vib`
- Use `state.status` not `state.state`

### "Intervals not stopping"
Call `destroy()` to clean up all intervals:
```javascript
app.enhancements.destroy();
```

## Files

| File | Purpose |
|------|---------|
| `machine-enhancements.js` | Main 5,700+ line module |
| `chatter-detection.js` | ESP32 sensor integration (6,100+ lines) |
| `smart-machine.js` | StallGuard calibration |
| `sensorless-system.js` | Sensorless homing |
| `grblhal-settings.js` | Settings management |

## Version History

- **v5**: Added setupMachineLearning(), alarm handling, NaN protection
- **v4**: Added neural network, emergency procedures
- **v3**: Added thermal compensation, anomaly detection
- **v2**: Added tool life tracking, voice alerts
- **v1**: Initial implementation
