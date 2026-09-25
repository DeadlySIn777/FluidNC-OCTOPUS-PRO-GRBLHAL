#!/usr/bin/env python3
"""Simple slow test - easy to observe motor rotation"""
import serial
import time

PORT = "COM5"
BAUD = 115200

ser = serial.Serial(PORT, BAUD, timeout=2)
time.sleep(1)
ser.reset_input_buffer()

# Unlock
ser.write(b'$X\n')
time.sleep(0.3)
print("Unlocked:", ser.read(ser.in_waiting).decode('utf-8', errors='ignore').strip())

# Get current position
ser.write(b'?\n')
time.sleep(0.2)
status = ser.read(ser.in_waiting).decode('utf-8', errors='ignore').strip()
print(f"Current: {status}")

# Use NEGATIVE direction to move away from the limit
ser.write(b'G91\n')  # Relative
time.sleep(0.1)
ser.read(ser.in_waiting)

print("\n*** WATCH THE X MOTOR ***")
print("Moving X -50mm at 60mm/min (very slow)...")
print("You should see the motor spinning for about 50 seconds\n")

ser.write(b'G1 X-50 F60\n')
time.sleep(0.3)

for i in range(60):
    time.sleep(1)
    ser.write(b'?\n')
    time.sleep(0.1)
    status = ser.read(ser.in_waiting).decode('utf-8', errors='ignore').strip()
    if 'MPos' in status:
        pos = status.split('MPos:')[1].split('|')[0]
        state = status.split('|')[0].replace('<','')
        print(f"[{i+1:2d}s] {state:6s} Position: {pos}")
    if 'Idle' in status:
        print("\nMove completed!")
        break
    if 'Alarm' in status:
        print("\nHit limit - stopping")
        break

ser.close()
print("Done")
