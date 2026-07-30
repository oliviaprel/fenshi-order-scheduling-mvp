import { defineConfig } from "vitest/config";

process.env.APP_ORIGIN ??= "http://localhost:3000";

export default defineConfig({
  test: {
    environment: "node",
    fileParallelism: false,
    include: ["src/**/*.integration.test.ts"],
    passWithNoTests: true,
  },
});
