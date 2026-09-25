/*
  mr1_octopus_config.h - Langmuir MR-1 profile for BTT Octopus Pro v1.1 F429

  This file is force-included by the dedicated PlatformIO environment. It is
  intentionally separate from my_machine.h and the existing Octopus targets.
*/

#ifndef MR1_OCTOPUS_CONFIG_H
#define MR1_OCTOPUS_CONFIG_H

/* Exclude hard-coded motion tests and software bootloader-entry commands. */
#define MR1_PRODUCTION_PROFILE                1

/* Controller and storage. The Windows control PC streams G-code over USB. */
#define USB_SERIAL_CDC                         1
#define EEPROM_ENABLE                         32
#define ODOMETER_ENABLE                       0
#define SDCARD_ENABLE                         0
#define ETHERNET_ENABLE                       0
#define WEBUI_ENABLE                          0
#define MODBUS_ENABLE                         0

/* Keep unattended and implicit motion policies conservative. */
#define DEFAULT_JOG_LIMIT_ENABLE              0 /* Reject, rather than clamp, an out-of-envelope jog. */
#define DEFAULT_PARKING_ENABLE                0
#define DEFAULT_SLEEP_ENABLE                  0
#define DEFAULT_NO_UNLOCK_AFTER_ESTOP         0 /* $484=1: require $X after the E-stop clears. */

/* Four physical motors on a three-axis machine: X, Y1, Z, and ganged Y2. */
#define Y_AUTO_SQUARE                         1
#define TRINAMIC_ENABLE                       0
#define TRINAMIC_UART_ENABLE                  0
#define TRINAMIC_SPI_ENABLE                   0

/* Independent touch-probe and fixed tool-setter inputs. */
#define PROBE_ENABLE                          1
#define PROBE2_ENABLE                         0
#define TOOLSETTER_ENABLE                     1
#define BLTOUCH_ENABLE                        0 /* PB7 is a fixed tool-setter input; no BLTouch hardware or plugin. */

/*
 * Physical E-stop power removal is handled by a safety relay/contactor.
 * These inputs let grblHAL observe the safety chain and operator controls.
 * 70 = E-stop (64) + feed hold (2) + cycle start (4).
 */
#define ESTOP_ENABLE                          1
#define CONTROL_ENABLE                        70
#define SAFETY_DOOR_ENABLE                    1
#define MOTOR_FAULT_ENABLE                    1

/* Stock MR-1 servo: isolated enable relay plus isolated 0-5 V command. */
#define SPINDLE0_ENABLE                       12 /* SPINDLE_PWM0_NODIR */
#define N_SPINDLE                             1
#define COOLANT_ENABLE                        3  /* flood + mist */

/* DM860T V3.0-compatible timing, using 5 V common-anode interfaces. */
#define DEFAULT_STEP_PULSE_MICROSECONDS       5.0f
#define DEFAULT_STEP_PULSE_DELAY              6.0f
#define DEFAULT_STEPPER_ENABLE_DELAY          250
#define DEFAULT_STEPPER_IDLE_LOCK_TIME        255
#define DEFAULT_ENABLE_SIGNALS_INVERT_MASK    7
#define DEFAULT_STEP_SIGNALS_INVERT_MASK      0
#define DEFAULT_DIR_SIGNALS_INVERT_MASK       0
#define DEFAULT_GANGED_DIRECTION_INVERT_MASK  0

/*
 * DM860T phase-one and CL57T future phase: 1600 pulses/rev.
 * MR-1 X/Y lead is 5 mm/rev; Z is 3 mm/rev.
 * The travel envelope is deliberately a little inside the advertised travel
 * and must be verified on the individual machine before being expanded.
 */
#define DEFAULT_X_STEPS_PER_MM                320.0f
#define DEFAULT_Y_STEPS_PER_MM                320.0f
#define DEFAULT_Z_STEPS_PER_MM                533.333333f
#define DEFAULT_X_MAX_RATE                    2540.0f
#define DEFAULT_Y_MAX_RATE                    2540.0f
#define DEFAULT_Z_MAX_RATE                    1016.0f
#define DEFAULT_X_ACCELERATION                250.0f
#define DEFAULT_Y_ACCELERATION                250.0f
#define DEFAULT_Z_ACCELERATION                150.0f
#define DEFAULT_X_MAX_TRAVEL                  566.42f
#define DEFAULT_Y_MAX_TRAVEL                  546.10f
#define DEFAULT_Z_MAX_TRAVEL                  154.94f

/* Conditioned home inputs: healthy is low; trigger, break, or field loss is high. */
#define DEFAULT_LIMIT_SIGNALS_INVERT_MASK     0
#define DEFAULT_LIMIT_SIGNALS_PULLUP_DISABLE_MASK 0
#define DEFAULT_HARD_LIMIT_ENABLE             1
#define DEFAULT_CHECK_LIMITS_AT_INIT          1
#define DEFAULT_SOFT_LIMIT_ENABLE             1

/* Home Z up, then X left/negative, then square Y toward the rear/positive. */
#define DEFAULT_HOMING_ENABLE                 1
#define DEFAULT_HOMING_INIT_LOCK              1
#define DEFAULT_HOMING_SINGLE_AXIS_COMMANDS   1
#define DEFAULT_HOMING_DIR_MASK               1
#define DEFAULT_HOMING_FEED_RATE              60.0f
#define DEFAULT_HOMING_SEEK_RATE              500.0f
#define DEFAULT_HOMING_DEBOUNCE_DELAY         100
#define DEFAULT_HOMING_PULLOFF                2.0f
#define DEFAULT_N_HOMING_LOCATE_CYCLE         1
#define DEFAULT_HOMING_CYCLE_0                4
#define DEFAULT_HOMING_CYCLE_1                1
#define DEFAULT_HOMING_CYCLE_2                2

/*
 * Stop dual-Y homing if one switch trails the other far enough to rack the
 * gantry. grblHAL clamps 1% of Y travel between 2.5 and 8 mm; with the
 * initial 546.10 mm envelope this aborts after 5.461 mm of mismatch.
 */
#define DEFAULT_DUAL_AXIS_HOMING_FAIL_AXIS_LENGTH_PERCENT 1.0f
#define DEFAULT_DUAL_AXIS_HOMING_FAIL_DISTANCE_MIN 2.5f
#define DEFAULT_DUAL_AXIS_HOMING_FAIL_DISTANCE_MAX 8.0f

/*
 * E-stop, feed hold, and door use NC contacts. Cycle start uses a NO contact,
 * so only its bit is inverted. Pull-ups remain enabled on every input.
 */
#define DEFAULT_CONTROL_SIGNALS_INVERT_MASK   4
#define DEFAULT_DISABLE_CONTROL_PINS_PULL_UP_MASK 0

/* Isolated probe outputs pull low when triggered. $6 therefore defaults to 3. */
#define DEFAULT_PROBE_SIGNAL_INVERT            1
#define DEFAULT_TOOLSETTER_SIGNAL_INVERT       1
#define DEFAULT_PROBE_SIGNAL_DISABLE_PULLUP    0
#define DEFAULT_TOOLSETTER_SIGNAL_DISABLE_PULLUP 0

/* Clamp G38.x targets to the homed machine envelope. */
#define DEFAULT_ALLOW_FEED_OVERRIDE_DURING_PROBE_CYCLES 0
#define DEFAULT_SOFT_LIMIT_PROBE_CYCLES        1

/* Driver-ready contacts are conditioned as healthy-low and fault/open-high. */
#define DEFAULT_MOTOR_FAULT_SIGNALS_ENABLE     7
#define DEFAULT_MOTOR_FAULT_SIGNALS_INVERT     0

/* PWM is converted by an isolated 0-5 V module; direction is not exposed. */
#define DEFAULT_SPINDLE_RPM_MIN                0.0f
#define DEFAULT_SPINDLE_RPM_MAX                8000.0f
#define DEFAULT_SPINDLE_PWM_FREQ               1000
#define DEFAULT_SPINDLE_PWM_OFF_VALUE          0.0f
#define DEFAULT_SPINDLE_PWM_MIN_VALUE          0.0f
#define DEFAULT_SPINDLE_PWM_MAX_VALUE          100.0f
#define DEFAULT_SPINDLE_ENABLE_OFF_WITH_ZERO_SPEED 1
#define DEFAULT_SPINDLE_ON_DELAY               1000
#define DEFAULT_SPINDLE_OFF_DELAY              500
#define DEFAULT_COOLANT_ON_DELAY               500

/*
 * Built-in automatic tool touch-off stays disabled; the commissioned host
 * workflow must use the tool-length-aware guarded approach.
 * $342 is total fine-probe travel from the verified approach point, not
 * permitted travel past expected contact. The host profile starts 2 mm above
 * tool-length-adjusted contact, leaving a 1 mm no-contact guard. Built-in
 * semi-automatic mode remains disabled because it descends before probe arm.
 */
#define DEFAULT_TOOLCHANGE_MODE                0
#define DEFAULT_TOOLCHANGE_PROBING_DISTANCE    3.0f
#define DEFAULT_TOOLCHANGE_FEED_RATE           10.0f
#define DEFAULT_TOOLCHANGE_SEEK_RATE           50.0f
#define DEFAULT_TOOLCHANGE_PULLOFF_RATE        50.0f

/*
 * Sender-compatible status fields. Keep parser/alarm/run substates disabled:
 * older senders may not understand them. These bits produce $10=511.
 */
#define DEFAULT_REPORT_MACHINE_POSITION        1
#define DEFAULT_REPORT_BUFFER_STATE            1
#define DEFAULT_REPORT_LINE_NUMBERS            1
#define DEFAULT_REPORT_CURRENT_FEED_SPEED      1
#define DEFAULT_REPORT_PIN_STATE               1
#define DEFAULT_REPORT_WORK_COORD_OFFSET       1
#define DEFAULT_REPORT_OVERRIDES                1
#define DEFAULT_REPORT_PROBE_COORDINATES        1
#define DEFAULT_REPORT_SYNC_ON_WCO_CHANGE       1
#define DEFAULT_REPORT_PARSER_STATE             0
#define DEFAULT_REPORT_ALARM_SUBSTATE           0
#define DEFAULT_REPORT_RUN_SUBSTATE             0
#define DEFAULT_REPORT_WHEN_HOMING              0
#define DEFAULT_REPORT_DISTANCE_TO_GO           0

#endif /* MR1_OCTOPUS_CONFIG_H */
