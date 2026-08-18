import { test } from "node:test";
import assert from "node:assert/strict";

import { classifyStep, STEP } from "../e2e/lib/login-steps.js";
import { parseSnapshot } from "../e2e/lib/snapshot.js";
import * as fx from "./fixtures/snapshots.js";

const classify = (snapshot, extra = {}) =>
  classifyStep({
    url: "https://login.live.com/oauth20_authorize.srf",
    nodes: parseSnapshot(snapshot),
    appOrigin: "https://npohle.github.io",
    username: "test.user@example.com",
    ...extra,
  });

test("recognises the username prompt", () => {
  const step = classify(fx.LOGIN_EMAIL);
  assert.equal(step.name, STEP.USERNAME);
  assert.equal(step.input, "@e7");
  assert.equal(step.submit, "@e5");
});

test("recognises the password prompt", () => {
  const step = classify(fx.LOGIN_PASSWORD);
  assert.equal(step.name, STEP.PASSWORD);
  assert.equal(step.input, "@e7");
  assert.equal(step.submit, "@e6");
});

test("recognises the authenticator-app code prompt", () => {
  const step = classify(fx.LOGIN_TOTP);
  assert.equal(step.name, STEP.TOTP);
  assert.equal(step.input, "@e8");
  assert.equal(step.submit, "@e5");
});

test("password prompt wins over the generic username matcher", () => {
  // Retyping the email into the password box would hang the whole flow.
  assert.notEqual(classify(fx.LOGIN_PASSWORD).name, STEP.USERNAME);
});

test("declines the stay-signed-in prompt so runs stay stateless", () => {
  const step = classify(fx.LOGIN_STAY_SIGNED_IN);
  assert.equal(step.name, STEP.STAY_SIGNED_IN);
  assert.equal(step.submit, "@e8"); // "No"
});

test("accepts the delegated-permission consent prompt", () => {
  const step = classify(fx.LOGIN_CONSENT);
  assert.equal(step.name, STEP.CONSENT);
  assert.equal(step.submit, "@e12"); // "Accept"
});

test("picks the known account out of an account picker", () => {
  const step = classify(fx.LOGIN_ACCOUNT_PICKER);
  assert.equal(step.name, STEP.ACCOUNT_PICKER);
  assert.equal(step.submit, "@e2");
});

test("surfaces Microsoft error pages as a terminal step", () => {
  const step = classify(fx.LOGIN_ERROR);
  assert.equal(step.name, STEP.ERROR);
  assert.match(step.message, /unable to complete/i);
});

test("surfaces OAuth error codes even without a matching heading", () => {
  const step = classify(`- heading "Account" [level=1, ref=e1]
- paragraph "invalid_request: the redirect_uri is not registered" [ref=e2]`);
  assert.equal(step.name, STEP.ERROR);
});

test("treats a URL back on the app origin as completion", () => {
  const step = classify(fx.APP_SIGNED_IN, {
    url: "https://npohle.github.io/everone/#code=abc",
  });
  assert.equal(step.name, STEP.COMPLETE);
});

test("reports UNKNOWN rather than guessing on an unrecognised page", () => {
  assert.equal(classify(fx.EMPTY).name, STEP.UNKNOWN);
});
