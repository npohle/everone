// The app loads from the working tree and renders its signed-out shell.

import { before, describe, it } from "node:test";
import assert from "node:assert/strict";

import { useHarness } from "../lib/harness.js";

describe("app shell", { concurrency: 1 }, () => {
  let rig;

  before(async () => {
    rig = await useHarness();
    await rig.page.open();
  });

  it("serves the working copy on the app's registered origin", async () => {
    // Sign-in only works against the origin registered with Azure, so the suite
    // maps that origin onto the local dev server. Confirm the browser really is
    // on that origin, and that the bytes behind it came from the dev server and
    // not from the deployed site.
    assert.equal(await rig.browser.url(), rig.config.appUrl);

    const served = await rig.browser.evalJson(`(() => {
      const xhr = new XMLHttpRequest();
      xhr.open("GET", "./__e2e/health", false);
      xhr.send();
      return xhr.responseText;
    })()`);
    assert.equal(served.server, "onedrive-e2e-dev-server");
  });

  it("renders the signed-out landing page", async () => {
    const state = await rig.page.state();
    assert.equal(state.title, "OneDrive Browser");
    assert.equal(state.signedOutVisible, true);
    assert.equal(state.browserVisible, false);
    assert.equal(state.authButton, "Sign in");
    assert.equal(state.user, "");
  });

  it("is configured with an Azure client id", async () => {
    const state = await rig.page.state();
    assert.equal(
      state.configHintVisible,
      false,
      "the first-run setup hint means config.js has no clientId"
    );
  });

  it("loads MSAL and the app's own modules", async () => {
    const loaded = await rig.browser.evalJson(`(() => JSON.stringify({
      msal: typeof window.msal,
      moduleScripts: Array.from(document.scripts).filter((s) => s.type === "module").length,
    }))()`);
    assert.equal(loaded.msal, "object", "MSAL did not load");
    assert.ok(loaded.moduleScripts >= 1);
  });

  it("offers a sign-in affordance", async () => {
    const nodes = await rig.browser.snapshot();
    const cta = nodes.find((n) => n.role === "button" && /sign in with microsoft/i.test(n.name));
    assert.ok(cta, `no sign-in button in snapshot: ${nodes.map((n) => n.name).join(", ")}`);
  });
});
