import serial
import serial.tools.list_ports
import time

ports = list(serial.tools.list_ports.comports())
if not ports:
    print("No serial port found")
    exit()

port = ports[0].device
print(f"Connecting to {port}...")
ser = serial.Serial(port, 115200, timeout=1)
time.sleep(2)
ser.reset_input_buffer()

# Unlock
ser.write(b'$X\n')
time.sleep(0.3)
ser.reset_input_buffer()

# Query all settings
ser.write(b'$$\n')
time.sleep(1.5)

print("=== GRBLHAL SETTINGS ===")
while ser.in_waiting:
    line = ser.readline().decode('utf-8', errors='ignore').strip()
    if line and line.startswith('$'):
        print(line)

ser.close()
print("\nDone!")
