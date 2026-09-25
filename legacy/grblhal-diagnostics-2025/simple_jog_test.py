#!/usr/bin/env python3
"""Simple jog test - move X axis and monitor status"""
import serial
import time

PORT = 'COM5'
BAUD = 115200

ser = serial.Serial(PORT, BAUD, timeout=2)

def send(cmd, delay=0.1):
    ser.write(f"{cmd}\n".encode())
    time.sleep(delay)
    resp = ser.read_all().decode('utf-8', 'ignore').strip()
    return resp

# Reset and unlock
ser.write(b'\x18')
time.sleep(0.5)
ser.read_all()
print(ser.read_all().decode('utf-8', 'ignore'))

print("Unlocking...")
print(send("$X", 0.3))

print("\nResetting position to 0...")
print(send("G92 X0 Y0 Z0", 0.2))

print("\n" + "="*60)
print("=== SIMPLE JOG TEST ===")
print("=== Moving X axis slowly for 10 seconds ===")
print("=== Try holding the motor shaft! ===")
print("="*60 + "\n")

# Start continuous jog
ser.write(b"$J=G91 X500 F1000\n")  # Slow jog, 500mm at 1000mm/min
time.sleep(0.1)
print(f"Jog response: {ser.read_all().decode('utf-8', 'ignore').strip()}")

# Monitor for 15 seconds
start = time.time()
last_pos = None
stall_count = 0

while time.time() - start < 15:
    ser.write(b"?")
    time.sleep(0.3)
    status = ser.read_all().decode('utf-8', 'ignore').strip()
    
    # Parse position
    if "MPos:" in status:
        pos_str = status.split("MPos:")[1].split("|")[0]
        x_pos = float(pos_str.split(",")[0])
        
        if last_pos is not None:
            delta = abs(x_pos - last_pos)
            if delta < 0.5:  # Less than 0.5mm movement
                stall_count += 1
                status_msg = "*** MOTOR MIGHT BE STALLED! ***"
            else:
                stall_count = 0
                status_msg = f"Moving OK (delta={delta:.1f}mm)"
        else:
            status_msg = "Starting..."
        
        last_pos = x_pos
        elapsed = time.time() - start
        print(f"[{elapsed:5.1f}s] X={x_pos:8.2f}mm  {status_msg}")
    
    if "ALARM" in status:
        print(f"\n*** ALARM DETECTED: {status} ***")
        break
    
    if "Idle" in status:
        print(f"\n*** Motion stopped (Idle state) ***")
        break

# Cancel jog
ser.write(b"\x85")  # Jog cancel
time.sleep(0.2)

print("\n" + "="*60)
print("TEST COMPLETE")
print("="*60)

ser.close()
