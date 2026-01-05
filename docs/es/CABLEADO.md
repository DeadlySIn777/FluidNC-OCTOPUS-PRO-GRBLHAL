# Guía de Cableado - BTT Octopus Pro para CNC

Diagramas completos de cableado para BTT Octopus Pro v1.0.1 y v1.1 con grblHAL.

Idioma: Español | English: [docs/en/WIRING.md](../en/WIRING.md)

## 📋 Índice

- [Vista General de la Placa](#vista-general-de-la-placa)
- [Motores Paso a Paso](#motores-paso-a-paso)
- [Finales de Carrera](#finales-de-carrera)
- [Control del Husillo](#control-del-husillo)
- [Sondas](#sondas)
- [Refrigerante](#refrigerante)
- [Salidas Auxiliares](#salidas-auxiliares)
- [Paro de Emergencia](#paro-de-emergencia)
- [Ejemplo de Sistema Completo](#ejemplo-de-sistema-completo)

---

## Vista General de la Placa

```
                        BTT OCTOPUS PRO
    ┌─────────────────────────────────────────────────────────────────────┐
    │                              USB-C                                   │
    │                           (Serial CDC)                               │
    ├─────────────────────────────────────────────────────────────────────┤
    │                                                                      │
    │  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐        │
    │  │ MOTOR 0 │ │ MOTOR 1 │ │ MOTOR 2 │ │ MOTOR 3 │ │ MOTOR 4 │ ...    │
    │  │   (X)   │ │   (Y)   │ │   (Z)   │ │   (A)   │ │   (B)   │        │
    │  │ TMC2209 │ │ TMC2209 │ │ TMC2209 │ │ TMC2209 │ │ TMC2209 │        │
    │  └─────────┘ └─────────┘ └─────────┘ └─────────┘ └─────────┘        │
    │                                                                      │
    │  ┌───────┐ ┌───────┐ ┌───────┐ ┌───────┐ ┌───────┐ ┌───────┐        │
    │  │ MIN1  │ │ MIN2  │ │ MIN3  │ │ MIN4  │ │ MIN5  │ │ MIN6  │        │
    │  │  (X)  │ │  (Y)  │ │  (Z)  │ │  (A)  │ │  (B)  │ │  (C)  │        │
    │  └───────┘ └───────┘ └───────┘ └───────┘ └───────┘ └───────┘        │
    │                                                                      │
    │  ┌────────┐ ┌────────┐    ┌────────┐ ┌────────┐ ┌────────┐          │
    │  │Z-Probe │ │Z-Probe │    │  FAN0  │ │  FAN4  │ │  FAN5  │          │
    │  │  Izq   │ │  Der   │    │  PWM   │ │   EN   │ │  DIR   │          │
    │  │ (PB6)  │ │ (PB7)  │    │ (PA8)  │ │(PD14)  │ │(PE15)  │          │
    │  └────────┘ └────────┘    └────────┘ └────────┘ └────────┘          │
    │                                                                      │
    │  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐                        │
    │  │  HE0   │ │  HE1   │ │  HE2   │ │  HE3   │                        │
    │  │ Flood  │ │  Mist  │ │  Aux   │ │  Aux   │                        │
    │  └────────┘ └────────┘ └────────┘ └────────┘                        │
    │                                                                      │
    └─────────────────────────────────────────────────────────────────────┘
```

---

## Motores Paso a Paso

### Asignación de Pines

| Motor | Eje | Step | Dir | Enable | UART |
|-------|-----|------|-----|--------|------|
| Motor 0 | X | PF13 | PF12 | PF14 | PC4 |
| Motor 1 | Y | PG0 | PG1 | PF15 | PD11 |
| Motor 2 | Z | PF11 | PG3 | PG5 | PC6 |
| Motor 3 | A | PG4 | PC1 | PA0* | PC7 |
| Motor 4 | B | PF9 | PF10 | PG2 | PF2 |
| Motor 5 | C | PC13 | PF0 | PF1 | PE4 |
| Motor 6 | - | PE2 | PE3 | PD4 | PE1 |
| Motor 7 | - | PE6 | PA14 | PE0 | PD3 |

*Nota: Enable del Motor 3 es PA0 en v1.1, PA2 en v1.0

### Cableado NEMA 23 (4 hilos)

```
    Motor NEMA 23                    Octopus Pro Ranura Motor
    ┌───────────┐                    ┌───────────────────┐
    │           │                    │  2B  2A  1A  1B   │
    │  ┌───┐    │                    │  ●   ●   ●   ●   │
    │  │   │    │   Negro  ─────────►│  2B              │
    │  └───┘    │   Verde  ─────────►│      2A          │
    │           │   Rojo   ─────────►│          1A      │
    │   ●●●●    │   Azul   ─────────►│              1B  │
    └───────────┘                    └───────────────────┘
```

⚠️ **¡Los colores de cables varían según fabricante!** Use multímetro para identificar pares de bobinas (misma bobina = baja resistencia).

### Configuración de Jumpers de Voltaje

```
    24V (TMC2209/2208)               48-60V (TMC5160 HV)
    
    ┌─────┐                          ┌─────┐
    │ ○─■ │  ← Jumper DERECHA        │ ■─○ │  ← Jumper IZQUIERDA
    └─────┘     = MAIN_POWER         └─────┘     = MOTOR_POWER
                (máx 28V)                        (máx 60V)
```

⚠️ **ADVERTENCIA**: ¡Selección de voltaje incorrecta destruirá los drivers!

---

## Finales de Carrera

### Asignación de Pines

| Eje | Conector | Pin | Notas |
|-----|----------|-----|-------|
| X | MIN1 | PG6 | NC recomendado |
| Y | MIN2 | PG9 | NC recomendado |
| Z | MIN3 | PG10 | NC recomendado |
| A | MIN4 | PG11 | NC recomendado |
| B | MIN5 | PG12 | NC recomendado |
| C | MIN6 | PG13 | NC recomendado |

### Diagrama de Cableado (Interruptor NC)

```
    Final de Carrera (NC)            Octopus Pro Conector MIN
    ┌───────────┐                    ┌─────────────────┐
    │    ●──●   │                    │  SIG  GND  5V   │
    │   /   \   │   COM ────────────►│       GND       │
    │  │ NC  │  │   NC  ────────────►│  SIG            │
    │   \   /   │                    │             5V  │  (no usado)
    │    ●──●   │                    └─────────────────┘
    └───────────┘                    
    
    NC = Normalmente Cerrado (recomendado por seguridad)
    Al activar: circuito abre → grblHAL detecta límite
```

### Diagrama de Cableado (Sensor Inductivo NPN)

```
    Inductivo NPN                    Octopus Pro Conector MIN
    ┌───────────┐                    ┌─────────────────┐
    │   Café  ──│─── +24V ◄─────────►│             5V  │ (¡usar 24V externo!)
    │   Azul  ──│─── GND  ◄─────────►│       GND       │
    │   Negro ──│─── OUT  ──────────►│  SIG            │
    └───────────┘                    └─────────────────┘
    
    ⚠️ ¡La mayoría de sensores inductivos necesitan 12-24V, no 5V!
       Use fuente de alimentación externa para el cable Café.
```

---

## Control del Husillo

### Asignación de Pines

| Función | Pin | Conector | Tipo de Señal |
|---------|-----|----------|---------------|
| PWM / Velocidad | PA8 | FAN0 | 0-10V o PWM |
| Enable | PD14 | FAN4 | On/Off |
| Dirección | PE15 | FAN5 | CW/CCW |

### Cableado VFD (Control 0-10V)

```
    Octopus Pro                      VFD (Variador de Frecuencia)
    ┌───────────┐                    ┌─────────────────────────┐
    │  FAN0     │                    │                         │
    │  PA8  ────│───────────────────►│  VI (entrada 0-10V)     │
    │  GND  ────│───────────────────►│  COM / GND              │
    │           │                    │                         │
    │  FAN4     │                    │                         │
    │  PD14 ────│───────────────────►│  FOR (Adelante/Enable)  │
    │           │                    │                         │
    │  FAN5     │                    │                         │
    │  PE15 ────│───────────────────►│  REV (Reversa/Dir)      │
    └───────────┘                    └─────────────────────────┘
    
    Comandos G-code:
    M3 S12000  → Husillo CW a 12000 RPM
    M4 S12000  → Husillo CCW a 12000 RPM
    M5         → Husillo APAGADO
```

---

## Sondas

### Asignación de Pines

| Función | Pin | Conector | Uso |
|---------|-----|----------|-----|
| Sonda de Contacto | PB6 | Z-Probe Izq | Palpado de pieza |
| Setter de Herramienta | PB7 | Z-Probe Der | Sensor fijo de longitud |

### Cableado de Sonda de Contacto

```
    Sonda de Contacto                Octopus Pro Z-Probe Izq
    ┌───────────┐                    ┌─────────────────┐
    │           │                    │  SIG  GND  5V   │
    │  ┌───┐    │                    │                 │
    │  │ ○ │────│───────────────────►│  SIG            │
    │  └───┘    │───────────────────►│       GND       │
    │  Placa    │                    │             5V  │ (opcional)
    └───────────┘                    └─────────────────┘
    
    Sonda toca placa → circuito cierra → grblHAL se detiene
    
    G-code: G38.2 Z-50 F100  → Palpar hacia abajo hasta contacto
```

---

## Refrigerante

### Asignación de Pines (¡Diferencias V1.1!)

| Función | Pin V1.0 | Pin V1.1 | Conector | Código M |
|---------|----------|----------|----------|----------|
| Flood | PA0 | **PA2** | HE0 | M8/M9 |
| Mist | PA3 | PA3 | HE1 | M7/M9 |

### Diagrama de Cableado

```
    Octopus Pro                      Relé Refrigerante / Bomba
    ┌───────────┐                    ┌─────────────────┐
    │  HE0      │                    │                 │
    │  PA2  ────│───────────────────►│  Señal (+)      │
    │  GND  ────│───────────────────►│  GND (-)        │
    └───────────┘                    └─────────────────┘
    
    G-code:
    M7  → Refrigerante niebla ON
    M8  → Refrigerante inundación ON
    M9  → Todo refrigerante OFF
```

---

## Salidas Auxiliares

### Asignación de Pines (Salidas Digitales M64/M65)

| Puerto | Pin V1.0 | Pin V1.1 | Conector | M-Code ON | M-Code OFF |
|--------|----------|----------|----------|-----------|------------|
| P0 | PB0 | **PB10** | HE2 | M64 P0 | M65 P0 |
| P1 | PE5 | PE5 | FAN1 | M64 P1 | M65 P1 |
| P2 | PD12 | PD12 | FAN2 | M64 P2 | M65 P2 |
| P3 | PD13 | PD13 | FAN3 | M64 P3 | M65 P3 |

### Ejemplo: Control de Aspiradora

```
    Octopus Pro                      Relé Estado Sólido → Aspiradora
    ┌───────────┐                    ┌─────────────────┐
    │  HE2      │                    │                 │
    │  PB10 ────│───────────────────►│  +              │
    │  GND  ────│───────────────────►│  -              │
    └───────────┘                    └─────────────────┘
    
    G-code:
    M64 P0  → Aspiradora ON
    M65 P0  → Aspiradora OFF
```

---

## Paro de Emergencia

### Cableado (Pin PWR-DET)

```
    Botón E-Stop (NC)                Octopus Pro PWR-DET
    ┌───────────┐                    ┌─────────────────┐
    │           │                    │  PC0            │
    │    ●──●   │───────────────────►│  SIG            │
    │   /   \   │───────────────────►│  GND            │
    │  │ NC  │  │                    │                 │
    │   \   /   │                    └─────────────────┘
    │    ●──●   │                    
    └───────────┘                    
    
    Contacto NC = Normalmente Cerrado
    Presionar E-Stop → Abre circuito → grblHAL dispara alarma
```

---

## Lista de Verificación Pre-Encendido

- [ ] Voltaje de entrada correcto (24V para TMC2209)
- [ ] Jumpers de voltaje en posición correcta
- [ ] Todos los drivers bien insertados
- [ ] Cables de motor conectados (verificar polaridad)
- [ ] Finales de carrera conectados y probados
- [ ] Sonda conectada correctamente
- [ ] VFD/Husillo cableado según diagrama
- [ ] USB conectado antes de encender
- [ ] Jumper BOOT0 en posición NORMAL (no DFU)

---

## Solución de Problemas

| Síntoma | Causa Probable | Solución |
|---------|----------------|----------|
| Motor vibra, no gira | Cables de bobina cruzados | Intercambiar 1A↔1B o 2A↔2B |
| Motor gira al revés | Dirección invertida | Intercambiar cables de UNA bobina |
| Final de carrera no detectado | Cableado NC/NO incorrecto | Usar NC entre Signal y GND |
| Sonda no funciona | Polaridad incorrecta | Verificar que contacto conecte a GND |
| Driver sobrecalienta | Corriente muy alta o voltaje incorrecto | Bajar corriente, verificar jumpers |
| Error UART TMC | Cableado o dirección incorrecta | Verificar MS1/MS2 y pin UART |
