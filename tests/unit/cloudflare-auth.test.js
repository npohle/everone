import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildAuthorizeUrl,
  parseCallbackHash,
  consumeCallback,
  readToken,
  randomState,
  TOKEN_KEY,
  STATE_KEY,
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

test("config has a Cloudflare client separate from the Microsoft one", () => {
  assert.equal(config.cloudflare.clientId, "0b70dc1b060717a33f39ea09743b85df");
  assert.deepEqual(config.cloudflare.scopes, ["ai.read"]);
  assert.notEqual(config.cloudflare.clientId, config.clientId);
});

test("buildAuthorizeUrl requests an implicit-grant token with the configured scope", () => {
  const url = new URL(buildAuthorizeUrl(config.cloudflare, "abc123"));
  assert.equal(url.origin + url.pathname, config.cloudflare.authorizeUrl);
  assert.equal(url.searchParams.get("response_type"), "token");
  assert.equal(url.searchParams.get("client_id"), "0b70dc1b060717a33f39ea09743b85df");
  assert.equal(url.searchParams.get("scope"), "ai.read");
  assert.equal(url.searchParams.get("redirect_uri"), config.cloudflare.redirectUri);
  assert.equal(url.searchParams.get("state"), "abc123");
});

test("randomState returns distinct hex strings", () => {
  const a = randomState();
  assert.match(a, /^[0-9a-f]{32}$/);
  assert.notEqual(a, randomState());
});

test("parseCallbackHash reads token and error responses, ignores anything else", () => {
  assert.deepEqual(parseCallbackHash("#access_token=t&token_type=bearer&expires_in=60&scope=ai.read&state=s"), {
    accessToken: "t", tokenType: "bearer", expiresIn: 60, scope: "ai.read", state: "s",
  });
  assert.deepEqual(parseCallbackHash("#error=access_denied&error_description=nope&state=s"), {
    error: "access_denied", errorDescription: "nope", state: "s",
  });
  assert.equal(parseCallbackHash(""), null);
  assert.equal(parseCallbackHash("#section-2"), null);
});

test("consumeCallback stores the token when state matches", () => {
  const store = memoryStorage({ [STATE_KEY]: "s" });
  const out = consumeCallback("#access_token=t&expires_in=60&state=s", store, 1000);
  assert.deepEqual(out.token, { accessToken: "t", tokenType: "bearer", scope: "", expiresAt: 61_000 });
  assert.equal(store.getItem(STATE_KEY), null);
  assert.deepEqual(readToken(store, 2000), out.token);
});

test("consumeCallback rejects a state mismatch and a missing state", () => {
  const store = memoryStorage({ [STATE_KEY]: "s" });
  assert.match(consumeCallback("#access_token=t&state=evil", store).error, /state mismatch/);
  assert.equal(store.getItem(TOKEN_KEY), null);
  assert.match(consumeCallback("#access_token=t&state=s", memoryStorage()).error, /state mismatch/);
});

test("consumeCallback surfaces provider errors", () => {
  const store = memoryStorage({ [STATE_KEY]: "s" });
  assert.match(consumeCallback("#error=access_denied&state=s", store).error, /access_denied/);
  assert.equal(store.getItem(TOKEN_KEY), null);
});

test("consumeCallback returns null when there's no OAuth response", () => {
  assert.equal(consumeCallback("", memoryStorage()), null);
});

test("readToken drops expired and malformed tokens", () => {
  const expired = memoryStorage({ [TOKEN_KEY]: JSON.stringify({ accessToken: "t", expiresAt: 5 }) });
  assert.equal(readToken(expired, 10), null);
  assert.equal(expired.getItem(TOKEN_KEY), null);
  assert.equal(readToken(memoryStorage({ [TOKEN_KEY]: "{oops" })), null);
  assert.equal(readToken(memoryStorage()), null);
});
