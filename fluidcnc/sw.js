/**
 * FluidCNC Service Worker
 * Enables offline PWA functionality
 * 
 * CHANGELOG:
 * v13 - Added comprehensive docs/wiring-guide.html
 * v12 - RapidChange ATC with servo lid, simulation, config UI
 * v11 - Added Vacuum/Dust Shoe toggle buttons
 * v10 - Added Conversational G-code generator panel
 * v9 - Added SD Card Manager for autonomous file running
 * v8 - Added Trinamic driver configuration UI
 * v7 - Added simulator, job recovery, settings manager, pendant mode
 * v6 - Added safety features, metrics, improved probe/ATC
 */

const CACHE_NAME = 'fluidcnc-v13';
const ASSETS = [
    '/',
    '/index.html',
    '/pendant.html',
    '/styles.css',
    '/app.js',
    '/grblhal.js',
    '/gcode-parser.js',
    '/visualizer.js',
    '/visualizer-3d.js',
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
    '/manifest.json',
    // Documentation
    '/docs/wiring-guide.html',
    // Icons
    '/icons/icon-192.png',
    '/icons/icon-512.png'
];

// Install - cache assets
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => {
                console.log('FluidCNC: Caching assets');
                return cache.addAll(ASSETS);
            })
            .then(() => self.skipWaiting())
    );
});

// Activate - clean old caches
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) => {
            return Promise.all(
                keys.filter((key) => key !== CACHE_NAME)
                    .map((key) => caches.delete(key))
            );
        }).then(() => self.clients.claim())
    );
});

// Fetch - network first, fallback to cache
self.addEventListener('fetch', (event) => {
    // Skip WebSocket requests
    if (event.request.url.includes('ws://') || event.request.url.includes('wss://')) {
        return;
    }

    event.respondWith(
        fetch(event.request)
            .then((response) => {
                // Clone and cache successful responses
                if (response.ok) {
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then((cache) => {
                        cache.put(event.request, clone);
                    });
                }
                return response;
            })
            .catch(() => {
                // Fallback to cache
                return caches.match(event.request);
            })
    );
});
