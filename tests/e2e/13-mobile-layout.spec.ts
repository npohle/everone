import { test, expect } from "./fixtures.ts";
import { listingRows } from "./lib/listing.ts";
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
