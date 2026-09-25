/*
  btt_octopus_pro_mr1_map.h - Langmuir MR-1 on BTT Octopus Pro v1.1 F429

  Production uses the first four driver sockets as external-drive signals:
    MOTOR0 = X, MOTOR1 = Y-left, MOTOR2 = Z, MOTOR3 = Y-right (ganged Y2)

  The separate servo-axis lab image adds one output without moving the normal
  cabinet wiring:
    MOTOR4 = spindle-servo A, MOTOR3 = Y-right (logical M4 / ganged Y2)

  This map is for Octopus Pro v1.1 only. V1.0/V1.0.1 uses PA0 for MOTOR3
  enable and must not use this firmware unchanged.
*/

#if !defined(STM32F429xx) || HSE_VALUE != 8000000
#error "MR-1 Octopus profile requires the STM32F429 build with an 8 MHz crystal."
#endif

#if defined(MR1_SERVO_AXIS_LAB)
  #if N_AXIS != 4 || N_ABC_MOTORS != 2 || !Y_AUTO_SQUARE
    #error "MR-1 servo-axis lab requires XYZA plus one auto-squared Y motor."
  #endif
#elif N_AXIS != 3 || N_ABC_MOTORS != 1 || !Y_AUTO_SQUARE
  #error "MR-1 production profile requires XYZ plus one auto-squared Y motor."
#endif

#if defined(MR1_SERVO_AXIS_LAB)
  #define BOARD_NAME                 "BTT Octopus Pro v1.1 F429 - MR-1 SERVO AXIS LAB"
#else
  #define BOARD_NAME                 "BTT Octopus Pro v1.1 F429 - Langmuir MR-1"
#endif
#define BOARD_URL                    "https://github.com/bigtreetech/BIGTREETECH-OCTOPUS-Pro"

#define SERIAL_PORT                  1   /* PA9 TX, PA10 RX */
#define SERIAL1_PORT                 21  /* PD5 TX, PD6 RX */
#define SERIAL2_PORT                 32  /* PD8 TX, PD9 RX */
#define I2C_PORT                     1   /* PB8 SCL, PB9 SDA */
#define SPI_PORT                     1   /* PA5 SCK, PA6 MISO, PA7 MOSI */

/* MOTOR0: X */
#define X_STEP_PORT                  GPIOF
#define X_STEP_PIN                   13
#define X_DIRECTION_PORT             GPIOF
#define X_DIRECTION_PIN              12
#define X_ENABLE_PORT                GPIOF
#define X_ENABLE_PIN                 14

/* MOTOR1: Y-left */
#define Y_STEP_PORT                  GPIOG
#define Y_STEP_PIN                   0
#define Y_DIRECTION_PORT             GPIOG
#define Y_DIRECTION_PIN              1
#define Y_ENABLE_PORT                GPIOF
#define Y_ENABLE_PIN                 15

/* MOTOR2: Z */
#define Z_STEP_PORT                  GPIOF
#define Z_STEP_PIN                   11
#define Z_DIRECTION_PORT             GPIOG
#define Z_DIRECTION_PIN              3
#define Z_ENABLE_PORT                GPIOG
#define Z_ENABLE_PIN                 5

#define STEP_OUTMODE                 GPIO_BITBAND
#define DIRECTION_OUTMODE            GPIO_BITBAND

/* Physical MOTOR3 and MOTOR4 pin identities are named once for both profiles. */
#define MR1_MOTOR3_STEP_PORT          GPIOG
#define MR1_MOTOR3_STEP_PIN           4
#define MR1_MOTOR3_DIRECTION_PORT     GPIOC
#define MR1_MOTOR3_DIRECTION_PIN      1
#define MR1_MOTOR3_ENABLE_PORT        GPIOA
#define MR1_MOTOR3_ENABLE_PIN         2 /* Octopus Pro v1.1; v1.0 uses PA0 */

#define MR1_MOTOR4_STEP_PORT          GPIOF
#define MR1_MOTOR4_STEP_PIN           9
#define MR1_MOTOR4_DIRECTION_PORT     GPIOF
#define MR1_MOTOR4_DIRECTION_PIN      10
#define MR1_MOTOR4_ENABLE_PORT        GPIOG
#define MR1_MOTOR4_ENABLE_PIN         2

#define M3_AVAILABLE
#if defined(MR1_SERVO_AXIS_LAB)
  /* Logical M3 is A and is routed to physical MOTOR4. */
  #define M3_STEP_PORT                MR1_MOTOR4_STEP_PORT
  #define M3_STEP_PIN                 MR1_MOTOR4_STEP_PIN
  #define M3_DIRECTION_PORT           MR1_MOTOR4_DIRECTION_PORT
  #define M3_DIRECTION_PIN            MR1_MOTOR4_DIRECTION_PIN
  #define M3_ENABLE_PORT              MR1_MOTOR4_ENABLE_PORT
  #define M3_ENABLE_PIN               MR1_MOTOR4_ENABLE_PIN

  /* Logical M4 is the ganged Y2 motor and stays on physical MOTOR3. */
  #define M4_AVAILABLE
  #define M4_STEP_PORT                MR1_MOTOR3_STEP_PORT
  #define M4_STEP_PIN                 MR1_MOTOR3_STEP_PIN
  #define M4_DIRECTION_PORT           MR1_MOTOR3_DIRECTION_PORT
  #define M4_DIRECTION_PIN            MR1_MOTOR3_DIRECTION_PIN
  #define M4_ENABLE_PORT              MR1_MOTOR3_ENABLE_PORT
  #define M4_ENABLE_PIN               MR1_MOTOR3_ENABLE_PIN
#else
  /* Production logical M3 is the ganged Y2 motor on physical MOTOR3. */
  #define M3_STEP_PORT                MR1_MOTOR3_STEP_PORT
  #define M3_STEP_PIN                 MR1_MOTOR3_STEP_PIN
  #define M3_DIRECTION_PORT           MR1_MOTOR3_DIRECTION_PORT
  #define M3_DIRECTION_PIN            MR1_MOTOR3_DIRECTION_PIN
  #define M3_ENABLE_PORT              MR1_MOTOR3_ENABLE_PORT
  #define M3_ENABLE_PIN               MR1_MOTOR3_ENABLE_PIN
#endif

/* Four independent conditioned, healthy-low home inputs on DIAG0-DIAG3. */
#define X_LIMIT_PORT                 GPIOG
#define X_LIMIT_PIN                  6
#define Y_LIMIT_PORT                 GPIOG
#define Y_LIMIT_PIN                  9
#define Z_LIMIT_PORT                 GPIOG
#define Z_LIMIT_PIN                  10
#if defined(MR1_SERVO_AXIS_LAB)
  #define M4_LIMIT_PORT              GPIOG
  #define M4_LIMIT_PIN               11
#else
  #define M3_LIMIT_PORT              GPIOG
  #define M3_LIMIT_PIN               11
#endif
#define LIMIT_INMODE                 GPIO_BITBAND

/* Four fail-safe driver-ready/fault inputs on DIAG4-DIAG7. */
#define X_MOTOR_FAULT_PORT           GPIOG
#define X_MOTOR_FAULT_PIN            12
#define Y_MOTOR_FAULT_PORT           GPIOG
#define Y_MOTOR_FAULT_PIN            13
#define Z_MOTOR_FAULT_PORT           GPIOG
#define Z_MOTOR_FAULT_PIN            14
#if defined(MR1_SERVO_AXIS_LAB)
  #define M4_MOTOR_FAULT_PORT        GPIOG
  #define M4_MOTOR_FAULT_PIN         15
#else
  #define M3_MOTOR_FAULT_PORT        GPIOG
  #define M3_MOTOR_FAULT_PIN         15
#endif
#define MOTOR_FAULT_INMODE           GPIO_BITBAND

/* Low-side power outputs. Use interposing isolation; never wire the servo I/O directly. */
#define AUXOUTPUT0_PORT              GPIOA /* FAN0: spindle PWM carrier */
#define AUXOUTPUT0_PIN               8
#define AUXOUTPUT1_PORT              GPIOD /* FAN4: spindle enable relay */
#define AUXOUTPUT1_PIN               14
#define AUXOUTPUT2_PORT              GPIOE /* Reserved spindle direction. NOTE: PE15 sits in the
                                             EXP1 block on the official v1.1 pinout; the FAN5
                                             connector is PD15. Re-audit before ever using this
                                             output or wiring the physical FAN5 header. */
#define AUXOUTPUT2_PIN               15
#define AUXOUTPUT3_PORT              GPIOA /* HE0 on v1.1: flood relay */
#define AUXOUTPUT3_PIN               0
#define AUXOUTPUT4_PORT              GPIOA /* HE1: mist/air relay */
#define AUXOUTPUT4_PIN               3

#if DRIVER_SPINDLE_ENABLE & SPINDLE_ENA
#define SPINDLE_ENABLE_PORT          AUXOUTPUT1_PORT
#define SPINDLE_ENABLE_PIN           AUXOUTPUT1_PIN
#endif
#if DRIVER_SPINDLE_ENABLE & SPINDLE_PWM
#define SPINDLE_PWM_PORT             AUXOUTPUT0_PORT
#define SPINDLE_PWM_PIN              AUXOUTPUT0_PIN
#endif
#if DRIVER_SPINDLE_ENABLE & SPINDLE_DIR
#define SPINDLE_DIRECTION_PORT       AUXOUTPUT2_PORT
#define SPINDLE_DIRECTION_PIN        AUXOUTPUT2_PIN
#endif

#if COOLANT_ENABLE & COOLANT_FLOOD
#define COOLANT_FLOOD_PORT           AUXOUTPUT3_PORT
#define COOLANT_FLOOD_PIN            AUXOUTPUT3_PIN
#endif
#if COOLANT_ENABLE & COOLANT_MIST
#define COOLANT_MIST_PORT            AUXOUTPUT4_PORT
#define COOLANT_MIST_PIN             AUXOUTPUT4_PIN
#endif

/*
 * Interrupt-capable inputs use unique STM32 EXTI line numbers 0-15.
 * All field wiring reaches these pins through dry contacts or optocouplers.
 */
#define AUXINPUT0_PORT               GPIOC /* PWR-DET: safety door, EXTI0 */
#define AUXINPUT0_PIN                0
#define AUXINPUT1_PORT               GPIOF /* T1: touch probe, EXTI5 */
#define AUXINPUT1_PIN                5
#define AUXINPUT2_PORT               GPIOB /* PB7 tool-setter input on the header silked BLTouch; plugin disabled. */
#define AUXINPUT2_PIN                7
#define AUXINPUT3_PORT               GPIOF /* TB: E-stop monitor, EXTI3 */
#define AUXINPUT3_PIN                3
#define AUXINPUT4_PORT               GPIOF /* T0: feed hold, EXTI4 */
#define AUXINPUT4_PIN                4
#define AUXINPUT5_PORT               GPIOB /* EXP2 PB2: cycle start, EXTI2 */
#define AUXINPUT5_PIN                2
#define AUXINPUT6_PORT               GPIOB /* EXP2 PB1: aggregate safety fault, EXTI1 */
#define AUXINPUT6_PIN                1

#if CONTROL_ENABLE & CONTROL_HALT
#define RESET_PORT                   AUXINPUT3_PORT
#define RESET_PIN                    AUXINPUT3_PIN
#endif
#if CONTROL_ENABLE & CONTROL_FEED_HOLD
#define FEED_HOLD_PORT               AUXINPUT4_PORT
#define FEED_HOLD_PIN                AUXINPUT4_PIN
#endif
#if CONTROL_ENABLE & CONTROL_CYCLE_START
#define CYCLE_START_PORT             AUXINPUT5_PORT
#define CYCLE_START_PIN              AUXINPUT5_PIN
#endif

#if SAFETY_DOOR_ENABLE
#define SAFETY_DOOR_PORT             AUXINPUT0_PORT
#define SAFETY_DOOR_PIN              AUXINPUT0_PIN
#endif
#if PROBE_ENABLE
#define PROBE_PORT                   AUXINPUT1_PORT
#define PROBE_PIN                    AUXINPUT1_PIN
#endif
#if TOOLSETTER_ENABLE
#define TOOLSETTER_PORT              AUXINPUT2_PORT
#define TOOLSETTER_PIN               AUXINPUT2_PIN
#endif
#if MOTOR_FAULT_ENABLE
#define MOTOR_FAULT_PORT             AUXINPUT6_PORT
#define MOTOR_FAULT_PIN              AUXINPUT6_PIN
#endif

#define CONTROL_INMODE               GPIO_BITBAND

/* The onboard SD socket is intentionally unavailable in this USB-streamed profile. */

/* End of file. */
