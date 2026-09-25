import test from 'node:test';
import assert from 'node:assert/strict';
import { NativeController, REALTIME } from '../service/native-controller.mjs';
import { planNativeWorkflow, executeNativeWorkflow } from '../service/native-workflows.mjs';
import { parseLine } from '../src/vendor/gcode-parser-browser.js';
import { WireController, profile } from './fixtures/native-wire.mjs';

// Protocol-only instrument. This test fixture is never imported by the service.
class WorkflowWire extends WireController {
  constructor() {
    super();
    this.modal = { units: 21, distance: 90, feedMode: 94, motion: 0, toolOffset: 49, feed: 100 };
    this.tool = 1; this.offsets = {}; this.tlo = 0; this.guardHit = null;
  }
  status() { return super.status().replace('|Pn:', `|T:${this.tool}|Pn:`); }
  write(data, cb) {
    if (Buffer.isBuffer(data) || ['$I+', '$$', '$N'].includes(String(data).trim())) return super.write(data, cb);
    const command = String(data).trim(); this.writes.push(command); cb?.();
    queueMicrotask(() => {
      if (this.beforeCommand?.(command) === false) return;
      const words = parseLine(command).words;
      const g = words.filter(([letter]) => letter === 'G').map(([, n]) => n);
      const values = Object.fromEntries(words);
      if (command === '$G') {
        const m = this.modal;
        this.send(`[GC:G${m.motion} G54 G17 G${m.units} G${m.distance} G${m.feedMode} G${this.badTloMode ? 49 : m.toolOffset} M${this.reportSpindle ?? 5} M${this.reportCoolant ?? 9} T${this.tool} F${Math.trunc(m.feed)} S0]\r\n`);
      } else if (command === '$#') {
        for (const [wcs, value] of Object.entries(this.offsets)) this.send(`[${wcs}:${value.join(',')}]\r\n`);
        this.send(`[TLO:${this.badTloReadback ? this.tlo + 1 : this.tlo}]\r\n`);
      } else if (command === 'M70') this.savedModal = structuredClone(this.modal);
      else if (command.startsWith('M72')) this.modal = { ...structuredClone(this.savedModal), motion: this.modal.motion };
      else if (command === 'M71') this.savedModal = null;
      else if (/^G65 P5 Q[01]$/.test(command)) this.sensor = values.Q;
      else if (g.includes(10)) this.offsets[`G${53 + values.P}`] = ['X', 'Y', 'Z'].map(a => values[a] + (this.badOffsetReadback ? 1 : 0));
      else if (g.includes(43.1)) {
        // Pinned grbl/gcode.c rejects axis words under G80 even for TLO.
        if (g.some(value => [0, 1].includes(value))) { this.send('error:24\r\n'); return; }
        if (this.modal.motion === 80) { this.send('error:31\r\n'); return; }
        this.tlo = values.Z; this.modal.toolOffset = 43.1;
      }
      else if (g.includes(53)) {
        ['X', 'Y', 'Z'].forEach((a, i) => { if (Number.isFinite(values[a])) this.position[i] = values[a]; });
        this.pins = '';
      } else if (g.includes(38.2) || g.includes(38.3)) {
        const axis = ['X', 'Y', 'Z'].find(a => Number.isFinite(values[a]));
        const index = ['X', 'Y', 'Z'].indexOf(axis);
        let hit = g.includes(38.2) ? this.probeHits.shift() : this.guardHit;
        if (g.includes(38.3)) this.guardHit = null;
        if (hit) { this.position = [...hit.position]; this.pins = hit.success ? 'P' : ''; }
        else { this.position[index] += values[axis]; hit = { success: false, position: [...this.position] }; }
        if (!this.omitProbe) {
          const report = `[PRB:${hit.position.join(',')}:${hit.success ? 1 : 0}]\r\n`;
          this.send(report); if (this.duplicateProbe) this.send(report);
        }
        if (hit.success && this.contactStopShift) this.position[index] += this.contactStopShift;
      }
      for (const [field, set] of [['units', [20, 21]], ['distance', [90, 91]], ['feedMode', [93, 94, 95]], ['motion', [0, 1, 80, 38.2, 38.3]]]) {
        const value = g.find(n => set.includes(n)); if (value !== undefined) this.modal[field] = value;
      }
      if (values.F !== undefined) this.modal.feed = values.F * (this.modal.units === 20 && this.modal.feedMode !== 93 ? 25.4 : 1);
      this.send('ok\r\n');
    });
  }
}

async function setup(t) {
  let now = Date.now();
  const port = new WorkflowWire();
  const controller = new NativeController({ profile, portFactory: async () => port, motionQualified: true, ackTimeout: 200, now: () => now });
  t.after(() => controller.disconnect());
  await controller.connect('COM7'); controller.arm();
  // Older shared fixture profile omitted $13; explicitly model verified metric
  // reporting here rather than silently assuming it in production execution.
  if (!controller.preflight.settings.some(setting => setting.id === 13)) controller.preflight.settings.push({ id: 13, actual: 0, status: 'PASS' });
  return { controller, port, advance: ms => { now += ms; port.send(port.status()); } };
}
const geometry = () => ({ setupId: 'Physical setup A / fixture 2', sourceSha256: 'a'.repeat(64), reviewedAt: new Date().toISOString() });
const touch = overrides => ({ type: 'touch-probe', inputQualified: true, profileQualified: true, probeQualified: true,
  probeId: 'probe-physical-01', qualifiedTipDiameter: 6,
  settings: { cycle: 'x-edge', tipDiameter: 6, targetX: -100, targetY: -100, measurementZ: -40, safeZ: -10,
    approachClearance: 4, maxSearch: 5, retractDistance: 3, latchPullOff: 1, doubleTouch: true },
  confirmations: { spindleStopped: true, routeClear: true }, geometry: geometry(), ...overrides });
const setter = overrides => ({ type: 'tool-setter', inputQualified: true, profileQualified: true, expectedActiveTool: 1,
  settings: { x: -200, y: -200, travelZ: -10, referenceContactZ: -50, referenceGaugeLength: 50,
    currentToolNumber: 1, currentGaugeLength: 60, approachClearance: 2, maxSearch: 3, retractDistance: 5,
    latchPullOff: 1, doubleTouch: true }, confirmations: { spindleStopped: true, routeClear: true }, geometry: geometry(), ...overrides });
const offset = overrides => ({ type: 'apply-work-offset', wcs: 'G54', fixtureId: 'V1', offset: { x: -100, y: -200, z: -50 },
  mapVersion: 1, frameQualified: true, locationsVerified: true,
  confirmations: { spindleStopped: true, offsetWrite: true }, geometry: geometry(), ...overrides });
const strings = port => port.writes.filter(x => typeof x === 'string');
const perform = (controller, request) => executeNativeWorkflow(controller, planNativeWorkflow(controller, request));
const hit = position => ({ success: true, position });

test('planning is read-only and requires real setup evidence and all explicit qualifications', async t => {
  const { controller, port } = await setup(t);
  const before = port.writes.length;
  for (const candidate of [touch({ geometry: {} }), touch({ confirmations: { spindleStopped: true } }),
    touch({ inputQualified: false }), touch({ qualifiedTipDiameter: 3 }), touch({ probeId: null }),
    touch({ settings: { ...touch().settings, doubleTouch: false } })]) {
    assert.throws(() => planNativeWorkflow(controller, candidate));
  }
  const plan = planNativeWorkflow(controller, touch());
  assert.equal(port.writes.length, before);
  assert.equal(plan.steps[0].kind, 'raise-z');
  assert.equal(plan.steps[1].kind, 'clearance-xy');
  assert.equal(plan.steps[2].kind, 'guarded-approach');
  assert.ok(plan.planSha256.match(/^[a-f0-9]{64}$/));
});

test('review expires and binds controller generation, tool and start position with no motion', async t => {
  const { controller, port, advance } = await setup(t);
  let plan = planNativeWorkflow(controller, touch());
  advance(60001);
  await assert.rejects(executeNativeWorkflow(controller, plan), /expired/);
  plan = planNativeWorkflow(controller, touch()); port.position[0] += 1; port.send(port.status());
  await assert.rejects(executeNativeWorkflow(controller, plan), /position/);
  plan = planNativeWorkflow(controller, touch()); controller.generation++;
  await assert.rejects(executeNativeWorkflow(controller, plan), /identity/);
  plan = planNativeWorkflow(controller, touch()); port.tool = 2; port.send(port.status());
  await assert.rejects(executeNativeWorkflow(controller, plan), /identity/);
  assert.equal(strings(port).filter(s => /G38|G53/.test(s)).length, 0);
});

test('plan is immutable, single-use and rejects altered fingerprints', async t => {
  const { controller, port } = await setup(t);
  const plan = planNativeWorkflow(controller, offset());
  plan.intent.offset.x = -400;
  await assert.rejects(executeNativeWorkflow(controller, { ...plan, planSha256: 'b'.repeat(64) }), /does not match/);
  const result = await executeNativeWorkflow(controller, plan);
  assert.equal(result.offset.x, -100);
  assert.ok(strings(port).includes('G10 L2 P1 X-100 Y-200 Z-50'));
  await assert.rejects(executeNativeWorkflow(controller, plan), /does not match/);
});

test('touch cycle raises Z before XY, guards approach, double touches and restores modal state', async t => {
  const { controller, port } = await setup(t);
  port.modal.units = 20; port.modal.distance = 91; port.modal.feed = 4.789;
  port.probeHits = [hit([-103, -100, -40]), hit([-103.01, -100, -40])];
  const result = await perform(controller, touch());
  const commands = strings(port);
  assert.ok(commands.indexOf('G21 G90 G94 G53 G1 Z-10 F100') < commands.indexOf('G21 G90 G94 G53 G1 X-107 F250'));
  assert.ok(commands.includes('G21 G91 G94 G38.3 Z-30 F100'));
  assert.equal(commands.filter(s => s.includes('G38.2')).length, 2);
  assert.equal(result.feature.coordinate, -100.01);
  assert.equal(result.workOffsetApplied, false);
  assert.equal(port.position[2], -10);
  assert.deepEqual(port.modal, { units: 20, distance: 91, feedMode: 94, motion: 0, toolOffset: 49, feed: 4.789 });
});

test('an unexpected guarded-approach contact stops without a recovery move', async t => {
  const { controller, port } = await setup(t);
  port.guardHit = hit([-107, -100, -30]);
  await assert.rejects(perform(controller, touch()), /Unexpected contact/);
  const commands = strings(port);
  assert.equal(commands.at(-1), 'G21 G91 G94 G38.3 Z-30 F100');
  assert.equal(controller.armed, false);
  assert.ok(port.writes.some(v => Array.isArray(v) && v[0] === REALTIME.hold));
});

test('missing or duplicate probe reports stop the workflow without further motion', async t => {
  for (const flag of ['omitProbe', 'duplicateProbe']) {
    const { controller, port } = await setup(t); port[flag] = true;
    await assert.rejects(perform(controller, touch()), /Exactly one fresh/);
    assert.equal(strings(port).at(-1), 'G21 G91 G94 G38.3 Z-30 F100');
    assert.equal(controller.armed, false);
  }
});

test('a probe report received during pre-write persistence cannot satisfy the new search', async t => {
  const { controller, port } = await setup(t);
  port.omitProbe = true;
  controller.beforeWrite = async ({ command }) => {
    if (command.includes('G38.3')) port.send('[PRB:-107,-100,-40:0]\r\n');
  };
  await assert.rejects(perform(controller, touch()), /Exactly one fresh/);
  assert.equal(strings(port).at(-1), 'G21 G91 G94 G38.3 Z-30 F100');
  assert.equal(controller.lastWorkflowResult, undefined);
});

test('a parser report received before its query is sent cannot permit workflow writes', async t => {
  const { controller, port } = await setup(t);
  controller.beforeWrite = async ({ command }) => {
    if (command === '$G') port.send('[GC:G0 G54 G17 G21 G90 G94 G49 M5 M9 T1 F100 S0]\r\n');
  };
  port.beforeCommand = command => { if (command === '$G') { port.send('ok\r\n'); return false; } };
  const before = strings(port).length;
  await assert.rejects(perform(controller, offset()), /Complete .* modal state/);
  assert.deepEqual(strings(port).slice(before), ['$G']);
});

test('a parameter report received before its query is sent cannot verify an offset write', async t => {
  const { controller, port } = await setup(t);
  controller.beforeWrite = async ({ command }) => {
    if (command === '$#') port.send('[G54:-100,-200,-50]\r\n');
  };
  port.beforeCommand = command => { if (command === '$#') { port.send('ok\r\n'); return false; } };
  await assert.rejects(perform(controller, offset()), /Exactly one fresh G54/);
  assert.equal(strings(port).at(-1), '$#');
  assert.equal(controller.armed, false);
  assert.equal(controller.lastWorkflowResult, undefined);
});

test('workflow revocation while offset persistence waits prevents the actual write', async t => {
  const { controller, port } = await setup(t);
  let permit = true;
  controller.authorize = () => { if (!permit) throw new Error('Commissioning capability revoked'); };
  controller.beforeWrite = async ({ command }) => { if (command.startsWith('G10 ')) permit = false; };
  await assert.rejects(perform(controller, offset()), /revoked/);
  assert.ok(!strings(port).some(command => command.startsWith('G10 ')));
  assert.equal(controller.armed, false);
});

test('position drift during persistence cancels the reviewed protected move before transmission', async t => {
  const { controller, port } = await setup(t);
  controller.beforeWrite = async ({ command }) => {
    if (command.includes('G53')) { port.position[0] += 1; port.send(port.status()); }
  };
  await assert.rejects(perform(controller, touch()), /position changed before/);
  assert.ok(!strings(port).some(command => command.includes('G53') || command.includes('G38')));
  assert.equal(controller.armed, false);
});

test('off-axis and implausibly early contacts are rejected before pull-off', async t => {
  for (const position of [[-103, -99, -40], [-106, -100, -40]]) {
    const { controller, port } = await setup(t); port.probeHits = [hit(position)];
    await assert.rejects(perform(controller, touch()), /commanded segment|reviewed surface/);
    assert.equal(strings(port).at(-1), 'G21 G91 G94 G38.2 X5 F25');
  }
});

test('two-touch repeatability failure causes no blind final retract', async t => {
  const { controller, port } = await setup(t);
  port.probeHits = [hit([-103, -100, -40]), hit([-103.1, -100, -40])];
  await assert.rejects(perform(controller, touch()), /repeatability/);
  assert.equal(strings(port).at(-1), 'G21 G91 G94 G38.2 X1.5 F10');
});

test('a valid contact report with inconsistent stopped position cannot trigger a blind pull-off', async t => {
  const { controller, port } = await setup(t);
  port.probeHits = [hit([-103, -100, -40])]; port.contactStopShift = 1;
  await assert.rejects(perform(controller, touch()), /Stopped machine position/);
  assert.equal(strings(port).at(-1), 'G21 G91 G94 G38.2 X5 F25');
  assert.equal(controller.armed, false);
});

test('travel bounds and a safe plane below current Z are rejected before any serial command', async t => {
  const { controller, port } = await setup(t);
  const before = strings(port).length;
  assert.throws(() => planNativeWorkflow(controller, touch({ settings: { ...touch().settings, targetX: -1 } })), /inside/);
  assert.throws(() => planNativeWorkflow(controller, touch({ settings: { ...touch().settings, safeZ: -25 } })), /above the current/);
  assert.equal(strings(port).length, before);
});

test('fixture offsets are typed, write explicit millimetres and verify fresh persistent readback', async t => {
  const { controller, port } = await setup(t);
  port.modal.units = 20;
  const result = await perform(controller, offset());
  assert.equal(result.readbackVerified, true);
  assert.deepEqual(port.offsets.G54, [-100, -200, -50]);
  assert.equal(port.modal.units, 20);
  assert.throws(() => planNativeWorkflow(controller, offset({ offset: { x: null, y: -20, z: -30 } })), /Work offset X/);
  assert.throws(() => planNativeWorkflow(controller, offset({ fixtureId: 'V2' })), /reserved/);
});

test('offset readback mismatch disarms and is never treated as applied successfully', async t => {
  const { controller, port } = await setup(t); port.badOffsetReadback = true;
  await assert.rejects(perform(controller, offset()), /readback did not match/);
  assert.equal(controller.armed, false);
  assert.equal(strings(port).at(-1), '$#');
});

test('setter reports measured length and returns primary input without automatic TLO', async t => {
  const { controller, port } = await setup(t);
  port.probeHits = [hit([-200, -200, -40]), hit([-200, -200, -40.01])];
  const result = await perform(controller, setter());
  assert.ok(Math.abs(result.measuredGaugeLength - 59.99) < 1e-9);
  assert.equal(result.toolLengthApplied, false);
  assert.equal(result.tool, 1);
  assert.equal(port.sensor, 0);
  assert.deepEqual(port.position, [-200, -200, -10]);
  assert.equal(strings(port).some(s => s.includes('G43')), false);
});

test('explicit tool-length apply uses the calibrated reference convention and verified TLO readback', async t => {
  const { controller, port } = await setup(t);
  port.probeHits = [hit([-200, -200, -40]), hit([-200, -200, -40])];
  const measured = await perform(controller, setter());
  const request = { type: 'apply-tool-length', resultId: measured.resultId, tool: 1, referenceTloMm: 12,
    confirmedReferenceTlo: true, confirmations: { spindleStopped: true, offsetWrite: true }, geometry: geometry() };
  const applied = await perform(controller, request);
  assert.equal(applied.tloMm, 22);
  assert.equal(port.tlo, 22);
  assert.equal(applied.readbackVerified, true);
  assert.throws(() => planNativeWorkflow(controller, request), /unapplied/);
});

test('setter result cannot survive a stop generation or a changed physical position', async t => {
  const { controller, port } = await setup(t);
  port.probeHits = [hit([-200, -200, -40]), hit([-200, -200, -40])];
  const measured = await perform(controller, setter());
  const request = { type: 'apply-tool-length', resultId: measured.resultId, tool: 1, referenceTloMm: 0,
    confirmedReferenceTlo: true, confirmations: { spindleStopped: true, offsetWrite: true }, geometry: geometry() };
  port.position[0] += 1; port.send(port.status());
  assert.throws(() => planNativeWorkflow(controller, request), /fresh, unapplied/);
  port.position[0] -= 1; port.send(port.status()); controller.generation++;
  assert.throws(() => planNativeWorkflow(controller, request), /fresh, unapplied/);
});

test('staged workflow authorization is enforced before every transaction and movement', async t => {
  const { controller, port } = await setup(t);
  let permit = true;
  controller.authorize = action => { assert.equal(action, 'workflow'); if (!permit) throw new Error('Commissioning capability not granted'); };
  const plan = planNativeWorkflow(controller, touch());
  port.beforeCommand = command => { if (command === 'G65 P5 Q0') permit = false; };
  await assert.rejects(executeNativeWorkflow(controller, plan), /not granted/);
  assert.equal(strings(port).some(s => s.includes('G53')), false);
  assert.equal(controller.armed, false);
});

test('workflow plans and live checks reserve no budget; execution reserves exactly once', async t => {
  const { controller } = await setup(t);
  const calls = [];
  controller.authorize = (action, args, options) => { calls.push({ action, args, ...options }); };
  const plan = planNativeWorkflow(controller, offset());
  assert.ok(calls.every(call => call.reserve === false));
  await executeNativeWorkflow(controller, plan);
  assert.equal(calls.filter(call => call.reserve === true).length, 1);
  assert.ok(calls.every(call => call.action === 'workflow' && call.args.kind === 'apply-work-offset'));
});

test('the exact internal reservation permits live checks after consuming the final workflow slot', async t => {
  const { controller } = await setup(t);
  const reservation = Object.freeze({}); let remaining = 1;
  controller.authorize = (_action, _args, options) => {
    if (options.reserve) { assert.equal(remaining--, 1); return { reservation }; }
    if (!remaining) assert.equal(options.reservation, reservation);
  };
  const result = await perform(controller, offset());
  assert.equal(result.readbackVerified, true);
  assert.equal(remaining, 0);
  assert.equal(Object.hasOwn(result, 'reservation'), false);
});

test('metric reporting and full modal state are required; G93 never changes the controller', async t => {
  const { controller, port } = await setup(t);
  controller.preflight.settings.find(s => s.id === 13).actual = 1;
  assert.throws(() => planNativeWorkflow(controller, touch()), /millimetre/);
  controller.preflight.settings.find(s => s.id === 13).actual = 0;
  port.modal.feedMode = 93;
  await assert.rejects(perform(controller, touch()), /Select G94/);
  assert.equal(strings(port).some(s => s.includes('G53') || s === 'M70'), false);
});

test('Z-surface measurement corrects the calibrated ball radius and returns to the safe plane', async t => {
  const { controller, port } = await setup(t);
  port.probeHits = [hit([-100, -100, -37]), hit([-100, -100, -37])];
  const result = await perform(controller, touch({ settings: { ...touch().settings, cycle: 'z-surface', targetZ: -40 } }));
  assert.deepEqual(result.feature, { type: 'surface', axis: 'z', coordinate: -40 });
  assert.equal(port.position[2], -10);
});

test('outside-corner probes each face with a separate Z clearance route', async t => {
  const { controller, port } = await setup(t);
  port.probeHits = [hit([-103, -90, -40]), hit([-103, -90, -40]), hit([-90, -103, -40]), hit([-90, -103, -40])];
  const result = await perform(controller, touch({ settings: { ...touch().settings, cycle: 'outside-corner', cornerSampleOffset: 10 } }));
  assert.deepEqual(result.feature, { type: 'outside-corner', x: -100, y: -100 });
  const commands = strings(port);
  const secondXY = commands.indexOf('G21 G90 G94 G53 G1 X-90 Y-107 F250');
  assert.equal(commands[secondXY - 1], 'G21 G90 G94 G53 G1 Z-10 F100');
  assert.equal(commands.filter(s => s.includes('G38.2')).length, 4);
});

test('bore center uses all four double touches and reports measured diameter without offset writes', async t => {
  const { controller, port } = await setup(t);
  port.probeHits = [[-98, -100, -40], [-102, -100, -40], [-100, -98, -40], [-100, -102, -40]].flatMap(position => [hit(position), hit(position)]);
  const result = await perform(controller, touch({ settings: { ...touch().settings, cycle: 'bore-center', featureDiameter: 10, maxSearch: 3 } }));
  assert.deepEqual(result.feature, { type: 'bore', centerX: -100, centerY: -100, diameterX: 10, diameterY: 10 });
  assert.equal(strings(port).filter(s => s.includes('G38.2')).length, 8);
  assert.equal(strings(port).some(s => s.startsWith('G10')), false);
});

test('failed tool-length readback disarms and retains no usable stale measurement', async t => {
  const { controller, port } = await setup(t);
  port.probeHits = [hit([-200, -200, -40]), hit([-200, -200, -40])];
  const measured = await perform(controller, setter());
  port.badTloReadback = true;
  await assert.rejects(perform(controller, { type: 'apply-tool-length', resultId: measured.resultId, tool: 1,
    referenceTloMm: 0, confirmedReferenceTlo: true, confirmations: { spindleStopped: true, offsetWrite: true }, geometry: geometry() }), /Tool-length readback/);
  assert.equal(controller.armed, false);
  assert.equal(strings(port).at(-1), '$#');
});

test('tool-length application must retain the measured setup evidence and confirm G43.1 mode', async t => {
  const { controller, port } = await setup(t);
  port.probeHits = [hit([-200, -200, -40]), hit([-200, -200, -40])];
  const measured = await perform(controller, setter());
  const request = { type: 'apply-tool-length', resultId: measured.resultId, tool: 1, referenceTloMm: 0,
    confirmedReferenceTlo: true, confirmations: { spindleStopped: true, offsetWrite: true }, geometry: geometry() };
  assert.throws(() => planNativeWorkflow(controller, { ...request, geometry: { ...geometry(), sourceSha256: 'b'.repeat(64) } }), /same physical setup/);
  port.badTloMode = true;
  await assert.rejects(perform(controller, request), /active dynamic tool-length/);
  assert.equal(controller.armed, false);
});

test('a setter result expiring during persistence cannot reach the tool-length write', async t => {
  const { controller, port, advance } = await setup(t);
  port.probeHits = [hit([-200, -200, -40]), hit([-200, -200, -40])];
  const measured = await perform(controller, setter());
  controller.beforeWrite = async ({ command }) => { if (command.includes('G43.1')) advance(600001); };
  await assert.rejects(perform(controller, { type: 'apply-tool-length', resultId: measured.resultId, tool: 1,
    referenceTloMm: 0, confirmedReferenceTlo: true, confirmations: { spindleStopped: true, offsetWrite: true }, geometry: geometry() }), /fresh, unapplied/);
  assert.equal(strings(port).some(command => command.includes('G43.1')), false);
  assert.equal(port.tlo, 0);
});

test('tool-length application from G80 uses a nonmoving compatible mode and restores G80', async t => {
  const { controller, port } = await setup(t);
  port.probeHits = [hit([-200, -200, -40]), hit([-200, -200, -40])];
  const measured = await perform(controller, setter());
  port.modal.motion = 80; port.modal.units = 20;
  const start = [...port.position];
  const result = await perform(controller, { type: 'apply-tool-length', resultId: measured.resultId, tool: 1,
    referenceTloMm: 12, confirmedReferenceTlo: true, confirmations: { spindleStopped: true, offsetWrite: true }, geometry: geometry() });
  assert.equal(result.tloMm, 22);
  assert.equal(result.readbackVerified, true);
  assert.equal(port.modal.motion, 80);
  assert.equal(port.modal.units, 20);
  assert.deepEqual(port.position, start);
  const commands = strings(port);
  assert.equal(commands[commands.indexOf('G43.1 Z22') - 1], 'G0');
});

test('modal snapshot requires explicit spindle and coolant off even if prior telemetry shows off', async t => {
  for (const [field, value] of [['reportSpindle', 3], ['reportCoolant', 8]]) {
    const { controller, port } = await setup(t); port[field] = value;
    const before = strings(port).length;
    await assert.rejects(perform(controller, touch()), /M5 and M9/);
    assert.deepEqual(strings(port).slice(before), ['$G']);
    assert.equal(port.savedModal, undefined);
  }
});
