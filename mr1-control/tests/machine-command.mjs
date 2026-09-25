import assert from "node:assert/strict";
import test from "node:test";
import {
  MachineCommandError,
  evaluateMachineCommand,
  normalizeMachineIntent,
  normalizeMachineRequest,
} from "../src/machine-command.js";
import { MachineCommandClient, MachineCommandRequestError } from "../src/machine-command-client.js";
import { parseGrblStatus } from "../src/telemetry/grbl-status.js";

function telemetry(overrides = {}) {
  const state = overrides.state ?? "Idle";
  const pins = overrides.pins ?? "";
  const homed = overrides.homed === false ? 0 : 1;
  const sequence = overrides.sequence ?? 40;
  const status = parseGrblStatus(
    `<${state}|MPos:-283.210,-273.050,-20.000|Bf:35,255|FS:0,0,0|WCO:-283.210,-273.050,-25.000|Pn:${pins}|Ov:100,100,100|A:|WCS:G54|T:3|P:0|H:${homed},7>`,
    null,
    { receivedAt: new Date(1_000_000).toISOString() },
  );
  return { ...status, sequence };
}

function context(overrides = {}) {
  return {
    commandsEnabled: true,
    telemetry: telemetry(overrides),
    telemetryAgeMs: overrides.telemetryAgeMs ?? 20,
    observedStatusSequence: overrides.observedStatusSequence ?? 40,
  };
}

const validWcsIntent = Object.freeze({
  type: "apply-work-offset",
  wcs: "G54",
  fixtureId: "V1",
  offset: { x: -310, y: -240, z: -120 },
  mapVersion: 5,
  frameQualified: true,
  locationsVerified: true,
});

const validSetterSettings = Object.freeze({
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
});

const validTouchSettings = Object.freeze({
  cycle: "bore-center",
  tipDiameter: 6,
  targetX: -283.21,
  targetY: -273.05,
  targetZ: null,
  safeZ: -20,
  measurementZ: -40,
  directionX: 1,
  directionY: 1,
  featureDiameter: 14,
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
});

test("machine command schema is typed and rejects arbitrary G-code", () => {
  assert.throws(
    () => normalizeMachineIntent({ type: "gcode", command: "G0 X1" }),
    (error) => error instanceof MachineCommandError && error.code === "MACHINE_INTENT_NOT_ALLOWED",
  );
  assert.throws(
    () => normalizeMachineRequest({ ownerId: "operator1", requestId: "request1", intent: "G0 X1" }),
    /Machine intent must be an object/,
  );
  assert.throws(
    () => normalizeMachineIntent({ ...validWcsIntent, wcs: "G54", fixtureId: "V2" }),
    /reserved for V1/,
  );
});

test("work offset requires qualified map evidence and a safe live controller", () => {
  const ready = evaluateMachineCommand(validWcsIntent, context());
  assert.equal(ready.permitted, true);
  assert.deepEqual(ready.blockers, []);

  const unqualified = evaluateMachineCommand(
    { ...validWcsIntent, frameQualified: false, locationsVerified: false },
    context(),
  );
  assert.equal(unqualified.permitted, false);
  assert.deepEqual(
    unqualified.blockers.map(({ id }) => id),
    ["qualified-table-frame", "verified-fixtures"],
  );

  for (const [name, overrides, gateId] of [
    ["stale", { telemetryAgeMs: 2000 }, "fresh-status"],
    ["not homed", { homed: false }, "homed-session"],
    ["E-stop", { pins: "E" }, "safety-inputs"],
    ["limit", { pins: "X" }, "limit-inputs"],
    ["running", { state: "Run" }, "idle-state"],
  ]) {
    const evaluation = evaluateMachineCommand(validWcsIntent, context(overrides));
    assert.equal(evaluation.permitted, false, name);
    assert.ok(evaluation.blockers.some(({ id }) => id === gateId), name);
  }
});

test("jog derives its target from fresh MPOS and blocks travel beyond the envelope", () => {
  const ready = evaluateMachineCommand({
    type: "jog",
    axis: "x",
    direction: 1,
    distance: 10,
    feed: 500,
    coordinateMode: "work",
  }, context());
  assert.equal(ready.permitted, true);
  assert.equal(ready.details.target, -273.21);

  const outside = evaluateMachineCommand({
    type: "jog",
    axis: "z",
    direction: 1,
    distance: 10,
    feed: 500,
  }, {
    ...context(),
    telemetry: parseGrblStatus(
      "<Idle|MPos:-283.210,-273.050,-3.000|FS:0,0,0|WCO:-283.210,-273.050,-25.000|Pn:|A:|WCS:G54|T:3|P:0|H:1,7>",
      null,
      { receivedAt: new Date(1_000_000).toISOString() },
    ),
  });
  assert.equal(outside.permitted, false);
  assert.ok(outside.blockers.some(({ id }) => id === "jog-target-envelope"));
});

test("protected tool setter requires tool match, open input, zero spindle, and input qualification", () => {
  const intent = {
    type: "tool-setter",
    settings: validSetterSettings,
    inputQualified: true,
    profileQualified: true,
    expectedActiveTool: 3,
  };
  assert.equal(evaluateMachineCommand(intent, context()).permitted, true);

  const unqualified = evaluateMachineCommand({ ...intent, inputQualified: false }, context());
  assert.ok(unqualified.blockers.some(({ id }) => id === "tool-setter-input"));

  const triggered = evaluateMachineCommand(intent, context({ pins: "P" }));
  assert.ok(triggered.blockers.some(({ id }) => id === "probe-open-before-cycle"));

  const mismatch = evaluateMachineCommand({
    ...intent,
    settings: { ...validSetterSettings, currentToolNumber: 7 },
    expectedActiveTool: 7,
  }, context());
  assert.ok(mismatch.blockers.some(({ id }) => id === "tool-setter-profile"));
  assert.ok(mismatch.blockers.some(({ id }) => id === "active-tool-match"));
});

test("protected touch probing requires a bounded plan, primary input, and qualified probe", () => {
  const intent = {
    type: "touch-probe",
    settings: validTouchSettings,
    inputQualified: true,
    profileQualified: true,
    probeQualified: true,
    probeId: "P1",
    qualifiedTipDiameter: 6,
  };
  const ready = evaluateMachineCommand(intent, context());
  assert.equal(ready.permitted, true);
  assert.equal(ready.details.touchProbe.plan.contactCount, 4);

  const unqualified = evaluateMachineCommand({ ...intent, inputQualified: false, probeQualified: false }, context());
  assert.ok(unqualified.blockers.some(({ id }) => id === "touch-probe-input"));
  assert.ok(unqualified.blockers.some(({ id }) => id === "touch-probe-calibration"));

  const tipMismatch = evaluateMachineCommand({ ...intent, qualifiedTipDiameter: 4 }, context());
  assert.ok(tipMismatch.blockers.some(({ id }) => id === "touch-probe-tip-match"));

  const triggered = evaluateMachineCommand(intent, context({ pins: "P" }));
  assert.ok(triggered.blockers.some(({ id }) => id === "probe-open-before-cycle"));

  const incomplete = evaluateMachineCommand({
    ...intent,
    settings: { ...validTouchSettings, safeZ: null },
  }, context());
  assert.ok(incomplete.blockers.some(({ id }) => id === "touch-probe-profile"));
});

test("browser command client submits typed intents and owner-authenticated cancellation", async () => {
  const calls = [];
  const fakeFetch = async (url, options) => {
    calls.push({ url, options, body: JSON.parse(options.body) });
    return new Response(JSON.stringify({
      transaction: {
        protocol: "mr1-machine-transaction-v1",
        id: "tx-client-1",
        ownerId: "client-owner",
        state: url.endsWith("/cancel") ? "cancelling" : "queued",
      },
    }), { status: url.endsWith("/cancel") ? 202 : 202, headers: { "Content-Type": "application/json" } });
  };
  const client = new MachineCommandClient({
    ownerId: "client-owner",
    fetch: fakeFetch,
    randomUuid: () => "client-request-id",
  });
  await client.submit({
    type: "jog",
    axis: "x",
    direction: 1,
    distance: 1,
    feed: 100,
  }, { observedStatusSequence: 12 });
  await client.cancel("tx-client-1");
  assert.equal(calls[0].body.ownerId, "client-owner");
  assert.equal(calls[0].body.requestId, "req-client-request-id-1");
  assert.equal(calls[0].body.observedStatusSequence, 12);
  assert.equal(calls[0].body.intent.type, "jog");
  assert.deepEqual(calls[1].body, { ownerId: "client-owner", transactionId: "tx-client-1" });
});

test("browser command client preserves structured rejection details", async () => {
  const client = new MachineCommandClient({
    ownerId: "client-owner",
    fetch: async () => new Response(JSON.stringify({
      error: "HOME MACHINE FIRST",
      code: "COMMAND_GATES_BLOCKED",
      details: { transaction: { id: "tx-rejected", state: "rejected" } },
    }), { status: 409, headers: { "Content-Type": "application/json" } }),
    randomUuid: () => "rejected-request",
  });
  await assert.rejects(
    () => client.submit(validWcsIntent),
    (error) => (
      error instanceof MachineCommandRequestError
      && error.code === "COMMAND_GATES_BLOCKED"
      && error.payload.details.transaction.id === "tx-rejected"
    ),
  );
});

test("browser command client reconciles a terminal transaction without SSE delivery", async () => {
  let lookups = 0;
  const updates = [];
  const client = new MachineCommandClient({
    ownerId: "polling-owner",
    fetch: async (url, options) => {
      assert.equal(options.method, "GET");
      const requestUrl = new URL(url);
      assert.equal(requestUrl.searchParams.get("ownerId"), "polling-owner");
      assert.equal(requestUrl.searchParams.get("transactionId"), "tx-polling-1");
      lookups += 1;
      return new Response(JSON.stringify({
        transaction: {
          protocol: "mr1-machine-transaction-v1",
          id: "tx-polling-1",
          ownerId: "polling-owner",
          sequence: lookups,
          state: lookups >= 2 ? "completed" : "running",
        },
        machineCommands: { enabled: true },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    },
    requestTimeoutMs: 250,
  });
  const payload = await client.waitForTerminal("tx-polling-1", {
    timeoutMs: 1000,
    pollMs: 25,
    onUpdate: (transaction) => updates.push(transaction.state),
  });
  assert.equal(payload.transaction.state, "completed");
  assert.deepEqual(updates, ["running", "completed"]);
});
