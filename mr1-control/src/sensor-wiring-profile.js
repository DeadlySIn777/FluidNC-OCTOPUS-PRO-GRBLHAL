export const SENSOR_WIRING_STORAGE_KEY = "mr1-control.sensor-wiring-profile.v1";

export const SENSOR_DESTINATIONS = Object.freeze({
  pf5: Object.freeze({ connector: "T1", gpio: "PF5", selection: "Q0" }),
  pb7: Object.freeze({ connector: "PB7 TOOL SETTER", gpio: "PB7", selection: "Q1" }),
  pc5: Object.freeze({ connector: "PROBE", gpio: "PC5", selection: "CUSTOM" }),
  custom: Object.freeze({ connector: "CUSTOM", gpio: "CUSTOM", selection: "CUSTOM" }),
});

export const WIRE_COLORS = Object.freeze([
  "red",
  "black",
  "white",
  "gray",
  "yellow",
  "blue",
  "orange",
  "green",
  "brown",
  "violet",
  "bare",
]);

const INTERFACE_TYPES = new Set(["hw399", "custom-isolated", "direct-dry", "pc5"]);
const TRIGGER_TYPES = new Set([
  "active-low-open-collector",
  "active-high-push-pull",
  "dry-contact-no",
  "dry-contact-nc",
]);

const DEFAULT_COLORS = Object.freeze({
  power: "red",
  signal: "white",
  return: "black",
  shield: "gray",
});

export const DEFAULT_SENSOR_WIRING_PROFILE = Object.freeze({
  version: 1,
  name: "MR-1 STOCK / HW-399",
  interface: Object.freeze({
    type: "hw399",
    label: "HW-399",
    fieldVoltage: 5,
    isolatedSupply: true,
    trigger: "active-low-open-collector",
    pullupOhms: 4700,
  }),
  touch: Object.freeze({
    enabled: true,
    sensorLabel: "STOCK TOUCH PROBE",
    inputChannel: "IN1",
    outputChannel: "OUT1",
    destination: "pf5",
    customConnector: "",
    customGpio: "",
    colors: DEFAULT_COLORS,
  }),
  setter: Object.freeze({
    enabled: true,
    sensorLabel: "STOCK TOOL SETTER",
    inputChannel: "IN2",
    outputChannel: "OUT2",
    destination: "pb7",
    customConnector: "",
    customGpio: "",
    colors: DEFAULT_COLORS,
  }),
});

function finiteOr(value, fallback) {
  if (value === null || value === undefined || value === "") return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function booleanOr(value, fallback) {
  return typeof value === "boolean" ? value : fallback;
}

function boundedText(value, fallback, maximum = 36) {
  const text = String(value ?? "").trim().replace(/\s+/g, " ");
  return (text || fallback).slice(0, maximum);
}

function channelText(value, fallback) {
  return boundedText(value, fallback, 16).toUpperCase();
}

function normalizeColor(value, fallback) {
  const color = String(value ?? "").trim().toLowerCase();
  return WIRE_COLORS.includes(color) ? color : fallback;
}

function normalizeSensor(candidate, fallback) {
  const colors = candidate?.colors ?? {};
  const destination = Object.hasOwn(SENSOR_DESTINATIONS, candidate?.destination)
    ? candidate.destination
    : fallback.destination;
  return {
    enabled: booleanOr(candidate?.enabled, fallback.enabled),
    sensorLabel: boundedText(candidate?.sensorLabel, fallback.sensorLabel),
    inputChannel: channelText(candidate?.inputChannel, fallback.inputChannel),
    outputChannel: channelText(candidate?.outputChannel, fallback.outputChannel),
    destination,
    customConnector: boundedText(candidate?.customConnector, "", 24).toUpperCase(),
    customGpio: boundedText(candidate?.customGpio, "", 16).toUpperCase(),
    colors: {
      power: normalizeColor(colors.power, fallback.colors.power),
      signal: normalizeColor(colors.signal, fallback.colors.signal),
      return: normalizeColor(colors.return, fallback.colors.return),
      shield: normalizeColor(colors.shield, fallback.colors.shield),
    },
  };
}

export function normalizeSensorWiringProfile(candidate = {}) {
  const interfaceCandidate = candidate.interface ?? {};
  const type = INTERFACE_TYPES.has(interfaceCandidate.type)
    ? interfaceCandidate.type
    : DEFAULT_SENSOR_WIRING_PROFILE.interface.type;
  const trigger = TRIGGER_TYPES.has(interfaceCandidate.trigger)
    ? interfaceCandidate.trigger
    : DEFAULT_SENSOR_WIRING_PROFILE.interface.trigger;
  return {
    version: 1,
    name: boundedText(candidate.name, DEFAULT_SENSOR_WIRING_PROFILE.name, 48),
    interface: {
      type,
      label: boundedText(interfaceCandidate.label, DEFAULT_SENSOR_WIRING_PROFILE.interface.label, 32),
      fieldVoltage: finiteOr(interfaceCandidate.fieldVoltage, DEFAULT_SENSOR_WIRING_PROFILE.interface.fieldVoltage),
      isolatedSupply: booleanOr(interfaceCandidate.isolatedSupply, DEFAULT_SENSOR_WIRING_PROFILE.interface.isolatedSupply),
      trigger,
      pullupOhms: Math.round(finiteOr(interfaceCandidate.pullupOhms, DEFAULT_SENSOR_WIRING_PROFILE.interface.pullupOhms)),
    },
    touch: normalizeSensor(candidate.touch, DEFAULT_SENSOR_WIRING_PROFILE.touch),
    setter: normalizeSensor(candidate.setter, DEFAULT_SENSOR_WIRING_PROFILE.setter),
  };
}

export function sensorDestination(sensor) {
  const known = SENSOR_DESTINATIONS[sensor.destination] ?? SENSOR_DESTINATIONS.custom;
  if (sensor.destination !== "custom") return known;
  return {
    connector: sensor.customConnector || "CUSTOM",
    gpio: sensor.customGpio || "CUSTOM",
    selection: "CUSTOM",
  };
}

function triggerIsFirmwareCompatible(trigger) {
  return trigger === "active-low-open-collector" || trigger === "dry-contact-no";
}

export function evaluateSensorWiringProfile(profileCandidate) {
  const profile = normalizeSensorWiringProfile(profileCandidate);
  const errors = [];
  const warnings = [];
  const enabledSensors = [profile.touch, profile.setter].filter((sensor) => sensor.enabled);

  if (enabledSensors.length === 0) errors.push("Enable at least one sensor channel.");
  if (profile.interface.fieldVoltage < 0 || profile.interface.fieldVoltage > 24) {
    errors.push("Field voltage must be between 0 and 24 V.");
  }
  if (profile.interface.pullupOhms < 220 || profile.interface.pullupOhms > 100000) {
    errors.push("Field pull-up must be between 220 ohm and 100 kohm.");
  }
  if (profile.interface.type === "hw399") {
    if (profile.interface.fieldVoltage < 3.3 || profile.interface.fieldVoltage > 5.5) {
      errors.push("HW-399 input voltage must stay between 3.3 and 5.5 V.");
    }
    if (!profile.interface.isolatedSupply) {
      errors.push("HW-399 needs a genuinely isolated field supply for the selected MR-1 architecture.");
    }
  }
  if (profile.interface.type === "direct-dry") {
    if (!profile.interface.trigger.startsWith("dry-contact-")) {
      errors.push("A direct dry-contact profile must use NO or NC dry-contact polarity.");
    }
    if (profile.interface.fieldVoltage !== 3.3) {
      errors.push("Direct Octopus dry-contact wiring must use the 3.3 V logic domain only.");
    }
    if (profile.interface.isolatedSupply) {
      warnings.push("A passive dry contact does not consume the isolated field supply.");
    }
  }
  if (profile.interface.type === "pc5" && enabledSensors.length > 1) {
    errors.push("The onboard PC5 optocoupler provides only one sensor channel.");
  }

  const usedInputs = new Set();
  const usedOutputs = new Set();
  const usedDestinations = new Set();
  for (const sensor of enabledSensors) {
    if (!sensor.sensorLabel) errors.push("Every enabled sensor needs a label.");
    if (!sensor.inputChannel) errors.push(`${sensor.sensorLabel || "Sensor"} needs an interface input channel.`);
    if (!sensor.outputChannel) errors.push(`${sensor.sensorLabel || "Sensor"} needs an interface output channel.`);
    if (usedInputs.has(sensor.inputChannel)) errors.push(`Interface input ${sensor.inputChannel} is assigned twice.`);
    if (usedOutputs.has(sensor.outputChannel)) errors.push(`Interface output ${sensor.outputChannel} is assigned twice.`);
    usedInputs.add(sensor.inputChannel);
    usedOutputs.add(sensor.outputChannel);
    const destination = sensorDestination(sensor);
    const destinationKey = `${destination.connector}:${destination.gpio}`;
    if (usedDestinations.has(destinationKey)) errors.push(`Controller destination ${destinationKey} is assigned twice.`);
    usedDestinations.add(destinationKey);
    if (sensor.destination === "custom" && (!sensor.customConnector || !sensor.customGpio)) {
      errors.push(`${sensor.sensorLabel} needs both a custom connector and GPIO.`);
    }
  }

  const touchFirmwareMatch = !profile.touch.enabled || profile.touch.destination === "pf5";
  const setterFirmwareMatch = !profile.setter.enabled || profile.setter.destination === "pb7";
  const polarityFirmwareMatch = triggerIsFirmwareCompatible(profile.interface.trigger);
  const interfaceFirmwareMatch = profile.interface.type !== "pc5";
  const firmwareMatch = touchFirmwareMatch
    && setterFirmwareMatch
    && polarityFirmwareMatch
    && interfaceFirmwareMatch;
  if (!firmwareMatch) warnings.push("Saved wiring plan differs from the compiled PF5/PB7 active-low firmware profile.");
  if (profile.interface.type === "pc5") {
    warnings.push("PC5 is active-high through the onboard EL357C and is not enabled by the current firmware profile.");
  }
  if (profile.interface.type === "custom-isolated") {
    warnings.push("Custom interface voltage, polarity, current transfer, and output threshold require bench qualification.");
  }

  return {
    valid: errors.length === 0,
    firmwareMatch,
    errors,
    warnings,
    profile,
  };
}

export function loadSensorWiringProfile(storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem(SENSOR_WIRING_STORAGE_KEY);
    return normalizeSensorWiringProfile(raw ? JSON.parse(raw) : DEFAULT_SENSOR_WIRING_PROFILE);
  } catch {
    return normalizeSensorWiringProfile(DEFAULT_SENSOR_WIRING_PROFILE);
  }
}

export function saveSensorWiringProfile(profile, storage = globalThis.localStorage) {
  const evaluation = evaluateSensorWiringProfile(profile);
  if (!evaluation.valid) throw new Error(evaluation.errors.join(" "));
  storage?.setItem(SENSOR_WIRING_STORAGE_KEY, JSON.stringify(evaluation.profile));
  return evaluation.profile;
}
