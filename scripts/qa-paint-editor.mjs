import {createRequire} from 'node:module';
import {readFile,mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.UIDELTA_PLAYWRIGHT_PATH || 'playwright');
const source=await readFile(new URL('../extension/content.js',import.meta.url),'utf8');
const browser=await chromium.launch({headless:true,channel:'chrome'});
try {
 const page=await browser.newPage({viewport:{width:1200,height:900}});
 await page.setContent('<style>body{font:16px system-ui;padding:80px;background:white}#search{box-sizing:border-box;width:239px;height:32px;border:1px solid oklch(90% 0 0);border-radius:calc(infinity * 1px);background:transparent;display:flex;align-items:center;padding:0 12px}input{border:0;background:transparent;width:100%}</style><h2>文件中心</h2><div id="search"><input placeholder="搜索文件或任务"></div>');
 await page.addScriptTag({content:source.slice(0,source.indexOf('  const review = new UIDeltaReview();'))+`
  UIDeltaReview.prototype.initialize=function(){};
  UIDeltaReview.prototype.sendMessage=async()=>({ok:true});
  const review=new UIDeltaReview();window.review=review;
  review.enabled=true;review.session={id:'fixture',status:'active'};review.host.style.display='block';review.currentView='inspect';review.inspectMode='ui';review.selected=document.querySelector('#search');review.renderUiEditor(review.selected);
 })();`});
 assert.equal(await page.locator('[data-preview-prop="borderWidth"]').inputValue(),'1px');
 assert.match(await page.locator('[data-preview-prop="backgroundColor"][type="text"]').inputValue(),/rgba\(0, 0, 0, 0\)/);
 assert.equal(await page.locator('[data-ui-numeric="borderRadius"]').inputValue(),'16');
 const original=await page.locator('#search').getAttribute('style');
 await page.locator('[data-ui-numeric="borderRadius"]').focus();await page.keyboard.press('Tab');
 assert.equal(await page.locator('#search').getAttribute('style'),original,'unmodified radius must not mutate page');
 await page.locator('[data-preview-prop="backgroundColor"][type="text"]').fill('FFFFFF');
 await page.locator('[data-preview-prop="borderColor"][type="text"]').fill('22AA66');
 await page.locator('[data-preview-prop="borderWidth"]').fill('2');
 await page.locator('[data-preview-prop="borderStyle"]').selectOption('dashed');
 const actual=await page.locator('#search').evaluate(el=>{const s=getComputedStyle(el);return [s.backgroundColor,s.borderTopColor,s.borderTopWidth,s.borderTopStyle];});
 assert.deepEqual(actual,['rgb(255, 255, 255)','rgb(34, 170, 102)','2px','dashed']);
 const changes=await page.evaluate(()=>review.getPreviewProposal());assert.ok(JSON.stringify(changes).includes('borderColor'));
 await mkdir(new URL('../.qa/',import.meta.url),{recursive:true});await page.screenshot({path:new URL('../.qa/paint-editor.png',import.meta.url).pathname});
 await page.evaluate(()=>review.resetPreview(false));
 assert.deepEqual(await page.locator('#search').evaluate(el=>[getComputedStyle(el).backgroundColor,getComputedStyle(el).borderTopWidth,getComputedStyle(el).borderTopStyle]),['rgba(0, 0, 0, 0)','1px','solid']);
 console.log('PASS: transparent fill + modern border read; HEX paint edits; width/style; proposal export; capsule radius; undo');
}finally{await browser.close();}
