#!/usr/bin/env python3
"""Check TMC2209 UART status"""

import serial
import time

PORT = "COM5"  # STMicroelectronics Virtual COM Port
BAUD = 115200

def send_cmd(ser, cmd, delay=0.3):
    """Send command and get response"""
    ser.reset_input_buffer()
    ser.write((cmd + '\n').encode())
    time.sleep(delay)
    response = ser.read(ser.in_waiting).decode('utf-8', errors='replace')
    return response

try:
    ser = serial.Serial(PORT, BAUD, timeout=1)
    time.sleep(2)
    
    # Get startup message
    startup = ser.read(ser.in_waiting).decode('utf-8', errors='replace')
    print("=== Startup ===")
    print(startup)
    
    # Check $I for Trinamic plugin
    print("\n=== $I (Build Info) ===")
    response = send_cmd(ser, "$I")
    print(response)
    
    # Check for TRINAMIC in the plugins list
    if "Trinamic" in response:
        print("✓ Trinamic plugin IS loaded")
    else:
        print("✗ Trinamic plugin NOT loaded")
    
    # Check $pins for UART pins
    print("\n=== $pins (looking for UART) ===")
    response = send_cmd(ser, "$pins", delay=0.5)
    # Only show lines with UART or Motor
    lines = response.split('\n')
    for line in lines:
        if 'uart' in line.lower() or 'motor' in line.lower():
            print(line)
    if 'uart' not in response.lower():
        print("✗ No UART pins found in $pins output")
    
    # Try $trinamic command
    print("\n=== $trinamic ===")
    response = send_cmd(ser, "$trinamic")
    print(response)
    
    # Try current settings
    print("\n=== Motor current ($140-$142) ===")
    for axis, setting in [('X', '$140'), ('Y', '$141'), ('Z', '$142')]:
        response = send_cmd(ser, setting, delay=0.2)
        print(f"{axis} current: {response.strip()}")
    
    # Try microstep settings
    print("\n=== Microsteps ($150-$152) ===")
    for axis, setting in [('X', '$150'), ('Y', '$151'), ('Z', '$152')]:
        response = send_cmd(ser, setting, delay=0.2)
        print(f"{axis} microsteps: {response.strip()}")
    
    # Simple motion test
    print("\n=== Motion Test ===")
    # Check current state
    response = send_cmd(ser, "?")
    print(f"Current state: {response.strip()}")
    
    # Unlock if in alarm
    if "Alarm" in response:
        print("Unlocking...")
        send_cmd(ser, "$X")
    
    # Set to relative mode and try a small move
    send_cmd(ser, "G91")  # Relative mode
    print("Sending G0 X1 F60 (1mm at 60mm/min = 1mm/sec)...")
    response = send_cmd(ser, "G0 X1 F60", delay=3)
    print(f"Response: {response.strip()}")
    
    # Check final position
    response = send_cmd(ser, "?")
    print(f"Final state: {response.strip()}")
    
    ser.close()
    
except Exception as e:
    print(f"Error: {e}")
