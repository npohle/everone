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
  clientId: "REPLACE_WITH_YOUR_CLIENT_ID",
  authority: "https://login.microsoftonline.com/common",
  scopes: ["User.Read", "Files.Read", "Files.Read.All"],
  graphBase: "https://graph.microsoft.com/v1.0",
  pageSize: 100,
};

export const isConfigured = () =>
  !!config.clientId && config.clientId !== "REPLACE_WITH_YOUR_CLIENT_ID";
