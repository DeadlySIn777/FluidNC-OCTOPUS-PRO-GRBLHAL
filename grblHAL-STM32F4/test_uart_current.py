#!/usr/bin/env python3
"""Test if UART current control is actually working on TMC2209"""

import serial
import time

port = serial.Serial('COM5', 115200, timeout=2)
time.sleep(2)
port.reset_input_buffer()

def send(cmd, wait=0.3):
    port.write((cmd + '\n').encode())
    time.sleep(wait)
    return port.read(port.in_waiting).decode(errors='ignore').strip()

# Clear alarms
port.write(b'\x18')
time.sleep(2)
port.read(port.in_waiting)

print(send('$X'))
print(send('$X'))
print()

# Test changing current settings in firmware
print("=== Testing UART current setting in firmware ===")
print()

# Get current value
r = send('$140')
print(f"Current $140 value: {r}")

# Set to LOW (100mA)
print(f"Setting $140=100: {send('$140=100')}")
print(f"Read back $140: {send('$140')}")

# Set to HIGH (2000mA)
print(f"Setting $140=2000: {send('$140=2000')}")
print(f"Read back $140: {send('$140')}")

print()
print("=== Now the real test - does motor torque actually change? ===")
print()

# Disable soft limits
send('$20=0')
send('$21=0')
send('G92 X0')
time.sleep(0.3)

# Test 1: VERY LOW current (200mA) - should barely hold position
print("Setting $140=200 (very low current)")
send('$140=200')
time.sleep(0.5)  # Give time for UART to update driver

print("Try to turn the X motor by hand NOW - should be WEAK")
print("Press Enter when ready to test high current...")
input()

# Test 2: HIGH current (2000mA) - should be strong
print("Setting $140=2000 (high current)")
send('$140=2000')
time.sleep(0.5)

print("Try to turn the X motor by hand NOW - should be STRONGER")
print()

# Set back to reasonable value
send('$140=1700')

port.close()

print()
print("="*60)
print("RESULTS:")
print("- If the motor felt SAME at 200mA and 2000mA -> UART NOT WORKING")
print("- If the motor felt WEAKER at 200mA -> UART IS WORKING")
print("="*60)
