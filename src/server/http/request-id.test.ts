import { describe, expect, it } from "vitest";
import { getRequestId } from "./request-id";

const url = "https://app.example.com/api/orders";
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe("getRequestId", () => {
  it("preserves a 64-character request ID containing only accepted characters", () => {
    const requestId = `order:${"a".repeat(58)}`;

    expect(requestId).toHaveLength(64);
    expect(getRequestId(new Request(url, { headers: { "x-request-id": requestId } }))).toBe(requestId);
  });

  it("replaces a 65-character request ID with a server UUID", () => {
    expect(getRequestId(new Request(url, { headers: { "x-request-id": "x".repeat(65) } }))).toMatch(
      uuidPattern,
    );
  });

  it("replaces an unsafe request ID with a server UUID", () => {
    expect(getRequestId(new Request(url, { headers: { "x-request-id": "order/42" } }))).toMatch(uuidPattern);
  });

  it("generates a server UUID when the request ID is absent", () => {
    expect(getRequestId(new Request(url))).toMatch(uuidPattern);
  });
});
