# Firmware source provenance and release boundaries

The STM32F4 driver snapshot is the local MR1 audit commit `41134da4eaea8ac7f64f7dd69b89e9312e228147`, based on `fbd4eb786eabfbe3d5fe87fc84ceb2bc59a47d64`, with upstream `https://github.com/grblHAL/STM32F4xx.git`. A local commit identity is provenance; it is not a claim that the same commit is published upstream.

The production dependency graph is flattened into normal source directories:

| Directory | Original repository | Exact revision |
| --- | --- | --- |
| `grbl` | `https://github.com/grblHAL/core` | `779d41b8d86e3042f13df326d92dd34ae1825e24` |
| `spindle` | `https://github.com/grblHAL/Plugins_spindle` | `c9c8e6db16ef2955b00f2fd523d1f823e88c7392` |
| `eeprom` | `https://github.com/grblHAL/Plugin_EEPROM` | `17f2a977087cd52afd9f7f416b53940fb32de65c` |

These revisions had clean tracked source when exported. No nested Git repositories or build caches are required. The source manifest retains all original gitlinks, identifies unused plugins omitted from the production graph, and records original and final file hashes. Only documentation, release metadata and the active-drive comment in `platformio.ini` are changed; LF normalization follows the inherited `.gitattributes`. Firmware C/C++ and machine-profile behavior are unchanged.

## Build provenance

The historical local ELF contains this compiler comment: `GCC: (GNU Tools for Arm Embedded Processors 7-2017-q4-major) 7.2.1 20170904 (release) [ARM/embedded-7-branch revision 255204]`. This identifies a compiler string, not the complete package inventory.

An installed PlatformIO platform/framework/toolchain inventory was unavailable on this PC. The inherited configuration uses `platform = ststm32` and `framework-stm32cubef4 @ ~1.26.2`; they have not been replaced with invented exact package versions. A reproducible source export is provided, but no independently reproduced or hermetic firmware build is claimed. Preserve build logs, resolved package versions and a new output hash when rebuilding. No compiled binary is included.

## Retained component licenses

The driver and core keep their original `COPYING` files and per-file notices. HAL and other ST components keep their original notices. The USB middleware keeps `Middlewares/ST/STM32_USB_Device_Library/LICENSE.txt` (SLA0044 Rev5) and its source headers unchanged. The enclosing application repository's license does not relicense these components.

Bounded official-source review did **not** establish an alternative BSD grant for the exact exported USB implementation. ST's [v2.11.3 component license](https://github.com/STMicroelectronics/stm32-mw-usb-device/blob/v2.11.3/LICENSE.md) is SLA0044 Rev5; its [current component license](https://github.com/STMicroelectronics/stm32-mw-usb-device/blob/master/LICENSE.md) likewise states SLA0044 terms. These references are evidence of the unresolved grant question, not a conclusion that this exported implementation matches that tag. No third-party header or license has been relabeled. A compatible grant for the exact files remains unresolved; a public linked firmware binary is withheld.

## Engineering status

The corrected wiring data come from the 2026-09-24 reference audit, and the current expected profile contains 66 settings, including `$13=0`, with read-only `$N` queries. All physical commissioning and pending servo gates remain open/false. The export does not energize hardware, install settings, flash a board or grant motion permission.

Run `python tools/verify_source_export.py` to compare this exported tree with its final manifest; then run the profile, macro and workflow checks in the main README. A source check cannot replace a compiled-image or physical acceptance check.
