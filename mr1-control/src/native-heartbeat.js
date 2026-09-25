// Lease heartbeat for the native service. It runs in a dedicated worker because
// Chromium throttles timers of hidden or occluded pages to about one wake-up a
// minute, far longer than the 4 s lease. One request at a time, paced from the
// start of the previous one; a result is reported with the token it was sent with.
// Once the page reports liveness, a hung page still lets the lease lapse (the
// dead-man stop): 3 s while visible, 90 s while hidden and throttled.
export function createHeartbeat({ fetchImpl = (...args) => fetch(...args), intervalMs = 1000, timeoutMs = 2500,
  visibleGraceMs = 3000, hiddenGraceMs = 90000,
  now = () => Date.now(), setTimer = setTimeout, clearTimer = clearTimeout, onResult = () => {} } = {}) {
  let token = null, timer = null, running = false, stopped = false, page = null;
  const schedule = delay => { if (!stopped && token && timer === null && !running) timer = setTimer(beat, Math.max(0, delay)); };
  async function beat() {
    timer = null;
    const sent = token, started = now();
    if (!sent || stopped) return;
    if (page && started - page.seenAt > (page.visible ? visibleGraceMs : hiddenGraceMs)) return schedule(intervalMs);
    running = true;
    const abort = new AbortController();
    const deadline = setTimer(() => abort.abort(), timeoutMs);
    let result;
    try {
      const response = await fetchImpl('/api/heartbeat', { method: 'POST', body: '{}', signal: abort.signal,
        headers: { 'Content-Type': 'application/json', 'X-MR1-Session': sent } });
      const body = await response.json().catch(() => ({}));
      result = response.ok ? { token: sent, ok: true }
        : { token: sent, ok: false, error: body.error ?? 'Heartbeat refused.', sessionRejected: body.sessionRejected === true };
    } catch (error) {
      result = { token: sent, ok: false, sessionRejected: false,
        error: abort.signal.aborted ? 'Local controller service did not respond in time.' : String(error?.message ?? error) };
    } finally { clearTimer(deadline); running = false; }
    if (!stopped) onResult(result);
    schedule(intervalMs - (now() - started));
  }
  return {
    setToken(value) {
      token = typeof value === 'string' && /^[a-f0-9]{64}$/.test(value) ? value : null;
      if (!token && timer !== null) { clearTimer(timer); timer = null; }
      schedule(intervalMs);
    },
    pageAlive(visible) { page = { seenAt: now(), visible: visible !== false }; },
    stop() { stopped = true; token = null; if (timer !== null) clearTimer(timer); timer = null; },
  };
}
