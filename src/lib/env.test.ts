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
});
