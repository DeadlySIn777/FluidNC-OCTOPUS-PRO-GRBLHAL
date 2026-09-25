import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { hostname, networkInterfaces } from "node:os";
import { dirname, extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

import { defaultJournalDirectory } from "./service/event-journal.mjs";
import { createTelemetryService } from "./service/mr1-telemetry-service.mjs";

const LOOPBACK_HOST = "127.0.0.1";
const LAN_HOST = "0.0.0.0";
const WEB_PORT = 5173;
const TELEMETRY_PORT = 8787;
const ROOT = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = resolve(ROOT, "app");
const OPEN_BROWSER = !process.argv.includes("--no-open");
const LAN_MODE = process.argv.includes("--lan");
const SERVER_HOST = LAN_MODE ? LAN_HOST : LOOPBACK_HOST;
const COMPANION_TOKEN = LAN_MODE ? randomBytes(24).toString("base64url") : null;

const CONTENT_TYPES = new Map([
  [".css", "text/css; charset=utf-8"],
  [".glb", "model/gltf-binary"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".webmanifest", "application/manifest+json; charset=utf-8"],
  [".map", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml; charset=utf-8"],
  [".wasm", "application/wasm"],
  [".webp", "image/webp"],
]);

function lanAddresses() {
  const addresses = [];
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      const ipv4 = entry.family === "IPv4" || entry.family === 4;
      if (ipv4 && !entry.internal && !addresses.includes(entry.address)) addresses.push(entry.address);
    }
  }
  return addresses;
}

const LAN_ADDRESSES = LAN_MODE ? lanAddresses() : [];
const allowedOrigins = new Set([
  `http://${LOOPBACK_HOST}:${WEB_PORT}`,
  `http://localhost:${WEB_PORT}`,
  ...LAN_ADDRESSES.map((address) => `http://${address}:${WEB_PORT}`),
]);
const machineHostname = hostname().toLowerCase();
if (LAN_MODE && /^[a-z0-9.-]+$/.test(machineHostname)) {
  allowedOrigins.add(`http://${machineHostname}:${WEB_PORT}`);
}

function sendText(response, statusCode, body) {
  response.writeHead(statusCode, {
    "Content-Type": "text/plain; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
  });
  response.end(body);
}

async function resolveRequestPath(requestUrl) {
  let url;
  try {
    url = new URL(requestUrl ?? "/", `http://${LOOPBACK_HOST}:${WEB_PORT}`);
  } catch {
    return { statusCode: 400, message: "Malformed request URL." };
  }

  let relativePath;
  try {
    relativePath = decodeURIComponent(url.pathname).replace(/^\/+/, "") || "index.html";
  } catch {
    return { statusCode: 400, message: "Malformed request path." };
  }

  const candidate = resolve(APP_ROOT, relativePath);
  if (candidate !== APP_ROOT && !candidate.startsWith(`${APP_ROOT}${sep}`)) {
    return { statusCode: 403, message: "Request path is outside the application." };
  }

  try {
    const file = await stat(candidate);
    if (file.isFile()) return { path: candidate, size: file.size };
  } catch {
    // Extensionless routes fall back to the single-page application below.
  }

  if (!extname(relativePath)) {
    const indexPath = resolve(APP_ROOT, "index.html");
    const file = await stat(indexPath);
    return { path: indexPath, size: file.size };
  }
  return { statusCode: 404, message: "File not found." };
}

const webServer = createServer(async (request, response) => {
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.setHeader("Allow", "GET, HEAD");
    sendText(response, 405, "Method not allowed.");
    return;
  }

  try {
    const target = await resolveRequestPath(request.url);
    if (!target.path) {
      sendText(response, target.statusCode, target.message);
      return;
    }

    const extension = extname(target.path).toLowerCase();
    response.writeHead(200, {
      "Content-Type": CONTENT_TYPES.get(extension) ?? "application/octet-stream",
      "Content-Length": target.size,
      "Cache-Control": extension === ".html" ? "no-store" : "public, max-age=3600",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "X-Frame-Options": "DENY",
    });
    if (request.method === "HEAD") {
      response.end();
      return;
    }
    createReadStream(target.path)
      .on("error", () => response.destroy())
      .pipe(response);
  } catch (error) {
    sendText(response, 500, `Unable to serve the MR-1 interface: ${error.message}`);
  }
});

function listen(server, port, host = LOOPBACK_HOST) {
  return new Promise((accept, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      accept();
    });
  });
}

function close(server) {
  return new Promise((accept) => {
    if (!server.listening) {
      accept();
      return;
    }
    server.close(() => accept());
  });
}

function openDefaultBrowser(url) {
  // cmd.exe splits an unquoted URL at "&", running "pair=..." as a command.
  // Pass one verbatim, quoted start command; /s strips only the outer quotes.
  if (process.platform !== "win32" || !/^http:\/\/[A-Za-z0-9.:/?=&_-]+$/.test(url)) return;
  const child = spawn("cmd.exe", ["/d", "/s", "/c", `"start "" "${url}""`], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
    windowsVerbatimArguments: true,
  });
  child.unref();
}

const telemetry = createTelemetryService({
  mode: "simulate",
  httpPort: TELEMETRY_PORT,
  httpHost: SERVER_HOST,
  allowedOrigins,
  companionToken: COMPANION_TOKEN,
  fissionRoot: false,
  journalDirectory: defaultJournalDirectory(),
});
let stopping = false;

async function stop(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  await Promise.allSettled([telemetry.stop(), close(webServer)]);
  process.exitCode = exitCode;
}

async function main() {
  try {
    await listen(webServer, WEB_PORT, SERVER_HOST);
    await telemetry.start();
  } catch (error) {
    await stop(1);
    if (error?.code === "EADDRINUSE") {
      throw new Error("Another MR-1 Control window is already running. Close it, then try again.");
    }
    throw error;
  }

  const pairingQuery = COMPANION_TOKEN
    ? `?companion=1&pair=${encodeURIComponent(COMPANION_TOKEN)}`
    : "";
  const url = `http://${LOOPBACK_HOST}:${WEB_PORT}/${pairingQuery}`;
  process.stdout.write("\nMR-1 CONTROL - PORTABLE TEST\n");
  process.stdout.write("================================\n");
  process.stdout.write("Mode: TYPED VIRTUAL MR-1 TRANSACTIONS\n");
  process.stdout.write(`Control screen: ${url}\n`);
  if (LAN_MODE) {
    process.stdout.write("Phone companion test (trusted private Wi-Fi only):\n");
    for (const address of LAN_ADDRESSES) {
      process.stdout.write(`  http://${address}:${WEB_PORT}/${pairingQuery}\n`);
    }
    if (LAN_ADDRESSES.length === 0) {
      process.stdout.write("  No active LAN IPv4 address was found.\n");
    }
    process.stdout.write("The pairing link controls the virtual MR-1 only; physical serial output remains absent.\n");
  }
  process.stdout.write("Virtual WCS, jog, tool-setter, touch-probe, and controller-preflight tests are enabled.\n");
  process.stdout.write(`Event journal: ${defaultJournalDirectory()}\n`);
  process.stdout.write("No physical machine commands or serial connections are enabled.\n");
  process.stdout.write("Keep this window open. Close it or press Ctrl+C to stop.\n\n");
  if (OPEN_BROWSER) setTimeout(() => openDefaultBrowser(url), 500);
}

process.once("SIGINT", () => void stop());
process.once("SIGTERM", () => void stop());
process.once("uncaughtException", (error) => {
  process.stderr.write(`MR-1 Control stopped: ${error.message}\n`);
  void stop(1);
});
process.once("unhandledRejection", (error) => {
  process.stderr.write(`MR-1 Control stopped: ${error instanceof Error ? error.message : String(error)}\n`);
  void stop(1);
});

main().catch((error) => {
  process.stderr.write(`MR-1 Control could not start: ${error.message}\n`);
  process.exitCode = 1;
});
