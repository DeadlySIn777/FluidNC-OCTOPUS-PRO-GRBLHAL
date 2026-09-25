# MR1 firmware engineering source

This is the audited grblHAL STM32F4 driver source for **BIGTREETECH Octopus Pro v1.1 / STM32F429ZGT6**, with four external **CL57T V4.1** drives and matched **23HS45-4204D-E1000** motors. It accompanies the project's own [Windows control application](../mr1-control/). DM860T hardware is a separate rollback set; TMC plug-in driver configurations are legacy targets.

**Source-only engineering release. Physical wiring, flashing and machining are unverified. No firmware binary is distributed here.** The inherited USB middleware license is retained exactly; a compatible alternative grant for the exact files has not been established. See [source and license provenance](SOURCE-PROVENANCE.md).

Start with [the MR1 engineering overview](mr1/README.md), the corrected [wiring plan](mr1/WIRING.md), and the repository's current wiring guide. Firmware source and software tests do not qualify physical terminals, modules, power circuits or motion.

Known defects of the pinned firmware that need a new, requalified firmware candidate (no status reports while homing, unread per-axis drive-fault inputs, unclaimed auxiliary outputs, probe wire-break behaviour, unpinned toolchain, legacy-target hazards) are listed in [FIRMWARE-KNOWN-ISSUES.md](FIRMWARE-KNOWN-ISSUES.md).

## Build and checks on Windows

Install a real Python 3 interpreter, Git if needed for source inspection, and PlatformIO Core. This source export already contains the three required dependencies; no submodule initialization is needed. From this directory:

```powershell
python tools/validate_mr1_profile.py
python tools/validate_mr1_macros.py
python tools/test_mr1_workflows.py
pio run -e btt_octopus_pro_f429_mr1
python tools/validate_mr1_profile.py
Get-FileHash .pio/build/btt_octopus_pro_f429_mr1/firmware.bin -Algorithm SHA256
```

These commands build a local image; they do not flash or connect to a machine. The only production environment is `btt_octopus_pro_f429_mr1`. Its application starts at `0x08008000`, preserving the 32 KiB BTT bootloader. Never substitute an F446/H723 target, an older Octopus revision, or the nonproduction servo-axis lab environment. Runtime SD, Modbus and Trinamic control are disabled in the production profile.

The historical candidate was 221,304 bytes with SHA-256 `F4AB32BD2CB7D0985A07915CF1C4349A3A7FD8546C765265B23EB98B904E5E9D`. That is a comparison reference, not an artifact included in this release. The source-machine compiler/package inventory was not available for this export; inherited `ststm32` and framework constraints are not a hermetic toolchain lock. A different rebuild must be investigated and documented before becoming an accepted firmware candidate. No upload target is part of these instructions.

## Source layout

`Src/`, `Inc/`, the local board definitions, linker scripts, startup code, HAL/USB support and build files come from the audited STM32F4 tree. `grbl/`, `spindle/` and `eeprom/` are flattened copies of its exact production dependency revisions. `SOURCE-REVISION.json` records commit IDs, original file hashes, deliberate exclusions and documentation overlays. `mr1/expected-settings.json` contains 66 expectations including `$13=0`; `$N0` and `$N1` must both be returned empty during the current application's read-only preflight.

The historical root diagnostic scripts (42 Python bench programs for the old TMC2209 board that hard-code `COM5`, write settings, disable limits and move motors) were moved to [`legacy/grblhal-diagnostics-2025/`](../legacy/grblhal-diagnostics-2025/README.md) and must not be run. The remaining root Python files (`extra_script.py`, `flexi_script.py`, `uf2conv.py`) are upstream PlatformIO build helpers for other boards. Generic wiring/configuration files such as `WIRING_GUIDE.md` are retained as source history only; they are not MR1 commissioning instructions. Use the current native application and reviewed procedure. The original interactive wiring-map, vendor PDFs/images, build output and capture journals are excluded.

Each component keeps its own copyright and license notices. The surrounding application repository's license does not replace them.
