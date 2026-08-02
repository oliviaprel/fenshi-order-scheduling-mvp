import type { Prisma } from "../../generated/prisma/client";
import { prisma } from "../../server/db/client";
import { toPublicUser } from "../users/user.types";
import type { AuthenticatedUser, LoginResult } from "./auth.types";
import { createSessionToken, hashSessionToken } from "./session-token";

const SESSION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1_000;
const LAST_SEEN_WRITE_INTERVAL_MS = 15 * 60 * 1_000;

export function getSessionCookieName(
  nodeEnv: string | undefined,
): "__Host-fenshi_session" | "fenshi_session" {
  return nodeEnv === "production" ? "__Host-fenshi_session" : "fenshi_session";
}

export async function createSession(
  tx: Prisma.TransactionClient,
  userId: string,
  now: Date,
): Promise<Pick<LoginResult, "token" | "expiresAt">> {
  const token = createSessionToken();
  const expiresAt = new Date(now.getTime() + SESSION_LIFETIME_MS);

  await tx.session.create({
    data: {
      tokenHash: hashSessionToken(token),
      userId,
      createdAt: now,
      lastSeenAt: now,
      expiresAt,
    },
  });

  return { token, expiresAt };
}

export async function authenticateSession(
  rawToken: string | undefined,
  now: Date,
): Promise<AuthenticatedUser | null> {
  if (rawToken === undefined || rawToken.length === 0) {
    return null;
  }

  const tokenHash = hashSessionToken(rawToken);
  const session = await prisma.session.findUnique({
    where: { tokenHash },
    include: { user: true },
  });

  if (session === null) {
    return null;
  }

  if (session.expiresAt.getTime() <= now.getTime()) {
    await prisma.session.deleteMany({
      where: { tokenHash, expiresAt: { lte: now } },
    });
    return null;
  }

  const writeCutoff = new Date(now.getTime() - LAST_SEEN_WRITE_INTERVAL_MS);
  await prisma.session.updateMany({
    where: { tokenHash, lastSeenAt: { lt: writeCutoff } },
    data: { lastSeenAt: now },
  });

  return {
    ...toPublicUser(session.user),
    sessionId: session.id,
  };
}

export async function logout(rawToken: string | undefined): Promise<void> {
  if (rawToken === undefined || rawToken.length === 0) {
    return;
  }

  await prisma.session.deleteMany({
    where: { tokenHash: hashSessionToken(rawToken) },
  });
}
