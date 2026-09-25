import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createTelemetryService } from "../service/mr1-telemetry-service.mjs";
import {
  addressToCad,
  DEFAULT_FIXTURE_MAP_PROFILE,
  normalizeFixtureMapProfile,
} from "../src/fixture-map-profile.js";
import {
  projectHomography,
  visibleFixtureReferences,
} from "../src/scene-registration.js";

import { importDependency } from "../tools/optional-dependencies.mjs";

const { chromium } = await importDependency("playwright");
const sharpModule = await importDependency("sharp", "dist/index.mjs");
const sharp = sharpModule.default ?? sharpModule;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const screenshots = path.join(root, "screenshots");
const productionFirmwarePath = path.join(root, "public", "firmware", "octopus-pro-v1.1-f429-mr1", "firmware.bin");
await mkdir(screenshots, { recursive: true });
const journalDirectory = await mkdtemp(path.join(tmpdir(), "mr1-visual-journal-"));

const sceneFixtureProfile = normalizeFixtureMapProfile({
  ...DEFAULT_FIXTURE_MAP_PROFILE,
  plateFrame: { x: -290, y: -270, z: -145, rotationDeg: 0.3 },
  locationsVerified: true,
  viseDatum: { ...DEFAULT_FIXTURE_MAP_PROFILE.viseDatum, z: 28 },
});
const sceneSyntheticMatrix = [2.25, 0.18, 960, -0.09, -1.72, 540, 0.00031, -0.00022, 1];
const sceneVisibleReferences = visibleFixtureReferences(sceneFixtureProfile);
const sceneReferenceTargets = [
  [-245, -245], [0, -245], [245, -245], [-245, 0],
  [245, 0], [-245, 245], [0, 245], [245, 245],
];
const sceneUsedAddresses = new Set();
const sceneReferences = sceneReferenceTargets.map(([x, y]) => {
  const reference = sceneVisibleReferences
    .filter(({ address }) => !sceneUsedAddresses.has(address))
    .sort((left, right) => (
      Math.hypot(left.cad.x - x, left.cad.y - y) - Math.hypot(right.cad.x - x, right.cad.y - y)
    ))[0];
  sceneUsedAddresses.add(reference.address);
  return { ...reference, pixel: projectHomography(sceneSyntheticMatrix, reference.cad) };
});
const sceneFrameBuffer = await sharp({
  create: { width: 1920, height: 1080, channels: 3, background: { r: 34, g: 40, b: 44 } },
}).png().toBuffer();
const alternateSceneFrameBuffer = await sharp({
  create: { width: 1920, height: 1080, channels: 3, background: { r: 52, g: 34, b: 38 } },
}).png().toBuffer();

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.PLAYWRIGHT_CHROME || undefined,
  args: ["--enable-webgl", "--use-angle=swiftshader"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const consoleErrors = [];
const pageErrors = [];
const observedDownloads = [];
const journalNetwork = { requests: [], responses: [] };
page.on("console", (message) => {
  if (message.type() === "error") consoleErrors.push(message.text());
});
page.on("pageerror", (error) => pageErrors.push(error.message));
page.on("download", (download) => observedDownloads.push(download.suggestedFilename()));
page.on("request", (request) => {
  if (request.url().includes("/journal/")) journalNetwork.requests.push(request.url());
});
page.on("response", (response) => {
  if (response.url().includes("/journal/")) journalNetwork.responses.push({
    url: response.url(),
    status: response.status(),
    disposition: response.headers()["content-disposition"] ?? null,
  });
});

async function canvasStats(name, minimumCoverage = 0.08) {
  const canvas = page.locator("#viewer canvas");
  await canvas.waitFor({ state: "visible" });
  const image = await canvas.screenshot({ path: path.join(screenshots, `${name}-canvas.png`) });
  const { data, info } = await sharp(image)
    .resize({ width: 720, height: 440, fit: "fill" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  let nonBackground = 0;
  let redPixels = 0;
  let cyanPixels = 0;
  const buckets = new Set();
  for (let offset = 0; offset < data.length; offset += info.channels) {
    const red = data[offset];
    const green = data[offset + 1];
    const blue = data[offset + 2];
    if (Math.abs(red - 11) + Math.abs(green - 13) + Math.abs(blue - 15) > 18) nonBackground += 1;
    if (red > 95 && red > green * 1.5 && red > blue * 1.35) redPixels += 1;
    if (red < 180 && green > 125 && blue > 165 && blue > red * 1.25) cyanPixels += 1;
    buckets.add(`${red >> 4}:${green >> 4}:${blue >> 4}`);
  }

  const pixels = data.length / info.channels;
  const coverage = nonBackground / pixels;
  assert.ok(
    coverage > minimumCoverage,
    `${name} canvas coverage was only ${(coverage * 100).toFixed(1)}%`,
  );
  assert.ok(buckets.size > 28, `${name} canvas had only ${buckets.size} quantized colors`);
  assert.ok(redPixels > 8, `${name} canvas did not render the red MR-1 accents`);
  return { coverage, colors: buckets.size, redPixels, cyanPixels };
}

async function layoutAudit(label) {
  const result = await page.evaluate(() => {
    const canvas = document.querySelector("#viewer canvas")?.getBoundingClientRect();
    const overflow = [...document.querySelectorAll(".mode-button, .command-button, #telemetry-source, output, .axis-readout, .command-bar, #job-status")]
      .filter((element) => element.clientWidth > 0 && element.scrollWidth > element.clientWidth + 2)
      .map((element) => ({
        tag: element.tagName,
        id: element.id,
        className: element.className,
        width: element.clientWidth,
        scrollWidth: element.scrollWidth,
      }));
    return {
      canvas: canvas && { width: canvas.width, height: canvas.height },
      overflow,
      state: document.getElementById("machine-state")?.textContent,
    };
  });
  assert.ok(result.canvas?.width > 280 && result.canvas?.height > 280, `${label} canvas is undersized`);
  assert.deepEqual(result.overflow, [], `${label} contains horizontally clipped controls`);
  return result;
}

async function fissionLayoutAudit(label) {
  const result = await page.evaluate(() => {
    const panelElement = document.getElementById("fission-settings-panel");
    const panel = panelElement?.getBoundingClientRect();
    const overflow = [...panelElement.querySelectorAll("input, select, output, button span, small")]
      .filter((element) => element.clientWidth > 0 && element.scrollWidth > element.clientWidth + 2)
      .map((element) => ({
        tag: element.tagName,
        id: element.id,
        text: element.textContent,
        width: element.clientWidth,
        scrollWidth: element.scrollWidth,
      }));
    return {
      panel: panel && {
        top: panel.top,
        right: panel.right,
        bottom: panel.bottom,
        width: panel.width,
        height: panel.height,
      },
      viewport: { width: innerWidth, height: innerHeight },
      documentWidth: {
        client: document.documentElement.clientWidth,
        scroll: document.documentElement.scrollWidth,
      },
      overflow,
    };
  });
  assert.ok(result.panel?.width >= Math.min(340, result.viewport.width - 20), `${label} panel is too narrow`);
  assert.ok(result.panel?.right <= result.viewport.width + 1, `${label} panel leaves the viewport`);
  assert.ok(result.panel?.top >= 50 && result.panel?.bottom <= result.viewport.height - 60, `${label} panel overlaps fixed bars`);
  assert.equal(result.documentWidth.scroll, result.documentWidth.client, `${label} creates document overflow`);
  assert.deepEqual(result.overflow, [], `${label} contains clipped rapid-restore controls`);
  return result;
}

async function probingLayoutAudit(label) {
  const result = await page.evaluate(() => {
    const panel = document.getElementById("probing-panel")?.getBoundingClientRect();
    const overflow = [...document.querySelectorAll("#probing-panel input, #probing-panel select, #probing-panel output, #probing-panel .panel-actions span")]
      .filter((element) => element.clientWidth > 0 && element.scrollWidth > element.clientWidth + 2)
      .map((element) => ({
        tag: element.tagName,
        id: element.id,
        width: element.clientWidth,
        scrollWidth: element.scrollWidth,
      }));
    return {
      panel: panel && {
        top: panel.top,
        right: panel.right,
        bottom: panel.bottom,
        width: panel.width,
        height: panel.height,
      },
      viewport: { width: innerWidth, height: innerHeight },
      overflow,
    };
  });
  assert.ok(result.panel?.width >= Math.min(390, result.viewport.width), `${label} panel is too narrow`);
  assert.ok(result.panel?.right <= result.viewport.width + 1, `${label} panel leaves the viewport`);
  assert.ok(result.panel?.top >= 50 && result.panel?.bottom <= result.viewport.height - 60, `${label} panel overlaps fixed bars`);
  assert.deepEqual(result.overflow, [], `${label} contains clipped probing controls`);
  return result;
}

async function cutterCompLayoutAudit(label) {
  const result = await page.evaluate(() => {
    const panelElement = document.getElementById("cutter-comp-panel");
    const panel = panelElement?.getBoundingClientRect();
    const scrollArea = panelElement?.querySelector(".cutter-comp-scroll");
    const overflow = [...panelElement.querySelectorAll("input, output, button span, button small, button strong")]
      .filter((element) => element.clientWidth > 0 && element.scrollWidth > element.clientWidth + 2)
      .map((element) => ({
        tag: element.tagName,
        id: element.id,
        text: element.textContent,
        width: element.clientWidth,
        scrollWidth: element.scrollWidth,
      }));
    return {
      panel: panel && {
        top: panel.top,
        right: panel.right,
        bottom: panel.bottom,
        width: panel.width,
        height: panel.height,
      },
      viewport: { width: innerWidth, height: innerHeight },
      documentWidth: {
        client: document.documentElement.clientWidth,
        scroll: document.documentElement.scrollWidth,
      },
      scrollArea: scrollArea && {
        clientWidth: scrollArea.clientWidth,
        scrollWidth: scrollArea.scrollWidth,
      },
      overflow,
    };
  });
  assert.ok(result.panel?.width >= Math.min(390, result.viewport.width), `${label} panel is too narrow`);
  assert.ok(result.panel?.right <= result.viewport.width + 1, `${label} panel leaves the viewport`);
  assert.ok(result.panel?.top >= 50 && result.panel?.bottom <= result.viewport.height - 60, `${label} panel overlaps fixed bars`);
  assert.equal(result.documentWidth.scroll, result.documentWidth.client, `${label} creates document overflow`);
  assert.ok(result.scrollArea?.scrollWidth <= result.scrollArea?.clientWidth + 2, `${label} content overflows horizontally`);
  assert.deepEqual(result.overflow, [], `${label} contains clipped cutter-comp controls`);
  return result;
}

async function metrologyLayoutAudit(label) {
  const result = await page.evaluate(() => {
    const panelElement = document.getElementById("metrology-panel");
    const panel = panelElement?.getBoundingClientRect();
    const scrollArea = panelElement?.querySelector(".metrology-scroll");
    const overflow = [...panelElement.querySelectorAll("input, select, output, button span, code, small")]
      .filter((element) => element.clientWidth > 0 && element.scrollWidth > element.clientWidth + 2)
      .map((element) => ({
        tag: element.tagName,
        id: element.id,
        text: element.textContent?.trim(),
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
      }));
    return {
      panel: panel && {
        top: panel.top,
        right: panel.right,
        bottom: panel.bottom,
        width: panel.width,
        height: panel.height,
      },
      viewport: { width: innerWidth, height: innerHeight },
      documentWidth: {
        client: document.documentElement.clientWidth,
        scroll: document.documentElement.scrollWidth,
      },
      scrollArea: scrollArea && {
        clientWidth: scrollArea.clientWidth,
        scrollWidth: scrollArea.scrollWidth,
      },
      overflow,
    };
  });
  assert.ok(result.panel?.width >= Math.min(390, result.viewport.width), `${label} panel is too narrow`);
  assert.ok(result.panel?.right <= result.viewport.width + 1, `${label} panel leaves the viewport`);
  assert.ok(result.panel?.top >= 50 && result.panel?.bottom <= result.viewport.height - 60, `${label} panel overlaps fixed bars`);
  assert.equal(result.documentWidth.scroll, result.documentWidth.client, `${label} creates document overflow`);
  assert.ok(result.scrollArea?.scrollWidth <= result.scrollArea?.clientWidth + 2, `${label} content overflows horizontally`);
  assert.deepEqual(result.overflow, [], `${label} contains clipped metrology controls`);
  return result;
}

async function sceneRegistrationLayoutAudit(label) {
  const result = await page.evaluate(() => {
    const panelElement = document.getElementById("scene-registration-panel");
    const panel = panelElement?.getBoundingClientRect();
    const scrollArea = panelElement?.querySelector(".scene-registration-scroll");
    const canvas = panelElement?.querySelector("#scene-registration-canvas")?.getBoundingClientRect();
    const overflow = [...panelElement.querySelectorAll("input, select, output, button span, code, small")]
      .filter((element) => element.clientWidth > 0 && element.scrollWidth > element.clientWidth + 2)
      .map((element) => ({
        tag: element.tagName,
        id: element.id,
        text: element.textContent?.trim(),
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
      }));
    return {
      panel: panel && {
        top: panel.top,
        right: panel.right,
        bottom: panel.bottom,
        width: panel.width,
        height: panel.height,
      },
      canvas: canvas && { width: canvas.width, height: canvas.height },
      viewport: { width: innerWidth, height: innerHeight },
      documentWidth: {
        client: document.documentElement.clientWidth,
        scroll: document.documentElement.scrollWidth,
      },
      scrollArea: scrollArea && {
        clientWidth: scrollArea.clientWidth,
        scrollWidth: scrollArea.scrollWidth,
      },
      wideContainers: [...panelElement.querySelectorAll("section, fieldset, form, div")]
        .filter((element) => element.clientWidth > 0 && element.scrollWidth > element.clientWidth + 2)
        .map((element) => ({
          id: element.id,
          className: element.className,
          clientWidth: element.clientWidth,
          scrollWidth: element.scrollWidth,
        }))
        .sort((left, right) => (right.scrollWidth - right.clientWidth) - (left.scrollWidth - left.clientWidth))
        .slice(0, 12),
      overflow,
    };
  });
  assert.ok(result.panel?.width >= Math.min(390, result.viewport.width), `${label} panel is too narrow`);
  assert.ok(result.panel?.right <= result.viewport.width + 1, `${label} panel leaves the viewport`);
  assert.ok(result.panel?.top >= 50 && result.panel?.bottom <= result.viewport.height - 60, `${label} panel overlaps fixed bars`);
  assert.ok(result.canvas?.width > Math.min(300, result.viewport.width - 40), `${label} camera frame is undersized`);
  assert.equal(result.documentWidth.scroll, result.documentWidth.client, `${label} creates document overflow`);
  assert.ok(
    result.scrollArea?.scrollWidth <= result.scrollArea?.clientWidth + 2,
    `${label} content overflows horizontally: ${JSON.stringify(result.wideContainers)}`,
  );
  assert.deepEqual(result.overflow, [], `${label} contains clipped scene-registration controls`);
  return result;
}

async function spindleLayoutAudit(label) {
  await page.waitForFunction(() => {
    const panel = document.getElementById("spindle-panel")?.getBoundingClientRect();
    return panel && panel.right <= innerWidth + 1;
  }, null, { timeout: 2000 });
  const result = await page.evaluate(() => {
    const panel = document.getElementById("spindle-panel")?.getBoundingClientRect();
    const overflow = [...document.querySelectorAll("#spindle-panel output, #spindle-panel span, #spindle-panel small")]
      .filter((element) => element.clientWidth > 0 && element.scrollWidth > element.clientWidth + 2)
      .map((element) => ({
        tag: element.tagName,
        id: element.id,
        text: element.textContent,
        width: element.clientWidth,
        scrollWidth: element.scrollWidth,
      }));
    return {
      panel: panel && {
        top: panel.top,
        right: panel.right,
        bottom: panel.bottom,
        width: panel.width,
        height: panel.height,
      },
      viewport: { width: innerWidth, height: innerHeight },
      overflow,
    };
  });
  assert.ok(result.panel?.width >= Math.min(390, result.viewport.width), `${label} panel is too narrow`);
  assert.ok(result.panel?.right <= result.viewport.width + 1, `${label} panel leaves the viewport`);
  assert.ok(result.panel?.top >= 50 && result.panel?.bottom <= result.viewport.height - 60, `${label} panel overlaps fixed bars`);
  assert.deepEqual(result.overflow, [], `${label} contains clipped spindle data`);
  return result;
}

async function sensorCanvasAudit(label) {
  const image = await page.locator("#sensor-history-canvas").screenshot({
    path: path.join(screenshots, `${label}-sensor-canvas.png`),
  });
  const { data, info } = await sharp(image).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let redPixels = 0;
  let lightPixels = 0;
  for (let index = 0; index < data.length; index += info.channels) {
    const red = data[index];
    const green = data[index + 1];
    const blue = data[index + 2];
    if (red > 145 && red > green * 1.45 && red > blue * 1.35) redPixels += 1;
    if (red > 115 && green > 115 && blue > 115) lightPixels += 1;
  }
  assert.ok(redPixels > 40, `${label} sensor chart is missing the fused red trace`);
  assert.ok(lightPixels > 40, `${label} sensor chart is missing component traces and labels`);
  return { redPixels, lightPixels, width: info.width, height: info.height };
}

async function jogLayoutAudit(label) {
  await page.waitForFunction(() => {
    const panel = document.getElementById("jog-panel")?.getBoundingClientRect();
    return panel && panel.right <= innerWidth + 1;
  }, null, { timeout: 2000 });
  const result = await page.evaluate(() => {
    const panel = document.getElementById("jog-panel")?.getBoundingClientRect();
    const overflow = [...document.querySelectorAll("#jog-panel output, #jog-panel button span, #jog-panel small")]
      .filter((element) => element.clientWidth > 0 && element.scrollWidth > element.clientWidth + 2)
      .map((element) => ({
        tag: element.tagName,
        id: element.id,
        text: element.textContent,
        width: element.clientWidth,
        scrollWidth: element.scrollWidth,
      }));
    return {
      panel: panel && {
        top: panel.top,
        right: panel.right,
        bottom: panel.bottom,
        width: panel.width,
        height: panel.height,
      },
      viewport: { width: innerWidth, height: innerHeight },
      overflow,
    };
  });
  assert.ok(result.panel?.width >= Math.min(390, result.viewport.width), `${label} panel is too narrow`);
  assert.ok(result.panel?.right <= result.viewport.width + 1, `${label} panel leaves the viewport`);
  assert.ok(result.panel?.top >= 50 && result.panel?.bottom <= result.viewport.height - 60, `${label} panel overlaps fixed bars`);
  assert.deepEqual(result.overflow, [], `${label} contains clipped jog controls`);
  return result;
}

async function machineDataLayoutAudit(label) {
  const result = await page.evaluate(() => {
    const panelElement = document.getElementById("machine-data-panel");
    const panel = panelElement?.getBoundingClientRect();
    const scrollArea = panelElement?.querySelector(".machine-data-scroll");
    const overflow = [...panelElement.querySelectorAll("input, output, button span, a span, small")]
      .filter((element) => element.clientWidth > 0 && element.scrollWidth > element.clientWidth + 2)
      .map((element) => ({
        tag: element.tagName,
        id: element.id,
        text: element.textContent,
        width: element.clientWidth,
        scrollWidth: element.scrollWidth,
      }));
    return {
      panel: panel && {
        top: panel.top,
        right: panel.right,
        bottom: panel.bottom,
        width: panel.width,
        height: panel.height,
      },
      viewport: { width: innerWidth, height: innerHeight },
      documentWidth: {
        client: document.documentElement.clientWidth,
        scroll: document.documentElement.scrollWidth,
      },
      scrollArea: scrollArea && {
        clientWidth: scrollArea.clientWidth,
        scrollWidth: scrollArea.scrollWidth,
      },
      overflow,
    };
  });
  assert.ok(result.panel?.width >= Math.min(390, result.viewport.width), `${label} panel is too narrow`);
  assert.ok(result.panel?.right <= result.viewport.width + 1, `${label} panel leaves the viewport`);
  assert.ok(result.panel?.top >= 50 && result.panel?.bottom <= result.viewport.height - 60, `${label} panel overlaps fixed bars`);
  assert.equal(result.documentWidth.scroll, result.documentWidth.client, `${label} creates document overflow`);
  assert.ok(result.scrollArea?.scrollWidth <= result.scrollArea?.clientWidth + 2, `${label} content overflows horizontally`);
  assert.deepEqual(result.overflow, [], `${label} contains clipped machine-data controls`);
  return result;
}

async function controllerSettingsLayoutAudit(label, expectedTab) {
  const result = await page.evaluate(() => {
    const panelElement = document.getElementById("controller-settings-panel");
    const panel = panelElement?.getBoundingClientRect();
    const scrollArea = panelElement?.querySelector(".controller-system-scroll");
    const selectedTab = panelElement?.querySelector('[data-controller-system-tab][aria-selected="true"]');
    const activePanel = panelElement?.querySelector("[data-controller-system-panel]:not([hidden])");
    const clippedControls = activePanel
      ? [...activePanel.querySelectorAll("input, select, button span, a span")]
        .filter((element) => element.clientWidth > 0 && element.scrollWidth > element.clientWidth + 2)
        .map((element) => ({
          tag: element.tagName,
          id: element.id,
          text: element.textContent,
          width: element.clientWidth,
          scrollWidth: element.scrollWidth,
        }))
      : [];
    return {
      panel: panel && {
        top: panel.top,
        right: panel.right,
        bottom: panel.bottom,
        width: panel.width,
        height: panel.height,
      },
      viewport: { width: innerWidth, height: innerHeight },
      documentWidth: {
        client: document.documentElement.clientWidth,
        scroll: document.documentElement.scrollWidth,
      },
      scrollArea: scrollArea && {
        overflowX: getComputedStyle(scrollArea).overflowX,
      },
      selectedTab: selectedTab?.textContent?.trim(),
      activePanel: activePanel?.id,
      clippedControls,
    };
  });
  assert.ok(result.panel?.width >= Math.min(700, result.viewport.width), `${label} panel is too narrow`);
  assert.ok(result.panel?.right <= result.viewport.width + 1, `${label} panel leaves the viewport`);
  assert.ok(result.panel?.top >= 50 && result.panel?.bottom <= result.viewport.height - 60, `${label} panel overlaps fixed bars`);
  assert.equal(result.documentWidth.scroll, result.documentWidth.client, `${label} creates document overflow`);
  assert.equal(result.scrollArea?.overflowX, "hidden", `${label} does not contain the settings workspace`);
  assert.equal(result.selectedTab, expectedTab, `${label} selected the wrong controller-system tab`);
  assert.deepEqual(result.clippedControls, [], `${label} contains clipped settings controls`);
  return result;
}

async function wiringLayoutAudit(label, expectedTab) {
  const result = await page.evaluate(() => {
    const panelElement = document.getElementById("wiring-panel");
    const panel = panelElement?.getBoundingClientRect();
    const scrollArea = panelElement?.querySelector(".probing-panel-scroll");
    const activePanel = panelElement?.querySelector("[data-wiring-panel]:not([hidden])");
    const selectedTab = panelElement?.querySelector('[data-wiring-tab][aria-selected="true"]');
    const overflow = activePanel
      ? [...activePanel.querySelectorAll("output, strong, code, span, p, b, small, em")]
        .filter((element) => !element.matches(".wire-route > span")
          && element.clientWidth > 0
          && element.scrollWidth > element.clientWidth + 2)
        .map((element) => ({
          tag: element.tagName,
          text: element.textContent,
          width: element.clientWidth,
          scrollWidth: element.scrollWidth,
        }))
      : [];
    return {
      panel: panel && {
        top: panel.top,
        right: panel.right,
        bottom: panel.bottom,
        width: panel.width,
        height: panel.height,
      },
      viewport: { width: innerWidth, height: innerHeight },
      documentWidth: {
        client: document.documentElement.clientWidth,
        scroll: document.documentElement.scrollWidth,
      },
      scrollArea: scrollArea && {
        clientWidth: scrollArea.clientWidth,
        scrollWidth: scrollArea.scrollWidth,
      },
      selectedTab: selectedTab?.textContent?.trim(),
      activePanel: activePanel?.id,
      overflow,
    };
  });
  assert.ok(result.panel?.width >= Math.min(390, result.viewport.width), `${label} panel is too narrow`);
  assert.ok(result.panel?.right <= result.viewport.width + 1, `${label} panel leaves the viewport`);
  assert.ok(result.panel?.top >= 50 && result.panel?.bottom <= result.viewport.height - 60, `${label} panel overlaps fixed bars`);
  assert.equal(result.documentWidth.scroll, result.documentWidth.client, `${label} creates document overflow`);
  assert.ok(result.scrollArea?.scrollWidth <= result.scrollArea?.clientWidth + 2, `${label} wiring content overflows horizontally`);
  assert.equal(result.selectedTab, expectedTab, `${label} selected the wrong wiring tab`);
  assert.deepEqual(result.overflow, [], `${label} contains clipped wiring text`);
  return result;
}

async function fixtureMapLayoutAudit(label) {
  const result = await page.evaluate(() => {
    const panel = document.getElementById("fixture-map-panel")?.getBoundingClientRect();
    const canvas = document.getElementById("fixture-map-canvas")?.getBoundingClientRect();
    const workspace = document.querySelector(".control-workspace")?.getBoundingClientRect();
    const viewer = document.getElementById("viewer")?.getBoundingClientRect();
    const overflow = [...document.querySelectorAll(
      "#fixture-map-panel input, #fixture-map-panel output, #fixture-map-panel button span, #fixture-map-panel small",
    )]
      .filter((element) => element.clientWidth > 0 && element.scrollWidth > element.clientWidth + 2)
      .map((element) => ({
        tag: element.tagName,
        id: element.id,
        text: element.textContent,
        width: element.clientWidth,
        scrollWidth: element.scrollWidth,
      }));
    return {
      panel: panel && {
        top: panel.top,
        right: panel.right,
        bottom: panel.bottom,
        width: panel.width,
        height: panel.height,
      },
      canvas: canvas && { width: canvas.width, height: canvas.height },
      workspace: workspace && { left: workspace.left, right: workspace.right, width: workspace.width },
      viewer: viewer && { left: viewer.left, right: viewer.right, width: viewer.width },
      viewport: { width: innerWidth, height: innerHeight },
      overflow,
    };
  });
  assert.ok(result.panel?.width >= Math.min(390, result.viewport.width), `${label} panel is too narrow`);
  assert.ok(result.panel?.right <= result.viewport.width + 1, `${label} panel leaves the viewport`);
  assert.ok(result.panel?.top >= 50 && result.panel?.bottom <= result.viewport.height - 60, `${label} panel overlaps fixed bars`);
  assert.ok(result.canvas?.width > 330 && result.canvas?.height > 330, `${label} table map is undersized`);
  if (result.viewport.width >= 900) {
    assert.ok(result.workspace?.right <= result.viewport.width - result.panel.width + 1, `${label} does not dock beside the live machine`);
    assert.ok(result.viewer?.width >= 300, `${label} leaves too little live machine preview`);
  }
  assert.deepEqual(result.overflow, [], `${label} contains clipped fixture-map controls`);
  return result;
}

async function waitForImportedJob(expectedName, timeout = 45_000) {
  await page.waitForFunction(
    (name) => {
      const jobName = document.getElementById("job-name")?.textContent;
      const jobStatus = document.getElementById("job-status")?.textContent;
      return jobName === name || jobStatus === "LOAD FAILED";
    },
    expectedName,
    { timeout },
  );
  const result = await page.evaluate(() => ({
    name: document.getElementById("job-name")?.textContent,
    status: document.getElementById("job-status")?.textContent,
    detail: document.getElementById("job-status")?.getAttribute("title"),
  }));
  assert.equal(
    result.name,
    expectedName,
    `G-code import failed at ${result.status}: ${result.detail || "no failure detail"}`,
  );
}

const telemetryService = createTelemetryService({
  mode: "simulate",
  httpPort: 0,
  journalDirectory,
});

try {
  const telemetryAddress = await telemetryService.start();
  assert.ok(telemetryAddress?.url, "isolated visual-test telemetry bridge did not start");
  await page.addInitScript(({ telemetryBaseUrl }) => {
    const rewriteLoopbackUrl = (value) => String(value).replace(
      /^http:\/\/127\.0\.0\.1:8787(?=\/|$)/,
      telemetryBaseUrl,
    );

    const NativeEventSource = window.EventSource;
    window.EventSource = new Proxy(NativeEventSource, {
      construct(Target, args) {
        const rewrittenArgs = [...args];
        rewrittenArgs[0] = rewriteLoopbackUrl(rewrittenArgs[0]);
        return Reflect.construct(Target, rewrittenArgs, Target);
      },
    });

    const nativeFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      if (typeof input === "string" || input instanceof URL) {
        return nativeFetch(rewriteLoopbackUrl(input), init);
      }
      if (input instanceof Request) {
        const rewrittenUrl = rewriteLoopbackUrl(input.url);
        if (rewrittenUrl !== input.url) return nativeFetch(new Request(rewrittenUrl, input), init);
      }
      return nativeFetch(input, init);
    };
  }, { telemetryBaseUrl: telemetryAddress.url });
  const visualUrl = new URL(process.env.MR1_CONTROL_URL ?? "http://127.0.0.1:5173");
  visualUrl.searchParams.set("render-quality", process.env.MR1_VISUAL_QUALITY ?? "balanced");
  await page.goto(visualUrl.href, { waitUntil: "networkidle" });
  await page.locator("#viewer canvas").waitFor({ state: "visible" });
  await page.waitForFunction(
    () => {
      const viewer = document.querySelector("#viewer");
      return viewer?.dataset.cadState === "ready"
        && viewer?.dataset.machineCadState === "ready"
        && viewer?.dataset.brandingState === "ready"
        && viewer?.dataset.resinState === "ready";
    },
    null,
    { timeout: 30000 },
  );
  await page.waitForTimeout(900);

  const renderedMachineTriangles = Number(
    await page.locator("#viewer").getAttribute("data-machine-cad-triangles"),
  );
  assert.ok(renderedMachineTriangles > 100000, "MR-1 assembly detail did not load");
  assert.ok(renderedMachineTriangles < 600000, "MR-1 assembly exceeded the rendered triangle budget");
  assert.equal(await page.locator("#viewer").getAttribute("data-lead-screw-count"), "4");
  assert.equal(await page.locator("#viewer").getAttribute("data-render-quality"), process.env.MR1_VISUAL_QUALITY ?? "balanced");
  const expectedCoolantParticles = { reduced: "12", balanced: "18", full: "36" }[
    process.env.MR1_VISUAL_QUALITY ?? "balanced"
  ];
  assert.equal(await page.locator("#viewer").getAttribute("data-coolant-particle-count"), expectedCoolantParticles);
  assert.equal(await page.locator("#viewer").getAttribute("data-coolant-mode"), "off");
  const stoppedScrewRotations = await page.locator("#viewer").getAttribute("data-lead-screw-rotations");

  const idleRenderCount = Number(await page.locator("#viewer").getAttribute("data-render-count"));
  await page.waitForTimeout(600);
  const settledRenderCount = Number(await page.locator("#viewer").getAttribute("data-render-count"));
  assert.equal(settledRenderCount, idleRenderCount, "idle machine view continued rendering");

  const desktopLayout = await layoutAudit("desktop machine view");
  const machinePixels = await canvasStats("machine-desktop");
  await page.screenshot({ path: path.join(screenshots, "machine-desktop.png"), fullPage: true });

  await page.getByRole("button", { name: "Fusion rapid restore settings" }).click();
  await page.waitForFunction(() => document.getElementById("fission-processor-state")?.value === "REVIEWED");
  assert.equal(await page.locator("#fission-auto-state").evaluate((element) => element.value), "HELD");
  assert.equal(await page.locator("#fission-safe-z").inputValue(), "3");
  assert.equal(await page.locator("#fission-safe-z-verified").isChecked(), false);
  const fissionDesktopLayout = await fissionLayoutAudit("desktop rapid restore");
  await page.locator("#fission-safe-z").fill("4");
  assert.equal(await page.locator("#fission-safe-z-verified").isChecked(), false);
  await page.locator("#fission-safe-z").fill("3");
  await page.locator("#fission-safe-z-verified").check();
  await page.locator("#save-fission-settings").click();
  assert.equal(await page.locator("#fission-auto-state").evaluate((element) => element.value), "ARMED");
  assert.match(await page.locator("#fission-settings-validation").textContent(), /PROFILE SAVED/);
  await page.screenshot({ path: path.join(screenshots, "rapid-restore-desktop.png"), fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  const fissionMobileLayout = await fissionLayoutAudit("mobile rapid restore");
  await page.screenshot({ path: path.join(screenshots, "rapid-restore-mobile.png"), fullPage: true });
  await page.locator("#close-fission-settings").click();
  await page.setViewportSize({ width: 1440, height: 900 });

  await page.getByRole("button", { name: "Cutter compensation and tool wear" }).click();
  await page.waitForFunction(() => document.getElementById("cutter-comp-panel")?.getAttribute("aria-hidden") === "false");
  assert.equal(await page.locator("#cutter-job-tools").evaluate((element) => element.value), "T1");
  assert.equal(await page.locator("#save-cutter-tool").isDisabled(), true);
  await page.locator("#cutter-tool-number").fill("3");
  await page.locator("#cutter-tool-label").fill("6 MM FINISHER");
  await page.locator("#cutter-programmed-diameter").fill("6");
  await page.locator("#cutter-measured-diameter").fill("5.992");
  assert.equal(await page.locator("#cutter-next-diameter").evaluate((element) => element.value), "5.992 mm");
  assert.equal(await page.locator("#cutter-radial-shift").evaluate((element) => element.value), "0.004 mm");
  await page.locator("#save-cutter-tool").click();
  assert.match(await page.locator("#cutter-comp-validation").textContent(), /TOOL SAVED/);
  assert.match(await page.locator("#cutter-saved-tool-list").textContent(), /6 MM FINISHER/);
  await page.locator('[data-cutter-mode="feature"]').click();
  await page.locator("#cutter-target-size").fill("50");
  await page.locator("#cutter-measured-size").fill("50.04");
  assert.equal(await page.locator("#cutter-next-diameter").evaluate((element) => element.value), "5.960 mm");
  assert.equal(await page.locator("#cutter-diameter-adjustment").evaluate((element) => element.value), "-0.040 mm");
  assert.equal(await page.locator("#cutter-feature-error").evaluate((element) => element.value), "+0.040 mm");
  await page.locator("#cutter-comp-panel .cutter-comp-scroll").evaluate((element) => { element.scrollTop = 0; });
  const cutterCompDesktopLayout = await cutterCompLayoutAudit("desktop cutter compensation");
  await page.screenshot({ path: path.join(screenshots, "cutter-comp-desktop.png"), fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  await page.locator("#cutter-comp-panel .cutter-comp-scroll").evaluate((element) => { element.scrollTop = 0; });
  const cutterCompMobileLayout = await cutterCompLayoutAudit("mobile cutter compensation");
  await page.screenshot({ path: path.join(screenshots, "cutter-comp-mobile.png"), fullPage: true });
  await page.getByRole("button", { name: "Close cutter compensation", exact: true }).last().click();
  await page.setViewportSize({ width: 1440, height: 900 });

  await page.getByRole("button", { name: "Metrology and reverse engineering" }).click();
  await page.waitForFunction(() => document.getElementById("metrology-panel")?.getAttribute("aria-hidden") === "false");
  assert.equal(await page.locator("#metrology-point-count").evaluate((element) => element.value), "0");
  assert.match(await page.locator("#metrology-panel .metrology-command-lock").textContent(), /READ-ONLY \/ LOCKED/);
  assert.equal(await page.locator('[data-metrology-export="csv"]').isDisabled(), true);
  assert.equal(await page.locator("#metrology-probe-cal-state").evaluate((element) => element.value), "0 OF 6");
  await page.locator("#metrology-probe-id").fill("P1-SHOP");
  await page.locator("#metrology-ball-diameter").fill("4");
  await page.locator("#metrology-stylus-length").fill("50");
  await page.locator("#metrology-tip-offset-x").fill("0");
  await page.locator("#metrology-tip-offset-y").fill("0");
  await page.locator("#metrology-tip-offset-z").fill("0");
  await page.locator("#metrology-artifact-id").fill("RING-20");
  await page.locator("#metrology-artifact-size").fill("20");
  await page.locator("#metrology-calibrated-at").fill(new Date().toISOString().slice(0, 10));
  await page.locator("#metrology-repeatability").fill("0.003");
  await page.locator("#metrology-sample-count").fill("10");
  for (const direction of ["+x", "-x", "+y", "-y", "+z", "-z"]) {
    await page.locator(`[data-metrology-radius="${direction}"]`).fill("2");
  }
  await page.locator("#metrology-save-calibration").click();
  assert.equal(await page.locator("#metrology-probe-cal-state").evaluate((element) => element.value), "6 OF 6");
  assert.match(await page.locator("#metrology-calibration-validation").textContent(), /QUALIFIED \/ P1-SHOP/);
  await page.locator(".metrology-calibration-section").scrollIntoViewIfNeeded();
  const metrologyCalibrationDesktopLayout = await metrologyLayoutAudit("desktop calibrated probe engine");
  await page.screenshot({ path: path.join(screenshots, "metrology-calibration-desktop.png"), fullPage: true });
  await page.locator('[data-metrology-point-mode="corrected"]').click();
  assert.equal(await page.locator('[data-metrology-point-mode="corrected"]').getAttribute("aria-pressed"), "true");
  const borePoints = [
    [14, 23, 0],
    [13, 24, 0],
    [7, 24, 0],
    [6, 23, 0],
    [6, 17, 0],
    [7, 16, 0],
    [13, 16, 0],
    [14, 17, 0],
  ];
  for (const [x, y, z] of borePoints) {
    await page.locator("#metrology-point-x").fill(String(x));
    await page.locator("#metrology-point-y").fill(String(y));
    await page.locator("#metrology-point-z").fill(String(z));
    await page.locator("#metrology-add-manual").click();
  }
  await page.locator("#metrology-nominal-size").fill("10");
  await page.locator("#metrology-nominal-size").blur();
  assert.equal(await page.locator("#metrology-point-count").evaluate((element) => element.value), "8");
  assert.equal(await page.locator("#metrology-result-type").textContent(), "CIRCLE / BORE XY");
  assert.equal(await page.locator("#metrology-result-value").evaluate((element) => element.value), "10.000 mm");
  assert.match(await page.locator("#metrology-result-grid").textContent(), /FIT QUALITYHIGH/);
  assert.match(await page.locator("#metrology-result-grid").textContent(), /TOLERANCEPASS/);
  assert.equal(await page.locator("#viewer").getAttribute("data-metrology-point-count"), "8");
  await page.locator("#metrology-panel .metrology-scroll").evaluate((element) => { element.scrollTop = 0; });
  const metrologyDesktopLayout = await metrologyLayoutAudit("desktop metrology");
  await page.screenshot({ path: path.join(screenshots, "metrology-desktop.png"), fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  await page.locator("#metrology-panel .metrology-scroll").evaluate((element) => { element.scrollTop = 0; });
  const metrologyMobileLayout = await metrologyLayoutAudit("mobile metrology");
  await page.screenshot({ path: path.join(screenshots, "metrology-mobile.png"), fullPage: true });
  await page.locator("#metrology-clear").click();
  await page.getByRole("button", { name: "Close metrology", exact: true }).last().click();
  await page.setViewportSize({ width: 1440, height: 900 });

  await page.getByRole("button", { name: "Fixture map and work offsets" }).click();
  await page.waitForFunction(() => document.getElementById("fixture-map-panel")?.getAttribute("aria-hidden") === "false");
  await page.waitForTimeout(250);
  assert.equal(await page.locator("#fixture-grid-summary").evaluate((element) => element.value), "A1–BF58 / 1,631 CAD HOLES");
  assert.equal(await page.locator("#fixture-grid-columns").inputValue(), "58");
  assert.equal(await page.locator("#fixture-grid-columns").getAttribute("readonly"), "");
  assert.equal(await page.locator("[data-fixture-id=\"V1\"] output").evaluate((element) => element.value), "N20 / 0° / 52.4 mm");
  assert.equal(await page.locator("#fixture-datum-reference").inputValue(), "fixed-jaw-left");
  assert.equal(await page.locator("#fixture-datum-x").inputValue(), "-47.752");
  assert.equal(await page.locator("#fixture-datum-y").inputValue(), "39.326");
  assert.equal(await page.locator("#fixture-jaw-opening").inputValue(), "52.4");
  const fixedJawDatumBeforeOpening = [
    await page.locator("#fixture-datum-x").inputValue(),
    await page.locator("#fixture-datum-y").inputValue(),
  ];
  const fixtureLayoutBeforeOpening = await page.locator("#viewer").getAttribute("data-fixture-layout");
  await page.locator("#fixture-jaw-opening-range").fill("90");
  assert.equal(await page.locator("#fixture-jaw-opening").inputValue(), "90");
  assert.equal(await page.locator("#fixture-jaw-opening-output").evaluate((element) => element.value), "90.0 mm");
  assert.equal(await page.locator("[data-fixture-id=\"V1\"] output").evaluate((element) => element.value), "N20 / 0° / 90.0 mm");
  assert.notEqual(await page.locator("#viewer").getAttribute("data-fixture-layout"), fixtureLayoutBeforeOpening);
  assert.match(await page.locator("#viewer").getAttribute("data-fixture-layout"), /V1:[^|]+jaw=90(?:\||$)/);
  assert.deepEqual([
    await page.locator("#fixture-datum-x").inputValue(),
    await page.locator("#fixture-datum-y").inputValue(),
  ], fixedJawDatumBeforeOpening);
  await page.locator("#fixture-jaw-opening-range").fill("52.4");
  assert.equal(await page.locator("#apply-work-offset").isDisabled(), true);
  assert.equal(await page.locator("#viewer").getAttribute("data-visible-vise-count"), "5");
  await page.locator("[data-fixture-enabled=\"V5\"]").uncheck();
  assert.equal(await page.locator("[data-fixture-id=\"V5\"] output").evaluate((element) => element.value), "OFF");
  assert.equal(await page.locator("#viewer").getAttribute("data-visible-vise-count"), "4");
  assert.match(await page.locator("#viewer").getAttribute("data-fixture-layout"), /V5:off/);
  await page.locator("[data-fixture-enabled=\"V5\"]").check();
  assert.equal(await page.locator("#viewer").getAttribute("data-visible-vise-count"), "5");
  await page.locator("#fixture-address").fill("Z17");
  assert.equal(await page.locator("#fixture-map-validation").textContent(), "TABLE ADDRESS IS NOT A CAD FIXTURE HOLE");
  assert.equal(await page.locator("#save-fixture-map").isDisabled(), true);
  await page.locator("#fixture-address").fill("N20");
  await page.locator("[data-fixture-id=\"V2\"]").click();
  const fixtureLayoutBeforeMove = await page.locator("#viewer").getAttribute("data-fixture-layout");
  await page.locator("#fixture-address").fill("P20");
  assert.notEqual(await page.locator("#viewer").getAttribute("data-fixture-layout"), fixtureLayoutBeforeMove);
  assert.match(await page.locator("#fixture-map-validation").textContent(), /OVERLAPS V1/);
  await page.locator("#fixture-address").fill("AC19");
  await page.locator("[data-fixture-id=\"V1\"]").click();
  await page.locator("#fixture-datum-z").fill("28");
  await page.locator("#fixture-cal-homed").evaluate((element) => {
    element.checked = true;
    element.dispatchEvent(new Event("change", { bubbles: true }));
  });
  const calibratedFrame = { x: -290, y: -270, z: -145, rotationDeg: 0.3 };
  const calibrationRadians = calibratedFrame.rotationDeg * Math.PI / 180;
  for (const address of ["D4", "BC4", "D55", "BC55", "AC5", "AC54"]) {
    const cad = addressToCad(address, sceneFixtureProfile.grid);
    assert.ok(cad, `${address} must resolve to a CAD fixture hole`);
    const machineX = calibratedFrame.x
      + cad.x * Math.cos(calibrationRadians)
      - cad.y * Math.sin(calibrationRadians);
    const machineY = calibratedFrame.y
      + cad.x * Math.sin(calibrationRadians)
      + cad.y * Math.cos(calibrationRadians);
    const topZ = calibratedFrame.z + cad.x * 0.0002 - cad.y * 0.0001;
    await page.locator("#fixture-cal-address").fill(address);
    await page.locator("#fixture-cal-x").fill(machineX.toFixed(6));
    await page.locator("#fixture-cal-y").fill(machineY.toFixed(6));
    await page.locator("#fixture-cal-z").fill(topZ.toFixed(6));
    await page.locator("#fixture-cal-add").click();
  }
  assert.equal(await page.locator("#fixture-cal-state").evaluate((element) => element.value), "READY TO APPLY");
  assert.equal(await page.locator("#fixture-cal-consensus").evaluate((element) => element.value), "6 / 0");
  assert.equal(await page.locator("#fixture-cal-apply").isEnabled(), true);
  assert.match(await page.locator("#fixture-cal-center").evaluate((element) => element.value), /-290\.000 \/ -270\.000 \/ -145\.000/);
  assert.equal(await page.locator("#fixture-cal-yaw").evaluate((element) => element.value), "0.3000 deg");
  await page.locator("#fixture-cal-apply").click();
  assert.equal(await page.locator("#fixture-frame-state").evaluate((element) => element.value), "PROBE QUALIFIED");
  assert.equal(await page.locator("#fixture-frame-x").getAttribute("readonly"), "");
  assert.ok(Math.abs(Number(await page.locator("#fixture-frame-x").inputValue()) + 290) < 0.000001);
  await page.locator("#fixture-cal-apply").scrollIntoViewIfNeeded();
  const tableCalibrationDesktopLayout = await fixtureMapLayoutAudit("desktop table-frame calibration");
  await page.screenshot({ path: path.join(screenshots, "table-frame-calibration-desktop.png"), fullPage: true });
  await page.locator("#fixture-locations-verified").evaluate((element) => {
    element.checked = true;
    element.dispatchEvent(new Event("change", { bubbles: true }));
  });
  assert.equal(await page.locator("#save-fixture-map").isEnabled(), true);
  await page.locator("#save-fixture-map").click();
  assert.match(await page.locator("#fixture-map-validation").textContent(), /MAP SAVED/);
  await page.locator("#fixture-map-panel .fixture-map-scroll").evaluate((element) => { element.scrollTop = 0; });
  const fixtureMapDesktopLayout = await fixtureMapLayoutAudit("desktop fixture map");
  await page.screenshot({ path: path.join(screenshots, "fixture-map-desktop.png"), fullPage: true });

  await page.locator("[data-fixture-rotation=\"0\"]").evaluate((element) => element.blur());
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(350);
  await page.locator("#fixture-cal-apply").scrollIntoViewIfNeeded();
  assert.equal(await page.locator("#fixture-cal-state").evaluate((element) => element.value), "CALIBRATED");
  assert.match(await page.locator("#fixture-cal-validation").textContent(), /RAW EVIDENCE RETAINED/);
  assert.equal(await page.locator("#fixture-cal-apply").isDisabled(), true);
  const tableCalibrationMobileLayout = await fixtureMapLayoutAudit("mobile table-frame calibration");
  await page.screenshot({ path: path.join(screenshots, "table-frame-calibration-mobile.png"), fullPage: true });
  await page.locator("#fixture-map-panel .fixture-map-scroll").evaluate((element) => { element.scrollTop = 0; });
  const fixtureMapMobileLayout = await fixtureMapLayoutAudit("mobile fixture map");
  await page.screenshot({ path: path.join(screenshots, "fixture-map-mobile.png"), fullPage: true });
  await page.locator("#close-fixture-map").click();
  await page.setViewportSize({ width: 1440, height: 900 });

  await page.getByRole("button", { name: "Camera scene registration" }).click();
  await page.waitForFunction(() => document.getElementById("scene-registration-panel")?.getAttribute("aria-hidden") === "false");
  assert.match(await page.locator(".scene-command-lock").textContent(), /PLAN REVIEW ONLY \/ NO MACHINE COMMANDS/);
  assert.equal(await page.locator("#scene-run-probe-plan").isDisabled(), true);
  assert.equal(await page.locator("#scene-auto-detect").isDisabled(), true);
  assert.match(await page.locator("#scene-visible-hole-count").evaluate((element) => element.value), /VISIBLE HOLES/);
  await page.locator("#scene-frame-file").setInputFiles({
    name: "fixture-validation.png",
    mimeType: "image/png",
    buffer: sceneFrameBuffer,
  });
  await page.waitForTimeout(1200);
  assert.equal(
    await page.locator("#scene-frame-state").evaluate((element) => element.value),
    "MATCH",
    await page.locator("#scene-registration-validation").textContent(),
  );
  assert.equal(await page.locator("#scene-add-reference").isEnabled(), true);
  for (const reference of sceneReferences) {
    await page.locator("#scene-reference-address").fill(reference.address);
    await page.locator("#scene-reference-x").fill(reference.pixel.x.toFixed(4));
    await page.locator("#scene-reference-y").fill(reference.pixel.y.toFixed(4));
    await page.locator("#scene-add-reference").click();
  }
  assert.equal(await page.locator("#scene-reference-count").evaluate((element) => element.value), "8 IN / 0 OUT");
  assert.equal(await page.locator("#scene-fit-state").evaluate((element) => element.value), "QUALIFIED XY");
  assert.equal(await page.locator("#scene-authority").evaluate((element) => element.value), "MACHINE XY READY");
  assert.equal(await page.locator("#viewer").getAttribute("data-scene-registration-references"), "8");
  assert.equal(await page.locator("#viewer").getAttribute("data-scene-registration-state"), "qualified");
  await page.locator("#scene-frame-file").setInputFiles({
    name: "different-frame.png",
    mimeType: "image/png",
    buffer: alternateSceneFrameBuffer,
  });
  await page.waitForFunction(() => document.getElementById("scene-frame-state")?.value === "MISMATCH");
  assert.equal(await page.locator("#scene-add-reference").isDisabled(), true);
  assert.equal(await page.locator("#viewer").getAttribute("data-scene-registration-references"), "0");
  assert.equal(await page.locator("#viewer").getAttribute("data-scene-registration-state"), "provisional");
  await page.locator("#scene-frame-file").setInputFiles({
    name: "fixture-validation.png",
    mimeType: "image/png",
    buffer: sceneFrameBuffer,
  });
  await page.waitForFunction(() => document.getElementById("scene-frame-state")?.value === "MATCH");
  assert.equal(await page.locator("#scene-authority").evaluate((element) => element.value), "MACHINE XY READY");
  const featurePixel = projectHomography(sceneSyntheticMatrix, { x: 0, y: 0 });
  await page.locator("#scene-feature-type").selectOption("bore");
  await page.locator("#scene-feature-x").fill(featurePixel.x.toFixed(4));
  await page.locator("#scene-feature-y").fill(featurePixel.y.toFixed(4));
  await page.locator("#scene-feature-size").fill("25");
  await page.locator("#scene-add-feature").click();
  assert.equal(await page.locator("#scene-plan-operations").evaluate((element) => element.value), "1");
  assert.equal(await page.locator("#scene-plan-contacts").evaluate((element) => element.value), "12");
  assert.equal(await page.locator("#scene-plan-probe").evaluate((element) => element.value), "QUALIFIED");
  assert.match(await page.locator("#scene-probe-plan").textContent(), /12-POINT INTERNAL CIRCLE/);
  await page.locator("#scene-registration-panel .scene-registration-scroll").evaluate((element) => { element.scrollTop = 0; });
  const sceneRegistrationDesktopLayout = await sceneRegistrationLayoutAudit("desktop scene registration");
  await page.screenshot({ path: path.join(screenshots, "scene-registration-desktop.png"), fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(350);
  await page.locator("#scene-registration-panel .scene-registration-scroll").evaluate((element) => { element.scrollTop = 0; });
  const sceneRegistrationMobileLayout = await sceneRegistrationLayoutAudit("mobile scene registration");
  await page.screenshot({ path: path.join(screenshots, "scene-registration-mobile.png"), fullPage: true });
  await page.locator("#close-scene-registration").click();
  assert.equal(await page.locator("#viewer").getAttribute("data-scene-registration-state"), "hidden");
  await page.setViewportSize({ width: 1440, height: 900 });

  await page.getByRole("button", { name: "PATH" }).click();
  await page.waitForTimeout(650);
  assert.equal(await page.locator("#view-label").textContent(), "TOOLPATH VIEW");
  const pathPixels = await canvasStats("path-desktop", 0.06);
  await page.screenshot({ path: path.join(screenshots, "path-desktop.png"), fullPage: true });

  const startingX = await page.locator("#dro-x").evaluate((element) => element.value);
  await page.getByRole("button", { name: "START PREVIEW", exact: true }).click();
  await page.waitForTimeout(1800);
  const runningX = await page.locator("#dro-x").evaluate((element) => element.value);
  assert.notEqual(runningX, startingX, "preview did not move the live X readout");
  assert.equal(await page.locator("#machine-state").textContent(), "RUN");
  assert.notEqual(await page.locator("#line-status").textContent(), "LINE 0 / 0");
  await page.getByRole("button", { name: "MACHINE", exact: true }).click();
  await page.waitForTimeout(300);
  assert.notEqual(
    await page.locator("#viewer").getAttribute("data-lead-screw-rotations"),
    stoppedScrewRotations,
    "lead screws did not rotate with preview motion",
  );
  assert.equal(await page.locator("#viewer").getAttribute("data-coolant-mode"), "flood");
  const machineMotionPixels = await canvasStats("machine-motion-coolant", 0.08);
  assert.ok(machineMotionPixels.cyanPixels > 2, "coolant flow did not render on the machine canvas");
  await page.screenshot({ path: path.join(screenshots, "machine-motion-coolant-desktop.png"), fullPage: true });

  await page.setInputFiles(
    "#gcode-file",
    path.join(root, "tests", "fixtures", "fusion-personal-rapids.nc"),
  );
  await waitForImportedJob("FUSION-PERSONAL-RAPIDS.NC");
  await page.waitForTimeout(300);
  assert.equal(await page.locator("#viewer").getAttribute("data-coolant-mode"), "off");
  assert.match(await page.locator("#job-status").textContent(), /5 MOVES · 3 RAPIDS VERIFIED/);
  assert.doesNotMatch(await page.locator("#job-status").getAttribute("title"), /rejected/i);

  await page.setInputFiles(
    "#gcode-file",
    path.join(root, "tests", "fixtures", "arc-pocket.nc"),
  );
  await waitForImportedJob("ARC-POCKET.NC");
  await page.waitForTimeout(650);
  assert.equal(await page.locator("#view-label").textContent(), "TOOLPATH VIEW");
  assert.match(await page.locator("#job-status").textContent(), /40 MOVES · 4 ARCS/);
  assert.match(await page.locator("#line-status").textContent(), /\/ 22$/);
  assert.equal(await page.locator("#tool-number").evaluate((element) => element.value), "T3");
  const importedPixels = await canvasStats("imported-path-desktop", 0.06);
  await page.screenshot({ path: path.join(screenshots, "imported-path-desktop.png"), fullPage: true });

  const importedStartingX = await page.locator("#dro-x").evaluate((element) => element.value);
  await page.getByRole("button", { name: "START PREVIEW", exact: true }).click();
  await page.waitForTimeout(900);
  const importedRunningX = await page.locator("#dro-x").evaluate((element) => element.value);
  assert.notEqual(importedRunningX, importedStartingX, "imported preview did not move the X readout");
  assert.equal(await page.locator("#spindle-rpm").evaluate((element) => element.value), "7200");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(650);
  const mobileLayout = await layoutAudit("mobile path view");
  const mobilePixels = await canvasStats("path-mobile", 0.06);
  await page.screenshot({ path: path.join(screenshots, "path-mobile.png"), fullPage: true });

  await page.setViewportSize({ width: 1440, height: 900 });

  await page.locator("#open-jog").click();
  await page.waitForFunction(() => document.getElementById("jog-panel")?.getAttribute("aria-hidden") === "false");
  await page.waitForTimeout(250);
  assert.equal(await page.locator("#jog-command-mode").evaluate((element) => element.value), "PREVIEW ONLY");
  assert.equal(await page.locator("#jog-command-status").evaluate((element) => element.value), "PREVIEW JOG READY / NO SERIAL OUTPUT");
  const heldToolPosition = await page.locator("#viewer").getAttribute("data-tool-coordinate-position");
  const heldWorldPosition = await page.locator("#viewer").getAttribute("data-tool-world-position");
  const heldDro = await page.evaluate(() => ["x", "y", "z"].map((axis) => (
    document.getElementById(`dro-${axis}`)?.value
  )));
  assert.deepEqual(
    heldToolPosition.split(",").map((value) => Number(value).toFixed(3)),
    heldDro,
    "opening Jog left the preview DRO and model at different positions",
  );
  await page.getByRole("button", { name: "Close jog controls", exact: true }).last().click();
  await page.locator("#open-jog").click();
  await page.waitForFunction(() => document.getElementById("jog-panel")?.getAttribute("aria-hidden") === "false");
  assert.equal(
    await page.locator("#viewer").getAttribute("data-tool-coordinate-position"),
    heldToolPosition,
    "opening Jog moved the held model position",
  );
  assert.equal(
    await page.locator("#viewer").getAttribute("data-tool-world-position"),
    heldWorldPosition,
    "opening Jog moved the held model fixture position",
  );
  const previewJogX = Number(await page.locator("#jog-dro-x").evaluate((element) => element.value));
  const previewJogWorldStart = heldWorldPosition.split(",").map(Number);
  await page.getByRole("button", { name: "Jog X positive" }).click();
  const previewJoggedX = Number(await page.locator("#jog-dro-x").evaluate((element) => element.value));
  const previewJogWorldEnd = (await page.locator("#viewer").getAttribute("data-tool-world-position"))
    .split(",")
    .map(Number);
  assert.equal((previewJoggedX - previewJogX).toFixed(3), "1.000");
  assert.equal((previewJogWorldEnd[0] - previewJogWorldStart[0]).toFixed(3), "1.000");
  assert.equal((previewJogWorldEnd[1] - previewJogWorldStart[1]).toFixed(3), "0.000");
  assert.equal((previewJogWorldEnd[2] - previewJogWorldStart[2]).toFixed(3), "0.000");
  assert.equal(await page.locator("#viewer").getAttribute("data-tool-position-source"), "jog");
  assert.equal(await page.locator("#machine-state").textContent(), "PREVIEW JOG");
  const jogPreviewDesktopLayout = await jogLayoutAudit("desktop preview jog");
  await page.screenshot({ path: path.join(screenshots, "jog-preview-desktop.png"), fullPage: true });
  await page.getByRole("button", { name: "Close jog controls", exact: true }).last().click();

  await page.getByRole("button", { name: "Machine backup and transfer", exact: true }).click();
  await page.waitForFunction(() => document.getElementById("machine-data-panel")?.getAttribute("aria-hidden") === "false");
  assert.match(
    await page.locator("#machine-data-id").evaluate((element) => element.value),
    /^MR1-[0-9A-F-]{36}$/,
  );
  assert.equal(await page.locator("#machine-data-profile-count").evaluate((element) => element.value), "9");
  assert.equal(await page.locator("#machine-data-transfer").evaluate((element) => element.value), "READY");
  const machineDataDesktopLayout = await machineDataLayoutAudit("desktop machine backup");
  await page.screenshot({ path: path.join(screenshots, "machine-backup-desktop.png"), fullPage: true });

  const machineBundleDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "EXPORT MACHINE BUNDLE", exact: true }).click();
  const downloadedMachineBundle = await machineBundleDownload;
  assert.match(downloadedMachineBundle.suggestedFilename(), /\.mr1-machine\.json$/);
  assert.notEqual(await page.locator("#machine-data-digest").evaluate((element) => element.value), "--");
  await page.setInputFiles("#machine-bundle-file", await downloadedMachineBundle.path());
  await page.waitForFunction(() => document.getElementById("machine-bundle-validation")?.value.startsWith("VERIFIED"));
  assert.match(await page.locator("#machine-bundle-validation").evaluate((element) => element.value), /VERIFIED \/ 0 CHANGES/);
  assert.equal(await page.locator("#machine-bundle-change-count").evaluate((element) => element.value), "0");
  assert.equal(await page.locator("#apply-machine-bundle").isDisabled(), true);
  await page.locator("#machine-bundle-confirm").check();
  assert.equal(await page.locator("#apply-machine-bundle").isEnabled(), true);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(250);
  const machineDataMobileLayout = await machineDataLayoutAudit("mobile machine backup");
  await page.screenshot({ path: path.join(screenshots, "machine-backup-mobile.png"), fullPage: true });
  await page.getByRole("button", { name: "Close machine backup and transfer", exact: true }).last().click();
  await page.setViewportSize({ width: 1440, height: 900 });

  await page.getByRole("button", { name: "Controller firmware and settings", exact: true }).click();
  await page.waitForFunction(() => document.getElementById("controller-settings-count")?.value === "66 OF 66");
  assert.equal(await page.locator(".controller-setting-row").count(), 66);
  assert.equal(await page.locator("#controller-settings-source").evaluate((element) => element.value), "SIMULATION");
  assert.equal(await page.locator("#controller-settings-profile").evaluate((element) => element.value), "BTT_OCTOPUS_PRO_F429_MR1");
  const controllerSettingsDesktopLayout = await controllerSettingsLayoutAudit("desktop controller settings", "SETTINGS");
  await page.screenshot({ path: path.join(screenshots, "controller-settings-desktop.png"), fullPage: true });

  await page.locator("#controller-settings-search").fill("$110");
  assert.equal(await page.locator(".controller-setting-row").count(), 1);
  await page.locator('[data-controller-setting-input="110"]').fill("2400");
  await page.locator('[data-controller-setting-input="110"]').dispatchEvent("change");
  await page.waitForFunction(() => document.getElementById("controller-settings-staged")?.value === "1");
  assert.match(await page.locator("#controller-settings-diff").innerText(), /2540[\s\S]*2400/);
  const settingsPlanDownload = page.waitForEvent("download");
  await page.locator("#export-controller-plan").click();
  assert.match((await settingsPlanDownload).suggestedFilename(), /^mr1-controller-settings-plan-.*\.json$/);
  await page.locator("#controller-settings-confirm").check();
  assert.equal(await page.locator("#apply-controller-settings").isEnabled(), true);
  await page.locator("#apply-controller-settings").click();
  await page.waitForFunction(() => document.getElementById("controller-settings-count")?.value === "65 OF 66");
  assert.equal(await page.locator(".controller-setting-live output").textContent(), "2400");
  await page.locator(".controller-setting-reset").click();
  await page.locator("#controller-settings-confirm").check();
  await page.locator("#apply-controller-settings").click();
  await page.waitForFunction(() => document.getElementById("controller-settings-count")?.value === "66 OF 66");
  assert.equal(await page.locator(".controller-setting-live output").textContent(), "2540");

  await page.getByRole("tab", { name: "FIRMWARE", exact: true }).click();
  assert.equal(await page.locator("#controller-firmware-mcu").evaluate((element) => element.value), "STM32F429ZGT6");
  assert.equal(await page.locator("#controller-firmware-simulation").evaluate((element) => element.value), "READY");
  assert.ok(await page.locator(".controller-firmware-reference img").evaluate((element) => element.naturalWidth >= 600));
  const controllerFirmwareDesktopLayout = await controllerSettingsLayoutAudit("desktop controller firmware", "FIRMWARE");
  await page.screenshot({ path: path.join(screenshots, "controller-firmware-desktop.png"), fullPage: true });
  await page.locator("#open-verified-flash-workflow").click();
  assert.equal(await page.locator("#wiring-panel").getAttribute("aria-hidden"), "false");
  assert.equal(await page.locator("#flash-tab").getAttribute("aria-selected"), "true");
  await page.getByRole("button", { name: "Close wiring guide", exact: true }).last().click();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Controller firmware and settings", exact: true }).click();
  await page.getByRole("tab", { name: "SETTINGS", exact: true }).click();
  await page.locator("#controller-settings-search").fill("");
  assert.equal(await page.locator(".controller-setting-row").count(), 66);
  const controllerSettingsMobileLayout = await controllerSettingsLayoutAudit("mobile controller settings", "SETTINGS");
  await page.screenshot({ path: path.join(screenshots, "controller-settings-mobile.png"), fullPage: true });
  await page.getByRole("tab", { name: "FIRMWARE", exact: true }).click();
  const controllerFirmwareMobileLayout = await controllerSettingsLayoutAudit("mobile controller firmware", "FIRMWARE");
  await page.screenshot({ path: path.join(screenshots, "controller-firmware-mobile.png"), fullPage: true });
  await page.getByRole("button", { name: "Close controller firmware and settings", exact: true }).last().click();
  await page.setViewportSize({ width: 1440, height: 900 });

  const wiringTabs = ["START", "FLASH", "DRIVES", "HARNESS", "PROBES", "INPUTS", "POWER", "OUTPUTS", "TEMP"];
  const wiringDesktopLayouts = {};
  const wiringMobileLayouts = {};
  await page.getByRole("button", { name: "Wiring guide" }).click();
  await page.waitForFunction(() => document.getElementById("wiring-panel")?.getAttribute("aria-hidden") === "false");
  await page.getByRole("tab", { name: "START", exact: true }).click();
  await page.locator("#octopus-board-map").waitFor({ state: "visible" });
  await page.waitForFunction(() => document.getElementById("octopus-board-map")?.dataset.loadState === "ready");
  assert.ok(await page.locator("#octopus-board-map").evaluate((element) => element.naturalWidth >= 1800));
  assert.equal(await page.locator("[data-board-wiring]").count(), 8);
  assert.equal(await page.getByText("31 OF 31 / LOCKED", { exact: true }).textContent(), "31 OF 31 / LOCKED");
  assert.equal(await page.getByText("V1.1 / F429 / UNPROVED", { exact: true }).textContent(), "V1.1 / F429 / UNPROVED");
  await page.getByRole("tab", { name: "FLASH", exact: true }).click();
  await page.locator("#flash-panel .usb-flash-reference img").waitFor({ state: "visible" });
  assert.ok(await page.locator("#flash-panel .usb-flash-reference img").evaluate((element) => element.naturalWidth >= 600));
  assert.equal(
    await page.getByRole("link", { name: "Download verified Octopus production firmware" }).getAttribute("href"),
    "/firmware/octopus-pro-v1.1-f429-mr1/firmware.bin",
  );
  assert.equal(await page.locator("#flash-panel .usb-flash-sequence li").count(), 8);
  await page.locator("#octopus-firmware-file").setInputFiles(productionFirmwarePath);
  await page.waitForFunction(() => document.getElementById("octopus-firmware-verdict")?.value === "SOURCE VERIFIED");
  assert.equal(await page.locator("#octopus-firmware-content").evaluate((element) => element.value), "EXACT MATCH");
  assert.equal(await page.locator("#octopus-firmware-role").evaluate((element) => element.value), "SOURCE / firmware.bin");
  assert.equal(await page.locator("#download-octopus-flash-record").isDisabled(), true);
  const productionFirmware = await readFile(productionFirmwarePath);
  await page.locator("#octopus-firmware-file").setInputFiles({
    name: "FIRMWARE.CUR",
    mimeType: "application/octet-stream",
    buffer: productionFirmware,
  });
  await page.waitForFunction(() => document.getElementById("octopus-firmware-verdict")?.value === "CARD RESULT VERIFIED");
  assert.equal(await page.locator("#octopus-flash-gate-card").evaluate((element) => element.value), "FIRMWARE.CUR");
  for (const checkbox of await page.locator("[data-firmware-attestation]").all()) await checkbox.check();
  assert.equal(await page.locator("#octopus-flash-gate-operator").evaluate((element) => element.value), "4 OF 4");
  assert.equal(await page.locator("#octopus-flash-gate-preflight").evaluate((element) => element.value), "OFFLINE");
  assert.equal(await page.locator("#download-octopus-flash-record").isDisabled(), true);
  await page.locator(".usb-firmware-verifier-section").scrollIntoViewIfNeeded();
  await wiringLayoutAudit("desktop firmware verifier", "FLASH");
  await page.screenshot({ path: path.join(screenshots, "firmware-verifier-desktop.png"), fullPage: true });
  await page.getByRole("tab", { name: "START", exact: true }).click();
  await page.getByRole("button", { name: "Open drive wiring for MOTOR0 through MOTOR3" }).click();
  assert.equal(await page.getByRole("tab", { name: "DRIVES", exact: true }).getAttribute("aria-selected"), "true");
  await page.getByRole("tab", { name: "HARNESS", exact: true }).click();
  assert.equal(await page.locator(".driver-socket-wire-table > div:not(.wire-table-head)").count(), 9);
  assert.deepEqual(
    await page.locator(".driver-socket-wire-table code").allTextContents()
      .then((pins) => pins.map(Number).sort((left, right) => left - right)),
    Array.from({ length: 18 }, (_, index) => index + 1),
  );
  assert.equal(await page.locator("#wiring-pigtail-list .wiring-pigtail-item").count(), 17);
  await page.getByRole("tab", { name: "START", exact: true }).click();
  const compactWiringWidth = await page.locator("#wiring-panel").evaluate((element) => element.getBoundingClientRect().width);
  await page.getByRole("button", { name: "Expand board map" }).click();
  await page.waitForTimeout(220);
  const expandedWiringWidth = await page.locator("#wiring-panel").evaluate((element) => element.getBoundingClientRect().width);
  assert.ok(expandedWiringWidth > compactWiringWidth + 300);
  await page.getByRole("button", { name: "Return board map to normal size" }).click();
  await page.waitForTimeout(220);
  for (const tab of wiringTabs) {
    await page.getByRole("tab", { name: tab, exact: true }).click();
    await page.locator("#wiring-panel .probing-panel-scroll").evaluate((element) => { element.scrollTop = 0; });
    await page.waitForTimeout(100);
    wiringDesktopLayouts[tab] = await wiringLayoutAudit(`desktop ${tab.toLowerCase()} wiring`, tab);
    await page.screenshot({ path: path.join(screenshots, `wiring-${tab.toLowerCase()}-desktop.png`), fullPage: true });
  }
  await page.getByRole("tab", { name: "PROBES", exact: true }).click();
  await page.getByRole("button", { name: "Edit sensor wiring profile", exact: true }).click();
  assert.equal(await page.locator("#wiring-profile-form").isVisible(), true);
  assert.equal(await page.locator("#wiring-interface-type").inputValue(), "hw399");
  assert.equal(await page.locator("#wiring-touch-destination").inputValue(), "pf5");
  assert.equal(await page.locator("#wiring-setter-destination").inputValue(), "pb7");
  const wiringEditorDesktopLayout = await wiringLayoutAudit("desktop editable probe wiring", "PROBES");
  await page.screenshot({ path: path.join(screenshots, "wiring-probes-editor-desktop.png"), fullPage: true });
  await page.locator("#cancel-wiring-profile").click();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(350);
  for (const tab of wiringTabs) {
    await page.getByRole("tab", { name: tab, exact: true }).click();
    await page.locator("#wiring-panel .probing-panel-scroll").evaluate((element) => { element.scrollTop = 0; });
    await page.waitForTimeout(100);
    wiringMobileLayouts[tab] = await wiringLayoutAudit(`mobile ${tab.toLowerCase()} wiring`, tab);
    await page.screenshot({ path: path.join(screenshots, `wiring-${tab.toLowerCase()}-mobile.png`), fullPage: true });
  }
  await page.getByRole("tab", { name: "FLASH", exact: true }).click();
  await page.locator(".usb-firmware-verifier-section").scrollIntoViewIfNeeded();
  await wiringLayoutAudit("mobile firmware verifier", "FLASH");
  await page.screenshot({ path: path.join(screenshots, "firmware-verifier-mobile.png"), fullPage: true });
  await page.getByRole("tab", { name: "PROBES", exact: true }).click();
  await page.getByRole("button", { name: "Edit sensor wiring profile", exact: true }).click();
  await page.locator("#wiring-panel .probing-panel-scroll").evaluate((element) => { element.scrollTop = 0; });
  const wiringEditorMobileLayout = await wiringLayoutAudit("mobile editable probe wiring", "PROBES");
  await page.screenshot({ path: path.join(screenshots, "wiring-probes-editor-mobile.png"), fullPage: true });
  await page.locator("#cancel-wiring-profile").click();
  await page.getByRole("button", { name: "Close wiring guide", exact: true }).last().click();
  await page.setViewportSize({ width: 1440, height: 900 });

  await page.getByRole("button", { name: "Connect telemetry" }).click();
  await page.waitForFunction(() => (
    document.getElementById("telemetry-connect")?.dataset.link === "live"
    && document.getElementById("progress-percent")?.value === "LIVE"
  ));
  await page.waitForTimeout(350);

  assert.equal(await page.locator("#telemetry-source").textContent(), "BRIDGE SIM");
  assert.equal(await page.locator("#machine-state").textContent(), "IDLE");
  assert.equal(await page.locator("#tool-number").evaluate((element) => element.value), "T3");
  assert.equal(await page.locator("#tool-description").textContent(), "LIVE");
  assert.equal(await page.locator("#permit-label").textContent(), "VIRTUAL MR-1 / TYPED COMMANDS");
  assert.equal(await page.locator("#restart-preview").isDisabled(), true);
  assert.equal(await page.locator("#cycle-start").isDisabled(), true);
  assert.equal(Number(await page.locator("#spindle-rpm").evaluate((element) => element.value)), 0);
  assert.equal(await page.locator("#active-probe-state").evaluate((element) => element.value), "PRIMARY");
  assert.equal(await page.locator("#touch-input-state").evaluate((element) => element.value), "OPEN");
  assert.equal(await page.locator("#setter-input-state").evaluate((element) => element.value), "NOT SELECTED");

  await page.getByRole("button", { name: "Machine backup and transfer", exact: true }).click();
  await page.waitForFunction(() => document.getElementById("machine-data-transfer")?.value === "DISCONNECT LIVE");
  assert.equal(await page.locator("#machine-data-controller").evaluate((element) => element.value), "SIM / NOT BOUND");
  assert.equal(await page.locator("#apply-machine-bundle").isDisabled(), true);
  assert.equal(await page.locator("#machine-data-controller").getAttribute("data-state"), "");
  await page.waitForFunction(() => document.getElementById("machine-journal-state")?.value === "ACTIVE / SIM");
  assert.ok(Number(await page.locator("#machine-journal-entries").evaluate((element) => element.value)) > 0);
  assert.equal(await page.locator("#download-event-journal").isEnabled(), true);
  assert.equal(await page.locator("#machine-reconciliation-state").evaluate((element) => element.value), "NEW");
  assert.equal(await page.locator("#machine-reconciliation-history").evaluate((element) => element.value), "NOTHING TO VERIFY / EMPTY");
  assert.equal(await page.locator("#machine-reconciliation-unfinished").evaluate((element) => element.value), "0");
  assert.equal(await page.locator("#machine-reconciliation-interlock").evaluate((element) => element.value), "CLEAR");
  assert.equal(await page.locator("#acknowledge-machine-reconciliation").isDisabled(), true);
  const downloadsBeforeJournal = observedDownloads.length;
  await page.locator("#download-event-journal").click();
  await page.waitForFunction(() => document.getElementById("machine-bundle-validation")?.value.includes("DOWNLOADED"));
  const journalDownloadDeadline = Date.now() + 5000;
  while (observedDownloads.length === downloadsBeforeJournal && Date.now() < journalDownloadDeadline) {
    await page.waitForTimeout(50);
  }
  assert.ok(
    observedDownloads.length > downloadsBeforeJournal,
    `journal download did not start: ${JSON.stringify(journalNetwork)}`,
  );
  assert.match(observedDownloads.at(-1), /^mr1-events-.*\.jsonl$/);
  const machineDataLiveLayout = await machineDataLayoutAudit("live machine backup lockout");
  await page.screenshot({ path: path.join(screenshots, "machine-backup-live-lockout.png"), fullPage: true });
  await page.getByRole("button", { name: "Close machine backup and transfer", exact: true }).last().click();

  const liveDesktopLayout = await layoutAudit("desktop live telemetry");
  await page.screenshot({ path: path.join(screenshots, "live-telemetry-desktop.png"), fullPage: true });

  await page.getByRole("button", { name: "Wiring guide" }).click();
  await page.waitForFunction(() => document.getElementById("wiring-panel")?.getAttribute("aria-hidden") === "false");
  await page.getByRole("tab", { name: "START", exact: true }).click();
  assert.equal(await page.locator("#controller-preflight-state").textContent(), "SIM CONTRACT PASS");
  assert.equal(await page.locator("#controller-preflight-board").textContent(), "SIM MATCH");
  assert.equal(await page.locator("#controller-preflight-inputs").textContent(), "CLEAR");
  assert.match(await page.locator("#controller-preflight-settings").textContent(), /^(\d+) \/ \1$/);
  assert.equal(await page.locator("#download-controller-preflight").isEnabled(), true);
  const controllerPreflightDesktopLayout = await wiringLayoutAudit("desktop controller preflight", "START");
  await page.screenshot({ path: path.join(screenshots, "controller-preflight-desktop.png"), fullPage: true });
  await page.getByRole("tab", { name: "FLASH", exact: true }).click();
  assert.equal(await page.locator("#octopus-flash-gate-preflight").evaluate((element) => element.value), "SIM / REJECTED");
  assert.equal(await page.locator("#octopus-flash-record-count").evaluate((element) => element.value), "3 OF 4");
  assert.equal(await page.locator("#download-octopus-flash-record").isDisabled(), true);
  await wiringLayoutAudit("desktop simulated flash preflight rejection", "FLASH");
  await page.screenshot({ path: path.join(screenshots, "firmware-flash-sim-rejected.png"), fullPage: true });
  await page.getByRole("button", { name: "Close wiring guide", exact: true }).last().click();

  await page.getByRole("button", { name: "Jog controls" }).click();
  await page.waitForFunction(() => document.getElementById("jog-panel")?.getAttribute("aria-hidden") === "false");
  await page.waitForTimeout(250);
  assert.equal(await page.locator("#jog-command-mode").evaluate((element) => element.value), "VIRTUAL CONTROL");
  assert.equal(await page.getByRole("button", { name: "Jog X positive" }).isEnabled(), true);
  assert.ok(Number(await page.locator("#jog-limit-x-negative").evaluate((element) => element.value)) > 0);
  const virtualJogStartX = Number(await page.locator("#jog-dro-x").evaluate((element) => element.value));
  assert.equal(
    Number((await page.locator("#viewer").getAttribute("data-tool-coordinate-position")).split(",")[0]).toFixed(3),
    virtualJogStartX.toFixed(3),
    "live Jog opened before the model reached the rendered telemetry position",
  );
  await page.getByRole("button", { name: "Jog X positive" }).click();
  await page.waitForFunction(() => document.getElementById("jog-command-status")?.value.includes("IDLE OBSERVED"));
  const virtualJogEndX = Number(await page.locator("#jog-dro-x").evaluate((element) => element.value));
  assert.ok(Math.abs(virtualJogEndX - virtualJogStartX - 1) < 0.001);
  assert.equal(
    Number((await page.locator("#viewer").getAttribute("data-tool-coordinate-position")).split(",")[0]).toFixed(3),
    virtualJogEndX.toFixed(3),
    "live Jog telemetry and the model diverged after motion",
  );
  assert.equal(await page.locator("#machine-state").textContent(), "IDLE");
  const jogLockedDesktopLayout = await jogLayoutAudit("desktop locked jog");
  await page.screenshot({ path: path.join(screenshots, "jog-virtual-desktop.png"), fullPage: true });
  await page.getByRole("button", { name: "Close jog controls", exact: true }).last().click();

  await page.getByRole("button", { name: "Fixture map and work offsets" }).click();
  await page.waitForFunction(() => document.getElementById("fixture-map-panel")?.getAttribute("aria-hidden") === "false");
  await page.locator("#apply-work-offset").scrollIntoViewIfNeeded();
  assert.equal(await page.locator("#fixture-command-state").evaluate((element) => element.value), "VIRTUAL READY");
  assert.equal(await page.locator("#apply-work-offset").isEnabled(), true);
  const candidateWco = await Promise.all(["x", "y", "z"].map((axis) => (
    page.locator(`#fixture-offset-${axis}`).evaluate((element) => Number(element.value))
  )));
  await page.locator("#apply-work-offset").click();
  await page.waitForFunction(() => document.getElementById("fixture-command-state")?.value.includes("OBSERVED"));
  const observedWco = (await page.locator("#fixture-live-wco").evaluate((element) => element.value))
    .split("/")
    .map((value) => Number(value.trim()));
  assert.ok(observedWco.every((value, index) => Math.abs(value - candidateWco[index]) < 0.001));
  assert.match(await page.locator("#fixture-map-validation").textContent(), /APPLIED \/ CONTROLLER WCO OBSERVED/);
  await page.screenshot({ path: path.join(screenshots, "fixture-wcs-transaction-desktop.png"), fullPage: true });
  await page.getByRole("button", { name: "Close fixture map", exact: true }).last().click();

  await page.getByRole("button", { name: "Spindle diagnostics" }).click();
  await page.waitForFunction(() => document.getElementById("spindle-panel")?.getAttribute("aria-hidden") === "false");
  await page.waitForTimeout(250);
  assert.equal(await page.locator("#spindle-source").evaluate((element) => element.value), "SIMULATED");
  assert.equal(await page.locator("#spindle-profile").evaluate((element) => element.value), "SIM / UNAPPROVED");
  assert.equal(await page.locator("#spindle-target-path").evaluate((element) => element.value), "DIGITAL / RS-485");
  assert.equal(await page.locator("#spindle-production-path").evaluate((element) => element.value), "ANALOG / FWD");
  assert.equal(await page.locator("#spindle-active-path").evaluate((element) => element.value), "SIM DIGITAL / RS-485");
  assert.equal(await page.locator("#spindle-command-rpm").evaluate((element) => element.value), "0");
  assert.equal(await page.locator("#spindle-motor-target-rpm").evaluate((element) => element.value), "0");
  assert.equal(Number(await page.locator("#spindle-motor-rpm").evaluate((element) => element.value)), 0);
  assert.equal(Number(await page.locator("#spindle-encoder-rpm").evaluate((element) => element.value)), 0);
  assert.equal(await page.locator("#spindle-alarm-code").evaluate((element) => element.value), "CLEAR");
  assert.equal(await page.locator("#spindle-freeze-frame").evaluate((element) => element.value), "NO CAPTURE");
  assert.equal(await page.locator("#spindle-modbus-write-permit").evaluate((element) => element.value), "LOCKED");
  assert.equal(await page.locator("#spindle-m4-permit").evaluate((element) => element.value), "LOCKED");
  const spindleDesktopLayout = await spindleLayoutAudit("desktop spindle diagnostics");
  await page.screenshot({ path: path.join(screenshots, "spindle-diagnostics-desktop.png"), fullPage: true });
  await page.getByRole("button", { name: "Close spindle diagnostics", exact: true }).last().click();

  await page.getByRole("button", { name: "ESP32 sensor diagnostics" }).click();
  await page.waitForFunction(() => (
    document.getElementById("spindle-panel")?.getAttribute("aria-hidden") === "false"
    && document.getElementById("sensor-health-state")?.value === "SIM / HEALTHY"
  ));
  await page.waitForTimeout(350);
  assert.equal(await page.locator("#spindle-panel-title").textContent(), "ESP32 SENSOR");
  assert.equal(await page.locator("#sensor-firmware").evaluate((element) => element.value), "7.6-mr1-sim / S2");
  assert.equal(await page.locator("#sensor-calibration").evaluate((element) => element.value), "SAVED G3");
  assert.equal(await page.locator("#sensor-imu-health").evaluate((element) => element.value), "HEALTHY");
  assert.equal(await page.locator("#sensor-audio-health").evaluate((element) => element.value), "HEALTHY");
  assert.equal(await page.locator("#sensor-external-temp-health").evaluate((element) => element.value), "HEALTHY");
  assert.ok(parseFloat(await page.locator("#sensor-processing-time").evaluate((element) => element.value)) > 0);
  assert.equal(await page.locator("#sensor-vibration-order").evaluate((element) => element.value), "--");
  assert.equal(await page.locator("#sensor-advisory-state").evaluate((element) => element.value), "SIMULATION / NO MACHINE COMMANDS");
  assert.equal(await page.locator("#start-sensor-calibration").isDisabled(), true);
  assert.equal(await page.locator("#clear-sensor-calibration").isDisabled(), true);
  assert.equal(await page.locator("#export-sensor-session").isEnabled(), true);
  const sensorDesktopLayout = await spindleLayoutAudit("desktop ESP32 diagnostics");
  const sensorDesktopCanvas = await sensorCanvasAudit("esp32-desktop");
  await page.screenshot({ path: path.join(screenshots, "esp32-diagnostics-desktop.png"), fullPage: true });
  await page.getByRole("button", { name: "Close esp32 sensor diagnostics", exact: true }).last().click();

  await page.getByRole("button", { name: "WPOS" }).click();
  assert.equal(await page.locator("#coordinate-mode").textContent(), "MPOS");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(450);
  const liveMobileLayout = await layoutAudit("mobile live telemetry");
  await page.screenshot({ path: path.join(screenshots, "live-telemetry-mobile.png"), fullPage: true });

  await page.getByRole("button", { name: "Jog controls" }).click();
  await page.waitForFunction(() => document.getElementById("jog-panel")?.getAttribute("aria-hidden") === "false");
  await page.waitForTimeout(250);
  const jogLockedMobileLayout = await jogLayoutAudit("mobile locked jog");
  assert.equal(await page.locator("#jog-command-mode").evaluate((element) => element.value), "VIRTUAL CONTROL");
  await page.screenshot({ path: path.join(screenshots, "jog-virtual-mobile.png"), fullPage: true });
  await page.getByRole("button", { name: "Close jog controls", exact: true }).last().click();

  await page.getByRole("button", { name: "Spindle diagnostics" }).click();
  await page.waitForFunction(() => document.getElementById("spindle-panel")?.getAttribute("aria-hidden") === "false");
  await page.waitForTimeout(250);
  const spindleMobileLayout = await spindleLayoutAudit("mobile spindle diagnostics");
  await page.screenshot({ path: path.join(screenshots, "spindle-diagnostics-mobile.png"), fullPage: true });
  await page.getByRole("button", { name: "Close spindle diagnostics", exact: true }).last().click();

  await page.getByRole("button", { name: "ESP32 sensor diagnostics" }).click();
  await page.waitForFunction(() => document.getElementById("spindle-panel-title")?.textContent === "ESP32 SENSOR");
  await page.waitForTimeout(250);
  assert.equal(await page.locator("#sensor-health-state").evaluate((element) => element.value), "SIM / HEALTHY");
  const sensorMobileLayout = await spindleLayoutAudit("mobile ESP32 diagnostics");
  const sensorMobileCanvas = await sensorCanvasAudit("esp32-mobile");
  await page.screenshot({ path: path.join(screenshots, "esp32-diagnostics-mobile.png"), fullPage: true });
  await page.getByRole("button", { name: "Close esp32 sensor diagnostics", exact: true }).last().click();

  await page.getByRole("button", { name: "Disconnect telemetry" }).click();
  await page.waitForFunction(() => document.getElementById("telemetry-source")?.textContent === "SIMULATION");
  assert.equal(await page.locator("#tool-description").textContent(), "PROGRAM");
  assert.equal(await page.locator("#cycle-start").isEnabled(), true);

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole("button", { name: "Probing settings" }).click();
  await page.waitForFunction(() => document.getElementById("probing-panel")?.getAttribute("aria-hidden") === "false");
  assert.equal(await page.locator("#setter-clearance").inputValue(), "2");
  assert.equal(await page.locator("#setter-search").inputValue(), "3");
  assert.equal(await page.locator("#setter-retract").inputValue(), "5");
  assert.equal(await page.locator("#setter-guard-feed").inputValue(), "100");
  assert.equal(await page.locator("#setter-latch-pulloff").inputValue(), "1");
  assert.equal(await page.locator("#setter-retract-feed").inputValue(), "50");
  assert.equal(await page.locator("#run-tool-setter").isDisabled(), true);

  await page.getByRole("spinbutton", { name: "X mm" }).fill("-110");
  await page.getByRole("spinbutton", { name: "Y mm" }).fill("-80");
  await page.locator("#setter-travel-z").fill("-20");
  await page.locator("#setter-reference-contact-z").fill("-100");
  await page.locator("#setter-reference-gauge-length").fill("40");
  await page.locator("#setter-tool-number").fill("7");
  await page.locator("#setter-current-gauge-length").fill("101.6");
  assert.equal(await page.locator("#setter-expected-contact-z").evaluate((element) => element.value), "-38.400 mm");
  assert.equal(await page.locator("#setter-start-z").evaluate((element) => element.value), "-36.400 mm");
  assert.equal(await page.locator("#setter-limit-z").evaluate((element) => element.value), "-39.400 mm");
  assert.equal(await page.locator("#setter-past-expected").evaluate((element) => element.value), "1.0 mm");
  assert.equal(await page.locator("#setter-validation").textContent(), "PROFILE READY");

  await page.locator("#setter-search").fill("12.7");
  assert.match(await page.locator("#setter-validation").textContent(), /BETWEEN 1 AND 5/);
  assert.equal(await page.locator("#save-setter-profile").isDisabled(), true);
  await page.locator("#setter-search").fill("3");
  assert.equal(await page.locator("#save-setter-profile").isEnabled(), true);
  await page.getByRole("button", { name: "SAVE PROFILE" }).click();
  assert.match(await page.locator("#setter-validation").textContent(), /PROFILE SAVED/);

  await page.getByRole("button", { name: "Connect telemetry" }).click();
  await page.waitForFunction(() => document.getElementById("telemetry-source")?.textContent === "BRIDGE SIM");
  await page.waitForFunction(() => document.getElementById("setter-validation")?.textContent.includes("LIVE T3"));
  assert.equal(await page.locator("#setter-calibration-state").evaluate((element) => element.value), "TOOL MISMATCH");
  assert.equal(await page.locator("#setter-tool-number").getAttribute("data-invalid"), "true");
  await page.locator("#setter-tool-number").fill("3");
  await page.waitForFunction(() => document.getElementById("setter-command-state")?.value === "VIRTUAL READY");
  assert.equal(await page.locator("#run-tool-setter").isEnabled(), true);
  await page.locator("#run-tool-setter").click();
  await page.waitForFunction(() => document.getElementById("setter-command-state")?.value === "CONTACT + SAFE Z PROVEN");
  assert.equal(await page.locator("#machine-state").textContent(), "IDLE");
  await page.screenshot({ path: path.join(screenshots, "tool-setter-transaction-desktop.png"), fullPage: true });

  await page.locator("#close-probing").click();
  await page.getByRole("button", { name: "Metrology and reverse engineering" }).click();
  await page.locator("#metrology-capture-armed").check();
  assert.equal(await page.locator("#metrology-capture-state").evaluate((element) => element.value), "ARMED");
  await page.locator("#close-metrology").click();
  await page.getByRole("button", { name: "Probing settings" }).click();
  await page.getByRole("tab", { name: "TOUCH PROBE" }).click();
  await page.locator("#touch-cycle").selectOption("bore-center");
  await page.locator("#touch-tip-diameter").fill("4");
  await page.locator("#touch-target-x").fill("-110");
  await page.locator("#touch-target-y").fill("-80");
  await page.locator("#touch-safe-z").fill("-20");
  await page.locator("#touch-measurement-z").fill("-40");
  await page.locator("#touch-feature-diameter").fill("14");
  await page.locator("#touch-search").fill("6");
  assert.equal(await page.locator("#touch-target-z").isVisible(), false);
  assert.equal(await page.locator("#touch-measurement-z").isVisible(), true);
  assert.equal(await page.locator("#touch-plan-contacts").evaluate((element) => element.value), "4 CONTACTS / 8 TOUCHES");
  assert.equal(await page.locator("#touch-plan-start").evaluate((element) => element.value), "-110.000 / -80.000 / -40.000");
  assert.equal(await page.locator("#touch-plan-limit").evaluate((element) => element.value), "-104.000 / -80.000 / -40.000");
  assert.equal(await page.locator("#touch-plan-overtravel").evaluate((element) => element.value), "1.000 mm");
  assert.match(await page.locator("#touch-validation").textContent(), /PLAN READY \/ 4 CONTACTS/);
  await page.waitForFunction(() => document.getElementById("touch-command-state")?.value === "VIRTUAL READY");
  assert.equal(await page.locator("#run-touch-probe").isEnabled(), true);
  await page.locator("#run-touch-probe").click();
  await page.waitForFunction(
    () => document.getElementById("touch-command-state")?.value === "CYCLE PROVEN",
    null,
    { timeout: 15000 },
  );
  assert.equal(await page.locator("#machine-state").textContent(), "IDLE");
  assert.equal(await page.locator("#touch-input-state").evaluate((element) => element.value), "OPEN");
  await page.locator("#probing-panel .probing-panel-scroll").evaluate((element) => { element.scrollTop = 0; });
  await page.screenshot({ path: path.join(screenshots, "touch-probe-transaction-desktop.png"), fullPage: true });

  await page.locator("#close-probing").click();
  await page.getByRole("button", { name: "Metrology and reverse engineering" }).click();
  assert.equal(await page.locator("#metrology-point-count").evaluate((element) => element.value), "4");
  assert.equal(await page.locator("#metrology-result-type").textContent(), "CIRCLE / BORE XY");
  assert.equal(await page.locator("#metrology-result-value").evaluate((element) => element.value), "14.000 mm");
  const typedProbePoints = await page.locator("#metrology-point-list").textContent();
  for (const direction of ["+X", "-X", "+Y", "-Y"]) assert.ok(typedProbePoints.includes(direction));
  await page.screenshot({ path: path.join(screenshots, "touch-probe-metrology-desktop.png"), fullPage: true });
  await page.locator("#metrology-clear").click();
  await page.locator("#metrology-capture-armed").uncheck();
  await page.locator("#close-metrology").click();
  await page.getByRole("button", { name: "Probing settings" }).click();

  await page.getByRole("button", { name: "Disconnect telemetry" }).click();
  await page.waitForFunction(() => document.getElementById("telemetry-source")?.textContent === "SIMULATION");
  assert.equal(await page.locator("#setter-validation").textContent(), "PROFILE READY");

  await page.getByRole("tab", { name: "TOOL SETTER" }).click();

  const probingDesktopLayout = await probingLayoutAudit("desktop probing settings");
  await page.locator("#probing-panel .probing-panel-scroll").evaluate((element) => { element.scrollTop = 0; });
  await page.screenshot({ path: path.join(screenshots, "probing-settings-desktop.png"), fullPage: true });

  await page.getByRole("tab", { name: "INPUT CAL" }).click();
  assert.equal(await page.locator("#input-cal-samples").inputValue(), "7");
  assert.equal(await page.locator("#input-cal-feed-work").inputValue(), "10");
  assert.equal(await page.locator("#run-input-cal").isDisabled(), true);
  await page.getByRole("button", { name: "PREVIEW TEST" }).click();
  assert.equal(await page.locator("#input-cal-state").evaluate((element) => element.value), "PREVIEW PASS");
  assert.match(await page.locator("#input-cal-validation").textContent(), /BELOW MOTION RESOLUTION/);
  assert.notEqual(await page.locator("#input-cal-repeatability").evaluate((element) => element.value), "--.- um");
  const inputCalDesktopLayout = await probingLayoutAudit("desktop input calibration");
  await page.locator("#probing-panel .probing-panel-scroll").evaluate((element) => { element.scrollTop = 0; });
  await page.screenshot({ path: path.join(screenshots, "probing-input-cal-desktop.png"), fullPage: true });
  await page.getByRole("tab", { name: "TOOL SETTER" }).click();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(350);
  const probingMobileLayout = await probingLayoutAudit("mobile tool-setter settings");
  await page.locator("#probing-panel .probing-panel-scroll").evaluate((element) => { element.scrollTop = 0; });
  await page.screenshot({ path: path.join(screenshots, "probing-settings-toolsetter-mobile.png"), fullPage: true });

  await page.getByRole("tab", { name: "TOUCH PROBE" }).click();
  await page.locator("#probing-panel .probing-panel-scroll").evaluate((element) => { element.scrollTop = 0; });
  assert.equal(await page.locator("#touch-tip-diameter").inputValue(), "4");
  assert.equal(await page.locator("#run-touch-probe").isDisabled(), true);
  await page.waitForTimeout(350);
  const touchProbeMobileLayout = await probingLayoutAudit("mobile touch-probe settings");
  await page.screenshot({ path: path.join(screenshots, "probing-settings-mobile.png"), fullPage: true });

  await page.getByRole("tab", { name: "INPUT CAL" }).click();
  await page.locator("#probing-panel .probing-panel-scroll").evaluate((element) => { element.scrollTop = 0; });
  await page.waitForTimeout(350);
  const inputCalMobileLayout = await probingLayoutAudit("mobile input calibration");
  await page.screenshot({ path: path.join(screenshots, "probing-input-cal-mobile.png"), fullPage: true });
  await page.getByRole("button", { name: "Close probing settings", exact: true }).last().click();
  assert.equal(await page.locator("#probing-panel").getAttribute("aria-hidden"), "true");

  await page.getByRole("button", { name: "Connect telemetry" }).click();
  await page.waitForFunction(() => document.getElementById("telemetry-source")?.textContent === "BRIDGE SIM");
  await page.getByRole("button", { name: "Jog controls" }).click();
  await page.locator('[data-jog-step="continuous"]').click();
  const positiveXJog = page.getByRole("button", { name: "Jog X positive" });
  await positiveXJog.dispatchEvent("pointerdown", { button: 0, pointerId: 1, pointerType: "mouse" });
  await page.waitForFunction(() => document.getElementById("machine-state")?.textContent === "JOG");
  await positiveXJog.dispatchEvent("pointerup", { button: 0, pointerId: 1, pointerType: "mouse" });
  await page.waitForFunction(() => (
    (document.getElementById("machine-state")?.textContent === "HOLD"
      && document.getElementById("jog-command-status")?.value.includes("CANCELLED"))
    || (document.getElementById("machine-state")?.textContent === "IDLE"
      && document.getElementById("jog-command-status")?.value.includes("IDLE OBSERVED"))
  ));
  const deadmanSnapshot = telemetryService.snapshot();
  assert.equal(deadmanSnapshot.machineCommands.activeTransactionId, null);
  assert.equal(deadmanSnapshot.machineCommands.queueDepth, 0);
  await page.screenshot({ path: path.join(screenshots, "jog-deadman-cancel-mobile.png"), fullPage: true });
  await page.getByRole("button", { name: "Close jog controls", exact: true }).last().click();
  await page.getByRole("button", { name: "Disconnect telemetry" }).click();
  await page.waitForFunction(() => document.getElementById("telemetry-source")?.textContent === "SIMULATION");

  assert.deepEqual(pageErrors, [], `page errors: ${pageErrors.join(" | ")}`);
  assert.deepEqual(consoleErrors, [], `console errors: ${consoleErrors.join(" | ")}`);

  console.log(JSON.stringify({
    desktopLayout,
    mobileLayout,
    machinePixels,
    fissionDesktopLayout,
    fissionMobileLayout,
    cutterCompDesktopLayout,
    cutterCompMobileLayout,
    metrologyDesktopLayout,
    metrologyMobileLayout,
    tableCalibrationDesktopLayout,
    tableCalibrationMobileLayout,
    fixtureMapDesktopLayout,
    fixtureMapMobileLayout,
    sceneRegistrationDesktopLayout,
    sceneRegistrationMobileLayout,
    pathPixels,
    importedPixels,
    mobilePixels,
    liveDesktopLayout,
    liveMobileLayout,
    controllerPreflightDesktopLayout,
    controllerSettingsDesktopLayout,
    controllerSettingsMobileLayout,
    controllerFirmwareDesktopLayout,
    controllerFirmwareMobileLayout,
    machineDataDesktopLayout,
    machineDataMobileLayout,
    machineDataLiveLayout,
    jogPreviewDesktopLayout,
    jogLockedDesktopLayout,
    jogLockedMobileLayout,
    spindleDesktopLayout,
    spindleMobileLayout,
    sensorDesktopLayout,
    sensorMobileLayout,
    sensorDesktopCanvas,
    sensorMobileCanvas,
    wiringDesktopLayouts,
    wiringMobileLayouts,
    wiringEditorDesktopLayout,
    wiringEditorMobileLayout,
    probingDesktopLayout,
    probingMobileLayout,
    touchProbeMobileLayout,
    inputCalDesktopLayout,
    inputCalMobileLayout,
    screenshots,
  }, null, 2));
} finally {
  await browser.close();
  await telemetryService.stop();
  await rm(journalDirectory, { recursive: true, force: true });
}
