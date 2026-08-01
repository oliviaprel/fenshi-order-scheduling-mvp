import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "../../generated/prisma/client";
import { prisma } from "../../server/db/client";
import { ApiError } from "../../server/http/api-error";

const THROTTLE_WINDOW_MS = 15 * 60 * 1_000;
const ATTEMPT_RESERVATION_LEASE_MS = THROTTLE_WINDOW_MS;
const FAILURE_LIMIT = 5;

type LockedThrottle = {
  keyHash: string;
  windowStartedAt: Date;
  failureCount: number;
  blockedUntil: Date | null;
};

type ThrottleKeys = {
  phoneKeyHash: string;
  ipKeyHash: string;
  ordered: string[];
};

export function hashLoginThrottleKey(scope: "phone" | "ip", value: string): string {
  return createHash("sha256").update(`${scope}:${value}`).digest("hex");
}

function loginBlockedError(): ApiError {
  return new ApiError(429, "LOGIN_BLOCKED", "登录尝试过多，请稍后再试");
}

function throttleKeys(normalizedPhone: string, ip: string): ThrottleKeys {
  const phoneKeyHash = hashLoginThrottleKey("phone", normalizedPhone);
  const ipKeyHash = hashLoginThrottleKey("ip", ip);
  return { phoneKeyHash, ipKeyHash, ordered: [phoneKeyHash, ipKeyHash].sort() };
}

async function lockThrottleKeys(
  tx: Prisma.TransactionClient,
  orderedKeyHashes: string[],
): Promise<void> {
  for (const keyHash of orderedKeyHashes) {
    await tx.$executeRaw`
      SELECT pg_advisory_xact_lock(hashtextextended(${keyHash}, 0))
    `;
  }
}

function isWithinWindow(record: LockedThrottle, now: Date): boolean {
  return now.getTime() - record.windowStartedAt.getTime() < THROTTLE_WINDOW_MS;
}

export async function reserveLoginAttempt(
  normalizedPhone: string,
  ip: string,
  now: Date,
): Promise<string> {
  const keys = throttleKeys(normalizedPhone, ip);

  return prisma.$transaction(async (tx) => {
    await lockThrottleKeys(tx, keys.ordered);
    await tx.loginAttemptReservation.deleteMany({
      where: {
        expiresAt: { lte: now },
        OR: [
          { phoneKeyHash: { in: keys.ordered } },
          { ipKeyHash: { in: keys.ordered } },
        ],
      },
    });

    const [records, reservations] = await Promise.all([
      tx.loginThrottle.findMany({
        where: { keyHash: { in: keys.ordered } },
        select: {
          keyHash: true,
          windowStartedAt: true,
          failureCount: true,
          blockedUntil: true,
        },
      }),
      tx.loginAttemptReservation.findMany({
        where: {
          expiresAt: { gt: now },
          OR: [
            { phoneKeyHash: { in: keys.ordered } },
            { ipKeyHash: { in: keys.ordered } },
          ],
        },
        select: { phoneKeyHash: true, ipKeyHash: true },
      }),
    ]);
    const recordsByKey = new Map(records.map((record) => [record.keyHash, record]));
    const reservationCounts = new Map(keys.ordered.map((keyHash) => [keyHash, 0]));
    for (const reservation of reservations) {
      for (const keyHash of [reservation.phoneKeyHash, reservation.ipKeyHash]) {
        if (reservationCounts.has(keyHash)) {
          reservationCounts.set(keyHash, (reservationCounts.get(keyHash) ?? 0) + 1);
        }
      }
    }

    const blocked = keys.ordered.some((keyHash) => {
      const record = recordsByKey.get(keyHash);
      if (record?.blockedUntil !== null && record?.blockedUntil !== undefined) {
        if (record.blockedUntil.getTime() > now.getTime()) {
          return true;
        }
      }
      const failures = record !== undefined && isWithinWindow(record, now) ? record.failureCount : 0;
      return failures + (reservationCounts.get(keyHash) ?? 0) >= FAILURE_LIMIT;
    });
    if (blocked) {
      throw loginBlockedError();
    }

    const id = randomUUID();
    await tx.loginAttemptReservation.create({
      data: {
        id,
        phoneKeyHash: keys.phoneKeyHash,
        ipKeyHash: keys.ipKeyHash,
        expiresAt: new Date(now.getTime() + ATTEMPT_RESERVATION_LEASE_MS),
      },
    });
    return id;
  });
}

export async function recordLoginFailure(
  reservationId: string,
  normalizedPhone: string,
  ip: string,
  now: Date,
): Promise<void> {
  const keys = throttleKeys(normalizedPhone, ip);

  const blocked = await prisma.$transaction(async (tx) => {
    await lockThrottleKeys(tx, keys.ordered);
    await tx.loginAttemptReservation.deleteMany({ where: { id: reservationId } });

    const records = await tx.$queryRaw<LockedThrottle[]>`
      SELECT "keyHash", "windowStartedAt", "failureCount", "blockedUntil"
      FROM "LoginThrottle"
      WHERE "keyHash" IN (${Prisma.join(keys.ordered)})
      ORDER BY "keyHash"
      FOR UPDATE
    `;
    const recordsByKey = new Map(records.map((record) => [record.keyHash, record]));
    const alreadyBlocked = records.some(
      (record) =>
        (record.blockedUntil !== null && record.blockedUntil.getTime() > now.getTime()) ||
        (isWithinWindow(record, now) && record.failureCount >= FAILURE_LIMIT),
    );
    if (alreadyBlocked) {
      return true;
    }

    for (const keyHash of keys.ordered) {
      const record = recordsByKey.get(keyHash);
      const withinWindow = record !== undefined && isWithinWindow(record, now);
      const failureCount = withinWindow ? record.failureCount + 1 : 1;
      await tx.loginThrottle.upsert({
        where: { keyHash },
        create: {
          keyHash,
          windowStartedAt: now,
          failureCount,
          blockedUntil:
            failureCount >= FAILURE_LIMIT
              ? new Date(now.getTime() + THROTTLE_WINDOW_MS)
              : null,
        },
        update: {
          windowStartedAt: withinWindow && record !== undefined ? record.windowStartedAt : now,
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

export async function completeSuccessfulLogin(
  tx: Prisma.TransactionClient,
  reservationId: string,
  normalizedPhone: string,
  ip: string,
): Promise<void> {
  const keys = throttleKeys(normalizedPhone, ip);
  await lockThrottleKeys(tx, keys.ordered);
  const released = await tx.loginAttemptReservation.deleteMany({
    where: {
      id: reservationId,
      phoneKeyHash: keys.phoneKeyHash,
      ipKeyHash: keys.ipKeyHash,
    },
  });
  if (released.count !== 1) {
    throw loginBlockedError();
  }
  await tx.loginThrottle.deleteMany({ where: { keyHash: keys.phoneKeyHash } });
}

export async function releaseLoginAttempt(reservationId: string): Promise<void> {
  await prisma.loginAttemptReservation.deleteMany({ where: { id: reservationId } });
}
