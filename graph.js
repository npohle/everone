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
  if (!res.ok) {
    let detail = "";
    try { detail = (await res.json()).error?.message || ""; } catch {}
    throw new Error(`Graph ${res.status}: ${detail || res.statusText}`);
  }
  return res;
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
