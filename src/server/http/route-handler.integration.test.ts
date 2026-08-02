import { describe, expect, it } from "vitest";
import { z } from "zod";
import { parseJsonBody, routeHandler } from "./route-handler";

const url = "http://localhost:3000/api/test";
const bodySchema = z.object({ value: z.string() });

function parseBodyThroughRouteHandler(request: Request): Promise<Response> {
  return routeHandler(request, async ({ request: routeRequest }) =>
    Response.json(await parseJsonBody(routeRequest, bodySchema)),
  );
}

describe("routeHandler", () => {
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
});
