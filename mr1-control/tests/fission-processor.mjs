import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

test("pinned external source is re-verified before every load and use", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "mr1-fission-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "src"));
  const optimizer = "module.exports = class { optimize(source) { globalThis.mr1FissionLoads = (globalThis.mr1FissionLoads ?? 0) + 1; return { content: source, stats: {}, validated: true, blocked: false }; } };\n";
  const parser = "module.exports = {};\n";
  await writeFile(join(root, "package.json"), JSON.stringify({ name: "fusionbypass", version: "test" }));
  await writeFile(join(root, "LICENSE"), "test");
  await writeFile(join(root, "src", "optimizer.js"), optimizer);
  await writeFile(join(root, "src", "gcode-parser.js"), parser);
  const sha = (text) => createHash("sha256").update(text).digest("hex").toUpperCase();
  const locked = (error) => error.code === "FISSION_UNAVAILABLE" && error.statusCode === 503;

  // A status read before the change must not be trusted when the code is first loaded.
  const early = createFissionProcessor({ rootPath: root, expectedHashes: { optimizer: sha(optimizer), parser: sha(parser) } });
  assert.equal(early.status().available, true);
  await writeFile(join(root, "src", "gcode-parser.js"), "module.exports = { changed: true };\n");
  await assert.rejects(early.optimize({ source: "G0 Z5", options: verifiedOptions }), locked);
  assert.equal(globalThis.mr1FissionLoads, undefined, "changed code was never run");
  await writeFile(join(root, "src", "gcode-parser.js"), parser);

  // Once loaded, a later on-disk change still locks processing.
  const processor = createFissionProcessor({ rootPath: root, expectedHashes: { optimizer: sha(optimizer), parser: sha(parser) } });
  assert.equal((await processor.optimize({ source: "G0 Z5", options: verifiedOptions })).validated, true);
  await writeFile(join(root, "src", "optimizer.js"), optimizer.replace("stats: {}", "stats: { changed: 1 }"));
  await assert.rejects(processor.optimize({ source: "G0 Z5", options: verifiedOptions }), locked);
  assert.equal(globalThis.mr1FissionLoads, 1);
});
