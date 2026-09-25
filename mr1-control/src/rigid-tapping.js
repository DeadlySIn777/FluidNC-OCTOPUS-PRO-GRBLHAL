import { MR1_CONFIG } from "./machine-config.js";

export const RIGID_TAPPING_AUDIT = Object.freeze({
  status: "blocked-current-controller",
  gcode: "G33.1",
  controllerDecision: "unselected",
  pinnedCoreCommit: "779d41b8d86e3042f13df326d92dd34ae1825e24",
  pinnedCoreParserSupport: false,
  pinnedCoreMotionImplementation: false,
});

export const RIGID_TAPPING_GATE_IDS = Object.freeze([
  "productionControllerSelected",
  "directSpindleEncoderInstalled",
  "singleIndexPerSpindleRevolutionVerified",
  "bidirectionalPhaseFeedbackVerified",
  "m4ReverseVerified",
  "atSpeedInterlockVerified",
  "encoderLossFaultVerified",
  "zAxisTrackingVerified",
  "reversalOvershootCharacterized",
  "waxTestPassed",
  "aluminumTestPassed",
]);

export const PENDING_RIGID_TAPPING_EVIDENCE = Object.freeze(
  Object.fromEntries(RIGID_TAPPING_GATE_IDS.map((gate) => [gate, false])),
);

export function calculateRigidTappingDemand(pitchMmPerRevolution, spindleRpm) {
  const pitch = Number(pitchMmPerRevolution);
  const rpm = Number(spindleRpm);
  if (!Number.isFinite(pitch) || pitch <= 0 || !Number.isFinite(rpm) || rpm <= 0) return null;

  const feedMmPerMinute = pitch * rpm;
  const zRateMmPerMinute = MR1_CONFIG.maxRate.z;
  return Object.freeze({
    pitchMmPerRevolution: pitch,
    spindleRpm: rpm,
    feedMmPerMinute,
    zRateMmPerMinute,
    zRateUtilizationPercent: feedMmPerMinute / zRateMmPerMinute * 100,
    zRateHeadroomMmPerMinute: zRateMmPerMinute - feedMmPerMinute,
    withinConfiguredZRate: feedMmPerMinute <= zRateMmPerMinute,
  });
}

export function evaluateRigidTappingReadiness(evidence, productionAuthorized = false) {
  const source = evidence && typeof evidence === "object" ? evidence : {};
  const gates = Object.freeze(Object.fromEntries(
    RIGID_TAPPING_GATE_IDS.map((gate) => [gate, source[gate] === true]),
  ));
  const blockers = Object.freeze(RIGID_TAPPING_GATE_IDS.filter((gate) => !gates[gate]));
  const authorized = productionAuthorized === true;
  return Object.freeze({
    gates,
    blockers,
    passed: RIGID_TAPPING_GATE_IDS.length - blockers.length,
    total: RIGID_TAPPING_GATE_IDS.length,
    productionAuthorized: authorized,
    ready: blockers.length === 0 && authorized,
  });
}
