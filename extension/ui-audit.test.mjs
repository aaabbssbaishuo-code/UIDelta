import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('./content.js', import.meta.url), 'utf8');
class Node {
  constructor() {
    this.children=[]; this.dataset={}; this.events={}; this.attributes={}; this.style={};
    this.isConnected=true; this.textContent=''; this.disabled=false; this.checked=false;
    this.classes=new Set(); this.classList={ add:n=>this.classes.add(n), remove:n=>this.classes.delete(n), toggle:(n,v)=>v?this.classes.add(n):this.classes.delete(n) };
  }
  append(...nodes) { this.children.push(...nodes); }
  appendChild(node) { this.append(node); return node; }
  replaceChildren(...nodes) { this.children=nodes; }
  insertBefore(node) { this.children.unshift(node); }
  setAttribute(k,v) { this.attributes[k]=String(v); }
  removeAttribute(k) { delete this.attributes[k]; }
  addEventListener(k,v) { this.events[k]=v; }
  remove() { this.isConnected=false; }
}
const context=vm.createContext({ URL, document:{createElement:()=>new Node()}, location:{href:'https://test.example/'}, window:{} });
vm.runInContext(source.slice(source.indexOf('  const ROOT_ATTRIBUTE'),source.indexOf('  const review = new UIDeltaReview();'))+'\nglobalThis.Review=UIDeltaReview;',context);
const make=(overrides={})=>Object.assign(Object.create(context.Review.prototype),overrides);
const deferred=()=>{ let resolve; const promise=new Promise(r=>resolve=r); return {promise,resolve}; };

test('搜索空态更新专用说明，不覆盖图标；清单文字区域没有无效点击入口', () => {
  const icon=new Node(), hint=new Node(), title=new Node(); icon.textContent='◎';
  const empty=new Node(); empty.querySelector=s=>s==='strong'?title:s==='.empty-hint'?hint:icon;
  const review=make({ enabled:true, issues:[{id:'one'}], issueList:new Node(), issueEmpty:empty,
    issueFilter:'all', issueSearchQuery:'absent', shadow:{querySelectorAll:()=>[]}, pruneDeliverySelection(){}, currentRoute:()=>'/'});
  review.renderIssueList();
  assert.equal(icon.textContent,'◎');
  assert.equal(hint.textContent,'调整搜索词或切换筛选。');
  assert.equal(title.textContent,'没有匹配问题');
  assert.match(review.createOverlay.toString(),/class='empty-hint'/);
  assert.doesNotMatch(review.renderIssueList.toString(),/pageLocation = document.createElement\("button"\)/);
});

test('勾选交付范围不会重建问题清单、丢失键盘焦点或滚动位置', () => {
  const checkbox=new Node(); checkbox.dataset.deliveryIssueId='a';
  const review=make({issues:[{id:'a'}], deliverySelection:new Set(), currentView:'inbox',
    shadow:{querySelectorAll:()=>[checkbox]}, renderIssueList(){assert.fail('勾选不能重建清单');}});
  review.toggleDeliveryIssue('a',true);
  assert.equal(checkbox.checked,true);
  review.toggleDeliveryIssue('a',false);
  assert.equal(checkbox.checked,false);
  assert.equal(review.deliverySelection.size,0);
});

test('截图资源失败有明确状态和重试入口，不永远显示加载中', async () => {
  const visual=new Node(), caption=new Node(); visual.append(caption);
  const review=make({sendMessage:async()=>({ok:false,error:'截图不存在'})});
  await review.loadIssueThumbnail('missing',visual,caption,'context',[]);
  assert.equal(visual.dataset.state,'error');
  const retry=visual.children.find(n=>n.textContent==='重新加载');
  assert.ok(retry);
  assert.equal(typeof retry.events.click,'function');
});

test('图片解码失败可重试，离开清单后迟到请求不再写入节点', async () => {
  const visual=new Node(), caption=new Node(); visual.append(caption);
  const review=make({sendMessage:async()=>({ok:true,dataUrl:'data:image/png;base64,broken'})});
  await review.loadIssueThumbnail('broken',visual,caption,'detail',[]);
  const image=visual.children.find(n=>n.className?.includes('issue-thumb'));
  assert.equal(typeof image.events.error,'function');
  image.events.error();
  assert.equal(visual.dataset.state,'error');
  const pending=deferred(); review.sendMessage=()=>pending.promise;
  visual.isConnected=false;
  const loading=review.loadIssueThumbnail('later',visual,caption,'detail',[]);
  const before=visual.children.length;
  pending.resolve({ok:true,dataUrl:'data:image/png;base64,test'});
  await loading;
  assert.equal(visual.children.length,before);
});

test('重复导出同一格式只有一个请求，两个入口同步忙碌；失败可恢复', async () => {
  const buttons=[new Node(),new Node()]; buttons.forEach(b=>{b.dataset.action='deliver-zip';b.textContent='导出 ZIP';});
  const pending=deferred(); let requests=0; const selection=[{id:'a'}];
  const review=make({session:{id:'session'}, selectedDeliveryIssues:()=>selection, deliveryError:new Node(),
    shadow:{querySelectorAll:()=>buttons}, showToast(){}, sendMessage(){requests++;return pending.promise;}});
  const first=review.exportDeliverable('zip',buttons[0]);
  const second=review.exportDeliverable('zip',buttons[1]);
  assert.equal(requests,1);
  assert.ok(buttons.every(b=>b.disabled));
  pending.resolve({ok:false,error:'生成失败，请重试'});
  await Promise.all([first,second]);
  assert.ok(buttons.every(b=>!b.disabled&&b.textContent==='导出 ZIP'));
  assert.equal(review.deliveryError.textContent,'生成失败，请重试');
});

test('问题输入有可访问名称和错误关联；字体详情允许展开，不删除原始信息', () => {
  const review=make();
  assert.match(review.createOverlay.toString(),/aria-labelledby='uidelta-description-label'/);
  assert.match(review.createOverlay.toString(),/aria-describedby='uidelta-composer-error'/);
  const parsed=Array.from(review.fontFamilyNames('"Acme, Sans", "Inter", system-ui, sans-serif'));
  assert.deepEqual(parsed,['Acme, Sans','Inter','system-ui','sans-serif']);
  assert.deepEqual(Array.from(review.fontFamilyNames('  Inter, "Acme, Sans", sans-serif ')),['Inter','Acme, Sans','sans-serif']);
  assert.match(review.renderLayerProperties.toString(),/createElement\("details"\)/);
  assert.match(review.layerPropertiesStyles(),/summary:focus-visible/);
});

test('Cmd/Ctrl/Alt/Shift+R 保留浏览器快捷键，只有无修饰 R 记录', () => {
  let records=0, prevented=0;
  const review=make({enabled:true,browseMode:false,currentView:'inspect',session:{status:'active'},
    isTypingTarget:()=>false,isUiEvent:()=>false,setPierce(){},setModifier(){},
    openComposer(){records++;},selected:null,lastMeasurementSource:{}});
  for (const modifier of ['ctrlKey','metaKey','altKey','shiftKey']) {
    review.onKeyDown({code:'KeyR',key:'r',[modifier]:true,preventDefault(){prevented++;},stopImmediatePropagation(){}});
  }
  assert.equal(records,0);
  assert.equal(prevented,0);
  review.onKeyDown({code:'KeyR',key:'r',preventDefault(){prevented++;},stopImmediatePropagation(){}});
  assert.equal(records,1);
});

test('中文输入法候选阶段，Escape 不收起、Ctrl+Enter 不提交', () => {
  const review=make({enabled:true,browseMode:false,isTypingTarget:()=>true,
    minimizePanel(){assert.fail('输入法 Escape 不应收起面板');},saveComposer(){assert.fail('输入法不应提交');}});
  for (const composing of [{isComposing:true},{keyCode:229}]) {
    for (const key of ['Escape','Enter','r']) review.onKeyDown({...composing,key,ctrlKey:true,
      preventDefault(){assert.fail('不可拦截输入法事件');},stopImmediatePropagation(){assert.fail('不可拦截输入法事件');}});
  }
});
