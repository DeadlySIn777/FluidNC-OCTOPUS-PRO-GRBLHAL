import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  PENDING_RIGID_TAPPING_EVIDENCE,
  RIGID_TAPPING_AUDIT,
  RIGID_TAPPING_GATE_IDS,
  calculateRigidTappingDemand,
  evaluateRigidTappingReadiness,
} from "../src/rigid-tapping.js";

const pendingProfile = JSON.parse(readFileSync(
  new URL("../../grblHAL-STM32F4/mr1/servo-profile.pending.json", import.meta.url),
  "utf8",
));
const proof = pendingProfile.rigidTappingProof;

test("control screen matches the locked rigid-tapping proof record", () => {
  assert.deepEqual(RIGID_TAPPING_AUDIT, {
    status: proof.status,
    gcode: proof.gcode,
    controllerDecision: proof.controllerDecision,
    pinnedCoreCommit: proof.pinnedCoreCommit,
    pinnedCoreParserSupport: proof.pinnedCoreParserSupport,
    pinnedCoreMotionImplementation: proof.pinnedCoreMotionImplementation,
  });
  assert.deepEqual(RIGID_TAPPING_GATE_IDS, Object.keys(proof.gates));
  assert.deepEqual(PENDING_RIGID_TAPPING_EVIDENCE, proof.gates);
  assert.equal(proof.productionAuthorized, false);
});

test("tap demand uses pitch times spindle RPM and the canonical Z rate", () => {
  assert.deepEqual(calculateRigidTappingDemand(1, 500), {
    pitchMmPerRevolution: 1,
    spindleRpm: 500,
    feedMmPerMinute: 500,
    zRateMmPerMinute: 1016,
    zRateUtilizationPercent: 500 / 1016 * 100,
    zRateHeadroomMmPerMinute: 516,
    withinConfiguredZRate: true,
  });
  assert.equal(calculateRigidTappingDemand(1.27, 800).feedMmPerMinute, 1016);
  assert.equal(calculateRigidTappingDemand(1.27, 801).withinConfiguredZRate, false);
  assert.equal(calculateRigidTappingDemand(0, 500), null);
  assert.equal(calculateRigidTappingDemand(1, Number.NaN), null);
});

test("readiness cannot pass on partial evidence or without final authorization", () => {
  const pending = evaluateRigidTappingReadiness(PENDING_RIGID_TAPPING_EVIDENCE);
  assert.equal(pending.ready, false);
  assert.equal(pending.passed, 0);
  assert.equal(pending.blockers.length, RIGID_TAPPING_GATE_IDS.length);

  const allGates = Object.fromEntries(RIGID_TAPPING_GATE_IDS.map((gate) => [gate, true]));
  assert.equal(evaluateRigidTappingReadiness(allGates, false).ready, false);
  assert.equal(evaluateRigidTappingReadiness(allGates, true).ready, true);

  allGates.encoderLossFaultVerified = false;
  assert.equal(evaluateRigidTappingReadiness(allGates, true).ready, false);
});
