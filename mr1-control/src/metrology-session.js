import {
  compensateProbeCoordinates,
  normalizeProbeDirection,
} from "./probe-calibration.js";

export const METROLOGY_STORAGE_KEY = "mr1-control.metrology-session.v1";
export const MAX_METROLOGY_POINTS = 5000;

const ANALYSIS_MODES = new Set(["auto", "circle", "plane", "line", "distance"]);
const COORDINATE_SPACES = new Set(["work", "machine"]);
const POINT_MODES = new Set(["raw", "corrected"]);
const POINT_SOURCES = new Set(["probe", "manual", "import"]);

export const DEFAULT_METROLOGY_SESSION = Object.freeze({
  version: 2,
  name: "MR-1 INSPECTION",
  coordinateSpace: "work",
  pointMode: "raw",
  captureDirection: null,
  analysisMode: "auto",
  toleranceMm: 0.02,
  nominalSizeMm: null,
  captureArmed: false,
  points: Object.freeze([]),
});

function optionalNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function finiteVector(candidate) {
  if (!candidate || typeof candidate !== "object") return null;
  const vector = {
    x: Number(candidate.x),
    y: Number(candidate.y),
    z: Number(candidate.z),
  };
  return Object.values(vector).every(Number.isFinite) ? vector : null;
}

function cleanText(value, fallback, maximumLength = 80) {
  return String(value ?? fallback)
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maximumLength) || fallback;
}

function normalizeFixtureOffset(candidate) {
  const vector = finiteVector(candidate);
  if (!vector) return null;
  return {
    ...vector,
    fixtureId: candidate.fixtureId ? cleanText(candidate.fixtureId, "", 24) : null,
  };
}

export function normalizeMetrologyPoint(candidate = {}, fallbackSequence = 1) {
  const source = POINT_SOURCES.has(candidate.source) ? candidate.source : "manual";
  const rawMachine = finiteVector(candidate.rawMachine ?? candidate.machine);
  const rawWork = finiteVector(candidate.rawWork ?? candidate.work);
  if (!rawMachine && !rawWork) return null;
  const correctedMachine = finiteVector(candidate.correctedMachine)
    ?? (source === "probe" ? null : rawMachine);
  const correctedWork = finiteVector(candidate.correctedWork)
    ?? (source === "probe" ? null : rawWork);
  const sequence = Number.isInteger(Number(candidate.sequence)) && Number(candidate.sequence) > 0
    ? Number(candidate.sequence)
    : fallbackSequence;
  const capturedAtValue = new Date(candidate.capturedAt ?? Date.now());
  const capturedAt = Number.isFinite(capturedAtValue.getTime())
    ? capturedAtValue.toISOString()
    : new Date(0).toISOString();
  const id = cleanText(candidate.id, `${source}-${sequence}-${capturedAt}`, 120);
  const direction = normalizeProbeDirection(candidate.direction);
  const compensationVector = finiteVector(candidate.compensation?.vector);
  return {
    id,
    sequence,
    source,
    capturedAt,
    rawMachine,
    rawWork,
    correctedMachine,
    correctedWork,
    machine: rawMachine,
    work: rawWork,
    direction,
    compensation: compensationVector && direction ? {
      vector: compensationVector,
      direction,
      effectiveRadiusMm: optionalNumber(candidate.compensation?.effectiveRadiusMm),
      nominalRadiusMm: optionalNumber(candidate.compensation?.nominalRadiusMm),
      triggerDeltaMm: optionalNumber(candidate.compensation?.triggerDeltaMm),
      probeId: cleanText(candidate.compensation?.probeId, "UNKNOWN", 32),
      calibratedAt: candidate.compensation?.calibratedAt ?? null,
    } : null,
    wcs: /^G(?:5[4-9](?:\.[123])?)$/i.test(String(candidate.wcs ?? ""))
      ? String(candidate.wcs).toUpperCase()
      : null,
    fixtureOffset: normalizeFixtureOffset(candidate.fixtureOffset),
  };
}

export function normalizeMetrologySession(candidate = {}) {
  const points = [];
  const ids = new Set();
  if (Array.isArray(candidate.points)) {
    for (const rawPoint of candidate.points.slice(0, MAX_METROLOGY_POINTS)) {
      const point = normalizeMetrologyPoint(rawPoint, points.length + 1);
      if (!point || ids.has(point.id)) continue;
      point.sequence = points.length + 1;
      points.push(point);
      ids.add(point.id);
    }
  }
  const tolerance = Number(candidate.toleranceMm);
  return {
    version: 2,
    name: cleanText(candidate.name, DEFAULT_METROLOGY_SESSION.name),
    coordinateSpace: COORDINATE_SPACES.has(candidate.coordinateSpace)
      ? candidate.coordinateSpace
      : DEFAULT_METROLOGY_SESSION.coordinateSpace,
    pointMode: POINT_MODES.has(candidate.pointMode)
      ? candidate.pointMode
      : DEFAULT_METROLOGY_SESSION.pointMode,
    captureDirection: normalizeProbeDirection(candidate.captureDirection),
    analysisMode: ANALYSIS_MODES.has(candidate.analysisMode)
      ? candidate.analysisMode
      : DEFAULT_METROLOGY_SESSION.analysisMode,
    toleranceMm: Number.isFinite(tolerance) && tolerance >= 0.001 && tolerance <= 5
      ? tolerance
      : DEFAULT_METROLOGY_SESSION.toleranceMm,
    nominalSizeMm: optionalNumber(candidate.nominalSizeMm),
    captureArmed: candidate.captureArmed === true,
    points,
  };
}

export function machineToWork(machineCandidate, workOffsetCandidate) {
  const machine = finiteVector(machineCandidate);
  const workOffset = finiteVector(workOffsetCandidate);
  if (!machine || !workOffset) return null;
  return {
    x: machine.x - workOffset.x,
    y: machine.y - workOffset.y,
    z: machine.z - workOffset.z,
  };
}

export function workToMachine(workCandidate, workOffsetCandidate) {
  const work = finiteVector(workCandidate);
  const workOffset = finiteVector(workOffsetCandidate);
  if (!work || !workOffset) return null;
  return {
    x: work.x + workOffset.x,
    y: work.y + workOffset.y,
    z: work.z + workOffset.z,
  };
}

export function createProbeMetrologyPoint(event, telemetry = null, options = {}) {
  if (event?.type !== "probe") throw new Error("A structured probe event is required.");
  if (event.success !== true) throw new Error("Failed probe contacts cannot be recorded as measured points.");
  const machine = finiteVector(event.position);
  if (!machine) throw new Error("Probe event does not contain a valid XYZ machine position.");
  const workOffset = finiteVector(telemetry?.position?.wco);
  const work = machineToWork(machine, workOffset);
  const direction = normalizeProbeDirection(options.direction);
  const correctedMachine = compensateProbeCoordinates(machine, direction, options.probeCalibration);
  const correctedWork = compensateProbeCoordinates(work, direction, options.probeCalibration);
  const correction = correctedMachine ?? correctedWork;
  const point = normalizeMetrologyPoint({
    id: options.id ?? `probe-${Date.now()}`,
    sequence: options.sequence ?? 1,
    source: "probe",
    capturedAt: options.capturedAt ?? Date.now(),
    rawMachine: machine,
    rawWork: work,
    correctedMachine: correctedMachine?.coordinates,
    correctedWork: correctedWork?.coordinates,
    direction,
    compensation: correction ? {
      vector: correction.compensationVector,
      direction: correction.direction,
      effectiveRadiusMm: correction.effectiveRadiusMm,
      nominalRadiusMm: correction.nominalRadiusMm,
      triggerDeltaMm: correction.triggerDeltaMm,
      probeId: correction.probeId,
      calibratedAt: correction.calibratedAt,
    } : null,
    wcs: telemetry?.workCoordinateSystem,
    fixtureOffset: options.fixtureOffset,
  });
  if (!point) throw new Error("Probe point could not be normalized.");
  return point;
}

export function createManualMetrologyPoint(position, coordinateSpace, context = {}, options = {}) {
  const coordinates = finiteVector(position);
  if (!coordinates) throw new Error("Manual point requires finite X, Y, and Z coordinates.");
  const space = COORDINATE_SPACES.has(coordinateSpace) ? coordinateSpace : "work";
  const workOffset = finiteVector(context.workOffset);
  return normalizeMetrologyPoint({
    id: options.id ?? `manual-${Date.now()}`,
    sequence: options.sequence ?? 1,
    source: "manual",
    capturedAt: options.capturedAt ?? Date.now(),
    rawMachine: space === "machine" ? coordinates : workToMachine(coordinates, workOffset),
    rawWork: space === "work" ? coordinates : machineToWork(coordinates, workOffset),
    correctedMachine: space === "machine" ? coordinates : workToMachine(coordinates, workOffset),
    correctedWork: space === "work" ? coordinates : machineToWork(coordinates, workOffset),
    wcs: context.wcs,
    fixtureOffset: context.fixtureOffset,
  });
}

export function addMetrologyPoint(sessionCandidate, pointCandidate) {
  const session = normalizeMetrologySession(sessionCandidate);
  const point = normalizeMetrologyPoint(pointCandidate, session.points.length + 1);
  if (!point) throw new Error("Point requires a valid machine or work XYZ position.");
  if (session.points.some(({ id }) => id === point.id)) return session;
  if (session.points.length >= MAX_METROLOGY_POINTS) {
    throw new Error(`Metrology sessions are limited to ${MAX_METROLOGY_POINTS.toLocaleString()} points.`);
  }
  point.sequence = session.points.length + 1;
  return { ...session, points: [...session.points, point] };
}

export function removeLastMetrologyPoint(sessionCandidate) {
  const session = normalizeMetrologySession(sessionCandidate);
  return { ...session, points: session.points.slice(0, -1) };
}

export function clearMetrologyPoints(sessionCandidate) {
  return { ...normalizeMetrologySession(sessionCandidate), points: [] };
}

export function recompensateMetrologyPoints(sessionCandidate, probeCalibration) {
  const session = normalizeMetrologySession(sessionCandidate);
  const points = session.points.map((point) => {
    if (point.source !== "probe") return point;
    const correctedMachine = compensateProbeCoordinates(point.rawMachine, point.direction, probeCalibration);
    const correctedWork = compensateProbeCoordinates(point.rawWork, point.direction, probeCalibration);
    const correction = correctedMachine ?? correctedWork;
    return normalizeMetrologyPoint({
      ...point,
      correctedMachine: correctedMachine?.coordinates ?? null,
      correctedWork: correctedWork?.coordinates ?? null,
      compensation: correction ? {
        vector: correction.compensationVector,
        direction: correction.direction,
        effectiveRadiusMm: correction.effectiveRadiusMm,
        nominalRadiusMm: correction.nominalRadiusMm,
        triggerDeltaMm: correction.triggerDeltaMm,
        probeId: correction.probeId,
        calibratedAt: correction.calibratedAt,
      } : null,
    }, point.sequence);
  });
  return { ...session, points };
}

function pointCoordinates(point, coordinateSpace, pointMode = "raw") {
  if (pointMode === "corrected") {
    return finiteVector(coordinateSpace === "machine" ? point.correctedMachine : point.correctedWork);
  }
  return finiteVector(coordinateSpace === "machine" ? point.rawMachine : point.rawWork);
}

function selectedCoordinates(points, coordinateSpace, pointMode = "raw") {
  return points
    .map((point) => ({ point, coordinates: pointCoordinates(point, coordinateSpace, pointMode) }))
    .filter(({ coordinates }) => coordinates !== null);
}

function centroid(points) {
  const total = points.reduce((sum, point) => ({
    x: sum.x + point.x,
    y: sum.y + point.y,
    z: sum.z + point.z,
  }), { x: 0, y: 0, z: 0 });
  return {
    x: total.x / points.length,
    y: total.y / points.length,
    z: total.z / points.length,
  };
}

function solve3(matrix, vector) {
  const rows = matrix.map((row, index) => [...row, vector[index]]);
  for (let column = 0; column < 3; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < 3; row += 1) {
      if (Math.abs(rows[row][column]) > Math.abs(rows[pivot][column])) pivot = row;
    }
    if (Math.abs(rows[pivot][column]) < 1e-12) return null;
    [rows[column], rows[pivot]] = [rows[pivot], rows[column]];
    const divisor = rows[column][column];
    for (let item = column; item < 4; item += 1) rows[column][item] /= divisor;
    for (let row = 0; row < 3; row += 1) {
      if (row === column) continue;
      const factor = rows[row][column];
      for (let item = column; item < 4; item += 1) rows[row][item] -= factor * rows[column][item];
    }
  }
  return rows.map((row) => row[3]);
}

function residualStats(residuals) {
  const maximum = Math.max(...residuals);
  const minimum = Math.min(...residuals);
  return {
    rmsMm: Math.sqrt(residuals.reduce((sum, value) => sum + value ** 2, 0) / residuals.length),
    maximumResidualMm: Math.max(...residuals.map(Math.abs)),
    rangeMm: maximum - minimum,
  };
}

export function fitCircleXY(pointsCandidate) {
  const points = pointsCandidate.map(finiteVector).filter(Boolean);
  if (points.length < 3) return null;
  const centerSeed = centroid(points);
  let suu = 0;
  let suv = 0;
  let svv = 0;
  let su = 0;
  let sv = 0;
  let suq = 0;
  let svq = 0;
  let sq = 0;
  for (const point of points) {
    const u = point.x - centerSeed.x;
    const v = point.y - centerSeed.y;
    const q = u ** 2 + v ** 2;
    suu += u ** 2;
    suv += u * v;
    svv += v ** 2;
    su += u;
    sv += v;
    suq += u * q;
    svq += v * q;
    sq += q;
  }
  const solved = solve3(
    [[suu, suv, su], [suv, svv, sv], [su, sv, points.length]],
    [-suq, -svq, -sq],
  );
  if (!solved) return null;
  const center = {
    x: centerSeed.x - solved[0] / 2,
    y: centerSeed.y - solved[1] / 2,
    z: centerSeed.z,
  };
  const radii = points.map((point) => Math.hypot(point.x - center.x, point.y - center.y));
  const radiusMm = radii.reduce((sum, value) => sum + value, 0) / radii.length;
  if (!Number.isFinite(radiusMm) || radiusMm < 1e-9) return null;
  const residuals = radii.map((radius) => radius - radiusMm);
  const angles = points
    .map((point) => Math.atan2(point.y - center.y, point.x - center.x))
    .sort((a, b) => a - b);
  let maximumGap = 0;
  for (let index = 1; index < angles.length; index += 1) {
    maximumGap = Math.max(maximumGap, angles[index] - angles[index - 1]);
  }
  maximumGap = Math.max(maximumGap, angles[0] + Math.PI * 2 - angles.at(-1));
  const zValues = points.map(({ z }) => z);
  return {
    type: "circle",
    pointCount: points.length,
    center,
    radiusMm,
    diameterMm: radiusMm * 2,
    angularCoverageDeg: ((Math.PI * 2 - maximumGap) * 180) / Math.PI,
    zRangeMm: Math.max(...zValues) - Math.min(...zValues),
    ...residualStats(residuals),
  };
}

export function fitLineXY(pointsCandidate) {
  const points = pointsCandidate.map(finiteVector).filter(Boolean);
  if (points.length < 2) return null;
  const center = centroid(points);
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const point of points) {
    const x = point.x - center.x;
    const y = point.y - center.y;
    sxx += x * x;
    syy += y * y;
    sxy += x * y;
  }
  const angle = Math.atan2(2 * sxy, sxx - syy) / 2;
  let direction = { x: Math.cos(angle), y: Math.sin(angle) };
  if (direction.x < 0 || (Math.abs(direction.x) < 1e-12 && direction.y < 0)) {
    direction = { x: -direction.x, y: -direction.y };
  }
  const normal = { x: -direction.y, y: direction.x };
  const residuals = points.map((point) => (
    (point.x - center.x) * normal.x + (point.y - center.y) * normal.y
  ));
  const projections = points.map((point) => (
    (point.x - center.x) * direction.x + (point.y - center.y) * direction.y
  ));
  return {
    type: "line",
    pointCount: points.length,
    center,
    direction,
    angleDeg: (Math.atan2(direction.y, direction.x) * 180) / Math.PI,
    lengthMm: Math.max(...projections) - Math.min(...projections),
    straightnessMm: Math.max(...residuals) - Math.min(...residuals),
    ...residualStats(residuals),
  };
}

function smallestEigenvectorSymmetric3(matrix) {
  const values = matrix.map((row) => [...row]);
  const vectors = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let iteration = 0; iteration < 32; iteration += 1) {
    let p = 0;
    let q = 1;
    let largest = Math.abs(values[p][q]);
    for (const [row, column] of [[0, 2], [1, 2]]) {
      if (Math.abs(values[row][column]) > largest) {
        p = row;
        q = column;
        largest = Math.abs(values[row][column]);
      }
    }
    if (largest < 1e-12) break;
    const angle = Math.atan2(2 * values[p][q], values[q][q] - values[p][p]) / 2;
    const cosine = Math.cos(angle);
    const sine = Math.sin(angle);
    const app = values[p][p];
    const aqq = values[q][q];
    const apq = values[p][q];
    values[p][p] = cosine ** 2 * app - 2 * sine * cosine * apq + sine ** 2 * aqq;
    values[q][q] = sine ** 2 * app + 2 * sine * cosine * apq + cosine ** 2 * aqq;
    values[p][q] = 0;
    values[q][p] = 0;
    for (let index = 0; index < 3; index += 1) {
      if (index === p || index === q) continue;
      const aip = values[index][p];
      const aiq = values[index][q];
      values[index][p] = cosine * aip - sine * aiq;
      values[p][index] = values[index][p];
      values[index][q] = sine * aip + cosine * aiq;
      values[q][index] = values[index][q];
    }
    for (let row = 0; row < 3; row += 1) {
      const vip = vectors[row][p];
      const viq = vectors[row][q];
      vectors[row][p] = cosine * vip - sine * viq;
      vectors[row][q] = sine * vip + cosine * viq;
    }
  }
  const eigenvalues = values.map((row, index) => row[index]);
  const minimumIndex = eigenvalues.indexOf(Math.min(...eigenvalues));
  const vector = {
    x: vectors[0][minimumIndex],
    y: vectors[1][minimumIndex],
    z: vectors[2][minimumIndex],
  };
  const magnitude = Math.hypot(vector.x, vector.y, vector.z);
  if (!Number.isFinite(magnitude) || magnitude < 1e-12) return null;
  vector.x /= magnitude;
  vector.y /= magnitude;
  vector.z /= magnitude;
  if (vector.z < 0 || (Math.abs(vector.z) < 1e-12 && vector.x < 0)) {
    vector.x *= -1;
    vector.y *= -1;
    vector.z *= -1;
  }
  return vector;
}

export function fitPlane(pointsCandidate) {
  const points = pointsCandidate.map(finiteVector).filter(Boolean);
  if (points.length < 3) return null;
  const center = centroid(points);
  const covariance = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (const point of points) {
    const delta = [point.x - center.x, point.y - center.y, point.z - center.z];
    for (let row = 0; row < 3; row += 1) {
      for (let column = row; column < 3; column += 1) {
        covariance[row][column] += delta[row] * delta[column];
        covariance[column][row] = covariance[row][column];
      }
    }
  }
  const normal = smallestEigenvectorSymmetric3(covariance);
  if (!normal) return null;
  const residuals = points.map((point) => (
    (point.x - center.x) * normal.x
      + (point.y - center.y) * normal.y
      + (point.z - center.z) * normal.z
  ));
  return {
    type: "plane",
    pointCount: points.length,
    center,
    normal,
    d: -(normal.x * center.x + normal.y * center.y + normal.z * center.z),
    flatnessMm: Math.max(...residuals) - Math.min(...residuals),
    tiltDeg: (Math.acos(Math.min(1, Math.abs(normal.z))) * 180) / Math.PI,
    azimuthDeg: (Math.atan2(normal.y, normal.x) * 180) / Math.PI,
    ...residualStats(residuals),
  };
}

export function pointDistance(firstCandidate, secondCandidate) {
  const first = finiteVector(firstCandidate);
  const second = finiteVector(secondCandidate);
  if (!first || !second) return null;
  const delta = {
    x: second.x - first.x,
    y: second.y - first.y,
    z: second.z - first.z,
  };
  return {
    type: "distance",
    pointCount: 2,
    delta,
    distanceMm: Math.hypot(delta.x, delta.y, delta.z),
  };
}

function analysisQuality(result, toleranceMm) {
  if (!result) return { score: 0, label: "UNAVAILABLE" };
  const residual = result.rmsMm ?? result.maximumResidualMm ?? 0;
  let score = Math.max(0, Math.min(1, 1 - residual / Math.max(toleranceMm, 1e-9)));
  if (result.type === "circle") {
    score *= Math.min(1, result.pointCount / 8);
    score *= Math.min(1, result.angularCoverageDeg / 270);
  } else if (result.type === "plane") score *= Math.min(1, result.pointCount / 6);
  else if (result.type === "line") score *= Math.min(1, result.pointCount / 5);
  const label = score >= 0.8 ? "HIGH" : score >= 0.5 ? "MEDIUM" : "LOW";
  return { score, label };
}

export function analyzeMetrology(sessionCandidate, options = {}) {
  const session = normalizeMetrologySession(sessionCandidate);
  const coordinateSpace = COORDINATE_SPACES.has(options.coordinateSpace)
    ? options.coordinateSpace
    : session.coordinateSpace;
  const pointMode = POINT_MODES.has(options.pointMode) ? options.pointMode : session.pointMode;
  const analysisMode = ANALYSIS_MODES.has(options.analysisMode)
    ? options.analysisMode
    : session.analysisMode;
  const selected = selectedCoordinates(session.points, coordinateSpace, pointMode);
  const points = selected.map(({ coordinates }) => coordinates);
  const toleranceMm = Number.isFinite(Number(options.toleranceMm))
    ? Number(options.toleranceMm)
    : session.toleranceMm;
  const nominalSizeMm = optionalNumber(options.nominalSizeMm ?? session.nominalSizeMm);
  const fits = {
    circle: fitCircleXY(points),
    plane: fitPlane(points),
    line: fitLineXY(points),
    distance: points.length === 2 ? pointDistance(points[0], points[1]) : null,
  };

  let recommendedMode = analysisMode;
  if (analysisMode === "auto") {
    if (points.length === 0) recommendedMode = "none";
    else if (points.length === 1) recommendedMode = "point";
    else if (points.length === 2) recommendedMode = "distance";
    else {
      const circleCandidate = fits.circle
        && points.length >= 5
        && fits.circle.angularCoverageDeg >= 220
        && fits.circle.zRangeMm <= Math.max(toleranceMm * 2, 0.05)
        && fits.circle.rmsMm <= toleranceMm
        && (!fits.line || fits.line.rmsMm > fits.circle.rmsMm * 2 + toleranceMm * 0.25);
      const lineCandidate = fits.line
        && fits.line.lengthMm >= toleranceMm * 4
        && fits.line.rmsMm <= toleranceMm;
      recommendedMode = circleCandidate ? "circle" : lineCandidate ? "line" : "plane";
    }
  }

  const result = recommendedMode === "point"
    ? { type: "point", pointCount: 1, position: points[0] }
    : fits[recommendedMode] ?? null;
  let measuredSizeMm = null;
  if (result?.type === "circle") measuredSizeMm = result.diameterMm;
  if (result?.type === "distance") measuredSizeMm = result.distanceMm;
  if (result?.type === "line") measuredSizeMm = result.lengthMm;
  const deviationMm = Number.isFinite(measuredSizeMm) && Number.isFinite(nominalSizeMm)
    ? measuredSizeMm - nominalSizeMm
    : null;
  const withinTolerance = Number.isFinite(deviationMm)
    ? Math.abs(deviationMm) <= toleranceMm
    : result?.type === "plane"
      ? result.flatnessMm <= toleranceMm
      : result?.type === "line"
        ? result.straightnessMm <= toleranceMm
        : null;

  return {
    coordinateSpace,
    pointMode,
    requestedMode: analysisMode,
    recommendedMode,
    pointCount: points.length,
    excludedPointCount: session.points.length - points.length,
    toleranceMm,
    nominalSizeMm,
    measuredSizeMm,
    deviationMm,
    withinTolerance,
    result,
    fits,
    quality: analysisQuality(result, toleranceMm),
  };
}

function exportRows(sessionCandidate, coordinateSpace, pointMode) {
  const session = normalizeMetrologySession(sessionCandidate);
  const selectedMode = POINT_MODES.has(pointMode) ? pointMode : session.pointMode;
  return selectedCoordinates(session.points, coordinateSpace, selectedMode).map(({ point, coordinates }) => ({
    point,
    coordinates,
  }));
}

export function exportMetrologyCsv(sessionCandidate, coordinateSpace = "work") {
  const session = normalizeMetrologySession(sessionCandidate);
  const rows = session.points.map((point) => ({
    point,
    raw: pointCoordinates(point, coordinateSpace, "raw"),
    corrected: pointCoordinates(point, coordinateSpace, "corrected"),
  })).filter(({ raw, corrected }) => raw || corrected);
  const header = "sequence,id,source,captured_at,wcs,space,direction,probe_id,raw_x_mm,raw_y_mm,raw_z_mm,corrected_x_mm,corrected_y_mm,corrected_z_mm";
  return [header, ...rows.map(({ point, raw, corrected }) => [
    point.sequence,
    JSON.stringify(point.id),
    point.source,
    point.capturedAt,
    point.wcs ?? "",
    coordinateSpace,
    point.direction ?? "",
    point.compensation?.probeId ?? "",
    raw?.x.toFixed(6) ?? "",
    raw?.y.toFixed(6) ?? "",
    raw?.z.toFixed(6) ?? "",
    corrected?.x.toFixed(6) ?? "",
    corrected?.y.toFixed(6) ?? "",
    corrected?.z.toFixed(6) ?? "",
  ].join(","))].join("\n");
}

export function exportMetrologyXyz(sessionCandidate, coordinateSpace = "work", pointMode) {
  return exportRows(sessionCandidate, coordinateSpace, pointMode)
    .map(({ coordinates }) => `${coordinates.x.toFixed(6)} ${coordinates.y.toFixed(6)} ${coordinates.z.toFixed(6)}`)
    .join("\n");
}

export function exportMetrologyPly(sessionCandidate, coordinateSpace = "work", pointMode) {
  const rows = exportRows(sessionCandidate, coordinateSpace, pointMode);
  const header = [
    "ply",
    "format ascii 1.0",
    "comment MR-1 metrology points / millimeters",
    `element vertex ${rows.length}`,
    "property float x",
    "property float y",
    "property float z",
    "end_header",
  ];
  return [...header, ...rows.map(({ coordinates }) => (
    `${coordinates.x.toFixed(6)} ${coordinates.y.toFixed(6)} ${coordinates.z.toFixed(6)}`
  ))].join("\n");
}

export function exportMetrologyJson(sessionCandidate) {
  return JSON.stringify(normalizeMetrologySession(sessionCandidate), null, 2);
}

export function loadMetrologySession(storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem(METROLOGY_STORAGE_KEY);
    return normalizeMetrologySession(raw ? JSON.parse(raw) : DEFAULT_METROLOGY_SESSION);
  } catch {
    return normalizeMetrologySession(DEFAULT_METROLOGY_SESSION);
  }
}

export function saveMetrologySession(session, storage = globalThis.localStorage) {
  const normalized = normalizeMetrologySession(session);
  storage?.setItem(METROLOGY_STORAGE_KEY, JSON.stringify(normalized));
  return normalized;
}
