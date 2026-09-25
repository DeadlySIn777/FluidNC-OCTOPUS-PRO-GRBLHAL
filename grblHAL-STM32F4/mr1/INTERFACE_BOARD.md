# MR-1 Octopus Interface Board Specification

## Purpose

The permanent interface board removes the Octopus pigtail problem while keeping
the active CL57T V4.1 closed-loop drives, stock probe/tool
setter, stock spindle servo, and field wiring electrically appropriate for a
CNC cabinet.

It is not a motor driver and it is not a safety controller. It performs:

- Four socket-to-external-drive PUL/DIR interfaces; ENA is reserved and unconnected.
- Four isolated stock-home input conditioners.
- Four isolated, polarity-configurable external-drive alarm inputs.
- Two isolated active-low sensor inputs for probe and tool setter.
- Conditioned operator/safety monitor inputs where bare dry contacts are not used.
- Spindle PWM-to-0-5 V isolation and spindle-enable relay interfacing.
- Flood and mist/air relay interfacing.
- Fusing, surge suppression, cable shields, labels, and accessible test points.

## Build Phases

### P0 Bench Prototype

Use four mechanically supported 18-position socket adapters, a DIN interface
carrier, and pluggable terminals. A `2x8` candidate remains on HOLD until its
contact map, fit, orientation, keying and retention are proved on the actual
18-contact socket. Schematic contact numbers are not physical row counts.
Populate one X-axis motion channel,
one fault channel, one probe channel, and the spindle analog channel first. Test
the circuits under their real electrical loads before duplicating them.

P0 may use short internal harnesses, but no loose Dupont leads may leave the
enclosure or carry cable weight.

### P1 Permanent Board

One PCB or PCB-plus-DIN assembly mates with MOTOR0 through MOTOR3 and the named
I/O headers. It has keyed pluggable field connectors and is held by its own
standoffs/bracket. The Octopus socket pins provide signals only and carry no
mechanical load.

Do not release P1 Gerbers until these physical facts are measured from the
actual v1.1 board:

- Center spacing and height of MOTOR0 through MOTOR3.
- Driver-socket row spacing, pin size, and insertion depth.
- Component and jumper keep-out volume under and beside the adapter.
- Standoff locations and enclosure clearances.
- Header key direction for every I/O connection.

The firmware pin map is complete; missing geometry is the reason there is no
pretend-ready PCB layout in this package.

## Functional Blocks

### A. Motion Outputs

The active CL57T installation uses eight command channels: `X/YL/Z/YR` times
`PUL/DIR`. Four ENA channels may be reserved, but remain unconnected until
separately qualified. ENA is not the hardwired motion safety function.

The official v1.1 schematic places a 5 V `MC74HCT125A` buffer between each MCU
signal and its driver-socket EN/STEP/DIR contact. Required channel behavior:

| 5 V-buffered socket level | 2N7002 state | Drive minus terminal | Drive optocoupler |
| --- | --- | --- | --- |
| Low | Off | Pulled toward +5 V internally/through input | Off |
| High | On | Near 0 V | On |
| Octopus unpowered | Intended off by gate pulldown; verify rail decay/backfeed | Intended inactive; measure | Not yet qualified |

Candidate circuit; the table is required behavior, not measured performance:

```text
SOCKET_SIGNAL -- 100R -- Q gate
Q gate ------- 100k --- Q source
Q source -------------- CTRL_0V
Q drain --------------- FIELD_MINUS
+5_MOTION ------------- FIELD_PLUS
```

Use a MOSFET whose guaranteed on-resistance and transfer behavior are suitable
at a 4.5-5 V gate, not merely a threshold-voltage headline. Validate less than
0.5 V at the drive minus input while sinking its worst-case 16 mA.

`ENA` is optional and remains unconnected in the active installation. Any future
ENA stage requires separate truth-table, startup/shutdown and timing tests.
The simple stage is not a safety function: loss of controller power does not
prove the drive disabled. A hardware safety circuit must remove motion/spindle
permission as designed, with the Z load mechanically secured where power loss
can allow descent. A proposed `FORCE_DISABLE` circuit is not implemented or
qualified by this drawing.

Proposed custom interface connector numbering below is a design choice, **not
the CL57T P1 terminal order**. Leave its reserved ENA cavities empty.

Required axis connector pin order:

```text
1 PUL+   2 PUL-   3 DIR+   4 DIR-   5 ENA+   6 ENA-
```

Use the same order on all axes and key the plugs. Provide test points for the
socket side and field side of the eight active PUL/DIR channels. Four ENA
channels are reserved only.

Octopus schematic contact identities used by the adapter (BTT schematic sheet
1). These numbers do not specify a viewing direction or housing orientation;
prove each fitted contact by trace/continuity on the actual board:

| Contact | Signal | Disposition |
| --- | --- | --- |
| 1 | EN | Reserved; do not populate an active ENA circuit |
| 7 | STEP | Route to gate resistor |
| 8 | DIR | Route to gate resistor |
| 9 | GND | Controller logic return |
| 2-6, 10-18 | Mode/reset/sleep/VCC_IO/phases/GND/VM/NC/DIAG | No connection |

### A2. Home-Channel Conditioner - Unqualified On-Hand Module

The on-hand module described as TLP281-4 is a **candidate, on HOLD**. An IC
marking does not identify its input network, output topology, common rails,
terminal pinout, isolation spacing, protection or operating margins. No input
resistor, LED current, CTR margin or module isolation rating has been proved.
A component CTR specification at one LED current/temperature cannot qualify a
different assumed current or an assembled module.

**Do not adopt the former "leave output VCC open" recipe.** If channel pullups
share that rail, a floating VCC can couple outputs through those resistors.
Nor is connecting VCC to 3.3 V automatically approved: LEDs, transistors or
other circuitry may change behavior. Never supply a GPIO-facing pullup from
5 V. Keep the module and stock harness disconnected from the Octopus until:

1. Both PCB faces, IC marking, resistor values and terminal markings are recorded;
   trace a complete circuit, including shared rails and every isolation crossing.
2. The stock switch supply, return and independent signals are identified. Do
   not assume a module has a field VCC terminal or that its input is active-high.
3. Select the field current and output circuit from the actual parts' guaranteed
   limits and the BTT input circuit (STOP: 10 kohm pullup to 3.3 V, series/filter
   components). Include temperature, input thresholds and propagation delay.
4. With a current-limited bench supply and a representative controller-side
   test load, record all four channels' healthy, triggered, unplugged and
   field-power-loss voltages. Healthy must pull low; every required fault must
   release high. Test all 16 active/inactive combinations to reveal cross-channel
   coupling, plus each field/supply cable removal. Repeat with either side unpowered.
5. Approve the exact terminal-to-terminal wiring only after these checks. Output
   return belongs to controller logic; the isolated field return stays separate.

The intended destinations remain X/PG6, YL/PG9, Z/PG10 and YR/PG11. Use only
SIG/GND at STOP0-3; leave adjacent 5 V contacts empty. Independent Y inputs are
required for squaring. Firmware inversion cannot distinguish a healthy-open
field circuit from a broken wire presenting that same state; add supervision
or redesign the conditioner when necessary. This home module is not allocated
to the four drive-alarm channels or their PB1 aggregate.

### B. External-Drive Alarm Inputs

The active CL57T V4.1 provides `ALM` and `COMO` (manual S3.1/S6.2), rated
sinking or sourcing 100 mA at 5-24 V, 30 V maximum, with the alarm impedance
direction dependent on configuration and not stated as a default. The retained
DM860T V3 rollback drives provide `ALM+` and `ALM-`. The board accepts the
characterized sinking or sourcing arrangement only through an optocoupler and
current-limiting network.

**Topology requirement.** Combine the four isolated, conditioned healthy
outputs into the PB1 aggregate input. Do not series-chain raw ALM/COMO outputs
into a GPIO. PB1 is the only input that raises
`Alarm_MotorFault` in the compiled firmware - see the verification box in
`WIRING.md` under "Drive Fault Inputs". Per-axis outputs to PG12-PG15 are
wiring for a future firmware candidate: the current firmware does not read
them (`$pins` lists only their assignment), so they carry no protective duty
and give no per-axis indication. Budget the channel count accordingly: four
field channels in, one series result to PB1, and four optional per-axis outputs
to PG12-PG15. Qualify PB1 before any coupled dual-Y motion.

Each channel requires:

- Selectable sinking/sourcing field wiring.
- Selectable logical inversion after the optocoupler.
- Field current test pad or LED that does not alter the supervised current.
- Controller output that is low only for `READY + CABLE INTACT`.
- Open field connector, lost drive power, or alarm producing controller high.
- 3.3 V-compatible open collector at the Octopus stop input.

If the active drive cannot provide an energized-healthy output, a two-wire ALM
circuit cannot distinguish a healthy open output from a broken cable. In that
case P1 must add supervised end-of-line current or a separate drive-power/ready
relay. Do not label an unsupervised alarm wire `fail-safe`.

Field connector:

```text
1 ALM+ / ALM   2 ALM- / COMO   3 DRIVE_LOGIC_V (optional, protected)   4 shield
```

Optional per-axis destinations are PG12, PG13, PG14, and PG15 (not read by the
current firmware). The separately qualified protective aggregate goes to PB1;
none of these four connections substitutes for it.

### C. Stock Home Inputs

The stock MR-1 limit input must be treated as a powered 5 V field circuit until
the installed harness proves otherwise. P1 provides four isolated channels and
a separately current-limited `ISO_5V_HOME` field domain. No stock supply or
signal reaches an Octopus STOP header directly.

Each channel is energized while the stock switch, cable, and field supply are
healthy. Its controller-side open collector pulls the named STOP signal low.
A switch trigger, broken cable, unplugged connector, or lost field power must
release that output so the Octopus pullup reads high.

| Stock channel | Controller destination |
| --- | --- |
| X home | PG6 / STOP0 |
| Y-left home | PG9 / STOP1 |
| Z home | PG10 / STOP2 |
| Y-right home | PG11 / STOP3 |

Required provisions per channel:

- Field supply, signal, and return test points.
- Configurable input polarity until the stock truth table is recorded.
- Open-collector controller output; only SIG and GND populate the STOP housing.
- Field-power-loss and connector-removal test points.
- No use of the STOP header's adjacent 5 V contact.

A direct dry-contact bypass footprint may be provided, but it remains open by
default and may be populated only after the disconnected switch proves
open-circuit to every supply, frame, shield, and other conductor.

### D. Probe and Tool-Setter Inputs

The isolated sensor supply has no galvanic connection to controller ground or
PE. Give probe and tool setter separate V+, signal, and return terminals but one
protected isolated supply may feed both after their current is measured.

#### Phase-one HW-399 adapter

The already-owned HW-399/TLP281-4-compatible module is on HOLD until its
actual circuit and all A2 qualification checks are complete. Photographs alone
do not qualify it. The following is a conditional circuit hypothesis, not a
released terminal recipe. Only if the traced circuit proves it, connect isolated field 0 V to `GND`, sensor signals to
`IN1` and `IN2` through the characterized active-low/pullup network, Octopus
3.3 V/GND from the Octopus I2C header to `HVCC`/`HGND`, `OUT1` to PF5, and
`OUT2` to PB7. Leave PB8 and PB9 unpopulated. Sensor V+ comes
from the isolated supply bus; do not invent a module VCC terminal if the actual
board does not provide one. `GND` and `HGND` must remain open-circuit.

The provisional 4.7 kohm pullup is retained only if bench measurements prove
sensor sink current, optocoupler drive, idle/trigger output margins, field-power
loss behavior, and cable-flex repeatability. This adapter does not replace the
production-board protection and acceptance criteria below.

For a verified active-low open-collector sensor:

```text
ISO_5V -- RLED -- opto LED anode/cathode path -- SENSOR_SIGNAL
ISO_5V ---------------------------------------- SENSOR_V+
ISO_0V ---------------------------------------- SENSOR_0V

Octopus input -- opto collector
CTRL_0V ------- opto emitter
```

Choose `RLED` for the measured signal sink current and optocoupler CTR at the
panel's maximum temperature. A Schmitt buffer or a high-CTR logic optocoupler is
preferred. The controller side must pull PF5/PB7 low on sensor actuation.
PF5 (T1) has an onboard pull-up/RC; PB7 has neither, so the interface board
supplies PB7's 3.3 V pull-up and RC filter (section E).

Per-channel provisions:

- Reverse-polarity protection.
- Resettable current limit or fuse.
- Input TVS appropriate to the verified sensor voltage.
- `V+`, `SIGNAL`, `0V`, and shield test points.
- Buffered status LED on the controller side.
- Disconnect jumper for insulation and leakage tests.

### E. Operator Inputs

Do not run operator, door or monitor contacts straight from the field connector
to the Octopus headers. Every field input gets the same connector protection
the probe channels require (see "Layout and EMC Rules"): a series resistor and a
TVS at the field connector, before the trace enters the board.

Onboard conditioning differs by input on the BTT v1.1 schematic:

| Octopus input | Onboard pull-up / RC | Required on the interface board |
| --- | --- | --- |
| PC0 (PWR-DET), PF3 (TB), PF4 (T0) | Present | Series resistor + TVS; positions for pull-up/RC, sized together with the onboard network |
| PB1, PB2 (EXP2) | **None** | Series resistor + TVS + external pull-up to Octopus 3.3 V + RC filter |
| PB7 (tool-setter header) | **None** | Same as PB1/PB2 (a pull-up proved in the conditioner output stage may replace the separate one) |

Component values are HOLD until the bench design. Pull-ups go to the Octopus
3.3 V logic rail only, never 5 V. The MCU's weak internal pull-up is not an
adequate termination for a cabinet cable.

**PB2 shares its net with the onboard `SW2` button.** On the BTT v1.1 schematic
PB2 is net `BTN_EN1`, which also runs to the onboard `SW2` ("BOOT1") pushbutton
to GND, with no board pull-up or filter. The firmware debounces only the door
and reset inputs. Pressing `SW2` is therefore a cycle start: during a feed hold
it resumes motion. Before commissioning, physically guard or disable `SW2`
(fixed cover, or remove the switch) and fit the external pull-up and RC on PB2.
EXP2 also carries the MCU reset line (`RST`/NRST, EXP2 pin 8) beside PB1/PB2:
keep the breakout keyed, insulate unused conductors and never probe EXP2 with
power applied.

| Port | Octopus destination | Contact |
| --- | --- | --- |
| DOOR | PC0 PWR-DET/GND | NC |
| ESTOP_MON | PF3 TB/GND | Safety-relay contact closed while energized, open on E-stop/trip (not an NC auxiliary); terminal HOLD |
| HOLD | PF4 T0/GND | NC |
| START | PB2 EXP2/GND | NO guarded |
| CAB_FAULT | PB1 EXP2/GND | Conditioned healthy-low |

Do not route the safety relay's two E-stop channels through this PCB. Only its
isolated monitor contact belongs here: closed while the relay is energized and
open on E-stop, trip or a broken wire (`WIRING.md`, "Operator and
Safety-Monitor Inputs"). Never invert `$14` to suit a different contact.

### F. Spindle Interface

Keep the analog block physically separated from motion edges and relay coils.

Inputs:

- Candidate `SPINDLE_PWM_24`: FAN0+ and FAN0 switched negative.
- Candidate `SPINDLE_EN_24`: FAN4+ and FAN4 switched negative.

Both remain on HOLD. On BTT schematic sheet 3, each FAN positive rail is
jumper-selected from 5 V, 12 V or VIN. A 24 V MAIN supply does not establish a
24 V FAN output. Identify the actual jumper, verify its rail, and match the
converter/coil input rating before connecting a load. The FAN negative terminal
is a MOSFET-switched return, **not logic GND**; bonding it to GND bypasses the
switch. FAN6/7 have fixed GND returns and are not substitutes for FAN0/FAN4.
Confirm output-off and PWM behavior under the real load, including startup,
reset and power loss, with spindle power disconnected.

Outputs:

- Galvanically isolated, calibrated `0-5V` and `ANALOG_COM` for the verified DB44 pins.
- Isolated dry contact for stock servo enable.
- Optional isolated servo-alarm input to PB1.

Analog requirements:

- 0 V command at `M5`, reset, E-stop, controller boot, and disconnected PWM input.
- Monotonic command from 0 to 5.000 V nominal over 0-100 percent duty cycle.
- Output ripple and settling measured at 1 kHz PWM into the actual servo input.
- Multi-turn zero and span trim, then tamper paint or saved calibration constants.
- Output clamp that prevents exceeding the verified drive command range.
- No shared return between `ANALOG_COM` and Octopus logic.

The spindle-enable contact must be in series with the hardwired safety permit.
Neither contact alone may defeat the other. This contact only drops `SON`; it
is not the E-stop function for the 240 VAC servo. Removing servo energy (mains
contactor and/or certified safe-torque-off) belongs to the reviewed cabinet stop
design, which is a blocking HOLD before energizing - see `WIRING.md`, "Scope
and Safety Boundary".

### F2. Final Digital Servo Interposer - Locked

The permanent board may reserve space and keyed connectors for the final digital
servo daughterboard described in `SPINDLE_SUPERVISION.md`, but P1 must not
populate or connect them as assumed T3 wiring. Digital RS-485 is the target
command path; the isolated analog path remains the break-before-make fallback.

Required future blocks are:

- Isolated USART2 RS-485 using candidate controller pins PD5/PD6 only after the
  board and timer audit approves them.
- Individually isolated 12-24 V inputs for verified drive outputs.
- Individually isolated outputs for SON, candidate CMODE, and guarded ACLR.
- An isolated differential RS-422 receiver for verified OA/OB/OZ pairs.
- A separate conditioned spindle-side index channel.
- A hardware heartbeat watchdog in series with normal spindle permission.
- Break-before-make service selection that preserves the isolated analog path.

Every unpowered or disconnected control output must request disabled/zero. The
servo common, encoder common, analog common, Octopus logic return, probe return,
shield, and PE are separate nodes unless the reviewed schematic explicitly
defines one connection. No generic converter module may bridge these domains.

The daughterboard cannot be released until `servo-profile.pending.json` is
replaced by an approved, fingerprinted profile. Until then the write whitelist
is empty and all supervision connectors remain unplugged.

### G. Coolant Outputs

HE0 and HE1 are low-side switched power outputs (BTT sheet 3), with positive
terminals on fused VIN. A 24 V input/coil is a candidate only after the actual
VIN rail and selected load are verified. Connect a qualified two-wire load
across HE+ and its switched HE-; never bond HE- to logic GND. These channels
remain on HOLD until load ratings and off/startup behavior are tested. Put relay/solenoid flyback or surge
suppression at the load and provide a replaceable fuse per output. If switching
mains pump power, the PCB drives a listed contactor/relay coil only; mains does
not enter the low-voltage interface board.

## Connector Plan

| Designator | Name | Pins |
| --- | --- | ---: |
| JX | X external-drive command | 6 |
| JYL | Y-left external-drive command | 6 |
| JZ | Z external-drive command | 6 |
| JYR | Y-right external-drive command | 6 |
| JFX/JFYL/JFZ/JFYR | External-drive alarms | 4 each |
| JP | Touch probe | 4 including shield |
| JT | Tool setter | 4 including shield |
| JOP | Operator inputs | 10 or separate keyed pairs |
| JSP | Spindle low-voltage control | 6 including shield |
| JCOOL | Flood and mist/air control | 6 |
| J24 | Protected 24 V control input | 3 including PE/shield reference |
| JTEST | Logic/service header | No field cable |

Use different keying or connector families for 36 V, 24 V, 5 V, isolated 5 V,
and analog field circuits so a plug cannot be moved into a damaging port.

## Layout and EMC Rules

- Use a continuous controller-ground plane only in the controller section.
- Preserve clearance across every isolation barrier; do not cross it with copper, test pads, mounting hardware, or shield pours.
- Keep the isolated analog island separate from the isolated probe island.
- Route PUL/DIR pairs together from connector to transistor and avoid long parallel runs with relay/output traces.
- Put TVS and current limiting at the field connector, before traces enter the board.
- Keep relay coils and contacts away from probe and analog nodes.
- Add mounting holes tied to chassis only where intentionally designed; do not let standoffs bridge isolation.
- Use 105 C rated components and calculate temperature rise inside the closed cabinet.
- Label every connector on both PCB faces with function, voltage domain, and pin 1.
- Include board revision, schematic revision, firmware profile name, and test date on the assembly label.

## Bench Acceptance

P0 and P1 must each pass these tests before connection to the MR-1:

1. Automated netlist-to-`io-manifest.json` review with no swapped axis or GPIO.
2. Insulation test between controller, isolated probe, isolated analog, 24 V field, and PE domains at a voltage appropriate to the selected components.
3. Power-rail current limit and reverse-polarity tests.
4. PUL/DIR operation from 1 Hz through at least 25 kHz into the actual active-drive inputs.
5. Active PUL/DIR power-up/down tests; ENA stays unconnected. Any later ENA
   implementation requires its own truth-table, delay and power-loss tests.
6. Alarm polarity, cable-open, and drive-power-loss tests on all four channels.
7. Probe and tool-setter actuation/release repeat tests, including cable flex and injected noise.
8. PWM calibration at 0, 6.25, 12.5, 25, 50, 75, and 100 percent duty cycle.
9. Relay flyback and output-off behavior during abrupt 24 V loss.
10. A 24-hour powered thermal soak with all external-drive input optocouplers and relay coils in worst-case states.

Record component values, waveforms, temperatures, and pass/fail results. A
working first sample is not a released design until a second assembly repeats
the same tests.
