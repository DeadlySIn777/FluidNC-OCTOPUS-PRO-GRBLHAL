#!/usr/bin/env python3
"""
HTTPS server for FluidCNC - enables WebSerial on remote devices.

Usage:
    python https-server.py [port]
    
Default port is 8443. Access from:
    - Local: https://localhost:8443
    - Remote: https://<your-ip>:8443

First time setup:
    python generate-cert.py
"""

import http.server
import ssl
import os
import sys
import socket

def get_local_ip():
    """Get the local IP address of this machine."""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except:
        return "Unknown"

def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8443
    
    # Check for certificate files
    if not os.path.exists("server.crt") or not os.path.exists("server.key"):
        print("❌ Certificate files not found!")
        print("   Run: python generate-cert.py")
        print("   Then try again.")
        sys.exit(1)
    
    # Create HTTPS server
    server_address = ('', port)
    httpd = http.server.HTTPServer(server_address, http.server.SimpleHTTPRequestHandler)
    
    # Wrap with SSL
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.load_cert_chain('server.crt', 'server.key')
    httpd.socket = context.wrap_socket(httpd.socket, server_side=True)
    
    local_ip = get_local_ip()
    
    print("=" * 60)
    print("  FluidCNC HTTPS Server")
    print("=" * 60)
    print(f"\n  Local:   https://localhost:{port}")
    print(f"  Network: https://{local_ip}:{port}")
    print(f"\n  WebSerial will work from any device on your network!")
    print("\n  ⚠️  First visit: Accept the 'Not Secure' warning")
    print("     Click 'Advanced' → 'Proceed to site'")
    print("\n  Press Ctrl+C to stop")
    print("=" * 60)
    
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n\nServer stopped.")

if __name__ == "__main__":
    main()
