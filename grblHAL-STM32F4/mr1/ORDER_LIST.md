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
| `STOP4`–`STOP7` | 3 | 4 | Drive-fault indication, PG12–PG15 |
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

**Insulate every unused conductor.** A 10-way ribbon where eight wires are
unused is eight chances to short something against the board.

---

## 3. Driver-socket adapters — order carefully

This is the one where Amazon is a trap.

You need an adapter that plugs into a **Pololu/StepStick driver socket** and
breaks out `STEP`, `DIR` and `GND` so they can reach an external drive. Many
adapters also break out `ENABLE`; that output stays unconnected because EN is
reserved in this build. Searching Amazon for "stepper driver adapter" mostly returns **motor
extension cables** and A4988 breakout boards, which are a different thing
entirely and will not help.

Candidate parts - no product in this list is physically qualified for this board:

- [External Stepper Motor Driver Adapter — Bart Dring, Tindie](https://www.tindie.com/products/33366583/external-stepper-motor-driver-adapter/)
- [External Stepper Driver Adapter for Pololu-style socket — Cohesion3D](https://cohesion3d.com/shop/peripherals/external-stepper-driver-adapter-for-pololu-style-socket/)
- [Pololu Socket to External Driver Conversion Board — PiShop](https://www.pishop.us/product/pololu-socket-to-external-driver-conversion-board/)

Quantity **4**, for MOTOR0–MOTOR3.

**What to verify on any candidate**, per `PIGTAIL_SCHEDULE.md`:

- Routes socket pin **7 = STEP**, pin **8 = DIR**, pin **9 = GND**. If it also
  routes pin **1 = EN**, leave that output unconnected (EN is reserved)
- Fits the actual **18-contact** socket with proved continuity, orientation,
  clearance, keying and retention. A `2x8` candidate remains on HOLD until
  those checks pass; schematic numbers are not physical row counts
- Leaves phases, `VM`, `VCC_IO`, mode, reset, sleep and `DIAG` unconnected

No fallback adapter is released solely from a generic StepStick description.
A `2x8` candidate requires the same actual-board verification. **Loose Dupont leads into a driver socket
are not acceptable** — a one-row offset puts motor-supply voltage onto a logic
pin.

---

## 4. Also worth having

| Item | Why |
| --- | --- |
| Ferrules + ferrule crimper, 22–16 AWG | Your BOM already forbids tinned wire in screw clamps. `MAIN POWER` and the CL57T `P1`/`P4` blocks all want ferrules |
| Heat-shrink assortment | Every pigtail-to-cable splice |
| Wire labels or a label printer | `cable-schedule.csv` assigns an ID to every run; unlabelled cable is how a 36 V pair ends up on a logic pin |
| Shielded twisted-pair cable, 22–24 AWG | The long runs. Pigtails only terminate at the board |

---

## 5. Motor and encoder extensions — RESOLVED, order these

**The kit's 1.7 m leads are too short.** Measured against the machine
2026-09-19: the required run is roughly **double** the kit length, so about
3.4 m straight-line.

**Budget 4–5 m, not 3.4 m.** A cable laid beside the machine measures a straight
line. The real path runs up the left rear leg, along the frame, through any drag
chain, and out to the motor at its farthest travel — routinely 20–40% longer
than the straight shot.

| Part | What it is | Qty |
| --- | --- | ---: |
| [**CE5-M5-20**](https://www.omc-stepperonline.com/4-7m-185-awg20-motor-and-encoder-extension-cable-kit-for-nema-23-and-24-closed-loop-stepper-motors-ce5-m5-20) | **4.7 m AWG20 motor + encoder kit, NEMA 23/24 closed loop.** One SKU covers both cables for one axis | **4** |
| [CM5M-20](https://www.omc-stepperonline.com/4-7m-185-awg20-motor-extension-cable-with-gx16-aviation-connector-for-nema-23-and-24-closed-loop-stepper-motors-cm5m-20) | 4.7 m AWG20 motor cable only, GX16 | as needed |
| [CL-ME-CABLE](https://www.omc-stepperonline.com/closed-loop-motor-and-encoder-extension-cables-with-various-lengths-only-for-replacing-cl-me-cable) | Custom lengths, if 4.7 m is short or you want exact cuts | as needed |

`CE5-M5-20` is the straightforward choice. AWG20 is the vendor's own gauge for
NEMA 23/24 — AWG18 is the NEMA 34 part — so it is matched to the
`23HS45-4204D-E1000`. Verify the actual cable SKU, conductor and terminal
ratings, route length, flex duty and temperature. No voltage-drop calculation
or cable qualification is established by this shopping list.

**Measure the routed path before ordering.** If it exceeds 4.7 m, use
`CL-ME-CABLE` and specify the length rather than coiling excess — coiled motor
cable adds inductance and is an avoidable EMI source.

### Shielding facts — from StepperOnline's own help centre

| Cable | Shielded? | Source |
| --- | --- | --- |
| **Motor** | **NO** — *"The motor cable is not shielded."* | StepperOnline closed-loop wiring guide |
| **Encoder** | **YES** — *"The encoder cable is shielded. The thick black wire in the encoder cable is the shield braid; it does not need to be connected to any pin."* | same |

This matters twice over. First, the 4.7 m kit would **not** have satisfied this
project's own rule that motor-cable shields terminate 360 degrees at the cabinet
entry (`WIRING.md`, `BOM.md`) — the motor cable it ships is bare. Second, it
means any custom alternative must be qualified for phase mapping, conductor
ratings, flex life, retention, shielding and insulation; equivalence is not
established simply because both motor cables are unshielded.

### Chosen approach (2026-09-19, revised): buy extensions, sleeve the motor runs

**Decision: buy ready-made extensions rather than building cable.**

Home-made extensions looked cheaper per metre, but the real purchase is spools:
roughly $90 for 100 m spools to serve about 15 m of need, plus connectors, plus
around 80 solder joints across four axes, plus the risk of a bad joint inside a
drag chain. Ready-made assemblies are the better trade at roughly $132.

Buying extensions also **removes the splice entirely** - the bought cable
replaces the 1.7 m lead rather than chaining onto it. No junction, no shield
continuity problem at a joint, one fewer failure point per axis.

**Measure each axis before ordering; do not buy four long ones.** The four axes
are not equidistant from the left rear leg. Z sits on the column near the
enclosure; the far Y is the long haul. Mixed 2.7 m and 4.7 m ordering is where
the remaining savings are.

| Axis | Measured routed run | Length ordered |
| --- | --- | --- |
| X | ________ m | ________ |
| Y-left | ________ m | ________ |
| Z | ________ m | ________ |
| Y-right | ________ m | ________ |

### Sleeving still applies to the motor runs

The motor extension is **unshielded** by vendor design, so the braided sleeve
still has a job. Slide it over the **cabinet-side portion** of each motor run and
bond at the cabinet; leave the far end toward the motor bare.

Full-length coverage is not worth the sleeve cost, and the geometry favours
partial coverage: the cabinet-side portion runs parallel to encoder, limit and
probe wiring and to the Octopus itself, while the motor end sits out at the axis
away from anything sensitive. Shielding is not binary - covering the section that
parallels sensitive cable captures most of the benefit.

Shield termination remains a cabinet-design hold point. A partial braid sleeve
is a proposed EMC measure, not proof that an unshielded cable meets a shielded
cable specification. Document its coverage, routing, connector/shell bonding
and the selected cable/drive manufacturer's termination requirements. Do not
choose one-end versus both-end bonding from a universal ground-loop rule.

Use a suitable rated 360-degree clamp/gland where the design calls for one;
proper pressure termination is not replaced by an unsupported blanket solder
instruction. Keep braid clear of live phase pins. A shield is never protective
earth or a phase/signal return. Verify motor/frame protective bonding separately;
paint, mounting hardware and isolators can interrupt an assumed chassis path.

**Record partial sleeving as a deliberate deviation**, not as compliance:
`WIRING.md` and `BOM.md` call for shielded motor cable terminated 360 degrees at
the cabinet. If phantom limit trips or encoder faults appear under spindle load,
extending the sleeve toward the motor is the first remedy to try.

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
The alarms require a supervised PB1 aggregate and separate PG12-PG15 indications;
raw ALM/COMO terminals are not series contacts and may need additional logic.
Do not reduce the order to six or assume one optocoupler per function without
the reviewed circuit and confirmed on-hand parts.
