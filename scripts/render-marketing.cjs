// Development-only renderer. Requires Playwright and Google Chrome; does not change extension source.
const { chromium } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const {createHash}=require('node:crypto');
const {pathToFileURL}=require('node:url');
(async()=>{
 const root=path.resolve(__dirname,'..'); process.chdir(root);
 await fs.mkdir('brand/screenshots',{recursive:true});
 const content=await fs.readFile('extension/content.js','utf8');
 const harness=await fs.readFile('extension/test-harness.html','utf8');
 let bridge=harness.match(/<script>([\s\S]*?)<\/script>/)[1];
 bridge=bridge.replace('state.assets.set(contextAssetId,tinyPng); state.assets.set(detailAssetId,tinyPng);','state.assets.set(contextAssetId,window.__evidence.context); state.assets.set(detailAssetId,window.__evidence.detail);');
 bridge=bridge.replace('if (message.type === "UIDELTA_GET_STATE")', 'if (message.type === "UIDELTA_GET_DELIVERY_PREVIEW") return {ok:true,dataUrl:window.__examples[message.format]}; if (message.type === "UIDELTA_GET_STATE")');
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
 if(!process.argv.includes('--art-only')){
 const page=await browser.newPage({viewport:{width:1280,height:760},deviceScaleFactor:2,reducedMotion:'reduce'});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',async route=>{const url=new URL(route.request().url()); if(url.hostname==='orbit.example')await route.fulfill({contentType:'text/html',body:await fs.readFile('brand/source/workspace.html','utf8')});else await route.abort();});
 await page.goto('https://orbit.example/workspace');
 const context=(await page.screenshot()).toString('base64');
 const detail=(await page.locator('.project-card').first().screenshot()).toString('base64');
 const examples={};for(const name of ['html','xlsx','zip'])examples[name]='data:image/png;base64,'+(await fs.readFile(`extension/previews/${name}-preview@2x.png`)).toString('base64');
 await page.evaluate(({context,detail,examples})=>{window.__evidence={context:'data:image/png;base64,'+context,detail:'data:image/png;base64,'+detail};window.__examples=examples;},{context,detail,examples});
 await page.addScriptTag({content:bridge});
 await page.addScriptTag({content:await fs.readFile('extension/compare-engine.js','utf8')});
 await page.addScriptTag({content});
 await page.waitForFunction(()=>window.__uideltaReview);
 await page.evaluate(async()=>{
  const r=window.__uideltaReview;await r.setEnabled(true);r.setInspectMode('ui');r.selectPageTarget(document.querySelector('.project-card'));
  Object.assign(r.panel.style,{left:'1006px',top:'84px',right:'auto',bottom:'auto'});
  r.uiEditor.style.setProperty('left','1006px','important');r.uiEditor.style.setProperty('top','84px','important');r.uiEditor.style.setProperty('right','auto','important');r.uiEditor.style.setProperty('bottom','auto','important');
  r.toast.classList.remove('visible');
 });
 const stable=async()=>{await page.evaluate(()=>document.fonts.ready);await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));};
 await stable();
 await page.screenshot({path:'brand/screenshots/workspace-inspect.png'});
 await page.locator('[data-uidelta-root] .ui-editor').screenshot({path:'brand/screenshots/panel-inspect.png',omitBackground:true});
 await page.locator('[data-uidelta-root] .mode-toolbar').screenshot({path:'brand/screenshots/toolbar.png',omitBackground:true});
 await page.evaluate(()=>{const r=window.__uideltaReview;const cards=document.querySelectorAll('.project-card');r.setInspectMode('annotation');r.renderComparison(cards[1],cards[0]);});
 await stable();
 await page.screenshot({path:'brand/screenshots/canvas-measure.png',clip:{x:195,y:260,width:750,height:330}});
 await page.evaluate(async()=>{const r=window.__uideltaReview;r.setInspectMode('annotation');const cards=document.querySelectorAll('.project-card');r.renderComparison(cards[1],cards[0]);await r.openComposer();await r.composer.capturePromise;r.descriptionInput.value='卡片间距为 24px，请调整为设计稿中的 16px。';r.setComposerChoice('priority','soon');r.setComposerChoice('severity','cosmetic');r.toast.classList.remove('visible');});
 await stable();
 await page.screenshot({path:'brand/screenshots/workspace-record.png'});
 await page.locator('[data-uidelta-root] .panel').screenshot({path:'brand/screenshots/panel-record.png',omitBackground:true});
 await page.evaluate(async()=>{const r=window.__uideltaReview;await r.saveComposer();r.showView('deliver');r.toast.classList.remove('visible');});
 await stable();
 await page.screenshot({path:'brand/screenshots/workspace-delivery.png'});
 await page.locator('[data-uidelta-root] .panel').screenshot({path:'brand/screenshots/panel-delivery.png',omitBackground:true});
 if(errors.length)throw new Error(errors.join('\n'));
 await fs.writeFile('brand/screenshots/SOURCE.json',JSON.stringify({renderedAt:new Date().toISOString(),source:'extension/content.js',sha256:createHash('sha256').update(content).digest('hex'),viewport:{width:1280,height:760},deviceScaleFactor:2,fixture:'brand/source/workspace.html',notes:'Current extension UI rendered with the in-memory test bridge. Fictional page, capture images supplied by the renderer. Does not certify real extension capture or export.'},null,2)+'\n');
 console.log('Current extension UI captured: inspect, record, delivery, toolbar.');
 }
 // Brand compositions use the captured UI without repainting its controls.
 if(process.argv.includes('--capture-only'))return;
 for(const [name,width,height]of [['cover-16x9',1920,1080],['feature-inspect-16x9',1920,1080],['feature-delivery-16x9',1920,1080],['social-card',1280,640],['launch-poster',1080,1440]]){
  const art=await browser.newPage({viewport:{width,height},deviceScaleFactor:1});
  await art.goto(pathToFileURL(path.resolve(`brand/${name}.html`)).href);
  await art.evaluate(()=>document.fonts.ready);
  await art.screenshot({path:`brand/${name}.png`});await art.close();
 }
 await fs.copyFile('brand/screenshots/workspace-inspect.png','site/assets/product-preview.png');
 await fs.copyFile('brand/social-card.png','site/assets/social-card.png');
 console.log('Five marketing compositions and site previews exported.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exit(1)});
