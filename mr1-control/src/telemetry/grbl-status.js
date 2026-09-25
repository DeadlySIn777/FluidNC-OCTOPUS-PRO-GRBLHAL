const AXES = ["x", "y", "z", "a", "b", "c", "u", "v", "w"];
const LIMIT_LETTERS = new Set(["X", "Y", "Z", "A", "B", "C", "U", "V", "W"]);
const CONTROL_SIGNALS = Object.freeze({
  R: "reset",
  H: "feedHold",
  S: "cycleStart",
  D: "safetyDoor",
  L: "blockDelete",
  T: "optionalStopDisabled",
  E: "eStop",
  O: "probeDisconnected",
  F: "motorFault",
  M: "motorWarning",
  Q: "singleBlock",
  P: "probeTriggered",
});

function parseNumber(value) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function parseNumbers(value) {
  if (typeof value !== "string" || value.length === 0) return [];
  return value.split(",").map(parseNumber);
}

function parseVector(value) {
  const values = parseNumbers(value);
  if (values.length === 0 || values.some((item) => item === null)) return null;
  return Object.fromEntries(values.map((item, index) => [AXES[index] ?? `axis${index + 1}`, item]));
}

function vectorMath(left, right, operator) {
  if (!left || !right) return null;
  const result = {};
  for (const axis of new Set([...Object.keys(left), ...Object.keys(right)])) {
    if (!Number.isFinite(left[axis]) || !Number.isFinite(right[axis])) continue;
    result[axis] = operator(left[axis], right[axis]);
  }
  return Object.keys(result).length > 0 ? result : null;
}

function parseMachineState(value) {
  const separator = value.indexOf(":");
  const name = separator >= 0 ? value.slice(0, separator) : value;
  const substateRaw = separator >= 0 ? value.slice(separator + 1) : null;
  const numericSubstate = substateRaw === null ? null : parseNumber(substateRaw);
  return {
    name,
    substate: substateRaw === null ? null : numericSubstate ?? substateRaw,
    raw: value,
  };
}

function parsePins(value = "") {
  const letters = [...new Set(String(value).split("").filter(Boolean))];
  const controls = Object.fromEntries(Object.values(CONTROL_SIGNALS).map((name) => [name, false]));
  const limits = {};

  for (const letter of letters) {
    if (LIMIT_LETTERS.has(letter)) limits[letter.toLowerCase()] = true;
    const control = CONTROL_SIGNALS[letter];
    if (control) controls[control] = true;
  }

  return {
    raw: String(value),
    letters,
    active: letters.length > 0,
    limits,
    controls,
  };
}

function parseAccessories(value = "") {
  const flags = new Set(String(value).split(""));
  return {
    raw: String(value),
    spindle: flags.has("C") ? "ccw" : flags.has("S") ? "cw" : "off",
    spindleEncoderError: flags.has("E"),
    flood: flags.has("F"),
    mist: flags.has("M"),
    toolChange: flags.has("T"),
  };
}

function fieldMap(parts) {
  const fields = new Map();
  for (const part of parts) {
    const separator = part.indexOf(":");
    const key = separator >= 0 ? part.slice(0, separator) : part;
    const value = separator >= 0 ? part.slice(separator + 1) : "";
    if (key) fields.set(key, value);
  }
  return fields;
}

export function parseGrblStatus(line, previous = null, options = {}) {
  const raw = String(line ?? "").trim();
  if (!raw.startsWith("<") || !raw.endsWith(">")) return null;

  const body = raw.slice(1, -1);
  const parts = body.split("|");
  if (!parts[0]) return null;
  const fields = fieldMap(parts.slice(1));
  const reportedMachine = parseVector(fields.get("MPos"));
  const reportedWork = parseVector(fields.get("WPos"));
  const reportedWco = parseVector(fields.get("WCO"));
  const wco = reportedWco ?? previous?.position?.wco ?? null;
  const machine = reportedMachine ?? vectorMath(reportedWork, wco, (position, offset) => position + offset);
  const work = reportedWork ?? vectorMath(reportedMachine, wco, (position, offset) => position - offset);
  const feedSpeed = parseNumbers(fields.get("FS"));
  const feedOnly = parseNumbers(fields.get("F"));
  const buffer = parseNumbers(fields.get("Bf"));
  const overrides = parseNumbers(fields.get("Ov"));
  const accessories = fields.has("A")
    ? parseAccessories(fields.get("A"))
    : previous?.accessories ?? parseAccessories();
  const pins = parsePins(fields.get("Pn"));

  const knownFields = new Set([
    "MPos", "WPos", "WCO", "Bf", "Ln", "DTG", "FS", "F", "Pn", "Ov", "A", "WCS", "Sc", "AR", "MPG",
    "H", "T", "P", "TLR", "FW",
  ]);
  const extra = {};
  for (const [key, value] of fields) {
    if (!knownFields.has(key)) extra[key] = value;
  }

  return {
    protocol: "grblhal-status-v1",
    receivedAt: options.receivedAt ?? new Date().toISOString(),
    raw,
    state: parseMachineState(parts[0]),
    position: { machine, work, wco },
    motion: {
      feed: feedSpeed[0] ?? feedOnly[0] ?? 0,
      spindleCommand: feedSpeed[1] ?? 0,
      spindleActual: feedSpeed[2] ?? null,
      distanceToGo: parseVector(fields.get("DTG")),
    },
    buffer: {
      plannerAvailable: buffer[0] ?? null,
      rxAvailable: buffer[1] ?? null,
    },
    line: parseNumber(fields.get("Ln")),
    pins,
    overrides: fields.has("Ov")
      ? {
        feed: overrides[0] ?? null,
        rapid: overrides[1] ?? null,
        spindle: overrides[2] ?? null,
      }
      : previous?.overrides ?? { feed: null, rapid: null, spindle: null },
    accessories,
    workCoordinateSystem: fields.get("WCS") ?? previous?.workCoordinateSystem ?? null,
    tool: fields.has("T") ? parseNumber(fields.get("T")) : previous?.tool ?? null,
    activeProbe: fields.has("P") ? parseNumber(fields.get("P").split(",")[0]) : previous?.activeProbe ?? null,
    homing: fields.has("H")
      ? {
        complete: fields.get("H").split(",")[0] === "1",
        mask: parseNumber(fields.get("H").split(",")[1]),
      }
      : previous?.homing ?? { complete: null, mask: null },
    toolLengthReferenceSet: fields.has("TLR") ? fields.get("TLR") === "1" : null,
    scalingAxes: fields.get("Sc") ?? "",
    autoReportInterval: fields.has("AR") ? parseNumber(fields.get("AR")) : null,
    mpgMode: fields.has("MPG") ? fields.get("MPG") === "1" : null,
    extra,
  };
}

export function parseControllerLine(line, previous = null, options = {}) {
  const raw = String(line ?? "").trim();
  if (!raw) return null;

  const status = parseGrblStatus(raw, previous, options);
  if (status) return { type: "status", status };

  let match = raw.match(/^ALARM:(\d+)$/i);
  if (match) return { type: "alarm", code: Number(match[1]), raw };

  match = raw.match(/^error:(\d+)$/i);
  if (match) return { type: "error", code: Number(match[1]), raw };

  match = raw.match(/^\[PRB:([^:]+):([01])\]$/i);
  if (match) {
    return {
      type: "probe",
      position: parseVector(match[1]),
      success: match[2] === "1",
      raw,
    };
  }

  match = raw.match(/^\[MSG:(.*)\]$/i);
  if (match) return { type: "message", message: match[1], raw };

  match = raw.match(/^\[GC:(.*)\]$/i);
  if (match) return { type: "parser-state", value: match[1], raw };

  if (/^Grbl/i.test(raw)) return { type: "startup", value: raw, raw };
  if (raw === "ok") return { type: "ok", raw };
  if (/^\[[A-Z]+:/i.test(raw)) return { type: "info", value: raw, raw };
  return { type: "text", value: raw, raw };
}
