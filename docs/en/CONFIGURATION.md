# grblHAL Configuration Guide

Complete guide to configuring grblHAL on BTT Octopus Pro.

Language: English | Español: [docs/es/CONFIGURACION.md](../es/CONFIGURACION.md)

## 📋 Table of Contents

- [Initial Connection](#initial-connection)
- [Essential Settings](#essential-settings)
- [Motor Configuration](#motor-configuration)
- [TMC Driver Settings](#tmc-driver-settings)
- [Limit Switches](#limit-switches)
- [Spindle Setup](#spindle-setup)
- [Homing Configuration](#homing-configuration)
- [Work Coordinates](#work-coordinates)
- [Saving Settings](#saving-settings)

---

## Initial Connection

### USB Serial Connection

1. Connect USB-C cable to Octopus Pro
2. Open terminal application (CNC interface, PuTTY, etc.)
3. Select COM port (check Device Manager on Windows)
4. Settings: **115200 baud, 8-N-1**

### Verify Connection

```gcode
$I
```

Expected response:
```
[VER:1.1f.20XXXXXX:]
[OPT:VNMHTS,15,128,0]
```

---

## Essential Settings

### View All Settings

```gcode
$$
```

### Core Machine Settings

| Setting | Description | Example |
|---------|-------------|---------|
| $0 | Step pulse (µs) | 10 |
| $1 | Step idle delay (ms) | 25 |
| $2 | Step port invert | 0 |
| $3 | Direction port invert | 5 (X+Z) |
| $4 | Step enable invert | 0 |
| $5 | Limit pins invert | 0 |
| $6 | Probe pin invert | 0 |
| $10 | Status report | 511 |
| $13 | Report inches | 0 (mm) |

### Example: Basic Router Setup

```gcode
$0=10       ; Step pulse 10µs
$1=25       ; Idle delay 25ms
$2=0        ; No step invert
$3=0        ; No direction invert
$4=0        ; No enable invert
$5=0        ; Limit NC (normal)
$6=0        ; Probe NO (normal)
$10=511     ; Full status report
$13=0       ; Metric (mm)
```

---

## Motor Configuration

### Axis Resolution (Steps/mm)

Calculate: `(Motor steps × Microsteps) / (Pitch × Pulley ratio)`

| Setting | Axis | Calculation Example |
|---------|------|---------------------|
| $100 | X | 200 × 16 / 5 = 640 steps/mm |
| $101 | Y | 200 × 16 / 5 = 640 steps/mm |
| $102 | Z | 200 × 16 / 2 = 1600 steps/mm |
| $103 | A | As needed |

**Example for common setups:**

```gcode
; GT2 belt, 20T pulley, 1.8° motor, 16 microsteps
$100=80     ; (200 × 16) / (2 × 20) = 80 steps/mm

; 8mm lead screw, 1.8° motor, 16 microsteps
$100=400    ; (200 × 16) / 8 = 400 steps/mm

; 5mm pitch ball screw, 1.8° motor, 16 microsteps
$100=640    ; (200 × 16) / 5 = 640 steps/mm
```

### Maximum Velocities (mm/min)

| Setting | Axis | Description |
|---------|------|-------------|
| $110 | X | Max velocity |
| $111 | Y | Max velocity |
| $112 | Z | Max velocity |

```gcode
$110=3000   ; X max 3000 mm/min
$111=3000   ; Y max 3000 mm/min
$112=1000   ; Z max 1000 mm/min (slower)
```

### Acceleration (mm/sec²)

| Setting | Axis | Description |
|---------|------|-------------|
| $120 | X | Acceleration |
| $121 | Y | Acceleration |
| $122 | Z | Acceleration |

```gcode
$120=200    ; X accel 200 mm/s²
$121=200    ; Y accel 200 mm/s²
$122=50     ; Z accel 50 mm/s² (gentler)
```

### Maximum Travel (mm)

| Setting | Axis | Description |
|---------|------|-------------|
| $130 | X | Max travel |
| $131 | Y | Max travel |
| $132 | Z | Max travel |

```gcode
$130=800    ; X travel 800mm
$131=600    ; Y travel 600mm
$132=100    ; Z travel 100mm
```

---

## TMC Driver Settings

### UART Mode (TMC2209/2208)

With UART mode enabled in firmware, use these settings:

```gcode
$338=600    ; Driver 0 (X) current mA
$339=600    ; Driver 1 (Y) current mA
$340=600    ; Driver 2 (Z) current mA
$341=600    ; Driver 3 (A) current mA
$342=600    ; Driver 4 (B) current mA

$345=16     ; Driver 0 microsteps
$346=16     ; Driver 1 microsteps
$347=16     ; Driver 2 microsteps
$348=16     ; Driver 3 microsteps
$349=16     ; Driver 4 microsteps
```

### StealthChop vs SpreadCycle

```gcode
$14=0       ; StealthChop disabled (SpreadCycle only)
$14=1       ; StealthChop enabled (quiet operation)
```

- **StealthChop**: Quiet, good for low speeds, less torque
- **SpreadCycle**: Louder, better torque at high speeds

### Sensorless Homing (TMC2209)

Sensorless homing uses StallGuard to detect axis limits:

```gcode
$22=1           ; Enable homing
$337=50         ; StallGuard sensitivity (0-255)

; Per-axis sensitivity (if supported)
; Lower value = more sensitive
```

⚠️ **Tune carefully!** False triggers cause crashes.

---

## Limit Switches

### Enable Hard Limits

```gcode
$20=1       ; Soft limits enabled
$21=1       ; Hard limits enabled
$22=1       ; Homing cycle enabled
```

### Limit Switch Inversion

```gcode
$5=0        ; NC switches (open = triggered)
$5=7        ; NO switches inverted (all 3 axes)
```

Bit mask: X=1, Y=2, Z=4 → sum for combination

### Verify Limit Status

```gcode
?
```

Response includes `Pn:` followed by active limits (X, Y, Z)

---

## Spindle Setup

### PWM Spindle Configuration

```gcode
$30=24000   ; Max spindle speed (RPM)
$31=0       ; Min spindle speed
$32=1       ; Laser mode disabled (0=laser, 1=spindle)
$33=5000    ; PWM frequency (Hz)
$34=0       ; PWM off value (0-100%)
$35=100     ; PWM max value (0-100%)
$36=100     ; PWM min value (0-100%)
```

### VFD 0-10V Output

For VFD with 0-10V input:

```gcode
$30=24000   ; Your spindle max RPM
$31=6000    ; Min RPM (below this = OFF)
```

### Verify Spindle

```gcode
M3 S12000   ; Spindle ON, 50% speed
M5          ; Spindle OFF
```

---

## Homing Configuration

### Homing Enable

```gcode
$22=1       ; Enable homing cycle
```

### Homing Direction

```gcode
$23=0       ; Home to negative (-X, -Y, -Z)
$23=7       ; Home to positive (+X, +Y, +Z)
$23=3       ; X+ Y+ Z- (bit mask: X=1, Y=2, Z=4)
```

### Homing Speeds

```gcode
$24=100     ; Homing seek rate (mm/min)
$25=25      ; Homing feed rate (mm/min - slower)
$26=250     ; Homing debounce (ms)
$27=2       ; Homing pull-off (mm)
```

### Homing Sequence

```gcode
$44=0       ; Default: Z first, then X and Y together
```

### Run Homing Cycle

```gcode
$H          ; Home all axes
$HX         ; Home X only
$HY         ; Home Y only
$HZ         ; Home Z only
```

---

## Work Coordinates

### Coordinate Systems

| G-code | Description | Storage |
|--------|-------------|---------|
| G54 | Work offset 1 (default) | EEPROM |
| G55 | Work offset 2 | EEPROM |
| G56 | Work offset 3 | EEPROM |
| G57 | Work offset 4 | EEPROM |
| G58 | Work offset 5 | EEPROM |
| G59 | Work offset 6 | EEPROM |

### Set Work Zero

```gcode
G10 L20 P1 X0 Y0 Z0    ; Set G54 to current position
```

Or use:
```gcode
G54             ; Select G54
G92 X0 Y0       ; Set current XY as zero (temporary)
```

### View Offsets

```gcode
$#          ; Display all coordinate offsets
```

---

## Saving Settings

### Settings are Automatically Saved

Most `$` settings are saved to EEPROM immediately.

### Export Settings

Type `$$` and save the output to a text file for backup.

### Restore Settings

Paste saved settings line by line, or use sender software.

### Factory Reset

```gcode
$RST=$      ; Reset settings to defaults
$RST=#      ; Reset coordinate offsets
$RST=*      ; Full reset (settings + offsets)
```

---

## Quick Reference Card

### Common Commands

| Command | Action |
|---------|--------|
| `$$` | View all settings |
| `$I` | Firmware info |
| `$N` | Startup blocks |
| `$#` | Coordinate offsets |
| `$G` | Parser state |
| `?` | Real-time status |
| `$H` | Home all axes |
| `$X` | Kill alarm lock |
| `$SLP` | Sleep mode |

### Status Characters

| Char | State |
|------|-------|
| `Idle` | Ready |
| `Run` | Motion active |
| `Hold` | Feed hold |
| `Jog` | Jogging |
| `Alarm` | Alarm triggered |
| `Door` | Safety door |
| `Check` | Check mode |
| `Home` | Homing |

### Alarm Codes

| Code | Description | Solution |
|------|-------------|----------|
| 1 | Hard limit | Check switches, $X to clear |
| 2 | Soft limit | Move inside work envelope |
| 3 | Abort | Reset cycle |
| 4 | Probe fail | Check probe connection |
| 5 | Probe initial state | Probe already triggered |
| 6 | Homing fail - reset | Run $H |
| 7 | Homing fail - door | Close safety door |
| 8 | Homing fail - limit | Pull off limit first |
| 9 | Homing fail - no switch | Check limit wiring |

---

## Example: Complete Router Configuration

```gcode
; === Machine Settings ===
$0=10       ; Step pulse 10µs
$1=25       ; Step idle delay 25ms
$2=0        ; Step port normal
$3=0        ; Direction normal
$4=0        ; Enable normal
$5=0        ; Limits NC
$6=0        ; Probe NO

; === Motion Settings ===
$100=640    ; X steps/mm (5mm screw)
$101=640    ; Y steps/mm (5mm screw)
$102=1600   ; Z steps/mm (2mm screw)

$110=3000   ; X max velocity
$111=3000   ; Y max velocity
$112=1000   ; Z max velocity

$120=200    ; X acceleration
$121=200    ; Y acceleration
$122=50     ; Z acceleration

$130=800    ; X travel
$131=600    ; Y travel
$132=100    ; Z travel

; === Homing ===
$20=1       ; Soft limits ON
$21=1       ; Hard limits ON
$22=1       ; Homing ON
$23=0       ; Home negative
$24=200     ; Seek rate
$25=50      ; Feed rate
$26=250     ; Debounce
$27=2       ; Pull-off

; === Spindle ===
$30=24000   ; Max RPM
$31=6000    ; Min RPM
$32=1       ; Spindle mode
$33=5000    ; PWM freq

; === TMC2209 UART ===
$338=600    ; X current mA
$339=600    ; Y current mA
$340=600    ; Z current mA
$345=16     ; X microsteps
$346=16     ; Y microsteps
$347=16     ; Z microsteps
```
