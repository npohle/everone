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

// True when there is something to upload and every target name is non-blank.
export function uploadNamesValid(names) {
  return names.length > 0 && names.every((name) => name.trim() !== "");
}

const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "avif"]);
const TEXT_EXT = new Set(["txt", "log", "csv", "tsv", "json", "xml", "yml", "yaml", "md", "markdown"]);

// How the Upload dialog's preview pane shows a picked file: "pdf", "image",
// "text", or null when it can't be previewed. Picked files carry a MIME type
// guessed by the browser, which may be empty, so the extension counts too.
export function uploadPreviewKind(file) {
  const dot = file.name.lastIndexOf(".");
  const ext = dot >= 0 ? file.name.slice(dot + 1).toLowerCase() : "";
  const type = file.type || "";
  if (ext === "pdf" || type === "application/pdf") return "pdf";
  if (IMAGE_EXT.has(ext) || type.startsWith("image/")) return "image";
  if (TEXT_EXT.has(ext) || type.startsWith("text/")) return "text";
  return null;
}

// The file to preview once `removed` is dropped from `files`: the current
// selection if that's another file, else the next file, else the previous
// one, else null.
export function selectionAfterRemoval(files, removed, selected) {
  if (selected !== removed) return selected;
  const i = files.indexOf(removed);
  if (i < 0) return null;
  return files[i + 1] ?? files[i - 1] ?? null;
}
