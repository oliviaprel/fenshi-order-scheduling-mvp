import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { PrismaClient } from "../../generated/prisma/client";
import { getEnv } from "../../lib/env";

const DATABASE_CONNECTION_TIMEOUT_MS = 1_000;
const DATABASE_STATEMENT_TIMEOUT_MS = 1_500;
const DATABASE_QUERY_TIMEOUT_MS = 2_000;

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
  databasePool?: Pool;
};
const env = getEnv();
const databasePool =
  globalForPrisma.databasePool ??
  new Pool({
    connectionString: env.DATABASE_URL,
    connectionTimeoutMillis: DATABASE_CONNECTION_TIMEOUT_MS,
    statement_timeout: DATABASE_STATEMENT_TIMEOUT_MS,
    query_timeout: DATABASE_QUERY_TIMEOUT_MS,
  });
const adapter = new PrismaPg(databasePool, { disposeExternalPool: true });

export const prisma = globalForPrisma.prisma ?? new PrismaClient({ adapter });

if (env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
  globalForPrisma.databasePool = databasePool;
}
