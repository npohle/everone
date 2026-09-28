import { randomBytes } from "node:crypto";
import { test, expect } from "./fixtures.ts";

test('FOLDER-001: create a new folder inside "Documents"', async ({ page }) => {
  const artefactsDir = process.env.ARTEFACTS_DIR;
  const folderName = `e2e-test-${randomBytes(6).toString("hex")}`;
  const listing = page.locator("#listing");

  await page.goto(`https://npohle.github.io/everone/`);
  await expect(page.getByText("Loading")).not.toBeVisible();
  await page.screenshot({ path: `${artefactsDir}/05-00-start.png` });

  await listing.getByText("Documents", { exact: true }).click();
  await expect(page.locator("#breadcrumbs")).toContainText("Documents");
  await expect(page.getByText("Loading")).not.toBeVisible();
  await page.screenshot({ path: `${artefactsDir}/05-01-documents.png` });

  await page.getByRole("button", { name: "New Folder" }).click();
  const dialog = page.getByRole("dialog", { name: "New Folder" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("/Documents");

  await dialog.getByLabel("Folder name").fill(folderName);
  await page.screenshot({ path: `${artefactsDir}/05-02-dialog.png` });
  await dialog.getByRole("button", { name: "Create" }).click();

  await expect(dialog).not.toBeVisible();
  await expect(page.getByText("Loading")).not.toBeVisible();
  const row = listing.locator(".row", { has: page.getByText(folderName, { exact: true }) });
  await expect(row).toBeVisible();
  await expect(row.locator(".icon")).toHaveText("📁");
  await page.screenshot({ path: `${artefactsDir}/05-03-created.png` });

  // Clean up so test folders don't pile up in the real account. Runs in the
  // page so it can reuse the app's own signed-in token via auth.js.
  await page.evaluate(async (name) => {
    const { getToken } = await import("./auth.js");
    const { config } = await import("./config.js");
    const token = await getToken();
    const res = await fetch(
      `${config.graphBase}/me/drive/root:/Documents/${encodeURIComponent(name)}`,
      { method: "DELETE", headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) throw new Error(`Cleanup failed: ${res.status} ${await res.text()}`);
  }, folderName);
});

test("FOLDER-002: cancelling the New Folder dialog closes it without creating anything", async ({ page }) => {
  const artefactsDir = process.env.ARTEFACTS_DIR;

  await page.goto(`https://npohle.github.io/everone/`);
  await expect(page.getByText("Loading")).not.toBeVisible();

  await page.getByRole("button", { name: "New Folder" }).click();
  const dialog = page.getByRole("dialog", { name: "New Folder" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("/");

  await dialog.getByLabel("Folder name").fill("e2e-test-should-not-exist");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).not.toBeVisible();
  await page.screenshot({ path: `${artefactsDir}/05-10-cancelled.png` });

  await expect(page.locator("#listing").getByText("e2e-test-should-not-exist", { exact: true })).toHaveCount(0);
});

// Graph rejects the name with 409 nameAlreadyExists because the app sends
// conflictBehavior "fail", so this exercises the error path without creating
// anything in the account.
test("FOLDER-003: a failed create shows a toast with OneDrive's error", async ({ page }) => {
  const artefactsDir = process.env.ARTEFACTS_DIR;

  await page.goto(`https://npohle.github.io/everone/`);
  await expect(page.getByText("Loading")).not.toBeVisible();

  await page.getByRole("button", { name: "New Folder" }).click();
  const dialog = page.getByRole("dialog", { name: "New Folder" });
  await dialog.getByLabel("Folder name").fill("Documents");
  await dialog.getByRole("button", { name: "Create" }).click();

  const toast = page.locator("#toast");
  await expect(toast).toBeVisible();
  await expect(toast).toContainText("409");
  await expect(toast).toContainText("nameAlreadyExists");
  await page.screenshot({ path: `${artefactsDir}/05-20-error-toast.png` });
});
