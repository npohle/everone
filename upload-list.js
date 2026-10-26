// Pure helpers for the Upload dialog's file list, kept free of DOM access so
// they can be unit-tested under Node.

// Appends `incoming` (an array or FileList) to `existing`, silently skipping
// any file whose name is already listed. Uploads land in a single folder, so
// the name is what identifies a file; the entry already in the list wins.
export function mergeFiles(existing, incoming) {
  const seen = new Set(existing.map((f) => f.name));
  const merged = existing.slice();
  for (const file of Array.from(incoming)) {
    if (seen.has(file.name)) continue;
    seen.add(file.name);
    merged.push(file);
  }
  return merged;
}
