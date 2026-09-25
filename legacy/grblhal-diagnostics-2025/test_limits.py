#!/usr/bin/env python3
"""
Test limit switch inversion settings.
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

def test_inversion(ser, value):
    """Test limit switch behavior with different $5 values"""
    print(f"\n=== Testing $5={value} ===")
    
    # Set inversion
    resp = send_command(ser, f"$5={value}", 0.1)
    print(f"$5={value}: {resp}")
    
    # Check status
    status = get_status(ser)
    print(f"Status: {status}")
    
    # Check if XYZ are in Pn:
    if "Pn:" in status:
        pn_start = status.find("Pn:")
        pn_end = status.find("|", pn_start) if "|" in status[pn_start:] else status.find(">", pn_start)
        pn_state = status[pn_start:pn_end]
        triggered = []
        if "X" in pn_state: triggered.append("X")
        if "Y" in pn_state: triggered.append("Y")
        if "Z" in pn_state: triggered.append("Z")
        if triggered:
            print(f"  Limit switches triggered: {', '.join(triggered)}")
        else:
            print(f"  No limit switches triggered! This is the correct setting.")
            return True
    else:
        print(f"  No Pn: in status - limits not triggered!")
        return True
    
    return False

def main():
    print(f"Opening {PORT}...")
    ser = serial.Serial(PORT, BAUD, timeout=2)
    time.sleep(2)
    ser.reset_input_buffer()
    
    # Unlock first
    status = get_status(ser)
    if "Alarm" in status:
        send_command(ser, "$X", 0.3)
    
    print("Testing different $5 (limit switch invert) values...")
    print("Goal: Find setting where XYZ are NOT in Pn: state")
    
    # Test different values
    correct_value = None
    for value in [0, 7, 1, 2, 4, 3, 5, 6]:
        if test_inversion(ser, value):
            correct_value = value
            break
    
    if correct_value is not None:
        print(f"\n*** CORRECT SETTING: $5={correct_value} ***")
        print("Limit switches no longer showing as triggered!")
        
        # Now test motion
        print("\n=== Quick motion test ===")
        send_command(ser, "$21=0", 0.1)  # Disable hard limits
        send_command(ser, "G91", 0.1)    # Relative mode
        
        if "Alarm" in get_status(ser):
            send_command(ser, "$X", 0.3)
        
        print("Moving X+5mm...", end=" ")
        resp = send_command(ser, "G0 X5 F600", 0.1)
        time.sleep(1)
        status = get_status(ser)
        if "Idle" in status and "Alarm" not in status:
            print("OK!")
        else:
            print(f"Status: {status}")
        
        print("Moving X-5mm...", end=" ")
        resp = send_command(ser, "G0 X-5 F600", 0.1)
        time.sleep(1)
        status = get_status(ser)
        if "Idle" in status and "Alarm" not in status:
            print("OK!")
        else:
            print(f"Status: {status}")
    else:
        print("\nCould not find a setting that clears the limit switch triggers.")
        print("The pins are likely floating - need physical pull-down resistors.")
    
    ser.close()
    print("\nDone!")

if __name__ == "__main__":
    main()
