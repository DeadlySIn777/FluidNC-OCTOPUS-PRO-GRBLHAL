# LePotato / Raspberry Pi Setup Guide

Complete guide for running FluidCNC on a **Libre Computer Le Potato** (AML-S905X-CC) or **Raspberry Pi 4**.

---

## 🎯 Why LePotato?

| Feature | LePotato | Raspberry Pi 4 |
|---------|----------|----------------|
| **Price** | ~$35 | ~$55+ |
| **USB Ports** | 4x USB 2.0 | 2x USB 3.0 + 2x USB 2.0 |
| **Ethernet** | Gigabit ✅ | Gigabit ✅ |
| **WiFi** | ❌ No | ✅ Built-in |
| **Power** | 5V 2A | 5V 3A |
| **For FluidCNC** | ✅ Perfect | ✅ Perfect |

Both work great! LePotato is cheaper and has enough USB ports. Pi 4 has WiFi if you need wireless.

---

## 📦 What You Need

### Hardware
- [ ] LePotato or Raspberry Pi 4 (2GB+ RAM)
- [ ] MicroSD card (16GB+ recommended)
- [ ] 5V 2A+ power supply (USB-C or Micro-USB)
- [ ] Ethernet cable
- [ ] **Powered USB 3.0 Hub** (critical for 3 devices!)
- [ ] USB cables for each device

### Software
- Armbian (LePotato) or Raspberry Pi OS (Pi 4)
- Python 3.8+
- Required packages: `aiohttp`, `pyserial`

---

## 🔧 Step 1: Flash the OS

### For LePotato
1. Download Armbian from [armbian.com](https://www.armbian.com/lepotato/)
2. Flash with [balenaEtcher](https://www.balena.io/etcher/)
3. Insert SD card, connect Ethernet, power on

### For Raspberry Pi 4
1. Download Raspberry Pi OS Lite (64-bit) from [raspberrypi.com](https://www.raspberrypi.com/software/)
2. Flash with Raspberry Pi Imager
3. Enable SSH in Imager settings
4. Insert SD card, connect Ethernet, power on

---

## 🌐 Step 2: First Boot & Network

### Find Your Device
```bash
# From another computer on the same network:
# Windows:
arp -a | findstr "b8-27"     # Pi
arp -a | findstr "02-00"     # LePotato

# Linux/Mac:
arp-scan --localnet | grep -i "raspberry\|libre"
# Or check your router's DHCP lease table
```

### SSH In
```bash
ssh root@<ip-address>       # LePotato default: root/1234
ssh pi@<ip-address>         # Pi default: pi/raspberry
```

### Set Static IP (Recommended)
```bash
# Edit netplan (LePotato/Ubuntu) or dhcpcd.conf (Pi)
# Example for /etc/netplan/01-netcfg.yaml:
network:
  version: 2
  ethernets:
    eth0:
      addresses: [192.168.1.50/24]
      gateway4: 192.168.1.1
      nameservers:
        addresses: [8.8.8.8, 8.8.4.4]
```

---

## 📦 Step 3: Install Dependencies

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Python and pip
sudo apt install -y python3 python3-pip git

# Install required packages
pip3 install aiohttp pyserial

# Verify installation
python3 -c "import aiohttp, serial; print('All packages installed!')"
```

---

## 📁 Step 4: Deploy FluidCNC

### Option A: Clone from Git
```bash
cd ~
git clone https://github.com/your-repo/fluidcnc.git
cd fluidcnc
```

### Option B: Copy from Development Machine
```bash
# From your Windows PC:
scp -r c:\Users\Gluis\Desktop\project\fluidcnc pi@192.168.1.50:~/

# Or use WinSCP for GUI transfer
```

---

## 🔌 Step 5: Connect USB Devices

### Physical Connection
```
USB Hub (Powered!)
├── Port 1: BTT Octopus Pro (grblHAL)
├── Port 2: Waveshare ESP32-S3 Touch LCD (Chatter)
├── Port 3: Seeed XIAO ESP32S3 Sense (Camera)
└── Port 4: (spare)
        │
        └──────── USB to LePotato/Pi
```

### Verify Detection
```bash
# List serial ports
ls -la /dev/ttyACM* /dev/ttyUSB*

# Expected output:
# /dev/ttyACM0 → Octopus Pro (STM32)
# /dev/ttyUSB0 → Waveshare ESP32-S3

# Check device details
dmesg | tail -20
# Look for: "USB Serial Device", "CH340", "STM32", "ESP32"

# List USB devices
lsusb
# Expected:
# Bus 001 Device 003: ID 0483:5740 STMicroelectronics  ← Octopus Pro
# Bus 001 Device 004: ID 303a:1001 Espressif           ← Waveshare ESP32
```

### Set Permissions
```bash
# Add user to dialout group (for serial access)
sudo usermod -a -G dialout $USER
sudo usermod -a -G plugdev $USER

# Logout and back in, or:
newgrp dialout
```

---

## 🚀 Step 6: Start the Server

### Manual Start (Testing)
```bash
cd ~/fluidcnc
python3 server.py

# Output:
# 🔍 Scanning for grblHAL controller...
# ✅ Found grblHAL on /dev/ttyACM0
# 🌐 Server running on http://0.0.0.0:8080
```

### Access from Any Device
Open a browser on your phone/tablet/laptop:
```
http://192.168.1.50:8080
```

---

## 🔄 Step 7: Auto-Start on Boot (systemd)

### Create Service File
```bash
sudo nano /etc/systemd/system/fluidcnc.service
```

### Paste This:
```ini
[Unit]
Description=FluidCNC WebSocket Bridge
After=network.target

[Service]
Type=simple
User=pi
WorkingDirectory=/home/pi/fluidcnc
ExecStart=/usr/bin/python3 /home/pi/fluidcnc/server.py
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

# Give time for USB devices to enumerate
ExecStartPre=/bin/sleep 3

[Install]
WantedBy=multi-user.target
```

> ⚠️ Change `User=pi` and paths to match your setup (e.g., `root` for LePotato)

### Enable and Start
```bash
# Reload systemd
sudo systemctl daemon-reload

# Enable auto-start
sudo systemctl enable fluidcnc

# Start now
sudo systemctl start fluidcnc

# Check status
sudo systemctl status fluidcnc

# View logs
journalctl -u fluidcnc -f
```

---

## 🔌 Step 8: USB Device Rules (Persistent Names)

Create udev rules for consistent device names:

```bash
sudo nano /etc/udev/rules.d/99-cnc-devices.rules
```

```udev
# BTT Octopus Pro (STM32)
SUBSYSTEM=="tty", ATTRS{idVendor}=="0483", ATTRS{idProduct}=="5740", SYMLINK+="ttyOCTOPUS"

# Waveshare ESP32-S3 (Chatter Sensor)
SUBSYSTEM=="tty", ATTRS{idVendor}=="303a", ATTRS{idProduct}=="1001", SYMLINK+="ttyCHATTER"

# Generic CH340 (fallback for some ESP32 boards)
SUBSYSTEM=="tty", ATTRS{idVendor}=="1a86", ATTRS{idProduct}=="7523", SYMLINK+="ttyCH340"
```

```bash
# Reload rules
sudo udevadm control --reload-rules
sudo udevadm trigger

# Now you can use:
# /dev/ttyOCTOPUS instead of /dev/ttyACM0
# /dev/ttyCHATTER instead of /dev/ttyUSB0
```

---

## 📡 Network Configuration

### Firewall (if enabled)
```bash
# Allow port 8080 (FluidCNC)
sudo ufw allow 8080/tcp

# Allow port 81 (WebSocket, if separate)
sudo ufw allow 81/tcp

# Check status
sudo ufw status
```

### mDNS (Optional - access by hostname)
```bash
# Install avahi
sudo apt install -y avahi-daemon

# Now access via:
# http://lepotato.local:8080  or  http://raspberrypi.local:8080
```

---

## 🔧 Troubleshooting

### No Serial Ports Detected
```bash
# Check USB
lsusb
dmesg | grep -i usb

# Try different USB cable
# Try without hub (direct connection)
# Check hub power
```

### Permission Denied on /dev/ttyACM0
```bash
# Quick fix
sudo chmod 666 /dev/ttyACM0

# Permanent fix
sudo usermod -a -G dialout $USER
# Then logout and back in
```

### Service Won't Start
```bash
# Check logs
journalctl -u fluidcnc -n 50 --no-pager

# Test manually first
cd ~/fluidcnc
python3 server.py
```

### WebSocket Connection Failed
```bash
# Check server is running
curl http://localhost:8080

# Check firewall
sudo ufw status

# Check from another machine
curl http://<lepotato-ip>:8080
```

---

## 📊 Performance Tips

### Reduce Latency
```bash
# Edit /boot/cmdline.txt (Pi) or equivalent
# Add: usbhid.mousepoll=0

# Disable unnecessary services
sudo systemctl disable bluetooth
sudo systemctl disable avahi-daemon  # if not using mDNS
```

### Monitor Resources
```bash
# CPU and Memory
htop

# Network
iftop -i eth0

# USB bandwidth
sudo apt install usbutils
lsusb -t
```

---

## 🔒 Security (Production)

### Change Default Passwords
```bash
passwd   # Change current user password
```

### Disable Root SSH (Pi)
```bash
sudo nano /etc/ssh/sshd_config
# Set: PermitRootLogin no
sudo systemctl restart sshd
```

### Keep Updated
```bash
sudo apt update && sudo apt upgrade -y
```

---

## ✅ Verification Checklist

- [ ] LePotato/Pi boots and has network
- [ ] Static IP configured
- [ ] Python 3 and packages installed
- [ ] FluidCNC files copied
- [ ] All 3 USB devices detected
- [ ] Serial permissions set (dialout group)
- [ ] `python3 server.py` runs without errors
- [ ] Browser can access `http://<ip>:8080`
- [ ] systemd service enabled for auto-start
- [ ] CNC responds to commands through UI

---

## 📞 Quick Reference

| Item | Value |
|------|-------|
| **FluidCNC URL** | `http://<lepotato-ip>:8080` |
| **Octopus Pro** | `/dev/ttyACM0` or `/dev/ttyOCTOPUS` |
| **Chatter Sensor** | `/dev/ttyUSB0` or `/dev/ttyCHATTER` |
| **Camera WiFi** | `FluidCNC-Camera` / `fluidcnc123` |
| **Camera URL** | `http://192.168.4.1` (on camera WiFi) |
| **Service Logs** | `journalctl -u fluidcnc -f` |
| **Restart Service** | `sudo systemctl restart fluidcnc` |
