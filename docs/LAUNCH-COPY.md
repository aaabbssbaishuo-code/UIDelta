# UIDelta 发布文案

## GitHub About

看见问题。说清怎么改。在真实网页上测量、记录、取证，把修改依据交给前端和 Agent。开源 Chrome 走查工具。

## 中文发布正文

看见问题。说清怎么改。

我把自己做的网页走查工具 UIDelta 开源了。

做页面验收时，发现「这里不对」并不难。难的是把它说清：哪个元素，差了多少，要改成什么。

所以我把三件事放到了一起：

- 差多少，直接在真实网页上量。
- 写下问题，截图和元素位置一起保存。
- 导出报告，把修改依据交给前端和 Agent。

HTML 用来查看、跟进。XLSX 用来整理、排期。ZIP 带上报告、元素定位与截图，交给项目里的 Agent，结合源码继续处理。

把一句「这里不对」，变成一份开发看得懂的走查报告。

免费开源，无需账号，数据留在本地。当前是 v0.9.4 开发者预览版，需要在 Chrome 中手动加载。

欢迎拿一个真实页面试试，也欢迎把不顺手的地方告诉我。

官网：https://aaabbssbaishuo-code.github.io/UIDelta/
GitHub：https://github.com/aaabbssbaishuo-code/UIDelta

Agent 处理需要项目源码、运行环境和修改授权；完成后仍需复核。

## 中文短版

我把 UIDelta 开源了。

在真实网页上测量、记录、取证，把一句「这里不对」，变成一份开发看得懂的走查报告。HTML 看问题，XLSX 排修改，ZIP 交给前端和 Agent。

免费使用，无需账号，数据留在本地。当前为开发者预览版，通过 Chrome 手动加载。

https://github.com/aaabbssbaishuo-code/UIDelta

## English launch post

See the issue. Make the fix clear.

I've open-sourced UIDelta, a tool for reviewing real web pages.

Finding something that looks wrong is the easy part. Explaining exactly where it is and what should change takes more work.

UIDelta brings three steps together: measure the page, record the issue with screenshots and element anchors, then hand the evidence to someone who can fix it.

Share an HTML report, organize fixes in XLSX, or give a ZIP to a developer or coding agent working in your project. The agent needs source access, a runnable environment and permission to edit. Changes still need to be checked.

Free and open source. No account. Review data stays in your browser. v0.9.4 is a developer preview installed as an unpacked Chrome extension.

Try it on a page you're reviewing. I'd like to hear where it helps and where it gets in the way.

https://github.com/aaabbssbaishuo-code/UIDelta

## 配图顺序

1. `brand/cover-16x9.png` — 看见问题。说清怎么改。
2. `brand/feature-inspect-16x9.png` — 差多少，直接量。
3. `brand/feature-delivery-16x9.png` — 记录一次，接着改。
4. `brand/feature-developer-16x9.png` — 让 Codex，接着改。

四张均为 1920×1080。GitHub 社交预览使用 `brand/social-card.png`；竖版发布使用 `brand/launch-poster.png`。更多文件见 [素材索引](marketing/README.md)。

## 面向前端的发布正文

让 Codex，接着改。

前端拿到设计反馈，往往要先找页面、认元素、确认目标，再把上下文重新讲给 AI。

UIDelta 把这些依据跟着问题一起打包：页面 URL、DOM 选择器、元素文本、实测样式、截图和修改要求。

收到 ZIP，放进项目，告诉 Codex 路径。让它读取报告、验证对应实现，按要求修改，再回到页面复核。

少找一遍。少猜一轮。少拼一次上下文。

免费开源，走查数据保存在本地。Codex 需要项目源码、运行环境与修改授权；UIDelta 提供网页定位线索，不是预先确定的源码行号。暂不承诺提效比例或自动修复成功率。

https://github.com/aaabbssbaishuo-code/UIDelta#for-developers

配图：`brand/feature-developer-16x9.png`，1920×1080。研究依据见 [开发者交付调研](marketing/DEVELOPER-HANDOFF-RESEARCH.zh-CN.md)。
