import { describe, it } from "node:test";
import assert from "node:assert/strict";

// ---------------------------------------------------------------------------
// Hash-based navigation helpers
// ---------------------------------------------------------------------------
// These pure functions encode/decode folder navigation state to/from the URL
// hash, enabling browser back/forward and refresh-to-same-folder.

function encodeNavHash(stack) {
  if (!stack || stack.length === 0) return "";
  return "#path=" + stack.map((s) => encodeURIComponent(s.id)).join("/");
}

function decodeNavHash(hash) {
  if (!hash || !hash.startsWith("#path=")) return [];
  const raw = hash.slice("#path=".length);
  if (!raw) return [];
  return raw.split("/").map((segment) => ({
    id: decodeURIComponent(segment),
    name: null, // names are resolved from Graph on restore
  }));
}

describe("encodeNavHash", () => {
  it("returns empty string for empty stack", () => {
    assert.equal(encodeNavHash([]), "");
  });

  it("returns empty string for null/undefined", () => {
    assert.equal(encodeNavHash(null), "");
    assert.equal(encodeNavHash(undefined), "");
  });

  it("encodes a single folder", () => {
    const stack = [{ id: "abc123", name: "Documents" }];
    assert.equal(encodeNavHash(stack), "#path=abc123");
  });

  it("encodes nested folders", () => {
    const stack = [
      { id: "folder1", name: "Documents" },
      { id: "folder2", name: "Photos" },
      { id: "folder3", name: "2024" },
    ];
    assert.equal(encodeNavHash(stack), "#path=folder1/folder2/folder3");
  });

  it("percent-encodes special characters in ids", () => {
    const stack = [{ id: "id with spaces/and+more", name: "Test" }];
    assert.equal(
      encodeNavHash(stack),
      "#path=id%20with%20spaces%2Fand%2Bmore"
    );
  });
});

describe("decodeNavHash", () => {
  it("returns empty array for empty string", () => {
    assert.deepEqual(decodeNavHash(""), []);
  });

  it("returns empty array for null/undefined", () => {
    assert.deepEqual(decodeNavHash(null), []);
    assert.deepEqual(decodeNavHash(undefined), []);
  });

  it("returns empty array for unrecognised hash", () => {
    assert.deepEqual(decodeNavHash("#other=value"), []);
  });

  it("returns empty array for #path= with no value", () => {
    assert.deepEqual(decodeNavHash("#path="), []);
  });

  it("decodes a single folder id", () => {
    const result = decodeNavHash("#path=abc123");
    assert.equal(result.length, 1);
    assert.equal(result[0].id, "abc123");
    assert.equal(result[0].name, null);
  });

  it("decodes nested folder ids", () => {
    const result = decodeNavHash("#path=folder1/folder2/folder3");
    assert.equal(result.length, 3);
    assert.equal(result[0].id, "folder1");
    assert.equal(result[1].id, "folder2");
    assert.equal(result[2].id, "folder3");
  });

  it("decodes percent-encoded ids", () => {
    const result = decodeNavHash("#path=id%20with%20spaces%2Fand%2Bmore");
    assert.equal(result.length, 1);
    assert.equal(result[0].id, "id with spaces/and+more");
  });

  it("round-trips with encodeNavHash", () => {
    const stack = [
      { id: "abc!@#$%^", name: "A" },
      { id: "def/ghi", name: "B" },
    ];
    const hash = encodeNavHash(stack);
    const decoded = decodeNavHash(hash);
    assert.equal(decoded.length, 2);
    assert.equal(decoded[0].id, stack[0].id);
    assert.equal(decoded[1].id, stack[1].id);
  });
});

// ---------------------------------------------------------------------------
// Keyboard shortcut definitions
// ---------------------------------------------------------------------------

const SHORTCUTS = [
  { key: "/", description: "Focus search" },
  { key: "Escape", description: "Clear search / go up one level" },
  { key: "?", description: "Toggle keyboard shortcuts" },
  { key: "ArrowUp", description: "Previous file in list" },
  { key: "ArrowDown", description: "Next file in list" },
  { key: "Enter", description: "Open selected folder / file" },
  { key: "Backspace", description: "Go up one level" },
];

describe("keyboard shortcuts definition", () => {
  it("has required keys and descriptions", () => {
    for (const s of SHORTCUTS) {
      assert.ok(s.key, "shortcut must have a key");
      assert.ok(s.description, "shortcut must have a description");
      assert.equal(typeof s.key, "string");
      assert.equal(typeof s.description, "string");
    }
  });

  it("has unique keys", () => {
    const keys = SHORTCUTS.map((s) => s.key);
    const unique = new Set(keys);
    assert.equal(unique.size, keys.length, "all shortcut keys must be unique");
  });

  it("includes / for search focus", () => {
    assert.ok(SHORTCUTS.find((s) => s.key === "/"));
  });

  it("includes ? for help toggle", () => {
    assert.ok(SHORTCUTS.find((s) => s.key === "?"));
  });

  it("includes Escape", () => {
    assert.ok(SHORTCUTS.find((s) => s.key === "Escape"));
  });
});

// ---------------------------------------------------------------------------
// File metadata formatting
// ---------------------------------------------------------------------------

function formatFileSize(n) {
  if (n == null) return "";
  if (n === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

function formatMetaDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const now = new Date();
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: sameYear ? undefined : "numeric",
  });
}

describe("formatFileSize", () => {
  it("returns empty string for null/undefined", () => {
    assert.equal(formatFileSize(null), "");
    assert.equal(formatFileSize(undefined), "");
  });

  it("formats zero bytes", () => {
    assert.equal(formatFileSize(0), "0 B");
  });

  it("formats bytes", () => {
    assert.equal(formatFileSize(500), "500 B");
  });

  it("formats kilobytes", () => {
    assert.equal(formatFileSize(1024), "1.0 KB");
  });

  it("formats megabytes", () => {
    assert.equal(formatFileSize(1024 * 1024), "1.0 MB");
  });

  it("formats gigabytes", () => {
    assert.equal(formatFileSize(1024 * 1024 * 1024), "1.0 GB");
  });

  it("rounds fractional values", () => {
    assert.equal(formatFileSize(1536), "1.5 KB");
  });

  it("drops decimal for values >= 10", () => {
    assert.equal(formatFileSize(15 * 1024), "15 KB");
  });
});

describe("formatMetaDate", () => {
  it("returns empty string for null/undefined/empty", () => {
    assert.equal(formatMetaDate(null), "");
    assert.equal(formatMetaDate(undefined), "");
    assert.equal(formatMetaDate(""), "");
  });

  it("returns empty string for invalid dates", () => {
    assert.equal(formatMetaDate("not-a-date"), "");
  });

  it("returns a non-empty string for valid ISO dates", () => {
    const result = formatMetaDate("2024-06-15T10:30:00Z");
    assert.ok(result.length > 0, "should produce output for valid date");
    assert.ok(result.includes("15"), "should include day number");
  });
});
