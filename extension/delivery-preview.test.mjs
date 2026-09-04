import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('./content.js', import.meta.url), 'utf8');
const worker = await readFile(new URL('./service-worker.js', import.meta.url), 'utf8');
const script = source.slice(source.indexOf('  const ROOT_ATTRIBUTE'), source.indexOf('  const review = new UIDeltaReview();'));
const context = vm.createContext({});
vm.runInContext(script + '\nglobalThis.Review = UIDeltaReview;', context);

function harness() {
  const review = Object.create(context.Review.prototype);
  const control = () => ({ isConnected: true, hidden: false, disabled: false,
    focus() { review.shadow.activeElement = this; } });
  const close = control(), previous = control(), next = control(), trigger = control();
  review.shadow = { activeElement: trigger, querySelector: () => close };
  review.preview = { hidden: true, querySelectorAll: () => [close, previous, next] };
  review.previewImage = { src: '', removeAttribute() { this.src = ''; } };
  review.previewCaption = { textContent: '' };
  review.previewPreviousButton = previous;
  review.previewNextButton = next;
  review.previewItems = [];
  review.previewRequestEpoch = 0;
  review.enabled = true;
  review.showToast = () => {};
  const requests = [];
  review.sendMessage = async (message) => { requests.push(message); return { ok: true, dataUrl: 'data:image/png;base64,' + (message.format || message.assetId) }; };
  return { review, close, previous, next, trigger, requests };
}

test('三张卡片均提供独立查看示例入口，保留原导出动作', () => {
  const { review } = harness();
  const cards = review.deliveryCardsMarkup().split("<article class='delivery-card'>").slice(1);
  assert.equal(cards.length, 3);
  cards.forEach((card, i) => {
    const format = ['html', 'xlsx', 'zip'][i];
    assert.ok(card.includes("data-action='preview-delivery' data-format='" + format + "'"));
    assert.ok(card.includes("data-action='deliver-" + format + "'"));
    assert.match(card, /aria-label='查看 [^']+示例'/);
  });
});

test('点击指定卡片打开对应示例，支持前后切换；不会读取或写入问题资产', async () => {
  const { review, trigger, close, requests } = harness();
  await review.previewDeliveryExample('xlsx', trigger);
  assert.equal(review.previewIndex, 1);
  assert.equal(review.preview.hidden, false);
  assert.equal(review.previewImage.src, 'data:image/png;base64,xlsx');
  assert.match(review.previewCaption.textContent, /XLSX.*2\/3/);
  assert.equal(review.shadow.activeElement, close);
  await review.loadPreviewItem(2);
  assert.equal(review.previewImage.src, 'data:image/png;base64,zip');
  await review.loadPreviewItem(3);
  assert.equal(review.previewImage.src, 'data:image/png;base64,html');
  assert.ok(requests.every((request) => request.type === 'UIDELTA_GET_DELIVERY_PREVIEW'));
  review.closeImagePreview();
  assert.equal(review.preview.hidden, true);
  assert.equal(review.previewImage.src, '');
  assert.equal(review.shadow.activeElement, trigger);
});

test('加载期间先给关闭按钮焦点；慢响应不会重新抢焦点或覆盖新图片', async () => {
  const { review, trigger, close, next } = harness();
  const pending = [];
  review.sendMessage = () => new Promise((resolve) => pending.push(resolve));
  const first = review.previewDeliveryExample('html', trigger);
  assert.equal(review.shadow.activeElement, close);
  const second = review.loadPreviewItem(1);
  next.focus();
  pending[1]({ ok: true, dataUrl: 'xlsx' });
  await second;
  pending[0]({ ok: true, dataUrl: 'stale-html' });
  await first;
  assert.equal(review.previewImage.src, 'xlsx');
  assert.equal(review.shadow.activeElement, next);
});

test('关闭后丢弃未完成的图片请求；失败有可读提示；非法格式不发请求', async () => {
  const { review, trigger, requests } = harness();
  await review.previewDeliveryExample('../secret', trigger);
  assert.equal(requests.length, 0);
  let finish;
  review.sendMessage = () => new Promise((resolve) => { finish = resolve; });
  const loading = review.previewDeliveryExample('zip', trigger);
  review.closeImagePreview();
  finish({ ok: true, dataUrl: 'late' });
  await loading;
  assert.equal(review.preview.hidden, true);
  assert.equal(review.previewImage.src, '');
  review.sendMessage = async () => { throw new Error('offline'); };
  await review.previewDeliveryExample('html', trigger);
  assert.match(review.previewCaption.textContent, /示例加载失败/);
  assert.equal(review.previewImage.src, '');
});

test('原始截图预览仍走资产消息；示例和截图不会混用数据', async () => {
  const { review, requests } = harness();
  await review.previewDeliveryExample('html');
  await review.previewAsset('asset-real', '全景截图');
  assert.equal(requests.at(-1).type, 'UIDELTA_GET_ASSET');
  assert.equal(review.previewImage.src, 'data:image/png;base64,asset-real');
  assert.equal(review.previewPreviousButton.hidden, true);
  assert.equal(review.previewNextButton.hidden, true);
});

test('Tab 在预览按钮中循环，关闭恢复触发按钮，浏览时不抢焦点', async () => {
  const { review, trigger, close, next } = harness();
  await review.previewDeliveryExample('html', trigger);
  const event = (shiftKey) => ({ key: 'Tab', shiftKey, preventDefault() {}, stopPropagation() {} });
  review.onShadowKeyDown(event(true));
  assert.equal(review.shadow.activeElement, next);
  review.onShadowKeyDown(event(false));
  assert.equal(review.shadow.activeElement, close);
  review.browseMode = true;
  review.closeImagePreview();
  assert.notEqual(review.shadow.activeElement, trigger);
});

test('检查与交付均为独立滚动主体和固定底部，常规按钮统一 28px', () => {
  const { review } = harness();
  const markup = review.createOverlay.toString();
  for (const [view, footer] of [['inspect', 'inspect-footer'], ['deliver', 'delivery-actions']]) {
    const start = markup.indexOf("class='view " + view + "-view'");
    const end = markup.indexOf('"    </section>"', start);
    const section = markup.slice(start, end);
    const scroll = view === 'inspect' ? 'inspect-scroll' : 'delivery-scroll';
    assert.ok(section.includes("<div class='" + scroll + "'>"));
    assert.ok(section.includes("</div><footer class='" + footer + "'>"));
  }
  const css = review.compactSurfaceStyles();
  assert.match(css, /--ud-button-height:28px/);
  assert.match(css, /height:var\(--ud-button-height\)!important/);
  assert.match(css, /\.inspect-scroll,\.delivery-scroll[^}]*flex:1; min-height:0; overflow-y:auto/);
  assert.match(css, /\.inspect-footer,\.deliver-view>\.delivery-actions[^}]*flex:none; position:static/);
  assert.match(css, /\.deliver-view>\.delivery-actions>\.primary-button[^}]*grid-column:auto/);
});

test('插件根和顶层界面有防翻译保护，记录按钮不再附加独立 R 或多余字', async () => {
  const { review } = harness();
  assert.match(source, /host\.setAttribute\("translate", "no"\)/);
  assert.match(source, /host\.classList\.add\("notranslate"\)/);
  assert.match(review.localizeOverlay.toString(), /node\.setAttribute\("translate", "no"\)/);
  const record = source.match(/<div class='inspect-actions'><button[^>]+>(.*?)<\/button>/)?.[1];
  assert.match(record, /^<svg class='record-plus'[^>]*aria-hidden='true'[^>]*><path d='M12 5v14M5 12h14'\/><\/svg><span class='record-label'>记录问题<\/span>$/);
  assert.doesNotMatch(source, /记录测距问题/);
  assert.doesNotMatch(source, /忏悔|法典|职位代理|期排问题表|点开查看/);
  const popup = await readFile(new URL('./popup.html', import.meta.url), 'utf8');
  assert.match(popup, /<html lang="zh-CN" translate="no" class="notranslate">/);
});

test('worker 只加载白名单内置 PNG；三种高清图片存在且编码完整', async () => {
  const functionSource = worker.slice(worker.indexOf('async function getDeliveryPreview('), worker.indexOf('\nfunction resolveTabId('));
  const fetched = [];
  const workerContext = vm.createContext({
    chrome: { runtime: { getURL: (path) => path } },
    fetch: async (path) => {
      fetched.push(path);
      const bytes = await readFile(new URL('./' + path, import.meta.url));
      assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
      assert.ok(bytes.readUInt32BE(16) >= 540);
      assert.ok(bytes.readUInt32BE(20) >= 328);
      return { ok: true, blob: async () => bytes };
    },
    blobToDataUrl: async (bytes) => 'data:image/png;base64,' + bytes.toString('base64')
  });
  vm.runInContext(functionSource, workerContext);
  for (const format of ['html', 'xlsx', 'zip']) {
    const response = await workerContext.getDeliveryPreview(format);
    assert.equal(response.ok, true);
    assert.match(response.dataUrl, /^data:image\/png;base64,iVBOR/);
    assert.equal(fetched.at(-1), 'previews/' + format + '-preview@2x.png');
  }
  assert.equal((await workerContext.getDeliveryPreview('../private')).ok, false);
  assert.equal((await workerContext.getDeliveryPreview('https://example.com')).ok, false);
  assert.equal(fetched.length, 3);
});
