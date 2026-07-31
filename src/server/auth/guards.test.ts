import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { login } from "../../modules/auth/auth.service";
import { prisma } from "../db/client";
import { resetTestDatabase } from "../db/test-database";
import { createAdmin } from "../../modules/users/user.service";
import { getClientIp } from "../http/client-ip";
import { routeHandler } from "../http/route-handler";
import { requireAdmin, requireUser } from "./guards";

async function authenticatedRequest(options: {
  role: "ADMIN" | "USER";
  mustChangePassword?: boolean;
}): Promise<Request> {
  const created = await createAdmin(
    {
      displayName: "守卫测试用户",
      phone: "13800138000",
      password: "secure-pass-2026",
    },
    { requestId: "create-guard-user" },
  );
  await prisma.user.update({
    where: { id: created.id },
    data: {
      role: options.role,
      mustChangePassword: options.mustChangePassword ?? false,
    },
  });
  const result = await login(
    { phone: created.phone, password: "secure-pass-2026" },
    { ip: "127.0.0.1", now: new Date(), requestId: "guard-login" },
  );

  return new Request("http://localhost:3000/api/guard-test", {
    headers: {
      cookie: `fenshi_session=${result.token}`,
      "x-request-id": "guard-request",
    },
  });
}

beforeEach(async () => {
  process.env.APP_ORIGIN = "http://localhost:3000";
  vi.stubEnv("NODE_ENV", "test");
  await resetTestDatabase();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("server authentication guards", () => {
  it("rejects USER from requireAdmin while accepting ADMIN from a database-backed session", async () => {
    const userRequest = await authenticatedRequest({ role: "USER" });
    const userResponse = await routeHandler(userRequest, async () => {
      await requireAdmin();
      return Response.json({ ok: true });
    });
    expect(userResponse.status).toBe(403);
    await expect(userResponse.json()).resolves.toMatchObject({
      error: { code: "ADMIN_REQUIRED", requestId: "guard-request" },
    });

    await resetTestDatabase();
    const adminRequest = await authenticatedRequest({ role: "ADMIN" });
    const adminResponse = await routeHandler(adminRequest, async () => {
      const user = await requireAdmin();
      return Response.json({ role: user.role });
    });
    expect(adminResponse.status).toBe(200);
    await expect(adminResponse.json()).resolves.toEqual({ role: "ADMIN" });
  });

  it("requires an explicit opt-in before returning a forced-change user", async () => {
    const guardedRequest = await authenticatedRequest({
      role: "USER",
      mustChangePassword: true,
    });

    const blocked = await routeHandler(guardedRequest, async () => {
      await requireUser();
      return Response.json({ ok: true });
    });
    expect(blocked.status).toBe(403);

    const allowed = await routeHandler(guardedRequest, async () => {
      const user = await requireUser({ allowPasswordChangeRequired: true });
      return Response.json({ id: user.id });
    });
    expect(allowed.status).toBe(200);
  });
});

describe("trusted proxy client IP", () => {
  it("uses only the first proxy-supplied x-forwarded-for value and a stable fallback", () => {
    expect(
      getClientIp(
        new Request("http://localhost", {
          headers: { "x-forwarded-for": "203.0.113.7, 10.0.0.2, 10.0.0.3" },
        }),
      ),
    ).toBe("203.0.113.7");
    expect(getClientIp(new Request("http://localhost"))).toBe("unknown");
  });
});
