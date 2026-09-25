#!/usr/bin/env python3
"""
M122 - TMC2209 Debug Report
This will show driver status including faults
"""
import serial
import time

ser = serial.Serial('COM5', 115200, timeout=2)
time.sleep(2)
ser.read(ser.in_waiting)

def cmd(c, wait=0.5):
    ser.write((c + '\n').encode())
    time.sleep(wait)
    return ser.read(ser.in_waiting).decode('utf-8', errors='ignore')

# Unlock
cmd('$X')

print("=" * 60)
print("M122 - TMC2209 DRIVER DEBUG REPORT")
print("=" * 60)

# M122 - Marlin format debug report
resp = cmd('M122', 1.0)
print(resp)

if 'error' in resp.lower():
    print("\nM122 not available, trying alternatives...")
    
    # Try reading individual driver settings
    print("\n--- Reading TMC Settings ---")
    for s in ['$140', '$141', '$142',  # Current
              '$150', '$151', '$152',  # Microsteps
              '$200', '$201', '$202',  # Maybe IHOLD/IRUN
              '$210', '$211', '$212',  # Maybe StallGuard
              '$220', '$221', '$222']: # Maybe more
        r = cmd(s, 0.15)
        if 'error' not in r.lower() and '=' in r:
            val = r.split('=')[1].strip().split()[0]
            print(f"  {s} = {val}")

print("\n" + "=" * 60)
print("INTERPRETATION")
print("=" * 60)

# Parse the M122 output if we got it
if 'DRV_STATUS' in resp or 'drv_status' in resp.lower():
    print("\nLooking for fault flags...")
    for fault in ['ola', 'olb', 'ot', 'otpw', 's2ga', 's2gb', 's2vsa', 's2vsb', 'stst']:
        if fault + ':1' in resp.lower() or fault + '=1' in resp.lower():
            if fault == 'ola':
                print(f"  ✗ OLA (Open Load A) - Coil A not connected!")
            elif fault == 'olb':
                print(f"  ✗ OLB (Open Load B) - Coil B not connected!")
            elif fault == 'ot':
                print(f"  ✗ OT (Over Temperature) - Driver overheated!")
            elif fault == 'otpw':
                print(f"  ! OTPW (Over Temp PreWarning) - Driver getting hot")
            elif fault in ['s2ga', 's2gb', 's2vsa', 's2vsb']:
                print(f"  ✗ {fault.upper()} - Short circuit detected!")
            elif fault == 'stst':
                print(f"  ✓ STST (Standstill) - Motor at standstill (normal)")
else:
    print("""
If M122 returned error, the debug report may not be enabled.
Check if TRINAMIC_DEV=1 is set in my_machine.h

Based on our tests:
- TMC UART IS working ($140-$152 settings work)
- Step pulses ARE being sent (position changes)
- Motor is NOT spinning

This strongly suggests HARDWARE issue:
1. Motor coil wiring wrong (swap middle 2 wires)
2. VMOT power not connected (check 24V)
3. Driver in wrong orientation
4. MS1/MS2 jumpers (should be both at TOP for UART mode)
""")

ser.close()
