import serial
import time

ser = serial.Serial('COM5', 115200, timeout=2)
time.sleep(2)
ser.read(ser.in_waiting)

# Soft reset
ser.write(b'\x18')
time.sleep(1)
ser.read(ser.in_waiting)

# Unlock
ser.write(b'$X\n')
time.sleep(0.3)
ser.read(ser.in_waiting)

# Get info
ser.write(b'$I\n')
time.sleep(0.5)
resp = ser.read(ser.in_waiting).decode('utf-8', errors='ignore')
print("=== Firmware Info ===")
print(resp)

# Check for Trinamic
if 'Trinamic' in resp:
    print("\n✓ TRINAMIC PLUGIN IS LOADED!")
else:
    print("\n✗ TRINAMIC PLUGIN NOT IN OUTPUT!")

# Try the actual trinamic settings
print("\n=== Testing TMC Settings ===")
for cmd in ['$140', '$141', '$142', '$150', '$151', '$152']:
    ser.write((cmd + '\n').encode())
    time.sleep(0.2)
    r = ser.read(ser.in_waiting).decode('utf-8', errors='ignore').strip()
    if 'error' in r.lower():
        print(f"{cmd}: ERROR - TMC UART NOT WORKING")
    else:
        print(f"{cmd}: {r}")

ser.close()
