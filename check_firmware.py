import serial
import time

ser = serial.Serial('COM6', 115200, timeout=2)
time.sleep(3)  # Wait for boot

# Drain buffer
print("=== STARTUP ===")
while ser.in_waiting:
    print(ser.readline().decode('utf-8', errors='ignore').strip())

# Send soft reset to get welcome message
print("\n=== SOFT RESET ===")
ser.write(b'\x18')  # Ctrl-X reset
time.sleep(2)
while ser.in_waiting:
    print(ser.readline().decode('utf-8', errors='ignore').strip())

# Status query
print("\n=== STATUS QUERY (?) ===")
ser.write(b'?\n')
time.sleep(0.5)
while ser.in_waiting:
    print(ser.readline().decode('utf-8', errors='ignore').strip())

# Try $$ for settings
print("\n=== SETTINGS ($$) ===")
ser.write(b'$$\n')
time.sleep(2)
count = 0
while ser.in_waiting:
    line = ser.readline().decode('utf-8', errors='ignore').strip()
    if line:
        print(line)
        count += 1
print(f"(Received {count} lines)")

ser.close()
