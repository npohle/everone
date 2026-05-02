import * as graph from "./graph.js";

const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "ico", "avif"]);
const VIDEO_EXT = new Set(["mp4", "webm", "ogv", "mov", "m4v"]);
const AUDIO_EXT = new Set(["mp3", "wav", "ogg", "oga", "m4a", "flac", "aac"]);
const TEXT_EXT = new Set([
  "txt", "log", "csv", "tsv", "json", "xml", "yml", "yaml", "ini", "toml", "env",
  "js", "mjs", "cjs", "ts", "tsx", "jsx", "py", "rb", "go", "rs", "java", "c", "cc", "cpp",
  "h", "hpp", "cs", "php", "swift", "kt", "scala", "lua", "sh", "bash", "zsh", "fish",
  "ps1", "psm1", "sql", "html", "htm", "css", "scss", "sass", "less", "vue", "svelte",
  "diff", "patch", "gitignore", "dockerfile", "makefile",
]);
const MARKDOWN_EXT = new Set(["md", "markdown"]);
const PDF_EXT = new Set(["pdf"]);
const OFFICE_EXT = new Set([
  "doc", "docx", "docm", "dot", "dotx",
  "xls", "xlsx", "xlsm", "xlsb",
  "ppt", "pptx", "pptm", "pps", "ppsx",
  "odt", "ods", "odp",
]);

const MAX_TEXT_BYTES = 2 * 1024 * 1024; // 2 MB cap for inline text rendering.

const els = {
  root: document.getElementById("viewer"),
  body: document.getElementById("viewer-body"),
  title: document.getElementById("viewer-title"),
  download: document.getElementById("viewer-download"),
  open: document.getElementById("viewer-open"),
};

let activeBlobUrl = null;
// Monotonic id; pending renders with stale ids are discarded so a slow load
// doesn't clobber a faster subsequent selection.
let loadId = 0;

// Focus-steal guard: the embedded Office/PDF preview iframe focuses itself on
// load (sometimes repeatedly), which yanks focus out of the file list
// mid-navigation. The focusin event from a cross-origin iframe is unreliable,
// so the guard combines an event listener with a requestAnimationFrame poll
// that actively pulls focus back to a saved element whenever it drifts into
// the preview pane. The guard releases as soon as the user explicitly takes
// focus in the preview (pointer down on the pane, or Tab landing inside it).
let savedFocus = null;
let userTookPreviewFocus = false;
let focusGuardCancel = null;

// Track Tab keypresses so a Tab-into-preview is recognised as user-initiated.
// Reset on any other key so the flag doesn't go stale.
let tabPressed = false;
document.addEventListener("keydown", (e) => {
  tabPressed = e.key === "Tab";
}, true);

// Pointer down anywhere in the preview pane = user explicitly wants focus there.
els.root.addEventListener("pointerdown", () => {
  userTookPreviewFocus = true;
  stopFocusGuard();
});

// Tab landing inside the preview pane is also explicit. We can't tell that
// from just the focusin (an iframe steal also fires focusin), so we gate it
// on the Tab keydown immediately preceding the focusin.
els.root.addEventListener("focusin", () => {
  if (tabPressed) {
    userTookPreviewFocus = true;
    stopFocusGuard();
    return;
  }
  if (userTookPreviewFocus) return;
  restoreSavedFocus();
});

function restoreSavedFocus() {
  if (savedFocus && document.contains(savedFocus) && !els.root.contains(savedFocus)) {
    savedFocus.focus();
  }
}

function stopFocusGuard() {
  if (focusGuardCancel) {
    focusGuardCancel();
    focusGuardCancel = null;
  }
}

// Run for ~10 seconds after a preview update; this comfortably covers Office
// Online and PDF preview loads, which can focus themselves several times as
// their UI hydrates. Yields to the user the moment they touch the preview.
function startFocusGuard() {
  stopFocusGuard();
  if (!savedFocus) return;
  let cancelled = false;
  focusGuardCancel = () => { cancelled = true; };
  const deadline = performance.now() + 10000;
  const tick = () => {
    if (cancelled || userTookPreviewFocus) return;
    if (performance.now() > deadline) return;
    const ae = document.activeElement;
    if (ae && ae !== document.body && els.root.contains(ae)) {
      restoreSavedFocus();
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function extOf(name) {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i + 1).toLowerCase() : "";
}

function clearBody() {
  if (activeBlobUrl) {
    URL.revokeObjectURL(activeBlobUrl);
    activeBlobUrl = null;
  }
  els.body.replaceChildren();
}

function setBody(node) {
  clearBody();
  els.body.appendChild(node);
}

// Skips the DOM update if a newer render has been requested in the meantime.
function setBodyIfCurrent(id, node) {
  if (id !== loadId) return false;
  setBody(node);
  return true;
}

function unsupported(item) {
  const div = document.createElement("div");
  div.className = "unsupported";
  div.innerHTML = `
    <h2>Preview not available</h2>
    <p>This file type can't be previewed in the browser.</p>
    <p>Use <strong>Download</strong> or <strong>Open in OneDrive</strong>.</p>
  `;
  return div;
}

async function renderImage(item, id) {
  const blob = await graph.fetchContent(item);
  if (id !== loadId) return;
  const url = URL.createObjectURL(blob);
  const img = document.createElement("img");
  img.src = url;
  img.alt = item.name;
  if (setBodyIfCurrent(id, img)) activeBlobUrl = url;
  else URL.revokeObjectURL(url);
}

async function renderMedia(item, tag, id) {
  const blob = await graph.fetchContent(item);
  if (id !== loadId) return;
  const url = URL.createObjectURL(blob);
  const el = document.createElement(tag);
  el.src = url;
  el.controls = true;
  el.autoplay = false;
  if (setBodyIfCurrent(id, el)) activeBlobUrl = url;
  else URL.revokeObjectURL(url);
}

async function renderText(item, id) {
  if (item.size && item.size > MAX_TEXT_BYTES) {
    setBodyIfCurrent(id, unsupportedSize(item));
    return;
  }
  const text = await graph.fetchContent(item, { asText: true });
  if (id !== loadId) return;
  const pre = document.createElement("pre");
  pre.textContent = text;
  setBodyIfCurrent(id, pre);
}

function unsupportedSize(item) {
  const div = document.createElement("div");
  div.className = "unsupported";
  div.innerHTML = `
    <h2>File too large to preview</h2>
    <p>${formatBytes(item.size)} exceeds the inline preview limit (${formatBytes(MAX_TEXT_BYTES)}).</p>
    <p>Use <strong>Download</strong> instead.</p>
  `;
  return div;
}

function formatBytes(n) {
  if (n == null) return "";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

async function renderMarkdown(item, id) {
  if (item.size && item.size > MAX_TEXT_BYTES) {
    setBodyIfCurrent(id, unsupportedSize(item));
    return;
  }
  const text = await graph.fetchContent(item, { asText: true });
  if (id !== loadId) return;
  const wrap = document.createElement("article");
  wrap.className = "markdown";
  // Render via the marked CDN if available, otherwise fall back to <pre>.
  if (window.marked) {
    wrap.innerHTML = window.marked.parse(text, { mangle: false, headerIds: false });
  } else {
    const pre = document.createElement("pre");
    pre.textContent = text;
    wrap.appendChild(pre);
  }
  setBodyIfCurrent(id, wrap);
}

async function ensureMarked() {
  if (window.marked) return;
  await new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/marked@12.0.2/marked.min.js";
    s.onload = resolve;
    s.onerror = () => reject(new Error("Failed to load markdown renderer"));
    document.head.appendChild(s);
  });
}

async function renderEmbed(item, id) {
  const url = await graph.getEmbedUrl(item.id);
  if (id !== loadId) return;
  if (!url) {
    setBodyIfCurrent(id, unsupported(item));
    return;
  }
  const iframe = document.createElement("iframe");
  iframe.src = url;
  iframe.allowFullscreen = true;
  iframe.referrerPolicy = "no-referrer";
  setBodyIfCurrent(id, iframe);
}

async function renderPdf(item, id) {
  // Chrome blocks blob: URLs from loading in an <iframe> as PDFs, so route
  // through the Graph preview embed (same path used for Office docs).
  await renderEmbed(item, id);
}

export async function open(item) {
  const id = ++loadId;
  // Capture the focused element to restore it if the preview iframe steals
  // focus on load. If the user is already focused inside the preview pane,
  // don't override their position.
  const ae = document.activeElement;
  if (ae && ae !== document.body && !els.root.contains(ae)) {
    savedFocus = ae;
    userTookPreviewFocus = false;
    startFocusGuard();
  } else if (els.root.contains(ae)) {
    savedFocus = null;
    stopFocusGuard();
  }
  els.title.textContent = item.name;
  els.download.href = item["@microsoft.graph.downloadUrl"] || "#";
  els.download.setAttribute("download", item.name);
  els.download.hidden = !item["@microsoft.graph.downloadUrl"];
  els.open.href = item.webUrl || "#";
  els.open.hidden = !item.webUrl;

  const loading = document.createElement("div");
  loading.className = "unsupported";
  loading.textContent = "Loading preview…";
  setBody(loading);

  try {
    const ext = extOf(item.name);
    if (IMAGE_EXT.has(ext)) {
      await renderImage(item, id);
    } else if (VIDEO_EXT.has(ext)) {
      await renderMedia(item, "video", id);
    } else if (AUDIO_EXT.has(ext)) {
      await renderMedia(item, "audio", id);
    } else if (PDF_EXT.has(ext)) {
      await renderPdf(item, id);
    } else if (MARKDOWN_EXT.has(ext)) {
      try { await ensureMarked(); } catch {}
      await renderMarkdown(item, id);
    } else if (TEXT_EXT.has(ext)) {
      await renderText(item, id);
    } else if (OFFICE_EXT.has(ext)) {
      await renderEmbed(item, id);
    } else if (item.file && item.file.mimeType && item.file.mimeType.startsWith("text/")) {
      await renderText(item, id);
    } else {
      setBodyIfCurrent(id, unsupported(item));
    }
  } catch (err) {
    if (id !== loadId) return;
    const div = document.createElement("div");
    div.className = "unsupported";
    div.innerHTML = `<h2>Preview failed</h2><p>${(err && err.message) || "Unknown error"}</p>`;
    setBody(div);
  }
}

export function clear() {
  loadId++;
  savedFocus = null;
  stopFocusGuard();
  els.title.textContent = "Preview";
  els.download.hidden = true;
  els.open.hidden = true;
  const placeholder = document.createElement("div");
  placeholder.className = "placeholder";
  placeholder.textContent = "Select a file from the list to preview it here.";
  setBody(placeholder);
}
