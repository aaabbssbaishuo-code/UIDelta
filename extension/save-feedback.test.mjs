import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('./content.js', import.meta.url), 'utf8');
const classSource = source.slice(source.indexOf('  const ROOT_ATTRIBUTE'), source.indexOf('  const review = new UIDeltaReview();'));
const settle = () => new Promise((resolve) => setImmediate(resolve));

function harness({ reduced = false } = {}) {
  const animations = [];
  class Node {
    constructor() {
      this.children = []; this.attributes = {}; this.className = ''; this.textContent = '';
      this.style = {}; this.disabled = false; this.isConnected = true;
      this.classList = {
        add: (name) => { this.className += ' ' + name; },
        remove: (name) => { this.className = this.className.split(' ').filter((n) => n !== name).join(' '); },
        contains: (name) => this.className.split(' ').includes(name)
      };
    }
    setAttribute(name, value) { this.attributes[name] = value; }
    appendChild(node) { node.parent = this; this.children.push(node); }
    replaceChildren(...nodes) { this.children = []; nodes.forEach((n) => this.appendChild(n)); }
    remove() { if (this.parent) this.parent.children = this.parent.children.filter((n) => n !== this); }
    querySelector(selector) { return this.children.find((n) => n.className === selector.slice(1)); }
    animate(frames, options) {
      let resolve, reject;
      const finished = new Promise((yes, no) => { resolve = yes; reject = no; });
      const animation = { node:this, frames, options, finished, cancelled:false,
        finish:resolve, cancel() { this.cancelled = true; reject(new Error('cancelled')); } };
      animations.push(animation);
      return animation;
    }
  }
  const context = vm.createContext({ document:{ createElement:() => new Node() }, window:{ matchMedia:() => ({ matches:reduced }) } });
  vm.runInContext(classSource + '\nglobalThis.Review = UIDeltaReview;', context);
  const status = new Node(), inline = new Node();
  const requests = [];
  const review = Object.assign(Object.create(context.Review.prototype), {
    enabled:true, browseMode:false, issues:[], session:{ id:'s', status:'active' }, captureEpoch:1,
    modeIssueCount:new Node(), dockCount:new Node(), issueCount:new Node(),
    shadow:{ activeElement:{ value:'不应丢失焦点' }, querySelector:(s) => s === '.mode-save-status' ? status : inline, querySelectorAll:() => [] },
    saveButton:new Node(), cancelComposerButton:new Node(), composerError:new Node(), referenceInput:new Node(),
    descriptionInput:{ value:'按钮需要对齐', focus() { throw new Error('不应抢焦点'); } },
    updateComposerControls() {}, renderCaptureState() {}, renderPins() {}, persistTabContext() {},
    getPreviewProposal:() => null, issueTitle:(text) => text, showToast() {},
    showView(view) { this.cancelToolbarTransition(); this.currentView = view; },
    sendMessage(message) { return new Promise((resolve) => { requests.push({ message, resolve }); }); }
  });
  const issue = (id, reviewStatus = 'accepted') => ({ id, reviewStatus, displayId:id, attachments:{ context:'c', detail:'d' } });
  const composer = (record) => {
    review.composer = { issue:record, mode:'edit', captureStatus:'ready', type:'ui', priority:'queued', severity:'cosmetic' };
  };
  return { review, status, animations, requests, issue, composer, value:() => review.modeIssueCount.querySelector('.mode-count-value') };
}

test('草稿不提前增加工具栏计数，清单仍包含草稿并有明确提示', () => {
  const { review, issue, value, animations } = harness();
  review.issues = [issue('saved'), issue('draft', 'draft'), { id:'legacy' }];
  review.updateCounts();
  assert.equal(value().textContent, '2');
  assert.equal(review.issueCount.textContent, '3');
  assert.match(review.modeIssueCount.attributes['aria-label'], /已记录 2 个问题，另有 1 个草稿/);
  assert.equal(animations.length, 0);
});

test('真实保存成功后草稿变为已记录：数字上滚、扩散圈和 +1，动画不阻塞返回', async () => {
  const { review, issue, composer, requests, value, animations, status } = harness();
  const draft = issue('new', 'draft');
  review.issues = [issue('one'), draft];
  review.updateCounts(); composer(draft);
  const button = review.modeIssueCount, focus = review.shadow.activeElement;
  const saving = review.saveComposer();
  assert.equal(value().textContent, '1');
  assert.equal(animations.length, 0);
  assert.equal(requests[0].message.issue.reviewStatus, 'accepted');
  requests[0].resolve({ ok:true, issue:requests[0].message.issue });
  await saving;
  assert.equal(review.currentView, 'inspect');
  assert.equal(value().textContent, '2');
  assert.equal(animations.length, 4);
  assert.equal(review.modeIssueCount, button);
  assert.equal(review.shadow.activeElement, focus);
  assert.match(status.textContent, /已新增 1 个问题，共 2 个/);
  assert.ok(animations.some((a) => a.node.className === 'mode-count-previous' && a.node.textContent === '1'));
  assert.ok(animations.some((a) => a.node.className === 'mode-count-increment' && a.node.textContent === '+1'));
  assert.ok(animations.some((a) => a.node.className === 'mode-count-halo'));
  animations.forEach((a) => a.finish()); await settle();
  assert.equal(review.issueCountTransition, null);
  assert.equal(button.children.length, 1);
  assert.equal(value().textContent, '2');
});

test('修改已有问题、保存失败与空描述不产生增量反馈', async () => {
  for (const failure of [false, true]) {
    const { review, issue, composer, requests, animations } = harness();
    const record = issue('one', failure ? 'draft' : 'accepted');
    review.issues = [record]; review.updateCounts(); composer(record);
    const saving = review.saveComposer();
    requests[0].resolve(failure ? { ok:false, error:'保存失败' } : { ok:true, issue:requests[0].message.issue });
    await saving;
    assert.equal(animations.length, 0);
    assert.equal(review.recordedIssueCount(), failure ? 0 : 1);
    if (failure) { assert.ok(review.composer); assert.equal(review.saveButton.disabled, false); }
  }
  const { review, composer, issue, requests, animations } = harness();
  composer(issue('empty', 'draft'));
  review.descriptionInput.value = '   ';
  review.descriptionInput.focus = () => {};
  await review.saveComposer();
  assert.equal(requests.length, 0);
  assert.equal(animations.length, 0);
});

test('连续增长取消旧动画，旧完成回调不会清理新一轮；同步相同计数不重建节点', async () => {
  const { review, issue, animations, value } = harness();
  review.issues = [issue('one')]; review.updateCounts(); review.animateIssueCount(0, 1);
  const old = review.issueCountTransition;
  review.issues.push(issue('two')); review.updateCounts(); review.animateIssueCount(1, 2);
  const current = review.issueCountTransition, node = value();
  await settle();
  assert.ok(old.animations.every((a) => a.cancelled));
  assert.equal(review.issueCountTransition, current);
  review.updateCounts();
  assert.equal(value(), node);
  assert.equal(review.issueCountTransition, current);
  animations.forEach((a) => a.finish()); await settle();
  assert.equal(review.modeIssueCount.children.length, 1);
});

test('9→10、99→100 和 100→101 保留固定按钮尺寸与精确无障碍计数', () => {
  for (const count of [10, 100, 101]) {
    const { review, issue, value, animations } = harness();
    review.issues = Array.from({ length:count }, (_, i) => issue(String(i)));
    review.updateCounts(); review.animateIssueCount(count - 1, count);
    assert.equal(value().textContent, count > 99 ? '99+' : String(count));
    assert.match(review.modeIssueCount.attributes['aria-label'], new RegExp(`已记录 ${count} 个问题`));
    for (const a of animations) for (const frame of a.frames) {
      assert.ok(Object.keys(frame).every((key) => ['transform', 'opacity', 'offset'].includes(key)));
    }
    review.cancelIssueCountTransition();
  }
});

test('减少动态效果只保留渐隐反馈；浏览、禁用、截图、拖动不播放', () => {
  const { review, issue, animations } = harness({ reduced:true });
  review.issues = [issue('one')]; review.updateCounts(); review.animateIssueCount(0, 1);
  assert.equal(animations.length, 2);
  assert.ok(animations.every((a) => a.frames.every((f) => !('transform' in f))));
  review.cancelIssueCountTransition();
  for (const state of ['disabled', 'browse', 'capture', 'drag']) {
    const h = harness();
    h.review.issues = [h.issue('one')]; h.review.updateCounts();
    if (state === 'disabled') h.review.enabled = false;
    if (state === 'browse') h.review.browseMode = true;
    if (state === 'capture') h.review.captureOverlayStyles = [];
    if (state === 'drag') h.review.modeToolbarDrag = {};
    h.review.animateIssueCount(0, 1);
    assert.equal(h.animations.length, 0, state);
  }
});

test('关闭、切换和截图的公共取消路径清理增量浮层；拖动工具栏也会取消', () => {
  const { review, issue, animations } = harness();
  review.issues = [issue('one')]; review.updateCounts(); review.animateIssueCount(0, 1);
  review.cancelToolbarTransition();
  assert.ok(animations.every((a) => a.cancelled));
  assert.equal(review.modeIssueCount.children.length, 1);
  assert.ok(review.onModeToolbarPointerDown.toString().includes('cancelIssueCountTransition'));
  for (const method of ['showView', 'setEnabled', 'setBrowseMode', 'setCaptureOverlayVisible']) {
    assert.ok(review[method].toString().includes('cancelToolbarTransition') || method === 'showView');
  }
});

test('扩展菜单与工具栏图标声明齐全，四种分辨率均为有效 PNG', async () => {
  const manifest = JSON.parse(await readFile(new URL('./manifest.json', import.meta.url), 'utf8'));
  for (const size of [16, 32, 48, 128]) {
    assert.equal(manifest.icons[size], `icons/icon-${size}.png`);
    assert.equal(manifest.action.default_icon[size], manifest.icons[size]);
    const png = await readFile(new URL(manifest.icons[size], import.meta.url));
    assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.equal(png.readUInt32BE(16), size);
    assert.equal(png.readUInt32BE(20), size);
  }
});
