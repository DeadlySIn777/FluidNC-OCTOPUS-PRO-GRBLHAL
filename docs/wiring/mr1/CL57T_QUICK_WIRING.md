# CL57T V4.1 Quick Wiring and Switch Settings

Peer document to `DM860T_QUICK_WIRING.md`, for the four STEPPERONLINE
`1-CL57T-S30A-V41` closed-loop kits (`CL57T V4.1` driver +
`23HS45-4204D-E1000` motor, 4.2 A/phase, 3.0 Nm).

Drive electrical limits and switch tables come from the vendor manual archived at
`_vendor_docs/CL57T-V41_user_manual.pdf`
(SHA-256 `3eec9304c770ff68a5ccbd68f105789edfb35f5c91a9977531a30756a918d7da`,
14 pages, Revision 4.1, May 2023), with a plain-text extraction beside it.
Section numbers below refer to that manual. Motor ratings come from the motor datasheet; the selected settings and margins are project design choices, not claims of physical qualification.

**The DM860T document does not apply to these drives.** The switch letters,
the power terminals, and the polarity rule are all different. See
"What changes from the DM860T" at the end.

---

## Stop gates — do not skip

1. **Revision gate.** This document is for **V4.1** only. V4.1 is the revision
   whose revision history adds the `P5` tuning port; `S1` and the 5/24 V selector already appeared in V4.0 (manual, Record of Revisions). If the drive in your hand has no
   rotating switch or no top-side selector, stop — it is not V4.1 and this
   table is wrong for it.
2. **Set every switch before applying power.** All switch settings are read at
   power-up.
3. **Never plug or unplug `P3` (motor) or `P4` (power) while powered.**
   Manual §3.4 warning, verbatim: *"Don't plug/unplug P3 or P4 connector to
   avoid drive damage or injury while powered on."*
4. **Never energize a drive with no motor/encoder connected.** Alarm code 4 is
   "Fail to lock motor shaft — the drive is not connected to a motor" (§8).
5. **Meter the supply before landing it.** See "Power" below. The 50 V ceiling
   is hard.

---

## The one setting that destroys drives: `S3`

`S3` is a 1-bit selector on the **top** of the drive that sets the control
signal voltage. **Factory setting is 24 V.**

Manual §6, note 1, verbatim:

> *"Pulse and direction inputs level 5V or 24V selected by selector switch S3.
> When it is 24 V, the S3 selection of 5V will damage the input photo-coupling."*

The two error directions are **not** symmetric:

| S3 setting | Signal actually applied | Result |
| --- | --- | --- |
| `5V` | 5 V | **Correct.** This is the MR-1 configuration. |
| `24V` | 5 V | Harmless but dead — *"the motor won't work"* (§5.3) |
| `5V` | 24 V | **Destroys the input optocoupler** |

**The MR-1 drives a 5 V common-anode interface**
(`Inc/mr1_octopus_config.h:56`, `DM860T_QUICK_WIRING.md:55`), so:

> ### Set `S3` to **5V** on all four drives.

No external resistor is required at 5 V. (At 24 V no resistors are needed
either; only the 12 V case needs a 1 kΩ series resistor — §6.1 note 2.)

Because the damaging direction requires 24 V to reach a drive set to 5 V,
**prove no 24 V can reach the 5 V-selected PUL/DIR inputs before first power-up.** The
protected 5 V command supply and the qualified interface must prevent cross-domain faults. The common-anode interface references controller logic return; it is not an independently isolated encoder supply. P1 also contains ENA and ALM/COMO with separate specifications; S3 selects PUL/DIR levels only. ENA remains unconnected.

---

## `S1` rotating switch — peak current and gain

`S1` is a 16-position rotating switch (hex `0`–`F`) that sets **peak current**
and the servo gains together (§5.1).

| Peak current | RMS current | S1 codes |
| --- | --- | --- |
| 2.8 A | 2 A | `0` (factory), `1`, `2`, `3` |
| **5.6 A** | **4 A** | `4`, `5`, `6`, `7`, `8`, `9` |
| 7.0 A | 5 A | `A`–`F` |

> ### Set `S1` to **`4`** on all four drives.

`4` = 5.6 A peak / **4 A RMS**, with velocity-loop Ki 0, position-loop Kp 25,
velocity-loop Kp 25 — the manual's "weak rigidity" pairing, closest to factory
behaviour.

**Why `4` and not higher:** the motor is rated **4.2 A/phase**. 4 A RMS sits
just under it. Code `A`+ would command 5 A RMS into a 4.2 A motor.

**Factory default `0` is 2 A RMS; this project's initial candidate is `4`
(4 A RMS).** Lower current changes available torque; neither the manual nor a
source audit proves that this machine will be weak, fault, or remain safe at
either setting. Thermal, direction, scale and load tests remain required.

**Gain tuning comes later, not now.** Codes `4`/`5`/`6` share 4 A RMS and
differ only in rigidity (Kp 25/25 → 50/15 → 100/5). If an axis oscillates or
drifts after stopping, that is when to explore `5` or `6`. The manual's own
advice is *"Usually keep factory settings."* Start at `4` everywhere; change
one axis at a time and write down what you changed.

---

## `S2` DIP switch — 8 positions

### SW1–SW4: microstep (§5.2.1)

The MR-1 kinematics require **1600 pulses/rev** (5 mm X/Y lead → 320 steps/mm;
3 mm Z lead → 533.333333 steps/mm, matching
`Inc/mr1_octopus_config.h:72-74`).

| Pulses/rev | SW1 | SW2 | SW3 | SW4 |
| --- | --- | --- | --- | --- |
| **1600** | **on** | **off** | **on** | **on** |

> ### SW1 `on`, SW2 `off`, SW3 `on`, SW4 `on` — all four drives.

A wrong setting changes real travel and speed and can cause a collision. For
example, 800 pulses/rev with firmware assuming 1600 commands twice the intended
travel. Verify a small, guarded measured move before any full-travel command
or homing; the screw leads and scale must be checked on the actual machine.

### SW5–SW8: mode (§5.2.2)

| Switch | Function | ON | OFF | **MR-1 setting** |
| --- | --- | --- | --- | --- |
| SW5 | Rotation direction | CW | CCW | **per axis — see below** |
| SW6 | Control mode | Open loop | **Closed loop** | **OFF** |
| SW7 | Pulse mode | CW/CCW (double) | **PUL/DIR (single)** | **OFF** |
| SW8 | Pulse filter | Yes (10 ms) | **No (1.5 ms)** | **OFF** |

**SW6 must be OFF.** ON is open-loop — it throws away the entire reason you
bought these drives, and does so silently.

**SW7 must be OFF.** grblHAL emits step/direction, not CW/CCW pulse pairs. ON
will produce motion that is wrong in a way that looks like a wiring fault.

**SW8 — set OFF, and identically on all four.** The 10 ms filter adds S-curve
smoothing to the input pulse train. The manual states: *"The Filter Time value
must be set to the same for each CL57T(V4.1) in multi-axis applications."*
On a coordinated-motion mill a 10 ms lag distorts corners, and OFF (1.5 ms) is
the right default.

> **This matters doubly for the ganged Y pair.** Y-left (MOTOR1) and Y-right
> (MOTOR3) drive one gantry through two ballscrews. If their SW8 settings
> differ, the two sides respond to the same step train with different lag and
> will fight each other — racking the gantry and risking a dual-axis homing
> fault or mechanical damage. **SW6 through SW8 must match on the two Y
> drives. SW5 and firmware direction masks must produce the correct physical
> motion on each side; establish that with uncoupled direction tests.**

**SW5 is the only per-axis switch.** Do not guess it. Set all four to OFF
initially, then correct individual axes during the Stage 5 direction check,
where a wrong direction is caught at low feed against a known-good reference.
Changing SW5 is the mechanical alternative to
`DEFAULT_DIR_SIGNALS_INVERT_MASK`; prefer fixing direction in the firmware
mask so the drives stay identically configured — but record whichever you use.

---

## Power — `P4`

| Pin | Connect to |
| --- | --- |
| `+VDC` | Power supply **positive** |
| `GND` | Power supply **ground / negative** |

> ### `P4` is POLARIZED DC. This is the single biggest change from the DM860T.

The DM860T rollback set uses interchangeable `AC` terminals. The current
`PIGTAIL_SCHEDULE.md` and active `cable-schedule.csv` rows use polarized CL57T
P4; AC/AC rows are explicitly ROLLBACK-ONLY. Never apply the rollback power
rule to CL57T. Inspect, re-terminate where necessary, and re-label any reused
pigtail before connecting it; reverse polarity can damage the drive.

### Voltage

| Parameter | Value |
| --- | --- |
| Absolute range | **18 – 50 VDC** |
| Recommended | **24 – 48 VDC** |
| Typical points named | 24, 36, 48 VDC |

The MR-1's existing motion bus is 36 VDC (`WIRING.md:82`), which is mid-window
and leaves 14 V of headroom to the ceiling. §4.2 requires that headroom
explicitly, for *"power line voltage fluctuation and back-EMF voltage charge
back"* during deceleration.

**Before landing the supply on any CL57T, with all four drive branches
disconnected, verify polarity and measure its DC output.** The September 20
record identifies an S-360-36, 36 V / 10 A switch-mode supply. That historical
record is not a fresh electrical test. Record ripple with an appropriate
instrument and measure deceleration transients during commissioning; a handheld
AC reading alone does not qualify the bus. Simultaneous four-drive capacity
remains unresolved; see `CL57T_ARRIVAL_CAPTURE.md` section 5.

> **Manual erratum.** §8's over-voltage troubleshooting says *"Check if the
> power voltage is higher than 90VDC."* That is a copy-paste error from a
> higher-voltage drive — this drive's maximum is 50 VDC. Do not use 90 V as
> any kind of bound.

### Supply sharing

§4.1, and it matches the MR-1's existing star-wiring rule:

> *"To avoid cross interference, DO NOT daisy-chain connect the power supply
> input pins of the Drivers. Instead connect them to power supply separately."*

Four separate fused branches from the distribution point. No daisy chains.

---

## Control signals — `P1`

| Pin | Direction | Notes |
| --- | --- | --- |
| `PUL+` / `PUL-` | In | Step. Min width **1.0 µs**, 50% duty recommended, max 500 kHz |
| `DIR+` / `DIR-` | In | Must lead the PUL effective edge by **≥ 2 µs** |
| `ENA+` / `ENA-` | In | Optional; **default not connected**. Must lead DIR by **≥ 200 ms** |
| `ALM` | Out | Alarm. Sinking or sourcing, 100 mA at 5–24 V, **max 30 V** |
| `BRK` | Out | Brake. Max 24 V / 100 mA. Requires relay + flyback diode. **Unused on MR-1** |
| `COMO` | Out | Common return for the single-ended outputs (common-cathode) |

Logic input current: **7 mA min, 10 mA typical, 16 mA max.** This matches the
7–16 mA design window already recorded in the project. It does not qualify
the existing circuit or supply: measure current/levels and loading on all
eight PUL/DIR channels; ENA is unconnected.

### Timing source comparison - Loaded Waveforms Still Required

| Manual requirement (section 7) | Minimum | Configured source value | Evidence limit |
| --- | --- | --- | --- |
| Pulse width | 1.0 us | `DEFAULT_STEP_PULSE_MICROSECONDS 5.0` | Source value only; scope at loaded PUL input |
| DIR before PUL | 2.0 us | `DEFAULT_STEP_PULSE_DELAY 6.0` | Scope effective DIR/PUL edges after interface propagation |
| ENA before DIR | 200 ms | `DEFAULT_STEPPER_ENABLE_DELAY 250` | Not applicable with ENA unconnected; future circuit requires separate proof |
| Low-level pulse width | 1.0 us | About 69 us at the configured peak rate | Ideal rate calculation, not measured pulse spacing |

The configured values provide a plausible timing starting point; this comparison
does not qualify the interface, startup behavior or actual drive waveforms.
Do not close the hardware timing gate until pulse current, levels, effective
edges, minimum high/low duration and DIR setup are measured into the actual
drive through the finished harness. No firmware timing change is established
as necessary by this source comparison, and no image was rebuilt or flashed.

---

## Alarm output — `ALM` / `COMO`

§6.2: on over-voltage, over-current, or following error, the red LED blinks and
*"the impedance state between ALM and COM- will change (from low to high or
high to low depending on configuration)"*. Output is optional and may be wired
sinking or sourcing.

**The direction is configuration-dependent and the manual does not state a
default.** Characterize it with a current-limited test load and voltage/current
measurements in healthy, alarm, lost-power and open-cable states. Do not use an
ohmmeter on an energized output. Each pair enters an isolated conditioner; its
controller-side output is low only when healthy and the cable is intact. A
healthy-open alarm needs added supervision or a separate ready/power contact.
Never hot-unplug motor or encoder connectors to force an alarm.

### Where the alarm must land

`Inc/mr1_octopus_config.h:49` enables `MOTOR_FAULT_ENABLE`, and the board map
assigns per-axis fault inputs to PG12–PG15. **Those per-axis pins do not stop
motion.** The only input that raises `Alarm_MotorFault` in grblHAL is the
**PB1 aggregate** (`boards/btt_octopus_pro_mr1_map.h:223-225`,
`WIRING.md:260-263`).

> Combine the four **conditioned healthy outputs** into the **PB1 aggregate**:
> all healthy = low; any fault, open cable or lost power = high. Never chain
> raw ALM/COMO terminals into a GPIO. Provide separate conditioned indications
> on PG12–PG15 for `$pins` diagnostics; these do not stop motion.

The rollback DM860T also provides fault outputs, although it has no motor
encoder following-error feedback. CL57T feedback is at the motor shaft; it
does not detect a loose coupler or prove table position.

---

## Motor and encoder — `P3` and `P2`

| `P3` (motor) | | `P2` (encoder) | |
| --- | --- | --- | --- |
| `A+` | Motor A+ | `EA+` / `EA-` | Encoder A |
| `A-` | Motor A- | `EB+` / `EB-` | Encoder B |
| `B+` | Motor B+ | `VCC` | Encoder +5 V **output** from drive |
| `B-` | Motor B- | `EGND` | Encoder ground |

`VCC` is supplied **by the drive**. Do not feed it from the interface board's
isolated 5 V rail or from the 24 V field supply — that bonds two power domains
the project deliberately keeps separate (`WIRING.md:97-98`).

The current WIRING and PIGTAIL documents include the encoder domain and its
hot-plug prohibition. Do not add a bond from EGND to PE, another drive, or
controller logic without an approved schematic. The manual identifies a
drive-supplied encoder output; it does not establish galvanic isolation of
that output from the drive power return.

Route encoder extensions away from motor and bus cable. §3.1 notes: shield the
control signal wires, and *"don't tie control signal cables and power wires
together."*

---

## Mounting and heat (§2.4)

- Reliable working temperature **≤ 40 °C**.
- **Mount vertically** to maximize convection.
- **Minimum 30 mm between adjacent drives.** Four drives therefore need at
  least 3 × 30 mm of clear spacing plus the drive widths — check this against
  the enclosure backplate before mounting anything.
- Drive mass ≈ 280 g each.
- Ambient 0–40 °C, 40–90% RH, avoid dust, oil fog and corrosive gases. A mill
  enclosure with coolant mist is exactly the environment §2.2 warns about.

---

## First Power-Up - Conditional Bench Procedure, Not Release to Run

Power-up remains on HOLD until the mechanical restraint, hardwired stop,
protective bonding, branch protection and tested interface are documented.
No spindle or coupled-axis commissioning is authorized by this source guide.

1. With power isolated, match all four drive/motor revision labels and record
   the initial settings: S1=4; SW1/3/4 on; SW2/5/6/7/8 off; S3=5V.
2. Support the gravity-loaded Z assembly before uncoupling it. Secure the one
   test motor to a rigid fixture, guard the shaft and remove loose shaft keys
   or couplers. Keep personnel clear: power-up can create holding torque or
   shaft movement even without a commanded jog.
3. With all energy sources off and discharged, connect that motor P3 and its
   matching encoder P2. Check P4 polarity and its protected star branch. Keep
   the other drives and spindle isolated. Do not hot-plug any connector.
4. Qualify the supply separately with drive branches disconnected: correct
   polarity and DC voltage, ripple captured, project target below 40 V unloaded.
   Later loaded and deceleration tests must remain below the 50 V hard limit;
   four-drive capacity is not yet proved. Deenergize before landing P4.
5. Use only the qualified PUL/DIR interface, with its input commands held in the
   documented inactive state. ENA remains unconnected. The ALM/COMO test circuit
   must be separately current-limited and characterized; no raw GPIO connection.
6. Only after the preceding gates pass, energize the one secured test drive with
   a reachable verified hardware stop. Green steady/red off is the expected
   healthy indication, not proof that motion or machine wiring is safe.
7. If red blinks, record the count and consult manual section 8. Isolate power
   and prove discharge before inspecting motor/encoder connections. Do not
   unplug a live cable to create or clear an alarm.

---

## What changes from the DM860T

| | DM860T V3.0 | CL57T V4.1 |
| --- | --- | --- |
| 5 V / 24 V selector | `S2` | **`S3`** |
| Current setting | DIP switch pattern | **`S1` rotating switch, 3 current levels** |
| Bus terminals | Two `AC`, **no polarity** | **`+VDC` / `GND`, polarized** |
| Bus range | 24–110 VDC | **18–50 VDC** (24–48 recommended) |
| Min pulse width | per DM860T table | **1.0 µs** |
| Min DIR setup | per DM860T table | **2.0 µs** |
| Encoder | none | **`P2`, 6 conductors, drive-supplied 5 V** |
| Alarm | present | **`ALM` / `COMO`, direction configurable** |
| Loop | open | **closed — SW6 must be OFF** |

The switch-letter collision is the dangerous one: **`S2` means the voltage
selector on a DM860T and the 8-bit DIP bank on a CL57T.** Anyone working from
memory or from `DM860T_QUICK_WIRING.md` will reach for the wrong switch.
