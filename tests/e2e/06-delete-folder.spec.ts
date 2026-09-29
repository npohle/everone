import { randomBytes } from "node:crypto";
import { test, expect } from "./fixtures.ts";
import type { Page } from "@playwright/test";

const randomFolderName = () => `e2e-test-${randomBytes(6).toString("hex")}`;

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

// Best-effort cleanup of whatever a test left behind under /Documents, using
// the app's own signed-in token. Graph deletes recursively, and a 404 just
// means the test already deleted it through the UI.
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

test("DELETE-001: only empty folders can be deleted, and deleting returns to the parent", async ({ page }) => {
  const artefactsDir = process.env.ARTEFACTS_DIR;
  const parentName = randomFolderName();
  const childName = randomFolderName();
  const listing = page.locator("#listing");
  const deleteBtn = page.getByRole("button", { name: "Delete Folder" });
  const dialog = page.getByRole("dialog", { name: "Delete Folder" });

  await openDocuments(page);
  await page.screenshot({ path: `${artefactsDir}/06-00-documents.png` });

  try {
    await createFolderViaUi(page, parentName);
    await openFolder(page, parentName);
    await createFolderViaUi(page, childName);
    await page.screenshot({ path: `${artefactsDir}/06-01-created.png` });

    // The parent contains the child folder, so it must not be deletable.
    await expect(deleteBtn).toBeVisible();
    await expect(deleteBtn).toBeDisabled();
    await page.screenshot({ path: `${artefactsDir}/06-02-parent-not-deletable.png` });

    // The child is empty, so it can be deleted.
    await openFolder(page, childName);
    await expect(listing).toContainText("This folder is empty.");
    await expect(deleteBtn).toBeEnabled();
    await deleteBtn.click();
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(`/Documents/${parentName}/${childName}`);
    await page.screenshot({ path: `${artefactsDir}/06-03-delete-child-dialog.png` });
    await dialog.getByRole("button", { name: "Delete" }).click();
    await expect(dialog).not.toBeVisible();

    // Back in the (now empty, refreshed) parent folder.
    await expect(page.locator("#breadcrumbs > span:last-child")).toHaveText(parentName);
    await expect(page.getByText("Loading")).not.toBeVisible();
    await expect(listing.getByText(childName, { exact: true })).toHaveCount(0);
    await expect(listing).toContainText("This folder is empty.");
    await page.screenshot({ path: `${artefactsDir}/06-04-child-deleted.png` });

    // With the child gone the parent is empty and can be deleted too.
    await expect(deleteBtn).toBeEnabled();
    await deleteBtn.click();
    await expect(dialog).toContainText(`/Documents/${parentName}`);
    await dialog.getByRole("button", { name: "Delete" }).click();
    await expect(dialog).not.toBeVisible();

    await expect(page.locator("#breadcrumbs > span:last-child")).toHaveText("Documents");
    await expect(page.getByText("Loading")).not.toBeVisible();
    await expect(listing.getByText(parentName, { exact: true })).toHaveCount(0);
    await page.screenshot({ path: `${artefactsDir}/06-05-parent-deleted.png` });
  } finally {
    await removeFromDocuments(page, parentName);
  }
});

test("DELETE-002: cancelling the Delete Folder dialog keeps the folder", async ({ page }) => {
  const artefactsDir = process.env.ARTEFACTS_DIR;
  const folderName = randomFolderName();
  const deleteBtn = page.getByRole("button", { name: "Delete Folder" });
  const dialog = page.getByRole("dialog", { name: "Delete Folder" });

  await openDocuments(page);
  try {
    await createFolderViaUi(page, folderName);
    await openFolder(page, folderName);

    await deleteBtn.click();
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(`/Documents/${folderName}`);
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).not.toBeVisible();
    await page.screenshot({ path: `${artefactsDir}/06-10-cancelled.png` });

    // Still inside the folder, and it still exists in Documents.
    await expect(page.locator("#breadcrumbs > span:last-child")).toHaveText(folderName);
    await page.locator("#breadcrumbs").getByText("Documents", { exact: true }).click();
    await expect(page.getByText("Loading")).not.toBeVisible();
    await expect(page.locator("#listing").getByText(folderName, { exact: true })).toBeVisible();
  } finally {
    await removeFromDocuments(page, folderName);
  }
});

// The non-empty case is covered by DELETE-001 against a folder it creates
// itself, since the account's existing folders may or may not be empty.
test("DELETE-003: the Delete Folder button is visible but disabled at the root", async ({ page }) => {
  const deleteBtn = page.getByRole("button", { name: "Delete Folder" });

  await page.goto(`https://npohle.github.io/everone/`);
  await expect(page.getByText("Loading")).not.toBeVisible();
  await expect(page.locator("#listing").getByText("Documents", { exact: true })).toBeVisible();
  await expect(deleteBtn).toBeVisible();
  await expect(deleteBtn).toBeDisabled();
});

// Deleting the folder behind the app's back makes the real Graph request fail
// with 404 itemNotFound, exercising the error path without any mocking.
test("DELETE-004: a failed delete shows a toast with OneDrive's error", async ({ page }) => {
  const artefactsDir = process.env.ARTEFACTS_DIR;
  const folderName = randomFolderName();
  const deleteBtn = page.getByRole("button", { name: "Delete Folder" });
  const dialog = page.getByRole("dialog", { name: "Delete Folder" });

  await openDocuments(page);
  try {
    await createFolderViaUi(page, folderName);
    await openFolder(page, folderName);
    await removeFromDocuments(page, folderName);

    await deleteBtn.click();
    await dialog.getByRole("button", { name: "Delete" }).click();

    const toast = page.locator("#toast");
    await expect(toast).toBeVisible();
    await expect(toast).toContainText("404");
    await expect(toast).toContainText("itemNotFound");
    await page.screenshot({ path: `${artefactsDir}/06-20-error-toast.png` });
  } finally {
    await removeFromDocuments(page, folderName);
  }
});
