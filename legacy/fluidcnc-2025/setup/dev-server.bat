@echo off
REM FluidCNC - Quick Development Server for Windows
REM Starts a simple HTTP server for local testing

set PORT=%1
if "%PORT%"=="" set PORT=8080

echo.
echo ╔═══════════════════════════════════════════════════════════╗
echo ║         FluidCNC Development Server                       ║
echo ╚═══════════════════════════════════════════════════════════╝
echo.
echo   Starting server at: http://localhost:%PORT%
echo   Press Ctrl+C to stop
echo.

cd /d "%~dp0\.."

REM Try Python
where python >nul 2>nul
if %ERRORLEVEL% EQU 0 (
    python -m http.server %PORT%
) else (
    echo Error: Python not found. Please install Python 3.
    echo Download from: https://www.python.org/downloads/
    pause
    exit /b 1
)
