# UIDelta v0.9.4 · 开源预览版

每一处偏差，都有据可查。

UIDelta 是为 UI 设计师打造的浏览器走查工具。直接在真实页面上测量尺寸和间距、记录问题，自动保留截图和元素位置，然后把完整证据交给开发。

## 下载

- **UIDelta-v0.9.4.zip**：可安装插件。解压后在 `chrome://extensions` 开启开发者模式，加载其中的 `UIDelta` 文件夹。
- **UIDelta-brand-kit.zip**：Logo、插件图标、1280×640 宣传图、1080×1440 海报及可编辑源文件。
- **SHA256SUMS.txt**：两个 ZIP 的 SHA-256 校验值。

## 当前能力

元素尺寸和样式检查、Option / Alt 测距、本地样式试改、元素或框选记录、截图证据、问题列表、手动导入 Figma JSON 快照对比，以及 HTML / Excel / ZIP 导出。

无需账号与 API Key，走查数据保存在扩展本地。完整权限说明见仓库 `PRIVACY.md`。

## 预览版边界

尚未上架 Chrome Web Store；在线 Figma 同步、AI 自动走查、项目管理平台直连与源码修改未接入。当前面向 Chrome 的解压加载方式发布。

四组现有回归测试、源码语法检查、打包检查及宣传页浏览器交互验证已通过。真实扩展的截图、持久化与多格式导出仍需按 `docs/QA.md` 做完整人工验收；不将测试页中的模拟桥接视为浏览器 API 验收。

English: UIDelta is an open-source UI review tool for designers. Inspect real pages, capture issues with evidence and hand reports to your existing workflow. This is an early, locally running Chrome extension preview, installed through Developer mode. Online Figma sync and AI scanning are not included.
