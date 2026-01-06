@echo off
title FluidCNC Server
cd /d "%~dp0"

echo ========================================
echo   FluidCNC - Starting Server...
echo ========================================
echo.

:: Start Chrome after a short delay (in background)
start "" cmd /c "timeout /t 2 /nobreak >nul && start http://localhost:8080"

:: Run the server (this will block until you close the window)
py -m http.server 8080

pause
