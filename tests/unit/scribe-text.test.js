import { test } from "node:test";
import assert from "node:assert/strict";
import { SCRIBE_BASE, workerShimSource } from "../../scribe-text.js";

test("workerShimSource wraps a scribe.js module worker in a static import", () => {
  const url = `${SCRIBE_BASE}js/worker/pdfWorker.js`;
  assert.equal(workerShimSource(url, { type: "module" }), `import ${JSON.stringify(url)};`);
});

test("workerShimSource uses importScripts for classic scribe.js workers", () => {
  const url = `${SCRIBE_BASE}lib/zip.js/lib/core/codec-worker.js`;
  assert.equal(workerShimSource(url), `importScripts(${JSON.stringify(url)});`);
  assert.equal(workerShimSource(url, { type: "classic" }), `importScripts(${JSON.stringify(url)});`);
});

test("workerShimSource accepts URL objects, as scribe.js passes new URL(...)", () => {
  const url = new URL("js/worker/generalWorker.js", SCRIBE_BASE);
  assert.equal(workerShimSource(url, { type: "module" }), `import ${JSON.stringify(url.href)};`);
});

test("workerShimSource leaves workers from other origins and paths alone", () => {
  assert.equal(workerShimSource("https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs", { type: "module" }), null);
  assert.equal(workerShimSource("blob:https://npohle.github.io/1234", { type: "module" }), null);
  assert.equal(workerShimSource("https://npohle.github.io/everone/worker.js"), null);
});
