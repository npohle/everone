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
  browser: async ({}, use) => {
    
    const { port } = JSON.parse(
      readFileSync(
        path.join(String(process.env.ARTEFACTS_DIR), '.caddy-server-state.json'),
        'utf8',
      ),
    );

    console.log(`Launching browser with host resolver rules to map npohle.github.io to 127.0.0.1:${port}`);

    const browser = await chromium.launch({
      headless: false,

      args: [
        `--host-resolver-rules=MAP npohle.github.io 127.0.0.1:${port}`,
      ],
    });



    await use(browser);

    await browser.close();
  },

  context: async ({ browser }, use) => {

    console.log(`Creating a brand new context`);


    const authFile = path.join(String(process.env.ARTEFACTS_DIR), 'auth.json');
    if (!existsSync(authFile)) {
      console.log("No auth.json file found, please run the 'authenticate' test first to generate it.");
    } else {
      console.log(`Using auth.json file from ${authFile}`);
    }

    const { storageState, sessionStorage = [] } = existsSync(authFile)
      ? JSON.parse(readFileSync(authFile, 'utf8'))
      : { storageState: undefined, sessionStorage: [] };

    const context = await browser.newContext({ storageState });

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