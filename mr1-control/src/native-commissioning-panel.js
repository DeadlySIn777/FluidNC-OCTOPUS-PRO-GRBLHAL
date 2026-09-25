const label = text => text.replace(/([A-Z])/g, ' $1').replace(/^./, c => c.toUpperCase());

export function mountCommissioningControls({ root, request, act, getSnapshot }) {
  const section = document.createElement('section');
  section.innerHTML = `<h3>Staged commissioning</h3>
    <p class="native-note">Import the evidence gathered so far. A stage grants only its bounded tests; it does not record a passing result or qualify production.</p>
    <label>Current evidence bundle<input data-evidence type="file" accept=".json"></label>
    <label>Stage<select data-stage></select></label>
    <p data-stage-status></p><p class="native-note" data-stage-limits></p>
    <label>Operator<input data-operator maxlength="100" autocomplete="name"></label>
    <div class="native-row" data-axes>${['x','y','z'].map(a => `<label class="native-confirm"><input type="checkbox" data-axis="${a}"${a === 'x' ? ' checked' : ''}>${a.toUpperCase()}</label>`).join('')}</div>
    <div data-attestations></div>
    <label class="native-confirm"><input type="checkbox" data-temporary> For uncoupled testing only: temporarily set homing startup lock $22 from 7 to 3, explicitly unlock, then restore 7 before coupled work. Unhomed axes have no firmware soft limits.</label>
    <div class="native-row"><button data-begin>Begin reviewed stage</button><button data-end>End stage</button></div>
    <p data-session-status>No commissioning stage active.</p>
    <label class="native-confirm"><input type="checkbox" data-restore-confirm> I have stopped and disconnected motion power, verified the correct controller, and reviewed the pending settings restoration</label>
    <button data-restore>Restore production homing lock</button><p data-recovery-status></p>`;
  root.prepend(section);
  const $ = s => section.querySelector(s);
  let definitions = [];
  let shownStage = null;
  function selected() { return definitions.find(d => d.id === $('[data-stage]').value); }
  function showDefinition() {
    const d = selected(); if (!d || shownStage === d.id) return;
    shownStage = d.id;
    const list = [...d.attestations, ...(d.id === 'uncoupled' ? ['bothYMotorsMechanicallyUncoupled'] : [])];
    $('[data-attestations]').replaceChildren(...list.map(key => {
      const l = document.createElement('label'); l.className = 'native-confirm';
      const check = document.createElement('input'); check.type = 'checkbox'; check.dataset.attestation = key;
      l.append(check, document.createTextNode(label(key))); return l;
    }));
    $('[data-stage-limits]').textContent = `${d.warning ?? ''}\n${d.limits.durationMs / 60000} minute session. ${d.capabilities.join(', ')}. Jog ceiling ${d.limits.jogDistanceMm} mm at ${d.limits.jogFeedMmPerMinute} mm/min.`;
    $('[data-temporary]').closest('label').hidden = d.id !== 'uncoupled';
  }
  function render(snapshot) {
    const state = snapshot?.commissioning; if (!state) return;
    definitions = state.definitions ?? [];
    if (!$('[data-stage]').options.length) for (const d of definitions) $('[data-stage]').add(new Option(d.title, d.id));
    showDefinition();
    const d = state.access?.stages.find(d => d.id === $('[data-stage]').value);
    $('[data-stage-status]').textContent = d ? (d.eligible ? 'Evidence prerequisites satisfied. Review the physical preparation below.'
      : `Missing evidence: ${d.missingChecks.map(c => c.title).join('; ')}${d.issues.length ? '\n' + d.issues.join('\n') : ''}`) : 'Connect and import the current evidence bundle to assess stage prerequisites.';
    $('[data-begin]').disabled = !snapshot.connected || snapshot.armed || snapshot.busy || !d?.eligible || Boolean(state.session) || state.recovery.required;
    $('[data-end]').disabled = !state.session || snapshot.busy;
    $('[data-session-status]').textContent = state.session ? `${state.session.stage.toUpperCase()} · expires ${new Date(state.session.expiresAt).toLocaleTimeString()} · ${state.session.remainingCommands} commands remaining · jog allowance X/Y/Z ${Object.values(state.session.remainingJogMm).join('/')} mm` : 'No commissioning stage active.';
    $('[data-recovery-status]').textContent = state.recovery.required ? (state.recovery.error ?? `Production settings restoration required. Transaction ${state.recovery.transactionId}. Reconnect after a fault, then restore before coupled operation.`) : 'No temporary settings restoration pending.';
    $('[data-restore]').disabled = !state.recovery.required || Boolean(state.recovery.error) || !snapshot.connected || snapshot.armed || snapshot.busy;
  }
  $('[data-stage]').onchange = () => render(getSnapshot());
  $('[data-evidence]').onchange = () => act(async () => {
    const file = $('[data-evidence]').files[0]; if (!file) return;
    if (file.size > 2 * 1024 * 1024) throw new Error('Evidence bundle exceeds 2 MB.');
    await request('/api/commissioning/evidence', { bundle: await file.text() });
  });
  $('[data-begin]').onclick = () => act(() => request('/api/commissioning/begin', {
    stage: selected()?.id, operator: $('[data-operator]').value,
    axes: [...section.querySelectorAll('[data-axis]:checked')].map(e => e.dataset.axis),
    attestations: Object.fromEntries([...section.querySelectorAll('[data-attestation]')].map(e => [e.dataset.attestation, e.checked])),
    confirmTemporaryHoming: $('[data-temporary]').checked, programSha256: getSnapshot()?.program?.sha256,
  }));
  $('[data-end]').onclick = () => act(() => request('/api/commissioning/end', {}));
  $('[data-restore]').onclick = () => act(() => request('/api/commissioning/restore', {
    confirmed: $('[data-restore-confirm]').checked, transactionId: getSnapshot()?.commissioning?.recovery.transactionId,
  }));
  return { render };
}
