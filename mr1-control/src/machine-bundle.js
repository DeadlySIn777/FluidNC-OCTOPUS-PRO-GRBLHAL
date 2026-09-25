import {
  loadCutterCompensationProfile,
  normalizeCutterCompensationProfile,
  saveCutterCompensationProfile,
} from "./cutter-compensation.js";
import {
  loadFissionImportProfile,
  normalizeFissionImportProfile,
  saveFissionImportProfile,
} from "./fission-import.js";
import {
  loadFixtureMapProfile,
  normalizeFixtureMapProfile,
  saveFixtureMapProfile,
} from "./fixture-map-profile.js";
import {
  loadMachineIdentity,
  normalizeMachineIdentity,
  saveMachineIdentity,
} from "./machine-identity.js";
import {
  loadMetrologySession,
  normalizeMetrologySession,
  saveMetrologySession,
} from "./metrology-session.js";
import {
  loadProbeCalibration,
  normalizeProbeCalibration,
  saveProbeCalibration,
} from "./probe-calibration.js";
import {
  loadProbingProfile,
  normalizeProbingProfile,
  saveProbingProfile,
} from "./probing-profile.js";
import {
  loadSceneRegistrationProfile,
  normalizeSceneRegistrationProfile,
  saveSceneRegistrationProfile,
} from "./scene-registration.js";
import {
  loadSensorWiringProfile,
  normalizeSensorWiringProfile,
  saveSensorWiringProfile,
} from "./sensor-wiring-profile.js";
import {
  loadWiringEvidence,
  normalizeWiringEvidence,
  saveWiringEvidence,
} from "./wiring-installation.js";

export const MACHINE_BUNDLE_FORMAT = "mr1-control-machine-bundle";
export const MACHINE_BUNDLE_SCHEMA_VERSION = 1;
export const MAX_MACHINE_BUNDLE_BYTES = 16 * 1024 * 1024;
export const MACHINE_CONFIGURATION_SECTIONS = Object.freeze([
  "fixtureMap",
  "probing",
  "probeCalibration",
  "sensorWiring",
  "cutterCompensation",
  "sceneRegistration",
  "metrology",
  "fission",
  "wiringEvidence",
]);

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, canonicalValue(value[key])]),
  );
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalValue(value));
}

export async function sha256Hex(value, cryptoProvider = globalThis.crypto) {
  if (!cryptoProvider?.subtle) throw new Error("SHA-256 verification is unavailable.");
  const bytes = new TextEncoder().encode(String(value));
  const digest = await cryptoProvider.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}

export function normalizeControllerBinding(candidate = {}) {
  const fingerprint = String(candidate.transcriptSha256 ?? candidate.fingerprint ?? "").trim().toUpperCase();
  const capturedAt = Date.parse(candidate.capturedAt);
  return {
    profile: String(candidate.profile ?? "").trim().slice(0, 80) || null,
    source: String(candidate.source ?? "").trim().slice(0, 120) || null,
    fingerprint: /^[0-9A-F]{64}$/.test(fingerprint) ? fingerprint : null,
    capturedAt: Number.isFinite(capturedAt) ? new Date(capturedAt).toISOString() : null,
    simulated: candidate.simulated === true,
    preflightPassed: candidate.preflightPassed === true,
    physicalMotionPermitted: false,
  };
}

export function normalizeMachineConfiguration(candidate = {}) {
  const fixtureMap = normalizeFixtureMapProfile(candidate.fixtureMap);
  return {
    fixtureMap,
    probing: normalizeProbingProfile(candidate.probing),
    probeCalibration: normalizeProbeCalibration(candidate.probeCalibration),
    sensorWiring: normalizeSensorWiringProfile(candidate.sensorWiring),
    cutterCompensation: normalizeCutterCompensationProfile(candidate.cutterCompensation),
    sceneRegistration: normalizeSceneRegistrationProfile(candidate.sceneRegistration, fixtureMap),
    metrology: normalizeMetrologySession(candidate.metrology),
    fission: normalizeFissionImportProfile(candidate.fission),
    wiringEvidence: normalizeWiringEvidence(candidate.wiringEvidence),
  };
}

export function captureMachineConfiguration(storage = globalThis.localStorage) {
  const fixtureMap = loadFixtureMapProfile(storage);
  return normalizeMachineConfiguration({
    fixtureMap,
    probing: loadProbingProfile(storage),
    probeCalibration: loadProbeCalibration(storage),
    sensorWiring: loadSensorWiringProfile(storage),
    cutterCompensation: loadCutterCompensationProfile(storage),
    sceneRegistration: loadSceneRegistrationProfile(storage, fixtureMap),
    metrology: loadMetrologySession(storage),
    fission: loadFissionImportProfile(storage),
    wiringEvidence: loadWiringEvidence(storage),
  });
}

function persistMachineConfiguration(configuration, storage) {
  const normalized = normalizeMachineConfiguration(configuration);
  const fixtureMap = saveFixtureMapProfile(normalized.fixtureMap, storage);
  saveProbingProfile(normalized.probing, storage);
  saveProbeCalibration(normalized.probeCalibration, storage);
  saveSensorWiringProfile(normalized.sensorWiring, storage);
  saveCutterCompensationProfile(normalized.cutterCompensation, storage);
  saveSceneRegistrationProfile(normalized.sceneRegistration, storage, fixtureMap);
  saveMetrologySession(normalized.metrology, storage);
  saveFissionImportProfile(normalized.fission, storage);
  saveWiringEvidence(normalized.wiringEvidence, storage);
  return normalizeMachineConfiguration({ ...normalized, fixtureMap });
}

export async function createMachineBundle(options = {}) {
  const createdAt = new Date(options.createdAt ?? Date.now()).toISOString();
  const identity = normalizeMachineIdentity(options.identity, { now: createdAt });
  if (!identity.machineId) throw new Error("A valid MR-1 machine identity is required.");
  const controller = normalizeControllerBinding(options.controller);
  const payload = {
    format: MACHINE_BUNDLE_FORMAT,
    schemaVersion: MACHINE_BUNDLE_SCHEMA_VERSION,
    createdAt,
    application: {
      name: "MR-1 Control",
      configurationSections: [...MACHINE_CONFIGURATION_SECTIONS],
    },
    machine: identity,
    controller,
    configuration: normalizeMachineConfiguration(options.configuration),
  };
  const digest = await sha256Hex(canonicalJson(payload), options.cryptoProvider);
  return {
    ...payload,
    integrity: { algorithm: "SHA-256", digest },
  };
}

export async function parseMachineBundle(source, options = {}) {
  const text = typeof source === "string" ? source : JSON.stringify(source);
  const size = new TextEncoder().encode(text).byteLength;
  if (size > (options.maxBytes ?? MAX_MACHINE_BUNDLE_BYTES)) {
    throw new Error("Machine bundle exceeds the 16 MB import limit.");
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Machine bundle is not valid JSON.");
  }
  if (parsed?.format !== MACHINE_BUNDLE_FORMAT) throw new Error("File is not an MR-1 machine bundle.");
  if (parsed.schemaVersion !== MACHINE_BUNDLE_SCHEMA_VERSION) {
    throw new Error(`Unsupported machine bundle schema ${parsed.schemaVersion ?? "unknown"}.`);
  }
  if (parsed.integrity?.algorithm !== "SHA-256" || !/^[0-9A-F]{64}$/i.test(parsed.integrity?.digest ?? "")) {
    throw new Error("Machine bundle has no valid SHA-256 integrity record.");
  }
  const { integrity, ...payload } = parsed;
  const digest = await sha256Hex(canonicalJson(payload), options.cryptoProvider);
  if (digest !== String(integrity.digest).toUpperCase()) {
    throw new Error("Machine bundle integrity check failed.");
  }
  const machine = normalizeMachineIdentity(parsed.machine, { now: parsed.createdAt });
  if (!machine.machineId) throw new Error("Machine bundle identity is invalid.");
  return {
    format: MACHINE_BUNDLE_FORMAT,
    schemaVersion: MACHINE_BUNDLE_SCHEMA_VERSION,
    createdAt: new Date(parsed.createdAt).toISOString(),
    application: {
      name: "MR-1 Control",
      configurationSections: [...MACHINE_CONFIGURATION_SECTIONS],
    },
    machine,
    controller: normalizeControllerBinding(parsed.controller),
    configuration: normalizeMachineConfiguration(parsed.configuration),
    integrity: { algorithm: "SHA-256", digest },
  };
}

function shortValue(value) {
  if (Array.isArray(value)) return `[${value.length} items]`;
  if (value && typeof value === "object") return `{${Object.keys(value).length} fields}`;
  if (value === null || value === undefined || value === "") return "--";
  const text = String(value);
  return text.length > 72 ? `${text.slice(0, 69)}...` : text;
}

export function diffMachineConfigurations(currentCandidate, incomingCandidate, options = {}) {
  const current = normalizeMachineConfiguration(currentCandidate);
  const incoming = normalizeMachineConfiguration(incomingCandidate);
  const limit = Math.max(1, Math.min(2000, Number(options.limit ?? 250)));
  const changes = [];
  let total = 0;

  const visit = (before, after, path) => {
    if (canonicalJson(before) === canonicalJson(after)) return;
    const beforeObject = before && typeof before === "object";
    const afterObject = after && typeof after === "object";
    if (beforeObject && afterObject && !Array.isArray(before) && !Array.isArray(after)) {
      const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
      [...keys].sort().forEach((key) => visit(before[key], after[key], path ? `${path}.${key}` : key));
      return;
    }
    total += 1;
    if (changes.length < limit) changes.push({
      path,
      before: shortValue(before),
      after: shortValue(after),
    });
  };

  visit(current, incoming, "");
  return { total, truncated: total > changes.length, changes };
}

export function applyMachineBundle(bundle, options = {}) {
  const storage = options.storage ?? globalThis.localStorage;
  const beforeConfiguration = captureMachineConfiguration(storage);
  const beforeIdentity = loadMachineIdentity(storage, options.identityOptions);
  try {
    const configuration = persistMachineConfiguration(bundle.configuration, storage);
    const controllerFingerprint = bundle.controller?.simulated
      ? null
      : bundle.controller?.fingerprint ?? bundle.machine.controllerFingerprint;
    const identity = options.adoptMachineIdentity === false
      ? beforeIdentity
      : saveMachineIdentity({
          ...bundle.machine,
          controllerFingerprint,
          controllerProfile: bundle.controller?.profile ?? bundle.machine.controllerProfile,
        }, storage, options.identityOptions);
    return { configuration, identity };
  } catch (error) {
    try {
      persistMachineConfiguration(beforeConfiguration, storage);
      saveMachineIdentity(beforeIdentity, storage, options.identityOptions);
    } catch {
      // Preserve the original failure; callers must stop and inspect storage if rollback also fails.
    }
    throw error;
  }
}
