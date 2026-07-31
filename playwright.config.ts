import { defineConfig } from "@playwright/test";

const appOrigin = process.env.APP_ORIGIN ?? "http://127.0.0.1:3000";

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  globalTeardown: "./e2e/global-teardown.ts",
  outputDir: "test-results",
  fullyParallel: false,
  use: {
    baseURL: appOrigin,
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run dev",
    url: appOrigin,
    reuseExistingServer: false,
    env: {
      ...process.env,
      APP_ORIGIN: appOrigin,
      DATABASE_URL: process.env.DATABASE_URL ?? "",
    },
  },
});
