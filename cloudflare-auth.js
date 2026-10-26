// Cloudflare OAuth sign-in, fully independent of the Microsoft (MSAL) one in
// auth.js: its own client, its own token, its own sessionStorage key. The
// Microsoft token keeps authenticating OneDrive / Graph calls exclusively.
//
// The Cloudflare OAuth client is a public client using the Authorization Code
// flow, so this runs it with PKCE as a full-page redirect:
//
//   app → dash.cloudflare.com/oauth2/auth → <redirectUri>?code=…&state=…
//       (callback/index.html: handleCallback() checks state, exchanges the
//       code at the token endpoint, stores the token) → <appUrl>
//
// The helpers below take their browser dependencies (storage, crypto, fetch)
// as arguments so they can be unit-tested under Node.

import { config } from "./config.js";

export const TOKEN_KEY = "cloudflare.token";
export const STATE_KEY = "cloudflare.state";
export const VERIFIER_KEY = "cloudflare.verifier";
// A sign-in error raised on the callback page, shown by the app on return.
export const ERROR_KEY = "cloudflare.error";

const storage = () => window.sessionStorage;

function base64url(bytes) {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// URL-safe random string; with the default 32 bytes it's a valid PKCE
// code_verifier (43 chars).
export function randomString(byteLength = 32, cryptoImpl = globalThis.crypto) {
  return base64url(cryptoImpl.getRandomValues(new Uint8Array(byteLength)));
}

// PKCE S256 code_challenge for `verifier`.
export async function codeChallenge(verifier, cryptoImpl = globalThis.crypto) {
  const digest = await cryptoImpl.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
}

export function buildAuthorizeUrl(cf, state, challenge) {
  const url = new URL(cf.authorizeUrl);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", cf.clientId);
  url.searchParams.set("redirect_uri", cf.redirectUri);
  url.searchParams.set("scope", cf.scopes.join(" "));
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

// Parses an authorization response query ("?code=…&state=…").
// Returns null when the query isn't an OAuth response at all.
export function parseCallbackQuery(search) {
  const params = new URLSearchParams(String(search || ""));
  if (params.has("code")) {
    return { code: params.get("code"), state: params.get("state") || "" };
  }
  if (params.has("error")) {
    return {
      error: params.get("error"),
      errorDescription: params.get("error_description") || "",
      state: params.get("state") || "",
    };
  }
  return null;
}

// Consumes an authorization response in `search`: verifies `state` against
// the one stored by signIn(), then redeems the code (with the stored PKCE
// verifier) at the token endpoint and stores the token. Returns { token } on
// success, { error } on failure, or null when there's no OAuth response.
export async function completeSignIn(search, store, cf = config.cloudflare, fetchImpl = globalThis.fetch, now = Date.now()) {
  const result = parseCallbackQuery(search);
  if (!result) return null;
  const expected = store.getItem(STATE_KEY);
  const verifier = store.getItem(VERIFIER_KEY);
  store.removeItem(STATE_KEY);
  store.removeItem(VERIFIER_KEY);
  if (!expected || result.state !== expected) {
    return { error: "Cloudflare sign-in failed: state mismatch" };
  }
  if (result.error) {
    return { error: `Cloudflare sign-in failed: ${result.errorDescription || result.error}` };
  }

  let body;
  try {
    const res = await fetchImpl(cf.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: result.code,
        redirect_uri: cf.redirectUri,
        client_id: cf.clientId,
        code_verifier: verifier || "",
      }),
    });
    body = await res.json().catch(() => ({}));
    if (!res.ok || !body.access_token) {
      const reason = body.error_description || body.error || `token request failed (HTTP ${res.status})`;
      return { error: `Cloudflare sign-in failed: ${reason}` };
    }
  } catch (err) {
    return { error: `Cloudflare sign-in failed: ${err.message || err}` };
  }

  const expiresIn = Number(body.expires_in) || 0;
  const token = {
    accessToken: body.access_token,
    tokenType: body.token_type || "bearer",
    scope: body.scope || "",
    expiresAt: expiresIn ? now + expiresIn * 1000 : 0,
  };
  store.setItem(TOKEN_KEY, JSON.stringify(token));
  return { token };
}

// The stored token, or null when absent, unreadable or expired.
export function readToken(store, now = Date.now()) {
  let token;
  try {
    token = JSON.parse(store.getItem(TOKEN_KEY) || "null");
  } catch {
    token = null;
  }
  if (!token || !token.accessToken) return null;
  if (token.expiresAt && token.expiresAt <= now) {
    store.removeItem(TOKEN_KEY);
    return null;
  }
  return token;
}

// Called by callback/index.html: finishes the sign-in, then returns to the
// app at the fixed, configured appUrl (never a URL taken from the request).
// A failure is left in sessionStorage for the app to show.
export async function handleCallback() {
  const outcome = await completeSignIn(window.location.search, storage());
  if (outcome && outcome.error) storage().setItem(ERROR_KEY, outcome.error);
  window.location.replace(config.cloudflare.appUrl);
}

// The sign-in error left by the callback page, if any; cleared once read.
export function takeError() {
  const error = storage().getItem(ERROR_KEY);
  storage().removeItem(ERROR_KEY);
  return error;
}

export function isSignedIn() {
  return !!readToken(storage());
}

export async function signIn() {
  const cf = config.cloudflare;
  const state = randomString(16);
  const verifier = randomString();
  storage().setItem(STATE_KEY, state);
  storage().setItem(VERIFIER_KEY, verifier);
  window.location.assign(buildAuthorizeUrl(cf, state, await codeChallenge(verifier)));
}

// The client isn't granted refresh tokens and Cloudflare's revoke endpoint
// isn't reachable cross-origin, so signing out just drops the local token.
export function signOut() {
  storage().removeItem(TOKEN_KEY);
}

export function getToken() {
  const token = readToken(storage());
  if (!token) throw new Error("Not signed in to Cloudflare");
  return token.accessToken;
}
