#!/bin/bash
# Test: the app's page title is "OneDrive Browser".
# Serves the static site locally and checks the title via agent-browser.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT=8843
EXPECTED_TITLE="OneDrive Browser"
SESSION="onedrive-browser-title-test"

cleanup() {
  agent-browser --session "$SESSION" close >/dev/null 2>&1 || true
  if [[ -n "${SERVER_PID:-}" ]]; then
    kill "$SERVER_PID" >/dev/null 2>&1 || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

python3 -m http.server "$PORT" --directory "$REPO_ROOT" --bind 127.0.0.1 >/dev/null 2>&1 &
SERVER_PID=$!

agent-browser --session "$SESSION" open "http://127.0.0.1:$PORT/index.html"
agent-browser --session "$SESSION" wait --load domcontentloaded

ACTUAL_TITLE="$(agent-browser --session "$SESSION" get title)"

if [[ "$ACTUAL_TITLE" != "$EXPECTED_TITLE" ]]; then
  echo "FAIL: expected page title \"$EXPECTED_TITLE\", got \"$ACTUAL_TITLE\""
  exit 1
fi

echo "PASS: page title is \"$ACTUAL_TITLE\""
