# FluidCNC Camera Module
## For Seeed XIAO ESP32S3 Sense

Machine monitoring camera for real-time video streaming to the FluidCNC web UI.

---

## 🚀 SUPER EASY SETUP

### USB Hub Method (Recommended)
```
┌─────────────────┐     USB Hub      ┌──────────────────────┐
│   Your PC       │◄───────┬────────►│  XIAO Camera         │
│   (FluidCNC)    │        │         │  (video streaming)   │
└─────────────────┘        │         └──────────────────────┘
                           │
                           └────────►┌──────────────────────┐
                                     │  Waveshare Chatter   │
                                     │  (chatter detection) │
                                     └──────────────────────┘
```

### Step-by-Step:

1. **Upload Firmware** (one-time)
   - Open this folder in VS Code with PlatformIO
   - Click "Upload" (or `pio run -t upload`)

2. **Plug Camera into USB Hub**
   - Camera auto-creates WiFi: `FluidCNC-Camera`
   - Password: `fluidcnc123`

3. **View Camera**
   - Connect your phone/PC to `FluidCNC-Camera` WiFi
   - Open http://192.168.4.1
   - See your machine! 📹

That's it! No code editing, no network configuration.

---

## Connection Options

### Option A: Camera's Own WiFi (Default - Simplest)
- Camera creates `FluidCNC-Camera` network
- Connect phone/PC to view stream
- FluidCNC can open camera in popup

### Option B: Same Network as FluidCNC (Optional)
If you want camera on your home network:
1. Connect to `FluidCNC-Camera` WiFi
2. Go to http://192.168.4.1/setup
3. Enter your home WiFi credentials
4. Camera reboots and joins your network
5. Access via http://fluidcnc-camera.local

---

## Hardware

**Seeed XIAO ESP32S3 Sense** (~$15):
- ESP32-S3R8 @ 240MHz (8MB PSRAM, 8MB Flash)
- OV3660 camera sensor (2048×1536 max)
- Built-in digital microphone
- MicroSD card slot
- Tiny form factor: 21 × 17.8mm
- USB-C for power and programming

📦 **Buy**: [Seeed Studio XIAO ESP32S3 Sense](https://www.seeedstudio.com/XIAO-ESP32S3-Sense-p-5639.html)

---

## USB Serial Commands

If connected via USB, you can send these commands at 115200 baud:

| Command | Description |
|---------|-------------|
| `STATUS` | Get JSON status |
| `SNAP` | Capture snapshot (base64) |
| `RESET` | Clear WiFi credentials |
| `WIFI:ssid:password` | Configure WiFi |
| `HELP` | Show commands |

---

## Web Endpoints

| Endpoint | Description |
|----------|-------------|
| `/` | Camera viewer UI |
| `/stream` | MJPEG video stream |
| `/capture` | Single JPEG snapshot |
| `/setup` | WiFi configuration portal |
| `/status` | JSON device status |
| `/discover` | FluidCNC discovery |

---

## Mounting Tips

The XIAO is tiny (21×17.8mm) - perfect for:
- Magnetic mount on spindle housing
- 3D printed enclosure on gantry
- Zip-tie to cable chain
- Stick-on mount near workpiece

**Aim suggestions:**
- Point at spindle/tool for tool monitoring
- Point at workpiece for cut quality
- Wide angle for full table view

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| Can't see `FluidCNC-Camera` WiFi | Check USB power, wait 10 seconds after plug in |
| Video is laggy | Reduce resolution: go to camera UI, select 320×240 |
| Camera not initializing | Check that camera module is properly connected to XIAO |
| "Camera not found" in FluidCNC | Make sure PC is connected to `FluidCNC-Camera` WiFi |

---

## Pin Configuration (For Reference)

Camera pins are fixed for XIAO ESP32S3 Sense:

| Function | GPIO |
|----------|------|
| XCLK | 10 |
| PCLK | 13 |
| VSYNC | 38 |
| HREF | 47 |
| SIOD (I2C) | 40 |
| SIOC (I2C) | 39 |
| Y2-Y9 | 15,17,18,16,14,12,11,48 |
| LED | 21 |
| MIC CLK | 42 |
| MIC DATA | 41 |
