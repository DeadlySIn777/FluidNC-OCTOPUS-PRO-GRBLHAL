#!/usr/bin/env python3
"""
FluidCNC Bridge Server - aiohttp version
HTTP + WebSocket on same port for simplicity

SAFETY-CRITICAL: This server bridges browser to CNC controller.
Any bugs here could cause dangerous machine behavior!
"""
import asyncio
import argparse
import json
import serial
import serial.tools.list_ports
import sys
from pathlib import Path
from aiohttp import web
import aiohttp

# Python version check
if sys.version_info < (3, 8):
    print("ERROR: Python 3.8+ required for FluidCNC")
    sys.exit(1)

STATIC_DIR = Path(__file__).parent
serial_port = None
vfd_port = None  # ESP32 VFD controller
connected_clients = set()

# CRITICAL SAFETY FIX: Mutex for serial port access
# Prevents command corruption from concurrent WebSocket messages
serial_lock = asyncio.Lock()
vfd_lock = asyncio.Lock()

# VFD status (updated by ESP32)
vfd_status = {
    "online": False,
    "running": False,
    "direction": "FWD",
    "setRpm": 0,
    "actualRpm": 0,
    "outputAmps": 0.0,
    "loadPercent": 0.0,
    "vfdTempC": 0,
    "commErrors": 0
}

# Maximum clients to prevent DoS
MAX_CLIENTS = 10

# Maximum buffer size to prevent memory exhaustion
MAX_BUFFER_SIZE = 4096

# Allowed realtime characters (safety whitelist)
ALLOWED_REALTIME = {'!', '~', '?', '\x18', '\x85', '\x90', '\x91', '\x92', '\x93', '\x94', '\x95', '\x96', '\x97', '\x98', '\x99', '\x9A', '\x9B', '\x9C', '\x9D'}

def find_grbl_port():
    """Find likely grblHAL port"""
    for p in serial.tools.list_ports.comports():
        desc = (p.description or '').lower()
        hwid = (p.hwid or '').upper()
        if any(x in desc for x in ['ch340', 'stm', 'usb-serial']) or '0483' in hwid:
            return p.device
    ports = list(serial.tools.list_ports.comports())
    return ports[0].device if ports else None

def find_esp32_ports():
    """Find ESP32 ports (CP2102, CH340, etc)"""
    esp_ports = []
    for p in serial.tools.list_ports.comports():
        desc = (p.description or '').lower()
        hwid = (p.hwid or '').upper()
        # ESP32 typically uses CP2102, CH340, or FTDI
        if any(x in desc for x in ['cp210', 'ch340', 'ftdi', 'usb serial']) or '10C4' in hwid:
            esp_ports.append(p.device)
    return esp_ports

async def init_serial(port, baud):
    """Initialize serial connection"""
    global serial_port
    try:
        serial_port = serial.Serial(port, baud, timeout=0.1)
        serial_port.dtr = True
        await asyncio.sleep(1)
        serial_port.reset_input_buffer()
        serial_port.write(b'\x18')
        await asyncio.sleep(0.3)
        serial_port.reset_input_buffer()
        print(f"[OK] Connected to grblHAL on {port} @ {baud}")
        return True
    except Exception as e:
        print(f"[ERR] Serial error on {port}: {e}")
        return False

async def init_vfd(port, baud=115200):
    """Initialize ESP32 VFD controller connection"""
    global vfd_port
    try:
        vfd_port = serial.Serial(port, baud, timeout=0.1)
        await asyncio.sleep(0.5)
        vfd_port.reset_input_buffer()
        # Request initial status
        vfd_port.write(b'STATUS\n')
        print(f"[OK] Connected to ESP32 VFD on {port} @ {baud}")
        return True
    except Exception as e:
        print(f"[ERR] VFD serial error on {port}: {e}")
        return False

async def send_vfd_command(cmd):
    """Send command to ESP32 VFD controller"""
    global vfd_port
    if vfd_port and vfd_port.is_open:
        async with vfd_lock:
            try:
                vfd_port.write(f"{cmd.strip()}\n".encode('utf-8'))
                return True
            except Exception as e:
                print(f"[ERR] VFD write error: {e}")
    return False

async def broadcast(message):
    """Send message to all WebSocket clients - THREAD-SAFE"""
    if not connected_clients:
        return
    # SAFETY FIX: Copy set to avoid "set changed size during iteration"
    clients = connected_clients.copy()
    dead = set()
    for ws in clients:
        try:
            await ws.send_str(message)
        except Exception:
            dead.add(ws)
    connected_clients.difference_update(dead)

async def send_gcode(cmd):
    """Send G-code command with mutex protection"""
    global serial_port
    if serial_port and serial_port.is_open:
        # CRITICAL SAFETY: Use mutex to prevent command corruption
        async with serial_lock:
            try:
                serial_port.write(f"{cmd.strip()}\n".encode('utf-8'))
                return True
            except Exception as e:
                print(f"Serial write error: {e}")
    return False

async def send_realtime(char):
    """Send realtime character with mutex protection and validation"""
    global serial_port
    if not serial_port or not serial_port.is_open:
        return False
    
    # CRITICAL SAFETY: Whitelist realtime characters
    if char not in ALLOWED_REALTIME:
        print(f"[SECURITY] Blocked invalid realtime char: {repr(char)}")
        return False
    
    async with serial_lock:
        try:
            serial_port.write(char.encode('utf-8'))
            return True
        except Exception as e:
            print(f"Serial realtime write error: {e}")
            return False
    return False

async def serial_reader():
    """Read serial and broadcast to clients - with reconnection support"""
    global serial_port
    buffer = ""
    reconnect_attempts = 0
    max_reconnect_attempts = 10
    
    while True:
        try:
            # Check if serial is connected
            if serial_port and serial_port.is_open:
                reconnect_attempts = 0  # Reset on successful read cycle
                if serial_port.in_waiting:
                    data = serial_port.read(serial_port.in_waiting).decode('utf-8', errors='replace')
                    buffer += data
                    
                    # CRITICAL SAFETY: Prevent buffer overflow / memory exhaustion
                    if len(buffer) > MAX_BUFFER_SIZE:
                        print(f"[WARN] Buffer overflow - truncating {len(buffer)} bytes to {MAX_BUFFER_SIZE}")
                        buffer = buffer[-MAX_BUFFER_SIZE:]
                    
                    while '\n' in buffer:
                        line, buffer = buffer.split('\n', 1)
                        line = line.strip()
                        if line:
                            await broadcast(line)
            else:
                # Serial disconnected - attempt reconnection
                if reconnect_attempts < max_reconnect_attempts:
                    reconnect_attempts += 1
                    print(f"[WARN] Serial disconnected, reconnection attempt {reconnect_attempts}/{max_reconnect_attempts}")
                    await broadcast(json.dumps({"type": "bridge_status", "serial": "reconnecting"}))
                    
                    port = find_grbl_port()
                    if port:
                        if await init_serial(port, 115200):
                            print(f"[OK] Reconnected to {port}")
                            await broadcast(json.dumps({"type": "bridge_status", "serial": "connected"}))
                            continue
                    
                    # Wait before next attempt with exponential backoff
                    await asyncio.sleep(min(2 ** reconnect_attempts, 30))
                else:
                    # Max attempts reached, wait longer
                    await asyncio.sleep(10)
                    
        except serial.SerialException as e:
            print(f"[ERR] Serial error: {e}")
            serial_port = None  # Trigger reconnection
            await broadcast(json.dumps({"type": "bridge_status", "serial": "disconnected", "error": str(e)}))
        except Exception as e:
            print(f"[ERR] Reader error: {e}")
            
        await asyncio.sleep(0.01)

async def status_poll():
    """Poll grblHAL status"""
    while True:
        if connected_clients and serial_port and serial_port.is_open:
            await send_gcode('?')
        await asyncio.sleep(0.25)

async def vfd_reader():
    """Read ESP32 VFD controller and update status"""
    global vfd_port, vfd_status
    buffer = ""
    
    while True:
        try:
            if vfd_port and vfd_port.is_open:
                if vfd_port.in_waiting:
                    data = vfd_port.read(vfd_port.in_waiting).decode('utf-8', errors='replace')
                    buffer += data
                    
                    while '\n' in buffer:
                        line, buffer = buffer.split('\n', 1)
                        line = line.strip()
                        if line.startswith('{'):
                            try:
                                msg = json.loads(line)
                                # Update VFD status from ESP32
                                if 'vfd' in msg:
                                    vfd_status.update(msg['vfd'])
                                    # Broadcast to clients
                                    await broadcast(json.dumps({"type": "vfd_status", **msg['vfd']}))
                                elif 'cmd' in msg:
                                    # Command response
                                    await broadcast(json.dumps({"type": "vfd_response", **msg}))
                                elif 'error' in msg:
                                    print(f"[VFD] Error: {msg['error']}")
                            except json.JSONDecodeError:
                                pass
                        elif line and not line.startswith('[DEBUG]'):
                            print(f"[VFD] {line}")
        except Exception as e:
            print(f"[ERR] VFD reader error: {e}")
            
        await asyncio.sleep(0.01)

async def vfd_poll():
    """Poll VFD status periodically"""
    while True:
        if vfd_port and vfd_port.is_open:
            await send_vfd_command('STATUS')
        await asyncio.sleep(0.5)  # 2Hz poll rate

async def websocket_handler(request):
    """Handle WebSocket connections"""
    # CRITICAL SAFETY: Limit max clients to prevent DoS
    if len(connected_clients) >= MAX_CLIENTS:
        print(f"[SECURITY] Rejecting client - max {MAX_CLIENTS} reached")
        return web.Response(status=503, text="Server full - max connections reached")
    
    ws = web.WebSocketResponse()
    await ws.prepare(request)
    
    client_ip = request.remote or "unknown"
    print(f"[WS+] Client connected: {client_ip} ({len(connected_clients)+1}/{MAX_CLIENTS})")
    connected_clients.add(ws)
    
    # Send status
    try:
        status = "connected" if (serial_port and serial_port.is_open) else "disconnected"
        await ws.send_str(json.dumps({"type": "bridge_status", "serial": status}))
        if serial_port and serial_port.is_open:
            await send_gcode('?')
    except:
        pass
    
    try:
        async for msg in ws:
            if msg.type == aiohttp.WSMsgType.TEXT:
                message = msg.data
                if message.startswith('{'):
                    try:
                        cmd = json.loads(message)
                        if cmd.get('type') == 'gcode':
                            await send_gcode(cmd.get('command', ''))
                        elif cmd.get('type') == 'realtime':
                            # CRITICAL SAFETY: Use validated realtime sender
                            char = cmd.get('char', '')
                            if char:
                                await send_realtime(char)
                        elif cmd.get('type') == 'vfd':
                            # Forward VFD commands to ESP32
                            vfd_cmd = cmd.get('command', '')
                            if vfd_cmd:
                                await send_vfd_command(vfd_cmd)
                    except json.JSONDecodeError:
                        print(f"[WARN] Invalid JSON from client: {message[:50]}")
                    except Exception as e:
                        print(f"[ERR] Command processing error: {e}")
                else:
                    await send_gcode(message)
            elif msg.type == aiohttp.WSMsgType.ERROR:
                break
    except Exception as e:
        print(f"[ERR] WebSocket error: {e}")
    finally:
        connected_clients.discard(ws)
        print(f"[WS-] Client disconnected: {client_ip}")
    
    return ws

async def on_startup(app):
    """Start background tasks"""
    asyncio.create_task(serial_reader())
    asyncio.create_task(status_poll())
    asyncio.create_task(vfd_reader())
    asyncio.create_task(vfd_poll())

def main():
    parser = argparse.ArgumentParser(description='FluidCNC Bridge Server')
    parser.add_argument('--port', type=int, default=8080, help='HTTP/WebSocket port')
    parser.add_argument('--com', type=str, default=None, help='grblHAL serial port')
    parser.add_argument('--vfd', type=str, default=None, help='ESP32 VFD controller port')
    parser.add_argument('--baud', type=int, default=115200, help='Baud rate')
    args = parser.parse_args()
    
    # Initialize serial before starting server
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    
    com_port = args.com or find_grbl_port() or 'COM5'
    loop.run_until_complete(init_serial(com_port, args.baud))
    
    # Initialize VFD controller if specified or auto-detect
    vfd_com = args.vfd
    if not vfd_com:
        esp_ports = find_esp32_ports()
        # Use first ESP32 port that isn't the grblHAL port
        for p in esp_ports:
            if p != com_port:
                vfd_com = p
                break
    if vfd_com:
        loop.run_until_complete(init_vfd(vfd_com))
    
    # Get local IP
    import socket
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        local_ip = s.getsockname()[0]
        s.close()
    except:
        local_ip = "localhost"
    
    print(f"\n{'='*50}")
    print(f"  FluidCNC Bridge Server")
    print(f"{'='*50}")
    print(f"  Local:     http://localhost:{args.port}")
    print(f"  Network:   http://{local_ip}:{args.port}")
    print(f"  WebSocket: ws://{local_ip}:{args.port}/ws")
    print(f"  grblHAL:   {com_port} @ {args.baud}")
    print(f"  VFD:       {vfd_com or 'not connected'}")
    print(f"{'='*50}\n")
    
    # Handler to serve index.html at root
    async def index_handler(request):
        return web.FileResponse(STATIC_DIR / 'index.html')
    
    # Handler to serve static files
    async def static_handler(request):
        filename = request.match_info.get('filename', '')
        filepath = STATIC_DIR / filename
        if filepath.exists() and filepath.is_file():
            return web.FileResponse(filepath)
        return web.Response(status=404, text=f"Not found: {filename}")
    
    # Create app
    app = web.Application()
    app.router.add_get('/', index_handler)
    app.router.add_get('/ws', websocket_handler)
    app.router.add_get('/{filename:.*}', static_handler)
    app.on_startup.append(on_startup)
    
    # Run server
    try:
        web.run_app(app, host='0.0.0.0', port=args.port)
    except KeyboardInterrupt:
        print("\nServer stopped.")

if __name__ == '__main__':
    main()
