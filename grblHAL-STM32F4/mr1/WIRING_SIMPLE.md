# MR-1 Wiring — The Simple Card

This is a planning/check card. Complete the physical evidence in the detailed
guides before wiring an unresolved connector. No source audit proves a finished
machine safe to energize.

Full detail lives in `WIRING.md`, `CL57T_QUICK_WIRING.md` and `INTERFACE_BOARD.md`.
This card is the short version.

**Build deenergized. Step 10 is a hold-point review, not automatic permission
to power or move the machine.** Separate supply/bench tests require their own
qualified setup; disconnect and prove dead again before landing wires.

---

## 0. Before you touch anything

- [ ] Isolate mains, spindle, 36 V, 24 V, field supplies and USB; prevent reconnection.
- [ ] Support gravity-loaded Z before disconnecting motor/coupler; secure movable assemblies.
- [ ] Meter across the 36 V terminals: **0 V**
- [ ] Prove dead after discharge on all affected rails with an appropriate instrument. Never use an ohmmeter on an energized circuit.

---

## 1. Ground first

| Connect | To |
| --- | --- |
| Cabinet / backplate | PE, its **own** conductor |
| Each exposed drive chassis | verified suitable protective bond to PE |

The isolation mounts may have broken continuity to the leg, so run PE to the
cabinet directly. Do not assume a mounting screw through paint provides a
protective bond. Use the reviewed bonding hardware and verify the connection;
a simple continuity beep is not a complete protective-bond qualification.

- [ ] **Check:** backplate → PE = **short**
- [ ] **Check:** each drive chassis → PE = **short**

---

## 2. Mount the Octopus

- [ ] PETG / nylon standoffs
- [ ] No metal screw running through into the tapped plate hole

- [ ] **Assembly check, board isolated from power and USB:** Octopus `GND` → PE = **open**. After the intentional control-0V bond and USB are connected, continuity can be expected; record those paths, not an impossible final open-circuit requirement.

If continuity appears in that isolated assembly state, find and record the
path before proceeding; mounting hardware is one possibility, not the only one.

### Strip every jumper off the driver slots

Do this before the board goes on the plate, while you can still see it.

- [ ] Three-pin `HV`–`VM`–`VIN` **above** each socket — jumper off, all 8 slots
- [ ] Three-by-four pin field **under** each socket — every jumper off
- [ ] `DIAG` two-pin position for each slot — all 8 off

All jumper removals matter. In particular, `M0DIAG`–`M7DIAG` sit on `PG6`, `PG9`,
`PG10`, `PG11`, `PG12`, `PG13`, `PG14`, `PG15` — the same wires as your home
switches and drive alarms. A jumper left on hangs a floating socket pin off
your home input and you will chase it for a week.

- [ ] Bag the jumpers and label the bag. They go back if the board is ever resold.

---

## 3. Set all four drives — power OFF

Identical on every drive. Settings are read at power-up, so they must be right
before anything is energized.

| Control | Set to |
| --- | --- |
| `S1` rotating | **4** |
| `SW1` | **on** |
| `SW2` | **off** |
| `SW3` | **on** |
| `SW4` | **on** |
| `SW5` | **off** |
| `SW6` | **off** |
| `SW7` | **off** |
| `SW8` | **off** |
| `S3` selector | **5V** |

Factory S1=0 and S3=24V differ from this candidate configuration. Record S1=4
for the initial current/gain plan and S3=5V for the planned PUL/DIR interface.
Actual motor temperature, pulse scale and direction still need measurement.

- [ ] **Check:** photograph all four switch faces

---

## 4. Drive power — `P4`

| `P4` pin | Wire |
| --- | --- |
| `+VDC` | 36 V **positive** |
| `GND` | 36 V **negative** |

**This is polarized.** There is no no-polarity pair on this drive. Backwards
kills all four.

One fused branch per drive, straight from the supply. **No daisy chains.**

- [ ] **Deenergized check:** trace +VDC to that branch positive and GND to its return; verify actual terminal labels, no assumed viewing order.
- [ ] **Later separate supply test:** voltage and polarity recorded before connection; under 40 V unloaded is the project target. Capture ripple with a suitable instrument; a handheld AC reading does not qualify it.

---

## 5. Motor and encoder

| Drive | Cable |
| --- | --- |
| `P3` | motor lead, `A+ A- B+ B-` |
| `P2` | encoder lead, 6 wires + drain |

**Never power a drive with either one missing.** Alarm code 4 is "fail to lock
motor shaft."

`P2 VCC` is an output from the drive. Never feed it from any field supply.

Use the matched, verified kit encoder cable. Do not assign encoder pins from
wire color or thickness. Record end-to-end continuity and connector orientation;
the shield is not an encoder return and receives only its documented termination.

- [ ] **Check:** no phase shorted to motor frame

---

## 6. Control signals — Octopus to `P1`

Through the qualified driver-socket adapters and 5 V open-drain interface.
These are **schematic contact identities**, not physical row counts or a mating
view. Establish actual orientation and continuity before fitting an adapter:

| Socket pin | Signal |
| --- | --- |
| 1 | `EN` - reserved, leave unconnected |
| 7 | `STEP` |
| 8 | `DIR` |
| 9 | `GND` |

| Octopus | Drive |
| --- | --- |
| MOTOR0 | X |
| MOTOR1 | Y-left |
| MOTOR2 | Z |
| MOTOR3 | Y-right |

`ENA` is optional and unconnected by default. Leave it.

- [ ] **Check:** P1 PUL/DIR use only the qualified 5 V command domain; `S3` is `5V`. P1 ALM/COMO is a separate, current-limited field circuit through isolation, never a direct GPIO connection.

---

## 7. Home switches

**Count the conductors at the plug before anything else.**

| Count | Meaning |
| --- | --- |
| 6 | **expected case** (`WIRING.md`, "Home and Limit Inputs"): shared 5 V supply + shared return + four independent signals. This is a powered circuit, not bare dry contacts - HOLD for the isolated conditioner until every conductor is traced |
| 5 | candidate four signals plus common; trace every conductor to prove it |
| 4 | cannot provide four independent dry-contact signals plus common; trace sharing before planning squaring |

Then prove each switch is a bare contact:

- [ ] Ohmmeter across each switch, then swap the leads — **same reading both ways**
- [ ] Common conductor → one leg of **all four** switches = short
- [ ] Y-left and Y-right read **independently**

Also prove NC behavior (closed healthy, open actuated), no electronics in the
contact path, and complete disconnection from every stock powered circuit.
Conductor count and an ohmmeter test alone do not establish those facts.

**Only fully verified bare NC contacts may connect directly.** Their common
goes to Octopus `GND`; X / Y-left / Z / Y-right signals go to `STOP_0` / `1` /
`2` / `3` SIG. Use the board pull-ups. Otherwise retain the isolated conditioner
and first identify the installed module circuit and required field supply.

**Otherwise: HOLD for a qualified conditioner.** The on-hand TLP281-labelled
module is not approved from its IC name. Trace both faces, input/output networks,
shared rails and isolation, then qualify healthy/trigger/open/power-loss states
and channel independence against a representative 3.3 V load.

Do not leave a shared output VCC floating as a generic recipe: pullups can couple
channels through it. Do not connect it to 5 V. The approved circuit must specify
its actual supplies and terminal map. See `INTERFACE_BOARD.md` A2.

| Qualified conditioner channel | Intended Octopus destination |
| --- | --- |
| X | STOP0 PG6 + controller GND |
| Y-left | STOP1 PG9 + controller GND |
| Z | STOP2 PG10 + controller GND |
| Y-right | STOP3 PG11 + controller GND |

**Every `STOP` header's 5 V cavity stays empty.**

- [ ] **Check:** Y-left and Y-right read independently. Squaring depends on it.

---

## 8. Drive alarms - Qualified Aggregate into PB1

Each `ALM`/`COMO` pair first enters its own opto-isolated, current-limited conditioner. Combine the four **conditioned healthy outputs** into the PB1 aggregate: all healthy pulls PB1 low; any alarm, lost drive power, or open cable releases it high.

**Do not series-chain raw ALM/COMO transistor outputs into PB1.** They are not verified dry contacts. Their polarity and power-loss behavior must be characterized. A healthy-open output needs additional supervision or a separate ready/power contact; inversion alone cannot distinguish it from a broken wire. See `INTERFACE_BOARD.md`, External-Drive Alarm Inputs.

| From | To |
| --- | --- |
| conditioned, 3.3 V-compatible aggregate output plus logic return | `EXP2` **PB1/GND** |

`PG12`–`PG15` are **not read by the current firmware** - no stop, no display.
PB1 is the only drive-fault stop. Qualify it before any coupled dual-Y motion.

- [ ] **Later protected bench check:** remove each field alarm connection in turn and verify PB1 faults; also test drive power loss and a safely induced documented alarm. Never hot-unplug motor or encoder.

---

## 9. Octopus power

| Octopus terminal block | Wire |
| --- | --- |
| Verified `POWER` / `MAIN POWER` terminal `+VIN` | **24 V** |
| Matching verified `POWER` terminal `GND` | 24 V return |

Identify the pair from actual board markings and continuity. Do not count
screws from an assumed top or infer polarity from a rotated picture.

**24 V only. 28 V absolute maximum. 36 V destroys the board.**

`MOTOR-POWER`, `BED-POWER` and `BED-OUT` remain empty.

- [ ] **Later separate supply check:** verify the 24 V pair while disconnected from the board, then isolate and discharge again before landing it.

---

## 10. Before first power-up

Run every one of these:

- [ ] Backplate → PE: short
- [ ] Drive chassis → PE: short
- [ ] With board isolated from power and USB, Octopus `GND` → PE: open. Final connected bonding matches the recorded control-0V/PE and USB topology.
- [ ] 36 V supply: polarity and DC voltage verified; record ripple. Under 40 V unloaded is the existing project target; verify transient voltage stays below 50 V. Four-axis load capacity is still unqualified.
- [ ] `P4` polarity correct on all four drives
- [ ] Actual MAIN/POWER +VIN/GND identified; separate supply verification records 24 V
- [ ] Motor and encoder connected on every drive
- [ ] All four drives: `S1`=4, `S3`=`5V`, `SW6`/`SW7` **off**
- [ ] Every `STOP` 5 V cavity empty
- [ ] Onboard `SW2` ("BOOT1") guarded or removed - it shares PB2, so pressing it is a cycle start
- [ ] PB1, PB2 and PB7 have their interface-board 3.3 V pull-up and RC filter; every field input has its series resistor and TVS
- [ ] Exact conditioner circuitry qualified; no generic floating-VCC recipe
- [ ] PUL/DIR waveforms/current and PB1 alarm supervision proved on the protected bench
- [ ] Hardware stop, protective bonding and branch protection documented. **Blocking HOLD:** the reviewed stop design removes spindle-servo energy (mains contactor and/or certified STO, not just `SON`), removes 36 V motion power with a Z-drop analysis, puts coolant in the stop chain and has a terminal schedule (`WIRING.md`, "Scope and Safety Boundary")
- [ ] Z mechanically supported; test motor uncoupled, rigidly secured and shaft guarded

If any item lacks evidence, stop at deenergized preparation. Once those gates
pass, use the conditional single secured-motor bench procedure in
`CL57T_QUICK_WIRING.md`; this card does not release the coupled machine.

Expect: **green LED steady, red LED off.**

Blinking red = alarm. Count the blinks in the 3-second window and read §8 of the
manual in `_vendor_docs/`.

---

## The five that break things

1. `P4` backwards — kills the drive instantly
2. `S3` on `24V` with 5 V signals — won't run; `S3` on `5V` with 24 V signals — **destroys the input**
3. 36 V into `MAIN POWER` — kills the Octopus
4. Powering a drive with no motor or encoder — alarm 4
5. Hot-plugging `P3` or `P4` — kills the drive

## Not yet

Spindle, coolant, probe and tool setter come later. So does any motion. Getting
power and signals verified is this stage. Even an uncommanded powered motor
can develop torque or move; secure it before any permitted bench energization.
