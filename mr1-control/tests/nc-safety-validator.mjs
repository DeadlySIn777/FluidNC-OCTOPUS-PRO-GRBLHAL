import assert from "node:assert/strict";
import test from "node:test";
import { parseGcodeProgram } from "../src/gcode-program.js";
import {
  EMCO_LATHE_NC_CONTRACT,
  EMCO_LATHE_SYNC_NC_CONTRACT,
  validateMr1Nc,
} from "../src/nc-safety-validator.js";


const validMetricProgram = `
(MR-1 VALIDATOR ACCEPTANCE)
G90 G94
G17
G21
G40 G49 G80
G53 G0 Z-2.000
T1
(MANUAL TOOL CHANGE)
M0
S5000 M3
G54
M8
G0 X0 Y0
G0 Z5
G1 Z0 F500
G3 X10 Y0 I5 J0 F800
M9
M5
G53 G0 Z-2.000
M30
`;

function blockerCodes(source) {
  return validateMr1Nc(source).blockers.map(({ code }) => code);
}

const airRunProgram = validMetricProgram
  .replace('G53 G0 Z-2.000', 'M5 M9\nG53 G0 Z-2.000')
  .replace('S5000 M3', '').replace('M8', '').replace('F500', 'F100').replace('F800', 'F200');
const airRunCodes = source => validateMr1Nc(source, { allowSpindleOffMotion: true }).blockers.map(({ code }) => code);

test('explicit air-run mode accepts spindle-off feed and arc motion without weakening default validation', () => {
  const result = validateMr1Nc(airRunProgram, { allowSpindleOffMotion: true });
  assert.equal(result.ok, true, JSON.stringify(result.blockers));
  assert.equal(result.airRun, true);
  assert.ok(blockerCodes(airRunProgram).includes('SPINDLE_NOT_RUNNING'));
  assert.equal(validateMr1Nc(airRunProgram, { allowSpindleOffMotion: 'true' }).ok, false);
  assert.equal(validateMr1Nc(validMetricProgram).airRun, false);
});

test('air-run mode rejects every spindle/coolant enable and requires explicit off before the first rapid', () => {
  for (const command of ['M3', 'M4', 'M7', 'M8']) {
    assert.ok(airRunCodes(airRunProgram.replace('G54', `G54\n${command}`)).includes('AIR_RUN_ACCESSORY_ON'), command);
  }
  for (const replacement of ['', 'M5', 'M9']) {
    assert.ok(airRunCodes(airRunProgram.replace('M5 M9', replacement)).includes('AIR_RUN_OFF_REQUIRED'), replacement);
  }
});

test('air-run mode retains retract, tool acknowledgement, modal, feed and geometric checks', () => {
  const variants = [
    [airRunProgram.replaceAll('Z-2.000', 'Z-1.000'), 'UNSAFE_G53_TARGET'],
    [airRunProgram.replace('M0', ''), 'TOOL_CHANGE_NOT_ACKNOWLEDGED'],
    [airRunProgram.replace('G40 G49 G80', 'G49 G80'), 'STARTUP_MODAL_MISSING'],
    [airRunProgram.replace('F100', 'F1100'), 'Z_FEED_RANGE'],
    [airRunProgram.replace('I5 J0', 'I2 J0'), 'ARC_RADIUS_MISMATCH'],
    [airRunProgram.replace('G54', '$X\nG54'), 'CONTROLLER_COMMAND'],
  ];
  for (const [source, expected] of variants) assert.ok(airRunCodes(source).includes(expected), expected);
});

test("accepts the strict metric MR-1 contract", () => {
  const result = validateMr1Nc(validMetricProgram, { name: "valid.nc" });
  assert.equal(result.ok, true, JSON.stringify(result.blockers, null, 2));
  assert.equal(result.summary.machineRetracts, 2);
  assert.equal(result.summary.maximumSpindleRpm, 5000);
  assert.equal(result.summary.maximumFeedMmPerMinute, 800);
});

test("blocks an over-limit plunge laundered with a token X word", () => {
  const laundered = validMetricProgram.replace(
    "G1 Z0 F500",
    "G1 Z0 F500\nG1 X0.001 Z-50.000 F2500",
  );
  const codes = blockerCodes(laundered);
  assert.ok(codes.includes("Z_FEED_RANGE"), `expected Z_FEED_RANGE, got ${codes.join(", ")}`);
  // The same feed on a genuinely shallow move must stay legal.
  const shallow = validMetricProgram.replace(
    "G1 Z0 F500",
    "G1 Z0 F500\nG1 X100.000 Z-1.000 F2500\nG1 X0.000 Z0.000 F2500",
  );
  const shallowResult = validateMr1Nc(shallow);
  assert.equal(shallowResult.ok, true, JSON.stringify(shallowResult.blockers, null, 2));
});

test("blocks arcs whose start and end radii disagree (grblHAL error 33)", () => {
  const badArc = validMetricProgram.replace(
    "G3 X10 Y0 I5 J0 F800",
    "G2 X10 Y0 I2 J0 F800",
  );
  const codes = blockerCodes(badArc);
  assert.ok(codes.includes("ARC_RADIUS_MISMATCH"), `expected ARC_RADIUS_MISMATCH, got ${codes.join(", ")}`);
});

test('machine retracts and feed words cannot inherit undeclared controller units', () => {
  assert.ok(blockerCodes(validMetricProgram.replace('G21\n', '').replace('T1', 'G21\nT1')).includes('STARTUP_MODAL_MISSING'));
  assert.ok(blockerCodes(validMetricProgram.replace('G21', 'F100\nG21')).includes('FEED_UNITS_MISSING'));
});

test('manual stops cannot conceal same-block motion or spindle starts, and tool selection requires stopped outputs', () => {
  for (const combined of ['T1 M0 S5000 M3', 'T1 M0 G0 Z5', 'T1 M0 M8']) {
    assert.ok(blockerCodes(validMetricProgram.replace('T1\n(MANUAL TOOL CHANGE)\nM0', combined)).includes('PAUSE_BLOCK_CONFLICT'), combined);
  }
  assert.ok(blockerCodes(validMetricProgram.replace('S5000 M3', 'S5000 M3\nG49\nT2\nM0')).includes('ACTIVE_ACCESSORIES_AT_TOOL_CHANGE'));
  assert.equal(validateMr1Nc(validMetricProgram.replace('T1\n(MANUAL TOOL CHANGE)\nM0', 'T1 M0')).ok, true);
});

test('duplicate value words and contradictory modal groups are rejected before firmware errors', () => {
  for (const [original, changed] of [['G0 X0 Y0', 'G0 X0 X1 Y0'], ['G0 Z5', 'G0 Z5 F100 F200']]) {
    assert.ok(blockerCodes(validMetricProgram.replace(original, changed)).includes('DUPLICATE_WORD'), changed);
  }
  for (const changed of ['G20 G21', 'G17 G18', 'M3 M5', 'G54 G55']) {
    assert.ok(blockerCodes(validMetricProgram.replace('G54', changed + '\nG54')).includes('MODAL_GROUP_CONFLICT'), changed);
  }
});

test('MR1 rejects executable checksums including valid XOR and zero values', () => {
  const line = 'N10 G90 G94';
  const checksum = [...line].reduce((value, char) => value ^ char.charCodeAt(0), 0);
  for (const suffix of [checksum, 0]) {
    assert.ok(blockerCodes(validMetricProgram.replace('G90 G94', `${line}*${suffix}`)).includes('UNSUPPORTED_CHECKSUM'));
  }
});

test('G80 cancels modal motion and an arc requires a known start in its current work frame', () => {
  assert.ok(blockerCodes(validMetricProgram.replace('G3 X10 Y0 I5 J0 F800', 'G80\nX10')).includes('AXIS_WITHOUT_MOTION'));
  assert.ok(blockerCodes(validMetricProgram.replace('G3 X10 Y0 I5 J0 F800', 'G55\nG3 X10 Y0 I5 J0 F800')).includes('ARC_START_UNKNOWN'));
  const established = validMetricProgram.replace('G3 X10 Y0 I5 J0 F800', 'G55\nG0 X0 Y0\nG0 Z0\nG3 X10 Y0 I5 J0 F800');
  assert.equal(validateMr1Nc(established).ok, true);
});

test('helical arc feed must respect the Z component and cannot use a zero-radius center', () => {
  const steep = validMetricProgram.replace('G3 X10 Y0 I5 J0 F800', 'G3 X10 Y0 Z-100 I5 J0 F2500');
  assert.ok(blockerCodes(steep).includes('Z_FEED_RANGE'));
  const shallow = validMetricProgram.replace('G3 X10 Y0 I5 J0 F800', 'G3 X10 Y0 Z-1 I5 J0 F2500');
  assert.equal(validateMr1Nc(shallow).ok, true);
  assert.ok(blockerCodes(validMetricProgram.replace('G3 X10 Y0 I5 J0 F800', 'G3 X0 Y0 I0 J0 F800')).includes('ARC_RADIUS_ZERO'));
});

// EMCO conventions: G18 plane, G7 diameter mode, and that machine's own safe
// park at machine Z171.5. X words are diameters.
const validThreadingProgram = `
G21 G90 G94 G18 G7 G40 G49 G80
G53 G0 Z171.500
T1
M0
G54
S800 M3
G0 X20.000
G0 Z2.000
G0 X18.000
G33 Z-15.000 K1.500
G0 X20.000
G0 Z2.000
M5
G53 G0 Z171.500
M30
`;

test("G33 threading stays locked until the spindle encoder is qualified", () => {
  const locked = validateMr1Nc(validThreadingProgram, { name: "thread.nc", contract: EMCO_LATHE_NC_CONTRACT });
  assert.equal(locked.ok, false);
  assert.ok(locked.blockers.some((blocker) => blocker.code === "SPINDLE_SYNC_NOT_QUALIFIED"));
  // The mill contract has no encoder either.
  const mill = validateMr1Nc(validThreadingProgram.replace("G18 G7", "G17"), { name: "thread.nc" });
  assert.ok(mill.blockers.some((blocker) => blocker.code === "SPINDLE_SYNC_NOT_QUALIFIED"));
});

test("a qualified lathe contract accepts strict G33 threading passes", () => {
  const verdict = validateMr1Nc(validThreadingProgram, { name: "thread.nc", contract: EMCO_LATHE_SYNC_NC_CONTRACT });
  assert.equal(verdict.ok, true, JSON.stringify(verdict.blockers, null, 2));
});

test("qualified G33 blocks still enforce pitch, feed, spindle, and modal rules", () => {
  const codesFor = (mutation) => validateMr1Nc(
    validThreadingProgram.replace("G33 Z-15.000 K1.500", mutation),
    { name: "thread.nc", contract: EMCO_LATHE_SYNC_NC_CONTRACT },
  ).blockers.map(({ code }) => code);
  assert.ok(codesFor("G33 Z-15.000").includes("SYNC_PITCH_RANGE"), "missing K must block");
  assert.ok(codesFor("G33 Z-15.000 K8.000").includes("SYNC_PITCH_RANGE"), "oversized pitch must block");
  assert.ok(codesFor("G33 Z-15.000 K1.500 F100").includes("SYNC_FEED_FORBIDDEN"), "F word must block");
  assert.ok(codesFor("G33 Z-15.000 K1.500 I2.000").includes("SYNC_CENTER_FORBIDDEN"), "I word must block");
  assert.ok(
    codesFor("G33 Z-15.000 K1.500\nZ-14.000").includes("SPINDLE_SYNC_MODAL"),
    "bare axis words after G33 must block",
  );
  const spindleOff = validateMr1Nc(
    validThreadingProgram.replace("S800 M3", "S800 M3\nM5").replace("M5\nG53 G0 Z-2.000\nM30", "G53 G0 Z-2.000\nM30"),
    { name: "thread.nc", contract: EMCO_LATHE_SYNC_NC_CONTRACT },
  );
  assert.ok(spindleOff.blockers.some((blocker) => blocker.code === "SPINDLE_NOT_RUNNING"));
});

test("authored metric and repeated-tool programs pass validation and preview", () => {
  const programs = [validMetricProgram, validMetricProgram.replace('G54', 'G55'),
    validMetricProgram.replace('M9\nM5', 'M9\nM5\nG53 G0 Z-2.000\nG49\nT2 M0\nS5000 M3\nG54\nG1 X12 F500\nM9\nM5')];
  for (const [index, source] of programs.entries()) {
    const result = validateMr1Nc(source, { name: 'authored-'+index+'.nc' });
    assert.equal(result.ok, true, JSON.stringify(result.blockers));
    assert.ok(parseGcodeProgram(source).segments.length > 0);
  }
});

test("rejects uncommissioned motion, spindle, probing, and controller features", () => {
  const mutations = [
    [validMetricProgram.replace("M3", "M4"), "UNSUPPORTED_M_CODE"],
    [validMetricProgram.replace("T1", "T1 M6"), "UNSUPPORTED_M_CODE"],
    [validMetricProgram.replace("G1 Z0 F500", "G84 Z0 F500"), "UNSUPPORTED_G_CODE"],
    [validMetricProgram.replace("G1 Z0 F500", "G38.2 Z0 F500"), "UNSUPPORTED_G_CODE"],
    [validMetricProgram.replace("G40 G49 G80", "G41 G49 G80"), "UNSUPPORTED_G_CODE"],
    [validMetricProgram.replace("G40 G49 G80", "G40 G43 H1 G80"), "UNSUPPORTED_G_CODE"],
    [validMetricProgram.replace("G90 G94", "G91 G94"), "UNSUPPORTED_G_CODE"],
    [validMetricProgram.replace("G1 Z0 F500", "G1 X#100 F500"), "PARAMETERIZED_CODE"],
    [validMetricProgram.replace("G1 Z0 F500", "G1 X1 A30 F500"), "ROTARY_AXIS"],
  ];
  for (const [source, expectedCode] of mutations) {
    assert.ok(blockerCodes(source).includes(expectedCode), `Expected ${expectedCode}`);
  }
});

test("rejects unsafe machine-coordinate retracts", () => {
  assert.ok(blockerCodes(validMetricProgram.replace("G53 G0 Z-2.000", "G53 G0 X0 Z-2.000")).includes("UNSAFE_G53_AXES"));
  assert.ok(blockerCodes(validMetricProgram.replace("G53 G0 Z-2.000", "G53 G0 Z0")).includes("UNSAFE_G53_TARGET"));
  assert.ok(blockerCodes(validMetricProgram.replace("G53 G0 Z-2.000", "G53 G1 Z-2.000")).includes("UNSAFE_G53_MODE"));
  assert.ok(blockerCodes(validMetricProgram.replace("G90 G94", "G94")).includes("UNSAFE_G53_DISTANCE"));
});

test("rejects incomplete manual tool-change and end-of-program sequences", () => {
  assert.ok(blockerCodes(validMetricProgram.replace("M0\nS5000", "S5000")).includes("TOOL_CHANGE_NOT_ACKNOWLEDGED"));
  assert.ok(blockerCodes(validMetricProgram.replace("G53 G0 Z-2.000\nM30", "M30")).includes("FINAL_RETRACT_MISSING"));
  assert.ok(blockerCodes(validMetricProgram.replace("M30", "")).includes("PROGRAM_END_MISSING"));

  const twoToolsWithoutG49 = validMetricProgram.replace(
    "M9\nM5\nG53 G0 Z-2.000\nM30",
    "M9\nM5\nG53 G0 Z-2.000\nT2\nM0\nS4000 M3\nG54\nG1 X20 F500\nM5\nG53 G0 Z-2.000\nM30",
  );
  assert.ok(blockerCodes(twoToolsWithoutG49).includes("TOOL_LENGTH_NOT_CANCELLED"));
});

test("enforces configured spindle and feed ceilings", () => {
  assert.ok(blockerCodes(validMetricProgram.replace("S5000", "S8001")).includes("SPINDLE_RANGE"));
  assert.ok(blockerCodes(validMetricProgram.replace("F800", "F2541")).includes("FEED_RANGE"));
  assert.ok(blockerCodes(validMetricProgram.replace("G1 Z0 F500", "G1 Z0 F1017")).includes("Z_FEED_RANGE"));
});

test("post failure markers can never receive a passing verdict", () => {
  const source = validMetricProgram.replace(
    "(MR-1 VALIDATOR ACCEPTANCE)",
    "(MR1 POST BLOCKED: INTENTIONAL TEST)",
  );
  assert.ok(blockerCodes(source).includes("POST_BLOCK_MARKER"));
});

test("rejects human error text and malformed comments as NC input", () => {
  assert.ok(blockerCodes(`!Error: Failed to post data.\n${validMetricProgram}`).includes("MALFORMED_BLOCK"));
  assert.ok(blockerCodes(validMetricProgram.replace("(MR-1 VALIDATOR ACCEPTANCE)", "(UNFINISHED COMMENT")).includes("MALFORMED_COMMENT"));
});

test("blocks every work move before the first qualified machine-Z retract", () => {
  const early = `G90 G94 G17 G21 G40 G49 G80
G54
G0 X-150 Y80 Z-3
G53 G0 Z-2.000
T1
M0
S5000 M3
G0 X0 Y0
G0 Z5
G1 Z-1 F100
G1 X10 F500
M5
G53 G0 Z-2.000
M30
`;
  const result = validateMr1Nc(early);
  assert.equal(result.ok, false);
  assert.deepEqual(result.blockers.filter(({ code }) => code === "MOTION_BEFORE_RETRACT").map(({ line }) => line), [3]);
  for (const move of ["G0 X10 Y10", "G1 X10 F100", "G0 Z5"]) {
    const source = validMetricProgram.replace("G53 G0 Z-2.000\nT1", `G54\n${move}\nG53 G0 Z-2.000\nT1`);
    assert.ok(blockerCodes(source).includes("MOTION_BEFORE_RETRACT"), move);
  }
  const lathe = validateMr1Nc(validThreadingProgram.replace("G53 G0 Z171.500\nT1", "G54\nG0 X30.000\nG53 G0 Z171.500\nT1"),
    { contract: EMCO_LATHE_SYNC_NC_CONTRACT });
  assert.ok(lathe.blockers.some(({ code }) => code === "MOTION_BEFORE_RETRACT"));
});

test("after a machine retract or work-offset change XY must be placed before any Z move", () => {
  const codes = (source) => blockerCodes(source);
  // Z first, or Z blended into the XY move, at the start of the program.
  assert.ok(codes(validMetricProgram.replace("G0 X0 Y0\nG0 Z5", "G0 Z5\nG0 X0 Y0")).includes("APPROACH_Z_BEFORE_XY"));
  assert.ok(codes(validMetricProgram.replace("G0 X0 Y0\nG0 Z5", "G0 X0 Y0 Z5")).includes("APPROACH_Z_BEFORE_XY"));
  // Mid-program tool change: the first move after the retract is Z at the old XY.
  const toolChange = validMetricProgram.replace("M9\nM5\nG53 G0 Z-2.000\nM30",
    "M9\nM5\nG53 G0 Z-2.000\nG49\nT2\nM0\nS5000 M3\nG0 Z5\nG1 Z0 F500\nM5\nG53 G0 Z-2.000\nM30");
  assert.ok(codes(toolChange).includes("APPROACH_Z_BEFORE_XY"));
  assert.equal(validateMr1Nc(toolChange.replace("S5000 M3\nG0 Z5", "S5000 M3\nG0 X10 Y0\nG0 Z5")).ok, true);
  // Work-offset change: both X and Y must be re-established in the new frame.
  const frame = (moves) => validMetricProgram.replace("G3 X10 Y0 I5 J0 F800", `G3 X10 Y0 I5 J0 F800\nG0 Z5\nG55\n${moves}\nG1 Z-1 F100`);
  assert.ok(codes(frame("G0 Z5")).includes("APPROACH_Z_BEFORE_XY"));
  assert.ok(codes(frame("G0 X0\nG0 Z5")).includes("APPROACH_Z_BEFORE_XY"), "Y is still unknown in G55");
  assert.ok(codes(frame("G0 X0 Y0 Z5")).includes("APPROACH_Z_BEFORE_XY"));
  assert.equal(validateMr1Nc(frame("G0 X0\nG0 Y0\nG0 Z5")).ok, true);
  assert.equal(validateMr1Nc(frame("G0 X0 Y0\nG0 Z5")).ok, true);
  // The lathe approaches in X at the park height before Z.
  const latheCodes = (source) => validateMr1Nc(source, { contract: EMCO_LATHE_SYNC_NC_CONTRACT }).blockers.map(({ code }) => code);
  assert.ok(latheCodes(validThreadingProgram.replace("G0 X20.000\nG0 Z2.000", "G0 X20.000 Z2.000")).includes("APPROACH_Z_BEFORE_XY"));
  assert.ok(latheCodes(validThreadingProgram.replace("G0 X20.000\nG0 Z2.000", "G0 Z2.000\nG0 X20.000")).includes("APPROACH_Z_BEFORE_XY"));
});

test("a Z feed component that cannot be verified from an unknown start is blocked", () => {
  const helix = `G90 G94 G17 G21 G40 G49 G80
G53 G0 Z-2.000
T1
M0
S5000 M3
G54
G0 X0 Y0
M5
G53 G0 Z-2.000
S5000 M3
G1 X5 Y0 F2500
G2 X-5 Y0 Z-60 I-5 J0
M5
G53 G0 Z-2.000
M30
`;
  assert.ok(blockerCodes(helix).includes("Z_FEED_UNVERIFIED"));
  assert.ok(blockerCodes(helix.replace("G2 X-5 Y0 Z-60 I-5 J0", "G1 X0.001 Z-80")).includes("Z_FEED_UNVERIFIED"));
  // At or below the Z ceiling the component can never exceed it.
  const slow = helix.replace("F2500", "F1000");
  assert.equal(validateMr1Nc(slow).ok, true, JSON.stringify(validateMr1Nc(slow).blockers));
  // Once Z is established the ordinary Z-component check applies.
  const known = helix.replace("G1 X5 Y0 F2500", "G1 X5 Y0 F2500\nG0 Z0");
  assert.ok(blockerCodes(known).includes("Z_FEED_RANGE"));
  assert.ok(!blockerCodes(known).includes("Z_FEED_UNVERIFIED"));
});
