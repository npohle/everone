#!/usr/bin/env node
// Serve the SPA the way the e2e suite does, for poking around by hand.
//
//   npm run serve            # http://127.0.0.1:4173/everone/
//
// Microsoft sign-in will not work here: it only accepts the app's registered
// redirect URI, which the suite arranges by mapping that origin onto this
// server inside its own Chrome instance.

import { startDevServer } from "./lib/dev-server.js";
import { DEFAULTS } from "./lib/config.js";

const port = Number(process.argv[2] ?? process.env.PORT ?? 4173);
const basePath = process.env.E2E_APP_BASE_PATH ?? DEFAULTS.appBasePath;
const server = await startDevServer({ basePath, port });
console.log(`OneDrive Browser: ${server.url}`);

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => server.close().then(() => process.exit(0)));
}
