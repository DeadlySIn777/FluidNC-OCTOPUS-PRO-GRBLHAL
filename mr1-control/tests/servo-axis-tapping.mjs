import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  PENDING_SERVO_AXIS_TAPPING_EVIDENCE,
  SERVO_AXIS_TAPPING_GATE_IDS,
  SERVO_AXIS_TAPPING_PROFILE,
  buildServoAxisTapPreview,
  calculateServoAxisTapPlan,
  evaluateServoAxisTappingReadiness,
} from "../src/servo-axis-tapping.js";

const profile = JSON.parse(readFileSync(
  new URL("../../grblHAL-STM32F4/mr1/servo-axis-tapping.pending.json", import.meta.url),
  "utf8",
));

test("screen model matches the locked servo-axis qualification profile", () => {
  assert.equal(SERVO_AXIS_TAPPING_PROFILE.status, profile.status);
  assert.equal(SERVO_AXIS_TAPPING_PROFILE.method, profile.method);
  assert.equal(SERVO_AXIS_TAPPING_PROFILE.productionFirmwareTarget, profile.productionFirmwareTarget);
  assert.equal(SERVO_AXIS_TAPPING_PROFILE.qualificationFirmwareTarget, profile.qualificationFirmwareTarget);
  assert.equal(
    SERVO_AXIS_TAPPING_PROFILE.commandPulsesPerMotorRevolution,
    profile.provisionalElectronicGearing.commandPulsesPerMotorRevolution,
  );
  assert.equal(
    SERVO_AXIS_TAPPING_PROFILE.spindleRevolutionsPerMotorRevolution,
    profile.provisionalElectronicGearing.spindleRevolutionsPerMotorRevolution,
  );
  assert.deepEqual(SERVO_AXIS_TAPPING_GATE_IDS, Object.keys(profile.physicalGates));
  assert.deepEqual(PENDING_SERVO_AXIS_TAPPING_EVIDENCE, profile.physicalGates);
  assert.equal(profile.productionAuthorized, false);
});

test("A and Z command math preserves thread pitch through reversal", () => {
  const plan = calculateServoAxisTapPlan({ pitchMm: 1, depthMm: 10, spindleRpm: 300 });
  assert.equal(plan.spindleTurns, 10);
  assert.equal(plan.motorTurns, 5);
  assert.equal(plan.aDegrees, 3600);
  assert.equal(plan.commandPulsesPerSpindleRevolution, 500);
  assert.equal(plan.aStepsPerDegree, 500 / 360);
  assert.equal(plan.aCommandPulses, 5000);
  assert.equal(plan.zCommandPulses, 5333);
  assert.equal(plan.zFeedMmPerMinute, 300);
  assert.equal(plan.aRateDegreesPerMinute, 108000);
  assert.equal(plan.aPulseRateHz, 2500);
  assert.ok(Math.abs(plan.zPulseRateHz - 2666.666665) < 1e-6);
  assert.equal(plan.inverseTimeFeed, 30);
  assert.equal(plan.withinConfiguredRates, true);

  const preview = buildServoAxisTapPreview({ pitchMm: 1, depthMm: 10, spindleRpm: 300 });
  assert.equal(preview.previewOnly, true);
  assert.match(preview.lines[4], /^G1 Z-10\.0000 A3600\.0000 F30\.000000$/);
  assert.match(preview.lines[5], /^G1 Z10\.0000 A-3600\.0000 F30\.000000$/);
  assert.equal(preview.lines.some((line) => /G33\.1|M3|M4/.test(line)), false);
});

test("rate and pulse limits reject impossible demand without granting a permit", () => {
  assert.equal(calculateServoAxisTapPlan({ pitchMm: 0, depthMm: 10, spindleRpm: 300 }), null);
  assert.equal(calculateServoAxisTapPlan({ pitchMm: 1, depthMm: -1, spindleRpm: 300 }), null);
  assert.equal(calculateServoAxisTapPlan({ pitchMm: 1, depthMm: 10, spindleRpm: Number.NaN }), null);

  const overZ = calculateServoAxisTapPlan({ pitchMm: 1.25, depthMm: 10, spindleRpm: 1000 });
  assert.equal(overZ.withinZRate, false);
  assert.equal(overZ.withinConfiguredRates, false);

  const maximum = calculateServoAxisTapPlan({ pitchMm: 0.1, depthMm: 1, spindleRpm: 8000 });
  assert.ok(Math.abs(maximum.aPulseRateHz - 66_666.66666666667) < 1e-8);
  assert.equal(maximum.withinARate, true);
  assert.equal(maximum.withinAPulseRate, true);
});

test("all physical gates and separate production authorization are mandatory", () => {
  const pending = evaluateServoAxisTappingReadiness(PENDING_SERVO_AXIS_TAPPING_EVIDENCE);
  assert.equal(pending.ready, false);
  assert.equal(pending.passed, 0);
  assert.equal(pending.blockers.length, SERVO_AXIS_TAPPING_GATE_IDS.length);

  const allGates = Object.fromEntries(SERVO_AXIS_TAPPING_GATE_IDS.map((gate) => [gate, true]));
  assert.equal(evaluateServoAxisTappingReadiness(allGates, false).ready, false);
  assert.equal(evaluateServoAxisTappingReadiness(allGates, true).ready, true);
  allGates.usbDisconnectSafeStateVerified = false;
  assert.equal(evaluateServoAxisTappingReadiness(allGates, true).ready, false);
});
