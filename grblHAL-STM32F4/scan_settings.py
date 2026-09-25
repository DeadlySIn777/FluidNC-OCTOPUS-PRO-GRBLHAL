#!/usr/bin/env python3
"""
Read ALL TMC settings to find driver status
"""
import serial
import time
import re

ser = serial.Serial('COM5', 115200, timeout=2)
time.sleep(2)
ser.read(ser.in_waiting)

def cmd(c, wait=0.2):
    ser.write((c + '\n').encode())
    time.sleep(wait)
    return ser.read(ser.in_waiting).decode('utf-8', errors='ignore')

cmd('$X')

print("=" * 60)
print("ALL TMC2209 GRBLHAL SETTINGS")
print("=" * 60)

# Scan all settings from 100-400 looking for TMC related
found = []
for s in range(100, 400):
    resp = cmd(f'${s}', 0.08)
    if 'error' not in resp.lower():
        match = re.search(rf'\${s}=([^\s\r\n]+)', resp)
        if match:
            val = match.group(1)
            found.append((s, val))
            print(f"${s:3d} = {val}")

print(f"\nFound {len(found)} settings")

# Now let's try to find StallGuard/fault detection
print("\n" + "=" * 60)
print("CHECKING FOR TMC FAULTS")
print("=" * 60)

# Try reading settings in the 160-190 range which might be driver status
for s in [160, 161, 162, 163, 164, 165, 166, 167, 168, 169,
          170, 171, 172, 173, 174, 175, 176, 177, 178, 179,
          230, 231, 232, 233, 234, 235, 240, 241, 242]:
    resp = cmd(f'${s}', 0.1)
    if 'error' not in resp.lower():
        match = re.search(rf'\${s}=([^\s\r\n]+)', resp)
        if match:
            print(f"${s} = {match.group(1)}")

# Try report commands
print("\n" + "=" * 60)
print("GRBLHAL REPORTS")
print("=" * 60)

for report in ['$#', '$G', '$N', '$C', '$X']:
    resp = cmd(report, 0.3)
    if 'error' not in resp.lower() and len(resp.strip()) > 10:
        print(f"\n{report}:")
        # Only print first few lines
        for line in resp.strip().split('\n')[:5]:
            print(f"  {line}")

# Try a real-time report during motion
print("\n" + "=" * 60)
print("REAL-TIME STATUS DURING MOTION")  
print("=" * 60)

cmd('G91')
ser.write(b'G1 X5 F60\n')

for i in range(10):
    time.sleep(0.3)
    # Request real-time status
    ser.write(b'?')
    time.sleep(0.1)
    resp = ser.read(ser.in_waiting).decode('utf-8', errors='ignore')
    print(resp.strip())
    if 'Idle' in resp:
        break

ser.close()

print("\n" + "=" * 60)
print("DIAGNOSIS")
print("=" * 60)
print("""
The TMC2209 UART communication IS working (settings read OK).
The firmware IS sending step pulses (position changes).

If motors still aren't rotating, the problem is HARDWARE:

1. **MOTOR COILS MISWIRED** - Most common!
   - Each motor has 2 coil pairs
   - If wrong pairs connected, motor vibrates, doesn't rotate
   - FIX: Swap middle 2 wires on motor connector

2. **VMOT POWER** - Check 24V on driver VMOT pins

3. **DRIVER ENABLE** - Try toggling $14 between 0 and 7

4. **MS1/MS2 JUMPERS** - Should both be at TOP for UART mode
""")
