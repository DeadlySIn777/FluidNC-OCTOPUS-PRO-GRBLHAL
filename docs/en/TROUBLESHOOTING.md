# Troubleshooting Guide

Common issues and solutions for grblHAL on BTT Octopus Pro.

Language: English | Español: [docs/es/SOLUCION_PROBLEMAS.md](../es/SOLUCION_PROBLEMAS.md)

## 📋 Table of Contents

- [Connection Issues](#connection-issues)
- [Motor Problems](#motor-problems)
- [TMC Driver Issues](#tmc-driver-issues)
- [Limit Switch Problems](#limit-switch-problems)
- [Homing Failures](#homing-failures)
- [Spindle Issues](#spindle-issues)
- [Probe Problems](#probe-problems)
- [Alarm Codes](#alarm-codes)
- [Firmware & Flashing](#firmware--flashing)

---

## Connection Issues

### Board Not Detected (No COM Port)

**Symptoms:**
- Device Manager shows nothing new when USB connected
- "Unknown device" in Device Manager

**Solutions:**

1. **Install CH340/CP2102 Drivers**
   - Download from [Silicon Labs](https://www.silabs.com/developers/usb-to-uart-bridge-vcp-drivers)
   - Install and restart computer

2. **Try Different USB Cable**
   - Some cables are charge-only (no data lines)
   - Use cable that came with the board

3. **Check USB Port**
   - Try different USB port (prefer rear ports)
   - Avoid USB hubs

4. **Check BOOT0 Jumper**
   - Should be in NORMAL position (not DFU)
   - DFU mode = no CDC serial

### COM Port Opens But No Response

**Symptoms:**
- COM port visible but no `$$` response
- Terminal shows nothing

**Solutions:**

1. **Check Baud Rate**
   - Should be 115200 (not 9600)
   
2. **Check Terminal Settings**
   - 8 data bits, no parity, 1 stop bit
   - No flow control

3. **Try Different Terminal**
   - PuTTY, Tera Term, or CNC software console

4. **Check Firmware**
   - May need to reflash grblHAL

---

## Motor Problems

### Motor Makes Noise But Won't Spin

**Symptoms:**
- High-pitched whine or grinding
- Shaft vibrates but doesn't rotate

**Cause:** Coil wires are crossed

**Solution:**
```
Swap two wires of ONE coil only:
1A ↔ 1B  OR  2A ↔ 2B (not both!)
```

### Motor Spins Wrong Direction

**Symptoms:**
- Axis moves opposite to expected

**Solutions:**

1. **Software Fix (Preferred)**
   ```gcode
   $3=1    ; Invert X direction
   $3=2    ; Invert Y direction
   $3=4    ; Invert Z direction
   $3=5    ; Invert X and Z
   ```

2. **Hardware Fix**
   - Swap wires of ONE coil (1A↔1B or 2A↔2B)

### Motor Loses Steps

**Symptoms:**
- Position drifts over time
- Parts are wrong size
- Circles are not round

**Solutions:**

1. **Reduce Speed**
   ```gcode
   $110=2000   ; Lower max velocity
   ```

2. **Reduce Acceleration**
   ```gcode
   $120=100    ; Lower acceleration
   ```

3. **Increase Current (TMC UART)**
   ```gcode
   $338=800    ; Increase motor current
   ```

4. **Check Mechanical Issues**
   - Loose coupling
   - Binding or friction
   - Overloaded axis

### Motor Overheats

**Symptoms:**
- Motor too hot to touch
- Driver thermal shutdown

**Solutions:**

1. **Reduce Current**
   ```gcode
   $338=500    ; Lower current to 500mA
   ```

2. **Enable SpreadCycle** (better thermal)
   ```gcode
   $14=0       ; SpreadCycle mode
   ```

3. **Add Cooling**
   - Fan on motor and driver
   - Heat sink on driver

---

## TMC Driver Issues

### UART Communication Error

**Symptoms:**
- Error messages about TMC
- Driver settings don't apply
- Motors run in default mode

**Solutions:**

1. **Check Driver Seating**
   - Remove and reinstall driver
   - Ensure all pins are connected

2. **Check UART Jumper**
   - MS1/MS2 jumpers may need specific configuration
   - Check your driver documentation

3. **Verify Firmware**
   - Must be compiled with TMC UART support
   - Use correct PlatformIO environment

### Driver Overtemperature

**Symptoms:**
- Driver shuts down mid-job
- Thermal warning (if visible)

**Solutions:**

1. **Reduce Current**
2. **Add Active Cooling**
3. **Check Voltage Jumper**
   - Wrong voltage setting causes excess heat

### StallGuard Not Working

**Symptoms:**
- Sensorless homing crashes into ends
- False triggers during motion

**Solutions:**

1. **Tune Sensitivity**
   ```gcode
   $337=50     ; Try different values (0-255)
   ```
   - Lower = more sensitive
   - Higher = less sensitive

2. **Reduce Homing Speed**
   ```gcode
   $24=50      ; Slower seek rate
   ```

3. **Use Physical Limit Switches**
   - More reliable than StallGuard

---

## Limit Switch Problems

### Limit Always Triggered

**Symptoms:**
- Status shows limit active at all times
- Can't move or home

**Solutions:**

1. **Check NC/NO Setting**
   ```gcode
   $5=0    ; For NC switches (most common)
   $5=7    ; For NO switches (inverted)
   ```

2. **Verify Wiring**
   - NC switches: signal between SIG and GND
   - NO switches: signal between SIG and VCC

3. **Check for Short**
   - Disconnect switch and test with `?` command

### Limit Never Triggers

**Symptoms:**
- Machine crashes into end
- Homing fails with "no switch found"

**Solutions:**

1. **Check Wiring**
   - Use multimeter to verify switch
   - Check continuity changes when actuated

2. **Check Inversion**
   - Try opposite setting
   ```gcode
   $5=7    ; If currently 0
   ```

3. **Verify Pin**
   - Ensure correct header is used (MIN1, MIN2, etc.)

---

## Homing Failures

### Error: "Homing fail - pulloff"

**Cause:** Switch still triggered after pulloff

**Solutions:**

1. **Increase Pulloff Distance**
   ```gcode
   $27=5       ; 5mm pulloff
   ```

2. **Check Switch Position**
   - Switch may be too close to travel end

### Error: "Homing fail - no switch"

**Cause:** Switch not found within travel

**Solutions:**

1. **Check Wiring** (see limit switch section)

2. **Increase Travel**
   ```gcode
   $130=1000   ; Increase X max travel
   ```

3. **Reduce Seek Rate**
   ```gcode
   $24=100     ; Slower homing
   ```

### Error: "Homing fail - reset"

**Cause:** Limit triggered before homing started

**Solutions:**

1. **Move Off Limit First**
   ```gcode
   $X          ; Clear alarm
   G91 G0 X10  ; Jog off limit
   $H          ; Home again
   ```

2. **Check for Debris**
   - Switch may be physically stuck

---

## Spindle Issues

### Spindle Won't Start

**Symptoms:**
- M3 command does nothing
- No PWM output

**Solutions:**

1. **Check Settings**
   ```gcode
   $30=24000   ; Max RPM
   $32=1       ; Spindle mode (not laser)
   ```

2. **Verify Pin**
   - PWM on PA8 (FAN0 header)
   - Check wiring to VFD

3. **Test with Command**
   ```gcode
   M3 S12000   ; 50% speed
   ```

### Spindle Speed Incorrect

**Symptoms:**
- RPM doesn't match commanded speed

**Solutions:**

1. **Calibrate $30**
   ```gcode
   $30=24000   ; Set to actual max RPM
   ```

2. **Check VFD Settings**
   - Ensure VFD frequency range matches

### Spindle Runs Backwards

**Solution:**
- Swap any two motor wires (VFD to spindle)
- Or use M4 instead of M3

---

## Probe Problems

### Probe Not Detected

**Symptoms:**
- G38.2 runs until crash
- Probe status never shows triggered

**Solutions:**

1. **Check Wiring**
   - Probe on PB6 (Z-Probe Left header)
   - GND connection required

2. **Check Inversion**
   ```gcode
   $6=0    ; Normal (NO probe)
   $6=1    ; Inverted (NC probe)
   ```

3. **Test Manually**
   - Short probe pins and check `?` status

### Probe Already Triggered

**Symptoms:**
- Error before probing starts
- "Probe initial state" alarm

**Solutions:**

1. **Check for Short Circuit**
2. **Verify $6 Setting**
3. **Check Probe Wiring**

---

## Alarm Codes

### Quick Reference

| Alarm | Message | Solution |
|-------|---------|----------|
| 1 | Hard limit | Check limit switches, `$X` to clear |
| 2 | Soft limit | Move inside work envelope |
| 3 | Abort during cycle | Reset and restart |
| 4 | Probe fail | Check probe wiring |
| 5 | Probe initial state | Probe already triggered |
| 6 | Homing fail - reset | Move off limit, home again |
| 7 | Homing fail - door | Close safety door |
| 8 | Homing fail - pulloff | Increase $27 |
| 9 | Homing fail - switch | Check limit switch wiring |

### Clearing Alarms

```gcode
$X      ; Unlock after alarm
<ctrl+x> ; Soft reset
```

### Disabling Alarms (Testing Only!)

```gcode
$21=0   ; Disable hard limits (DANGEROUS!)
$20=0   ; Disable soft limits
```

⚠️ **Warning:** Only disable for testing. Re-enable for safety!

---

## Firmware & Flashing

### Entering DFU Mode

1. Power off board
2. Move BOOT0 jumper to 3.3V position
3. Power on board
4. Flash firmware
5. Move BOOT0 back to GND position
6. Power cycle

### Flash Fails - "No DFU device"

**Solutions:**

1. **Install STM32 DFU Drivers**
   - Use Zadig to install WinUSB driver
   
2. **Check BOOT0 Jumper**
   - Must be on 3.3V side
   
3. **Use STM32CubeProgrammer**
   - More reliable than dfu-util

### Wrong Firmware Flashed

**Symptoms:**
- Board doesn't respond
- Wrong pinouts
- Features missing

**Solution:**
1. Reflash with correct firmware:
   - F429 → Use F429 firmware
   - F446 → Use F446 firmware
   - V1.0 → Use V1.0 map
   - V1.1 → Use V1.1 map

---

## Diagnostic Commands

### Check Everything

```gcode
$$      ; All settings
$I      ; Firmware info
$#      ; Coordinate offsets
$G      ; Parser state
?       ; Real-time status (shows limits, probe, pins)
```

### Real-Time Status Interpretation

```
<Idle|MPos:0.000,0.000,0.000|Pn:XYZ|WCO:0.000,0.000,0.000>
       │                          │
       │                          └── Pins active (limits)
       └── Machine position

Pn: shows which pins are active
X = X limit
Y = Y limit  
Z = Z limit
P = Probe
H = Hold (pause button)
D = Door
R = Reset
```

---

## Getting Help

1. **grblHAL Wiki**: https://github.com/grblHAL/core/wiki
2. **Discord**: grblHAL community
3. **GitHub Issues**: Report bugs with full details

When asking for help, provide:
- Output of `$$` (all settings)
- Output of `$I` (firmware version)
- Exact error message or alarm code
- Description of what you're trying to do
