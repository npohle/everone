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
