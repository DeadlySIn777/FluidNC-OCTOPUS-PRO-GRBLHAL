@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0START-MR1-NATIVE.ps1"
if errorlevel 1 pause
