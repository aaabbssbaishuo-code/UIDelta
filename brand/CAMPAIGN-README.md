# UIDelta · 16:9 宣传组图

2026-09-04 文案与视觉更新。

| 文件 | 主题 |
| --- | --- |
| `cover-16x9.png` | 看见问题。说清怎么改。 |
| `feature-inspect-16x9.png` | 差多少，直接量。 |
| `feature-delivery-16x9.png` | 记录一次，接着改。 |

三张均为 **1920×1080**。白色、石墨与标注橙统一呈现；产品界面保持正视，不倾斜、不叠压。封面用「实际 24px → 设计要求 16px」说明如何把偏差变成清楚的修改要求。

## 编辑与导出

同名 HTML 是可编辑源文件，共用 `campaign-16x9.css`，依赖 `icon.svg` 与 `screenshots/`。保持这些相对路径即可本地打开。

在完整仓库中运行 `scripts/render-marketing.cjs --art-only` 只更新宣传图；不加参数时会重新采集产品界面。脚本需要 Playwright 与本机 Chrome。运行 `npm run build` 重建 ZIP。

## 使用说明

使用真实产品界面与虚构项目数据。截图来源见 `screenshots/SOURCE.json`。24px → 16px 是示例修改要求，不代表工具自动知道设计目标。

ZIP 为前端或 Agent 提供报告、元素定位与截图。Agent 还需要项目源码、运行环境和修改授权，完成后需复核。详见 `AGENT-HANDOFF.md`（宣传包）或仓库的 `docs/AGENT-HANDOFF.md`。
