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
