# ESP32 VFD Controller - Modbus RS485

USB Serial to Modbus RS485 bridge for controlling Changrong H100 (and compatible) VFD spindle drives.

## Features

- **USB Serial command interface** (115200 baud)
- **Modbus RTU over RS485** via MAX485 transceiver
- **H100 VFD register support** (per manual)
- **Real-time JSON status output**
- **Works with FluidCNC web interface**

## Hardware Required

| Component | Purpose |
|-----------|---------|
| ESP32 DevKit | Main controller |
| MAX485 module | RS485 transceiver |
| H100 VFD | 2.2kW spindle drive |

## Wiring

```
ESP32           MAX485          H100 VFD
─────────────────────────────────────────
GPIO17 (TX) ──► DI
GPIO16 (RX) ◄── RO
GPIO4 ─────────► DE + RE (tied together)
3V3 ───────────► VCC
GND ───────────► GND
                A ─────────────► RS485+
                B ─────────────► RS485-
                GND ───────────► GND (RS485)
```

## Commands

| Command | Description | Response |
|---------|-------------|----------|
| `FWD` | Run spindle forward | `{"cmd":"FWD","status":"ok"}` |
| `REV` | Run spindle reverse | `{"cmd":"REV","status":"ok"}` |
| `STOP` | Stop spindle | `{"cmd":"STOP","status":"ok"}` |
| `RPM:12000` | Set speed (0-24000) | `{"cmd":"RPM","rpm":12000,"status":"ok"}` |
| `STATUS` | Get VFD telemetry | See below |
| `HELP` | List commands | Command list |

## Status Response

```json
{
  "vfd": {
    "online": true,
    "running": true,
    "direction": "FWD",
    "fault": false,
    "faultCode": 0,
    "setRpm": 12000,
    "actualRpm": 11980,
    "setFreqHz": 200.00,
    "actualFreqHz": 199.67,
    "outputAmps": 4.2,
    "outputVolts": 220,
    "dcBusVolts": 310,
    "vfdTempC": 42,
    "loadPercent": 35.0,
    "outputPower": 850,
    "totalHours": 127
  }
}
```

## H100 Modbus Registers

| Register | Description | Units |
|----------|-------------|-------|
| 0x0000 | Output frequency | 0.01 Hz |
| 0x0001 | Set frequency | 0.01 Hz |
| 0x0002 | Output current | 0.1 A |
| 0x0003 | Actual RPM | 1 RPM |
| 0x0004 | DC bus voltage | 1 V |
| 0x0005 | AC output voltage | 1 V |
| 0x0006 | VFD temperature | 1 °C |
| 0x000A | Fault code | - |
| 0x000B | Total run hours | 1 hr |
| 0x000C | Output power | 0.1 kW |
| 0x2000 | Control word | Write: 1=FWD, 2=REV, 5=STOP |
| 0x2001 | Frequency setpoint | 0.01 Hz |

## Build & Flash

```bash
cd esp32-vfd-controller
pio run --target upload --upload-port COM6
```

## VFD Configuration

Set these parameters on your H100 VFD:

| Param | Value | Description |
|-------|-------|-------------|
| P00.01 | 2 | Control source = RS485 |
| P00.03 | 2 | Frequency source = RS485 |
| P14.00 | 1 | Slave address |
| P14.01 | 3 | Baud rate = 19200 |
| P14.02 | 0 | Data format = 8N1 |

## Integration with FluidCNC

The ESP32 VFD controller connects via USB serial to your host computer. The FluidCNC server (server.py) automatically detects it and proxies commands through WebSocket.

Web UI features:
- Real-time RPM/current/temp display
- Forward/Reverse/Stop buttons
- RPM slider with presets
- Thermal stress test for cooling verification
- Fault code display with descriptions
