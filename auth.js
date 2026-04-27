import { config } from "./config.js";

// MSAL is loaded as a global script tag in index.html (msal-browser UMD).
const Msal = () => window.msal;

let pca = null;
let initialized = null;

function buildPca() {
  if (pca) return pca;
  const redirectUri = window.location.origin + window.location.pathname;
  pca = new (Msal()).PublicClientApplication({
    auth: {
      clientId: config.clientId,
      authority: config.authority,
      redirectUri,
      postLogoutRedirectUri: redirectUri,
      navigateToLoginRequestUrl: false,
    },
    cache: {
      cacheLocation: "sessionStorage",
      storeAuthStateInCookie: false,
    },
  });
  return pca;
}

export async function init() {
  if (initialized) return initialized;
  initialized = (async () => {
    const app = buildPca();
    await app.initialize();
    // Surface any redirect-flow errors; success returns an auth result.
    await app.handleRedirectPromise();
    const accounts = app.getAllAccounts();
    if (accounts.length > 0) app.setActiveAccount(accounts[0]);
  })();
  return initialized;
}

export function getAccount() {
  if (!pca) return null;
  return pca.getActiveAccount() || pca.getAllAccounts()[0] || null;
}

export async function signIn() {
  const app = buildPca();
  // Try popup first (cleaner UX); fall back to redirect when popups blocked.
  try {
    const result = await app.loginPopup({ scopes: config.scopes, prompt: "select_account" });
    app.setActiveAccount(result.account);
    return result.account;
  } catch (err) {
    if (err && (err.errorCode === "popup_window_error" || err.errorCode === "empty_window_error")) {
      await app.loginRedirect({ scopes: config.scopes });
      return null;
    }
    throw err;
  }
}

export async function signOut() {
  const app = buildPca();
  const account = getAccount();
  await app.logoutPopup({ account, mainWindowRedirectUri: window.location.origin + window.location.pathname });
}

export async function getToken() {
  const app = buildPca();
  const account = getAccount();
  if (!account) throw new Error("Not signed in");
  try {
    const result = await app.acquireTokenSilent({ scopes: config.scopes, account });
    return result.accessToken;
  } catch (err) {
    if (err && err.name === "InteractionRequiredAuthError") {
      const result = await app.acquireTokenPopup({ scopes: config.scopes, account });
      return result.accessToken;
    }
    throw err;
  }
}
