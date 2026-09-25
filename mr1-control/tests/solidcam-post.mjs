import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const gppPath = path.join(appRoot, "post-processors", "solidcam", "MR1_grblHAL.gpp");
const installerPath = path.join(appRoot, "post-processors", "solidcam", "install-mr1-solidcam-post.ps1");
const fixturePath = path.join(appRoot, "tests", "fixtures", "solidcam-3axis-template.vmid");

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function powershell(args) {
  return spawnSync("powershell.exe", [
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-File", installerPath,
    ...args,
  ], { encoding: "utf8" });
}

test("SolidCAM GPPL source is structurally balanced and fail-closed", () => {
  const source = readFileSync(gppPath, "utf8");
  const codeLines = source.split(/\r?\n/).map((line) => line.replace(/;.*$/, ""));
  const procedures = codeLines
    .map((line) => line.match(/^\s*@([A-Za-z0-9_]+)/)?.[1])
    .filter(Boolean);
  const uniqueProcedures = new Set(procedures);

  assert.equal(procedures.length, uniqueProcedures.size, "GPPL procedures must be unique");
  assert.equal(codeLines.filter((line) => /^\s*endp\b/i.test(line)).length, procedures.length);
  assert.equal(codeLines.filter((line) => /^\s*if\b/i.test(line)).length, codeLines.filter((line) => /^\s*endif\b/i.test(line)).length);
  assert.equal(codeLines.filter((line) => /^\s*while\b/i.test(line)).length, codeLines.filter((line) => /^\s*endw\b/i.test(line)).length);

  for (const name of [
    "init_post", "start_program", "end_program", "rapid_move", "line", "arc",
    "change_tool", "start_tool", "drill", "drill_point", "compensation", "mr1_block",
  ]) {
    assert.ok(uniqueProcedures.has(name), `Missing @${name}`);
  }
  for (const marker of [
    "RIGID TAPPING IS NOT COMMISSIONED",
    "M4 REVERSE SPINDLE IS NOT COMMISSIONED",
    "G41 OR G42 CUTTER COMPENSATION REQUESTED",
    "ROTARY AXES ARE NOT COMMISSIONED",
    "SUBPROGRAM CALLS ARE OUTSIDE THE MR-1 POST CONTRACT",
    "G90 G53 G0 Z",
    "PROTECTED TOOL SETTER CYCLE",
  ]) {
    assert.match(source, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("SolidCAM installer creates a version-native MR-1 VMID without changing its template", () => {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), "mr1-solidcam-test-"));
  try {
    const original = readFileSync(fixturePath);
    const result = powershell(["-BaseVmid", fixturePath, "-OutputDirectory", tempRoot, "-Force"]);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.equal(sha256(readFileSync(fixturePath)), sha256(original), "The selected base VMID must remain untouched");

    const vmid = readFileSync(path.join(tempRoot, "MR1_grblHAL.vmid"), "utf8");
    const gpp = readFileSync(path.join(tempRoot, "MR1_grblHAL.gpp"), "utf8");
    const manifest = JSON.parse(readFileSync(path.join(tempRoot, "MR1_grblHAL.install.json"), "utf8"));
    assert.match(vmid, /Name="MR1_grblHAL"/);
    assert.match(vmid, /ControllerName="grblHAL"/);
    assert.match(vmid, /Name="X"[^>]*HomeRef="-2"[^>]*MinLim="-564\.42"[^>]*MaxLim="-2"/s);
    assert.match(vmid, /Name="Y"[^>]*HomeRef="-2"[^>]*MinLim="-544\.10"[^>]*MaxLim="-2"/s);
    assert.match(vmid, /Name="Z"[^>]*HomeRef="-2"[^>]*MinLim="-152\.94"[^>]*MaxLim="-2"/s);
    assert.match(vmid, /Name="Spindle"[^>]*MaxSpin="8000"/s);
    assert.equal(gpp, readFileSync(gppPath, "utf8"));
    assert.equal(manifest.contractVersion, "1.0.0");
    assert.equal(manifest.spindleMaxRpm, 8000);
    assert.equal(manifest.outputVmidSha256.toLowerCase(), sha256(readFileSync(path.join(tempRoot, "MR1_grblHAL.vmid"))));
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("SolidCAM installer rejects rotary templates and XML document types", () => {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), "mr1-solidcam-reject-"));
  try {
    const source = readFileSync(fixturePath, "utf8");
    const rotaryPath = path.join(tempRoot, "rotary.vmid");
    writeFileSync(rotaryPath, source.replace("</Axes>", '<Axis Name="A" Type="1" /></Axes>'));
    const rotary = powershell(["-BaseVmid", rotaryPath, "-OutputDirectory", path.join(tempRoot, "rotary-out")]);
    assert.notEqual(rotary.status, 0);
    assert.match(`${rotary.stdout}\n${rotary.stderr}`, /exactly three linear X\/Y\/Z axes/i);

    const dtdPath = path.join(tempRoot, "dtd.vmid");
    writeFileSync(dtdPath, '<?xml version="1.0"?><!DOCTYPE Machine [<!ENTITY xxe SYSTEM "file:///C:/Windows/win.ini">]><Machine Name="&xxe;" />');
    const dtd = powershell(["-BaseVmid", dtdPath, "-OutputDirectory", path.join(tempRoot, "dtd-out")]);
    assert.notEqual(dtd.status, 0);
    assert.match(`${dtd.stdout}\n${dtd.stderr}`, /(DTD|document type)/i);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});
