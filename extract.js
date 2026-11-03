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

// The trimmed value of one extracted field, or "" when the model gave none.
// Answers come as { type, value }; a plain string is accepted as well.
export function extractedValue(result, field) {
  const answer = result && result.answers ? result.answers[field] : undefined;
  const value = answer && typeof answer === "object" ? answer.value : answer;
  return value == null ? "" : String(value).trim();
}

// YYYY-MM-DD for ISO dates (with or without a time) and German D.M.YYYY
// dates; anything else is passed through unchanged.
function normalizeDate(value) {
  const iso = /^(\d{4}-\d{2}-\d{2})/.exec(value);
  if (iso) return iso[1];
  const de = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(value);
  if (de) return `${de[3]}-${de[2].padStart(2, "0")}-${de[1].padStart(2, "0")}`;
  return value;
}

// Swaps characters OneDrive rejects in names (and line breaks) for safe ones.
function sanitizeNamePart(value) {
  return value
    .replace(/["*:<>?/\\|]/g, "-")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// A file name built from the extracted fields as
// <creation_date>_<sender>-<subject>.pdf, leaving out fields the model didn't
// find. null if it found none of them.
export function suggestFileName(result) {
  const date = sanitizeNamePart(normalizeDate(extractedValue(result, "creation_date")));
  const sender = sanitizeNamePart(extractedValue(result, "sender"));
  const subject = sanitizeNamePart(extractedValue(result, "subject"));
  const rest = [sender, subject].filter(Boolean).join("-");
  const base = [date, rest].filter(Boolean).join("_");
  return base ? `${base}.pdf` : null;
}
