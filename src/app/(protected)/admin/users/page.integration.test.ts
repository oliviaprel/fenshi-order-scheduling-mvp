import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { login } from "../../../../modules/auth/auth.service";
import { createManagedUser } from "../../../../modules/users/admin-user.service";
import { createAdmin } from "../../../../modules/users/user.service";
import { prisma } from "../../../../server/db/client";
import { resetTestDatabase } from "../../../../server/db/test-database";
import { routeHandler } from "../../../../server/http/route-handler";
import AdminUsersPage from "./page";

describe("administrator users page data boundary", () => {
  beforeEach(async () => {
    vi.stubEnv("__NEXT_EXPERIMENTAL_AUTH_INTERRUPTS", "true");
    await resetTestDatabase();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("rejects a regular user before rendering the server-fetched list", async () => {
    const admin = await createAdmin(
      {
        displayName: "页面测试管理员",
        phone: "13900139000",
        password: "secure-admin-pass-2026",
      },
      { requestId: "page-create-admin" },
    );
    const created = await createManagedUser(
      { displayName: "页面普通用户", phone: "13800138000" },
      { actorUserId: admin.id, requestId: "page-create-user" },
    );
    await prisma.user.update({
      where: { id: created.user.id },
      data: { mustChangePassword: false },
    });
    const session = await login(
      { phone: created.user.phone, password: created.temporaryPassword },
      { ip: "127.0.0.1", now: new Date(), requestId: "page-user-login" },
    );
    const request = new Request("http://localhost:3000/admin/users", {
      headers: { cookie: `fenshi_session=${session.token}` },
    });

    const response = await routeHandler(request, async () => {
      try {
        await AdminUsersPage();
        return new Response("rendered");
      } catch (error) {
        const digest =
          typeof error === "object" && error !== null && "digest" in error
            ? String(error.digest)
            : "";
        if (digest === "NEXT_HTTP_ERROR_FALLBACK;403") {
          return Response.json({ forbiddenBoundary: true }, { status: 403 });
        }
        throw error;
      }
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ forbiddenBoundary: true });
  });
});
