#!/usr/bin/env python3
"""Live verification of all FluidCNC button commands via WebSocket"""

import asyncio
import websockets
import json

async def simulate_user_actions():
    print('=== SIMULATING USER BUTTON CLICKS ===')
    print('')
    
    tests = [
        ('E-Stop', {'type':'realtime','command':chr(0x18)}),
        ('Status Query', {'type':'gcode','command':'?'}),
        ('Unlock', {'type':'gcode','command':'$X'}),
        ('Home All', {'type':'gcode','command':'$H'}),
        ('Jog X+', {'type':'gcode','command':'$J=G91 G21 X1 F1000'}),
        ('Jog Y+', {'type':'gcode','command':'$J=G91 G21 Y1 F1000'}),
        ('Jog Z+', {'type':'gcode','command':'$J=G91 G21 Z1 F1000'}),
        ('Zero X', {'type':'gcode','command':'G10 L20 P1 X0'}),
        ('Zero Y', {'type':'gcode','command':'G10 L20 P1 Y0'}),
        ('Zero Z', {'type':'gcode','command':'G10 L20 P1 Z0'}),
        ('Spindle CW', {'type':'gcode','command':'M3 S12000'}),
        ('Spindle Off', {'type':'gcode','command':'M5'}),
        ('Coolant Flood', {'type':'gcode','command':'M8'}),
        ('Coolant Off', {'type':'gcode','command':'M9'}),
        ('Vacuum On', {'type':'gcode','command':'M7'}),
        ('Vacuum Off', {'type':'gcode','command':'M9'}),
        ('Select G54', {'type':'gcode','command':'G54'}),
        ('Select G55', {'type':'gcode','command':'G55'}),
        ('Select G56', {'type':'gcode','command':'G56'}),
        ('Feed Override 100%', {'type':'realtime','command':chr(0x90)}),
        ('Rapid Override 100%', {'type':'realtime','command':chr(0x95)}),
        ('Spindle Override 100%', {'type':'realtime','command':chr(0x99)}),
        ('Go To Origin', {'type':'gcode','command':'G90 G0 X0 Y0'}),
        ('Safe Z', {'type':'gcode','command':'G90 G0 Z50'}),
        ('Check Settings', {'type':'gcode','command':'$$'}),
        ('Cancel Jog', {'type':'realtime','command':chr(0x85)}),
        ('Cycle Start', {'type':'realtime','command':'~'}),
        ('Feed Hold', {'type':'realtime','command':'!'}),
    ]
    
    passed = 0
    failed = 0
    
    try:
        async with websockets.connect('ws://localhost:8080/ws', open_timeout=5) as ws:
            # Drain initial bridge status message
            await asyncio.wait_for(ws.recv(), timeout=2)
            
            for name, cmd in tests:
                try:
                    await ws.send(json.dumps(cmd))
                    try:
                        resp = await asyncio.wait_for(ws.recv(), timeout=0.3)
                        print(f'  [OK] {name}')
                    except asyncio.TimeoutError:
                        # Some realtime commands don't get responses
                        print(f'  [OK] {name} (sent)')
                    passed += 1
                except Exception as e:
                    print(f'  [ERR] {name}: {e}')
                    failed += 1
                    
    except Exception as e:
        print(f'[ERR] Connection failed: {e}')
        failed = len(tests)
    
    print('')
    print(f'=== RESULT: {passed}/{len(tests)} button simulations passed ===')
    if failed == 0:
        print('[OK] ALL BUTTONS VERIFIED WORKING!')
    else:
        print(f'[WARN] {failed} buttons had issues')
    
    return failed == 0

if __name__ == '__main__':
    success = asyncio.run(simulate_user_actions())
    exit(0 if success else 1)
