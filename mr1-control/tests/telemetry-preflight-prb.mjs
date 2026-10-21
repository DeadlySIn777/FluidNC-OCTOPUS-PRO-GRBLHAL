import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { mock } from "node:test";

const profile = JSON.parse(await readFile(new URL("../../grblHAL-STM32F4/mr1/expected-settings.json", import.meta.url), "utf8"));
const RETAINED_PRB = "[PRB:-120.000,-80.000,-35.250:1]";
const LIVE_PRB = "[PRB:-100.000,-90.000,-20.000:1]";

// In-memory controller that answers the read-only preflight; no port is opened.
class FakeControllerPort extends EventEmitter {
  constructor() {
    super();
    this.isOpen = false;
    this.writes = [];
    FakeControllerPort.last = this;
  }
  open(callback) { setTimeout(() => { this.isOpen = true; callback(null); }, 1); }
  set(_signals, callback) { callback(null); }
  drain(callback) { setTimeout(() => callback(null), 1); }
  close(callback) { this.isOpen = false; setTimeout(() => { this.emit("close"); callback?.(null); }, 1); }
  write(bytes, callback) {
    const text = Buffer.from(bytes).toString("latin1");
    this.writes.push(text);
    setTimeout(() => callback?.(null), 0);
    const reply = {
      "?": "<Idle|MPos:0.000,0.000,0.000|Bf:100,1000|FS:0,0|WCO:0.000,0.000,0.000>\r\n",
      "$I+\n": `[VER:1.1f.20250101:]\r\n[OPT:VNMSL,35,1024,3,0]\r\n[BOARD:${profile.boardIdentityContains}]\r\nok\r\n`,
      "$$\n": `${profile.settings.map((setting) => `$${setting.id}=${setting.expected}`).join("\r\n")}\r\nok\r\n`,
      "$G\n": "[GC:G0 G54 G17 G21 G90 G94 M5 M9 T0 F0 S0]\r\nok\r\n",
      // grblHAL report_ngc_parameters() ends with the probe result it retains from an earlier G38.
      "$#\n": `[G54:0.000,0.000,0.000]\r\n[G92:0.000,0.000,0.000]\r\n[TLO:0.000]\r\n${RETAINED_PRB}\r\nok\r\n`,
      "$N\n": "$N0=\r\n$N1=\r\nok\r\n",
    }[text];
    if (reply) setTimeout(() => this.emit("data", Buffer.from(reply)), 2);
    return true;
  }
}
mock.module("serialport", { namedExports: { SerialPort: FakeControllerPort } });
const { createTelemetryService } = await import("../service/mr1-telemetry-service.mjs");

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const controllerEvents = (text) => text.split("\n\n")
  .filter((frame) => frame.startsWith("event: controller"))
  .map((frame) => JSON.parse(frame.split("\n").find((line) => line.startsWith("data: ")).slice(6)));

test("the retained [PRB] in the read-only $# preflight is not published or journaled as a probe contact", async () => {
  const journalDirectory = await mkdtemp(join(tmpdir(), "mr1-preflight-prb-"));
  const service = createTelemetryService({
    mode: "serial",
    serialPort: "COM7",
    httpPort: 0,
    fissionRoot: false,
    journalDirectory,
  });
  let reader;
  let pump;
  let text = "";
  try {
    const started = service.start();
    while (!service.address()) await delay(5);
    // The UI's EventSource reconnects before the preflight has finished.
    const response = await fetch(`${service.address().url}/events`, { headers: { Origin: "http://127.0.0.1:5173" } });
    assert.equal(response.status, 200);
    reader = response.body.getReader();
    const decoder = new TextDecoder();
    pump = (async () => {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        text += decoder.decode(value, { stream: true });
      }
    })().catch(() => {});
    await started;
    assert.equal(service.snapshot().controllerPreflightReport.status, "PASS");
    assert.ok(FakeControllerPort.last.writes.includes("$#\n"));
    assert.equal(FakeControllerPort.last.writes.some((bytes) => /G38/.test(bytes)), false);

    // A [PRB] outside the read-only capture is still a real contact.
    FakeControllerPort.last.emit("data", Buffer.from(`${LIVE_PRB}\r\n`));
    for (let waited = 0; waited < 2000 && !text.includes(JSON.stringify(LIVE_PRB)); waited += 10) await delay(10);
    await delay(20);
  } finally {
    await reader?.cancel().catch(() => {});
    await pump;
    await service.stop();
  }
  try {
    const events = controllerEvents(text);
    assert.deepEqual(events.filter((event) => event.type === "probe").map((event) => event.raw), [LIVE_PRB],
      "Only the unsolicited contact may reach the UI as a probe.");
    assert.deepEqual(events.filter((event) => event.raw === RETAINED_PRB).map((event) => event.type), ["probe-parameter"]);

    const records = (await readFile(join(journalDirectory, "mr1-events.jsonl"), "utf8"))
      .split("\n").filter(Boolean).map((line) => JSON.parse(line));
    const prbKinds = (raw) => records.filter((record) => record.payload?.raw === raw).map((record) => record.kind);
    assert.deepEqual(prbKinds(RETAINED_PRB), ["controller.probe-parameter"],
      "The journal must keep the parameter line but not record a probe that never ran.");
    assert.deepEqual(prbKinds(LIVE_PRB), ["controller.probe"]);
  } finally {
    await rm(journalDirectory, { recursive: true, force: true });
  }
});
