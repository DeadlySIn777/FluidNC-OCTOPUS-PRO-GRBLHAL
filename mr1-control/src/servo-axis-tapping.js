import { MR1_CONFIG } from "./machine-config.js";

export const SERVO_AXIS_TAPPING_PROFILE = Object.freeze({
  status: "source-feasible-hardware-unverified",
  method: "coordinated-rotary-axis",
  productionFirmwareTarget: "btt_octopus_pro_f429_mr1",
  qualificationFirmwareTarget: "btt_octopus_pro_f429_mr1_servo_axis_lab",
  commandPulsesPerMotorRevolution: 1000,
  spindleRevolutionsPerMotorRevolution: 2,
  maximumSpindleRpm: 8000,
  maximumARateDegreesPerMinute: 2_880_000,
  maximumAPulseRateHz: 66_666.666667,
  previewOnly: true,
});

export const SERVO_AXIS_TAPPING_GATE_IDS = Object.freeze([
  "octopusBoardAndMcuVerified",
  "qualificationFirmwareBenchFlashed",
  "fiveMotionOutputsScopeVerified",
  "dualYHomingVerified",
  "installedServoDriveIdentified",
  "servoParameterArchiveCaptured",
  "positionModeSupported",
  "speedPositionModeSwitchVerified",
  "pulseDirectionInputVerified",
  "electronicGearingVerified",
  "spindleToMotorRatioVerified",
  "isolatedInterfaceApproved",
  "forwardAndReverseDirectionVerified",
  "servoAlarmHardStopVerified",
  "spindleFollowingErrorLimitVerified",
  "closedLoopZDriveCommissioned",
  "zReturnTrackingVerified",
  "azRatioScopeVerified",
  "bottomReversalScopeVerified",
  "feedHoldAndResetVerified",
  "usbDisconnectSafeStateVerified",
  "waxTestPassed",
  "aluminumTestPassed",
]);

export const PENDING_SERVO_AXIS_TAPPING_EVIDENCE = Object.freeze(
  Object.fromEntries(SERVO_AXIS_TAPPING_GATE_IDS.map((gate) => [gate, false])),
);

function positiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

export function calculateServoAxisTapPlan(options = {}) {
  const pitchMm = positiveNumber(options.pitchMm);
  const depthMm = positiveNumber(options.depthMm);
  const spindleRpm = positiveNumber(options.spindleRpm);
  const commandPulsesPerMotorRevolution = positiveNumber(
    options.commandPulsesPerMotorRevolution
      ?? SERVO_AXIS_TAPPING_PROFILE.commandPulsesPerMotorRevolution,
  );
  const spindleRevolutionsPerMotorRevolution = positiveNumber(
    options.spindleRevolutionsPerMotorRevolution
      ?? SERVO_AXIS_TAPPING_PROFILE.spindleRevolutionsPerMotorRevolution,
  );
  const zStepsPerMillimeter = positiveNumber(options.zStepsPerMillimeter ?? MR1_CONFIG.stepsPerMm.z);

  if (!pitchMm || !depthMm || !spindleRpm || !commandPulsesPerMotorRevolution
      || !spindleRevolutionsPerMotorRevolution || !zStepsPerMillimeter) return null;

  const spindleTurns = depthMm / pitchMm;
  const aDegrees = spindleTurns * 360;
  const motorTurns = spindleTurns / spindleRevolutionsPerMotorRevolution;
  const commandPulsesPerSpindleRevolution = commandPulsesPerMotorRevolution
    / spindleRevolutionsPerMotorRevolution;
  const aStepsPerDegree = commandPulsesPerSpindleRevolution / 360;
  const aCommandPulses = Math.round(aDegrees * aStepsPerDegree);
  const zCommandPulses = Math.round(depthMm * zStepsPerMillimeter);
  const representedSpindleTurns = aCommandPulses / commandPulsesPerSpindleRevolution;
  const representedDepthMm = zCommandPulses / zStepsPerMillimeter;
  const representedPitchMm = representedDepthMm / representedSpindleTurns;
  const zFeedMmPerMinute = pitchMm * spindleRpm;
  const aRateDegreesPerMinute = spindleRpm * 360;
  const aPulseRateHz = spindleRpm * commandPulsesPerSpindleRevolution / 60;
  const zPulseRateHz = zFeedMmPerMinute * zStepsPerMillimeter / 60;
  const nominalBlockMinutes = spindleTurns / spindleRpm;
  const inverseTimeFeed = 1 / nominalBlockMinutes;
  const withinZRate = zFeedMmPerMinute <= MR1_CONFIG.maxRate.z;
  const withinARate = aRateDegreesPerMinute <= SERVO_AXIS_TAPPING_PROFILE.maximumARateDegreesPerMinute;
  const withinAPulseRate = aPulseRateHz <= SERVO_AXIS_TAPPING_PROFILE.maximumAPulseRateHz;

  return Object.freeze({
    pitchMm,
    depthMm,
    spindleRpm,
    spindleTurns,
    motorTurns,
    aDegrees,
    commandPulsesPerMotorRevolution,
    spindleRevolutionsPerMotorRevolution,
    commandPulsesPerSpindleRevolution,
    aStepsPerDegree,
    aCommandPulses,
    zStepsPerMillimeter,
    zCommandPulses,
    representedPitchMm,
    pitchQuantizationErrorMicrometers: (representedPitchMm - pitchMm) * 1000,
    zFeedMmPerMinute,
    aRateDegreesPerMinute,
    aPulseRateHz,
    zPulseRateHz,
    nominalBlockMinutes,
    inverseTimeFeed,
    withinZRate,
    withinARate,
    withinAPulseRate,
    withinConfiguredRates: withinZRate && withinARate && withinAPulseRate,
  });
}

export function buildServoAxisTapPreview(options = {}) {
  const plan = calculateServoAxisTapPlan(options);
  if (!plan) return null;

  const depth = plan.depthMm.toFixed(4);
  const degrees = plan.aDegrees.toFixed(4);
  const inverseTimeFeed = plan.inverseTimeFeed.toFixed(6);
  const lines = Object.freeze([
    "(MR-1 SERVO-AXIS TAP PREVIEW - LAB QUALIFICATION ONLY)",
    "(NO MACHINE COMMAND AUTHORITY; POSITION MODE MUST BE COMMISSIONED FIRST)",
    "G21 G17 G40 G49 G80 G90 G94",
    "G91 G93",
    `G1 Z-${depth} A${degrees} F${inverseTimeFeed}`,
    `G1 Z${depth} A-${degrees} F${inverseTimeFeed}`,
    "G90 G94",
    "M2",
  ]);

  return Object.freeze({
    previewOnly: true,
    plan,
    lines,
    gcode: lines.join("\n"),
  });
}

export function evaluateServoAxisTappingReadiness(evidence, productionAuthorized = false) {
  const source = evidence && typeof evidence === "object" ? evidence : {};
  const gates = Object.freeze(Object.fromEntries(
    SERVO_AXIS_TAPPING_GATE_IDS.map((gate) => [gate, source[gate] === true]),
  ));
  const blockers = Object.freeze(SERVO_AXIS_TAPPING_GATE_IDS.filter((gate) => !gates[gate]));
  const authorized = productionAuthorized === true;
  return Object.freeze({
    gates,
    blockers,
    passed: SERVO_AXIS_TAPPING_GATE_IDS.length - blockers.length,
    total: SERVO_AXIS_TAPPING_GATE_IDS.length,
    productionAuthorized: authorized,
    ready: blockers.length === 0 && authorized,
  });
}
