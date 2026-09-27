# MR-1 Conversion Order List — Octopus-Side Connectors

Identify each actual Octopus connector before buying its mating part. Power
blocks and signal/output headers serve different domains; position count and
apparent fit do not prove connector family or terminal rating.

This list covers only the **controller side**, whose signal identities are documented by BTT, but connector family, actual
orientation and retention still require physical verification. It deliberately does **not** cover
the CL57T drive-side plugs — see "Do not order yet" at the end.

Quantities below include spares, because crimping a housing wrong is routine and
re-ordering mid-build is not.

---

## 1. JST-XH 2.54 mm connector kit — the bulk of the job

Nearly every Octopus field connector is 2.54 mm in 2, 3, 4, or 5 positions. One
pre-crimped kit covers all of them and avoids buying a crimp tool.

**Get a kit with pre-crimped wires**, not bare housings and loose terminals.
Pre-crimped means you push pins into housings by hand — no tool, no bad crimps.

| Option | Notes |
| --- | --- |
| [JTSINERU JST-XH kit, 22 AWG pre-crimped, 2–10 pin](https://www.amazon.com/JTSINERU-Connector-Pre-Crimped-Electronics-JTS-2-5-XH/dp/B0F2MDL5MK) | 100 wires, 165 mm, 10 colors. Good colour range for labelling by axis |
| [Keszoox XH 2.54 mm kit, 22 AWG pre-crimped](https://www.amazon.com/Keszoox-Connector-Pre-Crimped-Housing-Adapter/dp/B096Q81JBB) | Similar, includes heat shrink and tweezers |
| [Teansic XH 2.54 mm male+female kit, 2–7 pin](https://www.amazon.com/Teansic-Connector-Pre-Crimped-Housing-Adapter/dp/B0DGFTYC7C) | Includes both genders |
| [INJORA XH 2.54 mm kit, 150 pc + heat shrink](https://www.amazon.com/INJORA-Pre-Crimped-Shrinkable-Connectors-Compatible/dp/B0BCK5QYLL) | Includes tweezers, useful for pin insertion |

22 AWG is right for these signals. The pre-crimped leads are short (150–165 mm),
so they are **pigtails to splice or terminate onto longer cable**, not full runs.
That is what you want — the long run should be proper shielded cable, with the
pigtail only at the board end.

### What the Octopus actually needs

| Octopus connector | Positions | Qty | Use |
| --- | ---: | ---: | --- |
| `STOP0`–`STOP3` | 3 | 4 | Home switches, from a qualified conditioner (on-hand module on HOLD). **5 V cavity stays empty** |
| `STOP4`–`STOP7` | 3 | 4 | Optional per-axis drive-fault wiring, PG12–PG15 (not read by the current firmware; PB1 is the only drive-fault stop) |
| `PWR-DET` | 3 | 1 | Safety door (PC0) |
| `TB` | 2 | 1 | E-stop / safety-relay monitor (PF3) |
| `T0` | 2 | 1 | Feed hold (PF4) |
| `T1` | 2 | 1 | Touch probe (PF5) |
| `BLTouch` silk header | 5 | 1 | Tool setter on PB7 only. **PB6 and 5 V stay empty** |
| `I2C` | 4 | 1 | Candidate conditioner LOGIC-side power (3.3 V + GND only), never isolated field power |
| `FAN0` | 2 | 1 | Spindle PWM carrier (PA8) |
| `FAN4` | 2 | 1 | Spindle enable relay (PD14) |

The table totals **16 housings**: nine 3-pin, five 2-pin, one 4-pin and one
5-pin, before spares. Candidate kits still require a fit/retention check.

> **Fit-check one sample before crimping the set.** BTT's schematic labels these
> generically as `254-2P` / `CON3` / by position count, which establishes 2.54 mm
> geometry but not a guaranteed JST-XH product family. Seat one housing on one
> header and confirm retention before committing the rest. This rule is already
> in `PIGTAIL_SCHEDULE.md` and it still applies.

---

## 2. EXP2 — 2×5 IDC ribbon

`EXP2` is a 2×5 shrouded 2.54 mm header. You need PB1 (the drive-fault
aggregate — the only input that stops the machine), PB2 (cycle start) and their
GND.

| Option | Notes |
| --- | --- |
| [Antrader 10-pin 2×5 F/F IDC ribbon, 30 cm, 6 pcs](https://www.amazon.com/Antrader-Pieces-Pitch-Ribbon-Connector/dp/B07FZWWGY3) | Simplest: pre-made cable, cut one end and use the three conductors you need (PB1, PB2, GND) |
| [jujinglobal IDC 10-pin to 3.81 mm terminal breakout, 3 pcs](https://www.amazon.com/jujinglobal-Terminal-Breakout-Expansion-Connector/dp/B0DMJYR6YG) | Converts the ribbon to screw terminals — tidier, and gives you the screw terminals you were missing |
| [Connectors Pro 2×5 IDC plugs, 50 pk](https://www.amazon.com/Connectors-Pro-50-Pack-2-54mm-Transition/dp/B07B8MDHBD) | If you want to make your own to length |

The breakout option is worth the few dollars: it turns EXP2 into screw terminals
and keeps the run short inside the cabinet, which is what `PIGTAIL_SCHEDULE.md`
already asks for.

**Insulate every unused conductor.** PB1, PB2 and GND use three conductors of
the 10-way ribbon; insulate and retain the other seven separately.

---

## 3. Octopus STEP/DIR control cable — termination on HOLD

Plan four retained control-cable connections from the empty MOTOR0–MOTOR3
sockets to the qualified interface. No plug-in motor driver or installed socket
adapter is assumed or required by this parts list. Choose the actual mating
contact/housing method only after identifying the board and verifying fit,
orientation, insulation, retention and strain relief.

The required **schematic contact identities** are 7 STEP, 8 DIR and 9 GND;
contact 1 EN stays reserved and unconnected. These numbers do not identify a
physical row or a mating-face orientation. Leave phases, VM, VCC_IO, mode,
reset, sleep and DIAG unconnected. See `PIGTAIL_SCHEDULE.md` for the control-cable
boundary and physical checks.

The Octopus four-pin A1/A2/B1/B2 output is a motor-phase connector, not the
external drive's control source. CL57T motor wires go to `P3`; the qualified
interface feeds its `P1` PUL/DIR inputs. A cable or breakout alone does not
qualify direct loading of the board's 5 V HCT outputs by the CL57T.
`INTERFACE_BOARD.md` still requires the loaded current, level, timing and
startup/shutdown checks. Loose unsupported Dupont leads are not a finished
harness, and a generic StepStick product description does not release a part.

---

## 4. Also worth having

| Item | Why |
| --- | --- |
| Ferrules + ferrule crimper, 22–16 AWG | Your BOM already forbids tinned wire in screw clamps. `MAIN POWER` and the CL57T `P1`/`P4` blocks all want ferrules |
| Heat-shrink assortment | Every pigtail-to-cable splice |
| Wire labels or a label printer | `cable-schedule.csv` assigns an ID to every run; unlabelled cable is how a 36 V pair ends up on a logic pin |
| Shielded twisted-pair cable, 22–24 AWG candidate | Command/signal runs only; final size and terminal fit require qualification. This does not describe the kit motor or encoder leads |

---

## 5. Matched motor and encoder extensions — measure before ordering

The September 19 note estimated a roughly 3.4 m straight-line run against the
1.7 m kit leads. That is a historical planning estimate, not a recorded routed
length for all four axes. Measure each full-travel path, bend radius, drag-chain
allowance and strain relief before selecting a replacement length.

The following are previously identified manufacturer candidates. Recheck the
current listing and exact motor/encoder connector compatibility before buying;
none is physically qualified merely by appearing in this table.

| Part | What it is | Qty || Part | What it is | Qty |
| --- | --- | ---: |
| [**CE5-M5-20**](https://www.omc-stepperonline.com/4-7m-185-awg20-motor-and-encoder-extension-cable-kit-for-nema-23-and-24-closed-loop-stepper-motors-ce5-m5-20) | **4.7 m AWG20 motor + encoder kit, NEMA 23/24 closed loop.** One SKU covers both cables for one axis | **4** |
| [CM5M-20](https://www.omc-stepperonline.com/4-7m-185-awg20-motor-extension-cable-with-gx16-aviation-connector-for-nema-23-and-24-closed-loop-stepper-motors-cm5m-20) | 4.7 m AWG20 motor cable only, GX16 | as needed |
| [CL-ME-CABLE](https://www.omc-stepperonline.com/closed-loop-motor-and-encoder-extension-cables-with-various-lengths-only-for-replacing-cl-me-cable) | Custom lengths, if 4.7 m is short or you want exact cuts | as needed |

Identify the actual cable SKU and its motor/encoder compatibility, then verify
conductor and terminal ratings, route length, flex duty, temperature and phase/
encoder mapping. NEMA frame size or a matching plug shape alone does not prove
compatibility. No voltage-drop calculation or cable qualification is established
by this shopping list.

**Measure the routed path before ordering.** If a listed length does not fit,
identify a compatible replacement of the required length. Record the routing
and separation from sensitive cables; do not hide excess cable in an unreviewed coil.

### Kit cable and shield distinctions

The [manufacturer wiring reference](https://help.omc-stepperonline.com/hc/s/articles/wiring-diagram-for-closed-loop-stepper-motor)
describes an **unshielded motor cable** and a **shielded encoder cable**.
Use the pin/color tables in `CL57T_QUICK_WIRING.md` to identify the applicable
motor Option A/B and all six encoder paths, then verify the actual cable.

There is no motor-cable drain to bond on that published kit lead. Do not order
shield hardware on the assumption that it has one. The encoder's separate
thick black shield braid is not its thin black `EA+` signal or its white `EGND`
return. Keep an unused exposed braid insulated and retained; no blanket EGND,
GPIO, or connector-pin assignment is approved. The final encoder shield bond
or clamp location remains subject to a qualified cable/cabinet bonding plan.

Use the matched kit leads where the measured route and duty permit. A longer
assembly must be independently checked for connector mapping, ratings,
retention and flex suitability. A replacement cable replaces the corresponding
short lead; no unreviewed extension splice or connector chain is specified here.
Keep serviceable short leads for the separate protected bench setup.

| Axis | Measured routed run | Compatible length selected |
| --- | --- | --- |
| X | ________ m | ________ |
| Y-left | ________ m | ________ |
| Z | ________ m | ________ |
| Y-right | ________ m | ________ |

### Additional shielding — optional design, not a construction instruction

The earlier mandatory cabinet-side motor braid sleeve and motor-shield rule
are withdrawn for the published unshielded kit cable. Do not install or bond a
sleeve from a generic one-end/both-end recipe. Additional shielding or a shielded
replacement requires a documented design covering clearances, coverage,
termination, connector/shell bonding and the manufacturer's requirements.
Neither a partial sleeve nor a cable's shielding label proves EMC performance.

Maintain separation between motor/power wiring and encoder, limit, probe and
command wiring. If interference appears during authorized commissioning,
stop and diagnose the actual routing, returns, signal levels and terminations;
this document does not prescribe adding a shield as an automatic remedy.
A shield is never PE or a phase/signal return. Verify motor/frame protective
bonding separately from every cable shield.

### Keep the 1.7 m kit cables

Do not discard them. They are the right length for bench work: commissioning a
single uncoupled drive on the bench, and the `CL57T_ARRIVAL_CAPTURE.md` alarm
characterization, both want a short lead rather than a 4.7 m one.

---

## Do not order yet

**CL57T `P1` and `P4` plugs.** The drives ship with removable blocks.
STEPPERONLINE publishes their positions and functions but **not** a mating family
or terminal pitch, so an aftermarket plug cannot be chosen from the datasheet.
`CL57T_ARRIVAL_CAPTURE.md` §3 asks you to photograph and measure the pitch and
position count first. Order after that, not before.

**Additional optocouplers.** Quantity remains on HOLD. The on-hand home and
sensor modules are unqualified. Plan four home, four alarm and two sensor field
functions, then count the actual components needed for the approved circuitry.
The alarms require a supervised PB1 aggregate; optional PG12-PG15 per-axis outputs are not read by the current firmware;
raw ALM/COMO terminals are not series contacts and may need additional logic.
Do not reduce the order to six or assume one optocoupler per function without
the reviewed circuit and confirmed on-hand parts.
