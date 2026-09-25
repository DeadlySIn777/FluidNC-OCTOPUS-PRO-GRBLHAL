#!/usr/bin/env python3
"""
Visual motor test - slow moves you can see/hear.
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

def wait_idle(ser, timeout=30):
    for _ in range(int(timeout * 5)):
        status = get_status(ser)
        if "Idle" in status:
            return True
        if "Alarm" in status:
            send_command(ser, "$X", 0.3)
            return False
        time.sleep(0.2)
    return False

def main():
    print(f"Opening {PORT}...")
    ser = serial.Serial(PORT, BAUD, timeout=2)
    time.sleep(2)
    ser.reset_input_buffer()
    
    # Configure
    print("Configuring...")
    send_command(ser, "$5=0", 0.1)   # Correct limit inversion
    send_command(ser, "$21=0", 0.1)  # Disable hard limits
    send_command(ser, "$20=0", 0.1)  # Disable soft limits
    send_command(ser, "$22=0", 0.1)  # Disable homing
    
    # Unlock
    if "Alarm" in get_status(ser):
        send_command(ser, "$X", 0.3)
    
    # Absolute mode, set zero
    send_command(ser, "G90", 0.1)
    send_command(ser, "G92 X0 Y0 Z0", 0.1)
    
    print("\n" + "="*60)
    print("VISUAL MOTOR TEST")
    print("="*60)
    print("Watch your motors! They should move smoothly.")
    print("If they vibrate but don't rotate, there's a driver issue.")
    print("="*60)
    
    input("\nPress ENTER to start X axis test...")
    
    print("\n--- X AXIS TEST ---")
    print("Moving X to +50mm at 200mm/min (slow)...")
    send_command(ser, "G1 X50 F200", 0.1)
    wait_idle(ser, 20)
    
    print("Moving X back to 0...")
    send_command(ser, "G1 X0 F200", 0.1)
    wait_idle(ser, 20)
    
    input("\nPress ENTER to start Y axis test...")
    
    print("\n--- Y AXIS TEST ---")
    print("Moving Y to +50mm at 200mm/min (slow)...")
    send_command(ser, "G1 Y50 F200", 0.1)
    wait_idle(ser, 20)
    
    print("Moving Y back to 0...")
    send_command(ser, "G1 Y0 F200", 0.1)
    wait_idle(ser, 20)
    
    input("\nPress ENTER to start Z axis test...")
    
    print("\n--- Z AXIS TEST ---")
    print("Moving Z to +20mm at 100mm/min (slow)...")
    send_command(ser, "G1 Z20 F100", 0.1)
    wait_idle(ser, 20)
    
    print("Moving Z back to 0...")
    send_command(ser, "G1 Z0 F100", 0.1)
    wait_idle(ser, 20)
    
    print("\n" + "="*60)
    print("TEST COMPLETE")
    print("="*60)
    
    status = get_status(ser)
    print(f"Final status: {status}")
    
    ser.close()
    print("\nDid the motors rotate smoothly?")
    print("If they only vibrated, check:")
    print("  1. Motor wiring (A+/A-/B+/B-)")
    print("  2. Motor current ($140, $141, $142)")
    print("  3. TMC2209 UART communication")

if __name__ == "__main__":
    main()
