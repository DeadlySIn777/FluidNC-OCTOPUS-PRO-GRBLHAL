import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateVibrationOrder,
  evaluateSensorHealth,
  SensorSession,
} from "../src/sensor-session.js";

function sensor(overrides = {}) {
  return {
    schemaVersion: 2,
    receivedAt: "2026-08-26T12:00:00.000Z",
    score: 24,
    state: "ok",
    calibrated: true,
    frequencyHz: 1200,
    vibrationG: 0.04,
    rotationDps: 2.5,
    espTemperatureC: 39,
    spindleTemperatureC: null,
    temperatureSource: "esp-internal",
    components: { microphone: 25, accelerometer: 20, gyroscope: 10 },
    health: { imu: true, audio: true, freeHeapBytes: 500_000 },
    calibration: { active: false },
    deviceReportSequence: 10,
    deviceSampleSequence: 40,
    deviceUptimeMs: 5000,
    deviceSampleAgeMs: 5,
    processingMs: 66,
    ...overrides,
  };
}

test("calculates spindle rotational order from dominant frequency", () => {
  const result = calculateVibrationOrder(1200, 6000);
  assert.equal(result.rotationalHz, 100);
  assert.equal(result.order, 12);
  assert.equal(result.nearestOrder, 12);
  assert.equal(calculateVibrationOrder(1200, 0), null);
});

test("health grading fails closed for stale or unhealthy evidence", () => {
  assert.equal(evaluateSensorHealth(sensor(), { sourceAgeMs: 20 }).state, "ready");
  assert.equal(evaluateSensorHealth(sensor({ calibrated: false }), { sourceAgeMs: 20 }).state, "warning");
  assert.equal(evaluateSensorHealth(sensor({ calibration: { active: false, persisted: false } }), { sourceAgeMs: 20 }).state, "warning");
  assert.match(
    evaluateSensorHealth(sensor({ calibration: { active: false, lastResult: "rejected", lastReason: "machine_not_quiet" } }), { sourceAgeMs: 20 }).issues.join(" "),
    /machine_not_quiet/,
  );
  assert.equal(evaluateSensorHealth(sensor({ health: { imu: false, audio: true } }), { sourceAgeMs: 20 }).state, "alarm");
  assert.equal(evaluateSensorHealth(sensor(), { sourceAgeMs: 3000 }).state, "alarm");
});

test("session tracks gaps, resets, spindle order, and bounded history", () => {
  const session = new SensorSession(20);
  session.append(sensor(), { sequenceGap: 2, bridgeAgeMs: 3 }, { spindleRpm: 6000 });
  session.append(sensor({ deviceReportSequence: 13, deviceUptimeMs: 5200, score: 50 }), {}, { spindleRpm: 6000 });
  session.append(sensor({ deviceReportSequence: 1, deviceUptimeMs: 100, score: 10 }), {}, { spindleRpm: 6000 });
  for (let index = 0; index < 25; index += 1) {
    session.append(sensor({ deviceReportSequence: index + 2, deviceUptimeMs: 200 + index }), {}, {});
  }
  const snapshot = session.snapshot();
  assert.equal(snapshot.retainedSamples, 20);
  assert.equal(snapshot.bridgeSequenceGaps, 2);
  assert.equal(snapshot.deviceSequenceGaps, 2);
  assert.equal(snapshot.deviceResets, 1);
  assert.equal(session.samples[0].vibrationOrder, null);
});

test("session exports retained samples as CSV", () => {
  const session = new SensorSession();
  session.append(sensor(), { clientReceivedAt: "2026-08-26T12:00:01.000Z" }, { spindleRpm: 6000 });
  const csv = session.toCsv();
  assert.match(csv, /^timestamp,score,state,/);
  assert.match(csv, /2026-08-26T12:00:01.000Z,24,ok,1200/);
  assert.match(csv, /,6000,12,12,/);
});
