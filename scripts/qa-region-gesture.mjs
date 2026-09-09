// Synthetic page and isolated browser only; no user profile or stored issues.
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.UIDELTA_PLAYWRIGHT_PATH || 'playwright');
const source=await readFile(new URL('../extension/content.js',import.meta.url),'utf8');
const browser=await chromium.launch({headless:true,channel:'chrome'});
try {
  const page=await browser.newPage({viewport:{width:1100,height:800}});
  await page.goto('about:blank');
  await page.addScriptTag({content:source.slice(0,source.indexOf('  const review = new UIDeltaReview();'))+`
    UIDeltaReview.prototype.initialize=function(){};
    UIDeltaReview.prototype.sendMessage=async function(){return {ok:true};};
    const review=new UIDeltaReview();window.review=review;
    review.enabled=true;review.session={id:'fixture',status:'active'};
    review.currentView='inspect';review.host.style.display='block';review.setInspectMode('region');
  })();`});
  for(let i=0;i<3;i++){
    // Each new rectangle starts outside the preceding one and releases over
    // the overlay itself, reproducing the event-isolation failure.
    await page.mouse.move(100,100+i*150);await page.mouse.down();
    await page.mouse.move(320,220+i*150,{steps:10});await page.mouse.up();
    const rect=await page.evaluate(()=>({rect:review.pendingRegionRect,active:review.regionSelection}));
    assert.equal(rect.active,null);assert.equal(rect.rect.width,220);assert.equal(rect.rect.height,120);
    await page.mouse.move(750,600);
    assert.deepEqual(await page.evaluate(()=>review.pendingRegionRect),rect.rect);
  }
  await page.mouse.move(200,450);await page.mouse.down();await page.mouse.move(240,470,{steps:5});await page.mouse.up();
  assert.equal(await page.evaluate(()=>review.regionEdit),null);
  const moved=await page.evaluate(()=>review.pendingRegionRect);
  await page.mouse.move(850,100);assert.deepEqual(await page.evaluate(()=>review.pendingRegionRect),moved);
  console.log('PASS: three consecutive selections, overlay release, move and idle pointer stability');
} finally {await browser.close();}
