# End-to-end tests

The e2e suite is [bats](https://github.com/bats-core/bats-core) driving a real
Chrome session via [`agent-browser`](https://www.npmjs.com/package/agent-browser),
against the actual app served over TLS by [Caddy](https://caddyserver.com/), signed
in as a real Microsoft account. There is no mocking: every run performs a full
OAuth sign-in against `login.microsoftonline.com`.

## Requirements

* [`bats-core`](https://github.com/bats-core/bats-core) — `brew install bats-core`
* [`agent-browser`](https://www.npmjs.com/package/agent-browser) — `npm i -g agent-browser && agent-browser install`
* [`caddy`](https://caddyserver.com/) — `brew install caddy`
* `oathtool` — `brew install oath-toolkit` — mints TOTP codes for the authenticator step
* `curl`, `nc` (both preinstalled on macOS)

## Credentials

Test account credentials live in a `.env` file at the repo root (gitignored, never
committed):

```bash
TEST_USERNAME=you@example.com
TEST_PASSWORD=...
TEST_TOTP_SEED=...   # base32 secret shared with the authenticator app
```

## Running the suite

```bash
bats tests/e2e
```

Run a single spec file the same way: `bats tests/e2e/02-search.bats`.

## How it's wired

`tests/e2e/setup_suite.bash` provides bats' `setup_suite` / `teardown_suite`
hooks, run once for the whole `.bats` suite in the directory:

1. Picks a free local port and starts Caddy, serving the repo root over
   internal TLS and mapped to the app's real hostname (`npohle.github.io`) via
   `--host-resolver-rules`. This matters because `auth.js` derives the OAuth
   redirect URI from `window.location`, and the Azure app registration only
   accepts the deployed origin — a plain `localhost` dev server gets rejected
   by Microsoft with an `invalid_request` / bad `redirect_uri` error.
2. Opens a headed `agent-browser` session (`--session "$RUN_ID"`) and drives
   the full Microsoft sign-in flow (username → password → TOTP code →
   "Stay signed in?"), screenshotting each step.
3. Exports `RUN_ID` and `ARTEFACTS_DIR` for the individual spec files to reuse
   the same authenticated session and drop their own screenshots alongside
   the sign-in ones.

`teardown_suite` stops Caddy and closes the `agent-browser` session.

Each `*.bats` file is a set of `@test` blocks that continue driving that same
already-authenticated session — e.g. `01-authentication.bats` just asserts
sign-in succeeded, `02-search.bats` exercises the search box. Files run in
name order, so number new specs accordingly.

Screenshots land in `tests/artefacts/<RUN_ID>/` (gitignored) and are handy for
debugging a failing run after the fact.

## Working interactively with `tests/dev.sh`

Running the full suite for every small change is slow, and a bats run tears
its browser session down as soon as it finishes. `tests/dev.sh` gives you the
same authenticated session on demand, independent of any test run, so you can
poke at the app by hand or iterate on new `agent-browser` commands before
turning them into a test.

Run it directly:

```bash
tests/dev.sh
```

This starts Caddy, opens a **headed** browser, and runs through the same
Microsoft sign-in flow as `setup_suite.bash`. Once sign-in succeeds, Caddy is
shut down again immediately — the SPA runs entirely client-side once loaded,
so it doesn't need the server for anything after the initial page load and
OAuth redirect. The browser window and its `agent-browser` session are left
running.

The script prints the `RUN_ID` it used. Target that same session from another
terminal with `agent-browser --session "<RUN_ID>" ...` to inspect the page,
try out selectors, or reproduce a failing test step manually — e.g.:

```bash
agent-browser --session "<RUN_ID>" snapshot -i
agent-browser --session "<RUN_ID>" get count '#listing .row:not(.head)'
```

`tests/dev.sh` also defines `start_and_authenticate(run_id, artefacts_dir,
headed)` as a sourceable function (the same steps `setup_suite.bash` performs
for the bats suite) — source the file instead of executing it if you want to
call that function with your own `RUN_ID`/`ARTEFACTS_DIR`.
