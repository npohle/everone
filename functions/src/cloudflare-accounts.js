// Proxy for Cloudflare's "list accounts" endpoint:
//
//   GET https://api.cloudflare.com/client/v4/accounts
//   (https://developers.cloudflare.com/api/resources/accounts/methods/list/)
//
// Cloudflare's API sends no CORS headers, so the SPA can't call it from the
// browser. It POSTs { apiToken } here instead (optionally with the endpoint's
// name/page/perPage/direction query parameters), and Cloudflare's answer comes
// back wrapped as { status, contentType, result }, with the downstream status
// code as this response's status, too.
//
// The helpers take `fetch` as an argument so they can be unit-tested.

import { CLOUDFLARE_API, wrapCloudflareResponse } from "./cloudflare-ai-run.js";

// Payload field -> Cloudflare query parameter, in the order they're appended.
const QUERY_PARAMS = { name: "name", page: "page", perPage: "per_page", direction: "direction" };

export function cloudflareAccountsUrl(query = {}) {
  const params = new URLSearchParams();
  for (const [field, param] of Object.entries(QUERY_PARAMS)) {
    if (query[field] !== undefined) params.set(param, String(query[field]));
  }
  const search = params.toString();
  return `${CLOUDFLARE_API}/accounts${search ? `?${search}` : ""}`;
}

const nonEmptyString = (value) => typeof value === "string" && value.length > 0;
const integerIn = (value, min, max) => Number.isInteger(value) && value >= min && value <= max;

// Validators for the optional fields, with the limits Cloudflare documents.
const OPTIONAL_FIELDS = {
  name: [(value) => typeof value === "string", '"name" must be a string.'],
  page: [(value) => integerIn(value, 1, Number.MAX_SAFE_INTEGER), '"page" must be a positive integer.'],
  perPage: [(value) => integerIn(value, 5, 50), '"perPage" must be an integer from 5 to 50.'],
  direction: [(value) => value === "asc" || value === "desc", '"direction" must be "asc" or "desc".'],
};

// Validates the request payload: { ok: true, value } or { ok: false, error }.
export function parseAccountsRequest(payload) {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    return { ok: false, error: "Request body must be a JSON object." };
  }
  if (!nonEmptyString(payload.apiToken)) {
    return { ok: false, error: '"apiToken" must be a non-empty string.' };
  }
  const value = { apiToken: payload.apiToken };
  for (const [field, [isValid, message]] of Object.entries(OPTIONAL_FIELDS)) {
    if (payload[field] === undefined) continue;
    if (!isValid(payload[field])) return { ok: false, error: message };
    value[field] = payload[field];
  }
  return { ok: true, value };
}

// Calls Cloudflare and wraps its answer, whatever the status code.
export async function listCloudflareAccounts({ apiToken, ...query }, fetchImpl = globalThis.fetch) {
  const response = await fetchImpl(cloudflareAccountsUrl(query), {
    method: "GET",
    headers: { Authorization: `Bearer ${apiToken}` },
  });
  return wrapCloudflareResponse(response);
}

const error = (status, message) => ({ status, jsonBody: { error: message } });

// The Azure Functions HTTP handler, returning an HttpResponseInit.
export async function handleCloudflareAccounts(request, fetchImpl = globalThis.fetch, context) {
  let payload;
  try {
    payload = JSON.parse(await request.text());
  } catch {
    return error(400, "Request body must be valid JSON.");
  }

  const parsed = parseAccountsRequest(payload);
  if (!parsed.ok) return error(400, parsed.error);

  let wrapped;
  try {
    wrapped = await listCloudflareAccounts(parsed.value, fetchImpl);
  } catch (err) {
    // Only the message: the request (and its token) must never be logged.
    context?.error(`Cloudflare accounts list failed: ${err?.message ?? err}`);
    return error(502, "Could not reach the Cloudflare API.");
  }
  return { status: wrapped.status, jsonBody: wrapped };
}
