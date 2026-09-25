import assert from "node:assert/strict";
import test from "node:test";
import {
  CAD_FIXTURE_GRID,
  DEFAULT_FIXTURE_MAP_PROFILE,
  applyFixtureMapToJob,
  addressableCellCount,
  addressToCad,
  cadFixtureHolePoints,
  cadPointToAddress,
  calculateFixtureWorkOffset,
  columnIndex,
  columnLabel,
  evaluateFixtureMapProfile,
  fixtureLayout,
  loadFixtureMapProfile,
  normalizeFixtureMapProfile,
  parseHoleAddress,
  saveFixtureMapProfile,
  viseFootprintForOpening,
  WCS_FIXTURE_ASSIGNMENTS,
  VISE_DATUM_PRESETS,
} from "../src/fixture-map-profile.js";
import {
  DEFAULT_TABLE_FRAME_CALIBRATION,
  finalizeTableFrameCalibration,
} from "../src/table-frame-calibration.js";

function qualifiedFixtureProfile() {
  const frame = { x: -290, y: -270, z: -145, rotationDeg: 0.3 };
  const base = normalizeFixtureMapProfile({
    ...DEFAULT_FIXTURE_MAP_PROFILE,
    plateFrame: frame,
    locationsVerified: true,
    viseDatum: { ...DEFAULT_FIXTURE_MAP_PROFILE.viseDatum, z: 28 },
  });
  const radians = frame.rotationDeg * Math.PI / 180;
  const plateCalibration = finalizeTableFrameCalibration({
    ...DEFAULT_TABLE_FRAME_CALIBRATION,
    references: ["D4", "BC4", "D55", "BC55", "AC5", "AC54"].map((address, index) => {
      const cad = addressToCad(address, base.grid);
      return {
        id: `cal-${index}`,
        address,
        cad,
        machine: {
          x: frame.x + cad.x * Math.cos(radians) - cad.y * Math.sin(radians),
          y: frame.y + cad.x * Math.sin(radians) + cad.y * Math.cos(radians),
        },
        topZ: frame.z + cad.x * 0.0002 - cad.y * 0.0001,
        source: "probe",
      };
    }),
  }, { probeQualified: true, machineHomed: true, probeId: "P1", now: 1787664000000 });
  return normalizeFixtureMapProfile({ ...base, plateCalibration });
}

test("parses table addresses through Z and beyond", () => {
  assert.deepEqual(parseHoleAddress("d4"), { column: 3, row: 3, address: "D4" });
  assert.deepEqual(parseHoleAddress("Z17"), { column: 25, row: 16, address: "Z17" });
  assert.equal(columnLabel(26), "AA");
  assert.equal(columnIndex("AA"), 26);
  assert.equal(parseHoleAddress("4D"), null);
});

test("maps named holes around the CAD plate center", () => {
  const grid = { columns: 5, rows: 5, pitchX: 25, pitchY: 20 };
  assert.deepEqual(addressToCad("C3", grid), { x: 0, y: 0 });
  assert.deepEqual(addressToCad("A1", grid), { x: -50, y: -40 });
  assert.equal(cadPointToAddress({ x: 24.8, y: -19.7 }, grid), "D2");
  assert.equal(addressToCad("F1", grid), null);
});

test("uses the CAD-derived staggered plate map and its exclusions", () => {
  assert.equal(CAD_FIXTURE_GRID.columns, 58);
  assert.equal(CAD_FIXTURE_GRID.rows, 58);
  assert.equal(addressableCellCount(CAD_FIXTURE_GRID), 1631);
  assert.deepEqual(addressToCad("D4", CAD_FIXTURE_GRID), { x: -247.65, y: -247.65 });
  assert.deepEqual(addressToCad("BF58", CAD_FIXTURE_GRID), { x: 276.225, y: 276.225 });
  assert.equal(addressToCad("Z17", CAD_FIXTURE_GRID), null);
  assert.equal(addressToCad("AP5", CAD_FIXTURE_GRID), null);
  assert.equal(cadPointToAddress({ x: -155, y: -100 }, CAD_FIXTURE_GRID), "N20");
  const visualHoles = cadFixtureHolePoints(CAD_FIXTURE_GRID);
  assert.equal(visualHoles.length, 1631);
  assert.deepEqual(
    visualHoles.find(({ address }) => address === "D4"),
    { address: "D4", x: -247.65, y: -247.65 },
  );
  assert.equal(visualHoles.some(({ address }) => address === "AP5"), false);
});

test("assigns five vises to G54 through G58 and reserves G59", () => {
  assert.deepEqual(
    WCS_FIXTURE_ASSIGNMENTS.map(({ wcs, fixtureId }) => `${wcs}:${fixtureId}`),
    ["G54:V1", "G55:V2", "G56:V3", "G57:V4", "G58:V5", "G59:PLATE"],
  );
  const layout = fixtureLayout(DEFAULT_FIXTURE_MAP_PROFILE);
  assert.equal(layout.length, 5);
  assert.ok(layout.every(({ enabled }) => enabled));
  assert.ok(layout.every(({ jawOpening }) => jawOpening === 52.405));
  assert.ok(layout.every(({ point }) => Number.isFinite(point.x) && Number.isFinite(point.y)));
});

test("moves each adjustable jaw without moving the fixed-jaw work datum", () => {
  const opened = normalizeFixtureMapProfile({
    ...DEFAULT_FIXTURE_MAP_PROFILE,
    vises: DEFAULT_FIXTURE_MAP_PROFILE.vises.map((vise) => (
      vise.id === "V1" ? { ...vise, jawOpening: 125.5 } : vise
    )),
  });
  const defaultOffset = calculateFixtureWorkOffset(DEFAULT_FIXTURE_MAP_PROFILE, "V1");
  const openedOffset = calculateFixtureWorkOffset(opened, "V1");
  const defaultFootprint = viseFootprintForOpening(52.405);
  const openedFootprint = viseFootprintForOpening(125.5);

  assert.equal(fixtureLayout(opened).find(({ id }) => id === "V1").jawOpening, 125.5);
  assert.deepEqual(openedOffset, defaultOffset);
  assert.ok(Math.abs(
    (openedFootprint.maxY - defaultFootprint.maxY) - (125.5 - 52.405),
  ) < 1e-9);
});

test("disabled vises leave the live layout but do not reserve space or map a WCS", () => {
  const profile = normalizeFixtureMapProfile({
    ...DEFAULT_FIXTURE_MAP_PROFILE,
    vises: DEFAULT_FIXTURE_MAP_PROFILE.vises.map((vise) => (
      vise.id === "V2"
        ? { ...vise, enabled: false, address: DEFAULT_FIXTURE_MAP_PROFILE.vises[0].address }
        : vise
    )),
  });
  const evaluation = evaluateFixtureMapProfile(profile);
  const layout = fixtureLayout(profile);
  const job = { warnings: [], segments: [{ workOffset: "G55" }] };
  applyFixtureMapToJob(job, profile);

  assert.equal(evaluation.valid, true);
  assert.equal(layout.find(({ id }) => id === "V2").enabled, false);
  assert.equal(calculateFixtureWorkOffset(profile, "V2"), null);
  assert.equal(job.segments[0].fixtureOffset, undefined);
  assert.ok(job.warnings.includes("G55 fixture is disabled in the fixture map."));
});

test("defaults every vise WCS to the touchable fixed-jaw left reference", () => {
  assert.deepEqual(DEFAULT_FIXTURE_MAP_PROFILE.viseDatum, {
    reference: "fixed-jaw-left",
    x: -47.752,
    y: 39.326,
    z: null,
  });
  assert.deepEqual(VISE_DATUM_PRESETS["fixed-jaw-center"], {
    label: "FIXED JAW / CENTERLINE",
    x: 0,
    y: 39.326,
  });
  const anchor = addressToCad(DEFAULT_FIXTURE_MAP_PROFILE.vises[0].address);
  const offset = calculateFixtureWorkOffset(DEFAULT_FIXTURE_MAP_PROFILE, "V1");
  assert.equal(offset.cad.x, anchor.x - 47.752);
  assert.equal(offset.cad.y, anchor.y + 39.326);
});

test("places G54 and G58 path segments at their mapped CAD fixtures", () => {
  const job = {
    warnings: [],
    segments: [
      { workOffset: "G54" },
      { workOffset: "G58" },
      { workOffset: "G59.3" },
    ],
  };
  applyFixtureMapToJob(job, DEFAULT_FIXTURE_MAP_PROFILE);
  assert.equal(job.segments[0].fixtureOffset.fixtureId, "V1");
  assert.equal(job.segments[1].fixtureOffset.fixtureId, "V5");
  assert.equal(job.segments[2].fixtureOffset, undefined);
  assert.deepEqual(job.fixtureMap.usedWorkOffsets, ["G54", "G58", "G59.3"]);
  assert.ok(job.warnings.some((warning) => warning.startsWith("Fixture-map positions")));
  assert.ok(job.warnings.some((warning) => warning.startsWith("G59.3 is not assigned")));
});

test("keeps both fixture transforms on a cross-WCS rapid", () => {
  const job = {
    warnings: [],
    duration: 1,
    segments: [{
      from: { x: 0, y: 0, z: 5 },
      to: { x: 0, y: 0, z: 5 },
      type: "rapid",
      feed: 1000,
      distance: 0,
      duration: 1,
      startTime: 0,
      endTime: 1,
      fromWorkOffset: "G54",
      workOffset: "G58",
    }],
  };
  applyFixtureMapToJob(job, DEFAULT_FIXTURE_MAP_PROFILE);
  assert.equal(job.segments[0].fromFixtureOffset.fixtureId, "V1");
  assert.equal(job.segments[0].fixtureOffset.fixtureId, "V5");
  assert.ok(job.segments[0].distance > 200);
  assert.ok(job.duration > 1);
});

test("rotates a vise datum and the plate frame into machine coordinates", () => {
  const profile = normalizeFixtureMapProfile({
    ...DEFAULT_FIXTURE_MAP_PROFILE,
    grid: { columns: 5, rows: 5, pitchX: 25, pitchY: 25 },
    plateFrame: { x: -300, y: -250, z: -140, rotationDeg: 90 },
    viseDatum: { x: 10, y: 0, z: 30 },
    vises: DEFAULT_FIXTURE_MAP_PROFILE.vises.map((vise) => (
      vise.id === "V1" ? { ...vise, address: "C3", rotation: 90 } : vise
    )),
  });
  const offset = calculateFixtureWorkOffset(profile, "V1");
  assert.ok(Math.abs(offset.cad.x) < 1e-9);
  assert.equal(offset.cad.y, 10);
  assert.equal(offset.machine.x, -310);
  assert.ok(Math.abs(offset.machine.y + 250) < 1e-9);
  assert.equal(offset.machine.z, -110);
});

test("keeps a map saveable before it is commissioned but not ready", () => {
  const evaluation = evaluateFixtureMapProfile(DEFAULT_FIXTURE_MAP_PROFILE);
  assert.equal(evaluation.valid, true);
  assert.equal(evaluation.ready, false);
  assert.deepEqual(evaluation.blockers, [
    "PLATE FRAME REQUIRED",
    "VISE LOCATIONS UNVERIFIED",
    "VISE DATUM Z REQUIRED",
  ]);
});

test("holds manually typed frame numbers until probe calibration evidence matches", () => {
  const manual = normalizeFixtureMapProfile({
    ...DEFAULT_FIXTURE_MAP_PROFILE,
    plateFrame: { x: -290, y: -270, z: -145, rotationDeg: 0.3 },
  });
  const evaluation = evaluateFixtureMapProfile(manual);
  assert.equal(evaluation.frameDefined, true);
  assert.equal(evaluation.frameCalibrated, false);
  assert.ok(evaluation.blockers.includes("PLATE CALIBRATION EVIDENCE REQUIRED"));
});

test("qualifies a finalized multi-hole frame and detects later manual drift", () => {
  const qualified = qualifiedFixtureProfile();
  const evaluation = evaluateFixtureMapProfile(qualified);
  assert.equal(evaluation.frameCalibrated, true);
  assert.equal(evaluation.ready, true);

  const changed = normalizeFixtureMapProfile({
    ...qualified,
    plateFrame: { ...qualified.plateFrame, x: qualified.plateFrame.x + 0.01 },
  });
  const changedEvaluation = evaluateFixtureMapProfile(changed);
  assert.equal(changedEvaluation.frameCalibrated, false);
  assert.ok(changedEvaluation.blockers.includes("PLATE FRAME CHANGED AFTER CALIBRATION"));
});

test("rejects maps that extend beyond the physical plate", () => {
  const evaluation = evaluateFixtureMapProfile({
    ...DEFAULT_FIXTURE_MAP_PROFILE,
    grid: { columns: 52, rows: 23, pitchX: 25.4, pitchY: 25.4 },
  });
  assert.equal(evaluation.valid, false);
  assert.match(evaluation.errors.join(" "), /fixture plate width/);
});

test("rejects a valid address when the rotated vise footprint leaves the plate", () => {
  const profile = {
    ...DEFAULT_FIXTURE_MAP_PROFILE,
    vises: DEFAULT_FIXTURE_MAP_PROFILE.vises.map((vise) => (
      vise.id === "V5" ? { ...vise, address: "BF58", rotation: 270 } : vise
    )),
  };
  const evaluation = evaluateFixtureMapProfile(profile);
  assert.equal(evaluation.valid, false);
  assert.match(evaluation.errors.join(" "), /V5 CAD footprint leaves/);
});

test("rejects overlapping vise CAD footprints", () => {
  const profile = {
    ...DEFAULT_FIXTURE_MAP_PROFILE,
    vises: DEFAULT_FIXTURE_MAP_PROFILE.vises.map((vise) => (
      vise.id === "V2" ? { ...vise, address: DEFAULT_FIXTURE_MAP_PROFILE.vises[0].address } : vise
    )),
  };
  const evaluation = evaluateFixtureMapProfile(profile);
  assert.equal(evaluation.valid, false);
  assert.match(evaluation.errors.join(" "), /overlaps V1/);
});

test("persists only a normalized known fixture profile", () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  const saved = saveFixtureMapProfile({
    ...DEFAULT_FIXTURE_MAP_PROFILE,
    selectedFixtureId: "V3",
    unknown: "ignored",
  }, storage);
  assert.equal(saved.selectedFixtureId, "V3");
  assert.equal("unknown" in saved, false);
  assert.deepEqual(loadFixtureMapProfile(storage), saved);
});

test("corrupt stored fixture data falls back to defaults", () => {
  const storage = { getItem: () => "{broken", setItem: () => {} };
  assert.deepEqual(loadFixtureMapProfile(storage), normalizeFixtureMapProfile(DEFAULT_FIXTURE_MAP_PROFILE));
});
