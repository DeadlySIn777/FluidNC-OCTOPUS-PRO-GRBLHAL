import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(root, 'docs/wiring/visual/index.html');
const destination = join(root, 'mr1-control/public/wiring/visual/index.html');
const html = await readFile(source);
const expected = (await readFile(join(root, 'docs/wiring/visual/SHA256.txt'), 'utf8')).trim().split(/\s+/)[0].toLowerCase();
const actual = createHash('sha256').update(html).digest('hex');
if (!/^[a-f0-9]{64}$/.test(expected) || expected !== actual) throw new Error('Visual wiring guide checksum differs. Rebuild the source guide before building the application.');
await mkdir(dirname(destination), { recursive: true });
await writeFile(destination, html);
console.log(`Visual wiring guide copied into native application (${actual.slice(0, 12)}).`);

