@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

echo.
echo ╔══════════════════════════════════════════════════════════════╗
echo ║   grblHAL - BTT Octopus Pro v1.1 (STM32F446)                ║
echo ║   Script de Compilación y Flasheo Automático                 ║
echo ╚══════════════════════════════════════════════════════════════╝
echo.

set "SCRIPT_DIR=%~dp0"
set "GRBLHAL_DIR=%SCRIPT_DIR%grblHAL-STM32F4xx"
set "PIO_PATH=%USERPROFILE%\.platformio\penv\Scripts\pio.exe"

:: Verificar PlatformIO
if not exist "%PIO_PATH%" (
    echo [ERROR] PlatformIO no encontrado.
    echo.
    echo Instalando PlatformIO...
    echo Por favor instala VS Code con la extensión PlatformIO primero.
    echo https://platformio.org/install/ide?install=vscode
    echo.
    pause
    exit /b 1
)

echo [INFO] PlatformIO encontrado: %PIO_PATH%
echo.

:: Menu principal
:MENU
echo ═══════════════════════════════════════════════════════════════
echo   MENU PRINCIPAL
echo ═══════════════════════════════════════════════════════════════
echo.
echo   1. Instalación completa (clonar + compilar + flashear)
echo   2. Solo compilar (ya tengo el repositorio)
echo   3. Solo flashear (ya tengo firmware.bin)
echo   4. Entrar en modo DFU (instrucciones)
echo   5. Verificar puerto COM
echo   6. Abrir monitor serial
echo   7. Salir
echo.
set /p CHOICE="Selecciona una opción (1-7): "

if "%CHOICE%"=="1" goto FULL_INSTALL
if "%CHOICE%"=="2" goto BUILD_ONLY
if "%CHOICE%"=="3" goto FLASH_ONLY
if "%CHOICE%"=="4" goto DFU_INSTRUCTIONS
if "%CHOICE%"=="5" goto CHECK_COM
if "%CHOICE%"=="6" goto SERIAL_MONITOR
if "%CHOICE%"=="7" goto EXIT
goto MENU

:FULL_INSTALL
echo.
echo ═══════════════════════════════════════════════════════════════
echo   PASO 1: Clonando repositorio grblHAL...
echo ═══════════════════════════════════════════════════════════════
echo.

if exist "%GRBLHAL_DIR%" (
    echo [INFO] Repositorio ya existe. ¿Deseas actualizarlo?
    set /p UPDATE="Actualizar? (s/n): "
    if /i "!UPDATE!"=="s" (
        cd "%GRBLHAL_DIR%"
        git pull
        git submodule update --init --recursive
    )
) else (
    git clone --recurse-submodules https://github.com/grblHAL/STM32F4xx.git "%GRBLHAL_DIR%"
)

if errorlevel 1 (
    echo [ERROR] Fallo al clonar repositorio.
    echo Verifica tu conexión a internet y que Git esté instalado.
    pause
    goto MENU
)

echo.
echo ═══════════════════════════════════════════════════════════════
echo   PASO 2: Copiando configuración para Octopus Pro v1.1...
echo ═══════════════════════════════════════════════════════════════
echo.

copy /y "%SCRIPT_DIR%platformio_octopus_pro_v11.ini" "%GRBLHAL_DIR%\platformio.ini"

echo [OK] Configuración copiada.
echo.

:BUILD_ONLY
echo.
echo ═══════════════════════════════════════════════════════════════
echo   PASO 3: Compilando firmware...
echo ═══════════════════════════════════════════════════════════════
echo.

cd "%GRBLHAL_DIR%"
"%PIO_PATH%" run -e btt_octopus_pro_v11_f446

if errorlevel 1 (
    echo.
    echo [ERROR] Fallo en compilación.
    pause
    goto MENU
)

echo.
echo ═══════════════════════════════════════════════════════════════
echo   [OK] Compilación exitosa!
echo ═══════════════════════════════════════════════════════════════
echo.
echo   Firmware generado en:
echo   %GRBLHAL_DIR%\.pio\build\btt_octopus_pro_v11_f446\firmware.bin
echo.

set /p FLASH_NOW="¿Flashear ahora? (s/n): "
if /i "%FLASH_NOW%"=="s" goto FLASH_ONLY
goto MENU

:FLASH_ONLY
echo.
echo ═══════════════════════════════════════════════════════════════
echo   FLASHEANDO FIRMWARE
echo ═══════════════════════════════════════════════════════════════
echo.
echo   IMPORTANTE: La placa debe estar en modo DFU
echo.
echo   1. Apaga la placa
echo   2. Coloca jumper BOOT0 en posición HIGH (3.3V)
echo   3. Conecta USB y enciende
echo   4. Presiona ENTER cuando esté listo...
echo.
pause

cd "%GRBLHAL_DIR%"
"%PIO_PATH%" run -e btt_octopus_pro_v11_f446 -t upload

if errorlevel 1 (
    echo.
    echo [ERROR] Fallo en flasheo.
    echo.
    echo Posibles causas:
    echo   - Placa no está en modo DFU
    echo   - Driver DFU no instalado
    echo   - Cable USB defectuoso
    echo.
    echo Intenta instalar STM32CubeProgrammer para drivers DFU.
    pause
    goto MENU
)

echo.
echo ═══════════════════════════════════════════════════════════════
echo   [OK] FLASHEO EXITOSO!
echo ═══════════════════════════════════════════════════════════════
echo.
echo   SIGUIENTE PASO:
echo   1. Apaga la placa
echo   2. QUITA el jumper BOOT0
echo   3. Enciende - debe aparecer puerto COM
echo.
pause
goto MENU

:DFU_INSTRUCTIONS
echo.
echo ═══════════════════════════════════════════════════════════════
echo   INSTRUCCIONES MODO DFU (Device Firmware Upgrade)
echo ═══════════════════════════════════════════════════════════════
echo.
echo   El modo DFU permite flashear firmware via USB sin programador.
echo.
echo   PARA ENTRAR EN MODO DFU:
echo   ─────────────────────────
echo   1. APAGA la placa completamente
echo.
echo   2. Localiza el jumper BOOT0 en la placa
echo      (cerca del procesador STM32)
echo.
echo   3. Mueve BOOT0 a posición HIGH (lado 3.3V)
echo      ┌─────┐
echo      │ ■ ○ │  ← BOOT0 en HIGH
echo      └─────┘
echo.
echo   4. Conecta cable USB al PC
echo.
echo   5. ENCIENDE la placa
echo.
echo   6. Verifica en Administrador de Dispositivos:
echo      Debe aparecer "STM32 BOOTLOADER" o "DFU Device"
echo.
echo   DESPUÉS DE FLASHEAR:
echo   ─────────────────────
echo   1. APAGA la placa
echo   2. QUITA jumper BOOT0 (volver a posición normal)
echo   3. Enciende - aparecerá puerto COM
echo.
pause
goto MENU

:CHECK_COM
echo.
echo ═══════════════════════════════════════════════════════════════
echo   VERIFICANDO PUERTOS COM...
echo ═══════════════════════════════════════════════════════════════
echo.
powershell -Command "Get-CimInstance Win32_PnPEntity | Where-Object { $_.Name -match 'COM\d+' } | Select-Object Name, Status | Format-Table -AutoSize"
echo.
pause
goto MENU

:SERIAL_MONITOR
echo.
echo Abriendo monitor serial...
echo (Presiona Ctrl+C para salir)
echo.

:: Detectar puerto COM automáticamente
for /f "tokens=*" %%i in ('powershell -Command "(Get-CimInstance Win32_PnPEntity | Where-Object { $_.Name -match 'CP210|CH340|STM32|USB Serial' } | Select-Object -First 1).Name -replace '.*\((COM\d+)\).*','$1'"') do set COM_PORT=%%i

if "%COM_PORT%"=="" (
    set /p COM_PORT="Puerto COM no detectado. Ingresa manualmente (ej: COM6): "
)

echo Conectando a %COM_PORT% a 115200 baud...
"%PIO_PATH%" device monitor -p %COM_PORT% -b 115200

goto MENU

:EXIT
echo.
echo ¡Hasta luego!
echo.
exit /b 0
