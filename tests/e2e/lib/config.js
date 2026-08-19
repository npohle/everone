// Test-suite configuration, resolved from the environment.
//
// Defaults target the deployed app's registered origin. That matters: the Azure
// app registration only accepts its production redirect URI, so the suite serves
// the local working copy *as* that origin (see chrome.js / dev-server.js) rather
// than on a localhost port the identity provider would reject.

import { randomBytes } from "node:crypto";

export const REQUIRED_ENV = ["TEST_USER_PASSWORD", "TEST_USER_TOTP_SEED"];

export const DEFAULTS = {
  username: "nik.o.laus.pohle@gmail.com",
  appOrigin: "https://npohle.github.io",
  appBasePath: "/everone/",
  timeoutMs: 30_000,
  sessionPrefix: "onedrive-e2e",
};

/**
 * agent-browser keys a long-lived daemon by session name. Reusing one name
 * across runs means a run can silently attach to the previous run's browser
 * (and its dead dev-server port), so every rig gets its own name.
 */
const uniqueSession = () =>
  `${DEFAULTS.sessionPrefix}-${process.pid}-${randomBytes(2).toString("hex")}`;

const str = (env, key, fallback) => {
  const value = env[key];
  return value === undefined || value.trim() === "" ? fallback : value.trim();
};

const bool = (env, key, fallback = false) => {
  const value = str(env, key, null);
  if (value === null) return fallback;
  return !/^(0|false|no|off)$/i.test(value);
};

const num = (env, key, fallback) => {
  const value = str(env, key, null);
  if (value === null) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${key} must be a number, got ${JSON.stringify(value)}`);
  }
  return parsed;
};

/** Names of required environment variables that are absent or blank. */
export function missingRequired(env = process.env) {
  return REQUIRED_ENV.filter((key) => str(env, key, null) === null);
}

export function loadConfig(env = process.env) {
  const missing = missingRequired(env);
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variable(s): ${missing.join(", ")}.\n` +
        "The end-to-end suite signs in as a real Microsoft account, so it needs\n" +
        "TEST_USER_PASSWORD and TEST_USER_TOTP_SEED (the account's base32 TOTP secret)."
    );
  }

  const appOrigin = str(env, "E2E_APP_ORIGIN", DEFAULTS.appOrigin).replace(/\/+$/, "");
  const origin = new URL(appOrigin);
  const rawBasePath = str(env, "E2E_APP_BASE_PATH", DEFAULTS.appBasePath);
  const appBasePath = `/${rawBasePath.replace(/^\/+|\/+$/g, "")}/`.replace(/^\/\/$/, "/");

  return {
    username: str(env, "TEST_USER", DEFAULTS.username),
    password: env.TEST_USER_PASSWORD.trim(),
    totpSeed: env.TEST_USER_TOTP_SEED.trim(),

    appOrigin,
    appBasePath,
    appUrl: `${appOrigin}${appBasePath}`,
    appHost: origin.hostname,
    appPort: origin.port ? Number(origin.port) : null,
    tls: origin.protocol === "https:",

    headed: bool(env, "E2E_HEADED"),
    keepBrowserOpen: bool(env, "E2E_KEEP_OPEN"),
    timeoutMs: num(env, "E2E_TIMEOUT_MS", DEFAULTS.timeoutMs),
    session: str(env, "E2E_SESSION", uniqueSession()),
    chromePath: str(env, "E2E_CHROME_PATH", null),
    agentBrowserBin: str(env, "E2E_AGENT_BROWSER_BIN", "agent-browser"),
    verbose: bool(env, "E2E_VERBOSE"),

    /** Secret-free view of the config, safe to log. */
    describe() {
      const { password, totpSeed, describe, ...rest } = this;
      return rest;
    },
  };
}
