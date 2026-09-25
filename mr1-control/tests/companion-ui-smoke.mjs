import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createTelemetryService } from "../service/mr1-telemetry-service.mjs";

import { importDependency } from "../tools/optional-dependencies.mjs";

const { chromium } = await importDependency("playwright");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const screenshots = path.join(root, "screenshots");
await mkdir(screenshots, { recursive: true });
const journalDirectory = await mkdtemp(path.join(tmpdir(), "mr1-companion-ui-"));

const service = createTelemetryService({
  mode: "simulate",
  httpPort: 0,
  fissionRoot: false,
  journalDirectory,
  ownerDisconnectGraceMs: 5,
  virtualPhaseDelayMs: 10,
});
const address = await service.start();
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.PLAYWRIGHT_CHROME || undefined,
  args: ["--enable-webgl", "--use-angle=swiftshader"],
});
const page = await browser.newPage({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 1,
  isMobile: true,
  hasTouch: true,
});
const pageErrors = [];
const consoleErrors = [];
page.on("pageerror", (error) => pageErrors.push(error.message));
page.on("console", (message) => {
  if (message.type() === "error") consoleErrors.push(message.text());
});

try {
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
        const next = rewrite(input.url);
        if (next !== input.url) return nativeFetch(new Request(next, input), init);
      }
      return nativeFetch(input, init);
    };
  }, { telemetryBaseUrl: address.url });

  const target = new URL(process.env.MR1_CONTROL_URL ?? "http://127.0.0.1:5173");
  target.searchParams.set("companion", "1");
  await page.goto(target.href, { waitUntil: "domcontentloaded" });
  await page.locator("#viewer canvas").waitFor({ state: "visible" });
  await page.waitForFunction(() => (
    document.title === "MR-1 Companion"
    && document.documentElement.dataset.companion === "true"
    && document.getElementById("viewer")?.dataset.renderQuality === "reduced"
    && document.getElementById("telemetry-connect")?.getAttribute("aria-pressed") === "true"
    && document.getElementById("telemetry-source")?.textContent === "BRIDGE SIM"
  ), null, { timeout: 10000 });

  const layout = await page.evaluate(() => {
    const viewport = { width: innerWidth, height: innerHeight };
    const visible = [...document.querySelectorAll("body *")].filter((element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
    });
    const overflow = visible
      .map((element) => ({ element, rect: element.getBoundingClientRect() }))
      .filter(({ element, rect }) => (
        !element.closest('[aria-hidden="true"]')
        && !element.closest(".camera-controls")
        && (rect.left < -1 || rect.right > viewport.width + 1)
      ))
      .map(({ element, rect }) => ({
        id: element.id,
        className: String(element.className),
        left: rect.left,
        right: rect.right,
      }));
    return {
      width: viewport.width,
      bodyScrollWidth: document.body.scrollWidth,
      overflow,
      renderQuality: document.getElementById("viewer")?.dataset.renderQuality,
      toolRail: (() => {
        const rail = document.querySelector(".camera-controls");
        return {
          clientWidth: rail?.clientWidth ?? 0,
          scrollWidth: rail?.scrollWidth ?? 0,
          overflowX: rail ? getComputedStyle(rail).overflowX : "",
        };
      })(),
      subtitle: document.querySelector(".brand-subtitle")?.textContent,
      dro: ["dro-x", "dro-y", "dro-z"].map((id) => document.getElementById(id)?.value),
    };
  });
  assert.equal(layout.width, 390);
  assert.equal(layout.bodyScrollWidth, 390);
  assert.deepEqual(layout.overflow, []);
  assert.equal(layout.renderQuality, "reduced");
  assert.ok(layout.toolRail.scrollWidth > layout.toolRail.clientWidth);
  assert.equal(layout.toolRail.overflowX, "auto");
  assert.equal(layout.subtitle, "COMPANION");
  assert.ok(layout.dro.every((value) => Number.isFinite(Number(value))));

  await page.locator("#open-jog").click();
  await page.waitForFunction(() => (
    document.getElementById("jog-panel")?.getAttribute("aria-hidden") === "false"
    && document.getElementById("jog-command-mode")?.value === "VIRTUAL CONTROL"
    && !document.querySelector('[data-jog-axis="x"][data-jog-direction="1"]')?.disabled
  ), null, { timeout: 10000 });
  const startX = Number(await page.locator("#jog-dro-x").evaluate((element) => element.value));
  await page.locator('[data-jog-step="0.1"]').click();
  await page.locator('[data-jog-axis="x"][data-jog-direction="1"]').click();
  await page.waitForFunction((before) => (
    Number(document.getElementById("jog-dro-x")?.value) > before
    && document.getElementById("jog-command-status")?.value.includes("IDLE OBSERVED")
  ), startX, { timeout: 10000 });
  const endX = Number(await page.locator("#jog-dro-x").evaluate((element) => element.value));
  assert.ok(endX > startX);

  await page.screenshot({ path: path.join(screenshots, "companion-mobile.png"), fullPage: true });
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(consoleErrors, []);
  process.stdout.write(`${JSON.stringify({ layout, startX, endX }, null, 2)}\n`);
} finally {
  await browser.close();
  await service.stop();
  await rm(journalDirectory, { recursive: true, force: true });
}
