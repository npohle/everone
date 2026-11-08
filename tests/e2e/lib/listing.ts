import { expect, type Locator, type Page } from "@playwright/test";

// The listing (#listing) is extend-ui's File System component in its list
// view: a tree whose rows are `treeitem`s inside the tree's (open) shadow
// root, each named by the item's display name (see file-system-items.js).

// Every rendered row: folders, files, and the "Loading…" row standing in
// for a folder's children while they load.
export const listingRows = (page: Page): Locator =>
  page.locator("#listing").getByRole("treeitem");

export const listingRow = (page: Page, name: string): Locator =>
  page.locator("#listing").getByRole("treeitem", { name, exact: true });

// Rows that are files (not folders, not the loading row of a folder).
export const listingFiles = (page: Page): Locator =>
  page.locator('#listing [role="treeitem"][data-item-type="file"]')
    .and(page.locator(`:not([aria-label="Loading…"])`));

// A row's date column: the tree renders it from the title of the row's
// decoration (via CSS), not as text.
export const rowDate = (row: Locator): Locator =>
  row.locator('[data-item-section="decoration"] > span');

// A row's manifest path ("Documents/Archiv/" for a folder).
export const rowPath = async (row: Locator): Promise<string> =>
  (await row.getAttribute("data-item-path"))!;

// The rows inside the folder named `name`, at any depth (as far as its
// subfolders are expanded), the "Loading…" rows of lazy subfolders aside.
export async function rowsInFolder(page: Page, name: string): Promise<Locator> {
  const path = await rowPath(listingRow(page, name));
  return page.locator(`#listing [role="treeitem"][data-item-path^=${JSON.stringify(path)}]`)
    .and(page.locator(`:not([data-item-path=${JSON.stringify(path)}]):not([aria-label="Loading…"])`));
}

// The file rows inside the folder named `name` (see rowsInFolder).
export async function filesInFolder(page: Page, name: string): Promise<Locator> {
  return (await rowsInFolder(page, name)).and(page.locator('[data-item-type="file"]'));
}

// The listing never navigates: its root stays the drive's. Selecting a folder
// makes it the one New Folder, Delete Folder and Upload act on; a single
// click selects it and toggles it open in place, like Finder. Leaves the
// folder selected and open, with its children loaded.
export async function selectFolder(page: Page, name: string) {
  const row = listingRow(page, name);
  if ((await row.getAttribute("aria-selected")) !== "true") await row.click();
  await expect(row).toHaveAttribute("aria-selected", "true");
  if ((await row.getAttribute("aria-expanded")) !== "true") await row.click();
  await expect(row).toHaveAttribute("aria-expanded", "true");
  await expect(row).toHaveAttribute("aria-selected", "true");
  await expect(listingRow(page, "Loading…")).toHaveCount(0);
  await expect(page.getByText("Loading")).not.toBeVisible();
}
