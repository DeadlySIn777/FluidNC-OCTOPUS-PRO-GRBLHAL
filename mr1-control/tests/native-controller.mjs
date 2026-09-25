import test from 'node:test';
import assert from 'node:assert/strict';
import { NativeController, REALTIME } from '../service/native-controller.mjs';
import { WireController, profile, sampleProgram as program, delay } from './fixtures/native-wire.mjs';

class DirectActionPort extends WireController {
  constructor() {
    super();
    this.modal = 'G0 G54 G17 G21 G90 G94 G49 G98 G50 M5 M9 T1 F100 S0';
    this.offsets = Object.fromEntries(['G54', 'G55', 'G56', 'G57', 'G58', 'G59'].map(key => [key, [0, 0, 0]]));
    this.g92 = [0, 0, 0]; this.tlo = [0, 0, 0];
  }
  send(text) { if (!this.dropProbeReports || !text.startsWith('[PRB:')) super.send(text); }
  write(data, cb) {
    const command = Buffer.isBuffer(data) ? null : String(data).trim();
    if (command === '$G' || command === '$#') {
      this.writes.push(command); cb?.();
      queueMicrotask(() => {
        const reports = command === '$G' ? (this.modalReports?.() ?? [`[GC:${this.modal}]`])
          : (this.parameterReports?.() ?? [...Object.entries(this.offsets), ['G92', this.g92], ['TLO', this.tlo]].map(([key, vector]) => `[${key}:${vector.join(',')}]`));
        for (const report of reports) this.send(`${report}\r\n`);
        this.send('ok\r\n');
      });
      return;
    }
    const zero = command?.match(/^G10 L20 P([1-6]) ([XYZ])0$/);
    if (zero && !this.ignoreZero) {
      const index = ['X', 'Y', 'Z'].indexOf(zero[2]);
      this.offsets[`G${53 + Number(zero[1])}`][index] = this.position[index] - this.g92[index] - this.tlo[index];
    }
    super.write(data, cb);
  }
}

async function setup(t, options = {}) {
  const port = options.port ?? new WireController();
  const controller = new NativeController({ profile, portFactory: async () => port, motionQualified: true, ackTimeout: 120, ...options });
  t.after(() => controller.disconnect());
  await controller.connect('COM7');
  return { controller, port };
}
test('read-only serial handshake checks real reply bytes and accepts split acknowledgements', async t => {
  const { controller, port } = await setup(t);
  assert.equal(controller.preflight.preflightPassed, true);
  assert.equal(controller.armed, false);
  assert.deepEqual(port.writes.filter(x => typeof x === 'string'), ['$I+', '$$', '$G', '$#', '$N']);
  assert.equal(controller.preflight.simulated, false);
});
test('uncommissioned installations cannot arm even with an exact firmware profile', async t => {
  const { controller } = await setup(t, { motionQualified: false });
  assert.throws(() => controller.arm(), /commissioning/);
});
test('jog requires arming, homing, fresh status and a bounded target', async t => {
  const { controller, port } = await setup(t);
  await assert.rejects(controller.jog({ axis: 'x', distance: 1, feed: 50 }), /Arm/);
  controller.arm(); port.homed = false; port.send(port.status());
  await assert.rejects(controller.jog({ axis: 'x', distance: 1, feed: 50 }), /Home/);
  port.homed = true; port.position[0] = -2; port.send(port.status());
  await assert.rejects(controller.jog({ axis: 'x', distance: 1, feed: 50 }), /travel/);
  await controller.jog({ axis: 'x', distance: -1, feed: 50 });
  assert.ok(port.writes.includes('$J=G21 G91 X-1 F50'));
});
test('acknowledgement timeout sends hold, disarms and never retries', async t => {
  const { controller, port } = await setup(t);
  controller.arm(); port.ignore = 'M5';
  await assert.rejects(controller.outputs({}), /timed out/);
  assert.equal(port.writes.filter(x => x === 'M5').length, 1);
  assert.equal(controller.armed, false);
  assert.ok(port.writes.some(x => Array.isArray(x) && x[0] === REALTIME.hold));
});
test('controller errors and reset banners invalidate permission', async t => {
  const { controller, port } = await setup(t);
  controller.arm(); port.send('error:20\r\n');
  assert.equal(controller.armed, false);
  assert.match(controller.fault, /error 20/);
  port.send('GrblHAL 1.1f\r\n'); assert.equal(controller.preflight, null); assert.equal(controller.status, null);
});
test('drive alarm inputs stop an armed session', async t => {
  const { controller, port } = await setup(t);
  controller.arm(); port.pins = 'F'; port.send(port.status());
  assert.equal(controller.armed, false);
  assert.match(controller.fault, /safety input/);
});
test('homing accepts an unhomed idle controller and waits for a fresh final report', async t => {
  const { controller, port } = await setup(t);
  port.homed = false; port.send(port.status()); controller.arm();
  await controller.home(); assert.equal(controller.status.homing.complete, true);
});
test('program gate rejects embedded realtime commands and out-of-contract code', async t => {
  const { controller } = await setup(t);
  assert.throws(() => controller.loadProgram(program + '\n(comment\u0018)'), /control characters/);
  assert.throws(() => controller.loadProgram(program.replace('S5000', 'S9000')), /spindle|Spindle/);
});
test('program is bound to a reviewed hash and pauses transmission at M0', async t => {
  const { controller, port } = await setup(t);
  const loaded = controller.loadProgram(program, 'part.nc'); controller.arm();
  await assert.rejects(controller.runProgram('wrong'), /fingerprint/);
  const run = controller.runProgram(loaded.sha256);
  for (let i = 0; i < 100 && controller.job.state !== 'paused'; i++) await delay(5);
  assert.equal(controller.job.state, 'paused');
  assert.equal(port.writes.includes('S5000 M3'), false);
  port.send(port.status()); controller.resume(); await run;
  assert.equal(controller.job.state, 'complete');
  assert.equal(controller.job.acknowledged, controller.job.total);
  await assert.rejects(controller.runProgram(loaded.sha256), /Reload/);
});

test('preflight explicitly requests complete status before trusting periodic homing and accessories', async t => {
  const port = new WireController(); port.omitPeriodicFields = true;
  const controller = new NativeController({ profile, portFactory: async () => port, motionQualified: true, ackTimeout: 120 });
  t.after(() => controller.disconnect());
  await controller.connect('COM7');
  assert.ok(port.writes.some(bytes => Array.isArray(bytes) && bytes[0] === REALTIME.statusAll));
  assert.equal(controller.status.homing.complete, true);
  assert.equal(controller.status.homing.mask, 7);
  assert.equal(controller.status.activeProbe, 0);
  assert.equal(controller.status.accessories.spindle, 'off');
  controller.arm();
  // Normal firmware reports omit unchanged H/A/P, and omit Pn when clear.
  port.send('<Idle|MPos:-100,-100,-20|FS:0,0|AR>\r\n');
  assert.equal(controller.armed, true);
  assert.equal(controller.status.homing.complete, true);
  assert.equal(controller.status.pins.active, false);
  await controller.jog({ axis: 'x', distance: 0.1, feed: 50 });
});

test('malformed native status cannot refresh motion authority or permit spindle commands', async t => {
  const invalid = [
    '<Idle>', '<Idle|MPos:-100,-100,-20|FS:0|H:1,7>',
    '<Idle|MPos:-100,-100,NaN|FS:0,0|H:1,7>',
    '<Idle|MPos:-100,-100,-20|FS:0,0|H:1,3>',
    '<Idle|WPos:-100,-100,-20|WCO:0,0,0|FS:0,0|H:1,7>',
  ];
  for (const raw of invalid) {
    const { controller, port } = await setup(t);
    controller.arm(); port.send(`${raw}\r\n`);
    assert.equal(controller.armed, false, raw);
    assert.equal(controller.preflight, null, raw);
    assert.equal(controller.status, null, raw);
    assert.match(controller.fault, /incomplete or inconsistent/);
    assert.ok(port.writes.some(bytes => Array.isArray(bytes) && bytes[0] === REALTIME.reset));
    await assert.rejects(controller.outputs({ spindle: 'cw', rpm: 1000 }), /Fresh|Arm/);
    assert.equal(port.writes.includes('M3 S1000'), false);
  }
});

test('initial query errors or alarms never cause an implicit controller reset', async t => {
  for (const report of ['error:3', 'ALARM:11']) {
    const port = new WireController();
    const write = port.write.bind(port);
    port.write = (data, cb) => {
      if (typeof data === 'string' && data.trim() === '$I+') {
        port.writes.push('$I+'); cb?.(); queueMicrotask(() => port.send(`${report}\r\n`));
      } else write(data, cb);
    };
    const controller = new NativeController({ profile, portFactory: async () => port, ackTimeout: 120 });
    t.after(() => controller.disconnect());
    await assert.rejects(controller.connect('COM7'), /error 3|alarm 11/);
    assert.equal(controller.connected, false);
    assert.ok(!port.writes.some(bytes => Array.isArray(bytes) && [REALTIME.hold, REALTIME.reset, REALTIME.resume].includes(bytes[0])));
  }
});

test('an incomplete full-status response fails the read-only connection without resetting the board', async t => {
  const port = new WireController();
  port.status = () => '<Idle|MPos:-100,-100,-20|WCO:0,0,0|FS:0,0|A:|P:0>\r\n';
  const controller = new NativeController({ profile, portFactory: async () => port, ackTimeout: 120 });
  t.after(() => controller.disconnect());
  await assert.rejects(controller.connect('COM7'), /incomplete or inconsistent/);
  assert.equal(controller.armed, false);
  assert.ok(!port.writes.some(bytes => Array.isArray(bytes) && bytes[0] === REALTIME.reset));
});

test('observed setting or startup-block drift invalidates the verified configuration', async t => {
  for (const report of ['$13=1', '$10=0', '$N0=M3 S5000']) {
    const { controller, port } = await setup(t);
    controller.arm(); port.send('$13=0\r\n$N0=\r\n');
    assert.equal(controller.armed, true);
    port.send(`${report}\r\n`);
    assert.equal(controller.armed, false);
    assert.equal(controller.preflight, null);
    assert.match(controller.fault, /configuration changed/);
    assert.ok(port.writes.some(bytes => Array.isArray(bytes) && bytes[0] === REALTIME.reset));
  }
});

test('arming and program start reject already-active spindle or coolant outputs', async t => {
  const { controller, port } = await setup(t);
  const active = '<Idle|MPos:-100,-100,-20|FS:0,4000|H:1,7|A:SF>\r\n';
  port.send(active);
  assert.throws(() => controller.arm(), /Stop spindle and coolant/);
  assert.equal(controller.armed, false);
  port.send(port.status()); controller.arm();
  const loaded = controller.loadProgram(program);
  port.send(active);
  await assert.rejects(controller.runProgram(loaded.sha256), /Stop spindle and coolant/);
  assert.equal(controller.job.sent, 0);
  assert.equal(port.writes.includes('G53 G0 Z-2'), false);
  // The retained modal S value is not live spindle output: report.c emits
  // FS's second value as zero whenever the spindle state is off after M5.
  port.send('[GC:G0 G54 G17 G21 G90 G94 M5 M9 T1 F100 S5000]\r\n');
  port.send(port.status());
  assert.doesNotThrow(() => controller.programReady(loaded.sha256));
});

test('single-axis homes retain the partial Alarm mask and wait beyond ok before eventual full home', async t => {
  const { controller, port } = await setup(t);
  port.state = 'Alarm:22'; port.homed = false; port.homedMask = 0;
  port.send(port.status()); controller.arm();
  port.deferHomeReport = true;
  const reports = [];
  controller.on('telemetry', status => { if (status) reports.push({ state: status.state.name, mask: status.homing.mask }); });
  for (const [axis, command, expectedMask, expectedState] of [
    ['z', '$HZ', 4, 'Alarm'], ['x', '$HX', 5, 'Alarm'], ['all', '$H', 7, 'Idle'],
  ]) {
    let completed = false;
    const operation = controller.home({ axis }).then(() => { completed = true; });
    for (let i = 0; i < 100 && !port.awaitingHomeReport; i++) await delay(5);
    assert.equal(port.awaitingHomeReport, true);
    assert.equal(port.writes.includes(command), true);
    assert.equal(controller.pending, null, 'ok has arrived');
    assert.equal(controller.status.state.name, 'Home');
    assert.equal(controller.armed, true);
    assert.equal(completed, false, 'ok must not be mistaken for a fresh final homing report');
    port.awaitingHomeReport = false; port.send(port.status());
    await operation;
    assert.equal(controller.status.state.name, expectedState);
    assert.equal(controller.status.homing.mask, expectedMask);
    assert.equal(controller.status.homing.complete, expectedMask === 7);
    assert.equal(controller.armed, true);
    assert.equal(controller.fault, null);
    assert.equal(controller.awaitingHome, expectedMask !== 7);
    if (expectedMask !== 7) await assert.rejects(controller.jog({ axis: 'x', distance: 0.1, feed: 50 }), /idle|Home/);
  }
  assert.ok(reports.some(value => value.state === 'Home' && value.mask === 0));
  assert.ok(reports.some(value => value.state === 'Alarm' && value.mask === 4));
  assert.ok(reports.some(value => value.state === 'Alarm' && value.mask === 5));
  assert.ok(reports.some(value => value.state === 'Idle' && value.mask === 7));
  assert.equal(port.writes.includes('$X'), false);
});

test('inch report units and nonempty startup blocks cannot pass native preflight', async t => {
  const { controller, port } = await setup(t);
  await controller.disconnect(); port.settingOverrides = { 13: 1 };
  await controller.connect('COM7'); assert.equal(controller.preflight.preflightPassed, false);
  assert.throws(() => controller.arm(), /preflight/);
  await controller.disconnect(); port.settingOverrides = { 13: 0 }; port.startupBlock = 'M3 S5000';
  await controller.connect('COM7'); assert.equal(controller.preflight.preflightPassed, false);
  assert.ok(controller.preflight.issues.some(i => i.code === 'STARTUP_BLOCKS'));
  assert.throws(() => controller.arm(), /preflight/);
  assert.equal(port.writes.some(s => typeof s === 'string' && s.startsWith('$N0=')), false);
});

test('disconnect during asynchronous port discovery cannot resurrect a connection', async t => {
  let release;
  const port = new WireController();
  const controller = new NativeController({ profile, portFactory: () => new Promise(resolve => { release = resolve; }) });
  t.after(() => controller.disconnect());
  const connect = controller.connect('COM7');
  const rejected = assert.rejects(connect, /cancelled/);
  await controller.disconnect(); release(port); await rejected;
  assert.equal(port.isOpen, false); assert.equal(controller.connected, false); assert.deepEqual(port.writes, []);
});

test('loss of command authority resets outputs instead of leaving a resumable hold', async t => {
  const { controller, port } = await setup(t);
  controller.arm(); await controller.outputs({ spindle: 'cw', rpm: 3000, coolant: 'flood' });
  controller.disarm();
  assert.ok(port.writes.some(bytes => Array.isArray(bytes) && bytes[0] === REALTIME.reset));
  assert.equal(controller.armed, false); assert.equal(controller.preflight, null);
  assert.throws(() => controller.resume(), /required|Arm|hold|Fresh/);
});

test('firmware can defer M0 acknowledgement until an operator resumes a long pause', async t => {
  const { controller, port } = await setup(t);
  port.deferPauseAck = true;
  const loaded = controller.loadProgram(program); controller.arm();
  const run = controller.runProgram(loaded.sha256);
  for (let i = 0; i < 100 && !port.pauseAckPending; i++) await delay(5);
  await delay(300);
  assert.equal(controller.fault, null);
  assert.equal(controller.job.state, 'paused');
  assert.equal(controller.job.acknowledged, controller.job.sent - 1);
  assert.equal(port.writes.includes('S5000 M3'), false);
  controller.resume(); await run;
  assert.equal(controller.job.state, 'complete');
  assert.equal(port.writes.filter(x => x === 'M0').length, 1);
});

test('a full moving planner may delay ok; a lost acknowledgement at Idle fails without replay', async t => {
  const { controller, port } = await setup(t);
  controller.arm(); port.state = 'Run'; port.send(port.status()); port.ignore = 'G1 X1 F100';
  const line = controller.line(port.ignore, 120, { plannerWait: true });
  await delay(300);
  assert.equal(controller.fault, null);
  port.send('ok\r\n'); await line;
  const missing = controller.line(port.ignore, 120, { plannerWait: true });
  const rejected = assert.rejects(missing, /acknowledgement timed out/);
  port.state = 'Idle'; port.send(port.status()); await rejected;
  assert.equal(port.writes.filter(x => x === 'G1 X1 F100').length, 2);
  assert.equal(controller.armed, false);
});

test('status loss still aborts a program waiting on its planner', async t => {
  const { controller, port } = await setup(t, { staleMs: 80 });
  controller.arm(); port.state = 'Run'; port.send(port.status()); port.ignore = 'G1 X1 F100';
  const line = controller.line(port.ignore, 120, { plannerWait: true });
  const rejected = assert.rejects(line, /timed out/);
  port.silent = true; await rejected;
  assert.equal(controller.armed, false);
});

test('explicit dwells receive their declared time even when firmware reports Idle', async t => {
  const { controller, port } = await setup(t);
  const loaded = controller.loadProgram(program.replace('M0\n', 'M0\nG4 P0.3\n')); controller.arm();
  port.ignore = 'G4 P0.3';
  const run = controller.runProgram(loaded.sha256);
  for (let i = 0; i < 100 && controller.status.state.name !== 'Hold'; i++) await delay(5);
  controller.resume();
  for (let i = 0; i < 100 && !port.writes.includes(port.ignore); i++) await delay(5);
  await delay(250); assert.equal(controller.fault, null);
  port.send('ok\r\n'); await run;
  assert.equal(controller.job.state, 'complete');
  assert.throws(() => controller.loadProgram(program.replace('M0\n', 'M0\nG4 P3601\n')), /Dwell/);
});

test('a dwell retains its time budget after waiting for preceding motion to drain', async t => {
  const { controller, port } = await setup(t);
  controller.arm(); port.state = 'Run'; port.send(port.status()); port.ignore = 'G4 P0.3';
  const dwell = controller.line(port.ignore, 420, { plannerWait: true });
  await delay(250); port.state = 'Idle'; port.send(port.status());
  await delay(250); assert.equal(controller.fault, null);
  port.send('ok\r\n'); await dwell;
});
test('disconnect aborts pending motion and does not reconnect automatically', async t => {
  const { controller, port } = await setup(t);
  controller.arm(); port.ignore = '$H';
  const home = controller.home(); await delay(1); await controller.disconnect();
  await assert.rejects(home, /Disconnected/);
  assert.equal(controller.connected, false); assert.equal(controller.armed, false);
});

test('cancelling a jog invalidates late acknowledgements and requires reconnect', async t => {
  const { controller, port } = await setup(t);
  controller.arm(); port.ignore = '$J=G21 G91 X1 F50';
  const move = controller.jog({ axis: 'x', distance: 1, feed: 50 });
  await delay(1); controller.cancelJog(); await assert.rejects(move, /cancelled/);
  port.send('ok\r\n');
  assert.equal(controller.armed, false); assert.equal(controller.preflight, null);
  await assert.rejects(controller.jog({ axis: 'x', distance: 1, feed: 50 }), /Arm|safety/);
  assert.equal(port.writes.filter(x => x === '$J=G21 G91 X1 F50').length, 1);
});
test('stale reports and an open door stop an armed session', async t => {
  const { controller, port } = await setup(t, { staleMs: 80 });
  controller.arm(); port.silent = true; await delay(180);
  assert.equal(controller.armed, false); assert.match(controller.fault, /status timed out/);
  await controller.disconnect(); port.silent = false; port.state = 'Idle'; await controller.connect('COM7');
  controller.arm(); port.state = 'Door:0'; port.send(port.status());
  assert.equal(controller.armed, false);
});
test('durability failure and cancellation during persistence do not send the command', async t => {
  const { controller, port } = await setup(t);
  controller.arm(); controller.beforeWrite = async () => { throw new Error('disk failure'); };
  await assert.rejects(controller.jog({ axis: 'x', distance: 1, feed: 50 }), /disk failure/);
  assert.equal(port.writes.some(x => typeof x === 'string' && x.startsWith('$J=')), false);
});
test('homing can clear the initial unhomed alarm without an unlock command', async t => {
  const { controller, port } = await setup(t);
  port.state = 'Alarm'; port.homed = false; port.send(port.status()); controller.arm();
  port.send(port.status()); assert.equal(controller.armed, true);
  await controller.home(); assert.equal(controller.status.homing.complete, true);
  assert.equal(port.writes.includes('$X'), false);
});
test('compact M00 pauses transmission before spindle restart', async t => {
  const { controller, port } = await setup(t);
  const loaded = controller.loadProgram(program.replace('M0\n', 'N7M00\n')); controller.arm();
  const run = controller.runProgram(loaded.sha256);
  for (let i = 0; i < 100 && controller.job.state !== 'paused'; i++) await delay(5);
  assert.equal(controller.job.state, 'paused'); assert.equal(port.writes.includes('S5000 M3'), false);
  port.send(port.status()); controller.resume(); await run;
});
test('two-touch probe selects the input, checks both hits, retracts and restores modes', async t => {
  const { controller, port } = await setup(t, { port: new DirectActionPort() });
  port.probeHits = [
    { success: true, position: [-100, -100, -21] },
    { success: true, position: [-100, -100, -21.004] },
  ];
  controller.arm();
  const result = await controller.probeContact({ confirmedSpindleStopped: true, axis: 'z', distance: -3, sensor: 1 });
  assert.ok(port.writes.includes('G65 P5 Q1'));
  assert.ok(port.writes.includes('M70')); assert.ok(port.writes.includes('M72 G0')); assert.ok(port.writes.includes('M71'));
  assert.ok(Math.abs(result.repeatabilityMm - 0.004) < 1e-9);
  assert.equal(result.workOffsetApplied, false);
  assert.ok(Math.abs(port.position[2] + 20.004) < 1e-9);
  assert.equal(port.writes.some(s => typeof s === 'string' && s.startsWith('G10')), false);
});
test('probe miss stops without applying offsets or issuing blind recovery moves', async t => {
  const { controller, port } = await setup(t, { port: new DirectActionPort() });
  port.probeHits = [{ success: false, position: [-100, -100, -23] }]; controller.arm();
  await assert.rejects(controller.probeContact({ confirmedSpindleStopped: true, axis: 'z', distance: -3 }), /successful probe/);
  assert.equal(controller.armed, false); assert.equal(controller.lastProbeResult, null);
  assert.equal(port.writes.some(s => typeof s === 'string' && /G94 G1 /.test(s)), false);
});

test('disconnect owns a delayed close until it completes and concurrent calls share cleanup', async t => {
  class DelayedClosePort extends WireController {
    close(cb) { this.closeCalls = (this.closeCalls ?? 0) + 1; this.finishClose = () => super.close(cb); }
  }
  const first = new DelayedClosePort(), second = new WireController();
  let attempts = 0;
  const controller = new NativeController({ profile, portFactory: async () => attempts++ ? second : first, ackTimeout: 120 });
  t.after(() => controller.disconnect());
  await controller.connect('COM7');
  const disconnect = controller.disconnect();
  const duplicate = controller.disconnect();
  try {
    await assert.rejects(controller.connect('COM7'), /Disconnect|disconnect|active/);
    assert.equal(attempts, 1, 'no replacement port is acquired before prior close finishes');
  } finally { first.finishClose(); await Promise.all([disconnect, duplicate]); }
  assert.equal(first.closeCalls, 1);
  await controller.connect('COM7');
  assert.equal(controller.preflight.preflightPassed, true);
  assert.ok(controller.status);
});

test('a cancelled delayed open is closed without issuing handshake queries', async t => {
  class DelayedOpenPort extends WireController {
    open(cb) { this.finishOpen = () => super.open(cb); }
  }
  const port = new DelayedOpenPort();
  const controller = new NativeController({ profile, portFactory: async () => port, ackTimeout: 120 });
  t.after(() => controller.disconnect());
  const connection = controller.connect('COM7');
  const rejected = assert.rejects(connection, /cancelled/);
  for (let i = 0; i < 100 && !port.finishOpen; i++) await delay(1);
  assert.equal(controller.snapshot().connecting, true);
  await controller.disconnect(); port.finishOpen(); await rejected;
  assert.equal(port.isOpen, false);
  assert.equal(controller.connected, false);
  assert.equal(controller.snapshot().connecting, false);
  assert.equal(port.listenerCount('data'), 0);
  assert.deepEqual(port.writes, []);
});

test('late persistence failure from a cancelled command cannot fault a replacement connection', async t => {
  const { controller, port: first } = await setup(t);
  let rejectWrite;
  controller.beforeWrite = () => new Promise((resolve, reject) => { rejectWrite = reject; });
  const command = controller.line('$#');
  const rejected = assert.rejects(command, /Disconnected/);
  await delay(0); await controller.disconnect(); await rejected;
  const second = new WireController();
  controller.portFactory = async () => second; controller.beforeWrite = async () => {};
  await controller.connect('COM7');
  const generation = controller.generation;
  rejectWrite(new Error('late disk failure')); await delay(0);
  assert.equal(controller.generation, generation);
  assert.equal(controller.fault, null);
  assert.equal(controller.preflight.preflightPassed, true);
  assert.equal(first.writes.filter(line => line === '$#').length, 1, 'only the original preflight query reached the old port');
});

test('late transport callbacks cannot fault a replacement connection', async t => {
  class DelayedCallbackPort extends WireController {
    write(data, cb) {
      if (this.captureCallbacks) {
        this.callbacks.push(cb);
        super.write(data, () => {});
      } else super.write(data, cb);
    }
  }
  const first = new DelayedCallbackPort();
  first.callbacks = [];
  const controller = new NativeController({ profile, portFactory: async () => first, ackTimeout: 120 });
  t.after(() => controller.disconnect());
  await controller.connect('COM7'); first.captureCallbacks = true;
  await controller.line('$#'); controller.realtime(REALTIME.status);
  await controller.disconnect();
  const second = new WireController(); controller.portFactory = async () => second;
  await controller.connect('COM7');
  const generation = controller.generation;
  for (const callback of first.callbacks) callback?.(new Error('late transport failure'));
  assert.equal(controller.generation, generation);
  assert.equal(controller.fault, null);
  assert.equal(controller.preflight.preflightPassed, true);
});

test('stop during the command event prevents that command and latches cancellation', async t => {
  const { controller, port } = await setup(t);
  controller.arm();
  controller.once('command', () => controller.stop());
  await assert.rejects(controller.outputs({ spindle: 'cw', rpm: 3000, coolant: 'flood' }), /Stopped/);
  assert.equal(port.writes.includes('M3 S3000'), false);
  assert.equal(port.writes.includes('M8'), false);
  await assert.rejects(controller.line('M8'), /Stopped|reconnect/);
});

test('a reset between query acknowledgements cannot resume or accept that preflight', async t => {
  const { controller, port } = await setup(t);
  const writesBefore = port.writes.length;
  const stopAfterAck = event => {
    if (event?.type === 'ok') { controller.off('controller', stopAfterAck); controller.stop(); }
  };
  controller.on('controller', stopAfterAck);
  await assert.rejects(controller.preflightRead(), /Stopped|cancelled/);
  assert.deepEqual(port.writes.slice(writesBefore).filter(line => typeof line === 'string'), ['$I+']);
  assert.equal(controller.preflight, null);
  assert.equal(controller.readingPreflight, false);
});

test('failed port close retains ownership until a later close succeeds', async t => {
  class FailedClosePort extends WireController {
    close(cb) { if (this.failClose) cb(new Error('close denied')); else super.close(cb); }
  }
  const port = new FailedClosePort();
  const controller = new NativeController({ profile, portFactory: async () => port, ackTimeout: 120 });
  t.after(() => { port.failClose = false; return controller.disconnect(); });
  await controller.connect('COM7'); port.failClose = true;
  await assert.rejects(controller.disconnect(), /close denied/);
  assert.equal(controller.connected, false);
  assert.equal(controller.port, port);
  assert.equal(port.isOpen, true);
  await assert.rejects(controller.connect('COM8'), /Disconnect/);
  await assert.rejects(controller.line('M8'), /could not close/);
  port.failClose = false; await controller.disconnect();
  assert.equal(controller.port, null);
  assert.equal(port.isOpen, false);
  assert.equal(port.listenerCount('data'), 0);
});

test('beforeSend rechecks authority after persistence and after command event callbacks', async t => {
  for (const phase of ['persistence', 'command event']) {
    const { controller, port } = await setup(t);
    let permitted = true, release;
    const beforeSend = () => { if (!permitted) throw new Error('Authority revoked.'); };
    if (phase === 'persistence') controller.beforeWrite = () => new Promise(resolve => { release = resolve; });
    else controller.once('command', () => { permitted = false; });
    const command = controller.line('M8', 120, { beforeSend });
    const rejected = assert.rejects(command, /Authority revoked/);
    if (phase === 'persistence') { await delay(0); permitted = false; release(); }
    await rejected;
    assert.equal(port.writes.includes('M8'), false, phase);
    assert.equal(controller.pending, null);
  }
});

test('concurrent preflight rejection does not clear the first read ownership', async t => {
  const { controller, port } = await setup(t);
  port.ignore = '$G';
  const reading = controller.preflightRead();
  for (let i = 0; i < 100 && (!controller.pending?.written || port.writes.at(-1) !== '$G'); i++) await delay(1);
  assert.equal(port.writes.at(-1), '$G');
  await assert.rejects(controller.preflightRead(), /preflight is already active/);
  assert.equal(controller.readingPreflight, true);
  port.send('[GC:G0 G54 G17 G21 G90 G94 M5 M9 T1 F100 S0]\r\nok\r\n');
  await reading;
  assert.equal(controller.readingPreflight, false);
  assert.equal(controller.preflight.preflightPassed, true);
});

test('a silent open callback reports a timeout without unlocking or resetting the unverified port', async t => {
  class DelayedOpenPort extends WireController {
    open(cb) { this.finishOpen = () => super.open(cb); }
  }
  const port = new DelayedOpenPort();
  const controller = new NativeController({ profile, portFactory: async () => port, portTimeout: 25, ackTimeout: 120 });
  t.after(() => controller.disconnect());
  const connection = controller.connect('COM7');
  const rejected = assert.rejects(connection, /cancelled/);
  try {
    await delay(60);
    assert.match(controller.fault, /port open timed out/);
    assert.equal(controller.snapshot().connecting, true);
    assert.equal(controller.busy, true);
    await assert.rejects(controller.connect('COM8'), /Disconnect/);
    assert.deepEqual(port.writes, [], 'an unverified open failure never sends reset or queries');
  } finally { port.finishOpen(); await rejected; }
  assert.equal(port.isOpen, false);
  assert.equal(controller.connecting, false);
  assert.equal(controller.busy, false);
});

test('a silent close callback reports a timeout and retains the close lock until confirmed', async t => {
  class DelayedClosePort extends WireController {
    close(cb) { this.finishClose = () => super.close(cb); }
  }
  const port = new DelayedClosePort();
  const controller = new NativeController({ profile, portFactory: async () => port, portTimeout: 25, ackTimeout: 120 });
  t.after(() => controller.disconnect());
  await controller.connect('COM7');
  const disconnect = controller.disconnect();
  try {
    await delay(60);
    assert.match(controller.fault, /port close timed out/);
    assert.equal(controller.snapshot().disconnecting, true);
    assert.equal(port.isOpen, true);
    await assert.rejects(controller.connect('COM8'), /Disconnect/);
  } finally { port.finishClose(); await disconnect; }
  assert.equal(port.isOpen, false);
  assert.equal(controller.disconnecting, false);
  assert.match(controller.fault, /close completed after a timeout/);
  assert.equal(port.writes.some(bytes => Array.isArray(bytes) && bytes[0] === REALTIME.reset), false);
});

test('direct probe cannot use stale, missing, incomplete or duplicate modal replies', async t => {
  for (const kind of ['missing', 'incomplete', 'duplicate']) {
    const { controller, port } = await setup(t, { port: new DirectActionPort() });
    port.probeHits = [{ success: true, position: [-100, -100, -21] }, { success: true, position: [-100, -100, -21.004] }];
    port.modalReports = () => kind === 'missing' ? [] : kind === 'incomplete'
      ? ['[GC:G0 G21 G90 G94 F100]'] : [`[GC:${port.modal}]`, `[GC:${port.modal}]`];
    controller.beforeWrite = async event => { if (event.command === '$G') port.send(`[GC:${port.modal}]\r\n`); };
    controller.arm();
    await assert.rejects(controller.probeContact({ axis: 'z', distance: -3, confirmedSpindleStopped: true }), /modal|parser/i);
    assert.equal(port.writes.includes('M70'), false, kind);
    assert.equal(controller.lastProbeResult, null);
  }
});

test('direct probe discards a contact report received before its search is transmitted', async t => {
  const { controller, port } = await setup(t, { port: new DirectActionPort() });
  port.dropProbeReports = true;
  port.probeHits = [{ success: true, position: [-100, -100, -21] }, { success: true, position: [-100, -100, -21.004] }];
  controller.beforeWrite = async event => {
    if (event.command.includes('G38.2')) port.emit('data', Buffer.from('[PRB:-100,-100,-21:1]\r\n'));
  };
  controller.arm();
  await assert.rejects(controller.probeContact({ axis: 'z', distance: -3, confirmedSpindleStopped: true }), /successful probe|fresh probe/i);
  assert.equal(port.writes.some(line => typeof line === 'string' && /G94 G1 /.test(line)), false);
  assert.equal(controller.lastProbeResult, null);
});

test('direct jog rechecks machine position immediately before transmission', async t => {
  const { controller, port } = await setup(t);
  controller.arm();
  controller.beforeWrite = async event => { if (event.command.startsWith('$J=')) { port.position[0] = -0.1; port.send(port.status()); } };
  await assert.rejects(controller.jog({ axis: 'x', distance: 1, feed: 50 }), /position changed|travel/i);
  assert.equal(port.writes.some(line => typeof line === 'string' && line.startsWith('$J=')), false);
});

test('direct home and output commands recheck Idle and inputs after persistence', async t => {
  for (const action of ['home', 'outputs']) {
    const { controller, port } = await setup(t);
    controller.arm();
    const command = action === 'home' ? '$H' : 'M3 S3000';
    controller.beforeWrite = async event => {
      if (event.command === command) { if (action === 'home') port.state = 'Run'; else port.pins = 'H'; port.send(port.status()); }
    };
    await assert.rejects(action === 'home' ? controller.home() : controller.outputs({ spindle: 'cw', rpm: 3000 }), /idle|state|safety input/i);
    assert.equal(port.writes.includes(command), false);
  }
});

test('direct zero verifies current G92 and TLO in fresh parameter readback', async t => {
  const { controller, port } = await setup(t, { port: new DirectActionPort() });
  port.g92 = [1, 2, 3]; port.tlo = [4, 5, 6]; port.offsets.G55 = [7, 8, 9];
  controller.arm(); await controller.zero({ axis: 'z', wcs: 'G55' });
  assert.deepEqual(port.offsets.G55, [7, 8, -29]);
  assert.ok(port.writes.filter(line => line === '$#').length >= 3, 'fresh parameter queries before and after the zero write');
});

test('direct zero rejects missing parameter replies before changing the offset', async t => {
  const { controller, port } = await setup(t, { port: new DirectActionPort() });
  port.parameterReports = () => [];
  controller.arm();
  await assert.rejects(controller.zero({ axis: 'x' }), /parameter|offset|readback/i);
  assert.equal(port.writes.some(line => typeof line === 'string' && line.startsWith('G10')), false);
});

test('direct zero rejects stale post-write parameter replies and persistence-time position drift', async t => {
  for (const kind of ['missing readback', 'position drift']) {
    const { controller, port } = await setup(t, { port: new DirectActionPort() });
    let zeroed = false;
    controller.beforeWrite = async event => {
      if (event.command.startsWith('G10')) {
        zeroed = true;
        if (kind === 'position drift') { port.position[0] += 0.5; port.send(port.status()); }
      }
      if (zeroed && event.command === '$#') {
        port.send('[G54:-100,0,0]\r\n[G92:0,0,0]\r\n[TLO:0,0,0]\r\n');
        port.parameterReports = () => [];
      }
    };
    controller.arm();
    await assert.rejects(controller.zero({ axis: 'x' }), /position changed|parameter|readback/i);
    if (kind === 'position drift') assert.equal(port.writes.some(line => typeof line === 'string' && line.startsWith('G10')), false);
    assert.equal(controller.armed, false);
  }
});

test('direct probe verifies restored feed and modes before accepting a measurement', async t => {
  const { controller, port } = await setup(t, { port: new DirectActionPort() });
  port.probeHits = [{ success: true, position: [-100, -100, -21] }, { success: true, position: [-100, -100, -21.004] }];
  let restored = false;
  controller.beforeWrite = async event => { if (event.command.startsWith('M72')) restored = true; };
  port.modalReports = () => [`[GC:${restored ? port.modal.replace('F100', 'F101') : port.modal}]`];
  controller.arm();
  await assert.rejects(controller.probeContact({ axis: 'z', distance: -3, confirmedSpindleStopped: true }), /restor/i);
  assert.equal(port.writes.includes('M71'), false);
  assert.equal(controller.lastProbeResult, null);
});

test('program capability is reserved once and rechecked after persistence before spindle bytes', async t => {
  const { controller, port } = await setup(t);
  controller.arm();
  const loaded = controller.loadProgram(program);
  const reservation = Object.freeze({}); let permitted = true, reserved = 0;
  controller.authorize = (action, args, options = {}) => {
    if (action !== 'run') return;
    assert.equal(args.sha256, loaded.sha256);
    if (!permitted) throw new Error('Commissioning run capability revoked');
    if (options.reserve !== false) { reserved++; return { reservation }; }
    if (reserved) assert.equal(options.reservation, reservation);
  };
  controller.beforeWrite = async ({ command }) => { if (command === 'S5000 M3') permitted = false; };
  const running = controller.runProgram(loaded.sha256);
  await controller.waitFor(() => controller.status?.state.name === 'Hold', 1000);
  controller.resume();
  await assert.rejects(running, /capability revoked/);
  assert.equal(reserved, 1);
  assert.equal(port.writes.includes('S5000 M3'), false);
  assert.equal(controller.armed, false);
});

test('program permission expiry is checked while waiting at an operator pause', async t => {
  const { controller, port } = await setup(t);
  controller.arm(); const loaded = controller.loadProgram(program);
  let permitted = true;
  controller.authorize = action => { if (action === 'run' && !permitted) throw new Error('Commissioning run expired'); };
  const running = controller.runProgram(loaded.sha256);
  await controller.waitFor(() => controller.status?.state.name === 'Hold', 1000);
  const rejected = assert.rejects(running, /expired/);
  permitted = false;
  await rejected;
  assert.equal(controller.armed, false);
  assert.equal(port.writes.includes('S5000 M3'), false);
  assert.ok(port.writes.some(bytes => Array.isArray(bytes) && bytes[0] === REALTIME.reset));
});

test('M1 follows the firmware optional-stop decision and requires no resume when skipped', async t => {
  for (const enabled of [true, false]) {
    const port = new WireController();
    const write = port.write.bind(port);
    port.write = (data, callback) => {
      if (typeof data !== 'string' || data.trim() !== 'M1') return write(data, callback);
      port.writes.push('M1'); callback?.();
      queueMicrotask(() => {
        port.optionalSeen = true;
        if (enabled) { port.state = 'Hold:0'; port.pauseAckPending = true; port.send(port.status()); }
        else port.send('ok\r\n');
      });
    };
    const { controller } = await setup(t, { port });
    controller.arm(); const loaded = controller.loadProgram(program.replace('G54', 'G54\nM1'));
    const running = controller.runProgram(loaded.sha256);
    await controller.waitFor(() => controller.status?.state.name === 'Hold', 1000);
    controller.resume();
    await controller.waitFor(() => port.optionalSeen, 1000);
    if (enabled) { assert.equal(controller.status.state.name, 'Hold'); controller.resume(); }
    await running;
    assert.equal(controller.job.state, 'complete');
    assert.equal(port.writes.filter(bytes => Array.isArray(bytes) && bytes[0] === REALTIME.resume).length, enabled ? 2 : 1);
  }
});

test('intentional feed hold during program persistence stays resumable without an automatic reset', async t => {
  const { controller, port } = await setup(t);
  controller.arm(); const loaded = controller.loadProgram(program);
  let release, entered;
  const gate = new Promise(resolve => { release = resolve; });
  const seen = new Promise(resolve => { entered = resolve; });
  controller.beforeWrite = async ({ command }) => {
    if (command === 'G90 G94') { controller.hold(); entered(); await gate; }
  };
  const running = controller.runProgram(loaded.sha256);
  await seen;
  await controller.waitFor(() => controller.status?.state.name === 'Hold', 1000);
  assert.equal(controller.armed, true);
  assert.ok(!port.writes.some(bytes => Array.isArray(bytes) && bytes[0] === REALTIME.reset));
  controller.resume(); release();
  await controller.waitFor(() => port.writes.includes('M0') && controller.status?.state.name === 'Hold', 1000);
  controller.resume();
  await running;
  assert.equal(controller.job.state, 'complete');
});
