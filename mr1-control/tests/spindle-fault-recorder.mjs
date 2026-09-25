import assert from "node:assert/strict";
import test from "node:test";
import { SpindleFaultRecorder } from "../src/telemetry/spindle-fault-recorder.js";

function packet(alarmActive = false, alarmCode = 0) {
  return {
    protocol: "mr1-spindle-v1",
    state: alarmActive ? "fault" : "running",
    alarmCode,
    commandRpm: 7200,
    speeds: { motorRpm: 3600, encoderSpindleRpm: 7198 },
    load: { torquePercent: 42, currentA: 6.3 },
    signals: { alarmActive },
  };
}

test("freezes the preceding spindle window on a new alarm edge", () => {
  const recorder = new SpindleFaultRecorder({ windowMs: 5000, maxSamples: 10 });
  recorder.record(packet(), { telemetry: { motion: { feed: 650 }, line: 18 } }, 1000);
  recorder.record(packet(), { sensor: { score: 22, vibrationG: 0.04 } }, 2000);
  const frame = recorder.record(packet(true, 12), { telemetry: { motion: { feed: 500 }, line: 23 } }, 3000);

  assert.equal(frame.samples.length, 3);
  assert.equal(frame.trigger.alarmCode, 12);
  assert.equal(frame.trigger.controllerLine, 23);
  assert.equal(frame.trigger.feed, 500);
  assert.equal(frame.samples[1].chatterScore, 22);
});

test("does not replace a freeze frame until an alarm clears and rises again", () => {
  const recorder = new SpindleFaultRecorder({ windowMs: 2000, maxSamples: 10 });
  const first = recorder.record(packet(true, 12), {}, 1000);
  assert.equal(recorder.record(packet(true, 13), {}, 1500), first);
  recorder.record(packet(), {}, 2000);
  const second = recorder.record(packet(true, 14), {}, 4000);

  assert.notEqual(second, first);
  assert.equal(second.trigger.alarmCode, 14);
  assert.equal(second.samples.every((sample) => sample.timestampMs >= 2000), true);
});
