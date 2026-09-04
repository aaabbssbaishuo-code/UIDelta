# UIDelta 宣传材料入口

更新：2026-09-04。宣传图中的插件面板已替换为当前 UIDelta 源码渲染的橙色／灰绿新版界面。示例网页为虚构的 Orbit 工作空间。

## 直接使用

| 材料 | 文件 | 尺寸／用途 |
| --- | --- | --- |
| 产品封面 | [cover-16x9.png](../../brand/cover-16x9.png) | 1920 × 1080，产品介绍首图 |
| 测量、记录、取证 | [feature-inspect-16x9.png](../../brand/feature-inspect-16x9.png) | 1920 × 1080，核心功能一 |
| 前端与 Agent 交付 | [feature-delivery-16x9.png](../../brand/feature-delivery-16x9.png) | 1920 × 1080，核心功能二 |
| GitHub 社交预览 | [social-card.png](../../brand/social-card.png) | 1280 × 640 |
| 竖版发布海报 | [launch-poster.png](../../brand/launch-poster.png) | 1080 × 1440 |
| Logo 与字标 | [品牌素材](../../brand/README.md) | SVG / PNG |
| 三种交付悬浮图 | [delivery-previews](../../brand/delivery-previews/README.md) | 270 × 164 / 540 × 328 / SVG |
| 新版界面截图 | [screenshots](../../brand/screenshots/README.md) | 测量、记录、交付、工具栏 |
| 产品与商店介绍 | [STORE-LISTING.zh-CN.md](STORE-LISTING.zh-CN.md) | 标题、短描述、完整介绍草稿 |
| 首发与社交文案 | [LAUNCH-COPY.md](../LAUNCH-COPY.md) | 中英文、长短版本 |
| Agent 使用说明 | [AGENT-HANDOFF.md](../AGENT-HANDOFF.md) | ZIP 内容与可复制提示词 |

## 网页入口

- `site/index.html`：产品首页，支持切换查看新版测量／记录／交付界面。
- `site/press.html`：宣传资料页，集中预览与下载。
- `site/brand.html`：Logo 与品牌用法。
- `brand/delivery-previews/index.html`：三种交付方式的悬浮示例。

## 文件约定

保持现有五张成图文件名不变，旧的网页和下载链接继续引用最新设计。同名 HTML 与 CSS 为编辑源文件；`brand/screenshots/` 提供所引用的面板图；`brand/source/` 提供虚构网页源文件。旧稿可通过 Git 历史查看，发布目录只保留现稿。

生成方式见 [品牌文档](../../brand/README.md)。`npm run build` 输出：

- `UIDelta-promo-16x9.zip`：三张成图、编辑源文件和必要截图。
- `UIDelta-brand-kit.zip`：完整品牌资产及其子目录。
- `UIDelta-delivery-previews.zip`：三种交付悬浮预览图与演示。
- `UIDelta-marketing-kit.zip`：宣传资产、发布文案、使用说明与素材索引，保留仓库相对路径。

## 发布状态

材料就绪不等于已经公开发布。GitHub、Releases、官网和 Chrome 商店状态应以实际发布结果为准。当前仍使用 v0.9.4 开发者预览版，不因宣传设计更新而虚构新版本号。
