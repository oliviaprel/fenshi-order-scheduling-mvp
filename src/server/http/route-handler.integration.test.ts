import { describe, expect, it } from "vitest";
import { routeHandler } from "./route-handler";

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
});
