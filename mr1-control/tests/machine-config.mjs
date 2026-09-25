import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  coolantAccessoryMode,
  coordinatedRapidFeed,
  leadScrewRotationRadians,
  machineYToSceneZ,
  MR1_CONFIG,
} from "../src/machine-config.js";

const firmwareRoot = new URL("../../grblHAL-STM32F4/", import.meta.url);

test("control-screen machine constants match the canonical firmware baseline", async () => {
  const manifest = JSON.parse(await readFile(new URL("mr1/io-manifest.json", firmwareRoot), "utf8"));
  const expectedSettings = JSON.parse(
    await readFile(new URL("mr1/expected-settings.json", firmwareRoot), "utf8"),
  );
  const pullOff = expectedSettings.settings.find((setting) => setting.id === 27)?.expected;

  assert.deepEqual(MR1_CONFIG.configuredTravel, manifest.machine.travel_mm.initial_soft_limit);
  assert.deepEqual(MR1_CONFIG.maxRate, manifest.machine.max_rate_mm_min);
  assert.deepEqual(MR1_CONFIG.screwLeadMm, manifest.motion.screw_lead_mm);
  assert.equal(MR1_CONFIG.homingPullOff, pullOff);
  assert.deepEqual(MR1_CONFIG.machineEnvelope.x, { min: -564.42, max: -2, span: 562.42 });
  assert.deepEqual(MR1_CONFIG.machineEnvelope.y, { min: -544.1, max: -2, span: 542.1 });
  assert.deepEqual(MR1_CONFIG.machineEnvelope.z, { min: -152.94, max: -2, span: 150.94 });
});

test("lead-screw rotation follows the canonical X/Y/Z screw leads", () => {
  assert.equal(leadScrewRotationRadians("x", 5), Math.PI * 2);
  assert.equal(leadScrewRotationRadians("y", -2.5), -Math.PI);
  assert.equal(leadScrewRotationRadians("z", 3), Math.PI * 2);
  assert.equal(Number.isNaN(leadScrewRotationRadians("a", 1)), true);
});

test("coolant accessory flags produce one explicit visual mode", () => {
  assert.equal(coolantAccessoryMode({}), "off");
  assert.equal(coolantAccessoryMode({ flood: true }), "flood");
  assert.equal(coolantAccessoryMode({ mist: true }), "mist");
  assert.equal(coolantAccessoryMode({ flood: true, mist: true }), "flood-mist");
});

test("coordinated rapid timing limits every moving axis", () => {
  assert.equal(coordinatedRapidFeed({ x: 0, y: 0, z: 0 }, { x: 100, y: 0, z: 0 }), 2540);
  assert.equal(coordinatedRapidFeed({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 100 }), 1016);

  const feed = coordinatedRapidFeed({ x: 0, y: 0, z: 0 }, { x: 100, y: 0, z: 100 });
  const distance = Math.hypot(100, 100);
  assert.ok(feed * 100 / distance <= MR1_CONFIG.maxRate.x + 1e-9);
  assert.ok(feed * 100 / distance <= MR1_CONFIG.maxRate.z + 1e-9);
});

test("operator view renders positive machine Y toward the back", () => {
  assert.equal(machineYToSceneZ(125), -125);
  assert.equal(machineYToSceneZ(-125), 125);
  assert.equal(machineYToSceneZ(0), 0);
  assert.equal(Number.isNaN(machineYToSceneZ("unknown")), true);
});

test("the control screen is pinned to the optimized MR-1 assembly", () => {
  assert.equal(MR1_CONFIG.machineAssembly.modelUrl, "/models/mr1-lower-assembly.glb");
  assert.deepEqual(MR1_CONFIG.machineAssembly.sourceBounds, {
    width: 1117.606,
    depth: 1143.006,
    height: 1560.887,
  });
  assert.deepEqual(MR1_CONFIG.machineAssembly.hiddenNodes, [
    "Base_Plate1",
    "Langmuir_Low_Profile_Vise_v71",
  ]);
});

test("SMW fixed-jaw and four corner drain geometry are explicit", () => {
  assert.equal(MR1_CONFIG.workholding.viseCad.modelRotationOffsetDeg, 180);
  assert.deepEqual(MR1_CONFIG.workholding.viseCad.fixedJaw, {
    leftX: -47.752,
    centerX: 0,
    rightX: 47.752,
    faceY: 39.326,
  });
  assert.deepEqual(MR1_CONFIG.workholding.viseCad.movableJaw, {
    assemblyNode: "Adjustable Side Assembly:1",
    modelOpening: 52.405,
    minOpening: 5,
    maxOpening: 300,
    step: 0.1,
  });
  assert.equal(MR1_CONFIG.drains.coverSize, 101.6);
  assert.equal(MR1_CONFIG.drains.outletDiameter, 50.8);
  assert.equal(MR1_CONFIG.drains.centers.length, 4);
  assert.deepEqual(
    MR1_CONFIG.drains.centers.map(({ assembly }) => assembly),
    ["Drain Assembly:1", "Drain Assembly:2", "Drain Assembly:4", "Drain Assembly:3"],
  );
});
