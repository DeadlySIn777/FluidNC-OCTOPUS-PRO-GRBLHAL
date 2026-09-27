#include "driver.h"
#include <assert.h>
#include <stdio.h>
#include <string.h>

struct test_hal hal;
struct test_grbl grbl;
static char output[128];
static unsigned raw_mask, read_count, prior_report_calls, prior_option_calls, plugin_calls;
static sys_commands_t *registered;

unsigned test_gpio_read(unsigned port, unsigned pin)
{
    assert(port == GPIOG);
    assert(pin >= 12 && pin <= 15);
    read_count++;
    /* Return non-normalized bit values, exercising the boolean conversion. */
    return raw_mask & (1U << (pin - 12)) ? 1U << pin : 0;
}

static void capture(const char *text)
{
    assert(strlen(output) + strlen(text) < sizeof(output));
    strcat(output, text);
}

void report_plugin(const char *name, const char *version)
{
    assert(strcmp(name, "MR1 raw alarm diagnostics") == 0);
    assert(strcmp(version, "1.0") == 0);
    plugin_calls++;
}

void system_register_commands(sys_commands_t *commands)
{
    assert(!registered);
    registered = commands;
}

static void prior_report(stream_write_ptr stream_write, report_tracking_flags_t flags)
{
    assert(flags == 123);
    prior_report_calls++;
    stream_write("|Other:kept");
}

static void prior_options(bool newopt)
{
    (void)newopt;
    prior_option_calls++;
}

/* Compile the implementation itself, with only the HAL/core boundary mocked. */
#include "../../../Src/mr1_alarm.c"

int main(int argc, char **argv)
{
    (void)argv;
    hal.stream.write = capture;
#if MR1_ALARM_DIAGNOSTICS_ENABLE
    bool chained = argc > 1;
    if(chained) {
        grbl.on_realtime_report = prior_report;
        grbl.on_report_options = prior_options;
    }
    mr1_alarm_diagnostics_init();
    assert(registered && registered->n_commands == 1);
    assert(strcmp(registered->commands[0].command, "MR1F") == 0);
    assert(registered->commands[0].flags.allow_blocking);
    assert(registered->commands[0].flags.noargs);

    for(raw_mask = 0; raw_mask < 16; raw_mask++) {
        char expected[128];
        output[0] = '\0';
        read_count = 0;
        grbl.on_realtime_report(capture, 123);
        snprintf(expected, sizeof(expected), "|MR1F:1,%u%s", raw_mask,
                 chained ? "|Other:kept" : "");
        assert(strcmp(output, expected) == 0);
        assert(read_count == 4);

        /* Query in a blocking/alarm state still reads fresh levels. */
        output[0] = '\0';
        read_count = 0;
        assert(registered->commands[0].execute(0xFFFF, NULL) == Status_OK);
        snprintf(expected, sizeof(expected), "[MR1F:1,%u]\r\n", raw_mask);
        assert(strcmp(output, expected) == 0);
        assert(read_count == 4);
    }
    assert(prior_report_calls == (chained ? 16U : 0U));
    grbl.on_report_options(true);
    assert(plugin_calls == 0);
    grbl.on_report_options(false);
    assert(plugin_calls == 1);
    assert(prior_option_calls == (chained ? 2U : 0U));
    puts("PASS: 16 raw states, fresh query/status, callback chaining, plugin metadata");
#else
    (void)argc;
    (void)prior_report;
    (void)prior_options;
    assert(!grbl.on_realtime_report && !grbl.on_report_options && !registered);
    assert(read_count == 0 && plugin_calls == 0);
    puts("PASS: compile-time disabled diagnostic module has no registration or reads");
#endif
    return 0;
}
