// Preview pane of the Upload dialog: shows a picked, not yet uploaded File
// from the user's disk. PDFs are rendered page by page with pdf.js at the
// pane's full width, like the main preview; images and text are shown as-is.
import { loadPdfjs } from "./viewer.js";
import { uploadPreviewKind } from "./upload-list.js";

const MAX_TEXT_BYTES = 2 * 1024 * 1024; // Same cap as the main preview.

const els = {
  title: document.getElementById("upload-preview-title"),
  body: document.getElementById("upload-preview-body"),
};

// Monotonic id; a slow render must not draw into a newer preview.
let loadId = 0;
let currentFile = null;
let currentDoc = null;
let blobUrl = null;

function message(className, html) {
  const div = document.createElement("div");
  div.className = className;
  div.innerHTML = html;
  return div;
}

function reset(node) {
  if (currentDoc) {
    currentDoc.destroy().catch(() => {});
    currentDoc = null;
  }
  if (blobUrl) {
    URL.revokeObjectURL(blobUrl);
    blobUrl = null;
  }
  els.body.replaceChildren(node);
}

async function renderPdf(file, id) {
  const pdfjsLib = await loadPdfjs();
  const data = await file.arrayBuffer();
  if (id !== loadId) return;
  const task = pdfjsLib.getDocument({ data });
  let doc;
  try {
    doc = await task.promise;
  } catch (err) {
    task.destroy().catch(() => {});
    throw err;
  }
  if (id !== loadId) { doc.destroy().catch(() => {}); return; }

  const container = document.createElement("div");
  container.className = "pdf-viewer";
  const pages = document.createElement("div");
  pages.className = "pdf-pages";
  container.appendChild(pages);
  reset(container);
  currentDoc = doc;

  const dpr = window.devicePixelRatio || 1;
  // Fit the page width to the pane, minus .pdf-pages' padding.
  const width = (pages.clientWidth || els.body.clientWidth) - 24;
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    if (id !== loadId) return;
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: Math.max(0.1, width / base.width) });
    const canvas = document.createElement("canvas");
    canvas.className = "pdf-page";
    canvas.width = Math.floor(viewport.width * dpr);
    canvas.height = Math.floor(viewport.height * dpr);
    canvas.style.width = `${Math.floor(viewport.width)}px`;
    canvas.style.height = `${Math.floor(viewport.height)}px`;
    canvas.setAttribute("aria-label", `Page ${p} of ${doc.numPages}`);
    pages.appendChild(canvas);
    try {
      await page.render({
        canvasContext: canvas.getContext("2d"),
        viewport,
        transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null,
      }).promise;
    } catch (err) {
      // Renders are cancelled when the document is destroyed mid-flight.
      if (id !== loadId) return;
      throw err;
    }
  }
}

function renderImage(file) {
  const img = document.createElement("img");
  const url = URL.createObjectURL(file);
  img.src = url;
  img.alt = file.name;
  reset(img);
  blobUrl = url;
}

async function renderText(file, id) {
  if (file.size > MAX_TEXT_BYTES) {
    reset(message("unsupported", "<h2>File too large to preview</h2>"));
    return;
  }
  const text = await file.text();
  if (id !== loadId) return;
  const pre = document.createElement("pre");
  pre.textContent = text;
  reset(pre);
}

// Shows `file` in the pane; a no-op if it's already shown.
export async function show(file) {
  if (file === currentFile) return;
  currentFile = file;
  const id = ++loadId;
  els.title.textContent = file.name;
  els.title.title = file.name;
  reset(message("unsupported", "Loading preview…"));
  try {
    const kind = uploadPreviewKind(file);
    if (kind === "pdf") await renderPdf(file, id);
    else if (kind === "image") renderImage(file);
    else if (kind === "text") await renderText(file, id);
    else reset(message("unsupported",
      "<h2>Preview not available</h2><p>This file type can't be previewed in the browser.</p>"));
  } catch (err) {
    if (id !== loadId) return;
    const div = message("unsupported", "<h2>Preview failed</h2><p></p>");
    div.querySelector("p").textContent = (err && err.message) || "Unknown error";
    reset(div);
  }
}

// Empties the pane and releases whatever the last preview held on to.
export function clear() {
  loadId++;
  currentFile = null;
  els.title.textContent = "Preview";
  els.title.removeAttribute("title");
  reset(message("placeholder", "Select a file from the list to preview it here."));
}
