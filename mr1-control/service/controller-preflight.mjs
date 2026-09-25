import { createHash } from "node:crypto";

const SAFE_READ_ONLY_QUERIES = new Set(["?", "$I+", "$$", "$G", "$#", "$N"]);
const SETTING_PATTERN = /^\$(\d+)=(.*)$/;
const NUMBER_PATTERN = /^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?$/;
const STATUS_PATTERN = /^<([^>\r\n]+)>$/;

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizedLines(transcript) {
  return String(transcript ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function issue(severity, code, message) {
  return { severity, code, message };
}

export function validateControllerPreflightProfile(candidate) {
  if (!candidate || candidate.schemaVersion !== 1) {
    throw new Error("Controller preflight profile schema must be version 1.");
  }
  if (typeof candidate.profile !== "string" || !candidate.profile.trim()) {
    throw new Error("Controller preflight profile name is required.");
  }
  if (typeof candidate.boardIdentityContains !== "string" || !candidate.boardIdentityContains.trim()) {
    throw new Error("Controller preflight board identity is required.");
  }
  if (!Array.isArray(candidate.readOnlyQueries) || candidate.readOnlyQueries.length === 0) {
    throw new Error("Controller preflight requires a read-only query sequence.");
  }
  for (const command of candidate.readOnlyQueries) {
    if (!SAFE_READ_ONLY_QUERIES.has(command)) {
      throw new Error(`Unsafe controller preflight query rejected: ${String(command)}`);
    }
  }
  if (!Array.isArray(candidate.settings) || candidate.settings.length === 0) {
    throw new Error("Controller preflight requires expected settings.");
  }
  const ids = new Set();
  for (const setting of candidate.settings) {
    if (!Number.isInteger(setting?.id) || setting.id < 0 || ids.has(setting.id)) {
      throw new Error(`Controller preflight setting ID is invalid or duplicated: ${String(setting?.id)}`);
    }
    ids.add(setting.id);
    if (typeof setting.expected !== 'number' || typeof setting.tolerance !== 'number'
      || finiteNumber(setting.expected) === null || finiteNumber(setting.tolerance) === null || setting.tolerance < 0) {
      throw new Error(`Controller preflight setting $${setting.id} has an invalid expected value or tolerance.`);
    }
    if (setting.severity !== "blocker" && setting.severity !== "warning") {
      throw new Error(`Controller preflight setting $${setting.id} has an invalid severity.`);
    }
  }
  return candidate;
}

export function controllerPreflightCommand(command) {
  if (!SAFE_READ_ONLY_QUERIES.has(command)) return null;
  return Buffer.from(command === "?" ? "?" : `${command}\n`, "ascii");
}

export function parseControllerSettings(transcript) {
  const settings = new Map();
  for (const line of normalizedLines(transcript)) {
    const match = line.match(SETTING_PATTERN);
    if (!match) continue;
    const value = NUMBER_PATTERN.test(match[2]) ? finiteNumber(match[2]) : null;
    if (value !== null) settings.set(Number(match[1]), value);
    else settings.delete(Number(match[1])); // A malformed newer record cannot inherit an older pass.
  }
  return settings;
}

// The raw transcript hash seals one capture. Commissioning evidence instead
// binds stable firmware identity and ALL reported settings, not moving axes,
// offsets, parser state, polling order or receive timing. This is configuration
// identity, not proof of a unique MCU or an on-device firmware readback.
export function controllerConfigurationFingerprint(transcript, settingOverrides = {}) {
  const identity = [...new Set(normalizedLines(transcript).filter(line =>
    /^\[(?:VER|OPT|NEWOPT|BOARD|DRIVER|DRIVER VERSION|DRIVER OPTIONS|FIRMWARE|UID|UUID|COMPATIBILITY LEVEL):/.test(line) || /^\$N[01]=/.test(line))
    .map(line => {
      if (!line.startsWith('[OPT:')) return line;
      const [flags, ...values] = line.slice(5, -1).split(',');
      let options = flags;
      if (settingOverrides[22] !== undefined) options = Number(settingOverrides[22]) & 4
        ? flags.replaceAll('L', '') : flags.includes('L') ? flags : flags + 'L';
      return `[OPT:${[options.split('').sort().join(''), ...values].join(',')}]`;
    }))].sort();
  const settings = new Map();
  for (const line of normalizedLines(transcript)) {
    const match = line.match(SETTING_PATTERN);
    if (!match) continue;
    // String and list-valued settings also bind configuration identity. Do not
    // silently truncate a list or omit a nonnumeric controller setting.
    const numeric = NUMBER_PATTERN.test(match[2]) ? finiteNumber(match[2]) : null;
    settings.set(Number(match[1]), numeric === null ? match[2] : numeric);
  }
  for (const [id, value] of Object.entries(settingOverrides)) settings.set(Number(id), Number(value));
  return createHash('sha256').update(JSON.stringify({ identity, settings: [...settings].sort((a, b) => a[0] - b[0]) })).digest('hex').toUpperCase();
}

export function createSimulatedPreflightTranscript(
  profile,
  status = "<Alarm|MPos:-283.210,-273.050,-20.000|FS:0,0|Pn:>",
  settingOverrides = {},
) {
  const expected = validateControllerPreflightProfile(profile);
  const overrides = settingOverrides instanceof Map
    ? settingOverrides
    : new Map(Object.entries(settingOverrides ?? {}).map(([id, value]) => [Number(id), value]));
  const lines = [
    "[VER:mr1-control-simulation]",
    `[BOARD:${expected.boardIdentityContains}]`,
  ];
  for (const setting of expected.settings) {
    const value = overrides.has(setting.id) ? Number(overrides.get(setting.id)) : Number(setting.expected);
    lines.push(`$${setting.id}=${value.toPrecision(17)}`);
  }
  lines.push(status);
  return lines.join("\r\n");
}

export function evaluateControllerPreflight(transcript, profile, options = {}) {
  const expected = validateControllerPreflightProfile(profile);
  const text = String(transcript ?? "");
  const lines = normalizedLines(text);
  const actualSettings = parseControllerSettings(text);
  const comparisons = expected.settings.map((setting) => {
    const actual = actualSettings.get(setting.id);
    const missing = !actualSettings.has(setting.id);
    const difference = missing ? null : Math.abs(actual - Number(setting.expected));
    return {
      id: setting.id,
      name: setting.name,
      expected: Number(setting.expected),
      actual: missing ? null : actual,
      tolerance: Number(setting.tolerance),
      severity: setting.severity,
      status: missing ? "MISSING" : difference <= Number(setting.tolerance) ? "PASS" : "MISMATCH",
    };
  });

  const issues = [];
  const boardRecords = lines.filter(line => line.startsWith('[BOARD:'));
  const boardIdentityPresent = boardRecords.length > 0
    && boardRecords.every(line => line === `[BOARD:${expected.boardIdentityContains}]`);
  if (!boardIdentityPresent) {
    issues.push(issue("blocker", "BOARD_IDENTITY", "The controller did not report the exact MR-1 Octopus Pro board identity."));
  }
  const expectedIds = new Set(expected.settings.map(setting => setting.id));
  const seenSettings = new Map();
  const malformedSettings = new Set(), conflictingSettings = new Set();
  for (const line of lines) {
    const match = line.match(SETTING_PATTERN);
    if (!match || !expectedIds.has(Number(match[1]))) continue;
    const id = Number(match[1]);
    const value = NUMBER_PATTERN.test(match[2]) ? finiteNumber(match[2]) : null;
    if (value === null) malformedSettings.add(id);
    else if (seenSettings.has(id) && seenSettings.get(id) !== value) conflictingSettings.add(id);
    if (value !== null) seenSettings.set(id, value);
  }
  for (const id of malformedSettings) issues.push(issue('blocker', `MALFORMED_SETTING_${id}`, `Controller setting $${id} was not a complete finite numeric report.`));
  for (const id of conflictingSettings) issues.push(issue('blocker', `CONFLICTING_SETTING_${id}`, `Controller setting $${id} changed within the preflight capture.`));

  const statusLines = lines.filter((line) => STATUS_PATTERN.test(line));
  const machineStatus = statusLines.at(-1) ?? null;
  const statusBody = machineStatus?.slice(1, -1) ?? "";
  const machineState = statusBody ? statusBody.split("|", 1)[0] : null;
  const pinMatch = statusBody.match(/(?:^|\|)Pn:([^|>]*)/);
  const activePins = pinMatch?.[1] ?? "";
  if (!machineStatus) {
    issues.push(issue("blocker", "NO_STATUS", "No realtime controller status was captured."));
  } else if (!/^(?:Idle|Alarm)(?::.*)?$/i.test(machineState)) {
    issues.push(issue("blocker", "MACHINE_STATE", `Controller state ${machineState} is not an idle preflight state.`));
  }
  if (activePins) {
    issues.push(issue("blocker", "ACTIVE_INPUTS", `Controller reports active inputs: ${activePins}.`));
  }

  for (const comparison of comparisons) {
    if (comparison.status === "PASS") continue;
    const actual = comparison.actual === null ? "missing" : comparison.actual;
    issues.push(issue(
      comparison.severity,
      `SETTING_${comparison.id}`,
      `$${comparison.id} ${comparison.name}: expected ${comparison.expected}, received ${actual}.`,
    ));
  }

  const blockers = issues.filter((item) => item.severity === "blocker").length;
  const warnings = issues.filter((item) => item.severity === "warning").length;
  const settingsPassed = comparisons.filter((item) => item.status === "PASS").length;
  const simulated = options.simulated === true;
  const status = blockers === 0 ? "PASS" : "BLOCKED";

  return {
    protocol: "mr1-controller-preflight-v1",
    status,
    simulated,
    profile: expected.profile,
    source: options.source ?? (simulated ? "simulation" : "controller"),
    capturedAt: options.capturedAt ?? new Date().toISOString(),
    transcriptSha256: createHash("sha256").update(text, "utf8").digest("hex").toUpperCase(),
    configurationFingerprint: controllerConfigurationFingerprint(text),
    boardIdentityPresent,
    machineState,
    activePins,
    queryPolicy: "read-only-allow-list",
    queries: [...expected.readOnlyQueries],
    counts: {
      settingsPassed,
      settingsExpected: comparisons.length,
      blockers,
      warnings,
    },
    issues,
    settings: comparisons,
    preflightPassed: status === "PASS",
    physicalMotionPermitted: false,
  };
}

export function pendingControllerPreflight(status = "PENDING", message = "Waiting for controller preflight.") {
  return {
    protocol: "mr1-controller-preflight-v1",
    status,
    simulated: false,
    profile: null,
    source: null,
    capturedAt: null,
    transcriptSha256: null,
    boardIdentityPresent: false,
    machineState: null,
    activePins: "",
    queryPolicy: "read-only-allow-list",
    queries: [],
    counts: { settingsPassed: 0, settingsExpected: 0, blockers: 0, warnings: 0 },
    issues: status === "ERROR" ? [issue("blocker", "PREFLIGHT_ERROR", message)] : [],
    settings: [],
    preflightPassed: false,
    physicalMotionPermitted: false,
  };
}

export function summarizeControllerPreflight(report) {
  const { settings: _settings, issues = [], ...summary } = report ?? pendingControllerPreflight();
  return {
    ...summary,
    issues: issues.slice(0, 8),
    issueCount: issues.length,
    issuesTruncated: issues.length > 8,
    reportAvailable: typeof report?.transcriptSha256 === "string" && report.transcriptSha256.length === 64,
  };
}
