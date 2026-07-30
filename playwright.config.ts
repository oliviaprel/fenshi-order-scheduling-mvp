import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  use: {
    baseURL: process.env.APP_ORIGIN ?? "http://127.0.0.1:3000",
  },
});
