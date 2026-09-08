#!/usr/bin/env node
// Standalone, long-lived signed-in session — the JS/Playwright equivalent of
// tests/dev.sh. Run it on its own to get a browser you can poke at by hand
// via playwright-cli, and/or point `npm run test:e2e` at (global-setup.js
// auto-detects and reuses it instead of signing in again), all attached to
// the exact same page over CDP.
//
// Sessions are named (`--session=<name>` / E2E_SESSION, default "default"),
// mirroring playwright-cli's own `-s=<name>` convention — run several at
// once (e.g. one per feature you're poking at) instead of being limited to a
// single shared instance, and use the same name on both sides:
//
//   npm run e2e:dev -- --session=feature-x
//   playwright-cli -s=feature-x attach --cdp=http://127.0.0.1:<port>
//   E2E_SESSION=feature-x npm run test:e2e

import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { startCaddy } from "./lib/caddy.js";
import { signIn } from "./lib/sign-in.js";
import { loadEnv } from "./lib/env.js";
import { findFreePort } from "./lib/port.js";
import { writeState, clearState, readState, probeCdp, stateFilePath, DEFAULT_SESSION } from "./lib/state.js";

const CDP_PORT_CANDIDATES = [9222, 9223, 9224, 9225, 9226];

function sessionName() {
  const arg = process.argv.find((a) => a.startsWith("--session="));
  return arg ? arg.slice("--session=".length) : (process.env.E2E_SESSION ?? DEFAULT_SESSION);
}

function runId() {
  return `${new Date().toISOString().replace(/[:.]/g, "-")}-${process.pid}`;
}

async function main() {
  loadEnv();

  const session = sessionName();

  const existing = readState(session);
  if (existing && (await probeCdp(existing.cdpPort))) {
    console.error(
      `Session "${session}" is already running on CDP port ${existing.cdpPort} (${stateFilePath(session)}).\n` +
        `Attach to it instead, or stop it first: playwright-cli -s=${session} attach --cdp=http://127.0.0.1:${existing.cdpPort} then close.`,
    );
    process.exit(1);
  }

  const host = process.env.E2E_HOST ?? "npohle.github.io";
  const basePath = process.env.E2E_BASE_PATH ?? "everone";
  const headed = process.env.E2E_HEADED !== "0";

  const artefactsDir = path.join("tests", "artefacts", runId());
  fs.mkdirSync(artefactsDir, { recursive: true });

  const caddy = await startCaddy({ host, basePath });
  const cdpPort = await findFreePort(CDP_PORT_CANDIDATES);
  const browser = await chromium.launch({
    headless: !headed,
    args: [
      `--host-resolver-rules=MAP ${host} 127.0.0.1:${caddy.port}`,
      `--remote-debugging-port=${cdpPort}`,
    ],
    // Playwright's default SIGINT/SIGTERM handling calls process.exit() as
    // soon as the browser closes, racing ahead of our own `stop()` below
    // (which still needs to clear the state file). Handle signals ourselves.
    handleSIGINT: false,
    handleSIGTERM: false,
    handleSIGHUP: false,
  });

  try {
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    const page = await context.newPage();
    await page.goto(`https://${host}/${basePath}/`);
    try {
      await signIn(page, artefactsDir);
    } finally {
      // SPA runs entirely client-side once loaded — same reasoning as dev.sh.
      await caddy.stop();
    }
  } catch (err) {
    await browser.close();
    throw err;
  }

  writeState(session, { cdpPort, artefactsDir });

  const endpoint = `http://127.0.0.1:${cdpPort}`;
  console.log(`\nSigned in — session "${session}". Stays open until you press Ctrl+C.\n`);
  console.log(`  Explore by hand:      playwright-cli -s=${session} attach --cdp=${endpoint}`);
  console.log(`  Run the test suite:   E2E_SESSION=${session} npm run test:e2e\n`);

  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    console.log("\nClosing dev session…");
    await browser.close();
    clearState(session);
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  await new Promise(() => {}); // keep the process (and thus the browser) alive
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
