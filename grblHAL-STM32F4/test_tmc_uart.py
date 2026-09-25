#!/usr/bin/env python3
"""
Test TMC2209 UART communication directly.
"""
import serial
import time

PORT = "COM5"
BAUD = 115200

def send_command(ser, cmd, delay=0.2):
    ser.reset_input_buffer()
    ser.write(f"{cmd}\n".encode())
    time.sleep(delay)
    response = ser.read(ser.in_waiting).decode('utf-8', errors='ignore')
    return response.strip()

def main():
    print(f"Opening {PORT}...")
    ser = serial.Serial(PORT, BAUD, timeout=2)
    time.sleep(2)
    ser.reset_input_buffer()
    
    # Unlock if needed
    status = send_command(ser, "?", 0.2)
    if "Alarm" in status:
        send_command(ser, "$X", 0.3)
    
    print("\n=== TMC2209 UART Test ===")
    
    # Try various TMC commands
    commands = [
        "$trinamic",
        "$TPWM",       # PWM config
        "$TCOOLCONF",  # Coolstep config
        "$CHOPCONF",   # Chopper config  
        "$TSTEP",      # Step timing
        "$DRV_STATUS", # Driver status
        "$IHOLD_IRUN", # Current settings
        "$TPOWERDOWN", # Power down delay
        "$GCONF",      # General config
    ]
    
    for cmd in commands:
        resp = send_command(ser, cmd, 0.2)
        print(f"{cmd}: {resp[:100]}...")
    
    print("\n=== Checking M-codes for Trinamic ===")
    # Try M122 (TMC debug in Marlin, might work in grblHAL)
    resp = send_command(ser, "M122", 0.2)
    print(f"M122: {resp}")
    
    # Try M569 (TMC config in some firmwares)
    resp = send_command(ser, "M569", 0.2)
    print(f"M569: {resp}")
    
    # Check system info for Trinamic plugin
    print("\n=== System Info ===")
    resp = send_command(ser, "$I", 0.3)
    print(resp)
    
    # Check pins
    print("\n=== Pin Configuration ===")
    resp = send_command(ser, "$pins", 0.3)
    print(resp[:500])
    
    ser.close()
    print("\nDone!")

if __name__ == "__main__":
    main()
