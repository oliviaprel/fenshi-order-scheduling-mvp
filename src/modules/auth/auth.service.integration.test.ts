import { beforeEach, describe, expect, it } from "vitest";
import { Client } from "pg";
import { prisma } from "../../server/db/client";
import { resetTestDatabase } from "../../server/db/test-database";
import type { ApiError } from "../../server/http/api-error";
import { createAdmin } from "../users/user.service";
import { verifyPassword } from "./password";
import { authenticateSession } from "./session.service";
import { hashSessionToken } from "./session-token";
import { changeOwnPassword, login } from "./auth.service";

async function createUser(phone = "13800138000") {
  return createAdmin(
    { displayName: "系统管理员", phone, password: "secure-pass-2026" },
    { requestId: `create-${phone}` },
  );
}

async function captureApiError(operation: Promise<unknown>): Promise<ApiError> {
  try {
    await operation;
    throw new Error("Expected operation to reject");
  } catch (error) {
    return error as ApiError;
  }
}

async function waitForLockWaiters(client: Client, minimum: number): Promise<void> {
  for (let attempt = 0; attempt < 1_000; attempt += 1) {
    const result = await client.query<{ waiting: string }>(`
      SELECT COUNT(*)::text AS waiting
      FROM pg_stat_activity
      WHERE datname = current_database()
        AND wait_event_type = 'Lock'
    `);
    if (Number(result.rows[0]?.waiting ?? 0) >= minimum) {
      return;
    }
    await new Promise<void>((resolve) => setImmediate(resolve));
  }

  throw new Error(`Expected at least ${minimum} PostgreSQL lock waiters`);
}

async function waitForLoginInterleaving(client: Client, userId: string): Promise<void> {
  for (let attempt = 0; attempt < 1_000; attempt += 1) {
    const result = await client.query<{ sessions: string; waiting: string }>(
      `
        SELECT
          (SELECT COUNT(*)::text FROM "Session" WHERE "userId" = $1::uuid) AS sessions,
          (
            SELECT COUNT(*)::text
            FROM pg_stat_activity
            WHERE datname = current_database()
              AND wait_event_type = 'Lock'
          ) AS waiting
      `,
      [userId],
    );
    const row = result.rows[0];
    if (Number(row?.sessions ?? 0) >= 2 || Number(row?.waiting ?? 0) >= 2) {
      return;
    }
    await new Promise<void>((resolve) => setImmediate(resolve));
  }

  throw new Error("Concurrent login neither completed nor waited on the user lock");
}

describe("authentication service", () => {
  beforeEach(resetTestDatabase);

  it("creates a fixed seven-day session for a valid active user without storing the raw token", async () => {
    await createUser();
    const result = await login(
      { phone: "13800138000", password: "secure-pass-2026" },
      {
        ip: "127.0.0.1",
        now: new Date("2026-07-31T00:00:00.000Z"),
        requestId: "valid-login",
      },
    );

    expect(result.token).toBeTruthy();
    expect(result.user).toMatchObject({ phone: "13800138000", status: "ACTIVE" });
    expect(result.user).not.toHaveProperty("passwordHash");
    expect(result.expiresAt.toISOString()).toBe("2026-08-07T00:00:00.000Z");

    const stored = await prisma.session.findFirstOrThrow();
    expect(stored).not.toHaveProperty("token");
    expect(stored.tokenHash).toBe(hashSessionToken(result.token));
    expect(JSON.stringify(stored)).not.toContain(result.token);

    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: "LOGIN_SUCCEEDED" } });
    expect(audit).toMatchObject({
      actorUserId: result.user.id,
      targetType: "User",
      targetId: result.user.id,
      requestId: "valid-login",
    });
    expect(JSON.stringify(audit)).not.toContain(result.token);
  });

  it("returns the same external error for an unknown phone and a wrong password", async () => {
    await createUser();

    const wrongPassword = await captureApiError(
      login(
        { phone: "13800138000", password: "wrong-password" },
        { ip: "203.0.113.1", now: new Date("2026-07-31T00:00:00.000Z"), requestId: "wrong" },
      ),
    );
    const unknownPhone = await captureApiError(
      login(
        { phone: "13900139000", password: "wrong-password" },
        { ip: "203.0.113.2", now: new Date("2026-07-31T00:00:00.000Z"), requestId: "unknown" },
      ),
    );

    expect(wrongPassword).toMatchObject({ status: 401, code: "INVALID_CREDENTIALS" });
    expect(unknownPhone).toMatchObject({ status: 401, code: "INVALID_CREDENTIALS" });
    expect(unknownPhone).toMatchObject({
      status: wrongPassword.status,
      code: wrongPassword.code,
      message: wrongPassword.message,
    });
  });

  it("allows PAUSED users to login but rejects DISABLED users", async () => {
    const paused = await createUser("13800138000");
    const disabled = await createUser("13900139000");
    await prisma.user.update({ where: { id: paused.id }, data: { status: "PAUSED" } });
    await prisma.user.update({ where: { id: disabled.id }, data: { status: "DISABLED" } });

    await expect(
      login(
        { phone: paused.phone, password: "secure-pass-2026" },
        { ip: "127.0.0.1", now: new Date("2026-07-31T00:00:00.000Z"), requestId: "paused" },
      ),
    ).resolves.toMatchObject({ user: { status: "PAUSED" } });
    await expect(
      login(
        { phone: disabled.phone, password: "secure-pass-2026" },
        { ip: "127.0.0.2", now: new Date("2026-07-31T00:00:00.000Z"), requestId: "disabled" },
      ),
    ).rejects.toMatchObject({ status: 401, code: "INVALID_CREDENTIALS" });
  });

  it("changes the password and revokes every other session in the same transaction", async () => {
    const user = await createUser();
    const sessions = await Promise.all(
      [1, 2, 3].map((index) =>
        login(
          { phone: user.phone, password: "secure-pass-2026" },
          {
            ip: `127.0.0.${index}`,
            now: new Date(`2026-07-31T00:0${index}:00.000Z`),
            requestId: `session-${index}`,
          },
        ),
      ),
    );
    const current = sessions[0];
    const actor = await authenticateSession(current.token, new Date("2026-07-31T00:10:00.000Z"));
    expect(actor).not.toBeNull();
    if (actor === null) {
      throw new Error("Expected an authenticated user");
    }

    await changeOwnPassword(
      actor,
      { currentPassword: "secure-pass-2026", newPassword: "new-secure-pass-2026" },
      { requestId: "change-password", currentTokenHash: hashSessionToken(current.token) },
    );

    const storedUser = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(await verifyPassword(storedUser.passwordHash, "new-secure-pass-2026")).toBe(true);
    expect(storedUser.passwordChangedAt).toBeInstanceOf(Date);
    expect(storedUser.mustChangePassword).toBe(false);

    await expect(
      prisma.session.findMany({ where: { userId: user.id }, select: { tokenHash: true } }),
    ).resolves.toEqual([{ tokenHash: hashSessionToken(current.token) }]);
    await expect(
      prisma.auditLog.findFirstOrThrow({ where: { action: "PASSWORD_CHANGED" } }),
    ).resolves.toMatchObject({
      actorUserId: user.id,
      targetId: user.id,
      requestId: "change-password",
    });
  });

  it("rolls back password and session revocation when its audit write fails", async () => {
    const user = await createUser();
    const current = await login(
      { phone: user.phone, password: "secure-pass-2026" },
      { ip: "127.0.0.1", now: new Date("2026-07-31T00:00:00.000Z"), requestId: "current" },
    );
    await login(
      { phone: user.phone, password: "secure-pass-2026" },
      { ip: "127.0.0.2", now: new Date("2026-07-31T00:01:00.000Z"), requestId: "other" },
    );
    const actor = await authenticateSession(current.token, new Date("2026-07-31T00:02:00.000Z"));
    if (actor === null) {
      throw new Error("Expected an authenticated user");
    }
    const originalHash = (await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).passwordHash;

    await expect(
      changeOwnPassword(
        actor,
        { currentPassword: "secure-pass-2026", newPassword: "new-secure-pass-2026" },
        { requestId: "x".repeat(101), currentTokenHash: hashSessionToken(current.token) },
      ),
    ).rejects.toBeTruthy();

    await expect(
      prisma.user.findUniqueOrThrow({ where: { id: user.id } }),
    ).resolves.toMatchObject({ passwordHash: originalHash, passwordChangedAt: null });
    expect(await prisma.session.count({ where: { userId: user.id } })).toBe(2);
  });

  it("rolls back session creation when the login audit write fails", async () => {
    await createUser();

    await expect(
      login(
        { phone: "13800138000", password: "secure-pass-2026" },
        {
          ip: "127.0.0.1",
          now: new Date("2026-07-31T00:00:00.000Z"),
          requestId: "x".repeat(101),
        },
      ),
    ).rejects.toMatchObject({ code: "P2000" });

    expect(await prisma.session.count()).toBe(0);
  });

  it(
    "does not create a session from an old password after a concurrent password change commits",
    async () => {
      const user = await createUser();
      const current = await login(
        { phone: user.phone, password: "secure-pass-2026" },
        {
          ip: "127.0.0.1",
          now: new Date("2026-07-31T00:00:00.000Z"),
          requestId: "current-session",
        },
      );
      const actor = await authenticateSession(
        current.token,
        new Date("2026-07-31T00:01:00.000Z"),
      );
      if (actor === null) {
        throw new Error("Expected an authenticated user");
      }

      const gateKey = 520_260_731;
      const gateClient = new Client({ connectionString: process.env.DATABASE_URL });
      let gateLocked = false;
      let changeOperation: Promise<void> | undefined;
      let loginOperation: ReturnType<typeof login> | undefined;

      await gateClient.connect();
      try {
        await prisma.$executeRawUnsafe(`
          CREATE OR REPLACE FUNCTION test_gate_password_change()
          RETURNS trigger
          LANGUAGE plpgsql
          AS $$
          BEGIN
            IF NEW."passwordHash" IS DISTINCT FROM OLD."passwordHash" THEN
              PERFORM pg_advisory_xact_lock(${gateKey});
            END IF;
            RETURN NEW;
          END;
          $$
        `);
        await prisma.$executeRawUnsafe(`
          CREATE TRIGGER test_gate_password_change_trigger
          BEFORE UPDATE OF "passwordHash" ON "User"
          FOR EACH ROW
          EXECUTE FUNCTION test_gate_password_change()
        `);
        await gateClient.query("SELECT pg_advisory_lock($1)", [gateKey]);
        gateLocked = true;

        changeOperation = changeOwnPassword(
          actor,
          {
            currentPassword: "secure-pass-2026",
            newPassword: "new-secure-pass-2026",
          },
          {
            requestId: "concurrent-password-change",
            currentTokenHash: hashSessionToken(current.token),
          },
        );
        await waitForLockWaiters(gateClient, 1);

        loginOperation = login(
          { phone: user.phone, password: "secure-pass-2026" },
          {
            ip: "127.0.0.2",
            now: new Date("2026-07-31T00:02:00.000Z"),
            requestId: "concurrent-old-password-login",
          },
        );
        await waitForLoginInterleaving(gateClient, user.id);

        await gateClient.query("SELECT pg_advisory_unlock($1)", [gateKey]);
        gateLocked = false;

        const [changeResult, loginResult] = await Promise.allSettled([
          changeOperation,
          loginOperation,
        ]);
        expect(changeResult.status).toBe("fulfilled");
        expect(loginResult.status).toBe("rejected");
        if (loginResult.status === "rejected") {
          expect(loginResult.reason).toMatchObject({
            status: 401,
            code: "INVALID_CREDENTIALS",
          });
        }
        expect(await prisma.session.count({ where: { userId: user.id } })).toBe(1);
      } finally {
        if (gateLocked) {
          await gateClient.query("SELECT pg_advisory_unlock($1)", [gateKey]);
        }
        const pendingOperations: Promise<unknown>[] = [];
        if (changeOperation !== undefined) {
          pendingOperations.push(changeOperation);
        }
        if (loginOperation !== undefined) {
          pendingOperations.push(loginOperation);
        }
        await Promise.allSettled(pendingOperations);
        await prisma.$executeRawUnsafe(
          'DROP TRIGGER IF EXISTS test_gate_password_change_trigger ON "User"',
        );
        await prisma.$executeRawUnsafe("DROP FUNCTION IF EXISTS test_gate_password_change()");
        await gateClient.end();
      }
    },
    15_000,
  );
});
