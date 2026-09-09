// Isolated Chromium fixture; never connects to the user's Chrome profile/data.
// Set UIDELTA_PLAYWRIGHT_PATH to an installed Playwright package when not local.
import {createRequire} from 'node:module';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
const require = createRequire(import.meta.url);
const {chromium} = require(process.env.UIDELTA_PLAYWRIGHT_PATH || 'playwright');
const source = process.env.UIDELTA_QA_BASELINE === '1'
  ? execFileSync('git',['show','HEAD:extension/content.js'],{encoding:'utf8',cwd:new URL('../',import.meta.url)})
  : await readFile(new URL('../extension/content.js',import.meta.url),'utf8');
const fixture = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>UIDelta 模式切换回归</title>
<style>body{font:16px system-ui;padding:50px;background:#f7f8fa}input,button{padding:12px;margin:8px}#popup{width:400px;padding:24px;background:white;border:1px solid #ccc;border-radius:12px}#popup[hidden]{display:none}</style>
<h1>网页浮窗 · 模式切换测试</h1><input id="date" placeholder="选择日期"><button id="dropdown">打开下拉</button><button id="modal">打开弹窗</button><button id="outside">页面外部区域</button>
<section id="popup" hidden><h2 id="title"></h2><button id="choice">可检查的浮窗内容</button></section>
<script>
const popup=document.querySelector('#popup');window.outsideEvents=[];
let trigger;window.forcedFocus=0;window.openFixture=(kind)=>{trigger=document.getElementById(kind);document.querySelector('#title').textContent=kind;popup.hidden=false;trigger.focus();};
document.addEventListener('focusin',event=>{if(trigger?.id==='modal' && !popup.hidden && !popup.contains(event.target) && event.target!==trigger){window.forcedFocus++;document.querySelector('#choice').focus();}},true);
document.addEventListener('keydown',event=>{if(trigger?.id==='modal' && !popup.hidden && event.key==='Tab'){event.preventDefault();window.forcedFocus++;document.querySelector('#choice').focus();}},true);
for(const id of ['date','dropdown','modal'])document.getElementById(id).addEventListener('click',()=>openFixture(id));
document.querySelector('#date').addEventListener('blur',()=>{if(trigger?.id==='date')popup.hidden=true;});
for(const type of ['pointerdown','mousedown','pointerup','mouseup','click'])document.addEventListener(type,event=>{
if(!popup.hidden && !popup.contains(event.target) && event.target!==trigger){window.outsideEvents.push(type);popup.hidden=true;}
},true);
</script></html>`;
const browser=await chromium.launch({headless:true,channel:'chrome'});
const results=[];
try {
  const page=await browser.newPage({viewport:{width:1280,height:900},hasTouch:true});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.route('http://uidelta.test/**',route=>route.fulfill({contentType:'text/html',body:fixture}));
  await page.goto('http://uidelta.test/');
  await page.addScriptTag({content:source.slice(0,source.indexOf('  const review = new UIDeltaReview();'))+`
    UIDeltaReview.prototype.initialize = function() {};
    UIDeltaReview.prototype.sendMessage = async function(message) {
      if(message.type==='UIDELTA_RESERVE_ISSUE')return {ok:true,sequence:1,session:this.session};
      if(message.type==='UIDELTA_PUT_REFERENCE_ASSET')return {ok:true,asset:{id:'fixture-image-'+(++this.fixtureAssetCount)}};
      if(message.type==='UIDELTA_GET_ASSET') {
        const canvas=document.createElement('canvas');canvas.width=400;canvas.height=220;
        const ctx=canvas.getContext('2d');ctx.fillStyle='#edf1f7';ctx.fillRect(0,0,400,220);
        ctx.fillStyle='#19252d';ctx.font='24px system-ui';ctx.fillText('Fixture evidence',24,48);
        ctx.strokeStyle='#ff633e';ctx.strokeRect(24,78,350,105);
        return {ok:true,dataUrl:canvas.toDataURL('image/png')};
      }
      return {ok:true};
    };
    UIDeltaReview.prototype.captureEvidence = async function() {this.composer.captureStatus='ready';this.composer.issue.attachments={context:'fixture-context',detail:'fixture-detail'};return {ok:true};};
    const review = new UIDeltaReview();globalThis.__uideltaReview=review;
    review.fixtureAssetCount=0;review.enabled=true;review.session={id:'fixture',status:'active'};review.currentView='inspect';review.host.style.display='block';review.setBrowseMode(true);
  })();`});
  for(const kind of ['date','dropdown','modal'])for(const mode of ['annotation','ui','region']){
    await page.evaluate(()=>{__uideltaReview.composer=null;__uideltaReview.setBrowseMode(true);});
    await page.locator('#'+kind).click();
    await page.locator(`.mode-toolbar [data-mode="${mode}"]`).click();
    assert.equal(await page.locator('#popup').isVisible(),true,`${kind} → ${mode} stays open`);
    assert.equal(await page.evaluate(()=>__uideltaReview.inspectMode),mode);
    if(kind==='date')assert.equal(await page.evaluate(()=>document.activeElement.id),'date');
    if(mode!=='region'){
      await page.locator('#choice').click();
      assert.equal(await page.locator('#popup').isVisible(),true);
      assert.equal(await page.evaluate(()=>__uideltaReview.selected?.id),'choice');
    }
    // Browsing is still real page interaction, including outside dismissal.
    await page.locator('.mode-toolbar [data-action="browse"]').click();
    assert.equal(await page.locator('#popup').isVisible(),true);
    await page.locator('#outside').click();
    assert.equal(await page.locator('#popup').isVisible(),false);
    results.push(`${kind} → ${mode}: open, inspect, return to browsing, outside dismissal PASS`);
  }
  await page.evaluate(()=>{__uideltaReview.setBrowseMode(true);openFixture('date');});
  await page.locator('.mode-toolbar [data-mode="annotation"]').click();
  await page.locator('#choice').click();
  await page.keyboard.press('r');
  await page.waitForFunction(()=>__uideltaReview.composer && __uideltaReview.shadow.activeElement===__uideltaReview.descriptionInput);
  assert.equal(await page.locator('#date').inputValue(),'');
  assert.equal(await page.locator('#popup').isVisible(),true);
  await page.locator('.description-input:not(.result-input)').click();
  await page.keyboard.type('date issue');
  assert.equal(await page.locator('.description-input:not(.result-input)').inputValue(),'date issue');
  assert.equal(await page.locator('#popup').isVisible(),true);
  results.push('Focused date input: R records, composer focus/input does not dismiss popup PASS');
  await page.evaluate(()=>{__uideltaReview.composer=null;__uideltaReview.setBrowseMode(true);openFixture('modal');});
  await page.locator('.mode-toolbar [data-mode="annotation"]').click();
  await page.locator('#choice').click();
  await page.keyboard.press('r');
  await page.waitForFunction(()=>__uideltaReview.composer && __uideltaReview.shadow.activeElement===__uideltaReview.descriptionInput);
  await page.locator('.description-input:not(.result-input)').click();
  await page.keyboard.type('modal issue');
  await page.locator('.result-input').click();
  await page.keyboard.type('expected result');
  assert.equal(await page.locator('#popup').isVisible(),true);
  assert.equal(await page.evaluate(()=>window.forcedFocus),0);
  assert.equal(await page.locator('.result-input').inputValue(),'expected result');
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(()=>__uideltaReview.shadow.activeElement===__uideltaReview.referenceInput),true);
  await page.keyboard.press('Shift+Tab');
  assert.equal(await page.evaluate(()=>__uideltaReview.shadow.activeElement===__uideltaReview.resultInput),true);
  assert.equal(await page.evaluate(()=>window.forcedFocus),0);
  results.push('Modal document focus trap: real R workflow autofocus, description and result input clicks preserve modal PASS');
  for(const [selector,role] of [['.description-input:not(.result-input)','description'],['.result-input','result']]){
    await page.locator(selector).evaluate((node)=>{
      const data=new DataTransfer();data.items.add(new File(['fixture'], 'pasted.png',{type:'image/png'}));
      node.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,composed:true,cancelable:true,clipboardData:data}));
    });
    await page.waitForFunction(()=>!__uideltaReview.composer.referencePromise);
    assert.equal(await page.evaluate(()=>__uideltaReview.composer.issue.attachments.references.length),role==='description'?1:2);
  }
  assert.equal(await page.evaluate(()=>__uideltaReview.composer.issue.attachments.descriptionImages.length),1);
  await page.waitForFunction(()=>__uideltaReview.shadow.querySelectorAll('.description-images img,.result-images img').length===2);
  assert.equal(await page.locator('#popup').isVisible(),true);
  results.push('Synthetic clipboard image paste assigns description/result roles without host dismissal PASS');
  await mkdir(new URL('../.qa/',import.meta.url),{recursive:true});
  await page.evaluate(async()=>{await Promise.allSettled(__uideltaReview.shadow.getAnimations().map(animation=>animation.finished));});
  await page.screenshot({path:new URL('../.qa/composer-reference.png',import.meta.url).pathname});
  // A trusted file control still opens one chooser after click isolation.
  const chooserPromise=page.waitForEvent('filechooser');
  await page.locator('.result-input').evaluate(node=>node.closest('.rich-input').querySelector('label').click());
  const chooser=await chooserPromise;await chooser.setFiles([]);
  assert.equal(await page.locator('#popup').isVisible(),true);
  results.push('Result attachment picker remains operable and preserves host modal PASS');
  await page.evaluate(async()=>{
    __uideltaReview.composer={mode:'edit',issue:{id:'existing',sessionId:'fixture',reviewStatus:'accepted'}};
    await __uideltaReview.cancelComposer();
  });
  assert.equal(await page.evaluate(()=>__uideltaReview.currentView),'inspect');
  assert.equal(await page.evaluate(()=>__uideltaReview.recordButton.disabled),true);
  assert.equal(await page.evaluate(()=>__uideltaReview.identityName.textContent),'点击选择元素');
  results.push('Return to review clears the old inspector target and disables stale record action PASS');
  await page.evaluate(()=>{
    __uideltaReview.issues=Array.from({length:5},(_,i)=>({id:'fixture-'+i,sessionId:'fixture',sequence:i+1,displayId:'UI-00'+(i+1),type:'ui',description:'Fixture card '+i,pageSnapshot:{title:'Test page'}}));
    __uideltaReview.showView('inbox');__uideltaReview.renderIssueList();
  });
  await page.getByText('Fixture card 0',{exact:true}).click();
  assert.equal(await page.evaluate(()=>__uideltaReview.currentView),'inbox');
  const checkbox=page.locator('.issue-select').first();const before=await checkbox.isChecked();
  await checkbox.click();assert.equal(await checkbox.isChecked(),!before);
  assert.equal(await page.evaluate(()=>__uideltaReview.deliverySelection.has('fixture-0')),!before);
  assert.equal(await page.evaluate(()=>__uideltaReview.currentView),'inbox');
  results.push('Native card click remains in inbox; checkbox toggles exactly once and matches export selection PASS');
  await page.evaluate(()=>{__uideltaReview.setBrowseMode(true);openFixture('date');});
  await page.locator('.mode-toolbar [data-mode="ui"]').tap();
  assert.equal(await page.locator('#popup').isVisible(),true);
  assert.equal(await page.evaluate(()=>__uideltaReview.inspectMode),'ui');
  results.push('Touch activation preserves date popup and switches mode PASS');
  // Keyboard activation remains accessible despite mouse focus preservation.
  await page.locator('.mode-toolbar [data-mode="annotation"]').focus();
  await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(()=>__uideltaReview.browseMode),false);
  assert.equal(await page.evaluate(()=>__uideltaReview.inspectMode),'annotation');
  // Saved markers stay visible across modes without mutating real records.
  await page.evaluate(()=>{
    document.querySelector('#popup').hidden=true;
    const group=document.createElement('div');group.id='pin-fixture';group.style.cssText='margin-top:90px;width:600px';
    group.innerHTML='<button id="pin-a">已记录问题一</button><button id="pin-b">已记录问题十六</button><button id="pin-c">已记录问题一百二十八</button>';
    document.body.append(group);document.body.style.minHeight='1800px';
    __uideltaReview.composer=null;
    __uideltaReview.issues=[1,16,128].map((sequence,index)=>({id:'pin-'+index,sessionId:'fixture',sequence,displayId:'UI-'+String(sequence).padStart(3,'0'),type:'ui',title:'已记录的问题',pageSnapshot:__uideltaReview.pageSnapshot(),elementAnchor:__uideltaReview.elementAnchor(group.children[index])}));
    window.pinClicks=0;group.children[0].onclick=()=>window.pinClicks++;
    __uideltaReview.setBrowseMode(true);
  });
  await page.evaluate(()=>{__uideltaReview.issues[0].description='完整问题描述，不使用截断标题\n第二行说明';});
  for(const mode of ['browse','annotation','ui']) {
    await page.evaluate(mode=>{if(mode==='browse')__uideltaReview.setBrowseMode(true);else __uideltaReview.resumeReview(mode);},mode);
    assert.equal(await page.locator('.pin:visible').count(),3);
    const style=await page.locator('.pin').last().evaluate(node=>{const box=node.getBoundingClientRect(),style=getComputedStyle(node);return {width:box.width,height:box.height,padding:style.padding,align:style.placeItems,pointer:style.pointerEvents,text:node.textContent};});
    assert.equal(style.width,style.height);assert.equal(style.padding,'0px');assert.equal(style.align,'center');assert.equal(style.text,'128');
    assert.equal(style.pointer,mode==='browse'?'none':'auto');
    const box=await page.locator('.pin').first().boundingBox();
    await page.mouse.move(box.x+box.width/2,box.y+box.height/2);
    assert.equal(await page.locator('.tooltip[data-pin-issue-id]').isVisible(),true,'hover must render without a delay');
    assert.equal(await page.locator('.tooltip[data-pin-issue-id]').textContent(),'UI-001\n完整问题描述，不使用截断标题\n第二行说明');
    assert.equal(await page.locator('.pin').first().getAttribute('title'),null);
    await page.mouse.move(10,10);
    assert.equal(await page.locator('.tooltip[data-pin-issue-id]').count(),0);
  }
  await page.evaluate(()=>__uideltaReview.setBrowseMode(true));
  const first=page.locator('.pin').first(), beforePin=await first.boundingBox();
  await page.mouse.click(beforePin.x+beforePin.width/2-8,beforePin.y+beforePin.height/2+8);
  assert.equal(await page.evaluate(()=>window.pinClicks),1,'marker must not intercept native target click');
  await page.evaluate(()=>{window.retainedPin=__uideltaReview.pinsLayer.firstElementChild;__uideltaReview.renderPins();});
  assert.equal(await page.evaluate(()=>window.retainedPin===__uideltaReview.pinsLayer.firstElementChild),true);
  await page.evaluate(()=>window.scrollTo(0,100));
  await page.waitForFunction(()=>window.scrollY===100);
  await page.evaluate(()=>__uideltaReview.onLayoutChange());
  assert.ok(Math.abs((await first.boundingBox()).y-beforePin.y+100)<1);
  await page.evaluate(()=>window.scrollTo(0,0));await page.evaluate(()=>__uideltaReview.onLayoutChange());
  await page.screenshot({path:new URL('../.qa/persistent-pins.png',import.meta.url).pathname});
  await page.evaluate(()=>{document.querySelector('#pin-b').hidden=true;__uideltaReview.renderPins();});
  assert.equal(await page.locator('.pin').count(),2);
  await page.evaluate(()=>{history.pushState({},'', '/another-page');__uideltaReview.renderPins();});
  assert.equal(await page.locator('.pin').count(),0);
  results.push('Saved pins: browse / annotation / UI visible; 1–3 digits centered, click-through, scroll tracking, stable DOM, hidden targets and route filtering PASS');
  assert.deepEqual(errors,[]);
  await page.evaluate(()=>{__uideltaReview.setBrowseMode(true);openFixture('dropdown');});
  await page.locator('.mode-toolbar [data-mode="annotation"]').click();
  await page.evaluate(async()=>{await Promise.allSettled(__uideltaReview.shadow.getAnimations().map(animation=>animation.finished));});
  await mkdir(new URL('../.qa/',import.meta.url),{recursive:true});
  await page.screenshot({path:new URL('../.qa/mode-popovers.png',import.meta.url).pathname});
  results.push('Keyboard Enter activation PASS; no page errors');
  await writeFile(new URL('../.qa/mode-popovers-results.json',import.meta.url),JSON.stringify(results,null,2));
  console.log(results.join('\n'));
} finally { await browser.close(); }
