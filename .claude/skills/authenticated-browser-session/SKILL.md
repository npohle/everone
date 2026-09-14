---
name: authenticated-browser-session
description: Open a chrome instance that is already signed in to the EverOne app, for exploratory playwright-cli calls. Use when a task needs a live, authenticated browser session against https://npohle.github.io/everone/ rather than a full e2e test run.
allowed-tools: Bash(node:*) Bash(playwright-cli:*)
---

# Authenticated Browser Session

`tests/explorative/authenticatedBrowserSession.ts` signs in to the EverOne app via
Microsoft auth (same flow as the `auth` e2e setup project), then hands you a
`playwright-cli` session pre-loaded with that signed-in storage state — cookies,
localStorage, and sessionStorage. Use this instead of driving the Microsoft login
flow by hand whenever you need to poke around the app while authenticated.

Requires `TEST_USERNAME`, `TEST_PASSWORD`, and `TEST_TOTP_SEED` to be set in `.env`
at the repo root (already the case in this repo — don't print or log their values).

## Open a session

```bash
node tests/explorative/authenticatedBrowserSession.ts open
```

This runs headless by default and prints one JSON line on stdout when done:

```json
{"ok":true,"data":{"RUN_ID":"20260914-153000-12345"}}
```

Pass `--headed` to watch the browser while it signs in:

```bash
node tests/explorative/authenticatedBrowserSession.ts open --headed
```

The sign-in itself takes a few seconds (real Microsoft login + TOTP). Everything
else the command prints to stderr (grayed-out Playwright test output) can be
ignored — only the last stdout line matters, and that's the `RUN_ID`.

## Use the session

Pass the `RUN_ID` from the `open` output as playwright-cli's `-s` (session id) on
every subsequent call. The browser is already on
`https://npohle.github.io/everone/`, signed in, ready for snapshot/click/etc:

```bash
playwright-cli -s=20260914-153000-12345 snapshot
playwright-cli -s=20260914-153000-12345 click e15
playwright-cli -s=20260914-153000-12345 goto https://npohle.github.io/everone/some/path
```

See the `playwright-cli` skill for the full command set once the session is open.

## Close the session

Always close the session when you're done with it — it holds a browser process
and a local Caddy instance open. `close` accepts a `RUN_ID`, and also plain
`playwright-cli -s=<runid> close` works directly:

```bash
playwright-cli -s=20260914-153000-12345 close
```

or, via the wrapper script (defaults to the most recently created run if the
runid is omitted, and additionally tears down the dedicated Caddy instance):

```bash
node tests/explorative/authenticatedBrowserSession.ts close 20260914-153000-12345
node tests/explorative/authenticatedBrowserSession.ts close
```

Prefer the wrapper script's `close` over calling `playwright-cli ... close`
directly — it also stops the Caddy instance that `open` started for this run,
which `playwright-cli close` alone would leave running.
