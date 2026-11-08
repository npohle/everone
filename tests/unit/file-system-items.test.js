import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseReferenceDate,
  displayName,
  toFileSystemItems,
  parentPath,
  drivePath,
  mayBeInFolder,
  foldersAbove,
  searchResultItems,
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

test("parentPath is the manifest path of the folder an entry sits in", () => {
  assert.equal(parentPath("Documents/Post/Brief"), "Documents/Post/");
  assert.equal(parentPath("Documents/Post/"), "Documents/");
  assert.equal(parentPath("Documents/"), "");
  assert.equal(parentPath("notes.txt"), "");
  assert.equal(parentPath(""), "");
});

test("drivePath spells out the real names of an entry and the folders above it", () => {
  const root = { path: "/drive/root:" };
  const byPath = new Map([
    ["Documents/", { ...folder("d1", "Documents", 2), parentReference: root }],
    ["Documents/Rechnung/", { ...folder("d2", "2020-01-01_Rechnung_Telekom", 1), parentReference: { path: "/drive/root:/Documents" } }],
    ["Documents/Rechnung/Brief", file("f1", "2019-01-02_Brief_Bank.pdf")],
  ]);
  assert.equal(drivePath("Documents/", byPath), "/Documents");
  assert.equal(drivePath("Documents/Rechnung/", byPath), "/Documents/2020-01-01_Rechnung_Telekom");
  assert.equal(drivePath("Documents/Rechnung/Brief", byPath), "/Documents/2020-01-01_Rechnung_Telekom/2019-01-02_Brief_Bank.pdf");
  assert.equal(drivePath("", byPath), "/");
});

test("drivePath starts from the parent path of a search result's topmost entry", () => {
  const byPath = new Map([
    ["Rechnungen/", { ...folder("d1", "Rechnungen", 1), parentReference: { path: "/drive/root:/Documents/M%C3%BCller%20GmbH" } }],
    ["Rechnungen/a.pdf", file("f1", "a.pdf")],
  ]);
  assert.equal(drivePath("Rechnungen/a.pdf", byPath), "/Documents/Müller GmbH/Rechnungen/a.pdf");
  // Without a parentReference (or a path on it) the entry counts as top-level.
  byPath.set("Rechnungen/", folder("d1", "Rechnungen", 1));
  assert.equal(drivePath("Rechnungen/", byPath), "/Rechnungen");
});

// A drive for the search tests: root › Documents › Post › {Brief, Archiv ›
// Alt}, root › Fotos, with each item's parentReference as Graph gives it.
const ROOT_ID = "root-id";
const at = (item, parent, path) => ({ ...item, parentReference: { id: parent, path: `/drive/root:${path}` } });
const drive = {
  documents: at(folder("documents", "Documents", 2), ROOT_ID, ""),
  post: at(folder("post", "2020-01-01_Post_Eingang", 2), "documents", "/Documents"),
  archiv: at(folder("archiv", "Archiv", 1), "post", "/Documents/2020-01-01_Post_Eingang"),
  alt: at(folder("alt", "Alt", 1), "archiv", "/Documents/2020-01-01_Post_Eingang/Archiv"),
  fotos: at(folder("fotos", "Fotos", 1), ROOT_ID, ""),
};
const found = {
  brief: at(file("brief", "2021-03-04_Brief_Bank.pdf"), "post", "/Documents/2020-01-01_Post_Eingang"),
  old: at(file("old", "old.pdf"), "alt", "/Documents/2020-01-01_Post_Eingang/Archiv/Alt"),
  foto: at(file("foto", "foto.jpg"), "fotos", "/Fotos"),
  top: at(file("top", "top.pdf"), ROOT_ID, ""),
  // A folder found by its name.
  archiv: drive.archiv,
};
const allFolders = new Map(Object.values(drive).map((item) => [item.id, item]));

test("mayBeInFolder checks the paths OneDrive gives", () => {
  assert.equal(mayBeInFolder(found.brief, drive.post), true);
  assert.equal(mayBeInFolder(found.old, drive.post), true);
  assert.equal(mayBeInFolder(found.old, drive.documents), true);
  assert.equal(mayBeInFolder(found.foto, drive.documents), false);
  assert.equal(mayBeInFolder(found.top, drive.documents), false);
  // A folder whose name starts like the other's isn't inside it.
  const postfach = at(folder("postfach", "2020-01-01_Post_EingangX", 1), "documents", "/Documents");
  const inPostfach = at(file("x", "x.pdf"), "postfach", "/Documents/2020-01-01_Post_EingangX");
  assert.equal(mayBeInFolder(inPostfach, drive.post), false);
  // Without a folder, everything is in the drive.
  assert.equal(mayBeInFolder(found.foto, null), true);
});

test("mayBeInFolder compares percent-encoded paths decoded", () => {
  const muller = at(folder("m", "Müller GmbH", 1), "documents", "/Documents");
  const inMuller = at(file("x", "x.pdf"), "m", "/Documents/M%C3%BCller%20GmbH");
  assert.equal(mayBeInFolder(inMuller, muller), true);
});

test("mayBeInFolder can't tell without paths", () => {
  const { path, ...noPath } = found.foto.parentReference;
  assert.equal(mayBeInFolder({ ...found.foto, parentReference: noPath }, drive.documents), true);
  assert.equal(mayBeInFolder(found.foto, { ...drive.documents, parentReference: { id: ROOT_ID } }), true);
});

test("foldersAbove fetches every folder up to the root, each once", async () => {
  const fetched = [];
  const getItem = async (id) => {
    fetched.push(id);
    return allFolders.get(id);
  };
  const folders = await foldersAbove([found.brief, found.old, found.top], getItem);
  assert.deepEqual([...folders.keys()].sort(), ["alt", "archiv", "documents", "post"]);
  assert.deepEqual([...fetched].sort(), ["alt", "archiv", "documents", "post"]);
});

test("foldersAbove only fetches the folders it doesn't know yet", async () => {
  const fetched = [];
  const getItem = async (id) => {
    fetched.push(id);
    return allFolders.get(id);
  };
  const known = new Map([["post", drive.post], ["documents", drive.documents]]);
  const folders = await foldersAbove([found.old], getItem, known);
  assert.deepEqual([...folders.keys()].sort(), ["alt", "archiv", "documents", "post"]);
  assert.deepEqual(fetched.sort(), ["alt", "archiv"]);
});

test("foldersAbove stops at the root when the paths are missing", async () => {
  const root = { id: ROOT_ID, name: "root", folder: { childCount: 2 }, parentReference: { driveId: "d" } };
  const noPath = (item) => ({ ...item, parentReference: { id: item.parentReference.id } });
  const items = new Map([...allFolders].map(([id, item]) => [id, noPath(item)]).concat([[ROOT_ID, root]]));
  const folders = await foldersAbove([noPath(found.foto)], async (id) => items.get(id));
  assert.deepEqual([...folders.keys()].sort(), ["fotos", ROOT_ID]);
});

// The manifest items as "path (kind)", sorted.
const listed = ({ manifest }) => manifest.map((item) => `${item.path} (${item.kind})`).sort();

test("searchResultItems lists the files found in their folders, from the drive's root", () => {
  const result = searchResultItems(Object.values(found), allFolders);
  assert.deepEqual(listed(result), [
    "Documents/ (folder)",
    "Documents/Post/ (folder)",
    "Documents/Post/Archiv/ (folder)",
    "Documents/Post/Archiv/Alt/ (folder)",
    "Documents/Post/Archiv/Alt/old.pdf (file)",
    "Documents/Post/Brief (file)",
    "Fotos/ (folder)",
    "Fotos/foto.jpg (file)",
    "top.pdf (file)",
  ]);
  // Each path maps to its driveItem.
  assert.equal(result.byPath.get("Documents/Post/Archiv/Alt/old.pdf"), found.old);
  assert.equal(result.byPath.get("Documents/Post/"), drive.post);
  // Folders hold just what was found: they're not lazy.
  for (const item of result.manifest) assert.equal(item.hasChildren, undefined);
  const post = result.manifest.find((item) => item.path === "Documents/Post/");
  assert.equal(post.name, "Post");
  assert.equal(post.createdAt, "2020-01-01");
});

test("searchResultItems leaves out what isn't in the given folder", () => {
  const result = searchResultItems(Object.values(found), allFolders, "archiv");
  assert.deepEqual(listed(result), [
    "Documents/ (folder)",
    "Documents/Post/ (folder)",
    "Documents/Post/Archiv/ (folder)",
    "Documents/Post/Archiv/Alt/ (folder)",
    "Documents/Post/Archiv/Alt/old.pdf (file)",
  ]);
  assert.deepEqual(listed(searchResultItems(Object.values(found), allFolders, "fotos")), [
    "Fotos/ (folder)",
    "Fotos/foto.jpg (file)",
  ]);
  assert.deepEqual(listed(searchResultItems([found.top, found.archiv], allFolders, "documents")), []);
});

test("searchResultItems keeps equal display names apart", () => {
  const a = at(file("a", "2021-01-01_Rechnung_a.pdf"), "post", "/Documents/2020-01-01_Post_Eingang");
  const b = at(file("b", "2021-02-01_Rechnung_b.pdf"), "post", "/Documents/2020-01-01_Post_Eingang");
  const { manifest } = searchResultItems([a, b], allFolders);
  const files = manifest.filter((item) => item.kind === "file");
  assert.equal(files.length, 2);
  assert.notEqual(files[0].path, files[1].path);
  assert.deepEqual(files.map((item) => item.name), ["Rechnung", "Rechnung"]);
});

test("searchResultItems drops files whose folders it doesn't know", () => {
  const lost = at(file("lost", "lost.pdf"), "unknown", "/Somewhere");
  assert.deepEqual(listed(searchResultItems([lost, found.top], allFolders)), ["top.pdf (file)"]);
});

test("searchResultItems puts what's below the fetched root at the top", () => {
  const root = { id: ROOT_ID, name: "root", folder: { childCount: 2 }, parentReference: { driveId: "d" } };
  const fotos = { ...drive.fotos, parentReference: { id: ROOT_ID } };
  const foto = { ...found.foto, parentReference: { id: "fotos" } };
  const folders = new Map([[ROOT_ID, root], ["fotos", fotos]]);
  assert.deepEqual(listed(searchResultItems([foto], folders)), ["Fotos/ (folder)", "Fotos/foto.jpg (file)"]);
});
