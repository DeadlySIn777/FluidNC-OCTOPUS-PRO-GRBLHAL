#!/usr/bin/env python3
"""
Diagnose and fix motor twitching issue.
Check microstepping, current, and timing settings.
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
    print(f"Status: {status}")
    if "Alarm" in status:
        send_command(ser, "$X", 0.3)
        print("Unlocked")
    
    print("\n=== Current Motor Settings ===")
    
    # Key settings for motor operation
    settings = [
        "$0",   # Step pulse time (microseconds)
        "$1",   # Step idle delay (ms)
        "$2",   # Step port invert mask
        "$3",   # Direction port invert mask
        "$4",   # Step enable invert
        "$5",   # Limit pins invert
        "$14",  # Enable pin invert
        "$100", # X steps/mm
        "$101", # Y steps/mm
        "$102", # Z steps/mm
        "$110", # X max rate (mm/min)
        "$111", # Y max rate
        "$112", # Z max rate
        "$120", # X acceleration (mm/sec^2)
        "$121", # Y acceleration
        "$122", # Z acceleration
        "$140", # X motor current (mA)
        "$141", # Y motor current
        "$142", # Z motor current
        "$150", # X microsteps
        "$151", # Y microsteps
        "$152", # Z microsteps
    ]
    
    for s in settings:
        resp = send_command(ser, s, 0.1)
        # Extract just the value
        lines = resp.split('\n')
        for line in lines:
            if line.startswith('$'):
                print(f"  {line}")
    
    print("\n=== TMC2209 Status ===")
    # Query Trinamic status
    resp = send_command(ser, "$trinamic", 0.3)
    print(resp)
    
    print("\n=== Recommended Settings for Testing ===")
    print("For TMC2209 with 1.8° motors and 16 microsteps:")
    print("  Steps/mm = (200 steps/rev * 16 microsteps) / (pitch mm)")
    print("  For 8mm pitch leadscrew: 200*16/8 = 400 steps/mm")
    print("  For 2mm pitch (GT2 belt): 200*16/2 = 1600 steps/mm")
    print()
    
    # Apply test settings for reliable operation
    print("=== Applying Test Settings ===")
    
    test_settings = [
        ("$0=10", "Step pulse 10µs (longer for reliability)"),
        ("$1=255", "Keep motors enabled"),
        ("$14=0", "Enable active LOW"),
        ("$100=400", "X: 400 steps/mm (8mm leadscrew)"),
        ("$101=400", "Y: 400 steps/mm"),
        ("$102=400", "Z: 400 steps/mm"),
        ("$110=2000", "X max rate 2000mm/min"),
        ("$111=2000", "Y max rate"),
        ("$112=1000", "Z max rate"),
        ("$120=100", "X accel 100mm/s²"),
        ("$121=100", "Y accel"),
        ("$122=50", "Z accel"),
        ("$140=1500", "X current 1500mA"),
        ("$141=1500", "Y current"),
        ("$142=1500", "Z current"),
        ("$150=16", "X 16 microsteps"),
        ("$151=16", "Y 16 microsteps"),
        ("$152=16", "Z 16 microsteps"),
    ]
    
    for cmd, desc in test_settings:
        resp = send_command(ser, cmd, 0.1)
        ok = "ok" in resp
        print(f"  {cmd}: {'OK' if ok else resp} - {desc}")
    
    # Soft reset to apply
    print("\n=== Soft Reset ===")
    ser.write(b'\x18')
    time.sleep(1.5)
    ser.reset_input_buffer()
    
    status = send_command(ser, "?", 0.2)
    if "Alarm" in status:
        send_command(ser, "$X", 0.3)
    
    print("\n=== SLOW Motion Test ===")
    print("Watch the motors - they should rotate smoothly now!")
    print()
    
    # Set relative mode
    send_command(ser, "G91", 0.1)
    
    # Very slow move to observe
    print("Moving X +20mm at 200mm/min (SLOW)...")
    send_command(ser, "G1 X20 F200", 0.1)
    
    # Wait and show progress
    for i in range(30):
        time.sleep(0.5)
        status = send_command(ser, "?", 0.1)
        if "MPos:" in status:
            mpos_start = status.find("MPos:") + 5
            mpos_end = status.find("|", mpos_start)
            pos = status[mpos_start:mpos_end]
            if "Run" in status:
                print(f"  Moving... Position: {pos}")
            elif "Idle" in status:
                print(f"  Complete! Position: {pos}")
                break
    
    print("\nMoving X -20mm...")
    send_command(ser, "G1 X-20 F200", 0.1)
    for i in range(30):
        time.sleep(0.5)
        status = send_command(ser, "?", 0.1)
        if "Idle" in status:
            print("  Complete!")
            break
    
    ser.close()
    print("\nDone!")

if __name__ == "__main__":
    main()
