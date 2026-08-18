// Wires the pieces together: dev server -> Chrome -> agent-browser -> page object.
//
// A rig can be started by the runner and shared by every spec (fast, and the
// sign-in only happens once), or started on demand by a single spec file run
// directly with `node --test`. Specs call `useHarness()` and do not care which.

import { AppPage } from "./app-page.js";
import { Browser } from "./browser.js";
import { completeSignIn } from "./microsoft-login.js";
import { launchChrome } from "./chrome.js";
import { loadConfig } from "./config.js";
import { startDevServer } from "./dev-server.js";

export const RIG_ENV_VAR = "E2E_RIG";

const bounded = (promise, ms) =>
  Promise.race([promise, new Promise((r) => setTimeout(r, ms).unref?.())]);

/**
 * Start the dev server and a Chrome instance that resolves the app's registered
 * origin to it, then attach agent-browser over CDP.
 */
export async function startRig({ config = loadConfig(), log = () => {} } = {}) {
  const server = await startDevServer({
    basePath: config.appBasePath,
    tls: config.tls ? { host: config.appHost } : null,
  });
  log(`dev server: ${server.url} (serving ${server.root})`);

  let chrome;
  try {
    // The Azure app registration only accepts its production redirect URI, so
    // the browser must see the local build on that exact origin.
    chrome = await launchChrome({
      chromePath: config.chromePath,
      headed: config.headed,
      hostMap: { [config.appHost]: `127.0.0.1:${server.port}` },
    });
  } catch (err) {
    await server.close();
    throw err;
  }
  log(`chrome: ${chrome.version} (cdp ${chrome.cdpPort})`);

  const browser = new Browser({
    session: config.session,
    cdpPort: chrome.cdpPort,
    bin: config.agentBrowserBin,
    timeoutMs: config.timeoutMs,
    verbose: config.verbose,
  });

  return {
    config,
    server,
    chrome,
    browser,
    page: new AppPage(browser, config),
    serialise: () => ({
      cdpPort: chrome.cdpPort,
      session: config.session,
      devServerUrl: server.url,
    }),
    async close() {
      // Teardown must never outlive the run: a wedged browser should not turn a
      // green suite into a hung process.
      if (!config.keepBrowserOpen) await bounded(browser.close(), 20_000);
      await bounded(chrome.close(), 10_000);
      await bounded(server.close(), 10_000);
    },
  };
}

/** Attach to a rig the runner already started. */
export function attachRig(descriptor, config = loadConfig()) {
  const browser = new Browser({
    session: descriptor.session,
    cdpPort: descriptor.cdpPort,
    bin: config.agentBrowserBin,
    timeoutMs: config.timeoutMs,
    verbose: config.verbose,
  });
  return {
    config,
    browser,
    page: new AppPage(browser, config),
    attached: true,
    close: async () => {},
  };
}

let shared = null;

/** The rig for this process, started or attached exactly once. */
export function useHarness() {
  if (shared) return shared;
  shared = (async () => {
    const config = loadConfig();
    const descriptor = process.env[RIG_ENV_VAR];
    if (descriptor) return attachRig(JSON.parse(descriptor), config);

    const rig = await startRig({ config, log: (m) => console.error(`# ${m}`) });
    process.once("exit", () => {
      // Best effort: exit handlers cannot await.
      rig.chrome.close();
      rig.server.close();
    });
    return rig;
  })();
  return shared;
}

/**
 * Make sure the app is open and signed in. Idempotent, so any spec can depend on
 * a signed-in app without depending on the order specs happen to run in.
 */
export async function ensureSignedIn({ log = () => {} } = {}) {
  const rig = await useHarness();
  const { page, browser, config } = rig;

  await page.open();
  if (await page.isSignedIn()) return rig;

  await page.clickSignIn();
  await completeSignIn(browser, config, { log });
  await page.waitForSignedIn(120_000);
  return rig;
}
