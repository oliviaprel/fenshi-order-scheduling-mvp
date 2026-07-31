import { spawnSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const configUrl = pathToFileURL(path.resolve(process.cwd(), "playwright.config.ts"));

function loadPlaywrightConfig(appOrigin: string) {
  return spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "--input-type=module",
      "--eval",
      `await import(${JSON.stringify(configUrl.href)})`,
    ],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: { ...process.env, APP_ORIGIN: appOrigin },
    },
  );
}

describe("Playwright configuration origin boundary", () => {
  it.each([
    "https://staging.example.com",
    "http://localhost:3000",
    "http://127.0.0.1:3000/",
    "not-a-url",
  ])("rejects non-local E2E target %s while loading config", (appOrigin) => {
    const result = loadPlaywrightConfig(appOrigin);

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain(
      "E2E APP_ORIGIN must be exactly http://127.0.0.1:3000",
    );
  });
});
