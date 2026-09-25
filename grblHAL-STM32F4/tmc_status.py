#!/usr/bin/env python3
"""
Read TMC2209 DRV_STATUS register to check for faults
"""
import serial
import time

ser = serial.Serial('COM5', 115200, timeout=2)
time.sleep(2)
ser.read(ser.in_waiting)

def cmd(c, wait=0.3):
    ser.write((c + '\n').encode())
    time.sleep(wait)
    return ser.read(ser.in_waiting).decode('utf-8', errors='ignore')

# Unlock
cmd('$X')

print("=" * 60)
print("TMC2209 DRIVER STATUS CHECK")
print("=" * 60)

# grblHAL with TRINAMIC_DEV=1 adds $2xx debug settings
# Let's try to find them
print("\n[1] LOOKING FOR TMC DEBUG SETTINGS")
for s in range(200, 250):
    resp = cmd(f'${s}', 0.1)
    if 'error' not in resp.lower() and f'${s}=' in resp:
        val = resp.split('=')[1].split()[0] if '=' in resp else '?'
        print(f"    ${s} = {val}")

# Try special TMC commands
print("\n[2] SPECIAL TMC COMMANDS")
for c in ['$tmc', '$TMC', '$trinamic', '$TRINAMIC', '$driver', '$DRIVER']:
    resp = cmd(c, 0.2)
    if 'error' not in resp.lower():
        print(f"    {c}: {resp.strip()[:60]}")

# Check StallGuard and driver status via grblHAL settings
print("\n[3] TMC DRIVER CONFIGURATION")
# These are the typical grblHAL TMC settings
settings = {
    '$140': 'X motor current (mA)',
    '$141': 'Y motor current (mA)', 
    '$142': 'Z motor current (mA)',
    '$150': 'X microsteps',
    '$151': 'Y microsteps',
    '$152': 'Z microsteps',
    '$338': 'Trinamic driver enable mask',
    '$14': 'Stepper enable invert mask',
}

for s, desc in settings.items():
    resp = cmd(s, 0.15)
    if '=' in resp:
        val = resp.split('=')[1].split()[0]
        print(f"    {s} = {val:>6}  ({desc})")

# Movement test with real-time status
print("\n[4] MOVEMENT TEST - WATCH MOTORS!")
print("    Setting up slow move: 10mm at 30mm/min (20 seconds)")

cmd('G91')  # Relative
cmd('$X')   # Unlock

# Start the move
ser.write(b'G1 X10 F30\n')
time.sleep(0.1)

print("    Monitor:")
prev_pos = None
stuck_count = 0
for i in range(40):  # 20 seconds at 0.5s intervals
    time.sleep(0.5)
    resp = cmd('?', 0.1)
    if 'MPos' in resp:
        import re
        m = re.search(r'MPos:([\d.-]+)', resp)
        if m:
            pos = float(m.group(1))
            state = 'RUN' if 'Run' in resp else 'IDLE'
            
            if prev_pos is not None:
                delta = pos - prev_pos
                if abs(delta) < 0.001:
                    stuck_count += 1
                    if stuck_count > 3:
                        print(f"      {state} pos={pos:.3f} STUCK - position not changing!")
                else:
                    stuck_count = 0
                    print(f"      {state} pos={pos:.3f} delta={delta:.3f}mm")
            else:
                print(f"      {state} pos={pos:.3f}")
            prev_pos = pos
            
    if 'Idle' in resp:
        print("    Move complete")
        break

print("\n" + "=" * 60)
print("ANALYSIS:")
print("=" * 60)
print("""
If UART shows current=2000mA and microsteps=16 but motor won't spin:

1. **MOTOR COIL WIRING** (Most likely!)
   - Stepper motors have 2 coil pairs: A+/A- and B+/B-
   - If wires from different coils are paired, motor vibrates
   - Solution: Measure resistance between wire pairs
     * Wires in same coil: ~1-10 ohms
     * Wires in different coils: infinite/open
   - Or try swapping the middle 2 wires

2. **VMOT NOT CONNECTED**
   - 24V power must be on VMOT terminals
   - Check with multimeter

3. **DRIVER IN WRONG SOCKET**
   - TMC2209 must match socket orientation
   - EN pin must align with EN on board

4. **ENABLE PIN ACTIVE HIGH vs LOW**
   - Check $14 setting (stepper enable invert)
   - Try: $14=0 or $14=7
""")

ser.close()
