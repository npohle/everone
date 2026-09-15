import { config } from "./config.js";
import { getToken } from "./auth.js";

async function graphFetch(url, init = {}) {
  const token = await getToken();
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      ...(init.headers || {}),
    },
  });
  if (!res.ok) throw await graphError(res);
  return res;
}

// Builds an Error carrying the HTTP status and the Graph error code alongside
// the message, so callers can react to specific failures (e.g. a
// `nameAlreadyExists` 409 from an upload) without string matching.
async function graphError(res) {
  let detail = "";
  let code = "";
  try {
    const body = await res.json();
    detail = body.error?.message || "";
    code = body.error?.code || "";
  } catch {}
  const err = new Error(`Graph ${res.status}: ${detail || res.statusText}`);
  err.status = res.status;
  err.code = code;
  return err;
}

async function graphJson(url, init) {
  const res = await graphFetch(url, init);
  return res.json();
}

export async function getMe() {
  return graphJson(`${config.graphBase}/me`);
}

const SELECT = "id,name,size,folder,file,parentReference,lastModifiedDateTime,webUrl,@microsoft.graph.downloadUrl";

// Maps the UI sort key to a Graph $orderby clause. Graph supports orderby on
// driveItem children for personal OneDrive (name, lastModifiedDateTime, size).
const ORDER_BY = {
  "name-asc": "name asc",
  "name-desc": "name desc",
  "modified-asc": "lastModifiedDateTime asc",
  "modified-desc": "lastModifiedDateTime desc",
  "size-asc": "size asc",
  "size-desc": "size desc",
};

function orderByParam(sort) {
  const clause = ORDER_BY[sort];
  return clause ? `&$orderby=${encodeURIComponent(clause)}` : "";
}

export async function listChildren(itemId, sort) {
  const path = itemId
    ? `/me/drive/items/${encodeURIComponent(itemId)}/children`
    : `/me/drive/root/children`;
  const url = `${config.graphBase}${path}?$top=${config.pageSize}&$select=${SELECT}${orderByParam(sort)}`;
  return graphJson(url);
}

export async function listNextPage(nextLink) {
  return graphJson(nextLink);
}

export async function getItem(itemId) {
  const url = `${config.graphBase}/me/drive/items/${encodeURIComponent(itemId)}?$select=${SELECT}`;
  return graphJson(url);
}

export async function getRoot() {
  const url = `${config.graphBase}/me/drive/root?$select=${SELECT}`;
  return graphJson(url);
}

export async function search(query, sort) {
  const q = encodeURIComponent(query);
  const url = `${config.graphBase}/me/drive/root/search(q='${q}')?$top=${config.pageSize}&$select=${SELECT}${orderByParam(sort)}`;
  return graphJson(url);
}

// Returns a short-lived embeddable URL for Office docs and PDFs.
export async function getEmbedUrl(itemId) {
  const url = `${config.graphBase}/me/drive/items/${encodeURIComponent(itemId)}/preview`;
  const res = await graphFetch(url, { method: "POST" });
  const json = await res.json();
  return json.getUrl || json.postUrl || null;
}

// Streams a file's bytes from the short-lived download URL on the item.
// Falls back to /content for cases where the download URL is missing.
export async function fetchContent(item, { asText = false } = {}) {
  const directUrl = item["@microsoft.graph.downloadUrl"];
  let res;
  if (directUrl) {
    res = await fetch(directUrl);
  } else {
    res = await graphFetch(`${config.graphBase}/me/drive/items/${encodeURIComponent(item.id)}/content`);
  }
  if (!res.ok) throw new Error(`Download ${res.status}: ${res.statusText}`);
  return asText ? res.text() : res.blob();
}

// Graph takes a plain PUT up to 4 MB; anything larger has to go through a
// chunked upload session.
const SIMPLE_UPLOAD_MAX = 4 * 1024 * 1024;
// Chunk size must be a multiple of 320 KiB (Graph requirement).
const UPLOAD_CHUNK_SIZE = 5 * 320 * 1024;

// Path-addressed URL for a child name inside a folder; `parentId` null = root.
function childPath(parentId, name) {
  const child = encodeURIComponent(name);
  return parentId
    ? `/me/drive/items/${encodeURIComponent(parentId)}:/${child}:`
    : `/me/drive/root:/${child}:`;
}

// Uploads one File into the folder `parentId` (null = drive root) under its own
// name. `conflictBehavior=fail` makes Graph reject an already-taken name with a
// 409 `nameAlreadyExists` instead of silently replacing or renaming — the
// caller surfaces that as a failed upload.
export async function uploadFile(parentId, file) {
  if (file.size > SIMPLE_UPLOAD_MAX) return uploadLargeFile(parentId, file);
  const url = `${config.graphBase}${childPath(parentId, file.name)}/content?@microsoft.graph.conflictBehavior=fail`;
  return graphJson(url, {
    method: "PUT",
    headers: { "Content-Type": file.type || "application/octet-stream" },
    body: file,
  });
}

async function uploadLargeFile(parentId, file) {
  const session = await graphJson(
    `${config.graphBase}${childPath(parentId, file.name)}/createUploadSession`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ item: { "@microsoft.graph.conflictBehavior": "fail" } }),
    },
  );

  let created = null;
  for (let start = 0; start < file.size; start += UPLOAD_CHUNK_SIZE) {
    const end = Math.min(start + UPLOAD_CHUNK_SIZE, file.size);
    // The upload URL is pre-authenticated — sending a bearer token with it is
    // rejected, so this is a bare fetch rather than graphFetch.
    const res = await fetch(session.uploadUrl, {
      method: "PUT",
      headers: { "Content-Range": `bytes ${start}-${end - 1}/${file.size}` },
      body: file.slice(start, end),
    });
    if (!res.ok) {
      // Drop the half-finished session so it doesn't linger for days.
      try { await fetch(session.uploadUrl, { method: "DELETE" }); } catch {}
      throw await graphError(res);
    }
    // The last chunk answers 200/201 with the finished driveItem.
    if (res.status === 200 || res.status === 201) created = await res.json();
  }
  return created;
}
