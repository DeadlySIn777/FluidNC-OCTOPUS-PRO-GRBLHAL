@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

echo.
echo ╔══════════════════════════════════════════════════════════════════╗
echo ║   grblHAL - BTT Octopus Pro Build ^& Flash Tool                  ║
echo ║   Supports: STM32F429 ^& STM32F446                               ║
echo ╚══════════════════════════════════════════════════════════════════╝
echo.

set "SCRIPT_DIR=%~dp0"
set "REPO_DIR=%SCRIPT_DIR%.."
set "GRBLHAL_DIR=%REPO_DIR%\grblHAL-STM32F4xx"
set "PIO_PATH=%USERPROFILE%\.platformio\penv\Scripts\pio.exe"

:: Check PlatformIO
if not exist "%PIO_PATH%" (
    echo [ERROR] PlatformIO not found.
    echo.
    echo Please install VS Code with PlatformIO extension:
    echo https://platformio.org/install/ide?install=vscode
    echo.
    pause
    exit /b 1
)

echo [OK] PlatformIO found
echo.

:MENU
echo ═══════════════════════════════════════════════════════════════════
echo   SELECT YOUR BOARD
echo ═══════════════════════════════════════════════════════════════════
echo.
echo   STM32F429 (Octopus Pro v1.0.1 or v1.1 with F429):
echo   ─────────────────────────────────────────────────
echo   1. F429 + TMC2209 (UART)
echo   2. F429 + TMC2209 (Standalone)
echo   3. F429 + TMC5160 (SPI)
echo   4. F429 + TMC2130 (SPI)
echo.
echo   STM32F446 (Octopus Pro v1.1 with F446):
echo   ───────────────────────────────────────
echo   5. F446 + TMC2209 (UART)
echo   6. F446 + TMC2209 (Standalone)
echo   7. F446 + TMC5160 (SPI)
echo.
echo   Other Options:
echo   ──────────────
echo   8. DFU Mode Instructions
echo   9. Check COM Ports
echo   0. Exit
echo.
set /p CHOICE="Select option (0-9): "

if "%CHOICE%"=="1" set "ENV=btt_octopus_pro_f429" & set "CONFIG=platformio_f429.ini" & goto BUILD
if "%CHOICE%"=="2" set "ENV=btt_octopus_pro_f429_standalone" & set "CONFIG=platformio_f429.ini" & goto BUILD
if "%CHOICE%"=="3" set "ENV=btt_octopus_pro_f429_tmc5160" & set "CONFIG=platformio_f429.ini" & goto BUILD
if "%CHOICE%"=="4" set "ENV=btt_octopus_pro_f429_tmc2130" & set "CONFIG=platformio_f429.ini" & goto BUILD
if "%CHOICE%"=="5" set "ENV=btt_octopus_pro_v11_f446" & set "CONFIG=platformio_f446.ini" & goto BUILD
if "%CHOICE%"=="6" set "ENV=btt_octopus_pro_v11_f446_standalone" & set "CONFIG=platformio_f446.ini" & goto BUILD
if "%CHOICE%"=="7" set "ENV=btt_octopus_pro_v11_f446_tmc5160" & set "CONFIG=platformio_f446.ini" & goto BUILD
if "%CHOICE%"=="8" goto DFU_HELP
if "%CHOICE%"=="9" goto CHECK_COM
if "%CHOICE%"=="0" goto EXIT
goto MENU

:BUILD
echo.
echo ═══════════════════════════════════════════════════════════════════
echo   STEP 1: Cloning grblHAL repository...
echo ═══════════════════════════════════════════════════════════════════
echo.

if exist "%GRBLHAL_DIR%" (
    echo [INFO] Repository exists. Updating...
    cd "%GRBLHAL_DIR%"
    git pull
    git submodule update --init --recursive
) else (
    git clone --recurse-submodules https://github.com/grblHAL/STM32F4xx.git "%GRBLHAL_DIR%"
)

if errorlevel 1 (
    echo [ERROR] Failed to clone repository.
    pause
    goto MENU
)

echo.
echo ═══════════════════════════════════════════════════════════════════
echo   STEP 2: Copying configuration...
echo ═══════════════════════════════════════════════════════════════════
echo.

copy /y "%REPO_DIR%\configs\%CONFIG%" "%GRBLHAL_DIR%\platformio.ini"
echo [OK] Configuration copied: %CONFIG%

echo.
echo ═══════════════════════════════════════════════════════════════════
echo   STEP 3: Building firmware (%ENV%)...
echo ═══════════════════════════════════════════════════════════════════
echo.

cd "%GRBLHAL_DIR%"
"%PIO_PATH%" run -e %ENV%

if errorlevel 1 (
    echo.
    echo [ERROR] Build failed.
    pause
    goto MENU
)

echo.
echo ═══════════════════════════════════════════════════════════════════
echo   [OK] BUILD SUCCESSFUL!
echo ═══════════════════════════════════════════════════════════════════
echo.
echo   Firmware: %GRBLHAL_DIR%\.pio\build\%ENV%\firmware.bin
echo.

set /p FLASH_NOW="Flash now? (y/n): "
if /i "%FLASH_NOW%"=="y" goto FLASH
goto MENU

:FLASH
echo.
echo ═══════════════════════════════════════════════════════════════════
echo   FLASHING FIRMWARE
echo ═══════════════════════════════════════════════════════════════════
echo.
echo   IMPORTANT: Board must be in DFU mode!
echo.
echo   1. Power off the board
echo   2. Set BOOT0 jumper to HIGH (3.3V side)
echo   3. Connect USB and power on
echo   4. Press ENTER when ready...
echo.
pause

cd "%GRBLHAL_DIR%"
"%PIO_PATH%" run -e %ENV% -t upload

if errorlevel 1 (
    echo.
    echo [ERROR] Flash failed.
    echo.
    echo Possible causes:
    echo   - Board not in DFU mode
    echo   - DFU driver not installed
    echo   - Bad USB cable
    echo.
    echo Try installing STM32CubeProgrammer for DFU drivers.
    pause
    goto MENU
)

echo.
echo ═══════════════════════════════════════════════════════════════════
echo   [OK] FLASH SUCCESSFUL!
echo ═══════════════════════════════════════════════════════════════════
echo.
echo   NEXT STEPS:
echo   1. Power off the board
echo   2. REMOVE the BOOT0 jumper
echo   3. Power on - COM port should appear
echo.
pause
goto MENU

:DFU_HELP
echo.
echo ═══════════════════════════════════════════════════════════════════
echo   DFU MODE INSTRUCTIONS
echo ═══════════════════════════════════════════════════════════════════
echo.
echo   DFU (Device Firmware Upgrade) allows flashing via USB.
echo.
echo   TO ENTER DFU MODE:
echo   ──────────────────
echo   1. POWER OFF the board
echo.
echo   2. Locate BOOT0 jumper (near the STM32 processor)
echo.
echo   3. Move BOOT0 to HIGH position (3.3V side)
echo      ┌─────┐
echo      │ ■ ○ │  ^<- BOOT0 in HIGH position
echo      └─────┘
echo.
echo   4. Connect USB cable to PC
echo.
echo   5. POWER ON the board
echo.
echo   6. Check Device Manager:
echo      Should show "STM32 BOOTLOADER" or "DFU Device"
echo.
echo   AFTER FLASHING:
echo   ────────────────
echo   1. POWER OFF the board
echo   2. REMOVE BOOT0 jumper (return to normal position)
echo   3. Power on - COM port should appear
echo.
pause
goto MENU

:CHECK_COM
echo.
echo ═══════════════════════════════════════════════════════════════════
echo   CHECKING COM PORTS...
echo ═══════════════════════════════════════════════════════════════════
echo.
powershell -Command "Get-CimInstance Win32_PnPEntity | Where-Object { $_.Name -match 'COM\d+' } | Select-Object Name, Status | Format-Table -AutoSize"
echo.
pause
goto MENU

:EXIT
echo.
echo Goodbye!
echo.
exit /b 0
