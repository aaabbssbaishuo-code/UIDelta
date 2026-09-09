# UIDelta · Chrome 应用商店上架准备

检查日期：2026-09-05。当前为候选上传包，尚未提交审核或发布。

## 费用与开源

- Chrome Web Store 开发者账号需要一次性注册费。Google 官方公布的金额为 5 美元，实际以注册结算页为准。
- 账号注册费、插件是否向用户收费、源码是否开源，是三件独立的事。UIDelta 可以免费供用户安装，并继续采用现有 MIT 许可证。
- 商店不要求开发者必须开源；当前 UIDelta 本身已经采用 MIT。上架不会自动改变许可证。

来源：[注册说明](https://developer.chrome.com/docs/webstore/register)、[官方费用说明](https://blog.chromium.org/2020/03/new-developer-dashboard-and.html)。

## 上传包

文件：`release/webstore/UIDelta-v0.9.4-chrome-web-store.zip`

重新生成：

```sh
npm run build:webstore
```

新脚本仅打包运行文件、图标、内置示例图与 LICENSE，不包含测试数据、开发文件或用户走查数据。`manifest.json` 位于 ZIP 根目录。原有供用户解压安装的 ZIP 保持不变，不要混用。

已检查：

- Manifest V3、名称、版本与说明字段。
- 运行文件引用、图标和示例图文件齐全。
- ZIP 完整性检查通过；16 个文件，约 0.66 MiB。
- `npm run check` 通过。

这不代表已经通过 Google 审核，也不代替真实浏览器验收。

## 后台填写材料

### 基础信息

- 当前包名称：UIDelta · UI 走查记录
- 当前版本：0.9.4
- 当前简短说明：面向 UI 设计师的页面走查、问题记录与证据导出工具。
- 详细介绍可参考 `docs/marketing/STORE-LISTING.zh-CN.md`；该文件的名称是文案提案，实际上传名称来自 manifest。如需改名，应同步修改 manifest 后重新打包。
- 单一用途：在用户选择的网页上进行视觉走查，查看元素样式与间距，记录问题和截图，并导出走查证据供协作处理。
- 建议分类：开发者工具，最终选择以后台实际可用分类为准。

站点和联系方式：

- 官网：https://tu-dot.github.io/UIDelta/
- 源码：https://github.com/tu-dot/UIDelta
- 支持：https://github.com/tu-dot/UIDelta/issues
- 隐私政策：https://tu-dot.github.io/UIDelta/privacy.html
- 联系邮箱：由账号所有者填写并完成验证，不自动代填私人邮箱。

提交前需人工确认以上公开页面可访问、内容与当前版本一致。

### 图片材料（待完成）

- 应用图标：128 × 128 PNG；现有文件为 `extension/icons/icon-128.png`，提交前复核清晰度与官方留白规范。
- 小型宣传图：440 × 280，必需。
- 功能截图：至少 1 张、最多 5 张，建议 1280 × 800；也支持 640 × 400。
- 大型宣传图：1400 × 560，可选。

现有 `brand/screenshots/` 是先前版本的演示页面截图，并非全部符合商店尺寸。需要刷新为当前版本、使用无敏感数据的真实使用画面后制作素材。不要直接将旧图标注为最新版本实测截图。

建议三张截图分别展示「查看与测量」「记录问题」「导出与协作」。不用竞品截图、评价或品牌代替自己的素材。

来源：[商店图片规范](https://developer.chrome.com/docs/webstore/images)。

### 权限用途草稿

以下说明应与最终代码一致；不能为了审核虚构用途。提交前还需要复核是否可以进一步收窄权限。

| 权限 | 当前用途 |
| --- | --- |
| activeTab | 用户主动启动走查后，对当前网页执行检查与可见区域截图。 |
| scripting | 注入随扩展一起打包的本地检查脚本，唤起走查界面。 |
| storage | 保存当前走查会话的临时状态。 |
| tabs | 读取走查页面的 URL、标题和状态，关联页面与问题记录。 |
| downloads | 用户主动导出 HTML、XLSX 或 ZIP，并获取下载状态。 |
| unlimitedStorage | 在本地保存多条走查记录及截图，避免受默认存储额度限制。 |
| `<all_urls>` | 在用户选择的不同网站运行视觉检查脚本与页面关联功能；本地文件访问仍需用户在 Chrome 单独允许。 |

当前代码存在跨网站主机权限与自动注入配置。隐私说明不应写成「只有点击时扩展才可能接触页面」；要准确说明脚本运行范围、何时记录数据，以及本地存储行为。

### 隐私与代码声明

- 走查可涉及页面 URL、标题、元素文字、样式、描述、截图与用户提供的参考图；不能简单填写「不处理任何数据」。按照后台对“收集/处理”的定义如实填写。
- 当前实现将走查数据保存在浏览器本地，用户主动导出文件；未发现向开发者服务器发送这些内容的实现。
- 当前运行脚本均随扩展打包，未发现远程加载并执行 JavaScript 的实现。
- 隐私文档中关于 `fetch` 的描述需要覆盖本地 data URL 和扩展内置示例图片，不应仅写 data URL。
- 公开隐私政策、后台声明、商店介绍和实际行为必须一致。

来源：[隐私信息填写说明](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy)。

## 审核操作说明草稿

无需账号或 API Key。使用任意普通 HTTP/HTTPS 测试网页，不在 Chrome 内部页或 Chrome 应用商店页测试。

1. 安装后打开普通网页，点击扩展按钮，或使用 Alt + Shift + I 启动走查。
2. 点选网页元素，查看尺寸、字体、颜色与间距。
3. 按 R 记录问题，填写描述后保存；检查问题数量与清单记录。
4. 打开交付面板，分别导出 HTML、XLSX 和 ZIP，打开文件检查文字与截图。
5. 在问题清单中删除测试记录，验证本地记录与关联证据的清理。

正式提交前需用候选包完成上述实机验收，特别检查截图授权、页面及内层滚动定位、保存与删除、三种导出和离线 HTML 图片切换。开发测试通过不等于这些真实扩展行为已验收。

## 发布流程

1. 使用长期保留的 Google 账号进入 [开发者后台](https://chrome.google.com/webstore/devconsole/)。
2. 账号所有者完成注册、相关协议确认、费用支付和联系邮箱验证，并开启 Google 账号两步验证。
3. 新建项目，上传本说明中的商店专用 ZIP。
4. 填写介绍、图片、隐私与权限用途、分发区域和审核操作说明。
5. 完成真实扩展验收并复核所有声明后，由账号所有者确认提交审核。首次可以选择审核通过后手动发布。

不要把“保存草稿”当作“已经上架”。只有审核通过并发布后，才会出现可供其他用户安装的正式商店页面。注册付款、协议确认和最终发布都尚未执行。

来源：[准备扩展包](https://developer.chrome.com/docs/webstore/prepare)、[发布流程](https://developer.chrome.com/docs/webstore/publish/)、[开发者政策](https://developer.chrome.com/docs/webstore/program-policies/policies)。
