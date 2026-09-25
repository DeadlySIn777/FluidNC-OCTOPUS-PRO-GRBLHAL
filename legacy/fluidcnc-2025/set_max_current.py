import serial
import serial.tools.list_ports
import time

ports = list(serial.tools.list_ports.comports())
port = ports[0].device if ports else None
if not port:
    print("No serial port found")
    exit()

print(f"Connecting to {port}...")
ser = serial.Serial(port, 115200, timeout=1)
time.sleep(0.5)

# Soft reset first
print("Resetting controller...")
ser.write(b'\x18')
time.sleep(2)
ser.reset_input_buffer()

# Drain welcome message
while ser.in_waiting:
    ser.readline()

def send(cmd, wait=0.5):
    print(f">> {cmd}", end=" ")
    ser.write((cmd + '\n').encode())
    time.sleep(wait)
    result = ""
    while ser.in_waiting:
        line = ser.readline().decode('utf-8', errors='ignore').strip()
        if line:
            result = line
    print(f"[{result}]" if result else "")
    return "ok" in result.lower() or result.startswith('$')

print()
print("=== SETTING MAX CURRENT (2000mA) ===")
send('$X')

# Set current to max 2000mA
send('$140=2000')
send('$141=2000')
send('$142=2000')

# Verify
print()
print("Verifying settings...")
ser.write(b'$140\n')
time.sleep(0.3)
ser.write(b'$141\n')
time.sleep(0.3)
ser.write(b'$142\n')
time.sleep(0.5)
while ser.in_waiting:
    line = ser.readline().decode('utf-8', errors='ignore').strip()
    if line and line.startswith('$14'):
        print(f"  {line}")

print()
print("=== MOTOR TEST AT 2.0A ===")
send('G21')
send('G91')

print()
print("X axis - 200mm at 2000mm/min...")
send('G1 X200 F2000', 8)
send('G1 X-200 F2000', 8)

print()
print("Y axis - 200mm at 2000mm/min...")  
send('G1 Y200 F2000', 8)
send('G1 Y-200 F2000', 8)

print()
print("Z axis - 200mm at 1000mm/min...")
send('G1 Z200 F1000', 15)
send('G1 Z-200 F1000', 15)

ser.close()
print()
print("=== COMPLETE ===")
print("With motors under load (attached to screws),")
print("the vibration should go away.")
print()
print("If still bad, consider TMC5160 upgrade (3A capable)")
