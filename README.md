# FluidNC-OCTOPUS-PRO-GRBLHAL

grblHAL firmware configurations for **BTT Octopus Pro** boards - ready to flash for CNC machines.

![grblHAL](https://img.shields.io/badge/grblHAL-STM32F4-blue) ![Octopus Pro](https://img.shields.io/badge/BTT-Octopus%20Pro-green) ![License](https://img.shields.io/badge/License-GPL--3.0-orange)

## 🎯 Supported Boards

| Board Version | MCU | Crystal | Status |
|---------------|-----|---------|--------|
| Octopus Pro v1.0.1 | STM32F429ZGT6 | 12MHz | ✅ Tested |
| Octopus Pro v1.1 | STM32F446ZET6 | 12MHz | ✅ Tested |
| Octopus Pro v1.1 | STM32F429ZGT6 | 12MHz | ✅ Tested |

## 🚀 Quick Start

### Option 1: Automated Script (Recommended)

```powershell
# Windows - Run as Administrator
.\scripts\build_and_flash.bat
```

### Option 2: Manual Build

```powershell
# Clone grblHAL
git clone --recurse-submodules https://github.com/grblHAL/STM32F4xx.git

# Copy configuration
copy configs\platformio_f446.ini STM32F4xx\platformio.ini
# OR for F429:
copy configs\platformio_f429.ini STM32F4xx\platformio.ini

# Build
cd STM32F4xx
pio run -e btt_octopus_pro_v11_f446
```

### Option 3: Pre-built Firmware

Download from [Releases](../../releases) and flash via DFU mode.

---

## 📁 Repository Structure

## 📚 Documentation

- English: [docs/en/README.md](docs/en/README.md)
- Español: [docs/es/README.md](docs/es/README.md)

```
FluidNC-OCTOPUS-PRO-GRBLHAL/
├── configs/
│   ├── platformio_f429.ini      # Config for STM32F429
│   ├── platformio_f446.ini      # Config for STM32F446
│   └── my_machine.h             # Optional overrides
├── docs/
│   ├── en/                      # English documentation
│   │   ├── README.md
│   │   ├── WIRING.md
│   │   ├── CONFIGURATION.md
│   │   └── TROUBLESHOOTING.md
│   └── es/                      # Spanish documentation
│       ├── README.md
│       ├── CABLEADO.md
│       ├── CONFIGURACION.md
│       └── SOLUCION_PROBLEMAS.md
├── scripts/
│   ├── build_and_flash.bat      # Windows build script
│   └── build_and_flash.sh       # Linux/Mac build script
├── firmware/                    # Pre-built binaries (releases)
└── README.md
```

---

## ⚡ Flashing via DFU Mode

### Step 1: Enter DFU Mode
1. **Power off** the board
2. Set **BOOT0** jumper to HIGH (3.3V side)
3. Connect USB and **power on**
4. Verify "STM32 BOOTLOADER" appears in Device Manager

### Step 2: Flash
```powershell
pio run -e btt_octopus_pro_v11_f446 -t upload
```

### Step 3: Normal Boot
1. **Power off**
2. **Remove** BOOT0 jumper
3. Power on → COM port should appear

---

## 🔌 Pin Mapping Overview

### Motors (TMC2209 UART)

| Axis | Step | Dir | Enable | UART | Limit |
|------|------|-----|--------|------|-------|
| X | PF13 | PF12 | PF14 | PC4 | PG6 |
| Y | PG0 | PG1 | PF15 | PD11 | PG9 |
| Z | PF11 | PG3 | PG5 | PC6 | PG10 |
| A | PG4 | PC1 | PA0 | PC7 | PG11 |

### Spindle Control

| Function | Pin | Header |
|----------|-----|--------|
| PWM | PA8 | FAN0 |
| Enable | PD14 | FAN4 |
| Direction | PE15 | FAN5 |

### Probes

| Function | Pin | Header |
|----------|-----|--------|
| Touch Probe | PB6 | Z-Probe Left |
| Tool Setter | PB7 | Z-Probe Right |

### V1.1 Pin Changes (vs V1.0)

| Function | V1.0 | V1.1 |
|----------|------|------|
| HE0 (Flood) | PA0 | **PA2** |
| HE2 | PB0 | **PB10** |
| Motor4-EN | PA2 | **PA0** |

📖 See [docs/en/WIRING.md](docs/en/WIRING.md) for complete wiring diagrams.

---

## 🔧 Configuration Options

### TMC2209 (UART Mode)
```ini
-D TRINAMIC_ENABLE=2209
-D TRINAMIC_UART_ENABLE=2
```

### TMC2209 (Standalone Mode)
```ini
-D TRINAMIC_ENABLE=0
```

### TMC5160 (SPI Mode)
```ini
-D TRINAMIC_ENABLE=5160
-D TRINAMIC_SPI_ENABLE=1
```

---

## 🌐 Web Interface

This firmware works with [FluidCNC Web UI](https://github.com/user/fluidcnc) for browser-based CNC control.

---

## 📞 Support

- **Issues**: [GitHub Issues](../../issues)
- **grblHAL**: [grblHAL GitHub](https://github.com/grblHAL/STM32F4xx)
- **BTT Docs**: [Octopus Pro GitHub](https://github.com/bigtreetech/BIGTREETECH-OCTOPUS-Pro)

---

## 📄 License

GPL-3.0 - See [LICENSE](LICENSE) for details.

Based on [grblHAL](https://github.com/grblHAL) by Terje Io.
