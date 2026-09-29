import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeFiles } from "../../upload-list.js";

const file = (name, size = 1) => ({ name, size });
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
