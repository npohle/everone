import { test, expect } from "./fixtures.ts";
import { listingFiles, listingRow, listingRows, rowPath, selectFolder } from "./lib/listing.ts";
import { displayName } from "../../file-system-items.js";
import type { Page, Request } from "@playwright/test";

// The search box in the listing's header searches the drive through Graph,
// limited to the folder selected in the listing, and shows the files found
// in their folders, from the drive's root down.
//
// Documents/e2e-test-search-01 and -02 each hold a copy of a Lieferschein
// sample PDF that mentions "Travelstar". On the test account OneDrive keeps
// files out of its search index for weeks (see 02-search.spec.ts), so the
// first two tests answer Graph's search with what it returns once they're
// indexed: the real driveItems of those PDFs, plus what lies outside the
// folder searched in (personal drives search the whole drive, even when
// asked to search a folder). LISTING-SEARCH-003 searches for real.

const QUERY = "Travelstar";
const SEARCH_FOLDERS = ["e2e-test-search-01", "e2e-test-search-02"];
const SEARCH_REQUEST = /graph\.microsoft\.com\/.*\/search\(q=/;

// The listing's search box. When the listing is narrow it sits in a popover
// (portalled to <body>) behind a "Search" button, which this opens.
async function searchBox(page: Page) {
  const box = page.getByRole("searchbox", { name: "Search files" });
  if (!(await box.isVisible())) {
    await page.locator("#listing").getByRole("button", { name: "Search", exact: true }).click();
  }
  await expect(box).toBeVisible();
  return box;
}

async function openRoot(page: Page) {
  await page.goto(`https://rubisco.io/`);
  await expect(page.getByText("Loading")).not.toBeVisible();
}

type DriveItem = { id: string; name: string; file?: object; folder?: object };

// The driveItems Graph's search would find for QUERY once indexed: the PDF in
// each search test folder, those folders themselves (their names don't
// match, but a folder found has to stay out either way) and a file at the
// drive's root. Read for real, with the fields the app selects.
async function indexedResults(page: Page) {
  return page.evaluate(async (folders) => {
    const { getToken } = await import("./auth.js");
    const { config } = await import("./config.js");
    const token = await getToken();
    const select = "$select=id,name,size,folder,file,parentReference,lastModifiedDateTime,webUrl";
    const get = async (path: string) => {
      const res = await fetch(`${config.graphBase}${path}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`);
      return res.json();
    };
    const pdfs: DriveItem[] = [];
    const searchFolders: DriveItem[] = [];
    for (const name of folders) {
      searchFolders.push(await get(`/me/drive/root:/Documents/${name}?${select}`));
      const children = await get(`/me/drive/root:/Documents/${name}:/children?${select}`);
      pdfs.push(children.value.find((item: DriveItem) => item.name.endsWith(".pdf")));
    }
    const root = await get(`/me/drive/root/children?${select}&$top=200`);
    const rootFile: DriveItem | undefined = root.value.find((item: DriveItem) => item.file);
    return { pdfs, searchFolders, rootFile };
  }, SEARCH_FOLDERS);
}

// Answers Graph's search requests with `value`; returns the requests made.
async function answerSearch(page: Page, value: unknown[]) {
  const requests: Request[] = [];
  await page.route(SEARCH_REQUEST, (route) => {
    requests.push(route.request());
    return route.fulfill({ json: { value } });
  });
  return requests;
}

// Types the query into the listing's search box and waits for the results
// (counted in the listing's footer once they show).
async function searchListing(page: Page, query: string) {
  const response = page.waitForResponse(SEARCH_REQUEST);
  await (await searchBox(page)).fill(query);
  await response;
  await expect(page.getByText("Loading")).not.toBeVisible();
  await expect(page.locator("#listing")).toContainText(/\d+ results?\b/);
}

test("LISTING-SEARCH-001: the search is limited to the selected folder and shows its results in their folders", async ({ page }) => {
  const artefactsDir = process.env.ARTEFACTS_DIR;

  await openRoot(page);
  const { pdfs, searchFolders, rootFile } = await indexedResults(page);
  const requests = await answerSearch(page, [...pdfs, ...searchFolders, ...(rootFile ? [rootFile] : [])]);
  await selectFolder(page, "Documents");
  await selectFolder(page, SEARCH_FOLDERS[0]);
  await page.screenshot({ path: `${artefactsDir}/14-00-folder-selected.png` });

  await searchListing(page, QUERY);
  expect(requests).toHaveLength(1);
  expect(requests[0].url()).toContain(`/me/drive/items/${encodeURIComponent(searchFolders[0].id)}/search(q='${QUERY}')`);

  // Just the PDF in the selected folder, in the folders above it.
  const pdf = listingRow(page, displayName(pdfs[0].name));
  await expect(listingRows(page)).toHaveCount(3);
  await expect(listingRow(page, "Documents")).toHaveAttribute("aria-level", "1");
  await expect(listingRow(page, SEARCH_FOLDERS[0])).toHaveAttribute("aria-level", "2");
  await expect(listingRow(page, SEARCH_FOLDERS[0])).toHaveAttribute("aria-expanded", "true");
  await expect(pdf).toHaveAttribute("aria-level", "3");
  expect(await rowPath(pdf)).toBe(`Documents/${SEARCH_FOLDERS[0]}/${displayName(pdfs[0].name)}`);
  await expect(listingRow(page, SEARCH_FOLDERS[1])).toHaveCount(0);
  await expect(page.locator("#listing")).toContainText("1 result");
  // New Folder, Delete Folder and Upload act on the listing's items only.
  await expect(page.locator("#listing").getByRole("button", { name: "New Folder" })).toBeDisabled();
  await expect(page.locator("#listing").getByRole("button", { name: "Upload", exact: true })).toBeDisabled();
  await page.screenshot({ path: `${artefactsDir}/14-01-folder-results.png` });

  // A result previews like any other file.
  await pdf.click();
  await expect(page.locator("#viewer-title")).toHaveText(pdfs[0].name);
  await page.screenshot({ path: `${artefactsDir}/14-02-result-preview.png` });

  // Refining the query keeps searching the same folder.
  await searchListing(page, `${QUERY} Lieferschein`);
  expect(requests).toHaveLength(2);
  expect(requests[1].url()).toContain(`/me/drive/items/${encodeURIComponent(searchFolders[0].id)}/search(`);
  await expect(listingRows(page)).toHaveCount(3);

  // Clearing the search shows the listing's items again, folders open as
  // before.
  await searchBox(page);
  await page.getByRole("button", { name: "Clear search" }).click();
  await expect(listingRow(page, SEARCH_FOLDERS[1])).toBeVisible();
  await expect(listingRow(page, SEARCH_FOLDERS[0])).toHaveAttribute("aria-expanded", "true");
  await expect(listingRow(page, SEARCH_FOLDERS[0])).toHaveAttribute("aria-level", "2");
  await expect(await searchBox(page)).toHaveValue("");
  expect(requests).toHaveLength(2);
  await page.screenshot({ path: `${artefactsDir}/14-03-cleared.png` });
});

test("LISTING-SEARCH-002: without a selected folder the whole drive is searched", async ({ page }) => {
  const artefactsDir = process.env.ARTEFACTS_DIR;

  await openRoot(page);
  const { pdfs, searchFolders, rootFile } = await indexedResults(page);
  const requests = await answerSearch(page, [...pdfs, ...searchFolders, ...(rootFile ? [rootFile] : [])]);

  await searchListing(page, QUERY);
  expect(requests[0].url()).toContain(`/me/drive/root/search(q='${QUERY}')`);

  // Both PDFs, each in its folder, under the one Documents folder; folders
  // found themselves only show as the folders of the PDFs.
  await expect(listingRow(page, "Documents")).toHaveCount(1);
  await expect(listingRow(page, "Documents")).toHaveAttribute("aria-level", "1");
  for (const [i, name] of SEARCH_FOLDERS.entries()) {
    await expect(listingRow(page, name)).toHaveAttribute("aria-level", "2");
    const pdf = page.locator(`#listing [role="treeitem"][data-item-path=${JSON.stringify(`Documents/${name}/${displayName(pdfs[i].name)}`)}]`);
    await expect(pdf).toHaveAttribute("aria-level", "3");
  }
  const files = pdfs.length + (rootFile ? 1 : 0);
  await expect(listingFiles(page)).toHaveCount(files);
  await expect(listingRows(page)).toHaveCount(1 + SEARCH_FOLDERS.length + files);
  if (rootFile) await expect(listingRow(page, displayName(rootFile.name))).toHaveAttribute("aria-level", "1");
  await expect(page.locator("#listing")).toContainText(`${files} results`);
  await page.screenshot({ path: `${artefactsDir}/14-10-drive-results.png` });
});

// Searches OneDrive for real: whatever its index holds for the query, only
// what's in the selected folder shows.
test("LISTING-SEARCH-003: a real search shows nothing from outside the selected folder", async ({ page }) => {
  const artefactsDir = process.env.ARTEFACTS_DIR;

  await openRoot(page);
  await selectFolder(page, "Documents");
  await selectFolder(page, SEARCH_FOLDERS[0]);
  const request = page.waitForRequest(SEARCH_REQUEST);
  await searchListing(page, QUERY);
  expect((await request).url()).toMatch(new RegExp(`/me/drive/items/[^/]+/search\\(q='${QUERY}'\\)`));

  const folderPath = `Documents/${SEARCH_FOLDERS[0]}/`;
  for (const row of await listingRows(page).all()) {
    const path = await rowPath(row);
    expect(path === "Documents/" || path.startsWith(folderPath)).toBe(true);
  }
  for (const file of await listingFiles(page).all()) {
    expect(await rowPath(file)).toMatch(new RegExp(`^${folderPath}`));
  }
  await page.screenshot({ path: `${artefactsDir}/14-20-real-search.png` });
});
