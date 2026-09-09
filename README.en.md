<h1 align="center">UIDelta</h1>
<p align="center"><strong>See the issue. Make the fix clear.</strong></p>
<p align="center"><a href="README.md">简体中文</a> · <a href="https://tu-dot.github.io/UIDelta/">Website</a> · <a href="https://tu-dot.github.io/UIDelta/downloads/UIDelta-v0.9.4.zip">Free download</a> · <a href="LICENSE">MIT License</a></p>

![UIDelta: see the issue, make the fix clear.](brand/cover-16x9.png)

Turn “this looks wrong” into a review report your developer can act on.

**UIDelta is an open-source tool for reviewing real web pages.** Measure the details, record the issue, and hand the evidence to a developer or coding agent.

## Three steps. A clearer handoff.

1. **Measure the difference.** Inspect dimensions, spacing and styles. Try a change on the page to confirm the direction.
2. **Keep the evidence.** Save the requested change with page and element screenshots, plus the element's location.
3. **Move the fix forward.** Export a report for your team or a ZIP for a developer or agent working in your project.

![Measure and record on the real page.](brand/feature-inspect-16x9.png)

## One review. Three ways to share it.

| Format | What it is for |
| --- | --- |
| **HTML** | Read and follow up on issues with screenshots alongside them. |
| **XLSX** | Bring issues into a spreadsheet to prioritize and schedule fixes. |
| **ZIP** | Hand over the report, structured element anchors and screenshots. |

![Review handoff with HTML, XLSX and ZIP.](brand/feature-delivery-16x9.png)

<a id="for-developers"></a>

## For developers: let Codex take it from here.

**Put the review ZIP in your project and point Codex to it.** Page URLs, element locators, screenshots and requested changes travel with the issue, reducing the context you need to collect and explain again.

![From a UIDelta ZIP to code changes and verification.](brand/feature-developer-16x9.png)

- **Less searching.** URLs, DOM selectors, test IDs and element text provide starting points for finding the implementation.
- **Less guessing.** Measured styles, screenshots and explicit change requests explain what differs and what should change.
- **Less prompt assembly.** Let Codex read `report.md`, `issues.json` and `assets/`, find the corresponding code, then make and verify changes by issue ID.

Open your project in Codex and give it the ZIP path. If archive reading is unavailable, extract the ZIP first and provide the folder path. Ask:

```text
Read this UIDelta review bundle and locate the issues in this codebase.
Make the explicitly requested changes, run relevant checks, and verify
on the page. Report changed files, results and unresolved items by issue ID.
```

DOM locators are clues, not verified source file paths. Codex needs project source, a runnable environment and permission to edit. Missing design targets need clarification.

Our workflow analysis identifies six areas of reduced handoff work, not a measured productivity percentage. [Research and sources (Chinese)](docs/marketing/DEVELOPER-HANDOFF-RESEARCH.zh-CN.md) · [Full handoff guide](docs/AGENT-HANDOFF.md)

## Start with your next review.

**v0.9.4 is a developer preview.** Install it as an unpacked Chrome extension; it is not yet on the Chrome Web Store.

1. [Download the ZIP](https://tu-dot.github.io/UIDelta/downloads/UIDelta-v0.9.4.zip) and extract it.
2. Open `chrome://extensions`, enable **Developer mode**, then choose **Load unpacked** and select the **UIDelta** folder containing `manifest.json`.
3. Pin the extension and refresh the page. Click UIDelta or press **Option / Alt + Shift + I**.

When using the source, load the repository's **extension** folder directly. See the [installation guide](docs/INSTALL.md).

No account or API key required. This version keeps review records and screenshots in local browser storage and sends no review data to external servers. Read the [privacy and permissions policy](PRIVACY.md).

<details>
<summary>Shortcuts and additional tools</summary>

| Action | Shortcut |
| --- | --- |
| Toggle UIDelta | Option / Alt + Shift + I |
| Measure spacing | Hold Option / Alt |
| Select through an element | Hold Command / Ctrl |
| Record an issue | R |
| Open the issue list | I |
| Interact with the page | Hold Space |
| Save an issue | Command / Ctrl + Enter |
| Close the current panel | Esc |

Local style previews and undo, region capture, issue search and filters are available. Design comparison requires a manually imported Figma Frame JSON snapshot. See [design comparison](docs/DESIGN-COMPARE.md).

</details>

<details>
<summary>Current limits</summary>

- Style previews affect the current page only; refreshing resets them. UIDelta does not edit website source code.
- ZIP exports contain element anchors, not verified source file paths or an automatic repair program.
- Automated AI reviews, live Figma sync and project-management integrations are planned.
- Protected Chrome pages and the Web Store cannot be inspected. Cross-origin iframes, closed shadow roots, pseudo-elements and objects inside Canvas cannot be selected individually.
- Local files require “Allow access to file URLs”.
- Marketing images use the extension UI with fictional data. [Capture provenance](brand/screenshots/SOURCE.json). The test harness uses a simulated bridge; real capture, storage and downloads require [browser QA](docs/QA.md).

</details>

## Help make the details better.

Node.js 22+ is required. There are no npm dependencies.

```sh
git clone https://github.com/tu-dot/UIDelta.git
cd UIDelta
npm run check
npm test
npm run build
npm start
```

Preview the site at `http://127.0.0.1:4173/`. Packages are written to `release/`; the deployable site is in `_site/`.

[Report an issue](https://github.com/tu-dot/UIDelta/issues) · [Contribute](CONTRIBUTING.md) · [Roadmap](ROADMAP.md) · [Press kit](docs/marketing/README.md)

By [土墩](https://github.com/tu-dot) · [MIT License](LICENSE)
