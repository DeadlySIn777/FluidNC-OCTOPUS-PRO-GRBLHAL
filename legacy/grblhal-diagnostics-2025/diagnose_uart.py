#!/usr/bin/env python3
"""
Test TMC UART with different addresses
"""
import serial
import time

# Note: This script can't change grblHAL's TMC address at runtime
# We can only verify what's happening

ser = serial.Serial('COM5', 115200, timeout=2)
time.sleep(2)
ser.read(ser.in_waiting)

def cmd(c, wait=0.3):
    ser.write((c + '\n').encode())
    time.sleep(wait)
    return ser.read(ser.in_waiting).decode('utf-8', errors='ignore')

cmd('$X')

print("=" * 60)
print("TMC2209 UART DIAGNOSIS")
print("=" * 60)

# Check firmware version
print("\n[1] FIRMWARE INFO:")
info = cmd('$I', 0.5)
for line in info.split('\n'):
    if any(x in line for x in ['VER:', 'DRIVER:', 'BOARD:', 'Trinamic']):
        print(f"    {line.strip()}")

# Check pins
print("\n[2] TMC UART PINS:")
pins = cmd('$pins', 0.5)
for line in pins.split('\n'):
    if 'UART' in line and ('X' in line or 'Y' in line or 'Z' in line):
        print(f"    {line.strip()}")

# Try M122 with axis specifier
print("\n[3] M122 DEBUG REPORT (attempting all axes):")
for axis in ['X', 'Y', 'Z', '']:
    resp = cmd(f'M122 {axis}', 0.5)
    print(f"    M122 {axis}: {resp.strip()[:60]}")

# Check stored settings
print("\n[4] STORED TMC SETTINGS (in grblHAL memory):")
settings = [('$140', 'X Current'), ('$141', 'Y Current'), ('$142', 'Z Current'),
            ('$150', 'X uSteps'), ('$151', 'Y uSteps'), ('$152', 'Z uSteps')]
for s, desc in settings:
    r = cmd(s, 0.1)
    if '=' in r:
        print(f"    {s} = {r.split('=')[1].split()[0]:>6}  ({desc})")

print("\n" + "=" * 60)
print("DIAGNOSIS")
print("=" * 60)
print("""
The M122 warning "Could not communicate with stepper driver!" means
the TMC2209 chip is NOT responding to UART commands.

POSSIBLE CAUSES:

1. **MS1/MS2 JUMPER POSITION** (Most Likely!)
   Current firmware uses address = 3 (MS1=HIGH, MS2=HIGH)
   
   CHECK YOUR JUMPERS:
   - Both MS1 and MS2 must be at TOP position (towards VIO/3.3V)
   - If either is at BOTTOM (GND), address is wrong!
   
   Address table:
   | MS1 | MS2 | Address |
   |-----|-----|---------|
   | BOT | BOT | 0       |
   | TOP | BOT | 1       |
   | BOT | TOP | 2       |
   | TOP | TOP | 3 ←     |

2. **DRIVER NOT PROPERLY SEATED**
   - Remove and reseat the TMC2209 driver
   - Check orientation (EN pin alignment)

3. **UART PIN NOT CONNECTED**
   - On some boards, PDN_UART needs jumper

4. **WRONG FIRMWARE** (TRINAMIC_UART_ENABLE=1 vs 2)
   - Need to reflash with updated firmware
   - Put board in DFU mode (hold BOOT0, press RESET)

QUICK TEST:
   Try changing MS1 and MS2 jumpers to test different addresses.
   After each change, power cycle and run M122 to test.
""")

ser.close()
