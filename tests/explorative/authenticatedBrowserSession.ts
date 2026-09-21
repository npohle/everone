#!/usr/bin/env node
import { Command } from "commander";
import { spawn } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import pc from 'picocolors';
import { startCaddy, stopCaddy } from "../e2e/lib/caddy.ts";
import { hostResolverRule } from "../e2e/lib/browser.ts";

const ARTEFACTS_DIR = "tests/artefacts";

// playwright-cli's own daemon doesn't serialize commands issued back-to-back
// against the same session — `open` has to actually finish launching the
// browser before `state-load`/`run-code` can act on it, so these run one at
// a time instead of all being fired off at once.
function runPlaywrightCli(args: string[]): Promise<number> {
  return new Promise((resolve, reject) => {
    const proc = spawn("playwright-cli", args, { stdio: ["ignore", "pipe", "inherit"] });
    proc.on("close", (code) => resolve(code ?? 0));
    proc.on("error", reject);
  });
}

/** Matches the RUN_ID format package.json's npm scripts generate in bash: `$(date +%Y%m%d-%H%M%S)-$$`. */
function generateRunId(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const timestamp =
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `${timestamp}-${process.pid}`;
}

/** The RUN_ID of the most recently created run under tests/artefacts/. */
function latestRunId(): string {
  const entries = readdirSync(ARTEFACTS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      name: entry.name,
      birthtime: statSync(path.join(ARTEFACTS_DIR, entry.name)).birthtime,
    }))
    .sort((a, b) => b.birthtime.getTime() - a.birthtime.getTime());

  if (entries.length === 0) {
    throw new Error(`No runid given, and no runs found under ${ARTEFACTS_DIR}/`);
  }
  return entries[0].name;
}

const program = new Command();

program
  .name("authenticated-browser-session")
  .description("Manage an exploratory, pre-authenticated playwright-cli browser session");

program
  .command("open")
  .description("Sign in, then open a playwright-cli session pre-loaded with the resulting storage state")
  .option("--headed", "run the playwright-cli browser session headed")
  .action(async (options) => {
    const runid = generateRunId();

    const playwright = spawn(
      "npx",
      ["playwright", "test", "--project=auth"],
      {stdio: ["ignore", "pipe", "inherit"], env: { ...process.env, RUN_ID: runid }}
    );

    let stdout = "";

    playwright.stdout.on("data", (chunk) => {
      stdout += chunk;
    });

    await new Promise<void>((resolve) => {
      playwright.on("close", async (code) => {

        console.error(pc.gray(stdout.trim()));

        console.log(JSON.stringify({
          ok: true,
          data: {
            "RUN_ID": runid,
          },
        }));

        if (code !== 0) {
          console.error(`Process exited with code ${code}`);
          process.exit(code ?? 1);
        }

        // The auth run above already stopped its own Caddy instance (its
        // globalTeardown ran as part of that child process exiting) — this
        // session gets its own dedicated instance, independent of that one.
        const { port } = await startCaddy(`tests/artefacts/${runid}`);
        const playwrightCliConfigFile = `tests/artefacts/${runid}/playwright-cli.config.json`;
        writeFileSync(playwrightCliConfigFile, JSON.stringify({
          browser: {
            launchOptions: {
              args: [hostResolverRule(port)],
            },
          },
        }));

        await runPlaywrightCli(["-s", runid!, "close"]);
        await runPlaywrightCli([
          "-s", runid!, "open",
          `--config=${playwrightCliConfigFile}`,
          ...(options.headed ? ["--headed"] : []),
          "https://npohle.github.io/everone/",
        ]);
        await runPlaywrightCli(["-s", runid!, "state-load", `tests/artefacts/${runid}/localstorage.json`]);

        // sessionStorage isn't part of storageState (state-load above only covers
        // cookies + localStorage), so it's replayed separately via an init script
        // — same approach as fixtures.ts's `context` fixture.
        const sessionStorageFile = `tests/artefacts/${runid}/sessionstorage.json`;
        if (existsSync(sessionStorageFile)) {
          const sessionStorageItems = JSON.parse(readFileSync(sessionStorageFile, "utf8"));
          const initScript = `async page => {
            const items = ${JSON.stringify(sessionStorageItems)};
            await page.context().addInitScript((items) => {
              for (const { name, value } of items) {
                window.sessionStorage.setItem(name, value);
              }
            }, items);
          }`;
          await runPlaywrightCli(["-s", runid!, "run-code", initScript]);

          // addInitScript only applies to future navigations, but the page was
          // already loaded by `open` above — reload so it actually takes effect.
          await runPlaywrightCli(["-s", runid!, "reload"]);
        }

        resolve();
      });
    });
  });

program
  .command("close")
  .description("Close a playwright-cli session")
  .argument("[runid]", "session to close (defaults to the most recently created tests/artefacts run)")
  .action(async (runid) => {
    const targetRunId = runid ?? latestRunId();
    console.log(`Closing session "${targetRunId}"`);
    await runPlaywrightCli([`-s=${targetRunId}`, "close"]);
    stopCaddy(`tests/artefacts/${targetRunId}`);
  });

program.parseAsync();
