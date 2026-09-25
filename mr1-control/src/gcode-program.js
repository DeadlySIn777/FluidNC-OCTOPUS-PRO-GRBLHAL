import Toolpath from "gcode-toolpath";
import { parseLine } from "./vendor/gcode-parser-browser.js";
import { coolantAccessoryMode, coordinatedRapidFeed, MR1_CONFIG } from "./machine-config.js";

const TWO_PI = Math.PI * 2;
const MAXIMUM_ARC_ANGLE = Math.PI / 12;
const MINIMUM_MOVE = 1e-7;
const MAX_SEGMENTS = 1_000_000;
const MACHINE_REFERENCE_CODES = new Set([28, 30, 53]);
const UNSUPPORTED_CUTTER_COMPENSATION = new Map([
  [41, "G41 cutter compensation"],
  [41.1, "G41.1 dynamic cutter compensation"],
  [42, "G42 cutter compensation"],
  [42.1, "G42.1 dynamic cutter compensation"],
]);
const UNSUPPORTED_TRANSFORMS = new Map([
  [10, "G10 coordinate-table programming"],
  [51, "G51 scaling"],
  [52, "G52 local coordinate offsets"],
  [68, "G68 coordinate rotation"],
  [90.1, "G90.1 absolute arc centers"],
]);
const UNSUPPORTED_MOTION = new Map([
  [5, "G5 spline motion"],
  [5.1, "G5.1 spline motion"],
  [33, "G33 spindle-synchronized motion"],
  [33.1, "G33.1 rigid tapping"],
]);

function clonePoint(point) {
  return { x: point.x, y: point.y, z: point.z };
}

function canonicalToMachine(point, plane) {
  if (plane === "G18") return { x: point.y, y: point.z, z: point.x };
  if (plane === "G19") return { x: point.z, y: point.x, z: point.y };
  return clonePoint(point);
}

function arcPoints(modal, start, end, center, chordTolerance = 0.08) {
  const radius = Math.hypot(start.x - center.x, start.y - center.y);
  if (!Number.isFinite(radius) || radius < MINIMUM_MOVE) return null;

  const endRadius = Math.hypot(end.x - center.x, end.y - center.y);
  if (!Number.isFinite(endRadius) || Math.abs(endRadius - radius) > Math.max(0.2, radius * 0.01)) {
    return null;
  }

  const clockwise = modal.motion === "G2";
  const startAngle = Math.atan2(start.y - center.y, start.x - center.x);
  const endAngle = Math.atan2(end.y - center.y, end.x - center.x);
  let sweep = endAngle - startAngle;

  if (clockwise) {
    while (sweep >= -1e-10) sweep -= TWO_PI;
  } else {
    while (sweep <= 1e-10) sweep += TWO_PI;
  }

  const chordAngle = 2 * Math.acos(Math.max(-1, 1 - Math.min(chordTolerance / radius, 2)));
  const maximumAngle = Math.min(
    MAXIMUM_ARC_ANGLE,
    Math.max(Math.PI / 180, Number.isFinite(chordAngle) ? chordAngle : Math.PI / 36),
  );
  const arcLength = Math.abs(sweep) * radius;
  const steps = Math.min(
    4096,
    Math.max(8, Math.ceil(Math.abs(sweep) / maximumAngle), Math.ceil(arcLength / 2.5)),
  );

  const points = [clonePoint(start)];
  for (let index = 1; index <= steps; index += 1) {
    const progress = index / steps;
    const angle = startAngle + sweep * progress;
    points.push({
      x: center.x + Math.cos(angle) * radius,
      y: center.y + Math.sin(angle) * radius,
      z: start.z + (end.z - start.z) * progress,
    });
  }
  points[points.length - 1] = clonePoint(end);
  return points;
}

function unitScale(units) {
  return units === "G20" ? 25.4 : 1;
}

const MOTION_ONLY_WORDS = new Set(["X", "Y", "Z", "A", "B", "C", "U", "V", "W", "I", "J", "K", "R", "F", "N"]);

// Everything a block does besides work-coordinate motion and feed rate
// (dwell, spindle, coolant, tool, stops, offsets and other modes), in a
// normalized form. Machine-reference blocks keep their axis words because
// that motion is hidden from the segment list.
function controlSignature(parsed) {
  const machineReference = parsed.words.some(([letter, value]) => letter === "G" && MACHINE_REFERENCE_CODES.has(value));
  const words = parsed.words.filter(([letter, value]) => machineReference
    || !(MOTION_ONLY_WORDS.has(letter) || (letter === "G" && [0, 1, 2, 3].includes(value))));
  return [...words.map(([letter, value]) => `${letter}${value}`), ...(parsed.cmds ?? [])].join(" ");
}

// gcode-toolpath attaches axis words to the most recent G/M/T word on the
// block and silently discards them when that word is not a motion code, so a
// block like "G54 X10" previews as no motion while a real controller moves.
function axisWordsMayBeDropped(words) {
  let dropping = false;
  for (const [letter, value] of words) {
    if (letter === "G") {
      dropping = !(value === 0 || value === 1 || value === 2 || value === 3 || value === 53);
    } else if (letter === "M" || letter === "T") {
      dropping = true;
    } else if ((letter === "X" || letter === "Y" || letter === "Z") && dropping) {
      return true;
    }
  }
  return false;
}

function blockMetadata(parsed, state, warnings) {
  const unsupportedAxis = parsed.words.find(([letter]) => ["A", "B", "C", "U", "V", "W"].includes(letter));
  if (unsupportedAxis) {
    throw new Error(`${unsupportedAxis[0]}-axis motion is not supported by the three-axis MR-1 preview.`);
  }

  for (const [letter, value] of parsed.words) {
    if (letter !== "G") continue;
    if (UNSUPPORTED_CUTTER_COMPENSATION.has(value)) {
      throw new Error(
        `${UNSUPPORTED_CUTTER_COMPENSATION.get(value)} is unavailable on grblHAL; `
        + "repost from Fusion with Compensation Type = In Computer.",
      );
    }
    if (UNSUPPORTED_TRANSFORMS.has(value)) {
      throw new Error(`${UNSUPPORTED_TRANSFORMS.get(value)} must be resolved by the postprocessor before preview.`);
    }
    if (UNSUPPORTED_MOTION.has(value)) {
      throw new Error(`${UNSUPPORTED_MOTION.get(value)} cannot be represented by the MR-1 preview.`);
    }
    if (value === 20) state.units = "G20";
    if (value === 21) state.units = "G21";
    if (value === 93) state.feedMode = "G93";
    if (value === 94) state.feedMode = "G94";
    if (value === 95) state.feedMode = "G95";
    if (value === 4) warnings.add("G4 dwell time is excluded from the preview estimate.");
    if (value === 73 || value === 74 || value === 76 || (value >= 81 && value <= 89)) {
      throw new Error(`Canned cycle G${value} must be posted as expanded motion for preview.`);
    }
    if (value >= 38.2 && value <= 38.5) {
      warnings.add("G38 probe motion is hidden from the cutting-path preview.");
    }
    if (value >= 54 && value <= 59) {
      state.activeWorkOffset = `G${value}`;
      state.workOffsets.add(state.activeWorkOffset);
    }
    if (value === 54.1 || value === 59.1 || value === 59.2 || value === 59.3) {
      state.workOffsets.add(`G${value}`);
      warnings.add("Extended work offsets are shown at one shared preview origin.");
    }
  }

  if (!state.droppedAxisWarned && axisWordsMayBeDropped(parsed.words)) {
    state.droppedAxisWarned = true;
    warnings.add("Axis words attached to a non-motion code are dropped by the preview but would move a real controller; repost with motion codes leading each block.");
  }

  for (const [letter, value] of parsed.words) {
    if (letter === "F" && Number.isFinite(value) && value > 0) {
      state.feedRaw = value;
      // Convert at the F word like grblHAL does: a later G20/G21 must not
      // retroactively rescale an already-programmed feed.
      state.feedMm = value * unitScale(state.units);
      state.feedProgrammed = true;
    }
    if (letter === "S" && Number.isFinite(value) && value >= 0) {
      state.programmedSpindle = value;
      state.maximumSpindle = Math.max(state.maximumSpindle, value);
    }
    if (letter === "T" && Number.isFinite(value)) state.tool = value;
    if (letter === "M" && (value === 3 || value === 4)) state.spindleOn = true;
    if (letter === "M" && value === 5) state.spindleOn = false;
    if (letter === "M" && value === 7) state.coolant.mist = true;
    if (letter === "M" && value === 8) state.coolant.flood = true;
    if (letter === "M" && value === 9) state.coolant = { flood: false, mist: false };
    if (letter === "M" && value >= 97 && value <= 99) {
      throw new Error(`Subprogram control M${value} must be expanded before preview.`);
    }
  }

  if (parsed.err) warnings.add("A source line contained an invalid checksum.");
  return {
    feedMode: state.feedMode,
    feedRaw: state.feedRaw,
    feed: state.feedMm,
    feedProgrammed: state.feedProgrammed,
    spindle: state.spindleOn ? state.programmedSpindle : 0,
    programmedSpindle: state.programmedSpindle,
    tool: state.tool,
    workOffset: state.activeWorkOffset,
    coolant: coolantAccessoryMode(state.coolant),
  };
}

function effectiveCutFeed(context, warnings) {
  if (context.feedMode === "G95") {
    if (context.programmedSpindle <= 0) {
      warnings.add("G95 feed-per-revolution motion had no programmed spindle speed.");
      return 1;
    }
    return Math.max(1, context.feed * context.programmedSpindle);
  }
  if (!context.feedProgrammed) {
    warnings.add("Cutting motion before any F word: grblHAL rejects this (error 22); the preview assumes 500 mm/min.");
  }
  return Math.max(1, context.feed || 500);
}

function finalizeSegments(segments, warnings) {
  const inverseTimeBlocks = new Map();
  for (const segment of segments) {
    if (segment.feedMode !== "G93") continue;
    const block = inverseTimeBlocks.get(segment.sourceLine) ?? { distance: 0, segments: [] };
    block.distance += segment.distance;
    block.segments.push(segment);
    inverseTimeBlocks.set(segment.sourceLine, block);
  }

  for (const block of inverseTimeBlocks.values()) {
    const inverseFeed = block.segments[0].inverseTimeFeed;
    if (!Number.isFinite(inverseFeed) || inverseFeed <= 0) {
      warnings.add("G93 inverse-time motion had no valid F value.");
      continue;
    }
    const blockSeconds = 60 / inverseFeed;
    for (const segment of block.segments) {
      segment.durationOverride = block.distance > 0
        ? blockSeconds * (segment.distance / block.distance)
        : 0;
    }
  }

  let elapsedSeconds = 0;
  for (const segment of segments) {
    segment.duration = segment.durationOverride
      ?? (segment.distance / Math.max(1, segment.feed)) * 60;
    segment.startTime = elapsedSeconds;
    elapsedSeconds += segment.duration;
    segment.endTime = elapsedSeconds;
    delete segment.durationOverride;
    delete segment.inverseTimeFeed;
    delete segment.feedMode;
  }
  return elapsedSeconds;
}

export function parseGcodeProgram(source, options = {}) {
  const name = String(options.name || "LOADED_PROGRAM.NC").trim() || "LOADED_PROGRAM.NC";
  const sourceLines = String(source).replace(/\r\n?/g, "\n").split("\n");
  const segments = [];
  const warnings = new Set();
  const state = {
    units: "G21",
    feedMode: "G94",
    feedRaw: 500,
    feedMm: 500,
    feedProgrammed: false,
    droppedAxisWarned: false,
    programmedSpindle: 0,
    maximumSpindle: 0,
    spindleOn: false,
    tool: 0,
    coolant: { flood: false, mist: false },
    activeWorkOffset: "G54",
    workOffsets: new Set(),
  };
  let context = {
    sourceLine: 1,
    feedMode: "G94",
    feedRaw: 500,
    feed: 500,
    feedProgrammed: false,
    spindle: 0,
    programmedSpindle: 0,
    tool: 0,
    workOffset: "G54",
    coolant: "off",
  };
  const stats = { arcs: 0, cuts: 0, rapids: 0 };
  const controlBlocks = [];
  let discontinuity = false;
  let previousMotionWorkOffset = "G54";

  const pushSegment = (modal, from, to, operation, canonicalPlane = false) => {
    const machineFrom = canonicalPlane ? canonicalToMachine(from, modal.plane) : clonePoint(from);
    const machineTo = canonicalPlane ? canonicalToMachine(to, modal.plane) : clonePoint(to);
    const distance = Math.hypot(
      machineTo.x - machineFrom.x,
      machineTo.y - machineFrom.y,
      machineTo.z - machineFrom.z,
    );
    if (distance <= MINIMUM_MOVE) return;
    if (segments.length >= MAX_SEGMENTS) {
      throw new Error(`Program exceeds the ${MAX_SEGMENTS.toLocaleString()} segment preview limit.`);
    }

    const rapid = modal.motion === "G0";
    // The machine cannot exceed its per-axis rate limits even when the
    // program asks for more; clamp cut feeds the same way so preview timing
    // does not run faster than the real machine.
    const axisLimit = coordinatedRapidFeed(machineFrom, machineTo);
    const cutFeed = rapid ? 0 : Math.min(effectiveCutFeed(context, warnings), axisLimit);
    if (!rapid && cutFeed < effectiveCutFeed(context, warnings) - 0.01) {
      warnings.add("Programmed feed exceeds the machine's axis rate limits; preview times use the machine-limited rate.");
    }
    const segment = {
      from: machineFrom,
      to: machineTo,
      type: rapid ? "rapid" : "cut",
      feed: rapid ? axisLimit : cutFeed,
      operation,
      sourceLine: context.sourceLine,
      distance,
      spindle: context.spindle,
      tool: context.tool || modal.tool || 0,
      feedMode: rapid ? "G94" : context.feedMode,
      inverseTimeFeed: context.feedRaw,
      fromWorkOffset: previousMotionWorkOffset,
      workOffset: context.workOffset,
      coolant: context.coolant,
    };
    segments.push(segment);
    previousMotionWorkOffset = context.workOffset;
    if (rapid) stats.rapids += 1;
    else stats.cuts += 1;
  };

  const toolpath = new Toolpath({
    position: options.position ?? { x: 0, y: 0, z: 0 },
    addLine: (modal, from, to) => {
      if (discontinuity) {
        discontinuity = false;
        previousMotionWorkOffset = context.workOffset;
        warnings.add("The first work move after hidden machine motion is omitted from the path.");
        return;
      }
      pushSegment(modal, from, to, modal.motion.toLowerCase());
    },
    addArcCurve: (modal, from, to, center) => {
      if (discontinuity) {
        discontinuity = false;
        previousMotionWorkOffset = context.workOffset;
        warnings.add("The first work move after hidden machine motion is omitted from the path.");
        return;
      }
      const points = arcPoints(modal, from, to, center);
      if (!points) {
        warnings.add(`Invalid ${modal.motion} arc on source line ${context.sourceLine}; shown as a line.`);
        pushSegment(modal, from, to, `${modal.motion.toLowerCase()}-fallback`, true);
        return;
      }
      stats.arcs += 1;
      for (let index = 1; index < points.length; index += 1) {
        pushSegment(modal, points[index - 1], points[index], modal.motion.toLowerCase(), true);
      }
    },
  });

  for (let index = 0; index < sourceLines.length; index += 1) {
    const line = sourceLines[index];
    const parsed = parseLine(line, { lineMode: "stripped" });
    if (parsed.line.includes("#")) {
      throw new Error("Parameterized G-code must be resolved to numeric motion before preview.");
    }
    if (parsed.words.length === 0 && !parsed.cmds) continue;
    const control = controlSignature(parsed);
    if (control) controlBlocks.push({ segment: segments.length, line: index + 1, words: control });
    context = {
      sourceLine: index + 1,
      ...blockMetadata(parsed, state, warnings),
    };

    const machineReference = parsed.words.find(
      ([letter, value]) => letter === "G" && MACHINE_REFERENCE_CODES.has(value),
    );
    if (machineReference) {
      warnings.add(`G${machineReference[1]} machine-reference motion is hidden from the work-coordinate preview.`);
      const modal = {};
      for (const [letter, value] of parsed.words) {
        if (letter !== "G") continue;
        if (value >= 0 && value <= 3) modal.motion = `G${value}`;
        if (value >= 17 && value <= 19) modal.plane = `G${value}`;
        if (value === 20 || value === 21) modal.units = `G${value}`;
        if (value === 90 || value === 91) modal.distance = `G${value}`;
        if (value === 91.1) modal.arc = "G91.1";
        if (value >= 54 && value <= 59) modal.wcs = `G${value}`;
      }
      toolpath.setModal(modal);
      discontinuity = true;
      continue;
    }
    toolpath.loadFromStringSync(line);
  }

  if (segments.length === 0) throw new Error("No supported motion was found in this program.");
  const duration = finalizeSegments(segments, warnings);
  const minimum = { x: Infinity, y: Infinity, z: Infinity };
  const maximum = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (const segment of segments) {
    for (const point of [segment.from, segment.to]) {
      minimum.x = Math.min(minimum.x, point.x);
      minimum.y = Math.min(minimum.y, point.y);
      minimum.z = Math.min(minimum.z, point.z);
      maximum.x = Math.max(maximum.x, point.x);
      maximum.y = Math.max(maximum.y, point.y);
      maximum.z = Math.max(maximum.z, point.z);
    }
  }
  const span = {
    x: maximum.x - minimum.x,
    y: maximum.y - minimum.y,
    z: maximum.z - minimum.z,
  };
  const outsideTravel = span.x > MR1_CONFIG.usableTravel.x + 0.01
    || span.y > MR1_CONFIG.usableTravel.y + 0.01
    || span.z > MR1_CONFIG.usableTravel.z + 0.01;
  if (outsideTravel) warnings.add("Program span exceeds the configured MR-1 travel envelope.");

  return {
    name,
    segments,
    duration,
    spindle: state.maximumSpindle,
    bounds: { min: minimum, max: maximum },
    span,
    lineCount: sourceLines.length,
    warnings: [...warnings],
    outsideTravel,
    stats,
    controlBlocks,
    source: "file",
  };
}
