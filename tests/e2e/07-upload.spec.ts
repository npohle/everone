import { randomBytes } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test, expect } from "./fixtures.ts";
import type { Locator, Page } from "@playwright/test";

const randomFolderName = () => `e2e-test-${randomBytes(6).toString("hex")}`;

// Writes text files with random content into a fresh temp directory and
// returns their absolute paths keyed by file name.
function createLocalFiles(...names: string[]): Record<string, string> {
  const dir = mkdtempSync(path.join(tmpdir(), "e2e-upload-"));
  return Object.fromEntries(names.map((name) => {
    const file = path.join(dir, name);
    writeFileSync(file, `${name}: ${randomBytes(32).toString("hex")}\n`);
    return [name, file];
  }));
}

async function openDocuments(page: Page) {
  await page.goto(`https://npohle.github.io/everone/`);
  await expect(page.getByText("Loading")).not.toBeVisible();
  await page.locator("#listing").getByText("Documents", { exact: true }).click();
  await expect(page.locator("#breadcrumbs")).toContainText("Documents");
  await expect(page.getByText("Loading")).not.toBeVisible();
}

async function createFolderViaUi(page: Page, name: string) {
  await page.getByRole("button", { name: "New Folder" }).click();
  const dialog = page.getByRole("dialog", { name: "New Folder" });
  await dialog.getByLabel("Folder name").fill(name);
  await dialog.getByRole("button", { name: "Create" }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByText("Loading")).not.toBeVisible();
  await expect(page.locator("#listing").getByText(name, { exact: true })).toBeVisible();
}

async function openFolder(page: Page, name: string) {
  await page.locator("#listing").getByText(name, { exact: true }).click();
  await expect(page.locator("#breadcrumbs > span:last-child")).toHaveText(name);
  await expect(page.getByText("Loading")).not.toBeVisible();
}

async function openUploadDialog(page: Page) {
  await page.getByRole("button", { name: "Upload", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Upload Files" });
  await expect(dialog).toBeVisible();
  return dialog;
}

// Clicks "File Selector" and answers the native file picker it opens.
async function pickFiles(page: Page, dialog: Locator, files: string[]) {
  const chooserPromise = page.waitForEvent("filechooser");
  await dialog.getByRole("button", { name: "File Selector" }).click();
  const chooser = await chooserPromise;
  expect(chooser.isMultiple()).toBe(true);
  await chooser.setFiles(files);
}

// Best-effort cleanup of whatever a test left behind under /Documents, using
// the app's own signed-in token. Graph deletes recursively.
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

test("UPLOAD-001: upload multiple files into a new folder", async ({ page }) => {
  const artefactsDir = process.env.ARTEFACTS_DIR;
  const folderName = randomFolderName();
  const files = createLocalFiles("file1.txt", "file2.txt", "file3.txt");
  const listing = page.locator("#listing");

  await openDocuments(page);
  await page.screenshot({ path: `${artefactsDir}/07-00-documents.png` });

  try {
    await createFolderViaUi(page, folderName);
    await openFolder(page, folderName);
    await expect(listing).toContainText("This folder is empty.");

    const dialog = await openUploadDialog(page);
    await expect(dialog).toContainText(`/Documents/${folderName}`);
    const fileList = dialog.getByRole("list", { name: "Files to upload" });
    const entries = fileList.getByRole("listitem");

    await pickFiles(page, dialog, [files["file1.txt"], files["file2.txt"], files["file3.txt"]]);
    await expect(entries).toHaveCount(3);
    for (const name of ["file1.txt", "file2.txt", "file3.txt"]) {
      await expect(fileList.getByText(name, { exact: true })).toHaveCount(1);
    }
    await page.screenshot({ path: `${artefactsDir}/07-01-picked.png` });

    await dialog.getByRole("button", { name: "Remove file2.txt" }).click();
    await expect(fileList.getByText("file2.txt", { exact: true })).toHaveCount(0);
    await expect(entries).toHaveCount(2);

    // Picking file1.txt again must not produce a duplicate entry.
    await pickFiles(page, dialog, [files["file1.txt"]]);
    await expect(entries).toHaveCount(2);
    await expect(entries.nth(0)).toContainText("file1.txt");
    await expect(entries.nth(1)).toContainText("file3.txt");
    await expect(fileList.getByText("file1.txt", { exact: true })).toHaveCount(1);
    await expect(fileList.getByText("file3.txt", { exact: true })).toHaveCount(1);
    await page.screenshot({ path: `${artefactsDir}/07-02-deduped.png` });

    await dialog.getByRole("button", { name: "Upload", exact: true }).click();
    // While uploading (or once done) the remove icons are gone.
    await expect(dialog.getByRole("button", { name: /^Remove / })).toHaveCount(0);

    const closeBtn = dialog.getByRole("button", { name: "Close" });
    await expect(closeBtn).toBeVisible({ timeout: 30_000 });
    await expect(closeBtn).toBeEnabled();
    await expect(dialog.getByRole("button", { name: "Upload", exact: true })).toHaveCount(0);
    for (const name of ["file1.txt", "file3.txt"]) {
      const entry = entries.filter({ hasText: name });
      await expect(entry.getByRole("img", { name: "Uploaded" })).toBeVisible();
    }
    await expect(fileList.getByRole("img", { name: "Upload failed" })).toHaveCount(0);
    await page.screenshot({ path: `${artefactsDir}/07-03-uploaded.png` });

    await closeBtn.click();
    await expect(dialog).not.toBeVisible();
    await expect(page.getByText("Loading")).not.toBeVisible();
    await expect(page.locator("#breadcrumbs > span:last-child")).toHaveText(folderName);
    const rows = listing.locator(".row:not(.head)");
    await expect(rows).toHaveCount(2);
    await expect(listing.getByText("file1.txt", { exact: true })).toBeVisible();
    await expect(listing.getByText("file3.txt", { exact: true })).toBeVisible();
    await expect(listing.getByText("file2.txt", { exact: true })).toHaveCount(0);
    await page.screenshot({ path: `${artefactsDir}/07-04-listing.png` });
  } finally {
    await removeFromDocuments(page, folderName);
  }
});

test("UPLOAD-002: cancelling the Upload dialog uploads nothing", async ({ page }) => {
  const artefactsDir = process.env.ARTEFACTS_DIR;
  const folderName = randomFolderName();
  const files = createLocalFiles("cancel1.txt", "cancel2.txt");
  const listing = page.locator("#listing");

  await openDocuments(page);
  try {
    await createFolderViaUi(page, folderName);
    await openFolder(page, folderName);

    const dialog = await openUploadDialog(page);
    // Nothing picked yet, so there is nothing to upload.
    await expect(dialog.getByRole("button", { name: "Upload", exact: true })).toBeDisabled();
    await pickFiles(page, dialog, Object.values(files));
    await expect(dialog.getByRole("listitem")).toHaveCount(2);
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await page.screenshot({ path: `${artefactsDir}/07-10-cancelled.png` });

    await page.reload();
    await openFolder(page, "Documents");
    await openFolder(page, folderName);
    await expect(listing).toContainText("This folder is empty.");

    // Re-opening starts from an empty list.
    const reopened = await openUploadDialog(page);
    await expect(reopened.getByRole("listitem")).toHaveCount(0);
  } finally {
    await removeFromDocuments(page, folderName);
  }
});

// Uploads use conflictBehavior "fail", so re-uploading an existing name is
// rejected by OneDrive and exercises the failed icon without any mocking.
test("UPLOAD-003: files that already exist are marked as failed, others still upload", async ({ page }) => {
  const artefactsDir = process.env.ARTEFACTS_DIR;
  const folderName = randomFolderName();
  const files = createLocalFiles("existing.txt", "fresh.txt");
  const listing = page.locator("#listing");

  await openDocuments(page);
  try {
    await createFolderViaUi(page, folderName);
    await openFolder(page, folderName);

    let dialog = await openUploadDialog(page);
    await pickFiles(page, dialog, [files["existing.txt"]]);
    await dialog.getByRole("button", { name: "Upload", exact: true }).click();
    await dialog.getByRole("button", { name: "Close" }).click({ timeout: 30_000 });
    await expect(dialog).not.toBeVisible();
    await expect(listing.getByText("existing.txt", { exact: true })).toBeVisible();

    dialog = await openUploadDialog(page);
    await pickFiles(page, dialog, [files["existing.txt"], files["fresh.txt"]]);
    await dialog.getByRole("button", { name: "Upload", exact: true }).click();
    const closeBtn = dialog.getByRole("button", { name: "Close" });
    await expect(closeBtn).toBeEnabled({ timeout: 30_000 });

    const entries = dialog.getByRole("listitem");
    await expect(entries.filter({ hasText: "existing.txt" }).getByRole("img", { name: "Upload failed" })).toBeVisible();
    await expect(entries.filter({ hasText: "fresh.txt" }).getByRole("img", { name: "Uploaded" })).toBeVisible();
    await page.screenshot({ path: `${artefactsDir}/07-20-partial-failure.png` });

    await closeBtn.click();
    await expect(dialog).not.toBeVisible();
    await expect(page.getByText("Loading")).not.toBeVisible();
    await expect(listing.locator(".row:not(.head)")).toHaveCount(2);
    await expect(listing.getByText("fresh.txt", { exact: true })).toBeVisible();
  } finally {
    await removeFromDocuments(page, folderName);
  }
});
