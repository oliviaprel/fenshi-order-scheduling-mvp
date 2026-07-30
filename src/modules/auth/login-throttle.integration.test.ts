import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../../server/db/client";
import { resetTestDatabase } from "../../server/db/test-database";
import { createAdmin } from "../users/user.service";
import { login } from "./auth.service";

const failureTime = new Date("2026-07-31T00:00:00.000Z");

async function createLoginUser(phone = "13800138000") {
  return createAdmin(
    { displayName: "系统管理员", phone, password: "secure-pass-2026" },
    { requestId: `create-${phone}` },
  );
}

function expectedThrottleHash(scope: "phone" | "ip", value: string): string {
  return createHash("sha256").update(`${scope}:${value}`).digest("hex");
}

describe("database-backed login throttling", () => {
  beforeEach(resetTestDatabase);

  it("atomically retains all five concurrent failures for both the phone and IP", async () => {
    await createLoginUser();

    const attempts = Array.from({ length: 5 }, (_, index) =>
      login(
        { phone: "13800138000", password: "wrong-password" },
        {
          ip: "203.0.113.10",
          now: failureTime,
          requestId: `concurrent-failure-${index}`,
        },
      ),
    );

    const results = await Promise.allSettled(attempts);
    expect(results).toHaveLength(5);
    for (const result of results) {
      expect(result.status).toBe("rejected");
      if (result.status === "rejected") {
        expect(result.reason).toMatchObject({ status: 401, code: "INVALID_CREDENTIALS" });
      }
    }

    await expect(
      login(
        { phone: "13800138000", password: "secure-pass-2026" },
        {
          ip: "203.0.113.10",
          now: new Date("2026-07-31T00:01:00.000Z"),
          requestId: "blocked-after-concurrent-failures",
        },
      ),
    ).rejects.toMatchObject({ status: 429, code: "LOGIN_BLOCKED" });

    await expect(
      prisma.loginThrottle.findMany({
        orderBy: { keyHash: "asc" },
        select: { keyHash: true, failureCount: true, blockedUntil: true },
      }),
    ).resolves.toEqual(
      [
        {
          keyHash: expectedThrottleHash("phone", "13800138000"),
          failureCount: 5,
          blockedUntil: new Date("2026-07-31T00:15:00.000Z"),
        },
        {
          keyHash: expectedThrottleHash("ip", "203.0.113.10"),
          failureCount: 5,
          blockedUntil: new Date("2026-07-31T00:15:00.000Z"),
        },
      ].sort((left, right) => left.keyHash.localeCompare(right.keyHash)),
    );
  });

  it("returns exactly five credential errors and one block for six concurrent failures", async () => {
    await createLoginUser();

    const results = await Promise.allSettled(
      Array.from({ length: 6 }, (_, index) =>
        login(
          { phone: "13800138000", password: "wrong-password" },
          {
            ip: "203.0.113.10",
            now: failureTime,
            requestId: `six-way-failure-${index}`,
          },
        ),
      ),
    );

    const errorCodes = results
      .map((result) => {
        expect(result.status).toBe("rejected");
        return result.status === "rejected"
          ? (result.reason as { code?: string }).code
          : "UNEXPECTED_SUCCESS";
      })
      .sort();

    expect(errorCodes).toEqual([
      "INVALID_CREDENTIALS",
      "INVALID_CREDENTIALS",
      "INVALID_CREDENTIALS",
      "INVALID_CREDENTIALS",
      "INVALID_CREDENTIALS",
      "LOGIN_BLOCKED",
    ]);

    await expect(
      prisma.loginThrottle.findMany({
        orderBy: { keyHash: "asc" },
        select: { keyHash: true, failureCount: true, blockedUntil: true },
      }),
    ).resolves.toEqual(
      [
        {
          keyHash: expectedThrottleHash("phone", "13800138000"),
          failureCount: 5,
          blockedUntil: new Date("2026-07-31T00:15:00.000Z"),
        },
        {
          keyHash: expectedThrottleHash("ip", "203.0.113.10"),
          failureCount: 5,
          blockedUntil: new Date("2026-07-31T00:15:00.000Z"),
        },
      ].sort((left, right) => left.keyHash.localeCompare(right.keyHash)),
    );
  });

  it("blocks either a normalized phone or a shared IP until the fifteen-minute block expires", async () => {
    await createLoginUser("13800138000");
    await createLoginUser("13900139000");

    for (let index = 0; index < 5; index += 1) {
      await expect(
        login(
          { phone: "13800138000", password: "wrong-password" },
          {
            ip: "203.0.113.10",
            now: failureTime,
            requestId: `failure-${index}`,
          },
        ),
      ).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
    }

    await expect(
      login(
        { phone: "+86 138-0013-8000", password: "secure-pass-2026" },
        {
          ip: "203.0.113.11",
          now: new Date("2026-07-31T00:14:59.999Z"),
          requestId: "phone-still-blocked",
        },
      ),
    ).rejects.toMatchObject({ status: 429, code: "LOGIN_BLOCKED" });

    await expect(
      login(
        { phone: "13900139000", password: "secure-pass-2026" },
        {
          ip: "203.0.113.10",
          now: new Date("2026-07-31T00:14:59.999Z"),
          requestId: "ip-still-blocked",
        },
      ),
    ).rejects.toMatchObject({ status: 429, code: "LOGIN_BLOCKED" });

    await expect(
      login(
        { phone: "13800138000", password: "secure-pass-2026" },
        {
          ip: "203.0.113.11",
          now: new Date("2026-07-31T00:15:00.000Z"),
          requestId: "block-expired",
        },
      ),
    ).resolves.toMatchObject({ user: { phone: "13800138000" } });
  });

  it("clears only the phone failure history after a successful login", async () => {
    await createLoginUser();

    await expect(
      login(
        { phone: "13800138000", password: "wrong-password" },
        { ip: "203.0.113.10", now: failureTime, requestId: "one-failure" },
      ),
    ).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });

    await login(
      { phone: "13800138000", password: "secure-pass-2026" },
      {
        ip: "203.0.113.10",
        now: new Date("2026-07-31T00:01:00.000Z"),
        requestId: "successful-login",
      },
    );

    expect(
      await prisma.loginThrottle.findUnique({
        where: { keyHash: expectedThrottleHash("phone", "13800138000") },
      }),
    ).toBeNull();
    await expect(
      prisma.loginThrottle.findUniqueOrThrow({
        where: { keyHash: expectedThrottleHash("ip", "203.0.113.10") },
      }),
    ).resolves.toMatchObject({ failureCount: 1 });
  });
});
