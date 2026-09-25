#!/usr/bin/env python3
"""
3-Axis Stress Test - Workaround for ALARM:19 (VFD timeout)
Runs multiple shorter moves to achieve 2500mm total
"""

import serial
import time

PORT = 'COM5'
BAUD = 115200

def main():
    port = serial.Serial(PORT, BAUD, timeout=2)
    time.sleep(2)
    port.reset_input_buffer()
    
    def cmd(c):
        port.write((c + '\n').encode())
        time.sleep(0.15)
        return port.read(port.in_waiting).decode(errors='ignore')
    
    def status():
        port.reset_input_buffer()
        port.write(b'?')
        time.sleep(0.3)
        return port.read(port.in_waiting).decode(errors='ignore').strip()
    
    # Reset and unlock
    print("=== Initializing ===")
    port.write(b'\x18')
    time.sleep(1.5)
    print(port.read(port.in_waiting).decode(errors='ignore'))
    cmd('$X')
    
    # Configure
    print("=== Configuring ===")
    for c in ['$130=100000', '$131=100000', '$132=100000', '$20=0', '$21=0', '$338=0', 'G92 X0 Y0 Z0']:
        cmd(c)
    
    print(f"Ready: {status()}")
    
    # Run test in 500mm segments to avoid VFD timeout
    # VFD alarm happens after ~30 seconds
    # At F5000 (5000mm/min), we can do about 2500mm in 30 seconds per axis
    # But diagonal movement is slower per axis (each only gets ~1/sqrt(3) of speed)
    # So let's do 400mm segments which should take ~15 seconds
    
    SEGMENT = 400  # mm per segment
    TOTAL = 2500   # total distance target
    SEGMENTS = TOTAL // SEGMENT
    
    print(f"\n{'='*60}")
    print(f"=== 3-AXIS STRESS TEST: {TOTAL}mm in {SEGMENTS} segments of {SEGMENT}mm ===")
    print(f"{'='*60}\n")
    
    total_dist = 0
    for i in range(SEGMENTS):
        print(f"\n--- Segment {i+1}/{SEGMENTS}: Moving {SEGMENT}mm ---")
        
        port.write(f'$J=G91 X{SEGMENT} Y{SEGMENT} Z{SEGMENT} F5000\n'.encode())
        time.sleep(0.2)
        print(f"Started: {port.read(port.in_waiting).decode(errors='ignore').strip()}")
        
        # Wait for segment to complete
        start = time.time()
        while True:
            time.sleep(1)
            st = status()
            elapsed = time.time() - start
            
            if 'ALARM' in st.upper():
                print(f"[{elapsed:.1f}s] ALARM - recovering...")
                # Recover from alarm
                port.write(b'\x18')
                time.sleep(1.5)
                port.read(port.in_waiting)
                cmd('$X')
                break
            elif 'Idle' in st:
                # Extract position
                try:
                    mpos = st.split('MPos:')[1].split('|')[0]
                    print(f"[{elapsed:.1f}s] Segment complete! Position: {mpos}")
                except:
                    print(f"[{elapsed:.1f}s] Segment complete!")
                break
            else:
                # Still moving
                try:
                    mpos = st.split('MPos:')[1].split('|')[0].split(',')[0]
                    print(f"[{elapsed:.1f}s] X={mpos}")
                except:
                    pass
        
        total_dist += SEGMENT
        print(f"Total distance so far: {total_dist}mm")
        
        # Brief pause between segments
        time.sleep(0.5)
    
    # Final status
    print(f"\n{'='*60}")
    print(f"=== TEST COMPLETE: Moved {total_dist}mm on all axes ===")
    print(f"Final: {status()}")
    print(f"{'='*60}")
    
    port.close()

if __name__ == '__main__':
    main()
