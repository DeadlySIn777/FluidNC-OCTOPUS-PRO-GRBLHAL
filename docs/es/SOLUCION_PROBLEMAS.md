# Guía de Solución de Problemas

Problemas comunes y soluciones para grblHAL en BTT Octopus Pro.

Idioma: Español | English: [docs/en/TROUBLESHOOTING.md](../en/TROUBLESHOOTING.md)

## 📋 Índice

- [Problemas de Conexión](#problemas-de-conexión)
- [Problemas de Motores](#problemas-de-motores)
- [Problemas de Drivers TMC](#problemas-de-drivers-tmc)
- [Problemas de Finales de Carrera](#problemas-de-finales-de-carrera)
- [Fallas de Homing](#fallas-de-homing)
- [Problemas del Husillo](#problemas-del-husillo)
- [Problemas de Sonda](#problemas-de-sonda)
- [Códigos de Alarma](#códigos-de-alarma)
- [Firmware y Flasheo](#firmware-y-flasheo)

---

## Problemas de Conexión

### Placa No Detectada (Sin Puerto COM)

**Síntomas:**
- Administrador de Dispositivos no muestra nada nuevo al conectar USB
- "Dispositivo desconocido" en Administrador de Dispositivos

**Soluciones:**

1. **Instalar Drivers CH340/CP2102**
   - Descargar de [Silicon Labs](https://www.silabs.com/developers/usb-to-uart-bridge-vcp-drivers)
   - Instalar y reiniciar computadora

2. **Probar Diferente Cable USB**
   - Algunos cables son solo de carga (sin líneas de datos)
   - Usar cable que vino con la placa

3. **Verificar Puerto USB**
   - Probar diferente puerto USB (preferir puertos traseros)
   - Evitar hubs USB

4. **Verificar Jumper BOOT0**
   - Debe estar en posición NORMAL (no DFU)
   - Modo DFU = sin serial CDC

### Puerto COM Abre Pero Sin Respuesta

**Síntomas:**
- Puerto COM visible pero sin respuesta a `$$`
- Terminal no muestra nada

**Soluciones:**

1. **Verificar Velocidad de Baudios**
   - Debe ser 115200 (no 9600)
   
2. **Verificar Configuración de Terminal**
   - 8 bits de datos, sin paridad, 1 bit de parada
   - Sin control de flujo

3. **Probar Diferente Terminal**
   - PuTTY, Tera Term, o consola de software CNC

4. **Verificar Firmware**
   - Puede necesitar reflashear grblHAL

---

## Problemas de Motores

### Motor Hace Ruido Pero No Gira

**Síntomas:**
- Zumbido agudo o rechinido
- El eje vibra pero no rota

**Causa:** Cables de bobina están cruzados

**Solución:**
```
Intercambiar dos cables de UNA SOLA bobina:
1A ↔ 1B  O  2A ↔ 2B (¡no ambos!)
```

### Motor Gira en Dirección Incorrecta

**Síntomas:**
- El eje se mueve opuesto a lo esperado

**Soluciones:**

1. **Corrección por Software (Preferida)**
   ```gcode
   $3=1    ; Invertir dirección X
   $3=2    ; Invertir dirección Y
   $3=4    ; Invertir dirección Z
   $3=5    ; Invertir X y Z
   ```

2. **Corrección por Hardware**
   - Intercambiar cables de UNA bobina (1A↔1B o 2A↔2B)

### Motor Pierde Pasos

**Síntomas:**
- La posición se desplaza con el tiempo
- Las piezas tienen tamaño incorrecto
- Los círculos no son redondos

**Soluciones:**

1. **Reducir Velocidad**
   ```gcode
   $110=2000   ; Reducir velocidad máxima
   ```

2. **Reducir Aceleración**
   ```gcode
   $120=100    ; Reducir aceleración
   ```

3. **Aumentar Corriente (TMC UART)**
   ```gcode
   $338=800    ; Aumentar corriente del motor
   ```

4. **Verificar Problemas Mecánicos**
   - Acoplamiento suelto
   - Atascamiento o fricción
   - Eje sobrecargado

### Motor Se Sobrecalienta

**Síntomas:**
- Motor muy caliente al tacto
- Apagado térmico del driver

**Soluciones:**

1. **Reducir Corriente**
   ```gcode
   $338=500    ; Bajar corriente a 500mA
   ```

2. **Habilitar SpreadCycle** (mejor térmico)
   ```gcode
   $14=0       ; Modo SpreadCycle
   ```

3. **Agregar Enfriamiento**
   - Ventilador en motor y driver
   - Disipador en driver

---

## Problemas de Drivers TMC

### Error de Comunicación UART

**Síntomas:**
- Mensajes de error sobre TMC
- Configuraciones de driver no se aplican
- Motores funcionan en modo por defecto

**Soluciones:**

1. **Verificar Asentamiento del Driver**
   - Remover y reinstalar driver
   - Asegurar que todos los pines estén conectados

2. **Verificar Jumper UART**
   - Jumpers MS1/MS2 pueden necesitar configuración específica
   - Consultar documentación del driver

3. **Verificar Firmware**
   - Debe estar compilado con soporte TMC UART
   - Usar entorno correcto de PlatformIO

### Sobretemperatura del Driver

**Síntomas:**
- Driver se apaga a mitad del trabajo
- Advertencia térmica (si es visible)

**Soluciones:**

1. **Reducir Corriente**
2. **Agregar Enfriamiento Activo**
3. **Verificar Jumper de Voltaje**
   - Configuración de voltaje incorrecta causa calor excesivo

### StallGuard No Funciona

**Síntomas:**
- Homing sin sensores choca contra los extremos
- Falsas detecciones durante movimiento

**Soluciones:**

1. **Ajustar Sensibilidad**
   ```gcode
   $337=50     ; Probar diferentes valores (0-255)
   ```
   - Menor = más sensible
   - Mayor = menos sensible

2. **Reducir Velocidad de Homing**
   ```gcode
   $24=50      ; Tasa de búsqueda más lenta
   ```

3. **Usar Finales de Carrera Físicos**
   - Más confiables que StallGuard

---

## Problemas de Finales de Carrera

### Límite Siempre Activado

**Síntomas:**
- Estado muestra límite activo todo el tiempo
- No puede mover ni hacer homing

**Soluciones:**

1. **Verificar Configuración NC/NO**
   ```gcode
   $5=0    ; Para switches NC (más común)
   $5=7    ; Para switches NO (invertidos)
   ```

2. **Verificar Cableado**
   - Switches NC: señal entre SIG y GND
   - Switches NO: señal entre SIG y VCC

3. **Verificar Cortocircuito**
   - Desconectar switch y probar con comando `?`

### Límite Nunca Se Activa

**Síntomas:**
- La máquina choca contra el extremo
- Homing falla con "no se encontró switch"

**Soluciones:**

1. **Verificar Cableado**
   - Usar multímetro para verificar switch
   - Verificar que continuidad cambie al activar

2. **Verificar Inversión**
   - Probar configuración opuesta
   ```gcode
   $5=7    ; Si actualmente es 0
   ```

3. **Verificar Pin**
   - Asegurar que se use conector correcto (MIN1, MIN2, etc.)

---

## Fallas de Homing

### Error: "Falla homing - retroceso"

**Causa:** Switch todavía activado después del retroceso

**Soluciones:**

1. **Aumentar Distancia de Retroceso**
   ```gcode
   $27=5       ; Retroceso de 5mm
   ```

2. **Verificar Posición del Switch**
   - El switch puede estar muy cerca del final del recorrido

### Error: "Falla homing - sin switch"

**Causa:** Switch no encontrado dentro del recorrido

**Soluciones:**

1. **Verificar Cableado** (ver sección de finales de carrera)

2. **Aumentar Recorrido**
   ```gcode
   $130=1000   ; Aumentar recorrido máximo X
   ```

3. **Reducir Tasa de Búsqueda**
   ```gcode
   $24=100     ; Homing más lento
   ```

### Error: "Falla homing - reset"

**Causa:** Límite activado antes de iniciar homing

**Soluciones:**

1. **Moverse Fuera del Límite Primero**
   ```gcode
   $X          ; Limpiar alarma
   G91 G0 X10  ; Joggear fuera del límite
   $H          ; Hacer homing otra vez
   ```

2. **Verificar Suciedad**
   - El switch puede estar físicamente atascado

---

## Problemas del Husillo

### El Husillo No Arranca

**Síntomas:**
- Comando M3 no hace nada
- Sin salida PWM

**Soluciones:**

1. **Verificar Configuraciones**
   ```gcode
   $30=24000   ; RPM máx
   $32=1       ; Modo husillo (no láser)
   ```

2. **Verificar Pin**
   - PWM en PA8 (conector FAN0)
   - Verificar cableado al VFD

3. **Probar con Comando**
   ```gcode
   M3 S12000   ; 50% velocidad
   ```

### Velocidad del Husillo Incorrecta

**Síntomas:**
- RPM no coincide con velocidad comandada

**Soluciones:**

1. **Calibrar $30**
   ```gcode
   $30=24000   ; Establecer al RPM máx real
   ```

2. **Verificar Configuraciones del VFD**
   - Asegurar que rango de frecuencia del VFD coincida

### El Husillo Gira al Revés

**Solución:**
- Intercambiar dos cables del motor (VFD al husillo)
- O usar M4 en vez de M3

---

## Problemas de Sonda

### Sonda No Detectada

**Síntomas:**
- G38.2 corre hasta chocar
- Estado de sonda nunca muestra activado

**Soluciones:**

1. **Verificar Cableado**
   - Sonda en PB6 (conector Z-Probe Izq)
   - Conexión GND requerida

2. **Verificar Inversión**
   ```gcode
   $6=0    ; Normal (sonda NO)
   $6=1    ; Invertido (sonda NC)
   ```

3. **Probar Manualmente**
   - Cortocircuitar pines de sonda y verificar estado con `?`

### Sonda Ya Activada

**Síntomas:**
- Error antes de iniciar palpado
- Alarma "estado inicial sonda"

**Soluciones:**

1. **Verificar Cortocircuito**
2. **Verificar Configuración $6**
3. **Verificar Cableado de Sonda**

---

## Códigos de Alarma

### Referencia Rápida

| Alarma | Mensaje | Solución |
|--------|---------|----------|
| 1 | Límite duro | Verificar switches, `$X` para limpiar |
| 2 | Límite suave | Mover dentro del área de trabajo |
| 3 | Abortar durante ciclo | Reiniciar |
| 4 | Falla de sonda | Verificar cableado de sonda |
| 5 | Estado inicial sonda | Sonda ya activada |
| 6 | Falla homing - reset | Mover del límite, hacer homing |
| 7 | Falla homing - puerta | Cerrar puerta de seguridad |
| 8 | Falla homing - retroceso | Aumentar $27 |
| 9 | Falla homing - switch | Verificar cableado de límites |

### Limpiar Alarmas

```gcode
$X      ; Desbloquear después de alarma
<ctrl+x> ; Reset suave
```

### Deshabilitar Alarmas (¡Solo para Pruebas!)

```gcode
$21=0   ; Deshabilitar límites duros (¡PELIGROSO!)
$20=0   ; Deshabilitar límites suaves
```

⚠️ **Advertencia:** Solo deshabilitar para pruebas. ¡Rehabilitar por seguridad!

---

## Firmware y Flasheo

### Entrar en Modo DFU

1. Apagar la placa
2. Mover jumper BOOT0 a posición 3.3V
3. Encender la placa
4. Flashear firmware
5. Mover BOOT0 de vuelta a posición GND
6. Ciclo de encendido

### Flasheo Falla - "No hay dispositivo DFU"

**Soluciones:**

1. **Instalar Drivers DFU STM32**
   - Usar Zadig para instalar driver WinUSB
   
2. **Verificar Jumper BOOT0**
   - Debe estar en lado de 3.3V
   
3. **Usar STM32CubeProgrammer**
   - Más confiable que dfu-util

### Firmware Incorrecto Flasheado

**Síntomas:**
- La placa no responde
- Pinouts incorrectos
- Funciones faltantes

**Solución:**
1. Reflashear con firmware correcto:
   - F429 → Usar firmware F429
   - F446 → Usar firmware F446
   - V1.0 → Usar mapa V1.0
   - V1.1 → Usar mapa V1.1

---

## Comandos de Diagnóstico

### Verificar Todo

```gcode
$$      ; Todas las configuraciones
$I      ; Info del firmware
$#      ; Offsets de coordenadas
$G      ; Estado del parser
?       ; Estado tiempo real (muestra límites, sonda, pines)
```

### Interpretación de Estado en Tiempo Real

```
<Idle|MPos:0.000,0.000,0.000|Pn:XYZ|WCO:0.000,0.000,0.000>
       │                          │
       │                          └── Pines activos (límites)
       └── Posición de máquina

Pn: muestra qué pines están activos
X = límite X
Y = límite Y  
Z = límite Z
P = Sonda
H = Hold (botón pausa)
D = Puerta
R = Reset
```

---

## Obtener Ayuda

1. **Wiki de grblHAL**: https://github.com/grblHAL/core/wiki
2. **Discord**: Comunidad grblHAL
3. **GitHub Issues**: Reportar bugs con detalles completos

Al pedir ayuda, proporcionar:
- Salida de `$$` (todas las configuraciones)
- Salida de `$I` (versión del firmware)
- Mensaje de error exacto o código de alarma
- Descripción de lo que intentas hacer
