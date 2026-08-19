import { test } from "node:test";
import assert from "node:assert/strict";

import { loadConfig, missingRequired, REQUIRED_ENV } from "../e2e/lib/config.js";

const baseEnv = {
  TEST_USER_PASSWORD: "s3cret",
  TEST_USER_TOTP_SEED: "ABCDEFGHIJKLMNOP",
};

test("declares the credentials the suite needs", () => {
  assert.deepEqual(REQUIRED_ENV, ["TEST_USER_PASSWORD", "TEST_USER_TOTP_SEED"]);
});

test("defaults to the test account and the registered app origin", () => {
  const cfg = loadConfig(baseEnv);
  assert.equal(cfg.username, "nik.o.laus.pohle@gmail.com");
  assert.equal(cfg.appOrigin, "https://npohle.github.io");
  assert.equal(cfg.appBasePath, "/everone/");
  assert.equal(cfg.appUrl, "https://npohle.github.io/everone/");
  assert.equal(cfg.appHost, "npohle.github.io");
  assert.equal(cfg.tls, true, "the registered origin is https, so the dev server must be too");
});

test("serves plain http when the app origin is http", () => {
  const cfg = loadConfig({ ...baseEnv, E2E_APP_ORIGIN: "http://localhost:4173" });
  assert.equal(cfg.tls, false);
  assert.equal(cfg.appHost, "localhost");
  assert.equal(cfg.appPort, 4173);
});

test("normalises the base path however it is written", () => {
  for (const value of ["everone", "/everone", "everone/", "/everone/"]) {
    assert.equal(loadConfig({ ...baseEnv, E2E_APP_BASE_PATH: value }).appBasePath, "/everone/");
  }
  assert.equal(loadConfig({ ...baseEnv, E2E_APP_BASE_PATH: "/" }).appBasePath, "/");
});

test("carries the credentials through", () => {
  const cfg = loadConfig({ ...baseEnv, TEST_USER: "someone@example.com" });
  assert.equal(cfg.username, "someone@example.com");
  assert.equal(cfg.password, "s3cret");
  assert.equal(cfg.totpSeed, "ABCDEFGHIJKLMNOP");
});

test("throws a named error listing every missing credential", () => {
  assert.deepEqual(missingRequired({}), ["TEST_USER_PASSWORD", "TEST_USER_TOTP_SEED"]);
  assert.deepEqual(missingRequired({ TEST_USER_PASSWORD: "x" }), ["TEST_USER_TOTP_SEED"]);
  assert.deepEqual(missingRequired(baseEnv), []);
  assert.throws(() => loadConfig({}), /TEST_USER_PASSWORD.*TEST_USER_TOTP_SEED/s);
});

test("treats blank strings as missing", () => {
  assert.deepEqual(missingRequired({ ...baseEnv, TEST_USER_PASSWORD: "   " }), [
    "TEST_USER_PASSWORD",
  ]);
});

test("parses boolean and numeric knobs", () => {
  assert.equal(loadConfig(baseEnv).headed, false);
  assert.equal(loadConfig({ ...baseEnv, E2E_HEADED: "1" }).headed, true);
  assert.equal(loadConfig({ ...baseEnv, E2E_HEADED: "true" }).headed, true);
  assert.equal(loadConfig({ ...baseEnv, E2E_HEADED: "false" }).headed, false);
  assert.equal(loadConfig({ ...baseEnv, E2E_HEADED: "0" }).headed, false);
  assert.equal(loadConfig({ ...baseEnv, E2E_TIMEOUT_MS: "9000" }).timeoutMs, 9000);
  assert.throws(() => loadConfig({ ...baseEnv, E2E_TIMEOUT_MS: "soon" }), /must be a number/);
});

test("gives every run its own agent-browser session", () => {
  // A shared session name lets one run silently attach to a previous run's
  // browser, which then points at a dev-server port that no longer exists.
  const a = loadConfig(baseEnv).session;
  const b = loadConfig(baseEnv).session;
  assert.match(a, /^onedrive-e2e-/);
  assert.notEqual(a, b);
  assert.equal(loadConfig({ ...baseEnv, E2E_SESSION: "fixed" }).session, "fixed");
});

test("never exposes secrets in the describable form of the config", () => {
  const described = JSON.stringify(loadConfig(baseEnv).describe());
  assert.doesNotMatch(described, /s3cret/);
  assert.doesNotMatch(described, /ABCDEFGHIJKLMNOP/);
  assert.match(described, /nik\.o\.laus\.pohle@gmail\.com/);
});
