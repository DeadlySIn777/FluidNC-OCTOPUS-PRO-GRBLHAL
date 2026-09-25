import assert from "node:assert/strict";
import { request as httpRequest } from "node:http";
import test from "node:test";
import {
  createTelemetryService,
  sensorCalibrationCapabilities,
  sensorCalibrationCommand,
  sensorCalibrationIsAvailable,
  SENSOR_WRITE_POLICY,
  SERIAL_WRITE_POLICY,
  CONTROLLER_SETTINGS_WRITE_POLICY,
} from "../service/mr1-telemetry-service.mjs";
import { CONTROLLER_SETTINGS_PLAN_PROTOCOL } from "../src/controller-settings.js";

async function readEvent(response, eventName) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const timeout = setTimeout(() => reader.cancel(), 3000);
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      for (const frame of buffer.split("\n\n")) {
        if (!frame.includes(`event: ${eventName}`)) continue;
        const data = frame.split("\n").find((line) => line.startsWith("data: "));
        if (data) return JSON.parse(data.slice(6));
      }
    }
  } finally {
    clearTimeout(timeout);
    await reader.cancel();
  }
  throw new Error(`No ${eventName} event received.`);
}

function requestWithHost(url, host) {
  const target = new URL(url);
  return new Promise((resolve, reject) => {
    const request = httpRequest({
      hostname: target.hostname,
      port: target.port,
      path: `${target.pathname}${target.search}`,
      headers: { Host: host },
    }, (response) => {
      response.resume();
      response.on("end", () => resolve(response.statusCode));
    });
    request.on("error", reject);
    request.end();
  });
}

test("sensor calibration commands are a closed allow-list", () => {
  assert.equal(sensorCalibrationCommand("start").toString("ascii"), "CAL\n");
  assert.equal(sensorCalibrationCommand("clear").toString("ascii"), "CAL:CLEAR\n");
  assert.equal(sensorCalibrationCommand("STATUS"), null);
  assert.equal(sensorCalibrationCommand("G0 X1"), null);
});

test("sensor calibration availability requires transport and an advertised command", () => {
  const legacy = { calibration: { commandStartSupported: false, commandClearSupported: false, persisted: false } };
  const durable = { calibration: { commandStartSupported: true, commandClearSupported: true, persisted: true } };
  assert.deepEqual(sensorCalibrationCapabilities(legacy), { start: false, clear: false, persisted: false });
  assert.equal(sensorCalibrationIsAvailable(legacy, true), false);
  assert.equal(sensorCalibrationIsAvailable(durable, false), false);
  assert.equal(sensorCalibrationIsAvailable(durable, true), true);
});

test("simulation bridge exposes loopback telemetry and a typed virtual machine transaction path", async () => {
  const service = createTelemetryService({
    mode: "simulate",
    httpPort: 0,
    fissionRoot: false,
    ownerDisconnectGraceMs: 5,
    virtualPhaseDelayMs: 25,
  });
  const address = await service.start();
  try {
    assert.equal(address.host, "127.0.0.1");
    const health = await fetch(`${address.url}/health`).then((response) => response.json());
    assert.equal(health.connected, true);
    assert.equal(health.readOnly, true);
    assert.equal(health.serialWritePolicy, SERIAL_WRITE_POLICY);
    assert.equal(health.controllerPreflight.protocol, "mr1-controller-preflight-v1");
    assert.equal(health.controllerPreflight.status, "PASS");
    assert.equal(health.controllerPreflight.simulated, true);
    assert.equal(health.controllerPreflight.boardIdentityPresent, true);
    assert.ok(health.controllerPreflight.counts.settingsExpected > 50);
    assert.equal(
      health.controllerPreflight.counts.settingsPassed,
      health.controllerPreflight.counts.settingsExpected,
    );
    assert.equal(health.controllerPreflight.counts.blockers, 0);
    assert.equal(health.controllerPreflight.physicalMotionPermitted, false);
    assert.equal(health.controllerPreflight.reportAvailable, true);
    assert.equal("settings" in health.controllerPreflight, false);
    const fullPreflight = await fetch(`${address.url}/controller/preflight`, {
      headers: { Origin: "http://127.0.0.1:5173" },
    });
    assert.equal(fullPreflight.status, 200);
    assert.equal(fullPreflight.headers.get("access-control-allow-origin"), "http://127.0.0.1:5173");
    const fullPreflightReport = await fullPreflight.json();
    assert.ok(fullPreflightReport.settings.length > 50);
    assert.equal(fullPreflightReport.transcriptSha256, health.controllerPreflight.transcriptSha256);
    assert.equal(health.controllerSettings.policy, CONTROLLER_SETTINGS_WRITE_POLICY);
    assert.equal(health.controllerSettings.simulatedApplyEnabled, true);
    assert.equal(health.controllerSettings.physicalApplyEnabled, false);
    const settingsOptions = await fetch(`${address.url}/controller/settings/apply`, {
      method: "OPTIONS",
      headers: { Origin: "http://127.0.0.1:5173" },
    });
    assert.equal(settingsOptions.status, 204);
    const deniedSettings = await fetch(`${address.url}/controller/settings/apply`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://example.com" },
      body: JSON.stringify({}),
    });
    assert.equal(deniedSettings.status, 403);
    const rawSettingsAttempt = await fetch(`${address.url}/controller/settings/apply`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "http://127.0.0.1:5173" },
      body: JSON.stringify({ gcode: "$110=1" }),
    });
    assert.equal(rawSettingsAttempt.status, 400);
    const settingsApply = await fetch(`${address.url}/controller/settings/apply`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "http://127.0.0.1:5173" },
      body: JSON.stringify({
        protocol: CONTROLLER_SETTINGS_PLAN_PROTOCOL,
        profile: fullPreflightReport.profile,
        baseTranscriptSha256: fullPreflightReport.transcriptSha256,
        changes: [{ id: 110, value: 2400 }],
        confirmed: true,
      }),
    });
    assert.equal(settingsApply.status, 200);
    const settingsApplied = await settingsApply.json();
    assert.equal(settingsApplied.applied, 1);
    assert.equal(settingsApplied.physicalApplyEnabled, false);
    assert.equal(settingsApplied.report.settings.find(({ id }) => id === 110).actual, 2400);
    assert.equal(settingsApplied.report.counts.warnings, 1);
    const staleSettingsApply = await fetch(`${address.url}/controller/settings/apply`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "http://127.0.0.1:5173" },
      body: JSON.stringify({
        protocol: CONTROLLER_SETTINGS_PLAN_PROTOCOL,
        profile: fullPreflightReport.profile,
        baseTranscriptSha256: fullPreflightReport.transcriptSha256,
        changes: [{ id: 110, value: 2300 }],
        confirmed: true,
      }),
    });
    assert.equal(staleSettingsApply.status, 400);
    assert.match((await staleSettingsApply.json()).error, /changed after this plan/);
    const deniedPreflight = await fetch(`${address.url}/controller/preflight`, {
      headers: { Origin: "https://example.com" },
    });
    assert.equal(deniedPreflight.status, 403);
    assert.equal(health.machineCommands.policy, "simulation-transactions-only");
    assert.equal(health.machineCommands.enabled, true);
    assert.equal(health.machineCommands.physicalEnabled, false);
    assert.deepEqual(health.machineCommands.allowedIntents, ["apply-work-offset", "jog", "tool-setter", "touch-probe"]);
    assert.equal(health.sensorConnected, true);
    assert.equal(health.sensorWritePolicy, SENSOR_WRITE_POLICY);
    assert.equal(health.sensorCalibrationTransportAvailable, false);
    assert.equal(health.sensorCalibrationAvailable, false);
    assert.equal(health.hasSensorTelemetry, true);
    assert.equal(health.sensorFirmwareVersion, "7.6-mr1-sim");
    assert.deepEqual(health.sensorCalibrationCapabilities, { start: true, clear: true, persisted: true });
    assert.equal(health.fission.available, false);
    assert.equal(await requestWithHost(`${address.url}/health`, "["), 403);

    const latencyResponse = await fetch(`${address.url}/latency/ping`, {
      headers: { Origin: "http://127.0.0.1:5173" },
    });
    assert.equal(latencyResponse.status, 200);
    assert.equal(latencyResponse.headers.get("access-control-allow-origin"), "http://127.0.0.1:5173");
    const latency = await latencyResponse.json();
    assert.equal(latency.protocol, "mr1-latency-ping-v1");
    assert.equal(latency.bridgeMode, "simulate");
    assert.equal(latency.connected, true);
    assert.equal(latency.physicalMotionPermitted, false);
    assert.ok(latency.serverSentEpochMs >= latency.serverReceivedEpochMs);
    assert.ok(latency.serviceUptimeMs >= 0);
    assert.ok(Number.isInteger(latency.telemetrySequence));

    const latencyWithoutOrigin = await fetch(`${address.url}/latency/ping`);
    assert.equal(latencyWithoutOrigin.status, 403);
    const latencyWrongMethod = await fetch(`${address.url}/latency/ping`, {
      method: "POST",
      headers: { Origin: "http://127.0.0.1:5173" },
    });
    assert.equal(latencyWrongMethod.status, 405);

    const denied = await fetch(`${address.url}/events`, {
      headers: { Origin: "https://example.com" },
    });
    assert.equal(denied.status, 403);

    const commandAttempt = await fetch(`${address.url}/events`, { method: "POST" });
    assert.equal(commandAttempt.status, 405);

    const deniedSensorCommand = await fetch(`${address.url}/sensor/calibration`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://example.com" },
      body: JSON.stringify({ action: "start" }),
    });
    assert.equal(deniedSensorCommand.status, 403);

    const sensorPreflight = await fetch(`${address.url}/sensor/calibration`, {
      method: "OPTIONS",
      headers: { Origin: "http://127.0.0.1:5173" },
    });
    assert.equal(sensorPreflight.status, 204);

    const invalidSensorCommand = await fetch(`${address.url}/sensor/calibration`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "http://127.0.0.1:5173" },
      body: JSON.stringify({ action: "status" }),
    });
    assert.equal(invalidSensorCommand.status, 400);

    const unavailableSensorCommand = await fetch(`${address.url}/sensor/calibration`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "http://127.0.0.1:5173" },
      body: JSON.stringify({ action: "start" }),
    });
    assert.equal(unavailableSensorCommand.status, 409);

    const controller = new AbortController();
    const events = await fetch(`${address.url}/events`, {
      headers: { Origin: "http://127.0.0.1:5173" },
      signal: controller.signal,
    });
    assert.equal(events.status, 200);
    assert.match(events.headers.get("content-type"), /text\/event-stream/);
    const telemetry = await readEvent(events, "telemetry");
    controller.abort();

    assert.equal(telemetry.protocol, "grblhal-status-v1");
    assert.equal(telemetry.bridgeMode, "simulate");
    assert.equal(telemetry.state.name, "Idle");
    assert.equal(telemetry.motion.spindleCommand, 0);
    assert.equal(telemetry.tool, 3);
    assert.ok(Number.isFinite(telemetry.position.work.x));
    assert.deepEqual(telemetry.position.machine, { x: -283.21, y: -273.05, z: -20 });
    assert.ok(Number.isInteger(telemetry.sequence));
    assert.ok(Number.isFinite(Date.parse(telemetry.bridgePublishedAt)));
    assert.ok(telemetry.bridgeProcessingMs >= 0);

    const sensorEvents = await fetch(`${address.url}/events`, {
      headers: { Origin: "http://127.0.0.1:5173" },
    });
    const sensor = await readEvent(sensorEvents, "sensor");
    assert.equal(sensor.protocol, "mr1-chatter-v1");
    assert.equal(sensor.schemaVersion, 2);
    assert.equal(sensor.firmwareVersion, "7.6-mr1-sim");
    assert.ok(Number.isInteger(sensor.deviceReportSequence));
    assert.ok(Number.isInteger(sensor.deviceSampleSequence));
    assert.ok(sensor.deviceUptimeMs >= sensor.deviceSampleUptimeMs);
    assert.equal(sensor.deviceSampleAgeMs, 5);
    assert.ok(sensor.processingMs > 0);
    assert.equal(sensor.health.imu, true);
    assert.equal(sensor.health.audio, true);
    assert.equal(sensor.health.externalTemperature, true);
    assert.equal(sensor.dsp.fftSize, 1024);
    assert.equal(sensor.calibration.progress, 1);
    assert.equal(sensor.calibration.persisted, true);
    assert.equal(sensor.calibration.validSlots, 2);
    assert.ok(sensor.score >= 0 && sensor.score <= 100);
    assert.ok(Number.isFinite(Date.parse(sensor.bridgePublishedAt)));
    assert.ok(sensor.bridgeProcessingMs >= 0);

    const spindleEvents = await fetch(`${address.url}/events`, {
      headers: { Origin: "http://127.0.0.1:5173" },
    });
    const spindle = await readEvent(spindleEvents, "spindle");
    assert.equal(spindle.protocol, "mr1-spindle-v1");
    assert.equal(spindle.bridgeMode, "simulate");
    assert.equal(spindle.commandRpm, 0);
    assert.equal(spindle.controlPath, "digital");
    assert.equal(spindle.commissioning.profileApproved, false);
    assert.equal(spindle.permits.m4, false);
    assert.equal(spindle.speeds.encoderSpindleRpm, 0);
    assert.equal(spindle.signals.zeroSpeed, true);
    assert.equal(spindle.signals.alarmActive, false);
    assert.ok(Number.isFinite(Date.parse(spindle.bridgePublishedAt)));
    assert.ok(spindle.bridgeProcessingMs >= 0);

    const deniedMachineCommand = await fetch(`${address.url}/machine/transactions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://example.com" },
      body: JSON.stringify({ intent: { type: "jog" } }),
    });
    assert.equal(deniedMachineCommand.status, 403);

    const machinePreflight = await fetch(`${address.url}/machine/transactions`, {
      method: "OPTIONS",
      headers: { Origin: "http://127.0.0.1:5173" },
    });
    assert.equal(machinePreflight.status, 204);

    const rawGcodeAttempt = await fetch(`${address.url}/machine/transactions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "http://127.0.0.1:5173" },
      body: JSON.stringify({
        ownerId: "test-owner",
        requestId: "request-raw",
        intent: { type: "gcode", command: "G0 X1" },
      }),
    });
    assert.equal(rawGcodeAttempt.status, 400);
    assert.equal((await rawGcodeAttempt.json()).code, "MACHINE_INTENT_NOT_ALLOWED");

    const commandRequest = {
      ownerId: "test-owner",
      requestId: "request-wcs",
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
    const commandResponse = await fetch(`${address.url}/machine/transactions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "http://127.0.0.1:5173" },
      body: JSON.stringify(commandRequest),
    });
    assert.equal(commandResponse.status, 202);
    const commandAccepted = await commandResponse.json();
    assert.equal(commandAccepted.accepted, true);
    assert.equal(commandAccepted.transaction.intent.type, "apply-work-offset");

    const completionStarted = Date.now();
    while (service.snapshot().latestTransaction?.state !== "completed") {
      if (Date.now() - completionStarted > 3000) throw new Error("Virtual WCS transaction did not complete.");
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const completedSnapshot = service.snapshot();
    assert.equal(completedSnapshot.latestTransaction.result.controllerAcknowledged, true);
    assert.deepEqual(completedSnapshot.latestStatus.position.wco, { x: -310, y: -240, z: -120 });
    assert.equal(completedSnapshot.latestStatus.state.name, "Idle");

    const lookupUrl = new URL(`${address.url}/machine/transactions`);
    lookupUrl.searchParams.set("ownerId", commandRequest.ownerId);
    lookupUrl.searchParams.set("transactionId", commandAccepted.transaction.id);
    const lookupResponse = await fetch(lookupUrl, {
      headers: { Origin: "http://127.0.0.1:5173" },
    });
    assert.equal(lookupResponse.status, 200);
    const lookupPayload = await lookupResponse.json();
    assert.equal(lookupPayload.transaction.state, "completed");
    assert.deepEqual(lookupPayload.transaction.result.wco, { x: -310, y: -240, z: -120 });

    lookupUrl.searchParams.set("ownerId", "other-owner");
    const deniedLookup = await fetch(lookupUrl, {
      headers: { Origin: "http://127.0.0.1:5173" },
    });
    assert.equal(deniedLookup.status, 403);
    assert.equal((await deniedLookup.json()).code, "TRANSACTION_OWNER_MISMATCH");

    const duplicateResponse = await fetch(`${address.url}/machine/transactions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "http://127.0.0.1:5173" },
      body: JSON.stringify(commandRequest),
    });
    assert.equal(duplicateResponse.status, 200);
    assert.equal((await duplicateResponse.json()).duplicate, true);

    const leaseConflict = await fetch(`${address.url}/machine/transactions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "http://127.0.0.1:5173" },
      body: JSON.stringify({ ...commandRequest, ownerId: "other-owner", requestId: "request-other" }),
    });
    assert.equal(leaseConflict.status, 423);
    assert.equal((await leaseConflict.json()).code, "COMMAND_LEASE_HELD");

    const ownerStreamAbort = new AbortController();
    const ownerEvents = await fetch(`${address.url}/events?ownerId=test-owner`, {
      headers: { Origin: "http://127.0.0.1:5173" },
      signal: ownerStreamAbort.signal,
    });
    assert.equal(ownerEvents.status, 200);
    const jogResponse = await fetch(`${address.url}/machine/transactions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "http://127.0.0.1:5173" },
      body: JSON.stringify({
        ownerId: "test-owner",
        requestId: "request-jog",
        observedStatusSequence: service.snapshot().latestStatus.sequence,
        intent: {
          type: "jog",
          axis: "x",
          direction: 1,
          distance: 10,
          feed: 100,
          coordinateMode: "machine",
        },
      }),
    });
    assert.equal(jogResponse.status, 202);
    const jogTransaction = (await jogResponse.json()).transaction;
    const activeStartedAt = Date.now();
    while (service.snapshot().machineCommands.activeTransactionId !== jogTransaction.id) {
      if (Date.now() - activeStartedAt > 1000) throw new Error("Virtual jog did not become active.");
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
    ownerStreamAbort.abort();
    const cancelStartedAt = Date.now();
    while (service.snapshot().latestTransaction?.state !== "cancelled") {
      if (Date.now() - cancelStartedAt > 2000) throw new Error("Owner disconnect did not cancel active work.");
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.equal(service.snapshot().latestTransaction.id, jogTransaction.id);
    assert.equal(service.snapshot().latestTransaction.error.code, "COMMAND_CANCELLED");
    assert.equal(service.snapshot().latestStatus.state.name, "Hold");
  } finally {
    await service.stop();
  }
});

test("machine cancel endpoint is owner-bound and aborts an active virtual move", async () => {
  const service = createTelemetryService({
    mode: "simulate",
    httpPort: 0,
    fissionRoot: false,
    virtualPhaseDelayMs: 40,
  });
  const address = await service.start();
  const origin = "http://127.0.0.1:5173";
  try {
    const response = await fetch(`${address.url}/machine/transactions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify({
        ownerId: "cancel-owner",
        requestId: "cancel-request",
        observedStatusSequence: service.snapshot().latestStatus.sequence,
        intent: {
          type: "jog",
          axis: "y",
          direction: 1,
          distance: 10,
          feed: 100,
          coordinateMode: "machine",
        },
      }),
    });
    assert.equal(response.status, 202);
    const transaction = (await response.json()).transaction;

    const activeStartedAt = Date.now();
    while (service.snapshot().machineCommands.activeTransactionId !== transaction.id) {
      if (Date.now() - activeStartedAt > 1000) throw new Error("Virtual jog did not become active.");
      await new Promise((resolve) => setTimeout(resolve, 2));
    }

    const denied = await fetch(`${address.url}/machine/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify({ ownerId: "wrong-owner", transactionId: transaction.id }),
    });
    assert.equal(denied.status, 403);
    assert.equal((await denied.json()).code, "TRANSACTION_OWNER_MISMATCH");

    const cancelled = await fetch(`${address.url}/machine/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify({ ownerId: "cancel-owner", transactionId: transaction.id }),
    });
    assert.equal(cancelled.status, 202);
    assert.equal((await cancelled.json()).transaction.state, "cancelling");

    const cancelledStartedAt = Date.now();
    while (service.snapshot().latestTransaction?.state !== "cancelled") {
      if (Date.now() - cancelledStartedAt > 1000) throw new Error("Cancel endpoint did not abort virtual motion.");
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
    assert.equal(service.snapshot().latestTransaction.error.code, "COMMAND_CANCELLED");
    assert.equal(service.snapshot().latestStatus.state.name, "Hold");
  } finally {
    await service.stop();
  }
});

test("loopback bridge exposes a separate origin-checked Fission file processor", async () => {
  const calls = [];
  const fissionProcessor = {
    status: () => ({ available: true, reviewed: true, version: "test" }),
    optimize: async (payload) => {
      calls.push(payload);
      return {
        content: payload.source.replace("G1 X10 F2", "G0 X10"),
        stats: { rapidsRestored: 1 },
        validated: true,
        sourceSha256: "A".repeat(64),
        outputSha256: "B".repeat(64),
      };
    },
  };
  const service = createTelemetryService({ mode: "simulate", httpPort: 0, fissionProcessor });
  const address = await service.start();
  try {
    const health = await fetch(`${address.url}/health`, {
      headers: { Origin: "http://127.0.0.1:5173" },
    });
    assert.equal(health.status, 200);
    assert.equal(health.headers.get("access-control-allow-origin"), "http://127.0.0.1:5173");
    const deniedHealth = await fetch(`${address.url}/health`, {
      headers: { Origin: "https://example.com" },
    });
    assert.equal(deniedHealth.status, 403);

    const denied = await fetch(`${address.url}/optimize/fission`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://example.com" },
      body: JSON.stringify({ source: "G1 X10 F2" }),
    });
    assert.equal(denied.status, 403);

    const preflight = await fetch(`${address.url}/optimize/fission`, {
      method: "OPTIONS",
      headers: { Origin: "http://127.0.0.1:5173" },
    });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get("access-control-allow-methods"), "POST, OPTIONS");

    const response = await fetch(`${address.url}/optimize/fission`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "http://127.0.0.1:5173" },
      body: JSON.stringify({
        name: "part.nc",
        source: "G1 X10 F2",
        options: { safeZVerified: true, safeZ: 0.1 },
      }),
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("access-control-allow-origin"), "http://127.0.0.1:5173");
    const result = await response.json();
    assert.equal(result.content, "G0 X10");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].name, "part.nc");
  } finally {
    await service.stop();
  }
});

test("bridge rejects ambiguous serial configuration before opening a device", () => {
  assert.throws(
    () => createTelemetryService({ mode: "serial", serialPort: "COM3", sensorPort: "COM3" }),
    /must be different devices/,
  );
  assert.throws(
    () => createTelemetryService({ mode: "serial", serialPort: "COM3", baudRate: 0 }),
    /Controller baud rate/,
  );
  assert.throws(
    () => createTelemetryService({ mode: "simulate", sensorPort: "auto" }),
    /explicit Windows port/,
  );
});

test("a DNS-rebinding Host cannot read telemetry, journal or preflight data", async () => {
  const token = "P".repeat(43);
  const loopback = createTelemetryService({ mode: "simulate", httpPort: 0, fissionRoot: false });
  const lan = createTelemetryService({ mode: "simulate", httpPort: 0, fissionRoot: false, httpHost: "0.0.0.0",
    companionToken: token, allowedOrigins: ["http://192.168.50.44:5173"] });
  const loopbackAddress = await loopback.start();
  const lanAddress = await lan.start();
  try {
    const status = (address, path, host) => requestWithHost(`${address.url}${path}`, `${host}:${address.port}`);
    for (const path of ["/health", "/journal/export", "/controller/preflight"]) {
      assert.equal(await status(loopbackAddress, path, "attacker.example"), 403, path);
      assert.equal(await status(lanAddress, `${path}?pair=${token}`, "attacker.example"), 403, path);
    }
    assert.equal(await status(loopbackAddress, "/health", "localhost"), 200);
    assert.equal(await status(loopbackAddress, "/health", "192.168.50.44"), 403, "loopback service never answers a LAN name");
    assert.equal(await status(lanAddress, `/health?pair=${token}`, "192.168.50.44"), 200);
    assert.equal(await requestWithHost(`${loopbackAddress.url}/health`, "localhost:1"), 403);
  } finally {
    await loopback.stop();
    await lan.stop();
  }
});
