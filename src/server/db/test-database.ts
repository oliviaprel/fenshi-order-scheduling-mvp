import { getEnv } from "../../lib/env";
import { prisma } from "./client";

const isTestDatabase = (databaseUrl: string) => {
  const databaseName = new URL(databaseUrl).pathname.replace(/^\/+/, "");
  return databaseName.endsWith("_test");
};

export const resetTestDatabase = async () => {
  if (!isTestDatabase(getEnv().DATABASE_URL)) {
    throw new Error("resetTestDatabase only permits databases ending in _test");
  }

  await prisma.$transaction([
    prisma.auditLog.deleteMany(),
    prisma.session.deleteMany(),
    prisma.loginAttemptReservation.deleteMany(),
    prisma.loginThrottle.deleteMany(),
    prisma.user.deleteMany(),
  ]);
};
