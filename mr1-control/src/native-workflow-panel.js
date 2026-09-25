const copy = value => structuredClone(value);
const freeze = value => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};
const titles = { 'touch-probe': 'Protected touch probing', 'tool-setter': 'Measure tool at setter',
  'apply-work-offset': 'Apply fixture work offset', 'apply-tool-length': 'Apply measured tool length' };
const fixed = value => Number.isFinite(value) ? value.toFixed(3) : 'Unknown';
const xyz = value => ['x', 'y', 'z'].map(axis => `${axis.toUpperCase()} ${fixed(value?.[axis])}`).join(' · ');
const isWrite = intent => ['apply-work-offset', 'apply-tool-length'].includes(intent?.type);

function stepText(step) {
  if (step.kind === 'raise-z') return `Raise Z to ${fixed(step.z)} mm before travel.`;
  if (step.kind === 'clearance-xy') return `Move X ${fixed(step.x)}, Y ${fixed(step.y)} at clearance Z ${fixed(step.z)} mm.`;
  if (step.kind === 'guarded-approach') return `Guarded downward approach to ${xyz(step.target)} mm using ${step.sensor === 1 ? 'the tool setter' : 'the touch probe'}. Unexpected contact stops the operation.`;
  if (step.kind === 'two-touch') return `Measure ${step.label ?? step.id} twice along ${step.direction < 0 ? '−' : '+'}${step.axis?.toUpperCase()}. Expected contact: ${xyz(step.expectedCenter)} mm. Search limit: ${xyz(step.searchLimit)} mm. Retract: ${xyz(step.retract)} mm.`;
  if (step.kind === 'write-work-offset') return `Write ${step.wcs}: ${xyz(step.offset)} mm.`;
  if (step.kind === 'write-tool-length') return `Apply tool T${step.tool} dynamic length offset ${fixed(step.tloMm)} mm.`;
  if (step.kind === 'verify-offset-readback') return 'Read the fixture offset back from the controller and compare every axis.';
  if (step.kind === 'verify-tlo-readback') return 'Read the tool offset back and confirm dynamic length compensation is active.';
  return String(step.kind ?? 'Review operation');
}

/** UI review only. Serial authority and one-use plans remain on the native service. */
export function mountNativeWorkflowControls({ root, request, act, getSnapshot, onResult = () => {} }) {
  const section = document.createElement('details');
  section.dataset.nativeWorkflows = '';
  section.innerHTML = `<summary>Protected probing & fixture offsets</summary>
    <p class="native-note">Choose a probe, setter or fixture operation in the setup screens to review it here. Planning does not move the machine.</p>
    <p data-workflow-title>No operation selected</p>
    <details><summary>Selected operation details</summary><pre data-workflow-intent>No operation selected</pre></details>
    <label>Physical setup evidence file<input data-workflow-artifact type="file" accept=".pdf,.json,.txt,.md,.jpg,.jpeg,.png,.webp"></label>
    <p class="native-note">Select your actual setup photograph, drawing or inspection record. Its fingerprint identifies the reviewed file; it does not prove clearance. The file stays on this PC.</p>
    <p class="native-program" data-workflow-artifact-info>No physical setup artifact selected</p>
    <label>Physical setup identifier<input data-workflow-setup type="text" minlength="3" maxlength="160" placeholder="For example: plate A, vise 2, setup 1"></label>
    <label class="native-confirm"><input data-workflow-reviewed type="checkbox"> I reviewed this physical setup artifact against the machine, stock and clamps</label>
    <label class="native-confirm"><input data-workflow-stopped type="checkbox"> I verified the spindle is physically stopped and coolant is off</label>
    <label class="native-confirm" data-workflow-route-row><input data-workflow-route type="checkbox"> I verified the complete Z clearance, XY travel, approach and retract route</label>
    <label class="native-confirm" data-workflow-write-row hidden><input data-workflow-write type="checkbox"> I approve writing the displayed offset to the controller</label>
    <div data-workflow-reference-row hidden>
      <label>Reference tool's calibrated TLO, mm<input data-workflow-reference type="number" min="-200" max="200" step="0.001" placeholder="Enter the measured reference value"></label>
      <label class="native-confirm"><input data-workflow-reference-confirm type="checkbox"> I verified this reference TLO uses the same calibrated setter and coordinate convention</label>
    </div>
    <div class="native-row"><button type="button" data-workflow-plan>Build review plan</button><button type="button" data-workflow-execute>Execute reviewed plan</button></div>
    <p class="native-note" data-workflow-availability>Connect, qualify, arm and home the controller before building a plan.</p>
    <div data-workflow-plan-display hidden>
      <p class="native-program" data-workflow-fingerprint></p>
      <p data-workflow-expiry></p><p data-workflow-start></p>
      <ol data-workflow-steps></ol>
      <p class="native-note">All positions above are machine coordinates in millimetres. Unexpected contact, missing feedback or a failed check stops the operation without an automatic recovery move.</p>
      <details><summary>Complete reviewed plan</summary><pre data-workflow-plan-json></pre></details>
    </div>
    <p class="native-message" data-workflow-message role="status">Select an operation to begin.</p>
    <div data-workflow-result-display hidden>
      <h3>Last workflow result</h3><p class="native-program" data-workflow-result-summary></p>
      <details><summary>Measurement and controller readback</summary><pre data-workflow-result-json></pre></details>
      <button type="button" data-workflow-download>Download result JSON</button>
      <div data-workflow-setter-result hidden>
        <p class="native-note">A setter measurement does not apply tool length. Applying it requires the same physical setup artifact and a separately reviewed reference TLO.</p>
        <button type="button" data-workflow-review-tlo>Review tool-length application</button>
      </div>
    </div>`;
  root.append(section);
  const $ = selector => section.querySelector(selector);
  let candidate = null, artifact = null, reviewedAt = null, plan = null, latestResult = null;
  let pending = false, revision = 0, evidenceRevision = 0, expiryTimer = null, snapshot = getSnapshot?.() ?? null;
  let message = 'Select an operation to begin.';

  const resetConfirmations = () => {
    for (const checkbox of section.querySelectorAll('input[type="checkbox"]')) checkbox.checked = false;
    reviewedAt = null;
  };
  function invalidate(reason = 'The operation or evidence changed. Build and review a new plan.') {
    revision++; plan = null; clearTimeout(expiryTimer); expiryTimer = null;
    $('[data-workflow-plan-display]').hidden = true;
    message = reason;
  }
  function evidenceMatches(result = latestResult) {
    return artifact && result?.geometry && artifact.sha256 === result.geometry.sourceSha256.toLowerCase()
      && $('[data-workflow-setup]').value.trim() === result.geometry.setupId;
  }
  function ready() {
    const state = snapshot ?? getSnapshot?.();
    const session = state?.commissioning?.session;
    const capable = state?.motionQualified || (session?.active && session.capabilities?.includes('workflow'));
    return Boolean(state?.connected && state.armed && !state.busy && !state.fault && capable
      && state.status?.state?.name === 'Idle' && state.status.homing?.complete === true);
  }
  function confirmed() {
    return Boolean(candidate && artifact && reviewedAt && $('[data-workflow-setup]').value.trim().length >= 3
      && $('[data-workflow-reviewed]').checked && $('[data-workflow-stopped]').checked
      && (isWrite(candidate) ? $('[data-workflow-write]').checked : $('[data-workflow-route]').checked)
      && (candidate.type !== 'apply-tool-length' || ($('[data-workflow-reference-confirm]').checked
        && $('[data-workflow-reference]').value.trim() !== '' && Number.isFinite(Number($('[data-workflow-reference]').value)))));
  }
  function currentRequest() {
    if (!confirmed()) throw new Error('Complete the physical setup evidence and each displayed confirmation.');
    const input = copy(candidate);
    input.geometry = { setupId: $('[data-workflow-setup]').value.trim(), sourceSha256: artifact.sha256, reviewedAt };
    input.confirmations = { spindleStopped: $('[data-workflow-stopped]').checked,
      routeClear: $('[data-workflow-route]').checked, offsetWrite: $('[data-workflow-write]').checked };
    if (candidate.type === 'apply-tool-length') {
      input.referenceTloMm = Number($('[data-workflow-reference]').value);
      input.confirmedReferenceTlo = $('[data-workflow-reference-confirm]').checked;
    }
    return input;
  }
  function showPlan(value) {
    $('[data-workflow-fingerprint]').textContent = `Plan SHA-256\n${value.planSha256}`;
    $('[data-workflow-start]').textContent = `Starting machine position: ${xyz(value.start)} mm · Tool ${value.identity?.tool ?? 'unknown'}`;
    $('[data-workflow-plan-json]').textContent = JSON.stringify(value, null, 2);
    const items = value.steps.map(step => { const item = document.createElement('li'); item.textContent = stepText(step); return item; });
    $('[data-workflow-steps]').replaceChildren(...items);
    $('[data-workflow-plan-display]').hidden = false;
    clearTimeout(expiryTimer);
    expiryTimer = setTimeout(() => render(), Math.max(0, Date.parse(value.expiresAt) - Date.now()) + 10);
  }
  function showResult(value) {
    latestResult = copy(value);
    $('[data-workflow-result-display]').hidden = false;
    $('[data-workflow-result-json]').textContent = JSON.stringify(value, null, 2);
    const at = Number.isFinite(value.at) ? new Date(value.at).toLocaleString() : 'Time unavailable';
    let summary = `${titles[value.type] ?? 'Protected workflow'} · ${at}\nResult ${value.resultId}`;
    if (value.type === 'tool-setter') summary += `\nTool T${value.tool} · measured gauge length ${fixed(value.measuredGaugeLength)} mm\nTool length has not been applied.`;
    if (value.type === 'touch-probe') summary += `\n${value.measurements?.length ?? 0} measured contacts · work offset has not been applied.`;
    if (value.type === 'apply-work-offset') summary += `\n${value.wcs}: ${xyz(value.offset)} mm · controller readback verified`;
    if (value.type === 'apply-tool-length') summary += `\nTool T${value.tool}: TLO ${fixed(value.tloMm)} mm · controller readback verified`;
    $('[data-workflow-result-summary]').textContent = summary;
  }
  function render(next = getSnapshot?.() ?? snapshot) {
    snapshot = next ?? snapshot;
    if (snapshot?.workflowResult?.resultId && snapshot.workflowResult.resultId !== latestResult?.resultId
      && (!latestResult || snapshot.workflowResult.at > latestResult.at)) showResult(snapshot.workflowResult);
    const canOperate = ready();
    if (plan && snapshot && (!snapshot.connected || !snapshot.armed || snapshot.fault || snapshot.busy
      || snapshot.preflight?.transcriptSha256 !== plan.identity?.preflight
      || ['x', 'y', 'z'].some(axis => !Number.isFinite(snapshot.status?.position?.machine?.[axis])
        || Math.abs(snapshot.status.position.machine[axis] - plan.start[axis]) > 0.01))) {
      invalidate('Controller state or starting position changed. Build and review a new plan.');
    }
    const expires = plan ? Date.parse(plan.expiresAt) : 0;
    const remaining = Math.max(0, Math.ceil((expires - Date.now()) / 1000));
    if (plan) $('[data-workflow-expiry]').textContent = remaining > 0 ? `Plan expires in ${remaining} seconds. Review every step before execution.` : 'Plan expired. Build and review a new plan.';
    $('[data-workflow-plan]').disabled = pending || !canOperate || !confirmed();
    $('[data-workflow-execute]').disabled = pending || !canOperate || !confirmed() || !plan || remaining === 0;
    $('[data-workflow-availability]').textContent = canOperate
      ? 'Controller is armed, homed and idle. The reviewed plan expires after 60 seconds.'
      : 'A connected, homed, armed controller with a probing or cut-trial capability is required. Measurements and offsets remain reviewable while offline.';
    $('[data-workflow-title]').textContent = candidate ? titles[candidate.type] ?? 'Protected operation' : 'No operation selected';
    $('[data-workflow-route-row]').hidden = isWrite(candidate);
    $('[data-workflow-write-row]').hidden = !isWrite(candidate);
    $('[data-workflow-reference-row]').hidden = candidate?.type !== 'apply-tool-length';
    $('[data-workflow-setter-result]').hidden = latestResult?.type !== 'tool-setter';
    $('[data-workflow-review-tlo]').disabled = pending || latestResult?.type !== 'tool-setter' || !evidenceMatches();
    $('[data-workflow-message]').textContent = message;
  }
  function review(intent) {
    candidate = freeze(copy(intent));
    invalidate('Review the selected operation, physical setup artifact and confirmations. No machine action has been requested.');
    resetConfirmations();
    if (candidate.type === 'apply-tool-length') $('[data-workflow-reference]').value = Number.isFinite(candidate.referenceTloMm) ? String(candidate.referenceTloMm) : '';
    else $('[data-workflow-reference]').value = '';
    $('[data-workflow-intent]').textContent = JSON.stringify(candidate, null, 2);
    section.open = true;
    render();
    section.scrollIntoView({ block: 'nearest' });
  }
  function run(operation) {
    if (pending) return;
    pending = true; render();
    void (async () => {
      try {
        await act(async () => {
          try { await operation(); }
          catch (error) { message = error?.message || 'The workflow request failed.'; throw error; }
        });
      } catch (error) { message = error?.message || 'The workflow request failed.'; }
      finally { pending = false; render(); }
    })();
  }

  $('[data-workflow-artifact]').addEventListener('change', async event => {
    const stamp = ++evidenceRevision;
    const file = event.currentTarget.files?.[0]; artifact = null;
    invalidate('Review the newly selected physical setup evidence.'); resetConfirmations();
    $('[data-workflow-artifact-info]').textContent = file ? `Reading ${file.name}…` : 'No physical setup artifact selected';
    render();
    if (!file) return;
    try {
      if (file.size === 0 || file.size > 25 * 1024 * 1024) throw new Error('Select a physical setup artifact between 1 byte and 25 MB.');
      if (!globalThis.crypto?.subtle) throw new Error('Secure file fingerprinting is unavailable. Reopen the local controller page.');
      const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
      if (stamp !== evidenceRevision) return;
      artifact = { name: file.name, size: file.size, sha256: [...new Uint8Array(digest)].map(n => n.toString(16).padStart(2, '0')).join('') };
      $('[data-workflow-artifact-info]').textContent = `${artifact.name} · ${artifact.size.toLocaleString()} bytes\nSHA-256 ${artifact.sha256}`;
    } catch (error) {
      if (stamp !== evidenceRevision) return;
      message = error.message; $('[data-workflow-artifact-info]').textContent = 'No physical setup artifact selected';
    }
    render();
  });
  $('[data-workflow-setup]').addEventListener('input', () => {
    invalidate(); $('[data-workflow-reviewed]').checked = false; reviewedAt = null; render();
  });
  for (const input of section.querySelectorAll('input[type="checkbox"], [data-workflow-reference]')) input.addEventListener('input', () => {
    invalidate();
    if (input.matches('[data-workflow-reviewed]')) reviewedAt = input.checked ? new Date().toISOString() : null;
    render();
  });
  $('[data-workflow-plan]').addEventListener('click', () => run(async () => {
    if (!ready()) throw new Error('The controller must be armed, homed and idle with permission for this workflow.');
    const input = currentRequest();
    invalidate('Building the review plan. No motion has been requested.');
    const stamp = revision;
    const result = await request('/api/workflow/plan', input);
    if (stamp !== revision) { message = 'Inputs changed while the plan was being built. Review a new plan.'; return; }
    if (!result?.planId || !result.planSha256 || !Array.isArray(result.steps)) throw new Error('The controller service returned an incomplete review plan.');
    plan = freeze(copy(result)); showPlan(plan);
    message = 'Review the starting position, fingerprint and every step. Execute is a separate action.';
  }));
  $('[data-workflow-execute]').addEventListener('click', () => run(async () => {
    if (!ready() || !confirmed() || !plan || Date.parse(plan.expiresAt) <= Date.now()) throw new Error('The reviewed plan is unavailable or expired. Build a new plan.');
    const payload = { planId: plan.planId, planSha256: plan.planSha256 };
    plan = null; clearTimeout(expiryTimer); expiryTimer = null;
    $('[data-workflow-expiry]').textContent = 'Plan submitted once. Waiting for the controller result.';
    message = 'Protected workflow is running. Hold and Stop remain available in Machine Control.';
    render();
    const result = await request('/api/workflow/execute', payload);
    showResult(result); resetConfirmations();
    message = result.type === 'tool-setter' || result.type === 'touch-probe'
      ? 'Measurement completed. Review the result before applying any offset.' : 'Offset applied and controller readback verified.';
    onResult(copy(result));
  }));
  $('[data-workflow-review-tlo]').addEventListener('click', () => {
    if (!latestResult || latestResult.type !== 'tool-setter' || !evidenceMatches()) return;
    review({ type: 'apply-tool-length', resultId: latestResult.resultId, tool: latestResult.tool });
  });
  $('[data-workflow-download]').addEventListener('click', () => {
    if (!latestResult) return;
    const blob = new Blob([JSON.stringify(latestResult, null, 2) + '\n'], { type: 'application/json' });
    const url = URL.createObjectURL(blob), link = document.createElement('a');
    link.href = url; link.download = `mr1-workflow-${String(latestResult.resultId).replace(/[^a-zA-Z0-9_-]/g, '')}.json`;
    link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  render();
  return { render, review };
}
