#!/usr/bin/env python3
"""Check and configure spindle/VFD settings"""

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
    print("=== All Spindle-Related Settings ===")
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
            # Spindle settings: 30-46, 460-510
            if 30 <= num <= 46 or 460 <= num <= 510:
                print(f"  {s}")
        except:
            pass
    
    # List available spindles
    print("\n=== Listing Spindles ===")
    port.write(b'$spindles\n')
    time.sleep(0.5)
    print(port.read(port.in_waiting).decode(errors='ignore'))
    
    # Try to disable VFD
    print("\n=== Checking Spindle Selection ===")
    # $395 might be spindle type selection in some grblHAL builds
    # $32 is laser mode (often repurposed for spindle type)
    
    port.write(b'$32\n')
    time.sleep(0.2)
    print("$32:", port.read(port.in_waiting).decode(errors='ignore'))
    
    # Check if there's a way to select spindle 0 (disabled/PWM only)
    # In grblHAL, $395 is sometimes spindle 0 selection
    print("\nTrying to set spindle to PWM only (no VFD):")
    
    # Try setting $395=0 for default PWM spindle
    port.write(b'$395=0\n')
    time.sleep(0.2)
    resp = port.read(port.in_waiting).decode(errors='ignore')
    print(f"$395=0: {resp}")
    
    # Check status
    port.write(b'?')
    time.sleep(0.2)
    print(f"\nStatus: {port.read(port.in_waiting).decode(errors='ignore')}")
    
    port.close()

if __name__ == '__main__':
    main()
