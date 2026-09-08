import type { FullConfig } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import net from "node:net";
import { spawn, execFileSync, type ChildProcessByStdio } from "node:child_process";
import type { Writable } from "node:stream";
import https from "node:https";

export default async function globalSetup(config: FullConfig) {

  const runId = () => `${new Date().toISOString().replace(/[:.]/g, "-")}-${process.pid}`;
  const artefactsDir = path.join("tests", "artefacts", runId());
  fs.mkdirSync(artefactsDir, { recursive: true });

  process.env.ARTEFACTS_DIR = artefactsDir;
  process.env.STATE_FILE = path.join(process.env.ARTEFACTS_DIR!, '.caddy-server-state.json');
  process.env.CADDY_PORT = String(await findFreePort([1443, 2443, 3443, 4443, 5443, 6443, 7443, 8443, 9443]));
  process.env.CADDY_HOST = "npohle.github.io";

  console.log(`Artefacts directory: ${artefactsDir}`);
  console.log(`Caddy will run on port: ${process.env.CADDY_PORT}`);
  console.log(`Caddy will serve host: ${process.env.CADDY_HOST}`);

  const root = repoRoot();
  const caddyConfig = [
    `https://127.0.0.1:${process.env.CADDY_PORT}, https://${process.env.CADDY_HOST}:${process.env.CADDY_PORT} {`,
    `  tls internal`,
    `  handle_path /everone/* {`,
    `    root * ${root}/`,
    `    file_server`,
    `  }`,
    `}`,
  ].join("\n");

  console.log(`Starting Caddy file server for ${process.env.CADDY_HOST} on port ${process.env.CADDY_PORT}`);
  const proc: ChildProcessByStdio<Writable, null, null> = spawn(
    "caddy",
    ["run", "--adapter", "caddyfile", "--config", "-"],
    {
      stdio: ["pipe", "ignore", "ignore"],
      detached: true,
    },
  );
  proc.stdin.write(caddyConfig);
  proc.stdin.end();

  const ready = await waitForCaddy(Number(process.env.CADDY_PORT));
  if (!ready) {
    proc.kill();
    throw new Error(`Caddy failed to start on port ${process.env.CADDY_PORT}`);
  }

  proc.unref();
  
  fs.writeFileSync(process.env.STATE_FILE, JSON.stringify({ pid: proc.pid, port: process.env.CADDY_PORT }));
  console.log(`Caddy is serving https://${process.env.CADDY_HOST}:${process.env.CADDY_PORT}/everone/ (https://127.0.0.1:${process.env.CADDY_PORT}/everone/)`);

}


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

async function findFreePort(candidates: number[]) {
  for (const port of candidates) {
    if (await isPortFree(port)) return port;
  }
  throw new Error(`No free port found in list: ${candidates.join(", ")}`);
}

function repoRoot() {
  return execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
}

function probeCaddy(port: number) {
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

async function waitForCaddy(port: number, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await probeCaddy(port)) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}