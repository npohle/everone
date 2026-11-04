import { test } from "node:test";
import assert from "node:assert/strict";
import { icon, fileKind, fileIcon, FOLDER_GLYPH_URL } from "../../icons.js";

test("icon renders a decorative lucide-style SVG", () => {
  const svg = icon("upload");
  assert.match(svg, /^<svg /);
  assert.match(svg, /<\/svg>$/);
  assert.match(svg, /aria-hidden="true"/);
  assert.match(svg, /viewBox="0 0 24 24"/);
  assert.match(svg, /stroke="currentColor"/);
  assert.match(svg, /<path /);
});

test("icon appends extra classes", () => {
  assert.match(icon("x", { className: "spin big" }), /class="icon-svg spin big"/);
  assert.match(icon("x"), /class="icon-svg"/);
});

test("icon throws for unknown names so typos surface early", () => {
  assert.throws(() => icon("no-such-icon"), /Unknown icon/);
});

test("fileKind detects folders first", () => {
  assert.equal(fileKind({ name: "photo.png", folder: {} }), "folder");
});

test("fileKind maps extensions to kinds, case-insensitively", () => {
  const cases = {
    "a.PNG": "image",
    "a.jpeg": "image",
    "a.mp4": "video",
    "a.flac": "audio",
    "a.pdf": "pdf",
    "a.docx": "document",
    "a.xlsx": "spreadsheet",
    "a.csv": "spreadsheet",
    "a.pptx": "presentation",
    "a.tar.gz": "archive",
    "a.json": "code",
    "a.md": "text",
    "notes.txt": "text",
    "a.bin": "file",
    "README": "file",
  };
  for (const [name, kind] of Object.entries(cases)) {
    assert.equal(fileKind({ name }), kind, name);
  }
});

test("fileIcon shows extend's folder glyph for folders", () => {
  const html = fileIcon({ name: "Documents", folder: {} });
  assert.match(html, /^<img /);
  assert.ok(html.includes(`src="${FOLDER_GLYPH_URL}"`));
  assert.match(html, /alt=""/);
  assert.ok(FOLDER_GLYPH_URL.startsWith("data:image/svg+xml,"));
});

test("fileIcon tints file icons by kind", () => {
  const html = fileIcon({ name: "invoice.pdf" });
  assert.match(html, /^<svg /);
  assert.match(html, /class="icon-svg file-icon file-icon-pdf"/);
  assert.match(fileIcon({ name: "x.unknown" }), /file-icon-file/);
});
