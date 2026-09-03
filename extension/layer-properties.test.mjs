import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

// Exercise production box-model arithmetic and rendering without launching
// Chrome. Visual dimensions are intentionally different from layout sizes.
class MockNode {
  constructor() {
    this.children = [];
    this.attributes = {};
    this.style = { setProperty(name, value) { this[name] = value; } };
    this.hidden = false;
    this.textContent = "";
  }
  appendChild(child) { this.children.push(child); return child; }
  replaceChildren(...children) { this.children = children; this.textContent = ""; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
}

const source = await readFile(new URL("./content.js", import.meta.url), "utf8");
const start = source.indexOf("  const ROOT_ATTRIBUTE");
const end = source.indexOf("  const review = new UIDeltaReview();");
assert.ok(start >= 0 && end > start, "无法提取 UIDeltaReview 类");
const sandbox = { document: { createElement: () => new MockNode() }, window: {} };
vm.createContext(sandbox);
vm.runInContext(source.slice(start, end) + "\nglobalThis.ReviewClass = UIDeltaReview;", sandbox);
const review = Object.create(sandbox.ReviewClass.prototype);

function computed(overrides = {}) {
  return {
    display: "block", boxSizing: "border-box", width: "200px", height: "100px",
    paddingTop: "10px", paddingRight: "10px", paddingBottom: "10px", paddingLeft: "10px",
    borderTopWidth: "2px", borderRightWidth: "2px", borderBottomWidth: "2px", borderLeftWidth: "2px",
    borderTopStyle: "solid", borderRightStyle: "solid", borderBottomStyle: "solid", borderLeftStyle: "solid",
    borderTopColor: "rgb(0, 0, 0)", borderRightColor: "rgb(0, 0, 0)", borderBottomColor: "rgb(0, 0, 0)", borderLeftColor: "rgb(0, 0, 0)",
    borderRadius: "0px", boxShadow: "none", gap: "normal", opacity: "1",
    fontFamily: '"Inter", sans-serif', fontSize: "14px", lineHeight: "21px", fontWeight: "400",
    color: "rgb(20, 20, 20)", backgroundColor: "rgba(0, 0, 0, 0)", backgroundImage: "none",
    ...overrides
  };
}

function renderFixture(style = computed(), element = {}, bounds = { width: 600, height: 300 }, text = "示例文字") {
  const root = new MockNode();
  const nodes = new Map();
  root.querySelector = (selector) => {
    const key = selector.replaceAll('"', "'");
    if (!nodes.has(key)) nodes.set(key, new MockNode());
    return nodes.get(key);
  };
  const instance = Object.assign(Object.create(sandbox.ReviewClass.prototype), {
    shadow: { querySelector: () => root }, textContent: () => text
  });
  instance.renderLayerProperties(element, style, bounds);
  return {
    root, instance,
    node: (kind, key) => root.querySelector(`[data-layer-${kind}='${key}']`),
    value: (key) => root.querySelector(`[data-layer-value='${key}']`).children.at(-1)?.textContent || ""
  };
}

const cases = [
  ["border-box 扣除四向内边距与边框并保留小数", () => {
    const box = review.layerBoxMetrics({}, computed({
      width: "200.5px", height: "100.25px",
      paddingTop: "10.25px", paddingRight: "12.5px", paddingBottom: "14.5px", paddingLeft: "16.25px",
      borderTopWidth: "1.25px", borderRightWidth: "2.5px", borderBottomWidth: "3.75px", borderLeftWidth: "4.5px"
    }));
    assert.equal(box.width, 164.75);
    assert.equal(box.height, 70.5);
    assert.deepEqual(Array.from(box.padding), [10.25, 12.5, 14.5, 16.25]);
    assert.deepEqual(Array.from(box.border), [1.25, 2.5, 3.75, 4.5]);
  }],
  ["content-box 的 CSS 尺寸不重复扣内边距", () => {
    const box = review.layerBoxMetrics({}, computed({ boxSizing: "content-box", width: "200.5px", height: "100.25px" }));
    assert.equal(box.width, 200.5);
    assert.equal(box.height, 100.25);
  }],
  ["transform 后的 W/H 与 CSS 内容尺寸分开显示", () => {
    const fixture = renderFixture(computed({ transform: "matrix(3, 0, 0, 3, 0, 0)" }));
    assert.equal(fixture.value("width"), "600 px");
    assert.equal(fixture.value("height"), "300 px");
    assert.equal(fixture.node("box", "content-size").textContent, "176 × 76");
    assert.match(fixture.node("value", "width").title, /包含变换/);
  }],
  ["滚动条占用空间不会被算进内容尺寸", () => {
    const element = { offsetWidth: 200, clientWidth: 181, offsetHeight: 100, clientHeight: 96 };
    const box = review.layerBoxMetrics(element, computed());
    assert.equal(box.width, 161);
    assert.equal(box.height, 76);
    const contentBox = review.layerBoxMetrics({ ...element, offsetWidth: 224, clientWidth: 205 }, computed({ boxSizing: "content-box" }));
    assert.equal(contentBox.width, 185);
  }],
  ["非像素宽度使用布局尺寸，inline 不伪造独立内容盒", () => {
    const block = review.layerBoxMetrics({ offsetWidth: 200, clientWidth: 196, offsetHeight: 100, clientHeight: 96 }, computed({ width: "50%", height: "auto" }));
    assert.equal(block.width, 176);
    assert.equal(block.height, 76);
    const inline = review.layerBoxMetrics({ offsetWidth: 100, clientWidth: 0, offsetHeight: 40, clientHeight: 0 }, computed({ display: "inline", width: "auto", height: "auto" }));
    assert.equal(inline.width, null);
    assert.equal(inline.height, null);
    const fixture = renderFixture(computed({ display: "inline", width: "auto", height: "auto" }));
    assert.equal(fixture.node("box", "content-size").textContent, "");
    assert.equal(fixture.node("box", "note").hidden, false);
  }],
  ["没有布局盒或 CSS 尺寸比边距小时不出现负数", () => {
    assert.equal(review.layerBoxMetrics({}, computed({ display: "contents" })).width, null);
    assert.equal(review.layerBoxMetrics({}, computed({ display: "none" })).height, null);
    assert.equal(review.layerBoxMetrics({}, computed({ width: "1px" })).width, 0);
    assert.equal(review.layerBoxMetrics({}, computed({ borderTopStyle: "none", borderTopWidth: "3px" })).border[0], 0);
  }],
  ["完整字体、Lab 颜色与多段阴影保留文本和 tooltip", () => {
    const font = '"VeryLongProductFontFamilyWithoutSpacesForOverflowCoverage", "PingFang SC", sans-serif';
    const color = "lab(95.8277% -6.25944 18.4191 / 0.875)";
    const shadow = "rgba(0, 0, 0, 0.24) 0px 18px 48px 0px, rgba(255, 255, 255, 0.12) 0px 1px 0px 0px inset";
    const fixture = renderFixture(computed({ fontFamily: font, color, backgroundColor: color, boxShadow: shadow }));
    for (const [key, value] of [["font", font], ["text-color", color], ["background", color], ["shadow", shadow]]) {
      assert.equal(fixture.value(key), value, `${key} 不应截断或错误转换颜色`);
      assert.equal(fixture.node("value", key).title, value);
    }
    assert.equal(fixture.node("value", "text-color").children[0].style["--layer-swatch"], color);
  }],
  ["不适用和不存在的属性隐藏，不填破折号", () => {
    const fixture = renderFixture(computed(), {}, { width: 200, height: 100 }, "");
    for (const key of ["font", "font-size", "line-height", "font-weight", "text-color", "direction", "alignment", "gap", "radius", "shadow", "background-image"]) {
      assert.equal(fixture.node("row", key).hidden, true, key);
      assert.equal(fixture.value(key), "", key);
    }
    assert.equal(fixture.value("opacity"), "100%");
    fixture.instance.renderLayerProperties(null);
    assert.equal(fixture.root.hidden, true, "取消选中必须隐藏旧属性");
  }],
  ["盒模型四方向和值行在 250px 下允许完整换行", () => {
    const markup = review.layerPropertiesMarkup();
    assert.match(markup, /Layer properties/);
    assert.ok(!markup.includes("—"));
    for (const side of ["top", "right", "bottom", "left"]) {
      for (const kind of ["border", "padding"]) assert.ok(markup.includes(`data-layer-box="${kind}-${side}"`));
    }
    const css = review.layerPropertiesStyles();
    assert.match(css, /\.layer-property-row\s*\{[^}]*grid-template-columns:48px minmax\(0,1fr\)/);
    assert.match(css, /\.layer-value-text\s*\{[^}]*min-width:0[^}]*white-space:normal[^}]*overflow-wrap:anywhere/);
    assert.match(css, /\.layer-box-content strong\s*\{[^}]*overflow-wrap:anywhere/);
    assert.ok(!css.includes("text-overflow:ellipsis"));
    assert.ok(!css.includes("white-space:nowrap"));
  }]
];

let failed = 0;
for (const [name, test] of cases) {
  try { test(); console.log(`PASS ${name}`); }
  catch (error) { failed += 1; console.error(`FAIL ${name}\n${error.stack}`); }
}
if (failed) process.exitCode = 1;
console.log(`UIDelta layer properties: ${cases.length - failed}/${cases.length} passed`);
