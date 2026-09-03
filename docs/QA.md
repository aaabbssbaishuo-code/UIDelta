# Verification

## Automated baseline

Run `npm run check`, `npm test` and `npm run build` before publishing.

The inherited suites cover editor behaviors, layer properties, recording regressions and message/export contracts. Some suites aggregate their assertions, so Node's top-level test count differs from the number of named checks. Contract tests include source-level checks and VM-based functions; they do not substitute for full browser integration.

Packaging includes only extension runtime files, icons, license and installation instructions. Tests and mocked harnesses are excluded from the downloadable extension. SHA-256 checksums are generated alongside releases.

## Real-extension smoke check

Use a synthetic page with the unpacked extension loaded:

1. Toggle the extension, select an element and measure another element with Alt / Option.
2. Preview one style change, switch elements, undo it and confirm original styles return.
3. Start a review; press R, type while screenshots settle, save and locate the resulting issue.
4. Refresh the page and confirm records persist.
5. Export HTML, XLSX and ZIP; verify screenshots, text and element location in each supported format.
6. Test keyboard focus, Escape, Space pass-through and reduced-motion behavior.
7. Try a blocked Chrome page and confirm the extension fails clearly.

`extension/test-harness.html` is useful for visual inspection and UI logic, but uses mock capture/storage/export and does not prove these browser APIs work. The original manual checklist is retained in `extension/PHASE1_QA.md`; current installation paths and shortcuts are in the README.

## Website

Verify desktop and phone widths, check all local asset links, switch the three demo steps, edit the example issue, download Markdown, and confirm the extension ZIP contains a loadable manifest. All example data must remain fictional.
