// OneDrive Browser configuration.
//
// SETUP — register an Azure AD application (free, no subscription needed):
//   1. Go to https://portal.azure.com → "App registrations" → "New registration".
//   2. Supported account types: choose "Accounts in any organizational directory
//      and personal Microsoft accounts" for the broadest reach (multi-tenant + MSA).
//   3. Redirect URI: platform "Single-page application (SPA)", value = the URL
//      where you host this app, e.g. https://example.com/onedrive/ — must match
//      the page URL exactly, including trailing slash.
//   4. After creation, copy the "Application (client) ID" into clientId below.
//   5. Under "API permissions" the default delegated `User.Read` is enough; the
//      app also requests `Files.Read` and `Files.Read.All` which users consent to
//      on first sign-in. No admin consent is required for personal accounts.
//   6. Host the contents of this directory as static files (any web server, GitHub
//      Pages, Azure Static Web Apps, S3 + CloudFront, Netlify, etc.).
//
// The `authority` value below works for both work/school and personal accounts.

export const config = {
  clientId: "95e0df7d-45cf-4b50-a726-d9a57993db01",
  authority: "https://login.microsoftonline.com/consumers",
  scopes: ["User.Read", "Files.ReadWrite.All"],
  graphBase: "https://graph.microsoft.com/v1.0",
  pageSize: 100,

  // Cloudflare OAuth client, used by cloudflare-auth.js. Independent of the
  // Microsoft sign-in above, which keeps authenticating OneDrive exclusively.
  //
  // The client only allows the implicit grant (response_type=token), and
  // redirectUri must match the client's registered redirect URL exactly.
  // NOTE: the registration currently lists https://rubsico.io/callback
  // ("rubsico", not "rubisco"), so that's what is requested here. Once the
  // registration is corrected, change this to https://rubisco.io/callback.
  // callback/index.html, served at redirectUri, forwards the token to appUrl.
  cloudflare: {
    clientId: "0b70dc1b060717a33f39ea09743b85df",
    authorizeUrl: "https://dash.cloudflare.com/oauth2/auth",
    scopes: ["ai.read"],
    redirectUri: "https://rubsico.io/callback",
    appUrl: "https://rubisco.io/",
  },
};

export const isConfigured = () =>
  !!config.clientId && config.clientId !== "REPLACE_WITH_YOUR_CLIENT_ID";
