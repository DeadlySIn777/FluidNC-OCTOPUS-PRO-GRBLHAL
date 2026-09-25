export const LATENCY_PING_PROTOCOL = "mr1-latency-ping-v1";
export const LATENCY_EVIDENCE_PROTOCOL = "mr1-latency-evidence-v1";

export const LATENCY_METRICS = Object.freeze([
  "serviceRttMs",
  "serviceProcessingMs",
  "sourceAgeMs",
  "bridgeAgeMs",
  "renderDelayMs",
  "sourceToVisibleMs",
]);

export const DEFAULT_LATENCY_GATES = Object.freeze({
  minimumPingSamples: 3,
  minimumTelemetrySamples: 20,
  serviceRttP95Ms: 120,
  sourceToVisibleP95Ms: 250,
  renderDelayP95Ms: 40,
});

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function nonNegative(value) {
  const number = finiteNumber(value);
  return number === null ? null : Math.max(0, number);
}

function rounded(value, digits = 3) {
  if (!Number.isFinite(value)) return null;
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function epochFrom(value, fallback = null) {
  const numeric = finiteNumber(value);
  if (numeric !== null) return numeric;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function percentile(values, fraction) {
  const sorted = values
    .map(Number)
    .filter(Number.isFinite)
    .sort((left, right) => left - right);
  if (sorted.length === 0) return null;
  if (sorted.length === 1) return sorted[0];
  const position = Math.max(0, Math.min(1, Number(fraction))) * (sorted.length - 1);
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  const weight = position - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

function summarize(values, totalSamples = values.length) {
  const finite = values.map(Number).filter(Number.isFinite);
  if (finite.length === 0) {
    return {
      count: 0,
      totalSamples,
      current: null,
      minimum: null,
      maximum: null,
      mean: null,
      p50: null,
      p95: null,
      p99: null,
    };
  }
  const sum = finite.reduce((total, value) => total + value, 0);
  return {
    count: finite.length,
    totalSamples,
    current: rounded(finite.at(-1)),
    minimum: rounded(Math.min(...finite)),
    maximum: rounded(Math.max(...finite)),
    mean: rounded(sum / finite.length),
    p50: rounded(percentile(finite, 0.5)),
    p95: rounded(percentile(finite, 0.95)),
    p99: rounded(percentile(finite, 0.99)),
  };
}

class SampleWindow {
  constructor(limit) {
    this.limit = limit;
    this.entries = [];
    this.sequence = 0;
  }

  append(value, at) {
    const sample = nonNegative(value);
    if (sample === null) return null;
    const entry = { sequence: ++this.sequence, value: sample, at };
    this.entries.push(entry);
    if (this.entries.length > this.limit) this.entries.splice(0, this.entries.length - this.limit);
    return entry;
  }

  valuesSince(sequence = 0) {
    return this.entries
      .filter((entry) => entry.sequence > sequence)
      .map((entry) => entry.value);
  }

  summarySince(sequence = 0) {
    return summarize(this.valuesSince(sequence), this.sequence - sequence);
  }

  history(limit = this.limit) {
    return this.entries.slice(-Math.max(0, Number(limit) || 0)).map((entry) => ({ ...entry }));
  }

  clear() {
    this.entries = [];
    this.sequence = 0;
  }
}

export function calculateClockSample(payload, timing) {
  if (!payload || payload.protocol !== LATENCY_PING_PROTOCOL) {
    throw new Error("Latency service protocol mismatch.");
  }
  if (payload.physicalMotionPermitted !== false) {
    throw new Error("Latency service did not preserve the physical-motion interlock.");
  }

  const clientSentEpochMs = finiteNumber(timing?.clientSentEpochMs);
  const clientRoundTripMs = nonNegative(timing?.clientRoundTripMs);
  const serverReceivedEpochMs = epochFrom(payload.serverReceivedEpochMs, epochFrom(payload.serverReceivedAt));
  const serverSentEpochMs = epochFrom(payload.serverSentEpochMs, epochFrom(payload.serverSentAt));
  if (
    clientSentEpochMs === null
    || clientRoundTripMs === null
    || serverReceivedEpochMs === null
    || serverSentEpochMs === null
    || serverSentEpochMs < serverReceivedEpochMs
  ) {
    throw new Error("Latency service returned invalid timing evidence.");
  }

  const clientReceivedEpochMs = clientSentEpochMs + clientRoundTripMs;
  const serviceProcessingMs = serverSentEpochMs - serverReceivedEpochMs;
  if (serviceProcessingMs > clientRoundTripMs + 5) {
    throw new Error("Latency timing evidence is internally inconsistent.");
  }
  const clockOffsetMs = (
    (serverReceivedEpochMs - clientSentEpochMs)
    + (serverSentEpochMs - clientReceivedEpochMs)
  ) / 2;

  return Object.freeze({
    protocol: LATENCY_PING_PROTOCOL,
    capturedAt: new Date(clientReceivedEpochMs).toISOString(),
    clientSentEpochMs,
    clientReceivedEpochMs,
    serverReceivedEpochMs,
    serverSentEpochMs,
    roundTripMs: rounded(clientRoundTripMs),
    networkRoundTripMs: rounded(Math.max(0, clientRoundTripMs - serviceProcessingMs)),
    serviceProcessingMs: rounded(serviceProcessingMs),
    clockOffsetMs: rounded(clockOffsetMs, 6),
    serviceUptimeMs: nonNegative(payload.serviceUptimeMs),
    telemetrySequence: Number.isInteger(payload.telemetrySequence) ? payload.telemetrySequence : null,
    bridgeMode: typeof payload.bridgeMode === "string" ? payload.bridgeMode : null,
    connected: payload.connected === true,
    physicalMotionPermitted: false,
  });
}

export async function requestLatencySample(endpoint, options = {}) {
  const fetchImpl = options.fetch ?? globalThis.fetch?.bind(globalThis);
  if (typeof fetchImpl !== "function") throw new Error("Fetch is unavailable.");
  const now = options.now ?? Date.now;
  const performanceNow = options.performanceNow
    ?? (() => globalThis.performance?.now?.() ?? Date.now());
  const timeoutMs = Math.max(250, Math.min(5000, Number(options.timeoutMs) || 1500));
  const controller = new AbortController();
  const externalSignal = options.signal;
  const abortFromExternal = () => controller.abort(externalSignal.reason);
  if (externalSignal?.aborted) abortFromExternal();
  else externalSignal?.addEventListener?.("abort", abortFromExternal, { once: true });
  const timeout = globalThis.setTimeout(() => controller.abort(new Error("Latency ping timed out.")), timeoutMs);
  const clientSentEpochMs = now();
  const startedAt = performanceNow();
  try {
    const response = await fetchImpl(endpoint, {
      method: "GET",
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Latency service returned HTTP ${response.status}.`);
    const payload = await response.json();
    const finishedAt = performanceNow();
    return calculateClockSample(payload, {
      clientSentEpochMs,
      clientRoundTripMs: Math.max(0, finishedAt - startedAt),
    });
  } finally {
    globalThis.clearTimeout(timeout);
    externalSignal?.removeEventListener?.("abort", abortFromExternal);
  }
}

function diagnosticsSnapshot(diagnostics = {}) {
  return {
    eventCount: Math.max(0, Number(diagnostics.eventCount) || 0),
    sequenceGapCount: Math.max(0, Number(diagnostics.sequenceGapCount) || 0),
    duplicateCount: Math.max(0, Number(diagnostics.duplicateCount) || 0),
    sequenceResetCount: Math.max(0, Number(diagnostics.sequenceResetCount) || 0),
    reconnectCount: Math.max(0, Number(diagnostics.reconnectCount) || 0),
  };
}

function subtractDiagnostics(current, baseline) {
  return Object.fromEntries(Object.keys(current).map((key) => [
    key,
    Math.max(0, current[key] - (baseline?.[key] ?? 0)),
  ]));
}

export class LatencyMonitor {
  constructor(options = {}) {
    this.maxSamples = Math.max(60, Math.min(3600, Number(options.maxSamples) || 600));
    this.now = options.now ?? Date.now;
    this.metrics = Object.fromEntries(
      LATENCY_METRICS.map((name) => [name, new SampleWindow(this.maxSamples)]),
    );
    this.clockCandidates = [];
    this.bestClockSample = null;
    this.telemetryEvents = 0;
  }

  get clockOffsetMs() {
    return this.bestClockSample?.clockOffsetMs ?? null;
  }

  get clockSynchronized() {
    return Number.isFinite(this.clockOffsetMs);
  }

  recordPing(sample) {
    if (!sample || sample.protocol !== LATENCY_PING_PROTOCOL) {
      throw new Error("Cannot record an invalid latency sample.");
    }
    const at = sample.clientReceivedEpochMs ?? this.now();
    this.metrics.serviceRttMs.append(sample.roundTripMs, at);
    this.metrics.serviceProcessingMs.append(sample.serviceProcessingMs, at);
    this.clockCandidates.push(sample);
    if (this.clockCandidates.length > 24) this.clockCandidates.splice(0, this.clockCandidates.length - 24);
    this.bestClockSample = [...this.clockCandidates].sort((left, right) => (
      left.networkRoundTripMs - right.networkRoundTripMs
      || left.roundTripMs - right.roundTripMs
    ))[0] ?? null;
    return this.bestClockSample;
  }

  recordTelemetry(metadata) {
    const at = epochFrom(metadata?.clientReceivedAt, this.now());
    this.metrics.sourceAgeMs.append(metadata?.sourceAgeMs, at);
    this.metrics.bridgeAgeMs.append(metadata?.bridgeAgeMs, at);
    this.telemetryEvents += 1;
  }

  recordRender(metadata, renderDelayMs) {
    const at = epochFrom(metadata?.clientReceivedAt, this.now());
    const delay = nonNegative(renderDelayMs);
    this.metrics.renderDelayMs.append(delay, at);
    if (delay !== null && Number.isFinite(metadata?.sourceAgeMs)) {
      this.metrics.sourceToVisibleMs.append(metadata.sourceAgeMs + delay, at);
    }
  }

  mark(diagnostics = {}) {
    return Object.freeze({
      protocol: "mr1-latency-observation-mark-v1",
      createdAt: new Date(this.now()).toISOString(),
      metricSequences: Object.fromEntries(
        Object.entries(this.metrics).map(([name, metric]) => [name, metric.sequence]),
      ),
      telemetryEvents: this.telemetryEvents,
      diagnostics: diagnosticsSnapshot(diagnostics),
    });
  }

  snapshot(options = {}, mark = null) {
    const metricSequences = mark?.metricSequences ?? {};
    const diagnostics = diagnosticsSnapshot(options.diagnostics);
    const metrics = Object.fromEntries(Object.entries(this.metrics).map(([name, metric]) => [
      name,
      metric.summarySince(metricSequences[name] ?? 0),
    ]));
    const clockAgeMs = this.bestClockSample
      ? Math.max(0, this.now() - Date.parse(this.bestClockSample.capturedAt))
      : null;
    return {
      protocol: "mr1-latency-snapshot-v1",
      capturedAt: new Date(this.now()).toISOString(),
      observationStartedAt: mark?.createdAt ?? null,
      observationDurationMs: mark
        ? Math.max(0, this.now() - Date.parse(mark.createdAt))
        : null,
      metrics,
      telemetryEvents: Math.max(0, this.telemetryEvents - (mark?.telemetryEvents ?? 0)),
      diagnostics: mark ? subtractDiagnostics(diagnostics, mark.diagnostics) : diagnostics,
      clock: {
        synchronized: this.clockSynchronized && clockAgeMs <= 180_000,
        offsetMs: this.clockOffsetMs,
        bestRoundTripMs: this.bestClockSample?.roundTripMs ?? null,
        bestNetworkRoundTripMs: this.bestClockSample?.networkRoundTripMs ?? null,
        synchronizedAt: this.bestClockSample?.capturedAt ?? null,
        ageMs: clockAgeMs,
        candidateCount: this.clockCandidates.length,
      },
      context: {
        companion: options.companion === true,
        telemetryActive: options.telemetryActive === true,
        telemetryConnected: options.telemetryConnected === true,
        telemetryLinked: options.telemetryLinked === true,
        bridgeMode: options.bridgeMode ?? null,
        controllerPollMs: finiteNumber(options.controllerPollMs),
        renderQuality: options.renderQuality ?? null,
        rendererName: options.rendererName ?? null,
        scope: "UI_TRANSPORT_ONLY",
        physicalMotionPermitted: false,
        physicalControllerTimingProven: false,
      },
    };
  }

  history(metricName, limit = 120) {
    return this.metrics[metricName]?.history(limit) ?? [];
  }

  reset(options = {}) {
    Object.values(this.metrics).forEach((metric) => metric.clear());
    this.telemetryEvents = 0;
    if (options.preserveClock === false) {
      this.clockCandidates = [];
      this.bestClockSample = null;
    }
  }
}

export function evaluateLatencySnapshot(snapshot, gates = DEFAULT_LATENCY_GATES) {
  const reasons = [];
  const waiting = [];
  const metrics = snapshot?.metrics ?? {};
  const diagnostics = snapshot?.diagnostics ?? {};
  const pingSamples = metrics.serviceRttMs?.count ?? 0;
  const telemetrySamples = metrics.sourceToVisibleMs?.count ?? 0;

  if (!snapshot?.context?.telemetryLinked) waiting.push("TELEMETRY NOT LINKED");
  if (!snapshot?.clock?.synchronized) waiting.push("SERVICE CLOCK NOT SYNCHRONIZED");
  if (pingSamples < gates.minimumPingSamples) waiting.push(`PING SAMPLES ${pingSamples}/${gates.minimumPingSamples}`);
  if (telemetrySamples < gates.minimumTelemetrySamples) {
    waiting.push(`VISIBLE SAMPLES ${telemetrySamples}/${gates.minimumTelemetrySamples}`);
  }

  if ((diagnostics.sequenceGapCount ?? 0) > 0) reasons.push(`${diagnostics.sequenceGapCount} SEQUENCE GAPS`);
  if ((diagnostics.duplicateCount ?? 0) > 0) reasons.push(`${diagnostics.duplicateCount} DUPLICATES`);
  if ((diagnostics.sequenceResetCount ?? 0) > 0) reasons.push(`${diagnostics.sequenceResetCount} SEQUENCE RESETS`);
  if ((diagnostics.reconnectCount ?? 0) > 0) reasons.push(`${diagnostics.reconnectCount} RECONNECTS`);
  if ((metrics.serviceRttMs?.p95 ?? 0) > gates.serviceRttP95Ms) {
    reasons.push(`SERVICE P95 ${metrics.serviceRttMs.p95} MS`);
  }
  if ((metrics.sourceToVisibleMs?.p95 ?? 0) > gates.sourceToVisibleP95Ms) {
    reasons.push(`VISIBLE P95 ${metrics.sourceToVisibleMs.p95} MS`);
  }
  if ((metrics.renderDelayMs?.p95 ?? 0) > gates.renderDelayP95Ms) {
    reasons.push(`RENDER P95 ${metrics.renderDelayMs.p95} MS`);
  }

  const result = waiting.length > 0 ? "WAITING" : reasons.length > 0 ? "ATTENTION" : "PASS";
  return {
    protocol: "mr1-latency-evaluation-v1",
    result,
    reasons: result === "WAITING" ? waiting : reasons,
    gates: { ...gates },
    scope: "UI_TRANSPORT_ONLY",
    physicalControllerTimingProven: false,
    physicalMotionPermitted: false,
  };
}

export function createLatencyEvidence(snapshot, evaluation) {
  return {
    protocol: LATENCY_EVIDENCE_PROTOCOL,
    createdAt: new Date().toISOString(),
    evaluation,
    snapshot,
    boundary: {
      observed: ["SERVICE RTT", "SSE AGE", "BROWSER RENDER DELAY", "STREAM INTEGRITY"],
      notProven: ["OCTOPUS ISR JITTER", "STEP PULSE TIMING", "ELECTRICAL EMI IMMUNITY", "PHYSICAL MOTION"],
      physicalMotionPermitted: false,
    },
  };
}
