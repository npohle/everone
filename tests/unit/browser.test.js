import { test } from "node:test";
import assert from "node:assert/strict";

import { Browser, parseTabs } from "../e2e/lib/browser.js";

test("scopes every command to its own session and CDP endpoint", () => {
  const browser = new Browser({ session: "e2e", cdpPort: 9222 });
  assert.deepEqual(browser.buildArgs(["snapshot", "-i"]), [
    "--session",
    "e2e",
    "--cdp",
    "9222",
    "snapshot",
    "-i",
  ]);
});

test("omits the CDP flag when no endpoint is given", () => {
  const browser = new Browser({ session: "e2e" });
  assert.deepEqual(browser.buildArgs(["get", "url"]), ["--session", "e2e", "get", "url"]);
});

test("parses the tab listing and marks the active tab", () => {
  const tabs = parseTabs(
    [
      "  [t1] npohle.github.io/everone/ - https://npohle.github.io/everone/",
      "→ [t2] Sign in to your Microsoft account - https://login.live.com/oauth20_authorize.srf?a=1",
    ].join("\n")
  );
  assert.equal(tabs.length, 2);
  assert.deepEqual(tabs[0], {
    id: "t1",
    title: "npohle.github.io/everone/",
    url: "https://npohle.github.io/everone/",
    active: false,
  });
  assert.equal(tabs[1].id, "t2");
  assert.equal(tabs[1].active, true);
  assert.equal(tabs[1].url, "https://login.live.com/oauth20_authorize.srf?a=1");
});

test("keeps titles that themselves contain a dash", () => {
  const [tab] = parseTabs("→ [t9] Foo - Bar - Baz - https://example.com/x");
  assert.equal(tab.title, "Foo - Bar - Baz");
  assert.equal(tab.url, "https://example.com/x");
});

test("ignores noise lines in the tab listing", () => {
  assert.deepEqual(parseTabs("no tabs open"), []);
  assert.deepEqual(parseTabs(""), []);
});

test("reports the failing command when agent-browser errors", async () => {
  const browser = new Browser({ session: "e2e", bin: "agent-browser-does-not-exist" });
  await assert.rejects(browser.exec(["get", "url"]), /agent-browser get url failed/);
});
