<p align="center"><img src="brand/icon-256.png" width="80" alt="UIDelta logo"></p>
<h1 align="center">UIDelta</h1>
<p align="center"><strong>Every UI difference deserves clear evidence.</strong><br>Open-source UI inspection, issue capture and handoff for designers.</p>
<p align="center"><a href="README.zh-CN.md">简体中文</a> · <a href="https://aaabbssbaishuo-code.github.io/UIDelta/">Website & interactive demo</a> · <a href="https://github.com/aaabbssbaishuo-code/UIDelta/releases">Downloads</a> · <a href="LICENSE">MIT License</a></p>

![UIDelta current UI — fictional project](brand/cover-16x9.png)

UIDelta turns “this doesn't match the design” into a review issue with measurements, screenshots and an element anchor. Inspect the real page, record what needs to change, and export the evidence for your existing workflow.

**Status: v0.9.4 developer preview.** Install as an unpacked Chrome extension. Not yet distributed through the Chrome Web Store. The extension panels above are rendered from the current product source, using fictional project data.

## From review to handoff

| Inspect, record, capture | Hand off with context |
| --- | --- |
| ![Inspect and capture](brand/feature-inspect-16x9.png) | ![HTML, XLSX and Agent handoff](brand/feature-delivery-16x9.png) |

Find current product screenshots, share graphics, editable assets and release copy in the [marketing kit index](docs/marketing/README.md).

## What you can do

- **Inspect:** select DOM elements, read dimensions, typography, colors and box-model properties. Hold Option / Alt to measure spacing.
- **Preview changes locally:** adjust styles and supported text properties, then undo. Changes affect the current page only; they do not edit source code.
- **Record issues:** capture a selected element or a drawn region, add a description, and keep contextual/detail screenshots with element anchors.
- **Review:** browse, search, filter, edit and locate recorded issues on the page.
- **Compare with a design snapshot:** manually import a Figma-style JSON snapshot. Local deterministic matching shows confidence, expected values, actual values and deltas.
- **Deliver:** export a standalone HTML report, an Excel workbook, or a ZIP with `report.md`, `issues.json` and screenshots.

There is no account, backend or API key. Review data lives in the extension's local IndexedDB. See [privacy and permissions](PRIVACY.md).

## Install

1. Download `UIDelta-v0.9.4.zip` from [Releases](https://github.com/aaabbssbaishuo-code/UIDelta/releases), then unzip it.
2. Open `chrome://extensions` and turn on **Developer mode**.
3. Click **Load unpacked** and choose the `UIDelta` folder containing `manifest.json`.
4. Pin UIDelta, refresh the webpage you want to review, and click the extension icon.

From source, load the repository's **`extension/`** folder directly. No build or dependency installation is required for the extension.

## A short review loop

1. Open UIDelta and start a review session.
2. Select an element, inspect its styles or measure spacing.
3. Press **R**, describe the problem, and save when evidence is ready.
4. Review your issue list and export the format your team needs.

| Action | Shortcut |
| --- | --- |
| Toggle UIDelta | Alt / Option + Shift + I |
| Measure spacing | Hold Alt / Option |
| Select through the current layer | Hold Ctrl / Command |
| Record the selected element | R |
| Open issue list | I |
| Temporarily interact with the webpage | Hold Space |
| Save the issue | Ctrl / Command + Enter |
| Close the active panel | Escape |

See [installation details](docs/INSTALL.md) and [design snapshot guidance](docs/DESIGN-COMPARE.md).

For source-aware coding agents, see the [Agent handoff guide](docs/AGENT-HANDOFF.md). The ZIP provides review context; the agent also needs the project's source, runtime and permission to make changes. [Brand and 16:9 campaign assets](brand/README.md) are available for sharing the project.

## Development

Node.js 22+ is required for scripts and tests. There are **no npm dependencies**.

```sh
git clone https://github.com/aaabbssbaishuo-code/UIDelta.git
cd UIDelta
npm run check
npm test
npm run build
npm start
```

The website preview runs at `http://127.0.0.1:4173`. The build produces extension/brand ZIPs in `release/` and the static website in `_site/`. After editing extension code, reload its card in Chrome and refresh the test page.

```text
extension/            Manifest V3 extension and regression tests
ui-lens-bookmarklet/  Optional bookmark trigger
site/                 Static marketing site and interactive illustration
brand/                SVG logos, PNG icons and share graphics
docs/                 Installation, product, release and design guidance
scripts/              Dependency-free checks, packaging and preview
```

`extension/test-harness.html` uses an in-memory mock bridge to test UI behavior; its screenshots and exports are simulated. Real capture/storage/export verification requires loading the extension into Chrome. See [QA](docs/QA.md).

## Current boundaries

- Figma comparison needs a manually supplied JSON snapshot. Online Figma sync, AI scanning, direct project-management sync and source-code mapping are not implemented.
- Chrome internal pages and the Chrome Web Store cannot be inspected.
- Cross-origin iframe contents, closed shadow roots, pseudo-elements and objects inside Canvas are not independent selectable elements.
- Local file access requires explicit activation in Chrome extension settings.
- UI and report labels are currently primarily Chinese. English product documentation is available here.
- Broad website access is currently requested to support page activation and cross-page reviews. No external data requests are made by the extension; exported reports can contain page text, URLs and screenshots.

## Contribute

Small, focused fixes are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md), open an issue with a reproducible example, or submit a pull request. Planned work is listed in [ROADMAP.md](ROADMAP.md).

Created by [白土墩 / aaabbssbaishuo-code](https://github.com/aaabbssbaishuo-code). Licensed under [MIT](LICENSE).
