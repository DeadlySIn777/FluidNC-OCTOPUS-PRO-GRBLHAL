#!/usr/bin/env python3
"""
TMC2209 UART Diagnostic - Read driver registers to diagnose why motors aren't spinning
"""

import serial
import time
import re

PORT = "COM5"
BAUD = 115200

def cmd(ser, c, wait=0.3):
    ser.reset_input_buffer()
    ser.write((c + '\n').encode())
    time.sleep(wait)
    return ser.read(ser.in_waiting).decode('utf-8', errors='ignore')

def main():
    print("=" * 60)
    print("TMC2209 UART DIAGNOSTIC")
    print("=" * 60)
    
    ser = serial.Serial(PORT, BAUD, timeout=1)
    time.sleep(2)
    ser.read(ser.in_waiting)  # Clear startup
    
    # Unlock
    cmd(ser, '$X')
    print("\n[1] CHECKING TRINAMIC PLUGIN STATUS")
    info = cmd(ser, '$I', 0.5)
    if 'Trinamic' in info:
        match = re.search(r'\[PLUGIN:Trinamic ([^\]]+)\]', info)
        if match:
            print(f"    ✓ Trinamic plugin v{match.group(1)} loaded")
    else:
        print("    ✗ Trinamic plugin NOT loaded!")
        
    # Check UART pins
    print("\n[2] CHECKING TMC UART PINS")
    pins = cmd(ser, '$pins', 0.5)
    uart_count = 0
    for line in pins.split('\n'):
        if 'UART' in line and ('X' in line or 'Y' in line or 'Z' in line):
            print(f"    {line.strip()}")
            uart_count += 1
    if uart_count == 0:
        print("    ✗ NO TMC UART PINS FOUND - UART NOT CONFIGURED!")
    
    # Read TMC settings
    print("\n[3] TMC2209 SETTINGS (via grblHAL)")
    settings = [
        ('$140', 'X Current (mA)'),
        ('$141', 'Y Current (mA)'),
        ('$142', 'Z Current (mA)'),
        ('$150', 'X Microsteps'),
        ('$151', 'Y Microsteps'),
        ('$152', 'Z Microsteps'),
        ('$338', 'Trinamic driver enable mask'),
    ]
    for setting, desc in settings:
        resp = cmd(ser, setting, 0.2)
        match = re.search(rf'{re.escape(setting)}=(\d+)', resp)
        if match:
            print(f"    {setting} = {match.group(1):>6}  ({desc})")
        elif 'error' in resp.lower():
            print(f"    {setting} = ERROR   ({desc}) - UART NOT WORKING?")
    
    # Try M commands for TMC debug
    print("\n[4] TMC DEBUG COMMANDS")
    
    # M122 is common TMC debug command in Marlin/Klipper
    for mcmd in ['M122', 'M569', 'M911', 'M912', 'M913', 'M914', 'M915']:
        resp = cmd(ser, mcmd, 0.3)
        if resp.strip() and 'error' not in resp.lower():
            print(f"    {mcmd}: {resp.strip()[:60]}")
    
    # Try $TMC
    resp = cmd(ser, '$TMC', 0.3)
    if resp.strip() and 'error' not in resp.lower():
        print(f"    $TMC: {resp.strip()}")
    
    # Check motor status
    print("\n[5] MOTOR ENABLE STATUS")
    resp = cmd(ser, '?', 0.2)
    print(f"    Status: {resp.strip()[:80]}")
    
    # Try reading TMC registers via the debug interface
    print("\n[6] ATTEMPTING DIRECT TMC REGISTER READ")
    print("    (Looking for GCONF, IHOLD_IRUN, CHOPCONF, DRV_STATUS)")
    
    # grblHAL Trinamic plugin uses $2xx settings for some registers
    for reg_num in range(200, 210):
        resp = cmd(ser, f'${reg_num}', 0.15)
        match = re.search(rf'\${reg_num}=(\d+)', resp)
        if match:
            print(f"    ${reg_num} = {match.group(1)}")
    
    # Test actual motor movement with position monitoring
    print("\n[7] MOTOR MOVEMENT TEST WITH UART MONITORING")
    print("    Moving X 5mm at 60mm/min...")
    
    # Get starting position
    resp = cmd(ser, '?', 0.2)
    start_match = re.search(r'MPos:([\d.-]+)', resp)
    start_pos = float(start_match.group(1)) if start_match else 0
    print(f"    Start position: {start_pos:.3f}mm")
    
    # Set relative mode and move
    cmd(ser, 'G91')
    cmd(ser, 'G1 X5 F60')
    
    # Monitor movement
    print("    Monitoring (5 seconds)...")
    last_pos = start_pos
    movement_detected = False
    for i in range(25):
        time.sleep(0.2)
        resp = cmd(ser, '?', 0.1)
        match = re.search(r'MPos:([\d.-]+)', resp)
        if match:
            pos = float(match.group(1))
            if abs(pos - last_pos) > 0.01:
                movement_detected = True
                print(f"      Position: {pos:.3f}mm (moved {pos - start_pos:.3f}mm)")
                last_pos = pos
        if 'Idle' in resp:
            break
    
    end_pos = last_pos
    print(f"    End position: {end_pos:.3f}mm")
    print(f"    Total movement: {end_pos - start_pos:.3f}mm")
    
    if abs(end_pos - start_pos - 5) < 0.5:
        print("\n    ✓ FIRMWARE THINKS IT MOVED 5mm")
        print("    If motor didn't physically spin:")
        print("      1. TMC2209 UART address mismatch (MS1/MS2 jumpers)")
        print("      2. Motor coil wiring (A+/A-/B+/B- pairs)")
        print("      3. Driver power (VMOT) issue")
        print("      4. Driver not in UART mode")
    else:
        print(f"\n    ✗ Expected 5mm, got {end_pos - start_pos:.3f}mm")
    
    # Read driver status after move
    print("\n[8] POST-MOVE DRIVER STATUS")
    
    # Try specific TMC2209 status settings
    for setting in ['$160', '$161', '$162',  # Driver status?
                    '$170', '$171', '$172',  # More status?
                    '$180', '$181', '$182']: # Stallguard?
        resp = cmd(ser, setting, 0.15)
        match = re.search(rf'{re.escape(setting)}=(\d+)', resp)
        if match and int(match.group(1)) != 0:
            print(f"    {setting} = {match.group(1)}")
    
    print("\n" + "=" * 60)
    print("DIAGNOSIS COMPLETE")
    print("=" * 60)
    print("""
If firmware shows movement but motor doesn't spin:
  
  1. CHECK MS1/MS2 JUMPERS:
     - Both at TOP (VIO) = Address 3 (grblHAL uses this)
     - If one is at GND, UART address won't match!
  
  2. CHECK MOTOR WIRING:
     - 4 wires must be in correct pairs (A+/A- and B+/B-)
     - Wrong pairing = vibration, no rotation
     - Try swapping middle 2 wires
  
  3. CHECK VMOT POWER:
     - 24V must be connected to VMOT
     - Check for voltage on driver
  
  4. CHECK DRIVER ORIENTATION:
     - Is driver seated correctly in socket?
     - Is it the right way around?
""")
    
    ser.close()

if __name__ == '__main__':
    main()
