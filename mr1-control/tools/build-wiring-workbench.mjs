import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WIRING_PIN_SUMMARY as pins } from '../src/wiring-installation.js';

const app = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const destination = resolve(app, 'public/wiring');
await mkdir(destination, { recursive: true });
const esc = value => String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const rows = [];
const add = (id, from, to, domain, proof, disposition = 'HOLD - physical and circuit verification required') => rows.push({
  circuit_id:id, from_function:from, to_function:to, domain, required_proof:proof, disposition,
  actual_from_terminal:'', actual_to_terminal:'', conductor_label:'', wire_specification:'', protective_device_reference:'',
  deenergized_continuity_result:'', isolation_or_unintended_connection_result:'', artifact_reference:'', checked_by:'', checked_at:'' });
for (const axis of pins.motion) {
  for (const [name,gpio] of [['STEP',axis.step],['DIR',axis.direction]]) add(`SRC-${axis.axis}-${name}`,
    `${axis.socket} ${name} signal (${gpio}; 5 V buffered socket output)`, `${axis.axis} qualified interface ${name} input; actual terminal TBD`,
    'Controller logic / interface input', 'Actual v1.1 socket orientation, adapter retention and continuity; no plug-in stepper driver');
  add(`SRC-${axis.axis}-RETURN`,`${axis.socket} verified logic GND`,`${axis.axis} qualified interface logic return; terminal TBD`,
    'Controller logic return','Verify physical contact and intentional return topology; never substitute a phase or power contact');
  for (const name of ['PUL+','DIR+']) add(`CMD-${axis.axis}-${name.replace('+','PLUS')}`,
    'Reviewed protected 5 V command supply / motion-permit interface', `CL57T ${axis.axis} P1 ${name}`,
    '5 V command only', 'Drive V4.1 identity; S3=5 V; qualified interface circuit and loaded input voltage/current');
  for (const name of ['PUL-','DIR-']) add(`CMD-${axis.axis}-${name.replace('-','MINUS')}`,
    `${axis.axis} qualified ${name.startsWith('PUL')?'STEP':'DIR'} sink output; terminal TBD`, `CL57T ${axis.axis} P1 ${name}`,
    '5 V command only','Loaded pulse polarity, width, direction setup and power-transition behavior; no direct MCU connection');
  add(`ENC-${axis.axis}`,`Matched ${axis.axis} motor encoder factory harness`, `CL57T ${axis.axis} P2 EA+/EA-/EB+/EB-/VCC/EGND`,
    'Drive-supplied encoder domain','Verify same motor/drive pairing and actual harness continuity. VCC is an output; no external supply. Do not guess wire colours.');
  add(`MOTOR-${axis.axis}`,`Matched ${axis.axis} motor phase factory harness`,`CL57T ${axis.axis} P3 A+/A-/B+/B-`,
    'Motor phases','Verify matched harness, pair identities, retention and strain relief with power absent; preserve encoder phase relationship');
  add(`BUS-${axis.axis}`,`Reviewed 36 V distribution / individual fused ${axis.axis} branch`,`CL57T ${axis.axis} P4 +VDC / GND`,
    'Polarized motion DC','Actual supply/branch design, conductor and fuse ratings, polarity, unloaded voltage, loaded transient qualification');
  add(`ALM-${axis.axis}`,`CL57T ${axis.axis} P1 ALM / COMO`,`${axis.axis} separate isolated alarm conditioner; actual terminals TBD`,
    'Drive alarm field domain','Measured healthy, alarm, lost-power and open-cable truth table; current limiting and supervision schematic');
  add(`RES-${axis.axis}`,`${axis.socket} EN (${axis.enable})`,`CL57T ENA+/ENA-: leave unconnected in active baseline`,
    'Reserved, not a safety function','No enable harness is released by this worksheet','UNUSED - do not populate without separately reviewed change');
}
for (const input of pins.inputs) add(`IN-${input.gpio}`,'Verified dry contact or isolated conditioned output; actual source TBD',
  `${input.connector} ${input.gpio} and verified logic return`, '3.3 V controller input domain',
  input.gpio==='PB1' ? 'All four conditioned healthy channels combined; any alarm, open wire or power loss must assert fault. Never chain raw ALM outputs into PB1.'
    : /^PG1[2-5]$/.test(input.gpio) ? 'Individual conditioned indication only; no protective stop credit'
    : 'Physical header orientation, source circuit, active/inactive/open/lost-power truth table; no field supply on GPIO');
for (const output of pins.outputs) add(`OUT-${output.gpio}`,`${output.connector} switched power output (${output.gpio})`,
  'Qualified isolated/relay interface; actual terminal TBD', 'Switched low side, not a GPIO/logic ground',
  'Actual positive-side voltage selection, load/interface ratings and suppression; spindle also requires exact drive identity and scaling',
  'HOLD - leave field connection unpopulated during initial motion wiring');
add('CTRL-24V','Reviewed fused 24 V control supply','Octopus POWER / MAIN VIN and GND terminals',
  '24 V control DC','Actual terminal labels and orientation, polarity, input selector, wire/fuse design and USB return topology. MOTOR POWER and BED POWER unused.');
add('PE-BONDS','Protective-earth system','Cabinet, frame and required conductive parts',
  'Protective earth','Qualified protective-bond design and test; keep separate from signal-return assumptions');

const fields = Object.keys(rows[0]);
const csv = [fields, ...rows.map(row => fields.map(field => row[field]))]
  .map(row => row.map(value => '"'+String(value).replaceAll('"','""')+'"').join(',')).join('\r\n')+'\r\n';
await writeFile(join(destination, 'circuit-ledger.csv'), '\uFEFF'+csv);
const table = (head, body) => `<table><thead><tr>${head.map(h=>`<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${body.map(row=>`<tr>${row.map(v=>`<td>${esc(v)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
const axisTable = table(['Label both ends','Octopus socket','STEP / DIR','Reserved EN, unused'], pins.motion.map(a=>[a.axis,a.socket,`${a.step} / ${a.direction}`,a.enable]));
const inputTable = table(['Function','Board reference','GPIO'], pins.inputs.map(i=>[i.role,i.connector,i.gpio]));
const outputTable = table(['Output','Board reference','Disposition'],pins.outputs.map(o=>[o.role,`${o.connector} / ${o.gpio}`,'HOLD: switched power output; qualified interface required']));
const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MR1 wiring workbench</title><style>
*{box-sizing:border-box}body{margin:0;background:#eceff2;color:#19212a;font:15px/1.45 system-ui,sans-serif}main{max-width:1020px;margin:auto;padding:28px}.page{background:white;padding:32px;margin-bottom:22px;border:1px solid #ccd2d9}h1{font-size:32px;margin:6px 0 16px}h2{font-size:22px;margin:0 0 14px}h3{font-size:16px;margin:20px 0 8px}p{margin:10px 0}.eyebrow{font-size:12px;letter-spacing:.09em;text-transform:uppercase;color:#46556a}.hold{border-left:6px solid #b13128;background:#fff0ed;padding:14px 18px}.note{background:#edf3fa;padding:12px 16px}table{width:100%;border-collapse:collapse;margin:12px 0;font-size:13px}th,td{text-align:left;vertical-align:top;padding:9px;border:1px solid #bbc4cf}th{background:#e9edf2}td{overflow-wrap:anywhere}li{margin:7px 0}.blank{color:#526174;line-height:2}.small{font-size:12px}a{color:#124d85}svg{width:100%;height:auto}.footer{border-top:1px solid #bbc4cf;padding-top:10px;font-size:12px;color:#526174}.label-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}.label{padding:12px;border:2px dashed #66778a;text-align:center;font-weight:700;letter-spacing:.06em}.label small{display:block;font-size:10px;letter-spacing:0;font-weight:400}@media print{body{background:white;font-size:10pt}main{padding:0;max-width:none}.page{border:0;margin:0;padding:8mm;break-after:page}.page:last-child{break-after:auto}h1{font-size:23pt}h2{font-size:17pt}table{font-size:9pt}th,td{padding:5px}a{color:inherit}tr,.hold,.note,.label-grid{break-inside:avoid}.screen{display:none}@page{size:letter;margin:9mm}}
</style><main>
<section class="page"><div class="eyebrow">MR1 / CL57T V4.1 / Wiring workbench · 24 September 2026</div><h1>Start with the unpowered build.</h1>
<div class="hold"><strong>This is a preparation and inspection worksheet, not a released electrical schematic.</strong> The interface, connector faces, protection ratings and safety circuit still need physical verification. Nothing here authorizes energizing or machining.</div>
<h3>Useful work to do now</h3><ol><li>Keep mains, spindle, DC supplies and USB disconnected; establish and verify the de-energized condition before continuity work. Hazardous-energy work needs an appropriately qualified person.</li><li>Record the board revision and MCU, each drive revision, motor labels and every connector face. Preserve the stock wiring and settings backup.</li><li>Label both ends of each drive, motor and encoder set <strong>X, YL, Z or YR</strong>. Keep matched phase and encoder harnesses together.</li><li>Dry-fit retained, keyed adapters and route cables with strain relief. Separate motor/bus wiring from encoder and low-voltage signal wiring. Verify reach before cutting or drilling.</li><li>Trace and record each proposed connection in the <a href="circuit-ledger.csv">blank circuit ledger</a>. Leave unknown interface terminals, fuse sizes, wire ratings and physical cavity numbers blank and on HOLD.</li></ol>
<h3>Do not guess these five things</h3><ul><li><strong>Connector orientation:</strong> a schematic contact number is not a count from the top of a rotated board or a view into a mating plug.</li><li><strong>Voltage domains:</strong> P4 is polarized motion power; P1 uses the qualified 5 V command interface; P2 VCC is the drive's encoder-supply output.</li><li><strong>Module identity:</strong> “TLP281” or “HW-399” does not establish the board circuit. An unpowered common pull-up rail can still couple channels.</li><li><strong>Fault protection:</strong> PB1 needs the combined conditioned healthy signals. PG12–PG15 are diagnostic indications. Raw ALM/COMO outputs are not assumed dry contacts.</li><li><strong>Power and spindle:</strong> the recorded 36 V/10 A supply has not been accepted for simultaneous loading; spindle scaling and its field interface remain unresolved.</li></ul>
<div class="label-grid">${['X','YL · Y-LEFT','Z','YR · Y-RIGHT'].map(a=>`<div class="label">${a}<small>Drive + motor + encoder: keep the same set</small></div>`).join('')}</div>
<p class="blank">Build identifier ____________________  Operator ____________________<br>Board / drive label record ____________________  Date ____________________</p><div class="footer">Keep physical acceptance records blank until measured. The existing 3D preview and old photo overlays do not prove connector locations or electrical clearance.</div></section>

<section class="page"><div class="eyebrow">02 / Motion circuits</div><h2>Four motors, three logical axes</h2>${axisTable}
<p>The two Y drives move one gantry. A logical Y jog commands both outputs; it does not independently verify either motor. Actual directions and coupler fit are still unproven.</p>
<div class="note">Driver-socket references: STEP = schematic contact 7, DIR = 8, logic GND = 9; EN = 1 is reserved. The Octopus v1.1 schematic uses 5 V buffers on these socket signals. Confirm the actual footprint view and keying before mating an adapter. No plug-in stepper driver or motor phase wire belongs in this command path.</div>
<h3>Drive connector functions — match printed names, never wire colour</h3>${table(['Block','Function','Required distinction'],[
['P1','PUL± / DIR±; ALM / COMO','Commands pass through a qualified interface. ENA remains unconnected; BRK unused.'],
['P2','EA± / EB± / VCC / EGND','Matched encoder harness. VCC is supplied by this drive; no external supply or improvised ground bond.'],
['P3','A± / B±','Matched motor phases only. Preserve phase/encoder relationship.'],
['P4','+VDC / GND','Polarized motion DC, separate reviewed fused star branch per drive.'],
['P5','Tuning connection','Unused for machine control; verify the actual connector and manufacturer cable before any tuning connection.']])}
<h3>Initial switch plan, pending actual V4.1 inspection</h3>${table(['Switch','Project starting value','Record all four drives'],[
['S1','4: 4 A RMS / 5.6 A peak; initial gain preset','X____ YL____ Z____ YR____'],
['S2 SW1–4','ON / OFF / ON / ON: 1600 pulses/revolution','X____ YL____ Z____ YR____'],
['S2 SW5','OFF provisionally; establish actual physical direction later','X____ YL____ Z____ YR____'],
['S2 SW6–8','OFF / OFF / OFF: closed loop, PUL/DIR, 1.5 ms filter','X____ YL____ Z____ YR____'],
['S3','5 V, only with the qualified 5 V command circuit','X____ YL____ Z____ YR____']])}
<p class="hold">Set switches with power absent. Never connect or disconnect motor, encoder or power plugs while energized. Do not use a jammed axis or an unplugged live encoder as an improvised fault test.</p><div class="footer">The drive closes the motor encoder loop internally. PC coordinates do not independently measure couplers, ballscrews or table position. Switch values are intended settings, not a record of installation.</div></section>

<section class="page"><div class="eyebrow">03 / Inputs and outputs</div><h2>Signal names before cavity numbers</h2>${inputTable}
<p class="small">“DIAG/STOP” names identify shared board nets. Remove the relevant driver DIAG links only after identifying them on the actual board. Use verified signal and return contacts; leave adjacent supply cavities unpopulated in signal-only adapters. The PB7 tool-setter header is labelled BLTouch on the board, but no BLTouch device or plugin is used.</p>
<h3>Expected conditioned input behavior</h3><p>Home inputs and the PB1 fault aggregate must be healthy-low and become high on the specified trigger/fault, open cable or lost field power. The active-low probe and setter need their own proven input truth tables. These are circuit requirements, not a claim that a generic isolation module achieves them.</p>
<p class="note">The app's <strong>Read-only wiring diagnostics</strong> displays decoded logical state and can export labelled observations while disarmed. It does not measure volts, certify an E-stop, distinguish both Y limit channels, show individual PG12–PG15 drive states, or show the unselected probe.</p>
${outputTable}<p>FAN and heater output minus terminals are switched power returns, not signal ground. FAN positive voltage depends on the actual selector. Do not attach spindle or coolant field wiring from GPIO names alone.</p><div class="footer">The cabinet's independent safety circuit removes hazardous-energy permission. The Octopus E-stop input is a monitor; Windows and USB are not the safety circuit.</div></section>

<section class="page"><div class="eyebrow">04 / Hold points and records</div><h2>Separate construction from first power</h2>${table(['Hold point','Evidence needed to advance','Record'],[
['Identity and de-energized fit','Correct revisions, matching motor/encoder sets, connector views, adapter retention and mechanical fit','________________'],
['Electrical design','Reviewed interface schematic, terminal list, conductor/fuse ratings, PE/return topology, independent stop and restart prevention','________________'],
['Isolated electrical tests','Supply polarity/capacity; loaded pulse waveform; each channel healthy/active/open/lost-power and channel independence','________________'],
['Read-only board connection','Identity/settings/startup readback, complete fresh status; no automatic unlock or motion','________________'],
['Uncoupled first motion','Secured loose motors, axes uncoupled, Z supported, spindle isolated, hardwired stop proven; explicitly reviewed limited stage','________________'],
['Coupled operation','Direction and scale, independent dual-Y homing/squaring, bounds, fault response, probe and spindle acceptance','________________']])}
<h3>Record a channel test without hiding the unknowns</h3>${table(['Condition','Field measurement + instrument','Controller logical report','Evidence file'],[
['Healthy / untriggered','________________','________________','________________'],
['Triggered / approved alarm','________________','________________','________________'],
['Open field cable, using an approved test method','________________','________________','________________'],
['Field power lost','________________','________________','________________'],
['Other channels individually active','________________','________________','________________'],
['Power-up and power-down transitions','________________','________________','________________']])}
<p>Continuity and resistance tests use an unpowered, isolated circuit. Powered voltage, waveform and fault tests require the reviewed setup and suitable instruments; no ohmmeter on an energized output. A single successful channel does not qualify the remaining three.</p>
<h3>Keep with this worksheet</h3><ul><li><a href="circuit-ledger.csv">Circuit ledger CSV</a> — ${rows.length} planned functional circuits, all HOLD or UNUSED, with blank physical terminals and inspection fields. It is not a complete cabinet/mains wire list.</li><li>Corrected wiring reference bundle and its SHA-256 manifest; retain the actual board and drive manuals.</li><li>Build photographs, actual interface circuit, stock backup, test instruments and readings, then the separate commissioning record.</li></ul>
<p class="small">Primary references: <a href="https://github.com/bigtreetech/BIGTREETECH-OCTOPUS-Pro">BTT Octopus Pro v1.1 source</a>; <a href="https://www.omc-stepperonline.com/download/CL57T-V41_user_manual.pdf">CL57T V4.1 manufacturer manual</a>. Machine GPIO assignments come from the pinned MR1 board map and application wiring summary. Planned interface terminals are explicitly TBD.</p><div class="footer">No software test, checksum, worksheet completion or controller status substitutes for physical electrical and mechanical acceptance.</div></section></main></html>`;
await writeFile(join(destination, 'workbench.html'), html);
console.log(JSON.stringify({ circuits:rows.length, destination, populatedPhysicalEvidence:0 }));
