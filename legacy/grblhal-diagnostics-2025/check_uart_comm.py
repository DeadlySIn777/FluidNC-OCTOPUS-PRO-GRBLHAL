#!/usr/bin/env python3
"""Check if TMC2209 UART is actually communicating"""

import serial
import time

p = serial.Serial('COM5', 115200, timeout=1)
time.sleep(1.5)
p.write(b'\x18')
time.sleep(2)
p.read(p.in_waiting)

# Clear alarms
p.write(b'$X\n')
time.sleep(0.5)
p.read(p.in_waiting)
p.write(b'$X\n')
time.sleep(0.5)
p.read(p.in_waiting)

print("="*60)
print("TMC2209 UART Communication Test")
print("="*60)

# Try $motors or $M command for motor status
print("\nTrying $motors command:")
p.write(b'$motors\n')
time.sleep(1)
print(p.read(p.in_waiting).decode(errors='ignore'))

# Try M-codes that the TRINAMIC_DEV enables
print("\nTrying M122 (Trinamic debug/report):")
p.write(b'M122\n')
time.sleep(1)
m122_result = p.read(p.in_waiting).decode(errors='ignore')
print(m122_result if m122_result.strip() else "(no response)")

print("\nTrying M569 (Trinamic driver status):")
p.write(b'M569\n')
time.sleep(1)
m569_result = p.read(p.in_waiting).decode(errors='ignore')
print(m569_result if m569_result.strip() else "(no response)")

print("\nTrying M906 S1700 (set current via Marlin-style):")
p.write(b'M906 X1700 Y1700 Z1700\n')
time.sleep(1)
m906_result = p.read(p.in_waiting).decode(errors='ignore')
print(m906_result if m906_result.strip() else "(no response)")

print("\nTrying M350 (microsteps report):")
p.write(b'M350\n')
time.sleep(1)
m350_result = p.read(p.in_waiting).decode(errors='ignore')
print(m350_result if m350_result.strip() else "(no response)")

# Check $report/all for driver status
print("\nChecking $report for driver info:")
p.write(b'$report\n')
time.sleep(1)
report = p.read(p.in_waiting).decode(errors='ignore')
for line in report.split('\n'):
    if any(x in line.lower() for x in ['trinamic', 'tmc', 'motor', 'drv', 'uart', 'current']):
        print(line)

# Try the raw $pins to see UART pins
print("\nUART pins from $pins:")
p.write(b'$pins\n')
time.sleep(1)
pins = p.read(p.in_waiting).decode(errors='ignore')
for line in pins.split('\n'):
    if 'UART' in line or 'Motor' in line:
        print(line.strip())

p.close()

print("\n" + "="*60)
print("DIAGNOSIS:")
print("- If M122/M569 returned driver data -> UART IS WORKING")
print("- If no response or errors -> UART NOT COMMUNICATING")
print("- error:2 on $140 change suggests UART communication failure")
print("="*60)
