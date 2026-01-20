#!/bin/bash
#
# FluidCNC - SD Card Image Builder
# Creates a ready-to-flash image for Le Potato, Raspberry Pi, etc.
#
# This script should be run on a Linux host machine with root access
#

set -e

# Configuration
IMAGE_NAME="fluidcnc-$(date +%Y%m%d)"
IMAGE_SIZE="4G"
WORK_DIR="/tmp/fluidcnc-build"
OUTPUT_DIR="./output"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

print_banner() {
    echo -e "${CYAN}"
    echo "╔═══════════════════════════════════════════════════════╗"
    echo "║     FluidCNC SD Card Image Builder                   ║"
    echo "╚═══════════════════════════════════════════════════════╝"
    echo -e "${NC}"
}

# Check dependencies
check_deps() {
    echo -e "${GREEN}[1/8]${NC} Checking dependencies..."
    
    for cmd in wget dd losetup mount umount mkfs.ext4 mkfs.vfat parted; do
        if ! command -v $cmd &> /dev/null; then
            echo -e "${RED}Error: $cmd is required but not installed${NC}"
            exit 1
        fi
    done
}

# Select board type
select_board() {
    echo -e "${GREEN}[2/8]${NC} Select target board:"
    echo ""
    echo "  1) Raspberry Pi 3/4/5 (64-bit)"
    echo "  2) Raspberry Pi Zero 2 W"
    echo "  3) Le Potato (AML-S905X-CC)"
    echo "  4) Orange Pi Zero 2"
    echo "  5) Generic ARM64"
    echo ""
    read -p "Enter choice [1-5]: " BOARD_CHOICE
    
    case $BOARD_CHOICE in
        1)
            BOARD="rpi"
            BOARD_NAME="Raspberry Pi"
            BASE_IMAGE_URL="https://downloads.raspberrypi.com/raspios_lite_arm64/images/raspios_lite_arm64-2024-03-15/2024-03-15-raspios-bookworm-arm64-lite.img.xz"
            ;;
        2)
            BOARD="rpizero2"
            BOARD_NAME="Raspberry Pi Zero 2 W"
            BASE_IMAGE_URL="https://downloads.raspberrypi.com/raspios_lite_arm64/images/raspios_lite_arm64-2024-03-15/2024-03-15-raspios-bookworm-arm64-lite.img.xz"
            ;;
        3)
            BOARD="lepotato"
            BOARD_NAME="Le Potato"
            BASE_IMAGE_URL="https://distro.libre.computer/ci/ubuntu/22.04/ubuntu-22.04.3-preinstalled-server-arm64%2Baml-s905x-cc.img.xz"
            ;;
        4)
            BOARD="orangepi"
            BOARD_NAME="Orange Pi Zero 2"
            BASE_IMAGE_URL="http://www.intronics.nl/downloads/2022-07-26-Armbian_22.08.0-trunk_Orangepizero2_bullseye_current_5.15.52.img.xz"
            ;;
        5)
            BOARD="generic"
            BOARD_NAME="Generic ARM64"
            BASE_IMAGE_URL=""
            ;;
        *)
            echo "Invalid choice"
            exit 1
            ;;
    esac
    
    echo ""
    echo -e "${CYAN}Selected: $BOARD_NAME${NC}"
}

# Download base image
download_base() {
    echo -e "${GREEN}[3/8]${NC} Downloading base image..."
    
    mkdir -p "$WORK_DIR"
    cd "$WORK_DIR"
    
    if [ -z "$BASE_IMAGE_URL" ]; then
        echo "Please provide a base image manually in $WORK_DIR/base.img"
        read -p "Press Enter when ready..."
    else
        FILENAME=$(basename "$BASE_IMAGE_URL")
        if [ ! -f "$FILENAME" ]; then
            wget -q --show-progress "$BASE_IMAGE_URL"
        else
            echo "Base image already downloaded"
        fi
        
        # Extract if compressed
        if [[ "$FILENAME" == *.xz ]]; then
            echo "Extracting image..."
            xz -dk "$FILENAME" 2>/dev/null || true
            mv "${FILENAME%.xz}" base.img
        elif [[ "$FILENAME" == *.gz ]]; then
            echo "Extracting image..."
            gunzip -k "$FILENAME" 2>/dev/null || true
            mv "${FILENAME%.gz}" base.img
        else
            cp "$FILENAME" base.img
        fi
    fi
}

# Mount image
mount_image() {
    echo -e "${GREEN}[4/8]${NC} Mounting image..."
    
    # Setup loop device
    LOOP_DEV=$(losetup -f --show -P base.img)
    echo "Loop device: $LOOP_DEV"
    
    # Create mount points
    mkdir -p "$WORK_DIR/rootfs"
    mkdir -p "$WORK_DIR/boot"
    
    # Mount partitions
    mount "${LOOP_DEV}p2" "$WORK_DIR/rootfs" 2>/dev/null || mount "${LOOP_DEV}p1" "$WORK_DIR/rootfs"
    
    # Try to mount boot partition if it exists
    if [ -b "${LOOP_DEV}p1" ]; then
        mount "${LOOP_DEV}p1" "$WORK_DIR/boot" 2>/dev/null || true
    fi
    
    echo "Mounted successfully"
}

# Install FluidCNC into image
install_fluidcnc() {
    echo -e "${GREEN}[5/8]${NC} Installing FluidCNC into image..."
    
    ROOTFS="$WORK_DIR/rootfs"
    
    # Copy FluidCNC files
    mkdir -p "$ROOTFS/opt/fluidcnc"
    
    # Copy from current directory (assuming script is run from fluidcnc folder)
    if [ -f "../index.html" ]; then
        cp -r ../* "$ROOTFS/opt/fluidcnc/"
    elif [ -f "./index.html" ]; then
        cp -r ./* "$ROOTFS/opt/fluidcnc/"
    fi
    
    # Copy install script for first boot
    cp "$ROOTFS/opt/fluidcnc/setup/install.sh" "$ROOTFS/opt/fluidcnc-install.sh"
    chmod +x "$ROOTFS/opt/fluidcnc-install.sh"
    
    # Create first-boot service
    cat > "$ROOTFS/etc/systemd/system/fluidcnc-firstboot.service" << 'EOF'
[Unit]
Description=FluidCNC First Boot Setup
After=network-online.target
Wants=network-online.target
ConditionPathExists=/opt/fluidcnc-install.sh

[Service]
Type=oneshot
ExecStart=/opt/fluidcnc-install.sh
ExecStartPost=/bin/rm -f /opt/fluidcnc-install.sh
ExecStartPost=/bin/systemctl disable fluidcnc-firstboot.service
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
EOF
    
    # Enable first boot service
    ln -sf /etc/systemd/system/fluidcnc-firstboot.service \
           "$ROOTFS/etc/systemd/system/multi-user.target.wants/fluidcnc-firstboot.service"
    
    # Board-specific configurations
    case $BOARD in
        rpi|rpizero2)
            # Enable SSH
            touch "$WORK_DIR/boot/ssh" 2>/dev/null || touch "$ROOTFS/boot/ssh"
            
            # Configure WiFi (optional - user can set up)
            cat > "$WORK_DIR/boot/wpa_supplicant.conf" 2>/dev/null << 'EOF' || true
ctrl_interface=DIR=/var/run/wpa_supplicant GROUP=netdev
update_config=1
country=US

# Uncomment and edit to add your WiFi:
#network={
#    ssid="YOUR_WIFI_NAME"
#    psk="YOUR_WIFI_PASSWORD"
#}
EOF
            ;;
        lepotato)
            # Le Potato specific setup
            echo "Le Potato configuration applied"
            ;;
    esac
    
    # Set hostname
    echo "fluidcnc" > "$ROOTFS/etc/hostname"
    sed -i 's/127.0.1.1.*/127.0.1.1\tfluidcnc/' "$ROOTFS/etc/hosts"
}

# Configure network
configure_network() {
    echo -e "${GREEN}[6/8]${NC} Configuring network..."
    
    ROOTFS="$WORK_DIR/rootfs"
    
    # Create network configuration for DHCP
    mkdir -p "$ROOTFS/etc/systemd/network"
    
    cat > "$ROOTFS/etc/systemd/network/20-ethernet.network" << 'EOF'
[Match]
Name=eth* en*

[Network]
DHCP=yes
MulticastDNS=yes
EOF

    # Enable mDNS
    mkdir -p "$ROOTFS/etc/avahi"
    cat > "$ROOTFS/etc/avahi/avahi-daemon.conf" << 'EOF'
[server]
host-name=fluidcnc
use-ipv4=yes
use-ipv6=yes
allow-interfaces=eth0,wlan0
enable-dbus=yes

[publish]
publish-addresses=yes
publish-hinfo=yes
publish-workstation=yes
publish-domain=yes

[wide-area]
enable-wide-area=yes

[reflector]
enable-reflector=no
EOF
}

# Unmount and finalize
finalize_image() {
    echo -e "${GREEN}[7/8]${NC} Finalizing image..."
    
    # Sync and unmount
    sync
    umount "$WORK_DIR/boot" 2>/dev/null || true
    umount "$WORK_DIR/rootfs"
    losetup -d "$LOOP_DEV"
    
    # Move and compress final image
    mkdir -p "$OUTPUT_DIR"
    OUTPUT_FILE="$OUTPUT_DIR/${IMAGE_NAME}-${BOARD}.img"
    
    mv "$WORK_DIR/base.img" "$OUTPUT_FILE"
    
    echo "Compressing image..."
    xz -9 -T0 "$OUTPUT_FILE"
    
    echo ""
    echo -e "${GREEN}Image created: ${OUTPUT_FILE}.xz${NC}"
}

# Print instructions
print_instructions() {
    echo -e "${GREEN}[8/8]${NC} Done!"
    echo ""
    echo -e "${CYAN}╔═══════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${CYAN}║                    Flashing Instructions                      ║${NC}"
    echo -e "${CYAN}╠═══════════════════════════════════════════════════════════════╣${NC}"
    echo -e "${CYAN}║${NC}                                                               ${CYAN}║${NC}"
    echo -e "${CYAN}║${NC}  ${YELLOW}For Windows:${NC}                                               ${CYAN}║${NC}"
    echo -e "${CYAN}║${NC}    1. Download balenaEtcher from balena.io/etcher            ${CYAN}║${NC}"
    echo -e "${CYAN}║${NC}    2. Select the .img.xz file (no need to extract)           ${CYAN}║${NC}"
    echo -e "${CYAN}║${NC}    3. Select your SD card                                    ${CYAN}║${NC}"
    echo -e "${CYAN}║${NC}    4. Click Flash!                                           ${CYAN}║${NC}"
    echo -e "${CYAN}║${NC}                                                               ${CYAN}║${NC}"
    echo -e "${CYAN}║${NC}  ${YELLOW}For Linux:${NC}                                                 ${CYAN}║${NC}"
    echo -e "${CYAN}║${NC}    xzcat ${IMAGE_NAME}-${BOARD}.img.xz | sudo dd of=/dev/sdX bs=4M    ${CYAN}║${NC}"
    echo -e "${CYAN}║${NC}                                                               ${CYAN}║${NC}"
    echo -e "${CYAN}║${NC}  ${YELLOW}First Boot:${NC}                                                ${CYAN}║${NC}"
    echo -e "${CYAN}║${NC}    1. Insert SD card and power on                            ${CYAN}║${NC}"
    echo -e "${CYAN}║${NC}    2. Wait 2-3 minutes for initial setup                     ${CYAN}║${NC}"
    echo -e "${CYAN}║${NC}    3. Access http://fluidcnc.local in your browser           ${CYAN}║${NC}"
    echo -e "${CYAN}║${NC}                                                               ${CYAN}║${NC}"
    echo -e "${CYAN}╚═══════════════════════════════════════════════════════════════╝${NC}"
}

# Cleanup on exit
cleanup() {
    umount "$WORK_DIR/boot" 2>/dev/null || true
    umount "$WORK_DIR/rootfs" 2>/dev/null || true
    [ -n "$LOOP_DEV" ] && losetup -d "$LOOP_DEV" 2>/dev/null || true
}
trap cleanup EXIT

# Main
main() {
    print_banner
    
    if [ "$EUID" -ne 0 ]; then
        echo -e "${RED}Please run as root (sudo)${NC}"
        exit 1
    fi
    
    check_deps
    select_board
    download_base
    mount_image
    install_fluidcnc
    configure_network
    finalize_image
    print_instructions
}

main "$@"
