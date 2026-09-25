@echo off
setlocal
cd /d "%~dp0"
title MR-1 CONTROL - PAIRED PHONE TEST

if not exist "runtime\node.exe" (
  echo MR-1 Control cannot find its bundled runtime.
  echo Extract the entire ZIP before starting the app.
  echo.
  pause
  exit /b 1
)

"runtime\node.exe" "portable-server.mjs" --lan
if errorlevel 1 (
  echo.
  echo MR-1 Control phone test did not start. Close older launchers and try again.
  echo.
  pause
)
