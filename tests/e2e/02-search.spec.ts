import { test, expect } from "./fixtures.ts";

// The search box has no submit button — app.js runs the search on debounced
// input once the query is 2+ characters (see app.js's "input" listener).
test('SEARCH-001: search for "Anywhere"', async ({ page }) => {
  const artefactsDir = process.env.ARTEFACTS_DIR;

  await page.goto(`https://npohle.github.io/everone/`);
  await expect(page.getByText("Loading")).not.toBeVisible();
  await page.screenshot({ path: `${artefactsDir}/02-00-start.png` });

  /*
  page.on('console', msg => console.log(msg.text()));
  page.on('requestfinished', async (request) => {
    const response = await request.response();
    console.log(JSON.stringify({
      method: request.method(),
      url: request.url(),
      requestHeaders: request.headers(),
      postData: request.postData(),
      status: response?.status(),
      statusText: response?.statusText(),
      responseHeaders: response?.headers(),
    }));
  });
  */

  //await page.waitForTimeout(2000);
  await page.getByPlaceholder("Search OneDrive…").fill("Anywhere");
  await expect(page.getByText("match")).toBeVisible();
  await page.screenshot({ path: `${artefactsDir}/02-01-results.png` });
});
