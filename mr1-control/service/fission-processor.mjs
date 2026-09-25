import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";

export const REVIEWED_FISSION_HASHES = Object.freeze({
  optimizer: "CCC3866C74070177C2BAC4C28FC91322C8A7C5841D37055537A60D26C021BBDA",
  parser: "AE0EFD413F5FD9191E9EB33CE94CB7B599B08650963E2402BF4E36B27F28090E",
});

export const MAX_FISSION_SOURCE_BYTES = 25 * 1024 * 1024;

function sha256Buffer(value) {
  return createHash("sha256").update(value).digest("hex").toUpperCase();
}

function sha256File(path) {
  return sha256Buffer(readFileSync(path));
}

function processorError(code, message, statusCode = 422) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function modeValue(value, label) {
  const mode = String(value ?? "auto").toLowerCase();
  if (!new Set(["auto", "on", "off"]).has(mode)) {
    throw processorError("INVALID_OPTIONS", `${label} must be auto, on, or off.`);
  }
  return mode === "auto" ? undefined : mode === "on";
}

function finiteInRange(value, minimum, maximum, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < minimum || number > maximum) {
    throw processorError("INVALID_OPTIONS", `${label} must be between ${minimum} and ${maximum}.`);
  }
  return number;
}

function sanitizeOptions(options = {}) {
  if (options.safeZVerified !== true) {
    throw processorError("SAFE_Z_NOT_VERIFIED", "Work-coordinate safe Z must be explicitly verified before rapid restoration.");
  }
  return {
    controller: "grblHAL MR-1",
    material: "CAM SOURCE",
    maxRPM: null,
    safeZ: finiteInRange(options.safeZ, -1000, 1000, "Safe Z"),
    rapidSpeed: finiteInRange(options.rapidSpeed ?? 2540, 1, 100000, "XY rapid speed"),
    rapidSpeedZ: finiteInRange(options.rapidSpeedZ ?? 1016, 1, 100000, "Z rapid speed"),
    restoreTraverses: modeValue(options.traverses, "Traverse mode"),
    restoreRetracts: modeValue(options.retracts, "Retract mode"),
  };
}

export function defaultFissionRoot() {
  return join(homedir(), "Downloads", "FissionBypassPro", "FissionBypassPro");
}

export function createFissionProcessor(options = {}) {
  const configuredRoot = options.rootPath === false
    ? null
    : resolve(options.rootPath || defaultFissionRoot());
  const expectedHashes = options.expectedHashes ?? REVIEWED_FISSION_HASHES;
  const injectedOptimizer = options.optimizerClass ?? null;
  const require = createRequire(import.meta.url);
  let inspection = null;
  let Optimizer = injectedOptimizer;
  let busy = false;

  function inspect() {
    if (inspection) return inspection;
    if (injectedOptimizer) {
      inspection = {
        available: true,
        reviewed: true,
        version: "test-adapter",
        source: "injected",
        optimizerSha256: null,
        parserSha256: null,
      };
      return inspection;
    }
    if (!configuredRoot) {
      inspection = { available: false, reviewed: false, reason: "disabled" };
      return inspection;
    }

    try {
      const root = realpathSync(configuredRoot);
      const packagePath = join(root, "package.json");
      const licensePath = join(root, "LICENSE");
      const optimizerPath = join(root, "src", "optimizer.js");
      const parserPath = join(root, "src", "gcode-parser.js");
      for (const path of [packagePath, licensePath, optimizerPath, parserPath]) {
        if (!existsSync(path)) throw new Error(`Required file is missing: ${basename(path)}`);
      }
      const packageData = JSON.parse(readFileSync(packagePath, "utf8"));
      if (packageData.name !== "fusionbypass") throw new Error("Package identity is not fusionbypass.");
      const optimizerSha256 = sha256File(optimizerPath);
      const parserSha256 = sha256File(parserPath);
      const reviewed = optimizerSha256 === expectedHashes.optimizer
        && parserSha256 === expectedHashes.parser;
      inspection = {
        available: reviewed,
        reviewed,
        reason: reviewed ? null : "source-hash-mismatch",
        version: String(packageData.version ?? "unknown"),
        source: "external-node-api",
        optimizerSha256,
        parserSha256,
        root,
        optimizerPath,
      };
    } catch (error) {
      inspection = {
        available: false,
        reviewed: false,
        reason: error instanceof Error ? error.message : String(error),
      };
    }
    return inspection;
  }

  function loadOptimizer() {
    const status = inspect();
    if (!status.available) {
      throw processorError(
        "FISSION_UNAVAILABLE",
        status.reason === "source-hash-mismatch"
          ? "Fission source changed after review; automatic processing is locked."
          : "Reviewed Fission optimizer source is unavailable.",
        503,
      );
    }
    if (!Optimizer) {
      const loaded = require(status.optimizerPath);
      if (typeof loaded !== "function" || typeof loaded.prototype?.optimize !== "function") {
        throw processorError("FISSION_INVALID", "Fission optimizer API is not compatible.", 503);
      }
      Optimizer = loaded;
    }
    return Optimizer;
  }

  return {
    status() {
      const { root, optimizerPath, ...publicStatus } = inspect();
      return { ...publicStatus, busy };
    },

    async optimize(payload = {}) {
      if (busy) throw processorError("FISSION_BUSY", "Fission processor is already handling a file.", 409);
      if (typeof payload.source !== "string") {
        throw processorError("INVALID_SOURCE", "G-code source must be text.");
      }
      const byteLength = Buffer.byteLength(payload.source, "utf8");
      if (byteLength === 0 || byteLength > MAX_FISSION_SOURCE_BYTES) {
        throw processorError("INVALID_SOURCE", `G-code source must be between 1 byte and ${MAX_FISSION_SOURCE_BYTES} bytes.`);
      }
      const optimizerOptions = sanitizeOptions(payload.options);
      busy = true;
      try {
        const OptimizerClass = loadOptimizer();
        const result = new OptimizerClass(optimizerOptions).optimize(payload.source);
        if (result?.blocked) {
          throw processorError(
            "FISSION_BLOCKED",
            [result.reason, ...(result.safetyErrors ?? [])].filter(Boolean).join(" / ") || "Fission safety validation blocked the file.",
          );
        }
        if (!result?.validated || typeof result.content !== "string" || !result.stats) {
          throw processorError("FISSION_INVALID", "Fission did not return a validated result.", 503);
        }
        const status = inspect();
        return {
          content: result.content,
          stats: result.stats,
          validated: true,
          wasHobbyFile: Boolean(result.wasHobbyFile),
          sourceSha256: sha256Buffer(payload.source),
          outputSha256: sha256Buffer(result.content),
          adapter: {
            version: status.version,
            optimizerSha256: status.optimizerSha256,
            parserSha256: status.parserSha256,
            execution: "external-node-api",
          },
        };
      } finally {
        busy = false;
      }
    },
  };
}
