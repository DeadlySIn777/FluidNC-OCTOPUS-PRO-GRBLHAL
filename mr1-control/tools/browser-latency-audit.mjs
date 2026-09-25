import os from "node:os";
import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const companionProfile = process.argv.includes("--companion-profile");
const appUrl = argumentValue("--app")
  ?? (companionProfile ? "http://127.0.0.1:5173/?companion=1" : "http://127.0.0.1:5173");
const telemetrySamples = positiveInteger(argumentValue("--samples"), 50);
const outputArgument = argumentValue("--output");
const screenshotArgument = argumentValue("--screenshot");
const softwareRenderer = process.argv.includes("--software-renderer");
const miniPcProfile = process.argv.includes("--mini-pc-profile");
const miniPcCpuThrottleRate = miniPcProfile ? 4 : 1;
const startedAt = new Date();
import { importDependency } from "./optional-dependencies.mjs";

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function round(value, digits = 3) {
  if (!Number.isFinite(value)) return null;
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function percentile(sorted, fraction) {
  if (sorted.length === 0) return null;
  const index = (sorted.length - 1) * fraction;
  const low = Math.floor(index);
  const high = Math.ceil(index);
  if (low === high) return sorted[low];
  return sorted[low] + (sorted[high] - sorted[low]) * (index - low);
}

function summarize(values, digits = 3) {
  const finite = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (finite.length === 0) return { count: 0 };
  const mean = finite.reduce((sum, value) => sum + value, 0) / finite.length;
  return {
    count: finite.length,
    min: round(finite[0], digits),
    p50: round(percentile(finite, 0.5), digits),
    p95: round(percentile(finite, 0.95), digits),
    p99: round(percentile(finite, 0.99), digits),
    max: round(finite.at(-1), digits),
    mean: round(mean, digits),
  };
}

function timestampName(date) {
  return date.toISOString().replace(/[:.]/g, "-");
}

function evaluateRendererChecks(renderer) {
  const checks = [
    {
      name: "WebGL renderer available",
      pass: renderer.available === true,
      actual: renderer.available,
    },
    {
      name: "MR-1 fixture map contains all addressable holes",
      pass: renderer.fixtureHoleCount === 1_631,
      actual: renderer.fixtureHoleCount,
      expected: 1_631,
    },
  ];

  if (companionProfile) {
    checks.push(
      {
        name: "Companion profile selects reduced quality",
        pass: renderer.selectedQuality === "reduced",
        actual: renderer.selectedQuality,
        expected: "reduced",
      },
      {
        name: "Companion profile keeps hardware rendering",
        pass: renderer.detectedMode === "hardware",
        actual: renderer.detectedMode,
        expected: "hardware",
      },
      {
        name: "Companion profile uses the reduced machine representation",
        pass: renderer.cadState === "reduced" && renderer.machineCadState === "procedural",
        actual: `${renderer.cadState}/${renderer.machineCadState}`,
        expected: "reduced/procedural",
      },
      {
        name: "Companion profile keeps the semantic fixture plate",
        pass: renderer.fixtureCadState === "semantic",
        actual: renderer.fixtureCadState,
        expected: "semantic",
      },
    );
  } else if (softwareRenderer) {
    checks.push(
      {
        name: "Software renderer selects reduced quality",
        pass: renderer.selectedQuality === "reduced",
        actual: renderer.selectedQuality,
        expected: "reduced",
      },
      {
        name: "Software renderer uses the reduced machine representation",
        pass: renderer.detectedMode === "software" && renderer.cadState === "reduced",
        actual: `${renderer.detectedMode}/${renderer.cadState}`,
        expected: "software/reduced",
      },
      {
        name: "Software renderer keeps the semantic fixture plate",
        pass: renderer.fixtureCadState === "semantic",
        actual: renderer.fixtureCadState,
        expected: "semantic",
      },
    );
  } else if (miniPcProfile) {
    checks.push(
      {
        name: "Mini-PC profile selects balanced quality",
        pass: renderer.selectedQuality === "balanced",
        actual: renderer.selectedQuality,
        expected: "balanced",
      },
      {
        name: "Mini-PC profile keeps hardware rendering",
        pass: renderer.detectedMode === "hardware",
        actual: renderer.detectedMode,
        expected: "hardware",
      },
      {
        name: "Mini-PC profile loads the real MR-1 machine CAD",
        pass: renderer.cadState === "ready" && renderer.machineCadState === "ready",
        actual: `${renderer.cadState}/${renderer.machineCadState}`,
        expected: "ready/ready",
      },
      {
        name: "Mini-PC profile uses the semantic fixture plate",
        pass: renderer.fixtureCadState === "semantic",
        actual: renderer.fixtureCadState,
        expected: "semantic",
      },
    );
  } else {
    checks.push({
      name: "Default profile reaches a complete machine scene",
      pass: ["ready", "reduced"].includes(renderer.cadState),
      actual: renderer.cadState,
      expected: "ready or reduced",
    });
  }

  return checks;
}

async function importPlaywright() { return importDependency("playwright"); }

function generateGcode(moveCount) {
  const lines = ["G21 G90", "G0 X0 Y0 Z5", "M3 S7200", "G1 Z-1 F120"];
  for (let index = 0; index < moveCount; index += 1) {
    const x = (index % 200) * 1.5;
    const y = (Math.floor(index / 200) % 160) * 1.5;
    lines.push(`G1 X${x.toFixed(3)} Y${y.toFixed(3)} F650`);
  }
  lines.push("G0 Z5", "M5", "M30");
  return lines.join("\n");
}

async function waitForTelemetry(page, samples) {
  await page.waitForFunction(
    (minimum) => window.__mr1Latency?.domUpdates?.length >= minimum,
    samples,
    { timeout: Math.max(15_000, samples * 250) },
  );
}

async function measureGcodeLoad(page, moveCount) {
  const source = generateGcode(moveCount);
  const name = `LATENCY_${moveCount}.NC`;
  await page.evaluate(() => {
    const intervalMs = 5;
    const samples = [];
    let expected = performance.now() + intervalMs;
    const longTaskStart = window.__mr1Latency.longTasks.length;
    const startedAt = performance.now();
    const phaseEvents = [{ atMs: startedAt, label: "benchmark-start" }];
    const jobStatus = document.getElementById("job-status");
    const phaseObserver = new MutationObserver(() => {
      phaseEvents.push({
        atMs: performance.now(),
        label: jobStatus?.textContent ?? "",
      });
    });
    if (jobStatus) phaseObserver.observe(jobStatus, { childList: true, characterData: true, subtree: true });
    const timer = setInterval(() => {
      const now = performance.now();
      samples.push(Math.max(0, now - expected));
      expected = now + intervalMs;
    }, intervalMs);
    window.__mr1Latency.activeLoadProbe = {
      timer,
      samples,
      longTaskStart,
      startedAt,
      phaseEvents,
      phaseObserver,
    };
  });
  const start = performance.now();
  await page.locator("#gcode-file").setInputFiles({
    name,
    mimeType: "text/plain",
    buffer: Buffer.from(source),
  });
  await page.waitForFunction(
    ({ expectedName }) => (
      document.getElementById("job-name")?.textContent === expectedName
      && /MOVES/.test(document.getElementById("job-status")?.textContent ?? "")
    ),
    { expectedName: name },
    { timeout: 120_000 },
  );
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve())));
  const elapsedMs = performance.now() - start;
  const responsiveness = await page.evaluate(() => {
    const probe = window.__mr1Latency.activeLoadProbe;
    if (!probe) return { timerLatenessMs: [], longTasks: [], phaseEvents: [] };
    clearInterval(probe.timer);
    probe.phaseObserver?.disconnect();
    window.__mr1Latency.activeLoadProbe = null;
    return {
      timerLatenessMs: probe.samples,
      longTasks: window.__mr1Latency.longTasks.slice(probe.longTaskStart).map((task) => ({
        ...task,
        relativeStartMs: task.startTime - probe.startedAt,
      })),
      phaseEvents: probe.phaseEvents.map((phase) => ({
        label: phase.label,
        relativeAtMs: phase.atMs - probe.startedAt,
      })),
    };
  });
  const applicationTiming = await page.evaluate(() => {
    const viewer = document.getElementById("viewer");
    const value = (name) => {
      const parsed = Number(viewer?.dataset?.[name]);
      return Number.isFinite(parsed) ? parsed : null;
    };
    return {
      totalMs: value("gcodeLoadMs"),
      workerRoundTripMs: value("gcodeWorkerRoundTripMs"),
      parseMs: value("gcodeParseMs"),
      fixtureMapMs: value("gcodeMapMs"),
      previewBuildMs: value("gcodeBuildMs"),
    };
  });
  const applicationStart = responsiveness.phaseEvents.find(({ label }) => label === "READING FILE")?.relativeAtMs;
  const applicationLongTasks = Number.isFinite(applicationStart)
    ? responsiveness.longTasks.filter(({ relativeStartMs }) => relativeStartMs >= applicationStart)
    : responsiveness.longTasks;
  const harnessLongTasks = Number.isFinite(applicationStart)
    ? responsiveness.longTasks.filter(({ relativeStartMs }) => relativeStartMs < applicationStart)
    : [];
  const summarizeLongTasks = (tasks) => ({
    count: tasks.length,
    durationMs: summarize(tasks.map((task) => task.duration)),
    entries: tasks,
  });
  return {
    requestedMoves: moveCount,
    sourceBytes: Buffer.byteLength(source),
    elapsedMs: round(elapsedMs),
    uiFiveMillisecondTimerLatenessMs: summarize(responsiveness.timerLatenessMs),
    uiLongTasks: summarizeLongTasks(responsiveness.longTasks),
    harnessFileInjectionLongTasks: summarizeLongTasks(harnessLongTasks),
    applicationLongTasks: summarizeLongTasks(applicationLongTasks),
    phaseEvents: responsiveness.phaseEvents,
    applicationTiming,
    jobStatus: await page.locator("#job-status").textContent(),
  };
}

const report = {
  schema: "mr1-latency-browser-v1",
  measuredAt: startedAt.toISOString(),
  warning: "This benchmark loads large previews and must only run while the machine is idle.",
  configuration: {
    appUrl,
    telemetrySamples,
    rendererMode: softwareRenderer
      ? "software-fallback"
      : companionProfile && miniPcProfile
        ? "companion-mini-pc-simulated"
        : miniPcProfile ? "mini-pc-simulated" : companionProfile ? "companion" : "hardware-default",
    cpuThrottleRate: miniPcCpuThrottleRate,
  },
  system: {
    platform: process.platform,
    release: os.release(),
    node: process.version,
    cpuModel: os.cpus()[0]?.model ?? null,
  },
};

let browser;
try {
  const { chromium } = await importPlaywright();
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.PLAYWRIGHT_CHROME || undefined,
    args: softwareRenderer ? ["--enable-webgl", "--use-angle=swiftshader"] : ["--enable-webgl"],
  });
  const page = await browser.newPage({
    viewport: companionProfile ? { width: 390, height: 844 } : { width: 1440, height: 900 },
    deviceScaleFactor: 1,
  });
  if (miniPcProfile) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: miniPcCpuThrottleRate });
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "hardwareConcurrency", { configurable: true, get: () => 4 });
      Object.defineProperty(navigator, "deviceMemory", { configurable: true, get: () => 8 });
    });
  }
  const consoleErrors = [];
  const pageErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.addInitScript(() => {
    window.__mr1Latency = {
      telemetryReceipts: [],
      domUpdates: [],
      frameUpdates: [],
      longTasks: [],
      latestTelemetry: null,
    };
    const NativeEventSource = window.EventSource;
    window.EventSource = class InstrumentedEventSource extends NativeEventSource {
      addEventListener(type, listener, options) {
        if (type !== "telemetry") return super.addEventListener(type, listener, options);
        const measuredListener = (event) => {
          const receipt = performance.now();
          try {
            const payload = JSON.parse(event.data);
            const sourceEpochMs = Date.parse(payload.receivedAt);
            const sourceAgeMs = Date.now() - sourceEpochMs;
            const sample = { sequence: payload.sequence, receipt, sourceEpochMs, sourceAgeMs };
            window.__mr1Latency.latestTelemetry = sample;
            window.__mr1Latency.telemetryReceipts.push(sample);
          } catch {
            // The application owns malformed-event handling; this probe remains passive.
          }
          return listener.call(this, event);
        };
        return super.addEventListener(type, measuredListener, options);
      }
    };

    window.addEventListener("DOMContentLoaded", () => {
      const viewer = document.getElementById("viewer");
      if (!viewer) return;
      const observeSequence = (datasetKey, attributeName, collection) => {
        let previousSequence = null;
        const observer = new MutationObserver(() => {
          const sequence = Number(viewer.dataset[datasetKey]);
          const sample = window.__mr1Latency.telemetryReceipts.findLast(
            (entry) => entry.sequence === sequence,
          );
          if (!sample || sequence === previousSequence) return;
          previousSequence = sequence;
          collection.push({
            sequence,
            eventToDomMs: performance.now() - sample.receipt,
            sourceToDomMs: Date.now() - sample.sourceEpochMs,
          });
        });
        observer.observe(viewer, {
          attributes: true,
          attributeFilter: [attributeName],
        });
      };
      observeSequence(
        "telemetryCriticalSequence",
        "data-telemetry-critical-sequence",
        window.__mr1Latency.domUpdates,
      );
      observeSequence(
        "telemetryRenderedSequence",
        "data-telemetry-rendered-sequence",
        window.__mr1Latency.frameUpdates,
      );
    });

    if (typeof PerformanceObserver === "function") {
      try {
        const observer = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            window.__mr1Latency.longTasks.push({ startTime: entry.startTime, duration: entry.duration });
          }
        });
        observer.observe({ type: "longtask", buffered: true });
      } catch {
        // Long-task reporting is optional in some browser builds.
      }
    }
  });

  await page.goto(appUrl, {
    waitUntil: companionProfile ? "domcontentloaded" : "networkidle",
    timeout: 60_000,
  });
  await page.locator("#viewer canvas").waitFor({ state: "visible", timeout: 60_000 });
  await page.waitForFunction(
    () => ["ready", "reduced", "fallback"].includes(document.getElementById("viewer")?.dataset.cadState),
    null,
    { timeout: 60_000 },
  );
  const renderer = await page.evaluate(() => {
    const canvas = document.querySelector("#viewer canvas");
    const context = canvas?.getContext("webgl2") ?? canvas?.getContext("webgl");
    if (!context) return { available: false };
    const extension = context.getExtension("WEBGL_debug_renderer_info");
    return {
      available: true,
      vendor: context.getParameter(context.VENDOR),
      renderer: context.getParameter(context.RENDERER),
      unmaskedVendor: extension ? context.getParameter(extension.UNMASKED_VENDOR_WEBGL) : null,
      unmaskedRenderer: extension ? context.getParameter(extension.UNMASKED_RENDERER_WEBGL) : null,
      canvasWidth: canvas.width,
      canvasHeight: canvas.height,
      selectedQuality: document.getElementById("viewer")?.dataset.renderQuality ?? null,
      detectedMode: document.getElementById("viewer")?.dataset.rendererMode ?? null,
      cadState: document.getElementById("viewer")?.dataset.cadState ?? null,
      machineCadState: document.getElementById("viewer")?.dataset.machineCadState ?? null,
      fixtureCadState: document.getElementById("viewer")?.dataset.fixtureCadState ?? null,
      fixtureHoleCount: Number(document.getElementById("viewer")?.dataset.fixtureHoleCount ?? 0),
      hardwareConcurrency: navigator.hardwareConcurrency ?? null,
      deviceMemoryGiB: navigator.deviceMemory ?? null,
    };
  });

  if (await page.locator(".telemetry-link").getAttribute("data-link") !== "live") {
    await page.locator(".telemetry-link").click();
  }
  await page.waitForFunction(() => document.querySelector(".telemetry-link")?.dataset.link === "live", null, {
    timeout: 15_000,
  });
  await page.waitForTimeout(500);
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const frameIntervals = await page.evaluate(() => new Promise((resolve) => {
    const values = [];
    let previous = null;
    const frame = (now) => {
      if (previous !== null) values.push(now - previous);
      previous = now;
      if (values.length >= 180) resolve(values);
      else requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }));
  await waitForTelemetry(page, telemetrySamples);
  if (screenshotArgument) {
    const screenshotPath = path.resolve(screenshotArgument);
    await mkdir(path.dirname(screenshotPath), { recursive: true });
    await page.screenshot({ path: screenshotPath, fullPage: false });
    report.screenshot = screenshotPath;
  }

  const beforeLoads = await page.evaluate(() => ({
    telemetryReceipts: window.__mr1Latency.telemetryReceipts.slice(),
    domUpdates: window.__mr1Latency.domUpdates.slice(),
    frameUpdates: window.__mr1Latency.frameUpdates.slice(),
    longTasks: window.__mr1Latency.longTasks.slice(),
  }));
  report.renderer = renderer;
  report.rendererChecks = evaluateRendererChecks(renderer);
  report.animationFrameIntervalMs = summarize(frameIntervals);
  report.telemetry = {
    sourceParseToBrowserReceiptMs: summarize(beforeLoads.telemetryReceipts.map((sample) => sample.sourceAgeMs)),
    eventCallbackToDroMutationMs: summarize(beforeLoads.domUpdates.map((sample) => sample.eventToDomMs)),
    sourceParseToDroMutationMs: summarize(beforeLoads.domUpdates.map((sample) => sample.sourceToDomMs)),
    eventCallbackToRenderedFrameMs: summarize(beforeLoads.frameUpdates.map((sample) => sample.eventToDomMs)),
    sourceParseToRenderedFrameMs: summarize(beforeLoads.frameUpdates.map((sample) => sample.sourceToDomMs)),
    receiptCount: beforeLoads.telemetryReceipts.length,
    domUpdateCount: beforeLoads.domUpdates.length,
    renderedFrameCount: beforeLoads.frameUpdates.length,
  };
  report.gcodeLoads = [];
  report.gcodeLoads.push(await measureGcodeLoad(page, 10_000));
  report.gcodeLoads.push(await measureGcodeLoad(page, 25_000));

  const afterLoads = await page.evaluate(() => ({
    longTasks: window.__mr1Latency.longTasks.slice(),
    memory: performance.memory
      ? {
          usedJsHeapMiB: performance.memory.usedJSHeapSize / (1024 ** 2),
          totalJsHeapMiB: performance.memory.totalJSHeapSize / (1024 ** 2),
        }
      : null,
  }));
  report.longTasks = {
    countBeforeGcodeLoads: beforeLoads.longTasks.length,
    countTotal: afterLoads.longTasks.length,
    durationMs: summarize(afterLoads.longTasks.map((task) => task.duration)),
    maximum: afterLoads.longTasks.sort((left, right) => right.duration - left.duration)[0] ?? null,
  };
  report.memory = afterLoads.memory
    ? Object.fromEntries(Object.entries(afterLoads.memory).map(([key, value]) => [key, round(value)]))
    : null;
  report.consoleErrors = consoleErrors;
  report.pageErrors = pageErrors;
  const rendererChecksPassed = report.rendererChecks.every((check) => check.pass);
  const telemetryP99 = report.telemetry.eventCallbackToDroMutationMs.p99;
  const sourceToFrameP99 = report.telemetry.sourceParseToRenderedFrameMs.p99;
  const frameP99 = report.animationFrameIntervalMs.p99;
  const previewLongTaskMax = report.gcodeLoads.at(-1)?.applicationLongTasks?.durationMs?.max ?? 0;
  report.performanceChecks = [
    {
      name: "Animation-frame scheduling remains responsive",
      pass: Number.isFinite(frameP99) && frameP99 <= 35,
      actualMs: frameP99,
      maximumMs: 35,
    },
    {
      name: "Telemetry callback reaches the critical DRO lane promptly",
      pass: Number.isFinite(telemetryP99) && telemetryP99 <= 35,
      actualMs: telemetryP99,
      maximumMs: 35,
    },
    {
      name: "25,000-move app import has no long task over 50 ms",
      pass: previewLongTaskMax <= 50,
      actualMs: previewLongTaskMax,
      maximumMs: 50,
    },
  ];
  if (companionProfile) {
    report.performanceChecks.push({
      name: "Companion source telemetry reaches a visible frame promptly",
      pass: Number.isFinite(sourceToFrameP99) && sourceToFrameP99 <= 150,
      actualMs: sourceToFrameP99,
      maximumMs: 150,
    });
  }
  const performanceChecksPassed = report.performanceChecks.every((check) => check.pass);
  report.result = consoleErrors.length === 0
    && pageErrors.length === 0
    && rendererChecksPassed
    && performanceChecksPassed
    ? "pass"
    : "failed";
  if (report.result === "failed") process.exitCode = 1;
} catch (error) {
  report.result = "failed";
  report.error = error instanceof Error ? error.stack ?? error.message : String(error);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  report.elapsedMs = round(performance.now());
  const outputPath = outputArgument
    ? path.resolve(outputArgument)
    : path.join(root, "reports", "latency", `browser-${timestampName(startedAt)}.json`);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ outputPath, result: report.result, elapsedMs: report.elapsedMs }, null, 2));
}
