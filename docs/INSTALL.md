# 安装 UIDelta / Install UIDelta

UIDelta v0.9.4 是开发者预览版，通过 Chrome 加载已解压扩展安装，尚未上架 Chrome Web Store。

1. 下载并解压 `UIDelta-v0.9.4.zip`。
2. 在 Chrome 地址栏输入 `chrome://extensions`。
3. 开启页面右上角的「开发者模式 / Developer mode」。
4. 点击「加载已解压的扩展程序 / Load unpacked」。选择包含 `manifest.json` 的 **UIDelta** 文件夹。使用 Git 源码则选择 **extension/**。
5. 在工具栏的扩展菜单中固定 UIDelta。刷新要走查的网页，再点 UIDelta 图标。
6. 也可使用 `Alt / Option + Shift + I` 开关插件。

更新时覆盖原扩展文件夹，再在扩展管理页点击「重新加载」并刷新网页。不要把 ZIP 直接拖入扩展管理页。卸载扩展会删除其本地走查数据，更新前建议先导出重要记录。

## 常见情况

- **打不开？** 确认选择的文件夹内直接包含 `manifest.json`。
- **旧网页没有反应？** 安装或重新加载插件后刷新页面。
- **网页按钮点不了？** 走查模式会拦截选择操作；按住 Space 临时恢复网页交互。
- **本地 HTML？** 在扩展详情中开启「允许访问文件网址」。
- **受保护页面？** `chrome://` 和 Chrome Web Store 页面不能注入。
- **快捷键冲突？** 在 `chrome://extensions/shortcuts` 中调整。
- **书签入口？** 仓库的 `ui-lens-bookmarklet/install.html` 提供可选入口；严格 CSP 页面请使用工具栏图标。

## English quick start

Unzip the release, open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select the `UIDelta` folder containing the manifest. Pin the extension and refresh the webpage. From a source checkout, select `extension/` instead. Updating code requires reloading the extension and refreshing the page. Review data is stored locally and is removed when the extension is uninstalled.
