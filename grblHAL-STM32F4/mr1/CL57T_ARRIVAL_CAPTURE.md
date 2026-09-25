# CL57T Arrival Evidence Capture

Do this **before** anything is mounted, wired, or energized.

Around twenty open questions across this project close the moment these boxes
are opened, and several of them cannot be answered later without unmounting
hardware. The boxes get unpacked once. Capture first, build second.

Photographs go in `_evidence_photos/` with the filenames given below. Record
measured values straight into this file — it is the evidence record, not a
worksheet to transcribe later.

---

## 0. Before opening

- [ ] Photograph all four shipping boxes unopened, labels visible —
      `cl57t_boxes_sealed.jpg`
- [ ] Photograph each packing list — `cl57t_packlist_1..4.jpg`
- [ ] Confirm four of each: driver, motor, motor extension, encoder extension,
      RS232 cable. **Note any missing item immediately** — a missing encoder
      cable stops that axis entirely.

## 1. Drive identity — the revision gate

`CL57T_QUICK_WIRING.md` is written for **V4.1**. V4.1 is the revision with the
`S1` rotating switch, the `S3` top selector, and the `P5` tuning port.

- [ ] Photograph each drive's label face — `cl57t_label_1..4.jpg`
- [ ] Photograph each drive's switch face showing `S1`, the `S2` DIP bank, and
      the `S3` selector — `cl57t_switches_1..4.jpg`
- [ ] Confirm **all four are V4.1**. Record: ______________________
- [ ] **STOP if any drive lacks the rotating switch or the top selector.** It
      is not V4.1 and the switch table does not apply to it.

## 2. As-shipped switch positions

Record before changing anything, so a later "did I set that?" is answerable.

| Drive | `S1` as shipped | SW1-8 as shipped | `S3` as shipped |
| --- | --- | --- | --- |
| 1 | | | |
| 2 | | | |
| 3 | | | |
| 4 | | | |

Expected factory state is `S1`=`0` and `S3`=`24V`. Both **must** change.

## 3. Terminal and connector capture

- [ ] Photograph the `P1`–`P5` terminal block faces with the silkscreen legible
      — `cl57t_terminals_1.jpg` (one drive is enough if all four match; confirm
      they do)
- [ ] Record the `P4` terminal order **left to right as printed**, so the
      polarized pair can be landed without re-reading the manual in the
      cabinet: ______________________
- [ ] Measure and record terminal block **pitch** (mm) and position count for
      `P1`, `P2`, `P3`, `P4`: ______________________
- [ ] Photograph the GX16 motor connector and the encoder connector, both ends
      — `cl57t_gx16.jpg`, `cl57t_encoder_conn.jpg`
- [x] Record the RS232 debug cable's PC-side connector type (DB9? USB?):
      **DB9 — confirmed 2026-09-18.** A USB-to-serial adapter is required and is
      **not** in the kit.

      **Not a blocker.** The `P5` port only modifies drive parameters — manual
      §3.5: *"it is just used to modify parameter, not for equipment control
      because neither precision nor stability is sufficient."* `S1` already sets
      current and a gain preset, and codes `4`/`5`/`6` give three rigidity
      options at 4 A RMS with no PC involved. All four axes can be commissioned
      without this cable. Buy the adapter only if an axis still misbehaves after
      trying those presets. Prefer a genuine FTDI chipset — counterfeit
      Prolific parts are a known source of Windows driver grief.

The existing project rule stands: no aftermarket plug is ordered until the
physical pitch and markings are photographed.

## 4. Motor measurements

The coupler bore is the critical unknown. The spec sheet says 8 mm D-cut shaft,
21 mm projection, 57 × 57 × 135 mm body.

- [ ] Shaft diameter, measured with calipers: __________ mm
- [ ] Shaft projection from the face: __________ mm
- [ ] Flat (D-cut) length and depth: __________ mm
- [ ] Body length **including the rear connector and its cable bend radius**:
      __________ mm — the 135 mm figure is body only
- [ ] Face bolt pattern, measured across: __________ mm
- [ ] Motor mass: __________ g

Then, against the machine:

- [ ] Does the existing coupler bore accept 8 mm? __________
- [ ] Does the face pattern match the stock bracket without drilling? ________
- [ ] Z-axis clearance for the 135 mm body plus connector: __________
- [ ] Cable exit direction vs the drag chain / conduit route: __________

## 5. The supply — do this before any drive is powered

The September 20 record below identifies the supply. Retain the nameplate
photo and verify the actual installed unit before using these values.

- [x] Photograph the supply nameplate — **done 2026-09-20**
- [x] Manufacturer / model: **`S-360-36`**
- [x] Rated output voltage: **36** V
- [x] Rated output current / power: **10** A / **360** W
- [x] Input voltage range: **110 / 220 V ±15%**
- [x] Regulated or unregulated: **regulated** (enclosed switch-mode)

**Verdict: nominal voltage compatible; simultaneous four-drive capacity is
unqualified.** The 9.6–11.2 A estimate is a heuristic, not measured bus demand.
This 10 A unit does not meet the project's proposed 12 A minimum design margin.
Do not silently mark it accepted: either replace it with a qualified supply,
or document a reviewed, measured operating envelope for this specific unit.
No replacement has been selected or purchased by this audit. See `WIRING.md`.
Still to confirm: the input selector matches the actual mains supply.

With **all four drive branches disconnected**, at the actual wall voltage:

- [ ] Output measured in **DC** mode: __________ V
- [ ] Ripple measurement / instrument / bandwidth: ______________________
- [ ] Later, under a qualified commissioning test: minimum bus voltage,
      peak deceleration voltage, current, temperature, and test duration: ______

**Power acceptance remains open until all of these are resolved:**

- Correct DC polarity, measured voltage and ripple; a handheld AC reading is
  not sufficient transient or regulation evidence.
- Under 40 V unloaded is the current project target for the nominal 36 V bus.
  Bus voltage remains within the drive limits during load and deceleration.
- At least 12 A was the proposed project design margin, not a manufacturer
  minimum. The documented 10 A supply needs replacement or a separately
  reviewed measured operating envelope, including all four axes together.

If unloaded DC is above 45 V, stop — an unregulated supply can climb further on
high mains and during deceleration, and 50 V destroys the drives.

## 6. Alarm characterization

The manual says the `ALM`/`COMO` impedance changes "from low to high or high to
low depending on configuration" and does **not** state a default. The whole
fail-safe design depends on knowing which.

On a current-limited bench setup, motor and encoder connected, with the
mechanical coupling removed and an appropriate isolated test load:

- [ ] Healthy ALM/COMO output voltage/current: ______________________
- [ ] Alarm output voltage/current, using a vendor-approved fault method: ____
- [ ] Lost-drive-power and open-alarm-cable results: ______________________

Never disconnect a powered motor or encoder to force a fault, and do not put
an ohmmeter across an energized alarm output. A conditioner test input can
prove the controller path, but does not prove the drive actually signals a fault.

- [ ] Is the direction configurable, and how? ______________________
- [ ] Red LED blink count observed for the forced fault: __________

This determines the conditioner polarity so that **healthy = loop closed** and
a broken wire reads as a fault.

## 7. Cabinet fit

- [ ] Backplate area available for four drives: __________ × __________ mm
- [ ] Confirm **30 mm minimum spacing** between adjacent drives is achievable
      (manual §2.4): ______________________
- [ ] Confirm **vertical mounting** orientation is achievable: ____________
- [ ] Is forced cooling needed to stay under 40 °C? ______________________

## 8. Cable length reality check

The kit ships **fixed-length moulded** extensions — 1.7 m motor, 1.7 m encoder.
The project's EMC strategy assumes cable that can be cut to length and
terminated at the panel wall with glands and 360° shield clamps.

**Where the runs start.** Langmuir's assembly guide mounts the stock electronics
enclosure to the **left rear leg of the machine**, on three isolation mounts
("Secure the Electronics Enclosure to the left rear leg of the machine using the
BAG 25 nuts"). So the runs are machine-scale, not room-scale — unless you are
relocating the electronics, in which case measure to the new position instead.

Neither Langmuir nor the community LinuxCNC conversion publishes stock cable
lengths, so the stock cables on the machine are the only real measurement. They
are already labelled `X`, `YL`, `Z`, `YR` at both ends. **Measure and re-coil
them; do not cut** — they belong to the preserved rollback set.

- [ ] **Stock cable length, longest axis** (the reference measurement):
      __________ mm, axis __________
- [ ] Measure the actual run needed for each axis: X ______ YL ______
      Z ______ YR ______ mm
- [x] Does 1.7 m reach each axis from the cabinet? **NO - measured 2026-09-19,
      the kit leads are roughly half the needed length (~3.4 m straight-line).**
      Ordering 4.7 m `CE5-M5-20` kits; see `ORDER_LIST.md` section 5. Budget for
      the ROUTED path, which runs 20-40% longer than a straight-line measurement.

Rough expectation from the left rear leg across 566 mm X and 546 mm Y travel:
1.2–1.8 m routed for the farthest axis. That is close enough to 1.7 m that it
must be measured, not assumed.
- [ ] If a moulded connector must pass through the panel wall, record how the
      shield is to be bonded without cutting the cable: ______________________

This is a genuine conflict with the existing gland rule and needs resolving
before holes are drilled.

## 9. Spares reality

The ganged Y pair means **one dead drive stops the whole machine** — there is
no limping along on three axes.

- [ ] Do all four drives power up with a steady green LED and no red? ______
- [ ] Record serial numbers so a warranty claim is possible: ______________
- [ ] Decide and record: is a fifth drive/motor worth ordering as a spare?
      ______________________

---

## Do not, on arrival day

- Do **not** bolt motors to the machine. Two P0 items still gate every
  commanded move regardless of which drives are in the cabinet — the safety
  chain and the interface electronics. Neither is touched by this delivery.
- Do **not** energize a drive with the motor or encoder disconnected.
- Do **not** plug or unplug `P3` or `P4` while powered.
- Do **not** reuse a DM860T-era power pigtail without re-terminating and
  re-labelling it. `P4` is polarized; the DM860T pair was not.
