import { coordinatedRapidFeed, MR1_CONFIG } from "./machine-config.js";

export { MR1_CONFIG } from "./machine-config.js";

function clonePoint(point) {
  return { x: point.x, y: point.y, z: point.z };
}

function roundedRectangle(width, height, radius, pointsPerCorner = 5) {
  const halfWidth = width / 2;
  const halfHeight = height / 2;
  const corners = [
    { cx: halfWidth - radius, cy: -halfHeight + radius, start: -Math.PI / 2 },
    { cx: halfWidth - radius, cy: halfHeight - radius, start: 0 },
    { cx: -halfWidth + radius, cy: halfHeight - radius, start: Math.PI / 2 },
    { cx: -halfWidth + radius, cy: -halfHeight + radius, start: Math.PI },
  ];

  const points = [];
  for (const corner of corners) {
    for (let index = 0; index <= pointsPerCorner; index += 1) {
      const angle = corner.start + (index / pointsPerCorner) * (Math.PI / 2);
      points.push({
        x: corner.cx + Math.cos(angle) * radius,
        y: corner.cy + Math.sin(angle) * radius,
      });
    }
  }
  points.push(points[0]);
  return points;
}

export function createDemoJob() {
  const segments = [];
  let cursor = { x: -125, y: -95, z: 20 };
  let sourceLine = 1;
  let coolant = "off";

  const move = (target, type, feed, operation) => {
    const to = { ...cursor, ...target };
    const dx = to.x - cursor.x;
    const dy = to.y - cursor.y;
    const dz = to.z - cursor.z;
    const distance = Math.hypot(dx, dy, dz);
    if (distance > 0.0001) {
      segments.push({
        from: clonePoint(cursor),
        to: clonePoint(to),
        type,
        feed: type === "rapid" ? coordinatedRapidFeed(cursor, to) : feed,
        operation,
        sourceLine,
        distance,
        coolant,
      });
      sourceLine += 1;
    }
    cursor = to;
  };

  move({ z: 14 }, "rapid", 0, "approach");
  coolant = "flood";
  move({ x: 86, y: -58 }, "rapid", 0, "approach");

  const depths = [-2, -4, -6];
  for (const depth of depths) {
    move({ z: 3 }, "rapid", 0, "retract");
    move({ x: 86, y: -58 }, "rapid", 0, "position");
    move({ z: depth }, "cut", 260, "plunge");

    for (let inset = 0; inset <= 64; inset += 8) {
      const width = 184 - inset * 2;
      const height = 128 - inset * 1.45;
      if (width < 34 || height < 26) break;

      const radius = Math.max(6, Math.min(16, width / 5, height / 5));
      const points = roundedRectangle(width, height, radius, 5);
      move({ x: points[0].x, y: points[0].y }, "cut", 720, "pocket");
      for (const point of points.slice(1)) {
        move({ x: point.x, y: point.y }, "cut", 720, "pocket");
      }
    }
  }

  move({ z: 14 }, "rapid", 0, "retract");

  const drillPoints = [
    { x: -76, y: -48 },
    { x: 76, y: -48 },
    { x: 76, y: 48 },
    { x: -76, y: 48 },
  ];
  for (const point of drillPoints) {
    move({ ...point, z: 8 }, "rapid", 0, "drill-position");
    move({ z: -8 }, "cut", 180, "drill");
    move({ z: 8 }, "rapid", 900, "drill-retract");
  }

  coolant = "off";
  move({ x: -125, y: -95, z: 20 }, "rapid", 0, "park");

  let elapsedSeconds = 0;
  for (const segment of segments) {
    const feed = Math.max(1, segment.feed);
    segment.duration = (segment.distance / feed) * 60;
    segment.startTime = elapsedSeconds;
    elapsedSeconds += segment.duration;
    segment.endTime = elapsedSeconds;
  }

  return {
    name: "MR1_DEMO_POCKET.NC",
    segments,
    lineCount: segments.length,
    duration: elapsedSeconds,
    spindle: 6800,
    bounds: {
      min: { x: -125, y: -95, z: -8 },
      max: { x: 125, y: 95, z: 20 },
    },
  };
}

export function sampleJob(job, elapsedSeconds) {
  const clampedTime = Math.max(0, Math.min(job.duration, elapsedSeconds));
  let index = job.segments.findIndex((segment) => clampedTime <= segment.endTime);
  if (index < 0) index = job.segments.length - 1;

  const segment = job.segments[index];
  const segmentTime = Math.max(0.0001, segment.duration);
  const localProgress = Math.max(
    0,
    Math.min(1, (clampedTime - segment.startTime) / segmentTime),
  );

  const position = {
    x: segment.from.x + (segment.to.x - segment.from.x) * localProgress,
    y: segment.from.y + (segment.to.y - segment.from.y) * localProgress,
    z: segment.from.z + (segment.to.z - segment.from.z) * localProgress,
  };

  return {
    elapsed: clampedTime,
    index,
    localProgress,
    position,
    segment,
    progress: job.duration > 0 ? clampedTime / job.duration : 0,
  };
}
