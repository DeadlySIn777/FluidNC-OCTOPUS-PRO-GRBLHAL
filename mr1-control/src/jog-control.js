const AXES = Object.freeze(["x", "y", "z"]);

function finiteAxisVector(vector) {
  return AXES.every((axis) => Number.isFinite(vector?.[axis]));
}

export function calculateLimitDistances(machinePosition, machineEnvelope) {
  if (!finiteAxisVector(machinePosition) || !machineEnvelope) return null;

  const distances = {};
  for (const axis of AXES) {
    const bounds = machineEnvelope[axis];
    if (!Number.isFinite(bounds?.min) || !Number.isFinite(bounds?.max)) return null;
    distances[axis] = Object.freeze({
      negative: machinePosition[axis] - bounds.min,
      positive: bounds.max - machinePosition[axis],
      inside: machinePosition[axis] >= bounds.min && machinePosition[axis] <= bounds.max,
    });
  }
  return Object.freeze(distances);
}

export function continuousJogDistance(speedMmPerMinute, intervalMs = 80) {
  const speed = Number(speedMmPerMinute);
  const interval = Number(intervalMs);
  if (!Number.isFinite(speed) || speed <= 0 || !Number.isFinite(interval) || interval <= 0) return 0;
  return speed / 60 * interval / 1000;
}

export function movePreviewPosition(position, axis, direction, distance) {
  if (!finiteAxisVector(position) || !AXES.includes(axis)) return null;
  const sign = Number(direction);
  const magnitude = Number(distance);
  if ((sign !== -1 && sign !== 1) || !Number.isFinite(magnitude) || magnitude <= 0) return null;
  return Object.freeze({
    ...position,
    [axis]: position[axis] + sign * magnitude,
  });
}
