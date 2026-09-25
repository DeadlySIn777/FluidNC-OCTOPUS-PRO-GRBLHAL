# MR1 wiring — current reference

Open the [visual guide](visual/index.html) from your local checkout and choose
**Octopus schematic** for the board, driver jumpers and named terminal destinations.
Use cable tracing for motor, encoder, drive alarm, home-switch and other defined
circuits. The BIGTREETECH image needs internet; the tables work offline.

**Physical wiring and machining are not qualified.** No entry in the guide records
completed electrical acceptance. Software tests have used synthetic controllers.

- [Readiness worksheet](MR1-wiring-readiness.md)
- [Second-pass corrections](MR1-wiring-second-pass.md)
- [Wiring plan](mr1/WIRING.md) and [short check card](mr1/WIRING_SIMPLE.md)
- [CL57T setup](mr1/CL57T_QUICK_WIRING.md) and [arrival worksheet](mr1/CL57T_ARRIVAL_CAPTURE.md)
- [Interface](mr1/INTERFACE_BOARD.md) and [connector schedule](mr1/PIGTAIL_SCHEDULE.md)
- [Cable schedule](mr1/cable-schedule.csv) and [I/O manifest](mr1/io-manifest.json)
- [66-setting profile](mr1/expected-settings.json)

All drives are external CL57T units. Keep Octopus A1/A2/B2/B1 motor-output plugs
empty. The guide identifies the separate empty driver-socket signals and jumper
groups; it does not assume an installed plug-in driver adapter.

Oil/lubrication has no assigned circuit. Spindle/coolant loads, control interfaces,
alarm supervision, connector positions and power protection remain subject to
the documented checks. Generic TLP281/HW-399 interfaces remain unqualified; there
is no approved floating-VCC recipe.

Manufacturer references are linked, rather than redistributed:

- [CL57T V4.1 manual](https://www.omc-stepperonline.com/download/CL57T-V41_user_manual.pdf)
- [BIGTREETECH V1.1 schematic](https://github.com/bigtreetech/BIGTREETECH-OCTOPUS-Pro/blob/master/Hardware/BIGTREETECH%20Octopus%20Pro%20V1.1-sch.pdf)
- [BIGTREETECH V1.1 pin drawing](https://github.com/bigtreetech/BIGTREETECH-OCTOPUS-Pro/blob/master/Hardware/BIGTREETECH%20Octopus%20Pro%20V1.1-Pin.jpg)

`source/` and `application-reference/` preserve audit inspection excerpts; they
are not build trees or the current app revision. Complete exported firmware is
at [grblHAL-STM32F4](../../grblHAL-STM32F4/) and the current application is at
[mr1-control](../../mr1-control/). The original local offline guide is unchanged.
