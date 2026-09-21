import { defineConfig } from "@playwright/test";
import path from 'node:path';
import dotenv from 'dotenv';

dotenv.config();

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: 1,
  reporter: "list",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  outputDir: path.join('tests', 'artefacts', String(process.env.RUN_ID)),
  globalSetup: './tests/e2e/global-setup.ts',
  globalTeardown: './tests/e2e/global-teardown.ts',

  use: {
    // Caddy serves the app under `tls internal`, whose CA is only trusted on
    // machines where `caddy trust` has been run (it needs root). The suite
    // only ever talks to that local Caddy and to Microsoft's real endpoints,
    // so accept it rather than requiring root to run the tests.
    ignoreHTTPSErrors: true,
  },

  projects: [
    {
      name: 'auth',
      testMatch: /00-auth\.setup\.ts/,

      use: {
        browserName: 'chromium',
      },
    },

    {
      dependencies: ['auth'],
      
      name: 'e2e',
      testMatch: /.*\.spec\.ts/,

      use: {
        browserName: 'chromium',
        trace: 'retain-on-failure',
      },
    },
  ],
});
