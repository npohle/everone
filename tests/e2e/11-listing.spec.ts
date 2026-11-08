import { randomBytes } from "node:crypto";
import { test, expect } from "./fixtures.ts";
import { filesInFolder, listingRow, rowDate, rowsInFolder, selectFolder } from "./lib/listing.ts";
import type { Page, Request } from "@playwright/test";

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

async function openDocuments(page: Page) {
  await page.goto(`https://rubisco.io/`);
  await expect(page.getByText("Loading")).not.toBeVisible();
  await selectFolder(page, "Documents");
}

// Graph requests listing a folder's children, recorded from now on.
function recordChildrenRequests(page: Page) {
  const requests: Request[] = [];
  page.on("request", (req) => {
    if (/graph\.microsoft\.com\/.*\/children\?/.test(req.url())) requests.push(req);
  });
  return requests;
}

test("LISTING-001: the folder is listed in the File System's list view, names split from their dates", async ({ page }) => {
  const artefactsDir = process.env.ARTEFACTS_DIR;
  const folderName = randomFolderName();

  await openDocuments(page);
  try {
    await createInDocuments(page, folderName, [
      "2021-03-04_Rechnung_Telekom.txt",
      "2021-05-06_Rechnung_Vodafone.txt",
      "notes.txt",
      "Archiv/2019-01-02_Brief_Bank.txt",
    ]);
    await page.reload();
    await expect(page.getByText("Loading")).not.toBeVisible();
    await selectFolder(page, "Documents");
    await selectFolder(page, folderName);
    await page.screenshot({ path: `${artefactsDir}/11-00-folder.png` });

    // The list view, with its name / date / size columns.
    const listing = page.locator("#listing");
    await expect(listing.locator('[data-slot="file-system"]')).toBeVisible();
    for (const column of ["Name", "Date Created", "Size"]) {
      await expect(listing.getByRole("button", { name: column, exact: true })).toBeVisible();
    }

    // Folders are rows too.
    await expect(listingRow(page, "Archiv")).toHaveAttribute("data-item-type", "folder");
    await expect(await rowsInFolder(page, folderName)).toHaveCount(4);

    // "YYYY-MM-DD_" goes to the Date Created column, the name is cut at the
    // next underscore; both "Rechnung"s are listed, each with its own date.
    const rechnungen = listing.getByRole("treeitem", { name: /^Rechnung​*$/ });
    await expect(rechnungen).toHaveCount(2);
    await expect(rowDate(rechnungen.nth(0))).toHaveAttribute("title", "Mar 4, 2021");
    await expect(rowDate(rechnungen.nth(1))).toHaveAttribute("title", "May 6, 2021");
    await expect(rowDate(listingRow(page, "notes.txt"))).toHaveAttribute("title", "—");

    // Selecting a row previews the file under its full name.
    await rechnungen.nth(1).click();
    await expect(page.locator("#viewer-title")).toHaveText("2021-05-06_Rechnung_Vodafone.txt");
    await expect(page.locator("#viewer-body")).toContainText("content of 2021-05-06_Rechnung_Vodafone.txt");
    await page.screenshot({ path: `${artefactsDir}/11-01-preview.png` });
  } finally {
    await removeFromDocuments(page, folderName);
  }
});

test("LISTING-002: subfolders load their children when expanded", async ({ page }) => {
  const artefactsDir = process.env.ARTEFACTS_DIR;
  const folderName = randomFolderName();

  await openDocuments(page);
  try {
    await createInDocuments(page, folderName, [
      "top.txt",
      "Archiv/2019-01-02_Brief_Bank.txt",
      "Archiv/Tief/deep.txt",
    ]);
    await page.reload();
    await expect(page.getByText("Loading")).not.toBeVisible();
    await selectFolder(page, "Documents");

    const requests = recordChildrenRequests(page);
    await selectFolder(page, folderName);
    await expect(await rowsInFolder(page, folderName)).toHaveCount(2);
    // Only the folder itself was listed, not its subfolder.
    requests.length = 0;

    // A single click expands the folder in place, loading its children.
    const archiv = listingRow(page, "Archiv");
    await archiv.click();
    await expect(archiv).toHaveAttribute("aria-expanded", "true");
    const brief = listingRow(page, "Brief");
    await expect(brief).toBeVisible();
    // Documents › folder › Archiv › Brief, all in the one listing.
    await expect(brief).toHaveAttribute("aria-level", "4");
    await expect(rowDate(brief)).toHaveAttribute("title", "Jan 2, 2019");
    await expect(listingRow(page, "Tief")).toHaveAttribute("aria-level", "4");
    expect(requests).toHaveLength(1);
    await expect(listingRow(page, "Documents")).toHaveAttribute("aria-level", "1");
    await page.screenshot({ path: `${artefactsDir}/11-10-expanded.png` });

    // And one level deeper.
    await listingRow(page, "Tief").click();
    const deep = listingRow(page, "deep.txt");
    await expect(deep).toHaveAttribute("aria-level", "5");
    expect(requests).toHaveLength(2);
    await page.screenshot({ path: `${artefactsDir}/11-11-expanded-deeper.png` });

    // Files in expanded folders preview like any other.
    await deep.click();
    await expect(page.locator("#viewer-title")).toHaveText("deep.txt");

    // Collapsing and expanding again doesn't reload.
    await archiv.click();
    await expect(brief).toHaveCount(0);
    await archiv.click();
    await expect(brief).toBeVisible();
    expect(requests).toHaveLength(2);

    // Double-clicking a nested folder selects it, but doesn't make it the
    // listing's root.
    await listingRow(page, "Tief").dblclick();
    await expect(listingRow(page, "Tief")).toHaveAttribute("aria-selected", "true");
    await expect(listingRow(page, "Documents")).toHaveAttribute("aria-level", "1");
    await expect(listingRow(page, "Tief")).toHaveAttribute("aria-level", "4");
    await page.screenshot({ path: `${artefactsDir}/11-12-nested-double-clicked.png` });
  } finally {
    await removeFromDocuments(page, folderName);
  }
});

test("LISTING-003: all of a folder's items are listed, across every page", async ({ page }) => {
  const artefactsDir = process.env.ARTEFACTS_DIR;
  const folderName = randomFolderName();
  const names = ["a.txt", "b.txt", "c.txt", "d.txt", "e.txt"];

  await openDocuments(page);
  try {
    await createInDocuments(page, folderName, names);
    // Graph pages after 100 items (config.pageSize); ask for 2 per page so
    // that the five items take three pages.
    await page.route(/graph\.microsoft\.com\/.*\/children\?/, (route) =>
      route.continue({ url: route.request().url().replace(/\$top=\d+/, "$top=2") }));
    const requests = recordChildrenRequests(page);
    await page.reload();
    await expect(page.getByText("Loading")).not.toBeVisible();
    await selectFolder(page, "Documents");
    await selectFolder(page, folderName);

    await expect(await filesInFolder(page, folderName)).toHaveCount(names.length);
    for (const name of names) await expect(listingRow(page, name)).toBeVisible();
    await expect(await rowsInFolder(page, folderName)).toHaveCount(names.length);
    expect(requests.filter((req) => req.url().includes("skiptoken")).length).toBeGreaterThanOrEqual(2);
    await page.screenshot({ path: `${artefactsDir}/11-20-all-pages.png` });
  } finally {
    await page.unrouteAll();
    await removeFromDocuments(page, folderName);
  }
});
