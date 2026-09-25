# MR-1 Community Wiring Cross-Check

Audit date: 2026-08-26

Repository: [alexphredorg/mr1](https://github.com/alexphredorg/mr1)

Audited revision: [`a41576f09a4ab597bfe64621c233e439ea8c5e52`](https://github.com/alexphredorg/mr1/tree/a41576f09a4ab597bfe64621c233e439ea8c5e52)

The repository is a lightly tested LinuxCNC conversion for a stock-spindle
MR-1 using a Mesa 7i96S. It is valuable evidence about the stock machine, but
it is not an Octopus Pro wiring authority. Its own README also warns that the
project is a work in progress.

## Source Hierarchy

Use the highest applicable source for each side of a connection:

| Connection side | Authority |
| --- | --- |
| Octopus connector, GPIO, and onboard circuit | Compiled `io-manifest.json`, matching source map, and official BTT v1.1 schematic/pin drawing |
| DM860T terminal, switch, timing, and electrical limit | Official STEPPERONLINE DM860T V3.0 manual |
| Stock MR-1 layout and factory assembly context | Official Langmuir assembly information |
| Stock harness identity or undocumented DB44 function | Community hypothesis followed by continuity, voltage, and installed-drive proof |

No community terminal number, wire color, or software polarity can override a
manufacturer document, the compiled firmware map, or a measurement on the
installed machine.

## Accepted Cross-Checks

The repository supports these design decisions without assigning an Octopus
pin:

- Four motion channels are X, Y-left, Y-right, and Z.
- Y-left and Y-right need independent home signals for gantry squaring.
- The stock touch probe and fixed tool setter are distinct devices that require
  power as well as a signal.
- The stock sensor installation needs special attention to floating field
  power and exposed-metal voltage.
- The README powers the limit-switch port from 5 V, calls the input type
  active-high/PNP, and describes limit/E-stop switches as `NC 5V`. This is a
  warning that the stock harness cannot be presumed to be a dry contact.
- X/Y use a 5 mm screw lead and Z uses a 3 mm lead; 1600 pulse/rev is a useful
  starting scale that still requires indicator calibration.
- DB44-10/26 analog speed, DB44-16 enable, DB44-31/23 field power, and the
  listed encoder pairs are **no longer hypotheses**. Field photographs of the
  installed drive match the T3A/T3L connector layout, and that manual's section
  2.4 confirms every one of them: `AS+` 26, `AS-` 10, `GNDA` 11, `DI1 SON` 16,
  `COM+` 31, `DO COM` 23, plus `RDY` 20, `ALM` 5, `OA+/-` 13/28 and `OB+/-`
  14/29. See `SPINDLE_SUPERVISION.md`. Continuity proof on the installed harness
  is still required - these are the drive's pin functions, not proof of what the
  stock cable lands on.

## Deliberately Not Imported

- Mesa TB1/TB2/TB3 terminal numbers.
- The Mesa common-enable circuit.
- Any wire color from that installation.
- Direct stock-limit connection to an Octopus STOP input.
- LinuxCNC input inversion, stepgen, PID, or PWM configuration.
- The README's apparent Y2/Z input sharing.
- Direct spindle encoder or DB44 wiring without an isolated interface and
  installed-drive verification.

Our Octopus design intentionally keeps the four home inputs separate and gives
each drive alarm its own conditioner. It drives each CL57T with its own PUL/DIR
pair through the qualified interface: eight active channels, with the four ENA
channels reserved and unconnected. No common or per-drive enable wiring is
imported.

## Conflicts Found In The Community Repository

1. The README wiring table labels Mesa `INPUT3` as `Y2/Z limit` and leaves
   `INPUT4` blank, while `mr1.hal` maps `INPUT3` to Y2 home and `INPUT4` to Z
   home. The HAL supports separate inputs; the table appears stale.
2. The README table maps DB44-30 as encoder index negative, while the later
   spindle notes call DB44-30 encoder ground. Those statements cannot both be
   accepted as a wiring instruction.
3. Probe connector and wire-color notes describe one observed installation.
   Stock revisions and prior repairs may differ.

These conflicts are why the control screen marks stock home, spindle DB44,
encoder, and stock sensor-harness work as `METER FIRST` or `HOLD`.

## Required Physical Proof

Before the stock limit, probe, setter, or spindle interface is energized:

1. Photograph both ends and key orientation of every connector.
2. Trace the actual DB44 cable end-to-end with power removed.
3. Record continuity for DB44-11 and DB44-12 instead of cutting or bonding
   either wire from a community note.
4. Measure sensor metal, field return, spindle chassis, controller ground, and
   PE relationships with the harness disconnected and connected.
5. Identify the installed spindle drive and archive its parameters.
6. Trace the stock limit connector, conductor count, 5 V source, return, and
   every individual healthy/triggered/unplugged signal state.
7. Bench-prove signal polarity and voltage through the selected isolated
   interface before connecting an Octopus GPIO.

The community project improves our test plan. It does not make an unverified
wire safe to land.
