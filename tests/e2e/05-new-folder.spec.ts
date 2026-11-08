import { randomBytes } from "node:crypto";
import { test, expect } from "./fixtures.ts";
import { listingRow, selectFolder } from "./lib/listing.ts";
import type { Page } from "@playwright/test";

// Deletes /Documents/<name> (recursively) using the app's own signed-in
// token. A 404 just means it is already gone.
async function removeFromDocuments(page: Page, name: string) {
  await page.evaluate(async (name) => {
    const { getToken } = await import("./auth.js");
    const { config } = await import("./config.js");
    const token = await getToken();
    const res = await fetch(
      `${config.graphBase}/me/drive/root:/Documents/${encodeURIComponent(name)}`,
      { method: "DELETE", headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok && res.status !== 404) {
      throw new Error(`Cleanup failed: ${res.status} ${await res.text()}`);
    }
  }, name);
}

test('FOLDER-001: create a new folder inside the selected "Documents"', async ({ page }) => {
  const artefactsDir = process.env.ARTEFACTS_DIR;
  const folderName = `e2e-test-${randomBytes(6).toString("hex")}`;

  await page.goto(`https://rubisco.io/`);
  await expect(page.getByText("Loading")).not.toBeVisible();
  await page.screenshot({ path: `${artefactsDir}/05-00-start.png` });

  // Without a selected folder there is nowhere to create one.
  await expect(page.getByRole("button", { name: "New Folder" })).toBeDisabled();
  await selectFolder(page, "Documents");
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
  try {
    // It shows up inside Documents, which stays selected; the listing's root
    // is still the drive's.
    const row = listingRow(page, folderName);
    await expect(row).toBeVisible();
    await expect(row).toHaveAttribute("data-item-type", "folder");
    await expect(row).toHaveAttribute("aria-level", "2");
    await expect(listingRow(page, "Documents")).toHaveAttribute("aria-level", "1");
    await expect(listingRow(page, "Documents")).toHaveAttribute("aria-selected", "true");
    await page.screenshot({ path: `${artefactsDir}/05-03-created.png` });
  } finally {
    // Clean up so test folders don't pile up in the real account. Runs in
    // the page so it can reuse the app's own signed-in token via auth.js.
    await removeFromDocuments(page, folderName);
  }
});

test("FOLDER-002: cancelling the New Folder dialog closes it without creating anything", async ({ page }) => {
  const artefactsDir = process.env.ARTEFACTS_DIR;

  await page.goto(`https://rubisco.io/`);
  await expect(page.getByText("Loading")).not.toBeVisible();
  await selectFolder(page, "Documents");

  await page.getByRole("button", { name: "New Folder" }).click();
  const dialog = page.getByRole("dialog", { name: "New Folder" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("/Documents");

  await dialog.getByLabel("Folder name").fill("e2e-test-should-not-exist");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).not.toBeVisible();
  await page.screenshot({ path: `${artefactsDir}/05-10-cancelled.png` });

  await expect(listingRow(page, "e2e-test-should-not-exist")).toHaveCount(0);
});

// Graph rejects the name with 409 nameAlreadyExists because the app sends
// conflictBehavior "fail", so creating a folder twice exercises the error
// path without any mocking.
test("FOLDER-003: a failed create shows a toast with OneDrive's error", async ({ page }) => {
  const artefactsDir = process.env.ARTEFACTS_DIR;
  const folderName = `e2e-test-${randomBytes(6).toString("hex")}`;

  await page.goto(`https://rubisco.io/`);
  await expect(page.getByText("Loading")).not.toBeVisible();
  await selectFolder(page, "Documents");

  const dialog = page.getByRole("dialog", { name: "New Folder" });
  try {
    for (let i = 0; i < 2; i++) {
      await page.getByRole("button", { name: "New Folder" }).click();
      await dialog.getByLabel("Folder name").fill(folderName);
      await dialog.getByRole("button", { name: "Create" }).click();
      await expect(dialog).not.toBeVisible();
    }

    const toast = page.locator("#toast");
    await expect(toast).toBeVisible();
    await expect(toast).toContainText("409");
    await expect(toast).toContainText("nameAlreadyExists");
    await page.screenshot({ path: `${artefactsDir}/05-20-error-toast.png` });
  } finally {
    await removeFromDocuments(page, folderName);
  }
});
