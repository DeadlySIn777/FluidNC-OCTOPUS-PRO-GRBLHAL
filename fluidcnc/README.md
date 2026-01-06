# FluidCNC - Modern grblHAL Web Interface

Full-featured browser UI for CNC machines running **grblHAL** firmware. Connects via WiFi WebSocket or USB WebSerial.

![PWA](https://img.shields.io/badge/PWA-Offline_Ready-brightgreen) ![grblHAL](https://img.shields.io/badge/grblHAL-Compatible-blue) ![WebSerial](https://img.shields.io/badge/WebSerial-Chrome%2FEdge-orange)

## ✨ Features

| Feature | Description |
|---------|-------------|
| 🎯 **Real-time DRO** | Machine/Work position with sub-mm updates |
| 🕹️ **Advanced Jogging** | Keyboard + mouse with hold-to-jog |
| 📊 **3D Toolpath Visualizer** | Three.js powered G-code preview |
| 🔍 **Probe Wizard** | Z surface, corner, edge, center finding |
| 🔧 **RapidChange ATC** | Automated tool changes with spindle rotation |
| 🤖 **AI Assistant** | Natural language CNC commands |
| 📈 **Real-time Monitoring** | Feed rate, spindle load, overrides |
| 📐 **Feeds & Speeds Calculator** | Material-based recommendations |
| 📁 **Job Queue** | Multi-file job management |
| 🗺️ **Surface Scanner** | Bed leveling / height mapping |
| ✏️ **Vector Import** | SVG/DXF to G-code conversion |
| 💾 **SD Card Manager** | Browse, upload, run files autonomously |
| 🌀 **Vacuum Control** | Toggle vacuum and dust shoe (M64/M65) |
| 🌐 **PWA Offline** | Works without internet once cached |

---

## 🚀 Quick Start

### Option 1: Run locally (development)
```bash
cd fluidcnc
python -m http.server 8080
# Open http://localhost:8080
```

### Option 2: HTTPS for WebSerial on LAN
```bash
cd fluidcnc
python generate-cert.py   # Creates self-signed cert
python https-server.py    # Serves on https://localhost:8443
```

### Option 3: Deploy to web server
Copy all files to any static web host. The UI connects to your CNC via WebSocket.

---

## 🔌 Connecting to Your CNC

### WiFi (WebSocket)
1. Get your CNC's IP address (check router or serial output)
2. Click "Connect" in FluidCNC
3. Enter IP (e.g., `192.168.1.100`)
4. Select "WebSocket" and connect (port 81)

### USB (WebSerial)
1. Connect CNC via USB cable
2. Click "Connect" in FluidCNC
3. Select "Serial" (Chrome/Edge only)
4. Choose the COM port when prompted

> ⚠️ WebSerial requires HTTPS or localhost. Use the HTTPS server for LAN access.

---

## ⌨️ Keyboard Shortcuts

| Key | Action | Key | Action |
|-----|--------|-----|--------|
| **Arrow Keys** | Jog X/Y | **Shift + Arrow** | Fast jog (10x) |
| **Page Up/Down** | Jog Z | **Shift + PgUp/Down** | Fast Z jog |
| **Escape** | Emergency stop | **Space** | Cycle start / Resume |
| **H** | Home all axes | **U** | Unlock ($X) |
| **0** | Zero all WCS | **V** | Toggle vacuum |
| **F** | Front view | **T** | Top view |
| **I** | Isometric view | **Ctrl+O** | Open G-code file |

---

## 🔧 ATC Tool Changer (RapidChange Style)

The ATC uses spindle rotation to grip/release tools:

- **CCW (M4)** → Loosens collet nut → Drops tool in fork
- **CW (M3)** → Tightens collet nut → Picks tool from fork

### ATC Controls in UI

| Button | Action |
|--------|--------|
| **Open Lid** | Opens dust cover (M280 P0 S180) |
| **Close Lid** | Closes dust cover (M280 P0 S0) |
| **Loosen** | Manual CCW spin test (M4 S200) |
| **Tighten** | Manual CW spin test (M3 S200) |
| **Simulate** | Shows G-code without executing |
| **Config** | Opens configuration modal |

### Configuration Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| Tool Spacing | 50.4mm | Distance between tools |
| Engage Z | -47mm | Z where nut contacts fork |
| Tighten Z | -54mm | Z depth during tightening |
| Loosen Time | 3000ms | Duration of CCW spin |
| Tighten Time | 2500ms | Duration of CW spin |

---

## 🧰 Module Overview

| File | Purpose |
|------|---------|
| `grblhal.js` | WebSocket/WebSerial transport, state parsing, event emitter |
| `app.js` | Main coordinator, UI bindings, keyboard handling |
| `gcode-parser.js` | G-code tokenization for visualization |
| `visualizer-3d.js` | Three.js 3D toolpath preview |
| `probe-wizard.js` | Guided probing workflows (Z, corner, edge, center) |
| `macros.js` | RapidChange ATC controller + custom macros |
| `ai-assistant.js` | NLP command processing with safety limits |
| `monitoring.js` | Real-time performance graphs |
| `feeds-speeds.js` | Material database + F&S calculator |
| `surface-scanner.js` | Bed leveling grid probe |
| `vector-importer.js` | SVG/DXF import to G-code |
| `gcode-simulator.js` | Dry-run simulator, bounds checking |
| `job-recovery.js` | Crash recovery, checkpointing |
| `settings-manager.js` | Backup/restore, tool library |
| `sd-card.js` | SD card file management |

---

## ⚙️ Configuration

Settings are saved in browser localStorage:

| Key | Purpose |
|-----|---------|
| `fluidcnc-last-ip` | Last connected IP address |
| `fluidcnc-connection-type` | websocket or serial |
| `fluidcnc_settings` | General settings |
| `fluidcnc_tools` | Tool table (diameters, lengths) |
| `fluidcnc_atc_config` | ATC positions and timing |
| `fluidcnc_macros` | Custom macro definitions |
| `fluidcnc_probe_config` | Probe feed rates, retract |

---

## 📚 Documentation

| Document | Description |
|----------|-------------|
| [docs/wiring-guide.html](docs/wiring-guide.html) | **Complete hardware wiring reference** |
| [../grblhal-octopus/README.md](../grblhal-octopus/README.md) | BTT Octopus Pro firmware setup |
| [../.github/copilot-instructions.md](../.github/copilot-instructions.md) | Developer reference |

---

## 🛠️ Flashing grblHAL Firmware

### STM32 (BTT Octopus Pro)

1. Build firmware with PlatformIO:
   ```bash
   cd grblHAL-STM32F4
   pio run -e btt_octopus_pro_f429
   ```

2. Flash via DFU:
   - Set BOOT0 jumper HIGH
   - Power on → shows as "STM32 BOOTLOADER"
   - Use STM32CubeProgrammer to flash
   - Remove BOOT0, power cycle

### ESP32

```bash
pip install esptool
esptool.py --chip esp32 --port COM3 --baud 460800 \
  write_flash 0x0 grblHAL_ESP32_xxx.bin
```

---

## 🐛 Troubleshooting

### Can't connect via WebSocket
- Verify CNC IP address is correct
- Check port 81 is open
- Try `ws://IP:81` in browser console

### WebSerial not available
- Use Chrome or Edge (Firefox doesn't support it)
- Ensure HTTPS or localhost
- Check USB cable is data-capable

### Machine in ALARM state
- Send `$H` to home
- Or `$X` to unlock without homing
- Check limit switches if homing fails

### ATC servo not working
- **Never connect servo power to 24V!**
- Use external 6-8V power supply
- Only signal wire to PWM pin

---

## 📄 License

MIT License - See LICENSE file
