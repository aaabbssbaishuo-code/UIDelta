# Contributing to UIDelta

Thanks for helping make UI review clearer. Issues and pull requests can be written in Chinese or English.

## Start locally

Load `extension/` as an unpacked Chrome extension. Use Node.js 22+ for repository scripts. No npm install is required.

```sh
npm run check
npm test
npm run build
npm start
```

## A useful contribution

- Describe one concrete problem, its trigger and the expected result.
- Keep the change focused and explain any data format or permission changes.
- Add a regression test for behavioral fixes when it can reproduce the original failure. Do not rely only on source-string assertions.
- Verify changed capture, storage and export behavior in a real loaded extension. The HTML test harness mocks these operations.
- Preserve keyboard access, focus during editing and reduced-motion preferences.
- Use synthetic or publicly shareable test pages; never commit private customer screenshots or reports.

Source code remains framework-free JavaScript. The marketing site is static HTML/CSS/JS. Generated release ZIPs and `_site/` are not committed; they are built by CI.

See [QA](docs/QA.md) for coverage and [RELEASING](docs/RELEASING.md) for packaging. By contributing, you agree to license your contribution under the project's MIT license. Be respectful and discuss the work, not the person.
