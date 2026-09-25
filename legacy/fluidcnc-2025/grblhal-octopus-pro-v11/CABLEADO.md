# Diagrama de Cableado - BTT Octopus Pro v1.1

## 🔌 Diagrama de Conexiones Completo

```
                        BTT OCTOPUS PRO V1.1 (STM32F446)
    ┌─────────────────────────────────────────────────────────────────────┐
    │                              USB-C                                   │
    │                            (CDC Serial)                              │
    ├─────────────────────────────────────────────────────────────────────┤
    │                                                                      │
    │  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐        │
    │  │ MOTOR 0 │ │ MOTOR 1 │ │ MOTOR 2 │ │ MOTOR 3 │ │ MOTOR 4 │        │
    │  │   (X)   │ │   (Y)   │ │   (Z)   │ │   (A)   │ │   (B)   │        │
    │  │ TMC2209 │ │ TMC2209 │ │ TMC2209 │ │ TMC2209 │ │ TMC2209 │        │
    │  └────┬────┘ └────┬────┘ └────┬────┘ └────┬────┘ └────┬────┘        │
    │       │           │           │           │           │              │
    │  ┌────┴────┐ ┌────┴────┐ ┌────┴────┐ ┌────┴────┐ ┌────┴────┐        │
    │  │ STEP    │ │ STEP    │ │ STEP    │ │ STEP    │ │ STEP    │        │
    │  │  PF13   │ │  PG0    │ │  PF11   │ │  PG4    │ │  PF9    │        │
    │  │ DIR     │ │ DIR     │ │ DIR     │ │ DIR     │ │ DIR     │        │
    │  │  PF12   │ │  PG1    │ │  PG3    │ │  PC1    │ │  PF10   │        │
    │  │ EN      │ │ EN      │ │ EN      │ │ EN      │ │ EN      │        │
    │  │  PF14   │ │  PF15   │ │  PG5    │ │  PA0    │ │  PG2    │        │
    │  │ UART    │ │ UART    │ │ UART    │ │ UART    │ │ UART    │        │
    │  │  PC4    │ │  PD11   │ │  PC6    │ │  PC7    │ │  PF2    │        │
    │  └─────────┘ └─────────┘ └─────────┘ └─────────┘ └─────────┘        │
    │                                                                      │
    ├──────────────────────────────────────────────────────────────────────┤
    │  LÍMITES (ENDSTOPS)                                                  │
    ├──────────────────────────────────────────────────────────────────────┤
    │                                                                      │
    │  MIN1 (X)    MIN2 (Y)    MIN3 (Z)    MIN4 (A)    MIN5 (B)            │
    │  ┌─────┐     ┌─────┐     ┌─────┐     ┌─────┐     ┌─────┐             │
    │  │ PG6 │     │ PG9 │     │PG10 │     │PG11 │     │PG12 │             │
    │  │ GND │     │ GND │     │ GND │     │ GND │     │ GND │             │
    │  │ 5V  │     │ 5V  │     │ 5V  │     │ 5V  │     │ 5V  │             │
    │  └─────┘     └─────┘     └─────┘     └─────┘     └─────┘             │
    │                                                                      │
    │  Conexión: Switch NC entre PIN y GND (normalmente cerrado)           │
    │                                                                      │
    ├──────────────────────────────────────────────────────────────────────┤
    │  SONDAS (PROBES)                                                     │
    ├──────────────────────────────────────────────────────────────────────┤
    │                                                                      │
    │  Z-PROBE IZQUIERDO          Z-PROBE DERECHO                          │
    │  (Palpador de Pieza)        (Medidor de Herramienta)                 │
    │  ┌─────────────────┐        ┌─────────────────┐                      │
    │  │ PB6 (Signal)    │        │ PB7 (Signal)    │                      │
    │  │ GND             │        │ GND             │                      │
    │  │ 5V              │        │ 5V              │                      │
    │  └─────────────────┘        └─────────────────┘                      │
    │                                                                      │
    │  ⚠️ Sonda debe hacer contacto con GND cuando toca                    │
    │                                                                      │
    ├──────────────────────────────────────────────────────────────────────┤
    │  CONTROL DE HUSILLO (SPINDLE)                                        │
    ├──────────────────────────────────────────────────────────────────────┤
    │                                                                      │
    │  FAN0 (PWM)         FAN4 (Enable)       FAN5 (Dirección)             │
    │  ┌─────────┐        ┌─────────┐         ┌─────────┐                  │
    │  │ PA8     │        │ PD14    │         │ PE15    │                  │
    │  │ GND     │        │ GND     │         │ GND     │                  │
    │  └─────────┘        └─────────┘         └─────────┘                  │
    │                                                                      │
    │  Conexión a VFD (Variador de Frecuencia):                            │
    │  ┌──────────────────────────────────────────────────┐                │
    │  │  Octopus Pro          VFD                        │                │
    │  │  ────────────         ───                        │                │
    │  │  PA8 (PWM)    ───────► VI (0-10V o PWM)          │                │
    │  │  PD14 (EN)    ───────► FOR/REV Enable            │                │
    │  │  PE15 (DIR)   ───────► Dirección CW/CCW          │                │
    │  │  GND          ───────► COM/GND                   │                │
    │  └──────────────────────────────────────────────────┘                │
    │                                                                      │
    ├──────────────────────────────────────────────────────────────────────┤
    │  REFRIGERANTE (COOLANT) - ⚠️ CAMBIOS EN V1.1                        │
    ├──────────────────────────────────────────────────────────────────────┤
    │                                                                      │
    │  HE0 (Flood)            HE1 (Mist)                                   │
    │  ┌─────────┐            ┌─────────┐                                  │
    │  │ PA2 ⚠️  │            │ PA3     │                                  │
    │  │ GND     │            │ GND     │                                  │
    │  └─────────┘            └─────────┘                                  │
    │                                                                      │
    │  ⚠️ NOTA: En v1.0 era PA0, en v1.1 es PA2                           │
    │                                                                      │
    │  M8 = Refrigerante ON    M9 = Refrigerante OFF                       │
    │  M7 = Niebla ON                                                      │
    │                                                                      │
    ├──────────────────────────────────────────────────────────────────────┤
    │  SALIDAS AUXILIARES (M64/M65)                                        │
    ├──────────────────────────────────────────────────────────────────────┤
    │                                                                      │
    │  HE2 (Aux 0)       FAN1 (Aux 1)      FAN2 (Aux 2)      FAN3 (Aux 3) │
    │  ┌─────────┐       ┌─────────┐       ┌─────────┐       ┌─────────┐  │
    │  │ PB10 ⚠️ │       │ PE5     │       │ PD12    │       │ PD13    │  │
    │  │ GND     │       │ GND     │       │ GND     │       │ GND     │  │
    │  └─────────┘       └─────────┘       └─────────┘       └─────────┘  │
    │                                                                      │
    │  ⚠️ NOTA: HE2 en v1.0 era PB0, en v1.1 es PB10                      │
    │                                                                      │
    │  Comandos G-code:                                                    │
    │  M64 P0 = Aspiradora ON       M65 P0 = Aspiradora OFF               │
    │  M64 P1 = Protector ON        M65 P1 = Protector OFF                │
    │  M64 P2 = Aux 2 ON            M65 P2 = Aux 2 OFF                    │
    │  M64 P3 = Aux 3 ON            M65 P3 = Aux 3 OFF                    │
    │                                                                      │
    └──────────────────────────────────────────────────────────────────────┘
```

---

## 🔧 Cableado de Motor Paso a Paso

### Conexión NEMA 23 (4 cables)

```
    Motor NEMA 23                    Octopus Pro Motor Slot
    ┌───────────┐                    ┌───────────────────┐
    │           │                    │  2B  2A  1A  1B   │
    │  ┌───┐    │                    │  ●   ●   ●   ●   │
    │  │   │    │   Negro  ─────────►│  2B              │
    │  └───┘    │   Verde  ─────────►│      2A          │
    │           │   Rojo   ─────────►│          1A      │
    │   ●●●●    │   Azul   ─────────►│              1B  │
    └───────────┘                    └───────────────────┘
    
    ⚠️ IMPORTANTE: Los colores varían según fabricante.
    
    Para identificar bobinas:
    1. Mide resistencia entre pares de cables
    2. Cables de la misma bobina tienen resistencia baja (1-5Ω)
    3. Cables de bobinas diferentes tienen resistencia infinita
```

### Configuración de Jumpers de Voltaje

```
    MOTOR_POWER (hasta 60V)          MAIN_POWER (hasta 28V)
    
    ┌─────┐                          ┌─────┐
    │ ■─○ │  ← Jumper izquierda      │ ○─■ │  ← Jumper derecha
    └─────┘     = MOTOR_POWER        └─────┘     = MAIN_POWER
    
    ⚠️ ADVERTENCIA: 
    - TMC2209 NO soporta alto voltaje - usar MAIN_POWER
    - TMC5160 HV puede usar MOTOR_POWER hasta 60V
    - Voltaje incorrecto DESTRUIRÁ el driver
```

---

## 📡 Cableado de TMC2209 (UART)

### Conexión Single-Wire UART

```
    TMC2209                          Octopus Pro
    ┌─────────┐                      
    │  PDN    │◄─────────────────────┤ UART Pin (PC4/PD11/PC6...)
    │  UART   │                      │
    └─────────┘                      
    
    Cada driver tiene su propio pin UART:
    - Motor 0 (X): PC4
    - Motor 1 (Y): PD11
    - Motor 2 (Z): PC6
    - Motor 3 (A): PC7
    - Motor 4 (B): PF2
```

### Configuración de Dirección UART (MS1/MS2)

```
    Para comunicación UART, cada driver necesita dirección única:
    
    Motor 0 (X): MS1=GND, MS2=GND → Addr 0
    Motor 1 (Y): MS1=VCC, MS2=GND → Addr 1
    Motor 2 (Z): MS1=GND, MS2=VCC → Addr 2
    Motor 3 (A): MS1=VCC, MS2=VCC → Addr 3
```

---

## 🔴 Cableado de Parada de Emergencia (E-Stop)

```
    Botón E-Stop (NC)                Octopus Pro
    ┌───────────┐                    
    │    ●──●   │────────────────────┤ PWR-DET (PC0)
    │   /   \   │                    │
    │  │     │  │────────────────────┤ GND
    │   \   /   │                    
    │    ●──●   │                    
    └───────────┘                    
    
    Usar contacto NC (normalmente cerrado)
    Al presionar, abre circuito → activa alarma
```

---

## 🎛️ Ejemplo: Sistema CNC Completo

```
    ┌─────────────────────────────────────────────────────────────────┐
    │                        FUENTE 24V                               │
    │                      (Mean Well)                                │
    └───────────────┬─────────────────────────────────────────────────┘
                    │
                    ▼
    ┌───────────────────────────────────────────────────────────────┐
    │                    BTT OCTOPUS PRO V1.1                        │
    │  ┌─────┐ ┌─────┐ ┌─────┐                                      │
    │  │Motor│ │Motor│ │Motor│    ┌──────┐  ┌──────┐  ┌──────┐      │
    │  │  X  │ │  Y  │ │  Z  │    │ MIN1 │  │ MIN2 │  │ MIN3 │      │
    │  └──┬──┘ └──┬──┘ └──┬──┘    └──┬───┘  └──┬───┘  └──┬───┘      │
    └─────┼──────┼──────┼───────────┼────────┼────────┼─────────────┘
          │      │      │           │        │        │
          ▼      ▼      ▼           ▼        ▼        ▼
    ┌─────────────────────────────────────────────────────────────────┐
    │  NEMA23   NEMA23   NEMA23   Switch   Switch   Switch            │
    │    X        Y        Z       X-       Y-       Z-               │
    └─────────────────────────────────────────────────────────────────┘
    
    
    ┌───────────────────────────────────────────────────────────────┐
    │                    BTT OCTOPUS PRO V1.1                        │
    │  ┌──────┐  ┌──────┐  ┌──────┐                                 │
    │  │ FAN0 │  │ FAN4 │  │ FAN5 │    ┌────────┐  ┌────────┐       │
    │  │ PWM  │  │  EN  │  │ DIR  │    │ Z-Probe│  │Toolset │       │
    │  │ PA8  │  │ PD14 │  │ PE15 │    │  PB6   │  │  PB7   │       │
    │  └──┬───┘  └──┬───┘  └──┬───┘    └───┬────┘  └───┬────┘       │
    └─────┼────────┼────────┼─────────────┼───────────┼─────────────┘
          │        │        │             │           │
          ▼        ▼        ▼             ▼           ▼
    ┌─────────────────────────────────┐  ┌───────────────────────────┐
    │           VFD / Spindle         │  │   Palpador    Sensor TL   │
    │  ┌─────────────────────────┐    │  │              ┌─────────┐  │
    │  │ VI ◄── PWM (velocidad)  │    │  │   ┌───┐      │  Fijo   │  │
    │  │ FOR ◄── Enable          │    │  │   │ ○ │      │  en Z   │  │
    │  │ REV ◄── Dirección       │    │  │   └───┘      └─────────┘  │
    │  │ COM ◄── GND             │    │  │                           │
    │  └─────────────────────────┘    │  └───────────────────────────┘
    └─────────────────────────────────┘
```

---

## 📋 Lista de Verificación Pre-Encendido

- [ ] Voltaje de entrada correcto (24V para TMC2209)
- [ ] Jumpers de voltaje en posición correcta (MAIN_POWER para 24V)
- [ ] Todos los drivers insertados correctamente
- [ ] Cables de motor bien conectados (verificar polaridad)
- [ ] Switches de límite conectados y probados
- [ ] Sonda conectada correctamente
- [ ] VFD/Spindle cableado según diagrama
- [ ] USB conectado antes de encender
- [ ] Jumper BOOT0 en posición NORMAL (no DFU)

---

## 🆘 Resolución de Problemas de Cableado

| Síntoma | Causa Probable | Solución |
|---------|----------------|----------|
| Motor vibra pero no gira | Cables de bobina cruzados | Intercambiar 1A↔1B o 2A↔2B |
| Motor gira en dirección incorrecta | Dirección invertida | Intercambiar cables de UNA bobina |
| Switch de límite no detecta | Cableado NO/NC incorrecto | Usar contacto NC entre Signal y GND |
| Sonda no funciona | Polaridad incorrecta | Verificar que contacto va a GND |
| Driver se calienta mucho | Corriente muy alta o voltaje incorrecto | Reducir corriente, verificar jumpers |
| Error UART con TMC | Cables cruzados o dirección incorrecta | Verificar MS1/MS2 y pin UART |
