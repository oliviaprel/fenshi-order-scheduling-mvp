import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseEnv } from "./env";

describe("parseEnv", () => {
  it("rejects a missing database URL", () => {
    expect(() =>
      parseEnv({
        NODE_ENV: "test",
        APP_ORIGIN: "http://localhost:3000",
      }),
    ).toThrow("DATABASE_URL");
  });

  it("accepts the required runtime settings", () => {
    expect(
      parseEnv({
        NODE_ENV: "test",
        APP_ORIGIN: "http://localhost:3000",
        DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/fenshi",
      }),
    ).toMatchObject({
      NODE_ENV: "test",
      APP_ORIGIN: "http://localhost:3000",
    });
  });

  it("allows the production web runtime to start without a migration URL", () => {
    expect(
      parseEnv({
        NODE_ENV: "production",
        APP_ORIGIN: "https://orders.example.com",
        DATABASE_URL: "postgresql://fenshi_app:password@localhost:5432/fenshi",
      }),
    ).toMatchObject({
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://fenshi_app:password@localhost:5432/fenshi",
    });
  });

  it("rejects a production migration command without a migration URL", () => {
    const result = spawnSync(
      process.execPath,
      [resolve("node_modules/prisma/build/index.js"), "validate", "--config", "prisma.config.ts"],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: {
          PATH: process.env.PATH,
          NODE_ENV: "production",
          DATABASE_URL: "postgresql://fenshi_app:password@localhost:5432/fenshi",
        },
      },
    );

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain("MIGRATION_DATABASE_URL");
  });

  it("accepts a migration command with only a migration URL", () => {
    const result = spawnSync(
      process.execPath,
      [resolve("node_modules/prisma/build/index.js"), "validate", "--config", "prisma.config.ts"],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: {
          PATH: process.env.PATH,
          NODE_ENV: "production",
          MIGRATION_DATABASE_URL: "postgresql://fenshi_migrator:password@localhost:5432/fenshi",
        },
      },
    );

    expect(result.status).toBe(0);
  });
});
