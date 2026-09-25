import assert from "node:assert/strict";
import test from "node:test";

import { createTelemetryService, ownerTagFor } from "../service/mr1-telemetry-service.mjs";

const TOKEN = "P".repeat(43);
const PHONE_ORIGIN = "http://192.168.50.44:5173";

test("LAN service fails closed without a strong pairing token", () => {
  assert.throws(
    () => createTelemetryService({ mode: "simulate", httpHost: "0.0.0.0", httpPort: 0 }),
    /requires an explicit companion token/,
  );
  assert.throws(
    () => createTelemetryService({
      mode: "simulate",
      httpHost: "0.0.0.0",
      httpPort: 0,
      companionToken: "short",
    }),
    /32-128 base64url/,
  );
});

test("paired phone telemetry and virtual commands require both token and exact origin", async () => {
  const service = createTelemetryService({
    mode: "simulate",
    httpHost: "0.0.0.0",
    httpPort: 0,
    allowedOrigins: [PHONE_ORIGIN],
    companionToken: TOKEN,
    ownerDisconnectGraceMs: 5,
    virtualPhaseDelayMs: 5,
  });
  const address = await service.start();
  try {
    const unpaired = await fetch(`${address.url}/health`, { headers: { Origin: PHONE_ORIGIN } });
    assert.equal(unpaired.status, 401);
    assert.equal((await unpaired.json()).code, "COMPANION_PAIRING_REQUIRED");

    const wrongPair = await fetch(`${address.url}/health?pair=${"X".repeat(43)}`, {
      headers: { Origin: PHONE_ORIGIN },
    });
    assert.equal(wrongPair.status, 401);

    const deniedOrigin = await fetch(`${address.url}/health?pair=${TOKEN}`, {
      headers: { Origin: "https://example.com" },
    });
    assert.equal(deniedOrigin.status, 403);

    const healthResponse = await fetch(`${address.url}/health?pair=${TOKEN}`, {
      headers: { Origin: PHONE_ORIGIN },
    });
    assert.equal(healthResponse.status, 200);
    assert.equal(healthResponse.headers.get("access-control-allow-origin"), PHONE_ORIGIN);
    const health = await healthResponse.json();
    assert.deepEqual(health.companion, {
      protocol: "mr1-companion-access-v1",
      lanEnabled: true,
      pairingRequired: true,
      commandScope: "virtual-only",
      physicalMotionPermitted: false,
    });
    assert.equal(health.machineCommands.physicalEnabled, false);

    const unpairedLatency = await fetch(`${address.url}/latency/ping`, {
      headers: { Origin: PHONE_ORIGIN },
    });
    assert.equal(unpairedLatency.status, 401);
    const deniedLatencyOrigin = await fetch(`${address.url}/latency/ping?pair=${TOKEN}`, {
      headers: { Origin: "https://example.com" },
    });
    assert.equal(deniedLatencyOrigin.status, 403);
    const latencyResponse = await fetch(`${address.url}/latency/ping?pair=${TOKEN}`, {
      headers: { Origin: PHONE_ORIGIN },
    });
    assert.equal(latencyResponse.status, 200);
    assert.equal(latencyResponse.headers.get("access-control-allow-origin"), PHONE_ORIGIN);
    const latency = await latencyResponse.json();
    assert.equal(latency.protocol, "mr1-latency-ping-v1");
    assert.equal(latency.physicalMotionPermitted, false);

    const ownerId = "phone-owner-001";
    const commandResponse = await fetch(`${address.url}/machine/transactions?pair=${TOKEN}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: PHONE_ORIGIN },
      body: JSON.stringify({
        ownerId,
        requestId: "phone-request-001",
        observedStatusSequence: service.snapshot().latestStatus.sequence,
        intent: {
          type: "jog",
          axis: "x",
          direction: 1,
          distance: 0.1,
          feed: 100,
        },
      }),
    });
    assert.equal(commandResponse.status, 202);
    const command = await commandResponse.json();
    // The bearer ownerId must never be echoed or shared; a derived tag
    // identifies the owner instead.
    assert.equal(command.transaction.ownerId, undefined);
    assert.equal(command.transaction.ownerTag, ownerTagFor(ownerId));
    assert.equal(command.transaction.intent.type, "jog");
    assert.equal(command.machineCommands.physicalEnabled, false);
  } finally {
    await service.stop();
  }
});
