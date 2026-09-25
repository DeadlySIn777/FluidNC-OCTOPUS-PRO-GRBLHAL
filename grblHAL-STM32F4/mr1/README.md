# MR1 engineering baseline

Active hardware plan: **Octopus Pro v1.1 / STM32F429ZGT6**, four external **CL57T V4.1** drives and matched **23HS45-4204D-E1000** motors. Production firmware has X, Y and Z logical axes with independent Y-left/Y-right outputs and homes. MOTOR0–3 provide STEP/DIR through the planned qualified interface; the board's A/B motor-phase plugs remain unused. No installed adapter or completed interface is assumed.

**Physical acceptance remains open. This is not permission to energize, flash or machine.** Nothing in this source export records a completed hardware test. The project uses its own [Windows native control application](../../mr1-control/); historical gSender instructions have been superseded.

## Read first

- [Wiring plan](WIRING.md), [simple check card](WIRING_SIMPLE.md), [connector schedule](PIGTAIL_SCHEDULE.md)
- [CL57T guide](CL57T_QUICK_WIRING.md), [arrival evidence](CL57T_ARRIVAL_CAPTURE.md)
- [Planned interface](INTERFACE_BOARD.md), [BOM](BOM.md), [order list](ORDER_LIST.md)
- [Cable schedule](cable-schedule.csv), [GPIO manifest](io-manifest.json), [expected settings](expected-settings.json)
- [Windows operator guide](OPERATOR.md), [staged commissioning reference](COMMISSIONING.md)
- [Source build and licensing](../README.md), [historical build evidence](BUILD_REPORT.md)

The release-level corrected wiring reference and current visual guide are the primary presentation. Older generic maps are historical and can describe other machines. The former root diagnostic scripts now live in `legacy/grblhal-diagnostics-2025/` and must not be run on the MR1. DM860T documents concern the preserved rollback set only.

## Physical hold points

Confirm actual board/MCU and all four drive revisions; photograph printed terminal names and switch settings; prove connector viewing sides and continuity. Qualify the actual command and sensor interfaces, independent homes, raw alarm conditioning and supervised aggregate, power domains/protection/earthing, independent E-stop, motor/encoder pairing and mechanical fit. Spindle/coolant load wiring, thermal sensor identity and oil/lubrication assignment remain unresolved. Secure test motors and support gravity-loaded Z before any separately permitted energization.

Generic TLP281/HW-399 names do not qualify module circuits or terminal assignments. Raw ALM/COMO outputs must not be chained directly into PB1. STOP4–7 per-axis fault wiring is not read by the current firmware; the PB1 aggregate is the only drive-fault stop and must be qualified before coupled dual-Y motion. Neither the existing motor supply nor a proposed replacement is accepted for simultaneous four-drive loading/regeneration without evidence. The old unqualified 48 V capacitor/NTC/bleeder recipe is withdrawn.

## Software baseline

Use only `btt_octopus_pro_f429_mr1` for the production candidate. Source build/check commands are in [the firmware README](../README.md). No binary is distributed in this source release. The pinned historical image identity remains a comparison value; no physical flash or independent rebuild is claimed.

The current profile has **66 expected settings**, explicitly including millimeter status reporting with `$13=0`. Read-only preflight includes `$N`; both startup slots must be present and empty because successful homing may execute startup G-code. A compile does not overwrite stored settings. Resetting/restoring settings is a separate controlled commissioning action, not a build step.

The pending spindle and servo-axis profiles retain all permits/gates false. Modbus, encoder/index supervision, orientation and rigid tapping are not commissioned. The separate lab source must not replace the production environment. Its code exists for research, not as a released capability.
