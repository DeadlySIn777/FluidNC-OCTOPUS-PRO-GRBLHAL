# MR1 Control — Windows / Octopus Pro / grblHAL

The current project is our own **MR1 Control** application for Windows, a
BIGTREETECH Octopus Pro V1.1 with STM32F429, and external CL57T drives.
The repository keeps its original FluidNC name, but this configuration runs
**grblHAL firmware**. gSender is not required.

**Engineering source release. Hardware is not commissioned or released for
machining.** The software checks are not a physical wiring, motion or E-stop test.

## Start here

- [Windows application and startup](mr1-control/README.md)
- [Visual wiring guide](docs/wiring/visual/index.html): download the repository,
  open this file and select **Octopus schematic** or trace a cable from end to end.
- [Wiring reference and readiness](docs/wiring/README.md)
- [Local firmware and optional reference assets](docs/LOCAL-ASSETS.md)
- [Firmware source and provenance](grblHAL-STM32F4/SOURCE-REVISION.json)

The wiring guide includes the driver-socket connections, jumper groups, motor
and encoder cables, drive alarms, home switches, board power and defined outputs.
Its board reference image loads from BIGTREETECH; the wire tables work offline.
Oil/lubrication has no assigned circuit yet.

## Windows setup

Install Node.js 24 and use a local checkout. In PowerShell at this repository:

```powershell
cd mr1-control
npm ci
npm run build
npm test
```

Native startup requires the exact pinned firmware file in the local bundle.
The public tree contains its hash, manifest and source, but not a redistributed
firmware binary. Follow [local asset setup](docs/LOCAL-ASSETS.md), rebuild, then:

```powershell
npm run controller
```

Open `http://127.0.0.1:5174/?native=1`. The native service starts disconnected;
selecting a port and commissioning remain explicit operator steps.
Missing or altered firmware makes native startup fail closed.

## What is included

- Native serial service with exclusive control leases, typed command policy,
  preflight checks, staged commissioning records and streaming safeguards.
- MR1 interface, toolpath preview, job checks, probing and setup workflows.
- Traceable cable schedule and Octopus board view with named source/destination
  terminals, separate unassigned circuits, and unresolved physical checks.
- Complete exported firmware source with component revisions and original
  notices. See its build documentation before compiling anything.
- Automated source and synthetic-controller tests. Optional local artifact
  acceptance tests report skips when their source files are absent.

The machine uses external drives. The Octopus A1/A2/B2/B1 motor-output plugs are
not STEP/DIR outputs. Use the documented empty driver-socket signal locations and
qualified interface; do not infer a cable pinout from the motor-plug lettering.

## Earlier project

The previous F446/TMC2209, Python bridge, Linux setup, motion diagnostics and UI
are retained under [legacy/fluidcnc-2025](legacy/fluidcnc-2025/README-LEGACY.md).
The old firmware-tree bench scripts are in
[legacy/grblhal-diagnostics-2025](legacy/grblhal-diagnostics-2025/README.md).
They are historical material, outside the current MR1 installation path; the
scripts can write settings, disable limits and move motors and must not be run.

## License and release scope

Project-authored application changes continue under the repository's existing
[MIT license](LICENSE). Firmware and third-party components retain their own
licenses. See [distribution notes](docs/DISTRIBUTION.md) and the
[complete notices](mr1-control/THIRD-PARTY-NOTICES.md).

This project is independent of Langmuir Systems, BIGTREETECH and drive vendors.

