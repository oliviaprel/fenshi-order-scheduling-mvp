import { createHash, randomBytes, randomUUID } from "node:crypto";
import { access, mkdtemp, readdir, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../../server/db/client";
import { resetTestDatabase } from "../../server/db/test-database";
import {
  EncryptedAuditArchive,
  type AuditArchive,
  type AuditArchiveRecord,
} from "./encrypted-audit-archive";
import { runMaintenance } from "./maintenance.service";

const now = new Date("2026-08-02T09:10:11.123Z");

function hash(character: string): string {
  return character.repeat(64);
}

function uniqueHash(scope: string, index: number): string {
  return createHash("sha256").update(`${scope}-${index}`).digest("hex");
}

function auditData(createdAt: Date, id = randomUUID()) {
  return {
    id,
    actorUserId: null,
    action: "MAINTENANCE_TEST",
    targetType: "Test",
    targetId: id,
    afterJson: { fixture: true },
    requestId: `request-${id}`,
    createdAt,
  };
}

describe("daily maintenance", () => {
  beforeEach(resetTestDatabase);
  afterAll(() => prisma.$disconnect());

  it("has indexes matching every bounded maintenance scan", async () => {
    const indexes = await prisma.$queryRaw<Array<{ indexName: string; indexDefinition: string }>>`
      SELECT indexname AS "indexName", indexdef AS "indexDefinition"
      FROM pg_indexes
      WHERE schemaname = current_schema()
        AND indexname IN (
          'Session_expiresAt_id_idx',
          'LoginAttemptReservation_expiresAt_id_idx',
          'LoginThrottle_updatedAt_blockedUntil_keyHash_idx',
          'AuditLog_createdAt_id_idx'
        )
      ORDER BY indexname
    `;

    expect(indexes.map((index) => index.indexName)).toEqual([
      "AuditLog_createdAt_id_idx",
      "LoginAttemptReservation_expiresAt_id_idx",
      "LoginThrottle_updatedAt_blockedUntil_keyHash_idx",
      "Session_expiresAt_id_idx",
    ]);
    expect(indexes.find((index) => index.indexName.startsWith("LoginThrottle"))?.indexDefinition)
      .toContain('("updatedAt", "blockedUntil", "keyHash")');
  });

  it("deletes at most 5000 expired rows from each ephemeral table per run", async () => {
    const user = await prisma.user.create({
      data: {
        role: "USER",
        displayName: "Bounded Cleanup User",
        phone: "13800138000",
        passwordHash: "not-a-real-password-hash",
      },
    });
    const expiredAt = new Date(now.getTime() - 1);
    const staleAt = new Date(now.getTime() - 31 * 24 * 60 * 60 * 1_000);
    await prisma.session.createMany({
      data: Array.from({ length: 5001 }, (_, index) => ({
        tokenHash: uniqueHash("session", index),
        userId: user.id,
        expiresAt: expiredAt,
      })),
    });
    await prisma.loginAttemptReservation.createMany({
      data: Array.from({ length: 5001 }, (_, index) => ({
        phoneKeyHash: uniqueHash("phone", index),
        ipKeyHash: uniqueHash("ip", index),
        expiresAt: expiredAt,
      })),
    });
    await prisma.loginThrottle.createMany({
      data: Array.from({ length: 5001 }, (_, index) => ({
        keyHash: uniqueHash("throttle", index),
        windowStartedAt: staleAt,
        failureCount: 1,
        blockedUntil: null,
        updatedAt: staleAt,
      })),
    });
    const auditArchive: AuditArchive = {
      write: async () => ({ archiveId: "unused" }),
    };

    await expect(runMaintenance({ now, auditArchive })).resolves.toMatchObject({
      expiredSessions: 5000,
      expiredReservations: 5000,
      staleThrottles: 5000,
    });
    await expect(prisma.session.count()).resolves.toBe(1);
    await expect(prisma.loginAttemptReservation.count()).resolves.toBe(1);
    await expect(prisma.loginThrottle.count()).resolves.toBe(1);

    await expect(runMaintenance({ now, auditArchive })).resolves.toMatchObject({
      expiredSessions: 1,
      expiredReservations: 1,
      staleThrottles: 1,
    });
  });

  it("removes only expired ephemeral rows and audit logs older than the strict two-year boundary", async () => {
    const user = await prisma.user.create({
      data: {
        role: "USER",
        displayName: "Maintenance User",
        phone: "13800138000",
        passwordHash: "not-a-real-password-hash",
      },
    });
    await prisma.session.createMany({
      data: [
        { tokenHash: hash("a"), userId: user.id, expiresAt: new Date(now.getTime() - 1) },
        { tokenHash: hash("b"), userId: user.id, expiresAt: now },
        { tokenHash: hash("c"), userId: user.id, expiresAt: new Date(now.getTime() + 1) },
      ],
    });
    await prisma.loginAttemptReservation.createMany({
      data: [
        {
          phoneKeyHash: hash("d"),
          ipKeyHash: hash("e"),
          expiresAt: new Date(now.getTime() - 1),
        },
        { phoneKeyHash: hash("f"), ipKeyHash: hash("0"), expiresAt: now },
        {
          phoneKeyHash: hash("1"),
          ipKeyHash: hash("2"),
          expiresAt: new Date(now.getTime() + 1),
        },
      ],
    });
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1_000);
    await prisma.loginThrottle.createMany({
      data: [
        {
          keyHash: hash("3"),
          windowStartedAt: thirtyDaysAgo,
          failureCount: 1,
          blockedUntil: null,
          updatedAt: new Date(thirtyDaysAgo.getTime() - 1),
        },
        {
          keyHash: hash("4"),
          windowStartedAt: thirtyDaysAgo,
          failureCount: 1,
          blockedUntil: now,
          updatedAt: new Date(thirtyDaysAgo.getTime() - 1),
        },
        {
          keyHash: hash("5"),
          windowStartedAt: thirtyDaysAgo,
          failureCount: 1,
          blockedUntil: null,
          updatedAt: thirtyDaysAgo,
        },
        {
          keyHash: hash("6"),
          windowStartedAt: thirtyDaysAgo,
          failureCount: 1,
          blockedUntil: new Date(now.getTime() + 1),
          updatedAt: new Date(thirtyDaysAgo.getTime() - 1),
        },
      ],
    });

    const cutoff = new Date("2024-08-02T09:10:11.123Z");
    const firstId = "00000000-0000-4000-8000-000000000001";
    const secondId = "00000000-0000-4000-8000-000000000002";
    const oldestId = "00000000-0000-4000-8000-000000000003";
    await prisma.auditLog.createMany({
      data: [
        auditData(new Date(cutoff.getTime() - 1), secondId),
        auditData(new Date(cutoff.getTime() - 1), firstId),
        auditData(new Date(cutoff.getTime() - 2), oldestId),
        auditData(cutoff),
        auditData(new Date(cutoff.getTime() + 1)),
      ],
    });

    const writtenBatches: AuditArchiveRecord[][] = [];
    const auditArchive: AuditArchive = {
      write: async (records) => {
        writtenBatches.push([...records]);
        return { archiveId: "archive-1" };
      },
    };

    await expect(runMaintenance({ now, auditArchive })).resolves.toEqual({
      expiredSessions: 2,
      expiredReservations: 2,
      staleThrottles: 2,
      archivedAuditLogs: 3,
      archiveId: "archive-1",
    });
    expect(writtenBatches).toHaveLength(1);
    expect(writtenBatches[0].map((record) => record.id)).toEqual([oldestId, firstId, secondId]);
    await expect(prisma.session.count()).resolves.toBe(1);
    await expect(prisma.loginAttemptReservation.count()).resolves.toBe(1);
    await expect(prisma.loginThrottle.count()).resolves.toBe(2);
    await expect(prisma.auditLog.count()).resolves.toBe(2);

    await expect(runMaintenance({ now, auditArchive })).resolves.toEqual({
      expiredSessions: 0,
      expiredReservations: 0,
      staleThrottles: 0,
      archivedAuditLogs: 0,
      archiveId: null,
    });
    expect(writtenBatches).toHaveLength(1);
  });

  it("does not delete audit records when durable archive writing fails", async () => {
    const record = await prisma.auditLog.create({
      data: auditData(new Date("2024-08-02T09:10:11.121Z")),
    });
    const auditArchive: AuditArchive = {
      write: async () => {
        throw new Error("archive storage unavailable");
      },
    };

    await expect(runMaintenance({ now, auditArchive })).rejects.toThrow(
      "archive storage unavailable",
    );
    await expect(prisma.auditLog.findUnique({ where: { id: record.id } })).resolves.not.toBeNull();
  });

  it("keeps the database row and only an orphan ciphertext when manifest publication fails", async () => {
    const directory = await mkdtemp(join(tmpdir(), "fenshi-partial-archive-"));
    const record = await prisma.auditLog.create({
      data: auditData(new Date("2024-08-02T09:10:11.121Z")),
    });
    const archive = new EncryptedAuditArchive({
      directory,
      keyBase64: randomBytes(32).toString("base64"),
      createArchiveId: () => "partial-failure",
      fileSystem: {
        rename: async (source, destination) => {
          if (String(destination).endsWith(".manifest.json")) {
            throw new Error("manifest rename failed");
          }
          await rename(source, destination);
        },
      },
    });

    try {
      await expect(runMaintenance({ now, auditArchive: archive })).rejects.toThrow(
        "manifest rename failed",
      );
      await expect(
        prisma.auditLog.findUnique({ where: { id: record.id } }),
      ).resolves.not.toBeNull();
      expect(await readdir(directory)).toEqual([
        "audit-partial-failure.ndjson.gz.enc",
      ]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("does not create a missing archive directory or delete its database row", async () => {
    const parent = await mkdtemp(join(tmpdir(), "fenshi-missing-archive-"));
    const directory = join(parent, "not-created-by-adapter");
    const record = await prisma.auditLog.create({
      data: auditData(new Date("2024-08-02T09:10:11.121Z")),
    });
    const archive = new EncryptedAuditArchive({
      directory,
      keyBase64: randomBytes(32).toString("base64"),
    });

    try {
      await expect(runMaintenance({ now, auditArchive: archive })).rejects.toMatchObject({
        code: "ENOENT",
      });
      await expect(
        prisma.auditLog.findUnique({ where: { id: record.id } }),
      ).resolves.not.toBeNull();
      await expect(access(directory)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  it("deletes only the exact archived IDs when another eligible record appears during archive writing", async () => {
    const archived = await prisma.auditLog.create({
      data: auditData(new Date("2024-08-02T09:10:11.121Z")),
    });
    let insertedId = "";
    const auditArchive: AuditArchive = {
      write: async () => {
        const inserted = await prisma.auditLog.create({
          data: auditData(new Date("2024-08-02T09:10:11.120Z")),
        });
        insertedId = inserted.id;
        return { archiveId: "snapshot-archive" };
      },
    };

    await expect(runMaintenance({ now, auditArchive })).resolves.toMatchObject({
      archivedAuditLogs: 1,
      archiveId: "snapshot-archive",
    });
    await expect(prisma.auditLog.findUnique({ where: { id: archived.id } })).resolves.toBeNull();
    await expect(prisma.auditLog.findUnique({ where: { id: insertedId } })).resolves.not.toBeNull();
  });

  it("archives at most 5000 audit rows per run", async () => {
    const createdAt = new Date("2024-08-02T09:10:11.121Z");
    await prisma.auditLog.createMany({
      data: Array.from({ length: 5001 }, () => auditData(createdAt)),
    });
    const batchSizes: number[] = [];
    const auditArchive: AuditArchive = {
      write: async (records) => {
        batchSizes.push(records.length);
        return { archiveId: `archive-${batchSizes.length}` };
      },
    };

    await expect(runMaintenance({ now, auditArchive })).resolves.toMatchObject({
      archivedAuditLogs: 5000,
      archiveId: "archive-1",
    });
    await expect(prisma.auditLog.count()).resolves.toBe(1);
    await expect(runMaintenance({ now, auditArchive })).resolves.toMatchObject({
      archivedAuditLogs: 1,
      archiveId: "archive-2",
    });
    expect(batchSizes).toEqual([5000, 1]);
  });
});
