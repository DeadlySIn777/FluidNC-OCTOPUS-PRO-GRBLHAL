import {PREPARATION_STEPS, RECORD_SCHEMA, escapeHtml, visibleCables, normalizePreparation, newPreparation, preparationProgress, routesForCable, nextCable, connectionLabels, endpointNotice, boardContext, wireInstruction, boardGroupForCable, boardRegionsForGroup} from './model.mjs';

const bundle = JSON.parse(document.getElementById('wiring-data').textContent);
const cables = bundle.cables.cables, content = bundle.routes, layout = bundle.layout;
const $ = id => document.getElementById(id), h = escapeHtml;
const storageKey = 'mr1.visual-wiring.preparation.v2';
const scheduleHash = bundle.cables.source.csv.sha256;
const familyNames = {command:'Step / direction',motor:'Motor phases',encoder:'Encoder feedback',power:'Power',home:'Home inputs',fault:'Drive faults',probe:'Probe / setter',controls:'Operator controls',spindle:'Spindle',other:'Other'};
const familyColors = {command:'#247aa4',motor:'#b07049',encoder:'#7656aa',power:'#aa6143',home:'#368e83',fault:'#a48420',probe:'#ad527e',controls:'#726d4b',spindle:'#676c9a',other:'#627b68'};
const filters = {axis:'X', family:'all', search:'', archived:false, cableIds:null};
let activeSystemId = null;
let selectedId = 'CMD-X', routeId = null, view = 'trace', focusedWire = null, record = newPreparation(scheduleHash);
let storageWorks = true, importGeneration = 0;
let selectedBoardGroup = 'jumper-voltage', lastBoardCable = null;
const cableIds = cables.map(cable => cable.cable_id);
function notify(message, error = false) { $('save-status').textContent = message; $('save-status').classList.toggle('error', error); }
try {
  const stored = localStorage.getItem(storageKey);
  if (stored) record = normalizePreparation(JSON.parse(stored), cableIds, scheduleHash);
} catch {
  storageWorks = false;
  notify('Saved notes could not be read. Your old record has not been overwritten. Export any new notes before closing.', true);
}
function save() {
  if (storageWorks) {
    try { localStorage.setItem(storageKey, JSON.stringify(record)); }
    catch { storageWorks = false; notify('Browser storage is unavailable or full. Notes remain in this page; export them before closing.', true); }
  }
  const progress = preparationProgress(record, cables);
  $('progress').textContent = `${progress.prepared} / ${progress.total}`;
}
function currentCable() { return cables.find(cable => cable.cable_id === selectedId); }
function candidates() { return visibleCables(cables, filters); }
function currentRecord() { return record.records[selectedId] ??= {identified:false,labelled:false,routeChecked:false,notes:''}; }
function selectCable(id) { selectedId = id; routeId = null; focusedWire = null; render(); }
function endpointMarkup(endpoint, side) {
  const photoId = endpoint.node === 'octopus' || /Octopus/i.test(endpoint.label) ? 'octopus'
    : endpoint.node?.startsWith('drive-') ? endpoint.node.slice(6)
    : /^CL57T\b/i.test(endpoint.label) && content.axes.some(axis=>axis.id===currentCable()?.axis) ? currentCable().axis : null;
  return `<article class="endpoint"><span class="end-label">${side}</span><h3>${h(endpoint.label)}</h3><span class="terminal-name">${endpoint.terminals.map(h).join('<br>')}</span><div class="physical">${h(endpointNotice(endpoint))}</div>${photoId ? `<button class="locate-device" data-photo-id="${h(photoId)}">Locate on cabinet photo ↗</button>` : ''}</article>`;
}
function currentRoute(cable) {
  const routes = routesForCable(content.routes, cable);
  const route = routes.find(item => item.id === routeId) ?? routes[0];
  return {routes, route: route ?? {id: cable.cable_id, title: familyNames[cable.family] ?? cable.family,
    from:{label:cable.from_device,terminals:[cable.from_terminal],status:cable.endpoint_status?.from,planned:/interface|conditioner|isolated/i.test(cable.from_device)},
    to:{label:cable.to_device,terminals:[cable.to_terminal],status:cable.endpoint_status?.to,planned:/interface|conditioner|isolated/i.test(cable.to_device)},
    connections:[], summary:cable.trace_task, check:'Identify the exact terminals and their viewing side before assigning any conductor.',holdIds:[],sourceIds:[]}};
}
function renderList(list) {
  $('list-count').textContent = `${list.length} cable${list.length === 1 ? '' : 's'}`;
  $('cable-list').innerHTML = list.map(cable => {
    const prepared = PREPARATION_STEPS.every(key => record.records[cable.cable_id]?.[key]);
    return `<button class="cable-item" data-cable="${h(cable.cable_id)}" aria-current="${cable.cable_id === selectedId}" style="--cable-color:${familyColors[cable.family] ?? '#627b68'}"><span class="stripe"></span><span><strong>${h(cable.cable_id)}</strong><small>${h(familyNames[cable.family] ?? cable.family)}${cable.active_by_default ? '' : ' · '+h(cable.disposition)}</small></span><span class="record-dot ${prepared ? 'filled' : ''}" aria-label="${prepared ? 'Preparation notes recorded' : 'Preparation notes incomplete'}"></span></button>`;
  }).join('') || '<p class="tiny">No matching cables.</p>';
}
function labelMarkup(cable, side, endpoint) {
  return `<div class="cable-label"><small>${h(side)} · SAME ID ON BOTH ENDS</small><strong>${h(cable.cable_id)}</strong><span>${h(endpoint)}</span></div>`;
}
function renderRoute(cable) {
  const {routes, route} = currentRoute(cable);
  routeId = route.id;
  const commandAxis = cable.family === 'command' ? content.axes.find(axis=>axis.id===cable.axis) : null;
  $('command-connector-note').hidden = !commandAxis;
  $('command-connector-note').innerHTML = commandAxis ? `<strong>Your ${h(commandAxis.label)} CL57T is the motor driver.</strong><p>The control signal comes from the empty <b>${h(commandAxis.socket)} driver socket</b>: STEP (${h(commandAxis.step)}), DIR (${h(commandAxis.direction)}) and logic GND. There is no plug-in motor driver.</p><p><b>Leave the four-pin A1 / A2 / B2 / B1 motor-output plug unused.</b> Those contacts do not carry STEP/DIR on the bare Octopus.</p><table class="jumper-table"><caption>Driver-slot jumper caps: remove from all eight slots, MOTOR0–7</caption><thead><tr><th scope="col">Identify this group</th><th scope="col">For this external-CL57T build</th></tr></thead><tbody><tr><th scope="row">HV / VM / VIN voltage selection</th><td>Remove the cap above each socket. Leave all eight unjumpered.</td></tr><tr><th scope="row">Mode / SPI configuration pins</th><td>Remove every cap in each socket's configuration block.</td></tr><tr><th scope="row">M0DIAG through M7DIAG</th><td>Remove all eight DIAG caps.</td></tr></tbody></table><p><b>Disconnect all power and USB before changing jumpers.</b> Identify these three groups from the board markings and reference image. Remove the removable caps, not the fixed header pins. USB-power, fan-voltage, BOOT and other unrelated jumpers are outside this instruction.</p><p class="tiny">These jumpers do not reroute A1/A2/B2/B1 to STEP/DIR. The saved design includes a planned signal-conditioning circuit between the socket and CL57T. Its physical terminals are still unconfirmed; it is not another motor driver.</p>` : '';
  document.querySelector('.route-workspace').style.setProperty('--cable-color', familyColors[cable.family] ?? '#627b68');
  $('endpoints').innerHTML = endpointMarkup(route.from, 'END A') + '<div class="endpoint-link" aria-hidden="true">↔</div>' + endpointMarkup(route.to, 'END B');
  $('route-choice').innerHTML = routes.length > 1 ? routes.map(item => `<button data-route="${h(item.id)}" aria-pressed="${item.id === route.id}">${h(item.title)}</button>`).join('') : '';
  $('upstream').textContent = route.upstream ? `${route.upstream.label} → planned command interface → ${route.to.label}. STEP ${route.upstream.step}; DIR ${route.upstream.direction}. ${route.upstream.note}`
    : route.labelKind === 'functional-route' ? `Related circuit segment — not cable ${cable.cable_id}. It has no assigned cable-schedule ID. Return to the scheduled cable view to print labels or record preparation.` : '';
  $('preparation').hidden = route.labelKind === 'functional-route';
  const connections = route.connections ?? [];
  const instruction = wireInstruction(route, focusedWire);
  focusedWire = instruction?.index ?? null;
  $('wire-focus').hidden = !instruction;
  if(instruction) {
    $('wire-position').textContent = `WIRE ${instruction.index+1} OF ${instruction.total}`;
    $('wire-end-a').innerHTML = `<small>${h(instruction.endA.device)}</small><strong>${h(instruction.endA.terminal)}</strong>`;
    $('wire-end-b').innerHTML = `<small>${h(instruction.endB.device)}</small><strong>${h(instruction.endB.terminal)}</strong>`;
    $('wire-previous').disabled = instruction.index === 0;
    $('wire-next').disabled = instruction.index === instruction.total-1;
  }
  $('wire-diagram').innerHTML = `<div class="diagram-heading"><span>${h(route.from.label)}</span><span>${h(route.to.label)}</span></div>`
    + (connections.length ? connections.map((wire, index) => {const labels=connectionLabels(wire);return `<button class="wire-row ${focusedWire === index ? 'active' : ''}" data-wire="${index}" aria-pressed="${focusedWire === index}" style="--wire-color:${['#7ecddf','#ffd281','#a2d995','#ceafea','#f4b4ab','#a7c8ff'][index % 6]}"><span>${h(labels.from)}</span><i class="wire-line" aria-hidden="true"></i><span>${h(labels.to)}</span></button>`;}).join('')
      : '<p><strong>Endpoint references only — conductor map pending.</strong> Identify the actual connector and interface before assigning individual wires.</p>')
    + '<p class="diagram-caption">Click one row to follow that connection. These are functional names, not a physical pin order. Line colours separate the drawing; they do not identify your wire colours.</p>';
  $('route-description').innerHTML = `<p>${h(route.summary)}</p><p><strong>Trace check:</strong> ${h(route.check)}</p>`
    + (cable.family === 'encoder' || cable.family === 'motor' ? `<p>${h(content.closedLoop)}</p>` : '')
    + (cable.axis === 'YL' || cable.axis === 'YR' ? `<p>${h(content.axisNote)}</p>` : '');
  const routeHolds = (route.holdIds ?? []).map(id => content.holds.find(item => item.id === id)).filter(Boolean);
  const reasons = [...new Set([...(cable.missing_evidence ?? []), ...routeHolds.map(item => item.reason)])];
  $('selected-hold').innerHTML = `<strong>${cable.disposition === 'rollback' ? 'ROLLBACK CABLE — keep separate from this CL57T build' : cable.disposition === 'reserved' ? 'RESERVED — leave disconnected' : 'Before landing this cable'}</strong><ul>${reasons.slice(0,3).map(reason => `<li>${h(reason)}</li>`).join('')}</ul>`;
  $('trace-task').textContent = cable.trace_task;
  // Print the source cable endpoints, even when a related functional view is selected.
  $('labels').innerHTML = labelMarkup(cable, 'END A', cable.from_device) + labelMarkup(cable, 'END B', cable.to_device);
  const stored = currentRecord();
  document.querySelectorAll('[data-check]').forEach(input => {input.checked = stored[input.dataset.check] === true;});
  $('cable-notes').value = stored.notes;
  const sourceRows = [['Cable ID',cable.cable_id],['From',`${cable.from_device} · ${cable.from_terminal}`],['To',`${cable.to_device} · ${cable.to_terminal}`],['Source state',cable.state],['Display status',cable.disposition],['Cable class',cable.cable_class],['Source note',cable.notes]];
  $('source-details').innerHTML = '<dl>'+sourceRows.map(([key,value]) => `<dt>${h(key)}</dt><dd>${h(value)}</dd>`).join('')+'</dl>'
    + '<strong>Checks still open</strong><ul>'+reasons.map(reason => `<li>${h(reason)}</li>`).join('')+'</ul>'
    + '<p>Planned interface names, shielding and terminal functions are not proof of an installed connection. No physical evidence is pre-filled.</p>';
  const axis = content.axes.find(item => item.id === cable.axis);
  $('board-cable-context').textContent = boardContext(route);
  if(lastBoardCable !== cable.cable_id) {
    lastBoardCable = cable.cable_id;
    selectedBoardGroup = boardGroupForCable(bundle.boardContent.groups, cable.cable_id)?.id ?? 'jumper-voltage';
  }
  renderBoardGroup();
  $('photo-drive').disabled = !axis;
  renderMarkers(cable);
}
function render() {
  const list = candidates();
  if (!list.some(cable => cable.cable_id === selectedId)) {selectedId = list[0]?.cable_id ?? null;routeId=null;focusedWire=null;}
  renderList(list);
  const system = bundle.coverage.groups.find(group=>group.id===activeSystemId);
  $('system-scope').textContent = `${system?.title ?? 'All systems'} · ${filters.axis === 'all' ? 'all axes' : filters.axis === 'shared' ? 'shared circuits' : `${content.axes.find(axis=>axis.id===filters.axis)?.label ?? filters.axis} axis`}`;
  document.querySelectorAll('[data-system]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.system===activeSystemId)));
  const cable = currentCable();
  $('selected-cable').hidden = !cable; $('empty-state').hidden = !!cable;
  $('route-kicker').textContent = cable ? `${cable.axis === 'shared' ? 'SHARED CIRCUIT' : `${content.axes.find(item=>item.id === cable.axis)?.label ?? cable.axis} AXIS`} / ${cable.cable_id}` : 'NO SELECTION';
  $('route-title').textContent = cable ? familyNames[cable.family] ?? cable.family : 'Choose another filter';
  const index = list.findIndex(item=>item.cable_id === selectedId);
  $('selection-position').textContent = list.length ? `${index+1} / ${list.length}` : '0 / 0';
  $('previous').disabled = index <= 0; $('next').disabled = index < 0 || index === list.length - 1;
  if (cable) renderRoute(cable);
  const progress = preparationProgress(record,cables);$('progress').textContent = `${progress.prepared} / ${progress.total}`;
}

function switchView(name, focus = false) {
  view = name;
  document.querySelectorAll('[data-view]').forEach(button => {const selected=button.dataset.view===name;button.setAttribute('aria-selected',String(selected));button.tabIndex=selected?0:-1;if(selected&&focus)button.focus();});
  ['trace','cabinet','board'].forEach(id=>$('view-'+id).hidden=id!==name);
}
const photo = $('cabinet-photo'), photoWidth = layout.assets.cabinet.width, photoHeight=layout.assets.cabinet.height;
let photoBox = [0,0,photoWidth,photoHeight], lastPhotoAxis = null;
function applyPhotoBox() {photo.setAttribute('viewBox',photoBox.join(' '));}
function focusPhoto(id) {
  const component=layout.components.find(item=>item.id===id);
  if(!component){photoBox=[0,0,photoWidth,photoHeight];applyPhotoBox();return;}
  const span=Math.min(photoWidth, component.region ? Math.max(component.region.width*photoWidth,component.region.height*photoHeight)*1.7 : 550);
  photoBox=[component.point.x*photoWidth-span/2,component.point.y*photoHeight-span/2,span,span];applyPhotoBox();
}
function renderMarkers(cable) {
  if (cable.axis !== lastPhotoAxis) {lastPhotoAxis = cable.axis; focusPhoto(null);}
  $('cabinet-markers').innerHTML=layout.components.map(component=>{
    const selected=component.id===cable.axis, x=component.point.x*photoWidth,y=component.point.y*photoHeight,r=component.region;
    return `<g class="photo-marker ${selected?'selected':'dim'}"><title>${h(component.label)} — planned axis identity; confirm on machine</title>${r?`<rect x="${r.x*photoWidth}" y="${r.y*photoHeight}" width="${r.width*photoWidth}" height="${r.height*photoHeight}" rx="10"></rect>`:''}<circle cx="${x}" cy="${y}" r="13"></circle><text x="${x-15}" y="${y-27}" text-anchor="middle">${h(component.label)}</text></g>`;
  }).join('');
}
$('cabinet-image').setAttribute('href',bundle.images.cabinet);$('cabinet-image').setAttribute('width',photoWidth);$('cabinet-image').setAttribute('height',photoHeight);applyPhotoBox();
const boardImage = $('board-image');
const boardImageStatus = $('board-image-status');
$('board-reference-link').href = bundle.boardReference.url;
$('board-frame').hidden = true;
boardImageStatus.textContent = bundle.boardReference.mode === 'external-reference'
  ? 'Board reference image requires internet; wire tables and preparation notes work offline.'
  : 'Loading the supplied board reference image; wire tables and preparation notes work offline.';
boardImage.addEventListener('load', () => {
  $('board-frame').hidden = false;
  boardImageStatus.textContent = bundle.boardReference.mode === 'external-reference'
    ? 'Official board reference image loaded from its pinned source. Match your actual board; no physical connection is verified.'
    : 'Supplied board reference image loaded. Match your actual board; no physical connection is verified.';
});
boardImage.addEventListener('error', () => {
  $('board-frame').hidden = true;
  boardImageStatus.textContent = 'Board image unavailable. Open the official reference using the link below when online; the wire tables and preparation notes still work.';
});
boardImage.setAttribute('href',bundle.images.board);
$('photo-fit').addEventListener('click',()=>focusPhoto(null));$('photo-drive').addEventListener('click',()=>focusPhoto(currentCable()?.axis));$('photo-octopus').addEventListener('click',()=>focusPhoto('octopus'));
function zoomPhoto(factor){const [x,y,w,ht]=photoBox;const width=Math.max(200,Math.min(photoWidth*1.5,w*factor));const height=ht*width/w;photoBox=[x+(w-width)/2,y+(ht-height)/2,width,height];applyPhotoBox();}
$('photo-plus').addEventListener('click',()=>zoomPhoto(.75));$('photo-minus').addEventListener('click',()=>zoomPhoto(1/.75));
let drag=null;
photo.addEventListener('pointerdown',event=>{if(event.button!==0)return;const matrix=photo.getScreenCTM();if(!matrix)return;drag={id:event.pointerId, x:event.clientX,y:event.clientY,box:[...photoBox],scaleX:matrix.a,scaleY:matrix.d};photo.setPointerCapture(event.pointerId);photo.classList.add('dragging');});
photo.addEventListener('pointermove',event=>{if(!drag||drag.id!==event.pointerId)return;photoBox=[drag.box[0]-(event.clientX-drag.x)/drag.scaleX,drag.box[1]-(event.clientY-drag.y)/drag.scaleY,drag.box[2],drag.box[3]];applyPhotoBox();});
function endDrag(){drag=null;photo.classList.remove('dragging');}photo.addEventListener('pointerup',endDrag);photo.addEventListener('pointercancel',endDrag);photo.addEventListener('lostpointercapture',endDrag);
$('board-zoom').addEventListener('click',()=>{const zoomed=$('board-frame').classList.toggle('zoomed');$('board-zoom').textContent=zoomed?'Fit board':'Enlarge board';});

function renderBoardGroup() {
  const group=bundle.boardContent.groups.find(item=>item.id===selectedBoardGroup);
  if(!group)return;
  $('board-area').value=group.id;
  $('board-group-title').textContent=group.title;
  $('board-group-status').textContent=group.status;
  $('board-location-label').textContent=group.title;
  $('board-location-status').textContent=group.status+' · GROUP LOCATION ONLY; MATCH PRINTED TERMINALS';
  const regions=boardRegionsForGroup(bundle.boardRegions.regions,group.id);
  $('board-region-caption').textContent=regions.length
    ? `${regions.map(region=>region.label).join(' · ')}. ${[...new Set(regions.map(region=>region.note).filter(Boolean))].join(' ')}`
    : 'No individual component location is asserted for this group. Use its named functions and notes below.';
  $('board-group-rows').innerHTML=group.rows.map(row=>`<tr><th scope="row">${h(row.terminal)}</th><td>${h(row.destination)}${row.cableIds?.length?`<div class="board-cable-links">${row.cableIds.map(id=>`<button data-board-cable="${h(id)}">${h(id)} ↗</button>`).join('')}</div>`:''}${row.relatedCableIds?.length?`<small class="board-related">Reference: ${row.relatedCableIds.map(h).join(', ')}. Use each cable's own view for its actual endpoints.</small>`:''}</td></tr>`).join('');
  $('board-group-notes').innerHTML=group.notes.map(note=>`<li>${h(note)}</li>`).join('');
  $('board-highlight').innerHTML=regions.map(region=>{const [x,y,w,height]=region.rect;return `<rect x="${x}" y="${y}" width="${w}" height="${height}" rx="8"><title>${h(region.label)} — component area only</title></rect>`;}).join('');
  document.querySelectorAll('[data-board-group]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.boardGroup===group.id)));
}
function selectBoardGroup(id){selectedBoardGroup=id;renderBoardGroup();}
$('board-area').innerHTML=bundle.boardContent.groups.map(group=>`<option value="${h(group.id)}">${h(group.title)}</option>`).join('');
$('board-area').addEventListener('change',event=>selectBoardGroup(event.target.value));
// Draw small subregions last so MAIN POWER and jumper fields remain clickable
// where they overlap a larger connector-bank region.
$('board-regions').innerHTML=[...bundle.boardRegions.regions].sort((a,b)=>b.rect[2]*b.rect[3]-a.rect[2]*a.rect[3]).map(region=>{const [x,y,w,height]=region.rect;return `<rect class="board-region" x="${x}" y="${y}" width="${w}" height="${height}" rx="5" data-board-region="${h(region.id)}" tabindex="0" role="button" aria-label="${h(region.label)}"><title>${h(region.label)}</title></rect>`;}).join('');
function activateBoardRegion(event){const region=event.target.closest('[data-board-region]');if(!region)return;selectBoardGroup(bundle.boardRegions.regions.find(item=>item.id===region.dataset.boardRegion).groups[0]);}
$('board-regions').addEventListener('click',activateBoardRegion);
$('board-regions').addEventListener('keydown',event=>{if(['Enter',' '].includes(event.key)){event.preventDefault();activateBoardRegion(event);}});
$('board-quick-picks').addEventListener('click',event=>{const button=event.target.closest('[data-board-group]');if(button)selectBoardGroup(button.dataset.boardGroup);});
$('board-group-rows').addEventListener('click',event=>{const button=event.target.closest('[data-board-cable]');if(!button)return;const cable=cables.find(item=>item.cable_id===button.dataset.boardCable);if(!cable)return;selectSystem(null);filters.archived=!cable.active_by_default;$('archived').checked=filters.archived;selectCable(cable.cable_id);switchView('trace',true);});
$('open-board').addEventListener('click',()=>{if(!currentCable())selectSystem(null);switchView('board',true);$('view-board').scrollIntoView({behavior:'smooth',block:'start'});});

for(const family of [...new Set(cables.map(cable=>cable.family))].sort()) {const option=document.createElement('option');option.value=family;option.textContent=familyNames[family]??family;$('family').append(option);}
$('coverage-scope').textContent = bundle.coverage.scope;
$('system-groups').innerHTML = bundle.coverage.groups.map(group=>{
  const members=cables.filter(cable=>group.cableIds.includes(cable.cable_id));
  const current=members.filter(cable=>cable.active_by_default).length, additional=members.length-current;
  return `<button class="system-card" data-system="${h(group.id)}" aria-pressed="false"><strong>${h(group.title)}</strong><span>${h(group.description)}</span><small>${current} current reference${current===1?'':'s'}${additional?` · ${additional} reserved / rollback`:''}</small></button>`;
}).join('');
$('coverage-gaps').innerHTML = bundle.coverage.gaps.map(gap=>`<article><h3>${h(gap.title)}</h3><strong>${h(gap.status)}</strong><p>${h(gap.detail)}</p></article>`).join('');
function selectSystem(id) {
  const group=bundle.coverage.groups.find(item=>item.id===id);
  activeSystemId=group?.id??null;filters.cableIds=group?.cableIds??null;
  filters.axis='all';filters.family='all';filters.search='';
  filters.archived=!!group && !cables.some(cable=>group.cableIds.includes(cable.cable_id)&&cable.active_by_default);
  $('family').value='all';$('search').value='';$('archived').checked=filters.archived;
  document.querySelectorAll('[data-axis]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.axis==='all')));
  routeId=null;focusedWire=null;render();switchView('trace');
  document.querySelector('.workspace').scrollIntoView({behavior:'smooth',block:'start'});
}
$('system-groups').addEventListener('click',event=>{const button=event.target.closest('[data-system]');if(button)selectSystem(button.dataset.system);});
$('system-all').addEventListener('click',()=>selectSystem(null));
$('search').addEventListener('input',event=>{filters.search=event.target.value;render();});$('family').addEventListener('change',event=>{filters.family=event.target.value;render();});$('archived').addEventListener('change',event=>{filters.archived=event.target.checked;render();});
$('axis-filter').addEventListener('click',event=>{const button=event.target.closest('[data-axis]');if(!button)return;filters.axis=button.dataset.axis;document.querySelectorAll('[data-axis]').forEach(item=>item.setAttribute('aria-pressed',String(item===button)));render();});
$('cable-list').addEventListener('click',event=>{const button=event.target.closest('[data-cable]');if(button)selectCable(button.dataset.cable);});
$('endpoints').addEventListener('click',event=>{const button=event.target.closest('[data-photo-id]');if(button){switchView('cabinet',true);focusPhoto(button.dataset.photoId);}});
$('route-choice').addEventListener('click',event=>{const button=event.target.closest('[data-route]');if(button){routeId=button.dataset.route;focusedWire=null;renderRoute(currentCable());}});
$('wire-diagram').addEventListener('click',event=>{const button=event.target.closest('[data-wire]');if(button){focusedWire=Number(button.dataset.wire);renderRoute(currentCable());}});
$('wire-previous').addEventListener('click',()=>{focusedWire=(focusedWire??0)-1;renderRoute(currentCable());});
$('wire-next').addEventListener('click',()=>{focusedWire=(focusedWire??0)+1;renderRoute(currentCable());});
document.querySelectorAll('[data-view]').forEach(button=>button.addEventListener('click',()=>switchView(button.dataset.view)));
document.querySelector('.view-tabs').addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const names=['trace','cabinet','board'];const index=names.indexOf(view);switchView(event.key==='Home'?names[0]:event.key==='End'?names[2]:names[(index+(event.key==='ArrowRight'?1:2))%3],true);});
$('previous').addEventListener('click',()=>selectCable(nextCable(candidates(),selectedId,-1)));$('next').addEventListener('click',()=>selectCable(nextCable(candidates(),selectedId,1)));
document.querySelectorAll('[data-check]').forEach(input=>input.addEventListener('change',()=>{currentRecord()[input.dataset.check]=input.checked;save();renderList(candidates());}));
$('cable-notes').addEventListener('input',event=>{currentRecord().notes=event.target.value;save();});

$('export-record').addEventListener('click',()=>{
  const exported={...record,exportedAt:new Date().toISOString(),sourceScheduleSha256:scheduleHash,hardwareApproved:false};
  const blob=new Blob([JSON.stringify(exported,null,2)+'\n'],{type:'application/json'}),url=URL.createObjectURL(blob),anchor=document.createElement('a');
  anchor.href=url;anchor.download='MR1-wiring-preparation.json';anchor.click();setTimeout(()=>URL.revokeObjectURL(url),15000);
  notify('Preparation record exported. It contains your labels and notes, not electrical approval.');
});
$('import-button').addEventListener('click',()=>$('import-record').click());
$('import-record').addEventListener('change',async event=>{
  const file=event.target.files[0],generation=++importGeneration;event.target.value='';if(!file)return;
  try {
    if(file.size>1024*1024)throw new Error('Preparation record is too large (maximum 1 MB).');
    const incoming=normalizePreparation(JSON.parse(await file.text()),cableIds,scheduleHash);if(generation!==importGeneration)return;
    let merged=0,conflicts=0;
    for(const [id,value] of Object.entries(incoming.records)) {
      const existing=record.records[id],hasExisting=existing&&(existing.notes||PREPARATION_STEPS.some(key=>existing[key]));
      if(hasExisting){if(JSON.stringify(existing)!==JSON.stringify(value))conflicts++;continue;}
      record.records[id]=value;merged++;
    }
    save();render();notify(`Imported ${merged} cable records. ${conflicts ? `${conflicts} existing records kept where contents differed. `:''}No hardware acceptance was imported.`, !storageWorks);
  } catch(error){notify(`Import was not applied: ${error.message}`,true);}
});
$('print-label').addEventListener('click',()=>{
  const cable=currentCable();if(!cable || currentRoute(cable).route.labelKind === 'functional-route')return;
  $('label-sheet').innerHTML=`<h1>MR1 · ${h(cable.cable_id)}</h1><p>Label both ends with the same cable ID. Identify actual terminal markings before landing conductors.</p><div class="label-pair">${labelMarkup(cable,'END A',cable.from_device)}${labelMarkup(cable,'END B',cable.to_device)}</div><dl><dt>Scheduled end A</dt><dd>${h(cable.from_device)} · ${h(cable.from_terminal)}<br>${h(endpointNotice({status:cable.endpoint_status?.from}))}</dd><dt>Scheduled end B</dt><dd>${h(cable.to_device)} · ${h(cable.to_terminal)}<br>${h(endpointNotice({status:cable.endpoint_status?.to}))}</dd></dl><p class="print-hold">UNPOWERED PREPARATION ONLY. Connector views, interface circuits and electrical acceptance remain to be verified. Cable colours and cavity numbers are not assigned by these labels.</p><ul>${(cable.missing_evidence??[]).slice(0,3).map(reason=>`<li>${h(reason)}</li>`).join('')}</ul>`;
  window.print();
});
render();
if(location.hash==='#octopus'){switchView('board');$('view-board').scrollIntoView({block:'start'});}
