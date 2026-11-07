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

test("NAV-001: an \"Up\" button is present", async ({ page }) => {
  const artefactsDir = process.env.ARTEFACTS_DIR;

  await page.goto(`https://rubisco.io/`);
  await expect(page.getByText("Loading")).not.toBeVisible();
  await page.screenshot({ path: `${artefactsDir}/04-00-signed-in.png` });

  await expect(page.getByRole("button", { name: "↑ Up", exact: true })).toBeVisible();
});

test("NAV-002: the folder selected in the listing is the one the toolbar acts on", async ({ page }) => {
  const artefactsDir = process.env.ARTEFACTS_DIR;
  const folderName = randomFolderName();
  const toolbar = {
    up: page.getByRole("button", { name: "↑ Up", exact: true }),
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
    for (const button of [toolbar.up, ...folderActions]) await expect(button).toBeDisabled();
    await page.screenshot({ path: `${artefactsDir}/04-10-nothing-selected.png` });

    await selectFolder(page, "Documents");
    for (const button of [toolbar.up, ...folderActions]) await expect(button).toBeEnabled();
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
    await expect(toolbar.up).toBeEnabled();
    await page.screenshot({ path: `${artefactsDir}/04-12-file-selected.png` });

    // Up selects the folder above the selected item, keeping the preview.
    await toolbar.up.click();
    await expect(listingRow(page, folderName)).toHaveAttribute("aria-selected", "true");
    for (const button of folderActions) await expect(button).toBeEnabled();
    await expect(page.locator("#viewer-title")).toHaveText("notes.txt");
    await toolbar.up.click();
    await expect(listingRow(page, "Documents")).toHaveAttribute("aria-selected", "true");
    // Above a top-level folder there's only the root: nothing is selected.
    await toolbar.up.click();
    await expect(listingRow(page, "Documents")).toHaveAttribute("aria-selected", "false");
    for (const button of [toolbar.up, ...folderActions]) await expect(button).toBeDisabled();

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
