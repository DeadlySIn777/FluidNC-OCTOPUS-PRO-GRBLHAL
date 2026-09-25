const UINT32_RANGE = 0x1_0000_0000;
export const DEFAULT_SENSOR_HISTORY_LIMIT = 600;

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function eventEpochMs(sensor, metadata, fallback) {
  const candidates = [metadata?.clientReceivedAt, sensor?.bridgePublishedAt, sensor?.receivedAt];
  for (const candidate of candidates) {
    const parsed = Date.parse(candidate);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function sequenceDelta(previous, current) {
  if (!Number.isInteger(previous) || !Number.isInteger(current)) return null;
  if (current >= previous) return current - previous;
  if (previous > 0xffff_0000 && current < 0x0000_ffff) {
    return (UINT32_RANGE - previous) + current;
  }
  return null;
}

export function calculateVibrationOrder(frequencyHz, spindleRpm) {
  const frequency = finite(frequencyHz);
  const rpm = finite(spindleRpm);
  if (frequency === null || frequency <= 0 || rpm === null || rpm < 60) return null;
  const rotationalHz = rpm / 60;
  const order = frequency / rotationalHz;
  const nearestOrder = Math.max(1, Math.round(order));
  return {
    spindleRpm: rpm,
    rotationalHz,
    order,
    nearestOrder,
    distanceFromNearest: Math.abs(order - nearestOrder),
  };
}

export function evaluateSensorHealth(sensor, metadata = {}, nowEpochMs = Date.now()) {
  if (!sensor) return { state: "offline", label: "OFFLINE", issues: ["No sensor packet."] };
  const issues = [];
  let alarm = false;
  const receivedAt = Date.parse(sensor.receivedAt);
  const packetAgeMs = Number.isFinite(metadata.sourceAgeMs)
    ? metadata.sourceAgeMs
    : Number.isFinite(receivedAt) ? Math.max(0, nowEpochMs - receivedAt) : null;

  if (Number.isFinite(packetAgeMs) && packetAgeMs > 2500) {
    issues.push("Sensor packet is stale.");
    alarm = true;
  }
  if ((sensor.schemaVersion ?? 1) < 2) issues.push("Legacy packet has limited health evidence.");
  if (sensor.calibration?.active) issues.push("Baseline calibration is in progress.");
  else if (!sensor.calibrated) issues.push("Baseline is not calibrated.");
  if (sensor.calibrated && sensor.calibration?.persisted === false) {
    issues.push("Calibration is volatile and will be lost at reboot.");
  }
  if (["invalid", "error"].includes(sensor.calibration?.storageState)) {
    issues.push("Calibration storage needs attention.");
  }
  if (sensor.calibration?.lastResult === "rejected") {
    issues.push(`Calibration was rejected${sensor.calibration.lastReason && sensor.calibration.lastReason !== "none" ? `: ${sensor.calibration.lastReason}.` : "."}`);
  }
  if (sensor.health?.imu === false) {
    issues.push("IMU is not healthy.");
    alarm = true;
  }
  if (sensor.health?.audio === false) issues.push("Microphone acquisition is not healthy.");
  if (Number.isFinite(sensor.deviceSampleAgeMs) && sensor.deviceSampleAgeMs > 250) {
    issues.push("Device sample is old.");
  }
  if (Number.isFinite(sensor.processingMs) && sensor.processingMs > 150) {
    issues.push("Sensor processing exceeded 150 ms.");
  }
  if (Number.isFinite(sensor.health?.freeHeapBytes) && sensor.health.freeHeapBytes < 250_000) {
    issues.push("ESP32 free heap is low.");
  }
  if (Number(metadata.sequenceGap ?? 0) > 0) issues.push("Bridge sensor packets were skipped.");

  if (alarm) return { state: "alarm", label: "SENSOR HOLD", issues, packetAgeMs };
  if (sensor.calibration?.active) return { state: "calibrating", label: "CALIBRATING", issues, packetAgeMs };
  if (issues.length > 0) return { state: "warning", label: "CHECK SENSOR", issues, packetAgeMs };
  return { state: "ready", label: "HEALTHY", issues, packetAgeMs };
}

export class SensorSession {
  constructor(limit = DEFAULT_SENSOR_HISTORY_LIMIT) {
    this.limit = Math.max(20, Math.min(10_000, Math.trunc(limit) || DEFAULT_SENSOR_HISTORY_LIMIT));
    this.clear();
  }

  clear() {
    this.samples = [];
    this.totalSamples = 0;
    this.scoreSum = 0;
    this.maximumScore = null;
    this.maximumVibrationG = null;
    this.maximumTemperatureC = null;
    this.bridgeSequenceGaps = 0;
    this.deviceSequenceGaps = 0;
    this.deviceResets = 0;
    this.lastDeviceReportSequence = null;
    this.lastDeviceUptimeMs = null;
    this.lastState = null;
    this.stateTransitions = 0;
  }

  append(sensor, metadata = {}, context = {}, nowEpochMs = Date.now()) {
    if (!sensor || !Number.isFinite(sensor.score)) return null;
    const deviceSequence = sensor.deviceReportSequence;
    const deviceUptimeMs = sensor.deviceUptimeMs;
    const uptimeReset = Number.isInteger(this.lastDeviceUptimeMs)
      && Number.isInteger(deviceUptimeMs)
      && deviceUptimeMs < this.lastDeviceUptimeMs;
    const reportDelta = sequenceDelta(this.lastDeviceReportSequence, deviceSequence);
    if (uptimeReset || (Number.isInteger(this.lastDeviceReportSequence) && reportDelta === null)) {
      this.deviceResets += 1;
    } else if (Number.isInteger(reportDelta) && reportDelta > 1) {
      this.deviceSequenceGaps += reportDelta - 1;
    }
    if (Number.isInteger(deviceSequence)) this.lastDeviceReportSequence = deviceSequence;
    if (Number.isInteger(deviceUptimeMs)) this.lastDeviceUptimeMs = deviceUptimeMs;
    this.bridgeSequenceGaps += Math.max(0, Math.trunc(Number(metadata.sequenceGap) || 0));

    const state = String(sensor.state ?? "unknown");
    if (this.lastState !== null && state !== this.lastState) this.stateTransitions += 1;
    this.lastState = state;
    const spindleRpm = finite(context.spindleRpm);
    const order = calculateVibrationOrder(sensor.frequencyHz, spindleRpm);
    const sample = {
      atEpochMs: eventEpochMs(sensor, metadata, nowEpochMs),
      score: sensor.score,
      state,
      frequencyHz: finite(sensor.frequencyHz),
      vibrationG: finite(sensor.vibrationG),
      rotationDps: finite(sensor.rotationDps),
      temperatureC: finite(sensor.spindleTemperatureC ?? sensor.espTemperatureC),
      temperatureSource: sensor.temperatureSource ?? null,
      microphoneScore: finite(sensor.components?.microphone),
      accelerometerScore: finite(sensor.components?.accelerometer),
      gyroscopeScore: finite(sensor.components?.gyroscope),
      spindleRpm,
      vibrationOrder: order?.order ?? null,
      nearestOrder: order?.nearestOrder ?? null,
      deviceReportSequence: Number.isInteger(deviceSequence) ? deviceSequence : null,
      deviceSampleSequence: Number.isInteger(sensor.deviceSampleSequence)
        ? sensor.deviceSampleSequence
        : null,
      deviceSampleAgeMs: finite(sensor.deviceSampleAgeMs),
      processingMs: finite(sensor.processingMs),
      bridgeAgeMs: finite(metadata.bridgeAgeMs),
    };

    this.samples.push(sample);
    if (this.samples.length > this.limit) this.samples.shift();
    this.totalSamples += 1;
    this.scoreSum += sample.score;
    this.maximumScore = this.maximumScore === null
      ? sample.score
      : Math.max(this.maximumScore, sample.score);
    if (sample.vibrationG !== null) {
      this.maximumVibrationG = this.maximumVibrationG === null
        ? sample.vibrationG
        : Math.max(this.maximumVibrationG, sample.vibrationG);
    }
    if (sample.temperatureC !== null) {
      this.maximumTemperatureC = this.maximumTemperatureC === null
        ? sample.temperatureC
        : Math.max(this.maximumTemperatureC, sample.temperatureC);
    }
    return sample;
  }

  snapshot() {
    return {
      totalSamples: this.totalSamples,
      retainedSamples: this.samples.length,
      meanScore: this.totalSamples > 0 ? this.scoreSum / this.totalSamples : null,
      maximumScore: this.maximumScore,
      maximumVibrationG: this.maximumVibrationG,
      maximumTemperatureC: this.maximumTemperatureC,
      bridgeSequenceGaps: this.bridgeSequenceGaps,
      deviceSequenceGaps: this.deviceSequenceGaps,
      deviceResets: this.deviceResets,
      stateTransitions: this.stateTransitions,
      latest: this.samples.at(-1) ?? null,
    };
  }

  toCsv() {
    const columns = [
      "timestamp",
      "score",
      "state",
      "frequency_hz",
      "vibration_g",
      "rotation_dps",
      "temperature_c",
      "temperature_source",
      "microphone_score",
      "accelerometer_score",
      "gyroscope_score",
      "spindle_rpm",
      "vibration_order",
      "nearest_order",
      "device_report_sequence",
      "device_sample_sequence",
      "device_sample_age_ms",
      "processing_ms",
      "bridge_age_ms",
    ];
    const value = (candidate) => candidate === null || candidate === undefined ? "" : String(candidate);
    const rows = this.samples.map((sample) => [
      new Date(sample.atEpochMs).toISOString(),
      sample.score,
      sample.state,
      sample.frequencyHz,
      sample.vibrationG,
      sample.rotationDps,
      sample.temperatureC,
      sample.temperatureSource,
      sample.microphoneScore,
      sample.accelerometerScore,
      sample.gyroscopeScore,
      sample.spindleRpm,
      sample.vibrationOrder,
      sample.nearestOrder,
      sample.deviceReportSequence,
      sample.deviceSampleSequence,
      sample.deviceSampleAgeMs,
      sample.processingMs,
      sample.bridgeAgeMs,
    ].map(value).join(","));
    return `${columns.join(",")}\n${rows.join("\n")}${rows.length ? "\n" : ""}`;
  }
}
