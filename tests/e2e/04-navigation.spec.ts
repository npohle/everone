import { test, expect } from "./fixtures.ts";

test("NAV-001: an \"Up\" button is present", async ({ page }) => {
  const artefactsDir = process.env.ARTEFACTS_DIR;

  await page.goto(`https://rubisco.io/`);
  await expect(page.getByText("Loading")).not.toBeVisible();
  await page.screenshot({ path: `${artefactsDir}/04-00-signed-in.png` });

  await expect(page.getByRole("button", { name: "↑ Up", exact: true })).toBeVisible();
});
