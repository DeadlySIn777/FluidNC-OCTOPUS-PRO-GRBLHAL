# Wiring Guide - BTT Octopus Pro for CNC

Complete wiring diagrams for BTT Octopus Pro v1.0.1 and v1.1 with grblHAL.

Language: English | Español: [docs/es/CABLEADO.md](../es/CABLEADO.md)

## 📋 Table of Contents

- [Board Overview](#board-overview)
- [Stepper Motors](#stepper-motors)
- [Limit Switches](#limit-switches)
- [Spindle Control](#spindle-control)
- [Probes](#probes)
- [Coolant](#coolant)
- [Auxiliary Outputs](#auxiliary-outputs)
- [E-Stop](#e-stop)
- [Complete System Example](#complete-system-example)

---

## Board Overview

```
                        BTT OCTOPUS PRO
    ┌─────────────────────────────────────────────────────────────────────┐
    │                              USB-C                                   │
    │                            (CDC Serial)                              │
    ├─────────────────────────────────────────────────────────────────────┤
    │                                                                      │
    │  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐        │
    │  │ MOTOR 0 │ │ MOTOR 1 │ │ MOTOR 2 │ │ MOTOR 3 │ │ MOTOR 4 │ ...    │
    │  │   (X)   │ │   (Y)   │ │   (Z)   │ │   (A)   │ │   (B)   │        │
    │  │ TMC2209 │ │ TMC2209 │ │ TMC2209 │ │ TMC2209 │ │ TMC2209 │        │
    │  └─────────┘ └─────────┘ └─────────┘ └─────────┘ └─────────┘        │
    │                                                                      │
    │  ┌───────┐ ┌───────┐ ┌───────┐ ┌───────┐ ┌───────┐ ┌───────┐        │
    │  │ MIN1  │ │ MIN2  │ │ MIN3  │ │ MIN4  │ │ MIN5  │ │ MIN6  │        │
    │  │  (X)  │ │  (Y)  │ │  (Z)  │ │  (A)  │ │  (B)  │ │  (C)  │        │
    │  └───────┘ └───────┘ └───────┘ └───────┘ └───────┘ └───────┘        │
    │                                                                      │
    │  ┌────────┐ ┌────────┐    ┌────────┐ ┌────────┐ ┌────────┐          │
    │  │Z-Probe │ │Z-Probe │    │  FAN0  │ │  FAN4  │ │  FAN5  │          │
    │  │  Left  │ │  Right │    │  PWM   │ │   EN   │ │  DIR   │          │
    │  │ (PB6)  │ │ (PB7)  │    │ (PA8)  │ │(PD14)  │ │(PE15)  │          │
    │  └────────┘ └────────┘    └────────┘ └────────┘ └────────┘          │
    │                                                                      │
    │  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐                        │
    │  │  HE0   │ │  HE1   │ │  HE2   │ │  HE3   │                        │
    │  │ Flood  │ │  Mist  │ │  Aux   │ │  Aux   │                        │
    │  └────────┘ └────────┘ └────────┘ └────────┘                        │
    │                                                                      │
    └─────────────────────────────────────────────────────────────────────┘
```

---

## Stepper Motors

### Pin Assignments

| Motor | Axis | Step | Dir | Enable | UART |
|-------|------|------|-----|--------|------|
| Motor 0 | X | PF13 | PF12 | PF14 | PC4 |
| Motor 1 | Y | PG0 | PG1 | PF15 | PD11 |
| Motor 2 | Z | PF11 | PG3 | PG5 | PC6 |
| Motor 3 | A | PG4 | PC1 | PA0* | PC7 |
| Motor 4 | B | PF9 | PF10 | PG2 | PF2 |
| Motor 5 | C | PC13 | PF0 | PF1 | PE4 |
| Motor 6 | - | PE2 | PE3 | PD4 | PE1 |
| Motor 7 | - | PE6 | PA14 | PE0 | PD3 |

*Note: Motor 3 Enable is PA0 on v1.1, PA2 on v1.0

### NEMA 23 Wiring (4-Wire)

```
    Motor NEMA 23                    Octopus Pro Motor Slot
    ┌───────────┐                    ┌───────────────────┐
    │           │                    │  2B  2A  1A  1B   │
    │  ┌───┐    │                    │  ●   ●   ●   ●   │
    │  │   │    │   Black  ─────────►│  2B              │
    │  └───┘    │   Green  ─────────►│      2A          │
    │           │   Red    ─────────►│          1A      │
    │   ●●●●    │   Blue   ─────────►│              1B  │
    └───────────┘                    └───────────────────┘
```

⚠️ **Wire colors vary by manufacturer!** Use multimeter to identify coil pairs (same coil = low resistance).

### Voltage Jumper Configuration

```
    24V (TMC2209/2208)               48-60V (TMC5160 HV)
    
    ┌─────┐                          ┌─────┐
    │ ○─■ │  ← Jumper RIGHT          │ ■─○ │  ← Jumper LEFT
    └─────┘     = MAIN_POWER         └─────┘     = MOTOR_POWER
                (max 28V)                        (max 60V)
```

⚠️ **WARNING**: Wrong voltage selection will destroy drivers!

---

## Limit Switches

### Pin Assignments

| Axis | Header | Pin | Notes |
|------|--------|-----|-------|
| X | MIN1 | PG6 | NC recommended |
| Y | MIN2 | PG9 | NC recommended |
| Z | MIN3 | PG10 | NC recommended |
| A | MIN4 | PG11 | NC recommended |
| B | MIN5 | PG12 | NC recommended |
| C | MIN6 | PG13 | NC recommended |

### Wiring Diagram (NC Switch)

```
    Limit Switch (NC)                Octopus Pro MIN Header
    ┌───────────┐                    ┌─────────────────┐
    │    ●──●   │                    │  SIG  GND  5V   │
    │   /   \   │   COM ────────────►│       GND       │
    │  │ NC  │  │   NC  ────────────►│  SIG            │
    │   \   /   │                    │             5V  │  (not used)
    │    ●──●   │                    └─────────────────┘
    └───────────┘                    
    
    NC = Normally Closed (recommended for safety)
    When triggered: circuit opens → grblHAL detects limit
```

### Wiring Diagram (NPN Inductive Sensor)

```
    NPN Inductive                    Octopus Pro MIN Header
    ┌───────────┐                    ┌─────────────────┐
    │   Brown ──│─── +24V ◄─────────►│             5V  │ (use external 24V!)
    │   Blue  ──│─── GND  ◄─────────►│       GND       │
    │   Black ──│─── OUT  ──────────►│  SIG            │
    └───────────┘                    └─────────────────┘
    
    ⚠️ Most inductive sensors need 12-24V, not 5V!
       Use external power supply for Brown wire.
```

---

## Spindle Control

### Pin Assignments

| Function | Pin | Header | Signal Type |
|----------|-----|--------|-------------|
| PWM / Speed | PA8 | FAN0 | 0-10V or PWM |
| Enable | PD14 | FAN4 | On/Off |
| Direction | PE15 | FAN5 | CW/CCW |

### VFD Wiring (0-10V Control)

```
    Octopus Pro                      VFD (Variable Frequency Drive)
    ┌───────────┐                    ┌─────────────────────────┐
    │  FAN0     │                    │                         │
    │  PA8  ────│───────────────────►│  VI (0-10V input)       │
    │  GND  ────│───────────────────►│  COM / GND              │
    │           │                    │                         │
    │  FAN4     │                    │                         │
    │  PD14 ────│───────────────────►│  FOR (Forward/Enable)   │
    │           │                    │                         │
    │  FAN5     │                    │                         │
    │  PE15 ────│───────────────────►│  REV (Reverse/Dir)      │
    └───────────┘                    └─────────────────────────┘
    
    G-code commands:
    M3 S12000  → Spindle CW at 12000 RPM
    M4 S12000  → Spindle CCW at 12000 RPM
    M5         → Spindle OFF
```

### PWM Spindle (ESC / BLDC)

```
    Octopus Pro                      ESC / Spindle Controller
    ┌───────────┐                    ┌─────────────────────────┐
    │  FAN0     │                    │                         │
    │  PA8  ────│───────────────────►│  PWM Signal (1-2ms)     │
    │  GND  ────│───────────────────►│  GND                    │
    └───────────┘                    └─────────────────────────┘
```

---

## Probes

### Pin Assignments

| Function | Pin | Header | Use |
|----------|-----|--------|-----|
| Touch Probe | PB6 | Z-Probe Left | Workpiece probing |
| Tool Setter | PB7 | Z-Probe Right | Fixed tool length sensor |

### Touch Probe Wiring

```
    Touch Probe                      Octopus Pro Z-Probe Left
    ┌───────────┐                    ┌─────────────────┐
    │           │                    │  SIG  GND  5V   │
    │  ┌───┐    │                    │                 │
    │  │ ○ │────│───────────────────►│  SIG            │
    │  └───┘    │───────────────────►│       GND       │
    │  Plate    │                    │             5V  │ (optional)
    └───────────┘                    └─────────────────┘
    
    Probe touches plate → circuit closes → grblHAL stops
    
    G-code: G38.2 Z-50 F100  → Probe down until contact
```

### Tool Setter Wiring

```
    Tool Setter                      Octopus Pro Z-Probe Right
    ┌───────────┐                    ┌─────────────────┐
    │   ═══     │                    │  SIG  GND  5V   │
    │   │ │     │                    │                 │
    │   └─┘     │                    │                 │
    │   NO  ────│───────────────────►│  SIG            │
    │   COM ────│───────────────────►│       GND       │
    │   NC      │                    │                 │
    └───────────┘                    └─────────────────┘
    
    Fixed sensor for tool length measurement
```

---

## Coolant

### Pin Assignments (V1.1 Differences!)

| Function | V1.0 Pin | V1.1 Pin | Header | M-Code |
|----------|----------|----------|--------|--------|
| Flood | PA0 | **PA2** | HE0 | M8/M9 |
| Mist | PA3 | PA3 | HE1 | M7/M9 |

### Wiring Diagram

```
    Octopus Pro                      Coolant Relay / Pump
    ┌───────────┐                    ┌─────────────────┐
    │  HE0      │                    │                 │
    │  PA2  ────│───────────────────►│  Signal (+)     │
    │  GND  ────│───────────────────►│  GND (-)        │
    └───────────┘                    └─────────────────┘
    
    G-code:
    M7  → Mist coolant ON
    M8  → Flood coolant ON
    M9  → All coolant OFF
```

---

## Auxiliary Outputs

### Pin Assignments (M64/M65 Digital Outputs)

| Port | V1.0 Pin | V1.1 Pin | Header | M-Code ON | M-Code OFF |
|------|----------|----------|--------|-----------|------------|
| P0 | PB0 | **PB10** | HE2 | M64 P0 | M65 P0 |
| P1 | PE5 | PE5 | FAN1 | M64 P1 | M65 P1 |
| P2 | PD12 | PD12 | FAN2 | M64 P2 | M65 P2 |
| P3 | PD13 | PD13 | FAN3 | M64 P3 | M65 P3 |

### Example: Vacuum Control

```
    Octopus Pro                      Solid State Relay → Vacuum
    ┌───────────┐                    ┌─────────────────┐
    │  HE2      │                    │                 │
    │  PB10 ────│───────────────────►│  +              │
    │  GND  ────│───────────────────►│  -              │
    └───────────┘                    └─────────────────┘
    
    G-code:
    M64 P0  → Vacuum ON
    M65 P0  → Vacuum OFF
```

---

## E-Stop

### Wiring (PWR-DET Pin)

```
    E-Stop Button (NC)               Octopus Pro PWR-DET
    ┌───────────┐                    ┌─────────────────┐
    │           │                    │  PC0            │
    │    ●──●   │───────────────────►│  SIG            │
    │   /   \   │───────────────────►│  GND            │
    │  │ NC  │  │                    │                 │
    │   \   /   │                    └─────────────────┘
    │    ●──●   │                    
    └───────────┘                    
    
    NC contact = Normally Closed
    Press E-Stop → Opens circuit → grblHAL triggers alarm
```

---

## Complete System Example

```
                           ┌──────────────────┐
                           │   24V PSU        │
                           │   (Mean Well)    │
                           └────────┬─────────┘
                                    │
    ┌───────────────────────────────┼───────────────────────────────┐
    │                               ▼                               │
    │                    BTT OCTOPUS PRO V1.1                       │
    │                                                               │
    │  ┌─────┐ ┌─────┐ ┌─────┐    ┌────┐ ┌────┐ ┌────┐            │
    │  │ M0  │ │ M1  │ │ M2  │    │MIN1│ │MIN2│ │MIN3│            │
    │  │ X   │ │ Y   │ │ Z   │    │ X  │ │ Y  │ │ Z  │            │
    │  └──┬──┘ └──┬──┘ └──┬──┘    └─┬──┘ └─┬──┘ └─┬──┘            │
    │     │      │      │          │      │      │                │
    └─────┼──────┼──────┼──────────┼──────┼──────┼────────────────┘
          │      │      │          │      │      │
          ▼      ▼      ▼          ▼      ▼      ▼
    ┌─────────────────────────┐  ┌─────────────────────────┐
    │  NEMA23 X  Y  Z         │  │  Limit Switches         │
    └─────────────────────────┘  └─────────────────────────┘
    
    
    ┌─────────────────────────────────────────────────────────────┐
    │                    BTT OCTOPUS PRO V1.1                      │
    │                                                              │
    │  ┌─────┐ ┌─────┐ ┌─────┐    ┌──────┐ ┌──────┐              │
    │  │FAN0 │ │FAN4 │ │FAN5 │    │Probe │ │ TLS  │              │
    │  │ PWM │ │ EN  │ │ DIR │    │ PB6  │ │ PB7  │              │
    │  └──┬──┘ └──┬──┘ └──┬──┘    └──┬───┘ └──┬───┘              │
    └─────┼──────┼──────┼───────────┼────────┼───────────────────┘
          │      │      │           │        │
          ▼      ▼      ▼           ▼        ▼
    ┌─────────────────────────┐  ┌─────────────────────────┐
    │         VFD             │  │  Touch    Tool          │
    │  ┌───────────────────┐  │  │  Probe    Setter        │
    │  │ VI ← PWM          │  │  │                         │
    │  │ FOR ← Enable      │  │  │   ○        ═══          │
    │  │ REV ← Direction   │  │  │            │ │          │
    │  │ COM ← GND         │  │  │            └─┘          │
    │  └───────────────────┘  │  │                         │
    └─────────────────────────┘  └─────────────────────────┘
```

---

## Pre-Power Checklist

- [ ] Correct input voltage (24V for TMC2209)
- [ ] Voltage jumpers in correct position
- [ ] All drivers properly seated
- [ ] Motor wires connected (check polarity)
- [ ] Limit switches connected and tested
- [ ] Probe connected correctly
- [ ] VFD/Spindle wired per diagram
- [ ] USB connected before power on
- [ ] BOOT0 jumper in NORMAL position (not DFU)

---

## Troubleshooting

| Symptom | Probable Cause | Solution |
|---------|----------------|----------|
| Motor vibrates, won't spin | Coil wires crossed | Swap 1A↔1B or 2A↔2B |
| Motor spins wrong direction | Direction inverted | Swap wires of ONE coil |
| Limit switch not detected | Wrong NC/NO wiring | Use NC between Signal and GND |
| Probe doesn't work | Wrong polarity | Verify contact connects to GND |
| Driver overheats | Current too high or wrong voltage | Lower current, check jumpers |
| TMC UART error | Wrong wiring or address | Check MS1/MS2 and UART pin |
