# grblHAL para BTT Octopus Pro v1.1 (STM32F446)

Firmware CNC completo para la placa BTT Octopus Pro v1.1 con procesador STM32F446.

## 🚀 Instalación Rápida

### Opción 1: Script Automático (Recomendado)
```powershell
# Ejecutar como Administrador
.\build_and_flash.bat
```

### Opción 2: Manual
```powershell
# Clonar repositorio
git clone --recurse-submodules https://github.com/grblHAL/STM32F4xx.git grblHAL-STM32F4xx
cd grblHAL-STM32F4xx

# Copiar configuración
copy ..\platformio_octopus_pro_v11.ini platformio.ini

# Compilar
pio run -e btt_octopus_pro_v11_f446

# Flashear (ver sección DFU abajo)
pio run -e btt_octopus_pro_v11_f446 -t upload
```

---

## 🔌 Conexiones de Hardware

### Motores Paso a Paso (TMC2209)

| Eje | Step | Dir | Enable | UART | Límite | Slot |
|-----|------|-----|--------|------|--------|------|
| **X** | PF13 | PF12 | PF14 | PC4 | PG6 (MIN1) | Motor 0 |
| **Y** | PG0 | PG1 | PF15 | PD11 | PG9 (MIN2) | Motor 1 |
| **Z** | PF11 | PG3 | PG5 | PC6 | PG10 (MIN3) | Motor 2 |
| A | PG4 | PC1 | PA0 | PC7 | PG11 (MIN4) | Motor 3 |

### Control del Husillo (Spindle)

| Función | Header | Pin | Señal |
|---------|--------|-----|-------|
| PWM / Velocidad | FAN0 | PA8 | 0-10V o PWM |
| Habilitación | FAN4 | PD14 | On/Off |
| Dirección | FAN5 | PE15 | CW/CCW |

### Sondas (Probes)

| Función | Header | Pin | Uso |
|---------|--------|-----|-----|
| Sonda de Toque | Z-Probe Izq | PB6 | Palpador de pieza |
| Medidor de Herramienta | Z-Probe Der | PB7 | Sensor fijo de longitud |

### Refrigerante

| Función | Header | Pin | Código-M |
|---------|--------|-----|----------|
| Refrigerante (Flood) | HE0 | **PA2** | M8/M9 |
| Niebla (Mist) | HE1 | PA3 | M7/M9 |

### Salidas Auxiliares (M62-M65)

| Puerto | Header | Pin | M-Code ON | M-Code OFF | Asignación |
|--------|--------|-----|-----------|------------|------------|
| P0 | HE2 | **PB10** | M64 P0 | M65 P0 | Aspiradora |
| P1 | FAN1 | PE5 | M64 P1 | M65 P1 | Protector de Polvo |
| P2 | FAN2 | PD12 | M64 P2 | M65 P2 | Disponible |
| P3 | FAN3 | PD13 | M64 P3 | M65 P3 | Disponible |

---

## ⚡ Cambios en v1.1 vs v1.0

| Pin | v1.0 | v1.1 |
|-----|------|------|
| HE0 (Flood) | PA0 | **PA2** |
| HE2 | PB0 | **PB10** |
| Motor4-EN | PA2 | **PA0** |
| RGB | PB10 | **PB0** |

⚠️ **IMPORTANTE**: El mapa de pines de grblHAL ya maneja estos cambios automáticamente.

---

## 🔧 Flashear Firmware via DFU

### Paso 1: Entrar en Modo DFU
1. **Apagar** la placa
2. Colocar jumper **BOOT0** en posición HIGH (lado 3.3V)
3. Conectar cable USB
4. **Encender** la placa
5. Verificar en Administrador de Dispositivos: debe aparecer "STM32 BOOTLOADER"

### Paso 2: Flashear
```powershell
pio run -e btt_octopus_pro_v11_f446 -t upload
```

### Paso 3: Arranque Normal
1. **Apagar** la placa
2. **Quitar** jumper BOOT0
3. Encender → debe aparecer puerto COM

---

## ⚙️ Configuración grblHAL

### Configuración BAKED en el Firmware (NEMA17 60Ncm)

Los siguientes parámetros ya están compilados en el firmware - **no necesitas configurarlos manualmente**:

| Parámetro | X | Y | Z | Descripción |
|-----------|---|---|---|-------------|
| $100-102 | 400 | 400 | 400 | Pasos/mm (16 microsteps, 8mm lead) |
| $110-112 | 5000 | 5000 | 2000 | Velocidad máx (mm/min) |
| $120-122 | 400 | 400 | 250 | Aceleración (mm/s²) |
| $130-132 | 350 | 500 | 120 | Recorrido máx (mm) |
| $140-142 | 2000 | 2000 | 2000 | Corriente run (mA) |
| $143-145 | 1000 | 1000 | 1000 | Corriente hold (mA) |
| $21 | 7 | - | - | Hard limits (X+Y+Z) |
| $22 | 7 | - | - | Homing habilitado |

**Motor:** StepperOnline 60Ncm, 2.1A rated, 1.7Ω, 200 steps/rev

### Parámetros que SÍ necesitas configurar

```
$23=0          ; Inversión dirección homing (ajustar según máquina)
$24=100        ; Velocidad de homing lenta (mm/min)
$25=1500       ; Velocidad de homing rápida (mm/min)
$26=25         ; Debounce homing (ms)
$27=3.0        ; Retroceso después de homing (mm)
```

### Verificar configuración después de flashear

```
$$             ; Ver todos los parámetros
$I             ; Info de sistema
$TPW           ; Ver corrientes Trinamic
$T0            ; Ver configuración TMC eje X
```

---

## 🔴 Solución de Problemas

### No aparece puerto COM después de flashear
- Verificar que quitaste el jumper BOOT0
- Probar otro cable USB (debe soportar datos, no solo carga)
- Reinstalar driver CH340/CP2102 si es necesario

### Error "DFU device not found"
- Verificar jumper BOOT0 está en HIGH
- Probar puerto USB diferente (preferir puertos traseros)
- Instalar STM32CubeProgrammer para drivers DFU

### Los motores no se mueven
- Verificar voltaje seleccionado con jumpers (24V vs 60V)
- Verificar que TMC2209 están en modo standalone (sin UART) o configurar UART
- Comprobar conexiones STEP/DIR/EN

### Errores de alarma frecuentes
| Código | Alarma | Solución |
|--------|--------|----------|
| 1 | Límite duro activado | `$X` para desbloquear, re-home |
| 2 | Límite suave - fuera de rango | Verificar coordenadas G-code |
| 9 | Switch límite no encontrado | Verificar cableado |
| 11 | Homing requerido | Ejecutar `$H` |

---

## 📁 Archivos Incluidos

| Archivo | Descripción |
|---------|-------------|
| `build_and_flash.bat` | Script automático de compilación y flasheo |
| `platformio_octopus_pro_v11.ini` | Configuración PlatformIO |
| `README.md` | Esta documentación |
| `CABLEADO.md` | Diagrama de cableado detallado |

---

## 🌐 Recursos

- [grblHAL GitHub](https://github.com/grblHAL/STM32F4xx)
- [BTT Octopus Pro GitHub](https://github.com/bigtreetech/BIGTREETECH-OCTOPUS-Pro)
- [FluidCNC Web UI](../fluidcnc/) - Interfaz web para control

---

## 📞 Soporte

Para problemas específicos de grblHAL: https://github.com/grblHAL/STM32F4xx/issues
