# MR1 second wiring audit — 2026-09-24

**Ready for documented, deenergized preparation; not released to power the coupled machine or machine a part.** This pass corrected eight source documents/data files. It did not connect hardware, change GPIOs/firmware/settings, flash a board, or perform a physical test.

The earlier reference ZIP is superseded by the refreshed bundle. Use its corrected documents, not older copies in other folders or an unreviewed generated wiring map. Original Drive edits were preserved.

## What changed

| Finding | Correction | Evidence still needed |
| --- | --- | --- |
| TLP281 module was approved from its IC name, assumed resistors/CTR and floating output VCC | Removed the wiring recipe and module approval. A floating shared pullup rail can couple channels; this is a circuit-risk inference, not a measurement of the on-hand board. Input and output terminal maps are HOLD. | Both PCB faces, traced schematic/part values, actual supply domains; healthy/trigger/open/power-loss tests, all 16 channel combinations, either side unpowered. |
| BLTouch “positions 4 and 5” mixed picture order with connector numbering | Named PB7 and its adjacent GND; BTT J43 schematic contacts are 1/PB7 and 2/GND. PB6/5V remain empty. | Actual board revision, mating view, key direction and continuity before populating. |
| Driver schematic numbers were treated as a physical row sequence | Kept electrical IDs 7/STEP, 8/DIR, 9/GND; 1/EN reserved. Removed automatic 2x8 fit approval and row-offset numbering. | Actual 18-contact socket/adapter map, fit, retention and no contact with powered/phase pins. |
| FAN0/FAN4 were assumed 24 V | Documented individual 5V/12V/VIN selection and low-side switched returns. HE0/HE1 positives are fused VIN. Bonding switched negatives to GND bypasses control. FAN6/7 have fixed GND returns. | Actual jumper positions/rails, load input ratings and off/PWM/startup behavior. Spindle and coolant connections stay HOLD. |
| Raw ALM/COMO cable rows said “SERIES into PB1” | Every pair first enters its own isolated, current-limited conditioner. Only proved healthy outputs feed the supervised PB1 aggregate, with separate PG12–15 indication. | Actual alarm polarity/configuration, lost-power and open-cable response; reviewed aggregate/diagnostic circuit. |
| Eight active command channels conflicted with twelve active ENA/PUL/DIR channels | Standardized four PUL/DIR pairs (eight channels); ENA unconnected, four channels reserved only. Removed assumed FORCE_DISABLE qualification. | Loaded command-current/waveforms and startup/shutdown behavior; a hardware stop independent of ENA. |
| Firmware timing was marked “all four pass” and closed | Replaced with source comparison only. 5 us pulse and 6 us DIR setup are candidate values; 250 ms enable delay is not active with ENA disconnected. | Scope at the real loaded drive after the finished interface/harness. |
| Wrong microstep scale was called harmless | Explained collision risk: 800 pulses/rev with a 1600 assumption doubles actual travel. Current preset is a candidate, not a verified torque/thermal result. | Physical switch photos, shaft/screw scale, guarded measured travel and direction. |
| Drive P5 was called DB9; encoder colors were treated as identities | P5 is the drive's four-contact tuning connector; DB9 is the cable's PC end. Removed color/thickness as encoder pin proof. | Matched kit cable identity, orientation and continuity. No invented replacement pinout. |
| First-power instructions lacked secure motor/support and contradicted isolation steps | Added supported gravity Z, rigidly secured uncoupled motor, guarded shaft, verified hardware stop and separate supply tests. Removed active DM860T reconnection steps from stock-removal instructions. | Actual mechanical restraints, protection and qualified bench setup; no hot-plugging. |
| Supply upgrade prescribed unqualified capacitor/NTC/bleeder values and dismissed braking | Removed construction recipe and blanket 110 V selector instruction. Higher-voltage proposal remains HOLD. | Actual facility input, four-drive load, ripple, all-axis/Z regeneration, fault/stop/discharge behavior and reviewed component selection. |
| BOM/order list assumed six extra optos and qualified shield methods | Channel count now follows the approved circuit, including aggregate plus independent indications. Removed universal sleeve/bond/solder claims and unproved cable-drop/equivalence claims. Corrected 16-housing count. | Actual parts/circuit, flex/connector ratings, shield termination and protective bonding plan. |

## Sources checked

The archived [BTT schematic](https://github.com/bigtreetech/BIGTREETECH-OCTOPUS-Pro/blob/master/Hardware/BIGTREETECH%20Octopus%20Pro%20V1.1-sch.pdf) was visually inspected: sheet 1 driver contacts/HCT buffers; sheet 2 STOP pullups, J43/PWR-DET/EXP2; sheet 3 FAN selection and switched heater outputs. The archived [BTT pin drawing](https://github.com/bigtreetech/BIGTREETECH-OCTOPUS-Pro/blob/master/Hardware/BIGTREETECH%20Octopus%20Pro%20V1.1-Pin.jpg) was cross-checked. Its filename says v1.1 but schematic title blocks say Rev V1.0; matching a physical board remains required. The [official BTT repository file](https://github.com/bigtreetech/BIGTREETECH-OCTOPUS-Pro/blob/master/Hardware/BIGTREETECH%20Octopus%20Pro%20V1.1-sch.pdf) is the source reference.

The archived [CL57T V4.1 manual](https://www.omc-stepperonline.com/download/CL57T-V41_user_manual.pdf) was visually checked at printed pages 3–4 (PDF pages 5–6) for P1–P5, encoder supply and connector drawings, plus its switch, alarm and timing sections. The [official manufacturer manual](https://www.omc-stepperonline.com/download/CL57T-V41_user_manual.pdf) was also retrieved. It establishes drive terminal functions and limits, not the finished cabinet or unknown modules.

The TLP281 label alone cannot establish the module circuit or a usable CTR margin. No current, resistor value, terminal order or isolation rating is assigned to the on-hand module in this audit. Mechanical restraint and the rejection of an unmeasured supply-upgrade recipe are engineering hold requirements, not claims that the vendors supplied a completed MR1 safety design.

## Use the corrected documents

- [Interface requirements](<mr1/INTERFACE_BOARD.md>): section A2 is the module qualification hold; F/G cover output domains.
- [Connector schedule](<mr1/PIGTAIL_SCHEDULE.md>): schematic IDs versus actual orientation; P5 correction and preservation-only rollback steps.
- [CL57T configuration](<mr1/CL57T_QUICK_WIRING.md>): timing evidence boundary and conditional single-motor bench procedure.
- [Simple check card](<mr1/WIRING_SIMPLE.md>) and [full wiring reference](<mr1/WIRING.md>): deenergized work, module holds and unreleased supply proposal.
- [BOM](<mr1/BOM.md>), [order list](<mr1/ORDER_LIST.md>) and [cable schedule](<mr1/cable-schedule.csv>): consistent candidate status; CSV HOLD is not a completed termination.

## Remaining evidence, in order

1. Photograph actual board/drive/motor labels and each connector from a recorded viewing side. Trace unpowered plug-to-terminal continuity, polarity and unused contacts. Preserve original harnesses.
2. Record module circuits, sensor voltage/type, four independent home signals and two independent Y inputs. Keep unqualified modules and stock powered signals off GPIO.
3. Review protective bonding, supply input, branch/fault protection and a hardwired stop with the gravity-loaded Z considered. No fuse, contactor, wire gauge or safety rating is selected by this report.
4. Qualify one secured uncoupled motor/drive, loaded command interface and alarm conditioner with a protected bench setup. P2 is drive-supplied encoder power; P4 is polarized bus power. Do not hot-plug either.
5. Prove aggregate PB1 behavior, measured travel/direction, limits, homing/dual-Y, supply load/regeneration, probe/setter and finally spindle/coolant against their actual hardware before machining.

## Verification and provenance

Second-pass commit: `41134da4eaea8ac7f64f7dd69b89e9312e228147`, based on prior audit `ccdbb9318982a2612a67ab401e96eebc641059a5` and original firmware `fbd4eb786eabfbe3d5fe87fc84ceb2bc59a47d64`. The cumulative source patch includes both audit commits. Only the eight listed docs/data files changed this pass; firmware pins, production image and 66-setting profile are unchanged.

`git diff --check` passed. The cable CSV parses with all 56 original unique cable IDs, column schema and Octopus destination identities preserved. The read-only firmware profile audit passed with 66 checks and all three report-units negative cases. Existing binaries/source in the original checkout were read only; no validation result is a physical test. The refreshed bundle manifest records every included file hash and the exact application-reference snapshot separately.
