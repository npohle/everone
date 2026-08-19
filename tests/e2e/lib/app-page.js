// Page object for the OneDrive Browser SPA.
//
// Specs talk to the app through this object so that a markup change is a one
// file fix rather than a rewrite of every test.

// agent-browser evaluates every script in the same execution context, so a bare
// top-level `const` collides on the second call — hence the IIFE.
const STATE_SCRIPT = `(() => {
  const text = (sel) => document.querySelector(sel)?.textContent?.trim() ?? null;
  const rows = Array.from(document.querySelectorAll("#listing .row:not(.head)"));
  return JSON.stringify({
    title: document.title,
    authButton: text("#auth-btn"),
    user: text("#user"),
    signedOutVisible: !document.getElementById("signed-out").hidden,
    browserVisible: !document.getElementById("browser").hidden,
    configHintVisible: !document.getElementById("config-hint").hidden,
    status: text("#status"),
    breadcrumbs: Array.from(document.querySelectorAll("#breadcrumbs > *"))
      .map((n) => n.textContent.trim())
      .filter((t) => t && t !== "\\u203a"),
    loading: !document.getElementById("loading").hidden,
    viewerTitle: text("#viewer-title"),
    sort: document.getElementById("sort")?.value ?? null,
    items: rows.map((r) => ({
      id: r.dataset.id,
      name: r.querySelector(".name")?.textContent?.trim() ?? "",
      icon: r.querySelector(".icon")?.textContent?.trim() ?? "",
      reference: r.querySelector(".meta-ref")?.textContent?.trim() ?? "",
      selected: r.classList.contains("selected"),
    })),
  });
})()`;

const FOLDER_ICON = "📁";

export class AppPage {
  constructor(browser, config) {
    this.browser = browser;
    this.config = config;
  }

  open() {
    return this.browser.open(this.config.appUrl);
  }

  /** Everything the specs assert on, read in one round trip. */
  state() {
    return this.browser.evalJson(STATE_SCRIPT);
  }

  async isSignedIn() {
    const state = await this.state();
    return state.authButton === "Sign out" && state.browserVisible;
  }

  clickSignIn() {
    return this.browser.click("#signin-cta");
  }

  async waitFor(predicate, { timeoutMs = this.config.timeoutMs, description = "condition" } = {}) {
    const deadline = Date.now() + timeoutMs;
    let last;
    while (Date.now() < deadline) {
      last = await this.state();
      if (predicate(last)) return last;
      await new Promise((r) => setTimeout(r, 400));
    }
    throw new Error(
      `Timed out after ${timeoutMs}ms waiting for ${description}. Last state: ${JSON.stringify(last)}`
    );
  }

  waitForSignedIn(timeoutMs) {
    return this.waitFor((s) => s.authButton === "Sign out" && s.browserVisible, {
      timeoutMs,
      description: "the app to show the signed-in browser",
    });
  }

  waitForListing(timeoutMs) {
    return this.waitFor((s) => s.browserVisible && !s.loading && s.items.length > 0, {
      timeoutMs,
      description: "the file listing to load",
    });
  }

  async items() {
    return (await this.state()).items;
  }

  async firstFolder() {
    return (await this.items()).find((i) => i.icon === FOLDER_ICON) ?? null;
  }

  async firstFile() {
    return (await this.items()).find((i) => i.icon !== FOLDER_ICON) ?? null;
  }

  openItem(id) {
    return this.browser.click(`#listing .row[data-id="${id}"]`);
  }

  setSort(value) {
    return this.browser.select("#sort", value);
  }

  search(query) {
    return this.browser.typeInto("#search", query);
  }

  goUp() {
    return this.browser.click("#up-btn");
  }
}
