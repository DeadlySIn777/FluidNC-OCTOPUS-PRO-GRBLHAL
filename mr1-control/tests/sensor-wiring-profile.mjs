import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_SENSOR_WIRING_PROFILE,
  SENSOR_WIRING_STORAGE_KEY,
  evaluateSensorWiringProfile,
  loadSensorWiringProfile,
  normalizeSensorWiringProfile,
  saveSensorWiringProfile,
  sensorDestination,
} from "../src/sensor-wiring-profile.js";

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    values,
  };
}

test("default HW-399 profile matches the compiled probe pins", () => {
  const result = evaluateSensorWiringProfile(DEFAULT_SENSOR_WIRING_PROFILE);
  assert.equal(result.valid, true);
  assert.equal(result.firmwareMatch, true);
  assert.deepEqual(sensorDestination(result.profile.touch), {
    connector: "T1",
    gpio: "PF5",
    selection: "Q0",
  });
  assert.equal(result.profile.touch.colors.signal, "white");
  assert.equal(result.profile.setter.colors.shield, "gray");
});

test("aftermarket profile is normalized, saved, and loaded", () => {
  const storage = memoryStorage();
  const saved = saveSensorWiringProfile({
    ...DEFAULT_SENSOR_WIRING_PROFILE,
    name: "  aftermarket   setter  ",
    interface: {
      ...DEFAULT_SENSOR_WIRING_PROFILE.interface,
      type: "custom-isolated",
      label: "MY OPTO",
      fieldVoltage: 12,
    },
    setter: {
      ...DEFAULT_SENSOR_WIRING_PROFILE.setter,
      sensorLabel: "new setter",
      colors: { power: "orange", signal: "blue", return: "black", shield: "bare" },
    },
  }, storage);
  assert.equal(saved.name, "aftermarket setter");
  assert.equal(saved.setter.sensorLabel, "new setter");
  assert.equal(storage.values.has(SENSOR_WIRING_STORAGE_KEY), true);
  assert.deepEqual(loadSensorWiringProfile(storage), saved);
});

test("a changed GPIO is saved as a plan but cannot claim a firmware match", () => {
  const result = evaluateSensorWiringProfile({
    ...DEFAULT_SENSOR_WIRING_PROFILE,
    touch: { ...DEFAULT_SENSOR_WIRING_PROFILE.touch, destination: "pc5" },
  });
  assert.equal(result.valid, true);
  assert.equal(result.firmwareMatch, false);
  assert.match(result.warnings.join(" "), /compiled PF5\/PB7/);
});

test("HW-399 profile rejects a shared field supply and out-of-range input voltage", () => {
  const result = evaluateSensorWiringProfile({
    ...DEFAULT_SENSOR_WIRING_PROFILE,
    interface: {
      ...DEFAULT_SENSOR_WIRING_PROFILE.interface,
      isolatedSupply: false,
      fieldVoltage: 12,
    },
  });
  assert.equal(result.valid, false);
  assert.match(result.errors.join(" "), /3\.3 and 5\.5 V/);
  assert.match(result.errors.join(" "), /isolated field supply/);
});

test("duplicate interface and controller channels are rejected", () => {
  const result = evaluateSensorWiringProfile({
    ...DEFAULT_SENSOR_WIRING_PROFILE,
    setter: {
      ...DEFAULT_SENSOR_WIRING_PROFILE.setter,
      inputChannel: "IN1",
      outputChannel: "OUT1",
      destination: "pf5",
    },
  });
  assert.equal(result.valid, false);
  assert.match(result.errors.join(" "), /IN1 is assigned twice/);
  assert.match(result.errors.join(" "), /OUT1 is assigned twice/);
  assert.match(result.errors.join(" "), /T1:PF5 is assigned twice/);
});

test("custom destinations require explicit connector and GPIO", () => {
  const invalid = evaluateSensorWiringProfile({
    ...DEFAULT_SENSOR_WIRING_PROFILE,
    touch: { ...DEFAULT_SENSOR_WIRING_PROFILE.touch, destination: "custom" },
  });
  assert.equal(invalid.valid, false);

  const normalized = normalizeSensorWiringProfile({
    ...DEFAULT_SENSOR_WIRING_PROFILE,
    touch: {
      ...DEFAULT_SENSOR_WIRING_PROFILE.touch,
      destination: "custom",
      customConnector: " aux 1 ",
      customGpio: " pe9 ",
    },
  });
  assert.deepEqual(sensorDestination(normalized.touch), {
    connector: "AUX 1",
    gpio: "PE9",
    selection: "CUSTOM",
  });
});

test("PC5 profile enforces its one-channel physical limit", () => {
  const result = evaluateSensorWiringProfile({
    ...DEFAULT_SENSOR_WIRING_PROFILE,
    interface: { ...DEFAULT_SENSOR_WIRING_PROFILE.interface, type: "pc5" },
  });
  assert.equal(result.valid, false);
  assert.equal(result.firmwareMatch, false);
  assert.match(result.errors.join(" "), /only one sensor channel/);
});
