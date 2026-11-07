import { randomBytes } from "node:crypto";
import { test, expect } from "./fixtures.ts";
import { filesInFolder, listingRow, selectFolder } from "./lib/listing.ts";
import type { Page } from "@playwright/test";

// EXTRACT-001 holds a real Cloudflare API token, which ends up in the
// sessionStorage init script and in the request to the extract proxy. Traces
// record both, so keep tracing off for this file.
test.use({ trace: "off" });

const cfToken = process.env.TEST_CF_APITOKEN;

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

const extractButton = (page: Page) => page.locator(".viewer-bar").getByRole("button", { name: "Extract" });

test("EXTRACT-001: extract fields from the first page of a previewed PDF", async ({ page }) => {
  test.skip(!cfToken, "TEST_CF_APITOKEN is not set");
  // pdf.js renders the page, then the model reads it.
  test.setTimeout(180_000);
  const artefactsDir = process.env.ARTEFACTS_DIR;

  await signInToCloudflare(page, cfToken!);
  await page.goto(`https://rubisco.io/`);
  await expect(page.getByText("Loading")).not.toBeVisible();
  await page.screenshot({ path: `${artefactsDir}/10-00-start.png` });

  await selectFolder(page, "Documents");
  await selectFolder(page, "e2e-test-search-01");
  await page.screenshot({ path: `${artefactsDir}/10-01-folder.png` });

  // The first document in the listing (skipping folders).
  const firstDocument = (await filesInFolder(page, "e2e-test-search-01")).first();
  await firstDocument.click();
  await expect(page.locator("#viewer-body canvas.pdf-page").first()).toBeVisible({ timeout: 30_000 });
  await page.screenshot({ path: `${artefactsDir}/10-02-preview.png` });

  const extractBtn = extractButton(page);
  await expect(extractBtn).toBeEnabled();
  await extractBtn.click();

  const dialog = page.getByRole("dialog", { name: "Extracted Fields" });
  await expect(dialog).toBeVisible();
  const result = dialog.getByRole("textbox", { name: "Extraction result" });
  await expect(result).toHaveValue(/Lieferschein/, { timeout: 120_000 });
  await expect(result).toHaveValue(/2021-03-16/);
  // Valid JSON.
  JSON.parse(await result.inputValue());
  await page.screenshot({ path: `${artefactsDir}/10-03-extracted-fields.png` });

  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(dialog).not.toBeVisible();
});

const randomFolderName = () => `e2e-test-${randomBytes(6).toString("hex")}`;

test("EXTRACT-002: the Extract button is only enabled for PDF documents", async ({ page }) => {
  const artefactsDir = process.env.ARTEFACTS_DIR;
  const folderName = randomFolderName();

  await page.goto(`https://rubisco.io/`);
  await expect(page.getByText("Loading")).not.toBeVisible();
  const extractBtn = extractButton(page);
  await expect(extractBtn).toBeHidden();

  const graphCall = (path: string, init: { method: string; body?: string; contentType?: string }) =>
    page.evaluate(async ({ path, init }) => {
      const { getToken } = await import("./auth.js");
      const { config } = await import("./config.js");
      const token = await getToken();
      const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
      if (init.contentType) headers["Content-Type"] = init.contentType;
      const res = await fetch(`${config.graphBase}/me/drive/root:/Documents/${path}`, {
        method: init.method,
        headers,
        body: init.body,
      });
      if (!res.ok && !(init.method === "DELETE" && res.status === 404)) {
        throw new Error(`${init.method} failed: ${res.status} ${await res.text()}`);
      }
    }, { path, init });

  try {
    await graphCall(`${encodeURIComponent(folderName)}/notes.txt:/content`, {
      method: "PUT", body: "not a pdf\n", contentType: "text/plain",
    });
    await selectFolder(page, "Documents");
    await selectFolder(page, folderName);

    await listingRow(page, "notes.txt").click();
    await expect(page.locator("#viewer-title")).toHaveText("notes.txt");
    await expect(page.locator("#viewer-body pre")).toContainText("not a pdf");
    await expect(extractBtn).toBeVisible();
    await expect(extractBtn).toBeDisabled();
    await page.screenshot({ path: `${artefactsDir}/10-10-disabled-for-text.png` });
  } finally {
    // Graph deletes recursively, so this also removes the document.
    await graphCall(encodeURIComponent(folderName), { method: "DELETE" });
  }
});
