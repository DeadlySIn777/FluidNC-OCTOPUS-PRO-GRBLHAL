#!/usr/bin/env python3
"""
Complete grblHAL System Audit
Checks all critical settings, limits, TMC drivers
"""

import serial
import time

def main():
    ser = serial.Serial('COM5', 115200, timeout=2)
    time.sleep(0.3)
    ser.reset_input_buffer()

    print("="*60)
    print("COMPLETE GRBLHAL SYSTEM AUDIT")
    print("="*60)

    # Get all settings
    ser.write(b'$$\n')
    time.sleep(1.5)
    data = ser.read(ser.in_waiting or 16384).decode('utf-8', errors='ignore')

    print("\n[LIMIT & HOMING SETTINGS]")
    print("-"*40)
    
    settings_map = {
        '$5': 'Limit Pins Invert (bitmask)',
        '$20': 'Soft Limits Enable',
        '$21': 'Hard Limits Enable',
        '$22': 'Homing Cycle Enable',
        '$23': 'Homing Dir Invert (bitmask)',
        '$24': 'Homing Locate Feed Rate',
        '$25': 'Homing Search Seek Rate',
        '$26': 'Homing Debounce (ms)',
        '$27': 'Homing Pull-off (mm)',
        '$44': 'Homing Locate Cycles',
        '$45': 'Homing Cycle 1 (axes)',
        '$46': 'Homing Cycle 2 (axes)',
    }
    
    motion_map = {
        '$100': 'X Steps/mm',
        '$101': 'Y Steps/mm',
        '$102': 'Z Steps/mm',
        '$110': 'X Max Rate (mm/min)',
        '$111': 'Y Max Rate (mm/min)',
        '$112': 'Z Max Rate (mm/min)',
        '$120': 'X Accel (mm/s²)',
        '$121': 'Y Accel (mm/s²)',
        '$122': 'Z Accel (mm/s²)',
        '$130': 'X Max Travel (mm)',
        '$131': 'Y Max Travel (mm)',
        '$132': 'Z Max Travel (mm)',
    }
    
    tmc_map = {
        '$338': 'TMC X Current (mA)',
        '$339': 'TMC Y Current (mA)',
        '$340': 'TMC Z Current (mA)',
        '$341': 'TMC X Microsteps',
        '$342': 'TMC Y Microsteps',
        '$343': 'TMC Z Microsteps',
        '$344': 'TMC X StallGuard',
        '$345': 'TMC Y StallGuard',
        '$346': 'TMC Z StallGuard',
    }

    found_settings = {}
    for line in data.split('\n'):
        line = line.strip()
        if line.startswith('$') and '=' in line:
            key = line.split('=')[0]
            val = line.split('=')[1]
            found_settings[key] = val

    # Print limit/homing settings
    for key, desc in settings_map.items():
        val = found_settings.get(key, 'NOT FOUND')
        print(f"  {key} = {val:8} ({desc})")

    print("\n[MOTION SETTINGS]")
    print("-"*40)
    for key, desc in motion_map.items():
        val = found_settings.get(key, 'NOT FOUND')
        print(f"  {key} = {val:8} ({desc})")

    print("\n[TMC DRIVER SETTINGS]")
    print("-"*40)
    for key, desc in tmc_map.items():
        val = found_settings.get(key, 'NOT FOUND')
        if val != 'NOT FOUND':
            print(f"  {key} = {val:8} ({desc})")

    # Get current status
    print("\n[CURRENT STATUS]")
    print("-"*40)
    ser.write(b'?\n')
    time.sleep(0.3)
    status = ser.read(ser.in_waiting or 512).decode('utf-8', errors='ignore')
    print(f"  {status.strip()}")

    # Parse pin states
    if 'Pn:' in status:
        pn_start = status.find('Pn:') + 3
        pn_end = status.find('|', pn_start)
        if pn_end == -1:
            pn_end = status.find('>', pn_start)
        pins = status[pn_start:pn_end]
        
        print("\n[ACTIVE INPUTS]")
        print("-"*40)
        if 'X' in pins: print("  ⚠️  X LIMIT TRIGGERED")
        if 'Y' in pins: print("  ⚠️  Y LIMIT TRIGGERED")
        if 'Z' in pins: print("  ⚠️  Z LIMIT TRIGGERED")
        if 'P' in pins: print("  ⚠️  PROBE TRIGGERED")
        if 'D' in pins: print("  ⚠️  DOOR OPEN")
        if 'H' in pins: print("  ⚠️  HOLD BUTTON")
        if 'R' in pins: print("  ⚠️  RESET BUTTON")
        if 'S' in pins: print("  ⚠️  START BUTTON")
        
        print("\n[DIAGNOSIS]")
        print("-"*40)
        
        limit5 = found_settings.get('$5', '0')
        
        if 'Y' in pins or 'Z' in pins:
            print("PROBLEM: Limit switches showing ACTIVE when they shouldn't be!")
            print("")
            print("This usually means:")
            print("  1. Switches are wired as NC (Normally Closed)")
            print("  2. But grblHAL expects NO (Normally Open)")
            print("")
            print(f"Current $5 (Limit Invert) = {limit5}")
            print("")
            
            # Calculate new $5 value
            current_invert = int(limit5) if limit5.isdigit() else 0
            need_invert = 0
            if 'Y' in pins: need_invert |= 2  # Bit 1 = Y
            if 'Z' in pins: need_invert |= 4  # Bit 2 = Z
            if 'X' in pins: need_invert |= 1  # Bit 0 = X
            
            new_val = current_invert ^ need_invert  # Toggle the bits
            
            print("SOLUTION OPTIONS:")
            print(f"  A) Invert limit pins: $5={new_val}")
            print("  B) Move machine away from limits")
            print("  C) Check limit switch wiring (NC vs NO)")
            print("")
            print(f"To invert Y and Z limits, run: $5={current_invert | 6}")
        else:
            print("✓ No unexpected limit switches active")

    # Check alarm state
    if 'Alarm' in status:
        print("\n[ALARM STATE]")
        print("-"*40)
        print("Machine is in ALARM state!")
        print("Common causes:")
        print("  - ALARM:19 = Homing failed (can't find limit)")
        print("  - ALARM:9  = Homing required")
        print("")
        print("To clear: $X (unlock) or $H (home)")

    ser.close()
    print("\n" + "="*60)

if __name__ == '__main__':
    main()
