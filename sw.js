/**
 * FluidCNC Service Worker
 * Enables offline PWA functionality with smart caching
 * 
 * CHANGELOG:
 * v15 - Added enhanced visualizer, step loss detection, motion planner
 * v14 - Enhanced caching strategies, update notifications, background sync
 * v13 - Added comprehensive docs/wiring-guide.html
 * v12 - RapidChange ATC with servo lid, simulation, config UI
 * v11 - Added Vacuum/Dust Shoe toggle buttons
 * v10 - Added Conversational G-code generator panel
 * v9 - Added SD Card Manager for autonomous file running
 * v8 - Added Trinamic driver configuration UI
 * v7 - Added simulator, job recovery, settings manager, pendant mode
 * v6 - Added safety features, metrics, improved probe/ATC
 */

const VERSION = 'v15';
const CACHE_NAME = `fluidcnc-${VERSION}`;
const STATIC_CACHE = `fluidcnc-static-${VERSION}`;
const DYNAMIC_CACHE = `fluidcnc-dynamic-${VERSION}`;

// Core assets that must be cached for offline use
const CORE_ASSETS = [
    '/',
    '/index.html',
    '/pendant.html',
    '/styles.css',
    '/icons/icon.svg',
    '/lib/three.min.js',
    '/app.js',
    '/grblhal.js',
    '/grblhal-settings.js',
    '/gcode-parser.js',
    '/visualizer.js',
    '/visualizer-3d.js',
    '/visualizer-enhanced.js',
    '/macros.js',
    '/probe-wizard.js',
    '/ai-assistant.js',
    '/monitoring.js',
    '/job-queue.js',
    '/surface-scanner.js',
    '/vector-importer.js',
    '/parametric-macros.js',
    '/feeds-speeds.js',
    '/gcode-simulator.js',
    '/job-recovery.js',
    '/settings-manager.js',
    '/trinamic-config.js',
    '/conversational-gcode.js',
    '/sd-card.js',
    '/dual-serial.js',
    '/chatter-detection.js',
    '/step-loss-detection.js',
    '/motion-planner.js',
    '/smart-machine.js',
    '/auto-tuner.js',
    '/sensorless-system.js',
    '/machine-enhancements.js',
    '/tool-setter.js',
    '/camera-module.js',
    '/manifest.json'
];

// Secondary assets (nice to have, but not critical)
const SECONDARY_ASSETS = [
    '/docs/wiring-guide.html',
    '/docs/guia-cableado.html'
];

// CDN assets to cache (empty - using local Three.js now)
const CDN_ASSETS = [];

// Install - cache core assets
self.addEventListener('install', (event) => {
    console.log(`[SW] Installing FluidCNC ${VERSION}`);
    
    event.waitUntil(
        Promise.all([
            // Cache core assets (critical)
            caches.open(STATIC_CACHE).then((cache) => {
                console.log('[SW] Caching core assets');
                return cache.addAll(CORE_ASSETS);
            }),
            // Cache secondary assets (non-blocking)
            caches.open(STATIC_CACHE).then((cache) => {
                return Promise.allSettled(
                    SECONDARY_ASSETS.map(url => 
                        cache.add(url).catch(e => console.warn(`[SW] Secondary asset failed: ${url}`))
                    )
                );
            }),
            // Cache CDN assets
            caches.open(DYNAMIC_CACHE).then((cache) => {
                return Promise.allSettled(
                    CDN_ASSETS.map(url => 
                        fetch(url).then(res => cache.put(url, res)).catch(e => {})
                    )
                );
            })
        ]).then(() => {
            console.log('[SW] Installation complete');
            self.skipWaiting();
        })
    );
});

// Activate - clean old caches and notify clients
self.addEventListener('activate', (event) => {
    console.log(`[SW] Activating FluidCNC ${VERSION}`);
    
    event.waitUntil(
        caches.keys().then((keys) => {
            return Promise.all(
                keys.filter((key) => 
                    key !== STATIC_CACHE && 
                    key !== DYNAMIC_CACHE &&
                    key.startsWith('fluidcnc')
                ).map((key) => {
                    console.log(`[SW] Deleting old cache: ${key}`);
                    return caches.delete(key);
                })
            );
        }).then(() => {
            // Notify all clients about the update
            return self.clients.matchAll().then(clients => {
                clients.forEach(client => {
                    client.postMessage({
                        type: 'SW_UPDATED',
                        version: VERSION,
                        message: 'FluidCNC has been updated! Refresh for new features.'
                    });
                });
            });
        }).then(() => self.clients.claim())
    );
});

// Fetch - smart caching strategies
self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);
    
    // Skip WebSocket and non-GET requests
    if (event.request.method !== 'GET') return;
    if (url.protocol === 'ws:' || url.protocol === 'wss:') return;
    
    // Skip chrome-extension and other non-http requests
    if (!url.protocol.startsWith('http')) return;

    // Different strategies for different resources
    // CRITICAL: Never cache machine communication / API requests
    if (isAPIRequest(url)) {
        event.respondWith(networkOnly(event.request));
        return;
    }

    if (isCDNAsset(url)) {
        // CDN: Stale While Revalidate
        event.respondWith(staleWhileRevalidate(event.request));
        return;
    }

    if (isStaticAsset(url)) {
        // Static assets: Cache First
        event.respondWith(cacheFirst(event.request));
        return;
    }

    // Default: Network First with cache fallback
    event.respondWith(networkFirst(event.request));
});

// Background sync for offline commands
self.addEventListener('sync', (event) => {
    if (event.tag === 'sync-commands') {
        console.log('[SW] Background sync triggered');
        event.waitUntil(syncQueuedCommands());
    }
});

// Message handler for communication with main app
self.addEventListener('message', (event) => {
    if (event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
    
    if (event.data.type === 'GET_VERSION') {
        event.ports[0].postMessage({ version: VERSION, cache: STATIC_CACHE });
    }
    
    if (event.data.type === 'CLEAR_CACHE') {
        caches.delete(DYNAMIC_CACHE).then(() => {
            event.ports[0].postMessage({ success: true });
        });
    }
});

// ================================================================
// Caching Strategies
// ================================================================

async function cacheFirst(request) {
    const cached = await caches.match(request);
    if (cached) return cached;
    
    try {
        const response = await fetch(request);
        if (response.ok) {
            const cache = await caches.open(STATIC_CACHE);
            cache.put(request, response.clone());
        }
        return response;
    } catch (e) {
        return new Response('Offline - resource not cached', { status: 503 });
    }
}

async function networkFirst(request) {
    try {
        const response = await fetch(request);
        if (response.ok) {
            const cache = await caches.open(DYNAMIC_CACHE);
            cache.put(request, response.clone());
        }
        return response;
    } catch (e) {
        const cached = await caches.match(request);
        if (cached) return cached;
        return new Response('Offline', { status: 503 });
    }
}

async function staleWhileRevalidate(request) {
    const cache = await caches.open(DYNAMIC_CACHE);
    const cached = await cache.match(request);
    
    const fetchPromise = fetch(request).then(response => {
        if (response.ok) {
            cache.put(request, response.clone());
        }
        return response;
    }).catch(() => cached);
    
    return cached || fetchPromise;
}

async function networkOnly(request) {
    return fetch(request);
}

// ================================================================
// Helpers
// ================================================================

function isStaticAsset(url) {
    const pathname = url.pathname;

    // Explicitly treat root and index as static
    if (pathname === '/' || pathname === '/index.html') return true;

    // Core assets are absolute paths like '/app.js'
    // NOTE: Do NOT use endsWith('') matching (caused by CORE_ASSETS including '/').
    if (CORE_ASSETS.includes(pathname) || SECONDARY_ASSETS.includes(pathname)) return true;

    // Common static extensions
    return pathname.endsWith('.js') ||
           pathname.endsWith('.css') ||
           pathname.endsWith('.html') ||
           pathname.endsWith('.png') ||
           pathname.endsWith('.ico') ||
           pathname.endsWith('.svg') ||
           pathname.endsWith('.json');
}

function isCDNAsset(url) {
    return url.hostname.includes('cdnjs.cloudflare.com') ||
           url.hostname.includes('unpkg.com') ||
           url.hostname.includes('jsdelivr.net');
}

function isAPIRequest(url) {
    return url.pathname.includes('/api/') ||
           url.port === '81' ||  // WebSocket port
           url.pathname.includes('/command') ||
           url.pathname.includes('/upload');
}

async function syncQueuedCommands() {
    // This would be called when connection is restored
    // The main app handles command queuing via grblhal.js
    console.log('[SW] Sync complete');
}

// Periodic cache cleanup (runs every 24 hours)
setInterval(async () => {
    const cache = await caches.open(DYNAMIC_CACHE);
    const keys = await cache.keys();
    
    // Limit dynamic cache to 50 entries
    if (keys.length > 50) {
        const toDelete = keys.slice(0, keys.length - 50);
        for (const key of toDelete) {
            await cache.delete(key);
        }
        console.log(`[SW] Cleaned ${toDelete.length} old cache entries`);
    }
}, 24 * 60 * 60 * 1000);
