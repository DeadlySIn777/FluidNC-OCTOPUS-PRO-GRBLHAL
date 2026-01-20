import serial
import serial.tools.list_ports
import time

port = list(serial.tools.list_ports.comports())[0].device
print(f"Connecting to {port}...")
ser = serial.Serial(port, 115200, timeout=1)
time.sleep(0.5)
ser.write(b'\x18')  # Reset
time.sleep(2)
ser.reset_input_buffer()

def send(cmd):
    ser.write((cmd + '\n').encode())
    time.sleep(0.3)
    result = []
    while ser.in_waiting:
        line = ser.readline().decode('utf-8', errors='ignore').strip()
        if line:
            result.append(line)
    return result

print("Disabling homing/limits to allow settings change...")
print(send('$22=0'))  # Disable homing
print(send('$21=0'))  # Disable hard limits
print(send('$X'))     # Unlock
print("Status:", send('?'))

print()
print("Setting motor current to 2000mA (2.0A)...")
print("X:", send('$140=2000'))
print("Y:", send('$141=2000'))
print("Z:", send('$142=2000'))

print()
print("Verifying current settings...")
print("X:", send('$140'))
print("Y:", send('$141'))
print("Z:", send('$142'))

print()
print("Re-enabling homing and limits...")
print(send('$22=7'))  # Enable homing for XYZ
print(send('$21=7'))  # Enable hard limits for XYZ

ser.close()
print()
print("=== DONE ===")
