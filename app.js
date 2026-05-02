import { config, isConfigured } from "./config.js";
import * as auth from "./auth.js";
import * as graph from "./graph.js";
import * as viewer from "./viewer.js";

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
};

function showToast(msg) {
  els.toast.textContent = msg;
  els.toast.hidden = false;
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => { els.toast.hidden = true; }, 4000);
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
    if (id === state.loadId) els.loading.hidden = true;
  }
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
    if (id === state.loadId) els.loading.hidden = true;
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
  await loadCurrent();
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
