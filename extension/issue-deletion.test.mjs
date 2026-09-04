import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';

const content = await readFile(new URL('./content.js', import.meta.url), 'utf8');
const worker = await readFile(new URL('./service-worker.js', import.meta.url), 'utf8');
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };

function harness({ reduced = false } = {}) {
  let now = 0, nextTimer = 0;
  const timers = new Map(), motions = [], messages = [], notices = [];
  const clock = {
    setTimeout(fn, ms) { const id = ++nextTimer; timers.set(id, { fn, at:now + ms }); return id; },
    clearTimeout(id) { timers.delete(id); },
    async advance(ms) {
      const target = now + ms;
      while (true) {
        const entry = [...timers].filter(([, t]) => t.at <= target).sort((a,b) => a[1].at - b[1].at)[0];
        if (!entry) break;
        now = entry[1].at; timers.delete(entry[0]); entry[1].fn(); await flush();
      }
      now = target; await flush();
    }
  };
  class Node {
    constructor(tag = 'div') {
      this.tagName = tag; this.children = []; this.parentElement = null; this.root = false;
      this.dataset = {}; this.attributes = {}; this.style = {}; this.events = {}; this.disabled = false;
      this.className = ''; this._text = '';
      this.classList = {
        contains:n => this.className.split(' ').includes(n),
        toggle:(n, v) => { const set = new Set(this.className.split(' ').filter(Boolean)); if (v) set.add(n); else set.delete(n); this.className = [...set].join(' '); },
        add:n => this.classList.toggle(n,true), remove:n => this.classList.toggle(n,false)
      };
    }
    get isConnected() { return this.root || Boolean(this.parentElement?.isConnected); }
    get textContent() { return this._text + this.children.map(n => n.textContent).join(''); }
    set textContent(v) { this._text = v; this.replaceChildren(); }
    append(...nodes) { for (const node of nodes) { node.parentElement = this; this.children.push(node); } }
    appendChild(node) { this.append(node); return node; }
    replaceChildren(...nodes) { for (const node of this.children) node.parentElement = null; this.children = []; this.append(...nodes); }
    insertBefore(node, before) { node.parentElement = this; this.children.splice(Math.max(0,this.children.indexOf(before)),0,node); }
    remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(n => n !== this); this.parentElement = null; }
    contains(node) { return this === node || this.children.some(n => n.contains(node)); }
    setAttribute(k,v) { this.attributes[k] = String(v); }
    removeAttribute(k) { delete this.attributes[k]; }
    addEventListener(k,fn) { this.events[k] = fn; }
    querySelectorAll(selector) {
      const matches = node => selector.startsWith('.') ? node.classList.contains(selector.slice(1)) : node.tagName === selector;
      return this.children.flatMap(n => [...(matches(n) ? [n] : []), ...n.querySelectorAll(selector)]);
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    closest(selector) {
      if (selector.startsWith('.') && this.classList.contains(selector.slice(1))) return this;
      if (selector === '[data-action]' && this.dataset.action) return this;
      return this.parentElement?.closest(selector) || null;
    }
    getBoundingClientRect() { return { top:(this.parentElement?.children.indexOf(this) || 0)*200, left:0, width:220, height:192 }; }
    focus() { if (!this.disabled) shadow.activeElement = this; }
    animate(frames, options) { motions.push({node:this,frames,options}); return {finished:Promise.resolve(),cancel(){}}; }
  }
  const document = {hidden:false, createElement:tag => new Node(tag)};
  const shadow = {activeElement:null,querySelectorAll:() => [],querySelector:() => search};
  const context = vm.createContext({URL,Date:class extends Date { static now() { return now; } },
    document, location:{href:'https://test.example/'},
    window:{...clock, matchMedia:() => ({matches:reduced}), confirm(){assert.fail('不能弹原生确认框');}}});
  vm.runInContext(content.slice(content.indexOf('  const ROOT_ATTRIBUTE'), content.indexOf('  const review = new UIDeltaReview();'))+'\nglobalThis.Review = UIDeltaReview;', context);
  const issueList = new Node(); issueList.root = true;
  const clear = new Node('button'), status = new Node(), search = new Node('input'), empty = new Node();
  const title = new Node('strong'), hint = new Node(); hint.className = 'empty-hint'; empty.append(title,hint);
  const review = Object.assign(Object.create(context.Review.prototype), {
    enabled:true,browseMode:false,currentView:'inbox',session:{id:'s',status:'active',revision:0},
    issues:['a','b','c'].map((id,i) => ({id,sessionId:'s',sequence:i+1,displayId:'UI-00'+(i+1),type:'ui',description:'问题 '+id})),
    issueDeletions:new Set(),issueList,issueEmpty:empty,clearIssuesButton:clear,issueDeletionStatus:status,
    issueFilter:'all',issueSearchQuery:'',deliverySelection:new Set(['a','b','c']),deliverySelectionTouched:false,shadow,
    currentRoute:() => '/',updateCounts(){this.count = this.issues.length;},renderPins(){},persistTabContext(){},
    showToast:text => notices.push(text),sendMessage:async message => {messages.push(message);return {ok:true};}
  });
  review.renderIssueList();
  return {review,clock,document,shadow,motions,messages,notices,Node,timers};
}

test('三按钮仅 SVG 图标，32px 点击区；每个按钮有名称和悬停提示', () => {
  const {review} = harness();
  const row = review.issueList.children[0];
  const buttons = row.querySelectorAll('.row-action');
  assert.equal(buttons.length,3);
  assert.deepEqual(buttons.map(b => b.textContent),['','','']);
  for (const b of buttons) { assert.match(b.innerHTML,/<svg/); assert.ok(b.title); assert.equal(b.attributes['aria-label'],b.title); assert.equal(b.type,'button'); }
  assert.match(review.inboxCardStyles(),/width:32px; height:32px/);
});

test('真实卡片挂入 DOM 后才加载两张截图，不再永远停在加载中', async () => {
  const {review,messages} = harness();
  review.issues[0].attachments = {context:'context-a',detail:'detail-a'};
  review.renderIssueList(); await flush();
  assert.deepEqual(messages.map(m => m.assetId),['context-a','detail-a']);
  assert.ok(review.issueList.children[0].querySelectorAll('figure').every(n => n.isConnected));
});

test('紧凑清单：页面名仅一行，完整名称与路径保留在悬停提示中', () => {
  const {review} = harness();
  review.issues[0].pageSnapshot = {title:'项目管理平台\n超长的页面名称',url:'https://test.example/delivery/',route:'/delivery/'};
  review.renderIssueList();
  const location = review.issueList.children[0].querySelector('.issue-location');
  assert.equal(location.querySelector('.issue-location-name').textContent,'项目管理平台 超长的页面名称');
  assert.equal(location.querySelector('.issue-location-path'),null);
  assert.match(location.title,/项目管理平台 超长的页面名称 · \/delivery\//);
  assert.match(review.inboxCardStyles(),/\.issue-location-copy \{[^}]*text-overflow:ellipsis; white-space:nowrap/);
});

test('紧凑清单：操作区撑满卡片后右对齐，减少留白但保留字号及 32px 点击区', () => {
  const {review} = harness(); const css = review.inboxCardStyles();
  assert.match(css,/\.issue-row \{[^}]*align-items:stretch;[^}]*gap:6px; padding:8px/);
  assert.match(css,/\.row-actions \{[^}]*align-self:stretch; width:100%; justify-content:flex-end/);
  assert.match(css,/\.issue-title \{[^}]*font-size:13px/);
  assert.match(css,/\.row-action \{[^}]*width:32px; height:32px/);
});

test('紧凑清单：全景和细节拥有独立角标与预览，单图、无图不留双图空槽', async () => {
  const {review,Node} = harness();
  review.issues[0].attachments = {context:'a-context',detail:'a-detail'};
  review.issues[1].attachments = {detail:'b-detail'};
  review.sendMessage = async () => ({ok:true,dataUrl:'data:image/png;base64,sample'});
  review.renderIssueList(); await flush();
  const visual = review.issueList.children[0].querySelector('.issue-visual');
  assert.equal(visual.dataset.layout,'stacked');
  assert.deepEqual(visual.children.map(n => n.querySelector('figcaption').textContent),['全景','细节']);
  assert.equal(review.issueList.children[1].querySelector('.issue-visual').dataset.layout,'single');
  assert.equal(review.issueList.children[2].querySelector('.issue-visual'),null);
  const opened = []; review.previewAsset = (...args) => opened.push(args);
  for (const shot of visual.children) shot.querySelector('img').events.click({preventDefault(){},stopPropagation(){}});
  assert.deepEqual(opened.map(args => args[0]),['a-context','a-detail']);
  assert.match(review.inboxCardStyles(),/object-fit:contain/);
  assert.match(review.inboxCardStyles(),/\.issue-shot:focus-within \{ z-index:3/);
});

test('紧凑清单：标准 SVG 搜索、清除后恢复本筛选结果与输入焦点，不改交付勾选', () => {
  const {review,Node} = harness();
  review.issueSearch = new Node('input'); review.issueSearch.value = ' 问题 A ';
  review.issueSearchClear = new Node('button');
  review.applyIssueSearch();
  assert.equal(review.issueSearchQuery,'问题 a'); assert.equal(review.issueList.children.length,1);
  assert.equal(review.issueSearchClear.hidden,false);
  review.applyIssueSearch(true);
  assert.equal(review.issueSearchQuery,''); assert.equal(review.issueList.children.length,3);
  assert.equal(review.issueSearchClear.hidden,true); assert.equal(review.shadow.activeElement,review.issueSearch);
  assert.equal(review.deliverySelection.size,3);
  assert.match(review.createOverlay.toString(),/class='search-icon'/);
  assert.doesNotMatch(review.createOverlay.toString(),/aria-hidden='true'>⌕/);
  assert.match(review.inboxCardStyles(),/font:400 12px\/1.4/);
});

test('紧凑清单：普通删除反馈自动收起；错误反馈不被旧计时器清掉', async () => {
  const {review,clock} = harness();
  review.setIssueDeletionStatus('已取消删除',false,true); await clock.advance(3200);
  assert.equal(review.issueDeletionStatus.textContent,'');
  review.setIssueDeletionStatus('已删除',false,true); await clock.advance(1000);
  review.setIssueDeletionStatus('删除失败，请重试',true); await clock.advance(5000);
  assert.equal(review.issueDeletionStatus.textContent,'删除失败，请重试');
  assert.equal(review.issueDeletionStatus.classList.contains('is-error'),true);
});

test('实际点击分发命中图标按钮和清空入口；禁用按钮不触发动作', () => {
  const {review,Node} = harness();
  const button = review.issueList.children[0].querySelectorAll('.row-action')[2];
  const icon = new Node('svg'); button.append(icon);
  const event = target => ({target,preventDefault(){},stopPropagation(){}});
  review.onUiClick(event(icon)); assert.equal(review.issueDeletions.size,1);
  review.onUiClick(event(icon)); assert.equal(review.issueDeletions.size,0);
  button.disabled = true; review.onUiClick(event(icon)); assert.equal(review.issueDeletions.size,0);
  review.clearIssuesButton.dataset.action = 'clear-issues';
  review.onUiClick(event(review.clearIssuesButton));
  assert.equal([...review.issueDeletions][0].issueIds.length,3);
});

test('删除完整显示 3→2→1，三秒之前不写数据库，成功后淡出并用 FLIP 补位', async () => {
  const {review,clock,messages,motions} = harness();
  const row = review.issueList.children[0], next = review.issueList.children[1];
  const button = row.querySelectorAll('.row-action')[2];
  review.deleteIssue('a'); assert.equal(button.textContent,'删除 3');
  await clock.advance(1000); assert.equal(button.textContent,'删除 2');
  await clock.advance(1000); assert.equal(button.textContent,'删除 1');
  await clock.advance(999); assert.equal(messages.length,0);
  await clock.advance(1);
  assert.equal(messages.length,1); assert.equal(messages[0].type,'UIDELTA_DELETE_ISSUE');
  assert.equal(review.issues.length,2); assert.equal(review.count,2); assert.equal(row.isConnected,false);
  assert.equal(review.issueList.children[0],next,'不重建幸存卡片');
  assert.ok(motions.some(m => m.node === row && m.frames.at(-1).opacity === 0 && m.options.duration === 180));
  assert.ok(motions.some(m => m.node === next && m.frames[0].transform === 'translateY(200px)' && m.options.duration === 240));
  assert.equal(review.issueDeletions.size,0);
});

test('倒计时再次点击取消；离开面板或后台标签页时不偷偷提交', async () => {
  const {review,clock,messages,document} = harness();
  review.deleteIssue('a'); await clock.advance(1000); review.deleteIssue('a');
  await clock.advance(3000); assert.equal(messages.length,0);
  assert.equal(review.issueList.children[0].querySelectorAll('.row-action')[2].textContent,'');
  review.deleteIssue('a'); document.hidden = true; await clock.advance(3000);
  assert.equal(messages.length,0); assert.equal(review.issueDeletions.size,0);
  document.hidden = false; review.deleteIssue('b'); review.cancelPendingIssueDeletions(); await clock.advance(3000);
  assert.equal(messages.length,0);
});

test('提交期间再次点击不重复请求；慢响应不提前移除，失败保留卡片并可重试', async () => {
  const {review,clock,messages} = harness(); const pending = deferred();
  review.sendMessage = m => { messages.push(m); return pending.promise; };
  review.deleteIssue('a'); await clock.advance(3000); review.deleteIssue('a');
  assert.equal(messages.length,1); assert.equal(review.issues.length,3);
  const button = review.issueList.children[0].querySelectorAll('.row-action')[2];
  assert.equal(button.textContent,'删除中…'); assert.equal(button.disabled,true);
  pending.resolve({ok:false,error:'存储失败，请重试'}); await flush();
  assert.equal(review.issues.length,3); assert.equal(button.disabled,false);
  assert.equal(review.issueDeletionStatus.textContent,'存储失败，请重试');
  review.deleteIssue('a'); assert.equal(button.textContent,'删除 3');
});

test('清空不受筛选与勾选影响，只提交点击当时的本次问题；倒计时支持取消', async () => {
  const {review,clock,messages} = harness();
  review.issueSearchQuery = '问题 a'; review.deliverySelection = new Set(['a']); review.deliverySelectionTouched = true;
  review.renderIssueList(); assert.equal(review.issueList.children.length,1);
  review.clearIssues(); assert.equal(review.clearIssuesButton.textContent,'清空 3');
  review.clearIssues(); await clock.advance(3000); assert.equal(messages.length,0);
  review.clearIssues(); review.issues.push({id:'new',sessionId:'s'}); await clock.advance(3000);
  assert.deepEqual(Array.from(messages[0].issueIds),['a','b','c']); assert.equal(messages[0].sessionId,'s');
  assert.equal(messages[0].type,'UIDELTA_DELETE_ISSUES');
  assert.deepEqual(review.issues.map(i => i.id),['new']); assert.equal(review.deliverySelection.size,0);
});

test('清空成功显示空态、释放选择和旧编辑草稿，但保留走查会话', async () => {
  const {review,clock,shadow} = harness();
  shadow.activeElement = review.issueList.children[0].querySelector('.row-action');
  review.composer = {issue:{id:'a'}}; review.captureEpoch = 0;
  review.clearIssues(); await clock.advance(3000);
  assert.equal(review.issues.length,0); assert.equal(review.issueList.children.length,0);
  assert.equal(review.issueEmpty.classList.contains('visible'),true);
  assert.equal(review.clearIssuesButton.disabled,true); assert.equal(review.session.id,'s');
  assert.equal(review.composer,null); assert.equal(review.captureEpoch,1);
  assert.equal(shadow.activeElement,shadow.querySelector('.issue-search-input'));
});

test('筛选重新渲染保留原倒计时期限；清空失败不移除任何卡片', async () => {
  const {review,clock,messages} = harness();
  review.deleteIssue('a'); await clock.advance(1000); review.renderIssueList();
  assert.equal(review.issueList.children[0].querySelectorAll('.row-action')[2].textContent,'删除 2');
  await clock.advance(2000); assert.equal(messages.length,1);
  review.sendMessage = async () => { throw new Error('连接中断'); };
  review.clearIssues(); await clock.advance(3000);
  assert.equal(review.issues.length,2); assert.equal(review.issueList.children.length,2);
  assert.equal(review.clearIssuesButton.disabled,false); assert.equal(review.issueDeletionStatus.textContent,'连接中断');
});

test('动画 API 失败不阻塞真实删除；没有可删除项或取证未完成时不提交', async () => {
  const {review,clock,messages} = harness();
  review.composer = {captureStatus:'capturing'}; review.clearIssues(); await clock.advance(3000);
  assert.equal(messages.length,0); review.composer = null;
  review.issueList.children[0].animate = () => { throw new Error('animation unavailable'); };
  review.deleteIssue('a'); await clock.advance(3000);
  assert.equal(review.issues.length,2); assert.equal(review.issueDeletions.size,0);
  review.issues = []; review.clearIssues(); await clock.advance(3000); assert.equal(messages.length,1);
});

test('降低动态效果仅淡出，无位移；删除响应晚于会话切换不修改新列表', async () => {
  const first = harness({reduced:true});
  first.review.deleteIssue('a'); await first.clock.advance(3000);
  assert.ok(first.motions.length); assert.ok(first.motions.every(m => m.frames.every(f => !f.transform)));
  const {review,clock} = harness(); const pending = deferred(); review.sendMessage = () => pending.promise;
  review.deleteIssue('a'); await clock.advance(3000);
  review.session = {id:'another',status:'active'}; review.issues = [{id:'new'}];
  pending.resolve({ok:true}); await flush(); assert.equal(review.issues[0].id,'new');
});

test('同一时刻删除两张卡片串行补位，不影响幸存卡片节点和计数', async () => {
  const {review,clock,messages} = harness(); const survivor = review.issueList.children[2];
  review.deleteIssue('a'); review.deleteIssue('b'); await clock.advance(3000); await flush();
  assert.equal(messages.length,2); assert.equal(review.count,1); assert.equal(review.issueList.children[0],survivor);
  assert.equal(review.issueDeletions.size,0);
});

function databaseHarness({status = 'active', failAsset = false, locked = false} = {}) {
  let tables = {
    sessions:new Map([['s',{id:'s',origin:'https://test.example',status,revision:4,nextIssueNumber:10,...(locked?{finalizingToken:'lock',finalizingExpiresAtMs:Date.now()+10000}:{})}],['other',{id:'other',origin:'https://other.example',status:'active'}]]),
    issues:new Map([['a',{id:'a',sessionId:'s'}],['b',{id:'b',sessionId:'s'}],['keep',{id:'keep',sessionId:'other'}]]),
    assets:new Map(['context','detail','reference'].flatMap(kind => ['a','b','keep'].map(issueId => [`${issueId}-${kind}`,{id:`${issueId}-${kind}`,issueId,kind}]))),
  };
  let transactions = 0;
  const db = {transaction(stores,mode) {
    transactions++; assert.equal(mode,'readwrite'); assert.deepEqual(Array.from(stores),['issues','sessions','assets']);
    const staged = structuredClone(tables); let aborted = false;
    const completion = deferred();
    setImmediate(() => { if (!aborted) {tables = staged; completion.resolve();} });
    return {
      done:completion.promise,
      abort(){aborted = true;completion.resolve();},
      objectStore(name) { return {
        get:id => Promise.resolve(staged[name].get(id)),
        put:item => staged[name].set(item.id,structuredClone(item)),
        delete(id) { if (name === 'assets' && failAsset) throw new Error('disk failure'); staged[name].delete(id); },
        index:field => ({getAll:id => Promise.resolve([...staged[name].values()].filter(v => v[field] === id))})
      }; }
    };
  }};
  const context = vm.createContext({URL,Date,STORE_ISSUES:'issues',STORE_SESSIONS:'sessions',STORE_ASSETS:'assets',
    openDatabase:async()=>db,transactionDone:t=>t.done,requestResult:r=>r,
    nonEmptyString:v=>typeof v === 'string'?v.trim():'',finiteNumber:(v,f)=>Number.isFinite(Number(v))?Number(v):f});
  const source = worker.slice(worker.indexOf('async function deleteIssue('),worker.indexOf('async function captureEvidence('))
    + worker.slice(worker.indexOf('function restoreExpiredFinalizationInStore('),worker.indexOf('async function cleanupStaleCompletedSessions('))
    + worker.slice(worker.indexOf('function normalizeOrigin('),worker.indexOf('async function findLatestActiveSessionForSender('));
  vm.runInContext(source,context);
  return {context, get tables(){return tables;},get transactions(){return transactions;}};
}
const sender = {tab:{url:'https://test.example/page'}};

test('批量删除在单一事务里清理全部截图类型并递增 revision，其他会话和编号不变', async () => {
  const h = databaseHarness();
  const result = await h.context.deleteIssues({sessionId:'s',issueIds:['a','b','a']},sender);
  assert.equal(result.ok,true); assert.equal(h.transactions,1);
  assert.deepEqual([...h.tables.issues.keys()],['keep']);
  assert.deepEqual([...h.tables.assets.keys()],['keep-context','keep-detail','keep-reference']);
  assert.equal(h.tables.sessions.get('s').revision,5); assert.equal(h.tables.sessions.get('s').nextIssueNumber,10);
  assert.equal(h.tables.sessions.get('s').status,'active'); assert.equal(result.deletedAssetIds.length,6);
});

test('跨会话混入、跨站点、已结束与生成证据包期间均拒绝删除并完整回滚', async () => {
  for (const scenario of [
    {ids:['a','keep'],sender}, {ids:['a'],sender:{tab:{url:'https://wrong.example/'}}},
    {ids:['a'],sender,status:'completed'}, {ids:['a'],sender,locked:true},
  ]) {
    const h = databaseHarness(scenario);
    await assert.rejects(h.context.deleteIssues({sessionId:'s',issueIds:scenario.ids},scenario.sender));
    assert.equal(h.tables.issues.size,3); assert.equal(h.tables.assets.size,9); assert.equal(h.tables.sessions.get('s').revision,4);
  }
});

test('附件删除异常回滚问题删除；单条删除幂等且不二次删除资产', async () => {
  const broken = databaseHarness({failAsset:true});
  await assert.rejects(broken.context.deleteIssue('a',sender),/disk failure/);
  assert.equal(broken.tables.issues.size,3); assert.equal(broken.tables.assets.size,9);
  const h = databaseHarness();
  assert.equal((await h.context.deleteIssue('a',sender)).deleted,true);
  assert.equal((await h.context.deleteIssue('a',sender)).deleted,false);
  assert.equal(h.tables.sessions.get('s').revision,5);
  assert.doesNotMatch(content.slice(content.indexOf('    deleteIssue(issueId)'),content.indexOf('    inboxCardStyles()')),/window\.confirm|UIDELTA_DELETE_ASSETS/);
});
