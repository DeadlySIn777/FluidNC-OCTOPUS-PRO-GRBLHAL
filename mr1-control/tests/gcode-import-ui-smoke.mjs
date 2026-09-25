import assert from "node:assert/strict";
import path from "node:path";

import { importDependency } from "../tools/optional-dependencies.mjs";

const { chromium } = await importDependency("playwright");
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.PLAYWRIGHT_CHROME || undefined,
  args: ["--enable-webgl", "--use-angle=swiftshader"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const pageErrors = [];
const consoleErrors = [];
page.on("pageerror", (error) => pageErrors.push(error.message));
page.on("console", (message) => {
  if (message.type() === "error") consoleErrors.push(message.text());
});

try {
  await page.addInitScript(() => {
    const NativeWorker = window.Worker;
    window.__mr1ParserTerminations = 0;
    window.Worker = class SelectiveWorker {
      constructor(url, options) {
        if (!String(url).includes("gcode-parser.worker")) return new NativeWorker(url, options);
        this.listeners = new Map();
      }

      addEventListener(type, listener) {
        this.listeners.set(type, listener);
      }

      postMessage() {}

      terminate() {
        window.__mr1ParserTerminations += 1;
      }
    };
  });

  const target = new URL(process.env.MR1_CONTROL_URL ?? "http://127.0.0.1:5173");
  target.searchParams.set("render-quality", "reduced");
  await page.goto(target.href, { waitUntil: "networkidle" });
  const initialName = await page.locator("#job-name").textContent();
  assert.match(initialName, /MR1_DEMO_POCKET\.NC/i);

  await page.locator("#gcode-file").setInputFiles({
    name: "cancel-me.nc",
    mimeType: "text/plain",
    buffer: Buffer.from("G21 G90\nG0 X0 Y0 Z5\nG1 X10 Y0 Z0 F500\n"),
  });
  await page.locator("#cancel-gcode-load").waitFor({ state: "visible", timeout: 5000 });
  await page.waitForFunction(
    () => document.getElementById("job-status")?.textContent === "PARSING + MAPPING",
    null,
    { timeout: 5000 },
  );
  assert.equal(await page.locator("#gcode-load-progress").isVisible(), true);
  await page.locator("#cancel-gcode-load").click();
  await page.waitForFunction(
    () => document.getElementById("job-status")?.textContent === "IMPORT CANCELLED",
    null,
    { timeout: 5000 },
  );

  const result = await page.evaluate(() => ({
    jobName: document.getElementById("job-name")?.textContent,
    status: document.getElementById("job-status")?.textContent,
    detail: document.getElementById("job-status")?.title,
    cancelHidden: document.getElementById("cancel-gcode-load")?.hidden,
    progressHidden: document.getElementById("gcode-load-progress")?.hidden,
    openDisabled: document.getElementById("open-gcode")?.disabled,
    parserTerminations: window.__mr1ParserTerminations,
    canvasPresent: Boolean(document.querySelector("#viewer canvas")),
  }));
  const cancelVisible = await page.locator("#cancel-gcode-load").isVisible();
  const progressVisible = await page.locator("#gcode-load-progress").isVisible();
  assert.equal(result.jobName, initialName);
  assert.equal(result.status, "IMPORT CANCELLED");
  assert.match(result.detail, /Previous preview retained/i);
  assert.equal(result.cancelHidden, true);
  assert.equal(result.progressHidden, true);
  assert.equal(cancelVisible, false);
  assert.equal(progressVisible, false);
  assert.equal(result.openDisabled, false);
  assert.equal(result.parserTerminations, 1);
  assert.equal(result.canvasPresent, true);
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(consoleErrors, []);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} finally {
  await browser.close();
}
