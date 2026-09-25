#!/usr/bin/env python3
"""Check settings that affect motor rotation"""

import serial
import time

ser = serial.Serial('COM5', 115200, timeout=1)
time.sleep(1)
ser.reset_input_buffer()

def cmd(c, wait=0.2):
    ser.write((c + '\n').encode())
    time.sleep(wait)
    return ser.read(ser.in_waiting).decode('utf-8', errors='ignore').strip()

print("=== Critical Motor Settings ===")

# Step pulse timing
print(f"\n$0 (step pulse, µs): {cmd('$0')}")
print("  - Too short can cause missed steps")
print("  - TMC2209 needs minimum 100ns (0.1µs), recommended 2-5µs")

# Step idle delay  
print(f"\n$1 (step idle delay, ms): {cmd('$1')}")

# Direction port invert
print(f"\n$3 (direction port invert): {cmd('$3')}")

# Step port invert
print(f"\n$4 (step port invert): {cmd('$4')}")

# Limit switch invert
print(f"\n$5 (limit switch invert): {cmd('$5')}")

# Maximum rate
print(f"\n$110-112 (max rate mm/min):")
print(f"  X: {cmd('$110')}")
print(f"  Y: {cmd('$111')}")
print(f"  Z: {cmd('$112')}")

# Acceleration
print(f"\n$120-122 (acceleration mm/s²):")
print(f"  X: {cmd('$120')}")
print(f"  Y: {cmd('$121')}")
print(f"  Z: {cmd('$122')}")

# TMC specific
print(f"\n=== TMC2209 Settings ===")
print(f"$140-142 (current mA):")
print(f"  X: {cmd('$140')}")
print(f"  Y: {cmd('$141')}")
print(f"  Z: {cmd('$142')}")

print(f"\n$150-152 (microsteps):")
print(f"  X: {cmd('$150')}")
print(f"  Y: {cmd('$151')}")
print(f"  Z: {cmd('$152')}")

# Try $trinamic
print(f"\n$trinamic: {cmd('$trinamic', 0.5)}")

ser.close()
