import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createTelemetryService } from "../service/mr1-telemetry-service.mjs";

import { importDependency } from "../tools/optional-dependencies.mjs";

const { chromium } = await importDependency("playwright");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const screenshots = path.join(root, "screenshots");
await mkdir(screenshots, { recursive: true });
const journalDirectory = await mkdtemp(path.join(tmpdir(), "mr1-commissioning-ui-"));
const service = createTelemetryService({
  mode: "simulate",
  httpPort: 0,
  fissionRoot: false,
  journalDirectory,
});
const address = await service.start();
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.PLAYWRIGHT_CHROME || undefined,
  args: ["--enable-webgl", "--use-angle=swiftshader"],
});
const context = await browser.newContext();
const errors = [];

async function preparePage(page) {
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("response", (response) => {
    if (response.status() >= 500) errors.push(`HTTP ${response.status()} ${response.url()}`);
  });
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

async function layoutAudit(page) {
  return page.evaluate(() => {
    const panelElement = document.getElementById("commissioning-panel");
    const panel = panelElement.getBoundingClientRect();
    const viewport = { width: innerWidth, height: innerHeight };
    const stageList = document.getElementById("commissioning-stage-list").getBoundingClientRect();
    const form = document.getElementById("commissioning-evidence-form").getBoundingClientRect();
    return {
      panel: { left: panel.left, right: panel.right, top: panel.top, bottom: panel.bottom, width: panel.width },
      viewport,
      documentWidth: document.documentElement.scrollWidth,
      stageList: { left: stageList.left, right: stageList.right, width: stageList.width },
      form: { left: form.left, right: form.right, width: form.width },
      state: document.getElementById("commissioning-state").value,
      binding: document.getElementById("commissioning-binding").value,
      motion: document.getElementById("commissioning-motion").value,
      count: document.getElementById("commissioning-check-count").value,
      stages: document.querySelectorAll(".commissioning-stage-button").length,
      visibleChecks: document.querySelectorAll(".commissioning-check-button").length,
    };
  });
}

async function outputValue(page, selector) {
  return page.locator(selector).evaluate((element) => element.value);
}

const controlUrl = process.env.MR1_CONTROL_URL ?? "http://127.0.0.1:5173";
const artifactContent = Buffer.from('{"release":"commissioning-ui-smoke"}\n', "utf8");
const artifactHash = createHash("sha256").update(artifactContent).digest("hex").toUpperCase();

try {
  const desktop = await context.newPage();
  await desktop.setViewportSize({ width: 1440, height: 900 });
  await preparePage(desktop);
  await desktop.goto(controlUrl, { waitUntil: "domcontentloaded" });
  await desktop.locator("#viewer canvas").waitFor({ state: "visible" });
  await desktop.locator("#telemetry-connect").click();
  await desktop.waitForFunction(() => document.getElementById("telemetry-source")?.textContent === "BRIDGE SIM");
  await desktop.locator("#open-commissioning").click();

  let desktopLayout = await layoutAudit(desktop);
  assert.ok(desktopLayout.panel.width >= 690);
  assert.ok(desktopLayout.panel.right <= desktopLayout.viewport.width + 1);
  assert.ok(desktopLayout.panel.top >= 50 && desktopLayout.panel.bottom <= desktopLayout.viewport.height - 60);
  assert.equal(desktopLayout.documentWidth, desktopLayout.viewport.width);
  assert.equal(desktopLayout.stages, 13);
  assert.equal(desktopLayout.visibleChecks, 3);
  assert.equal(desktopLayout.motion, "LOCKED");
  assert.match(desktopLayout.binding, /MACHINE \/ SIM/);
  assert.equal(desktopLayout.count, "0 OF 58");

  assert.equal(await desktop.locator("#commissioning-source").inputValue(), "document");
  await desktop.locator("#commissioning-operator").fill("UI TEST OPERATOR");
  await desktop.locator("#commissioning-artifact-file").setInputFiles({
    name: "release-manifest.json",
    mimeType: "application/json",
    buffer: artifactContent,
  });
  await desktop.waitForFunction((hash) => document.getElementById("commissioning-artifact-hash")?.textContent.includes(hash), artifactHash);
  await desktop.locator("#save-commissioning-evidence").click();
  await desktop.waitForFunction(() => document.getElementById("commissioning-check-state")?.value === "PASS");
  assert.equal(await outputValue(desktop, "#commissioning-check-count"), "1 OF 58");
  assert.equal(await outputValue(desktop, "#commissioning-stage-progress"), "1 OF 3");
  assert.equal(await desktop.locator("#export-commissioning-record").isEnabled(), true);

  await desktop.getByRole("button", { name: /Stage 4 BARE OCTOPUS/ }).click();
  await desktop.locator("#commissioning-operator").fill("UI TEST OPERATOR");
  await desktop.locator("#commissioning-artifact-file").setInputFiles({
    name: "simulated-controller.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("simulation is not physical proof\n", "utf8"),
  });
  await desktop.waitForFunction(() => document.getElementById("commissioning-artifact-hash")?.textContent.includes("SHA-256 ")
    && !document.getElementById("commissioning-artifact-hash")?.textContent.endsWith("--"));
  await desktop.locator("#save-commissioning-evidence").click();
  await desktop.waitForFunction(() => /SIMULATED/.test(document.getElementById("commissioning-validation")?.value ?? ""));
  assert.equal(await outputValue(desktop, "#commissioning-check-count"), "1 OF 58");
  assert.notEqual(await outputValue(desktop, "#commissioning-check-state"), "PASS");
  assert.equal(await outputValue(desktop, "#commissioning-motion"), "LOCKED");

  const downloadPromise = desktop.waitForEvent("download");
  await desktop.locator("#export-commissioning-record").click();
  const download = await downloadPromise;
  assert.match(download.suggestedFilename(), /\.mr1-commissioning\.json$/);
  const downloadedPath = await download.path();
  const downloadedBytes = await readFile(downloadedPath);
  const downloaded = JSON.parse(downloadedBytes.toString("utf8"));
  assert.equal(downloaded.record.physicalMotionPermitted, false);
  assert.deepEqual(Object.keys(downloaded.record.records), ["source_release"]);

  await desktop.locator("#commissioning-reset-confirm").check();
  await desktop.locator("#reset-commissioning-record").click();
  await desktop.waitForFunction(() => document.getElementById("commissioning-check-count")?.value === "0 OF 58");
  await desktop.locator("#commissioning-import-file").setInputFiles({
    name: download.suggestedFilename(),
    mimeType: "application/json",
    buffer: downloadedBytes,
  });
  await desktop.waitForFunction(() => /^VERIFIED \/ 1 RECORDS/.test(document.getElementById("commissioning-transfer-state")?.value ?? ""));
  await desktop.locator("#commissioning-import-confirm").check();
  await desktop.locator("#import-commissioning-record").click();
  await desktop.waitForFunction(() => document.getElementById("commissioning-check-count")?.value === "1 OF 58");
  assert.equal(await outputValue(desktop, "#commissioning-motion"), "LOCKED");
  await desktop.locator(".commissioning-panel-scroll").evaluate((element) => { element.scrollTop = 0; });
  await desktop.screenshot({ path: path.join(screenshots, "commissioning-record-desktop.png"), fullPage: true });
  desktopLayout = await layoutAudit(desktop);

  const mobile = await context.newPage();
  await mobile.setViewportSize({ width: 390, height: 844 });
  await preparePage(mobile);
  const mobileUrl = new URL(controlUrl);
  mobileUrl.searchParams.set("companion", "1");
  await mobile.goto(mobileUrl.href, { waitUntil: "domcontentloaded" });
  await mobile.locator("#viewer canvas").waitFor({ state: "visible" });
  await mobile.locator("#open-commissioning").click();
  const mobileLayout = await layoutAudit(mobile);
  assert.equal(mobileLayout.documentWidth, 390);
  assert.ok(mobileLayout.panel.left >= -1 && mobileLayout.panel.right <= 391);
  assert.ok(mobileLayout.panel.width >= 389);
  assert.ok(mobileLayout.stageList.left >= -1 && mobileLayout.stageList.right <= 391);
  assert.ok(mobileLayout.form.left >= -1 && mobileLayout.form.right <= 391);
  assert.equal(mobileLayout.motion, "LOCKED");
  assert.equal(mobileLayout.count, "1 OF 58");
  await mobile.screenshot({ path: path.join(screenshots, "commissioning-record-mobile.png"), fullPage: true });

  assert.deepEqual(errors, []);
  process.stdout.write(`${JSON.stringify({ desktop: desktopLayout, mobile: mobileLayout, artifactHash }, null, 2)}\n`);
} finally {
  await context.close();
  await browser.close();
  await service.stop();
  await rm(journalDirectory, { recursive: true, force: true });
}
