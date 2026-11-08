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
