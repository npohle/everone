import { test, expect } from "./fixtures.ts";

// The search box has no submit button — app.js runs the search on debounced
// input once the query is 2+ characters (see app.js's "input" listener).
test('SEARCH-001: search for "Anywhere"', async ({ page }) => {
  const artefactsDir = process.env.ARTEFACTS_DIR;

  await page.goto(`https://npohle.github.io/everone/`);
  await page.screenshot({ path: `${artefactsDir}/02-00-start.png` });

  await page.getByPlaceholder("Search OneDrive…").fill("Anywhere");
  await expect(page.getByText("match")).toBeVisible();
  await page.screenshot({ path: `${artefactsDir}/02-01-results.png` });
});
