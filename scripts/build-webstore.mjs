import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { createStoredZip } from '../extension/zip-store.js';

// Separate from the unpacked-install release: Web Store requires manifest.json
// at the ZIP root. An explicit allowlist keeps fixtures and local data out.
const root = new URL('../', import.meta.url);
const manifestBytes = await readFile(new URL('extension/manifest.json', root));
const manifest = JSON.parse(manifestBytes);
if (manifest.manifest_version !== 3) throw new Error('Expected Manifest V3');
if (!manifest.description || manifest.description.length > 132) throw new Error('Invalid store description');
const files = [...new Set([
  'manifest.json', 'content.js', 'compare-engine.js', 'service-worker.js', 'zip-store.js',
  'popup.html', 'popup.css', 'popup.js', ...Object.values(manifest.icons),
  ...['html', 'xlsx', 'zip'].map(format => `previews/${format}-preview@2x.png`)
])];
const required = [manifest.background.service_worker,
  ...manifest.content_scripts.flatMap(item => [...(item.js || []), ...(item.css || [])]),
  ...Object.values(manifest.action.default_icon || {}), manifest.action.default_popup].filter(Boolean);
for (const file of required) if (!files.includes(file)) throw new Error(`Runtime file missing from allowlist: ${file}`);
const entries = await Promise.all(files.map(async name => ({name, data:await readFile(new URL('extension/' + name, root))})));
entries.push({name:'LICENSE', data:await readFile(new URL('LICENSE', root))});
const bytes = await createStoredZip(entries);
const directory = process.argv[2] ? resolve(process.argv[2]) : new URL('release/webstore/', root).pathname;
await mkdir(directory, {recursive:true});
const name = `UIDelta-v${manifest.version}-chrome-web-store.zip`;
const hash = createHash('sha256').update(bytes).digest('hex');
await writeFile(join(directory, name), bytes);
await writeFile(join(directory, name + '.sha256'), `${hash}  ${name}\n`);
console.log(`${join(directory, name)}\n${entries.length} files; manifest at ZIP root; ${(bytes.length / 1024 / 1024).toFixed(2)} MiB\nSHA-256 ${hash}`);
