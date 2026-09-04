# UIDelta 宣传材料

**看见问题。说清怎么改。**

对外发布从这里选文案、取图片。PNG 可直接使用，HTML / CSS / SVG 用于继续编辑。

## 先取文案

| 需要什么 | 文件 |
| --- | --- |
| 统一主张、标题与表达边界 | [文案基准](COPY-GUIDE.zh-CN.md) |
| 社交发布、中英文介绍、GitHub About | [发布文案](../LAUNCH-COPY.md) |
| Chrome 商店介绍 | [商店文案](STORE-LISTING.zh-CN.md) |
| 产品定义与功能事实 | [产品定义](../PRODUCT.md) |
| 前端与 Agent 交接说明 | [Agent 交接](../AGENT-HANDOFF.md) |

## 再选图片

| 用途 | 尺寸 | PNG / 可编辑源文件 |
| --- | --- | --- |
| 产品封面 | 1920×1080 · 16:9 | [PNG](../../brand/cover-16x9.png) / [HTML](../../brand/cover-16x9.html) |
| 测量、记录、取证 | 1920×1080 · 16:9 | [PNG](../../brand/feature-inspect-16x9.png) / [HTML](../../brand/feature-inspect-16x9.html) |
| HTML、XLSX、ZIP 交付 | 1920×1080 · 16:9 | [PNG](../../brand/feature-delivery-16x9.png) / [HTML](../../brand/feature-delivery-16x9.html) |
| GitHub 社交预览 | 1280×640 | [PNG](../../brand/social-card.png) / [HTML](../../brand/social-card.html) |
| 竖版发布海报 | 1080×1440 | [PNG](../../brand/launch-poster.png) / [HTML](../../brand/launch-poster.html) |
| 三种交付悬浮图 | 270×164 / 540×328 | [PNG 与 SVG](../../brand/delivery-previews/) |
| Logo、字标 | SVG 与多尺寸 PNG | [品牌文件](../../brand/README.md) |
| 实际产品界面 | 全景、面板、测量画面 | [截图与来源](../../brand/screenshots/README.md) |

主画面使用正视界面和标注。示例网页与记录数据为虚构内容，真实产品 UI 的来源见截图目录。

## 完整下载

- [在线预览](https://aaabbssbaishuo-code.github.io/UIDelta/press.html)
- [完整宣传包](https://aaabbssbaishuo-code.github.io/UIDelta/downloads/UIDelta-marketing-kit.zip)：图片、Logo、截图、可编辑源文件、文案和素材索引。
- [三张 16:9 组图](https://aaabbssbaishuo-code.github.io/UIDelta/downloads/UIDelta-promo-16x9.zip)
- [三种交付预览](https://aaabbssbaishuo-code.github.io/UIDelta/downloads/UIDelta-delivery-previews.zip)

## 维护

修改宣传排版后，用 `scripts/render-marketing.cjs --art-only` 导出图片；脚本需要本机的 Playwright 与 Chrome。重新采集产品界面时，去掉 `--art-only`。素材源文件保留相对路径依赖，单独分享一个 HTML 时需同时附上 CSS、Logo 和截图目录。

运行 `npm run build` 重建下载 ZIP 与 `_site/`。提交宣传源文件后，GitHub Pages 工作流会重新部署官网和下载包。

官网入口：`site/index.html`；素材下载页：`site/press.html`；品牌页：`site/brand.html`。图片固定文件名，方便 GitHub README 与官网同步更新。
