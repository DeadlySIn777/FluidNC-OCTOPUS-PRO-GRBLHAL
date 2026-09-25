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
    ser.write((cmd + '\n').encode())
    time.sleep(wait)
    while ser.in_waiting:
        line = ser.readline().decode('utf-8', errors='ignore').strip()
        if line:
            print(f"  {line}")

print("=== SLOW MOTOR TEST ===")
print("Testing at LOW speed and LOW acceleration")
print()

send('$X')  # Unlock
send('G21')  # Metric
send('G91')  # Relative

# Lower acceleration temporarily
print("Setting low acceleration (100 mm/s^2)...")
send('$120=100')
send('$121=100')
send('$122=100')

print()
print("Testing X axis - 50mm at 500mm/min...")
send('G1 X50 F500', 8)
send('G1 X-50 F500', 8)

print()
print("Testing Y axis - 50mm at 500mm/min...")
send('G1 Y50 F500', 8)
send('G1 Y-50 F500', 8)

print()
print("Testing Z axis - 50mm at 300mm/min...")
send('G1 Z50 F300', 12)
send('G1 Z-50 F300', 12)

# Restore acceleration
print()
print("Restoring acceleration (500 mm/s^2)...")
send('$120=500')
send('$121=500')
send('$122=400')

ser.close()
print()
print("=== TEST COMPLETE ===")
print("Did the motors run smooth at slow speed?")
print("If yes = acceleration was too high")
print("If still vibrating = wiring or driver issue")
