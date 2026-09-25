/*
  mr1_servo_axis_lab_config.h - non-production servo-axis tapping target

  The spindle servo is represented as rotary A and is coordinated with Z by
  the normal grblHAL planner. This proves the source architecture without
  pretending that the unidentified physical servo drive is commissioned.
*/

#ifndef MR1_SERVO_AXIS_LAB_CONFIG_H
#define MR1_SERVO_AXIS_LAB_CONFIG_H

#define MR1_SERVO_AXIS_LAB                   1
#define N_AXIS                               4
#define BUILD_INFO                           "MR1 SERVO AXIS LAB - DO NOT USE IN PRODUCTION"

#include "mr1_octopus_config.h"

/* Position mode and PWM speed mode must never command the drive together. */
#undef SPINDLE0_ENABLE
#define SPINDLE0_ENABLE                      0 /* SPINDLE_NONE */

/* Make mixed linear/rotary moves use the reviewed rotary planner path. */
#define ROTARY_FIX                           1
#define DEFAULT_AXIS_ROTATIONAL_MASK         8 /* A axis */
#define DEFAULT_AXIS_ROTARY_WRAP_MASK        0
#define DEFAULT_HARD_LIMITS_DISABLE_FOR_ROTARY 1

/*
 * Provisional electronic gearing only:
 *   1000 command pulses / motor revolution
 *   2 spindle revolutions / motor revolution
 *   1000 / (2 * 360) = 1.388888889 pulses / spindle degree
 *
 * The configured A rate represents 8000 spindle RPM. The servo identity,
 * pulse input format, gearing, direction, and isolation remain hardware gates.
 */
#define DEFAULT_A_STEPS_PER_MM               1.388888889f
#define DEFAULT_A_MAX_RATE                   2880000.0f
#define DEFAULT_A_ACCELERATION               3600.0f
#define DEFAULT_A_MAX_TRAVEL                 3600000.0f

/* A is intentionally absent from homing and rotary wrapping. */
#define DEFAULT_HOMING_CYCLE_3               0

#endif /* MR1_SERVO_AXIS_LAB_CONFIG_H */
