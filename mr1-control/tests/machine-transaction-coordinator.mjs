import assert from "node:assert/strict";
import test from "node:test";
import { MachineTransactionCoordinator } from "../service/machine-transaction-coordinator.mjs";
import { VirtualMr1Controller } from "../service/virtual-mr1-controller.mjs";
import { parseGrblStatus } from "../src/telemetry/grbl-status.js";

function statusLine(state = "Idle") {
  return `<${state}|MPos:-283.210,-273.050,-20.000|Bf:35,255|FS:0,0,0|WCO:-283.210,-273.050,-25.000|Pn:|Ov:100,100,100|A:|WCS:G54|T:3|P:0|H:1,7>`;
}

function parseStatus(line, sequence = 1) {
  return {
    ...parseGrblStatus(line, null, { receivedAt: new Date().toISOString() }),
    sequence,
  };
}

function wcsRequest(ownerId = "owner-one", requestId = "request-one") {
  return {
    ownerId,
    requestId,
    observedStatusSequence: 1,
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
}

async function waitFor(predicate, timeoutMs = 3000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const value = predicate();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("Timed out waiting for transaction state.");
}

test("virtual WCS transaction is acknowledged, observed, idempotent, and single-owner", async () => {
  let sequence = 1;
  let telemetry = parseStatus(statusLine(), sequence);
  const events = [];
  const controllerLines = [];
  const virtual = new VirtualMr1Controller({
    phaseDelayMs: 2,
    publishStatus: (line) => {
      sequence += 1;
      telemetry = {
        ...parseGrblStatus(line, telemetry, { receivedAt: new Date().toISOString() }),
        sequence,
      };
    },
    publishControllerLine: (line) => controllerLines.push(line),
  });
  const coordinator = new MachineTransactionCoordinator({
    mode: "simulate",
    enabled: true,
    executor: virtual,
    getTelemetry: () => telemetry,
    publish: (transaction) => events.push(transaction),
    leaseMs: 5000,
    idFactory: (value) => `tx-test-${value}`,
  });

  const accepted = coordinator.submit(wcsRequest());
  assert.equal(accepted.duplicate, false);
  const completed = await waitFor(() => events.find(({ id, state }) => id === accepted.transaction.id && state === "completed"));
  assert.equal(completed.result.wcs, "G54");
  assert.deepEqual(completed.result.wco, { x: -310, y: -240, z: -120 });
  assert.equal(completed.result.controllerAcknowledged, true);
  assert.ok(controllerLines.includes("ok"));
  assert.deepEqual(telemetry.position.wco, { x: -310, y: -240, z: -120 });
  assert.equal(telemetry.workCoordinateSystem, "G54");
  assert.equal(telemetry.state.name, "Idle");
  assert.equal(coordinator.lookup("owner-one", accepted.transaction.id).state, "completed");
  assert.throws(
    () => coordinator.lookup("owner-two", accepted.transaction.id),
    (error) => error.code === "TRANSACTION_OWNER_MISMATCH" && error.statusCode === 403,
  );

  const duplicate = coordinator.submit(wcsRequest());
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.transaction.id, accepted.transaction.id);
  assert.equal(events.filter(({ state }) => state === "completed").length, 1);

  assert.throws(
    () => coordinator.submit(wcsRequest("owner-two", "request-two")),
    (error) => error.code === "COMMAND_LEASE_HELD" && error.statusCode === 423,
  );
});

test("queued command is rechecked and fails closed when controller state changes", async () => {
  let telemetry = parseStatus(statusLine(), 1);
  let releaseFirst;
  const firstGate = new Promise((resolve) => { releaseFirst = resolve; });
  const events = [];
  let executionCount = 0;
  const executor = {
    execute: async (_intent, { onPhase }) => {
      executionCount += 1;
      onPhase("acknowledged", "controller-ok", 0.4, "ok");
      if (executionCount === 1) await firstGate;
      return { controllerAcknowledged: true };
    },
  };
  const coordinator = new MachineTransactionCoordinator({
    mode: "simulate",
    enabled: true,
    executor,
    getTelemetry: () => telemetry,
    publish: (transaction) => events.push(transaction),
    idFactory: (value) => `tx-gate-${value}`,
  });

  const first = coordinator.submit(wcsRequest("same-owner", "request-aaa"));
  const second = coordinator.submit(wcsRequest("same-owner", "request-bbb"));
  telemetry = parseStatus(statusLine("Door"), 2);
  releaseFirst();

  await waitFor(() => events.find(({ id, state }) => id === first.transaction.id && state === "completed"));
  const failed = await waitFor(() => events.find(({ id, state }) => id === second.transaction.id && state === "failed"));
  assert.equal(failed.error.code, "COMMAND_GATES_CHANGED");
  assert.ok(failed.blockers.some(({ id }) => id === "idle-state"));
  assert.equal(executionCount, 1);
});

test("virtual protected setter performs two contacts and mandatory retract before completion", async () => {
  let sequence = 1;
  let telemetry = parseStatus(statusLine(), sequence);
  const controllerLines = [];
  const events = [];
  const virtual = new VirtualMr1Controller({
    phaseDelayMs: 1,
    publishStatus: (line) => {
      sequence += 1;
      telemetry = {
        ...parseGrblStatus(line, telemetry, { receivedAt: new Date().toISOString() }),
        sequence,
      };
    },
    publishControllerLine: (line) => controllerLines.push(line),
  });
  const coordinator = new MachineTransactionCoordinator({
    mode: "simulate",
    enabled: true,
    executor: virtual,
    getTelemetry: () => telemetry,
    publish: (transaction) => events.push(transaction),
    idFactory: (value) => `tx-setter-${value}`,
  });
  const accepted = coordinator.submit({
    ownerId: "setter-owner",
    requestId: "setter-request",
    observedStatusSequence: 1,
    intent: {
      type: "tool-setter",
      inputQualified: true,
      profileQualified: true,
      expectedActiveTool: 3,
      settings: {
        x: -110,
        y: -80,
        travelZ: -20,
        referenceContactZ: -100,
        referenceGaugeLength: 40,
        currentToolNumber: 3,
        currentGaugeLength: 101.6,
        approachClearance: 2,
        maxSearch: 3,
        retractDistance: 5,
        guardedApproachFeed: 100,
        latchPullOff: 1,
        seekFeed: 50,
        latchFeed: 10,
        retractFeed: 50,
        doubleTouch: true,
      },
    },
  });
  const completed = await waitFor(() => events.find(({ id, state }) => id === accepted.transaction.id && state === "completed"));
  assert.equal(controllerLines.filter((line) => line.startsWith("[PRB:")).length, 2);
  assert.equal(completed.result.errorMm, 0);
  assert.ok(Math.abs(completed.result.contactRetractedToZ + 33.4) < 0.000001);
  assert.equal(completed.result.safeTravelZ, -20);
  assert.equal(telemetry.position.machine.z, -20);
  assert.equal(telemetry.state.name, "Idle");
  assert.equal(telemetry.pins.controls.probeTriggered, false);
  assert.ok(completed.history.some(({ phase }) => phase === "mandatory-retract"));
  assert.ok(completed.history.some(({ phase }) => phase === "safe-z-return"));
});

test("virtual bore cycle proves four corrected contacts, center returns, and final safe Z", async () => {
  let sequence = 1;
  let telemetry = parseStatus(statusLine(), sequence);
  const controllerLines = [];
  const events = [];
  const virtual = new VirtualMr1Controller({
    phaseDelayMs: 1,
    publishStatus: (line) => {
      sequence += 1;
      telemetry = {
        ...parseGrblStatus(line, telemetry, { receivedAt: new Date().toISOString() }),
        sequence,
      };
    },
    publishControllerLine: (line) => controllerLines.push(line),
  });
  const coordinator = new MachineTransactionCoordinator({
    mode: "simulate",
    enabled: true,
    executor: virtual,
    getTelemetry: () => telemetry,
    publish: (transaction) => events.push(transaction),
    idFactory: (value) => `tx-probe-${value}`,
  });
  const accepted = coordinator.submit({
    ownerId: "probe-owner",
    requestId: "probe-request",
    observedStatusSequence: 1,
    intent: {
      type: "touch-probe",
      inputQualified: true,
      profileQualified: true,
      probeQualified: true,
      probeId: "P1",
      qualifiedTipDiameter: 6,
      settings: {
        cycle: "bore-center",
        tipDiameter: 6,
        targetX: -283.21,
        targetY: -273.05,
        safeZ: -20,
        measurementZ: -40,
        featureDiameter: 14,
        directionX: 1,
        directionY: 1,
        cornerSampleOffset: 10,
        approachClearance: 4,
        maxSearch: 5,
        retractDistance: 3,
        guardedApproachFeed: 100,
        latchPullOff: 1,
        seekFeed: 25,
        latchFeed: 10,
        retractFeed: 100,
        doubleTouch: true,
      },
    },
  });
  const completed = await waitFor(
    () => events.find(({ id, state }) => id === accepted.transaction.id && state === "completed"),
    5000,
  );
  assert.equal(controllerLines.filter((line) => line.startsWith("[PRB:")).length, 8);
  assert.equal(completed.result.measurements.length, 4);
  assert.ok(completed.result.measurements.every(({ errorMm }) => Math.abs(errorMm) <= 0.001));
  assert.equal(completed.result.feature.centerX, -283.21);
  assert.equal(completed.result.feature.centerY, -273.05);
  assert.equal(completed.result.feature.diameter, 14);
  assert.equal(completed.result.finalMachinePosition.z, -20);
  assert.equal(telemetry.state.name, "Idle");
  assert.equal(telemetry.pins.controls.probeTriggered, false);
  assert.ok(completed.history.some(({ phase }) => phase.endsWith("-mandatory-retract")));
  assert.ok(completed.history.some(({ phase }) => phase.endsWith("-clearance-return")));
});

test("execution deadline aborts a stalled command and records a timeout failure", async () => {
  const telemetry = parseStatus(statusLine(), 1);
  const events = [];
  let observedAbort = false;
  const coordinator = new MachineTransactionCoordinator({
    mode: "simulate",
    enabled: true,
    executionTimeoutMs: 10,
    executor: {
      execute: async (intent, { signal }) => new Promise((resolve, reject) => {
        signal.addEventListener("abort", () => {
          observedAbort = true;
          reject(Object.assign(new Error("aborted"), { code: "COMMAND_CANCELLED" }));
        }, { once: true });
      }),
    },
    getTelemetry: () => telemetry,
    publish: (transaction) => events.push(transaction),
    idFactory: (value) => `tx-timeout-${value}`,
  });
  const accepted = coordinator.submit({
    ownerId: "timeout-owner",
    requestId: "timeout-request",
    observedStatusSequence: 1,
    intent: {
      type: "jog",
      axis: "x",
      direction: 1,
      distance: 1,
      feed: 100,
      coordinateMode: "machine",
    },
  });
  const failed = await waitFor(() => events.find(({ id, state }) => (
    id === accepted.transaction.id && state === "failed"
  )));
  assert.equal(observedAbort, true);
  assert.equal(failed.phase, "execution-timeout");
  assert.equal(failed.error.code, "COMMAND_TIMEOUT");
  assert.match(failed.error.message, /10 ms deadline/);
});

test("only the owner can cancel an active transaction and the executor observes the abort", async () => {
  let telemetry = parseStatus(statusLine(), 1);
  let sequence = 1;
  const events = [];
  const virtual = new VirtualMr1Controller({
    phaseDelayMs: 30,
    publishStatus: (line) => {
      sequence += 1;
      telemetry = {
        ...parseGrblStatus(line, telemetry, { receivedAt: new Date().toISOString() }),
        sequence,
      };
    },
  });
  const coordinator = new MachineTransactionCoordinator({
    mode: "simulate",
    enabled: true,
    executor: virtual,
    getTelemetry: () => telemetry,
    publish: (transaction) => events.push(transaction),
    idFactory: (value) => `tx-cancel-${value}`,
  });
  const accepted = coordinator.submit({
    ownerId: "cancel-owner",
    requestId: "cancel-request",
    observedStatusSequence: 1,
    intent: {
      type: "jog",
      axis: "x",
      direction: 1,
      distance: 10,
      feed: 100,
      coordinateMode: "machine",
    },
  });
  await waitFor(() => events.find(({ id, state }) => id === accepted.transaction.id && state === "running"));
  assert.throws(
    () => coordinator.cancel("wrong-owner", accepted.transaction.id),
    (error) => error.code === "TRANSACTION_OWNER_MISMATCH" && error.statusCode === 403,
  );
  const cancelling = coordinator.cancel("cancel-owner", accepted.transaction.id);
  assert.equal(cancelling.state, "cancelling");
  const cancelled = await waitFor(() => events.find(({ id, state }) => id === accepted.transaction.id && state === "cancelled"));
  assert.equal(cancelled.error.code, "COMMAND_CANCELLED");
  assert.equal(virtual.state, "Hold");
  assert.equal(virtual.feed, 0);
});

test("service stop aborts active work and drains queued transactions", async () => {
  const telemetry = parseStatus(statusLine(), 1);
  let releaseExecution;
  const held = new Promise((resolve) => { releaseExecution = resolve; });
  const events = [];
  const executor = {
    execute: async (_intent, { signal }) => Promise.race([
      held,
      new Promise((_, reject) => signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true })),
    ]),
  };
  const coordinator = new MachineTransactionCoordinator({
    mode: "simulate",
    enabled: true,
    executor,
    getTelemetry: () => telemetry,
    publish: (transaction) => events.push(transaction),
    idFactory: (value) => `tx-stop-${value}`,
  });
  const first = coordinator.submit(wcsRequest("stop-owner", "stop-first"));
  const second = coordinator.submit(wcsRequest("stop-owner", "stop-second"));
  await waitFor(() => events.find(({ id, state }) => id === first.transaction.id && state === "dispatching"));
  await coordinator.stop();
  releaseExecution();
  const firstFinal = events.find(({ id, state }) => id === first.transaction.id && state === "cancelled");
  const secondFinal = events.find(({ id, state }) => id === second.transaction.id && state === "cancelled");
  assert.equal(firstFinal?.phase, "abort-observed");
  assert.equal(secondFinal?.phase, "service-stopped");
  assert.equal(coordinator.snapshot().queueDepth, 0);
  assert.equal(coordinator.snapshot().activeTransactionId, null);
});

test("owner disconnect purges the owner's queued transactions, not just the active one", async () => {
  const telemetry = parseStatus(statusLine(), 1);
  let releaseExecution;
  const held = new Promise((resolve) => { releaseExecution = resolve; });
  const events = [];
  const executor = {
    execute: async (_intent, { signal }) => Promise.race([
      held,
      new Promise((_, reject) => signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true })),
    ]),
  };
  const coordinator = new MachineTransactionCoordinator({
    mode: "simulate",
    enabled: true,
    executor,
    getTelemetry: () => telemetry,
    publish: (transaction) => events.push(transaction),
    idFactory: (value) => `tx-gone-${value}`,
  });
  const first = coordinator.submit(wcsRequest("gone-owner", "gone-first"));
  const second = coordinator.submit(wcsRequest("gone-owner", "gone-second"));
  const third = coordinator.submit(wcsRequest("gone-owner", "gone-third"));
  await waitFor(() => events.find(({ id, state }) => id === first.transaction.id && state === "dispatching"));
  const cancelled = coordinator.cancelAllForOwner("gone-owner", "owner-disconnected");
  assert.equal(cancelled.length, 3);
  releaseExecution();
  const secondFinal = await waitFor(() => events.find(({ id, state }) => id === second.transaction.id && state === "cancelled"));
  const thirdFinal = await waitFor(() => events.find(({ id, state }) => id === third.transaction.id && state === "cancelled"));
  assert.equal(secondFinal.error.code, "COMMAND_OWNER_DISCONNECTED");
  assert.equal(thirdFinal.error.code, "COMMAND_OWNER_DISCONNECTED");
  await waitFor(() => events.find(({ id, state }) => id === first.transaction.id && state === "cancelled"));
  assert.equal(coordinator.snapshot().queueDepth, 0);
  await coordinator.stop();
});
