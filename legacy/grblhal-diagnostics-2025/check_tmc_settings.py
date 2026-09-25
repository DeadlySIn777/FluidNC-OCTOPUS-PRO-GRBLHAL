#!/usr/bin/env python3
"""Check Trinamic TMC settings"""

import serial
import time

PORT = 'COM5'
BAUD = 115200

def main():
    port = serial.Serial(PORT, BAUD, timeout=2)
    time.sleep(2)
    port.reset_input_buffer()
    
    # Reset and unlock
    port.write(b'\x18')
    time.sleep(1.5)
    port.read(port.in_waiting)
    port.write(b'$X\n')
    time.sleep(0.3)
    port.read(port.in_waiting)
    
    # Get all settings
    print("=== TMC2209 / Motor Driver Settings ===")
    port.write(b'$$\n')
    time.sleep(2)
    settings = port.read(port.in_waiting).decode(errors='ignore')
    
    for line in settings.split('\n'):
        s = line.strip()
        if not s or not s.startswith('$'):
            continue
        try:
            parts = s.split('=')
            num = int(parts[0][1:])
            val = parts[1] if len(parts) > 1 else ""
            
            # Show motor and TMC related settings
            if num in [4, 140, 141, 142, 150, 151, 152, 200, 201, 202, 210, 211, 212, 220, 221, 222, 338, 339, 340, 341, 342, 343, 344, 345, 346]:
                print(f"  {s}")
            elif 100 <= num <= 142:
                print(f"  {s}")
        except:
            pass
    
    # Try to get TMC driver status
    print("\n=== Checking TMC Driver Status ===")
    tmc_cmds = ['$trinamic', '$TMC', '$tmc', '$MOTOR', '$motor']
    for cmd in tmc_cmds:
        port.write((cmd + '\n').encode())
        time.sleep(0.3)
        resp = port.read(port.in_waiting).decode(errors='ignore').strip()
        if resp and 'error' not in resp.lower():
            print(f"{cmd}: {resp}")
    
    # Check status
    port.write(b'?')
    time.sleep(0.2)
    print(f"\nCurrent Status: {port.read(port.in_waiting).decode(errors='ignore')}")
    
    port.close()

if __name__ == '__main__':
    main()
