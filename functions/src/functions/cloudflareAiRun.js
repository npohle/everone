import { app } from "@azure/functions";
import { handleCloudflareAiRun } from "../cloudflare-ai-run.js";

// POST /cloudflare/ai/run (host.json clears the default "api" route prefix).
app.http("cloudflareAiRun", {
  methods: ["POST"],
  route: "cloudflare/ai/run",
  // Callers bring their own Cloudflare API token; a function key couldn't be
  // kept secret in the SPA anyway.
  authLevel: "anonymous",
  handler: (request, context) => handleCloudflareAiRun(request, globalThis.fetch, context),
});
