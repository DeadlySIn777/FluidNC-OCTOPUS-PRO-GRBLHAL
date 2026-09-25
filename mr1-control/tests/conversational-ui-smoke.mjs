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
  const text = message.text();
  // The optional local telemetry service is not part of this test.
  if (message.type() === "error" && !/:8787\/|ERR_FAILED|ERR_CONNECTION/.test(text)) {
    consoleErrors.push(text);
  }
});

try {
  const target = new URL(process.env.MR1_CONTROL_URL ?? "http://127.0.0.1:5173");
  target.searchParams.set("render-quality", "reduced");
  await page.goto(target.href, { waitUntil: "networkidle" });

  await page.locator("#open-conversational").click();
  await page.waitForSelector("#conversational-panel.open", { timeout: 5000 });

  const catalog = await page.evaluate(() => {
    const select = document.getElementById("conversational-cycle");
    return {
      cycles: select.querySelectorAll("option").length,
      groups: [...select.querySelectorAll("optgroup")].map((group) => group.label),
    };
  });
  assert.ok(catalog.cycles >= 20 && catalog.cycles <= 32, `expected 20-32 cycles, got ${catalog.cycles}`);
  assert.deepEqual(catalog.groups, ["Facing", "Pockets", "Contours", "Threading", "Drilling", "Turning"]);

  // A lathe cycle must generate and validate against the lathe contract.
  await page.locator("#conversational-cycle").selectOption("lathe-turn");
  await page.locator("#conversational-form button[type=submit]").click();
  await page.waitForFunction(
    () => document.getElementById("conversational-status")?.textContent.startsWith("VALIDATED"),
    null,
    { timeout: 5000 },
  );
  const latheProgram = await page.evaluate(() => document.getElementById("conversational-preview").value);
  assert.match(latheProgram, /G21 G90 G94 G18 G40 G49 G80/);
  assert.ok(!/ Y-?\d/.test(latheProgram), "lathe program leaked a Y word");

  // Panel controls must follow the dark theme, not native light widgets.
  const theme = await page.evaluate(() => {
    const select = document.getElementById("conversational-cycle");
    const styles = getComputedStyle(select);
    return { background: styles.backgroundColor, color: styles.color };
  });
  assert.notEqual(theme.background, "rgb(255, 255, 255)", "cycle select must not render as a light native control");
  assert.equal(theme.color, "rgb(255, 255, 255)");

  // Opening another right-side panel must close this one, and reopening
  // ours must close the other. (JS clicks: at this viewport width the open
  // panel overlaps the tool rail, as it does for the native panels.)
  await page.evaluate(() => document.getElementById("open-probing").click());
  await page.waitForFunction(() => !document.getElementById("conversational-panel").classList.contains("open"));
  await page.evaluate(() => document.getElementById("open-conversational").click());
  await page.waitForSelector("#conversational-panel.open");
  await page.waitForFunction(() => document.getElementById("probing-panel").getAttribute("aria-hidden") === "true");

  // A cycle switch must rebuild the parameter form.
  await page.locator("#conversational-cycle").selectOption("drill-bolt-circle");
  await page.locator('[data-param="holes"]').fill("6");

  // An out-of-contract parameter must be rejected before any program exists.
  await page.locator('[data-param="rpm"]').fill("9000");
  await page.locator("#conversational-form button[type=submit]").click();
  await page.waitForFunction(
    () => document.getElementById("conversational-status")?.textContent.startsWith("REJECTED"),
    null,
    { timeout: 5000 },
  );
  assert.equal(await page.locator("#conversational-preview").isVisible(), false);

  // A valid parameter set must validate with zero blockers.
  await page.locator('[data-param="rpm"]').fill("4000");
  await page.locator("#conversational-form button[type=submit]").click();
  await page.waitForFunction(
    () => document.getElementById("conversational-status")?.textContent.startsWith("VALIDATED"),
    null,
    { timeout: 5000 },
  );
  const program = await page.evaluate(() => document.getElementById("conversational-preview").value);
  assert.match(program, /^\(MR1 CONVERSATIONAL - DRILL BOLT CIRCLE\)/);
  assert.match(program, /\nM30\n?$/);

  // The result must be scrolled into view and the gate strip must agree.
  const resultView = await page.evaluate(() => {
    const scrollBox = document.querySelector("#conversational-panel .probing-panel-scroll").getBoundingClientRect();
    const statusBox = document.getElementById("conversational-status").getBoundingClientRect();
    return {
      statusVisible: statusBox.top >= scrollBox.top && statusBox.bottom <= scrollBox.bottom,
      gate: document.getElementById("conversational-gate-state").textContent,
      gateState: document.getElementById("conversational-gate-state").getAttribute("data-state"),
      estimate: document.getElementById("conversational-time-state").textContent,
    };
  });
  assert.equal(resultView.statusVisible, true, "validation result must scroll into view");
  assert.equal(resultView.gate, "PASS");
  assert.equal(resultView.gateState, "active");
  assert.match(resultView.estimate, /^~\d/);

  // Loading must hand the program to the standard import pipeline and
  // replace the demo job in the viewer.
  const loadButton = page.locator("#conversational-panel button", { hasText: "LOAD INTO PREVIEW" });
  await loadButton.click();
  await page.waitForFunction(
    () => document.getElementById("job-name")?.textContent.includes("MR1_CONV_DRILL_BOLT_CIRCLE.NC"),
    null,
    { timeout: 15000 },
  );
  await page.waitForFunction(
    () => !document.getElementById("conversational-panel").classList.contains("open"),
    null,
    { timeout: 5000 },
  );

  const result = await page.evaluate(() => ({
    jobName: document.getElementById("job-name")?.textContent,
    status: document.getElementById("job-status")?.textContent,
    canvasPresent: Boolean(document.querySelector("#viewer canvas")),
  }));
  assert.match(result.status, /MOVES/);
  assert.equal(result.canvasPresent, true);
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(consoleErrors, []);
  process.stdout.write(`${JSON.stringify({ ...catalog, ...result }, null, 2)}\n`);
} finally {
  await browser.close();
}
