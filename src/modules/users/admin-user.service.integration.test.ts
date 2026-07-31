import { Client } from "pg";
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../../server/db/client";
import { resetTestDatabase } from "../../server/db/test-database";
import type { ApiError } from "../../server/http/api-error";
import { login } from "../auth/auth.service";
import { verifyPassword } from "../auth/password";
import {
  createManagedUser,
  listManagedUsers,
  resetManagedUserPassword,
  updateManagedUser,
} from "./admin-user.service";
import { createAdmin } from "./user.service";

async function createTestAdmin(phone = "13900139000") {
  return createAdmin(
    { displayName: "系统管理员", phone, password: "secure-admin-pass-2026" },
    { requestId: `create-admin-${phone}` },
  );
}

async function createTestUser(
  actorUserId: string,
  options: { displayName?: string; phone?: string; requestId?: string } = {},
) {
  return createManagedUser(
    {
      displayName: options.displayName ?? "清和堂",
      phone: options.phone ?? "13800138000",
    },
    {
      actorUserId,
      requestId: options.requestId ?? "create-managed-user",
    },
  );
}

async function createStoredSession(userId: string, marker: string): Promise<void> {
  await prisma.session.create({
    data: {
      tokenHash: marker.padEnd(64, "0"),
      userId,
      createdAt: new Date("2026-07-31T00:00:00.000Z"),
      lastSeenAt: new Date("2026-07-31T00:00:00.000Z"),
      expiresAt: new Date("2026-08-07T00:00:00.000Z"),
    },
  });
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

describe("administrator user management service", () => {
  beforeEach(resetTestDatabase);

  it("creates only a USER with a one-time cryptographically sized password and no secret audit data", async () => {
    const admin = await createTestAdmin();

    const result = await createTestUser(admin.id, {
      phone: "+86 138-0013-8000",
      requestId: "create-user-secret-safety",
    });

    expect(result.user).toMatchObject({
      role: "USER",
      displayName: "清和堂",
      phone: "13800138000",
      status: "ACTIVE",
      mustChangePassword: true,
      version: 1,
    });
    expect(result.user).not.toHaveProperty("passwordHash");
    expect(result.temporaryPassword.length).toBeGreaterThanOrEqual(16);

    const stored = await prisma.user.findUniqueOrThrow({ where: { id: result.user.id } });
    expect(await verifyPassword(stored.passwordHash, result.temporaryPassword)).toBe(true);
    expect(stored.passwordHash).not.toContain(result.temporaryPassword);

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: "USER_CREATED", targetId: result.user.id },
    });
    expect(audit).toMatchObject({
      actorUserId: admin.id,
      requestId: "create-user-secret-safety",
    });
    expect(JSON.stringify(audit)).not.toContain(result.temporaryPassword);
    expect(JSON.stringify(audit)).not.toContain(stored.passwordHash);
  });

  it("lists only editable USER targets, paginates by UUID, and searches names or normalized phones", async () => {
    const admin = await createTestAdmin();
    const first = await createTestUser(admin.id, {
      displayName: "清和堂",
      phone: "13800138000",
      requestId: "create-first-search-user",
    });
    const second = await createTestUser(admin.id, {
      displayName: "安宁服务部",
      phone: "13700137000",
      requestId: "create-second-search-user",
    });

    const firstPage = await listManagedUsers({ limit: 1 });
    expect(firstPage.items).toHaveLength(1);
    expect(firstPage.items[0]).toMatchObject({ role: "USER" });
    expect(firstPage.nextCursor).toBe(firstPage.items[0]?.id);

    const secondPage = await listManagedUsers({ limit: 1, cursor: firstPage.nextCursor! });
    expect(secondPage.items).toHaveLength(1);
    expect(secondPage.items[0]?.id).not.toBe(firstPage.items[0]?.id);
    expect(secondPage.nextCursor).toBeNull();

    await expect(listManagedUsers({ query: "清和", limit: 30 })).resolves.toMatchObject({
      items: [{ id: first.user.id, displayName: "清和堂" }],
    });
    await expect(
      listManagedUsers({ query: "+86 137-0013-7000", limit: 30 }),
    ).resolves.toMatchObject({ items: [{ id: second.user.id, phone: "13700137000" }] });

    const allTargets = await listManagedUsers({ limit: 30 });
    expect(allTargets.items.map((item) => item.id)).not.toContain(admin.id);
    expect(allTargets.items.every((item) => item.role === "USER")).toBe(true);
    expect(allTargets.items.every((item) => !("passwordHash" in item))).toBe(true);
  });

  it("rejects a stale optimistic-lock version and distinguishes missing and ADMIN targets", async () => {
    const admin = await createTestAdmin();
    const { user } = await createTestUser(admin.id);
    const context = { actorUserId: admin.id, requestId: "update-errors" };

    await expect(
      updateManagedUser(
        user.id,
        {
          displayName: "新名称",
          phone: user.phone,
          status: "ACTIVE",
          version: user.version - 1,
        },
        context,
      ),
    ).rejects.toMatchObject({
      status: 409,
      code: "USER_VERSION_CONFLICT",
    } satisfies Partial<ApiError>);

    await expect(
      updateManagedUser(
        "00000000-0000-0000-0000-000000000001",
        {
          displayName: "不存在",
          phone: "13600136000",
          status: "ACTIVE",
          version: 1,
        },
        context,
      ),
    ).rejects.toMatchObject({ status: 404, code: "USER_NOT_FOUND" } satisfies Partial<ApiError>);

    await expect(
      updateManagedUser(
        admin.id,
        {
          displayName: admin.displayName,
          phone: admin.phone,
          status: admin.status,
          version: admin.version,
        },
        context,
      ),
    ).rejects.toMatchObject({ status: 403 } satisfies Partial<ApiError>);
    await expect(resetManagedUserPassword(admin.id, context)).rejects.toMatchObject({
      status: 403,
    } satisfies Partial<ApiError>);
  });

  it("updates name, normalized phone, and PAUSED status with version + 1 without revoking sessions", async () => {
    const admin = await createTestAdmin();
    const { user } = await createTestUser(admin.id);
    await createStoredSession(user.id, "paused-session");

    const updated = await updateManagedUser(
      user.id,
      {
        displayName: "新名称",
        phone: "+86 136-0013-6000",
        status: "PAUSED",
        version: user.version,
      },
      { actorUserId: admin.id, requestId: "pause-user" },
    );

    expect(updated).toMatchObject({
      displayName: "新名称",
      phone: "13600136000",
      status: "PAUSED",
      version: user.version + 1,
    });
    expect(await prisma.session.count({ where: { userId: user.id } })).toBe(1);
    await expect(
      prisma.auditLog.findFirstOrThrow({ where: { action: "USER_UPDATED", targetId: user.id } }),
    ).resolves.toMatchObject({ requestId: "pause-user" });
  });

  it("returns 409 when creating or updating to a duplicate normalized phone", async () => {
    const admin = await createTestAdmin();
    const first = await createTestUser(admin.id, { phone: "13800138000" });

    await expect(
      createTestUser(admin.id, {
        displayName: "重复手机号",
        phone: "+86 138-0013-8000",
        requestId: "duplicate-create-phone",
      }),
    ).rejects.toMatchObject({ status: 409, code: "PHONE_ALREADY_EXISTS" } satisfies Partial<ApiError>);

    const second = await createTestUser(admin.id, {
      displayName: "第二位用户",
      phone: "13700137000",
      requestId: "create-second-for-conflict",
    });
    await expect(
      updateManagedUser(
        second.user.id,
        {
          displayName: second.user.displayName,
          phone: first.user.phone,
          status: second.user.status,
          version: second.user.version,
        },
        { actorUserId: admin.id, requestId: "duplicate-update-phone" },
      ),
    ).rejects.toMatchObject({ status: 409, code: "PHONE_ALREADY_EXISTS" } satisfies Partial<ApiError>);
  });

  it("disables a user and revokes every session with its audit in one transaction", async () => {
    const admin = await createTestAdmin();
    const { user } = await createTestUser(admin.id);
    await createStoredSession(user.id, "disable-session-one");
    await createStoredSession(user.id, "disable-session-two");

    const updated = await updateManagedUser(
      user.id,
      {
        displayName: user.displayName,
        phone: user.phone,
        status: "DISABLED",
        version: user.version,
      },
      { actorUserId: admin.id, requestId: "disable-user" },
    );

    expect(updated).toMatchObject({ status: "DISABLED", version: user.version + 1 });
    expect(await prisma.session.count({ where: { userId: user.id } })).toBe(0);
    await expect(
      prisma.auditLog.findFirstOrThrow({ where: { action: "USER_DISABLED", targetId: user.id } }),
    ).resolves.toMatchObject({ actorUserId: admin.id, requestId: "disable-user" });
  });

  it("rolls back the disabled status and session revocation when its audit write fails", async () => {
    const admin = await createTestAdmin();
    const { user } = await createTestUser(admin.id);
    await createStoredSession(user.id, "rollback-disable-session");

    await expect(
      updateManagedUser(
        user.id,
        {
          displayName: user.displayName,
          phone: user.phone,
          status: "DISABLED",
          version: user.version,
        },
        { actorUserId: admin.id, requestId: "x".repeat(101) },
      ),
    ).rejects.toBeTruthy();

    await expect(prisma.user.findUniqueOrThrow({ where: { id: user.id } })).resolves.toMatchObject({
      status: "ACTIVE",
      version: user.version,
    });
    expect(await prisma.session.count({ where: { userId: user.id } })).toBe(1);
  });

  it("resets a USER password, requires a password change, revokes sessions, and audits no secret", async () => {
    const admin = await createTestAdmin();
    const created = await createTestUser(admin.id);
    const originalHash = (
      await prisma.user.findUniqueOrThrow({ where: { id: created.user.id } })
    ).passwordHash;
    await prisma.user.update({
      where: { id: created.user.id },
      data: { mustChangePassword: false },
    });
    await createStoredSession(created.user.id, "reset-session-one");
    await createStoredSession(created.user.id, "reset-session-two");

    const result = await resetManagedUserPassword(created.user.id, {
      actorUserId: admin.id,
      requestId: "reset-user-password",
    });

    expect(result.temporaryPassword.length).toBeGreaterThanOrEqual(16);
    const stored = await prisma.user.findUniqueOrThrow({ where: { id: created.user.id } });
    expect(stored.passwordHash).not.toBe(originalHash);
    expect(await verifyPassword(stored.passwordHash, result.temporaryPassword)).toBe(true);
    expect(stored.mustChangePassword).toBe(true);
    expect(stored.version).toBe(created.user.version + 1);
    expect(await prisma.session.count({ where: { userId: created.user.id } })).toBe(0);

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: "USER_PASSWORD_RESET", targetId: created.user.id },
    });
    expect(audit).toMatchObject({ actorUserId: admin.id, requestId: "reset-user-password" });
    expect(JSON.stringify(audit)).not.toContain(result.temporaryPassword);
    expect(JSON.stringify(audit)).not.toContain(stored.passwordHash);
  });

  it(
    "does not leave a session when a login races with a committed disable",
    async () => {
      const admin = await createTestAdmin();
      const created = await createTestUser(admin.id);
      await createStoredSession(created.user.id, "preexisting-disable-session");

      const gateKey = 820_260_731;
      const gateClient = new Client({ connectionString: process.env.DATABASE_URL });
      let gateLocked = false;
      let disableOperation: ReturnType<typeof updateManagedUser> | undefined;
      let loginOperation: ReturnType<typeof login> | undefined;

      await gateClient.connect();
      try {
        await prisma.$executeRawUnsafe(`
          CREATE OR REPLACE FUNCTION test_gate_disable_update()
          RETURNS trigger
          LANGUAGE plpgsql
          AS $$
          BEGIN
            IF NEW."status" = 'DISABLED' AND OLD."status" IS DISTINCT FROM NEW."status" THEN
              PERFORM pg_advisory_xact_lock(${gateKey});
            END IF;
            RETURN NEW;
          END;
          $$
        `);
        await prisma.$executeRawUnsafe(`
          CREATE TRIGGER test_gate_disable_update_trigger
          AFTER UPDATE OF "status" ON "User"
          FOR EACH ROW
          EXECUTE FUNCTION test_gate_disable_update()
        `);
        await prisma.$executeRawUnsafe(`
          CREATE OR REPLACE FUNCTION test_gate_disable_session_delete()
          RETURNS trigger
          LANGUAGE plpgsql
          AS $$
          BEGIN
            PERFORM pg_advisory_xact_lock(${gateKey});
            RETURN OLD;
          END;
          $$
        `);
        await prisma.$executeRawUnsafe(`
          CREATE TRIGGER test_gate_disable_session_delete_trigger
          BEFORE DELETE ON "Session"
          FOR EACH ROW
          EXECUTE FUNCTION test_gate_disable_session_delete()
        `);
        await gateClient.query("SELECT pg_advisory_lock($1)", [gateKey]);
        gateLocked = true;

        disableOperation = updateManagedUser(
          created.user.id,
          {
            displayName: created.user.displayName,
            phone: created.user.phone,
            status: "DISABLED",
            version: created.user.version,
          },
          { actorUserId: admin.id, requestId: "concurrent-disable" },
        );
        await waitForLockWaiters(gateClient, 1);

        loginOperation = login(
          { phone: created.user.phone, password: created.temporaryPassword },
          {
            ip: "127.0.0.1",
            now: new Date("2026-07-31T00:01:00.000Z"),
            requestId: "concurrent-disable-login",
          },
        );
        await waitForLoginInterleaving(gateClient, created.user.id);

        await gateClient.query("SELECT pg_advisory_unlock($1)", [gateKey]);
        gateLocked = false;

        const [disableResult, loginResult] = await Promise.allSettled([
          disableOperation,
          loginOperation,
        ]);
        expect(disableResult.status).toBe("fulfilled");
        expect(loginResult.status).toBe("rejected");
        if (loginResult.status === "rejected") {
          expect(loginResult.reason).toMatchObject({ status: 401, code: "INVALID_CREDENTIALS" });
        }
        await expect(
          prisma.user.findUniqueOrThrow({ where: { id: created.user.id } }),
        ).resolves.toMatchObject({ status: "DISABLED" });
        expect(await prisma.session.count({ where: { userId: created.user.id } })).toBe(0);
      } finally {
        if (gateLocked) {
          await gateClient.query("SELECT pg_advisory_unlock($1)", [gateKey]);
        }
        const pendingOperations: Promise<unknown>[] = [];
        if (disableOperation !== undefined) {
          pendingOperations.push(disableOperation);
        }
        if (loginOperation !== undefined) {
          pendingOperations.push(loginOperation);
        }
        await Promise.allSettled(pendingOperations);
        await prisma.$executeRawUnsafe(
          'DROP TRIGGER IF EXISTS test_gate_disable_session_delete_trigger ON "Session"',
        );
        await prisma.$executeRawUnsafe(
          'DROP TRIGGER IF EXISTS test_gate_disable_update_trigger ON "User"',
        );
        await prisma.$executeRawUnsafe(
          "DROP FUNCTION IF EXISTS test_gate_disable_session_delete()",
        );
        await prisma.$executeRawUnsafe("DROP FUNCTION IF EXISTS test_gate_disable_update()");
        await gateClient.end();
      }
    },
    15_000,
  );
});
