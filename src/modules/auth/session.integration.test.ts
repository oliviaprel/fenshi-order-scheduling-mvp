import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../../server/db/client";
import { resetTestDatabase } from "../../server/db/test-database";
import { createAdmin } from "../users/user.service";
import { login } from "./auth.service";
import { authenticateSession, logout } from "./session.service";
import { hashSessionToken } from "./session-token";

async function loginAt(now = new Date("2026-07-31T00:00:00.000Z")) {
  const user = await createAdmin(
    { displayName: "系统管理员", phone: "13800138000", password: "secure-pass-2026" },
    { requestId: "create-session-user" },
  );
  return login(
    { phone: user.phone, password: "secure-pass-2026" },
    { ip: "127.0.0.1", now, requestId: "create-session" },
  );
}

describe("session lifecycle", () => {
  beforeEach(resetTestDatabase);

  it("returns null for an expired session and deletes it at the fixed expiry boundary", async () => {
    const result = await loginAt();

    await expect(
      authenticateSession(result.token, new Date("2026-08-07T00:00:00.000Z")),
    ).resolves.toBeNull();
    expect(await prisma.session.count()).toBe(0);
  });

  it("does not write lastSeenAt within fifteen minutes and writes only after fifteen minutes", async () => {
    const result = await loginAt();
    const tokenHash = hashSessionToken(result.token);

    await expect(
      authenticateSession(result.token, new Date("2026-07-31T00:14:59.999Z")),
    ).resolves.toMatchObject({ id: result.user.id, sessionId: expect.any(String) });
    await expect(
      prisma.session.findUniqueOrThrow({ where: { tokenHash } }),
    ).resolves.toMatchObject({ lastSeenAt: new Date("2026-07-31T00:00:00.000Z") });

    await expect(
      authenticateSession(result.token, new Date("2026-07-31T00:15:00.001Z")),
    ).resolves.toMatchObject({ id: result.user.id });
    await expect(
      prisma.session.findUniqueOrThrow({ where: { tokenHash } }),
    ).resolves.toMatchObject({
      lastSeenAt: new Date("2026-07-31T00:15:00.001Z"),
      expiresAt: new Date("2026-08-07T00:00:00.000Z"),
    });
  });

  it("returns null for a missing token and logout deletes only the current session", async () => {
    await expect(authenticateSession(undefined, new Date("2026-07-31T00:00:00.000Z"))).resolves.toBeNull();
    await expect(logout(undefined)).resolves.toBeUndefined();

    const first = await loginAt();
    const second = await login(
      { phone: first.user.phone, password: "secure-pass-2026" },
      {
        ip: "127.0.0.2",
        now: new Date("2026-07-31T00:01:00.000Z"),
        requestId: "second-session",
      },
    );

    await logout(first.token);

    expect(
      await prisma.session.findUnique({ where: { tokenHash: hashSessionToken(first.token) } }),
    ).toBeNull();
    await expect(
      prisma.session.findUniqueOrThrow({ where: { tokenHash: hashSessionToken(second.token) } }),
    ).resolves.toMatchObject({ userId: first.user.id });
  });
});
