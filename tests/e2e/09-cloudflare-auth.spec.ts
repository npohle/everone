import { test, expect } from "./fixtures.ts";
import type { Page } from "@playwright/test";
import { createHash } from "node:crypto";

// The Cloudflare sign-in types a real password into the page. Traces record
// every fill() value, so keep tracing off for this file (see also the
// password field being cleared in CFAUTH-001 before any failure snapshot).
test.use({ trace: "off" });

const groups = (page: Page) => ({
  onedrive: page.getByRole("group", { name: "OneDrive account" }),
  cloudflare: page.getByRole("group", { name: "Cloudflare account" }),
});

async function expectBothSignedIn(page: Page) {
  const { onedrive, cloudflare } = groups(page);
  await expect(onedrive.getByRole("button", { name: "Sign out of OneDrive" })).toBeVisible();
  await expect(cloudflare.getByRole("button", { name: "Sign out of Cloudflare" })).toBeVisible();
}

// Signing out of Cloudflare leaves the OneDrive sign-in untouched.
async function signOutOfCloudflareOnly(page: Page) {
  const { onedrive, cloudflare } = groups(page);
  await cloudflare.getByRole("button", { name: "Sign out of Cloudflare" }).click();
  await expect(cloudflare.getByRole("button", { name: "Sign in to Cloudflare" })).toBeVisible();
  await expect(onedrive.getByRole("button", { name: "Sign out of OneDrive" })).toBeVisible();
  await expect(page.getByText("Load more")).toBeVisible();
}

async function startSignedInToOneDriveOnly(page: Page, screenshot: string) {
  const { onedrive, cloudflare } = groups(page);
  await page.goto(`https://rubisco.io/`);
  await expect(page.getByText("Loading")).not.toBeVisible();
  await expect(onedrive.getByRole("button", { name: "Sign out of OneDrive" })).toBeVisible();
  await expect(cloudflare.getByRole("button", { name: "Sign in to Cloudflare" })).toBeVisible();
  await page.screenshot({ path: screenshot });
}

test("CFAUTH-001: user signs in to Cloudflare via the UI, alongside OneDrive", async ({ page }) => {
  const artefactsDir = process.env.ARTEFACTS_DIR;
  const { cloudflare } = groups(page);

  await startSignedInToOneDriveOnly(page, `${artefactsDir}/09-00-start.png`);

  await cloudflare.getByRole("button", { name: "Sign in to Cloudflare" }).click();
  await page.waitForURL(/^https:\/\/dash\.cloudflare\.com\//);

  // Cloudflare's dashboard sits behind its own bot protection, which can stop
  // automated (notably headless) browsers before the login form, or fail its
  // Turnstile check on submit. That's outside this app's control, so skip
  // rather than fail — the run's screenshot shows which page it stopped on.
  const email = page.getByRole("textbox", { name: "Email" });
  const formShown = await email.waitFor({ timeout: 20_000 }).then(() => true).catch(() => false);
  if (!formShown) {
    await page.screenshot({ path: `${artefactsDir}/09-01-bot-check.png` });
    test.skip(true, "Cloudflare showed its bot-verification page instead of the login form");
  }

  const password = page.getByRole("textbox", { name: "Password" });
  try {
    await email.fill(process.env.TEST_CF_USERNAME!);
    await password.fill(process.env.TEST_CF_PASSWORD!);
    await page.screenshot({ path: `${artefactsDir}/09-01-login.png` });

    const submit = page.getByRole("button", { name: "Sign in", exact: true });
    const verificationFailed = page.getByText("There was a problem with verification");
    const submittable = await expect(submit)
      .toBeEnabled({ timeout: 20_000 })
      .then(() => true)
      .catch(() => false);
    if (!submittable || (await verificationFailed.isVisible())) {
      await page.screenshot({ path: `${artefactsDir}/09-02-bot-check.png` });
      test.skip(true, "Cloudflare's Turnstile verification failed on the login form");
    }
    await submit.click();

    // First-time consent for the app's "ai.read" scope is asked on
    // Cloudflare's side before it redirects back (to callback/, which
    // redeems the code and returns to the app).
    const consent = page.getByRole("button", { name: /^(authorize|allow|accept)$/i });
    const backInApp = page.waitForURL(/^https:\/\/rubisco\.io\//, { timeout: 30_000 });
    const asked = await Promise.race([
      backInApp.then(() => false),
      consent.waitFor({ timeout: 30_000 }).then(() => true),
    ]);
    if (asked) {
      await page.screenshot({ path: `${artefactsDir}/09-03-consent.png` });
      await consent.click();
    }
    await backInApp;
  } finally {
    // Never leave the password in the DOM for Playwright's failure snapshot
    // (error-context.md), which ends up in the shared artefacts.
    if (!page.isClosed() && (await password.isVisible().catch(() => false))) {
      await password.fill("").catch(() => {});
    }
  }

  await expect(page.getByText("Loading")).not.toBeVisible();
  await expectBothSignedIn(page);
  await page.screenshot({ path: `${artefactsDir}/09-04-both-signed-in.png` });

  await signOutOfCloudflareOnly(page);
  await page.screenshot({ path: `${artefactsDir}/09-05-cloudflare-signed-out.png` });
});

// Same flow, with Cloudflare's authorize and token endpoints answered locally
// as they answer on success — covers the app's side of the flow (authorize
// request with PKCE, callback page, state check, code exchange, token
// storage, header) independently of Cloudflare's bot protection on its login
// page.
test("CFAUTH-002: Cloudflare token obtained via the code flow is held alongside the OneDrive one", async ({ page }) => {
  const artefactsDir = process.env.ARTEFACTS_DIR;
  const { cloudflare } = groups(page);

  await startSignedInToOneDriveOnly(page, `${artefactsDir}/09-10-start.png`);

  let authorize: URL | undefined;
  await page.route("https://dash.cloudflare.com/oauth2/auth**", async (route) => {
    authorize = new URL(route.request().url());
    const p = authorize.searchParams;
    const query = new URLSearchParams({ code: "e2e-cloudflare-code", scope: p.get("scope")!, state: p.get("state")! });
    await route.fulfill({ status: 303, headers: { location: `${p.get("redirect_uri")}?${query}` } });
  });

  let tokenRequest: URLSearchParams | undefined;
  await page.route("https://dash.cloudflare.com/oauth2/token", async (route) => {
    const cors = { "access-control-allow-origin": "https://rubisco.io" };
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    tokenRequest = new URLSearchParams(route.request().postData() ?? "");
    await route.fulfill({
      status: 200,
      headers: cors,
      contentType: "application/json",
      body: JSON.stringify({ access_token: "e2e-cloudflare-token", token_type: "bearer", expires_in: 3600, scope: "ai.read" }),
    });
  });

  await cloudflare.getByRole("button", { name: "Sign in to Cloudflare" }).click();
  await page.waitForURL("https://rubisco.io/");

  const a = authorize!.searchParams;
  expect(a.get("client_id")).toBe("0b70dc1b060717a33f39ea09743b85df");
  expect(a.get("scope")).toBe("ai.read");
  expect(a.get("response_type")).toBe("code");
  expect(a.get("redirect_uri")).toBe("https://rubisco.io/callback");
  expect(a.get("code_challenge_method")).toBe("S256");

  // The code was redeemed with the verifier matching the challenge sent above.
  expect(tokenRequest?.get("grant_type")).toBe("authorization_code");
  expect(tokenRequest?.get("code")).toBe("e2e-cloudflare-code");
  expect(tokenRequest?.get("client_id")).toBe("0b70dc1b060717a33f39ea09743b85df");
  expect(tokenRequest?.get("redirect_uri")).toBe("https://rubisco.io/callback");
  const verifier = tokenRequest?.get("code_verifier") ?? "";
  expect(createHash("sha256").update(verifier).digest("base64url")).toBe(a.get("code_challenge"));

  await expect(page.getByText("Loading")).not.toBeVisible();
  await expectBothSignedIn(page);
  await page.screenshot({ path: `${artefactsDir}/09-11-both-signed-in.png` });

  // Two independent tokens: MSAL's cache and the Cloudflare token side by side.
  const keys = await page.evaluate(() => Object.keys(window.sessionStorage));
  expect(keys).toContain("cloudflare.token");
  expect(keys.some((k) => k.includes("login.microsoftonline.com") || k.startsWith("msal."))).toBe(true);

  // Both survive a reload.
  await page.reload();
  await expect(page.getByText("Loading")).not.toBeVisible();
  await expectBothSignedIn(page);

  await signOutOfCloudflareOnly(page);
  expect(await page.evaluate(() => window.sessionStorage.getItem("cloudflare.token"))).toBeNull();
  await page.screenshot({ path: `${artefactsDir}/09-12-cloudflare-signed-out.png` });
});
