import assert from "node:assert/strict";
import { createHash, webcrypto } from "node:crypto";
import test from "node:test";

import {
  CONFIGURATION_JOURNAL_PROTOCOL,
  ConfigurationJournalClient,
  changedConfigurationPaths,
} from "../src/configuration-journal-client.js";

class MemoryStorage {
  constructor() {
    this.values = new Map();
  }

  get length() {
    return this.values.size;
  }

  getItem(key) {
    return this.values.get(String(key)) ?? null;
  }

  setItem(key, value) {
    this.values.set(String(key), String(value));
  }

  removeItem(key) {
    this.values.delete(String(key));
  }

  key(index) {
    return [...this.values.keys()][index] ?? null;
  }

  clear() {
    this.values.clear();
  }
}

function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex").toUpperCase();
}

test("configuration changes send hashes and paths without copying stored values", async () => {
  const storage = new MemoryStorage();
  const requests = [];
  const client = new ConfigurationJournalClient({
    storage,
    crypto: webcrypto,
    randomUuid: () => "11111111-2222-4333-8444-555555555555",
    now: () => "2026-08-28T04:00:00.000Z",
    fetch: async (_url, init) => {
      requests.push(JSON.parse(init.body));
      return { ok: true, status: 200 };
    },
  });
  const first = JSON.stringify({ label: "PRIVATE MACHINE NAME", nested: { x: 1 } });
  const second = JSON.stringify({ label: "RENAMED PRIVATE MACHINE", nested: { x: 2 } });
  client.storage.setItem("mr1-control.machine-identity.v1", first);
  await client.idle();
  client.storage.setItem("mr1-control.machine-identity.v1", second);
  await client.idle();

  assert.equal(requests.length, 2);
  assert.equal(requests[0].protocol, CONFIGURATION_JOURNAL_PROTOCOL);
  assert.equal(requests[0].action, "create");
  assert.equal(requests[0].beforeSha256, null);
  assert.equal(requests[0].afterSha256, sha256(first));
  assert.equal(requests[1].action, "update");
  assert.equal(requests[1].beforeSha256, sha256(first));
  assert.equal(requests[1].afterSha256, sha256(second));
  assert.deepEqual(requests[1].changedPaths, ["label", "nested.x"]);
  assert.doesNotMatch(JSON.stringify(requests), /PRIVATE MACHINE|RENAMED PRIVATE/);
  assert.deepEqual(client.queuedEvents(), []);

  client.storage.setItem("mr1-control.companion-token.v1", "S".repeat(43));
  await client.idle();
  assert.equal(requests.length, 2, "pairing secrets must never enter configuration evidence");
});

test("offline configuration evidence remains hash-only and flushes in order after reconnect", async () => {
  const storage = new MemoryStorage();
  const offline = new ConfigurationJournalClient({
    storage,
    crypto: webcrypto,
    randomUuid: () => "AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE",
    fetch: async () => { throw new Error("offline"); },
  });
  offline.storage.setItem("mr1-control.probing-profile.v2", JSON.stringify({ secretOffset: 3 }));
  await offline.idle();
  assert.equal(offline.queuedEvents().length, 1);
  assert.doesNotMatch(JSON.stringify(offline.queuedEvents()), /secretOffset":3/);

  const flushed = [];
  const online = new ConfigurationJournalClient({
    storage,
    crypto: webcrypto,
    fetch: async (_url, init) => {
      flushed.push(JSON.parse(init.body));
      return { ok: true, status: 200 };
    },
  });
  assert.equal(await online.flush(), true);
  assert.equal(flushed.length, 1);
  assert.deepEqual(online.queuedEvents(), []);
});

test("changed-path collection is bounded for large metrology sessions", () => {
  const before = JSON.stringify({ points: [] });
  const after = JSON.stringify({
    points: Array.from({ length: 200 }, (_, index) => ({ raw: { x: index, y: index, z: index } })),
  });
  const result = changedConfigurationPaths(before, after);
  assert.equal(result.paths.length, 64);
  assert.equal(result.truncated, true);
});

test("changed-path collection does not report truncation for exactly 64 changes", () => {
  const before = JSON.stringify(Object.fromEntries(
    Array.from({ length: 64 }, (_, index) => [`field${String(index).padStart(2, "0")}`, 0]),
  ));
  const after = JSON.stringify(Object.fromEntries(
    Array.from({ length: 64 }, (_, index) => [`field${String(index).padStart(2, "0")}`, 1]),
  ));
  const result = changedConfigurationPaths(before, after);
  assert.equal(result.paths.length, 64);
  assert.equal(result.truncated, false);
});

test("clear() preserves the unsent event queue it is about to describe", async () => {
  const storage = new MemoryStorage();
  const client = new ConfigurationJournalClient({
    storage,
    crypto: webcrypto,
    autoFlush: false,
  });
  client.storage.setItem("mr1-control.machine-identity.v1", JSON.stringify({ label: "A" }));
  await client.idle();
  assert.equal(client.queuedEvents().length, 1);
  client.storage.clear();
  await client.idle();
  // The original create event survives the clear and a remove event joins it.
  const queued = client.queuedEvents();
  assert.equal(queued.length, 2);
  assert.deepEqual(queued.map((event) => event.action), ["create", "remove"]);
});

test("a permanently rejected head event is discarded after retries instead of blocking the queue", async () => {
  const storage = new MemoryStorage();
  const statuses = [];
  let sent = 0;
  const client = new ConfigurationJournalClient({
    storage,
    crypto: webcrypto,
    autoFlush: false,
    onStatus: (status) => statuses.push(status),
    fetch: async (_url, init) => {
      const event = JSON.parse(init.body);
      sent += 1;
      // The first event is poison (server rejects it); later events succeed.
      if (event.storageKey === "mr1-control.machine-identity.v1") return { ok: false, status: 400 };
      return { ok: true, status: 200 };
    },
  });
  client.storage.setItem("mr1-control.machine-identity.v1", JSON.stringify({ label: "poison" }));
  client.storage.setItem("mr1-control.probing-profile.v2", JSON.stringify({ ok: true }));
  await client.idle();
  assert.equal(client.queuedEvents().length, 2);
  // Three flushes: rejected, rejected, discarded-then-drained.
  assert.equal(await client.flush(), false);
  assert.equal(await client.flush(), false);
  assert.equal(await client.flush(), true);
  assert.deepEqual(client.queuedEvents(), []);
  assert.ok(statuses.some((status) => status.state === "discarded" && status.status === 400));
  assert.ok(statuses.some((status) => status.state === "sealed"));
  assert.ok(sent >= 4);
});
