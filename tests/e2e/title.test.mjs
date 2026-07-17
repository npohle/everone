import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { createServer as createNetServer } from "node:net";
import { createAgenticBrowserCore } from "agentic-browser";

const PROJECT_ROOT = fileURLToPath(new URL("../..", import.meta.url));

const CHROME_PATH =
  process.env.AGENTIC_BROWSER_CHROME_EXECUTABLE_PATH ||
  "/home/agent/.agent-browser/browsers/chrome-150.0.7871.24/chrome";

const MIME_TYPES = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".mjs": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

/** Minimal static-file HTTP server. */
function startStaticServer(root, port = 0) {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url, "http://localhost");
      const filePath = join(
        root,
        url.pathname === "/" ? "index.html" : url.pathname
      );

      if (!existsSync(filePath) || !statSync(filePath).isFile()) {
        res.writeHead(404);
        res.end("Not Found");
        return;
      }

      const ext = extname(filePath);
      res.writeHead(200, {
        "Content-Type": MIME_TYPES[ext] || "application/octet-stream",
      });
      res.end(readFileSync(filePath));
    });

    server.listen(port, "127.0.0.1", () => {
      const addr = server.address();
      resolve({
        server,
        port: addr.port,
        url: `http://127.0.0.1:${addr.port}`,
      });
    });
    server.on("error", reject);
  });
}

/** Get a free port by binding to port 0 and releasing. */
function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = createNetServer();
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
    srv.on("error", reject);
  });
}

/** Launch headless Chrome with --no-sandbox and return the child + CDP port. */
function launchChrome(port) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      CHROME_PATH,
      [
        "--headless=new",
        "--no-sandbox",
        "--disable-gpu",
        `--remote-debugging-port=${port}`,
        "--no-first-run",
        "--no-default-browser-check",
        "about:blank",
      ],
      { detached: true, stdio: "pipe" }
    );
    child.unref();

    const timeout = setTimeout(() => {
      reject(new Error("Chrome failed to start within 10 s"));
    }, 10_000);

    // Wait for the DevTools listening message on stderr
    child.stderr.on("data", (chunk) => {
      if (chunk.toString().includes("DevTools listening")) {
        clearTimeout(timeout);
        resolve(child);
      }
    });

    child.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });
    child.on("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`Chrome exited early with code ${code}`));
    });
  });
}

describe("Page title end-to-end test", () => {
  let cdpPort;
  let staticServer;
  let browser;
  let sessionId;
  let chromeProcess;

  before(async () => {
    // 1. Start a local static file server
    staticServer = await startStaticServer(PROJECT_ROOT);

    // 2. Find a free port and launch Chrome (needs --no-sandbox in containers)
    cdpPort = await getFreePort();
    chromeProcess = await launchChrome(cdpPort);

    // 3. Connect agentic-browser to the running Chrome via CDP
    browser = createAgenticBrowserCore({
      env: {
        ...process.env,
        AGENTIC_BROWSER_HEADLESS: "true",
        AGENTIC_BROWSER_CDP_URL: `http://127.0.0.1:${cdpPort}`,
      },
    });

    const session = await browser.startSession();
    sessionId = session.sessionId;
  });

  after(async () => {
    if (browser && sessionId) {
      await browser.stopSession(sessionId).catch(() => {});
    }
    if (chromeProcess?.pid) {
      try {
        process.kill(-chromeProcess.pid, "SIGTERM");
      } catch {
        try { process.kill(chromeProcess.pid, "SIGKILL"); } catch {}
      }
    }
    if (staticServer?.server) {
      staticServer.server.close();
    }
  });

  it("should have the title 'everone'", async () => {
    // Navigate to the locally served app
    await browser.runCommand({
      sessionId,
      type: "navigate",
      payload: { url: staticServer.url },
    });

    // Retrieve the page title
    const result = await browser.getPageContent({
      sessionId,
      mode: "title",
    });

    assert.equal(
      result.content,
      "everone",
      `Expected page title to be "everone" but got "${result.content}"`
    );
  });
});
