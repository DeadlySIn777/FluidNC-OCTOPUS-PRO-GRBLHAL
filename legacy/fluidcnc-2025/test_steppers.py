#!/usr/bin/env python3
"""
STEPPER MOTOR TEST SCRIPT
Tests new NEMA17 60Ncm motors with TMC2209 drivers
Motors should be DISCONNECTED from lead screws!
"""

import serial
import serial.tools.list_ports
import time
import sys

def find_grbl_port():
    """Find the grblHAL/FluidNC port"""
    for p in serial.tools.list_ports.comports():
        desc = p.description.lower()
        hwid = p.hwid.lower() if p.hwid else ''
        # STM32 Octopus Pro typically shows as STM or CH340
        if any(x in desc for x in ['ch340', 'stm', 'usb-serial', 'octopus']) or '0483' in hwid:
            print(f"Found controller: {p.device} - {p.description}")
            return p.device
    # Fallback to any USB serial
    ports = list(serial.tools.list_ports.comports())
    if ports:
        print(f"Using first available: {ports[0].device} - {ports[0].description}")
        return ports[0].device
    return None

def send_and_wait(ser, cmd, timeout=30):
    """Send command and wait for ok/error"""
    if not cmd.strip():
        return True
    
    # Skip comments
    if cmd.strip().startswith(';'):
        print(f"  ; {cmd.strip()[1:].strip()}")
        return True
    
    ser.write((cmd.strip() + '\n').encode())
    print(f">> {cmd.strip()}", end=' ')
    
    start = time.time()
    response = ''
    while time.time() - start < timeout:
        if ser.in_waiting:
            line = ser.readline().decode('utf-8', errors='ignore').strip()
            if line:
                if line == 'ok':
                    print(f"[OK]")
                    return True
                elif line.startswith('error'):
                    print(f"[{line}]")
                    return False
                elif line.startswith('<'):
                    # Status report - extract position
                    pass
                elif line.startswith('ALARM'):
                    print(f"\n⚠️  {line}")
                    return False
                else:
                    print(f"  <- {line}")
        time.sleep(0.01)
    
    print("[TIMEOUT]")
    return False

def run_test():
    print("=" * 50)
    print("🔧 STEPPER MOTOR TEST - 1200mm Travel")
    print("   Motors: NEMA17 60Ncm")
    print("   Drivers: TMC2209 UART StealthChop")
    print("=" * 50)
    print()
    
    # Find port
    port = find_grbl_port()
    if not port:
        print("❌ No serial port found!")
        print("   Check USB connection to Octopus Pro")
        return False
    
    # Connect
    print(f"\n📡 Connecting to {port} @ 115200...")
    try:
        ser = serial.Serial(port, 115200, timeout=0.1)
        ser.dtr = True
        time.sleep(0.5)
        ser.reset_input_buffer()
    except Exception as e:
        print(f"❌ Connection failed: {e}")
        return False
    
    # Drain any startup messages
    time.sleep(1)
    while ser.in_waiting:
        line = ser.readline().decode('utf-8', errors='ignore').strip()
        if line:
            print(f"  <- {line}")
    
    print("\n🔓 Unlocking and preparing...")
    
    # Setup commands
    setup = [
        '$X',         # Unlock
        'G21',        # Metric
        'G91',        # Relative
        '$20=0',      # Soft limits OFF (motors disconnected)
    ]
    
    for cmd in setup:
        if not send_and_wait(ser, cmd):
            print("⚠️  Setup command failed, continuing anyway...")
    
    print("\n" + "=" * 50)
    print("🏃 RUNNING MOTOR TESTS")
    print("=" * 50)
    
    # Test sequence
    tests = [
        ("X-AXIS: Forward 1200mm", "G1 X1200 F3000"),
        ("X-AXIS: Reverse 1200mm", "G1 X-1200 F3000"),
        ("", "G4 P1"),
        
        ("Y-AXIS: Forward 1200mm", "G1 Y1200 F3000"),
        ("Y-AXIS: Reverse 1200mm", "G1 Y-1200 F3000"),
        ("", "G4 P1"),
        
        ("Z-AXIS: Forward 1200mm", "G1 Z1200 F1500"),
        ("Z-AXIS: Reverse 1200mm", "G1 Z-1200 F1500"),
        ("", "G4 P1"),
        
        ("COMBINED: XYZ diagonal", "G1 X600 Y600 Z300 F2000"),
        ("COMBINED: Return", "G1 X-600 Y-600 Z-300 F2000"),
        ("", "G4 P0.5"),
        
        ("STRESS: X rapid test", "G1 X100 F5000"),
        ("", "G1 X-100 F5000"),
        ("", "G1 X100 F5000"),
        ("", "G1 X-100 F5000"),
        
        ("STRESS: Y rapid test", "G1 Y100 F5000"),
        ("", "G1 Y-100 F5000"),
        ("", "G1 Y100 F5000"),
        ("", "G1 Y-100 F5000"),
    ]
    
    for label, cmd in tests:
        if label:
            print(f"\n📍 {label}")
        if not send_and_wait(ser, cmd, timeout=120):
            print(f"⚠️  Command failed: {cmd}")
    
    # Cleanup
    print("\n🔒 Re-enabling soft limits...")
    send_and_wait(ser, '$20=1')
    
    # Done
    print("\n" + "=" * 50)
    print("✅ STEPPER TEST COMPLETE")
    print("=" * 50)
    print("""
CHECK RESULTS:
  ✓ Motors ran smooth, no skipping?
  ✓ TMC2209 StealthChop quiet operation?
  ✓ No overheating? (feel motor housings)
  ✓ Drivers not hot? (feel heatsinks)
  
If any axis skipped steps or made grinding noise,
check: motor wiring, driver current ($140-$142),
UART connection, or mechanical binding.
""")
    
    ser.close()
    return True

if __name__ == '__main__':
    try:
        run_test()
    except KeyboardInterrupt:
        print("\n\n⚠️  Test cancelled by user")
        sys.exit(1)
