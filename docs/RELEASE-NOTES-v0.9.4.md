# UIDelta v0.9.4 · 开源预览版

看见问题。说清怎么改。

UIDelta 是为 UI 设计师打造的浏览器走查工具。直接在真实页面上测量尺寸和间距、记录问题，自动保留截图和元素位置，然后把完整证据交给开发。

## 下载

- **UIDelta-v0.9.4.zip**：可安装插件。解压后在 `chrome://extensions` 开启开发者模式，加载其中的 `UIDelta` 文件夹。
- **UIDelta-brand-kit.zip**：Logo、插件图标、1280×640 宣传图、1080×1440 海报及可编辑源文件。
- **UIDelta-promo-16x9.zip**：四张 1920×1080 宣传图，包含前端 / Codex 专题，附可编辑源文件、交接提示词和调研依据。
- **UIDelta-delivery-previews.zip**：HTML、XLSX、ZIP 三种交付预览图片与可编辑源文件。
- **UIDelta-marketing-kit.zip**：完整宣传材料、文案、调研、Logo 和可编辑图片源文件。
- **SHA256SUMS.txt**：五个 ZIP 的 SHA-256 校验值。

## 2026-09-04 更新

- 统一紧凑编辑器主题、固定操作区、交付示例与保存反馈。
- 修复跨页草稿、截图与参考图上传、保存和异常恢复流程。
- 问题清单支持可取消倒计时删除与清空，同步清理所属附件。
- HTML 离线报告新增状态筛选、完成进度和支持键盘操作的图片预览。
- XLSX 优先展示证据，改进跟进字段、数值与长文本的导出。

## 2026-09-09 更新

- 已记录问题的编号标记在浏览、切换模式、滚动和路由变化时持续显示并更新位置。
- 改进模式切换、返回走查和框选记录，减少焦点丢失与草稿中断。
- 问题说明与结果参考分别保存文字和图片，并贯通 HTML、XLSX 与 ZIP 交付。
- 新增 Chrome 应用商店候选包构建；原有解压安装包继续保留。
- 仓库与官网地址迁移到 `tu-dot/UIDelta`，公开作者名更新为“土墩”。

## 当前能力

元素尺寸和样式检查、Option / Alt 测距、本地样式试改、元素或框选记录、截图证据、问题列表、手动导入 Figma JSON 快照对比，以及 HTML / Excel / ZIP 导出。

无需账号与 API Key，走查数据保存在扩展本地。完整权限说明见仓库 `PRIVACY.md`。

## 预览版边界

尚未上架 Chrome Web Store；在线 Figma 同步、AI 自动走查、项目管理平台直连与源码修改未接入。当前面向 Chrome 的解压加载方式发布。

179 项自动测试、源码语法与资源检查、打包检查已通过。真实扩展的截图、持久化与多格式导出仍需按 `docs/QA.md` 做完整人工验收；不将测试页中的模拟桥接视为浏览器 API 验收。

English: UIDelta is an open-source UI review tool for designers. Inspect real pages, capture issues with evidence and hand reports to your existing workflow. This is an early, locally running Chrome extension preview, installed through Developer mode. Online Figma sync and AI scanning are not included.
