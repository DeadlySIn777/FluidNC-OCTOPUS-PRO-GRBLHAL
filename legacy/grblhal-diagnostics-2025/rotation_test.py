#!/usr/bin/env python3
"""Quick motor rotation test"""

import serial
import time

ser = serial.Serial('COM5', 115200, timeout=1)
time.sleep(1)
ser.reset_input_buffer()

def cmd(c, wait=0.2):
    ser.write((c + '\n').encode())
    time.sleep(wait)
    return ser.read(ser.in_waiting).decode('utf-8', errors='ignore').strip()

print("=== Motor Rotation Test ===")
print("Current settings:")
print(f"  Current X: {cmd('$140')}")
print(f"  Current Y: {cmd('$141')}")  
print(f"  Current Z: {cmd('$142')}")
print(f"  Microsteps: {cmd('$150')}, {cmd('$151')}, {cmd('$152')}")
print(f"  Steps/mm: {cmd('$100')}, {cmd('$101')}, {cmd('$102')}")

# Unlock
print("\nUnlocking...")
cmd('$X')

# Set to relative mode
cmd('G91')

print("\n=== SLOW ROTATION TEST ===")
print("Moving X motor 10mm at 60mm/min (10 seconds)")
print("WATCH THE MOTOR - it should ROTATE, not just vibrate")
print()

# Send move command
cmd('G1 X10 F60')

# Monitor for 12 seconds
start = time.time()
while time.time() - start < 12:
    resp = cmd('?', 0.1)
    if 'MPos' in resp:
        # Extract position
        import re
        m = re.search(r'MPos:([^|]+)', resp)
        if m:
            pos = m.group(1)
            state = 'Run' if 'Run' in resp else 'Idle' if 'Idle' in resp else '?'
            print(f"  {state}: {pos}", end='\r')
    if 'Idle' in resp:
        break
    time.sleep(0.5)

print("\n")
resp = cmd('?')
print(f"Final: {resp}")

ser.close()
print("\nDone! Did the motor shaft physically rotate?")
