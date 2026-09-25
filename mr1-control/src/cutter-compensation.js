export const CUTTER_COMPENSATION_STORAGE_KEY = "mr1-control.cutter-compensation.v1";

export const CUTTER_COMPENSATION_LIMITS = Object.freeze({
  minimumToolNumber: 1,
  maximumToolNumber: 999,
  minimumDiameterMm: 0.1,
  maximumDiameterMm: 50.8,
  maximumToolDeltaMm: 0.5,
  minimumFeatureLimitMm: 0.01,
  maximumFeatureLimitMm: 1,
  maximumFeatureSizeMm: 1000,
});

export const CONTROLLER_CUTTER_COMPENSATION = Object.freeze({
  supportedCode: "G40",
  blockedCodes: Object.freeze(["G41", "G41.1", "G42", "G42.1"]),
  fusionMode: "IN COMPUTER",
});

const DEFAULT_TOOL = Object.freeze({
  number: 1,
  label: "END MILL",
  programmedDiameterMm: null,
  measuredDiameterMm: null,
  correctionMode: "tool",
  featureType: "external",
  targetSizeMm: null,
  measuredSizeMm: null,
});

export const DEFAULT_CUTTER_COMPENSATION_PROFILE = Object.freeze({
  version: 1,
  activeTool: 1,
  maxFeatureErrorMm: 0.25,
  tools: Object.freeze({
    1: DEFAULT_TOOL,
  }),
});

function optionalNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function finiteOr(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeToolNumber(value) {
  const number = Number(value);
  return Number.isInteger(number)
    && number >= CUTTER_COMPENSATION_LIMITS.minimumToolNumber
    && number <= CUTTER_COMPENSATION_LIMITS.maximumToolNumber
    ? number
    : null;
}

export function normalizeCutterTool(candidate = {}, fallbackNumber = null) {
  const number = normalizeToolNumber(candidate.number ?? fallbackNumber);
  if (number === null) return null;
  const label = String(candidate.label ?? `TOOL ${number}`)
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 40) || `TOOL ${number}`;
  return {
    number,
    label,
    programmedDiameterMm: optionalNumber(candidate.programmedDiameterMm),
    measuredDiameterMm: optionalNumber(candidate.measuredDiameterMm),
    correctionMode: candidate.correctionMode === "feature" ? "feature" : "tool",
    featureType: candidate.featureType === "internal" ? "internal" : "external",
    targetSizeMm: optionalNumber(candidate.targetSizeMm),
    measuredSizeMm: optionalNumber(candidate.measuredSizeMm),
  };
}

export function normalizeCutterCompensationProfile(candidate = {}) {
  const tools = {};
  if (candidate.tools && typeof candidate.tools === "object" && !Array.isArray(candidate.tools)) {
    for (const [key, value] of Object.entries(candidate.tools).slice(0, 100)) {
      const tool = normalizeCutterTool(value, key);
      if (tool) tools[String(tool.number)] = tool;
    }
  }
  if (Object.keys(tools).length === 0) tools["1"] = { ...DEFAULT_TOOL };

  let activeTool = normalizeToolNumber(candidate.activeTool);
  if (activeTool === null || !tools[String(activeTool)]) {
    activeTool = Number(Object.keys(tools).sort((a, b) => Number(a) - Number(b))[0]);
  }

  const requestedLimit = finiteOr(
    candidate.maxFeatureErrorMm,
    DEFAULT_CUTTER_COMPENSATION_PROFILE.maxFeatureErrorMm,
  );
  const maxFeatureErrorMm = requestedLimit >= CUTTER_COMPENSATION_LIMITS.minimumFeatureLimitMm
    && requestedLimit <= CUTTER_COMPENSATION_LIMITS.maximumFeatureLimitMm
    ? requestedLimit
    : DEFAULT_CUTTER_COMPENSATION_PROFILE.maxFeatureErrorMm;

  return {
    version: 1,
    activeTool,
    maxFeatureErrorMm,
    tools,
  };
}

function checkRange(errors, value, minimum, maximum, label) {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    errors.push(`${label} must be between ${minimum} and ${maximum} mm.`);
  }
}

export function evaluateCutterCompensation(toolCandidate, options = {}) {
  const tool = normalizeCutterTool(toolCandidate);
  const errors = [];
  const holds = [];
  if (!tool) {
    return {
      valid: false,
      ready: false,
      state: "invalid",
      errors: ["Tool number must be a whole number between 1 and 999."],
      holds,
      tool: null,
      recommendation: null,
    };
  }

  checkRange(
    errors,
    tool.programmedDiameterMm,
    CUTTER_COMPENSATION_LIMITS.minimumDiameterMm,
    CUTTER_COMPENSATION_LIMITS.maximumDiameterMm,
    "Fusion diameter",
  );
  if (tool.correctionMode === "tool") {
    checkRange(
      errors,
      tool.measuredDiameterMm,
      CUTTER_COMPENSATION_LIMITS.minimumDiameterMm,
      CUTTER_COMPENSATION_LIMITS.maximumDiameterMm,
      "Measured cutter diameter",
    );
  }
  if (tool.correctionMode === "feature") {
    checkRange(
      errors,
      tool.targetSizeMm,
      CUTTER_COMPENSATION_LIMITS.minimumDiameterMm,
      CUTTER_COMPENSATION_LIMITS.maximumFeatureSizeMm,
      "Target feature size",
    );
    checkRange(
      errors,
      tool.measuredSizeMm,
      CUTTER_COMPENSATION_LIMITS.minimumDiameterMm,
      CUTTER_COMPENSATION_LIMITS.maximumFeatureSizeMm,
      "Measured feature size",
    );
  }

  const maxFeatureErrorMm = finiteOr(
    options.maxFeatureErrorMm,
    DEFAULT_CUTTER_COMPENSATION_PROFILE.maxFeatureErrorMm,
  );
  if (maxFeatureErrorMm < CUTTER_COMPENSATION_LIMITS.minimumFeatureLimitMm
    || maxFeatureErrorMm > CUTTER_COMPENSATION_LIMITS.maximumFeatureLimitMm) {
    errors.push(
      `Feature error limit must be between ${CUTTER_COMPENSATION_LIMITS.minimumFeatureLimitMm}`
      + ` and ${CUTTER_COMPENSATION_LIMITS.maximumFeatureLimitMm} mm.`,
    );
  }

  if (errors.length > 0) {
    return {
      valid: false,
      ready: false,
      state: "invalid",
      errors,
      holds,
      tool,
      recommendation: null,
    };
  }

  const measurementDeltaMm = Number.isFinite(tool.measuredDiameterMm)
    ? tool.measuredDiameterMm - tool.programmedDiameterMm
    : null;
  let featureErrorMm = null;
  let diameterAdjustmentMm;
  if (tool.correctionMode === "feature") {
    featureErrorMm = tool.measuredSizeMm - tool.targetSizeMm;
    diameterAdjustmentMm = tool.featureType === "external" ? -featureErrorMm : featureErrorMm;
    if (Math.abs(featureErrorMm) > maxFeatureErrorMm + 1e-9) {
      holds.push(
        `Feature error exceeds the ${maxFeatureErrorMm.toFixed(3)} mm correction limit; inspect setup and tool runout.`,
      );
    }
  } else {
    diameterAdjustmentMm = measurementDeltaMm;
    if (Math.abs(measurementDeltaMm) > CUTTER_COMPENSATION_LIMITS.maximumToolDeltaMm + 1e-9) {
      holds.push(
        `Measured cutter differs from Fusion by more than ${CUTTER_COMPENSATION_LIMITS.maximumToolDeltaMm.toFixed(3)} mm; verify the tool identity.`,
      );
    }
  }

  const nextFusionDiameterMm = tool.programmedDiameterMm + diameterAdjustmentMm;
  if (nextFusionDiameterMm < CUTTER_COMPENSATION_LIMITS.minimumDiameterMm
    || nextFusionDiameterMm > CUTTER_COMPENSATION_LIMITS.maximumDiameterMm) {
    holds.push("Calculated Fusion diameter is outside the supported tool range.");
  }

  return {
    valid: true,
    ready: holds.length === 0,
    state: holds.length === 0 ? "ready" : "held",
    errors,
    holds,
    tool,
    recommendation: {
      nextFusionDiameterMm,
      diameterAdjustmentMm,
      radialPathShiftMm: Math.abs(diameterAdjustmentMm) / 2,
      measurementDeltaMm,
      featureErrorMm,
      fusionMode: CONTROLLER_CUTTER_COMPENSATION.fusionMode,
      requiresRepost: true,
    },
  };
}

export function upsertCutterTool(profileCandidate, toolCandidate) {
  const profile = normalizeCutterCompensationProfile(profileCandidate);
  const tool = normalizeCutterTool(toolCandidate);
  if (!tool) throw new Error("Tool number must be a whole number between 1 and 999.");
  return normalizeCutterCompensationProfile({
    ...profile,
    activeTool: tool.number,
    tools: { ...profile.tools, [String(tool.number)]: tool },
  });
}

export function removeCutterTool(profileCandidate, toolNumber) {
  const profile = normalizeCutterCompensationProfile(profileCandidate);
  const number = normalizeToolNumber(toolNumber);
  if (number === null) return profile;
  const tools = { ...profile.tools };
  delete tools[String(number)];
  return normalizeCutterCompensationProfile({ ...profile, tools });
}

export function jobToolNumbers(job, fallbackTool = null) {
  const tools = new Set();
  for (const segment of Array.isArray(job?.segments) ? job.segments : []) {
    const number = normalizeToolNumber(segment?.tool);
    if (number !== null) tools.add(number);
  }
  const fallback = normalizeToolNumber(fallbackTool);
  if (fallback !== null) tools.add(fallback);
  return [...tools].sort((a, b) => a - b);
}

export function loadCutterCompensationProfile(storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem(CUTTER_COMPENSATION_STORAGE_KEY);
    return normalizeCutterCompensationProfile(
      raw ? JSON.parse(raw) : DEFAULT_CUTTER_COMPENSATION_PROFILE,
    );
  } catch {
    return normalizeCutterCompensationProfile(DEFAULT_CUTTER_COMPENSATION_PROFILE);
  }
}

export function saveCutterCompensationProfile(profile, storage = globalThis.localStorage) {
  const normalized = normalizeCutterCompensationProfile(profile);
  storage?.setItem(CUTTER_COMPENSATION_STORAGE_KEY, JSON.stringify(normalized));
  return normalized;
}
