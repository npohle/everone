import { test, expect } from "./fixtures.ts";

// The toolbar's "up one level" control lives inside #browser, which index.html
// ships with `hidden` and app.js only reveals once a signed-in session has
// loaded — so seeing it at all is also proof the session is signed in.
test('NAV-001: a button labelled "Up" is present', async ({ page }) => {
  const artefactsDir = process.env.ARTEFACTS_DIR;

  await page.goto(`https://npohle.github.io/everone/`);
  await expect(page.getByText("Loading")).not.toBeVisible();

  await page.screenshot({ path: `${artefactsDir}/04-00-start.png` });

  const upButton = page.getByRole("button", { name: /Up/ });
  await expect(upButton).toBeVisible();

  await page.screenshot({ path: `${artefactsDir}/04-01-up-button.png` });
});
