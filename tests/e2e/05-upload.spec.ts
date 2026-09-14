import { test, expect } from "./fixtures.ts";
import type { Locator, Page } from "@playwright/test";
import path from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Local sample files that get dragged onto a folder. They are uploaded under a
// random name per run, so a run never collides with a previous one — and the
// files stay in the drive afterwards (the app has no delete), which is why the
// names are prefixed to make them obvious.
const filesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "files");
const SAMPLE_A = readFileSync(path.join(filesDir, "upload-sample-a.txt"), "utf8");
const SAMPLE_B = readFileSync(path.join(filesDir, "upload-sample-b.txt"), "utf8");

// displayName() in app.js strips a "YYYY-MM-DD_" reference prefix and cuts the
// name at the first underscore, so keep generated names underscore-free to have
// the listing show them verbatim.
const randomName = (suffix: string) =>
  `e2e-upload-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}-${suffix}.txt`;

type DroppedFile = { name: string; content: string };

// Simulates a real file drop: a DataTransfer carrying File objects, handed to
// the folder row's dragover/drop listeners. Playwright's own drag helpers can
// only drag page elements, not files from outside the browser.
async function dropFilesOnFolder(page: Page, row: Locator, files: DroppedFile[]) {
  const dataTransfer = await page.evaluateHandle((files: DroppedFile[]) => {
    const dt = new DataTransfer();
    for (const f of files) {
      dt.items.add(new File([f.content], f.name, { type: "text/plain" }));
    }
    return dt;
  }, files);

  await row.dispatchEvent("dragenter", { dataTransfer });
  await row.dispatchEvent("dragover", { dataTransfer });
  await row.dispatchEvent("drop", { dataTransfer });
  await dataTransfer.dispose();
}

async function firstFolderRow(page: Page) {
  const row = page.locator(".row.folder").first();
  await expect(row).toBeVisible();
  return row;
}

test("UPLOAD-001: dropping two files on a folder uploads them under their own names", async ({ page }) => {
  const artefactsDir = process.env.ARTEFACTS_DIR;

  await page.goto(`https://npohle.github.io/everone/`);
  await expect(page.getByText("Loading")).not.toBeVisible();
  await page.screenshot({ path: `${artefactsDir}/05-00-start.png` });

  const folderRow = await firstFolderRow(page);
  const folderLabel = (await folderRow.locator(".name").textContent())!.trim();

  const dropped = [
    { name: randomName("a"), content: SAMPLE_A },
    { name: randomName("b"), content: SAMPLE_B },
  ];
  await dropFilesOnFolder(page, folderRow, dropped);

  const toast = page.locator("#toast");
  await expect(toast).toContainText("Uploaded 2 files", { timeout: 30_000 });
  await expect(toast).toContainText(folderLabel);
  await page.screenshot({ path: `${artefactsDir}/05-01-uploaded.png` });

  // Confirm the files really landed in that folder, newest first so they show
  // up on the first page regardless of how many items the folder holds.
  await folderRow.click();
  await expect(page.getByText("Loading")).not.toBeVisible();
  await page.locator("#sort").selectOption("modified-desc");
  await expect(page.getByText("Loading")).not.toBeVisible();

  for (const file of dropped) {
    await expect(page.locator(".row .name", { hasText: file.name })).toBeVisible();
  }
  await page.screenshot({ path: `${artefactsDir}/05-02-listing.png` });
});

test("UPLOAD-002: uploading a name that already exists fails", async ({ page }) => {
  const artefactsDir = process.env.ARTEFACTS_DIR;

  await page.goto(`https://npohle.github.io/everone/`);
  await expect(page.getByText("Loading")).not.toBeVisible();

  const folderRow = await firstFolderRow(page);
  const file = { name: randomName("dup"), content: SAMPLE_A };

  await dropFilesOnFolder(page, folderRow, [file]);
  const toast = page.locator("#toast");
  await expect(toast).toContainText("Uploaded", { timeout: 30_000 });

  // Same name again — the app asks Graph to fail rather than replace or rename.
  await dropFilesOnFolder(page, folderRow, [file]);
  await expect(toast).toContainText("already exists", { timeout: 30_000 });
  await page.screenshot({ path: `${artefactsDir}/05-03-conflict.png` });
});
