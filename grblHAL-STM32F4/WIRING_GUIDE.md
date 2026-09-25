> HISTORICAL GENERIC REFERENCE — not the active MR1 wiring plan. Use `mr1/WIRING.md`, its corrected companion references and the current integrated Octopus schematic. Pin, driver, safety and power assumptions below can describe another configuration.

# BTT Octopus Pro v1.1 - Wiring Guide for grblHAL

## ⚠️ CUSTOM CONFIGURATION: Motors in Slots 3, 4, 5

This firmware is configured for **motors in slots 3, 4, 5** (not the default 0, 1, 2).

| Axis | Motor Slot | Step Pin | Dir Pin | Enable Pin | UART Pin | Limit Switch |
|------|------------|----------|---------|------------|----------|--------------|
| **X** | **Slot 3** | PG4 | PC1 | PA0 | PC7 | MIN1 (PG6) |
| **Y** | **Slot 4** | PF9 | PF10 | PG2 | PF2 | MIN2 (PG9) |
| **Z** | **Slot 5** | PC13 | PF0 | PF1 | PE4 | MIN3 (PG10) |

**Note**: Limit switches use MIN1-3 headers even though motors are in slots 3-5.

---

## 📍 Pin Reference

This guide documents all input/output pins for the BTT Octopus Pro v1.1 running grblHAL.

---

## 🛑 Control Inputs (Currently DISABLED)

These inputs are **DISABLED by default** because floating pins cause false triggers.
Enable them in `platformio.ini` when you wire physical switches.

| Signal | MCU Pin | Header/Connector | Status |
|--------|---------|------------------|--------|
| **E-Stop/Reset** | PF3 | **TB** (Thermistor Bed) | DISABLED |
| **Safety Door** | PC0 | **PWR-DET** | DISABLED |
| **Feed Hold** | PF4 | **T0** (Thermistor 0) | DISABLED |
| **Cycle Start** | PF5 | **T1** (Thermistor 1) | DISABLED |

### How to Enable E-Stop:

1. Edit `platformio.ini`:
```ini
-D ESTOP_ENABLE=1
-D CONTROL_ENABLE=1
```

2. Wire your E-Stop button:
   - **Option A (Normally Open - NO)**: Connect button between **TB signal** and **GND**
   - **Option B (Normally Closed - NC)**: Connect button between **TB signal** and **3.3V**, also set:
     ```ini
     -D DEFAULT_INVERT_CONTROL_PINS=1
     ```

3. Rebuild and flash firmware

### How to Enable Safety Door:

1. Edit `platformio.ini`:
```ini
-D SAFETY_DOOR_ENABLE=1
```

2. Wire your door switch to **PWR-DET** header
3. Rebuild and flash firmware

---

## 🔴 Limit Switches (Active)

Limit switches use MIN1-3 headers (even though motors are in slots 3-5):

| Axis | MCU Pin | Header | Notes |
|------|---------|--------|-------|
| X Min | PG6 | **MIN1** | 3-pin: S, V, G |
| Y Min | PG9 | **MIN2** | 3-pin: S, V, G |
| Z Min | PG10 | **MIN3** | 3-pin: S, V, G |

### Wiring Limit Switches:

```
Switch Type: NO (Normally Open) - RECOMMENDED FOR GRBLHAL
┌─────────────────┐
│  MIN1 Header    │
│  ┌───┬───┬───┐  │
│  │ S │ V │ G │  │
│  └─┬─┴───┴─┬─┘  │
│    │       │    │
│    └──[NO]─┘    │  ← Connect NO switch between Signal and GND
└─────────────────┘

When switch closes (triggered): S connects to GND → LOW signal
Firmware inverts this (DEFAULT_INVERT_LIMIT_PINS=7) → triggers limit
```

**Current Setting**: `DEFAULT_INVERT_LIMIT_PINS=7` (bits 0+1+2 = X+Y+Z inverted)

To change:
- Bit 0 = X axis (value 1)
- Bit 1 = Y axis (value 2)  
- Bit 2 = Z axis (value 4)
- Sum the bits for axes you want to invert

---

## 🎯 Probe Input (Active)

| Signal | MCU Pin | Header | Notes |
|--------|---------|--------|-------|
| Probe | PB6 | **Z probe "left"** | 3-pin header |
| Probe 2 | PB7 | **Z probe "right"** | Optional secondary |

### Wiring Z-Probe:

```
Touch Probe Setup:
┌─────────────────┐
│  Z Probe Header │
│  ┌───┬───┬───┐  │
│  │ S │ V │ G │  │
│  └─┬─┴───┴─┬─┘  │
│    │       │    │
│    └──[NO]─┘    │  ← Touch plate connected to GND
└─────────────────┘    Probe tip connected to Signal
                       When they touch: S → GND → probe triggered
```

**Current Setting**: `DEFAULT_INVERT_PROBE_PIN=1` (inverted so floating = NOT triggered)

If probe falsely triggers constantly, try:
- Set `DEFAULT_INVERT_PROBE_PIN=0`
- Or add a pull-up resistor (10K) from Signal to 3.3V

---

## ⚡ Motor Drivers (TMC2209 UART)

**⚠️ THIS MACHINE USES MOTOR SLOTS 3, 4, 5 ONLY**

| Axis | Motor Slot | Step Pin | Dir Pin | Enable Pin | UART Pin |
|------|------------|----------|---------|------------|----------|
| **X** | **M3** | PG4 | PC1 | PA0 | PC7 |
| **Y** | **M4** | PF9 | PF10 | PG2 | PF2 |
| **Z** | **M5** | PC13 | PF0 | PF1 | PE4 |

Reference: All motor slots on Octopus Pro v1.1:

| Motor Slot | Step Pin | Dir Pin | Enable Pin | UART Pin |
|------------|----------|---------|------------|----------|
| M0 | PF13 | PF12 | PF14 | PC4 |
| M1 | PG0 | PG1 | PF15 | PD11 |
| M2 | PF11 | PG3 | PG5 | PC6 |
| **M3 (X)** | **PG4** | **PC1** | **PA0** | **PC7** |
| **M4 (Y)** | **PF9** | **PF10** | **PG2** | **PF2** |
| **M5 (Z)** | **PC13** | **PF0** | **PF1** | **PE4** |
| M6 | PE2 | PE3 | PD4 | PE1 |
| M7 | PE6 | PA14 | PE0 | PD3 |

### TMC2209 Jumper Configuration:

```
For each driver slot, set jumpers under the driver:
┌───────────────────┐
│    TMC2209        │
│    Driver         │
├───────────────────┤
│  [■ ■]  MS1       │ ← Jumper ON for UART mode
│  [■ ■]  MS2       │ ← Jumper ON for UART mode
│  [■ ■]  UART      │ ← Jumper ON to enable UART
│  [□ □]  SPREAD    │ ← Jumper OFF (controlled by firmware)
└───────────────────┘
```

---

## 🌀 Spindle Outputs (H100 VFD via RS485)

| Signal | MCU Pin | Header | Notes |
|--------|---------|--------|-------|
| Spindle PWM | PA8 | **FAN0** | PWM output |
| Spindle Enable | PD14 | **FAN4** | On/Off |
| Spindle Direction | PE15 | **FAN5** | CW/CCW |

### RS485 Wiring for H100 VFD:

The Octopus Pro has a built-in RS485 interface. Connect to your RS485-to-TTL adapter:

```
Octopus Pro → RS485 Adapter → H100 VFD
─────────────────────────────────────────
USART2 TX (PD5) → DI (Driver Input)
USART2 RX (PD6) → RO (Receiver Output)
GND              → GND
                   
RS485 Adapter → H100 VFD
───────────────────────
A+ → RS+ (Terminal A)
B- → RS- (Terminal B)
```

---

## 💧 Coolant Outputs

| Signal | MCU Pin | Header | Notes |
|--------|---------|--------|-------|
| Coolant Flood | PA0 | **HE0** (Heater 0) | M8 command |
| Coolant Mist | PA3 | **HE1** (Heater 1) | M7 command |

### Wiring Coolant:

```
Connect SSR (Solid State Relay) or MOSFET module:
HE0 Header → SSR Input (+)
GND        → SSR Input (-)
SSR Output → Coolant pump/valve
```

---

## 📟 Auxiliary Outputs (Fans)

| Signal | MCU Pin | Header | Purpose |
|--------|---------|--------|---------|
| AUX0 | PA8 | FAN0 | Spindle PWM |
| AUX1 | PE5 | FAN1 | General |
| AUX2 | PD12 | FAN2 | General |
| AUX3 | PD13 | FAN3 | General |
| AUX4 | PD14 | FAN4 | Spindle Enable |
| AUX5 | PE15 | FAN5 | Spindle Dir |

---

## 📊 Analog Inputs

| Signal | MCU Pin | Header | Purpose |
|--------|---------|--------|---------|
| Analog 0 | PF6 | **T2** | Thermistor/Analog |
| Analog 1 | PF7 | **T3** | Thermistor/Analog |

---

## 🔌 Communication Ports

| Interface | TX Pin | RX Pin | Header/Notes |
|-----------|--------|--------|--------------|
| USB CDC | - | - | USB-C connector |
| USART1 | PA9 | PA10 | Primary serial |
| USART2 | PD5 | PD6 | RS485/Modbus |
| USART3 | PD8 | PD9 | Aux serial |
| I2C1 | PB8 (SCL) | PB9 (SDA) | EEPROM, Keypad |

---

## 🔧 Troubleshooting

### "Pn:HSEP" in Status (All Inputs Triggered)

This means: **H**ome, **S**afety door, **E**-stop, **P**robe are ALL showing as triggered.

**Cause**: Floating pins with no pull-up/pull-down resistors.

**Solutions**:
1. ✅ **Disable in firmware** (current setting) - `CONTROL_ENABLE=0`, `SAFETY_DOOR_ENABLE=0`
2. ⚡ **Add pull-up resistors** (10K to 3.3V) on unused inputs
3. 🔌 **Connect actual switches** to the inputs

### Limit Switches Trigger When NOT Pressed

1. Check `DEFAULT_INVERT_LIMIT_PINS` setting
2. For NO switches to GND: use `DEFAULT_INVERT_LIMIT_PINS=7`
3. For NC switches to GND: use `DEFAULT_INVERT_LIMIT_PINS=0`

### Probe Always Shows Triggered

1. Check if probe pin is floating
2. Set `DEFAULT_INVERT_PROBE_PIN=1` to invert
3. Or add 10K pull-up resistor to 3.3V

---

## 📐 Board Layout Reference

```
BTT Octopus Pro v1.1 - Top View (Simplified)
═══════════════════════════════════════════════════════════════════════

   USB-C           BOOT0
     │               │
┌────┴───────────────┴────────────────────────────────────────────────┐
│                                                                      │
│  ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐   │
│  │ M1  │ │ M2  │ │ M3  │ │ M4  │ │ M5  │ │ M6  │ │ M7  │ │ M8  │   │
│  │  X  │ │  Y  │ │  Z  │ │  A  │ │  B  │ │  C  │ │     │ │     │   │
│  └─────┘ └─────┘ └─────┘ └─────┘ └─────┘ └─────┘ └─────┘ └─────┘   │
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │ MIN1  MIN2  MIN3  MIN4  MIN5  MIN6  │  Limit Switch Headers   │   │
│  │  X     Y     Z     A     B     C    │  (3-pin: S,V,G)         │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                      │
│  ┌────────┬────────┬────────┬────────┬────────┬────────┐            │
│  │  TB    │  T0    │  T1    │  T2    │  T3    │ PWR-DET│            │
│  │ E-STOP │ F.HOLD │ C.STRT │ ANALOG │ ANALOG │ S.DOOR │            │
│  │  PF3   │  PF4   │  PF5   │  PF6   │  PF7   │  PC0   │            │
│  └────────┴────────┴────────┴────────┴────────┴────────┘            │
│                                                                      │
│  ┌────────────────────┐  ┌────────────────────────────────┐         │
│  │   Z-PROBE          │  │   FANS: FAN0-FAN5              │         │
│  │   PB6, PB7         │  │   Spindle PWM/EN/DIR on 0,4,5  │         │
│  └────────────────────┘  └────────────────────────────────┘         │
│                                                                      │
│  ┌────────────────────────────────────────┐                         │
│  │   HEATERS: HE0, HE1, HE2, HE3, BED     │                         │
│  │   Coolant: HE0=Flood, HE1=Mist         │                         │
│  └────────────────────────────────────────┘                         │
│                                                                      │
│  ┌─────────┐                              ┌─────────────────────┐   │
│  │ SD CARD │                              │ 24V POWER INPUT     │   │
│  └─────────┘                              └─────────────────────┘   │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

---

## ✅ Quick Reference - Current Configuration

| Feature | Status | Setting |
|---------|--------|---------|
| E-Stop | **DISABLED** | `ESTOP_ENABLE=0` |
| Safety Door | **DISABLED** | `SAFETY_DOOR_ENABLE=0` |
| Feed Hold | **DISABLED** | `CONTROL_ENABLE=0` |
| Cycle Start | **DISABLED** | `CONTROL_ENABLE=0` |
| Probe | **ENABLED** | `PROBE_ENABLE=1`, inverted |
| Limit Switches | **ENABLED** | Inverted (NO to GND) |
| TMC2209 UART | **ENABLED** | 2A RMS, SpreadCycle |
| Spindle | **H100 VFD** | Modbus RTU |

---

*Last Updated: January 2026*
*Firmware: grblHAL for BTT Octopus Pro v1.1 (STM32F429)*
