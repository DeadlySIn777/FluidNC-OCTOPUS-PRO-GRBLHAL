# CL57T alarm interface — selected assembly candidate

This replaces the unspecified alarm conditioner with a terminal-by-terminal design for four **CL57T V4.1** drives. Each drive operates one relay. One contact from each relay forms the PB1 aggregate; its second contact reports that axis separately. **The parts are selected, not confirmed owned or installed. No physical acceptance has been completed.**

The wire list is [alarm-interface-wires.csv](alarm-interface-wires.csv). Every `accepted` entry is `false`.

## Parts and supply

| Quantity | Selected item | Purpose and design basis | Confirmed owned | Physically accepted |
| --- | --- | --- | --- | --- |
| 4 | Weidmüller **TRP 24VDC 2CO AU**, **2618530000**, complete relay module | K-X, K-YL, K-Z, K-YR. DIN rail, push-in terminals, two changeover contacts, gold contacts, integrated flyback diode and reverse-polarity protection | false | false |
| 1 | Mean Well **DDR-15G-24** isolated DC/DC converter | PS-ALM. Existing 24 V control supply in; separate alarm field supply out. **New required part; not an on-hand assumption** | false | false |
| 1 | **0.25 A fast-acting, DC-rated fuse and finger-safe holder**, at least 30 V DC | F-ALM, one common fuse on the converter output feeding all four relay coils. Select exact fuse/holder after confirming conductor ratings and fault clearing with this converter | false | false |
| 5 | **2.2 kΩ, 1%, 0.25 W** resistors | R-AGG, R-X, R-YL, R-Z, R-YR: each signal to Octopus 3.3 V | false | false |
| 5 | **100 nF X7R, 25 V or higher** capacitors | C-AGG, C-X, C-YL, C-Z, C-YR: each signal to Octopus GND, mounted near the controller-side terminations | false | false |
| As needed | Touch-safe terminal groups, DIN rail, labels, ferrules and cabinet wire | TB-A+, TB-A0, TB-C3, TB-C0 and five TB-S signal groups; terminal ratings and wire size must suit the actual cabinet | false | false |

The relay input is nominally **20.5 mA at 24 V**, approximately **82 mA for four**. Contacts have a published minimum of **1 mA at 1 V**; the specified 2.2 kΩ pull-ups give approximately **1.5 mA per closed signal**, 7.5 mA total from the controller's 3.3 V rail. The relay includes coil suppression; do not add a second unreviewed suppression network. Published release delay is **less than 18 ms**, before controller response. These are manufacturer component figures, not a measured machine stopping time. [Weidmüller product data and wiring diagram](https://eshop.weidmueller.com/en/trp-24vdc-2co-au/p/2618530000), [manufacturer datasheet](https://datasheet.weidmueller.com/pdf/en/2618530000/scope/2/).

The converter accepts **9–36 V DC**, supplies nominal **24 V / 0.63 A**, and has specified **4 kV DC input/output isolation**. Its adjustment range is 21.6–28 V. Set its output to **23.0 V**, measured before attaching the drives. Confirm the output remains **at or below 24.0 V at no load and with all four relays energized**, including ripple and supply variation; confirm each energized relay receives at least its rated operating minimum, 19.2 V. Do not use the converter's full adjustment range. The conservative 24 V ceiling follows the CL57T output specification despite the manual also mentioning a 30 V maximum. [Mean Well DDR-15 datasheet, pages 2 and 5](https://www.meanwell.com/Upload/PDF/DDR-15/DDR-15-spec.pdf).

**Converter input protection is a separate selection.** Size it to the installed wiring and Mean Well's input/inrush requirements; the datasheet lists 15 A typical inrush at 24 V input. The 0.25 A output fuse is not an input-fuse recommendation and is not a guarantee of semiconductor protection. A short on one coil branch may remove the common alarm supply and must cause the whole aggregate to fault.

## The three different commons

- **ALM field return:** PS-ALM output `2 / −Vo` connects to the four drives' **COM−** terminals. The manual also names this terminal **COMO**. It is the output common shared by ALM and BRK.
- **Controller logic return:** Octopus **GND** connects only to the relay contact circuits and their capacitors. It is the return for the board's **3.3 V** pull-ups.
- **Command supply return:** belongs to the separately qualified PUL/DIR command interface. This document does not connect COM− to that return or qualify the command interface.

Keep PS-ALM output return floating from its input return, Octopus GND, PE and the command/encoder supplies. The relay coils are on the field side; their contacts are on the controller side. Verify that the installed drives and other attached circuits do not bridge those domains before describing the installed system as galvanically isolated. Never use the motor-power supply, P2 encoder VCC/EGND, or an Octopus motor-output connector for this alarm circuit.

## Converter and drive connections

Converter pin assignments below are from the DDR-15 manufacturer drawing, viewed at its labeled terminals. Match the printed names rather than counting an unfamiliar connector from memory.

| From | To |
| --- | --- |
| Existing protected +24 V control feed | PS-ALM **4 / +Vin** |
| Existing control-supply 0 V | PS-ALM **3 / −Vin** |
| PS-ALM **1 / +Vo** | F-ALM input |
| F-ALM output | TB-A+ distribution, then each relay **A1** |
| Each relay **A2** | Its own drive **P1 ALM** |
| PS-ALM **2 / −Vo** | TB-A0 distribution, then each drive **P1 COM− / COMO** |

On the selected relay **A1 is positive; A2 is negative**. Its protection-diode polarity matters. The ALM transistor completes the coil circuit when it conducts. Each drive has its own ALM connection; raw ALM terminals are neither series-chained nor joined to a GPIO. **BRK remains insulated and unused; ENA is outside this alarm assembly.** [CL57T V4.1 manual, §§3.1 and 6.2](https://www.omc-stepperonline.com/download/CL57T-V41_user_manual.pdf).

The design requires **ALM-to-COM− conducting while the drive is healthy and open on a fault**. Section 6.2 says the change of impedance depends on configuration, but does not identify the setting or guarantee the unpowered state. **The exact polarity parameter/value is not known and is not invented here.** Read and save each installed drive's parameters with its supported vendor software, establish the correct polarity and verify the measured states below. If a drive cannot provide the required healthy-conducting behavior, this candidate is not accepted; do not swap to NC contacts to hide the failure.

## Octopus-side connections

Only dry relay contacts reach the controller. Each selected relay has these terminals:

| Pole | Common | Normally open — used | Normally closed — leave empty |
| --- | --- | --- | --- |
| First | **11** | **14** | **12** |
| Second | **21** | **24** | **22** |

The first contacts form the drive aggregate:

```text
EXP2 PB1 ── K-X 11→14 ── K-YL 11→14 ── K-Z 11→14 ── K-YR 11→14 ── Octopus GND
```

The second contacts identify each drive:

| Octopus signal | Relay common | Relay NO to Octopus GND |
| --- | --- | --- |
| STOP4 **PG12**, X | K-X **21** | K-X **24** |
| STOP5 **PG13**, Y-left | K-YL **21** | K-YL **24** |
| STOP6 **PG14**, Z | K-Z **21** | K-Z **24** |
| STOP7 **PG15**, Y-right | K-YR **21** | K-YR **24** |

For **each of PB1, PG12, PG13, PG14 and PG15**, connect its 2.2 kΩ resistor to **Octopus I2C 3.3 V**, and its 100 nF capacitor to **Octopus GND**. These are controller-side parts. The I2C 3.3 V connection is identified in [PIGTAIL_SCHEDULE.md](PIGTAIL_SCHEDULE.md); confirm it against the [BTT V1.1 schematic](https://github.com/bigtreetech/BIGTREETECH-OCTOPUS-Pro/blob/master/Hardware/BIGTREETECH%20Octopus%20Pro%20V1.1-sch.pdf). Account for the extra 7.5 mA in the board supply budget. Do not substitute the adjacent endstop supply pin: only the STOP4–STOP7 **signal** contacts are used here. Remove their DIAG jumper links. Use the verified EXP2 GND connection for TB-C0.

PB1 has no board pull-up or RC filter, so its external resistor and capacitor are required. The four diagnostic channels use the same external values for a defined interface; verify their installed signal voltages and existing board loading. Nominal external RC is 0.22 ms. That calculation does not qualify noise immunity or stopping latency.

The CSV spells out the four-drive aggregate. **Preserve any additional required, qualified cabinet/spindle healthy contacts in the overall PB1 chain.** If such sources are required for this cabinet, their integration remains a separate acceptance item; do not bridge them out to match this drive-only drawing.

## Firmware boundary

**PB1 is the existing aggregate drive-fault stop input.** Prove the installed firmware's fault polarity, stop and latched recovery behavior with the actual circuit before motion acceptance.

The new diagnostic firmware candidate's **`MR1F:1,mask` reports raw sampled states** of PG12–PG15. It is not a latched record of which drive faulted first and does not itself stop motion. A cleared or transient axis signal can disappear before a later snapshot. Firmware deployment and the installed build must be verified separately; do not infer that an older flashed build has this reporting capability. Do not replace PB1 with these diagnostic inputs.

## Bench acceptance — all pending

1. **Unpowered inspection:** verify exact drive revisions, relay part numbers, converter terminals, ferrules, fuse/holder and conductor ratings. Check each wire against the CSV. Insulate 12/22, BRK and other unused contacts. Confirm relay 11–14 and 21–24 are open when de-energized.
2. **Supply-only test:** leave drives disconnected from the alarm field wiring. Set and measure PS-ALM at 23.0 V; test no-load and four-relay load voltage. Confirm field/logic domain separation and verify 3.3 V on TB-C3. Remove power before changing terminations. Do not insulation-test through connected drive electronics.
3. **Controller/contact test with drive power off:** verify every open contact produces a high input and closed contact produces a low input. Open each aggregate contact individually and confirm PB1's fault response. Verify per-axis raw reporting only on the intended diagnostic build. Do not leave temporary test bridges fitted.
4. **One-drive bench test:** mechanically secure an uncoupled motor with its proper motor and encoder cables connected. Keep motion commands inhibited. Save installed drive parameters and establish ALM polarity using the vendor's supported configuration procedure. Use a supported fault test; do not create overvoltage, short motor wires or unplug motor/encoder connectors while powered. Secure the machine's Z/head mechanically before any machine-side power-loss test; loss of holding torque can allow movement.
5. **Repeat for all four axes:** prove healthy, fault, drive-power-loss and open-wire behavior below. Measure PB1 and per-axis voltages and complete fault-to-stop latency. Repeat after a drive power cycle to prove parameter persistence. Check that recovery requires deliberate operator action and cannot restart motion automatically.
6. **Machine integration:** accept the independent hardwired emergency stop, required cabinet/spindle fault sources and complete PB1 chain before coupled dual-Y motion. This relay circuit and ALM output are not a certified personnel-safety function.

| Condition to test | Required relay/contact result | Required controller result | Physically accepted |
| --- | --- | --- | --- |
| Drive powered, healthy, correct output polarity | Relay energized; both NO contacts closed | PB1 low when all required sources healthy; axis input low | false |
| Any actual drive alarm | Its relay drops; both NO contacts open | PB1 faults/stops; corresponding raw axis input high | false |
| Remove one drive's power | Its relay must drop; do not assume the drive's unpowered output state | PB1 faults/stops; corresponding raw axis input high | false |
| Open its ALM conductor | Its relay drops | PB1 faults/stops; corresponding raw axis input high | false |
| Open its COM− conductor | Its relay drops | PB1 faults/stops; corresponding raw axis input high | false |
| Remove alarm supply / open F-ALM | All relays drop | PB1 faults/stops; all raw axis inputs high | false |
| Open an aggregate contact wire or its GND return | Aggregate opens | PB1 faults/stops | false |
| Open one diagnostic contact wire | Its diagnostic path opens; aggregate may remain healthy | That raw axis input high; this alone is not a PB1 stop | false |
| Short ALM to COM− | Can keep its relay energized and mask a drive alarm | Not detected reliably by this circuit; independent emergency stop remains necessary | false |
| Welded/stuck relay NO or short signal to GND | Can mask a fault in the affected path | Ordinary relays are not force-guided; the separate contact is not proof of aggregate-contact integrity | false |

No `accepted` flag changes automatically because documentation, continuity or a software test passes. Store measured physical evidence and the tested firmware/drive configuration before accepting an installed circuit.
