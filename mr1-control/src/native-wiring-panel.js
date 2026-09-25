const INPUTS = [
  ['X limit', 'STOP0 / PG6', 'limits', 'x'],
  ['Y limit (logical Y)', 'STOP1 PG9 / STOP3 PG11', 'limits', 'y'],
  ['Z limit', 'STOP2 / PG10', 'limits', 'z'],
  ['E-stop monitor', 'TB / PF3', 'controls', 'eStop'],
  ['Door monitor', 'PWR-DET / PC0', 'controls', 'safetyDoor'],
  ['Feed hold', 'T0 / PF4', 'controls', 'feedHold'],
  ['Cycle start', 'EXP2 / PB2', 'controls', 'cycleStart'],
  ['Aggregate drive fault', 'EXP2 / PB1', 'controls', 'motorFault'],
];

/** A report display, never an electrical acceptance or commissioning decision. */
export function wiringDiagnostic(snapshot, now = Date.now()) {
  const status = snapshot?.status;
  const ageMs = status ? now - Date.parse(status.receivedAt) : NaN;
  const verified = (id, value) => snapshot?.preflight?.settings?.some(s => s.id === id && s.status === 'PASS' && s.actual === value);
  const valid = Boolean(snapshot?.connected && status?.raw && ageMs >= 0 && ageMs < 1500
    && verified(10, 511) && verified(13, 0) && status.pins?.controls && status.pins?.limits
    && ['x','y','z'].every(axis => Number.isFinite(status.position?.machine?.[axis]))
    && Number.isFinite(status.motion?.feed) && Number.isFinite(status.motion?.spindleCommand));
  const inputs = INPUTS.map(([label, connector, group, key]) => ({ label, connector,
    value: valid ? status.pins[group][key] === true ? 'ACTIVE' : 'INACTIVE' : 'UNKNOWN' }));
  const probe = valid && [0,1].includes(status.activeProbe) ? status.activeProbe : null;
  inputs.push({ label: probe === 0 ? 'Selected touch probe' : probe === 1 ? 'Selected tool setter' : 'Selected probe input',
    connector: probe === 0 ? 'T1 / PF5' : probe === 1 ? 'PB7 tool-setter input' : 'Selection unknown',
    value: probe === null ? 'UNKNOWN' : status.pins.controls.probeTriggered === true ? 'ACTIVE' : 'INACTIVE' });
  return { valid, ageMs: Number.isFinite(ageMs) ? ageMs : null, inputs,
    staticCaptureAllowed: valid && !snapshot.armed && !snapshot.busy && !snapshot.fault && ['Idle','Alarm','Door'].includes(status.state?.name),
    report: valid ? status.raw : null,
    explanation: valid ? 'Controller-reported logical state. INACTIVE does not prove electrical health or safe wiring.'
      : 'UNKNOWN: connect read-only and obtain a fresh, complete report with verified $10=511 and $13=0.' };
}

export function mountNativeWiringControls({ root, getSnapshot }) {
  const section = document.createElement('details');
  section.dataset.nativeWiring = '';
  section.innerHTML = `<summary>Read-only wiring diagnostics</summary>
    <p><a href="/wiring/visual/index.html#octopus" target="_blank" rel="noopener">Open visual Octopus schematic</a></p>
    <p class="native-note">Keep motion and spindle power isolated during static input checks. This panel sends no controller commands and never marks commissioning checks as passed.</p>
    <p data-wiring-state></p><table class="native-input-table"><thead><tr><th>Input / board reference</th><th>Logical report</th></tr></thead><tbody></tbody></table>
    <p class="native-note">Y is a combined logical indication, not independent proof of Y-left and Y-right. PG12–PG15 individual drive-fault pins are not read by the current firmware, so no per-drive state exists in this status stream. PB1 is the aggregate fault. Only the selected probe is shown.</p>
    <details><summary>Exact status frame</summary><pre data-wiring-raw>No valid report</pre></details>
    <label>Observation label<input data-wiring-label maxlength="120" placeholder="For example: X home switch held triggered"></label>
    <div class="native-row"><button type="button" data-wiring-capture>Capture displayed report</button><button type="button" data-wiring-download>Download observations</button></div>
    <p class="native-note" data-wiring-count>No observations captured. Labels are operator notes, not measured voltage or a passing result.</p>`;
  root.append(section);
  const $ = selector => section.querySelector(selector);
  const observations = [];
  function render(snapshot = getSnapshot()) {
    const view = wiringDiagnostic(snapshot);
    $('[data-wiring-state]').textContent = view.explanation;
    $('tbody').replaceChildren(...view.inputs.map(input => {
      const row = document.createElement('tr'), name = document.createElement('td'), state = document.createElement('td');
      name.textContent = `${input.label}\n${input.connector}`; state.textContent = input.value;
      row.append(name, state); return row;
    }));
    $('[data-wiring-raw]').textContent = view.report ?? 'No valid report';
    $('[data-wiring-capture]').disabled = !view.staticCaptureAllowed || !$('[data-wiring-label]').value.trim() || observations.length >= 200;
    $('[data-wiring-download]').disabled = observations.length === 0;
  }
  $('[data-wiring-label]').addEventListener('input', () => render());
  $('[data-wiring-capture]').addEventListener('click', () => {
    const snapshot = getSnapshot(), view = wiringDiagnostic(snapshot), label = $('[data-wiring-label]').value.trim();
    if (!view.staticCaptureAllowed || !label || observations.length >= 200) return;
    observations.push({ observedAt: new Date().toISOString(), label, controllerReceivedAt: snapshot.status.receivedAt,
      sequence: snapshot.status.sequence, port: snapshot.port, rawStatus: view.report, inputs: view.inputs,
      configurationFingerprint: snapshot.preflight.commissioningBaselineFingerprint ?? snapshot.preflight.configurationFingerprint ?? null });
    $('[data-wiring-count]').textContent = `${observations.length} observations captured in this page. Download before closing. These are logical reports and operator notes, not electrical measurements or commissioning approval.`;
    $('[data-wiring-label]').value = ''; render(snapshot);
  });
  $('[data-wiring-download]').addEventListener('click', () => {
    if (!observations.length) return;
    const content = { protocol: 'mr1-wiring-observations-v1', qualificationGranted: false,
      limitations: 'Logical status only; no voltage, independent dual-Y, per-axis fault or unselected probe proof.', observations };
    const url = URL.createObjectURL(new Blob([JSON.stringify(content, null, 2) + '\n'], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = 'mr1-wiring-observations.json'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  render(); return { render };
}
