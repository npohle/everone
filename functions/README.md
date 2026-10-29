# Azure Functions

An [Azure Functions](https://learn.microsoft.com/azure/azure-functions/) app
(Node.js, v4 programming model), deployed to the `app-everone-extract`
Function App by [`main_app-everone-extract.yml`](../.github/workflows/main_app-everone-extract.yml)
independently of the SPA at the repository root.

## `POST /cloudflare/ai/run`

Runs a [Cloudflare Workers AI](https://developers.cloudflare.com/api/resources/ai/methods/run/)
model on the caller's behalf. Cloudflare's API doesn't answer CORS
preflights, so the SPA can't call it from the browser directly.

Request body (JSON):

```json
{
  "accountId": "<Cloudflare account ID>",
  "apiToken": "<Cloudflare API token with Workers AI access>",
  "model": "@cf/meta/llama-3.1-8b-instruct",
  "body": { "prompt": "Hello" }
}
```

`body` is forwarded unchanged as the JSON body of
`POST https://api.cloudflare.com/client/v4/accounts/{accountId}/ai/run/{model}`,
authenticated with `Authorization: Bearer {apiToken}`.

Response: Cloudflare's answer, wrapped, with Cloudflare's status code as the
function's status code too:

```json
{
  "status": 200,
  "contentType": "application/json",
  "result": { "success": true, "errors": [], "messages": [], "result": { "response": "Hi!" } }
}
```

* JSON answers are parsed into `result`; text answers (e.g.
  `text/event-stream` when `body.stream` is set) are passed as a string.
* Binary answers (e.g. images from text-to-image models) are base64-encoded
  into `result`, with `"encoding": "base64"` added.
* An invalid request body answers `400 { "error": "..." }` without calling
  Cloudflare; a network failure reaching Cloudflare answers `502`.

## `POST /cloudflare/accounts`

[Lists the Cloudflare accounts](https://developers.cloudflare.com/api/resources/accounts/methods/list/)
the caller's API token has access to.

Request body (JSON) — only `apiToken` is required; the other fields map to
the endpoint's `name`, `page`, `per_page` (5–50) and `direction` query
parameters:

```json
{
  "apiToken": "<Cloudflare API token>",
  "name": "Demo Account",
  "page": 1,
  "perPage": 20,
  "direction": "asc"
}
```

This calls `GET https://api.cloudflare.com/client/v4/accounts`, authenticated
with `Authorization: Bearer {apiToken}`, and answers in the same wrapped
shape as `/cloudflare/ai/run`, again with Cloudflare's status code as the
function's status code:

```json
{
  "status": 200,
  "contentType": "application/json",
  "result": {
    "success": true, "errors": [], "messages": [],
    "result": [{ "id": "…", "name": "Demo Account", "type": "standard" }],
    "result_info": { "page": 1, "per_page": 20, "count": 1, "total_count": 1 }
  }
}
```

An invalid request body answers `400 { "error": "..." }` without calling
Cloudflare; a network failure reaching Cloudflare answers `502`.

## Both endpoints

The routes have no `api/` prefix (`host.json` sets `routePrefix` to `""`) and
use `authLevel: "anonymous"` — callers authenticate to Cloudflare with their
own token, which the function never logs.

**CORS:** for the SPA to call the function from the browser, add the SPA's
origin (`https://rubisco.io`) to the Function App's allowed origins
(Azure portal → Function App → API → CORS). Locally, `local.settings.json`'s
`Host.CORS` does the same.

## Development

```bash
cd functions
npm install
npm test                                   # unit tests (node:test, no network)

cp local.settings.example.json local.settings.json
npx azure-functions-core-tools@4 start     # or `func start` if installed
curl -X POST http://localhost:7071/cloudflare/ai/run \
  -H 'Content-Type: application/json' \
  -d '{"accountId":"…","apiToken":"…","model":"@cf/meta/llama-3.1-8b-instruct","body":{"prompt":"Hello"}}'
curl -X POST http://localhost:7071/cloudflare/accounts \
  -H 'Content-Type: application/json' \
  -d '{"apiToken":"…"}'
```

The handler logic lives in `src/cloudflare-ai-run.js` and
`src/cloudflare-accounts.js` (taking `fetch` as an argument so it's testable);
the files in `src/functions/` only register them with the Functions host.
