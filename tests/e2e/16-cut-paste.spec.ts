import { randomBytes } from "node:crypto";
import { test, expect } from "./fixtures.ts";
import { listingRow, rowsInFolder, selectFolder } from "./lib/listing.ts";
import type { Locator, Page } from "@playwright/test";

// Cut puts the documents and folders selected in the listing into an
// internal clipboard, and greys them out there; Paste moves them, through
// Graph, into the folder selected then. A toast's progress bar counts the
// moves, and the listing shows each item in its new place once it's moved.

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

// The names of what OneDrive has in /Documents/<path>, sorted.
async function namesInDocuments(page: Page, path: string): Promise<string[]> {
  return page.evaluate(async (path) => {
    const { getToken } = await import("./auth.js");
    const { config } = await import("./config.js");
    const token = await getToken();
    const encoded = path.split("/").map(encodeURIComponent).join("/");
    const res = await fetch(`${config.graphBase}/me/drive/root:/Documents/${encoded}:/children?$select=name`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`Listing ${path} failed: ${res.status} ${await res.text()}`);
    return (await res.json()).value.map((item: { name: string }) => item.name).sort();
  }, path);
}

async function openFolder(page: Page, folderName: string) {
  await page.goto(`https://rubisco.io/`);
  await expect(page.getByText("Loading")).not.toBeVisible();
  await selectFolder(page, "Documents");
  await selectFolder(page, folderName);
}

const ctrlClick = (row: Locator) => row.click({ modifiers: ["ControlOrMeta"] });

const opacity = (row: Locator) => row.evaluate((el) => getComputedStyle(el).opacity);

// The names of the rows inside the folder named `name`, sorted.
async function namesInFolder(page: Page, name: string): Promise<string[]> {
  const rows = await rowsInFolder(page, name);
  return (await rows.evaluateAll((els) => els.map((el) => el.getAttribute("aria-label")!))).sort();
}

test("CUT-PASTE-001: Cut greys out the selected documents, Paste moves them into the selected folder", async ({ page }) => {
  const artefactsDir = process.env.ARTEFACTS_DIR;
  const folderName = randomFolderName();
  const listing = page.locator("#listing");
  const cut = listing.getByRole("button", { name: "Cut", exact: true });
  const paste = listing.getByRole("button", { name: "Paste", exact: true });
  const toast = page.locator("#toast");

  await page.goto(`https://rubisco.io/`);
  await expect(page.getByText("Loading")).not.toBeVisible();
  await selectFolder(page, "Documents");
  try {
    await createInDocuments(page, folderName, ["a.txt", "b.txt", "c.txt", "Target/keep.txt"]);
    await openFolder(page, folderName);

    const a = listingRow(page, "a.txt");
    const b = listingRow(page, "b.txt");
    const c = listingRow(page, "c.txt");

    // With the listing wide, they're icon buttons beside the folder actions,
    // left of the sort select. Nothing's cut yet, so there's nothing to paste.
    await expect(listing.getByRole("button", { name: "Tools" })).toHaveCount(0);
    const uploadBox = (await listing.getByRole("button", { name: "Upload", exact: true }).boundingBox())!;
    const sortBox = (await listing.getByRole("combobox", { name: "Sort by" }).boundingBox())!;
    for (const button of [cut, paste]) {
      const box = (await button.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(uploadBox.x + uploadBox.width);
      expect(box.x + box.width).toBeLessThanOrEqual(sortBox.x);
    }
    await expect(paste).toBeDisabled();

    await a.click();
    await ctrlClick(b);
    await expect(page.locator("#viewer-title")).toHaveText("2 documents selected");
    await expect(cut).toBeEnabled();
    await cut.click();

    // The cut documents are greyed out, the others aren't.
    await expect.poll(() => opacity(a)).toBe("0.5");
    await expect.poll(() => opacity(b)).toBe("0.5");
    expect(await opacity(c)).toBe("1");
    expect(await opacity(listingRow(page, "Target"))).toBe("1");
    // Paste needs a folder to paste into.
    await expect(paste).toBeDisabled();
    await page.screenshot({ path: `${artefactsDir}/16-00-cut.png` });

    await selectFolder(page, "Target");
    await expect(paste).toBeEnabled();

    // Hold the second move back, to see the listing show the first one
    // while the toast counts the moves.
    let moves = 0;
    let releaseSecond!: () => void;
    const secondHeld = new Promise<void>((resolve) => { releaseSecond = resolve; });
    await page.route(/graph\.microsoft\.com\/.*\/me\/drive\/items\/[^/?]+\?/, async (route) => {
      if (route.request().method() !== "PATCH") return route.fallback();
      moves += 1;
      if (moves === 2) await secondHeld;
      await route.fallback();
    });

    await paste.click();
    await expect(toast).toBeVisible();
    await expect(toast).toContainText(`Moving 2 items to /Documents/${folderName}/Target`);
    await expect(toast.locator("progress")).toBeVisible();
    await expect(toast).toContainText("(2 of 2)");
    await expect(toast.locator("progress")).toHaveJSProperty("value", 1);
    await expect.poll(() => namesInFolder(page, "Target")).toEqual(["a.txt", "keep.txt"]);
    await expect(a).toHaveCount(1);
    // In its new place, it isn't cut any more; the one still to move is.
    expect(await opacity(a)).toBe("1");
    expect(await opacity(b)).toBe("0.5");
    await expect(paste).toBeDisabled();
    await page.screenshot({ path: `${artefactsDir}/16-01-first-moved.png` });

    releaseSecond();
    await expect(toast).toContainText(`Moved 2 items to /Documents/${folderName}/Target`);
    await expect(toast.locator("progress")).toHaveJSProperty("value", 2);
    await expect.poll(() => namesInFolder(page, "Target")).toEqual(["a.txt", "b.txt", "keep.txt"]);
    await expect(b).toHaveCount(1);
    expect(await opacity(b)).toBe("1");
    // The test folder has just c.txt left, beside Target with the documents.
    await expect.poll(() => namesInFolder(page, folderName)).toEqual(["Target", "a.txt", "b.txt", "c.txt", "keep.txt"]);
    await page.screenshot({ path: `${artefactsDir}/16-02-pasted.png` });

    // The clipboard is empty again.
    await expect(paste).toBeDisabled();
    expect(await namesInDocuments(page, `${folderName}/Target`)).toEqual(["a.txt", "b.txt", "keep.txt"]);
    expect(await namesInDocuments(page, folderName)).toEqual(["Target", "c.txt"]);
  } finally {
    await page.unrouteAll({ behavior: "ignoreErrors" });
    await removeFromDocuments(page, folderName);
  }
});

// A phone-sized viewport, where the listing's actions collapse into "Tools".
const PHONE = { width: 390, height: 844 };

const menuItem = (page: Page, name: string) => page.getByRole("menuitem", { name, exact: true });

// Picks an entry of the listing's Tools menu.
async function pickTool(page: Page, name: string) {
  await page.locator("#listing").getByRole("button", { name: "Tools" }).click();
  await menuItem(page, name).click();
  await expect(menuItem(page, name)).toHaveCount(0);
}

test("CUT-PASTE-002: Cut and Paste in the Tools menu move a folder with everything inside it", async ({ page }) => {
  const artefactsDir = process.env.ARTEFACTS_DIR;
  const folderName = randomFolderName();
  const tools = page.locator("#listing").getByRole("button", { name: "Tools" });
  const toast = page.locator("#toast");

  await page.setViewportSize(PHONE);
  await page.goto(`https://rubisco.io/`);
  await expect(page.getByText("Loading")).not.toBeVisible();
  await selectFolder(page, "Documents");
  try {
    await createInDocuments(page, folderName, ["Archiv/brief.txt", "Archiv/Tief/deep.txt", "Target/keep.txt"]);
    await openFolder(page, folderName);

    // Nothing cut yet: Paste is disabled, even with a folder selected.
    await tools.click();
    await expect(menuItem(page, "Cut")).toBeVisible();
    await expect(menuItem(page, "Paste")).toHaveAttribute("aria-disabled", "true");
    await page.screenshot({ path: `${artefactsDir}/16-10-tools.png` });
    await page.keyboard.press("Escape");

    await selectFolder(page, "Archiv");
    await pickTool(page, "Cut");

    // The folder and everything inside it are greyed out.
    const archiv = listingRow(page, "Archiv");
    await expect.poll(() => opacity(archiv)).toBe("0.5");
    for (const name of ["brief.txt", "Tief"]) {
      expect(await opacity(listingRow(page, name))).toBe("0.5");
    }
    expect(await opacity(listingRow(page, "Target"))).toBe("1");
    await page.screenshot({ path: `${artefactsDir}/16-11-folder-cut.png` });

    // Pasting it into itself fails, and leaves it cut.
    await pickTool(page, "Paste");
    await expect(toast).toContainText(`Moved 0 of 1 item to /Documents/${folderName}/Archiv`);
    await expect(toast).toContainText(`Archiv: Can't move "Archiv" into itself`);
    expect(await opacity(archiv)).toBe("0.5");
    await page.screenshot({ path: `${artefactsDir}/16-12-into-itself.png` });

    await selectFolder(page, "Target");
    await tools.click();
    await expect(menuItem(page, "Paste")).not.toHaveAttribute("aria-disabled", "true");
    await menuItem(page, "Paste").click();
    await expect(toast).toContainText(`Moved 1 item to /Documents/${folderName}/Target`);
    await expect(toast.locator("progress")).toBeVisible();

    // The listing shows it inside Target now, not greyed out any more.
    await expect.poll(() => namesInFolder(page, "Target")).toEqual(["Archiv", "keep.txt"]);
    await expect(archiv).toHaveCount(1);
    expect(await opacity(archiv)).toBe("1");
    await tools.click();
    await expect(menuItem(page, "Paste")).toHaveAttribute("aria-disabled", "true");
    await page.keyboard.press("Escape");
    await page.screenshot({ path: `${artefactsDir}/16-13-folder-pasted.png` });

    // Its documents and subfolder went along.
    expect(await namesInDocuments(page, folderName)).toEqual(["Target"]);
    expect(await namesInDocuments(page, `${folderName}/Target/Archiv`)).toEqual(["Tief", "brief.txt"]);
    expect(await namesInDocuments(page, `${folderName}/Target/Archiv/Tief`)).toEqual(["deep.txt"]);
  } finally {
    await removeFromDocuments(page, folderName);
  }
});
