// Isolated transparent portal fixture. Never connects to live review data.
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.UIDELTA_PLAYWRIGHT_PATH || 'playwright');
const source=await readFile(process.env.UIDELTA_QA_BASELINE==='1'
 ? '/Users/laodie/Documents/New Skill/UIDelta-Phase2-v0.9.4/content.js'
 : new URL('../extension/content.js',import.meta.url),'utf8');
const browser=await chromium.launch({headless:true,channel:'chrome'});
try {
 const page=await browser.newPage({viewport:{width:1200,height:900}});
 await page.setContent(`<style>
 body{font:16px system-ui;margin:0;padding:80px}button{padding:12px}#container{margin-top:30px;width:240px;height:100px}
 #shell{position:fixed;inset:0;z-index:100;pointer-events:auto;background:transparent}
 #search{position:absolute;bottom:100px;left:100px;background:white;padding:16px}
 </style><button id="under">目标按钮</button><div id="container">普通容器</div><div id="shell"><input id="search" placeholder="搜索"></div>
 <script>window.pageClicks=0;document.querySelector('#under').onclick=()=>pageClicks++;</script>`);
 await page.addScriptTag({content:source.slice(0,source.indexOf('  const review = new UIDeltaReview();'))+`
  UIDeltaReview.prototype.initialize=function(){};UIDeltaReview.prototype.sendMessage=async()=>({ok:true});
  const review=new UIDeltaReview();window.review=review;
  review.enabled=true;review.session={id:'fixture',status:'active'};review.host.style.display='block';review.currentView='inspect';
 `+`})();`});
 for(const mode of ['annotation','ui'])for(const blocked of [false,true]){
  await page.evaluate(({mode,blocked})=>{review.inspectMode=mode;review.selected=null;review.selectionLocked=false;document.body.style.pointerEvents=blocked?'none':'';}, {mode,blocked});
  await page.mouse.click(110,105);
  assert.equal(await page.evaluate(()=>review.selected?.id),'under',`${mode} blocked=${blocked}: transparent shell must not trap selection`);
  assert.equal(await page.evaluate(()=>document.body.style.pointerEvents),blocked?'none':'');
  assert.equal(await page.locator('#shell').evaluate(el=>el.style.pointerEvents),'');
  await page.mouse.click(180,780);
  assert.equal(await page.evaluate(()=>review.selected?.id),'search','portal content remains selectable');
 }
 assert.equal(await page.evaluate(()=>pageClicks),0,'inspection must never activate page controls');
 await page.evaluate(()=>{document.body.style.pointerEvents='';document.querySelector('#shell').style.background='rgba(0,0,0,.3)';});
 await page.mouse.click(110,105);
 assert.equal(await page.evaluate(()=>review.selected?.id),'shell','visible backdrop stays selectable');
 await page.evaluate(()=>{document.querySelector('#shell').style.display='none';});
 await page.mouse.click(150,210);
 assert.equal(await page.evaluate(()=>review.selected?.id),'container','ordinary containers remain selectable');
 console.log('PASS: annotation/UI under transparent shell; modal body pointer lock; search child; no host activation; visible backdrop and ordinary container');
}finally{await browser.close();}
