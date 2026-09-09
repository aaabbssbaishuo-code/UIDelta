# Releasing UIDelta

## Build and validate

```sh
npm run check
npm test
npm run build
```

Build outputs: `release/UIDelta-v0.9.4.zip`, `release/UIDelta-brand-kit.zip`, `release/UIDelta-promo-16x9.zip`, `release/SHA256SUMS.txt`, `_site/`.

The extension archive contains a single `UIDelta/` directory with its manifest at the top level. Site downloads use the same bytes. The build uses the repository's own stored-ZIP implementation and has no dependency installation step.

## Version updates

Update `extension/manifest.json`, `package.json`, the manifest version expectation in `extension/phase1-contract.test.mjs`, the website's download URL/version label, documentation and CHANGELOG. This preview intentionally starts at the pre-existing development version 0.9.4.

## GitHub

Recommended repository: `tu-dot/UIDelta`, public, MIT. Set the repository description from `docs/LAUNCH-COPY.md`; set website to `https://tu-dot.github.io/UIDelta/`.

Enable GitHub Pages with **GitHub Actions** as its source. `pages.yml` validates and builds before deployment. If automatic Pages configuration is unavailable for the account, select the source once in Settings → Pages. The workflow follows [GitHub's official Pages guidance](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).

Enable private vulnerability reporting under Settings → Security if available. The maintainer can upload `brand/social-card.png` in Settings → General → Social preview.

## Release process

Push a matching `vX.Y.Z` tag to trigger the release workflow. It checks that the tag matches the extension version, validates, packages and creates a **draft prerelease**. Review the notes and artifacts, then publish when ready. This prevents a future tag push from unintentionally announcing an unreviewed build.

The MIT license text follows [Choose a License](https://choosealicense.com/licenses/mit/). All original source, website and brand assets in this repository use the same project license.
