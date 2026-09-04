import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('./content.js', import.meta.url), 'utf8');
const classSource = source.slice(source.indexOf('  const ROOT_ATTRIBUTE'), source.indexOf('  const review = new UIDeltaReview();'));
const settle = () => new Promise((resolve) => setImmediate(resolve));

function harness() {
  let nextTimer = 0;
  const timers = new Map(), requests = [];
  const window = { innerWidth:1200, innerHeight:800,
    setTimeout(callback, delay) { const id = ++nextTimer; timers.set(id, { callback, delay }); return id; },
    clearTimeout(id) { timers.delete(id); } };
  const context = vm.createContext({ window });
  vm.runInContext(classSource + '\nglobalThis.Review = UIDeltaReview;', context);
  const node = (box = {}) => ({ hidden:false, isConnected:true, style:{}, attributes:{}, events:{},
    dataset:{}, src:'', textContent:'',
    addEventListener(type, callback) { this.events[type] = callback; },
    setAttribute(key, value) { this.attributes[key] = value; },
    removeAttribute(key) { delete this.attributes[key]; if (key === 'src') this.src = ''; },
    contains(other) { return other === this; },
    getBoundingClientRect:() => ({ left:950, right:1010, top:740, height:28, ...box }) });
  const buttons = ['html', 'xlsx', 'zip'].map((format) => { const b = node(); b.dataset.format = format; return b; });
  const popup = node({ width:300, height:210 }), image = node(), caption = node(), scroll = node();
  popup.hidden = true;
  const focus = {};
  const review = Object.assign(Object.create(context.Review.prototype), {
    enabled:true, currentView:'deliver', deliveryHover:popup, deliveryHoverImage:image, deliveryHoverCaption:caption,
    preview:{ hidden:true }, shadow:{ activeElement:focus, querySelectorAll:() => buttons, querySelector:() => scroll },
    sendMessage:async (request) => { requests.push(request); return { ok:true, dataUrl:'image-' + request.format }; }
  });
  review.bindDeliveryExampleEvents();
  const flush = async () => { const all = [...timers.values()]; timers.clear(); all.forEach((t) => t.callback()); await settle(); };
  return { review, buttons, popup, image, caption, scroll, focus, timers, requests, flush, window };
}

test('三处仅显示示例，保留点击入口和独立非模态图片浮层', () => {
  const { review } = harness();
  const markup = review.deliveryCardsMarkup();
  assert.equal((markup.match(/>示例<\/button>/g) || []).length, 3);
  assert.doesNotMatch(markup, />查看示例</);
  assert.equal((markup.match(/data-action='preview-delivery'/g) || []).length, 3);
  assert.match(review.createOverlay.toString(), /class='delivery-example-preview'[^>]*role='tooltip' hidden/);
  assert.match(review.compactSurfaceStyles(), /\.delivery-example-preview \{[^}]*position:fixed/);
  assert.match(review.compactSurfaceStyles(), /\.delivery-example-preview \{[^}]*width:min\(300px,calc\(100vw - 24px\)\)[^}]*padding:6px/);
  assert.match(review.compactSurfaceStyles(), /\.delivery-example-image \{[^}]*max-height:min\(60vh,220px\); object-fit:contain/);
});

test('悬停稍作停留再加载，原焦点和整页不受影响；移入图片保持，移出关闭', async () => {
  const { review, buttons, popup, image, focus, timers, flush, requests } = harness();
  buttons[0].events.pointerenter({ pointerType:'mouse' });
  assert.equal(requests.length, 0);
  assert.equal([...timers.values()][0].delay, 180);
  await flush();
  assert.equal(popup.hidden, false);
  assert.equal(image.src, 'image-html');
  assert.equal(review.preview.hidden, true);
  assert.equal(review.shadow.activeElement, focus);
  assert.equal(buttons[0].attributes['aria-describedby'], 'uidelta-delivery-example');
  buttons[0].events.pointerleave({ relatedTarget:null });
  popup.events.pointerenter();
  await flush();
  assert.equal(popup.hidden, false);
  popup.events.pointerleave(); await flush();
  assert.equal(popup.hidden, true);
  assert.equal(image.src, '');
  assert.equal(buttons[0].attributes['aria-describedby'], undefined);
});

test('短暂划过不发请求；触屏不触发 hover；键盘聚焦可看，离焦可关', async () => {
  const { buttons, requests, flush, popup } = harness();
  buttons[0].events.pointerenter({ pointerType:'mouse' });
  buttons[0].events.pointerleave({ relatedTarget:null }); await flush();
  assert.equal(requests.length, 0);
  buttons[0].events.pointerenter({ pointerType:'touch' }); await flush();
  assert.equal(requests.length, 0);
  buttons[1].events.focus(); await flush();
  assert.equal(requests[0].format, 'xlsx');
  assert.equal(popup.hidden, false);
  buttons[1].events.blur({ relatedTarget:null }); await flush();
  assert.equal(popup.hidden, true);
});

test('快速切换及关闭后不被迟到图片覆盖；成功图片复用缓存，失败可重试', async () => {
  const { review, buttons, image, popup, caption } = harness();
  const pending = [];
  review.sendMessage = () => new Promise((resolve) => pending.push(resolve));
  const first = review.showDeliveryExampleHover(buttons[0]);
  const second = review.showDeliveryExampleHover(buttons[1]);
  pending[1]({ ok:true, dataUrl:'xlsx' }); await second;
  pending[0]({ ok:true, dataUrl:'old-html' }); await first;
  assert.equal(image.src, 'xlsx');
  const third = review.showDeliveryExampleHover(buttons[2]);
  review.hideDeliveryExampleHover(); pending[2]({ ok:true, dataUrl:'zip' }); await third;
  assert.equal(popup.hidden, true); assert.equal(image.src, '');
  await review.showDeliveryExampleHover(buttons[1]);
  assert.equal(pending.length, 3); assert.equal(image.src, 'xlsx');
  review.deliveryExampleCache.clear();
  review.sendMessage = async () => { throw new Error('offline'); };
  await review.showDeliveryExampleHover(buttons[0]);
  assert.match(caption.textContent, /加载失败/); assert.equal(image.hidden, true);
  review.sendMessage = async () => ({ ok:true, dataUrl:'retry' });
  await review.showDeliveryExampleHover(buttons[0]);
  assert.equal(image.src, 'retry');
});

test('浮层不超出屏幕，滚动、Esc、收起、截图及切换会清理', async () => {
  const { review, buttons, popup, scroll, window } = harness();
  await review.showDeliveryExampleHover(buttons[0]);
  assert.equal(popup.style.left, '642px');
  assert.equal(popup.style.top, '578px');
  window.innerWidth = 480;
  popup.getBoundingClientRect = () => ({ width:300, height:210 });
  buttons[0].getBoundingClientRect = () => ({ left:15, right:70, top:5, height:28 });
  review.positionDeliveryExampleHover();
  assert.equal(popup.style.left, '78px'); assert.equal(popup.style.top, '12px');
  window.innerWidth = 320;
  popup.getBoundingClientRect = () => ({ width:296, height:210 });
  review.positionDeliveryExampleHover();
  assert.equal(popup.style.left, '12px'); assert.equal(popup.style.top, '12px');
  scroll.events.scroll(); assert.equal(popup.hidden, true);
  await review.showDeliveryExampleHover(buttons[0]);
  review.onKeyDown({ key:'Escape', preventDefault() {}, stopImmediatePropagation() {} });
  assert.equal(popup.hidden, true);
  assert.equal(review.currentView, 'deliver'); assert.equal(review.enabled, true);
  for (const method of ['cancelToolbarTransition', 'onLayoutChange', 'onWindowBlur', 'minimizePanel', 'previewDeliveryExample']) {
    assert.ok(review[method].toString().includes('hideDeliveryExampleHover'), method);
  }
});

test('离开交付页、浏览、截图及已打开大图时不会误弹预览', async () => {
  for (const mode of ['inspect', 'disabled', 'browse', 'capture', 'modal']) {
    const { review, buttons, popup, requests } = harness();
    if (mode === 'inspect') review.currentView = 'inspect';
    if (mode === 'disabled') review.enabled = false;
    if (mode === 'browse') review.browseMode = true;
    if (mode === 'capture') review.captureOverlayStyles = [];
    if (mode === 'modal') review.preview.hidden = false;
    await review.showDeliveryExampleHover(buttons[0]);
    assert.equal(popup.hidden, true, mode); assert.equal(requests.length, 0);
  }
});
