import { MR1_CONFIG } from "./machine-config.js";
import { evaluateToolSetter, evaluateTouchProbe, normalizeProbingProfile } from "./probing-profile.js";

export const MACHINE_TRANSACTION_PROTOCOL = "mr1-machine-transaction-v1";
export const MACHINE_COMMAND_POLICY = "simulation-transactions-only";
export const MACHINE_INTENT_TYPES = Object.freeze([
  "apply-work-offset",
  "jog",
  "tool-setter",
  "touch-probe",
]);

const WCS_TO_FIXTURE = Object.freeze({
  G54: "V1",
  G55: "V2",
  G56: "V3",
  G57: "V4",
  G58: "V5",
  G59: "PLATE",
});
const AXES = new Set(["x", "y", "z"]);
const OWNER_PATTERN = /^[A-Za-z0-9_-]{8,80}$/;
const REQUEST_PATTERN = /^[A-Za-z0-9_-]{8,100}$/;

export class MachineCommandError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = "MachineCommandError";
    this.code = options.code ?? "MACHINE_COMMAND_INVALID";
    this.statusCode = options.statusCode ?? 400;
    this.details = options.details ?? null;
  }
}

function commandError(message, code, details = null) {
  throw new MachineCommandError(message, { code, details });
}

function finiteNumber(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) commandError(`${label} must be a finite number.`, "INVALID_NUMBER");
  return number;
}

function boundedNumber(value, minimum, maximum, label) {
  const number = finiteNumber(value, label);
  if (number < minimum || number > maximum) {
    commandError(`${label} must be between ${minimum} and ${maximum}.`, "NUMBER_OUT_OF_RANGE");
  }
  return number;
}

function optionalInteger(value, label, minimum, maximum) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  if (!Number.isInteger(number) || number < minimum || number > maximum) {
    commandError(`${label} must be a whole number between ${minimum} and ${maximum}.`, "INVALID_INTEGER");
  }
  return number;
}

function optionalBoundedNumber(value, minimum, maximum, label) {
  if (value === null || value === undefined || value === "") return null;
  return boundedNumber(value, minimum, maximum, label);
}

function normalizeVector(candidate, label) {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    commandError(`${label} must contain X, Y, and Z.`, "INVALID_VECTOR");
  }
  return Object.fromEntries(["x", "y", "z"].map((axis) => [
    axis,
    finiteNumber(candidate[axis], `${label} ${axis.toUpperCase()}`),
  ]));
}

function normalizeApplyWorkOffset(candidate) {
  const wcs = String(candidate.wcs ?? "").toUpperCase();
  if (!Object.hasOwn(WCS_TO_FIXTURE, wcs)) {
    commandError("Work offset must be G54 through G59.", "INVALID_WCS");
  }
  const fixtureId = String(candidate.fixtureId ?? "").toUpperCase();
  if (fixtureId !== WCS_TO_FIXTURE[wcs]) {
    commandError(`${wcs} is reserved for ${WCS_TO_FIXTURE[wcs]}.`, "WCS_FIXTURE_MISMATCH");
  }
  return {
    type: "apply-work-offset",
    wcs,
    fixtureId,
    offset: normalizeVector(candidate.offset, "Work offset"),
    mapVersion: optionalInteger(candidate.mapVersion, "Fixture map version", 1, 999),
    frameQualified: candidate.frameQualified === true,
    locationsVerified: candidate.locationsVerified === true,
  };
}

function normalizeJog(candidate) {
  const axis = String(candidate.axis ?? "").toLowerCase();
  if (!AXES.has(axis)) commandError("Jog axis must be X, Y, or Z.", "INVALID_JOG_AXIS");
  const direction = Number(candidate.direction);
  if (direction !== -1 && direction !== 1) {
    commandError("Jog direction must be -1 or 1.", "INVALID_JOG_DIRECTION");
  }
  const coordinateMode = candidate.coordinateMode === "machine" ? "machine" : "work";
  return {
    type: "jog",
    axis,
    direction,
    distance: boundedNumber(candidate.distance, 0.001, 10, "Jog distance"),
    feed: boundedNumber(candidate.feed, 1, MR1_CONFIG.maxRate[axis], "Jog feed"),
    coordinateMode,
  };
}

function normalizeToolSetter(candidate) {
  if (!candidate.settings || typeof candidate.settings !== "object" || Array.isArray(candidate.settings)) {
    commandError("Tool setter settings are required.", "TOOL_SETTER_SETTINGS_REQUIRED");
  }
  const settings = normalizeProbingProfile({ toolSetter: candidate.settings }).toolSetter;
  return {
    type: "tool-setter",
    settings,
    inputQualified: candidate.inputQualified === true,
    profileQualified: candidate.profileQualified === true,
    expectedActiveTool: optionalInteger(candidate.expectedActiveTool, "Expected active tool", 1, 999),
  };
}

function normalizeTouchProbe(candidate) {
  if (!candidate.settings || typeof candidate.settings !== "object" || Array.isArray(candidate.settings)) {
    commandError("Touch-probe settings are required.", "TOUCH_PROBE_SETTINGS_REQUIRED");
  }
  const settings = normalizeProbingProfile({ touchProbe: candidate.settings }).touchProbe;
  const probeId = candidate.probeId === null || candidate.probeId === undefined
    ? null
    : String(candidate.probeId).trim();
  if (probeId !== null && !/^[A-Za-z0-9_.-]{1,40}$/.test(probeId)) {
    commandError("Probe ID must be 1 to 40 letters, numbers, dots, underscores, or dashes.", "INVALID_PROBE_ID");
  }
  return {
    type: "touch-probe",
    settings,
    inputQualified: candidate.inputQualified === true,
    profileQualified: candidate.profileQualified === true,
    probeQualified: candidate.probeQualified === true,
    probeId,
    qualifiedTipDiameter: optionalBoundedNumber(candidate.qualifiedTipDiameter, 0.5, 20, "Qualified tip diameter"),
  };
}

export function normalizeMachineIntent(candidate) {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    commandError("Machine intent must be an object.", "MACHINE_INTENT_REQUIRED");
  }
  if (candidate.type === "apply-work-offset") return normalizeApplyWorkOffset(candidate);
  if (candidate.type === "jog") return normalizeJog(candidate);
  if (candidate.type === "tool-setter") return normalizeToolSetter(candidate);
  if (candidate.type === "touch-probe") return normalizeTouchProbe(candidate);
  commandError(
    `Machine intent must be one of: ${MACHINE_INTENT_TYPES.join(", ")}.`,
    "MACHINE_INTENT_NOT_ALLOWED",
  );
}

export function normalizeMachineRequest(candidate) {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    commandError("Machine request must be an object.", "MACHINE_REQUEST_REQUIRED");
  }
  const ownerId = String(candidate.ownerId ?? "");
  const requestId = String(candidate.requestId ?? "");
  if (!OWNER_PATTERN.test(ownerId)) {
    commandError("Owner ID must be 8 to 80 URL-safe characters.", "INVALID_OWNER_ID");
  }
  if (!REQUEST_PATTERN.test(requestId)) {
    commandError("Request ID must be 8 to 100 URL-safe characters.", "INVALID_REQUEST_ID");
  }
  const observedStatusSequence = candidate.observedStatusSequence === null
    || candidate.observedStatusSequence === undefined
    ? null
    : optionalInteger(candidate.observedStatusSequence, "Observed status sequence", 0, Number.MAX_SAFE_INTEGER);
  return {
    ownerId,
    requestId,
    observedStatusSequence,
    intent: normalizeMachineIntent(candidate.intent),
  };
}

function insideEnvelope(value, axis) {
  const envelope = MR1_CONFIG.machineEnvelope[axis];
  return Number.isFinite(value) && value >= envelope.min && value <= envelope.max;
}

function gate(id, label, passed, detail) {
  return { id, label, passed: passed === true, detail };
}

function controlsClear(telemetry) {
  const controls = telemetry?.pins?.controls ?? {};
  const active = [
    ["E-STOP", controls.eStop],
    ["SAFETY DOOR", controls.safetyDoor],
    ["RESET", controls.reset],
    ["FEED HOLD", controls.feedHold],
    ["MOTOR FAULT", controls.motorFault],
    ["PROBE DISCONNECTED", controls.probeDisconnected],
  ].filter(([, value]) => value === true).map(([label]) => label);
  return { passed: active.length === 0, detail: active.length ? active.join(" / ") : "SAFETY INPUTS CLEAR" };
}

function limitsClear(telemetry) {
  const axes = Object.keys(telemetry?.pins?.limits ?? {}).filter((axis) => telemetry.pins.limits[axis]);
  return { passed: axes.length === 0, detail: axes.length ? `${axes.join(", ").toUpperCase()} LIMIT ACTIVE` : "LIMIT INPUTS CLEAR" };
}

function commonGates(context) {
  const telemetry = context.telemetry;
  const telemetryAgeMs = Number(context.telemetryAgeMs);
  const controls = controlsClear(telemetry);
  const limits = limitsClear(telemetry);
  const currentSequence = Number(telemetry?.sequence);
  const observedSequence = context.observedStatusSequence;
  const observationCurrent = observedSequence === null
    || observedSequence === undefined
    || (Number.isInteger(currentSequence) && currentSequence >= observedSequence && currentSequence - observedSequence <= 20);
  return [
    gate(
      "command-policy",
      "COMMAND POLICY",
      context.commandsEnabled === true,
      context.commandsEnabled ? "TYPED TRANSACTIONS ENABLED" : "PHYSICAL MOTION LOCKED",
    ),
    gate(
      "controller-link",
      "CONTROLLER LINK",
      telemetry?.protocol === "grblhal-status-v1",
      telemetry ? telemetry.protocol ?? "UNKNOWN PROTOCOL" : "NO CONTROLLER STATUS",
    ),
    gate(
      "fresh-status",
      "FRESH STATUS",
      Number.isFinite(telemetryAgeMs) && telemetryAgeMs <= (context.maximumTelemetryAgeMs ?? 1500),
      Number.isFinite(telemetryAgeMs) ? `${Math.round(telemetryAgeMs)} MS OLD` : "STATUS AGE UNKNOWN",
    ),
    gate(
      "observed-status",
      "OBSERVED STATUS",
      observationCurrent,
      observationCurrent ? `SEQ ${Number.isInteger(currentSequence) ? currentSequence : "--"}` : "BROWSER OBSERVATION IS STALE",
    ),
    gate(
      "idle-state",
      "MACHINE IDLE",
      telemetry?.state?.name === "Idle",
      telemetry?.state?.raw?.toUpperCase?.() ?? "STATE UNKNOWN",
    ),
    gate(
      "homed-session",
      "HOMED SESSION",
      telemetry?.homing?.complete === true,
      telemetry?.homing?.complete === true ? "HOMING COMPLETE" : "HOME MACHINE FIRST",
    ),
    gate("safety-inputs", "SAFETY INPUTS", controls.passed, controls.detail),
    gate("limit-inputs", "LIMIT INPUTS", limits.passed, limits.detail),
  ];
}

function workOffsetGates(intent) {
  const offsetInside = ["x", "y", "z"].every((axis) => insideEnvelope(intent.offset[axis], axis));
  return [
    gate(
      "qualified-table-frame",
      "TABLE FRAME",
      intent.frameQualified,
      intent.frameQualified ? "CALIBRATION EVIDENCE QUALIFIED" : "QUALIFIED TABLE FRAME REQUIRED",
    ),
    gate(
      "verified-fixtures",
      "FIXTURE LOCATIONS",
      intent.locationsVerified,
      intent.locationsVerified ? "PHYSICAL LOCATIONS VERIFIED" : "PHYSICAL LOCATIONS UNVERIFIED",
    ),
    gate(
      "offset-envelope",
      "OFFSET ENVELOPE",
      offsetInside,
      offsetInside ? `${intent.wcs} INSIDE MACHINE TRAVEL` : `${intent.wcs} LEAVES MACHINE TRAVEL`,
    ),
  ];
}

function jogGates(intent, telemetry) {
  const current = telemetry?.position?.machine?.[intent.axis];
  const target = Number.isFinite(current) ? current + intent.direction * intent.distance : null;
  const targetInside = insideEnvelope(target, intent.axis);
  return {
    target,
    gates: [
      gate(
        "known-machine-position",
        "MACHINE POSITION",
        Number.isFinite(current),
        Number.isFinite(current) ? `${intent.axis.toUpperCase()} ${current.toFixed(3)} MM` : "MPOS UNKNOWN",
      ),
      gate(
        "jog-target-envelope",
        "JOG TARGET",
        targetInside,
        targetInside ? `${intent.axis.toUpperCase()} ${target.toFixed(3)} MM` : "TARGET OUTSIDE MACHINE TRAVEL",
      ),
    ],
  };
}

function toolSetterGates(intent, telemetry) {
  const evaluation = evaluateToolSetter(intent.settings, { activeTool: telemetry?.tool });
  const probeInactive = telemetry?.pins?.controls?.probeTriggered === false;
  const spindleStopped = telemetry?.accessories?.spindle === "off"
    && Number(telemetry?.motion?.spindleActual ?? telemetry?.motion?.spindleCommand ?? 0) === 0;
  return {
    evaluation,
    gates: [
      gate(
        "tool-setter-profile",
        "SETTER PROFILE",
        intent.profileQualified && evaluation.ready,
        evaluation.errors[0] ?? (evaluation.ready ? "LOCATION / TOOL / SEARCH QUALIFIED" : "PROFILE NOT READY"),
      ),
      gate(
        "tool-setter-input",
        "SETTER INPUT",
        intent.inputQualified,
        intent.inputQualified ? "INPUT PATH QUALIFIED" : "INPUT CALIBRATION REQUIRED",
      ),
      gate(
        "probe-open-before-cycle",
        "PROBE OPEN",
        probeInactive,
        probeInactive ? "INPUT OPEN" : "INPUT ACTIVE OR UNKNOWN",
      ),
      gate(
        "spindle-stopped",
        "SPINDLE STOPPED",
        spindleStopped,
        spindleStopped ? "ZERO SPEED / OUTPUT OFF" : "STOP SPINDLE BEFORE PROBING",
      ),
      gate(
        "active-tool-match",
        "ACTIVE TOOL",
        intent.expectedActiveTool === null || intent.expectedActiveTool === telemetry?.tool,
        `EXPECTED T${intent.expectedActiveTool ?? "--"} / LIVE T${telemetry?.tool ?? "--"}`,
      ),
    ],
  };
}

function touchProbeGates(intent, telemetry) {
  const evaluation = evaluateTouchProbe(intent.settings);
  const probeInactive = telemetry?.pins?.controls?.probeTriggered === false;
  const touchProbeSelected = telemetry?.activeProbe === 0;
  const spindleStopped = telemetry?.accessories?.spindle === "off"
    && Number(telemetry?.motion?.spindleActual ?? telemetry?.motion?.spindleCommand ?? 0) === 0;
  const tipModelMatches = Number.isFinite(intent.qualifiedTipDiameter)
    && Math.abs(intent.qualifiedTipDiameter - intent.settings.tipDiameter) <= 0.001;
  return {
    evaluation,
    gates: [
      gate(
        "touch-probe-profile",
        "PROBE PLAN",
        intent.profileQualified && evaluation.ready,
        evaluation.errors[0]
          ?? (evaluation.missing.length ? `${evaluation.missing.join(" / ")} REQUIRED` : "TARGET / SEARCH / RETRACT QUALIFIED"),
      ),
      gate(
        "touch-probe-input",
        "PROBE INPUT",
        intent.inputQualified,
        intent.inputQualified ? "INPUT PATH QUALIFIED" : "INPUT CALIBRATION REQUIRED",
      ),
      gate(
        "touch-probe-calibration",
        "PROBE CALIBRATION",
        intent.probeQualified,
        intent.probeQualified ? "TIP / DIRECTION MODEL QUALIFIED" : "CALIBRATED PROBE REQUIRED",
      ),
      gate(
        "touch-probe-tip-match",
        "TIP MODEL",
        tipModelMatches,
        tipModelMatches
          ? `${intent.probeId ?? "PROBE"} / ${intent.settings.tipDiameter.toFixed(3)} MM`
          : `CYCLE ${intent.settings.tipDiameter.toFixed(3)} / CAL ${Number.isFinite(intent.qualifiedTipDiameter) ? intent.qualifiedTipDiameter.toFixed(3) : "--.---"} MM`,
      ),
      gate(
        "primary-probe-selected",
        "ACTIVE PROBE",
        touchProbeSelected,
        touchProbeSelected ? "PRIMARY / PF5" : `SELECT PRIMARY PROBE / LIVE ${telemetry?.activeProbe ?? "--"}`,
      ),
      gate(
        "probe-open-before-cycle",
        "PROBE OPEN",
        probeInactive,
        probeInactive ? "INPUT OPEN" : "INPUT ACTIVE OR UNKNOWN",
      ),
      gate(
        "spindle-stopped",
        "SPINDLE STOPPED",
        spindleStopped,
        spindleStopped ? "ZERO SPEED / OUTPUT OFF" : "STOP SPINDLE BEFORE PROBING",
      ),
    ],
  };
}

export function evaluateMachineCommand(candidate, context = {}) {
  const intent = normalizeMachineIntent(candidate);
  const gates = commonGates(context);
  const details = {};
  if (intent.type === "apply-work-offset") gates.push(...workOffsetGates(intent));
  if (intent.type === "jog") {
    const jog = jogGates(intent, context.telemetry);
    gates.push(...jog.gates);
    details.target = jog.target;
  }
  if (intent.type === "tool-setter") {
    const setter = toolSetterGates(intent, context.telemetry);
    gates.push(...setter.gates);
    details.toolSetter = setter.evaluation;
  }
  if (intent.type === "touch-probe") {
    const probe = touchProbeGates(intent, context.telemetry);
    gates.push(...probe.gates);
    details.touchProbe = probe.evaluation;
  }
  return {
    intent,
    permitted: gates.every(({ passed }) => passed),
    gates,
    blockers: gates.filter(({ passed }) => !passed),
    details,
  };
}

export function transactionIsTerminal(transaction) {
  return ["completed", "failed", "rejected", "cancelled"].includes(transaction?.state);
}
