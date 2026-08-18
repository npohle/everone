import { test } from "node:test";
import assert from "node:assert/strict";

import {
  assertValidSeed,
  generateCode,
  millisRemainingInWindow,
  TOTP_PERIOD_MS,
} from "../e2e/lib/totp.js";

test("accepts a base32 seed regardless of padding, case or spacing", () => {
  assert.doesNotThrow(() => assertValidSeed("ABCDEFGHIJKLMNOP"));
  assert.doesNotThrow(() => assertValidSeed("abcdefghijklmnop"));
  assert.doesNotThrow(() => assertValidSeed("mfrg gzdf mztw q2lk"));
  assert.doesNotThrow(() => assertValidSeed("MFRGGZDFMZTWQ2LK==="));
});

test("rejects seeds that are not base32", () => {
  assert.throws(() => assertValidSeed(""), /seed/i);
  assert.throws(() => assertValidSeed("not a seed!"), /base32/i);
  assert.throws(() => assertValidSeed("ABC189"), /base32/i); // 1, 8, 9 are not base32
});

test("computes the remaining lifetime of the current 30s window", () => {
  assert.equal(TOTP_PERIOD_MS, 30_000);
  assert.equal(millisRemainingInWindow(0), 30_000);
  assert.equal(millisRemainingInWindow(1_000), 29_000);
  assert.equal(millisRemainingInWindow(29_500), 500);
  assert.equal(millisRemainingInWindow(30_000), 30_000);
});

test("generates a six digit code with oathtool", () => {
  assert.match(generateCode("MFRGGZDFMZTWQ2LK"), /^\d{6}$/);
});

test("is deterministic for a fixed timestamp and varies over time", () => {
  const at59 = generateCode("MFRGGZDFMZTWQ2LK", { nowSeconds: 59 });
  assert.equal(at59, generateCode("MFRGGZDFMZTWQ2LK", { nowSeconds: 59 }));
  assert.notEqual(at59, generateCode("MFRGGZDFMZTWQ2LK", { nowSeconds: 1_111_111_109 }));
});

test("different seeds produce different codes at the same instant", () => {
  assert.notEqual(
    generateCode("MFRGGZDFMZTWQ2LK", { nowSeconds: 59 }),
    generateCode("MFRGGZDFMZTWQ2LM", { nowSeconds: 59 })
  );
});

test("surfaces a helpful error when the seed is rejected", () => {
  assert.throws(() => generateCode("!!!"), /base32/i);
});

test("reports a missing oathtool binary clearly", () => {
  assert.throws(() => generateCode("MFRGGZDFMZTWQ2LK", { bin: "oathtool-does-not-exist" }), /not installed/);
});
