import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ApiError } from "./api-error";
import { parseJsonBody, routeHandler } from "./route-handler";

const url = "http://localhost:3000/api/test";
const bodySchema = z.object({ value: z.string() });

function parseBodyThroughRouteHandler(request: Request): Promise<Response> {
  return routeHandler(request, async ({ request: routeRequest }) =>
    Response.json(await parseJsonBody(routeRequest, bodySchema)),
  );
}

describe("routeHandler", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("preserves a framework request with cookies across module boundaries", async () => {
    const request = new Request("http://localhost:3000/api/test");
    Object.defineProperty(request, "cookies", {
      value: { get: () => undefined },
    });

    const response = await routeHandler(request, async ({ request: routeRequest }) =>
      Response.json({ preserved: routeRequest === request }),
    );

    await expect(response.json()).resolves.toEqual({ preserved: true });
  });

  it("accepts a JSON request body of exactly 32,768 bytes", async () => {
    const value = "x".repeat(32_756);
    const body = `{"value":"${value}"}`;

    expect(new TextEncoder().encode(body)).toHaveLength(32_768);

    const response = await parseBodyThroughRouteHandler(
      new Request(url, { method: "POST", headers: { "content-length": "32768" }, body }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ value });
  });

  it("rejects a JSON request body of 32,769 bytes before parsing it", async () => {
    const body = `{"value":"${"x".repeat(32_757)}"}`;

    expect(new TextEncoder().encode(body)).toHaveLength(32_769);

    const response = await parseBodyThroughRouteHandler(
      new Request(url, { method: "POST", headers: { "content-length": "32769" }, body }),
    );

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "PAYLOAD_TOO_LARGE" } });
  });

  it("rejects a chunked oversized request body without a Content-Length header", async () => {
    const chunks = [
      new TextEncoder().encode('{"value":"'),
      new TextEncoder().encode("x".repeat(32_757)),
      new TextEncoder().encode('"}'),
    ];
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        const chunk = chunks.shift();
        if (chunk === undefined) controller.close();
        else controller.enqueue(chunk);
      },
    });
    const request = new Request(url, {
      method: "POST",
      body,
      duplex: "half",
    } as RequestInit & { duplex: "half" });

    expect(request.headers.get("content-length")).toBeNull();

    const response = await parseBodyThroughRouteHandler(request);

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "PAYLOAD_TOO_LARGE" } });
  });

  it("returns payload too large when cancelling an oversized stream fails", async () => {
    const chunks = [
      new TextEncoder().encode('{"value":"'),
      new TextEncoder().encode("x".repeat(32_757)),
      new TextEncoder().encode('"}'),
    ];
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        const chunk = chunks.shift();
        if (chunk === undefined) controller.close();
        else controller.enqueue(chunk);
      },
      cancel() {
        return Promise.reject(new Error("cancel failed"));
      },
    });
    const request = new Request(url, {
      method: "POST",
      body,
      duplex: "half",
    } as RequestInit & { duplex: "half" });
    Object.defineProperty(request, "cookies", { value: { get: () => undefined } });

    const response = await parseBodyThroughRouteHandler(request);

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "PAYLOAD_TOO_LARGE" } });
  });

  it("reports malformed JSON with the existing invalid JSON error", async () => {
    const response = await parseBodyThroughRouteHandler(
      new Request(url, { method: "POST", body: '{"value":' }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "INVALID_JSON" } });
  });

  it("logs one safe structured error for an unknown route failure", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const request = new Request(`${url}?attempt=1`, {
      method: "POST",
      body: JSON.stringify({ password: "must-never-be-logged" }),
    });

    const response = await routeHandler(request, async () => {
      throw new Error("postgresql://user:password@database/private");
    });

    expect(response.status).toBe(500);
    expect(log).toHaveBeenCalledTimes(1);
    expect(JSON.parse(log.mock.calls[0]?.[0] as string)).toEqual({
      timestamp: expect.any(String),
      level: "error",
      message: "Unhandled route error",
      requestId: response.headers.get("x-request-id"),
      method: "POST",
      pathname: "/api/test",
      errorName: "Error",
    });
  });

  it("does not duplicate an expected ApiError in the unknown error log", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    const response = await routeHandler(new Request(url), async () => {
      throw new ApiError(403, "FORBIDDEN", "Forbidden");
    });

    expect(response.status).toBe(403);
    expect(log).not.toHaveBeenCalled();
  });
});
