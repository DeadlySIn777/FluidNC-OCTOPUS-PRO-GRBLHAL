import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { createTelemetryService } from "../service/mr1-telemetry-service.mjs";

import { importDependency } from "../tools/optional-dependencies.mjs";

function vector(value) {
  return String(value).split(",").map(Number);
}

async function routeTelemetry(targetPage, telemetryBaseUrl) {
  await targetPage.addInitScript(({ telemetryBaseUrl }) => {
    const rewrite = (value) => String(value).replace(
      /^http:\/\/127\.0\.0\.1:8787(?=\/|$)/,
      telemetryBaseUrl,
    );
    const NativeEventSource = window.EventSource;
    window.EventSource = new Proxy(NativeEventSource, {
      construct(Target, args) {
        return Reflect.construct(Target, [rewrite(args[0]), ...args.slice(1)], Target);
      },
    });
    const nativeFetch = window.fetch.bind(window);
    window.fetch = (input, init) => nativeFetch(
      typeof input === "string" || input instanceof URL ? rewrite(input) : input,
      init,
    );
  }, { telemetryBaseUrl });
}

async function connectLiveJog(targetPage) {
  await targetPage.locator("#telemetry-connect").click();
  try {
    await targetPage.waitForFunction(
      () => document.querySelector("#telemetry-source")?.textContent === "BRIDGE SIM",
      null,
      { timeout: 8000 },
    );
  } catch (error) {
    const connectionState = await targetPage.evaluate(() => ({
      label: document.querySelector("#telemetry-source")?.textContent,
      tooltip: document.querySelector("#telemetry-connect")?.getAttribute("aria-label"),
      machineState: document.querySelector("#machine-state")?.textContent,
    }));
    throw new Error(`Isolated telemetry failed: ${JSON.stringify(connectionState)}`, { cause: error });
  }
  await targetPage.locator("#open-jog").click();
}

// A release can land mid-chunk (CANCELLED / HOLD) or between chunks
// (COMPLETE / IDLE); either way X must stop once a latched chunk settles.
// The DRO can lag the transaction under load, so wait for X to hold still
// for 1.5 s instead of sampling it at fixed times.
async function assertDeadManRelease(targetPage, release, label) {
  await targetPage.waitForFunction(() => document.querySelector("#machine-state")?.textContent === "JOG");
  await targetPage.evaluate(() => { delete window.deadManX; });
  await release();
  try {
    await targetPage.waitForFunction(() => {
      const x = document.querySelector("#jog-dro-x")?.value;
      const now = performance.now();
      if (window.deadManX !== x) Object.assign(window, { deadManX: x, deadManSince: now });
      return now - window.deadManSince >= 1500;
    }, null, { polling: 50, timeout: 8000 });
  } catch (error) {
    assert.fail(`${label} dead-man release must stop motion: ${error.message}`);
  }
  const status = await targetPage.locator("#jog-command-status").evaluate((element) => element.value);
  assert.match(status, /CANCELLED|COMPLETE/, `${label} dead-man release must end the jog transaction`);
}

const { chromium } = await importDependency("playwright");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let telemetryService = null;
let keyboardTelemetryService = null;
let crossOwnerTelemetryService = null;
const vite = await createServer({
  root,
  logLevel: "silent",
  server: { host: "127.0.0.1", port: 0, strictPort: false },
});
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.PLAYWRIGHT_CHROME || undefined,
  args: ["--enable-webgl", "--use-angle=swiftshader"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

try {
  await vite.listen();
  const viteAddress = vite.httpServer.address();
  assert.equal(typeof viteAddress, "object");
  const appOrigin = `http://127.0.0.1:${viteAddress.port}`;
  telemetryService = createTelemetryService({
    mode: "simulate",
    httpPort: 0,
    allowedOrigins: [appOrigin],
  });
  const telemetryAddress = await telemetryService.start();

  await routeTelemetry(page, telemetryAddress.url);

  await page.goto(`${appOrigin}/?render-quality=reduced`, { waitUntil: "networkidle" });
  await page.locator("#viewer canvas").waitFor({ state: "visible" });
  await page.waitForFunction(() => document.querySelector("#viewer")?.dataset.toolCoordinatePosition);

  const initialModel = await page.locator("#viewer").getAttribute("data-tool-coordinate-position");
  const initialWorld = await page.locator("#viewer").getAttribute("data-tool-world-position");
  await page.locator("#open-jog").click();
  assert.equal(await page.locator("#viewer").getAttribute("data-tool-coordinate-position"), initialModel);
  assert.equal(await page.locator("#viewer").getAttribute("data-tool-world-position"), initialWorld);

  await page.getByRole("button", { name: "Jog X positive", exact: true }).click();
  const joggedModel = vector(await page.locator("#viewer").getAttribute("data-tool-coordinate-position"));
  const joggedWorld = vector(await page.locator("#viewer").getAttribute("data-tool-world-position"));
  const initialModelVector = vector(initialModel);
  const initialWorldVector = vector(initialWorld);
  assert.equal((joggedModel[0] - initialModelVector[0]).toFixed(3), "1.000");
  assert.equal((joggedWorld[0] - initialWorldVector[0]).toFixed(3), "1.000");
  assert.equal((joggedWorld[1] - initialWorldVector[1]).toFixed(3), "0.000");
  assert.equal((joggedWorld[2] - initialWorldVector[2]).toFixed(3), "0.000");

  await page.locator("#close-jog").click();
  await connectLiveJog(page);
  await page.waitForFunction(() => {
    const model = document.querySelector("#viewer")?.dataset.toolCoordinatePosition?.split(",").map(Number);
    const jog = ["x", "y", "z"].map((axis) => Number(document.querySelector(`#jog-dro-${axis}`)?.value));
    return model?.every((value, index) => Math.abs(value - jog[index]) < 0.0001);
  });

  await page.locator('[data-jog-step="1"]').click();
  const liveStartX = Number(await page.locator("#jog-dro-x").evaluate((element) => element.value));
  await page.getByRole("button", { name: "Jog X positive", exact: true }).click();
  await page.waitForFunction((startX) => (
    Math.abs(Number(document.querySelector("#jog-dro-x")?.value) - startX - 1) < 0.0001
  ), liveStartX);
  const liveEndX = Number(await page.locator("#jog-dro-x").evaluate((element) => element.value));
  assert.equal(
    Number(vector(await page.locator("#viewer").getAttribute("data-tool-coordinate-position"))[0]).toFixed(3),
    liveEndX.toFixed(3),
  );

  await page.locator('[data-jog-step="continuous"]').click();
  const positiveX = page.getByRole("button", { name: "Jog X positive", exact: true });
  await positiveX.dispatchEvent("pointerdown", { button: 0, pointerId: 1, pointerType: "mouse" });
  await assertDeadManRelease(
    page,
    () => positiveX.dispatchEvent("pointerup", { button: 0, pointerId: 1, pointerType: "mouse" }),
    "pointer",
  );

  // The held jog button is disabled while its chunk is pending, so focus moves
  // to <body> and the key release never reaches the button. A cancelled jog
  // leaves the virtual controller in Hold, so each key gets a fresh service.
  for (const key of [" ", "Enter"]) {
    keyboardTelemetryService = createTelemetryService({
      mode: "simulate",
      httpPort: 0,
      allowedOrigins: [appOrigin],
    });
    const keyboardAddress = await keyboardTelemetryService.start();
    const keyboardPage = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await routeTelemetry(keyboardPage, keyboardAddress.url);
    await keyboardPage.goto(`${appOrigin}/?render-quality=reduced`, { waitUntil: "networkidle" });
    await connectLiveJog(keyboardPage);
    await keyboardPage.locator('[data-jog-step="continuous"]').click();
    await keyboardPage.waitForFunction(() => document.querySelector('[aria-label="Jog X positive"]')?.disabled === false);
    await keyboardPage.getByRole("button", { name: "Jog X positive", exact: true }).focus();
    await keyboardPage.keyboard.down(key);
    await assertDeadManRelease(keyboardPage, () => keyboardPage.keyboard.up(key), `keyboard ${JSON.stringify(key)}`);
    await keyboardPage.close();
    await keyboardTelemetryService.stop();
    keyboardTelemetryService = null;
  }

  // Another session's rejected transaction is broadcast to every SSE client.
  // It must not replace this UI's own in-flight jog, or the dead-man release
  // finds nothing to cancel and the jog runs on. Slow virtual phases keep the
  // own jog in motion while the foreign rejection lands.
  crossOwnerTelemetryService = createTelemetryService({
    mode: "simulate",
    httpPort: 0,
    allowedOrigins: [appOrigin],
    virtualPhaseDelayMs: 200,
  });
  const crossOwnerAddress = await crossOwnerTelemetryService.start();
  const crossOwnerPage = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await routeTelemetry(crossOwnerPage, crossOwnerAddress.url);
  await crossOwnerPage.addInitScript(() => {
    const routedFetch = window.fetch;
    window.cancelRequests = 0;
    window.fetch = (input, init) => {
      if (String(input?.url ?? input).includes("/machine/cancel")) window.cancelRequests += 1;
      return routedFetch(input, init);
    };
  });
  await crossOwnerPage.goto(`${appOrigin}/?render-quality=reduced`, { waitUntil: "networkidle" });
  await connectLiveJog(crossOwnerPage);
  await crossOwnerPage.locator('[data-jog-step="continuous"]').click();
  await crossOwnerPage.waitForFunction(() => document.querySelector('[aria-label="Jog X positive"]')?.disabled === false);
  // A second SSE listener sees the foreign broadcast; the dead-man is released
  // as soon as this UI reacts to it (permit label change), or after 80 ms.
  await crossOwnerPage.evaluate((telemetryBaseUrl) => new Promise((opened) => {
    const events = new EventSource(`${telemetryBaseUrl}/events`);
    window.releasedAfterForeign = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("foreign rejection was not broadcast")), 5000);
      events.addEventListener("transaction", (event) => {
        if (!String(JSON.parse(event.data).requestId).startsWith("foreign-")) return;
        events.close();
        clearTimeout(timeout);
        const permit = document.querySelector("#permit-label");
        let released = false;
        const release = () => {
          if (released) return;
          released = true;
          observer.disconnect();
          const permitAtRelease = permit.textContent;
          const machineAtRelease = document.querySelector("#machine-state")?.textContent;
          document.querySelector('[aria-label="Jog X positive"]').dispatchEvent(
            new PointerEvent("pointerup", { bubbles: true, button: 0, pointerId: 1, pointerType: "mouse" }),
          );
          resolve({ permitAtRelease, machineAtRelease });
        };
        const observer = new MutationObserver(() => {
          if (!permit.textContent.startsWith("VIRTUAL TX")) release();
        });
        observer.observe(permit, { childList: true, characterData: true, subtree: true });
        if (!permit.textContent.startsWith("VIRTUAL TX")) release();
        setTimeout(release, 80);
      });
    });
    events.addEventListener("open", () => opened(), { once: true });
  }), crossOwnerAddress.url);
  await crossOwnerPage.getByRole("button", { name: "Jog X positive", exact: true })
    .dispatchEvent("pointerdown", { button: 0, pointerId: 1, pointerType: "mouse" });
  await crossOwnerPage.waitForFunction(() => document.querySelector("#machine-state")?.textContent === "JOG"
    && document.querySelector("#permit-label")?.textContent.startsWith("VIRTUAL TX"));
  const foreign = await fetch(`${crossOwnerAddress.url}/machine/transactions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: appOrigin },
    body: JSON.stringify({
      ownerId: "operator-b-session",
      requestId: `foreign-${Date.now()}`,
      observedStatusSequence: null,
      intent: { type: "jog", axis: "y", direction: 1, distance: 1, feed: 100 },
    }),
  });
  assert.ok([409, 423].includes(foreign.status), `foreign jog must be rejected, got ${foreign.status}`);
  const atRelease = await crossOwnerPage.evaluate(() => window.releasedAfterForeign);
  assert.equal(atRelease.machineAtRelease, "JOG", "own jog must still be in motion at release");
  assert.match(atRelease.permitAtRelease, /^VIRTUAL TX/, "foreign rejection must not replace this UI's own jog transaction");
  await crossOwnerPage.waitForFunction(() => /CANCELLED/.test(document.querySelector("#jog-command-status")?.value ?? ""), null, { timeout: 4000 })
    .catch(() => {});
  const crossOwnerStatus = await crossOwnerPage.locator("#jog-command-status").evaluate((element) => element.value);
  assert.ok(await crossOwnerPage.evaluate(() => window.cancelRequests) >= 1, `dead-man release sent no cancel (${crossOwnerStatus})`);
  assert.match(crossOwnerStatus, /CANCELLED/, "dead-man release must cancel the own jog after a foreign rejection");
  await crossOwnerPage.close();
  await crossOwnerTelemetryService.stop();
  crossOwnerTelemetryService = null;

  console.log("Jog/model synchronization, pointer/keyboard and cross-owner dead-man release passed.");
} finally {
  await browser.close();
  await vite.close();
  await telemetryService?.stop();
  await keyboardTelemetryService?.stop();
  await crossOwnerTelemetryService?.stop();
}
