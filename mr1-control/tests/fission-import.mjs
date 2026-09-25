import assert from "node:assert/strict";
import { createHash, webcrypto } from "node:crypto";
import test from "node:test";
import {
  DEFAULT_FISSION_IMPORT_PROFILE,
  FISSION_IMPORT_STORAGE_KEY,
  evaluateFissionImportProfile,
  hasFusionPersonalNotice,
  loadFissionImportProfile,
  requestFissionOptimization,
  saveFissionImportProfile,
  verifyFissionPreview,
} from "../src/fission-import.js";
import { parseGcodeProgram } from "../src/gcode-program.js";

function sha256(text) {
  return createHash("sha256").update(text).digest("hex").toUpperCase();
}

function storage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    values,
  };
}

test("automatic import is held until work-coordinate safe Z is verified", () => {
  const initial = evaluateFissionImportProfile(DEFAULT_FISSION_IMPORT_PROFILE);
  assert.equal(initial.valid, true);
  assert.equal(initial.ready, false);
  assert.equal(evaluateFissionImportProfile({ ...initial.profile, safeZVerified: true }).ready, true);
});

test("Fission settings persist without accepting invalid modes", () => {
  const target = storage();
  const saved = saveFissionImportProfile({
    enabled: true,
    safeZ: 2.5,
    safeZVerified: true,
    traverses: "on",
    retracts: "off",
  }, target);
  assert.equal(target.values.has(FISSION_IMPORT_STORAGE_KEY), true);
  assert.deepEqual(loadFissionImportProfile(target), saved);
  assert.equal(loadFissionImportProfile({ getItem: () => "{broken" }).safeZVerified, false);
  assert.throws(
    () => saveFissionImportProfile({ ...saved, traverses: "always" }, target),
    /traverse mode/i,
  );
  assert.throws(
    () => saveFissionImportProfile({ ...saved, safeZ: "" }, target),
    /Safe Z must be a number/i,
  );
});

test("Fusion Personal notice detection is narrow", () => {
  assert.equal(hasFusionPersonalNotice("(When using Fusion for Personal Use, the feedrate of rapid moves is reduced)"), true);
  assert.equal(hasFusionPersonalNotice("(normal program with a feedrate note)"), false);
});

test("loopback response must pass independent SHA-256 checks", async () => {
  const source = "G21\nG90\nG0 Z5\nG1 X10 F2\n";
  const output = source.replace("G1 X10 F2", "G0 X10");
  const result = await requestFissionOptimization(source, {
    name: "part.nc",
    profile: { ...DEFAULT_FISSION_IMPORT_PROFILE, safeZVerified: true },
    cryptoApi: webcrypto,
    fetchImpl: async (_url, request) => {
      const body = JSON.parse(request.body);
      assert.equal(body.options.safeZVerified, true);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          content: output,
          validated: true,
          stats: { rapidsRestored: 1, rpmCapped: 0 },
          sourceSha256: sha256(source),
          outputSha256: sha256(output),
        }),
      };
    },
  });
  assert.equal(result.content, output);

  await assert.rejects(
    requestFissionOptimization(source, {
      profile: { ...DEFAULT_FISSION_IMPORT_PROFILE, safeZVerified: true },
      cryptoApi: webcrypto,
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          content: output,
          validated: true,
          stats: { rapidsRestored: 1 },
          sourceSha256: "0".repeat(64),
          outputSha256: sha256(output),
        }),
      }),
    }),
    /source hash mismatch/i,
  );
});

test("optimizer cancellation follows the caller abort signal", async () => {
  const controller = new AbortController();
  const pending = requestFissionOptimization("G21\nG90\nG0 Z5\n", {
    profile: { ...DEFAULT_FISSION_IMPORT_PROFILE, safeZVerified: true },
    signal: controller.signal,
    timeoutMs: 1000,
    fetchImpl: async (_url, request) => new Promise((_resolve, reject) => {
      request.signal.addEventListener("abort", () => {
        const error = new Error("cancelled");
        error.name = "AbortError";
        reject(error);
      }, { once: true });
    }),
  });
  controller.abort();
  await assert.rejects(pending, (error) => error?.name === "AbortError");
});

test("independent preview allows only cut-to-rapid classification changes", () => {
  const source = `(When using Fusion for Personal Use, the feedrate of rapid moves is reduced)
G21 G90
G0 Z5
G1 X10 Y0 F2
G1 Z-1 F100
G1 X20 F500
`;
  const optimized = `(Optimized externally)
G21 G90
G0 Z5
G0 X10 Y0
G1 Z-1 F100
G1 X20 F500
`;
  const before = parseGcodeProgram(source, { name: "before.nc" });
  const after = parseGcodeProgram(optimized, { name: "after.nc" });
  const verified = verifyFissionPreview(before, after, { rapidsRestored: 1, rpmCapped: 0 });
  assert.equal(verified.valid, true, verified.errors.join("\n"));
  assert.equal(verified.convertedSegments, 1);
  assert.equal(verified.clearanceSegments, 1);
  assert.equal(verified.retractSegments, 0);
  assert.equal(
    verifyFissionPreview(before, after, { rapidsRestored: 2, rpmCapped: 0 }).valid,
    false,
    "unparsed or hidden converted moves must be rejected",
  );

  const moved = parseGcodeProgram(optimized.replace("X20", "X21"), { name: "moved.nc" });
  const rejected = verifyFissionPreview(before, moved, { rapidsRestored: 1 });
  assert.equal(rejected.valid, false);
  assert.match(rejected.errors.join(" "), /endpoint changed|bounds changed/);
});

test("independent preview permits upward safe-Z retracts and rejects every unsafe rapid class", () => {
  const retractSource = "G21 G90\nG1 Z-2 F100\nG1 Z5 F2\n";
  const retractRapid = "G21 G90\nG1 Z-2 F100\nG0 Z5\n";
  const retract = verifyFissionPreview(
    parseGcodeProgram(retractSource),
    parseGcodeProgram(retractRapid),
    { rapidsRestored: 1 },
    { safeZ: 3 },
  );
  assert.equal(retract.valid, true, retract.errors.join("\n"));
  assert.equal(retract.retractSegments, 1);

  const cases = [
    ["G1 Z-2 F100\nG1 Z-4 F2", "G1 Z-2 F100\nG0 Z-4", "downward plunge"],
    ["G1 Z-2 F100\nG1 X5 F2", "G1 Z-2 F100\nG0 X5", "XY below safe Z"],
    ["G1 Z-2 F100\nG1 X5 Z5 F2", "G1 Z-2 F100\nG0 X5 Z5", "diagonal retract"],
    ["G1 Z-4 F100\nG1 Z-2 F2", "G1 Z-4 F100\nG0 Z-2", "retract ending below safe Z"],
  ];
  for (const [beforeSource, afterSource, label] of cases) {
    const result = verifyFissionPreview(
      parseGcodeProgram(`G21 G90\n${beforeSource}\n`),
      parseGcodeProgram(`G21 G90\n${afterSource}\n`),
      { rapidsRestored: 1 },
      { safeZ: 3 },
    );
    assert.equal(result.valid, false, label);
    assert.match(result.errors.join(" "), /not a safe upward retract or clearance-height XY move/i, label);
  }
});

test("independent preview rejects cutting-feed and spindle changes", () => {
  const before = parseGcodeProgram("G21 G90\nS5000 M3\nG0 Z5\nG1 X10 F500\n", { name: "a.nc" });
  const feedChanged = parseGcodeProgram("G21 G90\nS5000 M3\nG0 Z5\nG1 X10 F600\n", { name: "b.nc" });
  assert.equal(verifyFissionPreview(before, feedChanged, { rapidsRestored: 0 }).valid, false);

  const spindleChanged = parseGcodeProgram("G21 G90\nS6000 M3\nG0 Z5\nG1 X10 F500\n", { name: "c.nc" });
  assert.equal(verifyFissionPreview(before, spindleChanged, { rapidsRestored: 0 }).valid, false);
});
