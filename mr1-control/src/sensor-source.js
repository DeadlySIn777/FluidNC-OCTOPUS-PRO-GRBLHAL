export function sensorSourceIsSimulation(bridge, sensor) {
  return bridge?.sensorSource === "simulation"
    || String(sensor?.firmwareVersion ?? "").endsWith("-sim");
}

export function sensorSpindleRpm({ bridge, sensor, spindle, telemetry } = {}) {
  if (bridge?.mode === "simulate" && !sensorSourceIsSimulation(bridge, sensor)) return null;
  const candidates = [
    spindle?.speeds?.encoderSpindleRpm,
    spindle?.speeds?.calculatedSpindleRpm,
    telemetry?.motion?.spindleActual,
    telemetry?.motion?.spindleCommand,
  ];
  const value = candidates.find((candidate) => Number.isFinite(candidate) && Math.abs(candidate) >= 1);
  return Number.isFinite(value) ? Math.abs(value) : null;
}
