// TOTP codes for the test account, generated with oathtool.
//
// The account's second factor is an authenticator app, so the suite needs the
// same shared secret the app holds. It is passed in via TEST_USER_TOTP_SEED and
// never written to disk or into an assertion message.

import { execFileSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

export const TOTP_PERIOD_MS = 30_000;

const BASE32 = /^[A-Z2-7]+=*$/;

const normalise = (seed) => String(seed ?? "").replace(/\s+/g, "").toUpperCase();

export function assertValidSeed(seed) {
  const value = normalise(seed);
  if (!value) throw new Error("TOTP seed is empty — set TEST_USER_TOTP_SEED");
  if (!BASE32.test(value)) {
    throw new Error("TOTP seed is not valid base32 (expected characters A-Z and 2-7)");
  }
  return value;
}

/** Milliseconds the code generated at `nowMs` stays valid. */
export function millisRemainingInWindow(nowMs = Date.now(), periodMs = TOTP_PERIOD_MS) {
  const elapsed = nowMs % periodMs;
  return elapsed === 0 ? periodMs : periodMs - elapsed;
}

/**
 * @param {string} seed base32 shared secret
 * @param {{nowSeconds?: number, bin?: string}} [options]
 */
export function generateCode(seed, { nowSeconds, bin = "oathtool" } = {}) {
  const value = assertValidSeed(seed);
  const args = ["--totp", "--base32", value];
  if (nowSeconds !== undefined) args.push("--now", `@${nowSeconds}`);
  let out;
  try {
    out = execFileSync(bin, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (err) {
    if (err.code === "ENOENT") {
      throw new Error(`${bin} is not installed — the e2e suite needs oathtool to mint TOTP codes`);
    }
    throw new Error(`${bin} failed to generate a TOTP code (exit ${err.status})`);
  }
  const code = out.trim();
  if (!/^\d{6,8}$/.test(code)) throw new Error("oathtool did not return a numeric TOTP code");
  return code;
}

/**
 * A code with enough life left to survive typing and a round trip to Microsoft.
 * Waits out the tail of the current window rather than submitting a code that
 * expires mid-request — a classic source of flaky 2FA tests.
 */
export async function generateFreshCode(seed, { minRemainingMs = 8_000, bin = "oathtool" } = {}) {
  const remaining = millisRemainingInWindow();
  if (remaining < minRemainingMs) await sleep(remaining + 250);
  return generateCode(seed, { bin });
}
