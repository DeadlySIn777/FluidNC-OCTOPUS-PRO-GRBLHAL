import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  CONTROLLER_SETTING_CATEGORIES,
  CONTROLLER_SETTINGS_PLAN_PROTOCOL,
  createControllerSettingsPlan,
  createControllerSettingsSnapshot,
  evaluateControllerSettingsPlan,
  normalizeControllerSettingsReport,
  validateControllerSettingsApplyRequest,
  verifyControllerSettingsPlan,
  verifyControllerSettingsSnapshot,
} from "../src/controller-settings.js";
import {
  createSimulatedPreflightTranscript,
  evaluateControllerPreflight,
} from "../service/controller-preflight.mjs";

const profile = JSON.parse(await readFile(
  new URL("../../grblHAL-STM32F4/mr1/expected-settings.json", import.meta.url),
  "utf8",
));

function simulatedReport(overrides = {}) {
  return {
    ...evaluateControllerPreflight(
      createSimulatedPreflightTranscript(profile),
      profile,
      { simulated: true, source: "simulation" },
    ),
    reportAvailable: true,
    ...overrides,
  };
}

test("normalizes every setting in the canonical MR-1 controller profile", () => {
  const report = normalizeControllerSettingsReport(simulatedReport());
  assert.equal(report.settings.length, 66);
  assert.equal(report.counts.settingsPassed, 66);
  assert.equal(report.physicalWritesPermitted, false);
  assert.deepEqual(new Set(report.settings.map((setting) => setting.category)), new Set(
    CONTROLLER_SETTING_CATEGORIES.filter(({ id }) => id !== "all").map(({ id }) => id),
  ));
  assert.equal(report.settings.find(({ id }) => id === 110).unit, "mm/min");
  assert.equal(report.settings.find(({ id }) => id === 20).kind, "boolean");
  assert.equal(report.settings.find(({ id }) => id === 10).kind, "bitmask");
});

test("stages a typed diff without mutating the live report", () => {
  const source = simulatedReport();
  const evaluation = evaluateControllerSettingsPlan({
    report: source,
    staged: { 110: 2400, 120: 225 },
    confirmed: true,
  });
  assert.equal(evaluation.changes.length, 2);
  assert.equal(evaluation.readyToApply, true);
  assert.equal(evaluation.changes[0].id, 110);
  assert.equal(evaluation.changes[0].from, 2540);
  assert.equal(source.settings.find(({ id }) => id === 110).actual, 2540);
  assert.equal(evaluation.physicalWritesPermitted, false);
});

test("requires review confirmation and a fresh exact baseline", () => {
  const report = simulatedReport();
  const unconfirmed = evaluateControllerSettingsPlan({ report, staged: { 110: 2400 } });
  assert.equal(unconfirmed.readyToApply, false);
  assert.match(unconfirmed.status, /CONFIRM/);
  assert.throws(() => validateControllerSettingsApplyRequest({
    protocol: CONTROLLER_SETTINGS_PLAN_PROTOCOL,
    profile: report.profile,
    baseTranscriptSha256: "F".repeat(64),
    changes: [{ id: 110, value: 2400 }],
    confirmed: true,
  }, report), /changed after this plan/);
});

test("rejects invalid booleans, fractional masks, and unknown IDs", () => {
  const report = simulatedReport();
  const evaluation = evaluateControllerSettingsPlan({
    report,
    staged: { 20: 2, 10: 3.5, 9999: 1 },
    confirmed: true,
  });
  assert.equal(evaluation.readyToApply, false);
  assert.equal(evaluation.errors.length, 3);
});

test("cross-setting constraints evaluate the final staged set", () => {
  const report = simulatedReport();
  const spindle = evaluateControllerSettingsPlan({ report, staged: { 31: 9000 }, confirmed: true });
  const pwm = evaluateControllerSettingsPlan({ report, staged: { 35: 90, 36: 80 }, confirmed: true });
  const dualY = evaluateControllerSettingsPlan({ report, staged: { 348: 9 }, confirmed: true });
  assert.match(spindle.errors.join(" "), /maximum spindle speed/);
  assert.match(pwm.errors.join(" "), /PWM minimum/);
  assert.match(dualY.errors.join(" "), /dual-Y minimum/);
});

test("physical reports can be reviewed and exported but never applied", () => {
  const report = simulatedReport({ simulated: false, source: "serial:COM7@115200" });
  const evaluation = evaluateControllerSettingsPlan({ report, staged: { 110: 2400 }, confirmed: true });
  assert.equal(evaluation.readyToApply, false);
  assert.match(evaluation.status, /PHYSICAL SETTING WRITES LOCKED/);
});

test("closed apply schema emits only typed setting IDs and values", () => {
  const report = simulatedReport();
  const request = validateControllerSettingsApplyRequest({
    protocol: CONTROLLER_SETTINGS_PLAN_PROTOCOL,
    profile: report.profile,
    baseTranscriptSha256: report.transcriptSha256,
    changes: [{ id: 110, value: 2400 }],
    confirmed: true,
  }, report);
  assert.deepEqual(request.changes, [{ id: 110, value: 2400 }]);
  assert.equal(request.physicalWritesPermitted, false);
  assert.throws(() => validateControllerSettingsApplyRequest({
    protocol: request.protocol,
    profile: request.profile,
    baseTranscriptSha256: request.baseTranscriptSha256,
    changes: request.changes,
    confirmed: true,
    gcode: "$110=1",
  }, report), /unsupported field gcode/);
});

test("sealed settings snapshots detect later editing", async () => {
  const snapshot = await createControllerSettingsSnapshot(simulatedReport(), "2026-08-27T19:30:00.000Z");
  assert.equal(snapshot.settings.length, 66);
  assert.equal(await verifyControllerSettingsSnapshot(snapshot), true);
  const edited = { ...snapshot, physicalWritesPermitted: true };
  assert.equal(await verifyControllerSettingsSnapshot(edited), false);
});

test("sealed setting plans preserve the live baseline and staged diff", async () => {
  const report = simulatedReport();
  const plan = await createControllerSettingsPlan({
    report,
    staged: { 110: 2400, 120: 225 },
    confirmed: true,
  }, "2026-08-27T19:31:00.000Z");
  assert.equal(plan.baseTranscriptSha256, report.transcriptSha256);
  assert.deepEqual(plan.changes.map(({ id, to }) => ({ id, to })), [
    { id: 110, to: 2400 },
    { id: 120, to: 225 },
  ]);
  assert.equal(plan.physicalWritesPermitted, false);
  assert.equal(await verifyControllerSettingsPlan(plan), true);
});

test("sealed setting plans reject empty diffs and reveal tampering", async () => {
  const report = simulatedReport();
  await assert.rejects(() => createControllerSettingsPlan({ report, staged: {} }), /no staged changes/i);
  const plan = await createControllerSettingsPlan({ report, staged: { 110: 2400 } });
  const tampered = { ...plan, changes: [{ ...plan.changes[0], to: 1 }] };
  assert.equal(await verifyControllerSettingsPlan(tampered), false);
});
