# MR-1 Octopus Qualification Record

Audit date: 2026-08-23

## Verdict

The comparison that declares Acorn the automatic winner mixes four different
questions. The corrected result is:

| Claim | Audited verdict |
| --- | --- |
| Octopus lacks enough MR-1 I/O | Incorrect for this custom map |
| Upstream F429 target is marked untested | Correct, but it is not this target |
| CL57T closes its loop in the drive, not the CNC controller | Correct for Octopus, standard Acorn, and MASSO |
| Current production image has proved `G33.1` rigid tapping | Incorrect; it intentionally rejects it |
| Octopus cannot implement rigid tapping | Not established; the separate coordinated A/Z source path builds and passes static proof |
| The machine can rigid tap today | Incorrect; 0 of 23 physical gates have passed |
| Acorn is the universal winner | Unsupported; it wins the documented conventional rigid-tapping category, not cost, I/O density, customization, or already-owned hardware |

## I/O Evidence

The production map has 31 unique GPIO assignments and uses 15 collision-free
STM32 EXTI lines. EXTI8 remains unused. It provides:

| Input class | Independent channels |
| --- | ---: |
| X, Y-left, Z, Y-right home | 4 |
| X, Y-left, Z, Y-right drive fault | 4 |
| Touch probe and fixed tool setter | 2 |
| E-stop monitor, door, feed hold, cycle start | 4 |
| Aggregate spindle/cabinet/safety fault | 1 |
| Total interrupt inputs | 15 |

The aggregate machine-fault channel does not erase the four axis-drive fault
channels. Detailed servo diagnostics can later arrive over isolated digital
telemetry while any safety-critical spindle/cabinet chain still opens the
hard-stop input. Standard Acorn's eight onboard inputs would require external
fault aggregation or expansion to preserve the same list.

Outputs include four production motion channels, spindle enable and PWM,
flood, mist/air, and a reserved direction output. The lab target adds a fifth
motion channel for spindle-servo A without moving the existing Y-right pins.

Canonical evidence:

- `io-manifest.json`
- `../boards/btt_octopus_pro_mr1_map.h`
- `../tools/validate_mr1_profile.py`

## F429 Evidence

The official generic grblHAL driver metadata currently labels the Octopus Pro
1.1 F429 target untested. That warning is valid for the upstream generic target
and must not be deleted or paraphrased into a runtime certification. The reason
for keeping this project separate is concrete: current upstream metadata pairs
the F429 entry with `HSE_VALUE=12000000` and an F429 `VGTX` linker layout, while
the official BTT v1.1 schematic explicitly labels the populated alternatives
`STM32F446ZET6:12MHz` and `STM32F429ZGT6:8MHz`.

This project does not use that target. Its dedicated environments explicitly
set:

- `genericSTM32F429ZG` and `stm32f429zgt6`, not an F429VG linker layout.
- `STM32F429ZGTX_BL32K_I2C_FLASH.ld` with the application at `0x08008000`.
- The board's 8 MHz HSE.
- A bootloader handoff that switches SYSCLK to HSI before reconfiguring the PLL.
- Raw SD-bootloader images with no DFU suffix.

A clean build produced both images:

| Image | Size | Reset vector | SHA-256 |
| --- | ---: | --- | --- |
| Production XYZ + Y2 | 221,304 bytes | `0x08032B9D` | `F4AB32BD2CB7D0985A07915CF1C4349A3A7FD8546C765265B23EB98B904E5E9D` |
| Servo-axis lab XYZA + Y2 | 220,580 bytes | `0x0803290D` | `14146D298F1F4E06B88DCFB0082E9335E77EC11ED9E2F7740FFA48BC56189E47` |

Both have a valid STM32F429 stack pointer and bootloader-offset reset vector.
The production binary excludes the lab marker. The lab binary contains `MR1
SERVO AXIS LAB - DO NOT USE IN PRODUCTION`.

This proves compile-time device, linker, clock source, vectors, and source
allocation. It does not prove USB enumeration, GPIO voltage, interrupt
polarity, noise immunity, or sustained runtime on the physical board.

## Closed-Loop Meaning

The planned CL57T drives compare commanded step/direction with each motor
encoder, correct locally, and assert an alarm when following error exceeds the
configured limit. Octopus receives that alarm and stops. Standard Acorn and
MASSO use the same drive-local loop for this class of drive; neither turns a
CL57T into controller-level continuous encoder feedback merely by changing the
step/direction source.

That makes the comparison's closed-loop description correct but not an Acorn
advantage. A true controller-level loop would require a controller and drive
interface designed to return continuous axis position into trajectory control.

## Rigid-Tapping Source Proof

The production image still rejects `G33.1`. The alternate method represents
the position-mode spindle servo as rotary A and commands A and Z in one `G93`
inverse-time move. The return block is the exact vector inverse. grblHAL's
Bresenham step stream preserves the pulse ratio, and its exact-reversal planner
branch uses the configured zero minimum junction speed.

With the provisional 1000 pulse motor command and measured-design 2:1 spindle
overdrive:

```text
A steps/degree = 1000 / (2 x 360) = 1.388888889
A pulse rate at 8000 spindle RPM = 66,666.7 Hz
5 us pulse + 2 us enforced off-time ceiling = 142,857.1 Hz
F429 step timer = 21 MHz = 315 timer ticks per worst-case A pulse
```

The source, profile validator, binary marker checks, UI calculator, and Node
tests all pass. This proves a technically coherent Octopus trajectory path. It
does not prove the unidentified servo accepts the assumed pulse format or that
the real spindle and Z axis track it under load.

## Physical Proof Still Required

No Octopus serial device or installed servo drive was connected during this
audit. The lab image was built, not flashed. Before cabinet or production
approval, complete every false gate in `servo-axis-tapping.pending.json`,
including:

1. Board/MCU photo, boot, USB, reset, and watchdog proof.
2. Logic-analyzer proof of X, Y-left, Z, A, and Y-right outputs together.
3. Independent dual-Y homing and every input/fault injection.
4. Installed-drive identity, complete parameter archive, and connector map.
5. Position mode, speed/position switching, isolated pulse/direction, gearing,
   forward/reverse, following error, hard fault, and safe disconnect behavior.
6. Commissioned closed-loop Z with independent return tracking.
7. A/Z command ratio and actual spindle phase through the bottom reversal.
8. Feed hold, reset, E-stop, guard, USB loss, and controller restart tests.
9. Machinable wax followed by at least 20 gauged sacrificial aluminum holes.

Until those records exist, the fair result is **Octopus source path proved,
machine rigid tapping blocked**.

## Primary References

- [Official grblHAL STM32F4 target metadata](https://github.com/grblHAL/STM32F4xx/blob/master/driver.json)
- [grblHAL F429 bootloader discussion](https://github.com/grblHAL/STM32F4xx/issues/144)
- [grblHAL rigid-tapping implementation discussion](https://github.com/grblHAL/core/discussions/515)
- [BIGTREETECH Octopus Pro v1.1 schematic](https://github.com/bigtreetech/BIGTREETECH-OCTOPUS-Pro/blob/master/Hardware/BIGTREETECH%20Octopus%20Pro%20V1.1-sch.pdf)
- [Langmuir MR-1 spindle description](https://www.langmuirsystems.com/mr1/spindle)
- [Generic HLT T3A/T3L servo manual](https://www.hlt-cnc.com/uploads/38006/files/T3A-T3L-Servo-driver-instruction.pdf)
- [Centroid standard Acorn specification](https://www.centroidcnc.com/centroid_diy/downloads/acorn_documentation/centroid_acorn_spec_manual.pdf)
- [Centroid controller closed-loop feature table](https://centroidcnc.com/pubs/pre540_feature_set.php?board=&machine=lathe&tier%5B%5D=free&tier%5B%5D=pro&tier%5B%5D=ultimate&tier%5B%5D=ultimate_plus)
- [Centroid Acorn rigid-tapping bulletin](https://www.centroidcnc.com/centroid_diy/downloads/acorn_documentation/acorn_rigid_tapping_parameters.pdf)
- [MASSO motors and drives FAQ](https://docs.masso.com.au/index.php/MASSO_FAQ/motors_and_drives)
