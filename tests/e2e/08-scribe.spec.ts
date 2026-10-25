import { randomBytes } from "node:crypto";
import { test, expect } from "./fixtures.ts";
import type { Page } from "@playwright/test";

const SAMPLE_PDF_URL = "https://www.successcontrol.de/wp-content/uploads/2021/03/Lieferschein-Muster-PDF.pdf";
const SAMPLE_PDF_NAME = "Lieferschein-Muster-PDF.pdf";

const randomFolderName = () => `e2e-test-${randomBytes(6).toString("hex")}`;

// Creates /Documents/<folder>/<name> with the given bytes, using the app's
// own signed-in token. Simple upload is fine: the sample is well under 4 MB.
async function uploadToDocuments(page: Page, folder: string, name: string, bytes: Buffer) {
  await page.evaluate(async ({ folder, name, bytes }) => {
    const { getToken } = await import("./auth.js");
    const { config } = await import("./config.js");
    const token = await getToken();
    const path = `${encodeURIComponent(folder)}/${encodeURIComponent(name)}`;
    const res = await fetch(`${config.graphBase}/me/drive/root:/Documents/${path}:/content`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/pdf" },
      body: new Uint8Array(bytes),
    });
    if (!res.ok) throw new Error(`Upload failed: ${res.status} ${await res.text()}`);
  }, { folder, name, bytes: Array.from(bytes) });
}

// Deletes /Documents/<path> using the app's own signed-in token. A 404 just
// means it is already gone.
async function removeFromDocuments(page: Page, path: string) {
  await page.evaluate(async (path) => {
    const { getToken } = await import("./auth.js");
    const { config } = await import("./config.js");
    const token = await getToken();
    const encoded = path.split("/").map(encodeURIComponent).join("/");
    const res = await fetch(
      `${config.graphBase}/me/drive/root:/Documents/${encoded}`,
      { method: "DELETE", headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok && res.status !== 404) {
      throw new Error(`Cleanup failed: ${res.status} ${await res.text()}`);
    }
  }, path);
}

async function openFolder(page: Page, name: string) {
  await page.locator("#listing").getByText(name, { exact: true }).click();
  await expect(page.locator("#breadcrumbs > span:last-child")).toHaveText(name);
  await expect(page.getByText("Loading")).not.toBeVisible();
}

test("SCRIBE-001: extract the text of a previewed PDF into a modal dialog", async ({ page }) => {
  // Scribe loads its (vendored) engine on first use, then parses the PDF.
  test.setTimeout(180_000);
  const artefactsDir = process.env.ARTEFACTS_DIR;
  const folderName = randomFolderName();

  const download = await fetch(SAMPLE_PDF_URL);
  expect(download.ok).toBe(true);
  const pdfBytes = Buffer.from(await download.arrayBuffer());

  await page.goto(`https://rubisco.io/`);
  await expect(page.getByText("Loading")).not.toBeVisible();

  try {
    await uploadToDocuments(page, folderName, SAMPLE_PDF_NAME, pdfBytes);

    await openFolder(page, "Documents");
    await openFolder(page, folderName);
    await page.screenshot({ path: `${artefactsDir}/08-00-test-folder.png` });

    // No underscore in the name, so the list shows it unchanged.
    await page.locator("#listing").getByText(SAMPLE_PDF_NAME, { exact: true }).click();
    await expect(page.locator("#viewer-title")).toHaveText(SAMPLE_PDF_NAME);
    await expect(page.locator("#viewer-body canvas.pdf-page").first()).toBeVisible({ timeout: 30_000 });
    await page.screenshot({ path: `${artefactsDir}/08-01-preview.png` });

    const scribeBtn = page.locator(".viewer-bar").getByRole("button", { name: "Scribe" });
    await expect(scribeBtn).toBeVisible();
    await scribeBtn.click();

    const dialog = page.getByRole("dialog", { name: "Extracted Text Content" });
    await expect(dialog).toBeVisible();
    const textArea = dialog.getByRole("textbox", { name: "Extracted text" });
    await expect(textArea).toBeVisible();
    await expect(textArea).toHaveValue(/Travelstar/, { timeout: 120_000 });
    await page.screenshot({ path: `${artefactsDir}/08-02-extracted-text.png` });

    await dialog.getByRole("button", { name: "Close" }).click();
    await expect(dialog).not.toBeVisible();
    await page.screenshot({ path: `${artefactsDir}/08-03-closed.png` });

    await removeFromDocuments(page, `${folderName}/${SAMPLE_PDF_NAME}`);
    await removeFromDocuments(page, folderName);
  } finally {
    // Graph deletes recursively, so this also catches a leftover document.
    await removeFromDocuments(page, folderName);
  }
});

test("SCRIBE-002: the Scribe button is only shown for PDF documents", async ({ page }) => {
  const folderName = randomFolderName();

  await page.goto(`https://rubisco.io/`);
  await expect(page.getByText("Loading")).not.toBeVisible();
  const scribeBtn = page.locator(".viewer-bar").getByRole("button", { name: "Scribe" });
  await expect(scribeBtn).toBeHidden();

  try {
    await uploadToDocuments(page, folderName, "notes.txt", Buffer.from("not a pdf\n"));
    await openFolder(page, "Documents");
    await openFolder(page, folderName);

    await page.locator("#listing").getByText("notes.txt", { exact: true }).click();
    await expect(page.locator("#viewer-title")).toHaveText("notes.txt");
    await expect(page.locator("#viewer-body pre")).toContainText("not a pdf");
    await expect(scribeBtn).toBeHidden();
  } finally {
    await removeFromDocuments(page, folderName);
  }
});
