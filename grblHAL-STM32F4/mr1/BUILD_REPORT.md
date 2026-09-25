# MR-1 Firmware Build Report

> Historical build evidence. The source export adds documentation/profile corrections without changing firmware logic. The current profile validates 66 settings, including `$13=0`, and queries `$N`; the 65-setting transcript below predates that audit. This public release contains no binary and makes no independent/hermetic rebuild or physical-flash claim.

Last clean verification: 2026-08-27

## Result

### Production Image

| Item | Value |
| --- | --- |
| PlatformIO environment | `btt_octopus_pro_f429_mr1` |
| Result | PASS |
| MCU | STM32F429ZGT6, 168 MHz |
| Oscillator definition | 8 MHz |
| Bootloader reservation | 32 KiB |
| Application/vector origin | `0x08008000` |
| Initial stack pointer | `0x20030000` |
| Reset vector | `0x08032B9D` |
| Raw image size | 221,304 bytes |
| RAM use | 26,532 / 262,144 bytes, 10.1 percent |
| Reported flash use | 220,856 / 1,048,576 bytes, 21.1 percent |
| SHA-256 | `F4AB32BD2CB7D0985A07915CF1C4349A3A7FD8546C765265B23EB98B904E5E9D` |

Image:

```text
.pio\build\btt_octopus_pro_f429_mr1\firmware.bin
```

The image is raw and has no DFU suffix. ELF inspection reports `.isr_vector` at
VMA/LMA `0x08008000`. The reset vector is Thumb code inside the application
region, and the initial stack pointer is at the top of the STM32F429 main SRAM.
Binary string checks also confirm that `$TST`, `$ODOMETERS`, runtime DFU/UF2
entry, and the hard-coded direct-GPIO step test are absent from this production
image. A clean removal of the target build directory followed by a from-scratch
build produced the recorded image size, vectors, memory use, and SHA-256.

The verified image is also published with a machine-readable manifest at
`mr1-control/public/firmware/octopus-pro-v1.1-f429-mr1/`. The app's release test
requires that copy to be byte-identical to this clean build before packaging.

This build also includes the Octopus Pro MR-1 board in the STM32F429
bootloader clock cleanup. Startup now switches SYSCLK to HSI before the HAL
disables and reconfigures the PLL, avoiding a reconfiguration of the active
clock source left by the BTT SD bootloader.

The profile adds probe target clamping (`$65=2`), keeps automatic tool change
disabled (`$341=0`), and reduces the inactive tool-setter fine search to a
3 mm total limit (`$342=3`) with 50 mm/min seek, 10 mm/min latch, and
50 mm/min pull-off defaults (`$344`, `$343`, `$345`). It also includes explicit
dual-Y homing failure limits (`$347=1`, `$348=2.5`, `$349=8`). At the initial
546.10 mm Y travel, grblHAL aborts after 5.461 mm of commanded side-to-side
mismatch.

The final spindle-control decision is digital first with an isolated analog
fallback. This image intentionally remains the forward-only analog production
baseline: `MODBUS_ENABLE=0`, every pending servo permit is false, and the write
whitelist is empty. The selected digital architecture is documented and
machine-audited without pretending the unidentified drive is commissioned.

### Servo-Axis Qualification Image

| Item | Value |
| --- | --- |
| PlatformIO environment | `btt_octopus_pro_f429_mr1_servo_axis_lab` |
| Result | PASS - source/build qualification only |
| Logical / physical motion | XYZA / X, Y-left, Z, A, Y-right |
| PWM spindle output | Disabled to prevent dual command authority |
| Application/vector origin | `0x08008000` |
| Initial stack pointer | `0x20030000` |
| Reset vector | `0x0803290D` |
| Raw image size | 220,580 bytes |
| RAM use | 26,604 / 262,144 bytes, 10.1 percent |
| Reported flash use | 220,132 / 1,048,576 bytes, 21.0 percent |
| SHA-256 | `14146D298F1F4E06B88DCFB0082E9335E77EC11ED9E2F7740FFA48BC56189E47` |

Image:

```text
.pio\build\btt_octopus_pro_f429_mr1_servo_axis_lab\firmware.bin
```

This image contains `MR1 SERVO AXIS LAB - DO NOT USE IN PRODUCTION`; the
production binary does not. It compiles four logical axes plus ganged Y2,
routes A to physical MOTOR4, keeps Y-right on physical MOTOR3, enables the
reviewed mixed rotary planner path, and disables PWM spindle control. The lab
image was built but not flashed.

The provisional maximum A command is 66,666.7 pulses/second at 8000 spindle
RPM. The configured 5 microsecond pulse plus the driver's 2 microsecond minimum
off time gives a 142,857.1 pulse/second period ceiling. This is timing/source
evidence only; logic-analyzer and installed-drive tests remain open.

## Profile Audit

```text
MR-1 profile audit: PASS
- canonical PlatformIO environment isolated from legacy targets and plugins
- servo-axis qualification is a separate, non-default F429 bootloader target
- F429 bootloader handoff switches SYSCLK to HSI before PLL reconfiguration
- USB-only production profile; network, WebUI, Modbus, and runtime SD disabled
- rigid tapping NO-GO: G33.1 rejected, no motion implementation, 11 physical proof gates locked
- servo-axis tapping source path: 4 logical axes, 5 collision-free motion outputs, A max 66666.7 Hz < 142857.1 Hz pulse ceiling
- servo-axis hardware proof remains locked: 0 of 23 gates passed
- pending spindle supervision profile: 8 permits locked, 10 reference registers unapproved
- 32 KiB BTT bootloader preserved; application origin 0x08008000
- 31 unique GPIO assignments; 15 unique EXTI inputs
- X maximum command rate: 13546.7 steps/s
- Y maximum command rate: 13546.7 steps/s
- Z maximum command rate: 9031.1 steps/s
- 65 startup settings cross-checked against the firmware profile
- Windows preflight policy contains read-only status and report queries only
- dual-Y homing abort distance: 5.461 mm at initial travel
- 3 phase-zero macros contain only M5, M9, and explicit probe selection
- Octopus Pro v1.1 MOTOR3 enable revision check: PA2
- servo candidates held: PD5/PD6 isolated Modbus, PE15 direction; PB7 remains tool setter
- production image excludes $TST, $ODOMETERS, and runtime bootloader-entry commands
- compiled image: 221304 bytes; SP 0x20030000; reset 0x08032B9D
- servo-axis lab image: 220580 bytes; SP 0x20030000; reset 0x0803290D; non-production marker present
```

## Build Notes

The canonical target now links only grblHAL core, spindle, EEPROM, and USB
device libraries. It no longer compiles the unused Trinamic, Bluetooth, keypad,
laser, embroidery, or runtime-SD plugin libraries, and the clean C/C++ build
finishes without compiler warnings.

PlatformIO also prints warnings for malformed/empty library manifests in the
broader upstream working tree while scanning `lib_extra_dirs`. The canonical
dependency graph is explicit and contains only the seven reviewed entries; the
warnings do not change the linked image. They are upstream checkout cleanup,
not permission to skip board-level commissioning tests.

## Reproduce

```powershell
python tools\validate_mr1_profile.py
python tools\test_mr1_workflows.py
pio run -e btt_octopus_pro_f429_mr1
pio run -e btt_octopus_pro_f429_mr1_servo_axis_lab
python tools\validate_mr1_profile.py
Get-FileHash .pio\build\btt_octopus_pro_f429_mr1\firmware.bin -Algorithm SHA256
Get-FileHash .pio\build\btt_octopus_pro_f429_mr1_servo_axis_lab\firmware.bin -Algorithm SHA256
```

If `python` is not on `PATH` (PlatformIO installed, no system Python), use
PlatformIO's own interpreter for the three `.py` steps — see "Python
interpreter" in `README.md`:

```powershell
& "$env:USERPROFILE\.platformio\penv\Scripts\python.exe" tools\validate_mr1_profile.py
```

Any source, compiler, submodule, linker, or PlatformIO change invalidates this
hash and requires a new report.

Reproduced 2026-09-16 on the original machine: `pio run -e
btt_octopus_pro_f429_mr1 --target clean` followed by a full rebuild produced a
byte-identical image — same 221,304-byte size and the same SHA-256 recorded
above. This is same-machine determinism, not hermeticity; an independent
rebuild on a second machine is still outstanding.
