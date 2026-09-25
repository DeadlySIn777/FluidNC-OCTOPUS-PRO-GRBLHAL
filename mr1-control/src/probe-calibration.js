export const PROBE_CALIBRATION_STORAGE_KEY = "mr1-control.probe-calibration.v1";

export const PROBE_DIRECTIONS = Object.freeze(["+x", "-x", "+y", "-y", "+z", "-z"]);

export const PROBE_DIRECTION_VECTORS = Object.freeze({
  "+x": Object.freeze({ x: 1, y: 0, z: 0 }),
  "-x": Object.freeze({ x: -1, y: 0, z: 0 }),
  "+y": Object.freeze({ x: 0, y: 1, z: 0 }),
  "-y": Object.freeze({ x: 0, y: -1, z: 0 }),
  "+z": Object.freeze({ x: 0, y: 0, z: 1 }),
  "-z": Object.freeze({ x: 0, y: 0, z: -1 }),
});

export const DEFAULT_PROBE_CALIBRATION = Object.freeze({
  version: 1,
  probeId: "P1",
  probeName: "PRIMARY TOUCH PROBE",
  ballDiameterMm: null,
  stylusLengthMm: null,
  tipOffsetMm: Object.freeze({ x: null, y: null, z: null }),
  effectiveRadiusMm: Object.freeze(Object.fromEntries(PROBE_DIRECTIONS.map((direction) => [direction, null]))),
  repeatabilityMm: null,
  repeatabilityLimitMm: 0.01,
  sampleCount: null,
  calibratedAt: null,
  validForDays: 30,
  artifact: Object.freeze({ type: "ring", id: "", nominalSizeMm: null }),
});

const ARTIFACT_TYPES = new Set(["ring", "sphere", "pin", "plane"]);

function optionalNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function cleanText(value, fallback, maximumLength = 80) {
  return String(value ?? fallback)
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maximumLength) || fallback;
}

function boundedNumber(value, minimum, maximum) {
  const number = optionalNumber(value);
  return number !== null && number >= minimum && number <= maximum ? number : null;
}

function normalizeDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

export function normalizeProbeDirection(value) {
  const direction = String(value ?? "").toLowerCase();
  return PROBE_DIRECTIONS.includes(direction) ? direction : null;
}

export function normalizeProbeCalibration(candidate = {}) {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) candidate = {};
  const ballDiameterMm = boundedNumber(candidate.ballDiameterMm, 0.2, 30);
  const nominalRadius = ballDiameterMm === null ? null : ballDiameterMm / 2;
  const radiusMaximum = nominalRadius === null ? 20 : nominalRadius + 2;
  const effectiveRadiusMm = Object.fromEntries(PROBE_DIRECTIONS.map((direction) => [
    direction,
    boundedNumber(candidate.effectiveRadiusMm?.[direction], 0.05, radiusMaximum),
  ]));
  const validForDays = boundedNumber(candidate.validForDays, 1, 365) ?? 30;
  const artifactType = ARTIFACT_TYPES.has(candidate.artifact?.type)
    ? candidate.artifact.type
    : DEFAULT_PROBE_CALIBRATION.artifact.type;
  const sampleCount = boundedNumber(candidate.sampleCount, 2, 1000);
  return {
    version: 1,
    probeId: cleanText(candidate.probeId, DEFAULT_PROBE_CALIBRATION.probeId, 32),
    probeName: cleanText(candidate.probeName, DEFAULT_PROBE_CALIBRATION.probeName),
    ballDiameterMm,
    stylusLengthMm: boundedNumber(candidate.stylusLengthMm, 1, 500),
    tipOffsetMm: {
      x: boundedNumber(candidate.tipOffsetMm?.x, -100, 100),
      y: boundedNumber(candidate.tipOffsetMm?.y, -100, 100),
      z: boundedNumber(candidate.tipOffsetMm?.z, -500, 500),
    },
    effectiveRadiusMm,
    repeatabilityMm: boundedNumber(candidate.repeatabilityMm, 0, 1),
    repeatabilityLimitMm: boundedNumber(candidate.repeatabilityLimitMm, 0.001, 0.5) ?? 0.01,
    sampleCount: sampleCount === null ? null : Math.trunc(sampleCount),
    calibratedAt: normalizeDate(candidate.calibratedAt),
    validForDays,
    artifact: {
      type: artifactType,
      id: cleanText(candidate.artifact?.id, "", 48),
      nominalSizeMm: boundedNumber(candidate.artifact?.nominalSizeMm, 0.1, 2000),
    },
  };
}

export function evaluateProbeCalibration(candidate = {}, options = {}) {
  const profile = normalizeProbeCalibration(candidate);
  const now = new Date(options.now ?? Date.now());
  const calibratedAt = profile.calibratedAt ? new Date(profile.calibratedAt) : null;
  const ageDays = calibratedAt && Number.isFinite(now.getTime())
    ? (now.getTime() - calibratedAt.getTime()) / 86_400_000
    : null;
  const definitionReady = profile.ballDiameterMm !== null
    && profile.stylusLengthMm !== null
    && Object.values(profile.tipOffsetMm).every((value) => value !== null);
  const artifactReady = profile.artifact.id !== "" && profile.artifact.nominalSizeMm !== null;
  const resultRecorded = profile.repeatabilityMm !== null && profile.sampleCount !== null;
  const repeatabilityReady = resultRecorded && profile.repeatabilityMm <= profile.repeatabilityLimitMm;
  const resultReady = resultRecorded && repeatabilityReady;
  const dateReady = ageDays !== null && ageDays >= -1 / 24 && ageDays <= profile.validForDays;
  const readyDirections = definitionReady && artifactReady && resultReady && dateReady
    ? PROBE_DIRECTIONS.filter((direction) => profile.effectiveRadiusMm[direction] !== null)
    : [];
  const reasons = [];
  if (!definitionReady) reasons.push("PROBE DEFINITION INCOMPLETE");
  if (!artifactReady) reasons.push("REFERENCE ARTIFACT INCOMPLETE");
  if (!resultRecorded) reasons.push("REPEATABILITY RECORD INCOMPLETE");
  else if (!repeatabilityReady) reasons.push("REPEATABILITY EXCEEDS LIMIT");
  if (!profile.calibratedAt) reasons.push("CALIBRATION DATE REQUIRED");
  else if (!dateReady) reasons.push(ageDays > profile.validForDays ? "CALIBRATION EXPIRED" : "CALIBRATION DATE INVALID");
  if (readyDirections.length === 0 && reasons.length === 0) reasons.push("NO DIRECTION IS CALIBRATED");
  return {
    profile,
    definitionReady,
    artifactReady,
    resultReady,
    repeatabilityReady,
    dateReady,
    ageDays,
    readyDirections,
    qualified: readyDirections.length === PROBE_DIRECTIONS.length,
    usable: readyDirections.length > 0,
    reasons,
  };
}

export function compensateProbeCoordinates(rawCandidate, directionCandidate, profileCandidate) {
  const raw = {
    x: Number(rawCandidate?.x),
    y: Number(rawCandidate?.y),
    z: Number(rawCandidate?.z),
  };
  if (!Object.values(raw).every(Number.isFinite)) return null;
  const direction = normalizeProbeDirection(directionCandidate);
  if (!direction) return null;
  const evaluation = evaluateProbeCalibration(profileCandidate);
  if (!evaluation.readyDirections.includes(direction)) return null;
  const radius = evaluation.profile.effectiveRadiusMm[direction];
  const vector = PROBE_DIRECTION_VECTORS[direction];
  const offset = evaluation.profile.tipOffsetMm;
  return {
    coordinates: {
      x: raw.x + offset.x + vector.x * radius,
      y: raw.y + offset.y + vector.y * radius,
      z: raw.z + offset.z + vector.z * radius,
    },
    compensationVector: {
      x: offset.x + vector.x * radius,
      y: offset.y + vector.y * radius,
      z: offset.z + vector.z * radius,
    },
    direction,
    effectiveRadiusMm: radius,
    nominalRadiusMm: evaluation.profile.ballDiameterMm / 2,
    triggerDeltaMm: evaluation.profile.ballDiameterMm / 2 - radius,
    probeId: evaluation.profile.probeId,
    calibratedAt: evaluation.profile.calibratedAt,
  };
}

export function loadProbeCalibration(storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem(PROBE_CALIBRATION_STORAGE_KEY);
    return normalizeProbeCalibration(raw ? JSON.parse(raw) : DEFAULT_PROBE_CALIBRATION);
  } catch {
    return normalizeProbeCalibration(DEFAULT_PROBE_CALIBRATION);
  }
}

export function saveProbeCalibration(profile, storage = globalThis.localStorage) {
  const normalized = normalizeProbeCalibration(profile);
  storage?.setItem(PROBE_CALIBRATION_STORAGE_KEY, JSON.stringify(normalized));
  return normalized;
}
