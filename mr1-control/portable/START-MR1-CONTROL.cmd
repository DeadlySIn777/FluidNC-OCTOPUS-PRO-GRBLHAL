@echo off
setlocal
cd /d "%~dp0"
title MR-1 CONTROL - READ-ONLY TEST

if not exist "runtime\node.exe" (
  echo MR-1 Control cannot find its bundled runtime.
  echo Extract the entire ZIP before starting the app.
  echo.
  pause
  exit /b 1
)

"runtime\node.exe" "portable-server.mjs"
if errorlevel 1 (
  echo.
  echo MR-1 Control did not start. Close any older MR-1 Control window and try again.
  echo.
  pause
)
