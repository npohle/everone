import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { get } from "node:https";

import { contentTypeFor, resolveRequestPath, startDevServer } from "../e2e/lib/dev-server.js";

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));

test("maps extensions to the content types a browser needs", () => {
  assert.equal(contentTypeFor("/index.html"), "text/html; charset=utf-8");
  // ES modules are rejected by the browser unless served as JavaScript.
  assert.equal(contentTypeFor("/app.js"), "text/javascript; charset=utf-8");
  assert.equal(contentTypeFor("/styles.css"), "text/css; charset=utf-8");
  assert.equal(contentTypeFor("/nope.bin"), "application/octet-stream");
});

test("resolves directory requests to index.html", () => {
  assert.equal(resolveRequestPath("/srv", "/"), "/srv/index.html");
  assert.equal(resolveRequestPath("/srv", "/sub/"), "/srv/sub/index.html");
});

test("strips the query string and hash", () => {
  assert.equal(resolveRequestPath("/srv", "/app.js?v=2"), "/srv/app.js");
  assert.equal(resolveRequestPath("/srv", "/app.js#x"), "/srv/app.js");
});

test("serves the app under a base path", () => {
  assert.equal(resolveRequestPath("/srv", "/everone/app.js", "/everone/"), "/srv/app.js");
  assert.equal(resolveRequestPath("/srv", "/everone/", "/everone/"), "/srv/index.html");
  assert.equal(resolveRequestPath("/srv", "/everone", "/everone/"), "/srv/index.html");
  assert.equal(resolveRequestPath("/srv", "/elsewhere/app.js", "/everone/"), null);
});

test("refuses to escape the served root", () => {
  // Traversal segments must never resolve outside the root, however they arrive.
  for (const attempt of [
    "/../../etc/passwd",
    "/%2e%2e/%2e%2e/etc/passwd",
    "/sub/../../etc/passwd",
    "/..%2f..%2fetc/passwd",
  ]) {
    const resolved = resolveRequestPath("/srv", attempt);
    assert.ok(
      resolved === null || resolved.startsWith("/srv/"),
      `${attempt} escaped the root: ${resolved}`
    );
  }
  assert.equal(resolveRequestPath("/srv", "/%ff"), null); // undecodable
  assert.equal(resolveRequestPath("/srv", "/../app.js", "/everone/"), null);
});

test("serves the SPA over http and never caches", async (t) => {
  const server = await startDevServer({ root: REPO_ROOT, basePath: "/everone/" });
  t.after(() => server.close());

  assert.match(server.url, /^http:\/\/127\.0\.0\.1:\d+\/everone\/$/);

  const page = await fetch(server.url);
  assert.equal(page.status, 200);
  assert.equal(page.headers.get("content-type"), "text/html; charset=utf-8");
  assert.equal(page.headers.get("cache-control"), "no-store, max-age=0");
  assert.match(await page.text(), /OneDrive Browser/);

  const script = await fetch(new URL("app.js", server.url));
  assert.equal(script.headers.get("content-type"), "text/javascript; charset=utf-8");

  const missing = await fetch(new URL("does-not-exist.js", server.url));
  assert.equal(missing.status, 404);

  const outside = await fetch(`http://127.0.0.1:${server.port}/index.html`);
  assert.equal(outside.status, 404, "requests outside the base path are not served");

  // Lets a spec prove the page it is looking at came from this server, and not
  // from the deployed site the app origin normally resolves to.
  const health = await fetch(new URL("__e2e/health", server.url));
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), {
    server: "onedrive-e2e-dev-server",
    root: REPO_ROOT.replace(/\/$/, ""),
    basePath: "/everone/",
  });
});

test("serves the SPA over https with a self-signed certificate", async (t) => {
  const server = await startDevServer({ root: REPO_ROOT, tls: { host: "npohle.github.io" } });
  t.after(() => server.close());

  assert.match(server.url, /^https:\/\/127\.0\.0\.1:\d+\/$/);

  // Node rejects the self-signed certificate by default; the browser under test
  // is launched with --ignore-certificate-errors, so mirror that here.
  await assert.rejects(fetch(server.url), (err) => {
    assert.match(String(err.cause?.code ?? err.cause?.message ?? ""), /SELF_SIGNED|self-signed/i);
    return true;
  });

  const body = await new Promise((resolvePromise, reject) => {
    get({ host: server.host, port: server.port, path: "/", rejectUnauthorized: false }, (res) => {
      let text = "";
      res.on("data", (c) => (text += c));
      res.on("end", () => resolvePromise({ status: res.statusCode, text }));
    }).on("error", reject);
  });
  assert.equal(body.status, 200);
  assert.match(body.text, /OneDrive Browser/);
});
