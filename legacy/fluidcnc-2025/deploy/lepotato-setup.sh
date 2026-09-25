#!/bin/bash
# ============================================================
# FluidCNC Le Potato Deployment Script
# Libre Computer Le Potato (AML-S905X-CC)
# 
# Creates a dedicated CNC controller with:
# - Touchscreen kiosk UI
# - SSH access for remote modifications
# - Auto-start on boot
# - USB serial passthrough for all devices
# ============================================================

set -e

echo "=========================================="
echo "FluidCNC Le Potato Setup"
echo "=========================================="

# Check if running as root
if [ "$EUID" -ne 0 ]; then
    echo "Please run as root: sudo bash lepotato-setup.sh"
    exit 1
fi

# Get the actual user (not root)
ACTUAL_USER=${SUDO_USER:-$USER}
HOME_DIR="/home/$ACTUAL_USER"
FLUIDCNC_DIR="$HOME_DIR/fluidcnc"

echo "Installing for user: $ACTUAL_USER"
echo "FluidCNC directory: $FLUIDCNC_DIR"

# ============================================================
# 1. System Update & Base Packages
# ============================================================
echo ""
echo "[1/8] Updating system and installing packages..."

apt update && apt upgrade -y

apt install -y \
    python3 python3-pip python3-venv \
    chromium-browser \
    xorg xinit openbox \
    unclutter \
    git curl wget \
    usbutils \
    network-manager \
    openssh-server \
    htop nano \
    xinput xinput-calibrator \
    xserver-xorg-input-evdev \
    xserver-xorg-input-libinput

# ============================================================
# 2. Setup FluidCNC Directory
# ============================================================
echo ""
echo "[2/8] Setting up FluidCNC..."

mkdir -p "$FLUIDCNC_DIR"
chown -R $ACTUAL_USER:$ACTUAL_USER "$FLUIDCNC_DIR"

# Copy files (assuming they're in current directory)
if [ -d "./fluidcnc" ]; then
    cp -r ./fluidcnc/* "$FLUIDCNC_DIR/"
elif [ -f "./index.html" ]; then
    cp -r ./* "$FLUIDCNC_DIR/"
fi

chown -R $ACTUAL_USER:$ACTUAL_USER "$FLUIDCNC_DIR"

# ============================================================
# 3. Python Environment
# ============================================================
echo ""
echo "[3/8] Setting up Python environment..."

sudo -u $ACTUAL_USER python3 -m venv "$FLUIDCNC_DIR/venv"
sudo -u $ACTUAL_USER "$FLUIDCNC_DIR/venv/bin/pip" install --upgrade pip
sudo -u $ACTUAL_USER "$FLUIDCNC_DIR/venv/bin/pip" install \
    pyserial \
    websockets \
    aiohttp

# ============================================================
# 4. USB Serial Permissions
# ============================================================
echo ""
echo "[4/8] Configuring USB serial permissions..."

# Add user to dialout group for serial access
usermod -a -G dialout $ACTUAL_USER

# Create udev rules for consistent device naming
cat > /etc/udev/rules.d/99-fluidcnc.rules << 'EOF'
# grblHAL - STM32 (Octopus Pro)
SUBSYSTEM=="tty", ATTRS{idVendor}=="0483", ATTRS{idProduct}=="5740", SYMLINK+="grblhal", MODE="0666"

# ESP32 VFD Controller - CP2102
SUBSYSTEM=="tty", ATTRS{idVendor}=="10c4", ATTRS{idProduct}=="ea60", SYMLINK+="vfd", MODE="0666"

# ESP32 VFD Controller - CH340
SUBSYSTEM=="tty", ATTRS{idVendor}=="1a86", ATTRS{idProduct}=="7523", SYMLINK+="vfd_ch340", MODE="0666"

# ESP32-S3 Chatter Sensor - Native USB
SUBSYSTEM=="tty", ATTRS{idVendor}=="303a", ATTRS{idProduct}=="1001", SYMLINK+="chatter", MODE="0666"

# Generic FTDI
SUBSYSTEM=="tty", ATTRS{idVendor}=="0403", SYMLINK+="ftdi%n", MODE="0666"
EOF

udevadm control --reload-rules
udevadm trigger

# ============================================================
# 5. FluidCNC Systemd Service
# ============================================================
echo ""
echo "[5/8] Creating FluidCNC service..."

cat > /etc/systemd/system/fluidcnc.service << EOF
[Unit]
Description=FluidCNC Web Server
After=network.target

[Service]
Type=simple
User=$ACTUAL_USER
WorkingDirectory=$FLUIDCNC_DIR
ExecStart=/usr/bin/python3 -m http.server 8080
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable fluidcnc.service

# ============================================================
# 6. Kiosk Mode Setup (Openbox + Chromium)
# ============================================================
echo ""
echo "[6/8] Setting up kiosk mode..."

# Create openbox autostart
mkdir -p "$HOME_DIR/.config/openbox"
cat > "$HOME_DIR/.config/openbox/autostart" << 'EOF'
# Disable screen blanking
xset s off
xset s noblank
xset -dpms

# Hide cursor after 0.5 seconds of inactivity
unclutter -idle 0.5 -root &

# Wait for FluidCNC server
sleep 3

# Launch Chromium in kiosk mode
chromium-browser \
    --kiosk \
    --noerrdialogs \
    --disable-infobars \
    --disable-session-crashed-bubble \
    --disable-restore-session-state \
    --no-first-run \
    --start-fullscreen \
    --autoplay-policy=no-user-gesture-required \
    --check-for-update-interval=31536000 \
    http://localhost:8080
EOF

chown -R $ACTUAL_USER:$ACTUAL_USER "$HOME_DIR/.config"

# Create .xinitrc
cat > "$HOME_DIR/.xinitrc" << 'EOF'
exec openbox-session
EOF
chown $ACTUAL_USER:$ACTUAL_USER "$HOME_DIR/.xinitrc"

# ============================================================
# 7. Auto-login and Auto-start X
# ============================================================
echo ""
echo "[7/8] Configuring auto-login..."

# Create getty override for auto-login on tty1
mkdir -p /etc/systemd/system/getty@tty1.service.d/
cat > /etc/systemd/system/getty@tty1.service.d/override.conf << EOF
[Service]
ExecStart=
ExecStart=-/sbin/agetty --autologin $ACTUAL_USER --noclear %I \$TERM
EOF

# Auto-start X on login (add to .bash_profile)
cat >> "$HOME_DIR/.bash_profile" << 'EOF'

# Auto-start X on tty1
if [ -z "$DISPLAY" ] && [ "$(tty)" = "/dev/tty1" ]; then
    exec startx
fi
EOF
chown $ACTUAL_USER:$ACTUAL_USER "$HOME_DIR/.bash_profile"

# ============================================================
# 8. SSH Configuration
# ============================================================
echo ""
echo "[8/9] Configuring SSH..."

# Enable SSH
systemctl enable ssh
systemctl start ssh

# Create SSH directory
mkdir -p "$HOME_DIR/.ssh"
chmod 700 "$HOME_DIR/.ssh"
chown $ACTUAL_USER:$ACTUAL_USER "$HOME_DIR/.ssh"

# ============================================================
# 9. Touchscreen Configuration (7" 1024x600)
# ============================================================
echo ""
echo "[9/9] Configuring 7-inch touchscreen..."

# Create xorg config for touchscreen
mkdir -p /etc/X11/xorg.conf.d

# Touchscreen input config
cat > /etc/X11/xorg.conf.d/40-libinput.conf << 'EOF'
# Touchscreen configuration for 7" display
Section "InputClass"
    Identifier "libinput touchscreen catchall"
    MatchIsTouchscreen "on"
    MatchDevicePath "/dev/input/event*"
    Driver "libinput"
    Option "CalibrationMatrix" "1 0 0 0 1 0 0 0 1"
    Option "TransformationMatrix" "1 0 0 0 1 0 0 0 1"
EndSection
EOF

# HDMI display config for 7" 1024x600
cat > /etc/X11/xorg.conf.d/10-monitor.conf << 'EOF'
# 7" HDMI Touchscreen (1024x600)
Section "Monitor"
    Identifier "HDMI-1"
    Option "PreferredMode" "1024x600"
EndSection

Section "Screen"
    Identifier "Screen0"
    Monitor "HDMI-1"
    DefaultDepth 24
    SubSection "Display"
        Depth 24
        Modes "1024x600"
    EndSubSection
EndSection
EOF

# Create touchscreen calibration script
cat > "$FLUIDCNC_DIR/calibrate-touch.sh" << 'CALIBRATE'
#!/bin/bash
# Run this to calibrate touchscreen
# Touch the crosshairs when they appear

echo "Starting touchscreen calibration..."
echo "Touch each crosshair as it appears."
echo ""

# Run calibrator
DISPLAY=:0 xinput_calibrator --output-type xorg.conf.d

echo ""
echo "Copy the output above to:"
echo "  /etc/X11/xorg.conf.d/99-calibration.conf"
echo ""
echo "Then reboot: sudo reboot"
CALIBRATE
chmod +x "$FLUIDCNC_DIR/calibrate-touch.sh"
chown $ACTUAL_USER:$ACTUAL_USER "$FLUIDCNC_DIR/calibrate-touch.sh"

# Print network info
echo ""
echo "=========================================="
echo "Setup Complete!"
echo "=========================================="
echo ""
echo "FluidCNC installed to: $FLUIDCNC_DIR"
echo ""
echo "7\" Touchscreen configured for 1024x600"
echo ""
echo "Services:"
echo "  - FluidCNC server: http://localhost:8080"
echo "  - SSH: ssh $ACTUAL_USER@$(hostname -I | awk '{print $1}')"
echo ""
echo "USB Device Symlinks (when connected):"
echo "  - /dev/grblhal  -> Octopus Pro"
echo "  - /dev/vfd      -> VFD Controller"  
echo "  - /dev/chatter  -> Chatter Sensor"
echo ""
echo "Touchscreen:"
echo "  - If touch is offset, run: ~/fluidcnc/calibrate-touch.sh"
echo ""
echo "Commands:"
echo "  - Restart UI:    sudo systemctl restart fluidcnc"
echo "  - View logs:     journalctl -u fluidcnc -f"
echo "  - Stop kiosk:    Press Ctrl+Alt+F2 for console"
echo "  - Calibrate:     ~/fluidcnc/calibrate-touch.sh"
echo "  - Edit files:    SSH in and edit $FLUIDCNC_DIR/"
echo ""
echo "Reboot to start kiosk mode: sudo reboot"
echo ""
