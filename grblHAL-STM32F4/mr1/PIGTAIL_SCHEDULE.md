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
> connector candidates, quantity per Octopus header, and measurement hold points.
> Any older adapter-shopping proposal is not evidence of an installed adapter.

## Status Key

- `USE / BUILD`: the electrical function and termination are identified.
- `FIT CHECK`: the contact count is known, but pitch, key, latch, crimp, or pin
  orientation must be proved on the actual part before ordering a production set.
- `HOLD`: do not buy, cut, power, or pin until the installed harness is traced.

Connector color is never identity. A housing that appears to fit is not
accepted until pin 1, contact retention, polarity, and continuity all pass.

## Octopus STEP/DIR Control Cable

The official v1.1 schematic defines an 18-position `2x9` driver footprint.
The planned cable takes control signals from the empty MOTOR0–3 sockets to the
qualified interface. No plug-in motor driver or installed socket adapter is
assumed. CL57T `P1` receives interface PUL/DIR; its `P3` receives motor phases.
The Octopus four-pin A1/A2/B1/B2 output is not a STEP/DIR cable connection.

| Schematic contact | Signal | Active use |
| ---: | --- | --- |
| 1 | EN | Reserved; leave ENA unconnected |
| 7 | STEP | Route to STEP MOSFET gate resistor |
| 8 | DIR | Route to DIR MOSFET gate resistor |
| 9 | GND | Controller logic return |
| 10 | VCC_IO / +5 V | DRIVER0 only: single takeoff through a 0.5 A fast branch fuse to +5_MOTION; leave contact 10 on every other socket unused |
| 2-6, 11-18 | Mode/reset/sleep/phases/GND/VM/NC/DIAG | No connection |

The DRIVER0 VCC_IO connection is the separate internal command-supply branch,
not an extra conductor in the four-wire interface-to-drive CMD cables. See
[COMMAND_SUPPLY.md](COMMAND_SUPPLY.md) for its physical lower-row reference,
source protection, CTRL_0V return and still-pending electrical acceptance.

Schematic numbers are electrical identities, not row-major positions. The
actual cable termination, mating view, clearance, insulation, retention and
strain relief remain HOLD until verified on the board. No drawing here supplies
a physical cavity map. Loose Dupont leads are not a finished harness. Direct
socket-buffer loading by a CL57T has not been qualified; retain the interface
qualification in `INTERFACE_BOARD.md`.

## Board-Side Shopping Schedule

| Qty | Status | Board end | Populate | Shop/build note |
| ---: | --- | --- | --- | --- |
| 4 | FIT CHECK | MOTOR0-3 18-position driver footprints | STEP contact 7, DIR 8, GND 9; EN 1 reserved | Planned control cable; verify actual contact map, viewing orientation, retention and strain relief |
| 1 | FIT CHECK | DRIVER0 VCC_IO contact 10, separate source branch | +5 V through 0.5 A fast fuse to +5_MOTION; return at logic GND 9 | One source only; all other socket VCC_IO contacts unused. See [COMMAND_SUPPLY.md](COMMAND_SUPPLY.md); connector, wire and fuse coordination pending |
| 8 | FIT CHECK | STOP0-7 three-position 2.54 mm headers | STOP0-3: SIG and GND. STOP4-7: SIG only; 12 contacts total | Leave every adjacent 5 V cavity empty. STOP4-7 relay contacts return through EXP2 GND (TB-C0); see [ALARM_INTERFACE.md](ALARM_INTERFACE.md) |
| 3 | FIT CHECK | TB, T0, T1 two-position 2.54 mm headers | Named signal and GND | Safety monitor, feed hold, Qualified sensor conditioner OUT1; module on HOLD |
| 1 | FIT CHECK | PB7 tool-setter five-position 2.54 mm header (board silk: `BLTouch`) | PB7 and its adjacent GND only | Controller housing only; no BLTouch device or plugin; PB6 and 5 V remain empty |
| 1 | FIT CHECK | PWR-DET three-position 2.54 mm header | PC0 and GND only | 3.3 V remains empty |
| 1 | FIT CHECK | EXP2 `2x5` 2.54 mm header | PB1, PB2, GND only | Use keyed IDC breakout; short internal run; insulate unused wires. EXP2 also carries `RST`. PB1/PB2 have no board pull-up/RC (interface board adds them); onboard `SW2` shares PB2 - guard or remove it |
| 1 | FIT CHECK | I2C four-position 2.54 mm header | 3.3 V and GND only | 3.3 V is TB-C3, the supply for the five 2.2 kΩ alarm pull-ups ([ALARM_INTERFACE.md](ALARM_INTERFACE.md)); also the candidate logic-side supply for conditioner modules on HOLD; PB8/PB9 remain empty |
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
| 4 | HOLD / QUALIFY | `P1` control + output | PUL+, PUL-, DIR+, DIR-, ALM, COMO | Two shielded twisted pairs for PUL/DIR; one separate shielded pair: ALM to its relay A2, COMO (COM−) to the isolated alarm return TB-A0; see [ALARM_INTERFACE.md](ALARM_INTERFACE.md). `ENA` left unconnected (drive default). `BRK` unused |
| 4 | KIT CABLE / VERIFY | `P2` encoder | EA+, EA-, EB+, EB-, VCC, EGND | Six conductors plus separate shield braid; trace matched cable using manufacturer map below. `VCC` is a drive output |
| 4 | KIT CABLE / VERIFY | `P3` motor | A+, A-, B+, B- | GX16 motor cable; identify Option A or B from manufacturer map, then trace. Published cable is unshielded; no bus power on this block |
| 4 | USE / BUILD | `P4` power | **+VDC, GND** | That drive's own fused 36 V star branch. **POLARIZED** |
| 4 | UNUSED | `P5` tuning | - | Drive-side four-contact RS232 tuning port; the supplied cable has a PC-side DB9. Do not mistake DB9 numbering for P5. Optional; verify the actual cable before use |

> **`P4` is the one that bites.** The DM860T's `P3` carried `A+ A- B+ B- AC AC`
> with a no-polarity bus pair. On a CL57T the bus is its own block and it is
> polarized. A DM860T-era six-position power/motor pigtail must be re-terminated
> and re-labelled, never adapted.

Use the [manufacturer motor Option A/B and encoder pin/color tables](CL57T_QUICK_WIRING.md#motor-and-encoder--p3-and-p2)
for matching cables. The encoder's thin black `EA+` conductor and thick black
shield are different items; the shield is not a seventh encoder signal or
return. Connector pin IDs do not specify CL57T terminal order. Photograph the
actual terminal legends and connector keys; trace all paths deenergized.

Use the supplied blocks only after identification. Do not order aftermarket
`P1`/`P4` plugs until actual pitch, contact style, and markings are recorded.

### Moulded cable routing and shield distinction

Check the actual cable length, moulded ends and enclosure pass-through before
drilling or cutting. The manufacturer's motor cable is unshielded, so the
older instruction to bond its nonexistent motor drain is withdrawn. The
encoder cable has a separate shield braid; it does not land on a signal pin.
Do not cut a supplied connector merely to satisfy a generic gland plan.

Choose a retained, strain-relieved pass-through suitable for the actual
connector. Any shield clamp or replacement cable needs its own documented
termination and conductor/connector suitability; a plastic gland is not a
shield bond. Never use the encoder braid as `EGND`.

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

| Qty | Status | Harness | Required proof before termination |
| ---: | --- | --- | --- |
| 4 channels | HOLD | Home/limit system | Trace actual X/Y1/Y2/Z contacts and factory Y2/Z series junction; document separation into four independent inputs, isolation from stock 5 V, connector view and each healthy/triggered/open state; qualify powered channels separately |
| 2 | HOLD | Touch probe and tool setter | Mating key, **actual pin order (no numbered field terminal approved)**, idle/trigger voltage on a bench supply (expected open-collector, low when triggered), exposed-metal potential (expected 5 V), probe-0 V-to-frame and stylus-to-body continuity, DB44-11/12 continuity |
| 1 | HOLD | Spindle DB44 | Exact servo model, parameter archive, end-to-end continuity, analog common, enable, alarm, and command range |
| 1 | HOLD | Temperature sensor | Part number, voltage, interface, pinout, and cable colors |

The [factory-harness correction](WIRING.md#home-and-limit-inputs) records the
manufacturer's shared Y2/Z indication and the firsthand NC series-circuit
report. The current configuration requires separate X/YL/Z/YR inputs; a shared
Y2/Z path cannot be landed unchanged. Online source colors and connector pins
are not this machine's continuity record.

Four-channel conditioning does not separate a shared signal. Trace and separate
Z/Y-right first, retaining the original harness and its recorded connections.
Only individually verified bare NC contacts isolated from the stock 5 V circuit
may share a new Octopus GND common. Signal runs retain the required field-input
protection (`INTERFACE_BOARD.md` E). Powered or electronic devices remain on the
qualified isolated path. Leave every STOP 5 V cavity empty. The full-source
`grblHAL-STM32F4/mr1/RESEARCH.md` (repository path), "Unresolved Physical Checks",
records the remaining physical evidence.

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
