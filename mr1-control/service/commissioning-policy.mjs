import { createHash, randomUUID } from 'node:crypto';
import { evaluateCommissioningRecord, COMMISSIONING_HARDWARE_PROFILE } from '../src/commissioning-record.js';
import { validateMr1Nc } from '../src/nc-safety-validator.js';
import { parseLine } from '../src/vendor/gcode-parser-browser.js';

export const COMMISSIONING_SESSION_PROTOCOL = 'mr1-staged-commissioning-v1';
const AXES = ['x', 'y', 'z'];
const SHA256 = /^[0-9a-f]{64}$/i;
const fail = message => { throw new Error(message); };
const unique = values => [...new Set(values)];
const BASE = [
  'source_release', 'stock_backup', 'octopus_identity', 'cl57t_faces', 'cl57t_motor_current',
  'safety_review', 'protective_earth', 'safety_chain', 'restart_prevention',
  'octopus_connector_fit', 'cl57t_alarm_static', 'stock_limit_harness', 'cl57t_power_domains',
  'octopus_usb_flash', 'physical_preflight', 'usb_disconnect',
];
const COUPLED = [...BASE, 'cl57t_interface_scope', 'cl57t_alarm_truth', 'gpio_scope', 'x_uncoupled', 'z_uncoupled', 'y_independent'];
const HOMED = [...COUPLED, 'x_home_limit', 'z_home_limit', 'y_auto_square', 'y_mismatch_abort'];
const MOTION = [...HOMED, 'x_scale', 'z_scale', 'y_coupled_scale', 'x_fault_thermal', 'z_fault_thermal', 'y_fault_thermal'];
const SENSOR = ['hw399_identity', 'stock_sensor_harness', 'sensor_isolation', 'probe_truth'];
const SENSOR_COMPLETE = ['probe_repeatability', 'setter_repeatability', 'protected_cycles', 'probe_faults'];
const SPINDLE_COMPLETE = ['spindle_identity', 'spindle_command_scope', 'spindle_speed', 'spindle_safety', 'spindle_emi_thermal'];
const TABLE_COMPLETE = ['table_frame', 'wcs_validation', 'fixture_clearance'];
const COMMON_ATTESTATIONS = ['physicalPreparationReviewed', 'hardwiredStopVerified', 'operatorAtStop', 'noPersonInMotionArea'];
const COUPLED_ATTESTATIONS = ['couplersAndFastenersVerified', 'axisDirectionsVerified', 'zGravityRestraintVerified', 'dualYMechanicsVerified', 'homingPathsClear'];
const OFF_ATTESTATIONS = ['spindlePowerIsolated', 'toolRemoved'];

function stage(id, title, prerequisites, attestations, capabilities, limits = {}, extra = {}) {
  return Object.freeze({ id, title, prerequisites: Object.freeze(unique(prerequisites)),
    attestations: Object.freeze(unique([...COMMON_ATTESTATIONS, ...attestations])),
    capabilities: Object.freeze(['arm', ...capabilities, ...(capabilities.includes('run') ? ['resume'] : [])]), needsTemporaryHomingProfile: false,
    limits: Object.freeze({ durationMs: 15 * 60_000, maxCommands: 100, maxRuns: 0,
      jogDistanceMm: 1, jogFeedMmPerMinute: 60, cumulativeJogMmPerAxis: 20,
      probeDistanceMm: 5, probeSeekFeedMmPerMinute: 50, probeLatchFeedMmPerMinute: 10,
      spindleRpm: 0, programFeedMmPerMinute: 0, ...limits }), ...extra });
}

// These are prerequisites for gathering evidence, never a claim that a stage
// passed. Pulse/scope/uncoupled motion results deliberately are not prerequisites
// for the first uncoupled test. Likewise, cut acceptance is not needed to run its
// own controlled trial. Production remains gated by the complete evidence record.
// Source basis (grblHAL-STM32F4 production profile): system.c disable_lock()
// rejects $X while limits_homing_required(); machine_limits.c requires init_lock
// and checks travel only for homed axes. settings.c set_homing_enable() at
// COMPATIBILITY_LEVEL=0 accepts $22=3 without disabling $20. Thus the uncoupled
// stage needs a separately durable/read-back-verified temporary $22 transaction,
// not a generic alarm unlock. Hard limits and physical safety remain mandatory.
export const COMMISSIONING_ACCESS_STAGES = Object.freeze([
  stage('uncoupled', 'Uncoupled motor checks', BASE,
    [...OFF_ATTESTATIONS, 'allAxesMechanicallyUncoupled', 'zGravityRestraintVerified', 'looseMotorsSecured', 'encoderPairsVerified', 'temporaryHomingProfileReviewed'],
    ['jog'], { durationMs: 5 * 60_000, jogDistanceMm: 0.25, jogFeedMmPerMinute: 50, cumulativeJogMmPerAxis: 2, maxCommands: 24 },
    { needsTemporaryHomingProfile: true, requiredHomingSetting: 3,
      warning: 'Unhomed axes have no firmware soft-limit protection. Y jog drives both Y motors; it cannot qualify either channel independently. No homing, spindle, probing or programs in this stage.' }),
  stage('homing', 'Coupled homing checks', COUPLED, [...OFF_ATTESTATIONS, ...COUPLED_ATTESTATIONS],
    ['home'], { maxCommands: 25 }, { requiredHomingSetting: 7,
      warning: 'Full homing uses the verified firmware sequence Z, X, dual Y, including its configured seek rate; this stage does not reduce that rate.' }),
  stage('motion', 'Coupled direction and scale checks', HOMED, [...OFF_ATTESTATIONS, ...COUPLED_ATTESTATIONS, 'boundedJogPathClear'],
    ['home', 'jog'], {}, { requiredHomingSetting: 7 }),
  stage('probing', 'Probe and setter qualification', [...MOTION, ...SENSOR],
    ['spindlePowerIsolated', 'probeOrToolSecure', 'probeInstalledAndSelected', 'contactPathAndOvertravelReviewed', 'zGravityRestraintVerified'],
    ['home', 'jog', 'probe', 'zero', 'workflow'], {}, { requiredHomingSetting: 7 }),
  stage('spindle', 'Spindle and coolant qualification', [...MOTION, 'spindle_identity'],
    ['spindleDriveParametersReviewed', 'spindleGuardClosed', 'spindleEnableCircuitVerified', 'spindleAlarmInputVerified', 'spindleUnloaded', 'spindleRotationPathClear', 'tachometerReady', 'coolantCircuitVerified', 'requestedSpeedReviewed'],
    ['home', 'outputs'], { spindleRpm: 8000 }, { requiredHomingSetting: 7 }),
  stage('air-run', 'Reviewed air-run program', [...MOTION, ...SENSOR, ...SENSOR_COMPLETE, ...SPINDLE_COMPLETE, ...TABLE_COMPLETE, 'sender_safe_z', 'sender_wcs_tools'],
    [...OFF_ATTESTATIONS, 'programPreviewAndOffsetsReviewed', 'entireProgramPathClear', 'rapidTravelReviewed', 'stockAndFixturesClearOfAirRun'],
    ['home', 'jog', 'zero', 'run'], { maxRuns: 1, programFeedMmPerMinute: 300 }, { requiredHomingSetting: 7, requiresProgramHash: true }),
  stage('cut-trial', 'Reviewed controlled cutting trial', [...MOTION, ...SENSOR, ...SENSOR_COMPLETE, ...SPINDLE_COMPLETE, ...TABLE_COMPLETE, 'sender_safe_z', 'sender_wcs_tools', 'sender_job_control', 'air_run'],
    ['programPreviewAndOffsetsReviewed', 'entireProgramPathClear', 'rapidTravelReviewed', 'toolAndWorkholdingVerified', 'spindleGuardClosed', 'cuttingParametersReviewed', 'coolantCircuitVerified'],
    ['home', 'jog', 'probe', 'zero', 'outputs', 'run', 'workflow'], { maxRuns: 1, spindleRpm: 8000, programFeedMmPerMinute: 2540 }, { requiredHomingSetting: 7, requiresProgramHash: true }),
]);
const STAGES = new Map(COMMISSIONING_ACCESS_STAGES.map(value => [value.id, value]));
const permits = new WeakMap();
const reservations = new WeakMap();

function binding(context) {
  const result = {
    machineId: String(context?.machineId ?? '').toUpperCase(),
    controllerFingerprint: String(context?.controllerFingerprint ?? '').toUpperCase(),
    firmwareSha256: String(context?.firmwareSha256 ?? '').toUpperCase(),
    connectionId: String(context?.connectionId ?? ''),
  };
  if (!/^MR1-[A-Z0-9-]{8,90}$/.test(result.machineId) || !SHA256.test(result.controllerFingerprint)
    || !SHA256.test(result.firmwareSha256) || !result.connectionId || context.controllerSimulated !== false) {
    fail('A physical machine, firmware, controller fingerprint and current connection binding are required.');
  }
  return result;
}

export function evaluateCommissioningAccess(record, context = {}) {
  const evaluation = evaluateCommissioningRecord(record, context);
  const issues = [...evaluation.bindingIssues];
  if (record?.hardwareProfile !== COMMISSIONING_HARDWARE_PROFILE) issues.push('Current CL57T hardware profile is required.');
  try { binding(context); } catch (error) { issues.push(error.message); }
  return { protocol: COMMISSIONING_SESSION_PROTOCOL, productionEvidenceComplete: evaluation.allComplete,
    stages: COMMISSIONING_ACCESS_STAGES.map(definition => {
      const missingChecks = definition.prerequisites.filter(id => !evaluation.checks[id]?.complete)
        .map(id => ({ id, title: evaluation.checks[id]?.check.title ?? id, issues: evaluation.checks[id]?.issues ?? ['Unknown evidence check.'] }));
      return { ...definition, eligible: issues.length === 0 && missingChecks.length === 0, missingChecks, issues: [...issues] };
    }) };
}

export function createCommissioningSession({ record, context, stage: stageId, attestations = {}, operator,
  axes = AXES, programSha256 = null, now = Date.now(), durationMs } = {}) {
  const definition = STAGES.get(stageId);
  if (!definition) fail('Unknown commissioning stage.');
  const access = evaluateCommissioningAccess(record, context).stages.find(value => value.id === stageId);
  if (!access.eligible) fail(`Commissioning prerequisites are incomplete: ${[...access.issues, ...access.missingChecks.map(value => value.id)].join(', ')}.`);
  if (typeof operator !== 'string' || !operator.trim() || operator.length > 100) fail('An operator identity is required.');
  if (!Array.isArray(axes) || !axes.length || axes.some(axis => !AXES.includes(axis)) || new Set(axes).size !== axes.length) fail('Choose unique commissioning axes X, Y and/or Z.');
  const requiredAttestations = [...definition.attestations];
  if (stageId === 'uncoupled' && axes.includes('y')) requiredAttestations.push('bothYMotorsMechanicallyUncoupled');
  const missing = requiredAttestations.filter(key => attestations[key] !== true);
  if (missing.length) fail(`Explicit physical preparation confirmations are required: ${missing.join(', ')}.`);
  if (definition.requiresProgramHash && !SHA256.test(programSha256 ?? '')) fail('This commissioning session requires the reviewed program SHA-256.');
  const duration = durationMs ?? definition.limits.durationMs;
  if (!Number.isFinite(now) || !Number.isInteger(duration) || duration < 1000 || duration > definition.limits.durationMs) fail('Commissioning session duration is outside the allowed bound.');
  const session = Object.freeze({ protocol: COMMISSIONING_SESSION_PROTOCOL, id: randomUUID(), stage: stageId,
    issuedAt: now, expiresAt: now + duration, operator: operator.trim(),
    binding: Object.freeze(binding(context)), axes: Object.freeze([...axes]),
    attestations: Object.freeze(Object.fromEntries(requiredAttestations.map(key => [key, true]))),
    capabilities: definition.capabilities, limits: definition.limits,
    needsTemporaryHomingProfile: definition.needsTemporaryHomingProfile,
    requiredHomingSetting: definition.requiredHomingSetting,
    programSha256: definition.requiresProgramHash ? programSha256.toLowerCase() : null,
    physicalMotionPermitted: false, productionQualified: false });
  permits.set(session, { commands: 0, runs: 0, jogMm: { x: 0, y: 0, z: 0 }, revoked: null });
  return session;
}

export function commissioningSessionState(session, now = Date.now()) {
  const state = permits.get(session);
  if (!state) return null;
  return { ...session, active: !state.revoked && now >= session.issuedAt && now < session.expiresAt,
    revoked: state.revoked, expired: now >= session.expiresAt,
    remainingCommands: Math.max(0, session.limits.maxCommands - state.commands),
    remainingRuns: Math.max(0, session.limits.maxRuns - state.runs),
    remainingJogMm: Object.fromEntries(AXES.map(axis => [axis, Math.max(0, session.limits.cumulativeJogMmPerAxis - state.jogMm[axis])])) };
}

export function revokeCommissioningSession(session, reason = 'Commissioning session ended.') {
  const state = permits.get(session);
  if (state) state.revoked = String(reason);
}

function finite(value, min, max, label) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) fail(`${label} must be ${min}–${max}.`);
  return value;
}

// Call immediately BEFORE reserving/transmitting the typed operation, and do
// not refund on failure: an unacknowledged move may already have happened.
// The caller must separately enforce ownership, durable journaling, live input
// health, homing/limits, the exact temporary-profile transaction, and expiry
// while a command is running. This module never transmits or changes settings.
export function assertCommissioningCommand(session, action, args = {}, liveContext = {}, now = Date.now(), { reserve = true, reservation } = {}) {
  const state = permits.get(session);
  if (!state) fail('A live process-local commissioning session is required.');
  if (state.revoked) fail(`Commissioning session ended: ${state.revoked}`);
  if (!Number.isFinite(now) || now < session.issuedAt || now >= session.expiresAt) fail('Commissioning session expired; review preparation again.');
  const current = binding(liveContext);
  if (Object.keys(session.binding).some(key => session.binding[key] !== current[key])) fail('Commissioning binding changed; a new reviewed session is required.');
  if (!session.capabilities.includes(action)) fail(`${action} is not permitted during ${session.stage} commissioning.`);
  let continuing = false;
  if (reservation !== undefined) {
    const prior = reservations.get(reservation);
    const keys = Object.keys(args);
    if (reserve !== false || !prior || prior.session !== session || prior.action !== action
      || keys.length !== Object.keys(prior.args).length || keys.some(key => !Object.hasOwn(prior.args, key) || prior.args[key] !== args[key])) {
      fail('A matching process-local command reservation is required.');
    }
    continuing = true;
  }
  if (action === 'arm') return commissioningSessionState(session, now);
  if (action === 'resume') {
    if (!state.runs) fail('No commissioning program has been started in this session.');
    return commissioningSessionState(session, now);
  }
  if (!continuing && state.commands >= session.limits.maxCommands) fail('Commissioning command budget is exhausted.');
  let jog = null;
  if (action === 'jog') {
    if (!session.axes.includes(args.axis)) fail('That axis is outside this commissioning session.');
    const distance = Math.abs(finite(args.distance, -session.limits.jogDistanceMm, session.limits.jogDistanceMm, 'Commissioning jog distance'));
    if (!distance) fail('Commissioning jog distance must not be zero.');
    finite(args.feed, 1, session.limits.jogFeedMmPerMinute, 'Commissioning jog feed');
    if (!continuing && state.jogMm[args.axis] + distance > session.limits.cumulativeJogMmPerAxis + 1e-9) fail('Commissioning cumulative jog distance is exhausted.');
    jog = { axis: args.axis, distance };
  } else if (action === 'home') {
    const axis = args.axis ?? 'all';
    if (axis === 'all' ? AXES.some(value => !session.axes.includes(value)) : !session.axes.includes(axis)) fail('The requested homing axes are outside this commissioning session.');
  } else if (action === 'probe') {
    if (!session.axes.includes(args.axis)) fail('That probe axis is outside this commissioning session.');
    const distance = finite(args.distance, -session.limits.probeDistanceMm, session.limits.probeDistanceMm, 'Commissioning probe search');
    if (Math.abs(distance) < 0.1) fail('Commissioning probe search must be at least 0.1 mm.');
    finite(args.seekFeed ?? 50, 1, session.limits.probeSeekFeedMmPerMinute, 'Commissioning probe seek feed');
    finite(args.latchFeed ?? 10, 1, session.limits.probeLatchFeedMmPerMinute, 'Commissioning probe latch feed');
    if (args.confirmedSpindleStopped !== true) fail('Confirm the spindle is physically stopped before probing.');
  } else if (action === 'zero') {
    if (!session.axes.includes(args.axis) || !/^G5[4-9]$/.test(args.wcs ?? 'G54')) fail('Invalid commissioning datum selection.');
  } else if (action === 'workflow') {
    if (!['touch-probe', 'tool-setter', 'apply-work-offset', 'apply-tool-length'].includes(args.kind)) fail('That protected workflow is not permitted during commissioning.');
  } else if (action === 'outputs') {
    const spindle = args.spindle ?? 'off', coolant = args.coolant ?? 'off';
    if (!['off', 'cw'].includes(spindle) || !['off', 'flood', 'mist'].includes(coolant)) fail('Unsupported commissioning output selection.');
    finite(args.rpm ?? 0, spindle === 'cw' ? 1000 : 0, session.limits.spindleRpm, 'Commissioning spindle RPM');
  } else if (action === 'run' && !continuing) {
    if (state.runs >= session.limits.maxRuns) fail('The reviewed commissioning program has already been started.');
    if (typeof args.source !== 'string' || createHash('sha256').update(args.source).digest('hex') !== session.programSha256
      || String(args.sha256 ?? '').toLowerCase() !== session.programSha256) fail('The loaded program does not match this reviewed commissioning session.');
    if (!validateMr1Nc(args.source, { allowSpindleOffMotion: session.stage === 'air-run' }).ok) fail('The commissioning program fails the MR1 NC contract.');
    let units = 1;
    for (const line of args.source.split(/\r?\n/)) {
      const words = parseLine(line).words;
      if (words.some(([letter, value]) => letter === 'G' && value === 20)) units = 25.4;
      if (words.some(([letter, value]) => letter === 'G' && value === 21)) units = 1;
      if (words.some(([letter, value]) => letter === 'F' && value * units > session.limits.programFeedMmPerMinute)) fail('Program feed exceeds the commissioning stage ceiling.');
      if (words.some(([letter, value]) => letter === 'S' && value > session.limits.spindleRpm)) fail('Program spindle speed exceeds the commissioning stage ceiling.');
      if (session.stage === 'air-run' && words.some(([letter, value]) => letter === 'M' && [3, 4, 7, 8].includes(value))) fail('Air-run commissioning requires spindle and coolant off in the program.');
    }
  }
  if (reserve) {
    state.commands++;
    if (jog) state.jogMm[jog.axis] += jog.distance;
    if (action === 'run') state.runs++;
    const created = Object.freeze({ protocol: 'mr1-commissioning-reservation-v1', id: randomUUID() });
    // Typed native arguments are scalar values. Copying their properties binds
    // continuations without rehashing/revalidating a multi-megabyte NC source
    // for every transmitted line. A changed source, hash or action is rejected.
    reservations.set(created, { session, action, args: { ...args } });
    return { ...commissioningSessionState(session, now), reservation: created };
  }
  return commissioningSessionState(session, now);
}
