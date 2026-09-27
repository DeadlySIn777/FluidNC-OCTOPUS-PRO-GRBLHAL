/*
  mr1_alarm.c - read-only MR-1 external-drive alarm diagnostics

  Part of grblHAL, licensed under GPL-3.0-or-later.

  Protocol v1: |MR1F:1,<mask> in every real-time report, or
  [MR1F:1,<mask>] from $MR1F. The decimal mask contains raw HIGH levels:
  bit 0 = X/STOP4/PG12, bit 1 = Y-left/STOP5/PG13,
  bit 2 = Z/STOP6/PG14, bit 3 = Y-right/STOP7/PG15.

  With the qualified healthy-low interface, HIGH means fault/open; the bits
  alone do not establish that an interface is installed or qualified. These
  are instantaneous snapshots, not latched events: brief faults between
  reports can be missed. PB1 remains the independent aggregate stop path.
  This module must not change control state, motion, inversion or IRQ modes.
*/

#include "driver.h"

#if defined(BOARD_BTT_OCTOPUS_PRO_MR1) && MR1_ALARM_DIAGNOSTICS_ENABLE

static on_realtime_report_ptr on_realtime_report;
static on_report_options_ptr on_report_options;

static uint8_t mr1_alarm_raw_mask (void)
{
    uint8_t mask = !!DIGITAL_IN(X_MOTOR_FAULT_PORT, X_MOTOR_FAULT_PIN);
    mask |= !!DIGITAL_IN(Y_MOTOR_FAULT_PORT, Y_MOTOR_FAULT_PIN) << 1;
    mask |= !!DIGITAL_IN(Z_MOTOR_FAULT_PORT, Z_MOTOR_FAULT_PIN) << 2;
#if defined(MR1_SERVO_AXIS_LAB)
    mask |= !!DIGITAL_IN(M4_MOTOR_FAULT_PORT, M4_MOTOR_FAULT_PIN) << 3;
#else
    mask |= !!DIGITAL_IN(M3_MOTOR_FAULT_PORT, M3_MOTOR_FAULT_PIN) << 3;
#endif
    return mask;
}

static void mr1_alarm_write_mask (stream_write_ptr stream_write)
{
    uint8_t mask = mr1_alarm_raw_mask();
    char value[3];
    uint8_t pos = 0;

    if(mask >= 10)
        value[pos++] = '1';
    value[pos++] = '0' + mask % 10;
    value[pos] = '\0';
    stream_write(value);
}

static void mr1_alarm_realtime_report (stream_write_ptr stream_write, report_tracking_flags_t report)
{
    stream_write("|MR1F:1,");
    mr1_alarm_write_mask(stream_write);

    if(on_realtime_report)
        on_realtime_report(stream_write, report);
}

static status_code_t mr1_alarm_query (sys_state_t state, char *args)
{
    (void)state;
    (void)args;

    hal.stream.write("[MR1F:1,");
    mr1_alarm_write_mask(hal.stream.write);
    hal.stream.write("]" ASCII_EOL);
    return Status_OK;
}

static void mr1_alarm_report_options (bool newopt)
{
    if(on_report_options)
        on_report_options(newopt);
    if(!newopt)
        report_plugin("MR1 raw alarm diagnostics", "1.0");
}

void mr1_alarm_diagnostics_init (void)
{
    static const sys_command_t command_list[] = {
        {"MR1F", mr1_alarm_query, { .allow_blocking = On, .noargs = On },
            { .str = "read raw X,Y-left,Z,Y-right alarm-input mask (diagnostic only)" } }
    };
    static sys_commands_t commands = {
        .n_commands = sizeof(command_list) / sizeof(sys_command_t),
        .commands = command_list
    };

    on_realtime_report = grbl.on_realtime_report;
    grbl.on_realtime_report = mr1_alarm_realtime_report;
    on_report_options = grbl.on_report_options;
    grbl.on_report_options = mr1_alarm_report_options;
    system_register_commands(&commands);
}

#endif
