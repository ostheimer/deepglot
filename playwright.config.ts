import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";
const webServerCommand =
  process.env.PLAYWRIGHT_WEB_SERVER_COMMAND ??
  "npm run build && npm run start -- --hostname 127.0.0.1 --port 3000";
const processEnv = Object.fromEntries(
  Object.entries(process.env).filter((entry): entry is [string, string] => {
    return typeof entry[1] === "string";
  })
);
const webServerEnv: Record<string, string> = {
  ...processEnv,
  AUTH_SECRET:
    process.env.AUTH_SECRET ??
    process.env.NEXTAUTH_SECRET ??
    "deepglot-playwright-local-secret",
  AUTH_URL: process.env.PLAYWRIGHT_AUTH_URL ?? baseURL,
  NEXTAUTH_URL: process.env.PLAYWRIGHT_AUTH_URL ?? baseURL,
  NEXT_PUBLIC_APP_URL: process.env.PLAYWRIGHT_APP_URL ?? baseURL,
  DEEPGLOT_ENABLE_TEST_LOGIN:
    process.env.DEEPGLOT_ENABLE_TEST_LOGIN ?? "true",
  TEST_LOGIN_PROJECT_DOMAIN:
    process.env.TEST_LOGIN_PROJECT_DOMAIN ?? "localhost:3000",
  TRANSLATION_PROVIDER: process.env.TRANSLATION_PROVIDER ?? "mock",
  VERCEL: process.env.PLAYWRIGHT_KEEP_VERCEL_ENV
    ? process.env.VERCEL ?? ""
    : "",
  VERCEL_ENV: process.env.PLAYWRIGHT_KEEP_VERCEL_ENV
    ? process.env.VERCEL_ENV ?? ""
    : "",
  VERCEL_URL: process.env.PLAYWRIGHT_KEEP_VERCEL_ENV
    ? process.env.VERCEL_URL ?? ""
    : "",
};

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
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  webServer: {
    command: webServerCommand,
    url: baseURL,
    env: webServerEnv,
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
