# Hardware Additions for FluidCNC

Complete wiring and setup guide for all hardware components.

---

## 📋 System Components Overview

| Component | Model | Purpose | Connection |
|-----------|-------|---------|------------|
| **CNC Controller** | BTT Octopus Pro v1.1 | Motion control (grblHAL) | USB Serial |
| **Stepper Drivers** | TMC2209 (UART) | Motor control | Onboard sockets |
| **Spindle** | VFD + 2.2kW Spindle | Cutting | Modbus RS485 |
| **Host SBC** | LePotato / Raspberry Pi 4 | Python bridge server | Ethernet |
| **Chatter Sensor** | Waveshare ESP32-S3 Touch LCD | Vibration detection | USB Serial |
| **Camera** | Seeed XIAO ESP32S3 Sense | Machine monitoring | USB + WiFi AP |
| **E-STOP** | Industrial NO mushroom | Emergency stop | Octopus GPIO |
| **Limit Switches** | Mechanical/Inductive | Homing + protection | Octopus GPIO |
| **Tool Setter** | Electrical probe | Tool length measurement | Probe input |

---

## 1. BTT Octopus Pro v1.1 Wiring

### Power Input
```
24V PSU ──────────────────────► POWER INPUT (Green connector)
                                ├── VIN (24V)
                                └── GND
```
⚠️ **CRITICAL**: Ensure 24V PSU is rated for at least 10A for all steppers + VFD logic.

### Stepper Driver Sockets (TMC2209 UART Mode)

```
┌─────────────────────────────────────────────────────────────────┐
│                    OCTOPUS PRO v1.1 DRIVER LAYOUT               │
│                                                                 │
│   DRIVER_0   DRIVER_1   DRIVER_2   DRIVER_3   DRIVER_4         │
│   ┌─────┐    ┌─────┐    ┌─────┐    ┌─────┐    ┌─────┐          │
│   │ X   │    │ Y   │    │ Z   │    │ A   │    │(ext)│          │
│   │TMC  │    │TMC  │    │TMC  │    │TMC  │    │     │          │
│   │2209 │    │2209 │    │2209 │    │2209 │    │     │          │
│   └─────┘    └─────┘    └─────┘    └─────┘    └─────┘          │
│                                                                 │
│   UART addresses: X=0, Y=1, Z=2, A=3 (set via jumpers/solder)   │
└─────────────────────────────────────────────────────────────────┘
```

### Stepper Motor Connections
```
MOTOR_0 ────────► X-Axis Stepper (4-wire: A1, A2, B1, B2)
MOTOR_1 ────────► Y-Axis Stepper (or dual Y with MOTOR_2)
MOTOR_2 ────────► Z-Axis Stepper
MOTOR_3 ────────► A-Axis / Rotary (optional)
```

---

## 2. E-STOP Button (CRITICAL SAFETY)

### Wiring (Normally Open - NO)
```
┌─────────────────────────────────────────────────────────────────┐
│                        E-STOP WIRING                            │
│                                                                 │
│   Industrial E-STOP Button (NO contact)                         │
│   ┌───────────────────┐                                        │
│   │   ●───────────●   │ ◄── Mushroom head (push to activate)   │
│   │   │           │   │                                        │
│   │   │   [NO]    │   │ ◄── Normally Open contacts             │
│   │   │           │   │                                        │
│   │   ●───────────●   │                                        │
│   └───┬───────────┬───┘                                        │
│       │           │                                             │
│       ▼           ▼                                             │
│    ESTOP_IN      GND                                            │
│    (Octopus)   (Octopus)                                        │
│                                                                 │
│   BEHAVIOR:                                                     │
│   • Released: Circuit OPEN → Machine runs                       │
│   • Pressed: Circuit CLOSED → ALARM:10 triggered                │
│   • Twist to release, then send $X to unlock                    │
└─────────────────────────────────────────────────────────────────┘
```

### grblHAL Configuration
```
$37=0      ; E-Stop input invert (0=NO button, 1=NC button)
```

> 💡 Use NO (Normally Open) so pressing E-STOP closes circuit = triggers alarm.
> Some prefer NC (Normally Closed) as fail-safe (wire break = stop).

---

## 3. Limit Switches

### Wiring (Per Axis)
```
┌─────────────────────────────────────────────────────────────────┐
│                     LIMIT SWITCH WIRING                         │
│                                                                 │
│   Each axis has ONE switch (NO or NC)                           │
│                                                                 │
│   Inductive Proximity Sensor (recommended):                     │
│   ┌──────────────┐                                              │
│   │   [SENSOR]   │                                              │
│   └──┬───┬───┬───┘                                              │
│      │   │   │                                                  │
│     VCC GND SIGNAL                                              │
│      │   │   │                                                  │
│      │   │   └───────────────► X_STOP (or Y_STOP, Z_STOP)       │
│      │   └───────────────────► GND                              │
│      └───────────────────────► 24V (for NPN type)               │
│                                  or 5V (for 5V sensors)         │
│                                                                 │
│   Mechanical Microswitch:                                       │
│   ┌──────────────┐                                              │
│   │ [SWITCH NO]  │                                              │
│   └──┬───────┬───┘                                              │
│      │       │                                                  │
│   COM/GND  SIGNAL                                               │
│      │       │                                                  │
│      └───────┼───────────────► GND                              │
│              └───────────────► X_STOP (internal pullup)         │
└─────────────────────────────────────────────────────────────────┘
```

### Pin Assignments (Octopus Pro v1.1)
| Axis | Connector | GPIO |
|------|-----------|------|
| X | DIAG0 / X_STOP | PG6 |
| Y | DIAG1 / Y_STOP | PG9 |
| Z | DIAG2 / Z_STOP | PG10 |
| A | DIAG3 | PG11 |

### grblHAL Configuration
```
$5=0       ; Limit pins invert (0=NO switches, 1=NC switches)
$20=1      ; Soft limits enable (after homing works)
$21=1      ; Hard limits enable
$22=1      ; Homing enable
$23=0      ; Homing direction invert (bit mask)
$24=50     ; Homing slow feed (mm/min)
$25=500    ; Homing seek rate (mm/min)
$26=250    ; Homing debounce (ms)
$27=5.0    ; Homing pull-off (mm)
```

---

## 4. Spindle (VFD + Modbus)

### Connection
```
┌─────────────────────────────────────────────────────────────────┐
│                    VFD MODBUS CONNECTION                        │
│                                                                 │
│   Octopus Pro               RS485 Adapter           VFD         │
│   ┌──────────┐              ┌──────────┐         ┌─────────┐   │
│   │ TX (PA9) │──────────────│ DI/TX    │─────────│ RS485+  │   │
│   │ RX (PA10)│──────────────│ RO/RX    │─────────│ RS485-  │   │
│   │ GND      │──────────────│ GND      │─────────│ GND     │   │
│   └──────────┘              └──────────┘         └─────────┘   │
│                                                                 │
│   VFD Settings:                                                 │
│   • Slave ID: 1                                                 │
│   • Baud Rate: 9600 or 19200                                    │
│   • Protocol: Modbus RTU                                        │
│   • Control: RS485 (not panel)                                  │
└─────────────────────────────────────────────────────────────────┘
```

### grblHAL VFD Configuration
```
$33=1      ; Spindle PWM as enable (if using PWM backup)
$395=1     ; VFD type (1=Huanyang, 2=Modbus generic, etc.)
$396=1     ; VFD Modbus slave ID
$397=9600  ; VFD baud rate
```

### VFD Data Integration with ML System

The `machine-enhancements.js` module reads VFD data for the neural network:

```javascript
// Data polled from VFD via Modbus
hardwareState.vfd = {
    current: 12.5,      // Motor current (amps) → neural network input
    rpm: 18000,         // Actual spindle RPM
    temperature: 45.2   // Inverter temperature
};

// Used by ML for:
// - Cut quality prediction
// - Chatter risk assessment
// - Tool wear rate estimation
// - ALARM:13 detection (VFD faults)
```

> 💡 **No relay needed!** Modbus controls VFD directly. Spindle start/stop is via Modbus commands.

---

## 5. Tool Setter (Electrical Probe)

### Principle
When tool touches metal setter, it completes a circuit:
```
Ground ← Spindle Body ← Tool ← Setter Body → Probe Input
```

### Wiring
```
┌─────────────────────────────────────────────────────────────────┐
│                    TOOL SETTER WIRING                           │
│                                                                 │
│                    ┌─────────────────┐                          │
│                    │   SPINDLE       │                          │
│                    │   (Grounded)    │◄── Ground brush/braid    │
│                    └────────┬────────┘                          │
│                             │ Metal contact                     │
│                             ▼                                   │
│                    ┌─────────────────┐                          │
│                    │     TOOL        │                          │
│                    │   (Conductive)  │                          │
│                    └────────┬────────┘                          │
│                             │ Touches                           │
│                             ▼                                   │
│  ┌──────────────┐  ┌─────────────────┐                          │
│  │ OCTOPUS PRO  │  │   TOOL SETTER   │                          │
│  │              │  │   (Metal body)  │                          │
│  │  PROBE_IN ◄──┼──┤   Heavy spring  │                          │
│  │              │  │   Bolted to bed │                          │
│  │  GND ────────┼──┤                 │                          │
│  └──────────────┘  └─────────────────┘                          │
└─────────────────────────────────────────────────────────────────┘
```

### Physical Construction
1. **Base plate**: 6061 aluminum, 50x50x10mm, bolted to bed
2. **Contact surface**: Hardened steel or brass button (replaceable)
3. **Spring**: Heavy duty compression spring (prevents tool damage)
4. **Wire**: 18-22 AWG to probe input + ground

### grblHAL Configuration
```
$6=0       ; Probe pin invert (0=NC style, 1=NO style)
$14=0      ; Probe input enable
```

### Test Probe
```gcode
?
```
Look for `Pn:P` in response when tool touches setter.

---

## 6. Waveshare ESP32-S3 Touch LCD 1.46B (Chatter Sensor)

### Purpose
- Real-time vibration detection via onboard accelerometer
- Beautiful round touch display shows chatter level
- USB Serial sends data to FluidCNC
- **Integrated with ML Intelligence System** (machine-enhancements.js)

### Connection
```
Waveshare ESP32-S3 ───USB───► USB Hub ───USB───► LePotato/Pi
```

### Firmware Upload
```bash
cd fluidcnc/chatter-waveshare-s3
pio run --target upload
```

### Serial Protocol
```json
{"audioLevel": 245, "vibrationG": 0.45, "status": "running", "accelX": 0.1, "accelY": 0.2, "accelZ": 0.9}
```
Sent at 10Hz over USB Serial @ 115200 baud.

### Data Flow to ML System
```javascript
// In chatter-detection.js
state.vibrationG    // G-force magnitude
state.audioLevel    // FFT audio level
state.status        // "idle", "running", etc.

// Consumed by machine-enhancements.js
_updateFromChatter(state) {
    this.hardwareState.chatter.vibration = state.vibrationG;
    this.hardwareState.chatter.audio = state.audioLevel;
}
```

### LED Indicators
| Color | Meaning |
|-------|---------|
| 🟢 Green | Chatter < 0.3 (good) |
| 🟡 Yellow | Chatter 0.3-0.7 (warning) |
| 🔴 Red | Chatter > 0.7 (reduce feed!) |

---

## 7. XIAO ESP32S3 Sense (Camera)

### Features
- OV2640 Camera (2MP)
- PDM Microphone
- WiFi AP mode (no router needed)
- USB-C power

### Connection
```
XIAO ESP32S3 ───USB───► USB Hub (power only, WiFi for data)
```

### Firmware Upload
```bash
cd fluidcnc/xiao-camera
pio run --target upload
```

### Access Camera
1. Power XIAO via USB
2. Connect phone/PC to WiFi: `FluidCNC-Camera` (password: `fluidcnc123`)
3. Open browser: `http://192.168.4.1`
4. Stream appears in FluidCNC camera panel

---

## 8. 5V Laser Crosshair (Optional)

### Purpose
Project crosshair on workpiece for alignment without spinning spindle.

### Wiring
```
Laser Module
├── VCC (Red) ────► 5V (from Octopus 5V or separate supply)
├── GND (Black) ──► GND
└── Control ──────► Spare GPIO (optional on/off control)
```

### Mounting
- Mount parallel to spindle axis
- Known offset from spindle center (configure in UI)
- Or mount coaxially if space allows

---

## 9. Complete Wiring Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          COMPLETE CNC WIRING                                │
│                                                                             │
│  24V PSU ──────────────────────┬──────────────────────────────────────────┐ │
│                                │                                          │ │
│                                ▼                                          │ │
│  ┌─────────────────────────────────────────────────────────────────────┐  │ │
│  │                      BTT OCTOPUS PRO v1.1                           │  │ │
│  │                                                                     │  │ │
│  │  POWER ◄─────── 24V/GND                                             │  │ │
│  │                                                                     │  │ │
│  │  DRIVERS:  ┌────┐ ┌────┐ ┌────┐ ┌────┐                              │  │ │
│  │            │ X  │ │ Y  │ │ Z  │ │ A  │  (TMC2209 UART)              │  │ │
│  │            └─┬──┘ └─┬──┘ └─┬──┘ └─┬──┘                              │  │ │
│  │              │      │      │      │                                 │  │ │
│  │  MOTORS:     ▼      ▼      ▼      ▼                                 │  │ │
│  │           X-Motor Y-Motor Z-Motor A-Motor                           │  │ │
│  │                                                                     │  │ │
│  │  ENDSTOPS:                                                          │  │ │
│  │   X_STOP ◄─────── X Limit Switch                                    │  │ │
│  │   Y_STOP ◄─────── Y Limit Switch                                    │  │ │
│  │   Z_STOP ◄─────── Z Limit Switch                                    │  │ │
│  │                                                                     │  │ │
│  │  SAFETY:                                                            │  │ │
│  │   ESTOP_IN ◄───── E-STOP Button (NO)                                │  │ │
│  │   PROBE ◄──────── Tool Setter                                       │  │ │
│  │                                                                     │  │ │
│  │  SPINDLE:                                                           │  │ │
│  │   TX/RX ◄─────────RS485 Adapter ◄──────── VFD (Modbus)              │  │ │
│  │                                                                     │  │ │
│  │  USB ──────────────────────────────────────────────────────────┐    │  │ │
│  └─────────────────────────────────────────────────────────────────│────┘  │ │
│                                                                    │       │ │
│  ┌────────────────────────────────────────────────────────────────┐│       │ │
│  │                     USB 3.0 HUB (Powered)                      ││       │ │
│  │                                                                ││       │ │
│  │   ┌──────┐      ┌──────┐       ┌──────┐       ┌──────┐        ││       │ │
│  │   │Port 1│      │Port 2│       │Port 3│       │Port 4│        ││       │ │
│  │   └──┬───┘      └──┬───┘       └──┬───┘       └──┬───┘        ││       │ │
│  │      │             │              │              │            ││       │ │
│  │      ▼             ▼              ▼              ▼            ││       │ │
│  │   Octopus      Waveshare       XIAO          (spare)          ││       │ │
│  │   Pro          Chatter        Camera                          ││       │ │
│  └──────────────────────────────────┬────────────────────────────┘│       │ │
│                                     │                              │       │ │
│                                     │ USB                          ◄───────┘ │
│                                     ▼                                        │
│  ┌───────────────────────────────────────────────────────────────────────┐   │
│  │                    LEPOTATO / RASPBERRY PI                            │   │
│  │                                                                       │   │
│  │   USB ◄─────── USB Hub                                                │   │
│  │   ETH ◄─────── Ethernet (to network/router)                           │   │
│  │                                                                       │   │
│  │   Running: python3 server.py                                          │   │
│  │   Serving: http://<ip>:8080                                           │   │
│  └───────────────────────────────────────────────────────────────────────┘   │
│                                     │                                        │
│                                     │ WebSocket                              │
│                                     ▼                                        │
│  ┌───────────────────────────────────────────────────────────────────────┐   │
│  │            ANY DEVICE (Phone, Tablet, Laptop, Desktop)                │   │
│  │                                                                       │   │
│  │   Chrome/Edge/Safari → http://<lepotato-ip>:8080                      │   │
│  └───────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 10. Parts List

| Item | Qty | ~Cost | Source |
|------|-----|-------|--------|
| BTT Octopus Pro v1.1 | 1 | $45 | Amazon/AliExpress |
| TMC2209 Drivers | 4-6 | $5 each | Amazon/AliExpress |
| LePotato or Pi 4 | 1 | $35-55 | Amazon |
| Powered USB 3.0 Hub | 1 | $15 | Amazon |
| Waveshare ESP32-S3 Touch 1.46B | 1 | $25 | Waveshare |
| XIAO ESP32S3 Sense | 1 | $15 | Seeed Studio |
| Industrial E-STOP Button | 1 | $10 | Amazon |
| Inductive Limit Switches (NPN) | 3 | $3 each | Amazon/AliExpress |
| VFD (Huanyang or similar) | 1 | $80+ | Amazon/AliExpress |
| 2.2kW Spindle Motor | 1 | $150+ | Amazon/AliExpress |
| RS485 to TTL Adapter | 1 | $3 | Amazon |
| Tool Setter (DIY) | 1 | $10 | DIY |
| 24V 10A PSU | 1 | $20 | Amazon |

**Total: ~$450-550** (excluding spindle/VFD and mechanical parts)

---

## 11. Quick Start Checklist

### Wiring
- [ ] 24V PSU → Octopus Pro power input
- [ ] TMC2209 drivers installed in correct sockets
- [ ] Stepper motors wired (4-wire: A1, A2, B1, B2)
- [ ] Limit switches wired to X/Y/Z_STOP + GND
- [ ] E-STOP wired to ESTOP_IN + GND
- [ ] Tool setter wired to PROBE + GND
- [ ] VFD connected via RS485 adapter
- [ ] USB hub connected to LePotato/Pi

### Firmware
- [ ] grblHAL flashed to Octopus Pro
- [ ] Chatter firmware flashed to Waveshare
- [ ] Camera firmware flashed to XIAO

### Configuration
- [ ] grblHAL settings configured ($1, $5, $6, $20-27, $100-102, etc.)
- [ ] VFD parameters set for Modbus control
- [ ] TMC2209 current limits set

### Software
- [ ] Python + packages installed on LePotato/Pi
- [ ] FluidCNC files copied
- [ ] server.py running (or systemd service enabled)
- [ ] Browser can access UI

### Testing
- [ ] Jog all axes (check direction, invert $3 if needed)
- [ ] Home all axes (check switch triggers)
- [ ] Test E-STOP (should trigger ALARM:10)
- [ ] Test probe (? command shows Pn:P when triggered)
- [ ] Test spindle (M3 S12000 starts, M5 stops)
- [ ] Test chatter sensor (shows data in UI)
- [ ] Test camera (stream visible)

---

## 📞 Support

- See main [README.md](../README.md) for troubleshooting
- See [LEPOTATO_SETUP.md](LEPOTATO_SETUP.md) for SBC setup
