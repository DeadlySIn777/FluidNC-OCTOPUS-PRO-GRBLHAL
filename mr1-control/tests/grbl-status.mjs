import assert from "node:assert/strict";
import test from "node:test";
import { parseControllerLine, parseGrblStatus } from "../src/telemetry/grbl-status.js";

test("normalizes the full MR-1 grblHAL realtime report", () => {
  const status = parseGrblStatus(
    "<Run:2|MPos:100.000,50.000,-10.000|Bf:34,120|Ln:42|DTG:1.000,2.000,3.000|FS:650,7200,7150|Pn:YP|WCO:10.000,20.000,30.000|Ov:90,50,100|A:SF|WCS:G54|T:3|P:1|H:1,7|TLR:1|AR:250|MPG:0>",
    null,
    { receivedAt: "2026-08-22T12:00:00.000Z" },
  );

  assert.equal(status.state.name, "Run");
  assert.equal(status.state.substate, 2);
  assert.deepEqual(status.position.machine, { x: 100, y: 50, z: -10 });
  assert.deepEqual(status.position.work, { x: 90, y: 30, z: -40 });
  assert.deepEqual(status.motion.distanceToGo, { x: 1, y: 2, z: 3 });
  assert.equal(status.motion.feed, 650);
  assert.equal(status.motion.spindleCommand, 7200);
  assert.equal(status.motion.spindleActual, 7150);
  assert.deepEqual(status.buffer, { plannerAvailable: 34, rxAvailable: 120 });
  assert.equal(status.line, 42);
  assert.equal(status.pins.limits.y, true);
  assert.equal(status.pins.controls.probeTriggered, true);
  assert.deepEqual(status.overrides, { feed: 90, rapid: 50, spindle: 100 });
  assert.equal(status.accessories.spindle, "cw");
  assert.equal(status.accessories.flood, true);
  assert.equal(status.workCoordinateSystem, "G54");
  assert.equal(status.tool, 3);
  assert.equal(status.activeProbe, 1);
  assert.deepEqual(status.homing, { complete: true, mask: 7 });
  assert.equal(status.toolLengthReferenceSet, true);
  assert.equal(status.autoReportInterval, 250);
  assert.equal(status.mpgMode, false);
});

test("derives MPos from WPos and preserves intermittent values", () => {
  const previous = parseGrblStatus(
    "<Idle|MPos:10.000,20.000,30.000|WCO:1.000,2.000,3.000|Ov:95,100,90|A:CM>",
  );
  const status = parseGrblStatus("<Hold:0|WPos:20.000,30.000,40.000|F:125|Pn:E>", previous);

  assert.deepEqual(status.position.wco, { x: 1, y: 2, z: 3 });
  assert.deepEqual(status.position.machine, { x: 21, y: 32, z: 43 });
  assert.deepEqual(status.overrides, { feed: 95, rapid: 100, spindle: 90 });
  assert.equal(status.accessories.spindle, "ccw");
  assert.equal(status.accessories.mist, true);
  assert.equal(status.pins.controls.eStop, true);
});

test("maps every MR-1 control signal letter", () => {
  const status = parseGrblStatus("<Alarm:3|MPos:0,0,0|Pn:RHSDLTEOFMQP>");
  const controls = status.pins.controls;

  for (const key of [
    "reset", "feedHold", "cycleStart", "safetyDoor", "blockDelete",
    "optionalStopDisabled", "eStop", "probeDisconnected", "motorFault",
    "motorWarning", "singleBlock", "probeTriggered",
  ]) {
    assert.equal(controls[key], true, `${key} was not mapped`);
  }
  assert.equal(status.state.name, "Alarm");
  assert.equal(status.state.substate, 3);
});

test("parses controller events without treating them as status", () => {
  assert.deepEqual(
    parseControllerLine("[PRB:1.000,2.000,-3.000:1]"),
    {
      type: "probe",
      position: { x: 1, y: 2, z: -3 },
      success: true,
      raw: "[PRB:1.000,2.000,-3.000:1]",
    },
  );
  assert.equal(parseControllerLine("ALARM:10").type, "alarm");
  assert.equal(parseControllerLine("error:9").type, "error");
  assert.equal(parseControllerLine("[GC:G0 G54 G17 G21 G90]").type, "parser-state");
  assert.equal(parseControllerLine("GrblHAL 1.1f").type, "startup");
  assert.equal(parseControllerLine("ok").type, "ok");
});

test("rejects incomplete status frames", () => {
  assert.equal(parseGrblStatus("Run|MPos:0,0,0"), null);
  assert.equal(parseGrblStatus("<Run|MPos:0,0,0"), null);
  assert.equal(parseGrblStatus(""), null);
});

test("does not coerce blank scalar status fields to zero", () => {
  const status = parseGrblStatus("<Idle|MPos:0,0,0|Ln:|T:|P:>");
  assert.equal(status.line, null);
  assert.equal(status.tool, null);
  assert.equal(status.activeProbe, null);
});
