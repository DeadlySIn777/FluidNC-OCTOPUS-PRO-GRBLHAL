#!/usr/bin/env python3
"""Full diagnostic - check all settings and test motors"""
import serial
import time

PORT = "COM5"
BAUD = 115200

ser = serial.Serial(PORT, BAUD, timeout=2)
time.sleep(1)
ser.reset_input_buffer()

# Reset/check state
ser.write(b'\x18')  # Ctrl-X reset
time.sleep(0.5)
print("Reset output:", ser.read(ser.in_waiting).decode('utf-8', errors='ignore'))

# Unlock
ser.write(b'$X\n')
time.sleep(0.3)
print("Unlock:", ser.read(ser.in_waiting).decode('utf-8', errors='ignore').strip())

# Get full $$ settings dump
ser.write(b'$$\n')
time.sleep(0.5)
settings = ser.read(ser.in_waiting).decode('utf-8', errors='ignore')
print("\n=== All Settings ===")
print(settings)

# Get $I info
ser.write(b'$I\n')
time.sleep(0.3)
print("\n=== Build Info ===")
print(ser.read(ser.in_waiting).decode('utf-8', errors='ignore'))

# Status
ser.write(b'?\n')
time.sleep(0.2)
status = ser.read(ser.in_waiting).decode('utf-8', errors='ignore').strip()
print(f"\nStatus: {status}")

# Let's try a VERY BIG move to confirm microstepping issue
print("\n=== Testing with G1 X10 F100 (10mm move) ===")
ser.write(b'?\n')
time.sleep(0.1)
start = ser.read(ser.in_waiting).decode('utf-8', errors='ignore')
print(f"Start: {start.strip()}")

ser.write(b'G91\n')  # Relative mode
time.sleep(0.1)
ser.read(ser.in_waiting)

ser.write(b'G1 X10 F100\n')  # Move 10mm
time.sleep(0.2)
print("Move sent...")

# Monitor for 10 seconds
for i in range(20):
    time.sleep(0.5)
    ser.write(b'?\n')
    time.sleep(0.1)
    status = ser.read(ser.in_waiting).decode('utf-8', errors='ignore').strip()
    print(f"  {status}")
    if 'Idle' in status:
        break

ser.close()
print("Done")
