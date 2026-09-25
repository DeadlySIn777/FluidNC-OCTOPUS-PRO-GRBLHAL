import { createHeartbeat } from './native-heartbeat.js';

// Closing the tab ends this worker, so the server watchdog still stops the machine.
const heartbeat = createHeartbeat({ onResult: result => self.postMessage(result) });
self.addEventListener('message', ({ data }) => {
  if (data && 'token' in data) heartbeat.setToken(data.token ?? null);
  if (data && 'pageVisible' in data) heartbeat.pageAlive(data.pageVisible);
});
