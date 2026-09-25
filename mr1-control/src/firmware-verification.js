export const FIRMWARE_FLASH_RECORD_FORMAT = "mr1-octopus-flash-record";
export const FIRMWARE_FLASH_RECORD_SCHEMA_VERSION = 1;
export const MAX_FIRMWARE_FILE_BYTES = 2 * 1024 * 1024;
export const FIRMWARE_PREFLIGHT_MAX_AGE_MS = 15 * 60 * 1000;

const PREFLIGHT_CLOCK_SKEW_MS = 30 * 1000;

export const FIRMWARE_FLASH_ATTESTATIONS = Object.freeze([
  Object.freeze({
    id: "board_identity",
    title: "BOARD + MCU PHOTOGRAPHED",
    detail: "The actual silkscreen says OCTOPUS PRO V1.1 and the MCU says STM32F429ZGT6.",
  }),
  Object.freeze({
    id: "bare_board",
    title: "BARE-BOARD FLASH PROVED",
    detail: "MAIN, MOTOR, BED, drivers, adapters, I/O, field power, machine wiring, and USB were absent before fitting the MCU-power jumper.",
  }),
  Object.freeze({
    id: "bootloader_rename",
    title: "BOOTLOADER RENAME OBSERVED",
    detail: "The selected FIRMWARE.CUR came from the microSD immediately after the BTT bootloader operation and was not manually renamed.",
  }),
  Object.freeze({
    id: "jumper_removed",
    title: "USB-POWER JUMPER REMOVED",
    detail: "USB was disconnected and the temporary MCU-power jumper was removed before installation, 24V MAIN, or any machine wiring.",
  }),
]);

function hex(bytes) {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("").toUpperCase();
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalValue(value[key])]));
}

function canonicalJson(value) {
  return JSON.stringify(canonicalValue(value));
}

async function sha256Bytes(bytes, cryptoProvider = globalThis.crypto) {
  if (!cryptoProvider?.subtle) throw new Error("SHA-256 verification is unavailable in this browser.");
  return hex(new Uint8Array(await cryptoProvider.subtle.digest("SHA-256", bytes)));
}

async function sha256Text(value, cryptoProvider = globalThis.crypto) {
  return sha256Bytes(new TextEncoder().encode(String(value)), cryptoProvider);
}

function normalizedFilename(value) {
  return String(value ?? "").trim().replaceAll("\\", "/").split("/").at(-1) ?? "";
}

function normalizedAttestations(candidate = {}) {
  return Object.fromEntries(FIRMWARE_FLASH_ATTESTATIONS.map(({ id }) => [id, candidate[id] === true]));
}

function exactHash(value) {
  const hash = String(value ?? "").trim().toUpperCase();
  return /^[0-9A-F]{64}$/.test(hash) ? hash : null;
}

function evaluatePhysicalPreflight(preflight, candidate, now = Date.now()) {
  const expectedProtocol = String(candidate?.preflightProtocol ?? "").trim();
  const expectedProfile = String(candidate?.preflightProfile ?? "").trim();
  const capturedAt = Date.parse(String(preflight?.capturedAt ?? ""));
  const nowMs = Number(now);
  const ageMs = Number.isFinite(capturedAt) && Number.isFinite(nowMs) ? nowMs - capturedAt : null;
  const counts = preflight?.counts ?? {};
  const settingsExpected = Number(counts.settingsExpected);
  const settingsPassed = Number(counts.settingsPassed);
  const maxAgeMs = Number.isFinite(Number(candidate?.preflightMaxAgeMs))
    ? Number(candidate.preflightMaxAgeMs)
    : FIRMWARE_PREFLIGHT_MAX_AGE_MS;
  const checks = Object.freeze({
    reportPassed: preflight?.preflightPassed === true,
    nonsimulated: preflight?.simulated === false,
    protocol: Boolean(expectedProtocol) && preflight?.protocol === expectedProtocol,
    profile: Boolean(expectedProfile) && preflight?.profile === expectedProfile,
    boardIdentity: preflight?.boardIdentityPresent === true,
    reportAvailable: preflight?.reportAvailable === true,
    fingerprint: exactHash(preflight?.transcriptSha256) !== null,
    serialSource: /^serial:[^@\r\n]+@\d+$/i.test(String(preflight?.source ?? "")),
    settingsExact: Number.isInteger(settingsExpected)
      && settingsExpected > 0
      && settingsPassed === settingsExpected
      && Number(counts.blockers) === 0
      && Number(counts.warnings) === 0,
    inputsClear: String(preflight?.activePins ?? "") === "",
    safeState: /^(?:Idle|Alarm)(?::.*)?$/i.test(String(preflight?.machineState ?? "")),
    fresh: ageMs !== null && ageMs >= -PREFLIGHT_CLOCK_SKEW_MS && ageMs <= maxAgeMs,
  });
  const passed = Object.values(checks).every(Boolean);
  const status = !preflight
    ? "OFFLINE"
    : !checks.nonsimulated
      ? "SIM / REJECTED"
      : !checks.protocol
        ? "PROTOCOL / REJECTED"
        : !checks.profile
          ? "PROFILE / REJECTED"
          : !checks.serialSource
            ? "SOURCE / REJECTED"
            : !checks.boardIdentity
              ? "BOARD / REJECTED"
              : !checks.reportPassed
                ? "PREFLIGHT / BLOCKED"
                : !checks.reportAvailable || !checks.fingerprint
                  ? "REPORT / REJECTED"
                  : !checks.settingsExact
                    ? "SETTINGS / REJECTED"
                    : !checks.inputsClear
                      ? "INPUTS / REJECTED"
                      : !checks.safeState
                        ? "STATE / REJECTED"
                        : !checks.fresh
                          ? "STALE / REJECTED"
                          : "PHYSICAL PASS";
  return Object.freeze({ passed, checks, status, ageMs, maxAgeMs });
}

export async function verifyFirmwareCandidateFile(file, candidate, cryptoProvider = globalThis.crypto) {
  if (!file || typeof file.arrayBuffer !== "function") throw new Error("Choose a local firmware file first.");
  const filename = normalizedFilename(file.name);
  const bytes = Number(file.size);
  if (!filename || !Number.isInteger(bytes) || bytes < 0) throw new Error("The selected file metadata is invalid.");

  const expectedBytes = Number(candidate?.bytes);
  const expectedSha256 = exactHash(candidate?.sha256);
  if (!Number.isInteger(expectedBytes) || expectedBytes <= 0 || !expectedSha256) {
    throw new Error("The firmware candidate contract is invalid.");
  }

  const filenameUpper = filename.toUpperCase();
  const sourceUpper = String(candidate.filename ?? "firmware.bin").toUpperCase();
  const successUpper = String(candidate.successFilename ?? "FIRMWARE.CUR").toUpperCase();
  const fileRole = filenameUpper === successUpper
    ? "card-result"
    : filenameUpper === sourceUpper
      ? "source-image"
      : "unexpected-name";
  const byteCountMatches = bytes === expectedBytes;
  let sha256 = null;
  let sha256Matches = false;

  if (bytes <= MAX_FIRMWARE_FILE_BYTES) {
    const buffer = await file.arrayBuffer();
    if (!(buffer instanceof ArrayBuffer) || buffer.byteLength !== bytes) {
      throw new Error("The selected file changed while it was being read.");
    }
    sha256 = await sha256Bytes(buffer, cryptoProvider);
    sha256Matches = sha256 === expectedSha256;
  }

  const contentVerified = byteCountMatches && sha256Matches;
  const sourceReady = contentVerified && fileRole === "source-image";
  const cardResultVerified = contentVerified && fileRole === "card-result";
  const errors = [];
  if (bytes > MAX_FIRMWARE_FILE_BYTES) errors.push("FILE EXCEEDS THE 2 MIB VERIFICATION LIMIT");
  if (!byteCountMatches) errors.push(`EXPECTED ${expectedBytes.toLocaleString("en-US")} BYTES`);
  if (sha256 && !sha256Matches) errors.push("SHA-256 DOES NOT MATCH THE PRODUCTION CANDIDATE");
  if (contentVerified && fileRole === "unexpected-name") errors.push(`RENAME TO ${candidate.filename} BEFORE FLASHING`);

  const status = cardResultVerified
    ? "CARD RESULT VERIFIED / CONTENT EXACT"
    : sourceReady
      ? "SOURCE IMAGE VERIFIED / READY TO COPY"
      : contentVerified
        ? `CONTENT VERIFIED / RENAME TO ${candidate.filename}`
        : errors[0] ?? "FIRMWARE VERIFICATION FAILED";

  return Object.freeze({
    candidateId: String(candidate.candidateId ?? ""),
    filename,
    bytes,
    sha256,
    fileRole,
    byteCountMatches,
    sha256Matches,
    contentVerified,
    sourceReady,
    cardResultVerified,
    status,
    errors: Object.freeze(errors),
    lastModified: Number.isFinite(Number(file.lastModified)) && Number(file.lastModified) > 0
      ? new Date(Number(file.lastModified)).toISOString()
      : null,
    physicalFlashVerified: false,
    physicalMotionPermitted: false,
  });
}

export function evaluateFirmwareFlashEvidence({ verification, attestations, preflight, candidate, now } = {}) {
  const normalized = normalizedAttestations(attestations);
  const attestationCount = Object.values(normalized).filter(Boolean).length;
  const preflightEvaluation = evaluatePhysicalPreflight(preflight, candidate, now);
  const gates = Object.freeze({
    exactContent: verification?.contentVerified === true,
    bootloaderResult: verification?.cardResultVerified === true,
    operatorAttestations: attestationCount === FIRMWARE_FLASH_ATTESTATIONS.length,
    physicalPreflight: preflightEvaluation.passed,
  });
  const passed = Object.values(gates).filter(Boolean).length;
  const total = Object.keys(gates).length;
  return Object.freeze({
    gates,
    attestations: Object.freeze(normalized),
    attestationCount,
    preflight: preflightEvaluation,
    passed,
    total,
    readyToArchive: passed === total,
    physicalFlashVerified: passed === total,
    physicalMotionPermitted: false,
    status: passed === total ? "FLASH EVIDENCE READY TO ARCHIVE / MOTION LOCKED" : `${passed} OF ${total} FLASH RECORD GATES`,
  });
}

export async function createFirmwareFlashRecord({
  verification,
  attestations,
  preflight,
  candidate,
  machine = {},
  createdAt = new Date().toISOString(),
} = {}, cryptoProvider = globalThis.crypto) {
  const evaluation = evaluateFirmwareFlashEvidence({ verification, attestations, preflight, candidate });
  if (!evaluation.readyToArchive) throw new Error("All flash evidence gates must pass before creating a record.");
  if (verification?.candidateId !== candidate?.candidateId || verification?.sha256 !== exactHash(candidate?.sha256)) {
    throw new Error("Firmware verification does not match the active candidate.");
  }

  const payload = {
    format: FIRMWARE_FLASH_RECORD_FORMAT,
    schemaVersion: FIRMWARE_FLASH_RECORD_SCHEMA_VERSION,
    createdAt: new Date(createdAt).toISOString(),
    candidate: {
      candidateId: candidate.candidateId,
      board: candidate.board,
      mcu: candidate.mcu,
      crystalHz: candidate.crystalHz,
      applicationAddress: candidate.applicationAddress,
      bytes: candidate.bytes,
      sha256: candidate.sha256,
      preflightProtocol: candidate.preflightProtocol,
      preflightProfile: candidate.preflightProfile,
      preflightMaxAgeMs: candidate.preflightMaxAgeMs,
    },
    cardResult: {
      filename: verification.filename,
      bytes: verification.bytes,
      sha256: verification.sha256,
      lastModified: verification.lastModified,
    },
    operatorAttestations: FIRMWARE_FLASH_ATTESTATIONS.map(({ id, title }) => ({
      id,
      title,
      confirmed: evaluation.attestations[id],
    })),
    controllerPreflight: {
      protocol: String(preflight.protocol ?? ""),
      profile: String(preflight.profile ?? ""),
      source: String(preflight.source ?? ""),
      capturedAt: preflight.capturedAt ?? null,
      transcriptSha256: exactHash(preflight.transcriptSha256),
      boardIdentityPresent: true,
      reportAvailable: true,
      machineState: String(preflight.machineState ?? ""),
      activePins: String(preflight.activePins ?? ""),
      queryPolicy: String(preflight.queryPolicy ?? ""),
      counts: {
        settingsPassed: Number(preflight.counts?.settingsPassed),
        settingsExpected: Number(preflight.counts?.settingsExpected),
        blockers: Number(preflight.counts?.blockers),
        warnings: Number(preflight.counts?.warnings),
      },
      preflightPassed: true,
      simulated: false,
    },
    machine: {
      id: String(machine.id ?? "").trim() || null,
      name: String(machine.name ?? "").trim().slice(0, 64) || null,
    },
    evidenceStatus: "ARCHIVED OPERATOR EVIDENCE / PHYSICAL COMMISSIONING STILL REQUIRED",
    physicalMotionPermitted: false,
  };
  const digest = await sha256Text(canonicalJson(payload), cryptoProvider);
  return Object.freeze({
    ...payload,
    integrity: Object.freeze({ algorithm: "SHA-256", digest }),
  });
}

export async function verifyFirmwareFlashRecord(record, cryptoProvider = globalThis.crypto) {
  if (record?.format !== FIRMWARE_FLASH_RECORD_FORMAT || record?.schemaVersion !== FIRMWARE_FLASH_RECORD_SCHEMA_VERSION) {
    return false;
  }
  const digest = exactHash(record?.integrity?.digest);
  if (!digest || record.integrity.algorithm !== "SHA-256") return false;
  const { integrity: _integrity, ...payload } = record;
  return digest === await sha256Text(canonicalJson(payload), cryptoProvider);
}
