import {
  test as base,
  BrowserContext,
  chromium,
  type Browser,
} from '@playwright/test';
import path from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { APP_HOST, browserLaunchOptions } from './lib/browser.ts';
import { readCaddyState } from './lib/caddy.ts';

type Fixtures = {
  browser: Browser;
  context: BrowserContext;
};

export const test = base.extend<Fixtures>({
  // `headless`, `launchOptions` and `ignoreHTTPSErrors` are Playwright's own
  // options: they come from playwright.config.ts's `use`, and `headless` also
  // honours the `--headed` command line flag, so a run can be watched without
  // editing this file.
  browser: async ({ headless, launchOptions }, use) => {

    const { port } = readCaddyState(String(process.env.ARTEFACTS_DIR));

    console.log(`Launching ${headless ? 'headless ' : ''}browser with host resolver rules to map ${APP_HOST} to 127.0.0.1:${port}`);

    const browser = await chromium.launch({
      ...browserLaunchOptions(port, launchOptions),
      headless,
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

    const context = await browser.newContext({ storageState: localstorageState, ignoreHTTPSErrors });

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