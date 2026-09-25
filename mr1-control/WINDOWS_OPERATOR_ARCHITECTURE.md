> Superseded on 2026-09-24: the owner selected the custom native controller.
> The gSender architecture below is historical, not the active launch path.
> See [NATIVE_CONTROL.md](NATIVE_CONTROL.md) for the current implementation and
> unresolved commissioning work.

# Windows Operator Architecture

## Decision

The existing Windows mini PC is the machine computer. No Raspberry Pi is
required.

For commissioning and first cuts, the signed Windows build of gSender is the
only process allowed to own the Octopus controller COM port. It supplies the
proven grbl/grblHAL sender, jog cancellation, streaming, alarms, probing,
zeroing, macros, and recovery behavior. `mr1-control` supplies the MR-1-specific
digital twin, local G-code preview, probing profiles, wiring reference, ESP32
telemetry, and spindle diagnostics.

The programs must not open the controller COM port at the same time:

- Machine operation: gSender owns the controller; the current custom bridge is
  stopped or disconnected from that port.
- MR-1 diagnostics: the custom bridge owns the controller in read-only mode;
  gSender is disconnected from that port.
- ESP32 telemetry uses its own explicitly selected COM port.

## Current Jog Panel

The custom screen includes WORK/MACHINE DRO selection, axis-zero controls,
MPOS distance-to-limit readouts, step and speed presets, and XYZ jog buttons.

- Local preview: the jog buttons move only the Three.js tool preview. Opening
  the drawer pauses preview playback. Incremental and press-and-hold continuous
  modes never write to a serial port.
- Virtual controller: typed bounded jogs require fresh MPOS, `Idle`, homing,
  clear limits, and clear safety inputs. Completion requires final MPOS and
  `Idle`; continuous release, panel close, focus loss, tab hiding, explicit
  disconnect, or owner-stream loss invokes the cancel path.
- Physical telemetry: positions and travel clearances use controller reports,
  but every direction and zero button is disabled and marked hardware locked.
- gSender: supplies actual machine jogging and zeroing after the matching
  commissioning stages pass.

## Simulation Transaction Qualification

The loopback service now owns a complete virtual command transaction layer for
`apply-work-offset`, `jog`, and `tool-setter`. It accepts no raw G-code. A browser
session receives one owner ID and lease; request IDs are idempotent; observed
status sequence, telemetry age, machine state, homing, limits, and safety inputs
are checked at submission and immediately before dispatch.

Every accepted transaction emits ordered SSE state, phase, progress, gates,
acknowledgement, result, and bounded history. The coordinator has a 30-second
execution deadline, owner-only cancel, automatic owner-stream disconnect abort,
queue drain on service stop, and monotonic client acceptance so a delayed HTTP
response cannot overwrite a newer SSE completion. The setter proves double
touch, immediate contact retract, return to configured safe Z, and final `Idle`.
WCS application requires qualified frame/location evidence and compares the
candidate offset with the observed controller WCO.

This is `SIM` evidence for the control protocol. Serial mode still exposes no
physical command executor and writes only `?` status requests.

## Target Integration

The eventual custom screen can become the primary operator UI, but its machine
side must reuse a pinned, source-audited gSender sender core or a maintained
fork. It must not depend on an undocumented socket contract from an arbitrary
installed gSender version, and it must not implement a second ad hoc G-code
streamer.

Promotion requires all of the following:

1. One Windows process holds an exclusive controller-port lease.
2. The UI sends typed operations, not unrestricted browser-supplied serial
   strings.
3. Every operation has a sequence ID, controller acknowledgement, timeout,
   cancellation path, and append-only log. The first four are implemented in
   simulation; the durable append-only journal remains open.
4. Jogging is bounded by axis, feed, distance, homed state, valid MPOS, soft
   limits, safety inputs, and current controller state.
5. Continuous jogging is dead-man controlled and cancels on release, focus
   loss, client disconnect, service failure, or controller alarm.
6. Zeroing identifies the active WCS and requires an explicit axis-specific
   action; it never edits machine coordinates.
7. Program run, hold, resume, abort, homing, spindle, coolant, probing, and tool
   setting each have separate permit gates and tests.
8. The physical E-stop and safety chain remain independent of Windows, USB,
   the browser, and every software service.

## Vision and Guided Probing Boundary

Scene registration is a planning input, not a motion authority. Its current
fixture-hole homography resolves only plate-plane XY. Camera pixels are kept in
memory; the browser-local profile stores a SHA-256 frame fingerprint,
correspondence coordinates, timestamps, and fit limits but never grants a
machine permit. A matching current frame, a fit within its age limit, RANSAC
consensus within the outlier budget, and an image target inside the inlier
calibration hull are required even for a review-ready plan. Rejected references
remain visible evidence.

Before camera-guided probing can move hardware, the target command service must
add typed, acknowledged probe operations with all Target Integration gates plus:

1. A versioned camera and lens calibration tied to frame resolution.
2. A fresh registration-quality check for every captured frame.
3. Explicit fixture, vise, stock, and occlusion snapshots used by the plan.
4. A fully qualified directional probe profile and valid machine frame.
5. A reviewed clearance plane, maximum search, retract, travel-envelope, and
   pre-trigger/no-trigger policy for every contact.
6. A dry-run artifact and operator acceptance of the generated operation list.
7. Stop-on-first-mismatch behavior for PRB response, position, probe state,
   controller state, camera freshness, or client connection.

Image segmentation, feature recognition, probe-plan execution, and parametric
CAD generation remain separate adapters. None may acquire the controller COM
port or bypass the single command owner.

Until those requirements pass on the bench and then on the unpowered/uncoupled
machine stages, gSender remains the physical command owner and the custom
controls remain simulation-only.

## Table-Frame Authority

The fixture-plate CAD is nominal geometry, not machine-coordinate evidence. A
usable table frame must retain the raw G53 center measurements from distributed
CAD-known holes, the raw plate-top Z touches, solver limits, residuals, inlier
classification, probe identity, calibration time, and operator homing
confirmation. Manually entered center/yaw values do not grant fixture or camera
machine-coordinate authority.

The table solver is restricted to rigid XY translation plus yaw and an
independent top-plane fit. It must report apparent axis scale rather than
absorbing scale disagreement into the fixture map. Excessive residual, scale
error, tilt, poor plate coverage, duplicate references, stale probe
qualification, changed frame values, or an unhomed session fails closed. The raw
measurements remain reviewable after solving.

Even a qualified plate yaw does not rotate grblHAL work-coordinate axes. Future
WCS write operations must separately require mechanical axis alignment or a
reviewed coordinate-rotation strategy; table registration alone is permission
to map origins, not permission to rotate a posted toolpath.
