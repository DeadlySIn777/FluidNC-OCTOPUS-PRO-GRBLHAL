const CACHE_PREFIX = "mr1-control-shell-";
const CACHE_NAME = `${CACHE_PREFIX}v2`;

function previewDocument(url) {
  return ["/", "/index.html"].includes(url.pathname)
    && [...url.searchParams].every(([key, value]) => key === "companion" && value === "1");
}

function staticAsset(url) {
  // Cache only known finite assets. New service endpoints stay network-only
  // automatically; firmware artifacts also require a fresh service response.
  return !url.search && (url.pathname === "/manifest.webmanifest"
    || /^\/(?:assets|icons)\/[^/]+\.(?:js|css|svg|png|jpe?g|webp|ico|woff2?)$/i.test(url.pathname)
    || /^\/models\/[^/]+\.glb$/i.test(url.pathname));
}

function cacheable(response) {
  return response.ok
    && !/text\/event-stream/i.test(response.headers.get("content-type") ?? "")
    && !/\bno-store\b/i.test(response.headers.get("cache-control") ?? "");
}

function remember(event, key, response) {
  if (cacheable(response)) {
    const copy = response.clone();
    event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.put(key, copy)).catch(() => {}));
  }
  return response;
}

self.addEventListener("install", (event) => {
  // Updating control must not wait for network-prefetch slots that an old
  // cached event stream may be occupying. Preview assets fill on actual use.
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Never consult CacheStorage, tee a stream, refresh in the background or
  // substitute an offline document for live controller/service information.
  // This also bypasses the browser HTTP cache, not just this worker's cache.
  if (/text\/event-stream/i.test(request.headers.get("accept") ?? "")
    || (request.mode === "navigate" ? !previewDocument(url) : !staticAsset(url))) {
    event.respondWith(fetch(request, { cache: "no-store" }));
    return;
  }

  if (request.mode === "navigate" && previewDocument(url)) {
    event.respondWith(
      fetch(request, { cache: "no-store" })
        .then(response => remember(event, "/", response))
        .catch(async () => (await (await caches.open(CACHE_NAME)).match("/"))
          ?? new Response("Offline preview is not available yet. Reconnect to open MR1 Control.",
            { status: 503, headers: { "Content-Type": "text/plain", "Cache-Control": "no-store" } })),
    );
    return;
  }

  event.respondWith(
    caches.open(CACHE_NAME).then(cache => cache.match(request))
      .then(cached => cached ?? fetch(request).then(response => remember(event, request, response))),
  );
});
