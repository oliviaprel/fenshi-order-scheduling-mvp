import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "./client";
import { resetTestDatabase } from "./test-database";

describe("foundation schema", () => {
  beforeEach(resetTestDatabase);
  afterAll(() => prisma.$disconnect());

  it("refuses to clear a database not designated for testing", async () => {
    const originalDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = "postgresql://postgres:postgres@localhost:5432/fenshi";

    try {
      await expect(resetTestDatabase()).rejects.toThrow("_test");
    } finally {
      process.env.DATABASE_URL = originalDatabaseUrl;
    }
  });

  it("enforces normalized phone uniqueness", async () => {
    const data = {
      role: "USER" as const,
      displayName: "清和堂",
      phone: "13800138000",
      passwordHash: "not-a-real-password-hash",
      status: "ACTIVE" as const,
      mustChangePassword: true,
    };

    await prisma.user.create({ data });

    await expect(prisma.user.create({ data })).rejects.toMatchObject({ code: "P2002" });
  });

  it("cancels statements that exceed the database query budget", async () => {
    const startedAt = performance.now();

    await expect(prisma.$queryRaw`SELECT pg_sleep(5)`).rejects.toBeTruthy();

    expect(performance.now() - startedAt).toBeLessThan(2_500);
    await expect(prisma.$queryRaw<Array<{ value: number }>>`SELECT 1 AS value`).resolves.toEqual([
      { value: 1 },
    ]);
    const [{ activeSleeps }] = await prisma.$queryRaw<Array<{ activeSleeps: bigint }>>`
      SELECT COUNT(*)::bigint AS "activeSleeps"
      FROM pg_stat_activity
      WHERE datname = current_database()
        AND state = 'active'
        AND query LIKE '%pg_sleep(5)%'
        AND pid <> pg_backend_pid()
    `;
    expect(Number(activeSleeps)).toBe(0);
  });
});
