import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseReferenceDate,
  displayName,
  toFileSystemItems,
} from "../../file-system-items.js";

const file = (id, name, extra = {}) => ({
  id,
  name,
  size: 100,
  lastModifiedDateTime: "2026-03-04T05:06:07Z",
  file: { mimeType: "application/pdf" },
  ...extra,
});
const folder = (id, name, childCount = 0) => ({
  id,
  name,
  lastModifiedDateTime: "2026-03-04T05:06:07Z",
  folder: { childCount },
});

test("parseReferenceDate returns a valid YYYY-MM-DD prefix", () => {
  assert.equal(parseReferenceDate("2020-02-02_Rechnung.pdf"), "2020-02-02");
  assert.equal(parseReferenceDate("2024-02-29 notes.txt"), "2024-02-29");
});

test("parseReferenceDate rejects missing or impossible dates", () => {
  assert.equal(parseReferenceDate("Rechnung.pdf"), null);
  assert.equal(parseReferenceDate("2023-02-29_x.pdf"), null);
  assert.equal(parseReferenceDate("2020-13-01_x.pdf"), null);
});

test("displayName strips the date prefix and everything from the next underscore", () => {
  assert.equal(displayName("2020-02-02_Rechnung_Telekom.pdf"), "Rechnung");
  assert.equal(displayName("2020-02-02_Rechnung.pdf"), "Rechnung.pdf");
  assert.equal(displayName("notes_draft.txt"), "notes");
  assert.equal(displayName("notes.txt"), "notes.txt");
});

test("displayName keeps names it can't shorten", () => {
  // An invalid date stays part of the name.
  assert.equal(displayName("2023-02-29_x.pdf"), "2023-02-29");
  // Nothing would be left after the prefix.
  assert.equal(displayName("2020-02-02_"), "2020-02-02");
  // A leading underscore isn't a separator.
  assert.equal(displayName("_hidden.txt"), "_hidden.txt");
});

test("toFileSystemItems maps files with the split name and reference date", () => {
  const [item] = toFileSystemItems([file("f1", "2020-02-02_Rechnung_Telekom.pdf")]);
  assert.deepEqual(item, {
    kind: "file",
    path: "Rechnung",
    key: "f1",
    name: "Rechnung",
    originalName: "2020-02-02_Rechnung_Telekom.pdf",
    contentType: "application/pdf",
    size: 100,
    createdAt: "2020-02-02",
    updatedAt: "2026-03-04T05:06:07Z",
  });
});

test("toFileSystemItems leaves the date out when the name has none", () => {
  const [item] = toFileSystemItems([file("f1", "notes.txt", { file: {} })]);
  assert.equal(item.path, "notes.txt");
  assert.equal(item.createdAt, undefined);
  assert.equal(item.contentType, undefined);
});

test("toFileSystemItems maps folders, lazy when they have children", () => {
  const items = toFileSystemItems([folder("d1", "Documents", 3), folder("d2", "Empty")]);
  assert.deepEqual(items, [
    {
      kind: "folder",
      path: "Documents/",
      name: "Documents",
      hasChildren: true,
      createdAt: undefined,
      updatedAt: "2026-03-04T05:06:07Z",
    },
    {
      kind: "folder",
      path: "Empty/",
      name: "Empty",
      hasChildren: false,
      createdAt: undefined,
      updatedAt: "2026-03-04T05:06:07Z",
    },
  ]);
});

test("toFileSystemItems nests items under the given folder path", () => {
  const items = toFileSystemItems(
    [file("f1", "2021-01-01_Brief.pdf"), folder("d1", "2019-05-05_Archiv", 1)],
    "Documents/Post/",
  );
  assert.equal(items[0].path, "Documents/Post/Brief.pdf");
  assert.equal(items[1].path, "Documents/Post/Archiv/");
  assert.equal(items[1].createdAt, "2019-05-05");
});

test("toFileSystemItems keeps the paths of equal display names apart", () => {
  const items = toFileSystemItems([
    file("f1", "2020-01-01_Rechnung_a.pdf"),
    file("f2", "2020-02-01_Rechnung_b.pdf"),
    folder("d1", "Rechnung"),
    file("f3", "2020-03-01_Rechnung_c.pdf"),
  ]);
  const paths = items.map((item) => item.path.replace(/\/$/, ""));
  assert.equal(new Set(paths).size, 4);
  // Only invisible characters tell them apart; all read "Rechnung".
  for (const path of paths) assert.equal(path.replace(/​/g, ""), "Rechnung");
  for (const item of items) assert.equal(item.name, "Rechnung");
  assert.equal(items[0].path, "Rechnung");
});
