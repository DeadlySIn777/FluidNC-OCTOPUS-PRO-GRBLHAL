# Historical FluidCNC build — superseded

This directory preserves the public repository at `9b4b746` before the Windows
MR1 integration. Its Python servers, launchers, F446/TMC2209 instructions and
motion diagnostics are not part of the current F429/external-CL57T setup.

Some scripts automatically open a serial port, write settings or command long
moves. Do not run them to test the current application. In particular,
`test_steppers.py`, `test_slow.py`, `fix_current.py`, and current-setting utilities
are historical programs, not safe test discovery targets.

The archived hardware guide's normally-open E-stop/wire-break claim is incorrect.
Archived reset/unlock and automatic DFU instructions must not be applied to the
current machine. Follow the current root README and corrected wiring guide.

The old upstream gitlink was `cf337b68bdc48579365f8f924060bb9ba8c1e60b` in
`https://github.com/grblHAL/STM32F4xx.git`; `upstream-submodule-reference.txt`
records its original configuration. The current firmware source is separately
exported at the repository root. All original Git history remains available.

