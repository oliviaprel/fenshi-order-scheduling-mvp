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
});
