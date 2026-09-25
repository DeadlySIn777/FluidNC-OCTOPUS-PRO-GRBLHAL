# MR-1 Controller Research Record

Research started: 2026-08-23. Wiring sources last re-audited: 2026-08-26.
Product availability, prices, firmware, and community
findings can change; revisit the links before buying or altering hardware.

## Primary Sources

| Source | Used for |
| --- | --- |
| [Langmuir MR-1 product/specifications](https://www.langmuirsystems.com/mr1) | 23.0/21.8/6.1 in travel, 100/100/40 IPM rates, X/Y ballscrews, Z ACME screw, 2.5 kW 0-8000 rpm servo, machine power requirements, factory probing/auto-squaring capabilities |
| [Langmuir MR-1 build page](https://www.langmuirsystems.com/mr1/build) | Current options, 0-4000 rpm motor, 1:2 overdrive, 0-8000 rpm spindle, and integrated encoder context |
| [Langmuir MR-1 assembly guide](https://www.langmuirsystems.com/mr1/assembly/v2) | Mechanical layout, assembly sequence, and stock subsystem context |
| [BTT Octopus Pro repository](https://github.com/bigtreetech/BIGTREETECH-OCTOPUS-Pro) | Official v1.1 pin changes, 28 V main-power ceiling, 60 V driver-bus warning, bootloader resources |
| [BTT Octopus Pro documentation](https://github.com/bigtreetech/docs/blob/master/docs/Octopus%20Pro.md) | Power inputs, driver sockets, PC5 probe behavior, SD flashing guidance |
| [BTT Octopus Pro v1.1 schematic](https://github.com/bigtreetech/BIGTREETECH-OCTOPUS-Pro/blob/master/Hardware/BIGTREETECH%20Octopus%20Pro%20V1.1-sch.pdf) | GPIO-to-connector verification, stop-input filters/pullups, socket buffers, PWR-DET, and the PB7 five-pin header circuit; no BLTouch device is used |
| [BTT Octopus Pro pin drawing](https://github.com/bigtreetech/BIGTREETECH-OCTOPUS-Pro/blob/master/Hardware/BIGTREETECH%20Octopus%20Pro%20-%20PIN.pdf) | Connector location and pin naming cross-check |
| [grblHAL STM32F4 Octopus Pro map](https://github.com/grblHAL/STM32F4xx/blob/master/boards/btt_octopus_pro_map.h) | Candidate USART2 PD5/PD6 mapping; target support does not approve installed hardware |
| [BTT Scylla product page](https://biqu.equipment/collections/control-board/products/bigtreetech-scylla-v1-0) | 550 MHz H723, four integrated TMC2160 drives, 60 V/4.7 A claim, isolation, communications, grblHAL support |
| [STEPPERONLINE one-axis 3.0 Nm kit](https://www.omc-stepperonline.com/ts-series-3-0-nm-424-92oz-in-1-axis-closed-loop-stepper-cnc-kit-nema-23-motor-driver-1-cl57t-s30a-v41) | Exact motor/driver/cable contents, motor current, frame, length, shaft, encoder |
| [STEPPERONLINE four-axis kit](https://www.omc-stepperonline.com/ts-series-4-axis-3-0nm-424-83oz-in-nema-23-closed-loop-stepper-kit-w-power-supply-4-clts30a-v41) | Bundle alternative; contents and delivered price must be rechecked at checkout |
| [DM860T V3.0 manual](https://www.omc-stepperonline.com/download/DM860T_V3.0_User_Manual.pdf) | Exact V3 face, P1/P2/P3 functions, 5/24 V selector, pulse timing, current/microstep tables, power limits, star wiring, and alarm output |
| [CL57T V4.1 manual](https://www.omc-stepperonline.com/download/CL57T-V41_user_manual.pdf) | 18-50 V limits, 24-48 V recommendation, 5/24 V selector, pulse timing, switch table, current table, star power wiring, alarm output, spacing/temperature |
| [Waveshare ESP32-S3-Touch-AMOLED-1.75 hardware reference](https://github.com/waveshareteam/ESP32-S3-Touch-AMOLED-1.75/blob/main/HARDWARE_REFERENCE.md) | H2 expansion-header power, ground, and GPIO assignments |
| [Analog Devices DS18B20 datasheet](https://www.analog.com/media/en/technical-documentation/data-sheets/DS18B20.pdf) | Sensor supply range, three-wire interface, and 1-Wire electrical requirements |
| [T3A/T3L servo manual](https://www.hlt-cnc.com/uploads/38006/files/T3A-T3L-Servo-driver-instruction.pdf) | Generic Modbus, monitor-register, SRDY/ALM/SON, OA/OB/OZ, CMODE, and position/speed reference; not installed-drive identity |
| [grblHAL core](https://github.com/grblHAL/core) | Current protocol, Windows sender recommendation, settings model, probe/tool-setter and ganged-axis capabilities |
| [gSender repository and releases](https://github.com/Sienci-Labs/gsender) | Current grblHAL support, probing, macros, visualization, job outline, tool-change workflow, diagnostics, and Windows release status |
| [gSender maintenance documentation](https://resources.sienci.com/view/gs-setup-and-layout/?print=print) | Per-COM-port job runtime, customizable maintenance reminders, alarm history, and diagnostic export |
| [grblHAL odometer plugin](https://github.com/grblHAL/Plugin_odometer) | Runtime/distance logging behavior, nonvolatile-storage requirement, and FRAM recommendation |
| Local `grbl` submodule at build time | Exact compiled `G65P5Qn`, `$341`, motor-fault, homing, and named-probe behavior |

## Archived Sources

Vendor documents that wiring decisions depend on are copied into
`_vendor_docs/` so a link rot or a silent vendor revision cannot change what
this project was built against. Re-hash before trusting a local copy.

| File | SHA-256 | Retrieved | Owns |
| --- | --- | --- | --- |
| `CL57T-V41_user_manual.pdf` | `3eec9304c770ff68a5ccbd68f105789edfb35f5c91a9977531a30756a918d7da` | 2026-09-16 | `P1`-`P5` pin names and order, switch tables, pulse timing, supply limits, alarm behavior |
| `BTT_Octopus_Pro_V11-Pin.jpg` | `d360491ad8e1f738b1e784bfd62cc2c0f2b4c396d6cd069b9743d62aab0ee285` | 2026-09-21 | v1.1 connector signal names and order: terminal-block `+`/`-` sense, `STOP_0`-`STOP_7`, `TB`/`T0`-`T3`, `EXP1`/`EXP2`, `PWR-DET`, `Probe`, `HE0`-`HE3`, `FAN0`-`FAN7`, `I2C`, and the `M0DIAG`-`M7DIAG` to `PG6`-`PG15` jumper mapping |
| `BTT_Octopus_Pro_V11-sch.pdf` | `fc3cbb91459f25a697d65f371286316aadd340e90c549f075e7616129b715320` | 2026-09-21 | 18-position `2x9` driver footprint, stop-input filters and pullups, socket buffers |
| `BTT_Octopus_Pro-PIN.pdf` | `4094c18e3b3c8374ea2996799a1baef71e54213a6ba121d2d29e56491d076d10` | 2026-09-21 | Underside silkscreen artwork. Image-only PDF, no extractable text |

The v1.1 pin drawing establishes signal **order** within each connector. It
does not establish which physical end is position 1; that is read off the
underside silkscreen on the board in hand, which is why every low-voltage
connector stays at `FIT CHECK` in `PIGTAIL_SCHEDULE.md`.

## Community and Conversion Sources

These are valuable observations, not manufacturer-controlled drawings.

| Source | Finding used |
| --- | --- |
| [alexphredorg MR-1 LinuxCNC conversion, audited commit](https://github.com/alexphredorg/mr1/tree/a41576f09a4ab597bfe64621c233e439ea8c5e52) | Cross-check only: 5 mm X/Y and 3 mm Z lead, 1600 pulse/rev baseline, separate Y homes in HAL, powered 5 V stock-limit warning, community DB44 hypotheses, and stock probe concerns. Mesa pins/colors are not imported; README conflicts are recorded in `MR1_GITHUB_CROSSCHECK.md`. |
| [Tool setter and touch probe wiring thread](https://forum.langmuirsystems.com/t/tool-setter-and-touch-probe-wiring/36814) | Reported connector pin 1 supply, 2 active-low signal, 3 return; revision/color uncertainty |
| [Touch probe wiring thread](https://forum.langmuirsystems.com/t/touch-probe-wiring/33733) | Additional owner measurements and adaptation context |
| [Tool-setter issue investigation](https://forum.langmuirsystems.com/t/tool-setter-issues-fix/39014) | Coolant intrusion, unintended voltage between setter/spindle, motor leakage observations |
| [Probe-body isolation discussion](https://forum.langmuirsystems.com/t/isolating-probe-body-from-5v/45971) | Reports of exposed conductive sensor surfaces at supply potential |
| [CutControl 25.1.2 release discussion](https://forum.langmuirsystems.com/t/cutcontrol-25-1-2-release/45075?page=2) | Owner reports of long-tool crashes during the preset-height descent, short-tool reach failures, and a 0.500-inch Safe Z floor |
| [March 2026 tool-setter glitch report](https://forum.langmuirsystems.com/t/toolsetter-glitch/47625) | Preset-height/limit failure reported in CutControl 25.1.2; one owner reports a support-provided 25.1.2.4 build fixed that machine's issue |
| [Stock spindle adaptation thread](https://forum.langmuirsystems.com/t/using-an-mr1-spindle-assembly-on-my-machine/35016) | Community DB44 minimum wiring and correction from encoder pin 30 to analog return pin 10 |
| [Closed-loop Centroid conversion](https://forum.langmuirsystems.com/t/my-closed-loop-stepper-500ipm-rapid-centroid-acorn-converted-mr1-is-ready-for-debut/32083?page=2) | Demonstrates external closed-loop conversion, connectors/couplers, and need for coolant protection; 500 IPM is not adopted here |
| [Economical replacement stepper thread](https://forum.langmuirsystems.com/t/economical-mr1-replacement-upgrade-steppers/45953) | Reports NEMA 24 bracket mismatch and stock larger-axis torque near 420 oz-in |
| [gSender repository](https://github.com/Sienci-Labs/gsender) | Current Windows grblHAL support and release status |

## Findings and Decisions

### Controller

Use the Octopus Pro v1.1 F429 already in hand. The Scylla is a cleaner CNC board
and its 550 MHz CPU is impressive, but the MR-1's configured peak is only about
13.55k step pulses/second on X/Y. The phase-one DM860Ts need only PUL/DIR/ENA,
and the future CL57Ts perform encoder closure internally, so the F429 is not
solving a motor loop in software. Waiting a month for the Scylla does not
improve the primary upgrade enough to delay the build.

Confidence: high for the performance conclusion; medium until this exact board
boots and every mapped connector is electrically exercised.

### Host Computer

The Windows mini PC can stream directly over USB. A Raspberry Pi is useful for
Klipper/Moonraker-style architectures but is not required here. A current
gSender release validated during commissioning is the primary operator interface because its grblHAL support includes
visualization, probing, macros, job outlining, tool-change workflows, job
history, diagnostics, and maintenance reminders. ioSender remains a useful
grblHAL-native diagnostic alternative. The PC remains outside the safety chain.

Confidence: high.

### Motors and Drivers

Phase one uses the stock four-lead motors and four exact-face DM860T V3.0
drives. Use `S2=5V`, `SW4=OFF`, `SW5-SW8=ON/OFF/ON/ON` for 1600 pulse/rev,
`SW9=OFF`, and `SW10=OFF`. The reported stock high-power-driver value maps to a
provisional `SW1-SW3=ON/OFF/ON` (3.77 A peak), but Langmuir does not publish the
motor phase-current rating. STEPPERONLINE's two current V3 PDF filenames also
print different RMS equivalents while agreeing on peak current and switch
positions. Current therefore remains a photographed-label hold point rather
than an assumption, and the release record uses the peak value only.

The final upgrade remains four 3.0 Nm TS-series kits. Their 57 mm NEMA 23 frame,
8 mm shaft, 4.2 A rating, and 3.0 Nm torque are a credible mechanical/electrical
match. Start the CL57T at S1=4, 36 V, 1600 pulse/rev, closed-loop PUL/DIR mode.
Verified against the archived manual 2026-09-16: S1 code `4` selects **5.6 A
peak / 4 A RMS**, which sits just under the motor's 4.2 A/phase rating. The
factory S1 position is `0` (2.8 A peak / 2 A RMS) and must be changed. Full
switch table in `CL57T_QUICK_WIRING.md`. Do not use 3.5 Nm motors unless
measurements and test data show a real deficiency.

Confidence: high for the face-checked DM860T switch/timing map and future CL57T
settings; low for stock-motor current until the physical evidence is recorded;
medium for future motor fit until all four mounts/couplers are measured.

### Kinematics

The community conversion and MR-1 behavior agree on 5 mm X/Y and 3 mm Z screw
lead. At 1600 pulse/rev that gives 320, 320, and 533.333333 steps/mm. Published
stock rate limits are used rather than community high-speed modification claims.

Confidence: medium-high; final scale still requires indicator calibration.

### Probe and Tool Setter

grblHAL supports truly separate primary-probe and tool-setter inputs. The stock
sensors are the uncertain part: Langmuir has not published the connector details
found in the owner threads, revisions may differ, and reports describe exposed
5 V surfaces and coolant failures. Each sensor therefore gets a current-limited
floating supply and an independent optocoupler. No community color code is used
without meter/open-case verification.

The official Octopus Pro v1.1 schematic resolves the dedicated PC5 input: U16
is an EL357C with a 1 kohm field resistor, but the input return is board GND and
the output is an active-high emitter node with a 100 kohm pulldown. It is useful
single-channel protection/level shifting, not the two-channel floating sensor
island required here. The already-owned HW-399 is therefore the provisional
phase-one adapter on PF5/PB7, powered across the barrier by a genuinely isolated
5 V DC/DC. Its exact PCB, polarity, thresholds, and provisional 4.7 kohm field
pullups remain bench hold points.

Tool length is also a motion-safety input, not merely a final offset result.
Owner reports document CutControl preset-height descents striking long tools and
failing to reach short tools. The compiled grblHAL semi-automatic path likewise
rapids to its stored G59.3 Z before enabling the tool-setter probe. The MR-1
profile therefore keeps `$341=0`; the future host records a reference contact
and gauge length, requires the current gauge length, prohibits downward rapid
over the setter, and uses guarded `G38.3` moves throughout descent. The default
fine search is 3 mm total from 2 mm above predicted contact.

Confidence: high for the controller design; low-medium for stock sensor pinout
until the exact units are characterized.

### Homing and Y Squaring

Four stock switch channels are retained as separate inputs, but the stock
harness is not treated as four direct dry contacts. The pinned community build
describes active-high inputs and `NC 5V` limit/E-stop wiring, so each channel
passes through an energized-healthy isolated conditioner. A healthy channel is
low at the Octopus; switch trigger, cable break, or lost field power is high.
Z homes positive/up, X
negative/left, and Y positive/rear. The firmware homes Y-left and Y-right
independently to auto-square. Generic grblHAL defaults permit up to 25 mm of
second-switch lag, which is too much possible rack for this machine. The MR-1
profile instead uses `$347=1`, `$348=2.5`, and `$349=8`; its initial 546.10 mm Y
travel therefore aborts after 5.461 mm of commanded mismatch. Switch placement,
motor mirroring, actual directions, and the abort must still be proven at low
energy.

Confidence: medium-high for architecture; physical direction remains a test item.

### Spindle

Preserve the stock servo and command its verified low-voltage interface. The
working community map points to DB44-26/10 for analog command/return and DB44-16
for active-low enable, with DB44-31/23 providing field 24 V. These pins are not
treated as authoritative until continuity and configured-drive behavior are
confirmed. Phase one omits encoder feedback.

The future supervision design preserves that analog path and adds only isolated,
fingerprinted access. The generic T3A/T3L manual documents Modbus monitoring,
non-isolated differential OA/OB/OZ outputs, programmable drive I/O, and combined
position/speed mode. It also defines SRDY as healthy and ALM as alarm-active;
the earlier idea that both are energized-healthy is not adopted. Output
assignment and polarity still depend on the installed parameter archive.

The candidate Octopus USART2 path is PD5/PD6, but production Modbus remains
disabled. Direct encoder timer pins, spindle-side index, write registers, SON,
reverse, and M19 are all unassigned/locked. Conventional encoder-synchronized
`G33.1` rigid tapping is also unavailable. A separate non-production F429 lab
image now source-validates a coordinated A-plus-Z servo-axis tapping path while
remaining physically locked at 0 of 23 gates. See `SPINDLE_SUPERVISION.md`,
`RIGID_TAPPING.md`, `servo-profile.pending.json`, and
`servo-axis-tapping.pending.json`.

Confidence: medium for the community map, low for this machine until metered,
high that isolation and a series safety permit are required. Confidence is high
for generic manual capabilities and low that they match this installed drive
until its identity and parameters are captured.

### Safety

The conversion must have a safety relay and power/enable contactors independent
of software. External-drive ENA, grblHAL E-stop input, Windows, and USB are
monitoring or control conveniences, not safe torque off. The active DM860T and
future CL57T do not provide a certified STO function for this design, so the
exact stopping architecture requires a machine-specific risk assessment.

Confidence: high.

### Operator Workflow and Maintenance

The controller exposes separate probe and tool-setter selection, but automatic
probe motion is intentionally absent from the phase-zero macros. The three
audited macros can only stop spindle/coolant and select probe 0 or 1. A passive
Windows utility records board identity, pin state, parser/offset reports, and 65
settings without reset, unlock, motion, output, or settings-write commands.

The firmware odometer is not enabled. Its own documentation recommends FRAM,
while this Octopus profile uses I2C EEPROM, and its implementation writes after
motion-state and spindle-state transitions. gSender already tracks actual job
runtime by COM port and supplies customizable reminders, so PC-side tracking is
more useful to the operator and avoids unnecessary EEPROM wear.

Confidence: high for the software policy; live serial behavior still requires
the first board-only commissioning capture.

### Accelerometer

An ESP32 accelerometer can be magnet-mounted temporarily for stationary
measurements, but repeatable vibration work requires a rigid clamp/bolt mount.
It remains telemetry only and never participates in control or safety.

The ordered tiny spindle-surface sensor is not yet identified. Its product link,
part number, or board marking is required before any ESP32 wiring or driver is
selected; lead colors and a three-wire cable are not identification. If it is
confirmed as a genuine DS18B20, the conditional reference is `VDD -> H2 pin 3 /
3V3`, `GND -> H2 pin 2 / GND`, and `DQ -> H2 pin 8 / GPIO16`, with a 4.7 kohm
pullup from DQ to 3V3. H2 pin 1 is USB `VBUS` and is never used for that sensor.
Installed firmware `7.4-mr1` still reports the ESP32's internal chip temperature.

Confidence: high for the Waveshare and DS18B20 reference; sensor identification
remains unresolved.

## Unresolved Physical Checks

These cannot be answered honestly from web research or source code:

1. Exact Octopus silkscreen/MCU/crystal on the user's board.
2. Actual MR-1 screw-shaft diameters, pilots, bolt patterns, coupler envelopes, and connector clearances.
3. Exact stock probe and tool-setter revision, supply, current, output circuit, connector orientation, and metal-body isolation.
   **Working hypothesis (2026-09-21)**, from the Langmuir forum thread
   [Tool Setter and Touch Probe Wiring](https://forum.langmuirsystems.com/t/tool-setter-and-touch-probe-wiring/36814)
   and the [alexphredorg/mr1](https://github.com/alexphredorg/mr1) LinuxCNC
   conversion: three-pin connector, **pin 1 = 5 V, pin 2 = signal, pin 3 = 0 V**.
   The output is open-collector and **pulls low when triggered**, so it needs a
   pull-up and reads high when unplugged. Probe-side colours white/black/red,
   cabinet-side yellow/orange/brown, and the source says outright that the
   colours are non-standard, so go by pin number. The same source states the
   probe and setter *"expose 5V DC on all external metal surfaces"* - that is
   the reason for an insulating mount, not a reason for an opto. Closes with:
   conductor count and pin order at the plug; idle and triggered voltage on a
   bench supply; continuity from probe 0 V to frame; continuity from stylus to
   body. Version 2 of the probe is reported to keep the V1 cabinet wiring.
4. Actual home-switch contact arrangement, sealing, and repeatability.
   **Working hypothesis (2026-09-21, same sources):** four passive two-wire NC
   switches on a splitter harness sharing one common; the stock controller fed
   that common 5 V (*"Limit and e-stop switches are NC 5V"*, input common on
   GND at the Mesa). The conversion's input table carries only three limit
   inputs - `X`, `Y1`, and `Y2/Z` on one input - so either the harness merges
   Y2 and Z on one conductor or that builder did. **If the harness merges them,
   `Y_AUTO_SQUARE` cannot work until one of them gets its own conductor.**
   Closes with: count conductors at the plug (5 = four signals + common, 4 = a
   shared pair); ohmmeter across each switch with the leads both ways round
   (identical readings = passive contact); continuity from the common to one
   leg of all four. If all three pass, the common lands on Octopus `GND`, each
   signal on its `STOP` SIG, and the isolated conditioner comes out of the
   build.
5. Actual DB44 continuity, servo-drive model/firmware, analog scaling, enable polarity, and alarm configuration.
6. Exact stock-motor phase current or original-driver current setting for DM860T `SW1-SW3` release.
7. Actual DM860T ALM idle/fault impedance now, plus CL57T ALM behavior after the future upgrade.
8. Required safety performance level, stop category, contactor arrangement, and discharge time for this installation.
9. Cabinet heat rise, grounding impedance, EMC behavior, and cable lengths after layout.
10. Final Y motor direction/inversion, switch locations, and squaring offset.
11. Final soft-limit margins and calibrated steps/mm on the assembled machine.

The commissioning procedure is structured to close each of these before it can
become a full-energy failure.
