# CNC Chatter Detection System

ESP32 DevKit 38-pin based real-time chatter detection using **triple sensor fusion** with **1.28" round TFT display**.

## Features

### Sensors
- **MPU-6050 Accelerometer** - Direct mechanical vibration measurement
- **INMP441 I2S Microphone** - Acoustic chatter detection  
- **ACS712 Current Sensor (ACS712T ELC-30A / 30A)** - Spindle load monitoring
- **1.28" Round TFT Display** - GC9A01 240x240 on-machine status display

### Intelligence
- **Material-Aware Detection** - 7 material profiles (aluminum, steel, plastic, wood, brass, composite, copper)
- **Predictive Warnings** - Trend detection catches rising chatter early
- **Hysteresis** - Prevents oscillation with debounced detection
- **Adaptive Thresholds** - Learns your machine's characteristics
- **Tool Breakage Detection** - Emergency stop on sudden load drop
- **Overload Protection** - Aggressive feed reduction on high current
- **Auto-Pause** - Pauses detection when spindle is off (no false alarms)
- **Cutting Efficiency** - Calculates optimal zone between too light and chatter

### Advanced Analysis (NEW!)
- **Harmonic Detection** - Detects chatter's characteristic harmonic patterns
- **Frequency Band Analysis** - Low/Mid/High band energy for chatter zone identification
- **EMA Smoothing** - Exponential moving average for noise reduction
- **Pattern Detection** - Identifies rising, stable, or intermittent chatter
- **Prediction Engine** - Estimates time until threshold breach
- **Confidence Score** - 0-100% certainty of chatter detection
- **ML-Ready Features** - 16-element feature vector for future machine learning
- **Tool Wear Tracking** - Estimates tool wear from cumulative load
- **Session Statistics** - Tracks events, efficiency, recoveries

### Position Tracking (NEW!)
- **Chatter Map** - Records X/Y/Z positions where chatter occurred
- **Visual Map** - 2D visualization of problem areas
- **Position Sync** - Updates from FluidCNC status

### Connectivity
- **Real-time Feed Override** - Sends commands to grblHAL via UART
- **WebSocket Interface** - Real-time data to FluidCNC web UI at 20Hz
- **WiFi AP Mode** - Self-hosted hotspot for initial setup
- **Web-Based OTA** - Upload firmware via browser
- **ArduinoOTA** - Update via PlatformIO IDE
- **mDNS** - Access via http://chatter.local

### Reliability
- **WiFi Auto-Reconnect** - Reconnects if WiFi drops, reboots after 10 failures
- **Heap Monitoring** - Warns if memory gets low (<20KB)
- **Persistent Settings** - Survives reboot
- **Sensor Health Check** - Monitors all sensors

### Data & Export
- **Session Logging** - Records all chatter events with timestamps
- **Data Recording** - Record sensor data for analysis
- **Settings Export/Import** - Backup and restore configuration
- **Spectrum Analyzer** - View FFT frequency data
- **Chatter Map Export** - Export problem positions

## Hardware

## Wiring (Easy Mode)

Open the visual wiring guide (HTML):

- `docs/wiring.html`

| Component | Interface | Purpose |
|-----------|-----------|---------|
| ESP32 DevKit 38-pin | - | Main processor, WiFi |
| MPU-6050 | I2C | Accelerometer, mount on spindle/gantry |
| INMP441 | I2S | Digital MEMS microphone |
| ACS712T ELC-30A | Analog | Current sensor (30A). Typical 66mV/A @ 5V; with 10k/20k divider into ADC ≈ 44mV/A effective |
| GC9A01 1.28" Round TFT | SPI | 240x240 status display, mount on spindle |

---

## Wiring Diagram - ESP32 DevKit 38-pin

```
                    ESP32 DevKit 38-pin
                    ┌─────────────────┐
                    │     USB-C       │
                    │    (UART0)      │
                    ├────┬───────┬────┤
              3V3 ──┤ 1  │       │ 38 ├── GND
               EN ──┤ 2  │       │ 37 ├── GPIO 23 ──► TFT MOSI (SDA)
     (ADC) GPIO 36 ─┤ 3  │       │ 36 ├── GPIO 22 ──► MPU SCL
     (ADC) GPIO 39 ─┤ 4  │       │ 35 ├── GPIO 1  ──  (USB TX - DON'T USE)
     (ADC) GPIO 34 ─┤ 5  │ ESP32 │ 34 ├── GPIO 3  ──  (USB RX - DON'T USE)
     (ADC) GPIO 35 ─┤ 6  │       │ 33 ├── GPIO 21 ──► MPU SDA
    GPIO 32 (I2S) ──┤ 7  │       │ 32 ├── GND
    GPIO 33 ────────┤ 8  │       │ 31 ├── GPIO 19
    GPIO 25 (I2S) ──┤ 9  │       │ 30 ├── GPIO 18 ──► TFT SCK (SCL)
    GPIO 26 (I2S) ──┤ 10 │       │ 29 ├── GPIO 5  ──► TFT BL (Backlight)
           GPIO 27 ─┤ 11 │       │ 28 ├── GPIO 17 ──► grblHAL TX
           GPIO 14 ─┤ 12 │       │ 27 ├── GPIO 16 ──► grblHAL RX
           GPIO 12 ─┤ 13 │       │ 26 ├── GPIO 4  ──► TFT RST
              GND ──┤ 14 │       │ 25 ├── GPIO 0  ──  (BOOT - DON'T USE)
           GPIO 13 ─┤ 15 │       │ 24 ├── GPIO 2  ──► TFT DC
            GPIO 9 ─┤ 16 │       │ 23 ├── GPIO 15 ──► TFT CS
           GPIO 10 ─┤ 17 │       │ 22 ├── GPIO 8
           GPIO 11 ─┤ 18 │       │ 21 ├── GPIO 7
              5V ───┤ 19 │       │ 20 ├── GPIO 6
                    └────┴───────┴────┘

    Current Sensor: GPIO 34 (Pin 5) ◄── ACS712 OUT
    I2S Mic Data:   GPIO 32 (Pin 7) ◄── INMP441 SD
    I2S Mic WS:     GPIO 25 (Pin 9) ──► INMP441 WS
    I2S Mic SCK:    GPIO 26 (Pin 10) ─► INMP441 SCK
```

---

### MPU-6050 (I2C Accelerometer)
| MPU-6050 | ESP32 GPIO | ESP32 Pin# |
|----------|------------|------------|
| VCC | 3.3V | Pin 1 |
| GND | GND | Pin 14/32/38 |
| SDA | GPIO 21 | Pin 33 |
| SCL | GPIO 22 | Pin 36 |

**Mount on spindle housing or gantry for best vibration pickup.**

---

### INMP441 (I2S Digital Microphone)
| INMP441 | ESP32 GPIO | ESP32 Pin# |
|---------|------------|------------|
| VCC | 3.3V | Pin 1 |
| GND | GND | Pin 14/32/38 |
| SD | GPIO 32 | Pin 7 |
| WS | GPIO 25 | Pin 9 |
| SCK | GPIO 26 | Pin 10 |
| L/R | GND | (Left channel) |

**Mount near spindle for acoustic chatter detection.**

---

### ACS712T ELC-30A (Current Sensor)
| ACS712 | ESP32 GPIO | ESP32 Pin# |
|--------|------------|------------|
| VCC | 5V | Pin 19 |
| GND | GND | Pin 14/32/38 |
| OUT | GPIO 34 | Pin 5 |

**⚠️ IMPORTANT: Wire ACS712 in series with ONE HOT WIRE of spindle power cable!**

Notes:
- Most ACS712 modules are powered from 5V; the output is centered around ~VCC/2.
- Protect the ESP32 ADC (≤3.3V) with a divider (the wiring guide uses 10k/20k).
- Absolute amps will vary with module variant and divider ratio; use the built-in calibration mode for best results.

---

### GC9A01 1.28" Round TFT (240x240 SPI)
| GC9A01 | ESP32 GPIO | ESP32 Pin# |
|--------|------------|------------|
| VCC | 3.3V | Pin 1 |
| GND | GND | Pin 14/32/38 |
| SCL (SCK) | GPIO 18 | Pin 30 |
| SDA (MOSI) | GPIO 23 | Pin 37 |
| CS | GPIO 15 | Pin 23 |
| DC | GPIO 2 | Pin 24 |
| RST | GPIO 4 | Pin 26 |
| BL | GPIO 5 | Pin 29 |

**Mount on spindle or tool holder for operator visibility.**

---

### UART to grblHAL (BTT Octopus Pro / FluidNC)
| ESP32 GPIO | ESP32 Pin# | Octopus Pro |
|------------|------------|-------------|
| GPIO 17 (TX) | Pin 28 | PA1 (UART4_RX) - EXP1 Pin 8 |
| GPIO 16 (RX) | Pin 27 | PA0 (UART4_TX) - EXP1 Pin 10 |
| GND | Pin 14/32/38 | GND |

**This is UART2 on ESP32 - completely independent from USB (UART0).**

---

### VFD Modbus RS-485 Telemetry (Optional)
Get real telemetry from your VFD: actual frequency, output current, DC bus voltage, fault codes.

**Hardware:** RS-485 transceiver module (MAX485, SP3485, or isolated ADM2587E)

| ESP32 GPIO | ESP32 Pin# | RS-485 Module | Notes |
|------------|------------|---------------|-------|
| GPIO 13 | Pin 15 | DI (driver input) | ESP32 TX → RS-485 |
| GPIO 14 | Pin 12 | RO (receiver output) | ESP32 RX ← RS-485 |
| GPIO 27 | Pin 11 | DE + RE (tied) | Direction enable |
| GND | Pin 14/32/38 | GND | Common ground |
| 3.3V or 5V | Pin 1 or 19 | VCC | Check module spec |

| RS-485 Module | VFD Terminal | Notes |
|---------------|--------------|-------|
| A | RS+ (or D+ or A) | Differential + |
| B | RS- (or D- or B) | Differential - |
| GND | GND/COM | Optional, helps noise |

**Huanyang VFD settings:**
- PD163 = 1 (communication mode)
- PD164 = 1 (slave address)
- PD165 = 1 (9600 baud)

**Enable in firmware:** Uncomment `vfd.begin()` in `setup()`.

---

## Pin Summary Table

| Function | GPIO | Pin# | Notes |
|----------|------|------|-------|
| **I2C SDA** | 21 | 33 | MPU-6050 |
| **I2C SCL** | 22 | 36 | MPU-6050 |
| **I2S SD** | 32 | 7 | INMP441 data |
| **I2S WS** | 25 | 9 | INMP441 word select |
| **I2S SCK** | 26 | 10 | INMP441 clock |
| **ADC** | 34 | 5 | ACS712 current sensor |
| **SPI MOSI** | 23 | 37 | TFT data |
| **SPI SCK** | 18 | 30 | TFT clock |
| **TFT CS** | 15 | 23 | TFT chip select |
| **TFT DC** | 2 | 24 | TFT data/command |
| **TFT RST** | 4 | 26 | TFT reset |
| **TFT BL** | 5 | 29 | TFT backlight |
| **UART2 TX** | 17 | 28 | → grblHAL RX |
| **UART2 RX** | 16 | 27 | ← grblHAL TX |
| **VFD TX** | 13 | 15 | → RS-485 DI (optional) |
| **VFD RX** | 14 | 12 | ← RS-485 RO (optional) |
| **VFD DE** | 27 | 11 | RS-485 direction (optional) |
| **USB TX** | 1 | 35 | ❌ Reserved - don't use |
| **USB RX** | 3 | 34 | ❌ Reserved - don't use |
| **BOOT** | 0 | 25 | ❌ Reserved - don't use |

---

## Configuration

### First-Time Setup (AP Mode)

If WiFi credentials are not configured, or WiFi connection fails, the ESP32 automatically starts in **AP Mode**:

1. Connect to WiFi network: **ChatterDetect**
2. Password: **chatter123**
3. Go to: **http://192.168.4.1**
4. Enter your WiFi network name and password
5. Click "Save & Connect" - ESP32 will reboot and connect to your WiFi

### Manual Configuration

Edit `src/main.cpp` before flashing:

```cpp
// WiFi credentials
const char* WIFI_SSID = "YOUR_WIFI_SSID";
const char* WIFI_PASS = "YOUR_WIFI_PASSWORD";
```

Material profiles and thresholds are built-in and auto-selected based on material type.

---

## Building & Flashing

1. Install [PlatformIO](https://platformio.org/) or use VS Code extension
2. Optionally edit WiFi credentials in `src/main.cpp` (or use AP mode)
3. Build and upload:
   ```bash
   cd chatter-esp32
   pio run -t upload
   ```
4. Monitor serial output:
   ```bash
   pio device monitor
   ```

---

## Updating Firmware

### Web-Based OTA (Easiest!)
1. Go to **http://chatter.local** or the ESP32's IP address
2. Click "Upload Firmware" and select `.pio/build/esp32dev/firmware.bin`
3. Wait for upload and reboot

### From FluidCNC UI
1. Click the **⬆️ Update** button in the chatter panel
2. This opens the ESP32's config page

### PlatformIO OTA
```bash
pio run -t upload --upload-port chatter.local
```

### Switch to AP Mode for WiFi Changes
1. Click **📶 Setup** in FluidCNC chatter panel
2. Or send `apMode` via WebSocket
3. Connect to "ChatterDetect" WiFi and configure

---

## FluidCNC Integration

The chatter detection panel appears automatically in the FluidCNC web UI.

### Features
- Real-time sensor scores with live graph
- Material/operation/tool configuration wizard
- Predictive trend warnings (catches rising chatter early)
- Audio alerts (beeps on chatter)
- Spectrum analyzer (diagnostics modal)
- Auto-detects settings from G-code comments
- **⬆️ Update** - Open web OTA update page
- **📶 Setup** - Switch to AP mode for WiFi config
- **🔄 Reboot** - Restart ESP32
- **📋 Export Log** - Download session data as JSON
- **⚙️ Export Config** - Download settings for backup
- **🔴 Record Data** - Record sensor data for analysis

### WebSocket Commands

Send to `ws://<esp32-ip>/ws` or `ws://chatter.local/ws`:

#### Basic Control
| Command | Description |
|---------|-------------|
| `enable` | Start chatter detection |
| `disable` | Stop detection, reset feed to 100% |
| `calibrate` | Recalibrate baseline current |
| `autoCal` | Auto-calibrate idle current (spindle must be running) |
| `learn` | Learn noise floor (10 seconds) |
| `reset` | Clear alerts, reset all state |
| `save` | Save settings to flash |

#### Material & Tool Setup
| Command | Description |
|---------|-------------|
| `material:<name>` | Set material (aluminum, steel, plastic, wood, brass, composite, copper) |
| `operation:<type>` | Set operation (roughing, finishing, drilling, slotting) |
| `tool:6,2,10000` | Set tool (diameter mm, flutes, RPM) |
| `rpm:<value>` | Update spindle RPM |
| `weights:0.3,0.4,0.3` | Set sensor weights (audio, accel, current) |

#### Detection Modes
| Command | Description |
|---------|-------------|
| `mode:auto` | Auto mode (default) |
| `mode:aggressive` | Lower threshold, faster response |
| `mode:conservative` | Higher threshold, less sensitive |

#### Diagnostics
| Command | Description |
|---------|-------------|
| `spectrum` | Request FFT spectrum data |
| `diag` | Request full diagnostic info (heap, uptime, WiFi, etc.) |
| `stats` | Request session statistics |
| `resetStats` | Reset session statistics |
| `getConfig` | Request full configuration |

#### Advanced Analysis (NEW!)
| Command | Description |
|---------|-------------|
| `analysis` | Get advanced analysis (harmonics, bands, patterns, prediction) |
| `map` or `chatterMap` | Get chatter map (positions with scores) |
| `clearMap` | Clear chatter position log |
| `features` or `mlFeatures` | Get ML feature vector |
| `pos:X,Y,Z` | Update machine position (from FluidCNC) |
| `exportSettings` | Export all settings as JSON |

#### System Control
| Command | Description |
|---------|-------------|
| `apMode` or `setupWifi` | Switch to AP mode for WiFi setup |
| `reboot` | Restart ESP32 |
| `network` | Get network info |
| `network` | Get network info (IP, SSID, RSSI) |
| `apMode` | Switch to AP mode for WiFi setup |
| `reboot` | Reboot ESP32 |
| `ping` | Keepalive check |

### WebSocket Data (JSON at ~20Hz)

```json
{
  "audio": 0.35,
  "accel": 0.42,
  "current": 0.28,
  "combined": 0.36,
  "amps": 4.5,
  "baseline": 2.0,
  "freq": 1250,
  "toothFreq": 333,
  "feed": 80,
  "lastStable": 95,
  "minFeed": 25,
  "enabled": true,
  "chatter": false,
  "inChatterZone": false,
  "toolBroken": false,
  "overload": false,
  "learning": false,
  "trend": 0.005,
  "threshold": 0.55,
  "noiseFloor": 0.05,
  "material": "aluminum",
  "materialIndex": 0,
  "operation": 0,
  "toolDia": 6.0,
  "toolFlutes": 2,
  "rpm": 10000,
  "spindleRunning": true,
  "cutting": true,
  "idleCurrent": 0.5,
  "efficiency": 0.72,
  "bestFeed": 90,
  "confidence": 0.85,
  "variance": 0.012,
  "predicted": 0.48,
  "ticksToChatter": 15,
  "harmonics": true,
  "lowBand": 0.15,
  "midBand": 0.45,
  "highBand": 0.22
}
```

---

## TFT Display UI

The 1.28" round display shows:

- **Circular gauge** - Combined score arc (green→yellow→orange→red)
- **Center score** - Large numeric score value
- **Feed %** - Current feed override
- **Status** - IDLE / CUTTING / CHATTER / REDUCING FEED
- **Trend arrow** - Rising/falling trend indicator
- **AI badge** - Pulsing when actively monitoring
- **WS badge** - WebSocket connection status
- **Material** - Current material (abbreviated)
- **RPM** - Current spindle speed
- **Sensor bars** - A/V/I mini bars for audio/accel/current

Boot sequence shows initialization progress and WiFi connection status.

---

## Calibration

### Quick Start Calibration

1. **Auto-Calibrate Idle Current**: Run spindle at operating RPM with no cut, click "AutoCal"
2. **Learn Noise Floor**: With spindle running, click "Learn" (10 seconds)
3. **Material Selection**: Choose correct material profile for proper frequency ranges
4. **Test Cuts**: Make test cuts, observe scores, adjust threshold if needed
5. **Save Settings**: Click "Save" to persist to flash (survives reboot)

### How Learning Works (AI Adaptive Thresholds)

The **"Learn"** button triggers a 10-second noise floor learning period:

1. System collects ~200 samples over 10 seconds
2. Calculates average "combined score" during this period
3. Sets **noiseFloor** = average × 1.5 (with 0.05 minimum)
4. Sets **adaptiveThreshold** = noiseFloor + 0.3

This allows the system to **adapt to YOUR machine's specific vibration signature**. Different machines have different baseline noise levels due to:
- Spindle bearings and motor characteristics
- Frame rigidity and resonances
- Mounting of sensors
- Environmental vibration (floors, other machines)

**When to re-learn:**
- After moving sensors
- After mechanical changes (new spindle, bearings, etc.)
- If false positives increase
- When switching between significantly different operations

### How Auto-Calibration Works

The **"AutoCal"** button performs current sensor calibration:

1. **Requires spindle running at operating RPM with NO material contact**
2. Samples current for 5 seconds
3. Sets **idleCurrent** = measured average
4. Sets **cuttingThreshold** = idleCurrent × 1.5
5. Sets **baselineCurrent** = idleCurrent × 2.0

This calibration is critical for:
- Accurate cutting detection (spindle loaded vs. air cutting)
- Tool breakage detection (sudden current drop)
- Efficiency calculations
- VFD power monitoring

**Tip:** Run AutoCal after each VFD parameter change or spindle maintenance.

---

## Sensor Health Monitoring

The system continuously monitors all sensors and reports specific error codes when issues occur.

### Sensor Error Codes

| Code | Name | Description | Common Cause |
|------|------|-------------|--------------|
| 0 | OK | Sensor working normally | - |
| 1 | NOT_FOUND | Sensor not detected during init | Wiring issue, sensor not connected |
| 2 | TIMEOUT | Sensor read timed out | I2S buffer issue, bad connection |
| 3 | INVALID_DATA | Data received is invalid | Electrical noise, damaged sensor |
| 4 | STUCK | Same value for 5+ seconds | Sensor frozen, driver issue |
| 5 | OUT_OF_RANGE | Values at ADC limits | Wiring issue (shorted or open) |

### Stuck Detection

Each sensor's last 100 readings are checked for stuck values:
- If value doesn't change more than tolerance for ~5 seconds, marked as STUCK
- Audio/Accel tolerance: 1.0
- ADC tolerance: 2 counts

### Out of Range Detection (ADC)

The ACS712 current sensor ADC is monitored for:
- **Low extreme**: values 0-10 → likely shorted or sensor not powered
- **High extreme**: values 4085-4095 → likely open circuit or sensor saturated

### Viewing Sensor Health

1. **WebSocket JSON**: Every update includes `sensors` object with status
2. **Diagnostics Modal** (Alt+D): Shows per-sensor status with troubleshooting tips
3. **TFT Display**: Sensor bars show A/V/I status during boot

### Sensor Troubleshooting

| Sensor | Error | Fix |
|--------|-------|-----|
| MPU-6050 | NOT_FOUND | Check I2C wiring (SDA=21, SCL=22), verify 3.3V power |
| MPU-6050 | STUCK | Restart ESP32, check I2C pull-ups (4.7kΩ) |
| INMP441 | NOT_FOUND | Check I2S wiring (BCK=26, WS=25, SD=33), verify 3.3V |
| INMP441 | TIMEOUT | Restart ESP32, check L/R pin (GND for left channel) |
| ACS712 | OUT_OF_RANGE (low) | Check 5V power to sensor, ADC wiring |
| ACS712 | OUT_OF_RANGE (high) | Check voltage divider, may be missing |
| ACS712 | STUCK | Sensor may be bypassed or wiring issue |

---

## Material Profiles

| Material | Audio Range | Accel Range | Notes |
|----------|-------------|-------------|-------|
| Aluminum | 800-4000 Hz | 100-400 Hz | High pitch squeal, current matters |
| Steel | 400-2500 Hz | 50-300 Hz | Lower frequency growl |
| Plastic | 600-3000 Hz | 80-350 Hz | Watch for melting |
| Wood | 500-2500 Hz | 60-300 Hz | Very forgiving |
| Brass | 700-3500 Hz | 90-380 Hz | Balanced sensors |
| Composite | 1000-5000 Hz | 150-500 Hz | Very sensitive (delamination!) |
| Copper | 600-3000 Hz | 80-350 Hz | Gummy like aluminum |

---

## FluidCNC Web UI Integration

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Alt+C` | Toggle panel visibility |
| `Alt+E` | Enable/disable detection |
| `Alt+D` | Show diagnostics modal |
| `Alt+T` | Show smart recommendations |
| `Alt+R` | Reset alerts |
| `Alt+L` | Start learning mode |
| `Alt+S` | Save settings |
| `Alt+M` | Toggle compact mode |
| `Alt+U` | Start auto-tuning wizard |
| `Alt+N` | Reset tool wear (new tool) |
| `Alt+1` | Switch to Auto mode |
| `Alt+2` | Switch to Aggressive mode |
| `Alt+3` | Switch to Conservative mode |
| `Escape` | Close any modal |

### UI Features

- **Compact Mode** - Minimal view showing only score and graph
- **Tool Wear Tracking** - Estimates wear from cutting time and load
- **Session Statistics** - Tracks efficiency, events, recoveries
- **Auto-Tuning Wizard** - Guided calibration process
- **Smart Recommendations** - AI-powered suggestions
- **Chatter Map** - Visual display of problem positions
- **Live Graph** - Real-time score with zones and prediction

---

## Safety Notes

⚠️ **MINIMUM FEED**: Never reduces below 25% (configurable per material)

⚠️ **RATE LIMITED**: Adjustments only every 500ms to prevent oscillation

⚠️ **HYSTERESIS**: Debounced detection prevents false triggers

⚠️ **PREDICTIVE**: Catches rising trends before threshold is reached

⚠️ **ADVISORY ONLY**: Does NOT replace proper feeds/speeds or operator attention!

---

## Bill of Materials

| Item | ~Cost |
|------|-------|
| ESP32 DevKit 38-pin | $5 |
| MPU-6050 Accelerometer | $3 |
| INMP441 I2S Microphone | $3 |
| ACS712T ELC-30A Current Sensor | $2 |
| GC9A01 1.28" Round TFT | $8 |
| Dupont wires | $2 |
| **Total** | **~$23** |

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| TFT blank | Check BL (backlight) connected to GPIO 5 |
| TFT garbled | Verify SPI wiring (MOSI=23, SCK=18, CS=15, DC=2, RST=4) |
| No WiFi | Check credentials in main.cpp, ensure 2.4GHz network |
| No grblHAL connection | Verify UART wiring (TX→RX, RX→TX), check baud rate 115200 |
| Current sensor wrong | Calibrate with known load, check 5V supply to ACS712 |
| High noise floor | Run "Learn" mode in quiet environment |
| False chatter detection | Increase threshold or use "conservative" mode |
| Feed not recovering | Check "stableCount" in diagnostics, may need longer stability |

---

## License

MIT - Use at your own risk!
