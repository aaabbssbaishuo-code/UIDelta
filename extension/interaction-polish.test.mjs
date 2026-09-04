import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('./content.js', import.meta.url), 'utf8');
const classSource = source.slice(source.indexOf('  const ROOT_ATTRIBUTE'), source.indexOf('  const review = new UIDeltaReview();'));

function harness({ reduced = false } = {}) {
  const animations = [];
  const node = () => {
    const classes = new Set();
    return {
      style: {}, dataset: {}, disabled: false, textContent: '',
      classList: { contains: (n) => classes.has(n), add: (n) => classes.add(n), remove: (n) => classes.delete(n),
        toggle(n, active) { if (active) classes.add(n); else classes.delete(n); } },
      querySelector: () => null, setAttribute() {}, removeAttribute() {}, replaceChildren() {},
      animate(frames, options) {
        let finish;
        const animation = { node: this, frames, options, cancelled: false,
          finished: new Promise((resolve) => { finish = resolve; }),
          cancel() { this.cancelled = true; finish(); }, finish: () => finish() };
        animations.push(animation);
        return animation;
      }
    };
  };
  const context = vm.createContext({ window: { matchMedia: () => ({ matches: reduced }), getComputedStyle: () => ({}) }, scrollX: 0, scrollY: 0 });
  vm.runInContext(classSource + '\nglobalThis.Review = UIDeltaReview;', context);
  const review = Object.create(context.Review.prototype);
  const panelRecord = node(), prompt = node(), label = node();
  panelRecord.disabled = true;
  panelRecord.querySelector = (selector) => selector === '.record-label' ? label : null;
  const elements = new Map([
    [".inspect-actions [data-action='record']", panelRecord],
    ["[data-action='record']", prompt], ['.record-prompt', prompt]
  ]);
  review.shadow = {
    activeElement: { value: '未完成的输入', selectionStart: 3, selectionEnd: 3 },
    querySelector(selector) { if (!elements.has(selector)) elements.set(selector, node()); return elements.get(selector); },
    querySelectorAll: () => []
  };
  review.cacheElements();
  review.enabled = true;
  review.inspectMode = 'annotation';
  review.currentView = 'inspect';
  review.session = { id: 'session', status: 'active' };
  review.modeToolbarSuppressClickUntil = 0;
  review.host = node();
  review.renderLayerProperties = () => {};
  review.elementName = () => '目标元素';
  review.fallbackSelector = () => '#target';
  review.shadowSelectorPath = () => ['#target'];
  for (const name of ['pageSnapshot', 'elementAnchor', 'styleSnapshot', 'getPreviewProposal']) review[name] = () => ({});
  for (const name of ['renderPreviewTools', 'renderUiEditor', 'compareSelected', 'resetPreview', 'syncCursorState', 'setMetric']) review[name] = () => {};
  review.selected = { isConnected: true, tagName: 'DIV', getBoundingClientRect: () => ({ left: 20, top: 30, width: 306, height: 24 }) };
  const icon = node(), button = node();
  button.querySelector = () => icon;
  button.dataset.mode = 'annotation';
  review.panel.style.display = 'block';
  return { review, panelRecord, prompt, label, node, icon, button, animations };
}

const mouseEvent = (button) => ({ currentTarget: button, target: button, detail: 1, preventDefault() {}, stopPropagation() {} });

test('真实模板存在多个记录入口，缓存必须定位检查面板按钮而不是第一个快捷按钮', () => {
  const { review, panelRecord, prompt, label } = harness();
  const markup = review.createOverlay.toString();
  assert.ok(markup.indexOf("class='record-prompt'") < markup.indexOf("class='inspect-actions'"));
  assert.equal(review.recordButton, panelRecord);
  assert.notEqual(review.recordButton, prompt);
  review.updateInspector(review.selected);
  assert.equal(panelRecord.disabled, false);
  review.updateRecordButton(true);
  assert.equal(label.textContent, '记录问题');
  review.session.status = 'paused';
  review.updateInspector(review.selected);
  assert.equal(panelRecord.disabled, true);
  review.session.status = 'active';
  review.updateInspector(review.selected);
  review.resetInspection();
  assert.equal(panelRecord.disabled, true);
});

test('检查面板记录按钮经正常点击处理器进入记录流程', () => {
  const { review, panelRecord } = harness();
  review.updateInspector(review.selected);
  assert.equal(panelRecord.disabled, false);
  panelRecord.dataset.action = 'record';
  panelRecord.closest = (selector) => selector === '[data-action]' ? panelRecord : null;
  let calls = 0;
  review.openComposer = () => { calls++; };
  review.onUiClick(mouseEvent(panelRecord));
  assert.equal(calls, 1);
});

test('三个模式点击有图标缩放，UI/标注面板有 200ms 入场，框选不弹面板', () => {
  for (const mode of ['ui', 'annotation', 'region']) {
    const { review, button, icon, animations } = harness();
    button.dataset.mode = mode;
    review.restorePanel = () => {};
    const switchMode = (next) => {
      review.inspectMode = next;
      review.uiEditor.classList.toggle('visible', next === 'ui');
      review.panel.style.display = next === 'annotation' ? 'block' : 'none';
    };
    review.setInspectMode = switchMode;
    review.resumeReview = switchMode; // Loaded build keeps its draft-aware resume path.
    review.onModeButtonClick(mouseEvent(button));
    assert.equal(review.inspectMode, mode);
    assert.equal(animations[0].node, icon);
    assert.equal(animations[0].options.duration, 150);
    assert.equal(animations.length, mode === 'region' ? 1 : 2);
    if (mode !== 'region') assert.equal(animations[1].options.duration, 200);
    for (const animation of animations) {
      for (const frame of animation.frames) assert.ok(Object.keys(frame).every((key) => ['transform', 'opacity'].includes(key)));
    }
  }
});

test('快速切换取消旧动画；旧动画结束不会清掉新动画，也不会触碰输入焦点', async () => {
  const { review, button } = harness();
  const active = review.shadow.activeElement;
  review.animateToolbarAction(button, mouseEvent(button));
  const previous = review.toolbarAnimations;
  review.animateToolbarAction(button, mouseEvent(button));
  const current = review.toolbarAnimations;
  assert.ok(previous.every((a) => a.cancelled));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(review.toolbarAnimations, current);
  assert.equal(review.shadow.activeElement, active);
  assert.equal(active.selectionStart, 3);
  review.cancelToolbarTransition();
  assert.ok(current.every((a) => a.cancelled));
});

test('键盘、减少动态效果和取证期间不播放位移动画；浏览只反馈图标', () => {
  for (const state of ['keyboard', 'reduced', 'capture', 'browse', 'drag']) {
    const { review, button, animations } = harness({ reduced: state === 'reduced' });
    if (state === 'capture') review.captureOverlayStyles = [];
    if (state === 'browse') review.browseMode = true;
    if (state === 'drag') review.panelDrag = {};
    review.animateToolbarAction(button, { detail: state === 'keyboard' ? 0 : 1 });
    assert.equal(animations.length, ['browse', 'drag'].includes(state) ? 1 : 0);
  }
});

test('截图隐藏前取消工具栏和面板动画，恢复时不改原输入节点', () => {
  const { review, button } = harness();
  review.animateToolbarAction(button, mouseEvent(button));
  const active = review.shadow.activeElement, running = review.toolbarAnimations;
  review.setCaptureOverlayVisible(false, true);
  assert.ok(running.every((a) => a.cancelled));
  assert.equal(review.panel.style.opacity, '0');
  review.setCaptureOverlayVisible(true);
  assert.equal(review.shadow.activeElement, active);
  for (const method of ['showView', 'setInspectMode', 'setBrowseMode', 'setEnabled', 'onPanelPointerDown', 'onUiEditorPointerDown']) {
    assert.ok(review[method].toString().includes('cancelToolbarTransition'), method);
  }
});

test('交付页无重复选择、全选和批量删除，默认全部且清单筛选范围显式显示', () => {
  const { review, node } = harness();
  const markup = review.createOverlay.toString();
  assert.doesNotMatch(markup, /class='delivery-select|data-action='delete-delivery-selected'/);
  review.issues = [{ id: 'b', sequence: 2 }, { id: 'a', sequence: 1 }];
  review.deliverySelection = new Set();
  review.deliverySelectionTouched = false;
  const actions = [node(), node(), node(), node()];
  review.shadow.querySelectorAll = () => actions;
  review.renderDeliveryWorkspace();
  assert.equal(review.deliveryCount.textContent, '导出本次全部 2 个问题');
  assert.deepEqual(Array.from(review.selectedDeliveryIssues(), (i) => i.id), ['a', 'b']);
  assert.ok(actions.every((button) => !button.disabled));
  review.deliverySelectionTouched = true;
  review.deliverySelection.delete('b');
  review.renderDeliveryWorkspace();
  assert.equal(review.deliveryCount.textContent, '导出清单中勾选的 1 / 2 个问题');
  review.deliverySelection.clear();
  review.renderDeliveryWorkspace();
  assert.match(review.deliveryCount.textContent, /返回问题清单/);
  assert.ok(actions.every((button) => button.disabled));
  review.issues = [];
  review.renderDeliveryWorkspace();
  assert.equal(review.deliveryCount.textContent, '还没有可交付的问题');
});

test('HTML、XLSX、ZIP 和复制使用相同问题范围，不受已移除控件影响', async () => {
  const { review, node } = harness();
  review.issues = [{ id: 'b', sequence: 2 }, { id: 'a', sequence: 1 }];
  review.deliverySelection = new Set();
  review.deliverySelectionTouched = false;
  const requests = [];
  review.sendMessage = async (message) => { requests.push(message); return { ok: true }; };
  review.showToast = () => {};
  for (const format of ['html', 'xlsx', 'zip']) await review.exportDeliverable(format, node());
  assert.deepEqual(requests.map((r) => r.format), ['html', 'xlsx', 'zip']);
  for (const request of requests) assert.deepEqual(Array.from(request.issueIds), ['a', 'b']);
  let copied;
  review.buildAgentHandoff = (issues) => Array.from(issues, (i) => i.id).join(',');
  review.copyText = async (text) => { copied = text; };
  await review.copyAgentHandoff();
  assert.equal(copied, 'a,b');
});

test('勾选清除蓝色内阴影，尺寸标签浅暖色，交付三图标为完整内嵌 SVG', () => {
  const { review } = harness();
  const css = review.brandThemeStyles();
  assert.match(css, /\.issue-select:checked\s*\{[^}]*box-shadow:none/);
  assert.match(css, /\.tooltip\s*\{[^}]*background:#fff0e8;[^}]*color:#5c2a1e/);
  const icons = review.deliveryCardsMarkup();
  assert.equal((icons.match(/<svg /g) || []).length, 3);
  assert.equal((icons.match(/viewBox='0 0 24 24' width='20' height='20'/g) || []).length, 3);
  assert.doesNotMatch(icons, /[▤▦⌘]|<img|https?:/);
  for (const format of ['html', 'xlsx', 'zip']) assert.ok(icons.includes("data-action='deliver-" + format + "'"));
});
