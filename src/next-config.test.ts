import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import nextConfig from "../next.config";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("Next.js production security configuration", () => {
  it("builds a standalone server with required security headers on every route", async () => {
    expect(nextConfig.output).toBe("standalone");

    const rules = await nextConfig.headers?.();
    expect(rules).toHaveLength(1);
    expect(rules?.[0]?.source).toBe("/(.*)");

    const headers = Object.fromEntries(
      (rules?.[0]?.headers ?? []).map(({ key, value }) => [key, value]),
    );
    expect(headers).toMatchObject({
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "X-Content-Type-Options": "nosniff",
      "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
      "Strict-Transport-Security": "max-age=31536000",
    });
    expect(headers["Content-Security-Policy"]).toContain("default-src 'self'");
    expect(headers["Content-Security-Policy"]).toContain("frame-ancestors 'none'");
    expect(headers["Content-Security-Policy"]).toContain("object-src 'none'");
    expect(headers["Content-Security-Policy"]).not.toContain("'unsafe-eval'");
  });

  it("allows React development diagnostics without weakening non-development CSP", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.resetModules();
    const { default: developmentConfig } = await import("../next.config");

    const rules = await developmentConfig.headers?.();
    const contentSecurityPolicy = rules?.[0]?.headers.find(
      ({ key }) => key === "Content-Security-Policy",
    )?.value;

    expect(contentSecurityPolicy).toContain("script-src 'self' 'unsafe-inline' 'unsafe-eval'");
  });

  it("denies public readiness before proxying the public liveness probe", () => {
    const caddyfile = readFileSync("deploy/Caddyfile.example", "utf8");
    const readyHandle = caddyfile.indexOf("handle @ready");
    const readyDeny = caddyfile.indexOf("respond 404", readyHandle);
    const liveHandle = caddyfile.indexOf("handle @live");
    const liveProxy = caddyfile.indexOf("reverse_proxy app:3000", liveHandle);

    expect(readyHandle).toBeGreaterThanOrEqual(0);
    expect(readyDeny).toBeGreaterThan(readyHandle);
    expect(liveHandle).toBeGreaterThan(readyDeny);
    expect(liveProxy).toBeGreaterThan(liveHandle);
  });
});
