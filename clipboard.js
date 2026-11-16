// Pure helpers for Cut and Paste in the listing, kept free of DOM access so
// they can be unit-tested under Node. Entries are the listing's manifest
// items (folder paths end in "/"); `byPath` maps manifest paths to
// driveItems, as the listing keeps them.

// The entries to cut out of a selection: a folder moves along with
// everything inside it, so entries inside a selected folder are left out.
export function topmostEntries(entries) {
  const folders = entries.filter((e) => e.kind === "folder").map((e) => e.path);
  return entries.filter((e) => !folders.some((f) => f !== e.path && e.path.startsWith(f)));
}

// The manifest paths of `driveItems` in a listing, found by id: where the
// listing shows them, if it does.
export function pathsOfItems(driveItems, byPath) {
  const ids = new Set(driveItems.map((item) => item.id));
  const paths = [];
  for (const [path, item] of byPath) {
    if (ids.has(item.id)) paths.push(path);
  }
  return paths;
}

// Why `driveItem` (shown at manifest `path`, null when the listing doesn't
// show it) can't be moved into `target` ({ path, item }, a folder of the
// listing), or null when it can: a folder can't go into itself, nor into a
// folder inside it.
export function pasteProblem(driveItem, path, target) {
  const intoItself =
    driveItem.id === target.item.id || (!!path && path.endsWith("/") && target.path.startsWith(path));
  return intoItself ? `Can't move "${driveItem.name}" into itself` : null;
}

// Whether `driveItem` already sits in `target` ({ path, item }), so there's
// nothing to move.
export function isInFolder(driveItem, target) {
  return driveItem.parentReference?.id === target.item.id;
}

export function itemCount(n) {
  return `${n} ${n === 1 ? "item" : "items"}`;
}
