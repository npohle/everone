# Architecture

OneDrive Browser is a client-only single-page application that lets users browse, search, and preview files stored in their Microsoft OneDrive. It runs entirely in the browser with no backend server — all data flows directly between the user's browser and the Microsoft Graph API.

## Tech Stack

| Layer          | Technology                                      |
| -------------- | ----------------------------------------------- |
| Language       | Vanilla JavaScript (ES6 modules, no transpiler) |
| Markup         | HTML5                                           |
| Styling        | CSS3 with custom properties, dark mode support  |
| Auth           | MSAL.js v3 (Azure AD OAuth 2.0, loaded via CDN) |
| File API       | Microsoft Graph API v1.0                        |
| PDF rendering  | pdf.js v4.10.38 (loaded via CDN)                |
| Markdown       | marked v12.0.2 (lazy-loaded via CDN)            |
| Build system   | None — files are served as-is                   |
| Deployment     | GitHub Pages (static file upload)               |

## Directory Structure

```
.
├── index.html          Entry point — HTML shell with UI structure
├── app.js              Application controller, state, UI rendering, event wiring
├── auth.js             MSAL wrapper (sign-in, sign-out, token acquisition)
├── config.js           Azure app registration settings and Graph API config
├── graph.js            Microsoft Graph API client (list, search, download)
├── viewer.js           File preview renderer (images, PDF, video, audio, text, Office)
├── styles.css          Theming (light/dark), layout, and component styles
├── .nojekyll           Tells GitHub Pages to skip Jekyll processing
└── .github/
    └── workflows/
        └── pages.yml   CI: deploy to GitHub Pages on push
```

## Module Dependency Graph

```
index.html
  └── app.js  (entry module, loaded as type="module")
        ├── config.js   (clientId, authority, scopes, graphBase, pageSize)
        ├── auth.js     (init, signIn, signOut, getToken, getAccount)
        │     └── config.js
        ├── graph.js    (listChildren, search, getEmbedUrl, fetchContent, …)
        │     ├── config.js
        │     └── auth.js  (getToken for Bearer header)
        └── viewer.js   (open, clear)
              └── graph.js (fetchContent, getEmbedUrl)
```

All modules use native ES `import`/`export`. MSAL is loaded as a UMD global via `<script>` in `index.html` and accessed through `window.msal`.

## Application State

State lives in a single in-memory object inside `app.js`:

```
state = {
  stack          Navigation history — array of { id, name } folder items
  items          Current page of drive items being displayed
  nextLink       Graph API pagination cursor (@odata.nextLink)
  sort           Active sort key (e.g. "name-desc", "modified-asc")
  searchQuery    Current search string (empty when browsing)
  loadId         Monotonic counter for request deduplication
  selectedId     ID of the file currently shown in the preview pane
}
```

There is no external state management library. UI updates are triggered by mutating `state` and calling render functions (`renderListing`, `renderBreadcrumbs`, etc.) directly.

## Key Data Flows

### Authentication

1. On page load, `app.js` calls `auth.init()` which initializes MSAL and processes any pending redirect.
2. If a cached session exists, the user is signed in automatically.
3. `auth.signIn()` attempts a popup login. If popups are blocked, it falls back to a full-page redirect.
4. Tokens are stored in `sessionStorage` (cleared when the browser tab closes).
5. `auth.getToken()` acquires an access token silently from cache, falling back to an interactive popup if the token has expired.

### Browsing Folders

1. User clicks a folder &rarr; `onItemClick()` pushes it onto `state.stack`.
2. `loadCurrent()` calls `graph.listChildren(folderId, sort)` with an `$orderby` clause.
3. The Graph API returns a page of drive items (up to 100).
4. `renderListing()` builds the `<ul>` from `state.items`.
5. If `@odata.nextLink` is present, a "Load more" button fetches the next page.

### Searching

1. User types in the search box (debounced at 300 ms, minimum 2 characters).
2. `runSearch()` calls `graph.search(query, sort)`.
3. Results replace `state.items` and the breadcrumb bar switches to a search label.

### Previewing Files

1. User clicks a file row &rarr; `selectItem()` calls `viewer.open(item)`.
2. `viewer.js` inspects the file extension and dispatches to the appropriate renderer:
   - **Images** — fetched as blob, displayed via `<img>`.
   - **Video / Audio** — fetched as blob, displayed via `<video>` / `<audio>`.
   - **PDF** — rendered page-by-page using pdf.js canvases. The persistent pdf.js container is reused across selections.
   - **Markdown** — fetched as text, rendered to HTML via `marked`, with a `<pre>` fallback.
   - **Plain text / code** — fetched as text, displayed in a `<pre>` block (max 2 MB).
   - **Office documents** — embedded via an Office Online iframe obtained from the Graph preview endpoint.
   - **Other** — shows an "unsupported" placeholder with download/open links.
3. A monotonic `loadId` prevents slow fetches from overwriting a newer selection.

## Race Condition Prevention

Both `app.js` and `viewer.js` maintain independent monotonic counters (`state.loadId` and `viewer.loadId`). Every async operation captures the current counter value before awaiting. After each `await`, the code checks whether the counter still matches — if not, the result is silently discarded. This prevents stale responses from clobbering newer content when the user navigates quickly.

## Focus-Steal Guard

Office Online and PDF preview iframes aggressively focus themselves during hydration, pulling focus away from the file list mid-keyboard-navigation. `viewer.js` mitigates this with a two-layer guard:

1. **focusin listener** — when the preview pane receives focus without a preceding Tab keypress, focus is restored to the previously active element.
2. **requestAnimationFrame poll** — runs for 10 seconds after each preview load, actively pulling focus back whenever it drifts into the preview pane.

The guard yields immediately when the user explicitly interacts with the preview (pointer down or Tab).

## Styling and Theming

- CSS custom properties (`--bg`, `--panel`, `--border`, `--text`, `--accent`, etc.) define the color palette.
- A `@media (prefers-color-scheme: dark)` block overrides these properties for dark mode — no JavaScript toggle is needed.
- The split-pane layout uses a CSS Grid with a `--list-width` custom property that is adjusted by the draggable divider. The user's preferred width is persisted in `localStorage`.
- Responsive breakpoints at 800 px (stacks split pane vertically) and 640 px (hides breadcrumbs and reference column).

## Deployment

The GitHub Actions workflow (`.github/workflows/pages.yml`) deploys on every push to `main`:

1. Checks out the repository.
2. Uploads the entire directory as a GitHub Pages artifact (no build step).
3. Deploys to the `github-pages` environment.

Since there is no build step, any static file server (Netlify, S3, Azure Static Web Apps, etc.) can host the app by serving the repository root.

## External Service Dependencies

| Service | Purpose | Auth |
| ------- | ------- | ---- |
| Microsoft Graph API (`graph.microsoft.com/v1.0`) | OneDrive file operations (list, search, download, preview) | OAuth 2.0 Bearer token |
| Azure AD (`login.microsoftonline.com`) | User authentication via MSAL | OAuth 2.0 Authorization Code + PKCE |
| jsDelivr CDN (`cdn.jsdelivr.net`) | Hosts MSAL, pdf.js, and marked libraries | None |

## Azure App Registration

The app requires an Azure AD app registration with:

- **Platform:** Single-page application (SPA)
- **Redirect URI:** The exact URL where the app is hosted
- **Delegated permissions:** `User.Read`, `Files.Read`, `Files.Read.All`
- **Account types:** Personal Microsoft accounts (consumers) — configurable via the `authority` in `config.js`

No admin consent is required for personal accounts. The `clientId` in `config.js` must match the registered application.
