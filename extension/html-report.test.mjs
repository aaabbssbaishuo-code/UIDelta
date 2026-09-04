import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('./service-worker.js', import.meta.url), 'utf8');
const listener = { addListener() {} };
const worker = vm.createContext({ Blob, fetch, URL, TextEncoder, btoa, chrome: {
  runtime: { onInstalled: listener, onMessage: listener }, commands: { onCommand: listener },
  action: { onClicked: listener }, tabs: { onRemoved: listener, onUpdated: listener }
} });
vm.runInContext(source.replace(/^import[^\n]+\n/, ''), worker);
const issue = (extra = {}) => ({
  id: 'i1', displayId: 'UI-001', type: 'ui', title: '【UI】标题', description: '标题\n保留完整的补充说明。',
  priority: 'soon', severity: 'blocked', pageSnapshot: { title: '项目管理平台', route: '/delivery/', url: 'https://example.test/delivery/' },
  elementAnchor: { preferredSelector: '#card', rect: { width: 244.75, height: 34.5, x: 0, y: -12 } },
  ...extra
});
const png = 'data:image/png;base64,iVBORw0KGgo=';
const assets = [
  { id: 'ctx', kind: 'context', dataUrl: png },
  { id: 'detail', kind: 'detail', dataUrl: png },
  { id: 'ref', kind: 'reference', dataUrl: png }
].map(asset => ({ ...asset, issueId: 'i1' }));
const build = (issues = [issue()], evidence = assets) => worker.buildHtmlReport({ id: 's1', name: '项目管理平台' }, issues, evidence, '2026-09-04T07:12:00Z');

// Parse the actual generated HTML and run its script. Layout and native dialog
// behaviour remain a separate real-browser acceptance gate.
function domHarness(html, { stored = {}, readFailure = false, writeFailure = false, exportFailure = false } = {}) {
  const storage = new Map(Object.entries(stored)), downloads = [], objects = [], revoked = [], timers = [];
  const decode = text => text.replace(/&(amp|lt|gt|quot|#39|#96);/g, (_, x) => ({amp:'&',lt:'<',gt:'>',quot:'"','#39':"'",'#96':String.fromCharCode(96)})[x]);
  let document;
  class Node {
    constructor(tagName = 'div') {
      Object.assign(this, { tagName, children: [], parentElement: null, attributes: {}, dataset: {}, style: {}, events: {}, value: '', hidden: false, disabled: false, className: '', _text: '', complete: false, naturalWidth: 0 });
      this.classList = {
        contains: name => this.className.split(' ').includes(name),
        toggle: (name, on) => { const names = new Set(this.className.split(' ').filter(Boolean)); on ? names.add(name) : names.delete(name); this.className = [...names].join(' '); },
        add: name => this.classList.toggle(name, true)
      };
    }
    append(...nodes) { for (const node of nodes) { node.parentElement = this; this.children.push(node); } }
    replaceChildren(...nodes) { for (const node of this.children) node.parentElement = null; this.children = []; this.append(...nodes); }
    remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(n => n !== this); this.parentElement = null; }
    get firstElementChild() { return this.children.find(n => n.tagName !== '#text') || null; }
    get textContent() { return this._text + this.children.map(n => n.textContent).join(''); }
    set textContent(value) { this._text = String(value); this.replaceChildren(); }
    setAttribute(name, value) {
      this.attributes[name] = String(value);
      if (name.startsWith('data-')) this.dataset[name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = String(value);
      if (name === 'class') this.className = value;
      if (['id','src','value'].includes(name)) this[name] = value;
      if (['hidden','disabled'].includes(name)) this[name] = true;
    }
    matches(selector) {
      if (selector.startsWith('.')) return this.classList.contains(selector.slice(1));
      if (selector.startsWith('#')) return this.id === selector.slice(1);
      const attr = selector.match(/^\[([^=\]]+)(?:="([^"]*)")?\]$/);
      if (attr) return attr[1] in this.attributes && (attr[2] === undefined || this.attributes[attr[1]] === attr[2]);
      return this.tagName === selector;
    }
    querySelectorAll(selector) { return this.children.flatMap(n => [...(n.matches(selector) ? [n] : []), ...n.querySelectorAll(selector)]); }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    closest(selector) { return this.matches(selector) ? this : this.parentElement?.closest(selector) || null; }
    contains(node) { return this === node || this.children.some(n => n.contains(node)); }
    addEventListener(name, fn) { (this.events[name] ||= []).push(fn); }
    fire(name, data = {}) {
      const event = { target: this, key: '', preventDefault() { this.defaultPrevented = true; }, ...data };
      for (const fn of this.events[name] || []) fn(event);
      return event;
    }
    click() { if (!this.disabled) { if (this.tagName === 'a') downloads.push(this); this.fire('click'); } }
    focus() { document.activeElement = this; }
    showModal() { this.open = true; }
    close() { this.open = false; this.fire('close'); }
    getBoundingClientRect() { return { left: 10, right: 100, top: 10, bottom: 100 }; }
  }
  const root = new Node('root'), stack = [root];
  const markup = html.replace(/<style>[\s\S]*?<\/style>|<script>[\s\S]*?<\/script>/g, '');
  for (const token of markup.matchAll(/<\/?[^>]+>|[^<]+/g)) {
    const text = token[0];
    if (text.startsWith('<!')) continue;
    if (text.startsWith('</')) {
      const tag = text.slice(2, -1).trim();
      const index = stack.findLastIndex(n => n.tagName === tag);
      if (index > 0) stack.length = index;
    } else if (text.startsWith('<')) {
      const [, tag, rest] = text.match(/^<([^\s/>]+)([\s\S]*)>$/);
      const node = new Node(tag);
      for (const attr of rest.matchAll(/([-\w:]+)(?:="([^"]*)"|'([^']*)'|=([^\s>]+))?/g)) node.setAttribute(attr[1], decode(attr[2] ?? attr[3] ?? attr[4] ?? ''));
      stack.at(-1).append(node);
      if (!['meta','input','img','br','link','hr'].includes(tag) && !text.endsWith('/>')) stack.push(node);
    } else { const node = new Node('#text'); node._text = decode(text); stack.at(-1).append(node); }
  }
  document = { body: root.querySelector('body'), activeElement: null, querySelector: s => root.querySelector(s), querySelectorAll: s => root.querySelectorAll(s), createElement: tag => new Node(tag) };
  const context = vm.createContext({
    document, location: { pathname: '/report.html' }, Blob,
    localStorage: { getItem(key) { if (readFailure) throw Error('denied'); return storage.get(key) ?? null; }, setItem(key, value) { if (writeFailure) throw Error('full'); storage.set(key, value); } },
    URL: { createObjectURL(blob) { if (exportFailure) throw Error('failed'); objects.push(blob); return 'blob:report'; }, revokeObjectURL(url) { revoked.push(url); } },
    setTimeout: fn => timers.push(fn)
  });
  vm.runInContext(html.match(/<script>([\s\S]*?)<\/script>/)[1], context);
  return { $: document.querySelector, all: document.querySelectorAll, document, storage, downloads, objects, revoked, timers };
}

test('离线报告去重复与空占位，关键尺寸只出现一次，技术分组折叠', async () => {
  const html = await build([issue({ webSnapshot: { layout: { display: 'flex' }, typography: { fontFamily: 'Example, sans-serif', fontSize: '16px' } } })]);
  const ui = domHarness(html);
  assert.equal(ui.$('h2').textContent, '标题');
  assert.equal(ui.$('.description').textContent, '保留完整的补充说明。');
  assert.equal(ui.$('.facts').textContent.match(/244.75/g).length, 1);
  assert.match(ui.$('.facts').textContent, /X 0 · Y -12/);
  assert.ok(!('open' in ui.$('.technical').attributes));
  assert.match(ui.$('.technical').textContent, /定位.*布局.*文字与外观/s);
  assert.doesNotMatch(html, /未提供本地试改建议|无设计差异数据|未填写描述|导出于/);
  assert.doesNotMatch(html, /onclick=|requestFullscreen|<script src=|<link[^>]+href=/);
});

test('超长单行和多行描述完整保留，不被 firstLine 100 字截断影响', async () => {
  const description = '长'.repeat(160) + '\n第二行完整';
  const ui = domHarness(await build([issue({ title: '待补充描述', description })]));
  assert.equal(ui.$('.description').textContent, description);
  const equal = domHarness(await build([issue({ title: '标题', description: '标题' })]));
  assert.equal(equal.$('.description'), null);
});

test('当前附件匹配、参考图保留；缺少截图不留空白双槽', async () => {
  const ui = domHarness(await build([issue({ attachments: { context: 'ctx', detail: 'missing', references: ['ref'] } })]));
  assert.deepEqual(ui.all('[data-evidence]').map(n => n.dataset.label), ['全景','参考 1']);
  assert.match(worker.htmlReportStyles(), /\.evidence\{display:flex;flex-direction:column/);
  assert.match(worker.htmlReportStyles(), /object-fit:contain/);
  const empty = domHarness(await build([issue()], []));
  assert.equal(empty.all('[data-evidence]').length, 0);
  assert.equal(empty.$('.no-evidence').textContent, '暂无截图');
});

test('文本和属性转义；危险链接、损坏 URL 和非位图不会成为可执行内容', async () => {
  const payload = '</script><img src=x onerror=alert(1)>';
  const html = await build([issue({ id: 'a"b', title: payload, description: payload, pageSnapshot: { title: payload, url: 'javascript:alert(1)' }, elementAnchor: { preferredSelector: payload } })]);
  assert.equal((html.match(/<script>/g) || []).length, 1);
  assert.match(html, /&lt;\/script&gt;/);
  assert.doesNotMatch(html, /href="javascript:|<img src=x/);
  assert.equal(worker.htmlEvidenceFigure({dataUrl:'data:image/svg+xml;base64,abc'}, '图', '1'), '');
  assert.doesNotThrow(() => worker.buildHtmlIssueCard(issue({pageSnapshot:{url:'https://['}}), [], 0));
});

test('标记和撤回即时更新整卡、按钮、进度、计数；刷新恢复', async () => {
  const html = await build([issue(), issue({ id: 'i2', displayId: 'UI-002', type: 'content' })]);
  const ui = domHarness(html), button = ui.$('[data-status]'), card = ui.$('.issue');
  button.click();
  assert.equal(button.attributes['aria-pressed'], 'true');
  assert.equal(card.classList.contains('is-done'), true);
  assert.equal(card.querySelector('.state-label').textContent, '已处理');
  assert.equal(ui.$('#progress').value, 1);
  assert.equal(ui.$('[data-count="done"]').textContent, '1');
  const restored = domHarness(html, { stored: Object.fromEntries(ui.storage) });
  assert.equal(restored.$('.issue').classList.contains('is-done'), true);
  button.click();
  assert.equal(card.classList.contains('is-done'), false);
  assert.equal(ui.$('#progress').value, 0);
});

test('组合筛选和空态重置；隐藏当前卡片后焦点不丢失', async () => {
  const ui = domHarness(await build([issue(), issue({ id: 'i2', displayId: 'UI-002', type: 'content', severity: 'cosmetic', title: '文案问题' })]));
  ui.$('#type').value = 'content'; ui.$('#type').fire('input');
  assert.equal(ui.$('.issue').hidden, true);
  ui.$('#search').value = '无匹配'; ui.$('#search').fire('input');
  assert.equal(ui.$('#empty').hidden, false);
  ui.$('#reset-filters').click();
  assert.equal(ui.document.activeElement, ui.$('#search'));
  assert.ok(ui.all('.issue').every(n => !n.hidden));
  ui.$('[data-filter="pending"]').click();
  const button = ui.$('[data-status]'); button.focus(); button.click();
  assert.equal(ui.$('.issue').hidden, true);
  assert.equal(ui.document.activeElement, ui.$('[data-filter="pending"]'));
  ui.$('[data-filter="done"]').click();
  assert.equal(ui.$('.issue').hidden, false);
});

test('存储拒绝或损坏不阻塞操作；不同子集不擦掉其他问题状态', async () => {
  const html = await build();
  for (const options of [{readFailure:true,writeFailure:true}, {stored:{'uidelta-report-status:v2:s1':'bad json'},writeFailure:true}]) {
    const ui = domHarness(html, options);
    ui.$('[data-status]').click();
    assert.equal(ui.$('.issue').dataset.done, 'true');
    assert.equal(ui.$('#storage-notice').hidden, false);
    ui.$('[data-evidence]').click(); assert.equal(ui.$('#viewer').open, true);
  }
  const ui = domHarness(html, {stored:{'uidelta-report-status:v2:s1':'{"another":true,"i1":false}'}});
  ui.$('[data-status]').click();
  assert.deepEqual(JSON.parse(ui.storage.get('uidelta-report-status:v2:s1')), {another:true,i1:true});
});

test('旧版状态只接受布尔值，首次尊重已解决状态，空报告可用', async () => {
  const html = await build([issue({resolutionStatus:'已解决'}), issue({id:'i2'})], []);
  const ui = domHarness(html, {stored:{'uidelta-report-status:/report.html':'{"i1":false,"i2":"false","other":true}'}});
  assert.equal(ui.$('[data-status]').attributes['aria-pressed'], 'false');
  assert.equal(ui.all('[data-status]')[1].attributes['aria-pressed'], 'false');
  assert.equal(domHarness(await build([issue({resolutionStatus:'已解决'})], [])).$('#progress').value, 1);
  const empty = domHarness(await build([], []));
  assert.equal(empty.$('#empty').hidden, false); assert.equal(empty.$('#progress').value, 0);
});

test('状态 JSON 保持 v1 契约；下载链接清理，失败可提示', async () => {
  const html = await build(), ui = domHarness(html);
  ui.$('[data-status]').click(); ui.$('#export-status').click();
  const data = JSON.parse(await ui.objects[0].text());
  assert.equal(data.schemaVersion, 1); assert.equal(data.source, 'UIDelta HTML report');
  assert.deepEqual(data.status, {i1:true});
  assert.equal(ui.downloads[0].download, 'uidelta-report-status.json');
  assert.equal(ui.downloads[0].parentElement, null);
  ui.timers.forEach(fn => fn()); assert.deepEqual(ui.revoked,['blob:report']);
  const failed = domHarness(html, {exportFailure:true}); failed.$('#export-status').click();
  assert.equal(failed.$('#storage-notice').textContent, '状态导出失败，请重试。');
});

test('图片打开对应位置，左右键/按钮循环切换当前卡片证据', async () => {
  const ui = domHarness(await build()), images = ui.all('[data-evidence]');
  images[1].click();
  assert.equal(ui.$('#viewer').open, true);
  assert.equal(ui.$('#viewer-title').textContent, 'UI-001 · 细节');
  assert.equal(ui.$('#viewer-counter').textContent, '2 / 3');
  assert.equal(ui.document.body.style.overflow, 'hidden');
  assert.equal(ui.document.activeElement, ui.$('#viewer-close'));
  assert.equal(ui.$('#viewer').fire('keydown',{key:'ArrowRight'}).defaultPrevented, true);
  assert.equal(ui.$('#viewer-title').textContent, 'UI-001 · 参考 1');
  ui.$('#viewer-next').click(); assert.equal(ui.$('#viewer-counter').textContent, '1 / 3');
  ui.$('#viewer-prev').click(); assert.equal(ui.$('#viewer-counter').textContent, '3 / 3');
  ui.$('#viewer').fire('keydown',{key:'ArrowLeft',altKey:true});
  assert.equal(ui.$('#viewer-counter').textContent, '3 / 3');
});

test('Esc/遮罩关闭还原焦点和滚动；Tab 在弹窗首尾循环', async () => {
  const ui = domHarness(await build()), origin = ui.$('[data-evidence]'), viewer = ui.$('#viewer');
  ui.document.body.style.overflow = 'auto'; origin.click();
  viewer.fire('keydown',{key:'Tab',shiftKey:true});
  assert.equal(ui.document.activeElement,ui.$('#viewer-next'));
  viewer.fire('keydown',{key:'Tab'});
  assert.equal(ui.document.activeElement,ui.$('#viewer-close'));
  viewer.fire('keydown',{key:'Escape'});
  assert.equal(viewer.open,false); assert.equal(ui.document.activeElement,origin);
  assert.equal(ui.document.body.style.overflow,'auto');
  origin.click(); viewer.fire('click',{clientX:0,clientY:0});
  assert.equal(viewer.open,false);
});

test('迟到图片不覆盖新图，失败重试，单图禁用翻页', async () => {
  const ui = domHarness(await build()), host = ui.$('#viewer-image');
  ui.$('[data-evidence]').click(); const old = host.firstElementChild;
  ui.$('#viewer-next').click(); old.fire('load');
  assert.equal(ui.$('#viewer-message').textContent,'加载图片…');
  const active = host.firstElementChild;
  active.fire('error'); assert.equal(ui.$('#viewer-retry').hidden,false);
  ui.$('#viewer-retry').click(); const retried = host.firstElementChild;
  assert.notEqual(retried,active); retried.fire('load');
  assert.equal(retried.hidden,false); assert.equal(ui.$('#viewer-message').textContent,'');
  ui.$('#viewer-close').click(); retried.fire('error');
  assert.equal(host.firstElementChild,null);
  const single = domHarness(await build([issue()],assets.slice(0,1)));
  single.$('[data-evidence]').click();
  assert.equal(single.$('#viewer-prev').disabled,true); assert.equal(single.$('#viewer-next').disabled,true);
});

test('响应式、完成态和减少动态效果；按钮至少 44px，不裁切证据', () => {
  const css = worker.htmlReportStyles();
  assert.match(css, /@media\(max-width:760px\)/); assert.match(css, /@media\(max-width:420px\)/);
  assert.match(css, /prefers-reduced-motion:reduce/); assert.match(css, /\.done-button\{[^}]*min-height:44px/);
  assert.match(css, /\.issue\.is-done\{[^}]*background:var\(--success-soft\)/);
  assert.match(css, /overflow-wrap:anywhere/); assert.doesNotMatch(css, /object-fit:cover/);
});
