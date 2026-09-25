// Child process for tests/native-server.mjs: a supervised service armed on a
// synthetic port. Realtime bytes are logged synchronously so the parent can see
// what reached the port before the process exited.
import { mock } from 'node:test';
import { appendFileSync, readFileSync } from 'node:fs';
import { REALTIME } from '../../service/native-controller.mjs';
import { WireController, profile } from './native-wire.mjs';

const [log, journalDirectory] = process.argv.slice(2);
const manifest = JSON.parse(readFileSync(new URL('../../public/firmware/octopus-pro-v1.1-f429-mr1/firmware-manifest.json', import.meta.url), 'utf8'));
mock.module('../../service/native-firmware.mjs', { namedExports: { verifyNativeFirmware: async () => ({ candidateId: manifest.candidateId, ...manifest.artifact }) } });
const { createNativeServer, superviseProcess } = await import('../../service/native-server.mjs');

class LoggedPort extends WireController {
  write(data, cb) {
    if (Buffer.isBuffer(data) && ![REALTIME.status, REALTIME.statusAll].includes(data[0])) appendFileSync(log, `0x${data[0].toString(16)}\n`);
    return super.write(data, cb);
  }
}
const port = new LoggedPort();
const service = await createNativeServer({ profile, listPorts: async () => [{ path: 'COM7' }], portFactory: async () => port,
  motionQualified: true, journalDirectory, leaseMs: 60_000 });
superviseProcess(service);
const origin = await service.start(0);
const post = async (path, input, token = '') => (await fetch(origin + path, { method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: origin, 'X-MR1-Session': token }, body: JSON.stringify(input) })).json();
const { token } = await post('/api/session', {});
await post('/api/connect', { port: 'COM7' }, token);
await post('/api/command', { action: 'arm', confirmed: true }, token);
if (!service.controller.armed) throw new Error('Synthetic controller did not arm.');
appendFileSync(log, 'READY\n');
process.stdin.setEncoding('utf8');
process.stdin.on('data', text => {
  if (text.includes('crash')) setImmediate(() => { throw new Error('synthetic crash'); });
  if (text.includes('reject')) void Promise.reject(new Error('synthetic rejection'));
});
process.stdout.write('READY\n');
