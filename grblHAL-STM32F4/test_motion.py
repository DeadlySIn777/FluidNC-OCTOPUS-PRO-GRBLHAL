#!/usr/bin/env python3
"""Test motor movement with grblHAL"""
import serial
import time

PORT = "COM5"
BAUD = 115200

def send_command(ser, cmd, delay=0.1):
    """Send command and read response"""
    ser.reset_input_buffer()
    ser.write(f"{cmd}\n".encode())
    time.sleep(delay)
    response = ser.read(ser.in_waiting).decode('utf-8', errors='ignore')
    return response.strip()

def get_status(ser):
    """Get real-time status"""
    return send_command(ser, "?", 0.2)

def main():
    print(f"Opening {PORT} at {BAUD} baud...")
    
    ser = serial.Serial(PORT, BAUD, timeout=2)
    time.sleep(2)
    ser.reset_input_buffer()
    
    print("\n=== Initial Status ===")
    status = get_status(ser)
    print(f"Status: {status}")
    
    if "Alarm" in status:
        print("Unlocking...")
        resp = send_command(ser, "$X", 0.3)
        print(f"$X: {resp}")
    
    # Set to relative mode
    print("\n=== Setting up for motion test ===")
    resp = send_command(ser, "G91", 0.1)  # Relative mode
    print(f"G91 (relative mode): {resp}")
    
    # Check status before move
    status = get_status(ser)
    print(f"Status before move: {status}")
    
    # Test X axis - move 10mm at 600mm/min
    print("\n=== Moving X axis +10mm ===")
    resp = send_command(ser, "G0 X10 F600", 0.1)
    print(f"G0 X10 F600: {resp}")
    
    # Wait for move to complete
    for i in range(20):
        time.sleep(0.2)
        status = get_status(ser)
        if "Idle" in status:
            print(f"Move complete! Status: {status}")
            break
        elif "Run" in status:
            print(f"Moving... {status}")
    
    # Move back
    print("\n=== Moving X axis -10mm ===")
    resp = send_command(ser, "G0 X-10 F600", 0.1)
    print(f"G0 X-10 F600: {resp}")
    
    for i in range(20):
        time.sleep(0.2)
        status = get_status(ser)
        if "Idle" in status:
            print(f"Move complete! Status: {status}")
            break
        elif "Run" in status:
            print(f"Moving... {status}")
    
    # Test Y axis
    print("\n=== Moving Y axis +10mm ===")
    resp = send_command(ser, "G0 Y10 F600", 0.1)
    print(f"G0 Y10 F600: {resp}")
    
    for i in range(20):
        time.sleep(0.2)
        status = get_status(ser)
        if "Idle" in status:
            print(f"Move complete! Status: {status}")
            break
        elif "Run" in status:
            print(f"Moving... {status}")
    
    # Move back
    print("\n=== Moving Y axis -10mm ===")
    resp = send_command(ser, "G0 Y-10 F600", 0.1)
    print(f"G0 Y-10 F600: {resp}")
    
    for i in range(20):
        time.sleep(0.2)
        status = get_status(ser)
        if "Idle" in status:
            print(f"Move complete! Status: {status}")
            break
        elif "Run" in status:
            print(f"Moving... {status}")
    
    # Test Z axis
    print("\n=== Moving Z axis +5mm ===")
    resp = send_command(ser, "G0 Z5 F300", 0.1)
    print(f"G0 Z5 F300: {resp}")
    
    for i in range(20):
        time.sleep(0.2)
        status = get_status(ser)
        if "Idle" in status:
            print(f"Move complete! Status: {status}")
            break
        elif "Run" in status:
            print(f"Moving... {status}")
    
    # Move back
    print("\n=== Moving Z axis -5mm ===")
    resp = send_command(ser, "G0 Z-5 F300", 0.1)
    print(f"G0 Z-5 F300: {resp}")
    
    for i in range(20):
        time.sleep(0.2)
        status = get_status(ser)
        if "Idle" in status:
            print(f"Move complete! Status: {status}")
            break
        elif "Run" in status:
            print(f"Moving... {status}")
    
    # Final status
    print("\n=== Final Status ===")
    status = get_status(ser)
    print(f"Status: {status}")
    
    ser.close()
    print("\nPort closed.")

if __name__ == "__main__":
    main()
