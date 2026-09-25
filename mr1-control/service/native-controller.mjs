import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import { parseControllerLine } from '../src/telemetry/grbl-status.js';
import { MR1_CONFIG } from '../src/machine-config.js';
import { validateMr1Nc } from '../src/nc-safety-validator.js';
import { evaluateControllerPreflight, parseControllerSettings } from './controller-preflight.mjs';
import { parseLine } from '../src/vendor/gcode-parser-browser.js';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const fail = message => { throw new Error(message); };
const axes = ['x', 'y', 'z'];
export const REALTIME = Object.freeze({ status: 0x3f, statusAll: 0x87, hold: 0x82, resume: 0x81, cancelJog: 0x85, reset: 0x18 });
const number = (v, min, max, label) => {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) fail(`${label} must be ${min}–${max}.`);
  return v;
};
const axisName = v => axes.includes(v) ? v : fail('Choose X, Y or Z.');
const fmt = v => Number(v.toFixed(5)).toString();

function nativeStatusContract(raw) {
  const fields = new Map();
  for (const item of raw.slice(1, -1).split('|').slice(1)) {
    const colon = item.indexOf(':');
    const key = colon < 0 ? item : item.slice(0, colon);
    if (!key || fields.has(key)) return { valid: false };
    fields.set(key, colon < 0 ? '' : item.slice(colon + 1));
  }
  const numbers = (key, counts, nonnegative = false) => {
    const values = (fields.get(key) ?? '').split(',');
    return counts.includes(values.length) && values.every(value => /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value)
      && Number.isFinite(Number(value)) && (!nonnegative || Number(value) >= 0));
  };
  // $10=511 fixes MPos and FS in EVERY production report; $13=0 sets metric units. H/A/P
  // are periodic; Pn is legitimately omitted when no input is active.
  if (!numbers('MPos', [3]) || fields.has('WPos') || !numbers('FS', [2, 3], true)
    || (fields.has('WCO') && !numbers('WCO', [3]))) return { valid: false };
  if (fields.has('H') && !/^(?:0,[0-6]|1,7)$/.test(fields.get('H'))) return { valid: false };
  if (fields.has('A') && (!/^[SCEFMT]*$/.test(fields.get('A')) || /S.*C|C.*S/.test(fields.get('A')))) return { valid: false };
  if (fields.has('P') && !/^[01](?:,P)?$/.test(fields.get('P'))) return { valid: false };
  if (fields.has('Pn') && !/^[XYZRHSDLTEOFMQP]*$/.test(fields.get('Pn'))) return { valid: false };
  const full = fields.get('FW') === 'grblHAL';
  if (full && !['WCO', 'H', 'A', 'P'].every(key => fields.has(key))) return { valid: false };
  return { valid: true, full };
}

// Exactly one owner and one outstanding acknowledged line. Never replay a line
// after a timeout: the controller may already have executed it.
export class NativeController extends EventEmitter {
  constructor({ profile, portFactory, now = Date.now, ackTimeout = 5000, portTimeout = 5000, staleMs = 1500, welcomeMs = 1000,
    homeTimeout = 120000, jogCancelMs = 1000, motionQualified = false, beforeWrite = async () => {} } = {}) {
    super();
    Object.assign(this, { profile, portFactory, now, ackTimeout, portTimeout, staleMs, welcomeMs, homeTimeout, jogCancelMs, motionQualified, beforeWrite });
    if (!this.profile.settings.some(s => s.id === 13)) this.profile = { ...profile, settings: [...profile.settings,
      { id: 13, name: 'Metric status reports', expected: 0, tolerance: 0, severity: 'blocker' }] };
    this.port = null;
    this.pending = null;
    this.generation = 0;
    this.sequence = 0;
    this.status = null;
    this.preflight = null;
    this.connected = false;
    this.connecting = false;
    this.disconnecting = false;
    this.disconnectPromise = null;
    this.armed = false;
    this.busy = false;
    this.buffer = '';
    this.lines = [];
    this.probe = null;
    this.probeCounter = 0;
    this.program = null;
    this.job = { state: 'empty', sent: 0, acknowledged: 0, total: 0 };
    this.fault = null;
    this.paused = false;
    this.awaitingHome = false;
    this.parserState = null;
    this.lastProbeResult = null;
    this.lastFullStatusSequence = 0;
    this.readingPreflight = false;
    this.verifiedSettings = null;
  }
  snapshot() {
    return { protocol: 'mr1-native-control-v1', connected: this.connected, connecting: this.connecting,
      disconnecting: this.disconnecting, port: this.port?.path ?? null,
      armed: this.armed, motionQualified: this.motionQualified, busy: this.busy, status: this.status,
      preflight: this.preflight, job: { ...this.job }, fault: this.fault, probeResult: this.lastProbeResult,
      workflowResult: this.lastWorkflowResult ?? null,
      program: this.program ? { name: this.program.name, sha256: this.program.sha256, airRun: this.program.airRun, validation: this.program.validation } : null };
  }
  publish() { this.emit('state', this.snapshot()); }
  realtime(byte) {
    const port = this.port, generation = this.generation;
    if (!port?.isOpen) return Promise.resolve();
    // Resolves (never rejects) once the driver finished this byte.
    return new Promise(resolve => {
      const failed = error => {
        if (error && this.port === port && this.generation === generation) this.faulted(error.message, false);
        resolve();
      };
      try { port.write(Buffer.from([byte]), failed); } catch (error) { failed(error); }
    });
  }
  rejectPending(error) {
    if (!this.pending) return;
    const pending = this.pending;
    this.pending = null;
    clearTimeout(pending.timer);
    pending.reject(error);
  }
  faulted(message, sendHold = this.armed) {
    if (sendHold) { this.realtime(REALTIME.hold); this.realtime(REALTIME.reset); }
    this.generation++;
    this.armed = false;
    this.fault = message;
    this.preflight = null;
    this.status = null;
    this.rejectPending(new Error(message));
    if (['running', 'paused', 'draining'].includes(this.job.state)) this.job.state = 'fault';
    this.publish();
  }
  ingest(chunk) {
    this.buffer += chunk.toString('utf8');
    if (this.buffer.length > 65536) { this.buffer = ''; this.faulted('Controller receive buffer overflow.'); return; }
    const lines = this.buffer.split(/\r?\n/);
    this.buffer = lines.pop();
    for (const line of lines.map(s => s.trim()).filter(Boolean)) {
      this.lines.push(line);
      if (this.lines.length > 2000) this.lines.shift();
      if (this.preflight && !this.readingPreflight) {
        const setting = line.match(/^\$(\d+)=([-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[-+]?\d+)?)$/i);
        if ((setting && this.verifiedSettings?.get(Number(setting[1])) !== Number(setting[2]))
          || (/^\$N[01]=/.test(line) && !/^\$N[01]=$/.test(line))) {
          this.faulted('Controller configuration changed after preflight. Reconnect and review the settings.');
          continue;
        }
      }
      const event = parseControllerLine(line, this.status, { receivedAt: new Date(this.now()).toISOString() });
      if (event?.type === 'status') {
        const contract = nativeStatusContract(line);
        if (!contract.valid) { this.faulted('Controller status is incomplete or inconsistent with the verified native report format.'); continue; }
        this.status = { ...event.status, sequence: ++this.sequence };
        if (contract.full) this.lastFullStatusSequence = this.sequence;
        this.lastStatusAt = this.now();
        if (this.pending?.written && this.pending.homing === false && this.status.state.name === 'Home') this.pending.homing = true;
        if (['Run', 'Hold'].includes(this.status.state.name)) this.lastPlannerWaitAt = this.lastStatusAt;
        if (this.status.state.name !== 'Alarm' && !this.homingOperation) this.awaitingHome = false;
        if (this.armed && (this.status.pins.controls.eStop || this.status.pins.controls.motorFault
          || this.status.pins.controls.reset || this.status.pins.controls.safetyDoor
          || this.status.state.name === 'Door' || (this.status.state.name === 'Alarm' && !this.awaitingHome))) this.faulted('Controller safety input or alarm is active.');
        this.emit('telemetry', this.status);
      } else if (event?.type === 'ok' && this.pending?.written) {
        const pending = this.pending; this.pending = null; clearTimeout(pending.timer);
        // The report that ends a silent homing cycle must still arrive within staleMs.
        if (pending.homing) this.statusGraceFrom = this.now();
        pending.resolve();
      } else if (event?.type === 'error') this.faulted(`Controller rejected command: error ${event.code}.`);
      else if (event?.type === 'alarm') this.faulted(`Controller alarm ${event.code}.`);
      else if (event?.type === 'startup' && this.connected && this.welcome) this.welcome();
      else if (event?.type === 'startup' && this.connected) {
        this.status = null; this.preflight = null; this.faulted('Controller restarted. Reconnect and verify before continuing.', false);
      } else if (event?.type === 'probe') { this.probeCounter++; this.probe = { ...event, sequence: this.sequence, at: this.now() }; }
      else if (event?.type === 'parser-state') this.parserState = event.value;
      this.emit('controller', event);
    }
    this.publish();
  }
  async portTransition(port, operation, stillOwned) {
    let timer, timedOut = false;
    const message = `Controller port ${operation} timed out. Waiting for the serial driver; connection ownership remains locked.`;
    try {
      await new Promise((resolve, reject) => {
        timer = setTimeout(() => {
          if (!stillOwned()) return;
          timedOut = true;
          // A timer cannot prove that the OS has released its handle. Surface
          // the fault and cancel authority, but await the real callback.
          this.faulted(message, false);
        }, this.portTimeout);
        port[operation](error => error ? reject(error) : resolve());
      });
    } finally { clearTimeout(timer); }
    if (timedOut && stillOwned() && this.fault === message) {
      this.fault = `Controller port ${operation} completed after a timeout. Reconnect and verify before continuing.`;
      this.publish();
    }
  }
  async connect(path) {
    if (this.port || this.busy || this.connecting || this.disconnecting) fail('Disconnect the current controller first.');
    if (!/^COM[1-9]\d*$/i.test(path)) fail('Select an enumerated Windows COM port.');
    this.busy = true; this.connecting = true;
    const generation = ++this.generation;
    this.status = null; this.preflight = null; this.fault = null; this.lines = []; this.buffer = ''; this.parserState = null; this.lastProbeResult = null;
    this.lastFullStatusSequence = 0; this.verifiedSettings = null; this.statusGraceFrom = null;
    this.publish();
    let port;
    try {
      port = await this.portFactory(path);
      if (generation !== this.generation) fail('Connection cancelled.');
      this.port = port;
      this.portListeners = {
        data: chunk => { if (this.port === port) this.ingest(chunk); },
        error: error => { if (this.port === port) this.faulted(error.message); },
        close: () => { if (this.port === port) { this.connected = false; this.preflight = null; this.faulted('Controller disconnected.', false); } },
      };
      for (const [event, listener] of Object.entries(this.portListeners)) port.on(event, listener);
      await this.portTransition(port, 'open', () => this.connecting);
      if (generation !== this.generation || this.port !== port) {
        if (port.isOpen) await this.portTransition(port, 'close', () => this.connecting);
        fail('Connection cancelled.');
      }
      this.connected = true;
      this.lastStatusAt = this.now();
      this.timer = setInterval(() => {
        this.realtime(REALTIME.status);
        // With $10 bit 12 clear, grblHAL sends one forced report as homing starts
        // and none until it ends; the bounded $H acknowledgement covers that gap.
        if (this.armed && !this.pending?.homing
          && this.now() - Math.max(this.lastStatusAt, this.statusGraceFrom ?? -Infinity) > this.staleMs) this.faulted('Controller status timed out.');
      }, 100);
      await this.awaitWelcome(generation);
      await this.preflightRead();
    } catch (error) {
      // Cleanup belongs to this attempt. A cancelled delayed open may complete
      // after disconnect already detached it, but must never close a new port.
      if (port && this.port === port) await this.disconnect();
      else if (port && this.closingPort === port && this.disconnectPromise) await this.disconnectPromise;
      else if (port?.isOpen) await this.portTransition(port, 'close', () => this.connecting);
      throw error;
    }
    finally { this.busy = false; this.connecting = false; this.publish(); }
    return this.snapshot();
  }
  async awaitWelcome(generation) {
    // grblHAL prints its welcome banner 200 ms after every DTR rising edge,
    // which opening the port causes. Consume that one banner before the first
    // query; any later startup line is a controller restart.
    await new Promise(resolve => {
      const timer = setTimeout(() => { this.welcome = null; resolve(); }, this.welcomeMs);
      this.welcome = () => { clearTimeout(timer); this.welcome = null; resolve(); };
    });
    if (generation !== this.generation || !this.connected || this.fault) fail(this.fault ?? 'Connection cancelled.');
  }
  async preflightRead(profile = this.profile, { beforeSend } = {}) {
    if (this.readingPreflight) fail('A controller preflight is already active.');
    const generation = this.generation, port = this.port;
    const current = () => {
      if (generation !== this.generation || this.port !== port || !this.connected || this.fault) fail(this.fault ?? 'Preflight cancelled.');
      beforeSend?.();
      if (generation !== this.generation || this.port !== port || !this.connected || this.fault) fail(this.fault ?? 'Preflight cancelled.');
    };
    current();
    this.readingPreflight = true;
    try {
    this.lines = [];
    for (const query of ['$I+', '$$', '$G', '$#', '$N']) await this.line(query, this.ackTimeout, { beforeSend: current });
    current();
    const before = this.sequence;
    // grblHAL 0x87 sets Report_All, which includes homing, accessories and
    // selected probe even when a normal '?' would omit unchanged fields.
    this.realtime(REALTIME.statusAll);
    await this.waitFor(() => this.lastFullStatusSequence > before, this.ackTimeout, generation);
    current();
    const preflight = evaluateControllerPreflight(this.lines.join('\n'), profile,
      { simulated: false, source: `serial:${this.port.path}@115200` });
    const startup = this.lines.filter(line => /^\$N[01]=/.test(line));
    if (!['$N0=', '$N1='].every(line => startup.includes(line)) || startup.some(line => !/^\$N[01]=$/.test(line))) {
      preflight.preflightPassed = false; preflight.status = 'BLOCKED'; preflight.counts.blockers++;
      preflight.issues.push({ severity: 'blocker', code: 'STARTUP_BLOCKS', message: 'Both startup blocks must be reported and empty; automatic startup commands require separate review.' });
    }
    current();
    this.preflight = preflight;
    this.verifiedSettings = parseControllerSettings(this.lines.join('\n'));
    } finally { this.readingPreflight = false; }
  }
  disconnect() {
    if (this.disconnectPromise) return this.disconnectPromise;
    // Reserve cleanup before any callbacks/publish can re-enter. Do not let a
    // replacement connection race an operating-system close still in flight.
    let resolve, reject;
    const completed = new Promise((yes, no) => { resolve = yes; reject = no; });
    this.disconnectPromise = completed; this.disconnecting = true;
    this.closeConnection().then(() => {
      this.disconnectPromise = null; this.disconnecting = false; this.publish(); resolve();
    }, error => {
      this.disconnectPromise = null; this.disconnecting = false; this.publish(); reject(error);
    });
    return completed;
  }
  async closeConnection() {
    clearInterval(this.timer);
    const stopped = this.armed || (this.busy && this.preflight) ? [this.realtime(REALTIME.hold), this.realtime(REALTIME.reset)] : [];
    this.generation++; this.armed = false; this.connected = false; this.preflight = null;
    if (['running', 'paused', 'draining'].includes(this.job.state)) this.job.state = 'stopped';
    this.rejectPending(new Error('Disconnected.'));
    this.welcome?.();
    const port = this.port; this.port = null; this.closingPort = port;
    const listeners = this.portListeners; this.portListeners = null;
    this.status = null; this.publish();
    try {
      // Closing the port cancels in-flight writes; let hold/reset reach the driver first.
      if (stopped.length) {
        let timer;
        await Promise.race([Promise.all(stopped), new Promise(resolve => { timer = setTimeout(resolve, Math.min(this.portTimeout, 1000)); })]);
        clearTimeout(timer);
      }
      if (port?.isOpen) await this.portTransition(port, 'close', () => this.closingPort === port);
      if (port && listeners) for (const [event, listener] of Object.entries(listeners)) port.off(event, listener);
    } catch (error) {
      // Keep ownership if close failed: otherwise an open handle could be lost
      // while the UI is permitted to open another controller.
      this.port = port; this.portListeners = listeners;
      this.fault = `Controller port could not close: ${error.message}`;
      throw error;
    } finally { this.closingPort = null; }
  }
  line(command, timeout = this.ackTimeout, { plannerWait = false, homing = false, beforeSend } = {}) {
    if (this.fault) return Promise.reject(new Error(this.fault));
    if (!this.port?.isOpen) return Promise.reject(new Error('Controller is disconnected.'));
    if (this.pending) return Promise.reject(new Error('A controller command is already awaiting acknowledgement.'));
    if (!/^[\x20-\x7e]+$/.test(command) || Buffer.byteLength(command) > 120) return Promise.reject(new Error('Invalid or oversized controller line.'));
    return new Promise((resolve, reject) => {
      // homing: false until the written $H produces the firmware's forced Home report.
      const pending = { resolve, reject, timer: null, written: false, homing: homing ? false : undefined };
      this.pending = pending;
      const generation = this.generation, port = this.port;
      const current = () => this.pending === pending && generation === this.generation && this.port === port;
      const event = { command, at: new Date(this.now()).toISOString() };
      // Persist before sending. A stop during persistence cancels this command.
      Promise.resolve().then(() => this.beforeWrite(event)).then(() => {
        if (!current()) return;
        beforeSend?.();
        if (!current()) return;
        this.emit('command', event);
        if (!current()) return;
        beforeSend?.();
        if (!current()) return;
        const sentAt = this.now();
        const checkAck = () => {
          if (this.pending !== pending) return;
          // grblHAL can withhold ok while its planner drains, and M0 blocks
          // inside the firmware suspend loop until the operator resumes.
          // Only a live, armed program may wait; Idle without ok still fails.
          const idleBudgetLeft = Math.max(sentAt, this.lastPlannerWaitAt ?? 0) + timeout - this.now();
          if (plannerWait && this.armed && !this.fault && this.now() - this.lastStatusAt <= this.staleMs
            && (['Run', 'Hold'].includes(this.status?.state.name) || idleBudgetLeft > 0)) {
            pending.timer = setTimeout(checkAck, Math.max(10, Math.min(timeout, idleBudgetLeft)));
          } else this.faulted('Controller acknowledgement timed out; command was not retried.');
        };
        pending.timer = setTimeout(checkAck, timeout);
        pending.written = true;
        port.write(`${command}\n`, error => {
          if (error && this.port === port && this.generation === generation) this.faulted(error.message, false);
        });
      }).catch(error => { if (current()) this.faulted(error.message); });
    });
  }
  async waitFor(predicate, timeout = 30000, generation = this.generation) {
    const deadline = this.now() + timeout;
    while (!predicate()) {
      if (generation !== this.generation || !this.connected) fail(this.fault ?? 'Operation cancelled.');
      if (this.now() > deadline) { this.faulted('Controller operation timed out.'); fail(this.fault); }
      await sleep(10);
    }
    if (generation !== this.generation) fail(this.fault ?? 'Operation cancelled.');
  }
  fresh() {
    if (!this.connected || !this.status || this.now() - this.lastStatusAt > this.staleMs) fail('Fresh controller status is required.');
    const c = this.status.pins.controls;
    if (c.eStop || c.motorFault || c.reset || c.safetyDoor || c.feedHold) fail('Clear the controller safety input before continuing.');
  }
  outputsStopped() {
    const { accessories, motion } = this.status;
    if (accessories.spindle !== 'off' || accessories.flood || accessories.mist || motion.spindleCommand !== 0
      || (motion.spindleActual !== null && motion.spindleActual !== 0)) fail('Stop spindle and coolant before arming or starting a program.');
  }
  authorize(action, args = {}, options = {}) {
    if (this.authorizeCommand) return this.authorizeCommand(action, args, options);
    if (!this.motionQualified) fail('Hardware commissioning is not enabled for this installation.');
  }
  arm() {
    this.fresh();
    this.outputsStopped();
    this.authorize('arm');
    if (!this.preflight?.preflightPassed || this.preflight.counts.warnings || this.fault) fail('An exact MR1 controller preflight is required.');
    if (!['Idle', 'Alarm'].includes(this.status.state.name)) fail('Controller must be idle before arming.');
    if (this.status.state.name === 'Alarm' && this.status.homing.complete) fail('Resolve the controller alarm before arming.');
    this.awaitingHome = this.status.state.name === 'Alarm';
    this.armed = true; this.publish();
  }
  ready({ homed = true, alarm = false } = {}) {
    this.fresh();
    if (!this.armed || this.fault) fail('Arm the verified controller first.');
    if (!(alarm ? ['Idle', 'Alarm'] : ['Idle']).includes(this.status.state.name)) fail('Controller is not idle.');
    if (this.status.pins.active) fail('A controller input is active.');
    if (homed && this.status.homing.complete !== true) fail('Home the machine first.');
  }
  async exclusive(operation) {
    if (this.busy) fail('Another operation is active.');
    this.busy = true; this.publish();
    try { return await operation(); }
    finally { this.busy = false; this.publish(); }
  }
  async idleAfter(command, timeout = 30000, { target, ...options } = {}) {
    const generation = this.generation;
    await this.line(command, timeout, options);
    const afterAck = this.sequence;
    this.realtime(REALTIME.status);
    // grblHAL acknowledges a planned move before its cycle starts, so Idle alone
    // can precede the motion. A move with a known target must also arrive there.
    const arrived = () => !target || axes.every(axis => !Number.isFinite(target[axis])
      || Math.abs(this.status.position.machine?.[axis] - target[axis]) <= 0.01);
    await this.waitFor(() => this.sequence > afterAck && this.status?.state.name === 'Idle' && arrived(), timeout, generation);
  }
  reserveTypedAction(action, args) {
    const receipt = this.authorize(action, args);
    return { action, args, reservation: receipt?.reservation, generation: this.generation,
      port: this.port, preflight: this.preflight, mode: this.commissioningMode };
  }
  typedActionGuard(context, { homed = true, alarm = false, probeContact = false, selectedProbe = null, stopped = false } = {}, beforeSend) {
    const start = { ...this.status?.position.machine };
    return () => {
      this.authorize(context.action, context.args, { reserve: false,
        ...(context.reservation ? { reservation: context.reservation } : {}) });
      this.fresh();
      if (!this.armed || this.fault || this.generation !== context.generation || this.port !== context.port
        || this.preflight !== context.preflight || this.commissioningMode !== context.mode) fail('Typed action lost its controller state or authority.');
      if (!(alarm ? ['Idle', 'Alarm'] : ['Idle']).includes(this.status.state.name)) fail('Controller is not idle before the typed command.');
      if (homed && this.status.homing.complete !== true) fail('Home the machine first.');
      if (this.status.pins.letters.some(pin => !(probeContact && pin === 'P'))) fail('Unexpected controller input before the typed command.');
      if (selectedProbe !== null && this.status.activeProbe !== selectedProbe) fail('Controller did not confirm the selected probe input.');
      if (stopped) this.outputsStopped();
      if (axes.some(axis => !Number.isFinite(start[axis]) || !Number.isFinite(this.status.position.machine?.[axis])
        || Math.abs(start[axis] - this.status.position.machine[axis]) > 0.01)) fail('Machine position changed before the typed command was sent.');
      beforeSend?.();
    };
  }
  async typedReports(command, guard, type) {
    const reports = [];
    const listen = event => { if (this.pending?.written && event?.raw && (!type || event.type === type)) reports.push(event); };
    this.on('controller', listen);
    try {
      await this.line(command, undefined, { beforeSend: () => {
        guard(); reports.length = 0;
        if (type === 'parser-state') this.parserState = null;
      } });
      guard();
      return reports;
    } finally { this.off('controller', listen); }
  }
  async typedModal(guard) {
    const reports = await this.typedReports('$G', guard, 'parser-state');
    if (reports.length !== 1) fail('Exactly one fresh parser modal report is required.');
    const words = parseLine(reports[0].value).words;
    const one = (letter, values) => {
      const found = words.filter(([key, value]) => key === letter && (!values || values.includes(value)));
      if (found.length !== 1 || !Number.isFinite(found[0][1])) fail('A complete, unambiguous controller modal report is required.');
      return found[0][1];
    };
    const modal = { units: one('G', [20, 21]), distance: one('G', [90, 91]), feedMode: one('G', [93, 94, 95]),
      motion: one('G', [0, 1, 80]), wcs: one('G', [54, 55, 56, 57, 58, 59]), plane: one('G', [17, 18, 19]),
      toolOffset: one('G', [43, 43.1, 43.2, 49]), retract: one('G', [98, 99]), scaling: one('G', [50]),
      tool: one('T'), feed: one('F'), rpm: one('S'), spindle: one('M', [3, 4, 5]), coolant: one('M', [7, 8, 9]) };
    if (modal.feedMode === 93 || words.some(([letter, value]) => letter === 'G' && [41, 42, 51, 68].includes(value))) fail('Select a supported modal state without inverse-time feed, scaling, rotation or cutter compensation before probing.');
    if (modal.spindle !== 5 || modal.coolant !== 9 || words.some(([letter, value]) => letter === 'M' && value === 6)) fail('The parser modal report must confirm spindle/coolant off and no tool change.');
    if (modal.feed < 0 || modal.rpm < 0 || !Number.isInteger(modal.tool) || modal.tool < 0) fail('Invalid values in controller modal report.');
    return modal;
  }
  async typedParameters(guard, keys) {
    const reports = await this.typedReports('$#', guard);
    return Object.fromEntries(keys.map(key => {
      const matching = reports.filter(report => report.raw.startsWith(`[${key}:`));
      if (matching.length !== 1) fail(`Exactly one fresh ${key} parameter readback is required.`);
      const text = matching[0].raw.slice(key.length + 2, -1).split(',');
      if (!matching[0].raw.endsWith(']') || text.length !== 3 || text.some(value => !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value) || !Number.isFinite(Number(value)))) fail(`Malformed ${key} parameter readback.`);
      return [key, text.map(Number)];
    }));
  }
  async home({ axis = 'all' } = {}) {
    if (!['all', 'x', 'y', 'z'].includes(axis)) fail('Choose a homing axis or all.');
    const args = { axis };
    this.authorize('home', args, { reserve: false });
    return this.exclusive(async () => {
      this.ready({ homed: false, alarm: true });
      this.outputsStopped();
      const context = this.reserveTypedAction('home', args);
      this.homingOperation = true; this.awaitingHome = true;
      try {
      const command = axis === 'all' ? '$H' : `$H${axis.toUpperCase()}`;
      const generation = this.generation;
      await this.line(command, this.homeTimeout, { homing: true, beforeSend: this.typedActionGuard(context, { homed: false, alarm: true, stopped: true }) });
      const after = this.sequence;
      this.realtime(REALTIME.status);
      await this.waitFor(() => this.sequence > after && ['Idle', 'Alarm'].includes(this.status?.state.name), this.homeTimeout, generation);
      const mask = { x: 1, y: 2, z: 4 }[axis];
      if (axis === 'all' ? this.status.homing.complete !== true : !(this.status.homing.mask & mask)) fail('Controller did not confirm homing.');
      } catch (error) { this.faulted(error.message); throw error; }
      finally { this.homingOperation = false; this.awaitingHome = this.armed && this.status?.state.name === 'Alarm' && this.status?.homing.complete !== true; }
    });
  }
  async jog({ axis, distance, feed }) {
    axis = axisName(axis);
    number(distance, -10, 10, 'Jog distance');
    if (distance === 0) fail('Jog distance must not be zero.');
    number(feed, 1, MR1_CONFIG.maxRate[axis], 'Jog feed');
    const args = { axis, distance, feed };
    this.authorize('jog', args, { reserve: false });
    return this.exclusive(async () => {
      const uncoupled = this.commissioningMode === 'uncoupled';
      this.ready({ homed: !uncoupled });
      if (uncoupled && (this.status.homing.complete !== false || this.status.homing.mask !== 0)) fail('Uncoupled testing requires every axis unhomed.');
      const target = this.status.position.machine?.[axis] + distance;
      const envelope = MR1_CONFIG.machineEnvelope[axis];
      if (!Number.isFinite(target) || (!uncoupled && (target < envelope.min || target > envelope.max))) fail('Jog exceeds machine travel.');
      const context = this.reserveTypedAction('jog', args);
      await this.idleAfter(`$J=G21 G91 ${axis.toUpperCase()}${fmt(distance)} F${fmt(feed)}`, undefined,
        { beforeSend: this.typedActionGuard(context, { homed: !uncoupled }, () => {
          if (uncoupled && (this.status.homing.complete !== false || this.status.homing.mask !== 0)) fail('Uncoupled testing requires every axis unhomed.');
          const liveTarget = this.status.position.machine[axis] + distance;
          if (!Number.isFinite(liveTarget) || (!uncoupled && (liveTarget < envelope.min || liveTarget > envelope.max))) fail('Jog exceeds machine travel.');
        }) });
    });
  }
  hold() { this.paused = true; this.realtime(REALTIME.hold); if (this.job.state === 'running') this.job.state = 'paused'; this.publish(); }
  resume() {
    this.fresh();
    this.authorize('resume');
    if (!this.armed || this.fault || this.status.state.name !== 'Hold' || this.status.state.substate !== 0) fail('Controller must confirm a completed hold before resuming.');
    this.paused = false; this.realtime(REALTIME.resume);
    if (this.job.state === 'paused') this.job.state = 'running';
    this.publish();
  }
  async cancelJog() {
    const message = 'Jog cancelled. Reconnect to synchronize the command channel.';
    if (!this.armed || !['Jog', 'Idle'].includes(this.status?.state.name)) return this.faulted(message, true);
    // 0x85 decelerates a jog and flushes its queued line without the position
    // loss of a reset. That line may never be acknowledged, so still reconnect.
    const port = this.port, before = this.sequence, deadline = this.now() + this.jogCancelMs;
    this.realtime(REALTIME.cancelJog); this.realtime(REALTIME.status);
    this.faulted(message, false);
    const generation = this.generation;
    // One report may predate the cancel; Idle must come from a later one.
    while (!(this.sequence > before + 1 && this.status?.state.name === 'Idle')) {
      if (generation !== this.generation || this.port !== port || !port?.isOpen) return;
      if (this.now() > deadline) return this.faulted('Jog cancel was not confirmed; controller was reset. Reconnect and re-home before continuing.', true);
      await sleep(10);
    }
  }
  disarm() { this.faulted('Disarmed. Reconnect and verify before continuing.', true); }
  stop() {
    this.realtime(REALTIME.hold); this.realtime(REALTIME.reset);
    this.generation++; this.armed = false; this.preflight = null; this.status = null;
    this.fault = 'Stopped; reconnect and re-home before continuing.';
    this.rejectPending(new Error(this.fault));
    this.job.state = this.program ? 'stopped' : 'empty'; this.publish();
  }
  async zero({ axis, wcs = 'G54' }) {
    axis = axisName(axis);
    if (!/^G5[4-9]$/.test(wcs)) fail('Work system must be G54–G59.');
    const args = { axis, wcs };
    this.authorize('zero', args, { reserve: false });
    return this.exclusive(async () => {
      this.ready(); this.outputsStopped();
      const context = this.reserveTypedAction('zero', args);
      const guard = this.typedActionGuard(context, { stopped: true });
      const position = { ...this.status.position.machine };
      try {
        const before = await this.typedParameters(guard, [wcs, 'G92', 'TLO']);
        const expected = [...before[wcs]], index = axes.indexOf(axis);
        // Pinned grblHAL G10 L20: WCS = MPos - G92 - active TLO - requested WPos.
        // This F429 profile reports all three TLO axes, in $13=0 millimetres.
        expected[index] = position[axis] - before.G92[index] - before.TLO[index];
        await this.idleAfter(`G10 L20 P${Number(wcs.slice(1)) - 53} ${axis.toUpperCase()}0`, undefined, { beforeSend: guard });
        const after = await this.typedParameters(guard, [wcs, 'G92', 'TLO']);
        if (expected.some((value, i) => Math.abs(after[wcs][i] - value) > 0.001)
          || ['G92', 'TLO'].some(key => before[key].some((value, i) => Math.abs(after[key][i] - value) > 0.001))) fail('Zero offset readback did not match; do not use this work coordinate.');
      } catch (error) { if (this.generation === context.generation) this.faulted(error.message); throw error; }
    });
  }
  async outputs({ spindle = 'off', rpm = 0, coolant = 'off' }) {
    if (!['off', 'cw'].includes(spindle) || !['off', 'flood', 'mist'].includes(coolant)) fail('Invalid output selection.');
    number(rpm, 0, 8000, 'Spindle speed');
    if (spindle === 'cw' && rpm < 1000) fail('Spindle RPM must be at least 1000.');
    const args = { spindle, rpm, coolant };
    this.authorize('outputs', args, { reserve: false });
    return this.exclusive(async () => { this.ready();
      const context = this.reserveTypedAction('outputs', args);
      const guard = this.typedActionGuard(context);
      await this.line(spindle === 'off' ? 'M5' : `M3 S${fmt(rpm)}`, undefined, { beforeSend: guard });
      await this.line('M9', undefined, { beforeSend: guard });
      if (coolant !== 'off') await this.line(coolant === 'flood' ? 'M8' : 'M7', undefined, { beforeSend: guard });
    });
  }
  async probeContact({ axis, distance, sensor = 0, seekFeed = 50, latchFeed = 10, pullOff = 1, confirmedSpindleStopped = false }) {
    axis = axisName(axis);
    if (![0, 1].includes(sensor)) fail('Select touch probe or tool setter.');
    number(distance, sensor === 1 ? -5 : -25, sensor === 1 ? 0 : 25, 'Probe search distance');
    if (Math.abs(distance) < 0.1 || (sensor === 1 && axis !== 'z')) fail('Tool setter requires a downward Z search; minimum search is 0.1 mm.');
    number(seekFeed, 1, 100, 'Probe seek feed');
    number(latchFeed, 1, Math.min(seekFeed, 25), 'Probe latch feed');
    number(pullOff, 0.1, 2, 'Probe pull-off');
    const args = { axis, distance, sensor, seekFeed, latchFeed, pullOff, confirmedSpindleStopped };
    this.authorize('probe', args, { reserve: false });
    const direction = Math.sign(distance);
    return this.exclusive(async () => {
      this.ready();
      if (!confirmedSpindleStopped || this.status.accessories.spindle !== 'off' || this.status.motion.spindleCommand !== 0
        || (this.status.motion.spindleActual !== null && this.status.motion.spindleActual !== 0)) fail('Stop the spindle and confirm the probe path is clear before probing.');
      if (this.status.accessories.flood || this.status.accessories.mist) fail('Turn coolant off before probing.');
      const context = this.reserveTypedAction('probe', args);
      this.lastProbeResult = null;
      const guard = options => this.typedActionGuard(context, { stopped: true, ...options });
      const send = (command, options) => this.line(command, undefined, { beforeSend: guard(options) });
      const checkTarget = delta => {
        const target = this.status.position.machine?.[axis] + delta;
        const envelope = MR1_CONFIG.machineEnvelope[axis];
        if (!Number.isFinite(target) || target < envelope.min || target > envelope.max) fail('Probe move exceeds machine travel.');
      };
      const clear = () => {
        guard({ selectedProbe: sensor })();
        if (this.status.pins.controls.probeDisconnected || this.status.pins.active) fail('Probe input must be connected and released.');
      };
      const retract = async () => {
        const delta = -direction * pullOff; checkTarget(delta);
        const target = { ...this.status.position.machine, [axis]: this.status.position.machine[axis] + delta };
        await this.idleAfter(`G21 G91 G94 G1 ${axis.toUpperCase()}${fmt(delta)} F50`, undefined,
          { target, beforeSend: this.typedActionGuard(context, { stopped: true, selectedProbe: sensor, probeContact: true }, () => checkTarget(delta)) });
        clear();
      };
      const seek = async (delta, rate) => {
        clear(); checkTarget(delta);
        const start = { ...this.status.position.machine };
        if (!axes.every(a => Number.isFinite(start[a]))) fail('Known machine position required for probing.');
        const reports = [];
        const listen = event => { if (this.pending?.written && event?.type === 'probe') reports.push(event); };
        const timeout = Math.ceil(Math.abs(delta) / rate * 60000) + 5000;
        this.on('controller', listen);
        try {
          await this.idleAfter(`G21 G91 G94 G38.2 ${axis.toUpperCase()}${fmt(delta)} F${fmt(rate)}`, timeout,
            { beforeSend: this.typedActionGuard(context, { stopped: true, selectedProbe: sensor }, () => {
              checkTarget(delta); reports.length = 0; this.probe = null;
            }) });
        } finally { this.off('controller', listen); }
        guard({ selectedProbe: sensor, probeContact: true })();
        const hit = reports[0];
        if (reports.length !== 1 || !hit?.success || !axes.every(a => Number.isFinite(hit.position?.[a]))) fail('Controller did not report exactly one successful probe contact.');
        const travel = (hit.position[axis] - start[axis]) * Math.sign(delta);
        if (travel < -0.01 || travel > Math.abs(delta) + 0.01 || axes.some(a => a !== axis && Math.abs(hit.position[a] - start[a]) > 0.01)) fail('Probe contact is outside the commanded search.');
        if (axes.some(a => !Number.isFinite(this.status.position.machine?.[a]) || Math.abs(this.status.position.machine[a] - hit.position[a]) > 0.02)) fail('Stopped machine position does not match the probe contact.');
        return hit.position;
      };
      try {
        const modal = await this.typedModal(guard());
        await send('M70');
        await send('M5'); await send('M9');
        await this.idleAfter(`G65 P5 Q${sensor}`, undefined, { beforeSend: guard() });
        clear();
        const first = await seek(distance, seekFeed);
        await retract();
        const second = await seek(direction * (pullOff + 0.25), latchFeed);
        const difference = Math.abs(second[axis] - first[axis]);
        if (difference > 0.05) fail('Probe repeatability exceeded 0.05 mm. Inspect the probe and setup.');
        await retract();
        if (sensor !== 0) await this.idleAfter('G65 P5 Q0', undefined, { beforeSend: guard({ selectedProbe: sensor }) });
        guard({ selectedProbe: 0 })();
        // The firmware snapshot preserves fractional internal feed; $G reports
        // metric/truncated F and cannot safely reconstruct it under G20.
        await send(`M72 G${modal.motion}`, { selectedProbe: 0 });
        const restored = await this.typedModal(guard({ selectedProbe: 0 }));
        if (Object.keys(modal).some(key => restored[key] !== modal[key])) fail('Probe modal restoration did not verify.');
        await send('M71', { selectedProbe: 0 });
        guard({ selectedProbe: 0 })();
        this.lastProbeResult = { sensor, axis, first, position: second, repeatabilityMm: difference,
          at: new Date(this.now()).toISOString(), units: 'mm', coordinates: 'machine', workOffsetApplied: false };
        this.publish();
        return this.lastProbeResult;
      } catch (error) {
        // No blind recovery move after an unknown contact, alarm or disconnect.
        if (this.generation === context.generation) this.faulted(`Probe stopped: ${error.message}`); throw error;
      }
    });
  }
  loadProgram(source, name = 'program.nc', { airRun = false } = {}) {
    if (this.busy) fail('Stop the active operation before loading another program.');
    if (typeof source !== 'string' || Buffer.byteLength(source) > 5 * 1024 * 1024) fail('Program exceeds 5 MB.');
    // Embedded realtime characters execute immediately even inside comments.
    if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\uffff!?~]/.test(source)) fail('Program contains prohibited control characters.');
    if (typeof airRun !== 'boolean') fail('Choose an explicit program mode.');
    const validation = validateMr1Nc(source, { name, allowSpindleOffMotion: airRun });
    if (!validation.ok) fail(validation.blockers.map(b => `Line ${b.line}: ${b.message}`).join('\n'));
    const lines = source.replace(/\r\n?/g, '\n').split('\n').map(s => parseLine(s, { lineMode: 'stripped' }).line.trim()).filter(Boolean);
    if (!lines.length || lines.some(s => Buffer.byteLength(s) > 120 || s.includes('$'))) fail('Program has an invalid or oversized controller line.');
    for (const line of lines) {
      const words = parseLine(line).words;
      if (words.some(([letter, value]) => letter === 'G' && value === 4)) {
        const dwell = words.find(([letter]) => letter === 'P')?.[1];
        if (!Number.isFinite(dwell) || dwell < 0 || dwell > 3600) fail('Dwell requires P seconds between 0 and 3600.');
      }
    }
    this.program = { name: String(name).slice(0, 160), source, lines, airRun, validation, sha256: createHash('sha256').update(source).digest('hex') };
    this.job = { state: 'loaded', sent: 0, acknowledged: 0, total: lines.length }; this.publish();
    return this.snapshot().program;
  }
  programReady(sha256) {
    this.ready();
    this.outputsStopped();
    if (this.busy) fail('Another operation is active.');
    if (!this.program || sha256 !== this.program.sha256) fail('Reviewed program fingerprint does not match.');
    if (this.job.state !== 'loaded') fail('Reload and review the program before another run.');
    if (this.program.airRun && this.commissioningMode !== 'air-run') fail('A spindle-off program requires a reviewed air-run commissioning session.');
    this.authorize('run', { sha256, source: this.program.source }, { reserve: false });
  }
  async runProgram(sha256) {
    this.programReady(sha256);
    const program = this.program;
    const args = { sha256, source: program.source };
    const permit = this.authorize('run', args);
    const generation = this.generation;
    const continuation = { reserve: false, ...(permit?.reservation ? { reservation: permit.reservation } : {}) };
    const guard = () => {
      if (!this.armed || this.fault || generation !== this.generation || this.program !== program
        || program.source !== args.source || program.sha256 !== sha256) fail('Program cancelled or reviewed identity changed.');
      this.authorize('run', args, continuation);
    };
    return this.exclusive(async () => {
      this.ready();
      if (!this.program || sha256 !== this.program.sha256) fail('Reviewed program fingerprint does not match.');
      if (this.job.state !== 'loaded') fail('Reload and review the program before another run.');
      this.paused = false; this.job.state = 'running';
      try {
        for (const line of program.lines) {
          await this.waitFor(() => { guard(); return !this.paused && ['Idle', 'Run'].includes(this.status?.state.name); }, 24 * 60 * 60 * 1000, generation);
          this.fresh();
          if (!this.armed || generation !== this.generation) fail('Program cancelled.');
          if (!['Idle', 'Run'].includes(this.status.state.name)) fail('Unexpected controller state while sending program.');
          const words = parseLine(line).words;
          if (words.some(([letter, value]) => letter === 'M' && value === 0)) {
            // Set before sending: firmware may acknowledge only after resume.
            this.paused = true; this.job.state = 'paused';
          }
          const dwell = words.some(([letter, value]) => letter === 'G' && value === 4)
            ? words.find(([letter]) => letter === 'P')[1] * 1000 : 0;
          this.job.sent++; this.publish();
          await this.line(line, this.ackTimeout + dwell, { plannerWait: true, beforeSend: () => {
            guard();
            // Hold may arrive after this one line was admitted. It remains a
            // firmware-held line awaiting explicit resume, not a new permit.
            // Do not turn an intentional feed hold into an automatic reset.
            if (!this.status || this.now() - this.lastStatusAt > this.staleMs) fail('Fresh controller status is required.');
            if (!['Idle', 'Run', 'Hold'].includes(this.status.state.name)) fail('Unexpected controller state while sending program.');
          } });
          this.job.acknowledged++; this.publish();
        }
        this.job.state = 'draining';
        const afterAck = this.sequence;
        this.realtime(REALTIME.status);
        await this.waitFor(() => { guard(); return this.sequence > afterAck && this.status?.state.name === 'Idle'; }, 24 * 60 * 60 * 1000, generation);
        this.job.state = 'complete';
      } catch (error) { if (generation === this.generation) this.faulted(error.message); throw error; }
    });
  }
}
