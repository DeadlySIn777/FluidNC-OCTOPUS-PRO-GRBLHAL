import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { createTelemetryService } from "../service/mr1-telemetry-service.mjs";

import { importDependency } from "../tools/optional-dependencies.mjs";

function vector(value) {
  return String(value).split(",").map(Number);
}

const { chromium } = await importDependency("playwright");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let telemetryService = null;
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

  await page.addInitScript(({ telemetryBaseUrl }) => {
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
  }, { telemetryBaseUrl: telemetryAddress.url });

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
  await page.locator("#telemetry-connect").click();
  try {
    await page.waitForFunction(
      () => document.querySelector("#telemetry-source")?.textContent === "BRIDGE SIM",
      null,
      { timeout: 8000 },
    );
  } catch (error) {
    const connectionState = await page.evaluate(() => ({
      label: document.querySelector("#telemetry-source")?.textContent,
      tooltip: document.querySelector("#telemetry-connect")?.getAttribute("aria-label"),
      machineState: document.querySelector("#machine-state")?.textContent,
    }));
    throw new Error(`Isolated telemetry failed: ${JSON.stringify(connectionState)}`, { cause: error });
  }
  await page.locator("#open-jog").click();
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
  await page.waitForFunction(() => document.querySelector("#machine-state")?.textContent === "JOG");
  await positiveX.dispatchEvent("pointerup", { button: 0, pointerId: 1, pointerType: "mouse" });
  await page.waitForFunction(() => (
    document.querySelector("#machine-state")?.textContent === "HOLD"
    && document.querySelector("#jog-command-status")?.value.includes("CANCELLED")
  ));

  console.log("Jog/model synchronization and dead-man release passed.");
} finally {
  await browser.close();
  await vite.close();
  await telemetryService?.stop();
}
