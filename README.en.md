<h1 align="center">UIDelta</h1>
<p align="center"><strong>See the issue. Make the fix clear.</strong></p>
<p align="center"><a href="README.md">简体中文</a> · <a href="https://aaabbssbaishuo-code.github.io/UIDelta/">Website</a> · <a href="https://aaabbssbaishuo-code.github.io/UIDelta/downloads/UIDelta-v0.9.4.zip">Free download</a> · <a href="LICENSE">MIT License</a></p>

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

**Give the ZIP to an agent in your project.** The agent also needs source code, a runnable environment and permission to edit. It must verify the matching implementation and check the page after making changes. See the [agent handoff guide and prompt](docs/AGENT-HANDOFF.md).

## Start with your next review.

**v0.9.4 is a developer preview.** Install it as an unpacked Chrome extension; it is not yet on the Chrome Web Store.

1. [Download the ZIP](https://aaabbssbaishuo-code.github.io/UIDelta/downloads/UIDelta-v0.9.4.zip) and extract it.
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
git clone https://github.com/aaabbssbaishuo-code/UIDelta.git
cd UIDelta
npm run check
npm test
npm run build
npm start
```

Preview the site at `http://127.0.0.1:4173/`. Packages are written to `release/`; the deployable site is in `_site/`.

[Report an issue](https://github.com/aaabbssbaishuo-code/UIDelta/issues) · [Contribute](CONTRIBUTING.md) · [Roadmap](ROADMAP.md) · [Press kit](docs/marketing/README.md)

By [白土墩](https://github.com/aaabbssbaishuo-code) · [MIT License](LICENSE)
