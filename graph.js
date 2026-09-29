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
  if (!res.ok) throw await responseError(res);
  return res;
}

// Keep the raw response body on the error so callers can surface the full
// OneDrive error payload (code, innerError, etc.), not just the message.
async function responseError(res) {
  let body = "";
  try { body = await res.text(); } catch {}
  let detail = "";
  try { detail = JSON.parse(body).error?.message || ""; } catch {}
  const err = new Error(`Graph ${res.status}: ${detail || res.statusText}`);
  err.status = res.status;
  err.body = body;
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

// Creates a folder under parentId (or the drive root when null). Uses
// conflictBehavior "fail" so an existing name surfaces as an error instead of
// being silently renamed.
export async function createFolder(parentId, name) {
  const path = parentId
    ? `/me/drive/items/${encodeURIComponent(parentId)}/children`
    : `/me/drive/root/children`;
  return graphJson(`${config.graphBase}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name,
      folder: {},
      "@microsoft.graph.conflictBehavior": "fail",
    }),
  });
}

// Deletes a folder, but only if OneDrive reports it has no children. Graph's
// DELETE is recursive, so the emptiness check is repeated here against fresh
// server state rather than trusting whatever listing the UI last rendered.
export async function deleteEmptyFolder(itemId) {
  const item = await getItem(itemId);
  if (!item.folder) throw new Error(`"${item.name}" is not a folder`);
  if (item.folder.childCount > 0) {
    throw new Error(`"${item.name}" is not empty (${item.folder.childCount} item${item.folder.childCount === 1 ? "" : "s"})`);
  }
  await graphFetch(`${config.graphBase}/me/drive/items/${encodeURIComponent(itemId)}`, {
    method: "DELETE",
  });
}

// Graph's simple upload is only recommended up to 4 MB; anything larger goes
// through an upload session in chunks. Chunk sizes must be multiples of
// 320 KiB.
const SIMPLE_UPLOAD_MAX = 4 * 1024 * 1024;
const UPLOAD_CHUNK_SIZE = 320 * 1024 * 32; // 10 MiB

// Uploads a File into parentId (or the drive root when null) under its own
// name. Uses conflictBehavior "fail" so an existing name surfaces as an error
// instead of overwriting or silently renaming.
export async function uploadFile(parentId, file) {
  const parentPath = parentId
    ? `/me/drive/items/${encodeURIComponent(parentId)}:`
    : `/me/drive/root:`;
  const itemPath = `${config.graphBase}${parentPath}/${encodeURIComponent(file.name)}:`;

  if (file.size <= SIMPLE_UPLOAD_MAX) {
    return graphJson(`${itemPath}/content?@microsoft.graph.conflictBehavior=fail`, {
      method: "PUT",
      headers: { "Content-Type": file.type || "application/octet-stream" },
      body: file,
    });
  }

  const session = await graphJson(`${itemPath}/createUploadSession`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ item: { "@microsoft.graph.conflictBehavior": "fail" } }),
  });
  let offset = 0;
  while (true) {
    const end = Math.min(offset + UPLOAD_CHUNK_SIZE, file.size);
    // The pre-authenticated uploadUrl must not receive an Authorization header.
    const res = await fetch(session.uploadUrl, {
      method: "PUT",
      headers: { "Content-Range": `bytes ${offset}-${end - 1}/${file.size}` },
      body: file.slice(offset, end),
    });
    if (!res.ok) {
      const err = await responseError(res);
      fetch(session.uploadUrl, { method: "DELETE" }).catch(() => {});
      throw err;
    }
    if (end >= file.size) return res.json();
    offset = end;
  }
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
