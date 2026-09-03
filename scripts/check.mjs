import { readFile, readdir, access } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
const manifest = JSON.parse(await readFile('extension/manifest.json', 'utf8'));
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
if (pkg.version !== manifest.version) throw new Error('Version mismatch');
for (const dir of ['extension','scripts','site','ui-lens-bookmarklet']) {
  for (const file of await readdir(dir)) {
    if (!/\.(mjs|js)$/.test(file)) continue;
    const result = spawnSync(process.execPath, ['--check',join(dir,file)], {stdio:'inherit'});
    if (result.status) process.exit(result.status);
  }
}
for (const path of [...Object.values(manifest.icons), manifest.background.service_worker, ...manifest.content_scripts.flatMap(s => s.js)]) await access(join('extension',path));
for (const name of ['index.html','privacy.html','brand.html']) {
  const html = await readFile(join('site',name),'utf8');
  if (!html.includes('<title>') || !html.includes('name="viewport"')) throw new Error(`Missing metadata: ${name}`);
}
const landing = await readFile('site/index.html','utf8');
if (!landing.includes(`downloads/UIDelta-v${manifest.version}.zip`)) throw new Error('Update landing page download version');
console.log('JavaScript syntax, extension assets, versions and page metadata passed');
