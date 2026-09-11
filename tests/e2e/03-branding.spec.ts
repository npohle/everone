import { test, expect } from "./fixtures.ts";

test("BRANDING-001: branding is displayed correctly", async ({ page }) => {
  const artefactsDir = process.env.ARTEFACTS_DIR;

  await page.goto(`https://npohle.github.io/everone/`);
  
  await page.screenshot({ path: `${artefactsDir}/03-00-start.png` });

  await expect(page.getByText("EverOne: Browse Microsoft OneDrive")).toBeVisible();
  await expect(page.getByText("Loading")).not.toBeVisible();
  
  await page.screenshot({ path: `${artefactsDir}/03-01-branding.png` });

});
