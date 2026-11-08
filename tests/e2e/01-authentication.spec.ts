import { test, expect } from "./fixtures.ts";

test("AUTH-001: user is authenticated", async ({ page }) => {
  const artefactsDir = process.env.ARTEFACTS_DIR;

  await page.goto(`https://rubisco.io/`);

  await page.screenshot({ path: `${artefactsDir}/01-00-start.png` });

  const onedrive = page.getByRole("group", { name: "OneDrive account" });
  await expect(onedrive.getByRole("button", { name: "Sign out of OneDrive" })).toBeVisible();
  await expect(page.getByText("Loading")).not.toBeVisible();

  await page.screenshot({ path: `${artefactsDir}/01-01-auth.png` });

});

// The header's sign-in buttons are icons only (Microsoft's and Cloudflare's
// logos, no "Sign in" or provider labels); a green check on the icon marks a
// signed-in provider, and hovering shows who's signed in.
test("AUTH-002: header shows the sign-in state as icons, with the account on hover", async ({ page }) => {
  const artefactsDir = process.env.ARTEFACTS_DIR;
  const onedrive = page.getByRole("group", { name: "OneDrive account" });
  const cloudflare = page.getByRole("group", { name: "Cloudflare account" });
  const onedriveBtn = onedrive.getByRole("button", { name: "Sign out of OneDrive" });
  const cloudflareBtn = cloudflare.getByRole("button", { name: "Sign in to Cloudflare" });

  await page.goto(`https://rubisco.io/`);
  await expect(page.getByText("Loading")).not.toBeVisible();
  await expect(onedriveBtn).toBeVisible();
  await expect(cloudflareBtn).toBeVisible();

  // Icons, without any text.
  const header = page.locator("header.topbar");
  await expect(header.getByText(/^(OneDrive|Cloudflare|Sign in|Sign out)$/)).toHaveCount(0);
  for (const btn of [onedriveBtn, cloudflareBtn]) {
    await expect(btn.locator("svg.auth-icon")).toBeVisible();
    await expect(btn).toHaveText("");
  }

  // Signed in to OneDrive only (the saved state holds no Cloudflare token).
  await expect(onedriveBtn.locator(".auth-check")).toBeVisible();
  await expect(cloudflareBtn.locator(".auth-check")).not.toBeVisible();
  await page.screenshot({ path: `${artefactsDir}/01-02-header-icons.png` });

  // Hovering OneDrive's shows the signed-in username (compared without
  // printing it in a failure message).
  const onedriveTip = onedrive.getByRole("tooltip");
  await expect(onedriveTip).not.toBeVisible();
  await onedriveBtn.hover();
  await expect(onedriveTip).toBeVisible();
  await expect(onedriveBtn).toHaveAccessibleDescription(/\S/);
  const username = (await onedriveTip.textContent())?.trim().toLowerCase();
  expect(username === process.env.TEST_USERNAME?.trim().toLowerCase()).toBe(true);
  await page.screenshot({ path: `${artefactsDir}/01-03-onedrive-hover.png` });

  // Cloudflare's says it isn't signed in.
  const cloudflareTip = cloudflare.getByRole("tooltip");
  await cloudflareBtn.hover();
  await expect(cloudflareTip).toBeVisible();
  await expect(cloudflareTip).toHaveText("not authenticated");
  await expect(cloudflareBtn).toHaveAccessibleDescription("not authenticated");
  await expect(onedriveTip).not.toBeVisible();
  await page.screenshot({ path: `${artefactsDir}/01-04-cloudflare-hover.png` });
});
