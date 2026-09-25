#!/bin/bash
#
# FluidCNC - Quick Development Server
# Starts a simple HTTP server for local testing
#

PORT=${1:-8080}
DIR="$(cd "$(dirname "$0")/.." && pwd)"

echo ""
echo "╔═══════════════════════════════════════════════════════════╗"
echo "║         FluidCNC Development Server                       ║"
echo "╚═══════════════════════════════════════════════════════════╝"
echo ""
echo "  Starting server at: http://localhost:$PORT"
echo "  Serving from: $DIR"
echo ""
echo "  Press Ctrl+C to stop"
echo ""

cd "$DIR"

# Try Python 3 first, then Python 2
if command -v python3 &> /dev/null; then
    python3 -m http.server $PORT
elif command -v python &> /dev/null; then
    python -m SimpleHTTPServer $PORT
else
    echo "Error: Python not found. Please install Python 3."
    exit 1
fi
