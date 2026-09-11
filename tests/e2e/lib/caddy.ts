// Shared by tests/e2e/global-setup.ts / global-teardown.ts (the e2e suite's
// own sign-in run) and tests/explorative/authenticatedBrowserSession.ts (a
// separate, independent Caddy instance dedicated to an exploratory session).
//
// auth.js derives the OAuth redirect URI from window.location, and the Azure
// app registration only accepts the deployed origin
// (https://npohle.github.io/everone/) — a plain localhost dev server gets
// rejected by Microsoft with an invalid_request / bad redirect_uri error.
// So instead, Caddy serves the repo root bound to that real hostname, and
// the browser is launched with a --host-resolver-rules mapping pointing the
// hostname at 127.0.0.1. `handle_path` strips the /<basePath>/ prefix before
// serving, so the checkout doesn't need to live in a directory literally
// named to match.

import { spawn, execFileSync, type ChildProcessByStdio } from "node:child_process";
import type { Writable } from "node:stream";
import https from "node:https";
import net from "node:net";
import path from "node:path";
import fs from "node:fs";

const CANDIDATE_PORTS = [1443, 2443, 3443, 4443, 5443, 6443, 7443, 8443, 9443];

function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    socket.once("connect", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", () => resolve(true));
    socket.setTimeout(200, () => {
      socket.destroy();
      resolve(true);
    });
  });
}

async function findFreePort(candidates: number[]): Promise<number> {
  for (const port of candidates) {
    if (await isPortFree(port)) return port;
  }
  throw new Error(`No free port found in list: ${candidates.join(", ")}`);
}

function repoRoot(): string {
  return execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
}

function probeCaddy(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const req = https.get(
      { host: "127.0.0.1", port, path: "/", rejectUnauthorized: false, timeout: 500 },
      (res) => {
        res.resume();
        resolve(true);
      },
    );
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function waitForCaddy(port: number, timeoutMs = 5000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await probeCaddy(port)) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

function stateFilePath(artefactsDir: string): string {
  return path.join(artefactsDir, ".caddy-server-state.json");
}

export type CaddyState = { pid: number; port: number };

/**
 * Starts Caddy detached (survives the launching process exiting), serving
 * the repo root under /<basePath>/*, bound to `host`. Persists { pid, port }
 * to <artefactsDir>/.caddy-server-state.json so a later, separate process
 * can find and stop it via stopCaddy().
 */
export async function startCaddy(
  artefactsDir: string,
  host = "npohle.github.io",
  basePath = "everone",
): Promise<CaddyState> {
  const port = await findFreePort(CANDIDATE_PORTS);
  const root = repoRoot();
  const caddyConfig = [
    `https://127.0.0.1:${port}, https://${host}:${port} {`,
    `  tls internal`,
    `  handle_path /${basePath}/* {`,
    `    root * ${root}/`,
    `    file_server`,
    `  }`,
    `}`,
  ].join("\n");

  const proc: ChildProcessByStdio<Writable, null, null> = spawn(
    "caddy",
    ["run", "--adapter", "caddyfile", "--config", "-"],
    { stdio: ["pipe", "ignore", "ignore"], detached: true },
  );
  proc.stdin.write(caddyConfig);
  proc.stdin.end();

  const ready = await waitForCaddy(port);
  if (!ready) {
    proc.kill();
    throw new Error(`Caddy failed to start on port ${port}`);
  }

  proc.unref();

  const state: CaddyState = { pid: proc.pid!, port };
  fs.mkdirSync(artefactsDir, { recursive: true });
  fs.writeFileSync(stateFilePath(artefactsDir), JSON.stringify(state));
  return state;
}

/** Stops the Caddy instance started by startCaddy() for this artefactsDir, if any. */
export function stopCaddy(artefactsDir: string): void {
  const file = stateFilePath(artefactsDir);
  if (!fs.existsSync(file)) return;
  const state: CaddyState = JSON.parse(fs.readFileSync(file, "utf8"));
  console.log(`Stopping Caddy file server (pid ${state.pid})`);
  try {
    process.kill(state.pid);
  } catch {
    // already gone
  }
  fs.rmSync(file, { force: true });
}
