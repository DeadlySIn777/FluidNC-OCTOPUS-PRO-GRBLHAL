# MR-1 Rigid Tapping Proof Plan

Audit date: 2026-08-23

## Decision

There are now two deliberately separate results:

1. `G33.1` remains **NO-GO on the current production image**. The pinned core
   rejects it, the production spindle output is forward-only PWM, and no
   spindle-synchronization input is mapped.
2. A second F429 qualification target now proves a different Octopus method at
   source and binary level: put the digital spindle servo in position mode,
   expose its pulse/direction command as rotary `A`, and coordinate `A` and `Z`
   in one `G93` planner trajectory. The downstroke and return are exact inverse
   step ratios, so pitch remains geometric through acceleration, stopping, and
   reversal without using `G33.1` or an unfinished encoder-follower hook.

The second result is **source-feasible and hardware-unverified**, not a
production permit. The normal three-axis image remains the default and is
unchanged. The lab image is visibly marked `MR1 SERVO AXIS LAB - DO NOT USE IN
PRODUCTION`, disables the PWM spindle command, and cannot be promoted until all
physical gates pass.

The latest official grblHAL audit does not change that result. Core commit
`f80fc34d503bd62391a23b197b3e0ee66ce00cb7` recognizes `G33.1`, but its weak
`mc_rigid_tapping()` function returns `Status_GcodeUnsupportedCommand`. The
2026-08-11 changelog calls this only a hook for a future implementation. Latest
STM32F4 commit `b7bcf17e7500be5bb71daa403add3fc461b9bc41` supplies encoder support but
does not override the unfinished rigid-tapping function.

Do not update the production core merely to gain parser recognition.
Recognition without an implemented, tested reversal cycle is not motion
support. The coordinated-axis method avoids making that false claim.

## Feedback Distinction

Langmuir specifies a motor-integrated encoder and a `1:2` overdrive: one motor
revolution produces two spindle revolutions. In an encoder-follower `G33.1`
design, the motor encoder is not a substitute for direct spindle phase: its
index is not one unambiguous event per spindle revolution, and belt phase or
slip is outside the feedback loop. Centroid's documented path therefore calls
for `1:1` spindle feedback.

The servo-axis method is different. The drive closes motor position locally
and follows controller pulse/direction as a commanded rotary axis; grblHAL
coordinates those command pulses with Z. It does not pretend to close the
motor loop inside the Octopus. That is the same hybrid architecture used when
Acorn or MASSO sends step/direction to a closed-loop drive.

Belt compliance, mechanical ratio, and possible slip still matter. Physical
qualification therefore requires independent spindle-side instrumentation to
measure actual phase through acceleration and reversal, a proved drive
following-error limit and hard fault, and repeatable wax and aluminum results.
A permanent spindle-side monitor is desirable, but it is measurement and fault
supervision for this method rather than the trajectory's real-time phase owner.

## Controller Paths

### Path A: Octopus Pro / grblHAL

The Octopus remains suitable for ordinary MR-1 motion, probing, tool setting,
coolant, fault monitoring, dual-Y squaring, and the planned closed-loop stepper
upgrade. It now also has a compiled, regression-tested rigid-tapping
qualification architecture, but it is not physically proved today.

The separate target `btt_octopus_pro_f429_mr1_servo_axis_lab` uses four logical
axes and five physical motor outputs:

| Function | Logical motor | Physical Octopus socket | Pins |
| --- | --- | --- | --- |
| X | X | MOTOR0 | PF13 / PF12 / PF14 |
| Y-left | Y | MOTOR1 | PG0 / PG1 / PF15 |
| Z | Z | MOTOR2 | PF11 / PG3 / PG5 |
| Spindle servo | A / M3 | MOTOR4 | PF9 / PF10 / PG2 |
| Y-right | Y2 / M4 | MOTOR3 | PG4 / PC1 / PA2 |

This preserves the existing Y-right cabinet wiring. Y-right home and drive
fault remain PG11 and PG15. The production build still maps Y-right directly
as M3 and has only XYZ.

The provisional gearing model is 1000 command pulses per motor revolution and
two spindle revolutions per motor revolution. That gives 500 pulses per spindle
revolution or `1.388888889 step/degree`. At 8000 spindle RPM, A requires
`66,666.7 pulse/s`; the configured 5 microsecond pulse plus the driver's
enforced 2 microsecond off time gives a `142,857.1 pulse/s` period ceiling.
The 21 MHz F429 step timer has 315 ticks per A pulse at that worst case.

A qualification block uses incremental inverse time, for example:

```gcode
G91 G93
G1 Z-10.0000 A3600.0000 F30.000000
G1 Z10.0000 A-3600.0000 F30.000000
G90 G94
```

For a 1 mm pitch, 10 mm depth, and 300 RPM request, both blocks command ten
spindle turns; A and Z are emitted by one Bresenham step stream. The planner's
exact-reversal branch sets the junction speed to the configured zero minimum.
Acceleration can lengthen a short block and reduce achieved peak RPM, but it
cannot change the commanded Z-per-spindle-turn ratio.

Promotion still requires the installed drive to prove position mode,
speed/position mode switching, pulse format, electronic gearing, reverse,
following-error alarm, isolation, and hardwired permission. The final CL57T Z
drive must be commissioned and its return tracking measured. Then A/Z pulses,
physical spindle phase, bottom reversal, hold/reset, USB loss, wax, and
aluminum all require retained evidence.

### Path B: Centroid AcornSix / CNC12 Mill Pro

If rigid tapping is non-negotiable and the operator PC must remain Windows,
this is the conservative final-controller path. Centroid documents rigid
tapping for AcornSix/CNC12, provides a dedicated spindle-encoder input, and
publishes the setup and tuning procedure. CNC12 remains the motion owner; the
custom MR-1 screen can remain a read-only preview, fixture, and telemetry
companion.

This still does not make rigid tapping plug-and-play. It needs CNC12 Mill Pro or
the currently applicable licensed tier, direct `1:1` spindle feedback, verified
M3/M4 control, spindle acceleration/deceleration tuning, and the physical proof
sequence below. Centroid explicitly says each machine must be tuned and does
not guarantee a result before that integration work is completed.

### Path C: LinuxCNC / Mesa

LinuxCNC has a mature `G33.1` sequence and explicit spindle position, index,
at-speed, forward, and reverse interfaces. It is a strong technical alternative,
but it replaces the requested Windows control environment with Linux. It is not
the current recommendation for this build.

## Feed And Axis Capacity

Rigid-tap Z feed is fixed by thread pitch and actual spindle speed:

```text
Z feed (mm/min) = pitch (mm/rev) x spindle speed (rev/min)
```

The current configured Z maximum is `1016 mm/min`. Merely staying below that
number does not prove adequate acceleration or reversal margin.

| Thread | Pitch | 300 RPM | 500 RPM | 800 RPM | 1000 RPM |
| --- | ---: | ---: | ---: | ---: | ---: |
| M6 x 1.0 | 1.000 mm | 300 | 500 | 800 | 1000 |
| 1/4-20 | 1.270 mm | 381 | 635 | 1016 | 1270 - over limit |
| M8 x 1.25 | 1.250 mm | 375 | 625 | 1000 | 1250 - over limit |

Initial proof speeds must be selected from the tap maker's limits, the
controller's minimum rigid-tap speed, the measured spindle reversal behavior,
and available Z acceleration. The calculator in the spindle panel reports only
the kinematic demand; it never grants a permit.

## Machine-Readable Gates

Two all-false matrices prevent the methods from being conflated:

- `servo-profile.pending.json` retains the 11-gate encoder-follower `G33.1`
  no-go record. The validator still fails if sync/encoder pins appear in the
  production image or the pinned rejection changes without review.
- `servo-axis-tapping.pending.json` owns the coordinated-axis path. Its 23
  physical gates cover board identity and bench flash; five output channels and
  dual-Y homing; installed-drive identity and parameter archive; position mode,
  mode switching, pulse input, gearing and mechanical ratio; isolation,
  direction, drive alarm and spindle following error; closed-loop Z and return
  tracking; A/Z ratio and bottom-reversal captures; hold/reset and USB loss;
  wax and aluminum.

Every physical value is false and every evidence hash is null. Production
authorization is separate and false. The validator proves only source
properties: target isolation, pin assignment, planner selection, reversal
junction behavior, timing math, and binary identity.

## Physical Acceptance Sequence

No stage may be skipped. Clear the table, remove sharp tools, and retain the
hardwired E-stop/safety chain throughout controller commissioning.

### RT0 - Controller and design review

- Select and record either the encoder-follower or coordinated-servo-axis
  method; never combine their assumptions.
- Positively identify the servo drive, motor, connector functions, and full
  parameter archive.
- Prove position mode, speed/position switching, pulse format, electronic
  gearing, following-error threshold, and alarm output from installed-drive
  documentation and readback.
- Approve the independent spindle-phase measurement setup, connector, cable,
  and maximum mechanical speed.
- Prove that a reset, Windows loss, communications loss, and controller restart
  cannot create an uncommanded spindle start.

### RT1 - Command and measurement paths with spindle power unavailable

- Scope all five step/direction/enable channels and prove MOTOR3 remains Y-right
  while MOTOR4 is A only in the lab image.
- Rotate the spindle by hand and verify signed physical spindle measurements in
  both directions.
- Verify one and only one index event per spindle revolution over at least 100
  revolutions when an index is used for qualification.
- Confirm the provisional 1000 pulse motor command and measured 2:1 ratio, or
  replace them with the installed values and rebuild every derived setting.
- Disconnect command, alarm, and measurement channels individually and verify
  each invalid state prevents arming.

### RT2 - Unloaded spindle direction and stopping

- Run without a collet, holder, or tool at the lowest approved speed.
- Prove speed mode, position mode, break-before-make switching, both A
  directions, in-position, zero-speed, alarm, and controlled stop behavior.
- Record actual RPM, acceleration time, deceleration time, reversal time,
  regeneration/load, and worst reversal overshoot across repeated cycles.
- Prove E-stop, guard, encoder loss, drive alarm, PC loss, and command-link loss.

### RT3 - Z-axis tracking

- Complete the CL57T closed-loop Z upgrade before production rigid tapping.
- Verify pulse scaling, direction, following-error output, drive fault input,
  thrust margin, and return repeatability under representative axial load.
- Run repeated down/reverse/return trajectories without a tap and verify no
  lost position against an independent indicator.

### RT4 - Instrumented synchronized air cycle

- Run the exact reviewed `G91 G93` A/Z qualification sequence with no tool and
  no workpiece.
- Capture A pulse/direction, Z pulse/direction, actual spindle phase, spindle
  following status, Z following status, and all hard faults.
- Verify Z continues to track actual spindle motion through deceleration,
  reversal, acceleration, return, and the second reversal.
- Verify an over-rate command and every injected feedback fault are rejected.

### RT5 - Machinable wax

- Use a sacrificial setup, a correctly sized tap, rigid holder, and a shallow
  through hole with generous clearance.
- Begin at the lowest fully characterized speed and depth.
- Measure commanded depth, actual depth, return position, thread quality, and
  peak spindle/Z load for repeated cycles.
- Any torn thread, axial pull, count error, following alarm, missed return, or
  unexplained load blocks promotion.

### RT6 - Sacrificial aluminum

- Repeat with a through hole before any blind hole.
- Run at least 20 consecutive holes while recording all proof channels.
- Gauge every thread and verify return repeatability against the part's required
  tolerance.
- For a future blind hole, clearance below programmed depth must exceed the
  measured worst-case reversal overtravel plus tap lead/chamfer and an approved
  safety margin. Never assume a fixed generic clearance.

Production authorization requires reviewed records from every stage. One
successful hole is not proof.

## Current Proof Result

| Item | Result |
| --- | --- |
| Pinned core parses and executes `G33.1` | **FAIL - explicitly rejected** |
| Latest upstream core contains motion implementation | **FAIL - weak TBC hook returns unsupported** |
| Production image changed to claim tapping | **PASS - no; remains default 3-axis image** |
| Separate F429 XYZA + Y2 lab target compiles | **PASS** |
| A and Z share the normal coordinated step stream | **PASS - source and binary build** |
| Exact down/up junction requests zero speed | **PASS - source invariant** |
| Worst-case provisional A pulse timing | **PASS - 66.7 kHz vs 142.9 kHz ceiling** |
| Installed servo position mode and mode switch | **FAIL - drive unidentified** |
| Five physical outputs and actual spindle phase | **FAIL - no connected Octopus/drive proof** |
| Closed-loop Z commissioned | **FAIL - future CL57T upgrade** |
| Servo-axis physical gates | **FAIL - 0 of 23** |
| Production permit | **BLOCKED** |

## Primary References

- [Local pinned grblHAL `G33.1` rejection](../grbl/gcode.c)
- [Local servo-axis qualification config](../Inc/mr1_servo_axis_lab_config.h)
- [Local locked servo-axis proof profile](servo-axis-tapping.pending.json)
- [grblHAL August 2026 changelog](https://github.com/grblHAL/core/blob/master/changelog.md)
- [Latest grblHAL weak rigid-tapping hook](https://github.com/grblHAL/core/blob/f80fc34d503bd62391a23b197b3e0ee66ce00cb7/motion_control.c#L815-L818)
- [grblHAL maintainer rigid-tapping discussion](https://github.com/grblHAL/core/discussions/515)
- [Latest STM32F4 encoder implementation](https://github.com/grblHAL/STM32F4xx/blob/master/Src/encoders.c)
- [BTT Octopus Pro v1.1 schematic](https://github.com/bigtreetech/BIGTREETECH-OCTOPUS-Pro/blob/master/Hardware/BIGTREETECH%20Octopus%20Pro%20V1.1-sch.pdf)
- [Langmuir MR-1 build and 1:2 spindle drive](https://www.langmuirsystems.com/mr1/build)
- [Langmuir MR-1 spindle encoder description](https://www.langmuirsystems.com/mr1/spindle)
- [Centroid AcornSix rigid-tapping setup](https://www.centroidcnc.com/centroid_diy/downloads/acorn_documentation/centroid_acornsix_install_manual.pdf)
- [Centroid controller closed-loop feature table](https://centroidcnc.com/pubs/pre540_feature_set.php?board=&machine=lathe&tier%5B%5D=free&tier%5B%5D=pro&tier%5B%5D=ultimate&tier%5B%5D=ultimate_plus)
- [Centroid rigid-tapping technical bulletin](https://www.centroidcnc.com/centroid_diy/downloads/acorn_documentation/acorn_rigid_tapping_parameters.pdf)
- [MASSO motors and drives FAQ](https://docs.masso.com.au/index.php/MASSO_FAQ/motors_and_drives)
- [LinuxCNC `G33.1` behavior](https://linuxcnc.org/docs/stable/html/gcode/g-code.html#gcode:g33.1)
- [LinuxCNC spindle synchronization interfaces](https://linuxcnc.org/docs/stable/html/config/core-components.html#sec:spindle)
