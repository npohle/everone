import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cloudflareAccountsUrl,
  parseAccountsRequest,
  listCloudflareAccounts,
  handleCloudflareAccounts,
} from "../src/cloudflare-accounts.js";

const payload = (overrides = {}) => ({ apiToken: "secret-token", ...overrides });

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

const accounts = {
  success: true,
  errors: [],
  messages: [],
  result: [{ id: "0123456789abcdef0123456789abcdef", name: "Demo Account", type: "standard" }],
  result_info: { page: 1, per_page: 20, count: 1, total_count: 1 },
};

test("cloudflareAccountsUrl builds the List Accounts endpoint", () => {
  assert.equal(cloudflareAccountsUrl(), "https://api.cloudflare.com/client/v4/accounts");
  assert.equal(cloudflareAccountsUrl({}), "https://api.cloudflare.com/client/v4/accounts");
});

test("cloudflareAccountsUrl adds the optional query parameters", () => {
  assert.equal(
    cloudflareAccountsUrl({ name: "Demo & Co", page: 2, perPage: 50, direction: "desc" }),
    "https://api.cloudflare.com/client/v4/accounts?name=Demo+%26+Co&page=2&per_page=50&direction=desc",
  );
});

test("parseAccountsRequest accepts a payload with just the API token", () => {
  assert.deepEqual(parseAccountsRequest(payload()), { ok: true, value: { apiToken: "secret-token" } });
});

test("parseAccountsRequest keeps the optional filters and pagination", () => {
  const full = payload({ name: "Demo", page: 3, perPage: 5, direction: "asc" });
  assert.deepEqual(parseAccountsRequest(full), { ok: true, value: full });
});

test("parseAccountsRequest drops unknown fields", () => {
  assert.deepEqual(parseAccountsRequest(payload({ accountId: "x" })), {
    ok: true,
    value: { apiToken: "secret-token" },
  });
});

test("parseAccountsRequest rejects a payload that is not an object", () => {
  for (const value of [null, "x", 42, []]) {
    assert.equal(parseAccountsRequest(value).ok, false);
  }
});

test("parseAccountsRequest rejects a missing or empty API token", () => {
  for (const apiToken of [undefined, "", 1]) {
    const result = parseAccountsRequest({ apiToken });
    assert.equal(result.ok, false);
    assert.match(result.error, /apiToken/);
  }
});

test("parseAccountsRequest rejects invalid optional parameters", () => {
  assert.match(parseAccountsRequest(payload({ name: 1 })).error, /name/);
  assert.match(parseAccountsRequest(payload({ page: 0 })).error, /page/);
  assert.match(parseAccountsRequest(payload({ page: 1.5 })).error, /page/);
  assert.match(parseAccountsRequest(payload({ perPage: 4 })).error, /perPage/);
  assert.match(parseAccountsRequest(payload({ perPage: 51 })).error, /perPage/);
  assert.match(parseAccountsRequest(payload({ perPage: "20" })).error, /perPage/);
  assert.match(parseAccountsRequest(payload({ direction: "up" })).error, /direction/);
});

test("listCloudflareAccounts GETs the accounts with the bearer token", async () => {
  const fetchImpl = fakeFetch(jsonResponse(accounts));
  await listCloudflareAccounts(payload({ page: 2 }), fetchImpl);

  assert.equal(fetchImpl.calls.length, 1);
  const [{ url, init }] = fetchImpl.calls;
  assert.equal(url, "https://api.cloudflare.com/client/v4/accounts?page=2");
  assert.equal(init.method, "GET");
  assert.equal(init.headers.Authorization, "Bearer secret-token");
  assert.equal(init.body, undefined);
});

test("listCloudflareAccounts wraps the result with the downstream status", async () => {
  const result = await listCloudflareAccounts(payload(), fakeFetch(jsonResponse(accounts)));
  assert.deepEqual(result, { status: 200, contentType: "application/json", result: accounts });
});

test("listCloudflareAccounts keeps the downstream error status and body", async () => {
  const data = { success: false, errors: [{ code: 9109, message: "Invalid access token" }] };
  const result = await listCloudflareAccounts(payload(), fakeFetch(jsonResponse(data, 403)));
  assert.deepEqual(result, { status: 403, contentType: "application/json", result: data });
});

test("handleCloudflareAccounts returns the wrapped result with the downstream status", async () => {
  const response = await handleCloudflareAccounts(request(payload()), fakeFetch(jsonResponse(accounts)));
  assert.equal(response.status, 200);
  assert.deepEqual(response.jsonBody, { status: 200, contentType: "application/json", result: accounts });
});

test("handleCloudflareAccounts mirrors a downstream error status", async () => {
  const data = { success: false, errors: [{ code: 10000, message: "Authentication error" }] };
  const response = await handleCloudflareAccounts(request(payload()), fakeFetch(jsonResponse(data, 401)));
  assert.equal(response.status, 401);
  assert.equal(response.jsonBody.status, 401);
  assert.deepEqual(response.jsonBody.result, data);
});

test("handleCloudflareAccounts answers 400 without calling Cloudflare for invalid JSON", async () => {
  const fetchImpl = fakeFetch(jsonResponse({}));
  const response = await handleCloudflareAccounts(request("{not json"), fetchImpl);
  assert.equal(response.status, 400);
  assert.match(response.jsonBody.error, /JSON/);
  assert.equal(fetchImpl.calls.length, 0);
});

test("handleCloudflareAccounts answers 400 without calling Cloudflare for a missing token", async () => {
  const fetchImpl = fakeFetch(jsonResponse({}));
  const response = await handleCloudflareAccounts(request({}), fetchImpl);
  assert.equal(response.status, 400);
  assert.match(response.jsonBody.error, /apiToken/);
  assert.equal(fetchImpl.calls.length, 0);
});

test("handleCloudflareAccounts answers 502 when Cloudflare can't be reached", async () => {
  const fetchImpl = fakeFetch(() => {
    throw new TypeError("fetch failed");
  });
  const response = await handleCloudflareAccounts(request(payload()), fetchImpl);
  assert.equal(response.status, 502);
  assert.match(response.jsonBody.error, /Cloudflare/);
});

test("handleCloudflareAccounts never echoes the API token back", async () => {
  const fetchImpl = fakeFetch(() => {
    throw new TypeError("fetch failed");
  });
  const response = await handleCloudflareAccounts(request(payload()), fetchImpl);
  assert.doesNotMatch(JSON.stringify(response), /secret-token/);
});
