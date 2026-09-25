import { MR1_CONFIG } from "./machine-config.js";

export const PROBING_PROFILE_STORAGE_KEY = "mr1-control.probing-profile.v2";
const TOUCH_CYCLES = new Set(["z-surface", "x-edge", "y-edge", "outside-corner", "bore-center"]);

export const TOUCH_PROBE_LIMITS = Object.freeze({
  maxSearch: 25,
  maxPastExpected: 1,
  maxTipDiameter: 20,
  maxFeatureDiameter: 50,
  maxGuardedApproachFeed: 250,
  maxSeekFeed: 100,
  maxLatchFeed: 25,
  maxRetractFeed: 250,
});

export const TOOL_SETTER_LIMITS = Object.freeze({
  maxSearch: 5,
  maxPastExpected: 1,
  maxGaugeLength: 200,
  maxGuardedApproachFeed: 250,
  maxSeekFeed: 100,
  maxLatchFeed: 25,
});

export const DEFAULT_PROBING_PROFILE = Object.freeze({
  version: 3,
  toolSetter: Object.freeze({
    x: null,
    y: null,
    travelZ: null,
    referenceContactZ: null,
    referenceGaugeLength: null,
    currentToolNumber: null,
    currentGaugeLength: null,
    approachClearance: 2,
    maxSearch: 3,
    retractDistance: 5,
    guardedApproachFeed: 100,
    latchPullOff: 1,
    seekFeed: 50,
    latchFeed: 10,
    retractFeed: 50,
    doubleTouch: true,
  }),
  touchProbe: Object.freeze({
    cycle: "z-surface",
    tipDiameter: 6,
    targetX: null,
    targetY: null,
    targetZ: null,
    safeZ: null,
    measurementZ: null,
    directionX: 1,
    directionY: 1,
    featureDiameter: null,
    cornerSampleOffset: 10,
    approachClearance: 4,
    maxSearch: 5,
    retractDistance: 3,
    guardedApproachFeed: 100,
    latchPullOff: 1,
    seekFeed: 25,
    latchFeed: 10,
    retractFeed: 100,
    doubleTouch: true,
  }),
});

function finiteOr(value, fallback) {
  if (value === null || value === undefined || value === "") return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function optionalNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function booleanOr(value, fallback) {
  return typeof value === "boolean" ? value : fallback;
}

function directionOr(value, fallback) {
  const number = Number(value);
  return number === -1 || number === 1 ? number : fallback;
}

export function normalizeProbingProfile(candidate = {}) {
  const setter = candidate.toolSetter ?? {};
  const touch = candidate.touchProbe ?? {};
  return {
    version: 3,
    toolSetter: {
      x: optionalNumber(setter.x),
      y: optionalNumber(setter.y),
      travelZ: optionalNumber(setter.travelZ),
      referenceContactZ: optionalNumber(setter.referenceContactZ),
      referenceGaugeLength: optionalNumber(setter.referenceGaugeLength),
      currentToolNumber: optionalNumber(setter.currentToolNumber),
      currentGaugeLength: optionalNumber(setter.currentGaugeLength),
      approachClearance: finiteOr(setter.approachClearance, DEFAULT_PROBING_PROFILE.toolSetter.approachClearance),
      maxSearch: finiteOr(setter.maxSearch, DEFAULT_PROBING_PROFILE.toolSetter.maxSearch),
      retractDistance: finiteOr(setter.retractDistance, DEFAULT_PROBING_PROFILE.toolSetter.retractDistance),
      guardedApproachFeed: finiteOr(setter.guardedApproachFeed, DEFAULT_PROBING_PROFILE.toolSetter.guardedApproachFeed),
      latchPullOff: finiteOr(setter.latchPullOff, DEFAULT_PROBING_PROFILE.toolSetter.latchPullOff),
      seekFeed: finiteOr(setter.seekFeed, DEFAULT_PROBING_PROFILE.toolSetter.seekFeed),
      latchFeed: finiteOr(setter.latchFeed, DEFAULT_PROBING_PROFILE.toolSetter.latchFeed),
      retractFeed: finiteOr(setter.retractFeed, DEFAULT_PROBING_PROFILE.toolSetter.retractFeed),
      doubleTouch: booleanOr(setter.doubleTouch, DEFAULT_PROBING_PROFILE.toolSetter.doubleTouch),
    },
    touchProbe: {
      cycle: TOUCH_CYCLES.has(touch.cycle) ? touch.cycle : DEFAULT_PROBING_PROFILE.touchProbe.cycle,
      tipDiameter: finiteOr(touch.tipDiameter, DEFAULT_PROBING_PROFILE.touchProbe.tipDiameter),
      targetX: optionalNumber(touch.targetX),
      targetY: optionalNumber(touch.targetY),
      targetZ: optionalNumber(touch.targetZ),
      safeZ: optionalNumber(touch.safeZ),
      measurementZ: optionalNumber(touch.measurementZ),
      directionX: directionOr(touch.directionX, DEFAULT_PROBING_PROFILE.touchProbe.directionX),
      directionY: directionOr(touch.directionY, DEFAULT_PROBING_PROFILE.touchProbe.directionY),
      featureDiameter: optionalNumber(touch.featureDiameter),
      cornerSampleOffset: finiteOr(touch.cornerSampleOffset, DEFAULT_PROBING_PROFILE.touchProbe.cornerSampleOffset),
      approachClearance: finiteOr(touch.approachClearance, DEFAULT_PROBING_PROFILE.touchProbe.approachClearance),
      maxSearch: finiteOr(touch.maxSearch, DEFAULT_PROBING_PROFILE.touchProbe.maxSearch),
      retractDistance: finiteOr(touch.retractDistance, DEFAULT_PROBING_PROFILE.touchProbe.retractDistance),
      guardedApproachFeed: finiteOr(touch.guardedApproachFeed, DEFAULT_PROBING_PROFILE.touchProbe.guardedApproachFeed),
      latchPullOff: finiteOr(touch.latchPullOff, DEFAULT_PROBING_PROFILE.touchProbe.latchPullOff),
      seekFeed: finiteOr(touch.seekFeed, DEFAULT_PROBING_PROFILE.touchProbe.seekFeed),
      latchFeed: finiteOr(touch.latchFeed, DEFAULT_PROBING_PROFILE.touchProbe.latchFeed),
      retractFeed: finiteOr(touch.retractFeed, DEFAULT_PROBING_PROFILE.touchProbe.retractFeed),
      doubleTouch: booleanOr(touch.doubleTouch, DEFAULT_PROBING_PROFILE.touchProbe.doubleTouch),
    },
  };
}

function checkRange(errors, value, minimum, maximum, label) {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    errors.push(`${label} must be between ${minimum} and ${maximum}.`);
  }
}

function checkOptionalRange(errors, value, minimum, maximum, label) {
  if (value !== null && (!Number.isFinite(value) || value < minimum || value > maximum)) {
    errors.push(`${label} must be between ${minimum} and ${maximum}.`);
  }
}

function checkMachineCoordinate(errors, value, axis, label) {
  if (value === null) return;
  const envelope = MR1_CONFIG.machineEnvelope[axis];
  if (!Number.isFinite(value) || value < envelope.min || value > envelope.max) {
    errors.push(`${label} must be inside ${envelope.min.toFixed(2)} to ${envelope.max.toFixed(2)} mm MPOS.`);
  }
}

export function evaluateToolSetter(settings, context = {}) {
  const errors = [];
  checkMachineCoordinate(errors, settings.x, "x", "Setter X");
  checkMachineCoordinate(errors, settings.y, "y", "Setter Y");
  checkMachineCoordinate(errors, settings.travelZ, "z", "Travel Z");
  checkMachineCoordinate(errors, settings.referenceContactZ, "z", "Reference contact Z");
  checkOptionalRange(errors, settings.referenceGaugeLength, 1, TOOL_SETTER_LIMITS.maxGaugeLength, "Reference gauge length");
  checkOptionalRange(errors, settings.currentGaugeLength, 1, TOOL_SETTER_LIMITS.maxGaugeLength, "Current gauge length");
  if (settings.currentToolNumber !== null
    && (!Number.isInteger(settings.currentToolNumber) || settings.currentToolNumber < 1 || settings.currentToolNumber > 999)) {
    errors.push("Tool number must be a whole number between 1 and 999.");
  }
  checkRange(errors, settings.approachClearance, 0.5, 20, "Approach clearance");
  checkRange(errors, settings.maxSearch, 1, TOOL_SETTER_LIMITS.maxSearch, "Maximum search");
  checkRange(errors, settings.retractDistance, 1, 20, "Retract distance");
  checkRange(errors, settings.guardedApproachFeed, 10, TOOL_SETTER_LIMITS.maxGuardedApproachFeed, "Guarded approach feed");
  checkRange(errors, settings.latchPullOff, 0.5, 2, "Latch pull-off");
  checkRange(errors, settings.seekFeed, 5, TOOL_SETTER_LIMITS.maxSeekFeed, "Seek feed");
  checkRange(errors, settings.latchFeed, 1, TOOL_SETTER_LIMITS.maxLatchFeed, "Latch feed");
  checkRange(errors, settings.retractFeed, 5, 100, "Retract feed");

  const pastExpected = settings.maxSearch - settings.approachClearance;
  if (Number.isFinite(pastExpected) && pastExpected < 0.1) {
    errors.push("Maximum search must extend at least 0.1 mm past the expected surface.");
  }
  if (Number.isFinite(pastExpected) && pastExpected > TOOL_SETTER_LIMITS.maxPastExpected) {
    errors.push(`Travel past the expected surface cannot exceed ${TOOL_SETTER_LIMITS.maxPastExpected} mm.`);
  }
  if (Number.isFinite(settings.seekFeed) && Number.isFinite(settings.latchFeed) && settings.latchFeed > settings.seekFeed) {
    errors.push("Latch feed cannot exceed seek feed.");
  }

  const calibrated = [
    settings.x,
    settings.y,
    settings.travelZ,
    settings.referenceContactZ,
    settings.referenceGaugeLength,
  ].every(Number.isFinite);
  const hasToolNumber = Number.isInteger(settings.currentToolNumber)
    && settings.currentToolNumber >= 1
    && settings.currentToolNumber <= 999;
  const toolReady = hasToolNumber && Number.isFinite(settings.currentGaugeLength);
  const toolMatches = !Number.isFinite(context.activeTool)
    || !hasToolNumber
    || settings.currentToolNumber === context.activeTool;
  const hasLengthModel = [
    settings.referenceContactZ,
    settings.referenceGaugeLength,
    settings.currentGaugeLength,
    pastExpected,
  ].every(Number.isFinite);
  const envelope = hasLengthModel
    ? {
      lengthDelta: settings.currentGaugeLength - settings.referenceGaugeLength,
      expectedContactZ: settings.referenceContactZ + settings.currentGaugeLength - settings.referenceGaugeLength,
      approachZ: settings.referenceContactZ + settings.currentGaugeLength - settings.referenceGaugeLength
        + settings.approachClearance,
      targetZ: settings.referenceContactZ + settings.currentGaugeLength - settings.referenceGaugeLength
        - pastExpected,
      retractZ: settings.referenceContactZ + settings.currentGaugeLength - settings.referenceGaugeLength
        + settings.retractDistance,
      pastExpected,
      totalSearch: settings.maxSearch,
      latchSearch: settings.latchPullOff + 0.5,
    }
    : null;

  if (envelope && Number.isFinite(settings.travelZ)) {
    envelope.guardedTravel = settings.travelZ - envelope.approachZ;
    if (settings.travelZ < envelope.retractZ) {
      errors.push("Travel Z must be at or above the final retract target.");
    }
  }
  if (envelope) {
    checkMachineCoordinate(errors, envelope.expectedContactZ, "z", "Expected contact Z");
    checkMachineCoordinate(errors, envelope.approachZ, "z", "Guarded approach Z");
    checkMachineCoordinate(errors, envelope.targetZ, "z", "Fine-search limit Z");
    checkMachineCoordinate(errors, envelope.retractZ, "z", "Retract Z");
  }

  return {
    valid: errors.length === 0,
    calibrated,
    toolReady,
    toolMatches,
    ready: errors.length === 0 && calibrated && toolReady && toolMatches,
    errors,
    envelope,
  };
}

function vectorWith(base, axis, value) {
  return { ...base, [axis]: value };
}

function directionLabel(axis, direction) {
  return `${direction > 0 ? "+" : "-"}${axis.toUpperCase()}`;
}

function surfaceContact({ id, label, axis, direction, surfaceCoordinate, base, settings }) {
  const radius = settings.tipDiameter / 2;
  const expectedCenterCoordinate = surfaceCoordinate - direction * radius;
  const startCoordinate = expectedCenterCoordinate - direction * settings.approachClearance;
  const searchLimitCoordinate = startCoordinate + direction * settings.maxSearch;
  const retractCoordinate = expectedCenterCoordinate - direction * settings.retractDistance;
  return {
    id,
    label,
    axis,
    direction,
    directionLabel: directionLabel(axis, direction),
    surfaceCoordinate,
    pastExpected: settings.maxSearch - settings.approachClearance,
    start: vectorWith(base, axis, startCoordinate),
    expectedCenter: vectorWith(base, axis, expectedCenterCoordinate),
    searchLimit: vectorWith(base, axis, searchLimitCoordinate),
    retract: vectorWith(base, axis, retractCoordinate),
  };
}

function boreContact({ id, label, axis, direction, center, settings }) {
  const radius = settings.tipDiameter / 2;
  const featureRadius = settings.featureDiameter / 2;
  const radialContact = featureRadius - radius;
  const surfaceCoordinate = center[axis] + direction * featureRadius;
  const expectedCenterCoordinate = center[axis] + direction * radialContact;
  return {
    id,
    label,
    axis,
    direction,
    directionLabel: directionLabel(axis, direction),
    surfaceCoordinate,
    pastExpected: settings.maxSearch - radialContact,
    start: { ...center },
    expectedCenter: vectorWith(center, axis, expectedCenterCoordinate),
    searchLimit: vectorWith(center, axis, center[axis] + direction * settings.maxSearch),
    retract: { ...center },
  };
}

function requiredTouchFields(settings) {
  const fields = [
    ["Safe Z", settings.safeZ],
    ["Target X", settings.targetX],
    ["Target Y", settings.targetY],
  ];
  if (settings.cycle === "z-surface") fields.push(["Target Z", settings.targetZ]);
  else fields.push(["Measurement Z", settings.measurementZ]);
  if (settings.cycle === "bore-center") fields.push(["Bore diameter", settings.featureDiameter]);
  return fields.filter(([, value]) => !Number.isFinite(value)).map(([label]) => label);
}

function buildTouchPlan(settings) {
  const contacts = [];
  if (settings.cycle === "z-surface") {
    contacts.push(surfaceContact({
      id: "z-surface",
      label: "TOP SURFACE",
      axis: "z",
      direction: -1,
      surfaceCoordinate: settings.targetZ,
      base: { x: settings.targetX, y: settings.targetY, z: settings.targetZ },
      settings,
    }));
  } else if (settings.cycle === "x-edge") {
    contacts.push(surfaceContact({
      id: "x-edge",
      label: "X EDGE",
      axis: "x",
      direction: settings.directionX,
      surfaceCoordinate: settings.targetX,
      base: { x: settings.targetX, y: settings.targetY, z: settings.measurementZ },
      settings,
    }));
  } else if (settings.cycle === "y-edge") {
    contacts.push(surfaceContact({
      id: "y-edge",
      label: "Y EDGE",
      axis: "y",
      direction: settings.directionY,
      surfaceCoordinate: settings.targetY,
      base: { x: settings.targetX, y: settings.targetY, z: settings.measurementZ },
      settings,
    }));
  } else if (settings.cycle === "outside-corner") {
    contacts.push(surfaceContact({
      id: "corner-x",
      label: "CORNER X FACE",
      axis: "x",
      direction: settings.directionX,
      surfaceCoordinate: settings.targetX,
      base: {
        x: settings.targetX,
        y: settings.targetY + settings.directionY * settings.cornerSampleOffset,
        z: settings.measurementZ,
      },
      settings,
    }));
    contacts.push(surfaceContact({
      id: "corner-y",
      label: "CORNER Y FACE",
      axis: "y",
      direction: settings.directionY,
      surfaceCoordinate: settings.targetY,
      base: {
        x: settings.targetX + settings.directionX * settings.cornerSampleOffset,
        y: settings.targetY,
        z: settings.measurementZ,
      },
      settings,
    }));
  } else if (settings.cycle === "bore-center") {
    const center = { x: settings.targetX, y: settings.targetY, z: settings.measurementZ };
    contacts.push(
      boreContact({ id: "bore-x-plus", label: "BORE +X", axis: "x", direction: 1, center, settings }),
      boreContact({ id: "bore-x-minus", label: "BORE -X", axis: "x", direction: -1, center, settings }),
      boreContact({ id: "bore-y-plus", label: "BORE +Y", axis: "y", direction: 1, center, settings }),
      boreContact({ id: "bore-y-minus", label: "BORE -Y", axis: "y", direction: -1, center, settings }),
    );
  }
  return {
    cycle: settings.cycle,
    safeZ: settings.safeZ,
    contacts,
    contactCount: contacts.length,
    reportedTouchCount: contacts.length * (settings.doubleTouch ? 2 : 1),
  };
}

function checkPlanPoint(errors, point, label) {
  for (const axis of ["x", "y", "z"]) {
    checkMachineCoordinate(errors, point[axis], axis, `${label} ${axis.toUpperCase()}`);
  }
}

export function evaluateTouchProbe(candidate) {
  const settings = normalizeProbingProfile({ touchProbe: candidate }).touchProbe;
  const errors = [];
  checkRange(errors, settings.tipDiameter, 0.5, TOUCH_PROBE_LIMITS.maxTipDiameter, "Tip diameter");
  checkRange(errors, settings.approachClearance, 0.5, 24.9, "Approach clearance");
  checkRange(errors, settings.maxSearch, 0.5, TOUCH_PROBE_LIMITS.maxSearch, "Maximum search");
  checkRange(errors, settings.retractDistance, 0.5, 10, "Retract distance");
  checkRange(errors, settings.guardedApproachFeed, 10, TOUCH_PROBE_LIMITS.maxGuardedApproachFeed, "Guarded approach feed");
  checkRange(errors, settings.latchPullOff, 0.5, 2, "Latch pull-off");
  checkRange(errors, settings.seekFeed, 5, TOUCH_PROBE_LIMITS.maxSeekFeed, "Seek feed");
  checkRange(errors, settings.latchFeed, 1, TOUCH_PROBE_LIMITS.maxLatchFeed, "Latch feed");
  checkRange(errors, settings.retractFeed, 5, TOUCH_PROBE_LIMITS.maxRetractFeed, "Retract feed");
  checkRange(errors, settings.cornerSampleOffset, 1, 50, "Corner sample offset");
  checkOptionalRange(errors, settings.featureDiameter, 1, TOUCH_PROBE_LIMITS.maxFeatureDiameter, "Bore diameter");
  checkMachineCoordinate(errors, settings.targetX, "x", "Target X");
  checkMachineCoordinate(errors, settings.targetY, "y", "Target Y");
  checkMachineCoordinate(errors, settings.targetZ, "z", "Target Z");
  checkMachineCoordinate(errors, settings.safeZ, "z", "Safe Z");
  checkMachineCoordinate(errors, settings.measurementZ, "z", "Measurement Z");
  if (Number.isFinite(settings.seekFeed) && Number.isFinite(settings.latchFeed) && settings.latchFeed > settings.seekFeed) {
    errors.push("Latch feed cannot exceed seek feed.");
  }
  if (settings.latchPullOff > settings.retractDistance) {
    errors.push("Latch pull-off cannot exceed the final retract distance.");
  }
  if (settings.cycle === "bore-center" && Number.isFinite(settings.featureDiameter)
    && settings.featureDiameter <= settings.tipDiameter + 2) {
    errors.push("Bore diameter must exceed tip diameter by at least 2 mm.");
  }

  const missing = requiredTouchFields(settings);
  const configured = missing.length === 0;
  const plan = configured ? buildTouchPlan(settings) : null;
  if (plan) {
    for (const contact of plan.contacts) {
      if (contact.pastExpected < 0.1) {
        errors.push(`${contact.label} search must extend at least 0.1 mm past expected contact.`);
      } else if (contact.pastExpected > TOUCH_PROBE_LIMITS.maxPastExpected) {
        errors.push(`${contact.label} travel past expected contact cannot exceed ${TOUCH_PROBE_LIMITS.maxPastExpected} mm.`);
      }
      checkPlanPoint(errors, contact.start, `${contact.label} start`);
      checkPlanPoint(errors, contact.expectedCenter, `${contact.label} expected contact`);
      checkPlanPoint(errors, contact.searchLimit, `${contact.label} search limit`);
      checkPlanPoint(errors, contact.retract, `${contact.label} retract`);
      if (settings.safeZ < contact.start.z + 1) {
        errors.push(`Safe Z must be at least 1 mm above ${contact.label.toLowerCase()} start Z.`);
      }
    }
  }
  return {
    settings,
    valid: errors.length === 0,
    configured,
    ready: errors.length === 0 && configured,
    errors,
    missing,
    plan,
  };
}

export function loadProbingProfile(storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem(PROBING_PROFILE_STORAGE_KEY);
    return normalizeProbingProfile(raw ? JSON.parse(raw) : DEFAULT_PROBING_PROFILE);
  } catch {
    return normalizeProbingProfile(DEFAULT_PROBING_PROFILE);
  }
}

export function saveProbingProfile(profile, storage = globalThis.localStorage) {
  const normalized = normalizeProbingProfile(profile);
  storage?.setItem(PROBING_PROFILE_STORAGE_KEY, JSON.stringify(normalized));
  return normalized;
}
