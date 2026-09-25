#!/usr/bin/env python3
"""
Comprehensive TMC2209 diagnostic.
Checks if UART is working and motors are configured correctly.
"""
import serial
import time

PORT = "COM5"
BAUD = 115200

def send(ser, cmd, delay=0.2):
    ser.reset_input_buffer()
    ser.write(f'{cmd}\n'.encode())
    time.sleep(delay)
    return ser.read(ser.in_waiting).decode('utf-8', errors='ignore').strip()

def main():
    print(f"Opening {PORT}...")
    ser = serial.Serial(PORT, BAUD, timeout=2)
    time.sleep(2)
    ser.reset_input_buffer()
    
    # Always unlock first
    print("Unlocking...")
    resp = send(ser, '$X')
    print(f"  $X: {resp}")
    
    # Get status
    resp = send(ser, '?')
    print(f"  Status: {resp}")
    
    # Check Trinamic plugin is loaded
    print("\n=== Plugin Check ===")
    resp = send(ser, '$I')
    if 'Trinamic' in resp:
        # Find the Trinamic line
        for line in resp.split('\n'):
            if 'Trinamic' in line:
                print(f"  {line}")
    else:
        print("  ERROR: Trinamic plugin not in $I response!")
    
    print("\n=== Current Settings ===")
    settings = ['$100', '$101', '$102', '$140', '$141', '$142', '$338']
    for s in settings:
        resp = send(ser, s)
        # Extract just the value
        if '=' in resp:
            print(f"  {s}: {resp.split(chr(10))[0]}")
        else:
            print(f"  {s}: {resp}")
    
    print("\n=== Step Timing ===")
    for s in ['$0', '$1']:
        resp = send(ser, s)
        if '=' in resp:
            print(f"  {s}: {resp.split(chr(10))[0]}")
    
    print("\n" + "="*60)
    print("KEY DIAGNOSTIC:")
    print("="*60)
    print("""
Motor twitching = steps ARE being sent, but:

1. TMC2209 not receiving UART config → runs in standalone mode
   - Standalone = 256 microsteps (default via MS1/MS2)
   - Firmware expects 16 microsteps (400 steps/mm)
   - Result: Motor moves 1/16th of expected distance = tiny twitch

FIX: Set MS1/MS2 jumpers to configure 16 microsteps in standalone:
   MS1=GND, MS2=GND → 8 microsteps  
   MS1=VIO, MS2=GND → 16 microsteps ← WANT THIS
   MS1=GND, MS2=VIO → 32 microsteps
   MS1=VIO, MS2=VIO → 64 microsteps (UART mode, needs working UART)

2. OR fix UART so it can configure the driver:
   - Check UART pin connections
   - Verify baud rate (default 40000 for bit-bang)
""")
    
    # Test motion
    print("\n=== Quick Motion Test ===")
    send(ser, 'G91')  # Relative
    
    print("Moving X +10mm at F300...")
    resp = send(ser, 'G0 X10 F300', 0.1)
    
    # Wait for completion
    for i in range(20):
        time.sleep(0.2)
        resp = send(ser, '?')
        if 'Idle' in resp:
            break
    
    # Get final position
    resp = send(ser, '?')
    if 'MPos' in resp:
        start = resp.find('MPos:') + 5
        end = resp.find('|', start)
        print(f"Position after move: {resp[start:end]}")
    
    print("\nDid the motor shaft rotate ~10mm worth?")
    print("If it barely moved, microstepping mismatch is confirmed.")
    
    ser.close()

if __name__ == "__main__":
    main()
