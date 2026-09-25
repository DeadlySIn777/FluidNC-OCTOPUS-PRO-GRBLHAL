# MR-1 Spindle Supervision

## Current Status

The stock MR-1 AC servo motor and its internal encoder loop remain intact. The
final control decision is **digital first with an analog fallback**: grblHAL will
ultimately own speed and direction through a custom, drive-specific plugin over
an isolated RS-485 link. The isolated forward-only enable and 0-5 V analog speed
path remains the production firmware baseline and the reversible commissioning
fallback until the installed drive is positively identified.

The digital path is designed but **locked**. The current production profile
deliberately has `MODBUS_ENABLE=0`, no spindle-encoder timer map, no position-mode
output, no reverse permit, and no drive write whitelist. The machine-readable
lock is `servo-profile.pending.json`. A successful build cannot promote it.

A separate non-default lab target now exposes physical MOTOR4 as rotary A for
position-mode servo qualification and disables PWM to prevent dual command
authority. Its lock is `servo-axis-tapping.pending.json`. It proves source
allocation and coordinated A/Z planning, not installed-drive compatibility.

The read-only control screen is ready for future spindle reports. It does not
enable any drive feature. Simulation is always labeled `SIMULATED` and
`UNAPPROVED`.

## Corrections To The Initial Proposal

These points are mandatory because the generic manual is not proof of the
installed Langmuir drive configuration:

1. The generic T3A/T3L manual describes `SRDY` as healthy/ready and `ALM` as
   active when an alarm occurs. Do not assume both signals are energized when
   healthy. Programmable output assignment and polarity must be read from the
   installed drive and proved with a meter.
2. `PD5 TX / PD6 RX` is the board map's candidate USART2 path. It is not an
   approved servo connector and is not active in the production firmware.
3. T3A/T3L register addresses and parameters are reference candidates only.
   The outside label, hidden model, software version, motor nameplate, complete
   parameter archive, and stock connector continuity must match an approved
   profile before even read-only Modbus is promoted.
4. Motor encoder A/B/Z is not yet assigned to STM32 timer pins. The differential
   line receiver, isolation method, timer channels, interrupt load, and every
   collision with the current board map require a separate audit.
5. The official MR-1 ratio is two spindle revolutions per motor revolution.
   Motor Z therefore does not provide one unambiguous index per spindle turn. A
   spindle-side index is required before orientation or belt-slip claims.
6. `M19` and rigid tapping are not commissioned features. This checkout still
   rejects `G33.1`, and production exposes no spindle sync. A separate XYZA +
   Y2 target now qualifies the different coordinated-servo-axis method; it does
   not turn the unfinished hook into an implementation. See `RIGID_TAPPING.md`.

## Intended Architecture

```text
gSender / grblHAL command owner
          |
          +-- current isolated analog command + enable
          |      (commissioning and rollback fallback)
          |
          +-- final custom servo plugin
                 -> isolated USART2 Modbus RTU
          +-- qualification-only MOTOR4 pulse/direction -> servo position mode
          +-- future isolated 12-24 V drive I/O
          +-- future isolated differential motor A/B/Z
          +-- future isolated spindle-side index
          |
          +-- MR1SP read-only reports --> loopback bridge --> mr1-control

E-stop / guard / cabinet safety / hardware watchdog
          |
          +-- hardwired spindle permission, independent of Windows and USB
```

The browser remains read-only. It has no route to `M3`, `M5`, `S`, alarm reset,
servo enable, drive parameters, or adaptive feed.

Only one speed-command authority may be selected at a time. The final interposer
must use reviewed break-before-make selection so an analog voltage and a digital
setpoint can never compete for the drive.

## Digital Command Contract

The target command path is `M3/M4/M5/S -> grblHAL -> custom servo plugin ->
isolated RS-485 -> installed drive`. It is not a generic VFD profile.

- `S0..S8000` is spindle RPM. With the official nominal 2:1 overdrive, the
  candidate motor magnitude is `S / 2`, or 0..4000 motor RPM. That conversion
  remains nominal until pulley teeth and tachometer results are archived.
- `M3` selects the physically proved normal direction. Its motor sign is blank
  in the pending profile and may not be guessed from a generic manual.
- `M4` selects the opposite sign only after Stage 8 proves pulley, spindle,
  collet, tool-retention, drive, and stopping behavior in reverse.
- `M5` commands zero, waits for independently proved zero-speed status, then
  removes normal servo permission. An emergency stop remains a separate
  hardwired safety action.
- Cutting feed is not released until verified at-speed status is true.
- Generic monitor address `0x000E` is a readback candidate, not an implied
  runtime speed-write register. A write exists only after it appears in the
  installed-drive whitelist.

RS-485 latency does not close the motor loop. The stock drive continues to close
its fast encoder loop internally; Modbus carries supervisory setpoints and
status.

## Required Interface Channels

| Channel | Purpose | Current status |
| --- | --- | --- |
| Isolated analog command | Phase-one 0-5 V speed command and rollback path | Production design baseline |
| Isolated enable contact | Forward-only normal spindle request | Active design baseline |
| Isolated USART2 | Final digital command/monitor path on candidate PD5/PD6 | Locked pending identity |
| Isolated drive inputs | SRDY, ALM, ASP, ZSP, COIN/PtoS after assignment proof | Locked |
| Isolated drive outputs | SON, candidate CMODE, guarded ACLR | Locked |
| Isolated differential receiver | Motor OA/OB/OZ | Locked; pins/timers unassigned |
| Spindle-side index | One pulse per physical spindle revolution | Locked; sensor unselected |
| Isolated MOTOR4 pulse/direction | Qualification A-axis position command | Source allocated; hardware locked |
| Hardware watchdog | Remove normal servo permission on controller heartbeat loss | Required before SON control |

The interface must preserve galvanic separation between controller logic,
servo signal common, probe/tool-setter field supply, analog command, and
protective earth. Encoder outputs described by the generic manual are
non-isolated 26LS31/RS-422-equivalent signals and must never be landed directly
on STM32 GPIO.

The stock harness must be removable and reinstallable. Do not cut it to create
the retrofit.

## Hardwired Permission

Software may request the spindle, but it may not grant permission by itself.
The final circuit must require all applicable safety contacts, cabinet health,
the hardware heartbeat, and the controller request before SON can be asserted.
Loss of Windows, USB, grblHAL execution, heartbeat, safety permission, or field
power must remove normal spindle permission without relying on a browser event.

Emergency stopping remains a separate risk-assessed electrical function. A
normal `M5` should request controlled deceleration and confirm stopped state;
an E-stop follows the validated stop category and circuit design for the real
machine.

## Locked Drive Profile

`servo-profile.pending.json` is intentionally unusable for control:

- Physical Octopus and MCU identity are unverified.
- Installed drive, hidden model, motor, and software identity are blank.
- Parameter and connector-continuity archive hashes are blank.
- Generic reference registers are all marked unapproved.
- The write whitelist is empty.
- The selected architecture is digital first, but dual analog/digital command
  authority is forbidden and both M3/M4 motor signs are blank.
- Read-only Modbus, writes, SON, reverse, position mode, orientation, rigid
  tapping, and automatic adaptive feed permits are all false.
- The production firmware reports Modbus disabled.

An approved profile must be generated from captured evidence. It must have a
deterministic fingerprint and a reviewed alarm/output-polarity map. Firmware
must reject a missing or mismatched fingerprint; a source edit or successful
compile is not commissioning evidence.

## Read-only Telemetry Contract

The Windows bridge recognizes versioned controller reports framed as:

```text
[MR1SP|V:1|ST:running|MODE:speed|CMD:7200|...]
```

The parser accepts only documented field names, rejects duplicates, bounds
every number, requires exact `0`/`1` booleans, limits frame length, and rejects
unknown protocol versions. Invalid reserved reports produce a visible protocol
error and are not converted into telemetry.

The screen keeps these RPM sources separate:

- Controller commanded RPM.
- Controller-reported actual RPM, when available.
- Motor RPM read from the drive.
- Spindle RPM calculated from the verified mechanical ratio.
- Direct encoder-derived spindle RPM.

It also has bounded fields for torque, current, peak current, average load,
regenerative load, SRDY/ALM/SON/ASP/ZSP/COIN/PtoS, communication ages, error
count, ratio, disagreement, and alarm code. Missing data is `--`; it is never
filled from a plausible default.

If spindle packets stop for two seconds, spindle-specific values clear and the
source becomes `SPINDLE STALE`. A new alarm edge freezes the preceding five
seconds, up to 500 samples, including RPM, load, feed, controller line, chatter,
frequency, and vibration. Alarm text remains numeric until the installed-drive
profile owns a verified code table.

## Future Control State Machine

The future plugin must use an explicit state machine rather than translating
`M3` directly into a register write:

```text
DISABLED -> COMMS_SYNC -> DRIVE_READY -> COMMAND_STAGED
         -> SON_ASSERTED -> ACCELERATING -> AT_SPEED -> RUNNING
         -> DECELERATING -> ZERO_SPEED -> SON_REMOVED
```

Any stale communication, drive alarm, safety-permission loss, impossible mode,
RPM disagreement, or invalid profile enters `FAULT`, inhibits further motion,
removes normal servo permission as designed, and requires intentional recovery.

Normal start may release cutting motion only after independent at-speed proof.
Normal stop commands zero, maintains normal enable during controlled
deceleration when the validated drive configuration permits it, confirms zero
speed, and then removes enable. Acceleration, deceleration, braking-resistor,
and regenerative-load parameters remain unchanged until measured.

## Commissioning Gates

| Stage | Scope | Promotion requirement |
| ---: | --- | --- |
| 0 | Identity and archive | Board/MCU, drive labels, hidden model, motor, software, all parameters, CN1/CN3 continuity, analog behavior, pulley teeth |
| 1 | Isolated USB-RS485 read-only discovery | SON physically unavailable; monitor values agree with drive display; raw transcripts saved |
| 2 | Octopus read-only Modbus | Isolated PD5/PD6 interface; no write/enable permits; timeout, CRC, wrong-slave, stale-data tests pass |
| 3 | Hardwired I/O proof | SRDY/ALM polarity, SON permission, E-stop/guard/watchdog dropout, reset/no-restart tests pass |
| 4 | One whitelisted runtime speed write with rotation blocked | Write/readback/zero/reset behavior proved; EEPROM save still forbidden |
| 5 | Lowest practical controlled rotation | Direction, tachometer, M5, communication-loss response, braking behavior pass |
| 6 | Motor encoder and spindle index | Scaling, direction, timer integrity, ratio, index, and disagreement tests pass |
| 7 | Digital M3/M5/S | Custom plugin, whitelisted runtime speed command, at-speed gate, zero-speed stop, feed-hold, abort, USB loss, Modbus loss, alarm, and sensor-disagreement tests pass |
| 8 | Digital M4 and orientation | Reverse mechanical-retention review plus direction proof; CMODE/PtoS/COIN, differential position command, and guarded M19 tests pass separately |
| 9 | Advisory intelligence | Repeatable load/vibration baselines and bounded recommendations; automatic feed remains separately locked |

Each stage has low-energy test conditions and retained evidence. Nothing becomes
`NOW` because a dashboard value moves or firmware compiles.

## M19 And Rigid Tapping

Position/speed mode in the generic manual makes orientation technically worth
investigating, not currently available. Stage 8 requires an approved drive
identity, verified mode assignment/polarity, differential pulse/direction
hardware, electronic gearing calculated from measured counts and ratio, a
spindle-side index, and a guarded state machine.

The production `G33.1` encoder-follower path is still a later controller
project and remains locked even after M19 succeeds. AcornSix/CNC12 Mill Pro is
the conservative Windows option when a vendor-documented `G33.1` cycle and
direct spindle encoder input are the deciding requirements.

The Octopus now has a second, technically distinct path: switch the drive into
position mode, represent the spindle command as rotary A on MOTOR4, and
coordinate A and Z in one `G93` trajectory. That target builds and its timing
and reversal invariants pass static validation. It is still a development path
until the actual drive, mode switching, electronic gearing, reverse mechanics,
following alarms, closed-loop Z, scope captures, disconnect behavior, and
material tests pass all 23 gates. No M19 success, dashboard value, or firmware
build grants that permit.

## Primary References

- [Langmuir MR-1 spindle design](https://www.langmuirsystems.com/mr1/spindle)
- [Langmuir MR-1 build/specification page](https://www.langmuirsystems.com/mr1/build)
- [BIGTREETECH Octopus Pro repository](https://github.com/bigtreetech/BIGTREETECH-OCTOPUS-Pro)
- [grblHAL STM32F4 Octopus Pro map](https://github.com/grblHAL/STM32F4xx/blob/master/boards/btt_octopus_pro_map.h)
- [Generic T3A/T3L servo manual](https://www.hlt-cnc.com/uploads/38006/files/T3A-T3L-Servo-driver-instruction.pdf)
- [grblHAL core](https://github.com/grblHAL/core)
- [Centroid Acorn rigid-tapping bulletin](https://www.centroidcnc.com/centroid_diy/downloads/acorn_documentation/acorn_rigid_tapping_parameters.pdf)
- [LinuxCNC G33.1 reference](https://linuxcnc.org/docs/stable/html/gcode/g-code.html#gcode:g33.1)

Community retrofit findings remain useful discovery leads, but installed-machine
measurements and primary documentation control every wiring and parameter
decision.

## Installed drive identified - 2026-09-20

Field photographs of the installed drive show a connector layout matching the
**T3A/T3L servo family**, and the owner's copy of that manual matches the
physical part:

| Feature | Observed |
| --- | --- |
| `CN1` | DB44 high-density D-sub |
| `CN2` | smaller D-sub (encoder) |
| `CN3` | RJ45 |
| Power terminals | `R` `S` `T` 220 VAC, `PE`, `P`, `BK` |

`P`/`BK` are the regenerative brake terminals; `R`/`S`/`T` is the 220 VAC input.

**Confirm against the drive's own nameplate before this is treated as settled.**
The connector match is strong evidence, not a serial number.

### CN1 (DB44) pin assignments - now from the manual, not hypothesis

`MR1_GITHUB_CROSSCHECK.md` previously held these as "useful continuity-test
hypotheses only". The manufacturer manual section 2.4 confirms them:

| Function | Signal | DB44 pin | Previously |
| --- | --- | --- | --- |
| Analog speed + | `AS+` | **26** | hypothesis - confirmed |
| Analog speed - | `AS-` | **10** | hypothesis - confirmed |
| Analog ground | `GNDA` | **11** | not recorded |
| Servo on / enable | `DI1` `SON` | **16** | hypothesis - confirmed |
| IO input common | `COM+` | **31** | hypothesis - confirmed |
| IO output common | `DO COM` | **23** | hypothesis - confirmed |
| Ready | `DO1` `RDY` | 20 | not recorded |
| Alarm | `DO2` `ALM` | 5 | not recorded |
| In position | `DO3` `COIN` | 21 | not recorded |
| Brake | `DO4` `BRK` | 6 | not recorded |
| Encoder A | `OA+` / `OA-` | 13 / 28 | not recorded |
| Encoder B | `OB+` / `OB-` | 14 / 29 | not recorded |

`COM+` (31) is externally provided DC 24 V per the manual note.

Continuity proof on the installed harness is still required - these are the
drive's pin functions, not proof of what the stock cable actually lands on.

## BLOCKER: the analog command range does not match the interface design

**The drive's analog input is `0~10V` or `-10V~+10V` full scale.** This project
specifies an **isolated 0-5 V** command (`Inc/mr1_octopus_config.h:143`,
`BOM.md`, `WIRING.md`).

A 0-5 V command into a 0-10 V input reaches **half scale**. With
`DEFAULT_SPINDLE_RPM_MAX 8000.0f`, commanding 8000 RPM would deliver roughly
**4000 RPM**, and every programmed speed would be halved - silently, with no
alarm and no error.

Three ways out, to be decided before the analog stage is built:

1. **Scale the drive.** T3A/T3L-class drives expose an analog gain parameter
   (RPM per volt). Setting full scale to 5 V makes the existing 0-5 V design
   correct. Preferred, but the parameter must be found, recorded and archived.
2. **Build the interface for 0-10 V** instead, and revise the PWM-to-analog
   stage specification throughout.
3. **Halve the configured maximum** to 4000 RPM and accept losing the top half
   of the spindle range. Not recommended.

Until one is chosen and verified against a measured spindle speed, no spindle
speed claim in this project is trustworthy.

## Stock controller spindle interface - `J10`

The Langmuir board's spindle connector is silkscreened:

| Pin | Label | Function |
| --- | --- | --- |
| 1 | `COM` | common |
| 2 | `SSPD` | spindle speed command |
| 3 | `+24V DRV` | 24 V to drive |
| 4 | `0V DRV` | 24 V return |
| 5 | `SPEN` | spindle enable |

This is the interface the Octopus replaces: an analog speed command, an enable,
and a 24 V field pair. It maps onto the DB44 assignments above - `SSPD` to
`AS+`/`AS-`, `SPEN` to `DI1 SON` with `COM+` as its return.

**Meter the stock harness before reusing it.** The silkscreen names the board's
intent; it does not prove which DB44 pin each conductor reaches.
