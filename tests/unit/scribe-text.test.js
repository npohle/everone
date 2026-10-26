import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { SCRIBE_BASE, SCRIBE_VERSION } from "../../scribe-text.js";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const scribeDir = fileURLToPath(SCRIBE_BASE);

test("scribe.js is served from this site, not a CDN", () => {
  // Browsers refuse `new Worker(url)` when url is cross-origin, and scribe.js
  // spawns its workers relative to its own module URL.
  assert.equal(SCRIBE_BASE.protocol, "file:");
  assert.equal(SCRIBE_BASE.href, pathToFileURL(path.join(repoRoot, "vendor/scribe.js-ocr/")).href);
});

test("the vendored copy matches SCRIBE_VERSION", () => {
  const pkg = JSON.parse(readFileSync(path.join(scribeDir, "package.json"), "utf8"));
  assert.equal(pkg.name, "scribe.js-ocr");
  assert.equal(pkg.version, SCRIBE_VERSION);
  assert.ok(existsSync(path.join(scribeDir, "LICENSE")));
});

function* jsFiles(dir) {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) yield* jsFiles(p);
    else if (name.endsWith(".js")) yield p;
  }
}

// Relative specifiers the browser will request: static/dynamic imports and
// `new URL("./…", import.meta.url)` (workers, wasm, fonts). Comment lines are
// skipped: JSDoc `import('…')` types and commented-out code never load.
const SPECIFIER_RE = [
  /\bfrom\s+['"](\.{1,2}\/[^'"]+)['"]/g,
  /\bimport\s*\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g,
  /\bimport\s+['"](\.{1,2}\/[^'"]+)['"]/g,
  /new URL\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*,\s*import\.meta\.url\s*\)/g,
];

test("every relative module, worker and asset scribe.js references is vendored", () => {
  const missing = [];
  for (const file of jsFiles(scribeDir)) {
    const src = readFileSync(file, "utf8")
      .split("\n")
      .filter((line) => !/^\s*(\/\/|\/?\*)/.test(line))
      .join("\n");
    for (const re of SPECIFIER_RE) {
      for (const [, spec] of src.matchAll(re)) {
        if (spec.includes("${")) continue;
        const target = path.resolve(path.dirname(file), spec);
        if (!existsSync(target)) missing.push(`${path.relative(scribeDir, file)} -> ${spec}`);
      }
    }
  }
  assert.deepEqual(missing, []);
});

test("the OCR engine's wasm builds are vendored", () => {
  for (const dir of ["core", "core-vanilla"]) {
    for (const flavour of ["simd", "relaxedsimd"]) {
      assert.ok(existsSync(path.join(scribeDir, "tess", dir, `tesseract-core-${flavour}.wasm`)), `${dir}/${flavour}`);
    }
  }
});

test("the app no longer loads anything from the scribe.js CDN", () => {
  for (const file of ["scribe-text.js", "viewer.js", "index.html"]) {
    const src = readFileSync(path.join(repoRoot, file), "utf8");
    assert.doesNotMatch(src, /cdn\.jsdelivr\.net\/npm\/scribe\.js-ocr/, file);
  }
});
