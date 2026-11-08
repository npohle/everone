// Maps OneDrive driveItems onto the manifest of extend-ui's File System
// component (vendor/extend-ui/file-system.js). Kept free of DOM access so it
// can be unit-tested under Node.

// Extracts a YYYY-MM-DD prefix from a filename and returns it as a string,
// or null if the prefix is missing or doesn't represent a valid calendar date.
export function parseReferenceDate(name) {
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

// Display-only: strip "YYYY-MM-DD_" from the start when the prefix is a valid
// reference date, then drop everything from the first remaining underscore
// onward (including the extension). The underlying item.name is unchanged so
// the viewer title, download filename, and Graph requests keep using the
// canonical name.
export function displayName(name) {
  let s = name;
  if (parseReferenceDate(s) && s[10] === "_") {
    const stripped = s.slice(11);
    if (stripped.length > 0) s = stripped;
  }
  const i = s.indexOf("_");
  if (i > 0) s = s.slice(0, i);
  return s;
}

// The component labels each row by the last segment of its path, so paths
// are built from display names. Those aren't unique ("2020-01-01_Rechnung_a"
// and "2020-02-01_Rechnung_b" both read "Rechnung"), so repeats get zero-width
// spaces appended: the rows still read the same, the paths stay apart.
const DISAMBIGUATOR = "​";

// Maps the driveItems of one folder (or one page of it) to manifest items
// under `parentPath` ("" for the component's root, else ending in "/"). The
// reference date in a name becomes the item's createdAt; folders with
// children are marked lazy (hasChildren), so the component loads them when
// they're expanded.
//
// `taken` holds the paths already used under `parentPath`; pass the same set
// for every page of a folder.
export function toFileSystemItems(driveItems, parentPath = "", taken = new Set()) {
  return driveItems.map((item) => {
    const name = displayName(item.name);
    let segment = name;
    while (taken.has(segment)) segment += DISAMBIGUATOR;
    taken.add(segment);
    const createdAt = parseReferenceDate(item.name) ?? undefined;
    const updatedAt = item.lastModifiedDateTime;
    if (item.folder) {
      return {
        kind: "folder",
        path: `${parentPath}${segment}/`,
        name,
        hasChildren: (item.folder.childCount ?? 0) > 0,
        createdAt,
        updatedAt,
      };
    }
    return {
      kind: "file",
      path: `${parentPath}${segment}`,
      key: item.id,
      name,
      originalName: item.name,
      contentType: item.file?.mimeType,
      size: item.size,
      createdAt,
      updatedAt,
    };
  });
}

// The manifest path of the folder the entry at `path` sits in ("" for the
// component's root).
export function parentPath(path) {
  const trimmed = path.endsWith("/") ? path.slice(0, -1) : path;
  return trimmed.slice(0, trimmed.lastIndexOf("/") + 1);
}

// The OneDrive path ("/Documents/Post") of the entry at manifest `path`.
// Manifest paths are made of display names, so the real names come from the
// driveItems behind the entry and the folders above it (`byPath`: manifest
// path → driveItem). The topmost one can sit anywhere in the drive (search
// results do), so the path above it comes from its parentReference.
export function drivePath(path, byPath) {
  const paths = [];
  for (let i = path.indexOf("/"); i !== -1; i = path.indexOf("/", i + 1)) {
    paths.push(path.slice(0, i + 1));
  }
  if (path && !path.endsWith("/")) paths.push(path);
  const items = paths.map((p) => byPath.get(p)).filter(Boolean);
  if (items.length === 0) return "/";
  // e.g. "/drive/root:/Documents/M%C3%BCller", percent-encoded.
  const above = items[0].parentReference?.path ?? "";
  const colon = above.indexOf(":");
  const prefix = colon === -1 ? "" : decodeURIComponent(above.slice(colon + 1));
  return `${prefix}/${items.map((item) => item.name).join("/")}`;
}

// Search results: OneDrive's search finds items anywhere in the drive (on
// personal drives even when asked to search a folder only), each with a
// parentReference to the folder it is in. The listing shows them in their
// folders, from the drive's root down.

// The folder a parentReference path ("/drive/root:/Documents/M%C3%BCller")
// names, decoded ("/Documents/Müller"); null when there is none.
function referencedPath(parentReference) {
  const path = parentReference?.path;
  const colon = path ? path.indexOf(":") : -1;
  if (colon === -1) return null;
  const rest = path.slice(colon + 1);
  try {
    return decodeURIComponent(rest);
  } catch {
    return rest;
  }
}

// Whether `driveItem` may sit somewhere below `folder` (a driveItem; null for
// the whole drive), going by the paths OneDrive gives. True when either path
// is missing: then only the folders above the item can tell (see
// searchResultItems).
export function mayBeInFolder(driveItem, folder) {
  if (!folder) return true;
  const itemPath = referencedPath(driveItem.parentReference);
  const above = referencedPath(folder.parentReference);
  if (itemPath === null || above === null) return true;
  const folderPath = `${above}/${folder.name}`;
  return itemPath === folderPath || itemPath.startsWith(`${folderPath}/`);
}

// The id of the folder `driveItem` is in; null for an item at the drive's
// root (known by its path) and for the root itself (which has no parent).
function parentId(driveItem) {
  if (driveItem.parentReference?.path === "/drive/root:") return null;
  return driveItem.parentReference?.id ?? null;
}

// Collects the folders above the given driveItems, up to the drive's root,
// as folder id → driveItem. Folders found in `known` (id → driveItem) are
// taken from there, the others fetched with `getItem(id)`, a level at a time.
// The root itself only ends up in there when the paths don't tell an item
// at the root.
export async function foldersAbove(driveItems, getItem, known = new Map()) {
  const folders = new Map();
  let ids = new Set(driveItems.map(parentId).filter(Boolean));
  while (ids.size) {
    const missing = [...ids].filter((id) => !known.has(id));
    const fetched = await Promise.all(missing.map((id) => getItem(id)));
    const level = [...ids].filter((id) => known.has(id)).map((id) => known.get(id)).concat(fetched);
    ids = new Set();
    for (const folder of level) {
      folders.set(folder.id, folder);
      const above = parentId(folder);
      if (above && !folders.has(above)) ids.add(above);
    }
  }
  return folders;
}

// Maps search results to the listing's manifest: the files found (not the
// folders: a folder only shows when it holds a file found), in the folders
// above them (`folders`, see foldersAbove), from the drive's root down. With
// `folderId`, only the files below that folder are kept. Folders hold just
// what was found, so none of them is lazy. Returns the manifest items plus
// manifest path → driveItem.
//
// Files whose folders aren't all known are left out.
export function searchResultItems(driveItems, folders, folderId = null) {
  const manifest = [];
  const byPath = new Map();
  const taken = new Map();
  const add = (driveItem, parentPath) => {
    if (!taken.has(parentPath)) taken.set(parentPath, new Set());
    const [item] = toFileSystemItems([driveItem], parentPath, taken.get(parentPath));
    delete item.hasChildren;
    manifest.push(item);
    byPath.set(item.path, driveItem);
    return item.path;
  };
  // The ids of the folders above an item, nearest first; null when one of
  // them is unknown.
  const idsAbove = (driveItem) => {
    const ids = [];
    for (let id = parentId(driveItem); id; id = parentId(folders.get(id))) {
      if (!folders.has(id)) return null;
      ids.push(id);
    }
    return ids;
  };
  // Folder id → its manifest path ("" for the root), adding it (and the
  // folders above it) on first use.
  const paths = new Map();
  const folderPath = (id) => {
    if (!paths.has(id)) {
      const folder = folders.get(id);
      const above = parentId(folder);
      // The root itself, when it was fetched, isn't shown.
      let path = "";
      if (above) path = add(folder, folderPath(above));
      else if (folder.parentReference?.id) path = add(folder, "");
      paths.set(id, path);
    }
    return paths.get(id);
  };
  for (const driveItem of driveItems) {
    if (driveItem.folder) continue;
    const ids = idsAbove(driveItem);
    if (!ids || (folderId && !ids.includes(folderId))) continue;
    add(driveItem, ids.length ? folderPath(ids[0]) : "");
  }
  return { manifest, byPath };
}
