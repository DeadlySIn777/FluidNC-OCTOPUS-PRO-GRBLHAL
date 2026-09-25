import { createHeartbeat } from './native-heartbeat.js';

// Closing the tab ends this worker, so the server watchdog still stops the machine.
const heartbeat = createHeartbeat({ onResult: result => self.postMessage(result) });
self.addEventListener('message', event => heartbeat.setToken(event.data?.token ?? null));
