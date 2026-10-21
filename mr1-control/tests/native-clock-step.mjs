import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
// Stale-status and lease watchdogs must measure elapsed time, not the OS wall
// clock, which Windows time sync or an operator can step in either direction.
const manifest = JSON.parse(await readFile(new URL('../public/firmware/octopus-pro-v1.1-f429-mr1/firmware-manifest.json', import.meta.url), 'utf8'));
mock.module('../service/native-firmware.mjs', { namedExports: {
  verifyNativeFirmware: async () => ({ candidateId: manifest.candidateId, ...manifest.artifact, verificationScope: 'synthetic-test-only' }) } });
const { NativeController } = await import('../service/native-controller.mjs');
const { createNativeServer } = await import('../service/native-server.mjs');
const { WireController, profile, delay } = await import('./fixtures/native-wire.mjs');

// The production defaults read Date.now, so a steppable Date.now models the OS clock.
const realNow = Date.now;
let offset = 0;
Date.now = () => realNow() + offset;
test.after(() => { Date.now = realNow; });

async function connected(t, arm = true) {
  offset = 0;
  const port = new WireController();
  const controller = new NativeController({ profile, portFactory: async () => port, motionQualified: true, ackTimeout: 120 });
  t.after(async () => { offset = 0; await controller.disconnect(); });
  await controller.connect('COM7');
  if (arm) controller.arm();
  return { controller, port };
}

test('a backward wall-clock step does not blind the stale-status watchdog', async t => {
  const { controller, port } = await connected(t);
  offset = -60_000; port.silent = true;
  await delay(1800);
  assert.equal(controller.armed, false);
  assert.match(controller.fault ?? '', /status timed out/);
});

test('a backward wall-clock step does not make an old status fresh', async t => {
  const { controller, port } = await connected(t, false);
  offset = -60_000; port.silent = true;
  await delay(1700);
  assert.throws(() => controller.arm(), /Fresh controller status is required/);
  assert.equal(controller.armed, false);
});

test('a forward wall-clock step does not fault a healthy link', async t => {
  const { controller } = await connected(t);
  offset = 5_000;
  await delay(400);
  assert.equal(controller.fault, null);
  assert.equal(controller.armed, true);
});

async function armedService(t, leaseMs) {
  offset = 0;
  const prefix = resolve(tmpdir(), 'mr1-clock-step-');
  const directory = await mkdtemp(prefix);
  const service = await createNativeServer({ profile, listPorts: async () => [{ path: 'COM7' }], portFactory: async () => new WireController(),
    motionQualified: true, journalDirectory: directory, leaseMs });
  const origin = await service.start(0);
  t.after(async () => {
    offset = 0; await service.stop();
    assert.ok(resolve(directory).startsWith(prefix) && resolve(directory).length > prefix.length);
    await rm(directory, { recursive: true, force: true });
  });
  let token = '';
  const post = async (path, input = {}) => {
    const res = await fetch(origin + path, { method: 'POST', body: JSON.stringify(input),
      headers: { 'Content-Type': 'application/json', Origin: origin, 'X-MR1-Session': token } });
    return { status: res.status, body: await res.json() };
  };
  token = (await post('/api/session')).body.token;
  assert.equal((await post('/api/connect', { port: 'COM7' })).status, 200);
  assert.equal((await post('/api/command', { action: 'arm', confirmed: true })).status, 200);
  assert.equal(service.controller.armed, true);
  return { service, post };
}

test('a backward wall-clock step does not extend an abandoned operator lease', async t => {
  const { service } = await armedService(t, 500);
  offset = -60_000;
  await delay(900);
  assert.equal(service.controller.armed, false);
  assert.equal(service.controller.fault, 'Operator session lost.');
});

test('a forward wall-clock step does not end a live operator lease', async t => {
  const { service, post } = await armedService(t, 4000);
  assert.equal((await post('/api/heartbeat')).status, 200);
  offset = 5_000;
  await delay(300);
  assert.equal((await post('/api/heartbeat')).status, 200);
  assert.equal(service.controller.fault, null);
  assert.equal(service.controller.armed, true);
});
