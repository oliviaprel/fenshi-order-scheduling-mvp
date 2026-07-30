import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ApiError, toErrorResponse } from "./api-error";
import { assertAllowedOrigin } from "./origin";
import { getRequestId } from "./request-id";

const originalAppOrigin = process.env.APP_ORIGIN;
const originalDatabaseUrl = process.env.DATABASE_URL;

beforeEach(() => {
  process.env.APP_ORIGIN = "https://app.example.com";
  process.env.DATABASE_URL = "not-used-by-this-test";
});

afterEach(() => {
  if (originalAppOrigin === undefined) delete process.env.APP_ORIGIN;
  else process.env.APP_ORIGIN = originalAppOrigin;

  if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = originalDatabaseUrl;
});

describe("origin guard", () => {
  it("allows a request whose Origin matches APP_ORIGIN exactly", () => {
    expect(() =>
      assertAllowedOrigin(
        new Request("https://app.example.com/api", {
          method: "POST",
          headers: { Origin: "https://app.example.com" },
        }),
      ),
    ).not.toThrow();
  });

  it.each(["GET", "HEAD"])("allows same-origin browser %s requests without Origin", (method) => {
    expect(() =>
      assertAllowedOrigin(new Request("https://app.example.com/api", { method })),
    ).not.toThrow();
  });

  it.each([
    ["POST", undefined],
    ["POST", "https://attacker.example.com"],
    ["GET", "https://attacker.example.com"],
  ])("rejects %s requests with a missing or mismatched Origin", (method, origin) => {
    const request = new Request("https://app.example.com/api", {
      method,
      headers: origin === undefined ? undefined : { Origin: origin },
    });

    let error: unknown;
    try {
      assertAllowedOrigin(request);
    } catch (caught) {
      error = caught;
    }

    expect(error).toMatchObject({
      status: 403,
      code: "ORIGIN_NOT_ALLOWED",
    });
  });
});

describe("request IDs", () => {
  it("uses a supplied request ID and otherwise generates a UUID", () => {
    expect(
      getRequestId(new Request("https://app.example.com", { headers: { "x-request-id": "req-42" } })),
    ).toBe("req-42");
    expect(getRequestId(new Request("https://app.example.com"))).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });
});

describe("API errors", () => {
  it("serializes known errors with status, code, fields, and request ID", async () => {
    const response = toErrorResponse(
      new ApiError(422, "VALIDATION_ERROR", "输入不合法", { phone: ["请输入有效手机号"] }),
      "req-42",
    );

    expect(response.status).toBe(422);
    expect(response.headers.get("content-type")).toContain("application/json");
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "VALIDATION_ERROR",
        message: "输入不合法",
        fieldErrors: { phone: ["请输入有效手机号"] },
        requestId: "req-42",
      },
    });
  });

  it("hides unknown error details behind a generic Chinese message", async () => {
    const response = toErrorResponse(new Error("postgresql://secret@db.example.com"), "req-99");

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "INTERNAL_ERROR",
        message: "服务器内部错误，请稍后重试",
        requestId: "req-99",
      },
    });
  });
});
