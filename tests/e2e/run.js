#!/usr/bin/env node
// Entry point for the end-to-end suite.
//
//   node tests/e2e/run.js                 run every spec
//   node tests/e2e/run.js sign-in         run specs whose filename matches
//
// Starts one rig (dev server + Chrome + agent-browser session), hands its
// coordinates to `node --test` through the environment, and tears it down again
// afterwards - so a run leaves no stray browser or server behind.

import { spawn } from "node:child_process";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

import { RIG_ENV_VAR, startRig } from "./lib/harness.js";
import { loadConfig, missingRequired } from "./lib/config.js";

const SPEC_DIR = fileURLToPath(new URL("./specs/", import.meta.url));

const log = (msg) => console.error(`# ${msg}`);

function specsMatching(filters) {
  const all = readdirSync(SPEC_DIR)
    .filter((f) => f.endsWith(".e2e.js"))
    .sort();
  if (filters.length === 0) return all;
  return all.filter((f) => filters.some((needle) => f.includes(needle)));
}

async function main() {
  const filters = process.argv.slice(2).filter((a) => !a.startsWith("-"));

  const missing = missingRequired(process.env);
  if (missing.length > 0) {
    console.error(`\nCannot run the e2e suite: ${missing.join(", ")} not set.\n`);
    console.error("  export TEST_USER_PASSWORD=...        # password of the test account");
    console.error("  export TEST_USER_TOTP_SEED=...       # base32 authenticator secret\n");
    process.exit(2);
  }

  const config = loadConfig();
  const specs = specsMatching(filters);
  if (specs.length === 0) {
    console.error(`No specs matched ${filters.join(", ")}`);
    process.exit(2);
  }

  log(`app under test: ${config.appUrl} (served from the working tree)`);
  const rig = await startRig({ config, log });

  let exitCode = 1;
  try {
    exitCode = await new Promise((resolve, reject) => {
      const child = spawn(
        process.execPath,
        ["--test", "--test-concurrency=1", ...specs.map((s) => join(SPEC_DIR, s))],
        {
          stdio: "inherit",
          env: { ...process.env, [RIG_ENV_VAR]: JSON.stringify(rig.serialise()) },
        }
      );
      child.on("error", reject);
      child.on("exit", (code) => resolve(code ?? 1));
    });
  } finally {
    log("tearing down");
    await rig.close();
  }
  process.exit(exitCode);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
