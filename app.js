import { config, isConfigured } from "./config.js";
import * as auth from "./auth.js";
import * as cfAuth from "./cloudflare-auth.js";
import * as graph from "./graph.js";
import * as viewer from "./viewer.js";
import * as uploadPreview from "./upload-preview.js";
import { mergeFiles, uploadNamesValid, selectionAfterRemoval, canSuggestName } from "./upload-list.js";
import { suggestFileName } from "./extract.js";
import { toFileSystemItems, parentPath, drivePath } from "./file-system-items.js";
import { mountFileSystem } from "./vendor/extend-ui/file-system.js";

const els = {
  signedOut: document.getElementById("signed-out"),
  configHint: document.getElementById("config-hint"),
  signinCta: document.getElementById("signin-cta"),
  authBtn: document.getElementById("auth-btn"),
  user: document.getElementById("user"),
  cfAuthBtn: document.getElementById("cf-auth-btn"),
  cfAccount: document.getElementById("cf-account"),
  cfAccountName: document.getElementById("cf-account-name"),
  cfAccountId: document.getElementById("cf-account-id"),
  browser: document.getElementById("browser"),
  listing: document.getElementById("listing"),
  loading: document.getElementById("loading"),
  status: document.getElementById("status"),
  search: document.getElementById("search"),
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
  uploadMessage: document.getElementById("upload-message"),
  uploadCancel: document.getElementById("upload-cancel"),
  uploadStart: document.getElementById("upload-start"),
  uploadClose: document.getElementById("upload-close"),
};

const state = {
  // The drive root's items (or the search results) the listing starts from.
  items: [],
  searchQuery: "",
  // The folder driveItem a search is limited to (null for the whole drive):
  // the folder selected when the search started.
  searchFolder: null,
  // Monotonic id; pending requests with stale ids are discarded.
  loadId: 0,
  // Currently selected file id (the one being previewed).
  selectedId: null,
  // True while the root listing or a search request is in flight.
  loading: false,
  // The folder New Folder, Delete Folder and Upload act on: the listing's
  // selected entry, when it's a folder, as { path, item } (item being its
  // driveItem).
  folder: null,
  // Upload dialog: target folder ({ path, item }) and the listing it is in, picked files, the name each file is
  // uploaded as and its result (both keyed by File), and the file shown in
  // the preview pane, plus the files whose name is being suggested by
  // Extract right now. phase is "select" (editable), "uploading" (read-only)
  // or "done".
  upload: { folder: null, listing: null, files: [], names: new Map(), results: new Map(), selected: null, suggesting: new Set(), phase: "select" },
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

// The listing is extend-ui's File System component (see extend-ui/), in its
// list view: the drive root's (or a search's) items, with folders that load
// their children when they're expanded. Rows show each name split into
// display name and reference date (file-system-items.js); clicking a file
// previews it, selecting a folder makes it the one the toolbar acts on. The
// listing never navigates: its root stays the drive's.
let listing = null;
let listingKey = 0;

// What one mounted listing knows: the root's manifest items, manifest path →
// driveItem (for the component's callbacks), the paths used so far per folder
// path (so names repeated across pages of one folder still get distinct
// paths), and the number of children each folder had when last listed. Paths
// are only unique within one listing, so every remount starts afresh (and
// drops the previous listing's lazy loads).
let listingData = newListingData();

function newListingData() {
  return { manifest: [], byPath: new Map(), taken: new Map(), childCounts: new Map() };
}

// Pass remount = false to keep the mounted listing (its expanded folders,
// its selection) while its root items change.
function renderListing(remount = true) {
  if (remount) {
    listingKey++;
    listingData = newListingData();
    listingData.manifest = addToListing(listingData, state.items, "");
    state.folder = null;
  }
  const data = listingData;
  const props = {
    key: listingKey,
    items: data.manifest,
    className: "h-full rounded-lg",
    emptyLabel: state.searchQuery ? "No matching files." : "This folder is empty.",
    defaultView: "list",
    dateColumn: "createdAt",
    onSelectionChange: (entry) => {
      if (data !== listingData) return;
      state.folder = entry && entry.kind === "folder" ? { path: entry.path, item: data.byPath.get(entry.path) } : null;
      // Clearing the selection keeps the current preview.
      if (entry && entry.kind === "file") selectItem(data.byPath.get(entry.path));
      updateFolderActions();
    },
    onFileOpen: (file) => selectItem(data.byPath.get(file.path)),
    // Replaces the component's own navigation into the folder, which would
    // make it the listing's root.
    onFolderOpen: () => {},
    loadChildren: async ({ path, cursor }) => {
      const folder = data.byPath.get(path);
      try {
        const page = cursor ? await graph.listNextPage(cursor) : await graph.listChildren(folder.id);
        const driveItems = page.value || [];
        // A first page lists the folder anew (see refreshFolder()).
        if (!cursor) {
          data.taken.delete(path);
          data.childCounts.set(path, 0);
        }
        data.childCounts.set(path, data.childCounts.get(path) + driveItems.length);
        const items = addToListing(data, driveItems, path);
        if (data === listingData) updateFolderActions();
        return { items, nextCursor: page["@odata.nextLink"] || null };
      } catch (err) {
        showToast(`Failed to load "${folder.name}": ${err.message || err}`);
        throw err;
      }
    },
  };
  if (listing) listing.render(props);
  else listing = mountFileSystem(els.listing, props);
  updateFolderActions();
}

// Maps driveItems of the folder at `parentPath` to the listing's manifest
// items.
function addToListing(data, driveItems, parentPath) {
  if (!data.taken.has(parentPath)) data.taken.set(parentPath, new Set());
  const items = toFileSystemItems(driveItems, parentPath, data.taken.get(parentPath));
  items.forEach((item, i) => data.byPath.set(item.path, driveItems[i]));
  return items;
}

// Lists a folder of the listing `data` anew after its children changed, and
// opens it. Failures were already reported by loadChildren.
async function refreshFolder(path, data = listingData) {
  if (data !== listingData) return;
  try {
    await listing.reloadFolder(path);
  } catch {}
}

// A folder's number of items: as listed last, else as its driveItem says.
function folderItemCount(folder) {
  return listingData.childCounts.get(folder.path) ?? folder.item.folder?.childCount ?? 0;
}

// New Folder, Delete Folder and Upload act on the folder selected in the
// listing, so they're only enabled while there is one (and the listing isn't
// being replaced). A folder can only be deleted when it is empty: no files,
// no subfolders.
function updateFolderActions() {
  const folder = state.loading ? null : state.folder;
  els.newFolderBtn.disabled = !folder;
  els.uploadBtn.disabled = !folder;
  els.deleteFolderBtn.disabled = !folder || folderItemCount(folder) > 0;
  updateStatus();
}

// The selected folder's number of items, else the listing's.
function updateStatus() {
  if (state.loading) {
    setStatus("");
  } else if (state.searchQuery) {
    setStatus(`${state.items.length} match${state.items.length === 1 ? "" : "es"}`);
  } else {
    const n = state.folder ? folderItemCount(state.folder) : listingData.manifest.length;
    setStatus(`${n} item${n === 1 ? "" : "s"}`);
  }
}

function setStatus(text) {
  els.status.textContent = text;
}

// The OneDrive path of the selected folder.
function folderDrivePath(folder) {
  return drivePath(folder.path, listingData.byPath);
}

function openNewFolderDialog() {
  if (!state.folder) return;
  els.newFolderPath.textContent = folderDrivePath(state.folder);
  els.newFolderName.value = "";
  els.newFolderCreate.disabled = false;
  els.newFolderDialog.showModal();
  els.newFolderName.focus();
}

async function createFolder() {
  const name = els.newFolderName.value.trim();
  const folder = state.folder;
  if (!name || !folder) return;
  const data = listingData;
  els.newFolderCreate.disabled = true;
  try {
    await graph.createFolder(folder.item.id, name);
  } catch (err) {
    // Close first: a modal <dialog> sits in the top layer and would cover
    // the toast behind its backdrop.
    els.newFolderDialog.close();
    showToast(`Failed to create folder "${name}":\n${errorDump(err)}`, 15000);
    return;
  }
  els.newFolderDialog.close();
  await refreshFolder(folder.path, data);
}

function openDeleteFolderDialog() {
  if (els.deleteFolderBtn.disabled || !state.folder) return;
  els.deleteFolderPath.textContent = folderDrivePath(state.folder);
  els.deleteFolderConfirm.disabled = false;
  els.deleteFolderDialog.showModal();
}

// Once deleted, the folder's parent is selected instead (nothing at the
// root).
async function deleteFolder() {
  const folder = state.folder;
  if (!folder) return;
  const data = listingData;
  const path = folderDrivePath(folder);
  els.deleteFolderConfirm.disabled = true;
  try {
    await graph.deleteEmptyFolder(folder.item.id);
  } catch (err) {
    // Close first: a modal <dialog> sits in the top layer and would cover
    // the toast behind its backdrop.
    els.deleteFolderDialog.close();
    showToast(`Failed to delete folder "${path}":\n${errorDump(err)}`, 15000);
    return;
  }
  els.deleteFolderDialog.close();
  if (data !== listingData) return;
  const parent = parentPath(folder.path);
  if (parent) {
    await refreshFolder(parent, data);
  } else {
    // The root's items are the listing's own: drop the folder from them.
    data.manifest = data.manifest.filter((item) => item.path !== folder.path);
    renderListing(false);
  }
  if (data === listingData) listing.select(parent || null);
}

function openUploadDialog() {
  if (!state.folder) return;
  state.upload = {
    folder: state.folder,
    listing: listingData,
    files: [],
    names: new Map(),
    results: new Map(),
    selected: null,
    suggesting: new Set(),
    phase: "select",
  };
  els.uploadPath.textContent = folderDrivePath(state.folder);
  els.uploadInput.value = "";
  els.uploadMessage.textContent = "";
  uploadPreview.clear();
  renderUploadDialog();
  els.uploadDialog.showModal();
}

const UPLOAD_STATUS = {
  uploading: { cls: "progress", label: "Uploading", text: "" },
  success: { cls: "success", label: "Uploaded", text: "✓" },
  failed: { cls: "failed", label: "Upload failed", text: "✗" },
};

function uploadName(file) {
  return state.upload.names.get(file) ?? file.name;
}

function renderUploadDialog() {
  const { files, results, phase } = state.upload;
  els.uploadList.replaceChildren();
  for (const file of files) {
    const li = document.createElement("li");
    // Clicking a row (other than its remove button) previews that file.
    li.addEventListener("click", (e) => {
      if (!e.target.closest(".upload-remove")) selectUploadFile(file);
    });
    const name = document.createElement("span");
    name.className = "upload-name";
    name.textContent = file.name;
    name.title = file.name;
    li.appendChild(name);

    // Updated in place rather than re-rendered, so typing keeps focus.
    const rename = document.createElement("input");
    rename.type = "text";
    rename.className = "upload-rename";
    rename.value = uploadName(file);
    rename.disabled = phase !== "select";
    rename.spellcheck = false;
    rename.setAttribute("aria-label", `Upload ${file.name} as`);
    rename.addEventListener("input", () => {
      state.upload.names.set(file, rename.value);
      updateUploadStart();
    });
    // Renaming a file shows it, so its content can guide the new name.
    rename.addEventListener("focus", () => selectUploadFile(file));
    li.appendChild(rename);

    if (phase === "select") {
      li.appendChild(suggestButton(file));

      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "upload-remove ghost icon";
      remove.textContent = "✕";
      remove.setAttribute("aria-label", `Remove ${file.name}`);
      remove.title = "Remove";
      remove.addEventListener("click", () => {
        state.upload.selected = selectionAfterRemoval(state.upload.files, file, state.upload.selected);
        state.upload.files = state.upload.files.filter((f) => f !== file);
        state.upload.names.delete(file);
        renderUploadDialog();
      });
      li.appendChild(remove);
    } else {
      const result = results.get(file) || { status: "uploading" };
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
  showUploadSelection();

  const editable = phase === "select";
  els.uploadSelect.disabled = !editable;
  els.uploadCancel.disabled = !editable;
  updateUploadStart();
  els.uploadStart.hidden = phase === "done";
  els.uploadClose.hidden = phase !== "done";
}

function selectUploadFile(file) {
  if (state.upload.selected === file) return;
  state.upload.selected = file;
  showUploadSelection();
}

// Highlights the selected row in place (re-rendering would steal focus from
// a name input) and shows the file in the preview pane.
function showUploadSelection() {
  const { files, selected } = state.upload;
  Array.from(els.uploadList.children).forEach((li, i) => {
    const isSelected = files[i] === selected;
    li.classList.toggle("selected", isSelected);
    if (isSelected) li.setAttribute("aria-current", "true");
    else li.removeAttribute("aria-current");
  });
  // Uploads can still finish after an Escape closed the dialog; don't load
  // a preview nobody sees.
  if (selected && els.uploadDialog.open) uploadPreview.show(selected);
  else uploadPreview.clear();
}

function updateUploadStart() {
  const { files, phase } = state.upload;
  els.uploadStart.disabled = phase !== "select" || !uploadNamesValid(files.map(uploadName));
}

function addUploadFiles(fileList) {
  if (state.upload.phase !== "select") return;
  const before = state.upload.files.length;
  state.upload.files = mergeFiles(state.upload.files, fileList);
  // Preview the first newly picked file.
  if (state.upload.files.length > before) state.upload.selected = state.upload.files[before];
  // Reset so picking the same file again still fires "change".
  els.uploadInput.value = "";
  renderUploadDialog();
}

// The magic wand that suggests a name for `file`; only PDFs can be read.
function suggestButton(file) {
  const suggest = document.createElement("button");
  suggest.type = "button";
  suggest.className = "upload-suggest ghost icon";
  suggest.textContent = "🪄";
  suggest.setAttribute("aria-label", `Suggest a name for ${file.name}`);
  if (!canSuggestName(file)) {
    suggest.disabled = true;
    suggest.title = "Names can only be suggested for PDFs";
  } else if (state.upload.suggesting.has(file)) {
    suggest.disabled = true;
    suggest.classList.add("busy");
    suggest.setAttribute("aria-busy", "true");
    suggest.title = "Suggesting a name…";
  } else {
    suggest.title = "Suggest a name from the document's creation date, sender and subject";
  }
  suggest.addEventListener("click", () => suggestUploadName(file));
  return suggest;
}

// Swaps a row's wand for a fresh one in place: re-rendering the whole list
// would steal focus from a name input being typed in.
function updateSuggestButton(file) {
  const li = els.uploadList.children[state.upload.files.indexOf(file)];
  const old = li && li.querySelector(".upload-suggest");
  if (old) old.replaceWith(suggestButton(file));
}

// Fills a file's name input with <creation_date>_<sender>-<subject>.pdf, read
// from its first page by Extract (see viewer.js). The result itself isn't
// shown. Problems are reported inside the dialog: a toast would sit behind it.
async function suggestUploadName(file) {
  const upload = state.upload;
  if (upload.phase !== "select" || upload.suggesting.has(file) || !canSuggestName(file)) return;
  if (!cfAuth.isSignedIn()) {
    els.uploadMessage.textContent = "Sign in to Cloudflare to suggest file names.";
    return;
  }
  els.uploadMessage.textContent = "";
  upload.suggesting.add(file);
  updateSuggestButton(file);
  let name = null;
  let problem = "";
  try {
    name = suggestFileName(await viewer.extractFields(file.arrayBuffer()));
    if (!name) problem = `No creation date, sender or subject found in ${file.name}.`;
  } catch (err) {
    console.error("Name suggestion failed", err);
    problem = `Couldn't suggest a name for ${file.name}: ${(err && err.message) || "Unknown error"}`;
  }
  upload.suggesting.delete(file);
  // The dialog may have been reopened, the file removed or the upload
  // started in the meantime.
  if (state.upload !== upload || upload.phase !== "select" || !upload.files.includes(file)) return;
  updateSuggestButton(file);
  if (problem) els.uploadMessage.textContent = problem;
  if (!name) return;
  upload.names.set(file, name);
  const rename = els.uploadList.children[upload.files.indexOf(file)].querySelector(".upload-rename");
  rename.value = name;
  updateUploadStart();
}

// Uploads a few files at a time; each one reports success or failure on its
// own, so one rejected file doesn't stop the rest.
const UPLOAD_CONCURRENCY = 3;

async function startUpload() {
  const upload = state.upload;
  if (upload.phase !== "select" || !uploadNamesValid(upload.files.map(uploadName))) return;
  upload.phase = "uploading";
  els.uploadMessage.textContent = "";
  renderUploadDialog();

  const queue = upload.files.map((file) => ({ file, name: uploadName(file).trim() }));
  const worker = async () => {
    while (queue.length) {
      const { file, name } = queue.shift();
      try {
        await graph.uploadFile(upload.folder.item.id, file, name);
        upload.results.set(file, { status: "success" });
      } catch (err) {
        upload.results.set(file, { status: "failed", error: errorDump(err) });
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
    refreshFolder(upload.folder.path, upload.listing);
  }
}

function selectItem(item) {
  if (!item || state.selectedId === item.id) return;
  state.selectedId = item.id;
  viewer.open(item);
}

// Lists the drive's root afresh, leaving any search.
async function loadRoot() {
  state.searchQuery = "";
  state.searchFolder = null;
  els.search.value = "";
  state.selectedId = null;
  viewer.clear();
  const id = ++state.loadId;
  state.loading = true;
  updateFolderActions();
  els.loading.hidden = false;

  try {
    const items = await listAll(id, graph.listChildren(null));
    if (id !== state.loadId) return;
    state.items = items;
    renderListing();
  } catch (err) {
    if (id !== state.loadId) return;
    showToast(err.message || "Failed to load folder");
    state.items = [];
    renderListing();
  } finally {
    if (id === state.loadId) {
      els.loading.hidden = true;
      state.loading = false;
      updateFolderActions();
    }
  }
}

// Follows a listing's @odata.nextLink through every page, so the listing
// shows all of a folder's items. Returns null once load `id` is stale.
async function listAll(id, firstPage) {
  let page = await firstPage;
  let items = page.value || [];
  while (page["@odata.nextLink"]) {
    if (id !== state.loadId) return null;
    page = await graph.listNextPage(page["@odata.nextLink"]);
    items = items.concat(page.value || []);
  }
  return items;
}

async function runSearch(query) {
  // The search is limited to the folder selected in the listing when it
  // started (the whole drive when none is); refining the query keeps that.
  if (!state.searchQuery) {
    state.searchFolder = state.folder ? state.folder.item : null;
  }
  const id = ++state.loadId;
  state.searchQuery = query;
  state.selectedId = null;
  state.loading = true;
  updateFolderActions();
  viewer.clear();
  els.loading.hidden = false;

  try {
    const folder = state.searchFolder;
    const items = await listAll(id, graph.search(query, undefined, folder ? folder.id : null));
    if (id !== state.loadId) return;
    state.items = items;
    renderListing();
  } catch (err) {
    if (id !== state.loadId) return;
    showToast(err.message || "Search failed");
    state.items = [];
    renderListing();
  } finally {
    if (id === state.loadId) {
      els.loading.hidden = true;
      state.loading = false;
      updateFolderActions();
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
  setAuthButton(els.authBtn, "OneDrive", true);
  await loadRoot();
}

function showSignedOut() {
  els.signedOut.hidden = false;
  els.browser.hidden = true;
  els.user.hidden = true;
  els.user.textContent = "";
  setAuthButton(els.authBtn, "OneDrive", false);
}

// Header buttons read just "Sign in" / "Sign out" next to their provider's
// label; the accessible name spells out which sign-in they belong to.
function setAuthButton(btn, provider, signedIn) {
  btn.textContent = signedIn ? "Sign out" : "Sign in";
  btn.setAttribute("aria-label", signedIn ? `Sign out of ${provider}` : `Sign in to ${provider}`);
}

// The Cloudflare sign-in is independent of the OneDrive one above: either can
// be signed in or out without affecting the other.
//
// Once signed in, the header also shows the name and ID of the first
// Cloudflare account the user has access to.
let cfAccountRequest = 0;

function renderCloudflare() {
  const signedIn = cfAuth.isSignedIn();
  setAuthButton(els.cfAuthBtn, "Cloudflare", signedIn);
  showCloudflareAccount(null);
  const request = ++cfAccountRequest;
  if (!signedIn) return;
  cfAuth
    .fetchFirstAccount(cfAuth.getToken())
    .then((account) => {
      // Ignore a response that arrives after a sign-out (or a newer request).
      if (request === cfAccountRequest && account) showCloudflareAccount(account);
    })
    .catch((e) => {
      if (request === cfAccountRequest) showToast(`Couldn't load Cloudflare account: ${e.message || e}`);
    });
}

function showCloudflareAccount(account) {
  els.cfAccount.hidden = !account;
  els.cfAccountName.textContent = account ? account.name : "";
  els.cfAccountId.textContent = account ? account.id : "";
  els.cfAccount.title = account ? cfAuth.formatAccount(account) : "";
}

function handleCloudflareAuth() {
  if (cfAuth.isSignedIn()) {
    cfAuth.signOut();
    renderCloudflare();
  } else {
    // Navigates away to Cloudflare; callback/ redeems the code and returns.
    cfAuth.signIn().catch((e) => showToast(`Cloudflare sign-in failed: ${e.message || e}`));
  }
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
  els.cfAuthBtn.addEventListener("click", handleCloudflareAuth);
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
    uploadPreview.clear();
    if (state.upload.phase === "done") refreshFolder(state.upload.folder.path, state.upload.listing);
  });
  els.search.addEventListener("input", debounce((e) => {
    const q = e.target.value.trim();
    if (q.length === 0) {
      loadRoot();
    } else if (q.length >= 2) {
      runSearch(q);
    }
  }, 300));
  initSplitDivider();
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
    return Number.isFinite(v) ? v : 560;
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

async function start() {
  wireEvents();
  // callback/ completes the Cloudflare sign-in on its own page and leaves
  // only a failure, if any, behind; the two sign-ins never share state.
  const cfError = cfAuth.takeError();
  if (cfError) showToast(cfError);
  renderCloudflare();
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
