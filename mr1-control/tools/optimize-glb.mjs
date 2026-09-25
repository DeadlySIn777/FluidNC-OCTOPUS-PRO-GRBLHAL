#!/usr/bin/env node

import { mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { NodeIO } from "@gltf-transform/core";
import { EXTMeshoptCompression, KHRMeshQuantization } from "@gltf-transform/extensions";
import {
  dedup,
  flatten,
  join,
  meshopt,
  prune,
  simplify,
  weld,
} from "@gltf-transform/functions";
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from "meshoptimizer";

const argumentsList = process.argv.slice(2);
const inputArgument = argumentsList[0];
const outputArgument = argumentsList[1];
if (!inputArgument || !outputArgument) {
  console.error(
    "Usage: node tools/optimize-glb.mjs INPUT.glb OUTPUT.glb [--ratio N] [--error N] [--keep-hierarchy]",
  );
  process.exit(1);
}

function readNumberOption(name, fallback) {
  const index = argumentsList.indexOf(name);
  if (index === -1) return fallback;
  const value = Number(argumentsList[index + 1]);
  if (!Number.isFinite(value)) throw new Error(`${name} requires a number.`);
  return value;
}

const ratio = readNumberOption("--ratio", 0.02);
const error = readNumberOption("--error", 0.0005);
const keepHierarchy = argumentsList.includes("--keep-hierarchy");
if (ratio <= 0 || ratio > 1) throw new Error("--ratio must be greater than 0 and at most 1.");
if (error < 0) throw new Error("--error must be zero or greater.");

const input = path.resolve(inputArgument);
const output = path.resolve(outputArgument);
await mkdir(path.dirname(output), { recursive: true });
await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready, MeshoptSimplifier.ready]);

const io = new NodeIO()
  .registerExtensions([EXTMeshoptCompression, KHRMeshQuantization])
  .registerDependencies({
    "meshopt.decoder": MeshoptDecoder,
    "meshopt.encoder": MeshoptEncoder,
  });
const document = await io.read(input);

const transforms = [dedup()];
if (!keepHierarchy) transforms.push(flatten(), join({ keepNamed: false }));
transforms.push(
  weld(),
  simplify({
    simplifier: MeshoptSimplifier,
    ratio,
    error,
    lockBorder: false,
  }),
  prune(),
  meshopt({ encoder: MeshoptEncoder, level: "high" }),
);
await document.transform(...transforms);

await io.write(output, document);
const [inputStats, outputStats] = await Promise.all([stat(input), stat(output)]);
console.log(JSON.stringify({
  input,
  output,
  inputBytes: inputStats.size,
  outputBytes: outputStats.size,
  reductionPercent: Number((100 - (outputStats.size / inputStats.size) * 100).toFixed(2)),
  ratio,
  error,
  keepHierarchy,
}, null, 2));
