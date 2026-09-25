import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_TABLE_FRAME_CALIBRATION,
  addTableFrameReference,
  clearTableFrameReferences,
  evaluateTableFrameCalibration,
  finalizeTableFrameCalibration,
  removeTableFrameReference,
  tableCalibrationFrameMatches,
} from "../src/table-frame-calibration.js";

const expectedFrame = Object.freeze({ x: -290, y: -270, z: -145, rotationDeg: 0.3 });
const cadPoints = Object.freeze([
  { address: "D4", x: -245, y: -245 },
  { address: "BC4", x: 245, y: -245 },
  { address: "D55", x: -245, y: 245 },
  { address: "BC55", x: 245, y: 245 },
  { address: "AC5", x: 0, y: -235 },
  { address: "AC58", x: 0, y: 255 },
]);

function transform(point, frame = expectedFrame, scale = 1) {
  const radians = frame.rotationDeg * Math.PI / 180;
  return {
    x: frame.x + scale * (point.x * Math.cos(radians) - point.y * Math.sin(radians)),
    y: frame.y + scale * (point.x * Math.sin(radians) + point.y * Math.cos(radians)),
  };
}

function references({ scale = 1, slopeX = 0.0002, slopeY = -0.0001 } = {}) {
  return cadPoints.map((point, index) => ({
    id: `ref-${index + 1}`,
    address: point.address,
    cad: { x: point.x, y: point.y },
    machine: transform(point, expectedFrame, scale),
    topZ: expectedFrame.z + slopeX * point.x + slopeY * point.y,
    source: "probe",
  }));
}

function profile(overrides = {}) {
  return {
    ...DEFAULT_TABLE_FRAME_CALIBRATION,
    ...overrides,
    references: overrides.references ?? references(),
  };
}

test("solves plate-center MPOS, yaw, and top-center Z from distributed references", () => {
  const evaluation = evaluateTableFrameCalibration(profile(), { probeQualified: true, machineHomed: true });
  assert.equal(evaluation.qualified, true);
  assert.equal(evaluation.readyToApply, true);
  assert.ok(evaluation.coverageRatio > 0.5);
  assert.ok(Math.abs(evaluation.frame.x - expectedFrame.x) < 1e-9);
  assert.ok(Math.abs(evaluation.frame.y - expectedFrame.y) < 1e-9);
  assert.ok(Math.abs(evaluation.frame.z - expectedFrame.z) < 1e-9);
  assert.ok(Math.abs(evaluation.frame.rotationDeg - expectedFrame.rotationDeg) < 1e-9);
  assert.ok(evaluation.xy.rmsErrorMm < 1e-9);
  assert.ok(evaluation.top.resultantTiltDeg > 0);
});

test("rejects a gross XY outlier and preserves the rigid transform", () => {
  const measured = references();
  measured[4] = {
    ...measured[4],
    machine: { x: measured[4].machine.x + 3, y: measured[4].machine.y - 2 },
  };
  const evaluation = evaluateTableFrameCalibration(profile({ references: measured }));
  assert.equal(evaluation.xy.inlierCount, 5);
  assert.equal(evaluation.xy.outlierCount, 1);
  assert.equal(evaluation.xy.residuals[4].inlier, false);
  assert.equal(evaluation.qualified, true);
  assert.ok(Math.abs(evaluation.frame.x - expectedFrame.x) < 1e-9);
});

test("reports axis-scale disagreement without absorbing it into the frame", () => {
  const evaluation = evaluateTableFrameCalibration(profile({
    quality: {
      ...DEFAULT_TABLE_FRAME_CALIBRATION.quality,
      ransacThresholdMm: 1,
    },
    references: references({ scale: 1.001 }),
  }));
  assert.ok(Math.abs(evaluation.xy.scaleErrorPpm) > 900);
  assert.equal(evaluation.qualified, false);
  assert.match(evaluation.warnings.join(" "), /axis scale/i);
  assert.ok(evaluation.xy.maximumErrorMm > 0.1);
});

test("holds a tilted table instead of hiding tilt in a Z offset", () => {
  const evaluation = evaluateTableFrameCalibration(profile({
    references: references({ slopeX: 0.002, slopeY: -0.001 }),
  }));
  assert.ok(evaluation.top.resultantTiltDeg > evaluation.profile.quality.maximumTiltDeg);
  assert.equal(evaluation.qualified, false);
  assert.match(evaluation.warnings.join(" "), /tram the machine/i);
});

test("requires homing and a qualified probe before finalizing evidence", () => {
  const candidate = profile();
  assert.equal(evaluateTableFrameCalibration(candidate).readyToApply, false);
  assert.throws(() => finalizeTableFrameCalibration(candidate), /qualified|homed|required/i);
  const finalized = finalizeTableFrameCalibration(candidate, {
    machineHomed: true,
    probeQualified: true,
    probeId: "P1",
    now: 1787664000000,
  });
  assert.equal(finalized.probeId, "P1");
  assert.equal(finalized.calibratedAt, 1787664000000);
  assert.equal(tableCalibrationFrameMatches(finalized, expectedFrame), true);
  assert.equal(tableCalibrationFrameMatches(finalized, { ...expectedFrame, x: -289.9 }), false);
});

test("adds, replaces, removes, and clears raw calibration references", () => {
  const first = references()[0];
  let candidate = addTableFrameReference(DEFAULT_TABLE_FRAME_CALIBRATION, first, 1000);
  candidate = addTableFrameReference(candidate, {
    ...first,
    id: "replacement",
    machine: { ...first.machine, x: first.machine.x + 0.01 },
  }, 2000);
  assert.equal(candidate.references.length, 1);
  assert.equal(candidate.references[0].id, "replacement");
  assert.equal(candidate.references[0].measuredAt, 2000);
  candidate = removeTableFrameReference(candidate, "replacement");
  assert.equal(candidate.references.length, 0);
  assert.equal(clearTableFrameReferences(profile()).references.length, 0);
});

test("rejects duplicate addresses and machine coordinates outside travel", () => {
  const duplicated = references();
  duplicated[1] = { ...duplicated[1], address: duplicated[0].address };
  assert.match(evaluateTableFrameCalibration(profile({ references: duplicated })).errors.join(" "), /duplicate/i);
  const outside = references();
  outside[0] = { ...outside[0], machine: { x: 10, y: outside[0].machine.y } };
  assert.match(evaluateTableFrameCalibration(profile({ references: outside })).errors.join(" "), /outside machine travel/i);
});
