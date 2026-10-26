# Vendored libraries

## scribe.js-ocr

`scribe.js-ocr/` is an unmodified subset of the
[`scribe.js-ocr`](https://www.npmjs.com/package/scribe.js-ocr) npm package
(AGPL-3.0, see `scribe.js-ocr/LICENSE`), used by `scribe-text.js`.

It has to be served from this site's own origin: scribe.js and its workers
start further workers relative to their own module URL, and browsers refuse
to construct a worker from a cross-origin (CDN) script.

Only the parts needed in the browser are kept: `scribe.js`, `js/`, `lib/`,
`tess/` (Tesseract engine + wasm), `fonts/`, `scrollview-web/` (debug
visualisation, imported lazily), plus `package.json`, `README.md` and
`LICENSE`. The CLI, MCP server, docs, examples and `scribe-ui/` are dropped.

To update, bump `SCRIBE_VERSION` in `scribe-text.js`, then:

```bash
VERSION=0.16.1   # new version
tmp=$(mktemp -d)
(cd "$tmp" && npm pack "scribe.js-ocr@$VERSION" && tar xzf scribe.js-ocr-*.tgz)
rm -rf vendor/scribe.js-ocr && mkdir vendor/scribe.js-ocr
(cd "$tmp/package" && cp -r LICENSE README.md package.json scribe.js js lib tess fonts scrollview-web "$OLDPWD/vendor/scribe.js-ocr/")
npm run test:unit
```

`tests/unit/scribe-text.test.js` checks the vendored version matches and that
every relative module, worker and asset the vendored code references exists.
