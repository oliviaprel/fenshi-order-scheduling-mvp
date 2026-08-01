import { describe, expect, it } from "vitest";
import { createLogger } from "./logger";
import { redact } from "./redaction";

describe("structured logging", () => {
  it("redacts sensitive keys recursively without changing allowed fields", () => {
    expect(
      redact({
        password: "secret",
        PasswordHash: "argon",
        token: "raw-token",
        TOKENHASH: "token-digest",
        cookie: "session=raw",
        Authorization: "Bearer abc",
        databaseUrl: "postgresql://user:password@database/private",
        nested: [
          { PASSWORD: "nested-secret", phone: "13800138000" },
          "public-value",
        ],
      }),
    ).toEqual({
      password: "[REDACTED]",
      PasswordHash: "[REDACTED]",
      token: "[REDACTED]",
      TOKENHASH: "[REDACTED]",
      cookie: "[REDACTED]",
      Authorization: "[REDACTED]",
      databaseUrl: "[REDACTED]",
      nested: [
        { PASSWORD: "[REDACTED]", phone: "13800138000" },
        "public-value",
      ],
    });
  });

  it("emits one JSON object with required fields and omits production request bodies", () => {
    const lines: string[] = [];
    const logger = createLogger({
      environment: "production",
      now: () => new Date("2026-08-01T00:00:00.000Z"),
      write: (line) => lines.push(line),
    });

    logger.info("request completed", {
      requestId: "request-123",
      route: "/api/auth/login",
      requestBody: { password: "must-never-be-logged", phone: "13800138000" },
      token: "raw-token",
    });

    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? "")).toEqual({
      timestamp: "2026-08-01T00:00:00.000Z",
      level: "info",
      message: "request completed",
      requestId: "request-123",
      route: "/api/auth/login",
      token: "[REDACTED]",
    });
  });
});
