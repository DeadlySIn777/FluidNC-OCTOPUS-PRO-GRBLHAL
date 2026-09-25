# MR-1 Stock-To-Octopus Pigtail Schedule

This schedule describes the planned, physically unverified build: BTT Octopus Pro v1.1 F429, four
STEPPERONLINE `CL57T V4.1` closed-loop drives with `23HS45-4204D-E1000` motors,
and the stock Langmuir MR-1 field devices. It preserves every stock plug that
can be preserved.

**Updated 2026-09-17** from the DM860T plan. The drive-side schedule changed
substantially: five connectors instead of three, motor phases and bus power on
separate blocks, and the bus pair now polarized. Board-side entries are
unaffected.

> **Buying guide:** `ORDER_LIST.md` turns this schedule into a shopping list -
> connector kits with links, quantity per Octopus header, driver-socket adapter
> sourcing, and the items that must not be ordered until something is measured.

## Status Key

- `USE / BUILD`: the electrical function and termination are identified.
- `FIT CHECK`: the contact count is known, but pitch, key, latch, crimp, or pin
  orientation must be proved on the actual part before ordering a production set.
- `HOLD`: do not buy, cut, power, or pin until the installed harness is traced.

Connector color is never identity. A housing that appears to fit is not
accepted until pin 1, contact retention, polarity, and continuity all pass.

## Octopus Driver-Socket Adapters

The official v1.1 schematic defines an 18-position `2x9` driver footprint. Use
four supported adapters, one each for MOTOR0 through MOTOR3.

| Schematic contact | Signal | Active use |
| ---: | --- | --- |
| 1 | EN | Reserved; leave ENA unconnected |
| 7 | STEP | Route to STEP MOSFET gate resistor |
| 8 | DIR | Route to DIR MOSFET gate resistor |
| 9 | GND | Controller logic return |
| 2-6, 10-18 | Mode/reset/sleep/VCC_IO/phases/GND/VM/NC/DIAG | No connection |

Schematic numbers are electrical identities, not row-major positions. A
`2x8` candidate remains on HOLD until every contact, its physical orientation,
clearance, keying and retention are verified on the actual 18-contact socket.
No drawing here supplies the mating-face view. Use a supported adapter and
prove continuity; loose Dupont leads are not a production adapter.

## Board-Side Shopping Schedule

| Qty | Status | Board end | Populate | Shop/build note |
| ---: | --- | --- | --- | --- |
| 4 | FIT CHECK | MOTOR0-3 18-position driver footprints | STEP contact 7, DIR 8, GND 9; EN 1 reserved | Verify contact map on actual board; `2x8` candidate remains HOLD until fit/keying proof |
| 8 | FIT CHECK | STOP0-7 three-position 2.54 mm headers | SIG and GND only; 16 contacts total | Leave every adjacent 5 V cavity empty |
| 3 | FIT CHECK | TB, T0, T1 two-position 2.54 mm headers | Named signal and GND | Safety monitor, feed hold, Qualified sensor conditioner OUT1; module on HOLD |
| 1 | FIT CHECK | PB7 tool-setter five-position 2.54 mm header (board silk: `BLTouch`) | PB7 and its adjacent GND only | Controller housing only; no BLTouch device or plugin; PB6 and 5 V remain empty |
| 1 | FIT CHECK | PWR-DET three-position 2.54 mm header | PC0 and GND only | 3.3 V remains empty |
| 1 | FIT CHECK | EXP2 `2x5` 2.54 mm header | PB1, PB2, GND only | Use keyed IDC breakout; short internal run; insulate unused wires. EXP2 also carries `RST`. PB1/PB2 have no board pull-up/RC (interface board adds them); onboard `SW2` shares PB2 - guard or remove it |
| 1 | FIT CHECK | I2C four-position 2.54 mm header | 3.3 V and GND only | Candidate logic-side supply only; module circuit on HOLD; PB8/PB9 remain empty |
| 1 | USE / BUILD | Octopus MAIN POWER screw terminal | +24 V and 0 V, ferruled | No pigtail; MOTOR POWER and BED POWER remain empty |
| 2 | HOLD | FAN0 and FAN4 two-position headers | None during motion commissioning | Spindle PWM/enable wait for servo and DB44 proof |
| 1 | USE / BUILD | Octopus USB-C | Shielded USB data cable | Short, strain-relieved, known data cable |

### Source Signal Identities - Physical Orientation Still Unverified

Cross-checked against the archived BTT v1.1 pin drawing and schematic sheets
1-3. The table records drawing order or schematic identities, **not a universal
left/right, top/bottom or mating-face pin order**. Establish board revision,
viewing direction, silkscreen and continuity before inserting contacts. The
archived schematic filename says v1.1 but its title blocks say Rev V1.0; that
document alone does not prove the physical board revision.

| Connector | Order as drawn | Populate |
| --- | --- | --- |
| Main terminal block | `-GND` `+HV` (MOTOR-POWER), `-GND` `+VIN` (POWER), `-GND` `+VB` (BED-POWER), `+VB` `-PA1` (BED-OUT) | Only the actual POWER/MAIN +VIN and GND pair; identify from board markings and verify polarity. Do not count screws from an assumed top |
| `STOP_0`-`STOP_7` | signal, `GND`, `5V` | Signal and GND. **`GND` is the centre pin** |
| `TB` / `T0`-`T3` | `GND`, `PF3`/`PF4`/`PF5`/`PF6`/`PF7` | TB, T0, T1 only |
| Tool setter (silk `BLTouch`) | `GND`, `5V`, `PB6`, `GND`, `PB7` | PB7 and adjacent GND only. J43 schematic contacts 1 (PB7) and 2 (GND); these are NOT positions 4/5 counted from a physical end |
| `PWR-DET` | `3.3V`, `GND`, `PC0` | GND and PC0. **`GND` is the centre pin** |
| `Probe` | `DC`, `GND`, `PC5` | Nothing. Not used on this build |
| `EXP2` | col A `PA6` `PB1` `PB2` `PC15` `GND`; col B `PA5` `PA4` `PA7` `RST` `NC` | PB1, PB2, GND - all three in column A |
| `HE0`-`HE3` | `VIN`, `PA0`/`PA3`/`PB0`/`PB11` | HE0 and HE1 only; the board switches the low side |
| `FAN0`-`FAN7` | `VF`n, `PA8`/`PE5`/`PD12`/`PD13`/`PD14`/`PD15`/`GND`/`GND` | FAN0 and FAN4, on HOLD; each positive rail is jumper-selected 5V/12V/VIN. Negative is switched return, not logic GND |
| `I2C` | `3.3V`, `GND`, `PB8` SCL, `PB9` SDA | 3.3 V and GND only |

### Driver-Slot Jumpers

Three blocks per slot, and every one of them comes off. See `WIRING.md`
"For the Octopus" for the reasoning.

| Block | Positions | Action |
| --- | --- | --- |
| Voltage select | `HV` `VM` `VIN`, above the socket | Remove. `VM` feeds nothing with no driver fitted |
| Mode / SPI | `PA6`/`CS`/`PA5`/`PA7` over the socket pins over `SLP`/`5V`/`5V`/`5V` | Remove all. A jumper loads SPI1 |
| DIAG | `M0DIAG`-`M7DIAG` to `PG6` `PG9` `PG10` `PG11` `PG12` `PG13` `PG14` `PG15` | Remove all eight. These are the `STOP_0`-`STOP_7` nets |

BTT's schematic labels several low-voltage connectors generically as
`254-2P`, `CON3`, or by position count. That establishes nominal 2.54 mm
geometry, not a guaranteed JST product series. Fit-check a single sample of
each housing before crimping the set.

## CL57T-Side Schedule

The CL57T V4.1 splits across **five** connectors, not three. Most importantly,
**motor phases and bus power are on separate blocks** (`P3` and `P4`), where the
DM860T combined them on one six-position block. Photograph all four drives with
the blocks installed before buying any replacement plug, and record the terminal
pitch into `CL57T_ARRIVAL_CAPTURE.md` §3.

| Qty | Status | Block | Populate | Cable |
| ---: | --- | --- | --- | --- |
| 4 | HOLD / QUALIFY | `P1` control + output | PUL+, PUL-, DIR+, DIR-, ALM, COMO | Two shielded twisted pairs for PUL/DIR; one separate shielded pair for ALM/COMO into its isolated conditioner. `ENA` left unconnected (drive default). `BRK` unused |
| 4 | KIT CABLE | `P2` encoder | EA+, EA-, EB+, EB-, VCC, EGND | **Kit encoder extension, 1.7 m moulded.** `VCC` is a drive output - never feed it from a field supply |
| 4 | KIT CABLE | `P3` motor | A+, A-, B+, B- | **Kit motor extension, 1.7 m moulded, GX16.** Phases only - no bus power on this block |
| 4 | USE / BUILD | `P4` power | **+VDC, GND** | That drive's own fused 36 V star branch. **POLARIZED** |
| 4 | UNUSED | `P5` tuning | - | Drive-side four-contact RS232 tuning port; the supplied cable has a PC-side DB9. Do not mistake DB9 numbering for P5. Optional; verify the actual cable before use |

> **`P4` is the one that bites.** The DM860T's `P3` carried `A+ A- B+ B- AC AC`
> with a no-polarity bus pair. On a CL57T the bus is its own block and it is
> polarized. A DM860T-era six-position power/motor pigtail must be re-terminated
> and re-labelled, never adapted.

Two of these are no longer "build" items: `P2` and `P3` ship as fixed-length
moulded kit cables. That removes two harnesses from the build but creates a new
problem - see "Moulded cable conflict" below.

Use the supplied blocks. STEPPERONLINE publishes their positions and functions
but not a mating family or terminal pitch. Do not order aftermarket `P1`/`P4`
plugs until the actual pitch, contact style, and moulded markings are recorded.

### Moulded cable conflict

`BOM.md` ("Cable and Panel Materials", Cable entry row) specifies metal EMC
glands or bonded connector bulkheads, and
`WIRING.md` requires motor-cable shields terminated 360 degrees at the cabinet
entry. Both assume cable that can be cut to length and terminated at the panel
wall. The kit's motor and encoder extensions are **fixed-length with moulded
ends** and cannot be cut without destroying the connector.

Resolve before drilling panel holes. The options are a bulkhead pass-through
sized for the moulded connector with the shield bonded at a clamp just inside
the wall, or replacing the kit cable with terminated shielded cable of the right
length. Do not simply pass an unbonded moulded cable through a plastic gland and
call the shield terminated.

For cabinet signal harnesses, start with fine-stranded industrial cable that
fits both the chosen interface terminal and the supplied CL57T block. Three-pair
shielded 22-24 AWG is a practical prototype range for `P1`; final conductor size
is released only after the actual clamp range and ferrule fit are checked.
Power and motor conductor sizes come from the existing cable, branch fuse,
length, temperature, and terminal rating, not from this signal schedule.

## Stock Motor Removal / Rollback Preservation

No stock motor wire lands on the Octopus. The active CL57T kits use their own
matched motor and encoder cables; the retained DM860T/stock motors are rollback
hardware, not part of the active wiring steps.

1. Isolate mains, spindle, 36 V, 24 V, field supplies and USB; prove dead after
   discharge with an appropriate instrument before unplugging anything.
2. Support the gravity-loaded Z axis before releasing its motor/coupler. Secure
   other movable assemblies against unexpected travel.
3. Label both ends X, YL, Z or YR and photograph every existing connection.
4. Bag and retain each motor, its original connector and its wiring record intact.
   Do not reterminate it using CL57T instructions.

Never hot-plug control, alarm, motor, encoder or power connectors. CL57T P4 is
polarized +VDC/GND; no DM860T no-polarity AC/AC recipe applies to it. Any future
rollback requires the separate DM860T document and a fresh review.

## Stock Harness Hold List

| Qty | Status | Harness | Required proof before an adapter exists |
| ---: | --- | --- | --- |
| 4 channels | HOLD | Home/limit system | Connector key and **conductor count first** (six is the expected case - shared 5 V supply, shared return and four independent signals, a powered circuit for the isolated conditioner; five may be four signals plus common; fewer conductors require tracing and do not identify which signals share), ohmmeter across each switch both polarities, common-to-all-four continuity, then healthy, triggered, unplugged, and lost-power voltages |
| 2 | HOLD | Touch probe and tool setter | Mating key, **actual pin order (no numbered field terminal approved)**, idle/trigger voltage on a bench supply (expected open-collector, low when triggered), exposed-metal potential (expected 5 V), probe-0 V-to-frame and stylus-to-body continuity, DB44-11/12 continuity |
| 1 | HOLD | Spindle DB44 | Exact servo model, parameter archive, end-to-end continuity, analog common, enable, alarm, and command range |
| 1 | HOLD | Temperature sensor | Part number, voltage, interface, pinout, and cable colors |

The pinned community MR-1 conversion describes its stock inputs as active-high
and its limit/E-stop circuits as `NC 5V`, and its input table puts `Y2/Z limit`
on a single input. Treat that as a warning and a hypothesis, not a pinout - it
is the reason the conductor count is the first measurement on the home harness.
Route the stock home channels through the four-channel isolated conditioner
unless each switch is separately proved to be a bare NC dry contact; if all
four prove out, the common lands on Octopus `GND`, each signal on its `STOP`
SIG, and the conditioner comes out of the build. Never apply stock 5 V to
STOP0-3. `grblHAL-STM32F4/mr1/RESEARCH.md` (repository path), "Unresolved
Physical Checks" items 3 and 4, carries the probe and home hypotheses with their
sources and the exact readings that close them.

## Crimp And Label Rules

- Use the housing manufacturer's matching contact and crimp tool once the
  connector family is physically identified.
- Pull-test every crimp before inserting it into a housing.
- Mark pin 1 on both halves and add a machine-readable cable ID at both ends.
- Leave unused powered cavities empty rather than installing unterminated wires.
- Use ferrules in screw clamps; never tin stranded wire for a screw terminal.
- Clamp cable shields at the cabinet entry according to the cable schedule;
  never use a shield or PE as signal return.
- Record finished continuity in `cable-schedule.csv` before energizing a domain.

## Source Boundary

- BTT's official v1.1 schematic and pinout own Octopus geometry and signals.
- STEPPERONLINE's CL57T V4.1 manual owns the active P1-P5 functions and electrical limits. The DM860T V3.0 manual applies only to the rollback set.
- Langmuir's assembly guide proves the stock high-power-driver harness uses
  three removable blocks; it does not identify their mating family or pitch.
- The pinned alexphredorg MR-1 project is a stock-harness warning and
  continuity hypothesis only; its Mesa terminals, colors, and polarity are not
  Octopus wiring.
