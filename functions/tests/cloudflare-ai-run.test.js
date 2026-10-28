import { test } from "node:test";
import assert from "node:assert/strict";
import { cloudflareAiRunUrl, parseRunRequest, runCloudflareAi, handleCloudflareAiRun } from "../src/cloudflare-ai-run.js";

const ACCOUNT = "0123456789abcdef0123456789abcdef";
const payload = (overrides = {}) => ({
  accountId: ACCOUNT,
  apiToken: "secret-token",
  model: "@cf/meta/llama-3.1-8b-instruct",
  body: { prompt: "Hello" },
  ...overrides,
});

// Records the calls it gets and answers with `response`.
function fakeFetch(response) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init });
    return typeof response === "function" ? response() : response;
  };
  impl.calls = calls;
  return impl;
}

const jsonResponse = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

// Minimal stand-in for the Azure Functions HttpRequest.
const request = (body) => ({ text: async () => (typeof body === "string" ? body : JSON.stringify(body)) });

test("cloudflareAiRunUrl builds the Workers AI run endpoint, keeping the model's slashes", () => {
  assert.equal(
    cloudflareAiRunUrl(ACCOUNT, "@cf/meta/llama-3.1-8b-instruct"),
    `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/ai/run/@cf/meta/llama-3.1-8b-instruct`,
  );
});

test("cloudflareAiRunUrl encodes characters that are not safe in a path segment", () => {
  assert.equal(
    cloudflareAiRunUrl(ACCOUNT, "@cf/some model?x=1"),
    `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/ai/run/@cf/some%20model%3Fx%3D1`,
  );
});

test("parseRunRequest accepts a complete payload", () => {
  const parsed = parseRunRequest(payload());
  assert.deepEqual(parsed, { ok: true, value: payload() });
});

test("parseRunRequest rejects a payload that is not an object", () => {
  for (const value of [null, "x", 42, []]) {
    assert.equal(parseRunRequest(value).ok, false);
  }
});

test("parseRunRequest rejects missing or empty string fields", () => {
  for (const field of ["accountId", "apiToken", "model"]) {
    const missing = payload();
    delete missing[field];
    const result = parseRunRequest(missing);
    assert.equal(result.ok, false);
    assert.match(result.error, new RegExp(field));
    assert.equal(parseRunRequest(payload({ [field]: "" })).ok, false);
    assert.equal(parseRunRequest(payload({ [field]: 1 })).ok, false);
  }
});

test("parseRunRequest rejects a missing body", () => {
  const missing = payload();
  delete missing.body;
  const result = parseRunRequest(missing);
  assert.equal(result.ok, false);
  assert.match(result.error, /body/);
});

test("parseRunRequest rejects account IDs and models that would escape the run path", () => {
  assert.equal(parseRunRequest(payload({ accountId: "../users" })).ok, false);
  assert.equal(parseRunRequest(payload({ accountId: "abc/def" })).ok, false);
  assert.equal(parseRunRequest(payload({ model: "@cf/../../tokens" })).ok, false);
  assert.equal(parseRunRequest(payload({ model: "@cf//x" })).ok, false);
  assert.equal(parseRunRequest(payload({ model: "/@cf/x" })).ok, false);
});

test("runCloudflareAi POSTs the body as JSON with the bearer token", async () => {
  const fetchImpl = fakeFetch(jsonResponse({ success: true, result: { response: "Hi" } }));
  await runCloudflareAi(payload(), fetchImpl);

  assert.equal(fetchImpl.calls.length, 1);
  const [{ url, init }] = fetchImpl.calls;
  assert.equal(url, `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/ai/run/@cf/meta/llama-3.1-8b-instruct`);
  assert.equal(init.method, "POST");
  assert.equal(init.headers.Authorization, "Bearer secret-token");
  assert.equal(init.headers["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(init.body), { prompt: "Hello" });
});

test("runCloudflareAi wraps a JSON result with the downstream status", async () => {
  const data = { success: true, errors: [], messages: [], result: { response: "Hi" } };
  const result = await runCloudflareAi(payload(), fakeFetch(jsonResponse(data)));
  assert.deepEqual(result, { status: 200, contentType: "application/json", result: data });
});

test("runCloudflareAi keeps the downstream error status and body", async () => {
  const data = { success: false, errors: [{ code: 10000, message: "Authentication error" }] };
  const result = await runCloudflareAi(payload(), fakeFetch(jsonResponse(data, 401)));
  assert.deepEqual(result, { status: 401, contentType: "application/json", result: data });
});

test("runCloudflareAi passes text results through as a string", async () => {
  const response = new Response("data: hi\n\n", { status: 200, headers: { "content-type": "text/event-stream" } });
  const result = await runCloudflareAi(payload(), fakeFetch(response));
  assert.deepEqual(result, { status: 200, contentType: "text/event-stream", result: "data: hi\n\n" });
});

test("runCloudflareAi base64-encodes binary results such as generated images", async () => {
  const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
  const response = new Response(bytes, { status: 200, headers: { "content-type": "image/png" } });
  const result = await runCloudflareAi(payload(), fakeFetch(response));
  assert.deepEqual(result, { status: 200, contentType: "image/png", encoding: "base64", result: "iVBORw==" });
});

test("handleCloudflareAiRun returns the wrapped result with the downstream status", async () => {
  const data = { success: true, result: { response: "Hi" } };
  const response = await handleCloudflareAiRun(request(payload()), fakeFetch(jsonResponse(data)));
  assert.equal(response.status, 200);
  assert.deepEqual(response.jsonBody, { status: 200, contentType: "application/json", result: data });
});

test("handleCloudflareAiRun mirrors a downstream error status", async () => {
  const data = { success: false, errors: [{ code: 5007, message: "No such model" }] };
  const response = await handleCloudflareAiRun(request(payload()), fakeFetch(jsonResponse(data, 400)));
  assert.equal(response.status, 400);
  assert.equal(response.jsonBody.status, 400);
  assert.deepEqual(response.jsonBody.result, data);
});

test("handleCloudflareAiRun answers 400 without calling Cloudflare for invalid JSON", async () => {
  const fetchImpl = fakeFetch(jsonResponse({}));
  const response = await handleCloudflareAiRun(request("{not json"), fetchImpl);
  assert.equal(response.status, 400);
  assert.match(response.jsonBody.error, /JSON/);
  assert.equal(fetchImpl.calls.length, 0);
});

test("handleCloudflareAiRun answers 400 without calling Cloudflare for an incomplete payload", async () => {
  const fetchImpl = fakeFetch(jsonResponse({}));
  const response = await handleCloudflareAiRun(request({ accountId: ACCOUNT }), fetchImpl);
  assert.equal(response.status, 400);
  assert.match(response.jsonBody.error, /apiToken/);
  assert.equal(fetchImpl.calls.length, 0);
});

test("handleCloudflareAiRun answers 502 when Cloudflare can't be reached", async () => {
  const fetchImpl = fakeFetch(() => {
    throw new TypeError("fetch failed");
  });
  const response = await handleCloudflareAiRun(request(payload()), fetchImpl);
  assert.equal(response.status, 502);
  assert.match(response.jsonBody.error, /Cloudflare/);
});

test("handleCloudflareAiRun never echoes the API token back", async () => {
  const fetchImpl = fakeFetch(() => {
    throw new TypeError("fetch failed");
  });
  const response = await handleCloudflareAiRun(request(payload()), fetchImpl);
  assert.doesNotMatch(JSON.stringify(response), /secret-token/);
});
