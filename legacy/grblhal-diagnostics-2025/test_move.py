#!/usr/bin/env python3
"""Test movement - move away from limit switch"""
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
print("Unlock:", ser.read(ser.in_waiting).decode('utf-8', errors='ignore').strip())

# Check status
ser.write(b'?\n')
time.sleep(0.2)
status = ser.read(ser.in_waiting).decode('utf-8', errors='ignore').strip()
print(f"Status: {status}")

# Check if X limit is triggered
if 'Pn' in status and 'X' in status:
    print("\nX limit switch is triggered! Moving NEGATIVE direction...")
    direction = -10
else:
    print("\nNo limit triggered, trying positive direction...")
    direction = 10

# Move in relative mode AWAY from limit if triggered
ser.write(b'G91\n')
time.sleep(0.1)
ser.read(ser.in_waiting)

print(f"\nSending: G1 X{direction} F300")
ser.write(f'G1 X{direction} F300\n'.encode())
time.sleep(0.2)

# Monitor
for i in range(15):
    time.sleep(0.5)
    ser.write(b'?\n')
    time.sleep(0.1)
    status = ser.read(ser.in_waiting).decode('utf-8', errors='ignore').strip()
    print(f"  {status}")
    if 'Idle' in status:
        print("\nMove completed!")
        break
    if 'Alarm' in status:
        print("\nHit alarm - need to unlock")
        ser.write(b'$X\n')
        time.sleep(0.2)
        ser.read(ser.in_waiting)

ser.close()
