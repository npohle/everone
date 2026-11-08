import { test, expect } from "./fixtures.ts";
import { listingRows, selectFolder } from "./lib/listing.ts";
import type { Locator, Page } from "@playwright/test";

// A phone-sized viewport: narrow enough for styles.css to stack the preview
// below the listing (max-width: 800px).
const PHONE = { width: 390, height: 844 };

const heightOf = async (locator: Locator) => (await locator.boundingBox())?.height ?? 0;

async function openOnPhone(page: Page) {
  await page.setViewportSize(PHONE);
  await page.goto(`https://rubisco.io/`);
  await expect(page.getByText("Loading")).not.toBeVisible();
  await expect(listingRows(page).first()).toBeVisible();
}

test("MOBILE-001: the stacked listing is at least 60% of the viewport tall and shows its rows", async ({ page }) => {
  const artefactsDir = process.env.ARTEFACTS_DIR;

  await openOnPhone(page);
  await page.screenshot({ path: `${artefactsDir}/13-00-phone.png` });

  // Stacked: the preview sits below the listing, not next to it.
  const listPane = page.locator(".list-pane");
  const preview = page.locator("#viewer");
  const listBox = (await listPane.boundingBox())!;
  const previewBox = (await preview.boundingBox())!;
  expect(previewBox.y).toBeGreaterThanOrEqual(listBox.y + listBox.height);

  // Both the pane and the File System inside it keep their minimum height.
  const minHeight = PHONE.height * 0.6;
  expect(await heightOf(listPane)).toBeGreaterThanOrEqual(minHeight - 1);
  expect(await heightOf(page.locator('#listing [data-slot="file-system"]'))).toBeGreaterThanOrEqual(minHeight - 1);

  // The listing's rows are actually shown, not squeezed out of sight.
  await expect(listingRows(page).first()).toBeInViewport();
});

test("MOBILE-002: the page scrolls to the preview, which keeps its minimum height", async ({ page }) => {
  const artefactsDir = process.env.ARTEFACTS_DIR;

  await openOnPhone(page);

  // Listing and preview together are taller than the viewport, so the page
  // itself scrolls rather than squeezing them into it.
  const { scrollHeight, clientHeight } = await page.evaluate(() => ({
    scrollHeight: document.scrollingElement!.scrollHeight,
    clientHeight: document.scrollingElement!.clientHeight,
  }));
  expect(scrollHeight).toBeGreaterThan(clientHeight);

  const preview = page.locator("#viewer");
  expect(await heightOf(preview)).toBeGreaterThanOrEqual(PHONE.height * 0.6 - 1);

  await page.evaluate(() => window.scrollTo(0, document.scrollingElement!.scrollHeight));
  await expect(preview.locator(".viewer-bar")).toBeInViewport();
  await page.screenshot({ path: `${artefactsDir}/13-01-phone-scrolled.png` });
});

test("MOBILE-003: New Folder, Delete Folder and Upload collapse into a Tools menu", async ({ page }) => {
  const artefactsDir = process.env.ARTEFACTS_DIR;
  const listing = page.locator("#listing");
  const menuItem = (name: string) => page.getByRole("menuitem", { name, exact: true });
  const tools = listing.getByRole("button", { name: "Tools" });

  await openOnPhone(page);
  await expect(tools).toBeVisible();
  // Next to sort, filter and search, all in the listing's header.
  await expect(tools).toBeInViewport({ ratio: 1 });
  await expect(listing.getByRole("combobox", { name: "Sort by" })).toBeInViewport({ ratio: 1 });
  await expect(listing.getByRole("button", { name: "Search" })).toBeInViewport({ ratio: 1 });
  for (const name of ["New Folder", "Delete Folder", "Upload"]) {
    await expect(page.getByRole("button", { name, exact: true })).toHaveCount(0);
  }

  // Nothing selected yet: there's no folder to act on.
  await tools.click();
  for (const name of ["New Folder", "Delete Folder", "Upload"]) {
    await expect(menuItem(name)).toBeVisible();
    await expect(menuItem(name)).toHaveAttribute("aria-disabled", "true");
  }
  await page.screenshot({ path: `${artefactsDir}/13-02-tools-nothing-selected.png` });
  await page.keyboard.press("Escape");
  await expect(menuItem("New Folder")).toHaveCount(0);

  // Documents isn't empty, so it can't be deleted.
  await selectFolder(page, "Documents");
  await tools.click();
  await expect(menuItem("New Folder")).not.toHaveAttribute("aria-disabled", "true");
  await expect(menuItem("Upload")).not.toHaveAttribute("aria-disabled", "true");
  await expect(menuItem("Delete Folder")).toHaveAttribute("aria-disabled", "true");
  await page.screenshot({ path: `${artefactsDir}/13-03-tools-folder-selected.png` });

  // Picking an entry closes the menu and opens its dialog, which keeps the
  // focus.
  await menuItem("New Folder").click();
  await expect(menuItem("New Folder")).toHaveCount(0);
  const newFolder = page.getByRole("dialog", { name: "New Folder" });
  await expect(newFolder).toBeVisible();
  await expect(page.locator("#new-folder-path")).toHaveText("/Documents");
  await expect(page.locator("#new-folder-name")).toBeFocused();
  await page.locator("#new-folder-name").fill("typed");
  await expect(page.locator("#new-folder-name")).toHaveValue("typed");
  await page.screenshot({ path: `${artefactsDir}/13-04-tools-new-folder.png` });
  await newFolder.getByRole("button", { name: "Cancel" }).click();
  await expect(newFolder).not.toBeVisible();

  await tools.click();
  await menuItem("Upload").click();
  const upload = page.getByRole("dialog", { name: "Upload Files" });
  await expect(upload).toBeVisible();
  await expect(page.locator("#upload-path")).toHaveText("/Documents");
  await upload.getByRole("button", { name: "Cancel" }).click();
  await expect(upload).not.toBeVisible();
});
