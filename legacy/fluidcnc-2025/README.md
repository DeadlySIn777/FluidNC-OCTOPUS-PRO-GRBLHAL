# FluidCNC - Professional grblHAL Web Interface

[![CI](https://github.com/deadlysin777/fluidcnc/actions/workflows/ci.yml/badge.svg)](https://github.com/deadlysin777/fluidcnc/actions/workflows/ci.yml)
![PWA](https://img.shields.io/badge/PWA-Offline_Ready-brightgreen) ![grblHAL](https://img.shields.io/badge/grblHAL-Compatible-blue) ![WebSerial](https://img.shields.io/badge/WebSerial-Chrome%2FEdge-orange) ![Safety](https://img.shields.io/badge/Safety-Industrial_Grade-red) ![ML](https://img.shields.io/badge/ML-Neural_Network-purple)

A full-featured, safety-focused browser UI for CNC machines running **grblHAL** firmware. Designed for mission-critical operation with real-time monitoring, chatter detection, **comprehensive ML-powered intelligence**, and industrial-grade safety handling.

---

## 🎯 System Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          FLUIDCNC SYSTEM ARCHITECTURE                       │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│    ┌──────────────┐        ┌──────────────┐        ┌──────────────┐        │
│    │   LePotato   │        │  Waveshare   │        │    XIAO      │        │
│    │   or Pi 4    │        │  ESP32-S3    │        │  ESP32-S3    │        │
│    │              │        │  Touch LCD   │        │   Sense      │        │
│    │  Python      │        │              │        │              │        │
│    │  Bridge      │        │  Chatter     │        │   Camera     │        │
│    │  Server      │        │  Detection   │        │   Module     │        │
│    └──────┬───────┘        └──────┬───────┘        └──────┬───────┘        │
│           │                       │                       │                │
│           │ USB Serial            │ USB Serial            │ WiFi AP        │
│           │ 115200 baud           │ 115200 baud           │ 192.168.4.1    │
│           │                       │                       │                │
│    ┌──────┴───────────────────────┴───────────────────────┴───────┐        │
│    │                        USB 3.0 HUB                           │        │
│    └──────────────────────────────┬───────────────────────────────┘        │
│                                   │                                        │
│                                   │ USB Serial                             │
│                                   │ 115200 baud                            │
│                                   ▼                                        │
│    ┌─────────────────────────────────────────────────────────────┐         │
│    │              BTT OCTOPUS PRO v1.1 (STM32F446)               │         │
│    │                                                             │         │
│    │  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐ │         │
│    │  │  grblHAL    │  │ TMC2209     │  │   MODBUS VFD        │ │         │
│    │  │  Firmware   │  │ Drivers     │  │   Spindle Control   │ │         │
│    │  │             │  │ (UART)      │  │                     │ │         │
│    │  └─────────────┘  └─────────────┘  └─────────────────────┘ │         │
│    │                                                             │         │
│    │  PHYSICAL I/O:                                              │         │
│    │  ├── E-STOP (NO contact) → Immediate halt                   │         │
│    │  ├── Limit Switches (X/Y/Z) → Homing + protection           │         │
│    │  ├── Probe Input → Tool setter                              │         │
│    │  └── Door Switch (optional)                                 │         │
│    └─────────────────────────────────────────────────────────────┘         │
│                                   │ 24V Power                              │
│                                   ▼                                        │
│    ┌─────────────────────────────────────────────────────────────┐         │
│    │                      CNC MACHINE                             │         │
│    │    Steppers • Spindle • Limit Switches • E-STOP Button       │         │
│    └─────────────────────────────────────────────────────────────┘         │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 🛠️ Hardware Components

### Required

| Component | Model | Purpose | Power | Connection |
|-----------|-------|---------|-------|------------|
| **CNC Controller** | BTT Octopus Pro v1.1 | Motion control (grblHAL) | 24V DC | USB Serial |
| **Stepper Drivers** | TMC2209 (x4-6) | Motor control (UART mode) | From Octopus | Onboard |
| **Spindle** | VFD + Spindle Motor | Cutting | Separate PSU | Modbus RS485 |
| **E-STOP Button** | NC (Normally Closed) | Emergency stop | - | Octopus GPIO |
| **Limit Switches** | Mechanical or Inductive | Homing + limits | 5V/24V | Octopus GPIO |

### Recommended (SBC Host)

| Component | Option A | Option B | Purpose |
|-----------|----------|----------|---------|
| **Host Computer** | **Le Potato** (AML-S905X-CC) | Raspberry Pi 4 | Runs Python bridge |
| **USB Ports** | 4x USB 2.0 ✅ | 2x USB 3.0 + 2x USB 2.0 ✅ | All devices |
| **Network** | Gigabit Ethernet ✅ | Gigabit Ethernet + WiFi ✅ | Network access |
| **Power** | 5V 2A USB-C | 5V 3A USB-C | SBC power |

### Optional Sensors

| Component | Model | Purpose | Connection |
|-----------|-------|---------|------------|
| **Chatter Sensor** | Waveshare ESP32-S3 Touch LCD 1.46B | Vibration detection + display | USB Serial |
| **VFD Controller** | ESP32 + MAX485 | Modbus RS485 VFD control | USB Serial |
| **Spindle Temp Sensor** | DS18B20 TO-92 | Spindle shell temperature | Waveshare GPIO 16 |
| **Camera** | Seeed XIAO ESP32S3 Sense | Machine monitoring | USB (power) + WiFi AP |
| **Tool Setter** | Electrical probe | Automatic tool length | Probe input |

---

## 📦 Project Structure

```
project/
├── fluidcnc/                    # Main web application
│   ├── index.html               # Entry point
│   ├── app.js                   # Core application (4900+ lines)
│   ├── grblhal.js               # grblHAL communication layer
│   ├── server.py                # Python WebSocket bridge
│   ├── styles.css               # Premium UI styling
│   │
│   ├── # Feature Modules
│   ├── ai-assistant.js          # Natural language CNC commands
│   ├── auto-tuner.js            # Automatic PID/motor tuning
│   ├── camera-module.js         # USB + WiFi camera support
│   ├── chatter-detection.js     # Vibration analysis (6100+ lines)
│   ├── dual-serial.js           # Dual-port serial communication
│   ├── feeds-speeds.js          # Cutting parameter calculator
│   ├── gcode-parser.js          # G-code parsing engine
│   ├── gcode-simulator.js       # Path simulation
│   ├── grblhal-settings.js      # grblHAL settings manager
│   ├── job-queue.js             # Multi-file job management
│   ├── job-recovery.js          # Power-loss recovery
│   ├── machine-enhancements.js  # ML Intelligence System (5700+ lines)
│   ├── motion-planner.js        # Path optimization
│   ├── probe-wizard.js          # Probing routines
│   ├── sd-card.js               # SD card management
│   ├── sensorless-system.js     # StallGuard homing
│   ├── smart-machine.js         # AI decision making
│   ├── tool-setter.js           # Tool length compensation
│   │
│   ├── chatter-waveshare-s3/    # ESP32 chatter sensor firmware
│   ├── xiao-camera/             # ESP32 camera firmware
│   ├── docs/                    # Documentation
│   ├── tests/                   # Test utilities
│   └── icons/                   # PWA icons
│
├── grblhal-octopus-pro-v11/     # Firmware configuration
│   ├── platformio_octopus_pro_v11.ini
│   ├── README.md
│   ├── CABLEADO.md              # Wiring guide (Spanish)
│   └── build_and_flash.bat
│
├── esp32-vfd-controller/        # ESP32 Modbus VFD Controller
│   ├── platformio.ini           # PlatformIO config
│   └── src/main.cpp             # H100 VFD Modbus control
│
├── grblHAL-STM32F4/             # grblHAL source code (submodule)
│   ├── platformio.ini
│   ├── Inc/                     # Headers
│   ├── Src/                     # Source files
│   └── ...
│
└── fluidcnc.code-workspace      # VS Code workspace
```

---

## 🚀 Quick Start

### Option 1: Windows/Mac (Development)

```bash
cd fluidcnc
python -m http.server 8080
# Open http://localhost:8080 in Chrome/Edge
```

### Option 2: LePotato/Raspberry Pi (Production)

See [docs/LEPOTATO_SETUP.md](docs/LEPOTATO_SETUP.md) for complete instructions.

```bash
# Install dependencies
sudo apt update && sudo apt install -y python3-pip
pip3 install aiohttp pyserial

# Start server
cd fluidcnc
python3 server.py
# Access from any device: http://<lepotato-ip>:8080
```

### Option 3: HTTPS (Required for WebSerial over LAN)

```bash
python generate-cert.py   # Creates self-signed certificate
python https-server.py    # Serves on https://localhost:8443
```

---

## 🔌 Connection Methods

### WiFi (WebSocket) - Recommended for SBC
1. LePotato connects to CNC via USB → Python bridge
2. Bridge creates WebSocket server on port 8080
3. Any device on network accesses `http://<lepotato-ip>:8080`
4. UI communicates through WebSocket to bridge

### USB (WebSerial) - Direct Connection
1. Connect CNC directly to laptop via USB
2. Open FluidCNC in Chrome/Edge
3. Click "Connect" → "Serial" → Select COM port
4. Requires HTTPS for non-localhost

---

## ⚠️ Safety Features

### Hardware Safety (Physical)
| Feature | Implementation | Behavior |
|---------|----------------|----------|
| **E-STOP Button** | NC contact to Octopus Pro | Immediate motor disable, requires reset |
| **Limit Switches** | NO/NC to each axis | Stops motion, triggers ALARM |
| **Door Interlock** | Optional door switch | Pauses job when opened |

### Software Safety (FluidCNC)
| Feature | Implementation | Behavior |
|---------|----------------|----------|
| **E-Stop Handler** | Sends `\x18` + `$X` on failure | Falls back to WebSocket if Serial fails |
| **Alarm Detection** | Parses ALARM:1-13 codes | Disables controls, shows cause |
| **Stream Interrupt** | Detects connection loss | Stops job, alerts user |
| **Feed Override Guards** | Validates all inputs | Prevents NaN/Infinity commands |
| **State Validation** | Checks machine state | Blocks jog/spindle during ALARM |

### Alarm Code Reference
| Code | Meaning | Typical Cause |
|------|---------|---------------|
| ALARM:1 | Hard limit triggered | Axis hit limit switch |
| ALARM:2 | Soft limit exceeded | G-code beyond work area |
| ALARM:3 | Abort during cycle | User cancel or fault |
| ALARM:9 | Homing fail | Switch not triggered |
| ALARM:10 | E-STOP pressed | Emergency stop button |
| ALARM:13 | Spindle control | VFD/Modbus communication error |

---

## ⌨️ Keyboard Shortcuts

| Key | Action | Key | Action |
|-----|--------|-----|--------|
| **Arrow Keys** | Jog X/Y | **Shift+Arrows** | Fast jog (10x) |
| **Page Up/Down** | Jog Z | **Escape** | Emergency Stop |
| **Space** | Cycle Start/Resume | **H** | Home All Axes |
| **U** | Unlock ($X) | **0** | Zero WCS |
| **V** | Toggle Vacuum | **F/T/I** | View angles |

---

## 📡 USB Hub Configuration

### For LePotato / Raspberry Pi

```
┌─────────────────────────────────────────────────────────────────┐
│                        USB 3.0 HUB (Powered)                    │
│                                                                 │
│   Port 1          Port 2              Port 3         Port 4    │
│   ┌────┐          ┌────┐              ┌────┐         ┌────┐    │
│   │USB │          │USB │              │USB │         │USB │    │
│   └─┬──┘          └─┬──┘              └─┬──┘         └─┬──┘    │
│     │               │                   │               │      │
│     ▼               ▼                   ▼               ▼      │
│  Octopus Pro    Waveshare ESP32    XIAO Camera     (spare)     │
│  (grblHAL)      (Chatter)          (WiFi AP)                   │
│  /dev/ttyACM0   /dev/ttyUSB0       Power only                  │
└─────────────────────────────────────────────────────────────────┘
           │
           │ USB to LePotato
           ▼
    ┌─────────────┐
    │  LePotato   │◄──── Ethernet to Network
    │  (Python    │
    │   Server)   │
    └─────────────┘
           │
           │ WebSocket (ws://lepotato:8080)
           ▼
    ┌─────────────┐
    │  Any Device │  Phone, Tablet, Laptop
    │  (Browser)  │  Chrome/Edge/Safari
    └─────────────┘
```

### Device Detection

The Python bridge auto-detects devices:
- **Octopus Pro**: VID 0x0483 (STMicroelectronics) or "CH340" in description
- **Waveshare ESP32-S3**: VID 0x303A (Espressif)
- **XIAO Camera**: Creates WiFi AP, no serial needed

---

## 🔧 Firmware Setup

### BTT Octopus Pro v1.1 (grblHAL)

1. **PlatformIO Build**
   ```bash
   cd grblHAL-STM32F4
   pio run -e btt_octopus_pro_v1_1
   ```

2. **Flash via DFU**
   ```bash
   # Hold BOOT0, press RESET, release BOOT0
   dfu-util -a 0 -s 0x08000000 -D firmware.bin
   ```

3. **Key Settings**
   ```
   $0=10          ; Step pulse (µs)
   $1=255         ; Step idle delay (ms)
   $3=0           ; Step port invert
   $4=0           ; Dir port invert
   $5=0           ; Limit pins invert (1 if NO switches)
   $6=0           ; Probe pin invert
   $20=0          ; Soft limits (enable after homing works)
   $21=1          ; Hard limits enable
   $22=1          ; Homing enable
   $32=0          ; Laser mode (0 for spindle)
   ```

### Waveshare Chatter Sensor

```bash
cd fluidcnc/chatter-waveshare-s3
pio run --target upload
```

### XIAO Camera

```bash
cd fluidcnc/xiao-camera
pio run --target upload
# Camera creates AP: "FluidCNC-Camera" / password: fluidcnc123
# Access: http://192.168.4.1
```

### ESP32 VFD Controller (Modbus RS485)

```bash
cd esp32-vfd-controller
pio run --target upload
# Connect: GPIO17 → MAX485 DI, GPIO16 → RO, GPIO4 → DE+RE
# Commands: FWD, REV, STOP, RPM:12000, STATUS
```

### DS18B20 Spindle Temperature Sensor

Wire to Waveshare ESP32-S3 chatter sensor:
```
DS18B20 VCC (red)    → 3V3
DS18B20 GND (black)  → GND
DS18B20 DATA (yellow) → GPIO 16 + 4.7kΩ pull-up to 3V3
```
Temperature appears in chatter detection JSON as `spindleTempC`.

---

## 📊 Features Reference

### Core Features
- ✅ Real-time DRO (Machine/Work coordinates)
- ✅ 3D Toolpath Visualization (Three.js)
- ✅ G-code Streaming with Progress
- ✅ Feed/Speed/Spindle Overrides
- ✅ Probe Wizard (Z, Corner, Center)
- ✅ Job Queue (multi-file)
- ✅ SD Card Management
- ✅ Macro System

### Smart Features (machine-enhancements.js)
- ✅ **Neural Network ML System** (7→12→3 architecture)
  - Predicts cut quality, chatter risk, tool wear rate
  - Online learning from sensor feedback
  - Continuous training during operation
- ✅ **Chatter Detection** (realtime ESP32 sensor integration)
- ✅ **Adaptive Feed Rate** (ML-driven adjustments)
- ✅ **Predictive Maintenance** (component lifecycle tracking)
- ✅ **Tool Life Tracking** (run time, material-based wear)
- ✅ **Voice Alerts** (system notifications)
- ✅ **Power-Loss Recovery** (job checkpointing)
- ✅ **Thermal Compensation** (spindle warm-up tracking)
- ✅ **Anomaly Detection** (statistical monitoring)
- ✅ **StallGuard Integration** (TMC2209 load sensing)
- ✅ **VFD Modbus Monitoring** (current, RPM, temperature)
- ✅ **ESP32 VFD Controller** (Modbus RS485 for H100/Changrong VFDs)
- ✅ **Spindle Temperature Monitoring** (DS18B20 on chatter sensor)
- ✅ **Thermal Stress Testing** (automated spindle cooling verification)

### Safety Features
- ✅ **E-STOP Handling** (hardware NC button + software)
- ✅ **Limit Switch Integration** (per-axis)
- ✅ **Alarm Code Parsing** (ALARM:1-13 + error codes)
- ✅ **Emergency Procedures System** (automatic responses)
  - Crash detection (rapid load spike)
  - Controlled deceleration
  - State preservation
- ✅ **Coolant/Chiller Monitoring** (door pin integration)
- ✅ **Environmental Safety** (fire/smoke/gas detection ready)
- ✅ **UPS Monitoring** (power state awareness)
- ✅ **Stream Interruption Detection**
- ✅ **Input Validation** (comprehensive NaN guards)
- ✅ **State-based Control Locking**

---

## 🐛 Troubleshooting

### Connection Issues

| Problem | Solution |
|---------|----------|
| WebSocket won't connect | Check firewall, ensure port 8080/81 open |
| WebSerial not available | Use HTTPS or localhost, Chrome/Edge only |
| "Port in use" error | Close other serial monitors |
| Octopus not detected | Check USB cable, try different port |

### Alarm Handling

| Alarm | Quick Fix |
|-------|-----------|
| ALARM:1/2 (Limits) | Jog away from limits, then unlock |
| ALARM:9 (Homing) | Check switch wiring, adjust $2x/$2y settings |
| ALARM:10 (E-STOP) | Release E-STOP, send unlock command |
| ALARM:13 (VFD) | Check Modbus wiring, baud rate, slave ID |

### Performance

| Issue | Solution |
|-------|----------|
| Laggy visualization | Reduce file size, close other tabs |
| Choppy jogging | Reduce jog distance, check serial buffer |
| Missed steps | Reduce acceleration, check motor current |

---

## 📄 License

MIT License - See LICENSE file

## 🤝 Contributing

1. Fork the repository
2. Create feature branch (`git checkout -b feature/amazing`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing`)
5. Open Pull Request

---

## 📞 Support

- **Issues**: GitHub Issues
- **Documentation**: `docs/` folder
- **Hardware Guide**: [HARDWARE_ADDITIONS.md](docs/HARDWARE_ADDITIONS.md)
- **LePotato Setup**: [LEPOTATO_SETUP.md](docs/LEPOTATO_SETUP.md)
- **Smart Machine System**: [SMART_MACHINE.md](docs/SMART_MACHINE.md)
- **ML Intelligence System**: [MACHINE_ENHANCEMENTS.md](docs/MACHINE_ENHANCEMENTS.md)
- **Wiring Guide (EN)**: [wiring-guide.html](docs/wiring-guide.html)
- **Guía de Cableado (ES)**: [guia-cableado.html](docs/guia-cableado.html)
