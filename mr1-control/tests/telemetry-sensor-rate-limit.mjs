import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test, { mock } from "node:test";

// In-memory ESP32 sensor port; no device is opened. The drain callback is
// delayed a few ms so concurrent requests overlap the awaited write.
const fakePorts = [];
class FakeSensorPort extends EventEmitter {
  constructor(options) {
    super();
    this.path = options.path;
    this.isOpen = false;
    this.writes = [];
    fakePorts.push(this);
  }
  open(callback) { setTimeout(() => { this.isOpen = true; callback(null); }, 1); }
  set(_signals, callback) { callback(null); }
  drain(callback) { setTimeout(() => callback(null), 5); }
  close(callback) { this.isOpen = false; setTimeout(() => { this.emit("close"); callback?.(null); }, 1); }
  write(bytes, callback) {
    this.writes.push(Buffer.from(bytes).toString("latin1"));
    setTimeout(() => callback?.(null), 0);
    return true;
  }
  feed(text) { this.emit("data", Buffer.from(text, "utf8")); }
}
mock.module("serialport", { namedExports: { SerialPort: FakeSensorPort } });
const { createTelemetryService } = await import("../service/mr1-telemetry-service.mjs");

test("sensor calibration limiter admits one command per 750 ms under concurrency", async () => {
  const service = createTelemetryService({ mode: "simulate", sensorPort: "COM9", httpPort: 0, fissionRoot: false });
  const address = await service.start();
  const sensor = fakePorts.find((port) => port.path === "COM9");
  sensor.feed(`${JSON.stringify({ type: "chatter", score: 5, state: "ok", cal_cmd: true, cal_clear: true })}\n`);
  await new Promise((resolve) => setTimeout(resolve, 30));
  const post = (action) => fetch(`${address.url}/sensor/calibration`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "http://127.0.0.1:5173" },
    body: JSON.stringify({ action }),
  });
  try {
    // A double-click or a second tab: start, clear, start in one burst.
    const statuses = (await Promise.all([post("start"), post("clear"), post("start")])).map((response) => response.status);
    assert.equal(statuses.filter((status) => status === 202).length, 1, JSON.stringify(statuses));
    assert.equal(statuses.filter((status) => status === 429).length, 2, JSON.stringify(statuses));
    assert.equal(sensor.writes.length, 1, JSON.stringify(sensor.writes));
  } finally {
    await service.stop();
  }
});
