# FluidCNC - Easy Installation Guide

## 🚀 Quick Install (Recommended)

### One-Line Install (on your Pi/Le Potato)
```bash
curl -sSL https://raw.githubusercontent.com/your-username/fluidcnc/main/setup/install.sh | sudo bash
```

Or with wget:
```bash
wget -qO- https://raw.githubusercontent.com/your-username/fluidcnc/main/setup/install.sh | sudo bash
```

---

## 📦 Supported Boards

| Board | Status | Notes |
|-------|--------|-------|
| **Raspberry Pi 4/5** | ✅ Full Support | Recommended for best performance |
| **Raspberry Pi 3** | ✅ Full Support | Works great |
| **Raspberry Pi Zero 2 W** | ✅ Full Support | WiFi only, compact |
| **Le Potato (AML-S905X-CC)** | ✅ Full Support | Great Pi alternative |
| **Orange Pi Zero 2** | ✅ Full Support | Budget option |
| **Orange Pi 5** | ✅ Full Support | High performance |
| **ODROID-C4** | ✅ Full Support | |
| **x86/x64 Linux** | ✅ Full Support | Any Linux PC |

---

## 🎯 Pre-Built SD Card Images

Download ready-to-flash images (no setup required!):

1. **Download** the image for your board from [Releases](../../releases)
2. **Flash** using [balenaEtcher](https://balena.io/etcher) (Windows/Mac/Linux)
3. **Boot** your device
4. **Connect** to `http://fluidcnc.local` in your browser

That's it! 🎉

---

## 📋 Manual Installation

### Prerequisites
- Fresh OS installation (Raspberry Pi OS, Ubuntu, Armbian)
- Network connection
- SSH access (or keyboard/monitor)

### Step 1: Update System
```bash
sudo apt update && sudo apt upgrade -y
```

### Step 2: Download FluidCNC
```bash
git clone https://github.com/your-username/fluidcnc.git
cd fluidcnc
```

### Step 3: Run Installer
```bash
sudo bash setup/install.sh
```

### Step 4: Access Interface
Open your browser and go to:
- `http://fluidcnc.local`
- Or `http://<IP_ADDRESS>`

---

## ⚙️ Configuration

### WiFi Setup (Raspberry Pi)
Before first boot, edit the SD card's `wpa_supplicant.conf`:
```
network={
    ssid="YOUR_WIFI_NAME"
    psk="YOUR_WIFI_PASSWORD"
}
```

### Static IP (Optional)
Edit `/etc/dhcpcd.conf`:
```
interface eth0
static ip_address=192.168.1.100/24
static routers=192.168.1.1
static domain_name_servers=8.8.8.8
```

---

## 🛠️ Management Commands

After installation, these commands are available:

| Command | Description |
|---------|-------------|
| `fluidcnc-status` | Check service status and info |
| `fluidcnc-start` | Start FluidCNC service |
| `fluidcnc-stop` | Stop FluidCNC service |
| `fluidcnc-logs` | View live service logs |
| `fluidcnc-update` | Update to latest version |

---

## 🔌 Connecting Your CNC

### USB Connection
1. Connect your CNC controller via USB
2. The system auto-detects serial ports
3. Click "Connect" in the web interface

### Supported Controllers
- **grblHAL** (recommended) - STM32, ESP32, etc.
- **grbl** - Arduino-based
- **FluidNC** - ESP32-based

### Serial Port Permissions
The installer automatically configures permissions. If you have issues:
```bash
sudo usermod -a -G dialout $USER
# Log out and back in
```

---

## 🌐 Network Access

### Local Network
- **mDNS/Bonjour**: `http://fluidcnc.local`
- **IP Address**: Check with `fluidcnc-status`

### Remote Access (Advanced)
For access outside your local network, consider:
- VPN (recommended for security)
- Reverse proxy with HTTPS
- Cloudflare Tunnel

---

## 🔧 Troubleshooting

### Can't find fluidcnc.local?
1. Make sure you're on the same network
2. Try the IP address directly
3. On Windows, install [Bonjour](https://support.apple.com/kb/DL999)

### USB device not detected?
```bash
# Check connected devices
lsusb
ls -la /dev/ttyUSB* /dev/ttyACM*

# Check permissions
groups $USER  # Should include 'dialout'
```

### Service won't start?
```bash
# Check logs
fluidcnc-logs

# Or manually
journalctl -u fluidcnc -f
```

### Reset everything?
```bash
sudo systemctl stop fluidcnc
sudo rm -rf /opt/fluidcnc
# Re-run installer
```

---

## 📊 System Requirements

| Requirement | Minimum | Recommended |
|-------------|---------|-------------|
| RAM | 512MB | 1GB+ |
| Storage | 2GB | 8GB+ |
| CPU | Single-core ARM | Quad-core ARM |
| Network | WiFi or Ethernet | Ethernet |

---

## 🔄 Updating

### Automatic Update
```bash
fluidcnc-update
```

### Manual Update
```bash
cd /opt/fluidcnc
sudo git pull
sudo systemctl restart fluidcnc
```

---

## 📁 File Locations

| Path | Description |
|------|-------------|
| `/opt/fluidcnc/` | Main application files |
| `/etc/nginx/sites-available/fluidcnc` | Nginx configuration |
| `/etc/systemd/system/fluidcnc.service` | Systemd service |
| `/var/log/nginx/` | Web server logs |

---

## 💡 Tips

1. **Use Ethernet** for lowest latency
2. **Disable WiFi power saving** on Pi for reliability
3. **Use quality SD card** (Samsung EVO, SanDisk Extreme)
4. **Regular backups** of your settings

---

## 🆘 Support

- **Issues**: [GitHub Issues](../../issues)
- **Discussions**: [GitHub Discussions](../../discussions)
- **Wiki**: [Project Wiki](../../wiki)

---

## 📜 License

MIT License - See [LICENSE](../LICENSE) for details.
