import test from 'node:test';
import assert from 'node:assert/strict';
import { createNativeServiceLink } from '../src/native-service-link.js';

const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return {promise,resolve,reject}; };
const response = (value, ok = true) => ({ ok, json: async () => value });
const token = 'a'.repeat(64);
function setup(fetchImpl, options = {}) {
  const states = [], failures = [];
  const link = createNativeServiceLink({ fetchImpl, onState:s=>states.push(s), onFailure:e=>failures.push(e.message), ...options });
  return { link, states, failures };
}

test('simultaneous session requests share one ownership claim and retain its token', async () => {
  const pending = deferred(), calls=[];
  const {link} = setup(async (path,options) => { calls.push({path,options}); return path==='/api/session' ? pending.promise : response({}); });
  const a=link.session(), b=link.session();
  assert.equal(a,b); assert.equal(calls.length,1);
  pending.resolve(response({token})); await Promise.all([a,b]);
  await link.request('/api/command',{action:'stop'});
  assert.equal(calls[1].options.headers['X-MR1-Session'],token);
  assert.equal(calls[1].options.signal,undefined, 'machine requests are not silently timed out or retried');
});

test('older state response cannot overwrite a newer disconnected state', async () => {
  const first=deferred(), second=deferred(); let count=0;
  const {link,states}=setup(()=>++count===1?first.promise:second.promise);
  const a=link.refresh(), b=link.refresh();
  second.resolve(response({connected:false})); await b;
  first.resolve(response({connected:true,armed:true})); await a;
  assert.deepEqual(states,[{connected:false}]);
});

test('newer state failure invalidates outstanding reads and late ownership claims', async () => {
  const claim=deferred(), first=deferred(), second=deferred(); let reads=0;
  const {link,states,failures}=setup(path=>path==='/api/session'?claim.promise:++reads===1?first.promise:second.promise);
  const session=link.session(), a=link.refresh(), b=link.refresh();
  second.reject(new Error('Service disappeared')); await assert.rejects(b,/disappeared/);
  first.resolve(response({connected:true,armed:true})); await a;
  claim.resolve(response({token})); await assert.rejects(session,/Session changed/);
  assert.deepEqual(states,[]); assert.deepEqual(failures,['Service disappeared']);
});

test('an obsolete failed read cannot erase a newer verified response', async () => {
  const first=deferred(), second=deferred(); let reads=0;
  const {link,states,failures}=setup(()=>++reads===1?first.promise:second.promise);
  const a=link.refresh(), b=link.refresh();
  second.resolve(response({connected:false,sequence:2})); await b;
  first.reject(new Error('Old request failed')); await assert.rejects(a,/Old request/);
  assert.deepEqual(states,[{connected:false,sequence:2}]); assert.deepEqual(failures,[]);
});

test('polling never overlaps and expired ownership cannot refresh an armed display', async () => {
  const heartbeat=deferred(), calls=[];
  const {link,states,failures}=setup(path=>{calls.push(path);return path==='/api/session'?response({token}):heartbeat.promise;});
  await link.session();
  const a=link.poll(), b=link.poll(); assert.equal(a,b);
  assert.deepEqual(calls,['/api/session','/api/heartbeat']);
  heartbeat.resolve(response({error:'Controller session expired.'},false)); await a;
  assert.deepEqual(states,[]); assert.match(failures[0],/expired/);
});

test('closing service suppresses pending responses and future browser requests', async () => {
  const pending=deferred(); let calls=0;
  const {link,states}=setup(()=>{calls++;return pending.promise;});
  const read=link.refresh(); link.close(); pending.resolve(response({connected:true})); await read;
  await link.poll(); await assert.rejects(link.session(),/closed/);
  await assert.rejects(link.request('/api/command',{action:'arm'}),/closed/);
  assert.equal(calls,1); assert.deepEqual(states,[]);
});

test('stalled reads have a bounded failure and never invent a connected state', async () => {
  const {link,states,failures}=setup((_path,{signal})=>new Promise((_resolve,reject)=>{
    signal.addEventListener('abort',()=>reject(new Error('aborted')),{once:true});
  }),{readTimeoutMs:20});
  await assert.rejects(link.refresh(),/did not respond/);
  assert.deepEqual(states,[]); assert.equal(failures.length,1);
});
