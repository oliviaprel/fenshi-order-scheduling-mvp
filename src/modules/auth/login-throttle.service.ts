import { createHash } from "node:crypto";
import { Prisma } from "../../generated/prisma/client";
import { prisma } from "../../server/db/client";
import { ApiError } from "../../server/http/api-error";

const THROTTLE_WINDOW_MS = 15 * 60 * 1_000;
const FAILURE_LIMIT = 5;

type ThrottleReader = Pick<Prisma.TransactionClient, "loginThrottle">;

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

async function incrementFailure(
  tx: Prisma.TransactionClient,
  keyHash: string,
  now: Date,
): Promise<void> {
  await tx.$executeRaw`
    INSERT INTO "LoginThrottle"
      ("keyHash", "windowStartedAt", "failureCount", "blockedUntil", "updatedAt")
    VALUES
      (${keyHash}, ${now}, 1, NULL, CURRENT_TIMESTAMP)
    ON CONFLICT ("keyHash") DO UPDATE SET
      "windowStartedAt" = CASE
        WHEN ${now} - "LoginThrottle"."windowStartedAt" >= INTERVAL '15 minutes'
          THEN ${now}
        ELSE "LoginThrottle"."windowStartedAt"
      END,
      "failureCount" = CASE
        WHEN ${now} - "LoginThrottle"."windowStartedAt" >= INTERVAL '15 minutes'
          THEN 1
        ELSE "LoginThrottle"."failureCount" + 1
      END,
      "blockedUntil" = CASE
        WHEN ${now} - "LoginThrottle"."windowStartedAt" >= INTERVAL '15 minutes'
          THEN NULL
        WHEN "LoginThrottle"."failureCount" + 1 >= ${FAILURE_LIMIT}
          THEN ${new Date(now.getTime() + THROTTLE_WINDOW_MS)}
        ELSE "LoginThrottle"."blockedUntil"
      END,
      "updatedAt" = CURRENT_TIMESTAMP
  `;
}

export async function recordLoginFailure(
  normalizedPhone: string,
  ip: string,
  now: Date,
): Promise<void> {
  const phoneKey = hashLoginThrottleKey("phone", normalizedPhone);
  const ipKey = hashLoginThrottleKey("ip", ip);

  await prisma.$transaction(async (tx) => {
    await incrementFailure(tx, phoneKey, now);
    await incrementFailure(tx, ipKey, now);
  });
}

export async function clearPhoneLoginFailures(
  tx: Prisma.TransactionClient,
  normalizedPhone: string,
): Promise<void> {
  await tx.loginThrottle.deleteMany({
    where: { keyHash: hashLoginThrottleKey("phone", normalizedPhone) },
  });
}
