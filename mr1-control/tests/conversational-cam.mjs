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

test("lathe facing states its real datum and never rapids into the stock", () => {
  const cycle = getConversationalCycle("lathe-face");
  // The code cuts from the raw face (Z0) down to Z-depth and emits G7
  // diameters; the operator text must say exactly that.
  assert.match(cycle.description, /Z0 on the raw, unfaced stock face/);
  assert.match(cycle.description, /diameters \(G7\)/);
  assert.doesNotMatch(cycle.description, /radii|Z0 is the finished face/);
  for (const overrides of [{}, { depth: 3, stepDown: 1, clearZ: 2 }, { depth: 20, stepDown: 3, clearZ: 0.5 }, { depth: 0.3, stepDown: 0.2, clearZ: 5, stockDiameter: 120 }]) {
    const params = { ...defaultCycleParams(cycle), ...overrides };
    const { gcode } = generateConversationalProgram("lathe-face", params);
    assert.ok(gcode.includes(`(Z0 = RAW STOCK FACE, FINISHED FACE AT Z-${params.depth.toFixed(3)}, X = DIAMETER)`));
    // Check against the stated datum (raw face at Z0) and against an operator
    // who touched off the finished face instead (raw face at Z+depth).
    for (const rawFace of [0, params.depth]) {
      let face = rawFace;
      let x = null;
      let z = 1000; // machine park, far from the chuck
      for (const line of gcode.split("\n")) {
        if (line.startsWith("G53 ")) {
          z = 1000;
          continue;
        }
        if (!/^G[01] /.test(line)) continue;
        const toX = Number(line.match(/X(-?\d+\.\d+)/)?.[1] ?? x);
        const toZ = Number(line.match(/Z(-?\d+\.\d+)/)?.[1] ?? z);
        if (line.startsWith("G0 ")) {
          assert.ok(x !== null || toZ === z, `rapid in Z before X is known: ${line}`);
          for (let step = 0; step <= 100; step += 1) {
            const px = (x ?? toX) + ((toX - (x ?? toX)) * step) / 100;
            const pz = z + ((toZ - z) * step) / 100;
            assert.ok(!(px < params.stockDiameter - 1e-9 && pz < face - 1e-9),
              `rapid into stock (raw face Z${rawFace}, current face Z${face}): ${line} at X${px} Z${pz}`);
          }
        } else if (toX === 0) {
          face = Math.min(face, toZ);
        }
        x = toX;
        z = toZ;
      }
      assert.ok(Math.abs(face + params.depth) < 1e-9, `finished face must be Z-${params.depth}, got ${face}`);
    }
  }
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

// Walks a mill program (absolute XYZ, incremental IJ, F in mm/min) and
// returns every feed move that changes Z, with its true swept angle, radius
// and the Z component of its feed.
function zMoves(gcode) {
  const moves = [];
  let at = { x: null, y: null, z: null };
  let feed = null;
  for (const raw of gcode.split("\n")) {
    const words = {};
    for (const [, letter, value] of raw.replace(/\(.*?\)/g, "").matchAll(/([A-Z])(-?\d+(?:\.\d+)?)/g)) words[letter] = Number(value);
    if (words.G === 53) {
      at = { ...at, z: null };
      continue;
    }
    if (words.F !== undefined) feed = words.F;
    if (![0, 1, 2, 3].includes(words.G)) continue;
    const to = { x: words.X ?? at.x, y: words.Y ?? at.y, z: words.Z ?? at.z };
    if (words.G !== 0 && to.z !== at.z) {
      assert.ok(at.x !== null && at.y !== null && at.z !== null, `feed move from an unknown position: ${raw}`);
      const dz = to.z - at.z;
      let length = Math.hypot(to.x - at.x, to.y - at.y, dz);
      let sweep = 0;
      let radius = 0;
      if (words.G !== 1) {
        const i = words.I ?? 0;
        const j = words.J ?? 0;
        radius = Math.hypot(i, j);
        sweep = Math.atan2(to.y - (at.y + j), to.x - (at.x + i)) - Math.atan2(-j, -i);
        if (words.G === 3 && sweep <= 1e-9) sweep += 2 * Math.PI;
        if (words.G === 2 && sweep >= -1e-9) sweep -= 2 * Math.PI;
        length = Math.hypot(radius * sweep, dz);
      }
      moves.push({ line: raw, g: words.G, dz, sweep, radius, rate: (feed * Math.abs(dz)) / length });
    }
    at = to;
  }
  return moves;
}

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
  // Helical and ramped moves carry a Z component too. With the XY feed at
  // the machine ceiling it must stay within the Z ceiling, and a helix must
  // never descend faster than the programmed plunge feed.
  for (const cycle of CONVERSATIONAL_CYCLES.filter((candidate) => (candidate.machine ?? "mill") === "mill")) {
    for (const zFeed of [MR1_NC_CONTRACT.maximumZFeedMmPerMinute, 40]) {
      const params = { ...defaultCycleParams(cycle), xyFeed: MR1_NC_CONTRACT.maximumLinearFeedMmPerMinute, zFeed };
      const { gcode } = generateConversationalProgram(cycle.id, params);
      for (const move of zMoves(gcode)) {
        assert.ok(move.rate <= MR1_NC_CONTRACT.maximumZFeedMmPerMinute + 0.01, `${cycle.id}: ${move.line} moves Z at ${move.rate}`);
        if (move.g !== 1) assert.ok(move.rate <= zFeed + 0.01, `${cycle.id}: helix ${move.line} moves Z at ${move.rate} over the ${zFeed} plunge feed`);
      }
    }
  }
});

test("helical entries respect the plunge feed and reject degenerate helixes", () => {
  const bore = getConversationalCycle("circ-bore");
  // A 0.1 mm orbit of a 6 mm tool is a plunge in disguise.
  assert.throws(() => bore.generate({ ...defaultCycleParams(bore), diameter: 6.2, toolDiameter: 6, helixPitch: 5 }), /at least 0\.600 mm/);
  assert.throws(() => bore.generate({ ...defaultCycleParams(bore), diameter: 7, toolDiameter: 6, helixPitch: 5 }), /Helix pitch may be at most 0\.553 mm/);
  const pocket = getConversationalCycle("circ-pocket");
  assert.throws(() => pocket.generate({ ...defaultCycleParams(pocket), diameter: 6.2, toolDiameter: 6 }), CycleParameterError);
  for (const [id, overrides, depth] of [
    ["circ-bore", { diameter: 7, toolDiameter: 6, helixPitch: 0.5, depth: 8, xyFeed: 1000, zFeed: 150 }, 8],
    ["circ-pocket", { diameter: 40, toolDiameter: 6, stepOverPercent: 5, stepDown: 10, depth: 10, xyFeed: 1000, zFeed: 150 }, 10],
  ]) {
    const { gcode } = generateConversationalProgram(id, { ...defaultCycleParams(getConversationalCycle(id)), ...overrides });
    const helixes = zMoves(gcode).filter((move) => move.g !== 1);
    assert.ok(helixes.length > 0, `${id}: no helix`);
    for (const arc of helixes) {
      assert.ok(arc.rate <= overrides.zFeed + 0.01, `${id}: ${arc.line} descends at ${arc.rate}`);
      const rampDegrees = (Math.atan2(Math.abs(arc.dz), arc.radius * Math.abs(arc.sweep)) * 180) / Math.PI;
      assert.ok(rampDegrees <= 10.05, `${id}: ${arc.line} ramps at ${rampDegrees} degrees`);
    }
    assert.ok(Math.abs(helixes.reduce((sum, arc) => sum + arc.dz, 0) + depth) < 1e-6, `${id}: helix must reach full depth`);
    assert.equal(validateMr1Nc(gcode).ok, true);
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

test("external thread milling cuts to the ISO root, internal to the nominal major diameter", () => {
  // M12 x 1.75, 6 mm single-point tool: d3 = 12 - 1.22687 * 1.75 = 9.853,
  // so the tool centre must run at (d3 + 6) / 2 = 7.9265, not (12 + 6) / 2.
  const external = generateConversationalProgram("thread-mill-external", {
    ...defaultCycleParams(getConversationalCycle("thread-mill-external")),
    centerX: 0,
    centerY: 0,
    majorDiameter: 12,
    pitch: 1.75,
    toolDiameter: 6,
  }).gcode;
  const expected = (12 - 1.22687 * 1.75 + 6) / 2;
  const externalArcs = zMoves(external).filter((move) => move.g === 2);
  assert.ok(externalArcs.length > 0);
  for (const arc of externalArcs) assert.ok(Math.abs(arc.radius - expected) < 0.0015, `${arc.line}: radius ${arc.radius}`);
  assert.ok(external.includes("G1 X7.926 Y0.000"), "lead-in must reach the root radius");
  assert.match(external, /\(ISO 60 DEG METRIC PROFILE, SINGLE-POINT TOOTH/);
  assert.match(external, /\(EXTERNAL: TOOTH TIP TO ROOT D3 9\.853 /);
  const internal = generateConversationalProgram("thread-mill-internal", {
    ...defaultCycleParams(getConversationalCycle("thread-mill-internal")),
    majorDiameter: 10,
    pitch: 1.5,
    toolDiameter: 6,
  }).gcode;
  for (const arc of zMoves(internal).filter((move) => move.g === 3)) assert.ok(Math.abs(arc.radius - 2) < 0.0015, arc.line);
  assert.match(internal, /\(INTERNAL: TOOTH TIP TO MAJOR D 10\.000, PITCH 1\.500\)/);
  const cycle = getConversationalCycle("thread-mill-external");
  assert.throws(() => cycle.generate({ ...defaultCycleParams(cycle), majorDiameter: 2, pitch: 6 }), CycleParameterError);
});

test("thread helixes keep the pitch constant through a partial final turn", () => {
  for (const [id, overrides, depth, pitch] of [
    ["thread-mill-internal", { threadDepth: 10, pitch: 1.5, majorDiameter: 10, toolDiameter: 6 }, 10, 1.5],
    ["thread-mill-external", {}, 10, 1.75],
  ]) {
    const params = { ...defaultCycleParams(getConversationalCycle(id)), ...overrides };
    assert.equal(params.threadDepth, depth);
    assert.equal(params.pitch, pitch);
    const arcs = zMoves(generateConversationalProgram(id, params).gcode).filter((move) => move.g !== 1);
    let travel = 0;
    let turns = 0;
    for (const arc of arcs) {
      const expected = (pitch * Math.abs(arc.sweep)) / (2 * Math.PI);
      assert.ok(Math.abs(Math.abs(arc.dz) - expected) < 0.002, `${id}: ${arc.line} advances ${arc.dz} for ${expected}`);
      travel += arc.dz;
      turns += Math.abs(arc.sweep) / (2 * Math.PI);
    }
    assert.ok(Math.abs(Math.abs(travel) - depth) < 1e-6, `${id}: helix covers ${travel}`);
    assert.ok(Math.abs(turns - depth / pitch) < 0.001, `${id}: ${turns} turns for ${depth / pitch}`);
  }
});

test("internal thread milling feeds down the hole centre instead of rapiding to depth", () => {
  const { gcode } = generateConversationalProgram("thread-mill-internal", {
    ...defaultCycleParams(getConversationalCycle("thread-mill-internal")),
    threadDepth: 10,
    clearZ: 5,
    zFeed: 150,
  });
  const lines = gcode.split("\n");
  for (const line of lines.filter((candidate) => candidate.startsWith("G0 "))) {
    const z = line.match(/Z(-?\d+\.\d+)/);
    if (z) assert.ok(Number(z[1]) >= 0, `rapid below the hole top: ${line}`);
  }
  const plunge = lines.indexOf("G1 Z-10.000 F150.000");
  assert.ok(plunge > 0, "expected a plunge-feed descent to thread depth");
  assert.deepEqual(lines.slice(plunge - 3, plunge), ["G0 X0.000 Y0.000", "G0 Z5.000", "G0 Z1.000"]);
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

test("outside and inside walls are both climb-milled with the M3 spindle", () => {
  const program = (id) => generateConversationalProgram(id, defaultCycleParams(getConversationalCycle(id))).gcode;
  // Shoelace sum over XY-only feed moves: negative = clockwise.
  const signedArea = (gcode) => {
    let at = null;
    let area = 0;
    for (const line of gcode.split("\n")) {
      const x = line.match(/X(-?\d+\.\d+)/);
      const y = line.match(/Y(-?\d+\.\d+)/);
      if (!/^G[01] /.test(line) || !x || !y) continue;
      const to = { x: Number(x[1]), y: Number(y[1]) };
      if (at && line.startsWith("G1 ") && !/ Z-?\d/.test(line)) area += at.x * to.y - to.x * at.y;
      at = to;
    }
    return area / 2;
  };
  for (const id of ["rect-contour-outside", "chamfer-rect"]) assert.ok(signedArea(program(id)) < 0, `${id} must run clockwise around the part`);
  assert.ok(signedArea(program("rect-contour-inside")) > 0, "window walls must run counterclockwise");
  for (const id of ["circ-contour", "chamfer-circle"]) {
    assert.ok(program(id).includes("\nG2 ") && !program(id).includes("\nG3 "), `${id} must run clockwise`);
  }
  for (const id of ["circ-pocket", "circ-bore"]) {
    assert.ok(program(id).includes("\nG3 ") && !program(id).includes("\nG2 "), `${id} must run counterclockwise`);
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

test("the runtime estimator measures partial arcs by their true sweep", () => {
  // Quarter circle of radius 10 (15.708 mm) plus a 2 mm helical rise at 600 mm/min.
  const program = "G21 G90 G94 G17\nG0 X10.000 Y0.000\nG3 X0.000 Y10.000 Z2.000 I-10.000 J0.000 F600.000\n";
  const expected = (Math.hypot((Math.PI / 2) * 10, 2) / 600) * 60 + (10 / 4000) * 60;
  assert.ok(Math.abs(estimateProgramSeconds(program) - expected) < 0.01, `${estimateProgramSeconds(program)} vs ${expected}`);
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

// After a machine retract or work-offset change the work Z is unknown: the
// next move must place XY at the retract height before Z descends.
function assertXyBeforeZ(gcode, label, lateral = ["X", "Y"]) {
  const lines = gcode.split("\n");
  let checked = 0;
  for (const [index, line] of lines.entries()) {
    if (!/^G53 G0 Z/.test(line) && !/^G5[4-9]$/.test(line)) continue;
    const motions = lines.slice(index + 1).filter((candidate) => /^G[0-3] /.test(candidate) && !candidate.startsWith("G53"));
    if (motions.length === 0) continue;
    const [first, second] = motions;
    const firstLetters = [...first.matchAll(/([XYZ])-?\d/g)].map((match) => match[1]);
    assert.ok(first.startsWith("G0 "), `${label}: approach after line ${index + 1} must be a rapid: ${first}`);
    assert.deepEqual(firstLetters, lateral, `${label}: first move after line ${index + 1} must be ${lateral.join("")} only: ${first}`);
    assert.match(second, /^G0 Z\d+\.\d+$/, `${label}: Z must descend to clearance only after XY: ${second}`);
    checked += 1;
  }
  assert.ok(checked > 0, `${label}: no retract found`);
}

test("every cycle positions XY at the retract height before descending Z", () => {
  for (const cycle of CONVERSATIONAL_CYCLES) {
    const { gcode } = generateConversationalProgram(cycle.id, defaultCycleParams(cycle));
    assertXyBeforeZ(gcode, cycle.id, cycle.machine === "lathe" ? ["X"] : ["X", "Y"]);
  }
});

test("chained tool and work-offset changes approach XY before Z in the new frame", () => {
  const chain = generateConversationalChain([
    operation("face", { tool: 1, wcs: "G54" }),
    operation("drill-grid", { tool: 1, wcs: "G55" }),
    operation("chamfer-rect", { tool: 2, wcs: "G55" }),
  ]);
  assertXyBeforeZ(chain.gcode, "mill chain");
  const lines = chain.gcode.split("\n");
  const offset = lines.indexOf("G55");
  assert.deepEqual(lines.slice(offset + 1, offset + 5), ["S5000 M3", "M8", "G0 X0.000 Y0.000", "G0 Z5.000"]);
  const lathe = generateConversationalChain([
    operation("lathe-drill", { tool: 1 }),
    operation("lathe-turn", { tool: 2, wcs: "G55" }),
  ]);
  assertXyBeforeZ(lathe.gcode, "lathe chain", ["X"]);
});

test("a chained operation with a higher clearance rises before its XY approach", () => {
  const chain = generateConversationalChain([
    operation("drill-grid", { tool: 3, clearZ: 5 }),
    operation("drill-line", { tool: 3, clearZ: 25 }),
  ]);
  const lines = chain.gcode.split("\n");
  const second = lines.findIndex((line) => line.startsWith("(OP 2"));
  const firstMotion = lines.slice(second + 1).find((line) => /^G[0-3] /.test(line));
  assert.equal(firstMotion, "G0 Z25.000", "must rise to the new clearance before moving XY");
  const lower = generateConversationalChain([
    operation("drill-grid", { tool: 3, clearZ: 25 }),
    operation("drill-line", { tool: 3, clearZ: 5 }),
  ]).gcode.split("\n");
  const next = lower.slice(lower.findIndex((line) => line.startsWith("(OP 2")) + 1).filter((line) => /^G[0-3] /.test(line));
  assert.match(next[0], /^G0 X-?\d+\.\d+ Y-?\d+\.\d+$/, "XY moves at the higher previous clearance");
  assert.equal(next[1], "G0 Z5.000");
});

test("generated comments never nest parentheses (grblHAL does not nest them)", () => {
  const programs = CONVERSATIONAL_CYCLES.map((cycle) => [cycle.id, generateConversationalProgram(cycle.id, defaultCycleParams(cycle)).gcode]);
  programs.push(["chain", generateConversationalChain([operation("spiral-face"), operation("thread-mill-internal", { tool: 2 })]).gcode]);
  for (const [id, gcode] of programs) {
    for (const line of gcode.split("\n")) {
      let depth = 0;
      for (const character of line) {
        if (character === "(") assert.equal(depth, 0, `${id}: nested comment in ${line}`);
        if (character === "(") depth += 1;
        if (character === ")") depth -= 1;
      }
      assert.equal(depth, 0, `${id}: unbalanced comment in ${line}`);
    }
  }
  const { gcode } = generateConversationalProgram("lathe-face", defaultCycleParams(getConversationalCycle("lathe-face")));
  assert.equal(gcode.split("\n")[0], "(MR1 CONVERSATIONAL - FACE LATHE)");
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
