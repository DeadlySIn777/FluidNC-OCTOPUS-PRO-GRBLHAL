import { MR1_CONFIG } from "./machine-config.js";
import {
  addressToCad,
  columnLabel,
  evaluateFixtureMapProfile,
  fixtureLayout,
  viseFootprintForOpening,
} from "./fixture-map-profile.js";

// Keep the original key so version-1 browser profiles migrate into the held version-2 model.
export const SCENE_REGISTRATION_STORAGE_KEY = "mr1.scene-registration.v1";
const PROFILE_VERSION = 2;
const EPSILON = 1e-10;
const MAX_REFERENCES = 160;
const MAX_HYPOTHESES = 100;
const MAX_RANSAC_ITERATIONS = 512;

export const SCENE_FEATURE_TYPES = Object.freeze({
  "top-plane": Object.freeze({ label: "TOP PLANE", contacts: 5, cycle: "MULTI-POINT +Z PLANE" }),
  "outside-contour": Object.freeze({ label: "OUTSIDE CONTOUR", contacts: 12, cycle: "OPPOSED XY WALLS" }),
  bore: Object.freeze({ label: "BORE", contacts: 12, cycle: "12-POINT INTERNAL CIRCLE" }),
  hole: Object.freeze({ label: "HOLE", contacts: 8, cycle: "8-POINT INTERNAL CIRCLE" }),
  pocket: Object.freeze({ label: "POCKET", contacts: 16, cycle: "XY WALLS + FLOOR" }),
  boss: Object.freeze({ label: "BOSS", contacts: 12, cycle: "12-POINT EXTERNAL CIRCLE" }),
});

export const DEFAULT_SCENE_REGISTRATION_PROFILE = Object.freeze({
  version: PROFILE_VERSION,
  camera: Object.freeze({
    id: "CAM-OVERHEAD-1",
    name: "OVERHEAD CAMERA",
    width: 1920,
    height: 1080,
    lensProfileId: "",
    intrinsicsCalibrated: false,
  }),
  quality: Object.freeze({
    minimumReferences: 8,
    minimumCoverageRatio: 0.15,
    maximumRmsErrorPx: 1,
    maximumPointErrorPx: 2.5,
    ransacThresholdPx: 2.5,
    maximumOutlierRatio: 0.2,
    maximumAgeMinutes: 60,
  }),
  frame: null,
  references: Object.freeze([]),
  hypotheses: Object.freeze([]),
  solvedAt: null,
});

function cleanText(value, fallback, maximumLength) {
  const normalized = String(value ?? "").trim().replace(/\s+/g, " ");
  return (normalized || fallback).slice(0, maximumLength);
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

function normalizePixel(candidate) {
  const x = Number(candidate?.x);
  const y = Number(candidate?.y);
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

export function normalizeSceneFrame(candidate) {
  if (!candidate || typeof candidate !== "object") return null;
  const fingerprint = cleanText(candidate.fingerprint, "", 160).toLowerCase();
  const width = boundedInteger(candidate.width, null, 160, 16384);
  const height = boundedInteger(candidate.height, null, 120, 16384);
  if (!fingerprint || !width || !height) return null;
  return {
    fingerprint,
    sourceName: cleanText(candidate.sourceName, "CAMERA FRAME", 120),
    width,
    height,
    capturedAt: optionalTimestamp(candidate.capturedAt),
    boundAt: optionalTimestamp(candidate.boundAt),
  };
}

export function sceneFramesMatch(left, right) {
  const normalizedLeft = normalizeSceneFrame(left);
  const normalizedRight = normalizeSceneFrame(right);
  return Boolean(normalizedLeft && normalizedRight)
    && normalizedLeft.fingerprint === normalizedRight.fingerprint
    && normalizedLeft.width === normalizedRight.width
    && normalizedLeft.height === normalizedRight.height;
}

function normalizeReference(candidate, index, fixtureProfile) {
  const address = cleanText(candidate?.address, "", 5).toUpperCase();
  const cad = addressToCad(address, fixtureProfile?.grid);
  const pixel = normalizePixel(candidate?.pixel ?? candidate);
  if (!cad || !pixel) return null;
  return {
    id: cleanText(candidate?.id, `ref-${index + 1}`, 48),
    address,
    pixel,
    source: ["manual", "detector", "import"].includes(candidate?.source) ? candidate.source : "manual",
  };
}

function normalizeHypothesis(candidate, index) {
  const type = Object.hasOwn(SCENE_FEATURE_TYPES, candidate?.type) ? candidate.type : null;
  const pixel = normalizePixel(candidate?.pixel ?? candidate);
  if (!type || !pixel) return null;
  return {
    id: cleanText(candidate?.id, `feature-${index + 1}`, 48),
    type,
    label: cleanText(candidate?.label, SCENE_FEATURE_TYPES[type].label, 64),
    pixel,
    estimatedSizeMm: Number.isFinite(Number(candidate?.estimatedSizeMm))
      ? boundedNumber(candidate.estimatedSizeMm, null, 0.001, 5000)
      : null,
    confidence: Number.isFinite(Number(candidate?.confidence))
      ? boundedNumber(candidate.confidence, null, 0, 1)
      : null,
    source: ["manual", "detector", "import"].includes(candidate?.source) ? candidate.source : "manual",
  };
}

export function normalizeSceneRegistrationProfile(candidate = {}, fixtureProfile = null) {
  const source = candidate && typeof candidate === "object" ? candidate : {};
  const cameraSource = source.camera && typeof source.camera === "object" ? source.camera : {};
  const qualitySource = source.quality && typeof source.quality === "object" ? source.quality : {};
  const references = (Array.isArray(source.references) ? source.references : [])
    .slice(0, MAX_REFERENCES)
    .map((reference, index) => normalizeReference(reference, index, fixtureProfile))
    .filter(Boolean);
  const hypotheses = (Array.isArray(source.hypotheses) ? source.hypotheses : [])
    .slice(0, MAX_HYPOTHESES)
    .map(normalizeHypothesis)
    .filter(Boolean);

  return {
    version: PROFILE_VERSION,
    camera: {
      id: cleanText(cameraSource.id, DEFAULT_SCENE_REGISTRATION_PROFILE.camera.id, 32),
      name: cleanText(cameraSource.name, DEFAULT_SCENE_REGISTRATION_PROFILE.camera.name, 80),
      width: boundedInteger(cameraSource.width, DEFAULT_SCENE_REGISTRATION_PROFILE.camera.width, 160, 16384),
      height: boundedInteger(cameraSource.height, DEFAULT_SCENE_REGISTRATION_PROFILE.camera.height, 120, 16384),
      lensProfileId: cleanText(cameraSource.lensProfileId, "", 64),
      intrinsicsCalibrated: cameraSource.intrinsicsCalibrated === true,
    },
    quality: {
      minimumReferences: boundedInteger(
        qualitySource.minimumReferences,
        DEFAULT_SCENE_REGISTRATION_PROFILE.quality.minimumReferences,
        4,
        64,
      ),
      minimumCoverageRatio: boundedNumber(
        qualitySource.minimumCoverageRatio,
        DEFAULT_SCENE_REGISTRATION_PROFILE.quality.minimumCoverageRatio,
        0.01,
        1,
      ),
      maximumRmsErrorPx: boundedNumber(
        qualitySource.maximumRmsErrorPx,
        DEFAULT_SCENE_REGISTRATION_PROFILE.quality.maximumRmsErrorPx,
        0.01,
        50,
      ),
      maximumPointErrorPx: boundedNumber(
        qualitySource.maximumPointErrorPx,
        DEFAULT_SCENE_REGISTRATION_PROFILE.quality.maximumPointErrorPx,
        0.01,
        100,
      ),
      ransacThresholdPx: boundedNumber(
        qualitySource.ransacThresholdPx,
        DEFAULT_SCENE_REGISTRATION_PROFILE.quality.ransacThresholdPx,
        0.1,
        100,
      ),
      maximumOutlierRatio: boundedNumber(
        qualitySource.maximumOutlierRatio,
        DEFAULT_SCENE_REGISTRATION_PROFILE.quality.maximumOutlierRatio,
        0,
        0.5,
      ),
      maximumAgeMinutes: boundedNumber(
        qualitySource.maximumAgeMinutes,
        DEFAULT_SCENE_REGISTRATION_PROFILE.quality.maximumAgeMinutes,
        1,
        1440,
      ),
    },
    frame: normalizeSceneFrame(source.frame),
    references,
    hypotheses,
    solvedAt: optionalTimestamp(source.solvedAt),
  };
}

function multiply3(left, right) {
  const output = Array(9).fill(0);
  for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column < 3; column += 1) {
      for (let index = 0; index < 3; index += 1) {
        output[row * 3 + column] += left[row * 3 + index] * right[index * 3 + column];
      }
    }
  }
  return output;
}

function invert3(matrix) {
  const [a, b, c, d, e, f, g, h, i] = matrix;
  const determinant = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  if (!Number.isFinite(determinant) || Math.abs(determinant) < EPSILON) return null;
  return [
    e * i - f * h,
    c * h - b * i,
    b * f - c * e,
    f * g - d * i,
    a * i - c * g,
    c * d - a * f,
    d * h - e * g,
    b * g - a * h,
    a * e - b * d,
  ].map((value) => value / determinant);
}

function normalizePointSet(points) {
  const center = points.reduce((sum, point) => ({ x: sum.x + point.x, y: sum.y + point.y }), { x: 0, y: 0 });
  center.x /= points.length;
  center.y /= points.length;
  const meanDistance = points.reduce((sum, point) => sum + Math.hypot(point.x - center.x, point.y - center.y), 0)
    / points.length;
  if (!Number.isFinite(meanDistance) || meanDistance < EPSILON) throw new Error("Reference points have no usable spread.");
  const scale = Math.SQRT2 / meanDistance;
  return {
    points: points.map((point) => ({ x: (point.x - center.x) * scale, y: (point.y - center.y) * scale })),
    transform: [scale, 0, -scale * center.x, 0, scale, -scale * center.y, 0, 0, 1],
  };
}

function solveLinearSystem(matrix, vector) {
  const size = vector.length;
  const rows = matrix.map((row, index) => [...row, vector[index]]);
  for (let column = 0; column < size; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < size; row += 1) {
      if (Math.abs(rows[row][column]) > Math.abs(rows[pivot][column])) pivot = row;
    }
    if (Math.abs(rows[pivot][column]) < EPSILON) throw new Error("Reference geometry is degenerate.");
    [rows[column], rows[pivot]] = [rows[pivot], rows[column]];
    const divisor = rows[column][column];
    for (let index = column; index <= size; index += 1) rows[column][index] /= divisor;
    for (let row = 0; row < size; row += 1) {
      if (row === column) continue;
      const factor = rows[row][column];
      for (let index = column; index <= size; index += 1) rows[row][index] -= factor * rows[column][index];
    }
  }
  return rows.map((row) => row[size]);
}

function leastSquares(rows, values) {
  const columns = rows[0].length;
  const normal = Array.from({ length: columns }, () => Array(columns).fill(0));
  const right = Array(columns).fill(0);
  for (let row = 0; row < rows.length; row += 1) {
    for (let left = 0; left < columns; left += 1) {
      right[left] += rows[row][left] * values[row];
      for (let column = 0; column < columns; column += 1) {
        normal[left][column] += rows[row][left] * rows[row][column];
      }
    }
  }
  return solveLinearSystem(normal, right);
}

export function projectHomography(matrix, point) {
  if (!Array.isArray(matrix) || matrix.length !== 9 || !Number.isFinite(point?.x) || !Number.isFinite(point?.y)) {
    return null;
  }
  const denominator = matrix[6] * point.x + matrix[7] * point.y + matrix[8];
  if (!Number.isFinite(denominator) || Math.abs(denominator) < EPSILON) return null;
  return {
    x: (matrix[0] * point.x + matrix[1] * point.y + matrix[2]) / denominator,
    y: (matrix[3] * point.x + matrix[4] * point.y + matrix[5]) / denominator,
  };
}

function convexHull(points) {
  if (points.length < 3) return points;
  const sorted = [...points].sort((left, right) => left.x - right.x || left.y - right.y);
  const cross = (origin, a, b) => (a.x - origin.x) * (b.y - origin.y) - (a.y - origin.y) * (b.x - origin.x);
  const lower = [];
  for (const point of sorted) {
    while (lower.length >= 2 && cross(lower.at(-2), lower.at(-1), point) <= 0) lower.pop();
    lower.push(point);
  }
  const upper = [];
  for (const point of sorted.reverse()) {
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

export function pointInConvexPolygon(point, polygon, tolerance = 1e-7) {
  if (!Number.isFinite(point?.x) || !Number.isFinite(point?.y) || !Array.isArray(polygon) || polygon.length < 3) {
    return false;
  }
  let direction = 0;
  for (let index = 0; index < polygon.length; index += 1) {
    const current = polygon[index];
    const next = polygon[(index + 1) % polygon.length];
    const cross = (next.x - current.x) * (point.y - current.y)
      - (next.y - current.y) * (point.x - current.x);
    if (Math.abs(cross) <= tolerance) continue;
    const sign = Math.sign(cross);
    if (!direction) direction = sign;
    else if (direction !== sign) return false;
  }
  return true;
}

function referencePairs(references, fixtureProfile) {
  if (!Array.isArray(references) || references.length < 4) {
    throw new Error("At least four fixture-hole references are required.");
  }
  return references.map((reference) => {
    const cad = addressToCad(reference.address, fixtureProfile?.grid);
    const pixel = normalizePixel(reference.pixel);
    if (!cad || !pixel) throw new Error(`Reference ${reference.address ?? "--"} is invalid.`);
    return { id: reference.id, address: reference.address, cad, pixel };
  });
}

function fitHomographyPairs(pairs) {
  const source = normalizePointSet(pairs.map(({ cad }) => cad));
  const destination = normalizePointSet(pairs.map(({ pixel }) => pixel));
  const rows = [];
  const values = [];
  for (let index = 0; index < pairs.length; index += 1) {
    const { x, y } = source.points[index];
    const { x: u, y: v } = destination.points[index];
    rows.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    values.push(u);
    rows.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    values.push(v);
  }
  const coefficients = leastSquares(rows, values);
  const normalizedMatrix = [...coefficients, 1];
  const destinationInverse = invert3(destination.transform);
  if (!destinationInverse) throw new Error("Pixel normalization could not be inverted.");
  let matrix = multiply3(multiply3(destinationInverse, normalizedMatrix), source.transform);
  if (Math.abs(matrix[8]) < EPSILON) throw new Error("Registration transform is singular.");
  matrix = matrix.map((value) => value / matrix[8]);
  const inverse = invert3(matrix);
  if (!inverse) throw new Error("Registration transform cannot be inverted.");
  return { matrix, inverse };
}

function homographyResiduals(matrix, pairs) {
  return pairs.map((pair, index) => {
    const projected = projectHomography(matrix, pair.cad);
    const errorPx = projected ? Math.hypot(projected.x - pair.pixel.x, projected.y - pair.pixel.y) : Infinity;
    return {
      index,
      id: pair.id,
      address: pair.address,
      cad: pair.cad,
      observed: pair.pixel,
      projected,
      errorPx,
    };
  });
}

function referenceSeed(pairs) {
  let seed = 2166136261;
  for (const pair of pairs) {
    for (const character of pair.address) {
      seed ^= character.charCodeAt(0);
      seed = Math.imul(seed, 16777619);
    }
  }
  return seed >>> 0 || 0x6d2b79f5;
}

function ransacSamples(pairs) {
  const count = pairs.length;
  if (count === 4) return [[0, 1, 2, 3]];
  const samples = [];
  const seen = new Set();
  const add = (sample) => {
    const sorted = [...new Set(sample)].sort((left, right) => left - right);
    if (sorted.length !== 4) return;
    const key = sorted.join(":");
    if (seen.has(key)) return;
    seen.add(key);
    samples.push(sorted);
  };
  add([0, Math.round((count - 1) / 3), Math.round((count - 1) * 2 / 3), count - 1]);

  if (count <= 12) {
    for (let a = 0; a < count - 3; a += 1) {
      for (let b = a + 1; b < count - 2; b += 1) {
        for (let c = b + 1; c < count - 1; c += 1) {
          for (let d = c + 1; d < count; d += 1) add([a, b, c, d]);
        }
      }
    }
    return samples;
  }

  let seed = referenceSeed(pairs);
  const randomIndex = () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return (seed >>> 0) % count;
  };
  let attempts = 0;
  while (samples.length < MAX_RANSAC_ITERATIONS && attempts < MAX_RANSAC_ITERATIONS * 40) {
    add([randomIndex(), randomIndex(), randomIndex(), randomIndex()]);
    attempts += 1;
  }
  return samples;
}

function betterRansacCandidate(candidate, best) {
  if (!best) return true;
  if (candidate.inlierIndexes.length !== best.inlierIndexes.length) {
    return candidate.inlierIndexes.length > best.inlierIndexes.length;
  }
  if (Math.abs(candidate.rmsErrorPx - best.rmsErrorPx) > EPSILON) {
    return candidate.rmsErrorPx < best.rmsErrorPx;
  }
  return candidate.coverage > best.coverage;
}

export function solveFixtureHomography(references, fixtureProfile = null, options = {}) {
  const pairs = referencePairs(references, fixtureProfile);
  const thresholdPx = boundedNumber(
    options.ransacThresholdPx,
    DEFAULT_SCENE_REGISTRATION_PROFILE.quality.ransacThresholdPx,
    0.1,
    100,
  );
  let best = null;
  for (const sample of ransacSamples(pairs)) {
    try {
      const fitted = fitHomographyPairs(sample.map((index) => pairs[index]));
      const residuals = homographyResiduals(fitted.matrix, pairs);
      const inlierIndexes = residuals.filter(({ errorPx }) => errorPx <= thresholdPx).map(({ index }) => index);
      if (inlierIndexes.length < 4) continue;
      const rmsErrorPx = Math.sqrt(inlierIndexes.reduce((sum, index) => sum + residuals[index].errorPx ** 2, 0)
        / inlierIndexes.length);
      const coverage = polygonArea(convexHull(inlierIndexes.map((index) => pairs[index].cad)));
      const candidate = { ...fitted, inlierIndexes, rmsErrorPx, coverage };
      if (betterRansacCandidate(candidate, best)) best = candidate;
    } catch {
      // Degenerate four-point samples are expected and are not evidence of a usable fit.
    }
  }
  if (!best) throw new Error("Reference geometry is degenerate.");

  let inlierIndexes = best.inlierIndexes;
  let fitted = best;
  for (let pass = 0; pass < 3; pass += 1) {
    fitted = fitHomographyPairs(inlierIndexes.map((index) => pairs[index]));
    const residuals = homographyResiduals(fitted.matrix, pairs);
    const next = residuals.filter(({ errorPx }) => errorPx <= thresholdPx).map(({ index }) => index);
    if (next.length < 4 || next.join(":") === inlierIndexes.join(":")) break;
    inlierIndexes = next;
  }
  fitted = fitHomographyPairs(inlierIndexes.map((index) => pairs[index]));

  const inlierSet = new Set(inlierIndexes);
  const residuals = homographyResiduals(fitted.matrix, pairs).map((residual) => ({
    ...residual,
    inlier: inlierSet.has(residual.index),
  }));
  const inlierResiduals = residuals.filter(({ inlier }) => inlier);
  const rmsErrorPx = Math.sqrt(inlierResiduals.reduce((sum, residual) => sum + residual.errorPx ** 2, 0)
    / inlierResiduals.length);
  const maximumErrorPx = Math.max(...inlierResiduals.map(({ errorPx }) => errorPx));
  const allRmsErrorPx = Math.sqrt(residuals.reduce((sum, residual) => sum + residual.errorPx ** 2, 0)
    / residuals.length);
  const maximumResidualPx = Math.max(...residuals.map(({ errorPx }) => errorPx));
  const hull = convexHull(inlierIndexes.map((index) => pairs[index].cad));
  const coverageRatio = polygonArea(hull) / (MR1_CONFIG.fixturePlate.width * MR1_CONFIG.fixturePlate.depth);
  const outlierCount = pairs.length - inlierIndexes.length;
  return {
    kind: "plate-plane-homography",
    matrix: fitted.matrix,
    inverse: fitted.inverse,
    residuals,
    rmsErrorPx,
    maximumErrorPx,
    allRmsErrorPx,
    maximumResidualPx,
    coverageRatio,
    hull,
    referenceCount: pairs.length,
    inlierCount: inlierIndexes.length,
    outlierCount,
    outlierRatio: outlierCount / pairs.length,
    ransacThresholdPx: thresholdPx,
  };
}

function frameCalibrated(fixtureProfile) {
  return evaluateFixtureMapProfile(fixtureProfile).frameCalibrated;
}

export function platePointToMachine(point, fixtureProfile) {
  if (!Number.isFinite(point?.x) || !Number.isFinite(point?.y) || !frameCalibrated(fixtureProfile)) return null;
  const frame = fixtureProfile.plateFrame;
  const radians = (Number(frame.rotationDeg) || 0) * Math.PI / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  return {
    x: frame.x + point.x * cosine - point.y * sine,
    y: frame.y + point.x * sine + point.y * cosine,
    z: frame.z,
  };
}

export function pixelToRegisteredPoint(pixel, solution, fixtureProfile) {
  const plate = projectHomography(solution?.inverse, pixel);
  if (!plate) return null;
  const scale = registrationScaleAtPixel(pixel, solution);
  return {
    plate,
    machine: platePointToMachine(plate, fixtureProfile),
    insideCalibrationHull: pointInConvexPolygon(plate, solution?.hull),
    scaleMmPerPixel: scale,
    residualEstimateMm: Number.isFinite(scale?.maximum) && Number.isFinite(solution?.rmsErrorPx)
      ? scale.maximum * solution.rmsErrorPx
      : null,
  };
}

export function registrationScaleAtPixel(pixel, solution) {
  const origin = projectHomography(solution?.inverse, pixel);
  const alongX = projectHomography(solution?.inverse, { x: pixel?.x + 1, y: pixel?.y });
  const alongY = projectHomography(solution?.inverse, { x: pixel?.x, y: pixel?.y + 1 });
  if (!origin || !alongX || !alongY) return null;
  const x = Math.hypot(alongX.x - origin.x, alongX.y - origin.y);
  const y = Math.hypot(alongY.x - origin.x, alongY.y - origin.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y, maximum: Math.max(x, y), mean: (x + y) / 2 };
}

function duplicateValues(items, selector) {
  const seen = new Set();
  const duplicates = new Set();
  for (const item of items) {
    const value = selector(item);
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates];
}

export function evaluateSceneRegistrationProfile(candidate, fixtureProfile = null, options = {}) {
  const profile = normalizeSceneRegistrationProfile(candidate, fixtureProfile);
  const errors = [];
  const warnings = [];
  const addresses = duplicateValues(profile.references, ({ address }) => address);
  if (addresses.length) errors.push(`Duplicate fixture references: ${addresses.join(", ")}.`);
  const duplicatePixels = duplicateValues(profile.references, ({ pixel }) => `${pixel.x.toFixed(4)}:${pixel.y.toFixed(4)}`);
  if (duplicatePixels.length) errors.push("Two fixture references use the same pixel coordinate.");
  if (fixtureProfile?.grid) {
    const visibleAddresses = new Set(visibleFixtureReferences(fixtureProfile).map(({ address }) => address));
    const masked = profile.references.filter(({ address }) => !visibleAddresses.has(address));
    if (masked.length) errors.push(`Fixture references hidden by registered workholding: ${masked.map(({ address }) => address).join(", ")}.`);
  }
  const outside = profile.references.filter(({ pixel }) => (
    pixel.x < 0 || pixel.y < 0 || pixel.x > profile.camera.width || pixel.y > profile.camera.height
  ));
  if (outside.length) errors.push(`${outside.length} reference point${outside.length === 1 ? " is" : "s are"} outside the camera frame.`);

  let solution = null;
  if (!errors.length && profile.references.length >= 4) {
    try {
      solution = solveFixtureHomography(profile.references, fixtureProfile, {
        ransacThresholdPx: profile.quality.ransacThresholdPx,
      });
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "Registration solve failed.");
    }
  }
  if (solution && solution.inlierCount < profile.quality.minimumReferences) {
    warnings.push(`Use at least ${profile.quality.minimumReferences} distributed fixture references.`);
  }
  if (solution && solution.coverageRatio < profile.quality.minimumCoverageRatio) {
    warnings.push("Reference-hole coverage is too concentrated on the plate.");
  }
  if (solution && solution.rmsErrorPx > profile.quality.maximumRmsErrorPx) {
    warnings.push("RMS reprojection error exceeds the camera profile limit.");
  }
  if (solution && solution.maximumErrorPx > profile.quality.maximumPointErrorPx) {
    warnings.push("At least one inlier fixture reference exceeds the point-error limit.");
  }
  if (solution?.outlierCount) {
    warnings.push(`${solution.outlierCount} fixture reference${solution.outlierCount === 1 ? " is" : "s are"} rejected as an outlier.`);
  }
  if (solution && solution.outlierRatio > profile.quality.maximumOutlierRatio) {
    warnings.push("The rejected-reference ratio exceeds the registration limit.");
  }
  if (!frameCalibrated(fixtureProfile)) warnings.push("Fixture plate MPOS frame is required for machine coordinates.");
  if (profile.camera.intrinsicsCalibrated && !profile.camera.lensProfileId) {
    warnings.push("A verified lens profile ID is required for calibrated intrinsics.");
  } else if (!profile.camera.intrinsicsCalibrated) {
    warnings.push("Lens intrinsics are uncalibrated; this solution is plate-plane XY only.");
  }

  const activeFrame = normalizeSceneFrame(options.activeFrame);
  const frameBound = Boolean(profile.frame);
  const framePresent = Boolean(activeFrame);
  const frameMatches = sceneFramesMatch(profile.frame, activeFrame)
    && profile.camera.width === activeFrame?.width
    && profile.camera.height === activeFrame?.height;
  const now = Number.isFinite(Number(options.now)) ? Number(options.now) : Date.now();
  const calibrationAgeMinutes = profile.solvedAt ? (now - profile.solvedAt) / 60000 : Infinity;
  const registrationFresh = Number.isFinite(calibrationAgeMinutes)
    && calibrationAgeMinutes >= -1
    && calibrationAgeMinutes <= profile.quality.maximumAgeMinutes;
  if (!frameBound) warnings.push("Registration evidence is not bound to a camera frame.");
  else if (!framePresent) warnings.push("Load the bound camera frame before using registered coordinates.");
  else if (!frameMatches) warnings.push("The active camera frame does not match the saved registration.");
  if (frameMatches && !registrationFresh) warnings.push("Registration freshness has expired; re-register the current frame.");

  const mathematicallySolved = Boolean(solution) && !errors.length;
  const qualified = mathematicallySolved
    && solution.inlierCount >= profile.quality.minimumReferences
    && solution.coverageRatio >= profile.quality.minimumCoverageRatio
    && solution.rmsErrorPx <= profile.quality.maximumRmsErrorPx
    && solution.maximumErrorPx <= profile.quality.maximumPointErrorPx
    && solution.outlierRatio <= profile.quality.maximumOutlierRatio;
  const activeFrameReady = qualified && frameMatches && registrationFresh;
  const machinePlaneReady = activeFrameReady && frameCalibrated(fixtureProfile);
  const frameState = !frameBound
    ? "UNBOUND"
    : !framePresent
      ? "REQUIRED"
      : !frameMatches
        ? "MISMATCH"
        : "MATCH";
  return {
    profile,
    solution,
    errors,
    warnings,
    mathematicallySolved,
    qualified,
    activeFrame,
    frameBound,
    framePresent,
    frameMatches,
    registrationFresh,
    calibrationAgeMinutes,
    activeFrameReady,
    frameState,
    machinePlaneReady,
    detectorReady: false,
    automaticMotionReady: false,
    status: errors.length
      ? "INVALID"
      : !mathematicallySolved
        ? `${profile.references.length} OF 4`
        : !qualified
          ? "PLANAR SOLVED"
          : !frameBound
            ? "FRAME UNBOUND"
            : !framePresent
              ? "FRAME REQUIRED"
              : !frameMatches
                ? "FRAME MISMATCH"
                : !registrationFresh
                  ? "REGISTRATION STALE"
                  : machinePlaneReady
                    ? "MACHINE XY READY"
                    : "PLATE XY QUALIFIED",
  };
}

function pointInsideVise(point, vise, margin) {
  if (!vise.enabled || !vise.point) return false;
  const radians = -vise.rotation * Math.PI / 180;
  const deltaX = point.x - vise.point.x;
  const deltaY = point.y - vise.point.y;
  const local = {
    x: deltaX * Math.cos(radians) - deltaY * Math.sin(radians),
    y: deltaX * Math.sin(radians) + deltaY * Math.cos(radians),
  };
  const footprint = viseFootprintForOpening(vise.jawOpening);
  return local.x >= footprint.minX - margin
    && local.x <= footprint.maxX + margin
    && local.y >= footprint.minY - margin
    && local.y <= footprint.maxY + margin;
}

export function visibleFixtureReferences(fixtureProfile, marginMm = 4) {
  const grid = fixtureProfile?.grid;
  if (!grid) return [];
  const vises = fixtureLayout(fixtureProfile);
  const visible = [];
  for (let row = 0; row < grid.rows; row += 1) {
    for (let column = 0; column < grid.columns; column += 1) {
      const address = `${columnLabel(column)}${row + 1}`;
      const cad = addressToCad(address, grid);
      if (!cad || vises.some((vise) => pointInsideVise(cad, vise, marginMm))) continue;
      visible.push({ address, cad });
    }
  }
  return visible;
}

export function registrationFootprint(solution, camera) {
  if (Array.isArray(solution?.hull) && solution.hull.length >= 3) {
    return solution.hull.map((point) => ({ ...point }));
  }
  if (!solution?.inverse || !camera) return [];
  return [
    { x: 0, y: 0 },
    { x: camera.width, y: 0 },
    { x: camera.width, y: camera.height },
    { x: 0, y: camera.height },
  ].map((pixel) => projectHomography(solution.inverse, pixel)).filter(Boolean);
}

export function bindSceneRegistrationFrame(candidate, frame, fixtureProfile = null, now = Date.now()) {
  const profile = normalizeSceneRegistrationProfile(candidate, fixtureProfile);
  const normalizedFrame = normalizeSceneFrame(frame);
  if (!normalizedFrame) throw new Error("A fingerprinted camera frame is required.");
  if (sceneFramesMatch(profile.frame, normalizedFrame)) {
    return normalizeSceneRegistrationProfile({
      ...profile,
      frame: { ...normalizedFrame, boundAt: profile.frame?.boundAt ?? now },
      camera: { ...profile.camera, width: normalizedFrame.width, height: normalizedFrame.height },
    }, fixtureProfile);
  }
  return normalizeSceneRegistrationProfile({
    ...profile,
    frame: { ...normalizedFrame, boundAt: now },
    camera: { ...profile.camera, width: normalizedFrame.width, height: normalizedFrame.height },
    references: [],
    hypotheses: [],
    solvedAt: null,
  }, fixtureProfile);
}

export function addSceneReference(candidate, reference, fixtureProfile = null) {
  const profile = normalizeSceneRegistrationProfile(candidate, fixtureProfile);
  const normalized = normalizeReference(reference, profile.references.length, fixtureProfile);
  if (!normalized) throw new Error("A valid fixture-hole address and pixel coordinate are required.");
  const references = profile.references.filter(({ address }) => address !== normalized.address);
  references.push(normalized);
  return normalizeSceneRegistrationProfile({ ...profile, references, solvedAt: Date.now() }, fixtureProfile);
}

export function removeSceneReference(candidate, id, fixtureProfile = null) {
  const profile = normalizeSceneRegistrationProfile(candidate, fixtureProfile);
  return normalizeSceneRegistrationProfile({
    ...profile,
    references: profile.references.filter((reference) => reference.id !== id),
    solvedAt: profile.solvedAt,
  }, fixtureProfile);
}

export function clearSceneReferences(candidate, fixtureProfile = null) {
  const profile = normalizeSceneRegistrationProfile(candidate, fixtureProfile);
  return normalizeSceneRegistrationProfile({ ...profile, references: [], solvedAt: null }, fixtureProfile);
}

export function addSceneHypothesis(candidate, hypothesis, fixtureProfile = null) {
  const profile = normalizeSceneRegistrationProfile(candidate, fixtureProfile);
  const normalized = normalizeHypothesis(hypothesis, profile.hypotheses.length);
  if (!normalized) throw new Error("A supported feature type and image coordinate are required.");
  return normalizeSceneRegistrationProfile({
    ...profile,
    hypotheses: [...profile.hypotheses, normalized],
  }, fixtureProfile);
}

export function removeSceneHypothesis(candidate, id, fixtureProfile = null) {
  const profile = normalizeSceneRegistrationProfile(candidate, fixtureProfile);
  return normalizeSceneRegistrationProfile({
    ...profile,
    hypotheses: profile.hypotheses.filter((hypothesis) => hypothesis.id !== id),
  }, fixtureProfile);
}

export function importSceneDetections(payload, candidate, fixtureProfile = null) {
  const parsed = typeof payload === "string" ? JSON.parse(payload) : payload;
  if (!parsed || typeof parsed !== "object") throw new Error("Detection JSON must contain an object.");
  const profile = normalizeSceneRegistrationProfile(candidate, fixtureProfile);
  const importedFrame = normalizeSceneFrame(parsed.frame);
  const importsEvidence = Array.isArray(parsed.references) || Array.isArray(parsed.features);
  return normalizeSceneRegistrationProfile({
    ...profile,
    camera: {
      ...profile.camera,
      ...(parsed.camera ?? {}),
      ...(importedFrame ? { width: importedFrame.width, height: importedFrame.height } : {}),
    },
    frame: importedFrame ? { ...importedFrame, boundAt: Date.now() } : importsEvidence ? null : profile.frame,
    references: Array.isArray(parsed.references)
      ? parsed.references.map((reference) => ({ ...reference, source: "detector" }))
      : profile.references,
    hypotheses: Array.isArray(parsed.features)
      ? parsed.features.map((feature) => ({ ...feature, source: "detector" }))
      : profile.hypotheses,
    solvedAt: Date.now(),
  }, fixtureProfile);
}

export function buildGuidedProbePlan(candidate, fixtureProfile, options = {}) {
  const evaluation = evaluateSceneRegistrationProfile(candidate, fixtureProfile, options);
  const operations = evaluation.profile.hypotheses.map((hypothesis, index) => {
    const recipe = SCENE_FEATURE_TYPES[hypothesis.type];
    const registered = evaluation.solution
      ? pixelToRegisteredPoint(hypothesis.pixel, evaluation.solution, fixtureProfile)
      : null;
    return {
      sequence: index + 1,
      id: hypothesis.id,
      type: hypothesis.type,
      label: hypothesis.label,
      contacts: recipe.contacts,
      cycle: recipe.cycle,
      pixel: hypothesis.pixel,
      plate: registered?.plate ?? null,
      machine: registered?.machine ?? null,
      estimatedSizeMm: hypothesis.estimatedSizeMm,
      confidence: hypothesis.confidence,
      insideFrame: hypothesis.pixel.x >= 0
        && hypothesis.pixel.y >= 0
        && hypothesis.pixel.x <= evaluation.profile.camera.width
        && hypothesis.pixel.y <= evaluation.profile.camera.height,
      insideCalibrationHull: registered?.insideCalibrationHull === true,
      scaleMmPerPixel: registered?.scaleMmPerPixel ?? null,
      residualEstimateMm: registered?.residualEstimateMm ?? null,
    };
  });
  const allFeaturesInFrame = operations.every(({ insideFrame }) => insideFrame);
  const allFeaturesInCalibrationHull = operations.every(({ insideCalibrationHull }) => insideCalibrationHull);
  const holds = [];
  if (!evaluation.qualified) holds.push("PLATE-PLANE REGISTRATION NOT QUALIFIED");
  if (!evaluation.frameBound) holds.push("REGISTRATION NOT BOUND TO A FRAME");
  else if (!evaluation.framePresent) holds.push("CURRENT CAMERA FRAME REQUIRED");
  else if (!evaluation.frameMatches) holds.push("CURRENT FRAME DOES NOT MATCH REGISTRATION");
  else if (!evaluation.registrationFresh) holds.push("REGISTRATION EXPIRED");
  if (!frameCalibrated(fixtureProfile)) holds.push("FIXTURE MPOS FRAME NOT READY");
  if (options.probeQualified !== true) holds.push("CALIBRATED PROBE REQUIRED");
  if (!operations.length) holds.push("NO FEATURE HYPOTHESES");
  if (!allFeaturesInFrame) holds.push("FEATURE OUTSIDE CAMERA FRAME");
  if (!allFeaturesInCalibrationHull) holds.push("FEATURE OUTSIDE CALIBRATED HULL / EXTRAPOLATION BLOCKED");
  holds.push("AUTOMATIC PROBE MOTION NOT COMMISSIONED");
  return {
    operations,
    totalContacts: operations.reduce((sum, operation) => sum + operation.contacts, 0),
    readyForReview: evaluation.machinePlaneReady
      && options.probeQualified === true
      && operations.length > 0
      && allFeaturesInFrame
      && allFeaturesInCalibrationHull,
    executable: false,
    holds,
  };
}

export function loadSceneRegistrationProfile(storage = globalThis.localStorage, fixtureProfile = null) {
  try {
    const saved = storage?.getItem(SCENE_REGISTRATION_STORAGE_KEY);
    return normalizeSceneRegistrationProfile(saved ? JSON.parse(saved) : DEFAULT_SCENE_REGISTRATION_PROFILE, fixtureProfile);
  } catch {
    return normalizeSceneRegistrationProfile(DEFAULT_SCENE_REGISTRATION_PROFILE, fixtureProfile);
  }
}

export function saveSceneRegistrationProfile(candidate, storage = globalThis.localStorage, fixtureProfile = null) {
  const profile = normalizeSceneRegistrationProfile(candidate, fixtureProfile);
  storage?.setItem(SCENE_REGISTRATION_STORAGE_KEY, JSON.stringify(profile));
  return profile;
}
