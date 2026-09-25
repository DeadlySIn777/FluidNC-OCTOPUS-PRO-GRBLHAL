import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { COMMISSIONING_CHECKS, COMMISSIONING_HARDWARE_PROFILE, createCommissioningEvidence } from '../src/commissioning-record.js';
import { COMMISSIONING_ACCESS_STAGES, evaluateCommissioningAccess, createCommissioningSession,
  assertCommissioningCommand, commissioningSessionState, revokeCommissioningSession } from '../service/commissioning-policy.mjs';

// Synthetic fixtures prove authorization rules; they are never saved or imported
// as machine evidence, and no serial transport is instantiated by this suite.
const NOW = Date.parse('2026-09-24T12:00:00Z');
const CONTEXT = Object.freeze({ machineId: 'MR1-POLICY-TEST-12345678', controllerFingerprint: 'A'.repeat(64),
  firmwareSha256: 'B'.repeat(64), controllerSimulated: false, connectionId: 'test-connection-1' });
const stageById = id => COMMISSIONING_ACCESS_STAGES.find(value => value.id === id);
const hash = source => createHash('sha256').update(source).digest('hex');
const AIR = 'G90 G94 G17 G21 G40 G49 G80\nM5 M9\nG53 G0 Z-2\nG54\nG0 X0 Y0\nG0 Z5\nG1 X1 Y1 F100\nG53 G0 Z-2\nM30';
const CUT = 'G90 G94 G17 G21 G40 G49 G80\nG53 G0 Z-2\nT1\nM0\nS5000 M3\nG54\nG0 X0 Y0\nG0 Z5\nG1 Z0 F100\nM5 M9\nG53 G0 Z-2\nM30';

function recordFor(stageId) {
  return { hardwareProfile: COMMISSIONING_HARDWARE_PROFILE, machineId: CONTEXT.machineId,
    records: Object.fromEntries(stageById(stageId).prerequisites.map(id => {
      const check = COMMISSIONING_CHECKS.find(value => value.id === id);
      assert.ok(check, `Policy references existing check ${id}`);
      return [id, createCommissioningEvidence(id, { result: 'pass', source: check.acceptedSources[0],
        operator: 'SYNTHETIC TEST FIXTURE', instrument: 'TEST INSTRUMENT', instrumentId: 'TEST-ONLY',
        artifact: { name: 'synthetic-test-artifact', bytes: 1, sha256: 'C'.repeat(64) } }, CONTEXT, { recordedAt: new Date(NOW).toISOString() })];
    })) };
}
function options(stageId, overrides = {}) {
  return { record: recordFor(stageId), context: CONTEXT, stage: stageId, operator: 'SYNTHETIC TEST OPERATOR',
    attestations: { ...Object.fromEntries(stageById(stageId).attestations.map(key => [key, true])), bothYMotorsMechanicallyUncoupled: true },
    now: NOW, programSha256: hash(stageId === 'cut-trial' ? CUT : AIR), ...overrides };
}
const create = (stageId, overrides) => createCommissioningSession(options(stageId, overrides));
const allow = (session, action, args = {}, context = CONTEXT, now = NOW) => assertCommissioningCommand(session, action, args, context, now);

test('stages name real evidence, preserve production gate, and expose exact temporary profile requirement', () => {
  assert.equal(new Set(COMMISSIONING_ACCESS_STAGES.map(value => value.id)).size, 7);
  for (const definition of COMMISSIONING_ACCESS_STAGES) {
    const access = evaluateCommissioningAccess(recordFor(definition.id), CONTEXT);
    assert.equal(access.stages.find(value => value.id === definition.id).eligible, true);
    assert.equal(access.productionEvidenceComplete, false);
  }
  assert.equal(stageById('uncoupled').needsTemporaryHomingProfile, true);
  assert.equal(stageById('uncoupled').requiredHomingSetting, 3);
  assert.ok(COMMISSIONING_ACCESS_STAGES.filter(value => value.id !== 'uncoupled').every(value => value.requiredHomingSetting === 7));
});

test('empty, old hardware, simulation and missing physical preparation fail closed', () => {
  assert.ok(evaluateCommissioningAccess({}, CONTEXT).stages.every(value => !value.eligible));
  assert.throws(() => create('uncoupled', { record: { ...recordFor('uncoupled'), hardwareProfile: 'old-DM860T' } }), /incomplete/);
  assert.throws(() => create('uncoupled', { context: { ...CONTEXT, controllerSimulated: true } }), /incomplete/);
  const simulated = recordFor('uncoupled'); simulated.records.safety_chain.source = 'simulation';
  assert.throws(() => create('uncoupled', { record: simulated }), /safety_chain/);
  assert.throws(() => create('uncoupled', { attestations: {} }), /confirmations/);
});

test('first uncoupled session does not require its own pulse/motion results', () => {
  const record = recordFor('uncoupled');
  for (const id of ['cl57t_interface_scope', 'cl57t_alarm_truth', 'gpio_scope', 'x_uncoupled', 'z_uncoupled', 'y_independent']) assert.equal(record.records[id], undefined);
  assert.ok(record.records.cl57t_alarm_static);
  const session = create('uncoupled', { record });
  assert.equal(session.productionQualified, false);
  assert.equal(session.physicalMotionPermitted, false);
  allow(session, 'arm');
  for (const action of ['home', 'probe', 'run', 'zero', 'outputs', 'workflow', 'resume', '$X', '$22=3']) assert.throws(() => allow(session, action), /not permitted/);
});

test('uncoupled jog is bounded in size, speed and cumulative absolute travel', () => {
  const session = create('uncoupled', { axes: ['x'] });
  for (const distance of [0, NaN, Infinity, 0.25001, -0.25001, '0.1']) assert.throws(() => allow(session, 'jog', { axis: 'x', distance, feed: 50 }), /distance/);
  assert.throws(() => allow(session, 'jog', { axis: 'x', distance: 0.1, feed: 51 }), /feed/);
  assert.equal(commissioningSessionState(session, NOW).remainingCommands, 24);
  for (let i = 0; i < 8; i++) allow(session, 'jog', { axis: 'x', distance: i % 2 ? -0.25 : 0.25, feed: 50 });
  assert.equal(commissioningSessionState(session, NOW).remainingJogMm.x, 0);
  assert.throws(() => allow(session, 'jog', { axis: 'x', distance: -0.01, feed: 1 }), /cumulative/);
});

test('Y is never treated as an independent motor and axes remain session-bound', () => {
  const proposed = options('uncoupled'); delete proposed.attestations.bothYMotorsMechanicallyUncoupled;
  assert.throws(() => createCommissioningSession(proposed), /bothYMotors/);
  const session = createCommissioningSession({ ...proposed, axes: ['x'] });
  assert.throws(() => allow(session, 'jog', { axis: 'y', distance: 0.1, feed: 10 }), /axis/);
  assert.throws(() => create('uncoupled', { axes: ['x', 'x'] }), /unique/);
  assert.throws(() => create('uncoupled', { axes: ['yl'] }), /unique/);
});

test('finite session duration, revocation and process-local identity prevent reuse', () => {
  const session = create('uncoupled');
  assert.equal(session.expiresAt - session.issuedAt, 5 * 60_000);
  assert.throws(() => create('uncoupled', { durationMs: 5 * 60_000 + 1 }), /duration/);
  assert.throws(() => allow(session, 'arm', {}, CONTEXT, session.expiresAt), /expired/);
  assert.throws(() => allow(session, 'arm', {}, CONTEXT, NOW - 1), /expired/);
  assert.throws(() => allow(JSON.parse(JSON.stringify(session)), 'arm'), /process-local/);
  revokeCommissioningSession(session, 'USB disconnected');
  assert.throws(() => allow(session, 'arm'), /USB disconnected/);
  assert.equal(commissioningSessionState(session, NOW).active, false);
});

test('reconnect, configuration, firmware and machine changes invalidate a permit', () => {
  const session = create('uncoupled');
  for (const changes of [{ connectionId: 'next-port-open' }, { controllerFingerprint: 'D'.repeat(64) },
    { firmwareSha256: 'E'.repeat(64) }, { machineId: 'MR1-OTHER-12345678' }]) {
    assert.throws(() => allow(session, 'arm', {}, { ...CONTEXT, ...changes }), /binding changed/);
  }
  assert.throws(() => allow(session, 'arm', {}, { ...CONTEXT, controllerSimulated: undefined }), /physical/);
});

test('coupled homing can gather home evidence without completed home or cut evidence', () => {
  const session = create('homing');
  assert.equal(recordFor('homing').records.x_home_limit, undefined);
  allow(session, 'home', { axis: 'all' });
  allow(session, 'home', { axis: 'z' });
  assert.throws(() => allow(session, 'jog', { axis: 'x', distance: 1, feed: 50 }), /not permitted/);
  for (let i = 2; i < 25; i++) allow(session, 'home', { axis: 'all' });
  assert.throws(() => allow(session, 'home', { axis: 'all' }), /budget/);
});

test('axis-restricted homing cannot move an unauthorized axis through full home', () => {
  const session = create('homing', { axes: ['z'] });
  allow(session, 'home', { axis: 'z' });
  assert.throws(() => allow(session, 'home', { axis: 'all' }), /outside/);
  assert.throws(() => allow(session, 'home', { axis: 'x' }), /outside/);
});

test('probe qualification requires sensor evidence but not successful probe test results', () => {
  const session = create('probing');
  assert.equal(recordFor('probing').records.probe_repeatability, undefined);
  const args = { axis: 'z', distance: -2, seekFeed: 50, latchFeed: 10, confirmedSpindleStopped: true };
  allow(session, 'probe', args);
  assert.throws(() => allow(session, 'probe', { ...args, distance: -5.01 }), /search/);
  assert.throws(() => allow(session, 'probe', { ...args, confirmedSpindleStopped: false }), /physically stopped/);
  assert.throws(() => allow(session, 'probe', { ...args, latchFeed: 11 }), /latch feed/);
  const record = recordFor('probing'); delete record.records.probe_truth;
  assert.throws(() => create('probing', { record }), /probe_truth/);
});

test('only typed protected workflows are allowed at the probe/cut stages', () => {
  const session = create('probing');
  for (const kind of ['touch-probe', 'tool-setter', 'apply-work-offset', 'apply-tool-length']) allow(session, 'workflow', { kind });
  assert.throws(() => allow(session, 'workflow', { kind: 'raw-gcode' }), /not permitted/);
  assert.throws(() => allow(create('homing'), 'workflow', { kind: 'touch-probe' }), /not permitted/);
});

test('spindle scope/calibration stage has output ceilings and no NC permission', () => {
  const session = create('spindle');
  assert.equal(recordFor('spindle').records.spindle_speed, undefined);
  allow(session, 'outputs', { spindle: 'cw', rpm: 1000, coolant: 'off' });
  assert.throws(() => allow(session, 'outputs', { spindle: 'cw', rpm: 8001 }), /RPM/);
  assert.throws(() => allow(session, 'outputs', { spindle: 'ccw', rpm: 1000 }), /Unsupported/);
  assert.throws(() => allow(session, 'run', { source: CUT, sha256: hash(CUT) }), /not permitted/);
});

test('trial permission binds one exact program and cannot be replayed', () => {
  const session = create('cut-trial');
  assert.throws(() => allow(session, 'resume'), /No commissioning program/);
  assert.throws(() => allow(session, 'run', { source: CUT + '\n', sha256: hash(CUT) }), /does not match/);
  allow(session, 'run', { source: CUT, sha256: hash(CUT) });
  allow(session, 'resume');
  assert.equal(commissioningSessionState(session, NOW).remainingRuns, 0);
  assert.throws(() => allow(session, 'run', { source: CUT, sha256: hash(CUT) }), /already been started/);
  assert.equal(recordFor('cut-trial').records.aluminum_cut, undefined);
  assert.equal(recordFor('cut-trial').records.release_review, undefined);
});

test('air-run cannot turn on spindle/coolant even when the hash matches', () => {
  const session = create('air-run');
  allow(session, 'run', { source: AIR, sha256: hash(AIR) });
  for (const source of [CUT, AIR.replace('G1 X1 Y1 F100', 'M8\nG1 X1 Y1 F100\nM9')]) {
    const permit = create('air-run', { programSha256: hash(source) });
    assert.throws(() => allow(permit, 'run', { source, sha256: hash(source) }), /contract|spindle|coolant/);
  }
});

test('invalid NC and a fabricated hash do not become executable by commissioning', () => {
  const source = AIR.replace('G1 X1 Y1 F100', '$X');
  const session = create('air-run', { programSha256: hash(source) });
  assert.throws(() => allow(session, 'run', { source, sha256: hash(source) }), /contract/);
  assert.equal(commissioningSessionState(session, NOW).remainingRuns, 1);
  assert.throws(() => create('air-run', { programSha256: 'not-a-hash' }), /SHA-256/);
});

test('air-run feed ceiling is enforced in millimetres for metric and inch programs', () => {
  for (const source of [AIR.replace('F100', 'F301'), AIR.replace('G21', 'G20').replaceAll('Z-2', 'Z-0.0787401575').replace('F100', 'F12')]) {
    const session = create('air-run', { programSha256: hash(source) });
    assert.throws(() => allow(session, 'run', { source, sha256: hash(source) }), /feed/);
    assert.equal(commissioningSessionState(session, NOW).remainingRuns, 1);
  }
});

test('read-only authorization checks do not reserve budget but still enforce it', () => {
  const session = create('cut-trial');
  const args = { source: CUT, sha256: hash(CUT) };
  for (let i = 0; i < 5; i++) assertCommissioningCommand(session, 'run', args, CONTEXT, NOW, { reserve: false });
  assert.equal(commissioningSessionState(session, NOW).remainingRuns, 1);
  assert.throws(() => assertCommissioningCommand(session, 'run', { ...args, source: CUT + '\n' }, CONTEXT, NOW, { reserve: false }), /does not match/);
  allow(session, 'run', args);
  assert.throws(() => assertCommissioningCommand(session, 'run', args, CONTEXT, NOW, { reserve: false }), /already been started/);
  const jog = create('uncoupled', { axes: ['x'] });
  for (let i = 0; i < 8; i++) allow(jog, 'jog', { axis: 'x', distance: 0.25, feed: 50 });
  assert.throws(() => assertCommissioningCommand(jog, 'jog', { axis: 'x', distance: 0.1, feed: 50 }, CONTEXT, NOW, { reserve: false }), /cumulative/);
});

test('an opaque in-flight workflow reservation can finish its last slot without granting another operation', () => {
  const session = create('probing');
  for (let i = 0; i < session.limits.maxCommands - 1; i++) allow(session, 'workflow', { kind: 'touch-probe' });
  const { reservation } = allow(session, 'workflow', { kind: 'touch-probe' });
  assert.equal(commissioningSessionState(session, NOW).remainingCommands, 0);
  const continuation = { reserve: false, reservation };
  assertCommissioningCommand(session, 'workflow', { kind: 'touch-probe' }, CONTEXT, NOW, continuation);
  assert.throws(() => assertCommissioningCommand(session, 'workflow', { kind: 'touch-probe' }, CONTEXT, NOW, { reserve: false }), /budget/);
  assert.throws(() => allow(session, 'workflow', { kind: 'touch-probe' }), /budget/);
  assert.throws(() => assertCommissioningCommand(session, 'workflow', { kind: 'tool-setter' }, CONTEXT, NOW, continuation), /reservation/);
  assert.throws(() => assertCommissioningCommand(session, 'workflow', { kind: 'touch-probe' }, CONTEXT, NOW, { reserve: false, reservation: { ...reservation } }), /reservation/);
  assert.throws(() => assertCommissioningCommand(create('probing'), 'workflow', { kind: 'touch-probe' }, CONTEXT, NOW, continuation), /reservation/);
  assert.throws(() => assertCommissioningCommand(session, 'workflow', { kind: 'touch-probe' }, { ...CONTEXT, connectionId: 'next' }, NOW, continuation), /binding/);
  assert.throws(() => assertCommissioningCommand(session, 'workflow', { kind: 'touch-probe' }, CONTEXT, session.expiresAt, continuation), /expired/);
  revokeCommissioningSession(session);
  assert.throws(() => assertCommissioningCommand(session, 'workflow', { kind: 'touch-probe' }, CONTEXT, NOW, continuation), /ended/);
});

test('typed command reservations bind the exact arguments and preserve the final cumulative jog allowance', () => {
  const session = create('uncoupled', { axes: ['x'] });
  const args = { axis: 'x', distance: 0.25, feed: 50 };
  for (let i = 0; i < 7; i++) allow(session, 'jog', args);
  const { reservation } = allow(session, 'jog', args);
  const continuation = { reserve: false, reservation };
  for (let i = 0; i < 3; i++) assertCommissioningCommand(session, 'jog', { feed: 50, axis: 'x', distance: 0.25 }, CONTEXT, NOW, continuation);
  assert.equal(commissioningSessionState(session, NOW).remainingJogMm.x, 0);
  assert.throws(() => assertCommissioningCommand(session, 'jog', { ...args, distance: -0.25 }, CONTEXT, NOW, continuation), /reservation/);
  assert.throws(() => assertCommissioningCommand(session, 'jog', { ...args, feed: 49 }, CONTEXT, NOW, continuation), /reservation/);
  assert.throws(() => assertCommissioningCommand(session, 'jog', args, CONTEXT, NOW, { reserve: false, reservation: { ...reservation } }), /reservation/);
  assert.throws(() => allow(session, 'jog', args), /cumulative/);
  revokeCommissioningSession(session);
  assert.throws(() => assertCommissioningCommand(session, 'jog', args, CONTEXT, NOW, continuation), /ended/);
});

test('home, probe, zero and output continuations require their original action and scalar arguments', () => {
  for (const [stage, action, args] of [
    ['homing', 'home', { axis: 'z' }],
    ['probing', 'probe', { axis: 'z', distance: -2, confirmedSpindleStopped: true }],
    ['probing', 'zero', { axis: 'z', wcs: 'G54' }],
    ['spindle', 'outputs', { spindle: 'cw', rpm: 1000, coolant: 'off' }],
  ]) {
    const session = create(stage);
    const { reservation } = allow(session, action, args);
    assertCommissioningCommand(session, action, { ...args }, CONTEXT, NOW, { reserve: false, reservation });
    assert.throws(() => assertCommissioningCommand(session, action, { ...args, changed: true }, CONTEXT, NOW, { reserve: false, reservation }), /reservation/);
    assert.throws(() => assertCommissioningCommand(session, action, args, CONTEXT, session.expiresAt, { reserve: false, reservation }), /expired/);
  }
});

test('one program reservation authorizes only continuation of its exact reviewed source until expiry', () => {
  const session = create('cut-trial');
  const args = { source: CUT, sha256: hash(CUT) };
  const { reservation } = allow(session, 'run', args);
  const continuation = { reserve: false, reservation };
  assertCommissioningCommand(session, 'run', args, CONTEXT, NOW, continuation);
  assert.equal(commissioningSessionState(session, NOW).remainingRuns, 0);
  assert.throws(() => allow(session, 'run', args), /already been started/);
  assert.throws(() => assertCommissioningCommand(session, 'run', { ...args, source: CUT + '\n' }, CONTEXT, NOW, continuation), /reservation/);
  assert.throws(() => assertCommissioningCommand(session, 'run', args, { ...CONTEXT, connectionId: 'new' }, NOW, continuation), /binding/);
  assert.throws(() => assertCommissioningCommand(session, 'run', args, CONTEXT, session.expiresAt, continuation), /expired/);
});

test('lone carriage returns cannot hide an inch block from the air-run feed ceiling', () => {
  // The validator and streamer end a block at a lone CR; F90 under G20 streams at 2286 mm/min.
  const source = 'G90 G94 G17 G21 G40 G49 G80\nM5 M9\nG53 G0 Z-2\nG54\nG0 X0 Y0 Z5\nG21\rG20\rG1 X1 Y1 F90\nG21\nG53 G0 Z-2\nM30';
  const session = create('air-run', { programSha256: hash(source) });
  assert.throws(() => allow(session, 'run', { source, sha256: hash(source) }), /feed/);
  assert.equal(commissioningSessionState(session, NOW).remainingRuns, 1);
  // Units are applied in their actual order: here the final block is metric.
  const metric = source.replace('G21\rG20\r', 'G20\rG21\r');
  assert.ok(allow(create('air-run', { programSha256: hash(metric) }), 'run', { source: metric, sha256: hash(metric) }).reservation);
});
