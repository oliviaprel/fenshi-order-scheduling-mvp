import { defineConfig } from "@playwright/test";

const E2E_APP_ORIGIN = "http://127.0.0.1:3000";

function resolveE2EAppOrigin(configuredOrigin: string | undefined): string {
  if (configuredOrigin === undefined) {
    return E2E_APP_ORIGIN;
  }

  try {
    new URL(configuredOrigin);
  } catch {
    throw new Error(`E2E APP_ORIGIN must be exactly ${E2E_APP_ORIGIN}`);
  }

  if (configuredOrigin !== E2E_APP_ORIGIN) {
    throw new Error(`E2E APP_ORIGIN must be exactly ${E2E_APP_ORIGIN}`);
  }
  return E2E_APP_ORIGIN;
}

const appOrigin = resolveE2EAppOrigin(process.env.APP_ORIGIN);

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  globalTeardown: "./e2e/global-teardown.ts",
  outputDir: "test-results",
  fullyParallel: false,
  reporter: [["line"]],
  use: {
    baseURL: appOrigin,
    trace: "off",
    screenshot: "off",
    video: "off",
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
