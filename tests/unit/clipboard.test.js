import { test } from "node:test";
import assert from "node:assert/strict";
import { topmostEntries, pathsOfItems, pasteProblem, isInFolder, itemCount } from "../../clipboard.js";

const file = (path) => ({ kind: "file", path });
const folder = (path) => ({ kind: "folder", path });
const paths = (entries) => entries.map((e) => e.path);

test("topmostEntries keeps entries none of whose folders above is among them", () => {
  const entries = [
    folder("Docs/"),
    folder("Docs/Sub/"),
    file("Docs/Sub/a.txt"),
    file("Docs/b.txt"),
    file("c.txt"),
    folder("Other/"),
  ];
  assert.deepEqual(paths(topmostEntries(entries)), ["Docs/", "c.txt", "Other/"]);
});

test("topmostEntries keeps entries inside folders that aren't selected", () => {
  const entries = [file("Docs/a.txt"), folder("Docs/Sub/"), file("Docs/Sub/b.txt"), file("Docsx/c.txt")];
  assert.deepEqual(paths(topmostEntries(entries)), ["Docs/a.txt", "Docs/Sub/", "Docsx/c.txt"]);
});

test("topmostEntries doesn't take a file for a folder that shares its name", () => {
  // A file "Docs" (no trailing slash) has nothing inside it.
  assert.deepEqual(paths(topmostEntries([file("Docs"), file("Docs/a.txt")])), ["Docs", "Docs/a.txt"]);
});

test("pathsOfItems finds the manifest paths of driveItems by id", () => {
  const byPath = new Map([
    ["Docs/", { id: "1" }],
    ["Docs/a.txt", { id: "2" }],
    ["b.txt", { id: "3" }],
  ]);
  assert.deepEqual(pathsOfItems([{ id: "3" }, { id: "1" }, { id: "9" }], byPath), ["Docs/", "b.txt"]);
  assert.deepEqual(pathsOfItems([], byPath), []);
});

test("pasteProblem refuses to move a folder into itself or a folder inside it", () => {
  const sub = { id: "sub", name: "Sub", folder: { childCount: 1 } };
  const target = (path, id = "t") => ({ path, item: { id } });
  assert.equal(pasteProblem(sub, "Docs/Sub/", target("Docs/Sub/", "sub")), `Can't move "Sub" into itself`);
  assert.equal(pasteProblem(sub, "Docs/Sub/", target("Docs/Sub/Deep/")), `Can't move "Sub" into itself`);
  assert.equal(pasteProblem(sub, "Docs/Sub/", target("Docs/Subway/")), null);
  assert.equal(pasteProblem(sub, "Docs/Sub/", target("Docs/")), null);
  // Not in the listing (any more): only its id tells.
  assert.equal(pasteProblem(sub, null, target("Other/")), null);
  assert.equal(pasteProblem(sub, null, target("Other/", "sub")), `Can't move "Sub" into itself`);
  assert.equal(pasteProblem({ id: "f", name: "a.txt" }, "Docs/a.txt", target("Docs/")), null);
});

test("isInFolder tells whether a driveItem already sits in the target folder", () => {
  const target = { path: "Docs/", item: { id: "docs" } };
  assert.equal(isInFolder({ id: "a", parentReference: { id: "docs" } }, target), true);
  assert.equal(isInFolder({ id: "a", parentReference: { id: "root" } }, target), false);
  assert.equal(isInFolder({ id: "a" }, target), false);
});

test("itemCount spells out a number of items", () => {
  assert.equal(itemCount(1), "1 item");
  assert.equal(itemCount(0), "0 items");
  assert.equal(itemCount(3), "3 items");
});
