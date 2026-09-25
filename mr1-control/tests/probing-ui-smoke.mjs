import assert from "node:assert/strict";
import path from "node:path";
import { createTelemetryService } from "../service/mr1-telemetry-service.mjs";

import { importDependency } from "../tools/optional-dependencies.mjs";

const { chromium } = await importDependency("playwright");
const service = createTelemetryService({
  mode: "simulate",
  httpPort: 0,
  journalDirectory: false,
  fissionRoot: false,
});
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.PLAYWRIGHT_CHROME || undefined,
  args: ["--enable-webgl", "--use-angle=swiftshader"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const pageErrors = [];
page.on("pageerror", (error) => pageErrors.push(error.message));

try {
  const address = await service.start();
  await page.addInitScript(({ telemetryBaseUrl }) => {
    const rewrite = (value) => String(value).replace(
      /^http:\/\/127\.0\.0\.1:8787(?=\/|$)/,
      telemetryBaseUrl,
    );
    const NativeEventSource = window.EventSource;
    window.EventSource = new Proxy(NativeEventSource, {
      construct(Target, args) {
        const rewritten = [...args];
        rewritten[0] = rewrite(rewritten[0]);
        return Reflect.construct(Target, rewritten, Target);
      },
    });
    const nativeFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      if (typeof input === "string" || input instanceof URL) return nativeFetch(rewrite(input), init);
      if (input instanceof Request) {
        const rewritten = rewrite(input.url);
        if (rewritten !== input.url) return nativeFetch(new Request(rewritten, input), init);
      }
      return nativeFetch(input, init);
    };
  }, { telemetryBaseUrl: address.url });

  const target = new URL(process.env.MR1_CONTROL_URL ?? "http://127.0.0.1:5173");
  target.searchParams.set("render-quality", "reduced");
  await page.goto(target.href, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Connect telemetry" }).click();
  await page.waitForFunction(() => document.getElementById("telemetry-source")?.textContent === "BRIDGE SIM");
  await page.getByRole("button", { name: "Probing settings" }).click();
  await page.getByRole("tab", { name: "TOUCH PROBE" }).click();

  const values = {
    "#touch-cycle": "bore-center",
    "#touch-tip-diameter": "4",
    "#touch-target-x": "-110",
    "#touch-target-y": "-80",
    "#touch-safe-z": "-20",
    "#touch-measurement-z": "-40",
    "#touch-feature-diameter": "14",
    "#touch-search": "6",
  };
  for (const [selector, value] of Object.entries(values)) {
    const locator = page.locator(selector);
    if (selector === "#touch-cycle") await locator.selectOption(value);
    else await locator.fill(value);
  }

  await page.waitForFunction(
    () => document.getElementById("touch-command-state")?.value === "VIRTUAL READY",
    null,
    { timeout: 5000 },
  );
  await page.locator("#run-touch-probe").click();
  await page.waitForFunction(
    () => ["CYCLE PROVEN", "FAILED", "CANCELLED / RECOVERY REQUIRED"].includes(
      document.getElementById("touch-command-state")?.value,
    ),
    null,
    { timeout: 15_000 },
  );

  const visible = await page.evaluate(() => ({
    command: document.getElementById("touch-command-state")?.value,
    validation: document.getElementById("touch-validation")?.textContent,
    machine: document.getElementById("machine-state")?.textContent,
    input: document.getElementById("touch-input-state")?.value,
  }));
  const snapshot = service.snapshot();
  assert.equal(visible.command, "CYCLE PROVEN", JSON.stringify({ visible, transaction: snapshot.latestTransaction }, null, 2));
  assert.equal(snapshot.latestTransaction?.state, "completed");
  assert.equal(snapshot.latestTransaction?.intent?.type, "touch-probe");
  assert.equal(snapshot.latestTransaction?.result?.measurements?.length, 4);
  assert.deepEqual(pageErrors, []);
  process.stdout.write(`${JSON.stringify({ visible, transaction: snapshot.latestTransaction }, null, 2)}\n`);
} finally {
  await service.stop();
  await browser.close();
}
