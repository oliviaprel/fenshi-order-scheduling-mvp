import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { FullConfig } from "@playwright/test";

export const disabledSessionStatePath = path.join(
  tmpdir(),
  "fenshi-e2e-disabled-session.json",
);

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} is required for E2E tests`);
  }
  return value;
}

export default async function globalSetup(config: FullConfig): Promise<void> {
  const databaseUrl = requiredEnvironment("DATABASE_URL");
  const databaseName = new URL(databaseUrl).pathname.replace(/^\/+/, "");
  if (!databaseName.endsWith("_test")) {
    throw new Error("E2E setup only permits databases ending in _test");
  }

  const adminPhone = requiredEnvironment("E2E_ADMIN_PHONE");
  const adminPassword = requiredEnvironment("E2E_ADMIN_PASSWORD");
  const userPhone = requiredEnvironment("E2E_USER_PHONE");
  const userPassword = requiredEnvironment("E2E_USER_PASSWORD");

  const [{ prisma }, { resetTestDatabase }, { createAdmin }, { login }] = await Promise.all([
    import("../src/server/db/client"),
    import("../src/server/db/test-database"),
    import("../src/modules/users/user.service"),
    import("../src/modules/auth/auth.service"),
  ]);

  await resetTestDatabase();

  await createAdmin(
    { displayName: "系统管理员", phone: adminPhone, password: adminPassword },
    { requestId: "e2e-create-admin" },
  );

  const forcedChangeUser = await createAdmin(
    { displayName: "测试操作员", phone: userPhone, password: userPassword },
    { requestId: "e2e-create-user" },
  );
  await prisma.user.update({
    where: { id: forcedChangeUser.id },
    data: { role: "USER", mustChangePassword: true },
  });

  const disabledUser = await createAdmin(
    { displayName: "已停用操作员", phone: "13700137000", password: userPassword },
    { requestId: "e2e-create-disabled-user" },
  );
  await prisma.user.update({
    where: { id: disabledUser.id },
    data: { role: "USER", mustChangePassword: false },
  });
  const disabledSession = await login(
    { phone: "13700137000", password: userPassword },
    { ip: "127.0.0.1", now: new Date(), requestId: "e2e-disabled-user-login" },
  );
  await prisma.user.update({
    where: { id: disabledUser.id },
    data: { status: "DISABLED" },
  });

  const appOrigin = new URL(config.projects[0]?.use.baseURL?.toString() ?? "http://127.0.0.1:3000");
  await mkdir(path.dirname(disabledSessionStatePath), { recursive: true });
  await writeFile(
    disabledSessionStatePath,
    JSON.stringify({
      cookies: [
        {
          name: "fenshi_session",
          value: disabledSession.token,
          domain: appOrigin.hostname,
          path: "/",
          expires: Math.floor(disabledSession.expiresAt.getTime() / 1_000),
          httpOnly: true,
          secure: appOrigin.protocol === "https:",
          sameSite: "Lax",
        },
      ],
      origins: [],
    }),
    { encoding: "utf8", mode: 0o600 },
  );

  await prisma.$disconnect();
}
