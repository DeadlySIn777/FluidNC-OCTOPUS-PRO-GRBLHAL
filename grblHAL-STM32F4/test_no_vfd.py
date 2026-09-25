#!/usr/bin/env python3
"""Disable VFD spindle and run unlimited stress test"""

import serial
import time

PORT = 'COM5'
BAUD = 115200

def main():
    port = serial.Serial(PORT, BAUD, timeout=2)
    time.sleep(2)
    port.reset_input_buffer()
    
    # Reset
    port.write(b'\x18')
    time.sleep(1.5)
    print(port.read(port.in_waiting).decode(errors='ignore'))
    
    port.write(b'$X\n')
    time.sleep(0.3)
    print("Unlock:", port.read(port.in_waiting).decode(errors='ignore'))
    
    # Disable VFD spindle
    print("\n=== Disabling VFD Spindle ===")
    port.write(b'$460=0\n')
    time.sleep(0.3)
    print("$460=0:", port.read(port.in_waiting).decode(errors='ignore'))
    
    # Verify
    port.write(b'$spindles\n')
    time.sleep(0.3)
    print("Spindles now:", port.read(port.in_waiting).decode(errors='ignore'))
    
    port.write(b'$460\n')
    time.sleep(0.2)
    resp = port.read(port.in_waiting).decode(errors='ignore')
    print(f"$460 value: {resp}")
    
    # Configure for stress test
    print("\n=== Configuring for Stress Test ===")
    commands = [
        '$130=100000',
        '$131=100000',
        '$132=100000',
        '$20=0',
        '$21=0',
        '$338=0',
        'G92 X0 Y0 Z0'
    ]
    
    for cmd in commands:
        port.write((cmd + '\n').encode())
        time.sleep(0.1)
        port.read(port.in_waiting)
    
    print("Configuration done!")
    
    # Check status before test
    port.write(b'?')
    time.sleep(0.2)
    print(f"Status: {port.read(port.in_waiting).decode(errors='ignore')}")
    
    # Run stress test
    print("\n" + "="*60)
    print("=== 3-AXIS STRESS TEST: X+5000 Y+5000 Z+5000 @ F5000 ===")
    print("=== VFD spindle disabled - should run without ALARM:19 ===")
    print("="*60 + "\n")
    
    port.write(b'$J=G91 X5000 Y5000 Z5000 F5000\n')
    time.sleep(0.2)
    print("Started:", port.read(port.in_waiting).decode(errors='ignore'))
    
    # Monitor
    start = time.time()
    try:
        while True:
            time.sleep(3)
            port.reset_input_buffer()
            port.write(b'?')
            time.sleep(0.3)
            st = port.read(port.in_waiting).decode(errors='ignore').strip()
            elapsed = time.time() - start
            
            print(f"[{elapsed:5.1f}s] {st}")
            
            if 'ALARM' in st.upper():
                print("\n!!! ALARM !!!")
                break
            if 'Idle' in st:
                print("\n=== COMPLETE! ===")
                break
            if elapsed > 180:
                print("\nTimeout")
                port.write(b'!')
                break
                
    except KeyboardInterrupt:
        print("\n=== Stopping ===")
        port.write(b'!')
        time.sleep(0.5)
    
    port.close()

if __name__ == '__main__':
    main()
