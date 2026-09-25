# MR-1 Wiring Manual

> **Changed 2026-09-16.** The four `CL57T V4.1` closed-loop kits arrived, so
> the machine goes **straight to closed loop** and the DM860T phase is skipped.
> **Use `CL57T_QUICK_WIRING.md`** for the bench termination sequence and switch
> settings. `grblHAL-STM32F4/mr1/DM860T_QUICK_WIRING.md` (repository path) is retained as reference for the preserved
> rollback hardware only — **do not wire a CL57T from it.** Its switch letters,
> its bus-voltage range, and above all its no-polarity power rule are wrong for
> these drives.

The active motion hardware is four STEPPERONLINE `CL57T V4.1` closed-loop
drives with `23HS45-4204D-E1000` motors (4.2 A/phase, 3.0 Nm). The four DM860T
V3.0 drives and the stock Langmuir motors are preserved intact as the rollback
set; do not sell, modify, or scavenge them until the closed-loop conversion has
passed commissioning.

Two differences from the DM860T are destructive if missed, and both are covered
in `CL57T_QUICK_WIRING.md`:

- **`P4` bus power is polarized** (`+VDC` / `GND`). The DM860T's two
  interchangeable `AC` terminals do not exist on this drive. Every `AC/AC`
  instruction in this project predates the change.
- **Bus maximum is 50 VDC absolute**, 24-48 VDC recommended - not the DM860T's
  24-110 VDC. The existing 36 V bus is fine; anything above 50 V destroys the
  drives.

> **Wiring the machine right now?** `WIRING_SIMPLE.md` is the short version -
> ten steps in safe order, one check each, no theory. Come back here for the
> reasoning behind any step.

## Start-To-Finish Screen

The Windows control screen's cable button opens an audited `START` tab before
the pin-level diagrams. Use its eleven-stage build order from identity photographs
through formal commissioning. Every item is marked as one of:

- `EXACT MAP`: fixed by the compiled firmware or an identified manufacturer
  manual. Printed connector and terminal names remain authoritative.
- `METER FIRST`: the circuit role is known, but the installed wire, module,
  motor coil, voltage, or polarity needs physical proof.
- `HOLD`: leave the connection open until the missing hardware identity or
  electrical contract is approved.

The 18 saved evidence checks record photographs, connector fit, meter readings, and bench
tests. They cannot enable a control, grant motion permission, or replace the
staged procedure in `grblHAL-STM32F4/mr1/COMMISSIONING.md` (repository path).

The same screen includes BTT's official Octopus Pro V1.1 pinout image dated
2023-11-02. Eight highlighted connector groups open the matching detailed tab;
the full-map control widens the image for checking the original GPIO labels.
The overlay is navigation only. The printed connector name on the official
image and the matching silkscreen on the actual board remain authoritative.

The `FLASH` tab is the first powered operation and requires no 24 V supply. It
shows BTT's official MCU USB-power jumper photograph, the hash-locked F429 image,
and the complete bare-board FAT32 microSD sequence. Only the low-voltage board
logic is USB-powered; every driver, adapter, field plug, machine cable, and other
power connector remains physically absent. Disconnect USB before touching the
card or jumper, require `FIRMWARE.CUR`, then remove the temporary jumper before
the board is installed or `MAIN POWER` is ever connected.

### Wiring Source Ledger

The guide uses a source hierarchy instead of treating every online wiring
table as equally authoritative:

- `io-manifest.json` and the matching compiled source own Octopus GPIO assignments.
- Official BTT v1.1 documents own Octopus connector locations, the 18-position
  driver-socket circuit, and the 5 V HCT signal buffers.
- The [CL57T V4.1 manual](https://www.omc-stepperonline.com/download/CL57T-V41_user_manual.pdf) owns CL57T terminals, limits, switches,
  and timing. Vendor manuals are linked from their publishers, not bundled in
  this repository. The official STEPPERONLINE V3 manual owns DM860T
  terminals, limits, and switches for the retained rollback set.
- Official Langmuir material owns stock machine layout and assembly context.
- The [alexphredorg MR-1 Mesa/LinuxCNC project](https://github.com/alexphredorg/mr1)
  is a stock-machine cross-check only.

The community conversion corroborates useful MR-1 device identities and DB44
test hypotheses. It also describes its stock input system as active-high and
the limit/E-stop circuits as `NC 5V`; that is sufficient to prohibit assuming
the stock limit harness is a dry contact. Its Mesa terminals, wire colors,
common enable, and software polarity are not imported. Its README also conflicts with its HAL on Y2/Z input
allocation and conflicts internally on DB44-30. See
`MR1_GITHUB_CROSSCHECK.md` for the pinned-revision audit and exact boundaries.

## Scope and Safety Boundary

This manual defines the conversion's low-voltage controls and the interfaces to
the existing MR-1 equipment. It does not provide a branch-circuit or mains panel
design. The MR-1 uses 120 VAC machine loads and a 240 VAC, 2.5 kW spindle servo.
A qualified person must review mains wiring, overcurrent protection, grounding,
disconnects, contactors, enclosure construction, and compliance for the actual
installation.

The Octopus, grblHAL, Windows PC, USB cable, CL57T alarm outputs, and ordinary
relays are not safety-rated. A hardware safety relay and appropriately rated
contactors must remove hazardous motion power and interrupt spindle enable when
the E-stop chain opens. Keep the 24 V Octopus supply alive so the controller can
report the stop. The exact stop category requires a machine risk assessment;
neither the DM860T nor the CL57T V4.1 has a certified safe-torque-off input.

> **HOLD - blocking prerequisite before energizing.** The stop circuit in this
> manual is a set of principles, not a design. The 240 VAC spindle servo stays
> powered when its `SON` input drops, the drives have no certified
> safe-torque-off, and the flood/mist loads are switched only by firmware
> outputs. Do not energize the cabinet with any drive, spindle or coolant load
> connected until a qualified person has produced and reviewed a stop design
> that, at minimum:
>
> 1. removes spindle-servo energy on E-stop with a rated mains contactor on the
>    servo supply and/or a certified safe-torque-off function. `SON` dropout
>    through the spindle-enable relay is not the E-stop function;
> 2. removes 36 V motion power, with a Z-drop analysis for the de-energized
>    state (removing power also removes holding torque from the gravity-loaded
>    Z axis): brake, counterbalance or mechanical support;
> 3. puts the flood pump and mist/air solenoid supplies in the hardwired stop
>    chain;
> 4. sets the stop category and restart prevention from the risk assessment;
> 5. gives a complete terminal schedule for the E-stop station, safety relay,
>    contactors and the PF3 monitor contact.
>
> The USB-only firmware flash (`grblHAL-STM32F4/mr1/COMMISSIONING.md`, Stage 0A)
> needs no cabinet power and is not affected by this hold.

## System Architecture

```text
                    HARDWIRED SAFETY PATH
  dual-channel E-stop / required interlocks
                -> safety relay
                -> motion-power contactor(s) -> 36 VDC -> four CL57T drives
                -> spindle servo energy removal: mains contactor and/or
                   certified STO (HOLD - design review; SON dropout is not it)
                -> coolant pump / air solenoid supply (HOLD - in the stop chain)
                -> monitor contact, closed while energized -> Octopus PF3

                    CONTROL PATH
  Windows mini PC -- USB --> Octopus Pro v1.1 F429
                               |
                               +-- motion interface --> X / YL / Z / YR CL57T
                               +-- isolated inputs <-- four CL57T alarms (series -> PB1)
                               +-- encoder stays drive-side: motor <-> CL57T P2
                               +-- isolated conditioner <-- four stock home channels
                               +-- isolated inputs <-- probe + tool setter
                               +-- isolated 0-5 V + relay --> stock spindle drive
                               +-- interposing relays --> flood + mist/air
```

## Power Domains

Never join power domains merely because their negative terminals are both
called `GND`.

### Motion supply: `S-360-36`, and its margin

Identified 2026-09-20 from the installed nameplate:

| Parameter | Value |
| --- | --- |
| Model | `S-360-36` |
| AC input | 110 / 220 V +/-15% |
| DC output | **36 V, 10 A (360 W)** |
| Type | Enclosed switch-mode, therefore regulated |

The recorded 36 V nominal lies within the drive range; it does not prove
actual output voltage, regulation, ripple, transients or deceleration headroom.
Measure this supply with branches disconnected before connection, then qualify
its actual loaded behavior in the guarded commissioning stage.

Supply capacity remains unresolved. The previous planning estimate used the
S1=4 current preset and the following heuristic; it is not a DC-bus rating calculation:

```text
4 drives x 4.0 A RMS        = 16.0 A summed phase current
x 0.6-0.7 DC bus factor     = 9.6 - 11.2 A at the 36 V bus
supply rating               = 10.0 A
```

This is a sizing heuristic, not a measured load or a proof that the supply is
adequate. Phase current is not the DC bus current. The ganged Y pair always
moves together; coordinated X/Y/Z acceleration loads all four drives.

Treat simultaneous four-drive capacity as **unqualified**. The documented 10 A
supply does not meet the proposed 12 A design margin in the arrival checklist.
Either select a suitable replacement or document a reviewed operating envelope
using voltage/current/temperature measurements of this actual supply.
Specifically:

- **Do not add another load to this rail.** The 24 V control supply stays
  separate, as the power-domain table already requires.
- **Do not raise `$110`-`$112` rates or `$120`-`$122` accelerations** without
  re-checking this budget. Acceleration is what sets peak current draw.
- **Watch for undervoltage during commissioning.** A supply pulled below the
  CL57T's 18 V minimum during hard acceleration presents as a drive alarm or a
  following error, not as an obvious power fault. If that appears during the
  Stage 5 per-axis speed tests, this is the first suspect.
- Select any replacement only after a measured load/regeneration study; a
  current rating alone does not establish suitability.

**With supply power isolated, verify the actual input selector and nameplate
against the measured facility service.** Do not assume a 110 V feed or move a
selector while energized.

### Higher-Current / Higher-Voltage Supply Proposal - HOLD

An earlier design note proposed a 48 V / 25 A supply with an added capacitor
bank. **No upgrade, trim voltage, capacitor bank, inrush limiter, bleeder or
braking circuit is released for construction.** The previous mass, rotor
inertia, capacitance and regeneration figures were assumptions. They do not
bound actual deceleration, gravity-loaded Z energy, supply behavior or faults.
The claim that a brake chopper is unnecessary is withdrawn.

Before selecting any replacement, document the actual four-drive load, supply
transient response/overvoltage behavior, returned energy for the full operating
envelope including Z descent, drive bus limit, branch protection and stop
architecture. Any energy-storage/braking design must include component ripple,
voltage/temperature ratings, inrush and repetitive restart behavior, contactor
ratings, fusing, discharge time and measured safe-to-service indication.
Do not infer adequacy from nominal watts or a generic NTC label.

The active candidate remains the recorded 36 V supply, with simultaneous
four-drive capacity and transient voltage unqualified. The CL57T manual's
50 V maximum is a hard limit, not an operating target.

### Cabinet bonding and board mounting

**The cabinet is PE bonded regardless of its isolation mounts.** Langmuir mounts
the stock enclosure to the left rear leg on three isolation mounts, but those are
for vibration damping and are not an electrical isolation strategy. A metal
enclosure containing 120 VAC machine loads and a 240 VAC spindle must be earthed,
so if the mounts break continuity to the frame the enclosure gets its **own
dedicated PE conductor**. Do not rely on the leg.

The cabinet shield termination depends on the protective bond. The isolated
home-field supply remains separate; its signal return is not a PE connection.

**Document the controller-0V/PE bonding topology.** The intended cabinet
reference is the 24 V supply 0 V terminal; verify that choice against the actual
supply and interface design. USB connected to an earthed PC may add another
return path. Do not claim an exactly-one-point system until all connected paths
are traced, and never remove protective earth to obtain an open meter reading.
Use insulated controller mounting to avoid an unintended chassis path.

| Item | Mounting | Expected PE continuity |
| --- | --- | --- |
| Backplate | Bonded | Dead short to PE |
| CL57T drives x4 | Exposed chassis bonded through a verified suitable connection | Verify protective bond; do not assume operating current flows through the heatsink or use chassis as signal return |
| Octopus Pro | **M3 male-female nylon standoffs** | Open only with power, signal cables and USB disconnected; final connected continuity follows the documented reference paths |

**Tapped backplate holes do not bond through paint.** Threads tapped into a
painted or powder-coated plate line with coating, and a screw can feel tight
while reading open to PE. Where a bond is wanted - the drives - scrape the
coating at one mounting point per drive or use a paint-piercing star washer, then
**meter chassis to PE** rather than assuming.

Where isolation is wanted - the Octopus - nylon male-female standoffs screwed
into the tapped hole give a clean install with no washers or back-side access,
and the nylon body breaks the path even if the board's mounting holes tie to
`GND` internally. A metal screw through the board into the nylon top is fine; it
contacts the board pad and nothing else.

With all power removed, verify the protective bonds. Check Octopus mounting
isolation with power, USB and field interfaces disconnected. After connecting
the intentional control-0V reference and USB, record the final continuity paths;
Octopus GND-to-PE may then be connected by design.

| Domain | Source | Loads | Rule |
| --- | --- | --- | --- |
| Protective earth | Facility PE | Cabinet, DIN rail, MR-1 frame, spindle chassis, metal connector shells | Permanent bonding; never use PE as a signal return |
| 36 V motion | `S-360-36`, 36 V 10 A | CL57T `P4` power inputs only | **18-50 VDC absolute, 50 V is a hard ceiling.** Four separately fused star branches; never daisy-chain drives. `P4` is POLARIZED `+VDC`/`GND` |
| 24 V control | Separate regulated supply | Octopus `MAIN POWER`, relay coils, field interface | Octopus main input is limited to 28 V maximum; never apply 36 V |
| 5 V motion logic | Protected interface supply | CL57T `P1` PUL/DIR optocouplers (ENA reserved, not connected) | Common-anode signal domain; **`S3` on every CL57T must be `5V`** (factory is 24V). Note the letter: `S2` is the DIP bank on a CL57T and the selector on a DM860T. Applying 24 V to an input set to 5 V destroys the photocoupler |
| Isolated 5 V home field | Isolated, current-limited DC/DC | Stock limit bus through four-channel conditioner | Separate from Octopus GPIO and probe field; omit only if each switch is proved to be a bare dry contact |
| Isolated 5 V sensor | Isolated, current-limited DC/DC | Stock probe and tool setter only | Floating field side; crosses into Octopus through two optocouplers |
| CL57T encoder | **Drive-supplied**: `P2 VCC`/`EGND` from each CL57T | That drive's motor encoder only | Never feed `VCC` from the field 5 V or 24 V rail; it is an output of the drive. Do not bond to another drive or controller logic; the manual does not prove internal galvanic isolation of this output. Route away from motor phases and bus cable |
| Octopus logic | Onboard regulators | MCU and GPIO | No external 5 V or 24 V may reach an MCU pin |

The STEPPERONLINE manual explicitly recommends star-feeding shared driver
power - CL57T V4.1 S4.1: *"DO NOT daisy-chain connect the power supply input
pins of the Drivers. Instead connect them to power supply separately."* Place the four drive branch fuses/disconnect terminals next to the 36 V
supply. Select fuses from the final conductor size, supply behavior, and drive
manual, not from motor phase current alone.

For the Octopus:

- Connect 24 V only to the actual terminal pair silked `POWER` (`MAIN POWER`
  in older notes), +VIN and GND. Identify it from the actual board markings and
  continuity; do not count screws from a presumed top. Verify the disconnected
  supply separately, then isolate/discharge again before landing it.
- Leave `MOTOR POWER` and `BED POWER` unconnected for this design.
- Install no plug-in TMC/A4988 driver in MOTOR0 through MOTOR3.
- Remove every jumper on the driver slots. There are three separate blocks per
  slot and all three matter:
  - **Voltage select**, the three-pin `HV`-`VM`-`VIN` header above each socket.
    With no driver fitted `VM` feeds nothing, so a jumper only leaves a live
    rail sitting on an exposed socket pin. Pull it on all eight slots. Never
    move one with power applied.
  - **Mode / SPI**, the three-by-four pin field under each socket:
    `PA6`/`CS`/`PA5`/`PA7` over the socket's own pins over
    `SLP`/`5V`/`5V`/`5V`. Any jumper here ties a floating socket pin to the
    board's SPI1 bus or to 5 V, which BTT's own documentation warns causes
    interference on those lines.
  - **DIAG**, one two-pin position per slot. `M0DIAG` through `M7DIAG` land on
    `PG6`, `PG9`, `PG10`, `PG11`, `PG12`, `PG13`, `PG14`, `PG15` - the same
    nets as `STOP_0` through `STOP_7`. A DIAG jumper therefore wires an
    unconnected socket pin straight onto a home input or a drive-alarm input.
    Remove all eight. Sensorless homing needs a TMC driver, so nothing is lost.
- Do not connect any external-drive motor phase to an Octopus motor-output terminal.

## Motion Interface

The first four Octopus driver sockets are signal sources. MOTOR3 is Y-right,
not a fourth logical axis.

| Physical axis | Octopus socket | Step | Direction | Disable/enable | CL57T |
| --- | --- | --- | --- | --- | --- |
| X | MOTOR0 | PF13 | PF12 | PF14 | X drive |
| Y-left | MOTOR1 | PG0 | PG1 | PF15 | YL drive |
| Z | MOTOR2 | PF11 | PG3 | PG5 | Z drive |
| Y-right | MOTOR3 | PG4 | PC1 | PA2 | YR drive |

BTT schematic sheet 1 identifies the driver contacts as 1 EN, 7 STEP, 8 DIR,
9 GND. These are schematic identifiers, not physical row counts. The active
adapter uses STEP/DIR/GND; EN is reserved and unconnected. Other contacts,
including VCC_IO, VM, motor phases and DIAG, must not reach the external drive.

Use a mechanically supported adapter. A 2x8 candidate is on HOLD until its
complete contact map, actual orientation, clearance, keying and retention are
proved on the 18-contact socket; do not infer that fit from numbering alone.
No loose Dupont leads. Motor phase connectors do not expose STEP/DIR.

The schematic also shows `MC74HCT125A` buffers powered from 5 V between the MCU
and the socket EN/STEP/DIR pins. The interface gate input is therefore a 5 V
buffered socket signal, not a raw 3.3 V GPIO.

Each of the eight active PUL/DIR channels uses this candidate open-drain stage;
component values and loaded behavior still require bench qualification:

```text
Octopus socket signal -- 100 ohm -- gate, 2N7002
                                  |
                               100k to source
2N7002 source ---------------- controller logic 0 V
2N7002 drain ----------------- CL57T P1 PUL- or DIR-
protected +5 V --------------- CL57T P1 PUL+ or DIR+
```

The CL57T input optocouplers provide the field isolation. Retain the MOSFET
stage because the CL57T logic input is specified at 7-16 mA (10 mA typical,
manual S2.1) - so the earlier interface is a candidate, not a proven carry-over. Direct
loading of the HCT output has not been qualified. Select a MOSFET with guaranteed low
resistance at a 4.5-5 V gate, then verify every channel with an oscilloscope
under its real opto load with the motor uncoupled and secured; never energize a
CL57T without its matched motor and encoder connected.

ENA stays unconnected (manual section 3.1). A future ENA implementation must
separately prove polarity, startup/shutdown, power-loss behavior and the
200 ms ENA-to-DIR requirement at the actual drive. The configured 250 ms delay
is not physical proof and does not implement a hardware safety function.

**STEP/DIR are undefined while the MCU is in reset or the SD bootloader.** The
`MC74HCT125` buffers are always enabled and nothing pulls STEP/DIR, and with ENA
unconnected the drives stay enabled. Scope STEP/DIR at the socket during reset,
power-up and a bootloader pass with drive power off. Whether to use the
reserved ENA channel or to interlock motion power to controller health is a
**design decision pending review** (`INTERFACE_BOARD.md` A). Until then, keep
drive power off whenever the controller is reset, rebooted or flashed.

### CL57T V4.1 Starting Switches

Power must be off before changing switches. All settings are read at power-up.

Use the complete table in `CL57T_QUICK_WIRING.md`. Identical on all four drives:

| Control | Set to | Meaning |
| --- | --- | --- |
| `S1` rotating | `4` | 5.6 A peak / 4 A RMS, under the motor's 4.2 A/phase. Initial project preset, not a verified thermal/load result; factory `0` is 2 A RMS |
| `SW1`-`SW4` | `on`,`off`,`on`,`on` | 1600 pulses/rev, holding 320/320/533.333333 steps/mm |
| `SW5` | `off` | Direction. Prefer correcting direction in the firmware mask so all four drives stay identical |
| `SW6` | `off` | **Closed loop.** ON is open loop and silently discards the upgrade |
| `SW7` | `off` | PUL/DIR single pulse, which is what grblHAL emits |
| `SW8` | `off` | Pulse filter 1.5 ms. Must be identical on all four, and especially on the two ganged Y drives |
| `S3` selector | `5V` | Factory is `24V`. Applying 24 V to an input set to 5 V destroys the photocoupler |

The retained DM860T switch table lives in `grblHAL-STM32F4/mr1/DM860T_QUICK_WIRING.md` (repository path) and applies
only to the rollback hardware.

The firmware provides 5 us pulses, 6 us direction setup, and 250 ms enable
delay. Maximum configured step rate is about 13.55 kHz, below the
500 kHz CL57T V4.1 input limit. Do not hot-plug command, motor, encoder, alarm,
or power connectors.
Label both ends X, YL, YR, or Z before routing.

## Home and Limit Inputs

**Design intent: reuse all four factory home channels.** Langmuir ships the MR-1
with two limit switches on the Y axis expressly for automatic gantry squaring,
with independently adjustable Y1 and Y2 switches, and the machine re-squares on
every homing cycle. Auto-squaring cannot work from a series-chained pair - the
control has to know which end tripped first - so the factory harness necessarily
carries Y1 and Y2 as **independent signals**. That preserves `Y_AUTO_SQUARE` and
the 5.461 mm dual-axis fail distance through the conversion.

Expect a shared 5 V supply and a shared return with a separate signal conductor
per switch. Shared supply and return are normal and fine; a shared *signal*
would be fatal to squaring, and the evidence says the signals are separate. The
community README's "Y2/Z limit" input label is stale - that repository's own HAL
maps Y2 home and Z home to separate inputs. See `MR1_GITHUB_CROSSCHECK.md`.

The harness remains a `METER FIRST` item, not an approved dry-contact harness. A
pinned community conversion powers the stock limit port from 5 V and describes
the inputs as active-high `NC 5V`. Its connector and polarity claims do not own
this machine, and **no stock 5 V conductor may be connected to an Octopus STOP
signal** - those inputs are 3.3 V with onboard pullups. Reusing the harness and
requiring the isolated conditioner are not in tension: the conditioner is what
makes reuse safe.

Before trusting it, with the stock controller unplugged, meter at the connector:
which conductor is supply, which is return, and confirm each of the four signals
is independent - in particular that Y-left reads independently of Y-right.

Route powered stock channels through a **qualified** isolated conditioner.
The on-hand TLP281-labelled module remains on HOLD; its input topology,
terminals, resistors, shared output rail and isolation must first be traced.
See `INTERFACE_BOARD.md` A2 for qualification. Do not assume leaving output VCC
open creates independent open collectors: a floating common rail can couple
channels through pullup resistors. No generic VCC/GND/IN terminal recipe is
approved, and a GPIO-facing pullup must never be powered from 5 V.

The table below gives the required controller truth table, not a claim that
the untested module achieves it. Test every channel healthy/triggered/open and
with field power lost; also test combinations and either side unpowered.
Keep STOP 5 V cavities empty. Preserve the stock harness until its actual
supply, return and signal paths are documented.

| Function | Octopus connector | GPIO | Healthy | Trigger, broken wire, or field-power loss |
| --- | --- | --- | --- | --- |
| X home | DIAG0 / X_MIN | PG6 | Conditioned low | Input open/high |
| Y-left home | DIAG1 / Y_MIN | PG9 | Conditioned low | Input open/high |
| Z home | DIAG2 / Z_MIN | PG10 | Conditioned low | Input open/high |
| Y-right home | DIAG3 / E_MIN | PG11 | Conditioned low | Input open/high |

A direct two-wire `SIG`/`GND` connection is allowed only for a separately
proved bare positive-opening NC switch that is disconnected from the stock
controller and measures open-circuit to every supply, frame, shield, and other
conductor. That alternate path does not approve the untraced stock harness.

Initial homing is Z positive/up, X negative/left, then both Y motors
positive/rear. The two Y switches are not wired in series. grblHAL stops each Y
motor from its own switch and uses the event to square the gantry.

The connector names are printer-oriented labels, not MR-1 axis semantics. Verify
signal and ground pin positions from the BTT v1.1 pin drawing and with a meter.
Use `PIGTAIL_SCHEDULE.md` for the exact board-side housing counts and the stock
connector hold points.

## Drive Fault Inputs

> ## Only PB1 stops the machine. PG12-PG15 do not.
>
> Verified against the compiled source 2026-09-16:
>
> - `Src/driver.c:1662` sets the control signal from **one** pin:
>   `signals.motor_fault = DIGITAL_IN(MOTOR_FAULT_PORT, MOTOR_FAULT_PIN)`.
> - `boards/btt_octopus_pro_mr1_map.h:223-226` resolves `MOTOR_FAULT_PIN` to
>   `AUXINPUT6` = **PB1**.
> - That signal is what raises `Alarm_MotorFault` (`grbl/protocol.c:130-133`,
>   `grbl/motion_control.c:1192-1193`) and what blocks motion
>   (`grbl/protocol.c:467`).
> - The per-axis pins PG12-PG15 are in the driver's input table, so `$pins`
>   lists their assignment, and they are collected into `motor_fault_inputs`.
>   Nothing reads their state: `get_motor_fault_inputs()` has no caller in this
>   board build, they are never polled to raise an alarm, and no status report
>   or app screen shows them. `Src/driver.c:72-76` carries the unimplemented
>   note: *"TODO: add support for IRQ driven fault inputs?"*
>
> **Therefore: combine all four isolated, conditioned drive-healthy outputs into PB1. Never series-chain raw ALM/COMO terminals into the GPIO.**
> All four healthy = loop closed = PB1 reads healthy. Any drive alarm, any lost
> drive power, any broken cable opens the loop and stops the machine.
>
> PG12-PG15 may still be wired in parallel for a future firmware candidate, but
> the current firmware does **not** read them: they give no stop, no status and
> no indication of *which* axis faulted. Do not rely on them, and do not let
> `$744`/`$745` create the impression that per-axis fault handling is active.
>
> **Blocking prerequisite:** the PB1 aggregate chain is the only drive-fault
> stop. Qualify it - every drive's alarm, drive-power loss and open alarm cable
> each stop motion through PB1 - before any coupled dual-Y motion.
>
> This mattered little with open-loop DM860Ts, which cannot report a meaningful
> fault. With CL57T closed-loop drives the alarm is the entire point: a
> following error is the drive telling you it has lost the position the
> controller thinks it has.

The four DIAG stop connectors are assigned to individual drive faults as wiring
for a future firmware candidate. The current firmware does not read them.

| Drive | Octopus connector | GPIO |
| --- | --- | --- |
| X | DIAG4 / X_MAX | PG12 |
| Y-left | DIAG5 / Y_MAX | PG13 |
| Z | DIAG6 / Z_MAX | PG14 |
| Y-right | DIAG7 / E_MAX | PG15 |

Do not wire ALM directly to the Octopus. Each channel must pass through an
opto-isolated conditioner. The CL57T V4.1 provides `ALM` and `COMO` (manual
S6.2): the output may be wired sinking or sourcing, and on over-voltage,
over-current or following error the ALM/COMO impedance changes "from low to
high or high to low depending on configuration". The manual does not state a
default direction, so it must be characterized on the bench with a meter
before any conditioner is built. Ratings: sinking or sourcing 100 mA at
5-24 V, 30 V maximum.

Bench characterize the exact drive, then configure the interface so:

```text
drive ready + intact cable -> Octopus input pulled low
drive alarm, lost drive power, or broken cable -> Octopus pullup reads high
```

The permanent board includes polarity/configuration jumpers so the physical
ALM behavior can be converted to that fail-safe truth table. Verify each drive
by unplugging its alarm cable, removing its branch power, and exercising the
conditioner test fixture. Do not hot-unplug a motor to manufacture a fault.

PB1 on EXP2 is the aggregate fault input, and per the box at the top of this
section it is **the only one that stops motion**. Use an isolated,
normally-healthy low signal. PB1 has no board pull-up or RC filter (BTT v1.1
schematic); the interface board supplies the 3.3 V pull-up, RC filter, series
resistor and TVS (`INTERFACE_BOARD.md` E). It must carry the series chain of all four CL57T
drive-healthy channels, and may additionally combine spindle alarm,
safety-relay diagnostics, and cabinet overtemperature in the same series loop.

Series, not parallel: the chain must be arranged so that every healthy
contributor is required to keep the loop closed. Prove it by opening each
contributor in turn - unplug each drive's alarm cable, remove each drive's
branch power - and confirming the machine faults each time.

Do not use PB1 in place of the hardwired safety chain. It is a controller
input, not a safety function; power removal remains the safety relay's job.

## Probe and Tool Setter

The touch probe and fixed tool setter do not share an input:

| Device | Octopus connector | GPIO | grblHAL selection |
| --- | --- | --- | --- |
| 3D touch probe | T1 thermistor input | PF5 | `G65P5Q0` |
| Fixed tool setter | PB7 tool-setter input (header silk: `BLTouch`) | PB7 | `G65P5Q1` |

No BLTouch sensor is installed. PB7 is only a generic isolated tool-setter
input; `BLTouch` is the locator printed beside the five-pin board header.
Populate only PB7 and its adjacent GND. Leave PB6 and 5 V empty, and keep the
BLTouch firmware plugin disabled. PB7 has no board pull-up or RC filter; the
interface board supplies them (`INTERFACE_BOARD.md` E).

The dedicated Octopus `PROBE` port on PC5 is intentionally unused. The official
v1.1 schematic shows `PROBE -> R46 1K -> U16 EL357C LED`, with that LED returning
to board GND. The transistor collector is on 3.3 V, its emitter drives PC5, and
R51 pulls PC5 down with 100 kohm. It therefore protects and level-shifts one
active-high input, but it is not a floating field-side isolation island because
both sides reference board GND. This STM32 grblHAL profile instead uses
deterministic active-low/pullup inputs on PF5 and PB7.

Community measurements on stock MR-1 units report a three-pin sensor connector
with pin 1 supply, pin 2 active-low signal, and pin 3 return. They also report
nonstandard wire colors, conflicting sensor revisions, exposed metal at the
sensor supply potential, and coolant-related failures. Treat that pinout as a
test hypothesis only.

For each actual sensor:

1. Record model/revision and connector key orientation.
2. With the machine disconnected, identify chassis, plate, cable, and DB44-11/12 continuity.
3. Open the sensor or obtain a manufacturer drawing before applying power.
4. Use a current-limited bench supply and establish required voltage/current.
5. Verify idle and triggered signal voltage at least 20 times and while flexing the cable.
6. Only then terminate the field side of the isolated interface.

The already-owned HW-399/TLP281-4-compatible module remains on HOLD until
its circuit is traced and the qualification checks in `INTERFACE_BOARD.md` A2
pass. Photographs are evidence, not approval by themselves. The diagram below
is a conditional hypothesis only, not a released wiring recipe. For the common `IN1..IN4/GND` field side
and `OUT1..OUT4/HVCC/HGND` logic side, a verified active-low open-collector
sensor is wired as follows:

```text
ISO_5V -----------------------------------------------> sensor V+
ISO_0V ----------------+------------------------------> sensor return
                       +------------------------------> HW-399 GND
ISO_5V -> provisional 4.7K -> sensor SIGNAL ----------> HW-399 IN1 or IN2

Octopus 3.3 V ----------------------------------------> HW-399 HVCC
Octopus GND ------------------------------------------> HW-399 HGND
HW-399 OUT1 ------------------------------------------> T1 signal / PF5
HW-399 OUT2 ------------------------------------------> PB7 tool-setter input
```

`ISO_5V` is a field power bus, not an assumed HW-399 `VCC` terminal. On the
documented module circuit, the pullup drives IN high at idle and sensor
actuation pulls IN low; the corresponding OUT must meter high at idle and low
when triggered. The 4.7 kohm value is provisional until the exact module input
resistor, sensor sink current, TLP281 CTR, and 3.3 V output margins are measured.
Never connect HW-399 `GND` to `HGND`. The field 5 V supply is isolated,
current-limited, fused, and floating; its return must not be bonded to the
spindle, frame, Octopus ground, USB shield, cable shield, or PE.

Before connecting either GPIO, prove an open circuit (no low-voltage
continuity) between `GND` and `HGND`, power each side separately, and verify that OUT never exceeds
3.3 V. Then record idle/trigger voltage for both channels, perform at least 20
triggers, flex the cable, remove field power, and record the resulting state.
With this active-low circuit, lost field power and a broken sensor signal both
read as idle (not triggered), so the operating checks must include cable and
connector inspection and a trigger test before every probing cycle: select the
sensor, deflect the stylus or press the setter with motion stopped, and confirm
`Pn:P` appears and clears. The app's probing workflow rejects an input that is
already triggered but does not perform this test. See `INTERFACE_BOARD.md` D,
"Not fail-safe", for the limitation and a future NC / idle-lit option.

### Input-Path Calibration

The Windows UI stores an editable sensor-wiring profile and marks any GPIO or
polarity change `BUILD REQUIRED` until matching firmware is compiled and
flashed. Its input calibration uses repeated guarded contacts at three feed
rates to measure end-to-end repeatability and place an upper bound on
speed-dependent detection error. It applies zero compensation unless the shift
is statistically resolved above both motion resolution and measured noise.

That motion test includes the sensor, HW-399, wiring, controller interrupt, and
mechanics. It cannot isolate the optocoupler's electrical propagation delay by
itself; an oscilloscope or a commissioned field-side injection/loopback output
is required for that measurement. Real calibration motion remains locked until
the command service and guarded motion sequence are commissioned.

## Operator and Safety-Monitor Inputs

| Function | Connector | GPIO | Field contact |
| --- | --- | --- | --- |
| Enclosure door monitor | PWR-DET signal/GND | PC0 | NC, healthy closed |
| E-stop safety-relay monitor | TB signal/GND | PF3 | Closed to GND while the relay is energized; opens on E-stop/trip. Not an NC auxiliary - see below |
| Feed hold | T0 signal/GND | PF4 | NC, healthy closed |
| Guarded cycle start | EXP2 PB2/GND | PB2 | NO, pressed closes |
| Aggregate fault | EXP2 PB1/GND | PB1 | Conditioned healthy-low |

The PWR-DET header also contains 3.3 V. Use only PC0 and GND for the dry
contact. TB and T0 are two-pin signal/GND headers. Build keyed harnesses and
continuity-test them off the board; never identify header pins from cable color.

No field contact goes straight to an MCU header. Each passes the interface
board's series resistor and TVS. PC0, PF3 and PF4 have onboard pull-ups and RC
filters; PB1, PB2 and PB7 have none, so the interface board adds a 3.3 V pull-up
and RC filter for them (`INTERFACE_BOARD.md` E).

**Onboard `SW2` shares PB2 (cycle start).** PB2 is net `BTN_EN1`, also wired
to the Octopus `SW2` ("BOOT1") pushbutton to GND, and only door/reset inputs are
debounced. Pressing `SW2` during a feed hold resumes motion. Physically guard or
disable `SW2` (or remove it) before commissioning. EXP2 pin 8 is the MCU reset
line (`RST`/NRST), next to PB1/PB2: keep the breakout keyed and never probe it
live.

Cycle start is deliberately the only normally-open operator input. The firmware
inverts that bit while leaving E-stop, door, and feed hold fail-safe high on an
open wire.

**E-stop monitor contact (PF3).** The firmware reads PF3 high as E-stop
(`ESTOP_ENABLE`; the `$14` default does not invert it, and PF3 has a board
pull-up). The monitor contact must therefore be **closed to GND while the safety
relay is energized (healthy)** and **open on E-stop, relay trip or a broken
wire** - for example a spare NO safety output or an NO auxiliary contact. Do not
use an NC auxiliary: on typical safety relays it is open while the relay is
energized and closes on trip, which inverts the reading. The relay model and
its terminal are HOLD until the relay is selected. **Never invert `$14` to
"fix" a wrong contact**; that would make a broken monitor wire read healthy.

Commissioning check: pressing the E-stop must make PF3 read E-stop (`Pn:`
includes `E`); releasing it and resetting the chain clears `E` (the alarm then
still needs an explicit unlock, `$484=1`); unplugging the monitor wire must also
read E-stop.

## Stock Spindle Interface

Retain the stock MR-1 servo drive and its factory motor/encoder wiring for phase
one. The conversion controls only low-voltage speed and enable. Never connect an
Octopus terminal directly to DB44.

This analog path is the commissioning baseline and rollback path, not the final
feature ceiling. The final decision is a custom grblHAL servo plugin over
isolated RS-485 after the drive fingerprint and register whitelist are proved.

The following is a community-derived test hypothesis for T3a/T3L-based MR-1
systems, not an official Langmuir pinout. The source conflicts internally on
DB44-30, so meter the installed cable and compare it with the exact servo manual
and configured drive parameters before termination.

| Function | Community DB44 reference | Interface |
| --- | --- | --- |
| Analog command return | 10 | Isolated converter `OUT-` |
| 0-5 V speed command | 26 | Isolated converter `OUT+` |
| Servo enable (`SON`), reported active-low | 16 | Isolated dry relay contact switching `SON` to the 24 V I/O-supply 0 V (sinking input, `COM+` at +24 V); pending drive-manual and harness verification |
| I/O supply +24 V | 31 | Existing stock 24 V field supply |
| I/O supply return | 23 | Existing stock 24 V return |
| Possible servo alarm | 5 | Isolated conditioner to aggregate fault only after verification |
| Encoder A differential pair | 13 / 28 | Future RS-422 receiver, not this phase |
| Encoder B differential pair | 14 / 29 | Future RS-422 receiver, not this phase |
| Encoder Z differential pair | 15 / 30 | Future RS-422 receiver, not this phase |

Langmuir reportedly configures the analog command as 0-5 V even though the
generic T3 drive can support a different analog range. Do not alter servo
parameters to make an unverified converter work. First measure the stock command
at several requested speeds or reproduce the confirmed factory scaling. Any
later parameter change (for example analog gain scaling, `SPINDLE_SUPERVISION.md`
option 1) is a documented, reviewed commissioning step taken only after the
converter is verified, with the original parameter archive saved first.

Octopus outputs:

| Function | Octopus output | GPIO | Field interface |
| --- | --- | --- | --- |
| Spindle PWM carrier | FAN0 | PA8 | Isolated PWM-to-0-5 V converter |
| Spindle enable | FAN4 | PD14 | 24 V interposing relay with force-guided or monitored contact where required |
| Flood coolant | HE0 on v1.1 | PA0 | Interposing relay/contactor matched to pump |
| Mist or air blast | HE1 | PA3 | Interposing relay matched to solenoid/load |
| Reserved spindle direction | none (PE15 is an EXP1 pin; FAN5 is PD15) | PE15 | No connection in this build; re-audit the pin/connector before use |

### Final Digital Path - Held

The candidate logic path is Octopus `PD5 TX / PD6 RX` through a galvanically
isolated UART/RS-485 interface to the drive's continuity-verified communication
pins. It remains disconnected while `servo-profile.pending.json` is at Stage 0.
Do not land RS-485, drive I/O, or encoder wires directly on Octopus GPIO.

The analog and digital speed paths require reviewed break-before-make selection.
They may not be active simultaneously. The reserved `PE15` output (mislabeled
FAN5 previously; the official v1.1 pinout puts PE15 on EXP1 and FAN5 on PD15)
remains unconnected unless an
approved profile deliberately assigns it; digital reverse should normally be a
single, drive-specific command path rather than a second independent direction
authority.

FAN and heater terminals are low-side power outputs, not logic pins (BTT
schematic sheet 3). FAN0/FAN4 positive rails are individually jumper-selected
from 5 V, 12 V or VIN; 24 V MAIN power does not prove their selected voltage.
HE0/HE1 positives are fused VIN. Keep all these loads on HOLD until the actual
rail, load input rating, suppression and off/startup behavior are verified.
A qualified two-wire input/coil connects across its output positive and switched
negative; never bond that negative to logic GND, which bypasses the switch.
FAN6/7 negatives are fixed GND and cannot substitute for switched outputs.
The analog converter must match the measured PWM rail and frequency and provide
a verified isolated 0-5 V output before the stock servo is connected.

The spindle-enable relay is subordinate to the hardwired safety chain: opening
the E-stop must prevent enable even if PD14, firmware, or the relay module fails
in its commanded state.

## Grounding, Shielding, and Routing

- Bond the MR-1 frame, cabinet, spindle chassis, DIN rail, and exposed conductive enclosures to PE.
- Use a PE stud and star washers; do not stack signal returns on the PE stud.
- Terminate motor-cable shields 360 degrees at the cabinet entry and at a bonded motor connector shell when the cable system supports it.
- Follow the encoder cable manufacturer's shield termination; never use a shield as encoder return.
- Keep motor phase, 36 V bus, servo output, spindle mains, and pump conductors away from USB, probe, encoder, limit, and step/direction cable.
- Cross unavoidable power and signal routes at approximately 90 degrees.
- Use twisted pairs for PUL+/PUL- and DIR+/DIR-; ENA+/ENA- stay unconnected while reserved. Use separate shielded cable for each drive alarm.
- Keep probe and tool-setter cables separate from spindle power and motor phases.
- Bond cable glands/connectors to the enclosure before signals enter the interface area.
- Add strain relief and drip loops anywhere coolant can follow a cable.

The stock MR-1 motors are advertised as waterproof, but owner reports still
describe coolant-ingress failures. Fit rigid splash covers, sealed connector
transitions, and drip paths without blocking motor cooling. The active
STEPPERONLINE encoder motors are not advertised as sealed; do not encapsulate
encoder housings in silicone or adhesive.

## ESP32 Accelerometer

The ESP32 accelerometer remains an independent vibration instrument. It does not
share E-stop, probe, home, drive-fault, or motion signals. A magnet mount is fine
for stationary exploratory measurements on a clean steel spindle housing, with
a tether and the spindle stopped while installing/removing it. A rigid bolted or
clamped mount is required for repeatable comparisons. Do not put a loose magnet,
battery, or board near rotating spindle parts, coolant spray, or cutting chips.

Do not connect the ordered spindle-surface temperature probe until its product
link, part number, or board marking identifies the electrical interface and
pinout. Three leads and their colors are not sufficient. If it is confirmed as
a genuine three-wire DS18B20, the conditional Waveshare reference is `VDD -> H2
pin 3 / 3V3`, `GND -> H2 pin 2 / GND`, and `DQ -> H2 pin 8 / GPIO16`, with one
4.7 kohm pullup from DQ to 3V3. Never use H2 pin 1 `VBUS`. The ESP32
chatter-sensor firmware and its temperature-sensor wiring note are not part of
this repository. The installed `7.4-mr1` chatter firmware still reports internal
ESP32 temperature; external-probe firmware is not active.

## Pre-Power Continuity Rules

Before any supply is connected, the completed harness must show:

- No continuity from 36 V positive to Octopus `MAIN POWER`, any GPIO, USB shell, probe field supply, or PE.
- No continuity from isolated sensor return to Octopus ground, spindle/frame, or PE.
- Low-resistance PE bonds to every required chassis point.
- NC inputs closed in the healthy state and open for actuation or cable removal.
- No connection from any stop-header 5 V pin into a switch harness.
- Correct DB44 pin numbers from both ends of the actual cable, with shell orientation recorded.
- No short between adjacent driver-socket pins on the motion adapter.

Proceed to `grblHAL-STM32F4/mr1/COMMISSIONING.md` (repository path) only after a second-person check of those records.
