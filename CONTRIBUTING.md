# Contributing

Work on `mr1-control/` for the Windows controller, `tools/visual-wiring/` for the
guide, and `grblHAL-STM32F4/` for the exported firmware source. `legacy/` preserves
the previous system and is not the test or launch target.

Use Node.js 24 and Python 3. Run `npm ci`, `npm run build`, and `npm test` from
`mr1-control/`; run the documented visual-guide data/model checks before rebuilding
the guide. Tests must use synthetic ports. Do not add automatic serial discovery,
unlock, motion, reset, flashing or settings writes to a startup or test command.

Keep machine authority in the native service. Browser controls do not establish
hardware identity, a valid lease, wiring acceptance or permission to machine.
Missing evidence must not be converted to successful commissioning by defaults.

Document source revisions and preserve component notices. Local imported firmware,
CAD, vendor images, CAM posts, generated logs and commissioning records are not
part of the public source tree. Use the pinned local-import workflow where needed.

A pull request should state the resulting behavior, relevant automated results,
any skipped checks, and whether physical hardware was tested. Do not describe
source inspection or a mock controller as a physical acceptance test.

