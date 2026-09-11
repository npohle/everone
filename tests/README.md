# End-to-end tests

The e2e suite runs on [Playwright Test](https://playwright.dev/), against the
actual app served over TLS by [Caddy](https://caddyserver.com/), signed in as
a real Microsoft account. There is no mocking: a run performs one full OAuth
sign-in against `login.microsoftonline.com`, then every spec reuses that
signed-in state.

## Requirements

* Node 20+, then `npm install` (pulls in `@playwright/test`, `dotenv`,
  `commander`, `picocolors`)
* `npx playwright install chromium` — installs a matching Chromium build
* [`caddy`](https://caddyserver.com/) — `brew install caddy`
* `oathtool` — `brew install oath-toolkit` — mints TOTP codes for the authenticator step
* [`playwright-cli`](https://www.npmjs.com/package/@playwright/cli) — only needed for the exploratory session below, not for running the suite

## Credentials

Test account credentials live in a `.env` file at the repo root (gitignored, never
committed; loaded via `dotenv.config()` in `playwright.config.ts`):

```bash
TEST_USERNAME=you@example.com
TEST_PASSWORD=...
TEST_TOTP_SEED=...   # base32 secret shared with the authenticator app
```

## Running the suite

```bash
npm run test:e2e
```

Run a single spec file the same way Playwright normally supports:
`npx playwright test 02-search.spec.ts`.

## How it's wired

**Caddy** (`tests/e2e/lib/caddy.ts`'s `startCaddy`/`stopCaddy`, called from
`global-setup.ts` / `global-teardown.ts` — Playwright's `globalSetup`/
`globalTeardown` hooks) starts once for the whole run, before any project,
and stops once at the very end:

* Picks a free local port and serves the repo root over internal TLS,
  `handle_path`-mapped so `/everone/*` resolves without the checkout needing
  to live in a directory literally named `everone`.
* This matters because `auth.js` derives the OAuth redirect URI from
  `window.location`, and the Azure app registration only accepts the deployed
  origin (`https://npohle.github.io/everone/`) — a plain `localhost` dev
  server gets rejected by Microsoft with an `invalid_request` /
  bad `redirect_uri` error. Caddy is bound to that real hostname instead, and
  browsers are launched with a `--host-resolver-rules` mapping pointing the
  hostname at 127.0.0.1.
* Caddy is spawned detached (its own process group, stdio discarded) and its
  pid is written to `.caddy-server-state.json` in the run's artefacts
  directory, since `globalTeardown` has to find it again to stop it.
* `startCaddy`/`stopCaddy` are shared with
  `tests/explorative/authenticatedBrowserSession.ts` (see below), which
  starts its own separate, independent Caddy instance the same way.

**Sign-in** (`tests/e2e/00-auth.setup.ts`, the `auth` project) runs once,
before the `e2e` project (declared via `dependencies: ['auth']` in
`playwright.config.ts`). It imports `test`/`page` from `./fixtures.ts` like
every other spec — its own `page` starts out signed out (no
`localstorage.json`/`sessionstorage.json` exist yet on a fresh run), then:

* Drives the real Microsoft popup sign-in flow — `auth.js` calls MSAL's
  `loginPopup()`, so the whole flow happens in a separate popup window, not
  in the main page. Username → password → TOTP code (via `oathtool`) →
  "Stay signed in?", with a branch for Microsoft's occasional passkey-
  enrollment interrupt and for first-time consent.
* Once the app has loaded, captures the resulting sign-in state to two files
  in the artefacts directory:
  * `localstorage.json` — `page.context().storageState()` (cookies +
    localStorage).
  * `sessionstorage.json` — `page.sessionStorage.items()`. This app's MSAL
    config uses `cacheLocation: "sessionStorage"` for its token cache, and
    Playwright's `storageState()` does **not** capture sessionStorage at all,
    so it's read out separately via the `page.sessionStorage` /
    `page.localStorage` WebStorage API.

**Every test** (`tests/e2e/fixtures.ts`, used by all `*.spec.ts` files
instead of importing directly from `@playwright/test`) then starts already
signed in, without repeating any of that:

* A custom `browser` fixture (worker-scoped, so it launches once and is
  shared across all tests in the run) reads Caddy's port from
  `.caddy-server-state.json` and launches Chromium with the matching
  `--host-resolver-rules`.
* A custom `context` fixture (one per test, Playwright's normal default)
  loads `localstorage.json` into `newContext({ storageState })`, then replays
  `sessionstorage.json` via `context.addInitScript(...)` — an init script
  runs before any page script on every navigation in that context, which is
  what's needed since sessionStorage isn't part of `storageState` at all.
  Both files being absent (the `auth` project's own first run) just yields a
  signed-out context, same as this fixture behaves for any other missing-state
  case.

Screenshots land in `tests/artefacts/<RUN_ID>/` (gitignored, `RUN_ID` is set
by the `test:e2e` npm script and also used as Playwright's own `outputDir`
for traces — `trace: 'retain-on-failure'` on the `e2e` project) and are handy
for debugging a failing run after the fact, alongside
`localstorage.json`/`sessionstorage.json` from that run's sign-in.

## Exploring a signed-in session with `playwright-cli`

`tests/explorative/authenticatedBrowserSession.ts` is a small
[commander](https://www.npmjs.com/package/commander) CLI with two commands:

```bash
node tests/explorative/authenticatedBrowserSession.ts open [--headed]
node tests/explorative/authenticatedBrowserSession.ts close [runid]
```

(or via npm: `npm run test:explorative:authenticatedBrowserSession -- open`)

`open`:

1. Generates a fresh `RUN_ID` (same `YYYYMMDD-HHMMSS-<pid>` shape the
   `test:e2e` npm script produces in bash) and runs `npx playwright test
   --project=auth` with it — a full, real sign-in, same as above, producing
   that run's own `localstorage.json`/`sessionstorage.json`. That run's own
   Caddy instance stops itself as part of its own `globalTeardown` before
   this step finishes.
2. Starts a **second, independent Caddy instance** (via the same
   `startCaddy` from `tests/e2e/lib/caddy.ts`) dedicated to this exploratory
   session, and writes a `playwright-cli.config.json` with
   `browser.launchOptions.args: ["--host-resolver-rules=MAP
   npohle.github.io 127.0.0.1:<port>"]` — playwright-cli's `open` has no
   direct flag for raw Chrome launch args, `--config=<path>` pointing at a
   `browser.launchOptions` file is the supported mechanism.
3. Opens a named `playwright-cli` session (`-s <runid>`) with that config,
   loads `localstorage.json` via playwright-cli's own `state-load`, then
   replays `sessionstorage.json` via a `run-code` call registering a
   `context.addInitScript(...)` (same mechanism as `fixtures.ts`'s `context`
   fixture) followed by a `reload` — `addInitScript` only applies to future
   navigations, and the page was already loaded by `open`.

The session (and its dedicated Caddy) stay running after the script exits —
explore it by hand with `playwright-cli -s <runid> <command>`, or find the
`runid` again later from the printed `RUN_ID`, `playwright-cli list`, or the
newest `tests/artefacts/` directory.

`close [runid]` stops both the playwright-cli session and its dedicated
Caddy for that run; omit `runid` to close the most recently *created*
`tests/artefacts/` run.

## Known gaps

* `npm run test:unit` currently has no tests under `tests/unit/` to run.
* `.gitignore`'s `playwright/.auth/` entry is vestigial — sign-in state is
  written to `localstorage.json`/`sessionstorage.json` in the artefacts
  directory, not `playwright/.auth/`.
