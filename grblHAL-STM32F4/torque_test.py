#!/usr/bin/env python3
"""
Single Axis Torque Test - High Current
Tests if motor can be held with 2000mA current
"""

import serial
import time

PORT = 'COM5'
BAUD = 115200

def main():
    port = serial.Serial(PORT, BAUD, timeout=2)
    time.sleep(2)
    port.reset_input_buffer()
    
    def send(cmd, wait=0.15):
        port.write((cmd + '\n').encode())
        time.sleep(wait)
        resp = port.read(port.in_waiting).decode(errors='ignore')
        print(f"  {cmd} -> {resp.strip()[:60]}")
        return resp
    
    def status():
        port.reset_input_buffer()
        port.write(b'?')
        time.sleep(0.3)
        return port.read(port.in_waiting).decode(errors='ignore').strip()
    
    # Reset
    print("=== Soft Reset ===")
    port.write(b'\x18')
    time.sleep(1.5)
    print(port.read(port.in_waiting).decode(errors='ignore'))
    
    # Unlock
    print("=== Unlocking ===")
    send('$X')
    time.sleep(0.3)
    
    st = status()
    print(f"Status: {st}")
    
    if 'Idle' not in st:
        print("\nNot in Idle, trying recovery...")
        for i in range(3):
            send('$X')
            time.sleep(0.2)
        st = status()
        print(f"Status now: {st}")
    
    if 'Idle' in st:
        print("\n=== Configuring High Current ===")
        # Set motor current to maximum safe value (2000mA)
        send('$140=2000')  # X current
        send('$141=2000')  # Y current  
        send('$142=2000')  # Z current
        
        # Disable StallGuard completely
        send('$338=0')
        
        # Set limits
        send('$130=100000')
        send('$20=0')
        send('$21=0')
        
        # Zero position
        send('G92 X0 Y0 Z0')
        
        print("\n" + "="*55)
        print("=== TORQUE TEST: X AXIS @ 2000mA ===")
        print("=== TRY TO HOLD THE MOTOR! ===")  
        print("=== StallGuard: DISABLED ===")
        print("=== It should be VERY hard to stop! ===")
        print("="*55 + "\n")
        
        # Run X axis at slow speed
        port.write(b'$J=G91 X400 F1500\n')
        time.sleep(0.2)
        print(f"Jog started: {port.read(port.in_waiting).decode(errors='ignore')}")
        
        # Monitor for 15 seconds (before VFD timeout)
        start = time.time()
        try:
            while True:
                time.sleep(1)
                st = status()
                elapsed = time.time() - start
                
                try:
                    mpos = st.split('MPos:')[1].split('|')[0]
                    print(f"[{elapsed:4.0f}s] Position: {mpos}")
                except:
                    print(f"[{elapsed:4.0f}s] {st[:50]}")
                
                if 'Idle' in st:
                    print("\n=== COMPLETE ===")
                    break
                if 'ALARM' in st.upper():
                    print("\n=== ALARM (likely VFD timeout) ===")
                    break
                if elapsed > 20:
                    port.write(b'!')
                    print("\n=== TIME LIMIT ===")
                    break
                    
        except KeyboardInterrupt:
            port.write(b'!')
            print("\n=== STOPPED ===")
    else:
        print("\n*** Could not get to Idle state ***")
        print("Try power cycling the board")
    
    port.close()
    
    print("\n" + "="*55)
    print("If you could stop the motor easily - current is too low")
    print("If motor kept going with good force - settings are correct!")
    print("="*55)

if __name__ == '__main__':
    main()
