import { app } from "@azure/functions";
import { handleCloudflareAccounts } from "../cloudflare-accounts.js";

// POST /cloudflare/accounts (host.json clears the default "api" route prefix).
app.http("cloudflareAccounts", {
  methods: ["POST"],
  route: "cloudflare/accounts",
  // Callers bring their own Cloudflare API token; a function key couldn't be
  // kept secret in the SPA anyway.
  authLevel: "anonymous",
  handler: (request, context) => handleCloudflareAccounts(request, globalThis.fetch, context),
});
