import { defineConfig } from "@playwright/test";
import dotenv from 'dotenv';

dotenv.config();

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  globalSetup: './tests/e2e/global-setup.ts',
  globalTeardown: './tests/e2e/global-teardown.ts',

  projects: [
    {
      name: 'auth',
      
      testMatch: /auth\.setup\.ts/,

      use: {
        // The setup project inherits launchOptions and baseURL
        // from the top-level use configuration.
      },
    },

    {
      
      dependencies: ['auth'],
      name: 'e2e',

      use: {
        browserName: 'chromium',

        // This is loaded into every test context.
        //storageState: path.join(String(process.env.ARTEFACTS_DIR), 'auth.json'),

        testMatch: /.*\.spec\.js/,
        // launchOptions is inherited from the top-level config.
      },
    },
  ],
});
