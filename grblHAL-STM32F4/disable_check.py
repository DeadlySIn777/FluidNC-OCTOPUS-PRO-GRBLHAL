import serial
import time
import re

ser = serial.Serial('COM5', 115200, timeout=2)
time.sleep(2)
ser.read(ser.in_waiting)

def cmd(c, wait=0.2):
    ser.write((c + '\n').encode())
    time.sleep(wait)
    return ser.read(ser.in_waiting).decode('utf-8', errors='ignore')

print('=== CHECKING/DISABLING CHECK MODE ===')

# Check current status
resp = cmd('?')
print(f'Current status: {resp.strip()[:60]}')

if 'Check' in resp:
    print('CHECK MODE IS ENABLED - motors not actually moving!')
    print('Disabling check mode...')
    cmd('$C')  # Toggle check mode off
    time.sleep(0.5)
    
# Soft reset to clear check mode
print('Soft resetting...')
ser.write(b'\x18')
time.sleep(1)
ser.read(ser.in_waiting)

# Unlock
print('Unlocking...')
cmd('$X')

# Check status again
resp = cmd('?')
print(f'Status after reset: {resp.strip()[:60]}')

print('\n=== TESTING REAL MOTOR MOVEMENT ===')
cmd('G91')  # Relative mode

print('Sending G1 X10 F60 (10mm at 60mm/min = 10 seconds)')
print('WATCH THE MOTOR!')
print()

ser.write(b'G1 X10 F60\n')
time.sleep(0.1)

prev_pos = None
for i in range(25):
    time.sleep(0.4)
    ser.write(b'?')
    time.sleep(0.1)
    resp = ser.read(ser.in_waiting).decode('utf-8', errors='ignore')
    m = re.search(r'<(\w+)\|MPos:([\d.-]+)', resp)
    if m:
        state = m.group(1)
        pos = float(m.group(2))
        
        if state == 'Check':
            print(f'  ERROR: Still in Check mode! Exiting...')
            break
            
        delta = ''
        if prev_pos is not None:
            d = pos - prev_pos
            delta = f' (delta: {d:+.3f}mm)'
        print(f'  {state}: X={pos:.3f}{delta}')
        prev_pos = pos
        
        if state == 'Idle':
            break

print('\n=== RESULT ===')
if prev_pos is not None:
    print(f'Motor should have moved. Final position: {prev_pos:.3f}mm')
    print('If motor did NOT physically spin, problem is:')
    print('  1. Motor coil wiring (swap middle 2 wires)')
    print('  2. VMOT power not connected')
    print('  3. Driver not seated correctly')
else:
    print('No position data received')

ser.close()
