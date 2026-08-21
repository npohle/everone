// The document title carries a demo prefix so the deployed build is
// recognisable from the browser tab and window switcher.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const INDEX = new URL("../../index.html", import.meta.url);

const title = async () => {
  const html = await readFile(INDEX, "utf8");
  const match = html.match(/<title>([^<]*)<\/title>/);
  assert.ok(match, "index.html has no <title>");
  return match[1].trim();
};

test("prefixes the page title with the demo marker", async () => {
  assert.match(await title(), /^DEMO 6\b/);
});

test("keeps naming the app after the prefix", async () => {
  assert.equal(await title(), "DEMO 6 OneDrive Browser");
});
