import assert from "node:assert/strict";
import test from "node:test";
import {
  COMMISSIONING_CHECKS,
  COMMISSIONING_FORMAT,
  COMMISSIONING_STAGES,
  commissioningCheck,
  createCommissioningBundle,
  createCommissioningEvidence,
  evaluateCommissioningRecord,
  normalizeCommissioningRecord,
  parseCommissioningBundle,
  removeCommissioningEvidence,
  upsertCommissioningEvidence,
} from "../src/commissioning-record.js";

const NOW = "2026-08-28T18:00:00.000Z";
const MACHINE_ID = "MR1-12345678-1234-4123-8123-123456789ABC";
const CONTROLLER = "A".repeat(64);
const FIRMWARE = "B".repeat(64);
const ARTIFACT = Object.freeze({
  name: "scope-capture.zip",
  bytes: 4096,
  sha256: "C".repeat(64),
});
const CONTEXT = Object.freeze({
  machineId: MACHINE_ID,
  controllerFingerprint: CONTROLLER,
  firmwareSha256: FIRMWARE,
  controllerSimulated: false,
});

function passingEvidence(check, overrides = {}) {
  return createCommissioningEvidence(check.id, {
    result: "pass",
    source: check.acceptedSources[0],
    operator: "GLUIS",
    instrument: check.requiresInstrument ? "KEYSIGHT DSOX1204G" : "",
    instrumentId: check.requiresInstrument ? "SHOP-SCOPE-01" : "",
    value: check.requiresInstrument ? "PASS" : "",
    unit: check.requiresInstrument ? "CAPTURE" : "",
    artifact: ARTIFACT,
    notes: "Acceptance criterion reviewed.",
    ...overrides,
  }, CONTEXT, { recordedAt: NOW });
}

function completeRecord() {
  let record = normalizeCommissioningRecord();
  for (const check of COMMISSIONING_CHECKS) {
    record = upsertCommissioningEvidence(record, passingEvidence(check), CONTEXT);
  }
  return record;
}

test("commissioning stages and checks are ordered, unique, and fail closed", () => {
  assert.equal(COMMISSIONING_STAGES.length, 13);
  assert.ok(COMMISSIONING_CHECKS.length >= 50);
  assert.deepEqual(COMMISSIONING_STAGES.map(({ number }) => number), [...Array(13).keys()]);
  assert.equal(new Set(COMMISSIONING_STAGES.map(({ id }) => id)).size, COMMISSIONING_STAGES.length);
  assert.equal(new Set(COMMISSIONING_CHECKS.map(({ id }) => id)).size, COMMISSIONING_CHECKS.length);
  assert.ok(COMMISSIONING_CHECKS.every((check) => commissioningCheck(check.id) === check));
  assert.equal(evaluateCommissioningRecord({}, CONTEXT).physicalMotionPermitted, false);
});

test("normalization drops unknown checks and never imports motion permission", () => {
  const normalized = normalizeCommissioningRecord({
    machineId: MACHINE_ID.toLowerCase(),
    physicalMotionPermitted: true,
    records: {
      made_up_gate: { result: "pass", source: "physical" },
      source_release: passingEvidence(commissioningCheck("source_release")),
    },
  });
  assert.equal(normalized.machineId, MACHINE_ID);
  assert.deepEqual(Object.keys(normalized.records), ["source_release"]);
  assert.equal(normalized.physicalMotionPermitted, false);
});

test("simulation cannot satisfy physical gates or physical controller binding", () => {
  const check = commissioningCheck("physical_preflight");
  const simulatedContext = { ...CONTEXT, controllerSimulated: true };
  const evidence = createCommissioningEvidence(check.id, {
    ...passingEvidence(check),
    source: "simulation",
  }, simulatedContext, { recordedAt: NOW });
  const record = upsertCommissioningEvidence({}, evidence, simulatedContext);
  const evaluation = evaluateCommissioningRecord(record, simulatedContext);

  assert.equal(evaluation.checks.physical_preflight.complete, false);
  assert.match(evaluation.checks.physical_preflight.issues.join(" "), /simulation|simulated/i);
  assert.equal(evaluation.physicalMotionPermitted, false);
});

test("measured gates require operator, instrument identity, artifact, and current bindings", () => {
  const check = commissioningCheck("gpio_scope");
  const evidence = createCommissioningEvidence(check.id, {
    result: "pass",
    source: "physical",
  }, CONTEXT, { recordedAt: NOW });
  const record = upsertCommissioningEvidence({}, evidence, CONTEXT);
  const issues = evaluateCommissioningRecord(record, CONTEXT).checks.gpio_scope.issues.join(" ");

  assert.match(issues, /operator/i);
  assert.match(issues, /instrument model/i);
  assert.match(issues, /SHA-256/i);

  const passed = upsertCommissioningEvidence(record, passingEvidence(check), CONTEXT);
  assert.equal(evaluateCommissioningRecord(passed, CONTEXT).checks.gpio_scope.complete, true);
  assert.equal(
    evaluateCommissioningRecord(passed, { ...CONTEXT, controllerFingerprint: "D".repeat(64) })
      .checks.gpio_scope.complete,
    false,
  );
});

test("stage completion is dependency ordered and exposes the first blocker", () => {
  let record = normalizeCommissioningRecord();
  for (const check of COMMISSIONING_STAGES[1].checks) {
    record = upsertCommissioningEvidence(record, passingEvidence(check), CONTEXT);
  }
  let evaluation = evaluateCommissioningRecord(record, CONTEXT);
  assert.equal(evaluation.stages[0].status, "active");
  assert.equal(evaluation.stages[1].status, "locked");
  assert.equal(evaluation.nextCheck.check.id, "source_release");

  for (const check of COMMISSIONING_STAGES[0].checks) {
    record = upsertCommissioningEvidence(record, passingEvidence(check), CONTEXT);
  }
  evaluation = evaluateCommissioningRecord(record, CONTEXT);
  assert.equal(evaluation.stages[0].status, "complete");
  assert.equal(evaluation.stages[1].status, "complete");
  assert.equal(evaluation.stages[2].status, "active");
  assert.equal(evaluation.nextCheck.check.stageId, "safety");
});

test("record updates reject a different machine and evidence can be removed", () => {
  const evidence = passingEvidence(commissioningCheck("source_release"));
  const record = upsertCommissioningEvidence({}, evidence, CONTEXT);
  assert.throws(
    () => upsertCommissioningEvidence(record, evidence, { ...CONTEXT, machineId: "MR1-AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA" }),
    /different MR-1 machine/i,
  );
  const removed = removeCommissioningEvidence(record, "source_release", { updatedAt: NOW });
  assert.equal(removed.records.source_release, undefined);
  assert.equal(removed.physicalMotionPermitted, false);
});

test("a complete record closes every stage but still grants no motion permission", () => {
  const evaluation = evaluateCommissioningRecord(completeRecord(), CONTEXT);
  assert.equal(evaluation.passed, COMMISSIONING_CHECKS.length);
  assert.equal(evaluation.completedStages, COMMISSIONING_STAGES.length);
  assert.equal(evaluation.allComplete, true);
  assert.equal(evaluation.nextCheck, null);
  assert.equal(evaluation.physicalMotionPermitted, false);
});

test('DM860T-era physical records are not accepted for the CL57T installation', () => {
  const record = completeRecord();
  delete record.hardwareProfile;
  const evaluation = evaluateCommissioningRecord(record, CONTEXT);
  assert.equal(evaluation.allComplete, false);
  assert.equal(evaluation.checks.physical_preflight.complete, false);
  assert.equal(evaluation.checks.x_uncoupled.complete, false);
});

test("commissioning export is canonical, SHA-256 sealed, and machine bound", async () => {
  const record = completeRecord();
  const bundle = await createCommissioningBundle(record, CONTEXT, { createdAt: NOW });
  const parsed = await parseCommissioningBundle(JSON.stringify(bundle), { expectedMachineId: MACHINE_ID });

  assert.equal(parsed.format, COMMISSIONING_FORMAT);
  assert.equal(parsed.record.machineId, MACHINE_ID);
  assert.match(parsed.integrity.digest, /^[0-9A-F]{64}$/);
  assert.equal(parsed.scope, "EVIDENCE RECORD ONLY / NEVER MOTION PERMISSION");
  assert.equal(parsed.record.physicalMotionPermitted, false);
});

test("tampering and cross-machine commissioning imports are rejected", async () => {
  const bundle = await createCommissioningBundle(completeRecord(), CONTEXT, { createdAt: NOW });
  const tampered = structuredClone(bundle);
  tampered.record.records.aluminum_cut.notes = "changed after export";
  await assert.rejects(() => parseCommissioningBundle(JSON.stringify(tampered)), /integrity check failed/i);
  await assert.rejects(
    () => parseCommissioningBundle(JSON.stringify(bundle), {
      expectedMachineId: "MR1-AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA",
    }),
    /different MR-1 machine/i,
  );
});
