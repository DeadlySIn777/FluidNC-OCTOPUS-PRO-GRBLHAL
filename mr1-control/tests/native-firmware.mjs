import test from 'node:test';
import { existsSync } from 'node:fs';
import { OCTOPUS_FIRMWARE_CANDIDATE } from '../src/wiring-installation.js';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { verifyNativeFirmware } from '../service/native-firmware.mjs';
import { createNativeServer } from '../service/native-server.mjs';

const source = new URL('../public/firmware/octopus-pro-v1.1-f429-mr1/', import.meta.url);
const optionalFirmware = existsSync(new URL('firmware.bin', source));
async function fixture(t) {
  const prefix=resolve(tmpdir(),'mr1-firmware-tests-');
  const root=await mkdtemp(prefix), directory=resolve(root,'firmware/octopus-pro-v1.1-f429-mr1');
  await mkdir(directory,{recursive:true});
  const bytes=optionalFirmware ? await readFile(new URL('firmware.bin',source)) : Buffer.alloc(OCTOPUS_FIRMWARE_CANDIDATE.bytes);
  const manifest=JSON.parse(await readFile(new URL('firmware-manifest.json',source),'utf8'));
  const save=async()=>{await writeFile(resolve(directory,'firmware.bin'),bytes);await writeFile(resolve(directory,'firmware-manifest.json'),JSON.stringify(manifest));};
  await save();
  t.after(async()=>{assert.ok(root.startsWith(prefix)&&root.length>prefix.length&&!root.slice(prefix.length).includes(sep));await rm(root,{recursive:true,force:true});});
  return {root,directory,bytes,manifest,save};
}

test('pinned distributed firmware verifies without claiming on-device flash evidence', { skip: !optionalFirmware && 'Optional local firmware image not imported.' }, async t=>{
  const f=await fixture(t), result=await verifyNativeFirmware(f.root);
  assert.equal(result.sha256,f.manifest.artifact.sha256); assert.equal(result.bytes,f.bytes.length);
  assert.equal(result.verificationScope,'bundled-file-only'); assert.equal(result.onDeviceFlashVerified,false);
});

test('changed bytes and a correspondingly edited manifest cannot redefine the pinned image', async t=>{
  const f=await fixture(t); f.bytes[100]^=1; await f.save();
  await assert.rejects(verifyNativeFirmware(f.root),/SHA-256/);
  f.manifest.artifact.sha256=createHash('sha256').update(f.bytes).digest('hex').toUpperCase(); await f.save();
  await assert.rejects(verifyNativeFirmware(f.root),/pinned MR1 production candidate/);
});

test('firmware metadata cannot substitute a different board, bootloader or artifact path', async t=>{
  const f=await fixture(t);
  const changes=[['boardIdentity','mcu','STM32F446'],['bootloader','applicationAddress','0x08000000'],
    ['artifact','filename','../../other.bin'],['preflight','simulationAccepted',true],['validation','physicalMotionPermitted',true]];
  for(const [group,key,value] of changes) {
    const original=f.manifest[group][key];f.manifest[group][key]=value;await f.save();
    await assert.rejects(verifyNativeFirmware(f.root),/pinned MR1 production candidate/);f.manifest[group][key]=original;
  }
});

test('truncated or missing firmware cannot start a native service or enumerate a port', async t=>{
  const f=await fixture(t); let enumerations=0, opens=0;
  await writeFile(resolve(f.directory,'firmware.bin'),f.bytes.subarray(0,100));
  await assert.rejects(createNativeServer({webRoot:f.root,journalDirectory:resolve(f.root,'journal'),
    listPorts:async()=>{enumerations++;return[];},portFactory:async()=>{opens++;}}),/byte count/);
  await rm(resolve(f.directory,'firmware.bin'));
  await assert.rejects(verifyNativeFirmware(f.root),/ENOENT/);
  assert.equal(enumerations,0);assert.equal(opens,0);
});

test('oversized manifest is rejected before parsing', async t=>{
  const f=await fixture(t);await writeFile(resolve(f.directory,'firmware-manifest.json'),' '.repeat(65537));
  await assert.rejects(verifyNativeFirmware(f.root),/oversized/);
});

test('manufactured bytes cannot satisfy the real pinned firmware startup gate', async t => {
  const f = await fixture(t); let opens = 0;
  await writeFile(resolve(f.directory, 'firmware.bin'), Buffer.alloc(OCTOPUS_FIRMWARE_CANDIDATE.bytes, 0x5A));
  await assert.rejects(createNativeServer({ webRoot: f.root, journalDirectory: resolve(f.root, 'journal'),
    portFactory: async () => { opens++; } }), /SHA-256/);
  assert.equal(opens, 0);
});
