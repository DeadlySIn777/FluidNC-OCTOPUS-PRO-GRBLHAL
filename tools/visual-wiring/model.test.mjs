import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  PREPARATION_STEPS, RECORD_SCHEMA, escapeHtml, visibleCables,
  normalizePreparation, newPreparation, preparationProgress, routesForCable, nextCable,
  connectionLabels, endpointNotice, boardContext, wireInstruction,
  boardGroupForCable, boardRegionsForGroup,
} from './model.mjs';

const readJson = name => JSON.parse(readFileSync(new URL(name, import.meta.url), 'utf8'));
const data = readJson('./cable-data.json');
const content = readJson('./route-content.json');
const coverage = readJson('./coverage.json');
const boardContent = readJson('./board-content.json');
const boardRegions = readJson('./board-regions.json');
const cables = data.cables;
const cableIds = cables.map(cable => cable.cable_id);
const hash = data.source.csv.sha256;
const ids = rows => rows.map(row => row.cable_id);
const complete = () => ({identified:true, labelled:true, routeChecked:true, notes:''});
const recordFile = (records = {}, extra = {}) => ({schema:RECORD_SCHEMA, records, ...extra});

test('default list retains all 44 active cables in source order and excludes every reserved/rollback cable', () => {
  assert.equal(cables.length, 56);
  assert.equal(new Set(cableIds).size, 56);
  const active = visibleCables(cables);
  assert.equal(active.length, 44);
  assert.deepEqual(ids(active), data.active_ids);
  assert.deepEqual([...new Set(active.map(cable => cable.disposition))].sort(), ['hold', 'trace-only']);
  assert.equal(active.filter(cable => cable.disposition === 'hold').length, 22);
  assert.equal(active.filter(cable => cable.disposition === 'trace-only').length, 22);
  assert.equal(cables.filter(cable => cable.disposition === 'reserved').length, 8);
  assert.equal(cables.filter(cable => cable.disposition === 'rollback').length, 4);
  assert.deepEqual(ids(visibleCables(cables, {archived:true})), cableIds);
  assert.deepEqual(visibleCables(cables, {search:'DM860T'}), []);
  assert.equal(visibleCables(cables, {search:'DM860T', archived:true}).length, 4);
  assert.deepEqual(visibleCables(cables, {search:'SP-ORIENT'}), []);
  assert.deepEqual(ids(visibleCables(cables, {search:'SP-ORIENT', archived:true})), ['SP-ORIENT']);
});

test('axis/family filters keep Y-left and Y-right distinct and compose with trimmed case-insensitive search', () => {
  for (const axis of ['X', 'YL', 'Z', 'YR']) {
    const expected = [`PWR-36-${axis}`, `CMD-${axis}`, `MOT-${axis}`, `ENC-${axis}`, `ALM-${axis}`, `HOME-FIELD-${axis}`, `HOME-LOGIC-${axis}`];
    assert.deepEqual(ids(visibleCables(cables, {axis})), expected);
    assert.equal(visibleCables(cables, {axis, archived:true}).length, 8);
    assert.deepEqual(ids(visibleCables(cables, {axis, family:'encoder'})), [`ENC-${axis}`]);
  }
  assert.equal(visibleCables(cables, {axis:'shared'}).length, 16);
  assert.equal(visibleCables(cables, {axis:'shared', archived:true}).length, 24);
  assert.deepEqual(ids(visibleCables(cables, {axis:'YR', family:'home', search:'  home-logic-yR \n'})), ['HOME-LOGIC-YR']);
  assert.deepEqual(visibleCables(cables, {axis:'YL', search:'CMD-YR'}), []);
  assert.deepEqual(visibleCables(cables, {family:'not-a-family'}), []);
  assert.deepEqual(visibleCables(cables, {axis:'not-an-axis'}), []);
  assert.deepEqual(ids(visibleCables(cables, {search:'  pb1  '})), ['ALM-X', 'ALM-YL', 'ALM-Z', 'ALM-YR', 'FAULT-AGG']);
  assert.deepEqual(ids(visibleCables(cables, {axis:'shared', search:'  pb1  '})), ['FAULT-AGG']);
  assert.deepEqual(ids(visibleCables(cables, {search:' \t '})), data.active_ids);
});

test('search reaches each named endpoint and source note without changing the cable data', () => {
  const fixture = [{cable_id:'one', axis:'shared', family:'other', active_by_default:true,
    from_device:'DistinctSender', from_terminal:'StartTerminal', to_device:'DistinctReceiver',
    to_terminal:'EndTerminal', notes:'RecordedSourceNote'}];
  const before = structuredClone(fixture);
  for (const search of ['distinctsender', 'startterminal', 'distinctreceiver', 'endterminal', 'recordedsourcenote', 'SHARED', 'OTHER']) {
    assert.deepEqual(ids(visibleCables(fixture, {search})), ['one'], search);
  }
  assert.deepEqual(fixture, before);
});

test('every documented axis route and shared fault route selects the exact cable, with distinct functional views', () => {
  const expected = new Map();
  for (const axis of ['X', 'YL', 'Z', 'YR']) {
    expected.set(`CMD-${axis}`, [`command-${axis}`, `socket-${axis}`]);
    expected.set(`MOT-${axis}`, [`motor-${axis}`]);
    expected.set(`ENC-${axis}`, [`encoder-${axis}`]);
    expected.set(`PWR-36-${axis}`, [`power-${axis}`]);
    expected.set(`ALM-${axis}`, [`alarm-${axis}`, `diagnostic-${axis}`]);
  }
  expected.set('FAULT-AGG', ['fault-aggregate']);
  const found = new Set();
  for (const cable of cables) {
    const selected = routesForCable(content.routes, cable);
    assert.deepEqual(selected.map(route => route.id), expected.get(cable.cable_id) ?? [], cable.cable_id);
    for (const route of selected) found.add(route.id);
    if (selected.length) {
      assert.equal(selected[0].labelKind, 'source-cable-id', `${cable.cable_id} first view must be the scheduled cable`);
      assert.equal(selected[0].cableLabel, cable.cable_id);
    }
  }
  assert.equal(found.size, 29);
  assert.deepEqual(found, new Set(content.routes.map(route => route.id)));
  const sourceIds = new Set(content.sources.map(source => source.id));
  for (const route of content.routes) {
    assert.ok(route.sourceIds.length, `${route.id} needs provenance`);
    for (const id of route.sourceIds) assert.ok(sourceIds.has(id), `${route.id} references unknown source ${id}`);
    for (const id of route.matchCableIds ?? []) assert.ok(cableIds.includes(id), `${route.id} references unknown cable ${id}`);
  }
});

test('route lookup supports an exact cable label or explicit alias, not substrings or unrelated segments', () => {
  const routes = [
    {id:'label', cableLabel:'CMD-X'},
    {id:'alias', cableLabel:'X socket → interface', matchCableIds:['CMD-X']},
    {id:'both', cableLabel:'CMD-X', matchCableIds:['CMD-X']},
    {id:'suffix', cableLabel:'CMD-X-extra', matchCableIds:['CMD-X-extra']},
    {id:'other', cableLabel:'CMD-YR', matchCableIds:['CMD-YR']},
    {id:'unrelated'},
  ];
  assert.deepEqual(routesForCable(routes, {cable_id:'CMD-X'}).map(route => route.id), ['label', 'alias', 'both']);
  assert.deepEqual(routesForCable(routes, {cable_id:'not-a-cable'}), []);
});

test('new records contain no preparation evidence or hardware authority and do not share mutable records', () => {
  const first = newPreparation(hash), second = newPreparation(hash);
  assert.equal(first.schema, RECORD_SCHEMA);
  assert.equal(first.sourceScheduleSha256, hash);
  assert.equal(first.scope, 'unpowered-cable-preparation-only');
  assert.equal(first.hardwareApproved, false);
  assert.equal(Object.getPrototypeOf(first.records), null);
  assert.deepEqual(Object.keys(first.records), []);
  first.records['CMD-X'] = complete();
  assert.deepEqual(Object.keys(second.records), []);
  assert.deepEqual(preparationProgress(second, cables), {total:44, prepared:0});
});

test('normalization rejects wrong schemas and invalid file/record shapes instead of importing partial evidence', () => {
  for (const candidate of [null, undefined, false, 12, 'record', [], {}, {schema:'mr1-commissioning-v1',records:{}}, {schema:'mr1-wiring-preparation-v1',records:{}}]) {
    assert.throws(() => normalizePreparation(candidate, cableIds), /not an MR1 wiring preparation record/);
  }
  for (const records of [undefined, null, false, 12, 'records', []]) {
    assert.throws(() => normalizePreparation({schema:RECORD_SCHEMA, records}, cableIds), /Missing cable records/);
  }
  for (const value of [null, false, 12, 'approved', []]) {
    assert.throws(() => normalizePreparation(recordFile({'CMD-X':complete(), 'CMD-YL':value}), cableIds), /Invalid record for CMD-YL/);
  }
});

test('normalization removes fabricated authority, arbitrary keys, unknown IDs, and prototype-like JSON keys', () => {
  const candidate = JSON.parse('{"schema":"mr1-wiring-preparation-v2","hardwareApproved":true,"scope":"ready-to-machine","may_energize":true,"records":{"CMD-X":{"identified":true,"labelled":true,"routeChecked":true,"notes":"Keep this literal note.","hardwareApproved":true,"electricallyVerified":true,"energized":true,"__proto__":{"approved":true}},"NOT-A-CABLE":{"identified":true},"__proto__":{"polluted":true},"constructor":{"polluted":true}}}');
  const original = structuredClone(candidate);
  const result = normalizePreparation(candidate, cableIds);
  assert.equal(result.hardwareApproved, false);
  assert.equal(result.scope, 'unpowered-cable-preparation-only');
  assert.equal(Object.hasOwn(result, 'may_energize'), false);
  assert.deepEqual(Object.keys(result).sort(), ['hardwareApproved', 'records', 'schema', 'scope', 'sourceScheduleSha256']);
  assert.deepEqual(Object.keys(result.records), ['CMD-X']);
  assert.equal(Object.getPrototypeOf(result.records), null);
  assert.deepEqual(result.records['CMD-X'], {...complete(), notes:'Keep this literal note.'});
  assert.equal({}.polluted, undefined);
  assert.deepEqual(candidate, original, 'normalization must not mutate the imported object');
  const inherited = Object.create({'CMD-X':complete()});
  assert.deepEqual(Object.keys(normalizePreparation(recordFile(inherited), cableIds).records), []);
});

test('preparation flags accept only literal true; strings, numbers, arrays, objects and missing values remain false', () => {
  for (const value of [false, undefined, null, 0, 1, 'true', 'false', [], {}, new Boolean(true)]) {
    const normalized = normalizePreparation(recordFile({'CMD-X':{identified:value, labelled:value, routeChecked:value}}), cableIds);
    assert.deepEqual(normalized.records['CMD-X'], {identified:false, labelled:false, routeChecked:false, notes:''});
    assert.equal(preparationProgress(normalized, cables).prepared, 0);
  }
  const normalized = normalizePreparation(recordFile({'CMD-X':complete()}), cableIds);
  assert.deepEqual(normalized.records['CMD-X'], complete());
});

test('notes preserve literal markup and newlines, are length-bounded, and have a separate HTML-safe representation', () => {
  const literal = '<img src=x onerror="alert(1)">\n</textarea><script>1 & 2</script>\n\'quoted\' &amp; 🔌';
  const result = normalizePreparation(recordFile({'CMD-X':{notes:literal}}), cableIds);
  assert.equal(result.records['CMD-X'].notes, literal);
  const encoded = escapeHtml(result.records['CMD-X'].notes);
  assert.equal(encoded, '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;\n&lt;/textarea&gt;&lt;script&gt;1 &amp; 2&lt;/script&gt;\n&#39;quoted&#39; &amp;amp; 🔌');
  assert.equal(/[<>]/.test(encoded), false);
  assert.equal(escapeHtml(null), '');
  assert.equal(escapeHtml(undefined), '');
  const long = `${literal}${'x'.repeat(5000)}`;
  const bounded = normalizePreparation(recordFile({'CMD-X':{notes:long}}), cableIds).records['CMD-X'].notes;
  assert.equal(bounded.length, 4000);
  assert.equal(bounded, long.slice(0, 4000));
  for (const notes of [null, false, 1, [], {text:'untrusted'}]) {
    assert.equal(normalizePreparation(recordFile({'CMD-X':{notes}}), cableIds).records['CMD-X'].notes, '');
  }
});

test('importing preparation for this schedule requires the exact source hash when requested', () => {
  assert.match(hash, /^[a-f0-9]{64}$/);
  const candidate = recordFile({'CMD-X':complete()}, {sourceScheduleSha256:hash});
  const result = normalizePreparation(candidate, cableIds, hash);
  assert.equal(result.sourceScheduleSha256, hash);
  assert.deepEqual(result.records['CMD-X'], complete());
  for (const sourceScheduleSha256 of [undefined, null, '', '0'.repeat(64), `${hash} `, {hash}]) {
    assert.throws(() => normalizePreparation(recordFile({'CMD-X':complete()}, {sourceScheduleSha256}), cableIds, hash), /different or unidentified cable schedule/);
  }
  assert.doesNotThrow(() => normalizePreparation(recordFile({'CMD-X':complete()}), cableIds));
  const roundTrip = normalizePreparation(JSON.parse(JSON.stringify(newPreparation(hash))), cableIds, hash);
  assert.equal(roundTrip.sourceScheduleSha256, hash);
  assert.equal(roundTrip.hardwareApproved, false);
});

test('progress counts all and only the three explicit preparation checks on active cables', () => {
  assert.deepEqual(PREPARATION_STEPS, ['identified', 'labelled', 'routeChecked']);
  const record = newPreparation(hash);
  for (const cable of cables) record.records[cable.cable_id] = complete();
  record.records['NOT-A-CABLE'] = complete();
  assert.deepEqual(preparationProgress(record, cables), {total:44, prepared:44});
  for (const key of PREPARATION_STEPS) {
    record.records['CMD-X'][key] = false;
    assert.deepEqual(preparationProgress(record, cables), {total:44, prepared:43}, key);
    record.records['CMD-X'][key] = true;
  }
  record.records['CMD-X'].notes = '';
  record.records['CMD-X'].hardwareApproved = false;
  record.records['CMD-X'].continuityApproved = false;
  assert.equal(preparationProgress(record, cables).prepared, 44);
  record.records['CMD-X'].routeChecked = 'true';
  assert.equal(preparationProgress(record, cables).prepared, 43);
  const archivedOnly = newPreparation(hash);
  for (const cable of cables.filter(cable => !cable.active_by_default)) archivedOnly.records[cable.cable_id] = complete();
  assert.deepEqual(preparationProgress(archivedOnly, cables), {total:44, prepared:0});
  assert.deepEqual(preparationProgress(record, []), {total:0, prepared:0});
  assert.equal(record.hardwareApproved, false, 'completing preparation must not authorize power');
});

test('next and previous navigation stay within the filtered list at both ends and recover unknown selections', () => {
  for (const list of [visibleCables(cables), visibleCables(cables, {axis:'YR'}), visibleCables(cables, {family:'encoder'})]) {
    const first = list[0].cable_id, last = list.at(-1).cable_id;
    assert.equal(nextCable(list, first, -1), first);
    assert.equal(nextCable(list, last, 1), last);
    assert.equal(nextCable(list, last, Number.MAX_SAFE_INTEGER), last);
    assert.equal(nextCable(list, first, -Number.MAX_SAFE_INTEGER), first);
    assert.equal(nextCable(list, null), first);
    assert.equal(nextCable(list, 'removed-by-filter', -1), first);
    for (let index = 0; index < list.length; index++) {
      assert.equal(nextCable(list, list[index].cable_id), list[Math.min(index + 1, list.length - 1)].cable_id);
      assert.equal(nextCable(list, list[index].cable_id, -1), list[Math.max(index - 1, 0)].cable_id);
      assert.equal(nextCable(list, list[index].cable_id, 0), list[index].cable_id);
    }
  }
  assert.equal(nextCable([], 'CMD-X'), null);
  assert.equal(nextCable([], null, -1), null);
  const single = [cables.find(cable => cable.cable_id === 'FAULT-AGG')];
  assert.equal(nextCable(single, 'FAULT-AGG'), 'FAULT-AGG');
  assert.equal(nextCable(single, 'FAULT-AGG', -1), 'FAULT-AGG');
});

// Fallback routes keep the schedule's endpoint text/status when a conductor map
// is not available. Construct only that public shape from the real cable data.
const scheduleRoute = id => {
  const cable = cables.find(item => item.cable_id === id);
  assert.ok(cable, `Missing scheduled cable ${id}`);
  return Object.fromEntries(['from', 'to'].map(side => [side, {
    label:cable[`${side}_device`], terminals:[cable[`${side}_terminal`]],
    status:cable.endpoint_status[side],
  }]));
};

test('ENC-X supply labels identify drive VCC as an output and EGND as the encoder return', () => {
  const route = routesForCable(content.routes, cables.find(cable => cable.cable_id === 'ENC-X'))[0];
  assert.equal(route.from.node, 'motor-X');
  assert.equal(route.to.node, 'drive-X');
  const supply = route.connections.find(wire => wire.to === 'P2 VCC');
  const ground = route.connections.find(wire => wire.to === 'P2 EGND');
  assert.ok(supply);
  assert.ok(ground);
  assert.equal(supply.direction, 'to-from');
  assert.deepEqual(connectionLabels(supply), {
    from:'Encoder supply (fed by drive)', to:'P2 VCC · POWER OUTPUT TO ENCODER',
  });
  assert.equal(ground.direction, 'return');
  assert.deepEqual(connectionLabels(ground), {
    from:'Encoder return', to:'P2 EGND · ENCODER RETURN',
  });
  const feedback = route.connections.filter(wire => /^P2 E[AB][+−]$/.test(wire.to));
  assert.equal(feedback.length, 4);
  for (const wire of feedback) {
    assert.equal(wire.direction, 'from-to');
    assert.deepEqual(connectionLabels(wire), {from:wire.from, to:wire.to});
  }
  assert.match(route.summary, /never feed it from an external 5 V or 24 V supply/);
});

test('DB44 community references remain unverified even if a planned endpoint flag is also present', () => {
  for (const [id, side] of [['SP-ANALOG', 'to'], ['SP-ENABLE', 'to'], ['SP-ALARM', 'from']]) {
    const endpoint = scheduleRoute(id)[side];
    assert.match(endpoint.label, /DB44/);
    assert.match(endpoint.terminals.join(' '), /community pin/);
    assert.equal(endpoint.status, 'community-reference');
    for (const planned of [false, true]) {
      const notice = endpointNotice({...endpoint, planned});
      assert.match(notice, /Unverified community reference/);
      assert.match(notice, /do not land wires from these numbers/);
      assert.doesNotMatch(notice, /Match printed names|actual terminals pending|approved/i);
    }
  }
  assert.match(endpointNotice(scheduleRoute('HOME-FIELD-X').from), /Terminal identity unresolved/);
  assert.match(endpointNotice(scheduleRoute('CMD-X').from), /Planned interface names/);
  assert.match(endpointNotice(scheduleRoute('PROBE-01').from), /Reference functions only/);
});

test('HOME-LOGIC-X board context names its actual STOP0/PG6 destination rather than X fault STOP4/PG12', () => {
  const route = scheduleRoute('HOME-LOGIC-X');
  assert.equal(route.to.terminals[0], 'STOP0 PG6/GND');
  const context = boardContext(route);
  assert.match(context, /Octopus Pro/);
  assert.match(context, /STOP0 PG6\/GND/);
  assert.doesNotMatch(context, /STOP4|PG12|MOTOR0/);
  assert.match(context, /this cable’s header/);
});

test('motor and encoder board context says these cables terminate at the matched drive/motor, with no Octopus termination', () => {
  for (const axis of ['X', 'YL', 'Z', 'YR']) {
    for (const prefix of ['MOT', 'ENC']) {
      const route = routesForCable(content.routes, cables.find(cable => cable.cable_id === `${prefix}-${axis}`))[0];
      const context = boardContext(route);
      assert.match(context, /^This cable has no direct Octopus termination:/);
      assert.ok(context.includes(route.from.label));
      assert.ok(context.includes(route.to.label));
      assert.doesNotMatch(context, /MOTOR\d|STOP\d|Upstream context/);
      assert.equal(route.from.physicalCavityMapKnown, false);
      assert.equal(route.to.physicalCavityMapKnown, false);
    }
  }
});

test('CMD-X keeps MOTOR0 as upstream context and separates socket-to-interface from interface-to-drive', () => {
  const routes = routesForCable(content.routes, cables.find(cable => cable.cable_id === 'CMD-X'));
  const command = routes.find(route => route.id === 'command-X');
  const socket = routes.find(route => route.id === 'socket-X');
  assert.equal(command.from.node, 'interface');
  assert.equal(command.to.node, 'drive-X');
  assert.equal(command.upstream.label, 'Octopus MOTOR0');
  assert.equal(command.upstream.step, 'PF13');
  assert.equal(command.upstream.direction, 'PF12');
  assert.equal(socket.from.node, 'octopus');
  assert.equal(socket.to.node, 'interface');
  assert.equal(socket.labelKind, 'functional-route');
  const context = boardContext(command);
  assert.match(context, /^Upstream context only: Octopus MOTOR0/);
  assert.match(context, /STEP PF13/);
  assert.match(context, /DIR PF12/);
  assert.match(context, /This cable itself runs between the interface and drive/);
  assert.match(boardContext(socket), /Octopus MOTOR0.*STEP PF13.*DIR PF12.*Logic GND/);
  assert.match(endpointNotice(command.from), /Planned interface names/);
  for (const route of routes) {
    const nodes = [route.from.node, route.to.node];
    assert.equal(nodes.includes('octopus') && nodes.includes('drive-X'), false, `${route.id} must not imply a direct socket-to-drive cable`);
    assert.equal(route.physicalCheckComplete, false);
  }
});

test('whole-machine groups partition the 56 scheduled cable IDs exactly once across ten groups', () => {
  assert.equal(coverage.schemaVersion, 1);
  assert.equal(coverage.groups.length, 10);
  assert.deepEqual(coverage.groups.map(group => group.id), [
    'motors', 'alarms', 'home', 'coolant', 'controls', 'probe', 'spindle', 'control-power', 'temperature', 'rollback',
  ]);
  const groupedIds = coverage.groups.flatMap(group => group.cableIds);
  assert.equal(groupedIds.length, 56);
  assert.equal(new Set(groupedIds).size, 56, 'a cable must never appear in multiple groups');
  assert.deepEqual([...groupedIds].sort(), [...cableIds].sort(), 'no scheduled cable may be omitted or an invented cable added');
  for (const group of coverage.groups) {
    assert.ok(group.cableIds.length, `${group.id} must not be an empty group`);
    const shown = visibleCables(cables, {cableIds:group.cableIds, archived:true});
    assert.deepEqual(new Set(ids(shown)), new Set(group.cableIds), group.id);
  }
});

test('motor group includes command, motor, encoder and CL57T DC branch cables for each of the four axes', () => {
  const group = coverage.groups.find(group => group.id === 'motors');
  const expected = ['X', 'YL', 'Z', 'YR'].flatMap(axis => [`CMD-${axis}`, `MOT-${axis}`, `ENC-${axis}`, `PWR-36-${axis}`]);
  assert.deepEqual(group.cableIds, expected);
  assert.equal(visibleCables(cables, {cableIds:group.cableIds}).length, 16);
  for (const axis of ['X', 'YL', 'Z', 'YR']) {
    assert.deepEqual(ids(visibleCables(cables, {cableIds:group.cableIds, axis})), [`PWR-36-${axis}`, `CMD-${axis}`, `MOT-${axis}`, `ENC-${axis}`]);
  }
  assert.deepEqual(visibleCables(cables, {cableIds:group.cableIds, search:'DM860T', archived:true}), []);
});

test('alarm group includes four individual alarms and the aggregate; coolant group includes only flood and mist controls', () => {
  const alarms = coverage.groups.find(group => group.id === 'alarms');
  assert.deepEqual(alarms.cableIds, ['ALM-X', 'ALM-YL', 'ALM-Z', 'ALM-YR', 'FAULT-AGG']);
  assert.deepEqual(ids(visibleCables(cables, {cableIds:alarms.cableIds})), alarms.cableIds);
  assert.deepEqual(ids(visibleCables(cables, {cableIds:alarms.cableIds, axis:'shared'})), ['FAULT-AGG']);
  const coolant = coverage.groups.find(group => group.id === 'coolant');
  assert.deepEqual(coolant.cableIds, ['FLOOD-CTL', 'MIST-CTL']);
  assert.deepEqual(ids(visibleCables(cables, {cableIds:coolant.cableIds, archived:true})), ['FLOOD-CTL', 'MIST-CTL']);
  assert.deepEqual(visibleCables(cables, {cableIds:coolant.cableIds, search:'SP-'}), []);
});

test('group filtering preserves reserved and rollback visibility rules even when those groups are selected', () => {
  const counts = {
    motors:[16,16], alarms:[5,5], home:[8,8], coolant:[2,2], controls:[4,4], probe:[2,2],
    spindle:[4,11], 'control-power':[3,3], temperature:[0,1], rollback:[0,4],
  };
  let totalActive = 0, totalAll = 0;
  for (const group of coverage.groups) {
    const active = visibleCables(cables, {cableIds:group.cableIds});
    const all = visibleCables(cables, {cableIds:group.cableIds, archived:true});
    assert.deepEqual([active.length, all.length], counts[group.id], group.id);
    assert.ok(active.every(cable => cable.disposition !== 'reserved' && cable.disposition !== 'rollback'));
    assert.ok(all.every(cable => cable.may_energize === false && cable.evidence_status === 'unverified'));
    totalActive += active.length;
    totalAll += all.length;
  }
  assert.equal(totalActive, 44);
  assert.equal(totalAll, 56);
  const spindle = coverage.groups.find(group => group.id === 'spindle');
  assert.deepEqual(ids(visibleCables(cables, {cableIds:spindle.cableIds})), ['SP-PWM', 'SP-ANALOG', 'SP-ENABLE', 'SP-ALARM']);
  assert.deepEqual(visibleCables(cables, {cableIds:spindle.cableIds, search:'SP-ORIENT'}), []);
  assert.deepEqual(ids(visibleCables(cables, {cableIds:spindle.cableIds, search:'SP-ORIENT', archived:true})), ['SP-ORIENT']);
});

test('optional cable-ID filter composes with existing filters, uses exact IDs and preserves schedule order', () => {
  assert.deepEqual(ids(visibleCables(cables, {cableIds:null})), data.active_ids);
  assert.deepEqual(ids(visibleCables(cables, {cableIds:null, archived:true})), cableIds);
  assert.deepEqual(visibleCables(cables, {cableIds:[], archived:true}), []);
  assert.deepEqual(visibleCables(cables, {cableIds:['CMD', 'CMD-X-extra', 'NOT-A-CABLE'], archived:true}), []);
  const selection = ['ENC-YR', 'CMD-X', 'PWR-36-X', 'CMD-X'];
  const before = [...selection];
  assert.deepEqual(ids(visibleCables(cables, {cableIds:selection})), ['PWR-36-X', 'CMD-X', 'ENC-YR']);
  assert.deepEqual(ids(visibleCables(cables, {cableIds:selection, axis:'X', family:'command', search:'  cmd-x '})), ['CMD-X']);
  assert.deepEqual(visibleCables(cables, {cableIds:selection, axis:'YR', family:'command'}), []);
  assert.deepEqual(selection, before, 'the caller’s selected group must not be mutated');
});

test('one-wire command and socket instructions preserve separate end identities for all four axes', () => {
  for (const axis of ['X', 'YL', 'Z', 'YR']) {
    const command = content.routes.find(route => route.id === `command-${axis}`);
    const socket = content.routes.find(route => route.id === `socket-${axis}`);
    assert.equal(command.from.node, 'interface');
    assert.equal(command.to.node, `drive-${axis}`);
    assert.equal(command.connections.length, 4);
    assert.equal(socket.from.node, 'octopus');
    assert.equal(socket.to.node, 'interface');
    assert.equal(socket.connections.length, 3);
    for (const route of [command, socket]) {
      const before = structuredClone(route);
      for (let index = 0; index < route.connections.length; index++) {
        const instruction = wireInstruction(route, index);
        assert.deepEqual(instruction, {
          index, total:route.connections.length,
          endA:{device:route.from.label, terminal:route.connections[index].from},
          endB:{device:route.to.label, terminal:route.connections[index].to},
          physicalCavityMapKnown:false,
        }, `${route.id} wire ${index + 1}`);
      }
      assert.deepEqual(route, before, 'instruction lookup must not alter source route data');
    }
  }
});

test('one-wire selection clamps integer indices and adapts when switching to a shorter route', () => {
  const encoder = content.routes.find(route => route.id === 'encoder-X');
  const socket = content.routes.find(route => route.id === 'socket-YR');
  const command = content.routes.find(route => route.id === 'command-Z');
  const selectedEncoder = wireInstruction(encoder, 5);
  assert.equal(selectedEncoder.index, 5);
  assert.equal(selectedEncoder.total, 6);
  const selectedSocket = wireInstruction(socket, selectedEncoder.index);
  assert.equal(selectedSocket.index, 2);
  assert.equal(selectedSocket.total, 3);
  assert.deepEqual(selectedSocket.endA, {device:socket.from.label, terminal:'Logic GND'});
  assert.deepEqual(selectedSocket.endB, {device:socket.to.label, terminal:'Controller logic return'});
  assert.doesNotMatch(JSON.stringify(selectedSocket), /encoder|EGND|VCC/i);
  const selectedCommand = wireInstruction(command, selectedEncoder.index);
  assert.equal(selectedCommand.index, 3);
  assert.equal(selectedCommand.total, 4);
  assert.equal(selectedCommand.endB.device, command.to.label);
  assert.equal(selectedCommand.endB.terminal, 'P1 DIR−');
  for (const route of [encoder, socket, command]) {
    assert.deepEqual(wireInstruction(route, -1), wireInstruction(route, 0));
    assert.deepEqual(wireInstruction(route, -Number.MAX_SAFE_INTEGER), wireInstruction(route, 0));
    assert.deepEqual(wireInstruction(route, Number.MAX_SAFE_INTEGER), wireInstruction(route, route.connections.length - 1));
  }
});

test('one-wire selection defaults omitted, null and noninteger indices to the first connection without coercion', () => {
  const route = content.routes.find(route => route.id === 'command-X');
  const first = wireInstruction(route, 0);
  assert.deepEqual(wireInstruction(route), first);
  for (const invalid of [undefined, null, false, true, 1.5, -0.5, NaN, Infinity, -Infinity, '2', [], {}, new Number(2)]) {
    assert.deepEqual(wireInstruction(route, invalid), first);
  }
  assert.equal(wireInstruction(route, 2).index, 2, 'a genuine integer selects that connection');
});

test('one-wire encoder instructions retain drive-output VCC and EGND return labels', () => {
  for (const axis of ['X', 'YL', 'Z', 'YR']) {
    const route = content.routes.find(route => route.id === `encoder-${axis}`);
    const supplyIndex = route.connections.findIndex(wire => wire.to === 'P2 VCC');
    const returnIndex = route.connections.findIndex(wire => wire.to === 'P2 EGND');
    assert.ok(supplyIndex >= 0);
    assert.ok(returnIndex >= 0);
    const supply = wireInstruction(route, supplyIndex);
    assert.deepEqual(supply.endA, {device:route.from.label, terminal:'Encoder supply (fed by drive)'});
    assert.deepEqual(supply.endB, {device:route.to.label, terminal:'P2 VCC · POWER OUTPUT TO ENCODER'});
    const ground = wireInstruction(route, returnIndex);
    assert.deepEqual(ground.endA, {device:route.from.label, terminal:'Encoder return'});
    assert.deepEqual(ground.endB, {device:route.to.label, terminal:'P2 EGND · ENCODER RETURN'});
    assert.equal(supply.physicalCavityMapKnown, false);
    assert.equal(ground.physicalCavityMapKnown, false);
  }
});

test('one-wire instructions return null for an unmapped scheduled route rather than inventing a conductor', () => {
  const fallback = scheduleRoute('HOME-LOGIC-X');
  assert.equal(wireInstruction(fallback), null);
  assert.equal(wireInstruction({...fallback, connections:[]}, 5), null);
  assert.equal(wireInstruction({...fallback, connections:null}, -1), null);
  assert.equal(wireInstruction({}), null);
});

test('one-wire instructions cannot inherit physical approval or a connector-cavity claim from a route', () => {
  const route = structuredClone(content.routes.find(route => route.id === 'command-X'));
  route.physicalCavityMapKnown = true;
  route.hardwareApproved = true;
  route.physicalCheckComplete = true;
  route.from.physicalCavityMapKnown = true;
  route.to.physicalCavityMapKnown = true;
  route.connections[0].physicalCavityMapKnown = true;
  route.connections[0].may_energize = true;
  const instruction = wireInstruction(route);
  assert.equal(instruction.physicalCavityMapKnown, false);
  assert.deepEqual(Object.keys(instruction).sort(), ['endA', 'endB', 'index', 'physicalCavityMapKnown', 'total']);
  assert.deepEqual(Object.keys(instruction.endA).sort(), ['device', 'terminal']);
  assert.deepEqual(Object.keys(instruction.endB).sort(), ['device', 'terminal']);
});

test('board group lookup prefers a direct scheduled segment over earlier related links and falls back without substring matches', () => {
  const related = {id:'related', rows:[{relatedCableIds:['CMD-X']}]};
  const direct = {id:'direct', rows:[{cableIds:['CMD-X']}]};
  const fallback = {id:'off-board', rows:[]};
  const groups = [fallback, related, direct];
  assert.equal(boardGroupForCable(groups, 'CMD-X'), direct);
  assert.equal(boardGroupForCable([related, fallback], 'CMD-X'), related);
  for (const id of ['CMD', 'CMD-X-extra', 'unknown', null]) assert.equal(boardGroupForCable(groups, id), fallback);
  assert.equal(boardGroupForCable([related], 'unknown'), null);
  assert.equal(boardGroupForCable([], 'CMD-X'), null);
});

test('every cable whose scheduled endpoint is Octopus has a direct board group rather than an unrelated context link', () => {
  const expected = {
    'PWR-24-01':'power-main',
    'HOME-LOGIC-X':'homes-stop0-3', 'HOME-LOGIC-YL':'homes-stop0-3', 'HOME-LOGIC-Z':'homes-stop0-3', 'HOME-LOGIC-YR':'homes-stop0-3',
    'SAFE-MON':'tb-t0-t1', 'DOOR-MON':'door-pwr-det', 'HOLD-01':'tb-t0-t1',
    'START-01':'exp2', 'FAULT-AGG':'exp2', 'SP-PWM':'spindle-fan0-fan4',
    'SP-RS485-LOGIC':'reserved-serial', 'SP-ORIENT':'reserved-serial',
    'FLOOD-CTL':'coolant-he0-he1', 'MIST-CTL':'coolant-he0-he1', 'USB-01':'usb',
  };
  const connected = cables.filter(cable => /Octopus/i.test(`${cable.from_device} ${cable.to_device}`));
  assert.equal(connected.length, 16);
  assert.deepEqual(new Set(ids(connected)), new Set(Object.keys(expected)));
  for (const cable of connected) {
    const matches = boardContent.groups.filter(group => group.rows.some(row => row.cableIds?.includes(cable.cable_id)));
    assert.equal(matches.length, 1, `${cable.cable_id} must have one unambiguous direct board group`);
    assert.equal(matches[0].id, expected[cable.cable_id]);
    assert.equal(boardGroupForCable(boardContent.groups, cable.cable_id), matches[0]);
  }
  for (const id of ['SP-RS485-LOGIC', 'SP-ORIENT']) {
    assert.equal(cables.find(cable => cable.cable_id === id).disposition, 'reserved');
    assert.match(boardGroupForCable(boardContent.groups, id).status, /RESERVED/);
  }
});

test('board context preserves related-only segments and keeps motor, encoder and drive DC cables off the board', () => {
  for (const [index, axis] of ['X', 'YL', 'Z', 'YR'].entries()) {
    assert.equal(boardGroupForCable(boardContent.groups, `CMD-${axis}`).id, `driver${index}`);
    assert.equal(boardGroupForCable(boardContent.groups, `ALM-${axis}`).id, 'diagnostics-stop4-7');
    for (const prefix of ['CMD', 'ALM']) {
      assert.equal(boardContent.groups.some(group => group.rows.some(row => row.cableIds?.includes(`${prefix}-${axis}`))), false,
        `${prefix}-${axis} is not the upstream/conditioned cable segment`);
    }
    for (const prefix of ['MOT', 'ENC', 'PWR-36']) {
      const group = boardGroupForCable(boardContent.groups, `${prefix}-${axis}`);
      assert.equal(group.id, 'off-board');
      assert.deepEqual(boardRegionsForGroup(boardRegions.regions, group.id), []);
    }
  }
  assert.equal(boardGroupForCable(boardContent.groups, 'PROBE-01').id, 'tb-t0-t1');
  assert.equal(boardGroupForCable(boardContent.groups, 'TOOL-01').id, 'tool-setter');
  assert.equal(boardGroupForCable(boardContent.groups, 'unknown').id, 'off-board');
});

test('three driver-jumper groups and the unused motor-phase plug group stay separate from active cable terminals', () => {
  const jumpers = boardContent.groups.filter(group => group.id.startsWith('jumper-'));
  assert.deepEqual(new Set(jumpers.map(group => group.id)), new Set(['jumper-voltage', 'jumper-mode-spi', 'jumper-diag']));
  for (const group of jumpers) {
    assert.match(group.status, /REMOVE FITTED CAPS/);
    assert.ok(group.rows.every(row => !(row.cableIds?.length || row.relatedCableIds?.length)));
    assert.equal(boardRegionsForGroup(boardRegions.regions, group.id).length, 1);
  }
  const phase = boardContent.groups.find(group => group.id === 'motor-phase-plugs');
  assert.equal(phase.status, 'LEAVE EMPTY');
  assert.deepEqual(new Set(phase.rows.map(row => row.terminal)), new Set(['A1', 'A2', 'B1', 'B2']));
  assert.ok(phase.rows.every(row => !(row.cableIds?.length || row.relatedCableIds?.length)));
  const other = boardContent.groups.find(group => group.id === 'other-jumpers');
  assert.equal(other.status, 'OUTSIDE DRIVER-JUMPER CLEANUP');
  assert.deepEqual(boardRegionsForGroup(boardRegions.regions, other.id), []);
});

test('axis STEP/DIR GPIOs and STOP home/fault GPIOs remain correctly separated', () => {
  const axes = [
    {axis:'X', driver:0, step:'PF13', dir:'PF12', home:'PG6', diagnostic:'PG12'},
    {axis:'YL', driver:1, step:'PG0', dir:'PG1', home:'PG9', diagnostic:'PG13'},
    {axis:'Z', driver:2, step:'PF11', dir:'PG3', home:'PG10', diagnostic:'PG14'},
    {axis:'YR', driver:3, step:'PG4', dir:'PC1', home:'PG11', diagnostic:'PG15'},
  ];
  const homes = boardContent.groups.find(group => group.id === 'homes-stop0-3');
  const diagnostics = boardContent.groups.find(group => group.id === 'diagnostics-stop4-7');
  for (const {axis, driver, step, dir, home, diagnostic} of axes) {
    const commands = boardContent.groups.find(group => group.id === `driver${driver}`);
    const commandRows = commands.rows.filter(row => row.relatedCableIds?.includes(`CMD-${axis}`));
    assert.deepEqual(commandRows.map(row => row.terminal), [`STEP / ${step}`, `DIR / ${dir}`, 'Logic GND']);
    const homeRows = homes.rows.filter(row => row.cableIds?.includes(`HOME-LOGIC-${axis}`));
    assert.deepEqual(homeRows.map(row => row.terminal), [`STOP${driver} signal / ${home}`, `STOP${driver} GND`]);
    const alarmRows = diagnostics.rows.filter(row => row.relatedCableIds?.includes(`ALM-${axis}`));
    assert.deepEqual(alarmRows.map(row => row.terminal), [`STOP${driver + 4} signal / ${diagnostic}`, `STOP${driver + 4} GND`]);
    assert.ok(alarmRows.every(row => !row.cableIds?.length));
    assert.equal(boardGroupForCable(boardContent.groups, `HOME-LOGIC-${axis}`).id, homes.id);
  }
  const faultGroup = boardGroupForCable(boardContent.groups, 'FAULT-AGG');
  assert.equal(faultGroup.id, 'exp2');
  assert.ok(faultGroup.rows.some(row => row.cableIds?.includes('FAULT-AGG') && row.terminal === 'PB1'));
  assert.ok(diagnostics.rows.every(row => !row.cableIds?.includes('FAULT-AGG')));
});

test('board region selection matches exact groups and returns both spindle headers without extra nearby regions', () => {
  const selected = group => boardRegionsForGroup(boardRegions.regions, group).map(region => region.id);
  const expected = {
    driver0:['socket-area'], driver1:['socket-area'], driver2:['socket-area'], driver3:['socket-area'],
    'motor-phase-plugs':['phase-plugs'], 'jumper-voltage':['voltage-links'], 'jumper-mode-spi':['mode-links'], 'jumper-diag':['diag-links'],
    'power-main':['main-power'], 'power-unused':['power-block'],
    'homes-stop0-3':['stop-bank'], 'diagnostics-stop4-7':['stop-bank'],
    'tb-t0-t1':['tb-t0-t1'], 'tool-setter':['tool-setter'], exp2:['exp-pair'],
    'door-pwr-det':['door'], 'spindle-fan0-fan4':['fan0','fan4'], 'coolant-he0-he1':['coolant'], usb:['usb-c'],
  };
  for (const [group, ids] of Object.entries(expected)) assert.deepEqual(selected(group), ids, group);
  for (const group of ['driver', 'driver10', 'exp', 'EXP2', 'fan0', 'not-a-group', null]) assert.deepEqual(selected(group), []);
  const fixture = [{id:'prefix',groups:['driver10']}, {id:'exact',groups:['driver1']}, {id:'other',groups:['driver0']}];
  assert.deepEqual(boardRegionsForGroup(fixture, 'driver1'), [fixture[1]]);
});

test('board rectangles stay within the original image and contain location metadata only, not cavity or approval assignments', () => {
  assert.deepEqual([boardRegions.imageWidth, boardRegions.imageHeight], [1912,1534]);
  assert.deepEqual([boardContent.sourceBoard.width, boardContent.sourceBoard.height], [1912,1534]);
  assert.equal(boardContent.physicalCheckComplete, false);
  assert.equal(boardContent.mayEnergize, false);
  assert.equal(boardContent.mayMachine, false);
  assert.match(boardRegions.purpose, /never identify an individual contact or mating-plug cavity/i);
  assert.equal(new Set(boardRegions.regions.map(region => region.id)).size, boardRegions.regions.length);
  const knownGroups = new Set(boardContent.groups.map(group => group.id));
  for (const region of boardRegions.regions) {
    assert.equal(region.rect.length, 4);
    assert.ok(region.rect.every(Number.isFinite), region.id);
    const [x,y,width,height] = region.rect;
    assert.ok(x >= 0 && y >= 0 && width > 0 && height > 0, region.id);
    assert.ok(x + width <= 1912 && y + height <= 1534, `${region.id} must fit the original image`);
    assert.ok(region.groups.length);
    assert.ok(region.groups.every(group => knownGroups.has(group)), `${region.id} must reference actual board groups`);
    for (const key of Object.keys(region)) {
      assert.ok(['id','label','groups','rect','note'].includes(key), `${region.id}: ${key} is not component-location metadata`);
    }
  }
});

test('EXP2 highlights the pair of EXP housings without claiming that either pictured housing is individually identified', () => {
  const matches = boardRegionsForGroup(boardRegions.regions, 'exp2');
  assert.equal(matches.length, 1);
  const region = matches[0];
  assert.equal(region.id, 'exp-pair');
  assert.match(region.label, /EXP headers/);
  assert.match(region.note, /Both EXP housings are highlighted/);
  assert.match(region.note, /Identify EXP2 from its actual board marking/);
  assert.doesNotMatch(`${region.label} ${region.note}`, /left housing|right housing|pin\s*1\s*(?:is|at)/i);
});
