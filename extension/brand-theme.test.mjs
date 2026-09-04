import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("./content.js", import.meta.url), "utf8");
const popup = await readFile(new URL("./popup.css", import.meta.url), "utf8");
const start = source.indexOf("  const ROOT_ATTRIBUTE");
const end = source.indexOf("  const review = new UIDeltaReview();");
assert.ok(start >= 0 && end > start);
const context = vm.createContext({});
vm.runInContext(source.slice(start, end) + "\nglobalThis.Review = UIDeltaReview;", context);
const review = Object.create(context.Review.prototype);
const theme = review.brandThemeStyles();
const token = (name) => theme.match(new RegExp(`--ud-${name}:([^;]+);`))?.[1].trim();

test("橙色和灰绿层级使用参考图的取色，弹窗与浮层一致", () => {
  const expected = {
    canvas: "#1b1d1c", surface: "#222423", elevated: "#2e312c",
    accent: "#f2603d", border: "#3a3e35", "border-strong": "#606958",
    text: "#f2f3ed", "text-secondary": "#c1c6b8", "text-muted": "#adb5a2"
  };
  for (const [name, value] of Object.entries(expected)) {
    assert.equal(token(name), value);
    assert.ok(popup.includes(`--${name}: ${value};`));
  }
});

const luminance = (hex) => {
  const channels = hex.slice(1).match(/../g).map((channel) => parseInt(channel, 16) / 255)
    .map((value) => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
  return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
};
const contrast = (a, b) => {
  const values = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (values[0] + .05) / (values[1] + .05);
};

test("正文、辅助文字及橙色主按钮文字达到 4.5:1 对比度", () => {
  for (const background of ["surface", "elevated", "inset", "selected"]) {
    for (const foreground of ["text", "text-secondary", "text-muted"]) {
      assert.ok(contrast(token(background), token(foreground)) >= 4.5, `${background}/${foreground}`);
    }
  }
  assert.ok(contrast(token("accent"), token("on-accent")) >= 4.5);
  assert.ok(contrast(token("accent-hover"), token("on-accent")) >= 4.5);
});

test("主题最后加载，覆盖旧主按钮、选项、工具栏及焦点配色", () => {
  const calls = source.slice(source.indexOf('"<style>"'), source.indexOf('"</style>"'));
  assert.ok(calls.indexOf("this.brandThemeStyles()") > calls.indexOf("this.reviewWorkflowStyles()"));
  assert.match(theme, /\.ui-editor-footer \.primary-button[^}]*background:var\(--ud-accent\)!important/);
  assert.match(theme, /\.mode-toolbar button.active[^}]*background:var\(--ud-selected\)/);
  assert.match(theme, /\.composer-choice \.segment.active[^}]*background:var\(--ud-accent-soft\)!important/);
  assert.match(theme, /button:focus-visible[^}]*outline:2px solid var\(--ud-focus\)!important/);
  assert.match(theme, /\.issue-select:checked[^}]*background:var\(--ud-accent\)/);
  assert.match(theme, /\.delivery-card:hover[^}]*background:var\(--ud-hover\)/);
  assert.doesNotMatch(theme, /#7187f5|#5265ce|#a5b1ff|#292b31|#202126/);
});

test("主题不改变面板尺寸、输入行为或页面实测颜色", () => {
  assert.equal(token("radius"), "4px");
  assert.equal(token("panel-radius"), "8px");
  assert.doesNotMatch(theme, /\b(?:width|height|pointer-events|display):/);
  assert.doesNotMatch(theme, /(?:\.layer-color-swatch|\.ui-color-swatch>span)\s*\{/);
  assert.match(theme, /\.ui-number-control input:focus[^}]*background:transparent!important/);
  assert.match(theme, /input\[type='range'\]\.ui-opacity-range[^}]*background:transparent!important/);
  assert.ok(review.composerChoicesMarkup().includes("role='radiogroup'"));
  assert.doesNotMatch(review.composerChoicesMarkup(), /<select/);
});
