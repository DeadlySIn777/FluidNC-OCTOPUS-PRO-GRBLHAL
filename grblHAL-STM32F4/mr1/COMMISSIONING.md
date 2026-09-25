# MR-1 Commissioning Procedure

> Current release note: use the project's own Windows native application and the corrected wiring references. This inherited staged hardware procedure is an engineering checklist; no stage is recorded as passed. Both `$N0` and `$N1` must be present and empty before motion qualification. No binary is distributed by this source-only release. Older generic sender or interface assumptions do not override the current HOLDs.

Work through this document in order. Do not skip ahead because a subsystem
appears simple. Every stage ends at a hold point and should have dated records,
photos, meter readings, settings exports, and any deviations.

## Required Test Equipment

- CAT-rated multimeter appropriate to the circuits being measured.
- Two-channel oscilloscope with suitable probes and isolation practices.
- Current-limited bench supplies for 5 V and 24 V work.
- Insulation/continuity tester appropriate to the selected interface components.
- Clamp meter or inline DC current measurement for drive branches.
- Hand tachometer for spindle verification.
- Dial test indicator, magnetic base, gauge blocks, and a reliable travel standard.
- Calipers/micrometers for shafts, pilots, and couplers.
- Lockout/tagout equipment and a second person for the first energized tests.

Never use an earth-referenced oscilloscope ground clip on an unknown servo,
mains, floating analog, or DC-bus node. Review the instrument connection first.

## Stage 0: Preserve and Survey

1. Back up the stock controller software/settings and photograph every stock enclosure connection.
2. Label both ends of every cable before disconnecting it.
3. Record the MR-1 serial/version, all four stock home connectors, probe and tool-setter revision, servo drive model, and DB44 cable population.
4. Photograph the Octopus top, bottom, MCU marking, crystal, and v1.1 silkscreen.
5. Measure all four motor mounts, screw shafts, stock couplers, and available connector bend radius.
6. Verify frame, spindle chassis, cabinet, and incoming PE continuity.
7. Draw the actual E-stop chain and have its safety design reviewed. This is a
   blocking HOLD before the cabinet is energized with any drive, spindle or
   coolant load connected. The reviewed design must remove 240 VAC
   spindle-servo energy on E-stop (rated mains contactor on the servo supply
   and/or certified safe-torque-off; `SON` dropout is not the E-stop function),
   remove 36 V motion power with a Z-drop analysis for the de-energized state,
   put the flood pump and mist/air solenoid supplies in the hardwired stop
   chain, set stop category and restart prevention from the risk assessment,
   and include a complete terminal schedule. See `WIRING.md`, "Scope and Safety
   Boundary".

**Hold point:** no conversion wire is cut until the stock system can be restored
from the labels and photos. No cabinet supply is energized with a load connected
until the reviewed stop design in item 7 exists.

## Stage 0A: Bare-Board USB-Only Firmware Flash

Do this before installing the Octopus in the cabinet. The only required items
are the positively identified bare board, one FAT32 microSD card, one known
data-capable USB-C cable, the Windows PC, and the small jumper cap supplied with
the board. No 24 V supply is used.

1. Prove the board silkscreen says `OCTOPUS PRO V1.1`, the MCU says
   `STM32F429ZGT6`, and the crystal is 8 MHz. Photograph all three.
2. Put the board on a dry, nonconductive bench. Remove `MAIN POWER`, `MOTOR
   POWER`, `BED POWER`, every driver/adapter, every I/O plug, and USB. Nothing
   from the MR-1 may be connected.
3. With USB disconnected, fit one jumper only at the MCU USB-power location
   outlined in red in BIGTREETECH's official USB-power image. Do not touch the
   separately marked `BOOT0` header.
4. Use the production candidate from
   `mr1-control/public/firmware/octopus-pro-v1.1-f429-mr1/firmware.bin`, or the
   clean build at `.pio/build/btt_octopus_pro_f429_mr1/firmware.bin`. Confirm it
   is 221,304 bytes and its SHA-256 is
   `F4AB32BD2CB7D0985A07915CF1C4349A3A7FD8546C765265B23EB98B904E5E9D`.
   In the Windows console, open `Wiring > FLASH > VERIFY THE ACTUAL FILE`, select
   that local `firmware.bin`, and require `SOURCE VERIFIED / EXACT MATCH` before
   placing it on the card. The check runs locally and does not upload the file.
5. Format the microSD as FAT32. Put only the candidate at the card root under
   the exact name `firmware.bin`; make sure Windows did not create
   `firmware.bin.bin`.
6. Insert the card, then connect USB-C. USB insertion powers the MCU and lets the
   stock BTT SD bootloader process the image. Do not press BOOT0 or run a DFU
   utility.
7. Wait for boot, disconnect USB, remove the card, and inspect it on the PC.
   Success requires the bootloader to rename the file to `FIRMWARE.CUR`. If
   `firmware.bin` remains, stop and correct the board identity, card, or filename.
   Select the card's actual `FIRMWARE.CUR` in the same verifier and require
   `CARD RESULT VERIFIED / EXACT MATCH`; a manually renamed file is not evidence.
8. With the card removed and the MCU USB-power jumper still fitted, reconnect
   USB. Save the complete `$I+` and `$$` reports before changing settings.
9. Only after the identity is exactly the F429 MR-1 production profile, issue
   `$RST=*` once, reconnect, and save the new `$I+` and `$$` reports. Run the
   read-only `tools/mr1_preflight.ps1` audit and require `PASS`.
10. Disconnect USB. Remove the temporary MCU USB-power jumper before the board
    is installed or any future 24 V `MAIN POWER` connection is made.
11. Reconnect only for the final read-only physical preflight if needed, then
    complete all four FLASH attestations. Download the sealed flash record only
    when the UI shows `4 OF 4`. The preflight must come directly from this serial
    controller within 15 minutes, match profile `btt_octopus_pro_f429_mr1` and
    all 66 settings (including `$13=0`) with no warning/blocker, report clear inputs, and show
    `Idle` or `Alarm`. Simulation, cached reports, and wrong profiles are
    rejected. Archive the JSON beside the photographs and reports, then
    disconnect USB again.

USB power does energize the board's low-voltage logic and LEDs. It does not make
the board electrically dead. The procedure is safe from unintended machine
motion only because every load and every machine cable is physically absent.

**Hold point:** archive the board photographs, candidate SHA-256,
`FIRMWARE.CUR` photograph, first and post-reset reports, preflight result, and
sealed flash record. The record is evidence, not authorization; physical machine
motion remains prohibited.

## Stage 1: Panel Power-Off Inspection

Install the supplies, safety relay, contactors, fused distribution, Octopus,
DM860Ts, interface prototype, PE hardware, and terminal blocks without connecting
motors, spindle control, probe, tool setter, coolant, or USB.

Verify against `WIRING.md` and `cable-schedule.csv`:

- Octopus `MAIN POWER` is on the 24 V domain only.
- Octopus `MOTOR POWER` and `BED POWER` are empty.
- DM860T power comes from four independent 36 V star branches.
- Every drive face says `DM860T(V3.0)` and has `SW1-SW10` plus top selector `S2`.
- Every drive includes the supplied six-position P1, four-position P2, and six-position P3 removable blocks.
- All four DM860T `S2` selectors say `5V` before signal wiring.
- `SW1-SW3` remain a hold point until stock-motor or original-driver current evidence is recorded.
- No plug-in motor drivers or mode/voltage jumpers occupy MOTOR0-MOTOR3.
- One driver-socket adapter and each low-voltage housing have passed pitch, key, latch, pin-1, insertion, and pull tests on the actual v1.1 board.
- Safety contacts physically interrupt motion energy and spindle permit.
- The safety-relay monitor, not an E-stop channel, goes to PF3. It is a contact
  that is closed while the relay is energized and open on E-stop/trip (a spare
  NO safety output or NO auxiliary), not an NC auxiliary.
- Probe isolated return has no continuity to controller ground, frame, spindle, or PE.
- Analog spindle return has no continuity to controller ground unless the final verified interface intentionally requires it.
- Shields and PE terminate as designed; no shield is used as a current return.
- Every terminal and cable has its permanent ID.

Perform the power-off continuity rules in `WIRING.md` and sign the results.

**Hold point:** second-person wiring check complete; all field plugs still removed.

## Stage 2: Octopus-Only 24 V Rail and Soak Test

This is the first 24 V test, not the firmware-flashing method. The temporary MCU
USB-power jumper from Stage 0A must be absent. Do not fit simulated healthy-state
input plugs yet; open inputs and alarms are expected while every field harness
is absent.

1. Lock out 36 V motion power and leave all four branch fuses disconnected.
2. Remove every FAN/heater output plug, driver-socket adapter, input plug, and
   stock MR-1 cable from the Octopus.
3. Meter the 24 V supply polarity at the unplugged `MAIN POWER` connector.
4. Connect only `MAIN POWER`, then energize the 24 V control supply through a
   current limit or small test fuse.
5. Confirm the board's 5 V and 3.3 V rails, input current, and temperature before
   connecting USB.
6. Connect USB to the Windows mini PC and select grblHAL explicitly in the
   sender. Do not run `$RST=*` again.

Capture these reports before changing anything:

```text
$I+
$$
$pins
$PINSTATE
```

`$pins` or `$PINSTATE` may be absent depending on the exact core/driver build;
the extended `$I+` and `$$` reports are mandatory.

Compare the reports with the archived Stage 0A evidence. Confirm at minimum:

- Board string identifies the BTT Octopus Pro v1.1 MR-1 profile.
- Three logical axes are reported.
- Primary probe and tool setter are both available.
- X, Y, and Z motor-fault monitoring is enabled.
- Steps/mm are 320, 320, and 533.333333.
- Max rates are 2540, 2540, and 1016 mm/min.
- Homing, hard limits, soft limits, and homing-on-start lock are enabled.
- Probe target clamping is enabled with `$65=2`.
- Dual-Y failure settings are `$347=1`, `$348=2.5`, and `$349=8`.
- Jog clamping, parking, and sleep are off (`$40=0`, `$41=0`, `$62=0`).
- Clearing E-stop still requires an explicit unlock (`$484=1`).
- Tool-change mode `$341` is `0`.

Close the sender and rerun the passive Windows audit with the actual COM port:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tools\mr1_preflight.ps1 -Port COM3
```

Require a `PASS` result and archive its text and JSON files. The script is
read-only; a mismatch must be investigated, not automatically overwritten.

**Hold point:** no unexpected reset, rail heating, USB drop, or configuration
mismatch during a one-hour 24 V board-only soak. Disconnect USB before removing
24 V or touching any connector.

## Stage 3: Input Truth Tables

Keep 36 V, spindle control, coolant, and motor cables disconnected. Enable pin
state reporting in the sender if necessary. Test one input at a time and record
idle, actuated, and disconnected states.

### Conditioned Stock Home Inputs

**Gate 0 - bench-verify the TLP281-4 module before it touches the machine.**
These modules vary between vendors and some invert. With the module on the bench
and the field side powered, jumper each input in turn and meter that output
against output ground:

- Input active gives `OUT` near 0 V, input released gives `OUT` high: **correct**.
- Input active gives `OUT` high, input released gives `OUT` low: **inverted and
  unusable as wired.** A cut cable would present the same level as a healthy
  machine, and no firmware invert setting repairs that because both states would
  read identically. Stop and re-derive the channel.

Record the measured pair of voltages for all four channels. Confirm the module's
output-side `VCC` is **unconnected** - if that rail is fed 5 V the outputs rest
at 5 V and will damage a 3.3 V Octopus input.

Then record the stock limit-bus supply, return, and all four signal voltages
with the factory controller disconnected. Confirm each of the four signals is
**independent** - in particular that Y-left reads independently of Y-right, since
gantry squaring depends on it. Confirm the field side remains isolated from
Octopus logic and that no STOP signal can exceed 3.3 V. Then test
X, Y-left, Y-right, and Z through the module:

1. Healthy switch, cable, and field power: input must be low/inactive.
2. Switch actuated: only the expected input becomes high/active.
3. Cable unplugged: same high/active state as actuation.
4. Home-field power removed: all affected channels become high/active.
5. Adjacent cable movement and relay switching: no flicker.

### NC Dry-Contact Inputs

For door, E-stop monitor, and feed hold:

1. Healthy contact closed: input must be inactive.
2. Contact actuated/open: only the expected input becomes active.
3. Cable unplugged: same active state as actuation.
4. Adjacent cable movement: no flicker.

E-stop monitor (PF3) specifically, with the safety relay wired and energized:

- Relay energized and chain healthy: `Pn:` must not contain `E`.
- Press each E-stop device: PF3 must read E-stop (`Pn:` includes `E`).
- Release and reset the safety chain: `E` clears from `Pn:`; the alarm still
  requires an explicit `$X` (`$484=1`).
- Unplug the monitor wire at PF3: must read E-stop.

If a healthy relay reads E-stop, or a pressed E-stop reads healthy, the wrong
contact is wired (typically an NC auxiliary). Fix the wiring. **Never invert
`$14` to "fix" it**; that makes a broken monitor wire read healthy.

Hard-limit tests will create an alarm. Clear the physical condition, reset, and
unlock only after confirming the reported axis.

### Cycle Start

Open is inactive; pressing the guarded NO button is active. It is the only
operator input with this truth table.

### Probe Inputs Without Motion

Select and observe each input separately:

```text
G65P5Q0
G65P5Q1
G65P5Q0
```

For each selection, verify released, triggered, cable-disconnected, and cable-
flex behavior. A disconnected stock sensor is expected to remain untriggered
with this active-low scheme, so probe continuity is an operational preflight
check rather than a fail-safe E-stop. The interface must never indicate a
trigger on the other sensor.

Repeat at least 50 manual actuations per sensor. Reject intermittent or sticky
behavior before any `G38` move.

### Drive and Aggregate Faults

Use the interface simulator/test jumper, not a live motor fault yet:

- Four ready channels low: no motor fault.
- Open X, YL, Z, then YR one at a time: the expected axis fault is reported.
- Remove alarm-interface field power: a fault is reported.
- Open PB1 aggregate fault: a cabinet/spindle fault is reported.

**Hold point:** saved truth table contains no ambiguous, coupled, or noisy input.

## Stage 4: Output and Interface Bench Tests

No stock spindle, coolant load, or motor may be connected.

### Motion Signals

Attach the real DM860T input optocouplers or equivalent loads, with DM860T motor
power still off. Scope every PUL, DIR, and ENA pair.

- The Octopus socket side switches between logic low and its buffered 5 V high; it is not treated as raw 3.3 V GPIO.
- Pulse width is at least 5 us.
- Direction changes precede the first pulse by at least 6 us.
- Low input voltage while sinking is below 0.5 V.
- PUL/DIR/ENA current remains within the DM860T V3 7-16 mA specification.
- Idle channels do not chatter during USB traffic, relay switching, or reset.
- Controller/safety power loss forces the panel's hardware `FORCE_DISABLE` or removes motion power.

### Spindle Analog Dummy Load

With the converter output disconnected from DB44, command and measure:

| Command | Ideal output for 0-8000 rpm scaling |
| --- | ---: |
| `M5` | 0.000 V |
| `M3 S500` | 0.3125 V |
| `M3 S1000` | 0.625 V |
| `M3 S4000` | 2.500 V |
| `M3 S8000` | 5.000 V |

Confirm output returns to 0 V on `M5`, reset, E-stop monitor opening, USB
disconnect, and 24 V power loss. USB behavior is diagnostic only; the hardwired
safety path must independently prevent spindle enable.

### Relay Outputs

Use lamps or test loads. Verify spindle enable, flood, and mist/air each operate
only its named output and remain off at boot/reset. Check flyback waveform and
contact state with output power removed.

**Hold point:** scope captures and voltage table pass before any field load is plugged in.

## Stage 5: One Loose Phase-One Axis

Start with X. Clamp the motor securely with no coupler attached.

1. Confirm the drive is **V4.1** (rotating `S1`, top `S3`, `P5` port present), set `S1`=`4`, `SW1`-`SW4`=`on/off/on/on`, `SW5`-`SW8`=`off`, and `S3`=`5V` per `CL57T_QUICK_WIRING.md`, and photograph every switch. Power must be off; settings are read at power-up.
2. Connect the kit motor extension to `P3` (`A+ A- B+ B-`) using the kit's own GX16 lead. Verify both coil pairs with an ohmmeter; never assign phases by wire color.
3. **Connect the encoder extension to `P2`.** Never energize a CL57T with the motor or encoder disconnected - alarm code 4 is "fail to lock motor shaft". `P2 VCC` is a drive output; do not feed it from any field supply.
4. Verify phase-pair continuity and no phase-to-frame short.
5. **Meter the 36 V branch before landing it**, in DC and in AC mode, with all four branches disconnected. Accept only DC, under 40 V unloaded, no AC component. Record the reading.
6. Land `P4` with **verified polarity**: `+VDC` to supply positive, `GND` to negative. There is no no-polarity pair on this drive.
7. Insert only the X 36 V branch fuse and energize the safety permit.
8. Confirm **steady green LED, red LED off**, shaft hold, and reasonable idle current. A blinking red LED is an alarm - count blinks in the 3-second period and read manual S8.
9. Jog 0.1 mm, then 1 mm at the lowest practical feed.
10. Confirm DIR level changes and rotation reverses predictably. Correct direction in `DEFAULT_DIR_SIGNALS_INVERT_MASK` rather than `SW5`, so all four drives stay identically configured; record whichever you use.
11. Command repeated equal reversals and verify the shaft returns to its witness mark. **Under closed loop this no longer tests what it used to.** An open-loop drive that lost steps would return short of the mark silently; a CL57T corrects the error internally and raises `ALM` instead. So this step now verifies *mechanical* behavior only - stall, resonance, binding, backlash. **Position loss is tested at step 12, not here.** Do not read a clean witness-mark return as evidence that no following error occurred.
12. **Closed-loop position-integrity test.** With the axis uncoupled, run repeated full-travel reversals at increasing feed while watching for any `ALM` assertion. A following error that the drive corrects is still a following error, and it is the drive's own report - not the witness mark - that detects it. Record the highest feed that completes with no alarm; that is the evidence for any later rate increase.
13. Remove the alarm cable and verify the controller faults. Then remove that drive's branch power and verify the controller faults again. Both must trip through the PB1 series chain - see `WIRING.md` "Drive Fault Inputs".

Repeat for Y-left, Z, and Y-right one at a time. Record idle/running current,
drive temperature, motor temperature, noise, and fault behavior.

**The two Y drives must end identically configured.** `SW5`-`SW8` in particular
must match exactly: Y-left and Y-right drive one gantry through two ballscrews,
and a mismatched pulse-filter setting makes the two sides respond to the same
step train with different lag, racking the gantry. Photograph both switch faces
side by side as the evidence.

The stock motors and DM860Ts are open-loop. There is no motor-encoder cable or
following-error test in this phase; those checks return with the CL57T upgrade.

**Hold point:** all four loose axes pass independently.

## Stage 6: Direction and Ganged-Y Proof

Keep both Y motors uncoupled from the machine but powered together.

1. Mark both shafts visibly.
2. Jog positive Y at low speed.
3. Determine which physical shaft rotations would move both sides of the gantry toward machine-positive Y.
4. Correct motor rotation by changing one firmware inversion setting or, with all power removed, reversing one complete coil polarity. `SW5` is a DM860T microstep switch and must not be used as a direction control.
5. Use `$3` only to establish logical machine direction.
6. Use `$8` ganged-axis inversion only to correct the second Y motor relative to the first.
7. Record final motor-phase polarity, `$3`, `$8`, and the unchanged DM860T switch map in the commissioning log.

Never couple both Y motors until a positive command has been proven to move both
sides in the same linear direction. Opposite shaft rotation can be correct on
mirrored mechanics; same shaft rotation is not the acceptance criterion.

## Stage 7: Mechanical Installation

1. Fit measured zero-backlash clamp couplers without forcing either shaft.
2. Indicate bracket/pilot alignment and correct it mechanically rather than through coupler flex.
3. Maintain the coupler manufacturer's shaft gap and clamp engagement.
4. Turn the screw by hand through safe travel before energizing the drive.
5. Check the stock motor connector and cable bend radius at both travel extremes.
6. Install splash covers, strain relief, drip loops, and bonded connector shells.
7. With drive power off, verify no coupler contact or axial preload.
8. Move each installed axis only 0.1 mm, then 1 mm, then 10 mm at low speed.

For Y, test one motor-coupler installation at a time with the gantry supported,
then both together. Stop immediately on racking, binding, or diverging position.

## Stage 8: Homing and Auto-Squaring

Place both Y home switches close enough that one side cannot rack the gantry
significantly while the other searches. Keep initial seek rate low and a tested
E-stop within reach.

1. Manually position every axis away from its switch.
2. Verify the commanded homing direction from the live DIR signal and a tiny jog.
3. Run `$HZ`; verify Z moves up, trips, backs off, re-approaches, and clears by 2 mm.
4. Run `$HX`; verify X homes left/negative and clears its switch.
5. Run `$HY`; verify both Y motors move rear/positive, each stops on its own switch, and both clear.
6. During the earlier uncoupled/low-energy test, delay one Y switch and verify
   grblHAL aborts after about 5.461 mm of commanded side-to-side mismatch. Do
   not deliberately rack the coupled gantry through the full guard distance.
7. Indicate the gantry square, adjust switch position mechanically, and repeat `$HY`.
8. Run full `$H` and confirm the order Z, X, then Y.
9. Repeat full homing at least 20 times from varied starting points while logging switch repeatability and Y squareness.
10. Unplug each home cable in turn and confirm homing cannot proceed normally.
11. Remove the isolated home-field supply and confirm every affected channel faults before any axis can seek.

Do not raise homing speed until repeatability, pull-off, and maximum possible
racking have been measured. If normal switch separation approaches 5.461 mm,
align the switches mechanically instead of expanding `$347-$349`; change the
guard only from measured evidence and record the reason.

## Stage 9: Scale, Travel, Speed, and Thermal Calibration

### Scale

At low speed, compare commanded travel against a traceable standard over the
longest practical distance. Calculate:

```text
new_steps_per_mm = old_steps_per_mm * commanded_distance / measured_distance
```

Measure both directions and separate scale error from backlash. X/Y should
remain near 320 steps/mm and Z near 533.333333; a large correction means the
driver pulse setting, screw lead, or measurement is wrong.

### Travel

Find actual mechanical limits at crawl speed, then set soft travel with a real
margin. The initial firmware values are 566.42, 546.10, and 154.94 mm, not a
promise that every assembled machine can safely reach those numbers.

### Speed and Acceleration

Increase one axis at a time under no cutting load. Test repeated full-travel
reversals, emergency stops, and return-to-position repeatability. Stop below any
region that causes resonance, drive alarm, excessive bus regeneration,
mechanical impact, or position-loss evidence. Published stock limits remain the
initial cap.

### Thermal Soak

Run a representative dry program for at least four hours. Record cabinet
ambient, each DM860T case, each motor body, 24/36/5 V rails, and connector
temperature every 15 minutes. Follow the DM860T V3 manual's installation and
temperature limits, mount each drive vertically, and add cabinet airflow if the
recorded temperatures do not maintain margin.

## Stage 10: Stock Spindle

Do this only after a qualified review of the retained stock servo installation.

1. With all mains locked out, continuity-map the actual DB44 cable and compare it with the T3 manual.
2. Confirm the installed drive's analog-input scaling and enable polarity from parameters or stock measurements.
3. Connect analog command only; keep the hardware spindle-enable permit open.
4. Repeat the 0-5 V table at the DB44 pins and verify analog return isolation.
5. Connect the software enable relay in series with the hardwired safety contact.
6. Secure the enclosure, remove tooling, and test the hardwired E-stop before rotation.
7. Start at the lowest verified safe command and check rotation, noise, belt tracking, and commanded stop.
8. Compare 500, 1000, 4000, and 8000 rpm commands with a tachometer.
9. Trigger or simulate the verified servo alarm and confirm enable removal plus PB1 reporting.
10. Test E-stop at several speeds and document stop time/distance against the risk assessment.

Do not connect the reported encoder pairs to the Octopus in this phase. They
require a differential RS-422 receiver and a new timer/pin allocation review.
Servo Modbus, direct encoder, spindle index, CMODE, reverse, and orientation are
not extensions of this Stage 10 checklist. They use the separate locked gates
in `SPINDLE_SUPERVISION.md`; the pending profile has no read or write permit.
The final architecture is digital first, but the analog Stage 10 result remains
the rollback baseline. Do not switch command authority until the custom plugin,
isolated bus, whitelist, stop sequence, and break-before-make selection pass
their dedicated stages.

## Stage 11: Coolant and Air

Test relays with their loads disconnected, then connect one load at a time.
Confirm off-at-boot, correct `M7/M8/M9` behavior, contactor suppression, flow,
leak containment, and no input noise while pumps/solenoids switch. Re-run probe,
tool-setter, limit, and USB tests with coolant and air operating.

## Stage 12: Probe and Tool-Setter Motion

Keep automatic tool change disabled: `$341=0`.
Confirm probe soft-limit clamping remains enabled: `$65=2`.
Confirm the inactive automatic tool-setter search remains `$342=3`. This is
total travel from a verified approach point, never permitted penetration past
the expected setter surface.

### Primary Probe

Put a large compliant test target immediately below the probe, use a very short
travel, and keep the feed low:

```text
G65P5Q0
G91
G38.2 Z-1 F10
G90
```

Prove successful contact, already-triggered refusal, no-contact failure, manual
release, and retract. Increase distance/feed only after the short test passes.

### Tool Setter

Mount and tram the setter. Select it explicitly and perform the same short,
compliant test:

```text
G65P5Q1
G91
G38.2 Z-1 F10
G90
G65P5Q0
```

Measure repeatability with a master tool or gauge block for at least 30 cycles.
Record setter X/Y, an upward travel Z, the reference-tool contact MPOS, and that
tool's gauge length measured from a repeatable spindle reference face. For each
dummy current tool, verify the predicted contact calculation:

```text
reference contact Z + current gauge length - reference gauge length
```

Verify a guarded start 2 mm above that prediction, a 3 mm total fine-search
limit, no more than 1 mm travel below the prediction, and a 5 mm final/failure
retract. A double-touch host workflow uses a separate 1 mm pull-off before the
latch contact. Verify 100 mm/min guarded approach, 50 mm/min seek, 10 mm/min
latch, and 50 mm/min retract feeds.

The future host implementation must use separately acknowledged `G38.3` moves
and inspect each `[PRB]` success flag before continuing. First move Z upward to
the recorded travel Z and move XY over the setter. Select the setter before any
downward Z motion and prohibit downward `G0`; the approach to 2 mm above expected
contact is itself a guarded probe move. Treat contact during that approach as a
long/mismeasured tool failure, not as a successful calibration.

Test correctly measured, deliberately long, deliberately short, missing,
already-triggered, disconnected, no-contact, and second-touch-failure cases.
Each failure must retract to the calibrated safe Z, latch an operator alarm,
skip every TLO/WCS write, and restore the primary probe. Do not approve a
streamed macro that queues approach, pull-off, latch, or offset writes before
the preceding result has been validated.

Keep `$341=0`. The current built-in semi-automatic implementation rapids Z to
the stored G59.3 coordinate before it arms the setter probe, so it is outside
this commissioned workflow. Do not enable it as a shortcut.

Treat host command-service enablement as a new controlled baseline. Rerun the
profile, workflow, browser, and Windows preflight audits and archive the result
before enabling host-controlled tool setting.

The probe selection must always be returned to `G65P5Q0` at the end of manual
tool-setter macros. Never test a new macro over a rigid setter with a sharp tool.

## Stage 13: Final Fault Injection

Run each test independently at low energy, then at the highest condition allowed
by the risk assessment:

- Press every E-stop device.
- Open each E-stop channel and monitored-reset path.
- Open the enclosure monitor and any safety-rated guard channels.
- Unplug X, YL, YR, and Z home switches.
- Unplug each DM860T alarm cable.
- Remove power from each DM860T one branch at a time.
- Verify each conditioned alarm input with its bench test fixture; do not create a fault by hot-unplugging a powered motor.
- Open aggregate spindle/cabinet fault.
- Disconnect USB and close the sender unexpectedly.
- Remove/reapply 24 V control power before 36 V motion power.
- Switch coolant, air, contactors, and spindle while watching every input for false events.

Record which stops are hardware safety actions and which are software behavior.
USB loss is never an acceptable substitute for E-stop performance.

## Release Checklist

- [ ] Stock configuration and every conversion revision are backed up.
- [ ] Octopus v1.1/F429 identity is photographed and matches firmware.
- [ ] Pin-map audit and clean firmware build pass.
- [ ] Raw image/vector address and SHA-256 are recorded.
- [ ] PE, isolation, and power-domain tests pass.
- [ ] Safety review and stop tests pass.
- [ ] All four drive faults and cable-open cases pass.
- [ ] Twenty full homing cycles pass without racking or drift.
- [ ] Dual-Y delayed-switch test aborts within the configured failure distance.
- [ ] Scale, backlash, travel margins, and Y squareness are recorded.
- [ ] Four-hour motion thermal soak passes.
- [ ] Every Octopus housing and driver adapter has a recorded fit, pin-1, pull, and continuity test.
- [ ] Stock home healthy/triggered/unplugged/field-loss truth tables pass through the conditioner.
- [ ] Spindle command, tachometer, enable, alarm, and E-stop tests pass.
- [ ] Probe and tool setter each pass electrical and low-speed motion tests.
- [ ] Coolant/air switching causes no false input or USB event.
- [ ] Final `$I+`, `$$`, offsets, DM860T switches/current evidence, and cable schedule are archived.
- [ ] Windows preflight passes and phase-zero macro/workflow tests pass.
- [ ] Covers, labels, guards, strain relief, and cabinet fasteners are complete.

The machine is not released for cutting until every applicable item is signed by
the builder and the person who reviewed the energized wiring.

## CL57T Closed-Loop Conversion

**Superseded 2026-09-17: this is no longer deferred.** The closed-loop kits
arrived before the DM860T phase was ever commissioned, so the machine goes
straight to closed loop and the DM860T drives become the preserved rollback set.
There is no open-loop baseline to re-run from; this *is* the first motion
commissioning.

Use `CL57T_QUICK_WIRING.md` for switches and terminals, and complete
`CL57T_ARRIVAL_CAPTURE.md` before anything is mounted or energized.

Three things this stage list did not previously cover, all of which are now
folded into the per-axis steps above:

- **The motion supply is measured, not assumed.** None of Stages 1, 4-9 or 13
  ever metered it, so this procedure would not have caught an out-of-range bus.
  The CL57T's 50 V ceiling is hard, and the supply is still unidentified.
- **The witness-mark reversal test no longer detects lost steps.** A CL57T
  corrects position error internally and reports it as `ALM`. The check is
  retained for mechanical evidence and a separate closed-loop position-integrity
  test is added beside it.
- **Every encoder cable is connected and strain-relieved before power**, and the
  drive is never energized without motor and encoder attached.
