import assert from "node:assert/strict";
import test from "node:test";
import { TelemetryClient } from "../src/telemetry/client.js";

class FakeEventSource {
  static instances = [];

  constructor(url) {
    this.url = url;
    this.closed = false;
    this.listeners = new Map();
    FakeEventSource.instances.push(this);
  }

  addEventListener(name, listener) {
    this.listeners.set(name, listener);
  }

  emit(name, payload) {
    this.listeners.get(name)?.({ data: payload });
  }

  close() {
    this.closed = true;
  }
}

function createTimerHarness() {
  const timers = [];
  return {
    timers,
    setTimeout(callback, delay) {
      const timer = { callback, delay, cancelled: false };
      timers.push(timer);
      return timer;
    },
    clearTimeout(timer) {
      if (timer) timer.cancelled = true;
    },
    runNext() {
      const timer = timers.find((candidate) => !candidate.cancelled && !candidate.ran);
      assert.ok(timer, "expected a pending reconnect timer");
      timer.ran = true;
      timer.callback();
      return timer;
    },
  };
}

test("telemetry client connects, dispatches normalized status, and disconnects", () => {
  const originalEventSource = globalThis.EventSource;
  globalThis.EventSource = FakeEventSource;
  FakeEventSource.instances.length = 0;

  try {
    const states = [];
    const packets = [];
    const packetMetadata = [];
    const sensors = [];
    const spindlePackets = [];
    const journalPackets = [];
    const transactions = [];
    const client = new TelemetryClient({
      onState: ({ state }) => states.push(state),
      onTelemetry: (packet, metadata) => {
        packets.push(packet);
        packetMetadata.push(metadata);
      },
      onSensor: (packet) => sensors.push(packet),
      onSpindle: (packet) => spindlePackets.push(packet),
      onJournal: (packet) => journalPackets.push(packet),
      onTransaction: (packet) => transactions.push(packet),
    });

    client.connect();
    const source = FakeEventSource.instances[0];
    assert.equal(source.url, "http://127.0.0.1:8787/events");
    assert.equal(client.active, true);
    source.onopen();
    source.emit("telemetry", JSON.stringify({
      protocol: "grblhal-status-v1",
      sequence: 4,
      receivedAt: "2026-08-26T12:00:00.000Z",
      bridgePublishedAt: "2026-08-26T12:00:00.001Z",
      bridgeProcessingMs: 0.4,
    }));
    source.emit("sensor", JSON.stringify({ protocol: "mr1-chatter-v1", score: 22 }));
    source.emit("spindle", JSON.stringify({ protocol: "mr1-spindle-v1", state: "running" }));
    source.emit("journal", JSON.stringify({ protocol: "mr1-event-journal-v1", entries: 4 }));
    source.emit("transaction", JSON.stringify({
      protocol: "mr1-machine-transaction-v1",
      sequence: 2,
      state: "completed",
    }));
    assert.deepEqual(states, ["connecting", "open"]);
    assert.equal(packets.length, 1);
    assert.equal(packets[0].sequence, 4);
    assert.equal(packetMetadata[0].eventType, "telemetry");
    assert.equal(packetMetadata[0].sequenceGap, 0);
    assert.equal(packetMetadata[0].bridgeProcessingMs, 0.4);
    assert.deepEqual(sensors, [{ protocol: "mr1-chatter-v1", score: 22 }]);
    assert.deepEqual(spindlePackets, [{ protocol: "mr1-spindle-v1", state: "running" }]);
    assert.deepEqual(journalPackets, [{ protocol: "mr1-event-journal-v1", entries: 4 }]);
    assert.deepEqual(transactions, [{
      protocol: "mr1-machine-transaction-v1",
      sequence: 2,
      state: "completed",
    }]);

    client.disconnect();
    assert.equal(source.closed, true);
    assert.equal(client.active, false);
    assert.equal(states.at(-1), "closed");
  } finally {
    globalThis.EventSource = originalEventSource;
  }
});

test("telemetry client quarantines invalid JSON and schedules a reconnect", () => {
  const originalEventSource = globalThis.EventSource;
  globalThis.EventSource = FakeEventSource;
  FakeEventSource.instances.length = 0;

  try {
    const states = [];
    const timers = createTimerHarness();
    const client = new TelemetryClient({
      onState: (state) => states.push(state),
      setTimeout: timers.setTimeout,
      clearTimeout: timers.clearTimeout,
      reconnectBaseMs: 100,
      reconnectMaxMs: 400,
      reconnectJitterMs: 0,
      random: () => 0,
    });
    client.connect();
    const source = FakeEventSource.instances[0];
    source.emit("bridge", "{not-json");

    assert.equal(source.closed, true);
    assert.equal(client.active, true);
    assert.equal(client.connected, false);
    assert.equal(states.at(-1).state, "invalid-data");
    assert.equal(states.at(-1).delayMs, 100);
    timers.runNext();
    assert.equal(FakeEventSource.instances.length, 2);

    client.disconnect();
  } finally {
    globalThis.EventSource = originalEventSource;
  }
});

test("telemetry client reconnects with backoff and a manual disconnect cancels retries", () => {
  const originalEventSource = globalThis.EventSource;
  globalThis.EventSource = FakeEventSource;
  FakeEventSource.instances.length = 0;

  try {
    const states = [];
    const timers = createTimerHarness();
    const client = new TelemetryClient({
      onState: (state) => states.push(state),
      setTimeout: timers.setTimeout,
      clearTimeout: timers.clearTimeout,
      reconnectBaseMs: 100,
      reconnectMaxMs: 400,
      reconnectJitterMs: 0,
      random: () => 0,
    });

    client.connect();
    const first = FakeEventSource.instances[0];
    first.onerror();
    assert.equal(first.closed, true);
    assert.equal(states.at(-1).state, "reconnecting");
    assert.equal(states.at(-1).attempt, 1);
    assert.equal(states.at(-1).delayMs, 100);

    timers.runNext();
    const second = FakeEventSource.instances[1];
    second.onerror();
    assert.equal(states.at(-1).attempt, 2);
    assert.equal(states.at(-1).delayMs, 200);
    const pending = timers.timers.at(-1);

    client.disconnect();
    assert.equal(pending.cancelled, true);
    assert.equal(client.active, false);
    assert.equal(client.connected, false);
    assert.equal(client.diagnostics.reconnectCount, 2);
  } finally {
    globalThis.EventSource = originalEventSource;
  }
});

test("telemetry client reports dropped, duplicate, and reset sequence numbers", () => {
  const originalEventSource = globalThis.EventSource;
  globalThis.EventSource = FakeEventSource;
  FakeEventSource.instances.length = 0;

  try {
    const metadata = [];
    const client = new TelemetryClient({
      now: () => Date.parse("2026-08-26T12:00:00.020Z"),
      performanceNow: () => 44.5,
      onTelemetry: (_packet, details) => metadata.push(details),
    });
    client.connect();
    const source = FakeEventSource.instances[0];
    const emit = (sequence) => source.emit("telemetry", JSON.stringify({
      protocol: "grblhal-status-v1",
      sequence,
      receivedAt: "2026-08-26T12:00:00.000Z",
      bridgePublishedAt: "2026-08-26T12:00:00.010Z",
    }));
    emit(10);
    emit(13);
    emit(13);
    emit(1);

    assert.deepEqual(metadata.map(({ sequenceGap }) => sequenceGap), [0, 2, 0, 0]);
    assert.equal(metadata[2].duplicate, true);
    assert.equal(metadata[3].sequenceReset, true);
    assert.equal(metadata[0].sourceAgeMs, 20);
    assert.equal(metadata[0].bridgeAgeMs, 10);
    assert.equal(metadata[0].clientReceivedPerformanceMs, 44.5);
    assert.equal(client.diagnostics.sequenceGapCount, 2);
    assert.equal(client.diagnostics.duplicateCount, 1);
    assert.equal(client.diagnostics.sequenceResetCount, 1);

    client.disconnect();
  } finally {
    globalThis.EventSource = originalEventSource;
  }
});

test("telemetry client applies authenticated server clock offset to phone event age", () => {
  const client = new TelemetryClient({
    now: () => Date.parse("2026-08-26T12:00:05.020Z"),
  });
  client.setServerClockOffset(-5000, {
    capturedAt: "2026-08-26T12:00:05.000Z",
    roundTripMs: 12,
  });
  const metadata = client.buildEventMetadata("telemetry", {
    sequence: 1,
    receivedAt: "2026-08-26T12:00:00.000Z",
    bridgePublishedAt: "2026-08-26T12:00:00.010Z",
  });

  assert.equal(metadata.uncorrectedSourceAgeMs, 5020);
  assert.equal(metadata.sourceAgeMs, 20);
  assert.equal(metadata.bridgeAgeMs, 10);
  assert.equal(metadata.clockSynchronized, true);
  assert.equal(client.diagnostics.clockOffsetMs, -5000);
  assert.equal(client.diagnostics.clockRoundTripMs, 12);

  client.clearServerClockOffset();
  assert.equal(client.diagnostics.clockSynchronized, false);
});
