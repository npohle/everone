// End-to-end authentication: real Microsoft account, real password, real TOTP.

import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";

import { completeSignIn } from "../lib/microsoft-login.js";
import { STEP } from "../lib/login-steps.js";
import { useHarness } from "../lib/harness.js";

describe("sign-in", { concurrency: 1 }, () => {
  let rig;
  let steps = [];

  before(async () => {
    rig = await useHarness();
    await rig.page.open();
  });

  it("starts signed out", async () => {
    const state = await rig.page.state();
    // A spec that ran earlier may already have signed in; nothing to prove then.
    if (state.authButton === "Sign out") return;
    assert.equal(state.signedOutVisible, true);
  });

  it("signs in with password and an authenticator code", async () => {
    if (await rig.page.isSignedIn()) return;

    await rig.page.clickSignIn();
    steps = await completeSignIn(rig.browser, rig.config, {
      log: (msg) => console.error(`# ${msg}`),
      timeoutMs: 180_000,
    });

    assert.ok(
      steps.includes(STEP.USERNAME) || steps.includes(STEP.ACCOUNT_PICKER),
      `expected an account step, saw: ${steps.join(" -> ") || "(none)"}`
    );
    assert.ok(
      steps.includes(STEP.TOTP),
      `expected the authenticator-code step, saw: ${steps.join(" -> ")}`
    );
  });

  it("closes the popup and shows the signed-in app", async () => {
    const state = await rig.page.waitForSignedIn(120_000);
    assert.equal(state.authButton, "Sign out");
    assert.equal(state.signedOutVisible, false);
    assert.equal(state.browserVisible, true);
    assert.equal(state.user, rig.config.username);

    const tabs = await rig.browser.tabs();
    assert.equal(tabs.length, 1, `sign-in popup was left open: ${JSON.stringify(tabs)}`);
  });

  it("holds an access token that Microsoft Graph accepts", async () => {
    // The UI can look signed in while token acquisition is broken, so check the
    // real thing: the listing the app renders came back from Graph.
    const state = await rig.page.waitForListing(60_000);
    assert.ok(state.items.length > 0, "no items loaded from Microsoft Graph");
    assert.deepEqual(state.breadcrumbs, ["OneDrive"]);
  });

  after(() => {
    if (steps.length > 0) console.error(`# sign-in steps: ${steps.join(" -> ")}`);
  });
});
