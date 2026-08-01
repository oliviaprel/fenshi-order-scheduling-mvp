import { afterEach, describe, expect, it, vi } from "vitest";

const databaseUrl = process.env.DATABASE_URL;

function healthRequest(path: "live" | "ready", requestId: string): Request {
  return new Request(`http://localhost:3000/api/health/${path}`, {
    headers: { "x-request-id": requestId },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("health route handlers", () => {
  it("returns live status without requiring or connecting to the database", async () => {
    vi.stubEnv("DATABASE_URL", "");
    vi.resetModules();
    const { GET } = await import("./live/route");

    const response = await GET(healthRequest("live", "live-request"));

    expect(response.status).toBe(200);
    expect(response.headers.get("x-request-id")).toBe("live-request");
    await expect(response.json()).resolves.toEqual({ status: "ok" });
  });

  it("returns ready status when SELECT 1 succeeds against PostgreSQL", async () => {
    if (databaseUrl === undefined) {
      throw new Error("DATABASE_URL is required for the health integration test");
    }
    vi.stubEnv("DATABASE_URL", databaseUrl);
    vi.resetModules();
    const { GET } = await import("./ready/route");

    const response = await GET(healthRequest("ready", "ready-request"));

    expect(response.status).toBe(200);
    expect(response.headers.get("x-request-id")).toBe("ready-request");
    await expect(response.json()).resolves.toEqual({ status: "ok" });
  });

  it("returns 503 without leaking the connection string when PostgreSQL is unavailable", async () => {
    if (databaseUrl === undefined) {
      throw new Error("DATABASE_URL is required for the health integration test");
    }
    vi.stubEnv("DATABASE_URL", databaseUrl);
    vi.resetModules();
    const [{ GET }, { prisma }] = await Promise.all([
      import("./ready/route"),
      import("../../../server/db/client"),
    ]);
    vi.spyOn(prisma, "$queryRaw").mockRejectedValueOnce(
      new Error(`connection refused for ${databaseUrl}`),
    );

    const response = await GET(healthRequest("ready", "unavailable-request"));
    const body = await response.text();

    expect(response.status).toBe(503);
    expect(response.headers.get("x-request-id")).toBe("unavailable-request");
    expect(JSON.parse(body)).toEqual({ status: "unavailable" });
    expect(body).not.toContain(databaseUrl);
  });
});
