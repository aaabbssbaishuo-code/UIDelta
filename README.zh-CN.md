<p align="center"><img src="brand/icon-256.png" width="80" alt="UIDelta Logo"></p>
<h1 align="center">UIDelta</h1>
<p align="center"><strong>每一处偏差，都有据可查。</strong><br>为 UI 设计师打造的开源浏览器走查工具。</p>
<p align="center"><a href="README.md">English</a> · <a href="https://aaabbssbaishuo-code.github.io/UIDelta/">官网与交互演示</a> · <a href="https://aaabbssbaishuo-code.github.io/UIDelta/downloads/UIDelta-v0.9.4.zip">下载插件</a> · <a href="LICENSE">MIT 开源协议</a></p>

![UIDelta 新版产品封面](brand/cover-16x9.png)

发现页面与设计不一致时，不必再分别截图、找位置、记尺寸。UIDelta 把**测量、问题描述、截图和元素定位**收进同一条走查记录，再导出交给开发，或接入现有的整理流程。

**当前版本：v0.9.4 开发者预览版。** 通过 Chrome「加载已解压的扩展程序」安装，尚未上架扩展商店。上图的插件界面由当前源码渲染，使用虚构项目演示。

## 从发现，到交付

| 在真实页面上留下证据 | 带着证据交给前端与 Agent |
| --- | --- |
| ![测量、记录、取证](brand/feature-inspect-16x9.png) | ![HTML、XLSX 与 ZIP 交付](brand/feature-delivery-16x9.png) |

新版采用橙色／灰绿面板、紧凑工具栏、展开式记录选项和交付悬浮示例。完整图片、截图与文案见 [宣传材料](docs/marketing/README.md)。

## 已实现

| 环节 | 能力 |
| --- | --- |
| 测量与检查 | 点选元素查看宽高、盒模型、字体、颜色等；Option / Alt 测距 |
| 本地试改 | 预览尺寸、间距、字体、颜色、圆角及支持的文本修改，可撤销 |
| 记录与取证 | 选中元素或框选区域；保存描述、截图、元素锚点与样式 |
| 问题管理 | 页面编号、列表检索、筛选、编辑、删除与页面定位 |
| 本地设计对比 | 手动导入 Figma JSON 快照，对比设计值、实际值与差值，显示匹配置信度 |
| 交付导出 | HTML 报告、Excel 表格，或含 Markdown、JSON、截图的 ZIP |

无需账号、后端或 API Key。当前版本不发送外部网络请求，数据保存在扩展本地 IndexedDB。具体权限和数据边界见 [隐私说明](PRIVACY.md)。

## 安装

1. 从 [公开下载地址](https://aaabbssbaishuo-code.github.io/UIDelta/downloads/UIDelta-v0.9.4.zip) 下载 `UIDelta-v0.9.4.zip` 并解压。
2. 打开 `chrome://extensions`，开启「开发者模式」。
3. 点击「加载已解压的扩展程序」，选择解压后包含 `manifest.json` 的 **UIDelta** 文件夹。
4. 固定插件到工具栏，刷新待走查的网页，点击 UIDelta 图标开始。

使用源码时，直接加载仓库内的 **extension** 文件夹，无需安装 npm 依赖。详细步骤见 [安装指南](docs/INSTALL.md)。

## 一次完整走查

1. 开启 UIDelta，开始本次走查。
2. 点击目标元素；需要测距时按住 Option / Alt。
3. 按 **R** 写下问题描述，等待证据准备完成后保存。
4. 在问题列表整理记录，导出交付文件。

| 操作 | 快捷键 |
| --- | --- |
| 开关 UIDelta | Option / Alt + Shift + I |
| 查看元素间距 | 按住 Option / Alt |
| 穿透选择元素 | 按住 Command / Ctrl |
| 记录问题 | R |
| 打开问题列表 | I |
| 临时操作原网页 | 按住 Space |
| 保存问题 | Command / Ctrl + Enter |
| 关闭当前面板 | Esc |

## 开发与打包

需要 Node.js 22+。项目没有 npm 依赖。

```sh
git clone https://github.com/aaabbssbaishuo-code/UIDelta.git
cd UIDelta
npm run check
npm test
npm run build
npm start
```

宣传页预览地址为 `http://127.0.0.1:4173`。插件和品牌 ZIP 输出到 `release/`，可部署网页输出到 `_site/`。修改扩展源码后，在扩展管理页重新加载并刷新目标网页。

## 当前边界

- 在线 Figma 同步、AI 自动走查、项目管理平台直连和源码定位尚未实现。
- 设计对比需要手动准备 JSON 快照，并非粘贴 Figma 链接后自动获取。见 [快照说明](docs/DESIGN-COMPARE.md)。
- 本地试改只影响当前页面预览，不会改动网站源代码。
- 无法注入 Chrome 内部页面、扩展商店等受保护页面。
- 跨域 iframe、封闭 Shadow DOM、伪元素和 Canvas 内部对象不能独立选择。
- 走查 `file://` 页面需开启「允许访问文件网址」。
- 测试页使用模拟桥接，真实截图、存储和下载仍需在浏览器中验证，见 [QA 说明](docs/QA.md)。

欢迎 [提交问题](https://github.com/aaabbssbaishuo-code/UIDelta/issues) 或贡献代码。参阅 [贡献指南](CONTRIBUTING.md)、[路线图](ROADMAP.md) 和 [品牌素材](brand/README.md)。

想把 ZIP 交给编码 Agent？参阅 [Agent 交接说明与可复制提示词](docs/AGENT-HANDOFF.md)。需要结合项目源码、运行环境和修改授权来定位、修改并复核。宣传素材包含三张 1920×1080 产品与功能页。

作者：[白土墩 / aaabbssbaishuo-code](https://github.com/aaabbssbaishuo-code) · [MIT License](LICENSE)
