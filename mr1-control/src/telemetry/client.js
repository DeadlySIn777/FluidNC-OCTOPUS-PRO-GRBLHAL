const DEFAULT_RECONNECT_BASE_MS = 500;
const DEFAULT_RECONNECT_MAX_MS = 8000;
const DEFAULT_RECONNECT_JITTER_MS = 150;

function finiteTimestamp(value) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function nonNegativeInteger(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : fallback;
}

export class TelemetryClient {
  constructor(options = {}) {
    this.url = options.url ?? "http://127.0.0.1:8787/events";
    this.onState = options.onState ?? (() => {});
    this.onBridge = options.onBridge ?? (() => {});
    this.onTelemetry = options.onTelemetry ?? (() => {});
    this.onSensor = options.onSensor ?? (() => {});
    this.onSpindle = options.onSpindle ?? (() => {});
    this.onJournal = options.onJournal ?? (() => {});
    this.onController = options.onController ?? (() => {});
    this.onTransaction = options.onTransaction ?? (() => {});
    this.createEventSource = options.createEventSource ?? ((url) => new EventSource(url));
    this.setTimer = options.setTimeout ?? ((callback, delay) => globalThis.setTimeout(callback, delay));
    this.clearTimer = options.clearTimeout ?? ((timer) => globalThis.clearTimeout(timer));
    this.random = options.random ?? Math.random;
    this.now = options.now ?? Date.now;
    this.performanceNow = options.performanceNow
      ?? (() => globalThis.performance?.now?.() ?? 0);
    this.reconnectBaseMs = Math.max(
      1,
      nonNegativeInteger(options.reconnectBaseMs, DEFAULT_RECONNECT_BASE_MS),
    );
    this.reconnectMaxMs = Math.max(
      this.reconnectBaseMs,
      nonNegativeInteger(options.reconnectMaxMs, DEFAULT_RECONNECT_MAX_MS),
    );
    this.reconnectJitterMs = nonNegativeInteger(
      options.reconnectJitterMs,
      DEFAULT_RECONNECT_JITTER_MS,
    );
    this.source = null;
    this.reconnectTimer = null;
    this.reconnectAttempt = 0;
    this.generation = 0;
    this.desired = false;
    this.sequenceByEvent = new Map();
    this.metrics = this.emptyMetrics();
    this.serverClockOffsetMs = null;
    this.clockSync = null;
  }

  get active() {
    return this.desired;
  }

  get connected() {
    return this.source !== null;
  }

  get diagnostics() {
    return {
      ...this.metrics,
      active: this.active,
      connected: this.connected,
      reconnectAttempt: this.reconnectAttempt,
      clockSynchronized: Number.isFinite(this.serverClockOffsetMs),
      clockOffsetMs: this.serverClockOffsetMs,
      clockRoundTripMs: this.clockSync?.roundTripMs ?? null,
      clockSynchronizedAt: this.clockSync?.capturedAt ?? null,
    };
  }

  setServerClockOffset(offsetMs, evidence = {}) {
    const offset = Number(offsetMs);
    if (!Number.isFinite(offset) || Math.abs(offset) > 7 * 24 * 60 * 60 * 1000) {
      throw new Error("Server clock offset must be finite and within seven days.");
    }
    this.serverClockOffsetMs = offset;
    this.clockSync = {
      capturedAt: typeof evidence.capturedAt === "string"
        ? evidence.capturedAt
        : new Date(this.now()).toISOString(),
      roundTripMs: Number.isFinite(Number(evidence.roundTripMs))
        ? Math.max(0, Number(evidence.roundTripMs))
        : null,
    };
  }

  clearServerClockOffset() {
    this.serverClockOffsetMs = null;
    this.clockSync = null;
  }

  emptyMetrics() {
    return {
      eventCount: 0,
      reconnectCount: 0,
      sequenceGapCount: 0,
      duplicateCount: 0,
      sequenceResetCount: 0,
      lastEventType: null,
      lastEventAt: null,
      lastSourceAgeMs: null,
      lastBridgeAgeMs: null,
    };
  }

  connect() {
    if (this.desired) return;
    this.desired = true;
    this.generation += 1;
    this.reconnectAttempt = 0;
    this.sequenceByEvent.clear();
    this.metrics = this.emptyMetrics();
    this.onState({ state: "connecting", attempt: 0 });
    this.openSource(this.generation);
  }

  openSource(generation) {
    if (!this.desired || generation !== this.generation || this.source) return;

    let source;
    try {
      source = this.createEventSource(this.url);
    } catch (error) {
      this.scheduleReconnect("open-failed", "reconnecting", error);
      return;
    }
    this.source = source;

    source.onopen = () => {
      if (this.source !== source || !this.desired) return;
      this.onState({ state: "open", attempt: this.reconnectAttempt });
    };
    source.addEventListener("bridge", (event) => {
      this.dispatchEvent("bridge", event, source, this.onBridge);
    });
    source.addEventListener("telemetry", (event) => {
      this.dispatchEvent("telemetry", event, source, this.onTelemetry, "grblhal-status-v1");
    });
    source.addEventListener("sensor", (event) => {
      this.dispatchEvent("sensor", event, source, this.onSensor, "mr1-chatter-v1");
    });
    source.addEventListener("spindle", (event) => {
      this.dispatchEvent("spindle", event, source, this.onSpindle, "mr1-spindle-v1");
    });
    source.addEventListener("journal", (event) => {
      this.dispatchEvent("journal", event, source, this.onJournal, "mr1-event-journal-v1");
    });
    source.addEventListener("controller", (event) => {
      this.dispatchEvent("controller", event, source, this.onController);
    });
    source.addEventListener("transaction", (event) => {
      this.dispatchEvent(
        "transaction",
        event,
        source,
        this.onTransaction,
        "mr1-machine-transaction-v1",
      );
    });
    source.onerror = () => {
      if (this.source !== source || !this.desired) return;
      source.close();
      this.source = null;
      this.scheduleReconnect("transport-error");
    };
  }

  dispatchEvent(eventType, event, source, callback, expectedProtocol = null) {
    const payload = this.parseEvent(event, source);
    if (!payload || (expectedProtocol && payload.protocol !== expectedProtocol)) return;
    this.reconnectAttempt = 0;
    const metadata = this.buildEventMetadata(eventType, payload);
    callback(payload, metadata);
  }

  parseEvent(event, source = this.source) {
    try {
      return JSON.parse(event.data);
    } catch {
      if (this.source !== source || !this.desired) return null;
      source?.close();
      this.source = null;
      this.scheduleReconnect("invalid-json", "invalid-data");
      return null;
    }
  }

  buildEventMetadata(eventType, payload) {
    const receivedEpochMs = this.now();
    const sourceEpochMs = finiteTimestamp(payload?.receivedAt);
    const bridgeEpochMs = finiteTimestamp(payload?.bridgePublishedAt);
    const alignedReceivedEpochMs = receivedEpochMs + (this.serverClockOffsetMs ?? 0);
    const sequence = Number.isInteger(payload?.sequence) ? payload.sequence : null;
    const previousSequence = this.sequenceByEvent.get(eventType);
    let sequenceGap = 0;
    let duplicate = false;
    let sequenceReset = false;

    if (sequence !== null) {
      if (Number.isInteger(previousSequence)) {
        duplicate = sequence === previousSequence;
        sequenceReset = sequence < previousSequence;
        if (sequence > previousSequence + 1) sequenceGap = sequence - previousSequence - 1;
      }
      this.sequenceByEvent.set(eventType, sequence);
    }

    const uncorrectedSourceAgeMs = sourceEpochMs === null
      ? null
      : Math.max(0, receivedEpochMs - sourceEpochMs);
    const uncorrectedBridgeAgeMs = bridgeEpochMs === null
      ? null
      : Math.max(0, receivedEpochMs - bridgeEpochMs);
    const sourceAgeMs = sourceEpochMs === null
      ? null
      : Math.max(0, alignedReceivedEpochMs - sourceEpochMs);
    const bridgeAgeMs = bridgeEpochMs === null
      ? null
      : Math.max(0, alignedReceivedEpochMs - bridgeEpochMs);
    const metadata = {
      eventType,
      sequence,
      previousSequence: Number.isInteger(previousSequence) ? previousSequence : null,
      sequenceGap,
      duplicate,
      sequenceReset,
      clientReceivedAt: new Date(receivedEpochMs).toISOString(),
      clientReceivedPerformanceMs: this.performanceNow(),
      sourceAgeMs,
      bridgeAgeMs,
      uncorrectedSourceAgeMs,
      uncorrectedBridgeAgeMs,
      clockSynchronized: Number.isFinite(this.serverClockOffsetMs),
      clockOffsetMs: this.serverClockOffsetMs,
      bridgeProcessingMs: Number.isFinite(payload?.bridgeProcessingMs)
        ? payload.bridgeProcessingMs
        : null,
    };

    this.metrics.eventCount += 1;
    this.metrics.sequenceGapCount += sequenceGap;
    if (duplicate) this.metrics.duplicateCount += 1;
    if (sequenceReset) this.metrics.sequenceResetCount += 1;
    this.metrics.lastEventType = eventType;
    this.metrics.lastEventAt = metadata.clientReceivedAt;
    this.metrics.lastSourceAgeMs = sourceAgeMs;
    this.metrics.lastBridgeAgeMs = bridgeAgeMs;
    return metadata;
  }

  scheduleReconnect(reason, state = "reconnecting", error = null) {
    if (!this.desired || this.reconnectTimer !== null) return;
    const attempt = ++this.reconnectAttempt;
    const exponentialDelay = this.reconnectBaseMs * (2 ** Math.min(16, attempt - 1));
    const jitter = Math.floor(Math.max(0, this.random()) * (this.reconnectJitterMs + 1));
    const delayMs = Math.min(this.reconnectMaxMs, exponentialDelay + jitter);
    const generation = this.generation;
    this.metrics.reconnectCount += 1;
    this.onState({
      state,
      attempt,
      delayMs,
      reason,
      error: error instanceof Error ? error.message : error ? String(error) : null,
    });
    this.reconnectTimer = this.setTimer(() => {
      this.reconnectTimer = null;
      if (!this.desired || generation !== this.generation) return;
      this.openSource(generation);
    }, delayMs);
  }

  disconnect() {
    this.desired = false;
    this.generation += 1;
    if (this.reconnectTimer !== null) this.clearTimer(this.reconnectTimer);
    this.reconnectTimer = null;
    if (this.source) this.source.close();
    this.source = null;
    this.reconnectAttempt = 0;
    this.onState({ state: "closed" });
  }
}
