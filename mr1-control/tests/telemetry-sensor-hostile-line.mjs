import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test, { mock } from "node:test";

// In-memory ESP32 sensor port; no device is opened. feed() emits "data" the
// way SerialPort does, so a throw from the parser escapes the listener.
const fakePorts = [];
class FakeSensorPort extends EventEmitter {
  constructor(options) {
    super();
    this.path = options.path;
    this.isOpen = false;
    fakePorts.push(this);
  }
  open(callback) { setTimeout(() => { this.isOpen = true; callback(null); }, 1); }
  set(_signals, callback) { callback(null); }
  drain(callback) { setTimeout(() => callback(null), 0); }
  close(callback) { this.isOpen = false; setTimeout(() => { this.emit("close"); callback?.(null); }, 1); }
  write(_bytes, callback) { setTimeout(() => callback?.(null), 0); return true; }
  feed(text) { this.emit("data", Buffer.from(text, "utf8")); }
}
mock.module("serialport", { namedExports: { SerialPort: FakeSensorPort } });
const { createTelemetryService } = await import("../service/mr1-telemetry-service.mjs");

test("a sensor line with unconvertible JSON fields is dropped and the service keeps running", async () => {
  const service = createTelemetryService({ mode: "simulate", sensorPort: "COM9", httpPort: 0, fissionRoot: false, journalDirectory: false });
  const address = await service.start();
  const sensor = fakePorts.find((port) => port.path === "COM9");
  try {
    assert.doesNotThrow(() => sensor.feed('{"type":"chatter","score":3,"state":{"toString":1}}\n'));
    assert.doesNotThrow(() => sensor.feed('{"type":"chatter","score":4,"state":"ok","acc":{"x":{"toString":0,"valueOf":0},"y":0,"z":0}}\n'));
    sensor.feed('{"type":"chatter","score":5,"state":"warning"}\n');
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal((await fetch(`${address.url}/health`)).status, 200);
    const latest = service.snapshot().latestSensor;
    assert.equal(latest?.state, "warning");
    assert.equal(latest?.score, 5);
  } finally {
    await service.stop();
  }
});
