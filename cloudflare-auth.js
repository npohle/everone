// Cloudflare OAuth sign-in, fully independent of the Microsoft (MSAL) one in
// auth.js: its own client, its own token, its own sessionStorage key. The
// Microsoft token keeps authenticating OneDrive / Graph calls exclusively.
//
// The Cloudflare OAuth client only allows the implicit grant
// (response_type=token), so the flow is a full-page redirect:
//
//   app → dash.cloudflare.com/oauth2/auth → <redirectUri> (callback/index.html)
//       → <appUrl>#access_token=… → handleRedirect() stores the token.
//
// The helpers below take their browser dependencies (storage, location,
// crypto) as arguments so they can be unit-tested under Node.

import { config } from "./config.js";

export const TOKEN_KEY = "cloudflare.token";
export const STATE_KEY = "cloudflare.state";

const storage = () => window.sessionStorage;

export function randomState(cryptoImpl = globalThis.crypto) {
  const bytes = cryptoImpl.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function buildAuthorizeUrl(cf, state) {
  const url = new URL(cf.authorizeUrl);
  url.searchParams.set("response_type", "token");
  url.searchParams.set("client_id", cf.clientId);
  url.searchParams.set("redirect_uri", cf.redirectUri);
  url.searchParams.set("scope", cf.scopes.join(" "));
  url.searchParams.set("state", state);
  return url.toString();
}

// Parses an OAuth implicit-grant fragment ("#access_token=…&state=…").
// Returns null when the fragment isn't an OAuth response at all.
export function parseCallbackHash(hash) {
  const params = new URLSearchParams(String(hash || "").replace(/^#/, ""));
  if (params.has("access_token")) {
    return {
      accessToken: params.get("access_token"),
      tokenType: params.get("token_type") || "bearer",
      expiresIn: Number(params.get("expires_in")) || 0,
      scope: params.get("scope") || "",
      state: params.get("state") || "",
    };
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

// Consumes an OAuth response in `hash`, verifying `state` against the one
// stored by signIn(). Returns { token } on success, { error } on failure,
// or null when there's no OAuth response to handle.
export function consumeCallback(hash, store, now = Date.now()) {
  const result = parseCallbackHash(hash);
  if (!result) return null;
  const expected = store.getItem(STATE_KEY);
  store.removeItem(STATE_KEY);
  if (!expected || result.state !== expected) {
    return { error: "Cloudflare sign-in failed: state mismatch" };
  }
  if (result.error) {
    return { error: `Cloudflare sign-in failed: ${result.errorDescription || result.error}` };
  }
  const token = {
    accessToken: result.accessToken,
    tokenType: result.tokenType,
    scope: result.scope,
    expiresAt: result.expiresIn ? now + result.expiresIn * 1000 : 0,
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

// Call once on page load: picks up a token handed back by the callback page
// and strips the fragment from the address bar. Returns the consumeCallback()
// result (null when there was nothing to handle).
export function handleRedirect() {
  const outcome = consumeCallback(window.location.hash, storage());
  if (outcome) {
    history.replaceState(null, "", window.location.pathname + window.location.search);
  }
  return outcome;
}

export function isSignedIn() {
  return !!readToken(storage());
}

export function signIn() {
  const cf = config.cloudflare;
  const state = randomState();
  storage().setItem(STATE_KEY, state);
  window.location.assign(buildAuthorizeUrl(cf, state));
}

// Implicit-grant tokens can't be refreshed and Cloudflare's revoke endpoint
// isn't reachable cross-origin, so signing out just drops the local token.
export function signOut() {
  storage().removeItem(TOKEN_KEY);
}

export function getToken() {
  const token = readToken(storage());
  if (!token) throw new Error("Not signed in to Cloudflare");
  return token.accessToken;
}
