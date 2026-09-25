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
const journalDirectory = await mkdtemp(path.join(tmpdir(), "mr1-latency-ui-"));
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
const errors = [];

async function preparePage(page) {
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
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
}

async function healthLayout(page) {
  return page.evaluate(() => {
    const panelElement = document.getElementById("health-panel");
    const panel = panelElement.getBoundingClientRect();
    const visible = [...panelElement.querySelectorAll("*")].filter((element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
    });
    const overflow = visible.filter((element) => (
      element.matches("output, button span, .latency-table-row > span, .health-chart-legend span")
      && element.scrollWidth > element.clientWidth + 2
    )).map((element) => ({
      id: element.id,
      className: String(element.className),
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
    }));
    const canvas = document.getElementById("health-chart");
    const context = canvas.getContext("2d");
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let changedPixels = 0;
    for (let index = 0; index < pixels.length; index += 64) {
      if (pixels[index] !== 18 || pixels[index + 1] !== 20 || pixels[index + 2] !== 22) changedPixels += 1;
    }
    return {
      panel: { left: panel.left, right: panel.right, top: panel.top, bottom: panel.bottom, width: panel.width },
      viewport: { width: innerWidth, height: innerHeight },
      documentWidth: document.documentElement.scrollWidth,
      overflow,
      clock: document.getElementById("health-clock").value,
      bridge: document.getElementById("health-bridge").value,
      samples: Number(document.getElementById("health-samples").value),
      physicalProof: document.getElementById("health-physical-proof").value,
      chart: { width: canvas.width, height: canvas.height, changedPixels },
    };
  });
}

try {
  const controlUrl = process.env.MR1_CONTROL_URL ?? "http://127.0.0.1:5173";
  const desktop = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await preparePage(desktop);
  await desktop.goto(controlUrl, { waitUntil: "domcontentloaded" });
  await desktop.locator("#viewer canvas").waitFor({ state: "visible" });
  await desktop.locator("#telemetry-connect").click();
  await desktop.waitForFunction(() => document.getElementById("telemetry-source")?.textContent === "BRIDGE SIM");
  await desktop.locator("#open-health").click();
  await desktop.waitForFunction(() => (
    document.getElementById("health-clock")?.value === "SYNCED"
    && Number(document.getElementById("health-samples")?.value) >= 5
  ), null, { timeout: 10000 });

  const desktopLayout = await healthLayout(desktop);
  assert.ok(desktopLayout.panel.width >= 590);
  assert.ok(desktopLayout.panel.right <= desktopLayout.viewport.width + 1);
  assert.ok(desktopLayout.panel.top >= 50 && desktopLayout.panel.bottom <= desktopLayout.viewport.height - 60);
  assert.equal(desktopLayout.documentWidth, desktopLayout.viewport.width);
  assert.deepEqual(desktopLayout.overflow, []);
  assert.equal(desktopLayout.clock, "SYNCED");
  assert.equal(desktopLayout.bridge, "SIMULATE");
  assert.equal(desktopLayout.physicalProof, "UNPROVEN");
  assert.ok(desktopLayout.chart.width > 400 && desktopLayout.chart.height >= 140);
  assert.ok(desktopLayout.chart.changedPixels > 10);

  await desktop.locator("#run-health-check").click();
  await desktop.waitForFunction(() => document.getElementById("health-check-state")?.value === "PASS", null, {
    timeout: 15000,
  });
  assert.equal(await desktop.locator("#export-health-evidence").isEnabled(), true);
  const downloadPromise = desktop.waitForEvent("download");
  await desktop.locator("#export-health-evidence").click();
  const download = await downloadPromise;
  assert.match(download.suggestedFilename(), /^mr1-latency-.*\.json$/);
  await desktop.screenshot({ path: path.join(screenshots, "system-health-desktop.png"), fullPage: true });

  const mobile = await browser.newPage({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
    isMobile: true,
    hasTouch: true,
  });
  await preparePage(mobile);
  const mobileTarget = new URL(controlUrl);
  mobileTarget.searchParams.set("companion", "1");
  await mobile.goto(mobileTarget.href, { waitUntil: "domcontentloaded" });
  await mobile.locator("#viewer canvas").waitFor({ state: "visible" });
  await mobile.waitForFunction(() => document.getElementById("telemetry-source")?.textContent === "BRIDGE SIM");
  await mobile.locator("#open-health").click();
  await mobile.waitForFunction(() => (
    document.getElementById("health-clock")?.value === "SYNCED"
    && Number(document.getElementById("health-samples")?.value) >= 3
  ), null, { timeout: 10000 });
  const mobileLayout = await healthLayout(mobile);
  assert.equal(mobileLayout.documentWidth, 390);
  assert.ok(mobileLayout.panel.left >= -1 && mobileLayout.panel.right <= 391);
  assert.ok(mobileLayout.panel.width >= 389);
  assert.deepEqual(mobileLayout.overflow, []);
  assert.equal(mobileLayout.bridge, "SIMULATE / LAN");
  assert.equal(mobileLayout.physicalProof, "UNPROVEN");
  await mobile.screenshot({ path: path.join(screenshots, "system-health-mobile.png"), fullPage: true });

  assert.deepEqual(errors, []);
  process.stdout.write(`${JSON.stringify({ desktop: desktopLayout, mobile: mobileLayout }, null, 2)}\n`);
} finally {
  await browser.close();
  await service.stop();
  await rm(journalDirectory, { recursive: true, force: true });
}
