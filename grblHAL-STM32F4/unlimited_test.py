#!/usr/bin/env python3
"""Check settings and run unlimited stress test"""

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
    port.read(port.in_waiting)
    
    # Unlock
    port.write(b'$X\n')
    time.sleep(0.3)
    port.read(port.in_waiting)
    
    # Get all settings
    print("=== Current Settings ===")
    port.write(b'$$\n')
    time.sleep(1.5)
    settings = port.read(port.in_waiting).decode(errors='ignore')
    
    # Show travel related settings
    for line in settings.split('\n'):
        s = line.strip()
        if s.startswith('$130') or s.startswith('$131') or s.startswith('$132'):
            print(f"  Max travel: {s}")
        elif s.startswith('$20='):
            print(f"  Soft limits: {s}")
        elif s.startswith('$21='):
            print(f"  Hard limits: {s}")
        elif s.startswith('$338'):
            print(f"  StallGuard: {s}")
    
    # Check current position
    print("\n=== Current Position ===")
    port.write(b'?')
    time.sleep(0.3)
    print(port.read(port.in_waiting).decode(errors='ignore'))
    
    # The machine position is cumulative - we need to see if it hit the 10000mm limit
    # Let's set even larger limits and zero the position
    print("\n=== Setting HUGE limits and zeroing ===")
    
    commands = [
        '$130=50000',  # 50 meters!
        '$131=50000',
        '$132=50000',
        '$20=0',       # Soft limits OFF
        '$21=0',       # Hard limits OFF
        '$338=0',      # StallGuard OFF
        'G92 X0 Y0 Z0' # Zero position
    ]
    
    for cmd in commands:
        port.write((cmd + '\n').encode())
        time.sleep(0.15)
        resp = port.read(port.in_waiting).decode(errors='ignore').strip()
        print(f"  {cmd} -> {resp}")
    
    # Verify settings took effect
    print("\n=== Verify Settings ===")
    port.write(b'$$\n')
    time.sleep(1)
    settings = port.read(port.in_waiting).decode(errors='ignore')
    for line in settings.split('\n'):
        s = line.strip()
        if s.startswith('$130') or s.startswith('$20') or s.startswith('$338'):
            print(f"  {s}")
    
    # Check position is zeroed
    port.write(b'?')
    time.sleep(0.2)
    print(f"\nPosition after zero: {port.read(port.in_waiting).decode(errors='ignore')}")
    
    # Now run the stress test!
    print("\n" + "="*60)
    print("=== UNLIMITED 3-AXIS STRESS TEST: X+2500 Y+2500 Z+2500 ===")
    print("="*60 + "\n")
    
    port.write(b'$J=G91 X2500 Y2500 Z2500 F3000\n')
    time.sleep(0.2)
    print(f"Started: {port.read(port.in_waiting).decode(errors='ignore')}")
    
    # Monitor
    start = time.time()
    try:
        while True:
            time.sleep(2)
            port.reset_input_buffer()
            port.write(b'?')
            time.sleep(0.3)
            st = port.read(port.in_waiting).decode(errors='ignore').strip()
            elapsed = time.time() - start
            
            # Check for alarms
            if 'ALARM' in st.upper():
                print(f"\n!!! ALARM at {elapsed:.1f}s !!!")
                print(st)
                break
            
            print(f"[{elapsed:6.1f}s] {st}")
            
            if 'Idle' in st:
                print("\n=== COMPLETE! ===")
                break
                
    except KeyboardInterrupt:
        print("\n=== Stopping... ===")
        port.write(b'!')
        time.sleep(0.5)
    
    port.close()

if __name__ == '__main__':
    main()
