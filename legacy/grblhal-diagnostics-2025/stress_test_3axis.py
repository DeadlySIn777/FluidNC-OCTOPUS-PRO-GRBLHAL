#!/usr/bin/env python3
"""
3-Axis Stress Test for grblHAL
Moves X, Y, Z simultaneously for 2500mm each
"""

import serial
import time
import sys

PORT = 'COM5'
BAUD = 115200

def main():
    print("Opening port...")
    port = serial.Serial(PORT, BAUD, timeout=2)
    time.sleep(2)
    port.reset_input_buffer()
    
    def send(cmd, wait=0.15):
        port.write((cmd + '\n').encode())
        time.sleep(wait)
        resp = port.read(port.in_waiting).decode(errors='ignore')
        print(f"  {cmd} -> {resp.strip()[:80]}")
        return resp
    
    def status():
        port.reset_input_buffer()
        port.write(b'?')
        time.sleep(0.3)
        return port.read(port.in_waiting).decode(errors='ignore').strip()
    
    # Soft reset first
    print("\n=== Soft Reset ===")
    port.write(b'\x18')
    time.sleep(1.5)
    boot = port.read(port.in_waiting).decode(errors='ignore')
    print(boot)
    
    # Try to unlock
    print("\n=== Unlocking ===")
    send('$X')
    time.sleep(0.3)
    
    st = status()
    print(f"Status: {st}")
    
    if 'Alarm' in st:
        print("\n=== Board is in alarm - trying to clear ===")
        
        # Check if limits are causing alarm
        print("\nChecking settings:")
        send('$5')   # Limit invert
        send('$20')  # Soft limits
        send('$21')  # Hard limits
        send('$22')  # Homing cycle
        send('$37')  # Force homing
        
        # Try cycle start to resume from any hold state
        print("\nTrying realtime commands...")
        port.write(b'~')  # Cycle start
        time.sleep(0.3)
        print(f"After ~: {status()}")
        
        # Try another unlock
        send('$X')
        time.sleep(0.3)
        print(f"After $X: {status()}")
        
        # Try sending a simple command to see error
        print("\nTrying G28.1...")
        resp = send('G28.1', 0.3)
        
        st = status()
        if 'Alarm' in st:
            print("\n*** ALARM PERSISTS ***")
            print("The board may have a hardware issue (limit switch triggered) or")
            print("require a full power cycle. Try unplugging USB and 24V power,")
            print("wait 5 seconds, then reconnect.")
            port.close()
            return
    
    # If we get here, we should be in Idle
    st = status()
    if 'Idle' not in st:
        print(f"\nNot in Idle state: {st}")
        port.close()
        return
    
    print("\n=== Configuring for test ===")
    send('$130=10000')  # X max travel
    send('$131=10000')  # Y max travel
    send('$132=5000')   # Z max travel
    send('$20=0')       # Soft limits off
    send('$21=0')       # Hard limits off
    send('$5=0')        # Don't invert limit switches (NO switches read high when not pressed)
    # Disable StallGuard detection to prevent false alarms
    send('$338=0')      # Disable StallGuard for all axes
    
    # Zero position
    send('G92 X0 Y0 Z0')
    time.sleep(0.2)
    
    print(f"\nReady: {status()}")
    
    # Run the test!
    print("\n" + "="*50)
    print("=== 3-AXIS STRESS TEST: X+2500 Y+2500 Z+2500 ===")
    print("=== Feed rate: 3000 mm/min ===")
    print("="*50 + "\n")
    
    port.write(b'$J=G91 X2500 Y2500 Z2500 F3000\n')
    time.sleep(0.2)
    print(f"Jog started: {port.read(port.in_waiting).decode(errors='ignore')}")
    
    # Monitor progress
    start = time.time()
    last_pos = [0, 0, 0]
    try:
        while True:
            time.sleep(2)
            st = status()
            elapsed = time.time() - start
            
            # Parse position to show delta
            try:
                pos_str = st.split('MPos:')[1].split('|')[0]
                pos = [float(x) for x in pos_str.split(',')]
                delta = [pos[i] - last_pos[i] for i in range(3)]
                last_pos = pos
                speed_info = f"  dX={delta[0]:.0f} dY={delta[1]:.0f} dZ={delta[2]:.0f}"
            except:
                speed_info = ""
            
            # Check for Pn: (triggered pins)
            if 'Pn:' in st:
                print(f"[{elapsed:6.1f}s] *** PINS TRIGGERED *** {st}")
            else:
                print(f"[{elapsed:6.1f}s] {st}{speed_info}")
            
            if 'Idle' in st:
                print("\n=== MOTION COMPLETE! ===")
                break
            if 'Alarm' in st:
                print("\n=== ALARM TRIGGERED! ===")
                break
                
    except KeyboardInterrupt:
        print("\n\n=== STOPPING (Feed Hold) ===")
        port.write(b'!')
        time.sleep(0.5)
        print(f"Final: {status()}")
    
    port.close()
    print("\nDone!")

if __name__ == '__main__':
    main()
