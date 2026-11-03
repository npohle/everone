import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EXTRACT_MODEL,
  EXTRACT_FIELDS,
  buildExtractInput,
  blobToDataUrl,
  runExtract,
  formatExtractResult,
} from "../../extract.js";
import { config } from "../../config.js";

// A fetch stand-in recording its calls and answering with `status` / `body`.
function fakeFetch(status, body) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init });
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  };
  impl.calls = calls;
  return impl;
}

const DATA_URL = "data:image/png;base64,iVBORw0KGgo=";
const ANSWERS = {
  model: "clairic",
  answers: {
    sender: { type: "text", value: "Muster GmbH" },
    creation_date: { type: "date", value: "2021-03-16" },
    subject: { type: "text", value: "Lieferschein" },
  },
};
const okBody = (result = ANSWERS) => ({
  status: 200,
  contentType: "application/json",
  result: { success: true, errors: [], messages: [], result },
});

test("config points the extraction at the extract.rubisco.io AI run proxy", () => {
  assert.equal(config.cloudflare.aiRunUrl, "https://extract.rubisco.io/cloudflare/ai/run");
});

test("buildExtractInput asks clairic for sender, creation date and subject of the image", () => {
  assert.deepEqual(buildExtractInput(DATA_URL), {
    model: "clairic",
    images: [DATA_URL],
    fields: {
      sender: { type: "text" },
      creation_date: { type: "date" },
      subject: { type: "text" },
    },
  });
  assert.deepEqual(Object.keys(EXTRACT_FIELDS), ["sender", "creation_date", "subject"]);
});

test("buildExtractInput doesn't share the field specs between requests", () => {
  const input = buildExtractInput(DATA_URL);
  input.fields.sender.type = "number";
  assert.equal(EXTRACT_FIELDS.sender.type, "text");
});

test("blobToDataUrl encodes the blob's bytes with its MIME type", async () => {
  const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const url = await blobToDataUrl(new Blob([bytes], { type: "image/png" }));
  assert.equal(url, `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`);
});

test("blobToDataUrl handles images larger than one encoding chunk", async () => {
  const bytes = new Uint8Array(200_000).map((_, i) => i % 256);
  const url = await blobToDataUrl(new Blob([bytes], { type: "image/png" }));
  assert.equal(url, `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`);
});

test("blobToDataUrl falls back to application/octet-stream without a type", async () => {
  const url = await blobToDataUrl(new Blob([new Uint8Array([1, 2, 3])]));
  assert.equal(url, "data:application/octet-stream;base64,AQID");
});

test("runExtract POSTs the clairic input to the proxy with the Cloudflare token", async () => {
  const fetchImpl = fakeFetch(200, okBody());
  await runExtract({ accountId: "acc123", accessToken: "tok", dataUrl: DATA_URL }, config.cloudflare, fetchImpl);

  assert.equal(fetchImpl.calls.length, 1);
  const { url, init } = fetchImpl.calls[0];
  assert.equal(url, "https://extract.rubisco.io/cloudflare/ai/run");
  assert.equal(init.method, "POST");
  assert.equal(init.headers.Authorization, "Bearer tok");
  assert.equal(init.headers["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(init.body), {
    accountId: "acc123",
    apiToken: "tok",
    model: EXTRACT_MODEL,
    body: buildExtractInput(DATA_URL),
  });
  assert.equal(EXTRACT_MODEL, "@cf/cloudflare/clairic");
});

test("runExtract returns the model's result", async () => {
  const result = await runExtract(
    { accountId: "acc123", accessToken: "tok", dataUrl: DATA_URL },
    config.cloudflare,
    fakeFetch(200, okBody()),
  );
  assert.deepEqual(result, ANSWERS);
});

test("runExtract throws Cloudflare's error messages", async () => {
  const body = {
    status: 400,
    contentType: "application/json",
    result: { success: false, errors: [{ code: 7000, message: "No route for that URI" }], result: null },
  };
  await assert.rejects(
    runExtract({ accountId: "a", accessToken: "t", dataUrl: DATA_URL }, config.cloudflare, fakeFetch(400, body)),
    /No route for that URI/,
  );
});

test("runExtract throws the proxy's own error", async () => {
  await assert.rejects(
    runExtract({ accountId: "a", accessToken: "t", dataUrl: DATA_URL }, config.cloudflare,
      fakeFetch(400, { error: '"accountId" must be a non-empty string.' })),
    /"accountId" must be a non-empty string\./,
  );
});

test("runExtract falls back to the HTTP status when there's no message", async () => {
  await assert.rejects(
    runExtract({ accountId: "a", accessToken: "t", dataUrl: DATA_URL }, config.cloudflare, fakeFetch(502, {})),
    /HTTP 502/,
  );
});

test("formatExtractResult pretty-prints the result as JSON", () => {
  assert.equal(formatExtractResult(ANSWERS), JSON.stringify(ANSWERS, null, 2));
});
