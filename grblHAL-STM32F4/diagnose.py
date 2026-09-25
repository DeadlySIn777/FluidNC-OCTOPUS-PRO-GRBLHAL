#!/usr/bin/env python3
"""Check TMC2209 microstepping and diagnose twitching issue"""
import serial
import time

PORT = "COM5"
BAUD = 115200

def send(ser, cmd):
    ser.write(f'{cmd}\n'.encode())
    time.sleep(0.2)
    return ser.read(ser.in_waiting).decode('utf-8', errors='ignore').strip()

def main():
    ser = serial.Serial(PORT, BAUD, timeout=2)
    time.sleep(2)
    ser.reset_input_buffer()
    
    send(ser, '$X')  # Unlock
    
    print("=== Step/Direction Settings ===")
    for s in [0, 1, 2, 3, 4]:
        resp = send(ser, f'${s}')
        print(f"${s}: {resp}")
    
    print("\n=== Steps per mm ===")
    for s in [100, 101, 102]:
        resp = send(ser, f'${s}')
        print(f"${s}: {resp}")
    
    print("\n=== Motor Current (mA) ===")
    for s in [140, 141, 142]:
        resp = send(ser, f'${s}')
        print(f"${s}: {resp}")
    
    print("\n=== Trinamic Settings ===")
    for s in [338, 339, 340, 341]:
        resp = send(ser, f'${s}')
        print(f"${s}: {resp}")
    
    print("\n" + "="*50)
    print("DIAGNOSIS:")
    print("="*50)
    print("""
If motors are TWITCHING but not rotating:

1. MICROSTEPPING MISMATCH
   - TMC2209 default is 256 microsteps
   - If firmware uses 400 steps/mm (for 16 microsteps)
   - Need to set driver to 16 microsteps via UART
   
2. MOTOR CURRENT TOO LOW
   - Check $140/$141/$142 are set (2000mA shown)
   - But UART might not be applying it!
   
3. UART ADDRESS WRONG  
   - MS1/MS2 jumpers = TOP/TOP = address 3
   - Firmware should use address 3
   
4. MOTOR WIRING
   - Swap A+/A- wires if motor just vibrates
   - Or swap B+/B- 

Let's try setting microstepping directly...
""")
    
    # Try to read TMC register to verify UART works
    print("\n=== Testing UART Communication ===")
    
    # The $TST command might help
    resp = send(ser, '$TST')
    if 'error' not in resp.lower():
        print(f"$TST: {resp[:100]}")
    
    # Try reading $I for plugins
    resp = send(ser, '$I')
    if 'Trinamic' in resp:
        print("Trinamic plugin IS loaded")
    else:
        print("Trinamic plugin NOT loaded!")
    
    ser.close()
    print("\nDone")

if __name__ == "__main__":
    main()
