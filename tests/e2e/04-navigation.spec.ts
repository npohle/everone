import { randomBytes } from "node:crypto";
import { test, expect } from "./fixtures.ts";
import { listingRow, selectFolder } from "./lib/listing.ts";
import type { Page } from "@playwright/test";

const randomFolderName = () => `e2e-test-${randomBytes(6).toString("hex")}`;

// Creates /Documents/<folder>/notes.txt using the app's own signed-in token.
async function createNotesInDocuments(page: Page, folder: string) {
  await page.evaluate(async (folder) => {
    const { getToken } = await import("./auth.js");
    const { config } = await import("./config.js");
    const token = await getToken();
    const res = await fetch(`${config.graphBase}/me/drive/root:/Documents/${encodeURIComponent(folder)}/notes.txt:/content`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "text/plain" },
      body: "notes",
    });
    if (!res.ok) throw new Error(`Upload failed: ${res.status} ${await res.text()}`);
  }, folder);
}

// Deletes /Documents/<folder> (recursively). A 404 just means it is gone.
async function removeFromDocuments(page: Page, folder: string) {
  await page.evaluate(async (folder) => {
    const { getToken } = await import("./auth.js");
    const { config } = await import("./config.js");
    const token = await getToken();
    const res = await fetch(
      `${config.graphBase}/me/drive/root:/Documents/${encodeURIComponent(folder)}`,
      { method: "DELETE", headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok && res.status !== 404) {
      throw new Error(`Cleanup failed: ${res.status} ${await res.text()}`);
    }
  }, folder);
}

test("NAV-001: no Up button, and no navigation, view switcher or title in the listing", async ({ page }) => {
  const artefactsDir = process.env.ARTEFACTS_DIR;

  await page.goto(`https://rubisco.io/`);
  await expect(page.getByText("Loading")).not.toBeVisible();
  const listing = page.locator("#listing");
  await expect(listingRow(page, "Documents")).toBeVisible();
  await page.screenshot({ path: `${artefactsDir}/04-00-signed-in.png` });

  await expect(page.locator("#up-btn")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /\bUp\b/ })).toHaveCount(0);

  // The listing's header keeps sort, filter and search only.
  await expect(listing.getByRole("combobox", { name: "Sort by" })).toBeVisible();
  await expect(listing.getByRole("button", { name: "Filter" })).toBeVisible();
  for (const name of ["Back", "Forward"]) {
    await expect(listing.getByRole("button", { name, exact: true })).toHaveCount(0);
  }
  // The view switcher: tabs at full width, a select when narrow.
  await expect(listing.getByRole("tab")).toHaveCount(0);
  await expect(listing.getByRole("combobox", { name: "View", exact: true })).toHaveCount(0);
  // The current folder's title ("OneDrive" at the root).
  await expect(listing.getByText("OneDrive", { exact: true })).toHaveCount(0);
});

test("NAV-002: the folder selected in the listing is the one the toolbar acts on", async ({ page }) => {
  const artefactsDir = process.env.ARTEFACTS_DIR;
  const folderName = randomFolderName();
  const toolbar = {
    newFolder: page.getByRole("button", { name: "New Folder" }),
    upload: page.getByRole("button", { name: "Upload", exact: true }),
  };
  const folderActions = [toolbar.newFolder, toolbar.upload];

  await page.goto(`https://rubisco.io/`);
  await expect(page.getByText("Loading")).not.toBeVisible();
  // No breadcrumbs: the listing is where the folder is picked.
  await expect(page.locator("#breadcrumbs")).toHaveCount(0);

  try {
    await createNotesInDocuments(page, folderName);
    await page.reload();
    await expect(page.getByText("Loading")).not.toBeVisible();

    // Nothing selected yet, so there is no folder to act on.
    await expect(listingRow(page, "Documents")).toBeVisible();
    for (const button of folderActions) await expect(button).toBeDisabled();
    await page.screenshot({ path: `${artefactsDir}/04-10-nothing-selected.png` });

    await selectFolder(page, "Documents");
    for (const button of folderActions) await expect(button).toBeEnabled();
    await selectFolder(page, folderName);
    for (const button of folderActions) await expect(button).toBeEnabled();
    await expect(page.locator("#status")).toHaveText("1 item");
    await page.screenshot({ path: `${artefactsDir}/04-11-folder-selected.png` });

    // A selected file isn't a folder to act on.
    const notes = listingRow(page, "notes.txt");
    await notes.click();
    await expect(notes).toHaveAttribute("aria-selected", "true");
    await expect(page.locator("#viewer-title")).toHaveText("notes.txt");
    for (const button of folderActions) await expect(button).toBeDisabled();
    await page.screenshot({ path: `${artefactsDir}/04-12-file-selected.png` });

    // Double-clicking a folder doesn't make it the listing's root.
    await listingRow(page, folderName).dblclick();
    await expect(listingRow(page, "Documents")).toHaveAttribute("aria-level", "1");
    await expect(listingRow(page, folderName)).toHaveAttribute("aria-level", "2");
    await expect(listingRow(page, folderName)).toHaveAttribute("aria-selected", "true");
    for (const button of folderActions) await expect(button).toBeEnabled();
    await page.screenshot({ path: `${artefactsDir}/04-13-double-clicked.png` });
  } finally {
    await removeFromDocuments(page, folderName);
  }
});
