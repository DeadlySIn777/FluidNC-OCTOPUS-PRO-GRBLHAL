import { cp, mkdir, readFile, writeFile, readdir, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, dirname, relative, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { verifyNativeFirmware } from '../service/native-firmware.mjs';
import { isOutsideDirectory } from './path-containment.mjs';

const app = resolve(dirname(fileURLToPath(import.meta.url)), '..');
await verifyNativeFirmware(join(app, 'dist'));
const sourceRevision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: app, encoding: 'utf8' }).trim();
const sourceDirty = execFileSync('git', ['status', '--porcelain'], { cwd: app, encoding: 'utf8' }).trim().length > 0;
const destination = process.argv[2] && resolve(process.argv[2]);
if (!destination || !isOutsideDirectory(app, destination)) throw new Error('Specify a new output directory outside the source app.');
// Never delete or replace an existing package; use a new directory per build.
await mkdir(destination);
for (const name of ['dist', 'src', 'service', 'post-processors']) await cp(join(app, name), join(destination, name), { recursive: true });
for (const name of ['package.json', 'package-lock.json', 'NATIVE_CONTROL.md', 'THIRD-PARTY-NOTICES.md', 'index.html', 'vite.config.js']) await cp(join(app, name), join(destination, name));
for (const name of ['START-MR1-NATIVE.cmd', 'START-MR1-NATIVE.ps1']) await cp(join(app, 'portable', name), join(destination, name));
await mkdir(join(destination, 'runtime'));
await cp(process.execPath, join(destination, 'runtime', 'node.exe'));
const copied = new Map();
async function copyDependency(name, from) {
  // Resolve the installed dependency tree, including scoped packages.
  let cursor = from;
  let directory;
  while (true) {
    const candidate = join(cursor, 'node_modules', name);
    try { await stat(join(candidate, 'package.json')); directory = candidate; break; } catch {}
    const parent = dirname(cursor); if (parent === cursor) throw new Error(`Missing dependency ${name}`); cursor = parent;
  }
  const manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
  const installedPath = relative(join(app, 'node_modules'), directory);
  if (isOutsideDirectory(join(app, 'node_modules'), directory)) throw new Error(`Dependency resolved outside the installed app tree: ${name}`);
  const key = installedPath.replaceAll('\\', '/');
  if (copied.has(key)) return;
  copied.set(key, manifest.version);
  const target = join(destination, 'node_modules', installedPath);
  await mkdir(dirname(target), { recursive: true });
  await cp(directory, target, { recursive: true, dereference: true, filter: path => !relative(directory, path).split(/[\\/]/).includes('node_modules') });
  for (const child of Object.keys(manifest.dependencies ?? {})) await copyDependency(child, directory);
}
await copyDependency('serialport', app);
const artifacts = [];
async function inventory(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await inventory(path);
    else {
      const bytes = await readFile(path);
      artifacts.push({ path: relative(destination, path).replaceAll('\\', '/'), bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
    }
  }
}
await inventory(destination);
artifacts.sort((a, b) => a.path.localeCompare(b.path));
await writeFile(join(destination, 'BUILD-MANIFEST.json'), JSON.stringify({
  product: 'MR1 Native Control', stage: 'engineering / hardware uncommissioned', builtAt: new Date().toISOString(),
  sourceRevision, sourceDirty,
  runtime: process.version, platform: process.platform, architecture: process.arch,
  serialDependencies: Object.fromEntries(copied), artifacts,
}, null, 2) + '\n');
console.log(JSON.stringify({ destination, files: artifacts.length, dependencies: copied.size }));
