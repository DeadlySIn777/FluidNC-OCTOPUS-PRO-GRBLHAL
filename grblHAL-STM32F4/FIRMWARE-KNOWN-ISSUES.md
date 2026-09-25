# Firmware known issues (need a new firmware candidate)

The accepted MR1 production image is the pinned historical build of
`btt_octopus_pro_f429_mr1`: 221,304 bytes, SHA-256
`F4AB32BD2CB7D0985A07915CF1C4349A3A7FD8546C765265B23EB98B904E5E9D`
(see [mr1/BUILD_REPORT.md](mr1/BUILD_REPORT.md)). The issues below are in that
image's source or configuration and cannot be fixed without building, reviewing
and qualifying a **new** firmware candidate with a new hash. Application-side
workarounds do not change the firmware; other senders connected to the same
controller do not get them.

Items (a)-(g) concern the MR1 profiles (`Inc/mr1_octopus_config.h`,
`Inc/mr1_servo_axis_lab_config.h`, `boards/btt_octopus_pro_mr1_map.h`) and (h)
their build configuration. Items (i)-(j) concern legacy targets that must never
be built for a real machine.

## MR1 production and lab images

**(a) No status reports while homing.** The profile sets
`DEFAULT_REPORT_WHEN_HOMING 0` with `$10=511`, so the controller sends no `?`
status reports during a `$H` cycle. A sender that treats missing reports as a
lost controller will fault mid-homing. Workaround: the application suspends its
stale-status watchdog while its own `$H` is running. Next candidate: enable
report-when-homing (status-report bit 12, i.e. `$10` including 4096) and update
`mr1/expected-settings.json`.

**(b) Per-axis drive-fault inputs are never read.** PG12-PG15 are claimed as
`X/Y/Z/M3_MOTOR_FAULT` inputs and collected into the driver's
`motor_fault_inputs` group, but nothing on this board reads them:
`get_motor_fault_inputs()` in `Src/driver.c` has no caller for the MR1 map (only
`boards/longboard32.c` calls it) and they get no interrupt. Only the aggregate
safety-fault input on PB1 raises Alarm 17. `$744`/`$745` (per-motor fault
enable/invert) therefore have no effect. Wire drive alarms into the PB1
aggregate chain until a candidate implements per-axis monitoring.

**(c) PE15 is exposed as a general-purpose output.** The production profile uses
`SPINDLE_PWM0_NODIR`, so `AUXOUTPUT2` (PE15, on the EXP1-8 pin, reserved for a
future spindle direction) is not claimed by the spindle and becomes digital
output P0 for `M62`-`M65`. The application's program validator blocks
`M62`-`M65`, but any other sender or MDI line can toggle PE15. Leave EXP1-8
unconnected. Next candidate: claim or remove `AUXOUTPUT2` when no direction
output is configured.

**(d) Servo-axis lab image leaves the spindle outputs unclaimed.** The lab
profile (`Inc/mr1_servo_axis_lab_config.h`) sets `SPINDLE0_ENABLE 0`
(`SPINDLE_NONE`). PA8 (FAN0, spindle PWM/analog command) and PD14 (FAN4, spindle
enable relay) are then ordinary auxiliary outputs, so `M62`-`M65` can energize
the spindle enable relay and the analog speed command. Fix: `#undef AUXOUTPUT0`
and `AUXOUTPUT1` (or claim them as safe-off outputs) in the lab branch of the
MR1 board map.

**(e) Lab A-axis enable polarity.** `DEFAULT_ENABLE_SIGNALS_INVERT_MASK 7` only
covers X/Y/Z. In the four-axis lab image the A enable (bit 3) is not inverted,
while the Octopus' 10 kΩ pull-up drives the driver-socket EN line high during
reset and bootloader time. Qualify the A drive's enable sense and set bit 3 (or
document the opposite) in the next lab candidate.

**(f) Probe and tool-setter wire breaks read as "not triggered".** Both inputs
are active-low with internal pull-ups (`DEFAULT_PROBE_SIGNAL_INVERT 1`,
`DEFAULT_TOOLSETTER_SIGNAL_INVERT 1`), so an open or broken cable looks like an
idle probe and a probing move would continue into the part. The core's probe
protection is force-disabled (`settings.probe.enable_protection = Off` in
`grbl/settings.c`, around line 3536). Next candidate: consider normally-closed
or idle-lit probe inputs with matching inversion, and a pre-probe continuity
check.

**(g) Cycle start is not debounced and shares a boot button.** Cycle start on
PB2 (EXP2) gets no software debounce: `aux_claim_explicit()` in `Src/driver.c`
enables debounce only for the safety door, reset and QEI-select inputs. PB2 is
also connected to the Octopus' onboard SW2 (BOOT1) button, so that button is a
second, unguarded cycle-start switch, and contact bounce or noise on the guarded
cycle-start circuit can register repeated starts. Next candidate: debounce
`Input_CycleStart` or move it to a pin without an onboard button.

**(h) The build is not reproducible from `platformio.ini`.** `[env]` uses
`platform = ststm32` (unpinned) and `framework-stm32cubef4 @ ~1.26.2` (a range).
The historical ELF identifies its compiler only as
`GCC: (GNU Tools for Arm Embedded Processors 7-2017-q4-major) 7.2.1 20170904`
(PlatformIO `toolchain-gccarmnoneeabi` 1.70201.0); `mr1/BUILD_REPORT.md` does
**not** record the resolved `ststm32` platform or framework package versions,
so no exact versions are pinned here (guessing would create a false lock). A
rebuild with today's packages may produce a different image. For the next
candidate, record `pio pkg list` / `pio system info` output and pin
`platform = ststm32@<version>` and `platform_packages` (framework and toolchain)
for both MR1 environments, then report the new hash.

## Legacy targets (never build for a real machine)

**(i) PA0 double assignment in the legacy Octopus map.**
`boards/btt_octopus_pro_map.h` (selected by `BOARD_BTT_OCTOPUS_PRO` and
`BOARD_BTT_OCTOPUS_PRO_F429`; used by `btt_octopus_pro_f429_standalone`,
`_tmc5160` and `_tmc2130`) drives PA0 as both `X_ENABLE` and `AUXOUTPUT0`, the
spindle-enable output, so enabling X steppers and switching the spindle fight
over one pin. These targets also cannot build from this export (the trinamic,
motors and sdcard plugins are omitted). Never build or flash them for a
machine.

**(j) `$TST` direct step-pulse test.** In builds without
`MR1_PRODUCTION_PROFILE` (all non-MR1 targets), `Src/driver.c` registers a
`$TST` command that forces the X/Y/Z enable and direction pins and bit-bangs
2000 step pulses per axis directly on the GPIOs, bypassing the planner, limits,
soft limits and E-stop/alarm state. Both MR1 images compile `$TST` and `$DFU`
out; do not add them back.
