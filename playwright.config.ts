import { defineConfig, devices } from "@playwright/test";

const webServerCommand =
  process.env.PLAYWRIGHT_WEB_SERVER_COMMAND ??
  "npm run build && npm run start -- --hostname 127.0.0.1 --port 3000";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  outputDir: "output/playwright/test-results",
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  webServer: {
    command: webServerCommand,
    url: "http://127.0.0.1:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
      },
    },
  ],
});
