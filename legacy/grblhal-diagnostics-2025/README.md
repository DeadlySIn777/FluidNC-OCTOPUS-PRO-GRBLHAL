# Archived grblHAL bench diagnostics (2025) — do not run

> [!CAUTION]
> These 42 Python scripts are unsafe on the MR1 and must not be run on any
> machine. They are kept only as source history.

They were written for the earlier Octopus Pro bench setup with TMC2209 plug-in
drivers and lived at the root of `grblHAL-STM32F4/` until they were moved here.
They are not MR1 commissioning tools, tests or installation steps:

- **No board or firmware identity check.** Every script opens a hard-coded
  serial port (`COM5`; `move_test.py` also tries `COM3`/`COM4`) and starts
  sending commands to whatever device answers there.
- **They write persistent settings.** Examples: `fix_alarm.py` sends `$22=0`,
  `$21=0`, `$20=0`, `$5=7`, `$17=7`; `unlimited_test.py`, `stress_reset.py`,
  `stress_test_3axis.py`, `stress_test_segmented.py`, `test_no_vfd.py` and
  `torque_test.py` disable hard and soft limits (`$21=0`, `$20=0`) and enlarge
  maximum travel (`$130`-`$132`); `debug_tmc.py`, `deep_test.py`, `test_uart_current.py` and
  `torque_test.py` change TMC driver currents (`$140`-`$142`).
- **They unlock alarms and move motors.** Many send `$X` and then jog or run
  G-code moves; `unlimited_test.py` jogs X, Y and Z by 2500 mm with limits
  disabled. `enter_dfu.py` drops the controller into its bootloader.
- **They target the old hardware.** TMC UART/`M122` queries, current settings
  and pin assumptions refer to the TMC2209 slots-3/4/5 bench board, not the
  MR1's external CL57T drives and its reviewed settings profile.

Use the current native application (`mr1-control/`), the firmware profile checks
in `grblHAL-STM32F4/tools/` (read-only source audits) and the reviewed
commissioning procedure instead. The earlier FluidCNC application and its own
scripts are archived in [`../fluidcnc-2025/`](../fluidcnc-2025/README-LEGACY.md).
