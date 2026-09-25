# Firmware source provenance and release boundaries

The STM32F4 driver snapshot is the local MR1 audit commit `41134da4eaea8ac7f64f7dd69b89e9312e228147`, based on `fbd4eb786eabfbe3d5fe87fc84ceb2bc59a47d64`, with upstream `https://github.com/grblHAL/STM32F4xx.git`. A local commit identity is provenance; it is not a claim that the same commit is published upstream. Neither commit exists in the public upstream repository; they identify the original development checkout only. The public base and every local difference are listed under [Public upstream base and local delta](#public-upstream-base-and-local-delta).

The production dependency graph is flattened into normal source directories:

| Directory | Original repository | Exact revision |
| --- | --- | --- |
| `grbl` | `https://github.com/grblHAL/core` | `779d41b8d86e3042f13df326d92dd34ae1825e24` |
| `spindle` | `https://github.com/grblHAL/Plugins_spindle` | `c9c8e6db16ef2955b00f2fd523d1f823e88c7392` |
| `eeprom` | `https://github.com/grblHAL/Plugin_EEPROM` | `17f2a977087cd52afd9f7f416b53940fb32de65c` |

These revisions had clean tracked source when exported. No nested Git repositories or build caches are required. The source manifest retains all original gitlinks, identifies unused plugins omitted from the production graph, and records original and final file hashes. Only documentation, release metadata and the active-drive comment in `platformio.ini` are changed; LF normalization follows the inherited `.gitattributes`. Firmware C/C++ and machine-profile behavior are unchanged.

## Public upstream base and local delta

The public base of this tree is upstream [grblHAL/STM32F4xx](https://github.com/grblHAL/STM32F4xx) commit `4343665f1e8dde29631db94bc11d53d3d4e5bfa2` ("Updated submodules", 2026-01-07). Every upstream file not listed below is byte-identical to that commit. Its `grbl`, `spindle` and `eeprom` gitlinks are exactly the revisions in the table above, and the flattened directories are byte-identical to them: `grbl/` (117 files) to grblHAL/core `779d41b8`, `spindle/` (21 files) to Plugins_spindle `c9c8e6db`, `eeprom/` (9 files) to Plugin_EEPROM `17f2a977`.

The earlier repository (`9b4b746`) pinned upstream `cf337b68bdc48579365f8f924060bb9ba8c1e60b` (2026-01-17). This tree does **not** contain the two upstream changes between `4343665` and `cf337b68`, neither of which is used by the MR1 build:

- `40c897b` "Updated Web Builder definitions": `driver.json` `digital_in` 5 to 7 for the SuperLongBoard and SuperLongBoard External entries.
- `6d026c0` "Fix Coolant Flood and Mist swap": `boards/Devtronic_CNC_Controller_V2_map.h` swaps the flood/mist pins (PC15/PC14 to PC14/PC15).

`SOURCE-REVISION.json` also records local `trinamic` (`15984f2b65b42e43d229c7d79014264f9ef24e38`) and `motors` (`88c47cd5ae62f848308bcc39d022bf87f93400ac`) plugin gitlinks. These commits were never pushed upstream (upstream `4343665` pins `e0ab000b` and `8cfaed65`) and exist only on the original development PC. Both plugins are omitted from this export and are not part of the MR1 build.

Upstream files changed in this tree, compared with `4343665`:

| File | Local change |
| --- | --- |
| `Inc/driver.h` | Board selectors for `BOARD_BTT_OCTOPUS_PRO_MR1`, `_F429` and `_SLOTS345`. |
| `Inc/my_machine.h` | Legacy TMC2209 / ESP-AT / Wi-Fi station configuration (credentials replaced by empty placeholders). Not compiled by any PlatformIO environment here, which all set `-D OVERRIDE_MY_MACHINE`. |
| `Src/driver.c` | Adds the raw `$TST` step-pulse test; `$TST`, `$DFU`/`$UF2` and their report hook are compiled out under `MR1_PRODUCTION_PROFILE`. |
| `Src/main.c` | Switches SYSCLK to HSI before PLL reconfiguration for the Octopus F429/MR1 boards (the BTT bootloader leaves the PLL running). |
| `Src/serial.c` | Inverted RS-485 direction pin with a transmit-complete busy-wait; not used by MR1 (Modbus disabled). |
| `Src/tmc_uart.c` | TMC2209 soft-UART fixes and an Octopus `board_init()` for the legacy TMC targets. |
| `boards/btt_octopus_pro_map.h` | Rewritten for the old TMC2209 motor-slots-3/4/5 bench setup. It assigns **PA0 to both `X_ENABLE` and `AUXOUTPUT0` (spindle enable)**; only the legacy `BOARD_BTT_OCTOPUS_PRO`/`_F429` targets use it. Never build them for a machine (see [FIRMWARE-KNOWN-ISSUES.md](FIRMWARE-KNOWN-ISSUES.md)). |
| `platformio.ini` | Upstream environments replaced by the MR1 production/lab and legacy Octopus environments. |
| `.gitignore`, `README.md` | Local build/capture ignores; MR1 README. |
| `STM32F401CCUX_BL16K_FLASH.ld` | Line endings only. |

Omitted upstream files: `.gitmodules` (flattened) and `media/STM32F4xx_config.png`. Added files: `mr1/`, `tools/`, `Inc/mr1_octopus_config.h`, `Inc/mr1_servo_axis_lab_config.h`, `boards/btt_octopus_pro_mr1_map.h`, `boards/btt_octopus_pro_f429_rogerlz_map.h`, `boards/btt_octopus_pro_slots345_map.h`, `boards/genericSTM32F429ZG.json`, `boards/genericSTM32F429ZGT6.json`, `boards/genericSTM32F446ZE.json`, `STM32F429ZGTX_BL32K_I2C_FLASH.ld`, `library.json` files for the FatFs/USB/media library folders, `WIRING_GUIDE.md` (legacy) and the provenance/known-issues documents.

After the export, this repository moved the 42 historical root diagnostic scripts to `legacy/grblhal-diagnostics-2025/`, replaced the Wi-Fi credentials in `Inc/my_machine.h` with placeholders, corrected two message strings in `tools/validate_mr1_profile.py` and added `FIRMWARE-KNOWN-ISSUES.md`; no compiled MR1 source changed.

## Build provenance

The historical local ELF contains this compiler comment: `GCC: (GNU Tools for Arm Embedded Processors 7-2017-q4-major) 7.2.1 20170904 (release) [ARM/embedded-7-branch revision 255204]`. This identifies a compiler string, not the complete package inventory.

An installed PlatformIO platform/framework/toolchain inventory was unavailable on this PC. The inherited configuration uses `platform = ststm32` and `framework-stm32cubef4 @ ~1.26.2`; they have not been replaced with invented exact package versions. A reproducible source export is provided, but no independently reproduced or hermetic firmware build is claimed. Preserve build logs, resolved package versions and a new output hash when rebuilding (see item (h) in [FIRMWARE-KNOWN-ISSUES.md](FIRMWARE-KNOWN-ISSUES.md)). No compiled binary is included.

## Retained component licenses

The driver and core keep their original `COPYING` files and per-file notices. HAL and other ST components keep their original notices. The USB middleware keeps `Middlewares/ST/STM32_USB_Device_Library/LICENSE.txt` (SLA0044 Rev5) and its source headers unchanged. The enclosing application repository's license does not relicense these components.

Bounded official-source review did **not** establish an alternative BSD grant for the exact exported USB implementation. ST's [v2.11.3 component license](https://github.com/STMicroelectronics/stm32-mw-usb-device/blob/v2.11.3/LICENSE.md) is SLA0044 Rev5; its [current component license](https://github.com/STMicroelectronics/stm32-mw-usb-device/blob/master/LICENSE.md) likewise states SLA0044 terms. These references are evidence of the unresolved grant question, not a conclusion that this exported implementation matches that tag. No third-party header or license has been relabeled. A compatible grant for the exact files remains unresolved; a public linked firmware binary is withheld.

## Engineering status

The corrected wiring data come from the 2026-09-24 reference audit, and the current expected profile contains 66 settings, including `$13=0`, with read-only `$N` queries. All physical commissioning and pending servo gates remain open/false. The export does not energize hardware, install settings, flash a board or grant motion permission.

Run `python tools/verify_source_export.py` to compare this exported tree with its final manifest; then run the profile, macro and workflow checks in the main README. A source check cannot replace a compiled-image or physical acceptance check.
