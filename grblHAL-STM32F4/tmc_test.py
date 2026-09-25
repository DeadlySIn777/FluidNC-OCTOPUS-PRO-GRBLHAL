#!/usr/bin/env python3
"""Test TMC2209 UART communication and motor movement"""
import serial
import time

PORT = "COM5"
BAUD = 115200

def main():
    print(f"Opening {PORT}...")
    ser = serial.Serial(PORT, BAUD, timeout=2)
    time.sleep(2)
    ser.reset_input_buffer()
    
    # Read startup
    startup = ser.read(ser.in_waiting).decode('utf-8', errors='ignore')
    print(f"Startup: {startup}")
    
    # Unlock
    ser.write(b'$X\n')
    time.sleep(0.3)
    resp = ser.read(ser.in_waiting).decode('utf-8', errors='ignore')
    print(f"$X: {resp}")
    
    # Check current settings
    print("\n=== Motor Current Settings ===")
    for setting in ['$140', '$141', '$142']:
        ser.write(f'{setting}\n'.encode())
        time.sleep(0.2)
        resp = ser.read(ser.in_waiting).decode('utf-8', errors='ignore').strip()
        print(f"{setting}: {resp}")
    
    # Set to relative mode
    ser.write(b'G91\n')
    time.sleep(0.1)
    ser.read(ser.in_waiting)
    
    print("\n=== Slow Motor Test ===")
    print("Watch the motors carefully!")
    print("They should rotate smoothly, not just vibrate.")
    print()
    
    # Very slow move - 5mm at 60mm/min = 5 seconds
    print("Moving X +5mm at 60mm/min (5 seconds)...")
    ser.write(b'G1 X5 F60\n')
    time.sleep(0.3)
    
    # Monitor position during move
    for i in range(12):
        time.sleep(0.5)
        ser.write(b'?\n')
        time.sleep(0.2)
        resp = ser.read(ser.in_waiting).decode('utf-8', errors='ignore')
        if 'MPos' in resp:
            # Extract position
            start = resp.find('MPos:') + 5
            end = resp.find('|', start)
            pos = resp[start:end]
            state = "Running" if "Run" in resp else "Idle"
            print(f"  [{state}] Position: {pos}")
        if 'Idle' in resp:
            print("  Move complete!")
            break
    
    print()
    print("Did the motor shaft physically rotate?")
    print("If only vibrating: Check motor wiring (swap A+/A- or B+/B-)")
    
    ser.close()

if __name__ == "__main__":
    main()
