import { normalizeCommissioningRecord, COMMISSIONING_HARDWARE_PROFILE } from "./commissioning-record.js";

export const WIRING_INSTALLATION_STORAGE_KEY = "mr1-control.wiring-installation.v1";

export const WIRING_AUDIT = Object.freeze({
  reviewedOn: "2026-09-24",
  controller: "BIGTREETECH OCTOPUS PRO V1.1 / STM32F429",
  motion: "4 X CL57T V4.1 / 23HS45-4204D-E1000 / CLOSED LOOP",
  commandInterface: "5V-BUFFERED SOCKET / 8 ACTIVE + 4 RESERVED MOSFET OPEN-DRAIN / 5V COMMON-ANODE",
  firmwareMapParity: "31 OF 31",
  boardRevisionGate: "V1.1 / F429 / 8MHZ",
  upstreamTargetState: "UNTESTED / QUALIFICATION REQUIRED",
  officialPinoutSha256: "D360491AD8E1F738B1E784BFD62CC2C0F2B4C396D6CD069B9743D62AAB0EE285",
  officialUsbPowerImageSha256: "55146E2A8174B40723E95EBEA305DB2168590F879756B314DFF23E49F6BD53A0",
  productionFirmwareSha256: "F4AB32BD2CB7D0985A07915CF1C4349A3A7FD8546C765265B23EB98B904E5E9D",
  productionFirmwareBytes: 221304,
  productionState: "PHYSICAL COMMISSIONING LOCKED",
});

export const OCTOPUS_FIRMWARE_CANDIDATE = Object.freeze({
  candidateId: "mr1-f429-production-2026-08-27",
  board: "BIGTREETECH OCTOPUS PRO V1.1",
  mcu: "STM32F429ZGT6",
  crystalHz: 8000000,
  bootloaderBytes: 32768,
  applicationAddress: "0x08008000",
  bytes: WIRING_AUDIT.productionFirmwareBytes,
  sha256: WIRING_AUDIT.productionFirmwareSha256,
  filename: "firmware.bin",
  successFilename: "FIRMWARE.CUR",
  preflightProtocol: "mr1-controller-preflight-v1",
  preflightProfile: "btt_octopus_pro_f429_mr1",
  preflightMaxAgeMs: 15 * 60 * 1000,
  downloadPath: "/firmware/octopus-pro-v1.1-f429-mr1/firmware.bin",
  manifestPath: "/firmware/octopus-pro-v1.1-f429-mr1/firmware-manifest.json",
  state: "SOURCE CANDIDATE / PHYSICAL FLASH UNVERIFIED",
});

export const WIRING_REFERENCE_SOURCES = Object.freeze([
  Object.freeze({
    id: "firmware_manifest",
    authority: "EXACT",
    title: "COMPILED MR-1 FIRMWARE MAP",
    scope: "Owns every Octopus connector and STM32 GPIO assignment shown in the guide.",
    reference: "grblHAL-STM32F4/mr1/io-manifest.json",
  }),
  Object.freeze({
    id: "grblhal_octopus_target",
    authority: "UPSTREAM",
    title: "GRBLHAL STM32F4 TARGET STATUS",
    scope: "Confirms the upstream F429 target exists and is still explicitly marked untested; local qualification remains mandatory.",
    url: "https://github.com/grblHAL/STM32F4xx/blob/master/driver.json",
  }),
  Object.freeze({
    id: "btt_octopus",
    authority: "MANUFACTURER",
    title: "BTT OCTOPUS PRO V1.1",
    scope: "Owns connector locations, the MCU USB-power jumper, SD bootloader method, the 18-position driver-socket circuit, 5 V HCT buffers, and v1.1 pin labels.",
    url: "https://github.com/bigtreetech/BIGTREETECH-OCTOPUS-Pro",
  }),
  Object.freeze({
    id: "stepperonline_cl57t",
    authority: "MANUFACTURER",
    title: "STEPPERONLINE CL57T V4.1",
    scope: "Owns driver terminal functions, signal limits, switches, timing, power, and alarm ratings.",
    url: "https://www.omc-stepperonline.com/download/CL57T-V41_user_manual.pdf",
  }),
  Object.freeze({
    id: "langmuir_mr1",
    authority: "MANUFACTURER",
    title: "LANGMUIR MR-1 ASSEMBLY",
    scope: "Owns stock layout, axis naming, paired Y motors, and three removable stock-driver blocks; it does not publish their mating family or pitch.",
    url: "https://www.langmuirsystems.com/mr1/assembly/v2",
  }),
  Object.freeze({
    id: "alexphredorg_mr1",
    authority: "CROSS-CHECK",
    title: "ALEXPHREDORG MR-1 / MESA",
    scope: "Corroborates stock MR-1 device identities and supplies DB44 hypotheses; never owns an Octopus pin.",
    url: "https://github.com/alexphredorg/mr1/tree/a41576f09a4ab597bfe64621c233e439ea8c5e52",
    limitations: Object.freeze([
      "Mesa terminal numbers are not Octopus pins.",
      "Wire colors and shared-enable wiring are installation-specific.",
      "Its stock limits are described as NC 5 V / active-high, so they are not approved as dry contacts.",
      "The README conflicts with its HAL for Y2/Z inputs and conflicts internally on DB44-30.",
    ]),
  }),
]);

export const WIRING_EVIDENCE_GATES = Object.freeze([
  Object.freeze({
    id: "octopus_identity",
    group: "IDENTITY",
    title: "OCTOPUS LABEL PHOTOGRAPHED",
    detail: "Board silk says PRO V1.1 and MCU marking says STM32F429ZGT6.",
  }),
  Object.freeze({
    id: "octopus_connector_fit",
    group: "METER",
    title: "OCTOPUS PIGTAIL FIT PROVED",
    detail: "One supported driver adapter and every low-voltage housing are fit-checked for pitch, key, latch, pin 1, mating-face orientation, de-energized continuity, and retention on the actual v1.1 board. Schematic contact numbers alone do not identify a physical cavity.",
  }),
  Object.freeze({
    id: "octopus_usb_flash",
    group: "BENCH",
    title: "USB-ONLY FIRMWARE FLASH PROVED",
    detail: "MAIN/MOTOR/BED power and every field plug were absent; the MCU-power jumper photo, matching SHA-256, FIRMWARE.CUR rename, COM identity, and read-only preflight were archived before the jumper was removed.",
  }),
  Object.freeze({
    id: "cl57t_faces",
    group: "IDENTITY",
    title: "ALL FOUR DRIVER FACES PHOTOGRAPHED",
    detail: "Every case says CL57T V4.1 and has rotating S1, eight-position DIP bank S2, top S3, and P5 tuning port. Record the supplied P1/P2/P3/P4 connectors on X, YL, Z, and YR.",
  }),
  Object.freeze({
    id: "cl57t_motor_current",
    group: "IDENTITY",
    title: "MOTOR KIT AND CURRENT PROVED",
    detail: "Confirm 23HS45-4204D-E1000 at 4.2 A/phase and S1=4 (4 A RMS). Photograph all switches; prove motor and encoder pairing before power.",
  }),
  Object.freeze({
    id: "cl57t_motor_coils",
    group: "METER",
    title: "ALL MOTOR COILS LABELLED",
    detail: "Trace the matched factory motor and six-conductor encoder harness for each axis with power removed. Resistance identifies coil pairs, not the required phase-to-encoder polarity. Encoder VCC comes only from its own drive; internal galvanic isolation is not established by the manual.",
  }),
  Object.freeze({
    id: "stock_limit_harness",
    group: "METER",
    title: "STOCK HOME HARNESS TRACED",
    detail: "Every stock home cable's connector key, conductor count, supply, idle voltage, triggered voltage, and unplugged state are recorded; no stock 5 V lead reaches an Octopus GPIO.",
  }),
  Object.freeze({
    id: "cl57t_interface_scope",
    group: "BENCH",
    title: "COMMAND INTERFACE SCOPE TEST PASSED",
    detail: "PUL/DIR pass 5 V level, polarity, pulse-width, setup/hold and power-transition tests into CL57T inputs. ENA remains unconnected by default; qualification is required before using the reserved enable interface.",
  }),
  Object.freeze({
    id: "cl57t_alarm_truth",
    group: "BENCH",
    title: "DRIVER ALARM TRUTH TABLE PASSED",
    detail: "Each raw ALM/COMO pair has its own isolated, current-limited conditioner. Combine only conditioned healthy outputs into the PB1 aggregate stop path. Ready, alarm, power loss and open cable pass on every drive; PG12-PG15 are diagnostics only. Never series-chain raw alarm transistors or hot-unplug motor/encoder cables to create a fault.",
  }),
  Object.freeze({
    id: "hw399_identity",
    group: "IDENTITY",
    title: "HW-399 BOTH FACES RECORDED",
    detail: "Actual terminal silk, resistor network, channel isolation, loading and power-loss truth table are documented. A HW-399 or TLP281 label does not establish the module circuit; leaving a shared output VCC floating does not prove independent open-collector outputs.",
  }),
  Object.freeze({
    id: "stock_sensor_harness",
    group: "METER",
    title: "STOCK SENSOR HARNESS TRACED",
    detail: "Connector keying, sensor metal potential, and DB44-11/12 continuity are recorded; no color or community pin claim was assumed.",
  }),
  Object.freeze({
    id: "sensor_isolation",
    group: "METER",
    title: "SENSOR ISOLATION PROVED",
    detail: "The de-energized isolated assembly has no field GND to logic HGND link. Record the complete mounted topology, sensor-metal potentials and intentional PE/control references separately; never remove PE to force an open reading. Qualified outputs keep PF5/PB7 at or below 3.3 V.",
  }),
  Object.freeze({
    id: "probe_truth",
    group: "BENCH",
    title: "PROBE AND SETTER TRUTH TABLE PASSED",
    detail: "Idle, triggered, unplugged, field-power-loss, repeat, and cable-flex states were recorded for both sensors.",
  }),
  Object.freeze({
    id: "safety_chain",
    group: "SAFETY",
    title: "HARDWIRED SAFETY CHAIN TESTED",
    detail: "Dual-channel E-stop and safety relay remove motion power and spindle permission without software.",
  }),
  Object.freeze({
    id: "protective_earth",
    group: "SAFETY",
    title: "PROTECTIVE EARTH CONTINUITY PASSED",
    detail: "Cabinet, frame, spindle chassis, DIN rail, and shields are bonded as designed.",
  }),
  Object.freeze({
    id: "cl57t_power_domains",
    group: "METER",
    title: "POWER DOMAINS METERED",
    detail: "24 V control, polarized P4 36 V bus, 5 V motion logic, isolated sensor supply, drive-supplied encoder VCC, logic GND and PE match the reviewed domain map. The historical S-360-36 is 10 A; it does not meet the proposed 12 A project margin. All-four-drive use needs a qualified replacement or measured operating envelope, including transients and regeneration.",
  }),
  Object.freeze({
    id: "spindle_identity",
    group: "HOLD",
    title: "SPINDLE DRIVE AND DB44 PROVED",
    detail: "Drive label, parameter archive, connector continuity, analog common, enable, alarm, and command range are identified. The proposed 0-5 V command versus generic 0-10 V full scale needs actual gain parameters and tachometer proof. FAN/HE terminals are low-side power outputs, not raw GPIO or analog voltage.",
  }),
  Object.freeze({
    id: "temperature_identity",
    group: "HOLD",
    title: "TEMPERATURE SENSOR IDENTIFIED",
    detail: "Part number, interface, voltage, pinout, and cable colors are proved before any ESP32 connection.",
  }),
]);

export const WIRING_INSTALL_STEPS = Object.freeze([
  Object.freeze({
    number: "01",
    state: "exact",
    title: "LABEL AND PHOTOGRAPH",
    detail: "Record Octopus, all four CL57T V4.1 drives and 23HS45-4204D-E1000 motors, encoders, switches, HW-399, spindle drive and temperature sensor. Preserve stock motors and DM860Ts for rollback.",
    action: "NO WIRE IS LANDED YET",
  }),
  Object.freeze({
    number: "02",
    state: "exact",
    title: "FLASH THE BARE BOARD FROM USB",
    detail: "With every power and field connector absent, fit only BTT's MCU USB-power jumper and flash the hash-checked production firmware through the FAT32 microSD bootloader.",
    action: "NO 24V / NO MACHINE WIRING",
  }),
  Object.freeze({
    number: "03",
    state: "exact",
    title: "BUILD SAFETY AND PE",
    detail: "A qualified person completes mains protection, protective earth, dual-channel E-stop, safety relay, and contactors.",
    action: "SOFTWARE IS MONITOR ONLY",
  }),
  Object.freeze({
    number: "04",
    state: "meter",
    title: "BENCH THE INTERFACE",
    detail: "With all power removed and zero voltage proved, fit one verified socket adapter and connect its matched motor and encoder with the mechanical coupling removed. Qualify one PUL/DIR channel set under load before copying it. Never hot-plug motor or encoder cables.",
    action: "MOTOR + ENCODER CONNECTED / COUPLER REMOVED",
  }),
  Object.freeze({
    number: "05",
    state: "exact",
    title: "LAND POWER DOMAINS",
    detail: "24 V goes to Octopus MAIN. Each CL57T receives its own fused, polarity-verified 36 V star pair on P4 +VDC/GND. Do not exceed 50 V including transients. The historical 36 V / 10 A supply is not qualified for all four drives; document a replacement or measured operating envelope first.",
    action: "POLARITY AND ISOLATION METERED",
  }),
  Object.freeze({
    number: "06",
    state: "meter",
    title: "WIRE X ONLY",
    detail: "De-energize before landing X PUL/DIR, motor P3, matched encoder P2, conditioned home and an individually conditioned ALM/COMO pair. Prove the PB1 aggregate fault path using an approved fault method. Never use an ohmmeter on an energized output. Test mechanically uncoupled at low speed.",
    action: "ONE AXIS / LOW ENERGY",
  }),
  Object.freeze({
    number: "07",
    state: "exact",
    title: "COPY X TO YL, Z, AND YR",
    detail: "Copy the proved CL57T command, encoder and polarized power wiring. Verify both Y directions and matching pulse filters before coupled operation.",
    action: "COUPLERS DISCONNECTED",
  }),
  Object.freeze({
    number: "08",
    state: "meter",
    title: "WIRE INPUTS",
    detail: "Route all four stock home channels through a qualified conditioner. Test each channel and simultaneous states for coupling, current, polarity and power loss; floating shared output VCC is not proof of independence. Direct SIG/GND is allowed only for a proved bare NC dry contact disconnected from every stock powered circuit.",
    action: "INPUT TEST / NO MOTION",
  }),
  Object.freeze({
    number: "09",
    state: "meter",
    title: "WIRE PROBE AND TOOL SETTER",
    detail: "Trace the stock sensor harness and qualify the actual HW-399 first. Then land isolated field power, IN1/OUT1 to PF5, and IN2/OUT2 to PB7.",
    action: "PROVE GND IS NOT HGND",
  }),
  Object.freeze({
    number: "10",
    state: "hold",
    title: "HOLD SPINDLE FIELD WIRING AND TEMP",
    detail: "Spindle analog and enable wiring remain disconnected until the actual drive, DB44 and command scaling pass. RS-485, encoder, M4, M19, rigid tapping, and the unidentified temperature sensor also remain held.",
    action: "IDENTITY REQUIRED",
  }),
  Object.freeze({
    number: "11",
    state: "hold",
    title: "COMMISSION IN STAGES",
    detail: "Complete the formal continuity, fault, E-stop, single-axis, dual-Y, probing, EMI, and long-program tests before cutting.",
    action: "CHECKLIST IS NOT MOTION PERMISSION",
  }),
]);

export const OCTOPUS_DRIVER_SOCKET_PINOUT = Object.freeze([
  Object.freeze({ pin: 1, signal: "EN", disposition: "RESERVED" }),
  Object.freeze({ pin: 2, signal: "SDI / MS0", disposition: "NC" }),
  Object.freeze({ pin: 3, signal: "SCK / MS1", disposition: "NC" }),
  Object.freeze({ pin: 4, signal: "CS / MS2", disposition: "NC" }),
  Object.freeze({ pin: 5, signal: "SDO / RST", disposition: "NC" }),
  Object.freeze({ pin: 6, signal: "SLEEP", disposition: "NC" }),
  Object.freeze({ pin: 7, signal: "STEP", disposition: "ROUTE" }),
  Object.freeze({ pin: 8, signal: "DIR", disposition: "ROUTE" }),
  Object.freeze({ pin: 9, signal: "GND", disposition: "ROUTE" }),
  Object.freeze({ pin: 10, signal: "VCC_IO", disposition: "NC" }),
  Object.freeze({ pin: 11, signal: "A1", disposition: "NC" }),
  Object.freeze({ pin: 12, signal: "A2", disposition: "NC" }),
  Object.freeze({ pin: 13, signal: "B2", disposition: "NC" }),
  Object.freeze({ pin: 14, signal: "B1", disposition: "NC" }),
  Object.freeze({ pin: 15, signal: "GND", disposition: "NC" }),
  Object.freeze({ pin: 16, signal: "VM", disposition: "NC" }),
  Object.freeze({ pin: 17, signal: "NC", disposition: "NC" }),
  Object.freeze({ pin: 18, signal: "DIAG", disposition: "NC" }),
]);

export const WIRING_PIGTAIL_SCHEDULE = Object.freeze([
  Object.freeze({
    id: "motor_socket_adapters",
    quantity: 4,
    state: "meter",
    item: "18-POSITION (2x9) DRIVER-SOCKET ADAPTER",
    boardEnd: "MOTOR0 / MOTOR1 / MOTOR2 / MOTOR3",
    populate: "7 STEP / 8 DIR / 9 GND ONLY / PIN 1 EN RESERVED, NOT CONNECTED",
    detail: "These are schematic contact numbers, not a mating-face cavity map. Prove physical pin 1, viewing direction, keying and de-energized continuity. A 2x8 adapter candidate remains on HOLD until its complete contact map, orientation, clearance, keying and retention are proved on the actual 18-contact socket; numbering alone does not establish fit or a row offset. Leave EN (reserved), VCC_IO, VM, phases, mode, and DIAG unconnected.",
  }),
  Object.freeze({
    id: "stop_housings",
    quantity: 8,
    state: "meter",
    item: "3-POSITION 2.54 MM KEYED HOUSING",
    boardEnd: "STOP0 THROUGH STOP7",
    populate: "SIG + GND ONLY / 16 CRIMP CONTACTS",
    detail: "BTT documents a generic 3-position header, not a guaranteed JST series. Fit-check the latch and key; leave every 5 V cavity empty.",
  }),
  Object.freeze({
    id: "thermistor_housings",
    quantity: 3,
    state: "meter",
    item: "2-POSITION 2.54 MM KEYED HOUSING",
    boardEnd: "TB / T0 / T1",
    populate: "NAMED SIGNAL + ADJACENT GND",
    detail: "Used for safety-relay monitor, feed hold, and HW-399 OUT1. Fit-check before crimping.",
  }),
  Object.freeze({
    id: "pb7_tool_setter_housing",
    quantity: 1,
    state: "meter",
    item: "5-POSITION 2.54 MM KEYED HOUSING",
    boardEnd: "PB7 TOOL-SETTER HEADER / BOARD SILK: BLTOUCH",
    populate: "PB7 + ITS ADJACENT GND ONLY",
    detail: "This is only a controller housing, not a BLTouch device. PB6 and 5 V remain empty; the firmware plugin is forced off.",
  }),
  Object.freeze({
    id: "power_detect_housing",
    quantity: 1,
    state: "meter",
    item: "3-POSITION 2.54 MM KEYED HOUSING",
    boardEnd: "PWR-DET",
    populate: "PC0 + GND ONLY",
    detail: "The 3.3 V cavity remains empty. This is the door-monitor dry contact only.",
  }),
  Object.freeze({
    id: "exp2_breakout",
    quantity: 1,
    state: "meter",
    item: "2x5 2.54 MM KEYED IDC BREAKOUT",
    boardEnd: "EXP2",
    populate: "PB1 / PB2 / GND ONLY",
    detail: "Keep this cable short inside the cabinet. Verify ribbon orientation and insulate every unused conductor.",
  }),
  Object.freeze({
    id: "hw399_logic_power",
    quantity: 1,
    state: "meter",
    item: "4-POSITION 2.54 MM KEYED HOUSING",
    boardEnd: "I2C HEADER",
    populate: "3.3 V + GND ONLY",
    detail: "Powers HW-399 HVCC/HGND. PB8 and PB9 remain empty; this is logic-side power, never sensor-field power.",
  }),
  Object.freeze({
    id: "octopus_main_power",
    quantity: 1,
    state: "exact",
    item: "24 V MAIN-POWER PAIR",
    boardEnd: "OCTOPUS MAIN POWER SCREW TERMINAL",
    populate: "+24 V + 0 V / FERRULED",
    detail: "No connector pigtail is needed. Leave MOTOR POWER and BED POWER unconnected in this design.",
  }),
  Object.freeze({
    id: "cl57t_p1",
    quantity: 4,
    state: "exact",
    item: "SUPPLIED CL57T P1 CONTROL + OUTPUT BLOCK",
    boardEnd: "PUL+ / PUL- / DIR+ / DIR- / ALM / COMO",
    populate: "PUL / DIR PAIRS + SEPARATE ALARM PAIR",
    detail: "Use the supplied P1 block. ENA stays unconnected by default; BRK is unused. Verify actual terminal order and pitch.",
  }),
  Object.freeze({
    id: "cl57t_p2",
    quantity: 4,
    state: "exact",
    item: "CL57T P2 MATCHED ENCODER HARNESS",
    boardEnd: "EA+ / EA- / EB+ / EB- / VCC / EGND",
    populate: "MATCHED MOTOR ENCODER / SIX CONDUCTORS",
    detail: "Drive VCC supplies encoder 5 V. Never back-feed it from another supply or assume internal galvanic isolation. Keep encoder cable separate from motor and bus cables; do not hot-plug. Preserve matched factory polarity; no extension cavity order is approved without tracing.",
  }),
  Object.freeze({
    id: "cl57t_p3",
    quantity: 4,
    state: "exact",
    item: "SUPPLIED CL57T P3 FOUR-PIN MOTOR BLOCK",
    boardEnd: "A+ / A- / B+ / B-",
    populate: "FOUR VERIFIED MOTOR PHASE LEADS",
    detail: "P3 carries motor phases only. P4 is the separate polarized bus input. Connect the matched encoder before power; never hot-plug.",
  }),
  Object.freeze({
    id: "cl57t_p4",
    quantity: 4,
    state: "meter",
    item: "CL57T P4 POLARIZED POWER BLOCK",
    boardEnd: "+VDC / GND",
    populate: "OWN FUSED 36 V STAR PAIR / VERIFY POLARITY",
    detail: "Verify positive at +VDC and return at GND before landing. P4 is not interchangeable AC/AC. Preserve all stock motor harnesses intact for rollback.",
  }),
  Object.freeze({
    id: "stock_home_adapters",
    quantity: 4,
    state: "hold",
    item: "STOCK HOME-HARNESS MATING ADAPTERS",
    boardEnd: "STOCK LIMIT CONNECTORS TO 5 V CONDITIONER",
    populate: "SUPPLY / SIGNAL / RETURN ONLY AFTER TRACE",
    detail: "Connector family, key, conductor count, and polarity are machine-specific proof items. Do not cut or power these cables until all four states are metered.",
  }),
  Object.freeze({
    id: "stock_sensor_adapters",
    quantity: 2,
    state: "hold",
    item: "STOCK PROBE + SETTER MATING ADAPTERS",
    boardEnd: "STOCK SENSOR CONNECTORS TO JP / JT",
    populate: "V+ / SIGNAL / RETURN AFTER TRACE",
    detail: "Wire colors and community connector order are hypotheses only. Build reversible adapters after keying and exposed-metal voltage are proved.",
  }),
  Object.freeze({
    id: "spindle_interposer",
    quantity: 1,
    state: "hold",
    item: "STOCK DB44 SPINDLE INTERPOSER",
    boardEnd: "FACTORY SERVO HARNESS",
    populate: "UNASSIGNED UNTIL CONTINUITY + DRIVE ID",
    detail: "Do not splice the factory cable or buy a pinned interposer from the community map. Analog and digital command paths remain held.",
  }),
  Object.freeze({
    id: "spindle_output_housings",
    quantity: 2,
    state: "hold",
    item: "2-POSITION FAN0 + FAN4 HOUSINGS",
    boardEnd: "PA8 PWM / PD14 ENABLE",
    populate: "NO CONNECTION DURING MOTION COMMISSIONING",
    detail: "FAN0/FAN4 are low-side switched power terminals, not raw GPIO. Verify supply selection, polarity, interface loading and power-up/off behavior. Fit-check de-energized; no spindle field interface is landed before DB44, servo identity and analog scaling pass.",
  }),
  Object.freeze({
    id: "usb_cable",
    quantity: 1,
    state: "exact",
    item: "SHIELDED USB-A TO USB-C DATA CABLE",
    boardEnd: "WINDOWS PC TO OCTOPUS USB-C",
    populate: "DATA-CAPABLE / STRAIN RELIEVED",
    detail: "Use a short, known data cable. USB is communications only and never part of the safety chain.",
  }),
]);

export const WIRING_PIN_SUMMARY = Object.freeze({
  motion: Object.freeze([
    Object.freeze({ axis: "X", socket: "MOTOR0", step: "PF13", direction: "PF12", enable: "PF14" }),
    Object.freeze({ axis: "YL", socket: "MOTOR1", step: "PG0", direction: "PG1", enable: "PF15" }),
    Object.freeze({ axis: "Z", socket: "MOTOR2", step: "PF11", direction: "PG3", enable: "PG5" }),
    Object.freeze({ axis: "YR", socket: "MOTOR3", step: "PG4", direction: "PC1", enable: "PA2" }),
  ]),
  inputs: Object.freeze([
    Object.freeze({ role: "X home", connector: "DIAG0/STOP0", gpio: "PG6" }),
    Object.freeze({ role: "Y-left home", connector: "DIAG1/STOP1", gpio: "PG9" }),
    Object.freeze({ role: "Z home", connector: "DIAG2/STOP2", gpio: "PG10" }),
    Object.freeze({ role: "Y-right home", connector: "DIAG3/STOP3", gpio: "PG11" }),
    Object.freeze({ role: "X fault", connector: "DIAG4/STOP4", gpio: "PG12" }),
    Object.freeze({ role: "Y-left fault", connector: "DIAG5/STOP5", gpio: "PG13" }),
    Object.freeze({ role: "Z fault", connector: "DIAG6/STOP6", gpio: "PG14" }),
    Object.freeze({ role: "Y-right fault", connector: "DIAG7/STOP7", gpio: "PG15" }),
    Object.freeze({ role: "Touch probe", connector: "T1", gpio: "PF5" }),
    Object.freeze({ role: "Tool setter", connector: "PB7 tool-setter input", gpio: "PB7" }),
    Object.freeze({ role: "E-stop monitor", connector: "TB", gpio: "PF3" }),
    Object.freeze({ role: "Feed hold", connector: "T0", gpio: "PF4" }),
    Object.freeze({ role: "Door monitor", connector: "PWR-DET", gpio: "PC0" }),
    Object.freeze({ role: "Cycle start", connector: "EXP2", gpio: "PB2" }),
    Object.freeze({ role: "Aggregate fault", connector: "EXP2", gpio: "PB1" }),
  ]),
  outputs: Object.freeze([
    Object.freeze({ role: "Spindle PWM", connector: "FAN0", gpio: "PA8" }),
    Object.freeze({ role: "Spindle enable", connector: "FAN4", gpio: "PD14" }),
    Object.freeze({ role: "Flood", connector: "HE0", gpio: "PA0" }),
    Object.freeze({ role: "Mist/air", connector: "HE1", gpio: "PA3" }),
  ]),
});

function knownGateIds() {
  return new Set(WIRING_EVIDENCE_GATES.map((gate) => gate.id));
}

export function normalizeWiringEvidence(candidate = {}) {
  const checked = {};
  const known = knownGateIds();
  for (const [id, value] of Object.entries(candidate.checked ?? candidate)) {
    if (known.has(id) && candidate.hardwareProfile === COMMISSIONING_HARDWARE_PROFILE) checked[id] = value === true;
  }
  return {
    version: 2,
    hardwareProfile: COMMISSIONING_HARDWARE_PROFILE,
    checked,
    commissioning: normalizeCommissioningRecord(candidate.commissioning),
  };
}

export function evaluateWiringEvidence(candidate = {}) {
  const evidence = normalizeWiringEvidence(candidate);
  const passed = WIRING_EVIDENCE_GATES.filter((gate) => evidence.checked[gate.id]).length;
  const total = WIRING_EVIDENCE_GATES.length;
  const pending = WIRING_EVIDENCE_GATES.filter((gate) => !evidence.checked[gate.id]);
  return {
    evidence,
    passed,
    total,
    pending,
    allRecorded: passed === total,
    machineMotionPermitted: false,
    status: passed === total ? "EVIDENCE RECORDED / COMMISSIONING STILL REQUIRED" : `${passed} OF ${total} EVIDENCE GATES`,
  };
}

export function loadWiringEvidence(storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem(WIRING_INSTALLATION_STORAGE_KEY);
    return normalizeWiringEvidence(raw ? JSON.parse(raw) : {});
  } catch {
    return normalizeWiringEvidence();
  }
}

export function saveWiringEvidence(candidate, storage = globalThis.localStorage) {
  const evidence = normalizeWiringEvidence(candidate);
  storage?.setItem(WIRING_INSTALLATION_STORAGE_KEY, JSON.stringify(evidence));
  return evidence;
}
