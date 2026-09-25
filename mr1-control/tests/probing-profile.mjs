import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_PROBING_PROFILE,
  PROBING_PROFILE_STORAGE_KEY,
  evaluateToolSetter,
  evaluateTouchProbe,
  loadProbingProfile,
  normalizeProbingProfile,
  saveProbingProfile,
} from "../src/probing-profile.js";

test("a four inch tool shifts the predicted contact without changing the three millimeter fine search", () => {
  const settings = {
    ...DEFAULT_PROBING_PROFILE.toolSetter,
    x: -110,
    y: -80,
    travelZ: -20,
    referenceContactZ: -100,
    referenceGaugeLength: 40,
    currentToolNumber: 7,
    currentGaugeLength: 101.6,
  };
  const result = evaluateToolSetter(settings);

  assert.equal(result.ready, true);
  assert.equal(Number(result.envelope.lengthDelta.toFixed(3)), 61.6);
  assert.equal(Number(result.envelope.expectedContactZ.toFixed(3)), -38.4);
  assert.equal(Number(result.envelope.approachZ.toFixed(3)), -36.4);
  assert.equal(Number(result.envelope.targetZ.toFixed(3)), -39.4);
  assert.equal(Number(result.envelope.retractZ.toFixed(3)), -33.4);
  assert.equal(Number(result.envelope.guardedTravel.toFixed(3)), 16.4);
  assert.equal(result.envelope.pastExpected, 1);
  assert.equal(result.envelope.totalSearch, 3);
  assert.equal(result.envelope.latchSearch, 1.5);
});

test("setter profile constrains the inter-touch pull-off", () => {
  assert.equal(evaluateToolSetter(DEFAULT_PROBING_PROFILE.toolSetter).valid, true);
  const result = evaluateToolSetter({
    ...DEFAULT_PROBING_PROFILE.toolSetter,
    latchPullOff: 2.5,
  });
  assert.equal(result.valid, false);
  assert.match(result.errors.join(" "), /Latch pull-off must be between 0.5 and 2/);
});

test("setter profile rejects the stock-style half-inch search distance", () => {
  const result = evaluateToolSetter({
    ...DEFAULT_PROBING_PROFILE.toolSetter,
    maxSearch: 12.7,
  });
  assert.equal(result.valid, false);
  assert.match(result.errors.join(" "), /Maximum search must be between 1 and 5/);
});

test("setter profile refuses excess travel below the expected contact", () => {
  const result = evaluateToolSetter({
    ...DEFAULT_PROBING_PROFILE.toolSetter,
    approachClearance: 2,
    maxSearch: 4,
  });
  assert.equal(result.valid, false);
  assert.match(result.errors.join(" "), /cannot exceed 1 mm/);
});

test("uncalibrated setter settings can be valid but cannot be ready", () => {
  const result = evaluateToolSetter(DEFAULT_PROBING_PROFILE.toolSetter);
  assert.equal(result.valid, true);
  assert.equal(result.calibrated, false);
  assert.equal(result.toolReady, false);
  assert.equal(result.ready, false);
  assert.equal(result.envelope, null);
});

test("a calibrated setter still refuses readiness without the current tool length", () => {
  const result = evaluateToolSetter({
    ...DEFAULT_PROBING_PROFILE.toolSetter,
    x: -110,
    y: -80,
    travelZ: -20,
    referenceContactZ: -100,
    referenceGaugeLength: 40,
  });
  assert.equal(result.valid, true);
  assert.equal(result.calibrated, true);
  assert.equal(result.toolReady, false);
  assert.equal(result.ready, false);
});

test("a live controller tool mismatch blocks readiness without corrupting the saved profile", () => {
  const settings = {
    ...DEFAULT_PROBING_PROFILE.toolSetter,
    x: -110,
    y: -80,
    travelZ: -20,
    referenceContactZ: -100,
    referenceGaugeLength: 40,
    currentToolNumber: 7,
    currentGaugeLength: 101.6,
  };
  const result = evaluateToolSetter(settings, { activeTool: 3 });
  assert.equal(result.valid, true);
  assert.equal(result.toolReady, true);
  assert.equal(result.toolMatches, false);
  assert.equal(result.ready, false);
});

test("travel Z must remain above the calculated retract target", () => {
  const result = evaluateToolSetter({
    ...DEFAULT_PROBING_PROFILE.toolSetter,
    x: -110,
    y: -80,
    travelZ: -40,
    referenceContactZ: -100,
    referenceGaugeLength: 40,
    currentToolNumber: 7,
    currentGaugeLength: 101.6,
  });
  assert.equal(result.valid, false);
  assert.match(result.errors.join(" "), /Travel Z must be at or above/);
});

test("touch probe profile enforces separate feed and travel limits", () => {
  assert.equal(evaluateTouchProbe(DEFAULT_PROBING_PROFILE.touchProbe).valid, true);
  const result = evaluateTouchProbe({
    ...DEFAULT_PROBING_PROFILE.touchProbe,
    maxSearch: 30,
    latchFeed: 30,
  });
  assert.equal(result.valid, false);
  assert.equal(result.errors.length, 3);
});

test("Z surface planner derives ball-center contact, bounded search, and fail retract", () => {
  const result = evaluateTouchProbe({
    ...DEFAULT_PROBING_PROFILE.touchProbe,
    targetX: -283.21,
    targetY: -273.05,
    targetZ: -30,
    safeZ: -20,
  });
  assert.equal(result.ready, true);
  assert.equal(result.plan.contactCount, 1);
  assert.equal(result.plan.reportedTouchCount, 2);
  assert.deepEqual(result.plan.contacts[0].expectedCenter, { x: -283.21, y: -273.05, z: -27 });
  assert.deepEqual(result.plan.contacts[0].start, { x: -283.21, y: -273.05, z: -23 });
  assert.deepEqual(result.plan.contacts[0].searchLimit, { x: -283.21, y: -273.05, z: -28 });
  assert.deepEqual(result.plan.contacts[0].retract, { x: -283.21, y: -273.05, z: -24 });
  assert.equal(result.plan.contacts[0].pastExpected, 1);
});

test("outside-corner planner samples both material faces with explicit quadrant directions", () => {
  const result = evaluateTouchProbe({
    ...DEFAULT_PROBING_PROFILE.touchProbe,
    cycle: "outside-corner",
    targetX: -250,
    targetY: -240,
    safeZ: -20,
    measurementZ: -40,
    directionX: -1,
    directionY: 1,
  });
  assert.equal(result.ready, true);
  assert.deepEqual(result.plan.contacts.map(({ id, directionLabel }) => [id, directionLabel]), [
    ["corner-x", "-X"],
    ["corner-y", "+Y"],
  ]);
  assert.equal(result.plan.contacts[0].start.y, -230);
  assert.equal(result.plan.contacts[1].start.x, -260);
});

test("bore planner creates four cardinal contacts and limits overtravel to one millimeter", () => {
  const result = evaluateTouchProbe({
    ...DEFAULT_PROBING_PROFILE.touchProbe,
    cycle: "bore-center",
    targetX: -250,
    targetY: -240,
    safeZ: -20,
    measurementZ: -40,
    featureDiameter: 14,
  });
  assert.equal(result.ready, true);
  assert.equal(result.plan.contactCount, 4);
  assert.equal(result.plan.reportedTouchCount, 8);
  assert.deepEqual(result.plan.contacts.map(({ id }) => id), [
    "bore-x-plus", "bore-x-minus", "bore-y-plus", "bore-y-minus",
  ]);
  assert.equal(result.plan.contacts[0].expectedCenter.x, -246);
  assert.equal(result.plan.contacts[0].surfaceCoordinate, -243);
  assert.equal(result.plan.contacts[0].pastExpected, 1);
});

test("touch planner keeps incomplete drafts valid but blocks readiness and rejects unsafe geometry", () => {
  const draft = evaluateTouchProbe(DEFAULT_PROBING_PROFILE.touchProbe);
  assert.equal(draft.valid, true);
  assert.equal(draft.configured, false);
  assert.equal(draft.ready, false);
  assert.deepEqual(draft.missing, ["Safe Z", "Target X", "Target Y", "Target Z"]);

  const unsafe = evaluateTouchProbe({
    ...DEFAULT_PROBING_PROFILE.touchProbe,
    targetX: -283.21,
    targetY: -273.05,
    targetZ: -30,
    safeZ: -24,
    maxSearch: 7,
  });
  assert.equal(unsafe.ready, false);
  assert.match(unsafe.errors.join(" "), /cannot exceed 1 mm/);
  assert.match(unsafe.errors.join(" "), /Safe Z must be at least 1 mm above/);
});

test("setter calibration refuses coordinates outside the homed machine envelope", () => {
  const result = evaluateToolSetter({
    ...DEFAULT_PROBING_PROFILE.toolSetter,
    x: 110,
    y: -80,
    travelZ: -20,
    referenceContactZ: -100,
    referenceGaugeLength: 40,
    currentToolNumber: 7,
    currentGaugeLength: 101.6,
  });
  assert.equal(result.valid, false);
  assert.match(result.errors.join(" "), /Setter X must be inside -564.42 to -2.00 mm MPOS/);
});

test("predicted tool contact and retract must remain inside Z travel", () => {
  const result = evaluateToolSetter({
    ...DEFAULT_PROBING_PROFILE.toolSetter,
    x: -110,
    y: -80,
    travelZ: -20,
    referenceContactZ: -150,
    referenceGaugeLength: 100,
    currentToolNumber: 8,
    currentGaugeLength: 50,
  });
  assert.equal(result.valid, false);
  assert.match(result.errors.join(" "), /Expected contact Z must be inside/);
});

test("probing profile persists only normalized known settings", () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  const profile = normalizeProbingProfile({
    toolSetter: { x: "-15.25", maxSearch: "3", currentGaugeLength: "101.6", unknown: 99 },
    touchProbe: { cycle: "bore-center", tipDiameter: "3" },
    ignored: true,
  });
  saveProbingProfile(profile, storage);
  const loaded = loadProbingProfile(storage);

  assert.equal(loaded.toolSetter.x, -15.25);
  assert.equal(loaded.toolSetter.maxSearch, 3);
  assert.equal(loaded.toolSetter.currentGaugeLength, 101.6);
  assert.equal(loaded.touchProbe.cycle, "bore-center");
  assert.equal(loaded.touchProbe.tipDiameter, 3);
  assert.equal("unknown" in loaded.toolSetter, false);
  assert.ok(values.has(PROBING_PROFILE_STORAGE_KEY));
});

test("corrupt stored probing data falls back to safe defaults", () => {
  const storage = { getItem: () => "{broken" };
  const loaded = loadProbingProfile(storage);
  assert.deepEqual(loaded, normalizeProbingProfile(DEFAULT_PROBING_PROFILE));
});
