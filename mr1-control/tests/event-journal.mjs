import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  EVENT_JOURNAL_PROTOCOL,
  createEventJournal,
  reconcileJournalRecords,
  verifyJournalRecords,
} from "../service/event-journal.mjs";
import {
  JOURNAL_RECONCILIATION_ACK_PROTOCOL,
  createTelemetryService,
} from "../service/mr1-telemetry-service.mjs";

async function withJournalDirectory(run) {
  const directory = await mkdtemp(join(tmpdir(), "mr1-journal-"));
  try {
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("journal persists a SHA-256 chain and a durable stop record", async () => {
  await withJournalDirectory(async (directory) => {
    let tick = 0;
    const journal = createEventJournal({
      directory,
      sessionId: "SESSION-A",
      now: () => new Date(Date.UTC(2026, 7, 27, 12, 0, tick++)).toISOString(),
    });
    await journal.append("service.start", { mode: "simulate" }, { sync: true });
    await journal.append("machine.transaction", { id: "TX-1", state: "completed" });
    await journal.close({ reason: "test" });

    const result = verifyJournalRecords(await journal.exportText());
    assert.equal(result.sessions, 1);
    assert.deepEqual(result.records.map((record) => record.kind), [
      "service.start",
      "machine.transaction",
      "service.stop",
    ]);
    assert.equal(result.records[0].protocol, EVENT_JOURNAL_PROTOCOL);
    assert.equal(result.records[0].previousDigest, null);
    assert.equal(result.records[1].previousDigest, result.records[0].digest);
    assert.equal(journal.status().entries, 3);
    assert.match(journal.status().lastDigest, /^[A-F0-9]{64}$/);
  });
});

test("journal detects edited evidence", async () => {
  await withJournalDirectory(async (directory) => {
    const journal = createEventJournal({ directory, sessionId: "SESSION-B" });
    await journal.append("controller.event", { message: "ok" });
    const exported = await journal.exportText();
    assert.throws(
      () => verifyJournalRecords(exported.replace('"message":"ok"', '"message":"edited"')),
      /digest verification failed/i,
    );
    await journal.close();
  });
});

test("journal rotates within its file budget and retains a verifiable tail", async () => {
  await withJournalDirectory(async (directory) => {
    const journal = createEventJournal({
      directory,
      sessionId: "SESSION-C",
      maxFileBytes: 512,
      maxFiles: 3,
    });
    for (let index = 0; index < 12; index += 1) {
      await journal.append("telemetry.snapshot", { index, sample: "x".repeat(260) });
    }
    const names = (await readdir(directory)).filter((name) => name.startsWith("mr1-events.jsonl"));
    assert.ok(names.length <= 3);
    assert.ok(journal.status().rotations > 0);
    const verified = verifyJournalRecords(await journal.exportText());
    assert.ok(verified.records.length > 0);
    assert.ok(verified.records.length < 12);
    await journal.close();
  });
});

test("journal bounds oversized payloads without losing the event", async () => {
  await withJournalDirectory(async (directory) => {
    const journal = createEventJournal({ directory, maxPayloadBytes: 256 });
    await journal.append("controller.event", { raw: "z".repeat(4000) });
    const [record] = verifyJournalRecords(await journal.exportText()).records;
    assert.equal(record.payload.truncated, true);
    assert.ok(record.payload.originalBytes > 4000);
    assert.ok(record.payload.preview.length < 256);
    await journal.close();
  });
});

test("journal can be explicitly disabled", async () => {
  const journal = createEventJournal({ directory: false });
  assert.equal(await journal.append("service.start", {}), null);
  assert.equal(await journal.exportText(), "");
  assert.deepEqual(journal.status(), { enabled: false, state: "DISABLED", entries: 0 });
});

test("a failed write does not burn a sequence number or break the chain", async () => {
  await withJournalDirectory(async (directory) => {
    const journal = createEventJournal({ directory, sessionId: "SESSION-FAIL" });
    await journal.append("service.start", { mode: "simulate" }, { sync: true });
    // An invalid kind throws inside writeRecord before any I/O; the next
    // good record must still chain and verify.
    assert.equal(await journal.append("INVALID KIND!", {}), null);
    await journal.append("controller.event", { message: "after-failure" });
    const verified = verifyJournalRecords(await journal.exportText());
    assert.deepEqual(verified.records.map((record) => record.sequence), [1, 2]);
    assert.equal(verified.records[1].previousDigest, verified.records[0].digest);
    await journal.close();
  });
});

test("a torn final line is tolerated as a power-loss artifact, never a clean state", async () => {
  await withJournalDirectory(async (directory) => {
    const journal = createEventJournal({ directory, sessionId: "SESSION-TORN" });
    await journal.append("service.start", { mode: "simulate" }, { sync: true });
    await journal.close({ reason: "test" });
    const torn = `${await journal.exportText()}{"protocol":"mr1-event-jou`;
    const verified = verifyJournalRecords(torn);
    assert.equal(verified.tornTail, true);
    assert.equal(verified.records.length, 2);
    const reconciled = reconcileJournalRecords(torn);
    assert.equal(reconciled.integrity, "PASS");
    assert.equal(reconciled.state, "INTERRUPTED");
    assert.equal(reconciled.commandInterlock, "HELD");
    assert.equal(reconciled.reviewable, true);
    assert.match(reconciled.message, /TORN/);
    // A torn line anywhere else is still corruption.
    const midTorn = torn.replace(/\n/, "\ngarbage-line\n");
    assert.equal(reconcileJournalRecords(midTorn).state, "CORRUPT");
  });
});

test("deleting journal files cannot pass reconciliation once a head anchor exists", async () => {
  await withJournalDirectory(async (directory) => {
    const journal = createEventJournal({ directory, sessionId: "SESSION-ANCHOR" });
    await journal.append("service.start", { mode: "simulate" }, { sync: true });
    await journal.close({ reason: "test" });
    const head = JSON.parse(await readFile(join(directory, "mr1-journal-head.json"), "utf8"));
    assert.equal(head.sessionId, "SESSION-ANCHOR");
    const text = await journal.exportText();
    // Full journal + matching head reconciles normally.
    assert.equal(reconcileJournalRecords(text, { head }).state, "CLEAN");
    // Journal truncated to only its first line no longer contains the
    // anchored head record and must fail closed.
    const firstLineOnly = `${text.split("\n")[0]}\n`;
    const clipped = reconcileJournalRecords(firstLineOnly, { head });
    assert.equal(clipped.state, "CORRUPT");
    assert.equal(clipped.commandInterlock, "HELD");
    assert.match(clipped.error, /anchored head/i);
  });
});

test("restart reconciliation distinguishes new, clean, and unclean sessions", async () => {
  assert.equal(reconcileJournalRecords("").state, "NEW");

  await withJournalDirectory(async (directory) => {
    const journal = createEventJournal({ directory, sessionId: "SESSION-RESTART" });
    await journal.append("service.start", { mode: "simulate" }, { sync: true });
    const unclean = reconcileJournalRecords(await journal.exportText());
    assert.equal(unclean.state, "UNCLEAN");
    assert.equal(unclean.integrity, "PASS");
    assert.equal(unclean.requiresReview, true);
    assert.equal(unclean.reviewable, true);
    assert.equal(unclean.commandInterlock, "HELD");
    assert.match(unclean.reconciliationId, /^[A-F0-9]{64}$/);

    await journal.close({ reason: "test" });
    const clean = reconcileJournalRecords(await journal.exportText());
    assert.equal(clean.state, "CLEAN");
    assert.equal(clean.cleanShutdown, true);
    assert.equal(clean.requiresReview, false);
    assert.equal(clean.commandInterlock, "CLEAR");
  });
});

test("restart reconciliation preserves bounded unfinished transaction evidence", async () => {
  await withJournalDirectory(async (directory) => {
    const journal = createEventJournal({ directory, sessionId: "SESSION-INTERRUPTED" });
    await journal.append("service.start", { mode: "simulate" }, { sync: true });
    await journal.append("machine.transaction", {
      id: "TX-INTERRUPTED",
      requestId: "REQ-INTERRUPTED",
      state: "executing",
      phase: "moving-to-contact",
      updatedAt: "2026-08-27T21:00:00.000Z",
      intent: { type: "tool-setter" },
    }, { sync: true });

    const result = reconcileJournalRecords(await journal.exportText());
    assert.equal(result.state, "INTERRUPTED");
    assert.equal(result.unfinishedCount, 1);
    assert.equal(result.unfinishedTransactions[0].id, "TX-INTERRUPTED");
    assert.equal(result.unfinishedTransactions[0].intentType, "tool-setter");
    assert.equal(result.physicalMotionPermitted, false);
  });
});

test("restart reconciliation treats edited or structurally invalid evidence as corrupt", async () => {
  await withJournalDirectory(async (directory) => {
    const journal = createEventJournal({ directory, sessionId: "SESSION-CORRUPT" });
    await journal.append("service.start", { mode: "simulate" });
    await journal.append("controller.event", { message: "ok" });
    const exported = await journal.exportText();
    const corrupt = reconcileJournalRecords(exported.replace('"message":"ok"', '"message":"edited"'));
    assert.equal(corrupt.state, "CORRUPT");
    assert.equal(corrupt.integrity, "FAIL");
    assert.equal(corrupt.reviewable, false);
    assert.equal(corrupt.commandInterlock, "HELD");

    const lines = exported.trim().split(/\r?\n/);
    const second = JSON.parse(lines[1]);
    second.sequence += 1;
    const structurallyInvalid = `${lines[0]}\n${JSON.stringify(second)}\n`;
    assert.throws(() => verifyJournalRecords(structurallyInvalid), /sequence|digest/i);
  });
});

test("interrupted restart holds virtual commands until exact review is journaled", async () => {
  await withJournalDirectory(async (directory) => {
    const previous = createEventJournal({ directory, sessionId: "CRASHED-SESSION" });
    await previous.append("service.start", { mode: "simulate" }, { sync: true });
    await previous.append("machine.transaction", {
      id: "TX-CRASHED",
      requestId: "REQ-CRASHED",
      state: "dispatching",
      phase: "dispatching",
      updatedAt: new Date().toISOString(),
      intent: { type: "jog" },
    }, { sync: true });

    const service = createTelemetryService({
      mode: "simulate",
      httpPort: 0,
      fissionRoot: false,
      journalDirectory: directory,
      virtualPhaseDelayMs: 5,
    });
    const address = await service.start();
    try {
      const health = await fetch(`${address.url}/health`).then((response) => response.json());
      assert.equal(health.restartReconciliation.state, "INTERRUPTED");
      assert.equal(health.restartReconciliation.commandInterlock, "HELD");
      assert.equal(health.restartReconciliation.acknowledgeable, true);
      assert.equal(health.machineCommands.enabled, false);

      const commandBody = {
        ownerId: "restart-owner",
        requestId: "restart-wcs-held",
        observedStatusSequence: service.snapshot().latestStatus.sequence,
        intent: {
          type: "apply-work-offset",
          wcs: "G54",
          fixtureId: "V1",
          offset: { x: -310, y: -240, z: -120 },
          mapVersion: 5,
          frameQualified: true,
          locationsVerified: true,
        },
      };
      const held = await fetch(`${address.url}/machine/transactions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: "http://127.0.0.1:5173" },
        body: JSON.stringify(commandBody),
      });
      assert.equal(held.status, 409);

      const unknownField = await fetch(`${address.url}/journal/reconciliation/acknowledge`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: "http://127.0.0.1:5173" },
        body: JSON.stringify({
          protocol: JOURNAL_RECONCILIATION_ACK_PROTOCOL,
          reconciliationId: health.restartReconciliation.reconciliationId,
          confirmed: true,
          gcode: "$X",
        }),
      });
      assert.equal(unknownField.status, 400);
      assert.equal((await unknownField.json()).code, "INVALID_RECONCILIATION_REQUEST");

      const stale = await fetch(`${address.url}/journal/reconciliation/acknowledge`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: "http://127.0.0.1:5173" },
        body: JSON.stringify({
          protocol: JOURNAL_RECONCILIATION_ACK_PROTOCOL,
          reconciliationId: "0".repeat(64),
          confirmed: true,
        }),
      });
      assert.equal(stale.status, 409);

      const acknowledged = await fetch(`${address.url}/journal/reconciliation/acknowledge`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: "http://127.0.0.1:5173" },
        body: JSON.stringify({
          protocol: JOURNAL_RECONCILIATION_ACK_PROTOCOL,
          reconciliationId: health.restartReconciliation.reconciliationId,
          confirmed: true,
        }),
      });
      assert.equal(acknowledged.status, 200);
      const acknowledgement = await acknowledged.json();
      assert.equal(acknowledgement.restartReconciliation.acknowledged, true);
      assert.equal(acknowledgement.restartReconciliation.commandInterlock, "CLEAR");
      assert.equal(acknowledgement.restartReconciliation.physicalMotionPermitted, false);
      assert.equal(acknowledgement.machineCommands.enabled, true);

      const accepted = await fetch(`${address.url}/machine/transactions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: "http://127.0.0.1:5173" },
        body: JSON.stringify({ ...commandBody, requestId: "restart-wcs-released" }),
      });
      assert.equal(accepted.status, 202);
    } finally {
      await service.stop();
    }

    const records = verifyJournalRecords(await readFile(join(directory, "mr1-events.jsonl"), "utf8")).records;
    assert.ok(records.some((record) => record.kind === "service.reconciliation-acknowledged"));
  });
});

test("telemetry service journals lifecycle, state, and typed transactions for export", async () => {
  await withJournalDirectory(async (directory) => {
    const service = createTelemetryService({
      mode: "simulate",
      httpPort: 0,
      fissionRoot: false,
      journalDirectory: directory,
      virtualPhaseDelayMs: 5,
    });
    const address = await service.start();
    try {
      const health = await fetch(`${address.url}/health`).then((response) => response.json());
      assert.equal(health.journal.enabled, true);
      assert.equal(health.journal.state, "ACTIVE");
      assert.ok(health.journal.entries >= 1);
      assert.equal(health.journalExportUrl, `${address.url}/journal/export`);

      const response = await fetch(`${address.url}/machine/transactions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: "http://127.0.0.1:5173" },
        body: JSON.stringify({
          ownerId: "journal-owner",
          requestId: "journal-wcs",
          observedStatusSequence: service.snapshot().latestStatus.sequence,
          intent: {
            type: "apply-work-offset",
            wcs: "G54",
            fixtureId: "V1",
            offset: { x: -310, y: -240, z: -120 },
            mapVersion: 5,
            frameQualified: true,
            locationsVerified: true,
          },
        }),
      });
      assert.equal(response.status, 202);
      const startedAt = Date.now();
      while (service.snapshot().latestTransaction?.state !== "completed") {
        if (Date.now() - startedAt > 2000) throw new Error("Journal test transaction did not complete.");
        await new Promise((resolve) => setTimeout(resolve, 5));
      }

      const exported = await fetch(`${address.url}/journal/export`, {
        headers: { Origin: "http://127.0.0.1:5173" },
      });
      assert.equal(exported.status, 200);
      assert.match(exported.headers.get("content-disposition"), /^attachment; filename="mr1-events-/);
      const records = verifyJournalRecords(await exported.text()).records;
      assert.ok(records.some((record) => record.kind === "service.start"));
      assert.ok(records.some((record) => record.kind === "controller.preflight"));
      assert.ok(records.some((record) => record.kind === "telemetry.snapshot"));
      assert.ok(records.some((record) => (
        record.kind === "machine.transaction" && record.payload.state === "completed"
      )));

      const denied = await fetch(`${address.url}/journal/export`, {
        headers: { Origin: "https://example.com" },
      });
      assert.equal(denied.status, 403);
    } finally {
      await service.stop();
    }

    const finalRecords = verifyJournalRecords(await readFile(join(directory, "mr1-events.jsonl"), "utf8")).records;
    assert.equal(finalRecords.at(-1).kind, "service.stop");
  });
});
