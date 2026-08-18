// Static dev server for the SPA under test.
//
// The app is a dependency-free static site, so the "dev server" is just enough
// HTTP to serve the working copy with correct content types, no caching, and —
// when the app origin is https — a self-signed certificate. Serving the local
// files (rather than pointing the tests at the deployed site) is what makes this
// suite test the code in the working tree.

import { createServer as createHttpServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { createSelfSignedCert } from "./tls.js";

export const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

/** Lets a spec prove which server actually answered for the app origin. */
export const HEALTH_PATH = "__e2e/health";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".map": "application/json; charset=utf-8",
};

export const contentTypeFor = (path) =>
  MIME[extname(path).toLowerCase()] ?? "application/octet-stream";

const normaliseBasePath = (basePath) =>
  basePath && basePath !== "/" ? `/${basePath.replace(/^\/+|\/+$/g, "")}/` : "/";

/**
 * Map a request URL onto a file inside `root`.
 * @returns {string|null} absolute path, or null when the request is out of bounds
 */
export function resolveRequestPath(root, urlPath, basePath = "/") {
  let decoded;
  try {
    decoded = decodeURIComponent(String(urlPath).split("?")[0].split("#")[0]);
  } catch {
    return null;
  }

  const base = normaliseBasePath(basePath);
  if (base !== "/") {
    if (decoded === base.slice(0, -1)) decoded = base;
    if (!decoded.startsWith(base)) return null;
    decoded = `/${decoded.slice(base.length)}`;
  }

  if (decoded.endsWith("/")) decoded += "index.html";

  const rootDir = resolve(root);
  const target = resolve(join(rootDir, normalize(decoded)));
  if (target !== rootDir && !target.startsWith(rootDir + sep)) return null;
  return target;
}

/**
 * @param {object} [options]
 * @param {string} [options.root]      directory to serve (defaults to the repo root)
 * @param {string} [options.basePath]  URL prefix the app is served under
 * @param {number} [options.port]      0 (default) picks a free ephemeral port
 * @param {{host: string}} [options.tls] serve https with a self-signed cert for `host`
 */
export async function startDevServer({
  root = REPO_ROOT,
  basePath = "/",
  port = 0,
  host = "127.0.0.1",
  tls = null,
} = {}) {
  const rootDir = resolve(root);
  const base = normaliseBasePath(basePath);
  const cert = tls ? createSelfSignedCert(tls.host) : null;

  const handler = async (req, res) => {
    const path = String(req.url ?? "/").split("?")[0];
    if (path === `${base}${HEALTH_PATH}`) {
      res.writeHead(200, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      });
      res.end(JSON.stringify({ server: "onedrive-e2e-dev-server", root: rootDir, basePath: base }));
      return;
    }

    const filePath = resolveRequestPath(rootDir, req.url ?? "/", base);
    if (!filePath) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }
    try {
      let target = filePath;
      let info = await stat(target);
      if (info.isDirectory()) {
        target = join(target, "index.html");
        info = await stat(target);
      }
      if (!info.isFile()) throw new Error("not a file");

      res.writeHead(200, {
        "content-type": contentTypeFor(target),
        "content-length": info.size,
        // A stale asset would silently test the wrong code.
        "cache-control": "no-store, max-age=0",
      });
      if (req.method === "HEAD") {
        res.end();
        return;
      }
      createReadStream(target).pipe(res);
    } catch {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end("Not found");
    }
  };

  const server = cert
    ? createHttpsServer({ key: cert.key, cert: cert.cert }, handler)
    : createHttpServer(handler);

  await new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolvePromise);
  });

  const boundPort = server.address().port;
  const scheme = cert ? "https" : "http";

  return {
    port: boundPort,
    host,
    root: rootDir,
    basePath: base,
    origin: `${scheme}://${host}:${boundPort}`,
    url: `${scheme}://${host}:${boundPort}${base}`,
    healthPath: `${base}${HEALTH_PATH}`,
    async close() {
      // The browser holds keep-alive sockets open; without dropping them,
      // server.close() waits on a browser that may already be gone.
      server.closeAllConnections?.();
      await new Promise((resolvePromise) => server.close(() => resolvePromise()));
      cert?.cleanup();
    },
  };
}
