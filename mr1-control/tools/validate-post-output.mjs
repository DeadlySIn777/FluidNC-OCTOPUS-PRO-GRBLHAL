#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { validateMr1Nc } from "../src/nc-safety-validator.js";

function printIssue(kind, item) {
  const location = item.line > 0 ? `line ${item.line}` : "program";
  process.stdout.write(`${kind} ${location} [${item.code}] ${item.message}\n`);
  // Never echo raw control or realtime bytes from a rejected file.
  const source = String(item.source ?? "").replace(/[^\x20-\x7e]/g, (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`);
  if (source) process.stdout.write(`  ${source}\n`);
}

export async function validateFiles(filePaths) {
  let failed = false;
  for (const inputPath of filePaths) {
    const absolutePath = path.resolve(inputPath);
    let source;
    try {
      source = await readFile(absolutePath, "utf8");
    } catch (error) {
      failed = true;
      process.stderr.write(`BLOCK ${absolutePath}: ${error.message}\n`);
      continue;
    }

    const result = validateMr1Nc(source, { name: path.basename(absolutePath) });
    process.stdout.write(`\n${result.ok ? "PASS" : "BLOCK"} ${absolutePath}\n`);
    for (const item of result.blockers) printIssue("BLOCK", item);
    for (const item of result.warnings) printIssue("WARN ", item);
    process.stdout.write(`  ${JSON.stringify(result.summary)}\n`);
    failed ||= !result.ok;
  }
  return failed ? 1 : 0;
}

const isEntryPoint = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntryPoint) {
  const filePaths = process.argv.slice(2);
  if (filePaths.length === 0) {
    process.stderr.write("Usage: node tools/validate-post-output.mjs <program.nc> [more.nc ...]\n");
    process.exitCode = 2;
  } else {
    process.exitCode = await validateFiles(filePaths);
  }
}
