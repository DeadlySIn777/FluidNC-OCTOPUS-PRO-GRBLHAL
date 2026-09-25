import { readFile, writeFile, mkdir, stat, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, dirname, relative, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const inside = (base, path) => { const rel = relative(base, path); return rel !== '' && !isAbsolute(rel) && !rel.startsWith('..'); };

export function validateManifest(manifest) {
  if (manifest.schema !== 'mr1-local-assets-v1' || !Array.isArray(manifest.assets)) throw new Error('Invalid asset manifest.');
  const ids = new Set(), paths = new Set();
  for (const item of manifest.assets) {
    if (!/^[a-z0-9-]+$/.test(item.id) || ids.has(item.id) || paths.has(item.destination)
      || !Number.isSafeInteger(item.bytes) || item.bytes < 1 || !/^[a-f0-9]{64}$/.test(item.sha256)
      || !Array.isArray(item.sourcePaths) || !item.sourcePaths.length) throw new Error('Invalid or duplicate asset entry.');
    for (const path of [item.destination, ...item.sourcePaths]) {
      if (typeof path !== 'string' || path.includes('\\') || path.includes(':') || path.startsWith('/')
        || path.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('Unsafe asset path.');
    }
    ids.add(item.id); paths.add(item.destination);
  }
  return manifest;
}

async function readOptional(path) {
  try { return await readFile(path); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
function check(bytes, item, label) {
  if (bytes.length !== item.bytes || hash(bytes) !== item.sha256) throw new Error(`${item.id}: ${label} does not match the pinned size/SHA-256. No replacement written.`);
}
async function safeDestination(base, target) {
  if (!inside(base, target)) throw new Error('Destination escapes repository.');
  const canonicalBase = await realpath(base);
  let cursor = dirname(target);
  while (true) {
    try {
      const actual = await realpath(cursor);
      if (actual !== canonicalBase && !inside(canonicalBase, actual)) throw new Error('Destination directory link escapes repository.');
      break;
    } catch (error) { if (error.code !== 'ENOENT') throw error; cursor = dirname(cursor); }
  }
  try { const actual = await realpath(target); if (!inside(canonicalBase, actual)) throw new Error('Destination file link escapes repository.'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}

export async function processAssets({ repositoryRoot, manifest, from, only, verify = false }) {
  validateManifest(manifest);
  if (only && !manifest.assets.some(item => item.id === only)) throw new Error(`Unknown asset id: ${only}`);
  if (!verify && !from) throw new Error('Provide --from <existing app or portable directory>, or --verify.');
  if (from && !(await stat(from)).isDirectory()) throw new Error('--from must be a directory.');
  const plans = [], results = [];
  // Verify every selected source and existing destination before writing anything.
  for (const item of manifest.assets.filter(item => !only || item.id === only)) {
    const destination = resolve(repositoryRoot, item.destination);
    await safeDestination(repositoryRoot, destination);
    const existing = await readOptional(destination);
    if (existing) { check(existing, item, 'existing local file'); results.push({ id: item.id, status: 'verified' }); continue; }
    if (verify) { results.push({ id: item.id, status: 'missing' }); continue; }
    let source;
    for (const path of item.sourcePaths) {
      source = await readOptional(resolve(from, path));
      if (source) break;
    }
    if (!source) { results.push({ id: item.id, status: 'not-found-in-source' }); continue; }
    check(source, item, 'source');
    plans.push({ item, destination, source });
  }
  for (const { item, destination, source } of plans) {
    await mkdir(dirname(destination), { recursive: true });
    await safeDestination(repositoryRoot, destination);
    await writeFile(destination, source, { flag: 'wx' });
    results.push({ id: item.id, status: 'imported' });
  }
  return results;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || !args.length) {
    console.log('node tools/import-local-assets.mjs --from <existing mr1-control or portable directory> [--only <asset-id>]\nnode tools/import-local-assets.mjs --verify [--only <asset-id>]\nCopies exact, hash-pinned local files only. Never flashes, connects or downloads.');
    return;
  }
  const options = {};
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--verify') options.verify = true;
    else if (args[index] === '--from' || args[index] === '--only') {
      const key = args[index].slice(2), value = args[++index];
      if (!value || value.startsWith('--')) throw new Error(`Missing value for --${key}`);
      options[key] = key === 'from' ? resolve(value) : value;
    } else throw new Error(`Unknown option: ${args[index]}`);
  }
  const manifest = JSON.parse(await readFile(join(root, 'local-asset-manifest.json'), 'utf8'));
  const results = await processAssets({ repositoryRoot: root, manifest, ...options });
  console.log(JSON.stringify({ scope: 'local-files-only; no hardware acceptance', results }, null, 2));
  if (options.only && results.some(item => ['missing', 'not-found-in-source'].includes(item.status))) process.exitCode = 1;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
