#!/usr/bin/env python3
"""
Configure grblHAL and test motor movement.
Handles floating limit switch pins properly.
"""
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

def wait_for_idle(ser, timeout=10):
    """Wait for machine to become idle"""
    for i in range(int(timeout / 0.2)):
        status = get_status(ser)
        if "Idle" in status:
            return True, status
        elif "Alarm" in status:
            return False, status
        time.sleep(0.2)
    return False, status

def main():
    print(f"Opening {PORT} at {BAUD} baud...")
    
    ser = serial.Serial(PORT, BAUD, timeout=2)
    time.sleep(2)
    ser.reset_input_buffer()
    
    print("\n=== Initial Status ===")
    status = get_status(ser)
    print(f"Status: {status}")
    
    # Apply all settings
    print("\n=== Configuring Settings ===")
    settings = [
        ("$22=0", "Disable homing"),
        ("$20=0", "Disable soft limits"),
        ("$21=0", "Disable hard limits"),
        ("$64=0", "Disable force init alarm"),
        ("$5=7", "Invert limit switches XYZ"),
        ("$6=0", "Disable pullup on limits (use inversion)"),
    ]
    
    for cmd, desc in settings:
        resp = send_command(ser, cmd, 0.1)
        status = "OK" if "ok" in resp else resp
        print(f"  {cmd} ({desc}): {status}")
    
    # Soft reset to apply settings
    print("\n=== Soft Reset ===")
    ser.write(b'\x18')
    time.sleep(1.5)
    ser.reset_input_buffer()
    
    status = get_status(ser)
    print(f"Status after reset: {status}")
    
    # Unlock if in alarm
    if "Alarm" in status:
        print("Unlocking...")
        resp = send_command(ser, "$X", 0.3)
        print(f"$X: {resp}")
        status = get_status(ser)
        print(f"Status after unlock: {status}")
    
    if "Idle" not in status:
        print("ERROR: Could not reach Idle state!")
        ser.close()
        return
    
    # Check limit switch status
    print("\n=== Limit Switch Status ===")
    if "Pn:" in status:
        pn_start = status.find("Pn:")
        pn_end = status.find("|", pn_start) if "|" in status[pn_start:] else status.find(">", pn_start)
        pn_state = status[pn_start:pn_end]
        print(f"Pin states: {pn_state}")
        if "X" in pn_state or "Y" in pn_state or "Z" in pn_state:
            print("  NOTE: Limit switches showing as triggered (floating pins)")
            print("  This is OK since hard limits are disabled ($21=0)")
    else:
        print("No pins triggered (Pn: not in status)")
    
    # Test motion
    print("\n" + "="*50)
    print("=== MOTOR MOVEMENT TEST ===")
    print("="*50)
    
    # Set relative mode
    resp = send_command(ser, "G91", 0.1)
    print(f"\nG91 (relative mode): {resp}")
    
    # Test each axis
    for axis, distance, speed in [("X", 20, 600), ("Y", 20, 600), ("Z", 10, 300)]:
        print(f"\n--- Testing {axis} axis ---")
        
        # Move positive
        cmd = f"G0 {axis}{distance} F{speed}"
        print(f"Sending: {cmd}")
        resp = send_command(ser, cmd, 0.1)
        print(f"Response: {resp}")
        
        if "error" in resp:
            print(f"  ERROR: Motion command failed!")
            continue
        
        # Wait for move
        idle, status = wait_for_idle(ser, 5)
        if idle:
            print(f"  Move complete: {status}")
        else:
            print(f"  Move failed/alarm: {status}")
            # Try to recover
            resp = send_command(ser, "$X", 0.3)
            print(f"  Recovery unlock: {resp}")
            continue
        
        time.sleep(0.5)
        
        # Move negative (back to start)
        cmd = f"G0 {axis}-{distance} F{speed}"
        print(f"Sending: {cmd}")
        resp = send_command(ser, cmd, 0.1)
        print(f"Response: {resp}")
        
        if "error" in resp:
            print(f"  ERROR: Motion command failed!")
            continue
        
        # Wait for move
        idle, status = wait_for_idle(ser, 5)
        if idle:
            print(f"  Move complete: {status}")
        else:
            print(f"  Move failed/alarm: {status}")
            resp = send_command(ser, "$X", 0.3)
            print(f"  Recovery unlock: {resp}")
    
    # Final status
    print("\n" + "="*50)
    print("=== Final Status ===")
    status = get_status(ser)
    print(f"Status: {status}")
    
    ser.close()
    print("\nPort closed.")

if __name__ == "__main__":
    main()
