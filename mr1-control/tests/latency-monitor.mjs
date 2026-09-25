import assert from "node:assert/strict";
import test from "node:test";

import {
  LATENCY_PING_PROTOCOL,
  LatencyMonitor,
  calculateClockSample,
  createLatencyEvidence,
  evaluateLatencySnapshot,
  percentile,
} from "../src/latency-monitor.js";

function pingPayload(overrides = {}) {
  return {
    protocol: LATENCY_PING_PROTOCOL,
    serverReceivedEpochMs: 95_010,
    serverSentEpochMs: 95_011,
    serviceUptimeMs: 5000,
    telemetrySequence: 42,
    bridgeMode: "simulate",
    connected: true,
    physicalMotionPermitted: false,
    ...overrides,
  };
}

test("latency percentiles use bounded linear interpolation", () => {
  assert.equal(percentile([], 0.95), null);
  assert.equal(percentile([7], 0.95), 7);
  assert.equal(percentile([0, 10, 20, 30], 0.5), 15);
  assert.ok(Math.abs(percentile([0, 10, 20, 30], 0.95) - 28.5) < 1e-9);
});

test("clock sample estimates server minus client offset with monotonic RTT", () => {
  const sample = calculateClockSample(pingPayload(), {
    clientSentEpochMs: 100_000,
    clientRoundTripMs: 21,
  });
  assert.equal(sample.clockOffsetMs, -5000);
  assert.equal(sample.roundTripMs, 21);
  assert.equal(sample.networkRoundTripMs, 20);
  assert.equal(sample.serviceProcessingMs, 1);
  assert.equal(sample.physicalMotionPermitted, false);
});

test("clock sample rejects protocol and physical-interlock violations", () => {
  assert.throws(
    () => calculateClockSample(pingPayload({ protocol: "wrong" }), {
      clientSentEpochMs: 100_000,
      clientRoundTripMs: 21,
    }),
    /protocol mismatch/,
  );
  assert.throws(
    () => calculateClockSample(pingPayload({ physicalMotionPermitted: true }), {
      clientSentEpochMs: 100_000,
      clientRoundTripMs: 21,
    }),
    /physical-motion interlock/,
  );
});

test("rolling monitor isolates an observation window and passes healthy UI transport", () => {
  let now = 200_000;
  const monitor = new LatencyMonitor({ now: () => now, maxSamples: 120 });
  const diagnostics = {
    eventCount: 10,
    sequenceGapCount: 0,
    duplicateCount: 0,
    sequenceResetCount: 0,
    reconnectCount: 1,
  };
  const mark = monitor.mark(diagnostics);

  for (let index = 0; index < 4; index += 1) {
    const sample = calculateClockSample(pingPayload({
      serverReceivedEpochMs: 195_005 + index,
      serverSentEpochMs: 195_006 + index,
    }), {
      clientSentEpochMs: 200_000 + index,
      clientRoundTripMs: 12 + index,
    });
    monitor.recordPing(sample);
  }
  for (let index = 0; index < 25; index += 1) {
    const metadata = {
      clientReceivedAt: new Date(now + index * 100).toISOString(),
      sourceAgeMs: 14 + (index % 3),
      bridgeAgeMs: 8 + (index % 2),
    };
    monitor.recordTelemetry(metadata);
    monitor.recordRender(metadata, 4 + (index % 2));
  }
  now += 10_000;

  const snapshot = monitor.snapshot({
    diagnostics: { ...diagnostics, eventCount: 35 },
    companion: true,
    telemetryActive: true,
    telemetryConnected: true,
    telemetryLinked: true,
    bridgeMode: "simulate",
    controllerPollMs: 100,
    renderQuality: "reduced",
  }, mark);
  const evaluation = evaluateLatencySnapshot(snapshot);
  assert.equal(snapshot.metrics.serviceRttMs.count, 4);
  assert.equal(snapshot.metrics.sourceToVisibleMs.count, 25);
  assert.equal(snapshot.diagnostics.reconnectCount, 0);
  assert.equal(snapshot.clock.synchronized, true);
  assert.equal(evaluation.result, "PASS");

  const evidence = createLatencyEvidence(snapshot, evaluation);
  assert.equal(evidence.boundary.physicalMotionPermitted, false);
  assert.ok(evidence.boundary.notProven.includes("STEP PULSE TIMING"));
});

test("integrity loss changes an otherwise complete observation to attention", () => {
  const monitor = new LatencyMonitor({ now: () => 300_000 });
  const mark = monitor.mark({});
  for (let index = 0; index < 3; index += 1) {
    monitor.recordPing(calculateClockSample(pingPayload(), {
      clientSentEpochMs: 300_000 + index,
      clientRoundTripMs: 10,
    }));
  }
  for (let index = 0; index < 20; index += 1) {
    const metadata = { clientReceivedAt: new Date(300_000).toISOString(), sourceAgeMs: 10, bridgeAgeMs: 5 };
    monitor.recordTelemetry(metadata);
    monitor.recordRender(metadata, 3);
  }
  const snapshot = monitor.snapshot({
    diagnostics: { eventCount: 20, sequenceGapCount: 2 },
    telemetryLinked: true,
  }, mark);
  const evaluation = evaluateLatencySnapshot(snapshot);
  assert.equal(evaluation.result, "ATTENTION");
  assert.match(evaluation.reasons.join(" "), /SEQUENCE GAPS/);
});
