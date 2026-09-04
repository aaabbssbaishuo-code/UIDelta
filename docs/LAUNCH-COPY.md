# UIDelta 首发文案

以下为可发布草稿；仓库及宣传页地址确认可访问后使用。不包含虚构数据、评价或背书。

## 产品与商店介绍

完整原创介绍见 [产品文案](marketing/STORE-LISTING.zh-CN.md)，含概述、功能、用户、场景、使用方法与实际边界。新版素材索引见 [宣传材料](marketing/README.md)。

## GitHub About

Open-source UI inspection, issue capture and evidence handoff for designers. 本地测量、截图取证与走查交付。

Topics: `chrome-extension`, `ui-inspection`, `design-qa`, `design-tools`, `visual-review`, `javascript`, `local-first`

## 中文首发

我把自己做的 UI 走查工具 UIDelta 开源了。

做设计验收时，发现问题只是第一步。后面还要量尺寸、截图、找位置、解释怎么改，再整理给开发。

UIDelta 把这些动作收在真实网页上：

- 点选元素查看尺寸与样式，按住 Option / Alt 测量间距。
- 按 R 记录问题，自动保留页面全景、元素细节和定位信息。
- 导出 HTML、Excel，或包含 Markdown、JSON 和截图的 ZIP。
- 可以本地试改样式，也能手动导入 Figma JSON 快照查看差异。

不需要账号或 API Key，数据保存在本地。当前是 Chrome 开发者预览版，需要解压加载，在线 Figma 同步与 AI 自动走查还没做。

如果你也经常做 UI 走查，欢迎试用，告诉我哪一步最影响你的效率。

GitHub：https://github.com/aaabbssbaishuo-code/UIDelta
宣传页：https://aaabbssbaishuo-code.github.io/UIDelta/

## 短版

UIDelta 开源了：在真实网页上测量 UI、记录问题，自动保留截图和元素位置，再导出一份可以交给开发的报告。无需账号，本地运行。当前提供 Chrome 开发者预览版，欢迎设计师试用。

## English

I’m open-sourcing UIDelta, a browser-based UI review tool for designers.

Select an element, inspect its dimensions and styles, record the issue, and keep the screenshot evidence and element anchor together. Export HTML, Excel, or a ZIP with Markdown, JSON and images for your existing handoff workflow.

It runs locally, without an account or API key. This is an early Chrome extension preview installed through Developer mode. Online Figma sync and AI scanning are not included; local comparison uses a manually imported design snapshot.

Feedback from designers who do implementation reviews is especially welcome.

## 图像搭配

- GitHub social preview：`brand/social-card.png`（1280×640）
- 社交平台竖版：`brand/launch-poster.png`（1080×1440）
- 产品介绍：`site/assets/product-preview.png`
- 16:9 产品封面：`brand/cover-16x9.png`（1920×1080）
- 16:9 测量 / 记录 / 取证：`brand/feature-inspect-16x9.png`（1920×1080）
- 16:9 前端与 Agent 交付：`brand/feature-delivery-16x9.png`（1920×1080）
- 所有示例均使用虚构项目和页面。插件面板由 2026-09-04 当前源码渲染，替换了旧版示意界面。

## Agent 交付短文案

走查完，把问题打包交付。HTML 用于团队查看，XLSX 用于排期；ZIP 带上问题描述、页面、元素锚点和截图，交给具备项目源码的 Agent，依据证据定位问题、修改并复核。
