import { createHash } from "node:crypto";
import { Prisma } from "../../generated/prisma/client";
import { prisma } from "../../server/db/client";
import { ApiError } from "../../server/http/api-error";

const THROTTLE_WINDOW_MS = 15 * 60 * 1_000;
const FAILURE_LIMIT = 5;

type ThrottleReader = Pick<Prisma.TransactionClient, "loginThrottle">;
type LockedThrottle = {
  keyHash: string;
  windowStartedAt: Date;
  failureCount: number;
  blockedUntil: Date | null;
};

export function hashLoginThrottleKey(scope: "phone" | "ip", value: string): string {
  return createHash("sha256").update(`${scope}:${value}`).digest("hex");
}

function loginBlockedError(): ApiError {
  return new ApiError(429, "LOGIN_BLOCKED", "登录尝试过多，请稍后再试");
}

export async function assertLoginAllowed(
  db: ThrottleReader,
  normalizedPhone: string,
  ip: string,
  now: Date,
): Promise<void> {
  const records = await db.loginThrottle.findMany({
    where: {
      keyHash: {
        in: [
          hashLoginThrottleKey("phone", normalizedPhone),
          hashLoginThrottleKey("ip", ip),
        ],
      },
      blockedUntil: { gt: now },
    },
    select: { keyHash: true },
    take: 1,
  });

  if (records.length > 0) {
    throw loginBlockedError();
  }
}

function isWithinWindow(record: LockedThrottle, now: Date): boolean {
  return now.getTime() - record.windowStartedAt.getTime() < THROTTLE_WINDOW_MS;
}

export async function recordLoginFailure(
  normalizedPhone: string,
  ip: string,
  now: Date,
): Promise<void> {
  const keyHashes = [
    hashLoginThrottleKey("phone", normalizedPhone),
    hashLoginThrottleKey("ip", ip),
  ].sort();

  const blocked = await prisma.$transaction(async (tx) => {
    const createdKeyHashes: string[] = [];
    for (const keyHash of keyHashes) {
      const created = await tx.$queryRaw<Array<{ keyHash: string }>>`
        INSERT INTO "LoginThrottle"
          ("keyHash", "windowStartedAt", "failureCount", "blockedUntil", "updatedAt")
        VALUES
          (${keyHash}, ${now}, 0, NULL, CURRENT_TIMESTAMP)
        ON CONFLICT ("keyHash") DO NOTHING
        RETURNING "keyHash"
      `;
      createdKeyHashes.push(...created.map((record) => record.keyHash));
    }

    const records = await tx.$queryRaw<LockedThrottle[]>`
      SELECT "keyHash", "windowStartedAt", "failureCount", "blockedUntil"
      FROM "LoginThrottle"
      WHERE "keyHash" IN (${Prisma.join(keyHashes)})
      ORDER BY "keyHash"
      FOR UPDATE
    `;

    const alreadyBlocked = records.some(
      (record) =>
        (record.blockedUntil !== null && record.blockedUntil.getTime() > now.getTime()) ||
        (isWithinWindow(record, now) && record.failureCount >= FAILURE_LIMIT),
    );
    if (alreadyBlocked) {
      if (createdKeyHashes.length > 0) {
        await tx.loginThrottle.deleteMany({
          where: {
            keyHash: { in: createdKeyHashes },
            failureCount: 0,
          },
        });
      }
      return true;
    }

    for (const record of records) {
      const withinWindow = isWithinWindow(record, now);
      const failureCount = withinWindow ? record.failureCount + 1 : 1;
      await tx.loginThrottle.update({
        where: { keyHash: record.keyHash },
        data: {
          windowStartedAt: withinWindow ? record.windowStartedAt : now,
          failureCount,
          blockedUntil:
            failureCount >= FAILURE_LIMIT
              ? new Date(now.getTime() + THROTTLE_WINDOW_MS)
              : null,
        },
      });
    }

    return false;
  });

  if (blocked) {
    throw loginBlockedError();
  }
}

export async function clearPhoneLoginFailures(
  tx: Prisma.TransactionClient,
  normalizedPhone: string,
): Promise<void> {
  await tx.loginThrottle.deleteMany({
    where: { keyHash: hashLoginThrottleKey("phone", normalizedPhone) },
  });
}
