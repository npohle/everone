import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  buildAuthorizeUrl,
  parseCallbackQuery,
  completeSignIn,
  readToken,
  randomString,
  codeChallenge,
  fetchFirstAccount,
  formatAccount,
  TOKEN_KEY,
  STATE_KEY,
  VERIFIER_KEY,
} from "../../cloudflare-auth.js";
import { config } from "../../config.js";

function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    map,
  };
}

// A fetch stand-in recording its calls and answering with `status` / `body`.
function fakeFetch(status, body) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init });
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  };
  impl.calls = calls;
  return impl;
}

const signedInState = () => memoryStorage({ [STATE_KEY]: "s", [VERIFIER_KEY]: "v".repeat(43) });

test("config has a Cloudflare client separate from the Microsoft one", () => {
  assert.equal(config.cloudflare.clientId, "0b70dc1b060717a33f39ea09743b85df");
  assert.deepEqual(config.cloudflare.scopes, ["ai.read", "user-details.read", "account-settings.read", "memberships.read", "account-custom-asset.read"]);
  assert.equal(config.cloudflare.redirectUri, "https://rubisco.io/callback");
  assert.notEqual(config.cloudflare.clientId, config.clientId);
});

test("buildAuthorizeUrl requests an authorization code with PKCE and the configured scopes", () => {
  const url = new URL(buildAuthorizeUrl(config.cloudflare, "abc123", "challenge"));
  assert.equal(url.origin + url.pathname, config.cloudflare.authorizeUrl);
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("client_id"), "0b70dc1b060717a33f39ea09743b85df");
  assert.equal(url.searchParams.get("scope"), "ai.read user-details.read account-settings.read memberships.read account-custom-asset.read");
  assert.equal(url.searchParams.get("redirect_uri"), config.cloudflare.redirectUri);
  assert.equal(url.searchParams.get("state"), "abc123");
  assert.equal(url.searchParams.get("code_challenge"), "challenge");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
});

test("randomString returns distinct URL-safe strings; 32 bytes make a valid PKCE verifier", () => {
  const a = randomString();
  assert.match(a, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(a, randomString());
});

test("codeChallenge is the base64url SHA-256 of the verifier", async () => {
  // RFC 7636, appendix B.
  assert.equal(
    await codeChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
    "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
  );
  const v = randomString();
  assert.equal(await codeChallenge(v), createHash("sha256").update(v).digest("base64url"));
});

test("parseCallbackQuery reads code and error responses, ignores anything else", () => {
  assert.deepEqual(parseCallbackQuery("?code=c&state=s&scope=ai.read"), { code: "c", state: "s" });
  assert.deepEqual(parseCallbackQuery("?error=access_denied&error_description=nope&state=s"), {
    error: "access_denied", errorDescription: "nope", state: "s",
  });
  assert.equal(parseCallbackQuery(""), null);
  assert.equal(parseCallbackQuery("?foo=bar"), null);
});

test("completeSignIn redeems the code with the PKCE verifier and stores the token", async () => {
  const store = signedInState();
  const fetchImpl = fakeFetch(200, { access_token: "t", token_type: "bearer", expires_in: 60, scope: "ai.read" });
  const out = await completeSignIn("?code=c&state=s", store, config.cloudflare, fetchImpl, 1000);

  assert.deepEqual(out.token, { accessToken: "t", tokenType: "bearer", scope: "ai.read", expiresAt: 61_000 });
  assert.equal(store.getItem(STATE_KEY), null);
  assert.equal(store.getItem(VERIFIER_KEY), null);
  assert.deepEqual(readToken(store, 2000), out.token);

  assert.equal(fetchImpl.calls.length, 1);
  const { url, init } = fetchImpl.calls[0];
  assert.equal(url, config.cloudflare.tokenUrl);
  assert.equal(init.method, "POST");
  assert.deepEqual(Object.fromEntries(init.body), {
    grant_type: "authorization_code",
    code: "c",
    redirect_uri: config.cloudflare.redirectUri,
    client_id: config.cloudflare.clientId,
    code_verifier: "v".repeat(43),
  });
});

test("completeSignIn rejects a state mismatch and a missing state without calling the token endpoint", async () => {
  const fetchImpl = fakeFetch(200, { access_token: "t" });
  const store = signedInState();
  assert.match((await completeSignIn("?code=c&state=evil", store, config.cloudflare, fetchImpl)).error, /state mismatch/);
  assert.equal(store.getItem(TOKEN_KEY), null);
  assert.equal(store.getItem(VERIFIER_KEY), null);
  assert.match((await completeSignIn("?code=c&state=s", memoryStorage(), config.cloudflare, fetchImpl)).error, /state mismatch/);
  assert.equal(fetchImpl.calls.length, 0);
});

test("completeSignIn surfaces authorization and token endpoint errors", async () => {
  const fetchImpl = fakeFetch(200, { access_token: "t" });
  const store = signedInState();
  assert.match((await completeSignIn("?error=access_denied&state=s", store, config.cloudflare, fetchImpl)).error, /access_denied/);
  assert.equal(fetchImpl.calls.length, 0);

  const rejected = signedInState();
  const out = await completeSignIn("?code=c&state=s", rejected, config.cloudflare,
    fakeFetch(400, { error: "invalid_grant", error_description: "bad code" }));
  assert.match(out.error, /bad code/);
  assert.equal(rejected.getItem(TOKEN_KEY), null);

  const offline = signedInState();
  const failing = async () => { throw new TypeError("Failed to fetch"); };
  assert.match((await completeSignIn("?code=c&state=s", offline, config.cloudflare, failing)).error, /Failed to fetch/);
  assert.equal(offline.getItem(TOKEN_KEY), null);
});

test("completeSignIn returns null when there's no OAuth response", async () => {
  assert.equal(await completeSignIn("", memoryStorage()), null);
});

test("readToken drops expired and malformed tokens", () => {
  const expired = memoryStorage({ [TOKEN_KEY]: JSON.stringify({ accessToken: "t", expiresAt: 5 }) });
  assert.equal(readToken(expired, 10), null);
  assert.equal(expired.getItem(TOKEN_KEY), null);
  assert.equal(readToken(memoryStorage({ [TOKEN_KEY]: "{oops" })), null);
  assert.equal(readToken(memoryStorage()), null);
});

test("fetchFirstAccount lists the user's accounts with the OAuth token and returns the first", async () => {
  const fetchImpl = fakeFetch(200, {
    success: true,
    result: [
      { id: "023e105f4ecef8ad9ca31a8372d0c353", name: "Primary Account" },
      { id: "1111", name: "Second Account" },
    ],
  });
  const account = await fetchFirstAccount("t", config.cloudflare, fetchImpl);
  assert.deepEqual(account, { id: "023e105f4ecef8ad9ca31a8372d0c353", name: "Primary Account" });

  assert.equal(fetchImpl.calls.length, 1);
  const { url, init } = fetchImpl.calls[0];
  assert.equal(new URL(url).origin + new URL(url).pathname, `${config.cloudflare.apiBase}/accounts`);
  assert.equal(init.headers.Authorization, "Bearer t");
});

test("fetchFirstAccount returns null when the user has no accounts", async () => {
  assert.equal(await fetchFirstAccount("t", config.cloudflare, fakeFetch(200, { success: true, result: [] })), null);
});

test("fetchFirstAccount throws Cloudflare's error on a failed request", async () => {
  await assert.rejects(
    fetchFirstAccount("t", config.cloudflare,
      fakeFetch(403, { success: false, errors: [{ code: 10000, message: "Authentication error" }] })),
    /Authentication error/,
  );
  await assert.rejects(fetchFirstAccount("t", config.cloudflare, fakeFetch(500, {})), /HTTP 500/);
});

test("formatAccount shows the account's name and ID", () => {
  assert.equal(formatAccount({ id: "abc", name: "Acme" }), "Acme (abc)");
});
