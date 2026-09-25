#!/usr/bin/env python3
"""Test all 3 axes with larger movements"""
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

ser.write(b'G91\n')  # Relative mode
time.sleep(0.1)
ser.read(ser.in_waiting)

print("\n=== WATCH THE MOTORS! ===")
print("Each axis will move 20mm at 300mm/min\n")

for axis in ['X', 'Y', 'Z']:
    input(f"Press ENTER to move {axis} axis 20mm...")
    
    ser.write(f'G1 {axis}20 F300\n'.encode())
    time.sleep(0.2)
    
    print(f"Moving {axis}...")
    for i in range(20):
        time.sleep(0.4)
        ser.write(b'?\n')
        time.sleep(0.1)
        status = ser.read(ser.in_waiting).decode('utf-8', errors='ignore').strip()
        # Extract position
        if 'MPos' in status:
            pos_part = status.split('MPos:')[1].split('|')[0]
            print(f"  Position: {pos_part}")
        if 'Idle' in status:
            print(f"{axis} move completed!\n")
            break
        if 'Alarm' in status:
            print(f"ALARM on {axis}! Unlocking...")
            ser.write(b'$X\n')
            time.sleep(0.2)
            ser.read(ser.in_waiting)
            break

print("\n=== Moving all axes back (negative direction) ===")
input("Press ENTER to move X, Y, Z each -20mm...")

ser.write(b'G1 X-20 Y-20 Z-20 F300\n')
time.sleep(0.2)

for i in range(30):
    time.sleep(0.5)
    ser.write(b'?\n')
    time.sleep(0.1)
    status = ser.read(ser.in_waiting).decode('utf-8', errors='ignore').strip()
    if 'MPos' in status:
        pos_part = status.split('MPos:')[1].split('|')[0]
        print(f"  Position: {pos_part}")
    if 'Idle' in status:
        print("All moves completed!")
        break
    if 'Alarm' in status:
        print("Hit limit switch during return move")
        break

ser.close()
print("\nDone!")
