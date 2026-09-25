# MR-1 Phase-One DM860T Quick Wiring

> # SUPERSEDED 2026-09-16 — DO NOT WIRE A CL57T FROM THIS DOCUMENT
>
> The `CL57T V4.1` closed-loop kits arrived and the machine goes straight to
> closed loop. **Use `CL57T_QUICK_WIRING.md`.**
>
> Three things in this document will destroy a CL57T if applied to one:
>
> 1. **Power polarity.** This document lands bus power on "the two no-polarity
>    `AC` contacts". The CL57T's `P4` is polarized `+VDC` / `GND`. Reversing it
>    is a four-drive loss.
> 2. **Bus voltage.** This document permits 24-110 VDC. The CL57T's absolute
>    maximum is **50 VDC**.
> 3. **Switch letters collide.** `S2` is the 5 V/24 V selector *here* and the
>    8-bit DIP bank *on a CL57T*, whose selector is `S3`. Setting a CL57T's
>    `S3` to 5 V while 24 V signals reach it destroys the input optocoupler.
>
> This file is retained as the reference for the four DM860T drives and stock
> motors, which are preserved as the rollback set.

This was the phase-one motor plan: four stock Langmuir MR-1 motors, four
STEPPERONLINE DM860T drives, and the BTT Octopus Pro v1.1 F429. It was never
commissioned on the machine; the closed-loop kits arrived first.

The user confirmed the ordered drive revision as DM860T V3.0 on 2026-08-23.
The case and switch-face photograph is still retained as commissioning evidence.

## Stop Gates

Do not apply motion power until every item below is true.

1. The drive face says `DM860T(V3.0)` and has `SW1` through `SW10` plus a top
   `S2` 5V/24V selector. A different face uses a different table.
2. Each stock motor cable is labeled `X`, `YL`, `Z`, or `YR` at both ends.
3. Each motor wire is labeled from its old drive terminal, or its two coil
   pairs have been found with an ohmmeter. Never assign phases from color.
4. The stock motor phase-current label or original drive current setting has
   been photographed. The provisional current below is not a final release.
5. The Octopus-to-drive interface has passed an unloaded scope test. Do not
   connect DM860T optocouplers directly to Octopus GPIO.

## Four Identical Axis Harnesses

| Axis label | Octopus socket | STEP GPIO | DIR GPIO | ENA GPIO | Drive |
| --- | --- | --- | --- | --- | --- |
| `X` | MOTOR0 | PF13 | PF12 | PF14 | DM860T X |
| `YL` | MOTOR1 | PG0 | PG1 | PF15 | DM860T Y-left |
| `Z` | MOTOR2 | PF11 | PG3 | PG5 | DM860T Z |
| `YR` | MOTOR3 | PG4 | PC1 | PA2 | DM860T Y-right |

The BTT v1.1 schematic defines an 18-position `2x9` socket footprint. Use a
supported full-footprint adapter or the permanent interface board. A `2x8`
candidate is on HOLD until its complete contact map, actual orientation,
clearance, keying and retention are proved on the 18-contact socket; schematic
contact numbers are not physical row positions, so do not infer that fit from
numbering alone. Do not hang loose Dupont wires from a driver socket. Do not install plug-in motor drivers in MOTOR0
through MOTOR3, and do not use the nearby motor screw terminals.

Route only socket pin 1 `EN`, pin 7 `STEP`, pin 8 `DIR`, and pin 9 `GND`.
This rollback set uses the ENA channel that the CL57T baseline keeps reserved;
qualify that channel separately before use (see `WIRING.md`). Leave all mode, reset, sleep, I/O power, motor phase, motor voltage, second
ground, and DIAG contacts unconnected.

For every axis, terminate the field cable in this exact order:

```text
interface PUL+  -> DM860T PUL+
interface PUL-  -> DM860T PUL-
interface DIR+  -> DM860T DIR+
interface DIR-  -> DM860T DIR-
interface ENA+  -> DM860T ENA+
interface ENA-  -> DM860T ENA-
```

The interface is 5 V common-anode/open-drain:

```text
protected +5 V --------------------+---- PUL+
                                   +---- DIR+
                                   +---- ENA+

Octopus STEP -> 100R -> MOSFET gate     MOSFET drain -> PUL-
Octopus DIR  -> 100R -> MOSFET gate     MOSFET drain -> DIR-
Octopus ENA  -> 100R -> MOSFET gate     MOSFET drain -> ENA-

each gate -> 100k -> source
each source -> controller logic 0 V
```

The official v1.1 schematic places 5 V `MC74HCT125A` buffers between the MCU and
the socket EN/STEP/DIR pins. These are 5 V buffered socket signals, not raw
3.3 V GPIO. Retain one characterized open-drain stage per signal because the
DM860T V3 logic input can draw up to 16 mA and direct HCT loading is not
qualified. The `2N7002` stages in `INTERFACE_BOARD.md` must have guaranteed
low resistance at a 4.5-5 V gate and be tested under the actual optocoupler
load.

## DM860T V3 Switches

Change switches only with drive power removed.

| Control | Phase-one position | Function |
| --- | --- | --- |
| `S2` | `5V` | Required for the 5 V command interface |
| `SW1` | `ON` | Provisional current group |
| `SW2` | `OFF` | Provisional current group |
| `SW3` | `ON` | 3.77 A peak group; provisional |
| `SW4` | `OFF` | 50 percent standstill current after 0.4 s |
| `SW5` | `ON` | 1600 steps/rev group |
| `SW6` | `OFF` | 1600 steps/rev group |
| `SW7` | `ON` | 1600 steps/rev group |
| `SW8` | `ON` | 1600 steps/rev group |
| `SW9` | `OFF` | Single-pulse STEP/DIR mode |
| `SW10` | `OFF` | No 12 ms command smoothing |

`SW1-SW3 = ON/OFF/ON` is a provisional starting point matching the 3.77 A peak
setting reported on a stock MR-1 high-power driver. Langmuir does not publish
the stock motor phase-current rating, so this remains a hold point. Two current
official V3 PDF filenames agree on the peak-current switch pattern but print
different RMS equivalents; this package therefore does not use the RMS column.
Select the final current from the actual drive face, motor/original-driver
evidence, and the matching manual, then run the uncoupled and thermal tests.

The grblHAL phase-one profile uses a 5 us step pulse, 6 us direction setup, and
250 ms enable delay. Those values clear the DM860T V3 minimums of 2.5 us,
5 us, and 200 ms.

## Motor And Power Terminals

Each V3 drive has three removable blocks: six-position `P1` command,
four-position `P2` brake/alarm, and six-position `P3` motor/power. Use the
blocks supplied with each drive. The manual does not publish their mating
series or pitch, so do not buy speculative spare plugs until the actual block
markings and pitch have been measured.

```text
stock motor coil pair 1 -> A+ and A-
stock motor coil pair 2 -> B+ and B-
motion supply branch    -> AC and AC
```

The V3 manual permits 24-110 VDC on the two no-polarity `AC` inputs and
recommends 30-100 VDC. The existing 36 V motion bus is within that range. Feed
each drive from its own fused star branch. Do not daisy-chain drive power.
Octopus `MAIN POWER` remains on its separate 24 V supply; 36 V must never reach
that input.

If the old terminal labels are unavailable, an ohmmeter should show continuity
only within each coil pair. Put one complete pair on A and the other complete
pair on B. Swapping A+ and A- reverses that motor; mixing wires from different
coils makes it stall or vibrate. Direction is verified later with couplers
disconnected. Both Y motors are tested one at a time before they are allowed to
move the gantry together.

The stock green driver plugs are not presumed to fit `P3`. Photograph and label
the old terminal order, release the four motor conductors, identify both coil
pairs, ferrule them, and land them in the supplied `P3` block. Preserve the old
plug for rollback. No stock motor cable lands on an Octopus motor terminal.

## Alarm Output

DM860T V3 provides `ALM+` and `ALM-`, rated up to 30 V / 100 mA. Route each
through the isolated, polarity-configurable fault conditioner in
`INTERFACE_BOARD.md`; never connect it directly to an Octopus input.

| Drive | Conditioned Octopus destination |
| --- | --- |
| X | DIAG4 / PG12 |
| Y-left | DIAG5 / PG13 |
| Z | DIAG6 / PG14 |
| Y-right | DIAG7 / PG15 |

The accepted result is low only for `drive ready + cable intact`; alarm, lost
drive power, or cable removal must read high. Characterize that truth table on
the real drive before enabling the firmware fault inputs.

## Official References

- [STEPPERONLINE DM860T V3.0 manual](https://www.omc-stepperonline.com/download/DM860T_V3.0_User_Manual.pdf)
- [BIGTREETECH Octopus Pro source and v1.1 changes](https://github.com/bigtreetech/BIGTREETECH-OCTOPUS-Pro)
- [Langmuir MR-1 machine and motion specifications](https://www.langmuirsystems.com/mr1)
