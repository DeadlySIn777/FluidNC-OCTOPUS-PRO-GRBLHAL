#!/usr/bin/env python3
"""Direct TMC2209 register test via grblHAL"""

import serial
import time

ser = serial.Serial('COM5', 115200, timeout=1)
time.sleep(1)
ser.reset_input_buffer()

def cmd(c, wait=0.3):
    ser.write((c + '\n').encode())
    time.sleep(wait)
    return ser.read(ser.in_waiting).decode('utf-8', errors='ignore').strip()

print("=== Unlocking and Testing ===")
cmd('$X')

print("=== Full grblHAL Info ===")
print(cmd('$I', 0.5))

print("\n=== Pin Report ===")
pins = cmd('$pins', 1.0)
# Show UART and Motor related lines
for line in pins.split('\n'):
    l = line.lower()
    if 'uart' in l or 'motor' in l or 'step' in l or 'dir' in l or 'enable' in l:
        print(line)

print("\n=== Test: Try moving with VERY SLOW speed ===")
print("This uses 10mm/min - you should be able to see individual steps")
cmd('G91')  # Relative
cmd('G1 X2 F10')  # 10mm/min = ~267 steps/sec at 16 microsteps + 400 steps/mm

print("\nWatching position for 15 seconds...")
start = time.time()
last_pos = None
while time.time() - start < 15:
    resp = cmd('?', 0.1)
    if 'MPos' in resp:
        import re
        m = re.search(r'MPos:([\d.-]+)', resp)
        if m:
            pos = float(m.group(1))
            if last_pos is None or abs(pos - last_pos) > 0.01:
                state = 'Run' if 'Run' in resp else 'Idle'
                print(f"  [{state}] X = {pos:.3f}mm")
                last_pos = pos
    if 'Idle' in resp:
        break
    time.sleep(0.2)

print("\n=== Setting lower current to test ===")
# Try reducing current to 500mA to see if it changes behavior
print(f"Current before: X={cmd('$140')}")
cmd('$140=500')
print(f"Current after: X={cmd('$140')}")

# Small move
print("\nMoving 1mm at reduced current...")
cmd('G1 X1 F60')
time.sleep(3)

# Restore current
cmd('$140=2000')
print(f"Current restored: X={cmd('$140')}")

ser.close()
print("\nDone!")
