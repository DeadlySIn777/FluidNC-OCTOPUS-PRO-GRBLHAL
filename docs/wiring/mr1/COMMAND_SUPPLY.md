# CL57T command supply and STEP/DIR circuit

Selected design for Octopus Pro V1.1 / F429 and four CL57T V4.1 drives.
**The source and circuit below are selected. Construction, installed connector
acceptance and electrical tests remain unfinished. This document does not
approve energizing or machining.**

## The +5 V source

Use **one takeoff from DRIVER0 VCC_IO**, through a **0.5 A fast branch fuse**
mounted near the takeoff, to the interface distribution bus named `+5_MOTION`.
Use DRIVER0 logic GND for `CTRL_0V`. Do not parallel additional socket +5 V
takeoffs. Do not use VM, V_FUSED, a motor-output contact or the encoder VCC.

Top-face orientation: motor plugs across the top; power screw terminals to
your left. These are the lower two rows of the empty DRIVER0 socket:

```text
                  Motor plugs above ↑

       LEFT SOCKET ROW             RIGHT BLACK SOCKET ROW

  second from bottom:  STEP  o     o  VCC_IO (+5 V)
             bottom:   DIR  o     o  logic GND
```

The schematic contact identities are STEP 7, DIR 8, GND 9 and VCC_IO 10.
They are electrical references, not labels expected beside each physical hole.
The manufacturer-hosted color map supplies the physical row information;
the V1.1 schematic ties VCC_IO directly to `VCC_5V`. Match the actual V1.1
top-face view and prove the fitted, mechanically retained harness before use.

```text
Existing 24 V control supply → Octopus MAIN POWER + / −
                                      ↓ onboard 5 V regulator
DRIVER0 VCC_IO (+5 V) → F_CMD 0.5 A fast → +5_MOTION
                                          ├→ X PUL+  and DIR+
                                          ├→ YL PUL+ and DIR+
                                          ├→ Z PUL+  and DIR+
                                          └→ YR PUL+ and DIR+

DRIVER0 logic GND → CTRL_0V → all eight MOSFET source terminals
```

Remove **J68, the USB-power jumper**, for cabinet operation. The board is
powered by MAIN POWER; USB remains a data connection. The driver VM/VIN/HV
selectors are not the source of `+5_MOTION` and stay open in this external-drive
design. All wiring and jumper changes are made with supplies and USB isolated
and discharged.

`F_CMD` is overcurrent protection for the branch. It is **not overvoltage
protection, galvanic isolation, or an emergency-stop element**. Select a
DC-suitable fuse and holder with adequate breaking capacity, and a properly
terminated connector and wire rated for the protected branch. The actual
socket contact, harness and fuse coordination are still acceptance items;
loose unsupported leads are not an accepted cabinet connection.

## Eight command sink channels

Repeat this circuit once for STEP and once for DIR on each drive:

```text
Octopus socket STEP or DIR ── 100 ohm ── Q gate (pin 1)
                                           │
                                        100 kohm
                                           │
CTRL_0V ───────────────────────────── Q source (pin 2)
CL57T PUL− or DIR− ─────────────────── Q drain  (pin 3)
CL57T PUL+ or DIR+ ─────────────────── +5_MOTION
```

Selected part: **Nexperia 2N7002, SOT23**. Confirm manufacturer pin numbering
against the fitted part before use. Its maximum specified on-resistance is
5.3 ohm at a 4.5 V gate, 75 mA and 25 °C. A 16 mA input therefore gives an
approximately 0.085 V channel-drop estimate at those room-temperature
conditions; this is not full-temperature or installed-cable qualification.
The socket signals are nominal 5 V HCT-buffered outputs, not the MCU's raw
3.3 V pins. A socket HIGH turns the MOSFET on and the drive optocoupler on.

| Drive | Socket | STEP → PUL− sink gate | DIR → DIR− sink gate |
| --- | --- | --- | --- |
| X | DRIVER0 / MOTOR0 | PF13 | PF12 |
| Y-left | DRIVER1 / MOTOR1 | PG0 | PG1 |
| Z | DRIVER2 / MOTOR2 | PF11 | PG3 |
| Y-right | DRIVER3 / MOTOR3 | PG4 | PC1 |

Set each CL57T **S3 to 5 V**. ENA channels remain reserved and unconnected;
enabling them requires their own polarity, 200 ms timing and startup analysis.
The existing `CMD-X`, `CMD-YL`, `CMD-Z` and `CMD-YR` cables remain four
conductors each: PUL+, PUL−, DIR+, DIR−. The source/fuse/distribution branch
is a separate internal interface connection, not an added conductor in CMD-X.

## Load budget and acceptance

The CL57T manual specifies 7–16 mA per control input. Budget **128 mA** for
all eight PUL/DIR inputs simultaneously active. Four future enable channels
would add up to 64 mA; reserve at least 250 mA total source capacity if they
are later qualified. BTT advertises an 8 A shared 5 V regulator; onboard and
other peripheral loads consume that capacity. A nominal regulator rating does
not establish the installed connector rating or remaining thermal margin.

Before drive power is applied, verify source polarity and continuity; J68
removal; fuse and harness ratings; source voltage and far-end voltage with all
eight input loads active; input current; drain low voltage below 0.5 V; and
pulse width, direction setup and cable edge quality under representative load.
The CL57T minima are 1 microsecond pulse/high and low widths and 2 microseconds
direction setup. Use the commissioning plan's more conservative settings where
specified, and record measured margin.

**Controller reset/bootloader protection remains unfinished.** The always-on
HCT buffers have floating STEP/DIR inputs while the MCU is in reset. The gate
pulldown cannot override a driven buffer output. Scope startup, shutdown,
brownout and reset behavior with drive power off. A separately qualified
controller-health or drive-enable interlock is required before accepting this
condition; selecting the supply does not resolve it.

`+5_MOTION / CTRL_0V` belongs to the controller command domain. It is not the
P2 encoder supply and is not the isolated alarm-side supply / `COM−` return.
Keep those connections separate according to their own interface drawings.

## Sources

- [BTT V1.1 schematic, sheets 1 and 4](https://github.com/bigtreetech/BIGTREETECH-OCTOPUS-Pro/blob/master/Hardware/BIGTREETECH%20Octopus%20Pro%20V1.1-sch.pdf): socket VCC_IO, HCT buffers, regulator and J68 USB-power path.
- [BTT-hosted color pin map](https://github.com/bigtreetech/BIGTREETECH-OCTOPUS-Pro/blob/master/Hardware/BIGTREETECH-Octopus-Pro-V1.0-Color-PIN-V3.0.pdf): socket row positions, cross-checked with the V1.1 photo and schematic.
- [BTT Octopus Pro power documentation](https://global.bttwiki.com/Octopus%20Pro.html#power-wiring): shared 5 V regulator budget and USB-power jumper.
- [CL57T V4.1 manual, sections 2.1, 3.1, 5.3, 6.1 and 7](https://www.omc-stepperonline.com/download/CL57T-V41_user_manual.pdf): current, common-anode arrangement, S3 and timing.
- [Nexperia 2N7002 datasheet, tables 2 and 7](https://assets.nexperia.com/documents/data-sheet/2N7002.pdf): pinout and specified 4.5 V gate performance.

Supply selection, fuse value and distribution topology are project engineering
choices. Manufacturer references do not certify the finished assembly.
