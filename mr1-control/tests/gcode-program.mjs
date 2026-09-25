import assert from "node:assert/strict";
import test from "node:test";
import { parseLine as parseUpstreamLine } from "gcode-parser";
import { parseGcodeProgram } from "../src/gcode-program.js";
import { parseGcodeProgramAsync, stopGcodeParserWorker } from "../src/gcode-parser-client.js";
import { DEFAULT_FIXTURE_MAP_PROFILE } from "../src/fixture-map-profile.js";
import { parseLine as parseBrowserLine } from "../src/vendor/gcode-parser-browser.js";

const closeTo = (actual, expected, tolerance = 1e-6) => {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `expected ${actual} to be within ${tolerance} of ${expected}`,
  );
};

test("an F word keeps its unit conversion from the moment it was programmed", () => {
  // F10 under G20 is 254 mm/min; a later G21 must not reinterpret it as
  // 10 mm/min the way retroactive rescaling would.
  const job = parseGcodeProgram(
    "G20 G90\nF10\nG21\nG0 X0 Y0 Z5\nG1 X100 Y0 Z0 F254\nG1 X0 Y0",
    { name: "unit-switch.nc" },
  );
  const cuts = job.segments.filter((segment) => segment.type === "cut");
  closeTo(cuts.at(-1).feed, 254, 0.5);
});

test("cut motion before any F word carries an explicit preview warning", () => {
  const job = parseGcodeProgram(
    "G21 G90\nG0 X0 Y0 Z5\nG1 X10 Y0 Z0",
    { name: "no-feed.nc" },
  );
  assert.ok(
    job.warnings.some((warning) => warning.includes("error 22")),
    `expected a missing-feed warning, got: ${job.warnings.join(" | ")}`,
  );
});

test("axis words attached to a non-motion code produce a dropped-motion warning", () => {
  const job = parseGcodeProgram(
    "G21 G90\nG0 X0 Y0 Z5\nG54 X25\nG1 X10 Y0 Z0 F500",
    { name: "dropped-axis.nc" },
  );
  assert.ok(
    job.warnings.some((warning) => warning.includes("non-motion code")),
    `expected a dropped-axis warning, got: ${job.warnings.join(" | ")}`,
  );
});

test("cut feeds are clamped to the machine's axis rate limits for preview timing", () => {
  // A pure Z move programmed at 2000 mm/min cannot exceed the 1016 mm/min
  // Z axis limit on the real machine.
  const job = parseGcodeProgram(
    "G21 G90\nF2000\nG0 X0 Y0 Z5\nG1 X10 Y0 Z5\nG1 Z0",
    { name: "clamped.nc" },
  );
  const zPlunge = job.segments.at(-1);
  closeTo(zPlunge.feed, 1016, 0.5);
  assert.ok(job.warnings.some((warning) => warning.includes("axis rate limits")));
});

test("async parser falls back to the same parser outside a browser worker", async () => {
  const source = "G21 G90\nG0 X0 Y0 Z5\nG1 X10 Y2 Z0 F600";
  const synchronous = parseGcodeProgram(source, { name: "fallback.nc" });
  const asynchronous = await parseGcodeProgramAsync(source, { name: "fallback.nc" });
  assert.deepEqual(asynchronous, synchronous);
});

test("async parser can apply the fixture map before returning a job", async () => {
  const job = await parseGcodeProgramAsync(
    "G21 G90 G54\nG0 X0 Y0 Z5\nG1 X10 Y2 Z0 F600",
    { name: "mapped.nc" },
    { fixtureMapProfile: DEFAULT_FIXTURE_MAP_PROFILE },
  );
  assert.equal(job.fixtureMap.mappedSegments, 2);
  assert.equal(job.segments[0].fixtureOffset.wcs, "G54");
  assert.ok(Number.isFinite(job.segments[0].fixtureOffset.x));
  assert.ok(Number.isFinite(job.segments[0].fixtureOffset.y));
});

test("async parser falls back deterministically when a browser worker stalls", async () => {
  const originalWorker = globalThis.Worker;
  class SilentWorker {
    addEventListener() {}
    postMessage() {}
    terminate() {}
  }
  globalThis.Worker = SilentWorker;
  try {
    const job = await parseGcodeProgramAsync(
      "G21 G90\nG0 X0 Y0 Z5\nG1 X10 Y2 Z0 F600",
      { name: "worker-timeout.nc" },
      { workerTimeoutMs: 10 },
    );
    assert.equal(job.name, "worker-timeout.nc");
    assert.equal(job.segments.length, 2);
    assert.equal(job.workerTiming?.fallback, true);
    assert.match(job.workerTiming?.fallbackReason, /exceeded 10 ms/);
  } finally {
    stopGcodeParserWorker();
    if (originalWorker === undefined) delete globalThis.Worker;
    else globalThis.Worker = originalWorker;
  }
});

test("async parser cancellation terminates a stalled worker without falling back", async () => {
  const originalWorker = globalThis.Worker;
  let terminated = 0;
  class SilentWorker {
    addEventListener() {}
    postMessage() {}
    terminate() { terminated += 1; }
  }
  globalThis.Worker = SilentWorker;
  try {
    const controller = new AbortController();
    const pending = parseGcodeProgramAsync(
      "G21 G90\nG0 X0 Y0 Z5\nG1 X10 Y2 Z0 F600",
      { name: "worker-cancel.nc" },
      { signal: controller.signal, workerTimeoutMs: 1000 },
    );
    controller.abort();
    await assert.rejects(pending, (error) => error?.name === "AbortError");
    assert.equal(terminated, 1);
  } finally {
    stopGcodeParserWorker();
    if (originalWorker === undefined) delete globalThis.Worker;
    else globalThis.Worker = originalWorker;
  }
});

test("async parser reports deterministic assembly progress", async () => {
  const originalWorker = globalThis.Worker;
  const source = "G21 G90\nG0 X0 Y0 Z5\nG1 X10 Y2 Z0 F600";
  const expected = parseGcodeProgram(source, { name: "worker-progress.nc" });
  class ChunkWorker {
    listeners = new Map();
    addEventListener(type, listener) { this.listeners.set(type, listener); }
    terminate() {}
    postMessage({ id }) {
      const { segments, ...metadata } = expected;
      queueMicrotask(() => {
        const emit = (data) => this.listeners.get("message")?.({ data });
        emit({ id, type: "start", job: { ...metadata, segments: [] }, segmentCount: segments.length });
        segments.forEach((segment, start) => emit({ id, type: "segments", start, segments: [segment] }));
        emit({ id, type: "complete" });
      });
    }
  }
  globalThis.Worker = ChunkWorker;
  try {
    const progress = [];
    const actual = await parseGcodeProgramAsync(source, { name: "worker-progress.nc" }, {
      onProgress: (entry) => progress.push(entry),
    });
    assert.deepEqual(actual, expected);
    assert.equal(progress[0].phase, "parsing");
    assert.equal(progress[1].phase, "assembling");
    assert.equal(progress[1].fraction, 0);
    assert.equal(progress.at(-1).phase, "complete");
    assert.equal(progress.at(-1).fraction, 1);
    assert.ok(progress.some((entry) => entry.phase === "assembling" && entry.fraction === 0.5));
  } finally {
    stopGcodeParserWorker();
    if (originalWorker === undefined) delete globalThis.Worker;
    else globalThis.Worker = originalWorker;
  }
});

test("browser line parser matches the upstream CNCjs synchronous parser", () => {
  const lines = [
    "N42 G1 X1.25 Y-2.5 F300*99 ; finish pass",
    "G0 X0 (outer (nested) note) Z3",
    "$H",
    "%wait",
  ];
  for (const line of lines) {
    for (const lineMode of ["original", "stripped", "compact"]) {
      assert.deepEqual(
        parseBrowserLine(line, { lineMode }),
        parseUpstreamLine(line, { lineMode }),
      );
    }
  }
});

test("parses metric absolute motion and modal machine data", () => {
  const job = parseGcodeProgram(`
G21 G90
S6000 M3
T2 M6
G0 X0 Y0 Z5
G1 X10 Y0 Z0 F600
`, { name: "metric.nc" });

  assert.equal(job.name, "metric.nc");
  assert.equal(job.segments.length, 2);
  assert.deepEqual(job.segments[0].to, { x: 0, y: 0, z: 5 });
  assert.deepEqual(job.segments[1].to, { x: 10, y: 0, z: 0 });
  assert.equal(job.segments[1].feed, 600);
  assert.equal(job.segments[1].spindle, 6000);
  assert.equal(job.segments[1].tool, 2);
  assert.equal(job.segments[1].workOffset, "G54");
  assert.equal(job.segments[1].coolant, "off");
  assert.equal(job.lineCount, 7);
});

test("tracks flood and mist coolant as persistent G-code modal state", () => {
  const job = parseGcodeProgram(`M8
G1 X1 F100
M7
G1 X2
M9
G1 X3`);

  assert.deepEqual(job.segments.map(({ coolant }) => coolant), ["flood", "flood-mist", "off"]);
});

test("preserves standard work-offset identity on every motion segment", () => {
  const job = parseGcodeProgram(`G54
G0 X10
G55
G1 X20 F100
G58
G1 Y5`);
  assert.deepEqual(job.segments.map(({ workOffset }) => workOffset), ["G54", "G55", "G58"]);
  assert.deepEqual(job.segments.map(({ fromWorkOffset }) => fromWorkOffset), ["G54", "G54", "G55"]);
  assert.equal(job.warnings.some((warning) => warning.includes("shared preview origin")), false);
});

test("converts inch incremental motion and feed to millimeters", () => {
  const job = parseGcodeProgram(`G20 G91
G1 X1 F10
Y1`);

  assert.deepEqual(job.segments[0].to, { x: 25.4, y: 0, z: 0 });
  assert.deepEqual(job.segments[1].to, { x: 25.4, y: 25.4, z: 0 });
  closeTo(job.segments[0].feed, 254);
  closeTo(job.duration, 12);
});

test("interpolates XY arcs and preserves their final endpoint", () => {
  const job = parseGcodeProgram(`G21 G90
G0 X10 Y0
G3 X0 Y10 I-10 J0 F600`);

  assert.equal(job.stats.arcs, 1);
  assert.ok(job.segments.length > 3);
  assert.equal(job.segments.at(-1).operation, "g3");
  closeTo(job.segments.at(-1).to.x, 0);
  closeTo(job.segments.at(-1).to.y, 10);
  closeTo(job.segments.at(-1).to.z, 0);
});

test("maps XZ-plane arcs back to machine XYZ axes", () => {
  const job = parseGcodeProgram(`G21 G90 G18
G0 X10 Y3 Z0
G2 X0 Z10 I-10 K0 F500`);

  assert.deepEqual(job.segments[0].to, { x: 10, y: 3, z: 0 });
  closeTo(job.segments.at(-1).to.x, 0);
  closeTo(job.segments.at(-1).to.y, 3);
  closeTo(job.segments.at(-1).to.z, 10);
});

test("assigns one inverse-time duration across an interpolated arc", () => {
  const job = parseGcodeProgram(`G21 G90 G93
G0 X10
G3 X0 Y10 I-10 J0 F2`);
  const arcSegments = job.segments.filter((segment) => segment.sourceLine === 3);
  const arcDuration = arcSegments.reduce((total, segment) => total + segment.duration, 0);

  closeTo(arcDuration, 30);
});

test("rejects motion that cannot be represented safely", () => {
  assert.throws(
    () => parseGcodeProgram("G81 X10 Y10 Z-5 R2 F100"),
    /Canned cycle G81/,
  );
  assert.throws(
    () => parseGcodeProgram("M98 P100\nG1 X10"),
    /Subprogram control M98/,
  );
  assert.throws(
    () => parseGcodeProgram("G1 X#100 F200"),
    /Parameterized G-code/,
  );
  assert.throws(
    () => parseGcodeProgram("G68 X0 Y0 R45\nG1 X10"),
    /G68 coordinate rotation/,
  );
  assert.throws(
    () => parseGcodeProgram("G1 X10 A20 F200"),
    /A-axis motion/,
  );
  assert.throws(
    () => parseGcodeProgram("G1 X10 U20 F200"),
    /U-axis motion/,
  );
  assert.throws(
    () => parseGcodeProgram("G5 X10 Y10 I2 J2 F200"),
    /G5 spline motion/,
  );
  assert.throws(
    () => parseGcodeProgram("G33 Z-10 K1"),
    /G33 spindle-synchronized motion/,
  );
  assert.throws(
    () => parseGcodeProgram("G33.1 Z-10 K1"),
    /G33\.1 rigid tapping/,
  );
  for (const code of ["G41", "G41.1", "G42", "G42.1"]) {
    assert.throws(
      () => parseGcodeProgram(`${code} D3\nG1 X10 F200`),
      /unavailable on grblHAL.*Compensation Type = In Computer/,
    );
  }
});

test("ignores parameter markers inside comments", () => {
  const job = parseGcodeProgram("G1 X10 F200 ; #100 is only a note");
  assert.equal(job.segments.length, 1);
});

test("hides machine-coordinate motion and reports the limitation", () => {
  const job = parseGcodeProgram(`G0 X10
G53 G0 Z0
G0 X5
G1 Y5 F100`);
  assert.equal(job.segments.length, 2);
  assert.deepEqual(job.segments[0].to, { x: 10, y: 0, z: 0 });
  assert.deepEqual(job.segments[1].from, { x: 5, y: 0, z: 0 });
  assert.deepEqual(job.segments[1].to, { x: 5, y: 5, z: 0 });
  assert.ok(job.warnings.some((warning) => warning.startsWith("G53")));
  assert.ok(job.warnings.some((warning) => warning.startsWith("The first work move")));
});

test("warns when dwell time is not part of the estimate", () => {
  const job = parseGcodeProgram("G4 P1000\nG1 X10 F100");
  assert.ok(job.warnings.some((warning) => warning.startsWith("G4 dwell")));
});

test("uses the configured Z-axis maximum rate for pure vertical rapids", () => {
  const job = parseGcodeProgram("G0 Z101.6");
  assert.equal(job.segments[0].feed, 1016);
  closeTo(job.duration, 6);
});

test("does not apply inverse-time feed to G0 motion", () => {
  const job = parseGcodeProgram("G93 F0.1\nG0 Z101.6");
  assert.equal(job.segments[0].feed, 1016);
  closeTo(job.duration, 6);
});

test("warns when extended work offsets share the preview origin", () => {
  const job = parseGcodeProgram("G59.3\nG1 X10 F100");
  assert.ok(job.warnings.some((warning) => warning.startsWith("Extended work offsets")));
});

test("records every non-motion block at its place in the motion sequence", () => {
  const job = parseGcodeProgram(`G21 G90 (units)
S5000 M3
G0 X0 Y0 Z5
G01 X10 F500 M08
G4 P1
G53 G0 Z-2
M30`);
  assert.deepEqual(job.controlBlocks.map(({ segment, words }) => [segment, words]), [
    [0, "G21 G90"],
    [0, "S5000 M3"],
    [1, "M8"],
    [2, "G4 P1"],
    [2, "G53 G0 Z-2"],
    [2, "M30"],
  ]);
});

test("preserves non-motion modal state on a hidden machine-reference block", () => {
  const job = parseGcodeProgram(`G0 X10
G28 G91 Z0
G0 X5
G90
G1 X20 F100`);
  assert.equal(job.segments.length, 2);
  assert.deepEqual(job.segments[1].from, { x: 15, y: 0, z: 0 });
  assert.deepEqual(job.segments[1].to, { x: 20, y: 0, z: 0 });
  assert.ok(job.warnings.some((warning) => warning.startsWith("G28")));
});
