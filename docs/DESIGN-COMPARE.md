# Design snapshot comparison

UIDelta currently compares DOM values to a **manually imported local JSON snapshot**. Pasting a Figma URL alone does not retrieve design data. No Figma access token or online API integration is configured in the extension.

## Accepted inputs

The comparison engine accepts a Figma REST-style JSON object containing `document` or `children`, or a UIDelta-normalized `schemaVersion: 2` snapshot. Import only the relevant Frame where possible. Inputs are limited to 8 MB and 5,000 nodes.

Prepare the JSON through your own authorized design-export workflow, then open the design-binding control during a review and choose the file. UIDelta does not yet ship a one-click Figma exporter. A regular Figma image export is not a JSON snapshot.

Results show match confidence and property differences, such as width, height, spacing, typography and colors. Low-confidence matches should be reviewed manually. A missing reliable match does not stop manual issue recording. Design snapshots are stored with the local session and included in exported structured data.

The underlying comparison rules live in `extension/compare-engine.js`. They are deterministic heuristics, not an AI model or proof of design correctness.
