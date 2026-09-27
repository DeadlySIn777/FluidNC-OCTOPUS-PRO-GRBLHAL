export const PREPARATION_STEPS = ['identified', 'labelled', 'routeChecked'];
export const RECORD_SCHEMA = 'mr1-wiring-preparation-v2';

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
}

export function visibleCables(cables, {axis = 'all', family = 'all', search = '', archived = false, cableIds = null} = {}) {
  const needle = search.trim().toLowerCase();
  return cables.filter(cable => (archived || cable.active_by_default)
    && (cableIds === null || cableIds.includes(cable.cable_id))
    && (axis === 'all' || cable.axis === axis)
    && (family === 'all' || cable.family === family)
    && (!needle || [cable.cable_id, cable.from_device, cable.from_terminal, cable.to_device, cable.to_terminal,
      cable.family, cable.axis, cable.notes].join(' ').toLowerCase().includes(needle)));
}

export function normalizePreparation(candidate, cableIds, expectedSourceHash) {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate) || candidate.schema !== RECORD_SCHEMA) {
    throw new Error('This file is not an MR1 wiring preparation record.');
  }
  if (expectedSourceHash !== undefined && candidate.sourceScheduleSha256 !== expectedSourceHash) {
    throw new Error('This record belongs to a different or unidentified cable schedule. Keep it as reference and check these cable ends again.');
  }
  if (!candidate.records || typeof candidate.records !== 'object' || Array.isArray(candidate.records)) throw new Error('Missing cable records.');
  const records = Object.create(null);
  for (const id of cableIds) {
    if (!Object.hasOwn(candidate.records, id)) continue;
    const value = candidate.records[id];
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Invalid record for ${id}.`);
    records[id] = { notes: typeof value.notes === 'string' ? value.notes.slice(0, 4000) : '' };
    for (const key of PREPARATION_STEPS) records[id][key] = value[key] === true;
  }
  return {schema: RECORD_SCHEMA, sourceScheduleSha256: expectedSourceHash ?? candidate.sourceScheduleSha256,
    scope: 'unpowered-cable-preparation-only', hardwareApproved: false, records};
}

export function newPreparation(sourceScheduleSha256) {
  return {schema: RECORD_SCHEMA, sourceScheduleSha256, scope: 'unpowered-cable-preparation-only', hardwareApproved: false, records: Object.create(null)};
}

export function preparationProgress(record, cables) {
  const active = cables.filter(cable => cable.active_by_default);
  return {total: active.length, prepared: active.filter(cable => PREPARATION_STEPS.every(key => record.records[cable.cable_id]?.[key] === true)).length};
}

export function routesForCable(routes, cable) {
  return routes.filter(route => route.matchCableIds?.includes(cable.cable_id) || route.cableLabel === cable.cable_id);
}

export function nextCable(cables, selectedId, direction = 1) {
  if (!cables.length) return null;
  const current = cables.findIndex(cable => cable.cable_id === selectedId);
  return cables[Math.min(cables.length - 1, Math.max(0, current < 0 ? 0 : current + direction))].cable_id;
}

export function connectionLabels(wire) {
  return {from: wire.direction === 'to-from' ? `${wire.from} (fed by drive)` : wire.from,
    to: wire.direction === 'to-from' ? `${wire.to} · POWER OUTPUT TO ENCODER`
      : wire.direction === 'return' ? `${wire.to} · ENCODER RETURN` : wire.to};
}

export function wireInstruction(route, requestedIndex = 0) {
  const wires = route.connections ?? [];
  if (!wires.length) return null;
  const index = Number.isInteger(requestedIndex) ? Math.max(0, Math.min(wires.length - 1, requestedIndex)) : 0;
  const labels = connectionLabels(wires[index]);
  return {index, total:wires.length,
    endA:{device:route.from.label, terminal:labels.from},
    endB:{device:route.to.label, terminal:labels.to},
    physicalCavityMapKnown:false};
}

export function endpointNotice(endpoint) {
  if (endpoint.status === 'community-reference') return 'Unverified community reference — do not land wires from these numbers.';
  if (endpoint.status === 'unresolved') return 'Terminal identity unresolved — record the actual part and circuit first.';
  if (endpoint.status === 'reference-only') return 'Reference functions only — actual type, pinout and mating view still need verification.';
  return endpoint.planned || endpoint.status === 'planned-interface'
    ? 'Planned interface names · actual terminals pending' : 'Match printed names · mating view still unverified';
}

export function boardContext(route) {
  const boardEndpoint = [route.from, route.to].find(endpoint => endpoint.node === 'octopus' || /Octopus/i.test(endpoint.label));
  if (boardEndpoint) return `${boardEndpoint.label} · ${boardEndpoint.terminals.join(' / ')}. Match this cable’s header, not an adjacent one.`;
  if (route.upstream) return `Upstream context only: ${route.upstream.label} · STEP ${route.upstream.step} · DIR ${route.upstream.direction}. This cable itself runs between the interface and drive.`;
  return `This cable has no direct Octopus termination: ${route.from.label} ↔ ${route.to.label}.`;
}

export function boardGroupForCable(groups, cableId) {
  return groups.find(group=>group.rows.some(row=>row.cableIds?.includes(cableId)))
    ?? groups.find(group=>group.rows.some(row=>row.relatedCableIds?.includes(cableId)))
    ?? groups.find(group=>group.id==='off-board')
    ?? null;
}

export function boardRegionsForGroup(regions, groupId) {
  return regions.filter(region=>region.groups.includes(groupId));
}

export function connectorGroupsForMode(groups, mode = 'all') {
  const modes = {
    motor: ['cl57t-p3', 'motor-option-a', 'motor-option-b'],
    encoder: ['encoder-db15', 'cl57t-p2'],
    command: ['cl57t-p1'],
    power: ['cl57t-p4'],
    home: ['stock-mr1-homes', 'custom-independent-homes'],
    tuning: ['cl57t-p5'],
  };
  if (mode === 'all') return [...groups];
  return (Object.hasOwn(modes, mode) ? modes[mode] : []).map(id => groups.find(group => group.id === id)).filter(Boolean);
}

// Read current notes independently from the retained legacy record. No earlier ticks migrate.
export function loadPreparationRecords(currentText, legacyText, cableIds, scheduleHash) {
  let legacy = null, previousRecordText = null;
  if (legacyText) {
    try { legacy = JSON.parse(legacyText); } catch { previousRecordText = legacyText; }
    if (legacy && legacy.sourceScheduleSha256 !== scheduleHash) previousRecordText = legacyText;
  }
  const candidate = currentText ? JSON.parse(currentText) : previousRecordText ? null : legacy;
  return { record: candidate ? normalizePreparation(candidate, cableIds, scheduleHash) : newPreparation(scheduleHash), previousRecordText };
}

export function wiringViewForHash(hash) {
  const views = {
    '': {view:'trace'}, '#trace': {view:'trace'}, '#cabinet': {view:'cabinet'}, '#octopus': {view:'board'},
    '#connectors': {view:'connectors', mode:'all'}, '#encoder': {view:'connectors', mode:'encoder'},
    '#motor': {view:'connectors', mode:'motor'}, '#endstops': {view:'connectors', mode:'home'},
    '#command': {view:'connectors', mode:'command'}, '#power': {view:'connectors', mode:'power'},
    '#tuning': {view:'connectors', mode:'tuning'}, '#named-alarms': {view:'trace', system:'alarms'},
  };
  return Object.hasOwn(views, hash) ? {...views[hash]} : null;
}

export function connectorReferenceMarkup(group, referenceSources, compact = false) {
  const h = escapeHtml;
  const sourceIds = new Set([...(group.sourceIds ?? []), ...group.rows.flatMap(row => row.sourceIds ?? [])]);
  const sources = referenceSources.filter(source => sourceIds.has(source.id));
  return `<article class="connector-card ${compact ? 'compact' : ''}"><p class="eyebrow">${h(group.status)}</p><h4>${h(group.title)}</h4><div class="connector-table-scroll"><table><caption>Reference names and numbered contacts; match the actual cable before connecting</caption><thead><tr><th scope="col">Connector / pin / terminal</th><th scope="col">Goes to / action</th><th scope="col">Published wire color</th></tr></thead><tbody>${group.rows.map(row => `<tr class="${/shield|drain/i.test(row.terminal) ? 'shield-row' : ''}"><th scope="row">${h(row.terminal)}</th><td>${h(row.destination)}${row.notes?.length ? '<ul class="connector-row-notes">'+row.notes.map(note => '<li>'+h(note)+'</li>').join('')+'</ul>' : ''}</td><td>${h(row.color ?? 'Not assigned by this reference')}</td></tr>`).join('')}</tbody></table></div><ul>${(group.notes ?? []).map(note => `<li>${h(note)}</li>`).join('')}</ul><p class="connector-sources">${sources.filter(source => /^https:\/\//.test(source.url)).map(source => `<a href="${h(source.url)}" target="_blank" rel="noopener noreferrer">${h(source.title)}</a>`).join(' · ')}</p></article>`;
}
