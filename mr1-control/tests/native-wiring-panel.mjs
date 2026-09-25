import test from 'node:test';
import assert from 'node:assert/strict';
import { wiringDiagnostic } from '../src/native-wiring-panel.js';
import { parseGrblStatus } from '../src/telemetry/grbl-status.js';

const now = Date.parse('2026-09-24T23:00:00Z');
function snapshot(raw = '<Idle|MPos:0,0,0|FS:0,0|Pn:YF|H:0,0|A:|P:0>') {
  return { connected: true, armed: false, busy: false, fault: null,
    status: parseGrblStatus(raw, null, { receivedAt: new Date(now).toISOString() }),
    preflight: { settings: [{ id:10,actual:511,status:'PASS' },{ id:13,actual:0,status:'PASS' }] } };
}
test('wiring diagnostics preserve logical Y and aggregate fault without inventing individual drive states', () => {
  const view = wiringDiagnostic(snapshot(), now);
  assert.equal(view.valid, true); assert.equal(view.staticCaptureAllowed, true);
  assert.equal(view.inputs.find(i => i.label.startsWith('Y limit')).value, 'ACTIVE');
  assert.equal(view.inputs.find(i => i.label === 'Aggregate drive fault').value, 'ACTIVE');
  assert.equal(view.inputs.filter(i => /PG1[2-5]/.test(i.connector)).length, 0);
  assert.match(view.explanation, /does not prove/);
});
test('disconnected, stale, future-dated and unverified reports remain unknown', () => {
  for (const candidate of [{...snapshot(),connected:false},{...snapshot(),preflight:null},
    {...snapshot(),preflight:{settings:[{id:10,actual:0,status:'FAIL'},{id:13,actual:0,status:'PASS'}]}}]) {
    const view = wiringDiagnostic(candidate, now); assert.equal(view.valid,false);
    assert.ok(view.inputs.every(i=>i.value==='UNKNOWN')); assert.equal(view.staticCaptureAllowed,false);
  }
  for (const time of [now+1500,now-1]) assert.equal(wiringDiagnostic(snapshot(),time).valid,false);
});
test('only the selected probe is identified and motion cannot be captured as a static wiring check', () => {
  const value = snapshot('<Idle|MPos:0,0,0|FS:0,0|Pn:P|P:1>');
  const view = wiringDiagnostic(value, now);
  assert.equal(view.inputs.at(-1).label,'Selected tool setter'); assert.equal(view.inputs.at(-1).value,'ACTIVE');
  assert.equal(wiringDiagnostic({...value,armed:true},now).staticCaptureAllowed,false);
  assert.equal(wiringDiagnostic({...value,busy:true},now).staticCaptureAllowed,false);
  value.status.state.name='Run'; assert.equal(wiringDiagnostic(value,now).staticCaptureAllowed,false);
});
