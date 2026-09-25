import { secureUuidV4, sha256TextHex } from "./browser-crypto.js";

export const CONFIGURATION_JOURNAL_PROTOCOL = "mr1-browser-configuration-event-v1";
export const CONFIGURATION_JOURNAL_QUEUE_KEY = "mr1-control.configuration-journal-queue.v1";
export const MAX_CONFIGURATION_JOURNAL_EVENTS = 128;
export const MAX_CONFIGURATION_CHANGED_PATHS = 64;

export const TRACKED_CONFIGURATION_KEYS = Object.freeze({
  "mr1-control.cutter-compensation.v1": "cutter-compensation",
  "mr1.fixture-map.v3": "fixture-map",
  "mr1-control.fission-import.v1": "fission-import",
  "mr1-control.machine-identity.v1": "machine-identity",
  "mr1-control.metrology-session.v1": "metrology",
  "mr1-control.probe-calibration.v1": "probe-calibration",
  "mr1-control.probing-profile.v2": "probing",
  "mr1.scene-registration.v1": "scene-registration",
  "mr1-control.sensor-wiring-profile.v1": "sensor-wiring",
  "mr1-control.wiring-installation.v1": "wiring-evidence",
});

function storageGet(storage, key) {
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function storageSet(storage, key, value) {
  try {
    storage?.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function storageRemove(storage, key) {
  try {
    storage?.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

function safeJson(value) {
  if (value === null) return null;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function appendChangedPath(state, path) {
  if (state.paths.length >= MAX_CONFIGURATION_CHANGED_PATHS) {
    state.truncated = true;
    return;
  }
  state.paths.push(path || "$value");
}

function collectChangedPaths(before, after, path, state) {
  if (state.truncated || Object.is(before, after)) return;
  const beforeObject = before !== null && typeof before === "object";
  const afterObject = after !== null && typeof after === "object";
  if (!beforeObject || !afterObject || Array.isArray(before) !== Array.isArray(after)) {
    appendChangedPath(state, path);
    return;
  }
  if (Array.isArray(before)) {
    if (before.length !== after.length) appendChangedPath(state, path ? `${path}.length` : "length");
    const count = Math.max(before.length, after.length);
    for (let index = 0; index < count && !state.truncated; index += 1) {
      collectChangedPaths(before[index], after[index], `${path}[${index}]`, state);
    }
    return;
  }
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
  for (const key of keys) {
    if (state.truncated) break;
    collectChangedPaths(before[key], after[key], path ? `${path}.${key}` : key, state);
  }
}

export function changedConfigurationPaths(beforeText, afterText) {
  const state = { paths: [], truncated: false };
  collectChangedPaths(safeJson(beforeText), safeJson(afterText), "", state);
  return state;
}

async function sha256Text(value, cryptoApi) {
  if (value === null) return null;
  return sha256TextHex(value, cryptoApi);
}

function fallbackId() {
  return `cfg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function loadQueue(storage) {
  try {
    const queue = JSON.parse(storageGet(storage, CONFIGURATION_JOURNAL_QUEUE_KEY) ?? "[]");
    return Array.isArray(queue) ? queue.slice(-MAX_CONFIGURATION_JOURNAL_EVENTS) : [];
  } catch {
    return [];
  }
}

function saveQueue(storage, queue) {
  const bounded = queue.slice(-MAX_CONFIGURATION_JOURNAL_EVENTS);
  if (bounded.length === 0) storageRemove(storage, CONFIGURATION_JOURNAL_QUEUE_KEY);
  else storageSet(storage, CONFIGURATION_JOURNAL_QUEUE_KEY, JSON.stringify(bounded));
  return bounded;
}

function storageFacade(client) {
  const facade = {
    getItem: (key) => client.rawStorage?.getItem(key) ?? null,
    setItem: (key, value) => client.setItem(key, value),
    removeItem: (key) => client.removeItem(key),
    clear: () => client.clear(),
    key: (index) => client.rawStorage?.key(index) ?? null,
  };
  Object.defineProperty(facade, "length", {
    enumerable: true,
    get: () => Number(client.rawStorage?.length ?? 0),
  });
  return facade;
}

export class ConfigurationJournalClient {
  constructor(options = {}) {
    this.rawStorage = options.storage ?? globalThis.localStorage;
    this.endpoint = options.endpoint ?? "http://127.0.0.1:8787/journal/configuration";
    this.fetch = options.fetch ?? globalThis.fetch?.bind(globalThis);
    this.crypto = options.crypto ?? globalThis.crypto;
    this.now = options.now ?? (() => new Date().toISOString());
    this.randomUuid = options.randomUuid ?? (() => secureUuidV4({ cryptoProvider: this.crypto }));
    this.onStatus = options.onStatus ?? (() => {});
    this.autoFlush = options.autoFlush !== false;
    this.pipeline = Promise.resolve();
    this.flushPromise = null;
    this.rejectedAttempts = new Map();
    this.storage = storageFacade(this);
  }

  trackedCategory(key) {
    return TRACKED_CONFIGURATION_KEYS[String(key)] ?? null;
  }

  schedule(storageKey, beforeText, afterText) {
    const category = this.trackedCategory(storageKey);
    if (!category || beforeText === afterText) return;
    this.pipeline = this.pipeline
      .then(async () => {
        const action = beforeText === null ? "create" : afterText === null ? "remove" : "update";
        const changes = changedConfigurationPaths(beforeText, afterText);
        const [beforeSha256, afterSha256] = await Promise.all([
          sha256Text(beforeText, this.crypto),
          sha256Text(afterText, this.crypto),
        ]);
        const event = {
          protocol: CONFIGURATION_JOURNAL_PROTOCOL,
          eventId: `cfg-${this.randomUuid ? this.randomUuid() : fallbackId()}`.replace(/[^A-Za-z0-9_-]/g, "_"),
          storageKey,
          category,
          action,
          beforeSha256,
          afterSha256,
          changedPaths: changes.paths,
          changedPathsTruncated: changes.truncated,
          occurredAt: new Date(this.now()).toISOString(),
        };
        const queue = loadQueue(this.rawStorage);
        queue.push(event);
        // Bounding the queue must never be silent: dropped events are lost
        // configuration evidence and the operator should know.
        const dropped = Math.max(0, queue.length - MAX_CONFIGURATION_JOURNAL_EVENTS);
        const bounded = saveQueue(this.rawStorage, queue);
        if (dropped > 0) this.onStatus({ state: "overflow", dropped, queued: bounded.length });
        this.onStatus({ state: "queued", queued: bounded.length, event });
        if (this.autoFlush) await this.flush();
      })
      .catch((error) => {
        this.onStatus({ state: "error", error: error instanceof Error ? error.message : String(error) });
      });
  }

  setItem(key, value) {
    const storageKey = String(key);
    const text = String(value);
    const before = storageGet(this.rawStorage, storageKey);
    this.rawStorage?.setItem(storageKey, text);
    this.schedule(storageKey, before, text);
  }

  removeItem(key) {
    const storageKey = String(key);
    const before = storageGet(this.rawStorage, storageKey);
    this.rawStorage?.removeItem(storageKey);
    this.schedule(storageKey, before, null);
  }

  clear() {
    const before = Object.keys(TRACKED_CONFIGURATION_KEYS)
      .map((key) => [key, storageGet(this.rawStorage, key)])
      .filter(([, value]) => value !== null);
    // storage.clear() also wipes the persisted unsent event queue; preserve
    // it so pending evidence survives the clear it is about to describe.
    const pendingQueue = storageGet(this.rawStorage, CONFIGURATION_JOURNAL_QUEUE_KEY);
    this.rawStorage?.clear();
    if (pendingQueue !== null) storageSet(this.rawStorage, CONFIGURATION_JOURNAL_QUEUE_KEY, pendingQueue);
    for (const [key, value] of before) this.schedule(key, value, null);
  }

  async flush() {
    if (this.flushPromise) return this.flushPromise;
    this.flushPromise = (async () => {
      if (typeof this.fetch !== "function") return false;
      let queue = loadQueue(this.rawStorage);
      while (queue.length > 0) {
        const event = queue[0];
        let response;
        try {
          response = await this.fetch(this.endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(event),
            cache: "no-store",
          });
        } catch {
          this.onStatus({ state: "offline", queued: queue.length });
          return false;
        }
        if (!response.ok) {
          // A permanently rejected head event must not block the queue
          // forever; after repeated 4xx rejections it is discarded with an
          // explicit status so the rest of the evidence can still flow.
          if (response.status >= 400 && response.status < 500) {
            const attempts = (this.rejectedAttempts.get(event.eventId) ?? 0) + 1;
            this.rejectedAttempts.set(event.eventId, attempts);
            if (attempts >= 3) {
              this.rejectedAttempts.delete(event.eventId);
              const latest = loadQueue(this.rawStorage);
              const index = latest.findIndex((candidate) => candidate?.eventId === event.eventId);
              if (index >= 0) latest.splice(index, 1);
              queue = saveQueue(this.rawStorage, latest);
              this.onStatus({ state: "discarded", queued: queue.length, eventId: event.eventId, status: response.status });
              continue;
            }
          }
          this.onStatus({ state: "rejected", queued: queue.length, status: response.status });
          return false;
        }
        const latest = loadQueue(this.rawStorage);
        if (latest[0]?.eventId === event.eventId) latest.shift();
        else {
          const index = latest.findIndex((candidate) => candidate?.eventId === event.eventId);
          if (index >= 0) latest.splice(index, 1);
        }
        queue = saveQueue(this.rawStorage, latest);
        this.onStatus({ state: "sealed", queued: queue.length, eventId: event.eventId });
      }
      return true;
    })().finally(() => {
      this.flushPromise = null;
    });
    return this.flushPromise;
  }

  async idle() {
    await this.pipeline;
    if (this.flushPromise) await this.flushPromise;
  }

  queuedEvents() {
    return loadQueue(this.rawStorage);
  }
}
