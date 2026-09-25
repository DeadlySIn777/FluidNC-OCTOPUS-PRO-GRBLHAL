import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname, basename } from 'node:path';
import { NativeController, REALTIME } from '../service/native-controller.mjs';
import { createNativeCommissioning } from '../service/native-commissioning.mjs';
import { COMMISSIONING_ACCESS_STAGES } from '../service/commissioning-policy.mjs';
import { COMMISSIONING_CHECKS, COMMISSIONING_HARDWARE_PROFILE, createCommissioningBundle, createCommissioningEvidence } from '../src/commissioning-record.js';
import { WireController, profile, sampleProgram } from './fixtures/native-wire.mjs';

const FIRMWARE = 'E'.repeat(64);
const MACHINE = 'MR1-LIFECYCLE-TEST-12345678';
const definition = id => COMMISSIONING_ACCESS_STAGES.find(stage => stage.id === id);
const serialLines = port => port.writes.filter(value => typeof value === 'string');
const realtimes = port => port.writes.filter(Array.isArray).map(value => value[0]);

// The fixture adds reset and ambiguous-write behavior to the byte-level double.
// This file never enumerates COM ports or imports real serial transports.
class LifecycleWire extends WireController {
  write(data, callback) {
    const command = Buffer.isBuffer(data) ? null : String(data).trim();
    if (command === '$22=3' && this.debtPath) this.debtAtWrite = JSON.parse(readFileSync(this.debtPath, 'utf8'));
    if (command === '$22=3' && this.failAfterSettingAccepted) {
      this.writes.push(command);
      this.settingOverrides = { ...this.settingOverrides, 22: 3 };
      this.failAfterSettingAccepted = false;
      queueMicrotask(() => callback?.(new Error('USB write failed after the setting may have been accepted.')));
      return;
    }
    super.write(data, callback);
    if (Buffer.isBuffer(data) && data[0] === REALTIME.reset) queueMicrotask(() => {
      this.homed = false; this.homedMask = 0;
      this.state = ((this.settingOverrides?.[22] ?? 7) & 4) ? 'Alarm' : 'Idle';
      this.send('GrblHAL 1.1f\r\n');
    });
  }
}

async function setup(t, { auditHook, homed = false } = {}) {
  const tempRoot = resolve(tmpdir());
  const prefix = resolve(tempRoot, 'mr1-commissioning-tests-');
  const directory = await mkdtemp(prefix);
  const port = new LifecycleWire();
  port.homed = homed; port.homedMask = homed ? 7 : 0; port.state = homed ? 'Idle' : 'Alarm';
  port.debtPath = resolve(directory, 'native-commissioning-profile.json');
  const controller = new NativeController({ profile, portFactory: async () => port, ackTimeout: 120 });
  const events = [];
  const audit = async (kind, payload) => { events.push({ kind, payload }); await auditHook?.(kind, payload); };
  let journalReady = true;
  let manager;
  const newManager = async () => {
    manager = await createNativeCommissioning({ controller, directory, firmwareSha256: FIRMWARE, audit, journalReady: () => journalReady });
    controller.authorizeCommand = (action, args, options) => manager.authorize(action, args, options);
    return manager;
  };
  await newManager();
  controller.beforeWrite = event => audit('native.command', event);
  // Match the real server's invalidation link without creating an HTTP server.
  controller.on('state', state => { if (!state.preflight) manager.revoke('Controller preflight was invalidated.'); });
  await controller.connect('COM7');
  t.after(async () => {
    await controller.disconnect();
    const absolute = resolve(directory);
    assert.equal(dirname(absolute), tempRoot);
    assert.ok(absolute.startsWith(prefix) && basename(absolute).startsWith('mr1-commissioning-tests-') && absolute.length > prefix.length);
    await rm(absolute, { recursive: true, force: true });
  });
  return { controller, port, directory, events, get manager() { return manager; }, newManager,
    setJournalReady: ready => { journalReady = ready; } };
}

async function evidenceBundle(fixture, stageId) {
  const { controller } = fixture;
  const context = { machineId: MACHINE, controllerFingerprint: controller.preflight.configurationFingerprint,
    firmwareSha256: FIRMWARE, controllerSimulated: false };
  // Explicitly synthetic evidence is private to this test and never delivered
  // as a real commissioning record or written to the user's installation.
  const record = { hardwareProfile: COMMISSIONING_HARDWARE_PROFILE, machineId: MACHINE,
    records: Object.fromEntries(definition(stageId).prerequisites.map(id => {
      const check = COMMISSIONING_CHECKS.find(value => value.id === id);
      return [id, createCommissioningEvidence(id, { result: 'pass', source: check.acceptedSources[0],
        operator: 'SYNTHETIC LIFECYCLE FIXTURE', instrument: 'TEST ONLY', instrumentId: 'TEST-ONLY-01',
        artifact: { name: 'synthetic-test-only.txt', bytes: 1, sha256: 'D'.repeat(64) } }, context)];
    })) };
  return { record, source: await createCommissioningBundle(record, context) };
}
async function evidence(fixture, stageId) {
  const { record, source } = await evidenceBundle(fixture, stageId);
  await fixture.manager.loadEvidence(source);
  return record;
}
function request(stage = 'uncoupled', overrides = {}) {
  return { stage, operator: 'SYNTHETIC LIFECYCLE FIXTURE', axes: ['x', 'y', 'z'], confirmTemporaryHoming: true,
    attestations: { ...Object.fromEntries(definition(stage).attestations.map(key => [key, true])), bothYMotorsMechanicallyUncoupled: true }, ...overrides };
}
async function begin(fixture, stage = 'uncoupled') { await evidence(fixture, stage); return fixture.manager.begin(request(stage)); }
async function reconnect(fixture) { await fixture.controller.disconnect(); await fixture.controller.connect('COM7'); }

test('an exact read-only controller preflight grants no commissioning authority without records', async t => {
  const fixture = await setup(t);
  assert.equal(fixture.controller.preflight.preflightPassed, true);
  assert.equal(fixture.controller.motionQualified, false);
  assert.throws(() => fixture.controller.arm(), /Import commissioning evidence/);
  await assert.rejects(fixture.manager.begin(request()), /Import the current commissioning evidence/);
  assert.deepEqual(serialLines(fixture.port).filter(value => /^\$(?:22=|X)/.test(value)), []);
});

test('initial uncoupled preparation writes durable debt before $22=3, verifies OPT-L, then explicitly unlocks', async t => {
  const fixture = await setup(t);
  const record = await evidence(fixture, 'uncoupled');
  assert.equal(record.records.x_uncoupled, undefined);
  assert.equal(record.records.cl57t_interface_scope, undefined);
  assert.equal(record.records.release_review, undefined);
  const result = await fixture.manager.begin(request());
  assert.equal(result.session.stage, 'uncoupled');
  assert.equal(result.session.productionQualified, false);
  assert.equal(result.temporaryProfileVerified, true);
  assert.equal(result.recovery.required, true);
  assert.equal(fixture.controller.armed, false);
  assert.equal(fixture.port.debtAtWrite.value.active, true);
  const writes = serialLines(fixture.port);
  assert.equal(writes.filter(value => value === '$22=3').length, 1);
  assert.equal(writes.filter(value => value === '$X').length, 1);
  assert.ok(writes.indexOf('$22=3') < writes.indexOf('$X'));
  assert.ok(fixture.controller.lines.some(value => value.includes('[OPT:VNL,')));
  assert.equal(fixture.controller.preflight.preflightPassed, true);
  assert.ok(!writes.some(value => value.startsWith('$J=')));
});

test('uncoupled sessions enforce move bounds and reject home, outputs and programs', async t => {
  const fixture = await setup(t);
  await begin(fixture);
  fixture.controller.arm();
  await fixture.controller.jog({ axis: 'x', distance: 0.25, feed: 50 });
  assert.ok(serialLines(fixture.port).includes('$J=G21 G91 X0.25 F50'));
  await assert.rejects(fixture.controller.jog({ axis: 'x', distance: 0.251, feed: 50 }), /distance/);
  await assert.rejects(fixture.controller.jog({ axis: 'x', distance: 0.1, feed: 51 }), /feed/);
  await assert.rejects(fixture.controller.home(), /not permitted/);
  await assert.rejects(fixture.controller.outputs({ spindle: 'cw', rpm: 1000 }), /not permitted/);
  const loaded = fixture.controller.loadProgram(sampleProgram, 'synthetic.nc');
  await assert.rejects(fixture.controller.runProgram(loaded.sha256), /Home|not permitted/);
  const writes = serialLines(fixture.port);
  assert.ok(!writes.some(value => value.startsWith('$H') || value.startsWith('M3')));
});

test('temporary profile changes require explicit confirmation and a fully unhomed controller', async t => {
  const fixture = await setup(t);
  await evidence(fixture, 'uncoupled');
  await assert.rejects(fixture.manager.begin(request('uncoupled', { confirmTemporaryHoming: false })), /Explicitly review/);
  assert.ok(!serialLines(fixture.port).includes('$22=3'));
  assert.equal(fixture.manager.snapshot().session, null);
  await reconnect(fixture);
  fixture.port.homedMask = 1; fixture.port.send(fixture.port.status());
  await assert.rejects(fixture.manager.begin(request()), /fully unhomed/);
  assert.ok(!serialLines(fixture.port).includes('$22=3'));
});

test('ending an armed bench session resets and retains debt until explicit reconnect restoration', async t => {
  const fixture = await setup(t);
  await begin(fixture); fixture.controller.arm();
  const ended = await fixture.manager.end();
  assert.equal(ended.session, null);
  assert.equal(ended.recovery.required, true);
  assert.equal(fixture.port.settingOverrides[22], 3);
  assert.ok(realtimes(fixture.port).includes(REALTIME.reset));
  await reconnect(fixture);
  assert.equal(fixture.controller.preflight.preflightPassed, false);
  assert.throws(() => fixture.controller.arm(), /explicit restoration/);
  const restored = await fixture.manager.restore({ confirmed: true, transactionId: ended.recovery.transactionId });
  assert.equal(restored.recovery.required, false);
  assert.equal(restored.session, null);
  assert.equal(fixture.port.settingOverrides[22], 7);
  assert.equal(fixture.controller.preflight.preflightPassed, true);
  assert.equal(fixture.controller.armed, false);
  assert.equal(JSON.parse(await readFile(fixture.port.debtPath, 'utf8')).value.active, false);
  assert.throws(() => fixture.controller.arm(), /Import commissioning evidence/);
});

test('a new service instance discovers profile debt and never automatically writes or unlocks', async t => {
  const fixture = await setup(t);
  const started = await begin(fixture);
  await fixture.controller.disconnect();
  const before = fixture.port.writes.length;
  await fixture.newManager();
  assert.equal(fixture.port.writes.length, before);
  assert.equal(fixture.manager.snapshot().recovery.transactionId, started.recovery.transactionId);
  assert.equal(fixture.manager.snapshot().session, null);
  await fixture.controller.connect('COM7');
  const newWrites = fixture.port.writes.slice(before).filter(value => typeof value === 'string');
  assert.ok(newWrites.every(value => ['$I+', '$$', '$G', '$#', '$N'].includes(value)));
  await assert.rejects(fixture.manager.restore({ confirmed: false, transactionId: started.recovery.transactionId }), /Review/);
  await assert.rejects(fixture.manager.restore({ confirmed: true, transactionId: 'wrong-transaction' }), /Review/);
  await fixture.manager.restore({ confirmed: true, transactionId: started.recovery.transactionId });
  assert.equal(fixture.port.settingOverrides[22], 7);
});

test('restoration refuses any other setting mismatch and preserves the durable interlock', async t => {
  const fixture = await setup(t);
  const started = await begin(fixture);
  fixture.manager.revoke('Disconnected during preparation');
  fixture.port.settingOverrides[100] = 321;
  await reconnect(fixture);
  await assert.rejects(fixture.manager.restore({ confirmed: true, transactionId: started.recovery.transactionId }), /configuration does not match/);
  assert.equal(fixture.manager.snapshot().recovery.required, true);
  assert.ok(!serialLines(fixture.port).includes('$22=7'));
});

test('an ambiguous serial write after $22 changes retains recovery debt and never retries the setting', async t => {
  const fixture = await setup(t);
  await evidence(fixture, 'uncoupled');
  fixture.port.failAfterSettingAccepted = true;
  await assert.rejects(fixture.manager.begin(request()), /USB write failed/);
  assert.equal(fixture.port.settingOverrides[22], 3);
  assert.equal(fixture.manager.snapshot().recovery.required, true);
  assert.equal(fixture.manager.snapshot().session, null);
  assert.equal(serialLines(fixture.port).filter(value => value === '$22=3').length, 1);
  assert.ok(!serialLines(fixture.port).includes('$X'));
  assert.equal(JSON.parse(await readFile(fixture.port.debtPath, 'utf8')).value.active, true);
  await reconnect(fixture);
  await fixture.manager.restore({ confirmed: true, transactionId: fixture.manager.snapshot().recovery.transactionId });
  assert.equal(fixture.port.settingOverrides[22], 7);
});

test('owner revocation during a deferred begin audit cannot resurrect the old permit', async t => {
  let release, entered;
  const waiting = new Promise(resolve => { release = resolve; });
  const seen = new Promise(resolve => { entered = resolve; });
  const fixture = await setup(t, { auditHook: async kind => { if (kind === 'native.commissioning.begin') { entered(); await waiting; } } });
  await evidence(fixture, 'uncoupled');
  const pending = fixture.manager.begin(request());
  await seen;
  await assert.rejects(fixture.manager.begin(request()), /already pending/);
  fixture.manager.revoke('Operator owner changed.'); release();
  await assert.rejects(pending, /cancelled/);
  assert.equal(fixture.manager.snapshot().session, null);
  assert.equal(fixture.manager.snapshot().recovery.required, false);
  assert.deepEqual(serialLines(fixture.port).filter(value => /^\$(?:22=|X)/.test(value)), []);
});

test('evidence is committed only after its audit and cannot race a stage or survive revocation', async t => {
  let release, entered;
  const waiting = new Promise(resolve => { release = resolve; });
  const seen = new Promise(resolve => { entered = resolve; });
  const fixture = await setup(t, { auditHook: async kind => { if (kind === 'native.commissioning.evidence') { entered(); await waiting; } } });
  const { source } = await evidenceBundle(fixture, 'uncoupled');
  const importing = fixture.manager.loadEvidence(source);
  await seen;
  assert.equal(fixture.manager.snapshot().evidenceLoaded, false);
  await assert.rejects(fixture.manager.begin(request()), /pending|changing evidence/);
  fixture.manager.revoke('Owner changed during import.'); release();
  await assert.rejects(importing, /cancelled/);
  assert.equal(fixture.manager.snapshot().evidenceLoaded, false);
  assert.ok(!serialLines(fixture.port).includes('$22=3'));
});

test('revocation during temporary-profile readback prevents a later unlock and retains recovery debt', async t => {
  let release, entered, intercept = false;
  const waiting = new Promise(resolve => { release = resolve; });
  const seen = new Promise(resolve => { entered = resolve; });
  const fixture = await setup(t, { auditHook: async (kind, payload) => {
    if (intercept && kind === 'native.command' && payload.command === '$I+') { entered(); await waiting; }
  } });
  await evidence(fixture, 'uncoupled'); intercept = true;
  const pending = fixture.manager.begin(request());
  await seen;
  fixture.manager.revoke('Owner changed during temporary readback.'); release();
  await assert.rejects(pending, /cancelled/);
  assert.equal(fixture.port.settingOverrides[22], 3);
  assert.equal(fixture.manager.snapshot().session, null);
  assert.equal(fixture.manager.snapshot().temporaryProfileVerified, false);
  assert.equal(JSON.parse(await readFile(fixture.port.debtPath, 'utf8')).value.active, true);
  assert.ok(!serialLines(fixture.port).includes('$X'));
});

test('expiry while the temporary setting waits for durability prevents the setting write', async t => {
  let intercept = false, expiry;
  const fixture = await setup(t, { auditHook: async (kind, payload) => {
    if (kind === 'native.commissioning.begin') expiry = payload.expiresAt;
    if (intercept && kind === 'native.command' && payload.command === '$22=3') t.mock.method(Date, 'now', () => expiry);
  } });
  await evidence(fixture, 'uncoupled'); intercept = true;
  await assert.rejects(fixture.manager.begin(request()), /expired|cancelled/);
  assert.ok(!serialLines(fixture.port).includes('$22=3'));
  assert.ok(!serialLines(fixture.port).includes('$X'));
  assert.equal(fixture.manager.snapshot().recovery.required, true);
});

test('revocation during restoration write durability cannot change the setting', async t => {
  let release, entered, intercept = false;
  const waiting = new Promise(resolve => { release = resolve; });
  const seen = new Promise(resolve => { entered = resolve; });
  const fixture = await setup(t, { auditHook: async (kind, payload) => {
    if (intercept && kind === 'native.command' && payload.command === '$22=7') { entered(); await waiting; }
  } });
  const started = await begin(fixture); await fixture.manager.end(); await reconnect(fixture); intercept = true;
  const pending = fixture.manager.restore({ confirmed: true, transactionId: started.recovery.transactionId });
  await seen; fixture.manager.revoke('Owner changed during restore.'); release();
  await assert.rejects(pending, /cancelled/);
  assert.equal(fixture.port.settingOverrides[22], 3);
  assert.equal(fixture.manager.snapshot().recovery.required, true);
  assert.ok(!serialLines(fixture.port).includes('$22=7'));
});

test('revocation during the restored audit cannot clear durable recovery debt', async t => {
  let release, entered;
  const waiting = new Promise(resolve => { release = resolve; });
  const seen = new Promise(resolve => { entered = resolve; });
  const fixture = await setup(t, { auditHook: async kind => { if (kind === 'native.commissioning.profile.restored') { entered(); await waiting; } } });
  const started = await begin(fixture); await fixture.manager.end(); await reconnect(fixture);
  const pending = fixture.manager.restore({ confirmed: true, transactionId: started.recovery.transactionId });
  await seen; fixture.manager.revoke('Owner changed before recovery commit.'); release();
  await assert.rejects(pending, /cancelled/);
  assert.equal(fixture.port.settingOverrides[22], 7);
  assert.equal(fixture.manager.snapshot().recovery.required, true);
  assert.equal(JSON.parse(await readFile(fixture.port.debtPath, 'utf8')).value.active, true);
  await fixture.newManager();
  assert.equal(fixture.manager.snapshot().recovery.required, true);
});

test('spindle-session expiry resets outputs, invalidates permission and never resumes', async t => {
  const fixture = await setup(t, { homed: true });
  const state = await begin(fixture, 'spindle');
  fixture.controller.arm();
  await fixture.controller.outputs({ spindle: 'cw', rpm: 1000, coolant: 'flood' });
  assert.ok(serialLines(fixture.port).includes('M3 S1000'));
  assert.ok(serialLines(fixture.port).includes('M8'));
  t.mock.method(Date, 'now', () => state.session.expiresAt);
  fixture.manager.watchdog();
  assert.equal(fixture.controller.armed, false);
  assert.equal(fixture.controller.preflight, null);
  assert.equal(fixture.controller.status, null);
  assert.equal(fixture.manager.snapshot().session, null);
  assert.ok(realtimes(fixture.port).includes(REALTIME.hold));
  assert.ok(realtimes(fixture.port).includes(REALTIME.reset));
  assert.ok(!realtimes(fixture.port).includes(REALTIME.resume));
  assert.throws(() => fixture.controller.arm(), /Fresh/);
});

test('manager and controller preserve opaque workflow reservations without serial side effects', async t => {
  const fixture = await setup(t, { homed: true });
  await begin(fixture, 'probing');
  const before = fixture.port.writes.length;
  const reserved = fixture.controller.authorize('workflow', { kind: 'touch-probe' });
  assert.ok(reserved.reservation);
  fixture.controller.authorize('workflow', { kind: 'touch-probe' }, { reserve: false, reservation: reserved.reservation });
  assert.throws(() => fixture.controller.authorize('workflow', { kind: 'touch-probe' }, { reserve: false, reservation: { ...reserved.reservation } }), /reservation/);
  assert.equal(fixture.manager.snapshot().session.remainingCommands, definition('probing').limits.maxCommands - 1);
  assert.equal(fixture.port.writes.length, before);
});

test('corrupt persistent debt fails closed without writing to the controller', async t => {
  const fixture = await setup(t);
  await writeFile(fixture.port.debtPath, '{"broken":true}');
  const before = fixture.port.writes.length;
  await fixture.newManager();
  assert.equal(fixture.port.writes.length, before);
  assert.equal(fixture.manager.snapshot().recovery.required, true);
  assert.ok(fixture.manager.snapshot().recovery.error);
  assert.throws(() => fixture.controller.arm(), /integrity|undefined/i);
  await assert.rejects(fixture.manager.restore({ confirmed: true }), /integrity|undefined/i);
});
