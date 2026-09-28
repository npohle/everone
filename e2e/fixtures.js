// Shared e2e setup.
//
// MSAL is always replaced with a stub that reports a signed-in account and
// hands out a fixed access token, so no interactive sign-in is needed.
//
// Graph access runs in one of two modes:
//   - Live: set E2E_ONEDRIVE_TOKEN to a Microsoft Graph access token with
//     Files.ReadWrite scope. Requests go to the real OneDrive of that account.
//   - Fake (default): Graph calls are intercepted and served from an in-memory
//     drive that contains a "Documents" folder.
import { test as base, expect } from "@playwright/test";

export const GRAPH = "https://graph.microsoft.com/v1.0";
export const liveToken = process.env.E2E_ONEDRIVE_TOKEN || "";
export const isLive = !!liveToken;

const MSAL_STUB = (token) => `
  (() => {
    const account = { username: "e2e@example.com", name: "E2E User", homeAccountId: "e2e" };
    class PublicClientApplication {
      async initialize() {}
      async handleRedirectPromise() { return null; }
      getAllAccounts() { return [account]; }
      getActiveAccount() { return account; }
      setActiveAccount() {}
      async acquireTokenSilent() { return { accessToken: ${JSON.stringify(token)}, account }; }
      async acquireTokenPopup() { return { accessToken: ${JSON.stringify(token)}, account }; }
      async loginPopup() { return { account }; }
      async logoutPopup() {}
    }
    window.msal = { PublicClientApplication };
  })();
`;

// In-memory OneDrive: a flat map of items keyed by id, with parent links.
export class FakeDrive {
  constructor() {
    this.items = new Map();
    this.nextId = 1;
    this.add(null, { name: "Documents", folder: { childCount: 0 } });
    this.add(null, { name: "Pictures", folder: { childCount: 0 } });
    this.add(null, { name: "readme.txt", file: { mimeType: "text/plain" }, size: 12 });
    // Set to { status, body } to make the next folder creation fail.
    this.failNextCreate = null;
  }

  add(parentId, props) {
    const id = `item-${this.nextId++}`;
    const item = {
      id,
      size: 0,
      lastModifiedDateTime: new Date().toISOString(),
      parentReference: { id: parentId || "root" },
      ...props,
    };
    this.items.set(id, item);
    return item;
  }

  children(parentId) {
    const pid = parentId || "root";
    return [...this.items.values()].filter((i) => i.parentReference.id === pid);
  }

  async handle(route) {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname.replace(/^\/v1\.0/, "");
    const json = (status, body) => route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(body),
    });

    if (path === "/me") return json(200, { displayName: "E2E User" });

    const m = /^\/me\/drive\/(?:root|items\/([^/]+))\/children$/.exec(path);
    if (m) {
      const parentId = m[1] ? decodeURIComponent(m[1]) : null;
      if (req.method() === "GET") return json(200, { value: this.children(parentId) });
      if (req.method() === "POST") {
        if (this.failNextCreate) {
          const { status, body } = this.failNextCreate;
          this.failNextCreate = null;
          return json(status, body);
        }
        const body = req.postDataJSON();
        if (this.children(parentId).some((i) => i.name === body.name)) {
          return json(409, { error: { code: "nameAlreadyExists", message: "Name already exists" } });
        }
        return json(201, this.add(parentId, { name: body.name, folder: { childCount: 0 } }));
      }
    }
    return json(404, { error: { code: "itemNotFound", message: `Fake drive: no route for ${req.method()} ${path}` } });
  }
}

export const test = base.extend({
  drive: async ({ page }, use) => {
    await page.route("https://cdn.jsdelivr.net/npm/@azure/msal-browser@3/**", (route) =>
      route.fulfill({ contentType: "text/javascript", body: MSAL_STUB(liveToken || "fake-token") }));
    const drive = isLive ? null : new FakeDrive();
    if (drive) await page.route("https://graph.microsoft.com/**", (route) => drive.handle(route));
    await use(drive);
  },
});

export { expect };
