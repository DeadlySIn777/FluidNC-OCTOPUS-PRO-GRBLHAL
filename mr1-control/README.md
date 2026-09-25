# MR1 Control for Windows

This is the custom MR1 console: a browser interface served by its own local Node.js serial controller. It uses grblHAL on a BTT Octopus Pro v1.1 / STM32F429 with four CL57T V4.1 drives. gSender, the archived Python bridge and Web Serial are not part of this command path.

This public source is an **engineering candidate, hardware uncommissioned**. It contains no passing physical-machine evidence and does not authorize wiring, energizing or cutting. See [NATIVE_CONTROL.md](NATIVE_CONTROL.md) for implemented behavior and remaining bench work.

## Start from source on Windows

Use Node.js **24** with npm. From this directory:

```powershell
npm ci
npm run build
npm run controller
```

Then open `http://127.0.0.1:5174/?native=1`. After installing dependencies and building, `START-MR1-SOURCE.cmd` is an equivalent foreground launcher. Keep its console open; use Disconnect and the native service shutdown control before closing a connected session. No COM port opens automatically.

**The native service requires the exact locally supplied firmware image before it can start.** Firmware binaries and selected third-party images, CAD and Fusion post files are excluded from this public source pending redistribution clearance. Follow [Local assets](../docs/LOCAL-ASSETS.md) to import a previously obtained matching file or a reviewed build. The immutable manifest and SHA-256 checks remain in source. After importing into `public/`, rebuild `dist/`. Your existing local development/portable installation remains separate and is not modified by this source checkout.

A missing or mismatched firmware image stops the native HTTP service before serial enumeration or connection. There is no fallback that grants machine authority. A source build alone does not prove the firmware installed on a board.

To inspect the interface without local firmware, use `npm run dev` and open `http://127.0.0.1:5173/`. This is the development preview, not a running native controller. Optional CAD load failures leave the existing procedural preview; that geometry is not measured machine evidence. Missing manufacturer images must be viewed at the attributed manufacturer source or imported locally before using them as a physical reference.

## What is implemented

- Explicit COM selection, exclusive serial ownership, an exact read-only identity/settings handshake and empty startup-block checks.
- Expiring browser ownership, fresh controller-state requirements, typed commands, durable logging, bounded transactions and cancellation without automatic command retries.
- Homing, bounded jog, work offsets, spindle/coolant control and validated NC streaming with explicit manual tool-change pauses.
- Staged commissioning sessions, protected probe/setter plans and separate confirmed offset/tool-length writes with readback.
- Toolpath preview, conversational CAM, fixture planning, metrology, scene registration, firmware-file checks and wiring evidence records.

The native panel distinguishes disconnected/unknown state from live observations. Demonstration geometry and a controller-reported coordinate do not prove physical position. Closed-loop encoder feedback stays between each motor and its own drive; it does not prove table position or a sound coupling.

The independent hardwired stop, drive/interface electrical tests, measured directions/travel, dual-Y squaring, spindle scaling, USB-loss behavior and cutting acceptance still require real evidence. Software tests do not replace those checks.

## Tests

```powershell
npm run build
npm test
```

The normal suite uses synthetic serial transports and temporary journals. It must not open a real COM port. The exported sibling `../grblHAL-STM32F4` source/reference tree supplies the pinned machine contract. No `.pio` build directory is required for ordinary source tests.

Actual optional firmware/image/CAD acceptance tests report **SKIP** when their local files are absent. Manifest assertions, manufactured-image rejection, missing/truncated firmware rejection, evidence gates and controller/policy/workflow tests still run. A local firmware build, when present, must match the pinned bytes and SHA-256; its absence is never reported as a successful reproduction.

The HTTP controller contract suite uses Node 24's test-only module mock for artifact identity, enabled by `npm run test:native`. The real firmware verifier is tested separately and remains unconditional in production. The qualification-time real-image tamper integration test runs only when that exact optional local image is available.

Optional browser suites (`test:visual`, `test:ui-*`, `test:jog-sync`) are separate from `npm test`. Install the developer tools you intend to use (`playwright`, and `sharp` for visual comparison), or set `MR1_BUNDLED_NODE_MODULES` to an explicit existing dependency directory. `PLAYWRIGHT_CHROME` may select your browser executable; otherwise Playwright uses its installed browser. No personal Codex paths are required. Run browser tests only when that workflow is authorized and its preview services are set up.

The separate Fusion engine check needs a locally available approved post and Autodesk installation. Generated vendor benchmark output and old performance captures are not shipped as project-owned examples. NC policy coverage uses authored synthetic programs. SolidCAM source and its isolated structural/installer tests remain available under `post-processors/solidcam/`.

## Local state and development tools

Machine setup and evidence remain explicit operator records. Browser preferences stay browser-local. Native journals and commissioning recovery records use the service's local data directory; do not commit them or treat a saved preparation tick as physical qualification. Existing interrupted-setting restoration checks remain active.

`npm run telemetry:sim` and the older `npm run package:simulator` companion launcher are development simulators. They are separate from `npm run controller`; do not use them as native launch shortcuts.

## Packaging and attribution

After local assets are available and the build/tests pass, the native package builder is:

```powershell
npm run package:native -- ..\release\MR1-Native-local
```

`package:portable` is an alias for this native builder. The destination must be new and outside this app. It copies the running Node executable, locked serial dependencies, notices, the built app and native launcher, and writes `BUILD-MANIFEST.json`. The packaged `START-MR1-NATIVE.cmd` assumes the complete extracted package layout. This source launcher does not manufacture that package or approve public redistribution.

Retain [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md), upstream notices and the repository license. Firmware, vendor CAD/images and Autodesk-derived post material have separate terms; importing a local file does not license it for republication. The firmware artifact check verifies bundled file bytes only, never an on-device flash readback.
