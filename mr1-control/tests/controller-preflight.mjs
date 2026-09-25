import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  controllerPreflightCommand,
  controllerConfigurationFingerprint,
  createSimulatedPreflightTranscript,
  evaluateControllerPreflight,
  parseControllerSettings,
  summarizeControllerPreflight,
  validateControllerPreflightProfile,
} from "../service/controller-preflight.mjs";

const firmwareRoot = new URL("../../grblHAL-STM32F4/", import.meta.url);
const profile = JSON.parse(await readFile(new URL("mr1/expected-settings.json", firmwareRoot), "utf8"));

test("controller preflight profile contains only closed-list read-only queries", () => {
  assert.equal(validateControllerPreflightProfile(profile), profile);
  assert.equal(controllerPreflightCommand("?").toString("ascii"), "?");
  assert.equal(controllerPreflightCommand("$I+").toString("ascii"), "$I+\n");
  assert.equal(controllerPreflightCommand("$$").toString("ascii"), "$$\n");
  assert.equal(controllerPreflightCommand("G0 X1"), null);
  assert.throws(
    () => validateControllerPreflightProfile({ ...profile, readOnlyQueries: ["?", "$X"] }),
    /Unsafe controller preflight query rejected/,
  );
});

test("matching simulated firmware contract passes without granting motion", () => {
  const transcript = createSimulatedPreflightTranscript(profile);
  const report = evaluateControllerPreflight(transcript, profile, { simulated: true });
  assert.equal(report.status, "PASS");
  assert.equal(report.simulated, true);
  assert.equal(report.boardIdentityPresent, true);
  assert.equal(report.machineState, "Alarm");
  assert.equal(report.activePins, "");
  assert.equal(report.counts.settingsPassed, profile.settings.length);
  assert.equal(report.counts.blockers, 0);
  assert.equal(report.physicalMotionPermitted, false);
  assert.match(report.transcriptSha256, /^[A-F0-9]{64}$/);
});

test("blocker setting drift blocks preflight", () => {
  const transcript = createSimulatedPreflightTranscript(profile).replace(/^\$0=.*$/m, "$0=2");
  const report = evaluateControllerPreflight(transcript, profile);
  assert.equal(report.status, "BLOCKED");
  assert.equal(report.counts.blockers, 1);
  assert.equal(report.issues[0].code, "SETTING_0");
});

test("warning-only drift remains visible without failing the firmware gate", () => {
  const transcript = createSimulatedPreflightTranscript(profile).replace(/^\$100=.*$/m, "$100=319.5");
  const report = evaluateControllerPreflight(transcript, profile);
  assert.equal(report.status, "PASS");
  assert.equal(report.counts.blockers, 0);
  assert.equal(report.counts.warnings, 1);
  assert.equal(report.issues[0].code, "SETTING_100");
});

test("wrong board identity and active inputs are explicit blockers", () => {
  const transcript = createSimulatedPreflightTranscript(profile, "<Idle|MPos:0,0,0|FS:0,0|Pn:XEF>")
    .replace(profile.boardIdentityContains, "UNKNOWN BOARD");
  const report = evaluateControllerPreflight(transcript, profile);
  assert.equal(report.status, "BLOCKED");
  assert.equal(report.boardIdentityPresent, false);
  assert.equal(report.activePins, "XEF");
  assert.deepEqual(report.issues.slice(0, 2).map((item) => item.code), ["BOARD_IDENTITY", "ACTIVE_INPUTS"]);
});

test("missing realtime status is never treated as ready", () => {
  const transcript = createSimulatedPreflightTranscript(profile).replace(/^<.*>$/m, "");
  const report = evaluateControllerPreflight(transcript, profile);
  assert.equal(report.status, "BLOCKED");
  assert.ok(report.issues.some((item) => item.code === "NO_STATUS"));
});

test("setting parser uses the latest reported value", () => {
  const parsed = parseControllerSettings("$100=320\r\n$101=320\r\n$100=321\r\n");
  assert.equal(parsed.get(100), 321);
  assert.equal(parsed.get(101), 320);
});

test('profile expectations and tolerances cannot coerce null, text or booleans into numbers',()=>{
  for(const value of [null,'5',false,'']) for(const field of ['expected','tolerance']) {
    const changed={...profile,settings:profile.settings.map((setting,i)=>i===0?{...setting,[field]:value}:setting)};
    assert.throws(()=>validateControllerPreflightProfile(changed),/invalid expected value or tolerance/);
  }
});

test('board identity must be an exact structured report with no conflicting board', () => {
  const transcript = createSimulatedPreflightTranscript(profile);
  for (const replacement of [`[MSG:${profile.boardIdentityContains}]`,
    `[BOARD:${profile.boardIdentityContains} - WRONG BUILD]`,
    `[BOARD:OTHER BOARD]\n[MSG:${profile.boardIdentityContains}]`,
    `[BOARD:${profile.boardIdentityContains}]\n[BOARD:OTHER BOARD]`]) {
    const report = evaluateControllerPreflight(transcript.replace(`[BOARD:${profile.boardIdentityContains}]`,replacement),profile);
    assert.equal(report.boardIdentityPresent,false,replacement); assert.equal(report.preflightPassed,false);
  }
});

test('malformed and conflicting expected setting records cannot satisfy preflight', () => {
  const transcript = createSimulatedPreflightTranscript(profile);
  for (const value of ['5garbage','5,0','5e999','']) {
    const report=evaluateControllerPreflight(transcript.replace(/^\$0=.*$/m,`$0=${value}`),profile);
    assert.equal(report.preflightPassed,false,value);
    assert.ok(report.issues.some(issue=>issue.code==='MALFORMED_SETTING_0'));
  }
  const conflict=evaluateControllerPreflight(transcript+'\n$0=6\n$0=5',profile);
  assert.equal(conflict.settings.find(s=>s.id===0).status,'PASS');
  assert.equal(conflict.preflightPassed,false); assert.ok(conflict.issues.some(i=>i.code==='CONFLICTING_SETTING_0'));
  assert.equal(evaluateControllerPreflight(transcript+'\n$0=5.000',profile).preflightPassed,true);
  assert.equal(parseControllerSettings('$0=5\n$0=5garbage').has(0),false);
});

test('configuration fingerprint binds whole string and vector setting records', () => {
  const transcript=createSimulatedPreflightTranscript(profile);
  for (const suffix of ['$999=alpha','$999=0,1,2']) {
    assert.notEqual(controllerConfigurationFingerprint(transcript),controllerConfigurationFingerprint(transcript+'\n'+suffix));
    assert.notEqual(controllerConfigurationFingerprint(transcript+'\n'+suffix),controllerConfigurationFingerprint(transcript+'\n'+suffix+'x'));
  }
  assert.equal(controllerConfigurationFingerprint(transcript+'\n$999=1.0'),controllerConfigurationFingerprint(transcript+'\n$999=1e0'));
});

test('commissioning fingerprint survives polling and position changes but binds every setting and firmware identity', () => {
  const transcript = createSimulatedPreflightTranscript(profile);
  const changedStatus = transcript.replace(/<[^>]*>/, '<Idle|MPos:-10,-20,-30|FS:0,0|Pn:>') + '\n[GC:G1 G55 G20]\nok\n';
  assert.equal(controllerConfigurationFingerprint(transcript), controllerConfigurationFingerprint(changedStatus));
  assert.notEqual(controllerConfigurationFingerprint(transcript), controllerConfigurationFingerprint(transcript + '\n$999=1'));
  assert.notEqual(controllerConfigurationFingerprint(transcript), controllerConfigurationFingerprint(transcript + '\n[VER:changed]'));
  assert.equal(controllerConfigurationFingerprint(transcript), controllerConfigurationFingerprint(transcript.replace('$22=7', '$22=3'), { 22: 7 }));
});

test("live preflight summary omits the heavy per-setting comparison list", () => {
  const report = evaluateControllerPreflight(createSimulatedPreflightTranscript(profile), profile);
  const summary = summarizeControllerPreflight(report);
  assert.equal("settings" in summary, false);
  assert.equal(summary.reportAvailable, true);
  assert.equal(summary.issueCount, 0);
  assert.ok(JSON.stringify(summary).length < JSON.stringify(report).length / 4);
});
