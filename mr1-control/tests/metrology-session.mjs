import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_METROLOGY_SESSION,
  METROLOGY_STORAGE_KEY,
  addMetrologyPoint,
  analyzeMetrology,
  createManualMetrologyPoint,
  createProbeMetrologyPoint,
  exportMetrologyCsv,
  exportMetrologyPly,
  exportMetrologyXyz,
  fitCircleXY,
  fitLineXY,
  fitPlane,
  loadMetrologySession,
  normalizeMetrologySession,
  pointDistance,
  recompensateMetrologyPoints,
  saveMetrologySession,
} from "../src/metrology-session.js";
import {
  compensateProbeCoordinates,
  evaluateProbeCalibration,
  normalizeProbeCalibration,
} from "../src/probe-calibration.js";

const closeTo = (actual, expected, tolerance = 1e-6) => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} is not within ${tolerance} of ${expected}`);
};

const calibratedProbe = () => normalizeProbeCalibration({
  probeId: "P1",
  probeName: "SHOP PROBE",
  ballDiameterMm: 4,
  stylusLengthMm: 50,
  tipOffsetMm: { x: 0, y: 0, z: 0 },
  effectiveRadiusMm: {
    "+x": 2, "-x": 2, "+y": 2, "-y": 2, "+z": 2, "-z": 2,
  },
  repeatabilityMm: 0.003,
  repeatabilityLimitMm: 0.01,
  sampleCount: 10,
  calibratedAt: new Date().toISOString(),
  validForDays: 30,
  artifact: { type: "ring", id: "RING-20", nominalSizeMm: 20 },
});

test("probe qualification requires definition, artifact, results, date, and directional radii", () => {
  const evaluation = evaluateProbeCalibration(calibratedProbe());
  assert.equal(evaluation.qualified, true);
  assert.deepEqual(evaluation.readyDirections, ["+x", "-x", "+y", "-y", "+z", "-z"]);
  assert.equal(evaluateProbeCalibration({}).usable, false);
  const poor = calibratedProbe();
  poor.repeatabilityMm = 0.02;
  const poorEvaluation = evaluateProbeCalibration(poor);
  assert.equal(poorEvaluation.usable, false);
  assert.match(poorEvaluation.reasons.join(" / "), /REPEATABILITY EXCEEDS LIMIT/);
  const expired = calibratedProbe();
  expired.calibratedAt = "2026-01-01T00:00:00.000Z";
  assert.equal(evaluateProbeCalibration(expired, { now: "2026-02-15T00:00:00.000Z" }).usable, false);
});

test("directional compensation moves the raw probe center toward the contacted surface", () => {
  const profile = calibratedProbe();
  assert.deepEqual(compensateProbeCoordinates({ x: 8, y: 0, z: 0 }, "+x", profile).coordinates, {
    x: 10, y: 0, z: 0,
  });
  assert.deepEqual(compensateProbeCoordinates({ x: 12, y: 0, z: 0 }, "-x", profile).coordinates, {
    x: 10, y: 0, z: 0,
  });
  assert.equal(compensateProbeCoordinates({ x: 8, y: 0, z: 0 }, null, profile), null);
  assert.equal(compensateProbeCoordinates({ x: 8, y: 0, z: 0 }, "+x", null), null);
});

test("successful probe events preserve MPOS and derive WPOS from the live WCO", () => {
  const point = createProbeMetrologyPoint(
    { type: "probe", position: { x: -100, y: -80, z: -20 }, success: true },
    {
      position: { wco: { x: -110, y: -90, z: -25 } },
      workCoordinateSystem: "G54",
    },
    { id: "probe-1", capturedAt: "2026-08-25T00:00:00.000Z" },
  );
  assert.deepEqual(point.machine, { x: -100, y: -80, z: -20 });
  assert.deepEqual(point.work, { x: 10, y: 10, z: 5 });
  assert.equal(point.wcs, "G54");
  assert.equal(point.correctedMachine, null);
  assert.throws(
    () => createProbeMetrologyPoint({ type: "probe", position: { x: 0, y: 0, z: 0 }, success: false }),
    /Failed probe contacts/,
  );
});

test("probe hits preserve raw evidence and store a separate calibrated surface point", () => {
  const point = createProbeMetrologyPoint(
    { type: "probe", position: { x: 8, y: 3, z: -2 }, success: true },
    { position: { wco: { x: 1, y: 1, z: 1 } }, workCoordinateSystem: "G54" },
    { direction: "+x", probeCalibration: calibratedProbe(), id: "corrected-1" },
  );
  assert.deepEqual(point.rawMachine, { x: 8, y: 3, z: -2 });
  assert.deepEqual(point.machine, point.rawMachine);
  assert.deepEqual(point.correctedMachine, { x: 10, y: 3, z: -2 });
  assert.deepEqual(point.rawWork, { x: 7, y: 2, z: -3 });
  assert.deepEqual(point.correctedWork, { x: 9, y: 2, z: -3 });
  assert.equal(point.compensation.probeId, "P1");
});

test("four directional hits correct bore and boss diameter by one ball diameter", () => {
  const profile = calibratedProbe();
  const buildSession = (radiusByDirection) => {
    const directions = ["+x", "-x", "+y", "-y"];
    const positions = {
      "+x": { x: radiusByDirection, y: 0, z: 0 },
      "-x": { x: -radiusByDirection, y: 0, z: 0 },
      "+y": { x: 0, y: radiusByDirection, z: 0 },
      "-y": { x: 0, y: -radiusByDirection, z: 0 },
    };
    return {
      ...DEFAULT_METROLOGY_SESSION,
      pointMode: "corrected",
      analysisMode: "circle",
      points: directions.map((direction, index) => createProbeMetrologyPoint(
        { type: "probe", position: positions[direction], success: true },
        { position: { wco: { x: 0, y: 0, z: 0 } } },
        { direction, probeCalibration: profile, id: `contact-${radiusByDirection}-${index}` },
      )),
    };
  };

  const bore = buildSession(8);
  closeTo(analyzeMetrology(bore, { pointMode: "raw" }).result.diameterMm, 16);
  closeTo(analyzeMetrology(bore).result.diameterMm, 20);

  const bossDirections = ["-x", "+x", "-y", "+y"];
  const bossRaw = [{ x: 12, y: 0, z: 0 }, { x: -12, y: 0, z: 0 }, { x: 0, y: 12, z: 0 }, { x: 0, y: -12, z: 0 }];
  const boss = {
    ...DEFAULT_METROLOGY_SESSION,
    pointMode: "corrected",
    analysisMode: "circle",
    points: bossRaw.map((position, index) => createProbeMetrologyPoint(
      { type: "probe", position, success: true },
      { position: { wco: { x: 0, y: 0, z: 0 } } },
      { direction: bossDirections[index], probeCalibration: profile, id: `boss-${index}` },
    )),
  };
  closeTo(analyzeMetrology(boss, { pointMode: "raw" }).result.diameterMm, 24);
  closeTo(analyzeMetrology(boss).result.diameterMm, 20);
});

test("recompensation changes corrected data without mutating raw evidence", () => {
  const point = createProbeMetrologyPoint(
    { type: "probe", position: { x: 8, y: 0, z: 0 }, success: true },
    null,
    { direction: "+x", probeCalibration: calibratedProbe(), id: "raw-lock" },
  );
  const changed = calibratedProbe();
  changed.effectiveRadiusMm["+x"] = 1.95;
  const session = recompensateMetrologyPoints({ ...DEFAULT_METROLOGY_SESSION, points: [point] }, changed);
  assert.deepEqual(session.points[0].rawMachine, { x: 8, y: 0, z: 0 });
  closeTo(session.points[0].correctedMachine.x, 9.95);
});

test("manual points retain both coordinate frames when WCO is known", () => {
  const point = createManualMetrologyPoint(
    { x: 10, y: 20, z: 3 },
    "work",
    { workOffset: { x: -100, y: -200, z: -20 }, wcs: "G55" },
    { id: "manual-1", capturedAt: "2026-08-25T00:00:00.000Z" },
  );
  assert.deepEqual(point.work, { x: 10, y: 20, z: 3 });
  assert.deepEqual(point.machine, { x: -90, y: -180, z: -17 });
});

test("circle fit reports center, diameter, coverage, and radial residual", () => {
  const points = Array.from({ length: 8 }, (_, index) => {
    const angle = (index / 8) * Math.PI * 2;
    const noise = index % 2 === 0 ? 0.004 : -0.004;
    return {
      x: 12 + (10 + noise) * Math.cos(angle),
      y: -8 + (10 + noise) * Math.sin(angle),
      z: 2,
    };
  });
  const circle = fitCircleXY(points);
  closeTo(circle.center.x, 12, 0.001);
  closeTo(circle.center.y, -8, 0.001);
  closeTo(circle.diameterMm, 20, 0.001);
  assert.ok(circle.angularCoverageDeg >= 314);
  assert.ok(circle.rmsMm < 0.005);
});

test("line fit finds direction, length, and straightness", () => {
  const points = [0, 10, 20, 30, 40].map((x, index) => ({
    x,
    y: x * 0.5 + (index % 2 ? 0.002 : -0.002),
    z: 0,
  }));
  const line = fitLineXY(points);
  closeTo(line.angleDeg, 26.565, 0.01);
  closeTo(line.lengthMm, Math.hypot(40, 20), 0.01);
  assert.ok(line.straightnessMm < 0.005);
});

test("arbitrary plane fit reports the normal and flatness", () => {
  const points = [];
  for (const x of [-20, 0, 20]) {
    for (const y of [-15, 0, 15]) points.push({ x, y, z: 5 + 0.1 * x - 0.05 * y });
  }
  const plane = fitPlane(points);
  const expectedMagnitude = Math.hypot(-0.1, 0.05, 1);
  closeTo(plane.normal.x, -0.1 / expectedMagnitude, 1e-6);
  closeTo(plane.normal.y, 0.05 / expectedMagnitude, 1e-6);
  closeTo(plane.normal.z, 1 / expectedMagnitude, 1e-6);
  assert.ok(plane.flatnessMm < 1e-9);
});

test("two-point distance preserves XYZ deltas", () => {
  const result = pointDistance({ x: 1, y: 2, z: 3 }, { x: 4, y: 6, z: 15 });
  assert.deepEqual(result.delta, { x: 3, y: 4, z: 12 });
  assert.equal(result.distanceMm, 13);
});

test("smart analysis recognizes a sampled bore and compares nominal diameter", () => {
  let session = { ...DEFAULT_METROLOGY_SESSION, nominalSizeMm: 20, points: [] };
  for (let index = 0; index < 8; index += 1) {
    const angle = (index / 8) * Math.PI * 2;
    session = addMetrologyPoint(session, createManualMetrologyPoint(
      { x: 3 + 10.01 * Math.cos(angle), y: 4 + 10.01 * Math.sin(angle), z: 0 },
      "work",
      {},
      { id: `bore-${index}`, capturedAt: `2026-08-25T00:00:0${index}.000Z` },
    ));
  }
  const analysis = analyzeMetrology(session);
  assert.equal(analysis.recommendedMode, "circle");
  closeTo(analysis.measuredSizeMm, 20.02, 0.001);
  closeTo(analysis.deviationMm, 0.02, 0.001);
  assert.equal(analysis.withinTolerance, true);
  assert.equal(analysis.quality.label, "HIGH");
});

test("smart analysis distinguishes a straight edge from a general plane", () => {
  const edge = {
    ...DEFAULT_METROLOGY_SESSION,
    points: [0, 10, 20, 30, 40].map((x, index) => createManualMetrologyPoint(
      { x, y: 2 + index * 0.001, z: 0 },
      "work",
      {},
      { id: `edge-${index}` },
    )),
  };
  const plane = {
    ...DEFAULT_METROLOGY_SESSION,
    points: [
      { x: 0, y: 0, z: 0 }, { x: 20, y: 0, z: 0.1 }, { x: 0, y: 20, z: -0.1 },
      { x: 20, y: 20, z: 0 }, { x: 10, y: 5, z: 0.025 }, { x: 5, y: 15, z: -0.05 },
    ].map((position, index) => createManualMetrologyPoint(position, "work", {}, { id: `plane-${index}` })),
  };
  assert.equal(analyzeMetrology(edge).recommendedMode, "line");
  assert.equal(analyzeMetrology(plane).recommendedMode, "plane");
});

test("points without the selected coordinate frame are explicitly excluded", () => {
  const session = {
    ...DEFAULT_METROLOGY_SESSION,
    points: [{ id: "m1", source: "probe", machine: { x: 1, y: 2, z: 3 } }],
  };
  const work = analyzeMetrology(session, { coordinateSpace: "work" });
  const machine = analyzeMetrology(session, { coordinateSpace: "machine" });
  assert.equal(work.pointCount, 0);
  assert.equal(work.excludedPointCount, 1);
  assert.equal(machine.pointCount, 1);
});

test("CSV, XYZ, and PLY exports use the selected coordinate frame", () => {
  const session = {
    ...DEFAULT_METROLOGY_SESSION,
    points: [createManualMetrologyPoint(
      { x: 1.25, y: -2.5, z: 3.75 },
      "work",
      {},
      { id: "export-1", capturedAt: "2026-08-25T00:00:00.000Z" },
    )],
  };
  assert.match(exportMetrologyCsv(session), /1\.250000,-2\.500000,3\.750000/);
  assert.equal(exportMetrologyXyz(session), "1.250000 -2.500000 3.750000");
  assert.match(exportMetrologyPly(session), /element vertex 1/);
  assert.match(exportMetrologyPly(session), /1\.250000 -2\.500000 3\.750000/);
});

test("session persistence strips unknown data, deduplicates IDs, and survives corruption", () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  const point = createManualMetrologyPoint({ x: 1, y: 2, z: 3 }, "work", {}, { id: "same" });
  const saved = saveMetrologySession({
    ...DEFAULT_METROLOGY_SESSION,
    name: "HOUSING CHECK",
    points: [point, point],
    ignored: true,
  }, storage);
  const loaded = loadMetrologySession(storage);
  assert.equal(saved.points.length, 1);
  assert.equal(loaded.name, "HOUSING CHECK");
  assert.equal("ignored" in loaded, false);
  assert.ok(values.has(METROLOGY_STORAGE_KEY));
  assert.deepEqual(
    loadMetrologySession({ getItem: () => "{broken" }),
    normalizeMetrologySession(DEFAULT_METROLOGY_SESSION),
  );
});
