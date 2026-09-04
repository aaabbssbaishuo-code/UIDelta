# UIDelta brand kit

**每一处偏差，都有据可查。 / Every UI difference deserves clear evidence.**

The mark combines a selected region, three square anchor handles and an annotation note. The note's lower tail links the observation back to the page. It is intended to read as “select and annotate” at a glance.

## Assets

- `icon.svg`: orange rounded-square app icon, 64×64 viewBox
- `mark.svg`: orange symbol on a transparent background
- `mark-dark.svg`, `mark-light.svg`: monochrome symbols
- `wordmark.svg`, `wordmark-light.svg`: horizontal SVG lockups (text uses local Inter/Arial fallback)
- `icon-256.png`, `icon-512.png`, `icon-1024.png`: raster app icons
- `social-card.png`: 1280×640 share graphic
- `launch-poster.png`: 1080×1440 Chinese launch poster
- `social-card.html`, `launch-poster.html`: editable sources for the graphics
- `cover-16x9.png`: 1920×1080 product cover
- `feature-inspect-16x9.png`: 1920×1080 measurement, recording and evidence page
- `feature-delivery-16x9.png`: 1920×1080 HTML/XLSX/ZIP and Agent handoff page
- Matching `*-16x9.html` files and `campaign-16x9.css`: editable campaign sources

The three 16:9 graphics share the updated annotation identity. The delivery visual follows the product's three output routes and shows an illustrative Agent workflow. It requires project source and a runtime; the graphic does not claim that the ZIP alone can automatically fix a website.

The browser extension contains 16, 32, 48 and 128px PNG icons under `extension/icons/`. All PNGs were rendered from project-owned vector or HTML sources; no stock photography or remote font dependency is used.

## Design tokens

| Token | Value | Purpose |
| --- | --- | --- |
| Delta Orange | `#F2603D` | Mark, measurements, primary action |
| Graphite | `#272A28` | Primary text and dark surfaces |
| Paper | `#F8F8F4` | Main background |
| Sage | `#7B8969` | Secondary demonstration content |

Keep clear space of at least one quarter of the icon's width. Use the app icon at 16px or larger, the standalone mark at 24px or larger, and the horizontal lockup at 130px or larger. Do not distort the geometry or place the light mark on a light background.

Use the official product name **UIDelta**, with UI and D capitalized. The existing product interface uses its own established tokens; branding changes are deliberately limited to assets and the public site.

Brand assets are included under the repository's MIT license. When redistributing a modified product, make the modification and its author clear so users can identify its origin.

## 2026-09-04 新版宣传材料

[宣传材料总入口](../docs/marketing/README.md)集中列出五张成图、交付悬浮图、当前界面截图与发布文案。原有图片文件名保留，内容已更新；历史稿由 Git 历史管理。

### 重新生成

当前截图源在 `screenshots/`，虚构页面源在 `source/workspace.html`。`screenshots/SOURCE.json` 记录所用产品代码校验值。

开发环境有 Playwright 和 Google Chrome 时运行：

```sh
node scripts/render-marketing.cjs
npm run build
```

渲染脚本从仓库根目录执行，先渲染当前插件界面，再导出三张 16:9 图片、社交封面和竖版海报。Playwright 仅为制作工具，不是插件或静态网站的运行依赖。可以通过 `NODE_PATH` 指向已安装的开发依赖。

构建会递归收录 `brand/` 子目录，保证 PNG、HTML、SVG、截图与文案一起交付。
