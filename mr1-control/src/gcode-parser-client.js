import { parseGcodeProgram } from "./gcode-program.js";
import { applyFixtureMapToJob } from "./fixture-map-profile.js";

let parserWorker = null;
let nextRequestId = 1;
const pendingRequests = new Map();
const WORKER_TIMEOUT_BASE_MS = 8_000;
const WORKER_TIMEOUT_PER_MIB_MS = 1_500;
const WORKER_TIMEOUT_MAX_MS = 45_000;

function createAbortError(reason = "G-code import cancelled.") {
  if (reason instanceof Error && reason.name === "AbortError") return reason;
  const error = new Error(typeof reason === "string" && reason ? reason : "G-code import cancelled.");
  error.name = "AbortError";
  return error;
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw createAbortError(signal.reason);
}

function reportProgress(target, progress) {
  try {
    target?.onProgress?.(progress);
  } catch {
    // Progress reporting is advisory and must not invalidate a parsed program.
  }
}

function localParse(source, options, transforms, fallbackReason = null) {
  throwIfAborted(transforms.signal);
  reportProgress(transforms, { phase: "parsing", fraction: null });
  const parseStartedAt = performance.now();
  const job = parseGcodeProgram(source, options);
  const parseFinishedAt = performance.now();
  throwIfAborted(transforms.signal);
  if (transforms.fixtureMapProfile) applyFixtureMapToJob(job, transforms.fixtureMapProfile);
  const mapFinishedAt = performance.now();
  throwIfAborted(transforms.signal);
  if (fallbackReason) {
    job.workerTiming = {
      parseMs: parseFinishedAt - parseStartedAt,
      fixtureMapMs: mapFinishedAt - parseFinishedAt,
      fallback: true,
      fallbackReason,
    };
  }
  reportProgress(transforms, { phase: "complete", fraction: 1 });
  return job;
}

function clearRequestLifecycle(request) {
  if (request.timeoutId) clearTimeout(request.timeoutId);
  request.timeoutId = null;
  if (request.signal && request.abortListener) {
    request.signal.removeEventListener("abort", request.abortListener);
  }
  request.abortListener = null;
}

function settlePending(error, { fallback = false } = {}) {
  const requests = [...pendingRequests.values()];
  pendingRequests.clear();
  for (const request of requests) {
    clearRequestLifecycle(request);
    if (request.signal?.aborted) {
      request.reject(createAbortError(request.signal.reason));
      continue;
    }
    if (!fallback) {
      request.reject(error);
      continue;
    }
    Promise.resolve()
      .then(() => localParse(request.source, request.options, request.transforms, error.message))
      .then(request.resolve, request.reject);
  }
}

function resetWorker(error = null, options = {}) {
  const worker = parserWorker;
  parserWorker = null;
  worker?.terminate();
  if (error) settlePending(error, options);
}

function workerTimeoutMs(source, override) {
  const requested = Number(override);
  if (Number.isFinite(requested) && requested > 0) return requested;
  const estimatedBytes = new Blob([source]).size;
  return Math.min(
    WORKER_TIMEOUT_MAX_MS,
    WORKER_TIMEOUT_BASE_MS + Math.ceil((estimatedBytes / (1024 * 1024)) * WORKER_TIMEOUT_PER_MIB_MS),
  );
}

function ensureWorker() {
  if (parserWorker) return parserWorker;
  if (typeof Worker !== "function") return null;

  try {
    parserWorker = new Worker(new URL("./gcode-parser.worker.js", import.meta.url), {
      type: "module",
      name: "mr1-gcode-parser",
    });
  } catch {
    parserWorker = null;
    return null;
  }

  parserWorker.addEventListener("message", (event) => {
    const {
      id,
      type,
      job,
      segmentCount,
      segments,
      start,
      error,
    } = event.data ?? {};
    const request = pendingRequests.get(id);
    if (!request) return;
    if (error) {
      pendingRequests.delete(id);
      clearRequestLifecycle(request);
      const failure = new Error(error.message || "G-code parser worker failed.");
      failure.name = error.name || "Error";
      if (error.stack) failure.stack = error.stack;
      request.reject(failure);
      return;
    }
    if (type === "start") {
      request.job = job;
      request.segmentCount = segmentCount;
      reportProgress(request, {
        phase: "assembling",
        completed: 0,
        total: segmentCount,
        fraction: segmentCount === 0 ? 1 : 0,
      });
      return;
    }
    if (type === "segments") {
      if (!request.job || start !== request.job.segments.length || !Array.isArray(segments)) {
        pendingRequests.delete(id);
        clearRequestLifecycle(request);
        request.reject(new Error("G-code parser worker returned segments out of order."));
        return;
      }
      request.job.segments.push(...segments);
      reportProgress(request, {
        phase: "assembling",
        completed: request.job.segments.length,
        total: request.segmentCount,
        fraction: request.segmentCount > 0
          ? Math.min(1, request.job.segments.length / request.segmentCount)
          : 1,
      });
      return;
    }
    if (type === "complete") {
      pendingRequests.delete(id);
      clearRequestLifecycle(request);
      if (!request.job || request.job.segments.length !== request.segmentCount) {
        request.reject(new Error("G-code parser worker returned an incomplete program."));
        return;
      }
      reportProgress(request, { phase: "complete", fraction: 1 });
      request.resolve(request.job);
      return;
    }

    // Accept the original one-message protocol while cached workers roll over.
    if (job) {
      pendingRequests.delete(id);
      clearRequestLifecycle(request);
      reportProgress(request, { phase: "complete", fraction: 1 });
      request.resolve(job);
    }
  });
  parserWorker.addEventListener("error", (event) => {
    resetWorker(
      new Error(event.message || "G-code parser worker stopped unexpectedly."),
      { fallback: true },
    );
  });
  parserWorker.addEventListener("messageerror", () => {
    resetWorker(new Error("G-code parser worker returned an unreadable result."), { fallback: true });
  });
  return parserWorker;
}

export function parseGcodeProgramAsync(source, options = {}, transforms = {}) {
  if (transforms.signal?.aborted) {
    return Promise.reject(createAbortError(transforms.signal.reason));
  }
  const worker = ensureWorker();
  if (!worker) {
    return Promise.resolve().then(() => localParse(source, options, transforms));
  }

  const id = nextRequestId;
  nextRequestId += 1;
  return new Promise((resolve, reject) => {
    const request = {
      resolve,
      reject,
      job: null,
      segmentCount: null,
      source,
      options,
      transforms,
      timeoutId: null,
      signal: transforms.signal ?? null,
      onProgress: transforms.onProgress ?? null,
      abortListener: null,
    };
    pendingRequests.set(id, request);
    request.abortListener = () => {
      if (!pendingRequests.delete(id)) return;
      clearRequestLifecycle(request);
      request.reject(createAbortError(request.signal?.reason));
      resetWorker(
        new Error("G-code parser worker restarted after an import was cancelled."),
        { fallback: true },
      );
    };
    request.signal?.addEventListener("abort", request.abortListener, { once: true });
    reportProgress(request, { phase: "parsing", fraction: null });
    request.timeoutId = setTimeout(() => {
      if (!pendingRequests.has(id)) return;
      resetWorker(
        new Error(`G-code parser worker exceeded ${workerTimeoutMs(source, transforms.workerTimeoutMs)} ms.`),
        { fallback: true },
      );
    }, workerTimeoutMs(source, transforms.workerTimeoutMs));
    try {
      worker.postMessage({
        id,
        source,
        options,
        fixtureMapProfile: transforms.fixtureMapProfile ?? null,
      });
    } catch (error) {
      pendingRequests.delete(id);
      clearRequestLifecycle(request);
      Promise.resolve()
        .then(() => localParse(source, options, transforms, error instanceof Error ? error.message : String(error)))
        .then(resolve, reject);
    }
  });
}

export function stopGcodeParserWorker() {
  resetWorker(new Error("G-code parser worker stopped."));
}
