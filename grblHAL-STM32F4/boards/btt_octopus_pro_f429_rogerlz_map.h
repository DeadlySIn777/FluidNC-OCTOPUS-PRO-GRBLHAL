/*
  btt_octopus_pro_f429_map.h - driver code for STM32F407 ARM processors

  Part of grblHAL

  GrblHAL is free software: you can redistribute it and/or modify
  it under the terms of the GNU General Public License as published by
  the Free Software Foundation, either version 3 of the License, or
  (at your option) any later version.

  GrblHAL is distributed in the hope that it will be useful,
  but WITHOUT ANY WARRANTY; without even the implied warranty of
  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
  GNU General Public License for more details.

  You should have received a copy of the GNU General Public License
  along with GrblHAL. If not, see <http://www.gnu.org/licenses/>.
*/

#if N_ABC_MOTORS > 3
#error "Axis configuration is not supported!"
#endif

#if !defined(STM32F429xx) || HSE_VALUE != 8000000
#error "This board has STM32F429 processor with a 8MHz crystal, select a corresponding build!"
#endif

#define BOARD_NAME "BTT Octopus Pro F429"
#define BOARD_URL "https://github.com/bigtreetech/BIGTREETECH-OCTOPUS-Pro"

//#define EEPROM_ENABLE   256 /// 32K AT24C32

#define SERIAL_PORT     1   // GPIOA: TX = 9, RX = 10
#define SERIAL1_PORT   21   // GPIOD: TX = 5, RX = 6
#define SERIAL2_PORT   32   // GPIOD: TX = 8, RX = 9
//#define I2C_ENABLE      1
#define I2C_PORT        1   // GPIOB: SCL = 8, SDA = 9

#if MODBUS_ENABLE
#define MODBUS_RTU_STREAM       0
#endif

#if TRINAMIC_ENABLE
#define HAS_BOARD_INIT
#endif

#if SDCARD_ENABLE
/*
SDIO_D0:    C8
SDIO_D1:    C9
SDIO_D2:    C10
SDIO_D3:    C11
SDIO_CK:    C12
TF_DET:     C14
SDIO_CMD:   D2
*/
#define SDCARD_SDIO                 1
#endif

// Define step pulse output pins.
#define X_STEP_PORT                 GPIOF
#define X_STEP_PIN                  13
#define Y_STEP_PORT                 GPIOG
#define Y_STEP_PIN                  0
#define Z_STEP_PORT                 GPIOF
#define Z_STEP_PIN                  11
#define STEP_OUTMODE                GPIO_BITBAND
//#define STEP_PINMODE                PINMODE_OD // Uncomment for open drain outputs

// Define step direction output pins.
#define X_DIRECTION_PORT            GPIOF
#define X_DIRECTION_PIN             12
#define Y_DIRECTION_PORT            GPIOG
#define Y_DIRECTION_PIN             1
#define Z_DIRECTION_PORT            GPIOG
#define Z_DIRECTION_PIN             3
#define DIRECTION_OUTMODE           GPIO_BITBAND
//#define DIRECTION_PINMODE           PINMODE_OD // Uncomment for open drain outputs

// Define stepper driver enable/disable output pin.
#define X_ENABLE_PORT               GPIOF
#define X_ENABLE_PIN                14
#define Y_ENABLE_PORT               GPIOF
#define Y_ENABLE_PIN                15
#define Z_ENABLE_PORT               GPIOG
#define Z_ENABLE_PIN                5
//#define STEPPERS_ENABLE_PINMODE   PINMODE_OD // Uncomment for open drain outputs

// Define homing/hard limit switch input pins.
#define X_LIMIT_PORT                GPIOG
#define X_LIMIT_PIN                 6                           // X- Limit
#define Y_LIMIT_PORT                GPIOG
#define Y_LIMIT_PIN                 9                           // Y- Limit
#define Z_LIMIT_PORT                GPIOG
#define Z_LIMIT_PIN                 10                          // Z- Limit
#define LIMIT_INMODE                GPIO_BITBAND

// Define ganged axis or A axis step pulse and step direction output pins.
#if N_ABC_MOTORS > 0
#define M3_AVAILABLE                // E0
#define M3_STEP_PORT                GPIOG
#define M3_STEP_PIN                 4
#define M3_DIRECTION_PORT           GPIOC
#define M3_DIRECTION_PIN            1
#define M3_ENABLE_PORT              GPIOA
#define M3_ENABLE_PIN               0
//#define M3_LIMIT_PORT               GPIOG
//#define M3_LIMIT_PIN                11
#endif

// Define ganged axis or B axis step pulse and step direction output pins.
#if N_ABC_MOTORS > 1
#define M4_AVAILABLE                // E1
#define M4_STEP_PORT                GPIOF
#define M4_STEP_PIN                 9
#define M4_DIRECTION_PORT           GPIOF
#define M4_DIRECTION_PIN            10
#define M4_ENABLE_PORT              GPIOG
#define M4_ENABLE_PIN               2
//#define M4_LIMIT_PORT               GPIOG
//#define M4_LIMIT_PIN                12
#endif

// Define ganged axis or C axis step pulse and step direction output pins.
#if N_ABC_MOTORS == 3
#define M5_AVAILABLE                // E2
#define M5_STEP_PORT                GPIOC
#define M5_STEP_PIN                 13
#define M5_DIRECTION_PORT           GPIOF
#define M5_DIRECTION_PIN            0
#define M5_ENABLE_PORT              GPIOF
#define M5_ENABLE_PIN               1
//#define M5_LIMIT_PORT               GPIOG
//#define M5_LIMIT_PIN                13
#endif

// DRIVER6
// #define M6_AVAILABLE
// #define M6_STEP_PORT                GPIOE
// #define M6_STEP_PIN                 2
// #define M6_DIRECTION_PORT           GPIOE
// #define M6_DIRECTION_PIN            3
// #define M6_ENABLE_PORT              GPIOD
// #define M6_ENABLE_PIN               4
// #define M6_LIMIT_PORT               GPIOG
// #define M6_LIMIT_PIN                14

// DRIVER7
// #define M7_AVAILABLE
// #define M7_STEP_PORT                GPIOE
// #define M7_STEP_PIN                 6
// #define M7_DIRECTION_PORT           GPIOA
// #define M7_DIRECTION_PIN            14
// #define M7_ENABLE_PORT              GPIOE
// #define M7_ENABLE_PIN               0
// #define M7_LIMIT_PORT               GPIOG
// #define M7_LIMIT_PIN                15

#define AUXOUTPUT0_PORT             GPIOA // Spindle PWM, FAN0
#define AUXOUTPUT0_PIN              8
#define AUXOUTPUT1_PORT             GPIOD // Spindle direction, FAN2
#define AUXOUTPUT1_PIN              12
#define AUXOUTPUT2_PORT             GPIOE // Spindle enable, FAN1
#define AUXOUTPUT2_PIN              15

// Define driver spindle pins
#if DRIVER_SPINDLE_ENABLE
#define SPINDLE_ENABLE_PORT         AUXOUTPUT2_PORT
#define SPINDLE_ENABLE_PIN          AUXOUTPUT2_PIN
#if DRIVER_SPINDLE_PWM_ENABLE
#define SPINDLE_PWM_PORT            AUXOUTPUT0_PORT
#define SPINDLE_PWM_PIN             AUXOUTPUT0_PIN
#endif
#if DRIVER_SPINDLE_DIR_ENABLE
#define SPINDLE_DIRECTION_PORT      AUXOUTPUT1_PORT
#define SPINDLE_DIRECTION_PIN       AUXOUTPUT1_PIN
#endif
#endif //DRIVER_SPINDLE_ENABLE

// Define flood and mist coolant enable output pins.
#define COOLANT_FLOOD_PORT          GPIOA
#define COOLANT_FLOOD_PIN           2                           // HEAT0
#define COOLANT_MIST_PORT           GPIOA
#define COOLANT_MIST_PIN            3                           // HEAT1

// Define user-control controls (cycle start, reset, feed hold) input pins.
#define RESET_PORT                  GPIOG
#define RESET_PIN                   11                          // STOP 3

#define FEED_HOLD_PORT              GPIOG
#define FEED_HOLD_PIN               12                          // STOP 4

#define CYCLE_START_PORT            GPIOG
#define CYCLE_START_PIN             13                          // STOP 5
#define CONTROL_INMODE GPIO_BITBAND

#define AUXINPUT0_PORT              GPIOG                       // STOP 6
#define AUXINPUT0_PIN               14

#if PROBE_ENABLE
#define PROBE_PORT                  AUXINPUT0_PORT
#define PROBE_PIN                   AUXINPUT0_PIN
#endif

#define LED_PORT                  GPIOB
#define LED_PIN                   0

//#if SAFETY_DOOR_ENABLE
//#define SAFETY_DOOR_PORT            AUXINPUT0_PORT
//#define SAFETY_DOOR_PIN             AUXINPUT0_PIN
//#endif

#if TRINAMIC_UART_ENABLE

#undef TRINAMIC_UART_ENABLE
#define TRINAMIC_UART_ENABLE        2

#define MOTOR_UARTX_PORT            GPIOC
#define MOTOR_UARTX_PIN             4
#define MOTOR_UARTY_PORT            GPIOD
#define MOTOR_UARTY_PIN             11
#define MOTOR_UARTZ_PORT            GPIOC
#define MOTOR_UARTZ_PIN             6

#ifdef  M3_AVAILABLE
#define MOTOR_UARTM3_PORT           GPIOC
#define MOTOR_UARTM3_PIN            7
#endif

#ifdef  M4_AVAILABLE
#define MOTOR_UARTM4_PORT           GPIOF
#define MOTOR_UARTM4_PIN            2
#endif

#ifdef  M5_AVAILABLE
#define MOTOR_UARTM5_PORT           GPIOE
#define MOTOR_UARTM5_PIN            4
#endif

#ifdef  M6_AVAILABLE
#define MOTOR_UARTM6_PORT           GPIOE
#define MOTOR_UARTM6_PIN            1
#endif

#ifdef  M7_AVAILABLE
#define MOTOR_UARTM7_PORT           GPIOD
#define MOTOR_UARTM7_PIN            3
#endif

#endif // TRINAMIC_UART_ENABLE

#if TRINAMIC_SPI_ENABLE

#define TRINAMIC_SPI_PORT           1 // GPIOA, SCK_PIN = 5, MISO_PIN = 6, MOSI_PIN = 7

#define MOTOR_CSX_PORT              GPIOC
#define MOTOR_CSX_PIN               4
#define MOTOR_CSY_PORT              GPIOD
#define MOTOR_CSY_PIN               11
#define MOTOR_CSZ_PORT              GPIOC
#define MOTOR_CSZ_PIN               6

#ifdef  M3_AVAILABLE
#define MOTOR_CSM3_PORT             GPIOC
#define MOTOR_CSM3_PIN              7
#endif

#ifdef  M4_AVAILABLE
#define MOTOR_CSM4_PORT             GPIOF
#define MOTOR_CSM4_PIN              2
#endif

#ifdef  M5_AVAILABLE
#define MOTOR_CSM5_PORT             GPIOE
#define MOTOR_CSM5_PIN              4
#endif

#ifdef  M6_AVAILABLE
#define MOTOR_CSM6_PORT             GPIOE
#define MOTOR_CSM6_PIN              1
#endif

#ifdef  M7_AVAILABLE
#define MOTOR_CSM7_PORT             GPIOD
#define MOTOR_CSM7_PIN              3
#endif

#endif // TRINAMIC_SPI_ENABLE
