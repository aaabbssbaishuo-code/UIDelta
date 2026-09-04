import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

// Exercise the shipped methods without booting the extension or a browser.
// The mocks model only the DOM behaviour involved in these regressions.
class MockStyle {
  constructor() { this.priorities = {}; }
  setProperty(name, value, priority = "") {
    this[name] = this[name.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = String(value);
    this.priorities[name] = priority;
  }
  removeProperty(name) { delete this[name]; delete this.priorities[name]; }
  getPropertyValue(name) { return this[name] || ""; }
  getPropertyPriority(name) { return this.priorities[name] || ""; }
}

class MockClassList {
  constructor() { this.names = new Set(); }
  add(...names) { names.forEach((name) => this.names.add(name)); }
  remove(...names) { names.forEach((name) => this.names.delete(name)); }
  contains(name) { return this.names.has(name); }
  toggle(name, force) {
    const enabled = force ?? !this.names.has(name);
    if (enabled) this.names.add(name);
    else this.names.delete(name);
    return enabled;
  }
}

class MockElement {
  constructor(tagName = "div") {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.dataset = {};
    this.attributes = {};
    this.style = new MockStyle();
    this.classList = new MockClassList();
    this.isConnected = true;
    this.offsetWidth = 100;
    this.bounds = { left: 0, top: 0, width: 200, height: 48 };
  }
  append(...children) {
    children.forEach((child) => {
      child.parentElement = this;
      this.children.push(child);
    });
  }
  appendChild(child) { this.append(child); return child; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name] ?? null; }
  getBoundingClientRect() {
    return { ...this.bounds, right: this.bounds.left + this.bounds.width, bottom: this.bounds.top + this.bounds.height };
  }
  addEventListener() {}
  querySelectorAll(selector) {
    const all = this.children.flatMap((child) => [child, ...child.querySelectorAll("*")]);
    if (selector === "*") return all;
    if (selector === "select") return all.filter((child) => child.tagName === "SELECT");
    return [];
  }
}

class MockInput extends MockElement {
  constructor() { super("input"); this.type = "text"; this.value = ""; }
}
class MockTextarea extends MockElement {
  constructor() { super("textarea"); this.value = ""; }
}
class MockSelect extends MockElement {
  constructor() { super("select"); }
  // A native select chooses its first option unless a value is selected.
  get value() { return this.selectedValue ?? this.children[0]?.value ?? ""; }
  set value(value) { this.selectedValue = String(value); }
}

const documentMock = {
  createElement(tagName) {
    if (tagName === "select") return new MockSelect();
    if (tagName === "input") return new MockInput();
    if (tagName === "textarea") return new MockTextarea();
    return new MockElement(tagName);
  }
};

const source = await readFile(new URL("./content.js", import.meta.url), "utf8");
const classStart = source.indexOf("  const ROOT_ATTRIBUTE");
const bootStart = source.indexOf("  const review = new UIDeltaReview();");
assert.ok(classStart >= 0 && bootStart > classStart, "无法提取 UIDeltaReview 类");
const sandbox = {
  document: documentMock,
  window: { innerWidth: 1200, innerHeight: 800, requestAnimationFrame: (callback) => callback() },
  Element: MockElement,
  HTMLElement: MockElement,
  HTMLInputElement: MockInput,
  HTMLTextAreaElement: MockTextarea,
  HTMLSelectElement: MockSelect
};
vm.createContext(sandbox);
vm.runInContext(source.slice(classStart, bootStart) + "\nglobalThis.ReviewClass = UIDeltaReview;", sandbox);

function review(overrides = {}) {
  return Object.assign(Object.create(sandbox.ReviewClass.prototype), overrides);
}

function keyEvent(target, key, shiftKey = false) {
  return {
    key, shiftKey, altKey: false, metaKey: false, ctrlKey: false,
    composedPath: () => [target],
    prevented: false,
    stopped: false,
    preventDefault() { this.prevented = true; },
    stopPropagation() { this.stopped = true; }
  };
}

function numericEditor(property, value) {
  const input = new MockInput();
  input.value = String(value);
  input.dataset = { previewProp: property, uiNumeric: property, lastValid: String(value) };
  const applied = [];
  const editor = review({
    uiEditor: { querySelectorAll: () => [input] },
    previewState: { before: {}, changes: {} },
    applyPreviewProperty: (name, newValue) => applied.push([name, newValue])
  });
  return { editor, input, applied };
}

const cases = [
  ["间距与四边内边距独立成组，位于布局之后且不影响后续标题", () => {
    const markup = source.match(/<aside class='ui-editor'[\s\S]*?<\/aside>/)?.[0];
    assert.ok(markup);
    assert.match(markup, /<section class='ui-editor-section ui-editor-spacing-section' aria-label='间距与内边距'>/);
    assert.ok(markup.indexOf("data-ui-section='layout'") < markup.indexOf("data-ui-section='spacing'"));
    assert.ok(markup.indexOf("data-ui-section='spacing'") < markup.indexOf("data-ui-section='appearance'"));
    const object = review().renderUiEditor.toString().match(/const sections = (\{[\s\S]*?\n      \});/)[1];
    const groups = vm.runInNewContext(`(${object})`, { positionFields: [] });
    assert.equal(JSON.stringify(groups.layout.map(([name]) => name)), JSON.stringify(["display", "flexDirection", "justifyContent", "alignItems"]));
    assert.equal(JSON.stringify(groups.spacing.map(([name]) => name)), JSON.stringify(["gap", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft"]));
    assert.doesNotMatch(review().localizeOverlay.toString(), /nth-of-type/);
  }],
  ["下拉框显示真实当前值", () => {
    const editor = review({ previewState: { before: { flexDirection: "column", display: "grid" }, changes: {} } });
    const direction = editor.createUiEditorField("flexDirection", "方向", "select").querySelectorAll("select")[0];
    const display = editor.createUiEditorField("display", "布局", "select").querySelectorAll("select")[0];
    assert.equal(direction.value, "column");
    assert.equal(display.value, "grid");
    editor.previewState.changes.flexDirection = "row-reverse";
    const changed = editor.createUiEditorField("flexDirection", "方向", "select").querySelectorAll("select")[0];
    assert.equal(changed.value, "row-reverse");
  }],
  ["下拉键盘操作不重建编辑器", () => {
    const select = new MockSelect();
    let renders = 0;
    const editor = review({
      enabled: true, currentView: "inspect", selected: new MockElement(),
      shadow: { activeElement: select },
      setModifier() {}, setPierce() {},
      renderSelected() { renders += 1; },
      updateInspector() { renders += 1; }
    });
    assert.equal(editor.isTypingTarget(keyEvent(select, "ArrowDown")), true);
    editor.onKeyUp(keyEvent(select, "ArrowDown"));
    assert.equal(renders, 0, "select 的 keyup 不应重建字段树");
    assert.equal(editor.shadow.activeElement, select);
  }],
  ["切换窗口保留未完成输入与原字段节点", () => {
    const input = new MockInput();
    input.value = "12.";
    input.dataset = { previewProp: "width", uiNumeric: "width", lastValid: "12" };
    const from = new MockElement();
    const to = new MockElement();
    const comparisons = [];
    const editor = review({
      enabled: true, currentView: "inspect", selectionLocked: true, selected: from, hovered: to,
      shadow: { activeElement: input },
      renderComparison: (a, b) => comparisons.push([a, b]),
      updateInspector() { assert.fail("窗口失焦不应重建编辑器"); }
    });
    editor.onWindowBlur();
    assert.equal(editor.shadow.activeElement, input, "字段应保持原节点");
    assert.equal(input.value, "12.", "窗口失焦不应丢失未完成的小数草稿");
    assert.deepEqual(comparisons, [[from, to]], "应继续显示当前 A/B 比较");
  }],
  ["连续输入 0.01 保留中间草稿", () => {
    const { editor, input, applied } = numericEditor("width", 10);
    for (const draft of ["0", "0.", "0.0", "0.01"]) {
      input.value = draft;
      editor.handleUiNumericInput(input);
      assert.equal(input.value, draft, `输入 ${draft} 时不应改写当前字符串`);
    }
    assert.deepEqual(applied.at(-1), ["width", "0.01"]);
    assert.equal(input.dataset.lastValid, "0.01");
    input.value = "";
    editor.commitUiNumericInput(input);
    assert.equal(input.value, "0.01", "非法输入应恢复最后有效值");
    assert.equal(input.classList.contains("is-invalid"), true);
  }],
  ["上下键及 Shift 使用属性对应步长", () => {
    for (const [property, initial, shiftStep] of [["width", 12, 10], ["height", 12, 10], ["borderRadius", 12, 4], ["fontSize", 12, 4], ["lineHeight", 12, 4], ["gap", 12, 4], ["paddingTop", 12, 4], ["paddingRight", 12, 4], ["paddingBottom", 12, 4], ["paddingLeft", 12, 4], ["opacity", 50, 5]]) {
      const { editor, input } = numericEditor(property, initial);
      const up = keyEvent(input, "ArrowUp", true);
      editor.handleUiNumericKeydown(up, input);
      assert.equal(input.value, String(initial + shiftStep), property);
      assert.equal(up.prevented, true);
      editor.handleUiNumericKeydown(keyEvent(input, "ArrowDown"), input);
      assert.equal(input.value, String(initial + shiftStep - 1), property);
    }
    const { editor, input } = numericEditor("opacity", 99);
    editor.handleUiNumericKeydown(keyEvent(input, "ArrowUp", true), input);
    assert.equal(input.value, "100", "透明度应限制在 100%");
  }],
  ["选中 A 后 hover B 仅更新测距", () => {
    const from = new MockElement();
    const to = new MockElement();
    const comparisons = [];
    const editor = review({
      enabled: true, session: { status: "active" }, currentView: "inspect", inspectMode: "ui",
      selected: from, selectionLocked: true, lastHoverTarget: from,
      modifierDown: false, pierceDown: false,
      isUiEvent: () => false, getTarget: () => to, issueForHover: () => null,
      renderComparison: (a, b) => comparisons.push([a, b]),
      updateInspector() { assert.fail("hover 不应替换已锁定的属性面板"); }
    });
    editor.onPointerMove({ clientX: 200, clientY: 100, metaKey: false, ctrlKey: false });
    assert.equal(editor.selected, from);
    assert.equal(editor.hovered, to);
    assert.deepEqual(comparisons, [[from, to]]);
  }],
  ["滚动与 resize 保留 A/B 比较", () => {
    const from = new MockElement();
    const to = new MockElement();
    const comparisons = [];
    let selectedRenders = 0;
    const editor = review({
      enabled: true, currentView: "inspect", selectionLocked: true, selected: from, hovered: to,
      renderComparison: (a, b) => comparisons.push([a, b]),
      renderSelected() { selectedRenders += 1; },
      renderPins() {}, clampPanelToViewport() {}
    });
    editor.onLayoutChange();
    editor.onLayoutChange();
    assert.deepEqual(comparisons, [[from, to], [from, to]]);
    assert.equal(selectedRenders, 0, "布局变化不应退回 A 的父子测距");
    to.isConnected = false;
    editor.onLayoutChange();
    assert.equal(selectedRenders, 1, "B 移除后应安全恢复 A");
  }],
  ["布局字段只在适用时显示且不重建节点", () => {
    const fields = Object.fromEntries(["display", "flexDirection", "justifyContent", "alignItems", "gap"].map((name) => [name, new MockElement()]));
    const editor = review({
      previewState: { before: { display: "block" }, changes: {} },
      uiEditor: { querySelector: (selector) => fields[selector.match(/data-field='([^']+)'/)?.[1]] }
    });
    editor.syncUiLayoutFields();
    for (const property of ["flexDirection", "justifyContent", "alignItems", "gap"]) assert.equal(fields[property].hidden, true, property);
    editor.previewState.changes.display = "grid";
    editor.syncUiLayoutFields();
    assert.equal(fields.flexDirection.hidden, true, "网格不应显示 flex 方向");
    for (const property of ["justifyContent", "alignItems", "gap"]) assert.equal(fields[property].hidden, false, property);
    editor.previewState.changes.display = "flex";
    editor.syncUiLayoutFields();
    assert.equal(fields.flexDirection.hidden, false);
    assert.equal(editor.uiEditor.querySelector("[data-field='flexDirection']"), fields.flexDirection);
  }],
  ["撤销四边内边距恢复原值及优先级", () => {
    const element = new MockElement();
    const originals = [["padding-top", "4px", "important"], ["padding-right", "8px", ""], ["padding-bottom", "12px", "important"], ["padding-left", "16px", ""]];
    for (const [property, value, priority] of originals) element.style.setProperty(property, value, priority);
    const editor = review({
      previewHistory: new Map(), previewStates: new Map(), previewTargets: new Set([element]),
      previewState: { changes: { paddingTop: "20px" } }
    });
    editor.capturePreviewOriginal(element);
    for (const [property] of originals) element.style.setProperty(property, "20px", "important");
    editor.capturePreviewOriginal(element);
    editor.resetPreview(false);
    for (const [property, value, priority] of originals) {
      assert.equal(element.style.getPropertyValue(property), value, property);
      assert.equal(element.style.getPropertyPriority(property), priority, `${property} 优先级`);
    }
    assert.equal(editor.previewHistory.size, 0);
    assert.equal(editor.previewState, null);
  }],
  ["工具栏拖动与默认位置复位", () => {
    const modeToolbar = new MockElement();
    const editor = review({ modeToolbar });
    editor.positionModeToolbar(100, 200);
    assert.equal(modeToolbar.style.left, "100px");
    assert.equal(modeToolbar.style.top, "200px");
    assert.equal(modeToolbar.style.right, "auto");
    assert.equal(modeToolbar.style.bottom, "auto");
    assert.equal(modeToolbar.style.transform, "none");
    assert.equal(modeToolbar.dataset.position, "free");
    assert.equal(modeToolbar.classList.contains("tooltips-below"), false);
    editor.positionModeToolbar(-100, -100);
    assert.equal(modeToolbar.style.left, "8px", "工具栏不可拖出视口左边缘");
    assert.equal(modeToolbar.style.top, "8px", "工具栏不可拖出视口上边缘");
    assert.equal(modeToolbar.classList.contains("tooltips-below"), true, "接近顶部时提示应向下显示");
    editor.positionModeToolbar(5000, 5000);
    assert.equal(modeToolbar.style.left, "992px", "应按视口宽度和工具栏实际宽度夹取");
    assert.equal(modeToolbar.style.top, "744px", "应按视口高度和工具栏实际高度夹取");
    assert.equal(modeToolbar.classList.contains("tooltips-below"), false);
    editor.resetModeToolbarPosition();
    for (const property of ["left", "top", "right", "bottom", "transform"]) {
      assert.equal(modeToolbar.style.getPropertyValue(property), "", `复位应移除 ${property} 覆盖值`);
    }
    assert.equal(modeToolbar.dataset.position, undefined);
    assert.equal(modeToolbar.classList.contains("tooltips-below"), false);
  }]
];

let failed = 0;
for (const [name, test] of cases) {
  try {
    test();
    console.log(`PASS ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${name}\n${error.stack}`);
  }
}
if (failed) process.exitCode = 1;
console.log(`UIDelta editor behaviour: ${cases.length - failed}/${cases.length} passed`);
