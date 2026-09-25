import { parseLine } from "./vendor/gcode-parser-browser.js";

export const MR1_NC_CONTRACT = Object.freeze({
  version: "1.0.0",
  machineKind: "mill",
  requiredPlane: 17,
  forbiddenAxisWords: Object.freeze([]),
  maximumSpindleRpm: 8000,
  maximumLinearFeedMmPerMinute: 2540,
  maximumZFeedMmPerMinute: 1016,
  safeMachineZMm: -2,
});

// EMCO 120P lathe profile: XZ plane, no Y axis, radius-programmed X.
// Ceilings and travel come from the retrofit's own commissioned LinuxCNC
// configuration (emco120p/emco120p_professional.ini): MAX_SPINDLE_0_SPEED
// 2400 RPM (itself capped below the OEM 4000 until the 1:1 encoder drive is
// proved), MAX_LINEAR_VELOCITY 50 mm/s, X 0-55 mm radius, Z 0-172 mm.
export const EMCO_LATHE_NC_CONTRACT = Object.freeze({
  version: "1.2.0",
  machineKind: "lathe",
  requiredPlane: 18,
  forbiddenAxisWords: Object.freeze(["Y"]),
  maximumSpindleRpm: 2400,
  // The machine's feed rating (ORIGINAL_MAX_FEED_MM_MIN 2000), not its rapid
  // velocity: a programmed G1 feed may not exceed what the machine is rated
  // to cut at.
  maximumLinearFeedMmPerMinute: 2000,
  maximumZFeedMmPerMinute: 2000,
  // Machine Z runs 0 to 172 with home/park at 171.5 (retracted away from the
  // chuck). The mill's Z-2 park is outside this machine's travel entirely.
  safeMachineZMm: 171.5,
  // The EMCO interpreter starts in G7 DIAMETER mode (RS274NGC_STARTUP_CODE,
  // marked "do not silently change this to G8"), so an X word is a diameter.
  // Programs must declare it explicitly rather than inherit it.
  requiredLatheMode: 7,
  // Machine travel is X 0-55 mm and Z 0-172 mm in MACHINE coordinates.
  // Programs are written in work coordinates through an unknown G54 offset,
  // so the gate deliberately does NOT compare program targets against those
  // limits; soft-limit enforcement belongs to the controller, which knows
  // the offset. Recorded here as machine facts only.
  machineTravelMm: Object.freeze({
    x: Object.freeze({ min: 0, max: 55 }),
    z: Object.freeze({ min: 0, max: 172 }),
  }),
  // Spindle-synchronized motion (G33 threading) stays locked until the 1:1
  // spindle encoder passes its bench qualification: identity, rigid mount,
  // signal integrity, and count-vs-RPM agreement. Flipping this flag is a
  // commissioning decision, never a convenience.
  spindleSyncQualified: false,
  maximumThreadPitchMm: 6,
});

// Test/commissioning variant: the same lathe with the encoder qualified.
// Exists so the G33 rules are provable today; production code paths must
// keep using EMCO_LATHE_NC_CONTRACT until the physical evidence lands.
export const EMCO_LATHE_SYNC_NC_CONTRACT = Object.freeze({
  ...EMCO_LATHE_NC_CONTRACT,
  spindleSyncQualified: true,
});

const ALLOWED_G_CODES = new Set([
  0, 1, 2, 3, 4,
  7, 8,
  17, 18, 19, 20, 21,
  40, 49,
  53, 54, 55, 56, 57, 58, 59,
  80, 90, 91.1, 94,
]);
const ALLOWED_M_CODES = new Set([0, 1, 3, 5, 8, 9, 30]);
const MOTION_CODES = new Set([0, 1, 2, 3]);
const WORK_OFFSETS = new Set([54, 55, 56, 57, 58, 59]);
const INITIAL_MODAL_KEYS = Object.freeze(["absolute", "feedPerMinute", "plane", "units", "compOff", "lengthOff", "cyclesOff"]);
const LATHE_MODAL_KEY = "latheMode";
const AXIS_WORDS = new Set(["X", "Y", "Z"]);
const ROTARY_WORDS = new Set(["A", "B", "C", "U", "V", "W"]);
const SAFE_NON_AXIS_WORDS = new Set(["G", "M", "N", "F", "S", "T", "X", "Y", "Z", "I", "J", "K", "P"]);
const STRICT_BLOCK_PATTERN = /^(?:N\d+)?(?:[A-Z][+-]?(?:\d+(?:\.\d*)?|\.\d+))+(?:\*\d+)?$/i;
const G_MODAL_GROUPS = [[0, 1, 2, 3, 33, 80], [4, 53], [17, 18, 19], [20, 21], [90], [91.1], [94], [40], [49], [54, 55, 56, 57, 58, 59]];
const M_MODAL_GROUPS = [[0, 1, 30], [3, 5], [8, 9]];

function issue(line, code, message, source = "") {
  return { line, code, message, source };
}

function hasCode(words, letter, value) {
  return words.some(([wordLetter, wordValue]) => wordLetter === letter && wordValue === value);
}

function valuesFor(words, letter) {
  return words.filter(([wordLetter]) => wordLetter === letter).map(([, value]) => value);
}

function unitScale(units) {
  return units === "G20" ? 25.4 : 1;
}

function approximately(actual, expected, tolerance) {
  return Math.abs(actual - expected) <= tolerance;
}

function executableSource(parsed) {
  return String(parsed.line ?? "").trim();
}

function motionTarget(position, words, scale) {
  const xValues = valuesFor(words, "X");
  const yValues = valuesFor(words, "Y");
  const zValues = valuesFor(words, "Z");
  return {
    x: xValues.length ? xValues[0] * scale : position.x,
    y: yValues.length ? yValues[0] * scale : position.y,
    z: zValues.length ? zValues[0] * scale : position.z,
  };
}

function positionKnown(position) {
  return position.x !== null && position.y !== null && position.z !== null;
}

function commentSyntaxIsBalanced(source) {
  let depth = 0;
  for (const character of String(source)) {
    if (character === ";" && depth === 0) break;
    if (character === "(") depth += 1;
    if (character === ")") depth -= 1;
    if (depth < 0) return false;
  }
  return depth === 0;
}

export function validateMr1Nc(source, options = {}) {
  const name = String(options.name || "PROGRAM.NC");
  const contract = options.contract ?? MR1_NC_CONTRACT;
  const nativeMr1 = contract.machineKind !== "lathe";
  // Explicit review mode only. The sender must independently bind a dry-run
  // program to an air-run authorization; validation grants no motion permission.
  const airRun = options.allowSpindleOffMotion === true;
  const requiredPlane = contract.requiredPlane ?? 17;
  const requiredLatheMode = contract.requiredLatheMode ?? null;
  const requiredModalKeys = requiredLatheMode
    ? [...INITIAL_MODAL_KEYS, LATHE_MODAL_KEY]
    : INITIAL_MODAL_KEYS;
  const forbiddenAxis = new Set(contract.forbiddenAxisWords ?? []);
  const lines = String(source ?? "").replace(/\r\n?/g, "\n").split("\n");
  const blockers = [];
  const warnings = [];
  const state = {
    units: null,
    distance: null,
    feedMode: null,
    plane: null,
    motion: null,
    workOffset: null,
    spindleSpeed: null,
    feedMmPerMinute: null,
    tool: null,
    spindleOn: false,
    coolantOn: false,
    spindleOffExplicit: false,
    coolantOffExplicit: false,
    pendingToolStop: false,
    g49AvailableForTool: false,
    seenM30: false,
    seenExecutable: false,
    seenWorkMotion: false,
    lastWorkMotionLine: 0,
    lastMachineRetractLine: 0,
    lastExecutableLine: 0,
    // Work-coordinate position tracking (absolute G90 only; G91 is outside
    // the contract). null = not yet established on that axis.
    position: { x: null, y: null, z: null },
    modalReady: {
      absolute: false,
      feedPerMinute: false,
      plane: false,
      units: false,
      compOff: false,
      lengthOff: false,
      cyclesOff: false,
      [LATHE_MODAL_KEY]: false,
    },
  };
  let maximumSpindleRpm = 0;
  let maximumFeedMmPerMinute = 0;
  let toolChanges = 0;
  let workMotionBlocks = 0;
  let machineRetracts = 0;

  const block = (lineNumber, code, message, lineSource = "") => {
    blockers.push(issue(lineNumber, code, message, lineSource));
  };

  for (let index = 0; index < lines.length; index += 1) {
    const lineNumber = index + 1;
    const parsed = parseLine(lines[index], { lineMode: "stripped" });
    const lineSource = executableSource(parsed);
    const upperOriginal = lines[index].toUpperCase();

    if (upperOriginal.includes("MR1 POST BLOCKED")) {
      block(lineNumber, "POST_BLOCK_MARKER", "The postprocessor explicitly blocked this program.", lines[index].trim());
    }
    if (!commentSyntaxIsBalanced(lines[index])) {
      block(lineNumber, "MALFORMED_COMMENT", "Parenthesized comments must be balanced on the same source line.", lines[index].trim());
    }
    if (!lineSource && !(parsed.cmds?.length)) continue;
    state.seenExecutable = true;
    state.lastExecutableLine = lineNumber;

    if (state.seenM30) {
      block(lineNumber, "AFTER_PROGRAM_END", "Executable content appears after M30.", lineSource);
      continue;
    }
    if (lineSource.includes("#") || lineSource.includes("[")) {
      block(lineNumber, "PARAMETERIZED_CODE", "Macros and parameter expressions must be resolved before machine use.", lineSource);
    }
    const compactSource = lineSource.replace(/\s+/g, "");
    const malformedBlock = compactSource && !STRICT_BLOCK_PATTERN.test(compactSource);
    if (malformedBlock) {
      block(lineNumber, "MALFORMED_BLOCK", "Executable text must contain only complete numeric NC words.", lineSource);
    }
    if (parsed.cmds?.length) {
      block(lineNumber, "CONTROLLER_COMMAND", "Percent, dollar, and brace commands are outside the MR-1 NC contract.", lineSource);
    }
    if (parsed.err) {
      block(lineNumber, "INVALID_CHECKSUM", "The source line has an invalid checksum.", lineSource);
    }
    if (nativeMr1 && parsed.cs !== undefined) {
      block(lineNumber, "UNSUPPORTED_CHECKSUM", "The MR1 firmware does not accept executable checksum suffixes; export plain NC blocks.", lineSource);
    }
    if (malformedBlock) continue;

    const words = parsed.words;
    const gCodes = valuesFor(words, "G");
    const mCodes = valuesFor(words, "M");
    const axisWords = words.filter(([letter]) => AXIS_WORDS.has(letter));
    const rotaryWords = words.filter(([letter]) => ROTARY_WORDS.has(letter));
    const unsupportedWords = words.filter(([letter]) => !SAFE_NON_AXIS_WORDS.has(letter) && !ROTARY_WORDS.has(letter));
    if (nativeMr1) {
      const letters = new Set(words.map(([letter]) => letter));
      for (const letter of letters) if (!["G", "M"].includes(letter)
        && valuesFor(words, letter).length + (letter === "N" && parsed.ln !== undefined ? 1 : 0) > 1) {
        block(lineNumber, "DUPLICATE_WORD", `${letter} may appear only once in a block.`, lineSource);
      }
      for (const [letter, codes, groups] of [["G", gCodes, G_MODAL_GROUPS], ["M", mCodes, M_MODAL_GROUPS]]) {
        if (groups.some(group => codes.filter(code => group.includes(code)).length > 1)) {
          block(lineNumber, "MODAL_GROUP_CONFLICT", `${letter} commands from the same modal group cannot share a block.`, lineSource);
        }
      }
      if (words.some(([, value]) => typeof value !== "number" || !Number.isFinite(Math.fround(value)))) {
        block(lineNumber, "NUMERIC_RANGE", "Every NC value must be finite in the controller's numeric format.", lineSource);
      }
      // grblHAL executes program flow last, after spindle, coolant and motion.
      // A same-block M0 is not a barrier in front of those commands.
      if (mCodes.some(code => code === 0 || code === 1)
        && (mCodes.length !== 1 || words.some(([letter]) => !["M", "T", "N"].includes(letter)))) {
        block(lineNumber, "PAUSE_BLOCK_CONFLICT", "M0/M1 must be separate from motion, spindle, coolant and modal changes; only a tool word may share the pause block.", lineSource);
      }
      if (hasCode(words, "G", 4)) {
        const dwell = valuesFor(words, "P");
        if (dwell.length !== 1 || !Number.isFinite(dwell[0]) || dwell[0] < 0 || dwell[0] > 3600) {
          block(lineNumber, "DWELL_RANGE", "Dwell G4 requires one P duration between 0 and 3600 seconds.", lineSource);
        }
      }
    }

    for (const [letter] of rotaryWords) {
      block(lineNumber, "ROTARY_AXIS", `${letter}-axis words are not commissioned on this three-axis MR-1.`, lineSource);
    }
    for (const [letter] of axisWords) {
      if (forbiddenAxis.has(letter)) {
        block(lineNumber, "AXIS_NOT_PRESENT", `${letter}-axis words do not exist on this ${contract.machineKind ?? "machine"} profile.`, lineSource);
      }
    }
    for (const [letter] of unsupportedWords) {
      block(lineNumber, "UNSUPPORTED_WORD", `${letter} words are outside the MR-1 NC contract.`, lineSource);
    }
    for (const code of gCodes) {
      if (code === 33) {
        // Spindle-synchronized threading is only inside the contract once
        // the 1:1 spindle encoder is bench-qualified and commissioned.
        if (contract.spindleSyncQualified !== true) {
          block(lineNumber, "SPINDLE_SYNC_NOT_QUALIFIED", "G33 requires a commissioned spindle encoder; spindle-synchronized motion is not qualified on this machine.", lineSource);
        }
        continue;
      }
      if (!Number.isFinite(code) || !ALLOWED_G_CODES.has(code)) {
        block(lineNumber, "UNSUPPORTED_G_CODE", `G${code} is outside the qualified MR-1 NC subset.`, lineSource);
      }
    }
    if (gCodes.filter((code) => MOTION_CODES.has(code) || code === 33).length > 1) {
      block(lineNumber, "CONFLICTING_MOTION", "A block may select only one of G0/G1/G2/G3/G33.", lineSource);
    }
    for (const code of mCodes) {
      if (airRun && [3, 4, 7, 8].includes(code)) {
        block(lineNumber, "AIR_RUN_ACCESSORY_ON", "Air-run programs cannot start the spindle or coolant.", lineSource);
      }
      if (!Number.isFinite(code) || !ALLOWED_M_CODES.has(code)) {
        const detail = code === 4
          ? "Reverse spindle M4 is not commissioned."
          : code === 6
            ? "Automatic tool change M6 is forbidden; use Tn followed by M0."
            : `M${code} is outside the qualified MR-1 NC subset.`;
        block(lineNumber, "UNSUPPORTED_M_CODE", detail, lineSource);
      }
    }

    if (hasCode(words, "G", 20)) {
      state.units = "G20";
      state.modalReady.units = true;
    }
    if (hasCode(words, "G", 21)) {
      state.units = "G21";
      state.modalReady.units = true;
    }
    if (hasCode(words, "G", 90)) {
      state.distance = "G90";
      state.modalReady.absolute = true;
    }
    if (hasCode(words, "G", 94)) {
      state.feedMode = "G94";
      state.modalReady.feedPerMinute = true;
    }
    for (const code of [17, 18, 19]) {
      if (hasCode(words, "G", code)) state.plane = `G${code}`;
    }
    if (hasCode(words, "G", requiredPlane)) state.modalReady.plane = true;
    // Lathe radius/diameter mode. Declaring the wrong one silently halves or
    // doubles every X coordinate, so the required mode must be explicit and
    // the opposite mode is a blocker.
    if (requiredLatheMode) {
      if (hasCode(words, "G", requiredLatheMode)) state.modalReady[LATHE_MODAL_KEY] = true;
      const opposite = requiredLatheMode === 7 ? 8 : 7;
      if (hasCode(words, "G", opposite)) {
        block(lineNumber, "LATHE_MODE_CONFLICT", `This machine programs in G${requiredLatheMode} (${requiredLatheMode === 7 ? "diameter" : "radius"}) mode; G${opposite} would rescale every X word.`, lineSource);
      }
    } else if (hasCode(words, "G", 7) || hasCode(words, "G", 8)) {
      block(lineNumber, "LATHE_MODE_ON_MILL", "G7/G8 lathe radius-diameter modes are not part of the mill contract.", lineSource);
    }
    if (hasCode(words, "G", 40)) state.modalReady.compOff = true;
    if (hasCode(words, "G", 49)) {
      state.modalReady.lengthOff = true;
      state.g49AvailableForTool = true;
    }
    if (hasCode(words, "G", 80)) { state.modalReady.cyclesOff = true; state.motion = null; }
    for (const code of gCodes) {
      if (MOTION_CODES.has(code) || code === 33) state.motion = `G${code}`;
      if (WORK_OFFSETS.has(code)) {
        if (nativeMr1 && state.workOffset !== `G${code}`) state.position = { x: null, y: null, z: null };
        state.workOffset = `G${code}`;
      }
    }

    const sValues = valuesFor(words, "S");
    for (const spindleSpeed of sValues) {
      if (!Number.isFinite(spindleSpeed) || spindleSpeed < 1 || spindleSpeed > contract.maximumSpindleRpm) {
        block(lineNumber, "SPINDLE_RANGE", `Spindle speed must be 1-${contract.maximumSpindleRpm} RPM.`, lineSource);
      } else {
        state.spindleSpeed = spindleSpeed;
        maximumSpindleRpm = Math.max(maximumSpindleRpm, spindleSpeed);
      }
    }

    const fValues = valuesFor(words, "F");
    if (nativeMr1 && fValues.length && !state.units) block(lineNumber, "FEED_UNITS_MISSING", "Declare G20 or G21 before a feed word; retained controller units are unknown.", lineSource);
    for (const feed of fValues) {
      const feedMm = feed * unitScale(state.units);
      if (!Number.isFinite(feed) || feed <= 0) {
        block(lineNumber, "FEED_RANGE", "Programmed feed must be greater than zero.", lineSource);
      } else if (feedMm > contract.maximumLinearFeedMmPerMinute + 0.01) {
        block(lineNumber, "FEED_RANGE", `Feed exceeds the configured ${contract.maximumLinearFeedMmPerMinute} mm/min X/Y ceiling.`, lineSource);
      } else {
        state.feedMmPerMinute = feedMm;
        maximumFeedMmPerMinute = Math.max(maximumFeedMmPerMinute, feedMm);
      }
    }

    const toolValues = valuesFor(words, "T");
    for (const tool of toolValues) {
      if (nativeMr1 && (state.spindleOn || state.coolantOn)) {
        block(lineNumber, "ACTIVE_ACCESSORIES_AT_TOOL_CHANGE", "Stop spindle and coolant before manual tool selection.", lineSource);
      }
      if (!Number.isInteger(tool) || tool < 1 || tool > 999) {
        block(lineNumber, "TOOL_RANGE", "Tool number must be an integer from 1 through 999.", lineSource);
      }
      if (!state.g49AvailableForTool) {
        block(lineNumber, "TOOL_LENGTH_NOT_CANCELLED", "G49 is required before every manual tool selection.", lineSource);
      }
      if (state.lastMachineRetractLine <= state.lastWorkMotionLine) {
        block(lineNumber, "TOOL_CHANGE_RETRACT_MISSING", "A qualified G53 Z retract is required after work motion and before tool selection.", lineSource);
      }
      state.tool = tool;
      state.pendingToolStop = true;
      state.g49AvailableForTool = false;
      toolChanges += 1;
    }

    if (hasCode(words, "M", 0) && state.pendingToolStop) state.pendingToolStop = false;
    if (hasCode(words, "M", 3)) {
      if (state.pendingToolStop) {
        block(lineNumber, "TOOL_CHANGE_NOT_ACKNOWLEDGED", "M0 must acknowledge the manual tool change before spindle start.", lineSource);
      }
      if (!Number.isFinite(state.spindleSpeed) || state.spindleSpeed < 1) {
        block(lineNumber, "SPINDLE_SPEED_MISSING", "M3 requires a valid positive S word first or on the same block.", lineSource);
      }
      if (!Number.isInteger(state.tool) || state.tool < 1) {
        block(lineNumber, "TOOL_MISSING", "Select and acknowledge a valid tool before spindle start.", lineSource);
      }
      state.spindleOn = true;
    }
    if (hasCode(words, "M", 5)) { state.spindleOn = false; state.spindleOffExplicit = true; }
    if (hasCode(words, "M", 8)) state.coolantOn = true;
    if (hasCode(words, "M", 9)) { state.coolantOn = false; state.coolantOffExplicit = true; }

    const isG53 = hasCode(words, "G", 53);
    const explicitMotion = gCodes.find((code) => MOTION_CODES.has(code) || code === 33);
    const effectiveMotion = explicitMotion === undefined ? state.motion : `G${explicitMotion}`;
    const isSyncBlock = explicitMotion === 33 && contract.spindleSyncQualified === true;
    const isMotionBlock = axisWords.length > 0
      && (["G0", "G1", "G2", "G3"].includes(effectiveMotion) || isSyncBlock);
    if (nativeMr1 && axisWords.length && !isMotionBlock) {
      block(lineNumber, "AXIS_WITHOUT_MOTION", "Axis words require an active G0/G1/G2/G3 motion mode; G80 cancels that mode.", lineSource);
    }
    if (airRun && isMotionBlock && (!state.spindleOffExplicit || !state.coolantOffExplicit)) {
      block(lineNumber, "AIR_RUN_OFF_REQUIRED", "Explicit M5 and M9 are required before any air-run motion.", lineSource);
    }

    // A synchronized move must be respecified on every block: modal G33
    // carrying into a bare axis line is exactly how an unnoticed sync move
    // happens, so it is outside the contract.
    if (explicitMotion === undefined && state.motion === "G33" && axisWords.length > 0) {
      block(lineNumber, "SPINDLE_SYNC_MODAL", "G33 must be written explicitly on every synchronized block; modal G33 motion is outside the contract.", lineSource);
    }

    if (isSyncBlock) {
      const pitchValues = valuesFor(words, "K");
      const pitch = pitchValues.length === 1 ? pitchValues[0] * unitScale(state.units) : Number.NaN;
      const maximumPitch = contract.maximumThreadPitchMm ?? 6;
      if (!Number.isFinite(pitch) || pitch <= 0 || pitch > maximumPitch) {
        block(lineNumber, "SYNC_PITCH_RANGE", `G33 requires exactly one K pitch word between 0 and ${maximumPitch} mm.`, lineSource);
      }
      if (valuesFor(words, "F").length > 0) {
        block(lineNumber, "SYNC_FEED_FORBIDDEN", "G33 feed comes from the spindle encoder; F words are forbidden on synchronized blocks.", lineSource);
      }
      if (valuesFor(words, "I").length > 0 || valuesFor(words, "J").length > 0) {
        block(lineNumber, "SYNC_CENTER_FORBIDDEN", "I/J words are not valid on a G33 synchronized block.", lineSource);
      }
      if (!state.spindleOn) {
        block(lineNumber, "SPINDLE_NOT_RUNNING", "G33 synchronized motion requires an active M3 spindle.", lineSource);
      }
      if (valuesFor(words, "Z").length !== 1) {
        block(lineNumber, "SYNC_AXIS_REQUIRED", "G33 requires exactly one Z target word.", lineSource);
      }
    }

    if (isG53) {
      if (nativeMr1) {
        const missing = requiredModalKeys.filter(key => !state.modalReady[key]);
        if (missing.length) block(lineNumber, "STARTUP_MODAL_MISSING", `Machine motion began before startup modes were established: ${missing.join(", ")}.`, lineSource);
      }
      machineRetracts += 1;
      const zValues = valuesFor(words, "Z");
      const hasForbiddenCoordinate = axisWords.some(([letter]) => letter !== "Z")
        || valuesFor(words, "I").length > 0
        || valuesFor(words, "J").length > 0
        || valuesFor(words, "K").length > 0;
      const targetMm = zValues.length === 1 ? zValues[0] * unitScale(state.units) : Number.NaN;
      if (effectiveMotion !== "G0" || !hasCode(words, "G", 0)) {
        block(lineNumber, "UNSAFE_G53_MODE", "Every G53 block must explicitly select G0.", lineSource);
      }
      if (state.distance !== "G90") {
        block(lineNumber, "UNSAFE_G53_DISTANCE", "G53 requires active absolute distance mode G90.", lineSource);
      }
      if (hasForbiddenCoordinate || zValues.length !== 1) {
        block(lineNumber, "UNSAFE_G53_AXES", "G53 is restricted to one Z word; machine X/Y motion is forbidden.", lineSource);
      }
      if (!Number.isFinite(targetMm) || !approximately(targetMm, contract.safeMachineZMm, 0.006)) {
        block(lineNumber, "UNSAFE_G53_TARGET", `G53 retract must target machine Z${contract.safeMachineZMm.toFixed(3)} mm.`, lineSource);
      }
      if (state.spindleOn || state.coolantOn) {
        block(lineNumber, "ACTIVE_ACCESSORIES_AT_RETRACT", "Stop spindle and coolant before a machine-coordinate retract.", lineSource);
      }
      state.lastMachineRetractLine = lineNumber;
    } else if (isMotionBlock) {
      state.seenWorkMotion = true;
      state.lastWorkMotionLine = lineNumber;
      workMotionBlocks += 1;
      const missing = requiredModalKeys.filter((key) => !state.modalReady[key]);
      if (missing.length > 0) {
        block(lineNumber, "STARTUP_MODAL_MISSING", `Work motion began before startup modes were established: ${missing.join(", ")}.`, lineSource);
      }
      if (!state.workOffset) {
        block(lineNumber, "WORK_OFFSET_MISSING", "Select G54-G59 before any work-coordinate motion.", lineSource);
      }
      if (state.pendingToolStop) {
        block(lineNumber, "TOOL_CHANGE_NOT_ACKNOWLEDGED", "M0 must acknowledge the manual tool change before motion.", lineSource);
      }
      if (["G1", "G2", "G3"].includes(effectiveMotion)) {
        if (!state.spindleOn && !airRun) {
          block(lineNumber, "SPINDLE_NOT_RUNNING", `${effectiveMotion} work motion requires an active M3 spindle.`, lineSource);
        }
        if (!Number.isFinite(state.feedMmPerMinute) || state.feedMmPerMinute <= 0) {
          block(lineNumber, "FEED_MISSING", `${effectiveMotion} work motion requires a valid positive feed.`, lineSource);
        }
        const onlyZ = axisWords.every(([letter]) => letter === "Z");
        if (onlyZ && state.feedMmPerMinute > contract.maximumZFeedMmPerMinute + 0.01) {
          block(lineNumber, "Z_FEED_RANGE", `Pure Z feed exceeds ${contract.maximumZFeedMmPerMinute} mm/min.`, lineSource);
        }
        // With tracked positions, enforce the Z ceiling on the actual Z
        // component of mixed-axis linear moves too: a token X word must not
        // launder an over-limit plunge past the pure-Z check above.
        if (!onlyZ && effectiveMotion === "G1" && Number.isFinite(state.feedMmPerMinute)) {
          const scale = unitScale(state.units);
          const target = motionTarget(state.position, words, scale);
          if (positionKnown(state.position) && target.z !== null) {
            const dx = target.x - state.position.x;
            const dy = target.y - state.position.y;
            const dz = target.z - state.position.z;
            const distance = Math.hypot(dx, dy, dz);
            if (distance > 1e-9) {
              const zRate = (state.feedMmPerMinute * Math.abs(dz)) / distance;
              if (zRate > contract.maximumZFeedMmPerMinute + 0.01) {
                block(lineNumber, "Z_FEED_RANGE", `The Z component of this move (${Math.round(zRate)} mm/min) exceeds ${contract.maximumZFeedMmPerMinute} mm/min.`, lineSource);
              }
            }
          }
        }
      }
    }

    const centerWords = words.filter(([letter]) => ["I", "J", "K"].includes(letter));
    if (isMotionBlock && ["G2", "G3"].includes(effectiveMotion)) {
      const allowedCenters = state.plane === "G18"
        ? new Set(["I", "K"])
        : state.plane === "G19" ? new Set(["J", "K"]) : new Set(["I", "J"]);
      if (centerWords.length === 0) {
        block(lineNumber, "ARC_CENTER_MISSING", "Arcs must use numeric I/J/K center offsets; radius-format arcs are not qualified.", lineSource);
      }
      for (const [letter] of centerWords) {
        if (!allowedCenters.has(letter)) {
          block(lineNumber, "ARC_CENTER_PLANE", `${letter} is not a valid center word in ${state.plane || "the active plane"}.`, lineSource);
        }
      }
      // Mirror grblHAL's error-33 gate: the start and end radii about the
      // incremental center must agree, or the controller will fault
      // mid-program on an arc the gate approved. Plane-aware: G17 uses
      // I/J over X/Y, G18 uses I/K over X/Z, G19 uses J/K over Y/Z.
      {
        const plane = state.plane ?? `G${requiredPlane}`;
        const planeSpec = plane === "G18"
          ? { axes: ["x", "z"], centers: ["I", "K"] }
          : plane === "G19"
            ? { axes: ["y", "z"], centers: ["J", "K"] }
            : { axes: ["x", "y"], centers: ["I", "J"] };
        const scale = unitScale(state.units);
        const [axisA, axisB] = planeSpec.axes;
        if (nativeMr1 && (state.position[axisA] === null || state.position[axisB] === null)) {
          block(lineNumber, "ARC_START_UNKNOWN", "Establish the arc-plane position in the selected work coordinate system before an arc.", lineSource);
        }
        if (state.position[axisA] !== null && state.position[axisB] !== null) {
          const offsetA = (valuesFor(words, planeSpec.centers[0])[0] ?? 0) * scale;
          const offsetB = (valuesFor(words, planeSpec.centers[1])[0] ?? 0) * scale;
          const target = motionTarget(state.position, words, scale);
          if (target[axisA] !== null && target[axisB] !== null) {
            const centerA = state.position[axisA] + offsetA;
            const centerB = state.position[axisB] + offsetB;
            const startRadius = Math.hypot(state.position[axisA] - centerA, state.position[axisB] - centerB);
            const endRadius = Math.hypot(target[axisA] - centerA, target[axisB] - centerB);
            const deltaRadius = Math.abs(startRadius - endRadius);
            if (nativeMr1 && startRadius === 0) block(lineNumber, "ARC_RADIUS_ZERO", "An arc center must have a positive radius from its start.", lineSource);
            if (deltaRadius > 0.5 || (deltaRadius > 0.005 && deltaRadius > 0.001 * startRadius)) {
              block(lineNumber, "ARC_RADIUS_MISMATCH", `Arc start and end radii differ by ${deltaRadius.toFixed(3)} mm; grblHAL rejects this as error 33.`, lineSource);
            }
            if (nativeMr1 && plane === "G17" && startRadius > 0 && Number.isFinite(state.feedMmPerMinute)
              && state.position.z !== null && target.z !== null) {
              const startA = -offsetA, startB = -offsetB;
              const endA = target[axisA] - centerA, endB = target[axisB] - centerB;
              let sweep = Math.atan2(startA * endB - startB * endA, startA * endA + startB * endB);
              // Pinned grbl/config.h ARC_ANGULAR_TRAVEL_EPSILON = 5E-7f.
              if (effectiveMotion === "G3" && sweep <= 5e-7) sweep += 2 * Math.PI;
              if (effectiveMotion === "G2" && sweep >= -5e-7) sweep -= 2 * Math.PI;
              const dz = Math.abs(target.z - state.position.z);
              const zRate = state.feedMmPerMinute * dz / Math.hypot(startRadius * sweep, dz);
              if (zRate > contract.maximumZFeedMmPerMinute + 0.01) {
                block(lineNumber, "Z_FEED_RANGE", `The Z component of this helix (${Math.round(zRate)} mm/min) exceeds ${contract.maximumZFeedMmPerMinute} mm/min.`, lineSource);
              }
            }
          }
        }
      }
    } else if (centerWords.length > 0 && !isSyncBlock) {
      block(lineNumber, "STRAY_ARC_CENTER", "I/J/K words are only allowed on G2/G3 motion blocks.", lineSource);
    }
    if (valuesFor(words, "P").length > 0 && !hasCode(words, "G", 4)) {
      block(lineNumber, "STRAY_P_WORD", "P words are restricted to explicit G4 dwell blocks.", lineSource);
    }

    // Update tracked work position after all checks that need the start
    // point. A G53 machine move leaves the work-coordinate Z unknown.
    if (isG53) {
      state.position.z = null;
    } else if (isMotionBlock) {
      state.position = motionTarget(state.position, words, unitScale(state.units));
    }

    if (hasCode(words, "M", 30)) {
      state.seenM30 = true;
      if (state.spindleOn || state.coolantOn) {
        block(lineNumber, "ACTIVE_ACCESSORIES_AT_END", "M5 and M9 are required before M30.", lineSource);
      }
      if (state.lastMachineRetractLine <= state.lastWorkMotionLine) {
        block(lineNumber, "FINAL_RETRACT_MISSING", "A qualified G53 Z retract is required after the final work move and before M30.", lineSource);
      }
    }
  }

  if (!state.seenExecutable) block(0, "EMPTY_PROGRAM", "The file contains no executable NC blocks.");
  if (!state.seenM30) block(state.lastExecutableLine, "PROGRAM_END_MISSING", "The program must end with M30.");
  if (!state.seenWorkMotion) warnings.push(issue(0, "NO_WORK_MOTION", "No work-coordinate cutting or rapid motion was found."));
  if (machineRetracts < 2) {
    warnings.push(issue(0, "RETRACT_COUNT", "Expected at least startup and final safe G53 Z retracts."));
  }

  return {
    ok: blockers.length === 0,
    airRun,
    name,
    contractVersion: contract.version,
    machineKind: contract.machineKind ?? "mill",
    blockers,
    warnings,
    summary: {
      lines: lines.length,
      workMotionBlocks,
      machineRetracts,
      toolChanges,
      maximumSpindleRpm,
      maximumFeedMmPerMinute: Math.round(maximumFeedMmPerMinute * 1000) / 1000,
      units: state.units,
      lastWorkOffset: state.workOffset,
    },
  };
}
