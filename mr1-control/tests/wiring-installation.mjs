import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import test from "node:test";
import { COMMISSIONING_HARDWARE_PROFILE } from '../src/commissioning-record.js';
import {
  OCTOPUS_FIRMWARE_CANDIDATE,
  OCTOPUS_DRIVER_SOCKET_PINOUT,
  WIRING_AUDIT,
  WIRING_EVIDENCE_GATES,
  WIRING_INSTALLATION_STORAGE_KEY,
  WIRING_INSTALL_STEPS,
  WIRING_PIGTAIL_SCHEDULE,
  WIRING_PIN_SUMMARY,
  WIRING_REFERENCE_SOURCES,
  evaluateWiringEvidence,
  loadWiringEvidence,
  normalizeWiringEvidence,
  saveWiringEvidence,
} from "../src/wiring-installation.js";

const manifestUrl = new URL("../../grblHAL-STM32F4/mr1/io-manifest.json", import.meta.url);
const manifest = JSON.parse(readFileSync(manifestUrl, "utf8"));
const officialPinoutUrl = new URL("../public/assets/octopus-pro-v1.1-official-pinout.jpg", import.meta.url);
const officialUsbPowerUrl = new URL("../public/assets/octopus-pro-usb-power-official.png", import.meta.url);
const firmwareCandidateUrl = new URL(
  "../public/firmware/octopus-pro-v1.1-f429-mr1/firmware.bin",
  import.meta.url,
);
const firmwareManifestUrl = new URL(
  "../public/firmware/octopus-pro-v1.1-f429-mr1/firmware-manifest.json",
  import.meta.url,
);
const sourceFirmwareUrl = new URL(
  "../../grblHAL-STM32F4/.pio/build/btt_octopus_pro_f429_mr1/firmware.bin",
  import.meta.url,
);
const appHtmlUrl = new URL("../index.html", import.meta.url);
const productionMapUrl = new URL("../../grblHAL-STM32F4/boards/btt_octopus_pro_mr1_map.h", import.meta.url);
const platformioUrl = new URL("../../grblHAL-STM32F4/platformio.ini", import.meta.url);

function parseProductionDefines(source) {
  const defines = new Map();
  for (const match of source.matchAll(/^\s*#define\s+([A-Z0-9_]+)\s+([^\s/]+)/gm)) {
    defines.set(match[1], match[2]);
  }
  return defines;
}

function resolveDefine(defines, name, seen = new Set()) {
  assert.equal(seen.has(name), false, `Circular firmware macro alias at ${name}`);
  seen.add(name);
  const value = defines.get(name);
  assert.ok(value, `Missing ${name} in production board map`);
  if (/^GPIO[A-Z]$/.test(value) || /^\d+$/.test(value)) return value;
  return resolveDefine(defines, value, seen);
}

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    values,
  };
}

function signalByMacro(macro) {
  const signal = manifest.signals.find((candidate) => candidate.macro === macro);
  assert.ok(signal, `Missing ${macro} in firmware I/O manifest`);
  return signal;
}

test("visible motion summary matches the canonical firmware manifest", () => {
  const macros = {
    X: ["X_STEP", "X_DIRECTION", "X_ENABLE"],
    YL: ["Y_STEP", "Y_DIRECTION", "Y_ENABLE"],
    Z: ["Z_STEP", "Z_DIRECTION", "Z_ENABLE"],
    YR: ["M3_STEP", "M3_DIRECTION", "M3_ENABLE"],
  };
  for (const axis of WIRING_PIN_SUMMARY.motion) {
    const [step, direction, enable] = macros[axis.axis].map(signalByMacro);
    assert.equal(axis.step, step.gpio);
    assert.equal(axis.direction, direction.gpio);
    assert.equal(axis.enable, enable.gpio);
    assert.equal(axis.socket, step.connector.split(" ")[0]);
  }
});

test("visible input and output summaries match manifest GPIOs", () => {
  const inputMacros = {
    "X home": "X_LIMIT",
    "Y-left home": "Y_LIMIT",
    "Z home": "Z_LIMIT",
    "Y-right home": "M3_LIMIT",
    "X fault": "X_MOTOR_FAULT",
    "Y-left fault": "Y_MOTOR_FAULT",
    "Z fault": "Z_MOTOR_FAULT",
    "Y-right fault": "M3_MOTOR_FAULT",
    "Touch probe": "PROBE",
    "Tool setter": "TOOLSETTER",
    "E-stop monitor": "RESET",
    "Feed hold": "FEED_HOLD",
    "Door monitor": "SAFETY_DOOR",
    "Cycle start": "CYCLE_START",
    "Aggregate fault": "MOTOR_FAULT",
  };
  const outputMacros = {
    "Spindle PWM": "SPINDLE_PWM",
    "Spindle enable": "SPINDLE_ENABLE",
    Flood: "COOLANT_FLOOD",
    "Mist/air": "COOLANT_MIST",
  };
  for (const wire of WIRING_PIN_SUMMARY.inputs) assert.equal(wire.gpio, signalByMacro(inputMacros[wire.role]).gpio);
  for (const wire of WIRING_PIN_SUMMARY.outputs) assert.equal(wire.gpio, signalByMacro(outputMacros[wire.role]).gpio);
});

test("all 31 manifest signals resolve to the production firmware GPIO map", () => {
  const source = readFileSync(productionMapUrl, "utf8");
  const defines = parseProductionDefines(source);

  assert.equal(manifest.signals.length, 31);
  for (const signal of manifest.signals) {
    const port = resolveDefine(defines, `${signal.macro}_PORT`).replace("GPIO", "P");
    const pin = resolveDefine(defines, `${signal.macro}_PIN`);
    assert.equal(`${port}${pin}`, signal.gpio, `${signal.macro} firmware/manifest mismatch`);
  }
  assert.equal(WIRING_AUDIT.firmwareMapParity, "31 OF 31");
});

test("production environment is revision-gated to Octopus Pro v1.1 F429 at 8 MHz", () => {
  const platformio = readFileSync(platformioUrl, "utf8");
  const environment = platformio.match(
    /\[env:btt_octopus_pro_f429_mr1\]([\s\S]*?)(?=\r?\n\[|$)/,
  )?.[1];

  assert.ok(environment, "Missing production PlatformIO environment");
  assert.match(environment, /-D BOARD_BTT_OCTOPUS_PRO_MR1=/);
  assert.match(environment, /-D STM32F429xx/);
  assert.match(environment, /-D HSE_VALUE=8000000/);
  assert.match(environment, /-include Inc\/mr1_octopus_config\.h/);
  assert.equal(WIRING_AUDIT.boardRevisionGate, "V1.1 / F429 / 8MHZ");
  assert.equal(WIRING_AUDIT.upstreamTargetState, "UNTESTED / QUALIFICATION REQUIRED");
});

test("installation sequence starts de-energized and ends in staged commissioning", () => {
  assert.equal(WIRING_INSTALL_STEPS.length, 11);
  assert.equal(WIRING_EVIDENCE_GATES.length, 18);
  assert.match(WIRING_INSTALL_STEPS[0].action, /NO WIRE/);
  assert.match(WIRING_INSTALL_STEPS[1].title, /FLASH THE BARE BOARD FROM USB/);
  assert.match(WIRING_INSTALL_STEPS[1].action, /NO 24V \/ NO MACHINE WIRING/);
  assert.match(WIRING_INSTALL_STEPS.at(-1).title, /COMMISSION/);
  assert.equal(WIRING_AUDIT.productionState, "PHYSICAL COMMISSIONING LOCKED");
});

test("USB-only flash remains a physical evidence gate", () => {
  const gate = WIRING_EVIDENCE_GATES.find((candidate) => candidate.id === "octopus_usb_flash");
  assert.ok(gate);
  assert.equal(gate.group, "BENCH");
  assert.match(gate.detail, /MAIN\/MOTOR\/BED power and every field plug were absent/);
  assert.match(gate.detail, /FIRMWARE\.CUR/);
  assert.match(gate.detail, /read-only preflight/);
  assert.match(gate.detail, /jumper was removed/);
});

test("source ledger separates exact wiring authorities from the MR-1 community cross-check", () => {
  const sourceById = Object.fromEntries(WIRING_REFERENCE_SOURCES.map((source) => [source.id, source]));
  assert.equal(sourceById.firmware_manifest.authority, "EXACT");
  assert.equal(sourceById.grblhal_octopus_target.authority, "UPSTREAM");
  assert.equal(sourceById.btt_octopus.authority, "MANUFACTURER");
  assert.equal(sourceById.stepperonline_cl57t.authority, "MANUFACTURER");
  assert.equal(sourceById.langmuir_mr1.authority, "MANUFACTURER");
  assert.equal(sourceById.alexphredorg_mr1.authority, "CROSS-CHECK");
  assert.match(sourceById.stepperonline_cl57t.url, /CL57T-V41_user_manual\.pdf/);
  assert.match(sourceById.btt_octopus.scope, /MCU USB-power jumper/);
  assert.match(sourceById.btt_octopus.scope, /SD bootloader method/);
  assert.match(sourceById.btt_octopus.scope, /5 V HCT buffers/);
  assert.match(sourceById.alexphredorg_mr1.url, /a41576f09a4ab597bfe64621c233e439ea8c5e52/);
  assert.ok(sourceById.alexphredorg_mr1.limitations.some((line) => /not Octopus pins/i.test(line)));
  assert.ok(sourceById.alexphredorg_mr1.limitations.some((line) => /NC 5 V/i.test(line)));
  assert.ok(sourceById.alexphredorg_mr1.limitations.some((line) => /DB44-30/i.test(line)));

  const html = readFileSync(appHtmlUrl, "utf8");
  assert.match(html, /SOURCE LEDGER/);
  assert.match(html, /ALEXPHREDORG MR-1 \/ MESA/);
  assert.match(html, /DO NOT COPY FROM THE MESA BUILD/);
});

test("driver socket adapter routes only the four approved 18-position contacts", () => {
  assert.equal(OCTOPUS_DRIVER_SOCKET_PINOUT.length, 18);
  assert.deepEqual(
    OCTOPUS_DRIVER_SOCKET_PINOUT.filter((contact) => contact.disposition === "ROUTE")
      .map(({ pin, signal }) => [pin, signal]),
    [[1, "EN"], [7, "STEP"], [8, "DIR"], [9, "GND"]],
  );
  assert.equal(new Set(OCTOPUS_DRIVER_SOCKET_PINOUT.map((contact) => contact.pin)).size, 18);
  assert.equal(manifest.motion.octopus_driver_socket.positions, 18);
  assert.deepEqual(manifest.motion.octopus_driver_socket.routed_contacts, {
    enable: 1,
    step: 7,
    direction: 8,
    logic_ground: 9,
  });
  assert.match(WIRING_AUDIT.commandInterface, /5V-BUFFERED SOCKET/);
});

test("pigtail schedule separates build, fit-check, and held stock connectors", () => {
  assert.ok(WIRING_PIGTAIL_SCHEDULE.length >= 15);
  assert.equal(new Set(WIRING_PIGTAIL_SCHEDULE.map((item) => item.id)).size, WIRING_PIGTAIL_SCHEDULE.length);
  assert.ok(WIRING_PIGTAIL_SCHEDULE.every((item) => ["exact", "meter", "hold"].includes(item.state)));
  const byId = Object.fromEntries(WIRING_PIGTAIL_SCHEDULE.map((item) => [item.id, item]));
  assert.equal(byId.motor_socket_adapters.quantity, 4);
  assert.match(byId.motor_socket_adapters.populate, /PIN 1 EN \/ 7 STEP \/ 8 DIR \/ 9 GND/);
  assert.equal(byId.stop_housings.quantity, 8);
  assert.match(byId.stop_housings.detail, /5 V cavity empty/);
  assert.equal(byId.pb7_tool_setter_housing.quantity, 1);
  assert.match(byId.pb7_tool_setter_housing.boardEnd, /PB7 TOOL-SETTER/);
  assert.match(byId.pb7_tool_setter_housing.detail, /not a BLTouch device/i);
  assert.equal(byId.cl57t_p1.quantity, 4);
  assert.equal(byId.cl57t_p2.quantity, 4);
  assert.equal(byId.cl57t_p3.quantity, 4);
  assert.equal(byId.stock_home_adapters.state, "hold");
  assert.equal(byId.stock_sensor_adapters.state, "hold");
  assert.equal(byId.spindle_interposer.state, "hold");

  const html = readFileSync(appHtmlUrl, "utf8");
  assert.match(html, /data-wiring-tab="harness"/);
  assert.match(html, /id="wiring-pigtail-list"/);
  assert.match(html, /NEVER CONNECT STOCK 5V TO STOP0-3/);
  assert.match(html, /NO BLTOUCH HARDWARE/);
});

test("stock probe and tool-setter harness remains a physical proof gate", () => {
  const gate = WIRING_EVIDENCE_GATES.find((candidate) => candidate.id === "stock_sensor_harness");
  assert.ok(gate);
  assert.equal(gate.group, "METER");
  assert.match(gate.detail, /DB44-11\/12/);
  assert.match(gate.detail, /no color/i);
});

test("stock home harness is conditioned and remains a physical proof gate", () => {
  const gate = WIRING_EVIDENCE_GATES.find((candidate) => candidate.id === "stock_limit_harness");
  assert.ok(gate);
  assert.equal(gate.group, "METER");
  assert.match(gate.detail, /no stock 5 V lead reaches an Octopus GPIO/i);
  const limitSignals = manifest.signals.filter((signal) => ["X_LIMIT", "Y_LIMIT", "Z_LIMIT", "M3_LIMIT"].includes(signal.macro));
  assert.equal(limitSignals.length, 4);
  assert.ok(limitSignals.every((signal) => /conditioned/i.test(signal.role)));
  assert.ok(limitSignals.every((signal) => /healthy-low/i.test(signal.role)));
});

test("official Octopus Pro v1.1 pinout asset is present and is a full JPEG", { skip: !existsSync(officialPinoutUrl) && "Optional local BTT image not imported." }, () => {
  const image = readFileSync(officialPinoutUrl);
  const header = image.subarray(0, 3);
  assert.deepEqual([...header], [0xff, 0xd8, 0xff]);
  assert.ok(statSync(officialPinoutUrl).size > 1_000_000);
  assert.equal(
    createHash("sha256").update(image).digest("hex").toUpperCase(),
    WIRING_AUDIT.officialPinoutSha256,
  );
});

test("official BTT USB-power reference is present and hash pinned", { skip: !existsSync(officialUsbPowerUrl) && "Optional local BTT image not imported." }, () => {
  const image = readFileSync(officialUsbPowerUrl);
  assert.deepEqual([...image.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.ok(statSync(officialUsbPowerUrl).size > 500_000);
  assert.equal(
    createHash("sha256").update(image).digest("hex").toUpperCase(),
    WIRING_AUDIT.officialUsbPowerImageSha256,
  );
});

test("production firmware manifest preserves the pinned deployment contract", () => {
  const firmwareManifest = JSON.parse(readFileSync(firmwareManifestUrl, "utf8"));
  assert.equal(firmwareManifest.artifact.bytes, OCTOPUS_FIRMWARE_CANDIDATE.bytes);
  assert.equal(firmwareManifest.artifact.sha256, OCTOPUS_FIRMWARE_CANDIDATE.sha256);
  assert.equal(firmwareManifest.boardIdentity.revision, "V1.1");
  assert.equal(firmwareManifest.boardIdentity.mcu, "STM32F429ZGT6");
  assert.equal(firmwareManifest.bootloader.applicationAddress, "0x08008000");
  assert.equal(firmwareManifest.power.main24V, "PHYSICALLY DISCONNECTED");
  assert.equal(firmwareManifest.power.motor36V, "PHYSICALLY DISCONNECTED");
  assert.equal(firmwareManifest.power.removeUsbPowerJumperBeforeMainPower, true);
  assert.equal(firmwareManifest.validation.physicalFlash, "NOT RUN");
  assert.equal(firmwareManifest.validation.physicalMotionPermitted, false);
});

test("FLASH view exposes the exact fail-closed USB-only workflow", () => {
  const html = readFileSync(appHtmlUrl, "utf8");
  assert.match(html, /data-wiring-tab="flash"/);
  assert.match(html, /octopus-pro-usb-power-official\.png/);
  assert.match(html, /THIS IS NOT BOOT0/);
  assert.match(html, /No 24V, 36V, 5V field supply, spindle, relay, motor, probe, or machine cable remains/);
  assert.match(html, /FIRMWARE\.CUR/);
  assert.match(html, /read-only controller preflight to pass/);
  assert.match(html, /remove the MCU USB-power jumper before any future 24V MAIN connection/);
  assert.match(html, /firmware\/octopus-pro-v1\.1-f429-mr1\/firmware\.bin/);
  assert.match(html, /firmware\/octopus-pro-v1\.1-f429-mr1\/firmware-manifest\.json/);
  assert.match(html, /id="octopus-firmware-file"/);
  assert.match(html, /data-firmware-attestation="bootloader_rename"/);
  assert.match(html, /id="octopus-flash-gate-preflight"/);
  assert.match(html, /SIMULATION REJECTED/);
  assert.match(html, /DOWNLOAD SEALED RECORD/);
});

test("evidence checks persist but never grant motion permission", () => {
  const storage = memoryStorage();
  const checked = Object.fromEntries(WIRING_EVIDENCE_GATES.map((gate) => [gate.id, true]));
  const saved = saveWiringEvidence({ hardwareProfile: COMMISSIONING_HARDWARE_PROFILE, checked, ignored_key: true }, storage);
  assert.equal(storage.values.has(WIRING_INSTALLATION_STORAGE_KEY), true);
  assert.deepEqual(loadWiringEvidence(storage), saved);
  const evaluation = evaluateWiringEvidence(saved);
  assert.equal(evaluation.passed, evaluation.total);
  assert.equal(evaluation.allRecorded, true);
  assert.equal(evaluation.machineMotionPermitted, false);
  assert.match(evaluation.status, /COMMISSIONING STILL REQUIRED/);
});

test("unknown and non-boolean evidence values fail closed", () => {
  const normalized = normalizeWiringEvidence({
    hardwareProfile: COMMISSIONING_HARDWARE_PROFILE,
    checked: {
      octopus_identity: "yes",
      cl57t_faces: true,
      made_up_gate: true,
    },
  });
  assert.deepEqual(normalized.checked, {
    octopus_identity: false,
    cl57t_faces: true,
  });
});

test('previous drive installation cannot carry evidence into the closed-loop setup', () => {
  const checked = Object.fromEntries(WIRING_EVIDENCE_GATES.map(g => [g.id, true]));
  assert.equal(evaluateWiringEvidence({ checked }).passed, 0);
  assert.equal(evaluateWiringEvidence({ hardwareProfile: 'dm860t', checked }).passed, 0);
});

test('active wiring includes polarized P4 power, encoder P2 and aggregate motor fault', () => {
  const byId = Object.fromEntries(WIRING_PIGTAIL_SCHEDULE.map(item => [item.id, item]));
  assert.match(byId.cl57t_p4.boardEnd, /\+VDC \/ GND/);
  assert.match(byId.cl57t_p2.boardEnd, /EA\+.*EB\+.*VCC.*EGND/);
  assert.doesNotMatch(byId.cl57t_p3.boardEnd, /AC|VDC/);
  const html = readFileSync(appHtmlUrl, 'utf8');
  assert.match(html, /S3 CONTROL VOLTAGE/);
  assert.match(html, /PB1 aggregate stop path/);
  assert.doesNotMatch(html, /<b>AC<\/b>|<span>SW9<\/span>|S2 CONTROL VOLTAGE|DM860T V3/);
});

test('physical socket and motor polarity evidence cannot be inferred from schematic numbers or coil resistance', () => {
  const byId = Object.fromEntries(WIRING_PIGTAIL_SCHEDULE.map(item => [item.id, item]));
  const gates = Object.fromEntries(WIRING_EVIDENCE_GATES.map(item => [item.id, item]));
  assert.match(byId.motor_socket_adapters.detail, /schematic contact numbers, not a mating-face cavity map/i);
  assert.match(byId.motor_socket_adapters.detail, /pin 1, viewing direction, keying and de-energized continuity/i);
  assert.match(gates.cl57t_motor_coils.detail, /not the required phase-to-encoder polarity/i);
  const html = readFileSync(appHtmlUrl, 'utf8');
  assert.match(html, /Resistance checks identify coil pairs, not phase-to-encoder polarity/);
  assert.doesNotMatch(html, /COIL 1 \/ END 1|IDENTIFY BY OHMS/);
  assert.match(html, /No motor, encoder or GX16 cavity order is approved without tracing/);
});

test('alarm instructions require individual conditioning, supervised healthy state and safe fault injection', () => {
  const gate = WIRING_EVIDENCE_GATES.find(item => item.id === 'cl57t_alarm_truth');
  assert.match(gate.detail, /Each raw ALM\/COMO pair has its own isolated, current-limited conditioner/);
  assert.match(gate.detail, /Combine only conditioned healthy outputs/);
  assert.match(gate.detail, /PG12-PG15 are diagnostics only/);
  const html = readFileSync(appHtmlUrl, 'utf8');
  const alarms = html.slice(html.indexOf('ROUTE EACH DRIVE ALARM'), html.indexOf('HARDWIRED STOP FIRST'));
  assert.match(alarms, /Never series-chain raw alarm transistors/);
  assert.match(alarms, /software inversion cannot distinguish it from a broken cable/);
  assert.match(alarms, /never hot-unplug motor or encoder cables/);
  assert.match(alarms, /never use an ohmmeter on an energized output/);
  assert.match(alarms, /Arrange cable-open tests de-energized/);
});

test('isolation checks distinguish the bare assembly from mounted PE references and unqualified module topology', () => {
  const gates = Object.fromEntries(WIRING_EVIDENCE_GATES.map(item => [item.id, item]));
  assert.match(gates.sensor_isolation.detail, /de-energized isolated assembly/);
  assert.match(gates.sensor_isolation.detail, /never remove PE to force an open reading/i);
  assert.match(gates.hw399_identity.detail, /leaving a shared output VCC floating does not prove independent open-collector outputs/i);
  const html = readFileSync(appHtmlUrl, 'utf8');
  assert.match(html, /USB to an earthed PC or an intentional control-0V bond can make logic GND-to-PE continuity expected/);
  assert.match(html, /Leaving a shared output VCC floating can couple channels through pullup resistors/);
  assert.doesNotMatch(html, /FIELD GND NEVER JOINS HGND OR PE|No isolated-sensor return continuity to logic GND, frame, or PE|The isolated field return never joins Octopus GND, frame, spindle, shield, or PE/);
});

test('power and output wiring preserve unqualified supply and spindle constraints', () => {
  const gate = WIRING_EVIDENCE_GATES.find(item => item.id === 'cl57t_power_domains');
  assert.match(gate.detail, /10 A; it does not meet the proposed 12 A project margin/);
  const html = readFileSync(appHtmlUrl, 'utf8');
  const power = html.slice(html.indexOf('<section id="power-panel"'), html.indexOf('<section id="outputs-panel"'));
  const outputs = html.slice(html.indexOf('<section id="outputs-panel"'), html.indexOf('<section id="temperature-panel"'));
  assert.match(power, /12A is not a CL57T manufacturer minimum/);
  assert.match(power, /All-four-drive operation remains unqualified/);
  assert.match(power, /transients and regeneration/);
  assert.match(outputs, /FAN0\/PA8, FAN4\/PD14, HE0\/PA0 and HE1\/PA3 are low-side switched power terminals/);
  assert.match(outputs, /FAN5 is PD15; PE15 is an unused EXP1 candidate/);
  assert.doesNotMatch(html, /FAN5 \/ PE15|<span>FAN5<\/span><code>PE15<\/code>/);
  assert.match(outputs, /proposed 0-5V command versus generic 0-10V full scale remains unresolved/);
  assert.match(outputs, /Leave all spindle field wiring disconnected/);
});

test('wiring workbench link opens the local checklist without changing evidence', () => {
  const html = readFileSync(appHtmlUrl, 'utf8');
  assert.match(html, /href="\/wiring\/workbench\.html" target="_blank" rel="noopener"/);
  const untouched = evaluateWiringEvidence();
  assert.equal(untouched.passed, 0);
  assert.equal(untouched.machineMotionPermitted, false);
});

test('optional production image matches immutable bytes and SHA-256', { skip: !existsSync(firmwareCandidateUrl) && 'Optional local firmware image not imported.' }, () => {
  const firmware = readFileSync(firmwareCandidateUrl);
  assert.equal(firmware.length, OCTOPUS_FIRMWARE_CANDIDATE.bytes);
  assert.equal(createHash('sha256').update(firmware).digest('hex').toUpperCase(), OCTOPUS_FIRMWARE_CANDIDATE.sha256);
});
test('optional actual source build matches pinned production image', { skip: !existsSync(sourceFirmwareUrl) && 'No local source build exists; binary-to-source reproduction was not tested.' }, () => {
  const firmware = readFileSync(sourceFirmwareUrl);
  assert.equal(firmware.length, OCTOPUS_FIRMWARE_CANDIDATE.bytes);
  assert.equal(createHash('sha256').update(firmware).digest('hex').toUpperCase(), OCTOPUS_FIRMWARE_CANDIDATE.sha256);
  if (existsSync(firmwareCandidateUrl)) assert.deepEqual(firmware, readFileSync(firmwareCandidateUrl));
});
