import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { verifyJournalRecords } from "../service/event-journal.mjs";
import {
  CONFIGURATION_JOURNAL_PROTOCOL,
  createTelemetryService,
} from "../service/mr1-telemetry-service.mjs";

const ORIGIN = "http://127.0.0.1:5173";

function configurationEvent(overrides = {}) {
  return {
    protocol: CONFIGURATION_JOURNAL_PROTOCOL,
    eventId: "cfg-11111111-2222-4333-8444-555555555555",
    storageKey: "mr1-control.probing-profile.v2",
    category: "probing",
    action: "update",
    beforeSha256: "A".repeat(64),
    afterSha256: "B".repeat(64),
    changedPaths: ["toolSetter.clearanceMm", "touchProbe.maxTravelMm"],
    changedPathsTruncated: false,
    occurredAt: "2026-08-28T04:10:00.000Z",
    ...overrides,
  };
}

test("configuration endpoint durably seals strict hash-only browser evidence", async () => {
  const directory = await mkdtemp(join(tmpdir(), "mr1-config-journal-"));
  const service = createTelemetryService({
    mode: "simulate",
    httpPort: 0,
    fissionRoot: false,
    journalDirectory: directory,
  });
  const address = await service.start();
  try {
    const options = await fetch(`${address.url}/journal/configuration`, {
      method: "OPTIONS",
      headers: { Origin: ORIGIN },
    });
    assert.equal(options.status, 204);

    const denied = await fetch(`${address.url}/journal/configuration`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://example.com" },
      body: JSON.stringify(configurationEvent()),
    });
    assert.equal(denied.status, 403);

    const rawValueRejected = await fetch(`${address.url}/journal/configuration`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: ORIGIN },
      body: JSON.stringify(configurationEvent({ rawConfiguration: { toolSetter: { clearanceMm: 3 } } })),
    });
    assert.equal(rawValueRejected.status, 400);
    assert.equal((await rawValueRejected.json()).code, "INVALID_CONFIGURATION_EVENT");

    const mismatchedCategory = await fetch(`${address.url}/journal/configuration`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: ORIGIN },
      body: JSON.stringify(configurationEvent({ category: "wiring-evidence" })),
    });
    assert.equal(mismatchedCategory.status, 400);

    const accepted = await fetch(`${address.url}/journal/configuration`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: ORIGIN },
      body: JSON.stringify(configurationEvent()),
    });
    assert.equal(accepted.status, 200);
    const sealed = await accepted.json();
    assert.equal(sealed.sealed, true);
    assert.match(sealed.digest, /^[A-F0-9]{64}$/);
    assert.equal(sealed.physicalMotionPermitted, false);
    assert.equal(sealed.browserConfigurationJournal.sessionEvents, 1);

    const health = await fetch(`${address.url}/health`).then((response) => response.json());
    assert.equal(health.browserConfigurationJournal.lastCategory, "probing");
    assert.equal(health.browserConfigurationJournal.lastAction, "update");
    assert.equal(health.browserConfigurationJournal.physicalMotionPermitted, false);

    const records = verifyJournalRecords(await readFile(join(directory, "mr1-events.jsonl"), "utf8")).records;
    const record = records.find((candidate) => candidate.kind === "browser.configuration");
    assert.ok(record);
    assert.equal(record.payload.afterSha256, "B".repeat(64));
    assert.deepEqual(record.payload.changedPaths, ["toolSetter.clearanceMm", "touchProbe.maxTravelMm"]);
    assert.equal("rawConfiguration" in record.payload, false);
  } finally {
    await service.stop();
    await rm(directory, { recursive: true, force: true });
  }
});

test("disabled durable journal leaves browser evidence unacknowledged for retry", async () => {
  const service = createTelemetryService({ mode: "simulate", httpPort: 0, journalDirectory: false });
  const address = await service.start();
  try {
    const response = await fetch(`${address.url}/journal/configuration`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: ORIGIN },
      body: JSON.stringify(configurationEvent()),
    });
    assert.equal(response.status, 503);
    assert.equal((await response.json()).code, "JOURNAL_DISABLED");
  } finally {
    await service.stop();
  }
});
