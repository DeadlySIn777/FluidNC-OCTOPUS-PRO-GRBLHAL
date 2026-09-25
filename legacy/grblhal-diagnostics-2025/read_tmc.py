#!/usr/bin/env python3
"""Read TMC settings from grblHAL"""
import serial
import time

PORT = "COM5"
BAUD = 115200

ser = serial.Serial(PORT, BAUD, timeout=2)
time.sleep(1)
ser.reset_input_buffer()
ser.write(b'$X\n')
time.sleep(0.2)
ser.read(ser.in_waiting)

print('=== Extended Trinamic Settings ===')
for s in range(338, 370):
    ser.write(f'${s}\n'.encode())
    time.sleep(0.1)
    resp = ser.read(ser.in_waiting).decode('utf-8', errors='ignore').strip()
    if 'error' not in resp.lower() and '=' in resp:
        # Just the first line
        print(resp.split('\n')[0])

print()
print('=== Motor Current Settings ===')
for s in [140, 141, 142, 143, 144, 145]:
    ser.write(f'${s}\n'.encode())
    time.sleep(0.1)
    resp = ser.read(ser.in_waiting).decode('utf-8', errors='ignore').strip()
    if 'error' not in resp.lower() and '=' in resp:
        print(resp.split('\n')[0])

print()
print('=== Looking for microstep settings ===')
# Usually $160-$162 or similar for microsteps
for s in range(160, 180):
    ser.write(f'${s}\n'.encode())
    time.sleep(0.1)
    resp = ser.read(ser.in_waiting).decode('utf-8', errors='ignore').strip()
    if 'error' not in resp.lower() and '=' in resp:
        print(resp.split('\n')[0])

ser.close()
print('Done')
