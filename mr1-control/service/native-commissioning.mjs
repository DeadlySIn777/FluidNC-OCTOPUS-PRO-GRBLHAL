import { mkdir, open, readFile, unlink } from 'node:fs/promises';
import { renameSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { parseCommissioningBundle } from '../src/commissioning-record.js';
import { controllerConfigurationFingerprint, parseControllerSettings } from './controller-preflight.mjs';
import { COMMISSIONING_ACCESS_STAGES, evaluateCommissioningAccess, createCommissioningSession, assertCommissioningCommand,
  commissioningSessionState, revokeCommissioningSession } from './commissioning-policy.mjs';

const fail = message => { throw new Error(message); };
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

// A temporary homing setting is a durable configuration transaction. Its debt
// survives a clean shutdown, disconnect, owner loss and process crash. No startup
// path auto-unlocks a board or silently restores settings.
export async function createNativeCommissioning({ controller: c, directory, firmwareSha256, audit, journalReady }) {
  const path = resolve(directory, 'native-commissioning-profile.json');
  let debt = null;
  let record = null;
  let session = null;
  let activeContext = null;
  let temporaryVerified = false;
  let recoveryError = null;
  let mutationEpoch = 0;
  let pendingBegin = false;
  let pendingEvidence = false;
  let pendingRestore = false;
  try {
    const envelope = JSON.parse(await readFile(path, 'utf8'));
    if (envelope.digest !== digest(envelope.value) || envelope.value.protocol !== 'mr1-temporary-homing-profile-v1') fail('Temporary profile recovery record failed integrity verification.');
    debt = envelope.value.active ? envelope.value : null;
  } catch (error) { if (error.code !== 'ENOENT') recoveryError = error.message; }
  async function persist(value, { beforeCommit, afterCommit } = {}) {
    await mkdir(directory, { recursive: true });
    const temp = `${path}.${randomUUID()}.tmp`;
    let committed = false;
    try {
      const handle = await open(temp, 'wx');
      try { await handle.writeFile(JSON.stringify({ value, digest: digest(value) }) + '\n'); await handle.sync(); }
      finally { await handle.close(); }
      // Keep the final authority check, atomic replacement and in-memory
      // recovery state in one JS turn. Cancellation during async file writes
      // must not commit an inactive recovery record afterward.
      beforeCommit?.();
      renameSync(temp, path);
      committed = true;
      afterCommit?.();
    } finally { if (!committed) await unlink(temp).catch(() => {}); }
  }
  const fingerprint = () => temporaryVerified && debt ? debt.controllerFingerprint : c.preflight?.configurationFingerprint;
  const context = () => ({ machineId: record?.machineId, controllerFingerprint: fingerprint(), firmwareSha256,
    controllerSimulated: false, connectionId: `${c.port?.path}:${c.generation}`, status: c.status });
  function revoke(reason) {
    mutationEpoch++;
    if (session) revokeCommissioningSession(session, reason);
    session = null; activeContext = null; temporaryVerified = false; c.commissioningMode = null;
  }
  function stoppedControllerCheck() {
    c.fresh();
    if (c.armed || c.fault || !['Idle', 'Alarm'].includes(c.status.state.name)) fail('Connect a stopped, disarmed controller first.');
    if (c.status.pins.active || c.status.accessories.spindle !== 'off' || c.status.motion.spindleCommand !== 0
      || (c.status.motion.spindleActual !== null && c.status.motion.spindleActual !== 0)
      || c.status.accessories.flood || c.status.accessories.mist) fail('All inputs must be clear and outputs off.');
  }
  function idleDisconnectedCheck() {
    stoppedControllerCheck();
    if (c.busy) fail('Connect a stopped, disarmed controller first.');
  }
  function operationGuard(created = null) {
    const epoch = mutationEpoch, generation = c.generation, port = c.port;
    return () => {
      if (epoch !== mutationEpoch || generation !== c.generation || port !== c.port || !c.connected) fail('Commissioning operation was cancelled before completion.');
      if (!journalReady()) fail('Resolve journal recovery before commissioning.');
      if (created && !commissioningSessionState(created)?.active) fail('Commissioning session expired before setup completed.');
      stoppedControllerCheck();
    };
  }
  function productionProfile() {
    if (!c.preflight?.preflightPassed || c.preflight.counts.warnings) fail('The exact production settings must pass before commissioning.');
    if (debt || recoveryError) fail(recoveryError ?? 'Restore the temporary homing profile before another stage.');
  }
  const manager = {
    snapshot() {
      return { session: session ? commissioningSessionState(session) : null,
        definitions: COMMISSIONING_ACCESS_STAGES,
        access: record && c.preflight ? evaluateCommissioningAccess(record, context()) : null,
        evidenceLoaded: Boolean(record), recovery: { required: Boolean(debt || recoveryError), error: recoveryError,
          transactionId: debt?.transactionId ?? null, originalHoming: debt ? 7 : null, temporaryHoming: debt ? 3 : null },
        temporaryProfileVerified: temporaryVerified };
    },
    revoke,
    authorize(action, args, options = {}) {
      if (recoveryError) fail(recoveryError);
      if (!journalReady()) fail('Resolve journal recovery before commissioning.');
      if (c.motionQualified && !debt) return;
      if (!session) fail(debt ? 'Temporary homing profile requires explicit restoration.' : 'Import commissioning evidence and start the appropriate stage.');
      if (debt && (!temporaryVerified || c.commissioningMode !== 'uncoupled')) fail('Temporary profile is not verified for this connection.');
      return assertCommissioningCommand(session, action, args, context(), Date.now(), options);
    },
    async loadEvidence(source) {
      if (pendingBegin || pendingRestore || pendingEvidence || session) fail('End the current commissioning operation before changing evidence.');
      idleDisconnectedCheck(); productionProfile();
      const guard = operationGuard();
      pendingEvidence = true;
      try {
        const bundle = await parseCommissioningBundle(source);
        guard();
        await audit('native.commissioning.evidence', { machineId: bundle.record.machineId, digest: bundle.integrity.digest });
        guard();
        record = bundle.record;
        return manager.snapshot();
      } finally { pendingEvidence = false; }
    },
    async begin(input) {
      if (pendingBegin || pendingEvidence || pendingRestore) fail('A commissioning operation is already pending.');
      idleDisconnectedCheck(); productionProfile();
      if (!record) fail('Import the current commissioning evidence first.');
      if (!journalReady()) fail('Review journal recovery first.');
      if (session) fail('End the current commissioning session first.');
      const created = createCommissioningSession({ record, context: context(), stage: input.stage,
        attestations: input.attestations, operator: input.operator, axes: input.axes,
        programSha256: input.programSha256 });
      const generation = c.generation;
      const guard = operationGuard(created);
      pendingBegin = true;
      try {
      await audit('native.commissioning.begin', commissioningSessionState(created));
      guard();
      session = created; activeContext = context(); c.commissioningMode = input.stage;
      if (input.stage !== 'uncoupled') return manager.snapshot();
      try {
        if (c.status.homing.complete !== false || c.status.homing.mask !== 0) fail('Uncoupled tests require a freshly reset, fully unhomed board. Reset explicitly, reconnect and review again.');
        if (input.confirmTemporaryHoming !== true) fail('Explicitly review the temporary $22=3 setting and restoration to $22=7.');
        await c.exclusive(async () => {
          debt = { protocol: 'mr1-temporary-homing-profile-v1', active: true, transactionId: randomUUID(),
            controllerFingerprint: activeContext.controllerFingerprint, firmwareSha256,
            machineId: activeContext.machineId, originalHoming: 7, temporaryHoming: 3, createdAt: new Date().toISOString() };
          await persist(debt, { beforeCommit: guard }); // Must reach durable storage before touching NVS.
          guard();
          await audit('native.commissioning.profile.pending', debt);
          guard();
          await c.line('$22=3', undefined, { beforeSend: guard });
          guard();
          const temporary = { ...c.profile, settings: c.profile.settings.map(s => s.id === 22 ? { ...s, expected: 3 } : s) };
          await c.preflightRead(temporary, { beforeSend: guard });
          guard();
          if (!c.preflight.preflightPassed || c.preflight.counts.warnings
            || controllerConfigurationFingerprint(c.lines.join('\n'), { 22: 7 }) !== debt.controllerFingerprint) fail('Temporary profile readback did not match the reviewed production baseline.');
          // Unlock is part of this explicit bench setup only. No generic $X API.
          if (c.status.state.name === 'Alarm') await c.idleAfter('$X', undefined, { beforeSend: guard });
          guard();
          if (c.status.state.name !== 'Idle' || c.status.homing.complete !== false || c.status.homing.mask !== 0) fail('Controller is not unhomed and idle after bench setup.');
          await audit('native.commissioning.profile.verified', { transactionId: debt.transactionId });
          guard();
          temporaryVerified = true;
          c.preflight.commissioningBaselineFingerprint = debt.controllerFingerprint;
        });
      } catch (error) { revoke(error.message); if (c.generation === generation) c.faulted(error.message); throw error; }
      return manager.snapshot();
      } finally { pendingBegin = false; }
    },
    async end() {
      if (c.busy) fail('Stop the current operation before ending commissioning.');
      revoke('Operator ended commissioning.');
      if (c.armed) c.disarm();
      await audit('native.commissioning.end', { restorationRequired: Boolean(debt) });
      return manager.snapshot();
    },
    async restore({ confirmed = false, transactionId } = {}) {
      if (pendingBegin || pendingEvidence || pendingRestore) fail('Wait for the pending commissioning operation to finish or cancel.');
      idleDisconnectedCheck();
      if (!journalReady()) fail('Resolve journal recovery before restoring settings.');
      if (recoveryError || !debt || !confirmed || transactionId !== debt.transactionId) fail(recoveryError ?? 'Review the matching temporary-profile transaction before restoring.');
      if (!c.preflight || controllerConfigurationFingerprint(c.lines.join('\n'), { 22: 7 }) !== debt.controllerFingerprint) fail('Connected board configuration does not match this recovery transaction.');
      revoke('Restoring production profile.');
      const guard = operationGuard();
      const recoveryDebt = debt;
      pendingRestore = true;
      try {
      await c.exclusive(async () => {
        guard();
        const current = parseControllerSettings(c.lines.join('\n')).get(22);
        if (![3, 7].includes(current)) fail('Unexpected homing configuration; inspect it before restoring.');
        if (current === 3) await c.line('$22=7', undefined, { beforeSend: guard });
        guard();
        await c.preflightRead(c.profile, { beforeSend: guard });
        guard();
        if (!c.preflight.preflightPassed || c.preflight.counts.warnings || c.preflight.configurationFingerprint !== debt.controllerFingerprint) fail('Production profile restoration did not verify.');
        await audit('native.commissioning.profile.restored', { transactionId: debt.transactionId });
        guard();
        await persist({ ...recoveryDebt, active: false, restoredAt: new Date().toISOString() }, {
          beforeCommit: guard, afterCommit: () => { debt = null; },
        });
      });
      return manager.snapshot();
      } finally { pendingRestore = false; }
    },
    watchdog() {
      if (!session) return;
      const state = commissioningSessionState(session);
      if (!state.active) { revoke('Commissioning session expired.'); c.faulted('Commissioning session expired. Restore production settings if required.'); }
      else if (activeContext?.connectionId !== `${c.port?.path}:${c.generation}`) revoke('Controller connection changed.');
    },
  };
  return manager;
}
