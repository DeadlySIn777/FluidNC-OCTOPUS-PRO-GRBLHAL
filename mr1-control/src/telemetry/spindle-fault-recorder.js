function finiteOrNull(value) {
  return Number.isFinite(value) ? Number(value) : null;
}

export class SpindleFaultRecorder {
  constructor({ windowMs = 5000, maxSamples = 500 } = {}) {
    this.windowMs = windowMs;
    this.maxSamples = maxSamples;
    this.samples = [];
    this.alarmActive = false;
    this.freezeFrame = null;
  }

  record(spindle, context = {}, now = Date.now()) {
    if (spindle?.protocol !== "mr1-spindle-v1" || !Number.isFinite(now)) return this.freezeFrame;

    const sample = {
      timestampMs: now,
      spindleState: spindle.state ?? null,
      alarmCode: finiteOrNull(spindle.alarmCode),
      commandRpm: finiteOrNull(spindle.commandRpm),
      motorRpm: finiteOrNull(spindle.speeds?.motorRpm),
      encoderSpindleRpm: finiteOrNull(spindle.speeds?.encoderSpindleRpm),
      torquePercent: finiteOrNull(spindle.load?.torquePercent),
      currentA: finiteOrNull(spindle.load?.currentA),
      feed: finiteOrNull(context.telemetry?.motion?.feed),
      controllerLine: finiteOrNull(context.telemetry?.line),
      chatterScore: finiteOrNull(context.sensor?.score),
      chatterFrequencyHz: finiteOrNull(context.sensor?.frequencyHz),
      vibrationG: finiteOrNull(context.sensor?.vibrationG),
    };
    this.samples.push(sample);
    const cutoff = now - this.windowMs;
    this.samples = this.samples
      .filter((entry) => entry.timestampMs >= cutoff)
      .slice(-this.maxSamples);

    const alarmActive = spindle.signals?.alarmActive === true || spindle.state === "fault";
    if (alarmActive && !this.alarmActive) {
      this.freezeFrame = {
        capturedAt: new Date(now).toISOString(),
        trigger: { ...sample },
        samples: this.samples.map((entry) => ({ ...entry })),
      };
    }
    this.alarmActive = alarmActive;
    return this.freezeFrame;
  }
}
