# FluidCNC Le Potato Deployment

Dedicated CNC controller on Libre Computer Le Potato (AML-S905X-CC).

## Hardware Setup

```
Le Potato
├── USB1: grblHAL (Octopus Pro via USB-C)
├── USB2: VFD Controller (ESP32 + MAX485)
├── USB3: Chatter Sensor (ESP32-S3) [optional]
├── HDMI: 7" Touchscreen (1024x600)
└── Ethernet/WiFi: SSH access
```

## Quick Install

1. **Flash Le Potato** with Armbian or Ubuntu:
   - Download: https://distro.libre.computer/ci/ubuntu/22.04/
   - Flash with Balena Etcher

2. **First boot setup**:
   ```bash
   # Connect via SSH or HDMI+keyboard
   sudo apt update && sudo apt install -y git
   
   # Clone FluidCNC
   git clone https://github.com/yourrepo/fluidcnc.git
   cd fluidcnc/deploy
   
   # Run setup
   sudo bash lepotato-setup.sh
   
   # Reboot into kiosk mode
   sudo reboot
   ```

## What It Does

1. **Installs packages**: Python, Chromium, Openbox
2. **USB permissions**: Auto-creates /dev/grblhal, /dev/vfd symlinks
3. **FluidCNC service**: Auto-starts web server on port 8080
4. **Kiosk mode**: Chromium fullscreen on boot
5. **SSH enabled**: Remote access for modifications

## SSH Access

```bash
# Find IP (shown on boot or from router)
ssh lepotato@192.168.x.x

# Edit FluidCNC files
cd ~/fluidcnc
nano app.js
sudo systemctl restart fluidcnc
```

## Touchscreen Calibration

For 7" HDMI touchscreens:

```bash
# Install xinput-calibrator
sudo apt install xinput-calibrator

# Run calibration (touch the targets)
xinput_calibrator

# Save the output to:
sudo nano /etc/X11/xorg.conf.d/99-calibration.conf
```

## Useful Commands

| Command | Description |
|---------|-------------|
| `sudo systemctl status fluidcnc` | Check server status |
| `sudo systemctl restart fluidcnc` | Restart web server |
| `journalctl -u fluidcnc -f` | View server logs |
| `Ctrl+Alt+F2` | Switch to console (exit kiosk) |
| `Ctrl+Alt+F1` | Switch back to kiosk |
| `ls /dev/ttyUSB* /dev/ttyACM*` | List USB serial devices |

## Recommended Touchscreens

| Screen | Resolution | Notes |
|--------|------------|-------|
| Waveshare 7" | 1024x600 | Good, capacitive |
| Elecrow 7" | 1024x600 | Budget option |
| Official Pi 7" | 800x480 | Works with adapter |

## Network Setup

### Static IP (recommended for CNC):

```bash
sudo nmtui
# Select "Edit a connection"
# Select your interface
# Set IPv4 to Manual
# Add your IP (e.g., 192.168.1.50/24)
# Save and activate
```

### WiFi:

```bash
sudo nmtui
# Select "Activate a connection"
# Select your WiFi network
# Enter password
```

## Updating FluidCNC

```bash
ssh lepotato@192.168.x.x
cd ~/fluidcnc
git pull
sudo systemctl restart fluidcnc
```

## Backup/Restore

```bash
# Backup (from your PC)
scp -r lepotato@192.168.x.x:~/fluidcnc ./fluidcnc-backup

# Restore
scp -r ./fluidcnc-backup/* lepotato@192.168.x.x:~/fluidcnc/
ssh lepotato@192.168.x.x "sudo systemctl restart fluidcnc"
```

## Troubleshooting

### Screen is black
```bash
# SSH in and check X
ssh lepotato@192.168.x.x
journalctl -u getty@tty1 -n 50
startx  # Try starting manually
```

### USB devices not detected
```bash
# Check USB devices
lsusb
ls -la /dev/ttyUSB* /dev/ttyACM*

# Reload udev rules
sudo udevadm control --reload-rules
sudo udevadm trigger
```

### FluidCNC not loading
```bash
# Check service
sudo systemctl status fluidcnc
journalctl -u fluidcnc -f

# Test manually
cd ~/fluidcnc
python3 -m http.server 8080
```
