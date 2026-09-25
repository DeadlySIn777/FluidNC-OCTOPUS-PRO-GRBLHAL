# MR-1 Conversion Bill of Materials

Quantities are for X, Y-left, Y-right, and Z. Do not place the final order until
the measurement hold points and current product listings have been checked.

## Motion Kit Decision

The active build uses four CL57T V4.1 drives with 23HS45-4204D-E1000 motors.
The DM860T V3.0 drives and stock motors are rollback hardware to preserve intact.
Verify all actual labels against `CL57T_QUICK_WIRING.md` before assembly; this
parts list does not establish arrival inspection or physical qualification.

Purchase whichever has the lower delivered price while preserving those exact
part numbers:

- Four of the [one-axis 1-CL57T-S30A-V41 kit](https://www.omc-stepperonline.com/ts-series-3-0-nm-424-92oz-in-1-axis-closed-loop-stepper-cnc-kit-nema-23-motor-driver-1-cl57t-s30a-v41).
- One [four-axis 4-CLTS30A-V41 kit](https://www.omc-stepperonline.com/ts-series-4-axis-3-0nm-424-83oz-in-nema-23-closed-loop-stepper-kit-w-power-supply-4-clts30a-v41), after confirming its current contents and power supply.

The one-axis listing currently identifies these contents for each axis:

- `23HS45-4204D-E1000`, 3.0 Nm, 4.2 A/phase, 57 x 57 x 135 mm.
- 8 mm D-cut shaft, 21 mm projection.
- `CL57T V4.1` driver.
- 1.7 m motor extension with GX16 connector.
- 1.7 m encoder extension.
- RS232 setup/debug cable.

Do not substitute the older CL57T revision or a similarly named motor without
rechecking current, encoder, shaft, cable, and driver manual.

### Why 3.0 Nm, Not 3.5 Nm

The 3.0 Nm motor is the right starting choice. Community measurements place the
larger stock MR-1 motors near 420 oz-in, essentially the same torque class, and
the exact 3.0 Nm motor remains a NEMA 23 frame. Higher-torque options usually add
length, current, rotor inertia, or a NEMA 24 frame that may not fit the stock
brackets. At the published 100/100/40 IPM rates, that trade is not justified
before testing the real machine.

Closed-loop drives are the major upgrade because a motor following error can
stop the controller instead of silently losing motor position. They close the
loop at the motor encoder, not at the table. A loose coupler, ballscrew error,
backlash, or gantry movement downstream of the motor remains invisible.

## Required Hardware

| Qty | Item | Minimum specification | Status/notes |
| ---: | --- | --- | --- |
| 1 | BTT Octopus Pro | Silkscreen v1.1, STM32F429ZGT6 | Already owned; photograph before use |
| 4 | CL57T V4.1 drives + 23HS45-4204D-E1000 motors | `1-CL57T-S30A-V41` singles; no PSU included | **ACTIVE 2026-09-17.** Settings in `CL57T_QUICK_WIRING.md`: S1=4, SW1/3/4 on, SW2 off, SW5-8 off, S3=5V |
| 4 | DM860T V3.0 drives + stock Langmuir motors | Exact 10-switch V3 face | **ROLLBACK SET - preserve intact.** Never commissioned; do not sell, modify, or scavenge until closed loop passes |
| 1 | **`S-360-36` switch-mode supply (INSTALLED)** | AC in 110/220 V +/-15%, **DC out 36 V 10 A (360 W)** | **Historically identified 2026-09-20; not a fresh electrical test.** 36 V nominal lies within the drive range, but actual ripple/regen and four-drive capacity remain unqualified. The 9.6-11.2 A figure is a sizing heuristic only. Verify the actual supply input selector matches the measured facility service, with power isolated |
| 1 | USB-to-RS232 adapter (DB9) | Genuine FTDI chipset preferred | **Not supplied with the kit** - the tuning cable has a PC-side DB9; drive-side P5 is a four-contact port. Optional: `S1` presets cover current and three rigidity settings, so commissioning does not need it. Buy only if an axis misbehaves after trying `S1` 4/5/6 |
| 1 | 24 V control supply | Regulated, recognized, DIN mount preferred, at least 2.5 A after load calculation | Octopus main power and relay coils only |
| 2 | 24-to-5 V isolated DC/DC | Reinforced/functional isolation as required, current-limited output | Separate field domains: one for probe/setter and one for stock home/limit conditioning |
| 1 | HW-399 TLP281-4-compatible four-channel module | Candidate only; trace actual circuit and isolated domains | On hand, HOLD pending circuit/terminal proof and bench qualification; two sensor channels planned |
| 1 | **TLP281-4 four-channel opto isolation module (ON HAND)** | Actual module circuit, resistor values and isolation unverified | **HOLD, candidate for four homes only.** No floating-VCC recipe is approved; shared pullups may couple outputs. Trace and qualify all state combinations per `INTERFACE_BOARD.md` A2 |
| 1 | Protected 5 V motion supply | At least 0.75 A, fused | CL57T `P1` PUL/DIR optocouplers only; `S3` on every drive must be `5V` |
| 1 | Safety relay | Dual-channel inputs, manual monitored reset, suitable diagnostic contacts | Select from risk assessment, not price alone |
| 1 set | Motion/spindle contactors | Correct DC/AC utilization category, coil voltage, interrupt rating, auxiliary contacts | Sized after supply and stop analysis |
| 1 | Lockable main disconnect | Rated for installed service | Mains design item |
| 1 set | Branch protection | DIN fuse holders/breakers and spare fuses | Select to conductor and load |
| 1 | Metal control enclosure | Bonded backplate, gland plate, filtered ventilation | Keep low-voltage I/O away from power devices |
| 1 | Interface-board assembly | Per `INTERFACE_BOARD.md` | Prototype first, then one-piece board |
| 1 | Isolated PWM-to-analog stage | Accepts 24 V switched PWM and outputs calibrated isolated 0-5 V | Must be tested into actual servo analog input |
| 3 | Interposing output channels | 24 V input, load-rated isolated contact/output | Spindle enable, flood, mist/air; safety path is separate |
| 4 | NC sealed home switches | Coolant-resistant, repeatable, positive mechanical actuation | Do not buy replacements yet; trace the powered stock harness first, or replace it intentionally with proved bare dry switches |
| 1 | Dual-channel E-stop station | Twist/pull release, positive-opening NC contacts | Locate within immediate reach |
| 1 | Feed-hold button | NC contact block | Software control, not safety function |
| 1 | Guarded cycle-start button | NO contact block | Prevent accidental start |
| 1 | Door/interlock switch | Contact type chosen from risk assessment | PC0 only monitors it; safety wiring may need separate contacts |
| 1 | Shielded USB cable | Short, robust USB-A to USB-C or PC-appropriate, ferrites preferred | Windows mini PC to Octopus |

Examples such as a Mean Well HDR-series 24 V supply or an Omron/Pilz safety
relay describe the product class only. Select exact catalog numbers after the
load calculation, required safety performance level, local stock, and panel
voltage are known.

## Interface Board Parts

Final values are released only after breadboard tests. The initial engineering
allowance is:

| Qty | Part class | Purpose |
| ---: | --- | --- |
| 8 active + 4 reserved | 2N7002 or characterized N-MOSFET with guaranteed performance at 4.5-5 V gate | Eight candidate PUL/DIR sinks from 5 V HCT-buffered sockets; four ENA channels reserved and unpopulated |
| 8 active + 4 reserved | 100 ohm gate resistors | Limit edge current/ringing |
| 8 active + 4 reserved | 100 kohm gate-source resistors | Defined gate state |
| HOLD - count after circuit design | Input isolation and logic | Four home + four alarm + two sensor field functions planned. On-hand modules are unqualified. Alarm design must provide a supervised PB1 aggregate plus independent PG12-PG15 indications; this may require extra isolated outputs/logic. Do not equate ten field functions with a fixed ten-component BOM |
| 2 | Schmitt/logic conditioners | Clean probe/tool-setter controller outputs if optocoupler edges require them |
| 1 set | Polarity/configuration jumpers | Match characterized active CL57T; any DM860T rollback requires separate review |
| 1 set | TVS, resettable fuses, reverse-polarity protection | Field-port protection |
| 1 set | Pluggable terminal blocks | Keyed motion, alarms, probes, spindle, controls |
| 1 set | Test points | 24 V, 5 V, isolated 5 V, every PUL/DIR/ENA, alarm, probe, analog command |
| 4 | 18-position `2x9` driver-socket adapters | Active contacts 7/8/9; 1 EN reserved. Actual fit/orientation/continuity required; 2x8 candidate on HOLD until mechanically and electrically proved |
| 1 | Board support hardware | Standoffs/bracket so socket pins carry no cable load |

Use recognized components with documented temperature and voltage ratings. The
already-owned HW-399 is an explicitly provisional commissioning module, not a
presumed production substitute: inspect its PCB, compare it with the documented
module schematic, and measure isolation, polarity, current, and thresholds.
Other anonymous optocoupler/relay boards are not approved; many share grounds
unexpectedly, omit protection, or cannot meet the required input thresholds.

## Final Digital Spindle Hold

Digital RS-485 is the selected final command path and the analog converter is
retained as a commissioning/rollback fallback. Do not order these parts from
generic descriptions. Stage 0 in
`SPINDLE_SUPERVISION.md` must identify the actual drive, connectors, signals,
encoder, and cabinet clearances first.

| Qty | Part class | Requirement | Status |
| ---: | --- | --- | --- |
| 1 | Reversible servo interposer/harness | Mates the verified stock connector without cutting the harness | HOLD |
| 1 | Isolated RS-485 channel | 3.3 V USART2 side, documented isolation/surge/termination | HOLD |
| 1 | Isolated differential encoder receiver | Receives verified OA/OB/OZ without bonding servo common to logic | HOLD |
| 1 set | Isolated 12-24 V input channels | SRDY, ALM, ASP, ZSP, COIN/PtoS only after configured assignment proof | HOLD |
| 1 set | Isolated 12-24 V output channels | SON plus future CMODE and guarded ACLR, each power-up safe | HOLD |
| 1 | Hardware heartbeat watchdog | Removes normal SON permission if controller heartbeat stops | HOLD |
| 1 | Spindle-side index sensor and rigid bracket | One unambiguous pulse per spindle revolution, coolant/chip protected | HOLD |
| 1 | Differential pulse/direction driver | Future position/orientation command only | HOLD |
| 1 set | Isolated DC/DC and protection | Sized after actual channel load and required isolation are known | HOLD |

The existing isolated analog command remains the reversible fallback after
digital command is commissioned. The interposer must select the paths
break-before-make; it must never drive both at once.

## Cable and Panel Materials

| Item | Guidance |
| --- | --- |
| Motion command cable | Three shielded twisted pairs per axis, small-gauge stranded industrial control cable |
| Alarm cable | One shielded pair or supervised multi-core per drive |
| Stock home cable | Reuse only after supply/signal/return trace; route through the four-channel isolated conditioner |
| Dry-contact control cable | Shielded twisted pair, coolant-resistant jacket where exposed |
| Probe/tool-setter cable | Individually shielded flexible cable, isolated from motor routing |
| 36 V branch wire | Sized from supply, fuse, run length, temperature, and panel standard |
| 24 V control wire | Color-coded and ferruled; separate fused distribution |
| PE conductors | Green/yellow where applicable, sized to code, ring terminals at bonded studs |
| Cable entry | Metal EMC glands or bonded connector bulkheads plus strain relief |
| Termination | DIN terminals, end stops, ferrules, labels, heat shrink; no tinned wire in screw clamps |
| Ventilation | Filtered fan and thermostat if thermal calculation requires it |
| Service items | Spare fuses, one spare optocoupler channel, printed terminal labels; buy spare removable plugs only after actual pitch/family measurement |

For the active CL57T kits, use the included separate motor and encoder
extensions. Keep encoder and alarm cables away from motor phase conductors even
if the connector bundles look convenient together.

## Measure Before Buying

The board-side housing and stock-harness counts are in `PIGTAIL_SCHEDULE.md`.
Do not collapse its `FIT CHECK` or `HOLD` rows into a generic JST kit.

Record these dimensions in millimeters and retain photos with the caliper in
frame:

| Measurement | Why it matters |
| --- | --- |
| X, YL, YR, Z screw input shaft diameter and usable length | Selects the machine side of each coupler |
| Existing motor shaft diameter/key/flat | Confirms what the stock coupler was designed for |
| Motor bolt square and fastener size | Confirms NEMA 23 bracket compatibility |
| Register/pilot diameter and depth | Prevents bracket interference and misalignment |
| Maximum body length and connector clearance | New motor is 135 mm long before bend radius |
| Coupler outside diameter and available axial envelope | Prevents cover or bearing-housing collision |
| Required shaft gap and end float | Prevents axial preload through the coupler |
| Splash-cover envelope and airflow path | Protects the unsealed encoder motor without overheating it |

The new motor side is 8 mm. Community conversions mention machine-side values
near 6.35 mm, but that is not enough evidence to order four `8 mm x 6.35 mm`
couplers. Use zero-backlash clamp-style couplers after the exact shafts are
measured. Avoid set-screw-only couplers and do not use a flexible coupler to
hide bracket misalignment.

## Nice-to-Have Additions

| Item | Value |
| --- | --- |
| Cabinet temperature switch/sensor | Trips or reports fan failure/overtemperature |
| DC-bus discharge indicator | Shows when the 36 V bus is actually safe to service |
| Panel test jacks | Scope motion signals without opening field terminals |
| Industrial USB isolator | Useful if measurement shows a PC/controller ground-loop problem |
| Pendant/MPG | Future operator control after core commissioning |
| RS-422 receiver board | Future stock spindle encoder and actual-speed feedback |
| Rigid accelerometer mount | Repeatable spindle/structure vibration comparison |
| Air-pressure switch | Can inhibit a program that requires air blast |
| Coolant level/flow switch | Can feed the aggregate fault after electrical isolation |

Do not add convenience features until the E-stop, limits, drive faults, probe,
and tool setter pass the acceptance tests.
