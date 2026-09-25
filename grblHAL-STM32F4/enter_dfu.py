#!/usr/bin/env python3
"""Enter DFU mode on grblHAL controller"""
import serial
import time

PORT = "COM5"
BAUD = 115200

try:
    ser = serial.Serial(PORT, BAUD, timeout=2)
    time.sleep(1)
    ser.reset_input_buffer()
    
    print("Sending $DFU command...")
    ser.write(b'$DFU\n')
    time.sleep(0.5)
    
    response = ser.read(ser.in_waiting).decode('utf-8', errors='ignore')
    print(f"Response: {response}")
    
    ser.close()
    print("Board should now be in DFU mode. COM port will disappear.")
    
except Exception as e:
    print(f"Error: {e}")
