# MR1 Windows operator entry point

The project's own **MR1 native Windows application** is the current operator interface. The old gSender-primary procedure is superseded. Use the application source and instructions under [`mr1-control/`](../../mr1-control/); its native service owns the serial connection and enforces the active controller session.

This repository is an engineering source release. No controller is assumed connected and no completed hardware commissioning is recorded. Building the app or firmware does not authorize motion.

## Build and first read-only connection

Follow the application's README to install its locked dependencies, run tests and build. Launch the native application using its documented Windows entry point. Verify the actual board identity before selecting its COM port. Only one process may own that serial port; close any old sender or serial monitor first.

The initial connection performs read-only status/report queries. Review the exact F429 board identity, all **66** profile settings including `$13=0`, clear input state, and both empty startup slots from `$N`. Retain the report and physical identity evidence. Do not unlock or home to fix a failed report. Resolve the concrete mismatch through the reviewed commissioning procedure.

The source release omits the compiled firmware candidate. A locally built image must acquire reviewed identity/build evidence before flashing or acceptance. A historical image hash by itself does not establish that a new build, board or flash is correct.

## Wiring and commissioning

Use the current integrated Octopus schematic and corrected wiring references to identify named endpoints. Record actual connector orientation, continuity and hardware evidence separately from preparation notes. The current visual guide's preparation checkboxes do not grant electrical or motion permission.

The native app has explicit, bounded commissioning sessions and protected workflows. Follow their on-screen prerequisites after the physical checks pass. Synthetic tests and simulation do not satisfy physical evidence. Production arming requires actual accepted machine state; uncertainty, a controller reset, disconnect, stale evidence or failed verification must be resolved before continuing.

Home and prove independent Y behavior before jobs. Verify probe/tool-setter selection, physical direction, bounded travel and offset readback. Prove the independent hardware stop and output-off behavior before cutting. Software Hold or a stopped command stream does not remove hazardous energy or guarantee gravity-loaded Z support.

Legacy generic diagnostic scripts, old sender macros, automatic-current tools and unreviewed G-code files are not the native workflow. They can write settings or move hardware. Do not run them as a shortcut around the current app's prerequisites.

Spindle supervision, orientation, rigid tapping, the lab servo-axis mode and unidentified oil/lubrication remain unqualified; their presence in research source does not enable them. The canonical pending profiles remain locked.
