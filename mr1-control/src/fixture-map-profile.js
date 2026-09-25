import { coordinatedRapidFeed, MR1_CONFIG } from "./machine-config.js";
import {
  evaluateTableFrameCalibration,
  normalizeTableFrameCalibration,
  tableCalibrationFrameMatches,
} from "./table-frame-calibration.js";

const STORAGE_KEY = "mr1.fixture-map.v3";
const PROFILE_VERSION = 5;
const CAD_MAP_KIND = "mr1-custom-cad-v1";
const MAX_COLUMNS = 99;
const MAX_ROWS = 99;

export const WCS_FIXTURE_ASSIGNMENTS = Object.freeze([
  Object.freeze({ wcs: "G54", fixtureId: "V1" }),
  Object.freeze({ wcs: "G55", fixtureId: "V2" }),
  Object.freeze({ wcs: "G56", fixtureId: "V3" }),
  Object.freeze({ wcs: "G57", fixtureId: "V4" }),
  Object.freeze({ wcs: "G58", fixtureId: "V5" }),
  Object.freeze({ wcs: "G59", fixtureId: "PLATE" }),
]);

const CAD_EXCLUDED_ADDRESSES = new Set([
  "A1", "C1", "E1", "B2", "D2", "G5", "Q5", "AP5", "AZ5",
  "F6", "P6", "R6", "Z6", "AB6", "AE6", "AG6", "AO6", "AQ6", "BA6",
  "E7", "BB7", "P16", "AM16", "Q17", "AP17", "J20", "BA26", "Q27",
  "P28", "BA28", "F31", "AQ31", "AP32", "F33", "Q42", "AP42", "P43",
  "E52", "BB52", "F53", "P53", "R53", "Z53", "AB53", "AE53", "AG53",
  "AO53", "AQ53", "BA53", "G54", "Q54", "AP54", "AZ54",
]);

export const CAD_FIXTURE_GRID = Object.freeze({
  kind: CAD_MAP_KIND,
  columns: 58,
  rows: 58,
  pitchX: 9.525,
  pitchY: 9.525,
  usableHoles: 1631,
});

const DEFAULT_GRID = CAD_FIXTURE_GRID;

export const VISE_DATUM_PRESETS = Object.freeze({
  "fixed-jaw-left": Object.freeze({
    label: "FIXED JAW / LEFT",
    x: MR1_CONFIG.workholding.viseCad.fixedJaw.leftX,
    y: MR1_CONFIG.workholding.viseCad.fixedJaw.faceY,
  }),
  "fixed-jaw-center": Object.freeze({
    label: "FIXED JAW / CENTERLINE",
    x: MR1_CONFIG.workholding.viseCad.fixedJaw.centerX,
    y: MR1_CONFIG.workholding.viseCad.fixedJaw.faceY,
  }),
  "fixed-jaw-right": Object.freeze({
    label: "FIXED JAW / RIGHT",
    x: MR1_CONFIG.workholding.viseCad.fixedJaw.rightX,
    y: MR1_CONFIG.workholding.viseCad.fixedJaw.faceY,
  }),
});

function optionalNumber(value) {
  if (value === "" || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function boundedInteger(value, fallback, minimum, maximum) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < minimum || number > maximum) return fallback;
  return number;
}

function boundedNumber(value, fallback, minimum, maximum) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < minimum || number > maximum) return fallback;
  return number;
}

export function viseFootprintForOpening(value) {
  const viseCad = MR1_CONFIG.workholding.viseCad;
  const jaw = viseCad.movableJaw;
  const opening = boundedNumber(value, jaw.modelOpening, jaw.minOpening, jaw.maxOpening);
  return {
    ...viseCad.footprint,
    maxY: viseCad.footprint.maxY + opening - jaw.modelOpening,
  };
}

export function columnLabel(index) {
  if (!Number.isInteger(index) || index < 0) return "";
  let value = index + 1;
  let label = "";
  while (value > 0) {
    value -= 1;
    label = String.fromCharCode(65 + (value % 26)) + label;
    value = Math.floor(value / 26);
  }
  return label;
}

export function columnIndex(label) {
  const normalized = String(label ?? "").trim().toUpperCase();
  if (!/^[A-Z]{1,2}$/.test(normalized)) return null;
  let value = 0;
  for (const character of normalized) value = value * 26 + character.charCodeAt(0) - 64;
  return value - 1;
}

export function parseHoleAddress(address) {
  const match = /^([A-Z]{1,2})([1-9]\d{0,2})$/i.exec(String(address ?? "").trim());
  if (!match) return null;
  const column = columnIndex(match[1]);
  const row = Number(match[2]) - 1;
  if (column === null || !Number.isInteger(row)) return null;
  return { column, row, address: `${columnLabel(column)}${row + 1}` };
}

function isCadFixtureGrid(grid) {
  return grid?.kind === CAD_MAP_KIND;
}

function axisLatticeIndex(index, count) {
  const half = count / 2;
  return index < half ? index - half : index - half + 1;
}

function gridCellIsAddressable(column, row, grid) {
  if (!isCadFixtureGrid(grid)) return true;
  const latticeX = axisLatticeIndex(column, grid.columns);
  const latticeY = axisLatticeIndex(row, grid.rows);
  if ((latticeX + latticeY) % 2 !== 0) return false;
  return !CAD_EXCLUDED_ADDRESSES.has(`${columnLabel(column)}${row + 1}`);
}

export function gridCellToCad(column, row, grid = DEFAULT_GRID) {
  if (
    !Number.isInteger(column) || !Number.isInteger(row)
    || column < 0 || column >= grid.columns
    || row < 0 || row >= grid.rows
  ) return null;
  if (isCadFixtureGrid(grid)) {
    return {
      x: axisLatticeIndex(column, grid.columns) * grid.pitchX,
      y: axisLatticeIndex(row, grid.rows) * grid.pitchY,
    };
  }
  return {
    x: (column - (grid.columns - 1) / 2) * grid.pitchX,
    y: (row - (grid.rows - 1) / 2) * grid.pitchY,
  };
}

export function cadFixtureHolePoints(grid = DEFAULT_GRID) {
  const points = [];
  for (let row = 0; row < grid.rows; row += 1) {
    for (let column = 0; column < grid.columns; column += 1) {
      if (!gridCellIsAddressable(column, row, grid)) continue;
      const point = gridCellToCad(column, row, grid);
      if (point) points.push({ ...point, address: `${columnLabel(column)}${row + 1}` });
    }
  }
  return points;
}

export function addressToCad(address, grid = DEFAULT_GRID) {
  const parsed = parseHoleAddress(address);
  if (!parsed || !gridCellIsAddressable(parsed.column, parsed.row, grid)) return null;
  return gridCellToCad(parsed.column, parsed.row, grid);
}

export function cadPointToAddress(point, grid = DEFAULT_GRID) {
  if (!Number.isFinite(point?.x) || !Number.isFinite(point?.y)) return null;
  if (isCadFixtureGrid(grid)) {
    let nearest = null;
    for (let row = 0; row < grid.rows; row += 1) {
      for (let column = 0; column < grid.columns; column += 1) {
        if (!gridCellIsAddressable(column, row, grid)) continue;
        const candidate = gridCellToCad(column, row, grid);
        const distance = Math.hypot(point.x - candidate.x, point.y - candidate.y);
        if (!nearest || distance < nearest.distance) {
          nearest = { address: `${columnLabel(column)}${row + 1}`, distance };
        }
      }
    }
    return nearest?.address ?? null;
  }
  const column = Math.round(point.x / grid.pitchX + (grid.columns - 1) / 2);
  const row = Math.round(point.y / grid.pitchY + (grid.rows - 1) / 2);
  if (column < 0 || column >= grid.columns || row < 0 || row >= grid.rows) return null;
  return `${columnLabel(column)}${row + 1}`;
}

export function addressableCellCount(grid = DEFAULT_GRID) {
  if (isCadFixtureGrid(grid)) return CAD_FIXTURE_GRID.usableHoles;
  return grid.columns * grid.rows;
}

function normalizeRotation(value) {
  const rotation = ((Number(value) % 360) + 360) % 360;
  return [0, 90, 180, 270].includes(rotation) ? rotation : 0;
}

function defaultVises() {
  return WCS_FIXTURE_ASSIGNMENTS
    .filter(({ fixtureId }) => fixtureId !== "PLATE")
    .map(({ fixtureId, wcs }) => {
      const placement = MR1_CONFIG.workholding.vises.find(({ id }) => id === fixtureId);
      return {
        id: fixtureId,
        wcs,
        address: cadPointToAddress({ x: placement.x, y: placement.z }, DEFAULT_GRID),
        rotation: normalizeRotation(radiansToQuarterTurnDegrees(placement.rotation)),
        jawOpening: MR1_CONFIG.workholding.viseCad.movableJaw.modelOpening,
        enabled: true,
      };
    });
}

function radiansToQuarterTurnDegrees(radians) {
  return Math.round((Number(radians) || 0) * 180 / Math.PI / 90) * 90;
}

export const DEFAULT_FIXTURE_MAP_PROFILE = Object.freeze({
  version: PROFILE_VERSION,
  selectedFixtureId: "V1",
  grid: DEFAULT_GRID,
  plateFrame: Object.freeze({ x: null, y: null, z: null, rotationDeg: 0 }),
  plateCalibration: null,
  viseDatum: Object.freeze({
    reference: "fixed-jaw-left",
    x: VISE_DATUM_PRESETS["fixed-jaw-left"].x,
    y: VISE_DATUM_PRESETS["fixed-jaw-left"].y,
    z: null,
  }),
  locationsVerified: false,
  vises: Object.freeze(defaultVises().map((vise) => Object.freeze(vise))),
});

export function normalizeFixtureMapProfile(candidate = {}) {
  const source = candidate && typeof candidate === "object" ? candidate : {};
  const sourceGrid = source.grid && typeof source.grid === "object" ? source.grid : {};
  const useCadMap = !source.grid || sourceGrid.kind === CAD_MAP_KIND;
  const grid = useCadMap
    ? { ...DEFAULT_GRID }
    : {
        kind: "cartesian",
        columns: boundedInteger(sourceGrid.columns, DEFAULT_GRID.columns, 2, MAX_COLUMNS),
        rows: boundedInteger(sourceGrid.rows, DEFAULT_GRID.rows, 2, MAX_ROWS),
        pitchX: boundedNumber(sourceGrid.pitchX, DEFAULT_GRID.pitchX, 1, 100),
        pitchY: boundedNumber(sourceGrid.pitchY, DEFAULT_GRID.pitchY, 1, 100),
      };
  const defaults = defaultVises();
  const candidateVises = Array.isArray(source.vises) ? source.vises : [];
  const vises = defaults.map((fallback) => {
    const saved = candidateVises.find((vise) => vise?.id === fallback.id) ?? {};
    const parsed = parseHoleAddress(saved.address);
    return {
      ...fallback,
      address: parsed?.address ?? fallback.address,
      rotation: normalizeRotation(saved.rotation),
      jawOpening: boundedNumber(
        saved.jawOpening,
        fallback.jawOpening,
        MR1_CONFIG.workholding.viseCad.movableJaw.minOpening,
        MR1_CONFIG.workholding.viseCad.movableJaw.maxOpening,
      ),
      enabled: saved.enabled !== false,
    };
  });
  const validFixtureIds = new Set(WCS_FIXTURE_ASSIGNMENTS.map(({ fixtureId }) => fixtureId));
  const sourceFrame = source.plateFrame && typeof source.plateFrame === "object" ? source.plateFrame : {};
  const sourceDatum = source.viseDatum && typeof source.viseDatum === "object" ? source.viseDatum : {};
  const datumReference = sourceDatum.reference === "custom"
    || Object.hasOwn(VISE_DATUM_PRESETS, sourceDatum.reference)
    ? sourceDatum.reference
    : DEFAULT_FIXTURE_MAP_PROFILE.viseDatum.reference;
  return {
    version: PROFILE_VERSION,
    selectedFixtureId: validFixtureIds.has(source.selectedFixtureId) ? source.selectedFixtureId : "V1",
    grid,
    plateFrame: {
      x: optionalNumber(sourceFrame.x),
      y: optionalNumber(sourceFrame.y),
      z: optionalNumber(sourceFrame.z),
      rotationDeg: boundedNumber(sourceFrame.rotationDeg, 0, -180, 180),
    },
    plateCalibration: source.plateCalibration
      ? normalizeTableFrameCalibration(source.plateCalibration)
      : null,
    viseDatum: {
      reference: datumReference,
      x: optionalNumber(sourceDatum.x) ?? DEFAULT_FIXTURE_MAP_PROFILE.viseDatum.x,
      y: optionalNumber(sourceDatum.y) ?? DEFAULT_FIXTURE_MAP_PROFILE.viseDatum.y,
      z: optionalNumber(sourceDatum.z),
    },
    locationsVerified: source.locationsVerified === true,
    vises,
  };
}

export function fixtureLayout(profile) {
  const normalized = normalizeFixtureMapProfile(profile);
  return normalized.vises.map((vise) => ({
    ...vise,
    point: addressToCad(vise.address, normalized.grid),
  }));
}

function rotatePoint(point, degrees) {
  const radians = degrees * Math.PI / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  return {
    x: point.x * cosine - point.y * sine,
    y: point.x * sine + point.y * cosine,
  };
}

export function calculateFixtureWorkOffset(profile, fixtureId) {
  const normalized = normalizeFixtureMapProfile(profile);
  const frame = normalized.plateFrame;
  if (fixtureId === "PLATE") {
    return {
      cad: { x: 0, y: 0, z: 0 },
      machine: { x: frame.x, y: frame.y, z: frame.z },
    };
  }

  const vise = normalized.vises.find(({ id }) => id === fixtureId);
  if (!vise || !vise.enabled) return null;
  const anchor = addressToCad(vise.address, normalized.grid);
  if (!anchor) return null;
  const localDatum = rotatePoint(normalized.viseDatum, vise.rotation);
  const cad = {
    x: anchor.x + localDatum.x,
    y: anchor.y + localDatum.y,
    z: normalized.viseDatum.z,
  };
  const rotatedCad = rotatePoint(cad, frame.rotationDeg);
  return {
    cad,
    machine: {
      x: Number.isFinite(frame.x) ? frame.x + rotatedCad.x : null,
      y: Number.isFinite(frame.y) ? frame.y + rotatedCad.y : null,
      z: Number.isFinite(frame.z) && Number.isFinite(cad.z) ? frame.z + cad.z : null,
    },
  };
}

export function applyFixtureMapToJob(job, profile) {
  if (!job || !Array.isArray(job.segments)) return job;
  const normalized = normalizeFixtureMapProfile(profile);
  const assignmentByWcs = new Map(WCS_FIXTURE_ASSIGNMENTS.map((assignment) => [assignment.wcs, assignment]));
  const fixtureOffsetByWcs = new Map(WCS_FIXTURE_ASSIGNMENTS.map((assignment) => {
    const candidate = calculateFixtureWorkOffset(normalized, assignment.fixtureId);
    const offset = candidate?.cad && Number.isFinite(candidate.cad.x) && Number.isFinite(candidate.cad.y)
      ? {
          x: candidate.cad.x,
          y: candidate.cad.y,
          z: candidate.cad.z,
          wcs: assignment.wcs,
          fixtureId: assignment.fixtureId,
        }
      : null;
    return [assignment.wcs, offset];
  }));
  const warnings = new Set((job.warnings ?? []).filter((warning) => (
    !warning.startsWith("Fixture-map positions")
    && !warning.endsWith("is not assigned in the fixture map.")
    && !warning.endsWith("fixture is disabled in the fixture map.")
  )));
  let mappedSegments = 0;
  let mappedPointCount = 0;
  const usedWorkOffsets = new Set();
  const mappedBounds = {
    min: { x: Infinity, y: Infinity, z: Infinity },
    max: { x: -Infinity, y: -Infinity, z: -Infinity },
  };

  const mappedPoint = (point, offset) => ({
    x: point.x + (Number.isFinite(offset?.x) ? offset.x : 0),
    y: point.y + (Number.isFinite(offset?.y) ? offset.y : 0),
    z: point.z + (Number.isFinite(offset?.z) ? offset.z : 0),
  });

  for (const segment of job.segments) {
    const workOffset = segment.workOffset ?? null;
    if (!workOffset) {
      delete segment.fixtureOffset;
      continue;
    }
    usedWorkOffsets.add(workOffset);
    const assignment = assignmentByWcs.get(workOffset);
    if (!assignment) {
      delete segment.fixtureOffset;
      continue;
    }
    const fixtureOffset = fixtureOffsetByWcs.get(workOffset);
    if (!fixtureOffset) {
      delete segment.fixtureOffset;
      continue;
    }
    segment.fixtureOffset = fixtureOffset;
    segment.fromFixtureOffset = fixtureOffsetByWcs.get(segment.fromWorkOffset ?? workOffset) ?? fixtureOffset;
    if (!segment.from || !segment.to) {
      mappedSegments += 1;
      continue;
    }
    const mappedFrom = mappedPoint(segment.from, segment.fromFixtureOffset);
    const mappedTo = mappedPoint(segment.to, segment.fixtureOffset);
    for (const point of [mappedFrom, mappedTo]) {
      mappedPointCount += 1;
      for (const axis of ["x", "y", "z"]) {
        mappedBounds.min[axis] = Math.min(mappedBounds.min[axis], point[axis]);
        mappedBounds.max[axis] = Math.max(mappedBounds.max[axis], point[axis]);
      }
    }
    if (segment.fromWorkOffset !== segment.workOffset) {
      segment.distance = Math.hypot(
        mappedTo.x - mappedFrom.x,
        mappedTo.y - mappedFrom.y,
        mappedTo.z - mappedFrom.z,
      );
      if (segment.type === "rapid") {
        segment.feed = coordinatedRapidFeed(mappedFrom, mappedTo);
        segment.duration = (segment.distance / Math.max(1, segment.feed)) * 60;
      } else {
        segment.duration = (segment.distance / Math.max(1, segment.feed)) * 60;
        warnings.add("A cutting move crosses work offsets; verify the posted fixture transition.");
      }
    }
    mappedSegments += 1;
  }

  let elapsedSeconds = 0;
  for (const segment of job.segments) {
    segment.startTime = elapsedSeconds;
    elapsedSeconds += Number.isFinite(segment.duration) ? segment.duration : 0;
    segment.endTime = elapsedSeconds;
  }
  job.duration = elapsedSeconds;

  if (mappedSegments > 0 && !normalized.locationsVerified) {
    warnings.add("Fixture-map positions are provisional until physical vise locations are verified.");
  }
  for (const workOffset of usedWorkOffsets) {
    const assignment = assignmentByWcs.get(workOffset);
    if (!assignment) {
      warnings.add(`${workOffset} is not assigned in the fixture map.`);
      continue;
    }
    const assignedVise = normalized.vises.find(({ id }) => id === assignment.fixtureId);
    if (assignedVise && !assignedVise.enabled) {
      warnings.add(`${workOffset} fixture is disabled in the fixture map.`);
    }
  }
  job.warnings = [...warnings];
  job.fixtureMap = {
    mappedSegments,
    usedWorkOffsets: [...usedWorkOffsets],
    locationsVerified: normalized.locationsVerified,
    bounds: mappedPointCount > 0 ? mappedBounds : null,
  };
  return job;
}

function axisInsideEnvelope(value, axis) {
  if (!Number.isFinite(value)) return true;
  const envelope = MR1_CONFIG.machineEnvelope[axis];
  return value >= envelope.min && value <= envelope.max;
}

export function evaluateFixtureMapProfile(profile) {
  const normalized = normalizeFixtureMapProfile(profile);
  const errors = [];
  const blockers = [];
  const firstGridPoint = gridCellToCad(0, 0, normalized.grid);
  const lastGridPoint = gridCellToCad(
    normalized.grid.columns - 1,
    normalized.grid.rows - 1,
    normalized.grid,
  );
  const gridSpanX = Math.abs(lastGridPoint.x - firstGridPoint.x);
  const gridSpanY = Math.abs(lastGridPoint.y - firstGridPoint.y);
  if (gridSpanX > MR1_CONFIG.fixturePlate.width + 0.01) errors.push("Column grid exceeds the fixture plate width.");
  if (gridSpanY > MR1_CONFIG.fixturePlate.depth + 0.01) errors.push("Row grid exceeds the fixture plate depth.");

  const addresses = new Set();
  const occupied = [];
  for (const vise of normalized.vises) {
    if (!vise.enabled) continue;
    const point = addressToCad(vise.address, normalized.grid);
    if (!point) errors.push(`${vise.id} address is outside the table map.`);
    if (addresses.has(vise.address)) errors.push(`${vise.address} is assigned to more than one vise.`);
    addresses.add(vise.address);
    if (!point) continue;
    const footprint = viseFootprintForOpening(vise.jawOpening);
    const corners = [
      { x: footprint.minX, y: footprint.minY },
      { x: footprint.minX, y: footprint.maxY },
      { x: footprint.maxX, y: footprint.minY },
      { x: footprint.maxX, y: footprint.maxY },
    ].map((corner) => {
      const rotated = rotatePoint(corner, vise.rotation);
      return { x: point.x + rotated.x, y: point.y + rotated.y };
    });
    const bounds = {
      minX: Math.min(...corners.map(({ x }) => x)),
      maxX: Math.max(...corners.map(({ x }) => x)),
      minY: Math.min(...corners.map(({ y }) => y)),
      maxY: Math.max(...corners.map(({ y }) => y)),
    };
    if (
      bounds.minX < -MR1_CONFIG.fixturePlate.width / 2
      || bounds.maxX > MR1_CONFIG.fixturePlate.width / 2
      || bounds.minY < -MR1_CONFIG.fixturePlate.depth / 2
      || bounds.maxY > MR1_CONFIG.fixturePlate.depth / 2
    ) {
      errors.push(`${vise.id} CAD footprint leaves the fixture plate.`);
    }
    for (const other of occupied) {
      if (
        bounds.minX < other.bounds.maxX
        && bounds.maxX > other.bounds.minX
        && bounds.minY < other.bounds.maxY
        && bounds.maxY > other.bounds.minY
      ) {
        errors.push(`${vise.id} CAD footprint overlaps ${other.id}.`);
      }
    }
    occupied.push({ id: vise.id, bounds });
  }

  for (const axis of ["x", "y", "z"]) {
    if (!axisInsideEnvelope(normalized.plateFrame[axis], axis)) {
      errors.push(`Plate ${axis.toUpperCase()} origin is outside machine travel.`);
    }
  }
  if (Math.abs(normalized.viseDatum.x) > 200 || Math.abs(normalized.viseDatum.y) > 200) {
    errors.push("Vise datum offset is outside the supported CAD envelope.");
  }
  if (Number.isFinite(normalized.viseDatum.z) && (normalized.viseDatum.z < 0 || normalized.viseDatum.z > 200)) {
    errors.push("Vise datum Z must be 0 to 200 mm above the plate.");
  }

  const frameDefined = ["x", "y", "z"].every((axis) => Number.isFinite(normalized.plateFrame[axis]));
  const frameCalibration = normalized.plateCalibration
    ? evaluateTableFrameCalibration(normalized.plateCalibration)
    : null;
  const frameCalibrationFinalized = Boolean(frameCalibration?.profile.calibratedAt);
  const frameMatchesCalibration = frameDefined
    && frameCalibrationFinalized
    && tableCalibrationFrameMatches(normalized.plateCalibration, normalized.plateFrame);
  const frameCalibrated = frameDefined
    && frameCalibration?.qualified === true
    && frameMatchesCalibration;
  if (frameDefined) {
    for (const { fixtureId } of WCS_FIXTURE_ASSIGNMENTS) {
      const candidate = calculateFixtureWorkOffset(normalized, fixtureId)?.machine;
      for (const axis of ["x", "y", "z"]) {
        if (!axisInsideEnvelope(candidate?.[axis], axis)) {
          errors.push(`${fixtureId} ${axis.toUpperCase()} datum is outside machine travel.`);
        }
      }
    }
  }
  if (!frameDefined) blockers.push("PLATE FRAME REQUIRED");
  else if (!frameCalibrationFinalized) blockers.push("PLATE CALIBRATION EVIDENCE REQUIRED");
  else if (frameCalibration?.qualified !== true) blockers.push("PLATE CALIBRATION QUALITY NOT MET");
  else if (!frameMatchesCalibration) blockers.push("PLATE FRAME CHANGED AFTER CALIBRATION");
  if (!normalized.locationsVerified) blockers.push("VISE LOCATIONS UNVERIFIED");
  if (!Number.isFinite(normalized.viseDatum.z)) blockers.push("VISE DATUM Z REQUIRED");

  return {
    profile: normalized,
    valid: errors.length === 0,
    ready: errors.length === 0 && blockers.length === 0,
    frameDefined,
    frameCalibrated,
    frameCalibration,
    frameMatchesCalibration,
    errors,
    blockers,
  };
}

export function loadFixtureMapProfile(storage = globalThis.localStorage) {
  try {
    const saved = storage?.getItem(STORAGE_KEY);
    return normalizeFixtureMapProfile(saved ? JSON.parse(saved) : DEFAULT_FIXTURE_MAP_PROFILE);
  } catch {
    return normalizeFixtureMapProfile(DEFAULT_FIXTURE_MAP_PROFILE);
  }
}

export function saveFixtureMapProfile(profile, storage = globalThis.localStorage) {
  const evaluation = evaluateFixtureMapProfile(profile);
  if (!evaluation.valid) throw new TypeError(evaluation.errors[0]);
  storage?.setItem(STORAGE_KEY, JSON.stringify(evaluation.profile));
  return evaluation.profile;
}
