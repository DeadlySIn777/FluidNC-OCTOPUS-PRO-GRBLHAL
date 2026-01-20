#!/usr/bin/env python3
"""
FluidCNC Connection Tester
Tests all USB devices and verifies communication

Run: python connection_test.py
"""

import serial
import serial.tools.list_ports
import time
import json

def find_ports():
    """Find all connected USB serial devices"""
    ports = serial.tools.list_ports.comports()
    devices = []
    
    for port in ports:
        vid = port.vid or 0
        pid = port.pid or 0
        
        device_type = "Unknown"
        baud = 115200
        
        # STM32 (grblHAL)
        if vid == 0x0483:
            device_type = "grblHAL (STM32)"
        # CP2102 (ESP32)
        elif vid == 0x10C4:
            device_type = "ESP32 (CP2102)"
        # CH340 (ESP32)
        elif vid == 0x1A86:
            device_type = "ESP32 (CH340)"
        # Espressif native (ESP32-S3)
        elif vid == 0x303A:
            device_type = "ESP32-S3 (Native)"
        # FTDI
        elif vid == 0x0403:
            device_type = "FTDI"
            
        devices.append({
            'port': port.device,
            'type': device_type,
            'vid': vid,
            'pid': pid,
            'desc': port.description,
            'baud': baud
        })
    
    return devices

def test_grblhal(port, baud=115200):
    """Test grblHAL connection"""
    print(f"\n{'='*50}")
    print(f"Testing grblHAL on {port}...")
    print('='*50)
    
    try:
        ser = serial.Serial(port, baud, timeout=2)
        time.sleep(0.5)
        
        # Clear buffer
        ser.reset_input_buffer()
        
        # Send soft reset
        ser.write(b'\x18')
        time.sleep(0.5)
        
        # Read welcome message
        welcome = ser.read(ser.in_waiting or 1024).decode('utf-8', errors='ignore')
        print(f"Welcome: {welcome[:200]}...")
        
        # Send status query
        ser.write(b'?\n')
        time.sleep(0.2)
        status = ser.read(ser.in_waiting or 256).decode('utf-8', errors='ignore')
        print(f"Status: {status.strip()}")
        
        # Check for StallGuard
        if '|SG:' in status:
            print("✓ StallGuard data present!")
            sg_start = status.find('|SG:')
            sg_end = status.find('|', sg_start + 1) if status.find('|', sg_start + 1) > 0 else status.find('>', sg_start)
            sg_data = status[sg_start:sg_end]
            print(f"  StallGuard: {sg_data}")
        else:
            print("⚠ No StallGuard data (flash updated firmware)")
        
        # Get version
        ser.write(b'$I\n')
        time.sleep(0.2)
        version = ser.read(ser.in_waiting or 512).decode('utf-8', errors='ignore')
        print(f"Version info:\n{version}")
        
        ser.close()
        return True
        
    except Exception as e:
        print(f"✗ Error: {e}")
        return False

def test_vfd(port, baud=115200):
    """Test VFD ESP32 controller"""
    print(f"\n{'='*50}")
    print(f"Testing VFD Controller on {port}...")
    print('='*50)
    
    try:
        ser = serial.Serial(port, baud, timeout=3)
        time.sleep(2)  # Wait for ESP32 boot
        
        # Clear buffer
        ser.reset_input_buffer()
        
        # Send STATUS command
        ser.write(b'STATUS\n')
        time.sleep(0.5)
        
        # Read response
        response = ser.read(ser.in_waiting or 1024).decode('utf-8', errors='ignore')
        print(f"Response: {response[-500:]}")
        
        # Check for VFD JSON
        if '"vfd"' in response:
            print("✓ VFD Controller confirmed!")
            # Parse JSON status
            try:
                for line in response.split('\n'):
                    if line.startswith('{') and '"vfd"' in line:
                        data = json.loads(line)
                        vfd = data.get('vfd', {})
                        print(f"  Online: {vfd.get('online')}")
                        print(f"  Running: {vfd.get('running')}")
                        print(f"  Direction: {vfd.get('direction')}")
                        print(f"  Actual RPM: {vfd.get('actualRpm')}")
                        print(f"  Temperature: {vfd.get('vfdTempC')}°C")
            except json.JSONDecodeError:
                pass
        else:
            print("⚠ Not a VFD controller")
        
        ser.close()
        return '"vfd"' in response
        
    except Exception as e:
        print(f"✗ Error: {e}")
        return False

def test_chatter(port, baud=115200):
    """Test Chatter sensor ESP32-S3"""
    print(f"\n{'='*50}")
    print(f"Testing Chatter Sensor on {port}...")
    print('='*50)
    
    try:
        ser = serial.Serial(port, baud, timeout=3)
        time.sleep(2)  # Wait for ESP32 boot
        
        # Clear buffer
        ser.reset_input_buffer()
        
        # Send INFO command
        ser.write(b'INFO\n')
        time.sleep(0.5)
        
        # Read response
        response = ser.read(ser.in_waiting or 1024).decode('utf-8', errors='ignore')
        print(f"Response: {response[-500:]}")
        
        # Check for Chatter signatures
        if 'ChatterDetect' in response or '"audio"' in response or '"accel"' in response:
            print("✓ Chatter Sensor confirmed!")
        else:
            print("⚠ Not a chatter sensor")
        
        ser.close()
        return 'Chatter' in response or '"audio"' in response
        
    except Exception as e:
        print(f"✗ Error: {e}")
        return False

def main():
    print("="*60)
    print("FluidCNC Connection Tester")
    print("="*60)
    
    # Find all devices
    devices = find_ports()
    
    if not devices:
        print("\n⚠ No USB serial devices found!")
        print("  Make sure devices are plugged in.")
        return
    
    print(f"\nFound {len(devices)} USB serial devices:\n")
    for d in devices:
        print(f"  {d['port']}: {d['type']}")
        print(f"    VID:PID = {d['vid']:04X}:{d['pid']:04X}")
        print(f"    Description: {d['desc']}")
    
    # Test each device
    results = {'grbl': None, 'vfd': None, 'chatter': None}
    
    for d in devices:
        if d['type'] == 'grblHAL (STM32)':
            if test_grblhal(d['port']):
                results['grbl'] = d['port']
        
        elif 'ESP32' in d['type']:
            # Try VFD first, then Chatter
            if test_vfd(d['port']):
                results['vfd'] = d['port']
            elif test_chatter(d['port']):
                results['chatter'] = d['port']
    
    # Summary
    print("\n" + "="*60)
    print("Summary")
    print("="*60)
    print(f"  grblHAL:  {results['grbl'] or '❌ Not found'}")
    print(f"  VFD:      {results['vfd'] or '❌ Not found'}")
    print(f"  Chatter:  {results['chatter'] or '❌ Not found'}")
    
    if results['grbl'] and results['vfd']:
        print("\n✓ System ready for CNC operation!")
    elif results['grbl']:
        print("\n⚠ VFD not connected - spindle control via grblHAL only")
    else:
        print("\n❌ grblHAL not detected - check USB connection")

if __name__ == '__main__':
    main()
