// Synthetic small-element fixtures in an isolated browser; no live review data.
import {createRequire} from 'node:module';
import {readFile,mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.UIDELTA_PLAYWRIGHT_PATH || 'playwright');
const source=await readFile(new URL('../extension/content.js',import.meta.url),'utf8');
const browser=await chromium.launch({headless:true,channel:'chrome'});
try {
  const page=await browser.newPage({viewport:{width:900,height:700}});
  await page.setContent('<style>body{background:#fff;font:16px system-ui}#small{position:fixed;display:grid;place-items:center;background:#eee;border-radius:8px}h1{font-size:22px;margin:40px}</style><h1>小元素测距 · 标签避让</h1><div id="small">◷</div>');
  await page.addScriptTag({content:source.slice(0,source.indexOf('  const review = new UIDeltaReview();'))+`
    UIDeltaReview.prototype.initialize=function(){};
    UIDeltaReview.prototype.sendMessage=async function(){return {ok:true};};
    const review=new UIDeltaReview();window.review=review;
    review.enabled=true;review.session={id:'fixture',status:'active'};review.issues=[];
    review.currentView='inspect';review.host.style.display='block';review.inspectMode='annotation';
  })();`});
  let count=0;
  for(const size of [16,24,36,48])for(const [x,y] of [[100,130],[4,4],[848,4],[4,648],[848,648]]){
    const result=await page.evaluate(({size,x,y})=>{
      const target=document.querySelector('#small');Object.assign(target.style,{left:x+'px',top:y+'px',width:size+'px',height:size+'px'});
      const r=target.getBoundingClientRect(),toRect=review.rectSnapshot(r);
      const snapshot={toRect,segments:[
        {axis:'horizontal',x:x-4,y:y+size/2,length:4,value:4},
        {axis:'horizontal',x:x+size,y:y+size/2,length:4,value:4},
        {axis:'vertical',x:x+size/2,y:y-3,length:3,value:3},
        {axis:'vertical',x:x+size/2,y:y+size,length:3,value:3}]};
      review.renderMeasurementSnapshot(snapshot);review.showTooltip(target,'悬停测距');review.showRecordPrompt(target);
      return {target:toRect,labels:[...review.measurements.querySelectorAll('.badge'),review.tooltip,review.recordPrompt].map(el=>({...review.rectSnapshot(el.getBoundingClientRect()),text:el.textContent}))};
    },{size,x,y});
    const overlaps=(a,b)=>a.left<b.right && a.right>b.left && a.top<b.bottom && a.bottom>b.top;
    for(const a of result.labels){assert.equal(overlaps(a,result.target),false,`${size}@${x},${y}: ${a.text} covers target`);assert.ok(a.left>=0&&a.top>=0&&a.right<=900&&a.bottom<=700);}
    for(let i=0;i<result.labels.length;i++)for(let j=0;j<i;j++)assert.equal(overlaps(result.labels[i],result.labels[j]),false,`${size}@${x},${y}: ${result.labels[i].text} overlaps ${result.labels[j].text}`);
    count++;
  }
  await mkdir(new URL('../.qa/',import.meta.url),{recursive:true});
  await page.screenshot({path:new URL('../.qa/small-measurements.png',import.meta.url).pathname});
  console.log(`PASS: ${count} small-element/viewport-edge cases; target and label collision checks`);
} finally {await browser.close();}
