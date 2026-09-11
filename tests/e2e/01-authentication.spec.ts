import { test, expect } from "./fixtures.ts";

test("AUTH-001: user is authenticated", async ({ page }) => {
  const artefactsDir = process.env.ARTEFACTS_DIR;

  await page.goto(`https://npohle.github.io/everone/`);
  
  await page.screenshot({ path: `${artefactsDir}/01-00-start.png` });

  await expect(page.getByText("Sign out")).toBeVisible();
  await expect(page.getByText("Loading")).not.toBeVisible();
  
  await page.screenshot({ path: `${artefactsDir}/01-01-auth.png` });

});
