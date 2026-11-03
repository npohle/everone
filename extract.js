// Extract: structured fields (sender, creation date, subject) read from an
// image of a document's first page by Cloudflare Workers AI's clairic model.
//
// Cloudflare's API sends no CORS headers, so the request goes through the
// extract.rubisco.io proxy (functions/src/cloudflare-ai-run.js), which is
// POSTed { accountId, apiToken, model, body } and forwards `body` — the
// clairic input below — to the model, answering { status, contentType,
// result } with Cloudflare's response as `result`.
//
// The helpers take `fetch` as an argument so they can be unit-tested.

import { config } from "./config.js";

export const EXTRACT_MODEL = "@cf/cloudflare/clairic";

export const EXTRACT_FIELDS = {
  sender: { type: "text" },
  creation_date: { type: "date" },
  subject: { type: "text" },
};

// The clairic model input for one page image, given as a data URL.
export function buildExtractInput(dataUrl) {
  return {
    model: "clairic",
    images: [dataUrl],
    fields: structuredClone(EXTRACT_FIELDS),
  };
}

// "data:<type>;base64,<bytes>" for a blob. btoa() takes a binary string, built
// in chunks so large images don't overflow String.fromCharCode's arguments.
export async function blobToDataUrl(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return `data:${blob.type || "application/octet-stream"};base64,${btoa(bin)}`;
}

// Runs the extraction for the page image `dataUrl` and returns the model's
// result ({ model, answers, … }). Throws on a failed request.
export async function runExtract({ accountId, accessToken, dataUrl }, cf = config.cloudflare, fetchImpl = globalThis.fetch) {
  const res = await fetchImpl(cf.aiRunUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      accountId,
      apiToken: accessToken,
      model: EXTRACT_MODEL,
      body: buildExtractInput(dataUrl),
    }),
  });
  const body = await res.json().catch(() => ({}));
  const answer = body.result && typeof body.result === "object" ? body.result : {};
  if (!res.ok || answer.success === false) {
    const reason = (answer.errors || []).map((e) => e.message).filter(Boolean).join("; ") || body.error;
    throw new Error(reason || `extract request failed (HTTP ${res.status})`);
  }
  return answer.result;
}

export function formatExtractResult(result) {
  return JSON.stringify(result, null, 2);
}
