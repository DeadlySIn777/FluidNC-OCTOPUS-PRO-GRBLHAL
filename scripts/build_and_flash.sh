#!/bin/bash

# ═══════════════════════════════════════════════════════════════════════════
# grblHAL - BTT Octopus Pro Build & Flash Tool
# Supports: STM32F429 & STM32F446
# ═══════════════════════════════════════════════════════════════════════════

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(dirname "$SCRIPT_DIR")"
GRBLHAL_DIR="$REPO_DIR/grblHAL-STM32F4xx"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo ""
echo "╔══════════════════════════════════════════════════════════════════╗"
echo "║   grblHAL - BTT Octopus Pro Build & Flash Tool                  ║"
echo "║   Supports: STM32F429 & STM32F446                               ║"
echo "╚══════════════════════════════════════════════════════════════════╝"
echo ""

# Check PlatformIO
if ! command -v pio &> /dev/null; then
    echo -e "${RED}[ERROR] PlatformIO not found.${NC}"
    echo ""
    echo "Install PlatformIO Core:"
    echo "  pip install platformio"
    echo ""
    echo "Or install VS Code with PlatformIO extension."
    exit 1
fi

echo -e "${GREEN}[OK] PlatformIO found${NC}"
echo ""

show_menu() {
    echo "═══════════════════════════════════════════════════════════════════"
    echo "  SELECT YOUR BOARD"
    echo "═══════════════════════════════════════════════════════════════════"
    echo ""
    echo "  STM32F429 (Octopus Pro v1.0.1 or v1.1 with F429):"
    echo "  ─────────────────────────────────────────────────"
    echo "  1. F429 + TMC2209 (UART)"
    echo "  2. F429 + TMC2209 (Standalone)"
    echo "  3. F429 + TMC5160 (SPI)"
    echo "  4. F429 + TMC2130 (SPI)"
    echo ""
    echo "  STM32F446 (Octopus Pro v1.1 with F446):"
    echo "  ───────────────────────────────────────"
    echo "  5. F446 + TMC2209 (UART)"
    echo "  6. F446 + TMC2209 (Standalone)"
    echo "  7. F446 + TMC5160 (SPI)"
    echo ""
    echo "  Other Options:"
    echo "  ──────────────"
    echo "  8. DFU Mode Instructions"
    echo "  9. List USB Devices"
    echo "  0. Exit"
    echo ""
}

build_firmware() {
    local ENV=$1
    local CONFIG=$2

    echo ""
    echo "═══════════════════════════════════════════════════════════════════"
    echo "  STEP 1: Cloning grblHAL repository..."
    echo "═══════════════════════════════════════════════════════════════════"
    echo ""

    if [ -d "$GRBLHAL_DIR" ]; then
        echo "[INFO] Repository exists. Updating..."
        cd "$GRBLHAL_DIR"
        git pull
        git submodule update --init --recursive
    else
        git clone --recurse-submodules https://github.com/grblHAL/STM32F4xx.git "$GRBLHAL_DIR"
    fi

    echo ""
    echo "═══════════════════════════════════════════════════════════════════"
    echo "  STEP 2: Copying configuration..."
    echo "═══════════════════════════════════════════════════════════════════"
    echo ""

    cp "$REPO_DIR/configs/$CONFIG" "$GRBLHAL_DIR/platformio.ini"
    echo -e "${GREEN}[OK] Configuration copied: $CONFIG${NC}"

    echo ""
    echo "═══════════════════════════════════════════════════════════════════"
    echo "  STEP 3: Building firmware ($ENV)..."
    echo "═══════════════════════════════════════════════════════════════════"
    echo ""

    cd "$GRBLHAL_DIR"
    pio run -e "$ENV"

    echo ""
    echo "═══════════════════════════════════════════════════════════════════"
    echo -e "  ${GREEN}[OK] BUILD SUCCESSFUL!${NC}"
    echo "═══════════════════════════════════════════════════════════════════"
    echo ""
    echo "  Firmware: $GRBLHAL_DIR/.pio/build/$ENV/firmware.bin"
    echo ""

    read -p "Flash now? (y/n): " FLASH_NOW
    if [[ "$FLASH_NOW" =~ ^[Yy]$ ]]; then
        flash_firmware "$ENV"
    fi
}

flash_firmware() {
    local ENV=$1

    echo ""
    echo "═══════════════════════════════════════════════════════════════════"
    echo "  FLASHING FIRMWARE"
    echo "═══════════════════════════════════════════════════════════════════"
    echo ""
    echo "  IMPORTANT: Board must be in DFU mode!"
    echo ""
    echo "  1. Power off the board"
    echo "  2. Set BOOT0 jumper to HIGH (3.3V side)"
    echo "  3. Connect USB and power on"
    echo ""
    read -p "Press ENTER when ready..."

    cd "$GRBLHAL_DIR"
    pio run -e "$ENV" -t upload

    echo ""
    echo "═══════════════════════════════════════════════════════════════════"
    echo -e "  ${GREEN}[OK] FLASH SUCCESSFUL!${NC}"
    echo "═══════════════════════════════════════════════════════════════════"
    echo ""
    echo "  NEXT STEPS:"
    echo "  1. Power off the board"
    echo "  2. REMOVE the BOOT0 jumper"
    echo "  3. Power on - serial port should appear"
    echo ""
}

show_dfu_help() {
    echo ""
    echo "═══════════════════════════════════════════════════════════════════"
    echo "  DFU MODE INSTRUCTIONS"
    echo "═══════════════════════════════════════════════════════════════════"
    echo ""
    echo "  DFU (Device Firmware Upgrade) allows flashing via USB."
    echo ""
    echo "  TO ENTER DFU MODE:"
    echo "  ──────────────────"
    echo "  1. POWER OFF the board"
    echo "  2. Locate BOOT0 jumper (near the STM32 processor)"
    echo "  3. Move BOOT0 to HIGH position (3.3V side)"
    echo "  4. Connect USB cable to PC"
    echo "  5. POWER ON the board"
    echo "  6. Verify with: lsusb | grep DFU"
    echo ""
    echo "  AFTER FLASHING:"
    echo "  ────────────────"
    echo "  1. POWER OFF the board"
    echo "  2. REMOVE BOOT0 jumper"
    echo "  3. Power on - /dev/ttyACM0 should appear"
    echo ""
}

list_usb() {
    echo ""
    echo "═══════════════════════════════════════════════════════════════════"
    echo "  USB DEVICES"
    echo "═══════════════════════════════════════════════════════════════════"
    echo ""
    if command -v lsusb &> /dev/null; then
        lsusb | grep -iE "stm32|dfu|serial|uart|cp210|ch340" || echo "  No relevant USB devices found"
    fi
    echo ""
    echo "  Serial ports:"
    ls -la /dev/ttyACM* /dev/ttyUSB* 2>/dev/null || echo "  No serial ports found"
    echo ""
}

# Main loop
while true; do
    show_menu
    read -p "Select option (0-9): " CHOICE

    case $CHOICE in
        1) build_firmware "btt_octopus_pro_f429" "platformio_f429.ini" ;;
        2) build_firmware "btt_octopus_pro_f429_standalone" "platformio_f429.ini" ;;
        3) build_firmware "btt_octopus_pro_f429_tmc5160" "platformio_f429.ini" ;;
        4) build_firmware "btt_octopus_pro_f429_tmc2130" "platformio_f429.ini" ;;
        5) build_firmware "btt_octopus_pro_v11_f446" "platformio_f446.ini" ;;
        6) build_firmware "btt_octopus_pro_v11_f446_standalone" "platformio_f446.ini" ;;
        7) build_firmware "btt_octopus_pro_v11_f446_tmc5160" "platformio_f446.ini" ;;
        8) show_dfu_help; read -p "Press ENTER to continue..." ;;
        9) list_usb; read -p "Press ENTER to continue..." ;;
        0) echo "Goodbye!"; exit 0 ;;
        *) echo -e "${RED}Invalid option${NC}" ;;
    esac
done
