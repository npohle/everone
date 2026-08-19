// Browsing a real OneDrive: listing, folder navigation, sorting and preview.
//
// The account's contents are not fixture data, so these assertions describe
// invariants of the UI rather than specific file names.

import { before, describe, it } from "node:test";
import assert from "node:assert/strict";

import { ensureSignedIn } from "../lib/harness.js";

describe("file browser", { concurrency: 1 }, () => {
  let rig;

  before(async () => {
    rig = await ensureSignedIn({ log: (msg) => console.error(`# ${msg}`) });
    await rig.page.waitForListing(60_000);
  });

  it("lists the drive root", async () => {
    const state = await rig.page.state();
    assert.ok(state.items.length > 0);
    assert.deepEqual(state.breadcrumbs, ["OneDrive"]);
    for (const item of state.items) {
      assert.ok(item.id, "every row must carry its Graph item id");
      assert.ok(item.name.length > 0, `row ${item.id} rendered without a name`);
    }
  });

  it("sorts server-side and re-renders in the requested order", async () => {
    await rig.page.setSort("name-asc");
    const ascending = await rig.page.waitFor(
      (s) => s.sort === "name-asc" && !s.loading && s.items.length > 0,
      { description: "the A-Z listing" }
    );

    await rig.page.setSort("name-desc");
    const descending = await rig.page.waitFor(
      (s) => s.sort === "name-desc" && !s.loading && s.items.length > 0,
      { description: "the Z-A listing" }
    );

    assert.notDeepEqual(
      ascending.items.map((i) => i.id),
      descending.items.map((i) => i.id),
      "changing the sort order did not change the listing"
    );
  });

  it("navigates into a folder and back out again", async (t) => {
    const folder = await rig.page.firstFolder();
    if (!folder) return t.skip("the test account's root has no folders");

    await rig.page.openItem(folder.id);
    const inside = await rig.page.waitFor((s) => s.breadcrumbs.length === 2 && !s.loading, {
      description: `the ${folder.name} folder to open`,
    });
    assert.equal(inside.breadcrumbs[0], "OneDrive");
    assert.equal(inside.breadcrumbs[1], folder.name);

    await rig.page.goUp();
    const back = await rig.page.waitFor((s) => s.breadcrumbs.length === 1 && !s.loading, {
      description: "the root listing to come back",
    });
    assert.deepEqual(back.breadcrumbs, ["OneDrive"]);
  });

  it("previews the selected file in the split pane", async (t) => {
    const file = await rig.page.firstFile();
    if (!file) return t.skip("the test account's root has no files");

    await rig.page.openItem(file.id);
    const previewing = await rig.page.waitFor((s) => s.items.some((i) => i.selected), {
      description: `${file.name} to be selected`,
    });

    assert.equal(previewing.items.find((i) => i.selected).id, file.id);
    assert.notEqual(
      previewing.viewerTitle,
      "Preview",
      "the preview pane kept its placeholder title after a file was selected"
    );
  });

  it("keeps keyboard focus in the list while arrowing through it", async (t) => {
    const items = await rig.page.items();
    if (items.length < 2) return t.skip("need at least two rows to arrow between");

    await rig.page.openItem(items[0].id);
    await rig.browser.press("ArrowDown");

    const focus = await rig.browser.evalJson(`(() => JSON.stringify({
      tag: document.activeElement?.tagName ?? null,
      inListing: !!document.activeElement?.closest("#listing"),
    }))()`);
    assert.equal(focus.inListing, true, `focus escaped the list pane (on ${focus.tag})`);
  });

  it("searches the drive", async () => {
    const items = await rig.page.items();
    const term = (items[0]?.name ?? "a").slice(0, 3).trim() || "a";

    await rig.page.search(term);
    const searched = await rig.page.waitFor(
      (s) => !s.loading && s.breadcrumbs.some((c) => /search/i.test(c)),
      { timeoutMs: 45_000, description: `search results for "${term}"` }
    );
    assert.ok(/search/i.test(searched.breadcrumbs.join(" ")));
  });
});
