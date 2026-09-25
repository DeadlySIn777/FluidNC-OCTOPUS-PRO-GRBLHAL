#!/usr/bin/env python3
"""
Quick motor test with immediate unlock recovery.
"""
import serial
import time

PORT = "COM5"
BAUD = 115200

def send_command(ser, cmd, delay=0.1):
    ser.reset_input_buffer()
    ser.write(f"{cmd}\n".encode())
    time.sleep(delay)
    response = ser.read(ser.in_waiting).decode('utf-8', errors='ignore')
    return response.strip()

def get_status(ser):
    return send_command(ser, "?", 0.2)

def unlock(ser):
    resp = send_command(ser, "$X", 0.3)
    return "Unlocked" in resp or "ok" in resp

def move_axis(ser, axis, distance, speed):
    """Move an axis with auto-recovery from alarms"""
    # Unlock if needed
    status = get_status(ser)
    if "Alarm" in status:
        unlock(ser)
    
    # Send move command
    cmd = f"G0 {axis}{distance} F{speed}"
    resp = send_command(ser, cmd, 0.1)
    
    if "error" in resp:
        print(f"  {cmd}: ERROR - {resp}")
        return False
    
    # Wait for completion
    for _ in range(50):
        time.sleep(0.1)
        status = get_status(ser)
        if "Idle" in status:
            return True
        elif "Alarm" in status:
            print(f"  ALARM during move - recovering...")
            unlock(ser)
            return False
    
    return False

def main():
    print(f"Opening {PORT}...")
    ser = serial.Serial(PORT, BAUD, timeout=2)
    time.sleep(2)
    ser.reset_input_buffer()
    
    # Quick setup
    print("Configuring...")
    send_command(ser, "$21=0", 0.1)  # Disable hard limits
    send_command(ser, "$20=0", 0.1)  # Disable soft limits
    send_command(ser, "$22=0", 0.1)  # Disable homing
    
    # Unlock
    status = get_status(ser)
    if "Alarm" in status:
        unlock(ser)
    
    # Set relative mode
    send_command(ser, "G91", 0.1)
    
    print("\n=== Rapid-fire motion test ===")
    print("Watch the motors! They should move even if alarms occur.")
    print()
    
    # X axis test
    print("X+ 10mm...", end=" ")
    if move_axis(ser, "X", 10, 1000):
        print("OK")
    else:
        print("(alarm)")
    
    print("X- 10mm...", end=" ")
    if move_axis(ser, "X", -10, 1000):
        print("OK")
    else:
        print("(alarm)")
    
    # Y axis test
    print("Y+ 10mm...", end=" ")
    if move_axis(ser, "Y", 10, 1000):
        print("OK")
    else:
        print("(alarm)")
    
    print("Y- 10mm...", end=" ")
    if move_axis(ser, "Y", -10, 1000):
        print("OK")
    else:
        print("(alarm)")
    
    # Z axis test
    print("Z+ 5mm...", end=" ")
    if move_axis(ser, "Z", 5, 500):
        print("OK")
    else:
        print("(alarm)")
    
    print("Z- 5mm...", end=" ")
    if move_axis(ser, "Z", -5, 500):
        print("OK")
    else:
        print("(alarm)")
    
    # Final position
    status = get_status(ser)
    print(f"\nFinal status: {status}")
    
    # Extract position
    if "MPos:" in status:
        mpos_start = status.find("MPos:") + 5
        mpos_end = status.find("|", mpos_start)
        pos = status[mpos_start:mpos_end]
        print(f"Final position: {pos}")
    
    ser.close()
    print("\nDone!")

if __name__ == "__main__":
    main()
