const SENSOR_STATES = new Set(["ok", "warning", "chatter"]);
const CALIBRATION_STORAGE_STATES = new Set(["none", "valid", "invalid", "error", "volatile"]);
const CALIBRATION_RESULTS = new Set([
  "none",
  "running",
  "loaded",
  "saved",
  "volatile",
  "cleared",
  "rejected",
  "load_failed",
  "load_rejected",
  "clear_failed",
]);

function finiteInRange(value, minimum, maximum) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= minimum && number <= maximum ? number : null;
}

function integerInRange(value, minimum, maximum) {
  const number = finiteInRange(value, minimum, maximum);
  return Number.isInteger(number) ? number : null;
}

function booleanOrNull(value) {
  return value === true || value === false ? value : null;
}

function boundedText(value, maximumLength = 64) {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text && text.length <= maximumLength ? text : null;
}

function boundedEnum(value, allowed) {
  const text = boundedText(value, 32)?.toLowerCase() ?? null;
  return text && allowed.has(text) ? text : null;
}

function unsignedDeviceAge(uptimeMs, sampleMs) {
  if (!Number.isInteger(uptimeMs) || !Number.isInteger(sampleMs)) return null;
  const age = uptimeMs >= sampleMs
    ? uptimeMs - sampleMs
    : (0x1_0000_0000 - sampleMs) + uptimeMs;
  return age <= 60_000 ? age : null;
}

function vector(value, minimum, maximum) {
  if (!value || typeof value !== "object") return null;
  const result = {
    x: finiteInRange(value.x, minimum, maximum),
    y: finiteInRange(value.y, minimum, maximum),
    z: finiteInRange(value.z, minimum, maximum),
  };
  return Object.values(result).every(Number.isFinite) ? result : null;
}

// The archived FluidCNC Waveshare firmware (legacy/fluidcnc-2025/chatter-waveshare-s3)
// prints {"chatter":{"state","score","freq","vib","conf","cal","learned","feed",
// "spindleTempC"}}. Only fields whose meaning matches mr1-chatter-v1 are mapped:
// - score: smoothed 0-100 chatter likelihood; freq: dominant frequency in Hz.
// - state: ok/warning/chatter unchanged. "recovering" is entered only from chatter
//   and held until the score stays below 25 for 5 s, so it is reported as warning
//   rather than ok. "calibrating" lines are dropped: that detector does not
//   evaluate chatter while calibrating and its score is stale.
// Not mapped: vib is a baseline z-score scaled by 0.1, not g; spindleTempC has no
// health flag and keeps the last reading after a sensor disconnect (-127 = never
// read); conf, cal (a percentage, not the v1 calibrated flag), learned and feed
// have no v1 equivalent.
const LEGACY_STATES = new Map([
  ["ok", "ok"],
  ["warning", "warning"],
  ["chatter", "chatter"],
  ["recovering", "warning"],
]);

function legacyChatterPayload(payload) {
  const legacy = payload.chatter;
  if (payload.type !== undefined || !legacy || typeof legacy !== "object" || Array.isArray(legacy)) return null;
  const state = LEGACY_STATES.get(String(legacy.state ?? "").toLowerCase());
  if (!state) return null;
  return { type: "chatter", score: legacy.score, state, freq: legacy.freq };
}

export function parseChatterSensorLine(line, options = {}) {
  const raw = String(line ?? "").trim();
  if (!raw || raw.length > 4096 || !raw.startsWith("{")) return null;

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const sourceFormat = payload.type === "chatter" ? "mr1-chatter-v1" : "fluidcnc-legacy-chatter";
  if (payload.type !== "chatter") payload = legacyChatterPayload(payload);
  if (!payload) return null;

  const score = finiteInRange(payload.score, 0, 100);
  const state = String(payload.state ?? "").toLowerCase();
  if (!Number.isFinite(score) || !SENSOR_STATES.has(state)) return null;

  const espTemperatureC = finiteInRange(payload.esp_temp ?? payload.temp, -40, 125);
  const spindleTemperatureC = payload.spindle_temp_ok === true
    ? finiteInRange(payload.spindle_temp, -40, 125)
    : null;
  const deviceUptimeMs = integerInRange(payload.uptime_ms, 0, 0xffff_ffff);
  const deviceSampleUptimeMs = integerInRange(payload.sample_ms, 0, 0xffff_ffff);
  const calibrationCount = integerInRange(payload.cal_count, 0, 10_000);
  const calibrationTotal = integerInRange(payload.cal_total, 1, 10_000);

  return {
    protocol: "mr1-chatter-v1",
    sourceFormat,
    schemaVersion: integerInRange(payload.schema, 1, 2) ?? 1,
    firmwareVersion: boundedText(payload.version, 32),
    receivedAt: options.receivedAt ?? new Date().toISOString(),
    deviceReportSequence: integerInRange(payload.report_seq, 0, 0xffff_ffff),
    deviceSampleSequence: integerInRange(payload.sample_seq, 0, 0xffff_ffff),
    deviceUptimeMs,
    deviceSampleUptimeMs,
    deviceSampleAgeMs: unsignedDeviceAge(deviceUptimeMs, deviceSampleUptimeMs),
    processingMs: Number.isFinite(finiteInRange(payload.processing_us, 0, 10_000_000))
      ? finiteInRange(payload.processing_us, 0, 10_000_000) / 1000
      : null,
    score,
    state,
    calibrated: payload.cal === true,
    frequencyHz: finiteInRange(payload.freq, 0, 8000),
    vibrationG: finiteInRange(payload.vib, 0, 32),
    rotationDps: finiteInRange(payload.rot, 0, 10000),
    espTemperatureC,
    spindleTemperatureC,
    sensorTemperatureC: spindleTemperatureC ?? espTemperatureC,
    temperatureSource: Number.isFinite(spindleTemperatureC)
      ? "spindle-surface"
      : Number.isFinite(espTemperatureC) ? "esp-internal" : null,
    batteryPercent: finiteInRange(payload.batt, 0, 100),
    batteryVoltage: finiteInRange(payload.battV, 0, 6),
    charging: payload.chrg === true,
    components: {
      microphone: finiteInRange(payload.mic, 0, 100),
      accelerometer: finiteInRange(payload.imu, 0, 100),
      gyroscope: finiteInRange(payload.gyro, 0, 100),
    },
    acceleration: vector(payload.acc, -32, 32),
    gyroscope: vector(payload.gyr, -10000, 10000),
    health: {
      imu: booleanOrNull(payload.imu_ok),
      audio: booleanOrNull(payload.audio_ok),
      externalTemperature: booleanOrNull(payload.spindle_temp_ok),
      externalTemperaturePresent: booleanOrNull(payload.spindle_temp_present),
      externalTemperatureFaults: integerInRange(payload.spindle_temp_faults, 0, 0xffff_ffff),
      imuSamples: integerInRange(payload.imu_samples, 0, 4096),
      freeHeapBytes: integerInRange(payload.free_heap, 0, 64 * 1024 * 1024),
      minimumFreeHeapBytes: integerInRange(payload.min_free_heap, 0, 64 * 1024 * 1024),
    },
    dsp: {
      audioTotalEnergy: finiteInRange(payload.audio_total, 0, 1e12),
      audioBandEnergy: finiteInRange(payload.audio_band, 0, 1e12),
      sampleRateHz: integerInRange(payload.sample_rate, 1000, 192_000),
      fftSize: integerInRange(payload.fft_size, 64, 32_768),
      imuRateHz: finiteInRange(payload.imu_rate, 1, 10_000),
    },
    calibration: {
      active: payload.cal_active === true,
      count: calibrationCount,
      total: calibrationTotal,
      progress: Number.isInteger(calibrationCount) && Number.isInteger(calibrationTotal)
        ? Math.min(1, calibrationCount / calibrationTotal)
        : null,
      settleRemainingMs: integerInRange(payload.cal_settle_ms, 0, 60_000),
      commandStartSupported: booleanOrNull(payload.cal_cmd),
      commandClearSupported: booleanOrNull(payload.cal_clear),
      persisted: booleanOrNull(payload.cal_persisted),
      storageState: boundedEnum(payload.cal_store, CALIBRATION_STORAGE_STATES),
      lastResult: boundedEnum(payload.cal_result, CALIBRATION_RESULTS),
      lastReason: boundedText(payload.cal_reason, 64),
      generation: integerInRange(payload.cal_generation, 0, 0xffff_ffff),
      validSlots: integerInRange(payload.cal_slots, 0, 2),
      baselineVibrationG: finiteInRange(payload.base_vib, 0, 32),
      baselineRotationDps: finiteInRange(payload.base_rot, 0, 10_000),
      baselineMicrophoneScore: finiteInRange(payload.base_mic, 0, 100),
      vibrationStdDevG: finiteInRange(payload.base_vib_std, 0, 32),
      rotationStdDevDps: finiteInRange(payload.base_rot_std, 0, 10_000),
      microphoneStdDevScore: finiteInRange(payload.base_mic_std, 0, 100),
    },
    thresholds: {
      warningScore: finiteInRange(payload.warn_score, 0, 100),
      chatterScore: finiteInRange(payload.chatter_score, 0, 100),
    },
    network: {
      wifiConnected: booleanOrNull(payload.wifi),
      ipAddress: boundedText(payload.ip, 45),
    },
  };
}
