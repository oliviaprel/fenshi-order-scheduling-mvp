import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "../../../server/db/client";
import { resetTestDatabase } from "../../../server/db/test-database";
import { createAdmin } from "../../../modules/users/user.service";
import { POST as changePasswordRoute } from "./change-password/route";
import { POST as loginRoute } from "./login/route";
import { POST as logoutRoute } from "./logout/route";
import { GET as meRoute } from "../me/route";
import { requireUser } from "../../../server/auth/guards";
import { routeHandler } from "../../../server/http/route-handler";

const appOrigin = "http://localhost:3000";

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
    "x-request-id": options.requestId ?? "route-test-request",
    "x-forwarded-for": "203.0.113.10, 10.0.0.2",
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

function sessionCookie(response: Response): string {
  const setCookie = response.headers.get("set-cookie");
  const match = setCookie?.match(/(?:^|,\s*)fenshi_session=([^;]+)/);
  if (match?.[1] === undefined) {
    throw new Error(`Response did not set fenshi_session: ${setCookie}`);
  }
  return `fenshi_session=${match[1]}`;
}

async function createUser(options?: {
  role?: "ADMIN" | "USER";
  mustChangePassword?: boolean;
  phone?: string;
}) {
  const user = await createAdmin(
    {
      displayName: "API 测试用户",
      phone: options?.phone ?? "13800138000",
      password: "secure-pass-2026",
    },
    { requestId: "create-api-test-user" },
  );

  return prisma.user.update({
    where: { id: user.id },
    data: {
      role: options?.role ?? "ADMIN",
      mustChangePassword: options?.mustChangePassword ?? false,
    },
  });
}

async function loginAs(phone = "13800138000"): Promise<Response> {
  return loginRoute(
    request("/api/auth/login", {
      method: "POST",
      body: { phone, password: "secure-pass-2026" },
      requestId: "login-request",
    }),
  );
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

describe("authentication route handlers", () => {
  it("sets the raw session only in a seven-day HttpOnly lax cookie and returns a public DTO", async () => {
    await createUser();

    const response = await loginAs();

    expect(response.status).toBe(200);
    expect(response.headers.get("x-request-id")).toBe("login-request");
    expect(response.headers.get("set-cookie")).toContain("fenshi_session=");
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(response.headers.get("set-cookie")).toContain("SameSite=lax");
    expect(response.headers.get("set-cookie")).toContain("Max-Age=604800");
    expect(response.headers.get("set-cookie")).not.toContain("Secure");

    const body = await response.json();
    expect(body).toMatchObject({
      user: {
        phone: "13800138000",
        role: "ADMIN",
        mustChangePassword: false,
      },
    });
    expect(JSON.stringify(body)).not.toContain("passwordHash");
    expect(JSON.stringify(body)).not.toContain("tokenHash");
    const rawToken = sessionCookie(response).slice("fenshi_session=".length);
    expect(JSON.stringify(body)).not.toContain(rawToken);

    const storedSession = await prisma.session.findFirstOrThrow();
    expect(JSON.stringify(body)).not.toContain(storedSession.tokenHash);
    expect(response.headers.get("set-cookie")).not.toContain(storedSession.tokenHash);
  });

  it("adds Secure to the login cookie in production", async () => {
    await createUser();
    vi.stubEnv("NODE_ENV", "production");
    vi.resetModules();
    const { POST: productionLoginRoute } = await import("./login/route");

    const response = await productionLoginRoute(
      request("/api/auth/login", {
        method: "POST",
        body: { phone: "13800138000", password: "secure-pass-2026" },
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain("Secure");
  });

  it.each([
    ["login", loginRoute, "/api/auth/login", undefined],
    ["logout", logoutRoute, "/api/auth/logout", undefined],
    [
      "change password",
      changePasswordRoute,
      "/api/auth/change-password",
      { currentPassword: "irrelevant", newPassword: "new-secure-pass-2026" },
    ],
  ])("rejects a mismatched Origin before processing the %s write", async (_name, handler, path, body) => {
    const response = await handler(
      request(path, {
        method: "POST",
        body,
        origin: "https://attacker.example.com",
        requestId: `bad-origin-${_name}`,
      }),
    );

    expect(response.status).toBe(403);
    expect(response.headers.get("x-request-id")).toBe(`bad-origin-${_name}`);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "ORIGIN_NOT_ALLOWED", requestId: `bad-origin-${_name}` },
    });
  });

  it("checks logout Origin before deleting the current database session", async () => {
    await createUser();
    const cookie = sessionCookie(await loginAs());

    const response = await logoutRoute(
      request("/api/auth/logout", {
        method: "POST",
        cookie,
        origin: "https://attacker.example.com",
        requestId: "logout-origin-before-write",
      }),
    );

    expect(response.status).toBe(403);
    expect(await prisma.session.count()).toBe(1);
  });

  it("returns the unified unauthorized envelope for /api/me without a valid session", async () => {
    const response = await meRoute(
      request("/api/me", { origin: null, requestId: "anonymous-me" }),
    );

    expect(response.status).toBe(401);
    expect(response.headers.get("x-request-id")).toBe("anonymous-me");
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "UNAUTHENTICATED", requestId: "anonymous-me" },
    });
  });

  it("allows a forced-change user only me, change-password, and logout", async () => {
    await createUser({ role: "USER", mustChangePassword: true });
    const loginResponse = await loginAs();
    const cookie = sessionCookie(loginResponse);

    const meResponse = await meRoute(request("/api/me", { cookie, origin: null }));
    expect(meResponse.status).toBe(200);
    const meBody = await meResponse.json();
    expect(meBody).toMatchObject({
      user: { role: "USER", mustChangePassword: true },
    });
    expect(meBody.user).not.toHaveProperty("sessionId");

    const protectedResponse = await routeHandler(
      request("/api/test-protected", { cookie, origin: null, requestId: "forced-protected" }),
      async () => {
        await requireUser();
        return Response.json({ ok: true });
      },
    );
    expect(protectedResponse.status).toBe(403);
    await expect(protectedResponse.json()).resolves.toMatchObject({
      error: { code: "PASSWORD_CHANGE_REQUIRED", requestId: "forced-protected" },
    });

    const logoutResponse = await logoutRoute(
      request("/api/auth/logout", { method: "POST", cookie }),
    );
    expect(logoutResponse.status).toBe(204);
    expect(logoutResponse.headers.get("set-cookie")).toContain("fenshi_session=");
    expect(logoutResponse.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(await prisma.session.count()).toBe(0);

    const secondLoginResponse = await loginAs();
    const secondCookie = sessionCookie(secondLoginResponse);
    const changeResponse = await changePasswordRoute(
      request("/api/auth/change-password", {
        method: "POST",
        cookie: secondCookie,
        body: {
          currentPassword: "secure-pass-2026",
          newPassword: "new-secure-pass-2026",
        },
      }),
    );
    expect(changeResponse.status).toBe(204);
    await expect(
      prisma.user.findUniqueOrThrow({ where: { phone: "13800138000" } }),
    ).resolves.toMatchObject({ mustChangePassword: false });
  });

  it("rechecks user status from the database and rejects a disabled session", async () => {
    const user = await createUser();
    const loginResponse = await loginAs();
    const cookie = sessionCookie(loginResponse);
    await prisma.user.update({ where: { id: user.id }, data: { status: "DISABLED" } });

    const response = await meRoute(
      request("/api/me", { cookie, origin: null, requestId: "disabled-session" }),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "UNAUTHENTICATED", requestId: "disabled-session" },
    });
  });
});
