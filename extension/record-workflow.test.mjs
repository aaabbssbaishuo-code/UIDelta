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
  const env = { frames: new Map(), timers: new Map(), nextTimer: 1, nextFrame: 1, animations: [], created: [], requests: [], previews: [] };

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
      this.readOnly = false;
      this.disabled = false;
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
    get parentElement() { return this.parentNode; }
    closest(selector) { return this.matches(selector) ? this : this.parentNode?.closest(selector) || null; }
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
    setTimeout(callback, delay) { const id = env.nextTimer++; env.timers.set(id, { callback, delay }); return id; },
    clearTimeout(id) { env.timers.delete(id); },
    requestAnimationFrame(callback) { const id = env.nextFrame++; env.frames.set(id, callback); return id; },
    cancelAnimationFrame(id) { env.frames.delete(id); },
    matchMedia: () => ({ matches: reducedMotion })
  };
  env.window = windowMock;
  env.flushFrame = () => {
    const frame = [...env.frames.entries()];
    frame.forEach(([id]) => env.frames.delete(id));
    frame.forEach(([, callback]) => callback(16));
  };
  env.flushFocus = () => { env.flushFrame(); env.flushFrame(); };
  const sandbox = { document: env.document, window: windowMock, Element: MockElement, HTMLElement: MockElement, structuredClone };
  vm.createContext(sandbox);
  vm.runInContext(source.slice(classStart, bootStart) + "\nglobalThis.ReviewClass = UIDeltaReview;", sandbox);
  env.review = (overrides = {}) => Object.assign(Object.create(sandbox.ReviewClass.prototype), overrides);

  const panel = env.create("section", "panel");
  const evidenceStrip = env.create("div", "evidence-strip");
  const referenceList = env.create("div", "reference-list");
  const descriptionInput = env.create("textarea", "description-input");
  descriptionInput.value = "保留原问题描述";
  const composerId = env.create("span", "composer-id");
  const options = {};
  const markup = env.review().composerChoicesMarkup();
  const groups = [...markup.matchAll(/data-segments='([^']+)'[^>]*>([\s\S]*?)<\/div>/g)].map(([, key, buttons]) => {
    const group = env.create("div", "segments");
    options[key] = [...buttons.matchAll(/<button[^>]*data-\w+='([^']+)'[^>]*>([^<]+)<\/button>/g)].map(([, value, text]) => {
      const button = env.create("button", "segment");
      button.dataset[key] = value;
      button.textContent = text;
      group.append(button);
      return button;
    });
    return group;
  });
  panel.append(evidenceStrip, referenceList, descriptionInput, composerId, ...groups);
  const dock = env.create("div", "review-dock");
  const modeToolbar = env.create("div", "mode-toolbar");
  env.shadow.append(panel, dock, modeToolbar);
  env.options = options;
  env.choices = Object.values(options).flat();
  env.editor = env.review({
    host: env.host, shadow: env.shadow, panel, dock, modeToolbar,
    evidenceStrip, referenceList, descriptionInput, composerId,
    currentView: "composer", browseMode: false, recordTransition: null,
    composer: { type: "ui", priority: "queued", severity: "cosmetic", captureStatus: "capturing", issue: { id: "issue-a", sequence: 7, attachments: {}, elementAnchor: { name: "创建项目按钮" } } },
    sendMessage(message) { const result = deferred(); env.requests.push({ message, ...result }); return result.promise; },
    previewAsset(...args) { env.previews.push(args); },
    closeImagePreview() { env.previewClosed = (env.previewClosed || 0) + 1; },
    persistTabContext() { env.persisted = (env.persisted || 0) + 1; },
    renderComposer() { assert.fail("字段更新不应重建记录表单"); }
  });
  return env;
}

function savingHarness({ capturing = true } = {}) {
  const env = harness();
  const { editor } = env;
  env.capture = deferred();
  Object.assign(editor, {
    saveButton: env.create("button"), cancelComposerButton: env.create("button"),
    composerError: env.create("p"), referenceInput: env.create("input"),
    issues: [], session: { id: "session-a", status: "active" }, captureEpoch: 1,
    getPreviewProposal: () => null,
    updateCounts() { env.countUpdates = (env.countUpdates || 0) + 1; },
    persistTabContext() { env.contextPersists = (env.contextPersists || 0) + 1; return Promise.resolve({ ok: true }); },
    renderPins() { env.pinRenders = (env.pinRenders || 0) + 1; },
    showView(view) { this.currentView = view; env.returnedView = view; },
    showToast(message) { env.toastMessage = message; },
    renderCaptureState() { env.captureStateRenders = (env.captureStateRenders || 0) + 1; }
  });
  Object.assign(editor.composer, {
    mode: "create", returnView: "inspect", saving: false,
    captureStatus: capturing ? "capturing" : "ready",
    capturePromise: capturing ? env.capture.promise : Promise.resolve()
  });
  Object.assign(editor.composer.issue, {
    sessionId: "session-a", reviewStatus: "draft", displayId: "UI-007",
    captureMetrics: { composerOpenedAt: new Date().toISOString() },
    attachments: capturing ? {} : { context: "context-a", detail: "detail-a" }
  });
  env.finishCapture = () => {
    editor.composer.captureStatus = "ready";
    editor.composer.issue.attachments = { context: "context-a", detail: "detail-a" };
    env.capture.resolve();
  };
  return env;
}

test("三组属性纵向展开为可见单选按钮，保留数据键且没有下拉", () => {
  const { editor } = harness();
  const markup = editor.composerChoicesMarkup();
  assert.doesNotMatch(markup, /<select|<option|<details/);
  const controls = [...markup.matchAll(/<div class='segments'([^>]*)>([\s\S]*?)<\/div>/g)];
  assert.equal(controls.length, 3);
  const actual = Object.fromEntries(controls.map(([, attributes, options]) => {
    const key = attributes.match(/data-segments='([^']+)'/)[1];
    assert.match(attributes, /role='radiogroup'/);
    assert.ok(attributes.includes(`aria-labelledby='composer-${key}-label'`));
    assert.ok(markup.includes(`id='composer-${key}-label'`));
    const buttons = [...options.matchAll(/<button\b([^>]*)>/g)];
    for (const [, attrs] of buttons) assert.match(attrs, /type='button'.*role='radio'.*aria-checked='false'/);
    return [key, buttons.map(([, attrs]) => attrs.match(new RegExp(`data-${key}='([^']+)'`))[1])];
  }));
  assert.deepEqual(actual, {
    type: ["ui", "functional", "content"],
    priority: ["immediate", "soon", "queued", "later"],
    severity: ["crash", "blocked", "degraded", "cosmetic"]
  });
  assert.match(editor.reviewWorkflowStyles(), /\.composer-choices\s*\{[^}]*grid-template-columns:minmax\(0,1fr\)/);
  assert.match(editor.reviewWorkflowStyles(), /\.composer-choice \.segment\s*\{[^}]*min-height:28px/);
  assert.match(editor.reviewWorkflowStyles(), /\.composer-choice \.segment:focus-visible/);
});

test("选项更新原按钮与问题编号，同时保留焦点和描述草稿", () => {
  const env = harness();
  const { editor, options } = env;
  options.priority[1].focus();
  editor.descriptionInput.setSelectionRange(2, 4);
  const created = env.created.length;
  assert.equal(editor.setComposerChoice("type", "functional"), true);
  assert.equal(editor.setComposerChoice("priority", "soon"), true);
  assert.equal(editor.setComposerChoice("severity", "blocked"), true);
  for (const [key, selected] of Object.entries({ type: "functional", priority: "soon", severity: "blocked" })) {
    for (const button of options[key]) {
      const active = button.dataset[key] === selected;
      assert.equal(button.getAttribute("aria-checked"), String(active));
      assert.equal(button.classList.contains("active"), active);
      assert.equal(button.tabIndex, active ? 0 : -1);
    }
  }
  assert.equal(editor.composer.issue.displayId, "FN-007");
  assert.equal(editor.composerId.textContent, "FN-007");
  assert.equal(env.shadow.activeElement, options.priority[1]);
  assert.equal(env.persisted, 3, "按钮选择应写入恢复草稿");
  assert.equal(env.created.length, created, "更新应复用原字段节点");
  assert.equal(editor.descriptionInput.value, "保留原问题描述");
  assert.deepEqual(editor.descriptionInput.selectionCalls, [[2, 4]]);
});

test("非法选项键和值不会修改记录，旧严重程度值仍可归一化", () => {
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
  editor.composer.controlsLocked = true;
  assert.equal(editor.setComposerChoice("type", "functional"), false);
  assert.equal(editor.composer.type, "ui");
  editor.composer = null;
  assert.equal(editor.setComposerChoice("type", "ui"), false);
});

test("点击可见选项可切换三个属性，重复选择保持节点和草稿", () => {
  const env = harness();
  const { editor, options } = env;
  const created = env.created.length;
  for (const key of ["type", "priority", "severity"]) {
    for (const button of [...options[key], options[key][0]]) {
      button.focus();
      editor.onUiClick({ target: button, preventDefault() {}, stopPropagation() {} });
      assert.equal(editor.composer[key], button.dataset[key]);
      assert.equal(button.getAttribute("aria-checked"), "true");
      assert.equal(env.shadow.activeElement, button);
    }
  }
  assert.equal(env.created.length, created);
  assert.equal(editor.descriptionInput.value, "保留原问题描述");
});

test("方向键、Home、End 选择并移动焦点，Tab 保持原生分组跳转", () => {
  const env = harness();
  const { editor, options } = env;
  editor.updateComposerControls();
  for (const [group, buttons] of Object.entries(options)) {
    buttons[0].focus();
    for (const [key, index] of [["ArrowDown", 1], ["End", buttons.length - 1], ["ArrowRight", 0], ["ArrowUp", buttons.length - 1], ["Home", 0]]) {
      let prevented = false;
      editor.onShadowKeyDown({ target: env.shadow.activeElement, key, preventDefault() { prevented = true; }, stopPropagation() {} });
      assert.equal(prevented, true);
      assert.equal(editor.composer[group], buttons[index].dataset[group]);
      assert.equal(env.shadow.activeElement, buttons[index]);
      assert.equal(buttons.filter((button) => button.tabIndex === 0).length, 1);
    }
    for (const shiftKey of [false, true]) {
      editor.onShadowKeyDown({ target: env.shadow.activeElement, key: "Tab", shiftKey, preventDefault() { assert.fail("不能拦截 Tab / Shift+Tab"); }, stopPropagation() {} });
    }
  }
});

test("保存期间禁用选项，失败恢复后可以继续修改", () => {
  const env = harness();
  const { editor } = env;
  editor.composer.controlsLocked = true;
  editor.updateComposerControls();
  assert.ok(env.choices.every((button) => button.disabled));
  assert.equal(editor.setComposerChoice("type", "functional"), false);
  editor.composer.controlsLocked = false;
  editor.updateComposerControls();
  assert.ok(env.choices.every((button) => !button.disabled));
  assert.equal(editor.setComposerChoice("type", "functional"), true);
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

test("异步聚焦不会抢走已在使用的描述、选项按钮或其他输入框", () => {
  for (const kind of ["description", "button", "select", "textarea", "input"]) {
    const env = harness();
    const active = kind === "description" ? env.editor.descriptionInput : kind === "button" ? env.choices[0] : env.create(kind);
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

test("记录飞入 400ms 沿连续弧线等比收拢到细节槽，不改变字段焦点", () => {
  const env = harness();
  env.choices[1].focus();
  const transition = startTransition(env);
  assert.equal(env.animations.length, 3);
  const flight = env.animations.find((animation) => animation.target.classList.contains("record-flight"));
  assert.ok(flight);
  assert.equal(flight.options.duration, 400);
  assert.equal(flight.options.easing, "cubic-bezier(0.22, 0.61, 0.36, 1)");
  assert.equal(flight.target.style.left, "100px");
  assert.equal(flight.target.style.top, "200px");
  assert.equal(flight.keyframes.at(-1).opacity, 0);
  assert.equal(flight.target.getAttribute("aria-hidden"), "true");
  assert.equal(flight.keyframes.length, 25);
  for (const frame of flight.keyframes) assert.match(frame.transform, /scale\([\d.]+\)$/, "不能非等比拉伸原区域");
  const receipt = env.animations.find((animation) => animation.target.classList.contains("evidence-detail"));
  assert.ok(receipt, "目标应为细节而不是全景");
  assert.equal(receipt.options.delay, 280, "接近落位时才开始反馈");
  assert.equal(receipt.options.delay + receipt.options.duration, 460, "飞入结束后保留 60ms 轻柔收尾");
  assert.equal(receipt.keyframes[1].transform, "scale(1.025)");
  assert.equal(receipt.keyframes.at(-1).transform, "scale(1)");
  const transforms = flight.keyframes.map((frame) => [...frame.transform.matchAll(/-?\d+(?:\.\d+)?/g)].map((match) => Number(match[0])));
  assert.ok(transforms[12][1] < transforms[24][1] / 2, "中点高于直线路径，形成连续弧线");
  assert.ok(Math.abs(transforms[24][2] - 98 / 240) < 1e-9, "落位保持单一缩放比例");
  assert.equal(transition.ghost, flight.target);
  assert.equal(env.shadow.activeElement, env.choices[1]);
});

test("取证等待真实动画完成，不使用固定 320ms 等待或提前截断", async () => {
  const env = harness();
  const { editor } = env;
  editor.composer.captureEpoch = 1;
  editor.composer.captureToken = "capture-a";
  editor.composer.issue.pageSnapshot = { url:"https://example.test" };
  editor.captureTargets = new Map([["capture-a", {}]]);
  editor.renderCaptureState = () => {};
  const capture = editor.captureEvidence(editor.composer.issue, origin, 1, "capture-a");
  const transition = startTransition(env);
  await settle();
  assert.equal(env.requests.length, 0, "动画尚未落位不能截图");
  assert.deepEqual([...env.timers.values()].map((timer) => timer.delay), [800], "兜底晚于放慢后的完整动画");
  transition.animations.filter((animation) => !animation.target.classList.contains("evidence-detail")).forEach((animation) => animation.finish());
  await settle();
  assert.equal(env.requests.length, 0, "飞入结束但落位反馈未结束时不能提前截图");
  transition.animations.forEach((animation) => animation.finish());
  await settle();
  assert.equal(env.requests.length, 1);
  assert.equal(env.requests[0].message.type, "UIDELTA_CAPTURE_EVIDENCE");
  assert.equal(env.shadow.querySelector(".record-flight"), null);
  assert.equal(env.timers.size, 0);
  env.requests[0].resolve({ ok:false, error:"测试截图失败" });
  await capture;
  assert.equal(editor.captureTargets.size, 0);
  assert.equal(editor.composer.captureStatus, "error");
});

test("放慢飞入、落位及截图淡入期间可持续输入，节点、焦点和选区不被重置", async () => {
  const env = harness();
  const { editor } = env;
  const input = editor.descriptionInput;
  input.focus();
  const transition = startTransition(env);
  input.value = "动画仍在播放时输入的新描述";
  input.setSelectionRange(4, 9);
  assert.notEqual(input.readOnly, true);
  assert.notEqual(input.disabled, true);
  assert.equal(editor.setComposerChoice("priority", "soon"), true);
  transition.animations.forEach((animation) => animation.finish());
  await transition.finished;
  editor.composer.issue.attachments = { context:"context-a", detail:"detail-a" };
  editor.renderComposerEvidence();
  env.requests.forEach((request) => request.resolve({ok:true, dataUrl:"data:image/png;base64,test"}));
  await settle();
  input.value += "，截图淡入时也继续输入";
  input.setSelectionRange(10, 10);
  const fades = env.animations.filter((animation) => animation.target.tagName === "IMG");
  assert.equal(fades.length, 2);
  assert.ok(fades.every((animation) => animation.options.duration === 240));
  fades.forEach((animation) => animation.finish());
  await settle();
  assert.equal(editor.descriptionInput, input);
  assert.equal(env.shadow.activeElement, input);
  assert.equal(input.value, "动画仍在播放时输入的新描述，截图淡入时也继续输入");
  assert.deepEqual(input.selectionCalls, [[4, 9], [10, 10]]);
  assert.equal(input.focusCalls.length, 1);
  assert.equal(editor.composer.priority, "soon");
});

test("动画帧挂起时有可清理的兜底，不让取证一直等待", async () => {
  const env = harness();
  env.editor.renderComposerEvidence();
  env.editor.animateRecordTransition(origin);
  const transition = env.editor.recordTransition;
  [...env.timers.values()][0].callback();
  await transition.finished;
  assert.equal(env.editor.recordTransition, null);
  assert.equal(env.frames.size, 0);
  assert.equal(env.timers.size, 0);
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
  env.choices[2].focus();
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
  assert.equal(env.shadow.activeElement, env.choices[2]);
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

test("截图返回、重复渲染与补充参考图均保留原证据槽及已加载图片", async () => {
  const env = harness();
  const { editor } = env;
  editor.renderComposerEvidence();
  const slots = [...editor.evidenceStrip.children];
  editor.composer.issue.attachments = { context:"context-a", detail:"detail-a" };
  editor.renderComposerEvidence();
  editor.renderComposerEvidence();
  assert.equal(env.requests.length, 2, "加载中的相同缩略图不重复请求");
  assert.deepEqual(editor.evidenceStrip.children, slots);
  env.requests[0].resolve({ ok:true, dataUrl:"data:image/png;base64,context" });
  env.requests[1].resolve({ ok:true, dataUrl:"data:image/png;base64,detail" });
  await settle();
  const images = slots.map((slot) => slot.querySelector("img"));
  editor.composer.issue.attachments.references = ["reference-a"];
  editor.renderComposerEvidence();
  assert.equal(env.requests.length, 3, "仅加载新参考图");
  assert.deepEqual(editor.evidenceStrip.children, slots);
  assert.deepEqual(slots.map((slot) => slot.querySelector("img")), images);
  assert.ok(env.animations.filter((item) => images.includes(item.target)).every((item) => item.options.duration === 240));
});

test("图片解码完成才淡入，重试替换资产时丢弃迟到图且点击指向新资产", async () => {
  const env = harness();
  const { editor } = env;
  const decode = deferred();
  const originalCreate = env.document.createElement;
  env.document.createElement = (tag) => {
    const image = originalCreate(tag);
    if (tag === "img") image.decode = () => decode.promise;
    return image;
  };
  editor.composer.issue.attachments = { detail:"old-detail" };
  editor.renderComposerEvidence();
  const detail = editor.evidenceStrip.children[1];
  env.requests[0].resolve({ ok:true, dataUrl:"data:image/png;base64,old" });
  await settle();
  assert.equal(detail.querySelector("img"), null);
  assert.equal(detail.disabled, true);
  editor.composer.issue.attachments.detail = "new-detail";
  editor.renderComposerEvidence();
  decode.resolve();
  await settle();
  assert.equal(detail.querySelector("img"), null, "旧图片解码晚到不能覆盖新请求");
  env.requests[1].resolve({ ok:true, dataUrl:"data:image/png;base64,new" });
  await settle();
  assert.equal(detail.querySelector("img").src, "data:image/png;base64,new");
  detail.events.click();
  assert.deepEqual(env.previews, [["new-detail", "细节截图"]]);
});

test("图片解码失败不会显示破图或启用空预览；重新渲染允许重试", async () => {
  const env = harness({ reducedMotion:true });
  const originalCreate = env.document.createElement;
  env.document.createElement = (tag) => {
    const image = originalCreate(tag);
    if (tag === "img") image.decode = () => Promise.reject(new Error("bad image"));
    return image;
  };
  env.editor.composer.issue.attachments = { detail:"bad" };
  env.editor.renderComposerEvidence();
  env.requests[0].resolve({ ok:true, dataUrl:"data:image/png;base64,bad" });
  await settle();
  const detail = env.editor.evidenceStrip.children[1];
  assert.equal(detail.disabled, true);
  assert.match(detail.getAttribute("aria-label"), /加载失败/);
  env.editor.renderComposerEvidence();
  assert.equal(env.requests.length, 2);
  env.document.createElement = originalCreate;
  env.requests[1].resolve({ ok:true, dataUrl:"data:image/png;base64,good" });
  await settle();
  assert.equal(detail.disabled, false);
  assert.equal(env.animations.at(-1).options.duration, 80, "减少动态效果仍只做短淡入");
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

test("等待截图期间继续编辑，最终提交最新描述和选项并完成保存", async () => {
  const env = savingHarness();
  const { editor } = env;
  editor.descriptionInput.value = "点击保存时的初稿";
  const saving = editor.saveComposer();
  assert.equal(editor.composer.saving, true);
  assert.equal(editor.saveButton.disabled, true);
  assert.equal(editor.cancelComposerButton.disabled, true);
  assert.equal(editor.descriptionInput.readOnly, false);
  assert.ok(env.choices.every((select) => !select.disabled));
  assert.equal(editor.referenceInput.disabled, false);
  assert.equal(env.requests.length, 0, "截图完成前不应提交初稿");

  editor.descriptionInput.value = "  等截图时修订的最终描述\n补充复现步骤。  ";
  editor.setComposerChoice("type", "functional");
  editor.setComposerChoice("priority", "immediate");
  editor.setComposerChoice("severity", "blocked");
  env.finishCapture();
  await settle();
  assert.equal(env.requests.length, 1);
  const { message } = env.requests[0];
  assert.equal(message.type, "UIDELTA_PUT_ISSUE");
  assert.equal(message.issue.description, "等截图时修订的最终描述\n补充复现步骤。");
  assert.equal(message.issue.title, editor.issueTitle(message.issue.description, "functional"));
  assert.equal(message.issue.type, "functional");
  assert.equal(message.issue.priority, "immediate");
  assert.equal(message.issue.severity, "blocked");
  assert.equal(message.issue.reviewStatus, "accepted");
  assert.equal(message.issue.displayId, "FN-007");
  env.requests[0].resolve({ ok: true, issue: message.issue });
  await saving;
  assert.equal(editor.composer, null);
  assert.equal(editor.issues.length, 1);
  assert.equal(editor.issues[0].description, message.issue.description);
  assert.equal(editor.captureEpoch, 2);
  assert.equal(env.countUpdates, 1);
  assert.equal(env.contextPersists, 4);
  assert.equal(env.pinRenders, 1);
  assert.equal(env.returnedView, "inspect");
});

test("等待截图时清空描述会拒绝提交并恢复保存按钮", async () => {
  const env = savingHarness();
  const { editor } = env;
  const activeComposer = editor.composer;
  editor.descriptionInput.value = "稍后将清空的草稿";
  const saving = editor.saveComposer();
  editor.descriptionInput.value = " \n\t ";
  env.finishCapture();
  await saving;
  assert.equal(env.requests.length, 0, "不得提交截图等待前缓存的旧描述");
  assert.equal(editor.composer, activeComposer);
  assert.equal(activeComposer.saving, false);
  assert.equal(editor.saveButton.disabled, false);
  assert.equal(editor.cancelComposerButton.disabled, false);
  assert.equal(editor.saveButton.textContent, "保存并继续");
  assert.equal(editor.descriptionInput.readOnly, false);
  assert.ok(env.choices.every((select) => !select.disabled));
  assert.equal(editor.descriptionInput.value, " \n\t ");
  assert.match(editor.composerError.textContent, /请写一句问题描述/);
  assert.equal(env.shadow.activeElement, editor.descriptionInput);
  assert.equal(editor.issues.length, 0);
});

test("实际提交时锁定描述与选项，保存失败后恢复编辑且不丢文本", async () => {
  const env = savingHarness({ capturing: false });
  const { editor } = env;
  const activeComposer = editor.composer;
  const draft = "  包含换行的未保存修改\n间距应该为 12px。  ";
  editor.descriptionInput.value = draft;
  editor.descriptionInput.focus();
  editor.descriptionInput.setSelectionRange(2, 8);
  const saving = editor.saveComposer();
  await settle();
  assert.equal(env.requests.length, 1);
  assert.equal(env.requests[0].message.type, "UIDELTA_PUT_ISSUE");
  assert.equal(editor.descriptionInput.readOnly, true);
  assert.ok(env.choices.every((select) => select.disabled));
  assert.equal(editor.referenceInput.disabled, true);
  assert.equal(editor.saveButton.disabled, true);
  assert.equal(editor.cancelComposerButton.disabled, true);
  assert.equal(editor.descriptionInput.value, draft);
  env.requests[0].resolve({ ok: false, error: "存储暂不可用，请重试" });
  await saving;
  assert.equal(editor.composer, activeComposer);
  assert.equal(activeComposer.saving, false);
  assert.equal(editor.descriptionInput.readOnly, false);
  assert.ok(env.choices.every((select) => !select.disabled));
  assert.equal(editor.referenceInput.disabled, false);
  assert.equal(editor.saveButton.disabled, false);
  assert.equal(editor.cancelComposerButton.disabled, false);
  assert.equal(editor.saveButton.textContent, "保存并继续");
  assert.equal(editor.descriptionInput.value, draft);
  assert.deepEqual(editor.descriptionInput.selectionCalls, [[2, 8]]);
  assert.equal(env.shadow.activeElement, editor.descriptionInput);
  assert.equal(editor.composerError.textContent, "存储暂不可用，请重试");
  assert.equal(editor.issues.length, 0);
  assert.equal(env.contextPersists, undefined);
});

test("参考图等待取证草稿完成后上传；保存等待参考图，最终包含完整附件", async () => {
  const env = savingHarness();
  const { editor } = env;
  editor.renderComposerEvidence = () => {};
  editor.readFileAsDataUrl = async () => "data:image/png;base64,test";
  const uploading = editor.addReferenceImages([{ type:"image/png", name:"reference.png" }]);
  assert.ok(editor.composer.referencePromise);
  assert.equal(editor.referenceInput.disabled, true);
  const saving = editor.saveComposer();
  await settle();
  assert.equal(env.requests.length, 0);
  env.finishCapture();
  await settle();
  assert.equal(env.requests.length, 1);
  assert.equal(env.requests[0].message.type, "UIDELTA_PUT_REFERENCE_ASSET");
  env.requests[0].resolve({ ok:true, asset:{ id:"reference-a" } });
  await uploading;
  await settle();
  assert.equal(env.requests[1].message.type, "UIDELTA_PUT_ISSUE");
  assert.deepEqual(Array.from(env.requests[1].message.issue.attachments.references), ["reference-a"]);
  env.requests[1].resolve({ ok:true, issue:env.requests[1].message.issue });
  await saving;
  assert.equal(editor.composer, null);
});

test("结果参考文字与问题附图角色一起保存；图片问题无需额外文字", async () => {
  const env = savingHarness({capturing:false});
  const {editor} = env;
  editor.resultInput = env.create('textarea'); editor.resultInput.value = '期望效果\n保留换行';
  editor.descriptionInput.value = '';
  editor.renderComposerEvidence = () => {};
  editor.readFileAsDataUrl = async () => 'data:image/png;base64,test';
  const upload = editor.addReferenceImages([{type:'image/png',name:'problem.png'}], 'description');
  await settle(); env.requests[0].resolve({ok:true,asset:{id:'problem-image'}}); await upload;
  assert.deepEqual(Array.from(editor.composer.issue.attachments.descriptionImages), ['problem-image']);
  const saving = editor.saveComposer(); await settle();
  const request = env.requests[1];
  assert.equal(request.message.issue.resultReference, '期望效果\n保留换行');
  assert.equal(request.message.issue.title, '【UI】图片问题');
  assert.equal(editor.resultInput.readOnly, true);
  request.resolve({ok:true,issue:request.message.issue}); await saving;
  assert.equal(editor.composer,null);
});

test("纯文本粘贴保持原生行为；混合粘贴在光标处插入文字并传递图片用途", async () => {
  const {editor} = savingHarness({capturing:false});
  let prevented = false, upload;
  editor.addReferenceImages = (files,role) => {upload = {files,role};};
  const target = {selectionStart:2,selectionEnd:4,setRangeText(...args){this.inserted=args;}};
  const event = {target,preventDefault(){prevented=true;},clipboardData:{items:[],getData:()=> '结果'}};
  editor.pasteComposerImages(event,'result');
  assert.equal(prevented,false); assert.equal(upload,undefined);
  const file = {type:'image/png'};
  event.clipboardData.items = [{kind:'file',type:'image/png',getAsFile:()=>file}];
  editor.pasteComposerImages(event,'result');
  assert.equal(prevented,true); assert.deepEqual(target.inserted,['结果',2,4,'end']);
  assert.equal(upload.role,'result'); assert.equal(upload.files[0],file);
  upload=undefined;editor.composer.saving=true;
  editor.pasteComposerImages(event,'description'); assert.equal(upload,undefined);
});

test("草稿恢复快照保留结果文字和附图分类，移除图片同步移除分类", async () => {
  const env = savingHarness({capturing:false}), {editor}=env;
  editor.composer.formReady=true;
  editor.resultInput=env.create('textarea');editor.resultInput.value='新的结果参考';
  editor.composer.issue.attachments.references=['a','b'];
  editor.composer.issue.attachments.descriptionImages=['a'];
  const snapshot=editor.composerTabSnapshot();
  assert.equal(snapshot.issue.resultReference,'新的结果参考');
  editor.renderComposerEvidence=()=>{}; await editor.removeReferenceAsset('a');
  assert.deepEqual(Array.from(editor.composer.issue.attachments.references),['b']);
  assert.equal(editor.composer.issue.attachments.descriptionImages.length,0);
  assert.equal(snapshot.issue.attachments.descriptionImages[0],'a');
});

test("保存等待中的参考图上传失败时停留表单，不静默提交缺图版本", async () => {
  const env = savingHarness({ capturing:false });
  const { editor } = env;
  editor.renderComposerEvidence = () => {};
  editor.readFileAsDataUrl = async () => "data:image/png;base64,test";
  const composer = editor.composer;
  const uploading = editor.addReferenceImages([{ type:"image/png", name:"reference.png" }]);
  const saving = editor.saveComposer();
  await settle();
  env.requests[0].resolve({ok:false,error:"参考图写入失败"});
  await Promise.all([uploading,saving]);
  assert.equal(env.requests.length,1);
  assert.equal(editor.composer,composer);
  assert.equal(composer.saving,false);
  assert.equal(editor.saveButton.disabled,false);
  assert.match(editor.composerError.textContent,/参考图写入失败/);
});

test("参考图读取期间目标已切换，不向新问题上传或追加旧图片", async () => {
  const env = savingHarness({ capturing:false });
  const { editor } = env;
  const read = deferred();
  editor.readFileAsDataUrl = () => read.promise;
  const previous = editor.composer;
  const uploading = editor.addReferenceImages([{ type:"image/png", name:"old.png" }]);
  await settle();
  editor.composer = { issue:{ id:"issue-b", attachments:{} } };
  read.resolve("data:image/png;base64,test");
  await uploading;
  assert.equal(env.requests.length, 0);
  assert.equal(editor.composer.issue.attachments.references, undefined);
  assert.equal(previous.referencePromise, null);
});

test("移除参考图只修改草稿，提交前不删除图片，也不修改原数组", async () => {
  const env = savingHarness({ capturing:false });
  const { editor } = env;
  const original = ["committed-reference"];
  editor.composer.issue.attachments.references = original;
  editor.renderComposerEvidence = () => {};
  await editor.removeReferenceAsset("committed-reference");
  assert.deepEqual(original, ["committed-reference"]);
  assert.equal(editor.composer.issue.attachments.references.length, 0);
  assert.equal(env.requests.length, 0, "只能在保存 Issue 的事务中删除旧附件");
});

test("图片读取失败恢复上传控件和错误提示；上传或保存中不能打开另一问题", async () => {
  const env = savingHarness({ capturing:false });
  const { editor } = env;
  editor.renderComposerEvidence = () => {};
  editor.readFileAsDataUrl = async () => { throw new Error("无法读取图片"); };
  const composer = editor.composer;
  const uploading = editor.addReferenceImages([{ type:"image/png", name:"broken.png" }]);
  await editor.openComposer({ id:"other" });
  assert.equal(editor.composer, composer);
  await uploading;
  assert.equal(composer.referencePromise, null);
  assert.equal(editor.referenceInput.disabled, false);
  assert.equal(editor.composerError.textContent, "无法读取图片");
  composer.saving = true;
  await editor.openComposer({ id:"other" });
  assert.equal(editor.composer, composer);
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
  env.choices[0].focus();
  editor.setCaptureOverlayVisible(false, true);
  assert.ok(controls.every((node) => node.style.opacity === "0" && node.style.pointerEvents === "none"));
  assert.equal(env.host.style.opacity, "");
  assert.equal(measurement.style.opacity, ".75");
  assert.equal(env.shadow.activeElement, env.choices[0]);
  editor.setCaptureOverlayVisible(true);
  assert.ok(controls.every((node) => node.style.opacity === ".9" && node.style.pointerEvents === "auto"));
  assert.equal(env.shadow.activeElement, env.choices[0]);
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

test("取证在淡出完成并隐藏后才就绪；恢复淡入不阻塞 ACK 或改变输入焦点", async () => {
  for (const preserveMeasurement of [false, true]) {
    const env = harness();
    const { editor } = env;
    editor.descriptionInput.focus();
    editor.descriptionInput.setSelectionRange(1, 4);
    editor.panel.style.opacity = ".85";
    let ready = false;
    const hiding = editor.transitionCaptureOverlay(false, preserveMeasurement).then((value) => { ready = value; });
    assert.ok(env.animations.every((animation) => animation.options.duration === 80));
    await settle();
    assert.equal(ready, false, "不能截图到淡出中间帧");
    env.animations.forEach((animation) => animation.finish());
    await hiding;
    assert.equal(ready, true);
    assert.equal((preserveMeasurement ? editor.panel : env.host).style.opacity, "0");
    const before = env.animations.length;
    assert.equal(await editor.transitionCaptureOverlay(true, preserveMeasurement), true);
    assert.equal(editor.panel.style.opacity, ".85");
    const restoring = env.animations.slice(before);
    assert.equal(restoring.length, 3);
    assert.ok(restoring.every((animation) => animation.options.duration === 160));
    assert.equal(restoring[0].keyframes.at(-1).opacity, ".85");
    assert.equal(env.shadow.activeElement, editor.descriptionInput);
    assert.deepEqual(editor.descriptionInput.selectionCalls, [[1, 4]]);
    editor.cancelToolbarTransition();
    assert.ok(restoring.every((animation) => animation.cancellations === 1));
  }
});

test("取证淡出中收起或超时恢复会取消等待，不允许迟到动画再次隐藏面板", async () => {
  for (const cancel of [
    (editor) => editor.cancelToolbarTransition(),
    (editor) => editor.setCaptureOverlayVisible(true)
  ]) {
    const env = harness();
    const hiding = env.editor.transitionCaptureOverlay(false, true);
    cancel(env.editor);
    assert.equal(await hiding, false);
    env.animations.forEach((animation) => animation.finish());
    await settle();
    assert.equal(env.editor.captureOverlayStyles ?? null, null);
    assert.equal(env.editor.panel.style.opacity, "");
    assert.equal(env.host.getAttribute("data-uidelta-capturing"), null);
  }
});

test("减少动态效果仅短暂渐隐，非记录界面不增加截图等待", async () => {
  const env = harness({ reducedMotion:true });
  const hiding = env.editor.transitionCaptureOverlay(false);
  assert.ok(env.animations.every((animation) => animation.options.duration === 60));
  assert.ok(env.animations.every((animation) => animation.keyframes.every((frame) => !frame.transform)));
  env.animations.forEach((animation) => animation.finish());
  assert.equal(await hiding, true);
  env.editor.setCaptureOverlayVisible(true);
  env.editor.currentView = "inspect";
  const count = env.animations.length;
  assert.equal(await env.editor.transitionCaptureOverlay(false), true);
  assert.equal(env.animations.length, count);
  assert.equal(env.host.style.opacity, "0");
});

test("真实截图消息处理器等待淡出和两帧重绘；超时后不重复回包或重新隐藏", async () => {
  for (const timeout of [false, true]) {
    const env = harness();
    let listener;
    env.editor.captureTargetState = () => ({ documentId:"test-page", pageUrl:"https://example.test" });
    const messageSource = source.slice(source.indexOf("  chrome.runtime.onMessage.addListener("), source.lastIndexOf("\n})();"));
    vm.runInNewContext(messageSource, {
      review:env.editor, window:env.window, requestAnimationFrame:env.window.requestAnimationFrame,
      chrome:{ runtime:{ onMessage:{ addListener(callback) { listener = callback; } } } }
    });
    const responses = [];
    assert.equal(listener({ type:"UIDELTA_CAPTURE_OVERLAY", visible:false, captureToken:"a" }, {}, (value) => responses.push(value)), true);
    assert.equal(responses.length, 0);
    if (timeout) [...env.timers.values()].find((timer) => timer.delay === 1200).callback();
    env.animations.forEach((animation) => animation.finish());
    await settle();
    if (!timeout) {
      assert.equal(responses.length, 0, "等待第一帧");
      env.flushFrame();
      assert.equal(responses.length, 0, "等待第二帧");
    }
    env.flushFrame();
    await settle();
    assert.equal(responses.length, 1);
    assert.equal(responses[0].ok, !timeout);
    assert.equal(env.host.style.opacity, timeout ? "" : "0");
    assert.equal(env.editor.captureSurfaceTransition, null);
  }
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
