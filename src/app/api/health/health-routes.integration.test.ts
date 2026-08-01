import { createServer, type Socket } from "node:net";
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

  it("returns 503 within the probe budget when the database connection stalls", async () => {
    const sockets = new Set<Socket>();
    const stalledServer = createServer((socket) => {
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));
    });
    await new Promise<void>((resolve, reject) => {
      stalledServer.once("error", reject);
      stalledServer.listen(0, "127.0.0.1", resolve);
    });
    const address = stalledServer.address();
    if (address === null || typeof address === "string") {
      throw new Error("Expected a TCP test server address");
    }

    vi.stubEnv(
      "DATABASE_URL",
      `postgresql://postgres:postgres@127.0.0.1:${address.port}/fenshi_test`,
    );
    vi.stubEnv("NODE_ENV", "production");
    vi.resetModules();
    const [{ GET }, { prisma }] = await Promise.all([
      import("./ready/route"),
      import("../../../server/db/client"),
    ]);
    const startedAt = performance.now();
    const request = GET(healthRequest("ready", "stalled-connection-request"));

    let result: Response | "probe-budget-exceeded";
    try {
      result = await Promise.race([
        request,
        new Promise<"probe-budget-exceeded">((resolve) =>
          setTimeout(() => resolve("probe-budget-exceeded"), 2_500),
        ),
      ]);
    } finally {
      for (const socket of sockets) {
        socket.destroy();
      }
      await new Promise<void>((resolve, reject) => {
        stalledServer.close((error) => (error === undefined ? resolve() : reject(error)));
      });
      await Promise.allSettled([request]);
      await prisma.$disconnect();
    }

    expect(result).not.toBe("probe-budget-exceeded");
    if (result === "probe-budget-exceeded") {
      throw new Error("Readiness exceeded the probe budget");
    }
    expect(performance.now() - startedAt).toBeLessThan(2_500);
    expect(result.status).toBe(503);
    await expect(result.json()).resolves.toEqual({ status: "unavailable" });
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
