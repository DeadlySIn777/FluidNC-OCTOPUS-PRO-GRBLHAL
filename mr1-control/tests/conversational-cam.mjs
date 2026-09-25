import test from "node:test";
import assert from "node:assert/strict";

import {
  CONVERSATIONAL_CYCLES,
  CycleParameterError,
  contractForCycle,
  defaultCycleParams,
  generateConversationalChain,
  MAX_CHAIN_OPERATIONS,
  estimateProgramSeconds,
  generateConversationalProgram,
  getConversationalCycle,
} from "../src/conversational-cam.js";
import { validateMr1Nc, EMCO_LATHE_NC_CONTRACT, MR1_NC_CONTRACT } from "../src/nc-safety-validator.js";

test("the conversational catalog covers both machines with distinct cycles", () => {
  const mill = CONVERSATIONAL_CYCLES.filter((cycle) => (cycle.machine ?? "mill") === "mill");
  const lathe = CONVERSATIONAL_CYCLES.filter((cycle) => cycle.machine === "lathe");
  assert.ok(mill.length >= 15 && mill.length <= 20, `mill cycles: ${mill.length}`);
  assert.ok(lathe.length >= 5, `lathe cycles: ${lathe.length}`);
  const ids = new Set(CONVERSATIONAL_CYCLES.map((cycle) => cycle.id));
  assert.equal(ids.size, CONVERSATIONAL_CYCLES.length);
  for (const cycle of CONVERSATIONAL_CYCLES) {
    assert.ok(cycle.title.length > 0);
    assert.ok(cycle.group.length > 0);
    assert.ok(cycle.description.length > 0);
    assert.ok(Array.isArray(cycle.params) && cycle.params.length > 0);
  }
  assert.equal(contractForCycle(lathe[0]), EMCO_LATHE_NC_CONTRACT);
  assert.equal(contractForCycle(mill[0]), MR1_NC_CONTRACT);
});

test("every cycle's default program passes its machine's NC safety gate", () => {
  for (const cycle of CONVERSATIONAL_CYCLES) {
    const contract = contractForCycle(cycle);
    const { name, gcode } = generateConversationalProgram(cycle.id, defaultCycleParams(cycle));
    const verdict = validateMr1Nc(gcode, { name, contract });
    assert.deepEqual(
      verdict.blockers,
      [],
      `${cycle.id} produced blockers: ${verdict.blockers.map((b) => `${b.code}@${b.line}`).join(", ")}`,
    );
    assert.equal(verdict.ok, true, `${cycle.id} failed validation`);
    assert.ok(verdict.summary.workMotionBlocks > 0, `${cycle.id} contains no work motion`);
    assert.equal(verdict.summary.machineRetracts, 2, `${cycle.id} must retract exactly at start and end`);
    assert.equal(verdict.summary.toolChanges, 1);
    assert.ok(verdict.summary.maximumSpindleRpm <= contract.maximumSpindleRpm);
    assert.ok(verdict.summary.maximumFeedMmPerMinute <= contract.maximumLinearFeedMmPerMinute);
    assert.equal(verdict.summary.units, "G21");
    assert.equal(verdict.machineKind, contract.machineKind);
  }
});

test("lathe programs are strict XZ-plane and cross-contract fail-closed", () => {
  const { gcode } = generateConversationalProgram("lathe-turn", defaultCycleParams(getConversationalCycle("lathe-turn")));
  assert.ok(gcode.includes("G21 G90 G94 G18 G7 G40 G49 G80"), "lathe preamble must select G18 and G7 diameter mode");
  assert.ok(!/ Y-?\d/.test(gcode), "a lathe program must contain no Y words");
  // A lathe program must NOT pass the mill gate, and a mill program must NOT
  // pass the lathe gate.
  assert.equal(validateMr1Nc(gcode, { name: "x.nc" }).ok, false, "mill contract accepted a G18 lathe program");
  const mill = generateConversationalProgram("face", defaultCycleParams(getConversationalCycle("face")));
  assert.equal(validateMr1Nc(mill.gcode, { name: "y.nc", contract: EMCO_LATHE_NC_CONTRACT }).ok, false, "lathe contract accepted a mill program");
});

test("lathe X words are DIAMETERS, matching the EMCO's G7 startup mode", () => {
  // The EMCO interpreter starts in G7 (RS274NGC_STARTUP_CODE), so an X word
  // is a diameter. Emitting a radius here would cut every feature to half
  // its intended size.
  const turn = generateConversationalProgram("lathe-turn", {
    ...defaultCycleParams(getConversationalCycle("lathe-turn")),
    stockDiameter: 30,
    targetDiameter: 24,
    length: 20,
    depthOfCut: 0.5,
  });
  assert.ok(turn.gcode.includes("G0 X24.000"), "target diameter 24 must emit X24, not the radius");
  assert.ok(!turn.gcode.includes("G0 X12.000"), "a radius X word would halve the part");
  assert.ok(turn.gcode.includes("G1 Z-20.000"), "turned length must reach Z-20");
  const part = generateConversationalProgram("lathe-part", defaultCycleParams(getConversationalCycle("lathe-part")));
  assert.ok(part.gcode.includes("G1 X0.000"), "part-off must reach the spindle centerline");
  // Radial clearance is still radial: default clearX 2 on 24 mm stock is a
  // 28 mm diameter standoff.
  const groove = generateConversationalProgram("lathe-groove", {
    ...defaultCycleParams(getConversationalCycle("lathe-groove")),
    stockDiameter: 24,
    clearX: 2,
  });
  assert.ok(groove.gcode.includes("G0 X28.000"), "clearance must be applied radially then doubled");
});

test("the lathe contract enforces the machine's diameter mode and safe park", () => {
  const { gcode } = generateConversationalProgram("lathe-face", defaultCycleParams(getConversationalCycle("lathe-face")));
  // Park is the EMCO's own machine coordinate, not the mill's Z-2, which is
  // outside this machine's 0-172 travel entirely.
  assert.ok(gcode.includes("G53 G0 Z171.500"), "lathe programs must park at the EMCO's safe machine Z");
  assert.ok(!gcode.includes("Z-2.000"), "the mill park must not leak into a lathe program");
  // Declaring the opposite mode is a blocker, not a silent rescale.
  const flipped = gcode.replace("G18 G7", "G18 G8");
  const verdict = validateMr1Nc(flipped, { name: "flip.nc", contract: EMCO_LATHE_NC_CONTRACT });
  assert.ok(verdict.blockers.some((blocker) => blocker.code === "LATHE_MODE_CONFLICT"));
  // Omitting it entirely is also a blocker: the mode may not be inherited.
  const missing = gcode.replace(" G7", "");
  const missingVerdict = validateMr1Nc(missing, { name: "missing.nc", contract: EMCO_LATHE_NC_CONTRACT });
  assert.ok(missingVerdict.blockers.some((blocker) => blocker.code === "STARTUP_MODAL_MISSING"));
  // G7/G8 have no meaning on the mill.
  const onMill = validateMr1Nc(gcode.replace("G18", "G17"), { name: "mill.nc" });
  assert.ok(onMill.blockers.some((blocker) => blocker.code === "LATHE_MODE_ON_MILL"));
});

test("lathe cycles reject impossible geometry", () => {
  const turn = getConversationalCycle("lathe-turn");
  assert.throws(() => turn.generate({ ...defaultCycleParams(turn), targetDiameter: 40, stockDiameter: 30 }), CycleParameterError);
  const bore = getConversationalCycle("lathe-bore");
  assert.throws(() => bore.generate({ ...defaultCycleParams(bore), targetDiameter: 8, holeDiameter: 10 }), CycleParameterError);
  const groove = getConversationalCycle("lathe-groove");
  assert.throws(() => groove.generate({ ...defaultCycleParams(groove), grooveWidth: 1, toolDiameter: 3 }), CycleParameterError);
  const face = getConversationalCycle("lathe-face");
  assert.throws(() => face.generate({ ...defaultCycleParams(face), rpm: EMCO_LATHE_NC_CONTRACT.maximumSpindleRpm + 1 }), CycleParameterError);
});

test("the lathe contract matches the EMCO retrofit's commissioned limits", () => {
  // Sourced from emco120p/emco120p_professional.ini, not invented:
  // MAX_SPINDLE_0_SPEED 2400 and MAX_LINEAR_VELOCITY 50 mm/s.
  assert.equal(EMCO_LATHE_NC_CONTRACT.maximumSpindleRpm, 2400);
  // The feed ceiling is the machine's FEED rating (ORIGINAL_MAX_FEED_MM_MIN),
  // not its rapid velocity.
  assert.equal(EMCO_LATHE_NC_CONTRACT.maximumLinearFeedMmPerMinute, 2000);
  assert.equal(EMCO_LATHE_NC_CONTRACT.safeMachineZMm, 171.5);
  assert.equal(EMCO_LATHE_NC_CONTRACT.requiredLatheMode, 7);
  assert.equal(EMCO_LATHE_NC_CONTRACT.spindleSyncQualified, false, "threading stays locked, mirroring THREADING_ENABLED=0");
  // Machine travel is recorded but deliberately not enforced against work
  // coordinates: the G54 offset between the frames is unknown here.
  assert.deepEqual(EMCO_LATHE_NC_CONTRACT.machineTravelMm.x, { min: 0, max: 55 });
  assert.deepEqual(EMCO_LATHE_NC_CONTRACT.machineTravelMm.z, { min: 0, max: 172 });
  const cycle = getConversationalCycle("lathe-face");
  assert.throws(() => cycle.generate({ ...defaultCycleParams(cycle), rpm: 2500 }), CycleParameterError);
});

test("the lathe contract blocks Y words as a nonexistent axis", () => {
  const program = [
    "G21 G90 G94 G18 G40 G49 G80",
    "G53 G0 Z-2.000",
    "T1",
    "M0",
    "G54",
    "S1000 M3",
    "G0 X10.000 Y5.000",
    "M5",
    "G53 G0 Z-2.000",
    "M30",
  ].join("\n");
  const verdict = validateMr1Nc(program, { name: "y-axis.nc", contract: EMCO_LATHE_NC_CONTRACT });
  assert.ok(verdict.blockers.some((blocker) => blocker.code === "AXIS_NOT_PRESENT"));
});

test("every cycle's program keeps the manual tool-change and shutdown contract", () => {
  for (const cycle of CONVERSATIONAL_CYCLES) {
    const { gcode } = generateConversationalProgram(cycle.id, defaultCycleParams(cycle));
    const lines = gcode.split("\n");
    const toolLine = lines.findIndex((line) => /^T\d+$/.test(line));
    const stopLine = lines.findIndex((line) => line.startsWith("M0"));
    const spindleLine = lines.findIndex((line) => / M3$/.test(line));
    assert.ok(toolLine > 0 && stopLine > toolLine && spindleLine > stopLine, `${cycle.id} tool sequence out of order`);
    assert.equal(lines.filter((line) => line === "M30").length, 1);
    assert.ok(lines.includes("M5"), `${cycle.id} never stops the spindle`);
  }
});

test("pure-Z plunges never exceed the Z feed ceiling", () => {
  for (const cycle of CONVERSATIONAL_CYCLES) {
    const params = defaultCycleParams(cycle);
    const { gcode } = generateConversationalProgram(cycle.id, params);
    for (const line of gcode.split("\n")) {
      const match = line.match(/^G1 Z-?\d+(?:\.\d+)? F(\d+(?:\.\d+)?)$/);
      if (match) {
        assert.ok(Number(match[1]) <= MR1_NC_CONTRACT.maximumZFeedMmPerMinute, `${cycle.id}: ${line}`);
      }
    }
  }
});

test("cycles reject a tool that cannot fit the feature", () => {
  for (const id of ["rect-pocket", "circ-pocket", "circ-bore", "thread-mill-internal", "rect-contour-inside"]) {
    const cycle = getConversationalCycle(id);
    const params = defaultCycleParams(cycle);
    params.toolDiameter = 500;
    if (id === "thread-mill-internal") params.toolDiameter = params.majorDiameter + 1;
    assert.throws(() => cycle.generate(params), CycleParameterError, `${id} accepted an oversized tool`);
  }
});

test("cycles reject out-of-contract speeds, feeds, and offsets", () => {
  const cycle = getConversationalCycle("face");
  const base = defaultCycleParams(cycle);
  assert.throws(() => cycle.generate({ ...base, rpm: MR1_NC_CONTRACT.maximumSpindleRpm + 1 }), CycleParameterError);
  assert.throws(() => cycle.generate({ ...base, xyFeed: MR1_NC_CONTRACT.maximumLinearFeedMmPerMinute + 1 }), CycleParameterError);
  assert.throws(() => cycle.generate({ ...base, zFeed: MR1_NC_CONTRACT.maximumZFeedMmPerMinute + 1 }), CycleParameterError);
  assert.throws(() => cycle.generate({ ...base, zFeed: 0 }), CycleParameterError);
  assert.throws(() => cycle.generate({ ...base, wcs: "G59.1" }), CycleParameterError);
  assert.throws(() => cycle.generate({ ...base, tool: 0 }), CycleParameterError);
  assert.throws(() => cycle.generate({ ...base, depth: Number.NaN }), CycleParameterError);
});

test("drill patterns hit every programmed position exactly once", () => {
  const grid = generateConversationalProgram("drill-grid", {
    ...defaultCycleParams(getConversationalCycle("drill-grid")),
    columns: 3,
    rows: 2,
    pitchX: 10,
    pitchY: 10,
    originX: 0,
    originY: 0,
  });
  const positions = grid.gcode.split("\n").filter((line) => /^G0 X-?\d+(?:\.\d+)? Y-?\d+(?:\.\d+)?$/.test(line));
  assert.equal(positions.length, 6);
  assert.equal(new Set(positions).size, 6);

  const bolt = generateConversationalProgram("drill-bolt-circle", {
    ...defaultCycleParams(getConversationalCycle("drill-bolt-circle")),
    holes: 8,
  });
  const boltPositions = bolt.gcode.split("\n").filter((line) => /^G0 X-?\d+(?:\.\d+)? Y-?\d+(?:\.\d+)?$/.test(line));
  assert.equal(boltPositions.length, 8);
});

test("peck drilling retracts fully between pecks and reaches final depth", () => {
  const { gcode } = generateConversationalProgram("peck-drill", {
    ...defaultCycleParams(getConversationalCycle("peck-drill")),
    depth: 10,
    peck: 3,
    retract: 2,
  });
  const plunges = gcode.split("\n").filter((line) => line.startsWith("G1 Z-"));
  assert.equal(plunges.length, 4);
  assert.ok(plunges.at(-1).startsWith("G1 Z-10.000"));
  const retracts = gcode.split("\n").filter((line) => line === "G0 Z2.000");
  assert.ok(retracts.length >= 4, "expected a full retract after each peck");
});

test("thread milling climbs bottom-up with helical arcs at the compensated radius", () => {
  const { gcode } = generateConversationalProgram("thread-mill-internal", {
    ...defaultCycleParams(getConversationalCycle("thread-mill-internal")),
    majorDiameter: 10,
    toolDiameter: 6,
    pitch: 1.5,
    threadDepth: 6,
  });
  const arcs = gcode.split("\n").filter((line) => line.startsWith("G3 "));
  assert.ok(arcs.length >= 8, "expected at least four helix revolutions of half-arcs");
  assert.ok(arcs.some((line) => line.includes("I-2.000")) && arcs.some((line) => line.includes("I2.000")));
  const zWords = arcs.map((line) => line.match(/Z(-?\d+\.\d+)/)).filter(Boolean).map((match) => Number(match[1]));
  for (let index = 1; index < zWords.length; index += 1) {
    assert.ok(zWords[index] >= zWords[index - 1] - 1e-9, "helix must never move back down");
  }
  assert.ok(Math.abs(zWords.at(-1)) < 1e-9, "helix must finish at Z0");
});

test("external thread milling descends clockwise for a right-hand thread", () => {
  const { gcode } = generateConversationalProgram("thread-mill-external", {
    ...defaultCycleParams(getConversationalCycle("thread-mill-external")),
    majorDiameter: 12,
    toolDiameter: 6,
    pitch: 2,
    threadDepth: 6,
  });
  // G2 (clockwise) with descending Z is the right-hand external helix;
  // G2 with rising Z would produce a left-hand thread.
  const arcs = gcode.split("\n").filter((line) => line.startsWith("G2 "));
  assert.ok(arcs.length >= 6, "expected at least three helix revolutions of half-arcs");
  const zWords = arcs.map((line) => line.match(/Z(-?\d+\.\d+)/)).filter(Boolean).map((match) => Number(match[1]));
  for (let index = 1; index < zWords.length; index += 1) {
    assert.ok(zWords[index] <= zWords[index - 1] + 1e-9, "external helix must never climb back up");
  }
  assert.ok(Math.abs(zWords.at(-1) + 6) < 1e-9, "helix must finish at the full thread depth");
  assert.ok(!gcode.includes("G3 "), "external cycle must not mix in counterclockwise arcs");
});

test("internal thread milling rejects a cutter that cannot enter the minor bore", () => {
  const cycle = getConversationalCycle("thread-mill-internal");
  const params = defaultCycleParams(cycle);
  // M10 x 1.5 has a ~8.38 mm minor bore; a 8.3 mm cutter must be rejected
  // even though it is smaller than the 10 mm major diameter.
  assert.throws(() => cycle.generate({ ...params, toolDiameter: 8.3 }), CycleParameterError);
});

test("chamfer cycles use the corrected track offset and reject impossible geometry", () => {
  for (const id of ["chamfer-rect", "chamfer-circle"]) {
    const cycle = getConversationalCycle(id);
    const params = defaultCycleParams(cycle);
    assert.throws(() => cycle.generate({ ...params, chamferWidth: 2, tipOffset: 1 }), CycleParameterError, `${id} accepted chamferWidth >= tipOffset`);
    assert.throws(() => cycle.generate({ ...params, tipOffset: 4, toolDiameter: 6 }), CycleParameterError, `${id} accepted a tip depth beyond the tool radius`);
  }
  // For a circle edge of diameter 40, chamfer 0.5, tip 1: the tool axis must
  // track (1 - 0.5) = 0.5 mm outside the edge => circle radius 20.5.
  const { gcode } = generateConversationalProgram("chamfer-circle", {
    ...defaultCycleParams(getConversationalCycle("chamfer-circle")),
    diameter: 40,
    chamferWidth: 0.5,
    tipOffset: 1,
  });
  assert.ok(gcode.includes("X20.500 Y0.000"), "chamfer-circle must track tipOffset - chamferWidth outside the edge");
});

test("bore milling clears the standing core instead of ramming it", () => {
  const { gcode } = generateConversationalProgram("circ-bore", {
    ...defaultCycleParams(getConversationalCycle("circ-bore")),
    diameter: 20,
    toolDiameter: 6,
    depth: 8,
  });
  assert.ok(gcode.includes("(CLEAR CORE TOP-DOWN)"), "expected a core-clearing stage for diameter > 2x tool");
  const lines = gcode.split("\n");
  const clearStart = lines.indexOf("(CLEAR CORE TOP-DOWN)");
  const clearing = lines.slice(clearStart);
  assert.ok(clearing.filter((line) => line.startsWith("G3 ")).length >= 8, "core clearing must mill concentric rings");
  // A small hole (diameter <= 2x tool) has no core and must not add the stage.
  const small = generateConversationalProgram("circ-bore", {
    ...defaultCycleParams(getConversationalCycle("circ-bore")),
    diameter: 10,
    toolDiameter: 6,
    depth: 4,
  });
  assert.ok(!small.gcode.includes("CLEAR CORE"), "no core stage expected when the tool covers the center");
});

test("pocket, slot, and inside-contour cycles ramp in instead of plunging into solid", () => {
  for (const id of ["rect-pocket", "circ-pocket", "slot", "rect-contour-inside"]) {
    const { gcode } = generateConversationalProgram(id, defaultCycleParams(getConversationalCycle(id)));
    const lines = gcode.split("\n");
    for (let index = 0; index < lines.length; index += 1) {
      const match = lines[index].match(/^G1 Z(-\d+\.\d+) F/);
      if (!match) continue;
      assert.fail(`${id} still plunges straight down into material at line ${index + 1}: ${lines[index]}`);
    }
  }
});

test("spiral facing finishes with a cut through the stock center", () => {
  const { gcode } = generateConversationalProgram("spiral-face", defaultCycleParams(getConversationalCycle("spiral-face")));
  const lines = gcode.split("\n");
  const centerCuts = lines.filter((line) => line === "G1 X0.000 Y0.000 F600.000");
  assert.ok(centerCuts.length >= 1, "expected a finishing cut through the center to remove the nub");
});

test("the runtime estimator is sane for a known program", () => {
  const program = [
    "G21 G90 G94 G17 G40 G49 G80",
    "G54",
    "G0 X0.000 Y0.000",
    "G1 X100.000 Y0.000 F600.000",
    "G4 P2.000",
    "G1 Z-10.000 F600.000",
    "M30",
    "",
  ].join("\n");
  // 100 mm at 600 mm/min = 10 s, 2 s dwell, 10 mm at 600 mm/min = 1 s.
  const seconds = estimateProgramSeconds(program);
  assert.ok(Math.abs(seconds - 13) < 0.1, `expected ~13 s, got ${seconds}`);
  for (const cycle of CONVERSATIONAL_CYCLES) {
    const { gcode } = generateConversationalProgram(cycle.id, defaultCycleParams(cycle));
    const estimate = estimateProgramSeconds(gcode);
    assert.ok(Number.isFinite(estimate) && estimate > 0 && estimate < 4 * 60 * 60, `${cycle.id}: ${estimate}`);
  }
});

function operation(id, overrides = {}) {
  return { id, params: { ...defaultCycleParams(getConversationalCycle(id)), ...overrides } };
}

test("chained operations merge into one gate-approved program", () => {
  const chain = generateConversationalChain([
    operation("spot-drill", { tool: 1 }),
    operation("drill-grid", { tool: 2 }),
    operation("chamfer-rect", { tool: 3 }),
  ]);
  const verdict = validateMr1Nc(chain.gcode, { name: chain.name });
  assert.equal(verdict.ok, true, JSON.stringify(verdict.blockers, null, 2));
  assert.equal(verdict.summary.toolChanges, 3, "each distinct tool needs its own manual change");
  assert.equal(chain.operations.length, 3);
  const lines = chain.gcode.split("\n");
  assert.equal(lines.filter((line) => line === "M30").length, 1, "exactly one program end");
  assert.equal(lines.filter((line) => /^\(OP \d+:/.test(line)).length, 3, "each operation is labelled");
  // Every tool change needs a qualified retract; every change after the
  // first also needs the spindle stopped (at the first one it never ran).
  const toolLines = lines.map((line, index) => ({ line, index })).filter(({ line }) => /^T\d+$/.test(line));
  assert.equal(toolLines.length, 3);
  for (const [order, { index }] of toolLines.entries()) {
    const preceding = lines.slice(Math.max(0, index - 4), index);
    assert.ok(preceding.some((candidate) => candidate.startsWith("G53 G0 Z")), `tool change at line ${index + 1} without a machine retract`);
    if (order > 0) assert.ok(preceding.includes("M5"), `tool change at line ${index + 1} without M5`);
  }
});

test("operations sharing a tool and offset flow without a redundant tool change", () => {
  const chain = generateConversationalChain([
    operation("drill-grid", { tool: 4, rpm: 3000 }),
    operation("drill-bolt-circle", { tool: 4, rpm: 4200 }),
  ]);
  const verdict = validateMr1Nc(chain.gcode, { name: chain.name });
  assert.equal(verdict.ok, true, JSON.stringify(verdict.blockers, null, 2));
  assert.equal(verdict.summary.toolChanges, 1, "a shared tool must not be re-changed");
  assert.ok(chain.gcode.includes("\nS4200\n"), "a spindle-speed delta must be injected");
});

test("a work-offset change breaks to a safe retract even on the same tool", () => {
  const chain = generateConversationalChain([
    operation("drill-grid", { tool: 5, wcs: "G54" }),
    operation("drill-line", { tool: 5, wcs: "G55" }),
  ]);
  const verdict = validateMr1Nc(chain.gcode, { name: chain.name });
  assert.equal(verdict.ok, true, JSON.stringify(verdict.blockers, null, 2));
  const lines = chain.gcode.split("\n");
  const offsetIndex = lines.indexOf("G55");
  assert.ok(offsetIndex > 0, "the second work offset must be selected");
  const preceding = lines.slice(Math.max(0, offsetIndex - 3), offsetIndex);
  assert.ok(preceding.includes("M5") && preceding.some((line) => line.startsWith("G53 G0 Z")));
});

test("chains are machine-consistent, bounded, and reject bad operations", () => {
  assert.throws(() => generateConversationalChain([]), CycleParameterError);
  assert.throws(
    () => generateConversationalChain([operation("face"), operation("lathe-turn")]),
    /cannot mix mill and lathe/,
  );
  assert.throws(
    () => generateConversationalChain(Array.from({ length: MAX_CHAIN_OPERATIONS + 1 }, () => operation("drill-grid"))),
    CycleParameterError,
  );
  assert.throws(() => generateConversationalChain([{ id: "nope", params: {} }]), /unknown cycle/);
  // A bad parameter is reported against its operation number.
  assert.throws(
    () => generateConversationalChain([operation("drill-grid"), operation("face", { rpm: 99999 })]),
    /Operation 2/,
  );
});

test("lathe operations chain under the lathe contract", () => {
  const chain = generateConversationalChain([
    operation("lathe-face", { tool: 1 }),
    operation("lathe-turn", { tool: 1 }),
    operation("lathe-part", { tool: 2 }),
  ]);
  assert.equal(chain.machine, "lathe");
  const verdict = validateMr1Nc(chain.gcode, { name: chain.name, contract: EMCO_LATHE_NC_CONTRACT });
  assert.equal(verdict.ok, true, JSON.stringify(verdict.blockers, null, 2));
  assert.ok(chain.gcode.includes("G21 G90 G94 G18 G7 G40 G49 G80"));
  assert.ok(!/ Y-?\d/.test(chain.gcode), "a lathe chain must contain no Y words");
  // The mill gate must still reject it.
  assert.equal(validateMr1Nc(chain.gcode, { name: chain.name }).ok, false);
});

test("generateConversationalProgram rejects unknown cycle ids", () => {
  assert.throws(() => generateConversationalProgram("nope", {}), CycleParameterError);
});

test("a corrupted generator output cannot sneak past the gate", () => {
  const { gcode } = generateConversationalProgram("face", defaultCycleParams(getConversationalCycle("face")));
  const sabotaged = gcode.replace("M30", "G33.1 Z-10 K1\nM30");
  const verdict = validateMr1Nc(sabotaged, { name: "SABOTAGE.NC" });
  assert.equal(verdict.ok, false);
});
