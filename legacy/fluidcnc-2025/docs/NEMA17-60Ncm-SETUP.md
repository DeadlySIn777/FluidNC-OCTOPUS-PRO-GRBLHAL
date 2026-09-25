# NEMA 17 High-Torque Motor Setup Guide

## Motor Specifications (StepperOnline 3-Pack)
| Parameter | Value |
|-----------|-------|
| Model | NEMA 17 Bipolar |
| Holding Torque | **60 Ncm** (8.5 kg-cm) |
| Rated Current | 2.1A/phase |
| Resistance | 1.7Ω/phase |
| Inductance | ~4-6mH (check datasheet) |
| Step Angle | 1.8° (200 steps/rev) |
| Size | 42mm × 42mm × 60mm |

## Driver: BTT TMC2209 v1.3 (UART Mode)

### Mode: UART with Physical Endstops
- ✅ Software current control via grblHAL
- ✅ Physical limit switches for homing
- ✅ StealthChop/SpreadCycle auto-switching
- ✅ Hold current reduction when idle

---

## Complete grblHAL Configuration

Copy and paste this into the console after connecting:

```gcode
; ╔════════════════════════════════════════════════════════════╗
; ║  60Ncm NEMA17 + TMC2209 UART + ENDSTOPS CONFIGURATION     ║
; ╚════════════════════════════════════════════════════════════╝

; === MOTOR CURRENT (UART) ===
$140=2000    ; X run current (mA) - 2.0A
$141=2000    ; Y run current (mA) - 2.0A
$142=2000    ; Z run current (mA) - 2.0A
$143=1000    ; X hold current (mA) - 50% when idle
$144=1000    ; Y hold current (mA)
$145=1000    ; Z hold current (mA)

; === MICROSTEPS ===
$150=16      ; X microsteps (16 = smooth, 8 = more torque)
$151=16      ; Y microsteps
$152=16      ; Z microsteps

; === STEALTHCHOP THRESHOLD (mm/min) ===
; Below = silent StealthChop, Above = powerful SpreadCycle
$160=60      ; X: SpreadCycle for cutting speeds
$161=60      ; Y: SpreadCycle for cutting speeds
$162=40      ; Z: SpreadCycle for plunges

; === STEPS PER MM ===
; Formula: (motor_steps × microsteps) / lead_screw_pitch
; Example: (200 × 16) / 8mm = 400 steps/mm
$100=400     ; X steps/mm (adjust for your lead screw)
$101=400     ; Y steps/mm
$102=400     ; Z steps/mm

; === MAX VELOCITY (mm/min) ===
; High-inductance motors lose torque at high speed
$110=5000    ; X max rate
$111=5000    ; Y max rate
$112=2000    ; Z max rate

; === ACCELERATION (mm/s²) ===
; High torque = can accelerate faster
$120=400     ; X acceleration
$121=400     ; Y acceleration
$122=250     ; Z acceleration

; === TRAVEL LIMITS ===
$130=350     ; X max travel (mm)
$131=500     ; Y max travel (mm)
$132=120     ; Z max travel (mm)

; === HOMING (PHYSICAL ENDSTOPS) ===
$22=7        ; Enable homing on X, Y, Z
$23=4        ; Homing direction (Z homes to top)
$24=100      ; Homing locate feed (slow, final approach)
$25=2000     ; Homing seek rate (fast search)
$26=250      ; Debounce (ms)
$27=3.0      ; Pull-off distance (mm)

; === LIMITS ===
$20=1        ; Soft limits ON (requires homing first)
$21=7        ; Hard limits ON (X + Y + Z endstops)

; === MISC ===
$0=5         ; Step pulse (µs)
$1=25        ; Step idle delay (ms) before hold current kicks in
$2=0         ; Step invert mask
$3=0         ; Direction invert (change if motor goes wrong way)
$4=0         ; Enable invert (0 = active high)
$10=511      ; Status report mask
$13=0        ; Report in mm

; === SPINDLE (VFD via ESP32) ===
$30=24000    ; Max RPM
$31=5000     ; Min RPM
$32=0        ; Laser mode OFF

; Save and verify
$$
```

---

## Endstop Wiring

### Octopus Pro Endstop Pins
| Axis | Connector | Pin | Notes |
|------|-----------|-----|-------|
| X | DIAG0/STOP0 | PG6 | X min endstop |
| Y | DIAG1/STOP1 | PG9 | Y min endstop |
| Z | DIAG2/STOP2 | PG10 | Z max endstop (top) |

### Wiring (NC switches recommended)
```
Switch ──┬── Signal pin
         └── GND pin
```

**NC (Normally Closed) is safer** - wire break = trigger = stop

### Testing Endstops
```gcode
?          ; Status report - look for limit indicators
$X         ; Unlock after limit trigger
```

---

## Power Budget

### Current Draw (worst case)
| Component | Current | Voltage | Power |
|-----------|---------|---------|-------|
| X motor | 2.0A | - | 6.8W |
| Y motor | 2.0A | - | 6.8W |
| Z1 motor | 2.0A | - | 6.8W |
| Z2 motor | 2.0A | - | 6.8W |
| Z3 motor | 2.0A | - | 6.8W |
| **Total motors** | 10A | - | 34W |
| Octopus Pro | ~1A | 24V | 24W |
| Fans/LEDs | ~0.5A | 24V | 12W |
| **System Total** | ~12A | 24V | **~70W** |

### PSU Recommendation
- **Minimum:** 24V 10A (240W) - plenty of headroom
- Your motors + drivers won't all pull max at once

---

## Thermal Management

At 2.0A per motor in UART mode:

| Component | Expected Temp | Action if Hot |
|-----------|---------------|---------------|
| TMC2209 drivers | 50-70°C | Normal with heatsink |
| Motors | 40-60°C | Normal, warm to touch |
| Drivers >80°C | OVERTEMP | Add fan, reduce to 1.8A |
| Motors >70°C | HOT | Check for binding |

### Recommended Cooling
1. Heatsinks on ALL TMC2209s ✅
2. 40mm fan over driver area
3. Good enclosure ventilation

---

## Tuning Tips

### If Motors Skip Steps
```gcode
$120=300     ; Reduce acceleration
$121=300
$122=200
```

### If Motors Run Hot
```gcode
$140=1800    ; Reduce run current to 1.8A
$141=1800
$142=1800
$143=900     ; Hold at 50%
$144=900
$145=900
```

### If Motors Vibrate at Certain Speeds
```gcode
$160=0       ; Use StealthChop always (quieter but less torque)
$161=0
$162=0
```

### For Maximum Torque During Cuts
```gcode
$160=1       ; Always SpreadCycle (louder but stronger)
$161=1
$162=1
```
