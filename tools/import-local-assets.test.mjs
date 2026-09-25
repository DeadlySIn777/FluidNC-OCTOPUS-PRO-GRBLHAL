import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { processAssets, validateManifest } from './import-local-assets.mjs';

const bytes = Buffer.from('synthetic asset fixture, never firmware');
const fixture = () => ({ schema: 'mr1-local-assets-v1', assets: [{ id: 'fixture', destination: 'app/fixture.bin', sourcePaths: ['fixture.bin'], bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }] });
async function setup(t) {
  const directory = await mkdtemp(join(tmpdir(), 'mr1-import-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const repositoryRoot = join(directory, 'repository'), from = join(directory, 'source');
  await mkdir(repositoryRoot); await mkdir(from);
  return { repositoryRoot, from, manifest: fixture() };
}
test('imports pinned bytes and a second pass verifies without replacing them', async t => {
  const options = await setup(t); await writeFile(join(options.from, 'fixture.bin'), bytes);
  assert.equal((await processAssets(options))[0].status, 'imported');
  assert.deepEqual(await readFile(join(options.repositoryRoot, 'app/fixture.bin')), bytes);
  assert.equal((await processAssets(options))[0].status, 'verified');
});
test('a wrong source is refused before any destination is written', async t => {
  const options = await setup(t); await writeFile(join(options.from, 'fixture.bin'), 'wrong bytes');
  await assert.rejects(processAssets(options), /pinned size\/SHA-256/);
  await assert.rejects(readFile(join(options.repositoryRoot, 'app/fixture.bin')), { code: 'ENOENT' });
});
test('an existing mismatched file is never replaced', async t => {
  const options = await setup(t); await mkdir(join(options.repositoryRoot, 'app'));
  await writeFile(join(options.repositoryRoot, 'app/fixture.bin'), 'keep me');
  await writeFile(join(options.from, 'fixture.bin'), bytes);
  await assert.rejects(processAssets(options), /existing local file/);
  assert.equal(await readFile(join(options.repositoryRoot, 'app/fixture.bin'), 'utf8'), 'keep me');
});
test('missing optional files are reported explicitly', async t => {
  const options = await setup(t);
  assert.equal((await processAssets({ ...options, verify: true }))[0].status, 'missing');
  assert.equal((await processAssets(options))[0].status, 'not-found-in-source');
});
test('traversal, absolute paths and duplicate entries are rejected', () => {
  for (const path of ['../outside', '/outside', 'C:/outside', 'safe/../../outside', 'safe\\outside']) {
    const manifest = fixture(); manifest.assets[0].destination = path;
    assert.throws(() => validateManifest(manifest), /Unsafe asset path/);
  }
  const duplicate = fixture(); duplicate.assets.push(duplicate.assets[0]);
  assert.throws(() => validateManifest(duplicate), /duplicate/);
});
test('unknown ids are errors rather than successful no-op imports', async t => {
  const options = await setup(t);
  await assert.rejects(processAssets({ ...options, only: 'unknown' }), /Unknown asset id/);
});
