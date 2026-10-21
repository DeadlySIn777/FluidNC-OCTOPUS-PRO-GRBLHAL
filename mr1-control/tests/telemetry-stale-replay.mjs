import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import test, { mock } from "node:test";

const profile = JSON.parse(await readFile(new URL("../../grblHAL-STM32F4/mr1/expected-settings.json", import.meta.url), "utf8"));

// In-memory controller for the read-only preflight and ? polling; no port is opened.
// While `answering` is false the port stays open but ? gets no reply (firmware hang, USB still enumerated).
let answering = true;
class FakeControllerPort extends EventEmitter {
  constructor() {
    super();
    this.isOpen = false;
  }
  open(callback) { setTimeout(() => { this.isOpen = true; callback(null); }, 1); }
  set(_signals, callback) { callback(null); }
  drain(callback) { setTimeout(() => callback(null), 1); }
  close(callback) { this.isOpen = false; setTimeout(() => { this.emit("close"); callback?.(null); }, 1); }
  write(bytes, callback) {
    const text = Buffer.from(bytes).toString("latin1");
    setTimeout(() => callback?.(null), 0);
    if (text === "?" && !answering) return true;
    const reply = {
      "?": "<Idle|MPos:0.000,0.000,0.000|Bf:100,1000|FS:0,0|WCO:0.000,0.000,0.000>\r\n",
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

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Resolves once the bridge has published a status newer than `afterSequence`.
const statusAfter = async (service, afterSequence) => {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    const sequence = service.snapshot().latestStatus?.sequence ?? 0;
    if (sequence > afterSequence) return sequence;
    await delay(10);
  }
  return assert.fail("The bridge published no status.");
};

// What a freshly connected EventSource is handed in its first `ms` milliseconds.
const connectEvents = async (url, ms) => {
  const response = await fetch(`${url}/events`, { headers: { Origin: "http://127.0.0.1:5173" } });
  assert.equal(response.status, 200);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  const timer = setTimeout(() => reader.cancel().catch(() => {}), ms);
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
    }
  } catch {
    // Cancelled at the end of the window.
  } finally {
    clearTimeout(timer);
  }
  return text.split("\n\n")
    .map((frame) => ({
      event: frame.split("\n").find((line) => line.startsWith("event: "))?.slice(7),
      data: frame.split("\n").find((line) => line.startsWith("data: "))?.slice(6),
    }))
    .filter((frame) => frame.event && frame.data)
    .map((frame) => ({ event: frame.event, data: JSON.parse(frame.data) }));
};

test("a new /events client is not handed a status frame older than the UI stale window", { timeout: 20000 }, async () => {
  answering = true;
  const service = createTelemetryService({ mode: "serial", serialPort: "COM7", httpPort: 0, fissionRoot: false });
  const { url } = await service.start();
  try {
    // ? is silenced before each connect, so a telemetry frame there can only be the replay.
    await statusAfter(service, 0);
    answering = false;
    await delay(50);
    const fresh = await connectEvents(url, 150);
    assert.ok(fresh.some((frame) => frame.event === "telemetry"), "A status inside the stale window is still replayed.");

    const staleAfterMs = Math.max(1200, service.snapshot().bridge.pollMs * 5);
    await delay(staleAfterMs + 600);
    const stale = await connectEvents(url, 150);
    const bridge = stale.find((frame) => frame.event === "bridge")?.data;
    assert.equal(bridge?.connected, true, "The port is still open, so only the status age can reveal the hang.");
    assert.deepEqual(stale.filter((frame) => frame.event === "telemetry").map((frame) => ({
      state: frame.data.state?.name,
      ageMs: Date.now() - Date.parse(frame.data.bridgePublishedAt),
    })), [], "A reloaded UI must not be handed the frozen status as live.");

    answering = true;
    await statusAfter(service, fresh.find((frame) => frame.event === "telemetry").data.sequence);
    answering = false;
    await delay(50);
    const resumed = await connectEvents(url, 150);
    assert.ok(resumed.some((frame) => frame.event === "telemetry"), "Replay resumes once the controller answers again.");
  } finally {
    await service.stop();
  }
});
