import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';

const source=await readFile(new URL('./service-worker.js',import.meta.url),'utf8');
const listener={addListener(){}};
const png='data:image/png;base64,iVBORw0KGgo=';

test('证据包导出再导入保留结果文字、图片用途和稳定路径，不触碰原会话',async()=>{
  const session={id:'source',origin:'https://fixture.test',status:'active'};
  const issue={id:'original',sessionId:'source',sequence:1,displayId:'UI-001',type:'ui',
    description:'问题说明',resultReference:'期望效果\n第二行',
    attachments:{context:'context',detail:'detail',references:['problem','result'],descriptionImages:['problem']}};
  const assets=['context','detail','problem','result'].map(id=>({id,issueId:issue.id,sessionId:'source',
    kind:['context','detail'].includes(id)?id:'reference',dataUrl:png,width:100,height:50,pending:false}));
  const bundle={session,issues:[issue],assets};const original=structuredClone(bundle);
  const tables={sessions:new Map([['target',{id:'target',origin:'https://fixture.test',status:'active',nextIssueNumber:1}]]),issues:new Map(),assets:new Map()};
  const db={transaction(){return {objectStore(name){return {
    get:id=>Promise.resolve(tables[name].get(id)),put:item=>tables[name].set(item.id,item),
    index:field=>({getAll:id=>Promise.resolve([...tables[name].values()].filter(item=>item[field]===id))})
  };},abort(){}};}};
  const worker=vm.createContext({Blob,fetch,URL,TextEncoder,atob,btoa,crypto:webcrypto,structuredClone,chrome:{
    runtime:{onInstalled:listener,onMessage:listener},commands:{onCommand:listener},action:{onClicked:listener},tabs:{onRemoved:listener,onUpdated:listener}
  }});
  vm.runInContext(source.replace(/^import[^\n]+\n/,''),worker);
  worker.openDatabase=async()=>db;worker.recoverStaleFinalizations=async()=>{};
  worker.getReviewBundle=async()=>bundle;worker.transactionDone=async()=>{};worker.requestResult=request=>request;
  const sender={tab:{url:'https://fixture.test/page'}};
  const exported=await worker.prepareDeliveryBundle('source',sender,null,false);
  const paths=exported.issues[0].attachmentPaths;
  assert.equal(paths.descriptionImages.length,1);assert.equal(paths.references.length,2);
  assert.equal(paths.descriptionImages[0],exported.assets.find(asset=>asset.id==='problem').exportPath);
  const manifest=worker.buildDeliveryManifest(exported.session,exported.issues,exported.assets,exported.exportedAt);
  const markdown=worker.buildMarkdownReport(exported.session,exported.issues,exported.assets,exported.exportedAt);
  assert.match(markdown,/### 结果参考\n\n期望效果\n第二行/);assert.match(markdown,/问题附图/);
  const imported=await worker.importDeliverable('target',manifest,exported.assets.map(asset=>({exportPath:asset.exportPath,dataUrl:png})),sender);
  const restored=imported.issues[0];assert.equal(restored.resultReference,issue.resultReference);
  assert.equal(restored.attachments.references.length,2);assert.equal(restored.attachments.descriptionImages.length,1);
  const problemId=restored.attachments.descriptionImages[0];assert.ok(restored.attachments.references.includes(problemId));
  assert.equal(tables.assets.get(problemId).importedFrom.exportPath,paths.descriptionImages[0]);
  assert.deepEqual(bundle,original,'原会话与附件不可被导出过程修改');
  const duplicate=await worker.importDeliverable('target',manifest,exported.assets.map(asset=>({exportPath:asset.exportPath,dataUrl:png})),sender);
  assert.equal(duplicate.issues.length,0);assert.equal(tables.assets.size,4);
});
