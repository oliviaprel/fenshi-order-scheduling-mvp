import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as loginRoute } from "../../auth/login/route";
import {
  createManagedUser,
  listManagedUsers,
} from "../../../../modules/users/admin-user.service";
import { createAdmin } from "../../../../modules/users/user.service";
import { prisma } from "../../../../server/db/client";
import { resetTestDatabase } from "../../../../server/db/test-database";
import { PATCH as updateUserRoute } from "./[id]/route";
import { POST as resetPasswordRoute } from "./[id]/reset-password/route";
import { GET as listUsersRoute, POST as createUserRoute } from "./route";

const appOrigin = "http://localhost:3000";
const missingUserId = "00000000-0000-4000-8000-000000000001";

function request(
  path: string,
  options: {
    method?: string;
    body?: unknown;
    cookie?: string;
    origin?: string | null;
    requestId?: string;
  } = {},
): Request {
  const headers = new Headers({
    "x-request-id": options.requestId ?? "admin-route-test",
    "x-forwarded-for": "203.0.113.10",
  });
  if (options.origin !== null) {
    headers.set("origin", options.origin ?? appOrigin);
  }
  if (options.cookie !== undefined) {
    headers.set("cookie", options.cookie);
  }
  if (options.body !== undefined) {
    headers.set("content-type", "application/json");
  }

  return new Request(`${appOrigin}${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
}

function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

function sessionCookie(response: Response): string {
  const setCookie = response.headers.get("set-cookie");
  const match = setCookie?.match(/(?:^|,\s*)fenshi_session=([^;]+)/);
  if (match?.[1] === undefined) {
    throw new Error(`Response did not set fenshi_session: ${setCookie}`);
  }
  return `fenshi_session=${match[1]}`;
}

async function createAdminActor() {
  const admin = await createAdmin(
    {
      displayName: "API 系统管理员",
      phone: "13900139000",
      password: "secure-admin-pass-2026",
    },
    { requestId: "create-api-admin" },
  );
  const loginResponse = await loginRoute(
    request("/api/auth/login", {
      method: "POST",
      body: { phone: admin.phone, password: "secure-admin-pass-2026" },
      requestId: "login-api-admin",
    }),
  );
  expect(loginResponse.status).toBe(200);
  return { admin, cookie: sessionCookie(loginResponse) };
}

async function createRegularActor(adminId: string) {
  const created = await createManagedUser(
    { displayName: "普通用户", phone: "13800138000" },
    { actorUserId: adminId, requestId: "create-api-regular-user" },
  );
  await prisma.user.update({
    where: { id: created.user.id },
    data: { mustChangePassword: false },
  });
  const loginResponse = await loginRoute(
    request("/api/auth/login", {
      method: "POST",
      body: { phone: created.user.phone, password: created.temporaryPassword },
      requestId: "login-api-regular-user",
    }),
  );
  expect(loginResponse.status).toBe(200);
  return { user: created.user, cookie: sessionCookie(loginResponse) };
}

beforeEach(async () => {
  vi.stubEnv("NODE_ENV", "test");
  process.env.APP_ORIGIN = appOrigin;
  await resetTestDatabase();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("administrator user management routes", () => {
  it("checks Origin before admin auth and Zod on every write route", async () => {
    const badOriginCalls = [
      () =>
        createUserRoute(
          request("/api/admin/users", {
            method: "POST",
            body: { role: "ADMIN" },
            origin: "https://attacker.example.com",
            requestId: "bad-origin-create",
          }),
        ),
      () =>
        updateUserRoute(
          request("/api/admin/users/not-a-uuid", {
            method: "PATCH",
            body: { role: "ADMIN" },
            origin: "https://attacker.example.com",
            requestId: "bad-origin-update",
          }),
          params("not-a-uuid"),
        ),
      () =>
        resetPasswordRoute(
          request("/api/admin/users/not-a-uuid/reset-password", {
            method: "POST",
            origin: "https://attacker.example.com",
            requestId: "bad-origin-reset",
          }),
          params("not-a-uuid"),
        ),
    ];

    for (const call of badOriginCalls) {
      const response = await call();
      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: "ORIGIN_NOT_ALLOWED" },
      });
    }
    expect(await prisma.user.count()).toBe(0);
  });

  it("checks the admin guard before Zod and rejects every management route for a USER", async () => {
    const anonymousCreate = await createUserRoute(
      request("/api/admin/users", {
        method: "POST",
        body: { role: "ADMIN" },
        requestId: "anonymous-invalid-create",
      }),
    );
    expect(anonymousCreate.status).toBe(401);
    await expect(anonymousCreate.json()).resolves.toMatchObject({
      error: { code: "UNAUTHENTICATED" },
    });

    const { admin } = await createAdminActor();
    const regular = await createRegularActor(admin.id);
    const forbiddenCalls = [
      () =>
        listUsersRoute(
          request("/api/admin/users?cursor=not-a-uuid", {
            cookie: regular.cookie,
            origin: null,
          }),
        ),
      () =>
        createUserRoute(
          request("/api/admin/users", {
            method: "POST",
            cookie: regular.cookie,
            body: { role: "ADMIN" },
          }),
        ),
      () =>
        updateUserRoute(
          request(`/api/admin/users/${regular.user.id}`, {
            method: "PATCH",
            cookie: regular.cookie,
            body: { role: "ADMIN" },
          }),
          params(regular.user.id),
        ),
      () =>
        resetPasswordRoute(
          request(`/api/admin/users/${regular.user.id}/reset-password`, {
            method: "POST",
            cookie: regular.cookie,
          }),
          params(regular.user.id),
        ),
    ];

    for (const call of forbiddenCalls) {
      const response = await call();
      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toMatchObject({ error: { code: "ADMIN_REQUIRED" } });
    }
  });

  it("creates a USER with 201 and returns the temporary password only in that success response", async () => {
    const { admin, cookie } = await createAdminActor();

    const response = await createUserRoute(
      request("/api/admin/users", {
        method: "POST",
        cookie,
        body: { displayName: "清和堂", phone: "+86 138-0013-8000" },
        requestId: "api-create-user",
      }),
    );

    expect(response.status).toBe(201);
    expect(response.headers.get("x-request-id")).toBe("api-create-user");
    const body = await response.json();
    expect(body).toMatchObject({
      user: { role: "USER", displayName: "清和堂", phone: "13800138000" },
      temporaryPassword: expect.any(String),
    });
    expect(body.temporaryPassword.length).toBeGreaterThanOrEqual(16);
    expect(body.user).not.toHaveProperty("passwordHash");

    const listResponse = await listUsersRoute(
      request("/api/admin/users", { cookie, origin: null, requestId: "list-after-create" }),
    );
    expect(listResponse.status).toBe(200);
    const listText = await listResponse.text();
    expect(listText).not.toContain(body.temporaryPassword);
    expect(listText).not.toContain("passwordHash");

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: "USER_CREATED", actorUserId: admin.id },
    });
    expect(JSON.stringify(audit)).not.toContain(body.temporaryPassword);
  });

  it("uses default/limited UUID-cursor pagination and searches normalized phone query parameters", async () => {
    const { admin, cookie } = await createAdminActor();
    const first = await createManagedUser(
      { displayName: "清和堂", phone: "13800138000" },
      { actorUserId: admin.id, requestId: "route-list-first" },
    );
    const second = await createManagedUser(
      { displayName: "安宁服务部", phone: "13700137000" },
      { actorUserId: admin.id, requestId: "route-list-second" },
    );

    const firstPageResponse = await listUsersRoute(
      request("/api/admin/users?limit=1", { cookie, origin: null }),
    );
    expect(firstPageResponse.status).toBe(200);
    const firstPage = await firstPageResponse.json();
    expect(firstPage.items).toHaveLength(1);
    expect(firstPage.nextCursor).toBe(firstPage.items[0].id);

    const secondPageResponse = await listUsersRoute(
      request(`/api/admin/users?limit=1&cursor=${firstPage.nextCursor}`, {
        cookie,
        origin: null,
      }),
    );
    expect(secondPageResponse.status).toBe(200);
    const secondPage = await secondPageResponse.json();
    expect(secondPage.items).toHaveLength(1);
    expect(secondPage.items[0].id).not.toBe(firstPage.items[0].id);
    expect(secondPage.nextCursor).toBeNull();

    const query = encodeURIComponent("+86 137-0013-7000");
    const searchResponse = await listUsersRoute(
      request(`/api/admin/users?query=${query}`, { cookie, origin: null }),
    );
    expect(searchResponse.status).toBe(200);
    await expect(searchResponse.json()).resolves.toMatchObject({
      items: [{ id: second.user.id, phone: "13700137000" }],
    });

    const defaultResponse = await listUsersRoute(
      request("/api/admin/users", { cookie, origin: null }),
    );
    expect(defaultResponse.status).toBe(200);
    await expect(defaultResponse.json()).resolves.toMatchObject({
      items: expect.arrayContaining([
        expect.objectContaining({ id: first.user.id }),
        expect.objectContaining({ id: second.user.id }),
      ]),
    });
  });

  it.each(["0", "101", "1.5", "not-a-number"])(
    "rejects an out-of-range or non-integer limit %s",
    async (limit) => {
      const { cookie } = await createAdminActor();
      const response = await listUsersRoute(
        request(`/api/admin/users?limit=${limit}`, { cookie, origin: null }),
      );

      expect(response.status).toBe(422);
      await expect(response.json()).resolves.toMatchObject({ error: { code: "VALIDATION_ERROR" } });
    },
  );

  it("accepts the optional query string without an undocumented length restriction", async () => {
    const { cookie } = await createAdminActor();
    const query = encodeURIComponent("不存在的长搜索词".repeat(10));

    const response = await listUsersRoute(
      request(`/api/admin/users?query=${query}`, { cookie, origin: null }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ items: [], nextCursor: null });
  });

  it("rejects invalid cursors and role injection with Zod validation", async () => {
    const { cookie } = await createAdminActor();

    const invalidCursor = await listUsersRoute(
      request("/api/admin/users?cursor=not-a-uuid", { cookie, origin: null }),
    );
    expect(invalidCursor.status).toBe(422);

    const injectedCreate = await createUserRoute(
      request("/api/admin/users", {
        method: "POST",
        cookie,
        body: { displayName: "恶意管理员", phone: "13800138000", role: "ADMIN" },
      }),
    );
    expect(injectedCreate.status).toBe(422);
    expect(await prisma.user.count({ where: { role: "ADMIN" } })).toBe(1);

    const injectedUpdate = await updateUserRoute(
      request(`/api/admin/users/${missingUserId}`, {
        method: "PATCH",
        cookie,
        body: {
          displayName: "恶意修改",
          phone: "13800138000",
          status: "ACTIVE",
          version: 1,
          role: "ADMIN",
        },
      }),
      params(missingUserId),
    );
    expect(injectedUpdate.status).toBe(422);
  });

  it("maps update 404/403/409 and duplicate-phone conflicts to the unified envelope", async () => {
    const { admin, cookie } = await createAdminActor();
    const first = await createManagedUser(
      { displayName: "第一用户", phone: "13800138000" },
      { actorUserId: admin.id, requestId: "route-update-first" },
    );
    const second = await createManagedUser(
      { displayName: "第二用户", phone: "13700137000" },
      { actorUserId: admin.id, requestId: "route-update-second" },
    );

    const missing = await updateUserRoute(
      request(`/api/admin/users/${missingUserId}`, {
        method: "PATCH",
        cookie,
        body: {
          displayName: "不存在",
          phone: "13600136000",
          status: "ACTIVE",
          version: 1,
        },
      }),
      params(missingUserId),
    );
    expect(missing.status).toBe(404);
    await expect(missing.json()).resolves.toMatchObject({ error: { code: "USER_NOT_FOUND" } });

    const adminTarget = await updateUserRoute(
      request(`/api/admin/users/${admin.id}`, {
        method: "PATCH",
        cookie,
        body: {
          displayName: admin.displayName,
          phone: admin.phone,
          status: admin.status,
          version: admin.version,
        },
      }),
      params(admin.id),
    );
    expect(adminTarget.status).toBe(403);

    await prisma.user.update({
      where: { id: first.user.id },
      data: { version: { increment: 1 } },
    });
    const stale = await updateUserRoute(
      request(`/api/admin/users/${first.user.id}`, {
        method: "PATCH",
        cookie,
        body: {
          displayName: "过期修改",
          phone: first.user.phone,
          status: first.user.status,
          version: first.user.version,
        },
      }),
      params(first.user.id),
    );
    expect(stale.status).toBe(409);
    await expect(stale.json()).resolves.toMatchObject({
      error: { code: "USER_VERSION_CONFLICT" },
    });

    const duplicate = await updateUserRoute(
      request(`/api/admin/users/${second.user.id}`, {
        method: "PATCH",
        cookie,
        body: {
          displayName: second.user.displayName,
          phone: first.user.phone,
          status: second.user.status,
          version: second.user.version,
        },
      }),
      params(second.user.id),
    );
    expect(duplicate.status).toBe(409);
    await expect(duplicate.json()).resolves.toMatchObject({
      error: { code: "PHONE_ALREADY_EXISTS" },
    });
  });

  it("requires exactly a version for reset password requests", async () => {
    const { admin, cookie } = await createAdminActor();
    const created = await createManagedUser(
      { displayName: "重置校验用户", phone: "13800138000" },
      { actorUserId: admin.id, requestId: "route-reset-validation-target" },
    );

    for (const body of [{}, { version: created.user.version, extra: true }]) {
      const response = await resetPasswordRoute(
        request(`/api/admin/users/${created.user.id}/reset-password`, {
          method: "POST",
          cookie,
          body,
        }),
        params(created.user.id),
      );
      expect(response.status).toBe(422);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: "VALIDATION_ERROR" },
      });
    }
  });

  it("updates a USER with 200 and resets a password with its displayed version without later secret exposure", async () => {
    const { admin, cookie } = await createAdminActor();
    const created = await createManagedUser(
      { displayName: "待修改用户", phone: "13800138000" },
      { actorUserId: admin.id, requestId: "route-create-update-target" },
    );
    await prisma.session.create({
      data: {
        tokenHash: "route-reset-session".padEnd(64, "0"),
        userId: created.user.id,
        expiresAt: new Date("2026-08-07T00:00:00.000Z"),
      },
    });

    const updateResponse = await updateUserRoute(
      request(`/api/admin/users/${created.user.id}`, {
        method: "PATCH",
        cookie,
        body: {
          displayName: "已修改用户",
          phone: "+86 136-0013-6000",
          status: "PAUSED",
          version: created.user.version,
        },
        requestId: "api-update-user",
      }),
      params(created.user.id),
    );
    expect(updateResponse.status).toBe(200);
    await expect(updateResponse.json()).resolves.toMatchObject({
      user: {
        id: created.user.id,
        displayName: "已修改用户",
        phone: "13600136000",
        status: "PAUSED",
        version: created.user.version + 1,
      },
    });
    expect(await prisma.session.count({ where: { userId: created.user.id } })).toBe(1);

    const resetResponse = await resetPasswordRoute(
      request(`/api/admin/users/${created.user.id}/reset-password`, {
        method: "POST",
        cookie,
        body: { version: created.user.version + 1 },
        requestId: "api-reset-user",
      }),
      params(created.user.id),
    );
    expect(resetResponse.status).toBe(200);
    const resetBody = await resetResponse.json();
    expect(resetBody).toEqual({ temporaryPassword: expect.any(String) });
    expect(resetBody.temporaryPassword.length).toBeGreaterThanOrEqual(16);
    expect(await prisma.session.count({ where: { userId: created.user.id } })).toBe(0);

    const listed = await listManagedUsers({ query: "已修改用户", limit: 30 });
    expect(JSON.stringify(listed)).not.toContain(resetBody.temporaryPassword);
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: "USER_PASSWORD_RESET", targetId: created.user.id },
    });
    expect(JSON.stringify(audit)).not.toContain(resetBody.temporaryPassword);
  });

  it("returns USER_VERSION_CONFLICT for a stale password reset version", async () => {
    const { admin, cookie } = await createAdminActor();
    const created = await createManagedUser(
      { displayName: "重置冲突用户", phone: "13800138000" },
      { actorUserId: admin.id, requestId: "route-stale-reset-target" },
    );
    await prisma.user.update({
      where: { id: created.user.id },
      data: { version: { increment: 1 } },
    });

    const response = await resetPasswordRoute(
      request(`/api/admin/users/${created.user.id}/reset-password`, {
        method: "POST",
        cookie,
        body: { version: created.user.version },
      }),
      params(created.user.id),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "USER_VERSION_CONFLICT" },
    });
  });
});
