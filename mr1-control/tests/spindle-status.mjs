import assert from "node:assert/strict";
import test from "node:test";
import { isSpindleTelemetryLine, parseSpindleTelemetryLine } from "../src/telemetry/spindle-status.js";

const validLine = "[MR1SP|V:1|ST:running|MODE:speed|PATH:digital|CMD:7200|MRPM:3598|CRPM:7196|ERPM:7198|TQ:42.1|CUR:6.3|PKCUR:7.1|LOAD:38.2|REGEN:4.5|RDY:1|ALM:0|SON:1|ASP:1|ZSP:0|COIN:0|PTOS:0|AC:0|MBAGE:20|ENCAGE:5|IDXAGE:12|ERRS:2|RATIO:2.0000|DIFF:0.03|STAGE:2|APPROVED:0|PROFILE:-|MBR:0|MBW:0|M3OK:0|M4OK:0|M5OK:0|M19OK:0]";

test("parses a bounded read-only spindle report", () => {
  const packet = parseSpindleTelemetryLine(validLine, "2026-08-23T12:00:00.000Z");
  assert.equal(packet.protocol, "mr1-spindle-v1");
  assert.equal(packet.state, "running");
  assert.equal(packet.controlPath, "digital");
  assert.equal(packet.commandRpm, 7200);
  assert.equal(packet.speeds.motorRpm, 3598);
  assert.equal(packet.speeds.encoderSpindleRpm, 7198);
  assert.equal(packet.load.currentA, 6.3);
  assert.equal(packet.signals.ready, true);
  assert.equal(packet.signals.alarmActive, false);
  assert.equal(packet.commissioning.stage, 2);
  assert.equal(packet.commissioning.profileApproved, false);
  assert.equal(packet.commissioning.profileFingerprint, null);
  assert.deepEqual(packet.permits, {
    modbusRead: false,
    modbusWrite: false,
    m3: false,
    m4: false,
    m5: false,
    m19: false,
  });
});

test("rejects unknown, duplicate, malformed, or out-of-range fields", () => {
  assert.equal(parseSpindleTelemetryLine(validLine.replace("|CMD:7200", "|CMD:9000")), null);
  assert.equal(parseSpindleTelemetryLine(validLine.replace("|RDY:1", "|RDY:true")), null);
  assert.equal(parseSpindleTelemetryLine(validLine.replace("|MODE:speed", "|MODE:torque")), null);
  assert.equal(parseSpindleTelemetryLine(validLine.replace("|PATH:digital", "|PATH:magic")), null);
  assert.equal(parseSpindleTelemetryLine(validLine.replace("|CMD:7200", "|CMD:7200|CMD:7100")), null);
  assert.equal(parseSpindleTelemetryLine(validLine.replace("|CMD:7200", "|NOPE:1")), null);
  assert.equal(parseSpindleTelemetryLine(validLine.replace("|PROFILE:-", "|PROFILE:not-a-hash")), null);
  assert.equal(parseSpindleTelemetryLine("MR1SP|V:1"), null);
});

test("detects reserved spindle frames without accepting them", () => {
  assert.equal(isSpindleTelemetryLine(validLine), true);
  assert.equal(isSpindleTelemetryLine("[MR1SP|bad]"), true);
  assert.equal(isSpindleTelemetryLine("<Idle|MPos:0,0,0>"), false);
});
