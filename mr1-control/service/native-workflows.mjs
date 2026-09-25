import { createHash, randomUUID } from 'node:crypto';
import { MR1_CONFIG } from '../src/machine-config.js';
import { normalizeMachineIntent } from '../src/machine-command.js';
import { evaluateToolSetter, evaluateTouchProbe } from '../src/probing-profile.js';
import { parseLine } from '../src/vendor/gcode-parser-browser.js';

const AXES = ['x', 'y', 'z'];
const state = new WeakMap();
const PLAN_AGE_MS = 60000;
const RESULT_AGE_MS = 10 * 60000;
const POSITION_TOLERANCE = 0.01;
const fail = message => { throw new Error(message); };
const fmt = n => Number(n.toFixed(5)).toString();
const copy = value => structuredClone(value);
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const storage = controller => {
  if (!state.has(controller)) state.set(controller, { plans: new Map(), results: new Map() });
  return state.get(controller);
};
const number = (value, low, high, label) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < low || value > high) fail(`${label} must be between ${low} and ${high}.`);
  return value;
};
const point = (value, label) => Object.fromEntries(AXES.map(axis => [axis,
  number(value?.[axis], MR1_CONFIG.machineEnvelope[axis].min, MR1_CONFIG.machineEnvelope[axis].max, `${label} ${axis.toUpperCase()}`)]));
const equalPoint = (a, b) => AXES.every(axis => Number.isFinite(a?.[axis]) && Number.isFinite(b?.[axis]) && Math.abs(a[axis] - b[axis]) <= POSITION_TOLERANCE);
const parserWords = controller => parseLine(controller.parserState ?? '').words;
const activeTool = controller => controller.status?.tool ?? parserWords(controller).find(([letter]) => letter === 'T')?.[1] ?? null;
const identity = controller => ({ generation: controller.generation, port: controller.port?.path,
  preflight: controller.preflight?.transcriptSha256, tool: activeTool(controller) });
const sameIdentity = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function authorize(controller, type, { reserve = false } = {}) {
  const permit = controller.authorize?.('workflow', { kind: type }, { reserve });
  controller.ready();
  if (!controller.preflight?.preflightPassed || controller.preflight.counts?.warnings || controller.preflight.simulated
    || !/^[a-f0-9]{64}$/i.test(controller.preflight.transcriptSha256 ?? '')) fail('An exact physical-controller preflight is required.');
  const reportUnits = controller.preflight.settings?.find(setting => setting.id === 13);
  if (reportUnits?.actual !== 0 || reportUnits.status !== 'PASS') fail('Preflight must verify millimetre reporting ($13=0).');
  if (!controller.status.homing.complete || controller.status.state.name !== 'Idle') fail('Protected workflows require homed, fresh Idle.');
  return permit;
}

function stopped(controller, confirmations) {
  const status = controller.status;
  if (confirmations?.spindleStopped !== true || status.accessories.spindle !== 'off'
    || status.motion.spindleCommand !== 0 || (status.motion.spindleActual !== null && status.motion.spindleActual !== 0)) {
    fail('Confirm the physically stopped spindle before a protected workflow.');
  }
  if (status.accessories.flood || status.accessories.mist) fail('Turn coolant off before the protected workflow.');
}

function geometryEvidence(controller, geometry) {
  if (!geometry || typeof geometry.setupId !== 'string' || geometry.setupId.trim().length < 3 || geometry.setupId.length > 160
    || !/^[a-f0-9]{64}$/i.test(geometry.sourceSha256 ?? '')) fail('Supply the physical setup artifact SHA-256 and setup identifier.');
  const reviewed = Date.parse(geometry.reviewedAt);
  if (!Number.isFinite(reviewed) || reviewed > controller.now() + 1000 || controller.now() - reviewed > 24 * 60 * 60000) {
    fail('Physical setup evidence must have been reviewed within the last 24 hours.');
  }
  return { setupId: geometry.setupId.trim(), sourceSha256: geometry.sourceSha256.toLowerCase(), reviewedAt: new Date(reviewed).toISOString() };
}

function existingResult(controller, id) {
  const result = storage(controller).results.get(id);
  if (!result || result.type !== 'tool-setter' || result.applied || controller.now() - result.at > RESULT_AGE_MS
    || !sameIdentity(result.identity, identity(controller)) || !equalPoint(result.finalMachinePosition, controller.status.position.machine)) {
    fail('A fresh, unapplied setter measurement from this controller, tool and position is required.');
  }
  return result;
}

function normalizeRequest(controller, request) {
  const geometry = geometryEvidence(controller, request?.geometry);
  const confirmations = copy(request?.confirmations ?? {});
  stopped(controller, confirmations);
  let intent;
  if (request.type === 'apply-tool-length') {
    const measurement = existingResult(controller, request.resultId);
    if (measurement.geometry.setupId !== geometry.setupId || measurement.geometry.sourceSha256 !== geometry.sourceSha256) {
      fail('Tool-length application must reference the same physical setup evidence as its measurement.');
    }
    if (request.confirmedReferenceTlo !== true || confirmations.offsetWrite !== true) fail('Confirm the calibrated reference TLO and explicit tool-length write.');
    const referenceTloMm = number(request.referenceTloMm, -200, 200, 'Calibrated reference TLO');
    if (request.tool !== measurement.tool || activeTool(controller) !== measurement.tool) fail('Measured tool must match the active tool.');
    const tloMm = number(referenceTloMm + measurement.contactDeltaMm, -200, 200, 'Measured tool-length offset');
    intent = { type: request.type, resultId: request.resultId, tool: measurement.tool, referenceTloMm, tloMm };
  } else {
    // Check numbers before the UI-compatible normalizer can coerce null to zero.
    if (request.type === 'apply-work-offset') point(request.offset, 'Work offset');
    intent = normalizeMachineIntent(request);
    if (intent.type === 'jog') fail('Use the bounded native jog command.');
    if (intent.type === 'apply-work-offset') {
      if (!intent.frameQualified || !intent.locationsVerified || !intent.mapVersion || confirmations.offsetWrite !== true) {
        fail('A qualified frame, verified fixture locations, map version and explicit offset-write confirmation are required.');
      }
    } else {
      if (!intent.inputQualified || !intent.profileQualified || confirmations.routeClear !== true) fail('Qualify the physical input, profile and complete stock/clamp clearance route.');
      if (intent.settings.doubleTouch !== true) fail('Native protected probing requires two contacts.');
      if (intent.type === 'touch-probe') {
        if (!intent.probeQualified || !intent.probeId || Math.abs(intent.qualifiedTipDiameter - intent.settings.tipDiameter) > 0.001
          || !Number.isFinite(intent.qualifiedTipDiameter)) fail('The calibrated physical probe and matching tip diameter are required.');
        const evaluation = evaluateTouchProbe(intent.settings);
        if (!evaluation.ready) fail([...evaluation.errors, ...evaluation.missing].join(' '));
      } else {
        const tool = activeTool(controller);
        if (!Number.isInteger(tool) || tool < 1 || intent.expectedActiveTool !== tool || intent.settings.currentToolNumber !== tool) {
          fail('Setter profile and expected tool must match a known active tool.');
        }
        const evaluation = evaluateToolSetter(intent.settings, { activeTool: tool });
        if (!evaluation.ready) fail(evaluation.errors.join(' ') || 'Complete the calibrated setter location and tool-length model.');
      }
    }
  }
  return { intent, geometry, confirmations };
}

function buildSteps(intent, start) {
  if (intent.type === 'apply-work-offset') return [{ kind: 'write-work-offset', wcs: intent.wcs, offset: intent.offset }, { kind: 'verify-offset-readback' }];
  if (intent.type === 'apply-tool-length') return [{ kind: 'write-tool-length', tool: intent.tool, tloMm: intent.tloMm }, { kind: 'verify-tlo-readback' }];
  const settings = intent.settings;
  const safeZ = intent.type === 'touch-probe' ? settings.safeZ : settings.travelZ;
  if (safeZ < start.z - POSITION_TOLERANCE) fail('Safe travel Z must be at or above the current machine Z.');
  const contacts = intent.type === 'touch-probe' ? evaluateTouchProbe(settings).plan.contacts : (() => {
    const envelope = evaluateToolSetter(settings).envelope;
    return [{ id: 'tool-setter', axis: 'z', direction: -1,
      start: { x: settings.x, y: settings.y, z: envelope.approachZ },
      expectedCenter: { x: settings.x, y: settings.y, z: envelope.expectedContactZ },
      searchLimit: { x: settings.x, y: settings.y, z: envelope.targetZ },
      retract: { x: settings.x, y: settings.y, z: envelope.retractZ } }];
  })();
  const steps = [];
  for (const contact of contacts) {
    for (const field of ['start', 'expectedCenter', 'searchLimit', 'retract']) point(contact[field], `${contact.id} ${field}`);
    steps.push({ kind: 'raise-z', z: safeZ }, { kind: 'clearance-xy', x: contact.start.x, y: contact.start.y, z: safeZ },
      { kind: 'guarded-approach', target: contact.start, sensor: intent.type === 'tool-setter' ? 1 : 0 },
      { kind: 'two-touch', ...contact }, { kind: 'raise-z', z: safeZ });
  }
  return steps;
}

/** Read-only plan. Evidence identifies an operator-reviewed physical setup; it is
 * never generated from the virtual machine model or treated as a collision proof. */
export function planNativeWorkflow(controller, request) {
  authorize(controller, request?.type);
  if (controller.busy) fail('Another controller operation is active.');
  const normalized = normalizeRequest(controller, request);
  const start = point(controller.status.position.machine, 'Starting machine position');
  const createdAt = controller.now();
  const plan = { protocol: 'mr1-native-workflow-plan-v1', planId: randomUUID(), createdAt,
    expiresAt: new Date(createdAt + PLAN_AGE_MS).toISOString(), identity: identity(controller), start,
    intentType: normalized.intent.type, intent: normalized.intent, geometry: normalized.geometry,
    confirmations: normalized.confirmations, steps: buildSteps(normalized.intent, start) };
  plan.planSha256 = hash(plan);
  const plans = storage(controller).plans;
  plans.clear(); // One reviewed plan per controller; a new review supersedes it.
  plans.set(plan.planId, copy(plan));
  return copy(plan);
}

function commandGuard(controller, plan, options = {}, beforeSend) {
  const start = copy(controller.status.position.machine);
  return () => {
    liveGuard(controller, plan, options);
    if (!equalPoint(start, controller.status.position.machine)) fail('Machine position changed before the protected command was sent.');
    beforeSend?.();
  };
}

async function workflowLine(controller, plan, command, beforeSend) {
  await controller.line(command, undefined, { beforeSend: commandGuard(controller, plan, {}, beforeSend) });
}

async function captureModal(controller, plan) {
  await workflowLine(controller, plan, '$G', () => { controller.parserState = null; });
  const words = parserWords(controller);
  const get = codes => words.find(([letter, value]) => letter === 'G' && codes.includes(value))?.[1];
  const modal = { units: get([20, 21]), distance: get([90, 91]), feedMode: get([93, 94, 95]),
    motion: get([0, 1, 80]), toolOffset: get([43, 43.1, 43.2, 49]), feed: words.find(([letter]) => letter === 'F')?.[1] };
  if (!Object.values(modal).every(Number.isFinite)) fail('Complete G0/G1/G80 modal state is required before this workflow.');
  // M70 stores commanded accessory modes, whereas status reports physical
  // output state. M72 must never restore a latent M3/M4 or coolant command.
  const spindle = words.filter(([letter, value]) => letter === 'M' && [3, 4, 5].includes(value));
  const coolant = words.filter(([letter, value]) => letter === 'M' && [7, 8, 9].includes(value));
  if (spindle.length !== 1 || spindle[0][1] !== 5 || coolant.length !== 1 || coolant[0][1] !== 9) fail('Parser state must explicitly confirm M5 and M9 before the workflow.');
  if (modal.feedMode === 93) fail('Select G94 feed-per-minute mode before the workflow; G93 cannot preserve feed across modal snapshots.');
  if (words.some(([letter, value]) => letter === 'G' && [51, 68, 41, 42].includes(value))) fail('Cancel scaling, rotation and cutter compensation before the workflow.');
  return modal;
}

async function restoreModal(controller, plan, modal, snapshot) {
  // $G F is integer-truncated and expressed in $13 report units in this
  // firmware. Reconstructing F from it loses precision (and G20 scales it).
  // M72 restores the exact internal feed and other saved modes. It omits
  // motion mode, so restore only that explicitly, with no motion coordinates.
  // Offset-only writes change units but never feed/motion; M72 there would
  // accidentally undo the newly written dynamic TLO.
  await workflowLine(controller, plan, snapshot ? `M72 G${modal.motion}` : `G${modal.units}${modal.motion === 80 ? ' G80' : ''}`);
  const observed = await captureModal(controller, plan);
  for (const field of ['units', 'distance', 'feedMode', 'motion']) if (observed[field] !== modal[field]) fail('Controller modal restoration readback did not match.');
  if (Math.abs(observed.feed - modal.feed) > 0.001) fail('Controller feed restoration readback did not match.');
  if (snapshot && observed.toolOffset !== modal.toolOffset) fail('Controller tool-offset mode restoration did not match.');
  if (snapshot) await workflowLine(controller, plan, 'M71');
  return observed;
}

function liveGuard(controller, plan, { probeContact = false, selectedProbe = null } = {}) {
  controller.authorize?.('workflow', { kind: plan.intentType }, {
    reserve: false, ...(plan.reservation ? { reservation: plan.reservation } : {}),
  });
  controller.fresh();
  if (!controller.armed || controller.fault || !sameIdentity(plan.identity, identity(controller))
    || controller.status.homing.complete !== true || controller.status.state.name !== 'Idle') fail('Protected workflow lost its controller state or identity.');
  if (controller.status.pins.letters.some(pin => !(probeContact && pin === 'P'))) fail('Unexpected controller input during protected workflow.');
  if (selectedProbe !== null && controller.status.activeProbe !== selectedProbe) fail('Controller did not confirm the selected probe input.');
  stopped(controller, plan.confirmations);
  point(controller.status.position.machine, 'Live machine position');
}

async function move(controller, plan, target, feed, options = {}) {
  liveGuard(controller, plan, options);
  const start = point(controller.status.position.machine, 'Move start');
  const end = point({ ...start, ...target }, 'Move target');
  const changed = AXES.filter(axis => Math.abs(end[axis] - start[axis]) > 0.00001);
  if (!changed.length) return;
  const distance = Math.hypot(...AXES.map(axis => end[axis] - start[axis]));
  const timeout = Math.ceil(distance / feed * 60000) + 5000;
  await controller.idleAfter(`G21 G90 G94 G53 G1 ${changed.map(axis => `${axis.toUpperCase()}${fmt(end[axis])}`).join(' ')} F${fmt(feed)}`, timeout,
    { beforeSend: commandGuard(controller, plan, options) });
  liveGuard(controller, plan, options);
  if (!equalPoint(end, controller.status.position.machine)) fail('Controller position did not match the protected move target.');
}

async function probeMove(controller, plan, axis, delta, feed, sensor, expectContact) {
  liveGuard(controller, plan, { selectedProbe: sensor });
  if (Math.abs(delta) < 0.00001) return null;
  const start = point(controller.status.position.machine, 'Probe start');
  point({ ...start, [axis]: start[axis] + delta }, 'Probe target');
  const reports = [];
  const listen = event => { if (event?.type === 'probe') reports.push(copy(event)); };
  controller.on('controller', listen);
  try {
    const timeout = Math.ceil(Math.abs(delta) / feed * 60000) + 5000;
    await controller.idleAfter(`G21 G91 G94 G38.${expectContact ? 2 : 3} ${axis.toUpperCase()}${fmt(delta)} F${fmt(feed)}`, timeout,
      { beforeSend: commandGuard(controller, plan, { selectedProbe: sensor }, () => { reports.length = 0; }) });
  } finally { controller.off('controller', listen); }
  liveGuard(controller, plan, { probeContact: true, selectedProbe: sensor });
  if (reports.length !== 1 || typeof reports[0].success !== 'boolean') fail('Exactly one fresh probe report is required for each search.');
  const report = reports[0];
  const hit = point(report.position, 'Reported probe position');
  const travel = (hit[axis] - start[axis]) * Math.sign(delta);
  if (travel < -POSITION_TOLERANCE || travel > Math.abs(delta) + POSITION_TOLERANCE
    || AXES.some(a => a !== axis && Math.abs(hit[a] - start[a]) > POSITION_TOLERANCE)) fail('Probe report is outside the commanded segment.');
  if (report.success !== expectContact) fail(expectContact ? 'Probe contact was not detected.' : 'Unexpected contact during guarded approach.');
  if (expectContact) {
    const stoppedAt = controller.status.position.machine;
    const overrun = (stoppedAt[axis] - hit[axis]) * Math.sign(delta);
    if (overrun < -POSITION_TOLERANCE || overrun > 0.25
      || AXES.some(a => a !== axis && Math.abs(stoppedAt[a] - hit[a]) > POSITION_TOLERANCE)) {
      fail('Stopped machine position does not agree with the probe contact.');
    }
  }
  if (!expectContact && !equalPoint({ ...start, [axis]: start[axis] + delta }, controller.status.position.machine)) fail('Guarded approach did not reach its verified target.');
  return hit;
}

async function twoTouch(controller, plan, contact, settings, sensor) {
  const first = await probeMove(controller, plan, contact.axis,
    contact.searchLimit[contact.axis] - controller.status.position.machine[contact.axis], settings.seekFeed, sensor, true);
  if (Math.abs(first[contact.axis] - contact.expectedCenter[contact.axis]) > 1) fail('Contact differs from the reviewed surface by more than 1 mm.');
  const pullOff = { [contact.axis]: controller.status.position.machine[contact.axis] - contact.direction * settings.latchPullOff };
  await move(controller, plan, pullOff, settings.retractFeed, { probeContact: true, selectedProbe: sensor });
  liveGuard(controller, plan, { selectedProbe: sensor });
  const available = (contact.searchLimit[contact.axis] - controller.status.position.machine[contact.axis]) * contact.direction;
  const latchSearch = Math.min(settings.latchPullOff + 0.5, available);
  if (latchSearch < settings.latchPullOff) fail('Insufficient verified travel for the second touch.');
  const second = await probeMove(controller, plan, contact.axis, contact.direction * latchSearch, settings.latchFeed, sensor, true);
  const repeatabilityMm = Math.abs(second[contact.axis] - first[contact.axis]);
  if (repeatabilityMm > 0.05) fail('Probe repeatability exceeded 0.05 mm.');
  // Retract only after both reports are valid. Faults never trigger blind moves.
  if ((contact.retract[contact.axis] - controller.status.position.machine[contact.axis]) * contact.direction >= 0) fail('Reviewed retract would move toward the contact surface.');
  await move(controller, plan, contact.retract, settings.retractFeed, { probeContact: true, selectedProbe: sensor });
  liveGuard(controller, plan, { selectedProbe: sensor });
  return { id: contact.id, axis: contact.axis, direction: contact.direction, first, rawCenter: second, repeatabilityMm,
    ...(sensor === 0 ? { correctedSurfaceCoordinate: second[contact.axis] + contact.direction * settings.tipDiameter / 2 } : {}) };
}

async function readParameters(controller, plan) {
  const reports = [];
  const listener = event => { if (event?.raw) reports.push(event.raw); };
  controller.on('controller', listener);
  try { await workflowLine(controller, plan, '$#', () => { reports.length = 0; }); }
  finally { controller.off('controller', listener); }
  return reports;
}

function vectorReport(lines, name) {
  const prefix = `[${name}:`;
  const reports = lines.filter(line => line.startsWith(prefix) && line.endsWith(']'));
  if (reports.length !== 1) fail(`Exactly one fresh ${name} readback is required.`);
  const components = reports[0].slice(prefix.length, -1).split(',');
  if (components.some(value => !/^[-+]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value))) fail(`Invalid ${name} readback.`);
  const values = components.map(Number);
  if (!values.length || values.some(n => !Number.isFinite(n))) fail(`Invalid ${name} readback.`);
  return values;
}

function feature(intent, measurements) {
  if (intent.settings.cycle === 'outside-corner') return { type: 'outside-corner',
    x: measurements.find(m => m.axis === 'x').correctedSurfaceCoordinate,
    y: measurements.find(m => m.axis === 'y').correctedSurfaceCoordinate };
  if (intent.settings.cycle === 'bore-center') {
    const byId = Object.fromEntries(measurements.map(m => [m.id, m]));
    const xp = byId['bore-x-plus'].rawCenter.x, xm = byId['bore-x-minus'].rawCenter.x;
    const yp = byId['bore-y-plus'].rawCenter.y, ym = byId['bore-y-minus'].rawCenter.y;
    const diameterX = xp - xm + intent.settings.tipDiameter, diameterY = yp - ym + intent.settings.tipDiameter;
    if (diameterX <= intent.settings.tipDiameter || diameterY <= intent.settings.tipDiameter) fail('Measured bore diameter is invalid.');
    return { type: 'bore', centerX: (xp + xm) / 2, centerY: (yp + ym) / 2, diameterX, diameterY };
  }
  return { type: 'surface', axis: measurements[0].axis, coordinate: measurements[0].correctedSurfaceCoordinate };
}

/** Consume a reviewed plan exactly once. No raw command input is accepted. */
export async function executeNativeWorkflow(controller, { planId, planSha256 } = {}) {
  const saved = storage(controller).plans.get(planId);
  if (!saved || saved.planSha256 !== planSha256) fail('Reviewed native workflow plan does not match.');
  storage(controller).plans.delete(planId);
  const plan = copy(saved);
  authorize(controller, plan.intentType);
  if (controller.now() - plan.createdAt > PLAN_AGE_MS || !sameIdentity(plan.identity, identity(controller))
    || !equalPoint(plan.start, controller.status.position.machine)) fail('Workflow plan expired or controller position/identity changed. Review a new plan.');
  if (plan.intentType === 'apply-tool-length') existingResult(controller, plan.intent.resultId);
  return controller.exclusive(async () => {
    authorize(controller, plan.intentType);
    liveGuard(controller, plan);
    const permit = authorize(controller, plan.intentType, { reserve: true });
    plan.reservation = permit?.reservation;
    let began = false;
    try {
      const modal = await captureModal(controller, plan);
      liveGuard(controller, plan);
      const intent = plan.intent;
      let result;
      if (intent.type === 'apply-work-offset' || intent.type === 'apply-tool-length') {
        began = true;
        await workflowLine(controller, plan, 'G21');
        if (intent.type === 'apply-work-offset') {
          await workflowLine(controller, plan, `G10 L2 P${Number(intent.wcs.slice(1)) - 53} ${AXES.map(axis => `${axis.toUpperCase()}${fmt(intent.offset[axis])}`).join(' ')}`);
          const values = vectorReport(await readParameters(controller, plan), intent.wcs);
          if (values.length < 3 || !AXES.every((axis, i) => Math.abs(values[i] - intent.offset[axis]) <= 0.001)) fail('Work-offset readback did not match; do not use this fixture.');
          result = { type: intent.type, wcs: intent.wcs, fixtureId: intent.fixtureId, offset: intent.offset, readbackVerified: true };
        } else {
          // Pinned grblHAL rejects every axis-bearing TLO block under G80.
          // Select G0 on a separate coordinate-free block: combining G0 and
          // G43.1 would be an axis-command conflict in this firmware.
          // restoreModal reinstates the original G80 after readback.
          if (modal.motion === 80) await workflowLine(controller, plan, 'G0');
          await workflowLine(controller, plan, `G43.1 Z${fmt(intent.tloMm)}`,
            () => existingResult(controller, intent.resultId));
          const values = vectorReport(await readParameters(controller, plan), 'TLO');
          const z = values.length === 1 ? values[0] : values[2];
          if (!Number.isFinite(z) || Math.abs(z - intent.tloMm) > 0.001 || (values.length > 1 && (values[0] !== 0 || values[1] !== 0))) fail('Tool-length readback did not match.');
          const measurement = existingResult(controller, intent.resultId);
          measurement.applied = true;
          result = { type: intent.type, tool: intent.tool, tloMm: intent.tloMm, measurementId: intent.resultId, readbackVerified: true };
        }
      } else {
        const sensor = intent.type === 'tool-setter' ? 1 : 0;
        began = true;
        await workflowLine(controller, plan, 'M70');
        await workflowLine(controller, plan, 'M5'); await workflowLine(controller, plan, 'M9');
        await controller.idleAfter(`G65 P5 Q${sensor}`, undefined, { beforeSend: commandGuard(controller, plan) });
        liveGuard(controller, plan, { selectedProbe: sensor });
        const measurements = [];
        for (const step of plan.steps) {
          if (step.kind === 'raise-z') await move(controller, plan, { z: step.z }, intent.settings.retractFeed, { selectedProbe: sensor });
          if (step.kind === 'clearance-xy') {
            if (Math.abs(controller.status.position.machine.z - step.z) > POSITION_TOLERANCE) fail('Z clearance was not established before XY travel.');
            await move(controller, plan, { x: step.x, y: step.y }, 250, { selectedProbe: sensor });
          }
          if (step.kind === 'guarded-approach') await probeMove(controller, plan, 'z', step.target.z - controller.status.position.machine.z, intent.settings.guardedApproachFeed, sensor, false);
          if (step.kind === 'two-touch') measurements.push(await twoTouch(controller, plan, step, intent.settings, sensor));
        }
        // The firmware wiring contract requires primary PF5 after setter use.
        await controller.idleAfter('G65 P5 Q0', undefined, { beforeSend: commandGuard(controller, plan) });
        liveGuard(controller, plan, { selectedProbe: 0 });
        result = { type: intent.type, measurements, workOffsetApplied: false, toolLengthApplied: false };
        if (intent.type === 'tool-setter') {
          result.tool = intent.settings.currentToolNumber;
          result.contactDeltaMm = measurements[0].rawCenter.z - intent.settings.referenceContactZ;
          result.measuredGaugeLength = number(intent.settings.referenceGaugeLength + result.contactDeltaMm, 1, 200, 'Measured gauge length');
        } else result.feature = feature(intent, measurements);
      }
      liveGuard(controller, plan);
      const restored = await restoreModal(controller, plan, modal, !['apply-work-offset', 'apply-tool-length'].includes(intent.type));
      if (intent.type === 'apply-tool-length' && restored.toolOffset !== 43.1) fail('Controller did not confirm active dynamic tool-length compensation.');
      liveGuard(controller, plan);
      result = { ...result, protocol: 'mr1-native-workflow-result-v1', resultId: randomUUID(), at: controller.now(),
        identity: identity(controller), planId: plan.planId, planSha256: plan.planSha256, geometry: plan.geometry,
        finalMachinePosition: copy(controller.status.position.machine), units: 'mm', coordinates: 'machine' };
      const results = storage(controller).results;
      for (const [id, previous] of results) if (controller.now() - previous.at > RESULT_AGE_MS || !sameIdentity(previous.identity, result.identity)) results.delete(id);
      results.set(result.resultId, copy(result));
      controller.lastWorkflowResult = copy(result);
      controller.publish();
      return result;
    } catch (error) {
      if (began) controller.faulted(`Protected workflow stopped: ${error.message}`);
      throw error;
    }
  });
}
