import { EMCO_LATHE_NC_CONTRACT, MR1_NC_CONTRACT, validateMr1Nc } from "./nc-safety-validator.js";

// Conversational CAM cycle generators.
//
// Every generator is a pure function from validated parameters to a complete
// MR-1 NC program that must pass validateMr1Nc with zero blockers. All
// programs are metric (G21), absolute (G90), XY-plane (G17), with incremental
// arc centers (G91.1), a manual tool stop (Tn + M0), and qualified G53 Z
// retracts at the start, before tool changes, and before M30. After every
// retract or work-offset change the first move is XY at the retract height;
// Z descends only once XY is known. Canned cycles (G81-G89) are outside the
// MR-1 contract, so drilling is emitted as expanded G0/G1 motion.

const MAX_XY_FEED = MR1_NC_CONTRACT.maximumLinearFeedMmPerMinute;
const MAX_Z_FEED = MR1_NC_CONTRACT.maximumZFeedMmPerMinute;
const MAX_RPM = MR1_NC_CONTRACT.maximumSpindleRpm;
const SAFE_MACHINE_Z = MR1_NC_CONTRACT.safeMachineZMm;
const WORK_OFFSETS = ["G54", "G55", "G56", "G57", "G58", "G59"];

function fmt(value) {
  const rounded = Math.round(value * 1000) / 1000;
  const normalized = Object.is(rounded, -0) ? 0 : rounded;
  return normalized.toFixed(3);
}

class CycleParameterError extends Error {
  constructor(message, key = null) {
    super(message);
    this.name = "CycleParameterError";
    this.key = key;
  }
}

function requireNumber(params, key, label, { min = -Infinity, max = Infinity, integer = false } = {}) {
  const value = Number(params[key]);
  if (!Number.isFinite(value)) throw new CycleParameterError(`${label} is required.`, key);
  if (integer && !Number.isInteger(value)) throw new CycleParameterError(`${label} must be a whole number.`, key);
  if (value < min) throw new CycleParameterError(`${label} must be at least ${min}.`, key);
  if (value > max) throw new CycleParameterError(`${label} must be at most ${max}.`, key);
  return value;
}

const COMMON_PARAMS = [
  { key: "tool", label: "Tool number", unit: "T", value: 1, min: 1, max: 999, step: 1 },
  { key: "toolDiameter", label: "Tool diameter", unit: "mm", value: 6, min: 0.1, max: 80, step: 0.1 },
  { key: "rpm", label: "Spindle speed", unit: "RPM", value: 5000, min: 1, max: MAX_RPM, step: 50 },
  { key: "xyFeed", label: "XY cut feed", unit: "mm/min", value: 600, min: 1, max: MAX_XY_FEED, step: 10 },
  { key: "zFeed", label: "Plunge feed", unit: "mm/min", value: 150, min: 1, max: MAX_Z_FEED, step: 10 },
  { key: "clearZ", label: "Clearance Z (WCS)", unit: "mm", value: 5, min: 0.5, max: 100, step: 0.5 },
  { key: "wcs", label: "Work offset", unit: "", value: "G54", options: WORK_OFFSETS },
];

const MILL_CAPS = Object.freeze({ rpm: MAX_RPM, xyFeed: MAX_XY_FEED, zFeed: MAX_Z_FEED });
const LATHE_CAPS = Object.freeze({
  rpm: EMCO_LATHE_NC_CONTRACT.maximumSpindleRpm,
  xyFeed: EMCO_LATHE_NC_CONTRACT.maximumLinearFeedMmPerMinute,
  zFeed: EMCO_LATHE_NC_CONTRACT.maximumZFeedMmPerMinute,
});

function commonSetup(params, caps = MILL_CAPS) {
  const tool = requireNumber(params, "tool", "Tool number", { min: 1, max: 999, integer: true });
  const toolDiameter = requireNumber(params, "toolDiameter", "Tool diameter", { min: 0.1, max: 80 });
  const rpm = requireNumber(params, "rpm", "Spindle speed", { min: 1, max: caps.rpm });
  const xyFeed = requireNumber(params, "xyFeed", "XY cut feed", { min: 1, max: caps.xyFeed });
  const zFeed = requireNumber(params, "zFeed", "Plunge feed", { min: 1, max: caps.zFeed });
  const clearZ = requireNumber(params, "clearZ", "Clearance Z", { min: 0.5, max: 100 });
  const wcs = String(params.wcs ?? "G54").toUpperCase();
  if (!WORK_OFFSETS.includes(wcs)) throw new CycleParameterError("Work offset must be G54 through G59.", "wcs");
  const coolant = params.coolant !== false;
  return { tool, toolDiameter, rpm, xyFeed, zFeed, clearZ, wcs, coolant };
}

// Lathe cycles share these controls. Feeds are mm/min (G94) and stay under
// the provisional EMCO lathe contract; diameters in the UI, radii in the
// emitted X words. "Tool diameter" is repurposed as the insert/tool width
// where a cycle needs it.
const LATHE_COMMON_PARAMS = [
  { key: "tool", label: "Tool number", unit: "T", value: 1, min: 1, max: 999, step: 1 },
  { key: "toolDiameter", label: "Tool / insert width", unit: "mm", value: 3, min: 0.1, max: 80, step: 0.1 },
  { key: "rpm", label: "Spindle speed", unit: "RPM", value: 1200, min: 1, max: LATHE_CAPS.rpm, step: 50 },
  { key: "xyFeed", label: "Cut feed", unit: "mm/min", value: 120, min: 1, max: LATHE_CAPS.xyFeed, step: 5 },
  { key: "zFeed", label: "Plunge feed", unit: "mm/min", value: 60, min: 1, max: LATHE_CAPS.zFeed, step: 5 },
  { key: "clearZ", label: "Z clearance off face", unit: "mm", value: 2, min: 0.5, max: 100, step: 0.5 },
  { key: "clearX", label: "Radial clearance", unit: "mm", value: 2, min: 0.5, max: 50, step: 0.5 },
  { key: "wcs", label: "Work offset", unit: "", value: "G54", options: WORK_OFFSETS },
];

// Every lathe cycle builds with the EMCO's own conventions: XZ plane, G7
// diameter programming, and that machine's safe park (machine Z 171.5,
// retracted away from the chuck) rather than the mill's Z-2.
const LATHE_BUILDER_OPTIONS = Object.freeze({
  plane: "G18",
  latheMode: `G${EMCO_LATHE_NC_CONTRACT.requiredLatheMode}`,
  safeZ: EMCO_LATHE_NC_CONTRACT.safeMachineZMm,
});

function latheSetup(params) {
  const setup = commonSetup(params, LATHE_CAPS);
  setup.clearX = requireNumber(params, "clearX", "Radial clearance", { min: 0.5, max: 50 });
  return setup;
}

// Helical descent as paired half arcs. The tool must already sit at
// (centerX + radius, centerY) at fromZ; it ends at the same XY at toZ.
function helixDescend(builder, centerX, centerY, radius, fromZ, toZ, pitchPerRev) {
  let z = fromZ;
  while (z > toZ + 1e-9) {
    const next = Math.max(toZ, z - pitchPerRev);
    builder.arc(false, centerX - radius, centerY, -radius, 0, z + (next - z) / 2);
    builder.arc(false, centerX + radius, centerY, radius, 0, next);
    z = next;
  }
}

// 45-degree pointed chamfer tool with its tip at Z = -tipOffset: the cone
// radius at the part's top surface is tipOffset, so the produced chamfer
// width is tipOffset minus the horizontal offset of the tool axis outside
// the edge. To cut chamferWidth the axis must track tipOffset - chamferWidth
// outside the edge, and the cone at cutting depth must fit the tool.
function chamferTrackOffset(setup, chamferWidth, tipOffset) {
  if (chamferWidth >= tipOffset) {
    throw new CycleParameterError("Tip depth must be greater than the chamfer width.", "tipOffset");
  }
  if (tipOffset > setup.toolDiameter / 2) {
    throw new CycleParameterError("Tip depth cannot exceed the chamfer tool radius.", "tipOffset");
  }
  return tipOffset - chamferWidth;
}

function depthPasses(totalDepth, depthPerPass) {
  if (depthPerPass <= 0) throw new CycleParameterError("Depth per pass must be positive.", "stepDown");
  const passes = [];
  let z = 0;
  while (z > -totalDepth + 1e-9) {
    z = Math.max(-totalDepth, z - depthPerPass);
    passes.push(z);
  }
  return passes;
}

class ProgramBuilder {
  constructor(title, setup, { plane = "G17", latheMode = null, safeZ = SAFE_MACHINE_Z } = {}) {
    this.setup = setup;
    this.safeZ = safeZ;
    // Last commanded work position as emitted words; null = unknown.
    this.at = { x: null, y: null, z: null };
    this.lines = [
      `(MR1 CONVERSATIONAL - ${sanitizeComment(title)})`,
      `G21 G90 G94 ${plane}${latheMode ? ` ${latheMode}` : ""} G40 G49 G80`,
      "G91.1",
      `G53 G0 Z${fmt(safeZ)}`,
      `T${setup.tool}`,
      `M0 (INSERT TOOL ${setup.tool} THEN CYCLE START)`,
      setup.wcs,
      `S${Math.round(setup.rpm)} M3`,
    ];
    if (setup.coolant) this.lines.push("M8");
  }

  track(x, y, z) {
    if (x !== null) this.at.x = fmt(x);
    if (y !== null) this.at.y = fmt(y);
    if (z !== null) this.at.z = fmt(z);
  }

  rapid(x, y) {
    if (this.at.x === fmt(x) && this.at.y === fmt(y)) return;
    this.lines.push(`G0 X${fmt(x)} Y${fmt(y)}`);
    this.track(x, y, null);
  }

  // After a machine retract, tool change or work-offset change the work Z is
  // unknown: position XY at the retract height first, then descend to
  // clearance. Every cycle opens with this.
  approach(x, y) {
    this.rapid(x, y);
    this.rapidZ(this.setup.clearZ);
  }

  // Lathe helpers: XZ plane, no Y words ever.
  //
  // Every argument here is a RADIUS, because clearances and depths of cut are
  // naturally radial. The EMCO interpreter runs in G7 DIAMETER mode, so each
  // emitted X word is the doubled value. That conversion happens exactly once,
  // here - never in a cycle.
  latheRapid(radius, z) {
    this.lines.push(`G0 X${fmt(radius * 2)} Z${fmt(z)}`);
    this.track(radius * 2, null, z);
  }

  latheRapidX(radius) {
    this.lines.push(`G0 X${fmt(radius * 2)}`);
    this.track(radius * 2, null, null);
  }

  // Lathe counterpart of approach(): X at the park height, then Z clearance.
  latheApproach(radius) {
    this.latheRapidX(radius);
    this.rapidZ(this.setup.clearZ);
  }

  latheCut(radius, z) {
    this.lines.push(`G1 X${fmt(radius * 2)} Z${fmt(z)} F${fmt(this.setup.xyFeed)}`);
    this.track(radius * 2, null, z);
  }

  latheCutX(radius) {
    this.lines.push(`G1 X${fmt(radius * 2)} F${fmt(this.setup.xyFeed)}`);
    this.track(radius * 2, null, null);
  }

  latheCutZ(z) {
    this.lines.push(`G1 Z${fmt(z)} F${fmt(this.setup.xyFeed)}`);
    this.track(null, null, z);
  }

  rapidZ(z) {
    if (this.at.z === fmt(z)) return;
    this.lines.push(`G0 Z${fmt(z)}`);
    this.track(null, null, z);
  }

  plunge(z) {
    this.lines.push(`G1 Z${fmt(z)} F${fmt(this.setup.zFeed)}`);
    this.track(null, null, z);
  }

  cut(x, y, z = null) {
    const zWord = z === null ? "" : ` Z${fmt(z)}`;
    this.lines.push(`G1 X${fmt(x)} Y${fmt(y)}${zWord} F${fmt(this.setup.xyFeed)}`);
    this.track(x, y, z);
  }

  arc(clockwise, x, y, i, j, z = null, feed = null) {
    const zWord = z === null ? "" : ` Z${fmt(z)}`;
    this.lines.push(
      `${clockwise ? "G2" : "G3"} X${fmt(x)} Y${fmt(y)}${zWord} I${fmt(i)} J${fmt(j)} F${fmt(feed ?? this.setup.xyFeed)}`,
    );
    this.track(x, y, z);
  }

  fullCircle(clockwise, centerX, centerY, radius) {
    // Two half circles from the +X quadrant point for preview robustness.
    // The tool must already sit at (centerX + radius, centerY).
    const east = { x: centerX + radius, y: centerY };
    const west = { x: centerX - radius, y: centerY };
    this.arc(clockwise, west.x, west.y, -radius, 0);
    this.arc(clockwise, east.x, east.y, radius, 0);
  }

  // Zigzag ramp between two XY points, descending a shallow slope per
  // traverse, then a final full-length pass at the target depth. Avoids
  // plunging an end mill straight down into solid material. The tool must
  // already sit at (x0, y0) at fromZ; it ends at (x0, y0) at toZ.
  rampEntry(x0, y0, x1, y1, fromZ, toZ) {
    const length = Math.hypot(x1 - x0, y1 - y0);
    const rampStep = Math.max(0.02, length * 0.05);
    let z = fromZ;
    let atStart = true;
    while (z > toZ + 1e-9) {
      z = Math.max(toZ, z - rampStep);
      if (atStart) this.cut(x1, y1, z);
      else this.cut(x0, y0, z);
      atStart = !atStart;
    }
    if (atStart) {
      this.cut(x1, y1, toZ);
      this.cut(x0, y0, toZ);
    } else {
      this.cut(x0, y0, toZ);
    }
  }

  dwell(seconds) {
    this.lines.push(`G4 P${fmt(seconds)}`);
  }

  comment(text) {
    this.lines.push(`(${sanitizeComment(text)})`);
  }

  finish() {
    if (this.setup.coolant) this.lines.push("M9");
    this.lines.push("M5", `G53 G0 Z${fmt(this.safeZ)}`, "M30", "");
    return this.lines.join("\n");
  }
}

function drillOnePoint(builder, point, { depth, retractZ, peck = 0, dwellSeconds = 0 }) {
  builder.rapid(point.x, point.y);
  builder.rapidZ(retractZ);
  if (peck > 0) {
    let reached = 0;
    while (reached > -depth + 1e-9) {
      const next = Math.max(-depth, reached - peck);
      if (reached < 0) builder.rapidZ(reached + 0.5);
      builder.plunge(next);
      reached = next;
      if (reached > -depth + 1e-9) builder.rapidZ(retractZ);
    }
  } else {
    builder.plunge(-depth);
  }
  if (dwellSeconds > 0) builder.dwell(dwellSeconds);
  builder.rapidZ(retractZ);
}

function drillPattern(builder, points, options) {
  for (const point of points) drillOnePoint(builder, point, options);
}

function gridPoints(params) {
  const originX = requireNumber(params, "originX", "First hole X", { min: -10000, max: 10000 });
  const originY = requireNumber(params, "originY", "First hole Y", { min: -10000, max: 10000 });
  const columns = requireNumber(params, "columns", "Columns", { min: 1, max: 200, integer: true });
  const rows = requireNumber(params, "rows", "Rows", { min: 1, max: 200, integer: true });
  const pitchX = requireNumber(params, "pitchX", "X pitch", { min: 0, max: 5000 });
  const pitchY = requireNumber(params, "pitchY", "Y pitch", { min: 0, max: 5000 });
  if (columns > 1 && pitchX <= 0) throw new CycleParameterError("X pitch must be positive for multiple columns.", "pitchX");
  if (rows > 1 && pitchY <= 0) throw new CycleParameterError("Y pitch must be positive for multiple rows.", "pitchY");
  const points = [];
  for (let row = 0; row < rows; row += 1) {
    // Serpentine ordering keeps rapids short.
    const forward = row % 2 === 0;
    for (let index = 0; index < columns; index += 1) {
      const column = forward ? index : columns - 1 - index;
      points.push({ x: originX + column * pitchX, y: originY + row * pitchY });
    }
  }
  return points;
}

function boltCirclePoints(params) {
  const centerX = requireNumber(params, "centerX", "Center X", { min: -10000, max: 10000 });
  const centerY = requireNumber(params, "centerY", "Center Y", { min: -10000, max: 10000 });
  const circleDiameter = requireNumber(params, "circleDiameter", "Bolt circle diameter", { min: 0.2, max: 5000 });
  const holes = requireNumber(params, "holes", "Hole count", { min: 1, max: 360, integer: true });
  const startAngle = requireNumber(params, "startAngle", "Start angle", { min: -360, max: 360 });
  const radius = circleDiameter / 2;
  const points = [];
  for (let index = 0; index < holes; index += 1) {
    const angle = ((startAngle + (360 / holes) * index) * Math.PI) / 180;
    points.push({ x: centerX + radius * Math.cos(angle), y: centerY + radius * Math.sin(angle) });
  }
  return points;
}

function linePoints(params) {
  const startX = requireNumber(params, "startX", "First hole X", { min: -10000, max: 10000 });
  const startY = requireNumber(params, "startY", "First hole Y", { min: -10000, max: 10000 });
  const holes = requireNumber(params, "holes", "Hole count", { min: 1, max: 500, integer: true });
  const pitch = requireNumber(params, "pitch", "Hole pitch", { min: 0.01, max: 5000 });
  const angle = (requireNumber(params, "angle", "Line angle", { min: -360, max: 360 }) * Math.PI) / 180;
  const points = [];
  for (let index = 0; index < holes; index += 1) {
    points.push({
      x: startX + index * pitch * Math.cos(angle),
      y: startY + index * pitch * Math.sin(angle),
    });
  }
  return points;
}

const DRILL_DEPTH_PARAMS = [
  { key: "depth", label: "Hole depth", unit: "mm", value: 10, min: 0.05, max: 150, step: 0.5 },
  { key: "retract", label: "Retract above Z0", unit: "mm", value: 2, min: 0.5, max: 50, step: 0.5 },
];

function drillOptions(params, { peckDefault = 0, dwellDefault = 0 } = {}) {
  const depth = requireNumber(params, "depth", "Hole depth", { min: 0.05, max: 150 });
  const retractZ = requireNumber(params, "retract", "Retract height", { min: 0.5, max: 50 });
  const peck = params.peck === undefined ? peckDefault : requireNumber(params, "peck", "Peck depth", { min: 0, max: 150 });
  const dwellSeconds = params.dwell === undefined ? dwellDefault : requireNumber(params, "dwell", "Dwell", { min: 0, max: 30 });
  return { depth, retractZ, peck, dwellSeconds };
}

function rectanglePerimeter(centerX, centerY, width, height) {
  const halfW = width / 2;
  const halfH = height / 2;
  return [
    { x: centerX - halfW, y: centerY - halfH },
    { x: centerX + halfW, y: centerY - halfH },
    { x: centerX + halfW, y: centerY + halfH },
    { x: centerX - halfW, y: centerY + halfH },
  ];
}

function traceRectangle(builder, corners, z) {
  builder.cut(corners[1].x, corners[1].y, z);
  builder.cut(corners[2].x, corners[2].y);
  builder.cut(corners[3].x, corners[3].y);
  builder.cut(corners[0].x, corners[0].y);
}

// --- Cycle definitions -----------------------------------------------------

export const CONVERSATIONAL_CYCLES = [
  {
    id: "face",
    title: "Face stock",
    group: "Facing",
    description: "Zigzag faces a rectangular area in depth passes.",
    params: [
      ...COMMON_PARAMS,
      { key: "centerX", label: "Center X", unit: "mm", value: 0, min: -10000, max: 10000, step: 0.1 },
      { key: "centerY", label: "Center Y", unit: "mm", value: 0, min: -10000, max: 10000, step: 0.1 },
      { key: "width", label: "Width (X)", unit: "mm", value: 100, min: 0.2, max: 5000, step: 1 },
      { key: "height", label: "Height (Y)", unit: "mm", value: 60, min: 0.2, max: 5000, step: 1 },
      { key: "depth", label: "Total depth", unit: "mm", value: 1, min: 0.01, max: 50, step: 0.1 },
      { key: "stepDown", label: "Depth per pass", unit: "mm", value: 0.5, min: 0.01, max: 10, step: 0.1 },
      { key: "stepOverPercent", label: "Stepover", unit: "%", value: 70, min: 5, max: 95, step: 5 },
    ],
    generate(params) {
      const setup = commonSetup(params);
      const centerX = requireNumber(params, "centerX", "Center X", { min: -10000, max: 10000 });
      const centerY = requireNumber(params, "centerY", "Center Y", { min: -10000, max: 10000 });
      const width = requireNumber(params, "width", "Width", { min: 0.2, max: 5000 });
      const height = requireNumber(params, "height", "Height", { min: 0.2, max: 5000 });
      const depth = requireNumber(params, "depth", "Total depth", { min: 0.01, max: 50 });
      const stepDown = requireNumber(params, "stepDown", "Depth per pass", { min: 0.01, max: 10 });
      const stepOverPercent = requireNumber(params, "stepOverPercent", "Stepover", { min: 5, max: 95 });
      const stepOver = (setup.toolDiameter * stepOverPercent) / 100;
      const overhang = setup.toolDiameter * 0.6;
      const left = centerX - width / 2 - overhang;
      const right = centerX + width / 2 + overhang;
      const bottom = centerY - height / 2;
      const top = centerY + height / 2;
      const builder = new ProgramBuilder(this.title, setup);
      builder.approach(left, bottom);
      for (const z of depthPasses(depth, stepDown)) {
        builder.rapidZ(setup.clearZ);
        builder.rapid(left, bottom);
        builder.plunge(z);
        let y = bottom;
        let goingRight = true;
        for (;;) {
          builder.cut(goingRight ? right : left, y);
          if (y >= top - 1e-9) break;
          y = Math.min(top, y + stepOver);
          builder.cut(goingRight ? right : left, y);
          goingRight = !goingRight;
        }
        builder.rapidZ(setup.clearZ);
      }
      return builder.finish();
    },
  },
  {
    id: "spiral-face",
    title: "Spiral face (round stock)",
    group: "Facing",
    description: "Faces a circular area from outside in with concentric passes.",
    params: [
      ...COMMON_PARAMS,
      { key: "centerX", label: "Center X", unit: "mm", value: 0, min: -10000, max: 10000, step: 0.1 },
      { key: "centerY", label: "Center Y", unit: "mm", value: 0, min: -10000, max: 10000, step: 0.1 },
      { key: "diameter", label: "Stock diameter", unit: "mm", value: 80, min: 0.2, max: 5000, step: 1 },
      { key: "depth", label: "Total depth", unit: "mm", value: 1, min: 0.01, max: 50, step: 0.1 },
      { key: "stepDown", label: "Depth per pass", unit: "mm", value: 0.5, min: 0.01, max: 10, step: 0.1 },
      { key: "stepOverPercent", label: "Stepover", unit: "%", value: 60, min: 5, max: 95, step: 5 },
    ],
    generate(params) {
      const setup = commonSetup(params);
      const centerX = requireNumber(params, "centerX", "Center X", { min: -10000, max: 10000 });
      const centerY = requireNumber(params, "centerY", "Center Y", { min: -10000, max: 10000 });
      const diameter = requireNumber(params, "diameter", "Stock diameter", { min: 0.2, max: 5000 });
      const depth = requireNumber(params, "depth", "Total depth", { min: 0.01, max: 50 });
      const stepDown = requireNumber(params, "stepDown", "Depth per pass", { min: 0.01, max: 10 });
      const stepOverPercent = requireNumber(params, "stepOverPercent", "Stepover", { min: 5, max: 95 });
      const stepOver = (setup.toolDiameter * stepOverPercent) / 100;
      const outerRadius = diameter / 2 + setup.toolDiameter * 0.55;
      const builder = new ProgramBuilder(this.title, setup);
      builder.approach(centerX + outerRadius, centerY);
      for (const z of depthPasses(depth, stepDown)) {
        builder.rapidZ(setup.clearZ);
        builder.rapid(centerX + outerRadius, centerY);
        builder.plunge(z);
        // Concentric passes from the outside in, then a straight cut through
        // the center so no nub survives at the middle of the stock.
        let radius = outerRadius;
        for (;;) {
          builder.fullCircle(true, centerX, centerY, radius);
          if (radius <= stepOver + 1e-9) break;
          radius = Math.max(stepOver, radius - stepOver);
          builder.cut(centerX + radius, centerY);
        }
        builder.cut(centerX, centerY);
        builder.rapidZ(setup.clearZ);
      }
      return builder.finish();
    },
  },
  {
    id: "rect-pocket",
    title: "Rectangular pocket",
    group: "Pockets",
    description: "Clears a rectangular pocket with concentric passes and a finish wall pass.",
    params: [
      ...COMMON_PARAMS,
      { key: "centerX", label: "Center X", unit: "mm", value: 0, min: -10000, max: 10000, step: 0.1 },
      { key: "centerY", label: "Center Y", unit: "mm", value: 0, min: -10000, max: 10000, step: 0.1 },
      { key: "width", label: "Pocket width (X)", unit: "mm", value: 60, min: 0.2, max: 5000, step: 1 },
      { key: "height", label: "Pocket height (Y)", unit: "mm", value: 40, min: 0.2, max: 5000, step: 1 },
      { key: "depth", label: "Pocket depth", unit: "mm", value: 5, min: 0.01, max: 150, step: 0.5 },
      { key: "stepDown", label: "Depth per pass", unit: "mm", value: 1, min: 0.01, max: 10, step: 0.1 },
      { key: "stepOverPercent", label: "Stepover", unit: "%", value: 45, min: 5, max: 70, step: 5 },
    ],
    generate(params) {
      const setup = commonSetup(params);
      const centerX = requireNumber(params, "centerX", "Center X", { min: -10000, max: 10000 });
      const centerY = requireNumber(params, "centerY", "Center Y", { min: -10000, max: 10000 });
      const width = requireNumber(params, "width", "Pocket width", { min: 0.2, max: 5000 });
      const height = requireNumber(params, "height", "Pocket height", { min: 0.2, max: 5000 });
      const depth = requireNumber(params, "depth", "Pocket depth", { min: 0.01, max: 150 });
      const stepDown = requireNumber(params, "stepDown", "Depth per pass", { min: 0.01, max: 10 });
      const stepOverPercent = requireNumber(params, "stepOverPercent", "Stepover", { min: 5, max: 70 });
      if (setup.toolDiameter >= Math.min(width, height)) {
        throw new CycleParameterError("Tool diameter must be smaller than the pocket's smallest side.", "toolDiameter");
      }
      const stepOver = (setup.toolDiameter * stepOverPercent) / 100;
      const wallW = width - setup.toolDiameter;
      const wallH = height - setup.toolDiameter;
      const rampHalf = Math.min(wallW / 2, setup.toolDiameter * 2);
      const builder = new ProgramBuilder(this.title, setup);
      builder.approach(centerX - rampHalf, centerY);
      builder.rapidZ(0.5);
      let previousLevel = 0.5;
      for (const z of depthPasses(depth, stepDown)) {
        // Zigzag ramp down to the next level instead of a straight plunge.
        builder.rampEntry(centerX - rampHalf, centerY, centerX + rampHalf, centerY, previousLevel, z);
        const maxInset = Math.max(wallW, wallH) / 2;
        const rings = [];
        for (let inset = stepOver; inset < maxInset; inset += stepOver) {
          rings.push({
            w: Math.min(wallW, inset * 2),
            h: Math.min(wallH, inset * 2),
          });
        }
        rings.push({ w: wallW, h: wallH });
        for (const ring of rings) {
          const corners = rectanglePerimeter(centerX, centerY, ring.w, ring.h);
          builder.cut(corners[0].x, corners[0].y);
          traceRectangle(builder, corners, null);
        }
        builder.cut(centerX - rampHalf, centerY);
        previousLevel = z;
      }
      builder.rapidZ(setup.clearZ);
      return builder.finish();
    },
  },
  {
    id: "circ-pocket",
    title: "Circular pocket",
    group: "Pockets",
    description: "Clears a circular pocket with concentric circles from the center out.",
    params: [
      ...COMMON_PARAMS,
      { key: "centerX", label: "Center X", unit: "mm", value: 0, min: -10000, max: 10000, step: 0.1 },
      { key: "centerY", label: "Center Y", unit: "mm", value: 0, min: -10000, max: 10000, step: 0.1 },
      { key: "diameter", label: "Pocket diameter", unit: "mm", value: 40, min: 0.2, max: 5000, step: 0.5 },
      { key: "depth", label: "Pocket depth", unit: "mm", value: 5, min: 0.01, max: 150, step: 0.5 },
      { key: "stepDown", label: "Depth per pass", unit: "mm", value: 1, min: 0.01, max: 10, step: 0.1 },
      { key: "stepOverPercent", label: "Stepover", unit: "%", value: 45, min: 5, max: 80, step: 5 },
    ],
    generate(params) {
      const setup = commonSetup(params);
      const centerX = requireNumber(params, "centerX", "Center X", { min: -10000, max: 10000 });
      const centerY = requireNumber(params, "centerY", "Center Y", { min: -10000, max: 10000 });
      const diameter = requireNumber(params, "diameter", "Pocket diameter", { min: 0.2, max: 5000 });
      const depth = requireNumber(params, "depth", "Pocket depth", { min: 0.01, max: 150 });
      const stepDown = requireNumber(params, "stepDown", "Depth per pass", { min: 0.01, max: 10 });
      const stepOverPercent = requireNumber(params, "stepOverPercent", "Stepover", { min: 5, max: 80 });
      if (setup.toolDiameter >= diameter) {
        throw new CycleParameterError("Tool diameter must be smaller than the pocket diameter.", "toolDiameter");
      }
      const stepOver = (setup.toolDiameter * stepOverPercent) / 100;
      const wallRadius = (diameter - setup.toolDiameter) / 2;
      const entryRadius = Math.min(wallRadius, stepOver);
      const builder = new ProgramBuilder(this.title, setup);
      builder.approach(centerX + entryRadius, centerY);
      builder.rapidZ(0.5);
      builder.plunge(0);
      let previousLevel = 0;
      for (const z of depthPasses(depth, stepDown)) {
        // Helical entry at a small radius instead of a straight plunge.
        helixDescend(builder, centerX, centerY, entryRadius, previousLevel, z, stepDown);
        builder.fullCircle(false, centerX, centerY, entryRadius);
        const radii = [];
        for (let radius = entryRadius + stepOver; radius < wallRadius; radius += stepOver) radii.push(radius);
        if (wallRadius > entryRadius + 1e-9) radii.push(wallRadius);
        for (const radius of radii) {
          builder.cut(centerX + radius, centerY);
          builder.fullCircle(false, centerX, centerY, radius);
        }
        builder.cut(centerX + entryRadius, centerY);
        previousLevel = z;
      }
      builder.cut(centerX, centerY);
      builder.rapidZ(setup.clearZ);
      return builder.finish();
    },
  },
  {
    id: "circ-bore",
    title: "Bore / hole milling",
    group: "Pockets",
    description: "Helically enters and mills a hole to size with a finish circle.",
    params: [
      ...COMMON_PARAMS,
      { key: "centerX", label: "Center X", unit: "mm", value: 0, min: -10000, max: 10000, step: 0.1 },
      { key: "centerY", label: "Center Y", unit: "mm", value: 0, min: -10000, max: 10000, step: 0.1 },
      { key: "diameter", label: "Hole diameter", unit: "mm", value: 20, min: 0.2, max: 5000, step: 0.1 },
      { key: "depth", label: "Hole depth", unit: "mm", value: 8, min: 0.01, max: 150, step: 0.5 },
      { key: "helixPitch", label: "Helix pitch per rev", unit: "mm", value: 0.5, min: 0.05, max: 5, step: 0.05 },
    ],
    generate(params) {
      const setup = commonSetup(params);
      const centerX = requireNumber(params, "centerX", "Center X", { min: -10000, max: 10000 });
      const centerY = requireNumber(params, "centerY", "Center Y", { min: -10000, max: 10000 });
      const diameter = requireNumber(params, "diameter", "Hole diameter", { min: 0.2, max: 5000 });
      const depth = requireNumber(params, "depth", "Hole depth", { min: 0.01, max: 150 });
      const helixPitch = requireNumber(params, "helixPitch", "Helix pitch", { min: 0.05, max: 5 });
      if (setup.toolDiameter >= diameter) {
        throw new CycleParameterError("Tool diameter must be smaller than the hole diameter.", "toolDiameter");
      }
      const radius = (diameter - setup.toolDiameter) / 2;
      const builder = new ProgramBuilder(this.title, setup);
      builder.approach(centerX + radius, centerY);
      builder.rapidZ(1);
      builder.plunge(0);
      let z = 0;
      while (z > -depth + 1e-9) {
        const next = Math.max(-depth, z - helixPitch);
        builder.arc(false, centerX - radius, centerY, -radius, 0, (z + next) / 2);
        builder.arc(false, centerX + radius, centerY, radius, 0, next);
        z = next;
      }
      builder.comment("FINISH PASS AT FULL DEPTH");
      builder.fullCircle(false, centerX, centerY, radius);
      // Whenever the wall radius exceeds the tool radius the peripheral
      // helix leaves a standing core column; clear it top-down through the
      // open annulus instead of feeding into it at full depth.
      const coreRadius = radius - setup.toolDiameter / 2;
      if (coreRadius > 1e-6) {
        builder.comment("CLEAR CORE TOP-DOWN");
        const clearStep = setup.toolDiameter * 0.45;
        const levelStep = Math.min(depth, setup.toolDiameter * 0.5);
        builder.rapidZ(setup.clearZ);
        let level = 0;
        while (level > -depth + 1e-9) {
          level = Math.max(-depth, level - levelStep);
          builder.rapidZ(level + levelStep + 0.5);
          builder.plunge(level);
          for (let ringRadius = radius - clearStep; ringRadius > 1e-9; ringRadius -= clearStep) {
            builder.cut(centerX + ringRadius, centerY);
            builder.fullCircle(false, centerX, centerY, ringRadius);
          }
          builder.cut(centerX, centerY);
          builder.cut(centerX + radius, centerY);
        }
      }
      builder.rapidZ(setup.clearZ);
      return builder.finish();
    },
  },
  {
    id: "rect-contour-outside",
    title: "Rectangle contour (outside)",
    group: "Contours",
    description: "Profiles the outside of a rectangular boss in depth passes.",
    params: [
      ...COMMON_PARAMS,
      { key: "centerX", label: "Center X", unit: "mm", value: 0, min: -10000, max: 10000, step: 0.1 },
      { key: "centerY", label: "Center Y", unit: "mm", value: 0, min: -10000, max: 10000, step: 0.1 },
      { key: "width", label: "Part width (X)", unit: "mm", value: 60, min: 0.2, max: 5000, step: 1 },
      { key: "height", label: "Part height (Y)", unit: "mm", value: 40, min: 0.2, max: 5000, step: 1 },
      { key: "depth", label: "Profile depth", unit: "mm", value: 5, min: 0.01, max: 150, step: 0.5 },
      { key: "stepDown", label: "Depth per pass", unit: "mm", value: 1, min: 0.01, max: 10, step: 0.1 },
    ],
    generate(params) {
      const setup = commonSetup(params);
      return generateRectContour(this.title, setup, params, "outside");
    },
  },
  {
    id: "rect-contour-inside",
    title: "Rectangle contour (inside)",
    group: "Contours",
    description: "Profiles the inside wall of a rectangular window in depth passes.",
    params: [
      ...COMMON_PARAMS,
      { key: "centerX", label: "Center X", unit: "mm", value: 0, min: -10000, max: 10000, step: 0.1 },
      { key: "centerY", label: "Center Y", unit: "mm", value: 0, min: -10000, max: 10000, step: 0.1 },
      { key: "width", label: "Window width (X)", unit: "mm", value: 60, min: 0.2, max: 5000, step: 1 },
      { key: "height", label: "Window height (Y)", unit: "mm", value: 40, min: 0.2, max: 5000, step: 1 },
      { key: "depth", label: "Profile depth", unit: "mm", value: 5, min: 0.01, max: 150, step: 0.5 },
      { key: "stepDown", label: "Depth per pass", unit: "mm", value: 1, min: 0.01, max: 10, step: 0.1 },
    ],
    generate(params) {
      const setup = commonSetup(params);
      return generateRectContour(this.title, setup, params, "inside");
    },
  },
  {
    id: "circ-contour",
    title: "Circle contour (boss)",
    group: "Contours",
    description: "Profiles the outside of a circular boss in depth passes.",
    params: [
      ...COMMON_PARAMS,
      { key: "centerX", label: "Center X", unit: "mm", value: 0, min: -10000, max: 10000, step: 0.1 },
      { key: "centerY", label: "Center Y", unit: "mm", value: 0, min: -10000, max: 10000, step: 0.1 },
      { key: "diameter", label: "Boss diameter", unit: "mm", value: 40, min: 0.2, max: 5000, step: 0.5 },
      { key: "depth", label: "Profile depth", unit: "mm", value: 5, min: 0.01, max: 150, step: 0.5 },
      { key: "stepDown", label: "Depth per pass", unit: "mm", value: 1, min: 0.01, max: 10, step: 0.1 },
    ],
    generate(params) {
      const setup = commonSetup(params);
      const centerX = requireNumber(params, "centerX", "Center X", { min: -10000, max: 10000 });
      const centerY = requireNumber(params, "centerY", "Center Y", { min: -10000, max: 10000 });
      const diameter = requireNumber(params, "diameter", "Boss diameter", { min: 0.2, max: 5000 });
      const depth = requireNumber(params, "depth", "Profile depth", { min: 0.01, max: 150 });
      const stepDown = requireNumber(params, "stepDown", "Depth per pass", { min: 0.01, max: 10 });
      const radius = (diameter + setup.toolDiameter) / 2;
      const builder = new ProgramBuilder(this.title, setup);
      builder.approach(centerX + radius + setup.toolDiameter, centerY);
      for (const z of depthPasses(depth, stepDown)) {
        builder.plunge(z);
        builder.cut(centerX + radius, centerY);
        builder.fullCircle(true, centerX, centerY, radius);
        builder.cut(centerX + radius + setup.toolDiameter, centerY);
      }
      builder.rapidZ(setup.clearZ);
      return builder.finish();
    },
  },
  {
    id: "slot",
    title: "Slot",
    group: "Contours",
    description: "Mills a straight slot between two points in depth passes.",
    params: [
      ...COMMON_PARAMS,
      { key: "startX", label: "Start X", unit: "mm", value: -20, min: -10000, max: 10000, step: 0.1 },
      { key: "startY", label: "Start Y", unit: "mm", value: 0, min: -10000, max: 10000, step: 0.1 },
      { key: "endX", label: "End X", unit: "mm", value: 20, min: -10000, max: 10000, step: 0.1 },
      { key: "endY", label: "End Y", unit: "mm", value: 0, min: -10000, max: 10000, step: 0.1 },
      { key: "depth", label: "Slot depth", unit: "mm", value: 5, min: 0.01, max: 150, step: 0.5 },
      { key: "stepDown", label: "Depth per pass", unit: "mm", value: 0.5, min: 0.01, max: 10, step: 0.1 },
    ],
    generate(params) {
      const setup = commonSetup(params);
      const startX = requireNumber(params, "startX", "Start X", { min: -10000, max: 10000 });
      const startY = requireNumber(params, "startY", "Start Y", { min: -10000, max: 10000 });
      const endX = requireNumber(params, "endX", "End X", { min: -10000, max: 10000 });
      const endY = requireNumber(params, "endY", "End Y", { min: -10000, max: 10000 });
      const depth = requireNumber(params, "depth", "Slot depth", { min: 0.01, max: 150 });
      const stepDown = requireNumber(params, "stepDown", "Depth per pass", { min: 0.01, max: 10 });
      if (Math.hypot(endX - startX, endY - startY) < 0.01) {
        throw new CycleParameterError("Slot start and end points must be at least 0.01 mm apart.", "endX");
      }
      const builder = new ProgramBuilder(this.title, setup);
      builder.approach(startX, startY);
      builder.rapidZ(0.5);
      let previousLevel = 0.5;
      for (const z of depthPasses(depth, stepDown)) {
        // The zigzag ramp doubles as the slot cut for each level.
        builder.rampEntry(startX, startY, endX, endY, previousLevel, z);
        previousLevel = z;
      }
      builder.rapidZ(setup.clearZ);
      return builder.finish();
    },
  },
  {
    id: "chamfer-rect",
    title: "Chamfer rectangle",
    group: "Contours",
    description: "Runs a chamfer tool around a rectangular edge at chamfer depth.",
    params: [
      ...COMMON_PARAMS,
      { key: "centerX", label: "Center X", unit: "mm", value: 0, min: -10000, max: 10000, step: 0.1 },
      { key: "centerY", label: "Center Y", unit: "mm", value: 0, min: -10000, max: 10000, step: 0.1 },
      { key: "width", label: "Part width (X)", unit: "mm", value: 60, min: 0.2, max: 5000, step: 1 },
      { key: "height", label: "Part height (Y)", unit: "mm", value: 40, min: 0.2, max: 5000, step: 1 },
      { key: "chamferWidth", label: "Chamfer width", unit: "mm", value: 0.5, min: 0.05, max: 5, step: 0.05 },
      { key: "tipOffset", label: "Tip depth below edge", unit: "mm", value: 1, min: 0.05, max: 10, step: 0.05 },
    ],
    generate(params) {
      const setup = commonSetup(params);
      const centerX = requireNumber(params, "centerX", "Center X", { min: -10000, max: 10000 });
      const centerY = requireNumber(params, "centerY", "Center Y", { min: -10000, max: 10000 });
      const width = requireNumber(params, "width", "Part width", { min: 0.2, max: 5000 });
      const height = requireNumber(params, "height", "Part height", { min: 0.2, max: 5000 });
      const chamferWidth = requireNumber(params, "chamferWidth", "Chamfer width", { min: 0.05, max: 5 });
      const tipOffset = requireNumber(params, "tipOffset", "Tip depth", { min: 0.05, max: 10 });
      const trackOffset = chamferTrackOffset(setup, chamferWidth, tipOffset);
      const corners = rectanglePerimeter(centerX, centerY, width + trackOffset * 2, height + trackOffset * 2);
      const builder = new ProgramBuilder(this.title, setup);
      builder.approach(corners[0].x, corners[0].y);
      builder.plunge(-tipOffset);
      traceRectangle(builder, corners, null);
      builder.rapidZ(setup.clearZ);
      return builder.finish();
    },
  },
  {
    id: "chamfer-circle",
    title: "Chamfer circle",
    group: "Contours",
    description: "Runs a chamfer tool around a circular edge at chamfer depth.",
    params: [
      ...COMMON_PARAMS,
      { key: "centerX", label: "Center X", unit: "mm", value: 0, min: -10000, max: 10000, step: 0.1 },
      { key: "centerY", label: "Center Y", unit: "mm", value: 0, min: -10000, max: 10000, step: 0.1 },
      { key: "diameter", label: "Edge diameter", unit: "mm", value: 40, min: 0.2, max: 5000, step: 0.5 },
      { key: "chamferWidth", label: "Chamfer width", unit: "mm", value: 0.5, min: 0.05, max: 5, step: 0.05 },
      { key: "tipOffset", label: "Tip depth below edge", unit: "mm", value: 1, min: 0.05, max: 10, step: 0.05 },
    ],
    generate(params) {
      const setup = commonSetup(params);
      const centerX = requireNumber(params, "centerX", "Center X", { min: -10000, max: 10000 });
      const centerY = requireNumber(params, "centerY", "Center Y", { min: -10000, max: 10000 });
      const diameter = requireNumber(params, "diameter", "Edge diameter", { min: 0.2, max: 5000 });
      const chamferWidth = requireNumber(params, "chamferWidth", "Chamfer width", { min: 0.05, max: 5 });
      const tipOffset = requireNumber(params, "tipOffset", "Tip depth", { min: 0.05, max: 10 });
      const radius = diameter / 2 + chamferTrackOffset(setup, chamferWidth, tipOffset);
      const builder = new ProgramBuilder(this.title, setup);
      builder.approach(centerX + radius, centerY);
      builder.plunge(-tipOffset);
      builder.fullCircle(true, centerX, centerY, radius);
      builder.rapidZ(setup.clearZ);
      return builder.finish();
    },
  },
  {
    id: "thread-mill-internal",
    title: "Thread mill (internal)",
    group: "Threading",
    description: "Single-point thread mills an existing hole with a climb helix.",
    params: [
      ...COMMON_PARAMS,
      { key: "centerX", label: "Center X", unit: "mm", value: 0, min: -10000, max: 10000, step: 0.1 },
      { key: "centerY", label: "Center Y", unit: "mm", value: 0, min: -10000, max: 10000, step: 0.1 },
      { key: "majorDiameter", label: "Thread major diameter", unit: "mm", value: 10, min: 1, max: 500, step: 0.1 },
      { key: "pitch", label: "Thread pitch", unit: "mm", value: 1.5, min: 0.2, max: 6, step: 0.05 },
      { key: "threadDepth", label: "Thread length", unit: "mm", value: 12, min: 0.5, max: 100, step: 0.5 },
    ],
    generate(params) {
      const setup = commonSetup(params);
      const centerX = requireNumber(params, "centerX", "Center X", { min: -10000, max: 10000 });
      const centerY = requireNumber(params, "centerY", "Center Y", { min: -10000, max: 10000 });
      const majorDiameter = requireNumber(params, "majorDiameter", "Major diameter", { min: 1, max: 500 });
      const pitch = requireNumber(params, "pitch", "Thread pitch", { min: 0.2, max: 6 });
      const threadDepth = requireNumber(params, "threadDepth", "Thread length", { min: 0.5, max: 100 });
      // ISO metric minor diameter is roughly major - 1.0825 * pitch; the
      // cutter descends the pre-drilled hole at center, so it must clear
      // the minor bore with margin.
      const minorDiameter = majorDiameter - 1.0825 * pitch;
      if (setup.toolDiameter >= minorDiameter - 0.2) {
        throw new CycleParameterError(
          "Thread mill must fit the pre-drilled minor bore (tool diameter must be at least 0.2 mm under the thread minor diameter).",
          "toolDiameter",
        );
      }
      const radius = (majorDiameter - setup.toolDiameter) / 2;
      const builder = new ProgramBuilder(this.title, setup);
      builder.approach(centerX, centerY);
      builder.rapidZ(-threadDepth + 0.0);
      builder.comment("BOTTOM-UP CLIMB THREAD MILL");
      builder.cut(centerX + radius, centerY, null);
      let z = -threadDepth;
      while (z < -1e-9) {
        const next = Math.min(0, z + pitch);
        builder.arc(false, centerX - radius, centerY, -radius, 0, z + (next - z) / 2);
        builder.arc(false, centerX + radius, centerY, radius, 0, next);
        z = next;
      }
      builder.cut(centerX, centerY);
      builder.rapidZ(setup.clearZ);
      return builder.finish();
    },
  },
  {
    id: "thread-mill-external",
    title: "Thread mill (external)",
    group: "Threading",
    description: "Single-point thread mills a turned boss with a climb helix.",
    params: [
      ...COMMON_PARAMS,
      { key: "centerX", label: "Center X", unit: "mm", value: 0, min: -10000, max: 10000, step: 0.1 },
      { key: "centerY", label: "Center Y", unit: "mm", value: 0, min: -10000, max: 10000, step: 0.1 },
      { key: "majorDiameter", label: "Thread major diameter", unit: "mm", value: 12, min: 1, max: 500, step: 0.1 },
      { key: "pitch", label: "Thread pitch", unit: "mm", value: 1.75, min: 0.2, max: 6, step: 0.05 },
      { key: "threadDepth", label: "Thread length", unit: "mm", value: 10, min: 0.5, max: 100, step: 0.5 },
    ],
    generate(params) {
      const setup = commonSetup(params);
      const centerX = requireNumber(params, "centerX", "Center X", { min: -10000, max: 10000 });
      const centerY = requireNumber(params, "centerY", "Center Y", { min: -10000, max: 10000 });
      const majorDiameter = requireNumber(params, "majorDiameter", "Major diameter", { min: 1, max: 500 });
      const pitch = requireNumber(params, "pitch", "Thread pitch", { min: 0.2, max: 6 });
      const threadDepth = requireNumber(params, "threadDepth", "Thread length", { min: 0.5, max: 100 });
      const radius = (majorDiameter + setup.toolDiameter) / 2;
      const approachRadius = radius + setup.toolDiameter;
      const builder = new ProgramBuilder(this.title, setup);
      builder.approach(centerX + approachRadius, centerY);
      builder.rapidZ(0);
      // A right-hand external thread needs a clockwise helix that DESCENDS:
      // G2 with rising Z would cut a left-hand thread. Top-down G2 is also
      // climb milling for an external feature with an M3 spindle.
      builder.comment("TOP-DOWN CLIMB THREAD MILL - EXTERNAL RIGHT-HAND");
      builder.cut(centerX + radius, centerY, null);
      let z = 0;
      while (z > -threadDepth + 1e-9) {
        const next = Math.max(-threadDepth, z - pitch);
        builder.arc(true, centerX - radius, centerY, -radius, 0, z + (next - z) / 2);
        builder.arc(true, centerX + radius, centerY, radius, 0, next);
        z = next;
      }
      builder.cut(centerX + approachRadius, centerY);
      builder.rapidZ(setup.clearZ);
      return builder.finish();
    },
  },
  {
    id: "spot-drill",
    title: "Spot drill pattern",
    group: "Drilling",
    description: "Spot drills a grid of positions to a shallow depth.",
    params: [
      ...COMMON_PARAMS,
      { key: "originX", label: "First hole X", unit: "mm", value: 0, min: -10000, max: 10000, step: 0.1 },
      { key: "originY", label: "First hole Y", unit: "mm", value: 0, min: -10000, max: 10000, step: 0.1 },
      { key: "columns", label: "Columns", unit: "", value: 2, min: 1, max: 200, step: 1 },
      { key: "rows", label: "Rows", unit: "", value: 2, min: 1, max: 200, step: 1 },
      { key: "pitchX", label: "X pitch", unit: "mm", value: 20, min: 0, max: 5000, step: 0.5 },
      { key: "pitchY", label: "Y pitch", unit: "mm", value: 20, min: 0, max: 5000, step: 0.5 },
      { key: "depth", label: "Spot depth", unit: "mm", value: 1.5, min: 0.05, max: 20, step: 0.1 },
      { key: "retract", label: "Retract above Z0", unit: "mm", value: 2, min: 0.5, max: 50, step: 0.5 },
      { key: "dwell", label: "Dwell at depth", unit: "s", value: 0.2, min: 0, max: 30, step: 0.1 },
    ],
    generate(params) {
      const setup = commonSetup(params);
      const points = gridPoints(params);
      const options = drillOptions(params);
      const builder = new ProgramBuilder(this.title, setup);
      builder.approach(points[0].x, points[0].y);
      drillPattern(builder, points, options);
      builder.rapidZ(setup.clearZ);
      return builder.finish();
    },
  },
  {
    id: "drill-grid",
    title: "Drill grid",
    group: "Drilling",
    description: "Drills a rectangular grid of holes, optionally with pecks.",
    params: [
      ...COMMON_PARAMS,
      { key: "originX", label: "First hole X", unit: "mm", value: 0, min: -10000, max: 10000, step: 0.1 },
      { key: "originY", label: "First hole Y", unit: "mm", value: 0, min: -10000, max: 10000, step: 0.1 },
      { key: "columns", label: "Columns", unit: "", value: 3, min: 1, max: 200, step: 1 },
      { key: "rows", label: "Rows", unit: "", value: 2, min: 1, max: 200, step: 1 },
      { key: "pitchX", label: "X pitch", unit: "mm", value: 20, min: 0, max: 5000, step: 0.5 },
      { key: "pitchY", label: "Y pitch", unit: "mm", value: 20, min: 0, max: 5000, step: 0.5 },
      ...DRILL_DEPTH_PARAMS,
      { key: "peck", label: "Peck depth (0 = none)", unit: "mm", value: 0, min: 0, max: 150, step: 0.5 },
    ],
    generate(params) {
      const setup = commonSetup(params);
      const points = gridPoints(params);
      const options = drillOptions(params);
      const builder = new ProgramBuilder(this.title, setup);
      builder.approach(points[0].x, points[0].y);
      drillPattern(builder, points, options);
      builder.rapidZ(setup.clearZ);
      return builder.finish();
    },
  },
  {
    id: "drill-bolt-circle",
    title: "Drill bolt circle",
    group: "Drilling",
    description: "Drills equally spaced holes on a bolt circle.",
    params: [
      ...COMMON_PARAMS,
      { key: "centerX", label: "Center X", unit: "mm", value: 0, min: -10000, max: 10000, step: 0.1 },
      { key: "centerY", label: "Center Y", unit: "mm", value: 0, min: -10000, max: 10000, step: 0.1 },
      { key: "circleDiameter", label: "Bolt circle diameter", unit: "mm", value: 50, min: 0.2, max: 5000, step: 0.5 },
      { key: "holes", label: "Hole count", unit: "", value: 6, min: 1, max: 360, step: 1 },
      { key: "startAngle", label: "Start angle", unit: "deg", value: 0, min: -360, max: 360, step: 5 },
      ...DRILL_DEPTH_PARAMS,
      { key: "peck", label: "Peck depth (0 = none)", unit: "mm", value: 0, min: 0, max: 150, step: 0.5 },
    ],
    generate(params) {
      const setup = commonSetup(params);
      const points = boltCirclePoints(params);
      const options = drillOptions(params);
      const builder = new ProgramBuilder(this.title, setup);
      builder.approach(points[0].x, points[0].y);
      drillPattern(builder, points, options);
      builder.rapidZ(setup.clearZ);
      return builder.finish();
    },
  },
  {
    id: "drill-line",
    title: "Drill line",
    group: "Drilling",
    description: "Drills equally spaced holes along an angled line.",
    params: [
      ...COMMON_PARAMS,
      { key: "startX", label: "First hole X", unit: "mm", value: 0, min: -10000, max: 10000, step: 0.1 },
      { key: "startY", label: "First hole Y", unit: "mm", value: 0, min: -10000, max: 10000, step: 0.1 },
      { key: "holes", label: "Hole count", unit: "", value: 4, min: 1, max: 500, step: 1 },
      { key: "pitch", label: "Hole pitch", unit: "mm", value: 15, min: 0.01, max: 5000, step: 0.5 },
      { key: "angle", label: "Line angle", unit: "deg", value: 0, min: -360, max: 360, step: 5 },
      ...DRILL_DEPTH_PARAMS,
      { key: "peck", label: "Peck depth (0 = none)", unit: "mm", value: 0, min: 0, max: 150, step: 0.5 },
    ],
    generate(params) {
      const setup = commonSetup(params);
      const points = linePoints(params);
      const options = drillOptions(params);
      const builder = new ProgramBuilder(this.title, setup);
      builder.approach(points[0].x, points[0].y);
      drillPattern(builder, points, options);
      builder.rapidZ(setup.clearZ);
      return builder.finish();
    },
  },
  {
    id: "peck-drill",
    title: "Peck drill (deep hole)",
    group: "Drilling",
    description: "Full-retract peck drills one deep hole.",
    params: [
      ...COMMON_PARAMS,
      { key: "holeX", label: "Hole X", unit: "mm", value: 0, min: -10000, max: 10000, step: 0.1 },
      { key: "holeY", label: "Hole Y", unit: "mm", value: 0, min: -10000, max: 10000, step: 0.1 },
      ...DRILL_DEPTH_PARAMS,
      { key: "peck", label: "Peck depth", unit: "mm", value: 3, min: 0.1, max: 150, step: 0.5 },
    ],
    generate(params) {
      const setup = commonSetup(params);
      const holeX = requireNumber(params, "holeX", "Hole X", { min: -10000, max: 10000 });
      const holeY = requireNumber(params, "holeY", "Hole Y", { min: -10000, max: 10000 });
      const options = drillOptions(params);
      if (options.peck <= 0) throw new CycleParameterError("Peck depth must be positive for peck drilling.", "peck");
      const builder = new ProgramBuilder(this.title, setup);
      builder.approach(holeX, holeY);
      drillOnePoint(builder, { x: holeX, y: holeY }, options);
      builder.rapidZ(setup.clearZ);
      return builder.finish();
    },
  },
  {
    id: "counterbore",
    title: "Counterbore / spot face",
    group: "Drilling",
    description: "Plunges an end mill to depth with a bottom dwell for a clean seat.",
    params: [
      ...COMMON_PARAMS,
      { key: "holeX", label: "Bore X", unit: "mm", value: 0, min: -10000, max: 10000, step: 0.1 },
      { key: "holeY", label: "Bore Y", unit: "mm", value: 0, min: -10000, max: 10000, step: 0.1 },
      { key: "depth", label: "Counterbore depth", unit: "mm", value: 4, min: 0.05, max: 150, step: 0.1 },
      { key: "retract", label: "Retract above Z0", unit: "mm", value: 2, min: 0.5, max: 50, step: 0.5 },
      { key: "dwell", label: "Bottom dwell", unit: "s", value: 0.5, min: 0, max: 30, step: 0.1 },
    ],
    generate(params) {
      const setup = commonSetup(params);
      const holeX = requireNumber(params, "holeX", "Bore X", { min: -10000, max: 10000 });
      const holeY = requireNumber(params, "holeY", "Bore Y", { min: -10000, max: 10000 });
      const options = drillOptions(params, { dwellDefault: 0.5 });
      const builder = new ProgramBuilder(this.title, setup);
      builder.approach(holeX, holeY);
      drillOnePoint(builder, { x: holeX, y: holeY }, options);
      builder.rapidZ(setup.clearZ);
      return builder.finish();
    },
  },
  {
    id: "lathe-face",
    title: "Face (lathe)",
    group: "Turning",
    machine: "lathe",
    description: "Faces the end of round stock toward center in Z steps. X words are radii; Z0 is the finished face.",
    params: [
      ...LATHE_COMMON_PARAMS,
      { key: "stockDiameter", label: "Stock diameter", unit: "mm", value: 30, min: 0.5, max: 300, step: 0.5 },
      { key: "depth", label: "Total face depth", unit: "mm", value: 0.6, min: 0.02, max: 20, step: 0.1 },
      { key: "stepDown", label: "Depth per pass", unit: "mm", value: 0.2, min: 0.02, max: 3, step: 0.05 },
    ],
    generate(params) {
      const setup = latheSetup(params);
      const stockDiameter = requireNumber(params, "stockDiameter", "Stock diameter", { min: 0.5, max: 300 });
      const depth = requireNumber(params, "depth", "Face depth", { min: 0.02, max: 20 });
      const stepDown = requireNumber(params, "stepDown", "Depth per pass", { min: 0.02, max: 3 });
      const outsideX = stockDiameter / 2 + setup.clearX;
      const builder = new ProgramBuilder(this.title, setup, LATHE_BUILDER_OPTIONS);
      builder.latheApproach(outsideX);
      for (const z of depthPasses(depth, stepDown)) {
        builder.latheCutZ(z);
        builder.latheCutX(0);
        builder.rapidZ(z + 0.5);
        builder.latheRapidX(outsideX);
      }
      builder.rapidZ(setup.clearZ);
      return builder.finish();
    },
  },
  {
    id: "lathe-turn",
    title: "Turn OD (rough + finish)",
    group: "Turning",
    machine: "lathe",
    description: "Reduces a length of stock to a target diameter in radial passes, finishing at the target.",
    params: [
      ...LATHE_COMMON_PARAMS,
      { key: "stockDiameter", label: "Stock diameter", unit: "mm", value: 30, min: 0.5, max: 300, step: 0.5 },
      { key: "targetDiameter", label: "Target diameter", unit: "mm", value: 24, min: 0.2, max: 300, step: 0.1 },
      { key: "length", label: "Turned length (from face)", unit: "mm", value: 20, min: 0.1, max: 300, step: 0.5 },
      { key: "depthOfCut", label: "Radial depth per pass", unit: "mm", value: 0.5, min: 0.05, max: 3, step: 0.05 },
    ],
    generate(params) {
      const setup = latheSetup(params);
      const stockDiameter = requireNumber(params, "stockDiameter", "Stock diameter", { min: 0.5, max: 300 });
      const targetDiameter = requireNumber(params, "targetDiameter", "Target diameter", { min: 0.2, max: 300 });
      const length = requireNumber(params, "length", "Turned length", { min: 0.1, max: 300 });
      const depthOfCut = requireNumber(params, "depthOfCut", "Depth of cut", { min: 0.05, max: 3 });
      if (targetDiameter >= stockDiameter) {
        throw new CycleParameterError("Target diameter must be smaller than the stock diameter.", "targetDiameter");
      }
      const stockRadius = stockDiameter / 2;
      const targetRadius = targetDiameter / 2;
      const builder = new ProgramBuilder(this.title, setup, LATHE_BUILDER_OPTIONS);
      builder.latheApproach(stockRadius + setup.clearX);
      let radius = stockRadius;
      for (;;) {
        radius = Math.max(targetRadius, radius - depthOfCut);
        builder.latheRapidX(radius);
        builder.latheCutZ(-length);
        builder.latheRapidX(radius + 0.5);
        builder.rapidZ(setup.clearZ);
        if (radius <= targetRadius + 1e-9) break;
      }
      builder.latheRapidX(stockRadius + setup.clearX);
      return builder.finish();
    },
  },
  {
    id: "lathe-taper",
    title: "Taper / chamfer OD",
    group: "Turning",
    machine: "lathe",
    description: "Single finishing pass from one diameter at the face to another at depth. Rough close to size with Turn OD first.",
    params: [
      ...LATHE_COMMON_PARAMS,
      { key: "startDiameter", label: "Diameter at face (Z0)", unit: "mm", value: 20, min: 0.2, max: 300, step: 0.1 },
      { key: "endDiameter", label: "Diameter at end", unit: "mm", value: 24, min: 0.2, max: 300, step: 0.1 },
      { key: "length", label: "Taper length", unit: "mm", value: 5, min: 0.05, max: 300, step: 0.5 },
    ],
    generate(params) {
      const setup = latheSetup(params);
      const startDiameter = requireNumber(params, "startDiameter", "Start diameter", { min: 0.2, max: 300 });
      const endDiameter = requireNumber(params, "endDiameter", "End diameter", { min: 0.2, max: 300 });
      const length = requireNumber(params, "length", "Taper length", { min: 0.05, max: 300 });
      const builder = new ProgramBuilder(this.title, setup, LATHE_BUILDER_OPTIONS);
      builder.latheApproach(Math.max(startDiameter, endDiameter) / 2 + setup.clearX);
      builder.latheRapidX(startDiameter / 2);
      builder.latheCutZ(0);
      builder.latheCut(endDiameter / 2, -length);
      builder.latheRapidX(Math.max(startDiameter, endDiameter) / 2 + setup.clearX);
      builder.rapidZ(setup.clearZ);
      return builder.finish();
    },
  },
  {
    id: "lathe-groove",
    title: "Groove OD",
    group: "Turning",
    machine: "lathe",
    description: "Plunge-grooves to a floor diameter, stepping across for grooves wider than the insert.",
    params: [
      ...LATHE_COMMON_PARAMS,
      { key: "stockDiameter", label: "Stock diameter", unit: "mm", value: 24, min: 0.5, max: 300, step: 0.5 },
      { key: "grooveDiameter", label: "Groove floor diameter", unit: "mm", value: 18, min: 0.2, max: 300, step: 0.1 },
      { key: "zPosition", label: "Groove near edge Z (negative)", unit: "mm", value: -5, min: -300, max: -0.1, step: 0.5 },
      { key: "grooveWidth", label: "Groove width", unit: "mm", value: 3, min: 0.1, max: 50, step: 0.1 },
      { key: "peck", label: "Radial peck (0 = none)", unit: "mm", value: 1, min: 0, max: 10, step: 0.25 },
    ],
    generate(params) {
      const setup = latheSetup(params);
      const stockDiameter = requireNumber(params, "stockDiameter", "Stock diameter", { min: 0.5, max: 300 });
      const grooveDiameter = requireNumber(params, "grooveDiameter", "Groove diameter", { min: 0.2, max: 300 });
      const zPosition = requireNumber(params, "zPosition", "Groove Z", { min: -300, max: -0.1 });
      const grooveWidth = requireNumber(params, "grooveWidth", "Groove width", { min: 0.1, max: 50 });
      const peck = requireNumber(params, "peck", "Radial peck", { min: 0, max: 10 });
      if (grooveDiameter >= stockDiameter) {
        throw new CycleParameterError("Groove floor must be smaller than the stock diameter.", "grooveDiameter");
      }
      if (grooveWidth < setup.toolDiameter) {
        throw new CycleParameterError("Groove width cannot be narrower than the insert width.", "grooveWidth");
      }
      const outsideX = stockDiameter / 2 + setup.clearX;
      const floorRadius = grooveDiameter / 2;
      const builder = new ProgramBuilder(this.title, setup, LATHE_BUILDER_OPTIONS);
      builder.latheApproach(outsideX);
      const steps = Math.max(1, Math.ceil((grooveWidth - setup.toolDiameter) / (setup.toolDiameter * 0.8)) + 1);
      const zStep = steps > 1 ? (grooveWidth - setup.toolDiameter) / (steps - 1) : 0;
      for (let index = 0; index < steps; index += 1) {
        const z = zPosition - setup.toolDiameter / 2 - index * zStep;
        builder.rapidZ(z);
        if (peck > 0) {
          let reached = stockDiameter / 2;
          while (reached > floorRadius + 1e-9) {
            const next = Math.max(floorRadius, reached - peck);
            builder.latheCutX(next);
            reached = next;
            if (reached > floorRadius + 1e-9) builder.latheRapidX(outsideX);
          }
        } else {
          builder.latheCutX(floorRadius);
        }
        builder.latheRapidX(outsideX);
      }
      builder.rapidZ(setup.clearZ);
      return builder.finish();
    },
  },
  {
    id: "lathe-part",
    title: "Part off",
    group: "Turning",
    machine: "lathe",
    description: "Parting cut to center with radial pecks. The insert width sets where the part separates.",
    params: [
      ...LATHE_COMMON_PARAMS,
      { key: "stockDiameter", label: "Stock diameter", unit: "mm", value: 24, min: 0.5, max: 300, step: 0.5 },
      { key: "zPosition", label: "Part-line Z (negative)", unit: "mm", value: -25, min: -300, max: -0.1, step: 0.5 },
      { key: "peck", label: "Radial peck", unit: "mm", value: 1, min: 0.1, max: 10, step: 0.25 },
    ],
    generate(params) {
      const setup = latheSetup(params);
      const stockDiameter = requireNumber(params, "stockDiameter", "Stock diameter", { min: 0.5, max: 300 });
      const zPosition = requireNumber(params, "zPosition", "Part-line Z", { min: -300, max: -0.1 });
      const peck = requireNumber(params, "peck", "Radial peck", { min: 0.1, max: 10 });
      const outsideX = stockDiameter / 2 + setup.clearX;
      const builder = new ProgramBuilder(this.title, setup, LATHE_BUILDER_OPTIONS);
      builder.latheApproach(outsideX);
      builder.rapidZ(zPosition - setup.toolDiameter / 2);
      let reached = stockDiameter / 2;
      while (reached > 1e-9) {
        const next = Math.max(0, reached - peck);
        builder.latheCutX(next);
        reached = next;
        if (reached > 1e-9) builder.latheRapidX(outsideX);
      }
      builder.latheRapidX(outsideX);
      builder.rapidZ(setup.clearZ);
      return builder.finish();
    },
  },
  {
    id: "lathe-drill",
    title: "Center drill (lathe)",
    group: "Turning",
    machine: "lathe",
    description: "On-center drilling along Z with full-retract pecks. The drill lives in the tailstock-position toolpost.",
    params: [
      ...LATHE_COMMON_PARAMS,
      { key: "depth", label: "Hole depth", unit: "mm", value: 15, min: 0.1, max: 200, step: 0.5 },
      { key: "peck", label: "Peck depth (0 = none)", unit: "mm", value: 4, min: 0, max: 200, step: 0.5 },
    ],
    generate(params) {
      const setup = latheSetup(params);
      const depth = requireNumber(params, "depth", "Hole depth", { min: 0.1, max: 200 });
      const peck = requireNumber(params, "peck", "Peck depth", { min: 0, max: 200 });
      const builder = new ProgramBuilder(this.title, setup, LATHE_BUILDER_OPTIONS);
      builder.latheApproach(0);
      builder.rapidZ(1);
      if (peck > 0) {
        let reached = 0;
        while (reached > -depth + 1e-9) {
          const next = Math.max(-depth, reached - peck);
          if (reached < 0) builder.rapidZ(reached + 0.5);
          builder.plunge(next);
          reached = next;
          if (reached > -depth + 1e-9) builder.rapidZ(1);
        }
      } else {
        builder.plunge(-depth);
      }
      builder.rapidZ(setup.clearZ);
      return builder.finish();
    },
  },
  {
    id: "lathe-bore",
    title: "Bore ID (lathe)",
    group: "Turning",
    machine: "lathe",
    description: "Enlarges a pre-drilled hole to a target diameter in radial passes with a boring bar.",
    params: [
      ...LATHE_COMMON_PARAMS,
      { key: "holeDiameter", label: "Pre-drilled diameter", unit: "mm", value: 10, min: 0.5, max: 300, step: 0.1 },
      { key: "targetDiameter", label: "Target bore diameter", unit: "mm", value: 14, min: 0.5, max: 300, step: 0.1 },
      { key: "length", label: "Bore depth (from face)", unit: "mm", value: 12, min: 0.1, max: 300, step: 0.5 },
      { key: "depthOfCut", label: "Radial depth per pass", unit: "mm", value: 0.3, min: 0.05, max: 3, step: 0.05 },
    ],
    generate(params) {
      const setup = latheSetup(params);
      const holeDiameter = requireNumber(params, "holeDiameter", "Pre-drilled diameter", { min: 0.5, max: 300 });
      const targetDiameter = requireNumber(params, "targetDiameter", "Target diameter", { min: 0.5, max: 300 });
      const length = requireNumber(params, "length", "Bore depth", { min: 0.1, max: 300 });
      const depthOfCut = requireNumber(params, "depthOfCut", "Depth of cut", { min: 0.05, max: 3 });
      if (targetDiameter <= holeDiameter) {
        throw new CycleParameterError("Target bore must be larger than the pre-drilled hole.", "targetDiameter");
      }
      const startRadius = holeDiameter / 2;
      const targetRadius = targetDiameter / 2;
      const builder = new ProgramBuilder(this.title, setup, LATHE_BUILDER_OPTIONS);
      builder.latheApproach(Math.max(0.2, startRadius - 0.5));
      let radius = startRadius;
      for (;;) {
        radius = Math.min(targetRadius, radius + depthOfCut);
        builder.latheRapidX(radius);
        builder.latheCutZ(-length);
        builder.latheRapidX(Math.max(0.2, radius - 0.5));
        builder.rapidZ(setup.clearZ);
        if (radius >= targetRadius - 1e-9) break;
      }
      return builder.finish();
    },
  },
];

export function contractForCycle(cycle) {
  return (cycle?.machine ?? "mill") === "lathe" ? EMCO_LATHE_NC_CONTRACT : MR1_NC_CONTRACT;
}

// --- Program chaining --------------------------------------------------------
//
// Merges several conversational operations into one NC program. Transitions
// between operations follow the same strict contract as single programs:
// a tool change gets the full M5/G49/G53-retract/Tn/M0 sequence, a work-
// offset change gets a spindle-off retract break, and operations sharing
// tool + offset flow together with only S / coolant deltas injected. The
// merged program is re-validated by the machine's NC gate before it is
// returned - a merge bug can never hand out an unsafe program.

export const MAX_CHAIN_OPERATIONS = 12;

function chainSegments(gcode, setup) {
  const lines = gcode.split("\n");
  const bodyStart = 8 + (setup.coolant ? 1 : 0);
  const tailLength = 4 + (setup.coolant ? 1 : 0);
  if (!lines[3]?.startsWith("G53 G0 Z") || !/^T\d+$/.test(lines[4] ?? "")) {
    throw new CycleParameterError("Internal error: generated program skeleton was not recognized for chaining.");
  }
  return {
    toolBlock: lines.slice(3, bodyStart),
    body: lines.slice(bodyStart, lines.length - tailLength),
  };
}

// grblHAL comments do not nest, so comment text never carries parentheses,
// and the controller loader refuses realtime (! ? ~) and non-ASCII bytes.
function sanitizeComment(text) {
  return String(text).replace(/[()!?~]|[^\x20-\x7e]/g, "").toUpperCase();
}

export function generateConversationalChain(operations) {
  if (!Array.isArray(operations) || operations.length < 1) {
    throw new CycleParameterError("A program needs at least one operation.");
  }
  if (operations.length > MAX_CHAIN_OPERATIONS) {
    throw new CycleParameterError(`A program may contain at most ${MAX_CHAIN_OPERATIONS} operations.`);
  }
  const resolved = operations.map((operation, index) => {
    const cycle = getConversationalCycle(operation?.id);
    if (!cycle) throw new CycleParameterError(`Operation ${index + 1}: unknown cycle "${operation?.id}".`);
    try {
      const machine = cycle.machine ?? "mill";
      const setup = commonSetup(operation.params, machine === "lathe" ? LATHE_CAPS : MILL_CAPS);
      const { gcode } = generateConversationalProgram(cycle.id, operation.params);
      return { cycle, machine, setup, segments: chainSegments(gcode, setup) };
    } catch (error) {
      const reason = error instanceof CycleParameterError ? error.message : "generation failed";
      throw new CycleParameterError(`Operation ${index + 1} (${cycle.title}): ${reason}`, error instanceof CycleParameterError ? error.key : null);
    }
  });
  const machine = resolved[0].machine;
  if (resolved.some((operation) => operation.machine !== machine)) {
    throw new CycleParameterError("A program cannot mix mill and lathe operations.");
  }

  // The chain's own skeleton must carry the same machine conventions the
  // single-program builder uses: plane, lathe diameter mode, and that
  // machine's safe park.
  const isLathe = machine === "lathe";
  const safeZ = isLathe ? LATHE_BUILDER_OPTIONS.safeZ : SAFE_MACHINE_Z;
  const header = isLathe
    ? `G21 G90 G94 ${LATHE_BUILDER_OPTIONS.plane} ${LATHE_BUILDER_OPTIONS.latheMode} G40 G49 G80`
    : "G21 G90 G94 G17 G40 G49 G80";
  const lines = [
    `(MR1 CONVERSATIONAL PROGRAM - ${resolved.length} OPERATION${resolved.length === 1 ? "" : "S"})`,
    header,
    "G91.1",
  ];
  let current = null;
  for (const [index, operation] of resolved.entries()) {
    lines.push(`(OP ${index + 1}: ${sanitizeComment(operation.cycle.title)})`);
    const setup = operation.setup;
    if (!current) {
      lines.push(...operation.segments.toolBlock);
    } else if (current.tool !== setup.tool) {
      if (current.coolant) lines.push("M9");
      lines.push("M5", "G49", ...operation.segments.toolBlock);
    } else if (current.wcs !== setup.wcs) {
      // Same tool but a different work offset: break to a safe machine
      // retract before the frame changes so no move is made at an unknown
      // height in the new frame.
      if (current.coolant) lines.push("M9");
      lines.push("M5", `G53 G0 Z${fmt(safeZ)}`, setup.wcs, `S${Math.round(setup.rpm)} M3`);
      if (setup.coolant) lines.push("M8");
    } else {
      if (Math.round(setup.rpm) !== Math.round(current.rpm)) lines.push(`S${Math.round(setup.rpm)}`);
      if (setup.coolant && !current.coolant) lines.push("M8");
      if (!setup.coolant && current.coolant) lines.push("M9");
      // Each body opens with an XY approach at the current height, which is
      // the previous operation's clearance: rise first if this one needs more.
      if (setup.clearZ > current.clearZ) lines.push(`G0 Z${fmt(setup.clearZ)}`);
    }
    lines.push(...operation.segments.body);
    current = setup;
  }
  if (current.coolant) lines.push("M9");
  lines.push("M5", `G53 G0 Z${fmt(safeZ)}`, "M30", "");

  const gcode = lines.join("\n");
  const contract = contractForCycle(resolved[0].cycle);
  const verdict = validateMr1Nc(gcode, { name: "MR1_CONV_PROGRAM.NC", contract });
  if (!verdict.ok) {
    const first = verdict.blockers[0];
    throw new CycleParameterError(`The merged program failed the safety gate: ${first.code} at line ${first.line} - ${first.message}`);
  }
  return {
    name: "MR1_CONV_PROGRAM.NC",
    gcode,
    machine,
    operations: resolved.map((operation) => ({
      id: operation.cycle.id,
      title: operation.cycle.title,
      tool: operation.setup.tool,
    })),
  };
}

function generateRectContour(title, setup, params, side) {
  const centerX = requireNumber(params, "centerX", "Center X", { min: -10000, max: 10000 });
  const centerY = requireNumber(params, "centerY", "Center Y", { min: -10000, max: 10000 });
  const width = requireNumber(params, "width", "Width", { min: 0.2, max: 5000 });
  const height = requireNumber(params, "height", "Height", { min: 0.2, max: 5000 });
  const depth = requireNumber(params, "depth", "Profile depth", { min: 0.01, max: 150 });
  const stepDown = requireNumber(params, "stepDown", "Depth per pass", { min: 0.01, max: 10 });
  const offset = setup.toolDiameter / 2;
  let trackW;
  let trackH;
  if (side === "outside") {
    trackW = width + setup.toolDiameter;
    trackH = height + setup.toolDiameter;
  } else {
    trackW = width - setup.toolDiameter;
    trackH = height - setup.toolDiameter;
    if (trackW <= 0 || trackH <= 0) {
      throw new CycleParameterError("Tool diameter must be smaller than the window's smallest side.", "toolDiameter");
    }
  }
  const corners = rectanglePerimeter(centerX, centerY, trackW, trackH);
  const approach = side === "outside"
    ? { x: corners[0].x - offset * 2, y: corners[0].y - offset * 2 }
    : { x: centerX, y: centerY };
  const builder = new ProgramBuilder(title, setup);
  builder.approach(approach.x, approach.y);
  if (side === "inside") builder.rapidZ(0.5);
  let previousLevel = 0.5;
  for (const z of depthPasses(depth, stepDown)) {
    if (side === "outside") {
      // Outside the part the plunge is in open air.
      builder.plunge(z);
    } else {
      // Inside a window the center is solid: ramp down instead of plunging.
      const rampHalf = Math.min(trackW / 2, setup.toolDiameter * 2);
      builder.rampEntry(centerX, centerY, centerX + rampHalf, centerY, previousLevel, z);
    }
    builder.cut(corners[0].x, corners[0].y);
    traceRectangle(builder, corners, null);
    builder.cut(approach.x, approach.y);
    previousLevel = z;
  }
  builder.rapidZ(setup.clearZ);
  return builder.finish();
}

export function getConversationalCycle(id) {
  return CONVERSATIONAL_CYCLES.find((cycle) => cycle.id === id) ?? null;
}

export function defaultCycleParams(cycle) {
  const params = {};
  for (const spec of cycle.params) params[spec.key] = spec.value;
  return params;
}

export function generateConversationalProgram(id, params) {
  const cycle = getConversationalCycle(id);
  if (!cycle) throw new CycleParameterError(`Unknown conversational cycle "${id}".`);
  const gcode = cycle.generate(params);
  const name = `MR1_CONV_${id.replace(/-/g, "_").toUpperCase()}.NC`;
  return { name, gcode, cycle };
}

// Rough runtime estimate for the conversational dialect only (G0/G1/G2/G3
// with X/Y/Z, incremental I/J centers, F in mm/min, G4 P dwells). Rapids use
// a conservative shared rate; the result is a planning aid, not a promise.
const ESTIMATE_RAPID_MM_PER_MIN = 4000;

export function estimateProgramSeconds(gcode) {
  let x = 0;
  let y = 0;
  let z = 0;
  let feed = 0;
  let seconds = 0;
  for (const rawLine of String(gcode).split("\n")) {
    const line = rawLine.replace(/\(.*?\)/g, "").trim().toUpperCase();
    if (!line || line.startsWith("M") || line.startsWith("T")) continue;
    const words = {};
    for (const match of line.matchAll(/([A-Z])(-?\d+(?:\.\d+)?)/g)) {
      if (!(match[1] in words)) words[match[1]] = Number(match[2]);
    }
    if (words.G === 4 && Number.isFinite(words.P)) {
      seconds += words.P;
      continue;
    }
    if (words.G === 53) continue;
    if (Number.isFinite(words.F)) feed = words.F;
    const motion = [0, 1, 2, 3].includes(words.G) ? words.G : null;
    if (motion === null && !("X" in words) && !("Y" in words) && !("Z" in words)) continue;
    const targetX = Number.isFinite(words.X) ? words.X : x;
    const targetY = Number.isFinite(words.Y) ? words.Y : y;
    const targetZ = Number.isFinite(words.Z) ? words.Z : z;
    let distance;
    if (motion === 2 || motion === 3) {
      const radius = Math.hypot(words.I ?? 0, words.J ?? 0);
      // The generators only emit half or full-circle arc spans.
      distance = Math.PI * radius + Math.abs(targetZ - z);
    } else {
      distance = Math.hypot(targetX - x, targetY - y, targetZ - z);
    }
    const rate = motion === 0 ? ESTIMATE_RAPID_MM_PER_MIN : feed;
    if (distance > 0 && rate > 0) seconds += (distance / rate) * 60;
    x = targetX;
    y = targetY;
    z = targetZ;
  }
  return seconds;
}

export { CycleParameterError };
