import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_SCENE_REGISTRATION_PROFILE,
  addSceneHypothesis,
  addSceneReference,
  bindSceneRegistrationFrame,
  buildGuidedProbePlan,
  clearSceneReferences,
  evaluateSceneRegistrationProfile,
  importSceneDetections,
  loadSceneRegistrationProfile,
  pixelToRegisteredPoint,
  pointInConvexPolygon,
  projectHomography,
  registrationFootprint,
  saveSceneRegistrationProfile,
  solveFixtureHomography,
  visibleFixtureReferences,
} from "../src/scene-registration.js";
import {
  DEFAULT_FIXTURE_MAP_PROFILE,
  addressToCad,
  normalizeFixtureMapProfile,
} from "../src/fixture-map-profile.js";
import {
  DEFAULT_TABLE_FRAME_CALIBRATION,
  finalizeTableFrameCalibration,
} from "../src/table-frame-calibration.js";

const fixtureFrame = { x: -290, y: -270, z: -145, rotationDeg: 0.3 };
const fixtureBaseProfile = normalizeFixtureMapProfile({
  ...DEFAULT_FIXTURE_MAP_PROFILE,
  plateFrame: fixtureFrame,
  locationsVerified: true,
  viseDatum: { ...DEFAULT_FIXTURE_MAP_PROFILE.viseDatum, z: 28 },
});
const fixtureCalibration = finalizeTableFrameCalibration({
  ...DEFAULT_TABLE_FRAME_CALIBRATION,
  references: ["D4", "BC4", "D55", "BC55", "AC5", "AC54"].map((address, index) => {
    const cad = addressToCad(address, fixtureBaseProfile.grid);
    const radians = fixtureFrame.rotationDeg * Math.PI / 180;
    return {
      id: `table-ref-${index + 1}`,
      address,
      cad,
      machine: {
        x: fixtureFrame.x + cad.x * Math.cos(radians) - cad.y * Math.sin(radians),
        y: fixtureFrame.y + cad.x * Math.sin(radians) + cad.y * Math.cos(radians),
      },
      topZ: fixtureFrame.z + cad.x * 0.0002 - cad.y * 0.0001,
      source: "probe",
    };
  }),
}, { probeQualified: true, machineHomed: true, probeId: "P1", now: Date.UTC(2026, 7, 25) });
const fixtureProfile = normalizeFixtureMapProfile({
  ...fixtureBaseProfile,
  plateCalibration: fixtureCalibration,
});

const syntheticMatrix = [2.25, 0.18, 960, -0.09, -1.72, 540, 0.00031, -0.00022, 1];
const NOW = Date.UTC(2026, 7, 25, 16, 0, 0);
const testFrame = Object.freeze({
  fingerprint: `sha256:${"ab".repeat(32)}`,
  sourceName: "fixture-validation.png",
  width: 1920,
  height: 1080,
  capturedAt: NOW - 1000,
  boundAt: NOW - 1000,
});

function frameBoundProfile(references = distributedReferences(), overrides = {}) {
  return {
    ...DEFAULT_SCENE_REGISTRATION_PROFILE,
    ...overrides,
    frame: testFrame,
    references,
    solvedAt: NOW - 500,
  };
}

function distributedReferences(count = 12) {
  const visible = visibleFixtureReferences(fixtureProfile);
  const targets = [
    [-245, -245], [0, -245], [245, -245],
    [-245, 0], [245, 0],
    [-245, 245], [0, 245], [245, 245],
    [-150, -150], [150, -150], [-150, 150], [150, 150],
  ];
  const used = new Set();
  return targets.slice(0, count).map(([x, y], index) => {
    const nearest = visible
      .filter(({ address }) => !used.has(address))
      .sort((left, right) => (
        Math.hypot(left.cad.x - x, left.cad.y - y) - Math.hypot(right.cad.x - x, right.cad.y - y)
      ))[0];
    used.add(nearest.address);
    return {
      id: `ref-${index + 1}`,
      address: nearest.address,
      pixel: projectHomography(syntheticMatrix, nearest.cad),
      source: "detector",
    };
  });
}

test("solves a distributed fixture-hole homography and inverts image coordinates", () => {
  const references = distributedReferences();
  const solution = solveFixtureHomography(references, fixtureProfile);
  assert.ok(solution.rmsErrorPx < 1e-7);
  assert.ok(solution.maximumErrorPx < 1e-6);
  assert.ok(solution.coverageRatio > 0.5);

  const plate = { x: 37.5, y: -82.25 };
  const pixel = projectHomography(syntheticMatrix, plate);
  const registered = pixelToRegisteredPoint(pixel, solution, fixtureProfile);
  assert.ok(Math.abs(registered.plate.x - plate.x) < 1e-7);
  assert.ok(Math.abs(registered.plate.y - plate.y) < 1e-7);
  assert.ok(Number.isFinite(registered.machine.x));
  assert.equal(registered.machine.z, -145);
});

test("qualifies only a distributed low-residual solution and reports planar limitations", () => {
  const profile = frameBoundProfile();
  const evaluation = evaluateSceneRegistrationProfile(profile, fixtureProfile, { activeFrame: testFrame, now: NOW });
  assert.equal(evaluation.mathematicallySolved, true);
  assert.equal(evaluation.qualified, true);
  assert.equal(evaluation.machinePlaneReady, true);
  assert.equal(evaluation.status, "MACHINE XY READY");
  assert.equal(evaluation.detectorReady, false);
  assert.equal(evaluation.automaticMotionReady, false);
  assert.match(evaluation.warnings.join(" "), /plate-plane XY only/i);
  assert.ok(registrationFootprint(evaluation.solution, evaluation.profile.camera).length >= 4);
});

test("keeps a four-point solve provisional and blocks missing machine-frame authority", () => {
  const profile = { ...DEFAULT_SCENE_REGISTRATION_PROFILE, references: distributedReferences(4) };
  const provisional = evaluateSceneRegistrationProfile(profile, fixtureProfile);
  const noFrame = evaluateSceneRegistrationProfile(profile, DEFAULT_FIXTURE_MAP_PROFILE);
  assert.equal(provisional.mathematicallySolved, true);
  assert.equal(provisional.qualified, false);
  assert.match(provisional.warnings.join(" "), /at least 8/i);
  assert.equal(noFrame.machinePlaneReady, false);
  assert.match(noFrame.warnings.join(" "), /MPOS frame/i);
});

test("rejects duplicate pixels and degenerate same-row references", () => {
  const duplicated = distributedReferences(4);
  duplicated[1] = { ...duplicated[1], pixel: duplicated[0].pixel };
  const duplicateEvaluation = evaluateSceneRegistrationProfile({
    ...DEFAULT_SCENE_REGISTRATION_PROFILE,
    references: duplicated,
  }, fixtureProfile);
  assert.equal(duplicateEvaluation.mathematicallySolved, false);
  assert.match(duplicateEvaluation.errors.join(" "), /same pixel/i);

  const sameRow = visibleFixtureReferences(fixtureProfile)
    .filter(({ address }) => /1$/.test(address))
    .slice(0, 4)
    .map(({ address, cad }, index) => ({ id: `line-${index}`, address, pixel: projectHomography(syntheticMatrix, cad) }));
  assert.throws(() => solveFixtureHomography(sameRow, fixtureProfile), /degenerate/i);
});

test("excludes fixture holes hidden by enabled vise CAD footprints", () => {
  const withVises = visibleFixtureReferences(fixtureProfile, 0);
  const withoutVisesProfile = normalizeFixtureMapProfile({
    ...fixtureProfile,
    vises: fixtureProfile.vises.map((vise) => ({ ...vise, enabled: false })),
  });
  const withoutVises = visibleFixtureReferences(withoutVisesProfile, 0);
  assert.ok(withVises.length < withoutVises.length);
  assert.equal(withoutVises.length, 1631);
});

test("adds canonical fixture references and replaces an address deterministically", () => {
  const first = distributedReferences(1)[0];
  let profile = addSceneReference(DEFAULT_SCENE_REGISTRATION_PROFILE, first, fixtureProfile);
  profile = addSceneReference(profile, { ...first, id: "replacement", pixel: { x: first.pixel.x + 1, y: first.pixel.y } }, fixtureProfile);
  assert.equal(profile.references.length, 1);
  assert.equal(profile.references[0].id, "replacement");
  assert.equal(clearSceneReferences(profile, fixtureProfile).references.length, 0);
  assert.throws(
    () => addSceneReference(profile, { address: "Z17", pixel: { x: 10, y: 10 } }, fixtureProfile),
    /valid fixture-hole/i,
  );
});

test("imports detector hypotheses and produces a review-only guided probing plan", () => {
  const references = distributedReferences();
  const borePlate = addressToCad(references[5].address, fixtureProfile.grid);
  const borePixel = projectHomography(syntheticMatrix, borePlate);
  let profile = importSceneDetections({
    camera: { width: 1920, height: 1080 },
    frame: testFrame,
    references,
    features: [{ id: "bore-1", type: "bore", pixel: borePixel, estimatedSizeMm: 25, confidence: 0.93 }],
  }, DEFAULT_SCENE_REGISTRATION_PROFILE, fixtureProfile);
  profile = addSceneHypothesis(profile, {
    id: "plane-1",
    type: "top-plane",
    pixel: projectHomography(syntheticMatrix, { x: 0, y: 0 }),
  }, fixtureProfile);
  const plan = buildGuidedProbePlan(profile, fixtureProfile, {
    activeFrame: testFrame,
    now: Date.now(),
    probeQualified: true,
  });
  assert.equal(plan.operations.length, 2);
  assert.equal(plan.totalContacts, 17);
  assert.equal(plan.readyForReview, true);
  assert.equal(plan.executable, false);
  assert.match(plan.holds.at(-1), /not commissioned/i);
  assert.ok(Math.abs(plan.operations[0].plate.x - borePlate.x) < 1e-6);
  assert.equal(plan.operations[0].insideCalibrationHull, true);
});

test("rejects a gross correspondence outlier without corrupting the consensus transform", () => {
  const references = distributedReferences();
  references[9] = {
    ...references[9],
    pixel: { x: references[9].pixel.x + 220, y: references[9].pixel.y - 180 },
  };
  const evaluation = evaluateSceneRegistrationProfile(
    frameBoundProfile(references),
    fixtureProfile,
    { activeFrame: testFrame, now: NOW },
  );
  assert.equal(evaluation.solution.inlierCount, 11);
  assert.equal(evaluation.solution.outlierCount, 1);
  assert.equal(evaluation.solution.residuals[9].inlier, false);
  assert.equal(evaluation.qualified, true);
  assert.equal(evaluation.machinePlaneReady, true);
  const target = { x: 43, y: -71 };
  const recovered = pixelToRegisteredPoint(projectHomography(syntheticMatrix, target), evaluation.solution, fixtureProfile);
  assert.ok(Math.hypot(recovered.plate.x - target.x, recovered.plate.y - target.y) < 1e-6);
});

test("holds a solve when the rejected-reference ratio exceeds the configured budget", () => {
  const references = distributedReferences();
  const offsets = new Map([
    [1, { x: 180, y: -120 }],
    [5, { x: 230, y: 160 }],
    [9, { x: -210, y: -180 }],
  ]);
  offsets.forEach((offset, index) => {
    references[index] = {
      ...references[index],
      pixel: {
        x: references[index].pixel.x + offset.x,
        y: references[index].pixel.y + offset.y,
      },
    };
  });
  const evaluation = evaluateSceneRegistrationProfile(
    frameBoundProfile(references),
    fixtureProfile,
    { activeFrame: testFrame, now: NOW },
  );
  assert.equal(evaluation.solution.outlierCount, 3);
  assert.ok(evaluation.solution.outlierRatio > evaluation.profile.quality.maximumOutlierRatio);
  assert.equal(evaluation.qualified, false);
  assert.match(evaluation.warnings.join(" "), /rejected-reference ratio/i);
});

test("requires the matching current frame and expires old registration evidence", () => {
  const profile = frameBoundProfile();
  const missing = evaluateSceneRegistrationProfile(profile, fixtureProfile, { now: NOW });
  const mismatch = evaluateSceneRegistrationProfile(profile, fixtureProfile, {
    activeFrame: { ...testFrame, fingerprint: `sha256:${"cd".repeat(32)}` },
    now: NOW,
  });
  const matching = evaluateSceneRegistrationProfile(profile, fixtureProfile, { activeFrame: testFrame, now: NOW });
  const stale = evaluateSceneRegistrationProfile(profile, fixtureProfile, {
    activeFrame: testFrame,
    now: NOW + 61 * 60000,
  });
  assert.equal(missing.frameState, "REQUIRED");
  assert.equal(missing.machinePlaneReady, false);
  assert.equal(mismatch.frameState, "MISMATCH");
  assert.equal(mismatch.machinePlaneReady, false);
  assert.equal(matching.frameState, "MATCH");
  assert.equal(matching.machinePlaneReady, true);
  assert.equal(stale.frameState, "MATCH");
  assert.equal(stale.registrationFresh, false);
  assert.equal(stale.status, "REGISTRATION STALE");
  assert.equal(stale.machinePlaneReady, false);
});

test("clears old image evidence when a different frame is explicitly bound", () => {
  const differentFrame = { ...testFrame, fingerprint: `sha256:${"ef".repeat(32)}`, sourceName: "new-frame.png" };
  const rebound = bindSceneRegistrationFrame(frameBoundProfile(distributedReferences(), {
    hypotheses: [{ id: "bore", type: "bore", pixel: { x: 960, y: 540 } }],
  }), differentFrame, fixtureProfile, NOW);
  assert.equal(rebound.frame.fingerprint, differentFrame.fingerprint);
  assert.equal(rebound.references.length, 0);
  assert.equal(rebound.hypotheses.length, 0);
  assert.equal(rebound.solvedAt, null);
});

test("blocks calibrated-plane extrapolation outside the inlier reference hull", () => {
  const references = distributedReferences();
  const insidePixel = projectHomography(syntheticMatrix, { x: 0, y: 0 });
  const outsidePixel = projectHomography(syntheticMatrix, { x: 310, y: 0 });
  const base = frameBoundProfile(references);
  const insidePlan = buildGuidedProbePlan({
    ...base,
    hypotheses: [{ id: "inside", type: "bore", pixel: insidePixel }],
  }, fixtureProfile, { activeFrame: testFrame, now: NOW, probeQualified: true });
  const outsidePlan = buildGuidedProbePlan({
    ...base,
    hypotheses: [{ id: "outside", type: "bore", pixel: outsidePixel }],
  }, fixtureProfile, { activeFrame: testFrame, now: NOW, probeQualified: true });
  const solution = evaluateSceneRegistrationProfile(base, fixtureProfile, {
    activeFrame: testFrame,
    now: NOW,
  }).solution;
  assert.equal(pointInConvexPolygon({ x: 0, y: 0 }, solution.hull), true);
  assert.equal(insidePlan.readyForReview, true);
  assert.equal(outsidePlan.operations[0].insideCalibrationHull, false);
  assert.equal(outsidePlan.readyForReview, false);
  assert.match(outsidePlan.holds.join(" "), /extrapolation blocked/i);
});

test("persists normalized registration data and recovers from corrupt storage", () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  const saved = saveSceneRegistrationProfile({
    ...DEFAULT_SCENE_REGISTRATION_PROFILE,
    camera: { ...DEFAULT_SCENE_REGISTRATION_PROFILE.camera, name: " SHOP CAM " },
    references: distributedReferences(4),
    unknown: "discarded",
  }, storage, fixtureProfile);
  assert.equal(saved.camera.name, "SHOP CAM");
  assert.equal("unknown" in saved, false);
  assert.deepEqual(loadSceneRegistrationProfile(storage, fixtureProfile), saved);
  assert.deepEqual(
    loadSceneRegistrationProfile({ getItem: () => "{broken" }, fixtureProfile),
    loadSceneRegistrationProfile({ getItem: () => null }, fixtureProfile),
  );
});
