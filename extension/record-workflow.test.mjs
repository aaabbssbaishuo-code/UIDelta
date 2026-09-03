import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("./content.js", import.meta.url), "utf8");
const classStart = source.indexOf("  const ROOT_ATTRIBUTE");
const bootStart = source.indexOf("  const review = new UIDeltaReview();");
assert.ok(classStart >= 0 && bootStart > classStart, "无法提取 UIDeltaReview 类");

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

// Each test gets its own DOM, frame queue and manually completed animations.
// No real timers, extension boot, asset storage or browser session are needed.
function harness({ reducedMotion = false } = {}) {
  const env = { frames: new Map(), nextFrame: 1, animations: [], created: [], requests: [], previews: [] };

  class MockElement {
    constructor(tagName = "div") {
      this.tagName = tagName.toUpperCase();
      this.children = [];
      this.parentNode = null;
      this.dataset = {};
      this.attributes = {};
      this.events = {};
      this.className = "";
      this.isConnected = true;
      this.value = "";
      this.focusCalls = [];
      this.selectionCalls = [];
      this.bounds = { left: 940, top: 120, width: 98, height: 62 };
      this.classList = {
        contains: (name) => this.className.split(/\s+/).includes(name),
        add: (...names) => { this.className = [...new Set([...this.className.split(/\s+/).filter(Boolean), ...names])].join(" "); },
        remove: (...names) => { this.className = this.className.split(/\s+/).filter((name) => !names.includes(name)).join(" "); },
        toggle: (name, force) => {
          const enabled = force ?? !this.classList.contains(name);
          this.classList[enabled ? "add" : "remove"](name);
          return enabled;
        }
      };
      const styles = {};
      this.style = {
        opacity: "", pointerEvents: "",
        setProperty(name, value) { this[name] = String(value); },
        getPropertyValue(name) { return this[name] || ""; },
        removeProperty(name) { this[name] = ""; }
      };
      for (const property of ["visibility", "display"]) {
        Object.defineProperty(this.style, property, {
          get: () => styles[property] || "",
          set: (value) => {
            styles[property] = value;
            if ((value === "hidden" || value === "none") && this.contains(env.shadow?.activeElement)) {
              env.shadow.activeElement = null;
              env.document.activeElement = null;
            }
          }
        });
      }
      env.created.push(this);
    }
    append(...nodes) { nodes.forEach((node) => this.appendChild(node)); }
    appendChild(node) {
      node.remove();
      node.parentNode = this;
      node.isConnected = this.isConnected;
      this.children.push(node);
      return node;
    }
    replaceChildren(...nodes) {
      [...this.children].forEach((node) => node.remove());
      this.append(...nodes);
    }
    remove() {
      if (this.parentNode) this.parentNode.children = this.parentNode.children.filter((node) => node !== this);
      this.parentNode = null;
      this.isConnected = false;
    }
    contains(node) { return this === node || this.children.some((child) => child.contains(node)); }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    getAttribute(name) { return this.attributes[name] ?? null; }
    removeAttribute(name) { delete this.attributes[name]; }
    matches(selector) {
      return selector.split(",").some((part) => {
        const item = part.trim();
        if (item.startsWith(".")) return this.classList.contains(item.slice(1));
        const data = item.match(/^\[data-([a-z-]+)\]$/);
        if (data) return Object.hasOwn(this.dataset, data[1].replace(/-([a-z])/g, (_, letter) => letter.toUpperCase()));
        return this.tagName === item.toUpperCase();
      });
    }
    querySelectorAll(selector) {
      return this.children.flatMap((node) => [node, ...node.descendants()]).filter((node) => node.matches(selector));
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    descendants() { return this.children.flatMap((node) => [node, ...node.descendants()]); }
    addEventListener(name, callback) { this.events[name] = callback; }
    focus(options) {
      this.focusCalls.push(options);
      env.shadow.activeElement = this;
      env.document.activeElement = this;
    }
    setSelectionRange(start, end) {
      this.selectionStart = start;
      this.selectionEnd = end;
      this.selectionCalls.push([start, end]);
    }
    getBoundingClientRect() {
      return { ...this.bounds, right: this.bounds.left + this.bounds.width, bottom: this.bounds.top + this.bounds.height };
    }
    animate(keyframes, options) {
      const completion = deferred();
      const animation = {
        target: this, keyframes, options, finished: completion.promise, cancellations: 0,
        cancel() { this.cancellations += 1; completion.reject(new Error("Animation cancelled")); },
        finish() { completion.resolve(); }
      };
      env.animations.push(animation);
      return animation;
    }
  }

  env.create = (tagName, className = "") => {
    const node = new MockElement(tagName);
    node.className = className;
    return node;
  };
  env.document = { activeElement: null, createElement: (tagName) => env.create(tagName) };
  env.shadow = env.create("shadow-root");
  env.shadow.activeElement = null;
  env.host = env.create("div");
  env.host.append(env.shadow);
  const windowMock = {
    innerWidth: 1200, innerHeight: 800,
    requestAnimationFrame(callback) { const id = env.nextFrame++; env.frames.set(id, callback); return id; },
    cancelAnimationFrame(id) { env.frames.delete(id); },
    matchMedia: () => ({ matches: reducedMotion })
  };
  env.flushFrame = () => {
    const frame = [...env.frames.entries()];
    frame.forEach(([id]) => env.frames.delete(id));
    frame.forEach(([, callback]) => callback(16));
  };
  env.flushFocus = () => { env.flushFrame(); env.flushFrame(); };
  const sandbox = { document: env.document, window: windowMock, Element: MockElement, HTMLElement: MockElement };
  vm.createContext(sandbox);
  vm.runInContext(source.slice(classStart, bootStart) + "\nglobalThis.ReviewClass = UIDeltaReview;", sandbox);
  env.review = (overrides = {}) => Object.assign(Object.create(sandbox.ReviewClass.prototype), overrides);

  const panel = env.create("section", "panel");
  const evidenceStrip = env.create("div", "evidence-strip");
  const referenceList = env.create("div", "reference-list");
  const descriptionInput = env.create("textarea", "description-input");
  descriptionInput.value = "保留原问题描述";
  const composerId = env.create("span", "composer-id");
  const selects = ["type", "priority", "severity"].map((key) => {
    const select = env.create("select");
    select.dataset.composerChoice = key;
    return select;
  });
  panel.append(evidenceStrip, referenceList, descriptionInput, composerId, ...selects);
  const dock = env.create("div", "review-dock");
  const modeToolbar = env.create("div", "mode-toolbar");
  env.shadow.append(panel, dock, modeToolbar);
  env.selects = selects;
  env.editor = env.review({
    host: env.host, shadow: env.shadow, panel, dock, modeToolbar,
    evidenceStrip, referenceList, descriptionInput, composerId,
    currentView: "composer", browseMode: false, recordTransition: null,
    composer: { type: "ui", priority: "queued", severity: "cosmetic", captureStatus: "capturing", issue: { id: "issue-a", sequence: 7, attachments: {}, elementAnchor: { name: "创建项目按钮" } } },
    sendMessage(message) { const result = deferred(); env.requests.push({ message, ...result }); return result.promise; },
    previewAsset(...args) { env.previews.push(args); },
    closeImagePreview() { env.previewClosed = (env.previewClosed || 0) + 1; },
    renderComposer() { assert.fail("字段更新不应重建记录表单"); }
  });
  return env;
}

test("三个紧凑下拉保留类型、优先级和影响程度的数据键", () => {
  const { editor } = harness();
  const markup = editor.composerChoicesMarkup();
  const controls = [...markup.matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/g)];
  assert.equal(controls.length, 3);
  const actual = Object.fromEntries(controls.map(([, attributes, options]) => {
    const key = attributes.match(/data-composer-choice='([^']+)'/)[1];
    assert.match(attributes, /aria-label='[^']+'/);
    return [key, [...options.matchAll(/<option value='([^']+)'/g)].map((match) => match[1])];
  }));
  assert.deepEqual(actual, {
    type: ["ui", "functional", "content"],
    priority: ["immediate", "soon", "queued", "later"],
    severity: ["crash", "blocked", "degraded", "cosmetic"]
  });
  assert.match(editor.reviewWorkflowStyles(), /\.composer-choice select\s*\{[^}]*height:28px/);
});

test("有效下拉更新原控件与问题编号，同时保留焦点和描述草稿", () => {
  const env = harness();
  const { editor, selects } = env;
  selects[1].focus();
  editor.descriptionInput.setSelectionRange(2, 4);
  const created = env.created.length;
  assert.equal(editor.setComposerChoice("type", "functional"), true);
  assert.equal(editor.setComposerChoice("priority", "soon"), true);
  assert.equal(editor.setComposerChoice("severity", "blocked"), true);
  assert.deepEqual(selects.map((node) => node.value), ["functional", "soon", "blocked"]);
  assert.equal(editor.composer.issue.displayId, "FN-007");
  assert.equal(editor.composerId.textContent, "FN-007");
  assert.equal(env.shadow.activeElement, selects[1]);
  assert.equal(env.created.length, created, "更新应复用原字段节点");
  assert.equal(editor.descriptionInput.value, "保留原问题描述");
  assert.deepEqual(editor.descriptionInput.selectionCalls, [[2, 4]]);
});

test("非法下拉键和值不会修改记录，旧严重程度值仍可归一化", () => {
  const { editor } = harness();
  const original = JSON.stringify(editor.composer);
  for (const [key, value] of [["type", "unknown"], ["type", "__proto__"], ["priority", "constructor"], ["severity", "auto"], ["severity", "severe"], ["unknown", "ui"], ["__proto__", "ui"]]) {
    assert.equal(editor.setComposerChoice(key, value), false, `${key}:${value}`);
    assert.equal(JSON.stringify(editor.composer), original);
  }
  assert.equal(editor.setComposerChoice("severity", "major"), true);
  assert.equal(editor.composer.severity, "degraded");
  assert.equal(editor.setComposerChoice("severity", "minor"), true);
  assert.equal(editor.composer.severity, "cosmetic");
  editor.composer = null;
  assert.equal(editor.setComposerChoice("type", "ui"), false);
});

test("初次进入记录表单后聚焦描述末尾且不滚动页面", () => {
  const env = harness();
  const input = env.editor.descriptionInput;
  env.editor.focusComposerDescription();
  assert.equal(input.focusCalls.length, 0);
  env.flushFrame();
  assert.equal(input.focusCalls.length, 0, "应等待记录面板完成布局");
  env.flushFrame();
  assert.equal(env.shadow.activeElement, input);
  assert.equal(input.focusCalls.length, 1);
  assert.equal(input.focusCalls[0].preventScroll, true);
  assert.deepEqual(input.selectionCalls, [[input.value.length, input.value.length]]);
});

test("异步聚焦不会抢走已在使用的描述、下拉或其他输入框", () => {
  for (const kind of ["description", "select", "textarea", "input"]) {
    const env = harness();
    const active = kind === "description" ? env.editor.descriptionInput : kind === "select" ? env.selects[0] : env.create(kind);
    env.editor.panel.append(active);
    env.editor.focusComposerDescription();
    env.flushFrame();
    active.focus();
    active.setSelectionRange(1, 3);
    env.flushFrame();
    assert.equal(env.shadow.activeElement, active, kind);
    assert.deepEqual(active.selectionCalls, [[1, 3]], kind);
    assert.equal(env.editor.descriptionInput.focusCalls.length, kind === "description" ? 1 : 0, kind);
  }
});

test("进入浏览模式、退出表单或替换问题会阻止待执行的描述聚焦", () => {
  for (const change of [
    (editor) => { editor.browseMode = true; },
    (editor) => { editor.currentView = "inbox"; },
    (editor) => { editor.composer = { ...editor.composer, issue: { id: "issue-b" } }; },
    (editor) => { editor.composer = null; }
  ]) {
    const env = harness();
    env.editor.focusComposerDescription();
    env.flushFrame();
    change(env.editor);
    env.flushFrame();
    assert.equal(env.editor.descriptionInput.focusCalls.length, 0);
  }
});

const origin = { left: 100, top: 200, width: 240, height: 60 };

function startTransition(env) {
  env.editor.renderComposerEvidence();
  env.editor.animateRecordTransition(origin);
  env.flushFrame();
  return env.editor.recordTransition;
}

test("记录飞入动画使用 280ms 并落向已存在的证据槽，不改变字段焦点", () => {
  const env = harness();
  env.selects[1].focus();
  const transition = startTransition(env);
  assert.equal(env.animations.length, 3);
  const flight = env.animations.find((animation) => animation.target.classList.contains("record-flight"));
  assert.ok(flight);
  assert.equal(flight.options.duration, 280);
  assert.equal(flight.target.style.left, "100px");
  assert.equal(flight.target.style.top, "200px");
  assert.equal(flight.keyframes.at(-1).opacity, 0);
  assert.equal(flight.target.getAttribute("aria-hidden"), "true");
  assert.equal(transition.ghost, flight.target);
  assert.equal(env.shadow.activeElement, env.selects[1]);
});

test("飞入动画开始前取消会撤掉 RAF，不创建浮层或动画", () => {
  const env = harness();
  env.editor.renderComposerEvidence();
  env.editor.animateRecordTransition(origin);
  assert.equal(env.frames.size, 1);
  env.editor.cancelRecordTransition();
  assert.equal(env.frames.size, 0);
  env.flushFrame();
  assert.equal(env.animations.length, 0);
  assert.equal(env.editor.recordTransition, null);
  assert.equal(env.shadow.querySelector(".record-flight"), null);
});

test("运行中的飞入可以取消，旧动画结束不会清理后来启动的动画", async () => {
  const env = harness();
  const first = startTransition(env);
  env.editor.animateRecordTransition(origin);
  const second = env.editor.recordTransition;
  assert.notEqual(first, second);
  assert.ok(first.animations.every((animation) => animation.cancellations === 1));
  assert.equal(first.ghost.parentNode, null);
  await settle();
  assert.equal(env.editor.recordTransition, second, "取消动画的 finished 回调不得清理新状态");
  env.flushFrame();
  second.animations.forEach((animation) => animation.finish());
  await settle();
  assert.equal(env.editor.recordTransition, null);
  assert.equal(second.ghost.parentNode, null);
  env.editor.cancelRecordTransition();
});

test("降低动态效果时保留轻反馈，但不创建飞入浮层", () => {
  const env = harness({ reducedMotion: true });
  const transition = startTransition(env);
  assert.equal(transition.ghost, null);
  assert.equal(env.shadow.querySelector(".record-flight"), null);
  assert.equal(env.animations.length, 2);
  assert.ok(env.animations.every((animation) => animation.options.duration <= 120));
  assert.ok(env.animations.every((animation) => !animation.options.delay));
  assert.ok(env.animations.every((animation) => animation.keyframes.every((frame) => !frame.transform)));
});

test("过期表单和浏览模式不会在下一帧启动飞入", () => {
  for (const change of [
    (editor) => { editor.composer = { ...editor.composer, issue: { id: "issue-b" } }; },
    (editor) => { editor.currentView = "inspect"; },
    (editor) => { editor.browseMode = true; }
  ]) {
    const env = harness();
    env.editor.renderComposerEvidence();
    env.editor.animateRecordTransition(origin);
    change(env.editor);
    env.flushFrame();
    assert.equal(env.animations.length, 0);
    assert.equal(env.shadow.querySelector(".record-flight"), null);
    assert.equal(env.editor.recordTransition, null, "过期表单应同时释放动画状态");
  }
});

test("无目标尺寸、无表单或浏览中不安排飞入动画", () => {
  for (const setup of [
    (editor) => [editor, null],
    (editor) => [editor, { ...origin, width: 0 }],
    (editor) => [editor, { ...origin, height: -1 }],
    (editor) => [Object.assign(editor, { composer: null }), origin],
    (editor) => [Object.assign(editor, { browseMode: true }), origin]
  ]) {
    const env = harness();
    const [editor, rect] = setup(env.editor);
    editor.animateRecordTransition(rect);
    assert.equal(env.frames.size, 0);
    assert.equal(editor.recordTransition, null);
  }
});

test("截图尚未生成时立即保留全景与细节两槽", () => {
  const env = harness();
  env.editor.renderComposerEvidence();
  const slots = env.editor.evidenceStrip.children;
  assert.equal(slots.length, 2);
  assert.deepEqual(slots.map((slot) => slot.children[0].textContent), ["全景", "细节"]);
  assert.ok(slots.every((slot) => slot.classList.contains("evidence-placeholder") && slot.disabled));
  assert.ok(slots.every((slot) => slot.getAttribute("aria-label").includes("等待取证")));
  assert.equal(env.editor.evidenceStrip.getAttribute("aria-busy"), "true");
  assert.equal(env.requests.length, 0);
});

test("异步截图按各自槽位更新，逆序返回也不移动表单或抢焦点", async () => {
  const env = harness();
  env.editor.composer.issue.attachments = { context: "context-a", detail: "detail-a" };
  env.editor.renderComposerEvidence();
  const slots = [...env.editor.evidenceStrip.children];
  assert.equal(slots.length, 2, "请求发出时就应预留两个槽位");
  assert.equal(env.requests.length, 2);
  assert.ok(env.requests.every(({ message }) => message.type === "UIDELTA_GET_ASSET" && message.thumbnail === true));
  env.selects[2].focus();
  env.requests[1].resolve({ ok: true, dataUrl: "data:image/png;base64,detail" });
  await settle();
  assert.equal(slots[0].disabled, true);
  assert.equal(slots[1].disabled, false);
  assert.equal(slots[1].querySelector("img").src, "data:image/png;base64,detail");
  env.requests[0].resolve({ ok: true, dataUrl: "data:image/png;base64,context" });
  await settle();
  assert.deepEqual(env.editor.evidenceStrip.children, slots);
  assert.equal(slots[0].querySelector("img").src, "data:image/png;base64,context");
  assert.ok(slots.every((slot) => !slot.disabled && !slot.classList.contains("evidence-placeholder")));
  assert.equal(env.shadow.activeElement, env.selects[2]);
  slots[1].events.click();
  assert.deepEqual(env.previews[0], ["detail-a", "细节截图"]);
});

test("切换问题后旧截图结果不会写入原槽", async () => {
  const env = harness();
  const loading = env.editor.renderComposerAsset(env.editor.evidenceStrip, "old-asset", "全景", false);
  const slot = env.editor.evidenceStrip.children[0];
  env.editor.composer = { ...env.editor.composer, issue: { id: "issue-b", attachments: {} } };
  env.requests[0].resolve({ ok: true, dataUrl: "data:image/png;base64,old" });
  await loading;
  assert.equal(slot.querySelector("img"), null);
  assert.equal(slot.disabled, true);
  assert.equal(slot.events.click, undefined);
});

test("容器已拆除或槽位已替换时丢弃旧截图结果", async () => {
  for (const detach of [
    (container) => container.remove(),
    (container) => container.replaceChildren()
  ]) {
    const env = harness();
    const loading = env.editor.renderComposerAsset(env.editor.evidenceStrip, "old-asset", "全景", false);
    const slot = env.editor.evidenceStrip.children[0];
    detach(env.editor.evidenceStrip);
    env.requests[0].resolve({ ok: true, dataUrl: "data:image/png;base64,old" });
    await loading;
    assert.equal(slot.querySelector("img"), null);
    assert.equal(slot.disabled, true);
  }
});

test("截图加载失败保留可理解的占位，不启用无效放大操作", async () => {
  const env = harness();
  const loading = env.editor.renderComposerAsset(env.editor.evidenceStrip, "missing", "细节", false);
  env.requests[0].resolve({ ok: false });
  await loading;
  const slot = env.editor.evidenceStrip.children[0];
  assert.equal(slot.disabled, true);
  assert.equal(slot.querySelector("img"), null);
  assert.match(slot.getAttribute("aria-label"), /加载失败/);
  assert.equal(slot.events.click, undefined);
});

test("参考图片仍保留独立预览与删除数据契约", async () => {
  const env = harness();
  const loading = env.editor.renderComposerAsset(env.editor.referenceList, "reference-a", "参考", true);
  env.requests[0].resolve({ ok: true, dataUrl: "data:image/png;base64,reference" });
  await loading;
  const chip = env.editor.referenceList.children[0];
  const remove = chip.querySelector("button");
  assert.equal(remove.dataset.action, "remove-reference");
  assert.equal(remove.dataset.assetId, "reference-a");
  assert.equal(remove.getAttribute("aria-label"), "移除参考图片");
  chip.querySelector("img").events.click();
  assert.deepEqual(env.previews[0], ["reference-a", "参考图片"]);
});

test("截图临时隐藏使用透明度，保留描述焦点、选区和原内联样式", () => {
  const env = harness();
  const { editor } = env;
  editor.descriptionInput.focus();
  editor.descriptionInput.value = "尚未保存的 0.01 草稿";
  editor.descriptionInput.setSelectionRange(6, 10);
  env.host.style.opacity = ".85";
  env.host.style.pointerEvents = "auto";
  editor.animateRecordTransition(origin);
  editor.setCaptureOverlayVisible(false);
  assert.equal(env.host.style.opacity, "0");
  assert.equal(env.host.style.pointerEvents, "none");
  assert.equal(env.host.style.visibility, "");
  assert.equal(env.host.style.display, "");
  assert.equal(env.frames.size, 0, "取证前应撤掉待执行飞入");
  assert.equal(editor.recordTransition, null);
  assert.equal(env.shadow.activeElement, editor.descriptionInput);
  assert.equal(editor.descriptionInput.value, "尚未保存的 0.01 草稿");
  assert.deepEqual(editor.descriptionInput.selectionCalls, [[6, 10]]);
  editor.setCaptureOverlayVisible(true);
  assert.equal(env.host.style.opacity, ".85");
  assert.equal(env.host.style.pointerEvents, "auto");
  assert.equal(editor.captureOverlayStyles, null);
  assert.equal(env.shadow.activeElement, editor.descriptionInput);
  assert.equal(editor.descriptionInput.focusCalls.length, 1, "恢复可见性不需要重新聚焦");
});

test("保留测距的截图只隐藏操作界面，不隐藏测距层或打断下拉焦点", () => {
  const env = harness();
  const { editor } = env;
  for (const name of ["uiEditor", "recordPrompt", "tooltip", "toast", "captureFeedback"]) {
    editor[name] = env.create("div");
    env.shadow.append(editor[name]);
  }
  const measurement = env.create("div", "measurement-layer");
  measurement.style.opacity = ".75";
  env.shadow.append(measurement);
  const controls = [editor.panel, editor.dock, editor.uiEditor, editor.modeToolbar, editor.recordPrompt, editor.tooltip, editor.toast, editor.captureFeedback];
  controls.forEach((node) => { node.style.opacity = ".9"; node.style.pointerEvents = "auto"; });
  env.selects[0].focus();
  editor.setCaptureOverlayVisible(false, true);
  assert.ok(controls.every((node) => node.style.opacity === "0" && node.style.pointerEvents === "none"));
  assert.equal(env.host.style.opacity, "");
  assert.equal(measurement.style.opacity, ".75");
  assert.equal(env.shadow.activeElement, env.selects[0]);
  editor.setCaptureOverlayVisible(true);
  assert.ok(controls.every((node) => node.style.opacity === ".9" && node.style.pointerEvents === "auto"));
  assert.equal(env.shadow.activeElement, env.selects[0]);
});

test("连续切换截图隐藏方式仍能还原各层最初样式", () => {
  const env = harness();
  env.host.style.opacity = ".7";
  env.editor.panel.style.opacity = ".8";
  env.editor.setCaptureOverlayVisible(false);
  assert.equal(env.host.style.opacity, "0");
  env.editor.setCaptureOverlayVisible(false, true);
  assert.equal(env.host.style.opacity, ".7", "切换到保留测距时先恢复宿主");
  assert.equal(env.editor.panel.style.opacity, "0");
  env.editor.setCaptureOverlayVisible(true);
  assert.equal(env.host.style.opacity, ".7");
  assert.equal(env.editor.panel.style.opacity, ".8");
});

test("记录模板保持原有 250×560 面板约束和固定操作区", () => {
  const { editor } = harness();
  assert.ok(source.includes("width:min(250px,calc(100vw - 24px))"));
  assert.ok(source.includes("height:min(560px,calc(100vh - 24px))"));
  assert.ok(source.includes("this.composerChoicesMarkup()"));
  const styles = editor.reviewWorkflowStyles();
  assert.match(styles, /\.composer-scroll\s*\{[^}]*overflow-y:auto/);
  assert.match(styles, /\.composer-view>\.composer-actions\s*\{[^}]*position:static;[^}]*flex:none/);
  assert.doesNotMatch(styles, /(?:^|\})\s*\.panel\s*\{[^}]*(?:width|height):/);
});
