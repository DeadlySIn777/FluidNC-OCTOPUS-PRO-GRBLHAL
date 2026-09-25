> **Superseded archived guide:** its E-stop advice below (normally-open contacts, "fail-safe for wire breaks") is wrong - an E-stop must be normally-closed and fail-safe; do not use this guide for the MR1 (see [../README-LEGACY.md](../README-LEGACY.md)).

# FluidCNC Hardware Setup Guide
## BTT Octopus Pro v1.1 + Le Potato + grblHAL

This document provides complete wiring and configuration for your CNC machine.

---

## 🔌 System Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        SYSTEM OVERVIEW                              │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌──────────────┐    USB-C    ┌───────────────────────────────┐   │
│  │  Le Potato   │◄───────────►│     BTT Octopus Pro v1.1     │   │
│  │     SBC      │   115200    │        (STM32F446)           │   │
│  │  server.py   │    baud     │       grblHAL Firmware       │   │
│  └──────┬───────┘             └───────────────┬───────────────┘   │
│         │                                     │                    │
│    WiFi/Ethernet                              │                    │
│         │                                     ▼                    │
│  ┌──────▼───────┐             ┌─────────────────────────────┐     │
│  │   Browser    │             │      CNC MACHINE            │     │
│  │  (Chrome)    │             │  • Stepper Motors (X/Y/Z/A) │     │
│  │  FluidCNC UI │             │  • Spindle/VFD              │     │
│  └──────────────┘             │  • Limit Switches           │     │
│                               │  • E-STOP                   │     │
│                               │  • Probe                    │     │
│                               └─────────────────────────────┘     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 📍 Pin Mapping - BTT Octopus Pro v1.1

### Stepper Motors (TMC2209 UART Mode)

| Axis | Driver Slot | STEP | DIR | ENABLE | UART | Limit |
|------|-------------|------|-----|--------|------|-------|
| **X** | Motor 0 | PF13 | PF12 | PF14 | PC4 | PG6 |
| **Y** | Motor 1 | PG0 | PG1 | PF15 | PD11 | PG9 |
| **Z** | Motor 2 | PF11 | PG3 | PG5 | PC6 | PG10 |
| **A** | Motor 3 | PG4 | PC1 | PA2* | PC7 | PG11 |

> ⚠️ **Note:** PA2 is shared with Flood Coolant on v1.1. Use Motor 4 slot if using 4th axis AND flood coolant.

### TMC2209 UART Address Configuration

Set via jumpers (MS1/MS2) or solder pads on each driver slot:

| Driver | Address | MS1 | MS2 |
|--------|---------|-----|-----|
| Motor 0 (X) | 0 | GND | GND |
| Motor 1 (Y) | 1 | VCC | GND |
| Motor 2 (Z) | 2 | GND | VCC |
| Motor 3 (A) | 3 | VCC | VCC |

---

### Spindle Control

| Function | Header | GPIO | Usage |
|----------|--------|------|-------|
| **Spindle Enable** | HE0 | PA0 | VFD Enable / Relay |
| **Spindle Direction** | HE1 | PA3 | CW/CCW select |
| **Spindle PWM** | FAN0 | PA8 | 0-10V speed control |

#### VFD Wiring (RS-485 Modbus)

For Huanyang or similar VFD with Modbus:

```
Octopus Pro            RS-485 Adapter           VFD
   PD5 (TX) ──────────► DI (TX)    ──────────► RS485+
   PD6 (RX) ◄────────── RO (RX)    ◄────────── RS485-
   GND ────────────────── GND      ──────────► GND
```

**grblHAL Settings for VFD:**
```
$395=1     ; Enable Modbus spindle
$396=19200 ; Modbus baud rate
$397=1     ; VFD slave address
```

#### PWM Spindle (0-10V)

```
FAN0 (PA8) ──────► 0-10V Converter ──────► VFD AI input
GND ─────────────────────────────────────► VFD GND
```

**grblHAL Settings for PWM:**
```
$30=24000  ; Max spindle RPM
$31=0      ; Min spindle RPM
$32=0      ; Laser mode off (CNC)
$33=0      ; PWM spindle (not VFD)
```

---

### E-STOP Configuration

| Function | Header | GPIO | Wiring |
|----------|--------|------|--------|
| **E-STOP** | PWR-DET | PC0 | Connect NO E-STOP button |

#### Wiring (Normally Open - Recommended)

```
E-STOP Button
     ┌────────┐
     │  COM   │──────────► GND
     │   NO   │──────────► PC0 (PWR-DET header)
     └────────┘
```

> ⚠️ **CRITICAL:** Use Normally Open (NO) contacts. When button is pressed, circuit closes and triggers E-STOP. This is fail-safe for wire breaks.

**grblHAL Settings:**
```
$37=0      ; E-Stop input NOT inverted (for NO button)
```

---

### Limit Switches

| Axis | Header | GPIO | Connector |
|------|--------|------|-----------|
| X | MIN1 | PG6 | X_STOP |
| Y | MIN2 | PG9 | Y_STOP |
| Z | MIN3 | PG10 | Z_STOP |
| A | MIN4 | PG11 | (optional) |

#### Wiring (Mechanical NO Switch)

```
Limit Switch
     ┌────────┐
     │  COM   │──────────► GND
     │   NO   │──────────► GPIO (PG6/PG9/PG10)
     └────────┘
```

**grblHAL Settings:**
```
$5=0       ; Limit pins NOT inverted (for NO switches)
$20=1      ; Soft limits enabled
$21=1      ; Hard limits enabled
$22=1      ; Homing enabled
$23=0      ; Homing direction mask (0=all negative)
$24=50     ; Homing slow feed (mm/min)
$25=500    ; Homing seek rate (mm/min)
$26=250    ; Homing debounce (ms)
$27=5.0    ; Homing pull-off distance (mm)
```

---

### Probe Input

| Function | Header | GPIO |
|----------|--------|------|
| **Touch Probe** | Z-Probe LEFT | PB6 |
| **Tool Setter** | Z-Probe RIGHT | PB7 |

#### Wiring (Touch Plate)

```
Touch Plate
     ┌─────────────┐
     │  Alligator  │──────────► Spindle body (GND)
     │   Clip      │
     └─────────────┘
     
     ┌─────────────┐
     │ Touch Plate │──────────► PB6 (Z-Probe LEFT)
     └─────────────┘
```

**grblHAL Settings:**
```
$6=0       ; Probe pin NOT inverted
```

---

### Coolant Control

| Function | Header | GPIO | M-Code |
|----------|--------|------|--------|
| **Flood** | HE0* | PA2 | M8/M9 |
| **Mist** | HE1 | PA3 | M7/M9 |
| **Aux 0 (Vacuum)** | HE2 | PB10 | M64 P0 / M65 P0 |

> ⚠️ **v1.1 Note:** PA2 is shared with Motor 3 enable. Don't use Flood AND 4th axis simultaneously.

---

## ⚙️ grblHAL Configuration

### Recommended Settings for Your Machine

```gcode
; === MACHINE DIMENSIONS ===
$130=400   ; X max travel (mm)
$131=400   ; Y max travel (mm)  
$132=200   ; Z max travel (mm)

; === MOTOR SETTINGS ===
$100=800   ; X steps/mm (adjust for your leadscrew)
$101=800   ; Y steps/mm
$102=800   ; Z steps/mm

$110=3000  ; X max rate (mm/min)
$111=3000  ; Y max rate (mm/min)
$112=1500  ; Z max rate (mm/min)

$120=500   ; X acceleration (mm/sec²)
$121=500   ; Y acceleration (mm/sec²)
$122=200   ; Z acceleration (mm/sec²)

; === TRINAMIC TMC2209 ===
$140=1600  ; X motor current (mA)
$141=1600  ; Y motor current (mA)
$142=1600  ; Z motor current (mA)

$150=16    ; X microsteps
$151=16    ; Y microsteps
$152=16    ; Z microsteps

; === SPINDLE ===
$30=24000  ; Spindle max RPM
$31=0      ; Spindle min RPM
$32=0      ; Laser mode OFF
$33=0      ; PWM spindle (0) or VFD (1)

; === HOMING ===
$22=1      ; Homing enabled
$23=0      ; Homing direction mask
$24=50     ; Homing slow feed
$25=500    ; Homing seek rate
$27=5.0    ; Homing pull-off

; === SAFETY ===
$20=1      ; Soft limits enabled
$21=1      ; Hard limits enabled
```

---

## 🔧 ESP32 Peripherals

### Waveshare ESP32-S3 Touch LCD 1.46B (Chatter Detection)

**Connection:** USB Serial (recommended)

| ESP32 Pin | Function |
|-----------|----------|
| USB-C | Data + Power (direct to PC/Hub) |
| GPIO 39 | I2C SDA (IMU) |
| GPIO 40 | I2C SCL (IMU) |
| GPIO 41 | PDM Mic CLK |
| GPIO 42 | PDM Mic DATA |

**Setup:**
1. Connect via USB to PC or USB hub
2. Click "Chatter" in FluidCNC UI
3. Click "Connect USB" button
4. Select the ESP32-S3 device

### XIAO ESP32S3 Sense (Camera)

**Connection:** WiFi AP

| Config | Value |
|--------|-------|
| SSID | `FluidCNC-Camera` |
| Password | `fluidcnc123` |
| IP | `192.168.4.1` |
| Stream | `http://192.168.4.1/stream` |

**Setup:**
1. Power camera via USB (no data needed)
2. Connect phone/laptop to camera WiFi
3. Open `http://192.168.4.1/` in browser
4. Or use Picture-in-Picture in FluidCNC

---

## 🔌 Wiring Diagram Summary

```
                    BTT OCTOPUS PRO v1.1
┌──────────────────────────────────────────────────────────────┐
│                                                              │
│  MOTOR 0 ───► X Stepper                                     │
│  MOTOR 1 ───► Y Stepper                                     │
│  MOTOR 2 ───► Z Stepper                                     │
│  MOTOR 3 ───► A Stepper (optional)                          │
│                                                              │
│  MIN1 (PG6) ───► X Limit Switch                             │
│  MIN2 (PG9) ───► Y Limit Switch                             │
│  MIN3 (PG10) ──► Z Limit Switch                             │
│                                                              │
│  PWR-DET (PC0) ──► E-STOP Button (NO)                       │
│                                                              │
│  Z-Probe LEFT (PB6) ──► Touch Probe / Tool Setter           │
│                                                              │
│  HE0 (PA0) ──► Spindle Enable (VFD)                         │
│  HE1 (PA3) ──► Spindle Direction (CW/CCW)                   │
│  FAN0 (PA8) ──► Spindle PWM (0-10V)                         │
│                                                              │
│  USB-C ──────► Le Potato SBC (server.py)                    │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

---

## ✅ Pre-Flight Checklist

Before first power-on:

- [ ] All motor wires secure (A+/A-/B+/B-)
- [ ] TMC2209 drivers inserted correctly (chip facing PCB)
- [ ] UART jumpers set for each driver (MS1/MS2)
- [ ] 24V power supply connected
- [ ] USB-C connected to Le Potato
- [ ] Limit switches wired to correct pins
- [ ] E-STOP button tested (circuit closes when pressed)
- [ ] Spindle wiring verified (enable/direction/PWM)
- [ ] Probe wiring verified

Before first jog:

- [ ] grblHAL firmware flashed
- [ ] `$I` command returns version info
- [ ] `$$` settings verified
- [ ] Soft limits set correctly ($130-$132)
- [ ] Homing cycle works (`$H`)
- [ ] E-STOP triggers ALARM (test with `$X` to clear)

---

## 🚨 Safety Notes

1. **E-STOP wiring is critical** - Test before every session
2. **Limit switches** should trigger before mechanical limits
3. **Spindle** never starts without explicit M3/M4 command
4. **Homing** should always complete before running jobs
5. **Soft limits** prevent moves outside work envelope
6. **Probe** - Always test with hand jog before auto-probing

---

## 📚 Related Documentation

- [FEATURE_ROADMAP.md](FEATURE_ROADMAP.md) - Feature status
- [README.md](../README.md) - Quick start guide
- [grblHAL Wiki](https://github.com/grblHAL/core/wiki) - Firmware reference
