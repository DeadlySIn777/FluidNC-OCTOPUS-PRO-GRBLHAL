import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  FIRMWARE_FLASH_ATTESTATIONS,
  createFirmwareFlashRecord,
  evaluateFirmwareFlashEvidence,
  verifyFirmwareCandidateFile,
  verifyFirmwareFlashRecord,
} from "../src/firmware-verification.js";
import { OCTOPUS_FIRMWARE_CANDIDATE } from "../src/wiring-installation.js";

// Synthetic bytes exercise evidence gates without redistributing an actual firmware image.
const firmware = Buffer.from('MR1 SYNTHETIC FIRMWARE VERIFICATION FIXTURE - NOT FLASHABLE');
const TEST_CANDIDATE = { ...OCTOPUS_FIRMWARE_CANDIDATE, bytes: firmware.length,
  sha256: createHash('sha256').update(firmware).digest('hex').toUpperCase() };
const firmwareUrl = new URL('../public/firmware/octopus-pro-v1.1-f429-mr1/firmware.bin', import.meta.url);

function localFile(name, bytes = firmware, options = {}) {
  const body = Buffer.from(bytes);
  return {
    name,
    size: options.size ?? body.length,
    lastModified: options.lastModified ?? Date.parse("2026-08-27T12:00:00.000Z"),
    arrayBuffer: options.arrayBuffer ?? (async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength)),
  };
}

function confirmedAttestations() {
  return Object.fromEntries(FIRMWARE_FLASH_ATTESTATIONS.map(({ id }) => [id, true]));
}

function physicalPreflight() {
  return {
    protocol: "mr1-controller-preflight-v1",
    preflightPassed: true,
    simulated: false,
    boardIdentityPresent: true,
    reportAvailable: true,
    transcriptSha256: "A".repeat(64),
    profile: "btt_octopus_pro_f429_mr1",
    source: "serial:COM7@115200",
    capturedAt: new Date(Date.now() - 1000).toISOString(),
    machineState: "Alarm",
    activePins: "",
    queryPolicy: "read-only-allow-list",
    counts: { settingsPassed: 66, settingsExpected: 66, blockers: 0, warnings: 0 },
  };
}

test("synthetic source-file contract verifies byte count and SHA-256", async () => {
  const result = await verifyFirmwareCandidateFile(localFile("firmware.bin"), TEST_CANDIDATE);
  assert.equal(result.contentVerified, true);
  assert.equal(result.sourceReady, true);
  assert.equal(result.cardResultVerified, false);
  assert.equal(result.sha256, TEST_CANDIDATE.sha256);
  assert.match(result.status, /SOURCE IMAGE VERIFIED/);
  assert.equal(result.physicalMotionPermitted, false);
});

test("post-flash FIRMWARE.CUR is distinguished from the source image", async () => {
  const result = await verifyFirmwareCandidateFile(localFile("FIRMWARE.CUR"), TEST_CANDIDATE);
  assert.equal(result.contentVerified, true);
  assert.equal(result.sourceReady, false);
  assert.equal(result.cardResultVerified, true);
  assert.match(result.status, /CARD RESULT VERIFIED/);
});

test("matching content under an unsafe filename requires a rename", async () => {
  const result = await verifyFirmwareCandidateFile(localFile("firmware (1).bin"), TEST_CANDIDATE);
  assert.equal(result.contentVerified, true);
  assert.equal(result.fileRole, "unexpected-name");
  assert.equal(result.sourceReady, false);
  assert.equal(result.cardResultVerified, false);
  assert.match(result.errors.join(" "), /RENAME TO firmware\.bin/);
});

test("same-size content drift is rejected by SHA-256", async () => {
  const changed = Buffer.from(firmware);
  changed[changed.length - 1] ^= 0xff;
  const result = await verifyFirmwareCandidateFile(localFile("firmware.bin", changed), TEST_CANDIDATE);
  assert.equal(result.byteCountMatches, true);
  assert.equal(result.sha256Matches, false);
  assert.equal(result.contentVerified, false);
  assert.match(result.errors.join(" "), /SHA-256 DOES NOT MATCH/);
});

test("oversized input is rejected without reading its body", async () => {
  let reads = 0;
  const result = await verifyFirmwareCandidateFile(localFile("firmware.bin", Buffer.alloc(0), {
    size: 2 * 1024 * 1024 + 1,
    arrayBuffer: async () => {
      reads += 1;
      return new ArrayBuffer(0);
    },
  }), TEST_CANDIDATE);
  assert.equal(reads, 0);
  assert.equal(result.contentVerified, false);
  assert.match(result.errors.join(" "), /2 MIB/);
});

test("simulation can never satisfy the physical preflight gate", async () => {
  const verification = await verifyFirmwareCandidateFile(localFile("FIRMWARE.CUR"), TEST_CANDIDATE);
  const evaluation = evaluateFirmwareFlashEvidence({
    verification,
    attestations: confirmedAttestations(),
    preflight: { ...physicalPreflight(), simulated: true, source: "simulation" },
    candidate: TEST_CANDIDATE,
  });
  assert.equal(evaluation.passed, 3);
  assert.equal(evaluation.gates.physicalPreflight, false);
  assert.equal(evaluation.readyToArchive, false);
  assert.equal(evaluation.physicalMotionPermitted, false);
});

test("wrong profile and nonserial source cannot satisfy physical preflight", async () => {
  const verification = await verifyFirmwareCandidateFile(localFile("FIRMWARE.CUR"), TEST_CANDIDATE);
  for (const preflight of [
    { ...physicalPreflight(), profile: "different-controller" },
    { ...physicalPreflight(), source: "cached-report" },
  ]) {
    const evaluation = evaluateFirmwareFlashEvidence({
      verification,
      attestations: confirmedAttestations(),
      preflight,
      candidate: TEST_CANDIDATE,
    });
    assert.equal(evaluation.gates.physicalPreflight, false);
    assert.match(evaluation.preflight.status, /REJECTED/);
  }
});

test("stale preflight and nonexact settings are rejected", async () => {
  const verification = await verifyFirmwareCandidateFile(localFile("FIRMWARE.CUR"), TEST_CANDIDATE);
  const candidates = [
    { ...physicalPreflight(), capturedAt: new Date(Date.now() - 16 * 60 * 1000).toISOString() },
    { ...physicalPreflight(), counts: { settingsPassed: 65, settingsExpected: 66, blockers: 0, warnings: 1 } },
  ];
  for (const preflight of candidates) {
    const evaluation = evaluateFirmwareFlashEvidence({
      verification,
      attestations: confirmedAttestations(),
      preflight,
      candidate: TEST_CANDIDATE,
    });
    assert.equal(evaluation.gates.physicalPreflight, false);
    assert.match(evaluation.preflight.status, /REJECTED/);
  }
});

test("active inputs and a running controller are rejected", async () => {
  const verification = await verifyFirmwareCandidateFile(localFile("FIRMWARE.CUR"), TEST_CANDIDATE);
  for (const preflight of [
    { ...physicalPreflight(), activePins: "P" },
    { ...physicalPreflight(), machineState: "Run" },
  ]) {
    const evaluation = evaluateFirmwareFlashEvidence({
      verification,
      attestations: confirmedAttestations(),
      preflight,
      candidate: TEST_CANDIDATE,
    });
    assert.equal(evaluation.gates.physicalPreflight, false);
    assert.match(evaluation.preflight.status, /REJECTED/);
  }
});

test("sealed flash record requires all independent evidence gates", async () => {
  const verification = await verifyFirmwareCandidateFile(localFile("FIRMWARE.CUR"), TEST_CANDIDATE);
  const record = await createFirmwareFlashRecord({
    verification,
    attestations: confirmedAttestations(),
    preflight: physicalPreflight(),
    candidate: TEST_CANDIDATE,
    machine: { id: "MR1-TEST", name: "MR-1" },
    createdAt: "2026-08-27T12:10:00.000Z",
  });
  assert.equal(record.cardResult.filename, "FIRMWARE.CUR");
  assert.equal(record.controllerPreflight.simulated, false);
  assert.equal(record.controllerPreflight.profile, TEST_CANDIDATE.preflightProfile);
  assert.deepEqual(record.controllerPreflight.counts, {
    settingsPassed: 66,
    settingsExpected: 66,
    blockers: 0,
    warnings: 0,
  });
  assert.equal(record.physicalMotionPermitted, false);
  assert.equal(await verifyFirmwareFlashRecord(record), true);
});

test("flash-record integrity detects later editing", async () => {
  const verification = await verifyFirmwareCandidateFile(localFile("FIRMWARE.CUR"), TEST_CANDIDATE);
  const record = await createFirmwareFlashRecord({
    verification,
    attestations: confirmedAttestations(),
    preflight: physicalPreflight(),
    candidate: TEST_CANDIDATE,
  });
  const edited = { ...record, physicalMotionPermitted: true };
  assert.equal(await verifyFirmwareFlashRecord(edited), false);
});

test('optional production source image matches its immutable SHA-256 contract', { skip: !existsSync(firmwareUrl) && 'Optional local firmware image not imported.' }, async () => {
  const result = await verifyFirmwareCandidateFile(localFile('firmware.bin', readFileSync(firmwareUrl)), OCTOPUS_FIRMWARE_CANDIDATE);
  assert.equal(result.contentVerified, true);
  assert.equal(result.sha256, OCTOPUS_FIRMWARE_CANDIDATE.sha256);
});
test('synthetic content cannot authenticate as the production image', async () => {
  const result = await verifyFirmwareCandidateFile(localFile('firmware.bin', Buffer.alloc(OCTOPUS_FIRMWARE_CANDIDATE.bytes, 0x5A)), OCTOPUS_FIRMWARE_CANDIDATE);
  assert.equal(result.byteCountMatches, true); assert.equal(result.contentVerified, false); assert.equal(result.sha256Matches, false);
});
