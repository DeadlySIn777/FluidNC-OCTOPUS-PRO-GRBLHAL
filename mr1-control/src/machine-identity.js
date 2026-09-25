import { secureUuidV4 } from "./browser-crypto.js";

export const MACHINE_IDENTITY_STORAGE_KEY = "mr1-control.machine-identity.v1";

const MACHINE_ID_PATTERN = /^MR1-[0-9A-F]{8}-[0-9A-F]{4}-[1-5][0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}$/;
const SHA256_PATTERN = /^[0-9A-F]{64}$/;

function cleanText(value, fallback, maxLength) {
  const text = String(value ?? "").trim().replace(/\s+/g, " ");
  return text ? text.slice(0, maxLength) : fallback;
}

function isoDate(value, fallback) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : fallback;
}

export function createMachineId(randomUUID, cryptoProvider = globalThis.crypto) {
  return `MR1-${secureUuidV4({ randomUuid: randomUUID, cryptoProvider }).toUpperCase()}`;
}

export function normalizeMachineIdentity(candidate = {}, options = {}) {
  const now = isoDate(options.now ?? new Date().toISOString(), new Date().toISOString());
  const candidateId = String(candidate.machineId ?? "").trim().toUpperCase();
  const fallbackId = String(options.fallbackId ?? "").trim().toUpperCase();
  const machineId = MACHINE_ID_PATTERN.test(candidateId)
    ? candidateId
    : MACHINE_ID_PATTERN.test(fallbackId) ? fallbackId : null;
  const controllerFingerprint = String(candidate.controllerFingerprint ?? "").trim().toUpperCase();
  return {
    machineId,
    label: cleanText(candidate.label, "MR-1", 64),
    createdAt: isoDate(candidate.createdAt, now),
    updatedAt: isoDate(candidate.updatedAt, now),
    controllerFingerprint: SHA256_PATTERN.test(controllerFingerprint) ? controllerFingerprint : null,
    controllerProfile: cleanText(candidate.controllerProfile, "", 80) || null,
  };
}

export function loadMachineIdentity(
  storage = globalThis.localStorage,
  options = {},
) {
  const now = options.now ?? new Date().toISOString();
  try {
    const saved = JSON.parse(storage?.getItem(MACHINE_IDENTITY_STORAGE_KEY) ?? "null");
    const normalized = normalizeMachineIdentity(saved, { now });
    if (normalized.machineId) return normalized;
  } catch {
    // A corrupt identity is replaced with a fresh local identity below.
  }
  const identity = normalizeMachineIdentity({}, {
    now,
    fallbackId: createMachineId(options.randomUUID, options.cryptoProvider),
  });
  storage?.setItem(MACHINE_IDENTITY_STORAGE_KEY, JSON.stringify(identity));
  return identity;
}

export function saveMachineIdentity(
  candidate,
  storage = globalThis.localStorage,
  options = {},
) {
  const existing = loadMachineIdentity(storage, options);
  const updated = normalizeMachineIdentity({
    ...candidate,
    machineId: candidate?.machineId ?? existing.machineId,
    createdAt: candidate?.createdAt ?? existing.createdAt,
    updatedAt: options.now ?? new Date().toISOString(),
  }, { fallbackId: existing.machineId, now: options.now });
  if (!updated.machineId) throw new Error("Machine identity is invalid.");
  storage?.setItem(MACHINE_IDENTITY_STORAGE_KEY, JSON.stringify(updated));
  return updated;
}
