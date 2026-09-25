import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { resolve, dirname, extname, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { NativeController, prepareProgramOffThread } from './native-controller.mjs';
import { createEventJournal, defaultJournalDirectory } from './event-journal.mjs';
import { summarizeControllerPreflight, pendingControllerPreflight } from './controller-preflight.mjs';
import { createFissionProcessor } from './fission-processor.mjs';
import { parseCommissioningBundle, evaluateCommissioningRecord } from '../src/commissioning-record.js';
import { validateConfigurationJournalEvent } from './mr1-telemetry-service.mjs';
import { createNativeCommissioning } from './native-commissioning.mjs';
import { planNativeWorkflow, executeNativeWorkflow } from './native-workflows.mjs';
import { verifyNativeFirmware } from './native-firmware.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.glb': 'model/gltf-binary', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.jpg': 'image/jpeg', '.bin': 'application/octet-stream' };
function json(res, code, body) { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(body)); }
async function body(req) {
  // Decode once: a multibyte character may be split across chunks.
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 6 * 1024 * 1024) throw new Error('Request body exceeds 6 MB.');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}
// Removing energy never needs the browser lease: a lost or stale session must
// not delay a stop. None of these can start motion or grant authority.
const ENERGY_REMOVING = ['hold', 'stop', 'cancelJog', 'disarm'];
const rejectedSession = message => Object.assign(new Error(message), { sessionRejected: true });
export async function createNativeServer(options = {}) {
  const webRoot = resolve(options.webRoot ?? resolve(ROOT, 'dist'));
  const firmwareArtifact = await verifyNativeFirmware(webRoot);
  const profile = options.profile ?? JSON.parse(await readFile(resolve(ROOT, 'service/profiles/mr1-settings.json'), 'utf8'));
  const listPorts = options.listPorts ?? (async () => (await import('serialport')).SerialPort.list());
  const portFactory = options.portFactory ?? (async path => {
    const ports = await listPorts();
    if (!ports.some(port => port.path === path)) throw new Error('Selected COM port is no longer available.');
    const { SerialPort } = await import('serialport');
    return new SerialPort({ path, baudRate: 115200, autoOpen: false, lock: true });
  });
  const controller = new NativeController({ profile, portFactory, motionQualified: options.motionQualified === true });
  const journalDirectory = options.journalDirectory ?? resolve(defaultJournalDirectory(), 'native');
  const journal = options.journal ?? createEventJournal({ directory: journalDirectory });
  const reconciliation = await journal.reconcile();
  let journalReady = reconciliation.requiresReview !== true;
  const clients = new Set();
  const fission = createFissionProcessor();
  let qualification = null;
  let token = null;
  let ownerSeen = 0;
  let stopPromise = null;
  let closing = false;
  let authorityEpoch = 0;
  let expiredToken = null;
  let mutation = null;
  const requestScope = new AsyncLocalStorage();
  let origin;
  const leaseMs = options.leaseMs ?? 4000;
  const startedAt = new Date().toISOString();
  const emit = (type, payload) => {
    const event = `event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`;
    for (const client of clients) {
      if (client.destroyed || client.writableLength > 1024 * 1024) { client.destroy(); clients.delete(client); }
      else client.write(event);
    }
  };
  const bridge = () => ({ service: 'mr1-native', mode: 'serial', connected: controller.connected, readOnly: !controller.armed,
    nativeControl: true, serialPort: controller.port?.path ?? null, pollMs: 100,
    machineCommands: { enabled: false, physicalEnabled: false },
    controllerPreflight: summarizeControllerPreflight(controller.preflight ?? pendingControllerPreflight('OFFLINE')), startedAt,
    journal: journal.status?.() ?? { enabled: true }, fission: fission.status() });
  const audit = async (kind, payload) => {
    requestScope.getStore()?.check();
    let record;
    try {
      record = await journal.append(kind, payload, { sync: true });
      // The event journal reports a failed durable write as a null record.
      if (record === null || journal.status?.().state === 'ERROR') throw new Error(journal.status?.().error ?? 'record was not written');
    } catch (error) { journalReady = false; controller.faulted(`Journal write failed: ${error.message}`); throw error; }
    // Durable I/O can outlive its browser lease or the connection it reviewed.
    // The stale request may be recorded, but it must not dispatch or commit.
    requestScope.getStore()?.check();
    return record;
  };
  const commissioning = await createNativeCommissioning({ controller, directory: journalDirectory,
    firmwareSha256: firmwareArtifact.sha256, audit, journalReady: () => journalReady });
  controller.authorizeCommand = (action, args, options) => commissioning.authorize(action, args, options);
  controller.beforeWrite = event => audit('native.command', event);
  controller.on('telemetry', status => {
    if (controller.preflight?.settings.some(s => s.id === 13 && s.actual === 0 && s.status === 'PASS')) emit('telemetry', status);
  });
  controller.on('controller', event => emit('controller', event));
  controller.on('state', state => {
    if (!state.preflight && qualification) { qualification = null; controller.motionQualified = false; }
    if (!state.preflight) commissioning.revoke('Controller preflight was invalidated.');
    emit('native-state', state); emit('bridge', bridge());
  });
  const owner = req => {
    const value = req.headers['x-mr1-session'];
    if (!token || typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)
      || !timingSafeEqual(Buffer.from(value), Buffer.from(token))) throw rejectedSession('This browser does not own the controller session.');
    if (Date.now() - ownerSeen > leaseMs) throw rejectedSession('Controller session expired. Reclaim it before continuing.');
    ownerSeen = Date.now();
  };
  const cancelAuthority = reason => {
    authorityEpoch++;
    if (mutation) mutation.cancelled = reason;
  };
  const scopedMutation = async (req, url, input, operation) => {
    const safety = url.pathname === '/api/command' && ENERGY_REMOVING.includes(input.action);
    const disconnect = url.pathname === '/api/disconnect';
    const endCommissioning = url.pathname === '/api/commissioning/end';
    const priority = safety || disconnect || endCommissioning;
    if (priority) {
      if (input.action === 'hold' && safety) {
        // A feed hold must remain resumable for an already dispatched job.
        // It still cancels a start that is only waiting for its request audit.
        if (mutation && !mutation.dispatched) mutation.cancelled = 'A feed hold cancelled the pending request.';
      } else cancelAuthority('A stop, disconnect or commissioning end cancelled the pending request.');
    } else if (mutation) throw new Error('Another controller request is still completing.');
    const scope = {
      token: req.headers['x-mr1-session'], epoch: authorityEpoch,
      generation: priority || url.pathname === '/api/connect' ? null : controller.generation,
      dispatched: false, cancelled: null,
      check() {
        if (closing) throw new Error('The local controller service is shutting down.');
        if (this.cancelled || this.epoch !== authorityEpoch) throw new Error(this.cancelled ?? 'Controller request was cancelled.');
        if (!safety && (this.token !== token || expiredToken === this.token || Date.now() - ownerSeen > leaseMs)) throw rejectedSession('Controller session expired or changed before the request completed.');
        if (this.generation !== null && this.generation !== controller.generation) throw new Error('Controller connection changed before the request completed.');
      },
      dispatch(fn) { this.check(); this.dispatched = true; return fn(); },
    };
    if (!priority) mutation = scope;
    try { return await requestScope.run(scope, () => { scope.check(); return operation(scope); }); }
    finally { if (mutation === scope) mutation = null; }
  };
  const server = createServer(async (req, res) => {
    const requestReceivedEpochMs = Date.now();
    try {
      if (req.headers.host !== new URL(origin).host) return json(res, 403, { error: 'Host not allowed.' });
      if (req.headers.origin && req.headers.origin !== origin) return json(res, 403, { error: 'Origin not allowed.' });
      if (closing) return json(res, 503, { error: 'The local controller service is shutting down.' });
      const url = new URL(req.url, origin);
      if (url.pathname.startsWith('/api/') || ['/events', '/health', '/controller/preflight', '/latency/ping', '/optimize/fission', '/journal/export', '/journal/configuration'].includes(url.pathname)) {
        if (req.method === 'GET') {
          if (url.pathname === '/api/ports') return json(res, 200, await listPorts());
          if (url.pathname === '/api/state') return json(res, 200, { ...controller.snapshot(), journalReady, reconciliation, qualification, firmwareArtifact, commissioning: commissioning.snapshot(), installationRoot: ROOT });
          if (url.pathname === '/health') return json(res, 200, bridge());
          if (url.pathname === '/controller/preflight') return json(res, 200, controller.preflight ?? pendingControllerPreflight('DISCONNECTED'));
          if (url.pathname === '/latency/ping') return json(res, 200, { protocol: 'mr1-latency-ping-v1', serverReceivedEpochMs: requestReceivedEpochMs,
            serverSentEpochMs: Date.now(), serverReceivedAt: new Date(requestReceivedEpochMs).toISOString(), serverSentAt: new Date().toISOString(),
            serviceUptimeMs: Date.now() - Date.parse(startedAt), telemetrySequence: controller.sequence, bridgeMode: 'serial', connected: controller.connected });
          if (url.pathname === '/journal/export') {
            const text = await journal.exportText();
            res.writeHead(200, { 'Content-Type': 'application/x-ndjson', 'Content-Disposition': 'attachment; filename="mr1-native-journal.jsonl"', 'Cache-Control': 'no-store' });
            res.end(text); return;
          }
          if (url.pathname === '/events') {
            res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
            clients.add(res); res.write('retry: 1000\n\n');
            res.write(`event: bridge\ndata: ${JSON.stringify(bridge())}\n\n`);
            if (controller.status && controller.preflight?.settings.some(s => s.id === 13 && s.actual === 0 && s.status === 'PASS')) res.write(`event: telemetry\ndata: ${JSON.stringify(controller.status)}\n\n`);
            req.on('close', () => clients.delete(res)); return;
          }
          return json(res, 404, { error: 'Endpoint not found.' });
        }
        if (req.method !== 'POST' || req.headers.origin !== origin || !req.headers['content-type']?.startsWith('application/json')) return json(res, 403, { error: 'Same-origin JSON request required.' });
        const input = await body(req);
        if (closing) return json(res, 503, { error: 'The local controller service is shutting down.' });
        if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('JSON object required.');
        if (url.pathname === '/journal/configuration') {
          const event = validateConfigurationJournalEvent(input);
          const record = await audit('browser.configuration', event);
          emit('journal', journal.status());
          return json(res, 200, { sealed: true, eventId: event.eventId, digest: record.digest, physicalMotionPermitted: false });
        }
        if (url.pathname === '/optimize/fission') {
          if (controller.armed || controller.busy) throw new Error('Disarm before processing a new program.');
          return json(res, 200, await fission.optimize(input));
        }
        if (url.pathname === '/api/session') {
          if (token && Date.now() - ownerSeen < leaseMs) return json(res, 423, { error: 'Another browser owns the controller.' });
          // Losing the lease invalidates operation even if the watchdog has not
          // yet run. A replacement browser never inherits an armed session.
          cancelAuthority('Operator session changed.');
          if (controller.armed || controller.busy || mutation) controller.faulted('Operator session changed.');
          commissioning.revoke('Operator session changed.');
          token = randomBytes(32).toString('hex'); expiredToken = null; ownerSeen = Date.now(); return json(res, 200, { token });
        }
        let leaseHeld = true;
        try { owner(req); }
        catch (error) { if (url.pathname !== '/api/command' || !ENERGY_REMOVING.includes(input.action)) throw error; leaseHeld = false; }
        if (url.pathname === '/api/heartbeat') return json(res, 200, { ok: true });
        return await scopedMutation(req, url, input, async scope => {
        const respond = async operation => {
          const result = await scope.dispatch(operation); scope.check();
          return json(res, 200, result);
        };
        if (url.pathname === '/api/commissioning/evidence') return respond(() => commissioning.loadEvidence(input.bundle));
        if (url.pathname === '/api/commissioning/begin') return respond(() => commissioning.begin(input));
        if (url.pathname === '/api/commissioning/end') return respond(() => commissioning.end());
        if (url.pathname === '/api/commissioning/restore') return respond(() => commissioning.restore(input));
        if (url.pathname === '/api/workflow/plan') {
          if (!journalReady) throw new Error('Resolve journal recovery first.');
          return json(res, 200, planNativeWorkflow(controller, input));
        }
        if (url.pathname === '/api/workflow/execute') {
          if (!journalReady) throw new Error('Resolve journal recovery first.');
          await audit('native.workflow.request', { planId: input.planId, planSha256: input.planSha256 });
          const result = await scope.dispatch(() => executeNativeWorkflow(controller, input));
          await audit('native.workflow.result', result);
          return json(res, 200, result);
        }
        if (url.pathname === '/api/shutdown') {
          if (controller.port || controller.connected || controller.connecting || controller.disconnecting || controller.armed || controller.busy) throw new Error('Disconnect the controller before closing the service.');
          // Latch before replying: a pipelined request must not start a
          // connection in the interval before the deferred stop runs.
          closing = true; cancelAuthority('The local controller service is shutting down.');
          json(res, 200, { closing: true });
          setImmediate(() => { void service.stop(); }); return;
        }
        if (url.pathname === '/api/qualification') {
          const validate = () => {
            scope.check(); controller.fresh(); controller.outputsStopped();
            if (controller.armed || controller.busy || controller.status.state.name !== 'Idle' || controller.status.pins.active
              || !journalReady || !controller.preflight?.preflightPassed || controller.preflight.counts.warnings) throw new Error('Connect an idle verified controller before importing commissioning evidence.');
            if (commissioning.snapshot().recovery.required || commissioning.snapshot().session) throw new Error('End commissioning and restore production settings first.');
          };
          validate();
          const bundle = await parseCommissioningBundle(input.bundle);
          const checkedFirmware = await verifyNativeFirmware(webRoot);
          validate();
          const context = { machineId: bundle.record.machineId, controllerFingerprint: controller.preflight.configurationFingerprint,
            controllerSimulated: false, firmwareSha256: checkedFirmware.sha256 };
          const evaluation = evaluateCommissioningRecord(bundle.record, context);
          if (!evaluation.allComplete) throw new Error(`Commissioning evidence incomplete: ${evaluation.passed}/${evaluation.total} current checks.`);
          const candidate = { machineId: context.machineId, controllerFingerprint: context.controllerFingerprint,
            firmwareSha256: context.firmwareSha256, commissioningSha256: bundle.integrity.digest, acceptedAt: new Date().toISOString() };
          await audit('native.qualification', candidate);
          validate();
          if (controller.preflight.configurationFingerprint !== candidate.controllerFingerprint) throw new Error('Controller configuration changed during qualification.');
          qualification = candidate;
          controller.motionQualified = true; controller.publish();
          return json(res, 200, qualification);
        }
        if (url.pathname === '/api/recovery') {
          if (controller.connected || controller.busy || controller.armed) throw new Error('Disconnect before reviewing recovery.');
          if (!reconciliation.reviewable || input.reconciliationId !== reconciliation.reconciliationId || input.confirmed !== true) throw new Error('Review the matching recoverable journal before clearing this interlock.');
          await audit('native.recovery.review', { reconciliationId: reconciliation.reconciliationId });
          scope.check();
          if (controller.connected || controller.busy || controller.armed) throw new Error('Controller state changed during recovery review.');
          journalReady = true; return json(res, 200, { journalReady });
        }
        if (url.pathname === '/api/connect') return respond(() => controller.connect(input.port));
        if (url.pathname === '/api/disconnect') return respond(async () => { await controller.disconnect(); return controller.snapshot(); });
        if (url.pathname === '/api/program') return respond(async () => {
          if (controller.busy) throw new Error('Stop the active operation before loading another program.');
          const program = await prepareProgramOffThread(input.source, input.name, { airRun: input.airRun ?? false });
          scope.check(); return controller.commitProgram(program);
        });
        if (url.pathname !== '/api/command') return json(res, 404, { error: 'Endpoint not found.' });
        const actions = {
          arm: () => { if (!journalReady) throw new Error('Previous session requires investigation before hardware operation.'); if (input.confirmed !== true) throw new Error('Confirm the clear machine envelope and physical E-stop.'); return controller.arm(); },
          disarm: () => controller.disarm(),
          home: () => controller.home(input), jog: () => controller.jog(input), zero: () => controller.zero(input),
          probe: async () => { const result = await controller.probeContact(input); await audit('native.probe.result', result); },
          outputs: () => controller.outputs(input), hold: () => controller.hold(), resume: () => controller.resume(),
          cancelJog: () => controller.cancelJog(), stop: () => controller.stop(), run: () => controller.runProgram(input.sha256),
        };
        if (!Object.hasOwn(actions, input.action)) throw new Error('Unknown typed controller command.');
        if (ENERGY_REMOVING.includes(input.action)) {
          // A failed disk must never prevent a stop from reaching the machine.
          void scope.dispatch(actions[input.action]);
          await audit('native.request', { action: input.action, leaseHeld });
          return json(res, 200, controller.snapshot());
        }
        await audit('native.request', { action: input.action });
        // Starting a program returns acceptance; completion comes from controller state.
        if (input.action === 'run') {
          controller.programReady(input.sha256);
          void scope.dispatch(actions.run).catch(error => { void audit('native.job.error', { message: error.message }).catch(() => {}); });
          return json(res, 202, controller.snapshot());
        }
        await scope.dispatch(actions[input.action]);
        scope.check();
        return json(res, 200, controller.snapshot());
        });
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'Method not allowed.' });
      const relative = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
      const file = resolve(webRoot, relative);
      if (!file.startsWith(webRoot + sep)) return json(res, 403, { error: 'Path not allowed.' });
      const info = await stat(file);
      if (!info.isFile()) return json(res, 404, { error: 'File not found.' });
      res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream', 'Content-Length': info.size,
        'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY',
        'Content-Security-Policy': "frame-ancestors 'none'" });
      // An unhandled read error would crash the process without stopping the machine.
      if (req.method === 'HEAD') res.end(); else createReadStream(file).on('error', () => res.destroy()).pipe(res);
    } catch (error) {
      if (!res.headersSent) json(res, 400, { error: error.message, ...(error.sessionRejected ? { sessionRejected: true } : {}) });
      else res.end();
    }
  });
  const watchdog = setInterval(() => {
    commissioning.watchdog();
    if (token && token !== expiredToken && Date.now() - ownerSeen > leaseMs
      && (controller.armed || controller.busy || commissioning.snapshot().session || mutation)) {
      expiredToken = token; cancelAuthority('Operator session lost.');
      commissioning.revoke('Operator session lost.'); controller.faulted('Operator session lost.');
    }
  }, Math.min(250, leaseMs / 4));
  const service = { controller, server,
    async start(port = 5174) {
      await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
      origin = `http://127.0.0.1:${server.address().port}`;
      await journal.append('service.start', { mode: 'native', motionQualified: controller.motionQualified }, { sync: true });
      return origin;
    },
    stop() {
      if (!closing) { closing = true; cancelAuthority('The local controller service is shutting down.'); }
      if (!stopPromise) stopPromise = (async () => {
        clearInterval(watchdog);
        try {
          await controller.disconnect(); for (const client of clients) client.end(); clients.clear();
          await journal.close({ mode: 'native' });
        } finally {
          await new Promise(resolve => {
            // A browser may leave an incomplete upload or other active HTTP
            // connection behind. Give responses a short drain interval, then
            // close those sockets so an old process cannot outlive shutdown.
            const deadline = setTimeout(() => server.closeAllConnections(), 1000);
            server.close(() => { clearTimeout(deadline); resolve(); });
          });
        }
      })();
      return stopPromise;
    },
  };
  return service;
}
// A closed console window (SIGHUP), Ctrl+Break (SIGBREAK) and crashes take the
// same safe stop as Ctrl+C: hold/reset an armed controller, then close. Windows
// kills a closed console about 10 s after SIGHUP, and a wedged driver or disk
// must not keep the process alive, so the stop is bounded.
export function superviseProcess(service, { exit = code => process.exit(code), log = message => console.error(message), graceMs = 5000 } = {}) {
  let stopping = false;
  const shutdown = (code, error) => {
    if (error !== undefined) log(`MR1 native controller failed: ${error?.stack ?? error}`);
    if (stopping) return;
    stopping = true;
    const deadline = setTimeout(() => exit(code || 1), graceMs);
    Promise.resolve().then(() => service.stop()).then(() => { clearTimeout(deadline); exit(code); },
      stopError => { clearTimeout(deadline); log(`MR1 native controller stop failed: ${stopError?.message ?? stopError}`); exit(code || 1); });
  };
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) process.on(signal, () => shutdown(0));
  process.on('uncaughtException', error => shutdown(1, error));
  process.on('unhandledRejection', error => shutdown(1, error));
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const service = await createNativeServer();
  superviseProcess(service);
  console.log(`MR1 native controller: ${await service.start()} — hardware commissioning pending.`);
}
