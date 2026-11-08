import { test, expect } from "./fixtures.ts";
import { listingRows } from "./lib/listing.ts";
import type { Page } from "@playwright/test";

// The header is a single line: the search box on the left, the sign-in icons
// on the right. There's no app title or icon in it, and no line below it with
// the number of items in the current folder: the listing follows right away.
async function expectOneLineHeader(page: Page) {
  const header = page.locator("header.topbar");
  const search = page.getByPlaceholder("Search OneDrive…");
  const auth = [page.locator("#onedrive-auth"), page.locator("#cloudflare-auth")];

  await expect(header).toBeVisible();
  await expect(header).not.toContainText("EverOne");
  await expect(header.locator(".brand, .logo")).toHaveCount(0);

  const headerBox = (await header.boundingBox())!;
  const searchBox = (await search.boundingBox())!;
  // One row, as tall as a single line of controls (3.5rem).
  expect(headerBox.height).toBeLessThanOrEqual(56);
  for (const box of [searchBox, ...await Promise.all(auth.map(async (a) => (await a.boundingBox())!))]) {
    expect(box.y).toBeGreaterThanOrEqual(headerBox.y);
    expect(box.y + box.height).toBeLessThanOrEqual(headerBox.y + headerBox.height);
  }
  // The search box comes first, at the left edge (the header's 1rem padding),
  // with the sign-in icons to its right.
  expect(searchBox.x).toBeLessThanOrEqual(headerBox.x + 16 + 1);
  for (const a of auth) {
    expect((await a.boundingBox())!.x).toBeGreaterThan(searchBox.x + searchBox.width);
  }

  // No item count line: the listing starts right below the header (after
  // .main's 1rem padding).
  await expect(page.locator("#status")).toHaveCount(0);
  await expect(page.locator(".toolbar")).toHaveCount(0);
  // (The File System keeps its own item count, in its footer.)
  await expect(page.locator("#browser > *")).toHaveCount(1);
  await expect(page.locator("#browser > .split")).toBeVisible();
  const listBox = (await page.locator(".list-pane").boundingBox())!;
  expect(listBox.y).toBeLessThanOrEqual(headerBox.y + headerBox.height + 16 + 1);
}

test("HEADER-001: the header is one line, search box first, without a title or item count", async ({ page }) => {
  const artefactsDir = process.env.ARTEFACTS_DIR;

  await page.goto(`https://rubisco.io/`);
  await page.screenshot({ path: `${artefactsDir}/03-00-start.png` });
  await expect(page.getByText("Loading")).not.toBeVisible();
  await expect(listingRows(page).first()).toBeVisible();

  await expectOneLineHeader(page);
  await page.screenshot({ path: `${artefactsDir}/03-01-header.png` });
  await page.locator("header.topbar").screenshot({ path: `${artefactsDir}/03-02-header-only.png` });
});

test("HEADER-002: the header stays one line on a phone", async ({ page }) => {
  const artefactsDir = process.env.ARTEFACTS_DIR;

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`https://rubisco.io/`);
  await expect(page.getByText("Loading")).not.toBeVisible();
  await expect(listingRows(page).first()).toBeVisible();

  await expectOneLineHeader(page);
  await page.screenshot({ path: `${artefactsDir}/03-10-header-phone.png` });
});
