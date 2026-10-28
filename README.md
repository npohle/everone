# EverOne

A monorepo with two independently built and deployed parts:

| Path | What | Deployed by |
| --- | --- | --- |
| `/` (repo root) | Static, client-only OneDrive file browser and viewer (SPA) | [`pages.yml`](.github/workflows/pages.yml) → GitHub Pages |
| [`functions/`](functions/) | Azure Functions app, e.g. a proxy to Cloudflare Workers AI | [`main_app-everone-extract.yml`](.github/workflows/main_app-everone-extract.yml) → Azure Function App `app-everone-extract` |

Each workflow only runs for changes to its own part: `pages.yml` ignores
`functions/**`, and the Function App workflow only runs for `functions/**`
(both can still be started by hand via `workflow_dispatch`).

The Function App has its own `package.json` / `package-lock.json`, so it's
installed, tested and deployed without the SPA's dependencies:

```bash
npm test --prefix functions   # or, from the root: npm run test:functions
```

The SPA's tests are described in [tests/README.md](tests/README.md).
