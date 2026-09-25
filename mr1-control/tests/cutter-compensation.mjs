import assert from "node:assert/strict";
import test from "node:test";
import {
  CONTROLLER_CUTTER_COMPENSATION,
  CUTTER_COMPENSATION_STORAGE_KEY,
  DEFAULT_CUTTER_COMPENSATION_PROFILE,
  evaluateCutterCompensation,
  jobToolNumbers,
  loadCutterCompensationProfile,
  normalizeCutterCompensationProfile,
  removeCutterTool,
  saveCutterCompensationProfile,
  upsertCutterTool,
} from "../src/cutter-compensation.js";

const baseTool = {
  number: 3,
  label: "6 MM FINISHER",
  programmedDiameterMm: 6,
  measuredDiameterMm: 5.992,
  correctionMode: "tool",
  featureType: "external",
  targetSizeMm: null,
  measuredSizeMm: null,
};

test("controller contract keeps compensation in Fusion and blocks G41/G42", () => {
  assert.equal(CONTROLLER_CUTTER_COMPENSATION.supportedCode, "G40");
  assert.equal(CONTROLLER_CUTTER_COMPENSATION.fusionMode, "IN COMPUTER");
  assert.deepEqual(CONTROLLER_CUTTER_COMPENSATION.blockedCodes, ["G41", "G41.1", "G42", "G42.1"]);
});

test("direct cutter measurement recommends the measured Fusion diameter", () => {
  const result = evaluateCutterCompensation(baseTool);
  assert.equal(result.ready, true);
  assert.equal(result.recommendation.nextFusionDiameterMm, 5.992);
  assert.equal(Number(result.recommendation.diameterAdjustmentMm.toFixed(3)), -0.008);
  assert.equal(Number(result.recommendation.radialPathShiftMm.toFixed(3)), 0.004);
  assert.equal(result.recommendation.requiresRepost, true);
});

test("external feature correction subtracts diametral size error", () => {
  const result = evaluateCutterCompensation({
    ...baseTool,
    correctionMode: "feature",
    featureType: "external",
    targetSizeMm: 50,
    measuredSizeMm: 50.04,
  });
  assert.equal(result.ready, true);
  assert.equal(Number(result.recommendation.featureErrorMm.toFixed(3)), 0.04);
  assert.equal(Number(result.recommendation.nextFusionDiameterMm.toFixed(3)), 5.96);
  assert.equal(Number(result.recommendation.radialPathShiftMm.toFixed(3)), 0.02);
});

test("internal feature correction adds diametral size error", () => {
  const result = evaluateCutterCompensation({
    ...baseTool,
    correctionMode: "feature",
    featureType: "internal",
    targetSizeMm: 25,
    measuredSizeMm: 24.97,
  });
  assert.equal(result.ready, true);
  assert.equal(Number(result.recommendation.nextFusionDiameterMm.toFixed(3)), 5.97);
});

test("large corrections are held instead of being presented as ready", () => {
  const feature = evaluateCutterCompensation({
    ...baseTool,
    correctionMode: "feature",
    targetSizeMm: 25,
    measuredSizeMm: 25.4,
  }, { maxFeatureErrorMm: 0.25 });
  const cutter = evaluateCutterCompensation({
    ...baseTool,
    measuredDiameterMm: 5.4,
  });
  assert.equal(feature.valid, true);
  assert.equal(feature.ready, false);
  assert.match(feature.holds.join(" "), /correction limit/);
  assert.equal(cutter.ready, false);
  assert.match(cutter.holds.join(" "), /tool identity/);
});

test("incomplete and impossible cutter inputs fail closed", () => {
  const incomplete = evaluateCutterCompensation({ number: 2, correctionMode: "tool" });
  const impossible = evaluateCutterCompensation({
    ...baseTool,
    correctionMode: "feature",
    targetSizeMm: 1,
    measuredSizeMm: 10,
  }, { maxFeatureErrorMm: 1 });
  assert.equal(incomplete.valid, false);
  assert.match(incomplete.errors.join(" "), /Fusion diameter/);
  assert.equal(impossible.ready, false);
  assert.match(impossible.holds.join(" "), /outside the supported tool range/);
});

test("tool library persistence strips unknown fields and survives corrupt storage", () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  let profile = upsertCutterTool(DEFAULT_CUTTER_COMPENSATION_PROFILE, {
    ...baseTool,
    ignored: true,
  });
  profile = saveCutterCompensationProfile({ ...profile, ignored: true }, storage);
  const loaded = loadCutterCompensationProfile(storage);
  assert.equal(loaded.activeTool, 3);
  assert.equal(loaded.tools["3"].measuredDiameterMm, 5.992);
  assert.equal("ignored" in loaded.tools["3"], false);
  assert.ok(values.has(CUTTER_COMPENSATION_STORAGE_KEY));

  const corrupt = loadCutterCompensationProfile({ getItem: () => "{broken" });
  assert.deepEqual(corrupt, normalizeCutterCompensationProfile(DEFAULT_CUTTER_COMPENSATION_PROFILE));
});

test("removing tools keeps a usable profile and job tool detection is unique", () => {
  const profile = upsertCutterTool(DEFAULT_CUTTER_COMPENSATION_PROFILE, baseTool);
  const withoutThree = removeCutterTool(profile, 3);
  const withoutLast = removeCutterTool(DEFAULT_CUTTER_COMPENSATION_PROFILE, 1);
  assert.equal(withoutThree.activeTool, 1);
  assert.ok(withoutLast.tools["1"]);
  assert.deepEqual(jobToolNumbers({ segments: [{ tool: 3 }, { tool: 1 }, { tool: 3 }, { tool: 0 }] }, 7), [1, 3, 7]);
});
