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

// Double-clicking a folder opens it, like Finder; a single click only
// expands it in place.
export async function openFolder(page: Page, name: string) {
  await listingRow(page, name).dblclick();
  await expect(page.locator("#breadcrumbs > span:last-child")).toHaveText(name);
  await expect(page.getByText("Loading")).not.toBeVisible();
}
