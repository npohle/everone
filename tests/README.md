# Test suite

Two layers, no third-party dependencies:

| Command | What it does |
| --- | --- |
| `npm run test:unit` | Pure Node tests for the harness itself. Fast, offline, no browser. |
| `npm run test:e2e` | Drives the real app in a real Chrome, signing in as a real Microsoft account. |
| `npm test` | Both, unit first. |

## Requirements

* Node 20+
* [`agent-browser`](https://www.npmjs.com/package/agent-browser) — `npm i -g agent-browser && agent-browser install`
* `oathtool` (`apt install oathtool`) — mints the authenticator codes
* `openssl` — issues the dev server's throwaway certificate

Credentials come from the environment and are never written to disk:

```bash
export TEST_USER_PASSWORD=...     # password of the test account
export TEST_USER_TOTP_SEED=...    # base32 secret shared with the authenticator app
npm run test:e2e
```

Run a subset by name: `node tests/e2e/run.js sign-in`.

## How the e2e suite is wired

```
run.js
  └── startRig()
        ├── dev-server.js   serves the working tree over https on an ephemeral port
        ├── chrome.js       launches Chrome with that port mapped onto the app origin
        └── browser.js      agent-browser, attached to Chrome over CDP
                └── specs/  node:test files, run sequentially against the shared rig
```

### Why the app is served on its production origin

`auth.js` derives the OAuth redirect URI from `window.location`, and the Azure app
registration only accepts the deployed origin. A dev server on `http://localhost:4173/`
is rejected by Microsoft with `invalid_request: the provided value for the input
parameter 'redirect_uri' is not valid`.

So the suite serves the **local working copy** and points the browser's host
resolver at it:

```
--host-resolver-rules=MAP npohle.github.io 127.0.0.1:<dev server port>
--ignore-certificate-errors
```

Only that hostname is redirected — `login.live.com` and `graph.microsoft.com` are
reached for real. The `app shell` spec fetches `./__e2e/health` to assert the page
under test really did come from the dev server and not from the deployed site.

Point the suite at a different deployment (or a `localhost` origin, if you register
one) with `E2E_APP_ORIGIN` / `E2E_APP_BASE_PATH`.

### Why sign-in is a loop, not a script

Microsoft varies the pages it shows based on what it remembers about the account
and the device: an account picker may appear, consent is only asked once, "Stay
signed in?" comes and goes. `login-steps.js` classifies whatever page is on screen
from its accessibility snapshot, and `microsoft-login.js` performs the one action
that step needs, until the popup returns to the app's redirect URI.

Because the classifier is pure, every branch — including error pages and the
`password` vs `username` ambiguity — is covered by unit tests against snapshots
captured from the real flow (`tests/unit/fixtures/snapshots.js`).

Two details that are easy to get wrong and are pinned by tests:

* **Type, don't fill.** Setting an input's value directly leaves Microsoft's form
  handler unaware of the change; the submit button then silently no-ops.
* **Scroll before clicking.** On a short viewport "Next" renders below the fold and
  the click never lands, so the browser wrapper scrolls the target into view first.

## Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `TEST_USER_PASSWORD` | *(required)* | Password of the test account |
| `TEST_USER_TOTP_SEED` | *(required)* | Base32 authenticator secret |
| `TEST_USER` | `nik.o.laus.pohle@gmail.com` | Account to sign in as |
| `E2E_APP_ORIGIN` | `https://npohle.github.io` | Origin the app is served as |
| `E2E_APP_BASE_PATH` | `/everone/` | Path the app is served under |
| `E2E_HEADED` | `0` | Show the browser window |
| `E2E_KEEP_OPEN` | `0` | Leave the browser running after the suite |
| `E2E_TIMEOUT_MS` | `30000` | Default per-command timeout |
| `E2E_CHROME_PATH` | *(auto-detected)* | Chrome binary to launch |
| `E2E_VERBOSE` | `0` | Log every agent-browser command |

## Serving the app by hand

```bash
npm run serve      # http://127.0.0.1:4173/everone/
```

Useful for looking at the UI; sign-in will not work there, for the redirect-URI
reason above.
