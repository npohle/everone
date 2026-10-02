import { config, isConfigured } from "./config.js";
import * as auth from "./auth.js";
import * as graph from "./graph.js";
import * as viewer from "./viewer.js";
import { mergeFiles } from "./upload-list.js";

const els = {
  signedOut: document.getElementById("signed-out"),
  configHint: document.getElementById("config-hint"),
  signinCta: document.getElementById("signin-cta"),
  authBtn: document.getElementById("auth-btn"),
  user: document.getElementById("user"),
  browser: document.getElementById("browser"),
  listing: document.getElementById("listing"),
  loading: document.getElementById("loading"),
  loadMore: document.getElementById("load-more"),
  status: document.getElementById("status"),
  upBtn: document.getElementById("up-btn"),
  sort: document.getElementById("sort"),
  search: document.getElementById("search"),
  breadcrumbs: document.getElementById("breadcrumbs"),
  toast: document.getElementById("toast"),
  newFolderBtn: document.getElementById("new-folder-btn"),
  newFolderDialog: document.getElementById("new-folder-dialog"),
  newFolderForm: document.getElementById("new-folder-form"),
  newFolderPath: document.getElementById("new-folder-path"),
  newFolderName: document.getElementById("new-folder-name"),
  newFolderCancel: document.getElementById("new-folder-cancel"),
  newFolderCreate: document.getElementById("new-folder-create"),
  deleteFolderBtn: document.getElementById("delete-folder-btn"),
  deleteFolderDialog: document.getElementById("delete-folder-dialog"),
  deleteFolderForm: document.getElementById("delete-folder-form"),
  deleteFolderPath: document.getElementById("delete-folder-path"),
  deleteFolderCancel: document.getElementById("delete-folder-cancel"),
  deleteFolderConfirm: document.getElementById("delete-folder-confirm"),
  uploadBtn: document.getElementById("upload-btn"),
  uploadDialog: document.getElementById("upload-dialog"),
  uploadForm: document.getElementById("upload-form"),
  uploadPath: document.getElementById("upload-path"),
  uploadInput: document.getElementById("upload-input"),
  uploadSelect: document.getElementById("upload-select"),
  uploadList: document.getElementById("upload-list"),
  uploadCancel: document.getElementById("upload-cancel"),
  uploadStart: document.getElementById("upload-start"),
  uploadClose: document.getElementById("upload-close"),
};

const state = {
  // Stack of folder items the user navigated through. The last entry is current.
  stack: [],
  // Current page of items being displayed.
  items: [],
  nextLink: null,
  sort: "name-desc",
  searchQuery: "",
  // Monotonic id; pending requests with stale ids are discarded.
  loadId: 0,
  // Currently selected file id (the one being previewed).
  selectedId: null,
  // True while a folder listing or search request is in flight.
  loading: false,
  // Upload dialog: target folder, picked files, and per-file result keyed by
  // name. phase is "select" (editable), "uploading" (read-only) or "done".
  upload: { folder: null, files: [], results: new Map(), phase: "select" },
};

function showToast(msg, ms = 4000) {
  els.toast.textContent = msg;
  els.toast.hidden = false;
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => { els.toast.hidden = true; }, ms);
}

// Pretty-prints the raw Graph error body (see graph.js) when it's JSON.
function errorDump(err) {
  if (!err.body) return err.message || String(err);
  try {
    return `${err.message}\n${JSON.stringify(JSON.parse(err.body), null, 2)}`;
  } catch {
    return `${err.message}\n${err.body}`;
  }
}

function formatBytes(n) {
  if (n == null) return "";
  if (n === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

function formatDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: sameYear ? undefined : "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// Extracts a YYYY-MM-DD prefix from a filename and returns it as a string,
// or null if the prefix is missing or doesn't represent a valid calendar date.
function parseReferenceDate(name) {
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
function displayName(name) {
  let s = name;
  if (parseReferenceDate(s) && s[10] === "_") {
    const stripped = s.slice(11);
    if (stripped.length > 0) s = stripped;
  }
  const i = s.indexOf("_");
  if (i > 0) s = s.slice(0, i);
  return s;
}

const FOLDER_ICON = "📁";
function fileIcon(item) {
  if (item.folder) return FOLDER_ICON;
  const name = item.name.toLowerCase();
  const ext = name.includes(".") ? name.split(".").pop() : "";
  if (["png","jpg","jpeg","gif","webp","bmp","svg","avif"].includes(ext)) return "🖼️";
  if (["mp4","webm","ogv","mov","m4v","avi","mkv"].includes(ext)) return "🎬";
  if (["mp3","wav","ogg","m4a","flac","aac"].includes(ext)) return "🎵";
  if (ext === "pdf") return "📕";
  if (["doc","docx","odt","rtf"].includes(ext)) return "📝";
  if (["xls","xlsx","csv","ods"].includes(ext)) return "📊";
  if (["ppt","pptx","odp"].includes(ext)) return "📽️";
  if (["zip","rar","7z","tar","gz","bz2","xz"].includes(ext)) return "🗜️";
  if (["js","ts","py","rb","go","rs","java","c","cpp","cs","html","css","json","xml","sh"].includes(ext)) return "📜";
  if (["md","markdown","txt","log"].includes(ext)) return "📄";
  return "📄";
}

function renderListing() {
  els.listing.replaceChildren();
  // Items arrive pre-sorted from Graph via $orderby; preserve that order so
  // pagination is stable as more pages stream in.
  const sorted = state.items;

  if (sorted.length === 0) {
    const empty = document.createElement("li");
    empty.className = "empty";
    empty.textContent = state.searchQuery ? "No matching files." : "This folder is empty.";
    els.listing.appendChild(empty);
    return;
  }

  const head = document.createElement("li");
  head.className = "row head";
  head.innerHTML = `<span></span><span>Name</span><span>Reference</span>`;
  els.listing.appendChild(head);

  for (const item of sorted) {
    const li = document.createElement("li");
    li.className = "row" + (item.id === state.selectedId ? " selected" : "");
    li.dataset.id = item.id;
    li.innerHTML = `
      <span class="icon">${fileIcon(item)}</span>
      <span class="name"></span>
      <span class="meta-ref">${parseReferenceDate(item.name) ?? ""}</span>
    `;
    li.querySelector(".name").textContent = displayName(item.name);
    li.addEventListener("click", () => onItemClick(item));
    li.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onItemClick(item); }
    });
    li.tabIndex = 0;
    els.listing.appendChild(li);
  }
}

function renderBreadcrumbs() {
  els.breadcrumbs.replaceChildren();
  const crumbs = [{ id: null, name: "OneDrive" }, ...state.stack];
  crumbs.forEach((c, i) => {
    if (i > 0) {
      const sep = document.createElement("span");
      sep.className = "sep";
      sep.textContent = "›";
      els.breadcrumbs.appendChild(sep);
    }
    if (i === crumbs.length - 1) {
      const span = document.createElement("span");
      span.textContent = c.name;
      els.breadcrumbs.appendChild(span);
    } else {
      const link = document.createElement("a");
      link.className = "crumb";
      link.textContent = c.name;
      link.href = "#";
      link.addEventListener("click", (e) => {
        e.preventDefault();
        navigateToDepth(i);
      });
      els.breadcrumbs.appendChild(link);
    }
  });
}

function setStatus(text) {
  els.status.textContent = text;
}

function currentFolderPath() {
  return "/" + state.stack.map((f) => f.name).join("/");
}

function openNewFolderDialog() {
  els.newFolderPath.textContent = currentFolderPath();
  els.newFolderName.value = "";
  els.newFolderCreate.disabled = false;
  els.newFolderDialog.showModal();
  els.newFolderName.focus();
}

async function createFolder() {
  const name = els.newFolderName.value.trim();
  if (!name) return;
  const folder = state.stack[state.stack.length - 1];
  els.newFolderCreate.disabled = true;
  try {
    await graph.createFolder(folder ? folder.id : null, name);
  } catch (err) {
    // Close first: a modal <dialog> sits in the top layer and would cover
    // the toast behind its backdrop.
    els.newFolderDialog.close();
    showToast(`Failed to create folder "${name}":\n${errorDump(err)}`, 15000);
    return;
  }
  els.newFolderDialog.close();
  await loadCurrent();
}

// A folder can only be deleted when it is empty: no files, no subfolders.
// The root can't be deleted, and while loading or showing search results the
// listing doesn't reflect the current folder's contents, so stay disabled.
function updateDeleteFolderBtn() {
  els.deleteFolderBtn.disabled =
    state.stack.length === 0 ||
    state.loading ||
    !!state.searchQuery ||
    state.items.length > 0 ||
    !!state.nextLink;
}

function openDeleteFolderDialog() {
  if (els.deleteFolderBtn.disabled) return;
  els.deleteFolderPath.textContent = currentFolderPath();
  els.deleteFolderConfirm.disabled = false;
  els.deleteFolderDialog.showModal();
}

async function deleteFolder() {
  const folder = state.stack[state.stack.length - 1];
  if (!folder) return;
  const path = currentFolderPath();
  els.deleteFolderConfirm.disabled = true;
  try {
    await graph.deleteEmptyFolder(folder.id);
  } catch (err) {
    // Close first: a modal <dialog> sits in the top layer and would cover
    // the toast behind its backdrop.
    els.deleteFolderDialog.close();
    showToast(`Failed to delete folder "${path}":\n${errorDump(err)}`, 15000);
    return;
  }
  els.deleteFolderDialog.close();
  state.stack.pop();
  await loadCurrent();
}

function openUploadDialog() {
  state.upload = {
    folder: state.stack[state.stack.length - 1] || null,
    files: [],
    results: new Map(),
    phase: "select",
  };
  els.uploadPath.textContent = currentFolderPath();
  els.uploadInput.value = "";
  renderUploadDialog();
  els.uploadDialog.showModal();
}

const UPLOAD_STATUS = {
  uploading: { cls: "progress", label: "Uploading", text: "" },
  success: { cls: "success", label: "Uploaded", text: "✓" },
  failed: { cls: "failed", label: "Upload failed", text: "✗" },
};

function renderUploadDialog() {
  const { files, results, phase } = state.upload;
  els.uploadList.replaceChildren();
  for (const file of files) {
    const li = document.createElement("li");
    const name = document.createElement("span");
    name.className = "upload-name";
    name.textContent = file.name;
    li.appendChild(name);

    if (phase === "select") {
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "upload-remove";
      remove.textContent = "✕";
      remove.setAttribute("aria-label", `Remove ${file.name}`);
      remove.title = "Remove";
      remove.addEventListener("click", () => {
        state.upload.files = state.upload.files.filter((f) => f !== file);
        renderUploadDialog();
      });
      li.appendChild(remove);
    } else {
      const result = results.get(file.name) || { status: "uploading" };
      const s = UPLOAD_STATUS[result.status];
      const icon = document.createElement("span");
      icon.className = `upload-status ${s.cls}`;
      icon.setAttribute("role", "img");
      icon.setAttribute("aria-label", s.label);
      icon.title = result.error ? `${s.label}: ${result.error}` : s.label;
      icon.textContent = s.text;
      li.appendChild(icon);
    }
    els.uploadList.appendChild(li);
  }

  const editable = phase === "select";
  els.uploadSelect.disabled = !editable;
  els.uploadCancel.disabled = !editable;
  els.uploadStart.disabled = !editable || files.length === 0;
  els.uploadStart.hidden = phase === "done";
  els.uploadClose.hidden = phase !== "done";
}

function addUploadFiles(fileList) {
  if (state.upload.phase !== "select") return;
  state.upload.files = mergeFiles(state.upload.files, fileList);
  // Reset so picking the same file again still fires "change".
  els.uploadInput.value = "";
  renderUploadDialog();
}

// Uploads a few files at a time; each one reports success or failure on its
// own, so one rejected file doesn't stop the rest.
const UPLOAD_CONCURRENCY = 3;

async function startUpload() {
  const upload = state.upload;
  if (upload.phase !== "select" || upload.files.length === 0) return;
  upload.phase = "uploading";
  renderUploadDialog();

  const queue = upload.files.slice();
  const worker = async () => {
    while (queue.length) {
      const file = queue.shift();
      try {
        await graph.uploadFile(upload.folder ? upload.folder.id : null, file);
        upload.results.set(file.name, { status: "success" });
      } catch (err) {
        upload.results.set(file.name, { status: "failed", error: errorDump(err) });
      }
      if (state.upload === upload) renderUploadDialog();
    }
  };
  await Promise.all(Array.from({ length: Math.min(UPLOAD_CONCURRENCY, queue.length) }, worker));

  upload.phase = "done";
  if (state.upload !== upload) return;
  renderUploadDialog();
  if (els.uploadDialog.open) {
    els.uploadClose.focus();
  } else {
    // Chrome lets a repeated Escape bypass the cancel guard; the dialog is
    // already gone, so refresh here instead of on Close.
    loadCurrent();
  }
}

function onItemClick(item) {
  if (item.folder) {
    state.stack.push({ id: item.id, name: item.name });
    loadCurrent();
  } else {
    selectItem(item);
  }
}

function selectItem(item) {
  if (state.selectedId === item.id) return;
  const prev = els.listing.querySelector(".row.selected");
  if (prev) prev.classList.remove("selected");
  const next = els.listing.querySelector(`.row[data-id="${CSS.escape(item.id)}"]`);
  if (next) next.classList.add("selected");
  state.selectedId = item.id;
  viewer.open(item);
}

function navigateToDepth(depth) {
  // depth 0 = root; trim stack so its length equals depth.
  state.stack = state.stack.slice(0, depth);
  loadCurrent();
}

async function loadCurrent() {
  state.searchQuery = "";
  els.search.value = "";
  state.selectedId = null;
  viewer.clear();
  const id = ++state.loadId;
  state.loading = true;
  updateDeleteFolderBtn();
  els.loading.hidden = false;
  els.loadMore.hidden = true;
  setStatus("");
  renderBreadcrumbs();

  try {
    const folder = state.stack[state.stack.length - 1];
    const page = await graph.listChildren(folder ? folder.id : null, state.sort);
    if (id !== state.loadId) return;
    state.items = page.value || [];
    state.nextLink = page["@odata.nextLink"] || null;
    renderListing();
    els.loadMore.hidden = !state.nextLink;
    setStatus(`${state.items.length} item${state.items.length === 1 ? "" : "s"}${state.nextLink ? "+" : ""}`);
  } catch (err) {
    if (id !== state.loadId) return;
    showToast(err.message || "Failed to load folder");
    state.items = [];
    state.nextLink = null;
    renderListing();
  } finally {
    if (id === state.loadId) {
      els.loading.hidden = true;
      state.loading = false;
      updateDeleteFolderBtn();
    }
  }
  pushNavHash();
}

async function loadMore() {
  if (!state.nextLink) return;
  const id = state.loadId;
  els.loadMore.disabled = true;
  try {
    const page = await graph.listNextPage(state.nextLink);
    if (id !== state.loadId) return;
    state.items = state.items.concat(page.value || []);
    state.nextLink = page["@odata.nextLink"] || null;
    renderListing();
    els.loadMore.hidden = !state.nextLink;
    setStatus(`${state.items.length} item${state.items.length === 1 ? "" : "s"}${state.nextLink ? "+" : ""}`);
  } catch (err) {
    showToast(err.message || "Failed to load more");
  } finally {
    els.loadMore.disabled = false;
  }
}

async function runSearch(query) {
  const id = ++state.loadId;
  state.searchQuery = query;
  state.selectedId = null;
  state.loading = true;
  updateDeleteFolderBtn();
  viewer.clear();
  els.loading.hidden = false;
  els.loadMore.hidden = true;
  setStatus("");
  // Clear breadcrumbs visually to a search view.
  els.breadcrumbs.replaceChildren(Object.assign(document.createElement("span"), {
    textContent: `Search: “${query}”`,
  }));

  try {
    const page = await graph.search(query, state.sort);
    if (id !== state.loadId) return;
    state.items = page.value || [];
    state.nextLink = page["@odata.nextLink"] || null;
    renderListing();
    els.loadMore.hidden = !state.nextLink;
    setStatus(`${state.items.length} match${state.items.length === 1 ? "" : "es"}${state.nextLink ? "+" : ""}`);
  } catch (err) {
    if (id !== state.loadId) return;
    showToast(err.message || "Search failed");
  } finally {
    if (id === state.loadId) {
      els.loading.hidden = true;
      state.loading = false;
      updateDeleteFolderBtn();
    }
  }
}

function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

async function showSignedIn(account) {
  els.signedOut.hidden = true;
  els.browser.hidden = false;
  els.user.hidden = false;
  els.user.textContent = account.username || account.name || "";
  els.authBtn.textContent = "Sign out";
  state.stack = [];
  // Restore folder navigation from URL hash if present.
  const hashStack = decodeNavHash(window.location.hash);
  if (hashStack.length > 0) {
    await restoreFromHash();
  } else {
    await loadCurrent();
  }
}

function showSignedOut() {
  els.signedOut.hidden = false;
  els.browser.hidden = true;
  els.user.hidden = true;
  els.user.textContent = "";
  els.authBtn.textContent = "Sign in";
}

async function handleSignIn() {
  if (!isConfigured()) {
    els.configHint.hidden = false;
    showToast("Set your Azure clientId in config.js");
    return;
  }
  try {
    const account = await auth.signIn();
    if (account) await showSignedIn(account);
  } catch (err) {
    showToast(err.message || "Sign-in failed");
  }
}

async function handleSignOut() {
  try {
    await auth.signOut();
  } catch (err) {
    showToast(err.message || "Sign-out failed");
  } finally {
    showSignedOut();
  }
}

function wireEvents() {
  els.signinCta.addEventListener("click", handleSignIn);
  els.authBtn.addEventListener("click", () => {
    if (auth.getAccount()) handleSignOut();
    else handleSignIn();
  });
  els.upBtn.addEventListener("click", () => {
    if (state.stack.length === 0) return;
    state.stack.pop();
    loadCurrent();
  });
  els.sort.addEventListener("change", (e) => {
    state.sort = e.target.value;
    // Re-fetch so the new $orderby is applied to the first page and propagates
    // through the @odata.nextLink for subsequent pages.
    if (state.searchQuery) runSearch(state.searchQuery);
    else loadCurrent();
  });
  els.newFolderBtn.addEventListener("click", openNewFolderDialog);
  els.newFolderCancel.addEventListener("click", () => els.newFolderDialog.close());
  els.newFolderForm.addEventListener("submit", (e) => {
    e.preventDefault();
    createFolder();
  });
  els.deleteFolderBtn.addEventListener("click", openDeleteFolderDialog);
  els.deleteFolderCancel.addEventListener("click", () => els.deleteFolderDialog.close());
  els.deleteFolderForm.addEventListener("submit", (e) => {
    e.preventDefault();
    deleteFolder();
  });
  els.uploadBtn.addEventListener("click", openUploadDialog);
  els.uploadSelect.addEventListener("click", () => els.uploadInput.click());
  els.uploadInput.addEventListener("change", () => addUploadFiles(els.uploadInput.files));
  els.uploadCancel.addEventListener("click", () => els.uploadDialog.close());
  els.uploadClose.addEventListener("click", () => els.uploadDialog.close());
  els.uploadForm.addEventListener("submit", (e) => {
    e.preventDefault();
    startUpload();
  });
  // Escape must not dismiss the dialog while it is read-only mid-upload.
  els.uploadDialog.addEventListener("cancel", (e) => {
    if (state.upload.phase === "uploading") e.preventDefault();
  });
  // Once anything was uploaded, closing (via Close or Escape) refreshes the
  // listing so the new files show up.
  els.uploadDialog.addEventListener("close", () => {
    if (state.upload.phase === "done") loadCurrent();
  });
  els.loadMore.addEventListener("click", loadMore);
  els.search.addEventListener("input", debounce((e) => {
    const q = e.target.value.trim();
    if (q.length === 0) {
      loadCurrent();
    } else if (q.length >= 2) {
      runSearch(q);
    }
  }, 300));
  initListingKeyboard();
  initSplitDivider();
  initGlobalShortcuts();
  initHashNavigation();
}

function initListingKeyboard() {
  els.listing.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    const rows = Array.from(els.listing.querySelectorAll(".row:not(.head)"));
    if (rows.length === 0) return;
    e.preventDefault();
    const current = rows.indexOf(document.activeElement);
    let next;
    if (current === -1) {
      next = rows.findIndex((r) => r.classList.contains("selected"));
      if (next === -1) next = 0;
    } else {
      next = current + (e.key === "ArrowDown" ? 1 : -1);
      next = Math.max(0, Math.min(rows.length - 1, next));
    }
    const row = rows[next];
    row.focus();
    const item = state.items.find((it) => it.id === row.dataset.id);
    if (item && !item.folder) selectItem(item);
  });
}

function initSplitDivider() {
  const divider = document.getElementById("split-divider");
  const split = document.querySelector(".split");
  if (!divider || !split) return;

  const STORAGE_KEY = "onedrive-browser:listWidth";
  const MIN_LIST = 200;
  const MIN_PREVIEW = 280;

  const apply = (px) => document.documentElement.style.setProperty("--list-width", `${px}px`);
  const clamp = (px) => {
    const max = split.getBoundingClientRect().width - MIN_PREVIEW;
    return Math.max(MIN_LIST, Math.min(max, px));
  };
  const currentWidth = () => {
    const v = parseInt(getComputedStyle(document.documentElement).getPropertyValue("--list-width"), 10);
    return Number.isFinite(v) ? v : 320;
  };

  const saved = parseInt(localStorage.getItem(STORAGE_KEY) || "", 10);
  if (Number.isFinite(saved)) apply(clamp(saved));

  let pointerId = null;
  divider.addEventListener("pointerdown", (e) => {
    pointerId = e.pointerId;
    divider.setPointerCapture(pointerId);
    divider.classList.add("dragging");
    document.body.classList.add("split-dragging");
    e.preventDefault();
  });
  divider.addEventListener("pointermove", (e) => {
    if (pointerId === null) return;
    const rect = split.getBoundingClientRect();
    apply(clamp(e.clientX - rect.left));
  });
  const endDrag = (e) => {
    if (pointerId === null) return;
    try { divider.releasePointerCapture(pointerId); } catch {}
    pointerId = null;
    divider.classList.remove("dragging");
    document.body.classList.remove("split-dragging");
    localStorage.setItem(STORAGE_KEY, String(currentWidth()));
  };
  divider.addEventListener("pointerup", endDrag);
  divider.addEventListener("pointercancel", endDrag);

  divider.addEventListener("keydown", (e) => {
    const step = e.shiftKey ? 64 : 16;
    if (e.key === "ArrowLeft") {
      apply(clamp(currentWidth() - step));
    } else if (e.key === "ArrowRight") {
      apply(clamp(currentWidth() + step));
    } else if (e.key === "Home") {
      apply(MIN_LIST);
    } else if (e.key === "End") {
      apply(clamp(split.getBoundingClientRect().width));
    } else {
      return;
    }
    localStorage.setItem(STORAGE_KEY, String(currentWidth()));
    e.preventDefault();
  });

  // Re-clamp on window resize so the list pane never crowds the preview out.
  window.addEventListener("resize", () => apply(clamp(currentWidth())));
}

// ---------------------------------------------------------------------------
// Keyboard shortcuts & help overlay
// ---------------------------------------------------------------------------
const SHORTCUTS = [
  { key: "/", description: "Focus search" },
  { key: "Escape", description: "Clear search / go up one level" },
  { key: "?", description: "Toggle keyboard shortcuts" },
  { key: "ArrowUp", description: "Previous file in list" },
  { key: "ArrowDown", description: "Next file in list" },
  { key: "Enter", description: "Open selected folder / file" },
  { key: "Backspace", description: "Go up one level" },
];

function buildShortcutsOverlay() {
  const overlay = document.createElement("div");
  overlay.id = "shortcuts-overlay";
  overlay.className = "shortcuts-overlay";
  overlay.hidden = true;
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.hidden = true;
  });

  const panel = document.createElement("div");
  panel.className = "shortcuts-panel";

  const header = document.createElement("h2");
  header.textContent = "Keyboard shortcuts";
  panel.appendChild(header);

  const list = document.createElement("dl");
  list.className = "shortcuts-list";
  for (const s of SHORTCUTS) {
    const dt = document.createElement("dt");
    const kbd = document.createElement("kbd");
    kbd.textContent = s.key;
    dt.appendChild(kbd);
    list.appendChild(dt);
    const dd = document.createElement("dd");
    dd.textContent = s.description;
    list.appendChild(dd);
  }
  panel.appendChild(list);

  const hint = document.createElement("p");
  hint.className = "shortcuts-hint";
  hint.textContent = "Press ? or Escape to close";
  panel.appendChild(hint);

  overlay.appendChild(panel);
  document.body.appendChild(overlay);
  return overlay;
}

function initGlobalShortcuts() {
  const overlay = buildShortcutsOverlay();

  document.addEventListener("keydown", (e) => {
    // Don't intercept when user is typing in an input/textarea/select.
    const tag = e.target.tagName;
    const isInput = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";

    if (e.key === "?" && !isInput) {
      e.preventDefault();
      overlay.hidden = !overlay.hidden;
      return;
    }

    if (e.key === "Escape") {
      if (!overlay.hidden) {
        overlay.hidden = true;
        e.preventDefault();
        return;
      }
      if (isInput && els.search.value) {
        els.search.value = "";
        els.search.blur();
        loadCurrent();
        e.preventDefault();
        return;
      }
      if (!isInput && state.stack.length > 0) {
        state.stack.pop();
        loadCurrent();
        e.preventDefault();
        return;
      }
    }

    if (e.key === "/" && !isInput) {
      e.preventDefault();
      els.search.focus();
      els.search.select();
      return;
    }

    if (e.key === "Backspace" && !isInput) {
      if (state.stack.length > 0) {
        e.preventDefault();
        state.stack.pop();
        loadCurrent();
      }
    }
  });
}

// ---------------------------------------------------------------------------
// URL hash-based navigation
// ---------------------------------------------------------------------------
function encodeNavHash(stack) {
  if (!stack || stack.length === 0) return "";
  return "#path=" + stack.map((s) => encodeURIComponent(s.id)).join("/");
}

function decodeNavHash(hash) {
  if (!hash || !hash.startsWith("#path=")) return [];
  const raw = hash.slice("#path=".length);
  if (!raw) return [];
  return raw.split("/").map((segment) => ({
    id: decodeURIComponent(segment),
    name: null,
  }));
}

function pushNavHash() {
  const hash = encodeNavHash(state.stack);
  const current = window.location.hash || "";
  if (hash !== current) {
    history.pushState(null, "", hash || window.location.pathname);
  }
}

async function restoreFromHash() {
  const decoded = decodeNavHash(window.location.hash);
  if (decoded.length === 0) return;
  // Resolve folder names from Graph for each level.
  const resolved = [];
  for (const entry of decoded) {
    try {
      const item = await graph.getItem(entry.id);
      resolved.push({ id: item.id, name: item.name });
    } catch {
      // If we can't resolve a folder (deleted, no access), stop here.
      break;
    }
  }
  if (resolved.length > 0) {
    state.stack = resolved;
    await loadCurrent();
  }
}

function initHashNavigation() {
  window.addEventListener("popstate", () => {
    const decoded = decodeNavHash(window.location.hash);
    // Navigating back to root when hash is empty.
    if (decoded.length === 0 && state.stack.length > 0) {
      state.stack = [];
      loadCurrent();
      return;
    }
    if (decoded.length > 0) {
      // Resolve names for the new hash state.
      (async () => {
        const resolved = [];
        for (const entry of decoded) {
          try {
            const item = await graph.getItem(entry.id);
            resolved.push({ id: item.id, name: item.name });
          } catch {
            break;
          }
        }
        if (resolved.length > 0) {
          state.stack = resolved;
          await loadCurrent();
        }
      })();
    }
  });
}

async function start() {
  wireEvents();
  if (!isConfigured()) {
    els.configHint.hidden = false;
    return;
  }
  try {
    await auth.init();
  } catch (err) {
    showToast(err.message || "Auth init failed");
    return;
  }
  const account = auth.getAccount();
  if (account) {
    try {
      await showSignedIn(account);
    } catch (err) {
      showToast(err.message || "Failed to load OneDrive");
    }
  } else {
    showSignedOut();
  }
}

start();
