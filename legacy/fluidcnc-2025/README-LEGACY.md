# Historical FluidCNC build — superseded

This directory preserves the public repository at `9b4b746` before the Windows
MR1 integration. Its Python servers, launchers, F446/TMC2209 instructions and
motion diagnostics are not part of the current F429/external-CL57T setup.
Follow the [repository README](../../README.md) and the current wiring guide instead.

## Safety

Some scripts automatically open a serial port, write settings or command long
moves. Do not run them to test the current application. In particular,
`test_steppers.py`, `test_slow.py`, `fix_current.py`, and current-setting utilities
are historical programs, not safe test discovery targets. The old firmware-tree
diagnostics are archived separately in
[`../grblhal-diagnostics-2025/`](../grblhal-diagnostics-2025/README.md) and are
equally unsafe.

The archived hardware guide's normally-open E-stop/wire-break claim is incorrect:
an E-stop must be normally-closed and fail-safe. Archived reset/unlock and
automatic DFU instructions must not be applied to the current machine.

## What is archived

- Files are byte-identical to `9b4b746`, including their original LF line
  endings, with three deliberate exceptions: one personal Windows path in
  `docs/LEPOTATO_SETUP.md` was replaced by `C:\Projects\fluidcnc`, and a
  superseded warning was added at the top of `README.md` and
  `docs/HARDWARE_SETUP.md`. `README.md`, `CONTRIBUTING.md`, `SECURITY.md` and
  `.gitignore` are that commit's root files; `upstream-submodule-reference.txt`
  is its `.gitmodules`.
- Device firmware: `esp32-vfd-controller/` (ESP32 H100 VFD Modbus controller),
  `chatter-waveshare-s3/` (Waveshare ESP32-S3 chatter sensor) and
  `xiao-camera/` (XIAO ESP32-S3 Sense camera). The `chatter-amoled-175`
  firmware referenced by the MR1 documentation is **not** in this repository.
- The chatter firmware here prints `{"chatter":{...}}` status lines. The current
  application accepts that shape but maps only the chatter score, dominant
  frequency and the `ok`/`warning`/`chatter` states (`recovering` is shown as
  `warning`; `calibrating` lines are ignored). Its `vib` value is a scaled
  baseline z-score rather than g, and its `spindleTempC` has no health flag, so
  neither is displayed.
- `setup/install.sh` still contains a placeholder repository URL
  (`your-username/fluidcnc`); the one-line install commands in the archived
  docs do not work as written.

## Rebuilding the old firmware

The archived README's `cd grblHAL-STM32F4 && pio run -e btt_octopus_pro_v1_1`
instructions do not work from this tree (that environment name also never
existed; the archived `grblhal-octopus-pro-v11/` configuration defines
`btt_octopus_pro_v11_f446`). The repository's `grblHAL-STM32F4/` is now the MR1
firmware source export: its legacy targets (`btt_octopus_pro_f429`,
`_standalone`, `_tmc5160`, `_tmc2130`) cannot build because the trinamic, motors
and sdcard plugins are omitted.

To rebuild the old firmware, check out `9b4b746` and run
`git submodule update --init --recursive`; the gitlink pins the public
[grblHAL/STM32F4xx](https://github.com/grblHAL/STM32F4xx.git) at
`cf337b68bdc48579365f8f924060bb9ba8c1e60b`, then follow
`grblhal-octopus-pro-v11/README.md`. That produces upstream plugin code only:
the local trinamic (`15984f2b…`) and motors (`88c47cd5…`) plugin commits
recorded in `grblHAL-STM32F4/SOURCE-REVISION.json` were never pushed upstream
and exist only on the original development PC. All original Git history
remains available.
