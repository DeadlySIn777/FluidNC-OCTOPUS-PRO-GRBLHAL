#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { validateMr1Nc } from "../src/nc-safety-validator.js";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cpsPath = path.join(appRoot, "post-processors", "fusion", "MR1_grblHAL.cps");
const examplesRoot = path.join(appRoot, "post-processors", "examples");

function versionParts(value) {
  return String(value).match(/\d+(?:\.\d+)+/)?.[0].split(".").map(Number) ?? [0];
}

function compareVersions(left, right) {
  const a = versionParts(left);
  const b = versionParts(right);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference) return difference;
  }
  return 0;
}

function findPostEngine() {
  if (process.env.MR1_FUSION_POST_ENGINE) return path.resolve(process.env.MR1_FUSION_POST_ENGINE);
  const productionRoot = path.join(process.env.LOCALAPPDATA ?? "", "Autodesk", "webdeploy", "production");
  if (!existsSync(productionRoot)) return null;
  const candidates = readdirSync(productionRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(productionRoot, entry.name, "Applications", "CAM360", "post.exe"))
    .filter(existsSync)
    .map((candidate) => {
      const result = spawnSync(candidate, ["--version"], { encoding: "utf8" });
      return { candidate, version: `${result.stdout ?? ""}${result.stderr ?? ""}` };
    })
    .sort((left, right) => compareVersions(right.version, left.version));
  return candidates[0]?.candidate ?? null;
}

function findBenchmarkRoot() {
  if (process.env.MR1_FUSION_BENCHMARK_ROOT) return path.resolve(process.env.MR1_FUSION_BENCHMARK_ROOT);
  const extensionRoot = path.join(process.env.USERPROFILE ?? "", ".vscode", "extensions");
  if (!existsSync(extensionRoot)) return null;
  const extensions = readdirSync(extensionRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("autodesk.hsm-post-processor-"))
    .map((entry) => entry.name)
    .sort((left, right) => compareVersions(right, left));
  const root = extensions[0]
    ? path.join(extensionRoot, extensions[0], "res", "CNC files", "Milling")
    : null;
  return root && existsSync(root) ? root : null;
}

function runPost(postEngine, benchmarkRoot, testCase) {
  const inputPath = path.join(benchmarkRoot, ...testCase.input);
  const outputPath = path.join(examplesRoot, `${testCase.name}.nc`);
  const failedOutputPath = `${outputPath}.failed`;
  const logPath = path.join(examplesRoot, `${testCase.name}.log`);
  assert.ok(existsSync(inputPath), `Missing Autodesk benchmark: ${inputPath}`);
  for (const stalePath of [outputPath, failedOutputPath, logPath, `${outputPath}.bak`]) {
    rmSync(stalePath, { force: true });
  }

  const result = spawnSync(postEngine, [
    "--noeditor",
    "--noprogress",
    "--nointeraction",
    "--nobackup",
    "--warningsaserrors",
    "--log", logPath,
    cpsPath,
    inputPath,
    outputPath,
  ], { encoding: "utf8" });

  const log = existsSync(logPath) ? readFileSync(logPath, "utf8") : "";
  if (testCase.shouldPass) {
    assert.equal(result.status, 0, `${testCase.name} failed:\n${result.stdout}\n${result.stderr}\n${log}`);
    const source = readFileSync(outputPath, "utf8");
    const validation = validateMr1Nc(source, { name: testCase.name });
    assert.equal(validation.ok, true, `${testCase.name} failed MR-1 validation:\n${JSON.stringify(validation.blockers, null, 2)}`);
    return { name: testCase.name, verdict: "PASS", details: validation.summary };
  }

  assert.notEqual(result.status, 0, `${testCase.name} unexpectedly posted successfully.`);
  const diagnostics = `${result.stdout}\n${result.stderr}\n${log}`;
  assert.match(diagnostics, /MR-1 POST BLOCKED/i, `${testCase.name} did not fail closed with an MR-1 marker.`);
  assert.match(diagnostics, testCase.expected, `${testCase.name} did not report the expected refusal.`);
  return { name: testCase.name, verdict: "BLOCKED", details: testCase.expected.source };
}

const postEngine = findPostEngine();
const benchmarkRoot = findBenchmarkRoot();
assert.ok(postEngine && existsSync(postEngine), "Autodesk Fusion post.exe was not found. Set MR1_FUSION_POST_ENGINE.");
assert.ok(benchmarkRoot && statSync(benchmarkRoot).isDirectory(), "Autodesk Post Processor Utility benchmarks were not found. Set MR1_FUSION_BENCHMARK_ROOT.");

const interrogation = spawnSync(postEngine, ["--interrogate", cpsPath], { encoding: "utf8" });
assert.equal(interrogation.status, 0, `Fusion post interrogation failed:\n${interrogation.stdout}\n${interrogation.stderr}`);

const cases = [
  { name: "fusion-face", input: ["2D", "face.cnc"], shouldPass: true },
  { name: "fusion-toolchange", input: ["2D", "toolchange.cnc"], shouldPass: true },
  { name: "fusion-deep-drilling", input: ["Drilling", "deep drilling.cnc"], shouldPass: true },
  { name: "fusion-thread-mill", input: ["Drilling", "thread mill.cnc"], shouldPass: true },
  { name: "fusion-right-tapping-blocked", input: ["Drilling", "right tapping.cnc"], shouldPass: false, expected: /rigid tapping/i },
  { name: "fusion-probing-blocked", input: ["Probing", "angled probing.cnc"], shouldPass: false, expected: /prob/i },
  { name: "fusion-tilted-blocked", input: ["3+2", "a30.cnc"], shouldPass: false, expected: /(tilted|multi-axis|work ?plane)/i },
  { name: "fusion-cutter-comp-blocked", input: ["2D", "compensation.cnc"], shouldPass: false, expected: /cutter compensation/i },
];

const results = cases.map((testCase) => runPost(postEngine, benchmarkRoot, testCase));
for (const result of results) {
  process.stdout.write(`${result.verdict.padEnd(7)} ${result.name} ${JSON.stringify(result.details)}\n`);
}
process.stdout.write(`Fusion post acceptance: ${results.length}/${results.length} expected verdicts.\n`);
