/*
  btt_octopus_pro_slots345_map.h - Board map for BIGTREETECH Octopus Pro v1.1
  
  CUSTOM CONFIGURATION: Motors in slots 3, 4, 5
  - Slot 3 (Motor-3) = X axis
  - Slot 4 (Motor-4) = Y axis
  - Slot 5 (Motor-5) = Z axis

  Part of grblHAL

  Copyright (c) 2024 Joe Corelli
  Copyright (c) 2024 Jon Escombe
  Copyright (c) 2025 Michael Griffin
  Modified 2026 for slots 3-4-5 configuration

  grblHAL is free software: you can redistribute it and/or modify
  it under the terms of the GNU General Public License as published by
  the Free Software Foundation, either version 3 of the License, or
  (at your option) any later version.

  grblHAL is distributed in the hope that it will be useful,
  but WITHOUT ANY WARRANTY; without even the implied warranty of
  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
  GNU General Public License for more details.

  You should have received a copy of the GNU General Public License
  along with grblHAL.  If not, see <http://www.gnu.org/licenses/>.
*/

#if N_ABC_MOTORS > 5
#error "This board map supports max 3 extra motors (slots 6, 7, 8)"
#endif

// F446 uses 12MHz, F429 uses 8MHz crystal
#if defined(STM32F446xx) && HSE_VALUE != 12000000
#error "STM32F446 variant requires 12MHz crystal!"
#elif defined(STM32F429xx) && HSE_VALUE != 8000000
#error "STM32F429 variant requires 8MHz crystal!"
#elif !defined(STM32F446xx) && !defined(STM32F429xx)
#error "This board requires STM32F446 or STM32F429 processor!"
#endif

#define BOARD_NAME "BTT Octopus Pro v1.1 (Slots 3-4-5)"
#define BOARD_URL "https://github.com/bigtreetech/BIGTREETECH-OCTOPUS-Pro"

// CRITICAL: Enable board_init() to force UART pins HIGH for TMC2209
#define HAS_BOARD_INIT

#define SERIAL_PORT                 1       // GPIOA: TX = 9, RX = 10,  USART 1
#define SERIAL1_PORT                21      // GPIOD: TX = 5, RX = 6,   USART 2
#define SERIAL2_PORT                32      // GPIOD: TX = 8, RX = 9,   USART 3
#define I2C_PORT                    1       // GPIOB: SCL = 8, SDA = 9
#define SPI_PORT                    1       // GPIOA: SCK = 5, MISO = 6, MOSI = 7

// ═══════════════════════════════════════════════════════════════════════════
// MOTOR PIN MAPPING - FOR PHYSICAL SLOTS 3, 4, 5 (labeled M3, M4, M5 on PCB)
// ═══════════════════════════════════════════════════════════════════════════
// Physical slot → Axis mapping:
//   Slot 3 (M3 on PCB) → X axis : STEP=PG4,  DIR=PC1,  EN=PA2, UART=PC7
//   Slot 4 (M4 on PCB) → Y axis : STEP=PF9,  DIR=PF10, EN=PG2, UART=PF2
//   Slot 5 (M5 on PCB) → Z axis : STEP=PC13, DIR=PF0,  EN=PF1, UART=PE4
// ═══════════════════════════════════════════════════════════════════════════

// Define step pulse output pins.
// X axis = Physical Slot 3 (M3 on PCB)
#define X_STEP_PORT                 GPIOG
#define X_STEP_PIN                  4
// Y axis = Physical Slot 4 (M4 on PCB)
#define Y_STEP_PORT                 GPIOF
#define Y_STEP_PIN                  9
// Z axis = Physical Slot 5 (M5 on PCB)
#define Z_STEP_PORT                 GPIOC
#define Z_STEP_PIN                  13
#define STEP_OUTMODE                GPIO_BITBAND

// Define step direction output pins.
// X axis = Physical Slot 3 (M3)
#define X_DIRECTION_PORT            GPIOC
#define X_DIRECTION_PIN             1
// Y axis = Physical Slot 4 (M4)
#define Y_DIRECTION_PORT            GPIOF
#define Y_DIRECTION_PIN             10
// Z axis = Physical Slot 5 (M5)
#define Z_DIRECTION_PORT            GPIOF
#define Z_DIRECTION_PIN             0
#define DIRECTION_OUTMODE           GPIO_BITBAND

// Define stepper driver enable/disable output pin.
// X axis = Physical Slot 3 (M3)
#define X_ENABLE_PORT               GPIOA
#define X_ENABLE_PIN                2
// Y axis = Physical Slot 4 (M4)
#define Y_ENABLE_PORT               GPIOG
#define Y_ENABLE_PIN                2
// Z axis = Physical Slot 5 (M5)
#define Z_ENABLE_PORT               GPIOF
#define Z_ENABLE_PIN                1

// Define homing/hard limit switch input pins.
// Using MIN4, MIN5, MIN6 to match motor slots 3, 4, 5
#define X_LIMIT_PORT                GPIOG
#define X_LIMIT_PIN                 11      // MIN4 for Slot 3 (M3)
#define Y_LIMIT_PORT                GPIOG
#define Y_LIMIT_PIN                 12      // MIN5 for Slot 4 (M4)
#define Z_LIMIT_PORT                GPIOG
#define Z_LIMIT_PIN                 13      // MIN6 for Slot 5 (M5)
#define LIMIT_INMODE                GPIO_BITBAND

// ═══════════════════════════════════════════════════════════════════════════
// ADDITIONAL MOTORS (Slots 6, 7, 8 → A, B, C axes)
// ═══════════════════════════════════════════════════════════════════════════

// A axis = Slot 6 (Motor-6 on PCB)
#if N_ABC_MOTORS > 0
#define M3_AVAILABLE
#define M3_STEP_PORT                GPIOC
#define M3_STEP_PIN                 13
#define M3_DIRECTION_PORT           GPIOF
#define M3_DIRECTION_PIN            0
#define M3_LIMIT_PORT               GPIOG
#define M3_LIMIT_PIN                13      // MIN6
#define M3_ENABLE_PORT              GPIOF
#define M3_ENABLE_PIN               1
#endif

// B axis = Slot 7 (Motor-7 on PCB)
#if N_ABC_MOTORS > 1
#define M4_AVAILABLE
#define M4_STEP_PORT                GPIOE
#define M4_STEP_PIN                 2
#define M4_DIRECTION_PORT           GPIOE
#define M4_DIRECTION_PIN            3
#define M4_LIMIT_PORT               GPIOG
#define M4_LIMIT_PIN                14      // MIN7
#define M4_ENABLE_PORT              GPIOD
#define M4_ENABLE_PIN               4
#endif

// C axis = Slot 8 (Motor-8 on PCB)
#if N_ABC_MOTORS > 2
#define M5_AVAILABLE
#define M5_STEP_PORT                GPIOE
#define M5_STEP_PIN                 6
#define M5_DIRECTION_PORT           GPIOA
#define M5_DIRECTION_PIN            14
#define M5_LIMIT_PORT               GPIOG
#define M5_LIMIT_PIN                15      // MIN8
#define M5_ENABLE_PORT              GPIOE
#define M5_ENABLE_PIN               0
#endif

// ═══════════════════════════════════════════════════════════════════════════
// SPINDLE / FAN OUTPUTS
// ═══════════════════════════════════════════════════════════════════════════

#define AUXOUTPUT0_PORT             GPIOA   // Spindle PWM - FAN0
#define AUXOUTPUT0_PIN              8

#define AUXOUTPUT1_PORT             GPIOE   // - FAN1
#define AUXOUTPUT1_PIN              5

#define AUXOUTPUT2_PORT             GPIOD   // - FAN2
#define AUXOUTPUT2_PIN              12

#define AUXOUTPUT3_PORT             GPIOD   // - FAN3
#define AUXOUTPUT3_PIN              13

#define AUXOUTPUT4_PORT             GPIOD   // Spindle enable - FAN4
#define AUXOUTPUT4_PIN              14

#define AUXOUTPUT5_PORT             GPIOE   // Spindle direction - FAN5
#define AUXOUTPUT5_PIN              15

#define AUXOUTPUT6_PORT             GPIOA   // Coolant flood - HE0
#define AUXOUTPUT6_PIN              0

#define AUXOUTPUT7_PORT             GPIOA   // Coolant mist - HE1
#define AUXOUTPUT7_PIN              3

// Define driver spindle pins.
#if DRIVER_SPINDLE_ENABLE & SPINDLE_ENA
#define SPINDLE_ENABLE_PORT         AUXOUTPUT4_PORT
#define SPINDLE_ENABLE_PIN          AUXOUTPUT4_PIN
#endif
#if DRIVER_SPINDLE_ENABLE & SPINDLE_PWM
#define SPINDLE_PWM_PORT            AUXOUTPUT0_PORT
#define SPINDLE_PWM_PIN             AUXOUTPUT0_PIN
#endif
#if DRIVER_SPINDLE_ENABLE & SPINDLE_DIR
#define SPINDLE_DIRECTION_PORT      AUXOUTPUT5_PORT
#define SPINDLE_DIRECTION_PIN       AUXOUTPUT5_PIN
#endif

// Define flood and mist coolant enable output pins.
#if COOLANT_ENABLE & COOLANT_FLOOD
#define COOLANT_FLOOD_PORT          AUXOUTPUT6_PORT
#define COOLANT_FLOOD_PIN           AUXOUTPUT6_PIN
#endif
#if COOLANT_ENABLE & COOLANT_MIST
#define COOLANT_MIST_PORT           AUXOUTPUT7_PORT
#define COOLANT_MIST_PIN            AUXOUTPUT7_PIN
#endif

// ═══════════════════════════════════════════════════════════════════════════
// AUXILIARY INPUTS (Control signals, Probe, etc.)
// ═══════════════════════════════════════════════════════════════════════════

#define AUXINPUT0_PORT              GPIOC   // Safety door - PWR-DET
#define AUXINPUT0_PIN               0
#define AUXINPUT1_PORT              GPIOB   // Probe - Z probe "left"
#define AUXINPUT1_PIN               6
#define AUXINPUT2_PORT              GPIOB   // Z probe "right"
#define AUXINPUT2_PIN               7
#define AUXINPUT3_PORT              GPIOB   // Button on PCB
#define AUXINPUT3_PIN               2
#define AUXINPUT4_PORT              GPIOF   // Reset/E-Stop - TB
#define AUXINPUT4_PIN               3
#define AUXINPUT5_PORT              GPIOF   // Feed hold - T0
#define AUXINPUT5_PIN               4
#define AUXINPUT6_PORT              GPIOF   // Cycle start - T1
#define AUXINPUT6_PIN               5

#define AUXINTPUT0_ANALOG_PORT      GPIOF   // T2
#define AUXINTPUT0_ANALOG_PIN       6

#define AUXINTPUT1_ANALOG_PORT      GPIOF   // T3
#define AUXINTPUT1_ANALOG_PIN       7

// Define user-control controls (cycle start, reset, feed hold) input pins.
#if CONTROL_ENABLE & CONTROL_HALT
#define RESET_PORT                  AUXINPUT4_PORT
#define RESET_PIN                   AUXINPUT4_PIN
#endif
#if CONTROL_ENABLE & CONTROL_FEED_HOLD
#define FEED_HOLD_PORT              AUXINPUT5_PORT
#define FEED_HOLD_PIN               AUXINPUT5_PIN
#endif
#if CONTROL_ENABLE & CONTROL_CYCLE_START
#define CYCLE_START_PORT            AUXINPUT6_PORT
#define CYCLE_START_PIN             AUXINPUT6_PIN
#endif

#if SAFETY_DOOR_ENABLE
#define SAFETY_DOOR_PORT            AUXINPUT0_PORT
#define SAFETY_DOOR_PIN             AUXINPUT0_PIN
#endif

#if PROBE_ENABLE
#define PROBE_PORT                  AUXINPUT1_PORT
#define PROBE_PIN                   AUXINPUT1_PIN
#endif

#if SDCARD_ENABLE
#define SDCARD_SDIO                 1
#ifndef M5_LIMIT_PORT
#define SD_DETECT_PORT              GPIOC
#define SD_DETECT_PIN               14
#endif
#endif

// ═══════════════════════════════════════════════════════════════════════════
// TMC2209 UART - FOR PHYSICAL SLOTS 3, 4, 5 (M3, M4, M5 on PCB)
// ═══════════════════════════════════════════════════════════════════════════

#if TRINAMIC_UART_ENABLE

// Must use software bit-banged UART (mode 2) for per-motor GPIO pins
#undef TRINAMIC_UART_ENABLE
#define TRINAMIC_UART_ENABLE        2

// X axis UART = Physical Slot 3 (M3) = PC7
#define MOTOR_UARTX_PORT            GPIOC
#define MOTOR_UARTX_PIN             7
// Y axis UART = Physical Slot 4 (M4) = PF2
#define MOTOR_UARTY_PORT            GPIOF
#define MOTOR_UARTY_PIN             2
// Z axis UART = Physical Slot 5 (M5) = PE4
#define MOTOR_UARTZ_PORT            GPIOE
#define MOTOR_UARTZ_PIN             4

// Additional motors if enabled
#ifdef M3_AVAILABLE
// A axis UART = Slot 6 UART pin
#define MOTOR_UARTM3_PORT           GPIOE
#define MOTOR_UARTM3_PIN            4
#endif

#ifdef M4_AVAILABLE
// B axis UART = Slot 7 UART pin
#define MOTOR_UARTM4_PORT           GPIOE
#define MOTOR_UARTM4_PIN            1
#endif

#ifdef M5_AVAILABLE
// C axis UART = Slot 8 UART pin
#define MOTOR_UARTM5_PORT           GPIOD
#define MOTOR_UARTM5_PIN            3
#endif

#elif TRINAMIC_SPI_ENABLE

#ifdef TRINAMIC_SOFT_SPI
#define TRINAMIC_MOSI_PORT          GPIOA
#define TRINAMIC_MOSI_PIN           7
#define TRINAMIC_SCK_PORT           GPIOA
#define TRINAMIC_SCK_PIN            5
#define TRINAMIC_MISO_PORT          GPIOA
#define TRINAMIC_MISO_PIN           6
#endif

// SPI CS pins for slots 3, 4, 5
#define MOTOR_CSX_PORT              GPIOC
#define MOTOR_CSX_PIN               6
#define MOTOR_CSY_PORT              GPIOC
#define MOTOR_CSY_PIN               7
#define MOTOR_CSZ_PORT              GPIOF
#define MOTOR_CSZ_PIN               2

#ifdef M3_AVAILABLE
#define MOTOR_CSM3_PORT             GPIOE
#define MOTOR_CSM3_PIN              4
#endif

#ifdef M4_AVAILABLE
#define MOTOR_CSM4_PORT             GPIOE
#define MOTOR_CSM4_PIN              1
#endif

#ifdef M5_AVAILABLE
#define MOTOR_CSM5_PORT             GPIOD
#define MOTOR_CSM5_PIN              3
#endif

#endif

#define CAN_PORT                    GPIOD
#define CAN_RX_PIN                  0
#define CAN_TX_PIN                  1

// EOF
