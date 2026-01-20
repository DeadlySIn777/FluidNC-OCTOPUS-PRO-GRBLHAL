import serial
import serial.tools.list_ports
import time

port = list(serial.tools.list_ports.comports())[0].device
print(f"Connecting to {port}...")
ser = serial.Serial(port, 115200, timeout=1)

# Reset
ser.dtr = False
time.sleep(0.1)
ser.dtr = True
time.sleep(3)
ser.reset_input_buffer()

# Disable homing/limits, unlock
ser.write(b'$22=0\n')
time.sleep(0.2)
ser.write(b'$21=0\n')
time.sleep(0.2)
ser.write(b'$X\n')
time.sleep(0.3)
ser.reset_input_buffer()

# Get all settings
ser.write(b'$$\n')
time.sleep(2)

print("=== MOTOR/TMC SETTINGS ===")
all_settings = []
while ser.in_waiting:
    line = ser.readline().decode('utf-8', errors='ignore').strip()
    if line.startswith('$'):
        all_settings.append(line)
        # Show settings 140-170 (motor current, microsteps, etc)
        try:
            num = int(line.split('=')[0][1:])
            if 100 <= num <= 175:
                print(line)
        except:
            pass

print()
print(f"Total settings in firmware: {len(all_settings)}")

# Check $140 range
print()
print("=== TESTING $140 RANGE ===")
ser.reset_input_buffer()
for val in [500, 1000, 1500, 1600, 1700, 2000]:
    ser.write(f'$140={val}\n'.encode())
    time.sleep(0.2)
    result = ""
    while ser.in_waiting:
        result += ser.readline().decode('utf-8', errors='ignore').strip()
    status = "OK" if "ok" in result else f"FAIL ({result})"
    print(f"  $140={val}: {status}")

# Read current value
ser.write(b'$140\n')
time.sleep(0.2)
print()
print("Current $140 value:")
while ser.in_waiting:
    print("  " + ser.readline().decode('utf-8', errors='ignore').strip())

ser.close()
