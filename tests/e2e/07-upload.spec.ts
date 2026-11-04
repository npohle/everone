import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test, expect } from "./fixtures.ts";
import type { Locator, Page } from "@playwright/test";

// UPLOAD-005 holds a real Cloudflare API token, which ends up in the
// sessionStorage init script and in the request to the extract proxy. Traces
// record both, and Playwright only lets a whole file opt out, so keep tracing
// off for this file (as in 10-extract.spec.ts).
test.use({ trace: "off" });

const randomFolderName = () => `e2e-test-${randomBytes(6).toString("hex")}`;

// Writes text files with random content into a fresh temp directory and
// returns their absolute paths keyed by file name.
function createLocalFiles(...names: string[]): Record<string, string> {
  const dir = mkdtempSync(path.join(tmpdir(), "e2e-upload-"));
  return Object.fromEntries(names.map((name) => {
    const file = path.join(dir, name);
    writeFileSync(file, `${name}: ${randomBytes(32).toString("hex")}\n`);
    return [name, file];
  }));
}

// Writes a minimal PDF with one line of text per page into a fresh temp
// directory and returns its absolute path.
function createLocalPdf(name: string, pageTexts: string[]): string {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${pageTexts.map((_, i) => `${4 + 2 * i} 0 R`).join(" ")}] /Count ${pageTexts.length} >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  pageTexts.forEach((text, i) => {
    const stream = `BT /F1 36 Tf 72 700 Td (${text}) Tj ET`;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + 2 * i} 0 R >>`,
      `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    );
  });
  let pdf = "%PDF-1.4\n";
  const offsets = objects.map((body, i) => {
    const offset = pdf.length;
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
    return offset;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  const file = path.join(mkdtempSync(path.join(tmpdir(), "e2e-upload-")), name);
  writeFileSync(file, pdf, "latin1");
  return file;
}

// Downloads `url` into a fresh temp directory and returns the local path.
async function downloadLocalCopy(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download of ${url} failed: ${res.status}`);
  const file = path.join(mkdtempSync(path.join(tmpdir(), "e2e-upload-")), path.basename(new URL(url).pathname));
  writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  return file;
}

// Signs in to Cloudflare the way callback/ leaves it: the token in
// sessionStorage under cloudflare.token (see cloudflare-auth.js).
async function signInToCloudflare(page: Page, accessToken: string) {
  await page.addInitScript((accessToken) => {
    window.sessionStorage.setItem("cloudflare.token", JSON.stringify({
      accessToken,
      tokenType: "bearer",
      scope: "",
      expiresAt: Date.now() + 3600_000,
    }));
  }, accessToken);
}

async function openDocuments(page: Page) {
  await page.goto(`https://rubisco.io/`);
  await expect(page.getByText("Loading")).not.toBeVisible();
  await page.locator("#listing").getByText("Documents", { exact: true }).click();
  await expect(page.locator("#breadcrumbs")).toContainText("Documents");
  await expect(page.getByText("Loading")).not.toBeVisible();
}

async function createFolderViaUi(page: Page, name: string) {
  await page.getByRole("button", { name: "New Folder" }).click();
  const dialog = page.getByRole("dialog", { name: "New Folder" });
  await dialog.getByLabel("Folder name").fill(name);
  await dialog.getByRole("button", { name: "Create" }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByText("Loading")).not.toBeVisible();
  await expect(page.locator("#listing").getByText(name, { exact: true })).toBeVisible();
}

async function openFolder(page: Page, name: string) {
  await page.locator("#listing").getByText(name, { exact: true }).click();
  await expect(page.locator("#breadcrumbs > span:last-child")).toHaveText(name);
  await expect(page.getByText("Loading")).not.toBeVisible();
}

async function openUploadDialog(page: Page) {
  await page.getByRole("button", { name: "Upload", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Upload Files" });
  await expect(dialog).toBeVisible();
  return dialog;
}

// Clicks the dropzone and answers the native file picker it opens.
async function pickFiles(page: Page, dialog: Locator, files: string[]) {
  const chooserPromise = page.waitForEvent("filechooser");
  await dropzone(dialog).click();
  const chooser = await chooserPromise;
  expect(chooser.isMultiple()).toBe(true);
  await chooser.setFiles(files);
}

// The Extend UI style dropzone that opens the file picker or takes dropped
// files.
function dropzone(dialog: Locator) {
  return dialog.getByRole("button", { name: "Click to upload or drop files" });
}

// Downloads the content of /Documents/<folder>/<name> with the app's own
// signed-in token.
async function readFromDocuments(page: Page, folder: string, name: string) {
  return page.evaluate(async ([folder, name]) => {
    const { getToken } = await import("./auth.js");
    const { config } = await import("./config.js");
    const token = await getToken();
    const res = await fetch(
      `${config.graphBase}/me/drive/root:/Documents/${encodeURIComponent(folder)}/${encodeURIComponent(name)}:/content`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) throw new Error(`Download failed: ${res.status} ${await res.text()}`);
    return res.text();
  }, [folder, name]);
}

// Best-effort cleanup of whatever a test left behind under /Documents, using
// the app's own signed-in token. Graph deletes recursively.
async function removeFromDocuments(page: Page, name: string) {
  await page.evaluate(async (name) => {
    const { getToken } = await import("./auth.js");
    const { config } = await import("./config.js");
    const token = await getToken();
    const res = await fetch(
      `${config.graphBase}/me/drive/root:/Documents/${encodeURIComponent(name)}`,
      { method: "DELETE", headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok && res.status !== 404) {
      throw new Error(`Cleanup failed: ${res.status} ${await res.text()}`);
    }
  }, name);
}

test("UPLOAD-001: upload multiple files into a new folder", async ({ page }) => {
  const artefactsDir = process.env.ARTEFACTS_DIR;
  const folderName = randomFolderName();
  const files = createLocalFiles("file1.txt", "file2.txt", "file3.txt", "file4.txt");
  const renamed = "2020-02-02_UPLOADTEST01.txt";
  const listing = page.locator("#listing");

  await openDocuments(page);
  await page.screenshot({ path: `${artefactsDir}/07-00-documents.png` });

  try {
    await createFolderViaUi(page, folderName);
    await openFolder(page, folderName);
    await expect(listing).toContainText("This folder is empty.");

    const dialog = await openUploadDialog(page);
    await expect(dialog).toContainText(`/Documents/${folderName}`);
    const fileList = dialog.getByRole("list", { name: "Files to upload" });
    const entries = fileList.getByRole("listitem");

    await pickFiles(page, dialog, [files["file1.txt"], files["file2.txt"], files["file3.txt"]]);
    await expect(entries).toHaveCount(3);
    for (const name of ["file1.txt", "file2.txt", "file3.txt"]) {
      await expect(fileList.getByText(name, { exact: true })).toHaveCount(1);
    }
    await page.screenshot({ path: `${artefactsDir}/07-01-picked.png` });

    await dialog.getByRole("button", { name: "Remove file2.txt" }).click();
    await expect(fileList.getByText("file2.txt", { exact: true })).toHaveCount(0);
    await expect(entries).toHaveCount(2);

    // Picking file1.txt again must not produce a duplicate entry.
    await pickFiles(page, dialog, [files["file1.txt"]]);
    await expect(entries).toHaveCount(2);
    await expect(entries.nth(0)).toContainText("file1.txt");
    await expect(entries.nth(1)).toContainText("file3.txt");
    await expect(fileList.getByText("file1.txt", { exact: true })).toHaveCount(1);
    await expect(fileList.getByText("file3.txt", { exact: true })).toHaveCount(1);
    await page.screenshot({ path: `${artefactsDir}/07-02-deduped.png` });

    // Each entry gets a name input prefilled with the original file name.
    await pickFiles(page, dialog, [files["file4.txt"]]);
    await expect(entries).toHaveCount(3);
    await expect(dialog.getByLabel("Upload file1.txt as")).toHaveValue("file1.txt");
    await expect(dialog.getByLabel("Upload file3.txt as")).toHaveValue("file3.txt");
    const file4Name = dialog.getByLabel("Upload file4.txt as");
    await expect(file4Name).toHaveValue("file4.txt");

    // An empty name disables the upload.
    const uploadBtn = dialog.getByRole("button", { name: "Upload", exact: true });
    await expect(uploadBtn).toBeEnabled();
    await file4Name.fill("");
    await expect(uploadBtn).toBeDisabled();
    await page.screenshot({ path: `${artefactsDir}/07-03-empty-name.png` });

    await file4Name.fill(renamed);
    await expect(uploadBtn).toBeEnabled();
    // The original name stays listed next to the input.
    await expect(fileList.getByText("file4.txt", { exact: true })).toHaveCount(1);
    await page.screenshot({ path: `${artefactsDir}/07-04-renamed.png` });

    await uploadBtn.click();
    // While uploading (or once done) the remove icons are gone and the names
    // can no longer be edited.
    await expect(dialog.getByRole("button", { name: /^Remove / })).toHaveCount(0);
    await expect(file4Name).toBeDisabled();

    const closeBtn = dialog.getByRole("button", { name: "Close" });
    await expect(closeBtn).toBeVisible({ timeout: 30_000 });
    await expect(closeBtn).toBeEnabled();
    await expect(dialog.getByRole("button", { name: "Upload", exact: true })).toHaveCount(0);
    for (const name of ["file1.txt", "file3.txt", "file4.txt"]) {
      const entry = entries.filter({ hasText: name });
      await expect(entry.getByRole("img", { name: "Uploaded" })).toBeVisible();
    }
    await expect(fileList.getByRole("img", { name: "Upload failed" })).toHaveCount(0);
    await page.screenshot({ path: `${artefactsDir}/07-05-uploaded.png` });

    await closeBtn.click();
    await expect(dialog).not.toBeVisible();
    await expect(page.getByText("Loading")).not.toBeVisible();
    await expect(page.locator("#breadcrumbs > span:last-child")).toHaveText(folderName);
    const rows = listing.locator(".row:not(.head)");
    await expect(rows).toHaveCount(3);
    await expect(listing.getByText("file1.txt", { exact: true })).toBeVisible();
    await expect(listing.getByText("file3.txt", { exact: true })).toBeVisible();
    // The listing shows the date prefix in its own Reference column.
    const renamedRow = rows.filter({ has: page.getByText("UPLOADTEST01.txt", { exact: true }) });
    await expect(renamedRow).toHaveCount(1);
    await expect(renamedRow.locator(".meta-ref")).toHaveText("2020-02-02");
    await expect(listing.getByText("file2.txt", { exact: true })).toHaveCount(0);
    await expect(listing.getByText("file4.txt", { exact: true })).toHaveCount(0);
    await page.screenshot({ path: `${artefactsDir}/07-06-listing.png` });

    // The file exists under its full new name and carries file4.txt's
    // original content.
    expect(await readFromDocuments(page, folderName, renamed))
      .toBe(readFileSync(files["file4.txt"], "utf8"));
  } finally {
    await removeFromDocuments(page, folderName);
  }
});

test("UPLOAD-002: cancelling the Upload dialog uploads nothing", async ({ page }) => {
  const artefactsDir = process.env.ARTEFACTS_DIR;
  const folderName = randomFolderName();
  const files = createLocalFiles("cancel1.txt", "cancel2.txt");
  const listing = page.locator("#listing");

  await openDocuments(page);
  try {
    await createFolderViaUi(page, folderName);
    await openFolder(page, folderName);

    const dialog = await openUploadDialog(page);
    // Nothing picked yet, so there is nothing to upload.
    await expect(dialog.getByRole("button", { name: "Upload", exact: true })).toBeDisabled();
    await pickFiles(page, dialog, Object.values(files));
    await expect(dialog.getByRole("listitem")).toHaveCount(2);
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await page.screenshot({ path: `${artefactsDir}/07-10-cancelled.png` });

    await page.reload();
    await openFolder(page, "Documents");
    await openFolder(page, folderName);
    await expect(listing).toContainText("This folder is empty.");

    // Re-opening starts from an empty list.
    const reopened = await openUploadDialog(page);
    await expect(reopened.getByRole("listitem")).toHaveCount(0);
  } finally {
    await removeFromDocuments(page, folderName);
  }
});

// Uploads use conflictBehavior "fail", so re-uploading an existing name is
// rejected by OneDrive and exercises the failed icon without any mocking.
test("UPLOAD-003: files that already exist are marked as failed, others still upload", async ({ page }) => {
  const artefactsDir = process.env.ARTEFACTS_DIR;
  const folderName = randomFolderName();
  const files = createLocalFiles("existing.txt", "fresh.txt");
  const listing = page.locator("#listing");

  await openDocuments(page);
  try {
    await createFolderViaUi(page, folderName);
    await openFolder(page, folderName);

    let dialog = await openUploadDialog(page);
    await pickFiles(page, dialog, [files["existing.txt"]]);
    await dialog.getByRole("button", { name: "Upload", exact: true }).click();
    await dialog.getByRole("button", { name: "Close" }).click({ timeout: 30_000 });
    await expect(dialog).not.toBeVisible();
    await expect(listing.getByText("existing.txt", { exact: true })).toBeVisible();

    dialog = await openUploadDialog(page);
    await pickFiles(page, dialog, [files["existing.txt"], files["fresh.txt"]]);
    await dialog.getByRole("button", { name: "Upload", exact: true }).click();
    const closeBtn = dialog.getByRole("button", { name: "Close" });
    await expect(closeBtn).toBeEnabled({ timeout: 30_000 });

    const entries = dialog.getByRole("listitem");
    await expect(entries.filter({ hasText: "existing.txt" }).getByRole("img", { name: "Upload failed" })).toBeVisible();
    await expect(entries.filter({ hasText: "fresh.txt" }).getByRole("img", { name: "Uploaded" })).toBeVisible();
    await page.screenshot({ path: `${artefactsDir}/07-20-partial-failure.png` });

    await closeBtn.click();
    await expect(dialog).not.toBeVisible();
    await expect(page.getByText("Loading")).not.toBeVisible();
    await expect(listing.locator(".row:not(.head)")).toHaveCount(2);
    await expect(listing.getByText("fresh.txt", { exact: true })).toBeVisible();
  } finally {
    await removeFromDocuments(page, folderName);
  }
});

test("UPLOAD-004: the Upload dialog previews the selected file next to the list", async ({ page }) => {
  const artefactsDir = process.env.ARTEFACTS_DIR;
  const pdf = createLocalPdf("2020-02-02_preview.pdf", ["Upload preview page 1", "Upload preview page 2"]);
  const files = createLocalFiles("notes.txt");
  const viewport = page.viewportSize()!;

  await openDocuments(page);
  const dialog = await openUploadDialog(page);

  // The dialog uses (almost) the whole viewport.
  const box = (await dialog.boundingBox())!;
  expect(box.width).toBeGreaterThan(viewport.width * 0.9);
  expect(box.height).toBeGreaterThan(viewport.height * 0.9);

  const preview = dialog.getByRole("region", { name: "Upload preview" });
  await expect(preview).toBeVisible();
  await expect(preview).toContainText("Select a file from the list to preview it here.");
  await page.screenshot({ path: `${artefactsDir}/07-30-empty-preview.png` });

  // The list sits to the left of the preview, which gets the larger share
  // of the space.
  const fileList = dialog.getByRole("list", { name: "Files to upload" });
  const previewBox = (await preview.boundingBox())!;
  const sideBox = (await dialog.getByRole("heading", { name: "Upload Files" }).boundingBox())!;
  expect(previewBox.x).toBeGreaterThan(sideBox.x);
  expect(previewBox.width).toBeGreaterThan(box.width * 0.4);

  // The first picked file is previewed right away: every PDF page is
  // rendered, at nearly the pane's full width.
  await pickFiles(page, dialog, [pdf, files["notes.txt"]]);
  const entries = fileList.getByRole("listitem");
  await expect(entries).toHaveCount(2);
  await expect(entries.nth(0)).toHaveAttribute("aria-current", "true");
  await expect(preview.locator(".viewer-title")).toHaveText("2020-02-02_preview.pdf");
  const pages = preview.locator("canvas.pdf-page");
  await expect(pages).toHaveCount(2);
  const pageBox = (await pages.first().boundingBox())!;
  expect(pageBox.width).toBeGreaterThan(previewBox.width * 0.85);
  await page.screenshot({ path: `${artefactsDir}/07-31-pdf-preview.png` });

  // Name inputs are wide enough for long names (twice the old 560px dialog).
  const rename = dialog.getByRole("textbox", { name: "Upload 2020-02-02_preview.pdf as" });
  expect((await rename.boundingBox())!.width).toBeGreaterThan(viewport.width >= 1600 ? 400 : 250);

  // Clicking another row previews that file instead.
  await entries.nth(1).getByText("notes.txt", { exact: true }).click();
  await expect(entries.nth(1)).toHaveAttribute("aria-current", "true");
  await expect(entries.nth(0)).not.toHaveAttribute("aria-current", "true");
  await expect(preview.locator(".viewer-title")).toHaveText("notes.txt");
  await expect(preview.locator("pre")).toHaveText(readFileSync(files["notes.txt"], "utf8"));
  await expect(pages).toHaveCount(0);
  await page.screenshot({ path: `${artefactsDir}/07-32-text-preview.png` });

  // Focusing a name input previews its file, so it can guide the new name.
  await rename.focus();
  await expect(entries.nth(0)).toHaveAttribute("aria-current", "true");
  await expect(pages).toHaveCount(2);

  // Removing the previewed file moves the preview on to the next one.
  await dialog.getByRole("button", { name: "Remove 2020-02-02_preview.pdf" }).click();
  await expect(entries).toHaveCount(1);
  await expect(entries.nth(0)).toHaveAttribute("aria-current", "true");
  await expect(preview.locator(".viewer-title")).toHaveText("notes.txt");

  // Removing the last file empties the preview again.
  await dialog.getByRole("button", { name: "Remove notes.txt" }).click();
  await expect(entries).toHaveCount(0);
  await expect(preview).toContainText("Select a file from the list to preview it here.");

  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).not.toBeVisible();
});

const cfToken = process.env.TEST_CF_APITOKEN;
const SAMPLE_PDF_URL = "https://www.successcontrol.de/wp-content/uploads/2021/03/Lieferschein-Muster-PDF.pdf";

test("UPLOAD-005: the magic wand suggests a file name from the PDF's extracted fields", async ({ page }) => {
  test.skip(!cfToken, "TEST_CF_APITOKEN is not set");
  // pdf.js renders the first page, then the model reads it.
  test.setTimeout(180_000);
  const artefactsDir = process.env.ARTEFACTS_DIR;
  const pdf = await downloadLocalCopy(SAMPLE_PDF_URL);
  const files = createLocalFiles("notes.txt");

  await signInToCloudflare(page, cfToken!);
  await openDocuments(page);
  const dialog = await openUploadDialog(page);
  await pickFiles(page, dialog, [pdf, files["notes.txt"]]);
  const entries = dialog.getByRole("list", { name: "Files to upload" }).getByRole("listitem");
  await expect(entries).toHaveCount(2);

  // Every entry has a wand next to its remove icon, but only PDFs can be
  // read.
  const pdfWand = dialog.getByRole("button", { name: "Suggest a name for Lieferschein-Muster-PDF.pdf" });
  const textWand = dialog.getByRole("button", { name: "Suggest a name for notes.txt" });
  await expect(pdfWand).toBeEnabled();
  await expect(textWand).toBeDisabled();
  for (const name of ["Lieferschein-Muster-PDF.pdf", "notes.txt"]) {
    const wandBox = (await dialog.getByRole("button", { name: `Suggest a name for ${name}` }).boundingBox())!;
    const removeBox = (await dialog.getByRole("button", { name: `Remove ${name}` }).boundingBox())!;
    expect(wandBox.x).toBeLessThan(removeBox.x);
    expect(Math.abs(wandBox.y - removeBox.y)).toBeLessThan(wandBox.height);
  }
  await page.screenshot({ path: `${artefactsDir}/07-40-wands.png` });

  const rename = dialog.getByLabel("Upload Lieferschein-Muster-PDF.pdf as");
  await expect(rename).toHaveValue("Lieferschein-Muster-PDF.pdf");
  await pdfWand.click();

  // The suggestion replaces the name; the extraction result isn't shown.
  await expect(rename).toHaveValue(/2021-03-16/, { timeout: 120_000 });
  await expect(rename).toHaveValue(/Lieferschein/i);
  await expect(rename).toHaveValue(/^2021-03-16_.+\.pdf$/);
  await expect(page.getByRole("dialog", { name: "Extracted Fields" })).not.toBeVisible();
  await expect(pdfWand).toBeEnabled();
  await expect(dialog.getByLabel("Upload notes.txt as")).toHaveValue("notes.txt");
  await page.screenshot({ path: `${artefactsDir}/07-41-suggested-name.png` });

  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).not.toBeVisible();
});

test("UPLOAD-006: files dropped onto the dropzone are added to the list", async ({ page }) => {
  const artefactsDir = process.env.ARTEFACTS_DIR;

  await openDocuments(page);
  const dialog = await openUploadDialog(page);
  const zone = dropzone(dialog);
  await expect(zone).toBeVisible();
  await page.screenshot({ path: `${artefactsDir}/07-50-dropzone.png` });

  // Playwright can't drag files in from the OS, so build the DataTransfer a
  // real drop would carry in the page and dispatch the drag events with it.
  const dataTransfer = await page.evaluateHandle(() => {
    const dt = new DataTransfer();
    dt.items.add(new File(["dropped one\n"], "dropped1.txt", { type: "text/plain" }));
    dt.items.add(new File(["dropped two\n"], "dropped2.txt", { type: "text/plain" }));
    return dt;
  });
  await zone.dispatchEvent("dragenter", { dataTransfer });
  await expect(zone).toHaveAttribute("data-dragging", "");
  await page.screenshot({ path: `${artefactsDir}/07-51-dragging.png` });
  await zone.dispatchEvent("drop", { dataTransfer });
  await expect(zone).not.toHaveAttribute("data-dragging", "");

  const fileList = dialog.getByRole("list", { name: "Files to upload" });
  const entries = fileList.getByRole("listitem");
  await expect(entries).toHaveCount(2);
  await expect(fileList.getByText("dropped1.txt", { exact: true })).toHaveCount(1);
  await expect(fileList.getByText("dropped2.txt", { exact: true })).toHaveCount(1);
  // The first dropped file is previewed, as with picked files.
  await expect(entries.nth(0)).toHaveAttribute("aria-current", "true");
  await expect(dialog.getByRole("region", { name: "Upload preview" }).locator("pre")).toHaveText("dropped one\n");
  await expect(dialog.getByRole("button", { name: "Upload", exact: true })).toBeEnabled();
  await page.screenshot({ path: `${artefactsDir}/07-52-dropped.png` });

  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).not.toBeVisible();
});
