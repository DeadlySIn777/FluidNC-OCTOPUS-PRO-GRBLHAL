#!/usr/bin/env python3
"""Test motor movement after TMC UART fix"""
import serial
import time
import re

# Try different ports
for port in ['COM5', 'COM4', 'COM3']:
    try:
        ser = serial.Serial(port, 115200, timeout=2)
        print(f"Connected on {port}")
        break
    except:
        continue
else:
    print("Could not connect to any port!")
    exit(1)

time.sleep(2)
ser.read(ser.in_waiting)

def cmd(c, wait=0.3):
    ser.write((c + '\n').encode())
    time.sleep(wait)
    return ser.read(ser.in_waiting).decode('utf-8', errors='ignore')

# Reset and unlock
ser.write(b'\x18')
time.sleep(1)
ser.read(ser.in_waiting)
cmd('$X')

print("=" * 50)
print("MOTOR MOVEMENT TEST - TMC UART FIXED!")
print("=" * 50)

# Check status
resp = cmd('?')
print(f"Status: {resp.strip()[:60]}")

# Set relative mode
cmd('G91')

print("\n*** WATCH THE X MOTOR! ***")
print("Moving X 20mm at 300mm/min...")

ser.write(b'G1 X20 F300\n')
time.sleep(0.2)

for i in range(20):
    time.sleep(0.5)
    ser.write(b'?')
    time.sleep(0.1)
    resp = ser.read(ser.in_waiting).decode('utf-8', errors='ignore')
    m = re.search(r'<(\w+)\|MPos:([\d.-]+),([\d.-]+),([\d.-]+)', resp)
    if m:
        state, x, y, z = m.groups()
        print(f"  {state}: X={x} Y={y} Z={z}")
        if state == 'Idle':
            break
        if state == 'Alarm':
            print("  Hit alarm - unlocking...")
            cmd('$X')

print("\n*** DID THE MOTOR SPIN? ***")
print("If YES - SUCCESS! TMC UART is working!")
print("If NO - Check motor wiring (swap middle 2 wires)")

ser.close()
