import test from 'node:test';
import assert from 'node:assert/strict';
import { createNativeServiceLink } from '../src/native-service-link.js';
import { createHeartbeat } from '../src/native-heartbeat.js';

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

test('a failed read or heartbeat keeps the token so the owner can still stop', async () => {
  const calls=[], tokens=[]; let failHeartbeat=false;
  const {link,failures}=setup(async (path,options)=>{
    calls.push({path,session:options?.headers?.['X-MR1-Session']});
    if (path==='/api/session') return response({token});
    if (path==='/api/state') throw new TypeError('Failed to fetch');
    if (path==='/api/heartbeat' && failHeartbeat) return response({error:'Controller request failed.'},false);
    return response({});
  },{onToken:value=>tokens.push(value)});
  await link.session(); await link.poll();
  failHeartbeat=true; await link.poll();
  assert.deepEqual(failures,['Failed to fetch','Controller request failed.']);
  await link.session(); await link.request('/api/command',{action:'stop'});
  assert.equal(calls.filter(call=>call.path==='/api/session').length,1,'no new claim is needed');
  assert.equal(calls.at(-1).session,token);
  assert.deepEqual(tokens,[token]);
});

test('only an explicit rejection of the current token drops ownership', async () => {
  const tokens=[], other='b'.repeat(64); let claims=0;
  const {link}=setup(async path=>{
    if (path==='/api/session') return response({token:++claims===1?token:other});
    if (path==='/api/heartbeat') return response({error:'Controller session expired. Reclaim it before continuing.',sessionRejected:true},false);
    return response({});
  },{onToken:value=>tokens.push(value)});
  await link.session(); await link.poll();
  assert.deepEqual(tokens,[token,null]);
  await link.session(); link.rejected(token,'stale worker result');
  assert.deepEqual(tokens,[token,null,other]);
  link.rejected(other,'Controller session expired.');
  assert.deepEqual(tokens,[token,null,other,null]);
  link.close(); assert.deepEqual(tokens,[token,null,other,null]);
});

const settle = () => new Promise(resolve => setImmediate(resolve));
function fakeClock() {
  let now=0, next=1; const timers=new Map();
  return { now:()=>now, setTimer:(fn,ms)=>{ const id=next++; timers.set(id,{fn,at:now+ms}); return id; }, clearTimer:id=>timers.delete(id),
    pending:()=>timers.size,
    async advance(ms) {
      const end=now+ms;
      for (;;) {
        const due=[...timers].filter(([,timer])=>timer.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];
        if (!due) break;
        timers.delete(due[0]); now=due[1].at; due[1].fn();
        await settle();
      }
      now=end;
    } };
}

test('the worker heartbeat keeps a steady one-second cadence without overlapping requests', async () => {
  const clock=fakeClock(), sent=[], results=[]; let hold=null;
  const heartbeat=createHeartbeat({ ...clock, onResult:result=>results.push(result),
    fetchImpl:(path,options)=>{ sent.push({path,at:clock.now(),session:options.headers['X-MR1-Session'],method:options.method});
      return hold ? hold.promise : Promise.resolve(response({ok:true})); } });
  heartbeat.setToken(token);
  await clock.advance(3000);
  assert.deepEqual(sent.map(value=>value.at),[1000,2000,3000]);
  assert.ok(sent.every(value=>value.path==='/api/heartbeat' && value.method==='POST' && value.session===token));
  hold=deferred(); await clock.advance(1000);
  assert.equal(sent.length,4); await clock.advance(1500);
  assert.equal(sent.length,4,'no second request while one is outstanding');
  hold.resolve(response({ok:true})); hold=null; await settle();
  await clock.advance(0);
  assert.equal(sent.length,5,'an overdue beat follows immediately');
  heartbeat.setToken(null); await clock.advance(5000);
  assert.equal(sent.length,5); assert.equal(clock.pending(),0);
  assert.ok(results.every(result=>result.ok && result.token===token));
});

test('the worker heartbeat reports refusals and bounds a stalled request', async () => {
  const clock=fakeClock(), results=[]; let mode='refuse';
  const heartbeat=createHeartbeat({ ...clock, timeoutMs:2500, onResult:result=>results.push(result),
    fetchImpl:(_path,{signal})=>mode==='refuse'
      ? Promise.resolve(response({error:'Controller session expired.',sessionRejected:true},false))
      : new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error('aborted')),{once:true})) });
  heartbeat.setToken(token); await clock.advance(1000);
  assert.deepEqual(results[0],{token,ok:false,error:'Controller session expired.',sessionRejected:true});
  mode='stall'; await clock.advance(1000); await clock.advance(2500);
  assert.equal(results[1].sessionRejected,false); assert.match(results[1].error,/did not respond/);
  heartbeat.stop(); await clock.advance(5000);
  assert.equal(results.length,2); assert.equal(clock.pending(),0);
});

test('the worker heartbeat withholds the lease when the page stops reporting that it is alive', async () => {
  const clock=fakeClock(), sent=[];
  const heartbeat=createHeartbeat({ ...clock, fetchImpl:()=>{ sent.push(clock.now()); return Promise.resolve(response({ok:true})); } });
  heartbeat.setToken(token); heartbeat.pageAlive(true);
  await clock.advance(5000);
  assert.deepEqual(sent,[1000,2000,3000],'a visible page that stops reporting loses its lease after 3 s');
  heartbeat.pageAlive(true); await clock.advance(1000);
  assert.deepEqual(sent.slice(3),[6000],'a live page resumes the heartbeat');
  heartbeat.pageAlive(false); await clock.advance(89000);
  assert.equal(sent.length,93,'a hidden page is allowed throttled reports');
  await clock.advance(5000);
  assert.equal(sent.length,94,'a hidden page silent for more than 90 s loses its lease');
  heartbeat.stop(); await clock.advance(5000); assert.equal(clock.pending(),0);
});
