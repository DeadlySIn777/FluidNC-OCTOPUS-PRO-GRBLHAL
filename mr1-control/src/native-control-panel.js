import './native-control-panel.css';
import { mountCommissioningControls } from './native-commissioning-panel.js';
import { mountNativeWorkflowControls } from './native-workflow-panel.js';
import { mountNativeWiringControls } from './native-wiring-panel.js';
import { createNativeServiceLink } from './native-service-link.js';

export function mountNativeControlPanel({ loadPreview, connectTelemetry, onState = () => {}, getReviewedSource }) {
  if (new URLSearchParams(location.search).get('native') !== '1') return;
  let snapshot = null;
  let serviceStopped = false;
  let pendingActions = 0;
  let confirmationConnection = null;
  let confirmationFault = null;
  let message = 'Select the Octopus USB port when the board is ready. Nothing connects automatically.';
  const button = document.createElement('button');
  button.id = 'open-native-control'; button.textContent = 'CONTROLLER · OFFLINE';
  button.className = 'native-launch';
  document.querySelector('.top-status').prepend(button);
  const panel = document.createElement('section');
  panel.className = 'native-control'; panel.hidden = false; panel.setAttribute('aria-label', 'MR1 machine controller');
  panel.innerHTML = `<header><div><small>MR1 / WINDOWS</small><h2>MACHINE CONTROL</h2></div><button data-close aria-label="Close machine control">×</button></header>
    <div class="native-state" role="status">DISCONNECTED</div>
    <p class="native-note">Your controller, running locally. No machine connection is made until you select a port.</p>
    <label>USB controller<select id="native-port"><option value="">No port selected</option></select></label>
    <div class="native-row"><button data-refresh>Refresh ports</button><button data-connect>Connect read-only</button><button data-disconnect>Disconnect</button></div>
    <p class="native-preflight"></p>
    <details data-commissioning><summary>Commissioning & recovery</summary>
    <label>Import completed commissioning record<input id="native-qualification" type="file" accept=".json"></label>
    <p class="native-qualification">Physical commissioning has not been recorded.</p>
    <label class="native-confirm"><input type="checkbox" id="native-recovery-confirm"> I reviewed the interrupted session and verified the machine is stopped</label>
    <button data-recovery>Record recovery review</button>
    <a href="/journal/export" download>Download controller journal</a>
    <button data-shutdown>Close local service</button></details>
    <label class="native-confirm"><input type="checkbox" id="native-clear"> E-stop verified and machine envelope clear</label>
    <label>Homing axes<select id="native-home-axis"><option value="all">XYZ / production sequence</option><option value="x">X only</option><option value="y">Dual Y only</option><option value="z">Z only</option></select></label>
    <div class="native-row"><button data-command="arm">Arm</button><button data-command="home">Home selected axes</button><button data-command="disarm">Disarm</button></div>
    <h3>Move & set work zero</h3>
    <div class="native-row"><label>Step, mm<input id="native-step" type="number" value="1" min="0.001" max="10" step="0.1"></label><label>Feed, mm/min<input id="native-feed" type="number" value="100" min="1" max="1016"></label></div>
    <div class="native-jogs">${['x', 'y', 'z'].map(axis => `<div><button data-jog="${axis}" data-sign="-1">${axis.toUpperCase()} −</button><button data-jog="${axis}" data-sign="1">${axis.toUpperCase()} +</button><button data-zero="${axis}">Zero ${axis.toUpperCase()}</button></div>`).join('')}</div>
    <label>Work system<select id="native-wcs">${['G54','G55','G56','G57','G58','G59'].map(w => `<option>${w}</option>`).join('')}</select></label>
    <details><summary>Probe from current position</summary>
    <p class="native-note">Two contacts with a slow latch and retraction. Position the probe close to the surface with a clear search path. Results are machine coordinates; work offsets remain unchanged.</p>
    <div class="native-row"><label>Input<select id="native-probe-input"><option value="0">Touch probe</option><option value="1">Tool setter</option></select></label><label>Axis<select id="native-probe-axis"><option>Z</option><option>X</option><option>Y</option></select></label></div>
    <label>Signed search distance, mm<input id="native-probe-distance" type="number" min="-25" max="25" step="0.1" value="-2"></label>
    <label class="native-confirm"><input id="native-probe-clear" type="checkbox"> Spindle stopped and probe path clear</label>
    <button data-probe>Measure two contacts</button><p class="native-probe-result">No measurement</p></details>
    <h3>Program</h3><label class="native-confirm"><input id="native-air-run" type="checkbox"> Spindle-off air-run source (requires an air-run commissioning session)</label><label class="native-file">Load NC file<input id="native-file" type="file" accept=".nc,.ngc,.gcode,.tap,.cnc,.txt"></label>
    <p class="native-program">No program loaded</p><progress id="native-progress" value="0" max="1"></progress>
    <div class="native-row"><button data-command="run">Run reviewed program</button><button data-command="hold">Hold</button><button data-command="resume">Resume</button></div>
    <button class="native-stop" data-command="stop">STOP / RESET</button>
    <h3>Spindle & coolant</h3><div class="native-row"><label>RPM<input id="native-rpm" type="number" value="3000" min="1000" max="8000"></label><label>Coolant<select id="native-coolant"><option value="off">Off</option><option value="flood">Flood</option><option value="mist">Mist / air</option></select></label></div>
    <div class="native-row"><button data-outputs="cw">Apply outputs</button><button data-outputs="off">Outputs off</button></div>
    <p class="native-message" role="status"></p><p class="native-footnote">Hardware commissioning is pending. The physical E-stop remains independent of this screen.</p>`;
  document.body.append(panel);
  const $ = selector => panel.querySelector(selector);
  // Energy-removing commands need no browser lease and no fresh session claim.
  const energyRemoving = ['hold', 'stop', 'disarm'];
  let heartbeatWorker = null;
  try {
    heartbeatWorker = new Worker(new URL('./native-heartbeat.worker.js', import.meta.url), { type: 'module', name: 'mr1-native-heartbeat' });
    heartbeatWorker.addEventListener('message', event => { if (event.data?.sessionRejected) link.rejected(event.data.token, event.data.error); });
    heartbeatWorker.addEventListener('error', () => { heartbeatWorker?.terminate(); heartbeatWorker = null; });
  } catch { heartbeatWorker = null; }
  const link = createNativeServiceLink({
    onState: state => { snapshot = state; render(); },
    onFailure: error => {
      message = error.message;
      // Unknown is not disconnected: the service may still hold an armed controller.
      if (snapshot) snapshot = { ...snapshot, connected: false, armed: false, status: null,
        preflight: null, motionQualified: false, fault: message, linkLost: true,
        commissioning: snapshot.commissioning ? { ...snapshot.commissioning, session: null } : undefined };
      else {
        $('.native-message').textContent = message;
        for (const action of energyRemoving) $(`[data-command="${action}"]`).disabled = false;
      }
      render();
    },
    onToken: token => heartbeatWorker?.postMessage({ token }),
  });
  const request = link.request;
  const commissioningControls = mountCommissioningControls({ root: $('[data-commissioning]'), request, act, getSnapshot: () => snapshot });
  const workflowControls = mountNativeWorkflowControls({ root: panel, request, act, getSnapshot: () => snapshot });
  const wiringControls = mountNativeWiringControls({ root: panel, getSnapshot: () => snapshot });
  for (const control of panel.querySelectorAll('[data-connect], [data-disconnect], [data-recovery], [data-shutdown], [data-command], [data-jog], [data-zero], [data-outputs], [data-probe]')) control.disabled = true;
  const render = () => {
    if (!snapshot) return;
    const state = snapshot.status?.state?.raw ?? 'DISCONNECTED';
    const connection = snapshot.connected ? snapshot.port : null;
    if (connection !== confirmationConnection || (snapshot.fault && snapshot.fault !== confirmationFault)) {
      $('#native-clear').checked = false; $('#native-probe-clear').checked = false;
      $('#native-recovery-confirm').checked = false;
      for (const confirmation of panel.querySelectorAll('[data-attestation], [data-temporary], [data-restore-confirm], [data-workflow-reviewed], [data-workflow-stopped], [data-workflow-route], [data-workflow-write], [data-workflow-reference-confirm]')) confirmation.checked = false;
      confirmationConnection = connection;
    }
    confirmationFault = snapshot.fault;
    const session = snapshot.commissioning?.session;
    const permits = new Set(snapshot.motionQualified ? ['arm','home','jog','zero','outputs','probe','run','resume','workflow'] : session?.active ? session.capabilities : []);
    const connectionState = snapshot.disconnecting ? 'DISCONNECTING' : snapshot.connecting ? 'CONNECTING' : snapshot.connected ? state.toUpperCase() : 'DISCONNECTED';
    button.textContent = `CONTROLLER · ${connectionState === 'DISCONNECTED' ? 'OFFLINE' : connectionState}`;
    $('.native-state').textContent = `${connectionState}${snapshot.armed ? ' / ARMED' : ''}${session ? ' / ' + session.stage.toUpperCase() : ''}`;
    $('.native-preflight').textContent = snapshot.preflight
      ? `Firmware check: ${snapshot.preflight.status} · ${snapshot.preflight.counts.settingsPassed}/${snapshot.preflight.counts.settingsExpected} settings${snapshot.preflight.issues.length ? '\n' + snapshot.preflight.issues.map(i => i.message).join('\n') : ''}`
      : 'Firmware check awaits a controller connection.';
    $('.native-program').textContent = snapshot.program ? `${snapshot.program.name}\n${snapshot.job.state.toUpperCase()} · ${snapshot.job.acknowledged}/${snapshot.job.total} lines acknowledged\nSHA-256 ${snapshot.program.sha256}` : 'No program loaded';
    $('#native-progress').value = snapshot.job.total ? snapshot.job.acknowledged / snapshot.job.total : 0;
    $('.native-message').textContent = snapshot.fault ?? message;
    $('[data-connect]').disabled = Boolean(snapshot.port) || snapshot.connected || snapshot.connecting || snapshot.disconnecting || snapshot.busy || !$('#native-port').value;
    $('[data-disconnect]').disabled = snapshot.disconnecting || (!snapshot.port && !snapshot.connected && !snapshot.connecting);
    $('#native-port').disabled = Boolean(snapshot.port) || snapshot.connected || snapshot.connecting || snapshot.disconnecting;
    for (const control of panel.querySelectorAll('[data-jog], [data-zero], [data-outputs], [data-probe], [data-command="home"], [data-command="run"]')) control.disabled = !snapshot.armed || snapshot.busy;
    for (const [selector, action] of [['[data-jog]','jog'],['[data-zero]','zero'],['[data-outputs]','outputs'],['[data-probe]','probe'],['[data-command="home"]','home'],['[data-command="run"]','run']]) {
      for (const control of panel.querySelectorAll(selector)) control.disabled ||= !permits.has(action);
    }
    $('[data-command="arm"]').disabled = !snapshot.connected || !permits.has('arm') || snapshot.busy;
    $('[data-command="run"]').disabled ||= snapshot.job.state !== 'loaded';
    $('[data-command="resume"]').disabled = !snapshot.armed || !permits.has('resume') || snapshot.status?.state?.name !== 'Hold' || snapshot.status?.state?.substate !== 0;
    for (const action of energyRemoving) $(`[data-command="${action}"]`).disabled = !snapshot.connected && !snapshot.linkLost;
    $('[data-recovery]').disabled = snapshot.journalReady || !snapshot.reconciliation?.reviewable || snapshot.connected;
    $('[data-shutdown]').disabled = Boolean(snapshot.port) || snapshot.connected || snapshot.connecting || snapshot.disconnecting || snapshot.busy;
    $('.native-qualification').textContent = snapshot.motionQualified ? 'Commissioning evidence accepted for this connection.' : 'Physical commissioning has not been recorded.';
    $('.native-probe-result').textContent = snapshot.probeResult ? `${snapshot.probeResult.axis.toUpperCase()} ${snapshot.probeResult.position[snapshot.probeResult.axis].toFixed(4)} mm / repeatability ${snapshot.probeResult.repeatabilityMm.toFixed(4)} mm` : 'No measurement';
    commissioningControls.render(snapshot);
    workflowControls.render(snapshot);
    wiringControls.render(snapshot);
    onState(snapshot);
  };
  async function act(action, { interrupt = false, claim = true } = {}) {
    if (pendingActions && !interrupt) { message = 'A controller request is still pending. Stop and disconnect remain available.'; render(); return; }
    pendingActions++;
    try { if (claim) await link.session(); await action(); message = serviceStopped ? 'Local service closed. Use the Windows launcher to reopen MR1.' : 'Request accepted. Check the displayed operation state.'; }
    catch (error) { message = error.message; }
    finally { pendingActions--; }
    if (!serviceStopped) try { await link.refresh(); } catch (error) { message = error.message; }
    render();
  }
  async function refreshPorts() {
    const ports = await request('/api/ports');
    const selected = $('#native-port').value;
    $('#native-port').replaceChildren(new Option(ports.length ? 'Select the Octopus port' : 'No USB serial ports detected', ''));
    for (const port of ports) $('#native-port').add(new Option(`${port.path}${port.manufacturer ? ' · ' + port.manufacturer : ''}`, port.path));
    $('#native-port').value = selected;
    render();
  }
  button.addEventListener('click', () => { panel.hidden = !panel.hidden; if (!panel.hidden) void refreshPorts().catch(error => { message = error.message; render(); }); });
  $('[data-close]').onclick = () => { panel.hidden = true; };
  $('[data-refresh]').onclick = () => act(refreshPorts);
  $('[data-connect]').onclick = () => act(async () => { await request('/api/connect', { port: $('#native-port').value }); connectTelemetry(); });
  $('#native-port').onchange = render;
  $('[data-disconnect]').onclick = () => act(() => request('/api/disconnect', {}), { interrupt: true });
  async function sendCommand(action) {
    if (action === 'run') {
      const source = getReviewedSource?.();
      if (typeof source !== 'string') throw new Error('Load and review the program before running.');
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(source));
      const sha256 = [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
      if (sha256 !== snapshot?.program?.sha256) throw new Error('The preview changed. Reload the reviewed program in Machine Control before running.');
    }
    return request('/api/command', { action, axis: action === 'home' ? $('#native-home-axis').value : undefined, confirmed: $('#native-clear').checked, sha256: snapshot?.program?.sha256 });
  }
  const command = action => act(() => sendCommand(action), { interrupt: energyRemoving.includes(action), claim: !energyRemoving.includes(action) });
  for (const control of panel.querySelectorAll('[data-command]')) control.onclick = () => command(control.dataset.command);
  $('[data-recovery]').onclick = () => act(() => request('/api/recovery', { confirmed: $('#native-recovery-confirm').checked, reconciliationId: snapshot?.reconciliation?.reconciliationId }));
  $('[data-shutdown]').onclick = () => act(async () => {
    await request('/api/shutdown', {}); serviceStopped = true; link.close();
    clearInterval(timer); heartbeatWorker?.terminate();
  });
  $('#native-qualification').onchange = () => act(async () => {
    const file = $('#native-qualification').files[0]; if (!file) return;
    if (file.size > 2 * 1024 * 1024) throw new Error('Commissioning record exceeds 2 MB.');
    await request('/api/qualification', { bundle: await file.text() });
  });
  for (const control of panel.querySelectorAll('[data-jog]')) control.onclick = () => act(() => request('/api/command', { action: 'jog', axis: control.dataset.jog, distance: Number($('#native-step').value) * Number(control.dataset.sign), feed: Number($('#native-feed').value) }));
  for (const control of panel.querySelectorAll('[data-zero]')) control.onclick = () => act(() => request('/api/command', { action: 'zero', axis: control.dataset.zero, wcs: $('#native-wcs').value }));
  for (const control of panel.querySelectorAll('[data-outputs]')) control.onclick = () => act(() => request('/api/command', { action: 'outputs', spindle: control.dataset.outputs, rpm: control.dataset.outputs === 'off' ? 0 : Number($('#native-rpm').value), coolant: control.dataset.outputs === 'off' ? 'off' : $('#native-coolant').value }));
  $('[data-probe]').onclick = () => act(() => request('/api/command', { action: 'probe', axis: $('#native-probe-axis').value.toLowerCase(), sensor: Number($('#native-probe-input').value), distance: Number($('#native-probe-distance').value), confirmedSpindleStopped: $('#native-probe-clear').checked }));
  $('#native-file').onchange = () => act(async () => {
    const file = $('#native-file').files[0]; if (!file) return;
    if (file.size > 5 * 1024 * 1024) throw new Error('Program exceeds 5 MB.');
    const source = await file.text();
    const reviewed = await loadPreview(source, file.name);
    await request('/api/program', { source: reviewed, name: file.name, airRun: $('#native-air-run').checked });
  });
  // A held jog is never generated here: each click is one bounded increment.
  // A lost operator heartbeat stops/disarms on the server, including tab closure.
  // The worker keeps the lease while this page is hidden; the page poll refreshes
  // state and remains the heartbeat fallback.
  const timer = setInterval(() => { void link.poll(); }, 1000);
  window.addEventListener('beforeunload', () => { clearInterval(timer); link.close(); heartbeatWorker?.terminate(); });
  void link.refresh().catch(() => {});
  void refreshPorts().catch(error => { message = error.message; render(); });
  connectTelemetry();
  return {
    reviewWorkflow: intent => { panel.hidden = false; workflowControls.review(intent); },
    command,
    runOrResume: () => command(snapshot?.status?.state?.name === 'Hold' ? 'resume' : 'run'),
  };
}
