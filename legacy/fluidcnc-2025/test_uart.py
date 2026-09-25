import serial
import serial.tools.list_ports
import time

# Find the Octopus Pro (usually CP210x or STM)
ports = list(serial.tools.list_ports.comports())
port = None
for p in ports:
    if 'cp210' in p.description.lower() or 'stm' in p.description.lower() or 'ch340' in p.description.lower():
        port = p.device
        break
if not port and ports:
    port = ports[0].device

print(f"Connecting to {port}...")
ser = serial.Serial(port, 115200, timeout=1)
time.sleep(2)
ser.reset_input_buffer()

print("=== STARTUP MESSAGES ===")
while ser.in_waiting:
    print(ser.readline().decode('utf-8', errors='ignore').strip())

def send(cmd, wait=0.5):
    print(f"\n>> {cmd}")
    ser.write((cmd + '\n').encode())
    time.sleep(wait)
    while ser.in_waiting:
        line = ser.readline().decode('utf-8', errors='ignore').strip()
        if line:
            print(f"   {line}")

# Unlock and get info
send('$X')
send('$I')

print("\n" + "="*60)
print("=== TMC2209 UART TEST ===")
print("="*60)

# Test motor current settings
print("\n--- Motor Current Settings ---")
send('$140')
send('$141')
send('$142')

# Test changing current (should work now!)
print("\n--- Testing Current Change ---")
send('$140=2000')
send('$141=2000')  
send('$142=2000')

# Verify change
print("\n--- Verifying New Values ---")
send('$140')
send('$141')
send('$142')

# Check microsteps
print("\n--- Microstep Settings ---")
send('$150')
send('$151')
send('$152')

# Check hybrid threshold
print("\n--- Hybrid Threshold (StealthChop/SpreadCycle) ---")
send('$160')
send('$161')
send('$162')

# Check StallGuard settings
print("\n--- StallGuard/Sensorless Settings ---")
send('$200')
send('$338')
send('$339')

# Check hold current
print("\n--- Hold Current % ---")
send('$210')
send('$211')
send('$212')

# Try M122 for driver debug
print("\n--- Driver Debug (M122) ---")
send('M122', 1.0)

ser.close()
print("\n" + "="*60)
print("=== TEST COMPLETE ===")
print("="*60)
