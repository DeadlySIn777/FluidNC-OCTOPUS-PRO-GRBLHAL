#!/usr/bin/env python3
"""
Fix grblHAL alarm state and configure settings properly.
"""

import serial
import time
import sys

PORT = "COM5"
BAUD = 115200
TIMEOUT = 2

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
    
    try:
        ser = serial.Serial(PORT, BAUD, timeout=TIMEOUT)
        time.sleep(2)  # Wait for controller startup
        
        # Flush any startup messages
        ser.reset_input_buffer()
        
        print("\n=== Current Status ===")
        status = get_status(ser)
        print(f"Status: {status}")
        
        print("\n=== Current Settings ===")
        for setting in ["$22", "$21", "$20", "$64", "$5", "$17", "$14"]:
            resp = send_command(ser, setting, 0.1)
            print(f"{setting}: {resp}")
        
        print("\n=== Applying settings ===")
        
        # Disable homing completely
        print("Setting $22=0 (disable homing)...")
        resp = send_command(ser, "$22=0", 0.2)
        print(f"  Response: {resp}")
        
        # Disable hard limits
        print("Setting $21=0 (disable hard limits)...")
        resp = send_command(ser, "$21=0", 0.2)
        print(f"  Response: {resp}")
        
        # Disable soft limits
        print("Setting $20=0 (disable soft limits)...")
        resp = send_command(ser, "$20=0", 0.2)
        print(f"  Response: {resp}")
        
        # Check $64 - Force Init Alarm
        print("\nChecking $64 (Force Init Alarm)...")
        resp = send_command(ser, "$64")
        print(f"  $64: {resp}")
        
        print("Setting $64=0 (disable force init alarm)...")
        resp = send_command(ser, "$64=0", 0.2)
        print(f"  Response: {resp}")
        
        # Invert limits (they're floating)
        print("Setting $5=7 (invert XYZ limits)...")
        resp = send_command(ser, "$5=7", 0.2)
        print(f"  Response: {resp}")
        
        # Invert control signals
        print("Setting $17=7 (invert control signals)...")
        resp = send_command(ser, "$17=7", 0.2)
        print(f"  Response: {resp}")
        
        # Now try soft reset to apply settings
        print("\n=== Performing soft reset (Ctrl+X) ===")
        ser.write(b'\x18')  # Ctrl+X = soft reset
        time.sleep(1.5)
        
        # Read any startup output
        startup = ser.read(ser.in_waiting).decode('utf-8', errors='ignore')
        print(f"Startup output: {startup}")
        
        # Check status after reset
        print("\n=== Status after reset ===")
        status = get_status(ser)
        print(f"Status: {status}")
        
        # Try unlock
        print("\n=== Trying $X unlock ===")
        resp = send_command(ser, "$X", 0.3)
        print(f"$X response: {resp}")
        
        status = get_status(ser)
        print(f"Status after $X: {status}")
        
        # If still alarm, check alarm reason
        if "Alarm" in status:
            print("\n=== Getting alarm info ===")
            resp = send_command(ser, "$A", 0.2)  # Get alarm info
            print(f"Alarm info: {resp}")
            
            resp = send_command(ser, "$I", 0.2)  # Get system info
            print(f"System info: {resp}")
        
        # Final status
        print("\n=== Final Status ===")
        status = get_status(ser)
        print(f"Status: {status}")
        
        if "Idle" in status:
            print("\n✓ Machine is now IDLE - ready for motion!")
            
            # Test a small move
            print("\n=== Testing Motion ===")
            print("Sending G91 G0 X1 F300...")
            resp = send_command(ser, "G91 G0 X1 F300", 0.5)
            print(f"Response: {resp}")
            
            time.sleep(0.5)
            status = get_status(ser)
            print(f"Status: {status}")
        else:
            print("\n✗ Machine still not in Idle state")
            
        ser.close()
        print("\nPort closed cleanly.")
        
    except serial.SerialException as e:
        print(f"Serial error: {e}")
        return 1
    except Exception as e:
        print(f"Error: {e}")
        import traceback
        traceback.print_exc()
        return 1
    
    return 0

if __name__ == "__main__":
    sys.exit(main())
