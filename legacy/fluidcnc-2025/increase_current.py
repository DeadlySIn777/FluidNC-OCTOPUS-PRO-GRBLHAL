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
time.sleep(2)
ser.reset_input_buffer()

def send(cmd, wait=0.3):
    print(f">> {cmd}")
    ser.write((cmd + '\n').encode())
    time.sleep(wait)
    while ser.in_waiting:
        line = ser.readline().decode('utf-8', errors='ignore').strip()
        if line:
            print(f"   {line}")

print("=== INCREASING MOTOR CURRENT ===")
print("Old: 1600mA (1.6A)")
print("New: 2000mA (2.0A)")
print()

send('$X')  # Unlock

# Increase current to 2.0A (2000mA)
send('$140=2000')  # X axis
send('$141=2000')  # Y axis  
send('$142=2000')  # Z axis

print()
print("=== TESTING MOTORS AT 2.0A ===")
print()

send('G21')  # Metric
send('G91')  # Relative

print("Testing X axis - 100mm...")
send('G1 X100 F1000', 8)
send('G1 X-100 F1000', 8)

print()
print("Testing Y axis - 100mm...")
send('G1 Y100 F1000', 8)
send('G1 Y-100 F1000', 8)

print()
print("Testing Z axis - 100mm...")
send('G1 Z100 F600', 12)
send('G1 Z-100 F600', 12)

ser.close()
print()
print("=== DONE ===")
print("Motors now running at 2.0A")
print("Did the vibration stop?")
print()
print("If still vibrating, your motors might need even more current.")
print("Check motor label for rated current (could be 2.5A or 3A)")
