import assert from "node:assert/strict";
import test from "node:test";
import {
  sensorSourceIsSimulation,
  sensorSpindleRpm,
} from "../src/sensor-source.js";

test("identifies generated sensor telemetry independently of controller mode", () => {
  assert.equal(sensorSourceIsSimulation({ mode: "simulate", sensorSource: "simulation" }, {}), true);
  assert.equal(sensorSourceIsSimulation({ mode: "simulate", sensorSource: "COM5" }, { firmwareVersion: "7.5-mr1" }), false);
  assert.equal(sensorSourceIsSimulation({ mode: "serial", sensorSource: "COM5" }, { firmwareVersion: "7.6-mr1-sim" }), true);
});

test("refuses to correlate a physical sensor with simulated spindle speed", () => {
  assert.equal(sensorSpindleRpm({
    bridge: { mode: "simulate", sensorSource: "COM5" },
    sensor: { firmwareVersion: "7.5-mr1" },
    spindle: { speeds: { encoderSpindleRpm: 7200 } },
  }), null);
});

test("uses generated RPM with generated sensor data", () => {
  assert.equal(sensorSpindleRpm({
    bridge: { mode: "simulate", sensorSource: "simulation" },
    sensor: { firmwareVersion: "7.6-mr1-sim" },
    spindle: { speeds: { encoderSpindleRpm: 7198 } },
  }), 7198);
});

test("uses absolute live encoder RPM before fallback values", () => {
  assert.equal(sensorSpindleRpm({
    bridge: { mode: "serial", sensorSource: "COM5" },
    sensor: { firmwareVersion: "7.6-mr1" },
    spindle: { speeds: { encoderSpindleRpm: -7102, calculatedSpindleRpm: 7095 } },
    telemetry: { motion: { spindleActual: 7088, spindleCommand: 7200 } },
  }), 7102);
});
