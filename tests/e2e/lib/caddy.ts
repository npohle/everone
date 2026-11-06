// Shared by tests/e2e/global-setup.ts / global-teardown.ts (the e2e suite's
// own sign-in run) and tests/explorative/authenticatedBrowserSession.ts (a
// separate, independent Caddy instance dedicated to an exploratory session).
//
// auth.js derives the OAuth redirect URI from window.location, and the Azure
// app registration only accepts the deployed origin
// (https://rubisco.io/) — a plain localhost dev server gets
// rejected by Microsoft with an invalid_request / bad redirect_uri error.
// So instead, Caddy serves the repo root bound to that real hostname, and
// the browser is launched with a --host-resolver-rules mapping pointing the
// hostname at 127.0.0.1. The repo root is served at / — the same path the
// app is deployed at in production — so the redirect URI matches exactly.
//
// Each instance gets its own admin API on a private unix socket, and
// stopCaddy() shuts it down through that (POST /stop) rather than by
// signalling its pid: in sandboxed environments signalling the detached
// Caddy fails with EACCES/EPERM, which used to leave every run's instance
// running and holding its port. A per-instance socket also keeps concurrent
// instances from fighting over Caddy's default shared admin port (2019).

import { spawn, execFileSync, type ChildProcessByStdio } from "node:child_process";
import type { Writable } from "node:stream";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import crypto from "node:crypto";

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

async function waitForPortFree(port: number, timeoutMs = 5000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isPortFree(port)) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

/** Asks the Caddy instance behind `adminSocket` to shut itself down. */
function requestAdminStop(adminSocket: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { socketPath: adminSocket, path: "/stop", method: "POST", timeout: 2000 },
      (res) => {
        res.resume();
        res.on("end", () =>
          res.statusCode === 200
            ? resolve()
            : reject(new Error(`Caddy admin API answered POST /stop with HTTP ${res.statusCode}`)),
        );
      },
    );
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("Caddy admin API timed out")));
    req.end();
  });
}

/**
 * Stops a Caddy instance: via its admin API first, falling back to a signal.
 * Throws if `port` is still held afterwards.
 */
async function shutdownCaddy(state: CaddyState): Promise<void> {
  const errors: string[] = [];
  try {
    // Older state files (from before the admin socket existed) lack it.
    if (!state.adminSocket) throw new Error("no admin socket recorded");
    await requestAdminStop(state.adminSocket);
  } catch (err) {
    errors.push(`admin API: ${(err as Error).message}`);
    try {
      process.kill(state.pid);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ESRCH") {
        errors.push(`kill: ${(err as Error).message}`);
      }
    }
  }
  if (state.adminSocket) fs.rmSync(state.adminSocket, { force: true });
  if (!(await waitForPortFree(state.port))) {
    throw new Error(
      `Caddy (pid ${state.pid}) is still holding port ${state.port}` +
        (errors.length ? ` (${errors.join("; ")})` : ""),
    );
  }
}

export type CaddyState = { pid: number; port: number; adminSocket: string };

/**
 * Starts Caddy detached (survives the launching process exiting), serving
 * the repo root at /, bound to `host`. Persists { pid, port, adminSocket }
 * to <artefactsDir>/.caddy-server-state.json so a later, separate process
 * can find and stop it via stopCaddy().
 */
export async function startCaddy(
  artefactsDir: string,
  host = "rubisco.io",
  candidatePorts = CANDIDATE_PORTS,
): Promise<CaddyState> {
  const port = await findFreePort(candidatePorts);
  const root = repoRoot();
  // In the OS temp dir rather than artefactsDir: unix socket paths are
  // limited to ~100 characters.
  const adminSocket = path.join(os.tmpdir(), `caddy-admin-${crypto.randomUUID()}.sock`);
  const caddyConfig = [
    `{`,
    `  admin unix/${adminSocket}`,
    `}`,
    `https://127.0.0.1:${port}, https://${host}:${port} {`,
    `  tls internal`,
    `  root * ${root}/`,
    `  file_server`,
    `}`,
  ].join("\n");

  const proc: ChildProcessByStdio<Writable, null, null> = spawn(
    "caddy",
    ["run", "--adapter", "caddyfile", "--config", "-"],
    { stdio: ["pipe", "ignore", "ignore"], detached: true },
  );
  proc.stdin.write(caddyConfig);
  proc.stdin.end();

  const state: CaddyState = { pid: proc.pid!, port, adminSocket };

  const ready = await waitForCaddy(port);
  if (!ready) {
    await shutdownCaddy(state).catch(() => {});
    throw new Error(`Caddy failed to start on port ${port}`);
  }

  proc.unref();

  fs.mkdirSync(artefactsDir, { recursive: true });
  fs.writeFileSync(stateFilePath(artefactsDir), JSON.stringify(state));
  return state;
}

/**
 * Stops the Caddy instance started by startCaddy() for this artefactsDir, if
 * any, and waits until its port is free again. Throws if it couldn't be
 * stopped, rather than silently leaving it running.
 */
export async function stopCaddy(artefactsDir: string): Promise<void> {
  const file = stateFilePath(artefactsDir);
  if (!fs.existsSync(file)) return;
  const state: CaddyState = JSON.parse(fs.readFileSync(file, "utf8"));
  console.log(`Stopping Caddy file server (pid ${state.pid}, port ${state.port})`);
  try {
    await shutdownCaddy(state);
  } finally {
    fs.rmSync(file, { force: true });
  }
}
