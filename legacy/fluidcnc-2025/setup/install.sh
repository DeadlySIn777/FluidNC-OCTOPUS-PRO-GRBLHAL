#!/bin/bash
#
# FluidCNC Web Interface - One-Click Installer
# Supports: Raspberry Pi (all models), Le Potato (AML-S905X-CC), Orange Pi, etc.
#
# Usage: curl -sSL https://raw.githubusercontent.com/your-repo/fluidcnc/main/setup/install.sh | bash
#    or: wget -qO- https://raw.githubusercontent.com/your-repo/fluidcnc/main/setup/install.sh | bash
#

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Configuration
INSTALL_DIR="/opt/fluidcnc"
SERVICE_USER="fluidcnc"
REPO_URL="https://github.com/your-username/fluidcnc.git"
BRANCH="main"

# Detect board type
detect_board() {
    if [ -f /proc/device-tree/model ]; then
        MODEL=$(tr -d '\0' < /proc/device-tree/model)
        case "$MODEL" in
            *"Raspberry Pi"*)
                BOARD="raspberrypi"
                BOARD_NAME="Raspberry Pi"
                ;;
            *"Libre Computer AML-S905X-CC"*|*"Le Potato"*)
                BOARD="lepotato"
                BOARD_NAME="Le Potato"
                ;;
            *"Orange Pi"*)
                BOARD="orangepi"
                BOARD_NAME="Orange Pi"
                ;;
            *"ODROID"*)
                BOARD="odroid"
                BOARD_NAME="ODROID"
                ;;
            *)
                BOARD="generic"
                BOARD_NAME="Generic ARM SBC"
                ;;
        esac
    else
        # x86/x64 system
        BOARD="x86"
        BOARD_NAME="x86/x64 Linux"
    fi
}

# Print banner
print_banner() {
    echo -e "${CYAN}"
    echo "╔═══════════════════════════════════════════════════════════════╗"
    echo "║                                                               ║"
    echo "║   ███████╗██╗     ██╗   ██╗██╗██████╗  ██████╗███╗   ██╗ ██████╗  ║"
    echo "║   ██╔════╝██║     ██║   ██║██║██╔══██╗██╔════╝████╗  ██║██╔════╝  ║"
    echo "║   █████╗  ██║     ██║   ██║██║██║  ██║██║     ██╔██╗ ██║██║       ║"
    echo "║   ██╔══╝  ██║     ██║   ██║██║██║  ██║██║     ██║╚██╗██║██║       ║"
    echo "║   ██║     ███████╗╚██████╔╝██║██████╔╝╚██████╗██║ ╚████║╚██████╗  ║"
    echo "║   ╚═╝     ╚══════╝ ╚═════╝ ╚═╝╚═════╝  ╚═════╝╚═╝  ╚═══╝ ╚═════╝  ║"
    echo "║                                                               ║"
    echo "║         Modern CNC Control Interface for grblHAL             ║"
    echo "║                                                               ║"
    echo "╚═══════════════════════════════════════════════════════════════╝"
    echo -e "${NC}"
}

# Print step
step() {
    echo -e "${GREEN}[✓]${NC} $1"
}

# Print info
info() {
    echo -e "${BLUE}[i]${NC} $1"
}

# Print warning
warn() {
    echo -e "${YELLOW}[!]${NC} $1"
}

# Print error
error() {
    echo -e "${RED}[✗]${NC} $1"
}

# Check if running as root
check_root() {
    if [ "$EUID" -ne 0 ]; then
        error "Please run as root (sudo)"
        echo "Usage: sudo bash install.sh"
        exit 1
    fi
}

# Detect OS
detect_os() {
    if [ -f /etc/os-release ]; then
        . /etc/os-release
        OS=$ID
        OS_VERSION=$VERSION_ID
        OS_NAME=$PRETTY_NAME
    else
        OS="unknown"
        OS_NAME="Unknown"
    fi
}

# Install system dependencies
install_dependencies() {
    step "Installing system dependencies..."
    
    case $OS in
        debian|ubuntu|raspbian|armbian)
            apt-get update -qq
            apt-get install -y -qq \
                python3 \
                python3-pip \
                python3-venv \
                python3-serial \
                nginx \
                git \
                curl \
                wget \
                usbutils \
                avahi-daemon \
                libnss-mdns \
                > /dev/null 2>&1
            ;;
        fedora|centos|rhel)
            dnf install -y -q \
                python3 \
                python3-pip \
                python3-virtualenv \
                python3-pyserial \
                nginx \
                git \
                curl \
                wget \
                usbutils \
                avahi \
                nss-mdns \
                > /dev/null 2>&1
            ;;
        arch|manjaro)
            pacman -Sy --noconfirm --quiet \
                python \
                python-pip \
                python-virtualenv \
                python-pyserial \
                nginx \
                git \
                curl \
                wget \
                usbutils \
                avahi \
                nss-mdns \
                > /dev/null 2>&1
            ;;
        *)
            warn "Unknown OS, attempting apt-get..."
            apt-get update -qq
            apt-get install -y -qq python3 python3-pip python3-venv nginx git curl wget usbutils > /dev/null 2>&1
            ;;
    esac
}

# Create service user
create_user() {
    if id "$SERVICE_USER" &>/dev/null; then
        info "User $SERVICE_USER already exists"
    else
        step "Creating service user: $SERVICE_USER"
        useradd -r -s /bin/false -d "$INSTALL_DIR" "$SERVICE_USER" 2>/dev/null || true
    fi
    
    # Add user to dialout group for serial access
    usermod -a -G dialout "$SERVICE_USER" 2>/dev/null || true
    usermod -a -G tty "$SERVICE_USER" 2>/dev/null || true
    usermod -a -G video "$SERVICE_USER" 2>/dev/null || true  # For camera access
}

# Install FluidCNC files
install_fluidcnc() {
    step "Installing FluidCNC web interface..."
    
    # Create install directory
    mkdir -p "$INSTALL_DIR"
    
    # If git repo available, clone it
    if command -v git &> /dev/null && [ -n "$REPO_URL" ]; then
        if [ -d "$INSTALL_DIR/.git" ]; then
            info "Updating existing installation..."
            cd "$INSTALL_DIR"
            git pull --quiet origin "$BRANCH" 2>/dev/null || true
        else
            info "Fresh installation from repository..."
            git clone --quiet --depth 1 --branch "$BRANCH" "$REPO_URL" "$INSTALL_DIR" 2>/dev/null || {
                warn "Git clone failed, using local copy method"
                # Fallback: copy from current directory if this is run locally
                if [ -f "./index.html" ]; then
                    cp -r ./* "$INSTALL_DIR/"
                fi
            }
        fi
    fi
    
    # Set permissions
    chown -R "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR"
    chmod -R 755 "$INSTALL_DIR"
}

# Setup Python virtual environment
setup_python_env() {
    step "Setting up Python environment..."
    
    cd "$INSTALL_DIR"
    
    # Create virtual environment
    python3 -m venv venv
    
    # Activate and install dependencies
    source venv/bin/activate
    pip install --quiet --upgrade pip
    pip install --quiet \
        pyserial \
        websockets \
        aiohttp \
        flask \
        flask-cors \
        python-dotenv
    
    deactivate
}

# Configure nginx
configure_nginx() {
    step "Configuring nginx web server..."
    
    # Create nginx config
    cat > /etc/nginx/sites-available/fluidcnc << 'EOF'
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    
    server_name fluidcnc fluidcnc.local _;
    
    root /opt/fluidcnc;
    index index.html;
    
    # Serve static files
    location / {
        try_files $uri $uri/ /index.html;
        
        # CORS headers for WebSerial
        add_header Access-Control-Allow-Origin *;
        add_header Access-Control-Allow-Methods "GET, POST, OPTIONS";
        add_header Access-Control-Allow-Headers "DNT,User-Agent,X-Requested-With,If-Modified-Since,Cache-Control,Content-Type,Range";
    }
    
    # Cache static assets
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
        expires 1d;
        add_header Cache-Control "public, immutable";
    }
    
    # WebSocket proxy for camera
    location /ws {
        proxy_pass http://127.0.0.1:8765;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 86400;
    }
    
    # API proxy
    location /api {
        proxy_pass http://127.0.0.1:5000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
    
    # Gzip compression
    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml;
    gzip_min_length 1000;
}
EOF

    # Enable site
    ln -sf /etc/nginx/sites-available/fluidcnc /etc/nginx/sites-enabled/fluidcnc
    rm -f /etc/nginx/sites-enabled/default 2>/dev/null || true
    
    # Test and reload nginx
    nginx -t > /dev/null 2>&1
    systemctl restart nginx
    systemctl enable nginx > /dev/null 2>&1
}

# Create systemd service
create_service() {
    step "Creating systemd service..."
    
    cat > /etc/systemd/system/fluidcnc.service << EOF
[Unit]
Description=FluidCNC Web Interface
After=network.target
Wants=network-online.target

[Service]
Type=simple
User=$SERVICE_USER
Group=$SERVICE_USER
WorkingDirectory=$INSTALL_DIR
ExecStart=$INSTALL_DIR/venv/bin/python $INSTALL_DIR/server.py
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

# Security hardening
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=$INSTALL_DIR
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF

    systemctl daemon-reload
    systemctl enable fluidcnc > /dev/null 2>&1
}

# Configure serial port permissions
configure_serial() {
    step "Configuring serial port access..."
    
    # Create udev rule for USB serial devices
    cat > /etc/udev/rules.d/99-fluidcnc-serial.rules << 'EOF'
# FluidCNC - Grant access to USB serial devices
SUBSYSTEM=="tty", ATTRS{idVendor}=="1a86", MODE="0666", GROUP="dialout"
SUBSYSTEM=="tty", ATTRS{idVendor}=="0483", MODE="0666", GROUP="dialout"
SUBSYSTEM=="tty", ATTRS{idVendor}=="10c4", MODE="0666", GROUP="dialout"
SUBSYSTEM=="tty", ATTRS{idVendor}=="067b", MODE="0666", GROUP="dialout"
SUBSYSTEM=="tty", ATTRS{idVendor}=="2341", MODE="0666", GROUP="dialout"
SUBSYSTEM=="tty", ATTRS{idVendor}=="1d6b", MODE="0666", GROUP="dialout"
SUBSYSTEM=="tty", KERNEL=="ttyUSB*", MODE="0666", GROUP="dialout"
SUBSYSTEM=="tty", KERNEL=="ttyACM*", MODE="0666", GROUP="dialout"
EOF

    # Reload udev rules
    udevadm control --reload-rules
    udevadm trigger
}

# Configure mDNS/Avahi for .local hostname
configure_mdns() {
    step "Configuring network discovery (mDNS)..."
    
    # Set hostname
    hostnamectl set-hostname fluidcnc 2>/dev/null || echo "fluidcnc" > /etc/hostname
    
    # Configure Avahi
    cat > /etc/avahi/services/fluidcnc.service << 'EOF'
<?xml version="1.0" standalone='no'?>
<!DOCTYPE service-group SYSTEM "avahi-service.dtd">
<service-group>
  <name>FluidCNC Web Interface</name>
  <service>
    <type>_http._tcp</type>
    <port>80</port>
    <txt-record>path=/</txt-record>
    <txt-record>desc=CNC Control Interface</txt-record>
  </service>
</service-group>
EOF

    # Restart Avahi
    systemctl restart avahi-daemon 2>/dev/null || true
    systemctl enable avahi-daemon > /dev/null 2>&1 || true
}

# Board-specific optimizations
apply_board_optimizations() {
    step "Applying optimizations for $BOARD_NAME..."
    
    case $BOARD in
        lepotato)
            # Le Potato specific: Enable USB OTG if needed
            info "Le Potato detected - enabling USB optimizations"
            # Increase USB buffer for serial
            echo 'options usbcore usbfs_memory_mb=64' > /etc/modprobe.d/usb.conf 2>/dev/null || true
            ;;
        raspberrypi)
            # Raspberry Pi specific optimizations
            info "Raspberry Pi detected"
            # Enable hardware serial if available
            if [ -f /boot/config.txt ]; then
                if ! grep -q "enable_uart=1" /boot/config.txt; then
                    echo "enable_uart=1" >> /boot/config.txt
                fi
            fi
            # Disable serial console to free up UART
            systemctl stop serial-getty@ttyS0.service 2>/dev/null || true
            systemctl disable serial-getty@ttyS0.service 2>/dev/null || true
            ;;
        orangepi)
            info "Orange Pi detected"
            ;;
    esac
}

# Create convenience scripts
create_scripts() {
    step "Creating management scripts..."
    
    # Start script
    cat > /usr/local/bin/fluidcnc-start << 'EOF'
#!/bin/bash
sudo systemctl start fluidcnc nginx
echo "FluidCNC started. Access at http://fluidcnc.local or http://$(hostname -I | awk '{print $1}')"
EOF
    chmod +x /usr/local/bin/fluidcnc-start
    
    # Stop script
    cat > /usr/local/bin/fluidcnc-stop << 'EOF'
#!/bin/bash
sudo systemctl stop fluidcnc
echo "FluidCNC stopped"
EOF
    chmod +x /usr/local/bin/fluidcnc-stop
    
    # Status script
    cat > /usr/local/bin/fluidcnc-status << 'EOF'
#!/bin/bash
echo "=== FluidCNC Status ==="
systemctl status fluidcnc --no-pager -l
echo ""
echo "=== Nginx Status ==="
systemctl status nginx --no-pager -l
echo ""
echo "=== USB Serial Devices ==="
ls -la /dev/ttyUSB* /dev/ttyACM* 2>/dev/null || echo "No USB serial devices found"
echo ""
echo "=== Network ==="
echo "IP Address: $(hostname -I | awk '{print $1}')"
echo "Hostname: $(hostname).local"
echo "Access URL: http://$(hostname -I | awk '{print $1}') or http://$(hostname).local"
EOF
    chmod +x /usr/local/bin/fluidcnc-status
    
    # Update script
    cat > /usr/local/bin/fluidcnc-update << 'EOF'
#!/bin/bash
echo "Updating FluidCNC..."
cd /opt/fluidcnc
sudo git pull origin main
sudo systemctl restart fluidcnc
echo "Update complete!"
EOF
    chmod +x /usr/local/bin/fluidcnc-update
    
    # Logs script
    cat > /usr/local/bin/fluidcnc-logs << 'EOF'
#!/bin/bash
journalctl -u fluidcnc -f
EOF
    chmod +x /usr/local/bin/fluidcnc-logs
}

# Get IP address
get_ip() {
    hostname -I | awk '{print $1}'
}

# Print completion message
print_completion() {
    IP=$(get_ip)
    
    echo ""
    echo -e "${GREEN}╔═══════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║                                                               ║${NC}"
    echo -e "${GREEN}║   ✅ FluidCNC Installation Complete!                          ║${NC}"
    echo -e "${GREEN}║                                                               ║${NC}"
    echo -e "${GREEN}╠═══════════════════════════════════════════════════════════════╣${NC}"
    echo -e "${GREEN}║${NC}                                                               ${GREEN}║${NC}"
    echo -e "${GREEN}║${NC}   📍 Access your CNC controller at:                          ${GREEN}║${NC}"
    echo -e "${GREEN}║${NC}                                                               ${GREEN}║${NC}"
    echo -e "${GREEN}║${NC}      ${CYAN}http://$IP${NC}                                ${GREEN}║${NC}"
    echo -e "${GREEN}║${NC}      ${CYAN}http://fluidcnc.local${NC}                               ${GREEN}║${NC}"
    echo -e "${GREEN}║${NC}                                                               ${GREEN}║${NC}"
    echo -e "${GREEN}║${NC}   🛠️  Management Commands:                                    ${GREEN}║${NC}"
    echo -e "${GREEN}║${NC}      ${YELLOW}fluidcnc-status${NC}  - Check service status               ${GREEN}║${NC}"
    echo -e "${GREEN}║${NC}      ${YELLOW}fluidcnc-start${NC}   - Start FluidCNC                    ${GREEN}║${NC}"
    echo -e "${GREEN}║${NC}      ${YELLOW}fluidcnc-stop${NC}    - Stop FluidCNC                     ${GREEN}║${NC}"
    echo -e "${GREEN}║${NC}      ${YELLOW}fluidcnc-logs${NC}    - View live logs                    ${GREEN}║${NC}"
    echo -e "${GREEN}║${NC}      ${YELLOW}fluidcnc-update${NC}  - Update to latest version          ${GREEN}║${NC}"
    echo -e "${GREEN}║${NC}                                                               ${GREEN}║${NC}"
    echo -e "${GREEN}║${NC}   📋 Board: ${BLUE}$BOARD_NAME${NC}                              ${GREEN}║${NC}"
    echo -e "${GREEN}║${NC}   📋 OS: ${BLUE}$OS_NAME${NC}                                   ${GREEN}║${NC}"
    echo -e "${GREEN}║${NC}                                                               ${GREEN}║${NC}"
    echo -e "${GREEN}╚═══════════════════════════════════════════════════════════════╝${NC}"
    echo ""
}

# Main installation
main() {
    print_banner
    check_root
    
    echo -e "${CYAN}Starting FluidCNC installation...${NC}"
    echo ""
    
    detect_os
    detect_board
    
    info "Detected: $BOARD_NAME running $OS_NAME"
    echo ""
    
    install_dependencies
    create_user
    install_fluidcnc
    setup_python_env
    configure_nginx
    create_service
    configure_serial
    configure_mdns
    apply_board_optimizations
    create_scripts
    
    # Start services
    step "Starting FluidCNC service..."
    systemctl start fluidcnc
    
    print_completion
}

# Run main
main "$@"
