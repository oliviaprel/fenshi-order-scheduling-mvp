import type { AuditArchive } from "./encrypted-audit-archive";
import { MaintenanceFailure } from "./maintenance-errors";

const MAINTENANCE_BATCH_SIZE = 5_000;
const THROTTLE_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;

export type MaintenanceResult = {
  expiredSessions: number;
  expiredReservations: number;
  staleThrottles: number;
  archivedAuditLogs: number;
  archiveId: string | null;
};

export type MaintenanceOptions = {
  now: Date;
  auditArchive: AuditArchive;
  onDatabaseAccess?: () => void;
};

export function auditRetentionCutoff(now: Date): Date {
  const targetYear = now.getUTCFullYear() - 2;
  const targetMonth = now.getUTCMonth();
  const lastTargetDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  return new Date(
    Date.UTC(
      targetYear,
      targetMonth,
      Math.min(now.getUTCDate(), lastTargetDay),
      now.getUTCHours(),
      now.getUTCMinutes(),
      now.getUTCSeconds(),
      now.getUTCMilliseconds(),
    ),
  );
}

export async function runMaintenance(options: MaintenanceOptions): Promise<MaintenanceResult> {
  const { now, auditArchive } = options;
  let prisma: typeof import("../../server/db/client").prisma;
  try {
    ({ prisma } = await import("../../server/db/client"));
  } catch (error) {
    throw new MaintenanceFailure("CONFIG", { cause: error });
  }
  options.onDatabaseAccess?.();
  const throttleCutoff = new Date(now.getTime() - THROTTLE_RETENTION_MS);
  const expiredSessions = await prisma.$transaction(async (tx) => {
    const sessionIds = await tx.session.findMany({
      where: { expiresAt: { lte: now } },
      orderBy: [{ expiresAt: "asc" }, { id: "asc" }],
      select: { id: true },
      take: MAINTENANCE_BATCH_SIZE,
    });
    return tx.session.deleteMany({
      where: {
        id: { in: sessionIds.map(({ id }) => id) },
        expiresAt: { lte: now },
      },
    });
  });

  const expiredReservations = await prisma.$transaction(async (tx) => {
    const reservationIds = await tx.loginAttemptReservation.findMany({
      where: { expiresAt: { lte: now } },
      orderBy: [{ expiresAt: "asc" }, { id: "asc" }],
      select: { id: true },
      take: MAINTENANCE_BATCH_SIZE,
    });
    return tx.loginAttemptReservation.deleteMany({
      where: {
        id: { in: reservationIds.map(({ id }) => id) },
        expiresAt: { lte: now },
      },
    });
  });

  const staleThrottles = await prisma.$transaction(async (tx) => {
    const throttleIds = await tx.loginThrottle.findMany({
      where: {
        updatedAt: { lt: throttleCutoff },
        OR: [{ blockedUntil: null }, { blockedUntil: { lte: now } }],
      },
      orderBy: [{ updatedAt: "asc" }, { blockedUntil: "asc" }, { keyHash: "asc" }],
      select: { keyHash: true },
      take: MAINTENANCE_BATCH_SIZE,
    });
    return tx.loginThrottle.deleteMany({
      where: {
        keyHash: { in: throttleIds.map(({ keyHash }) => keyHash) },
        updatedAt: { lt: throttleCutoff },
        OR: [{ blockedUntil: null }, { blockedUntil: { lte: now } }],
      },
    });
  });

  const auditCutoff = auditRetentionCutoff(now);
  const auditRecords = await prisma.auditLog.findMany({
    where: { createdAt: { lt: auditCutoff } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: MAINTENANCE_BATCH_SIZE,
  });

  if (auditRecords.length === 0) {
    return {
      expiredSessions: expiredSessions.count,
      expiredReservations: expiredReservations.count,
      staleThrottles: staleThrottles.count,
      archivedAuditLogs: 0,
      archiveId: null,
    };
  }

  let receipt;
  try {
    receipt = await auditArchive.write(auditRecords);
  } catch (error) {
    throw new MaintenanceFailure("ARCHIVE", { cause: error });
  }
  const deleted = await prisma.$transaction((tx) =>
    tx.auditLog.deleteMany({
      where: {
        id: { in: auditRecords.map((record) => record.id) },
        createdAt: { lt: auditCutoff },
      },
    }),
  );

  return {
    expiredSessions: expiredSessions.count,
    expiredReservations: expiredReservations.count,
    staleThrottles: staleThrottles.count,
    archivedAuditLogs: deleted.count,
    archiveId: receipt.archiveId,
  };
}
