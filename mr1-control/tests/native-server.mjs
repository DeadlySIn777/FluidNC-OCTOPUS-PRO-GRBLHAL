import test, { mock } from 'node:test';
import { existsSync } from 'node:fs';
import { verifyNativeFirmware as verifyRealFirmware } from '../service/native-firmware.mjs';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
// HTTP authority/race contracts use synthetic transport and synthetic artifact identity.
// tests/native-firmware.mjs independently exercises the real, fail-closed verifier.
const firmwareManifest = JSON.parse(await readFile(new URL('../public/firmware/octopus-pro-v1.1-f429-mr1/firmware-manifest.json', import.meta.url), 'utf8'));
const syntheticArtifact = async () => ({ candidateId: firmwareManifest.candidateId, ...firmwareManifest.artifact,
  verifiedAt: new Date().toISOString(), verificationScope: 'synthetic-test-only', onDeviceFlashVerified: false });
let artifactVerifier = syntheticArtifact;
mock.module('../service/native-firmware.mjs', { namedExports: { verifyNativeFirmware: (...args) => artifactVerifier(...args) } });
const { createNativeServer } = await import('../service/native-server.mjs');
const optionalFirmware = existsSync(new URL('../public/firmware/octopus-pro-v1.1-f429-mr1/firmware.bin', import.meta.url));
import { REALTIME } from '../service/native-controller.mjs';
import { WireController, profile, delay, sampleProgram } from './fixtures/native-wire.mjs';
import { COMMISSIONING_CHECKS, createCommissioningBundle, createCommissioningEvidence, upsertCommissioningEvidence } from '../src/commissioning-record.js';
import { createConnection } from 'node:net';

async function setup(t, options = {}) {
  const prefix = resolve(tmpdir(), 'mr1-native-tests-');
  const directory = await mkdtemp(prefix);
  const port = new WireController();
  const service = await createNativeServer({ profile, listPorts: async () => [{ path: 'COM7' }], portFactory: async () => port,
    motionQualified: true, journalDirectory: directory, ...options });
  const origin = await service.start(0);
  t.after(async () => {
    await service.stop();
    assert.ok(resolve(directory).startsWith(prefix) && resolve(directory).length > prefix.length);
    await rm(directory, { recursive: true, force: true });
  });
  let token = '';
  const request = async (path, input, overrides = {}) => {
    const res = await fetch(origin + path, input === undefined ? overrides : { method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: origin, 'X-MR1-Session': token, ...overrides }, body: JSON.stringify(input) });
    return { status: res.status, body: await res.json() };
  };
  const claim = async () => { const res = await request('/api/session', {}); token = res.body.token; return res; };
  return { service, port, request, claim, origin };
}

function delayedJournal(kind, reconciliation = { requiresReview: false }, matches = () => true) {
  let release, entered;
  const pending = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { entered = resolve; });
  let enabled = false;
  return {
    journal: { reconcile: async () => reconciliation, close: async () => {},
      append: async (event, payload) => {
        if (enabled && event === kind && matches(payload)) { entered(payload); await pending; }
        return { digest: 'A'.repeat(64) };
      } },
    block() { enabled = true; }, started, release,
  };
}

async function syntheticQualification(controller) {
  const manifest = JSON.parse(await readFile(new URL('../public/firmware/octopus-pro-v1.1-f429-mr1/firmware-manifest.json', import.meta.url), 'utf8'));
  const context = { machineId: 'MR1-12345678-1234-4123-8123-123456789ABC', controllerSimulated: false,
    controllerFingerprint: controller.preflight.configurationFingerprint, firmwareSha256: manifest.artifact.sha256 };
  let record = {};
  for (const check of COMMISSIONING_CHECKS) {
    record = upsertCommissioningEvidence(record, createCommissioningEvidence(check.id, {
      result: 'pass', source: check.acceptedSources[0], operator: 'TEST FIXTURE ONLY', instrument: 'TEST', instrumentId: 'TEST', value: 'TEST', unit: 'TEST',
      artifact: { name: 'synthetic-test-evidence.txt', bytes: 4, sha256: 'A'.repeat(64) }, notes: 'Synthetic test; not physical evidence.',
    }, context), context);
  }
  return JSON.stringify(await createCommissioningBundle(record, context));
}

test('native HTTP service is offline and read-only at startup', async t => {
  const { request, port } = await setup(t);
  const state = (await request('/api/state')).body;
  assert.equal(state.connected, false); assert.equal(state.armed, false); assert.deepEqual(port.writes, []);
  assert.equal((await request('/health')).body.mode, 'serial');
  assert.equal((await request('/api/ports')).body[0].path, 'COM7');
});
test('only a same-origin single owner can issue typed commands', async t => {
  const { request, claim, port } = await setup(t);
  assert.equal((await request('/api/session', {}, { Origin: 'https://untrusted.example' })).status, 403);
  assert.equal((await request('/api/connect', { port: 'COM7' })).status, 400);
  await claim();
  assert.equal((await request('/api/session', {})).status, 423);
  assert.equal((await request('/api/connect', { port: 'COM7' }, { 'X-MR1-Session': 'a'.repeat(64) })).status, 400);
  assert.equal((await request('/api/command', { action: 'raw', source: '$X' })).status, 400);
  assert.deepEqual(port.writes, []);
  assert.equal((await request('/api/connect', { port: 'COM7' })).status, 200);
  assert.equal((await request('/api/command', { action: 'arm', confirmed: false })).status, 400);
});
test('a lost browser lease disarms and cannot be inherited by another owner', async t => {
  // Leave enough room for durable preflight I/O on a busy Windows host;
  // the invariant is expiry after heartbeats stop, not a 160 ms setup race.
  const { request, claim, service } = await setup(t, { leaseMs: 2000 });
  await claim(); await request('/api/connect', { port: 'COM7' });
  assert.equal((await request('/api/command', { action: 'arm', confirmed: true })).status, 200);
  await delay(2700);
  assert.equal(service.controller.armed, false); assert.match(service.controller.fault, /session lost/);
  await claim();
  assert.equal((await request('/api/command', { action: 'arm', confirmed: true })).status, 400);
});
test('HTTP run rejects stale, unhomed or mismatched programs before acceptance', async t => {
  const { request, claim, service, port } = await setup(t);
  await claim(); await request('/api/connect', { port: 'COM7' });
  const loaded = (await request('/api/program', { source: sampleProgram, name: 'test.nc' })).body;
  await request('/api/command', { action: 'arm', confirmed: true });
  port.homed = false; port.send(port.status());
  assert.equal((await request('/api/command', { action: 'run', sha256: loaded.sha256 })).status, 400);
  assert.equal(service.controller.job.sent, 0);
});
test('journal failure blocks a command before serial write while stop still reaches controller', async t => {
  let broken = false;
  const journal = { reconcile: async () => ({ requiresReview: false }), append: async () => { if (broken) throw new Error('disk unavailable'); }, close: async () => {} };
  const { request, claim, port, service } = await setup(t, { journal });
  await claim(); await request('/api/connect', { port: 'COM7' });
  await request('/api/command', { action: 'arm', confirmed: true });
  broken = true;
  assert.equal((await request('/api/command', { action: 'jog', axis: 'x', distance: 1, feed: 50 })).status, 400);
  assert.equal(port.writes.some(x => typeof x === 'string' && x.startsWith('$J=')), false);
  assert.equal(service.controller.armed, false);
  await request('/api/command', { action: 'stop' });
  assert.ok(port.writes.some(x => Array.isArray(x) && x[0] === REALTIME.reset));
});

test('synthetic commissioning evidence must match the live handshake and expires on disconnect', async t => {
  const { claim, request, service } = await setup(t, { motionQualified: false });
  await claim(); await request('/api/connect', { port: 'COM7' });
  const manifest = JSON.parse(await readFile(new URL('../public/firmware/octopus-pro-v1.1-f429-mr1/firmware-manifest.json', import.meta.url), 'utf8'));
  const context = { machineId: 'MR1-12345678-1234-4123-8123-123456789ABC', controllerSimulated: false,
    controllerFingerprint: service.controller.preflight.configurationFingerprint, firmwareSha256: manifest.artifact.sha256 };
  let record = {};
  for (const check of COMMISSIONING_CHECKS) {
    const evidence = createCommissioningEvidence(check.id, {
      result: 'pass', source: check.acceptedSources[0], operator: 'TEST FIXTURE ONLY', instrument: 'TEST', instrumentId: 'TEST', value: 'TEST', unit: 'TEST',
      artifact: { name: 'synthetic-test-evidence.txt', bytes: 4, sha256: 'A'.repeat(64) }, notes: 'Synthetic test; not physical evidence.',
    }, context);
    record = upsertCommissioningEvidence(record, evidence, context);
  }
  const bundle = await createCommissioningBundle(record, context);
  assert.equal((await request('/api/qualification', { bundle: JSON.stringify(bundle) })).status, 200);
  assert.equal(service.controller.motionQualified, true);
  await request('/api/disconnect', {});
  assert.equal(service.controller.motionQualified, false);
  await request('/api/connect', { port: 'COM7' });
  const incomplete = await createCommissioningBundle({ machineId: context.machineId }, context);
  assert.equal((await request('/api/qualification', { bundle: JSON.stringify(incomplete) })).status, 400);
  assert.equal(service.controller.motionQualified, false);
});

test('qualification rechecks bundled firmware changed after successful service startup', { skip: !optionalFirmware && 'Optional local firmware image not imported.' }, async t => {
  artifactVerifier = verifyRealFirmware;
  t.after(() => { artifactVerifier = syntheticArtifact; });
  const prefix = resolve(tmpdir(), 'mr1-native-firmware-');
  const webRoot = await mkdtemp(prefix);
  let nativeService;
  t.after(async () => {
    await nativeService?.stop();
    assert.ok(resolve(webRoot).startsWith(prefix) && resolve(webRoot).length > prefix.length);
    await rm(webRoot, { recursive: true, force: true });
  });
  await cp(new URL('../public/firmware/', import.meta.url), resolve(webRoot, 'firmware'), { recursive: true });
  const { claim, request, service } = await setup(t, { motionQualified: false, webRoot });
  nativeService = service;
  await claim();
  assert.equal((await request('/api/connect', { port: 'COM7' })).status, 200);
  const bundle = await syntheticQualification(service.controller);
  const firmwarePath = resolve(webRoot, 'firmware/octopus-pro-v1.1-f429-mr1/firmware.bin');
  const original = await readFile(firmwarePath);
  const changed = Buffer.from(original);
  changed[100] ^= 1; // Preserve length so qualification must validate the image hash.
  await writeFile(firmwarePath, changed);

  const rejected = await request('/api/qualification', { bundle });
  assert.equal(rejected.status, 400);
  assert.match(rejected.body.error, /SHA-256/);
  assert.equal(service.controller.motionQualified, false);
  assert.equal((await request('/api/state')).body.qualification, null);

  // The identical live handshake and evidence pass once the original image is restored.
  await writeFile(firmwarePath, original);
  assert.equal((await request('/api/qualification', { bundle })).status, 200);
  assert.equal(service.controller.motionQualified, true);
});

test('configuration metadata is validated and journaled without granting machine authority', async t => {
  const { request, service } = await setup(t);
  assert.equal((await request('/journal/configuration', { arbitrary: true })).status, 400);
  const response = await request('/journal/configuration', {
    protocol: 'mr1-browser-configuration-event-v1', eventId: 'cfg-test-native-001', storageKey: 'mr1-control.wiring-installation.v1', category: 'wiring-evidence',
    action: 'create', beforeSha256: null, afterSha256: 'A'.repeat(64), changedPaths: ['hardwareProfile'], changedPathsTruncated: false, occurredAt: new Date().toISOString(),
  });
  assert.equal(response.status, 200); assert.equal(response.body.sealed, true); assert.match(response.body.digest, /^[A-F0-9]{64}$/);
  assert.equal(service.controller.armed, false);
});

test('service shutdown requires disconnection and records a clean stop', async t => {
  const { request, claim, service } = await setup(t);
  await claim(); await request('/api/connect', { port: 'COM7' });
  assert.equal((await request('/api/shutdown', {})).status, 400);
  await request('/api/disconnect', {});
  assert.equal((await request('/api/shutdown', {})).status, 200);
  await service.stop(); assert.equal(service.server.listening, false);
});

test('shutdown drains an unfinished HTTP request within a bounded interval', async t => {
  const { service, origin } = await setup(t);
  const endpoint = new URL(origin);
  const received = new Promise(resolve => service.server.once('request', resolve));
  const socket = createConnection({ host: endpoint.hostname, port: Number(endpoint.port) });
  socket.on('error', () => {}); // A reset is an expected forced-drain outcome.
  t.after(() => socket.destroy());
  const closed = new Promise(resolve => socket.once('close', resolve));
  await new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('error', reject); });
  socket.write(`POST /api/program HTTP/1.1\r\nHost: ${endpoint.host}\r\nOrigin: ${origin}\r\nContent-Type: application/json\r\nContent-Length: 1000\r\n\r\n{"source":`);
  await received;
  let deadline;
  try {
    await Promise.race([
      (async () => { await service.stop(); await closed; })(),
      new Promise((_, reject) => { deadline = setTimeout(() => { socket.destroy(); reject(new Error('HTTP shutdown exceeded its drain bound.')); }, 3000); }),
    ]);
  } finally { clearTimeout(deadline); }
  assert.equal(service.server.listening, false);
  assert.equal(socket.destroyed, true);
  const connections = await new Promise((resolve, reject) => service.server.getConnections((error, count) => error ? reject(error) : resolve(count)));
  assert.equal(connections, 0);
  assert.equal(service.controller.connected, false);
});

test('offline SSE stays open and carries later controller events without reconnecting', async t => {
  const { service, origin } = await setup(t);
  const abort = new AbortController();
  const deadline = setTimeout(() => abort.abort(), 3000);
  let reader;
  try {
    const response = await fetch(`${origin}/events`, { signal: abort.signal });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /^text\/event-stream/);
    reader = response.body.getReader();
    const first = await reader.read();
    assert.equal(first.done, false);
    assert.match(new TextDecoder().decode(first.value), /event: bridge/);
    let ended = false;
    const next = reader.read().then(chunk => { ended = chunk.done; return chunk; });
    await delay(700);
    assert.equal(ended, false, 'offline stream must remain open without serial events');
    service.controller.publish();
    const second = await next;
    assert.equal(second.done, false);
    assert.match(new TextDecoder().decode(second.value), /event: native-state/);
    assert.equal(service.controller.connected, false);
  } finally {
    clearTimeout(deadline);
    await reader?.cancel().catch(() => {});
    abort.abort();
  }
});

test('a journal-delayed arm cannot inherit a replacement browser session', async t => {
  const blocked = delayedJournal('native.request');
  const { request, claim, service } = await setup(t, { journal: blocked.journal, leaseMs: 500 });
  t.after(blocked.release);
  await claim();
  assert.equal((await request('/api/connect', { port: 'COM7' })).status, 200);
  blocked.block();
  const arm = request('/api/command', { action: 'arm', confirmed: true });
  await blocked.started;
  await delay(700);
  assert.equal((await claim()).status, 200);
  blocked.release();
  assert.equal((await arm).status, 400);
  assert.equal(service.controller.armed, false);
});

test('qualification interrupted during durable audit cannot requalify a disconnected controller', async t => {
  const blocked = delayedJournal('native.qualification');
  const { request, claim, service } = await setup(t, { journal: blocked.journal, motionQualified: false });
  t.after(blocked.release);
  await claim(); await request('/api/connect', { port: 'COM7' });
  blocked.block();
  const pending = request('/api/qualification', { bundle: await syntheticQualification(service.controller) });
  await blocked.started;
  assert.equal((await request('/api/disconnect', {})).status, 200);
  blocked.release();
  assert.equal((await pending).status, 400);
  assert.equal(service.controller.connected, false);
  assert.equal(service.controller.motionQualified, false);
  assert.equal((await request('/api/state')).body.qualification, null);
});

test('recovery review excludes a concurrent connect until its durable decision completes', async t => {
  const blocked = delayedJournal('native.recovery.review', { requiresReview: true, reviewable: true, reconciliationId: 'fixture-review' });
  const { request, claim, port } = await setup(t, { journal: blocked.journal });
  t.after(blocked.release);
  await claim(); blocked.block();
  const pending = request('/api/recovery', { reconciliationId: 'fixture-review', confirmed: true });
  await blocked.started;
  assert.equal((await request('/api/connect', { port: 'COM7' })).status, 400);
  assert.equal(port.isOpen, false);
  blocked.release();
  assert.equal((await pending).body.journalReady, true);
});

test('heartbeats and feed hold bypass a delayed start while duplicate mutations are rejected', async t => {
  const blocked = delayedJournal('native.request', { requiresReview: false }, payload => payload.action === 'arm');
  const { request, claim, service } = await setup(t, { journal: blocked.journal });
  t.after(blocked.release);
  await claim(); await request('/api/connect', { port: 'COM7' }); blocked.block();
  const pending = request('/api/command', { action: 'arm', confirmed: true });
  await blocked.started;
  assert.equal((await request('/api/heartbeat', {})).status, 200);
  assert.equal((await request('/api/command', { action: 'arm', confirmed: true })).status, 400);
  assert.equal((await request('/api/command', { action: 'hold' })).status, 200);
  blocked.release();
  assert.equal((await pending).status, 400);
  assert.equal(service.controller.armed, false);
});

test('feed hold preserves an accepted program context so it can resume and complete', async t => {
  const { request, claim, service, port } = await setup(t);
  await claim(); await request('/api/connect', { port: 'COM7' });
  const loaded = (await request('/api/program', { source: sampleProgram, name: 'hold-fixture.nc' })).body;
  await request('/api/command', { action: 'arm', confirmed: true });
  port.deferPauseAck = true;
  assert.equal((await request('/api/command', { action: 'run', sha256: loaded.sha256 })).status, 202);
  await service.controller.waitFor(() => port.pauseAckPending, 2000);
  assert.equal((await request('/api/command', { action: 'hold' })).status, 200);
  assert.equal(service.controller.armed, true);
  assert.equal((await request('/api/command', { action: 'resume' })).status, 200);
  await service.controller.waitFor(() => service.controller.job.state === 'complete', 2000);
  assert.equal(service.controller.fault, null);
});

test('shutdown rejects retained handles and latches before a pipelined connect can dispatch', async t => {
  const { request, claim, service, port, origin } = await setup(t);
  const { body: { token } } = await claim();
  service.controller.port = port; // Synthetic closed handle retained after a failed close.
  assert.equal((await request('/api/shutdown', {})).status, 400);
  service.controller.port = null;
  let connects = 0;
  service.controller.connect = async () => { connects++; return service.controller.snapshot(); };
  const endpoint = new URL(origin);
  const socket = createConnection({ host: endpoint.hostname, port: Number(endpoint.port) });
  socket.on('error', () => {});
  t.after(() => socket.destroy());
  let response = '';
  socket.on('data', chunk => { response += chunk.toString(); });
  const closed = new Promise(resolve => socket.once('close', resolve));
  await new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('error', reject); });
  const post = (path, input) => {
    const content = JSON.stringify(input);
    return `POST ${path} HTTP/1.1\r\nHost: ${endpoint.host}\r\nOrigin: ${origin}\r\nX-MR1-Session: ${token}\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(content)}\r\n\r\n${content}`;
  };
  socket.write(post('/api/shutdown', {}) + post('/api/connect', { port: 'COM7' }));
  await closed;
  assert.match(response, /"closing":true/);
  assert.match(response, /503 Service Unavailable/);
  assert.equal(connects, 0);
  assert.deepEqual(port.writes, []);
});

const realtime = (port, byte) => port.writes.filter(bytes => Array.isArray(bytes) && bytes[0] === byte).length;

test('a failed durable journal write blocks the command and faults the controller', async t => {
  const { request, claim, port, service } = await setup(t);
  const { directory } = (await request('/health')).body.journal;
  await claim(); await request('/api/connect', { port: 'COM7' });
  assert.equal((await request('/api/command', { action: 'arm', confirmed: true })).status, 200);
  // The real journal reports this EISDIR failure as a null record, never a rejection.
  await rm(resolve(directory, 'mr1-events.jsonl'));
  await mkdir(resolve(directory, 'mr1-events.jsonl'));
  const jog = await request('/api/command', { action: 'jog', axis: 'x', distance: -1, feed: 50 });
  assert.equal(jog.status, 400); assert.match(jog.body.error, /EISDIR|directory/);
  assert.equal(port.writes.some(x => typeof x === 'string' && x.startsWith('$J=')), false);
  assert.equal(service.controller.armed, false); assert.match(service.controller.fault, /Journal write failed/);
  assert.ok(realtime(port, REALTIME.reset) > 0);
  assert.equal((await request('/api/state')).body.journalReady, false);
  const configuration = await request('/journal/configuration', {
    protocol: 'mr1-browser-configuration-event-v1', eventId: 'cfg-test-native-002', storageKey: 'mr1-control.wiring-installation.v1', category: 'wiring-evidence',
    action: 'create', beforeSha256: null, afterSha256: 'A'.repeat(64), changedPaths: ['hardwareProfile'], changedPathsTruncated: false, occurredAt: new Date().toISOString(),
  });
  assert.equal(configuration.status, 400); assert.match(configuration.body.error, /EISDIR|directory/);
});

test('a journal export failure is reported instead of an empty download', async t => {
  const journal = { reconcile: async () => ({ requiresReview: false }), append: async () => ({ digest: 'A'.repeat(64) }), close: async () => {},
    exportText: async () => { throw new Error('journal unreadable'); } };
  const { request } = await setup(t, { journal });
  const response = await request('/journal/export');
  assert.equal(response.status, 400); assert.match(response.body.error, /unreadable/);
});

test('energy-removing commands reach the controller without the browser lease; nothing else does', async t => {
  const { request, claim, port, service, origin } = await setup(t, { leaseMs: 1500 });
  const { body: { token } } = await claim();
  await request('/api/connect', { port: 'COM7' });
  await request('/api/command', { action: 'arm', confirmed: true });
  const stranger = { 'X-MR1-Session': '' };
  for (const action of ['arm', 'resume', 'run', 'home']) {
    const denied = await request('/api/command', { action, confirmed: true }, stranger);
    assert.equal(denied.status, 400, action); assert.equal(denied.body.sessionRejected, true, action);
  }
  assert.equal((await request('/api/command', { action: 'hold' }, stranger)).status, 200);
  assert.equal(service.controller.armed, true, 'hold is resumable');
  assert.equal((await request('/api/command', { action: 'stop' }, { Origin: 'https://untrusted.example' })).status, 403);
  assert.equal(realtime(port, REALTIME.reset), 0);
  assert.equal((await request('/api/command', { action: 'stop' }, stranger)).status, 200);
  assert.equal(service.controller.armed, false); assert.equal(realtime(port, REALTIME.reset), 1);
  // The owner's lease is untouched: another browser cannot claim it yet, and
  // the owner may still stop after the lease expired.
  assert.equal((await request('/api/session', {}, { 'X-MR1-Session': '' })).status, 423);
  await delay(1700);
  assert.equal((await request('/api/command', { action: 'disarm' }, { 'X-MR1-Session': token })).status, 200);
  const records = (await (await fetch(`${origin}/journal/export`)).text()).trim().split('\n').map(line => JSON.parse(line));
  assert.deepEqual(records.filter(record => record.kind === 'native.request' && ['stop', 'disarm'].includes(record.payload.action)).map(record => record.payload.leaseHeld), [false, false]);
});

test('a large program loads while armed without starving status or stop handling', async t => {
  const { request, claim, service } = await setup(t);
  await claim(); await request('/api/connect', { port: 'COM7' });
  assert.equal((await request('/api/command', { action: 'arm', confirmed: true })).status, 200);
  const body = [];
  for (let i = 0, size = 0; size < 4.5 * 1024 * 1024; i++) { const line = `G1 X${(i % 100) / 10} Y${(i % 37) / 10} F1000`; body.push(line); size += line.length + 1; }
  const source = sampleProgram.replace('G1 Z0 F100\n', `G1 Z0 F100\n${body.join('\n')}\n`);
  let last = performance.now(), worst = 0;
  const lag = setInterval(() => { const now = performance.now(); worst = Math.max(worst, now - last); last = now; }, 20);
  let loaded;
  try { loaded = await request('/api/program', { source, name: 'large.nc' }); } finally { clearInterval(lag); }
  assert.equal(loaded.status, 200); assert.equal(loaded.body.sha256, createHash('sha256').update(source).digest('hex'));
  assert.equal(service.controller.program.lines.length, source.split('\n').length);
  assert.equal(service.controller.armed, true); assert.equal(service.controller.fault, null);
  assert.ok(worst < 1000, `event loop stalled for ${Math.round(worst)} ms`);
  const rejected = await request('/api/program', { source: `${source}\t\u0018`, name: 'bad.nc' });
  assert.equal(rejected.status, 400); assert.match(rejected.body.error, /control characters/);
  assert.equal(service.controller.program.sha256, loaded.body.sha256);
});

test('request bodies decode multibyte characters split across TCP chunks', async t => {
  const { claim, service, origin } = await setup(t);
  const { body: { token } } = await claim();
  const content = Buffer.from(JSON.stringify({ source: sampleProgram, name: 'Müller-ö.nc' }));
  const split = content.indexOf(Buffer.from('ü')) + 1;
  const endpoint = new URL(origin);
  const socket = createConnection({ host: endpoint.hostname, port: Number(endpoint.port) });
  t.after(() => socket.destroy());
  let response = '';
  socket.on('data', chunk => { response += chunk; });
  const ended = new Promise(resolve => socket.once('end', resolve));
  await new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('error', reject); });
  socket.write(`POST /api/program HTTP/1.1\r\nHost: ${endpoint.host}\r\nOrigin: ${origin}\r\nContent-Type: application/json\r\nX-MR1-Session: ${token}\r\nContent-Length: ${content.length}\r\nConnection: close\r\n\r\n`);
  socket.write(content.subarray(0, split)); await delay(50); socket.write(content.subarray(split));
  await ended;
  assert.match(response, /^HTTP\/1\.1 200/);
  assert.equal(service.controller.program.name, 'Müller-ö.nc');
});

test('a static file read error cannot crash the controller service', { skip: process.platform !== 'linux' && 'Uses /proc/self/mem as a file that stats but cannot be read.' }, async t => {
  const prefix = resolve(tmpdir(), 'mr1-native-web-');
  const webRoot = await mkdtemp(prefix);
  t.after(() => rm(webRoot, { recursive: true, force: true }));
  await writeFile(resolve(webRoot, 'index.html'), '<!doctype html>');
  await symlink('/proc/self/mem', resolve(webRoot, 'broken.bin'));
  const { request, claim, service, origin } = await setup(t, { webRoot });
  await claim(); await request('/api/connect', { port: 'COM7' });
  await request('/api/command', { action: 'arm', confirmed: true });
  await fetch(`${origin}/broken.bin`).then(response => response.arrayBuffer()).catch(() => {});
  await delay(50);
  assert.equal((await request('/api/state')).status, 200);
  assert.equal(service.controller.armed, true);
});

test('console close and crashes stop an armed controller before the process exits', async t => {
  const script = fileURLToPath(new URL('./fixtures/native-supervised-child.mjs', import.meta.url));
  for (const trigger of ['SIGHUP', 'crash', 'reject']) {
    if (trigger === 'SIGHUP' && process.platform === 'win32') continue; // Windows raises SIGHUP only for its own console.
    const directory = await mkdtemp(resolve(tmpdir(), 'mr1-native-supervised-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const log = resolve(directory, 'realtime.log');
    const child = spawn(process.execPath, ['--experimental-test-module-mocks', script, log, directory], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', chunk => { stderr += chunk; });
    const exited = new Promise(resolve => child.once('exit', code => resolve(code)));
    await new Promise((resolve, reject) => {
      child.stdout.on('data', chunk => { if (String(chunk).includes('READY')) resolve(); });
      child.once('exit', () => reject(new Error(`Supervised child exited early: ${stderr}`)));
    });
    if (trigger === 'SIGHUP') child.kill('SIGHUP'); else child.stdin.write(`${trigger}\n`);
    let timer;
    const code = await Promise.race([exited, new Promise((_, reject) => { timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`${trigger}: supervised stop did not exit`)); }, 8000); })]);
    clearTimeout(timer);
    const after = (await readFile(log, 'utf8')).split('READY\n')[1].trim().split('\n');
    assert.deepEqual(after, ['0x82', '0x18'], trigger);
    assert.equal(code, trigger === 'SIGHUP' ? 0 : 1, `${trigger}: ${stderr}`);
    if (trigger !== 'SIGHUP') assert.match(stderr, /synthetic (crash|rejection)/);
  }
});
