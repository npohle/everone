import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.PORT) || 4173;

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  use: {
    baseURL: `http://localhost:${port}/`,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "node e2e/serve.js",
    url: `http://localhost:${port}/`,
    reuseExistingServer: !process.env.CI,
    env: { PORT: String(port) },
  },
});
