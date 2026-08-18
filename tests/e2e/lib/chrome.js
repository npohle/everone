// Chrome launcher for the e2e suite.
//
// agent-browser can launch its own browser, but this suite needs two extra
// switches that only matter for testing, so it launches Chrome itself and lets
// agent-browser attach over CDP:
//
//   --host-resolver-rules  resolves the app's registered origin to the local dev
//                          server, so Microsoft's redirect URI check passes while
//                          the code under test is the working copy
//   --window-size          Microsoft's sign-in pages put "Next" below the fold on
//                          the default headless viewport

import { spawn } from "node:child_process";
import { accessSync, constants, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

export const DEFAULT_WINDOW_SIZE = [1280, 900];

const CANDIDATE_DIRS = [
  join(process.env.HOME ?? "", ".agent-browser", "browsers"),
  join(process.env.HOME ?? "", ".cache", "ms-playwright"),
];

const CANDIDATE_BINARIES = [
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
];

const exists = (path) => {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
};

/** Locate a Chrome binary, preferring the one agent-browser installed. */
export function findChrome(explicitPath = null) {
  if (explicitPath) {
    if (!exists(explicitPath)) throw new Error(`Chrome not executable at ${explicitPath}`);
    return explicitPath;
  }
  for (const dir of CANDIDATE_DIRS) {
    let entries;
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const entry of entries.sort().reverse()) {
      for (const candidate of [
        join(dir, entry, "chrome"),
        join(dir, entry, "chrome-linux64", "chrome"),
        join(dir, entry, "chrome-headless-shell-linux64", "chrome-headless-shell"),
      ]) {
        if (exists(candidate)) return candidate;
      }
    }
  }
  for (const candidate of CANDIDATE_BINARIES) if (exists(candidate)) return candidate;
  throw new Error(
    "No Chrome binary found. Install one with `agent-browser install` or set E2E_CHROME_PATH."
  );
}

/**
 * @param {object} options
 * @param {number} options.cdpPort
 * @param {string} options.userDataDir
 * @param {Record<string,string>} [options.hostMap] hostname -> "127.0.0.1:port"
 * @param {boolean} [options.headed]
 * @param {[number,number]} [options.windowSize]
 * @returns {string[]}
 */
export function buildChromeArgs({
  cdpPort,
  userDataDir,
  hostMap = {},
  headed = false,
  windowSize = DEFAULT_WINDOW_SIZE,
}) {
  const args = [
    `--remote-debugging-port=${cdpPort}`,
    `--user-data-dir=${userDataDir}`,
    `--window-size=${windowSize[0]},${windowSize[1]}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-features=Translate,MediaRouter",
    "--disable-dev-shm-usage",
    "--disable-crash-reporter",
    "--disable-gpu",
    "--no-sandbox",
  ];
  if (!headed) args.push("--headless=new");

  const rules = Object.entries(hostMap).map(([host, target]) => `MAP ${host} ${target}`);
  if (rules.length > 0) {
    args.push(`--host-resolver-rules=${rules.join(", ")}`);
    // The dev server's certificate for the mapped host is self-signed.
    args.push("--ignore-certificate-errors");
  }
  args.push("about:blank");
  return args;
}

async function waitForCdp(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (res.ok) return await res.json();
    } catch (err) {
      lastError = err;
    }
    await sleep(150);
  }
  throw new Error(`Chrome did not expose CDP on port ${port} within ${timeoutMs}ms: ${lastError}`);
}

async function freePort() {
  const { createServer } = await import("node:net");
  return new Promise((resolvePromise, reject) => {
    const srv = createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolvePromise(port));
    });
  });
}

// Some sandboxes refuse signals even to our own children; a browser we cannot
// kill is not worth failing an otherwise green run over.
function killQuietly(child) {
  try {
    if (!child.killed) child.kill("SIGKILL");
  } catch (err) {
    if (err.code !== "EACCES" && err.code !== "EPERM") throw err;
  }
}

export async function launchChrome({
  chromePath = null,
  hostMap = {},
  headed = false,
  windowSize = DEFAULT_WINDOW_SIZE,
  timeoutMs = 30_000,
} = {}) {
  const binary = findChrome(chromePath);
  const cdpPort = await freePort();
  const userDataDir = mkdtempSync(join(tmpdir(), "onedrive-e2e-chrome-"));
  const args = buildChromeArgs({ cdpPort, userDataDir, hostMap, headed, windowSize });

  const child = spawn(binary, args, { stdio: ["ignore", "ignore", "pipe"] });
  child.on("error", () => {});
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr = (stderr + chunk).slice(-4000);
  });
  const exited = new Promise((_, reject) =>
    child.once("exit", (code) => reject(new Error(`Chrome exited early (${code}):\n${stderr}`)))
  );

  try {
    const version = await Promise.race([waitForCdp(cdpPort, timeoutMs), exited]);
    return {
      cdpPort,
      binary,
      userDataDir,
      version: version.Browser,
      async close() {
        killQuietly(child);
        await new Promise((resolvePromise) => {
          if (child.exitCode !== null) return resolvePromise();
          child.once("exit", resolvePromise);
          setTimeout(resolvePromise, 5_000).unref?.();
        });
        rmSync(userDataDir, { recursive: true, force: true });
      },
    };
  } catch (err) {
    killQuietly(child);
    rmSync(userDataDir, { recursive: true, force: true });
    throw err;
  }
}
