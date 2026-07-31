import { defineConfig } from "vitest/config";

process.env.APP_ORIGIN ??= "http://localhost:3000";

export default defineConfig({
  test: {
    environment: "jsdom",
    exclude: ["src/**/*.integration.test.ts"],
    include: ["src/**/*.test.ts"],
    setupFiles: ["./vitest.setup.ts"],
  },
});
