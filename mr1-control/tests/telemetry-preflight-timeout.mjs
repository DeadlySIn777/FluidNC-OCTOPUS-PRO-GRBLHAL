import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import test, { mock } from "node:test";

const profile = JSON.parse(await readFile(new URL("../../grblHAL-STM32F4/mr1/expected-settings.json", import.meta.url), "utf8"));

// In-memory controller for the read-only preflight; no port is opened.
// `silent` decides which writes never get a reply (for example a USB stall).
let silent = () => false;
class FakeControllerPort extends EventEmitter {
  constructor() {
    super();
    this.isOpen = false;
    this.writes = [];
  }
  open(callback) { setTimeout(() => { this.isOpen = true; callback(null); }, 1); }
  set(_signals, callback) { callback(null); }
  drain(callback) { setTimeout(() => callback(null), 1); }
  close(callback) { this.isOpen = false; setTimeout(() => { this.emit("close"); callback?.(null); }, 1); }
  write(bytes, callback) {
    const text = Buffer.from(bytes).toString("latin1");
    this.writes.push(text);
    setTimeout(() => callback?.(null), 0);
    if (silent(text)) return true;
    const reply = {
      "?": "<Idle|MPos:0.000,0.000,0.000|FS:0,0|Pn:>\r\n",
      "$I+\n": `[VER:1.1f.20250101:]\r\n[OPT:VNMSL,35,1024,3,0]\r\n[BOARD:${profile.boardIdentityContains}]\r\nok\r\n`,
      "$$\n": `${profile.settings.map((setting) => `$${setting.id}=${setting.expected}`).join("\r\n")}\r\nok\r\n`,
      "$G\n": "[GC:G0 G54 G17 G21 G90 G94 M5 M9 T0 F0 S0]\r\nok\r\n",
      "$#\n": "[G54:0.000,0.000,0.000]\r\n[TLO:0.000]\r\nok\r\n",
      "$N\n": "$N0=\r\n$N1=\r\nok\r\n",
    }[text];
    if (reply) setTimeout(() => this.emit("data", Buffer.from(reply)), 2);
    return true;
  }
}
mock.module("serialport", { namedExports: { SerialPort: FakeControllerPort } });
const { createTelemetryService } = await import("../service/mr1-telemetry-service.mjs");

const runSerialPreflight = async () => {
  const service = createTelemetryService({ mode: "serial", serialPort: "COM7", httpPort: 0, fissionRoot: false });
  try {
    await service.start();
    return service.snapshot();
  } finally {
    await service.stop();
  }
};

test("serial preflight with every read-only query answered passes", async () => {
  silent = () => false;
  const { controllerPreflightReport: report } = await runSerialPreflight();
  assert.equal(report.status, "PASS", JSON.stringify(report.issues));
  assert.equal(report.preflightPassed, true);
});

test("serial preflight is blocked when $#, $N and the final ? never answer", { timeout: 20000 }, async () => {
  // The first ? still answers Idle with no inputs, so only the missing replies can block.
  let statusQueries = 0;
  silent = (text) => text === "$#\n" || text === "$N\n" || (text === "?" && ++statusQueries > 1);
  const { controllerPreflightReport: report, bridge } = await runSerialPreflight();
  assert.equal(report.status, "BLOCKED");
  assert.equal(report.preflightPassed, false);
  assert.equal(bridge.controllerPreflight.preflightPassed, false);
  assert.deepEqual(report.issues.filter((item) => item.code === "PREFLIGHT_TIMEOUT").map((item) => item.severity),
    ["blocker", "blocker", "blocker"]);
});
