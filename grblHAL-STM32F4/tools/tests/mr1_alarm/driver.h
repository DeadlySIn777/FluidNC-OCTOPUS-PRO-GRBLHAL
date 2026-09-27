/* Host-only surface for compiling the real diagnostic module. GPIO identities
 * come from the production board map, not duplicated test constants. */
#ifndef MR1_ALARM_TEST_DRIVER_H
#define MR1_ALARM_TEST_DRIVER_H
#include <stdbool.h>
#include <stdint.h>
#include <stddef.h>

#define BOARD_BTT_OCTOPUS_PRO_MR1
#define STM32F429xx
#define HSE_VALUE 8000000
#ifdef MR1_SERVO_AXIS_LAB
#define N_AXIS 4
#define N_ABC_MOTORS 2
#else
#define N_AXIS 3
#define N_ABC_MOTORS 1
#endif
#include "../../../Inc/mr1_octopus_config.h"
#include "../../../boards/btt_octopus_pro_mr1_map.h"

#define GPIOG 7
#define On 1
#define ASCII_EOL "\r\n"
typedef unsigned sys_state_t;
typedef unsigned report_tracking_flags_t;
typedef enum { Status_OK = 0 } status_code_t;
typedef void (*stream_write_ptr)(const char *text);
typedef void (*on_realtime_report_ptr)(stream_write_ptr, report_tracking_flags_t);
typedef void (*on_report_options_ptr)(bool);
typedef status_code_t (*sys_command_ptr)(sys_state_t, char *);
typedef struct {
    const char *command;
    sys_command_ptr execute;
    struct { bool allow_blocking; bool noargs; } flags;
    union { const char *str; } help;
} sys_command_t;
typedef struct { unsigned n_commands; const sys_command_t *commands; } sys_commands_t;
extern struct test_hal { struct { stream_write_ptr write; } stream; } hal;
extern struct test_grbl {
    on_realtime_report_ptr on_realtime_report;
    on_report_options_ptr on_report_options;
} grbl;
unsigned test_gpio_read(unsigned port, unsigned pin);
#define DIGITAL_IN(port, pin) test_gpio_read(port, pin)
void report_plugin(const char *name, const char *version);
void system_register_commands(sys_commands_t *commands);
#endif
