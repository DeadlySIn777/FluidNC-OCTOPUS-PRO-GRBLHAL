#!/usr/bin/env python3
"""Reset and run unlimited stress test"""

import serial
import time

PORT = 'COM5'
BAUD = 115200

def main():
    port = serial.Serial(PORT, BAUD, timeout=2)
    time.sleep(2)
    port.reset_input_buffer()
    
    # Reset
    print("=== Soft Reset ===")
    port.write(b'\x18')
    time.sleep(2)
    print(port.read(port.in_waiting).decode(errors='ignore'))
    
    # Ensure homing is disabled
    print("=== Disabling homing requirement ===")
    port.write(b'$22=0\n')
    time.sleep(0.2)
    print("$22=0:", port.read(port.in_waiting).decode(errors='ignore'))
    
    # Unlock
    print("\n=== Unlocking ===")
    port.write(b'$X\n')
    time.sleep(0.5)
    print("$X:", port.read(port.in_waiting).decode(errors='ignore'))
    
    # Check status
    port.write(b'?')
    time.sleep(0.3)
    st = port.read(port.in_waiting).decode(errors='ignore')
    print("Status:", st)
    
    if 'Alarm' in st:
        print("\n*** Still in ALARM! ***")
        print("Checking if limit switches are triggered...")
        
        # The Pn: field shows triggered pins
        if 'Pn:' in st:
            print("PINS are triggered:", st.split('Pn:')[1].split('|')[0])
        else:
            print("No pins triggered - alarm may be from startup lock")
        
        # Let's try to see if the alarm clears on its own
        print("\nTrying multiple unlock attempts...")
        for i in range(3):
            port.write(b'$X\n')
            time.sleep(0.3)
            resp = port.read(port.in_waiting).decode(errors='ignore')
            port.write(b'?')
            time.sleep(0.2)
            st = port.read(port.in_waiting).decode(errors='ignore')
            print(f"  Attempt {i+1}: {st.strip()}")
            if 'Idle' in st:
                break
    
    # Check again
    port.write(b'?')
    time.sleep(0.2)
    st = port.read(port.in_waiting).decode(errors='ignore')
    
    if 'Idle' in st:
        print("\n=== SUCCESS - Board is IDLE! ===")
        run_stress_test(port)
    else:
        print("\n*** Cannot clear alarm ***")
        print("The alarm may be related to firmware settings.")
        print("Try: Power cycle the board (unplug USB and 24V)")
    
    port.close()

def run_stress_test(port):
    print("\n=== Configuring for unlimited test ===")
    
    commands = [
        ('$130=100000', 'X max travel 100m'),
        ('$131=100000', 'Y max travel 100m'),
        ('$132=100000', 'Z max travel 100m'),
        ('$20=0', 'Soft limits OFF'),
        ('$21=0', 'Hard limits OFF'),
        ('$338=0', 'StallGuard OFF'),
        ('G92 X0 Y0 Z0', 'Zero position'),
    ]
    
    for cmd, desc in commands:
        port.write((cmd + '\n').encode())
        time.sleep(0.15)
        resp = port.read(port.in_waiting).decode(errors='ignore').strip()
        print(f"  {cmd} ({desc}): {resp}")
    
    print("\n" + "="*60)
    print("=== 3-AXIS STRESS TEST: X+5000 Y+5000 Z+5000 @ F5000 ===")
    print("=== This should run for ~2 minutes ===")
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
            
            # Extract position
            try:
                mpos = st.split('MPos:')[1].split('|')[0]
                wco = st.split('WCO:')[1].split('|')[0] if 'WCO:' in st else None
            except:
                mpos = "?"
                wco = None
            
            print(f"[{elapsed:5.1f}s] MPos: {mpos}")
            
            if 'ALARM' in st.upper():
                print("\n!!! ALARM TRIGGERED !!!")
                print(st)
                break
            if 'Idle' in st:
                print("\n=== MOTION COMPLETE! ===")
                break
            if elapsed > 180:  # 3 minute timeout
                print("\nTimeout - stopping")
                port.write(b'!')
                break
                
    except KeyboardInterrupt:
        print("\n=== Stopping (Ctrl+C) ===")
        port.write(b'!')
        time.sleep(0.5)
        port.write(b'?')
        time.sleep(0.2)
        print("Final:", port.read(port.in_waiting).decode(errors='ignore'))

if __name__ == '__main__':
    main()
