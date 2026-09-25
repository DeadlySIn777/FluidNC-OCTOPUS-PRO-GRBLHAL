#!/usr/bin/env python3
"""Deep dive into why current settings fail"""

import serial
import time

p = serial.Serial('COM5', 115200, timeout=1)
time.sleep(1.5)
p.write(b'\x18')
time.sleep(2)
startup = p.read(p.in_waiting).decode(errors='ignore')
print("STARTUP:")
print(startup[:800])

p.write(b'$X\n')
time.sleep(0.5)
p.read(p.in_waiting)

# Read ALL settings in range $140-$180
print("\n" + "="*60)
print("Checking motor-related settings ($140-$180)...")
print("="*60)
p.write(b'$$\n')
time.sleep(2)
settings = p.read(p.in_waiting).decode(errors='ignore')
for line in settings.split('\n'):
    try:
        num = int(line.split('=')[0].replace('$',''))
        if 140 <= num <= 180:
            print(' ', line.strip())
    except:
        pass

# Check the ALARM state
print("\nStatus check:")
p.write(b'?')
time.sleep(0.3)
status = p.read(p.in_waiting).decode(errors='ignore')
print(status)

# Try to change settings AFTER clearing alarm properly
print("\n" + "="*60)
print("Trying to set $140 AFTER fully clearing alarm...")
print("="*60)

# Multiple unlocks
for i in range(5):
    p.write(b'$X\n')
    time.sleep(0.2)
p.read(p.in_waiting)

# Check status again
p.write(b'?')
time.sleep(0.3)
status = p.read(p.in_waiting).decode(errors='ignore')
print(f"Status after unlock: {status.strip()}")

# Now try to set
print("Setting $140=1500:")
p.write(b'$140=1500\n')
time.sleep(0.3)
result = p.read(p.in_waiting).decode(errors='ignore')
print(f"  Result: {result.strip()}")

# Read back
p.write(b'$140\n')
time.sleep(0.3)
val = p.read(p.in_waiting).decode(errors='ignore')
print(f"  Read back: {val.strip()}")

# Try $help to see available commands
print("\n" + "="*60)
print("Checking $HELP for Trinamic commands...")
print("="*60)
p.write(b'$HELP\n')
time.sleep(1)
help_text = p.read(p.in_waiting).decode(errors='ignore')
for line in help_text.split('\n'):
    if any(x in line.lower() for x in ['trinamic', 'tmc', 'motor', 'current', '140']):
        print(line)
if 'error' in help_text.lower():
    print("(no extended help available)")

p.close()

print("\n" + "="*60)
print("CONCLUSION:")
print("If $140=1500 returned error:2 (out of range), the firmware")
print("might have a FIXED current setting or need different config.")
print("="*60)
