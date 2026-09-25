const PREFIX = "[MR1SP|";
const ALLOWED_STATES = new Set([
  "disabled",
  "comms_sync",
  "drive_ready",
  "accelerating",
  "at_speed",
  "running",
  "decelerating",
  "zero_speed",
  "fault",
]);
const ALLOWED_MODES = new Set(["disabled", "speed", "position", "switching", "unknown"]);
const ALLOWED_CONTROL_PATHS = new Set(["analog", "digital", "disabled", "unknown"]);
const BOOLEAN_FIELDS = new Set([
  "RDY",
  "ALM",
  "SON",
  "ASP",
  "ZSP",
  "COIN",
  "PTOS",
  "APPROVED",
  "MBR",
  "MBW",
  "M3OK",
  "M4OK",
  "M5OK",
  "M19OK",
]);
const KNOWN_FIELDS = new Set([
  "V",
  "ST",
  "MODE",
  "PATH",
  "CMD",
  "MRPM",
  "CRPM",
  "ERPM",
  "TQ",
  "CUR",
  "PKCUR",
  "LOAD",
  "REGEN",
  "RDY",
  "ALM",
  "SON",
  "ASP",
  "ZSP",
  "COIN",
  "PTOS",
  "AC",
  "MBAGE",
  "ENCAGE",
  "IDXAGE",
  "ERRS",
  "RATIO",
  "DIFF",
  "STAGE",
  "APPROVED",
  "PROFILE",
  "MBR",
  "MBW",
  "M3OK",
  "M4OK",
  "M5OK",
  "M19OK",
]);
const REQUIRED_FIELDS = new Set(["V", "ST", "MODE", "CMD", "RDY", "ALM", "SON", "STAGE", "APPROVED"]);

function boundedNumber(value, minimum, maximum) {
  if (value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= minimum && number <= maximum ? number : Number.NaN;
}

function boundedInteger(value, minimum, maximum) {
  const number = boundedNumber(value, minimum, maximum);
  return Number.isInteger(number) ? number : Number.NaN;
}

function booleanField(value) {
  if (value === "1") return true;
  if (value === "0") return false;
  return null;
}

function optionalNumber(fields, name, minimum, maximum, integer = false) {
  if (!fields.has(name)) return null;
  const value = integer
    ? boundedInteger(fields.get(name), minimum, maximum)
    : boundedNumber(fields.get(name), minimum, maximum);
  return Number.isFinite(value) ? value : Number.NaN;
}

function profileFingerprint(value) {
  if (value === undefined || value === "-") return null;
  return /^[A-F0-9]{8,64}$/.test(value) ? value : undefined;
}

export function parseSpindleTelemetryLine(raw, receivedAt = new Date().toISOString()) {
  const line = String(raw ?? "").trim();
  if (!line.startsWith(PREFIX) || !line.endsWith("]") || line.length > 1024) return null;

  const fields = new Map();
  const tokens = line.slice(PREFIX.length, -1).split("|");
  for (const token of tokens) {
    const separator = token.indexOf(":");
    if (separator < 1 || separator === token.length - 1) return null;
    const name = token.slice(0, separator);
    const value = token.slice(separator + 1);
    if (!KNOWN_FIELDS.has(name) || fields.has(name)) return null;
    fields.set(name, value);
  }
  if ([...REQUIRED_FIELDS].some((name) => !fields.has(name))) return null;
  if (fields.get("V") !== "1") return null;

  for (const name of BOOLEAN_FIELDS) {
    if (fields.has(name) && booleanField(fields.get(name)) === null) return null;
  }

  const state = fields.get("ST");
  const mode = fields.get("MODE");
  const controlPath = fields.has("PATH") ? fields.get("PATH") : null;
  const fingerprint = profileFingerprint(fields.get("PROFILE"));
  if (
    !ALLOWED_STATES.has(state)
    || !ALLOWED_MODES.has(mode)
    || (controlPath !== null && !ALLOWED_CONTROL_PATHS.has(controlPath))
    || fingerprint === undefined
  ) return null;

  const values = {
    commandRpm: optionalNumber(fields, "CMD", 0, 8000),
    motorRpm: optionalNumber(fields, "MRPM", -5000, 5000),
    calculatedSpindleRpm: optionalNumber(fields, "CRPM", -10000, 10000),
    encoderSpindleRpm: optionalNumber(fields, "ERPM", -10000, 10000),
    torquePercent: optionalNumber(fields, "TQ", -300, 300),
    currentA: optionalNumber(fields, "CUR", 0, 100),
    peakCurrentA: optionalNumber(fields, "PKCUR", 0, 100),
    averageLoadPercent: optionalNumber(fields, "LOAD", 0, 300),
    regenerativeLoadPercent: optionalNumber(fields, "REGEN", 0, 300),
    alarmCode: optionalNumber(fields, "AC", 0, 9999, true),
    modbusAgeMs: optionalNumber(fields, "MBAGE", 0, 600000, true),
    encoderAgeMs: optionalNumber(fields, "ENCAGE", 0, 600000, true),
    spindleIndexAgeMs: optionalNumber(fields, "IDXAGE", 0, 600000, true),
    errorCount: optionalNumber(fields, "ERRS", 0, 1000000000, true),
    ratio: optionalNumber(fields, "RATIO", 0.1, 10),
    disagreementPercent: optionalNumber(fields, "DIFF", 0, 1000),
    commissioningStage: optionalNumber(fields, "STAGE", 0, 9, true),
  };
  if (Object.values(values).some((value) => Number.isNaN(value))) return null;

  return {
    protocol: "mr1-spindle-v1",
    receivedAt,
    state,
    mode,
    controlPath,
    commandRpm: values.commandRpm,
    speeds: {
      motorRpm: values.motorRpm,
      calculatedSpindleRpm: values.calculatedSpindleRpm,
      encoderSpindleRpm: values.encoderSpindleRpm,
    },
    load: {
      torquePercent: values.torquePercent,
      currentA: values.currentA,
      peakCurrentA: values.peakCurrentA,
      averagePercent: values.averageLoadPercent,
      regenerativePercent: values.regenerativeLoadPercent,
    },
    signals: {
      ready: booleanField(fields.get("RDY")),
      alarmActive: booleanField(fields.get("ALM")),
      servoOn: booleanField(fields.get("SON")),
      atSpeed: fields.has("ASP") ? booleanField(fields.get("ASP")) : null,
      zeroSpeed: fields.has("ZSP") ? booleanField(fields.get("ZSP")) : null,
      inPosition: fields.has("COIN") ? booleanField(fields.get("COIN")) : null,
      modeSwitched: fields.has("PTOS") ? booleanField(fields.get("PTOS")) : null,
    },
    alarmCode: values.alarmCode,
    health: {
      modbusAgeMs: values.modbusAgeMs,
      encoderAgeMs: values.encoderAgeMs,
      spindleIndexAgeMs: values.spindleIndexAgeMs,
      errorCount: values.errorCount,
      ratio: values.ratio,
      disagreementPercent: values.disagreementPercent,
    },
    commissioning: {
      stage: values.commissioningStage,
      profileApproved: booleanField(fields.get("APPROVED")),
      profileFingerprint: fingerprint,
    },
    permits: {
      modbusRead: fields.has("MBR") ? booleanField(fields.get("MBR")) : null,
      modbusWrite: fields.has("MBW") ? booleanField(fields.get("MBW")) : null,
      m3: fields.has("M3OK") ? booleanField(fields.get("M3OK")) : null,
      m4: fields.has("M4OK") ? booleanField(fields.get("M4OK")) : null,
      m5: fields.has("M5OK") ? booleanField(fields.get("M5OK")) : null,
      m19: fields.has("M19OK") ? booleanField(fields.get("M19OK")) : null,
    },
  };
}

export function isSpindleTelemetryLine(raw) {
  return String(raw ?? "").trimStart().startsWith("[MR1SP");
}
