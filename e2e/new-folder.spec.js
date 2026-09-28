import { randomBytes } from "node:crypto";
import { test, expect, isLive, liveToken, GRAPH } from "./fixtures.js";

// Hex only: underscores would be trimmed by the listing's display name.
const randomFolderName = () => `e2e-test-${randomBytes(6).toString("hex")}`;

function row(page, name) {
  return page.locator("#listing .row:not(.head)").filter({
    has: page.locator(".name", { hasText: new RegExp(`^${name}$`) }),
  });
}

async function openDocuments(page) {
  await page.goto("/");
  await row(page, "Documents").click();
  await expect(page.locator("#breadcrumbs")).toContainText("Documents");
  await expect(page.locator("#loading")).toBeHidden();
}

// Pages through the listing until the row appears or no more pages are left.
async function expectRowEventually(page, name) {
  await expect(async () => {
    if (await row(page, name).count() === 0 && await page.locator("#load-more").isVisible()) {
      await page.locator("#load-more").click();
    }
    await expect(row(page, name)).toHaveCount(1, { timeout: 1000 });
  }).toPass({ timeout: 20_000 });
}

test.describe("New Folder", () => {
  const created = [];

  test.afterEach(async ({ request }) => {
    if (!isLive) return;
    for (const id of created.splice(0)) {
      await request.delete(`${GRAPH}/me/drive/items/${encodeURIComponent(id)}`, {
        headers: { Authorization: `Bearer ${liveToken}` },
      });
    }
  });

  test("creates a folder inside Documents", async ({ page, drive, request }) => {
    const name = randomFolderName();
    await openDocuments(page);

    await page.getByRole("button", { name: "New Folder" }).click();
    const dialog = page.getByRole("dialog", { name: "New Folder" });
    await expect(dialog).toBeVisible();
    await expect(dialog.locator("#new-folder-path")).toHaveText("OneDrive / Documents");

    await dialog.getByLabel("Folder name").fill(name);
    await dialog.getByRole("button", { name: "Create" }).click();
    await expect(dialog).toBeHidden();

    // The listing refreshes and shows the new subfolder.
    await expectRowEventually(page, name);
    await expect(row(page, name).locator(".icon")).toHaveText("📁");

    // And it really exists in the drive, under Documents.
    if (isLive) {
      const headers = { Authorization: `Bearer ${liveToken}` };
      const res = await request.get(`${GRAPH}/me/drive/root:/Documents/${encodeURIComponent(name)}`, { headers });
      expect(res.ok()).toBeTruthy();
      const item = await res.json();
      created.push(item.id);
      expect(item.folder).toBeTruthy();
    } else {
      const docs = drive.children(null).find((i) => i.name === "Documents");
      const sub = drive.children(docs.id).find((i) => i.name === name);
      expect(sub?.folder).toBeTruthy();
    }
  });

  test("Cancel closes the dialog without creating anything", async ({ page, drive }) => {
    test.skip(isLive, "fake drive only");
    await openDocuments(page);
    await page.getByRole("button", { name: "New Folder" }).click();
    const dialog = page.getByRole("dialog", { name: "New Folder" });
    await dialog.getByLabel("Folder name").fill("should-not-exist");
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();
    const docs = drive.children(null).find((i) => i.name === "Documents");
    expect(drive.children(docs.id)).toHaveLength(0);
  });

  test("shows the root path when at the top level", async ({ page, drive }) => {
    test.skip(isLive, "fake drive only");
    await page.goto("/");
    await expect(row(page, "Documents")).toBeVisible();
    await page.getByRole("button", { name: "New Folder" }).click();
    await expect(page.locator("#new-folder-path")).toHaveText("OneDrive");
  });

  test("shows a toast with the OneDrive error when creation fails", async ({ page, drive }) => {
    test.skip(isLive, "fake drive only");
    drive.failNextCreate = {
      status: 403,
      body: { error: { code: "accessDenied", message: "Access denied", innerError: { "request-id": "abc-123" } } },
    };
    await openDocuments(page);
    await page.getByRole("button", { name: "New Folder" }).click();
    const dialog = page.getByRole("dialog", { name: "New Folder" });
    await dialog.getByLabel("Folder name").fill(randomFolderName());
    await dialog.getByRole("button", { name: "Create" }).click();

    const toast = page.locator("#toast");
    await expect(toast).toBeVisible();
    await expect(toast).toContainText("403");
    await expect(toast).toContainText("accessDenied");
    await expect(toast).toContainText("Access denied");
    await expect(toast).toContainText("abc-123");
  });
});
