// Isolated browser fixture, no real page or stored review data.
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.UIDELTA_PLAYWRIGHT_PATH || 'playwright');
const source=await readFile(new URL('../extension/content.js',import.meta.url),'utf8');
const browser=await chromium.launch({headless:true,channel:'chrome'});
try {
  const page=await browser.newPage({viewport:{width:1100,height:800}});
  await page.setContent('<style>input{margin:70px;padding:16px}input:focus{box-shadow:0 0 0 4px rgb(40,120,240);outline:2px solid blue}.wrap:focus-within{box-shadow:0 0 0 3px red}</style><div class="wrap"><input id="field" value="任务名称"></div>');
  await page.addScriptTag({content:source.slice(0,source.indexOf('  const review = new UIDeltaReview();'))+`
    UIDeltaReview.prototype.initialize=function(){};
    UIDeltaReview.prototype.sendMessage=async function(){return {ok:true};};
    const review=new UIDeltaReview();window.review=review;
    review.enabled=true;review.session={id:'fixture',status:'active'};
    review.currentView='inspect';review.host.style.display='block';review.inspectMode='annotation';
    review.selected=document.querySelector('#field');review.hovered=review.selected;
    window.recordCount=0;
    review.openComposer=function(){window.recordCount++;window.releasePaint=this.preserveFocusAppearance();this.showView('composer');this.descriptionInput.focus();};
  })();`});
  await page.evaluate(()=>{document.querySelector('#field').focus();window.beforePaint=getComputedStyle(document.querySelector('#field')).boxShadow;});
  await page.keyboard.press('r');
  assert.equal(await page.locator('#field').inputValue(),'任务名称');
  assert.equal(await page.evaluate(()=>recordCount),1);
  assert.equal(await page.evaluate(()=>review.shadow.activeElement===review.descriptionInput),true);
  assert.equal(await page.evaluate(()=>getComputedStyle(document.querySelector('#field')).boxShadow===beforePaint),true);
  await page.evaluate(()=>releasePaint());
  assert.equal(await page.evaluate(()=>document.querySelector('#field').style.boxShadow),'');
  await page.evaluate(()=>{review.currentView='inspect';document.querySelector('#field').focus();document.querySelector('#field').dispatchEvent(new KeyboardEvent('keydown',{code:'KeyR',key:'Process',keyCode:229,isComposing:true,bubbles:true,cancelable:true}));});
  assert.equal(await page.evaluate(()=>recordCount),2);
  await page.evaluate(()=>{releasePaint();review.browseMode=true;document.querySelector('#field').focus();});
  await page.keyboard.press('r');assert.match(await page.locator('#field').inputValue(),/r/);
  assert.equal(await page.evaluate(()=>recordCount),2);
  console.log('PASS: focused-page R is not text; IME-229 R records; focus paint survives blur and restores; browse R still types');
} finally {await browser.close();}
