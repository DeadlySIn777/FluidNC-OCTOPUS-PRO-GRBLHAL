import assert from "node:assert/strict";
import test from "node:test";
import {
  MACHINE_BUNDLE_FORMAT,
  MACHINE_BUNDLE_SCHEMA_VERSION,
  applyMachineBundle,
  captureMachineConfiguration,
  createMachineBundle,
  diffMachineConfigurations,
  normalizeMachineConfiguration,
  parseMachineBundle,
} from "../src/machine-bundle.js";
import {
  loadMachineIdentity,
  saveMachineIdentity,
} from "../src/machine-identity.js";
import {
  createCommissioningEvidence,
  upsertCommissioningEvidence,
} from "../src/commissioning-record.js";

const UUID = "12345678-1234-4123-8123-123456789ABC";
const NOW = "2026-08-27T16:00:00.000Z";

class MemoryStorage {
  constructor() {
    this.values = new Map();
    this.failOncePattern = null;
  }

  getItem(key) {
    return this.values.has(key) ? this.values.get(key) : null;
  }

  setItem(key, value) {
    if (this.failOncePattern?.test(key)) {
      this.failOncePattern = null;
      throw new Error("simulated storage failure");
    }
    this.values.set(key, String(value));
  }
}

function identity(storage) {
  return loadMachineIdentity(storage, { now: NOW, randomUUID: () => UUID });
}

test("machine identity is generated once and survives normalization", () => {
  const storage = new MemoryStorage();
  const first = identity(storage);
  const second = identity(storage);

  assert.equal(first.machineId, `MR1-${UUID}`);
  assert.deepEqual(second, first);
  const renamed = saveMachineIdentity({ ...first, label: "  Shop   MR-1  " }, storage, { now: NOW });
  assert.equal(renamed.label, "Shop MR-1");
  assert.equal(renamed.machineId, first.machineId);
});

test("machine bundle is versioned, canonical, and SHA-256 verified", async () => {
  const storage = new MemoryStorage();
  const bundle = await createMachineBundle({
    identity: identity(storage),
    createdAt: NOW,
    controller: {
      profile: "MR1_OCTOPUS_PRO_11_F429",
      transcriptSha256: "A".repeat(64),
      capturedAt: NOW,
      preflightPassed: true,
    },
    configuration: captureMachineConfiguration(storage),
  });
  const parsed = await parseMachineBundle(JSON.stringify(bundle));

  assert.equal(parsed.format, MACHINE_BUNDLE_FORMAT);
  assert.equal(parsed.schemaVersion, MACHINE_BUNDLE_SCHEMA_VERSION);
  assert.equal(parsed.integrity.algorithm, "SHA-256");
  assert.match(parsed.integrity.digest, /^[0-9A-F]{64}$/);
  assert.equal(parsed.controller.fingerprint, "A".repeat(64));
  assert.equal(parsed.controller.physicalMotionPermitted, false);
});

test("tampering and unsupported schemas fail before any configuration is exposed", async () => {
  const storage = new MemoryStorage();
  const bundle = await createMachineBundle({
    identity: identity(storage),
    createdAt: NOW,
    configuration: captureMachineConfiguration(storage),
  });
  const tampered = structuredClone(bundle);
  tampered.configuration.probing.toolSetter.maxSearch = 2.5;
  await assert.rejects(() => parseMachineBundle(JSON.stringify(tampered)), /integrity check failed/i);

  const wrongSchema = structuredClone(bundle);
  wrongSchema.schemaVersion = 99;
  await assert.rejects(() => parseMachineBundle(JSON.stringify(wrongSchema)), /unsupported machine bundle schema/i);
});

test("configuration diff reports exact changed paths without mutating either side", () => {
  const before = normalizeMachineConfiguration({});
  const after = structuredClone(before);
  after.probing.toolSetter.maxSearch = 2.5;
  after.metrology.name = "ENGINE BLOCK A";

  const diff = diffMachineConfigurations(before, after);
  assert.equal(diff.total, 2);
  assert.deepEqual(diff.changes.map(({ path }) => path), [
    "metrology.name",
    "probing.toolSetter.maxSearch",
  ]);
  assert.equal(before.probing.toolSetter.maxSearch, 3);
});

test("bundle application persists every section and adopts the machine identity", async () => {
  const sourceStorage = new MemoryStorage();
  const sourceIdentity = identity(sourceStorage);
  const incoming = captureMachineConfiguration(sourceStorage);
  incoming.probing.toolSetter.maxSearch = 2.5;
  incoming.metrology.name = "TRANSFER TEST";
  const commissioningContext = {
    machineId: sourceIdentity.machineId,
    firmwareSha256: "B".repeat(64),
  };
  incoming.wiringEvidence.commissioning = upsertCommissioningEvidence(
    incoming.wiringEvidence.commissioning,
    createCommissioningEvidence("source_release", {
      result: "pass",
      source: "document",
      operator: "TRANSFER TEST",
      artifact: { name: "release.json", bytes: 100, sha256: "C".repeat(64) },
    }, commissioningContext, { recordedAt: NOW }),
    commissioningContext,
  );
  const bundle = await createMachineBundle({
    identity: { ...sourceIdentity, label: "Primary MR-1" },
    createdAt: NOW,
    configuration: incoming,
  });

  const targetStorage = new MemoryStorage();
  identity(targetStorage);
  const applied = applyMachineBundle(bundle, {
    storage: targetStorage,
    identityOptions: { now: NOW, randomUUID: () => "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA" },
  });
  const reloaded = captureMachineConfiguration(targetStorage);

  assert.equal(reloaded.probing.toolSetter.maxSearch, 2.5);
  assert.equal(reloaded.metrology.name, "TRANSFER TEST");
  assert.equal(reloaded.wiringEvidence.commissioning.records.source_release.result, "pass");
  assert.equal(reloaded.wiringEvidence.commissioning.machineId, sourceIdentity.machineId);
  assert.equal(applied.identity.machineId, sourceIdentity.machineId);
  assert.equal(applied.identity.label, "Primary MR-1");
});

test("a failed multi-section import rolls back the previous machine state", async () => {
  const storage = new MemoryStorage();
  const originalIdentity = identity(storage);
  const original = captureMachineConfiguration(storage);
  const incoming = structuredClone(original);
  incoming.probing.toolSetter.maxSearch = 2.25;
  incoming.metrology.name = "MUST ROLL BACK";
  const bundle = await createMachineBundle({
    identity: { ...originalIdentity, label: "Imported" },
    createdAt: NOW,
    configuration: incoming,
  });

  storage.failOncePattern = /fission-import/;
  assert.throws(
    () => applyMachineBundle(bundle, { storage, identityOptions: { now: NOW, randomUUID: () => UUID } }),
    /simulated storage failure/i,
  );
  assert.deepEqual(captureMachineConfiguration(storage), original);
  assert.deepEqual(loadMachineIdentity(storage), originalIdentity);
});
