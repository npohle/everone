import {
  test as base,
  BrowserContext,
  chromium,
  type Browser,
} from '@playwright/test';
import path from 'node:path';
import { existsSync, readFileSync } from 'node:fs';

type Fixtures = {
  browser: Browser;
  context: BrowserContext;
};

export const test = base.extend<Fixtures>({
  browser: async ({ headless, launchOptions }, use) => {
    
    const { port } = JSON.parse(
      readFileSync(
        path.join(String(process.env.ARTEFACTS_DIR), '.caddy-server-state.json'),
        'utf8',
      ),
    );

    console.log(`Launching browser with host resolver rules to map npohle.github.io to 127.0.0.1:${port}`);

    // Take headless / launch args from Playwright's own options rather than
    // hardcoding them, so `--headed` (and anything set under `use` in
    // playwright.config.ts) works here like it does for the built-in fixture.
    const browser = await chromium.launch({
      ...launchOptions,
      headless,

      args: [
        ...(launchOptions.args ?? []),
        `--host-resolver-rules=MAP npohle.github.io 127.0.0.1:${port}`,
      ],
    });



    await use(browser);

    await browser.close();
  },

  context: async ({ browser, ignoreHTTPSErrors }, use) => {

    console.log(`Creating a brand new context`);

    // Both files hold the raw value directly (see auth.setup.ts's
    // JSON.stringify(storageState) / JSON.stringify(sessionStorage)) — no
    // wrapper key to destructure.
    const localstorageFile = path.join(String(process.env.ARTEFACTS_DIR), 'localstorage.json');
    const localstorageState = existsSync(localstorageFile)
      ? JSON.parse(readFileSync(localstorageFile, 'utf8'))
      : undefined;
    if (!localstorageState) {
      console.log("No localstorage.json file found, please run the 'authenticate' test first to generate it.");
    } else {
      console.log(`Using localstorage.json file from ${localstorageFile}`);
    }

    // Caddy serves the app with `tls internal`, whose CA is not in the
    // browser's trust store, so without this every page.goto() fails with
    // ERR_CERT_AUTHORITY_INVALID. This has to be passed through explicitly:
    // this fixture replaces Playwright's built-in `context`, so `use` options
    // from playwright.config.ts never reach newContext() on their own.
    const context = await browser.newContext({
      storageState: localstorageState,
      ignoreHTTPSErrors,
    });

    const sessionStorageFile = path.join(String(process.env.ARTEFACTS_DIR), 'sessionstorage.json');
    const sessionStorage: Array<{ name: string; value: string }> = existsSync(sessionStorageFile)
      ? JSON.parse(readFileSync(sessionStorageFile, 'utf8'))
      : [];
    if (sessionStorage.length === 0) {
      console.log("No sessionstorage.json file found, please run the 'authenticate' test first to generate it.");
    } else {
      console.log(`Using sessionstorage.json file from ${sessionStorageFile}`);
    }

    if (sessionStorage.length > 0) {
      // sessionStorage isn't part of storageState — seed it via an init
      // script so it's set before any page script runs, on every
      // navigation in this context, not just the first one.
      await context.addInitScript((items: Array<{ name: string; value: string }>) => {
        for (const { name, value } of items) {
          window.sessionStorage.setItem(name, value);
        }
      }, sessionStorage);
    }

    await use(context);
    await context.close();
  },
});

export { expect } from '@playwright/test';