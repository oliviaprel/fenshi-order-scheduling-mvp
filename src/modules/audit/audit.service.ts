import type { Prisma } from "../../generated/prisma/client";

export type AuditEntry = {
  actorUserId?: string;
  action: string;
  targetType: string;
  targetId?: string;
  before?: unknown;
  after?: unknown;
  requestId: string;
};

function isSensitiveAuditField(key: string): boolean {
  const normalized = key.toLowerCase();
  return (
    normalized !== "mustchangepassword" &&
    (normalized.includes("password") || normalized.includes("hash") || normalized.includes("token"))
  );
}

function redactAuditJson(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined) {
    return undefined;
  }

  const serialized = JSON.stringify(value, (key: string, nestedValue: unknown) =>
    isSensitiveAuditField(key) ? undefined : nestedValue,
  );

  return serialized === undefined ? undefined : (JSON.parse(serialized) as Prisma.InputJsonValue);
}

export async function writeAudit(tx: Prisma.TransactionClient, entry: AuditEntry): Promise<void> {
  await tx.auditLog.create({
    data: {
      actorUserId: entry.actorUserId,
      action: entry.action,
      targetType: entry.targetType,
      targetId: entry.targetId,
      beforeJson: redactAuditJson(entry.before),
      afterJson: redactAuditJson(entry.after),
      requestId: entry.requestId,
    },
  });
}
