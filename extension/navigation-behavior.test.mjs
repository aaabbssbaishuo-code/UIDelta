import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";

class Surface {
  constructor() {
    this.style = {};
    this.dataset = {};
    this.attributes = {};
    this.classes = new Set();
    this.classList = {
      add: (name) => this.classes.add(name),
      remove: (name) => this.classes.delete(name),
      contains: (name) => this.classes.has(name),
      toggle: (name, value) => value ? this.classes.add(name) : this.classes.delete(name)
    };
  }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  replaceChildren() { this.cleared = true; }
  querySelector() { return null; }
}

const origin = "https://review.example";
const content = await readFile(new URL("./content.js", import.meta.url), "utf8");
const contentSandbox = {
  structuredClone, URL,
  location: { origin, pathname: "/one", search: "", hash: "" },
  window: { requestAnimationFrame: (callback) => callback(), setTimeout: (callback) => callback() },
  HTMLElement: Surface, HTMLInputElement: Surface, HTMLTextAreaElement: Surface, HTMLSelectElement: Surface
};
vm.createContext(contentSandbox);
vm.runInContext(content.slice(content.indexOf("  const ROOT_ATTRIBUTE"), content.indexOf("  const review = new UIDeltaReview();")) + "\nglobalThis.Review = UIDeltaReview;", contentSandbox);

function review(overrides = {}) {
  const events = [];
  const browseButton = new Surface();
  const instance = Object.assign(Object.create(contentSandbox.Review.prototype), {
    enabled: true, tabConfigured: true, browseMode: false, currentView: "inspect", inspectMode: "ui",
    session: { id: "session-1", status: "active" },
    host: new Surface(), panel: new Surface(), uiEditor: new Surface(), dock: new Surface(), pinsLayer: new Surface(), browseState: new Surface(),
    modeToolbar: Object.assign(new Surface(), { querySelector: () => browseButton }),
    shadow: { activeElement: { blur: () => events.push("blur") } },
    descriptionInput: { value: "尚未保存的输入" },
    syncCursorState: () => events.push("cursor"),
    updateModeControls: () => {},
    clearVisuals: () => events.push("clear"),
    closeImagePreview: () => {},
    cancelRecordTransition: () => events.push("cancel-transition"),
    clampPanelToViewport: () => {},
    sendMessage: async (message) => { events.push(message); return { ok: true }; },
    ...overrides
  });
  return { instance, events, browseButton };
}

function draft(reviewStatus = "accepted") {
  return {
    mode: "edit", returnView: "inspect", type: "ui", severity: "cosmetic", priority: "queued",
    formReady: true,
    captureStatus: "ready", capturePromise: Promise.resolve(null),
    issue: {
      id: "issue-1", sessionId: "session-1", reviewStatus, description: "原描述",
      pageSnapshot: { url: origin + "/one" }, elementAnchor: { preferredSelector: "#target" },
      attachments: { context: "asset-1", detail: "asset-2" }
    }
  };
}

const storage = {};
const workerEvents = {};
const sent = [];
const injections = [];
const chromeMock = {
  storage: { session: {
    get: async (key) => ({ [key]: structuredClone(storage[key]) }),
    set: async (values) => Object.assign(storage, structuredClone(values))
  } },
  runtime: { onInstalled: { addListener() {} }, onMessage: { addListener() {} } },
  commands: { onCommand: { addListener() {} } },
  action: { onClicked: { addListener() {} } },
  tabs: {
    onRemoved: { addListener: (callback) => { workerEvents.removed = callback; } },
    onUpdated: { addListener: (callback) => { workerEvents.updated = callback; } },
    sendMessage: async (tabId, message) => { sent.push({ tabId, message }); return { ok: true }; }
  },
  scripting: { executeScript: async (options) => injections.push(options) }
};
const workerSource = await readFile(new URL("./service-worker.js", import.meta.url), "utf8");
const workerSandbox = { chrome: chromeMock, URL, structuredClone, console };
vm.createContext(workerSandbox);
vm.runInContext(workerSource.replace(/^import .*\n/, "") + "\nglobalThis.workerApi = { getTabState, writeTabState, handleMessage };", workerSandbox);
const worker = workerSandbox.workerApi;
const settle = () => new Promise((resolve) => setImmediate(resolve));

const cases = [
  ["关闭扩展后不以旧上下文覆盖刚同步的草稿", async () => {
    await worker.writeTabState(24, true, origin, { composerDraft: { issue: { description: "旧文本" } } });
    chromeMock.tabs.get = async () => ({ id: 24, url: origin + "/one" });
    const originalSend = chromeMock.tabs.sendMessage;
    chromeMock.tabs.sendMessage = async () => {
      await worker.writeTabState(24, false, origin, { composerDraft: { issue: { description: "刚刚输入的新文本" } } });
      return { ok: true };
    };
    try {
      const response = await worker.handleMessage({ type: "SET_TAB_INSPECTOR", tabId: 24, enabled: false }, {});
      assert.equal(response.ok, true);
      const latest = await worker.getTabState(24);
      assert.equal(latest.enabled, false);
      assert.equal(latest.composerDraft.issue.description, "刚刚输入的新文本");
    } finally { chromeMock.tabs.sendMessage = originalSend; }
  }],
  ["收起隐藏走查层但保留工具栏及未保存草稿", async () => {
    const composer = draft();
    const { instance, events, browseButton } = review({ composer, currentView: "composer" });
    instance.minimizePanel();
    assert.equal(instance.enabled, true);
    assert.equal(instance.browseMode, true);
    assert.equal(instance.isSessionActive(), true, "浏览态不应暂停或终止取证会话");
    assert.equal(instance.panel.style.display, "none");
    assert.equal(instance.uiEditor.classList.contains("visible"), false);
    assert.equal(instance.pinsLayer.style.display, "none");
    assert.equal(instance.modeToolbar.style.display, "flex");
    assert.equal(instance.browseState.hidden, false);
    assert.equal(browseButton.attributes["aria-pressed"], "true");
    assert.equal(instance.composer, composer);
    assert.equal(instance.currentView, "composer");
    const persisted = events.find((event) => event?.type === "SYNC_TAB_STATE");
    assert.equal(persisted.enabled, true);
    assert.equal(persisted.browseMode, true);
    assert.equal(persisted.composerDraft.issue.description, "尚未保存的输入");
    assert.equal(persisted.composerDraft.issue.reviewStatus, "accepted", "编辑已收录问题不可改成草稿状态");
    assert.equal("capturePromise" in persisted.composerDraft, false);
    assert.equal("targetElement" in persisted.composerDraft, false);
  }],
  ["浏览态不拦截页面点击或键盘", async () => {
    const { instance } = review({ browseMode: true });
    const event = {
      button: 0, key: "Escape", code: "Space",
      preventDefault() { assert.fail("浏览态不应阻止页面默认行为"); },
      stopImmediatePropagation() { assert.fail("浏览态不应截获页面事件"); }
    };
    for (const method of ["onPointerMove", "onDocumentPointerDown", "onDocumentPointerUp", "onDocumentClick", "onKeyDown", "onKeyUp"]) instance[method](event);
    assert.equal(instance.isCanvasInteractionView(), false);
  }],
  ["模式按钮恢复原草稿而不丢输入", async () => {
    const { instance } = review({ composer: draft(), currentView: "composer" });
    instance.minimizePanel();
    let rendered = "";
    instance.renderComposer = () => { rendered = instance.composer.issue.description; };
    instance.setInspectMode = (mode) => { instance.inspectMode = mode; };
    instance.showView = (view) => { instance.currentView = view; };
    instance.resumeReview("annotation");
    assert.equal(instance.browseMode, false);
    assert.equal(instance.inspectMode, "annotation");
    assert.equal(instance.currentView, "composer");
    assert.equal(rendered, "尚未保存的输入");
    assert.equal(instance.browseState.hidden, true);
  }],
  ["初始脚本加载不覆盖已有标签页状态", async () => {
    const { instance, events } = review({ enabled: false, tabConfigured: false });
    await instance.persistTabContext();
    assert.equal(events.length, 0);
  }],
  ["异步新建时收起不复制上个问题的描述", async () => {
    const composer = draft();
    composer.formReady = false;
    composer.mode = "create";
    composer.issue.description = "";
    const { instance, events } = review({ composer, currentView: "inspect", descriptionInput: { value: "上个问题的残留描述" } });
    instance.minimizePanel();
    const persisted = events.find((event) => event?.type === "SYNC_TAB_STATE");
    assert.equal(persisted.composerDraft.issue.description, "");
    assert.equal(instance.composer.issue.description, "");
  }],
  ["同源新页面可恢复未保存编辑且跨源草稿被拒绝", async () => {
    const saved = draft();
    delete saved.capturePromise;
    const { instance } = review({ renderComposer() {}, resolveAnchor: () => ({ isConnected: true }) });
    saved.issue.pageSnapshot.url = origin + "/previous";
    instance.restoreTabComposer(saved);
    assert.equal(instance.composer.issue.description, "原描述");
    assert.equal(instance.composer.targetElement, null, "其他路由不能绑定当前页面的同名元素");
    assert.equal(instance.composer.captureStatus, "ready");
    instance.composer = null;
    saved.issue.pageSnapshot.url = "https://other.example/one";
    instance.restoreTabComposer(saved);
    assert.equal(instance.composer, null);
  }],
  ["标签页草稿仅暂存，不写正式问题数据库", async () => {
    const composerDraft = { ...draft(), capturePromise: undefined };
    await worker.handleMessage({ type: "SYNC_TAB_STATE", enabled: true, browseMode: true, inspectMode: "ui", view: "composer", composerDraft }, { tab: { id: 11, url: origin + "/one" }, url: origin + "/one" });
    const stored = await worker.getTabState(11);
    assert.equal(stored.enabled, true);
    assert.equal(stored.browseMode, true);
    assert.equal(stored.composerDraft.issue.reviewStatus, "accepted");
    assert.equal((await worker.getTabState(12)).composerDraft, null, "草稿不能串到其他标签页");
  }],
  ["同源导航恢复浏览态和模式", async () => {
    sent.length = 0;
    await worker.writeTabState(21, true, origin, { browseMode: true, inspectMode: "ui", composerDraft: null });
    workerEvents.updated(21, { status: "complete" }, { url: origin + "/two" });
    await settle();
    assert.equal(sent.length, 1);
    assert.equal(sent[0].message.type, "UI_LENS_SET_ENABLED");
    assert.equal(sent[0].message.enabled, true);
    assert.equal(sent[0].message.context.browseMode, true);
    assert.equal(sent[0].message.context.inspectMode, "ui");
    assert.equal(injections.length, 0, "已有content script可配置时不应额外注入");
  }],
  ["跨站导航不自动注入并清除旧tab启用状态", async () => {
    sent.length = 0;
    await worker.writeTabState(22, true, origin, { browseMode: true, composerDraft: null });
    workerEvents.updated(22, { status: "complete" }, { url: "https://other.example/" });
    await settle();
    assert.equal(sent.length, 0);
    assert.equal(injections.length, 0);
    assert.equal((await worker.getTabState(22)).enabled, false);
  }],
  ["关闭标签页删除其临时状态", async () => {
    await worker.writeTabState(23, true, origin, { browseMode: true, composerDraft: { issue: { id: "temporary" } } });
    workerEvents.removed(23);
    await settle();
    const state = await worker.getTabState(23);
    assert.equal(state.enabled, false);
    assert.equal(state.composerDraft, null);
  }]
];

for (const [name, run] of cases) test(name, run);
