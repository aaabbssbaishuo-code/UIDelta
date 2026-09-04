import { readFile, writeFile, readdir, mkdir, cp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createStoredZip } from '../extension/zip-store.js';
const manifest = JSON.parse(await readFile('extension/manifest.json', 'utf8'));
const packageInfo = JSON.parse(await readFile('package.json', 'utf8'));
if (packageInfo.version !== manifest.version) throw new Error('Package and extension versions must match');
const version = manifest.version;
const date = new Date('2026-09-04T00:00:00Z');
const runtimeFiles = ['manifest.json','content.js','compare-engine.js','service-worker.js','zip-store.js','popup.html','popup.css','popup.js', ...Object.values(manifest.icons), ...['html','xlsx','zip'].map(format => `previews/${format}-preview@2x.png`)];
const entries = await Promise.all(runtimeFiles.map(async name => ({ name:`UIDelta/${name}`, data:await readFile(join('extension', name)) })));
entries.push({ name:'UIDelta/LICENSE', data:await readFile('LICENSE') });
entries.push({ name:'UIDelta/INSTALL.md', data:await readFile('docs/INSTALL.md') });
await mkdir('release', {recursive:true});
await mkdir('site/downloads', {recursive:true});
const artifacts=[];
async function saveArtifact(name,entries){
  const bytes=await createStoredZip(entries,date);
  await writeFile(join('release',name),bytes);
  await writeFile(join('site/downloads',name),bytes);
  artifacts.push([name,bytes]);
}
async function treeEntries(directory,prefix){
  const entries=[];
  for(const item of (await readdir(directory,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
    if(item.name.startsWith('.'))continue;
    const file=join(directory,item.name),name=`${prefix}/${item.name}`;
    if(item.isDirectory())entries.push(...await treeEntries(file,name));
    else if(/\.(svg|png|md|html|css|json)$/.test(item.name))entries.push({name,data:await readFile(file)});
  }
  return entries;
}
await saveArtifact(`UIDelta-v${version}.zip`,entries);
const brandEntries=await treeEntries('brand','UIDelta-brand');
brandEntries.push({name:'UIDelta-brand/LICENSE',data:await readFile('LICENSE')});
await saveArtifact('UIDelta-brand-kit.zip',brandEntries);
const campaignNames=['cover-16x9','feature-inspect-16x9','feature-delivery-16x9'];
const campaignFiles=[...campaignNames.flatMap(name=>[name+'.png',name+'.html']),'campaign-16x9.css','icon.svg','mark.svg'];
const campaignEntries=await Promise.all(campaignFiles.map(async name=>({name:`UIDelta-promo-16x9/${name}`,data:await readFile(join('brand',name))})));
campaignEntries.push(...await treeEntries('brand/screenshots','UIDelta-promo-16x9/screenshots'));
campaignEntries.push({name:'UIDelta-promo-16x9/README.md',data:await readFile('brand/CAMPAIGN-README.md')});
campaignEntries.push({name:'UIDelta-promo-16x9/AGENT-HANDOFF.md',data:await readFile('docs/AGENT-HANDOFF.md')});
campaignEntries.push({name:'UIDelta-promo-16x9/LICENSE',data:await readFile('LICENSE')});
await saveArtifact('UIDelta-promo-16x9.zip',campaignEntries);
const hoverEntries=await treeEntries('brand/delivery-previews','UIDelta-delivery-previews');
hoverEntries.push({name:'UIDelta-delivery-previews/LICENSE',data:await readFile('LICENSE')});
await saveArtifact('UIDelta-delivery-previews.zip',hoverEntries);
const marketingEntries=await treeEntries('brand','UIDelta-marketing/brand');
marketingEntries.push(...await treeEntries('docs/marketing','UIDelta-marketing/docs/marketing'));
for(const name of ['AGENT-HANDOFF.md','LAUNCH-COPY.md','PRODUCT.md'])marketingEntries.push({name:`UIDelta-marketing/docs/${name}`,data:await readFile(join('docs',name))});
marketingEntries.push({name:'UIDelta-marketing/LICENSE',data:await readFile('LICENSE')});
marketingEntries.push({name:'UIDelta-marketing/README.md',data:'# UIDelta 宣传材料\n\n从 [素材索引](docs/marketing/README.md) 开始。PNG、HTML、SVG 与截图依赖均按仓库路径保留。\n\n直接打开 brand/ 中的 HTML 可编辑成图；重新采集产品界面需完整仓库与 Playwright 开发环境。\n'});
await saveArtifact('UIDelta-marketing-kit.zip',marketingEntries);
await rm('_site',{recursive:true,force:true});
await cp('site','_site',{recursive:true});
await cp('brand','_site/brand',{recursive:true});
await writeFile('release/SHA256SUMS.txt',artifacts.map(([name,bytes])=>`${createHash('sha256').update(bytes).digest('hex')}  ${name}`).join('\n')+'\n');
console.log(`Built extension v${version}, four asset packages, checksums and _site/`);
