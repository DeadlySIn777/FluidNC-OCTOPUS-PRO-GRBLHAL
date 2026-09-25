import assert from "node:assert/strict";
import test from "node:test";

import {
  COMPANION_TOKEN_STORAGE_KEY,
  captureCompanionToken,
  companionMode,
  loadCompanionToken,
  serviceEndpoint,
  serviceHostname,
  serviceOrigin,
  validCompanionToken,
} from "../src/service-endpoints.js";

class MemoryStorage {
  constructor() {
    this.values = new Map();
  }

  getItem(key) {
    return this.values.get(key) ?? null;
  }

  setItem(key, value) {
    this.values.set(key, String(value));
  }
}

class RejectingStorage {
  getItem() {
    throw new Error("storage blocked");
  }

  setItem() {
    throw new Error("storage blocked");
  }
}

test("service endpoints follow the browser host instead of forcing loopback", () => {
  const remote = { hostname: "192.168.50.20" };
  assert.equal(serviceHostname(remote), "192.168.50.20");
  assert.equal(serviceOrigin(remote), "http://192.168.50.20:8787");
  assert.equal(serviceOrigin({ hostname: "::1" }), "http://[::1]:8787");
  assert.equal(serviceHostname({ hostname: "0.0.0.0" }), "127.0.0.1");
});

test('native mode stays on its own service and never attaches to port 8787', () => {
  const location = { hostname: '127.0.0.1', origin: 'http://127.0.0.1:5174', search: '?native=1' };
  assert.equal(serviceOrigin(location), 'http://127.0.0.1:5174');
  assert.equal(serviceEndpoint('/events', { location }), 'http://127.0.0.1:5174/events');
});

test("a valid pairing link is persisted and immediately removed from browser history", () => {
  const token = "A".repeat(43);
  const storage = new MemoryStorage();
  const replacements = [];
  const location = {
    href: `http://192.168.50.20:5173/?companion=1&pair=${token}#dro`,
    hostname: "192.168.50.20",
    search: `?companion=1&pair=${token}`,
  };
  const captured = captureCompanionToken({
    location,
    storage,
    history: { state: { retained: true }, replaceState: (...args) => replacements.push(args) },
  });
  assert.equal(captured, token);
  assert.equal(storage.getItem(COMPANION_TOKEN_STORAGE_KEY), token);
  assert.equal(loadCompanionToken(storage), token);
  assert.deepEqual(replacements[0], [{ retained: true }, "", "/?companion=1#dro"]);

  const endpoint = new URL(serviceEndpoint("/events", { location, storage }));
  assert.equal(endpoint.origin, "http://192.168.50.20:8787");
  assert.equal(endpoint.pathname, "/events");
  assert.equal(endpoint.searchParams.get("pair"), token);
});

test("invalid pairing material is ignored and companion mode is explicit", () => {
  const storage = new MemoryStorage();
  const location = {
    href: "http://mr1-pc:5173/?companion=1&pair=short",
    hostname: "mr1-pc",
    search: "?companion=1&pair=short",
  };
  assert.equal(captureCompanionToken({ location, storage }), null);
  assert.equal(storage.getItem(COMPANION_TOKEN_STORAGE_KEY), null);
  assert.equal(validCompanionToken("short"), false);
  assert.equal(companionMode(location, () => ({ matches: false })), true);
  assert.equal(companionMode({ search: "" }, () => ({ matches: true })), true);
  assert.equal(companionMode({ search: "" }, () => ({ matches: false })), false);
});

test("the current page can retain its pairing token when browser storage is blocked", () => {
  const token = "P".repeat(43);
  const storage = new RejectingStorage();
  const replacements = [];
  const location = {
    href: `http://192.168.50.20:5173/?companion=1&pair=${token}`,
    hostname: "192.168.50.20",
    search: `?companion=1&pair=${token}`,
  };
  const captured = captureCompanionToken({
    location,
    storage,
    history: { replaceState: (...args) => replacements.push(args) },
  });
  assert.equal(captured, token);
  assert.deepEqual(replacements[0], [null, "", "/?companion=1"]);
  const endpoint = new URL(serviceEndpoint("/health", { location, storage, token: captured }));
  assert.equal(endpoint.searchParams.get("pair"), token);
});
