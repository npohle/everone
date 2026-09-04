import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { escapeHtml } from "./sanitize.js";

describe("escapeHtml", () => {
  it("escapes ampersands", () => {
    assert.equal(escapeHtml("a&b"), "a&amp;b");
  });

  it("escapes angle brackets", () => {
    assert.equal(escapeHtml("<script>alert(1)</script>"), "&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("escapes double quotes", () => {
    assert.equal(escapeHtml('a"b'), "a&quot;b");
  });

  it("escapes single quotes", () => {
    assert.equal(escapeHtml("a'b"), "a&#39;b");
  });

  it("escapes all special chars together", () => {
    assert.equal(escapeHtml(`<img src="x" onerror='alert(1)'>&`),
      "&lt;img src=&quot;x&quot; onerror=&#39;alert(1)&#39;&gt;&amp;");
  });

  it("returns empty string for non-string input", () => {
    assert.equal(escapeHtml(null), "");
    assert.equal(escapeHtml(undefined), "");
    assert.equal(escapeHtml(42), "");
    assert.equal(escapeHtml({}), "");
  });

  it("passes through safe strings unchanged", () => {
    assert.equal(escapeHtml("hello world"), "hello world");
    assert.equal(escapeHtml("2024-01-15"), "2024-01-15");
    assert.equal(escapeHtml(""), "");
  });

  it("handles realistic XSS payloads in error messages", () => {
    const payload = 'Graph 400: <img src=x onerror="document.cookie">';
    const escaped = escapeHtml(payload);
    assert.ok(!escaped.includes("<"), "should not contain unescaped <");
    assert.ok(!escaped.includes(">"), "should not contain unescaped >");
  });

  it("handles event handler injection attempts", () => {
    const payload = '" onmouseover="alert(1)" data-x="';
    const escaped = escapeHtml(payload);
    assert.ok(!escaped.includes('"'), "should not contain unescaped double quotes");
  });
});

// parseReferenceDate is defined inline in app.js and used in innerHTML.
// Re-implement the same logic here to verify it only produces safe output.
function parseReferenceDate(name) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(name);
  if (!m) return null;
  const [, y, mo, d] = m;
  const year = +y, month = +mo, day = +d;
  const dt = new Date(Date.UTC(year, month - 1, day));
  if (
    dt.getUTCFullYear() !== year ||
    dt.getUTCMonth() !== month - 1 ||
    dt.getUTCDate() !== day
  ) return null;
  return `${y}-${mo}-${d}`;
}

describe("parseReferenceDate (security)", () => {
  it("returns only digits and hyphens for valid dates", () => {
    const result = parseReferenceDate("2024-01-15_report.pdf");
    assert.equal(result, "2024-01-15");
    assert.match(result, /^[\d-]+$/);
  });

  it("returns null for filenames without date prefix", () => {
    assert.equal(parseReferenceDate("report.pdf"), null);
    assert.equal(parseReferenceDate("<script>alert(1)</script>"), null);
  });

  it("returns null for invalid calendar dates", () => {
    assert.equal(parseReferenceDate("2024-13-01_file.txt"), null);
    assert.equal(parseReferenceDate("2024-02-30_file.txt"), null);
  });

  it("cannot produce HTML-unsafe output", () => {
    // Even with adversarial input that starts with digits
    const result = parseReferenceDate('2024-01-01<script>alert(1)</script>');
    if (result !== null) {
      assert.ok(!result.includes("<"), "must not contain <");
      assert.ok(!result.includes(">"), "must not contain >");
    }
  });
});

// formatBytes is used in innerHTML in unsupportedSize(). Verify it can't
// produce HTML.
function formatBytes(n) {
  if (n == null) return "";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

describe("formatBytes (security)", () => {
  it("returns safe string for normal sizes", () => {
    assert.equal(formatBytes(0), "0 B");
    assert.equal(formatBytes(1024), "1.0 KB");
    assert.equal(formatBytes(2 * 1024 * 1024), "2.0 MB");
  });

  it("returns empty string for null/undefined", () => {
    assert.equal(formatBytes(null), "");
    assert.equal(formatBytes(undefined), "");
  });

  it("output never contains HTML metacharacters", () => {
    const sizes = [0, 1, 512, 1024, 1024 * 1024, NaN, Infinity, -1];
    for (const s of sizes) {
      const result = formatBytes(s);
      assert.ok(!result.includes("<"), `formatBytes(${s}) must not contain <`);
      assert.ok(!result.includes(">"), `formatBytes(${s}) must not contain >`);
    }
  });
});
