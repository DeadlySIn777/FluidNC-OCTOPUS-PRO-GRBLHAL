import assert from "node:assert/strict";
import test from "node:test";
import { parseChatterSensorLine } from "../src/telemetry/chatter-status.js";

test("normalizes a bounded ESP32 chatter packet", () => {
  const packet = parseChatterSensorLine(JSON.stringify({
    type: "chatter",
    schema: 2,
    version: "7.6-mr1",
    report_seq: 42,
    sample_seq: 210,
    uptime_ms: 5000,
    sample_ms: 4992,
    processing_us: 66500,
    score: 42.5,
    state: "warning",
    cal: true,
    temp: 35.2,
    freq: 1260,
    vib: 0.08,
    rot: 3.4,
    batt: 78,
    battV: 4.02,
    chrg: true,
    mic: 50,
    imu: 40,
    gyro: 20,
    imu_ok: true,
    audio_ok: true,
    imu_samples: 64,
    audio_total: 120000,
    audio_band: 25000,
    sample_rate: 16000,
    fft_size: 1024,
    imu_rate: 897,
    cal_active: false,
    cal_count: 50,
    cal_total: 50,
    cal_settle_ms: 0,
    cal_cmd: true,
    cal_clear: true,
    cal_persisted: true,
    cal_store: "valid",
    cal_result: "loaded",
    cal_reason: "none",
    cal_generation: 3,
    cal_slots: 2,
    base_vib: 0.025,
    base_rot: 1.2,
    base_mic: 3.5,
    base_vib_std: 0.002,
    base_rot_std: 0.15,
    base_mic_std: 0.8,
    warn_score: 40,
    chatter_score: 70,
    free_heap: 550000,
    min_free_heap: 480000,
    wifi: true,
    ip: "192.168.1.50",
    acc: { x: 0.1, y: -0.2, z: 1.02 },
    gyr: { x: 1, y: 2, z: 3 },
  }), { receivedAt: "2026-08-22T12:00:00.000Z" });

  assert.equal(packet.protocol, "mr1-chatter-v1");
  assert.equal(packet.sourceFormat, "mr1-chatter-v1");
  assert.equal(packet.schemaVersion, 2);
  assert.equal(packet.firmwareVersion, "7.6-mr1");
  assert.equal(packet.deviceReportSequence, 42);
  assert.equal(packet.deviceSampleAgeMs, 8);
  assert.equal(packet.processingMs, 66.5);
  assert.equal(packet.score, 42.5);
  assert.equal(packet.espTemperatureC, 35.2);
  assert.equal(packet.spindleTemperatureC, null);
  assert.equal(packet.sensorTemperatureC, 35.2);
  assert.equal(packet.temperatureSource, "esp-internal");
  assert.deepEqual(packet.acceleration, { x: 0.1, y: -0.2, z: 1.02 });
  assert.deepEqual(packet.health, {
    imu: true,
    audio: true,
    externalTemperature: null,
    externalTemperaturePresent: null,
    externalTemperatureFaults: null,
    imuSamples: 64,
    freeHeapBytes: 550000,
    minimumFreeHeapBytes: 480000,
  });
  assert.equal(packet.dsp.fftSize, 1024);
  assert.equal(packet.calibration.progress, 1);
  assert.equal(packet.calibration.commandStartSupported, true);
  assert.equal(packet.calibration.commandClearSupported, true);
  assert.equal(packet.calibration.persisted, true);
  assert.equal(packet.calibration.storageState, "valid");
  assert.equal(packet.calibration.lastResult, "loaded");
  assert.equal(packet.calibration.generation, 3);
  assert.equal(packet.calibration.validSlots, 2);
  assert.equal(packet.calibration.vibrationStdDevG, 0.002);
  assert.equal(packet.thresholds.warningScore, 40);
  assert.equal(packet.network.ipAddress, "192.168.1.50");
  assert.equal(packet.receivedAt, "2026-08-22T12:00:00.000Z");
});

test("prefers an explicitly healthy spindle-surface sensor", () => {
  const packet = parseChatterSensorLine(JSON.stringify({
    type: "chatter",
    score: 12,
    state: "ok",
    esp_temp: 39.4,
    spindle_temp: 46.8,
    spindle_temp_ok: true,
    spindle_temp_present: true,
    spindle_temp_faults: 0,
  }));

  assert.equal(packet.espTemperatureC, 39.4);
  assert.equal(packet.spindleTemperatureC, 46.8);
  assert.equal(packet.sensorTemperatureC, 46.8);
  assert.equal(packet.temperatureSource, "spindle-surface");
  assert.equal(packet.health.externalTemperaturePresent, true);
  assert.equal(packet.health.externalTemperatureFaults, 0);
});

test("does not display an external reading unless firmware marks it healthy", () => {
  const packet = parseChatterSensorLine(JSON.stringify({
    type: "chatter",
    score: 12,
    state: "ok",
    esp_temp: 38.1,
    spindle_temp: 85,
    spindle_temp_ok: false,
    spindle_temp_present: true,
    spindle_temp_faults: 2,
  }));

  assert.equal(packet.spindleTemperatureC, null);
  assert.equal(packet.sensorTemperatureC, 38.1);
  assert.equal(packet.temperatureSource, "esp-internal");
  assert.equal(packet.health.externalTemperature, false);
  assert.equal(packet.health.externalTemperaturePresent, true);
  assert.equal(packet.health.externalTemperatureFaults, 2);
});

test("rejects logs, command events, malformed JSON, and unsafe values", () => {
  assert.equal(parseChatterSensorLine("[READY] sensor"), null);
  assert.equal(parseChatterSensorLine('{"event":"calibrated"}'), null);
  assert.equal(parseChatterSensorLine("{broken"), null);
  assert.equal(parseChatterSensorLine('{"type":"chatter","score":101,"state":"ok"}'), null);
  assert.equal(parseChatterSensorLine('{"type":"chatter","score":20,"state":"unknown"}'), null);
});

// Exact line format printed by legacy/fluidcnc-2025/chatter-waveshare-s3 sendChatterStatus().
function legacyLine(fields) {
  return JSON.stringify({
    chatter: {
      state: "warning",
      score: 55.4,
      freq: 1250,
      vib: 0.412,
      conf: 62,
      cal: 100,
      learned: 3,
      feed: 85,
      spindleTempC: 41.5,
      ...fields,
    },
  });
}

test("maps the archived FluidCNC {chatter:{...}} status line", () => {
  const packet = parseChatterSensorLine(legacyLine({}), { receivedAt: "2026-09-25T12:00:00.000Z" });

  assert.equal(packet.protocol, "mr1-chatter-v1");
  assert.equal(packet.sourceFormat, "fluidcnc-legacy-chatter");
  assert.equal(packet.schemaVersion, 1);
  assert.equal(packet.firmwareVersion, null);
  assert.equal(packet.receivedAt, "2026-09-25T12:00:00.000Z");
  assert.equal(packet.score, 55.4);
  assert.equal(packet.state, "warning");
  assert.equal(packet.frequencyHz, 1250);
});

test("does not reinterpret legacy fields whose meaning differs from v1", () => {
  const packet = parseChatterSensorLine(legacyLine({ state: "ok", score: 3.2 }));

  assert.equal(packet.state, "ok");
  // vib is a scaled baseline z-score, not acceleration in g.
  assert.equal(packet.vibrationG, null);
  // spindleTempC carries no health flag and latches after a disconnect.
  assert.equal(packet.spindleTemperatureC, null);
  assert.equal(packet.sensorTemperatureC, null);
  assert.equal(packet.temperatureSource, null);
  assert.equal(packet.health.externalTemperature, null);
  // cal is a calibration percentage, not the v1 qualified-calibration flag.
  assert.equal(packet.calibrated, false);
  assert.equal(packet.calibration.active, false);
  assert.equal(packet.calibration.progress, null);
  assert.equal(packet.rotationDps, null);
  assert.deepEqual(packet.components, { microphone: null, accelerometer: null, gyroscope: null });
});

test("maps legacy chatter and recovering states without under-reporting", () => {
  assert.equal(parseChatterSensorLine(legacyLine({ state: "chatter", score: 82 })).state, "chatter");
  assert.equal(parseChatterSensorLine(legacyLine({ state: "CHATTER", score: 82 })).state, "chatter");
  assert.equal(parseChatterSensorLine(legacyLine({ state: "recovering", score: 35 })).state, "warning");
});

test("rejects legacy lines that cannot be represented safely", () => {
  assert.equal(parseChatterSensorLine(legacyLine({ state: "calibrating", score: 0 })), null);
  assert.equal(parseChatterSensorLine(legacyLine({ state: "unknown" })), null);
  assert.equal(parseChatterSensorLine(legacyLine({ score: 120 })), null);
  assert.equal(parseChatterSensorLine(legacyLine({ score: "loud" })), null);
  assert.equal(parseChatterSensorLine('{"chatter":[1,2,3]}'), null);
  assert.equal(parseChatterSensorLine('{"chatter":"warning"}'), null);
  assert.equal(parseChatterSensorLine('{"chatter":{"state":"ok","score":5},"type":"status"}'), null);
  assert.equal(parseChatterSensorLine('{"response":"calibration_started"}'), null);
  assert.equal(parseChatterSensorLine('{"info":{"version":"4.2-temp-sensor","calibrated":true}}'), null);
  assert.equal(parseChatterSensorLine('{"temp":{"spindleTempC":41.5,"sensor":true}}'), null);
  assert.equal(parseChatterSensorLine("[1,2,3]"), null);
});

test("the current type field takes precedence over a legacy chatter object", () => {
  const packet = parseChatterSensorLine(JSON.stringify({
    type: "chatter",
    score: 10,
    state: "ok",
    chatter: { state: "chatter", score: 95 },
  }));

  assert.equal(packet.sourceFormat, "mr1-chatter-v1");
  assert.equal(packet.state, "ok");
  assert.equal(packet.score, 10);
});
