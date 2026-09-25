import os from "node:os";
import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { performance, monitorEventLoopDelay } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { parseGcodeProgram } from "../src/gcode-program.js";
import { parseGrblStatus } from "../src/telemetry/grbl-status.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const serviceUrl = argumentValue("--service") ?? "http://127.0.0.1:8787";
const uiOrigin = argumentValue("--origin") ?? "http://127.0.0.1:5173";
const telemetrySamples = positiveInteger(argumentValue("--samples"), 40);
const statusIterations = positiveInteger(argumentValue("--status-iterations"), 100_000);
const outputArgument = argumentValue("--output");
const startedAt = new Date();
const eventLoopHistogram = monitorEventLoopDelay({ resolution: 10 });

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
  const variance = finite.reduce((sum, value) => sum + (value - mean) ** 2, 0) / finite.length;
  return {
    count: finite.length,
    min: round(finite[0], digits),
    p50: round(percentile(finite, 0.5), digits),
    p95: round(percentile(finite, 0.95), digits),
    p99: round(percentile(finite, 0.99), digits),
    max: round(finite.at(-1), digits),
    mean: round(mean, digits),
    standardDeviation: round(Math.sqrt(variance), digits),
  };
}

function timestampName(date) {
  return date.toISOString().replace(/[:.]/g, "-");
}

async function measureHealthRtt(samples = 100) {
  const values = [];
  let latestHealth = null;
  for (let index = 0; index < samples + 5; index += 1) {
    const start = performance.now();
    const response = await fetch(`${serviceUrl}/health`, { cache: "no-store" });
    if (!response.ok) throw new Error(`Telemetry health returned HTTP ${response.status}.`);
    latestHealth = await response.json();
    const elapsed = performance.now() - start;
    if (index >= 5) values.push(elapsed);
  }
  return { roundTripsMs: summarize(values), service: latestHealth };
}

function parseSseFrame(frame) {
  let event = "message";
  const data = [];
  for (const line of frame.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
  }
  return data.length > 0 ? { event, data: data.join("\n") } : null;
}

async function measureSse(samples) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error("Timed out waiting for telemetry samples.")), 20_000);
  const sourceAgeMs = [];
  const interarrivalMs = [];
  const sequences = [];
  let previousArrival = null;
  let textBuffer = "";

  try {
    const response = await fetch(`${serviceUrl}/events`, {
      headers: { Accept: "text/event-stream", Origin: uiOrigin },
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok || !response.body) {
      throw new Error(`Telemetry event stream returned HTTP ${response.status}.`);
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    while (sourceAgeMs.length < samples) {
      const { done, value } = await reader.read();
      if (done) break;
      textBuffer += decoder.decode(value, { stream: true }).replace(/\r/g, "");
      let separator = textBuffer.indexOf("\n\n");
      while (separator >= 0) {
        const frame = parseSseFrame(textBuffer.slice(0, separator));
        textBuffer = textBuffer.slice(separator + 2);
        if (frame?.event === "telemetry") {
          const arrival = performance.now();
          const payload = JSON.parse(frame.data);
          const sourceTime = Date.parse(payload.receivedAt);
          if (Number.isFinite(sourceTime)) sourceAgeMs.push(Date.now() - sourceTime);
          if (previousArrival !== null) interarrivalMs.push(arrival - previousArrival);
          previousArrival = arrival;
          if (Number.isInteger(payload.sequence)) sequences.push(payload.sequence);
          if (sourceAgeMs.length >= samples) {
            await reader.cancel();
            break;
          }
        }
        separator = textBuffer.indexOf("\n\n");
      }
    }
  } finally {
    clearTimeout(timeout);
  }

  const gaps = sequences.slice(1).map((sequence, index) => sequence - sequences[index] - 1);
  return {
    samples: sourceAgeMs.length,
    serviceParseToNodeReceiptMs: summarize(sourceAgeMs),
    telemetryInterarrivalMs: summarize(interarrivalMs),
    sequence: {
      first: sequences[0] ?? null,
      last: sequences.at(-1) ?? null,
      missing: gaps.reduce((sum, gap) => sum + Math.max(0, gap), 0),
      maximumGap: Math.max(0, ...gaps),
    },
  };
}

function measureStatusParser(iterations) {
  const line = "<Run|MPos:121.234,-87.654,-12.345|Bf:34,120|Ln:7821|FS:650,7200,7187|WCO:290.000,270.000,-10.000|Ov:100,100,100|A:SF|WCS:G54|Pn:P|T:3|P:0|H:1,7>";
  const receivedAt = "2026-01-01T00:00:00.000Z";
  let previous = null;
  for (let index = 0; index < 5_000; index += 1) {
    previous = parseGrblStatus(line, previous, { receivedAt });
  }
  const start = performance.now();
  for (let index = 0; index < iterations; index += 1) {
    previous = parseGrblStatus(line, previous, { receivedAt });
  }
  const elapsedMs = performance.now() - start;
  return {
    iterations,
    elapsedMs: round(elapsedMs),
    parsesPerSecond: round(iterations / (elapsedMs / 1000), 0),
    microsecondsPerParse: round((elapsedMs * 1000) / iterations),
  };
}

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

function measureGcodeParser(moveCounts) {
  return moveCounts.map((moveCount) => {
    const source = generateGcode(moveCount);
    const memoryBefore = process.memoryUsage().heapUsed;
    const start = performance.now();
    const job = parseGcodeProgram(source, { name: `LATENCY_${moveCount}.NC` });
    const elapsedMs = performance.now() - start;
    const memoryAfter = process.memoryUsage().heapUsed;
    return {
      requestedMoves: moveCount,
      parsedSegments: job.segments.length,
      sourceBytes: Buffer.byteLength(source),
      elapsedMs: round(elapsedMs),
      linesPerSecond: round(moveCount / (elapsedMs / 1000), 0),
      heapGrowthMiB: round((memoryAfter - memoryBefore) / (1024 ** 2)),
    };
  });
}

async function measureTimerJitter({ intervalMs = 5, samples = 400, blocker = null }) {
  const lateness = [];
  let nextDeadline = performance.now() + intervalMs;
  let blockerDurationMs = null;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Timer jitter test timed out.")), 15_000);
    const tick = () => {
      const now = performance.now();
      lateness.push(now - nextDeadline);
      nextDeadline += intervalMs;
      if (lateness.length >= samples) {
        clearTimeout(timeout);
        resolve({ intervalMs, deadlineLatenessMs: summarize(lateness), blockerDurationMs });
        return;
      }
      setTimeout(tick, Math.max(0, nextDeadline - performance.now()));
    };
    setTimeout(tick, intervalMs);
    if (blocker) {
      setTimeout(() => {
        const start = performance.now();
        blocker();
        blockerDurationMs = round(performance.now() - start);
      }, intervalMs * 30);
    }
  });
}

function eventLoopSummary(histogram) {
  const nanosToMs = (value) => round(value / 1_000_000);
  return {
    resolutionMs: 10,
    minMs: nanosToMs(histogram.min),
    meanMs: nanosToMs(histogram.mean),
    p95Ms: nanosToMs(histogram.percentile(95)),
    p99Ms: nanosToMs(histogram.percentile(99)),
    maxMs: nanosToMs(histogram.max),
  };
}

eventLoopHistogram.enable();
const report = {
  schema: "mr1-latency-host-v1",
  measuredAt: startedAt.toISOString(),
  warning: "This benchmark intentionally loads one CPU thread. Run it only while the machine is idle and disconnected from motion.",
  configuration: { serviceUrl, uiOrigin, telemetrySamples, statusIterations },
  system: {
    platform: process.platform,
    release: os.release(),
    architecture: os.arch(),
    node: process.version,
    cpuModel: os.cpus()[0]?.model ?? null,
    logicalCpuCount: os.cpus().length,
    totalMemoryGiB: round(os.totalmem() / (1024 ** 3)),
    processPriority: os.getPriority(),
  },
};

try {
  report.health = await measureHealthRtt();
  report.telemetry = await measureSse(telemetrySamples);
  report.statusParser = measureStatusParser(statusIterations);
  report.gcodeParser = measureGcodeParser([10_000, 50_000, 100_000]);
  report.timerIdle = await measureTimerJitter({});
  const loadProgram = generateGcode(50_000);
  report.timerDuringSynchronousParse = await measureTimerJitter({
    blocker: () => parseGcodeProgram(loadProgram, { name: "TIMER_LOAD.NC" }),
  });
  report.result = "pass";
} catch (error) {
  report.result = "failed";
  report.error = error instanceof Error ? error.stack ?? error.message : String(error);
  process.exitCode = 1;
} finally {
  eventLoopHistogram.disable();
  report.eventLoop = eventLoopSummary(eventLoopHistogram);
  report.elapsedMs = round(performance.now());
  const outputPath = outputArgument
    ? path.resolve(outputArgument)
    : path.join(root, "reports", "latency", `host-${timestampName(startedAt)}.json`);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ outputPath, result: report.result, elapsedMs: report.elapsedMs }, null, 2));
}
