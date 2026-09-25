#!/usr/bin/env python3
"""Check spindle/VFD settings"""
import serial
import time

PORT = 'COM5'
BAUD = 115200

ser = serial.Serial(PORT, BAUD, timeout=2)

# Soft reset
ser.write(b'\x18')
time.sleep(0.5)
ser.read_all()

# Get all settings
ser.write(b'$$\n')
time.sleep(3)
data = ser.read_all().decode('utf-8', 'ignore')
ser.close()

print("=== Spindle/VFD Related Settings ===\n")

for line in data.split('\n'):
    line = line.strip()
    if '=' in line and line.startswith('$'):
        try:
            num = int(line.split('=')[0].replace('$',''))
            # Spindle/VFD settings are typically:
            # $30-36: spindle
            # $300-360: extended spindle/VFD
            # $395-400: VFD specific
            # $9: report spindle
            if (9 <= num <= 9) or (30 <= num <= 36) or (300 <= num <= 400):
                print(line)
        except:
            pass

print("\n=== Trying to find VFD enable setting ===")
# Try some known VFD disable commands
ser2 = serial.Serial(PORT, BAUD, timeout=2)
ser2.write(b'\x18')
time.sleep(0.5)
ser2.read_all()

# Common VFD settings
tests = [
    "$395",  # VFD type
    "$396",  # VFD modbus address
    "$397",  # VFD RPM scale
    "$398",  # VFD speed tolerance
    "$399",  # VFD spindle RPM
]

for t in tests:
    ser2.write(f"{t}\n".encode())
    time.sleep(0.2)
    resp = ser2.read_all().decode('utf-8', 'ignore').strip()
    if "error" not in resp.lower():
        print(f"{t} -> {resp}")

ser2.close()
