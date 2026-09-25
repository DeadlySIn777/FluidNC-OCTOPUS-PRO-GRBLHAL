import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

import { initializePwa } from "../src/pwa.js";

class FakeTarget {
  constructor() {
    this.listeners = new Map();
    this.hidden = false;
  }

  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(listener);
  }

  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener);
  }

  dispatch(type, event = {}) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

test("install prompt is user-initiated and service worker registration is secure-context only", async () => {
  const window = new FakeTarget();
  window.isSecureContext = true;
  const button = new FakeTarget();
  const registrations = [];
  const pwa = initializePwa({
    window,
    installButton: button,
    navigator: {
      serviceWorker: {
        register: async (...args) => {
          registrations.push(args);
          return { scope: "http://localhost:5173/" };
        },
      },
    },
  });
  await pwa.register();
  assert.deepEqual(registrations, [["/sw.js", { scope: "/" }]]);
  assert.equal(button.hidden, true);

  let prevented = false;
  let prompted = 0;
  window.dispatch("beforeinstallprompt", {
    preventDefault: () => { prevented = true; },
    prompt: async () => { prompted += 1; },
    userChoice: Promise.resolve({ outcome: "accepted" }),
  });
  assert.equal(prevented, true);
  assert.equal(button.hidden, false);
  button.dispatch("click");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(prompted, 1);
  assert.equal(button.hidden, true);
  pwa.dispose();
});

test("manifest and offline shell expose a standalone MR-1 companion without remote dependencies", async () => {
  const manifest = JSON.parse(await readFile(new URL("../public/manifest.webmanifest", import.meta.url), "utf8"));
  const worker = await readFile(new URL("../public/sw.js", import.meta.url), "utf8");
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.start_url, "/?companion=1");
  assert.ok(manifest.icons.some((icon) => icon.purpose === "maskable"));
  assert.match(worker, /request\.mode === "navigate"/);
  assert.doesNotMatch(worker, /https?:\/\/(?!self|localhost|127)/);
  assert.match(html, /rel="manifest" href="\/manifest\.webmanifest"/);
  assert.match(html, /id="install-companion"/);
});

const ORIGIN = 'http://127.0.0.1:5174';
const CACHE_NAME = 'mr1-control-shell-v2';
async function workerHarness() {
  const listeners = new Map(), stores = new Map(), calls = { fetch: [], match: [], put: [], open: [], deleted: [], claim: 0, skip: 0 };
  const key = input => new URL(typeof input === 'string' ? input : input.url, ORIGIN).href;
  const caches = {
    keys: async () => [...stores.keys()],
    delete: async name => { calls.deleted.push(name); return stores.delete(name); },
    open: async name => {
      calls.open.push(name);
      if (!stores.has(name)) stores.set(name, new Map());
      const store = stores.get(name);
      return {
        match: async input => { calls.match.push({ name, key: key(input) }); return store.get(key(input))?.clone(); },
        put: async (input, response) => { calls.put.push({ name, key: key(input) }); store.set(key(input), response); },
      };
    },
  };
  let handler = async () => new Response('fresh', { headers: { 'Content-Type': 'text/plain' } });
  const context = vm.createContext({ URL, Response, caches,
    fetch: (input, options) => { calls.fetch.push({ input, options }); return handler(input, options); },
    self: { location: { origin: ORIGIN },
      addEventListener: (name, callback) => listeners.set(name, callback),
      skipWaiting: async () => { calls.skip++; }, clients: { claim: async () => { calls.claim++; } } },
  });
  vm.runInContext(await readFile(new URL('../public/sw.js', import.meta.url), 'utf8'), context);
  return {
    calls, stores,
    network: callback => { handler = callback; },
    seed: (cache, path, response) => {
      if (!stores.has(cache)) stores.set(cache, new Map());
      stores.get(cache).set(key(path), response);
    },
    async dispatch(type, path = '/', options = {}) {
      const pending = []; let response;
      const request = { url: new URL(path, ORIGIN).href, method: options.method ?? 'GET', mode: options.mode ?? 'cors',
        headers: new Headers(options.headers ?? {}) };
      listeners.get(type)({ request, waitUntil: promise => pending.push(promise), respondWith: promise => { response = Promise.resolve(promise); } });
      const answer = response ? await response : undefined;
      await Promise.all(pending);
      return answer;
    },
  };
}

test('worker activation purges stale MR1 authority caches without deleting unrelated application data', async () => {
  const worker = await workerHarness();
  worker.seed('mr1-control-shell-v1', '/api/state', Response.json({ armed: true }));
  worker.seed('mr1-control-shell-older', '/events', new Response('stale event'));
  worker.seed(CACHE_NAME, '/assets/index-current.js', new Response('current static script'));
  worker.seed('other-application-data', '/', new Response('unrelated'));
  await worker.dispatch('install'); await worker.dispatch('activate');
  assert.equal(worker.calls.skip, 1);
  assert.equal(worker.calls.claim, 1);
  assert.deepEqual(worker.calls.deleted.sort(), ['mr1-control-shell-older', 'mr1-control-shell-v1']);
  assert.ok(worker.stores.has('other-application-data'));
  assert.ok(worker.stores.has(CACHE_NAME));
  assert.equal(worker.calls.fetch.length, 0, 'activation must not wait for network or event-stream slots');
});

test('all current and future service GETs ignore stale caches and bypass the browser HTTP cache', async () => {
  const worker = await workerHarness();
  const routes = ['/api/state', '/api/ports', '/api/future', '/events', '/health', '/controller/preflight',
    '/journal/export', '/journal/future', '/latency/ping', '/optimize/fission', '/sensor/calibration', '/machine/transactions',
    '/future-service/status', '/firmware/octopus-pro-v1.1-f429-mr1/firmware.bin'];
  for (const path of routes) worker.seed(CACHE_NAME, path, Response.json({ armed: true, stale: true }));
  let count = 0;
  worker.network(async () => Response.json({ armed: false, sequence: ++count }));
  for (const path of routes) {
    const response = await worker.dispatch('fetch', path);
    assert.deepEqual(await response.json(), { armed: false, sequence: count });
  }
  assert.equal(worker.calls.fetch.length, routes.length);
  assert.ok(worker.calls.fetch.every(call => call.options?.cache === 'no-store'));
  assert.equal(worker.calls.open.length, 0);
  assert.equal(worker.calls.match.length, 0);
  assert.equal(worker.calls.put.length, 0);
});

test('event streams are passed through once without cloning, caching or draining their body', async () => {
  const worker = await workerHarness();
  const stream = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('data: live\n\n')); } });
  const response = new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } });
  response.clone = () => { throw new Error('An event stream must not be cloned'); };
  worker.network(async () => response);
  const received = await worker.dispatch('fetch', '/events', { headers: { Accept: 'text/event-stream' } });
  assert.equal(received, response);
  const reader = received.body.getReader();
  assert.equal(new TextDecoder().decode((await reader.read()).value), 'data: live\n\n');
  await reader.cancel();
  assert.equal(worker.calls.fetch.length, 1);
  assert.equal(worker.calls.open.length, 0);
  assert.equal(worker.calls.put.length, 0);
});

test('native navigation and direct service navigation fail offline instead of showing a cached controller', async () => {
  const worker = await workerHarness();
  worker.seed(CACHE_NAME, '/', new Response('<html>stale controller</html>'));
  worker.network(async () => { throw new Error('Local controller service is offline'); });
  for (const path of ['/?native=1', '/index.html?native=1', '/?companion=1&native=1', '/api/state', '/health', '/?pair=private-token']) {
    await assert.rejects(worker.dispatch('fetch', path, { mode: 'navigate' }), /offline/);
  }
  assert.equal(worker.calls.match.length, 0);
  assert.equal(worker.calls.put.length, 0);
});

test('live service failures never fall back to an old successful API response', async () => {
  const worker = await workerHarness();
  worker.seed(CACHE_NAME, '/api/state', Response.json({ connected: true, armed: true }));
  worker.network(async () => { throw new Error('connection lost'); });
  await assert.rejects(worker.dispatch('fetch', '/api/state'), /connection lost/);
  assert.equal(worker.calls.match.length, 0);
});

test('non-native preview keeps its offline shell and finite static assets without background refresh leaks', async () => {
  const worker = await workerHarness();
  worker.network(async request => new Response(request.mode === 'navigate' ? '<html>preview shell</html>' : 'finite script',
    { headers: { 'Content-Type': request.mode === 'navigate' ? 'text/html' : 'text/javascript' } }));
  assert.equal(await (await worker.dispatch('fetch', '/?companion=1', { mode: 'navigate' })).text(), '<html>preview shell</html>');
  assert.equal(await (await worker.dispatch('fetch', '/assets/index-HASH.js')).text(), 'finite script');
  const fetchCount = worker.calls.fetch.length;
  worker.network(async () => { throw new Error('offline'); });
  assert.equal(await (await worker.dispatch('fetch', '/assets/index-HASH.js')).text(), 'finite script');
  assert.equal(worker.calls.fetch.length, fetchCount, 'a cached static asset does not create an ignored failing network promise');
  assert.equal(await (await worker.dispatch('fetch', '/?companion=1', { mode: 'navigate' })).text(), '<html>preview shell</html>');
  const empty = await workerHarness();
  empty.network(async () => { throw new Error('offline'); });
  assert.equal((await empty.dispatch('fetch', '/', { mode: 'navigate' })).status, 503);
});

test('no-store responses and unexpected streams on asset URLs are never cloned or cached', async () => {
  for (const headers of [{ 'Cache-Control': 'no-store' }, { 'Content-Type': 'text/event-stream' }]) {
    const worker = await workerHarness();
    const response = new Response('private response', { headers });
    response.clone = () => { throw new Error('Response must not be cloned'); };
    worker.network(async () => response);
    assert.equal(await worker.dispatch('fetch', '/assets/index-HASH.js'), response);
    assert.equal(worker.calls.put.length, 0);
  }
});

test('worker leaves mutations and cross-origin traffic untouched', async () => {
  const worker = await workerHarness();
  assert.equal(await worker.dispatch('fetch', '/api/command', { method: 'POST' }), undefined);
  assert.equal(await worker.dispatch('fetch', 'https://example.invalid/assets/index.js'), undefined);
  assert.equal(worker.calls.fetch.length, 0);
  assert.equal(worker.calls.open.length, 0);
});
