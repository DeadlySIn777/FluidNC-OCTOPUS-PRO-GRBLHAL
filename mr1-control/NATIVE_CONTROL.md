# MR1 native Windows controller — engineering build

This application owns the Octopus USB connection through its own Node serial
service. gSender is not part of this launch or command path. The firmware remains
grblHAL. The older simulator and read-only telemetry service are separate tools.

## Run

Use `START-MR1-NATIVE.cmd` in the portable package. It starts a local service and
opens `http://127.0.0.1:5174/?native=1`. No serial port opens automatically.
From source, install locked dependencies, run `npm run build`, then
`npm run controller` and open the same URL.

Packaging and service startup verify the bundled firmware bytes and deployment
metadata against the pinned candidate. Qualification checks the files again.
The state response labels this `bundled-file-only`; it does not establish what
is flashed on a controller or grant physical motion permission.

The native page shows unknown machine coordinates and inputs until live reports
arrive. The bundled 3D demonstration is explicitly a program preview. The status
link connects only to this native service; it cannot pick up the simulator on
port 8787.

## Implemented native command path

- Exclusive Windows serial ownership, explicit COM selection and a read-only
  identity/settings handshake against the bundled 66-setting production profile,
  including metric reporting. Both stored startup blocks must be empty.
  Board identity must be an exact structured report. Partial numeric values and
  conflicting settings within a capture cannot pass; string and vector settings
  also participate in the configuration fingerprint.
  grblHAL prints its welcome banner 200 ms after the port opens (DTR edge); one
  banner is consumed before the handshake starts. Any later startup line is a
  controller restart.
- Preflight requests grblHAL's complete status report (realtime byte `0x87`).
  Missing or malformed required position, feed, spindle, homing, accessory and
  selected-probe fields cannot establish authority. Rejected initial read-only
  queries fault without automatically resetting the controller; a reset could
  execute stored startup commands. Explicit stop/reset remains a separate action.
- One browser owner with a four-second renewable lease. Lease loss, stale
  controller status, reset, alarm or drive fault invalidates the session.
  Hold, stop, disarm and jog cancel need only a same-origin request, not the
  lease, so a failed read or lost session never delays them. The heartbeat runs
  in a dedicated worker because hidden or occluded windows throttle page timers;
  closing the tab still ends it, and a page that stops reporting it is alive
  (3 s while visible, 90 s while hidden) lets the lease lapse.
- A single acknowledged line in flight, bounded line size, no retransmission
  after timeout, and durable logging before a line is sent. A journal write that
  cannot be confirmed faults the controller and blocks the line. Stop/hold
  commands bypass the disk-write gate. Late acknowledgements cannot resume a
  cancelled job. Each journaled line is fsynced, which bounds streaming
  throughput by the disk's sync rate.
- Closing a service console window, Ctrl+C, Ctrl+Break, a termination signal or
  a service crash first sends hold and reset to an armed controller, then exits
  within five seconds.
- Homing, bounded incremental jog, G54–G59 zeroing, forward spindle and coolant
  commands, hold/resume and reset/stop. With `$10` report-while-homing off,
  grblHAL reports nothing during a homing cycle: after its forced Home report
  the stale-status watchdog waits for the `$H` acknowledgement (at most 120 s),
  then requires a fresh report. Jog cancel sends realtime `0x85` and escalates to
  hold and reset if Idle is not reported within one second.
- Large programs are validated in a worker thread, so loading one cannot delay
  status handling or a stop.
- Server-side NC validation, SHA-256 binding to the reviewed source, manual M0
  tool-change pauses, and final fresh Idle confirmation. Every rerun requires a
  fresh load. A changed preview cannot silently run the previously loaded file.
  NC checks reject undeclared startup modes before machine-coordinate motion,
  duplicate words/modal conflicts, executable checksums and pauses mixed with
  motion or accessory changes. Program reservations remain bound to the exact
  reviewed source while waiting and immediately before each serial write.
- Deferred M0 acknowledgements follow the firmware's suspend/resume behavior.
  Fresh Run/Hold reports allow planner waits without replaying commands; a lost
  acknowledgement at Idle still faults. Explicit G4 dwells retain their declared
  time after earlier motion drains, with a one-hour maximum per dwell.
- Two-touch probing from the current position, with explicit probe/setter input
  selection, bounded search and retract, contact-coordinate checks, 0.05 mm
  repeatability rejection, and restoration of units/distance/feed modes. Probe
  results do not automatically change work offsets or tool length.
- Native journal export and review of a recoverable interrupted session. Journal
  corruption cannot be dismissed through the recovery control.
- Live controller APIs, event streams, firmware artifacts and native navigation
  bypass offline caching. A cached preview cannot substitute for live state.
- Seven separate commissioning stages with physical evidence prerequisites,
  explicit preparation confirmations, expiring sessions, axis/feed/travel
  budgets and program fingerprint binding. These authorize limited tests; they
  never manufacture passing commissioning evidence.
- Protected surface, edge, outside-corner and bore probing; two-touch setter
  measurements; separate explicit fixture and tool-length writes with readback.
  Each workflow requires an operator-supplied physical setup artifact, reviewed
  clearance route and a one-use plan that expires after 60 seconds.
- Exact modal feed preservation through firmware M70/M72 snapshots, including
  fractional feed and G20. Select G94 before probing; G93 is rejected because
  firmware snapshots cannot transparently preserve its inverse-time feed.
- Observed changes to settings or startup blocks invalidate an existing preflight.
  This detects reported drift, not unreported changes made outside this service.
  Arming and program preparation require reported spindle and coolant outputs off.
- Browser ownership claims and polling are single-flight. Older status replies
  cannot replace newer state or revive a failed connection. Read requests have
  bounded timeouts; machine commands are never silently retried. Connection and
  fault changes clear the displayed physical preparation confirmations.
- Awaited service operations recheck their original owner and controller state
  before dispatch or acceptance. Stop/disarm/disconnect can cancel pending work;
  overlapping ordinary mutations are rejected instead of being queued for later.
- Serial open/close lifecycle states are explicit. A failed close retains the
  handle for a reviewed disconnect retry; callbacks from an earlier connection
  cannot invalidate a replacement connection. Stop requires a fresh reconnect.
  A missing OS open/close callback raises a diagnostic fault after five seconds
  while retaining the unresolved transition lock. Timeout is not proof of a
  closed handle; a delayed successful open is closed without running preflight.
- Probe and offset/parser readback collection begins at the actual serial-send
  boundary after persistence, so older unsolicited reports cannot satisfy a new
  measurement or write-verification transaction.
- The optional Fission optimizer runs inside this service. Only its
  `src/optimizer.js` and `src/gcode-parser.js` are hash-pinned; both are
  re-verified immediately before every use. Any other file they require is not
  pinned, so keep that installation folder write-protected.

## Wiring preparation and observation

Open `/wiring/workbench.html` from the wiring instructions for the printable
preparation worksheet and 69-entry circuit ledger. Physical terminals, conductor
ratings and inspection results remain blank until verified. This is not a
released cabinet schematic, connector-face drawing or power-on approval.

The native panel's **Read-only wiring diagnostics** shows fresh logical inputs
only after confirming metric reporting and the full status mask. Missing,
disconnected or stale reports remain UNKNOWN. INACTIVE does not prove electrical
health. The stream combines the Y limit indication, reports only the selected
probe, and has no individual PG12–PG15 drive states because the current firmware
does not read those pins.

While disarmed and stationary, the operator can label and export displayed
reports. The panel issues no controller commands. Its observations are logical
reports and operator notes, not measured voltages or accepted commissioning
evidence; they never grant motion permission.

## Commissioning boundary

This build has no physical machine evidence. Nothing was connected during its
development. Serial tests use an explicitly isolated test double, not a motor.
No production flag or simulator transcript grants motion permission at startup.

The qualification endpoint accepts a sealed, complete commissioning record bound
to the current controller configuration fingerprint and production firmware artifact. Permission
expires on disconnect or fault. This is an evidence check, not independent proof
that the uploaded measurements are true, nor an on-device flash readback.

First-motion commissioning now has an explicit uncoupled stage. After its
physical prerequisites are recorded, the operator can review a temporary
homing-lock change from $22=7 to $22=3 and an explicit unlock. Every axis must be
unhomed, all couplers disconnected, loose motors secured, Z supported and spindle
power isolated. Jogging is limited to 0.25 mm at 50 mm/min, 2 mm cumulative per
selected axis, 24 commands and five minutes. A Y command drives both Y motors;
it does not independently qualify Y-left and Y-right.

The temporary setting transaction is durably recorded before transmission.
Disconnects, shutdowns, failed writes and crashes retain the restoration debt.
Only an explicit matching-board restore and complete readback of $22=7 and the
other settings clear it. No coupled stage or production permission can bypass
that debt. The service never automatically unlocks or resumes on reconnect.

The coupled stages separately cover homing, bounded motion, probing, spindle,
air runs and controlled cut trials. Air-run source must explicitly turn outputs
off, cannot start spindle/coolant, and is bound to its own reviewed session.
Commissioning evidence uses a stable configuration fingerprint; the separate raw
transcript hash still seals each capture. Neither is a unique MCU attestation.

These paths have byte-level protocol and fault tests. They still require bench
verification with the actual F429 and wiring before this becomes a cutting release.

Loss of authority requests hold then controller reset to stop outputs, invalidates
position/preflight and requires re-homing. Manual feed hold remains resumable.
Host-side stop is best effort. A crashed PC cannot transmit a stop, and a USB
disconnect does not prove immediate removal of hazardous energy. The independent
hardwired safety chain and measured firmware/drive response remain necessary.

## Current hardware profile

The active installation is CL57T V4.1 with 23HS45-4204D-E1000 motors, based on the
firmware repository's September 17 drive migration and the archived vendor
manual. The app now distinguishes polarized P4 bus power, P2 encoder wiring,
S1 current, the S2 DIP bank, S3 signal voltage and ALM/COMO. The default ENA
terminals are unconnected. Reserved enable circuitry needs separate verification.

The drive closes its motor encoder loop locally. Controller-reported coordinates
are not independently measured motor or table position. PB1 is the aggregate
motor-fault stop input and the only drive-fault stop. PG12–PG15 are wired for a
future firmware candidate only: the current firmware does not read them, so there
is no per-axis fault indication. The app
does not invent encoder telemetry or infer a healthy axis from a preview.

Vendor reference: https://www.omc-stepperonline.com/download/CL57T-V41_user_manual.pdf

Saved physical checks from the DM860T installation are invalidated for this
profile. The original drives and stock motors remain the rollback set.

## Remaining release work

- Bench-validate staged commissioning, temporary-settings recovery, protected
  probe/setter routes, fixture readback and the physical tool-length convention.
- Validate sustained streaming throughput, planner starvation, Windows suspend,
  long pauses, controller restart and USB removal on the actual F429.
- Measure travel, direction, backlash, dual-Y squaring, drive fault response,
  probe repeatability, spindle stop behavior, EMI and long-job performance.
- Verify settings/firmware deployment, independent safety review, packaging
  provenance, licensing and third-party notices before public distribution.

Source tests and a successful build are necessary evidence. They are not a claim
of complete hardware qualification, machining accuracy or superiority over
another controller.
