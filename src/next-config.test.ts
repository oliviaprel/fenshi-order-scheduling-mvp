import { afterEach, describe, expect, it, vi } from "vitest";
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
});
