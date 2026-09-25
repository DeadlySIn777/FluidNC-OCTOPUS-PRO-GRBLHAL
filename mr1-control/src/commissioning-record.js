import { sha256TextHex } from "./browser-crypto.js";

export const COMMISSIONING_FORMAT = "mr1-control-commissioning-record";
export const COMMISSIONING_PROTOCOL = "mr1-commissioning-evidence-v1";
export const COMMISSIONING_SCHEMA_VERSION = 1;
export const COMMISSIONING_HARDWARE_PROFILE = 'mr1-cl57t-v4.1-23hs45-4204d-e1000';
export const MAX_COMMISSIONING_BUNDLE_BYTES = 2 * 1024 * 1024;

const SHA256_PATTERN = /^[0-9A-F]{64}$/;
const SOURCES = new Set(["physical", "document", "simulation"]);

function freezeCheck(stageId, definition) {
  return Object.freeze({
    stageId,
    method: "INSPECTION",
    acceptedSources: Object.freeze(["physical"]),
    requiresArtifact: true,
    requiresInstrument: false,
    bindController: false,
    bindFirmware: false,
    legacyGateId: null,
    ...definition,
  });
}

function freezeStage(number, id, title, summary, checks) {
  return Object.freeze({
    number,
    id,
    title,
    summary,
    checks: Object.freeze(checks.map((check) => freezeCheck(id, check))),
  });
}

const documentCheck = (definition) => ({
  acceptedSources: ["document"],
  method: "RECORD",
  ...definition,
});

const measuredCheck = (definition) => ({
  method: "MEASURE",
  requiresInstrument: true,
  ...definition,
});

const controllerCheck = (definition) => ({
  bindController: true,
  bindFirmware: true,
  ...definition,
});

export const COMMISSIONING_STAGES = Object.freeze([
  freezeStage(0, "baseline", "SOURCE BASELINE", "Freeze the exact source, binaries, stock backup, and transfer rehearsal.", [
    documentCheck({
      id: "source_release",
      title: "SOURCE + BUILD MANIFEST SEALED",
      criterion: "The source revision, toolchains, dependency lock, firmware binary, application build, and every published SHA-256 are captured in one release manifest.",
    }),
    documentCheck({
      id: "stock_backup",
      title: "STOCK MACHINE BACKUP ARCHIVED",
      criterion: "CutControl settings, stock controller data, spindle parameters, wiring photographs, and rollback labels are archived before disassembly.",
    }),
    {
      id: "second_pc_restore",
      title: "SECOND-PC RESTORE REHEARSED",
      method: "TRANSFER",
      acceptedSources: ["physical"],
      criterion: "The portable package, sealed machine bundle, and event journal open and verify on the intended second Windows PC without silent defaults.",
    },
  ]),
  freezeStage(1, "identity", "PHYSICAL IDENTITY", "Bind every real component and unknown harness to photographs and markings.", [
    { id: "octopus_identity", title: "OCTOPUS V1.1 / F429 IDENTITY", criterion: "Both board faces, PRO V1.1 silk, STM32F429ZGT6 marking, crystal area, jumpers, and connector orientation are legible.", legacyGateId: "octopus_identity" },
    { id: "cl57t_faces", title: "FOUR CL57T V4.1 IDENTITIES", criterion: "All four V4.1 labels, S1 rotary, S2 DIP bank, S3 selector, P1-P5 and matching encoders are visible and assigned to X, YL, Z and YR.", legacyGateId: "cl57t_faces" },
    { id: "cl57t_motor_current", title: "CLOSED-LOOP MOTOR CURRENT EVIDENCE", criterion: "All motors are 23HS45-4204D-E1000 at 4.2 A/phase. S1=4 sets 4 A RMS. Motor/encoder matching, mechanical fit and all switch positions are recorded.", legacyGateId: "cl57t_motor_current" },
    { id: "hw399_identity", title: "HW-399 CHANNEL TOPOLOGY", criterion: "Both module faces and terminal silk prove the actual channel topology before probe wiring is accepted.", legacyGateId: "hw399_identity" },
    { id: "spindle_identity", title: "SPINDLE DRIVE + DB44 IDENTITY", criterion: "Drive and motor labels, connector keys, parameter archive, DB44 continuity notes, and command/alarm terminals are captured.", legacyGateId: "spindle_identity" },
    { id: "temperature_identity", title: "TEMPERATURE SENSOR IDENTITY", criterion: "The exact sensor part, interface, voltage, pinout, package, and cable colors are identified before ESP32 connection.", legacyGateId: "temperature_identity" },
  ]),
  freezeStage(2, "safety", "SAFETY + POWER", "Prove the hardwired safety function independently of Windows, USB, and firmware.", [
    documentCheck({ id: "safety_review", title: "SAFETY DESIGN REVIEW", criterion: "The risk assessment, schematic, exact catalog parts, protection calculations, reset policy, and single-fault analysis are independently reviewed." }),
    measuredCheck({ id: "protective_earth", title: "PROTECTIVE EARTH CONTINUITY", criterion: "Frame, cabinet, spindle chassis, DIN rail, doors, and designated shields meet the reviewed continuity limit.", legacyGateId: "protective_earth" }),
    measuredCheck({ id: "safety_chain", title: "DUAL-CHANNEL E-STOP FUNCTION", criterion: "Each channel, contactor feedback, welded-contact detection, and reset path removes motion power and spindle permission without software.", legacyGateId: "safety_chain" }),
    { id: "restart_prevention", title: "POWER-LOSS + RESTART PREVENTION", method: "FAULT INJECTION", criterion: "Power loss, USB loss, controller reset, safety-door trip, and E-stop release cannot cause an automatic restart." },
  ]),
  freezeStage(3, "interface", "INTERFACE P0", "Qualify one representative channel into the actual load before duplication.", [
    { id: "octopus_connector_fit", title: "CONNECTOR FIT + PIN 1", criterion: "The 18-position adapter and every low-voltage housing are fit-checked for pitch, key, latch, pin 1, and retention.", legacyGateId: "octopus_connector_fit" },
    measuredCheck({ id: "cl57t_interface_scope", title: "STEP / DIR / ENABLE SCOPE", criterion: "All PUL/DIR channels meet CL57T V4.1 voltage, polarity, pulse width, setup/hold and power-transition requirements into a real input load. Reserved ENA use requires separate qualification.", legacyGateId: "cl57t_interface_scope" }),
    measuredCheck({ id: "cl57t_alarm_static", title: "DRIVE ALARM STATIC INPUT TRUTH", criterion: "Before first motion, electrically measure healthy, alarm, power-loss and open-cable states for every ALM/COMO channel and the PB1 aggregate using the reviewed test method. Capture the actual controller input reports and prove the 3.3 V GPIO limit. PG12-PG15 are diagnostics only. This static record does not claim a moving-axis stop test passed." }),
    measuredCheck({ id: "cl57t_alarm_truth", title: "DRIVE ALARM TRUTH TABLE", criterion: "ALM/COMO healthy, alarm, power-loss and open-cable states pass on all four channels. Prove that the PB1 aggregate stops motion; PG12-PG15 are diagnostic only.", legacyGateId: "cl57t_alarm_truth" }),
    measuredCheck({ id: "stock_limit_harness", title: "FOUR STOCK HOME HARNESSES", criterion: "Supply, idle, triggered, unplugged, and field-power-loss voltages are recorded separately for X, YL, Z, and YR; no 5 V reaches a GPIO.", legacyGateId: "stock_limit_harness" }),
    measuredCheck({ id: "stock_sensor_harness", title: "PROBE + SETTER HARNESS TRACE", criterion: "Connector keying, metal potential, supply, signal, return, and DB44 continuity are measured without color assumptions.", legacyGateId: "stock_sensor_harness" }),
    measuredCheck({ id: "sensor_isolation", title: "SENSOR ISOLATION + GPIO LIMIT", criterion: "Field GND to logic HGND remains isolated and PF5/PB7 remain within the 3.3 V input domain in every tested state.", legacyGateId: "sensor_isolation" }),
    measuredCheck({ id: "probe_truth", title: "PROBE + SETTER TRUTH TABLE", criterion: "Idle, trigger, unplugged, field-power-loss, repeat, and cable-flex states are recorded for each sensor channel.", legacyGateId: "probe_truth" }),
    measuredCheck({ id: "cl57t_power_domains", title: "ALL POWER DOMAINS METERED", criterion: "24 V control, polarized P4 motion supply, 5 V command logic, drive-supplied encoder VCC, isolated sensor supply, logic ground and PE match the released map.", legacyGateId: "cl57t_power_domains" }),
  ]),
  freezeStage(4, "controller", "BARE OCTOPUS", "Flash and qualify the uncabled controller before any machine load is connected.", [
    controllerCheck({ id: "octopus_usb_flash", title: "USB-ONLY BOOTLOADER FLASH", method: "BOOTLOADER", criterion: "On a bare nonconductive bench, the exact firmware hash is renamed to FIRMWARE.CUR and the temporary MCU USB-power jumper is removed afterward.", legacyGateId: "octopus_usb_flash" }),
    controllerCheck({ id: "physical_preflight", title: "PHYSICAL READ-ONLY PREFLIGHT", method: "TRANSCRIPT", acceptedSources: ["physical"], criterion: "$I+, $$, $G, $#, and realtime status match the production profile with no active inputs; a simulator transcript is rejected." }),
    measuredCheck(controllerCheck({ id: "gpio_scope", title: "NO-LOAD GPIO QUALIFICATION", criterion: "Step, direction, enable, PWM, relay, limit, probe, setter, fault, and safety pins match the production manifest and fail-state expectations." })),
    measuredCheck(controllerCheck({ id: "usb_disconnect", title: "RESET + USB-DISCONNECT BEHAVIOR", criterion: "Reset, watchdog, USB removal/reconnect, and brownout produce no output glitch or unintended enable transition." })),
  ]),
  freezeStage(5, "axis_x", "X AXIS", "Commission one low-energy axis before repeating the architecture.", [
    measuredCheck(controllerCheck({ id: "x_uncoupled", title: "X UNCOUPLED LOW-ENERGY TEST", criterion: "Coil pairing, current limit, enable truth, direction, pulse response, alarm, and open-cable behavior pass with the coupler disconnected." })),
    measuredCheck(controllerCheck({ id: "x_scale", title: "X DIRECTION + SCALE", criterion: "Coupled X motion agrees with machine coordinates and measured travel; steps/mm and backlash are recorded." })),
    controllerCheck({ id: "x_home_limit", title: "X HOME + LIMIT REPEATABILITY", method: "REPEAT", criterion: "Twenty home cycles, overtravel margin, hard/soft limits, and switch-open fault behavior pass without a false direction." }),
    controllerCheck({ id: "x_fault_thermal", title: "X FAULT + THERMAL SOAK", method: "FAULT / SOAK", criterion: "Drive fault, USB loss, coolant/relay EMI, cable flex, and the required motion soak complete without missed position or unsafe restart." }),
  ]),
  freezeStage(6, "axis_z", "Z AXIS", "Prove gravity-axis behavior, long-tool clearance, and every Z safe-state.", [
    measuredCheck(controllerCheck({ id: "z_uncoupled", title: "Z UNCOUPLED LOW-ENERGY TEST", criterion: "Coil pairing, current, enable, direction, pulse response, alarm, and power-loss behavior pass before coupling." })),
    measuredCheck(controllerCheck({ id: "z_scale", title: "Z DIRECTION + SCALE", criterion: "Machine-coordinate sign, steps/mm, backlash, usable travel, and long-tool clearance are physically measured." })),
    controllerCheck({ id: "z_home_limit", title: "Z HOME + LIMIT REPEATABILITY", method: "REPEAT", criterion: "Twenty home cycles, pull-off, top/bottom margins, soft limits, and switch-open behavior pass." }),
    controllerCheck({ id: "z_fault_thermal", title: "Z POWER-LOSS + THERMAL SOAK", method: "FAULT / SOAK", criterion: "Power removal, drive fault, USB loss, relay EMI, cable flex, and soak behavior do not create unsafe descent or restart." }),
  ]),
  freezeStage(7, "dual_y", "DUAL Y + SQUARING", "Keep Y-left and Y-right independent until each channel and mismatch abort is proved.", [
    measuredCheck(controllerCheck({ id: "y_independent", title: "YL + YR INDEPENDENT TESTS", criterion: "Each motor, alarm, home input, direction, scale, and open-cable state passes alone with the gantry uncoupled where required." })),
    measuredCheck(controllerCheck({ id: "y_coupled_scale", title: "COUPLED Y DIRECTION + SCALE", criterion: "Coupled travel is smooth, correctly signed, dimensionally verified, and free from fighting motors." })),
    controllerCheck({ id: "y_auto_square", title: "DUAL-HOME AUTO-SQUARE", method: "REPEAT", criterion: "Twenty cycles independently latch YL/YR, settle within the allowed squareness window, and retain repeatability." }),
    controllerCheck({ id: "y_mismatch_abort", title: "SQUARING MISMATCH ABORT", method: "FAULT INJECTION", criterion: "Stuck, missing, early, and late Y home signals abort before racking exceeds the defined mechanical limit." }),
    controllerCheck({ id: "y_fault_thermal", title: "DUAL-Y FAULT + THERMAL SOAK", method: "FAULT / SOAK", criterion: "Either drive fault, either cable-open, relay/coolant EMI, and the motion soak stop both sides safely without position loss." }),
  ]),
  freezeStage(8, "sender", "WINDOWS SENDER", "Capture emitted commands and qualify every operator workflow against the MR-1 envelope.", [
    documentCheck(controllerCheck({ id: "sender_binary", title: "SENDER INSTALLER + HASH PINNED", criterion: "The exact signed Windows installer, version, SHA-256, update policy, and configuration export are archived." })),
    controllerCheck({ id: "sender_safe_z", title: "SAFE-Z WORKFLOW MATRIX", method: "COMMAND CAPTURE", criterion: "Go-To, park, corners, probing, setter, and long-tool paths never issue the known unsafe G53 Z-1 sequence or leave the valid Z envelope." }),
    controllerCheck({ id: "sender_job_control", title: "JOB / HOLD / RESUME / ABORT", method: "COMMAND CAPTURE", criterion: "Run, check mode, feed hold, resume, abort, USB loss, reconnect, and recovery preserve ownership and machine state." }),
    controllerCheck({ id: "sender_wcs_tools", title: "WCS + TOOL WORKFLOWS", method: "COMMAND CAPTURE", criterion: "G53, G54-G59, tool changes, cutter compensation, units, modal state, and run-from-line behavior match the MR-1 contract." }),
  ]),
  freezeStage(9, "spindle", "SPINDLE BASELINE", "Commission forward-only isolated analog control before digital, reverse, or synchronization work.", [
    measuredCheck(controllerCheck({ id: "spindle_command_scope", title: "ENABLE + ANALOG COMMAND SCOPE", criterion: "Hardwired permit, isolated enable, 0-5 V command, off-state, startup, stop, USB loss, and controller reset are electrically captured." })),
    measuredCheck(controllerCheck({ id: "spindle_speed", title: "COMMANDED / ACTUAL RPM CALIBRATION", criterion: "Command voltage and actual spindle RPM are measured across the operating range with error limits recorded." })),
    controllerCheck({ id: "spindle_safety", title: "SPINDLE ALARM + E-STOP", method: "FAULT INJECTION", criterion: "Drive alarm, E-stop, door/safety trip, command loss, and restart prevention remove spindle permission as designed." }),
    measuredCheck(controllerCheck({ id: "spindle_emi_thermal", title: "SPINDLE EMI + THERMAL SOAK", criterion: "Spindle ramps, coolant, motion, encoder/sensor traffic, and sustained operation produce no false input, USB, or command failures." })),
  ]),
  freezeStage(10, "probing", "PROBE + SETTER", "Qualify electronics, repeatability, protected travel, and fault behavior before automatic use.", [
    measuredCheck(controllerCheck({ id: "probe_repeatability", title: "TOUCH PROBE REPEATABILITY", criterion: "Directional calibration and repeated slow contacts at representative feeds establish mean, spread, and permitted use." })),
    measuredCheck(controllerCheck({ id: "setter_repeatability", title: "TOOL SETTER REPEATABILITY", criterion: "Reference tool, short/long tools, double-touch feeds, repeatability, and overtravel margin meet the defined limits." })),
    controllerCheck({ id: "protected_cycles", title: "PROTECTED CYCLE ENVELOPES", method: "MOTION REVIEW", criterion: "Pre-trigger checks, 3 mm-class retracts, maximum search, expected-contact guard, clearance plane, limits, and abort paths pass." }),
    controllerCheck({ id: "probe_faults", title: "PROBE FAULT INJECTION", method: "FAULT INJECTION", criterion: "Already-triggered, never-triggered, unplugged, noisy, field-power-loss, and mid-cycle disconnect states stop before tool damage." }),
  ]),
  freezeStage(11, "table", "TABLE + WCS", "Bind the physical fixture plate and every production work offset to machine coordinates.", [
    measuredCheck(controllerCheck({ id: "table_frame", title: "FIXTURE-PLATE FRAME FIT", criterion: "Qualified hole measurements solve origin, rotation, pitch, scale, skew, and residual error against the actual plate CAD." })),
    measuredCheck(controllerCheck({ id: "wcs_validation", title: "G54-G59 INDEPENDENT CHECK", criterion: "Each enabled vise fixed-jaw datum is probed, calculated from the plate frame, then independently rechecked in machine coordinates." })),
    controllerCheck({ id: "fixture_clearance", title: "VISE + CLAMP CLEARANCE REVIEW", method: "PHYSICAL / CAD", criterion: "Enabled vise jaw travel, stock, tool, holder, setter, drains, and clamps agree with the displayed fixture model and safe-Z envelope." }),
  ]),
  freezeStage(12, "cut_trials", "CONTROLLED CUTS", "Close the release with progressively higher-energy trials and recovery evidence.", [
    controllerCheck({ id: "air_run", title: "FULL AIR-RUN PROGRAM", method: "PROGRAM", criterion: "A representative long program, WCS changes, holds, resume, coolant commands, and stop paths complete above the work with no divergence." }),
    controllerCheck({ id: "soft_material", title: "SOFT-MATERIAL TRIAL", method: "CUT", criterion: "Low-energy cutting validates direction, scale, spindle, coolant, tool offsets, probe/setter workflow, and dimensional inspection." }),
    controllerCheck({ id: "aluminum_cut", title: "ALUMINUM ACCEPTANCE PART", method: "CUT / INSPECT", criterion: "A defined aluminum artifact passes dimensions, bore/roundness checks, surface finish, thermal, and repeatability criteria." }),
    controllerCheck({ id: "interruption_recovery", title: "INTERRUPTION + RECOVERY TRIAL", method: "FAULT / RECOVERY", criterion: "Hold, abort, safe restart, power loss, USB loss, fault reset, and verified recovery cannot resume from an ambiguous state." }),
    documentCheck(controllerCheck({ id: "release_review", title: "FINAL RELEASE REVIEW", criterion: "All stage records, raw artifacts, hashes, backups, maintenance limits, operator procedures, residual risks, and sign-off are archived." })),
  ]),
]);

export const COMMISSIONING_CHECKS = Object.freeze(COMMISSIONING_STAGES.flatMap((stage) => stage.checks));
const CHECK_BY_ID = new Map(COMMISSIONING_CHECKS.map((check) => [check.id, check]));

function cleanText(value, limit = 240) {
  return String(value ?? "").trim().replace(/\s+/g, " ").slice(0, limit);
}

function isoTimestamp(value) {
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) ? new Date(milliseconds).toISOString() : null;
}

function cleanSha256(value) {
  const normalized = String(value ?? "").trim().toUpperCase();
  return SHA256_PATTERN.test(normalized) ? normalized : null;
}

function cleanMachineId(value) {
  const normalized = cleanText(value, 96).toUpperCase();
  return /^MR1-[A-Z0-9-]{8,90}$/.test(normalized) ? normalized : null;
}

function normalizeArtifact(candidate = {}) {
  candidate = candidate ?? {};
  const sha256 = cleanSha256(candidate.sha256);
  const bytes = Number(candidate.bytes);
  if (!sha256) return null;
  return {
    name: cleanText(candidate.name, 180) || "EVIDENCE FILE",
    bytes: Number.isInteger(bytes) && bytes >= 0 ? bytes : null,
    sha256,
  };
}

function normalizeBinding(candidate = {}) {
  return {
    machineId: cleanMachineId(candidate.machineId),
    controllerFingerprint: cleanSha256(candidate.controllerFingerprint),
    firmwareSha256: cleanSha256(candidate.firmwareSha256),
    controllerSimulated: candidate.controllerSimulated === true,
  };
}

export function normalizeCommissioningEvidence(candidate = {}) {
  candidate = candidate ?? {};
  const checkId = cleanText(candidate.checkId, 80);
  if (!CHECK_BY_ID.has(checkId)) return null;
  const source = SOURCES.has(candidate.source) ? candidate.source : "simulation";
  const result = candidate.result === "pass" || candidate.result === "fail" ? candidate.result : "fail";
  return {
    checkId,
    result,
    source,
    operator: cleanText(candidate.operator, 100),
    instrument: cleanText(candidate.instrument, 120),
    instrumentId: cleanText(candidate.instrumentId, 120),
    value: cleanText(candidate.value, 120),
    unit: cleanText(candidate.unit, 40),
    notes: cleanText(candidate.notes, 1200),
    artifact: normalizeArtifact(candidate.artifact),
    recordedAt: isoTimestamp(candidate.recordedAt),
    binding: normalizeBinding(candidate.binding),
  };
}

export function normalizeCommissioningRecord(candidate = {}) {
  const records = {};
  for (const [id, value] of Object.entries(candidate.records ?? {})) {
    // Historical evidence belongs to the previous drive/motor installation.
    // Retain baseline documents, but never promote those physical passes.
    if (candidate.hardwareProfile !== COMMISSIONING_HARDWARE_PROFILE
      && !['source_release', 'stock_backup'].includes(id)) continue;
    const evidence = normalizeCommissioningEvidence({ ...value, checkId: id });
    if (evidence) records[id] = evidence;
  }
  return {
    protocol: COMMISSIONING_PROTOCOL,
    version: 1,
    hardwareProfile: COMMISSIONING_HARDWARE_PROFILE,
    machineId: cleanMachineId(candidate.machineId),
    records,
    updatedAt: isoTimestamp(candidate.updatedAt),
    physicalMotionPermitted: false,
  };
}

export function commissioningCheck(checkId) {
  return CHECK_BY_ID.get(String(checkId ?? "")) ?? null;
}

export function createCommissioningEvidence(checkId, draft = {}, context = {}, options = {}) {
  const check = commissioningCheck(checkId);
  if (!check) throw new Error(`Unknown commissioning check: ${String(checkId)}`);
  const binding = normalizeBinding(context);
  const evidence = normalizeCommissioningEvidence({
    ...draft,
    checkId: check.id,
    recordedAt: options.recordedAt ?? new Date().toISOString(),
    binding,
  });
  if (!evidence) throw new Error("Commissioning evidence could not be normalized.");
  return evidence;
}

export function upsertCommissioningEvidence(candidate, evidenceCandidate, context = {}) {
  const record = normalizeCommissioningRecord(candidate);
  const evidence = normalizeCommissioningEvidence(evidenceCandidate);
  if (!evidence) throw new Error("Commissioning evidence is invalid or references an unknown check.");
  const binding = normalizeBinding(context);
  const machineId = record.machineId ?? binding.machineId ?? evidence.binding.machineId;
  if (!machineId) throw new Error("Bind a valid MR-1 machine identity before recording evidence.");
  if (record.machineId && binding.machineId && record.machineId !== binding.machineId) {
    throw new Error("Commissioning record belongs to a different MR-1 machine identity.");
  }
  if (evidence.binding.machineId !== machineId) {
    throw new Error("Evidence machine binding does not match the commissioning record.");
  }
  return normalizeCommissioningRecord({
    ...record,
    machineId,
    records: { ...record.records, [evidence.checkId]: evidence },
    updatedAt: evidence.recordedAt ?? new Date().toISOString(),
  });
}

export function removeCommissioningEvidence(candidate, checkId, options = {}) {
  const record = normalizeCommissioningRecord(candidate);
  if (!CHECK_BY_ID.has(String(checkId ?? ""))) return record;
  const records = { ...record.records };
  delete records[checkId];
  return normalizeCommissioningRecord({
    ...record,
    records,
    updatedAt: options.updatedAt ?? new Date().toISOString(),
  });
}

export function evidenceIssues(check, evidenceCandidate, context = {}) {
  const evidence = normalizeCommissioningEvidence(evidenceCandidate);
  const binding = normalizeBinding(context);
  const issues = [];
  if (!evidence) return ["No evidence record."];
  if (evidence.result !== "pass") issues.push("Test result is not PASS.");
  if (!check.acceptedSources.includes(evidence.source)) {
    issues.push(`${evidence.source.toUpperCase()} evidence cannot satisfy this ${check.method.toLowerCase()} gate.`);
  }
  if (!evidence.operator) issues.push("Operator or reviewer identity is required.");
  if (!evidence.recordedAt) issues.push("A valid evidence timestamp is required.");
  if (check.requiresArtifact && !evidence.artifact) issues.push("A SHA-256 evidence artifact is required.");
  if (check.requiresInstrument && (!evidence.instrument || !evidence.instrumentId)) {
    issues.push("Instrument model and instrument ID are required.");
  }
  if (!binding.machineId) issues.push("Current machine identity is unavailable.");
  else if (evidence.binding.machineId !== binding.machineId) issues.push("Machine identity binding is stale or mismatched.");
  if (check.bindController) {
    if (binding.controllerSimulated) issues.push("A simulated controller fingerprint is not physical evidence.");
    if (!binding.controllerFingerprint) issues.push("A physical controller preflight fingerprint is required.");
    else if (evidence.binding.controllerFingerprint !== binding.controllerFingerprint) issues.push("Controller fingerprint binding is stale or mismatched.");
  }
  if (check.bindFirmware) {
    if (!binding.firmwareSha256) issues.push("The production firmware SHA-256 is required.");
    else if (evidence.binding.firmwareSha256 !== binding.firmwareSha256) issues.push("Firmware SHA-256 binding is stale or mismatched.");
  }
  return issues;
}

export function evaluateCommissioningRecord(candidate = {}, context = {}) {
  const record = normalizeCommissioningRecord(candidate);
  const binding = normalizeBinding(context);
  const checkResults = {};
  let passed = 0;
  let failed = 0;
  for (const check of COMMISSIONING_CHECKS) {
    const evidence = record.records[check.id] ?? null;
    const issues = evidenceIssues(check, evidence, binding);
    const complete = issues.length === 0;
    if (complete) passed += 1;
    else if (evidence?.result === "fail") failed += 1;
    checkResults[check.id] = { check, evidence, issues, complete };
  }

  const stages = [];
  let previousComplete = true;
  let nextCheck = null;
  for (const stage of COMMISSIONING_STAGES) {
    const results = stage.checks.map((check) => checkResults[check.id]);
    const stagePassed = results.filter((result) => result.complete).length;
    const complete = stagePassed === results.length;
    const status = complete && previousComplete ? "complete" : previousComplete ? "active" : "locked";
    if (!nextCheck && previousComplete && !complete) nextCheck = results.find((result) => !result.complete) ?? null;
    stages.push({
      ...stage,
      passed: stagePassed,
      total: results.length,
      complete,
      status,
      results,
    });
    previousComplete = previousComplete && complete;
  }

  const bindingIssues = [];
  if (!binding.machineId) bindingIssues.push("Machine identity unavailable.");
  else if (record.machineId && record.machineId !== binding.machineId) bindingIssues.push("Record belongs to another machine.");
  if (binding.controllerSimulated) bindingIssues.push("Controller fingerprint is simulated.");

  return {
    protocol: COMMISSIONING_PROTOCOL,
    record,
    binding,
    bindingIssues,
    checks: checkResults,
    stages,
    passed,
    failed,
    total: COMMISSIONING_CHECKS.length,
    completedStages: stages.filter((stage) => stage.complete).length,
    nextCheck,
    allComplete: passed === COMMISSIONING_CHECKS.length && bindingIssues.length === 0,
    status: passed === COMMISSIONING_CHECKS.length && bindingIssues.length === 0
      ? "COMMISSIONING EVIDENCE COMPLETE"
      : nextCheck ? `NEXT / ${nextCheck.check.title}` : "COMMISSIONING LOCKED",
    physicalMotionPermitted: false,
  };
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalValue(value[key])]));
}

export function canonicalCommissioningJson(value) {
  return JSON.stringify(canonicalValue(value));
}

export async function createCommissioningBundle(candidate, context = {}, options = {}) {
  const record = normalizeCommissioningRecord(candidate);
  const binding = normalizeBinding(context);
  if (!record.machineId || !binding.machineId || record.machineId !== binding.machineId) {
    throw new Error("Commissioning export requires the current matching machine identity.");
  }
  const createdAt = new Date(options.createdAt ?? Date.now()).toISOString();
  const payload = {
    format: COMMISSIONING_FORMAT,
    schemaVersion: COMMISSIONING_SCHEMA_VERSION,
    createdAt,
    binding,
    record,
    scope: "EVIDENCE RECORD ONLY / NEVER MOTION PERMISSION",
  };
  const digest = await sha256TextHex(canonicalCommissioningJson(payload), options.cryptoProvider);
  return { ...payload, integrity: { algorithm: "SHA-256", digest } };
}

export async function parseCommissioningBundle(source, options = {}) {
  const text = typeof source === "string" ? source : JSON.stringify(source);
  if (new TextEncoder().encode(text).byteLength > (options.maxBytes ?? MAX_COMMISSIONING_BUNDLE_BYTES)) {
    throw new Error("Commissioning record exceeds the 2 MB import limit.");
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Commissioning record is not valid JSON.");
  }
  if (parsed?.format !== COMMISSIONING_FORMAT) throw new Error("File is not an MR-1 commissioning record.");
  if (parsed.schemaVersion !== COMMISSIONING_SCHEMA_VERSION) {
    throw new Error(`Unsupported commissioning schema ${parsed.schemaVersion ?? "unknown"}.`);
  }
  const expectedDigest = cleanSha256(parsed.integrity?.digest);
  if (parsed.integrity?.algorithm !== "SHA-256" || !expectedDigest) {
    throw new Error("Commissioning record has no valid SHA-256 integrity record.");
  }
  const { integrity: _integrity, ...payload } = parsed;
  const digest = await sha256TextHex(canonicalCommissioningJson(payload), options.cryptoProvider);
  if (digest !== expectedDigest) throw new Error("Commissioning record integrity check failed.");
  const binding = normalizeBinding(parsed.binding);
  const record = normalizeCommissioningRecord(parsed.record);
  if (!binding.machineId || record.machineId !== binding.machineId) {
    throw new Error("Commissioning record machine binding is invalid.");
  }
  const expectedMachineId = cleanMachineId(options.expectedMachineId);
  if (expectedMachineId && expectedMachineId !== binding.machineId) {
    throw new Error("Commissioning record belongs to a different MR-1 machine.");
  }
  return {
    format: COMMISSIONING_FORMAT,
    schemaVersion: COMMISSIONING_SCHEMA_VERSION,
    createdAt: new Date(parsed.createdAt).toISOString(),
    binding,
    record,
    scope: "EVIDENCE RECORD ONLY / NEVER MOTION PERMISSION",
    integrity: { algorithm: "SHA-256", digest },
  };
}
