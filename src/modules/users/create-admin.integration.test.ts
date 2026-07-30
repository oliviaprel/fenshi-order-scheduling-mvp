import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../../server/db/client";
import { resetTestDatabase } from "../../server/db/test-database";
import { ApiError } from "../../server/http/api-error";
import { runAdminCreation } from "./admin-cli";
import { createAdmin } from "./user.service";

describe("createAdmin", () => {
  beforeEach(resetTestDatabase);

  it("creates an active admin with a hashed password and a public DTO", async () => {
    const admin = await createAdmin(
      { displayName: "系统管理员", phone: "+86 138-0013-8000", password: "secure-pass-2026" },
      { requestId: "cli-admin-create" },
    );

    expect(admin).toMatchObject({
      role: "ADMIN",
      displayName: "系统管理员",
      phone: "13800138000",
      status: "ACTIVE",
      mustChangePassword: false,
      version: 1,
    });
    expect(admin).not.toHaveProperty("passwordHash");

    const stored = await prisma.user.findUniqueOrThrow({ where: { id: admin.id } });
    expect(stored.passwordHash).not.toContain("secure-pass-2026");
    expect(stored.passwordHash).toMatch(/^\$argon2id\$/);
  });

  it("rejects a duplicate normalized phone with PHONE_ALREADY_EXISTS", async () => {
    await createAdmin(
      { displayName: "系统管理员", phone: "13800138000", password: "secure-pass-2026" },
      { requestId: "first-create" },
    );

    await expect(
      createAdmin(
        { displayName: "另一位管理员", phone: "+86 138-0013-8000", password: "another-secure-password" },
        { requestId: "duplicate-create" },
      ),
    ).rejects.toMatchObject({ status: 409, code: "PHONE_ALREADY_EXISTS" } satisfies Partial<ApiError>);
  });

  it("rolls back the administrator when its audit entry cannot be written", async () => {
    await expect(
      createAdmin(
        { displayName: "系统管理员", phone: "13800138000", password: "secure-pass-2026" },
        { requestId: "invalid-audit-actor", actorUserId: "00000000-0000-0000-0000-000000000001" },
      ),
    ).rejects.toMatchObject({ code: "P2003" });

    expect(await prisma.user.count()).toBe(0);
    expect(await prisma.auditLog.count()).toBe(0);
  });

  it("prints only the new administrator identifier, name, and phone on CLI success", async () => {
    const output: string[] = [];
    const errors: string[] = [];

    const exitCode = await runAdminCreation({
      isInteractive: true,
      hasArguments: false,
      question: async (prompt) => (prompt === "Display name: " ? "系统管理员" : "13800138000"),
      readHiddenPassword: async () => "secure-pass-2026",
      write: (message) => output.push(message),
      writeError: (message) => errors.push(message),
    });

    expect(exitCode).toBe(0);
    expect(errors).toEqual([]);
    expect(output).toHaveLength(1);
    expect(output[0]).toMatch(/^[0-9a-f-]{36} 系统管理员 13800138000\n$/);
  });
});
