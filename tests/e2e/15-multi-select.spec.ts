import { randomBytes } from "node:crypto";
import { test, expect } from "./fixtures.ts";
import { listingRow, selectFolder } from "./lib/listing.ts";
import type { Locator, Page } from "@playwright/test";

// Ctrl-clicking rows of the listing adds them to its selection, or takes them
// out of it, in any folder. A folder ctrl-clicked brings everything inside it
// along, down to its deepest subfolders (loading what isn't yet). Once more
// than one document is selected, the preview pane lists their names.

const randomFolderName = () => `e2e-test-${randomBytes(6).toString("hex")}`;

// Creates text files under /Documents/<folder>/ (paths relative to it; Graph
// creates missing folders on the way), using the app's own signed-in token.
async function createInDocuments(page: Page, folder: string, paths: string[]) {
  await page.evaluate(async ({ folder, paths }) => {
    const { getToken } = await import("./auth.js");
    const { config } = await import("./config.js");
    const token = await getToken();
    for (const path of paths) {
      const encoded = [folder, ...path.split("/")].map(encodeURIComponent).join("/");
      const res = await fetch(`${config.graphBase}/me/drive/root:/Documents/${encoded}:/content`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "text/plain" },
        body: `content of ${path}`,
      });
      if (!res.ok) throw new Error(`Upload of ${path} failed: ${res.status} ${await res.text()}`);
    }
  }, { folder, paths });
}

// Deletes /Documents/<folder> (recursively) using the app's own signed-in
// token. A 404 just means it is already gone.
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

async function openFolder(page: Page, folderName: string) {
  await page.goto(`https://rubisco.io/`);
  await expect(page.getByText("Loading")).not.toBeVisible();
  await selectFolder(page, "Documents");
  await selectFolder(page, folderName);
}

const ctrlClick = (row: Locator) => row.click({ modifiers: ["ControlOrMeta"] });

const background = (row: Locator) => row.evaluate((el) => getComputedStyle(el).backgroundColor);

// The names listed in the preview pane, in the order shown.
const selectionList = (page: Page) => page.locator("#viewer-body .selection-list li");

test("MULTI-SELECT-001: ctrl-click selects and deselects documents, across folders", async ({ page }) => {
  const artefactsDir = process.env.ARTEFACTS_DIR;
  const folderName = randomFolderName();

  await page.goto(`https://rubisco.io/`);
  await expect(page.getByText("Loading")).not.toBeVisible();
  await selectFolder(page, "Documents");
  try {
    await createInDocuments(page, folderName, ["a.txt", "b.txt", "Sub/c.txt"]);
    await openFolder(page, folderName);
    await selectFolder(page, "Sub");

    const a = listingRow(page, "a.txt");
    const b = listingRow(page, "b.txt");
    const c = listingRow(page, "c.txt");
    const title = page.locator("#viewer-title");

    // A plain click selects one document and previews it.
    await a.click();
    await expect(a).toHaveAttribute("aria-selected", "true");
    await expect(title).toHaveText("a.txt");
    const selectedBackground = await background(a);
    expect(selectedBackground).not.toBe(await background(b));

    // Ctrl-click adds a document in another folder; both are highlighted
    // like a single selected row, and the preview lists their names.
    await ctrlClick(c);
    await expect(a).toHaveAttribute("aria-selected", "true");
    await expect(c).toHaveAttribute("aria-selected", "true");
    await expect(b).not.toHaveAttribute("aria-selected", "true");
    expect(await background(a)).toBe(selectedBackground);
    expect(await background(c)).toBe(selectedBackground);
    await expect(title).toHaveText("2 documents selected");
    await expect(selectionList(page)).toHaveText(["c.txt", "a.txt"]);
    await expect(page.locator("#viewer-download")).toBeHidden();
    await page.screenshot({ path: `${artefactsDir}/15-00-two-selected.png` });

    await ctrlClick(b);
    await expect(b).toHaveAttribute("aria-selected", "true");
    expect(await background(b)).toBe(selectedBackground);
    await expect(title).toHaveText("3 documents selected");
    await expect(selectionList(page)).toHaveText(["c.txt", "a.txt", "b.txt"]);
    await expect(page.locator("#listing")).toContainText("3 items selected");
    await page.screenshot({ path: `${artefactsDir}/15-01-three-selected.png` });

    // Ctrl-clicking a selected document deselects it, and only it.
    await ctrlClick(a);
    await expect(a).not.toHaveAttribute("aria-selected", "true");
    await expect(b).toHaveAttribute("aria-selected", "true");
    await expect(c).toHaveAttribute("aria-selected", "true");
    expect(await background(a)).not.toBe(selectedBackground);
    await expect(selectionList(page)).toHaveText(["c.txt", "b.txt"]);

    // Down to one document, it is previewed again.
    await ctrlClick(b);
    await expect(b).not.toHaveAttribute("aria-selected", "true");
    await expect(c).toHaveAttribute("aria-selected", "true");
    await expect(title).toHaveText("c.txt");
    await expect(page.locator("#viewer-body")).toContainText("content of Sub/c.txt");
    await page.screenshot({ path: `${artefactsDir}/15-02-one-left.png` });

    // A plain click starts over with just the row clicked.
    await ctrlClick(a);
    await expect(title).toHaveText("2 documents selected");
    await b.click();
    await expect(b).toHaveAttribute("aria-selected", "true");
    await expect(a).not.toHaveAttribute("aria-selected", "true");
    await expect(c).not.toHaveAttribute("aria-selected", "true");
    await expect(title).toHaveText("b.txt");
  } finally {
    await removeFromDocuments(page, folderName);
  }
});

test("MULTI-SELECT-002: ctrl-clicking a folder selects everything inside it, recursively", async ({ page }) => {
  const artefactsDir = process.env.ARTEFACTS_DIR;
  const folderName = randomFolderName();

  await page.goto(`https://rubisco.io/`);
  await expect(page.getByText("Loading")).not.toBeVisible();
  await selectFolder(page, "Documents");
  try {
    await createInDocuments(page, folderName, [
      "top.txt",
      "Archiv/brief.txt",
      "Archiv/Tief/deep.txt",
    ]);
    await openFolder(page, folderName);

    const top = listingRow(page, "top.txt");
    const archiv = listingRow(page, "Archiv");
    const title = page.locator("#viewer-title");

    await top.click();
    await expect(title).toHaveText("top.txt");
    const selectedBackground = await background(top);

    // Archiv hasn't been opened yet: its documents, and those of its
    // subfolder, are loaded to be selected. Ctrl-click doesn't open it.
    await ctrlClick(archiv);
    await expect(archiv).toHaveAttribute("aria-selected", "true");
    await expect(archiv).toHaveAttribute("aria-expanded", "false");
    await expect(top).toHaveAttribute("aria-selected", "true");
    expect(await background(archiv)).toBe(selectedBackground);
    await expect(title).toHaveText("3 documents selected");
    await expect(selectionList(page)).toHaveText(["deep.txt", "brief.txt", "top.txt"]);
    // The folder actions need a single selected folder.
    await expect(page.locator('#listing [data-action="new-folder"]')).toBeDisabled();
    await expect(page.locator('#listing [data-action="upload"]')).toBeDisabled();
    await page.screenshot({ path: `${artefactsDir}/15-10-folder-selected.png` });

    // Opened, everything inside shows highlighted.
    await archiv.focus();
    await page.keyboard.press("ArrowRight");
    await expect(archiv).toHaveAttribute("aria-expanded", "true");
    const tief = listingRow(page, "Tief");
    const brief = listingRow(page, "brief.txt");
    for (const row of [tief, brief]) {
      await expect(row).toHaveAttribute("aria-selected", "true");
      expect(await background(row)).toBe(selectedBackground);
    }
    await page.screenshot({ path: `${artefactsDir}/15-11-folder-opened.png` });

    // Deselecting a subfolder deselects what's inside it, and the folders
    // above it, which aren't wholly selected any more.
    await ctrlClick(tief);
    await expect(tief).not.toHaveAttribute("aria-selected", "true");
    await expect(archiv).not.toHaveAttribute("aria-selected", "true");
    await expect(brief).toHaveAttribute("aria-selected", "true");
    await expect(top).toHaveAttribute("aria-selected", "true");
    await expect(selectionList(page)).toHaveText(["brief.txt", "top.txt"]);
    await page.screenshot({ path: `${artefactsDir}/15-12-subfolder-deselected.png` });

    // Ctrl-clicking the folder again selects all of it once more, and once
    // more deselects all of it.
    await ctrlClick(archiv);
    await expect(selectionList(page)).toHaveText(["deep.txt", "brief.txt", "top.txt"]);
    await expect(tief).toHaveAttribute("aria-selected", "true");
    await ctrlClick(archiv);
    for (const row of [archiv, tief, brief]) {
      await expect(row).not.toHaveAttribute("aria-selected", "true");
    }
    await expect(top).toHaveAttribute("aria-selected", "true");
    await expect(title).toHaveText("top.txt");
  } finally {
    await removeFromDocuments(page, folderName);
  }
});
