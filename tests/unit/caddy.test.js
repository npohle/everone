import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { startCaddy, stopCaddy } from "../e2e/lib/caddy.ts";

function hasCaddy() {
  try {
    execFileSync("caddy", ["version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/** A port the OS just handed out as free, so the test doesn't depend on CANDIDATE_PORTS being available. */
function ephemeralPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

function isListening(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code !== "ESRCH";
  }
}

/** Caddy releases its port slightly before its process is gone (and reaped). */
async function exitsWithin(pid, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isAlive(pid)) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return false;
}

test("stopCaddy shuts Caddy down and frees its port", { skip: !hasCaddy() && "caddy not installed" }, async () => {
  const artefactsDir = fs.mkdtempSync(path.join(os.tmpdir(), "caddy-test-"));
  try {
    const port = await ephemeralPort();
    const state = await startCaddy(artefactsDir, "rubisco.io", [port]);
    assert.equal(state.port, port);
    assert.equal(await isListening(port), true);

    await stopCaddy(artefactsDir);

    assert.equal(await isListening(port), false, `port ${port} is still held after stopCaddy()`);
    assert.equal(await exitsWithin(state.pid, 5000), true, `caddy (pid ${state.pid}) is still running after stopCaddy()`);
    assert.equal(fs.existsSync(path.join(artefactsDir, ".caddy-server-state.json")), false);
  } finally {
    fs.rmSync(artefactsDir, { recursive: true, force: true });
  }
});

test("stopCaddy is a no-op when no Caddy was started for the directory", async () => {
  const artefactsDir = fs.mkdtempSync(path.join(os.tmpdir(), "caddy-test-"));
  try {
    await stopCaddy(artefactsDir);
  } finally {
    fs.rmSync(artefactsDir, { recursive: true, force: true });
  }
});
