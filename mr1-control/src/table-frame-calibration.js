import { MR1_CONFIG } from "./machine-config.js";

const PROFILE_VERSION = 1;
const EPSILON = 1e-12;
const MAX_REFERENCES = 32;

export const DEFAULT_TABLE_FRAME_CALIBRATION = Object.freeze({
  version: PROFILE_VERSION,
  id: "PLATE-FRAME-1",
  probeId: "",
  calibratedAt: null,
  quality: Object.freeze({
    minimumReferences: 4,
    minimumTopSamples: 3,
    minimumCoverageRatio: 0.15,
    ransacThresholdMm: 0.25,
    maximumRmsErrorMm: 0.05,
    maximumPointErrorMm: 0.1,
    maximumOutlierRatio: 0.2,
    maximumScaleErrorPpm: 500,
    maximumTopRmsErrorMm: 0.03,
    maximumTopPointErrorMm: 0.06,
    maximumTiltDeg: 0.05,
  }),
  references: Object.freeze([]),
});

function cleanText(value, fallback, maximumLength) {
  const normalized = String(value ?? "").trim().replace(/\s+/g, " ");
  return (normalized || fallback).slice(0, maximumLength);
}

function optionalNumber(value) {
  if (value === "" || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function boundedNumber(value, fallback, minimum, maximum) {
  const number = Number(value);
  return Number.isFinite(number) && number >= minimum && number <= maximum ? number : fallback;
}

function boundedInteger(value, fallback, minimum, maximum) {
  const number = Number(value);
  return Number.isInteger(number) && number >= minimum && number <= maximum ? number : fallback;
}

function optionalTimestamp(value) {
  const timestamp = Number(value);
  return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : null;
}

function normalizePoint(candidate) {
  const x = optionalNumber(candidate?.x);
  const y = optionalNumber(candidate?.y);
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

function normalizeReference(candidate, index) {
  const cad = normalizePoint(candidate?.cad);
  const machine = normalizePoint(candidate?.machine);
  const address = cleanText(candidate?.address, "", 5).toUpperCase();
  if (!cad || !machine || !address) return null;
  return {
    id: cleanText(candidate?.id, `plate-ref-${index + 1}`, 48),
    address,
    cad,
    machine,
    topZ: optionalNumber(candidate?.topZ),
    source: ["manual", "probe", "import"].includes(candidate?.source) ? candidate.source : "manual",
    measuredAt: optionalTimestamp(candidate?.measuredAt),
  };
}

export function normalizeTableFrameCalibration(candidate = {}) {
  const source = candidate && typeof candidate === "object" ? candidate : {};
  const quality = source.quality && typeof source.quality === "object" ? source.quality : {};
  return {
    version: PROFILE_VERSION,
    id: cleanText(source.id, DEFAULT_TABLE_FRAME_CALIBRATION.id, 48),
    probeId: cleanText(source.probeId, "", 32),
    calibratedAt: optionalTimestamp(source.calibratedAt),
    quality: {
      minimumReferences: boundedInteger(
        quality.minimumReferences,
        DEFAULT_TABLE_FRAME_CALIBRATION.quality.minimumReferences,
        3,
        16,
      ),
      minimumTopSamples: boundedInteger(
        quality.minimumTopSamples,
        DEFAULT_TABLE_FRAME_CALIBRATION.quality.minimumTopSamples,
        3,
        16,
      ),
      minimumCoverageRatio: boundedNumber(
        quality.minimumCoverageRatio,
        DEFAULT_TABLE_FRAME_CALIBRATION.quality.minimumCoverageRatio,
        0.01,
        1,
      ),
      ransacThresholdMm: boundedNumber(
        quality.ransacThresholdMm,
        DEFAULT_TABLE_FRAME_CALIBRATION.quality.ransacThresholdMm,
        0.005,
        5,
      ),
      maximumRmsErrorMm: boundedNumber(
        quality.maximumRmsErrorMm,
        DEFAULT_TABLE_FRAME_CALIBRATION.quality.maximumRmsErrorMm,
        0.001,
        5,
      ),
      maximumPointErrorMm: boundedNumber(
        quality.maximumPointErrorMm,
        DEFAULT_TABLE_FRAME_CALIBRATION.quality.maximumPointErrorMm,
        0.001,
        10,
      ),
      maximumOutlierRatio: boundedNumber(
        quality.maximumOutlierRatio,
        DEFAULT_TABLE_FRAME_CALIBRATION.quality.maximumOutlierRatio,
        0,
        0.5,
      ),
      maximumScaleErrorPpm: boundedNumber(
        quality.maximumScaleErrorPpm,
        DEFAULT_TABLE_FRAME_CALIBRATION.quality.maximumScaleErrorPpm,
        1,
        100000,
      ),
      maximumTopRmsErrorMm: boundedNumber(
        quality.maximumTopRmsErrorMm,
        DEFAULT_TABLE_FRAME_CALIBRATION.quality.maximumTopRmsErrorMm,
        0.001,
        5,
      ),
      maximumTopPointErrorMm: boundedNumber(
        quality.maximumTopPointErrorMm,
        DEFAULT_TABLE_FRAME_CALIBRATION.quality.maximumTopPointErrorMm,
        0.001,
        10,
      ),
      maximumTiltDeg: boundedNumber(
        quality.maximumTiltDeg,
        DEFAULT_TABLE_FRAME_CALIBRATION.quality.maximumTiltDeg,
        0.001,
        5,
      ),
    },
    references: (Array.isArray(source.references) ? source.references : [])
      .slice(0, MAX_REFERENCES)
      .map(normalizeReference)
      .filter(Boolean),
  };
}

function convexHull(points) {
  if (points.length < 3) return points;
  const sorted = [...points].sort((left, right) => left.x - right.x || left.y - right.y);
  const cross = (origin, a, b) => (a.x - origin.x) * (b.y - origin.y)
    - (a.y - origin.y) * (b.x - origin.x);
  const lower = [];
  for (const point of sorted) {
    while (lower.length >= 2 && cross(lower.at(-2), lower.at(-1), point) <= 0) lower.pop();
    lower.push(point);
  }
  const upper = [];
  for (const point of [...sorted].reverse()) {
    while (upper.length >= 2 && cross(upper.at(-2), upper.at(-1), point) <= 0) upper.pop();
    upper.push(point);
  }
  lower.pop();
  upper.pop();
  return [...lower, ...upper];
}

function polygonArea(points) {
  if (points.length < 3) return 0;
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const next = points[(index + 1) % points.length];
    area += points[index].x * next.y - next.x * points[index].y;
  }
  return Math.abs(area) / 2;
}

function fitRigidTransform(pairs) {
  if (pairs.length < 2) throw new Error("At least two separated XY references are required.");
  const cadCenter = pairs.reduce((sum, pair) => ({
    x: sum.x + pair.cad.x,
    y: sum.y + pair.cad.y,
  }), { x: 0, y: 0 });
  const machineCenter = pairs.reduce((sum, pair) => ({
    x: sum.x + pair.machine.x,
    y: sum.y + pair.machine.y,
  }), { x: 0, y: 0 });
  cadCenter.x /= pairs.length;
  cadCenter.y /= pairs.length;
  machineCenter.x /= pairs.length;
  machineCenter.y /= pairs.length;

  let dot = 0;
  let cross = 0;
  let cadVariance = 0;
  let machineVariance = 0;
  for (const pair of pairs) {
    const cadX = pair.cad.x - cadCenter.x;
    const cadY = pair.cad.y - cadCenter.y;
    const machineX = pair.machine.x - machineCenter.x;
    const machineY = pair.machine.y - machineCenter.y;
    dot += cadX * machineX + cadY * machineY;
    cross += cadX * machineY - cadY * machineX;
    cadVariance += cadX ** 2 + cadY ** 2;
    machineVariance += machineX ** 2 + machineY ** 2;
  }
  if (cadVariance < EPSILON || machineVariance < EPSILON) throw new Error("XY reference geometry has no usable spread.");
  const radians = Math.atan2(cross, dot);
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const x = machineCenter.x - (cadCenter.x * cosine - cadCenter.y * sine);
  const y = machineCenter.y - (cadCenter.x * sine + cadCenter.y * cosine);
  return {
    x,
    y,
    rotationDeg: radians * 180 / Math.PI,
    scale: Math.sqrt(machineVariance / cadVariance),
  };
}

function projectRigid(transform, point) {
  const radians = transform.rotationDeg * Math.PI / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  return {
    x: transform.x + point.x * cosine - point.y * sine,
    y: transform.y + point.x * sine + point.y * cosine,
  };
}

function rigidResiduals(transform, pairs) {
  return pairs.map((pair, index) => {
    const projected = projectRigid(transform, pair.cad);
    return {
      index,
      id: pair.id,
      address: pair.address,
      projected,
      errorMm: Math.hypot(projected.x - pair.machine.x, projected.y - pair.machine.y),
    };
  });
}

function solveRobustRigid(pairs, thresholdMm) {
  let best = null;
  for (let left = 0; left < pairs.length - 1; left += 1) {
    for (let right = left + 1; right < pairs.length; right += 1) {
      try {
        const transform = fitRigidTransform([pairs[left], pairs[right]]);
        const residuals = rigidResiduals(transform, pairs);
        const inlierIndexes = residuals.filter(({ errorMm }) => errorMm <= thresholdMm).map(({ index }) => index);
        if (inlierIndexes.length < 2) continue;
        const rms = Math.sqrt(inlierIndexes.reduce((sum, index) => sum + residuals[index].errorMm ** 2, 0)
          / inlierIndexes.length);
        if (!best || inlierIndexes.length > best.inlierIndexes.length
          || (inlierIndexes.length === best.inlierIndexes.length && rms < best.rms)) {
          best = { inlierIndexes, rms };
        }
      } catch {
        // Coincident or unusable two-point samples are skipped.
      }
    }
  }
  if (!best) throw new Error("XY reference geometry cannot produce a rigid transform.");
  let inlierIndexes = best.inlierIndexes;
  let transform = fitRigidTransform(inlierIndexes.map((index) => pairs[index]));
  for (let pass = 0; pass < 2; pass += 1) {
    const next = rigidResiduals(transform, pairs)
      .filter(({ errorMm }) => errorMm <= thresholdMm)
      .map(({ index }) => index);
    if (next.length < 2 || next.join(":") === inlierIndexes.join(":")) break;
    inlierIndexes = next;
    transform = fitRigidTransform(inlierIndexes.map((index) => pairs[index]));
  }
  transform = fitRigidTransform(inlierIndexes.map((index) => pairs[index]));
  const inlierSet = new Set(inlierIndexes);
  const residuals = rigidResiduals(transform, pairs).map((residual) => ({
    ...residual,
    inlier: inlierSet.has(residual.index),
  }));
  const inliers = residuals.filter(({ inlier }) => inlier);
  const rmsErrorMm = Math.sqrt(inliers.reduce((sum, residual) => sum + residual.errorMm ** 2, 0) / inliers.length);
  return {
    ...transform,
    residuals,
    inlierIndexes,
    inlierCount: inliers.length,
    outlierCount: pairs.length - inliers.length,
    outlierRatio: (pairs.length - inliers.length) / pairs.length,
    rmsErrorMm,
    maximumErrorMm: Math.max(...inliers.map(({ errorMm }) => errorMm)),
    scaleErrorPpm: (transform.scale - 1) * 1e6,
  };
}

function solveLinear3(matrix, vector) {
  const rows = matrix.map((row, index) => [...row, vector[index]]);
  for (let column = 0; column < 3; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < 3; row += 1) {
      if (Math.abs(rows[row][column]) > Math.abs(rows[pivot][column])) pivot = row;
    }
    if (Math.abs(rows[pivot][column]) < EPSILON) throw new Error("Top-plane samples are degenerate.");
    [rows[column], rows[pivot]] = [rows[pivot], rows[column]];
    const divisor = rows[column][column];
    for (let index = column; index <= 3; index += 1) rows[column][index] /= divisor;
    for (let row = 0; row < 3; row += 1) {
      if (row === column) continue;
      const factor = rows[row][column];
      for (let index = column; index <= 3; index += 1) rows[row][index] -= factor * rows[column][index];
    }
  }
  return rows.map((row) => row[3]);
}

function fitTopPlane(pairs) {
  if (pairs.length < 3) throw new Error("At least three top-plane samples are required.");
  const normal = Array.from({ length: 3 }, () => Array(3).fill(0));
  const right = Array(3).fill(0);
  for (const pair of pairs) {
    const row = [1, pair.cad.x, pair.cad.y];
    for (let left = 0; left < 3; left += 1) {
      right[left] += row[left] * pair.topZ;
      for (let column = 0; column < 3; column += 1) normal[left][column] += row[left] * row[column];
    }
  }
  const [z, slopeX, slopeY] = solveLinear3(normal, right);
  const residuals = pairs.map((pair) => ({
    id: pair.id,
    address: pair.address,
    errorMm: pair.topZ - (z + slopeX * pair.cad.x + slopeY * pair.cad.y),
  }));
  const rmsErrorMm = Math.sqrt(residuals.reduce((sum, residual) => sum + residual.errorMm ** 2, 0)
    / residuals.length);
  return {
    z,
    slopeX,
    slopeY,
    tiltXDeg: Math.atan(slopeX) * 180 / Math.PI,
    tiltYDeg: Math.atan(slopeY) * 180 / Math.PI,
    resultantTiltDeg: Math.atan(Math.hypot(slopeX, slopeY)) * 180 / Math.PI,
    rmsErrorMm,
    maximumErrorMm: Math.max(...residuals.map(({ errorMm }) => Math.abs(errorMm))),
    rangeMm: Math.max(...pairs.map(({ topZ }) => topZ)) - Math.min(...pairs.map(({ topZ }) => topZ)),
    residuals,
    sampleCount: pairs.length,
  };
}

function duplicateAddresses(references) {
  const seen = new Set();
  const duplicates = new Set();
  for (const reference of references) {
    if (seen.has(reference.address)) duplicates.add(reference.address);
    seen.add(reference.address);
  }
  return [...duplicates];
}

function insideMachineEnvelope(reference) {
  return ["x", "y"].every((axis) => {
    const envelope = MR1_CONFIG.machineEnvelope[axis];
    return reference.machine[axis] >= envelope.min && reference.machine[axis] <= envelope.max;
  }) && (!Number.isFinite(reference.topZ)
    || (reference.topZ >= MR1_CONFIG.machineEnvelope.z.min && reference.topZ <= MR1_CONFIG.machineEnvelope.z.max));
}

export function evaluateTableFrameCalibration(candidate, options = {}) {
  const profile = normalizeTableFrameCalibration(candidate);
  const errors = [];
  const warnings = [];
  const duplicates = duplicateAddresses(profile.references);
  if (duplicates.length) errors.push(`Duplicate plate references: ${duplicates.join(", ")}.`);
  const outside = profile.references.filter((reference) => !insideMachineEnvelope(reference));
  if (outside.length) errors.push(`${outside.length} plate reference${outside.length === 1 ? " is" : "s are"} outside machine travel.`);

  let xy = null;
  if (!errors.length && profile.references.length >= 2) {
    try {
      xy = solveRobustRigid(profile.references, profile.quality.ransacThresholdMm);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "XY table-frame solve failed.");
    }
  }
  const topPairs = xy
    ? xy.inlierIndexes.map((index) => profile.references[index]).filter(({ topZ }) => Number.isFinite(topZ))
    : [];
  let top = null;
  if (!errors.length && topPairs.length >= 3) {
    try {
      top = fitTopPlane(topPairs);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "Top-plane solve failed.");
    }
  }

  const inlierCad = xy ? xy.inlierIndexes.map((index) => profile.references[index].cad) : [];
  const coverageRatio = polygonArea(convexHull(inlierCad))
    / (MR1_CONFIG.fixturePlate.width * MR1_CONFIG.fixturePlate.depth);
  if (xy && xy.inlierCount < profile.quality.minimumReferences) {
    warnings.push(`Use at least ${profile.quality.minimumReferences} distributed XY references.`);
  }
  if (xy && coverageRatio < profile.quality.minimumCoverageRatio) warnings.push("XY references cover too little of the plate.");
  if (xy?.outlierCount) warnings.push(`${xy.outlierCount} XY reference${xy.outlierCount === 1 ? " is" : "s are"} rejected as an outlier.`);
  if (xy && xy.outlierRatio > profile.quality.maximumOutlierRatio) warnings.push("XY outlier ratio exceeds the calibration limit.");
  if (xy && xy.rmsErrorMm > profile.quality.maximumRmsErrorMm) warnings.push("XY RMS residual exceeds the calibration limit.");
  if (xy && xy.maximumErrorMm > profile.quality.maximumPointErrorMm) warnings.push("An XY inlier exceeds the point-residual limit.");
  if (xy && Math.abs(xy.scaleErrorPpm) > profile.quality.maximumScaleErrorPpm) {
    warnings.push("Measured hole spacing disagrees with CAD; check axis scale, squareness, probe calibration, and the plate model.");
  }
  if (topPairs.length < profile.quality.minimumTopSamples) {
    warnings.push(`Use at least ${profile.quality.minimumTopSamples} distributed plate-top samples.`);
  }
  if (top && top.rmsErrorMm > profile.quality.maximumTopRmsErrorMm) warnings.push("Top-plane RMS residual exceeds the calibration limit.");
  if (top && top.maximumErrorMm > profile.quality.maximumTopPointErrorMm) warnings.push("A top-plane sample exceeds the point-residual limit.");
  if (top && top.resultantTiltDeg > profile.quality.maximumTiltDeg) {
    warnings.push("Plate tilt exceeds the limit; tram the machine instead of absorbing tilt into work offsets.");
  }

  const mathematicallySolved = Boolean(xy && top) && !errors.length;
  const qualified = mathematicallySolved
    && xy.inlierCount >= profile.quality.minimumReferences
    && coverageRatio >= profile.quality.minimumCoverageRatio
    && xy.outlierRatio <= profile.quality.maximumOutlierRatio
    && xy.rmsErrorMm <= profile.quality.maximumRmsErrorMm
    && xy.maximumErrorMm <= profile.quality.maximumPointErrorMm
    && Math.abs(xy.scaleErrorPpm) <= profile.quality.maximumScaleErrorPpm
    && top.sampleCount >= profile.quality.minimumTopSamples
    && top.rmsErrorMm <= profile.quality.maximumTopRmsErrorMm
    && top.maximumErrorMm <= profile.quality.maximumTopPointErrorMm
    && top.resultantTiltDeg <= profile.quality.maximumTiltDeg;
  const probeQualified = options.probeQualified === true;
  const machineHomed = options.machineHomed === true;
  return {
    profile,
    xy,
    top,
    frame: mathematicallySolved ? {
      x: xy.x,
      y: xy.y,
      z: top.z,
      rotationDeg: xy.rotationDeg,
    } : null,
    coverageRatio,
    errors,
    warnings,
    mathematicallySolved,
    qualified,
    probeQualified,
    machineHomed,
    readyToApply: qualified && probeQualified && machineHomed,
    status: errors.length
      ? "INVALID"
      : qualified
        ? probeQualified && machineHomed ? "READY TO APPLY" : "EVIDENCE REQUIRED"
        : mathematicallySolved ? "PROVISIONAL" : `${profile.references.length} OF ${profile.quality.minimumReferences}`,
  };
}

export function addTableFrameReference(candidate, reference, now = Date.now()) {
  const profile = normalizeTableFrameCalibration(candidate);
  const normalized = normalizeReference({ ...reference, measuredAt: reference?.measuredAt ?? now }, profile.references.length);
  if (!normalized) throw new Error("A CAD point, machine XY center, and fixture-hole address are required.");
  return normalizeTableFrameCalibration({
    ...profile,
    calibratedAt: null,
    references: [...profile.references.filter(({ address }) => address !== normalized.address), normalized],
  });
}

export function removeTableFrameReference(candidate, id) {
  const profile = normalizeTableFrameCalibration(candidate);
  return normalizeTableFrameCalibration({
    ...profile,
    calibratedAt: null,
    references: profile.references.filter((reference) => reference.id !== id),
  });
}

export function clearTableFrameReferences(candidate) {
  const profile = normalizeTableFrameCalibration(candidate);
  return normalizeTableFrameCalibration({ ...profile, calibratedAt: null, references: [] });
}

export function finalizeTableFrameCalibration(candidate, options = {}) {
  const evaluation = evaluateTableFrameCalibration(candidate, options);
  if (!evaluation.readyToApply) {
    const reason = evaluation.errors[0]
      ?? evaluation.warnings[0]
      ?? (!evaluation.probeQualified ? "A qualified probe is required." : null)
      ?? (!evaluation.machineHomed ? "Machine homing confirmation is required." : null)
      ?? "Table-frame calibration is not ready to apply.";
    throw new Error(reason);
  }
  return normalizeTableFrameCalibration({
    ...evaluation.profile,
    probeId: cleanText(options.probeId, evaluation.profile.probeId, 32),
    calibratedAt: Number.isFinite(Number(options.now)) ? Number(options.now) : Date.now(),
  });
}

export function tableCalibrationFrameMatches(calibration, frame, tolerance = 1e-6) {
  const evaluation = evaluateTableFrameCalibration(calibration);
  if (!evaluation.qualified || !evaluation.frame) return false;
  return ["x", "y", "z", "rotationDeg"].every((key) => (
    Number.isFinite(frame?.[key]) && Math.abs(evaluation.frame[key] - frame[key]) <= tolerance
  ));
}
