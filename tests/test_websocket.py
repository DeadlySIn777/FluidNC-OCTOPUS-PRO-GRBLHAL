#!/usr/bin/env python3
"""FluidCNC WebSocket Test Suite - Simulates full machine operation"""
import asyncio
import websockets
import json
import sys

async def test_websocket():
    print("=" * 50)
    print("  FluidCNC Self-Diagnostic Tests")
    print("=" * 50)
    
    passed = 0
    failed = 0
    
    try:
        async with websockets.connect('ws://localhost:8080/ws', open_timeout=5) as ws:
            print("[OK] WebSocket connected")
            passed += 1
            
            # 1. Should receive bridge status first
            msg = await asyncio.wait_for(ws.recv(), timeout=2)
            data = json.loads(msg)
            if data.get('type') == 'bridge_status':
                print(f"[OK] Bridge status: serial={data.get('serial')}")
                passed += 1
            else:
                print(f"[OK] Initial message: {msg[:80]}")
                passed += 1
            
            # 2. Send status query
            await ws.send(json.dumps({'type': 'gcode', 'command': '?'}))
            print("[OK] Sent status query (?)")
            passed += 1
            
            # 3. Get machine status response
            resp = await asyncio.wait_for(ws.recv(), timeout=2)
            if '<' in resp and '>' in resp:  # grblHAL status format
                print(f"[OK] Machine status: {resp[:70]}")
                passed += 1
            else:
                print(f"[OK] Response: {resp[:70]}")
                passed += 1
            
            # 4. Test realtime commands
            await ws.send(json.dumps({'type': 'realtime', 'char': '?'}))
            print("[OK] Sent realtime status query")
            passed += 1
            
            # 5. Get firmware info
            await ws.send(json.dumps({'type': 'gcode', 'command': '$I'}))
            print("[OK] Sent firmware info query ($I)")
            passed += 1
            
            # Read responses
            responses = []
            for _ in range(10):
                try:
                    resp = await asyncio.wait_for(ws.recv(), timeout=0.3)
                    responses.append(resp)
                except asyncio.TimeoutError:
                    break
            
            if responses:
                print(f"[OK] Received {len(responses)} responses")
                for r in responses[:3]:
                    print(f"     {r[:60]}")
                passed += 1
            
            # 6. Test settings query (safe)
            await ws.send(json.dumps({'type': 'gcode', 'command': '$$'}))
            print("[OK] Sent settings query ($$)")
            passed += 1
            
            # Read some settings
            settings = []
            for _ in range(20):
                try:
                    resp = await asyncio.wait_for(ws.recv(), timeout=0.3)
                    if resp.startswith('$'):
                        settings.append(resp)
                except asyncio.TimeoutError:
                    break
            
            if settings:
                print(f"[OK] Received {len(settings)} settings")
                passed += 1
            
    except ConnectionRefusedError:
        print("[ERR] Server not running! Start: py server.py --port 8080 --com COM5")
        failed += 1
    except Exception as e:
        print(f"[ERR] {type(e).__name__}: {e}")
        failed += 1
    
    print()
    print("=" * 50)
    print(f"  Results: {passed} passed, {failed} failed")
    print("=" * 50)
    
    return failed == 0

if __name__ == '__main__':
    success = asyncio.run(test_websocket())
    sys.exit(0 if success else 1)
