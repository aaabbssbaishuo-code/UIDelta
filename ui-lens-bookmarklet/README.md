# UIDelta 书签入口

这个目录提供 UIDelta 的书签栏唤醒入口。书签本身不再内嵌走查工具，而是向当前页面发送一条本地消息，由 `ui-inspection-lens` Chrome 扩展开启或关闭 UIDelta。

这种结构保留了「点击书签进入走查」的使用习惯，同时让扩展负责第一期所需的截图、问题记录与本地存储能力。

## 开发期安装

目前需要先加载本地扩展，再安装书签：

1. 在 Chrome 地址栏打开 `chrome://extensions`。
2. 开启「开发者模式」，点击「加载已解压的扩展程序」。
3. 选择同级目录中的 `ui-inspection-lens` 文件夹，确认 UIDelta 已启用。
4. 用 Chrome 打开本目录的 `install.html`。
5. 将紫色的「UIDelta」按钮拖到浏览器书签栏。

如果书签栏未显示，在 macOS Chrome 中按 `⌘ + Shift + B`；Windows/Linux 使用 `Ctrl + Shift + B`。

## 使用

- 在普通网页中点击书签栏的「UIDelta」即可唤醒或切换走查模式。
- 如果页面右下角提示扩展未响应，请确认扩展已启用，并刷新当前网页后重试。
- Chrome 设置页、扩展管理页和 Chrome 网上应用店等受保护页面不允许书签脚本或扩展内容脚本运行。

书签只是轻量触发器，不检查元素，也不会读取或上传页面内容。

## 消息协议

书签通过 `window.postMessage` 发送：

```js
{
  source: "uidelta-bookmark",
  type: "UIDELTA_TOGGLE",
  requestId: "<unique id>",
  version: 1
}
```

扩展的 content script 应在处理请求后向同一页面回复：

```js
{
  source: "uidelta-extension",
  type: "UIDELTA_TOGGLE_ACK",
  requestId: "<same unique id>",
  enabled: true
}
```

`enabled` 表示 UIDelta 在本次切换后的启用状态。

如果 900ms 内没有收到对应 ACK，书签会显示一个约 6 秒后自动消失的小提示，引导用户安装或启用扩展。

## 开发

修改 `bookmarklet.js` 或安装页模板后运行：

```sh
node build-bookmarklet.mjs
```

命令会重新生成 `install.html`。提交前请同时检查触发器与生成脚本：

```sh
node --check bookmarklet.js
node --check build-bookmarklet.mjs
```
