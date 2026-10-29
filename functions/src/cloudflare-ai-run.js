// Proxy for Cloudflare Workers AI's "run model" endpoint:
//
//   POST https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/run/{model_name}
//   (https://developers.cloudflare.com/api/resources/ai/methods/run/)
//
// Cloudflare's API sends no CORS headers, so the SPA can't call it from the
// browser. It POSTs { accountId, apiToken, model, body } here instead; `body`
// is forwarded as-is and Cloudflare's answer comes back wrapped as
// { status, contentType, result } (plus encoding: "base64" for binary
// results), with the downstream status code as this response's status, too.
//
// The helpers take `fetch` as an argument so they can be unit-tested.

export const CLOUDFLARE_API = "https://api.cloudflare.com/client/v4";

// Cloudflare account IDs are 32 hex characters; this is a little looser but
// never lets a "/" or "." through into the path.
const ACCOUNT_ID = /^[A-Za-z0-9_-]+$/;

// Model names contain slashes (e.g. "@cf/meta/llama-3.1-8b-instruct"), which
// must stay path separators, so each segment is encoded on its own ("@" is
// legal in a path segment and kept as-is, matching Cloudflare's docs).
const encodeSegment = (segment) => encodeURIComponent(segment).replace(/%40/g, "@");

export function cloudflareAiRunUrl(accountId, model) {
  const modelPath = model.split("/").map(encodeSegment).join("/");
  return `${CLOUDFLARE_API}/accounts/${encodeURIComponent(accountId)}/ai/run/${modelPath}`;
}

const nonEmptyString = (value) => typeof value === "string" && value.length > 0;

// Validates the request payload: { ok: true, value } or { ok: false, error }.
export function parseRunRequest(payload) {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    return { ok: false, error: "Request body must be a JSON object." };
  }
  for (const field of ["accountId", "apiToken", "model"]) {
    if (!nonEmptyString(payload[field])) {
      return { ok: false, error: `"${field}" must be a non-empty string.` };
    }
  }
  if (!ACCOUNT_ID.test(payload.accountId)) {
    return { ok: false, error: '"accountId" is not a valid Cloudflare account ID.' };
  }
  if (payload.model.split("/").some((segment) => segment === "" || segment === "." || segment === "..")) {
    return { ok: false, error: '"model" is not a valid model name.' };
  }
  if (payload.body === undefined) {
    return { ok: false, error: '"body" is required.' };
  }
  const { accountId, apiToken, model, body } = payload;
  return { ok: true, value: { accountId, apiToken, model, body } };
}

const isJson = (contentType) => /^application\/([\w.+-]*\+)?json\b/i.test(contentType);
const isText = (contentType) => /^text\//i.test(contentType);

// Calls Cloudflare and wraps its answer, whatever the status code.
export async function runCloudflareAi({ accountId, apiToken, model, body }, fetchImpl = globalThis.fetch) {
  const response = await fetchImpl(cloudflareAiRunUrl(accountId, model), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  return wrapCloudflareResponse(response);
}

// Wraps a Cloudflare API response as { status, contentType, result } (plus
// encoding: "base64" for binary results).
export async function wrapCloudflareResponse(response) {
  const contentType = (response.headers.get("content-type") ?? "").split(";")[0].trim();
  const wrapped = { status: response.status, contentType };
  if (isJson(contentType)) {
    const text = await response.text();
    try {
      return { ...wrapped, result: JSON.parse(text) };
    } catch {
      return { ...wrapped, result: text };
    }
  }
  if (isText(contentType) || contentType === "") {
    return { ...wrapped, result: await response.text() };
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  return { ...wrapped, encoding: "base64", result: bytes.toString("base64") };
}

const error = (status, message) => ({ status, jsonBody: { error: message } });

// The Azure Functions HTTP handler, returning an HttpResponseInit.
export async function handleCloudflareAiRun(request, fetchImpl = globalThis.fetch, context) {
  let payload;
  try {
    payload = JSON.parse(await request.text());
  } catch {
    return error(400, "Request body must be valid JSON.");
  }

  const parsed = parseRunRequest(payload);
  if (!parsed.ok) return error(400, parsed.error);

  let wrapped;
  try {
    wrapped = await runCloudflareAi(parsed.value, fetchImpl);
  } catch (err) {
    // Only the message: the request (and its token) must never be logged.
    context?.error(`Cloudflare AI run failed: ${err?.message ?? err}`);
    return error(502, "Could not reach the Cloudflare API.");
  }
  return { status: wrapped.status, jsonBody: wrapped };
}
