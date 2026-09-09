import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.UIDELTA_PLAYWRIGHT_PATH || 'playwright');
const source=await readFile(new URL('../extension/content.js',import.meta.url),'utf8');
const browser=await chromium.launch({headless:true,channel:'chrome'});
try {
 const page=await browser.newPage({viewport:{width:1200,height:900}});
 await page.setContent('<style>input{font:500 14px/20px Arial;color:rgb(20,30,40);box-shadow:0 0 0 0 transparent,0 0 0 0 transparent;margin:80px}input::placeholder{color:rgb(140,150,160);opacity:1}</style><input id="search" placeholder="搜索文件或任务">');
 await page.addScriptTag({content:source.slice(0,source.indexOf('  const review = new UIDeltaReview();'))+`
  UIDeltaReview.prototype.initialize=function(){};
  UIDeltaReview.prototype.sendMessage=async()=>({ok:true});
  const review=new UIDeltaReview();window.review=review;
  review.enabled=true;review.session={id:'fixture',status:'active'};review.host.style.display='block';review.currentView='inspect';review.inspectMode='annotation';review.selected=document.querySelector('#search');review.showView('inspect');review.updateInspector(review.selected);
 })();`});
 for(const [key,value] of [['font-size','14px'],['line-height','20px'],['font-weight','500'],['text-color','rgb(20, 30, 40)'],['placeholder-color','rgb(140, 150, 160)']]){
   const el=page.locator(`[data-layer-value="${key}"]`);assert.ok(await el.isVisible());assert.equal(await el.textContent(),value);
 }
 assert.equal(await page.locator('[data-layer-row="shadow"]').isVisible(),false);
 await page.evaluate(()=>{review.selected.style.boxShadow='0 0 0 0 transparent, 0 0 0 3px rgba(0,120,240,.5)';review.updateInspector(review.selected);});
 assert.match(await page.locator('[data-layer-value="shadow"]').textContent(),/3px/);
 assert.doesNotMatch(await page.locator('[data-layer-value="shadow"]').textContent(),/rgba\(0, 0, 0, 0\)/);
 await page.evaluate(()=>{review.inspectMode='ui';review.renderUiEditor(review.selected);});
 assert.ok(await page.locator('.ui-editor [data-preview-prop="fontSize"]').isVisible());
 console.log('PASS: input font/size/weight/line-height/color/placeholder color; invisible shadows filtered; real ring retained; UI typography editable');
}finally{await browser.close();}
