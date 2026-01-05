# Guía de Configuración grblHAL

Guía completa para configurar grblHAL en BTT Octopus Pro.

Idioma: Español | English: [docs/en/CONFIGURATION.md](../en/CONFIGURATION.md)

## 📋 Índice

- [Conexión Inicial](#conexión-inicial)
- [Configuraciones Esenciales](#configuraciones-esenciales)
- [Configuración de Motores](#configuración-de-motores)
- [Configuración de Drivers TMC](#configuración-de-drivers-tmc)
- [Finales de Carrera](#finales-de-carrera)
- [Configuración del Husillo](#configuración-del-husillo)
- [Configuración de Homing](#configuración-de-homing)
- [Coordenadas de Trabajo](#coordenadas-de-trabajo)
- [Guardar Configuraciones](#guardar-configuraciones)

---

## Conexión Inicial

### Conexión Serial USB

1. Conectar cable USB-C a Octopus Pro
2. Abrir aplicación de terminal (interfaz CNC, PuTTY, etc.)
3. Seleccionar puerto COM (verificar en Administrador de Dispositivos en Windows)
4. Configuración: **115200 baud, 8-N-1**

### Verificar Conexión

```gcode
$I
```

Respuesta esperada:
```
[VER:1.1f.20XXXXXX:]
[OPT:VNMHTS,15,128,0]
```

---

## Configuraciones Esenciales

### Ver Todas las Configuraciones

```gcode
$$
```

### Configuraciones Principales de Máquina

| Configuración | Descripción | Ejemplo |
|---------------|-------------|---------|
| $0 | Pulso de paso (µs) | 10 |
| $1 | Retardo de inactividad (ms) | 25 |
| $2 | Inversión puerto step | 0 |
| $3 | Inversión puerto dirección | 5 (X+Z) |
| $4 | Inversión enable step | 0 |
| $5 | Inversión pines límite | 0 |
| $6 | Inversión pin sonda | 0 |
| $10 | Reporte de estado | 511 |
| $13 | Reportar pulgadas | 0 (mm) |

### Ejemplo: Configuración Básica de Router

```gcode
$0=10       ; Pulso step 10µs
$1=25       ; Retardo inactividad 25ms
$2=0        ; Sin inversión step
$3=0        ; Sin inversión dirección
$4=0        ; Sin inversión enable
$5=0        ; Límites NC (normal)
$6=0        ; Sonda NO (normal)
$10=511     ; Reporte completo
$13=0       ; Métrico (mm)
```

---

## Configuración de Motores

### Resolución de Ejes (Pasos/mm)

Calcular: `(Pasos motor × Micropasos) / (Paso × Relación polea)`

| Config | Eje | Ejemplo de Cálculo |
|--------|-----|-------------------|
| $100 | X | 200 × 16 / 5 = 640 pasos/mm |
| $101 | Y | 200 × 16 / 5 = 640 pasos/mm |
| $102 | Z | 200 × 16 / 2 = 1600 pasos/mm |
| $103 | A | Según necesidad |

**Ejemplos para configuraciones comunes:**

```gcode
; Correa GT2, polea 20T, motor 1.8°, 16 micropasos
$100=80     ; (200 × 16) / (2 × 20) = 80 pasos/mm

; Tornillo 8mm, motor 1.8°, 16 micropasos
$100=400    ; (200 × 16) / 8 = 400 pasos/mm

; Husillo de bolas 5mm, motor 1.8°, 16 micropasos
$100=640    ; (200 × 16) / 5 = 640 pasos/mm
```

### Velocidades Máximas (mm/min)

| Config | Eje | Descripción |
|--------|-----|-------------|
| $110 | X | Velocidad máxima |
| $111 | Y | Velocidad máxima |
| $112 | Z | Velocidad máxima |

```gcode
$110=3000   ; X máx 3000 mm/min
$111=3000   ; Y máx 3000 mm/min
$112=1000   ; Z máx 1000 mm/min (más lento)
```

### Aceleración (mm/seg²)

| Config | Eje | Descripción |
|--------|-----|-------------|
| $120 | X | Aceleración |
| $121 | Y | Aceleración |
| $122 | Z | Aceleración |

```gcode
$120=200    ; X acel 200 mm/s²
$121=200    ; Y acel 200 mm/s²
$122=50     ; Z acel 50 mm/s² (más suave)
```

### Recorrido Máximo (mm)

| Config | Eje | Descripción |
|--------|-----|-------------|
| $130 | X | Recorrido máx |
| $131 | Y | Recorrido máx |
| $132 | Z | Recorrido máx |

```gcode
$130=800    ; Recorrido X 800mm
$131=600    ; Recorrido Y 600mm
$132=100    ; Recorrido Z 100mm
```

---

## Configuración de Drivers TMC

### Modo UART (TMC2209/2208)

Con modo UART habilitado en firmware, usar estas configuraciones:

```gcode
$338=600    ; Driver 0 (X) corriente mA
$339=600    ; Driver 1 (Y) corriente mA
$340=600    ; Driver 2 (Z) corriente mA
$341=600    ; Driver 3 (A) corriente mA
$342=600    ; Driver 4 (B) corriente mA

$345=16     ; Driver 0 micropasos
$346=16     ; Driver 1 micropasos
$347=16     ; Driver 2 micropasos
$348=16     ; Driver 3 micropasos
$349=16     ; Driver 4 micropasos
```

### StealthChop vs SpreadCycle

```gcode
$14=0       ; StealthChop deshabilitado (solo SpreadCycle)
$14=1       ; StealthChop habilitado (operación silenciosa)
```

- **StealthChop**: Silencioso, bueno para bajas velocidades, menos torque
- **SpreadCycle**: Más ruidoso, mejor torque a altas velocidades

### Homing sin Sensores (TMC2209)

El homing sin sensores usa StallGuard para detectar límites:

```gcode
$22=1           ; Habilitar homing
$337=50         ; Sensibilidad StallGuard (0-255)

; Sensibilidad por eje (si está soportado)
; Valor menor = más sensible
```

⚠️ **¡Ajustar con cuidado!** Falsas detecciones causan choques.

---

## Finales de Carrera

### Habilitar Límites Duros

```gcode
$20=1       ; Límites suaves habilitados
$21=1       ; Límites duros habilitados
$22=1       ; Ciclo homing habilitado
```

### Inversión de Finales de Carrera

```gcode
$5=0        ; Switches NC (abierto = activado)
$5=7        ; Switches NO invertidos (los 3 ejes)
```

Máscara de bits: X=1, Y=2, Z=4 → sumar para combinación

### Verificar Estado de Límites

```gcode
?
```

La respuesta incluye `Pn:` seguido de límites activos (X, Y, Z)

---

## Configuración del Husillo

### Configuración PWM del Husillo

```gcode
$30=24000   ; Velocidad máx husillo (RPM)
$31=0       ; Velocidad mín husillo
$32=1       ; Modo láser deshabilitado (0=láser, 1=husillo)
$33=5000    ; Frecuencia PWM (Hz)
$34=0       ; Valor PWM apagado (0-100%)
$35=100     ; Valor PWM máx (0-100%)
$36=100     ; Valor PWM mín (0-100%)
```

### Salida VFD 0-10V

Para VFD con entrada 0-10V:

```gcode
$30=24000   ; Tu RPM máx del husillo
$31=6000    ; RPM mín (debajo de esto = APAGADO)
```

### Verificar Husillo

```gcode
M3 S12000   ; Husillo ON, 50% velocidad
M5          ; Husillo OFF
```

---

## Configuración de Homing

### Habilitar Homing

```gcode
$22=1       ; Habilitar ciclo homing
```

### Dirección de Homing

```gcode
$23=0       ; Home hacia negativo (-X, -Y, -Z)
$23=7       ; Home hacia positivo (+X, +Y, +Z)
$23=3       ; X+ Y+ Z- (máscara bits: X=1, Y=2, Z=4)
```

### Velocidades de Homing

```gcode
$24=100     ; Tasa búsqueda homing (mm/min)
$25=25      ; Tasa avance homing (mm/min - más lento)
$26=250     ; Debounce homing (ms)
$27=2       ; Retroceso homing (mm)
```

### Secuencia de Homing

```gcode
$44=0       ; Por defecto: Z primero, luego X e Y juntos
```

### Ejecutar Ciclo de Homing

```gcode
$H          ; Home todos los ejes
$HX         ; Home solo X
$HY         ; Home solo Y
$HZ         ; Home solo Z
```

---

## Coordenadas de Trabajo

### Sistemas de Coordenadas

| G-code | Descripción | Almacenamiento |
|--------|-------------|----------------|
| G54 | Offset trabajo 1 (default) | EEPROM |
| G55 | Offset trabajo 2 | EEPROM |
| G56 | Offset trabajo 3 | EEPROM |
| G57 | Offset trabajo 4 | EEPROM |
| G58 | Offset trabajo 5 | EEPROM |
| G59 | Offset trabajo 6 | EEPROM |

### Establecer Cero de Trabajo

```gcode
G10 L20 P1 X0 Y0 Z0    ; Establecer G54 a posición actual
```

O usar:
```gcode
G54             ; Seleccionar G54
G92 X0 Y0       ; Establecer XY actual como cero (temporal)
```

### Ver Offsets

```gcode
$#          ; Mostrar todos los offsets de coordenadas
```

---

## Guardar Configuraciones

### Las Configuraciones se Guardan Automáticamente

La mayoría de configuraciones `$` se guardan en EEPROM inmediatamente.

### Exportar Configuraciones

Escribir `$$` y guardar la salida a un archivo de texto como respaldo.

### Restaurar Configuraciones

Pegar configuraciones guardadas línea por línea, o usar software sender.

### Restablecer de Fábrica

```gcode
$RST=$      ; Restablecer configuraciones a valores por defecto
$RST=#      ; Restablecer offsets de coordenadas
$RST=*      ; Restablecimiento completo (config + offsets)
```

---

## Tarjeta de Referencia Rápida

### Comandos Comunes

| Comando | Acción |
|---------|--------|
| `$$` | Ver todas las configuraciones |
| `$I` | Info del firmware |
| `$N` | Bloques de inicio |
| `$#` | Offsets de coordenadas |
| `$G` | Estado del parser |
| `?` | Estado en tiempo real |
| `$H` | Home todos los ejes |
| `$X` | Desbloquear alarma |
| `$SLP` | Modo suspensión |

### Caracteres de Estado

| Char | Estado |
|------|--------|
| `Idle` | Listo |
| `Run` | Movimiento activo |
| `Hold` | Pausa de avance |
| `Jog` | Joggeando |
| `Alarm` | Alarma activada |
| `Door` | Puerta de seguridad |
| `Check` | Modo verificación |
| `Home` | Haciendo homing |

### Códigos de Alarma

| Código | Descripción | Solución |
|--------|-------------|----------|
| 1 | Límite duro | Verificar switches, `$X` para limpiar |
| 2 | Límite suave | Mover dentro del área de trabajo |
| 3 | Abortar | Reiniciar ciclo |
| 4 | Falla de sonda | Verificar conexión de sonda |
| 5 | Estado inicial sonda | Sonda ya activada |
| 6 | Falla homing - reset | Ejecutar $H |
| 7 | Falla homing - puerta | Cerrar puerta de seguridad |
| 8 | Falla homing - límite | Retroceder del límite primero |
| 9 | Falla homing - sin switch | Verificar cableado de límites |

---

## Ejemplo: Configuración Completa de Router

```gcode
; === Configuraciones de Máquina ===
$0=10       ; Pulso step 10µs
$1=25       ; Retardo inactividad 25ms
$2=0        ; Puerto step normal
$3=0        ; Dirección normal
$4=0        ; Enable normal
$5=0        ; Límites NC
$6=0        ; Sonda NO

; === Configuraciones de Movimiento ===
$100=640    ; X pasos/mm (tornillo 5mm)
$101=640    ; Y pasos/mm (tornillo 5mm)
$102=1600   ; Z pasos/mm (tornillo 2mm)

$110=3000   ; X velocidad máx
$111=3000   ; Y velocidad máx
$112=1000   ; Z velocidad máx

$120=200    ; X aceleración
$121=200    ; Y aceleración
$122=50     ; Z aceleración

$130=800    ; X recorrido
$131=600    ; Y recorrido
$132=100    ; Z recorrido

; === Homing ===
$20=1       ; Límites suaves ON
$21=1       ; Límites duros ON
$22=1       ; Homing ON
$23=0       ; Home negativo
$24=200     ; Tasa búsqueda
$25=50      ; Tasa avance
$26=250     ; Debounce
$27=2       ; Retroceso

; === Husillo ===
$30=24000   ; RPM máx
$31=6000    ; RPM mín
$32=1       ; Modo husillo
$33=5000    ; Freq PWM

; === TMC2209 UART ===
$338=600    ; X corriente mA
$339=600    ; Y corriente mA
$340=600    ; Z corriente mA
$345=16     ; X micropasos
$346=16     ; Y micropasos
$347=16     ; Z micropasos
```
