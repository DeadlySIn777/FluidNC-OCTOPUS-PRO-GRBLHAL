# Chatter Detection System v4.1
## For Waveshare ESP32-S3-Touch-LCD-1.46B

**✅ THIS IS THE CORRECT FIRMWARE FOR OUR HARDWARE**

Premium CNC chatter detection with adaptive machine learning and real-time visualization on a beautiful round display.

---

## 🚀 SUPER EASY SETUP (USB ONLY - NO WIFI!)

### USB Hub Method (Recommended)
```
┌─────────────────┐     USB Hub      ┌──────────────────────┐
│   Your PC       │◄───────┬────────►│  Waveshare Chatter   │ ← YOU ARE HERE
│   (FluidCNC)    │        │         │  (chatter detection) │
└─────────────────┘        │         └──────────────────────┘
                           │
                           └────────►┌──────────────────────┐
                                     │  XIAO Camera         │
                                     │  (video streaming)   │
                                     └──────────────────────┘
```

### Step-by-Step:

1. **Upload Firmware** (one-time)
   - Open this folder in VS Code with PlatformIO
   - Click "Upload" (or `pio run -t upload`)

2. **Plug into USB Hub**
   - Connect USB-C to hub (or directly to PC)
   - Beautiful round display lights up! 🎨

3. **Open FluidCNC**
   - Click "Connect Chatter Sensor" button
   - Select the COM port (or let browser auto-detect)
   - Done! Real-time chatter detection is live!

That's it! Pure USB - no WiFi, no network config, no IP addresses.

---

## Hardware

**Waveshare ESP32-S3-Touch-LCD-1.46B** (~$25):
- ESP32-S3R8 @ 240MHz (8MB PSRAM, 16MB Flash)
- 1.46" 412×412 IPS Round LCD (SPD2010 QSPI)
- Capacitive touch (integrated)
- QMI8658C 6-axis IMU (accelerometer + gyroscope)
- PDM microphone (onboard)
- PCM5101 audio output (speaker)
- USB-C for power and serial
- **No soldering required!**

📦 **Buy**: [Waveshare ESP32-S3-Touch-LCD-1.46B](https://www.waveshare.com/esp32-s3-touch-lcd-1.46.htm)

## Features (v4.0+)

### Adaptive Detection
- **Self-Calibrating Baseline**: Auto-learns YOUR machine's noise floor
- **Pattern Learning**: Remembers chatter events and learns from them
- **Stability Lobe Prediction**: Predicts chatter-prone RPMs based on tool geometry
- **Harmonic Series Detection**: Detects real chatter signatures (not just noise)
- **Cross-Sensor Correlation**: IMU + Mic agreement = higher confidence
- **TMC2209 StallGuard Support**: Integrates stepper feedback (if UART enabled)

### Signal Processing
- **1024-point FFT** at 16kHz sampling
- **16 Logarithmic Frequency Bands**: 100Hz to 8kHz analysis
- **Statistical Anomaly Detection**: 3-sigma (99.7%) confidence
- **Crest Factor Analysis**: Distinguishes chatter from random noise

### FluidCNC Integration
- **USB Serial Protocol**: Direct connection via Web Serial API
- **Commands Supported**:
  - `CAL` - Start calibration (machine should be idle)
  - `RESOLVED` - Confirm chatter was fixed (for learning)
  - `RPM:nnn` - Send spindle speed for stability lobe prediction
  - `FEED:nnn` - Send feed rate for learning
  - `TOOL:teeth,diameter` - Send tool params for harmonic prediction
  - `SG:axis,value` - Send TMC2209 StallGuard data
  - `INFO` - Request device info

## Serial Output

JSON status for FluidCNC integration (sent every 500ms or on state change):
```json
{
  "chatter": {
    "state": "ok",
    "score": 15.3,
    "freq": 1200,
    "vib": 0.045,
    "conf": 95,
    "cal": 100,
    "learned": 5,
    "feed": 100
  }
}
```

| Field | Description |
|-------|-------------|
| `state` | `ok`, `warning`, `chatter`, `calibrating`, `recovering` |
| `score` | Chatter score 0-100% |
| `freq` | Dominant chatter frequency (Hz) |
| `vib` | Vibration magnitude (g) |
| `conf` | Detection confidence 0-100% |
| `cal` | Calibration progress 0-100% |
| `learned` | Number of learned chatter events |
| `feed` | Suggested feed override % |

## Pin Configuration

| Function | GPIO |
|----------|------|
| LCD CS | 9 |
| LCD CLK | 10 |
| LCD D0-D3 | 11-14 |
| LCD RST | 3 |
| LCD Backlight | 46 |
| Touch/IMU SDA | 39 |
| Touch/IMU SCL | 40 |
| Touch INT | 38 |
| IMU INT1/INT2 | 4/5 |
| PDM CLK | 41 |
| PDM DATA | 42 |

## Building

1. Install PlatformIO in VS Code
2. Open this folder as a project
3. Build and upload:
   ```
   pio run -t upload
   ```

## Files

- `platformio.ini` - Build configuration with correct pin defines
- `src/main.cpp` - Main application (QMI8658C IMU, PDM mic, FFT, adaptive detector)
- `src/adaptive_chatter.h` - Machine learning detector with memory
- `src/advanced_dsp.h` - Stability lobe, harmonic detection, crest factor
- `src/display_ui.h` - SPD2010 display driver and UI rendering

## Version History

- **v4.1** (2025): Advanced DSP + StallGuard integration
- **v4.0** (2025): Adaptive machine learning detection
- **v3.1** (2024): Production-ready with SPD2010 display driver
- **v3.0** (2024): Initial Waveshare ESP32-S3 port
