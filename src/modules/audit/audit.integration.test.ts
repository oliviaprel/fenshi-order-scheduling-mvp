import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../../server/db/client";
import { resetTestDatabase } from "../../server/db/test-database";
import { createAdmin } from "../users/user.service";
import { writeAudit } from "./audit.service";

describe("audit records", () => {
  beforeEach(resetTestDatabase);

  it("never stores a password or password hash in administrator audit JSON", async () => {
    await createAdmin(
      { displayName: "系统管理员", phone: "13800138000", password: "secure-pass-2026" },
      { requestId: "cli-admin-create" },
    );

    const audit = await prisma.auditLog.findFirstOrThrow();
    const serializedAudit = JSON.stringify(audit);
    expect(serializedAudit).not.toContain("secure-pass-2026");
    expect(serializedAudit).not.toContain("passwordHash");
    expect(audit.afterJson).toMatchObject({
      role: "ADMIN",
      phone: "13800138000",
      status: "ACTIVE",
      mustChangePassword: false,
    });
  });

  it("persists the supplied audit entry through the active transaction", async () => {
    await prisma.$transaction(async (tx) => {
      await writeAudit(tx, {
        action: "USER_UPDATED",
        targetType: "User",
        targetId: "example-user",
        before: { status: "PAUSED" },
        after: {
          status: "ACTIVE",
          password: "never-store-this",
          passwordHash: "never-store-this-hash",
          token: "never-store-this-token",
        },
        requestId: "audit-service-test",
      });
    });

    await expect(prisma.auditLog.findFirstOrThrow()).resolves.toMatchObject({
      action: "USER_UPDATED",
      targetType: "User",
      targetId: "example-user",
      beforeJson: { status: "PAUSED" },
      afterJson: { status: "ACTIVE" },
      requestId: "audit-service-test",
    });

    const audit = await prisma.auditLog.findFirstOrThrow();
    expect(audit.afterJson).toEqual({ status: "ACTIVE" });
  });
});
