// Browser transport only. The server owns all machine authority and command checks.
export function createNativeServiceLink({ fetchImpl = (...args) => fetch(...args),
  onState, onFailure, onToken = () => {}, readTimeoutMs = 2500 }) {
  let token = null, claim = null, polling = null, closed = false;
  let generation = 0, stateRequest = 0;

  async function request(path, input) {
    if (closed) throw new Error('Local service is closed. Use the Windows launcher to reopen MR1.');
    const bounded = input === undefined || ['/api/session', '/api/heartbeat'].includes(path);
    const abort = bounded ? new AbortController() : null;
    const deadline = abort ? setTimeout(() => abort.abort(), readTimeoutMs) : null;
    const sent = token;
    try {
      const response = await fetchImpl(path, { ...(input === undefined ? {} : {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-MR1-Session': sent ?? '' },
        body: JSON.stringify(input),
      }), ...(abort ? { signal: abort.signal } : {}) });
      const result = await response.json();
      if (!response.ok) throw Object.assign(new Error(result.error ?? 'Controller request failed.'), { sessionRejected: result.sessionRejected === true, token: sent });
      return result;
    } catch (error) {
      if (abort?.signal.aborted) throw new Error('Local controller service did not respond in time.');
      throw error;
    } finally { if (deadline) clearTimeout(deadline); }
  }

  function setToken(value) { if (token !== value) { token = value; onToken(value); } }
  function invalidate(error) {
    // Only the server's explicit rejection of this token ends ownership. A lost
    // read or heartbeat must not lock the owner out of its own session.
    if (error?.sessionRejected && error.token === token) setToken(null);
    claim = null; generation++; stateRequest++;
    if (!closed) onFailure(error);
  }
  function session() {
    if (closed) return Promise.reject(new Error('Local service is closed.'));
    if (token) return Promise.resolve();
    if (claim) return claim;
    const expectedGeneration = generation;
    const pending = request('/api/session', {}).then(result => {
      if (closed || generation !== expectedGeneration) throw new Error('Session changed before ownership was established.');
      if (typeof result.token !== 'string' || !/^[a-f0-9]{64}$/.test(result.token)) throw new Error('Invalid controller session response.');
      setToken(result.token);
    }).finally(() => { if (claim === pending) claim = null; });
    claim = pending;
    return pending;
  }
  async function refresh() {
    const order = ++stateRequest, expectedGeneration = generation;
    try {
      const state = await request('/api/state');
      if (!closed && order === stateRequest && expectedGeneration === generation) onState(state);
      return state;
    } catch (error) {
      if (!closed && order === stateRequest && expectedGeneration === generation) invalidate(error);
      throw error;
    }
  }
  function poll() {
    if (closed) return Promise.resolve();
    if (polling) return polling;
    const expectedGeneration = generation;
    const pending = (async () => {
      try {
        if (token) await request('/api/heartbeat', {});
        if (!closed && expectedGeneration === generation) await refresh();
      } catch (error) {
        if (!closed && expectedGeneration === generation) invalidate(error);
      }
    })().finally(() => { if (polling === pending) polling = null; });
    polling = pending;
    return pending;
  }
  // A heartbeat sent from the dedicated worker was explicitly refused.
  function rejected(value, message) {
    if (!closed && value && value === token) invalidate(Object.assign(new Error(message ?? 'Controller session expired.'), { sessionRejected: true, token: value }));
  }
  function close() { closed = true; setToken(null); claim = null; generation++; stateRequest++; }
  return { request, session, refresh, poll, rejected, close };
}
