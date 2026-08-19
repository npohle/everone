import { test } from "node:test";
import assert from "node:assert/strict";

import { buildChromeArgs } from "../e2e/lib/chrome.js";

const args = (extra = {}) =>
  buildChromeArgs({
    cdpPort: 9222,
    userDataDir: "/tmp/profile",
    hostMap: { "npohle.github.io": "127.0.0.1:8443" },
    ...extra,
  });

test("opens a CDP endpoint agent-browser can attach to", () => {
  assert.ok(args().includes("--remote-debugging-port=9222"));
  assert.ok(args().includes("--user-data-dir=/tmp/profile"));
});

test("points the registered app origin at the local dev server", () => {
  // The Azure app registration only allows its production redirect URI, so the
  // locally served build has to answer on that exact origin.
  assert.ok(args().includes("--host-resolver-rules=MAP npohle.github.io 127.0.0.1:8443"));
  assert.ok(args().includes("--ignore-certificate-errors"));
});

test("maps several hosts in one rule", () => {
  const mapped = args({
    hostMap: { "a.example": "127.0.0.1:1", "b.example": "127.0.0.1:2" },
  }).find((a) => a.startsWith("--host-resolver-rules="));
  assert.equal(mapped, "--host-resolver-rules=MAP a.example 127.0.0.1:1, MAP b.example 127.0.0.1:2");
});

test("omits host mapping and cert bypass when nothing is mapped", () => {
  const plain = args({ hostMap: {} });
  assert.ok(!plain.some((a) => a.startsWith("--host-resolver-rules=")));
  assert.ok(!plain.includes("--ignore-certificate-errors"));
});

test("runs headless by default and headed on request", () => {
  assert.ok(args().includes("--headless=new"));
  assert.ok(!args({ headed: true }).includes("--headless=new"));
});

test("uses a viewport tall enough that submit buttons are not below the fold", () => {
  // Microsoft's sign-in pages put "Next" below the fold on short viewports,
  // which silently breaks the click.
  const size = args().find((a) => a.startsWith("--window-size="));
  const [, w, h] = size.match(/--window-size=(\d+),(\d+)/).map(Number);
  assert.ok(w >= 1024, `width ${w} too small`);
  assert.ok(h >= 800, `height ${h} too small`);
});
