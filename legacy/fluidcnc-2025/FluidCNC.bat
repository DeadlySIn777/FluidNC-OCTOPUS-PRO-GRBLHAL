@echo off
title FluidCNC Server
cd /d "%~dp0"

echo ========================================
echo   FluidCNC Web Server
echo   Local:  http://localhost:8080
echo   WiFi:   http://192.168.0.72:8080
echo ========================================
echo.
echo Press Ctrl+C to stop the server.
echo.

:: Start Chrome after a short delay (in background)
start "" cmd /c "timeout /t 2 /nobreak >nul && start http://localhost:8080"

:: Run the server bound to all interfaces
py -m http.server 8080 --bind 0.0.0.0

pause
