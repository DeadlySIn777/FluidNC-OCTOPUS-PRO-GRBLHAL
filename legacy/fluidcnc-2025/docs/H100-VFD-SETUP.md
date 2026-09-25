# Changrong H100 VFD Setup Guide

Complete configuration guide for the Changrong H100 (2.2kW) Variable Frequency Drive with RS485 Modbus control.

## Quick Reference

| Spec | Value |
|------|-------|
| **Model** | H100-2.2G-4T |
| **Power** | 2.2kW (3HP) |
| **Input** | 380V 3-phase |
| **Output** | 0-380V 3-phase |
| **Max Frequency** | 400Hz |
| **Max RPM** | 24000 (2-pole spindle motor) |
| **Communication** | RS485 Modbus RTU |

---

## RS485 Wiring

### Terminal Connections

```
H100 VFD Terminal Block
┌─────────────────────────────────────────┐
│  RS+  RS-  GND                          │
│   │    │    │                           │
└───┼────┼────┼───────────────────────────┘
    │    │    │
    │    │    └──── GND (ground/shield)
    │    └───────── RS485 B (Data-)
    └────────────── RS485 A (Data+)
```

### To ESP32 + MAX485

```
H100 VFD         MAX485 Module        ESP32
─────────────────────────────────────────────
RS+ ────────────► A
RS- ────────────► B
GND ────────────► GND ───────────────► GND
                  VCC ───────────────► 3V3
                  DI ◄───────────────── GPIO17 (TX)
                  RO ────────────────► GPIO16 (RX)
                  DE ◄───────────────── GPIO4
                  RE ◄───────────────── GPIO4 (tied to DE)
```

**Note:** DE and RE are tied together for half-duplex operation. GPIO4 controls transmit/receive direction.

---

## VFD Parameter Configuration

### Essential Parameters for RS485 Control

| Parameter | Value | Description |
|-----------|-------|-------------|
| **F000** | 1 | Command source: 1=RS485 |
| **F003** | 1 | Main frequency source: 1=RS485 |
| **F005** | 400.00 | Max output frequency (Hz) |
| **F011** | 0.00 | Min output frequency (Hz) |
| **F014** | 10 | Acceleration time I (1.0 sec) |
| **F015** | 10 | Deceleration time I (1.0 sec) |
| **F163** | 1 | Modbus slave address (1-250) |
| **F164** | 1 | Baud rate: 1=9600 |
| **F165** | 3 | Data format: 3=8N1 RTU |
| **F169** | 2 | Frequency decimal: 2 digits (0.01Hz) |

### Motor Parameters (2.2kW Spindle)

| Parameter | Value | Description |
|-----------|-------|-------------|
| **F079** | 2.2 | Rated motor power (kW) |
| **F080** | 380 | Rated motor voltage (V) |
| **F081** | 5.1 | Rated motor current (A) |
| **F082** | 2 | Motor poles (2-pole = high speed) |
| **F083** | 400.00 | Rated motor frequency (Hz) |

### Speed Presets (Optional)

| Parameter | Value | Description |
|-----------|-------|-------------|
| **F040** | 100.00 | Speed 1: 6000 RPM |
| **F041** | 200.00 | Speed 2: 12000 RPM |
| **F042** | 300.00 | Speed 3: 18000 RPM |
| **F043** | 400.00 | Speed 4: 24000 RPM |

---

## Modbus Protocol

### Communication Settings

- **Protocol:** Modbus RTU
- **Baud Rate:** 9600 bps (F164=1) or 19200 bps (F164=2)
- **Data Bits:** 8
- **Parity:** None
- **Stop Bits:** 1
- **Slave Address:** 1 (F163)

### Function Codes Supported

| Code | Name | Description |
|------|------|-------------|
| 0x03 | Read Holding Registers | Read parameters/status |
| 0x05 | Write Single Coil | Control commands (FWD/REV/STOP) |
| 0x06 | Write Single Register | Set frequency |

### Status Registers (Read with 0x03)

| Address | Description | Units |
|---------|-------------|-------|
| 0x0000 | Output frequency | 0.01 Hz |
| 0x0001 | Set frequency | 0.01 Hz |
| 0x0002 | Output current | 0.1 A |
| 0x0003 | Actual RPM | 1 RPM |
| 0x0004 | DC bus voltage | 1 V |
| 0x0005 | AC output voltage | 1 V |
| 0x0006 | VFD heatsink temperature | 1 °C |
| 0x0007 | Counter value | - |
| 0x0008 | PID target | - |
| 0x0009 | PID feedback | - |
| 0x000A | Fault code | See fault table |
| 0x000B | Total run hours | 1 hr |
| 0x000C | Output power | 0.1 kW |
| 0x000D | X terminal state | Bits |

### Control Coils (Write with 0x05)

| Address | Description | Value |
|---------|-------------|-------|
| 0x0048 | Operation Enable | 0xFF00=ON, 0x0000=OFF |
| 0x0049 | Run Forward | 0xFF00=ON |
| 0x004A | Run Reverse | 0xFF00=ON |
| 0x004B | Stop | 0xFF00=ON |

### Frequency Register (Write with 0x06)

| Address | Description | Notes |
|---------|-------------|-------|
| 0x0201 | Set frequency | Value × 0.01Hz (F169=2) |

**Example:** To set 200Hz (12000 RPM): Write 20000 (0x4E20) to 0x0201

---

## Fault Codes

| Code | Name | Meaning | Solution |
|------|------|---------|----------|
| 1 | OC1 | Overcurrent during acceleration | Check motor wiring, reduce accel time |
| 2 | OC2 | Overcurrent during deceleration | Add brake resistor |
| 3 | OC3 | Overcurrent at constant speed | Reduce load |
| 4 | OV1 | Overvoltage during acceleration | Check input voltage |
| 5 | OV2 | Overvoltage during deceleration | Add brake resistor |
| 6 | OV3 | Overvoltage at constant speed | Check input voltage |
| 7 | LV | DC bus undervoltage | Check power supply |
| 8 | OH | VFD overtemperature | Check cooling fan |
| 9 | I.t | Motor thermal overload | Reduce continuous load |
| 10 | CB | Communication timeout | Check RS485 wiring |
| 11 | Err | Parameter error | Reset to defaults |
| 12 | oL | Overload | Reduce acceleration |
| 13 | tE | Ground fault | Check motor insulation |

---

## RPM Calculation

For a 2-pole motor:
```
RPM = Frequency × 60
```

| Frequency | RPM |
|-----------|-----|
| 100 Hz | 6,000 |
| 200 Hz | 12,000 |
| 300 Hz | 18,000 |
| 400 Hz | 24,000 |

---

## Troubleshooting

### No Communication

1. Check RS485 wiring (A/B not swapped)
2. Verify F163 slave address matches ESP32 config
3. Check F164 baud rate matches ESP32
4. Verify F165 is set to 3 (8N1 RTU)
5. Check GND connection between VFD and MAX485

### Motor Won't Start

1. Verify F000=1 (RS485 command source)
2. Verify F003=1 (RS485 frequency source)
3. Check for fault codes (front panel display)
4. Ensure Operation Enable coil is set

### Unstable Speed

1. Check F014/F015 acceleration times
2. Verify motor parameters (F079-F083)
3. Check for mechanical issues (runout, bearing)

### Overheating

1. Verify ambient temperature < 40°C
2. Check VFD cooling fan operation
3. Reduce continuous load or add cooling
4. Check F006 (temp reading register)

---

## ESP32 VFD Controller Commands

| Command | Description |
|---------|-------------|
| `FWD` | Run spindle forward |
| `REV` | Run spindle reverse |
| `STOP` | Stop spindle |
| `RPM:12000` | Set speed to 12000 RPM |
| `STATUS` | Get JSON status |
| `BAUD:9600` | Change Modbus baud |
| `ADDR:1` | Change slave address |
| `DEBUG:1` | Enable debug output |

---

## References

- Changrong H100 User Manual (translated)
- Modbus Application Protocol V1.1b
- ESP32 VFD Controller source: `esp32-vfd-controller/src/main.cpp`
