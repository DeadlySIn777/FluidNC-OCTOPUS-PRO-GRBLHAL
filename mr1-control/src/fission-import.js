export const FISSION_IMPORT_STORAGE_KEY = "mr1-control.fission-import.v1";
export const FISSION_ENDPOINT = "http://127.0.0.1:8787/optimize/fission";
export const FISSION_HEALTH_ENDPOINT = "http://127.0.0.1:8787/health";

export const DEFAULT_FISSION_IMPORT_PROFILE = Object.freeze({
  version: 1,
  enabled: true,
  safeZ: 3,
  safeZVerified: false,
  traverses: "auto",
  retracts: "auto",
});

const RESTORE_MODES = new Set(["auto", "on", "off"]);
const POINT_TOLERANCE_MM = 0.0001;
const FEED_TOLERANCE_MM_MIN = 0.001;

function finiteOr(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function modeOr(value, fallback) {
  const mode = String(value ?? "").toLowerCase();
  return RESTORE_MODES.has(mode) ? mode : fallback;
}

export function normalizeFissionImportProfile(candidate = {}) {
  return {
    version: 1,
    enabled: typeof candidate.enabled === "boolean" ? candidate.enabled : DEFAULT_FISSION_IMPORT_PROFILE.enabled,
    safeZ: finiteOr(candidate.safeZ, DEFAULT_FISSION_IMPORT_PROFILE.safeZ),
    safeZVerified: typeof candidate.safeZVerified === "boolean"
      ? candidate.safeZVerified
      : DEFAULT_FISSION_IMPORT_PROFILE.safeZVerified,
    traverses: modeOr(candidate.traverses, DEFAULT_FISSION_IMPORT_PROFILE.traverses),
    retracts: modeOr(candidate.retracts, DEFAULT_FISSION_IMPORT_PROFILE.retracts),
  };
}

export function evaluateFissionImportProfile(candidate) {
  const profile = normalizeFissionImportProfile(candidate);
  const errors = [];
  const rawSafeZ = candidate?.safeZ;
  if (rawSafeZ === "" || rawSafeZ === null || rawSafeZ === undefined || !Number.isFinite(Number(rawSafeZ))) {
    errors.push("Safe Z must be a number.");
  } else if (!(profile.safeZ > 0) || profile.safeZ > 1000) {
    // Rapids below the work Z0 plane would be inside the part by definition.
    errors.push("Safe Z must be above work Z0: greater than 0 and at most 1000 mm.");
  }
  if (!RESTORE_MODES.has(String(candidate?.traverses ?? "").toLowerCase())) {
    errors.push("XY traverse mode must be auto, on, or off.");
  }
  if (!RESTORE_MODES.has(String(candidate?.retracts ?? "").toLowerCase())) {
    errors.push("Z retract mode must be auto, on, or off.");
  }
  return {
    profile,
    valid: errors.length === 0,
    ready: errors.length === 0 && profile.enabled && profile.safeZVerified,
    errors,
  };
}

export function loadFissionImportProfile(storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem(FISSION_IMPORT_STORAGE_KEY);
    return normalizeFissionImportProfile(raw ? JSON.parse(raw) : DEFAULT_FISSION_IMPORT_PROFILE);
  } catch {
    return normalizeFissionImportProfile(DEFAULT_FISSION_IMPORT_PROFILE);
  }
}

export function saveFissionImportProfile(profile, storage = globalThis.localStorage) {
  const evaluation = evaluateFissionImportProfile(profile);
  if (!evaluation.valid) throw new Error(evaluation.errors.join(" "));
  storage?.setItem(FISSION_IMPORT_STORAGE_KEY, JSON.stringify(evaluation.profile));
  return evaluation.profile;
}

export function hasFusionPersonalNotice(source) {
  return /rapid\s+moves?\s+is\s+reduced|Fusion\s+for\s+Personal\s+Use/i.test(String(source));
}

async function sha256Text(source, cryptoApi = globalThis.crypto) {
  if (!cryptoApi?.subtle) throw new Error("SHA-256 is unavailable in this browser.");
  const digest = await cryptoApi.subtle.digest("SHA-256", new TextEncoder().encode(source));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("").toUpperCase();
}

function validHash(value) {
  return typeof value === "string" && /^[A-F0-9]{64}$/i.test(value);
}

export async function requestFissionOptimization(source, options = {}) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") throw new Error("Local optimizer transport is unavailable.");
  const profileEvaluation = evaluateFissionImportProfile(options.profile);
  if (!profileEvaluation.ready) {
    throw new Error(profileEvaluation.errors[0] || "Safe Z must be verified before automatic rapid restoration.");
  }
  const controller = new AbortController();
  let timedOut = false;
  const abortFromCaller = () => controller.abort(options.signal?.reason);
  if (options.signal?.aborted) abortFromCaller();
  else options.signal?.addEventListener("abort", abortFromCaller, { once: true });
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, options.timeoutMs ?? 30_000);
  let response;
  try {
    response = await fetchImpl(options.endpoint ?? FISSION_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: String(options.name || "LOADED_PROGRAM.NC"),
        source,
        options: {
          safeZVerified: profileEvaluation.profile.safeZVerified,
          safeZ: profileEvaluation.profile.safeZ,
          traverses: profileEvaluation.profile.traverses,
          retracts: profileEvaluation.profile.retracts,
          rapidSpeed: options.rapidSpeed,
          rapidSpeedZ: options.rapidSpeedZ,
        },
      }),
      signal: controller.signal,
    });
  } catch (error) {
    if (timedOut) throw new Error("Local optimizer timed out.");
    throw error;
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", abortFromCaller);
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error(`Local optimizer returned HTTP ${response.status} without valid JSON.`);
  }
  if (!response.ok) throw new Error(payload.error || `Local optimizer failed with HTTP ${response.status}.`);
  if (!payload.validated || typeof payload.content !== "string" || !payload.stats) {
    throw new Error("Local optimizer result is incomplete or unvalidated.");
  }
  if (!validHash(payload.sourceSha256) || !validHash(payload.outputSha256)) {
    throw new Error("Local optimizer did not provide valid source hashes.");
  }
  const [sourceHash, outputHash] = await Promise.all([
    sha256Text(source, options.cryptoApi),
    sha256Text(payload.content, options.cryptoApi),
  ]);
  if (sourceHash !== payload.sourceSha256.toUpperCase()) throw new Error("Optimizer source hash mismatch.");
  if (outputHash !== payload.outputSha256.toUpperCase()) throw new Error("Optimizer output hash mismatch.");
  if (Number(payload.stats.rpmCapped ?? 0) !== 0) throw new Error("Automatic import refuses any spindle-RPM rewrite.");
  return payload;
}

function pointsMatch(a, b) {
  return ["x", "y", "z"].every((axis) => Math.abs(a[axis] - b[axis]) <= POINT_TOLERANCE_MM);
}

function boundsMatch(a, b) {
  return pointsMatch(a.min, b.min) && pointsMatch(a.max, b.max);
}

function changedMoveClass(segment, safeZ) {
  const deltaX = segment.to.x - segment.from.x;
  const deltaY = segment.to.y - segment.from.y;
  const deltaZ = segment.to.z - segment.from.z;
  const hasXy = Math.hypot(deltaX, deltaY) > POINT_TOLERANCE_MM;
  const hasZ = Math.abs(deltaZ) > POINT_TOLERANCE_MM;
  const endsAtSafeZ = segment.to.z >= safeZ - POINT_TOLERANCE_MM;

  if (!hasXy && hasZ && deltaZ > 0 && endsAtSafeZ) return "retract";
  if (hasXy && !hasZ && segment.from.z >= safeZ - POINT_TOLERANCE_MM && endsAtSafeZ) {
    return "clearance";
  }
  return null;
}

function describeControlBlock(block) {
  return block ? `"${block.words}" before move ${block.segment + 1}` : "nothing";
}

// Dwell, spindle, coolant, tool, stop and offset blocks must survive the
// optimizer unchanged and at the same place in the motion sequence.
function controlBlocksError(original, optimized) {
  if (!Array.isArray(original) || !Array.isArray(optimized)) return "Non-motion blocks could not be compared.";
  for (let index = 0; index < Math.max(original.length, optimized.length); index += 1) {
    const before = original[index];
    const after = optimized[index];
    if (!before || !after || before.segment !== after.segment || before.words !== after.words) {
      return `Non-motion block changed: ${describeControlBlock(before)} -> ${describeControlBlock(after)}.`;
    }
  }
  return null;
}

export function verifyFissionPreview(originalJob, optimizedJob, stats = {}, options = {}) {
  const errors = [];
  const safeZ = finiteOr(options.safeZ, DEFAULT_FISSION_IMPORT_PROFILE.safeZ);
  // The operator's safe Z must clear work Z0 and every move that still cuts;
  // otherwise "above safe Z" says nothing about the material.
  let highestCutZ = -Infinity;
  for (const segment of optimizedJob.segments) {
    if (segment.type === "cut") highestCutZ = Math.max(highestCutZ, Math.min(segment.from.z, segment.to.z));
  }
  if (!(safeZ > 0)) {
    errors.push("Safe Z must be above work Z0.");
  } else if (safeZ <= highestCutZ + POINT_TOLERANCE_MM) {
    errors.push(`Safe Z ${safeZ} is not above the highest cutting move at Z${highestCutZ.toFixed(3)}.`);
  }
  const controlError = controlBlocksError(originalJob.controlBlocks, optimizedJob.controlBlocks);
  if (controlError) errors.push(controlError);
  if (originalJob.segments.length !== optimizedJob.segments.length) {
    errors.push(`Move count changed ${originalJob.segments.length} -> ${optimizedJob.segments.length}.`);
  }
  if (!boundsMatch(originalJob.bounds, optimizedJob.bounds)) errors.push("Toolpath bounds changed.");
  if (originalJob.stats?.arcs !== optimizedJob.stats?.arcs) errors.push("Arc count changed.");
  if (originalJob.spindle !== optimizedJob.spindle) errors.push("Maximum spindle command changed.");

  let convertedSegments = 0;
  let retractSegments = 0;
  let clearanceSegments = 0;
  const count = Math.min(originalJob.segments.length, optimizedJob.segments.length);
  for (let index = 0; index < count; index += 1) {
    const before = originalJob.segments[index];
    const after = optimizedJob.segments[index];
    if (!pointsMatch(before.from, after.from) || !pointsMatch(before.to, after.to)) {
      errors.push(`Move ${index + 1} endpoint changed.`);
      if (errors.length >= 12) break;
      continue;
    }
    if (before.tool !== after.tool || before.spindle !== after.spindle) {
      errors.push(`Move ${index + 1} tool or spindle state changed.`);
    }
    if (before.workOffset !== after.workOffset || before.fromWorkOffset !== after.fromWorkOffset) {
      errors.push(`Move ${index + 1} work-offset state changed.`);
    }
    if (before.type !== after.type) {
      if (before.type === "cut" && after.type === "rapid") {
        const moveClass = changedMoveClass(before, safeZ);
        if (moveClass === "retract") retractSegments += 1;
        else if (moveClass === "clearance") clearanceSegments += 1;
        else errors.push(`Move ${index + 1} is not a safe upward retract or clearance-height XY move.`);
        convertedSegments += 1;
      } else errors.push(`Move ${index + 1} changed ${before.type} -> ${after.type}.`);
    } else if (before.type === "cut" && Math.abs(before.feed - after.feed) > FEED_TOLERANCE_MM_MIN) {
      errors.push(`Move ${index + 1} cutting feed changed.`);
    }
    if (errors.length >= 12) break;
  }

  const rapidDelta = optimizedJob.stats.rapids - originalJob.stats.rapids;
  const cutDelta = originalJob.stats.cuts - optimizedJob.stats.cuts;
  if (rapidDelta !== convertedSegments || cutDelta !== convertedSegments) {
    errors.push("Preview rapid/cut counts do not match converted moves.");
  }
  const externallyRestored = Number(stats.rapidsRestored);
  if (!Number.isInteger(externallyRestored) || externallyRestored !== convertedSegments) {
    errors.push("External restored-move count is inconsistent with the independent preview.");
  }
  if (Number(stats.rpmCapped ?? 0) !== 0) errors.push("Spindle RPM was rewritten.");

  return {
    valid: errors.length === 0,
    errors,
    convertedSegments,
    retractSegments,
    clearanceSegments,
    safeZ,
  };
}
