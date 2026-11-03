import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mergeFiles,
  uploadNamesValid,
  uploadPreviewKind,
  selectionAfterRemoval,
} from "../../upload-list.js";

const file = (name, size = 1, type = "") => ({ name, size, type });
const names = (files) => files.map((f) => f.name);

test("mergeFiles appends new files in order", () => {
  const merged = mergeFiles([file("a.txt")], [file("b.txt"), file("c.txt")]);
  assert.deepEqual(names(merged), ["a.txt", "b.txt", "c.txt"]);
});

test("mergeFiles silently drops files whose name is already listed", () => {
  const existing = [file("a.txt", 1), file("b.txt")];
  const merged = mergeFiles(existing, [file("a.txt", 2), file("c.txt")]);
  assert.deepEqual(names(merged), ["a.txt", "b.txt", "c.txt"]);
  // The entry already in the list is kept rather than replaced.
  assert.equal(merged[0], existing[0]);
});

test("mergeFiles dedupes within a single pick too", () => {
  const merged = mergeFiles([], [file("a.txt"), file("a.txt"), file("b.txt")]);
  assert.deepEqual(names(merged), ["a.txt", "b.txt"]);
});

test("mergeFiles does not mutate its inputs", () => {
  const existing = [file("a.txt")];
  const incoming = [file("b.txt")];
  mergeFiles(existing, incoming);
  assert.deepEqual(names(existing), ["a.txt"]);
  assert.deepEqual(names(incoming), ["b.txt"]);
});

test("mergeFiles accepts array-likes such as a FileList", () => {
  const fileList = { 0: file("a.txt"), 1: file("b.txt"), length: 2 };
  assert.deepEqual(names(mergeFiles([], fileList)), ["a.txt", "b.txt"]);
});

test("uploadNamesValid accepts a list of non-empty names", () => {
  assert.equal(uploadNamesValid(["a.txt", "2020-02-02_b.txt"]), true);
});

test("uploadNamesValid rejects an empty list", () => {
  assert.equal(uploadNamesValid([]), false);
});

test("uploadNamesValid rejects empty or blank names", () => {
  assert.equal(uploadNamesValid(["a.txt", ""]), false);
  assert.equal(uploadNamesValid(["   ", "b.txt"]), false);
});

test("uploadPreviewKind recognises PDFs by extension or MIME type", () => {
  assert.equal(uploadPreviewKind(file("scan.pdf")), "pdf");
  assert.equal(uploadPreviewKind(file("SCAN.PDF")), "pdf");
  assert.equal(uploadPreviewKind(file("scan", 1, "application/pdf")), "pdf");
});

test("uploadPreviewKind recognises images and text", () => {
  assert.equal(uploadPreviewKind(file("photo.JPG")), "image");
  assert.equal(uploadPreviewKind(file("photo", 1, "image/png")), "image");
  assert.equal(uploadPreviewKind(file("notes.txt")), "text");
  assert.equal(uploadPreviewKind(file("data.json")), "text");
  assert.equal(uploadPreviewKind(file("README", 1, "text/plain")), "text");
});

test("uploadPreviewKind returns null for anything else", () => {
  assert.equal(uploadPreviewKind(file("report.docx")), null);
  assert.equal(uploadPreviewKind(file("archive.zip", 1, "application/zip")), null);
  assert.equal(uploadPreviewKind(file("noextension")), null);
});

test("selectionAfterRemoval keeps the selection when another file is removed", () => {
  const [a, b, c] = [file("a"), file("b"), file("c")];
  assert.equal(selectionAfterRemoval([a, b, c], b, a), a);
});

test("selectionAfterRemoval moves to the next file, or the previous one at the end", () => {
  const [a, b, c] = [file("a"), file("b"), file("c")];
  assert.equal(selectionAfterRemoval([a, b, c], b, b), c);
  assert.equal(selectionAfterRemoval([a, b, c], c, c), b);
});

test("selectionAfterRemoval clears the selection when the last file goes", () => {
  const a = file("a");
  assert.equal(selectionAfterRemoval([a], a, a), null);
  assert.equal(selectionAfterRemoval([], null, null), null);
});
