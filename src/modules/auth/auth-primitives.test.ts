import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";
import { createSessionToken, hashSessionToken } from "./session-token";
import { hashPassword, verifyPassword } from "./password";

describe("session tokens", () => {
  it("creates a 32-byte token and hashes it deterministically", () => {
    const token = createSessionToken();

    expect(Buffer.from(token, "base64url")).toHaveLength(32);
    expect(hashSessionToken(token)).toMatch(/^[a-f0-9]{64}$/);
    expect(hashSessionToken(token)).toBe(hashSessionToken(token));
  });
});

describe("password hashes", () => {
  it("creates Argon2id hashes that verify only the original password", async () => {
    const hash = await hashPassword("correct horse battery staple");

    expect(hash).toMatch(/^\$argon2id\$/);
    expect(await verifyPassword(hash, "correct horse battery staple")).toBe(true);
    expect(await verifyPassword(hash, "wrong password")).toBe(false);
  });
});
