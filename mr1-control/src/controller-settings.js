export const CONTROLLER_SETTINGS_PLAN_PROTOCOL = "mr1-controller-settings-plan-v1";
export const CONTROLLER_SETTINGS_PLAN_FORMAT = "mr1-controller-settings-plan";
export const CONTROLLER_SETTINGS_PLAN_SCHEMA_VERSION = 1;
export const CONTROLLER_SETTINGS_SNAPSHOT_FORMAT = "mr1-controller-settings-snapshot";
export const CONTROLLER_SETTINGS_SNAPSHOT_SCHEMA_VERSION = 1;
export const MAX_CONTROLLER_SETTING_CHANGES = 65;

export const CONTROLLER_SETTING_CATEGORIES = Object.freeze([
  Object.freeze({ id: "all", label: "ALL" }),
  Object.freeze({ id: "motion", label: "MOTION" }),
  Object.freeze({ id: "homing", label: "HOMING" }),
  Object.freeze({ id: "inputs", label: "INPUTS" }),
  Object.freeze({ id: "spindle", label: "SPINDLE" }),
  Object.freeze({ id: "probing", label: "PROBING" }),
  Object.freeze({ id: "system", label: "SYSTEM" }),
]);

const CATEGORY_IDS = Object.freeze({
  motion: new Set([0, 1, 2, 3, 4, 8, 20, 29, 40, 100, 101, 102, 110, 111, 112, 120, 121, 122, 130, 131, 132, 680]),
  homing: new Set([22, 23, 24, 25, 26, 27, 43, 44, 45, 46, 347, 348, 349]),
  inputs: new Set([5, 6, 14, 17, 18, 19, 21, 484, 744, 745]),
  spindle: new Set([9, 30, 31, 33, 34, 35, 36, 394, 539]),
  probing: new Set([65, 341, 342, 343, 344, 345]),
  system: new Set([10, 32, 41, 62, 673]),
});

const BITMASK_IDS = new Set([2, 3, 4, 5, 6, 8, 9, 10, 14, 17, 18, 19, 21, 22, 23, 32, 44, 45, 46, 65, 744, 745]);
const BOOLEAN_IDS = new Set([20, 40, 41, 62, 484]);
const ENUM_IDS = new Set([341]);
const INTEGER_IDS = new Set([1, 26, 33, 43, 680]);

const UNIT_BY_ID = Object.freeze({
  0: "us",
  1: "ms",
  24: "mm/min",
  25: "mm/min",
  26: "ms",
  27: "mm",
  29: "us",
  30: "rpm",
  31: "rpm",
  33: "Hz",
  34: "%",
  35: "%",
  36: "%",
  100: "step/mm",
  101: "step/mm",
  102: "step/mm",
  110: "mm/min",
  111: "mm/min",
  112: "mm/min",
  120: "mm/s2",
  121: "mm/s2",
  122: "mm/s2",
  130: "mm",
  131: "mm",
  132: "mm",
  342: "mm",
  343: "mm/min",
  344: "mm/min",
  345: "mm/min",
  347: "%",
  348: "mm",
  349: "mm",
  394: "s",
  539: "s",
  673: "s",
  680: "ms",
});

const MAX_BY_ID = Object.freeze({
  0: 100,
  1: 65_535,
  24: 10_000,
  25: 10_000,
  26: 10_000,
  27: 50,
  29: 100,
  30: 24_000,
  31: 24_000,
  33: 100_000,
  34: 100,
  35: 100,
  36: 100,
  43: 10,
  100: 100_000,
  101: 100_000,
  102: 100_000,
  110: 20_000,
  111: 20_000,
  112: 20_000,
  120: 10_000,
  121: 10_000,
  122: 10_000,
  130: 5_000,
  131: 5_000,
  132: 5_000,
  341: 10,
  342: 100,
  343: 10_000,
  344: 10_000,
  345: 10_000,
  347: 100,
  348: 100,
  349: 100,
  394: 60,
  539: 60,
  673: 60,
  680: 65_535,
});

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function exactHash(value) {
  const normalized = String(value ?? "").trim().toUpperCase();
  return /^[0-9A-F]{64}$/.test(normalized) ? normalized : null;
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalValue(value[key])]));
}

function canonicalJson(value) {
  return JSON.stringify(canonicalValue(value));
}

async function sha256Text(value, cryptoProvider = globalThis.crypto) {
  if (!cryptoProvider?.subtle) throw new Error("SHA-256 is unavailable.");
  const digest = await cryptoProvider.subtle.digest("SHA-256", new TextEncoder().encode(String(value)));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("").toUpperCase();
}

export function controllerSettingCategory(id) {
  const settingId = Number(id);
  return Object.entries(CATEGORY_IDS).find(([, ids]) => ids.has(settingId))?.[0] ?? "system";
}

export function controllerSettingMetadata(id, tolerance = 0) {
  const settingId = Number(id);
  const kind = BOOLEAN_IDS.has(settingId)
    ? "boolean"
    : BITMASK_IDS.has(settingId)
      ? "bitmask"
      : ENUM_IDS.has(settingId)
        ? "enum"
        : INTEGER_IDS.has(settingId) || Number(tolerance) === 0
          ? "integer"
          : "number";
  return Object.freeze({
    category: controllerSettingCategory(settingId),
    kind,
    unit: UNIT_BY_ID[settingId] ?? "",
    minimum: settingId === 0 ? 2 : 0,
    maximum: kind === "boolean" ? 1 : kind === "bitmask" ? 65_535 : MAX_BY_ID[settingId] ?? 1_000_000_000,
    step: kind === "number" ? Math.max(Number(tolerance) || 0.001, 0.0001) : 1,
  });
}

export function normalizeControllerSettingsReport(candidate) {
  if (!candidate || candidate.protocol !== "mr1-controller-preflight-v1") {
    throw new Error("Controller settings report protocol is invalid.");
  }
  if (!Array.isArray(candidate.settings) || candidate.settings.length === 0 || candidate.settings.length > 256) {
    throw new Error("Controller settings report has no bounded setting list.");
  }
  const ids = new Set();
  const settings = candidate.settings.map((setting) => {
    const id = Number(setting?.id);
    const expected = finite(setting?.expected);
    const actual = setting?.actual === null || setting?.actual === undefined ? null : finite(setting.actual);
    const tolerance = finite(setting?.tolerance);
    if (!Number.isInteger(id) || id < 0 || id > 9999 || ids.has(id)) throw new Error(`Setting ID ${String(setting?.id)} is invalid or duplicated.`);
    if (expected === null || tolerance === null || tolerance < 0 || (setting?.severity !== "blocker" && setting?.severity !== "warning")) {
      throw new Error(`Setting $${id} has an invalid controller contract.`);
    }
    if (actual === null && setting?.actual !== null && setting?.actual !== undefined) throw new Error(`Setting $${id} has an invalid actual value.`);
    ids.add(id);
    return Object.freeze({
      id,
      name: String(setting.name ?? `Setting ${id}`).trim().slice(0, 100),
      expected,
      actual,
      tolerance,
      severity: setting.severity,
      status: actual === null ? "MISSING" : Math.abs(actual - expected) <= tolerance ? "PASS" : "MISMATCH",
      ...controllerSettingMetadata(id, tolerance),
    });
  }).sort((left, right) => left.id - right.id);
  const settingsPassed = settings.filter((setting) => setting.status === "PASS").length;
  return Object.freeze({
    protocol: candidate.protocol,
    status: String(candidate.status ?? "UNKNOWN").toUpperCase(),
    simulated: candidate.simulated === true,
    profile: String(candidate.profile ?? "").trim(),
    source: String(candidate.source ?? "").trim(),
    capturedAt: Number.isFinite(Date.parse(candidate.capturedAt)) ? new Date(candidate.capturedAt).toISOString() : null,
    transcriptSha256: exactHash(candidate.transcriptSha256),
    boardIdentityPresent: candidate.boardIdentityPresent === true,
    machineState: String(candidate.machineState ?? ""),
    activePins: String(candidate.activePins ?? ""),
    settings: Object.freeze(settings),
    counts: Object.freeze({
      settingsPassed,
      settingsExpected: settings.length,
      mismatches: settings.filter((setting) => setting.status === "MISMATCH").length,
      missing: settings.filter((setting) => setting.status === "MISSING").length,
    }),
    physicalWritesPermitted: false,
  });
}

function normalizeStagedValues(staged) {
  if (staged instanceof Map) return Object.fromEntries(staged);
  return staged && typeof staged === "object" ? { ...staged } : {};
}

function validateSettingValue(setting, value) {
  const numeric = finite(value);
  if (numeric === null) return { value: null, error: `$${setting.id} requires a finite number.` };
  if ((setting.kind === "integer" || setting.kind === "bitmask" || setting.kind === "boolean" || setting.kind === "enum") && !Number.isInteger(numeric)) {
    return { value: numeric, error: `$${setting.id} requires a whole number.` };
  }
  if (numeric < setting.minimum || numeric > setting.maximum) {
    return { value: numeric, error: `$${setting.id} must be ${setting.minimum} through ${setting.maximum}.` };
  }
  return { value: numeric, error: null };
}

function crossSettingErrors(finalValues) {
  const errors = [];
  if (finalValues.get(30) <= finalValues.get(31)) errors.push("$30 maximum spindle speed must exceed $31 minimum spindle speed.");
  if (finalValues.get(35) > finalValues.get(36)) errors.push("$35 spindle PWM minimum cannot exceed $36 maximum.");
  if (finalValues.get(348) > finalValues.get(349)) errors.push("$348 dual-Y minimum cannot exceed $349 maximum.");
  if (finalValues.get(24) > finalValues.get(25)) errors.push("$24 homing locate feed cannot exceed $25 seek feed.");
  return errors;
}

export function evaluateControllerSettingsPlan({ report, staged, confirmed = false } = {}) {
  const normalizedReport = normalizeControllerSettingsReport(report);
  const byId = new Map(normalizedReport.settings.map((setting) => [setting.id, setting]));
  const stagedValues = normalizeStagedValues(staged);
  const changes = [];
  const errors = [];
  for (const [rawId, rawValue] of Object.entries(stagedValues)) {
    const id = Number(rawId);
    const setting = byId.get(id);
    if (!setting) {
      errors.push(`Setting $${rawId} is not present in the active controller profile.`);
      continue;
    }
    if (setting.actual === null) {
      errors.push(`Setting $${id} has no live baseline and cannot be staged safely.`);
      continue;
    }
    const checked = validateSettingValue(setting, rawValue);
    if (checked.error) {
      errors.push(checked.error);
      continue;
    }
    if (Math.abs(checked.value - setting.actual) <= 1e-12) continue;
    changes.push(Object.freeze({
      id,
      name: setting.name,
      from: setting.actual,
      to: checked.value,
      expected: setting.expected,
      severity: setting.severity,
      category: setting.category,
      unit: setting.unit,
    }));
  }
  changes.sort((left, right) => left.id - right.id);
  if (changes.length > MAX_CONTROLLER_SETTING_CHANGES) errors.push(`No more than ${MAX_CONTROLLER_SETTING_CHANGES} settings may be changed at once.`);
  const finalValues = new Map(normalizedReport.settings.map((setting) => [setting.id, setting.actual]));
  changes.forEach((change) => finalValues.set(change.id, change.to));
  errors.push(...crossSettingErrors(finalValues));
  const controllerSafe = /^(?:Idle|Alarm)(?::.*)?$/i.test(normalizedReport.machineState) && normalizedReport.activePins === "";
  const baselineBound = normalizedReport.transcriptSha256 !== null;
  const readyToApply = normalizedReport.simulated
    && controllerSafe
    && baselineBound
    && confirmed
    && changes.length > 0
    && errors.length === 0;
  return Object.freeze({
    protocol: CONTROLLER_SETTINGS_PLAN_PROTOCOL,
    profile: normalizedReport.profile,
    baseTranscriptSha256: normalizedReport.transcriptSha256,
    report: normalizedReport,
    changes: Object.freeze(changes),
    errors: Object.freeze(errors),
    confirmed: confirmed === true,
    controllerSafe,
    baselineBound,
    readyToApply,
    physicalWritesPermitted: false,
    status: errors[0]
      ?? (changes.length === 0 ? "NO STAGED CHANGES"
        : !normalizedReport.simulated ? "PHYSICAL SETTING WRITES LOCKED"
          : !controllerSafe ? "CONTROLLER MUST BE IDLE WITH INPUTS CLEAR"
            : !confirmed ? "REVIEW AND CONFIRM THE STAGED DIFF"
              : `${changes.length} CHANGE${changes.length === 1 ? "" : "S"} READY FOR VIRTUAL APPLY`),
  });
}

function rejectUnknownKeys(candidate, allowed, label) {
  const unknown = Object.keys(candidate ?? {}).filter((key) => !allowed.has(key));
  if (unknown.length) throw new Error(`${label} contains unsupported field ${unknown[0]}.`);
}

export function validateControllerSettingsApplyRequest(payload, report) {
  rejectUnknownKeys(payload, new Set(["protocol", "profile", "baseTranscriptSha256", "changes", "confirmed"]), "Settings request");
  if (payload?.protocol !== CONTROLLER_SETTINGS_PLAN_PROTOCOL) throw new Error("Settings request protocol is invalid.");
  const normalizedReport = normalizeControllerSettingsReport(report);
  if (payload.profile !== normalizedReport.profile) throw new Error("Settings request profile does not match the connected controller.");
  if (exactHash(payload.baseTranscriptSha256) !== normalizedReport.transcriptSha256) throw new Error("Controller settings changed after this plan was created. Refresh and review again.");
  if (payload.confirmed !== true) throw new Error("Settings request requires explicit review confirmation.");
  if (!Array.isArray(payload.changes) || payload.changes.length === 0 || payload.changes.length > MAX_CONTROLLER_SETTING_CHANGES) {
    throw new Error("Settings request has no bounded change list.");
  }
  const staged = {};
  const ids = new Set();
  for (const change of payload.changes) {
    rejectUnknownKeys(change, new Set(["id", "value"]), "Settings change");
    const id = Number(change?.id);
    if (!Number.isInteger(id) || ids.has(id)) throw new Error(`Settings request ID ${String(change?.id)} is invalid or duplicated.`);
    ids.add(id);
    staged[id] = change.value;
  }
  const evaluation = evaluateControllerSettingsPlan({ report: normalizedReport, staged, confirmed: true });
  if (!evaluation.readyToApply) throw new Error(evaluation.status);
  return Object.freeze({
    protocol: CONTROLLER_SETTINGS_PLAN_PROTOCOL,
    profile: evaluation.profile,
    baseTranscriptSha256: evaluation.baseTranscriptSha256,
    changes: Object.freeze(evaluation.changes.map(({ id, to }) => Object.freeze({ id, value: to }))),
    confirmed: true,
    physicalWritesPermitted: false,
  });
}

export async function createControllerSettingsSnapshot(report, createdAt = new Date().toISOString(), cryptoProvider = globalThis.crypto) {
  const normalized = normalizeControllerSettingsReport(report);
  const payload = {
    format: CONTROLLER_SETTINGS_SNAPSHOT_FORMAT,
    schemaVersion: CONTROLLER_SETTINGS_SNAPSHOT_SCHEMA_VERSION,
    createdAt: new Date(createdAt).toISOString(),
    profile: normalized.profile,
    source: normalized.source,
    simulated: normalized.simulated,
    capturedAt: normalized.capturedAt,
    transcriptSha256: normalized.transcriptSha256,
    machineState: normalized.machineState,
    activePins: normalized.activePins,
    settings: normalized.settings.map(({ id, name, expected, actual, tolerance, severity, status, category, kind, unit }) => ({
      id, name, expected, actual, tolerance, severity, status, category, kind, unit,
    })),
    physicalWritesPermitted: false,
  };
  const digest = await sha256Text(canonicalJson(payload), cryptoProvider);
  return Object.freeze({ ...payload, integrity: Object.freeze({ algorithm: "SHA-256", digest }) });
}

export async function verifyControllerSettingsSnapshot(snapshot, cryptoProvider = globalThis.crypto) {
  if (snapshot?.format !== CONTROLLER_SETTINGS_SNAPSHOT_FORMAT || snapshot?.schemaVersion !== CONTROLLER_SETTINGS_SNAPSHOT_SCHEMA_VERSION) return false;
  if (snapshot?.integrity?.algorithm !== "SHA-256" || !exactHash(snapshot?.integrity?.digest)) return false;
  const { integrity, ...payload } = snapshot;
  return exactHash(integrity.digest) === await sha256Text(canonicalJson(payload), cryptoProvider);
}

export async function createControllerSettingsPlan(
  { report, staged, confirmed = false } = {},
  createdAt = new Date().toISOString(),
  cryptoProvider = globalThis.crypto,
) {
  const evaluation = evaluateControllerSettingsPlan({ report, staged, confirmed });
  if (!evaluation.baselineBound) throw new Error("Controller settings plan requires an exact SHA-256 baseline.");
  if (evaluation.errors.length) throw new Error(evaluation.errors[0]);
  if (evaluation.changes.length === 0) throw new Error("Controller settings plan has no staged changes.");
  const payload = {
    format: CONTROLLER_SETTINGS_PLAN_FORMAT,
    schemaVersion: CONTROLLER_SETTINGS_PLAN_SCHEMA_VERSION,
    protocol: CONTROLLER_SETTINGS_PLAN_PROTOCOL,
    createdAt: new Date(createdAt).toISOString(),
    profile: evaluation.profile,
    source: evaluation.report.source,
    simulated: evaluation.report.simulated,
    baseCapturedAt: evaluation.report.capturedAt,
    baseTranscriptSha256: evaluation.baseTranscriptSha256,
    machineState: evaluation.report.machineState,
    activePins: evaluation.report.activePins,
    controllerSafe: evaluation.controllerSafe,
    confirmed: evaluation.confirmed,
    changes: evaluation.changes.map(({ id, name, from, to, expected, severity, category, unit }) => ({
      id, name, from, to, expected, severity, category, unit,
    })),
    physicalWritesPermitted: false,
  };
  const digest = await sha256Text(canonicalJson(payload), cryptoProvider);
  return Object.freeze({ ...payload, integrity: Object.freeze({ algorithm: "SHA-256", digest }) });
}

export async function verifyControllerSettingsPlan(plan, cryptoProvider = globalThis.crypto) {
  if (plan?.format !== CONTROLLER_SETTINGS_PLAN_FORMAT || plan?.schemaVersion !== CONTROLLER_SETTINGS_PLAN_SCHEMA_VERSION) return false;
  if (plan?.protocol !== CONTROLLER_SETTINGS_PLAN_PROTOCOL || plan?.physicalWritesPermitted !== false) return false;
  if (!Array.isArray(plan?.changes) || plan.changes.length === 0 || plan.changes.length > MAX_CONTROLLER_SETTING_CHANGES) return false;
  if (plan?.integrity?.algorithm !== "SHA-256" || !exactHash(plan?.integrity?.digest)) return false;
  const { integrity, ...payload } = plan;
  return exactHash(integrity.digest) === await sha256Text(canonicalJson(payload), cryptoProvider);
}
