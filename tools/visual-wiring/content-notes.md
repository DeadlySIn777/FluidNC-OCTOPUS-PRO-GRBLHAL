# Visual wiring content notes

`route-content.json` supplies 29 individual views: 21 routes with existing cable-schedule IDs, plus eight functional upstream/diagnostic views. All physical checks remain open. It contains no connector-face drawing or energization approval.

Use `routes[].id` as the selector key. `matchCableIds` connects views to the corrected source cable schedule. For each axis, the first `CMD-*` match is the planned interface JX/JYL/JZ/JYR → drive P1 cable; its `upstream` object gives the Octopus socket context. The separate socket view makes the intermediate interface visible. Those extra views are marked `labelKind: functional-route`; their labels are not newly approved harness IDs.

Print `endLabels.from` and `endLabels.to` at the corresponding ends. They deliberately match. `connections` names electrical functions, not physical cavities. The P2 encoder supply row has `direction: to-from`: power comes from the drive even though encoder feedback travels toward it. Do not render all rows as one-way signals.

| Physical motor | Socket | STEP | DIR | Reserved EN, unused | Separate diagnostic |
| --- | --- | --- | --- | --- | --- |
| X | MOTOR0 | PF13 | PF12 | PF14 | STOP4 / PG12 |
| Y-left | MOTOR1 | PG0 | PG1 | PF15 | STOP5 / PG13 |
| Z | MOTOR2 | PF11 | PG3 | PG5 | STOP6 / PG14 |
| Y-right | MOTOR3 | PG4 | PC1 | PA2, v1.1 | STOP7 / PG15 |

P3 is A±/B± motor power. P2 is EA±/EB± plus drive-supplied VCC/EGND for the matched encoder. P4 is polarized +VDC/GND on its own protected star branch. No motor colors, GX16 cavities, interface cavity order or fuse values are supplied.

Each raw ALM/COMO pair terminates at its own planned isolated conditioner. Separate conditioned indications go to PG12–15; the supervised aggregate goes to PB1 and its controller-side return. The aggregate must include all required fault contributors. Raw alarm transistors are never drawn as a series GPIO circuit. PG12–15 do not establish the motor-fault stopping path or verified per-drive live telemetry.

The `holds` collection names the missing physical evidence: board/connector views, command interface and 5 V qualification, actual module circuit, alarm truth tables and supervision, return/PE topology, harness mapping, supply/protection and independent hardware stopping including Z support. Nothing in the content silently qualifies the recorded 36 V / 10 A supply or a TLP281/HW-399 module.

Source paths are repository-relative references or official external URLs. Vendor PDFs are linked at their official sources rather than copied into this guide. The corrected docs/wiring references are the authority used here; older generated wiring-map files were not used. Firmware GPIOs were checked against the archived board map; connector functions against the archived CL57T manual extraction, corrected project guide and pigtail schedule. Source paths and section references remain in the JSON for integration.

Validation: JSON parses; 29 unique route IDs; all source paths, hold/source/related-route references and `matchCableIds` resolve; both end labels match; every route remains HOLD with `physicalCheckComplete: false`. No electrical or physical test was performed.
