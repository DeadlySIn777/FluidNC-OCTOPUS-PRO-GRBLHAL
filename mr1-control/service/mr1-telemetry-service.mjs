import { createHash, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  controllerPreflightCommand,
  createSimulatedPreflightTranscript,
  evaluateControllerPreflight,
  pendingControllerPreflight,
  summarizeControllerPreflight,
  validateControllerPreflightProfile,
} from "./controller-preflight.mjs";
import {
  JOURNAL_RECONCILIATION_PROTOCOL,
  createEventJournal,
  defaultJournalDirectory,
  disabledJournalReconciliation,
} from "./event-journal.mjs";
import { createFissionProcessor, MAX_FISSION_SOURCE_BYTES } from "./fission-processor.mjs";
import { MachineTransactionCoordinator } from "./machine-transaction-coordinator.mjs";
import { VirtualMr1Controller } from "./virtual-mr1-controller.mjs";
import {
  MACHINE_COMMAND_POLICY,
  MachineCommandError,
  transactionIsTerminal,
} from "../src/machine-command.js";
import {
  CONTROLLER_SETTINGS_PLAN_PROTOCOL,
  validateControllerSettingsApplyRequest,
} from "../src/controller-settings.js";
import { parseChatterSensorLine } from "../src/telemetry/chatter-status.js";
import { parseControllerLine, parseGrblStatus } from "../src/telemetry/grbl-status.js";
import { isSpindleTelemetryLine, parseSpindleTelemetryLine } from "../src/telemetry/spindle-status.js";

// The owner ID is a bearer credential (it authorizes submit/lookup/cancel
// and lease acquisition), so it must never appear in broadcasts, shared
// snapshots, or journal exports. Clients compare this derived tag instead.
export function ownerTagFor(ownerId) {
  return createHash("sha256").update(`mr1-owner-tag:${ownerId}`, "utf8").digest("hex").toUpperCase();
}

function redactTransaction(transaction) {
  if (!transaction || typeof transaction !== "object") return transaction;
  const { ownerId, ...rest } = transaction;
  if (!ownerId) return transaction;
  return { ...rest, ownerTag: ownerTagFor(ownerId) };
}

function redactCommandState(state) {
  if (!state || typeof state !== "object" || !state.owner) return state;
  const { ownerId, ...ownerRest } = state.owner;
  if (!ownerId) return state;
  return { ...state, owner: { ...ownerRest, ownerTag: ownerTagFor(ownerId) } };
}

const LOOPBACK_HOST = "127.0.0.1";
const LAN_HOST = "0.0.0.0";
const DEFAULT_HTTP_PORT = 8787;
const DEFAULT_BAUD_RATE = 115200;
const DEFAULT_SENSOR_BAUD_RATE = 115200;
const DEFAULT_POLL_MS = 100;
const MAX_OPTIMIZER_REQUEST_BYTES = MAX_FISSION_SOURCE_BYTES + 1024 * 1024;
const MAX_SENSOR_COMMAND_REQUEST_BYTES = 512;
const MAX_RECONCILIATION_REQUEST_BYTES = 1024;
const MAX_CONFIGURATION_JOURNAL_REQUEST_BYTES = 8192;
const MAX_MACHINE_COMMAND_REQUEST_BYTES = 8192;
const MAX_CONTROLLER_SETTINGS_REQUEST_BYTES = 16 * 1024;
const STATUS_QUERY = Buffer.from("?", "ascii");
const DEFAULT_ORIGINS = new Set([
  "http://127.0.0.1:5173",
  "http://localhost:5173",
  "http://127.0.0.1:4173",
  "http://localhost:4173",
]);

export const SERIAL_WRITE_POLICY = "status-and-read-only-preflight";
export const SENSOR_WRITE_POLICY = "calibration-only";
export const CONTROLLER_SETTINGS_WRITE_POLICY = "simulation-only-typed-settings";
export const JOURNAL_RECONCILIATION_ACK_PROTOCOL = "mr1-journal-reconciliation-ack-v1";
export const CONFIGURATION_JOURNAL_PROTOCOL = "mr1-browser-configuration-event-v1";
export const LATENCY_PING_PROTOCOL = "mr1-latency-ping-v1";

const CONFIGURATION_CATEGORIES = new Map([
  ["mr1-control.cutter-compensation.v1", "cutter-compensation"],
  ["mr1.fixture-map.v3", "fixture-map"],
  ["mr1-control.fission-import.v1", "fission-import"],
  ["mr1-control.machine-identity.v1", "machine-identity"],
  ["mr1-control.metrology-session.v1", "metrology"],
  ["mr1-control.probe-calibration.v1", "probe-calibration"],
  ["mr1-control.probing-profile.v2", "probing"],
  ["mr1.scene-registration.v1", "scene-registration"],
  ["mr1-control.sensor-wiring-profile.v1", "sensor-wiring"],
  ["mr1-control.wiring-installation.v1", "wiring-evidence"],
]);
const CONFIGURATION_EVENT_KEYS = new Set([
  "protocol",
  "eventId",
  "storageKey",
  "category",
  "action",
  "beforeSha256",
  "afterSha256",
  "changedPaths",
  "changedPathsTruncated",
  "occurredAt",
]);

const SERVICE_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const DEFAULT_PREFLIGHT_PROFILE_PATHS = Object.freeze([
  resolve(SERVICE_DIRECTORY, "../../grblHAL-STM32F4/mr1/expected-settings.json"),
  resolve(SERVICE_DIRECTORY, "../wiring-docs/expected-settings.json"),
]);

async function loadControllerPreflightProfile(explicitPath = null) {
  const candidates = explicitPath ? [resolve(explicitPath)] : DEFAULT_PREFLIGHT_PROFILE_PATHS;
  let lastError = null;
  for (const candidate of candidates) {
    try {
      const profile = JSON.parse(await readFile(candidate, "utf8"));
      return validateControllerPreflightProfile(profile);
    } catch (error) {
      lastError = error;
      if (explicitPath || error?.code !== "ENOENT") throw error;
    }
  }
  throw new Error(`MR-1 controller preflight profile was not found. ${lastError?.message ?? ""}`.trim());
}

export function sensorCalibrationCapabilities(sensor) {
  return {
    start: sensor?.calibration?.commandStartSupported === true,
    clear: sensor?.calibration?.commandClearSupported === true,
    persisted: sensor?.calibration?.persisted === true,
  };
}

export function sensorCalibrationIsAvailable(sensor, transportAvailable) {
  const capabilities = sensorCalibrationCapabilities(sensor);
  return transportAvailable === true && (capabilities.start || capabilities.clear);
}

export function sensorCalibrationCommand(action) {
  if (action === "start") return Buffer.from("CAL\n", "ascii");
  if (action === "clear") return Buffer.from("CAL:CLEAR\n", "ascii");
  return null;
}

export function validateConfigurationJournalEvent(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Configuration journal event must be an object.");
  }
  const unknown = Object.keys(payload).find((key) => !CONFIGURATION_EVENT_KEYS.has(key));
  if (unknown) throw new Error(`Unknown configuration journal field: ${unknown}.`);
  const missing = [...CONFIGURATION_EVENT_KEYS].find((key) => !(key in payload));
  if (missing) throw new Error(`Missing configuration journal field: ${missing}.`);
  if (payload.protocol !== CONFIGURATION_JOURNAL_PROTOCOL) throw new Error("Configuration journal protocol mismatch.");
  if (!/^[A-Za-z0-9_-]{8,120}$/.test(payload.eventId)) throw new Error("Configuration event ID is invalid.");
  const category = CONFIGURATION_CATEGORIES.get(payload.storageKey);
  if (!category || payload.category !== category) throw new Error("Configuration storage key and category do not match.");
  if (!["create", "update", "remove"].includes(payload.action)) throw new Error("Configuration action is invalid.");
  const validHash = (value) => typeof value === "string" && /^[A-F0-9]{64}$/.test(value);
  if (payload.action === "create" && (payload.beforeSha256 !== null || !validHash(payload.afterSha256))) {
    throw new Error("Create evidence requires only an after hash.");
  }
  if (payload.action === "update" && (!validHash(payload.beforeSha256) || !validHash(payload.afterSha256))) {
    throw new Error("Update evidence requires before and after hashes.");
  }
  if (payload.action === "remove" && (!validHash(payload.beforeSha256) || payload.afterSha256 !== null)) {
    throw new Error("Remove evidence requires only a before hash.");
  }
  if (!Array.isArray(payload.changedPaths) || payload.changedPaths.length > 64) {
    throw new Error("Configuration changed paths are invalid.");
  }
  if (payload.changedPaths.some((path) => typeof path !== "string" || !/^[A-Za-z0-9_$.[\]-]{1,160}$/.test(path))) {
    throw new Error("Configuration changed path is invalid.");
  }
  if (typeof payload.changedPathsTruncated !== "boolean") {
    throw new Error("Configuration path truncation flag is invalid.");
  }
  const timestamp = Date.parse(payload.occurredAt);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== payload.occurredAt) {
    throw new Error("Configuration event timestamp is invalid.");
  }
  return Object.freeze({ ...payload, changedPaths: Object.freeze([...payload.changedPaths]) });
}

function sendJson(response, statusCode, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload);
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...extraHeaders,
  });
  response.end(body);
}

function eventFrame(event, payload) {
  return `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
}

function readJsonBody(request, maximumBytes = MAX_OPTIMIZER_REQUEST_BYTES) {
  return new Promise((resolve, reject) => {
    let body = "";
    let bytes = 0;
    let settled = false;
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      if (settled) return;
      bytes += Buffer.byteLength(chunk, "utf8");
      if (bytes > maximumBytes) {
        settled = true;
        reject(Object.assign(new Error("Request body is too large."), { statusCode: 413, code: "REQUEST_TOO_LARGE" }));
        return;
      }
      body += chunk;
    });
    request.on("end", () => {
      if (settled) return;
      settled = true;
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(Object.assign(new Error("Request body must be valid JSON."), { statusCode: 400, code: "INVALID_JSON" }));
      }
    });
    request.on("error", (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
  });
}

function openSerial(serial) {
  return new Promise((resolve, reject) => {
    serial.open((error) => (error ? reject(error) : resolve()));
  });
}

function setSerialSignals(serial) {
  return new Promise((resolve, reject) => {
    serial.set({ dtr: false, rts: false }, (error) => (error ? reject(error) : resolve()));
  });
}

function closeSerial(serial) {
  return new Promise((resolve) => {
    if (!serial?.isOpen) {
      resolve();
      return;
    }
    serial.close(() => resolve());
  });
}

function writeSerialAndDrain(serial, bytes) {
  return new Promise((resolve, reject) => {
    serial.write(bytes, (writeError) => {
      if (writeError) {
        reject(writeError);
        return;
      }
      serial.drain((drainError) => (drainError ? reject(drainError) : resolve()));
    });
  });
}

function closeHttpServer(server) {
  return new Promise((resolve) => {
    if (!server?.listening) {
      resolve();
      return;
    }
    server.close(() => resolve());
  });
}

function listen(server, port, host = LOOPBACK_HOST) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });
}

function validateOptions(options) {
  const mode = options.mode ?? "simulate";
  if (mode !== "simulate" && mode !== "serial") throw new Error("Telemetry mode must be simulate or serial.");
  if (mode === "serial" && !/^COM\d+$/i.test(options.serialPort ?? "")) {
    throw new Error("Serial mode requires an explicit Windows port such as COM3.");
  }
  const pollMs = Number(options.pollMs ?? DEFAULT_POLL_MS);
  if (!Number.isInteger(pollMs) || pollMs < 100 || pollMs > 1000) {
    throw new Error("Status polling must be between 100 and 1000 milliseconds.");
  }
  const httpPort = Number(options.httpPort ?? DEFAULT_HTTP_PORT);
  if (!Number.isInteger(httpPort) || httpPort < 0 || httpPort > 65535) {
    throw new Error("HTTP port must be between 0 and 65535.");
  }
  const httpHost = String(options.httpHost ?? LOOPBACK_HOST);
  if (![LOOPBACK_HOST, LAN_HOST].includes(httpHost)) {
    throw new Error("HTTP host must be 127.0.0.1 or 0.0.0.0.");
  }
  const companionToken = options.companionToken == null ? null : String(options.companionToken);
  if (companionToken !== null && !/^[A-Za-z0-9_-]{32,128}$/.test(companionToken)) {
    throw new Error("Companion token must be 32-128 base64url characters.");
  }
  if (httpHost === LAN_HOST && companionToken === null) {
    throw new Error("LAN telemetry requires an explicit companion token.");
  }
  const baudRate = Number(options.baudRate ?? DEFAULT_BAUD_RATE);
  if (!Number.isInteger(baudRate) || baudRate < 1200 || baudRate > 3_000_000) {
    throw new Error("Controller baud rate must be between 1200 and 3000000.");
  }
  const sensorPort = options.sensorPort?.toUpperCase() ?? null;
  if (sensorPort && !/^COM\d+$/i.test(sensorPort)) {
    throw new Error("Sensor port must be an explicit Windows port such as COM5.");
  }
  const sensorBaudRate = Number(options.sensorBaudRate ?? DEFAULT_SENSOR_BAUD_RATE);
  if (!Number.isInteger(sensorBaudRate) || sensorBaudRate < 1200 || sensorBaudRate > 3_000_000) {
    throw new Error("Sensor baud rate must be between 1200 and 3000000.");
  }
  if (mode === "serial" && sensorPort === options.serialPort?.toUpperCase()) {
    throw new Error("Controller and sensor ports must be different devices.");
  }
  const allowedOrigins = new Set(options.allowedOrigins ?? DEFAULT_ORIGINS);
  for (const origin of allowedOrigins) {
    let parsed;
    try {
      parsed = new URL(origin);
    } catch {
      throw new Error(`Allowed origin is invalid: ${origin}`);
    }
    if (!["http:", "https:"].includes(parsed.protocol) || parsed.origin !== origin) {
      throw new Error(`Allowed origin must be an exact HTTP(S) origin: ${origin}`);
    }
  }
  return {
    mode,
    serialPort: options.serialPort?.toUpperCase() ?? null,
    baudRate,
    sensorPort,
    sensorBaudRate,
    pollMs,
    httpPort,
    httpHost,
    companionToken,
    fissionRoot: options.fissionRoot === false ? false : options.fissionRoot,
    journalDirectory: options.journalDirectory === false || options.journalDirectory === undefined
      ? false
      : resolve(options.journalDirectory),
    allowedOrigins,
  };
}

export function createTelemetryService(options = {}) {
  const config = validateOptions(options);
  const ownerDisconnectGraceMs = Number.isFinite(Number(options.ownerDisconnectGraceMs))
    ? Math.max(0, Math.min(5000, Number(options.ownerDisconnectGraceMs)))
    : 750;
  const fissionProcessor = options.fissionProcessor ?? createFissionProcessor({ rootPath: config.fissionRoot });
  const eventJournal = options.eventJournal ?? createEventJournal({
    directory: config.journalDirectory,
    maxFileBytes: options.journalMaxFileBytes,
    maxFiles: options.journalMaxFiles,
  });
  const clients = new Set();
  const controllerLineListeners = new Set();
  const clientOwners = new WeakMap();
  const ownerDisconnectTimers = new Map();
  const backpressuredClients = new WeakSet();
  const startedAt = new Date().toISOString();
  const startedPerformanceAt = performance.now();
  // Exact Host allow-list against DNS rebinding. A LAN companion reaches this
  // service by the same host name as its allowed page origin.
  const allowedHostNames = new Set([LOOPBACK_HOST, "localhost",
    ...(config.httpHost === LAN_HOST ? [...config.allowedOrigins].map((origin) => new URL(origin).hostname) : [])]);
  const hostAllowed = (host) => {
    const port = httpServer?.address()?.port;
    return typeof host === "string" && Number.isInteger(port)
      && [...allowedHostNames].some((name) => host.toLowerCase() === `${name}:${port}`);
  };
  let httpServer;
  let serial;
  let sensorSerial;
  let serialBuffer = "";
  let sensorBuffer = "";
  let sourceTimer;
  let heartbeatTimer;
  let startupTimer;
  let latestStatus = null;
  let latestSensor = null;
  let latestSpindle = null;
  let latestTransaction = null;
  let virtualController = null;
  const simulatedControllerSettings = new Map();
  let commandCoordinator = null;
  let controllerPreflightProfile = options.controllerPreflightProfile
    ? validateControllerPreflightProfile(options.controllerPreflightProfile)
    : null;
  let controllerPreflightReport = pendingControllerPreflight();
  let controllerPreflight = summarizeControllerPreflight(controllerPreflightReport);
  let sequence = 0;
  let sensorSequence = 0;
  let spindleSequence = 0;
  let journalSequence = 0;
  let browserConfigurationJournal = {
    protocol: CONFIGURATION_JOURNAL_PROTOCOL,
    sessionEvents: 0,
    lastCategory: null,
    lastAction: null,
    lastEventAt: null,
    physicalMotionPermitted: false,
  };
  let lastSensorCommandAt = -Infinity;
  let lastJournalStatusAt = -Infinity;
  let lastJournalMachineState = null;
  let lastJournalSensorState = null;
  let lastJournalSpindleState = null;
  let stopping = false;
  let reconciliationAcknowledgementBusy = false;
  let reconciliationAcknowledgedAt = null;
  let restartReconciliation = eventJournal.status().enabled
    ? {
        protocol: JOURNAL_RECONCILIATION_PROTOCOL,
        reconciliationId: null,
        state: "PENDING",
        integrity: "PENDING",
        history: "PENDING",
        previousSessionId: null,
        unfinishedCount: 0,
        requiresReview: false,
        reviewable: false,
        commandInterlock: "HELD",
        message: "CHECKING PREVIOUS JOURNAL SESSION",
        physicalMotionPermitted: false,
      }
    : disabledJournalReconciliation();

  const restartReconciliationSnapshot = () => {
    const acknowledged = Boolean(
      reconciliationAcknowledgedAt
      && restartReconciliation.reviewable === true
      && config.mode === "simulate",
    );
    const commandInterlock = restartReconciliation.requiresReview === true && !acknowledged
      ? "HELD"
      : "CLEAR";
    return {
      ...restartReconciliation,
      acknowledged,
      acknowledgedAt: acknowledged ? reconciliationAcknowledgedAt : null,
      acknowledgeable: config.mode === "simulate"
        && restartReconciliation.reviewable === true
        && !acknowledged,
      commandInterlock,
      physicalMotionPermitted: false,
    };
  };

  let bridge = {
    service: "mr1-telemetry",
    mode: config.mode,
    connected: false,
    serialPort: config.serialPort,
    baudRate: config.mode === "serial" ? config.baudRate : null,
    pollMs: config.mode === "serial" ? config.pollMs : 100,
    companion: {
      protocol: "mr1-companion-access-v1",
      lanEnabled: config.httpHost === LAN_HOST,
      pairingRequired: config.companionToken !== null,
      commandScope: config.mode === "simulate" ? "virtual-only" : "telemetry-only",
      physicalMotionPermitted: false,
    },
    readOnly: true,
    serialWritePolicy: SERIAL_WRITE_POLICY,
    sensorPort: config.sensorPort,
    sensorConnected: false,
    sensorBaudRate: config.sensorPort ? config.sensorBaudRate : null,
    sensorWritePolicy: SENSOR_WRITE_POLICY,
    controllerSettings: {
      protocol: CONTROLLER_SETTINGS_PLAN_PROTOCOL,
      policy: CONTROLLER_SETTINGS_WRITE_POLICY,
      simulatedApplyEnabled: config.mode === "simulate",
      physicalApplyEnabled: false,
    },
    sensorCalibrationTransportAvailable: false,
    sensorCalibrationAvailable: false,
    machineCommands: {
      policy: MACHINE_COMMAND_POLICY,
      enabled: config.mode === "simulate",
      physicalEnabled: false,
      allowedIntents: ["apply-work-offset", "jog", "tool-setter", "touch-probe"],
      owner: null,
      activeTransactionId: null,
      queueDepth: 0,
      lastTransaction: null,
    },
    controllerPreflight,
    journal: eventJournal.status(),
    browserConfigurationJournal,
    restartReconciliation: restartReconciliationSnapshot(),
    journalExportUrl: null,
    startedAt,
  };

  const dropClient = (response) => {
    clients.delete(response);
    const ownerId = clientOwners.get(response);
    if (!ownerId || stopping) return;
    if ([...clients].some((client) => clientOwners.get(client) === ownerId)) return;
    clearTimeout(ownerDisconnectTimers.get(ownerId));
    ownerDisconnectTimers.set(ownerId, setTimeout(() => {
      ownerDisconnectTimers.delete(ownerId);
      if (stopping || [...clients].some((client) => clientOwners.get(client) === ownerId)) return;
      try {
        // Cancel the active transaction AND everything the disconnected
        // owner still has queued; queued work must not run unattended.
        commandCoordinator?.cancelAllForOwner(ownerId, "owner-disconnected");
      } catch {
        // Transactions may have completed during the disconnect grace window.
      }
    }, ownerDisconnectGraceMs));
  };

  const writeClient = (response, frame) => {
    if (response.destroyed || response.writableEnded) {
      dropClient(response);
      return false;
    }
    if (backpressuredClients.has(response)) return false;
    try {
      if (!response.write(frame)) {
        backpressuredClients.add(response);
        response.once("drain", () => backpressuredClients.delete(response));
      }
      return true;
    } catch {
      dropClient(response);
      response.destroy();
      return false;
    }
  };

  const sendClientEvent = (response, event, payload) => writeClient(response, eventFrame(event, payload));

  const broadcast = (event, payload) => {
    for (const response of [...clients]) {
      sendClientEvent(response, event, payload);
    }
  };

  const journalEvent = (kind, payload, writeOptions = {}) => {
    void eventJournal.append(kind, payload, writeOptions).then((record) => {
      if (!record) return;
      const status = {
        ...eventJournal.status(),
        sequence: ++journalSequence,
        bridgePublishedAt: new Date().toISOString(),
      };
      bridge = { ...bridge, journal: status };
      broadcast("journal", status);
    });
  };

  const updateBridge = (changes) => {
    bridge = {
      ...bridge,
      ...changes,
      journal: eventJournal.status(),
      changedAt: new Date().toISOString(),
    };
    broadcast("bridge", bridge);
  };

  const publishControllerPreflight = (report) => {
    controllerPreflightReport = report;
    controllerPreflight = summarizeControllerPreflight(report);
    journalEvent("controller.preflight", controllerPreflight, { sync: true });
    updateBridge({ controllerPreflight });
  };

  const captureReadOnlyControllerResponse = (command) => {
    const bytes = controllerPreflightCommand(command);
    if (!bytes) return Promise.reject(new Error(`Unsafe controller preflight command rejected: ${command}`));
    const timeoutMs = command === "?" ? 1500 : 3000;
    return new Promise((resolveResponse, rejectResponse) => {
      const lines = [];
      let settled = false;
      let timer;
      const finish = (timedOut = false) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        controllerLineListeners.delete(onLine);
        resolveResponse({ command, lines, timedOut });
      };
      const fail = (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        controllerLineListeners.delete(onLine);
        rejectResponse(error);
      };
      const onLine = (line) => {
        lines.push(line);
        if (command === "?" ? /^<[^>]+>$/.test(line) : /^(?:ok|error:\d+)$/i.test(line)) finish(false);
      };
      controllerLineListeners.add(onLine);
      timer = setTimeout(() => finish(true), timeoutMs);
      writeSerialAndDrain(serial, bytes).catch(fail);
    });
  };

  const runReadOnlyControllerPreflight = async () => {
    const sections = [];
    for (const command of controllerPreflightProfile.readOnlyQueries) {
      const response = await captureReadOnlyControllerResponse(command);
      sections.push(`===== ${command} =====`);
      sections.push(...response.lines);
      if (response.timedOut) sections.push(`[PREFLIGHT_TIMEOUT:${command}]`);
    }
    const transcript = sections.join("\r\n");
    return evaluateControllerPreflight(transcript, controllerPreflightProfile, {
      source: `serial:${config.serialPort}@${config.baudRate}`,
    });
  };

  const publishEnvelope = (payload, nextSequence, receivedPerformanceAt) => ({
    ...payload,
    sequence: nextSequence,
    bridgeMode: config.mode,
    bridgePublishedAt: new Date().toISOString(),
    bridgeProcessingMs: Math.round(
      Math.max(0, performance.now() - receivedPerformanceAt) * 1000,
    ) / 1000,
  });

  const publishStatus = (status, receivedPerformanceAt = performance.now()) => {
    if (!status) return;
    latestStatus = publishEnvelope(status, ++sequence, receivedPerformanceAt);
    broadcast("telemetry", latestStatus);
    const stateKey = `${status.state?.name ?? "unknown"}:${status.state?.substate ?? ""}`;
    if (stateKey !== lastJournalMachineState || receivedPerformanceAt - lastJournalStatusAt >= 5000) {
      lastJournalMachineState = stateKey;
      lastJournalStatusAt = receivedPerformanceAt;
      journalEvent("telemetry.snapshot", {
        state: status.state,
        position: status.position,
        motion: status.motion,
        line: status.line,
        pins: status.pins,
        accessories: status.accessories,
        overrides: status.overrides,
        workCoordinateSystem: status.workCoordinateSystem,
        tool: status.tool,
        activeProbe: status.activeProbe,
        homing: status.homing,
      });
    }
  };

  const publishSensor = (sensor, receivedPerformanceAt = performance.now()) => {
    if (!sensor) return;
    latestSensor = publishEnvelope(sensor, ++sensorSequence, receivedPerformanceAt);
    const transportAvailable = sensorSerial?.isOpen === true;
    const calibrationAvailable = sensorCalibrationIsAvailable(sensor, transportAvailable);
    if (
      bridge.sensorCalibrationTransportAvailable !== transportAvailable
      || bridge.sensorCalibrationAvailable !== calibrationAvailable
    ) {
      updateBridge({
        sensorCalibrationTransportAvailable: transportAvailable,
        sensorCalibrationAvailable: calibrationAvailable,
      });
    }
    broadcast("sensor", latestSensor);
    const sensorState = JSON.stringify({
      firmwareVersion: sensor.firmwareVersion,
      state: sensor.state,
      health: sensor.health,
      calibrated: sensor.calibrated,
      storageState: sensor.calibration?.storageState ?? null,
      generation: sensor.calibration?.generation ?? null,
    });
    if (sensorState !== lastJournalSensorState) {
      lastJournalSensorState = sensorState;
      journalEvent("sensor.state", JSON.parse(sensorState));
    }
  };

  const publishSpindle = (spindle, receivedPerformanceAt = performance.now()) => {
    if (!spindle) return;
    latestSpindle = publishEnvelope(spindle, ++spindleSequence, receivedPerformanceAt);
    broadcast("spindle", latestSpindle);
    const spindleState = JSON.stringify({
      state: spindle.state,
      mode: spindle.mode,
      controlPath: spindle.controlPath,
      alarmActive: spindle.signals?.alarmActive,
      alarmCode: spindle.alarmCode,
      errorCount: spindle.health?.errorCount,
      commissioning: spindle.commissioning,
      permits: spindle.permits,
    });
    if (spindleState !== lastJournalSpindleState) {
      lastJournalSpindleState = spindleState;
      journalEvent(spindle.signals?.alarmActive ? "spindle.alarm" : "spindle.state", JSON.parse(spindleState), {
        sync: spindle.signals?.alarmActive === true,
      });
    }
  };

  const handleControllerLine = (line) => {
    const receivedAt = new Date().toISOString();
    const receivedPerformanceAt = performance.now();
    const spindle = parseSpindleTelemetryLine(line, receivedAt);
    if (spindle) {
      publishSpindle(spindle, receivedPerformanceAt);
      return;
    }
    if (isSpindleTelemetryLine(line)) {
      const protocolError = {
        type: "protocol-error",
        source: "spindle",
        message: "Rejected malformed or out-of-range MR1SP report.",
        receivedAt,
        bridgePublishedAt: new Date().toISOString(),
      };
      broadcast("controller", protocolError);
      journalEvent("controller.protocol-error", protocolError, { sync: true });
      return;
    }
    const event = parseControllerLine(line, latestStatus, { receivedAt });
    if (!event) return;
    if (event.type === "status") publishStatus(event.status, receivedPerformanceAt);
    else {
      const publishedEvent = { ...event, receivedAt, bridgePublishedAt: new Date().toISOString() };
      broadcast("controller", publishedEvent);
      journalEvent(`controller.${event.type}`, publishedEvent, {
        sync: event.type === "alarm" || event.type === "error" || event.type === "probe",
      });
    }
  };

  const ingestSerialChunk = (chunk) => {
    serialBuffer += chunk.toString("utf8");
    if (serialBuffer.length > 65_536) serialBuffer = serialBuffer.slice(-32_768);
    const lines = serialBuffer.split(/\r?\n/);
    serialBuffer = lines.pop() ?? "";
    for (const line of lines) {
      const normalized = line.trim();
      if (normalized) {
        for (const listener of [...controllerLineListeners]) listener(normalized);
      }
      handleControllerLine(line);
    }
  };

  const ingestSensorChunk = (chunk) => {
    sensorBuffer += chunk.toString("utf8");
    if (sensorBuffer.length > 65_536) sensorBuffer = sensorBuffer.slice(-32_768);
    const lines = sensorBuffer.split(/\r?\n/);
    sensorBuffer = lines.pop() ?? "";
    for (const line of lines) {
      const receivedAt = new Date().toISOString();
      const receivedPerformanceAt = performance.now();
      const sensor = parseChatterSensorLine(line, { receivedAt });
      if (sensor) publishSensor(sensor, receivedPerformanceAt);
    }
  };

  if (config.mode === "simulate") {
    virtualController = new VirtualMr1Controller({
      phaseDelayMs: options.virtualPhaseDelayMs,
      publishStatus: (line) => handleControllerLine(line),
      publishControllerLine: (line) => handleControllerLine(line),
    });
  }

  commandCoordinator = new MachineTransactionCoordinator({
    mode: config.mode,
    enabled: config.mode === "simulate",
    physicalEnabled: false,
    executor: virtualController,
    getTelemetry: () => latestStatus,
    publish: (transaction, commandState) => {
      const shared = redactTransaction(transaction);
      latestTransaction = shared;
      broadcast("transaction", shared);
      journalEvent("machine.transaction", shared, {
        sync: transactionIsTerminal(transaction),
      });
      updateBridge({ machineCommands: redactCommandState(commandState) });
    },
  });
  bridge.machineCommands = redactCommandState(commandCoordinator.snapshot());

  const requestStatus = () => {
    if (!serial?.isOpen || stopping) return;
    serial.write(STATUS_QUERY, (error) => {
      if (error) updateBridge({ connected: false, error: error.message });
    });
  };

  const startSimulation = () => {
    const simulationStart = performance.now();
    let lastSensorPublishedAt = -Infinity;
    const update = () => {
      const receivedAt = new Date().toISOString();
      const receivedPerformanceAt = performance.now();
      const seconds = (performance.now() - simulationStart) / 1000;
      const phase = seconds * 0.55;
      const raw = virtualController.statusLine();
      publishStatus(
        parseGrblStatus(raw, latestStatus, { receivedAt }),
        receivedPerformanceAt,
      );
      const torque = 0;
      const actualRpm = 0;
      const motorRpm = 0;
      const encoderRpm = 0;
      publishSpindle(
        parseSpindleTelemetryLine(
          `[MR1SP|V:1|ST:zero_speed|MODE:speed|PATH:digital|CMD:0|MRPM:${motorRpm.toFixed(1)}|CRPM:${actualRpm.toFixed(1)}|ERPM:${encoderRpm.toFixed(1)}|TQ:${torque.toFixed(1)}|CUR:0.0|PKCUR:0.0|LOAD:0.0|REGEN:0.0|RDY:1|ALM:0|SON:1|ASP:0|ZSP:1|COIN:0|PTOS:0|AC:0|MBAGE:18|ENCAGE:4|IDXAGE:9|ERRS:0|RATIO:2.0000|DIFF:0.00|STAGE:2|APPROVED:0|PROFILE:-|MBR:0|MBW:0|M3OK:0|M4OK:0|M5OK:0|M19OK:0]`,
          receivedAt,
        ),
        receivedPerformanceAt,
      );
      if (!config.sensorPort && receivedPerformanceAt - lastSensorPublishedAt >= 200) {
        lastSensorPublishedAt = receivedPerformanceAt;
        const score = 18 + Math.abs(Math.sin(phase * 1.3)) * 24;
        const deviceUptimeMs = Math.round(performance.now() - startedPerformanceAt);
        publishSensor({
          protocol: "mr1-chatter-v1",
          schemaVersion: 2,
          firmwareVersion: "7.6-mr1-sim",
          receivedAt,
          deviceReportSequence: sensorSequence + 1,
          deviceSampleSequence: (sensorSequence + 1) * 4,
          deviceUptimeMs,
          deviceSampleUptimeMs: Math.max(0, deviceUptimeMs - 5),
          deviceSampleAgeMs: 5,
          processingMs: 66 + Math.sin(phase * 0.3) * 2,
          score,
          state: score >= 40 ? "warning" : "ok",
          calibrated: true,
          frequencyHz: 1240 + Math.sin(phase) * 80,
          vibrationG: 0.03 + score / 1000,
          rotationDps: 1.2 + score / 20,
          espTemperatureC: 40.5 + Math.sin(phase * 0.15),
          spindleTemperatureC: 34.5 + Math.sin(phase * 0.2),
          sensorTemperatureC: 34.5 + Math.sin(phase * 0.2),
          temperatureSource: "spindle-surface",
          batteryPercent: null,
          batteryVoltage: null,
          charging: false,
          components: { microphone: score, accelerometer: score * 0.8, gyroscope: score * 0.45 },
          acceleration: null,
          gyroscope: null,
          health: {
            imu: true,
            audio: true,
            externalTemperature: true,
            imuSamples: 64,
            freeHeapBytes: 612_000,
            minimumFreeHeapBytes: 548_000,
          },
          dsp: {
            audioTotalEnergy: 120_000 + score * 900,
            audioBandEnergy: 18_000 + score * 400,
            sampleRateHz: 16_000,
            fftSize: 1024,
            imuRateHz: 897,
          },
          calibration: {
            active: false,
            count: 50,
            total: 50,
            progress: 1,
            settleRemainingMs: 0,
            commandStartSupported: true,
            commandClearSupported: true,
            persisted: true,
            storageState: "valid",
            lastResult: "loaded",
            lastReason: "none",
            generation: 3,
            validSlots: 2,
            baselineVibrationG: 0.018,
            baselineRotationDps: 1.1,
            baselineMicrophoneScore: 2.8,
            vibrationStdDevG: 0.0018,
            rotationStdDevDps: 0.12,
            microphoneStdDevScore: 0.7,
          },
          thresholds: { warningScore: 40, chatterScore: 70 },
          network: { wifiConnected: false, ipAddress: null },
        }, receivedPerformanceAt);
      }
    };
    const simulatedPreflight = controllerPreflightProfile
      ? evaluateControllerPreflight(
        createSimulatedPreflightTranscript(controllerPreflightProfile, undefined, simulatedControllerSettings),
        controllerPreflightProfile,
        { simulated: true, source: "simulation" },
      )
      : pendingControllerPreflight("ERROR", "The expected MR-1 controller profile could not be loaded.");
    controllerPreflightReport = simulatedPreflight;
    controllerPreflight = summarizeControllerPreflight(simulatedPreflight);
    journalEvent("controller.preflight", controllerPreflight, { sync: true });
    updateBridge({
      connected: true,
      label: "VIRTUAL MR-1",
      sensorConnected: !config.sensorPort,
      sensorSource: config.sensorPort ? config.sensorPort : "simulation",
      machineCommands: redactCommandState(commandCoordinator.snapshot()),
      controllerPreflight,
    });
    update();
    sourceTimer = setInterval(update, 100);
  };

  const startSerial = async () => {
    const { SerialPort } = await import("serialport");
    serial = new SerialPort({
      path: config.serialPort,
      baudRate: config.baudRate,
      dataBits: 8,
      stopBits: 1,
      parity: "none",
      lock: true,
      rtscts: false,
      xon: false,
      xoff: false,
      xany: false,
      hupcl: false,
      autoOpen: false,
    });
    serial.on("data", ingestSerialChunk);
    serial.on("error", (error) => {
      journalEvent("service.controller-error", { message: error.message }, { sync: true });
      updateBridge({ connected: false, error: error.message });
    });
    serial.on("close", () => {
      clearInterval(sourceTimer);
      if (!stopping) {
        journalEvent("service.controller-disconnect", { serialPort: config.serialPort }, { sync: true });
        updateBridge({ connected: false, error: "Serial port closed." });
      }
    });
    await openSerial(serial);
    await setSerialSignals(serial);
    const runningPreflight = pendingControllerPreflight("RUNNING", "Reading board identity and controller settings.");
    controllerPreflightReport = runningPreflight;
    controllerPreflight = summarizeControllerPreflight(runningPreflight);
    updateBridge({
      connected: true,
      label: config.serialPort,
      error: null,
      controllerPreflight,
    });
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 350));
    if (controllerPreflightProfile) {
      publishControllerPreflight(await runReadOnlyControllerPreflight());
    } else {
      publishControllerPreflight(pendingControllerPreflight("ERROR", "The expected MR-1 controller profile could not be loaded."));
    }
    startupTimer = setTimeout(requestStatus, 100);
    sourceTimer = setInterval(requestStatus, config.pollMs);
  };

  const startSensor = async () => {
    const { SerialPort } = await import("serialport");
    sensorSerial = new SerialPort({
      path: config.sensorPort,
      baudRate: config.sensorBaudRate,
      dataBits: 8,
      stopBits: 1,
      parity: "none",
      lock: true,
      rtscts: false,
      xon: false,
      xoff: false,
      xany: false,
      hupcl: false,
      autoOpen: false,
    });
    sensorSerial.on("data", ingestSensorChunk);
    sensorSerial.on("error", (error) => {
      journalEvent("service.sensor-error", { message: error.message }, { sync: true });
      updateBridge({
        sensorConnected: false,
        sensorCalibrationTransportAvailable: false,
        sensorCalibrationAvailable: false,
        sensorError: error.message,
      });
    });
    sensorSerial.on("close", () => {
      if (!stopping) {
        journalEvent("service.sensor-disconnect", { sensorPort: config.sensorPort }, { sync: true });
        updateBridge({
          sensorConnected: false,
          sensorCalibrationTransportAvailable: false,
          sensorCalibrationAvailable: false,
          sensorError: "Sensor serial port closed.",
        });
      }
    });
    await openSerial(sensorSerial);
    updateBridge({
      sensorConnected: true,
      sensorCalibrationTransportAvailable: true,
      sensorCalibrationAvailable: false,
      sensorSource: config.sensorPort,
      sensorError: null,
    });
  };

  const handleSensorCalibrationRequest = async (request, response) => {
    const origin = request.headers.origin;
    if (!origin || !config.allowedOrigins.has(origin)) {
      sendJson(response, 403, { error: "Origin not allowed.", code: "ORIGIN_DENIED" });
      return;
    }
    const corsHeaders = {
      "Access-Control-Allow-Origin": origin,
      Vary: "Origin",
      "Cross-Origin-Resource-Policy": "same-site",
    };
    if (request.method === "OPTIONS") {
      response.writeHead(204, {
        ...corsHeaders,
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Max-Age": "600",
      });
      response.end();
      return;
    }
    if (request.method !== "POST") {
      sendJson(response, 405, { error: "Method not allowed." }, { ...corsHeaders, Allow: "POST, OPTIONS" });
      return;
    }
    const contentLength = Number(request.headers["content-length"] ?? 0);
    if (Number.isFinite(contentLength) && contentLength > MAX_SENSOR_COMMAND_REQUEST_BYTES) {
      sendJson(response, 413, { error: "Request body is too large.", code: "REQUEST_TOO_LARGE" }, corsHeaders);
      request.resume();
      return;
    }

    try {
      const payload = await readJsonBody(request, MAX_SENSOR_COMMAND_REQUEST_BYTES);
      const command = sensorCalibrationCommand(payload?.action);
      if (!command) {
        sendJson(response, 400, {
          error: "Calibration action must be start or clear.",
          code: "INVALID_SENSOR_ACTION",
        }, corsHeaders);
        return;
      }
      if (!sensorSerial?.isOpen) {
        sendJson(response, 409, {
          error: "A physical ESP32 sensor port is not connected.",
          code: "SENSOR_UNAVAILABLE",
        }, corsHeaders);
        return;
      }
      const capability = payload.action === "start"
        ? latestSensor?.calibration?.commandStartSupported
        : latestSensor?.calibration?.commandClearSupported;
      if (capability !== true) {
        sendJson(response, 409, {
          error: "Connected sensor firmware does not advertise this calibration command.",
          code: "SENSOR_COMMAND_UNSUPPORTED",
        }, corsHeaders);
        return;
      }
      const now = performance.now();
      if (now - lastSensorCommandAt < 750) {
        sendJson(response, 429, {
          error: "A sensor calibration request was just sent.",
          code: "SENSOR_COMMAND_RATE_LIMIT",
        }, { ...corsHeaders, "Retry-After": "1" });
        return;
      }
      await writeSerialAndDrain(sensorSerial, command);
      lastSensorCommandAt = performance.now();
      journalEvent("sensor.calibration-command", {
        action: payload.action,
        sensorPort: config.sensorPort,
        accepted: true,
      }, { sync: true });
      sendJson(response, 202, {
        accepted: true,
        action: payload.action,
        sensorPort: config.sensorPort,
        writePolicy: SENSOR_WRITE_POLICY,
      }, corsHeaders);
    } catch (error) {
      sendJson(response, Number(error?.statusCode) || 503, {
        error: error instanceof Error ? error.message : String(error),
        code: error?.code ?? "SENSOR_COMMAND_FAILED",
      }, corsHeaders);
    }
  };

  const handleControllerSettingsRequest = async (request, response) => {
    const origin = request.headers.origin;
    if (!origin || !config.allowedOrigins.has(origin)) {
      sendJson(response, 403, { error: "Origin not allowed.", code: "ORIGIN_DENIED" });
      return;
    }
    const corsHeaders = {
      "Access-Control-Allow-Origin": origin,
      Vary: "Origin",
      "Cross-Origin-Resource-Policy": "same-site",
    };
    if (request.method === "OPTIONS") {
      response.writeHead(204, {
        ...corsHeaders,
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Max-Age": "600",
      });
      response.end();
      return;
    }
    if (request.method !== "POST") {
      sendJson(response, 405, { error: "Method not allowed." }, { ...corsHeaders, Allow: "POST, OPTIONS" });
      return;
    }
    if (config.mode !== "simulate") {
      sendJson(response, 423, {
        error: "Physical controller setting writes remain locked until commissioned write transactions are implemented.",
        code: "PHYSICAL_SETTINGS_LOCKED",
        policy: CONTROLLER_SETTINGS_WRITE_POLICY,
        physicalApplyEnabled: false,
      }, corsHeaders);
      request.resume();
      return;
    }
    try {
      const payload = await readJsonBody(request, MAX_CONTROLLER_SETTINGS_REQUEST_BYTES);
      const plan = validateControllerSettingsApplyRequest(payload, controllerPreflightReport);
      for (const change of plan.changes) simulatedControllerSettings.set(change.id, change.value);
      const report = evaluateControllerPreflight(
        createSimulatedPreflightTranscript(controllerPreflightProfile, undefined, simulatedControllerSettings),
        controllerPreflightProfile,
        { simulated: true, source: "simulation" },
      );
      journalEvent("controller.settings-simulation", {
        protocol: plan.protocol,
        baseTranscriptSha256: plan.baseTranscriptSha256,
        resultingTranscriptSha256: report.transcriptSha256,
        changes: plan.changes,
        physicalApplyEnabled: false,
      }, { sync: true });
      publishControllerPreflight(report);
      sendJson(response, 200, {
        accepted: true,
        applied: plan.changes.length,
        report,
        policy: CONTROLLER_SETTINGS_WRITE_POLICY,
        physicalApplyEnabled: false,
      }, corsHeaders);
    } catch (error) {
      sendJson(response, Number(error?.statusCode) || 400, {
        error: error instanceof Error ? error.message : String(error),
        code: error?.code ?? "CONTROLLER_SETTINGS_REJECTED",
        policy: CONTROLLER_SETTINGS_WRITE_POLICY,
        physicalApplyEnabled: false,
      }, corsHeaders);
    }
  };

  const handleMachineTransactionRequest = async (request, response, url) => {
    const origin = request.headers.origin;
    if (!origin || !config.allowedOrigins.has(origin)) {
      sendJson(response, 403, { error: "Origin not allowed.", code: "ORIGIN_DENIED" });
      return;
    }
    const corsHeaders = {
      "Access-Control-Allow-Origin": origin,
      Vary: "Origin",
      "Cross-Origin-Resource-Policy": "same-site",
    };
    if (request.method === "OPTIONS") {
      response.writeHead(204, {
        ...corsHeaders,
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Max-Age": "600",
      });
      response.end();
      return;
    }
    if (request.method === "GET") {
      try {
        const allowedParameters = new Set(["ownerId", "transactionId", "pair"]);
        const unknownParameter = [...url.searchParams.keys()].find((key) => !allowedParameters.has(key));
        if (unknownParameter) {
          sendJson(response, 400, {
            error: `Unknown transaction query field: ${unknownParameter}.`,
            code: "INVALID_TRANSACTION_QUERY",
          }, corsHeaders);
          return;
        }
        const ownerId = String(url.searchParams.get("ownerId") ?? "");
        const transactionId = String(url.searchParams.get("transactionId") ?? "");
        if (!/^[A-Za-z0-9_-]{8,80}$/.test(ownerId) || !/^[A-Za-z0-9_-]{8,120}$/.test(transactionId)) {
          sendJson(response, 400, {
            error: "Valid ownerId and transactionId are required.",
            code: "INVALID_TRANSACTION_QUERY",
          }, corsHeaders);
          return;
        }
        sendJson(response, 200, {
          transaction: redactTransaction(commandCoordinator.lookup(ownerId, transactionId)),
          machineCommands: redactCommandState(commandCoordinator.snapshot()),
        }, corsHeaders);
      } catch (error) {
        sendJson(response, error instanceof MachineCommandError ? error.statusCode : 503, {
          error: error instanceof Error ? error.message : String(error),
          code: error?.code ?? "TRANSACTION_LOOKUP_FAILED",
        }, corsHeaders);
      }
      return;
    }
    if (request.method !== "POST") {
      sendJson(response, 405, { error: "Method not allowed." }, { ...corsHeaders, Allow: "GET, POST, OPTIONS" });
      return;
    }
    const contentLength = Number(request.headers["content-length"] ?? 0);
    if (Number.isFinite(contentLength) && contentLength > MAX_MACHINE_COMMAND_REQUEST_BYTES) {
      sendJson(response, 413, { error: "Request body is too large.", code: "REQUEST_TOO_LARGE" }, corsHeaders);
      request.resume();
      return;
    }
    try {
      const payload = await readJsonBody(request, MAX_MACHINE_COMMAND_REQUEST_BYTES);
      const result = commandCoordinator.submit(payload);
      sendJson(response, result.duplicate ? 200 : 202, {
        accepted: !result.duplicate,
        duplicate: result.duplicate,
        transaction: redactTransaction(result.transaction),
        machineCommands: redactCommandState(commandCoordinator.snapshot()),
      }, corsHeaders);
    } catch (error) {
      const statusCode = error instanceof MachineCommandError
        ? error.statusCode
        : Number(error?.statusCode) || 503;
      sendJson(response, statusCode, {
        error: error instanceof Error ? error.message : String(error),
        code: error?.code ?? "MACHINE_TRANSACTION_FAILED",
        details: error?.details ?? null,
        machineCommands: redactCommandState(commandCoordinator.snapshot()),
      }, corsHeaders);
    }
  };

  const handleMachineCancelRequest = async (request, response) => {
    const origin = request.headers.origin;
    if (!origin || !config.allowedOrigins.has(origin)) {
      sendJson(response, 403, { error: "Origin not allowed.", code: "ORIGIN_DENIED" });
      return;
    }
    const corsHeaders = {
      "Access-Control-Allow-Origin": origin,
      Vary: "Origin",
      "Cross-Origin-Resource-Policy": "same-site",
    };
    if (request.method === "OPTIONS") {
      response.writeHead(204, {
        ...corsHeaders,
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Max-Age": "600",
      });
      response.end();
      return;
    }
    if (request.method !== "POST") {
      sendJson(response, 405, { error: "Method not allowed." }, { ...corsHeaders, Allow: "POST, OPTIONS" });
      return;
    }
    try {
      const payload = await readJsonBody(request, MAX_MACHINE_COMMAND_REQUEST_BYTES);
      const ownerId = String(payload?.ownerId ?? "");
      const transactionId = String(payload?.transactionId ?? "");
      if (!/^[A-Za-z0-9_-]{8,80}$/.test(ownerId) || !/^[A-Za-z0-9_-]{8,120}$/.test(transactionId)) {
        sendJson(response, 400, {
          error: "Valid ownerId and transactionId are required.",
          code: "INVALID_CANCEL_REQUEST",
        }, corsHeaders);
        return;
      }
      const transaction = commandCoordinator.cancel(ownerId, transactionId);
      sendJson(response, transactionIsTerminal(transaction) ? 200 : 202, {
        accepted: true,
        transaction: redactTransaction(transaction),
        machineCommands: redactCommandState(commandCoordinator.snapshot()),
      }, corsHeaders);
    } catch (error) {
      sendJson(response, error instanceof MachineCommandError ? error.statusCode : 503, {
        error: error instanceof Error ? error.message : String(error),
        code: error?.code ?? "MACHINE_CANCEL_FAILED",
        details: error?.details ?? null,
        machineCommands: redactCommandState(commandCoordinator.snapshot()),
      }, corsHeaders);
    }
  };

  const handleFissionRequest = async (request, response) => {
    const origin = request.headers.origin;
    if (!origin || !config.allowedOrigins.has(origin)) {
      sendJson(response, 403, { error: "Origin not allowed.", code: "ORIGIN_DENIED" });
      return;
    }
    const corsHeaders = {
      "Access-Control-Allow-Origin": origin,
      Vary: "Origin",
      "Cross-Origin-Resource-Policy": "same-site",
    };
    if (request.method === "OPTIONS") {
      response.writeHead(204, {
        ...corsHeaders,
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Max-Age": "600",
      });
      response.end();
      return;
    }
    if (request.method !== "POST") {
      sendJson(response, 405, { error: "Method not allowed." }, { ...corsHeaders, Allow: "POST, OPTIONS" });
      return;
    }
    const contentLength = Number(request.headers["content-length"] ?? 0);
    if (Number.isFinite(contentLength) && contentLength > MAX_OPTIMIZER_REQUEST_BYTES) {
      sendJson(response, 413, { error: "Request body is too large.", code: "REQUEST_TOO_LARGE" }, corsHeaders);
      request.resume();
      return;
    }
    try {
      const payload = await readJsonBody(request);
      const result = await fissionProcessor.optimize(payload);
      sendJson(response, 200, result, corsHeaders);
    } catch (error) {
      sendJson(response, Number(error?.statusCode) || 500, {
        error: error instanceof Error ? error.message : String(error),
        code: error?.code ?? "PROCESSOR_ERROR",
      }, corsHeaders);
    }
  };

  const handleJournalExportRequest = async (request, response) => {
    const origin = request.headers.origin;
    if (origin && !config.allowedOrigins.has(origin)) {
      sendJson(response, 403, { error: "Origin not allowed.", code: "ORIGIN_DENIED" });
      return;
    }
    const corsHeaders = origin
      ? {
          "Access-Control-Allow-Origin": origin,
          "Access-Control-Expose-Headers": "Content-Disposition",
          Vary: "Origin",
          "Cross-Origin-Resource-Policy": "same-site",
        }
      : {};
    if (request.method !== "GET") {
      sendJson(response, 405, { error: "Method not allowed." }, { ...corsHeaders, Allow: "GET" });
      return;
    }
    if (!eventJournal.status().enabled) {
      sendJson(response, 503, { error: "Event journal is disabled.", code: "JOURNAL_DISABLED" }, corsHeaders);
      return;
    }
    try {
      const body = await eventJournal.exportText();
      const filename = `mr1-events-${new Date().toISOString().replace(/[:.]/g, "-")}.jsonl`;
      response.writeHead(200, {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Content-Length": Buffer.byteLength(body),
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        ...corsHeaders,
      });
      response.end(body);
    } catch (error) {
      sendJson(response, 503, {
        error: error instanceof Error ? error.message : String(error),
        code: "JOURNAL_EXPORT_FAILED",
      }, corsHeaders);
    }
  };

  const handleJournalReconciliationRequest = async (request, response) => {
    const origin = request.headers.origin;
    if (!origin || !config.allowedOrigins.has(origin)) {
      sendJson(response, 403, { error: "Origin not allowed.", code: "ORIGIN_DENIED" });
      return;
    }
    const corsHeaders = {
      "Access-Control-Allow-Origin": origin,
      Vary: "Origin",
      "Cross-Origin-Resource-Policy": "same-site",
    };
    if (request.method === "OPTIONS") {
      response.writeHead(204, {
        ...corsHeaders,
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Max-Age": "600",
      });
      response.end();
      return;
    }
    if (request.method !== "POST") {
      sendJson(response, 405, { error: "Method not allowed." }, { ...corsHeaders, Allow: "POST, OPTIONS" });
      return;
    }
    const contentLength = Number(request.headers["content-length"] ?? 0);
    if (Number.isFinite(contentLength) && contentLength > MAX_RECONCILIATION_REQUEST_BYTES) {
      sendJson(response, 413, { error: "Request body is too large.", code: "REQUEST_TOO_LARGE" }, corsHeaders);
      request.resume();
      return;
    }

    let acquiredAcknowledgementMutex = false;
    try {
      const payload = await readJsonBody(request, MAX_RECONCILIATION_REQUEST_BYTES);
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        throw Object.assign(new Error("Restart acknowledgement must be a JSON object."), { code: "INVALID_RECONCILIATION_REQUEST" });
      }
      const allowedKeys = new Set(["protocol", "reconciliationId", "confirmed"]);
      const unknownKey = Object.keys(payload).find((key) => !allowedKeys.has(key));
      if (unknownKey) {
        throw Object.assign(new Error(`Restart acknowledgement field ${unknownKey} is not allowed.`), { code: "INVALID_RECONCILIATION_REQUEST" });
      }
      if (payload.protocol !== JOURNAL_RECONCILIATION_ACK_PROTOCOL) {
        throw Object.assign(new Error("Restart acknowledgement protocol is not supported."), { code: "INVALID_RECONCILIATION_PROTOCOL" });
      }
      const current = restartReconciliationSnapshot();
      if (payload.reconciliationId !== current.reconciliationId) {
        throw Object.assign(new Error("Restart evidence changed; refresh and review it again."), {
          code: "RECONCILIATION_ID_MISMATCH",
          statusCode: 409,
        });
      }
      if (current.acknowledged) {
        sendJson(response, 200, {
          accepted: false,
          duplicate: true,
          restartReconciliation: current,
          machineCommands: redactCommandState(commandCoordinator.snapshot()),
        }, corsHeaders);
        return;
      }
      if (config.mode !== "simulate") {
        throw Object.assign(new Error("Physical restart reconciliation remains locked to the commissioning procedure."), {
          code: "PHYSICAL_RECONCILIATION_LOCKED",
          statusCode: 423,
        });
      }
      if (!current.reviewable) {
        throw Object.assign(new Error(
          current.state === "CORRUPT"
            ? "Corrupt journal evidence cannot be acknowledged away. Archive it and investigate."
            : "The current restart state does not require an acknowledgement.",
        ), { code: "RECONCILIATION_NOT_REVIEWABLE", statusCode: 423 });
      }
      if (payload.confirmed !== true) {
        throw Object.assign(new Error("Explicit restart review confirmation is required."), { code: "RECONCILIATION_CONFIRMATION_REQUIRED" });
      }
      if (reconciliationAcknowledgementBusy) {
        throw Object.assign(new Error("A restart acknowledgement is already being recorded."), {
          code: "RECONCILIATION_BUSY",
          statusCode: 409,
        });
      }

      reconciliationAcknowledgementBusy = true;
      acquiredAcknowledgementMutex = true;
      const acknowledgedAt = new Date().toISOString();
      const record = await eventJournal.append("service.reconciliation-acknowledged", {
        protocol: JOURNAL_RECONCILIATION_ACK_PROTOCOL,
        reconciliationId: current.reconciliationId,
        previousState: current.state,
        previousSessionId: current.previousSessionId,
        unfinishedCount: current.unfinishedCount,
        acknowledgedAt,
        simulationOnly: true,
        physicalMotionPermitted: false,
      }, { sync: true });
      if (!record) throw new Error("Restart acknowledgement could not be written durably.");
      reconciliationAcknowledgedAt = acknowledgedAt;
      commandCoordinator.enabled = true;
      const reconciled = restartReconciliationSnapshot();
      const machineCommands = commandCoordinator.snapshot();
      bridge = {
        ...bridge,
        restartReconciliation: reconciled,
        machineCommands,
        journal: eventJournal.status(),
        changedAt: new Date().toISOString(),
      };
      broadcast("journal", bridge.journal);
      broadcast("bridge", bridge);
      sendJson(response, 200, {
        accepted: true,
        duplicate: false,
        restartReconciliation: reconciled,
        machineCommands,
      }, corsHeaders);
    } catch (error) {
      sendJson(response, Number(error?.statusCode) || 400, {
        error: error instanceof Error ? error.message : String(error),
        code: error?.code ?? "RECONCILIATION_FAILED",
        restartReconciliation: restartReconciliationSnapshot(),
        machineCommands: redactCommandState(commandCoordinator.snapshot()),
      }, corsHeaders);
    } finally {
      // Only the request that actually took the mutex may release it; a
      // request rejected with RECONCILIATION_BUSY must not clear the flag
      // out from under the holder mid-append.
      if (acquiredAcknowledgementMutex) reconciliationAcknowledgementBusy = false;
    }
  };

  const handleConfigurationJournalRequest = async (request, response) => {
    const origin = request.headers.origin;
    if (!origin || !config.allowedOrigins.has(origin)) {
      sendJson(response, 403, { error: "Origin not allowed.", code: "ORIGIN_DENIED" });
      return;
    }
    const corsHeaders = {
      "Access-Control-Allow-Origin": origin,
      Vary: "Origin",
      "Cross-Origin-Resource-Policy": "same-site",
    };
    if (request.method === "OPTIONS") {
      response.writeHead(204, {
        ...corsHeaders,
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Max-Age": "600",
      });
      response.end();
      return;
    }
    if (request.method !== "POST") {
      sendJson(response, 405, { error: "Method not allowed." }, { ...corsHeaders, Allow: "POST, OPTIONS" });
      return;
    }
    const contentLength = Number(request.headers["content-length"] ?? 0);
    if (Number.isFinite(contentLength) && contentLength > MAX_CONFIGURATION_JOURNAL_REQUEST_BYTES) {
      sendJson(response, 413, { error: "Request body is too large.", code: "REQUEST_TOO_LARGE" }, corsHeaders);
      request.resume();
      return;
    }
    try {
      const event = validateConfigurationJournalEvent(
        await readJsonBody(request, MAX_CONFIGURATION_JOURNAL_REQUEST_BYTES),
      );
      const record = await eventJournal.append("browser.configuration", event, { sync: true });
      if (!record) {
        sendJson(response, 503, {
          error: "Event journal is disabled.",
          code: "JOURNAL_DISABLED",
          physicalMotionPermitted: false,
        }, corsHeaders);
        return;
      }
      browserConfigurationJournal = {
        protocol: CONFIGURATION_JOURNAL_PROTOCOL,
        sessionEvents: browserConfigurationJournal.sessionEvents + 1,
        lastCategory: event.category,
        lastAction: event.action,
        lastEventAt: record.at,
        physicalMotionPermitted: false,
      };
      const journal = {
        ...eventJournal.status(),
        sequence: ++journalSequence,
        bridgePublishedAt: new Date().toISOString(),
      };
      bridge = {
        ...bridge,
        journal,
        browserConfigurationJournal,
        changedAt: new Date().toISOString(),
      };
      broadcast("journal", journal);
      broadcast("bridge", bridge);
      sendJson(response, 200, {
        sealed: true,
        eventId: event.eventId,
        digest: record.digest,
        browserConfigurationJournal,
        physicalMotionPermitted: false,
      }, corsHeaders);
    } catch (error) {
      sendJson(response, Number(error?.statusCode) || 400, {
        error: error instanceof Error ? error.message : String(error),
        code: error?.code ?? "INVALID_CONFIGURATION_EVENT",
        physicalMotionPermitted: false,
      }, corsHeaders);
    }
  };

  const requestHandler = (request, response) => {
    const requestReceivedEpochMs = Date.now();
    if (!hostAllowed(request.headers.host)) {
      sendJson(response, 403, { error: "Host not allowed.", code: "HOST_DENIED" });
      request.resume();
      return;
    }
    let url;
    try {
      url = new URL(request.url ?? "/", `http://${LOOPBACK_HOST}`);
    } catch {
      sendJson(response, 400, { error: "Malformed request URL." });
      return;
    }
    if (config.companionToken !== null) {
      const supplied = String(url.searchParams.get("pair") ?? "");
      const expectedBuffer = Buffer.from(config.companionToken, "utf8");
      const suppliedBuffer = Buffer.from(supplied, "utf8");
      const paired = suppliedBuffer.length === expectedBuffer.length
        && timingSafeEqual(suppliedBuffer, expectedBuffer);
      if (!paired) {
        sendJson(response, 401, {
          error: "Companion pairing is required.",
          code: "COMPANION_PAIRING_REQUIRED",
        });
        request.resume();
        return;
      }
    }
    if (url.pathname === "/health") {
      if (request.method !== "GET") {
        sendJson(response, 405, { error: "Method not allowed." }, { Allow: "GET" });
        return;
      }
      const origin = request.headers.origin;
      if (origin && !config.allowedOrigins.has(origin)) {
        sendJson(response, 403, { error: "Origin not allowed." });
        return;
      }
      const corsHeaders = origin
        ? {
            "Access-Control-Allow-Origin": origin,
            Vary: "Origin",
            "Cross-Origin-Resource-Policy": "same-site",
          }
        : {};
      sendJson(response, 200, {
        ...bridge,
        journal: eventJournal.status(),
        restartReconciliation: restartReconciliationSnapshot(),
        machineCommands: redactCommandState(commandCoordinator.snapshot()),
        clients: clients.size,
        hasTelemetry: Boolean(latestStatus),
        hasSensorTelemetry: Boolean(latestSensor),
        sensorFirmwareVersion: latestSensor?.firmwareVersion ?? null,
        sensorCalibrationCapabilities: latestSensor ? sensorCalibrationCapabilities(latestSensor) : null,
        hasSpindleTelemetry: Boolean(latestSpindle),
        fission: fissionProcessor.status(),
      }, corsHeaders);
      return;
    }

    if (url.pathname === "/latency/ping") {
      if (request.method !== "GET") {
        sendJson(response, 405, { error: "Method not allowed." }, { Allow: "GET" });
        return;
      }
      const origin = request.headers.origin;
      if (!origin || !config.allowedOrigins.has(origin)) {
        sendJson(response, 403, { error: "Origin not allowed." });
        return;
      }
      const serverSentEpochMs = Date.now();
      sendJson(response, 200, {
        protocol: LATENCY_PING_PROTOCOL,
        serverReceivedAt: new Date(requestReceivedEpochMs).toISOString(),
        serverReceivedEpochMs: requestReceivedEpochMs,
        serverSentAt: new Date(serverSentEpochMs).toISOString(),
        serverSentEpochMs,
        serviceUptimeMs: Math.max(0, Math.round(performance.now() - startedPerformanceAt)),
        telemetrySequence: latestStatus?.sequence ?? null,
        bridgeMode: bridge.mode,
        connected: bridge.connected === true,
        physicalMotionPermitted: false,
      }, {
        "Access-Control-Allow-Origin": origin,
        Vary: "Origin",
        "Cross-Origin-Resource-Policy": "same-site",
      });
      return;
    }

    if (url.pathname === "/journal/export") {
      void handleJournalExportRequest(request, response);
      return;
    }

    if (url.pathname === "/journal/reconciliation/acknowledge") {
      void handleJournalReconciliationRequest(request, response);
      return;
    }

    if (url.pathname === "/journal/configuration") {
      void handleConfigurationJournalRequest(request, response);
      return;
    }

    if (url.pathname === "/controller/preflight") {
      if (request.method !== "GET") {
        sendJson(response, 405, { error: "Method not allowed." }, { Allow: "GET" });
        return;
      }
      const origin = request.headers.origin;
      if (origin && !config.allowedOrigins.has(origin)) {
        sendJson(response, 403, { error: "Origin not allowed." });
        return;
      }
      const corsHeaders = origin
        ? {
            "Access-Control-Allow-Origin": origin,
            Vary: "Origin",
            "Cross-Origin-Resource-Policy": "same-site",
          }
        : {};
      sendJson(response, 200, controllerPreflightReport, corsHeaders);
      return;
    }

    if (url.pathname === "/optimize/fission") {
      void handleFissionRequest(request, response);
      return;
    }

    if (url.pathname === "/sensor/calibration") {
      void handleSensorCalibrationRequest(request, response);
      return;
    }

    if (url.pathname === "/controller/settings/apply") {
      void handleControllerSettingsRequest(request, response);
      return;
    }

    if (url.pathname === "/machine/transactions") {
      void handleMachineTransactionRequest(request, response, url);
      return;
    }

    if (url.pathname === "/machine/cancel") {
      void handleMachineCancelRequest(request, response);
      return;
    }

    if (url.pathname !== "/events") {
      sendJson(response, 404, { error: "Not found." });
      return;
    }
    if (request.method !== "GET") {
      sendJson(response, 405, { error: "Method not allowed." }, { Allow: "GET" });
      return;
    }

    const origin = request.headers.origin;
    if (!origin || !config.allowedOrigins.has(origin)) {
      sendJson(response, 403, { error: "Origin not allowed." });
      return;
    }

    response.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": origin,
      Vary: "Origin",
      "X-Accel-Buffering": "no",
      "X-Content-Type-Options": "nosniff",
    });
    clients.add(response);
    const eventOwnerId = url.searchParams.get("ownerId");
    if (/^[A-Za-z0-9_-]{8,80}$/.test(eventOwnerId ?? "")) {
      clientOwners.set(response, eventOwnerId);
      clearTimeout(ownerDisconnectTimers.get(eventOwnerId));
      ownerDisconnectTimers.delete(eventOwnerId);
    }
    writeClient(response, "retry: 1500\n\n");
    sendClientEvent(response, "bridge", bridge);
    if (latestStatus) sendClientEvent(response, "telemetry", latestStatus);
    if (latestSensor) sendClientEvent(response, "sensor", latestSensor);
    if (latestSpindle) sendClientEvent(response, "spindle", latestSpindle);
    if (eventJournal.status().enabled) {
      sendClientEvent(response, "journal", {
        ...eventJournal.status(),
        sequence: journalSequence,
        bridgePublishedAt: new Date().toISOString(),
      });
    }
    if (latestTransaction) sendClientEvent(response, "transaction", latestTransaction);
    request.on("close", () => dropClient(response));
    response.on("error", () => dropClient(response));
  };

  return {
    async start() {
      if (httpServer?.listening) return this.address();
      if (!controllerPreflightProfile) {
        try {
          controllerPreflightProfile = await loadControllerPreflightProfile(options.controllerPreflightPath);
        } catch (error) {
          controllerPreflightReport = pendingControllerPreflight(
            "ERROR",
            error instanceof Error ? error.message : String(error),
          );
          controllerPreflight = summarizeControllerPreflight(controllerPreflightReport);
          bridge = { ...bridge, controllerPreflight };
        }
      }
      restartReconciliation = await eventJournal.reconcile();
      reconciliationAcknowledgedAt = null;
      commandCoordinator.enabled = config.mode === "simulate"
        && restartReconciliation.requiresReview !== true;
      bridge = {
        ...bridge,
        restartReconciliation: restartReconciliationSnapshot(),
        machineCommands: redactCommandState(commandCoordinator.snapshot()),
      };
      await eventJournal.append("service.start", {
        mode: config.mode,
        controllerPort: config.serialPort,
        controllerBaudRate: config.mode === "serial" ? config.baudRate : null,
        sensorPort: config.sensorPort,
        sensorBaudRate: config.sensorPort ? config.sensorBaudRate : null,
        httpPort: config.httpPort,
        httpHost: config.httpHost,
        companion: bridge.companion,
        serialWritePolicy: SERIAL_WRITE_POLICY,
        sensorWritePolicy: SENSOR_WRITE_POLICY,
        machineCommandPolicy: MACHINE_COMMAND_POLICY,
        restartReconciliation: restartReconciliationSnapshot(),
      }, { sync: true });
      await eventJournal.append("service.reconciliation", restartReconciliationSnapshot(), { sync: true });
      bridge = {
        ...bridge,
        journal: eventJournal.status(),
        restartReconciliation: restartReconciliationSnapshot(),
        machineCommands: redactCommandState(commandCoordinator.snapshot()),
      };
      httpServer = createServer(requestHandler);
      await listen(httpServer, config.httpPort, config.httpHost);
      bridge = {
        ...bridge,
        journalExportUrl: `${this.address().url}/journal/export`,
      };
      heartbeatTimer = setInterval(() => {
        for (const response of clients) writeClient(response, ": heartbeat\n\n");
      }, 15_000);
      try {
        if (config.mode === "simulate") startSimulation();
        else await startSerial();
        if (config.sensorPort) await startSensor();
      } catch (error) {
        await this.stop();
        throw error;
      }
      return this.address();
    },

    address() {
      const address = httpServer?.address();
      if (!address || typeof address === "string") return null;
      return {
        host: config.httpHost === LAN_HOST ? LOOPBACK_HOST : config.httpHost,
        port: address.port,
        url: `http://${config.httpHost === LAN_HOST ? LOOPBACK_HOST : config.httpHost}:${address.port}`,
      };
    },

    snapshot() {
      return {
        bridge,
        latestStatus,
        latestSensor,
        latestSpindle,
        latestTransaction,
        controllerPreflightReport,
        machineCommands: redactCommandState(commandCoordinator.snapshot()),
        journal: eventJournal.status(),
        restartReconciliation: restartReconciliationSnapshot(),
      };
    },

    async stop() {
      if (stopping) return;
      stopping = true;
      clearTimeout(startupTimer);
      clearInterval(sourceTimer);
      clearInterval(heartbeatTimer);
      for (const timer of ownerDisconnectTimers.values()) clearTimeout(timer);
      ownerDisconnectTimers.clear();
      await commandCoordinator.stop();
      for (const response of clients) response.end();
      clients.clear();
      controllerLineListeners.clear();
      await closeSerial(serial);
      await closeSerial(sensorSerial);
      await eventJournal.close({
        mode: config.mode,
        controllerConnected: bridge.connected,
        sensorConnected: bridge.sensorConnected,
      });
      await closeHttpServer(httpServer);
    },
  };
}

function parseCliArgs(argv) {
  const options = {};
  let listPorts = false;
  let help = false;
  const nextValue = (index, name) => {
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${name} requires a value.`);
    return value;
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--simulate") options.mode = "simulate";
    else if (argument === "--port") {
      options.mode = "serial";
      options.serialPort = nextValue(index, argument);
      index += 1;
    } else if (argument === "--baud") {
      options.baudRate = Number(nextValue(index, argument));
      index += 1;
    } else if (argument === "--sensor-port") {
      options.sensorPort = nextValue(index, argument);
      index += 1;
    } else if (argument === "--sensor-baud") {
      options.sensorBaudRate = Number(nextValue(index, argument));
      index += 1;
    } else if (argument === "--poll-ms") {
      options.pollMs = Number(nextValue(index, argument));
      index += 1;
    } else if (argument === "--http-port") {
      options.httpPort = Number(nextValue(index, argument));
      index += 1;
    } else if (argument === "--http-host") {
      options.httpHost = nextValue(index, argument);
      index += 1;
    } else if (argument === "--allow-origin") {
      options.allowedOrigins ??= [];
      options.allowedOrigins.push(nextValue(index, argument));
      index += 1;
    } else if (argument === "--companion-token") {
      options.companionToken = nextValue(index, argument);
      index += 1;
    } else if (argument === "--fission-root") {
      options.fissionRoot = nextValue(index, argument);
      index += 1;
    } else if (argument === "--no-fission") {
      options.fissionRoot = false;
    } else if (argument === "--journal-dir") {
      options.journalDirectory = nextValue(index, argument);
      index += 1;
    } else if (argument === "--no-journal") {
      options.journalDirectory = false;
    } else if (argument === "--list-ports") listPorts = true;
    else if (argument === "--help" || argument === "-h") help = true;
    else throw new Error(`Unknown option: ${argument}`);
  }
  return { options, listPorts, help };
}

function printHelp() {
  process.stdout.write(`MR-1 telemetry bridge\n\n`);
  process.stdout.write(`  --simulate                 Use generated telemetry\n`);
  process.stdout.write(`  --port COM3                Own one explicit Windows serial port\n`);
  process.stdout.write(`  --baud 115200              Serial baud rate\n`);
  process.stdout.write(`  --sensor-port COM5         Optional ESP32 USB telemetry port\n`);
  process.stdout.write(`  --sensor-baud 115200       ESP32 serial baud rate\n`);
  process.stdout.write(`  --poll-ms 100              '?' status interval (100-1000 ms)\n`);
  process.stdout.write(`  --http-port 8787           Loopback SSE port\n`);
  process.stdout.write(`  --http-host 0.0.0.0        Explicit LAN bind (requires pairing token)\n`);
  process.stdout.write(`  --allow-origin URL         Exact browser origin; repeat for each address\n`);
  process.stdout.write(`  --companion-token TOKEN    32-128 character LAN pairing secret\n`);
  process.stdout.write(`  --fission-root PATH        Reviewed external Fission source root\n`);
  process.stdout.write(`  --no-fission               Disable local G-code optimizer adapter\n`);
  process.stdout.write(`  --journal-dir PATH         Durable rotating event-journal directory\n`);
  process.stdout.write(`  --no-journal               Disable the event journal\n`);
  process.stdout.write(`  --list-ports               List ports without opening them\n`);
}

async function runCli() {
  const { options, listPorts, help } = parseCliArgs(process.argv.slice(2));
  if (help) {
    printHelp();
    return;
  }
  if (listPorts) {
    const { SerialPort } = await import("serialport");
    process.stdout.write(`${JSON.stringify(await SerialPort.list(), null, 2)}\n`);
    return;
  }
  if (!options.mode) throw new Error("Choose --simulate or an explicit --port COMx.");
  if (options.journalDirectory === undefined) options.journalDirectory = defaultJournalDirectory();

  const service = createTelemetryService(options);
  const address = await service.start();
  process.stdout.write(`MR-1 telemetry: ${options.mode} at ${address.url}\n`);
  process.stdout.write(`Serial writes: status plus exact read-only startup preflight allow-list\n`);
  process.stdout.write(`Machine transactions: ${options.mode === "simulate" ? "typed virtual executor enabled" : "physical commands locked"}\n`);
  process.stdout.write(`Sensor writes: calibration commands only when advertised by firmware\n`);
  process.stdout.write(`Event journal: ${service.snapshot().journal.enabled ? service.snapshot().journal.directory : "disabled"}\n`);
  const stop = async () => {
    await service.stop();
    process.exitCode = 0;
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}

const invokedUrl = process.argv[1] ? pathToFileURL(process.argv[1]).href : null;
if (invokedUrl === import.meta.url) {
  runCli().catch((error) => {
    process.stderr.write(`MR-1 telemetry failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}
