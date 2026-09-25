import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_FISSION_SOURCE_BYTES,
  createFissionProcessor,
} from "../service/fission-processor.mjs";

class FakeOptimizer {
  static options = null;

  constructor(options) {
    FakeOptimizer.options = options;
  }

  optimize(source) {
    return {
      content: source.replace("G1 X10 F2", "G0 X10"),
      stats: { rapidsRestored: 1, traversesRestored: 0, retractsRestored: 0, crawlsRestored: 1 },
      validated: true,
      blocked: false,
      wasHobbyFile: true,
    };
  }
}

const verifiedOptions = {
  safeZVerified: true,
  safeZ: 0.1,
  traverses: "auto",
  retracts: "off",
  rapidSpeed: 2540,
  rapidSpeedZ: 1016,
};

test("external adapter processes text without enabling an RPM cap", async () => {
  const processor = createFissionProcessor({ optimizerClass: FakeOptimizer });
  const source = "G21\nG90\nG0 Z5\nG1 X10 F2\n";
  const result = await processor.optimize({ source, options: verifiedOptions });
  assert.equal(result.validated, true);
  assert.match(result.content, /G0 X10/);
  assert.equal(result.stats.rapidsRestored, 1);
  assert.equal(result.sourceSha256.length, 64);
  assert.equal(result.outputSha256.length, 64);
  assert.equal(FakeOptimizer.options.maxRPM, null);
  assert.equal(FakeOptimizer.options.safeZ, 0.1);
  assert.equal(FakeOptimizer.options.restoreTraverses, undefined);
  assert.equal(FakeOptimizer.options.restoreRetracts, false);
});

test("safe Z must be explicitly verified", async () => {
  const processor = createFissionProcessor({ optimizerClass: FakeOptimizer });
  await assert.rejects(
    processor.optimize({ source: "G0 Z5", options: { ...verifiedOptions, safeZVerified: false } }),
    (error) => error.code === "SAFE_Z_NOT_VERIFIED" && error.statusCode === 422,
  );
});

test("invalid modes and oversized source are rejected", async () => {
  const processor = createFissionProcessor({ optimizerClass: FakeOptimizer });
  await assert.rejects(
    processor.optimize({ source: "G0 Z5", options: { ...verifiedOptions, traverses: "always" } }),
    (error) => error.code === "INVALID_OPTIONS",
  );
  await assert.rejects(
    processor.optimize({ source: "X".repeat(MAX_FISSION_SOURCE_BYTES + 1), options: verifiedOptions }),
    (error) => error.code === "INVALID_SOURCE",
  );
});

test("a blocked external result is never returned as usable output", async () => {
  class BlockedOptimizer {
    optimize() {
      return { blocked: true, reason: "unsafe-output", safetyErrors: ["introduced rapid plunge"] };
    }
  }
  const processor = createFissionProcessor({ optimizerClass: BlockedOptimizer });
  await assert.rejects(
    processor.optimize({ source: "G0 Z5", options: verifiedOptions }),
    (error) => error.code === "FISSION_BLOCKED" && /rapid plunge/.test(error.message),
  );
});

test("a disabled external path reports unavailable without loading code", () => {
  const status = createFissionProcessor({ rootPath: false }).status();
  assert.equal(status.available, false);
  assert.equal(status.reason, "disabled");
});
